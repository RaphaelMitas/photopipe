import { readdir, stat, mkdir, readFile, unlink, rm, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { Mutex } from 'async-mutex';
import { Writer } from 'steno';
import {
	CAMERA_BASE,
	CAMERA_HOST_BASE,
	SHOOT_PATTERN,
	METADATA_FILE,
	RAW_DIR,
	DENOISED_DIR,
	RATED_DIR,
	SELECTS_DIR,
	EXPORTS_DIR,
	THUMBS_DIR
} from './config.js';
import type {
	ShootMetadata,
	ShootSummary,
	ShootDetail,
	ShootStatus,
	FileInfo,
	RatedFileInfo,
	PureRawInstructions,
	StarRating
} from '$lib/types.js';
import { PURERAW_SETTINGS } from '$lib/types.js';
import { parseShootFolder, buildFolderName, slugifyName } from '$lib/utils.js';
import { z } from 'zod/v4';

const shootMutexes = new Map<string, Mutex>();

function getShootMutex(folderName: string): Mutex {
	let mutex = shootMutexes.get(folderName);
	if (!mutex) {
		mutex = new Mutex();
		shootMutexes.set(folderName, mutex);
	}
	return mutex;
}

const metadataWriters = new Map<string, Writer>();

function getMetadataWriter(shootPath: string): Writer {
	let writer = metadataWriters.get(shootPath);
	if (!writer) {
		writer = new Writer(join(shootPath, METADATA_FILE));
		metadataWriters.set(shootPath, writer);
	}
	return writer;
}

export class PhotopipeError extends Error {
	constructor(
		message: string,
		public code: 'NOT_FOUND' | 'INVALID_INPUT' | 'FS_ERROR' | 'CONFLICT',
		public status: number = 500
	) {
		super(message);
		this.name = 'PhotopipeError';
	}
}

export function validateShootName(name: string): void {
	if (!name || typeof name !== 'string') {
		throw new PhotopipeError('Shoot name is required', 'INVALID_INPUT', 400);
	}
	if (name.includes('..') || name.includes('/') || name.includes('\\')) {
		throw new PhotopipeError('Invalid characters in shoot name', 'INVALID_INPUT', 400);
	}
	if (!SHOOT_PATTERN.test(name)) {
		throw new PhotopipeError(
			'Shoot folder must match format "YYYY-MM-DD Name"',
			'INVALID_INPUT',
			400
		);
	}
}

function validateFileName(name: string): void {
	if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
		throw new PhotopipeError('Invalid filename', 'INVALID_INPUT', 400);
	}
}

async function listFilesWithExt(dirPath: string, extensions: string[]): Promise<FileInfo[]> {
	try {
		const entries = await readdir(dirPath);
		const files: FileInfo[] = [];
		const lowerExts = extensions.map((e) => e.toLowerCase());

		for (const entry of entries) {
			const ext = entry.substring(entry.lastIndexOf('.')).toLowerCase();
			if (!lowerExts.includes(ext)) continue;

			try {
				const info = await stat(join(dirPath, entry));
				if (info.isFile()) {
					files.push({
						name: entry,
						sizeBytes: info.size,
						modifiedAt: info.mtime.toISOString()
					});
				}
			} catch {
				// Skip files we can't stat
			}
		}

		return files.sort((a, b) => a.name.localeCompare(b.name));
	} catch {
		return [];
	}
}

const starRating = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);

const metadataSchema = z.object({
	version: z.number(),
	name: z.string(),
	date: z.string(),
	createdAt: z.string(),
	algorithm: z.enum(['DeepPRIME 3', 'DeepPRIME XD3']).nullable(),
	notes: z.string(),
	rawCount: z.number().nullable(),
	ratings: z.record(z.string(), starRating).default({})
});

function parseMetadata(raw: string): ShootMetadata | null {
	const result = metadataSchema.safeParse(JSON.parse(raw));
	return result.success ? result.data : null;
}

async function readMetadata(shootPath: string): Promise<ShootMetadata | null> {
	try {
		const raw = await readFile(join(shootPath, METADATA_FILE), 'utf-8');
		return parseMetadata(raw);
	} catch {
		return null;
	}
}

async function writeMetadata(shootPath: string, metadata: ShootMetadata): Promise<void> {
	await getMetadataWriter(shootPath).write(JSON.stringify(metadata, null, '\t'));
}

function deriveStatus(
	rawCount: number,
	dngCount: number,
	ratedCount: number,
	selectCount: number,
	exportCount: number,
	metadata: ShootMetadata | null
): ShootStatus {
	if (exportCount > 0) return 'exported';
	if (selectCount > 0) return 'curating';
	if (ratedCount > 0) return 'rating';
	if (dngCount > 0 && metadata?.rawCount && dngCount < metadata.rawCount) return 'denoising';
	if (dngCount > 0) return 'ready';
	if (rawCount > 0) return 'uploading';
	return 'empty';
}

