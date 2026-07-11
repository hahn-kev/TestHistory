# TestHistory — Unit Test History Tracking Service

## Context

Greenfield build in the empty directory `C:\dev\TestHistory`. The service tracks unit test results across many runs, per project. Test result files are uploaded via a simple HTTP POST from CI/CD or local runs, parsed, and stored in SQLite — **one database per project**. Users are admin-managed; each project can mint bearer tokens for autonomous uploads. Each project supports **plugins**: a single user-provided HTML file (possibly tens of MB), rendered sandboxed in the browser with a read-only SQL API against that project's database. Professional UI with several selectable themes. Ships as a single Docker container.

User decisions: parse **JUnit XML, NUnit XML (v2/v3), xUnit.net XML, TRX**; **admin-managed accounts** (first user = admin); **Docker** deployment.

Grilling-session decisions (vocabulary in `CONTEXT.md`, rationale in `docs/adr/`):
- **Runs are appendable**: a Run = one logical CI build, fed by 1+ Uploads (multi-file multipart, or separate POSTs correlated by a client-supplied **run key**) within a fixed **append window** (`RUN_APPEND_WINDOW_MS`, default 1h, anchored at run creation). Upload naming a closed run → **409 RUN_KEY_EXPIRED** (keys must be fresh per build). Per-upload facts live in `uploads_json`; run counters are **recomputed** per append (retry-safe); run `duration_ms` = sum of upload durations, `started_at` = earliest.
- **Access model**: any active user may create a project (becomes owner). Projects are **public to all signed-in users by default**; per-project `private` flag restricts reads to members+admins. Public read includes executing plugins. Writes (upload/delete runs, tokens, plugins) = member+; rename/privacy/members/delete = owner (admins are implicit owners everywhere).
- **Flaky** = ≥2 flips of `passed` ↔ (`failed`|`error`) within the last N runs; `skipped`/absence are gaps, not flips; `?branch=` scopes the window to one branch.
- **Name Rules**: test identity is verbatim `(suite, name)` unless opt-in per-project regex rewrite rules (applied at ingest, preview UI, new uploads only — no retroactive merge in v1) stabilize it.
- **No automatic retention** in v1 (manual run deletion only; README documents growth math). **Sessions**: sliding expiry, `SESSION_TTL_DAYS` default 30.

## Stack

- Node.js 22 + TypeScript, npm workspaces: `shared/`, `server/`, `web/`
- Server: **Fastify**, **better-sqlite3**, **argon2** (argon2id), **saxes** (streaming XML), **zod**, @fastify/cookie, @fastify/multipart, @fastify/static, @fastify/rate-limit
- Web: **React 18 + Vite**, react-router, **Tailwind CSS v4** (CSS-variable theming), **Recharts**
- Tests: vitest + `app.inject()`; `scripts/smoke.sh` for end-to-end
- Docker base: `node:22-bookworm-slim` (glibc → prebuilt binaries for better-sqlite3/argon2, no compiler needed)

## Repo layout

```
TestHistory/
├── package.json  tsconfig.base.json  Dockerfile  docker-compose.yml  README.md
├── docs/plugin-api.md               # postMessage protocol + example plugin
├── shared/src/{api-types.ts, plugin-protocol.ts}   # zod schemas + protocol types
├── server/src/
│   ├── index.ts  config.ts  app.ts  static.ts
│   ├── db/{core-db.ts, project-db.ts, migrate.ts, migrations/{core,project}/*.sql}
│   ├── auth/{passwords.ts, sessions.ts, tokens.ts, guards.ts}
│   ├── routes/{auth,admin-users,projects,tokens,uploads,runs,tests,plugins,plugin-query}.ts
│   ├── ingest/{queue.ts, ingest-worker.ts, detect.ts, model.ts, parsers/{junit,nunit2,nunit3,xunit,trx}.ts}
│   ├── query/{pool.ts, query-worker.ts}
│   └── lib/{worker-pool.ts, ids.ts, signed-url.ts}
├── server/test/{fixtures/, *.test.ts}
├── web/src/{main.tsx, router.tsx, api/client.ts, theme/, components/, pages/}
└── scripts/smoke.sh
```

## Databases

