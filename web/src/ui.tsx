import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes } from 'react';
import type { TestStatus } from '@testhistory/shared';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-border bg-surface ${className}`}>{children}</div>
  );
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed';
  const styles =
    variant === 'primary'
      ? 'bg-primary text-primary-fg hover:opacity-90'
      : variant === 'danger'
        ? 'bg-fail text-white hover:opacity-90'
        : 'border border-border bg-surface hover:bg-surface-2 text-fg';
  return <button className={`${base} ${styles} ${className}`} {...props} />;
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-primary ${className}`}
      {...props}
    />
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return <div className="p-8 text-center text-sm text-muted">{label}</div>;
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-fail/40 bg-fail/10 px-3 py-2 text-sm text-fail" role="alert">
      {message}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-10 text-center">
      <p className="font-medium text-fg">{title}</p>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
    </div>
  );
}

const STATUS_STYLE: Record<TestStatus, string> = {
  passed: 'bg-pass/15 text-pass',
  failed: 'bg-fail/15 text-fail',
  error: 'bg-error/15 text-error',
  skipped: 'bg-skip/15 text-skip',
};

export function StatusChip({ status }: { status: TestStatus }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold capitalize ${STATUS_STYLE[status]}`}>
      {status}
    </span>
  );
}

export function StatusDot({ status, title }: { status: TestStatus; title?: string }) {
  const color = { passed: 'bg-pass', failed: 'bg-fail', error: 'bg-error', skipped: 'bg-skip' }[status];
  return <span title={title ?? status} className={`inline-block h-3 w-3 rounded-sm ${color}`} />;
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}
