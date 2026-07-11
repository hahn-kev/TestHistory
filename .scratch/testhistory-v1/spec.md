# Spec: TestHistory v1

Status: ready-for-agent

A self-hosted service that tracks unit-test results across many Runs, per Project. Full domain vocabulary in `CONTEXT.md`; architectural rationale in `docs/adr/`. This spec is the product-level companion to `PLAN.md` (which holds the technical detail: schema, routes, stack).

## Problem Statement

Teams run automated test suites constantly — in CI on every push, locally before commits, nightly against multiple branches — but the results evaporate. A CI run prints pass/fail and is gone. Nobody can answer the questions that actually matter over time:

- "Is this test *flaky*, or did it genuinely break?"
- "When did `LoginTest` start failing, and on which branch?"
- "Is our suite getting slower? Which tests are the worst offenders?"
- "Did that fix actually stabilize the test, or did we just get lucky on the last run?"

Existing dashboards are either tied to one CI vendor, buried inside a heavyweight test-management SaaS, or require standing up a database and writing glue code. A small team that just wants durable, queryable test history — across JUnit, NUnit, xUnit, and TRX outputs from a mixed-language shop — has no lightweight, self-hostable option. And when they do want a bespoke view of their own data, they can't get one without forking the tool.

## Solution

A single Docker container that accepts test-result file uploads over plain HTTP, parses the major formats into a common model, and stores them in a per-Project SQLite database. A professional web UI shows trends, per-test history, and flaky-test detection. CI uploads autonomously using per-Project bearer tokens; humans sign in with admin-managed accounts.

Two ideas make it fit real workflows rather than fighting them:

- **Runs are appendable.** One CI build often emits many files (one TRX per .NET project, one JUnit per shard). Instead of forcing users to merge files or tolerating one noisy Run per file, a Run is *the build*: it accepts multiple Uploads — several files in one POST, or separate POSTs correlated by a client-supplied **run key** — for a fixed window after creation. (See ADR-0001.)
- **Plugins.** Any Project member can upload a single self-contained HTML file that renders sandboxed in the browser with read-only SQL access to that Project's database. Teams build the bespoke chart or report they want without touching the server. The sandbox is the security-critical surface and is defended in depth (opaque origin, SQL allowlist, resource caps, terminate-on-timeout).

## User Stories

### Setup & accounts
1. As the first person to open a fresh deployment, I want to create the initial account and have it be an admin, so that I can start administering the system without a separate bootstrap step.
2. As an admin, I want the setup endpoint to refuse once any user exists, so that nobody can hijack a running deployment by re-running setup.
3. As an admin, I want to create user accounts with an initial password and role, so that my teammates can sign in.
4. As an admin, I want to disable a user, so that a departed teammate loses access without deleting their authorship history.
5. As an admin, I want to reset a user's password, so that I can help someone locked out.
6. As a user, I want to log in and stay logged in across days of active use, so that I'm not re-authenticating constantly.
7. As a user, I want my session to eventually expire if I stop using it, so that an abandoned session isn't a standing risk.
8. As a user, I want to change my own password, so that I control my credentials.
9. As a user, I want login attempts to be rate-limited, so that my account resists brute-forcing.

### Projects & access
10. As a user, I want to create a Project and automatically become its owner, so that I can start collecting test history immediately.
11. As a user, I want Projects to be readable by all signed-in users by default, so that test history is discoverable across the team without per-Project grants.
12. As an owner, I want to mark a Project private, so that sensitive test data is restricted to its members.
13. As a signed-in user, I want to browse and read any non-private Project, so that I can check another team's suite health without being added as a member.
14. As a non-member, I want private Projects to be invisible (not merely forbidden), so that their existence doesn't leak.
15. As an owner, I want to rename a Project and edit its description, so that it stays legible as work evolves.
16. As an owner, I want to add and remove members and set their role (owner/member), so that I control who can manage the Project.
17. As an owner, I want to delete a Project and have its database and plugin files removed, so that decommissioning is clean and complete.
18. As an admin, I want owner-level powers on every Project without being explicitly added, so that I can administer anything.
19. As a member, I want to upload Runs and delete Runs, but not rename or delete the Project, so that day-to-day data work doesn't require owner rights and destructive project-level actions stay gated.

