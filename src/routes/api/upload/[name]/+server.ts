import type { RequestHandler } from './$types.js';
import { json, error } from '@sveltejs/kit';
import { writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { CAMERA_BASE, RAW_DIR, SHOOT_PATTERN } from '$lib/server/config.js';
import { validateShootName, updateMetadata } from '$lib/server/shoots.js';

/**
 * POST: Upload a single ARW file to a shoot's raw/ directory.
 * Client sends one file at a time and manages batching/parallelism.
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

	// Verify shoot exists
	const shootPath = join(CAMERA_BASE, shootName);
	try {
		await stat(shootPath);
	} catch {
		error(404, 'Shoot not found');
	}

	const formData = await request.formData();
	const file = formData.get('file') as File | null;

	if (!file || !(file instanceof File)) {
		error(400, 'No file provided');
	}

	// Validate file extension
	const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
	if (ext !== '.arw') {
		error(400, 'Only ARW files are accepted');
	}

	// Sanitize filename
	const safeName = file.name.replace(/[/\\:*?"<>|]/g, '_');
	if (safeName.includes('..')) {
		error(400, 'Invalid filename');
	}

	const destPath = join(CAMERA_BASE, shootName, RAW_DIR, safeName);

	// Write file to disk
	const buffer = Buffer.from(await file.arrayBuffer());
	await writeFile(destPath, buffer);

	return json({
		success: true,
		filename: safeName,
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

	// Count raw files
	const { readdir } = await import('node:fs/promises');
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
