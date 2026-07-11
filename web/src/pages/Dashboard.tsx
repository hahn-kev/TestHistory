import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import { useAsync } from '../hooks.js';
import { Button, Card, EmptyState, ErrorBox, Field, Input, Spinner } from '../ui.js';

export function DashboardPage() {
  const projects = useAsync(() => api.listProjects(), []);
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-fg">Projects</h1>
        <Button onClick={() => setCreating(true)}>New project</Button>
      </div>

      {creating && (
        <CreateProject
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            projects.reload();
          }}
        />
      )}

      {projects.loading && <Spinner />}
      {projects.error && <ErrorBox message={projects.error} />}
      {projects.data && projects.data.projects.length === 0 && (
        <EmptyState title="No projects yet" hint="Create a project to start tracking test runs." />
      )}
      {projects.data && projects.data.projects.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.data.projects.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`}>
              <Card className="h-full p-4 transition hover:border-primary">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-medium text-fg">{p.name}</h2>
                  {p.private && (
                    <span className="rounded bg-surface-2 px-2 py-0.5 text-xs text-muted">Private</span>
                  )}
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-muted">{p.description || 'No description'}</p>
                {p.myRole && <p className="mt-3 text-xs text-primary capitalize">{p.myRole}</p>}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateProject({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createProject({ name, description: description || undefined, private: isPrivate });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create project.');
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </Field>
        <Field label="Description (optional)">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-fg">
          <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
          Private (visible to members only)
        </label>
        {error && <ErrorBox message={error} />}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            Create
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
