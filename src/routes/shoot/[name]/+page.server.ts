import type { PageServerLoad, Actions } from './$types.js';
import { error, fail } from '@sveltejs/kit';
import {
	getShoot,
	updateMetadata,
	getPureRawInstructions,
	PhotopipeError
} from '$lib/server/shoots.js';

import type { DenoiseAlgorithm } from '$lib/types.js';

const VALID_ALGORITHMS: ReadonlySet<string> = new Set(['DeepPRIME 3', 'DeepPRIME XD3']);

function parseAlgorithm(value: string): DenoiseAlgorithm | null {
	return VALID_ALGORITHMS.has(value) ? (value as DenoiseAlgorithm) : null;
}

export const load: PageServerLoad = async ({ params }) => {
	const folderName = decodeURIComponent(params.name);

	try {
		const shoot = await getShoot(folderName);
		const instructions = shoot.rawCount > 0 ? getPureRawInstructions(folderName) : null;

		return { shoot, instructions };
	} catch (err) {
		if (err instanceof PhotopipeError) {
			error(err.status, err.message);
		}
		throw err;
	}
};

export const actions: Actions = {
	updateMeta: async ({ request, params }) => {
		const folderName = decodeURIComponent(params.name);
		const formData = await request.formData();

		const algorithm = parseAlgorithm(String(formData.get('algorithm') ?? ''));
		const notes = String(formData.get('notes') ?? '');

		try {
			await updateMetadata(folderName, {
				algorithm,
				notes
			});
			return { success: true };
		} catch (err) {
			if (err instanceof PhotopipeError) {
				return fail(err.status, { error: err.message });
			}
			throw err;
		}
	}
};
