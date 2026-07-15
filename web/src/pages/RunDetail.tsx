import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { TestResultRow, TestStatus } from '@testhistory/shared';
import { ApiError, api } from '../api/client.js';
import { useAsync } from '../hooks.js';
import { AppIcon, Button, Card, EmptyState, ErrorBox, GitHubLink, Input, Spinner, StatusChip, fmtDate, fmtDuration, githubRunLinks } from '../ui.js';

const STATUSES: (TestStatus | '')[] = ['', 'passed', 'failed', 'error', 'skipped'];
const PAGE_SIZE = 50;
/** Select sentinel for the empty-suite option (HTML cannot distinguish "" from "All suites"). */
const EMPTY_SUITE = '__empty__';

type SortKey = 'status' | 'name' | 'duration';
type SortDir = 'asc' | 'desc';
/** Direction applied when a column is first selected (before toggling). */
const DEFAULT_DIR: Record<SortKey, SortDir> = { status: 'asc', name: 'asc', duration: 'desc' };

export function RunDetailPage() {
  const { id = '', runId = '' } = useParams();
  const rid = Number(runId);
  const run = useAsync(() => api.getRun(id, rid), [id, rid]);
  const [status, setStatus] = useState<TestStatus | ''>('');
  const [search, setSearch] = useState('');
  /** `undefined` = all suites; `''` = exact empty suite. */
  const [suite, setSuite] = useState<string | undefined>(undefined);
  const [sort, setSort] = useState<SortKey>('status');
  const [dir, setDir] = useState<SortDir>('asc');

  /** Clicking the active column flips direction; a new column resets to its default direction. */
  const toggleSort = (key: SortKey) => {
    if (key === sort) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(key);
      setDir(DEFAULT_DIR[key]);
    }
  };

  const [rows, setRows] = useState<TestResultRow[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRows([]);
    setNextCursor(null);
    api
      .listResults(id, rid, {
        status: status || undefined,
        search: search || undefined,
        suite,
        sort,
        dir,
        limit: PAGE_SIZE,
      })
      .then((data) => {
        if (!cancelled) {
          setRows(data.results);
          setNextCursor(data.nextCursor);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : 'Something went wrong.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, rid, status, search, suite, sort, dir]);

  const loadMore = useCallback(async () => {
    if (nextCursor == null || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const data = await api.listResults(id, rid, {
        status: status || undefined,
        search: search || undefined,
        suite,
        sort,
        dir,
        cursor: nextCursor,
        limit: PAGE_SIZE,
      });
      setRows((prev) => [...prev, ...data.results]);
      setNextCursor(data.nextCursor);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setLoadingMore(false);
    }
  }, [id, rid, status, search, suite, sort, dir, nextCursor, loadingMore]);

  if (run.loading) return <Spinner />;
  if (run.error) return <ErrorBox message={run.error} />;
  if (!run.data) return null;
  const r = run.data.run;
  const suites = run.data.suites;
  const gh = githubRunLinks(r);

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <Link to={`/projects/${id}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
            <AppIcon name="arrow-left" className="h-4 w-4" />
            Back to project
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-fg">Run #{r.id}</h1>
        </div>
        <div className="flex items-center gap-3">
          {gh.ci && (
            <GitHubLink href={gh.ci} className="text-sm font-medium">
              Actions run
            </GitHubLink>
          )}
          <Link
            to={`/projects/${id}/compare?head=${r.id}`}
            className="rounded-md border border-border px-3 py-2 text-sm font-medium text-fg hover:bg-surface-2"
          >
            Compare…
          </Link>
        </div>
      </div>

      <Card className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        {gh.prNumber ? (
          <Meta
            label="Pull request"
            value={gh.pr ? <GitHubLink href={gh.pr}>PR #{gh.prNumber}</GitHubLink> : `PR #${gh.prNumber}`}
          />
        ) : (
          <Meta
            label="Branch"
            value={gh.branch && r.branch ? <GitHubLink href={gh.branch}>{r.branch}</GitHubLink> : r.branch ?? '—'}
          />
        )}
        <Meta
          label="Commit"
          value={
            gh.commit && r.commitSha ? (
              <GitHubLink href={gh.commit}>{r.commitSha.slice(0, 7)}</GitHubLink>
            ) : (
              r.commitSha ?? '—'
            )
          }
        />
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
        <select
          value={suite === undefined ? '' : suite === '' ? EMPTY_SUITE : suite}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '') setSuite(undefined);
            else if (v === EMPTY_SUITE) setSuite('');
            else setSuite(v);
          }}
          className="rounded-md border border-border bg-surface px-2 py-2 text-sm text-fg"
        >
          <option value="">All suites</option>
          {suites.map((s) => (
            <option key={s === '' ? EMPTY_SUITE : s} value={s === '' ? EMPTY_SUITE : s}>
              {s === '' ? '(no suite)' : s}
            </option>
          ))}
        </select>
        <Input placeholder="Search test name…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
      </div>

      {loading && <Spinner />}
      {error && <ErrorBox message={error} />}
      {!loading && !error && rows.length === 0 && <EmptyState title="No matching results" />}
      {!loading && rows.length > 0 && (
        <>
          <Card className="overflow-hidden">
            <table className="w-full table-fixed text-sm">
              <thead className="bg-surface-2 text-left text-muted">
                <tr>
                  <th className="w-8 px-2 py-2" aria-label="Expand" />
                  <SortHeader label="Status" col="status" sort={sort} dir={dir} onSort={toggleSort} thClassName="w-24" />
                  <th className="w-[28%] px-4 py-2">Suite</th>
                  <SortHeader label="Test" col="name" sort={sort} dir={dir} onSort={toggleSort} />
                  <SortHeader label="Duration" col="duration" sort={sort} dir={dir} onSort={toggleSort} thClassName="w-28" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <ResultRow key={row.testId} projectId={id} row={row} />
                ))}
              </tbody>
            </table>
          </Card>
          {nextCursor != null && (
            <div className="flex justify-center">
              <Button variant="ghost" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SortHeader({
  label,
  col,
  sort,
  dir,
  onSort,
  thClassName = '',
}: {
  label: string;
  col: SortKey;
  sort: SortKey;
  dir: SortDir;
  onSort: (col: SortKey) => void;
  thClassName?: string;
}) {
  const active = sort === col;
  return (
    <th className={`px-4 py-2 ${thClassName}`}>
      <button
        type="button"
        onClick={() => onSort(col)}
        className={`inline-flex items-center gap-1 hover:text-fg ${active ? 'text-fg' : ''}`}
        aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        {label}
        <AppIcon
          name={active ? (dir === 'asc' ? 'arrow-up' : 'arrow-down') : 'sort'}
          className={`h-3.5 w-3.5 ${active ? '' : 'text-muted'}`}
        />
      </button>
    </th>
  );
}

function Meta({ label, value, className = '' }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className={`truncate font-medium text-fg ${className}`}>{value}</div>
    </div>
  );
}

function ResultRow({ projectId, row }: { projectId: string; row: TestResultRow }) {
  const [open, setOpen] = useState(false);
  const expandable = !!(row.message || row.stack);
  return (
    <>
      <tr
        className={`border-t border-border ${expandable ? 'cursor-pointer hover:bg-surface-2' : ''}`}
        onClick={() => expandable && setOpen((v) => !v)}
      >
        <td className="w-8 px-2 py-2 text-center text-muted">
          {expandable && <AppIcon name={open ? 'chevron-down' : 'chevron-right'} className="h-4 w-4 align-middle" />}
        </td>
        <td className="px-4 py-2 whitespace-nowrap">
          <StatusChip status={row.status} />
        </td>
        <td className="max-w-0 truncate px-4 py-2 text-muted" title={row.suite || undefined}>
          {row.suite}
        </td>
        <td className="max-w-0 px-4 py-2">
          <Link
            to={`/projects/${projectId}/tests/${row.testId}`}
            className="block truncate text-primary hover:underline"
            title={row.name}
            onClick={(e) => e.stopPropagation()}
          >
            {row.name}
          </Link>
        </td>
        <td className="px-4 py-2 whitespace-nowrap text-muted">{fmtDuration(row.durationMs)}</td>
      </tr>
      {open && expandable && (
        <tr className="border-t border-border bg-surface-2">
          <td colSpan={5} className="px-4 py-3">
            {row.message && <pre className="whitespace-pre-wrap text-xs text-fail">{row.message}</pre>}
            {row.stack && <pre className="mt-2 whitespace-pre-wrap text-xs text-muted">{row.stack}</pre>}
          </td>
        </tr>
      )}
    </>
  );
}
