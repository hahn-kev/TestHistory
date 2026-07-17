# 01 — Primary Branch override and auto-detect

**What to build:** A Project can store or clear a Primary Branch override; when unset, Primary Branch is auto-detected from recent Runs (`main` → `master` → `develop`, else most-frequent non-PR branch). API exposes override and resolved branch (or unresolved). Settings UI lets an authorized user set or clear the override. Charts need not change yet — resolve + settings are enough to demo.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] Optional Primary Branch override persists on the Project; empty/cleared means auto-detect
- [x] Auto-detect prefers `main`, then `master`, then `develop` in the health lookback; else most frequent non-`*/merge` branch; else unresolved
- [x] Lookback length matches the health chart Run limit; no sticky snapshot of a past auto pick when override is empty
- [x] Project read API returns override and resolved Primary Branch (or unresolved); write API supports set/clear with existing Project settings authority
- [x] Settings UI can set and clear the override
- [x] Analytics/unit tests cover override wins, conventional-name order, PR-ref exclusion, lookback, and unresolved
