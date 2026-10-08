# Verify wave 1 (Gate 2, per-wave tier)

Verdict: PASS.

## Target

Worktree: `.worktrees/20261008T114022Z-construbom-leads-ajustes/run`.
Branch `feat/20261008-00-run` at `a146f13`, three slices merged with `--no-ff` onto base `b3ceab7`.
Slices: 01 leads-edition board parity, 02 cliente picker copy, 03 import recognizes existing clientes.
Wave diff (`b3ceab7..HEAD`, excluding `nexo/`): 39 files, 1279 insertions, 137 deletions.
No `package.json`, `pnpm-lock.yaml` or `pnpm-workspace.yaml` changed.
The verifier edited no product code and committed nothing; the worktree status after the run shows only the two pre-existing untracked `nexo/` run directories.

## 1. Build (cold)

`pnpm run build:packages` exited 0.
Deleted every `*.tsbuildinfo` under `apps/` and `packages/` outside `node_modules` (`packages/shared-types/tsconfig.tsbuildinfo`, `packages/shared-utils/tsconfig.tsbuildinfo`); zero remained before the build.
`pnpm run build` exited 0 (shared-types, shared-utils, `apps/api` `tsc && tsc-alias`, `apps/web` `tsc --noEmit && vite build`).
`assert-web-bundle-clean` reported clean: the fake roster sentinel is absent from `apps/web/dist`.
No `error` or `warning` line in the build log.

## 2. Lint

`pnpm run lint` exited 0.
`apps/api` (`eslint src/ scripts/`) and `apps/web` (`eslint src/`) reported zero problems.

## 3. Type-check

`pnpm run type-check` exited 0.
All five packages passed, including `apps/api` main, scripts and test tsconfigs.

## 4. Unit tests and repo guards

`CI=true pnpm test` exited 0.
`packages/auth-fake`: 2 files, 48 tests passed.
`packages/shared-utils`: 6 files, 174 tests passed.
`apps/api`: 100 files, 1482 tests passed.
`apps/web`: 128 files, 1726 tests passed.
Repo guard tests (`node --test`, 11 files, each confirmed present on disk): 91 tests, 91 pass, 0 fail.
`no-legacy-auth.mjs`, `no-legacy-env-names.mjs` and `build-contract.mjs` passed (`build-contract: ok`).
Unit total: 3430 vitest tests plus 91 guard tests, zero failures, zero skipped.
The wave's new or changed oracles all ran green, among them `client-recognition.test.ts` (14), `board-labels.test.ts` (10), `client-picker-copy.test.ts` (2), `import-copy.test.ts` (9), `import-view.test.tsx` (17), `leads-contact-board.test.tsx` (26), `contact-lead-dialog.test.tsx` (25) and `lead-dialog.test.tsx` (11).

## 5. Integration tests

`CI=true pnpm --filter @fxl-sales/api test:integration` exited 0.
51 files, 403 tests passed, in 46.87s.
The DB URLs in the worktree `apps/api/.env` all point at `localhost:5006`, and the test role is `fxl_sales_test`.
The wave's changed integration oracles ran green: `import-routes.integration.test.ts` (13) and `executor.integration.test.ts` (9).

## 6. Security

`pnpm audit --prod --audit-level=high` exited 0.
Advisories: 0 critical, 0 high, 12 moderate, 1 low, 0 info.
They are pre-existing, since the wave changes no manifest or lockfile.
Diff scan of `git diff b3ceab7..HEAD -- . ':!nexo'` (2364 lines):
- em dash U+2014: 0 occurrences anywhere in the diff.
- added `console.log/info/debug/warn/error`: none.
- secret-shaped strings (secret, password, api key, private key, bearer, `sk_`/`pk_`, long token literals): none.
- raw SQL (`sql.raw`, `sql` template, `.execute(`, SQL keywords): none; the import change is pure in-memory logic (`client-recognition.ts`, `refs.ts`, `plan/cadastros.ts`).
- web diff: no `dangerouslySetInnerHTML`, `innerHTML`, `eval`, raw `existingId`/account/org id rendering, or storage writes.

## 7. Reruns and pre-existing failures

No test failed or timed out, so no rerun and no base-checkout comparison were needed.

## Observations (not failures)

The web suite prints pre-existing stderr noise from files this wave did not touch: React Router v7 future-flag warnings and "The current testing environment is not configured to support act(...)" in `leads-list-view.test.tsx` (34), `leads-board-dropzones.test.tsx` (19), `leads-board-columns.test.tsx` (16) and `dev-identity-roles.test.tsx` (16).
The `apps/api` stderr `Error: fake db reached` in `import-routes.test.ts` is the test's own intentional sentinel.
