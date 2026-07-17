import fs from 'node:fs';
import type { Database as Db } from 'better-sqlite3';
import type { CiJobOutcome, RunSummary, UploadInfo, ResultFormat } from '@testhistory/shared';
import { parseCiJobOutcome } from '@testhistory/shared';
import { parseStream } from './parse.js';
import { STATUS_CODE, MESSAGE_CAP, STACK_CAP, truncate, statusSeveritySql } from './model.js';
import { compileRules, applyRules, type NameRule, type CompiledRule } from './names.js';
import { recomputeRunCounters, resolveAppendTarget } from '../analytics/analytics.js';
import type { IngestPayload, IngestResult } from './types.js';

/** Thrown for expected ingest failures; the worker maps `.code` to an HTTP status. */
export class IngestError extends Error {
  constructor(
    public code: 'RUN_KEY_EXPIRED' | 'PARSE_ERROR',
    message: string,
  ) {
    super(message);
  }
}

interface RunRow {
  id: number;
  run_key: string | null;
  created_at: string;
  started_at: string | null;
  duration_ms: number | null;
  label: string | null;
  branch: string | null;
  commit_sha: string | null;
  ci_url: string | null;
  ci_job_outcome: string | null;
  uploads_json: string;
  total: number;
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
}

function minIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() <= new Date(b).getTime() ? a : b;
}

/**
 * Sticky CI Job Outcome merge (ADR-0003):
 * - omitted/null incoming leaves existing unchanged
 * - once failed or cancelled, never clear back to unset
 * - if both trouble values appear across Uploads, prefer cancelled over failed
 */
export function mergeCiJobOutcome(
  existing: CiJobOutcome | null,
  incoming: CiJobOutcome | null | undefined,
): CiJobOutcome | null {
  const next = incoming == null ? null : parseCiJobOutcome(incoming);
  if (next == null) return existing;
  if (existing == null) return next;
  if (existing === 'cancelled' || next === 'cancelled') return 'cancelled';
  return 'failed';
}

/**
 * Ingest one POST's files into a project DB in a single transaction. Resolves
 * the append target by run key, streams + parses each file applying name rules,
 * upserts tests/results (severity-aware merge on (test_id,run_id)), appends uploads,
 * and recomputes counters + duration/started_at from source data. A parse error
 * rolls the whole POST back. Returns the run summary and whether it was created.
 */
