// postMessage protocol between the trusted PluginHost page and a sandboxed plugin iframe.
// The plugin runs with an opaque origin: postMessage is its only capability.

export const PLUGIN_API_VERSION = 1;

export type PluginQueryErrorCode =
  | 'SQL_ERROR'
  | 'FORBIDDEN_STATEMENT'
  | 'TIMEOUT'
  | 'RESULT_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'INTERNAL';

// plugin -> parent
export interface PluginReadyMessage {
  type: 'th-ready';
}

export interface PluginQueryMessage {
  type: 'th-query';
  id: string;
  sql: string;
  params?: (string | number | null)[];
}

// parent -> plugin
export interface PluginInitMessage {
  type: 'th-init';
  apiVersion: number;
  project: { id: string; name: string };
  theme: { name: string; vars: Record<string, string> };
}

export interface PluginResultOkMessage {
  type: 'th-result';
  id: string;
  ok: true;
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  durationMs: number;
}

export interface PluginResultErrMessage {
  type: 'th-result';
  id: string;
  ok: false;
  error: { code: PluginQueryErrorCode; message: string };
}

export type PluginToParent = PluginReadyMessage | PluginQueryMessage;
export type ParentToPlugin = PluginInitMessage | PluginResultOkMessage | PluginResultErrMessage;
