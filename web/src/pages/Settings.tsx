import { useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAsync } from '../hooks.js';
import { ErrorBox, Spinner } from '../ui.js';
import { ProjectNav } from '../components/ProjectNav.js';

// Full tabbed settings UI is built in Ticket 14.
export function SettingsPage() {
  const { id = '' } = useParams();
  const project = useAsync(() => api.getProject(id), [id]);
  if (project.loading) return <Spinner />;
  if (project.error) return <ErrorBox message={project.error} />;
  if (!project.data) return null;
  return (
    <div className="space-y-6">
      <ProjectNav project={project.data.project} />
      <p className="text-sm text-muted">Settings coming soon.</p>
    </div>
  );
}
