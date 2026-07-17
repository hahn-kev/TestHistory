import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
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

describe('project creation + DB materialization', () => {
  test('creator becomes owner and the per-project DB file appears at the right version', async () => {
    const id = await createProject(admin, 'Alpha');
    const dbFile = path.join(t.dataDir, 'projects', `${id}.db`);
    expect(fs.existsSync(dbFile)).toBe(true);

    const Database = (await import('better-sqlite3')).default;
    const db = new Database(dbFile, { readonly: true });
    const version = db.pragma('user_version', { simple: true });
    const { PROJECT_SCHEMA_VERSION } = await import('../src/db/project-db.js');
    expect(version).toBe(PROJECT_SCHEMA_VERSION);
    // Full schema present even though empty.
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name);
    expect(tables).toEqual(expect.arrayContaining(['runs', 'tests', 'results', 'name_rules']));
    db.close();

    const got = await t.app.inject({ method: 'GET', url: `/api/projects/${id}`, headers: { cookie: admin } });
    expect(got.json().project.myRole).toBe(null); // admin is implicit owner, not a stored member
  });

  test('duplicate name rejected', async () => {
    await createProject(admin, 'Dup');
    const res = await t.app.inject({ method: 'POST', url: '/api/projects', headers: { cookie: admin }, payload: { name: 'Dup' } });
    expect(res.statusCode).toBe(409);
  });
});

