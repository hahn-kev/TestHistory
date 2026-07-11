import type { Database as Db } from 'better-sqlite3';
import { sha256, nowIso } from '../lib/ids.js';

export interface ResolvedToken {
  tokenId: number;
  projectId: string;
}

/**
 * Resolve a bearer token string to its (active, non-revoked) project, updating
 * `last_used_at`. Returns null for unknown/revoked tokens.
 */
export function resolveToken(core: Db, token: string): ResolvedToken | null {
  const row = core
    .prepare(
      `SELECT id, project_id AS projectId, revoked_at AS revokedAt
         FROM api_tokens WHERE token_hash = ?`,
    )
    .get(sha256(token)) as { id: number; projectId: string; revokedAt: string | null } | undefined;
  if (!row || row.revokedAt) return null;
  core.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(nowIso(), row.id);
  return { tokenId: row.id, projectId: row.projectId };
}

/** Extract a bearer token from an Authorization header, if present. */
export function bearerFrom(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : null;
}
