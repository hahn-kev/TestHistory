import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { makeApp, setupAdmin, type TestApp } from './helpers.js';
import { isReadOnlyStatement, firstKeyword } from '../src/query/sql-guard.js';

describe('SQL guard (unit)', () => {
  test.each([
    ['SELECT * FROM runs', true],
    ['  select 1', true],
    ['WITH x AS (SELECT 1) SELECT * FROM x', true],
    ['/* c */ SELECT 1', true],
    ['-- comment\nSELECT 1', true],
    ['(SELECT 1)', true],
    ['DELETE FROM runs', false],
    ['ATTACH DATABASE "x" AS y', false],
    ['PRAGMA table_info(runs)', false],
    ['VACUUM INTO "out.db"', false],
    ['INSERT INTO runs VALUES (1)', false],
    ['UPDATE runs SET total = 0', false],
    ['DROP TABLE runs', false],
  ])('%s → allowed=%s', (sql, allowed) => {
    expect(isReadOnlyStatement(sql)).toBe(allowed);
  });

  test('comment-hidden keyword still classified by real first keyword', () => {
    expect(firstKeyword('/* SELECT */ DELETE FROM x')).toBe('DELETE');
  });
});

describe('plugin management + query + serving', () => {
  let t: TestApp;
  let admin: string;
  let projectId: string;

  function multipart(parts: Array<{ name: string; value?: string; filename?: string; content?: string }>) {
    const boundary = '----thPluginBoundary123';
    const chunks: string[] = [];
    for (const p of parts) {
      chunks.push(`--${boundary}\r\n`);
      if (p.filename !== undefined) {
        chunks.push(`Content-Disposition: form-data; name="${p.name}"; filename="${p.filename}"\r\n`);
        chunks.push('Content-Type: text/html\r\n\r\n');
        chunks.push((p.content ?? '') + '\r\n');
      } else {
        chunks.push(`Content-Disposition: form-data; name="${p.name}"\r\n\r\n`);
        chunks.push((p.value ?? '') + '\r\n');
      }
    }
    chunks.push(`--${boundary}--\r\n`);
    return { payload: Buffer.from(chunks.join('')), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
  }

  async function upload(xml: string) {
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/runs?format=junit`,
      headers: { cookie: admin, 'content-type': 'application/xml' },
      payload: xml,
    });
    if (res.statusCode >= 300) throw new Error(`upload ${res.statusCode}`);
  }

  beforeEach(async () => {
    // Tiny query timeout so the CTE-bomb test is fast.
    t = await makeApp({ queryTimeoutMs: 500, queryMaxRows: 100, queryMaxBytes: 5 * 1024 * 1024 });
    admin = await setupAdmin(t.app);
    const pr = await t.app.inject({ method: 'POST', url: '/api/projects', headers: { cookie: admin }, payload: { name: 'Plug' } });
    projectId = pr.json().project.id;
    await upload('<testsuites><testsuite name="s"><testcase classname="c" name="a"/><testcase classname="c" name="b"/></testsuite></testsuites>');
  });
  afterEach(async () => {
    await t.close();
  });

  async function createPlugin(content = '<!doctype html><h1>demo</h1>') {
    const mp = multipart([
      { name: 'file', filename: 'p.html', content },
      { name: 'name', value: 'My Plugin' },
      { name: 'description', value: 'demo plugin' },
    ]);
    const res = await t.app.inject({ method: 'POST', url: `/api/projects/${projectId}/plugins`, headers: { cookie: admin, ...mp.headers }, payload: mp.payload });
    return res;
  }

  test('upload, list, replace, delete', async () => {
    const created = await createPlugin();
    expect(created.statusCode).toBe(201);
    const pluginId = created.json().plugin.id;

    const list = await t.app.inject({ method: 'GET', url: `/api/projects/${projectId}/plugins`, headers: { cookie: admin } });
    expect(list.json().plugins).toHaveLength(1);
    expect(list.json().plugins[0].name).toBe('My Plugin');

    const mp = multipart([{ name: 'file', filename: 'p2.html', content: '<!doctype html><h1>v2</h1>' }, { name: 'description', value: 'updated' }]);
    const put = await t.app.inject({ method: 'PUT', url: `/api/projects/${projectId}/plugins/${pluginId}`, headers: { cookie: admin, ...mp.headers }, payload: mp.payload });
    expect(put.statusCode).toBe(200);
    expect(put.json().plugin.description).toBe('updated');

    const del = await t.app.inject({ method: 'DELETE', url: `/api/projects/${projectId}/plugins/${pluginId}`, headers: { cookie: admin } });
    expect(del.statusCode).toBe(200);
    const list2 = await t.app.inject({ method: 'GET', url: `/api/projects/${projectId}/plugins`, headers: { cookie: admin } });
    expect(list2.json().plugins).toHaveLength(0);
  });

  test('signed URL serves content with opaque-origin headers; expired token rejected', async () => {
    const created = await createPlugin('<!doctype html><title>demo</title><body>hi</body>');
    const pluginId = created.json().plugin.id;

    const urlRes = await t.app.inject({ method: 'GET', url: `/api/projects/${projectId}/plugins/${pluginId}/url`, headers: { cookie: admin } });
    expect(urlRes.statusCode).toBe(200);
    const url = urlRes.json().url as string;

    const content = await t.app.inject({ method: 'GET', url });
    expect(content.statusCode).toBe(200);
    expect(content.headers['content-security-policy']).toBe('sandbox allow-scripts');
    expect(content.headers['x-content-type-options']).toBe('nosniff');
    expect(content.headers['cache-control']).toBe('private, no-store');
    expect(content.body).toContain('hi');

    // Tampered/invalid token → 403.
    const bad = await t.app.inject({ method: 'GET', url: `/plugin-content/${pluginId}?st=9999999999999.deadbeef` });
    expect(bad.statusCode).toBe(403);

    // Expired token → 403.
    const { signSubject } = await import('../src/lib/signed-url.js');
    const expired = signSubject('test-secret', pluginId, -1000);
    const exp = await t.app.inject({ method: 'GET', url: `/plugin-content/${pluginId}?st=${encodeURIComponent(expired)}` });
    expect(exp.statusCode).toBe(403);
  });

  test('plugin-query runs SELECT; forbidden statements rejected', async () => {
    const ok = await t.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/plugin-query`,
      headers: { cookie: admin },
      payload: { sql: 'SELECT COUNT(*) AS n FROM tests' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().columns).toEqual(['n']);
    expect(ok.json().rows[0][0]).toBe(2);

    for (const sql of ['DELETE FROM runs', 'ATTACH DATABASE "x" AS y', 'PRAGMA table_info(runs)', 'VACUUM INTO "o.db"']) {
      const res = await t.app.inject({ method: 'POST', url: `/api/projects/${projectId}/plugin-query`, headers: { cookie: admin }, payload: { sql } });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('FORBIDDEN_STATEMENT');
    }
  });

  test('row cap sets truncated; bad SQL → 400', async () => {
    // Generate rows via a recursive CTE up to > maxRows (100).
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/plugin-query`,
      headers: { cookie: admin },
      payload: { sql: 'WITH RECURSIVE seq(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM seq WHERE x < 500) SELECT x FROM seq' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().truncated).toBe(true);
    expect(res.json().rows.length).toBe(100);

    const bad = await t.app.inject({ method: 'POST', url: `/api/projects/${projectId}/plugin-query`, headers: { cookie: admin }, payload: { sql: 'SELECT * FROM no_such_table' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('SQL_ERROR');
  });

  test('recursive-CTE bomb times out, then the next query succeeds (worker replaced)', async () => {
    const bomb = await t.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/plugin-query`,
      headers: { cookie: admin },
      // Infinite recursion — no termination condition, capped only by the watchdog.
      payload: { sql: 'WITH RECURSIVE inf(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM inf) SELECT x FROM inf WHERE x < 0' },
    });
    expect(bomb.statusCode).toBe(408);
    expect(bomb.json().error.code).toBe('TIMEOUT');

    // Pool must have respawned the killed worker; next query works.
    const ok = await t.app.inject({ method: 'POST', url: `/api/projects/${projectId}/plugin-query`, headers: { cookie: admin }, payload: { sql: 'SELECT 42 AS answer' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().rows[0][0]).toBe(42);
  }, 15_000);
});
