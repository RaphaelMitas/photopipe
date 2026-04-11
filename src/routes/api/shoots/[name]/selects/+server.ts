import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { moveFiles, validateShootName, PhotopipeError } from '$lib/server/shoots.js';
import type { StarRating } from '$lib/types.js';

function isValidRating(v: unknown): v is StarRating {
	return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5;
}

export const POST: RequestHandler = async ({ params, request }) => {
	const shootName = decodeURIComponent(params.name);

	try {
		validateShootName(shootName);
	} catch {
		error(400, 'Invalid shoot name');
	}

	let body: { files?: unknown; minRating?: unknown };
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON body');
	}

	const files = body.files;
	if (files !== undefined) {
		if (!Array.isArray(files) || files.some((f) => typeof f !== 'string')) {
			error(400, 'files must be an array of filenames');
		}
	}

	const minRating = body.minRating;
	if (minRating !== undefined && !isValidRating(minRating)) {
		error(400, 'minRating must be an integer 1-5');
	}

	if (!files && !minRating) {
		error(400, 'Provide files or minRating');
	}

	try {
		const result = await moveFiles(
			shootName,
			'rated',
			'selects',
			files as string[]
		);
		return json(result);
	} catch (err) {
		if (err instanceof PhotopipeError) {
			error(err.status, err.message);
		}
		throw err;
	}
};
