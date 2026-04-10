import { readdir, stat, mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
	CAMERA_BASE,
	CAMERA_HOST_BASE,
	SHOOT_PATTERN,
	METADATA_FILE,
	RAW_DIR,
	DENOISED_DIR,
	EXPORTS_DIR,
	THUMBS_DIR
} from './config.js';
import type {
	ShootMetadata,
	ShootSummary,
	ShootDetail,
	ShootStatus,
	FileInfo,
	PureRawInstructions
} from '$lib/types.js';
import { PURERAW_SETTINGS } from '$lib/types.js';
import { parseShootFolder, buildFolderName, slugifyName } from '$lib/utils.js';

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

/**
 * Validate a shoot name against path traversal and format rules
 */
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

/**
 * List files in a directory with given extensions, returning file info.
 * Returns empty array if directory doesn't exist.
 */
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

/**
 * Read .photopipe.json metadata from a shoot folder
 */
async function readMetadata(shootPath: string): Promise<ShootMetadata | null> {
	try {
		const raw = await readFile(join(shootPath, METADATA_FILE), 'utf-8');
		return JSON.parse(raw) as ShootMetadata;
	} catch {
		return null;
	}
}

/**
 * Derive the status of a shoot based on its contents
 */
function deriveStatus(
	rawCount: number,
	dngCount: number,
	exportCount: number,
	metadata: ShootMetadata | null
): ShootStatus {
	if (exportCount > 0) return 'exported';
	if (dngCount > 0 && metadata?.rawCount && dngCount < metadata.rawCount) return 'denoising';
	if (dngCount > 0) return 'ready';
	if (rawCount > 0) return 'uploading';
	return 'empty';
}

/**
 * List all shoots matching the YYYY-MM-DD format, sorted by date descending
 */
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
		const exportSize = exportFiles.reduce((sum, f) => sum + f.sizeBytes, 0);

		shoots.push({
			folderName: entry.name,
			name: parsed.name,
			date: parsed.date,
			rawCount: rawFiles.length,
			dngCount: dngFiles.length,
			exportCount: exportFiles.length,
			totalSizeBytes: rawSize + dngSize + exportSize,
			status: deriveStatus(rawFiles.length, dngFiles.length, exportFiles.length, metadata)
		});
	}

	return shoots.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Get detailed information about a single shoot
 */
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

	const rawFiles = await listFilesWithExt(join(shootPath, RAW_DIR), ['.arw']);
	const dngFiles = await listFilesWithExt(join(shootPath, DENOISED_DIR), ['.dng']);
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
	const exportSizeBytes = exportFiles.reduce((sum, f) => sum + f.sizeBytes, 0);

	const defaultMetadata: ShootMetadata = {
		version: 1,
		name: parsed.name,
		date: parsed.date,
		createdAt: new Date().toISOString(),
		algorithm: null,
		notes: '',
		rawCount: null
	};

	return {
		folderName,
		name: parsed.name,
		date: parsed.date,
		rawCount: rawFiles.length,
		dngCount: dngFiles.length,
		exportCount: exportFiles.length,
		totalSizeBytes: rawSizeBytes + dngSizeBytes + exportSizeBytes,
		status: deriveStatus(rawFiles.length, dngFiles.length, exportFiles.length, metadata),
		metadata: metadata ?? defaultMetadata,
		rawFiles,
		dngFiles,
		exportFiles,
		rawSizeBytes,
		dngSizeBytes,
		exportSizeBytes
	};
}

/**
 * Create a new shoot folder with standard structure
 */
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

	// Check for duplicates
	try {
		await stat(shootPath);
		throw new PhotopipeError(`Shoot "${folderName}" already exists`, 'CONFLICT', 409);
	} catch (err) {
		if (err instanceof PhotopipeError) throw err;
	}

	// Create directory structure
	await mkdir(join(shootPath, RAW_DIR), { recursive: true });
	await mkdir(join(shootPath, DENOISED_DIR), { recursive: true });
	await mkdir(join(shootPath, EXPORTS_DIR), { recursive: true });
	await mkdir(join(shootPath, THUMBS_DIR), { recursive: true });

	const metadata: ShootMetadata = {
		version: 1,
		name: name.trim(),
		date,
		createdAt: new Date().toISOString(),
		algorithm: null,
		notes: '',
		rawCount: null
	};

	await writeFile(join(shootPath, METADATA_FILE), JSON.stringify(metadata, null, '\t'), 'utf-8');

	return folderName;
}

/**
 * Update metadata fields for a shoot
 */
export async function updateMetadata(
	folderName: string,
	updates: Partial<Pick<ShootMetadata, 'algorithm' | 'notes' | 'rawCount'>>
): Promise<ShootMetadata> {
	validateShootName(folderName);

	const shootPath = join(CAMERA_BASE, folderName);
	const existing = await readMetadata(shootPath);

	if (!existing) {
		throw new PhotopipeError('Shoot metadata not found', 'NOT_FOUND', 404);
	}

	const updated: ShootMetadata = { ...existing, ...updates };
	await writeFile(join(shootPath, METADATA_FILE), JSON.stringify(updated, null, '\t'), 'utf-8');

	return updated;
}

/** Allowed file extensions per folder type for deletion */
const DELETABLE_EXTENSIONS: Record<string, string[]> = {
	raw: ['.arw', '.xmp'],
	denoised: ['.dng'],
	exports: ['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp', '.dng']
};

/** Map folder type to directory constant */
const FOLDER_DIR: Record<string, string> = {
	raw: RAW_DIR,
	denoised: DENOISED_DIR,
	exports: EXPORTS_DIR
};

/** Strip original extension and add .webp to get cached thumbnail name */
function thumbName(fileName: string): string {
	const base = fileName.substring(0, fileName.lastIndexOf('.')) || fileName;
	return `${base}.webp`;
}

/** Validate a single filename against path traversal */
function validateFileName(name: string): void {
	if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
		throw new PhotopipeError('Invalid filename', 'INVALID_INPUT', 400);
	}
}

/**
 * Delete files from a shoot's subfolder.
 * If `files` is provided, delete only those specific files.
 * If `files` is omitted, delete all files in the folder.
 * Returns the number of files deleted and bytes freed.
 */
export async function deleteFiles(
	folderName: string,
	folder: 'exports' | 'denoised' | 'raw',
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
		// Selective delete: validate each filename
		for (const f of files) {
			validateFileName(f);
		}
		targets = files;
	} else {
		// Delete all: read directory and filter by extension
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

	// Clean up cached thumbnails when deleting exports
	if (folder === 'exports' && deletedCount > 0) {
		const thumbDir = join(CAMERA_BASE, folderName, THUMBS_DIR);
		for (const fileName of targets) {
			try {
				await unlink(join(thumbDir, thumbName(fileName)));
			} catch {
				// Thumbnail may not exist — ignore
			}
		}
	}

	return { deletedCount, freedBytes };
}

/**
 * Get PureRAW instructions for a specific shoot
 */
export function getPureRawInstructions(shootFolderName: string): PureRawInstructions {
	return {
		inputPath: `${CAMERA_HOST_BASE}/${shootFolderName}/${RAW_DIR}/`,
		outputPath: `${CAMERA_HOST_BASE}/${shootFolderName}/${DENOISED_DIR}/`,
		settings: PURERAW_SETTINGS
	};
}