All connections: `PRAGMA journal_mode=WAL; synchronous=NORMAL; busy_timeout=5000; foreign_keys=ON`. Migrations via `PRAGMA user_version` with one shared runner. Project DBs migrate in two places: **boot sweep** over `/data/projects/*.db` + **lazy guard** on every fresh open in `DbManager` (LRU handle cache, cap ~64).

### core.db
- `users(id, email UNIQUE NOCASE, password_hash, display_name, role admin|user, disabled, created_at)`
- `sessions(id = sha256 of cookie value, user_id, created_at, expires_at, last_seen_at)` — sliding expiry: `expires_at = last_seen + SESSION_TTL_DAYS`, refreshed when >1 day stale; expired rows swept on login + daily timer
- `projects(id = nanoid(12) — used as DB filename, name UNIQUE, description, private INTEGER DEFAULT 0, created_by, created_at)`
- `project_members(project_id, user_id, role owner|member, PK(project_id,user_id))`
- `api_tokens(id, project_id, name, token_hash sha256 UNIQUE, token_prefix, created_by, created_at, last_used_at, revoked_at)` — token format `tht_<24 base62>`, plaintext shown exactly once
- `plugins(id = nanoid(12) — file at /data/plugins/{id}.html, project_id, name UNIQUE per project, description, size_bytes, uploaded_by, created_at, updated_at)`

### Per-project DB (`/data/projects/{id}.db`)
```sql
CREATE TABLE runs (
  id INTEGER PRIMARY KEY,            -- monotonic = run ordering
  run_key TEXT,                      -- client-supplied correlation key; NOT unique (only append-target lookup uses it)
  created_at TEXT NOT NULL,          -- anchors the append window
  started_at TEXT,                   -- earliest across uploads
  duration_ms INTEGER,               -- sum across uploads
  label TEXT, branch TEXT, commit_sha TEXT, ci_url TEXT,
  metadata_json TEXT,
  uploads_json TEXT NOT NULL DEFAULT '[]',  -- [{fileName, fileSize, format, durationMs, uploadedAt}]
  total INTEGER NOT NULL DEFAULT 0, passed INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0, errored INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_runs_branch ON runs(branch, id DESC);
CREATE INDEX idx_runs_key ON runs(run_key, id DESC) WHERE run_key IS NOT NULL;

CREATE TABLE tests (
  id INTEGER PRIMARY KEY, suite TEXT NOT NULL, name TEXT NOT NULL,
  first_seen_run_id INTEGER NOT NULL, last_seen_run_id INTEGER NOT NULL,
  UNIQUE (suite, name)
);
CREATE INDEX idx_tests_name ON tests(name);

CREATE TABLE results (
  test_id INTEGER NOT NULL REFERENCES tests(id),
  run_id  INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  status  INTEGER NOT NULL,          -- 0=passed 1=failed 2=error 3=skipped
  duration_ms REAL, message TEXT,    -- truncated 16KB
  stack TEXT,                        -- truncated 64KB
  PRIMARY KEY (test_id, run_id)
) WITHOUT ROWID;                     -- clustered on (test_id, run_id): test history = one range scan
CREATE INDEX idx_results_run ON results(run_id, status);

CREATE TABLE name_rules (              -- opt-in test-identity rewrites, applied at ingest
  id INTEGER PRIMARY KEY,
  position INTEGER NOT NULL,           -- evaluation order
  match TEXT NOT NULL,                 -- JS regex source, tested against "suite::name"
  rewrite TEXT NOT NULL,               -- replacement (capture groups OK); result re-split on "::"
  created_at TEXT NOT NULL
);
```
Flaky detection needs no extra tables — window-function query over the last N runs (optionally `WHERE branch = ?` first), `skipped` results excluded from the sequence, flip = `passed` ↔ (`failed`|`error`) via `LAG` per test_id, `HAVING flips >= 2`.

## API

Auth modes: **S** = session cookie (`th_session`, httpOnly, SameSite=Lax), **B** = bearer project token. Errors: `{ error: { code, message } }`.

Access levels (per grilling decisions): **viewer** = any signed-in user if project is not private, else member/admin — gates all project reads incl. plugin execution; **member** = day-to-day writes (runs, tokens, plugins, name rules); **owner** = rename/privacy/members/delete; admin = implicit owner. Non-viewers get 404 (not 403) on project routes.

