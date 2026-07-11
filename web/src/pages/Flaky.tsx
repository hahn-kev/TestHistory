import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAsync } from '../hooks.js';
import { Card, EmptyState, ErrorBox, Spinner, StatusChip } from '../ui.js';
import { ProjectNav } from '../components/ProjectNav.js';
import { BranchFilter } from '../components/BranchFilter.js';

export function FlakyPage() {
  const { id = '' } = useParams();
  const [branch, setBranch] = useState('');
  const project = useAsync(() => api.getProject(id), [id]);
  const flaky = useAsync(() => api.flaky(id, { branch: branch || undefined, window: 50 }), [id, branch]);

  if (project.loading) return <Spinner />;
  if (project.error) return <ErrorBox message={project.error} />;
  if (!project.data) return null;

  return (
    <div className="space-y-6">
      <ProjectNav project={project.data.project} />
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium text-fg">Flaky tests</h2>
        <BranchFilter value={branch} onChange={setBranch} />
      </div>
      <p className="text-sm text-muted">
        Tests whose status flipped between passing and failing at least twice within the last 50 runs.
      </p>

      {flaky.loading && <Spinner />}
      {flaky.error && <ErrorBox message={flaky.error} />}
      {flaky.data && flaky.data.flaky.length === 0 && <EmptyState title="No flaky tests" hint="Nothing is flipping in this window." />}
      {flaky.data && flaky.data.flaky.length > 0 && (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-muted">
              <tr>
                <th className="px-4 py-2">Test</th>
                <th className="px-4 py-2">Suite</th>
                <th className="px-4 py-2">Flips</th>
                <th className="px-4 py-2">Fails</th>
                <th className="px-4 py-2">Runs seen</th>
                <th className="px-4 py-2">Last</th>
              </tr>
            </thead>
            <tbody>
              {flaky.data.flaky.map((f) => (
                <tr key={f.testId} className="border-t border-border hover:bg-surface-2">
                  <td className="px-4 py-2">
                    <Link to={`/projects/${id}/tests/${f.testId}`} className="text-primary hover:underline">
                      {f.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-muted">{f.suite}</td>
                  <td className="px-4 py-2 font-medium text-fg">{f.flips}</td>
                  <td className="px-4 py-2 text-muted">{f.fails}</td>
                  <td className="px-4 py-2 text-muted">{f.runsSeen}</td>
                  <td className="px-4 py-2">
                    <StatusChip status={f.lastStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
