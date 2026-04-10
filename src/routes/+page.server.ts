import type { PageServerLoad } from './$types.js';
import { listShoots } from '$lib/server/shoots.js';

export const load: PageServerLoad = async () => {
	const shoots = await listShoots().catch(() => []);
	return { shoots };
};
