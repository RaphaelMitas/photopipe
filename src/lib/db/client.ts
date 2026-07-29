import 'server-only';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { DB_PATH } from '../config';
import * as schema from './schema';

/**
 * The index is a cache, so the schema is created inline rather than through a
 * migration chain: on a version bump we drop and let the sync engine rescan.
 */
const SCHEMA_VERSION = 1;

const DDL = `
CREATE TABLE IF NOT EXISTS shoots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_name TEXT NOT NULL,
  name TEXT NOT NULL,
  date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  algorithm TEXT,
  notes TEXT NOT NULL DEFAULT '',
  raw_count INTEGER,
  manifest_mtime INTEGER,
  last_scanned_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS shoots_folder_name_idx ON shoots (folder_name);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shoot_id INTEGER NOT NULL REFERENCES shoots(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  file_name TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  mtime INTEGER NOT NULL,
  rating INTEGER,
  label TEXT,
  xmp_mtime INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS files_unique_idx ON files (shoot_id, stage, file_name);
CREATE INDEX IF NOT EXISTS files_shoot_stage_idx ON files (shoot_id, stage);
`;

function open() {
	mkdirSync(dirname(DB_PATH), { recursive: true });
	const sqlite = new Database(DB_PATH);
	sqlite.pragma('journal_mode = WAL');
	sqlite.pragma('foreign_keys = ON');
	sqlite.pragma('busy_timeout = 5000');

	const current = sqlite.pragma('user_version', { simple: true }) as number;
	if (current !== SCHEMA_VERSION) {
		sqlite.exec('DROP TABLE IF EXISTS files; DROP TABLE IF EXISTS shoots;');
		sqlite.exec(DDL);
		sqlite.pragma(`user_version = ${SCHEMA_VERSION}`);
	} else {
		sqlite.exec(DDL);
	}

	return drizzle(sqlite, { schema });
}

/**
 * Next dev-mode module reloads would otherwise open a new handle per reload,
 * so the connection is cached on globalThis.
 */
const globalForDb = globalThis as unknown as { photopipeDb?: ReturnType<typeof open> };

export const db = globalForDb.photopipeDb ?? open();

if (process.env.NODE_ENV !== 'production') globalForDb.photopipeDb = db;
