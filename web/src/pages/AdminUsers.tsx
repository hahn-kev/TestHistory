import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import { useAsync } from '../hooks.js';
import { Button, Card, ErrorBox, Field, Input, Spinner, fmtDate } from '../ui.js';

export function AdminUsersPage() {
  const users = useAsync(() => api.listUsers(), []);
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/" className="text-sm text-muted hover:text-fg">
            ← Dashboard
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-fg">Users</h1>
        </div>
        <Button onClick={() => setCreating(true)}>New user</Button>
      </div>

      {creating && (
        <CreateUser
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            users.reload();
          }}
        />
      )}

      {users.loading && <Spinner />}
      {users.error && <ErrorBox message={users.error} />}
      {users.data && (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-muted">
              <tr>
                <th className="px-4 py-2">ID</th>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Role</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Created</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {users.data.users.map((u) => (
                <UserRow key={u.id} user={u} onChanged={() => users.reload()} />
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function UserRow({ user, onChanged }: { user: import('@testhistory/shared').UserInfo; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  async function act(patch: Parameters<typeof api.updateUser>[1]) {
    setError(null);
    try {
      await api.updateUser(user.id, patch);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Update failed.');
    }
  }
  return (
    <tr className="border-t border-border align-top">
      <td className="px-4 py-2 text-muted">{user.id}</td>
      <td className="px-4 py-2 text-fg">{user.displayName}</td>
      <td className="px-4 py-2 text-muted">{user.email}</td>
      <td className="px-4 py-2 capitalize text-muted">{user.role}</td>
      <td className="px-4 py-2">{user.disabled ? <span className="text-fail">disabled</span> : <span className="text-pass">active</span>}</td>
      <td className="px-4 py-2 text-muted">{fmtDate(user.createdAt)}</td>
      <td className="px-4 py-2 text-right">
        <div className="flex justify-end gap-3">
          <button className="text-sm text-primary hover:underline" onClick={() => act({ role: user.role === 'admin' ? 'user' : 'admin' })}>
            {user.role === 'admin' ? 'Make user' : 'Make admin'}
          </button>
          <button className="text-sm text-muted hover:underline" onClick={() => act({ disabled: !user.disabled })}>
            {user.disabled ? 'Enable' : 'Disable'}
          </button>
          <button
            className="text-sm text-muted hover:underline"
            onClick={() => {
              const pw = prompt(`New password for ${user.email} (min 8 chars):`);
              if (pw) act({ password: pw });
            }}
          >
            Reset password
          </button>
        </div>
        {error && <div className="mt-1 text-xs text-fail">{error}</div>}
      </td>
    </tr>
  );
}

function CreateUser({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'user'>('user');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createUser({ email, password, displayName, role });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create user.');
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="Display name">
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        </Field>
        <Field label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password (min 8)">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </Field>
        <Field label="Role">
          <select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'user')} className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg">
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
        </Field>
        {error && <div className="sm:col-span-2"><ErrorBox message={error} /></div>}
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" disabled={busy}>
            Create user
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
