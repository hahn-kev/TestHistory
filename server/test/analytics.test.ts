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
} from '../src/analytics/analytics.js';
import type { TestStatus } from '@testhistory/shared';

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
