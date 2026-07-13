import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { ChangeCategory, ComparedStatus, ComparedTest, RunComparison } from '@testhistory/shared';
import { api } from '../api/client.js';
import { useAsync } from '../hooks.js';
import { Button, Card, EmptyState, ErrorBox, Field, Input, Spinner, fmtDate, fmtDuration } from '../ui.js';
import { ProjectNav } from '../components/ProjectNav.js';

const CATEGORY_META: { key: ChangeCategory; label: string; tone: string }[] = [
  { key: 'newlyFailing', label: 'Newly failing', tone: 'text-fail' },
  { key: 'newlyFixed', label: 'Newly fixed', tone: 'text-pass' },
  { key: 'stillFailing', label: 'Still failing', tone: 'text-error' },
  { key: 'newTests', label: 'New tests', tone: 'text-fg' },
  { key: 'removedTests', label: 'Removed tests', tone: 'text-muted' },
];

/** A chip that also renders the `absent` pseudo-status (StatusChip only knows the 4 real ones). */
function CompareChip({ status }: { status: ComparedStatus }) {
  const style: Record<ComparedStatus, string> = {
    passed: 'bg-pass/15 text-pass',
    failed: 'bg-fail/15 text-fail',
    error: 'bg-error/15 text-error',
    skipped: 'bg-skip/15 text-skip',
    absent: 'bg-surface-2 text-muted',
  };
  const label = status === 'absent' ? '—' : status;
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold capitalize ${style[status]}`}>{label}</span>
  );
}

function sign(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

export function ComparePage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const project = useAsync(() => api.getProject(id), [id]);

  // Draft picker state, seeded from the URL so a comparison is deep-linkable.
  const [base, setBase] = useState(params.get('base') ?? '');
  const [baseBranch, setBaseBranch] = useState(params.get('baseBranch') ?? '');
  const [head, setHead] = useState(params.get('head') ?? '');
  const [headBranch, setHeadBranch] = useState(params.get('headBranch') ?? '');

  const q = {
    base: params.get('base') ? Number(params.get('base')) : undefined,
    head: params.get('head') ? Number(params.get('head')) : undefined,
    baseBranch: params.get('baseBranch') || undefined,
    headBranch: params.get('headBranch') || undefined,
  };
  const hasBase = q.base !== undefined || !!q.baseBranch;
  const hasHead = q.head !== undefined || !!q.headBranch;
  const ready = hasBase && hasHead;

  const cmp = useAsync(
    () => (ready ? api.compare(id, q) : Promise.resolve(null)),
    [id, q.base, q.head, q.baseBranch, q.headBranch],
  );

  function run() {
    const next: Record<string, string> = {};
    if (base) next.base = base;
    else if (baseBranch) next.baseBranch = baseBranch;
    if (head) next.head = head;
    else if (headBranch) next.headBranch = headBranch;
    setParams(next);
  }

  if (project.loading) return <Spinner />;
  if (project.error) return <ErrorBox message={project.error} />;
  if (!project.data) return null;

  return (
    <div className="space-y-6">
      <ProjectNav project={project.data.project} />

      <Card className="grid gap-4 p-4 sm:grid-cols-2">
        <Picker title="Base" idValue={base} onId={setBase} branchValue={baseBranch} onBranch={setBaseBranch} />
        <Picker title="Head" idValue={head} onId={setHead} branchValue={headBranch} onBranch={setHeadBranch} />
        <div className="sm:col-span-2">
          <Button onClick={run} disabled={!(base || baseBranch) || !(head || headBranch)}>
            Compare
          </Button>
        </div>
      </Card>

      {!ready && <EmptyState title="Pick two runs" hint="Choose a base and head run — by run id, or the latest run on a branch." />}
      {ready && cmp.loading && <Spinner />}
      {ready && cmp.error && <ErrorBox message={cmp.error} />}
      {ready && cmp.data && <Comparison projectId={id} data={cmp.data.comparison} />}
    </div>
  );
}

function Picker({
  title,
  idValue,
  onId,
  branchValue,
  onBranch,
}: {
  title: string;
  idValue: string;
  onId: (v: string) => void;
  branchValue: string;
  onBranch: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-fg">{title}</p>
      <Field label="Run id">
        <Input inputMode="numeric" placeholder="e.g. 42" value={idValue} onChange={(e) => onId(e.target.value)} />
      </Field>
      <Field label="…or latest on branch">
        <Input placeholder="e.g. main" value={branchValue} onChange={(e) => onBranch(e.target.value)} disabled={!!idValue} />
      </Field>
    </div>
  );
}

function Comparison({ projectId, data }: { projectId: string; data: RunComparison }) {
  const { base, head, summary, categories } = data;
  const [copied, setCopied] = useState(false);

  async function copyMarkdown() {
    const md = await api.compareMarkdown(projectId, {
      base: base.id,
      head: head.id,
    });
    await navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-5">
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-fg">
            <RunRef label="Base" projectId={projectId} run={base} /> <span className="text-muted">→</span>{' '}
            <RunRef label="Head" projectId={projectId} run={head} />
          </div>
          <Button variant="ghost" onClick={copyMarkdown}>
            {copied ? 'Copied!' : 'Copy markdown'}
          </Button>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <Stat label="Newly failing" value={summary.regressions} tone="text-fail" />
          <Stat label="Fixed" value={summary.fixed} tone="text-pass" />
          <Stat label="Still failing" value={summary.stillFailing} tone="text-error" />
          <Stat label="New" value={summary.newTests} tone="text-fg" />
          <Stat label="Removed" value={summary.removedTests} tone="text-muted" />
        </div>
        <div className="text-xs text-muted">
          Passed {sign(summary.passedDelta)} · Failed {sign(summary.failedDelta)} · Error {sign(summary.erroredDelta)} ·
          Skipped {sign(summary.skippedDelta)} · Duration{' '}
          {summary.durationDeltaMs == null ? '—' : `${summary.durationDeltaMs >= 0 ? '+' : '-'}${fmtDuration(Math.abs(summary.durationDeltaMs))}`}
        </div>
      </Card>

      {CATEGORY_META.map(({ key, label, tone }) => {
        const bucket = categories[key];
        if (bucket.total === 0) return null;
        return (
          <section key={key} className="space-y-2">
            <h2 className={`text-lg font-medium ${tone}`}>
              {label} <span className="text-sm text-muted">({bucket.total})</span>
            </h2>
            <CategoryTable projectId={projectId} tests={bucket.tests} />
            {bucket.truncated && <p className="text-xs text-muted">Showing first {bucket.tests.length} of {bucket.total}.</p>}
          </section>
        );
      })}

      {summary.regressions + summary.fixed + summary.stillFailing + summary.newTests + summary.removedTests === 0 && (
        <EmptyState title="No changes" hint="Every test kept the same outcome across these two runs." />
      )}
    </div>
  );
}

function CategoryTable({ projectId, tests }: { projectId: string; tests: ComparedTest[] }) {
  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-left text-muted">
          <tr>
            <th className="px-4 py-2">Base</th>
            <th className="px-4 py-2">Head</th>
            <th className="px-4 py-2">Suite</th>
            <th className="px-4 py-2">Test</th>
          </tr>
        </thead>
        <tbody>
          {tests.map((row) => (
            <tr key={row.testId} className="border-t border-border hover:bg-surface-2">
              <td className="px-4 py-2">
                <CompareChip status={row.baseStatus} />
              </td>
              <td className="px-4 py-2">
                <CompareChip status={row.headStatus} />
              </td>
              <td className="px-4 py-2 text-muted">{row.suite}</td>
              <td className="px-4 py-2">
                <Link to={`/projects/${projectId}/tests/${row.testId}`} className="text-primary hover:underline">
                  {row.name}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function RunRef({ label, projectId, run }: { label: string; projectId: string; run: RunComparison['base'] }) {
  return (
    <Link to={`/projects/${projectId}/runs/${run.id}`} className="text-primary hover:underline" title={fmtDate(run.createdAt)}>
      {label} #{run.id}
      {run.branch ? ` (${run.branch})` : ''}
    </Link>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className={`text-xl font-semibold ${tone}`}>{value}</div>
    </div>
  );
}
