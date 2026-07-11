import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sendError } from '../auth/guards.js';
import { requireProject } from '../auth/project-access.js';
import { generateApiToken, nowIso } from '../lib/ids.js';
import type { TokenInfo } from '@testhistory/shared';

const createBody = z.object({ name: z.string().min(1).max(120) });

interface TokenRow {
  id: number;
  name: string;
  token_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

function toTokenInfo(row: TokenRow): TokenInfo {
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.token_prefix,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}

export async function tokenRoutes(app: FastifyInstance) {
  const core = app.core;

  app.get('/api/projects/:id/tokens', { preHandler: requireProject(core, 'member') }, async (req) => {
    const rows = core
      .prepare(
        `SELECT id, name, token_prefix, created_at, last_used_at, revoked_at
           FROM api_tokens WHERE project_id = ? ORDER BY id DESC`,
      )
      .all(req.project!.id) as TokenRow[];
    return { tokens: rows.map(toTokenInfo) };
  });

  app.post('/api/projects/:id/tokens', { preHandler: requireProject(core, 'member') }, async (req, reply) => {
    const parsed = createBody.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, 400, 'VALIDATION', parsed.error.issues[0]?.message ?? 'Invalid input.');
    }
    const { token, hash, prefix } = generateApiToken();
    const info = core
      .prepare(
        `INSERT INTO api_tokens (project_id, name, token_hash, token_prefix, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(req.project!.id, parsed.data.name, hash, prefix, req.user!.id, nowIso());
    const row = core.prepare('SELECT * FROM api_tokens WHERE id = ?').get(info.lastInsertRowid) as TokenRow;
    // Plaintext token returned exactly once here.
    return reply.code(201).send({ token, tokenInfo: toTokenInfo(row) });
  });

  app.delete(
    '/api/projects/:id/tokens/:tokenId',
    { preHandler: requireProject(core, 'member') },
    async (req, reply) => {
      const tokenId = Number((req.params as { tokenId: string }).tokenId);
      const row = core
        .prepare('SELECT id FROM api_tokens WHERE id = ? AND project_id = ?')
        .get(tokenId, req.project!.id);
      if (!row) return sendError(reply, 404, 'NOT_FOUND', 'Token not found.');
      core.prepare('UPDATE api_tokens SET revoked_at = ? WHERE id = ?').run(nowIso(), tokenId);
      return { ok: true };
    },
  );
}
