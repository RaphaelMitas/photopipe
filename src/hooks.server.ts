import type { Handle } from '@sveltejs/kit';
import { runMigrationIfNeeded } from '$lib/server/migrate.js';

export const handle: Handle = async ({ event, resolve }) => {
	await runMigrationIfNeeded();
	return resolve(event);
};
