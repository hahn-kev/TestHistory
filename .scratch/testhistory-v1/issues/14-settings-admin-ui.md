# 14 — Settings & admin UI

**What to build:** The management surfaces get their UI. A member/owner can manage a Project from a settings page with tabs for tokens (with a show-once secret modal), plugins, members, name rules (with the live before/after preview), and a danger zone including the privacy toggle and project deletion. An admin gets a users page to create/disable/reset accounts.

**Blocked by:** 09 — Name Rules management; 11 — Project data views; 12 — Plugin query engine + serving.

**Status:** ready-for-agent

- [ ] `/projects/:id/settings` with tabs:
  - **Tokens** — list, create (show-once plaintext modal), revoke.
  - **Plugins** — list, upload/replace/delete, link to the plugin host.
  - **Members** — list, add/remove, set role (owner only).
  - **Name Rules** — ordered editable list with a live preview against recent test names (uses the preview endpoint).
  - **Danger** — privacy toggle, rename/description, delete Project (owner only).
- [ ] Tabs and actions respect the access model: members see day-to-day tabs; owner-only controls (members, privacy, rename, delete) are gated; non-members don't reach settings.
- [ ] `/admin/users` (admin only): list users, create with password+role, disable, reset password.
- [ ] Actions surface API errors inline; destructive actions confirm first.
