import type { TestStatus, ResultFormat } from '@testhistory/shared';

export type { TestStatus, ResultFormat };

/** The common model every parser emits, one per test case. */
export interface TestCase {
  suite: string;
  name: string;
  status: TestStatus;
  durationMs?: number;
  message?: string;
  stack?: string;
}

export const STATUS_CODE: Record<TestStatus, number> = {
  passed: 0,
  failed: 1,
  error: 2,
  skipped: 3,
};

export const STATUS_NAME: TestStatus[] = ['passed', 'failed', 'error', 'skipped'];

/**
 * Merge precedence when two results collide on the same `(test_id, run_id)`:
 * `error > failed > passed > skipped`. Deliberately distinct from STATUS_CODE
 * (where skipped sorts highest) — the point is that a real outcome must never be
 * masked by a later skip, and a failure must never be masked by a later pass.
 */
export const STATUS_SEVERITY: Record<TestStatus, number> = {
  skipped: 0,
  passed: 1,
  failed: 2,
  error: 3,
};

/** Compare two statuses by merge precedence; positive means `a` is more severe. */
export function severityOf(status: TestStatus): number {
  return STATUS_SEVERITY[status];
}

/**
 * A SQL `CASE` fragment mapping a stored status-code column to its severity rank,
 * so worst-wins merges can be expressed in the upsert. Built from the maps above
 * to keep a single source of truth.
 */
export function statusSeveritySql(col: string): string {
  const whens = STATUS_NAME.map((s) => `WHEN ${STATUS_CODE[s]} THEN ${STATUS_SEVERITY[s]}`).join(' ');
  return `CASE ${col} ${whens} ELSE 0 END`;
}

/** Truncation caps per PLAN.md (message 16KB, stack 64KB). */
export const MESSAGE_CAP = 16 * 1024;
export const STACK_CAP = 64 * 1024;

export function truncate(value: string | undefined, cap: number): string | undefined {
  if (value === undefined) return undefined;
  return value.length > cap ? value.slice(0, cap) : value;
}
