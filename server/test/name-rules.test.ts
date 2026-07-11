import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { makeApp, setupAdmin, type TestApp } from './helpers.js';

let t: TestApp;
let admin: string;
let projectId: string;

async function upload(xml: string): Promise<any> {
  const res = await t.app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/runs?format=junit`,
    headers: { cookie: admin, 'content-type': 'application/xml' },
    payload: xml,
  });
  if (res.statusCode >= 300) throw new Error(`upload ${res.statusCode}: ${res.body}`);
  return res.json().run;
}

function param(seed: number): string {
  return `<testsuites><testsuite name="s"><testcase classname="pkg.P" name="case[seed=${seed}]"/></testsuite></testsuites>`;
}

beforeEach(async () => {
  t = await makeApp();
  admin = await setupAdmin(t.app);
  const pr = await t.app.inject({ method: 'POST', url: '/api/projects', headers: { cookie: admin }, payload: { name: 'NR' } });
  projectId = pr.json().project.id;
});
afterEach(async () => {
  await t.close();
});

describe('name-rules CRUD', () => {
  test('GET empty, PUT replaces, GET reflects order', async () => {
    let res = await t.app.inject({ method: 'GET', url: `/api/projects/${projectId}/name-rules`, headers: { cookie: admin } });
    expect(res.json().rules).toEqual([]);

    const rules = [
      { match: '\\[seed=\\d+\\]', rewrite: '[seed]' },
      { match: 'foo', rewrite: 'bar' },
    ];
    res = await t.app.inject({ method: 'PUT', url: `/api/projects/${projectId}/name-rules`, headers: { cookie: admin }, payload: { rules } });
    expect(res.statusCode).toBe(200);

    res = await t.app.inject({ method: 'GET', url: `/api/projects/${projectId}/name-rules`, headers: { cookie: admin } });
    expect(res.json().rules).toEqual(rules);
  });

  test('bad regex rejected on PUT and preview', async () => {
    const bad = { rules: [{ match: '[unterminated', rewrite: 'x' }] };
    const put = await t.app.inject({ method: 'PUT', url: `/api/projects/${projectId}/name-rules`, headers: { cookie: admin }, payload: bad });
    expect(put.statusCode).toBe(400);
    expect(put.json().error.code).toBe('BAD_REGEX');

    const prev = await t.app.inject({ method: 'POST', url: `/api/projects/${projectId}/name-rules/preview`, headers: { cookie: admin }, payload: bad });
    expect(prev.statusCode).toBe(400);
    expect(prev.json().error.code).toBe('BAD_REGEX');
  });
});

describe('preview', () => {
  test('returns before/after against recent test names without persisting', async () => {
    await upload(param(1));
    await upload(param(2));
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/name-rules/preview`,
      headers: { cookie: admin },
      payload: { rules: [{ match: '\\[seed=\\d+\\]', rewrite: '[seed]' }] },
    });
    const samples = res.json().samples;
    expect(samples.length).toBe(2);
    expect(samples.every((s: any) => s.after.name === 'case[seed]')).toBe(true);
    // Not persisted: no rules stored.
    const stored = await t.app.inject({ method: 'GET', url: `/api/projects/${projectId}/name-rules`, headers: { cookie: admin } });
    expect(stored.json().rules).toEqual([]);
  });
});

describe('end-to-end application (ADR-0002)', () => {
  test('a saved rule collapses subsequent uploads without retro-merging existing tests', async () => {
    // Before any rule: two distinct volatile identities.
    await upload(param(1));
    await upload(param(2));
    let tests = await t.app.inject({ method: 'GET', url: `/api/projects/${projectId}/tests`, headers: { cookie: admin } });
    expect(tests.json().tests).toHaveLength(2);

    // Save a rule.
    await t.app.inject({ method: 'PUT', url: `/api/projects/${projectId}/name-rules`, headers: { cookie: admin }, payload: { rules: [{ match: '\\[seed=\\d+\\]', rewrite: '[seed]' }] } });

    // New uploads collapse to a single stable identity.
    await upload(param(3));
    await upload(param(4));
    tests = await t.app.inject({ method: 'GET', url: `/api/projects/${projectId}/tests`, headers: { cookie: admin } });
    const names = tests.json().tests.map((tt: { name: string }) => tt.name).sort();
    // Existing two are untouched (no retro merge); the new uploads collapsed to one.
    const collapsed = 'case[seed]';
    expect(names).toEqual([collapsed, 'case[seed=1]', 'case[seed=2]'].sort());
  });
});
