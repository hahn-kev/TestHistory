import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes } from 'react';
import { Icon } from '@iconify/react';
import githubIcon from '@iconify-icons/mdi/github';
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

export function GearIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

// GitHub logo via the Iconify React component (`mdi:github`), bundled offline from
// `@iconify-icons/mdi` so it never hits the Iconify API at runtime. The icon body uses
// `currentColor`, so it inherits the surrounding text color.
export function GitHubIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return <Icon icon={githubIcon} aria-hidden="true" className={`inline-block shrink-0 ${className}`} />;
}

/** External link to GitHub, prefixed with the GitHub logo. */
export function GitHubLink({
  href,
  children,
  className = '',
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 text-primary hover:underline ${className}`}
    >
      <GitHubIcon />
      {children}
    </a>
  );
}

/** GitHub URLs derivable from a run. The CI URL (which the upload action defaults to a
 *  GitHub Actions run link) is the source of truth for the repo, so commit/branch links
 *  are only produced when the CI URL is a recognizable Actions run. */
export interface GitHubRunLinks {
  ci?: string;
  commit?: string;
  branch?: string;
}

export function githubRunLinks(run: {
  ciUrl: string | null;
  commitSha: string | null;
  branch: string | null;
}): GitHubRunLinks {
  const links: GitHubRunLinks = {};
  if (!run.ciUrl) return links;
  let url: URL;
  try {
    url = new URL(run.ciUrl);
  } catch {
    return links;
  }
  // Expect a path shaped like /OWNER/REPO/actions/runs/ID (github.com or Enterprise).
  const parts = url.pathname.split('/').filter(Boolean);
  const i = parts.indexOf('actions');
  if (i < 2 || parts[i + 1] !== 'runs') return links;
  links.ci = run.ciUrl;
  const repo = `${url.origin}/${parts[i - 2]}/${parts[i - 1]}`;
  if (run.commitSha) links.commit = `${repo}/commit/${run.commitSha}`;
  if (run.branch) links.branch = `${repo}/tree/${encodeURIComponent(run.branch)}`;
  return links;
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
