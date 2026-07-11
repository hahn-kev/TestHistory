# TestHistory

A self-hosted service for tracking **unit-test results across many runs, per project**.
CI/CD (or a local run) uploads JUnit / NUnit / xUnit / TRX result files over HTTP; the
service parses and stores them in **one SQLite database per project**, then answers the
questions that matter: what's the trend, what's this test's history, and **which tests
are flaky**. Each project can host a sandboxed **plugin** — a single HTML file with
read-only SQL access to its data. Ships as one Docker container.

## Quick start (Docker)

```bash
docker compose up --build -d
# open http://localhost:3000 and create the first (admin) account
```

The container stores everything under the `/data` volume:
`/data/core.db`, `/data/projects/{id}.db`, `/data/plugins/{id}.html`, `/data/tmp/`.

### Uploading results from CI

Create a project, mint an API token under **Settings → Tokens**, then:

```bash
# Raw body (single file)
curl --data-binary @results.xml \
  -H "Authorization: Bearer tht_…" \
  -H "Content-Type: application/xml" \
  "http://localhost:3000/api/projects/<projectId>/runs?branch=main&commit=$SHA&run_key=$CI_BUILD_ID"

# Multipart (several files — sharded jobs, one TRX per .NET project — into one run)
curl -F file=@shard1.xml -F file=@shard2.xml -F run_key=$CI_BUILD_ID \
  -H "Authorization: Bearer tht_…" \
  "http://localhost:3000/api/projects/<projectId>/runs"
```

Supported formats are auto-detected (JUnit `<testsuites>`/`<testsuite>`, NUnit v2
`<test-results>`, NUnit v3 `<test-run>`, xUnit `<assemblies>`/`<assembly>`, TRX
`<TestRun>`). Pass `?format=` to override.

**Run keys.** A **run** is one logical CI build, fed by one or more uploads. Uploads
sharing a `run_key` within the **append window** (`RUN_APPEND_WINDOW_MS`, default 1h from
run creation) merge into the same run; counters are recomputed on every append so a
retried upload never double-counts. After the window closes the run is immutable and a
reused key returns **409 `RUN_KEY_EXPIRED`** — so a run key must be **fresh per build**
(use a CI build id, not a bare commit SHA).

## Development

```bash
npm install
npm run dev        # Fastify API on :3000 + Vite dev server on :5173 (proxies /api)
npm run build      # build shared, server, web
npm test           # server test suite (vitest + app.inject)
```

## Configuration

All knobs are environment variables (see `server/src/config.ts`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATA_DIR` | `./data` | Root for all databases, plugins, and temp files |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Listen address |
| `SESSION_SECRET` | auto-generated into `/data/secret` | HMAC key for sessions + signed plugin URLs |
| `SESSION_TTL_DAYS` | `30` | Session sliding-expiry length |
| `RUN_APPEND_WINDOW_MS` | `3600000` | How long a run stays open for appends |
| `MAX_UPLOAD_BYTES` | `209715200` (200 MB) | Max result-file size |
| `MAX_PLUGIN_BYTES` | `104857600` (100 MB) | Max plugin HTML size |
| `QUERY_MAX_ROWS` | `10000` | Soft row cap for plugin queries (marks `truncated`) |
| `QUERY_MAX_BYTES` | `5242880` (5 MB) | Serialized-result cap (`RESULT_TOO_LARGE`) |
| `QUERY_TIMEOUT_MS` | `2000` | Plugin-query watchdog; overruns are killed (`TIMEOUT`) |
| `INGEST_TIMEOUT_MS` | `300000` | Ingest worker timeout |
| `WEB_DIR` | `../web/dist` | Directory of the built web app to serve |

> Set `SESSION_SECRET` explicitly in production if you ever run without a persistent
> `/data` volume — otherwise a new secret invalidates all sessions on restart.

## Access model

- Any signed-in user can **create** a project (and becomes its owner).
- Projects are **public to all signed-in users** by default; a per-project `private`
  flag restricts reads to members and admins.
- **viewer** (read, incl. running plugins) → any signed-in user unless private.
  **member** (upload/delete runs, tokens, plugins, name rules) → project members.
  **owner** (rename, privacy, membership, delete) → project owners. Admins are implicit
  owners everywhere. Non-viewers get **404** (not 403) on project routes.

## Plugins

A plugin is a single HTML file rendered in a sandboxed `<iframe>` with an **opaque
origin** (`sandbox="allow-scripts"` plus a `Content-Security-Policy: sandbox
allow-scripts` header — no cookies, storage, or network). Its only capability is a
`postMessage` bridge that runs **read-only** `SELECT`/`WITH` queries against the
project's database, enforced by a dedicated worker pool (`query_only`, single-statement,
row/byte caps, terminate-on-timeout). See [`docs/plugin-api.md`](docs/plugin-api.md) and
the [`docs/plugin-demo.html`](docs/plugin-demo.html) example.

## Storage growth & retention

**v1 has no automatic retention** — runs are kept until you delete them manually
(a member can delete a run from its detail page; results cascade). Plan capacity
accordingly. Rough per-project math:

- Each **result** row ≈ `status + duration + (message ≤16 KB) + (stack ≤64 KB)`. With
  short/no failure text a passing result is on the order of tens of bytes; a failure
  with a full stack can approach ~80 KB.
- A run of **N** tests where a fraction *f* fail with stacks ≈ `N × 60 B + f·N × ~20 KB`.
  10,000 tests, 1% failing with 8 KB stacks ≈ **~1.4 MB/run** → ~1,000 runs ≈ **~1.4 GB**.
- Mostly-passing suites are far smaller (10,000 passing tests ≈ **~0.6 MB/run**).

To reclaim space, delete old runs (results cascade). Databases are per project, so
you can also archive or drop an entire project's `.db` file.

## Architecture

Node 22 + TypeScript, npm workspaces (`shared`, `server`, `web`). Server: Fastify +
better-sqlite3 + argon2 + saxes + zod. Ingest parsing and plugin queries run in
`worker_threads` so a 50 MB upload or a hostile query never blocks the event loop
(a single writer per project is serialized by a FIFO queue; WAL + `busy_timeout` cover
concurrency). Web: React 18 + Vite + Tailwind v4 (CSS-variable theming) + Recharts.
Verified end-to-end by `scripts/smoke.sh`.
