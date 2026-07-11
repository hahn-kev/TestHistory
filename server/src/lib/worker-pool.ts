import { Worker } from 'node:worker_threads';

export interface WorkerError {
  code: string;
  message: string;
}

interface Task {
  id: number;
  payload: unknown;
  timeoutMs?: number;
  resolve: (value: unknown) => void;
  reject: (err: Error & { code?: string }) => void;
}

interface Slot {
  worker: Worker;
  current: Task | null;
  timer: NodeJS.Timeout | null;
}

/**
 * A small fixed-size worker_threads pool. Each worker runs one task at a time;
 * excess tasks queue. Supports a per-task timeout that `terminate()`s the stuck
 * worker and respawns a fresh one — the reason we don't use piscina, which
 * can't cancel a synchronous task (blocking better-sqlite3 calls). The message
 * protocol: main → worker `{ id, payload }`; worker → main
 * `{ id, ok, result }` | `{ id, ok:false, error:{code,message} }`.
 */
export class WorkerPool {
  private readonly slots: Slot[] = [];
  private readonly queue: Task[] = [];
  private nextId = 1;
  private destroyed = false;

  constructor(
    private readonly workerUrl: URL,
    private readonly execArgv: string[],
    size: number,
    private readonly workerData?: unknown,
  ) {
    for (let i = 0; i < size; i++) this.slots.push(this.spawn());
  }

  private spawn(): Slot {
    const worker = new Worker(this.workerUrl, { execArgv: this.execArgv, workerData: this.workerData });
    const slot: Slot = { worker, current: null, timer: null };
    worker.on('message', (msg: { id: number; ok: boolean; result?: unknown; error?: WorkerError }) => {
      const task = slot.current;
      if (!task || task.id !== msg.id) return;
      this.finish(slot);
      if (msg.ok) task.resolve(msg.result);
      else {
        const e = new Error(msg.error?.message ?? 'worker error') as Error & { code?: string };
        e.code = msg.error?.code ?? 'INTERNAL';
        task.reject(e);
      }
      this.pump();
    });
    worker.on('error', (err) => {
      // Unexpected crash: fail the in-flight task and replace the worker.
      const task = slot.current;
      this.finish(slot);
      this.replace(slot);
      if (task) {
        const e = err as Error & { code?: string };
        e.code = (e.code as string) ?? 'INTERNAL';
        task.reject(e);
      }
      this.pump();
    });
    return slot;
  }

  private finish(slot: Slot) {
    if (slot.timer) {
      clearTimeout(slot.timer);
      slot.timer = null;
    }
    slot.current = null;
  }

  private replace(slot: Slot) {
    try {
      void slot.worker.terminate();
    } catch {
      /* ignore */
    }
    if (this.destroyed) return;
    const fresh = this.spawn();
    slot.worker = fresh.worker;
    slot.current = null;
    slot.timer = null;
  }

  /** Run a task; rejects with a `TIMEOUT`-coded error if it exceeds `timeoutMs`. */
  run<T = unknown>(payload: unknown, timeoutMs?: number): Promise<T> {
    if (this.destroyed) return Promise.reject(new Error('pool destroyed'));
    return new Promise<T>((resolve, reject) => {
      const task: Task = {
        id: this.nextId++,
        payload,
        timeoutMs,
        resolve: resolve as (v: unknown) => void,
        reject,
      };
      this.queue.push(task);
      this.pump();
    });
  }

  private pump() {
    if (this.destroyed) return;
    for (const slot of this.slots) {
      if (slot.current || this.queue.length === 0) continue;
      const task = this.queue.shift()!;
      slot.current = task;
      if (task.timeoutMs && task.timeoutMs > 0) {
        slot.timer = setTimeout(() => {
          const t = slot.current;
          this.finish(slot);
          this.replace(slot);
          if (t) {
            const e = new Error('operation timed out') as Error & { code?: string };
            e.code = 'TIMEOUT';
            t.reject(e);
          }
          this.pump();
        }, task.timeoutMs);
        slot.timer.unref?.();
      }
      slot.worker.postMessage({ id: task.id, payload: task.payload });
    }
  }

  async destroy() {
    this.destroyed = true;
    for (const t of this.queue.splice(0)) t.reject(new Error('pool destroyed'));
    await Promise.all(this.slots.map((s) => s.worker.terminate().catch(() => {})));
  }
}

export interface ResolvedWorker {
  url: URL;
  execArgv: string[];
  workerData?: unknown;
}

/**
 * Resolve a worker script relative to a caller module, handling both source
 * (`.ts` via the tsx bootstrap) and compiled (`.js` under dist) execution. Pass
 * the relative path without extension, e.g. `'../ingest/ingest-worker'`. In
 * source mode we launch `worker-boot.mjs`, which registers tsx and imports the
 * real `.ts` entry (execArgv `--import` doesn't take effect for workers here).
 */
export function resolveWorker(importMetaUrl: string, relPath: string): ResolvedWorker {
  const isTs = importMetaUrl.endsWith('.ts');
  if (isTs) {
    const entry = new URL(`${relPath}.ts`, importMetaUrl).href;
    return {
      url: new URL('./worker-boot.mjs', import.meta.url),
      execArgv: [],
      workerData: { entry },
    };
  }
  return { url: new URL(`${relPath}.js`, importMetaUrl), execArgv: [] };
}
