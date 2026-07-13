import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import { applyConnectionPragmas, migrate } from '../src/db/migrate.js';
import { projectMigrations } from '../src/db/migrations/project.js';
import {
  detectFlaky,
  computeTrend,
  getTestHistory,
  recomputeRunCounters,
  resolveAppendTarget,
  compareRuns,
  resolveRunRef,
} from '../src/analytics/analytics.js';
import { formatComparisonMarkdown, COMPARE_MARKER } from '../src/analytics/compare-format.js';
import type { TestStatus, RunSummary } from '@testhistory/shared';

const CODE: Record<TestStatus, number> = { passed: 0, failed: 1, error: 2, skipped: 3 };

let db: Db;

/** A hand-crafted per-project DB for controlled-row analytics tests. */
function freshDb(): Db {
  const d = new Database(':memory:');
  applyConnectionPragmas(d);
  migrate(d, projectMigrations);
  return d;
}

function addRun(id: number, opts: { branch?: string; createdAt?: string; runKey?: string } = {}) {
  db.prepare(
    'INSERT INTO runs (id, run_key, created_at, branch) VALUES (?, ?, ?, ?)',
  ).run(id, opts.runKey ?? null, opts.createdAt ?? `2026-01-0${id}T00:00:00.000Z`, opts.branch ?? null);
}

function ensureTest(id: number, suite: string, name: string, runId: number) {
  db.prepare(
    `INSERT INTO tests (id, suite, name, first_seen_run_id, last_seen_run_id)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET last_seen_run_id = excluded.last_seen_run_id`,
  ).run(id, suite, name, runId, runId);
}

function addResult(testId: number, runId: number, status: TestStatus, durationMs = 1) {
  db.prepare(
    'INSERT OR REPLACE INTO results (test_id, run_id, status, duration_ms) VALUES (?, ?, ?, ?)',
  ).run(testId, runId, CODE[status], durationMs);
}

/** Seed a single test's status across a sequence of runs (run ids 1..N). */
function seedSequence(statuses: TestStatus[], branchFor?: (i: number) => string) {
  ensureTest(1, 'suite', 'the_test', 1);
  statuses.forEach((s, i) => {
    const runId = i + 1;
    addRun(runId, { branch: branchFor?.(i) });
    addResult(1, runId, s);
  });
}

beforeEach(() => {
  db = freshDb();
});
afterEach(() => {
  db.close();
});

describe('detectFlaky — flip semantics', () => {
  test('pass/fail/pass/fail is flaky', () => {
    seedSequence(['passed', 'failed', 'passed', 'failed']);
    const flaky = detectFlaky(db, {});
    expect(flaky).toHaveLength(1);
    expect(flaky[0]).toMatchObject({ testId: 1, flips: 3, fails: 2, lastStatus: 'failed' });
  });

  test('pass/skip/pass/skip is NOT flaky (skipped is a gap)', () => {
    seedSequence(['passed', 'skipped', 'passed', 'skipped']);
    expect(detectFlaky(db, {})).toEqual([]);
  });

  test('pass/error/pass is flaky (error is on the not-passed side)', () => {
    seedSequence(['passed', 'error', 'passed']);
    const flaky = detectFlaky(db, {});
    expect(flaky).toHaveLength(1);
    expect(flaky[0].flips).toBe(2);
  });

  test('a single flip is not enough (needs >= 2)', () => {
    seedSequence(['passed', 'failed']);
    expect(detectFlaky(db, {})).toEqual([]);
  });

  test('skipped between a flip does not break the sequence', () => {
    // pass, skip, fail, skip, pass → non-skip: pass,fail,pass → 2 flips → flaky
    seedSequence(['passed', 'skipped', 'failed', 'skipped', 'passed']);
    const flaky = detectFlaky(db, {});
    expect(flaky).toHaveLength(1);
    expect(flaky[0].flips).toBe(2);
  });

  test('runs where the test is absent are gaps, not flips', () => {
    // Test present only in runs 1,3,5 (absent in 2,4): pass,fail,pass → 2 flips
    ensureTest(1, 'suite', 't', 1);
    for (const id of [1, 2, 3, 4, 5]) addRun(id);
    addResult(1, 1, 'passed');
    addResult(1, 3, 'failed');
    addResult(1, 5, 'passed');
    const flaky = detectFlaky(db, {});
    expect(flaky).toHaveLength(1);
    expect(flaky[0]).toMatchObject({ flips: 2, runsSeen: 3 });
  });
});

