import { WorkerPool, resolveWorker } from '../lib/worker-pool.js';
import type { PluginQueryResult } from '@testhistory/shared';

export interface QueryRequest {
  dbPath: string;
  sql: string;
  params?: unknown[];
  maxRows: number;
  maxBytes: number;
}

/**
 * Dedicated 2-worker pool for plugin queries. The WorkerPool's per-task timeout
 * `terminate()`s and respawns a stuck worker (readonly connection = safe to
 * kill), so a recursive-CTE bomb resolves as TIMEOUT and the next query lands
 * on a fresh worker.
 */
export class QueryService {
  private readonly pool: WorkerPool;
  constructor(private readonly timeoutMs: number, size = 2) {
    const { url, execArgv, workerData } = resolveWorker(import.meta.url, './query-worker');
    this.pool = new WorkerPool(url, execArgv, size, workerData);
  }

  run(req: QueryRequest): Promise<PluginQueryResult> {
    return this.pool.run<PluginQueryResult>(req, this.timeoutMs);
  }

  async destroy() {
    await this.pool.destroy();
  }
}
