# 03 — Projects, members, tokens, DbManager

**What to build:** A signed-in user can create a Project (becoming its owner), and the per-Project SQLite database springs into existence on demand with its full schema. Projects are public to all signed-in users by default with a `private` toggle; owners manage membership; members mint and revoke bearer tokens for CI. This establishes the access model (viewer/member/owner + admin) and the `DbManager` that every data route will lean on.

**Blocked by:** 02 — Core DB + auth.

**Status:** ready-for-agent

- [ ] Core schema extended: `projects` (incl. `private`), `project_members`, `api_tokens`.
- [ ] `DbManager` lazily creates and migrates a Project DB on first access, caches handles in an LRU (cap ~64), and re-checks migrations on every fresh open. Opening a Project applies the **full per-Project schema** (`runs`, `tests`, `results`, `name_rules`) at the correct `user_version` even though those tables stay empty for now.
- [ ] Project CRUD: `GET /api/projects` (public + own memberships; admin sees all), `POST` (any user → creator becomes owner; accepts `private`), `GET /:id` (viewer), `PATCH` (owner; name/description/`private`), `DELETE` (owner; removes DB + plugin files).
- [ ] Access levels enforced: **viewer** (read; any signed-in user unless private, then member/admin), **member** (writes), **owner** (rename/privacy/members/delete); admin is an implicit owner everywhere. Non-viewers receive **404** (not 403) on project routes.
- [ ] Members CRUD (`GET/POST/DELETE /api/projects/:id/members[/:userId]`) — owner only.
- [ ] Token CRUD (`GET/POST/DELETE /api/projects/:id/tokens[/:tokenId]`) — member: plaintext (`tht_…`) shown exactly once on create; list shows prefix/name/created/last-used; delete is a soft revoke.
- [ ] A `B` (bearer) guard resolves a token to its Project and updates `last_used_at`; revoked tokens are rejected.
- [ ] Tests: visibility matrix (non-member vs private → 404; owner-only PATCH; member-vs-owner write split), token round-trip, and a created Project's DB file appears with the correct `user_version`.