- `GET/POST /api/setup` — none; POST creates **first user as admin**, 403 once any user exists
- `POST /api/auth/login|logout`, `GET /api/auth/me`, `PATCH /api/auth/password` — login rate-limited
- `GET/POST/PATCH /api/admin/users[/:id]` — S admin (create users w/ password, role, disable, reset)
- `GET /api/projects` (S: public projects + own memberships; admin: all), `POST /api/projects` (S any user → creator becomes owner; body incl. `private`), `GET /api/projects/:id` (S viewer), `PATCH` (S owner; name/description/`private`), `DELETE` (S owner; removes DB + plugin files)
- `GET/POST/DELETE /api/projects/:id/members[/:userId]` — S owner
- `GET/POST/DELETE /api/projects/:id/tokens[/:tokenId]` — S member; delete = soft revoke
- `GET/PUT /api/projects/:id/name-rules` — S member; PUT replaces the ordered rule list. `POST .../name-rules/preview` `{rules}` → sample of recent distinct test names before/after (S member)
- **`POST /api/projects/:id/runs` — S member / B — the upload endpoint.** Two styles, both **streamed to `/data/tmp/<id>`** (never buffered, byte-cap → 413):
  1. Raw body (`application/xml`) + query params `?run_key=&format=&branch=&commit=&label=&ci_url=&started_at=` — custom content-type parser pipelines to temp file. `curl --data-binary @results.xml -H "Authorization: Bearer tht_…"`.
  2. Multipart (**1+ `file` fields** — all merge into the same run — + text fields incl. `run_key`), @fastify/multipart streaming mode.
  **Run-key resolution** (inside the per-project queue): no key → new run. Key given → find newest run with that key; none → new run with the key; found & within append window → append; found & window closed → **409 RUN_KEY_EXPIRED** ("this run key was used by a previous run — run keys must be unique per build").
  Response 201 (or 200 on append) `{ run: { id, total, passed, failed, errored, skipped, durationMs, startedAt, uploads: [...] } }`. Errors 415 UNKNOWN_FORMAT / 422 PARSE_ERROR / 413 TOO_LARGE / 409 RUN_KEY_EXPIRED.
- Reads (S viewer): `GET .../runs?limit&cursor&branch`, `GET .../runs/:runId`, `GET .../runs/:runId/results?status&search&cursor`, `GET .../trend?limit&branch`, `GET .../tests?search`, `GET .../tests/:testId/history`, `GET .../flaky?window=50&branch=`. `DELETE .../runs/:runId` — S member.
- Plugins: manage `GET/POST/PUT/DELETE /api/projects/:id/plugins[/:pluginId]` — S member (multipart, streamed to disk, write `.tmp` then rename). Execution surface is **S viewer**: `GET .../plugins/:pluginId/url` → 60s HMAC-signed URL; `GET /plugin-content/:pluginId?st=…` streams the HTML; `POST /api/projects/:id/plugin-query` `{sql, params?}` → `{columns, rows, rowCount, truncated, durationMs}`

## Format parsing

Detection (`detect.ts`): read first 64KB of temp file, find first element name → `testsuites|testsuite`=JUnit, `test-results`=NUnit2, `test-run`=NUnit3, `assemblies|assembly`=xUnit, `TestRun`=TRX. `?format=` overrides.

All parsers are **saxes streaming handlers** emitting a common model: `{suite, name, status: passed|failed|error|skipped, durationMs?, message?, stack?}`. Suite/name sources: JUnit `classname`/`name`; NUnit2 ancestor TestFixture + name last segment; NUnit3 `classname`/`name`; xUnit `type`/`method`; TRX `TestMethod className/name` joined from `TestDefinitions` to `Results` via testId maps (order-independent). TRX durations parse `hh:mm:ss.fffffff`. Duplicate `(suite,name)` in one file: last-write-wins.

## Ingest pipeline

