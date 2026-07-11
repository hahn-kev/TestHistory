import Fastify, { type FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
  }
}

/**
 * Build a configured Fastify instance. Returns the app without listening so
 * tests can drive it via `app.inject()`; `index.ts` owns the actual listen.
 */
export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  // Keep Fastify's small default body limit globally; the streaming upload
  // route (added later) enforces `maxUploadBytes` itself rather than buffering.
  const app = Fastify({
    logger: false,
  });

  app.decorate('config', config);

  app.get('/api/health', async () => ({ ok: true }));

  return app;
}
