import type { RunComparison, RunSummary, ComparedTest } from '@testhistory/shared';

/**
 * Render a {@link RunComparison} as a compact Markdown summary suitable for a CI
 * bot to post as a PR comment. Pure (no DB, no I/O) so it's trivially testable.
 * Ends with a stable HTML-comment marker so a CI job can find and update its own
 * comment in place rather than posting a new one each build.
 */
export const COMPARE_MARKER = '<!-- testhistory-compare -->';

/** How many failing tests to list inline before collapsing to a "+N more" line. */
const MAX_LISTED = 20;

function runLabel(run: RunSummary): string {
  const parts = [`#${run.id}`];
  const ref = [run.branch, run.commitSha ? run.commitSha.slice(0, 8) : null].filter(Boolean).join('@');
  if (ref) parts.push(`(${ref})`);
  return parts.join(' ');
}

function fmtSigned(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function fmtDurationDelta(ms: number | null): string {
  if (ms == null) return '—';
  const sign = ms > 0 ? '+' : ms < 0 ? '-' : '';
  const abs = Math.abs(ms);
  if (abs < 1000) return `${sign}${Math.round(abs)}ms`;
  return `${sign}${(abs / 1000).toFixed(1)}s`;
}

function listTests(tests: ComparedTest[], total: number): string[] {
  const lines = tests.slice(0, MAX_LISTED).map((t) => `- \`${t.suite} › ${t.name}\``);
  const shown = Math.min(tests.length, MAX_LISTED);
  if (total > shown) lines.push(`- …and ${total - shown} more`);
  return lines;
}

export function formatComparisonMarkdown(cmp: RunComparison): string {
  const { summary, categories } = cmp;
  const lines: string[] = [];

  lines.push(`### Test comparison: ${runLabel(cmp.base)} → ${runLabel(cmp.head)}`);
  lines.push('');
  const verdict =
    summary.regressions > 0 ? `🔴 ${summary.regressions} newly failing` : '🟢 no new failures';
  lines.push(verdict);
  lines.push('');
  lines.push('| Change | Count |');
  lines.push('| --- | --- |');
  lines.push(`| 🔴 Newly failing | ${summary.regressions} |`);
  lines.push(`| 🟢 Newly fixed | ${summary.fixed} |`);
  lines.push(`| 🟠 Still failing | ${summary.stillFailing} |`);
  lines.push(`| ➕ New tests | ${summary.newTests} |`);
  lines.push(`| ➖ Removed tests | ${summary.removedTests} |`);
  lines.push('');
  lines.push(
    `Passed ${fmtSigned(summary.passedDelta)} · Failed ${fmtSigned(summary.failedDelta)} · ` +
      `Error ${fmtSigned(summary.erroredDelta)} · Skipped ${fmtSigned(summary.skippedDelta)} · ` +
      `Duration ${fmtDurationDelta(summary.durationDeltaMs)}`,
  );

  if (summary.regressions > 0) {
    lines.push('');
    lines.push('#### Newly failing');
    lines.push(...listTests(categories.newlyFailing.tests, categories.newlyFailing.total));
  }

  lines.push('');
  lines.push(COMPARE_MARKER);
  return lines.join('\n');
}
