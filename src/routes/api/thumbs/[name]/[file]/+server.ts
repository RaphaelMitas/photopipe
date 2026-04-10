import type { RequestHandler } from './$types.js';
import { error } from '@sveltejs/kit';
import { stat, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { CAMERA_BASE, SHOOT_PATTERN, THUMBS_DIR, EXPORTS_DIR } from '$lib/server/config.js';

/** In-flight generation guard to prevent duplicate work */
const inFlight = new Map<string, Promise<ArrayBuffer>>();

function validatePath(name: string): void {
	if (name.includes('..') || name.includes('/') || name.includes('\\')) {
		error(400, 'Invalid path');
	}
}

/** Strip original extension and add .webp */
function thumbName(fileName: string): string {
	const base = fileName.substring(0, fileName.lastIndexOf('.')) || fileName;
	return `${base}.webp`;
}

function webpResponse(data: ArrayBuffer, extra: Record<string, string> = {}): Response {
	return new Response(data, {
		headers: {
			'Content-Type': 'image/webp',
			'Cache-Control': 'public, max-age=86400',
			'Content-Length': data.byteLength.toString(),
			...extra
		}
	});
}

export const GET: RequestHandler = async ({ params }) => {
	const shootName = decodeURIComponent(params.name);
	const fileName = decodeURIComponent(params.file);

	validatePath(shootName);
	validatePath(fileName);

	if (!SHOOT_PATTERN.test(shootName)) {
		error(400, 'Invalid shoot name');
	}

	const sourcePath = join(CAMERA_BASE, shootName, EXPORTS_DIR, fileName);
	const thumbDir = join(CAMERA_BASE, shootName, THUMBS_DIR);
	const thumbPath = join(thumbDir, thumbName(fileName));

	// Check source exists
	let sourceInfo;
	try {
		sourceInfo = await stat(sourcePath);
	} catch {
		error(404, 'Source file not found');
	}

	// Check cache
	try {
		const thumbInfo = await stat(thumbPath);
		if (thumbInfo.mtime >= sourceInfo.mtime) {
			const buf = await readFile(thumbPath);
			return webpResponse(
				buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
				{
					ETag: `"${thumbInfo.mtime.getTime()}"`
				}
			);
		}
	} catch {
		// Cache miss
	}

	// Generate (with dedup guard)
	const cacheKey = `${shootName}/${fileName}`;
	let pending = inFlight.get(cacheKey);

	if (!pending) {
		pending = generateThumbnail(sourcePath, thumbDir, thumbPath);
		inFlight.set(cacheKey, pending);
		pending.finally(() => inFlight.delete(cacheKey));
	}

	try {
		const data = await pending;
		return webpResponse(data);
	} catch {
		error(500, 'Failed to generate thumbnail');
	}
};

async function generateThumbnail(
	sourcePath: string,
	thumbDir: string,
	thumbPath: string
): Promise<ArrayBuffer> {
	await mkdir(thumbDir, { recursive: true });

	const buf = await sharp(sourcePath)
		.resize(400, 400, { fit: 'inside', withoutEnlargement: true })
		.webp({ quality: 80 })
		.toBuffer();

	// Write cache in background
	sharp(buf)
		.toFile(thumbPath)
		.catch(() => {});

	return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}
