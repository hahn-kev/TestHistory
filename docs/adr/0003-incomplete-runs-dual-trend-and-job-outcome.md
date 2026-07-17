# Dual trend charts and best-effort CI job outcome, not completeness declaration

Incomplete CI Builds (cancel-in-progress or a failed job that still uploads under `if: always()`) produce Appendable Runs whose Result totals cliff on a mixed-branch trend, while mid-pipeline Uploads cannot know sibling fate. We lock product behavior around **honest trend without requiring CI finalize**: the Project overview shows a **primary-branch health** series beside an **unfiltered recent** series; primary branch is an optional Project override else auto-detected (`main` → `master` → `develop`, else most-frequent non-PR ref in the health lookback). Run-list annotation of CI trouble is **best-effort from the upload Action** using **this job’s** `failure` / `cancelled` (sticky on the Run) — not workflow-wide truth, not `ci_url` polling, and not a post-sibling finalize / `run_state` completeness API. Flaky detection and per-test history stay absence-as-gap.

## Considered options

- **Do nothing** on trend — rejected: FieldWorks Lite shows the cliffs are real and misleading for “project health.”
- **Full completeness declaration** (finalize job + `run_state`) — researched as the strongest signal for multi-job append, rejected for this effort: requires producer YAML and API changes CI authors may not adopt; dual charts fix the primary pain without them.
- **Server poll of GitHub Actions via `ci_url`** — viable for public cancelled runs, rejected: auth/rate-limit ops, and the chosen Action job-status path covers the annotate case we care about.
- **Hide/filter by low test-count heuristics** — rejected: brittle under suite growth; conflates incomplete with intentional partial (sibling map).
- **Annotate or exclude cancelled on charts** — rejected: health honesty comes from primary-branch scoping; Recent stays an unfiltered ledger.

## Consequences

- Health chart empty-state when no primary branch can be resolved (no all-branches fallback).
- Runs that finish every Upload before cancel may never get a cancelled badge — accepted.
- Sibling-only failures (other job failed, this upload’s job succeeded) may stay unmarked — accepted.
- Intentional selective/partial suites remain a separate effort (`intentional-partial-runs`).
