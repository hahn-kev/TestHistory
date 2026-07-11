import type { Database as Db } from 'better-sqlite3';
import type { FlakyTestEntry, TestHistoryEntry, TrendPoint, TestStatus } from '@testhistory/shared';
import { STATUS_NAME } from '../ingest/model.js';

/**
 * Aggregation logic for a single project's DB. Every function takes an injected
 * better-sqlite3 handle (never opens its own) so it's testable against
 * hand-crafted rows with no server or worker threads. The ingest worker calls
 * `recomputeRunCounters`/`resolveAppendTarget` here rather than inlining SQL,
 * so the correctness of append + counters lives in one place.
 */

export interface RunCounters {
  total: number;
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
}

const PASSED = 0;
const FAILED = 1;
const ERROR = 2;
const SKIPPED = 3;

/**
 * Recompute a run's status tallies directly from `results` (never accumulated),
 * persist them on the run row, and return them. Idempotent: re-uploading the
 * same results yields the same counts, so a retried upload can't double-count.
 */
export function recomputeRunCounters(db: Db, runId: number): RunCounters {
  const rows = db
    .prepare('SELECT status, COUNT(*) AS n FROM results WHERE run_id = ? GROUP BY status')
    .all(runId) as { status: number; n: number }[];
  const c: RunCounters = { total: 0, passed: 0, failed: 0, errored: 0, skipped: 0 };
  for (const r of rows) {
    c.total += r.n;
    if (r.status === PASSED) c.passed = r.n;
    else if (r.status === FAILED) c.failed = r.n;
    else if (r.status === ERROR) c.errored = r.n;
    else if (r.status === SKIPPED) c.skipped = r.n;
  }
  db.prepare(
    'UPDATE runs SET total = ?, passed = ?, failed = ?, errored = ?, skipped = ? WHERE id = ?',
  ).run(c.total, c.passed, c.failed, c.errored, c.skipped, runId);
  return c;
}

export type AppendResolution =
  | { action: 'append'; runId: number }
  | { action: 'create' }
  | { action: 'expired' };

/**
 * Decide where an upload carrying `runKey` should land, given the current time
 * (epoch ms) and the append window. No key or no run with that key → create;
 * the newest run with the key is the append target while within its window,
 * measured from that run's creation; once the window has passed → expired.
 */
export function resolveAppendTarget(
  db: Db,
  runKey: string | null | undefined,
  now: number,
  windowMs: number,
): AppendResolution {
  if (!runKey) return { action: 'create' };
  const row = db
    .prepare('SELECT id, created_at AS createdAt FROM runs WHERE run_key = ? ORDER BY id DESC LIMIT 1')
    .get(runKey) as { id: number; createdAt: string } | undefined;
  if (!row) return { action: 'create' };
  const created = new Date(row.createdAt).getTime();
  if (now - created <= windowMs) return { action: 'append', runId: row.id };
  return { action: 'expired' };
}

/**
 * Trend over the most recent runs (chronological order), optionally scoped to a
 * branch. One point per run with its status tallies + duration.
 */
export function computeTrend(db: Db, opts: { limit?: number; branch?: string | null } = {}): TrendPoint[] {
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 500));
  const branch = opts.branch ?? null;
  const rows = db
    .prepare(
      `SELECT id AS runId, created_at AS createdAt, branch,
              passed, failed, errored, skipped, duration_ms AS durationMs
         FROM runs
        WHERE (@branch IS NULL OR branch = @branch)
        ORDER BY id DESC LIMIT @limit`,
    )
    .all({ branch, limit }) as TrendPoint[];
  return rows.reverse();
}

/** Full per-run history of one test, newest run first. */
export function getTestHistory(db: Db, testId: number): TestHistoryEntry[] {
  const rows = db
    .prepare(
      `SELECT r.run_id AS runId, ru.created_at AS createdAt, ru.branch AS branch,
              ru.commit_sha AS commitSha, ru.label AS label,
              r.status AS statusCode, r.duration_ms AS durationMs, r.message AS message, r.stack AS stack
         FROM results r JOIN runs ru ON ru.id = r.run_id
        WHERE r.test_id = ?
        ORDER BY r.run_id DESC`,
    )
    .all(testId) as (Omit<TestHistoryEntry, 'status'> & { statusCode: number })[];
  return rows.map(({ statusCode, ...rest }) => ({ ...rest, status: STATUS_NAME[statusCode] as TestStatus }));
}

/**
 * Flaky detection over the last N runs (optionally within a branch). A test is
 * flaky when its status flips between `passed` and (`failed`|`error`) at least
 * twice across that window. `skipped` results and runs where the test is absent
 * are gaps — they don't break or contribute to the sequence.
 */
export function detectFlaky(
  db: Db,
  opts: { window?: number; branch?: string | null } = {},
): FlakyTestEntry[] {
  const window = Math.max(2, Math.min(opts.window ?? 50, 1000));
  const branch = opts.branch ?? null;

  const windowRuns = db
    .prepare(
      `SELECT id FROM runs
        WHERE (@branch IS NULL OR branch = @branch)
        ORDER BY id DESC LIMIT @window`,
    )
    .all({ branch, window }) as { id: number }[];
  if (windowRuns.length === 0) return [];
  const runIds = windowRuns.map((r) => r.id);
  const placeholders = runIds.map(() => '?').join(',');

  const rows = db
    .prepare(
      `SELECT r.test_id AS testId, r.run_id AS runId, r.status AS status,
              t.suite AS suite, t.name AS name
         FROM results r JOIN tests t ON t.id = r.test_id
        WHERE r.run_id IN (${placeholders})
        ORDER BY r.test_id, r.run_id ASC`,
    )
    .all(...runIds) as { testId: number; runId: number; status: number; suite: string; name: string }[];

  interface Acc {
    suite: string;
    name: string;
    runsSeen: number;
    fails: number;
    flips: number;
    prevSide: 'pass' | 'notpass' | null;
    lastStatus: number;
    lastRunId: number;
  }
  const acc = new Map<number, Acc>();

  for (const row of rows) {
    let a = acc.get(row.testId);
    if (!a) {
      a = {
        suite: row.suite,
        name: row.name,
        runsSeen: 0,
        fails: 0,
        flips: 0,
        prevSide: null,
        lastStatus: row.status,
        lastRunId: row.runId,
      };
      acc.set(row.testId, a);
    }
    a.runsSeen += 1;
    // Track the most recent status by run id (rows are ascending, so this holds).
    if (row.runId >= a.lastRunId) {
      a.lastRunId = row.runId;
      a.lastStatus = row.status;
    }
    if (row.status === FAILED || row.status === ERROR) a.fails += 1;

    // skipped is a gap: it neither flips nor resets the pass/notpass sequence.
    if (row.status === SKIPPED) continue;
    const side: 'pass' | 'notpass' = row.status === PASSED ? 'pass' : 'notpass';
    if (a.prevSide !== null && a.prevSide !== side) a.flips += 1;
    a.prevSide = side;
  }

  const out: FlakyTestEntry[] = [];
  for (const [testId, a] of acc) {
    if (a.flips >= 2) {
      out.push({
        testId,
        suite: a.suite,
        name: a.name,
        runsSeen: a.runsSeen,
        fails: a.fails,
        flips: a.flips,
        lastStatus: STATUS_NAME[a.lastStatus] as TestStatus,
      });
    }
  }
  // Most flips first, then most recent activity.
  out.sort((x, y) => y.flips - x.flips || y.fails - x.fails);
  return out;
}
