# TestHistory Plugin API

A **plugin** is a single self-contained HTML file you attach to a project. It renders
inside a sandboxed `<iframe>` with an **opaque origin** — no cookies, no `localStorage`,
no network access, and no access to the parent page. Its *only* capability is a
`postMessage` bridge to run **read-only SQL** against that project's database.

## Lifecycle

1. The host loads your HTML in `<iframe sandbox="allow-scripts">` (no `allow-same-origin`).
2. Your plugin posts `{ type: 'th-ready' }` to `parent` when it's ready.
3. The host replies with `th-init` — the API version, the project, and the active theme.
4. Your plugin sends `th-query` messages; the host replies with matching `th-result`.

At most **4 queries** may be in flight at once; excess return a `RATE_LIMITED` error.

## Messages

Plugin → host:

```jsonc
{ "type": "th-ready" }
{ "type": "th-query", "id": "<your-correlation-id>", "sql": "SELECT ...", "params": [1, "x"] }
```

Host → plugin:

```jsonc
{ "type": "th-init", "apiVersion": 1,
  "project": { "id": "…", "name": "…" },
  "theme": { "name": "dark", "vars": { "bg": "#…", "fg": "#…", "pass": "#…", "fail": "#…", … } } }

{ "type": "th-result", "id": "…", "ok": true,
  "columns": ["c1", …], "rows": [[…], …], "rowCount": 12, "truncated": false, "durationMs": 3 }

{ "type": "th-result", "id": "…", "ok": false,
  "error": { "code": "FORBIDDEN_STATEMENT" | "SQL_ERROR" | "TIMEOUT" | "RESULT_TOO_LARGE" | "RATE_LIMITED" | "INTERNAL",
             "message": "…" } }
```

## SQL rules

- Only `SELECT` / `WITH` queries. `ATTACH`, `PRAGMA`, `VACUUM`, and any write are rejected (`FORBIDDEN_STATEMENT`).
- One statement per query. Bind values with `?` placeholders and the `params` array — never string-concatenate.
- Results cap at 10,000 rows (`truncated: true`) and ~5 MB serialized (`RESULT_TOO_LARGE`).
- A query that runs too long is killed and returns `TIMEOUT`.

### Schema

```sql
runs(id, run_key, created_at, started_at, duration_ms, label, branch, commit_sha, ci_url, uploads_json,
     total, passed, failed, errored, skipped)
tests(id, suite, name, first_seen_run_id, last_seen_run_id)
results(test_id, run_id, status, duration_ms, message, stack)   -- status: 0=passed 1=failed 2=error 3=skipped
name_rules(id, position, match, rewrite, created_at)
```

## `TH.query()` helper (~20 lines)

Drop this into your plugin and call `await TH.query(sql, params)`:

```html
<script>
  const TH = (() => {
    let seq = 0;
    const pending = new Map();
    let theme = null, project = null;
    window.addEventListener('message', (e) => {
      const m = e.data;
      if (!m || typeof m !== 'object') return;
      if (m.type === 'th-init') { theme = m.theme; project = m.project; (TH.oninit || (() => {}))(m); }
      else if (m.type === 'th-result') {
        const p = pending.get(m.id); if (!p) return; pending.delete(m.id);
        m.ok ? p.resolve(m) : p.reject(new Error(m.error.code + ': ' + m.error.message));
      }
    });
    const TH = {
      oninit: null,
      get theme() { return theme; },
      get project() { return project; },
      query(sql, params) {
        const id = 'q' + ++seq;
        return new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
          parent.postMessage({ type: 'th-query', id, sql, params }, '*');
        });
      },
    };
    parent.postMessage({ type: 'th-ready' }, '*');
    return TH;
  })();
</script>
```

## Minimal example plugin

See [`plugin-demo.html`](./plugin-demo.html) for a complete, self-contained plugin that
lists the slowest tests and colors itself with the active theme. Upload it to a project
under **Settings → Plugins**, then open it from the plugin list.
