import type { Actions } from './$types.js';
import { fail } from '@sveltejs/kit';
import { createShoot, PhotopipeError } from '$lib/server/shoots.js';

export const actions: Actions = {
	default: async ({ request }) => {
		const formData = await request.formData();
		const name = String(formData.get('name') ?? '').trim();
		const date = String(formData.get('date') ?? '');

		if (!name) {
			return fail(400, { error: 'Shoot name is required', name, date });
		}

		if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
			return fail(400, { error: 'Valid date is required', name, date });
		}

		try {
			const folderName = await createShoot(name, date);
			return { success: true, folderName };
		} catch (err) {
			if (err instanceof PhotopipeError) {
				return fail(err.status, { error: err.message, name, date });
			}
			throw err;
		}
	}
};
