import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { cleanupRaw, validateShootName } from '$lib/server/shoots.js';

export const DELETE: RequestHandler = async ({ params }) => {
	const shootName = decodeURIComponent(params.name);

	try {
		validateShootName(shootName);
	} catch {
		error(400, 'Invalid shoot name');
	}

	const result = await cleanupRaw(shootName);
	return json(result);
};
