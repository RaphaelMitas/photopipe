import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { createShoot, PhotopipeError } from '$lib/server/shoots.js';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { name, date } = body;

	if (!name || typeof name !== 'string' || !name.trim()) {
		error(400, 'Shoot name is required');
	}

	if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
		error(400, 'Valid date (YYYY-MM-DD) is required');
	}

	try {
		const folderName = await createShoot(name.trim(), date);
		return json({ success: true, folderName });
	} catch (err) {
		if (err instanceof PhotopipeError) {
			error(err.status, err.message);
		}
		throw err;
	}
};
