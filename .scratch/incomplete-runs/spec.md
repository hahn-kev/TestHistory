# Spec: Incomplete Runs — dual trend and CI job outcome

**Status:** ready-for-agent

Honest Project health trend when Appendable Runs from cancelled or partially failed CI leave incomplete Result sets, plus best-effort run-list annotation of CI job trouble. Domain vocabulary in `CONTEXT.md`; decision record in ADR-0003.

## Problem Statement

When CI cancels an in-progress Build (or a job fails while others still upload), TestHistory still receives Uploads into one Appendable Run. Totals on that Run are lower than a full suite. On the Project overview, a single mixed-branch trend chart treats those cliffs like real suite shrinkage, so “project health” looks worse than it is. Viewers cannot tell cancelled/failed upload jobs from ordinary Runs in the run list without opening CI. Mid-pipeline Uploads cannot know sibling jobs’ fate, and we are not asking every pipeline to add a finalize step.

## Solution

Replace the single default trend with two charts on the Project overview: a **health** series scoped to the Project’s **Primary Branch**, and a **recent** series of the last N Runs across all branches (unfiltered ledger). Primary Branch is an optional Project setting with auto-detect when unset. The reusable upload Action reports this CI job’s outcome (`failed` / `cancelled`) on Upload; the Run stores a sticky **CI Job Outcome** for run-list annotation only. Charts do not filter or style on that outcome. Flaky detection and per-test history stay unchanged (absence-as-gap).

## User Stories

1. As a viewer, I want a health trend chart that only includes Runs on the Primary Branch, so that cancelled PR Builds do not look like the mainline suite is shrinking.
2. As a viewer, I want a recent-Runs trend chart of the last N Uploads across all branches, so that I can still see everything that landed.
3. As a viewer, I want both charts visible at once on the Project overview, so that I do not have to toggle modes to compare health vs activity.
4. As a viewer, I want the recent chart to stay unfiltered by CI Job Outcome or Result totals, so that it remains a faithful ledger.
5. As a viewer, I want the health chart not to fall back to “all branches” when Primary Branch cannot be resolved, so that misleading cliffs do not return quietly.
6. As a viewer, I want an empty state on the health chart when no Primary Branch can be resolved, so that I understand why health is missing.
7. As a viewer, I want that empty state to nudge me to set a Primary Branch or upload a mainline Run, so that I know how to fix it.
8. As a viewer, I want to see which branch the health chart is using, so that auto-detect vs override is not a mystery.
9. As a member, I want to set a Primary Branch override on the Project, so that auto-detect cannot pick the wrong mainline.
10. As a member, I want to clear the Primary Branch override, so that auto-detect resumes.
11. As a viewer, I want Primary Branch auto-detect to prefer `main`, then `master`, then `develop` when those appear in the lookback, so that conventional mainlines win without configuration.
12. As a viewer, I want auto-detect to ignore GitHub PR merge refs (`*/merge`) when falling back to frequency, so that a busy PR is not crowned primary.
13. As a viewer, I want auto-detect lookback to match the health chart’s Run limit, so that detect and series stay aligned.
14. As a viewer, I want auto-detect to recompute when override is empty (not freeze an old pick), so that a rename from `master` to `main` is picked up.
15. As a viewer, I want the existing optional branch filter on the overview to keep working for the run list (and any remaining filtered views), so that I can still focus on one branch when browsing.
16. As a viewer, I want Runs in the recent list to show a badge when CI Job Outcome is `cancelled`, so that cancel-in-progress Builds are skimmable.
17. As a viewer, I want Runs in the recent list to show a badge when CI Job Outcome is `failed`, so that failed upload jobs are skimmable.
18. As a viewer, I want Runs with no CI Job Outcome to look unchanged, so that unmarked Builds are not noisy.
19. As a viewer, I want CI Job Outcome badges on the run list only — not as chart markers or exclusions — so that charts stay comparable and the ledger stays complete.
20. As a CI job, I want the upload Action to send this job’s outcome (`failed` / `cancelled`) when known, so that TestHistory can annotate without polling GitHub.
21. As a CI job, I want Uploads without a job outcome to keep working as today, so that older Action versions and raw curl uploads do not break.
22. As a CI job, I want a later Upload on the same Run that reports `cancelled` or `failed` to stick that outcome on the Run, so that a troubled job is not erased by a quieter sibling Upload.
23. As a CI job, I want job outcome to reflect this job only, so that I am not required to add a workflow-level finalize step.
24. As a CI author, I want documentation for how to pass job status into the Action (e.g. from `job.status` / `cancelled()`), so that `if: always()` upload steps can report cancel/fail when they still run.
25. As a viewer, I want Run detail to expose CI Job Outcome when set, so that I can confirm why a badge appeared.
26. As a viewer, I want flaky detection to keep treating absent Tests as gaps, so that incomplete Runs do not invent flips.
27. As a viewer, I want per-test history to keep listing only Runs where the Test appeared, so that incomplete Builds do not fabricate Statuses.
28. As an owner, I want Primary Branch settings gated like other Project identity settings (owner/admin), so that casual members cannot redefine health scope if that matches existing rename/visibility rules — or as a member if Project settings already allow members to edit non-destructive prefs; follow existing Project settings authority for similar fields.
29. As a viewer of FieldWorks-like Projects, I want health on `develop` (or configured primary) while Recent still shows PR cliffs, so that both needs are met without CI changes.
30. As a plugin author, I want any new Run columns needed for CI Job Outcome queryable like other Run fields if they land in the Project DB, so that plugins can filter annotated Runs (read-only, existing allowlist rules).
31. As a deployer, I want existing Projects to keep working with empty Primary Branch override and null CI Job Outcome, so that upgrade is non-breaking.
32. As a viewer, I want dashboard Project sparklines (if present) to follow a clear rule — prefer Primary Branch health semantics or remain “recent activity” — so that the dashboard does not silently disagree with the overview (pick one consistent with current sparkline meaning and document it).
33. As a member, I want API clients to read resolved Primary Branch and both trend series, so that non-UI consumers can build the same health vs recent split.
34. As a CI job using multipart or raw upload outside the Action, I want an optional metadata field for job outcome, so that custom pipelines can annotate without the Action.
35. As a viewer, I want intentional selective/partial suite design left alone by this feature, so that sibling product questions are not conflated with incomplete CI.

