# 09 — Name Rules management

**What to build:** A member of a Project whose framework embeds volatile values in test names (parameterized/property-based tests) can define an ordered list of regex rewrite rules that normalize names at ingest, and preview the effect against recent real test names before saving — so history stops fragmenting into thousands of one-off Tests. Rules affect new Uploads only (ADR-0002).

**Blocked by:** 06 — Ingest core.

**Status:** ready-for-agent

- [ ] `GET /api/projects/:id/name-rules` (S member) returns the ordered rule list; `PUT` replaces it wholesale (each rule = `{ match, rewrite }`, evaluated in order against `suite::name`, result re-split on `::`).
- [ ] `POST /api/projects/:id/name-rules/preview` (S member) takes a candidate rule set and returns a sample of recent distinct test names with before/after, without persisting.
- [ ] Invalid regex in a rule is rejected with a clear validation error (both on PUT and preview).
- [ ] The ingest worker already applies whatever rules are stored (from ticket 06); this ticket confirms end-to-end that a saved rule changes the identity of subsequently uploaded Tests, and does **not** retroactively merge existing Tests.
- [ ] Tests: rule application at ingest (a volatile name collapses to a stable identity for new uploads); bad-regex rejection; preview before/after; existing Tests unchanged after a rule is added.
