import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { TestStatus } from '@testhistory/shared';
import { api } from '../api/client.js';
import { useAsync } from '../hooks.js';
import { Card, EmptyState, ErrorBox, Input, Spinner, StatusChip, fmtDate, fmtDuration } from '../ui.js';

const STATUSES: (TestStatus | '')[] = ['', 'passed', 'failed', 'error', 'skipped'];

export function RunDetailPage() {
  const { id = '', runId = '' } = useParams();
  const rid = Number(runId);
  const run = useAsync(() => api.getRun(id, rid), [id, rid]);
  const [status, setStatus] = useState<TestStatus | ''>('');
  const [search, setSearch] = useState('');
  const results = useAsync(
    () => api.listResults(id, rid, { status: status || undefined, search: search || undefined, limit: 200 }),
    [id, rid, status, search],
  );

  if (run.loading) return <Spinner />;
  if (run.error) return <ErrorBox message={run.error} />;
  if (!run.data) return null;
  const r = run.data.run;

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <Link to={`/projects/${id}`} className="text-sm text-muted hover:text-fg">
            ← Back to project
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-fg">Run #{r.id}</h1>
        </div>
        <Link
          to={`/projects/${id}/compare?head=${r.id}`}
          className="rounded-md border border-border px-3 py-2 text-sm font-medium text-fg hover:bg-surface-2"
        >
          Compare…
        </Link>
      </div>

      <Card className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Meta label="Branch" value={r.branch ?? '—'} />
        <Meta label="Commit" value={r.commitSha ?? '—'} />
        <Meta label="Started" value={fmtDate(r.startedAt)} />
        <Meta label="Duration" value={fmtDuration(r.durationMs)} />
        <Meta label="Total" value={String(r.total)} />
        <Meta label="Passed" value={String(r.passed)} className="text-pass" />
        <Meta label="Failed / Error" value={`${r.failed} / ${r.errored}`} className="text-fail" />
        <Meta label="Skipped" value={String(r.skipped)} className="text-skip" />
      </Card>

      <Card className="p-4">
        <p className="text-sm font-medium text-fg">
          {r.uploads.length} upload{r.uploads.length === 1 ? '' : 's'}
        </p>
        <ul className="mt-2 space-y-1 text-sm text-muted">
          {r.uploads.map((u, i) => (
            <li key={i}>
              {u.fileName ?? '(raw body)'} · {u.format} · {u.fileSize != null ? `${(u.fileSize / 1024).toFixed(1)} KB` : '—'} ·{' '}
              {fmtDuration(u.durationMs)}
            </li>
          ))}
        </ul>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as TestStatus | '')}
          className="rounded-md border border-border bg-surface px-2 py-2 text-sm text-fg"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === '' ? 'All statuses' : s}
            </option>
          ))}
        </select>
        <Input placeholder="Search test name…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
      </div>

      {results.loading && <Spinner />}
      {results.error && <ErrorBox message={results.error} />}
      {results.data && results.data.results.length === 0 && <EmptyState title="No matching results" />}
      {results.data && results.data.results.length > 0 && (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-muted">
              <tr>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Suite</th>
                <th className="px-4 py-2">Test</th>
                <th className="px-4 py-2">Duration</th>
              </tr>
            </thead>
            <tbody>
              {results.data.results.map((row) => (
                <ResultRow key={row.testId} projectId={id} row={row} />
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function Meta({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className={`truncate font-medium text-fg ${className}`}>{value}</div>
    </div>
  );
}

function ResultRow({ projectId, row }: { projectId: string; row: import('@testhistory/shared').TestResultRow }) {
  const [open, setOpen] = useState(false);
  const expandable = !!(row.message || row.stack);
  return (
    <>
      <tr
        className={`border-t border-border ${expandable ? 'cursor-pointer hover:bg-surface-2' : ''}`}
        onClick={() => expandable && setOpen((v) => !v)}
      >
        <td className="px-4 py-2">
          <StatusChip status={row.status} />
        </td>
        <td className="px-4 py-2 text-muted">{row.suite}</td>
        <td className="px-4 py-2">
          <Link
            to={`/projects/${projectId}/tests/${row.testId}`}
            className="text-primary hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {row.name}
          </Link>
          {expandable && <span className="ml-2 text-xs text-muted">{open ? '▾' : '▸'}</span>}
        </td>
        <td className="px-4 py-2 text-muted">{fmtDuration(row.durationMs)}</td>
      </tr>
      {open && expandable && (
        <tr className="border-t border-border bg-surface-2">
          <td colSpan={4} className="px-4 py-3">
            {row.message && <pre className="whitespace-pre-wrap text-xs text-fail">{row.message}</pre>}
            {row.stack && <pre className="mt-2 whitespace-pre-wrap text-xs text-muted">{row.stack}</pre>}
          </td>
        </tr>
      )}
    </>
  );
}
