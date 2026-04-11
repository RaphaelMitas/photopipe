import { env } from '$env/dynamic/private';
import { resolve } from 'node:path';

function getEnvOrThrow(key: string): string {
	const value = env[key];
	if (!value) {
		throw new Error(`Missing required environment variable: ${key}`);
	}
	return value;
}

/** Absolute path to the camera folder (inside container or local dev) */
export const CAMERA_BASE = resolve(getEnvOrThrow('CAMERA_BASE'));

/** Host-side path for display in PureRAW instructions (not used for file ops) */
export const CAMERA_HOST_BASE = env.CAMERA_HOST_BASE ?? '~/pictures/Camera';

/** Regex to match valid shoot folder names: YYYY-MM-DD_slug-name */
export const SHOOT_PATTERN = /^\d{4}-\d{2}-\d{2}_[a-z0-9][a-z0-9-]*$/;

/** Metadata filename stored in each shoot folder */
export const METADATA_FILE = '.photopipe.json';

/** Thumbnail cache directory name inside each shoot */
export const THUMBS_DIR = '.thumbs';

/** Subdirectory names inside each shoot */
export const RAW_DIR = 'raw';
export const DENOISED_DIR = 'denoised';
export const RATED_DIR = 'rated';
export const SELECTS_DIR = 'selects';
export const EXPORTS_DIR = 'exports';
