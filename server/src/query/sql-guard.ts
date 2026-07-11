/**
 * Read-only SQL gate for plugin queries. Strips comments, then requires the
 * first keyword to be SELECT or WITH — which rejects ATTACH (cross-project
 * reads), PRAGMA, and VACUUM INTO (writes a file even on a readonly connection),
 * plus every DML/DDL statement. Single-statement enforcement is free from
 * better-sqlite3's `prepare()`.
 */
export function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

export function firstKeyword(sql: string): string | null {
  const s = stripSqlComments(sql).replace(/^[\s(]+/, '');
  const m = /^([A-Za-z]+)/.exec(s);
  return m ? m[1].toUpperCase() : null;
}

export function isReadOnlyStatement(sql: string): boolean {
  const kw = firstKeyword(sql);
  return kw === 'SELECT' || kw === 'WITH';
}
