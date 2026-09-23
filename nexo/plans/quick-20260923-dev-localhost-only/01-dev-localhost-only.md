---
slice: 01-dev-localhost-only
flow: quick
milestone: v4.1.0
run: 20260923T205647Z-dev-localhost-only
files_modified:
  - apps/web/vite.config.ts
  - apps/api/src/env.ts
  - apps/api/src/server.ts
  - apps/api/src/config/listen-host.ts
  - apps/api/src/config/__tests__/listen-host.test.ts
  - docker-compose.yml
  - Makefile
  - package.json
  - scripts/__tests__/dev-localhost-only.test.mjs
---

# Local development is reachable from this machine only

## Intent

The Vite dev server ran with `host: true`, the API bound every interface, and compose published 3006 and 5006 on every interface.
Anyone on the same Wi-Fi, the tailnet or a Docker network could reach the app, and under `make dev-fake` enter it as `team-owner` with no login.
The human never tests on another device and wants everything local-only by default.
A bare `make` should list every target, the development-identity ones included, instead of opening the interactive selector.

## Acceptance

- Vite binds `localhost` (never `true` / `0.0.0.0`), so the origin stays equal to `CORS_ORIGIN` and the Hub callback.
- The API binds `localhost` outside production; production keeps the runtime default (every interface) so the container port mapping works. `SALES_LISTEN_HOST` overrides both; compose sets it to `0.0.0.0` inside the container.
- Every compose-published port is `127.0.0.1:`-prefixed.
- A bare `make` prints every `##`-documented target grouped by its `# --- Section ---` header; `make dev` keeps the interactive selector.

## Oracles

- `scripts/__tests__/dev-localhost-only.test.mjs` (wired into `pnpm test`).
- `apps/api/src/config/__tests__/listen-host.test.ts`.
- E2E: API and web booted on alternate ports listen on `[::1]` only, the LAN address refuses the connection, and `/auth/*` still proxies to the API.
