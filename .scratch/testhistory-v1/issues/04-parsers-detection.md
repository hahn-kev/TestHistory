# 04 — Parsers + detection (seam 1)

**What to build:** Given any supported test-result file, the system can identify its format and stream-parse it into one common model of test cases — with no server and no database involved. This is the lowest, highest-value seam: all format-specific quirks are pinned here against real fixtures.

**Blocked by:** 01 — Skeleton & inject harness.

**Status:** ready-for-agent

- [ ] A common model type `{ suite, name, status: passed|failed|error|skipped, durationMs?, message?, stack? }` is defined and shared.
- [ ] `detect(filePath)` reads the first 64KB, finds the first element name, and maps: `testsuites|testsuite`→JUnit, `test-results`→NUnit2, `test-run`→NUnit3, `assemblies|assembly`→xUnit, `TestRun`→TRX. An explicit `format` override wins.
- [ ] Five `saxes`-based streaming parsers (JUnit, NUnit2, NUnit3, xUnit, TRX) emit the common model. Suite/name sourcing per PLAN.md; TRX joins `TestDefinitions`→`Results` by testId (order-independent) and parses `hh:mm:ss.fffffff` durations.
- [ ] Duplicate `(suite, name)` within one file resolves last-write-wins.
- [ ] Fixtures: 2 per format (mixed statuses; edge cases) under the test fixtures dir, plus a `huge-gen.ts` generator for a large file.
- [ ] Tests: a detection table (first-element → format, plus override) and per-fixture snapshots of the emitted model. All pure — no server, no DB.
