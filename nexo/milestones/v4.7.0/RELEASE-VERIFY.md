# Release verify v4.7.0 (Gate 2 at the release boundary)

Verdict: PASS.

Target: detached clean checkout `.worktrees/release-v4.7.0` at `91a429c919603e42a3c6aaa6abbb7e134b139d34` (`v4.6.0-16-g91a429c`).
Baseline: `v4.6.0` at `7d468e4`.
Toolchain: Node v22.22.3, pnpm 10.17.1.
Verifier: independent RELEASE-VERIFY sub-agent, no product edits, no commits, no tags, no pushes.
The worktree had no `dist/` or `*.tsbuildinfo` before check 1, and `git status --short` was empty before and after the run.

## 1. Deploy-shaped web build

Command: `rm -rf packages/*/dist packages/*/tsconfig.tsbuildinfo apps/web/dist && pnpm --filter @fxl-sales/web build`.
Exit code: 0.
The web build rebuilt `shared-types` and `shared-utils` itself through `pnpm --filter @fxl-sales/web^... build` (`tsc --build --force`), then ran `tsc --noEmit` and `vite build` (1889 modules transformed).
Command: `node scripts/assert-web-bundle-clean.mjs`.
Exit code: 0.
Output: `clean: FXL_SALES_DEV_FAKE_ROSTER_SENTINEL is absent from apps/web/dist and still present under packages/auth-fake/src.`

## 2. Deploy-shaped API build

Command: `rm -rf packages/*/dist packages/*/tsconfig.tsbuildinfo apps/api/dist && pnpm run build:packages && pnpm --filter @fxl-sales/api build`.
Exit codes: `build:packages` 0, API build (`tsc && tsc-alias`) 0.
`apps/api/dist/server.js` is present.

## 3. Cold full build

Deleted before the build (every `dist/` and `*.tsbuildinfo` under apps and packages, node_modules pruned): `apps/web/dist`, `apps/api/dist`, `packages/shared-types/dist`, `packages/shared-types/tsconfig.tsbuildinfo`, `packages/shared-utils/dist`, `packages/shared-utils/tsconfig.tsbuildinfo`.
A second `find` confirmed none remained.
Command: `pnpm run build`.
Exit code: 0.
It ran `build:packages`, the API build, the web build and `assert-web-bundle-clean.mjs` (clean).

## 4. Lint

Command: `pnpm run lint`.
Exit code: 0.
`apps/api` and `apps/web` ran eslint and reported Done with zero warnings and zero errors in the log.
The three packages have no lint script by design (`no lint for ...`).

## 5. Type-check

Command: `pnpm run type-check`.
Exit code: 0.
Covered `shared-types`, `shared-utils`, `auth-fake`, `apps/web` (`tsc --noEmit`) and `apps/api` (`tsc --noEmit` on the main, scripts and test tsconfigs).

## 6. Unit suite

Command: `CI=true pnpm test`.
Exit code: 0.
`packages/auth-fake`: 2 files, 48 tests passed.
`packages/shared-utils`: 6 files, 174 tests passed.
`apps/api`: 100 files, 1482 tests passed.
`apps/web`: 128 files, 1731 tests passed.
Vitest total: 236 files, 3435 tests passed, 0 failed, 0 skipped.
Node guard tests: 91 tests, 91 pass, 0 fail, 0 skipped, 0 todo.
Each of the 11 guard files exists and was also run alone with a non-zero count: no-legacy-auth 3, no-legacy-env-names 8, local-database-guard 17, auth-fake-isolation 21, dev-identity-docs-reconciliation 5, dev-localhost-only 6, api-test-typecheck 3, fxl-contracts-pin 4, hub-sdk-pin 6, integration-env-docs 11, api-dockerfile-workspace-deps 7 (sum 91).
`node scripts/no-legacy-auth.mjs` exit 0, `node scripts/no-legacy-env-names.mjs` exit 0, `node scripts/build-contract.mjs` exit 0 (`build-contract: ok`).
The release oracles ran with non-zero counts, among them `client-recognition.test.ts` (14), `refs.test.ts` (23), `cadastros.test.ts` (46), `template.test.ts` (16), `leads-contact-board.test.tsx` (27), `contact-lead-dialog.test.tsx` (26), `lead-dialog.test.tsx` (13), `board-labels.test.ts` (10), `client-picker-copy.test.ts` (2), `combobox.test.tsx` (31), `import-view.test.tsx` (17), `import-copy.test.ts` (9) and `issues.test.ts` (5).

## 7. API integration suite

Database: local Docker Postgres on `localhost:5006` (container healthy), `TEST_DATABASE_URL` uses the `fxl_sales_test` role and `ADMIN_DATABASE_URL` is local.
Command: `CI=true pnpm --filter @fxl-sales/api test:integration`.
Exit code: 0.
Counts: 51 files, 403 tests passed, 0 failed, 0 skipped, duration 51.50s.
The release oracles `import-routes.integration.test.ts` (13), `executor.integration.test.ts` (9) and `catalog.integration.test.ts` (6) ran, as did every leads RLS suite.

## 8. Security

Command: `pnpm audit --prod --audit-level=high`.
Exit code: 0.
Result: 0 critical, 0 high, 12 moderate, 1 low.
Moderate: `uuid` via `exceljs` (1), `react-router` via `react-router-dom` (2), `react-router-dom` (1), `@hono/node-server` (1), `hono` (7).
Low: `hono` Proxy Helper `Connection` header (1).
All of them are pre-existing, because the release changes no manifest and no lockfile.
Diff scope (`git diff v4.6.0..HEAD`): 16 commits, product changes only under `apps/api/src`, `apps/web/src` and `CLAUDE.md`, plus `nexo/` records.
No `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.env*`, `Dockerfile`, Vercel config, migration, drizzle or Makefile path changed.
`git diff v4.6.0..HEAD -- . ':!nexo'`: 42 files, 1448 insertions, 161 deletions.
Em dash U+2014 in added lines: 0, and 0 in any changed file at HEAD.
Secret or token patterns (api key, secret, password, token, bearer, private key, AWS and GitHub key shapes, JWT prefix) in added lines: 0.
New logging statements in added lines: 0 (the only grep hits were `richCatalog` and `renderDialog` identifiers).
Raw SQL in added lines (`sql.raw`, `sql` template, `.execute(`, SELECT, INSERT, UPDATE, DELETE): 0.
The new API code (`client-recognition.ts`, `refs.ts`, `plan/cadastros.ts`, `executor.ts`, `routes.ts`, `template.ts`) is pure planning over the catalog already read inside `withTenant`, adds a `recognized` count to the preview, commit and audit bodies, and stays behind the existing `requireAdmin` import routes.

## 9. Reruns and pre-existing failures

No test failed or timed out in any suite, so no rerun was needed and no `v4.6.0` comparison worktree was created.

## Processes

Every command ran in the foreground and in run-once mode, and no process started by this agent is left running.
