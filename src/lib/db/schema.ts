import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

/**
 * The index. Every row here is derived from disk and can be rebuilt by a full
 * scan — nothing in this database is authoritative.
 */
export const shoots = sqliteTable(
	'shoots',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		folderName: text('folder_name').notNull(),
		name: text('name').notNull(),
		date: text('date').notNull(),
		createdAt: text('created_at').notNull(),
		algorithm: text('algorithm'),
		notes: text('notes').notNull().default(''),
		rawCount: integer('raw_count'),
		manifestMtime: integer('manifest_mtime'),
		lastScannedAt: integer('last_scanned_at')
	},
	(t) => [uniqueIndex('shoots_folder_name_idx').on(t.folderName)]
);

export const files = sqliteTable(
	'files',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		shootId: integer('shoot_id')
			.notNull()
			.references(() => shoots.id, { onDelete: 'cascade' }),
		stage: text('stage').notNull(),
		fileName: text('file_name').notNull(),
		sizeBytes: integer('size_bytes').notNull(),
		mtime: integer('mtime').notNull(),
		/** Mirror of xmp:Rating in the file (or its sidecar). Null = unrated. */
		rating: integer('rating'),
		/** Mirror of xmp:Label. 'Select' marks a curated pick. */
		label: text('label'),
		/** mtime of whatever we last read XMP from, so we can skip unchanged files. */
		xmpMtime: integer('xmp_mtime')
	},
	(t) => [
		uniqueIndex('files_unique_idx').on(t.shootId, t.stage, t.fileName),
		index('files_shoot_stage_idx').on(t.shootId, t.stage)
	]
);

export type ShootRow = typeof shoots.$inferSelect;
export type FileRow = typeof files.$inferSelect;
