import type { Database as Db } from 'better-sqlite3';
import { generateSessionValue, sha256, nowIso } from '../lib/ids.js';

export const SESSION_COOKIE = 'th_session';

export interface SessionUser {
  id: number;
  email: string;
  displayName: string;
  role: 'admin' | 'user';
  disabled: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Create a session for `userId`; returns the plaintext cookie value to set. */
export function createSession(db: Db, userId: number, ttlDays: number): string {
  const { value, hash } = generateSessionValue();
  const now = Date.now();
  const created = new Date(now).toISOString();
  const expires = new Date(now + ttlDays * DAY_MS).toISOString();
  db.prepare(
    `INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(hash, userId, created, expires, created);
  return value;
}

/**
 * Resolve a cookie value to its (non-disabled) user, applying sliding expiry:
 * expired sessions are rejected (and deleted); active ones have their window
 * pushed to last_seen + ttl, refreshed only when >1 day stale to avoid a write
 * per request. Returns null if absent/expired/disabled.
 */
export function resolveSession(db: Db, cookieValue: string, ttlDays: number): SessionUser | null {
  const id = sha256(cookieValue);
  const row = db
    .prepare(
      `SELECT s.id AS sid, s.expires_at AS expiresAt, s.last_seen_at AS lastSeenAt,
              u.id AS id, u.email AS email, u.display_name AS displayName,
              u.role AS role, u.disabled AS disabled
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = ?`,
    )
    .get(id) as
    | {
        sid: string;
        expiresAt: string;
        lastSeenAt: string;
        id: number;
        email: string;
        displayName: string;
        role: 'admin' | 'user';
        disabled: number;
      }
    | undefined;

  if (!row) return null;

  const now = Date.now();
  if (new Date(row.expiresAt).getTime() <= now) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    return null;
  }
  if (row.disabled) return null;

  // Sliding refresh, throttled to at most once per day.
  if (now - new Date(row.lastSeenAt).getTime() > DAY_MS) {
    const seen = new Date(now).toISOString();
    const expires = new Date(now + ttlDays * DAY_MS).toISOString();
    db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?').run(
      seen,
      expires,
      id,
    );
  }

  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    disabled: !!row.disabled,
  };
}

/** Delete a single session by its cookie value (logout). */
export function destroySession(db: Db, cookieValue: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sha256(cookieValue));
}

/** Delete every session for a user (e.g. after password change / disable). */
export function destroyUserSessions(db: Db, userId: number): void {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

/** Sweep expired sessions; returns the number removed. */
export function sweepExpiredSessions(db: Db): number {
  const info = db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso());
  return info.changes;
}
