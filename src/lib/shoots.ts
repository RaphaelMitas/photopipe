import 'server-only';
import { mkdir, rm, stat, unlink } from 'node:fs/promises';
import { eq, and, inArray } from 'drizzle-orm';
import { db } from './db/client';
import { files as filesTable, shoots as shootsTable, type FileRow } from './db/schema';
import {
	CAMERA_BASE,
	CAMERA_HOST_BASE,
	STAGE_DIRS,
	STAGE_EXTENSIONS,
	THUMBS_DIR,
	type PhysicalStage
} from './config';
import { PhotopipeError } from './errors';
import { assertShootName, filePath, shootPath, stagePath, thumbsPath } from './paths';
import { readManifest, updateManifest, writeManifest } from './manifest';
import { metadataPathFor, writeXmp } from './xmp';
import { touchThumbs } from './thumbs';
import { buildFolderName, parseShootFolder, slugifyName, stripExtension } from './utils';
import { syncNow } from './sync/engine';
import { invalidationBus } from './sync/events';
import {
	PURERAW_SETTINGS,
	SELECT_LABEL,
	type FileInfo,
	type PureRawInstructions,
	type ShootDetail,
	type ShootStatus,
	type ShootSummary,
	type StageCounts,
	type StageSizes,
	type StarRating,
	type ViewStage
} from './types';

function toFileInfo(row: FileRow): FileInfo {
	return {
		name: row.fileName,
		stage: row.stage as PhysicalStage,
		sizeBytes: row.sizeBytes,
		modifiedAt: new Date(row.mtime).toISOString(),
		rating: (row.rating as StarRating | null) ?? null,
		isSelect: row.label === SELECT_LABEL
	};
}

/**
 * `rated` and `selects` are not folders — they are these two predicates over
 * the denoised stage. Everything downstream (counts, galleries, downloads)
 * routes through here so the definitions stay in one place.
 */
function isRated(f: FileInfo): boolean {
	return f.stage === 'denoised' && f.rating !== null;
}

function isSelect(f: FileInfo): boolean {
	return f.stage === 'denoised' && f.isSelect;
}

export function filesForView(all: FileInfo[], view: ViewStage): FileInfo[] {
	switch (view) {
		case 'rated':
			return all.filter(isRated);
		case 'selects':
			return all.filter(isSelect);
		default:
			return all.filter((f) => f.stage === view);
	}
}

function countsOf(all: FileInfo[]): StageCounts {
	return {
		raw: all.filter((f) => f.stage === 'raw').length,
		denoised: all.filter((f) => f.stage === 'denoised').length,
		rated: all.filter(isRated).length,
		selects: all.filter(isSelect).length,
		exports: all.filter((f) => f.stage === 'exports').length
	};
}

function sum(list: FileInfo[]): number {
	return list.reduce((total, f) => total + f.sizeBytes, 0);
}

function sizesOf(all: FileInfo[]): StageSizes {
	return {
		raw: sum(all.filter((f) => f.stage === 'raw')),
		denoised: sum(all.filter((f) => f.stage === 'denoised')),
		rated: sum(all.filter(isRated)),
		selects: sum(all.filter(isSelect)),
		exports: sum(all.filter((f) => f.stage === 'exports'))
	};
}

function deriveStatus(counts: StageCounts, rawCount: number | null): ShootStatus {
	if (counts.exports > 0) return 'exported';
	if (counts.selects > 0) return 'curating';
	if (counts.rated > 0) return 'rating';
	if (counts.denoised > 0 && rawCount && counts.denoised < rawCount) return 'denoising';
	if (counts.denoised > 0) return 'ready';
	if (counts.raw > 0) return 'uploading';
	return 'empty';
}

export function listShoots(): ShootSummary[] {
	const shootRows = db.select().from(shootsTable).all();
	const fileRows = db.select().from(filesTable).all();

	const byShoot = new Map<number, FileInfo[]>();
	for (const row of fileRows) {
		const list = byShoot.get(row.shootId) ?? [];
		list.push(toFileInfo(row));
		byShoot.set(row.shootId, list);
	}

	return shootRows
		.map((shoot) => {
			const all = byShoot.get(shoot.id) ?? [];
			const counts = countsOf(all);
			const sizes = sizesOf(all);
			return {
				folderName: shoot.folderName,
				name: shoot.name,
				date: shoot.date,
				counts,
				sizes,
				totalSizeBytes: sizes.raw + sizes.denoised + sizes.exports,
				status: deriveStatus(counts, shoot.rawCount)
			};
		})
		.sort((a, b) => b.date.localeCompare(a.date));
}