### Tokens & uploads
20. As a member, I want to mint a bearer token for a Project, so that CI can upload autonomously.
21. As a member, I want the token's plaintext shown exactly once at creation, so that it's handled like a secret.
22. As a member, I want to see a token's prefix, name, creation time, and last-used time afterward, so that I can identify and audit it without seeing the secret.
23. As a member, I want to revoke a token, so that a leaked or retired credential stops working immediately.
24. As a CI job, I want to POST a raw XML body with metadata in query params, so that a one-line `curl --data-binary` uploads results.
25. As a CI job, I want to POST multipart with one or more file fields plus text metadata, so that a build emitting several result files uploads them in one request as a single Run.
26. As a CI job, I want to supply a run key so that separate uploads from the same build land in the same Run, so that a sharded or multi-project build appears as one Run.
27. As a CI job, I want a second upload with the same run key within the append window to merge into the existing Run, so that late-arriving shards still join their build.
28. As a CI job, I want an upload naming a run key whose window has closed to be rejected with a clear error, so that a stale or reused key can't silently corrupt an old Run.
29. As a CI job, I want to re-upload the same file after a network blip without double-counting, so that retries are safe.
30. As a CI job, I want the format auto-detected from file content, with an optional override, so that I don't have to configure the format per pipeline.
31. As a CI job, I want an unknown or unparseable file to fail with a specific error code, so that my pipeline can distinguish "bad file" from "server down".
32. As a CI job, I want oversized uploads rejected before they're buffered into memory, so that the server stays healthy under abuse or accident.
33. As a CI job, I want the HTTP response to carry the resulting Run's tallies, so that the pipeline can log or assert on them.

### Reading history
34. As a viewer, I want a dashboard of Projects I can see, each with a health sparkline, so that I get an at-a-glance overview.
35. As a viewer, I want a Project overview with a stacked pass/fail/skip trend chart over recent Runs, so that I can see the suite's trajectory.
36. As a viewer, I want to filter the overview and flaky views by branch, so that a broken feature branch doesn't pollute my read of `main`.
37. As a viewer, I want a paginated list of recent Runs with their metadata and tallies, so that I can find a specific build.
38. As a viewer, I want a Run detail page showing its metadata, its per-Upload breakdown (files, sizes, durations), and its full results table, so that I can inspect exactly what a build produced.
39. As a viewer, I want to filter and search a Run's results by status and text, so that I can jump to the failures.
40. As a viewer, I want to expand a failing result to see its message and stack trace, so that I can diagnose without leaving the page.
41. As a viewer, I want a per-Test history view showing its status across Runs as a timeline plus a duration chart, so that I can see when and how it changed.
42. As a viewer, I want to search Tests by name, so that I can find a specific test quickly.
43. As a viewer, I want a flaky-tests view listing Tests that flipped between passing and failing within a recent window, so that I can prioritize stabilization.
44. As a viewer, I want flaky detection to treat `error` like a failure but ignore `skipped` and absences, so that feature-flagged and conditionally-skipped tests aren't misreported as flaky.
45. As a viewer, I want the run duration to reflect total upload time with the per-upload breakdown available, so that a slowing suite is visible and attributable.
46. As a member, I want to delete a Run, so that I can remove a garbage or accidental upload from the history.

### Test identity / name rules
47. As a viewer, I want each distinct `(suite, name)` treated as its own Test with its own history, so that parameterized tests I care about are tracked separately.
48. As a member of a Project whose framework embeds volatile values in test names, I want to define ordered rewrite rules that normalize names at ingest, so that history stops fragmenting into thousands of one-off Tests.
49. As a member, I want to preview a rule set against recent real test names before saving, so that I don't ship a bad regex blind.
50. As a member, I want name rules to affect only new Uploads, so that turning on a rule can't retroactively scramble existing history.

