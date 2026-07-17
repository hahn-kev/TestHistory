// Shared request/response shapes between server and web.

export type Role = 'admin' | 'user';
export type ProjectRole = 'owner' | 'member';
export type TestStatus = 'passed' | 'failed' | 'error' | 'skipped';
export type ResultFormat = 'junit' | 'nunit2' | 'nunit3' | 'xunit' | 'trx';
/** Best-effort CI job fate reported at Upload (`CONTEXT.md` — CI Job Outcome). */
export type CiJobOutcome = 'failed' | 'cancelled';

/** Parse upload/DB strings into CI Job Outcome; anything else → null. */
export function parseCiJobOutcome(v: string | null | undefined): CiJobOutcome | null {
  return v === 'failed' || v === 'cancelled' ? v : null;
}

export interface ApiError {
  error: { code: string; message: string };
}

export interface UserInfo {
  id: number;
  email: string;
  displayName: string;
  role: Role;
  disabled: boolean;
  createdAt: string;
}

export interface ProjectInfo {
  id: string;
  name: string;
  description: string | null;
  private: boolean;
  createdAt: string;
  myRole: ProjectRole | null;
  /** Optional Primary Branch override; null/empty means auto-detect. */
  primaryBranch: string | null;
  /** Resolved Primary Branch after override or auto-detect; null if unresolved. */
  resolvedPrimaryBranch: string | null;
  lastRun?: RunSummary | null;
}

/** Admin-only per-project size accounting, for spotting projects growing too large. */
export interface ProjectSizeInfo {
  id: string;
  name: string;
  private: boolean;
  createdAt: string;
  runCount: number;
  testCount: number;
  resultCount: number;
  /** On-disk size of the project's SQLite file, including WAL/SHM sidecars. */
  dbBytes: number;
  pluginCount: number;
  pluginBytes: number;
  /** dbBytes + pluginBytes. */
  totalBytes: number;
  lastRunAt: string | null;
}

export interface ProjectMemberInfo {
  userId: number;
  email: string;
  displayName: string;
  role: ProjectRole;
}

export interface TokenInfo {
  id: number;
  name: string;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/** One uploaded file's facts within a Run (ADR-0001: a Run is fed by 1+ Uploads). */
export interface UploadInfo {
  fileName: string | null;
  fileSize: number | null;
  format: ResultFormat;
  durationMs: number | null;
  uploadedAt: string;
}

export interface RunSummary {
  id: number;
  createdAt: string;
  startedAt: string | null;
  durationMs: number | null;
  label: string | null;
  branch: string | null;
  commitSha: string | null;
  ciUrl: string | null;
  /** Sticky CI Job Outcome; null when unset. */
  ciJobOutcome: CiJobOutcome | null;
  uploads: UploadInfo[];
  total: number;
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
}

export interface TestResultRow {
  testId: number;
  suite: string;
  name: string;
  status: TestStatus;
  durationMs: number | null;
  message: string | null;
  stack: string | null;
}

export interface TestInfo {
  id: number;
  suite: string;
  name: string;
  firstSeenRunId: number;
  lastSeenRunId: number;
}

export interface TestHistoryEntry {
  runId: number;
  createdAt: string;
  branch: string | null;
  commitSha: string | null;
  label: string | null;
  status: TestStatus;
  durationMs: number | null;
  message: string | null;
  stack: string | null;
}

export interface FlakyTestEntry {
  testId: number;
  suite: string;
  name: string;
  runsSeen: number;
  fails: number;
  flips: number;
  lastStatus: TestStatus;
}

export interface TrendPoint {
  runId: number;
  createdAt: string;
  branch: string | null;
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
  durationMs: number | null;
}

/** `GET /trend` mode: health = Primary Branch; recent = unfiltered last N. */
export type TrendMode = 'health' | 'recent';

/** Response for `GET /api/projects/:id/trend` (mode fields present when `?mode=` is set). */
export interface TrendResponse {
  trend: TrendPoint[];
  mode?: TrendMode;
  /** Primary Branch override (health mode only). */
  primaryBranch?: string | null;
  /** Resolved Primary Branch after override/auto-detect (health mode only; null if unresolved). */
  resolvedPrimaryBranch?: string | null;
}

export interface NameRule {
  match: string;
  rewrite: string;
}

export interface NameRulePreviewSample {
  before: { suite: string; name: string };
  after: { suite: string; name: string };
}

/** How a Test's Status changed from one Run to another (Run Comparison). */
export type ChangeCategory =
  | 'newlyFailing'
  | 'newlyFixed'
  | 'stillFailing'
  | 'newTests'
  | 'removedTests';

/** A Test's Status in one side of a comparison; `absent` = no Result in that Run. */
export type ComparedStatus = TestStatus | 'absent';

export interface ComparedTest {
  testId: number;
  suite: string;
  name: string;
  baseStatus: ComparedStatus;
  headStatus: ComparedStatus;
  baseDurationMs: number | null;
  headDurationMs: number | null;
}

/** One change category's Tests. `total` is exact; `tests` may be capped (`truncated`). */
export interface ComparisonBucket {
  total: number;
  truncated: boolean;
  tests: ComparedTest[];
}

export interface ComparisonSummary {
  regressions: number; // = categories.newlyFailing.total
  fixed: number;
  stillFailing: number;
  newTests: number;
  removedTests: number;
  other: number; // unchanged (pass→pass, skip→skip, fail→skip, …)
  passedDelta: number;
  failedDelta: number;
  erroredDelta: number;
  skippedDelta: number;
  totalDelta: number;
  durationDeltaMs: number | null; // head.durationMs - base.durationMs
}

export interface RunComparison {
  base: RunSummary;
  head: RunSummary;
  summary: ComparisonSummary;
  categories: Record<ChangeCategory, ComparisonBucket>;
}

export interface PluginInfo {
  id: string;
  name: string;
  description: string | null;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface PluginQueryResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  durationMs: number;
}
