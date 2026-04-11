import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { rateFiles, updateRating, validateShootName, PhotopipeError } from '$lib/server/shoots.js';
import { z } from 'zod/v4';

const starRating = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);

const postSchema = z.object({
	ratings: z.array(z.object({ file: z.string().min(1), rating: starRating })).min(1)
});

const patchSchema = z.object({
	file: z.string().min(1),
	rating: starRating
});

export const POST: RequestHandler = async ({ params, request }) => {
	const shootName = decodeURIComponent(params.name);

	try {
		validateShootName(shootName);
	} catch {
		error(400, 'Invalid shoot name');
	}

	const parsed = postSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) {
		error(400, 'ratings must be a non-empty array of {file: string, rating: 1-5}');
	}

	try {
		const result = await rateFiles(shootName, parsed.data.ratings);
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

	const parsed = patchSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) {
		error(400, 'file must be a string, rating must be an integer 1-5');
	}

	try {
		await updateRating(shootName, parsed.data.file, parsed.data.rating);
		return json({ success: true });
	} catch (err) {
		if (err instanceof PhotopipeError) {
			error(err.status, err.message);
		}
		throw err;
	}
};
