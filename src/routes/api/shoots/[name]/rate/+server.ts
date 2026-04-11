import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import {
	rateFiles,
	updateRating,
	validateShootName,
	PhotopipeError
} from '$lib/server/shoots.js';
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

	let body: { ratings?: unknown };
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON body');
	}

	if (!Array.isArray(body.ratings) || body.ratings.length === 0) {
		error(400, 'ratings must be a non-empty array of {file, rating}');
	}

	for (const entry of body.ratings) {
		if (typeof entry !== 'object' || !entry) error(400, 'Invalid rating entry');
		if (typeof entry.file !== 'string' || !entry.file) error(400, 'file must be a string');
		if (!isValidRating(entry.rating)) error(400, 'rating must be an integer 1-5');
	}

	try {
		const result = await rateFiles(
			shootName,
			body.ratings as Array<{ file: string; rating: StarRating }>
		);
		return json(result);
	} catch (err) {
		if (err instanceof PhotopipeError) {
			error(err.status, err.message);
		}
		throw err;
	}
};

export const PATCH: RequestHandler = async ({ params, request }) => {
	const shootName = decodeURIComponent(params.name);

	try {
		validateShootName(shootName);
	} catch {
		error(400, 'Invalid shoot name');
	}

	let body: { file?: unknown; rating?: unknown };
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON body');
	}

	if (typeof body.file !== 'string' || !body.file) {
		error(400, 'file must be a string');
	}

	if (!isValidRating(body.rating)) {
		error(400, 'rating must be an integer 1-5');
	}

	try {
		await updateRating(shootName, body.file, body.rating);
		return json({ success: true });
	} catch (err) {
		if (err instanceof PhotopipeError) {
			error(err.status, err.message);
		}
		throw err;
	}
};
