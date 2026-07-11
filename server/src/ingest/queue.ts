import fs from 'node:fs';
import { WorkerPool, resolveWorker } from '../lib/worker-pool.js';
import type { IngestPayload, IngestResult } from './types.js';

/**
 * Serializes ingest per project (single writer) and dispatches the actual work
 * to the ingest worker pool. Temp files are deleted after the worker finishes,
 * whether it succeeded or failed.
 */
export class IngestService {
  private readonly pool: WorkerPool;
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(size: number, private readonly timeoutMs: number) {
    const { url, execArgv, workerData } = resolveWorker(import.meta.url, './ingest-worker');
    this.pool = new WorkerPool(url, execArgv, size, workerData);
  }

  /** Enqueue an ingest for `projectId`; resolves with the run summary. */
  enqueue(projectId: string, payload: IngestPayload): Promise<IngestResult> {
    const prev = this.chains.get(projectId) ?? Promise.resolve();
    const run = prev
      .catch(() => {})
      .then(() => this.pool.run<IngestResult>(payload, this.timeoutMs))
      .finally(() => {
        for (const f of payload.files) {
          try {
            fs.rmSync(f.tempPath, { force: true });
          } catch {
            /* ignore */
          }
        }
      });
    // Keep the chain alive regardless of this task's outcome.
    this.chains.set(
      projectId,
      run.catch(() => {}),
    );
    return run;
  }

  async destroy() {
    await this.pool.destroy();
  }
}

/** Remove stale files left in the temp dir by an interrupted ingest (boot sweep). */
export function sweepTmpDir(dir: string): void {
  try {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      try {
        fs.rmSync(`${dir}/${f}`, { force: true });
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}
