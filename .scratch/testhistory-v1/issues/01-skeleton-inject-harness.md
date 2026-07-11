# 01 — Skeleton & inject harness

**What to build:** The empty workspace becomes a runnable full-stack skeleton. A developer can `npm run dev` and get a Fastify server answering `GET /api/health` plus a Vite React app that proxies `/api` to it. A first `app.inject()` test passes, establishing the primary integration seam for everything that follows.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [x] `npm install` at the root wires the three workspaces (`shared`, `server`, `web`) together; `shared` is importable from `server` and `web`.
- [x] `server` exposes a `buildApp(config)` factory returning a configured Fastify instance (not a started listener), plus an entrypoint that starts it. `GET /api/health` returns `200 {ok:true}`.
- [x] `web` is a Vite + React 18 app that builds, with its dev server proxying `/api/*` to the server.
- [x] `npm run dev` starts both server and web together.
- [x] A vitest test uses `app.inject()` against the health route and passes — the reusable pattern (build app with a temp `DATA_DIR`, inject, assert) is in place.
- [x] `tsconfig.base.json` is honored across workspaces; `npm run build` and typecheck succeed with no errors.
