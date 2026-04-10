import type { PageServerLoad } from './$types.js';
import { listShoots } from '$lib/server/shoots.js';

export const load: PageServerLoad = async () => {
	const shoots = await listShoots().catch((err: unknown) => {
		console.error('Failed to list shoots:', err instanceof Error ? err.message : err);
		return [];
	});
	return { shoots };
};
