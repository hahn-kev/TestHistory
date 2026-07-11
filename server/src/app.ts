import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import type { Database as Db } from 'better-sqlite3';
import type { AppConfig } from './config.js';
import { openCoreDb } from './db/core-db.js';
import { DbManager } from './db/project-db.js';
import { SESSION_COOKIE, resolveSession, sweepExpiredSessions } from './auth/sessions.js';
import { authRoutes } from './routes/auth.js';
import { adminUserRoutes } from './routes/admin-users.js';
import { projectRoutes } from './routes/projects.js';
import { memberRoutes } from './routes/members.js';
import { tokenRoutes } from './routes/tokens.js';
import { uploadRoutes } from './routes/uploads.js';
import { readRoutes } from './routes/reads.js';
import { nameRuleRoutes } from './routes/name-rules.js';
import { pluginRoutes } from './routes/plugins.js';
import { IngestService, sweepTmpDir } from './ingest/queue.js';
import { QueryService } from './query/pool.js';
import { registerStatic } from './static.js';
import { registerErrorHandler } from './lib/errors.js';
import { tmpDir } from './config.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    core: Db;
    dbManager: DbManager;
    ingest: IngestService;
    query: QueryService;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Build a configured Fastify instance. Returns the app without listening so
 * tests can drive it via `app.inject()`; `index.ts` owns the actual listen.
 */
export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.decorate('config', config);

  const core = openCoreDb(config.dataDir);
  app.decorate('core', core);

  const dbManager = new DbManager(config.dataDir);
  dbManager.migrateAll();
  app.decorate('dbManager', dbManager);

  // Sweep any temp files left by an interrupted ingest, then stand up the pool.
  sweepTmpDir(tmpDir(config.dataDir));
  const ingestService = new IngestService(2, config.ingestTimeoutMs);
  app.decorate('ingest', ingestService);

  const queryService = new QueryService(config.queryTimeoutMs);
  app.decorate('query', queryService);

  registerErrorHandler(app);

  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(multipart, {
    limits: { fileSize: Math.max(config.maxUploadBytes, config.maxPluginBytes) },
  });

  // Resolve the session cookie into `request.user` for every request.
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    const raw = req.cookies[SESSION_COOKIE];
    req.user = raw ? resolveSession(core, raw, config.sessionTtlDays) : null;
  });

  app.get('/api/health', async () => ({ ok: true }));

  await app.register(authRoutes);
  await app.register(adminUserRoutes);
  await app.register(projectRoutes);
  await app.register(memberRoutes);
  await app.register(tokenRoutes);
  await app.register(uploadRoutes);
  await app.register(readRoutes);
  await app.register(nameRuleRoutes);
  await app.register(pluginRoutes);
  await registerStatic(app);

  // Daily expired-session sweep (unref'd so it never holds the process open).
  const sweepTimer = setInterval(() => {
    try {
      sweepExpiredSessions(core);
    } catch {
      /* best effort */
    }
  }, DAY_MS);
  sweepTimer.unref?.();

  app.addHook('onClose', async () => {
    clearInterval(sweepTimer);
    await ingestService.destroy();
    await queryService.destroy();
    dbManager.closeAll();
    core.close();
  });

  return app;
}
