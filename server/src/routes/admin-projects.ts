import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { requireAdmin } from '../auth/guards.js';
import type { ProjectSizeInfo } from '@testhistory/shared';

interface ProjectRow {
  id: string;
  name: string;
  private: number;
  created_at: string;
}

/** Sum a file's size and its WAL/SHM sidecars; missing files count as 0. */
function dbFileBytes(base: string): number {
  let total = 0;
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      total += fs.statSync(base + suffix).size;
    } catch {
      /* file absent (e.g. no WAL yet) → 0 */
    }
  }
  return total;
}

/** Count rows + newest run from a project DB via a short-lived read-only handle. */
function projectCounts(dbPath: string): {
  runCount: number;
  testCount: number;
  resultCount: number;
  lastRunAt: string | null;
} {
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const one = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
      const runCount = one('SELECT COUNT(*) AS n FROM runs');
      const testCount = one('SELECT COUNT(*) AS n FROM tests');
      const resultCount = one('SELECT COUNT(*) AS n FROM results');
      const last = db.prepare('SELECT created_at FROM runs ORDER BY created_at DESC LIMIT 1').get() as
        | { created_at: string }
        | undefined;
      return { runCount, testCount, resultCount, lastRunAt: last?.created_at ?? null };
    } finally {
      db.close();
    }
  } catch {
    // DB file missing or unreadable — report an empty project rather than failing the sweep.
    return { runCount: 0, testCount: 0, resultCount: 0, lastRunAt: null };
  }
}

export async function adminProjectRoutes(app: FastifyInstance) {
  const core = app.core;

  // Size accounting for every project, largest first — for spotting runaway growth.
  app.get('/api/admin/projects', { preHandler: requireAdmin }, async () => {
    const projects = core
      .prepare('SELECT id, name, private, created_at FROM projects')
      .all() as ProjectRow[];
    const pluginAgg = core
      .prepare(
        'SELECT project_id, COUNT(*) AS n, COALESCE(SUM(size_bytes), 0) AS bytes FROM plugins GROUP BY project_id',
      )
      .all() as { project_id: string; n: number; bytes: number }[];
    const plugins = new Map(pluginAgg.map((p) => [p.project_id, p]));

    const sizes: ProjectSizeInfo[] = projects.map((p) => {
      const base = app.dbManager.pathFor(p.id);
      const dbBytes = dbFileBytes(base);
      const { runCount, testCount, resultCount, lastRunAt } = projectCounts(base);
      const plugin = plugins.get(p.id);
      const pluginCount = plugin?.n ?? 0;
      const pluginBytes = plugin?.bytes ?? 0;
      return {
        id: p.id,
        name: p.name,
        private: !!p.private,
        createdAt: p.created_at,
        runCount,
        testCount,
        resultCount,
        dbBytes,
        pluginCount,
        pluginBytes,
        totalBytes: dbBytes + pluginBytes,
        lastRunAt,
      };
    });
    sizes.sort((a, b) => b.totalBytes - a.totalBytes);
    return { projects: sizes };
  });
}
