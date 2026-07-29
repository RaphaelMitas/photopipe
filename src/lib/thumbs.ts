import 'server-only';
import { mkdir, readFile, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import type { PhysicalStage } from './config';
import { PhotopipeError } from './errors';
import { filePath, thumbsPath } from './paths';
import { extractEmbeddedPreview, readOrientationAngle } from './xmp';
import { fileExtension, stripExtension } from './utils';

export type ThumbSize = 'thumb' | 'preview';

const DIMENSIONS: Record<ThumbSize, { edge: number; quality: number }> = {
	thumb: { edge: 600, quality: 80 },
	preview: { edge: 2560, quality: 85 }
};

/** Formats Sharp cannot decode directly — the embedded JPEG is used instead. */
const NEEDS_EXTRACTION = new Set(['.dng', '.arw']);

const inFlight = new Map<string, Promise<Buffer>>();

function cacheName(stage: PhysicalStage, fileName: string, size: ThumbSize): string {
	const suffix = size === 'preview' ? '_preview' : '';
	return `${stage}_${stripExtension(fileName)}${suffix}.webp`;
}

function cachePath(folderName: string, stage: PhysicalStage, file: string, size: ThumbSize) {
	return join(thumbsPath(folderName), cacheName(stage, file, size));
}

async function render(sourcePath: string, size: ThumbSize): Promise<Buffer> {
	const { edge, quality } = DIMENSIONS[size];
	const ext = fileExtension(sourcePath);

	let input: Buffer | string = sourcePath;
	let explicitAngle = 0;

	if (NEEDS_EXTRACTION.has(ext)) {
		const embedded = await extractEmbeddedPreview(sourcePath);
		if (!embedded) {
			throw new PhotopipeError(`No embedded preview in ${sourcePath}`, 'FS_ERROR');
		}
		input = embedded;
		// The extracted JPEG usually lacks the container's orientation tag, so
		// carry it over unless the JPEG already declares its own.
		const meta = await sharp(embedded).metadata();
		if (!meta.orientation) explicitAngle = await readOrientationAngle(sourcePath);
	}

	const pipeline = sharp(input);
	if (explicitAngle > 0) pipeline.rotate(explicitAngle);
	else pipeline.rotate();

	return pipeline
		.resize(edge, edge, { fit: 'inside', withoutEnlargement: true })
		.webp({ quality })
		.toBuffer();
}

export async function getThumb(
	folderName: string,
	stage: PhysicalStage,
	fileName: string,
	size: ThumbSize
): Promise<{ data: Buffer; cached: boolean }> {
	const sourcePath = filePath(folderName, stage, fileName);
	const target = cachePath(folderName, stage, fileName, size);

	const sourceInfo = await stat(sourcePath).catch(() => null);
	if (!sourceInfo) throw new PhotopipeError('Source file not found', 'NOT_FOUND');

	const cacheInfo = await stat(target).catch(() => null);
	if (cacheInfo && cacheInfo.mtimeMs >= sourceInfo.mtimeMs) {
		return { data: await readFile(target), cached: true };
	}

	const key = `${folderName}/${stage}/${fileName}/${size}`;
	let pending = inFlight.get(key);

	if (!pending) {
		pending = (async () => {
			const buf = await render(sourcePath, size);
			await mkdir(thumbsPath(folderName), { recursive: true });
			await writeFile(target, buf).catch((err: unknown) => {
				console.warn(`Thumb cache write failed for ${target}:`, err);
			});
			return buf;
		})();
		inFlight.set(key, pending);
		pending.finally(() => inFlight.delete(key)).catch(() => {});
	}

	return { data: await pending, cached: false };
}

/**
 * Writing XMP rewrites the image and bumps its mtime, which would otherwise
 * invalidate a perfectly good thumbnail. The pixels did not change, so the
 * cached renders are simply marked fresh again.
 */
export async function touchThumbs(
	folderName: string,
	stage: PhysicalStage,
	fileName: string
): Promise<void> {
	const now = new Date();
	await Promise.all(
		(['thumb', 'preview'] as const).map((size) =>
			utimes(cachePath(folderName, stage, fileName, size), now, now).catch(() => {})
		)
	);
}
