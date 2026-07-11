# Runs are appendable via run keys, with a fixed window and hard 409 on expiry

A CI build often produces many result files (one TRX per .NET test project, one JUnit file per shard). Modeling each file as its own Run made trend charts noisy and diluted the flaky-detection window, so a Run is instead *the build*: it accepts multiple Uploads — several files in one multipart POST, or separate POSTs correlated by a client-supplied **run key** — for a fixed window (default 1h, `RUN_APPEND_WINDOW_MS`) anchored at the Run's creation. Per-upload facts (file name, size, format, duration) live in `uploads_json`; counters are recomputed from `results` on every append so a retried upload cannot double-count.

## Considered options

- **Run-group entity / group id column on separate runs** — rejected: the group becomes the real unit of analysis, so trend, flaky, run list, and run detail would all have to aggregate it; a shadow entity with the full cost of the entity.
- **Sliding window** (from latest upload) — rejected: a trickle of uploads keeps a run open indefinitely.
- **Silently starting a new Run when a key's window has closed** — rejected in favor of **409 RUN_KEY_EXPIRED**.

## Consequences

- Run keys must be fresh per build (a CI build id, not a bare commit SHA); a reused key 409s forever. The error message and API docs state this explicitly.
- `run_key` has no uniqueness constraint; append-target lookup is "newest run with this key".
- After the window a Run is immutable; a very late shard fails loudly rather than joining or forking its build.
