# 13 — Plugin host UI + docs + demo

**What to build:** A viewer can open a plugin and see it render inside a sandboxed iframe, with the plugin talking to the Project database only through the audited postMessage bridge. A plugin author has documentation and a small helper to build against. This is the browser-facing half of the plugin feature on top of the backend query engine.

**Blocked by:** 11 — Project data views; 12 — Plugin query engine + serving.

**Status:** ready-for-agent

- [ ] `/projects/:id/plugins/:pluginId` hosts a `PluginHost` that fetches a signed URL and points an `iframe` at it with `sandbox="allow-scripts"` (no `allow-same-origin`) — so the plugin runs with an opaque origin.
- [ ] The host implements the bridge from `shared/plugin-protocol.ts`: sends `th-init` (apiVersion, project, active theme vars); accepts `th-query` only when `e.source === iframe.contentWindow`; relays to `plugin-query`; returns `th-result`; throttles to max 4 in-flight.
- [ ] Active theme colors are forwarded to the plugin via `th-init` so its view matches the surrounding UI.
- [ ] `docs/plugin-api.md` documents the protocol and includes a ~20-line `TH.query()` helper snippet and an example plugin.
- [ ] A demo plugin (self-contained HTML) renders real data through the bridge when uploaded to a Project.
- [ ] Query errors from the backend (`FORBIDDEN_STATEMENT`, `TIMEOUT`, `RESULT_TOO_LARGE`, `RATE_LIMITED`) surface to the plugin as structured `th-result` errors.
