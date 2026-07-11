import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import type { Database as Db } from 'better-sqlite3';
import type { AppConfig } from './config.js';
import { openCoreDb } from './db/core-db.js';
import { SESSION_COOKIE, resolveSession, sweepExpiredSessions } from './auth/sessions.js';
import { authRoutes } from './routes/auth.js';
import { adminUserRoutes } from './routes/admin-users.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    core: Db;
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

  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  // Resolve the session cookie into `request.user` for every request.
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    const raw = req.cookies[SESSION_COOKIE];
    req.user = raw ? resolveSession(core, raw, config.sessionTtlDays) : null;
  });

  app.get('/api/health', async () => ({ ok: true }));

  await app.register(authRoutes);
  await app.register(adminUserRoutes);

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
    core.close();
  });

  return app;
}
