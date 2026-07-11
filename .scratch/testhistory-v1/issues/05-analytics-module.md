# 05 — Analytics module (seam 2)

**What to build:** All the aggregation logic that answers the product's hard questions — is a Test flaky? what's the trend? what's this Test's history? — as pure functions over an injected database handle, testable against hand-crafted rows with no server, no worker threads, no parsing. This module also owns the two pieces of ingest correctness (append-target resolution, counter recomputation) so the worker in later tickets calls *these* functions rather than inlining SQL.

**Blocked by:** 03 — Projects, members, tokens, DbManager (for the per-Project schema/migration used to build fixture DBs).

**Status:** ready-for-agent

- [ ] Functions take an injected better-sqlite3 `Database` handle (dependency-injected, never self-opened):
  - `detectFlaky(db, { window, branch }) → FlakyTestEntry[]`
  - `computeTrend(db, { limit, branch }) → TrendPoint[]`
  - `getTestHistory(db, testId) → TestHistoryEntry[]`
  - `recomputeRunCounters(db, runId) → { total, passed, failed, errored, skipped }`
  - `resolveAppendTarget(db, runKey, now, windowMs) → { action:'append', runId } | { action:'create' } | { action:'expired' }`
- [ ] Flaky semantics: flip = `passed` ↔ (`failed`|`error`); `skipped` results and Runs where the Test is absent are gaps, not flips; `branch` scopes the window; window = last N Runs after filtering; flaky = `flips >= 2`.
- [ ] `recomputeRunCounters` derives tallies from `results` (never accumulates) so duplicate/re-uploaded results don't double-count.
- [ ] `resolveAppendTarget` returns `expired` once the fixed window from the target Run's creation has passed, `append` within it, `create` when no Run has the key.
- [ ] Tests open a temp/in-memory DB, run the Project migration, `INSERT` controlled rows, and assert outputs. Adversarial matrix: `pass/fail/pass/fail` (flaky) vs `pass/skip/pass/skip` (not) vs interleaved branches (flaky only within a branch) vs `pass/error/pass` (flaky); window-boundary flip excluded; counter idempotency under duplicate results; append/create/expired transitions.
