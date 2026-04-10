import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { deleteShoot, validateShootName, PhotopipeError } from '$lib/server/shoots.js';

export const DELETE: RequestHandler = async ({ params }) => {
	const shootName = decodeURIComponent(params.name);

	try {
		validateShootName(shootName);
	} catch {
		error(400, 'Invalid shoot name');
	}

	try {
		await deleteShoot(shootName);
		return json({ success: true });
	} catch (err) {
		if (err instanceof PhotopipeError) {
			error(err.status, err.message);
		}
		throw err;
	}
};
