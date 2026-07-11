import { parentPort } from 'node:worker_threads';
import Database from 'better-sqlite3';
import { applyConnectionPragmas } from '../db/migrate.js';
import { ingest, IngestError } from './ingest-core.js';
import type { IngestPayload } from './types.js';

/**
 * Ingest worker: runs the parse + SQLite transaction off the main thread so a
 * large upload never blocks the event loop. One task per message.
 */
if (!parentPort) throw new Error('ingest-worker must run as a worker thread');
const port = parentPort;

port.on('message', async (msg: { id: number; payload: IngestPayload }) => {
  const { id, payload } = msg;
  let db: Database.Database | null = null;
  try {
    db = new Database(payload.dbPath);
    applyConnectionPragmas(db);
    const result = await ingest(db, payload);
    port.postMessage({ id, ok: true, result });
  } catch (e) {
    const code = e instanceof IngestError ? e.code : 'INTERNAL';
    port.postMessage({ id, ok: false, error: { code, message: (e as Error).message } });
  } finally {
    if (db) db.close();
  }
});
