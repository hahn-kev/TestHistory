# 04 — CI Job Outcome in the upload Action and docs

**What to build:** The reusable upload Action can send CI Job Outcome for this job (optional input, defaulting from job context where practical). Docs explain how to pass outcome from `job.status` / `cancelled()` for `if: always()` upload steps, and how raw curl can set the same metadata. No finalize job; no `ci_url` polling.

**Blocked by:** 03 — CI Job Outcome backend

**Status:** ready-for-agent

- [ ] Action accepts optional job-outcome input and forwards it on upload
- [ ] Sensible default from the job/workflow context where GitHub exposes it (best-effort; success/omit when not in trouble)
- [ ] README / Action docs describe the field, defaults, and curl equivalent
- [ ] Existing workflows that ignore the new input keep uploading successfully