describe('detectFlaky — window boundary', () => {
  test('a flip outside the last-N window is excluded', () => {
    // runs 1..5: pass,fail,pass,pass,pass
    seedSequence(['passed', 'failed', 'passed', 'passed', 'passed']);
    // window of last 3 runs (3,4,5) = all pass → not flaky
    expect(detectFlaky(db, { window: 3 })).toEqual([]);
    // window of 5 sees pass,fail,pass,pass,pass → 2 flips → flaky
    expect(detectFlaky(db, { window: 5 })).toHaveLength(1);
  });
});

describe('detectFlaky — branch scoping', () => {
  test('flaky within a branch, not in another', () => {
    ensureTest(1, 'suite', 't', 1);
    // main: runs 1,3,5,6 pass/fail/pass/fail ; dev: runs 2,4 pass/pass
    addRun(1, { branch: 'main' });
    addRun(2, { branch: 'dev' });
    addRun(3, { branch: 'main' });
    addRun(4, { branch: 'dev' });
    addRun(5, { branch: 'main' });
    addRun(6, { branch: 'main' });
    addResult(1, 1, 'passed');
    addResult(1, 2, 'passed');
    addResult(1, 3, 'failed');
    addResult(1, 4, 'passed');
    addResult(1, 5, 'passed');
    addResult(1, 6, 'failed');

    const main = detectFlaky(db, { branch: 'main' });
    expect(main).toHaveLength(1);
    expect(main[0].flips).toBe(3); // pass,fail,pass,fail

    const dev = detectFlaky(db, { branch: 'dev' });
    expect(dev).toEqual([]);
  });
});

describe('recomputeRunCounters', () => {
  test('derives tallies from results and persists them', () => {
    addRun(1);
    ensureTest(1, 's', 'a', 1);
    ensureTest(2, 's', 'b', 1);
    ensureTest(3, 's', 'c', 1);
    ensureTest(4, 's', 'd', 1);
    addResult(1, 1, 'passed');
    addResult(2, 1, 'failed');
    addResult(3, 1, 'error');
    addResult(4, 1, 'skipped');
    const c = recomputeRunCounters(db, 1);
    expect(c).toEqual({ total: 4, passed: 1, failed: 1, errored: 1, skipped: 1 });
    const row = db.prepare('SELECT total, passed, failed, errored, skipped FROM runs WHERE id = 1').get();
    expect(row).toEqual({ total: 4, passed: 1, failed: 1, errored: 1, skipped: 1 });
  });

  test('idempotent — re-running does not accumulate, re-uploading a result is last-write-wins', () => {
    addRun(1);
    ensureTest(1, 's', 'a', 1);
    addResult(1, 1, 'passed');
    const first = recomputeRunCounters(db, 1);
    const second = recomputeRunCounters(db, 1);
    expect(second).toEqual(first);
    expect(second.total).toBe(1);
    // "Re-upload" the same test with a flipped status → still one row, reflected.
    addResult(1, 1, 'failed');
    const third = recomputeRunCounters(db, 1);
    expect(third).toEqual({ total: 1, passed: 0, failed: 1, errored: 0, skipped: 0 });
  });
});

describe('resolveAppendTarget', () => {
  const WINDOW = 3_600_000;
  const NOW = Date.parse('2026-06-01T12:00:00.000Z');

  test('no key → create', () => {
    expect(resolveAppendTarget(db, null, NOW, WINDOW)).toEqual({ action: 'create' });
    expect(resolveAppendTarget(db, '', NOW, WINDOW)).toEqual({ action: 'create' });
  });

  test('key with no matching run → create', () => {
    expect(resolveAppendTarget(db, 'build-1', NOW, WINDOW)).toEqual({ action: 'create' });
  });

  test('key within window → append to newest matching run', () => {
    addRun(1, { runKey: 'build-1', createdAt: new Date(NOW - 1000).toISOString() });
    addRun(2, { runKey: 'build-1', createdAt: new Date(NOW - 500).toISOString() });
    expect(resolveAppendTarget(db, 'build-1', NOW, WINDOW)).toEqual({ action: 'append', runId: 2 });
  });

  test('key past window → expired', () => {
    addRun(1, { runKey: 'build-1', createdAt: new Date(NOW - (WINDOW + 1000)).toISOString() });
    expect(resolveAppendTarget(db, 'build-1', NOW, WINDOW)).toEqual({ action: 'expired' });
  });

  test('boundary: exactly at the window edge still appends', () => {
    addRun(1, { runKey: 'k', createdAt: new Date(NOW - WINDOW).toISOString() });
    expect(resolveAppendTarget(db, 'k', NOW, WINDOW)).toEqual({ action: 'append', runId: 1 });
  });
});

