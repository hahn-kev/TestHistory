# 11 — Project data views

**What to build:** A viewer can explore a Project's history visually: an overview with a stacked pass/fail/skip trend chart and recent Runs (filterable by branch), a Run detail page showing metadata, per-Upload breakdown, and a searchable results table with expandable failure messages/stacks, a per-Test page with a status timeline and duration chart, and a flaky-tests page. This turns the read APIs into the product's actual UI.

**Blocked by:** 08 — Read APIs; 10 — Web shell.

**Status:** ready-for-agent

- [ ] `/projects/:id` overview: Recharts stacked pass/fail/skip trend over recent Runs, recent-Runs list, and a branch filter that scopes the view.
- [ ] `/projects/:id/runs/:runId`: metadata header including the per-Upload breakdown ("N uploads · files · durations"); results table with status chips, status filter, text search, and expandable message/stack.
- [ ] `/projects/:id/tests/:testId`: status-cell timeline across Runs plus a duration chart; links from results tables.
- [ ] `/projects/:id/flaky`: flaky-tests list reusing the same branch-filter component as the overview.
- [ ] Test-name search reachable from the Project.
- [ ] Empty/loading/error states render sensibly (no runs yet, search with no matches, API error surfaced from the client).
