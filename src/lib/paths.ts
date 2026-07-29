import 'server-only';
import { join } from 'node:path';
import { CAMERA_BASE, SHOOT_PATTERN, STAGE_DIRS, THUMBS_DIR, MANIFEST_NAME } from './config';
import type { PhysicalStage } from './config';
import { PhotopipeError } from './errors';

export function assertShootName(folderName: string): void {
	if (!folderName || typeof folderName !== 'string') {
		throw new PhotopipeError('Shoot name is required', 'INVALID_INPUT');
	}
	if (folderName.includes('..') || folderName.includes('/') || folderName.includes('\\')) {
		throw new PhotopipeError('Invalid characters in shoot name', 'INVALID_INPUT');
	}
	if (!SHOOT_PATTERN.test(folderName)) {
		throw new PhotopipeError('Shoot folder must match "YYYY-MM-DD_slug-name"', 'INVALID_INPUT');
	}
}

export function assertFileName(fileName: string): void {
	if (
		!fileName ||
		fileName.includes('..') ||
		fileName.includes('/') ||
		fileName.includes('\\') ||
		fileName.startsWith('.')
	) {
		throw new PhotopipeError('Invalid filename', 'INVALID_INPUT');
	}
}

export function shootPath(folderName: string): string {
	assertShootName(folderName);
	return join(CAMERA_BASE, folderName);
}

export function stagePath(folderName: string, stage: PhysicalStage): string {
	return join(shootPath(folderName), STAGE_DIRS[stage]);
}

export function filePath(folderName: string, stage: PhysicalStage, fileName: string): string {
	assertFileName(fileName);
	return join(stagePath(folderName, stage), fileName);
}

export function thumbsPath(folderName: string): string {
	return join(shootPath(folderName), THUMBS_DIR);
}

export function manifestPath(folderName: string): string {
	return join(shootPath(folderName), MANIFEST_NAME);
}