export async function getShoot(folderName: string): Promise<ShootDetail> {
	assertShootName(folderName);

	const shoot = db.select().from(shootsTable).where(eq(shootsTable.folderName, folderName)).get();

	if (!shoot) {
		// Not indexed yet (just created, or the index was wiped) — scan on demand.
		const exists = await stat(shootPath(folderName)).then(
			(s) => s.isDirectory(),
			() => false
		);
		if (!exists) throw new PhotopipeError(`Shoot "${folderName}" not found`, 'NOT_FOUND');
		await syncNow(folderName);
		return getShoot(folderName);
	}

	const all = db
		.select()
		.from(filesTable)
		.where(eq(filesTable.shootId, shoot.id))
		.all()
		.map(toFileInfo)
		.sort((a, b) => a.name.localeCompare(b.name));

	const counts = countsOf(all);
	const sizes = sizesOf(all);

	return {
		folderName: shoot.folderName,
		name: shoot.name,
		date: shoot.date,
		counts,
		sizes,
		totalSizeBytes: sizes.raw + sizes.denoised + sizes.exports,
		status: deriveStatus(counts, shoot.rawCount),
		manifest: await readManifest(folderName),
		files: all
	};
}

export async function createShoot(name: string, date: string): Promise<string> {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
		throw new PhotopipeError('Date must be in YYYY-MM-DD format', 'INVALID_INPUT');
	}
	if (!name.trim()) {
		throw new PhotopipeError('Shoot name is required', 'INVALID_INPUT');
	}
	if (!slugifyName(name)) {
		throw new PhotopipeError('Shoot name must contain a letter or number', 'INVALID_INPUT');
	}

	const folderName = buildFolderName(name, date);
	assertShootName(folderName);
	const dir = shootPath(folderName);

	// mkdir without `recursive` is the atomic create-or-fail we want here.
	try {
		await mkdir(dir);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
			throw new PhotopipeError(`Shoot "${folderName}" already exists`, 'CONFLICT');
		}
		throw err;
	}

	await Promise.all([
		...Object.keys(STAGE_DIRS).map((stage) =>
			mkdir(stagePath(folderName, stage as PhysicalStage), { recursive: true })
		),
		mkdir(thumbsPath(folderName), { recursive: true })
	]);

	const parsed = parseShootFolder(folderName);
	await writeManifest(folderName, {
		version: 2,
		name: name.trim(),
		date,
		createdAt: new Date().toISOString(),
		algorithm: null,
		notes: '',
		rawCount: null
	});

	if (!parsed) throw new PhotopipeError('Invalid shoot folder name', 'INVALID_INPUT');

	await syncNow(folderName);
	return folderName;
}

export async function deleteShoot(folderName: string): Promise<void> {
	assertShootName(folderName);
	const dir = shootPath(folderName);

	const exists = await stat(dir).then(
		() => true,
		() => false
	);
	if (!exists) throw new PhotopipeError(`Shoot "${folderName}" not found`, 'NOT_FOUND');

	await rm(dir, { recursive: true, force: true });

	const row = db.select().from(shootsTable).where(eq(shootsTable.folderName, folderName)).get();
	if (row) db.delete(shootsTable).where(eq(shootsTable.id, row.id)).run();

	invalidationBus.emit(folderName, []);
}

export async function updateShootMeta(
	folderName: string,
	updates: { algorithm?: string | null; notes?: string; rawCount?: number | null }
): Promise<void> {
	assertShootName(folderName);
	const algorithm =
		updates.algorithm === undefined
			? undefined
			: updates.algorithm === 'DeepPRIME 3' || updates.algorithm === 'DeepPRIME XD3'
				? updates.algorithm
				: null;

	await updateManifest(folderName, {
		...(algorithm !== undefined ? { algorithm } : {}),
		...(updates.notes !== undefined ? { notes: updates.notes } : {}),
		...(updates.rawCount !== undefined ? { rawCount: updates.rawCount } : {})
	});

	await syncNow(folderName, []);
}

function shootIdOrThrow(folderName: string): number {
	const row = db.select().from(shootsTable).where(eq(shootsTable.folderName, folderName)).get();
	if (!row) throw new PhotopipeError(`Shoot "${folderName}" not found`, 'NOT_FOUND');
	return row.id;
}

/**
 * Writes metadata into the files, then mirrors the result into the index.
 * Recording the post-write mtimes is what stops the watcher from treating our
 * own edit as an external change and re-reading every file again.
 */