describe('computeTrend + getTestHistory', () => {
  test('trend returns chronological points scoped by branch', () => {
    addRun(1, { branch: 'main' });
    addRun(2, { branch: 'dev' });
    addRun(3, { branch: 'main' });
    ensureTest(1, 's', 'a', 1);
    for (const r of [1, 2, 3]) addResult(1, r, 'passed');
    for (const r of [1, 2, 3]) recomputeRunCounters(db, r);

    const all = computeTrend(db, { limit: 10 });
    expect(all.map((p) => p.runId)).toEqual([1, 2, 3]); // chronological

    const main = computeTrend(db, { branch: 'main' });
    expect(main.map((p) => p.runId)).toEqual([1, 3]);
  });

  test('test history is newest-run-first with decoded status', () => {
    addRun(1);
    addRun(2);
    ensureTest(1, 's', 'a', 1);
    addResult(1, 1, 'passed');
    addResult(1, 2, 'failed');
    const history = getTestHistory(db, 1);
    expect(history.map((h) => [h.runId, h.status])).toEqual([
      [2, 'failed'],
      [1, 'passed'],
    ]);
  });
});

describe('resolveRunRef', () => {
  beforeEach(() => {
    addRun(1, { branch: 'main' });
    addRun(2, { branch: 'pr' });
    addRun(3, { branch: 'main' });
  });

  test('explicit run id that exists resolves', () => {
    expect(resolveRunRef(db, { runId: 2 })).toEqual({ ok: true, runId: 2 });
  });

  test('unknown run id → run_not_found', () => {
    expect(resolveRunRef(db, { runId: 999 })).toEqual({ ok: false, reason: 'run_not_found' });
  });

  test('branch resolves to the latest run on that branch', () => {
    expect(resolveRunRef(db, { branch: 'main' })).toEqual({ ok: true, runId: 3 });
  });

  test('branch with no runs → branch_empty', () => {
    expect(resolveRunRef(db, { branch: 'nope' })).toEqual({ ok: false, reason: 'branch_empty', branch: 'nope' });
  });

  test('neither id nor branch → missing_input', () => {
    expect(resolveRunRef(db, {})).toEqual({ ok: false, reason: 'missing_input' });
  });

  test('run id takes precedence over branch', () => {
    expect(resolveRunRef(db, { runId: 1, branch: 'pr' })).toEqual({ ok: true, runId: 1 });
  });
});

