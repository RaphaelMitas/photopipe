import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { deleteFiles, validateShootName, PhotopipeError } from '$lib/server/shoots.js';
import { z } from 'zod/v4';

const bodySchema = z.object({
	folder: z.enum(['exports', 'denoised', 'raw', 'rated', 'selects']),
	files: z.array(z.string().min(1)).optional()
});

export const DELETE: RequestHandler = async ({ params, request }) => {
	const shootName = decodeURIComponent(params.name);

	try {
		validateShootName(shootName);
	} catch {
		error(400, 'Invalid shoot name');
	}

	const parsed = bodySchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) {
		error(400, 'folder must be "exports", "denoised", "raw", "rated", or "selects"');
	}

	try {
		const result = await deleteFiles(shootName, parsed.data.folder, parsed.data.files);
		return json(result);
	} catch (err) {
		if (err instanceof PhotopipeError) {
			error(err.status, err.message);
		}
		throw err;
	}
};
