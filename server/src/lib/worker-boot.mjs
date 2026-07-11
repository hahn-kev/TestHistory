// Source-mode worker bootstrap. `execArgv: ['--import','tsx']` is unreliable for
// worker threads on Node 22 (the entry loads via native type-stripping, which
// won't remap `.js`→`.ts` imports), so we register tsx's ESM loader as actual
// code inside this worker thread, then import the real TS worker entry
// (its file URL arrives via workerData.entry). Production runs compiled .js and
// never touches this file.
import { register } from 'tsx/esm/api';
import { workerData } from 'node:worker_threads';
register();
await import(workerData.entry);
