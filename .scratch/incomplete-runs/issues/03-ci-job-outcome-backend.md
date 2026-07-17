# 03 — CI Job Outcome backend

**What to build:** Uploads may optionally report this CI job’s outcome (`failed` / `cancelled`). The Run stores a sticky CI Job Outcome. Runs list and Run detail expose it; the Project overview run list and Run detail show badges for `failed` and `cancelled`. Charts do not filter or style on outcome. Verifiable with curl/API without Action changes; older clients that omit the field keep working.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] Optional job-outcome metadata accepted on upload (query and multipart) alongside existing Run metadata
- [x] Create leaves outcome unset when omitted; `failed`/`cancelled` stick on the Run; later omitted Uploads do not clear a trouble outcome; deterministic rule if both trouble values appear across Uploads
- [x] Runs list and Run detail API include CI Job Outcome
- [x] Overview run list and Run detail UI show badges for `failed` and `cancelled` only; no chart markers or exclusions
- [x] Ingest (and thin route) tests cover unset, set, sticky append, and omit-does-not-clear
- [x] Plugin-visible schema (if any new column) remains read-only under existing allowlist rules
