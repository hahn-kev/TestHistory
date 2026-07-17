# 02 — Dual health and recent trend on Project overview

**What to build:** The Project overview shows two charts at once: a **health** trend scoped to the resolved Primary Branch, and an unfiltered **recent** trend of the last N Runs across all branches. Health shows an empty state and nudge when Primary Branch is unresolved (no all-branches fallback). Viewers can see which branch health is using. The run-list branch filter keeps working. Dashboard sparkline uses the smallest change that does not contradict overview health.

**Blocked by:** 01 — Primary Branch override and auto-detect

**Status:** ready-for-agent

- [ ] Overview renders health and recent charts together (not a mode toggle)
- [ ] Health series includes only Runs on the resolved Primary Branch; recent series is unfiltered by branch and by CI Job Outcome
- [ ] When Primary Branch is unresolved, health shows empty state + nudge (no silent all-branches fallback)
- [ ] UI indicates which branch the health chart uses (auto-detected or override)
- [ ] Existing branch filter still scopes the recent-runs list (and any other filtered list views as today)
- [ ] Dashboard sparkline behavior is explicitly either primary-branch health or recent activity, chosen for minimal contradiction with overview
- [ ] Thin HTTP/read tests cover the dual-series contract; auto-detect matrices stay in ticket 01’s analytics tests
