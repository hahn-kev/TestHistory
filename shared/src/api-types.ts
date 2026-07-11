// Shared request/response shapes between server and web.

export type Role = 'admin' | 'user';
export type ProjectRole = 'owner' | 'member';
export type TestStatus = 'passed' | 'failed' | 'error' | 'skipped';
export type ResultFormat = 'junit' | 'nunit2' | 'nunit3' | 'xunit' | 'trx';

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
  lastRun?: RunSummary | null;
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

export interface RunSummary {
  id: number;
  createdAt: string;
  startedAt: string | null;
  durationMs: number | null;
  format: ResultFormat;
  label: string | null;
  branch: string | null;
  commitSha: string | null;
  ciUrl: string | null;
  fileName: string | null;
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
