import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import { applyConnectionPragmas, migrate, targetVersion } from './migrate.js';
import { projectMigrations } from './migrations/project.js';
import { projectsDir } from '../config.js';
import { isSafeId } from '../lib/ids.js';

/**
 * Owns the per-project SQLite handles. Opens a project DB lazily on first
 * access, applying the full per-project schema + any pending migrations, and
 * keeps a small LRU of live handles so hot projects stay warm without pinning
 * every DB open. Single process → one writer per project is serialized by the
 * ingest queue; the handle itself is shared for reads.
 */
export class DbManager {
  private readonly dir: string;
  private readonly cache = new Map<string, Db>(); // insertion order = LRU order
  private readonly cap: number;

  constructor(dataDir: string, cap = 64) {
    this.dir = projectsDir(dataDir);
    this.cap = cap;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  private pathFor(projectId: string): string {
    if (!isSafeId(projectId)) throw new Error(`unsafe project id: ${projectId}`);
    return path.join(this.dir, `${projectId}.db`);
  }

  /** Get (opening + migrating on first access) the handle for a project. */
  get(projectId: string): Db {
    const existing = this.cache.get(projectId);
    if (existing) {
      // Refresh LRU position.
      this.cache.delete(projectId);
      this.cache.set(projectId, existing);
      return existing;
    }
    const db = new Database(this.pathFor(projectId));
    applyConnectionPragmas(db);
    migrate(db, projectMigrations);
    this.insert(projectId, db);
    return db;
  }

  private insert(projectId: string, db: Db): void {
    this.cache.set(projectId, db);
    while (this.cache.size > this.cap) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      const handle = this.cache.get(oldest)!;
      this.cache.delete(oldest);
      try {
        handle.close();
      } catch {
        /* ignore */
      }
    }
  }

  /** Evict + close a single project's handle (e.g. before deleting its files). */
  evict(projectId: string): void {
    const handle = this.cache.get(projectId);
    if (handle) {
      this.cache.delete(projectId);
      try {
        handle.close();
      } catch {
        /* ignore */
      }
    }
  }

  /** Delete a project's DB file (and WAL/SHM sidecars) after evicting it. */
  deleteFiles(projectId: string): void {
    this.evict(projectId);
    const base = this.pathFor(projectId);
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.rmSync(base + suffix, { force: true });
      } catch {
        /* ignore */
      }
    }
  }

  /** Boot sweep: migrate every existing project DB up to the current version. */
  migrateAll(): void {
    if (!fs.existsSync(this.dir)) return;
    for (const file of fs.readdirSync(this.dir)) {
      if (!file.endsWith('.db')) continue;
      const id = file.slice(0, -3);
      if (!isSafeId(id)) continue;
      const db = new Database(path.join(this.dir, file));
      applyConnectionPragmas(db);
      migrate(db, projectMigrations);
      db.close();
    }
  }

  closeAll(): void {
    for (const handle of this.cache.values()) {
      try {
        handle.close();
      } catch {
        /* ignore */
      }
    }
    this.cache.clear();
  }
}

export const PROJECT_SCHEMA_VERSION = targetVersion(projectMigrations);
