import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { writeFile, stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { CAMERA_BASE, RAW_DIR, DENOISED_DIR, EXPORTS_DIR, SHOOT_PATTERN } from '$lib/server/config.js';
import { validateShootName, updateMetadata } from '$lib/server/shoots.js';

const FOLDER_MAP: Record<string, string> = {
	raw: RAW_DIR,
	denoised: DENOISED_DIR,
	exports: EXPORTS_DIR
};

const ALLOWED_EXTENSIONS: Record<string, string[]> = {
	raw: ['.arw'],
	denoised: ['.dng'],
	exports: ['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp', '.dng']
};

/**
 * POST: Upload a single file to a shoot's folder.
 * Accepts a `folder` form field: raw (default), denoised, exports.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const shootName = decodeURIComponent(params.name);

	try {
		validateShootName(shootName);
	} catch {
		error(400, 'Invalid shoot name');
	}

	if (!SHOOT_PATTERN.test(shootName)) {
		error(400, 'Invalid shoot name format');
	}

	const shootPath = join(CAMERA_BASE, shootName);
	try {
		await stat(shootPath);
	} catch {
		error(404, 'Shoot not found');
	}

	const formData = await request.formData();
	const file = formData.get('file') as File | null;
	const folderParam = (formData.get('folder') as string) || 'raw';

	if (!file || !(file instanceof File)) {
		error(400, 'No file provided');
	}

	// Validate folder
	if (!(folderParam in FOLDER_MAP)) {
		error(400, `Invalid folder: ${folderParam}. Must be one of: raw, denoised, exports`);
	}

	// Validate file extension for target folder
	const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
	const allowed = ALLOWED_EXTENSIONS[folderParam];
	if (!allowed.includes(ext)) {
		error(400, `${ext} files are not accepted in ${folderParam}/. Allowed: ${allowed.join(', ')}`);
	}

	// Sanitize filename
	const safeName = file.name.replace(/[/\\:*?"<>|]/g, '_');
	if (safeName.includes('..')) {
		error(400, 'Invalid filename');
	}

	const targetDir = FOLDER_MAP[folderParam];
	const destPath = join(CAMERA_BASE, shootName, targetDir, safeName);

	const buffer = Buffer.from(await file.arrayBuffer());
	await writeFile(destPath, buffer);

	return json({
		success: true,
		filename: safeName,
		folder: folderParam,
		size: buffer.byteLength
	});
};

/**
 * PATCH: Finalize upload — update rawCount in metadata
 */
export const PATCH: RequestHandler = async ({ params }) => {
	const shootName = decodeURIComponent(params.name);

	try {
		validateShootName(shootName);
	} catch {
		error(400, 'Invalid shoot name');
	}

	const rawPath = join(CAMERA_BASE, shootName, RAW_DIR);
	let rawCount = 0;
	try {
		const entries = await readdir(rawPath);
		rawCount = entries.filter((f) => f.toLowerCase().endsWith('.arw')).length;
	} catch {
		// raw/ might not exist
	}

	const metadata = await updateMetadata(shootName, { rawCount });

	return json({ success: true, rawCount, metadata });
};
