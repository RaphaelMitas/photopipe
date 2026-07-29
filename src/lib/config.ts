import { resolve } from 'node:path';

function required(key: string): string {
	const value = process.env[key];
	if (!value) throw new Error(`Missing required environment variable: ${key}`);
	return value;
}

/** Absolute path to the camera folder holding every shoot directory. */
export const CAMERA_BASE = resolve(required('CAMERA_BASE'));

/** Host-side path shown in the PureRAW instructions card. Display only. */
export const CAMERA_HOST_BASE = process.env.CAMERA_HOST_BASE ?? '~/pictures/Camera';

/** Location of the disposable SQLite index. */
export const DB_PATH = resolve(process.env.PHOTOPIPE_DB ?? './data/index.db');

/** Shoot folder names: YYYY-MM-DD_slug-name */
export const SHOOT_PATTERN = /^\d{4}-\d{2}-\d{2}_[a-z0-9][a-z0-9-]*$/;

/**
 * Physical stages. `rated` and `selects` are not directories in v2 — they are
 * queries over `denoised` (see STAGE_QUERIES).
 */
export const STAGE_DIRS = {
	raw: 'raw',
	denoised: 'denoised',
	exports: 'exports'
} as const;

export const THUMBS_DIR = '.thumbs';
export const MANIFEST_NAME = '.photopipe.json';

export const RAW_EXTENSIONS = ['.arw'];
export const DENOISED_EXTENSIONS = ['.dng'];
export const EXPORT_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp', '.dng'];

export const STAGE_EXTENSIONS: Record<PhysicalStage, readonly string[]> = {
	raw: RAW_EXTENSIONS,
	denoised: DENOISED_EXTENSIONS,
	exports: EXPORT_EXTENSIONS
};

export type PhysicalStage = keyof typeof STAGE_DIRS;

/** Sync engine tuning. */
export const SCAN_DEBOUNCE_MS = 1200;
export const FULL_SCAN_INTERVAL_MS = 5 * 60 * 1000;
/** A file must hold the same size across two observations before it is indexed. */
export const STABILITY_RECHECK_MS = 2000;
export const SSE_HEARTBEAT_MS = 25_000;
