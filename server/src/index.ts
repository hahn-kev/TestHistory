import { buildApp } from './app.js';
import { resolveConfig } from './config.js';

const config = resolveConfig();
const app = await buildApp(config);

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

try {
  await app.listen({ port, host });
  console.log(`TestHistory server listening on http://${host}:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