async function applyMetadata(
	folderName: string,
	stage: PhysicalStage,
	changes: Array<{ file: string; rating?: StarRating | null; isSelect?: boolean }>
): Promise<number> {
	assertShootName(folderName);
	const shootId = shootIdOrThrow(folderName);
	let applied = 0;

	for (const change of changes) {
		const imagePath = filePath(folderName, stage, change.file);
		try {
			const { mtimeMs: xmpMtime } = await writeXmp(stage, imagePath, {
				...(change.rating !== undefined ? { rating: change.rating } : {}),
				...(change.isSelect !== undefined ? { isSelect: change.isSelect } : {})
			});

			// Only metadata changed, so the cached renders are still correct.
			await touchThumbs(folderName, stage, change.file);

			const info = await stat(imagePath);
			const patch: Partial<typeof filesTable.$inferInsert> = {
				sizeBytes: info.size,
				mtime: Math.round(info.mtimeMs),
				xmpMtime
			};
			if (change.rating !== undefined) patch.rating = change.rating;
			if (change.isSelect !== undefined) patch.label = change.isSelect ? SELECT_LABEL : null;

			db.update(filesTable)
				.set(patch)
				.where(
					and(
						eq(filesTable.shootId, shootId),
						eq(filesTable.stage, stage),
						eq(filesTable.fileName, change.file)
					)
				)
				.run();
			applied++;
		} catch (err) {
			console.error(`Failed to write metadata for ${change.file}:`, err);
		}
	}

	if (applied > 0) invalidationBus.emit(folderName, [stage]);
	return applied;
}

export function setRatings(
	folderName: string,
	ratings: Array<{ file: string; rating: StarRating | null }>,
	stage: PhysicalStage = 'denoised'
): Promise<number> {
	return applyMetadata(
		folderName,
		stage,
		ratings.map((r) => ({ file: r.file, rating: r.rating }))
	);
}

export function setSelects(
	folderName: string,
	fileNames: string[],
	isSelect: boolean,
	stage: PhysicalStage = 'denoised'
): Promise<number> {
	return applyMetadata(
		folderName,
		stage,
		fileNames.map((file) => ({ file, isSelect }))
	);
}

/** Marks every file at or above `minRating` as a select. */
export async function promoteByRating(folderName: string, minRating: number): Promise<number> {
	const shoot = await getShoot(folderName);
	const targets = shoot.files
		.filter((f) => f.stage === 'denoised' && f.rating !== null && f.rating >= minRating)
		.filter((f) => !f.isSelect)
		.map((f) => f.name);
	if (targets.length === 0) return 0;
	return setSelects(folderName, targets, true);
}

async function removeThumbs(folderName: string, stage: PhysicalStage, fileName: string) {
	const base = stripExtension(fileName);
	for (const suffix of ['', '_preview']) {
		await unlink(`${thumbsPath(folderName)}/${stage}_${base}${suffix}.webp`).catch(() => {});
	}
}

export async function deleteFiles(
	folderName: string,
	stage: PhysicalStage,
	fileNames?: string[]
): Promise<{ deletedCount: number; freedBytes: number }> {
	assertShootName(folderName);
	const shootId = shootIdOrThrow(folderName);

	const rows = db
		.select()
		.from(filesTable)
		.where(and(eq(filesTable.shootId, shootId), eq(filesTable.stage, stage)))
		.all();

	const targets =
		fileNames && fileNames.length > 0 ? rows.filter((r) => fileNames.includes(r.fileName)) : rows;

	let deletedCount = 0;
	let freedBytes = 0;
	const deletedIds: number[] = [];

	for (const row of targets) {
		const path = filePath(folderName, stage, row.fileName);
		try {
			await unlink(path);
			// Raw sidecars are companions of the image, not files of their own.
			if (stage === 'raw') await unlink(metadataPathFor(stage, path)).catch(() => {});
			await removeThumbs(folderName, stage, row.fileName);
			deletedCount++;
			freedBytes += row.sizeBytes;
			deletedIds.push(row.id);
		} catch (err) {
			console.error(`Failed to delete ${row.fileName}:`, err);
		}
	}

	if (deletedIds.length > 0) {
		db.delete(filesTable).where(inArray(filesTable.id, deletedIds)).run();
		invalidationBus.emit(folderName, [stage]);
	}

	return { deletedCount, freedBytes };
}

/** Recounts raws on disk and stores the target the denoise progress bar counts towards. */
export async function finalizeUpload(folderName: string): Promise<number> {
	await syncNow(folderName, ['raw']);
	const shootId = shootIdOrThrow(folderName);
	const rawCount = db
		.select()
		.from(filesTable)
		.where(and(eq(filesTable.shootId, shootId), eq(filesTable.stage, 'raw')))
		.all().length;

	await updateManifest(folderName, { rawCount });
	db.update(shootsTable).set({ rawCount }).where(eq(shootsTable.id, shootId)).run();
	invalidationBus.emit(folderName, ['raw']);
	return rawCount;
}

export function getPureRawInstructions(folderName: string): PureRawInstructions {
	return {
		inputPath: `${CAMERA_HOST_BASE}/${folderName}/${STAGE_DIRS.raw}/`,
		outputPath: `${CAMERA_HOST_BASE}/${folderName}/${STAGE_DIRS.denoised}/`,
		settings: PURERAW_SETTINGS
	};
}

export { STAGE_EXTENSIONS, STAGE_DIRS, THUMBS_DIR, CAMERA_BASE };
