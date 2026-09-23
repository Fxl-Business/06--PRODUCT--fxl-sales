# Verify report - 01-dev-localhost-only

Working tree: `.worktrees/20260923T205647Z-dev-localhost-only`, branch `fix/dev-localhost-only`, one commit `24951f5` on top of `master` (`1bfca9c`). No cd to parent repo, no branch switch, no commit made.

## 1. Diff review (`git diff master...HEAD`)

Files touched: `Makefile`, `apps/api/src/config/listen-host.ts` (new), `apps/api/src/config/__tests__/listen-host.test.ts` (new), `apps/api/src/env.ts`, `apps/api/src/server.ts`, `apps/web/vite.config.ts`, `docker-compose.yml`, `package.json`, `scripts/__tests__/dev-localhost-only.test.mjs` (new), plus the plan record.

Findings, all clean:

- **Production API behaviour unchanged.** `apps/api/Dockerfile` still bakes `ENV NODE_ENV=production` into the runtime stage (line 31, byte-unchanged by this diff). `resolveListenHost` returns `undefined` (runtime default = every interface) whenever `nodeEnv === 'production'` and no `SALES_LISTEN_HOST` override is set, so the container's published port mapping keeps working. `serve({ fetch: app.fetch, port, hostname })` with `hostname: undefined` is the same call shape `@hono/node-server` had before (bare `port`).
- **`server.ts` static-import rule intact.** Confirmed the top-of-file comment and code: only `./env.js` and `./db/local-database-guard.js` are static imports; `resolveListenHost` is pulled in via `const { resolveListenHost } = await import('./config/listen-host.js');` inside the existing dynamic-import block, correctly placed after the guard's `exit(1)` check and after `installFakeAuthIfRequested()`, preserving the documented ordering/binding-name rule. No regression of the ESM-evaluates-the-whole-graph-first hazard the comment warns about.
- **No raw `process.env` in the new module.** `apps/api/src/config/listen-host.ts` is pure: no imports, no I/O, takes `{ nodeEnv, listenHost }` as arguments (matches the `local-database-guard.ts` precedent this repo already follows). `env.ts` reads `SALES_LISTEN_HOST` through the validated zod schema (`emptyToUndefined`), not raw `process.env`, and `server.ts` passes `env.SALES_LISTEN_HOST` in.
- **`make` help awk works under BSD awk.** Verified `awk --version` in this environment reports `awk version 20200816` (macOS's `/usr/bin/awk`, not gawk). Ran `make --no-print-directory` and got correctly grouped, colorized output with every section header (`Development`, `Development without the Hub`, `Staging`, `Setup`, `Build`, `Quality`, `Database`, `Help`, etc.) and every target, `dev-fake`/`back-fake`/`front-fake`/`dev-fake-setup` included. The awk script uses only POSIX-portable constructs (`split`, `sub`, `printf`, no gawk-only extensions), consistent with the passing result.
- **`make dev` still is the interactive selector.** Unchanged target body (`Which app do you want to run? / 1) api / 2) web`, `read choice`, dispatches to `back`/`front`). Only `.DEFAULT_GOAL` moved from `dev` to `help`; `make dev` explicitly still works as before.
- **Vite**: `host: 'localhost'` (was `host: true`), comment explains the loopback rationale and the CORS-origin/Hub-callback equality reasoning. Consistent with `CORS_ORIGIN=http://localhost:8006` and the registered Hub callback.
- **docker-compose.yml**: API port published as `127.0.0.1:3006:3006`, DB port as `127.0.0.1:5006:5432`, `SALES_LISTEN_HOST=0.0.0.0` set inside the API container (required so the published port can reach the process bound loopback-by-default inside the container's own network namespace). Comments correctly explain both sides.
- **package.json**: `test` script gained `scripts/__tests__/dev-localhost-only.test.mjs` in the `node --test` invocation list, alongside the pre-existing guard tests.

No defect found in the diff.

## 2. Named oracles and non-vacuity proof

- `node --test scripts/__tests__/dev-localhost-only.test.mjs` -> **5/5 pass**, exit 0.
- `cd apps/api && npx vitest run src/config/__tests__/listen-host.test.ts` -> **4/4 pass**, exit 0 (~208ms).

Non-vacuity, mutation 1: reverted `apps/web/vite.config.ts` line `host: 'localhost',` -> `host: true,` via `sed`. Re-ran `node --test scripts/__tests__/dev-localhost-only.test.mjs`: **4 pass / 1 fail** (test 1, "the Vite dev server binds localhost, never every interface", went RED). Restored with `git checkout -- apps/web/vite.config.ts`; `git status --short` clean afterward.

Non-vacuity, mutation 2: changed `Makefile`'s `.DEFAULT_GOAL := help` -> `.DEFAULT_GOAL := dev`. Ran the suite in the background with a 5s wait (no `timeout` binary available on this macOS box; used a backgrounded run + `sleep 5` + `cat` instead, which did not hang - `make dev`'s `read choice` hits EOF on a non-interactive stdin and falls to the `*) echo "Invalid choice"; exit 1` branch, so `make` exits 2 quickly). Result: **4 pass / 1 fail** (test 5, "a bare `make` prints every target...", went RED with `make: *** [dev] Error 1` / `2 !== 0`). Restored with `git checkout -- Makefile`; `git status --short` clean afterward.

Both named oracles are proven non-vacuous.

## 3. Full gates (run-once only)

All run from the worktree root, no watch mode, no persistent processes.

| Gate | Command | Result |
| --- | --- | --- |
| Lint | `pnpm run lint` | PASS, exit 0 (`apps/api`, `apps/web` eslint clean; other workspaces no-op) |
| Type-check | `pnpm run type-check` | PASS, exit 0 (`shared-types`, `shared-utils`, `auth-fake`, `apps/web`, `apps/api` all `tsc --noEmit` clean) |
| Test | `pnpm test` | PASS, exit 0. `apps/api` vitest: 56 test files / all passed (`src/config/__tests__/listen-host.test.ts` ran as part of this, 4/4). `apps/web` vitest: 76 test files, 949 tests passed. Root `node --test`: 54/54 passed (`dev-localhost-only.test.mjs` included). `scripts/no-legacy-auth.mjs`, `scripts/no-legacy-env-names.mjs`, `scripts/build-contract.mjs` all ok. |
| Build | `pnpm run build` | PASS, exit 0. `apps/api` `tsc && tsc-alias` clean; `apps/web` `tsc --noEmit && vite build` clean; `assert-web-bundle-clean` confirms the dev-fake sentinel is absent from `apps/web/dist`. |

Known pre-existing issue confirmed present and NOT caused by this slice: `package.json`'s `test` script still names `scripts/__tests__/dev-identity-docs-reconciliation.test.mjs`, which does not exist in this tree (`ls` confirms ENOENT). `node --test` silently proceeded to run the other 54 tests with exit 0 (no visible "Could not find" line surfaced in the captured stdout/stderr this run, but behaviour matches the documented gap: missing spec file, non-zero-test-count run, exit 0). Untouched by this diff.

### Integration tests (`pnpm --filter @fxl-sales/api test:integration`)

This worktree has no `apps/api/.env` (confirmed via `ls apps/api/.env*` - only `.example` files present), and per instructions the parent's `.env` (whose `DATABASE_URL` may point at staging) was deliberately not copied in.

`apps/api/test/rls/setup-env.ts` falls back, in the absence of `TEST_DATABASE_URL`/`DATABASE_URL`, to `postgresql://postgres:postgres@localhost:5006/fxl_sales` - the local Docker Postgres container (`06--product--fxl-sales-db-1`, confirmed running via `docker ps`) - but as the `postgres` superuser rather than the project's dedicated `fxl_sales_test` non-superuser role that RLS tests require.

Result: 5 test files failed, 1 test failed outright, 204 passed, 12 skipped (217 total). Four of the five failing files threw the tests' own guard: `Error: RLS tests must run as a non-superuser, non-BYPASSRLS role; got postgres` (a deliberate self-check in those RLS suites). The fifth failure (`hub-bff-session-store.test.ts`, "is invisible to the ordinary tenant connection") failed because the superuser connection bypasses RLS entirely (`expected 10 to be +0`), which is the direct, expected consequence of running as `postgres` instead of `fxl_sales_test`.

This is an **environment limitation of this worktree** (missing the per-developer `.env` with `TEST_DATABASE_URL` pointed at the `fxl_sales_test` role), not a defect introduced by this slice. Nothing in the diff touches `test/rls/setup-env.ts`, the RLS policies, or database role provisioning, and the failure mode (role-privilege mismatch) is orthogonal to loopback binding / Makefile help. Recorded per the task's explicit allowance for this exact scenario.

## 4. Security

- No secret or credential was added anywhere in the diff (checked the full `git diff master...HEAD` - only listen-host resolution logic, vite/compose config, Makefile help formatting, and tests).
- Nothing binds `0.0.0.0` by default in dev: Vite defaults to `localhost`; the API's `resolveListenHost` defaults to `'localhost'` outside production and only production keeps the runtime default (every interface), which is required for the container port mapping to function and is the pre-existing, unchanged production behaviour. The one `0.0.0.0` value in the diff is `SALES_LISTEN_HOST=0.0.0.0` set explicitly inside the `docker-compose.yml` API service's own environment block - i.e. inside the container's private network namespace, reached only via the loopback-bound host port mapping (`127.0.0.1:3006:3006`) added in the same diff - not a default and not reachable from the LAN.
- `SALES_LISTEN_HOST` (not a bare `HOST`) is the override, as documented in `listen-host.ts`'s own comment explaining the collision hazard with shells exporting `HOST` as the machine name. Confirmed both `env.ts`'s schema key and `docker-compose.yml`'s environment entry use the prefixed name.

## 5. Process cleanup

No dev servers, watchers, or test runners were left running by this verification session. `git status --short` is clean (both mutation-revert steps confirmed). The only long-lived node/vite processes visible via `ps aux` at the end of the run belong to other projects and pre-existing sessions (fxl-finance, segpro, dm-logistica, fxl-os, and one lingering `apps/web/vite.js` under the parent `06--PRODUCT--fxl-sales` checkout, not this worktree) - none were started by this verification run, so none were killed, per the "never sweep processes you did not start" rule.

## Verdict

PASS. No defect found in the slice. All four full-suite gates (lint, type-check, test, build) are green. Both named oracles pass and were proven non-vacuous via two independent mutations, each restored cleanly. The only red flag, the integration-test role mismatch, is a documented environment limitation of a worktree with no `.env`, not a code defect, and is orthogonal to everything this slice touches.

## Orchestrator addendum: integration suite with the local test DB

The verifier's integration run lacked `apps/api/.env`, so it fell back to the superuser.
The orchestrator re-ran it with the main checkout's `.env` copied in (TEST_* URLs confirmed `localhost:5006`), then removed the copy.
Result: `pnpm --filter @fxl-sales/api test:integration` exit 0, 30 files, 217 tests passed.
