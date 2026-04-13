import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod/v4';
import { CAMERA_BASE, SHOOT_PATTERN } from './config.js';
import { getConvexClient } from './convex.js';
import { api } from '../../convex/_generated/api.js';

const starRating = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);

const migrateSchema = z.object({
	version: z.number(),
	name: z.string(),
	date: z.string(),
	createdAt: z.string(),
	algorithm: z.enum(['DeepPRIME 3', 'DeepPRIME XD3']).nullable(),
	notes: z.string(),
	rawCount: z.number().nullable(),
	ratings: z.record(z.string(), starRating).default({}),
	migrated: z.boolean().optional()
});

let migrationDone = false;

export async function runMigrationIfNeeded(): Promise<void> {
	if (migrationDone) return;
	migrationDone = true;

	let entries: string[];
	try {
		entries = readdirSync(CAMERA_BASE);
	} catch {
		console.log('[migrate] CAMERA_BASE not readable, skipping migration');
		return;
	}

	const convex = getConvexClient();
	let migratedCount = 0;

	for (const entry of entries) {
		if (!SHOOT_PATTERN.test(entry)) continue;

		const metadataPath = join(CAMERA_BASE, entry, '.photopipe.json');
		let raw: string;
		try {
			raw = readFileSync(metadataPath, 'utf-8');
		} catch {
			continue;
		}

		let parsed: z.infer<typeof migrateSchema>;
		try {
			parsed = migrateSchema.parse(JSON.parse(raw));
		} catch {
			console.warn(`[migrate] Invalid metadata in ${entry}, skipping`);
			continue;
		}

		if (parsed.migrated) continue;

		await convex.mutation(api.shoots.upsert, {
			folderName: entry,
			name: parsed.name,
			date: parsed.date,
			createdAt: parsed.createdAt,
			algorithm: parsed.algorithm,
			notes: parsed.notes,
			rawCount: parsed.rawCount
		});

		const ratingEntries = Object.entries(parsed.ratings).map(([fileName, rating]) => ({
			fileName,
			rating
		}));

		if (ratingEntries.length > 0) {
			await convex.mutation(api.ratings.upsertMany, {
				folderName: entry,
				ratings: ratingEntries
			});
		}

		const flagged = { ...parsed, migrated: true };
		writeFileSync(metadataPath, JSON.stringify(flagged, null, '\t'));
		migratedCount++;
		console.log(`[migrate] Migrated ${entry} (${ratingEntries.length} ratings)`);
	}

	if (migratedCount > 0) {
		console.log(`[migrate] Migration complete: ${migratedCount} shoot(s) imported`);
	}
}
