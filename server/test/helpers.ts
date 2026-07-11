import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { resolveConfig, type AppConfig } from '../src/config.js';

export interface TestApp {
  app: FastifyInstance;
  dataDir: string;
  close: () => Promise<void>;
}

/** Build an app against a fresh temp DATA_DIR. Remember to call close(). */
export async function makeApp(overrides: Partial<AppConfig> = {}): Promise<TestApp> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'th-test-'));
  const app = await buildApp(resolveConfig({ dataDir, sessionSecret: 'test-secret', ...overrides }));
  return {
    app,
    dataDir,
    close: async () => {
      await app.close();
      // On Windows a worker terminated mid-query can briefly hold a DB file
      // handle (released at process exit); tolerate the transient EBUSY.
      try {
        fs.rmSync(dataDir, { recursive: true, force: true });
      } catch {
        /* leave the OS to reclaim the temp dir */
      }
    },
  };
}

/** Extract the th_session cookie value from a Set-Cookie header list. */
export function sessionCookieFrom(res: { cookies: Array<{ name: string; value: string }> }): string | undefined {
  return res.cookies.find((c) => c.name === 'th_session')?.value;
}

/** Run first-user setup and return the session cookie header string. */
export async function setupAdmin(
  app: FastifyInstance,
  creds = { email: 'admin@example.com', password: 'password123', displayName: 'Admin' },
): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/setup', payload: creds });
  if (res.statusCode !== 201) throw new Error(`setup failed: ${res.statusCode} ${res.body}`);
  const cookie = sessionCookieFrom(res);
  return `th_session=${cookie}`;
}

/** Log in with credentials; returns the session cookie header string. */
export async function login(
  app: FastifyInstance,
  email: string,
  password: string,
): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  return `th_session=${sessionCookieFrom(res)}`;
}

/** Admin-create a user with the given role/password. Returns the created user's id. */
export async function createUser(
  app: FastifyInstance,
  adminCookie: string,
  email: string,
  password = 'password123',
  role: 'admin' | 'user' = 'user',
): Promise<number> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/admin/users',
    headers: { cookie: adminCookie },
    payload: { email, password, displayName: email.split('@')[0], role },
  });
  if (res.statusCode !== 201) throw new Error(`createUser failed: ${res.statusCode} ${res.body}`);
  return res.json().user.id as number;
}
