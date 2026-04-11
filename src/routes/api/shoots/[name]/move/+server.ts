import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { moveFiles, validateShootName, PhotopipeError } from '$lib/server/shoots.js';
import { z } from 'zod/v4';

const folder = z.enum(['raw', 'denoised', 'rated', 'selects', 'exports']);

const bodySchema = z
	.object({
		from: folder,
		to: folder,
		files: z.array(z.string().min(1)).min(1)
	})
	.refine((d) => d.from !== d.to, { message: 'from and to must be different' });

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
		const result = await moveFiles(shootName, parsed.data.from, parsed.data.to, parsed.data.files);
		return json(result);
	} catch (err) {
		if (err instanceof PhotopipeError) {
			error(err.status, err.message);
		}
		throw err;
	}
};
