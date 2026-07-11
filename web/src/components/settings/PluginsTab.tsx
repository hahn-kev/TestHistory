import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../api/client.js';
import { useAsync } from '../../hooks.js';
import { Button, Card, EmptyState, ErrorBox, Input, Spinner, fmtDate } from '../../ui.js';

/** Multipart plugin upload/replace via raw fetch (the JSON client doesn't cover files). */
async function uploadPlugin(projectId: string, pluginId: string | null, file: File, name?: string, description?: string) {
  const fd = new FormData();
  fd.append('file', file);
  if (name !== undefined) fd.append('name', name);
  if (description !== undefined) fd.append('description', description);
  const url = pluginId ? `/api/projects/${projectId}/plugins/${pluginId}` : `/api/projects/${projectId}/plugins`;
  const res = await fetch(url, { method: pluginId ? 'PUT' : 'POST', body: fd, credentials: 'same-origin' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data?.error?.code ?? 'ERROR', data?.error?.message ?? 'Upload failed.');
  }
}

export function PluginsTab({ projectId }: { projectId: string }) {
  const plugins = useAsync(() => api.listPlugins(projectId), [projectId]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return setError('Choose an HTML file.');
    setBusy(true);
    setError(null);
    try {
      await uploadPlugin(projectId, null, file, name, description || undefined);
      setName('');
      setDescription('');
      if (fileRef.current) fileRef.current.value = '';
      plugins.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <form onSubmit={create} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm text-muted">Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <label className="mb-1 block text-sm text-muted">Description</label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
          <input ref={fileRef} type="file" accept=".html,text/html" className="block text-sm text-fg" />
          {error && <ErrorBox message={error} />}
          <Button type="submit" disabled={busy}>
            Upload plugin
          </Button>
        </form>
      </Card>

      {plugins.loading && <Spinner />}
      {plugins.error && <ErrorBox message={plugins.error} />}
      {plugins.data && plugins.data.plugins.length === 0 && <EmptyState title="No plugins yet" />}
      {plugins.data && plugins.data.plugins.length > 0 && (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-muted">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Size</th>
                <th className="px-4 py-2">Updated</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {plugins.data.plugins.map((pl) => (
                <tr key={pl.id} className="border-t border-border">
                  <td className="px-4 py-2 text-fg">
                    <Link to={`/projects/${projectId}/plugins/${pl.id}`} className="text-primary hover:underline">
                      {pl.name}
                    </Link>
                    {pl.description && <div className="text-xs text-muted">{pl.description}</div>}
                  </td>
                  <td className="px-4 py-2 text-muted">{(pl.sizeBytes / 1024).toFixed(1)} KB</td>
                  <td className="px-4 py-2 text-muted">{fmtDate(pl.updatedAt)}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      className="text-sm text-fail hover:underline"
                      onClick={async () => {
                        if (confirm(`Delete plugin "${pl.name}"?`)) {
                          await api.deletePlugin(projectId, pl.id);
                          plugins.reload();
                        }
                      }}
                    >
                      Delete
                    </button>
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
