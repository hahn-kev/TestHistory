import { useState } from 'react';
import { api, ApiError } from '../../api/client.js';
import { useAsync } from '../../hooks.js';
import { Button, Card, ErrorBox, Input, Spinner } from '../../ui.js';

export function MembersTab({ projectId }: { projectId: string }) {
  const members = useAsync(() => api.listMembers(projectId), [projectId]);
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<'owner' | 'member'>('member');
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const id = Number(userId);
    if (!Number.isFinite(id) || id <= 0) return setError('Enter a numeric user id (see Admin → Users).');
    try {
      await api.addMember(projectId, { userId: id, role });
      setUserId('');
      members.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add member.');
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <form onSubmit={add} className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-sm text-muted">User id</label>
            <Input value={userId} onChange={(e) => setUserId(e.target.value)} className="w-32" placeholder="e.g. 3" />
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as 'owner' | 'member')}
              className="rounded-md border border-border bg-surface px-2 py-2 text-sm text-fg"
            >
              <option value="member">member</option>
              <option value="owner">owner</option>
            </select>
          </div>
          <Button type="submit">Add / update</Button>
        </form>
        {error && <div className="mt-2"><ErrorBox message={error} /></div>}
        <p className="mt-2 text-xs text-muted">Find user ids under Admin → Users (admins), or ask an administrator.</p>
      </Card>

      {members.loading && <Spinner />}
      {members.error && <ErrorBox message={members.error} />}
      {members.data && (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-muted">
              <tr>
                <th className="px-4 py-2">User</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Role</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {members.data.members.map((m) => (
                <tr key={m.userId} className="border-t border-border">
                  <td className="px-4 py-2 text-fg">{m.displayName}</td>
                  <td className="px-4 py-2 text-muted">{m.email}</td>
                  <td className="px-4 py-2 capitalize text-muted">{m.role}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      className="text-sm text-fail hover:underline"
                      onClick={async () => {
                        if (confirm(`Remove ${m.email}?`)) {
                          try {
                            await api.removeMember(projectId, m.userId);
                            members.reload();
                          } catch (err) {
                            alert(err instanceof ApiError ? err.message : 'Failed to remove.');
                          }
                        }
                      }}
                    >
                      Remove
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