### Plugins
51. As a member, I want to upload a single HTML file as a plugin for my Project, so that I can build a bespoke view of the data.
52. As a member, I want to replace, rename, and delete plugins, so that I can iterate on them.
53. As a viewer, I want to open a plugin and have it render, so that I can use views others built.
54. As a viewer, I want a plugin to be able to run read-only SQL against the Project database, so that it can compute whatever it needs from the raw data.
55. As an operator, I want plugins to run with no access to cookies, storage, the API, or other Projects' data, so that an untrusted or malicious plugin can't exfiltrate anything.
56. As an operator, I want plugin queries that write, attach other databases, or run pragmas to be rejected, so that "read-only" is actually enforced.
57. As an operator, I want a runaway plugin query to be killed after a timeout and the next query to still work, so that one bad query can't wedge the service.
58. As an operator, I want plugin queries rate-limited and result sizes capped, so that plugins can't DoS the server or exhaust memory.
59. As a plugin author, I want documented protocol and a small query helper, so that I can build a plugin without reverse-engineering the bridge.

### Presentation & operation
60. As a user, I want to choose among several professional themes (light/dark variants), so that the UI suits my preference.
61. As a user, I want my theme choice to persist and apply before first paint, so that there's no flash of the wrong theme.
62. As a plugin author, I want the active theme's colors forwarded to my plugin, so that my view matches the surrounding UI.
63. As an operator, I want the whole service to ship as one Docker container with a single data volume, so that deployment and backup are trivial.
64. As an operator, I want data to survive container recreation, so that upgrades don't lose history.
65. As an operator, I want a session secret auto-generated and persisted on first boot, so that signed URLs and sessions survive restarts without manual key management.
66. As an operator, I want a health endpoint, so that my orchestrator can tell if the service is up.
67. As an operator, I want large uploads and heavy plugin queries not to block the service for everyone else, so that the app stays responsive under load.
68. As an operator, I want tunable limits (upload size, query caps, append window, session lifetime) via environment variables, so that I can adapt the deployment without a rebuild.

## Implementation Decisions

Most technical detail lives in `PLAN.md`; this section records the product-shaping decisions and the seams they imply.

### Domain & data
- **Run / Upload / Run Key / Append Window** as defined in `CONTEXT.md` and ADR-0001. A Run is appendable for a fixed window (default 1h, `RUN_APPEND_WINDOW_MS`) anchored at creation. Reused/expired run key → **409 `RUN_KEY_EXPIRED`**. Per-upload facts stored in `uploads_json`; run `duration_ms` = sum of upload durations, `started_at` = earliest.
- **Counters are recomputed from `results`, never accumulated** — this is what makes retries and multi-upload merges idempotent.
- **Result identity** is `(test_id, run_id)` with last-write-wins on conflict, both within a single file and across a Run's Uploads.
- **Name Rules** (ADR-0002): identity is verbatim by default; opt-in per-Project regex rewrites applied at ingest, new Uploads only, no retroactive merge in v1.
- **Status** is stored as an integer (0=passed 1=failed 2=error 3=skipped); the four-way status is canonical throughout.
- **No automatic retention** in v1; manual Run deletion only.

### Access model
- Any active user creates Projects (becomes owner). Public-to-signed-in-users by default; per-Project `private` flag. Three effective access levels — **viewer** (read, incl. plugin execution), **member** (day-to-day writes), **owner** (project identity/existence) — with admins as implicit owners. Non-viewers receive **404** on project routes to avoid existence leaks.

### Modules & seams
The system is designed around **four test seams**, from lowest to highest. Correctness lives at the low seams; integration lives at the high ones.