export async function listShoots(): Promise<ShootSummary[]> {
	const entries = await readdir(CAMERA_BASE, { withFileTypes: true });
	const shoots: ShootSummary[] = [];

	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		if (!SHOOT_PATTERN.test(entry.name)) continue;

		const parsed = parseShootFolder(entry.name);
		if (!parsed) continue;

		const shootPath = join(CAMERA_BASE, entry.name);
		const rawFiles = await listFilesWithExt(join(shootPath, RAW_DIR), ['.arw']);
		const dngFiles = await listFilesWithExt(join(shootPath, DENOISED_DIR), ['.dng']);
		const ratedFiles = await listFilesWithExt(join(shootPath, RATED_DIR), ['.dng']);
		const selectFiles = await listFilesWithExt(join(shootPath, SELECTS_DIR), ['.dng']);
		const exportFiles = await listFilesWithExt(join(shootPath, EXPORTS_DIR), [
			'.jpg',
			'.jpeg',
			'.png',
			'.tif',
			'.tiff',
			'.webp',
			'.dng'
		]);
		const metadata = await readMetadata(shootPath);

		const rawSize = rawFiles.reduce((sum, f) => sum + f.sizeBytes, 0);
		const dngSize = dngFiles.reduce((sum, f) => sum + f.sizeBytes, 0);
		const ratedSize = ratedFiles.reduce((sum, f) => sum + f.sizeBytes, 0);
		const selectSize = selectFiles.reduce((sum, f) => sum + f.sizeBytes, 0);
		const exportSize = exportFiles.reduce((sum, f) => sum + f.sizeBytes, 0);

		shoots.push({
			folderName: entry.name,
			name: parsed.name,
			date: parsed.date,
			rawCount: rawFiles.length,
			dngCount: dngFiles.length,
			ratedCount: ratedFiles.length,
			selectCount: selectFiles.length,
			exportCount: exportFiles.length,
			totalSizeBytes: rawSize + dngSize + ratedSize + selectSize + exportSize,
			status: deriveStatus(
				rawFiles.length,
				dngFiles.length,
				ratedFiles.length,
				selectFiles.length,
				exportFiles.length,
				metadata
			)
		});
	}

	return shoots.sort((a, b) => b.date.localeCompare(a.date));
}

async function ensureRatingFolders(shootPath: string): Promise<void> {
	await mkdir(join(shootPath, RATED_DIR), { recursive: true });
	await mkdir(join(shootPath, SELECTS_DIR), { recursive: true });
}

export async function getShoot(folderName: string): Promise<ShootDetail> {
	validateShootName(folderName);

	const shootPath = join(CAMERA_BASE, folderName);

	try {
		await stat(shootPath);
	} catch {
		throw new PhotopipeError(`Shoot "${folderName}" not found`, 'NOT_FOUND', 404);
	}

	const parsed = parseShootFolder(folderName);
	if (!parsed) {
		throw new PhotopipeError('Invalid shoot folder name', 'INVALID_INPUT', 400);
	}

	await ensureRatingFolders(shootPath);

	const rawFiles = await listFilesWithExt(join(shootPath, RAW_DIR), ['.arw']);
	const dngFiles = await listFilesWithExt(join(shootPath, DENOISED_DIR), ['.dng']);
	const ratedFilesRaw = await listFilesWithExt(join(shootPath, RATED_DIR), ['.dng']);
	const selectFiles = await listFilesWithExt(join(shootPath, SELECTS_DIR), ['.dng']);
	const exportFiles = await listFilesWithExt(join(shootPath, EXPORTS_DIR), [
		'.jpg',
		'.jpeg',
		'.png',
		'.tif',
		'.tiff',
		'.webp',
		'.dng'
	]);
	const metadata = await readMetadata(shootPath);

	const rawSizeBytes = rawFiles.reduce((sum, f) => sum + f.sizeBytes, 0);
	const dngSizeBytes = dngFiles.reduce((sum, f) => sum + f.sizeBytes, 0);
	const ratedSizeBytes = ratedFilesRaw.reduce((sum, f) => sum + f.sizeBytes, 0);
	const selectSizeBytes = selectFiles.reduce((sum, f) => sum + f.sizeBytes, 0);
	const exportSizeBytes = exportFiles.reduce((sum, f) => sum + f.sizeBytes, 0);

	const defaultMetadata: ShootMetadata = {
		version: 1,
		name: parsed.name,
		date: parsed.date,
		createdAt: new Date().toISOString(),
		algorithm: null,
		notes: '',
		rawCount: null,
		ratings: {}
	};

	const meta = metadata ?? defaultMetadata;

	const ratedFiles: RatedFileInfo[] = ratedFilesRaw.map((f) => ({
		...f,
		rating: meta.ratings[f.name] ?? 3
	}));

	return {
		folderName,
		name: parsed.name,
		date: parsed.date,
		rawCount: rawFiles.length,
		dngCount: dngFiles.length,
		ratedCount: ratedFiles.length,
		selectCount: selectFiles.length,
		exportCount: exportFiles.length,
		totalSizeBytes:
			rawSizeBytes + dngSizeBytes + ratedSizeBytes + selectSizeBytes + exportSizeBytes,
		status: deriveStatus(
			rawFiles.length,
			dngFiles.length,
			ratedFiles.length,
			selectFiles.length,
			exportFiles.length,
			meta
		),
		metadata: meta,
		rawFiles,
		dngFiles,
		ratedFiles,
		selectFiles,
		exportFiles,
		rawSizeBytes,
		dngSizeBytes,
		ratedSizeBytes,
		selectSizeBytes,
		exportSizeBytes
	};
}

