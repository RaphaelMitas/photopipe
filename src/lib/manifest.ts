import 'server-only';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { manifestPath } from './paths';
import { parseShootFolder } from './utils';
import type { DenoiseAlgorithm, ShootManifest } from './types';

const ALGORITHMS: readonly string[] = ['DeepPRIME 3', 'DeepPRIME XD3'];

function parseAlgorithm(value: unknown): DenoiseAlgorithm | null {
	return typeof value === 'string' && ALGORITHMS.includes(value)
		? (value as DenoiseAlgorithm)
		: null;
}

function defaults(folderName: string): ShootManifest {
	const parsed = parseShootFolder(folderName);
	return {
		version: 2,
		name: parsed?.name ?? folderName,
		date: parsed?.date ?? '',
		createdAt: new Date().toISOString(),
		algorithm: null,
		notes: '',
		rawCount: null
	};
}

/**
 * Shoot-level metadata that has no image to live in. Ratings are never stored
 * here — those belong to the files themselves.
 *
 * v1 manifests (which carried a `ratings` map) are read for their shoot fields;
 * the ratings are migrated into the files by scripts/migrate-v1.mjs.
 */
export async function readManifest(folderName: string): Promise<ShootManifest> {
	const fallback = defaults(folderName);
	try {
		const raw = await readFile(manifestPath(folderName), 'utf8');
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object') return fallback;
		const m = parsed as Record<string, unknown>;
		return {
			version: 2,
			name: typeof m.name === 'string' && m.name ? m.name : fallback.name,
			date: typeof m.date === 'string' && m.date ? m.date : fallback.date,
			createdAt: typeof m.createdAt === 'string' ? m.createdAt : fallback.createdAt,
			algorithm: parseAlgorithm(m.algorithm),
			notes: typeof m.notes === 'string' ? m.notes : '',
			rawCount: typeof m.rawCount === 'number' ? m.rawCount : null
		};
	} catch {
		return fallback;
	}
}

/** Atomic write so a crash mid-write cannot truncate the manifest. */
export async function writeManifest(
	folderName: string,
	manifest: ShootManifest
): Promise<ShootManifest> {
	const target = manifestPath(folderName);
	const tmp = `${target}.tmp`;
	await writeFile(tmp, `${JSON.stringify(manifest, null, '\t')}\n`, 'utf8');
	await rename(tmp, target);
	return manifest;
}

export async function updateManifest(
	folderName: string,
	updates: Partial<Pick<ShootManifest, 'name' | 'algorithm' | 'notes' | 'rawCount'>>
): Promise<ShootManifest> {
	const current = await readManifest(folderName);
	return writeManifest(folderName, { ...current, ...updates });
}