## Implementation Decisions

- Follow ADR-0003: dual charts + Action-reported CI Job Outcome; no completeness finalize API; no server-side `ci_url` polling; no count-band chart filters; no chart styling from CI Job Outcome.
- Extend the analytics module (injected Project DB) with Primary Branch resolution: input = optional override + lookback limit; output = resolved branch name or “unresolved.” Auto-detect order: first of `main`, `master`, `develop` present in lookback Runs; else most frequent branch among Runs whose branch is not a PR merge ref (`*/merge`); else unresolved.
- Reuse existing trend aggregation scoped by branch for the health series; recent series = trend with no branch filter (same limit semantics as today’s default trend).
- Persist optional Primary Branch override on the Project (core Project record). Empty/null means auto-detect on read.
- Persist optional CI Job Outcome on the Run in the Project DB. Allowed stored values: unset, `failed`, `cancelled`. On append/create, if an Upload supplies `failed` or `cancelled`, set/stick that trouble outcome (do not clear a trouble outcome because a later Upload omits the field). Exact precedence if both appear across Uploads: first trouble wins, or `cancelled` and `failed` are both “sticky trouble” — pick one deterministic rule and keep it (recommend: once set to either trouble value, do not downgrade to unset; if both appear, prefer `cancelled` over `failed` or preserve first — document the chosen rule in code comments only as needed).
- Upload API accepts optional job-outcome metadata alongside existing Run metadata (query/multipart). Omitted = no change to stored outcome except create leaves unset.
- Reusable GitHub Action gains an optional input defaulting from the job context where practical (e.g. map `job.status` / cancelled into the upload metadata). No new finalize Action or required workflow job.
- Read APIs: Project payload includes override + resolved Primary Branch (or unresolved); trend endpoints support health vs recent (either two endpoints, or one endpoint with a mode, or overview aggregate) — choose the smallest extension of the existing trend contract; runs list/detail include CI Job Outcome for badges.
- Web Project overview: render both charts; health empty-state + nudge; run list badges for `failed`/`cancelled`. Do not mark charts from CI Job Outcome.
- Authority for setting Primary Branch override: match existing Project settings permissions for analogous non-destructive configuration (prefer owner if only owners edit Project identity; allow member if members already edit similar prefs).
- Do not change flaky or history algorithms.
- Glossary terms **Primary Branch** and **CI Job Outcome** are canonical (`CONTEXT.md`).

## Testing Decisions

- Good tests assert external behavior of the seams: given DB rows or ingest inputs, outputs match the locked rules — not UI layout pixels or Action shell wiring beyond the metadata contract.
- **Analytics seam:** unit tests with in-memory Project DB and hand-crafted Runs (prior art: analytics flaky/trend tests). Cover: override wins; `main`/`master`/`develop` preference order; PR merge refs excluded from frequency fallback; lookback limit; unresolved → no fake branch; health series only on resolved branch; recent series includes all branches.
- **Ingest seam:** unit tests calling ingest with optional job outcome (prior art: ingest core tests). Cover: unset create; set on create; sticky trouble on append; omitted field does not clear; raw and multipart metadata acceptance at the route if not fully covered by core.
- **HTTP/read seam (thin):** inject tests for Primary Branch override round-trip and that runs list/trend responses expose the fields the UI needs (prior art: reads / project tests). Prefer not re-testing auto-detect matrices already covered in analytics.
- No requirement for new flaky/history tests beyond a brief regression that behavior is unchanged if cheap.
- Action: optional smoke or contract note; not a second full seam.

## Out of Scope

- Full Run completeness / `run_state` / post-sibling finalize declaration API.
- Server polling or webhooks against GitHub Actions via `ci_url`.
- Annotating or excluding chart points based on CI Job Outcome or Result-count heuristics.
- Redefining flaky detection or per-test history gap semantics.
- Intentional selective/partial suite product design (sibling map `intentional-partial-runs`).
- Compare UX improvements.
- Requiring every CI workflow to change; best-effort Action upgrade only.
- Guaranteeing workflow-wide cancel/fail truth when sibling jobs differ.

## Further Notes

- Motivating producer: FieldWorks Lite on TestHistory — low totals from cancel-in-progress and failed builds with partial Uploads; mainline `develop` stays full-suite in samples.
- Wayfinder lock and research live under `.scratch/partial-runs/` (map + research assets); this spec is the implementation handoff.
- Dashboard sparkline consistency (story 32) should be decided during implementation in favor of the smaller change that avoids contradicting overview health.
