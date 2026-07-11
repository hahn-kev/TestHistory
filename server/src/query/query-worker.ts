import { parentPort } from 'node:worker_threads';
import Database from 'better-sqlite3';
import { isReadOnlyStatement } from './sql-guard.js';

/**
 * Plugin query worker: opens the project DB strictly read-only, enforces the
 * SELECT/WITH allowlist + single statement, and caps rows/bytes. Runs in its
 * own pool so a hostile query that must be killed (via terminate-on-timeout on
 * the main thread) never wedges ingest.
 */
if (!parentPort) throw new Error('query-worker must run as a worker thread');
const port = parentPort;

interface QueryPayload {
  dbPath: string;
  sql: string;
  params?: unknown[];
  maxRows: number;
  maxBytes: number;
}

function fail(code: string, message: string): never {
  const e = new Error(message) as Error & { code: string };
  e.code = code;
  throw e;
}

port.on('message', (msg: { id: number; payload: QueryPayload }) => {
  const { id, payload } = msg;
  const started = Date.now();
  let db: Database.Database | null = null;
  try {
    if (!isReadOnlyStatement(payload.sql)) {
      fail('FORBIDDEN_STATEMENT', 'Only SELECT/WITH queries are allowed.');
    }
    db = new Database(payload.dbPath, { readonly: true, fileMustExist: true });
    db.pragma('query_only = ON');
    db.pragma('trusted_schema = OFF');

    let stmt;
    try {
      stmt = db.prepare(payload.sql); // throws on multiple statements
    } catch (e) {
      fail('SQL_ERROR', (e as Error).message);
    }
    stmt.raw(true);

    const columns = stmt.columns().map((c) => c.name);
    const rows: unknown[][] = [];
    let bytes = 0;
    let truncated = false;
    try {
      for (const row of stmt.iterate(...(payload.params ?? []))) {
        if (rows.length >= payload.maxRows) {
          truncated = true;
          break;
        }
        bytes += JSON.stringify(row).length;
        if (bytes > payload.maxBytes) {
          fail('RESULT_TOO_LARGE', 'Query result exceeds the maximum serialized size.');
        }
        rows.push(row as unknown[]);
      }
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'RESULT_TOO_LARGE') throw e;
      fail('SQL_ERROR', (e as Error).message);
    }

    port.postMessage({
      id,
      ok: true,
      result: { columns, rows, rowCount: rows.length, truncated, durationMs: Date.now() - started },
    });
  } catch (e) {
    const code = (e as { code?: string }).code ?? 'INTERNAL';
    port.postMessage({ id, ok: false, error: { code, message: (e as Error).message } });
  } finally {
    if (db) db.close();
  }
});
