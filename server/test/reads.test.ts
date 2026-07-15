import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeApp, setupAdmin, login, createUser, type TestApp } from './helpers.js';

const FIX = fileURLToPath(new URL('./fixtures/', import.meta.url));
const fx = (name: string) => fs.readFileSync(path.join(FIX, name), 'utf8');

let t: TestApp;
let admin: string;
let projectId: string;

/** Upload one raw-body run; returns the run summary. */
async function upload(xml: string, query = ''): Promise<any> {
  const res = await t.app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/runs${query}`,
    headers: { cookie: admin, 'content-type': 'application/xml' },
    payload: xml,
  });
  if (res.statusCode >= 300) throw new Error(`upload failed ${res.statusCode}: ${res.body}`);
  return res.json().run;
}

/** A tiny JUnit doc with one test at a given status, for building history. */
function oneTest(status: 'pass' | 'fail'): string {
  const body =
    status === 'pass'
      ? '<testcase classname="pkg.Suite" name="the_test" time="0.01"/>'
      : '<testcase classname="pkg.Suite" name="the_test" time="0.01"><failure message="boom">stack</failure></testcase>';
  return `<testsuites><testsuite name="s">${body}</testsuite></testsuites>`;
}

beforeEach(async () => {
  t = await makeApp();
  admin = await setupAdmin(t.app);
  const pr = await t.app.inject({ method: 'POST', url: '/api/projects', headers: { cookie: admin }, payload: { name: 'Reads' } });
  projectId = pr.json().project.id;
});
afterEach(async () => {
  await t.close();
});

describe('runs list + detail', () => {
  test('lists newest-first and paginates by cursor', async () => {
    for (let i = 0; i < 3; i++) await upload(fx('junit-mixed.xml'), `?branch=main`);
    const res = await t.app.inject({ method: 'GET', url: `/api/projects/${projectId}/runs?limit=2`, headers: { cookie: admin } });
    const body = res.json();
    expect(body.runs).toHaveLength(2);
    expect(body.runs[0].id).toBeGreaterThan(body.runs[1].id); // newest first
    expect(body.nextCursor).toBe(body.runs[1].id);

    const page2 = await t.app.inject({ method: 'GET', url: `/api/projects/${projectId}/runs?limit=2&cursor=${body.nextCursor}`, headers: { cookie: admin } });
    expect(page2.json().runs).toHaveLength(1);
    expect(page2.json().nextCursor).toBe(null);
  });

  test('run detail includes uploads + counts + suites; 404 for missing', async () => {
    const run = await upload(fx('junit-mixed.xml'));
    const res = await t.app.inject({ method: 'GET', url: `/api/projects/${projectId}/runs/${run.id}`, headers: { cookie: admin } });
    expect(res.json().run.uploads).toHaveLength(1);
    expect(res.json().run.total).toBe(4);
    expect(res.json().suites).toEqual(['math.AddTest', 'math.DivTest']);
    const missing = await t.app.inject({ method: 'GET', url: `/api/projects/${projectId}/runs/9999`, headers: { cookie: admin } });
    expect(missing.statusCode).toBe(404);
  });
});

describe('results listing', () => {
  test('status filter + text search', async () => {
    const run = await upload(fx('junit-mixed.xml'));
    const failed = await t.app.inject({ method: 'GET', url: `/api/projects/${projectId}/runs/${run.id}/results?status=failed`, headers: { cookie: admin } });
    const fr = failed.json().results;
    expect(fr).toHaveLength(1);
    expect(fr[0].status).toBe('failed');

    const search = await t.app.inject({ method: 'GET', url: `/api/projects/${projectId}/runs/${run.id}/results?search=divide`, headers: { cookie: admin } });
    expect(search.json().results.every((r: { name: string }) => /divide/i.test(r.name))).toBe(true);
    expect(search.json().results.length).toBeGreaterThan(0);
  });

  test('exact suite filter + cursor pagination', async () => {
    const run = await upload(fx('junit-mixed.xml'));

    const bySuite = await t.app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/runs/${run.id}/results?suite=${encodeURIComponent('math.AddTest')}`,
      headers: { cookie: admin },
    });
    const suiteResults = bySuite.json().results;
    expect(suiteResults).toHaveLength(2);
    expect(suiteResults.every((r: { suite: string }) => r.suite === 'math.AddTest')).toBe(true);

    const page1 = await t.app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/runs/${run.id}/results?limit=2`,
      headers: { cookie: admin },
    });
    expect(page1.json().results).toHaveLength(2);
    // Cursor is an offset: next page starts after the 2 rows just returned.
    expect(page1.json().nextCursor).toBe(2);

    const page2 = await t.app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/runs/${run.id}/results?limit=2&cursor=${page1.json().nextCursor}`,
      headers: { cookie: admin },
    });
    expect(page2.json().results).toHaveLength(2);
    expect(page2.json().nextCursor).toBe(null);
    const allIds = [...page1.json().results, ...page2.json().results].map((r: { testId: number }) => r.testId);
    expect(new Set(allIds).size).toBe(4);
  });

  test('default sort puts failed/error first, passed last; sort by name and duration', async () => {
    const run = await upload(fx('junit-mixed.xml'));

    const def = await t.app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/runs/${run.id}/results`,
      headers: { cookie: admin },
    });
    const statuses = def.json().results.map((r: { status: string }) => r.status);
    const rank: Record<string, number> = { failed: 0, error: 1, skipped: 2, passed: 3 };
    const ranks = statuses.map((s: string) => rank[s]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));

    const byName = await t.app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/runs/${run.id}/results?sort=name&dir=asc`,
      headers: { cookie: admin },
    });
    const names = byName.json().results.map((r: { name: string }) => r.name);
    expect(names).toEqual([...names].sort());

    const byDur = await t.app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/runs/${run.id}/results?sort=duration&dir=desc`,
      headers: { cookie: admin },
    });
    const durs = byDur.json().results.map((r: { durationMs: number }) => r.durationMs);
    expect(durs).toEqual([...durs].sort((a, b) => b - a));
  });
});

describe('trend + flaky + branch scoping', () => {
  test('trend chronological; flaky surfaces a flipped test; branch filter scopes both', async () => {
    // main: pass, fail, pass → flaky (2 flips). dev: one pass.
    await upload(oneTest('pass'), '?branch=main');
    await upload(oneTest('pass'), '?branch=dev');
    await upload(oneTest('fail'), '?branch=main');
    await upload(oneTest('pass'), '?branch=main');

    const trend = await t.app.inject({ method: 'GET', url: `/api/projects/${projectId}/trend`, headers: { cookie: admin } });
    const points = trend.json().trend;
    expect(points.map((p: { runId: number }) => p.runId)).toEqual([...points].map((p) => p.runId).sort((a, b) => a - b)); // chronological

    const mainTrend = await t.app.inject({ method: 'GET', url: `/api/projects/${projectId}/trend?branch=main`, headers: { cookie: admin } });
    expect(mainTrend.json().trend).toHaveLength(3);

    const flakyMain = await t.app.inject({ method: 'GET', url: `/api/projects/${projectId}/flaky?branch=main`, headers: { cookie: admin } });
    expect(flakyMain.json().flaky).toHaveLength(1);
    expect(flakyMain.json().flaky[0].name).toBe('the_test');

    const flakyDev = await t.app.inject({ method: 'GET', url: `/api/projects/${projectId}/flaky?branch=dev`, headers: { cookie: admin } });
    expect(flakyDev.json().flaky).toEqual([]);
  });
});

describe('tests search + history', () => {
  test('search finds tests; history is newest-first; 404 for missing test', async () => {
    await upload(oneTest('pass'));
    await upload(oneTest('fail'));

    const search = await t.app.inject({ method: 'GET', url: `/api/projects/${projectId}/tests?search=the_test`, headers: { cookie: admin } });
    expect(search.json().tests).toHaveLength(1);
    const testId = search.json().tests[0].id;

    const hist = await t.app.inject({ method: 'GET', url: `/api/projects/${projectId}/tests/${testId}/history`, headers: { cookie: admin } });
    expect(hist.json().test.name).toBe('the_test');
    expect(hist.json().history.map((h: { status: string }) => h.status)).toEqual(['failed', 'passed']);

    const missing = await t.app.inject({ method: 'GET', url: `/api/projects/${projectId}/tests/9999/history`, headers: { cookie: admin } });
    expect(missing.statusCode).toBe(404);
  });
});

describe('run deletion', () => {
  test('DELETE removes the run and cascades results (member only)', async () => {
    const run = await upload(fx('junit-mixed.xml'));
    // Non-member viewer cannot delete.
    await createUser(t.app, admin, 'viewer@example.com');
    const viewer = await login(t.app, 'viewer@example.com', 'password123');
    const forbidden = await t.app.inject({ method: 'DELETE', url: `/api/projects/${projectId}/runs/${run.id}`, headers: { cookie: viewer } });
    expect(forbidden.statusCode).toBe(404); // non-member on member route

    const del = await t.app.inject({ method: 'DELETE', url: `/api/projects/${projectId}/runs/${run.id}`, headers: { cookie: admin } });
    expect(del.statusCode).toBe(200);

    const gone = await t.app.inject({ method: 'GET', url: `/api/projects/${projectId}/runs/${run.id}`, headers: { cookie: admin } });
    expect(gone.statusCode).toBe(404);
    // results gone too.
    const d = t.app.dbManager.get(projectId);
    expect((d.prepare('SELECT COUNT(*) AS n FROM results WHERE run_id = ?').get(run.id) as { n: number }).n).toBe(0);
  });
});

describe('viewer access', () => {
  test('non-private project readable by any signed-in user; private → 404', async () => {
    await upload(fx('junit-mixed.xml'));
    await createUser(t.app, admin, 'stranger@example.com');
    const stranger = await login(t.app, 'stranger@example.com', 'password123');

    const pub = await t.app.inject({ method: 'GET', url: `/api/projects/${projectId}/runs`, headers: { cookie: stranger } });
    expect(pub.statusCode).toBe(200);

    await t.app.inject({ method: 'PATCH', url: `/api/projects/${projectId}`, headers: { cookie: admin }, payload: { private: true } });
    const priv = await t.app.inject({ method: 'GET', url: `/api/projects/${projectId}/runs`, headers: { cookie: stranger } });
    expect(priv.statusCode).toBe(404);
  });

  test('anonymous can read non-private project data; private → 404; delete → 404', async () => {
    const run = await upload(fx('junit-mixed.xml'));

    const pub = await t.app.inject({ method: 'GET', url: `/api/projects/${projectId}/runs` });
    expect(pub.statusCode).toBe(200);
    expect(pub.json().runs.length).toBeGreaterThan(0);

    const detail = await t.app.inject({ method: 'GET', url: `/api/projects/${projectId}/runs/${run.id}` });
    expect(detail.statusCode).toBe(200);

    const del = await t.app.inject({ method: 'DELETE', url: `/api/projects/${projectId}/runs/${run.id}` });
    expect(del.statusCode).toBe(404);

    await t.app.inject({ method: 'PATCH', url: `/api/projects/${projectId}`, headers: { cookie: admin }, payload: { private: true } });
    const priv = await t.app.inject({ method: 'GET', url: `/api/projects/${projectId}/runs` });
    expect(priv.statusCode).toBe(404);
  });
});
