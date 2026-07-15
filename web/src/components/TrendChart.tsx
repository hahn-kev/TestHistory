import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Icon } from '@iconify/react';
import alertIcon from '@iconify-icons/mdi/alert';
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
  // Runs with any failure or error get a warning marker under their axis label.
  const problematic = new Set(data.filter((d) => d.failed > 0 || d.error > 0).map((d) => d.run));

  /** X-axis tick: run label, plus a warning icon when that run had failures/errors. */
  const RunTick = ({ x, y, payload }: { x?: number; y?: number; payload?: { value: string } }) => {
    const label = payload?.value ?? '';
    return (
      <g transform={`translate(${x ?? 0},${y ?? 0})`}>
        <text dy={12} textAnchor="middle" fill={v.muted} fontSize={11}>
          {label}
        </text>
        {problematic.has(label) && <Icon icon={alertIcon} x={-6} y={18} width={12} height={12} color={v.fail} />}
      </g>
    );
  };

  return (
    <div style={{ width: '100%', height: 260 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 20, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={v.border} vertical={false} />
          <XAxis dataKey="run" tick={<RunTick />} height={40} stroke={v.border} interval={0} />
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