export async function createShoot(name: string, date: string): Promise<string> {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
		throw new PhotopipeError('Date must be in YYYY-MM-DD format', 'INVALID_INPUT', 400);
	}

	if (!name || name.trim().length === 0) {
		throw new PhotopipeError('Shoot name is required', 'INVALID_INPUT', 400);
	}

	const slug = slugifyName(name);
	if (!slug) {
		throw new PhotopipeError(
			'Shoot name must contain at least one letter or number',
			'INVALID_INPUT',
			400
		);
	}

	const folderName = buildFolderName(name, date);
	validateShootName(folderName);

	const shootPath = join(CAMERA_BASE, folderName);

	try {
		await stat(shootPath);
		throw new PhotopipeError(`Shoot "${folderName}" already exists`, 'CONFLICT', 409);
	} catch (err) {
		if (err instanceof PhotopipeError) throw err;
	}

	await mkdir(join(shootPath, RAW_DIR), { recursive: true });
	await mkdir(join(shootPath, DENOISED_DIR), { recursive: true });
	await mkdir(join(shootPath, RATED_DIR), { recursive: true });
	await mkdir(join(shootPath, SELECTS_DIR), { recursive: true });
	await mkdir(join(shootPath, EXPORTS_DIR), { recursive: true });
	await mkdir(join(shootPath, THUMBS_DIR), { recursive: true });

	const metadata: ShootMetadata = {
		version: 1,
		name: name.trim(),
		date,
		createdAt: new Date().toISOString(),
		algorithm: null,
		notes: '',
		rawCount: null,
		ratings: {}
	};

	await writeMetadata(shootPath, metadata);

	return folderName;
}

export async function updateMetadata(
	folderName: string,
	updates: Partial<Pick<ShootMetadata, 'algorithm' | 'notes' | 'rawCount' | 'ratings'>>
): Promise<ShootMetadata> {
	validateShootName(folderName);

	return getShootMutex(folderName).runExclusive(async () => {
		const shootPath = join(CAMERA_BASE, folderName);
		const existing = await readMetadata(shootPath);

		if (!existing) {
			throw new PhotopipeError('Shoot metadata not found', 'NOT_FOUND', 404);
		}

		const updated: ShootMetadata = { ...existing, ...updates };
		await writeMetadata(shootPath, updated);

		return updated;
	});
}

const DELETABLE_EXTENSIONS: Record<string, string[]> = {
	raw: ['.arw', '.xmp'],
	denoised: ['.dng'],
	rated: ['.dng'],
	selects: ['.dng'],
	exports: ['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp', '.dng']
};

const FOLDER_DIR: Record<string, string> = {
	raw: RAW_DIR,
	denoised: DENOISED_DIR,
	rated: RATED_DIR,
	selects: SELECTS_DIR,
	exports: EXPORTS_DIR
};

function thumbName(fileName: string): string {
	const base = fileName.substring(0, fileName.lastIndexOf('.')) || fileName;
	return `${base}.webp`;
}

