# 06 — Ingest core: worker pool + single-file raw-body upload

**What to build:** A CI job can `curl --data-binary @results.xml` (with metadata in query params) to a Project's upload endpoint and get back a created Run with correct tallies — parsed and stored entirely off the main thread so the service stays responsive during a big ingest. This is the simplest complete ingest path: one raw-body file, no run key, one new Run. It stands up the worker pool, the per-Project FIFO queue, and the ingest transaction that later tickets extend.

**Blocked by:** 04 — Parsers + detection; 05 — Analytics module.

**Status:** ready-for-agent

- [ ] A small custom worker pool (`worker_threads`) and a per-Project FIFO queue exist and are reusable (the plugin query pool will reuse the pool primitive).
- [ ] `POST /api/projects/:id/runs` (S member / B) accepts a raw `application/xml` body with `?run_key=&format=&branch=&commit=&label=&ci_url=&started_at=`, **streamed to a temp file** (never buffered); exceeding the byte cap returns 413 `TOO_LARGE`.
- [ ] Format detected on the main thread (cheap), then the file is handed to an ingest worker. In one transaction: create the Run row → stream-parse → apply name rules (empty table = verbatim passthrough) → upsert `tests` → upsert `results` (last-write-wins on `(test_id,run_id)`) → append to `uploads_json` → **recompute counters via the analytics module** → set `duration_ms` = sum, `started_at` = min → COMMIT → delete temp file.
- [ ] Errors: unknown/undetectable format → 415 `UNKNOWN_FORMAT`; parse failure rolls back the whole POST → 422 `PARSE_ERROR`.
- [ ] Response 201 `{ run: { id, total, passed, failed, errored, skipped, durationMs, startedAt, uploads:[...] } }`.
- [ ] `shared/api-types.ts` reconciled to ADR-0001: `RunSummary` replaces `format`/`fileName` with an `uploads` array; `ProjectInfo` gains `private`.
- [ ] Boot sweeps stale files from the temp dir.
- [ ] Tests: per-format ingest with counter assertions; 415/422/413 paths; **latency probe** — a generated ~50MB ingest while `GET /api/auth/me` stays <50ms.
