import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import {
  SESSION_COOKIE,
  createSession,
  destroySession,
  destroyUserSessions,
  sweepExpiredSessions,
} from '../auth/sessions.js';
import { requireUser, sendError } from '../auth/guards.js';
import { nowIso } from '../lib/ids.js';
import type { UserInfo } from '@testhistory/shared';

const credentials = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const setupBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1).max(120),
});

const passwordChange = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  display_name: string;
  role: 'admin' | 'user';
  disabled: number;
  created_at: string;
}

function toUserInfo(row: UserRow): UserInfo {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    disabled: !!row.disabled,
    createdAt: row.created_at,
  };
}

const SESSION_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  secure: false,
};

export async function authRoutes(app: FastifyInstance) {
  const db = app.core;
  const ttlDays = app.config.sessionTtlDays;

  const countUsers = db.prepare('SELECT COUNT(*) AS n FROM users');
  const insertUser = db.prepare(
    `INSERT INTO users (email, password_hash, display_name, role, disabled, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`,
  );
  const findByEmail = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE');
  const findById = db.prepare('SELECT * FROM users WHERE id = ?');

  // --- setup: create the first user as admin ---
  app.get('/api/setup', async () => {
    const { n } = countUsers.get() as { n: number };
    return { setupRequired: n === 0 };
  });

  app.post('/api/setup', async (req, reply) => {
    const { n } = countUsers.get() as { n: number };
    if (n > 0) {
      return sendError(reply, 403, 'SETUP_DONE', 'Setup has already been completed.');
    }
    const parsed = setupBody.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { email, password, displayName } = parsed.data;
    const hash = await hashPassword(password);
    const info = insertUser.run(email, hash, displayName, 'admin', nowIso());
    const cookie = createSession(db, Number(info.lastInsertRowid), ttlDays);
    reply.setCookie(SESSION_COOKIE, cookie, SESSION_COOKIE_OPTS);
    const row = findById.get(info.lastInsertRowid) as UserRow;
    return reply.code(201).send({ user: toUserInfo(row) });
  });

  // --- login (rate-limited) ---
  app.post(
    '/api/auth/login',
    {
      config: {
        rateLimit: { max: 10, timeWindow: '1 minute' },
      },
    },
    async (req, reply) => {
      const parsed = credentials.safeParse(req.body);
      if (!parsed.success) {
        return sendError(reply, 400, 'VALIDATION', 'Email and password are required.');
      }
      sweepExpiredSessions(db);
      const row = findByEmail.get(parsed.data.email) as UserRow | undefined;
      const ok = row && !row.disabled && (await verifyPassword(row.password_hash, parsed.data.password));
      if (!row || !ok) {
        return sendError(reply, 401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');
      }
      const cookie = createSession(db, row.id, ttlDays);
      reply.setCookie(SESSION_COOKIE, cookie, SESSION_COOKIE_OPTS);
      return { user: toUserInfo(row) };
    },
  );

  app.post('/api/auth/logout', async (req, reply) => {
    const cookie = req.cookies[SESSION_COOKIE];
    if (cookie) destroySession(db, cookie);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: requireUser }, async (req) => {
    const row = findById.get(req.user!.id) as UserRow;
    return { user: toUserInfo(row) };
  });

  app.patch('/api/auth/password', { preHandler: requireUser }, async (req, reply) => {
    const parsed = passwordChange.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'VALIDATION', 'A current and new (min 8 char) password are required.');
    }
    const row = findById.get(req.user!.id) as UserRow;
    if (!(await verifyPassword(row.password_hash, parsed.data.currentPassword))) {
      return sendError(reply, 403, 'INVALID_CREDENTIALS', 'Current password is incorrect.');
    }
    const hash = await hashPassword(parsed.data.newPassword);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, row.id);
    // Invalidate other sessions, then re-issue one for this device.
    destroyUserSessions(db, row.id);
    const cookie = createSession(db, row.id, ttlDays);
    reply.setCookie(SESSION_COOKIE, cookie, SESSION_COOKIE_OPTS);
    return { ok: true };
  });
}
