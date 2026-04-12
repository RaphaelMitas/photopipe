import { stat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { CAMERA_BASE, THUMBS_DIR } from './config.js';

const PREVIEW_WIDTH = 2560;
const PREVIEW_QUALITY = 85;

const inFlight = new Map<string, Promise<ArrayBuffer>>();

function previewCacheName(folder: string, fileName: string): string {
	const base = fileName.substring(0, fileName.lastIndexOf('.')) || fileName;
	return `${folder}_${base}_preview.webp`;
}

function thumbCacheName(folder: string, fileName: string): string {
	const base = fileName.substring(0, fileName.lastIndexOf('.')) || fileName;
	return `${folder}_${base}.webp`;
}

function isJpegMarker(byte: number): boolean {
	return (
		(byte >= 0xc0 && byte <= 0xcf) ||
		(byte >= 0xd0 && byte <= 0xd7) ||
		(byte >= 0xda && byte <= 0xdf) ||
		(byte >= 0xe0 && byte <= 0xef) ||
		byte === 0xdb ||
		byte === 0xfe
	);
}

async function extractEmbeddedJpeg(filePath: string): Promise<Buffer | null> {
	const buf = await readFile(filePath);

	const candidates: { offset: number; length: number }[] = [];

	for (let i = 0; i < buf.length - 3; i++) {
		if (buf[i] !== 0xff || buf[i + 1] !== 0xd8) continue;
		if (!isJpegMarker(buf[i + 3])) continue;

		for (let j = i + 2; j < buf.length - 1; j++) {
			if (buf[j] === 0xff && buf[j + 1] === 0xd9) {
				const length = j - i + 2;
				if (length > 50000) {
					candidates.push({ offset: i, length });
				}
				break;
			}
		}
	}

	if (candidates.length === 0) return null;

	candidates.sort((a, b) => b.length - a.length);

	for (const candidate of candidates) {
		const jpegBuf = buf.subarray(candidate.offset, candidate.offset + candidate.length);
		try {
			const meta = await sharp(jpegBuf).metadata();
			if (meta.width && meta.width > 500) return jpegBuf;
		} catch {
			// Not a valid JPEG — try next candidate
		}
	}

	return null;
}

function bufToArrayBuffer(buf: Buffer): ArrayBuffer {
	return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function orientationToAngle(orientation: number | undefined): number {
	switch (orientation) {
		case 6:
			return 90;
		case 3:
			return 180;
		case 8:
			return 270;
		default:
			return 0;
	}
}

async function getSourceOrientation(sourcePath: string): Promise<number> {
	try {
		const meta = await sharp(sourcePath).metadata();
		return orientationToAngle(meta.orientation);
	} catch {
		return 0;
	}
}

async function generatePreview(
	sourcePath: string,
	thumbDir: string,
	cachePath: string
): Promise<ArrayBuffer> {
	await mkdir(thumbDir, { recursive: true });

	const jpeg = await extractEmbeddedJpeg(sourcePath);
	const input = jpeg ?? sourcePath;
	const angle = jpeg ? await getSourceOrientation(sourcePath) : 0;

	const pipeline = sharp(input);
	if (angle > 0) {
		pipeline.rotate(angle);
	} else {
		pipeline.rotate();
	}

	const buf = await pipeline
		.resize(PREVIEW_WIDTH, null, { fit: 'inside', withoutEnlargement: true })
		.webp({ quality: PREVIEW_QUALITY })
		.toBuffer();

	writeFile(cachePath, buf).catch((err: unknown) => {
		console.warn(
			`Preview cache write failed for ${cachePath}:`,
			err instanceof Error ? err.message : err
		);
	});

	return bufToArrayBuffer(buf);
}

async function generateThumb(
	sourcePath: string,
	thumbDir: string,
	cachePath: string
): Promise<ArrayBuffer> {
	await mkdir(thumbDir, { recursive: true });

	const jpeg = await extractEmbeddedJpeg(sourcePath);
	const input = jpeg ?? sourcePath;
	const angle = jpeg ? await getSourceOrientation(sourcePath) : 0;

	const pipeline = sharp(input);
	if (angle > 0) {
		pipeline.rotate(angle);
	} else {
		pipeline.rotate();
	}

	const buf = await pipeline
		.resize(600, 600, { fit: 'inside', withoutEnlargement: true })
		.webp({ quality: 80 })
		.toBuffer();

	writeFile(cachePath, buf).catch((err: unknown) => {
		console.warn(
			`Thumb cache write failed for ${cachePath}:`,
			err instanceof Error ? err.message : err
		);
	});

	return bufToArrayBuffer(buf);
}

export async function getDngImage(
	shootName: string,
	folder: string,
	fileName: string,
	size: 'thumb' | 'preview'
): Promise<{ data: ArrayBuffer; cached: boolean }> {
	const sourcePath = join(CAMERA_BASE, shootName, folder, fileName);
	const thumbDir = join(CAMERA_BASE, shootName, THUMBS_DIR);
	const cacheName =
		size === 'preview' ? previewCacheName(folder, fileName) : thumbCacheName(folder, fileName);
	const cachePath = join(thumbDir, cacheName);

	let sourceInfo;
	try {
		sourceInfo = await stat(sourcePath);
	} catch {
		throw new Error('Source file not found');
	}

	try {
		const cacheInfo = await stat(cachePath);
		if (cacheInfo.mtime >= sourceInfo.mtime) {
			const buf = await readFile(cachePath);
			return {
				data: bufToArrayBuffer(buf),
				cached: true
			};
		}
	} catch {
		// Cache miss
	}

	const cacheKey = `${shootName}/${folder}/${fileName}/${size}`;
	let pending = inFlight.get(cacheKey);

	if (!pending) {
		pending =
			size === 'preview'
				? generatePreview(sourcePath, thumbDir, cachePath)
				: generateThumb(sourcePath, thumbDir, cachePath);
		inFlight.set(cacheKey, pending);
		pending.finally(() => inFlight.delete(cacheKey));
	}

	const data = await pending;
	return { data, cached: false };
}
