import type { RequestHandler } from './$types.js';
import { error } from '@sveltejs/kit';
import { stat, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import {
	CAMERA_BASE,
	SHOOT_PATTERN,
	THUMBS_DIR,
	EXPORTS_DIR,
	DENOISED_DIR,
	RATED_DIR,
	SELECTS_DIR
} from '$lib/server/config.js';
import { getDngImage } from '$lib/server/dng-preview.js';

const inFlight = new Map<string, Promise<ArrayBuffer>>();

const FOLDER_MAP: Record<string, string> = {
	exports: EXPORTS_DIR,
	denoised: DENOISED_DIR,
	rated: RATED_DIR,
	selects: SELECTS_DIR
};

function validatePath(name: string): void {
	if (name.includes('..') || name.includes('/') || name.includes('\\')) {
		error(400, 'Invalid path');
	}
}

function thumbName(folder: string, fileName: string): string {
	const base = fileName.substring(0, fileName.lastIndexOf('.')) || fileName;
	if (folder === 'exports') return `${base}.webp`;
	return `${folder}_${base}.webp`;
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

export const GET: RequestHandler = async ({ params, url }) => {
	const shootName = decodeURIComponent(params.name);
	const fileName = decodeURIComponent(params.file);

	validatePath(shootName);
	validatePath(fileName);

	if (!SHOOT_PATTERN.test(shootName)) {
		error(400, 'Invalid shoot name');
	}

	const folder = url.searchParams.get('folder') ?? 'exports';
	const size = url.searchParams.get('size') ?? 'thumb';

	if (!(folder in FOLDER_MAP)) {
		error(400, 'Invalid folder parameter');
	}

	if (size !== 'thumb' && size !== 'preview') {
		error(400, 'Size must be "thumb" or "preview"');
	}

	const dirName = FOLDER_MAP[folder];

	if (folder !== 'exports' || size === 'preview') {
		try {
			const result = await getDngImage(shootName, dirName, fileName, size);
			return webpResponse(result.data);
		} catch {
			error(404, 'Source file not found');
		}
	}

	const sourcePath = join(CAMERA_BASE, shootName, dirName, fileName);
	const thumbDir = join(CAMERA_BASE, shootName, THUMBS_DIR);
	const thumbPath = join(thumbDir, thumbName(folder, fileName));

	let sourceInfo;
	try {
		sourceInfo = await stat(sourcePath);
	} catch {
		error(404, 'Source file not found');
	}

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

	const cacheKey = `${shootName}/${folder}/${fileName}`;
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

	sharp(buf)
		.toFile(thumbPath)
		.catch((err: unknown) => {
			console.warn(
				`Thumbnail cache write failed for ${thumbPath}:`,
				err instanceof Error ? err.message : err
			);
		});

	return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}