export async function deleteFiles(
	folderName: string,
	folder: 'exports' | 'denoised' | 'raw' | 'rated' | 'selects',
	files?: string[]
): Promise<{ deletedCount: number; freedBytes: number }> {
	validateShootName(folderName);

	const dirName = FOLDER_DIR[folder];
	if (!dirName) {
		throw new PhotopipeError('Invalid folder type', 'INVALID_INPUT', 400);
	}

	const dirPath = join(CAMERA_BASE, folderName, dirName);
	const allowedExts = DELETABLE_EXTENSIONS[folder];

	let targets: string[];

	if (files && files.length > 0) {
		for (const f of files) {
			validateFileName(f);
		}
		targets = files;
	} else {
		try {
			const entries = await readdir(dirPath);
			targets = entries.filter((entry) => {
				if (entry.startsWith('.')) return false;
				const ext = entry.substring(entry.lastIndexOf('.')).toLowerCase();
				return allowedExts.includes(ext);
			});
		} catch {
			return { deletedCount: 0, freedBytes: 0 };
		}
	}

	let deletedCount = 0;
	let freedBytes = 0;

	for (const fileName of targets) {
		const filePath = join(dirPath, fileName);
		try {
			const info = await stat(filePath);
			if (!info.isFile()) continue;
			await unlink(filePath);
			deletedCount++;
			freedBytes += info.size;
		} catch {
			// Skip files we can't delete or don't exist
		}
	}

	if (folder === 'exports' && deletedCount > 0) {
		const thumbDir = join(CAMERA_BASE, folderName, THUMBS_DIR);
		for (const fileName of targets) {
			try {
				await unlink(join(thumbDir, thumbName(fileName)));
			} catch {
				// Thumbnail may not exist
			}
		}
	}

	if (folder === 'rated' && deletedCount > 0) {
		await getShootMutex(folderName).runExclusive(async () => {
			const shootPath = join(CAMERA_BASE, folderName);
			const metadata = await readMetadata(shootPath);
			if (metadata) {
				for (const fileName of targets) {
					delete metadata.ratings[fileName];
				}
				await writeMetadata(shootPath, metadata);
			}
		});
	}

	return { deletedCount, freedBytes };
}

export async function deleteShoot(folderName: string): Promise<void> {
	validateShootName(folderName);

	const shootPath = join(CAMERA_BASE, folderName);

	try {
		await stat(shootPath);
	} catch {
		throw new PhotopipeError(`Shoot "${folderName}" not found`, 'NOT_FOUND', 404);
	}

	await rm(shootPath, { recursive: true, force: true });
}

export async function rateFiles(
	folderName: string,
	ratings: Array<{ file: string; rating: StarRating }>
): Promise<{ movedCount: number }> {
	validateShootName(folderName);

	return getShootMutex(folderName).runExclusive(async () => {
		const shootPath = join(CAMERA_BASE, folderName);

		await mkdir(join(shootPath, RATED_DIR), { recursive: true });

		const metadata = await readMetadata(shootPath);
		if (!metadata) {
			throw new PhotopipeError('Shoot metadata not found', 'NOT_FOUND', 404);
		}

		let movedCount = 0;
		for (const { file, rating } of ratings) {
			validateFileName(file);
			const src = join(shootPath, DENOISED_DIR, file);
			const dest = join(shootPath, RATED_DIR, file);
			try {
				await rename(src, dest);
				metadata.ratings[file] = rating;
				movedCount++;
			} catch {
				// File might not exist or already moved
			}
		}

		await writeMetadata(shootPath, metadata);
		return { movedCount };
	});
}

export async function updateRatings(
	folderName: string,
	ratings: Array<{ file: string; rating: StarRating }>
): Promise<void> {
	validateShootName(folderName);

	await getShootMutex(folderName).runExclusive(async () => {
		const shootPath = join(CAMERA_BASE, folderName);

		for (const { file } of ratings) {
			validateFileName(file);
		}

		const metadata = await readMetadata(shootPath);
		if (!metadata) {
			throw new PhotopipeError('Shoot metadata not found', 'NOT_FOUND', 404);
		}

		for (const { file, rating } of ratings) {
			metadata.ratings[file] = rating;
		}

		await writeMetadata(shootPath, metadata);
	});
}

type MoveableFolder = 'raw' | 'denoised' | 'rated' | 'selects' | 'exports';

export async function moveFiles(
	folderName: string,
	from: MoveableFolder,
	to: MoveableFolder,
	files: string[]
): Promise<{ movedCount: number }> {
	validateShootName(folderName);
	const shootPath = join(CAMERA_BASE, folderName);

	const fromDir = FOLDER_DIR[from];
	const toDir = FOLDER_DIR[to];
	if (!fromDir || !toDir) {
		throw new PhotopipeError('Invalid folder type', 'INVALID_INPUT', 400);
	}

	await mkdir(join(shootPath, toDir), { recursive: true });

	for (const f of files) validateFileName(f);

	let movedCount = 0;
	for (const file of files) {
		const src = join(shootPath, fromDir, file);
		const dest = join(shootPath, toDir, file);
		try {
			await rename(src, dest);
			movedCount++;
		} catch {
			// Skip
		}
	}

	return { movedCount };
}

export function getPureRawInstructions(shootFolderName: string): PureRawInstructions {
	return {
		inputPath: `${CAMERA_HOST_BASE}/${shootFolderName}/${RAW_DIR}/`,
		outputPath: `${CAMERA_HOST_BASE}/${shootFolderName}/${DENOISED_DIR}/`,
		settings: PURERAW_SETTINGS
	};
}
