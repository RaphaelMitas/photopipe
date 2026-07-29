#!/usr/bin/env node
/**
 * Migrates a v1 shoot tree to the v2 layout.
 *
 *   - ratings from .photopipe.json (or a Convex export) are stamped into the
 *     files as xmp:Rating
 *   - everything in rated/ and selects/ moves back into denoised/
 *   - files that were in selects/ additionally get xmp:Label='Select'
 *   - the emptied rated/ and selects/ directories are removed
 *   - the manifest is rewritten at version 2 without its ratings map
 *
 * Usage:
 *   node scripts/migrate-v1.mjs <camera-base> [--dry-run]
 */
import { readdir, stat, readFile, writeFile, rename, rmdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { exiftool } from 'exiftool-vendored';

const [, , baseArg, ...flags] = process.argv;
const DRY = flags.includes('--dry-run');

if (!baseArg) {
	console.error('Usage: node scripts/migrate-v1.mjs <camera-base> [--dry-run]');
	process.exit(1);
}

const SHOOT_PATTERN = /^\d{4}-\d{2}-\d{2}_[a-z0-9][a-z0-9-]*$/;
const base = baseArg;

async function exists(p) {
	return stat(p).then(
		() => true,
		() => false
	);
}

async function listFiles(dir) {
	try {
		const entries = await readdir(dir, { withFileTypes: true });
		return entries.filter((e) => e.isFile() && !e.name.startsWith('.')).map((e) => e.name);
	} catch {
		return [];
	}
}

let totalMoved = 0;
let totalStamped = 0;

const shootDirs = (await readdir(base, { withFileTypes: true }))
	.filter((e) => e.isDirectory() && SHOOT_PATTERN.test(e.name))
	.map((e) => e.name);

console.log(`Found ${shootDirs.length} shoot(s) under ${base}${DRY ? ' (dry run)' : ''}\n`);

for (const folderName of shootDirs) {
	const shootDir = join(base, folderName);
	const manifestPath = join(shootDir, '.photopipe.json');
	const denoisedDir = join(shootDir, 'denoised');

	let manifest = {};
	try {
		manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
	} catch {
		// No manifest — folder may predate it.
	}

	const ratings = manifest.ratings ?? {};
	console.log(`▸ ${folderName}`);

	if (!DRY) await mkdir(denoisedDir, { recursive: true });

	// Fold rated/ and selects/ back into denoised/, remembering which were selects.
	const selectNames = new Set();
	for (const legacy of ['rated', 'selects']) {
		const dir = join(shootDir, legacy);
		if (!(await exists(dir))) continue;

		for (const fileName of await listFiles(dir)) {
			if (legacy === 'selects') selectNames.add(fileName);
			const from = join(dir, fileName);
			const to = join(denoisedDir, fileName);

			if (await exists(to)) {
				console.log(`  ! ${fileName} already in denoised/, leaving ${legacy}/ copy in place`);
				continue;
			}
			if (!DRY) await rename(from, to);
			totalMoved++;
		}

		if (!DRY) {
			const leftover = await listFiles(dir);
			if (leftover.length === 0) await rmdir(dir).catch(() => {});
		}
		console.log(`  moved ${legacy}/ → denoised/`);
	}

	// Stamp ratings and select labels into the files themselves.
	const denoisedFiles = await listFiles(denoisedDir);
	for (const fileName of denoisedFiles) {
		const rating = ratings[fileName];
		const isSelect = selectNames.has(fileName);
		if (rating === undefined && !isSelect) continue;

		const tags = {};
		if (rating !== undefined) tags.Rating = rating;
		if (isSelect) tags.Label = 'Select';

		if (!DRY) {
			try {
				await exiftool.write(join(denoisedDir, fileName), tags, {
					writeArgs: ['-overwrite_original']
				});
			} catch (err) {
				console.log(`  ✗ ${fileName}: ${err.message?.split('\n')[0]}`);
				continue;
			}
		}
		totalStamped++;
		console.log(`  ✓ ${fileName} → ${JSON.stringify(tags)}`);
	}

	// Rewrite the manifest at v2, dropping the ratings map.
	const next = {
		version: 2,
		name: manifest.name ?? folderName.slice(11).replace(/-/g, ' '),
		date: manifest.date ?? folderName.slice(0, 10),
		createdAt: manifest.createdAt ?? new Date().toISOString(),
		algorithm: manifest.algorithm ?? null,
		notes: manifest.notes ?? '',
		rawCount: typeof manifest.rawCount === 'number' ? manifest.rawCount : null
	};
	if (!DRY) await writeFile(manifestPath, `${JSON.stringify(next, null, '\t')}\n`, 'utf8');
	console.log(`  manifest → v2\n`);
}

await exiftool.end();
console.log(`Done. Moved ${totalMoved} file(s), stamped ${totalStamped} file(s).`);
