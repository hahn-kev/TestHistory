import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAsync } from '../hooks.js';
import { AppIcon, Card, CiJobOutcomeBadge, EmptyState, ErrorBox, GitHubIcon, GitHubLink, Spinner, StatusChip, fmtDate, fmtDuration, githubRunLinks } from '../ui.js';
import { ProjectNav } from '../components/ProjectNav.js';
import { BranchFilter } from '../components/BranchFilter.js';
import { TrendChart } from '../components/TrendChart.js';

export function ProjectOverviewPage() {
  const { id = '' } = useParams();
  const [branch, setBranch] = useState('');
  const project = useAsync(() => api.getProject(id), [id]);
  const trend = useAsync(() => api.trend(id, { branch: branch || undefined, limit: 50 }), [id, branch]);
  const runs = useAsync(() => api.listRuns(id, { branch: branch || undefined, limit: 20 }), [id, branch]);

  if (project.loading) return <Spinner />;
  if (project.error) return <ErrorBox message={project.error} />;
  if (!project.data) return null;

  return (
    <div className="space-y-6">
      <ProjectNav project={project.data.project} />
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium text-fg">Trend</h2>
        <BranchFilter value={branch} onChange={setBranch} />
      </div>

      <Card className="p-4">
        {trend.loading && <Spinner />}
        {trend.error && <ErrorBox message={trend.error} />}
        {trend.data && trend.data.trend.length === 0 && <EmptyState title="No runs yet" hint="Upload results to see the trend." />}
        {trend.data && trend.data.trend.length > 0 && <TrendChart trend={trend.data.trend} />}
      </Card>

      <h2 className="text-lg font-medium text-fg">Recent runs</h2>
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
