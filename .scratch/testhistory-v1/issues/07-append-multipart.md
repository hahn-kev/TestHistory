# 07 — Append semantics + multipart + multi-file

**What to build:** A CI build that emits several result files — sharded jobs, one TRX per .NET project — uploads them as a single Run: either several `file` fields in one multipart POST, or separate POSTs correlated by a client-supplied run key that merge into the same Run within the append window. Late or reused keys past the window are rejected with a clear error. This completes the appendable-Run model (ADR-0001) on top of ticket 06's single-file path.

**Blocked by:** 06 — Ingest core.

**Status:** ready-for-agent

- [ ] The upload endpoint also accepts multipart (`@fastify/multipart` streaming): **one or more `file` fields** plus text metadata fields (incl. `run_key`), each file streamed to its own temp file, all merging into one Run in a single transaction.
- [ ] Run-key resolution (inside the per-Project queue, via the analytics module's `resolveAppendTarget`): no key → new Run; key with no existing Run → new Run carrying the key; key found within the append window → **append** (add uploads, re-upsert results last-write-wins, recompute counters, extend `uploads_json`, recompute duration/started_at); key found but window closed → **409 `RUN_KEY_EXPIRED`** with a message explaining keys must be unique per build.
- [ ] Appending is idempotent/retry-safe: re-uploading the same file into a Run does not double-count (counters recomputed from `results`).
- [ ] Append responses return 200 (vs 201 on create) with the merged Run summary.
- [ ] The append window is `RUN_APPEND_WINDOW_MS`, fixed from Run creation.
- [ ] Tests: multi-file multipart = one Run with correct merged tallies; two POSTs with the same key merge; same file twice = no double-count; 409 after the window (set a tiny `RUN_APPEND_WINDOW_MS`).
