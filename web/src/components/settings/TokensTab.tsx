import { useState } from 'react';
import { api, ApiError } from '../../api/client.js';
import { useAsync } from '../../hooks.js';
import { Button, Card, EmptyState, ErrorBox, Input, Spinner, fmtDate } from '../../ui.js';

export function TokensTab({ projectId }: { projectId: string }) {
  const tokens = useAsync(() => api.listTokens(projectId), [projectId]);
  const [name, setName] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.createToken(projectId, { name });
      setSecret(res.token);
      setName('');
      tokens.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create token.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={create} className="flex items-end gap-2">
        <div className="flex-1">
          <label className="mb-1 block text-sm text-muted">New token name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ci-pipeline" required />
        </div>
        <Button type="submit" disabled={busy}>
          Create token
        </Button>
      </form>
      {error && <ErrorBox message={error} />}

      {secret && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4" role="dialog">
          <Card className="w-full max-w-lg p-5">
            <h3 className="text-lg font-semibold text-fg">Copy your token now</h3>
            <p className="mt-1 text-sm text-muted">This is the only time it will be shown.</p>
            <code className="mt-3 block break-all rounded-md border border-border bg-surface-2 p-3 text-sm text-fg">{secret}</code>
            <div className="mt-4 flex gap-2">
              <Button onClick={() => navigator.clipboard?.writeText(secret)}>Copy</Button>
              <Button variant="ghost" onClick={() => setSecret(null)}>
                Done
              </Button>
            </div>
          </Card>
        </div>
      )}

      {tokens.loading && <Spinner />}
      {tokens.error && <ErrorBox message={tokens.error} />}
      {tokens.data && tokens.data.tokens.length === 0 && <EmptyState title="No tokens yet" />}
      {tokens.data && tokens.data.tokens.length > 0 && (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-muted">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Prefix</th>
                <th className="px-4 py-2">Created</th>
                <th className="px-4 py-2">Last used</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {tokens.data.tokens.map((t) => (
                <tr key={t.id} className="border-t border-border">
                  <td className="px-4 py-2 text-fg">{t.name}</td>
                  <td className="px-4 py-2 font-mono text-muted">{t.tokenPrefix}…</td>
                  <td className="px-4 py-2 text-muted">{fmtDate(t.createdAt)}</td>
                  <td className="px-4 py-2 text-muted">{t.lastUsedAt ? fmtDate(t.lastUsedAt) : '—'}</td>
                  <td className="px-4 py-2 text-right">
                    {t.revokedAt ? (
                      <span className="text-xs text-muted">revoked</span>
                    ) : (
                      <button
                        className="text-sm text-fail hover:underline"
                        onClick={async () => {
                          if (confirm(`Revoke token "${t.name}"?`)) {
                            await api.revokeToken(projectId, t.id);
                            tokens.reload();
                          }
                        }}
                      >
                        Revoke
                      </button>
                    )}
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
