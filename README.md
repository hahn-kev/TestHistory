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

### Production (run the published image)

CI publishes the image to `ghcr.io/hahn-kev/testhistory` on every push to `master`
(tag `latest`, plus `sha-<commit>`). On your server, layer `docker-compose.prod.yml`
over the base file to pull that image instead of building locally:

```bash
export SESSION_SECRET=$(openssl rand -hex 32)   # keep this stable across redeploys
docker compose -f docker-compose.yml -f docker-compose.prod.yml pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Pin a specific build with `IMAGE_TAG` (e.g. `IMAGE_TAG=sha-52c49dc`). If the GHCR
package is private, run `docker login ghcr.io -u <user>` with a PAT that has
`read:packages` first. To upgrade, re-run the two commands above — `pull_policy: always`
fetches the current tag.

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

### Reusable GitHub Action

For GitHub CI, we provide a reusable composite GitHub Action to easily find and upload your test results. It supports multiple glob patterns (e.g., recursive search), handles run key/re-run conventions cleanly, and exposes run summary counters as outputs.

To use it, add a step like this in your workflow:

```yaml
- name: Upload Test Results
  uses: hahn-kev/testhistory/.github/actions/upload-results@latest # Or pin a specific branch/commit SHA
  with:
    server-url: 'https://testhistory.company.com'
    project-id: 'your-project-id'
    api-token: ${{ secrets.TESTHISTORY_TOKEN }}
    files: |
      **/test-results/**/*.xml
      **/junit-*.xml
    on-no-files: 'error' # Options: error | ignore (defaults to error)
```

#### Inputs

| Input | Description | Required / Default |
| --- | --- | --- |
| `server-url` | The URL of your TestHistory instance. | **Required** |
| `project-id` | Target project ID. | **Required** |
| `api-token` | Your API token from project Settings → Tokens. | **Required** |
| `files` | Multiline glob pattern(s) to match test result files. | **Required** |
| `on-no-files` | Behavior when no files match the patterns (`error` or `ignore`). | `error` |
| `run-key` | Unique key identifying this build run. | `${{ github.run_id }}-${{ github.run_attempt }}` |
| `branch` | The VCS branch name. | PR head branch, else `${{ github.ref_name }}` |
| `commit` | The commit SHA (also the SHA the check run attaches to). | PR head SHA, else `${{ github.sha }}` |
| `format` | Override parser format (e.g., `junit`, `nunit3`, `xunit`, `trx`). | Auto-detected |
| `label` | A custom label for this run. | (None) |
| `ci-url` | Link back to the CI run. | `${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}` |
| `started-at` | ISO 8601 timestamp for the run start. | (Current UTC time) |
| `create-check` | Create/update a GitHub check run linking to the run on your TestHistory instance. | `true` |
| `check-name` | Name of the check run. Every upload in the same build updates this one check. | `TestHistory` |
| `github-token` | Token used for the Checks API (needs `checks: write`). | `${{ github.token }}` |

#### Outputs

| Output | Description |
| --- | --- |
| `run-id` | The ID of the created or appended run. |
| `total` | Total number of tests in the run. |
| `passed` | Number of passing tests. |
| `failed` | Number of failing tests. |
| `errored` | Number of errored tests. |
| `skipped` | Number of skipped tests. |
| `check-run-id` | ID of the GitHub check run created/updated (empty if skipped or unavailable). |

#### Run check

By default the action creates a **GitHub check run** on the commit that links to the run
on your TestHistory instance and shows the pass/fail summary. Because a **run** can be fed
by several uploads (see run keys above), the check is keyed on the `run-key`: every
invocation of the action within the same build **updates the one check** rather than
creating duplicates — so the check always reflects the cumulative run.

For this to work the workflow token needs the `checks: write` permission:

```yaml
jobs:
  test:
    permissions:
      checks: write # required for the run check; the action falls back to a warning without it
    steps:
      # ...
      - name: Upload Test Results
        uses: hahn-kev/testhistory/.github/actions/upload-results@latest
        with:
          server-url: 'https://testhistory.company.com'
          project-id: 'your-project-id'
          api-token: ${{ secrets.TESTHISTORY_TOKEN }}
          files: '**/junit-*.xml'
```

Set `create-check: 'false'` to disable it. Note that GitHub issues a read-only token to
workflows triggered by **forked pull requests**, so the check can't be created there.

**Linking to TestHistory.** GitHub [does not honor a check run's `details_url`](https://github.com/orgs/community/discussions/26757)
when the check is created with the built-in `GITHUB_TOKEN` — clicking the check row stays
on GitHub. So the check's **summary** leads with a prominent
"View this run on TestHistory" link; that's the one-click path to the run. If you'd rather
have the check itself link straight through, pass a **GitHub App installation token** as
`github-token` (e.g. via [`actions/create-github-app-token`](https://github.com/actions/create-github-app-token)) —
GitHub honors `details_url` for App tokens.

## Comparing runs

The **Compare** tab (and `GET /api/projects/<id>/compare`) diffs two runs and reports what
changed: **newly failing** (regressions), **newly fixed**, **still failing**, **new
tests**, and **removed tests**, plus per-status and duration deltas. Each side is named by
run id **or** by the latest run on a branch — so you can compare a PR's run against the
latest `main` run without knowing main's run id:

```
GET /api/projects/<id>/compare?baseBranch=main&head=<runId>            → JSON
GET /api/projects/<id>/compare?baseBranch=main&head=<runId>&format=md  → Markdown
```

`?format=md` (or `Accept: text/markdown`) returns a compact summary suitable for pasting
into a PR comment; it ends with a stable `<!-- testhistory-compare -->` marker so a bot can
find and update its own comment in place. Like all read endpoints, `/compare` is authorized
by **viewer** access (a session or anonymous visit to a public project; project tokens are for uploads only). Errors:
**400** if a side names neither a run id nor a branch; **404** for an unknown run id or a
branch with no runs. A brand-new test that fails counts as *newly failing* (a merge-gating
signal), and `fail → skip` is treated as unchanged, not fixed.

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
- Projects are **public by default** (anyone with the project URL can view, including
  anonymous visitors); a per-project `private` flag restricts reads to members and admins.
  The project list / dashboard still requires login.
- **viewer** (read, incl. running plugins) → anyone with the link unless private.
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
