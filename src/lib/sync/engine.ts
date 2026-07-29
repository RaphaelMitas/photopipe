import 'server-only';
import { relative, sep } from 'node:path';
import { mkdir } from 'node:fs/promises';
import chokidar, { type FSWatcher } from 'chokidar';
import {
	CAMERA_BASE,
	SHOOT_PATTERN,
	STAGE_DIRS,
	SCAN_DEBOUNCE_MS,
	FULL_SCAN_INTERVAL_MS,
	MANIFEST_NAME,
	THUMBS_DIR,
	type PhysicalStage
} from '../config';
import { fullScan, reconcileShoot } from './reconciler';

const DIR_TO_STAGE = new Map<string, PhysicalStage>(
	Object.entries(STAGE_DIRS).map(([stage, dir]) => [dir, stage as PhysicalStage])
);

interface EngineState {
	watcher?: FSWatcher;
	timer?: NodeJS.Timeout;
	interval?: NodeJS.Timeout;
	dirty: Map<string, Set<PhysicalStage>>;
	draining: boolean;
	started: boolean;
}

const globalForEngine = globalThis as unknown as { photopipeEngine?: EngineState };

const state: EngineState = globalForEngine.photopipeEngine ?? {
	dirty: new Map(),
	draining: false,
	started: false
};

globalForEngine.photopipeEngine = state;

/**
 * Maps a changed path to the shoot and stage it belongs to. Anything outside a
 * recognised shoot folder (or inside the thumbnail cache) is ignored.
 */
function classify(absPath: string): { folderName: string; stage: PhysicalStage | null } | null {
	const rel = relative(CAMERA_BASE, absPath);
	if (!rel || rel.startsWith('..')) return null;

	const parts = rel.split(sep);
	const folderName = parts[0];
	if (!folderName || !SHOOT_PATTERN.test(folderName)) return null;
	if (parts.includes(THUMBS_DIR)) return null;

	if (parts.length === 2 && parts[1] === MANIFEST_NAME) return { folderName, stage: null };

	const dir = parts[1];
	const stage = dir ? (DIR_TO_STAGE.get(dir) ?? null) : null;
	if (parts.length > 1 && !stage) return null;

	return { folderName, stage };
}

function markDirty(folderName: string, stage: PhysicalStage | null): void {
	const stages = state.dirty.get(folderName) ?? new Set<PhysicalStage>();
	if (stage) stages.add(stage);
	state.dirty.set(folderName, stages);
	scheduleDrain();
}

function scheduleDrain(): void {
	clearTimeout(state.timer);
	state.timer = setTimeout(drain, SCAN_DEBOUNCE_MS);
}

/**
 * Reconciles everything marked dirty. Bulk output from PureRAW therefore costs
 * one scan of one stage rather than one scan per file.
 */
async function drain(): Promise<void> {
	if (state.draining) {
		scheduleDrain();
		return;
	}
	state.draining = true;
	try {
		while (state.dirty.size > 0) {
			const batch = state.dirty;
			state.dirty = new Map();
			for (const [folderName, stages] of batch) {
				try {
					await reconcileShoot(folderName, stages.size > 0 ? [...stages] : undefined);
				} catch (err) {
					console.error(`Reconcile failed for ${folderName}:`, err);
				}
			}
		}
	} finally {
		state.draining = false;
	}
}

/** Reconciles a shoot immediately — used by mutations so the UI never lags its own writes. */
export async function syncNow(folderName: string, stages?: PhysicalStage[]): Promise<void> {
	await reconcileShoot(folderName, stages);
}

export function markShootDirty(folderName: string, stage?: PhysicalStage): void {
	markDirty(folderName, stage ?? null);
}

export async function startSyncEngine(): Promise<void> {
	if (state.started) return;
	state.started = true;

	await mkdir(CAMERA_BASE, { recursive: true });

	console.log(`[sync] indexing ${CAMERA_BASE}`);
	await fullScan();

	const watcher = chokidar.watch(CAMERA_BASE, {
		ignoreInitial: true,
		depth: 2,
		awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 200 },
		ignored: (path: string) => path.includes(`${sep}${THUMBS_DIR}`)
	});

	for (const event of ['add', 'change', 'unlink', 'addDir', 'unlinkDir'] as const) {
		watcher.on(event, (path: string) => {
			const hit = classify(path);
			if (hit) markDirty(hit.folderName, hit.stage);
		});
	}

	watcher.on('error', (err) => console.error('[sync] watcher error:', err));

	state.watcher = watcher;
	state.interval = setInterval(() => {
		fullScan().catch((err) => console.error('[sync] periodic scan failed:', err));
	}, FULL_SCAN_INTERVAL_MS);

	console.log('[sync] watching for changes');
}

export async function stopSyncEngine(): Promise<void> {
	clearTimeout(state.timer);
	clearInterval(state.interval);
	await state.watcher?.close();
	state.watcher = undefined;
	state.started = false;
}
