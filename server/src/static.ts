import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/**
 * Serve the built web app (single container). Static assets are served from
 * `WEB_DIR` (defaults to the sibling `web/dist`); any other non-API GET falls
 * back to `index.html` so client-side routes work on refresh. No-op in dev,
 * where Vite serves the app and proxies `/api`.
 */
export async function registerStatic(app: FastifyInstance) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const webDir = process.env.WEB_DIR ?? path.resolve(here, '../../web/dist');
  if (!fs.existsSync(path.join(webDir, 'index.html'))) return;

  await app.register(fastifyStatic, { root: webDir, wildcard: false });

  app.setNotFoundHandler((req, reply) => {
    if (req.method !== 'GET' || req.url.startsWith('/api') || req.url.startsWith('/plugin-content')) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
    }
    return reply.sendFile('index.html');
  });
}
