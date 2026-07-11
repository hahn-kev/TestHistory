import type { ResultFormat, RunSummary } from '@testhistory/shared';
import type { NameRule } from './names.js';

/** One file handed to the ingest worker (already streamed to a temp path). */
export interface IngestFile {
  tempPath: string;
  fileName: string | null;
  fileSize: number | null;
  format: ResultFormat;
}

/** Run identity/metadata carried on the upload request. */
export interface IngestMeta {
  runKey: string | null;
  branch: string | null;
  commitSha: string | null;
  label: string | null;
  ciUrl: string | null;
  startedAt: string | null;
}

export interface IngestPayload {
  dbPath: string;
  files: IngestFile[];
  meta: IngestMeta;
  /** Wall-clock receipt time, ISO (passed in — workers can't use Date.now for determinism in tests). */
  now: string;
  windowMs: number;
  /** Name rules override for tests; when omitted the worker reads them from the DB. */
  nameRules?: NameRule[];
}

export interface IngestResult {
  run: RunSummary;
  created: boolean;
}