describe('compareRuns — classification matrix', () => {
  // Seed one test id per transition across base run 1 and head run 2.
  // `undefined` in either slot means "absent" (no result row uploaded).
  function seedTransition(testId: number, base: TestStatus | undefined, head: TestStatus | undefined) {
    ensureTest(testId, 'suite', `t${testId}`, 1);
    if (base !== undefined) addResult(testId, 1, base);
    if (head !== undefined) addResult(testId, 2, head);
  }

  beforeEach(() => {
    addRun(1);
    addRun(2);
  });

  test('every transition lands in the expected category', () => {
    const cases: Array<[TestStatus | undefined, TestStatus | undefined, string | null]> = [
      ['passed', 'failed', 'newlyFailing'],
      ['passed', 'error', 'newlyFailing'],
      ['skipped', 'failed', 'newlyFailing'],
      [undefined, 'failed', 'newlyFailing'], // brand-new failing test → newlyFailing, not newTests
      ['failed', 'passed', 'newlyFixed'],
      ['error', 'passed', 'newlyFixed'],
      ['failed', 'failed', 'stillFailing'],
      ['error', 'error', 'stillFailing'],
      ['failed', 'error', 'stillFailing'],
      [undefined, 'passed', 'newTests'],
      [undefined, 'skipped', 'newTests'],
      ['passed', undefined, 'removedTests'],
      ['failed', undefined, 'removedTests'],
      // neutral / "other" (not returned in any detail bucket)
      ['passed', 'passed', null],
      ['passed', 'skipped', null],
      ['skipped', 'passed', null],
      ['failed', 'skipped', null], // skipping is not fixing
      ['skipped', 'skipped', null],
    ];
    cases.forEach(([base, head], i) => seedTransition(i + 1, base, head));

    const { summary, categories } = compareRuns(db, 1, 2);
    const idsIn = (cat: keyof typeof categories) => categories[cat].tests.map((t) => t.testId).sort((a, b) => a - b);

    expect(idsIn('newlyFailing')).toEqual([1, 2, 3, 4]);
    expect(idsIn('newlyFixed')).toEqual([5, 6]);
    expect(idsIn('stillFailing')).toEqual([7, 8, 9]);
    expect(idsIn('newTests')).toEqual([10, 11]);
    expect(idsIn('removedTests')).toEqual([12, 13]);
    expect(summary.other).toBe(5);
    expect(summary.regressions).toBe(4);
    expect(summary.fixed).toBe(2);
  });

  test('absent status is surfaced on the compared test row', () => {
    seedTransition(1, undefined, 'failed');
    seedTransition(2, 'passed', undefined);
    const { categories } = compareRuns(db, 1, 2);
    expect(categories.newlyFailing.tests[0]).toMatchObject({ baseStatus: 'absent', headStatus: 'failed' });
    expect(categories.removedTests.tests[0]).toMatchObject({ baseStatus: 'passed', headStatus: 'absent' });
  });

  test('base == head → no changes; still-failing reflects that run', () => {
    seedTransition(1, 'passed', 'passed');
    seedTransition(2, 'failed', 'failed');
    const { summary } = compareRuns(db, 1, 1);
    expect(summary).toMatchObject({ regressions: 0, fixed: 0, newTests: 0, removedTests: 0, stillFailing: 1 });
    expect(summary.totalDelta).toBe(0);
    expect(summary.durationDeltaMs).toBeNull(); // seeded runs have no duration → delta unknown
  });

  test('summary deltas come from the run counters', () => {
    seedTransition(1, 'passed', 'failed');
    seedTransition(2, 'passed', 'passed');
    recomputeRunCounters(db, 1);
    recomputeRunCounters(db, 2);
    const { summary } = compareRuns(db, 1, 2);
    expect(summary.passedDelta).toBe(-1); // 2 passed → 1 passed
    expect(summary.failedDelta).toBe(1);
    expect(summary.totalDelta).toBe(0);
  });

  test('detail lists are capped at limit; totals stay exact', () => {
    for (let i = 1; i <= 5; i++) seedTransition(i, 'passed', 'failed');
    const { summary, categories } = compareRuns(db, 1, 2, { limit: 2 });
    expect(summary.regressions).toBe(5); // exact
    expect(categories.newlyFailing.tests).toHaveLength(2); // capped
    expect(categories.newlyFailing.truncated).toBe(true);
  });
});

describe('formatComparisonMarkdown', () => {
  function comparison(overrides: Partial<RunSummary> = {}): Parameters<typeof formatComparisonMarkdown>[0] {
    const base: RunSummary = {
      id: 1, createdAt: '2026-01-01T00:00:00Z', startedAt: null, durationMs: 1000,
      label: null, branch: 'main', commitSha: 'abcdef1234', ciUrl: null, uploads: [],
      total: 3, passed: 3, failed: 0, errored: 0, skipped: 0,
    };
    const head: RunSummary = { ...base, id: 2, branch: 'pr', durationMs: 1500, passed: 2, failed: 1, ...overrides };
    return {
      base, head,
      summary: {
        regressions: 1, fixed: 0, stillFailing: 0, newTests: 0, removedTests: 0, other: 2,
        passedDelta: -1, failedDelta: 1, erroredDelta: 0, skippedDelta: 0, totalDelta: 0, durationDeltaMs: 500,
      },
      categories: {
        newlyFailing: { total: 1, truncated: false, tests: [{ testId: 1, suite: 'suite', name: 'the_test', baseStatus: 'passed', headStatus: 'failed', baseDurationMs: 1, headDurationMs: 1 }] },
        newlyFixed: { total: 0, truncated: false, tests: [] },
        stillFailing: { total: 0, truncated: false, tests: [] },
        newTests: { total: 0, truncated: false, tests: [] },
        removedTests: { total: 0, truncated: false, tests: [] },
      },
    };
  }

  test('includes the regression count, the failing test, and the marker', () => {
    const md = formatComparisonMarkdown(comparison());
    expect(md).toContain('1 newly failing');
    expect(md).toContain('suite › the_test');
    expect(md).toContain('#1');
    expect(md).toContain('#2');
    expect(md).toContain(COMPARE_MARKER);
  });

  test('no regressions → green verdict, no Newly failing section', () => {
    const c = comparison();
    c.summary.regressions = 0;
    c.categories.newlyFailing = { total: 0, truncated: false, tests: [] };
    const md = formatComparisonMarkdown(c);
    expect(md).toContain('no new failures');
    expect(md).not.toContain('#### Newly failing');
  });
});
