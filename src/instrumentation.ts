export async function register() {
	if (process.env.NEXT_RUNTIME !== 'nodejs') return;

	const { startSyncEngine } = await import('./lib/sync/engine');
	await startSyncEngine();
}
