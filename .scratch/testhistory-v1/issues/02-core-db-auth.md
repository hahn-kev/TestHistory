# 02 — Core DB + auth

**What to build:** A person can bootstrap a fresh deployment by creating the first account (which becomes admin), log in, stay logged in across active use, change their password, and — as an admin — manage other users' accounts. This establishes `core.db`, the shared migration runner, and the session-cookie auth that gates the rest of the app.

**Blocked by:** 01 — Skeleton & inject harness.

**Status:** ready-for-agent

- [ ] A shared migration runner drives schema via `PRAGMA user_version`; `core.db` opens with the standard pragmas (`WAL`, `synchronous=NORMAL`, `busy_timeout=5000`, `foreign_keys=ON`) and migrates to current on boot.
- [ ] Core schema created: `users`, `sessions` (per PLAN.md).
- [ ] `GET /api/setup` reports whether setup is available; `POST /api/setup` creates the **first** user as `admin` and returns 403 once any user exists.
- [ ] Passwords hashed with argon2id. `POST /api/auth/login` (rate-limited), `POST /api/auth/logout`, `GET /api/auth/me`, `PATCH /api/auth/password` all work.
- [ ] Session cookie `th_session` is httpOnly, SameSite=Lax; the stored session id is the sha256 of the cookie value. Expiry is **sliding**: `expires_at = last_seen + SESSION_TTL_DAYS`, refreshed when >1 day stale.
- [ ] Expired sessions are swept opportunistically — on login and via a daily timer.
- [ ] An `S` (session) guard rejects unauthenticated requests with 401 and is reusable by later route groups.
- [ ] Admin user CRUD (`GET/POST/PATCH /api/admin/users[/:id]`): create with password + role, disable, reset password — all behind an admin-only guard.
- [ ] Tests: setup-once behavior, login/session round-trip, sliding-expiry refresh + sweep, admin-guard enforcement, login rate-limit.
