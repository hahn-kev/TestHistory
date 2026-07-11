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

/** Truncation caps per PLAN.md (message 16KB, stack 64KB). */
export const MESSAGE_CAP = 16 * 1024;
export const STACK_CAP = 64 * 1024;

export function truncate(value: string | undefined, cap: number): string | undefined {
  if (value === undefined) return undefined;
  return value.length > cap ? value.slice(0, cap) : value;
}