1. **Parsers + detection** (pure). `detect(filePath) → format` and one streaming `parse` per format, each emitting the common `{suite, name, status, durationMs?, message?, stack?}` model. No server, no DB. This is where format-specific quirks (TRX id-join, NUnit2 ancestor fixtures, duration formats, duplicate-name last-write-wins) are pinned.

2. **Analytics/aggregation** (pure, over a `Database` handle). A module of functions that take an injected better-sqlite3 handle and compute deterministic results:
   - `detectFlaky(db, { window, branch }) → FlakyTestEntry[]`
   - `computeTrend(db, { limit, branch }) → TrendPoint[]`
   - `getTestHistory(db, testId) → TestHistoryEntry[]`
   - `recomputeRunCounters(db, runId) → tallies`
   - `resolveAppendTarget(db, runKey, now, windowMs) → { action: 'append', runId } | { action: 'create' } | { action: 'expired' }`

   **Constraint that keeps this seam honest:** the ingest worker and the route handlers MUST call these functions rather than inlining equivalent SQL. The run-key resolution and counter recomputation are extracted out of the worker into this module so the worker and the tests exercise one implementation. Flaky semantics enforced here: flip = `passed` ↔ (`failed`|`error`); `skipped` results and absent runs are gaps, not flips; branch filter scopes the window; window = last N runs after filtering.

3. **HTTP API via `app.inject()`** (integration; primary seam). The Fastify `app` tested in-process against a temp `DATA_DIR`. Covers auth, project CRUD + visibility matrix, tokens, upload (both styles, run-key append, 409, multi-file), name-rule application end-to-end, all read endpoints, plugin management, and plugin-query. Worker threads run inside the same process. This seam proves the pieces are *wired together*; it relies on seams 1–2 for the underlying correctness.

4. **`scripts/smoke.sh`** (end-to-end). A real server process and real `curl`, including the multipart path and run-key 409, ending in Docker volume-persistence verification.

### API contracts
- Errors are `{ error: { code, message } }`. Error codes are part of the contract: `UNKNOWN_FORMAT` (415), `PARSE_ERROR` (422), `TOO_LARGE` (413), `RUN_KEY_EXPIRED` (409), and plugin-query codes `SQL_ERROR`/`FORBIDDEN_STATEMENT`/`TIMEOUT`/`RESULT_TOO_LARGE`/`RATE_LIMITED`/`INTERNAL`.
- Upload response: 201 (create) / 200 (append) with `{ run: { id, total, passed, failed, errored, skipped, durationMs, startedAt, uploads: [...] } }`.
- `shared/api-types.ts` is the source of truth for response shapes and needs updating to match ADR-0001: `RunSummary` replaces `format`/`fileName` with an `uploads` array; `ProjectInfo` gains `private`.

### Plugin sandbox (security-critical)
- Served via short-lived HMAC-signed URL into an `iframe` with `sandbox="allow-scripts"` (no `allow-same-origin`) **and** a `Content-Security-Policy: sandbox allow-scripts` header — opaque origin enforced in two independent layers.
- Read-only enforcement in a dedicated query worker pool: `readonly` connection + `query_only` + `trusted_schema=OFF`, first-keyword `SELECT`/`WITH` allowlist after comment stripping (blocks `ATTACH`/`PRAGMA`/`VACUUM INTO`), row/byte caps, `?`-placeholder params only, and a main-thread watchdog that `terminate()`s and respawns the worker on timeout (better-sqlite3 has no interrupt).

## Testing Decisions

