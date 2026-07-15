import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { makeApp, setupAdmin, login, createUser, type TestApp } from './helpers.js';

let t: TestApp;
let admin: string;
beforeEach(async () => {
  t = await makeApp();
  admin = await setupAdmin(t.app);
});
afterEach(async () => {
  await t.close();
});

async function createProject(cookie: string, name: string, priv = false): Promise<string> {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: { cookie },
    payload: { name, private: priv },
  });
  if (res.statusCode !== 201) throw new Error(`create failed ${res.statusCode}: ${res.body}`);
  return res.json().project.id as string;
}

async function upload(cookie: string, projectId: string, xml: string): Promise<void> {
  const res = await t.app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/runs`,
    headers: { cookie, 'content-type': 'application/xml' },
    payload: xml,
  });
  if (res.statusCode >= 300) throw new Error(`upload failed ${res.statusCode}: ${res.body}`);
}

const RUN_XML =
  '<testsuites><testsuite name="s"><testcase classname="pkg.Suite" name="a" time="0.01"/><testcase classname="pkg.Suite" name="b" time="0.01"/></testsuite></testsuites>';

describe('GET /api/admin/projects', () => {
  test('requires an admin', async () => {
    await createUser(t.app, admin, 'plain@example.com');
    const plain = await login(t.app, 'plain@example.com', 'password123');

    const anon = await t.app.inject({ method: 'GET', url: '/api/admin/projects' });
    expect(anon.statusCode).toBe(401);

    const nonAdmin = await t.app.inject({ method: 'GET', url: '/api/admin/projects', headers: { cookie: plain } });
    expect(nonAdmin.statusCode).toBe(403);
  });

  test('reports counts + size and sorts largest first', async () => {
    const busy = await createProject(admin, 'Busy');
    const idle = await createProject(admin, 'Idle', true);
    await upload(admin, busy, RUN_XML);
    await upload(admin, busy, RUN_XML);

    const res = await t.app.inject({ method: 'GET', url: '/api/admin/projects', headers: { cookie: admin } });
    expect(res.statusCode).toBe(200);
    const projects = res.json().projects as import('@testhistory/shared').ProjectSizeInfo[];
    expect(projects).toHaveLength(2);

    const b = projects.find((p) => p.id === busy)!;
    const i = projects.find((p) => p.id === idle)!;
    expect(b.runCount).toBe(2);
    expect(b.testCount).toBe(2); // (suite, name) pairs persist across runs
    expect(b.resultCount).toBe(4); // 2 tests × 2 runs
    expect(b.dbBytes).toBeGreaterThan(0);
    expect(b.totalBytes).toBe(b.dbBytes + b.pluginBytes);
    expect(b.lastRunAt).toBeTruthy();

    expect(i.private).toBe(true);
    expect(i.runCount).toBe(0);
    expect(i.lastRunAt).toBeNull();

    // Largest first: the project with runs comes before the empty one.
    expect(projects[0].totalBytes).toBeGreaterThanOrEqual(projects[1].totalBytes);
    expect(projects[0].id).toBe(busy);
  });
});
