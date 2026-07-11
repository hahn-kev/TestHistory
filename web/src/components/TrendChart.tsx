import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import type { TrendPoint } from '@testhistory/shared';
import { themeVars } from '../theme/theme.js';

/** Stacked pass/fail/error/skip bars over recent runs. */
export function TrendChart({ trend }: { trend: TrendPoint[] }) {
  const v = themeVars();
  const data = trend.map((p) => ({
    run: `#${p.runId}`,
    passed: p.passed,
    failed: p.failed,
    error: p.errored,
    skipped: p.skipped,
  }));
  return (
    <div style={{ width: '100%', height: 260 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={v.border} vertical={false} />
          <XAxis dataKey="run" tick={{ fill: v.muted, fontSize: 11 }} stroke={v.border} />
          <YAxis tick={{ fill: v.muted, fontSize: 11 }} stroke={v.border} allowDecimals={false} />
          <Tooltip
            contentStyle={{ background: v.surface, border: `1px solid ${v.border}`, borderRadius: 8, color: v.fg }}
            cursor={{ fill: v['surface-2'] }}
          />
          <Bar dataKey="passed" stackId="s" fill={v.pass} />
          <Bar dataKey="failed" stackId="s" fill={v.fail} />
          <Bar dataKey="error" stackId="s" fill={v.error} />
          <Bar dataKey="skipped" stackId="s" fill={v.skip} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