export async function ingest(db: Db, payload: IngestPayload): Promise<IngestResult> {
  const { meta, files, now, windowMs } = payload;
  const rules: NameRule[] =
    payload.nameRules ??
    (db.prepare('SELECT match, rewrite FROM name_rules ORDER BY position').all() as NameRule[]);
  let compiled: CompiledRule[];
  try {
    compiled = compileRules(rules);
  } catch {
    // Stored rules are validated on write; treat a broken one as verbatim passthrough.
    compiled = [];
  }

  const resolution = resolveAppendTarget(db, meta.runKey, new Date(now).getTime(), windowMs);
  if (resolution.action === 'expired') {
    throw new IngestError(
      'RUN_KEY_EXPIRED',
      'This run key was used by a previous run — run keys must be unique per build.',
    );
  }

  const incomingOutcome = parseCiJobOutcome(meta.ciJobOutcome ?? null);

  db.exec('BEGIN');
  try {
    let runId: number;
    let created: boolean;
    if (resolution.action === 'append') {
      runId = resolution.runId;
      created = false;
    } else {
      const info = db
        .prepare(
          `INSERT INTO runs (run_key, created_at, started_at, branch, commit_sha, label, ci_url, ci_job_outcome, uploads_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]')`,
        )
        .run(
          meta.runKey,
          now,
          meta.startedAt,
          meta.branch,
          meta.commitSha,
          meta.label,
          meta.ciUrl,
          incomingOutcome,
        );
      runId = Number(info.lastInsertRowid);
      created = true;
    }

    const upsertTest = db.prepare(
      `INSERT INTO tests (suite, name, first_seen_run_id, last_seen_run_id)
       VALUES (@suite, @name, @runId, @runId)
       ON CONFLICT(suite, name) DO UPDATE SET last_seen_run_id = MAX(last_seen_run_id, excluded.last_seen_run_id)
       RETURNING id`,
    );
    // On collision, keep the more-severe outcome (and its detail) rather than
    // blindly the last one written, so a failing row can't be masked by a later
    // passing/skipped row for the same identity. Ties keep the newer row. Every
    // collision bumps case_count so unexpected merges are detectable after the fact.
    const takeNew = `${statusSeveritySql('excluded.status')} >= ${statusSeveritySql('status')}`;
    const upsertResult = db.prepare(
      `INSERT INTO results (test_id, run_id, status, duration_ms, message, stack)
       VALUES (@testId, @runId, @status, @durationMs, @message, @stack)
       ON CONFLICT(test_id, run_id) DO UPDATE SET
         status      = CASE WHEN ${takeNew} THEN excluded.status      ELSE status      END,
         duration_ms = CASE WHEN ${takeNew} THEN excluded.duration_ms ELSE duration_ms END,
         message     = CASE WHEN ${takeNew} THEN excluded.message     ELSE message     END,
         stack       = CASE WHEN ${takeNew} THEN excluded.stack       ELSE stack       END,
         case_count  = case_count + 1`,
    );

    const testIdCache = new Map<string, number>();
    const newUploads: UploadInfo[] = [];

    for (const file of files) {
      let fileDuration = 0;
      let sawDuration = false;
      const stream = fs.createReadStream(file.tempPath);
      try {
        await parseStream(file.format, stream, (tc) => {
          const { suite, name } = applyRules(compiled, tc.suite, tc.name);
          const key = `${suite}\0${name}`;
          let testId = testIdCache.get(key);
          if (testId === undefined) {
            const row = upsertTest.get({ suite, name, runId }) as { id: number };
            testId = row.id;
            testIdCache.set(key, testId);
          }
          upsertResult.run({
            testId,
            runId,
            status: STATUS_CODE[tc.status],
            durationMs: tc.durationMs ?? null,
            message: truncate(tc.message, MESSAGE_CAP) ?? null,
            stack: truncate(tc.stack, STACK_CAP) ?? null,
          });
          if (tc.durationMs !== undefined) {
            fileDuration += tc.durationMs;
            sawDuration = true;
          }
        });
      } catch (e) {
        throw new IngestError('PARSE_ERROR', `Failed to parse ${file.fileName ?? 'upload'}: ${(e as Error).message}`);
      }
      newUploads.push({
        fileName: file.fileName,
        fileSize: file.fileSize,
        format: file.format,
        durationMs: sawDuration ? fileDuration : null,
        uploadedAt: now,
      });
    }

    // Merge uploads and recompute run-level duration/started_at from all uploads.
    const runRow = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as RunRow;
    const existingUploads: UploadInfo[] = JSON.parse(runRow.uploads_json);
    const allUploads = [...existingUploads, ...newUploads];
    const durationMs = allUploads.reduce((sum, u) => sum + (u.durationMs ?? 0), 0);
    const startedFromNew = meta.startedAt ?? now;
    const startedAt = minIso(runRow.started_at, startedFromNew);
    const ciJobOutcome = created
      ? incomingOutcome
      : mergeCiJobOutcome(parseCiJobOutcome(runRow.ci_job_outcome), incomingOutcome);

    db.prepare(
      'UPDATE runs SET uploads_json = ?, duration_ms = ?, started_at = ?, ci_job_outcome = ? WHERE id = ?',
    ).run(JSON.stringify(allUploads), durationMs, startedAt, ciJobOutcome, runId);

    const counters = recomputeRunCounters(db, runId);
    db.exec('COMMIT');

    const finalRow = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as RunRow;
    const run: RunSummary = {
      id: finalRow.id,
      createdAt: finalRow.created_at,
      startedAt: finalRow.started_at,
      durationMs: finalRow.duration_ms,
      label: finalRow.label,
      branch: finalRow.branch,
      commitSha: finalRow.commit_sha,
      ciUrl: finalRow.ci_url,
      ciJobOutcome: parseCiJobOutcome(finalRow.ci_job_outcome),
      uploads: JSON.parse(finalRow.uploads_json) as UploadInfo[],
      total: counters.total,
      passed: counters.passed,
      failed: counters.failed,
      errored: counters.errored,
      skipped: counters.skipped,
    };
    return { run, created };
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* already rolled back */
    }
    throw e;
  }
}

export type { ResultFormat };
