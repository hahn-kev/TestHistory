# Test identity is verbatim by default; opt-in Name Rules rewrite it at ingest only

A Test is identified by `(suite, name)`. Parameterized/property-based frameworks can embed volatile values in names, minting new Tests every run and fragmenting history. We deliberately ship **no default normalization heuristic** — stripping `[...]`/`(...)` would silently merge legitimately distinct parameterized tests (e.g. a browser matrix), and identity corruption is invisible, whereas fragmentation is visible and prompts the user to act. Instead, each project has an ordered, opt-in list of **Name Rules** (regex over `suite::name` → replacement) applied **at ingest, before the tests upsert**, with a preview UI against recent names.

## Considered options

- **Read-time grouping** (identity stays raw, rules create views) — rejected: every query (history, flaky, search) would need group resolution.
- **Retroactive merge when a rule is added** — deferred, not rejected: collapsing existing `tests` rows means re-pointing `results` with same-run collision resolution. v1 applies rules to new Uploads only and says so in the UI; retro-merge can ship later as an explicit action.

## Consequences

- Identity is baked at write time; changing a rule never rewrites history, so a project's timeline can contain a visible "seam" where a rule took effect.
- The raw incoming name is not stored once rewritten.
