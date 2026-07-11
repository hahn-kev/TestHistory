import type { Database } from 'better-sqlite3';

/**
 * One migration = a monotonically increasing version and the SQL that upgrades
 * the schema from the previous version to it. Both core.db and every per-project
 * DB drive their schema through this same runner, keyed on `PRAGMA user_version`.
 */
export interface Migration {
  version: number;
  sql: string;
}

/** Apply the standard connection pragmas every DB in the service shares. */
export function applyConnectionPragmas(db: Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
}

/**
 * Bring `db` up to the highest version in `migrations`, running each pending
 * migration in its own transaction and bumping `user_version`. Idempotent:
 * already-applied versions are skipped.
 */
export function migrate(db: Database, migrations: Migration[]): number {
  const ordered = [...migrations].sort((a, b) => a.version - b.version);
  let current = db.pragma('user_version', { simple: true }) as number;
  for (const m of ordered) {
    if (m.version <= current) continue;
    const run = db.transaction(() => {
      db.exec(m.sql);
      // user_version can't be parameterized; version is an integer we control.
      db.pragma(`user_version = ${m.version}`);
    });
    run();
    current = m.version;
  }
  return current;
}

/** The current (target) schema version for a migration set. */
export function targetVersion(migrations: Migration[]): number {
  return migrations.reduce((max, m) => Math.max(max, m.version), 0);
}
