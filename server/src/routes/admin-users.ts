import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { hashPassword } from '../auth/passwords.js';
import { destroyUserSessions } from '../auth/sessions.js';
import { requireAdmin, sendError } from '../auth/guards.js';
import { nowIso } from '../lib/ids.js';
import type { UserInfo } from '@testhistory/shared';

interface UserRow {
  id: number;
  email: string;
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

const createBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1).max(120),
  role: z.enum(['admin', 'user']).default('user'),
});

const patchBody = z.object({
  displayName: z.string().min(1).max(120).optional(),
  role: z.enum(['admin', 'user']).optional(),
  disabled: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

export async function adminUserRoutes(app: FastifyInstance) {
  const db = app.core;

  app.get('/api/admin/users', { preHandler: requireAdmin }, async () => {
    const rows = db
      .prepare('SELECT id, email, display_name, role, disabled, created_at FROM users ORDER BY id')
      .all() as UserRow[];
    return { users: rows.map(toUserInfo) };
  });

  app.post('/api/admin/users', { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { email, password, displayName, role } = parsed.data;
    const existing = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(email);
    if (existing) {
      return sendError(reply, 409, 'EMAIL_TAKEN', 'A user with that email already exists.');
    }
    const hash = await hashPassword(password);
    const info = db
      .prepare(
        `INSERT INTO users (email, password_hash, display_name, role, disabled, created_at)
         VALUES (?, ?, ?, ?, 0, ?)`,
      )
      .run(email, hash, displayName, role, nowIso());
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid) as UserRow;
    return reply.code(201).send({ user: toUserInfo(row) });
  });

  app.patch('/api/admin/users/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const parsed = patchBody.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid input.');
    }
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    if (!row) return sendError(reply, 404, 'NOT_FOUND', 'User not found.');

    const { displayName, role, disabled, password } = parsed.data;
    // Guard against removing the last active admin.
    if ((role === 'user' || disabled === true) && row.role === 'admin') {
      const otherAdmins = db
        .prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND disabled=0 AND id != ?")
        .get(id) as { n: number };
      if (otherAdmins.n === 0) {
        return sendError(reply, 409, 'LAST_ADMIN', 'Cannot demote or disable the last active admin.');
      }
    }

    if (displayName !== undefined)
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName, id);
    if (role !== undefined) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
    if (disabled !== undefined) {
      db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, id);
      if (disabled) destroyUserSessions(db, id);
    }
    if (password !== undefined) {
      const hash = await hashPassword(password);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
      destroyUserSessions(db, id);
    }
    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow;
    return { user: toUserInfo(updated) };
  });
}
