import type { FastifyInstance } from 'fastify';
import type { Database as Db } from 'better-sqlite3';
import type { RunSummary, UploadInfo, TestResultRow, TestInfo, TestStatus } from '@testhistory/shared';
import { requireProject } from '../auth/project-access.js';
import { sendError } from '../auth/guards.js';
import { detectFlaky, computeTrend, getTestHistory } from '../analytics/analytics.js';
import { STATUS_NAME, STATUS_CODE } from '../ingest/model.js';

interface RunRow {
  id: number;
  run_key: string | null;
  created_at: string;
  started_at: string | null;
  duration_ms: number | null;
  label: string | null;
  branch: string | null;
  commit_sha: string | null;
  ci_url: string | null;
  uploads_json: string;
  total: number;
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
}

function runToSummary(row: RunRow): RunSummary {
  return {
    id: row.id,
    createdAt: row.created_at,
    startedAt: row.started_at,
    durationMs: row.duration_ms,
    label: row.label,
    branch: row.branch,
    commitSha: row.commit_sha,
    ciUrl: row.ci_url,
    uploads: JSON.parse(row.uploads_json) as UploadInfo[],
    total: row.total,
    passed: row.passed,
    failed: row.failed,
    errored: row.errored,
    skipped: row.skipped,
  };
}

function clampLimit(v: unknown, def = 50, max = 200): number {
  const n = typeof v === 'string' ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : def;
}

function numOrNull(v: unknown): number | null {
  const n = typeof v === 'string' ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export async function readRoutes(app: FastifyInstance) {
  const core = app.core;
  const viewer = requireProject(core, 'viewer');
  const member = requireProject(core, 'member');
  const db = (projectId: string): Db => app.dbManager.get(projectId);

  // --- Runs list (newest first, cursor pagination, optional branch filter) ---
  app.get('/api/projects/:id/runs', { preHandler: viewer }, async (req) => {
    const q = req.query as Record<string, string>;
    const limit = clampLimit(q.limit);
    const cursor = numOrNull(q.cursor);
    const branch = str(q.branch);
    const d = db(req.project!.id);
    const rows = d
      .prepare(
        `SELECT * FROM runs
          WHERE (@branch IS NULL OR branch = @branch)
            AND (@cursor IS NULL OR id < @cursor)
          ORDER BY id DESC LIMIT @limit`,
      )
      .all({ branch, cursor, limit: limit + 1 }) as RunRow[];
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    return {
      runs: page.map(runToSummary),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  });

  // --- Run detail ---
  app.get('/api/projects/:id/runs/:runId', { preHandler: viewer }, async (req, reply) => {
    const runId = Number((req.params as { runId: string }).runId);
    const row = db(req.project!.id).prepare('SELECT * FROM runs WHERE id = ?').get(runId) as RunRow | undefined;
    if (!row) return sendError(reply, 404, 'NOT_FOUND', 'Run not found.');
    return { run: runToSummary(row) };
  });

  // --- Results for a run (status filter, text search, cursor by test_id) ---
  app.get('/api/projects/:id/runs/:runId/results', { preHandler: viewer }, async (req) => {
    const runId = Number((req.params as { runId: string }).runId);
    const q = req.query as Record<string, string>;
    const limit = clampLimit(q.limit);
    const cursor = numOrNull(q.cursor);
    const statusName = str(q.status) as TestStatus | null;
    const statusCode = statusName && statusName in STATUS_CODE ? STATUS_CODE[statusName] : null;
    const search = str(q.search);
    const like = search ? `%${search}%` : null;

    const rows = db(req.project!.id)
      .prepare(
        `SELECT r.test_id AS testId, t.suite AS suite, t.name AS name, r.status AS statusCode,
                r.duration_ms AS durationMs, r.message AS message, r.stack AS stack
           FROM results r JOIN tests t ON t.id = r.test_id
          WHERE r.run_id = @runId
            AND (@statusCode IS NULL OR r.status = @statusCode)
            AND (@like IS NULL OR t.suite LIKE @like OR t.name LIKE @like)
            AND (@cursor IS NULL OR r.test_id > @cursor)
          ORDER BY r.test_id ASC LIMIT @limit`,
      )
      .all({ runId, statusCode, like, cursor, limit: limit + 1 }) as (Omit<TestResultRow, 'status'> & { statusCode: number })[];

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const results: TestResultRow[] = page.map(({ statusCode: sc, ...rest }) => ({
      ...rest,
      status: STATUS_NAME[sc] as TestStatus,
    }));
    return { results, nextCursor: hasMore ? page[page.length - 1].testId : null };
  });

  // --- Trend (analytics) ---
  app.get('/api/projects/:id/trend', { preHandler: viewer }, async (req) => {
    const q = req.query as Record<string, string>;
    return { trend: computeTrend(db(req.project!.id), { limit: clampLimit(q.limit, 50, 500), branch: str(q.branch) }) };
  });

  // --- Flaky (analytics) ---
  app.get('/api/projects/:id/flaky', { preHandler: viewer }, async (req) => {
    const q = req.query as Record<string, string>;
    const window = clampLimit(q.window, 50, 1000);
    return { flaky: detectFlaky(db(req.project!.id), { window, branch: str(q.branch) }) };
  });

  // --- Tests search ---
  app.get('/api/projects/:id/tests', { preHandler: viewer }, async (req) => {
    const q = req.query as Record<string, string>;
    const limit = clampLimit(q.limit);
    const cursor = numOrNull(q.cursor);
    const search = str(q.search);
    const like = search ? `%${search}%` : null;
    const rows = db(req.project!.id)
      .prepare(
        `SELECT id, suite, name, first_seen_run_id AS firstSeenRunId, last_seen_run_id AS lastSeenRunId
           FROM tests
          WHERE (@like IS NULL OR suite LIKE @like OR name LIKE @like)
            AND (@cursor IS NULL OR id > @cursor)
          ORDER BY id ASC LIMIT @limit`,
      )
      .all({ like, cursor, limit: limit + 1 }) as TestInfo[];
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    return { tests: page, nextCursor: hasMore ? page[page.length - 1].id : null };
  });

  // --- Test history (analytics) ---
  app.get('/api/projects/:id/tests/:testId/history', { preHandler: viewer }, async (req, reply) => {
    const testId = Number((req.params as { testId: string }).testId);
    const d = db(req.project!.id);
    const test = d
      .prepare('SELECT id, suite, name, first_seen_run_id AS firstSeenRunId, last_seen_run_id AS lastSeenRunId FROM tests WHERE id = ?')
      .get(testId) as TestInfo | undefined;
    if (!test) return sendError(reply, 404, 'NOT_FOUND', 'Test not found.');
    return { test, history: getTestHistory(d, testId) };
  });

  // --- Delete a run (member) ---
  app.delete('/api/projects/:id/runs/:runId', { preHandler: member }, async (req, reply) => {
    const runId = Number((req.params as { runId: string }).runId);
    const d = db(req.project!.id);
    const row = d.prepare('SELECT id FROM runs WHERE id = ?').get(runId);
    if (!row) return sendError(reply, 404, 'NOT_FOUND', 'Run not found.');
    // results cascade on run delete (FK ON DELETE CASCADE).
    d.prepare('DELETE FROM runs WHERE id = ?').run(runId);
    return { ok: true };
  });
}
