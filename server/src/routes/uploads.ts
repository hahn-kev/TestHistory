import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../lib/errors.js';
import { requireProject, type ProjectRow } from '../auth/project-access.js';
import { bearerFrom, resolveToken } from '../auth/tokens.js';
import { detect } from '../ingest/detect.js';
import { tmpDir } from '../config.js';
import { streamToTempFile } from '../lib/stream-to-file.js';
import type { IngestFile, IngestMeta } from '../ingest/types.js';
import { nowIso } from '../lib/ids.js';

interface RawBody {
  tempPath: string;
  size: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Temp files created for this request, swept in onResponse. */
    tempFiles?: string[];
  }
}

/** preHandler: allow either a session member (viewer+ isn't enough) or a valid bearer token. */
function uploadAuth(app: FastifyInstance) {
  const core = app.core;
  const sessionMember = requireProject(core, 'member');
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const bearer = bearerFrom(req.headers.authorization);
    if (bearer) {
      const projectId = (req.params as { id: string }).id;
      const resolved = resolveToken(core, bearer);
      const project = core.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as ProjectRow | undefined;
      if (!resolved || !project || resolved.projectId !== projectId) {
        throw new AppError(401, 'UNAUTHENTICATED', 'Invalid or missing credentials.');
      }
      req.project = project;
      req.projectAccess = 'member';
      return;
    }
    return sessionMember(req, reply);
  };
}

function queryStr(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Consume a multipart request: stream every `file` field to its own temp file
 * (detecting format per file, honoring a global `format` override) and collect
 * text fields. All files merge into one Run downstream.
 */
async function collectMultipart(
  req: FastifyRequest,
  dir: string,
  maxBytes: number,
  files: IngestFile[],
  fields: Record<string, string>,
  formatOverride: string | null,
): Promise<void> {
  for await (const part of req.parts()) {
    if (part.type === 'file') {
      const { tempPath, size } = await streamToTempFile(part.file, dir, maxBytes);
      (req.tempFiles ??= []).push(tempPath);
      if ((part.file as { truncated?: boolean }).truncated) {
        throw new AppError(413, 'TOO_LARGE', 'Upload exceeds the maximum allowed size.');
      }
      const format = detect(tempPath, formatOverride ?? undefined);
      if (!format) {
        throw new AppError(415, 'UNKNOWN_FORMAT', `Could not determine the format of ${part.filename ?? 'an upload'}.`);
      }
      files.push({ tempPath, fileName: part.filename ?? null, fileSize: size, format });
    } else {
      fields[part.fieldname] = String((part as { value: unknown }).value);
    }
  }
}

/** Map an ingest worker/queue error (carrying a `.code`) to an HTTP AppError. */
function mapIngestError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  const code = (e as { code?: string }).code;
  const message = (e as Error).message ?? 'Ingest failed.';
  switch (code) {
    case 'RUN_KEY_EXPIRED':
      return new AppError(409, 'RUN_KEY_EXPIRED', message);
    case 'PARSE_ERROR':
      return new AppError(422, 'PARSE_ERROR', message);
    case 'TIMEOUT':
      return new AppError(504, 'INGEST_TIMEOUT', 'Ingest timed out.');
    default:
      return new AppError(500, 'INTERNAL', 'Ingest failed.');
  }
}

export async function uploadRoutes(app: FastifyInstance) {
  const dir = tmpDir(app.config.dataDir);

  // Raw-body parser: stream application/xml (and text/xml) to a temp file.
  const rawParser = async (req: FastifyRequest, payload: NodeJS.ReadableStream) => {
    const { streamToTempFile } = await import('../lib/stream-to-file.js');
    const result = await streamToTempFile(payload as never, dir, app.config.maxUploadBytes);
    (req.tempFiles ??= []).push(result.tempPath);
    return result;
  };
  app.addContentTypeParser('application/xml', rawParser);
  app.addContentTypeParser('text/xml', rawParser);

  // Sweep any temp files this request created but the handler didn't consume.
  app.addHook('onResponse', async (req) => {
    if (req.tempFiles?.length) {
      const fs = await import('node:fs');
      for (const f of req.tempFiles) {
        try {
          fs.rmSync(f, { force: true });
        } catch {
          /* ignore */
        }
      }
    }
  });

  app.post(
    '/api/projects/:id/runs',
    { preHandler: uploadAuth(app) },
    async (req, reply) => {
      const project = req.project!;
      const q = req.query as Record<string, string>;

      const files: IngestFile[] = [];
      // Fields override query params when both are present (multipart form fields).
      const fields: Record<string, string> = {};

      if (req.isMultipart()) {
        await collectMultipart(req, dir, app.config.maxUploadBytes, files, fields, queryStr(q.format));
        if (files.length === 0) {
          throw new AppError(415, 'UNKNOWN_FORMAT', 'Multipart upload contained no `file` field.');
        }
      } else {
        const body = req.body as RawBody | undefined;
        if (!body || typeof body.tempPath !== 'string') {
          throw new AppError(415, 'UNKNOWN_FORMAT', 'Send an XML body (application/xml) or a multipart upload.');
        }
        const format = detect(body.tempPath, queryStr(q.format) ?? undefined);
        if (!format) {
          throw new AppError(415, 'UNKNOWN_FORMAT', 'Could not determine the test-result format. Pass ?format= to override.');
        }
        files.push({ tempPath: body.tempPath, fileName: queryStr(q.file_name), fileSize: body.size, format });
      }

      const pick = (field: string, query: string) => fields[field] ?? queryStr(q[query]);
      const meta: IngestMeta = {
        runKey: pick('run_key', 'run_key'),
        branch: pick('branch', 'branch'),
        commitSha: pick('commit', 'commit'),
        label: pick('label', 'label'),
        ciUrl: pick('ci_url', 'ci_url'),
        startedAt: pick('started_at', 'started_at'),
      };

      // Ensure the project DB is materialized/migrated, then dispatch.
      app.dbManager.get(project.id);
      const dbPath = app.dbManager.pathFor(project.id);
      let result;
      try {
        result = await app.ingest.enqueue(project.id, {
          dbPath,
          files,
          meta,
          now: nowIso(),
          windowMs: app.config.runAppendWindowMs,
        });
      } catch (e) {
        throw mapIngestError(e);
      } finally {
        // Temp file consumed (or discarded) by the worker; drop it from the sweep list.
        req.tempFiles = [];
      }
      return reply.code(result.created ? 201 : 200).send({ run: result.run });
    },
  );
}
