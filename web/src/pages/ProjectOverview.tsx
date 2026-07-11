import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAsync } from '../hooks.js';
import { Card, EmptyState, ErrorBox, Spinner, StatusChip, fmtDate, fmtDuration } from '../ui.js';
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
              {runs.data.runs.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-surface-2">
                  <td className="px-4 py-2">
                    <Link className="text-primary hover:underline" to={`/projects/${id}/runs/${r.id}`}>
                      #{r.id}
                    </Link>
                    {r.label && <span className="ml-2 text-muted">{r.label}</span>}
                  </td>
                  <td className="px-4 py-2 text-muted">{r.branch ?? '—'}</td>
                  <td className="px-4 py-2">
                    <span className="text-pass">{r.passed}✓</span>{' '}
                    <span className="text-fail">{r.failed}✗</span>{' '}
                    <span className="text-error">{r.errored}!</span>{' '}
                    <span className="text-skip">{r.skipped}⊘</span>
                    <span className="ml-2 text-muted">/ {r.total}</span>
                  </td>
                  <td className="px-4 py-2 text-muted">{fmtDuration(r.durationMs)}</td>
                  <td className="px-4 py-2 text-muted">{fmtDate(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <div>
        <Link to={`/projects/${id}/settings`} className="text-sm text-muted hover:text-fg">
          Search tests & manage project →
        </Link>
      </div>
    </div>
  );
}
