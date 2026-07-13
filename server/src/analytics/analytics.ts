import type { Database as Db } from 'better-sqlite3';
import type {
  FlakyTestEntry,
  TestHistoryEntry,
  TrendPoint,
  TestStatus,
  ChangeCategory,
  ComparedStatus,
  ComparedTest,
  ComparisonBucket,
  ComparisonSummary,
} from '@testhistory/shared';
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

/** A reference to one side of a comparison: an explicit run id, or "latest on a branch". */
export interface RunRef {
  runId?: number | null;
  branch?: string | null;
}

export type RunRefResolution =
  | { ok: true; runId: number }
  | { ok: false; reason: 'missing_input' | 'run_not_found' | 'branch_empty'; branch?: string };

/**
 * Resolve one side of a Run Comparison to a concrete run id. An explicit `runId`
 * takes precedence (verified to exist); otherwise `branch` resolves to the newest
 * run on that branch. Mirrors {@link resolveAppendTarget}'s discriminated-union style
 * so the route can map each reason to an HTTP status.
 */
export function resolveRunRef(db: Db, ref: RunRef): RunRefResolution {
  if (ref.runId != null) {
    const row = db.prepare('SELECT id FROM runs WHERE id = ?').get(ref.runId) as { id: number } | undefined;
    return row ? { ok: true, runId: row.id } : { ok: false, reason: 'run_not_found' };
  }
  if (ref.branch) {
    const row = db
      .prepare('SELECT id FROM runs WHERE branch = ? ORDER BY id DESC LIMIT 1')
      .get(ref.branch) as { id: number } | undefined;
    return row ? { ok: true, runId: row.id } : { ok: false, reason: 'branch_empty', branch: ref.branch };
  }
  return { ok: false, reason: 'missing_input' };
}

export interface RunComparisonData {
  summary: ComparisonSummary;
  categories: Record<ChangeCategory, ComparisonBucket>;
}

function isFailing(code: number | undefined): boolean {
  return code === FAILED || code === ERROR;
}

function comparedStatus(code: number | undefined): ComparedStatus {
  return code === undefined ? 'absent' : (STATUS_NAME[code] as TestStatus);
}

/**
 * Classify a Test's transition between two Runs. `failing` = failed|error;
 * `passing` = passed; `skipped` and absence are neutral (matching the "gaps"
 * treatment in flaky detection). First matching rule wins, so the categories are
 * mutually exclusive:
 *   1. absent in head            → removedTests
 *   2. failing in head & base    → stillFailing
 *   3. failing in head, not base → newlyFailing  (incl. a brand-new failing test —
 *                                                  merge-gating cares about it)
 *   4. passed in head, failing in base → newlyFixed
 *   5. absent in base (present in head, passed/skipped) → newTests
 *   6. anything else (pass→pass, pass→skip, skip→pass, fail→skip, skip→skip) → null
 *      (counted as `other`; skipping a test is not fixing it).
 */
function classify(base: number | undefined, head: number | undefined): ChangeCategory | null {
  if (head === undefined) return 'removedTests';
  if (isFailing(head)) return isFailing(base) ? 'stillFailing' : 'newlyFailing';
  if (head === PASSED && isFailing(base)) return 'newlyFixed';
  if (base === undefined) return 'newTests';
  return null;
}

/**
 * Compare two Runs of one Project: how each Test's Status changed from `baseRunId`
 * to `headRunId`. Pulls both runs' results in one query and diffs them in memory
 * (no FULL OUTER JOIN — portable and matches the gather-then-fold style of
 * {@link detectFlaky}). Summary counts are exact; each category's Test list is
 * capped at `limit` (default 500) with a `truncated` flag. `baseRunId === headRunId`
 * needs no special-casing (every Test lands on the same side → no regressions/fixes).
 */
export function compareRuns(
  db: Db,
  baseRunId: number,
  headRunId: number,
  opts: { limit?: number } = {},
): RunComparisonData {
  const limit = Math.max(1, Math.min(opts.limit ?? 500, 2000));

  const rows = db
    .prepare(
      `SELECT r.test_id AS testId, t.suite AS suite, t.name AS name,
              r.run_id AS runId, r.status AS status, r.duration_ms AS durationMs
         FROM results r JOIN tests t ON t.id = r.test_id
        WHERE r.run_id IN (@baseRunId, @headRunId)
        ORDER BY t.suite, t.name`,
    )
    .all({ baseRunId, headRunId }) as {
    testId: number;
    suite: string;
    name: string;
    runId: number;
    status: number;
    durationMs: number | null;
  }[];

  interface Slot {
    suite: string;
    name: string;
    base?: number;
    head?: number;
    baseDurationMs: number | null;
    headDurationMs: number | null;
  }
  const byTest = new Map<number, Slot>();
  for (const row of rows) {
    let slot = byTest.get(row.testId);
    if (!slot) {
      slot = { suite: row.suite, name: row.name, baseDurationMs: null, headDurationMs: null };
      byTest.set(row.testId, slot);
    }
    // base==head fills both slots from the same rows.
    if (row.runId === baseRunId) {
      slot.base = row.status;
      slot.baseDurationMs = row.durationMs;
    }
    if (row.runId === headRunId) {
      slot.head = row.status;
      slot.headDurationMs = row.durationMs;
    }
  }

  const categories: Record<ChangeCategory, ComparisonBucket> = {
    newlyFailing: { total: 0, truncated: false, tests: [] },
    newlyFixed: { total: 0, truncated: false, tests: [] },
    stillFailing: { total: 0, truncated: false, tests: [] },
    newTests: { total: 0, truncated: false, tests: [] },
    removedTests: { total: 0, truncated: false, tests: [] },
  };
  let other = 0;

  for (const [testId, slot] of byTest) {
    const cat = classify(slot.base, slot.head);
    if (cat === null) {
      other += 1;
      continue;
    }
    const bucket = categories[cat];
    bucket.total += 1;
    if (bucket.tests.length < limit) {
      bucket.tests.push({
        testId,
        suite: slot.suite,
        name: slot.name,
        baseStatus: comparedStatus(slot.base),
        headStatus: comparedStatus(slot.head),
        baseDurationMs: slot.baseDurationMs,
        headDurationMs: slot.headDurationMs,
      });
    } else {
      bucket.truncated = true;
    }
  }

  const base = db.prepare('SELECT * FROM runs WHERE id = ?').get(baseRunId) as RunCounterRow | undefined;
  const head = db.prepare('SELECT * FROM runs WHERE id = ?').get(headRunId) as RunCounterRow | undefined;
  const summary: ComparisonSummary = {
    regressions: categories.newlyFailing.total,
    fixed: categories.newlyFixed.total,
    stillFailing: categories.stillFailing.total,
    newTests: categories.newTests.total,
    removedTests: categories.removedTests.total,
    other,
    passedDelta: (head?.passed ?? 0) - (base?.passed ?? 0),
    failedDelta: (head?.failed ?? 0) - (base?.failed ?? 0),
    erroredDelta: (head?.errored ?? 0) - (base?.errored ?? 0),
    skippedDelta: (head?.skipped ?? 0) - (base?.skipped ?? 0),
    totalDelta: (head?.total ?? 0) - (base?.total ?? 0),
    durationDeltaMs:
      head?.duration_ms != null && base?.duration_ms != null ? head.duration_ms - base.duration_ms : null,
  };

  return { summary, categories };
}

interface RunCounterRow {
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
  total: number;
  duration_ms: number | null;
}
