import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { makeApp, setupAdmin, login, createUser, sessionCookieFrom, type TestApp } from './helpers.js';
import { sweepExpiredSessions } from '../src/auth/sessions.js';

let t: TestApp;
beforeEach(async () => {
  t = await makeApp();
});
afterEach(async () => {
  await t.close();
});

describe('setup', () => {
  test('reports setup required, then creates first user as admin, then 403s', async () => {
    let res = await t.app.inject({ method: 'GET', url: '/api/setup' });
    expect(res.json()).toEqual({ setupRequired: true });

    res = await t.app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { email: 'a@b.com', password: 'password123', displayName: 'A' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().user.role).toBe('admin');
    expect(sessionCookieFrom(res)).toBeTruthy();

    res = await t.app.inject({ method: 'GET', url: '/api/setup' });
    expect(res.json()).toEqual({ setupRequired: false });

    res = await t.app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { email: 'c@d.com', password: 'password123', displayName: 'C' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('login + session round-trip', () => {
  test('me requires auth; login grants it; logout revokes it', async () => {
    const admin = await setupAdmin(t.app);

    let res = await t.app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);

    res = await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: admin } });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe('admin@example.com');

    const cookie = await login(t.app, 'admin@example.com', 'password123');
    res = await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(res.statusCode).toBe(200);

    res = await t.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    res = await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(res.statusCode).toBe(401);
  });

  test('wrong password rejected', async () => {
    await setupAdmin(t.app);
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'admin@example.com', password: 'wrong' },
    });
    expect(res.statusCode).toBe(401);
  });

  test('password change invalidates old sessions and issues a new one', async () => {
    const admin = await setupAdmin(t.app);
    const res = await t.app.inject({
      method: 'PATCH',
      url: '/api/auth/password',
      headers: { cookie: admin },
      payload: { currentPassword: 'password123', newPassword: 'newpassword123' },
    });
    expect(res.statusCode).toBe(200);
    const newCookie = `th_session=${sessionCookieFrom(res)}`;
    // Old cookie invalid, new one works.
    let me = await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: admin } });
    expect(me.statusCode).toBe(401);
    me = await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: newCookie } });
    expect(me.statusCode).toBe(200);
  });
});

describe('sliding expiry + sweep', () => {
  test('expired session is rejected and swept', async () => {
    const admin = await setupAdmin(t.app);
    const raw = admin.split('=')[1];
    const { sha256 } = await import('../src/lib/ids.js');
    const id = sha256(raw);
    // Force the session to be expired.
    t.app.core.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', id);

    const me = await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: admin } });
    expect(me.statusCode).toBe(401);
    // resolveSession deletes the expired row on access.
    const remaining = t.app.core.prepare('SELECT COUNT(*) AS n FROM sessions WHERE id = ?').get(id) as { n: number };
    expect(remaining.n).toBe(0);
  });

  test('sweepExpiredSessions removes only expired rows', async () => {
    const admin = await setupAdmin(t.app);
    // Insert a bogus expired session.
    t.app.core
      .prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at) VALUES (?, 1, ?, ?, ?)')
      .run('deadbeef', '2000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z');
    const removed = sweepExpiredSessions(t.app.core);
    expect(removed).toBe(1);
    // Live admin session still resolves.
    const me = await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: admin } });
    expect(me.statusCode).toBe(200);
  });

  test('sliding refresh pushes expiry when >1 day stale', async () => {
    const admin = await setupAdmin(t.app);
    const id = (await import('../src/lib/ids.js')).sha256(admin.split('=')[1]);
    // Backdate last_seen by 2 days so a refresh triggers.
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    t.app.core.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?').run(twoDaysAgo, new Date(Date.now() + 1000).toISOString(), id);
    const before = t.app.core.prepare('SELECT expires_at AS e FROM sessions WHERE id = ?').get(id) as { e: string };
    await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: admin } });
    const after = t.app.core.prepare('SELECT expires_at AS e FROM sessions WHERE id = ?').get(id) as { e: string };
    expect(new Date(after.e).getTime()).toBeGreaterThan(new Date(before.e).getTime());
  });
});

describe('admin user CRUD + guard', () => {
  test('non-admin cannot reach admin routes', async () => {
    const admin = await setupAdmin(t.app);
    await createUser(t.app, admin, 'user@example.com', 'password123', 'user');
    const userCookie = await login(t.app, 'user@example.com', 'password123');
    const res = await t.app.inject({ method: 'GET', url: '/api/admin/users', headers: { cookie: userCookie } });
    expect(res.statusCode).toBe(403);
  });

  test('anon gets 401 on admin routes', async () => {
    await setupAdmin(t.app);
    const res = await t.app.inject({ method: 'GET', url: '/api/admin/users' });
    expect(res.statusCode).toBe(401);
  });

  test('admin creates, disables, and resets a user', async () => {
    const admin = await setupAdmin(t.app);
    const id = await createUser(t.app, admin, 'user@example.com', 'password123', 'user');

    // Disable → login blocked.
    let res = await t.app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${id}`,
      headers: { cookie: admin },
      payload: { disabled: true },
    });
    expect(res.statusCode).toBe(200);
    res = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'user@example.com', password: 'password123' } });
    expect(res.statusCode).toBe(401);

    // Re-enable + reset password.
    await t.app.inject({ method: 'PATCH', url: `/api/admin/users/${id}`, headers: { cookie: admin }, payload: { disabled: false, password: 'freshpassword' } });
    res = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'user@example.com', password: 'freshpassword' } });
    expect(res.statusCode).toBe(200);
  });

  test('cannot demote the last admin', async () => {
    const admin = await setupAdmin(t.app);
    const meId = (await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: admin } })).json().user.id;
    const res = await t.app.inject({ method: 'PATCH', url: `/api/admin/users/${meId}`, headers: { cookie: admin }, payload: { role: 'user' } });
    expect(res.statusCode).toBe(409);
  });

  test('login is rate-limited', async () => {
    await setupAdmin(t.app);
    let limited = false;
    for (let i = 0; i < 15; i++) {
      const res = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@example.com', password: 'wrong' } });
      if (res.statusCode === 429) { limited = true; break; }
    }
    expect(limited).toBe(true);
  });
});
