import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { deleteFiles, validateShootName, PhotopipeError } from '$lib/server/shoots.js';

const VALID_FOLDERS = ['exports', 'denoised', 'raw', 'rated', 'selects'] as const;

export const DELETE: RequestHandler = async ({ params, request }) => {
	const shootName = decodeURIComponent(params.name);

	try {
		validateShootName(shootName);
	} catch {
		error(400, 'Invalid shoot name');
	}

	let body: { folder?: string; files?: string[] };
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON body');
	}

	const folder = body.folder;
	if (!folder || !VALID_FOLDERS.includes(folder as (typeof VALID_FOLDERS)[number])) {
		error(400, 'folder must be "exports", "denoised", "raw", "rated", or "selects"');
	}

	const files = body.files;
	if (files !== undefined && (!Array.isArray(files) || files.some((f) => typeof f !== 'string'))) {
		error(400, 'files must be an array of filenames');
	}

	try {
		const result = await deleteFiles(
			shootName,
			folder as 'exports' | 'denoised' | 'raw' | 'rated' | 'selects',
			files
		);
		return json(result);
	} catch (err) {
		if (err instanceof PhotopipeError) {
			error(err.status, err.message);
		}
		throw err;
	}
};
