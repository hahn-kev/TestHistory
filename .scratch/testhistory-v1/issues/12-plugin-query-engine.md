# 12 — Plugin query engine + serving (backend)

**What to build:** The security-critical read-only SQL surface that plugins will use, plus the machinery to store and serve plugin HTML safely. A member can upload/replace/delete a plugin HTML file; the server serves it via a short-lived signed URL with headers that force an opaque origin; and a query endpoint runs read-only SQL against the Project DB with an allowlist, resource caps, and a terminate-on-timeout watchdog — all in a dedicated worker pool so a hostile query can't wedge or exfiltrate.

**Blocked by:** 06 — Ingest core (reuses the worker-pool primitive).

**Status:** ready-for-agent

- [ ] Plugin management (S member): `GET/POST/PUT/DELETE /api/projects/:id/plugins[/:pluginId]`, multipart streamed to disk (`.tmp` then atomic rename), `plugins` row records name/description/size/timestamps.
- [ ] `GET .../plugins/:pluginId/url` (S viewer) returns a ~60s HMAC-signed URL; `GET /plugin-content/:pluginId?st=…` streams the HTML with `fs.createReadStream`, `Content-Length`, `Content-Security-Policy: sandbox allow-scripts`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`.
- [ ] `POST /api/projects/:id/plugin-query` (S viewer) `{ sql, params? }` → `{ columns, rows, rowCount, truncated, durationMs }`, executed in a dedicated 2-worker query pool: `readonly` + `query_only=ON` + `trusted_schema=OFF`; first-keyword allowlist after comment-stripping (only `SELECT`/`WITH`; blocks `ATTACH`/`PRAGMA`/`VACUUM INTO`); single-statement via `prepare()`; params via `?` placeholders only.
- [ ] Caps: 10,000 rows (soft, `truncated:true`), ~5MB serialized → `RESULT_TOO_LARGE`. Route rate-limited (~30 req/10s per session).
- [ ] Timeout: a main-thread watchdog `terminate()`s the worker on expiry and respawns it (readonly = safe), replying `TIMEOUT`.
- [ ] Tests: `DELETE`/`ATTACH`/`PRAGMA`/`VACUUM INTO` → `FORBIDDEN_STATEMENT`; row/byte caps; a recursive-CTE bomb → `TIMEOUT` and the **next** query on that pool succeeds (worker replaced); signed-URL expiry rejected.