- **Test external behavior, not implementation.** A good test asserts on inputs and observable outputs: a fixture file → parsed model; a set of DB rows → computed flaky list; an HTTP request → response and resulting stored state. Tests should not assert on private function calls, SQL text, or worker-internal structure.
- **Seam 1 (parsers):** `vitest` unit tests, no server. Two fixtures per format (mixed statuses; edge cases). Snapshot the emitted common model. Include a detection table test mapping first-element → format, and `?format=` override. A `huge-gen.ts` fixture generator produces a large file for the performance probe. Prior art: this is the classic pure-function-with-fixtures pattern; fixtures live under `server/test/fixtures/`.
- **Seam 2 (analytics):** `vitest` unit tests that open a temp/in-memory SQLite DB, run the project migration, `INSERT` hand-crafted `runs`/`tests`/`results` rows, and assert the function output. This is where the subtle rules get adversarial cases: `pass/fail/pass/fail` (flaky) vs `pass/skip/pass/skip` (not flaky) vs interleaved branches (flaky only within a branch) vs `pass/error/pass` (flaky, error is fail-side); window boundary (flip just outside window doesn't count); counter recomputation idempotent under duplicate results; `resolveAppendTarget` returns `expired` past the window and `append`/`create` correctly. Prior art: same fixture-DB approach the migration test uses.
- **Seam 3 (HTTP):** integration via `app.inject()` + temp `DATA_DIR`. Per-format ingest with counter assertions; run-key append (two POSTs merge, counters recomputed, same file twice = no double-count); 409 after window (set a tiny `RUN_APPEND_WINDOW_MS`); multi-file multipart = one Run; visibility matrix (non-member and private → 404, owner-only PATCH); name-rule application end-to-end; migration upgrade test; plugin-query timeout + worker-replacement. Prior art: Fastify's documented `app.inject()` pattern; the whole point is no network, real app.
- **Seam 4 (smoke):** `scripts/smoke.sh` against a running process: setup → login → create project + token → curl upload → assert counts → second upload same run key → same run id / merged counts → flipped test → flaky endpoint contains it → history shows runs → plugin-query `SELECT COUNT(*)` works and `DELETE` rejected. Final: Docker run with mounted volume + restart persistence.
- **Latency probe:** during a generated 50MB ingest, `GET /api/auth/me` must stay <50ms — the concrete assertion behind the "don't block the event loop" risk.

## Out of Scope

- **Automatic retention / pruning** — manual Run deletion only in v1; README documents the storage-growth math. Schema supports adding retention cheaply later (`ON DELETE CASCADE`).
- **Retroactive Name-Rule merge** — rules apply to new Uploads only; collapsing existing fragmented Tests is a deliberate later feature.
- **Browser/E2E automation of the plugin iframe bridge** — the `plugin-query` REST endpoint is tested at seam 3; the iframe wiring (postMessage, opaque origin) is validated manually and by a smoke note. No Playwright seam in v1.
- **Per-project default-branch setting** — the flaky/overview branch filter is manual (`?branch=`) in v1; a stored default branch is a later UX nicety.
- **Cross-Project queries / global dashboards** — per-Project isolation is a hard boundary (it's also a security property for plugins). No aggregation across Projects.
- **SSO / external identity, email flows** — accounts are admin-managed with local passwords; no self-service signup, password-reset email, or OAuth.
- **Multi-process / horizontal scaling** — single process, single node; SQLite concurrency is handled by WAL + per-Project FIFO + single-writer, which assumes one process.
- **Non-XML formats** (TAP, JSON reporters, etc.) — the five XML-family formats only.

## Further Notes

- **Build in the order in `PLAN.md`** (skeleton → core DB+auth → projects+tokens → parsers → ingest+reads → frontend → plugins → polish → Docker), but note the analytics module (seam 2) should be extracted as its own module *before or during* the ingest step, since the worker depends on it. Don't let run-key resolution or counter recomputation get inlined into the worker — that's the one refactor that would quietly destroy seam 2.
- **`shared/api-types.ts` is currently stale** relative to ADR-0001 (`RunSummary.format`/`fileName`, missing `ProjectInfo.private`). Reconcile it as part of the ingest/reads work.
- **Run keys must be fresh per build.** The 409-on-reuse behavior means a bare commit SHA is a poor run key; a CI build/job id is correct. This must be prominent in the upload docs — it's the most likely thing to surprise a CI author.
- The two ADRs (appendable runs, name-rules-at-ingest) capture the decisions most likely to be second-guessed later; read them before changing ingest or identity behavior.
