import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { moveFiles, validateShootName, PhotopipeError } from '$lib/server/shoots.js';
import { z } from 'zod/v4';

const bodySchema = z
	.object({
		files: z.array(z.string().min(1)).min(1).optional(),
		minRating: z.int().min(1).max(5).optional()
	})
	.refine((d) => d.files || d.minRating, { message: 'Provide files or minRating' });

export const POST: RequestHandler = async ({ params, request }) => {
	const shootName = decodeURIComponent(params.name);

	try {
		validateShootName(shootName);
	} catch {
		error(400, 'Invalid shoot name');
	}

	const parsed = bodySchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) {
		error(400, parsed.error.issues[0]?.message ?? 'Invalid request body');
	}

	try {
		const result = await moveFiles(shootName, 'rated', 'selects', parsed.data.files ?? []);
		return json(result);
	} catch (err) {
		if (err instanceof PhotopipeError) {
			error(err.status, err.message);
		}
		throw err;
	}
};
