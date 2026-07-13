import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { makeApp, setupAdmin, login, createUser, type TestApp } from './helpers.js';

let t: TestApp;
let admin: string;
let projectId: string;

type Case = { name: string; status: 'pass' | 'fail' | 'skip' };

/** Build a JUnit doc with the given test cases (all in suite `pkg.Suite`). */
function junit(cases: Case[]): string {
  const body = cases
    .map((c) => {
      const open = `<testcase classname="pkg.Suite" name="${c.name}" time="0.01"`;
      if (c.status === 'pass') return `${open}/>`;
      if (c.status === 'skip') return `${open}><skipped/></testcase>`;
      return `${open}><failure message="boom">stack</failure></testcase>`;
    })
    .join('');
  return `<testsuites><testsuite name="s">${body}</testsuite></testsuites>`;
}

/** Upload one raw-body run; returns the run summary. */
async function upload(cases: Case[], query = ''): Promise<any> {
  const res = await t.app.inject({
    method: 'POST',
    url: `/api/projects/${projectId}/runs${query}`,
    headers: { cookie: admin, 'content-type': 'application/xml' },
    payload: junit(cases),
  });
  if (res.statusCode >= 300) throw new Error(`upload failed ${res.statusCode}: ${res.body}`);
  return res.json().run;
}

function get(url: string, headers: Record<string, string> = { cookie: admin }) {
  return t.app.inject({ method: 'GET', url: `/api/projects/${projectId}${url}`, headers });
}

beforeEach(async () => {
  t = await makeApp();
  admin = await setupAdmin(t.app);
  const pr = await t.app.inject({ method: 'POST', url: '/api/projects', headers: { cookie: admin }, payload: { name: 'Cmp' } });
  projectId = pr.json().project.id;
});
afterEach(async () => {
  await t.close();
});

describe('GET /compare — by run id', () => {
  test('categorizes newly failing, fixed, new, and removed tests', async () => {
    // base: a pass, b pass, d fail, e pass
    const base = await upload([{ name: 'a', status: 'pass' }, { name: 'b', status: 'pass' }, { name: 'd', status: 'fail' }, { name: 'e', status: 'pass' }]);
    // head: a pass, b fail (regression), d pass (fixed), c pass (new); e removed
    const head = await upload([{ name: 'a', status: 'pass' }, { name: 'b', status: 'fail' }, { name: 'd', status: 'pass' }, { name: 'c', status: 'pass' }]);

    const res = await get(`/compare?base=${base.id}&head=${head.id}`);
    expect(res.statusCode).toBe(200);
    const { comparison } = res.json();
    const names = (cat: string) => comparison.categories[cat].tests.map((x: any) => x.name).sort();

    expect(names('newlyFailing')).toEqual(['b']);
    expect(names('newlyFixed')).toEqual(['d']);
    expect(names('newTests')).toEqual(['c']);
    expect(names('removedTests')).toEqual(['e']);
    expect(comparison.summary.regressions).toBe(1);
    expect(comparison.base.id).toBe(base.id);
    expect(comparison.head.id).toBe(head.id);
  });
});

describe('GET /compare — by branch', () => {
  test('resolves the latest run on each branch, and re-resolves as newer runs arrive', async () => {
    const mainOld = await upload([{ name: 'a', status: 'pass' }], '?branch=main');
    const pr = await upload([{ name: 'a', status: 'fail' }], '?branch=pr');

    let res = await get(`/compare?baseBranch=main&headBranch=pr`);
    let body = res.json().comparison;
    expect(body.base.id).toBe(mainOld.id);
    expect(body.head.id).toBe(pr.id);
    expect(body.summary.regressions).toBe(1);

    // A newer run on main should now be the base.
    const mainNew = await upload([{ name: 'a', status: 'pass' }], '?branch=main');
    res = await get(`/compare?baseBranch=main&headBranch=pr`);
    body = res.json().comparison;
    expect(body.base.id).toBe(mainNew.id);
    expect(mainNew.id).toBeGreaterThan(mainOld.id);
  });

  test('branch with no runs → 404', async () => {
    await upload([{ name: 'a', status: 'pass' }], '?branch=main');
    const res = await get(`/compare?baseBranch=main&headBranch=ghost`);
    expect(res.statusCode).toBe(404);
    expect(res.json().error.message).toContain('ghost');
  });
});

describe('GET /compare — errors & access', () => {
  test('missing refs → 400', async () => {
    await upload([{ name: 'a', status: 'pass' }]);
    const res = await get(`/compare`);
    expect(res.statusCode).toBe(400);
  });

  test('unknown run id → 404', async () => {
    const base = await upload([{ name: 'a', status: 'pass' }]);
    const res = await get(`/compare?base=${base.id}&head=99999`);
    expect(res.statusCode).toBe(404);
  });

  test('non-viewer of a private project → 404', async () => {
    // Make the project private, then a stranger who is not a member gets 404.
    await t.app.inject({ method: 'PATCH', url: `/api/projects/${projectId}`, headers: { cookie: admin }, payload: { private: true } });
    const base = await upload([{ name: 'a', status: 'pass' }]);
    const head = await upload([{ name: 'a', status: 'fail' }]);
    await createUser(t.app, admin, 'stranger@example.com');
    const stranger = await login(t.app, 'stranger@example.com', 'password123');
    const res = await get(`/compare?base=${base.id}&head=${head.id}`, { cookie: stranger });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /compare — markdown', () => {
  test('?format=md returns text/markdown with the regression summary', async () => {
    const base = await upload([{ name: 'a', status: 'pass' }]);
    const head = await upload([{ name: 'a', status: 'fail' }]);
    const res = await get(`/compare?base=${base.id}&head=${head.id}&format=md`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/markdown');
    expect(res.body).toContain('1 newly failing');
    expect(res.body).toContain('pkg.Suite › a');
  });

  test('Accept: text/markdown is an alias for ?format=md', async () => {
    const base = await upload([{ name: 'a', status: 'pass' }]);
    const head = await upload([{ name: 'a', status: 'fail' }]);
    const res = await get(`/compare?base=${base.id}&head=${head.id}`, { cookie: admin, accept: 'text/markdown' });
    expect(res.headers['content-type']).toContain('text/markdown');
  });
});
