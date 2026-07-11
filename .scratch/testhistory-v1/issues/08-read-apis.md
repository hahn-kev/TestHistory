# 08 — Read APIs

**What to build:** Every question a viewer can ask about a Project's stored history is answerable over HTTP: list and inspect Runs and their results, search Tests, view a Test's history, see the trend, and find flaky tests — all reading through the analytics module. A member can also delete a Run to remove garbage uploads.

**Blocked by:** 06 — Ingest core.

**Status:** ready-for-agent

- [ ] Read endpoints (S viewer): `GET .../runs?limit&cursor&branch`, `GET .../runs/:runId`, `GET .../runs/:runId/results?status&search&cursor`, `GET .../trend?limit&branch`, `GET .../tests?search`, `GET .../tests/:testId/history`, `GET .../flaky?window=50&branch=`.
- [ ] Trend, flaky, and test-history are served by the analytics module functions (not re-implemented SQL).
- [ ] Results listing supports status filter, text search, and cursor pagination; run and test listings paginate via cursor.
- [ ] `DELETE .../runs/:runId` (S member) removes the Run; `results` cascade-delete.
- [ ] Responses conform to the shapes in `shared/api-types.ts`.
- [ ] Tests: seed via ingest (multiple single-upload Runs), then assert list/detail/search/pagination; flaky endpoint surfaces a deliberately flipped Test; branch filter scopes trend and flaky; run deletion removes results.
