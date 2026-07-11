# 15 — Docker + full smoke + README

**What to build:** The whole service ships as a single Docker container with one data volume, survives container recreation, and is verified end-to-end by a smoke script that walks the real user journey with `curl`. The README documents operation, including the storage-growth math (since v1 has no automatic retention).

**Blocked by:** 07 — Append semantics + multipart; 13 — Plugin host UI + docs + demo; 14 — Settings & admin UI.

**Status:** ready-for-agent

- [ ] Multi-stage `node:22-bookworm-slim` image: build workspaces → prod-deps-only layer (`npm ci --omit=dev`) → runtime as a non-root user, `VOLUME /data`, healthcheck on `/api/health`.
- [ ] `docker-compose.yml` runs the container with a mounted volume. `SESSION_SECRET` honored; auto-generated into `/data/secret` on first boot if unset. Data layout `/data/{core.db, projects/, plugins/, tmp/}` on one filesystem (atomic rename).
- [ ] `scripts/smoke.sh` against a running container: setup → login → create Project + token → curl upload fixture → assert 201 counts → **second upload with same `run_key` → same Run id, merged counts** → third Run with a flipped Test → flaky endpoint contains it → history shows the Runs → plugin-query `SELECT COUNT(*)` works and a `DELETE` is rejected.
- [ ] Restart persistence verified: recreate the container against the same volume; data and login survive.
- [ ] README covers configuration (all env knobs), deployment, the plugin model, and storage-growth math with a note that there is no automatic retention in v1.
