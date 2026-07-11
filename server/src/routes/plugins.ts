import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import { sendError } from '../auth/guards.js';
import { requireProject } from '../auth/project-access.js';
import { newId, nowIso, isSafeId } from '../lib/ids.js';
import { signSubject, verifySubject } from '../lib/signed-url.js';
import { streamToTempFile } from '../lib/stream-to-file.js';
import { pluginsDir } from '../config.js';
import type { PluginInfo, PluginQueryResult } from '@testhistory/shared';

interface PluginRow {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  size_bytes: number;
  created_at: string;
  updated_at: string;
}

function toInfo(row: PluginRow): PluginInfo {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const URL_TTL_MS = 60_000;
const queryBody = z.object({
  sql: z.string().min(1).max(100_000),
  params: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).max(100).optional(),
});

/** Collect a single-file multipart plugin upload: the file plus name/description fields. */
async function collectPluginUpload(req: FastifyRequest, dir: string, maxBytes: number) {
  let file: { tempPath: string; size: number } | null = null;
  const fields: Record<string, string> = {};
  for await (const part of req.parts()) {
    if (part.type === 'file') {
      const res = await streamToTempFile(part.file, dir, maxBytes);
      (req.tempFiles ??= []).push(res.tempPath);
      if ((part.file as { truncated?: boolean }).truncated) {
        throw new AppError(413, 'TOO_LARGE', 'Plugin exceeds the maximum allowed size.');
      }
      file = res;
    } else {
      fields[part.fieldname] = String((part as { value: unknown }).value);
    }
  }
  return { file, fields };
}

