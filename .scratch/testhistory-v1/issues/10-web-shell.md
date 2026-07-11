# 10 — Web shell: auth + theming + dashboard

**What to build:** A person can open the app in a browser, be routed to login (or first-run setup), sign in, and land on a themed dashboard listing the Projects they can see. The theme system (several professional light/dark variants) is in place with no flash of the wrong theme. This is the frontend foundation every later page builds on.

**Blocked by:** 03 — Projects, members, tokens, DbManager.

**Status:** ready-for-agent

- [ ] React Router app with a loader that hits `GET /api/auth/me`; 401 redirects to `/login`.
- [ ] `/login` and `/setup` (first-user) pages work against the auth API; successful login lands on the dashboard.
- [ ] A typed API client wraps `/api` calls and surfaces `{ error: { code, message } }` uniformly.
- [ ] Theming: Tailwind v4 `@theme inline` mapping utilities to `var(--th-*)`; theme sets under `[data-theme=...]` for at least light, dark, dark-violet, light-emerald; a switcher sets `documentElement.dataset.theme` + localStorage; an inline pre-paint script in `index.html` prevents flash. Semantic pass/fail/skip color tokens exist.
- [ ] `/` dashboard lists accessible Projects as cards (public + own memberships; private badge where applicable), each linking to its overview.
- [ ] An app shell (nav, theme switcher, current-user menu, logout) frames authenticated routes; manage-only affordances are hidden for non-members.
