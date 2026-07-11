import path from 'node:path';
import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import { applyConnectionPragmas, migrate } from './migrate.js';
import { coreMigrations } from './migrations/core.js';

/** Open (creating if needed) and migrate core.db under `dataDir`. */
export function openCoreDb(dataDir: string): Db {
  const db = new Database(path.join(dataDir, 'core.db'));
  applyConnectionPragmas(db);
  migrate(db, coreMigrations);
  return db;
}
