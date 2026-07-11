import type { Migration } from '../migrate.js';

/** Schema for a per-project DB (`/data/projects/{id}.db`). */
export const projectMigrations: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE runs (
        id           INTEGER PRIMARY KEY,            -- monotonic = run ordering
        run_key      TEXT,                           -- client correlation key; NOT unique
        created_at   TEXT NOT NULL,                  -- anchors the append window
        started_at   TEXT,                           -- earliest across uploads
        duration_ms  INTEGER,                        -- sum across uploads
        label        TEXT,
        branch       TEXT,
        commit_sha   TEXT,
        ci_url       TEXT,
        metadata_json TEXT,
        uploads_json TEXT NOT NULL DEFAULT '[]',
        total   INTEGER NOT NULL DEFAULT 0,
        passed  INTEGER NOT NULL DEFAULT 0,
        failed  INTEGER NOT NULL DEFAULT 0,
        errored INTEGER NOT NULL DEFAULT 0,
        skipped INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_runs_branch ON runs(branch, id DESC);
      CREATE INDEX idx_runs_key ON runs(run_key, id DESC) WHERE run_key IS NOT NULL;

      CREATE TABLE tests (
        id                INTEGER PRIMARY KEY,
        suite             TEXT NOT NULL,
        name              TEXT NOT NULL,
        first_seen_run_id INTEGER NOT NULL,
        last_seen_run_id  INTEGER NOT NULL,
        UNIQUE (suite, name)
      );
      CREATE INDEX idx_tests_name ON tests(name);

      CREATE TABLE results (
        test_id     INTEGER NOT NULL REFERENCES tests(id),
        run_id      INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        status      INTEGER NOT NULL,                -- 0=passed 1=failed 2=error 3=skipped
        duration_ms REAL,
        message     TEXT,
        stack       TEXT,
        PRIMARY KEY (test_id, run_id)
      ) WITHOUT ROWID;
      CREATE INDEX idx_results_run ON results(run_id, status);

      CREATE TABLE name_rules (
        id         INTEGER PRIMARY KEY,
        position   INTEGER NOT NULL,
        match      TEXT NOT NULL,
        rewrite    TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `,
  },
];
