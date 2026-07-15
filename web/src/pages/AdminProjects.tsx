import { Link } from 'react-router-dom';
import type { ProjectSizeInfo } from '@testhistory/shared';
import { api } from '../api/client.js';
import { useAsync } from '../hooks.js';
import { AppIcon, Card, ErrorBox, Spinner, fmtBytes, fmtDate } from '../ui.js';

export function AdminProjectsPage() {
  const projects = useAsync(() => api.listProjectSizes(), []);

  return (
    <div className="space-y-6">
      <div>
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
          <AppIcon name="arrow-left" className="h-4 w-4" />
          Dashboard
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-fg">Project sizes</h1>
        <p className="mt-1 text-sm text-muted">Ordered by total on-disk size — largest first.</p>
      </div>

      {projects.loading && <Spinner />}
      {projects.error && <ErrorBox message={projects.error} />}
      {projects.data && (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-muted">
              <tr>
                <th className="px-4 py-2">Project</th>
                <th className="px-4 py-2 text-right">Runs</th>
                <th className="px-4 py-2 text-right">Tests</th>
                <th className="px-4 py-2 text-right">Results</th>
                <th className="px-4 py-2 text-right">DB size</th>
                <th className="px-4 py-2 text-right">Plugins</th>
                <th className="px-4 py-2 text-right">Total</th>
                <th className="px-4 py-2">Last run</th>
              </tr>
            </thead>
            <tbody>
              {projects.data.projects.map((p) => (
                <ProjectSizeRow key={p.id} project={p} />
              ))}
              {projects.data.projects.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-muted" colSpan={8}>
                    No projects yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function ProjectSizeRow({ project: p }: { project: ProjectSizeInfo }) {
  const n = (v: number) => v.toLocaleString();
  return (
    <tr className="border-t border-border">
      <td className="px-4 py-2">
        <Link to={`/projects/${p.id}`} className="text-primary hover:underline">
          {p.name}
        </Link>
        {p.private && <span className="ml-2 text-xs text-muted">private</span>}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-muted">{n(p.runCount)}</td>
      <td className="px-4 py-2 text-right tabular-nums text-muted">{n(p.testCount)}</td>
      <td className="px-4 py-2 text-right tabular-nums text-muted">{n(p.resultCount)}</td>
      <td className="px-4 py-2 text-right tabular-nums text-muted">{fmtBytes(p.dbBytes)}</td>
      <td className="px-4 py-2 text-right tabular-nums text-muted">
        {p.pluginCount > 0 ? `${fmtBytes(p.pluginBytes)} (${n(p.pluginCount)})` : '—'}
      </td>
      <td className="px-4 py-2 text-right font-medium tabular-nums text-fg">{fmtBytes(p.totalBytes)}</td>
      <td className="px-4 py-2 text-muted">{fmtDate(p.lastRunAt)}</td>
    </tr>
  );
}
