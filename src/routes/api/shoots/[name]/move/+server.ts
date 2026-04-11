import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { moveFiles, validateShootName, PhotopipeError } from '$lib/server/shoots.js';

const VALID_FOLDERS = ['raw', 'denoised', 'rated', 'selects', 'exports'] as const;
type Folder = (typeof VALID_FOLDERS)[number];

function isValidFolder(v: unknown): v is Folder {
	return typeof v === 'string' && VALID_FOLDERS.includes(v as Folder);
}

export const POST: RequestHandler = async ({ params, request }) => {
	const shootName = decodeURIComponent(params.name);

	try {
		validateShootName(shootName);
	} catch {
		error(400, 'Invalid shoot name');
	}

	let body: { from?: unknown; to?: unknown; files?: unknown };
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON body');
	}

	if (!isValidFolder(body.from)) {
		error(400, `from must be one of: ${VALID_FOLDERS.join(', ')}`);
	}

	if (!isValidFolder(body.to)) {
		error(400, `to must be one of: ${VALID_FOLDERS.join(', ')}`);
	}

	if (body.from === body.to) {
		error(400, 'from and to must be different');
	}

	if (
		!Array.isArray(body.files) ||
		body.files.length === 0 ||
		body.files.some((f) => typeof f !== 'string')
	) {
		error(400, 'files must be a non-empty array of filenames');
	}

	try {
		const result = await moveFiles(shootName, body.from, body.to, body.files as string[]);
		return json(result);
	} catch (err) {
		if (err instanceof PhotopipeError) {
			error(err.status, err.message);
		}
		throw err;
	}
};