POST → stream to temp file(s) → detect format per file (main thread, cheap) → **per-project FIFO queue** → **ingest worker pool** (worker_threads; sync better-sqlite3 + saxes parse off the main thread). In the worker, one transaction per POST: resolve run by run key (create / append / 409, see API) → for each file: stream-parse, per test case **apply name rules** to `suite::name`, upsert `tests` (`ON CONFLICT(suite,name) DO UPDATE … RETURNING id`, warmed by in-worker identity Map) + upsert `results` (`ON CONFLICT(test_id,run_id) DO UPDATE` — last write wins within and across a run's uploads) → append entries to `uploads_json` → **recompute run counters from `results`** (never accumulate — retry-safe) + duration_ms = sum / started_at = min over uploads → COMMIT → delete temp files. Parse error rolls back the whole POST → 422 (an already-committed earlier upload to the same run is untouched). HTTP request held open until done. Boot: sweep stale `/data/tmp` files.

## Plugin sandbox (security-critical)

**Serving:** never srcdoc (tens of MB). Parent fetches `GET .../plugins/:pid/url` (session-authed) → short-lived signed URL → `iframe.src`. Served with `fs.createReadStream`, `Content-Length`, and headers:
```
Content-Security-Policy: sandbox allow-scripts
X-Content-Type-Options: nosniff
Cache-Control: private, no-store
```
Iframe: `sandbox="allow-scripts"` **without** `allow-same-origin`. Two layers → plugin always executes with an **opaque origin**: no cookies, no localStorage, no API fetch — even if opened top-level.

**Bridge (postMessage, defined in `shared/plugin-protocol.ts`):** plugin → parent: `{type:'th-query', id, sql, params?}`; parent → plugin: `{type:'th-init', apiVersion, project, theme}` and `{type:'th-result', id, ok, columns/rows | error:{code,message}}`. Parent (`PluginHost.tsx`) accepts messages only when `e.source === iframe.contentWindow`, relays to `plugin-query`, throttles (max 4 in-flight). `docs/plugin-api.md` documents the protocol + a ~20-line `TH.query()` helper snippet + example plugin.

**Read-only enforcement (`query-worker.ts`)** — runs in a dedicated 2-worker query pool:
1. `new Database(path, { readonly: true, fileMustExist: true })` + `pragma query_only=ON` + `trusted_schema=OFF`
2. First-keyword allowlist after comment stripping: `SELECT`/`WITH` only — blocks `ATTACH` (cross-project reads), `PRAGMA`, and `VACUUM INTO` (writes files even on readonly connections). `prepare()` gives single-statement enforcement free.
3. Caps: 10,000 rows (soft, `truncated:true`), ~5MB serialized (`RESULT_TOO_LARGE`); params bound via `?` placeholders only.
4. **Timeout:** better-sqlite3 has no interrupt → main thread runs a 2s watchdog, `worker.terminate()` on expiry (readonly connection = safe), respawn worker, reply `TIMEOUT`. This is why we use a small custom `worker-pool.ts` instead of piscina (piscina can't cancel sync tasks).
5. `@fastify/rate-limit` on the route (~30 req/10s per session).

## Frontend

Routes: `/login`, `/setup` (first user), `/` projects dashboard (cards + sparkline; public projects + my memberships, private badge), `/projects/:id` overview (Recharts stacked pass/fail trend, recent runs, branch filter), `/projects/:id/runs/:runId` (metadata header incl. per-upload breakdown "N uploads · files · durations", results table w/ status chips + search + expandable message/stack), `/projects/:id/tests/:testId` (status-cell timeline + duration chart), `/projects/:id/flaky` (branch filter, same component as overview), `/projects/:id/settings` (tabs: Tokens — show-once modal / Plugins / Members / Name Rules — ordered list + live preview against recent test names / Danger — incl. privacy toggle), `/projects/:id/plugins/:pluginId` (PluginHost iframe), `/admin/users`. Router loader hits `/api/auth/me`, 401 → login. Settings/manage UI hidden for non-members.

**Theming:** Tailwind v4 `@theme inline` maps utility colors to runtime `var(--th-*)`; theme sets under `[data-theme="light" | "dark" | "dark-violet" | "light-emerald"]` selectors. Switcher sets `documentElement.dataset.theme` + localStorage; inline pre-paint script in `index.html` avoids flash. Semantic tokens include pass/fail/skip colors; theme vars forwarded to plugins via `th-init`.

## Docker

Multi-stage `node:22-bookworm-slim`: build workspaces → prod-deps-only layer (`npm ci --omit=dev`) → runtime with non-root user, `VOLUME /data`, healthcheck on `/api/health`. Data layout: `/data/core.db`, `/data/projects/{id}.db`, `/data/plugins/{id}.html`, `/data/tmp/` (same filesystem → atomic rename). `SESSION_SECRET` env, auto-generated into `/data/secret` on first boot if unset. Other env knobs (all in `config.ts`): `MAX_UPLOAD_BYTES`, `MAX_PLUGIN_BYTES`, `QUERY_MAX_ROWS/BYTES/TIMEOUT_MS`, `INGEST_TIMEOUT_MS`, **`RUN_APPEND_WINDOW_MS` (default 3 600 000)**, **`SESSION_TTL_DAYS` (default 30)**. README documents storage growth math (no automatic retention in v1).

## Implementation order

1. **Skeleton** — workspaces, Fastify hello, Vite app + `/api` proxy. Verify: `npm run dev`.
2. **Core DB + auth** — migration runner, core schema, argon2, setup/login/me, guards, admin user CRUD. Verify: auth tests + curl round-trip.
3. **Projects + tokens** — CRUD incl. `private` flag + visibility guards (viewer/member/owner), members, DbManager (lazy create + migrate + LRU), bearer guard. Verify: token round-trip; visibility matrix; project DB appears with correct `user_version`.
4. **Parsers (pure)** — detection + 5 parsers against fixtures (2 per format: mixed statuses, edge cases; + `huge-gen.ts`). Verify: `parsers.test.ts` snapshots, no server needed.
5. **Ingest + read APIs** — streaming upload (multi-file + run-key append + 409), name-rule application, worker pool, queue, runs/results/tests/history/flaky/trend (+name-rules CRUD & preview endpoints). Verify: `smoke.sh`; generated 50MB file uploads while `GET /api/auth/me` stays <50ms.
6. **Frontend core** — auth pages, dashboard, overview + chart, run/test detail, flaky, theming.
7. **Plugins** — streamed upload/serve, signed URLs + CSP, query pool, PluginHost, docs + demo plugin. Verify: `DELETE`/`ATTACH` → FORBIDDEN_STATEMENT; recursive-CTE bomb → TIMEOUT then next query succeeds (worker replaced); demo plugin renders.
8. **Polish** — settings/admin UI, rate limits, session expiry sweep.
9. **Docker** — build image, run smoke against container, confirm data survives recreation.

## Verification

- vitest units: detection table, parser snapshots per fixture, token/session hashing, signed-URL expiry, SQL allowlist matrix, **name-rule application (incl. bad-regex rejection)**, **flaky flip counting (skipped = gap, error = fail side, branch filter)**.
- Integration via `app.inject()` + temp `DATA_DIR`: per-format ingest w/ counter asserts, **run-key append (two POSTs merge; counters recomputed; same file twice = no double-count), 409 after window (tiny `RUN_APPEND_WINDOW_MS`), multi-file multipart = one run**, **visibility matrix (non-member vs private project → 404; owner-only PATCH)**, migration upgrade test, plugin-query timeout/worker-replacement test.
- `scripts/smoke.sh`: setup → login → create project + token → curl upload fixture → assert 201 counts → **second upload with same `run_key` → same run id, merged counts** → third run with a flipped test → flaky endpoint contains it → history shows runs → plugin-query `SELECT COUNT(*)` and `DELETE` rejected.
- Final: Docker run with mounted volume, full smoke, restart persistence.

## Top risks & mitigations

1. **Event-loop blocking** (sync better-sqlite3, 50MB parses) → all ingestion + plugin queries in worker threads; verified with latency probe during big ingest.
2. **Plugin SQL surface** (injection by design) → readonly open + `query_only` + SELECT/WITH allowlist (blocks ATTACH/VACUUM INTO) + row/size caps + terminate-on-timeout + rate limit; per-project DB isolation.
3. **Plugin XSS/cookie theft** → opaque origin enforced twice (iframe sandbox attr + CSP sandbox header); only capability is the audited postMessage bridge.
4. **SQLite concurrency** → WAL + busy_timeout, single-writer-per-project FIFO, LRU handle cache, single process.
5. **Memory blowups** → stream everything (uploads, parse, plugin serving), byte caps, message/stack truncation.