describe('visibility matrix', () => {
  test('non-member sees public but not private (404)', async () => {
    await createUser(t.app, admin, 'owner@example.com');
    const owner = await login(t.app, 'owner@example.com', 'password123');
    const pub = await createProject(owner, 'PublicProj', false);
    const priv = await createProject(owner, 'PrivateProj', true);

    await createUser(t.app, admin, 'stranger@example.com');
    const stranger = await login(t.app, 'stranger@example.com', 'password123');

    // Public readable.
    let res = await t.app.inject({ method: 'GET', url: `/api/projects/${pub}`, headers: { cookie: stranger } });
    expect(res.statusCode).toBe(200);
    expect(res.json().project.myRole).toBe(null);

    // Private → 404 (not 403).
    res = await t.app.inject({ method: 'GET', url: `/api/projects/${priv}`, headers: { cookie: stranger } });
    expect(res.statusCode).toBe(404);

    // Listing: stranger sees the public project, not the private one.
    res = await t.app.inject({ method: 'GET', url: '/api/projects', headers: { cookie: stranger } });
    const names = res.json().projects.map((p: { name: string }) => p.name);
    expect(names).toContain('PublicProj');
    expect(names).not.toContain('PrivateProj');
  });

  test('anonymous can read public project; private → 404; mutations → 404', async () => {
    await createUser(t.app, admin, 'owner3@example.com');
    const owner = await login(t.app, 'owner3@example.com', 'password123');
    const pub = await createProject(owner, 'AnonPublic', false);
    const priv = await createProject(owner, 'AnonPrivate', true);

    // Public readable without a session.
    let res = await t.app.inject({ method: 'GET', url: `/api/projects/${pub}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().project.name).toBe('AnonPublic');
    expect(res.json().project.myRole).toBe(null);

    // Runs list also works anonymously.
    res = await t.app.inject({ method: 'GET', url: `/api/projects/${pub}/runs` });
    expect(res.statusCode).toBe(200);

    // Private → 404.
    res = await t.app.inject({ method: 'GET', url: `/api/projects/${priv}` });
    expect(res.statusCode).toBe(404);

    // Listing still requires login.
    res = await t.app.inject({ method: 'GET', url: '/api/projects' });
    expect(res.statusCode).toBe(401);

    // Mutations stay blocked (404 hides the project).
    res = await t.app.inject({
      method: 'PATCH',
      url: `/api/projects/${pub}`,
      payload: { description: 'hacked' },
    });
    expect(res.statusCode).toBe(404);

    res = await t.app.inject({
      method: 'POST',
      url: `/api/projects/${pub}/runs?format=junit`,
      headers: { 'content-type': 'application/xml' },
      payload: '<testsuites/>',
    });
    expect(res.statusCode).toBe(404);
  });

  test('admin sees all projects including private', async () => {
    await createUser(t.app, admin, 'owner2@example.com');
    const owner = await login(t.app, 'owner2@example.com', 'password123');
    await createProject(owner, 'HiddenProj', true);
    const res = await t.app.inject({ method: 'GET', url: '/api/projects', headers: { cookie: admin } });
    const names = res.json().projects.map((p: { name: string }) => p.name);
    expect(names).toContain('HiddenProj');
  });
});

describe('member vs owner write split', () => {
  test('member cannot PATCH (owner-only); can manage tokens; owner-only member changes', async () => {
    await createUser(t.app, admin, 'o@example.com');
    const owner = await login(t.app, 'o@example.com', 'password123');
    const id = await createProject(owner, 'Split');

    const memberId = await createUser(t.app, admin, 'm@example.com');
    const member = await login(t.app, 'm@example.com', 'password123');
    // Add member.
    let res = await t.app.inject({ method: 'POST', url: `/api/projects/${id}/members`, headers: { cookie: owner }, payload: { userId: memberId, role: 'member' } });
    expect(res.statusCode).toBe(201);

    // Member cannot PATCH the project (owner-only → 404).
    res = await t.app.inject({ method: 'PATCH', url: `/api/projects/${id}`, headers: { cookie: member }, payload: { description: 'x' } });
    expect(res.statusCode).toBe(404);

    // Member cannot list members (owner-only → 404).
    res = await t.app.inject({ method: 'GET', url: `/api/projects/${id}/members`, headers: { cookie: member } });
    expect(res.statusCode).toBe(404);

    // Member CAN create a token.
    res = await t.app.inject({ method: 'POST', url: `/api/projects/${id}/tokens`, headers: { cookie: member }, payload: { name: 'ci' } });
    expect(res.statusCode).toBe(201);

    // Owner CAN PATCH.
    res = await t.app.inject({ method: 'PATCH', url: `/api/projects/${id}`, headers: { cookie: owner }, payload: { private: true } });
    expect(res.statusCode).toBe(200);
    expect(res.json().project.private).toBe(true);
  });
});

describe('tokens', () => {
  test('token shown once; list shows prefix; revoke works', async () => {
    const id = await createProject(admin, 'Tok');
    let res = await t.app.inject({ method: 'POST', url: `/api/projects/${id}/tokens`, headers: { cookie: admin }, payload: { name: 'deploy' } });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.token).toMatch(/^tht_/);
    const tokenId = body.tokenInfo.id;

    res = await t.app.inject({ method: 'GET', url: `/api/projects/${id}/tokens`, headers: { cookie: admin } });
    const listed = res.json().tokens[0];
    expect(listed.tokenPrefix).toBe(body.token.slice(0, 12));
    expect(listed).not.toHaveProperty('token');

    // Bearer guard resolution: revoke, then confirm it's marked revoked.
    res = await t.app.inject({ method: 'DELETE', url: `/api/projects/${id}/tokens/${tokenId}`, headers: { cookie: admin } });
    expect(res.statusCode).toBe(200);
    res = await t.app.inject({ method: 'GET', url: `/api/projects/${id}/tokens`, headers: { cookie: admin } });
    expect(res.json().tokens[0].revokedAt).toBeTruthy();
  });

  test('resolveToken honors revocation', async () => {
    const id = await createProject(admin, 'Tok2');
    const res = await t.app.inject({ method: 'POST', url: `/api/projects/${id}/tokens`, headers: { cookie: admin }, payload: { name: 'k' } });
    const { token, tokenInfo } = res.json();
    const { resolveToken } = await import('../src/auth/tokens.js');
    expect(resolveToken(t.app.core, token)?.projectId).toBe(id);
    t.app.core.prepare('UPDATE api_tokens SET revoked_at = ? WHERE id = ?').run('2020-01-01T00:00:00Z', tokenInfo.id);
    expect(resolveToken(t.app.core, token)).toBe(null);
  });
});

describe('deletion', () => {
  test('DELETE removes project row and DB file', async () => {
    const id = await createProject(admin, 'ToDelete');
    const dbFile = path.join(t.dataDir, 'projects', `${id}.db`);
    expect(fs.existsSync(dbFile)).toBe(true);
    const res = await t.app.inject({ method: 'DELETE', url: `/api/projects/${id}`, headers: { cookie: admin } });
    expect(res.statusCode).toBe(200);
    expect(fs.existsSync(dbFile)).toBe(false);
    const got = await t.app.inject({ method: 'GET', url: `/api/projects/${id}`, headers: { cookie: admin } });
    expect(got.statusCode).toBe(404);
  });
});

describe('Primary Branch override', () => {
  test('GET returns null override and unresolved when no runs', async () => {
    const id = await createProject(admin, 'PBEmpty');
    const res = await t.app.inject({ method: 'GET', url: `/api/projects/${id}`, headers: { cookie: admin } });
    expect(res.statusCode).toBe(200);
    expect(res.json().project.primaryBranch).toBeNull();
    expect(res.json().project.resolvedPrimaryBranch).toBeNull();
  });

  test('owner can set and clear override; resolved follows override then auto-detect', async () => {
    const id = await createProject(admin, 'PBSet');
    // Seed a mainline run so auto-detect has something to pick after clear.
    t.app.dbManager
      .get(id)
      .prepare('INSERT INTO runs (id, run_key, created_at, branch) VALUES (1, null, ?, ?)')
      .run('2026-01-01T00:00:00.000Z', 'main');

    let res = await t.app.inject({ method: 'GET', url: `/api/projects/${id}`, headers: { cookie: admin } });
    expect(res.json().project.primaryBranch).toBeNull();
    expect(res.json().project.resolvedPrimaryBranch).toBe('main');

    res = await t.app.inject({
      method: 'PATCH',
      url: `/api/projects/${id}`,
      headers: { cookie: admin },
      payload: { primaryBranch: 'develop' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().project.primaryBranch).toBe('develop');
    expect(res.json().project.resolvedPrimaryBranch).toBe('develop');

    res = await t.app.inject({
      method: 'PATCH',
      url: `/api/projects/${id}`,
      headers: { cookie: admin },
      payload: { primaryBranch: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().project.primaryBranch).toBeNull();
    expect(res.json().project.resolvedPrimaryBranch).toBe('main');
  });

  test('empty string clears override like null', async () => {
    const id = await createProject(admin, 'PBClearEmpty');
    await t.app.inject({
      method: 'PATCH',
      url: `/api/projects/${id}`,
      headers: { cookie: admin },
      payload: { primaryBranch: 'release' },
    });
    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/projects/${id}`,
      headers: { cookie: admin },
      payload: { primaryBranch: '' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().project.primaryBranch).toBeNull();
  });

  test('member cannot set Primary Branch (owner-only PATCH)', async () => {
    await createUser(t.app, admin, 'pb-owner@example.com');
    const owner = await login(t.app, 'pb-owner@example.com', 'password123');
    const id = await createProject(owner, 'PBMember');
    const memberId = await createUser(t.app, admin, 'pb-member@example.com');
    const member = await login(t.app, 'pb-member@example.com', 'password123');
    await t.app.inject({
      method: 'POST',
      url: `/api/projects/${id}/members`,
      headers: { cookie: owner },
      payload: { userId: memberId, role: 'member' },
    });

    const res = await t.app.inject({
      method: 'PATCH',
      url: `/api/projects/${id}`,
      headers: { cookie: member },
      payload: { primaryBranch: 'main' },
    });
    expect(res.statusCode).toBe(404);
  });
});
