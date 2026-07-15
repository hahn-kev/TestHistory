import { Link, useParams } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { api } from '../api/client.js';
import { useAsync } from '../hooks.js';
import { AppIcon, Card, ErrorBox, Spinner, StatusDot, fmtDate, fmtDuration } from '../ui.js';
import { themeVars } from '../theme/theme.js';

export function TestDetailPage() {
  const { id = '', testId = '' } = useParams();
  const tid = Number(testId);
  const state = useAsync(() => api.testHistory(id, tid), [id, tid]);
  const v = themeVars();

  if (state.loading) return <Spinner />;
  if (state.error) return <ErrorBox message={state.error} />;
  if (!state.data) return null;

  const { test, history } = state.data;
  // Chart wants chronological order.
  const chrono = [...history].reverse();
  const durationData = chrono.map((h) => ({ run: `#${h.runId}`, duration: h.durationMs ?? 0 }));

  return (
    <div className="space-y-5">
      <div>
        <Link to={`/projects/${id}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
          <AppIcon name="arrow-left" className="h-4 w-4" />
          Back to project
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-fg">{test.name}</h1>
        <p className="text-sm text-muted">{test.suite}</p>
      </div>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-medium text-fg">Status timeline (oldest → newest)</h2>
        <div className="flex flex-wrap gap-1">
          {chrono.map((h) => (
            <Link key={h.runId} to={`/projects/${id}/runs/${h.runId}`} title={`#${h.runId} · ${h.status} · ${fmtDate(h.createdAt)}`}>
              <StatusDot status={h.status} />
            </Link>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-medium text-fg">Duration</h2>
        <div style={{ width: '100%', height: 220 }}>
          <ResponsiveContainer>
            <LineChart data={durationData} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={v.border} vertical={false} />
              <XAxis dataKey="run" tick={{ fill: v.muted, fontSize: 11 }} stroke={v.border} />
              <YAxis tick={{ fill: v.muted, fontSize: 11 }} stroke={v.border} />
              <Tooltip
                contentStyle={{ background: v.surface, border: `1px solid ${v.border}`, borderRadius: 8, color: v.fg }}
                formatter={(val: number) => fmtDuration(val)}
              />
              <Line type="monotone" dataKey="duration" stroke={v.primary} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-muted">
            <tr>
              <th className="px-4 py-2">Run</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Branch</th>
              <th className="px-4 py-2">Duration</th>
              <th className="px-4 py-2">When</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.runId} className="border-t border-border">
                <td className="px-4 py-2">
                  <Link to={`/projects/${id}/runs/${h.runId}`} className="text-primary hover:underline">
                    #{h.runId}
                  </Link>
                </td>
                <td className="px-4 py-2">
                  <StatusDot status={h.status} /> <span className="ml-1 capitalize text-muted">{h.status}</span>
                </td>
                <td className="px-4 py-2 text-muted">{h.branch ?? '—'}</td>
                <td className="px-4 py-2 text-muted">{fmtDuration(h.durationMs)}</td>
                <td className="px-4 py-2 text-muted">{fmtDate(h.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
