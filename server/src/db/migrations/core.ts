import type { Migration } from '../migrate.js';

/** Schema for core.db — users, sessions, projects, membership, tokens, plugins. */
export const coreMigrations: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE users (
        id            INTEGER PRIMARY KEY,
        email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        display_name  TEXT NOT NULL,
        role          TEXT NOT NULL DEFAULT 'user',   -- 'admin' | 'user'
        disabled      INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL
      );

      CREATE TABLE sessions (
        id           TEXT PRIMARY KEY,               -- sha256 of the cookie value
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at   TEXT NOT NULL,
        expires_at   TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
      CREATE INDEX idx_sessions_user ON sessions(user_id);
      CREATE INDEX idx_sessions_expires ON sessions(expires_at);
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE projects (
        id          TEXT PRIMARY KEY,                -- nanoid(12), used as DB filename
        name        TEXT NOT NULL UNIQUE,
        description TEXT,
        private     INTEGER NOT NULL DEFAULT 0,
        created_by  INTEGER REFERENCES users(id),
        created_at  TEXT NOT NULL
      );

      CREATE TABLE project_members (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role       TEXT NOT NULL,                    -- 'owner' | 'member'
        PRIMARY KEY (project_id, user_id)
      );
      CREATE INDEX idx_members_user ON project_members(user_id);

      CREATE TABLE api_tokens (
        id           INTEGER PRIMARY KEY,
        project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name         TEXT NOT NULL,
        token_hash   TEXT NOT NULL UNIQUE,           -- sha256 of the plaintext token
        token_prefix TEXT NOT NULL,
        created_by   INTEGER REFERENCES users(id),
        created_at   TEXT NOT NULL,
        last_used_at TEXT,
        revoked_at   TEXT
      );
      CREATE INDEX idx_tokens_project ON api_tokens(project_id);

      CREATE TABLE plugins (
        id          TEXT PRIMARY KEY,                -- nanoid(12), file at /data/plugins/{id}.html
        project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        description TEXT,
        size_bytes  INTEGER NOT NULL,
        uploaded_by INTEGER REFERENCES users(id),
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        UNIQUE (project_id, name)
      );
      CREATE INDEX idx_plugins_project ON plugins(project_id);
    `,
  },
  {
    version: 3,
    sql: `
      -- Optional Primary Branch override for health-trend scoping (ADR-0003).
      -- NULL / empty means live auto-detect from recent Runs.
      ALTER TABLE projects ADD COLUMN primary_branch TEXT;
    `,
  },
];
