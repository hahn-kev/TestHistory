import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { applyConnectionPragmas, migrate } from '../src/db/migrate.js';
import { projectMigrations } from '../src/db/migrations/project.js';
import { ingest, IngestError } from '../src/ingest/ingest-core.js';
import { makeApp, setupAdmin, type TestApp } from './helpers.js';
import type { ResultFormat } from '@testhistory/shared';

const FIX = fileURLToPath(new URL('./fixtures/', import.meta.url));
const fx = (name: string) => path.join(FIX, name);

function tempDbFile(): { path: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'th-ing-'));
  return { path: path.join(dir, 'p.db'), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function openMigrated(dbPath: string) {
  const db = new Database(dbPath);
  applyConnectionPragmas(db);
  migrate(db, projectMigrations);
  return db;
}

const NOW = '2026-06-01T00:00:00.000Z';

describe('ingest() core — per-format counters', () => {
  test.each<[string, ResultFormat, { total: number; passed: number; failed: number; errored: number; skipped: number }]>([
    ['junit-mixed.xml', 'junit', { total: 4, passed: 1, failed: 1, errored: 1, skipped: 1 }],
    ['nunit2-mixed.xml', 'nunit2', { total: 4, passed: 1, failed: 1, errored: 1, skipped: 1 }],
    ['nunit3-mixed.xml', 'nunit3', { total: 4, passed: 1, failed: 1, errored: 1, skipped: 1 }],
    ['xunit-mixed.xml', 'xunit', { total: 3, passed: 1, failed: 1, errored: 0, skipped: 1 }],
    ['trx-mixed.xml', 'trx', { total: 3, passed: 1, failed: 1, errored: 0, skipped: 1 }],
  ])('%s → counts', async (file, format, expected) => {
    const t = tempDbFile();
    const db = openMigrated(t.path);
    try {
      const { run, created } = await ingest(db, {
        dbPath: t.path,
        files: [{ tempPath: fx(file), fileName: file, fileSize: fs.statSync(fx(file)).size, format }],
        meta: { runKey: null, branch: 'main', commitSha: null, label: null, ciUrl: null, startedAt: null },
        now: NOW,
        windowMs: 3_600_000,
      });
      expect(created).toBe(true);
      expect({ total: run.total, passed: run.passed, failed: run.failed, errored: run.errored, skipped: run.skipped }).toEqual(expected);
      expect(run.uploads).toHaveLength(1);
      expect(run.uploads[0].format).toBe(format);
    } finally {
      db.close();
      t.cleanup();
    }
  });

  test('parse error rolls back the whole POST', async () => {
    const t = tempDbFile();
    const db = openMigrated(t.path);
    const badFile = path.join(path.dirname(t.path), 'bad.xml');
    fs.writeFileSync(badFile, '<testsuites><testcase name="x"'); // truncated, invalid
    try {
      await expect(
        ingest(db, {
          dbPath: t.path,
          files: [{ tempPath: badFile, fileName: 'bad.xml', fileSize: 20, format: 'junit' }],
          meta: { runKey: null, branch: null, commitSha: null, label: null, ciUrl: null, startedAt: null },
          now: NOW,
          windowMs: 3_600_000,
        }),
      ).rejects.toBeInstanceOf(IngestError);
      // No run persisted.
      expect((db.prepare('SELECT COUNT(*) AS n FROM runs').get() as { n: number }).n).toBe(0);
    } finally {
      db.close();
      t.cleanup();
    }
  });

  test('name rules collapse volatile names at ingest', async () => {
    const t = tempDbFile();
    const db = openMigrated(t.path);
    const f = path.join(path.dirname(t.path), 'param.xml');
    fs.writeFileSync(
      f,
      `<testsuites><testsuite name="s">
        <testcase classname="pkg.Param" name="case[seed=123]"/>
        <testcase classname="pkg.Param" name="case[seed=456]"/>
      </testsuite></testsuites>`,
    );
    try {
      const { run } = await ingest(db, {
        dbPath: t.path,
        files: [{ tempPath: f, fileName: 'param.xml', fileSize: 100, format: 'junit' }],
        meta: { runKey: null, branch: null, commitSha: null, label: null, ciUrl: null, startedAt: null },
        now: NOW,
        windowMs: 3_600_000,
        nameRules: [{ match: '\\[seed=\\d+\\]', rewrite: '[seed]' }],
      });
      // Both collapse to one identity → 1 test, and case_count records that two
      // raw cases merged so an unintended collapse is detectable after the fact.
      expect(run.total).toBe(1);
      const names = (db.prepare('SELECT name FROM tests').all() as { name: string }[]).map((r) => r.name);
      expect(names).toEqual(['case[seed]']);
      const counts = db.prepare('SELECT case_count FROM results').all() as { case_count: number }[];
      expect(counts).toEqual([{ case_count: 2 }]);
    } finally {
      db.close();
      t.cleanup();
    }
  });

  test('colliding rows merge worst-status-wins and count the collision', async () => {
    const t = tempDbFile();
    const db = openMigrated(t.path);
    // Two xUnit <test> rows with the same (type, method): the FIRST fails, the
    // second passes. Worst-wins must keep the failure — never mask it by order.
    const f = path.join(path.dirname(t.path), 'dup.xml');
    fs.writeFileSync(
      f,
      `<assembly name="Dup.dll" total="2"><collection name="c">
        <test name="Ns.Fix.T" type="Ns.Fix" method="T" result="Fail" time="0.01">
          <failure><message>boom</message></failure>
        </test>
        <test name="Ns.Fix.T" type="Ns.Fix" method="T" result="Pass" time="0.02"/>
      </collection></assembly>`,
    );
    try {
      const { run } = await ingest(db, {
        dbPath: t.path,
        files: [{ tempPath: f, fileName: 'dup.xml', fileSize: 100, format: 'xunit' }],
        meta: { runKey: null, branch: null, commitSha: null, label: null, ciUrl: null, startedAt: null },
        now: NOW,
        windowMs: 3_600_000,
      });
      // One merged test, recorded as failed (not the later pass), and flagged dup.
      expect({ total: run.total, failed: run.failed, passed: run.passed }).toMatchObject({ total: 1, failed: 1, passed: 0 });
      const row = db.prepare('SELECT status, message, case_count FROM results').get() as {
        status: number;
        message: string | null;
        case_count: number;
      };
      expect(row).toEqual({ status: 1, message: 'boom', case_count: 2 });
    } finally {
      db.close();
      t.cleanup();
    }
  });
});

/** Minimal JUnit fixture path for CI Job Outcome ingest-core tests. */
const JUNIT_MIXED = fx('junit-mixed.xml');
const JUNIT_FILE = () => ({
  tempPath: JUNIT_MIXED,
  fileName: 'junit-mixed.xml',
  fileSize: fs.statSync(JUNIT_MIXED).size,
  format: 'junit' as const,
});
const baseMeta = () => ({
  runKey: null as string | null,
  branch: null as string | null,
  commitSha: null as string | null,
  label: null as string | null,
  ciUrl: null as string | null,
  startedAt: null as string | null,
  ciJobOutcome: null as 'failed' | 'cancelled' | null,
});

describe('ingest() core — CI Job Outcome', () => {
  test('create with outcome omitted leaves CI Job Outcome unset', async () => {
    const t = tempDbFile();
    const db = openMigrated(t.path);
    try {
      const { run } = await ingest(db, {
        dbPath: t.path,
        files: [JUNIT_FILE()],
        meta: baseMeta(),
        now: NOW,
        windowMs: 3_600_000,
      });
      expect(run.ciJobOutcome).toBeNull();
    } finally {
      db.close();
      t.cleanup();
    }
  });

  test('create with failed / cancelled sets CI Job Outcome', async () => {
    const t = tempDbFile();
    const db = openMigrated(t.path);
    try {
      const failed = await ingest(db, {
        dbPath: t.path,
        files: [JUNIT_FILE()],
        meta: { ...baseMeta(), ciJobOutcome: 'failed' },
        now: NOW,
        windowMs: 3_600_000,
      });
      expect(failed.run.ciJobOutcome).toBe('failed');

      const cancelled = await ingest(db, {
        dbPath: t.path,
        files: [JUNIT_FILE()],
        meta: { ...baseMeta(), ciJobOutcome: 'cancelled' },
        now: NOW,
        windowMs: 3_600_000,
      });
      expect(cancelled.run.ciJobOutcome).toBe('cancelled');
    } finally {
      db.close();
      t.cleanup();
    }
  });

  test('append with omitted outcome does not clear sticky trouble', async () => {
    const t = tempDbFile();
    const db = openMigrated(t.path);
    try {
      const first = await ingest(db, {
        dbPath: t.path,
        files: [JUNIT_FILE()],
        meta: { ...baseMeta(), runKey: 'build-1', ciJobOutcome: 'failed' },
        now: NOW,
        windowMs: 3_600_000,
      });
      expect(first.created).toBe(true);
      expect(first.run.ciJobOutcome).toBe('failed');

      const second = await ingest(db, {
        dbPath: t.path,
        files: [JUNIT_FILE()],
        meta: { ...baseMeta(), runKey: 'build-1', ciJobOutcome: null },
        now: '2026-06-01T00:30:00.000Z',
        windowMs: 3_600_000,
      });
      expect(second.created).toBe(false);
      expect(second.run.id).toBe(first.run.id);
      expect(second.run.ciJobOutcome).toBe('failed');
    } finally {
      db.close();
      t.cleanup();
    }
  });

  test('across uploads, cancelled is preferred over failed', async () => {
    const t = tempDbFile();
    const db = openMigrated(t.path);
    try {
      const first = await ingest(db, {
        dbPath: t.path,
        files: [JUNIT_FILE()],
        meta: { ...baseMeta(), runKey: 'build-2', ciJobOutcome: 'failed' },
        now: NOW,
        windowMs: 3_600_000,
      });
      expect(first.run.ciJobOutcome).toBe('failed');

      const second = await ingest(db, {
        dbPath: t.path,
        files: [JUNIT_FILE()],
        meta: { ...baseMeta(), runKey: 'build-2', ciJobOutcome: 'cancelled' },
        now: '2026-06-01T00:30:00.000Z',
        windowMs: 3_600_000,
      });
      expect(second.created).toBe(false);
      expect(second.run.ciJobOutcome).toBe('cancelled');

      // Later failed must not downgrade cancelled.
      const third = await ingest(db, {
        dbPath: t.path,
        files: [JUNIT_FILE()],
        meta: { ...baseMeta(), runKey: 'build-2', ciJobOutcome: 'failed' },
        now: '2026-06-01T00:45:00.000Z',
        windowMs: 3_600_000,
      });
      expect(third.run.ciJobOutcome).toBe('cancelled');
    } finally {
      db.close();
      t.cleanup();
    }
  });
});

describe('upload route (worker pool + queue)', () => {
  let t: TestApp;
  let admin: string;
  let projectId: string;
  let token: string;

  beforeEach(async () => {
    t = await makeApp({ maxUploadBytes: 200 * 1024 * 1024 });
    admin = await setupAdmin(t.app);
    const pr = await t.app.inject({ method: 'POST', url: '/api/projects', headers: { cookie: admin }, payload: { name: 'Ingest' } });
    projectId = pr.json().project.id;
    const tk = await t.app.inject({ method: 'POST', url: `/api/projects/${projectId}/tokens`, headers: { cookie: admin }, payload: { name: 'ci' } });
    token = tk.json().token;
  });
  afterEach(async () => {
    await t.close();
  });

  test('raw-body upload with bearer token → 201 with counts', async () => {
    const xml = fs.readFileSync(fx('junit-mixed.xml'));
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/runs?branch=main`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/xml' },
      payload: xml,
    });
    expect(res.statusCode).toBe(201);
    const run = res.json().run;
    expect({ total: run.total, passed: run.passed, failed: run.failed, errored: run.errored, skipped: run.skipped }).toEqual({ total: 4, passed: 1, failed: 1, errored: 1, skipped: 1 });
    expect(run.branch).toBe('main');
    expect(run.ciJobOutcome).toBeNull();
  });

  test('query ci_job_outcome is accepted and returned on the run', async () => {
    const xml = fs.readFileSync(fx('junit-mixed.xml'));
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/runs?branch=main&ci_job_outcome=cancelled`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/xml' },
      payload: xml,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().run.ciJobOutcome).toBe('cancelled');

    const detail = await t.app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/runs/${res.json().run.id}`,
      headers: { cookie: admin },
    });
    expect(detail.json().run.ciJobOutcome).toBe('cancelled');

    const list = await t.app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/runs`,
      headers: { cookie: admin },
    });
    expect(list.json().runs[0].ciJobOutcome).toBe('cancelled');
  });

  test('session member upload works', async () => {
    const xml = fs.readFileSync(fx('xunit-mixed.xml'));
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/runs?format=xunit`,
      headers: { cookie: admin, 'content-type': 'application/xml' },
      payload: xml,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().run.total).toBe(3);
  });

  test('undetectable format → 415', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/runs`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/xml' },
      payload: '<nonsense>no root we know</nonsense>',
    });
    expect(res.statusCode).toBe(415);
    expect(res.json().error.code).toBe('UNKNOWN_FORMAT');
  });

  test('malformed XML → 422 PARSE_ERROR', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/runs?format=junit`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/xml' },
      payload: '<testsuites><testcase name="x"',
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('PARSE_ERROR');
  });

  test('oversized body → 413', async () => {
    const small = await makeApp({ maxUploadBytes: 1024 });
    try {
      const admin2 = await setupAdmin(small.app);
      const pr = await small.app.inject({ method: 'POST', url: '/api/projects', headers: { cookie: admin2 }, payload: { name: 'P' } });
      const pid = pr.json().project.id;
      const big = '<testsuites>' + '<testcase classname="c" name="n"/>'.repeat(200) + '</testsuites>';
      const res = await small.app.inject({
        method: 'POST',
        url: `/api/projects/${pid}/runs?format=junit`,
        headers: { cookie: admin2, 'content-type': 'application/xml' },
        payload: big,
      });
      expect(res.statusCode).toBe(413);
      expect(res.json().error.code).toBe('TOO_LARGE');
    } finally {
      await small.close();
    }
  });

  test('anonymous upload (no session, no token) → 404 (access model hides the project)', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/runs?format=junit`,
      headers: { 'content-type': 'application/xml' },
      payload: '<testsuites/>',
    });
    expect(res.statusCode).toBe(404);
  });

  test('anonymous application/xml POST leaves no temp file in DATA_DIR/tmp', async () => {
    const tmp = path.join(t.dataDir, 'tmp');
    // Fresh app: nothing has been streamed yet, so the tmp dir does not exist.
    // (streamToTempFile is what lazily creates it.)
    expect(fs.existsSync(tmp)).toBe(false);

    const res = await t.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/runs?format=junit`,
      headers: { 'content-type': 'application/xml' },
      payload: '<testsuites><testcase classname="c" name="n"/></testsuites>',
    });
    expect(res.statusCode).toBe(404);

    // The content-type parser rejected the request before streaming, so no
    // temp file was ever written — the tmp dir was never even created. (The
    // onResponse sweep would remove a leftover file, but here there is nothing
    // to sweep because nothing was written in the first place.)
    const leftovers = fs.existsSync(tmp) ? fs.readdirSync(tmp) : [];
    expect(leftovers).toEqual([]);
    expect(fs.existsSync(tmp)).toBe(false);
  });

  test('invalid bearer token → 401', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/runs?format=junit`,
      headers: { authorization: 'Bearer tht_notarealtoken', 'content-type': 'application/xml' },
      payload: '<testsuites/>',
    });
    expect(res.statusCode).toBe(401);
  });

  test('latency probe: /api/auth/me stays fast during a large ingest', async () => {
    const { generateHugeJUnit } = await import('./fixtures/huge-gen.js');
    const bigPath = path.join(t.dataDir, 'huge.xml');
    await generateHugeJUnit(bigPath, 25 * 1024 * 1024);
    const xml = fs.readFileSync(bigPath);

    const uploadPromise = t.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/runs?format=junit`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/xml' },
      payload: xml,
    });

    // Probe the event loop while the worker parses/inserts off-thread.
    const samples: number[] = [];
    for (let i = 0; i < 10; i++) {
      const start = process.hrtime.bigint();
      const res = await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: admin } });
      samples.push(Number(process.hrtime.bigint() - start) / 1e6);
      expect(res.statusCode).toBe(200);
      await new Promise((r) => setTimeout(r, 20));
    }

    const up = await uploadPromise;
    expect(up.statusCode).toBe(201);
    expect(up.json().run.total).toBeGreaterThan(1000);
    // The event loop stays responsive: the typical /me latency is well under
    // 50ms (the worker does the parse off-thread). Use the median so a single
    // GC/scheduling spike under full-suite worker contention doesn't flake the
    // signal, and assert no probe is catastrophically blocked.
    const sorted = [...samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    expect(median).toBeLessThan(50);
    expect(Math.max(...samples)).toBeLessThan(250);
    fs.rmSync(bigPath, { force: true });
  }, 30_000);
});
