import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAsync } from '../hooks.js';
import { AppIcon, Card, CiJobOutcomeBadge, EmptyState, ErrorBox, GitHubIcon, GitHubLink, Spinner, fmtDate, fmtDuration, githubRunLinks } from '../ui.js';
import { ProjectNav } from '../components/ProjectNav.js';
import { BranchFilter } from '../components/BranchFilter.js';
import { TrendChart } from '../components/TrendChart.js';
import { useAuth } from '../auth/AuthContext.js';

export function ProjectOverviewPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const [branch, setBranch] = useState('');
  const project = useAsync(() => api.getProject(id), [id]);
  // Health = Primary Branch only; recent chart = unfiltered ledger. Branch filter scopes the run list only.
  const health = useAsync(() => api.trend(id, { mode: 'health', limit: 50 }), [id]);
  const recent = useAsync(() => api.trend(id, { mode: 'recent', limit: 50 }), [id]);
  const runs = useAsync(() => api.listRuns(id, { branch: branch || undefined, limit: 20 }), [id, branch]);

  if (project.loading) return <Spinner />;
  if (project.error) return <ErrorBox message={project.error} />;
  if (!project.data) return null;

  const p = project.data.project;
  const isOwner = p.myRole === 'owner' || user?.role === 'admin';
  const healthResolved = health.data?.resolvedPrimaryBranch ?? null;
  const healthOverride = health.data?.primaryBranch ?? null;

  return (
    <div className="space-y-6">
      <ProjectNav project={p} />

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-medium text-fg">Health</h2>
          {health.data && (
            <p className="text-sm text-muted">
              {healthResolved
                ? healthOverride
                  ? `Primary Branch: ${healthResolved} (override)`
                  : `Primary Branch: ${healthResolved} (auto-detected)`
                : 'Primary Branch unresolved'}
            </p>
          )}
        </div>
        <Card className="p-4">
          {health.loading && <Spinner />}
          {health.error && <ErrorBox message={health.error} />}
          {health.data && !healthResolved && (
            <EmptyState
              title="No health trend yet"
              hint={
                isOwner
                  ? 'Set a Primary Branch in project settings, or upload a run on main, master, or develop.'
                  : 'Ask a project owner to set a Primary Branch, or upload a run on main, master, or develop.'
              }
            />
          )}
          {health.data && !healthResolved && isOwner && (
            <p className="mt-3 text-center text-sm">
              <Link className="text-primary hover:underline" to={`/projects/${id}/settings`}>
                Open project settings
              </Link>
            </p>
          )}
          {health.data && healthResolved && health.data.trend.length === 0 && (
            <EmptyState title="No runs on Primary Branch" hint={`Upload results on ${healthResolved} to see health.`} />
          )}
          {health.data && healthResolved && health.data.trend.length > 0 && (
            <TrendChart trend={health.data.trend} />
          )}
        </Card>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium text-fg">Recent</h2>
        <Card className="p-4">
          {recent.loading && <Spinner />}
          {recent.error && <ErrorBox message={recent.error} />}
          {recent.data && recent.data.trend.length === 0 && (
            <EmptyState title="No runs yet" hint="Upload results to see recent activity." />
          )}
          {recent.data && recent.data.trend.length > 0 && <TrendChart trend={recent.data.trend} />}
        </Card>
      </section>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium text-fg">Recent runs</h2>
        <BranchFilter value={branch} onChange={setBranch} />
      </div>
      {runs.loading && <Spinner />}
      {runs.error && <ErrorBox message={runs.error} />}
      {runs.data && runs.data.runs.length === 0 && <EmptyState title="No runs" />}
      {runs.data && runs.data.runs.length > 0 && (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-muted">
              <tr>
                <th className="px-4 py-2">Run</th>
                <th className="px-4 py-2">Branch</th>
                <th className="px-4 py-2">Results</th>
                <th className="px-4 py-2">Duration</th>
                <th className="px-4 py-2">When</th>
              </tr>
            </thead>
            <tbody>
              {runs.data.runs.map((r) => {
                const gh = githubRunLinks(r);
                const ciUrl = gh.ci;
                return (
                <tr key={r.id} className="border-t border-border hover:bg-surface-2">
                  <td className="px-4 py-2">
                    <Link className="text-primary hover:underline" to={`/projects/${id}/runs/${r.id}`}>
                      #{r.id}
                    </Link>
                    {r.label && <span className="ml-2 text-muted">{r.label}</span>}
                    {r.ciJobOutcome && (
                      <span className="ml-2 inline-flex align-middle">
                        <CiJobOutcomeBadge outcome={r.ciJobOutcome} />
                      </span>
                    )}
                    {ciUrl && (
                      <a
                        href={ciUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="View GitHub Actions run"
                        className="ml-2 inline-flex align-middle text-muted hover:text-fg"
                      >
                        <GitHubIcon />
                      </a>
                    )}
                  </td>
                  <td className="px-4 py-2 text-muted">
                    {gh.prNumber ? (
                      gh.pr ? (
                        <GitHubLink href={gh.pr}>PR #{gh.prNumber}</GitHubLink>
                      ) : (
                        `PR #${gh.prNumber}`
                      )
                    ) : (
                      r.branch ?? '—'
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <span className="inline-flex items-center gap-3">
                      <span className="inline-flex items-center gap-0.5 text-pass">
                        {r.passed}
                        <AppIcon name="check" className="h-3.5 w-3.5" />
                      </span>
                      <span className="inline-flex items-center gap-0.5 text-fail">
                        {r.failed}
                        <AppIcon name="close" className="h-3.5 w-3.5" />
                      </span>
                      <span className="inline-flex items-center gap-0.5 text-error">
                        {r.errored}
                        <AppIcon name="alert" className="h-3.5 w-3.5" />
                      </span>
                      <span className="inline-flex items-center gap-0.5 text-skip">
                        {r.skipped}
                        <AppIcon name="minus-circle" className="h-3.5 w-3.5" />
                      </span>
                      <span className="text-muted">/ {r.total}</span>
                    </span>
                  </td>
                  <td className="px-4 py-2 text-muted">{fmtDuration(r.durationMs)}</td>
                  <td className="px-4 py-2 text-muted">{fmtDate(r.createdAt)}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