export async function pluginRoutes(app: FastifyInstance) {
  const core = app.core;
  const member = requireProject(core, 'member');
  const viewer = requireProject(core, 'viewer');
  const dir = pluginsDir(app.config.dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const fileFor = (id: string) => path.join(dir, `${id}.html`);

  app.get('/api/projects/:id/plugins', { preHandler: viewer }, async (req) => {
    const rows = core
      .prepare('SELECT * FROM plugins WHERE project_id = ? ORDER BY name')
      .all(req.project!.id) as PluginRow[];
    return { plugins: rows.map(toInfo) };
  });

  app.post('/api/projects/:id/plugins', { preHandler: member }, async (req, reply) => {
    if (!req.isMultipart()) return sendError(reply, 400, 'VALIDATION', 'Expected a multipart upload.');
    const { file, fields } = await collectPluginUpload(req, dir, app.config.maxPluginBytes);
    if (!file) return sendError(reply, 400, 'VALIDATION', 'Missing plugin `file`.');
    const name = (fields.name ?? '').trim();
    if (!name) return sendError(reply, 400, 'VALIDATION', 'Plugin `name` is required.');

    const clash = core.prepare('SELECT id FROM plugins WHERE project_id = ? AND name = ?').get(req.project!.id, name);
    if (clash) return sendError(reply, 409, 'NAME_TAKEN', 'A plugin with that name already exists.');

    const id = newId();
    // Atomic publish: temp file → rename into place.
    fs.renameSync(file.tempPath, fileFor(id));
    req.tempFiles = [];
    const now = nowIso();
    core
      .prepare(
        `INSERT INTO plugins (id, project_id, name, description, size_bytes, uploaded_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, req.project!.id, name, fields.description ?? null, file.size, req.user?.id ?? null, now, now);
    const row = core.prepare('SELECT * FROM plugins WHERE id = ?').get(id) as PluginRow;
    return reply.code(201).send({ plugin: toInfo(row) });
  });

  app.put('/api/projects/:id/plugins/:pluginId', { preHandler: member }, async (req, reply) => {
    const pluginId = (req.params as { pluginId: string }).pluginId;
    const row = core.prepare('SELECT * FROM plugins WHERE id = ? AND project_id = ?').get(pluginId, req.project!.id) as PluginRow | undefined;
    if (!row || !isSafeId(pluginId)) return sendError(reply, 404, 'NOT_FOUND', 'Plugin not found.');
    if (!req.isMultipart()) return sendError(reply, 400, 'VALIDATION', 'Expected a multipart upload.');

    const { file, fields } = await collectPluginUpload(req, dir, app.config.maxPluginBytes);
    const now = nowIso();
    if (file) {
      fs.renameSync(file.tempPath, fileFor(pluginId));
      req.tempFiles = [];
      core.prepare('UPDATE plugins SET size_bytes = ?, updated_at = ? WHERE id = ?').run(file.size, now, pluginId);
    }
    if (fields.name !== undefined) core.prepare('UPDATE plugins SET name = ?, updated_at = ? WHERE id = ?').run(fields.name, now, pluginId);
    if (fields.description !== undefined) core.prepare('UPDATE plugins SET description = ?, updated_at = ? WHERE id = ?').run(fields.description, now, pluginId);

    const updated = core.prepare('SELECT * FROM plugins WHERE id = ?').get(pluginId) as PluginRow;
    return { plugin: toInfo(updated) };
  });

  app.delete('/api/projects/:id/plugins/:pluginId', { preHandler: member }, async (req, reply) => {
    const pluginId = (req.params as { pluginId: string }).pluginId;
    const row = core.prepare('SELECT id FROM plugins WHERE id = ? AND project_id = ?').get(pluginId, req.project!.id);
    if (!row) return sendError(reply, 404, 'NOT_FOUND', 'Plugin not found.');
    core.prepare('DELETE FROM plugins WHERE id = ?').run(pluginId);
    if (isSafeId(pluginId)) fs.rmSync(fileFor(pluginId), { force: true });
    return { ok: true };
  });

  // Signed, short-lived URL the PluginHost points an iframe at (viewer-gated).
  app.get('/api/projects/:id/plugins/:pluginId/url', { preHandler: viewer }, async (req, reply) => {
    const pluginId = (req.params as { pluginId: string }).pluginId;
    const row = core.prepare('SELECT id FROM plugins WHERE id = ? AND project_id = ?').get(pluginId, req.project!.id);
    if (!row) return sendError(reply, 404, 'NOT_FOUND', 'Plugin not found.');
    const st = signSubject(app.config.sessionSecret, pluginId, URL_TTL_MS);
    return { url: `/plugin-content/${pluginId}?st=${encodeURIComponent(st)}`, expiresInMs: URL_TTL_MS };
  });

  // Read-only SQL surface for plugins (viewer-gated, rate-limited).
  app.post(
    '/api/projects/:id/plugin-query',
    { preHandler: viewer, config: { rateLimit: { max: 30, timeWindow: '10 seconds' } } },
    async (req, reply) => {
      const parsed = queryBody.safeParse(req.body);
      if (!parsed.success) return sendError(reply, 400, 'VALIDATION', 'A `sql` string is required.');
      const dbPath = app.dbManager.pathFor(req.project!.id);
      // Ensure the file exists (materialize) before the readonly worker opens it.
      app.dbManager.get(req.project!.id);
      try {
        const result: PluginQueryResult = await app.query.run({
          dbPath,
          sql: parsed.data.sql,
          params: parsed.data.params,
          maxRows: app.config.queryMaxRows,
          maxBytes: app.config.queryMaxBytes,
        });
        return result;
      } catch (e) {
        throw mapQueryError(e);
      }
    },
  );

  // Streams the plugin HTML with an opaque-origin CSP. Authorized by the signed
  // token only (the sandboxed iframe can't send the session cookie).
  app.get('/plugin-content/:pluginId', async (req, reply) => {
    const pluginId = (req.params as { pluginId: string }).pluginId;
    const st = (req.query as { st?: string }).st;
    if (!isSafeId(pluginId) || !st || !verifySubject(app.config.sessionSecret, pluginId, st)) {
      return sendError(reply, 403, 'FORBIDDEN', 'Invalid or expired plugin URL.');
    }
    const file = fileFor(pluginId);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      return sendError(reply, 404, 'NOT_FOUND', 'Plugin content not found.');
    }
    reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .header('Content-Length', String(stat.size))
      .header('Content-Security-Policy', 'sandbox allow-scripts')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, no-store');
    return reply.send(fs.createReadStream(file));
  });
}

function mapQueryError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  const code = (e as { code?: string }).code ?? 'INTERNAL';
  const message = (e as Error).message ?? 'Query failed.';
  switch (code) {
    case 'FORBIDDEN_STATEMENT':
      return new AppError(403, 'FORBIDDEN_STATEMENT', message);
    case 'SQL_ERROR':
      return new AppError(400, 'SQL_ERROR', message);
    case 'RESULT_TOO_LARGE':
      return new AppError(413, 'RESULT_TOO_LARGE', message);
    case 'TIMEOUT':
      return new AppError(408, 'TIMEOUT', 'Query timed out.');
    default:
      return new AppError(500, 'INTERNAL', 'Query failed.');
  }
}
