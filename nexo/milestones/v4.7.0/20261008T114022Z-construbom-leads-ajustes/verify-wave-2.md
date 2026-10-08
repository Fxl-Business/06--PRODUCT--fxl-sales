# Verify wave 2 (Gate 2, per-wave tier, integrates waves 2 and 3)

Verdict: PASS.

## Target

Worktree: `.worktrees/20261008T114022Z-construbom-leads-ajustes/run`.
Branch `feat/20261008-00-run` at `55d8adf`.
Last green full verify: `a146f13` (wave 1).
Merged since then: `67bed52` (slice 04, leads card Cliente line full width, Combobox single divider, lead dialog free-item button) and `55d8adf` (slice 05, `self-stretch` on inline dialog buttons).
Waves 2 and 3 diff (`a146f13..HEAD`, excluding `nexo/`): 8 files, 168 insertions, 38 deletions, all in `apps/web`.
Whole run diff (`b3ceab7..HEAD`, excluding `nexo/`): 41 files, 1430 insertions, 158 deletions.
No `package.json`, `pnpm-lock.yaml` or `pnpm-workspace.yaml` changed.
The verifier edited no product code and committed nothing; the worktree status after the run shows only the two pre-existing untracked `nexo/` directories.

## 1. Build (cold)

`pnpm run build:packages` exited 0.
Deleted every `*.tsbuildinfo` under `apps/` and `packages/` outside `node_modules` (`packages/shared-types/tsconfig.tsbuildinfo`, `packages/shared-utils/tsconfig.tsbuildinfo`); zero remained before the build.
`pnpm run build` exited 0 (shared-types, shared-utils, `apps/api`, `apps/web` `tsc --noEmit && vite build`).
`assert-web-bundle-clean` reported clean: the fake roster sentinel is absent from `apps/web/dist`.
No `error` or `warning` line in the build log.

## 2. Lint

`pnpm run lint` exited 0.
`apps/api` (`eslint src/ scripts/`) and `apps/web` (`eslint src/`) reported zero problems.

## 3. Type-check

`pnpm run type-check` exited 0.
All five packages passed, including the `apps/api` main, scripts and test tsconfigs.

## 4. Unit tests and repo guards

`CI=true pnpm test` exited 0.
`packages/auth-fake`: 2 files, 48 tests passed.
`packages/shared-utils`: 6 files, 174 tests passed.
`apps/api`: 100 files, 1482 tests passed.
`apps/web`: 128 files, 1731 tests passed (wave 1 had 1726; the five new tests are the waves 2 and 3 oracles).
Repo guard tests (`node --test`, 11 files, each confirmed present on disk): 91 tests, 91 pass, 0 fail, 0 skipped.
`no-legacy-auth.mjs`, `no-legacy-env-names.mjs` and `build-contract.mjs` passed (`build-contract: ok`).
Unit total: 3435 vitest tests plus 91 guard tests, zero failures, zero skipped.
The changed oracles all ran green: `combobox.test.tsx` (31), `contact-lead-dialog.test.tsx` (26), `leads-contact-board.test.tsx` (27) and `lead-dialog.test.tsx` (13).

## 5. Integration tests

`CI=true pnpm --filter @fxl-sales/api test:integration` exited 0.
51 files, 403 tests passed, in 59.36s.
The DB URLs in the worktree `apps/api/.env` all point at `localhost:5006`, and the test role is `fxl_sales_test`.
The count matches wave 1, as expected for web-only waves; the wave 1 import oracles still pass (`import-routes.integration.test.ts` 13).

## 6. Security

`pnpm audit --prod --audit-level=high` exited 0.
Advisories: 0 critical, 0 high, 12 moderate, 1 low, 0 info.
They are pre-existing, since the run changes no manifest or lockfile, and they match wave 1 exactly.
Diff scan of `git diff b3ceab7..HEAD -- . ':!nexo'` (2602 lines, 1430 added lines):
- em dash U+2014: 0 occurrences, counted with node; a positive control string counted 1.
- added `console.log/info/debug/warn/error`: none.
- secret-shaped strings (secret, password, api key, private key, bearer, `sk_`/`pk_`, long token literals): none.
- raw SQL (`sql.raw`, `sql` template, `.execute(`, interpolated SQL keywords): none.
- web diff: no `dangerouslySetInnerHTML`, `innerHTML`, `eval`, or storage writes.
The waves 2 and 3 changes are className and conditional-render changes in `combobox.tsx`, `LeadCard.tsx`, `LeadDialog.tsx` and `ContactLeadDialog.tsx`, plus their tests.

## 7. Reruns and pre-existing failures

No test failed or timed out, so no rerun and no base-checkout comparison were needed.

## Observations (not failures)

The web suite prints the same pre-existing stderr noise as wave 1 (React Router v7 future-flag warnings and act() environment warnings) from files these waves did not touch.
