import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface AppConfig {
  dataDir: string;
  sessionSecret: string;
  /** Max size of an uploaded test result file, bytes. */
  maxUploadBytes: number;
  /** Max size of an uploaded plugin HTML file, bytes. */
  maxPluginBytes: number;
  /** Plugin SQL query limits. */
  queryMaxRows: number;
  queryMaxBytes: number;
  queryTimeoutMs: number;
  ingestTimeoutMs: number;
  /** How long after a Run's creation further uploads may append to it. */
  runAppendWindowMs: number;
  /** Session sliding-expiry length in days. */
  sessionTtlDays: number;
}

export function resolveConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const dataDir = overrides.dataDir ?? process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  let sessionSecret = overrides.sessionSecret ?? process.env.SESSION_SECRET;
  if (!sessionSecret) {
    // Persist an auto-generated secret so signed URLs and sessions survive restarts.
    const secretFile = path.join(dataDir, 'secret');
    if (fs.existsSync(secretFile)) {
      sessionSecret = fs.readFileSync(secretFile, 'utf8').trim();
    } else {
      sessionSecret = crypto.randomBytes(32).toString('hex');
      fs.writeFileSync(secretFile, sessionSecret, { mode: 0o600 });
    }
  }

  return {
    dataDir,
    sessionSecret,
    maxUploadBytes: overrides.maxUploadBytes ?? envInt('MAX_UPLOAD_BYTES', 200 * 1024 * 1024),
    maxPluginBytes: overrides.maxPluginBytes ?? envInt('MAX_PLUGIN_BYTES', 100 * 1024 * 1024),
    queryMaxRows: overrides.queryMaxRows ?? envInt('QUERY_MAX_ROWS', 10_000),
    queryMaxBytes: overrides.queryMaxBytes ?? envInt('QUERY_MAX_BYTES', 5 * 1024 * 1024),
    queryTimeoutMs: overrides.queryTimeoutMs ?? envInt('QUERY_TIMEOUT_MS', 2_000),
    ingestTimeoutMs: overrides.ingestTimeoutMs ?? envInt('INGEST_TIMEOUT_MS', 5 * 60_000),
    runAppendWindowMs: overrides.runAppendWindowMs ?? envInt('RUN_APPEND_WINDOW_MS', 3_600_000),
    sessionTtlDays: overrides.sessionTtlDays ?? envInt('SESSION_TTL_DAYS', 30),
  };
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function projectsDir(dataDir: string): string {
  return path.join(dataDir, 'projects');
}
export function pluginsDir(dataDir: string): string {
  return path.join(dataDir, 'plugins');
}
export function tmpDir(dataDir: string): string {
  return path.join(dataDir, 'tmp');
}
