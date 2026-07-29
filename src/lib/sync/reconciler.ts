import 'server-only';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client';
import { files, shoots } from '../db/schema';
import {
	CAMERA_BASE,
	SHOOT_PATTERN,
	STAGE_DIRS,
	STAGE_EXTENSIONS,
	STABILITY_RECHECK_MS,
	type PhysicalStage
} from '../config';
import { manifestPath, stagePath } from '../paths';
import { readManifest } from '../manifest';
import { readXmp, metadataPathFor } from '../xmp';
import { fileExtension, parseShootFolder } from '../utils';
import { invalidationBus } from './events';

const ALL_STAGES = Object.keys(STAGE_DIRS) as PhysicalStage[];

interface DiskEntry {
	name: string;
	sizeBytes: number;
	mtimeMs: number;
}

async function listStage(folderName: string, stage: PhysicalStage): Promise<DiskEntry[]> {
	const dir = stagePath(folderName, stage);
	const allowed = STAGE_EXTENSIONS[stage];

	let names: string[];
	try {
		names = await readdir(dir);
	} catch {
		return [];
	}

	const entries: DiskEntry[] = [];
	for (const name of names) {
		if (name.startsWith('.')) continue;
		if (!allowed.includes(fileExtension(name))) continue;
		try {
			const info = await stat(join(dir, name));
			if (!info.isFile()) continue;
			entries.push({ name, sizeBytes: info.size, mtimeMs: Math.round(info.mtimeMs) });
		} catch {
			// Vanished between readdir and stat.
		}
	}
	return entries;
}

/**
 * A file being written by PureRAW grows between observations. Anything whose
 * size is still moving is left out of this pass and picked up by the next one.
 */
async function filterStable(
	folderName: string,
	stage: PhysicalStage,
	entries: DiskEntry[]
): Promise<DiskEntry[]> {
	const now = Date.now();
	const suspect = entries.filter((e) => now - e.mtimeMs < STABILITY_RECHECK_MS);
	if (suspect.length === 0) return entries;

	await new Promise((r) => setTimeout(r, STABILITY_RECHECK_MS));

	const stable: DiskEntry[] = [];
	for (const entry of entries) {
		if (!suspect.includes(entry)) {
			stable.push(entry);
			continue;
		}
		try {
			const info = await stat(join(stagePath(folderName, stage), entry.name));
			if (info.size === entry.sizeBytes) {
				stable.push({ ...entry, mtimeMs: Math.round(info.mtimeMs) });
			}
		} catch {
			// Gone — drop it.
		}
	}
	return stable;
}

/** Ensures a shoot row exists for a folder on disk and returns its id. */
async function ensureShootRow(folderName: string): Promise<number | null> {
	const parsed = parseShootFolder(folderName);
	if (!parsed) return null;

	const manifest = await readManifest(folderName);
	let manifestMtime: number | null = null;
	try {
		manifestMtime = Math.round((await stat(manifestPath(folderName))).mtimeMs);
	} catch {
		// No manifest yet — folder created outside the app.
	}

	const existing = db.select().from(shoots).where(eq(shoots.folderName, folderName)).get();

	const values = {
		folderName,
		name: manifest.name || parsed.name,
		date: manifest.date || parsed.date,
		createdAt: manifest.createdAt,
		algorithm: manifest.algorithm,
		notes: manifest.notes,
		rawCount: manifest.rawCount,
		manifestMtime,
		lastScannedAt: Date.now()
	};

	if (!existing) {
		const inserted = db.insert(shoots).values(values).returning({ id: shoots.id }).get();
		return inserted?.id ?? null;
	}

	db.update(shoots).set(values).where(eq(shoots.id, existing.id)).run();
	return existing.id;
}

/**
 * Brings one stage of one shoot in line with what is on disk. XMP is only
 * re-read when the image (or its sidecar) changed since we last looked, which
 * is also what keeps our own writes from bouncing back through the watcher.
 */
export async function reconcileStage(
	folderName: string,
	stage: PhysicalStage,
	shootId: number
): Promise<boolean> {
	const [onDisk, indexed] = await Promise.all([
		listStage(folderName, stage).then((entries) => filterStable(folderName, stage, entries)),
		Promise.resolve(
			db
				.select()
				.from(files)
				.where(and(eq(files.shootId, shootId), eq(files.stage, stage)))
				.all()
		)
	]);

	const indexedByName = new Map(indexed.map((row) => [row.fileName, row]));
	const diskByName = new Map(onDisk.map((entry) => [entry.name, entry]));
	let changed = false;

	for (const entry of onDisk) {
		const row = indexedByName.get(entry.name);
		const imagePath = join(stagePath(folderName, stage), entry.name);

		let xmpMtime: number | null = null;
		try {
			xmpMtime = Math.round((await stat(metadataPathFor(stage, imagePath))).mtimeMs);
		} catch {
			// No sidecar yet.
		}

		const unchanged =
			row &&
			row.sizeBytes === entry.sizeBytes &&
			row.mtime === entry.mtimeMs &&
			row.xmpMtime === xmpMtime;

		if (unchanged) continue;

		const meta = await readXmp(stage, imagePath);
		const values = {
			shootId,
			stage,
			fileName: entry.name,
			sizeBytes: entry.sizeBytes,
			mtime: entry.mtimeMs,
			rating: meta.rating,
			label: meta.isSelect ? 'Select' : null,
			xmpMtime
		};

		if (row) {
			db.update(files).set(values).where(eq(files.id, row.id)).run();
		} else {
			db.insert(files).values(values).run();
		}
		changed = true;
	}

	for (const row of indexed) {
		if (!diskByName.has(row.fileName)) {
			db.delete(files).where(eq(files.id, row.id)).run();
			changed = true;
		}
	}

	return changed;
}

export async function reconcileShoot(
	folderName: string,
	stages: PhysicalStage[] = ALL_STAGES
): Promise<void> {
	if (!SHOOT_PATTERN.test(folderName)) return;

	const exists = await stat(join(CAMERA_BASE, folderName)).then(
		(s) => s.isDirectory(),
		() => false
	);

	if (!exists) {
		const row = db.select().from(shoots).where(eq(shoots.folderName, folderName)).get();
		if (row) {
			db.delete(shoots).where(eq(shoots.id, row.id)).run();
			invalidationBus.emit(folderName, stages);
		}
		return;
	}

	const shootId = await ensureShootRow(folderName);
	if (shootId === null) return;

	let changed = false;
	for (const stage of stages) {
		if (await reconcileStage(folderName, stage, shootId)) changed = true;
	}

	// The shoot row is refreshed every pass, so emit regardless of file churn:
	// manifest edits matter to the UI too.
	invalidationBus.emit(folderName, changed ? stages : []);
}

/** Walks the camera directory: adds new shoots, drops folders that disappeared. */
export async function fullScan(): Promise<void> {
	let entries: string[] = [];
	try {
		entries = (await readdir(CAMERA_BASE, { withFileTypes: true }))
			.filter((e) => e.isDirectory() && SHOOT_PATTERN.test(e.name))
			.map((e) => e.name);
	} catch (err) {
		console.error('Full scan failed to read camera base:', err);
		return;
	}

	for (const folderName of entries) {
		await reconcileShoot(folderName);
	}

	const known = db.select({ folderName: shoots.folderName }).from(shoots).all();
	const onDisk = new Set(entries);
	for (const row of known) {
		if (!onDisk.has(row.folderName)) {
			db.delete(shoots).where(eq(shoots.folderName, row.folderName)).run();
		}
	}

	invalidationBus.emit(null, ALL_STAGES);
}
