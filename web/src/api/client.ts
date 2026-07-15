import type {
  UserInfo,
  ProjectInfo,
  ProjectMemberInfo,
  TokenInfo,
  RunSummary,
  TestResultRow,
  TestInfo,
  TestHistoryEntry,
  FlakyTestEntry,
  TrendPoint,
  PluginInfo,
  PluginQueryResult,
  NameRule,
  NameRulePreviewSample,
  RunComparison,
} from '@testhistory/shared';

/** Query for the two sides of a run comparison. */
export interface CompareQuery {
  base?: number;
  head?: number;
  baseBranch?: string;
  headBranch?: string;
  limit?: number;
  // Allow passing straight to qs() (which takes a string-keyed record).
  [k: string]: string | number | undefined;
}

/** An error thrown when the API returns a non-2xx `{ error: { code, message } }`. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const opts: RequestInit = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) {
    opts.headers = { 'content-type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = data?.error ?? { code: 'ERROR', message: res.statusText };
    throw new ApiError(res.status, err.code, err.message);
  }
  return data as T;
}

export interface Paged<T> {
  nextCursor: number | null;
}

export const api = {
  // --- auth / setup ---
  setupStatus: () => req<{ setupRequired: boolean }>('GET', '/api/setup'),
  setup: (b: { email: string; password: string; displayName: string }) =>
    req<{ user: UserInfo }>('POST', '/api/setup', b),
  login: (b: { email: string; password: string }) => req<{ user: UserInfo }>('POST', '/api/auth/login', b),
  logout: () => req<{ ok: true }>('POST', '/api/auth/logout'),
  me: () => req<{ user: UserInfo }>('GET', '/api/auth/me'),
  changePassword: (b: { currentPassword: string; newPassword: string }) =>
    req<{ ok: true }>('PATCH', '/api/auth/password', b),

  // --- admin users ---
  listUsers: () => req<{ users: UserInfo[] }>('GET', '/api/admin/users'),
  createUser: (b: { email: string; password: string; displayName: string; role: 'admin' | 'user' }) =>
    req<{ user: UserInfo }>('POST', '/api/admin/users', b),
  updateUser: (id: number, b: Partial<{ displayName: string; role: 'admin' | 'user'; disabled: boolean; password: string }>) =>
    req<{ user: UserInfo }>('PATCH', `/api/admin/users/${id}`, b),

  // --- projects ---
  listProjects: () => req<{ projects: ProjectInfo[] }>('GET', '/api/projects'),
  createProject: (b: { name: string; description?: string; private?: boolean }) =>
    req<{ project: ProjectInfo }>('POST', '/api/projects', b),
  getProject: (id: string) => req<{ project: ProjectInfo }>('GET', `/api/projects/${id}`),
  updateProject: (id: string, b: Partial<{ name: string; description: string | null; private: boolean }>) =>
    req<{ project: ProjectInfo }>('PATCH', `/api/projects/${id}`, b),
  deleteProject: (id: string) => req<{ ok: true }>('DELETE', `/api/projects/${id}`),

  // --- members ---
  listMembers: (id: string) => req<{ members: ProjectMemberInfo[] }>('GET', `/api/projects/${id}/members`),
  addMember: (id: string, b: { userId: number; role: 'owner' | 'member' }) =>
    req<{ ok: true }>('POST', `/api/projects/${id}/members`, b),
  removeMember: (id: string, userId: number) => req<{ ok: true }>('DELETE', `/api/projects/${id}/members/${userId}`),

  // --- tokens ---
  listTokens: (id: string) => req<{ tokens: TokenInfo[] }>('GET', `/api/projects/${id}/tokens`),
  createToken: (id: string, b: { name: string }) =>
    req<{ token: string; tokenInfo: TokenInfo }>('POST', `/api/projects/${id}/tokens`, b),
  revokeToken: (id: string, tokenId: number) => req<{ ok: true }>('DELETE', `/api/projects/${id}/tokens/${tokenId}`),

  // --- name rules ---
  getNameRules: (id: string) => req<{ rules: NameRule[] }>('GET', `/api/projects/${id}/name-rules`),
  putNameRules: (id: string, rules: NameRule[]) => req<{ rules: NameRule[] }>('PUT', `/api/projects/${id}/name-rules`, { rules }),
  previewNameRules: (id: string, rules: NameRule[]) =>
    req<{ samples: NameRulePreviewSample[] }>('POST', `/api/projects/${id}/name-rules/preview`, { rules }),

  // --- reads ---
  listRuns: (id: string, q: { limit?: number; cursor?: number; branch?: string } = {}) =>
    req<{ runs: RunSummary[]; nextCursor: number | null }>('GET', `/api/projects/${id}/runs${qs(q)}`),
  getRun: (id: string, runId: number) => req<{ run: RunSummary; suites: string[] }>('GET', `/api/projects/${id}/runs/${runId}`),
  listResults: (
    id: string,
    runId: number,
    q: { status?: string; search?: string; suite?: string; sort?: string; dir?: string; cursor?: number; limit?: number } = {},
  ) => req<{ results: TestResultRow[]; nextCursor: number | null }>('GET', `/api/projects/${id}/runs/${runId}/results${qs(q)}`),
  trend: (id: string, q: { limit?: number; branch?: string } = {}) =>
    req<{ trend: TrendPoint[] }>('GET', `/api/projects/${id}/trend${qs(q)}`),
  flaky: (id: string, q: { window?: number; branch?: string } = {}) =>
    req<{ flaky: FlakyTestEntry[] }>('GET', `/api/projects/${id}/flaky${qs(q)}`),
  searchTests: (id: string, q: { search?: string; cursor?: number; limit?: number } = {}) =>
    req<{ tests: TestInfo[]; nextCursor: number | null }>('GET', `/api/projects/${id}/tests${qs(q)}`),
  testHistory: (id: string, testId: number) =>
    req<{ test: TestInfo; history: TestHistoryEntry[] }>('GET', `/api/projects/${id}/tests/${testId}/history`),
  deleteRun: (id: string, runId: number) => req<{ ok: true }>('DELETE', `/api/projects/${id}/runs/${runId}`),
  compare: (id: string, q: CompareQuery = {}) =>
    req<{ comparison: RunComparison }>('GET', `/api/projects/${id}/compare${qs(q)}`),
  // Markdown variant uses raw fetch since `req` assumes a JSON body.
  compareMarkdown: (id: string, q: CompareQuery = {}) =>
    fetch(`/api/projects/${id}/compare${qs({ ...q, format: 'md' })}`, { credentials: 'same-origin' }).then((r) => r.text()),

  // --- plugins ---
  listPlugins: (id: string) => req<{ plugins: PluginInfo[] }>('GET', `/api/projects/${id}/plugins`),
  deletePlugin: (id: string, pluginId: string) => req<{ ok: true }>('DELETE', `/api/projects/${id}/plugins/${pluginId}`),
  pluginUrl: (id: string, pluginId: string) => req<{ url: string; expiresInMs: number }>('GET', `/api/projects/${id}/plugins/${pluginId}/url`),
  pluginQuery: (id: string, b: { sql: string; params?: (string | number | null)[] }) =>
    req<PluginQueryResult>('POST', `/api/projects/${id}/plugin-query`, b),
  // Plugin upload/replace use multipart; done via raw fetch in the settings page.
};

function qs(q: Record<string, string | number | undefined>): string {
  const parts = Object.entries(q)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}
