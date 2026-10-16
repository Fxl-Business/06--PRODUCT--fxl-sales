# Release verify v4.7.1 (Gate 2 at the release boundary)

Verdict: PASS.

Target: detached clean checkout `.worktrees/release-v4.7.1` at `be1ffa9b79735e0a6255c5ddaa6a0791e8f6aee6`.
Baseline: `v4.7.0` at `dac953a`.
Toolchain: Node v22.22.3, pnpm 10.17.1.
Verifier: independent RELEASE-VERIFY sub-agent, no product edits, no commits, no tags, no pushes.
The worktree had a clean `git status --short` and no `dist/` or `*.tsbuildinfo` before the run, and it was clean again before removal.
`pnpm install --frozen-lockfile --prefer-offline`: exit 0.

Diff scope (`git diff --name-only v4.7.0..be1ffa9 -- . ':!nexo'`): 13 files, all under `apps/web/src/sales-ops/**` plus `CLAUDE.md`.
No migration, `package.json`, lockfile, workspace, env, Dockerfile or vercel.json path changed (confirmed by grep over the full name list).

## 1. Deploy-shaped web build

Command: `rm -rf packages/*/dist packages/*/tsconfig.tsbuildinfo apps/web/dist && pnpm --filter @fxl-sales/web build`.
Exit code: 0.
Command: `node scripts/assert-web-bundle-clean.mjs`.
Exit code: 0 (clean: sentinel absent from apps/web/dist).
Built CSS utility counts (grep -o): `container-type:inline-size` 1, `100cqw` 2, `scrollbar-gutter:stable` 1, `pointer:coarse` 1, `touch-action:manipulation` 1, `min-height:440px` 1.

## 2. Deploy-shaped API build

Command: `rm -rf packages/*/dist packages/*/tsconfig.tsbuildinfo apps/api/dist && pnpm run build:packages && pnpm --filter @fxl-sales/api build`.
Exit code: 0.
`apps/api/dist/server.js` is present.

## 3. Cold full build

Every `dist/` and `*.tsbuildinfo` under apps and packages was deleted and a second `find` confirmed 0 remained.
Command: `pnpm run build`.
Exit code: 0, including `assert-web-bundle-clean` (clean).

## 4. Lint

Command: `pnpm run lint`.
Exit code: 0.
apps/api and apps/web eslint finished with no warnings and no errors in the log.

## 5. Type-check

Command: `pnpm run type-check`.
Exit code: 0.

## 6. Unit suite

Command: `CI=true pnpm test`.
Exit code: 0.
`packages/auth-fake`: 2 files, 48 tests.
`packages/shared-utils`: 6 files, 174 tests.
`apps/api`: 100 files, 1482 tests.
`apps/web`: 129 files, 1749 tests.
Vitest total: 237 files, 3453 tests passed, 0 failed.
Node guard tests (11 files): 91 tests, 91 pass, 0 fail, 0 skipped.
`no-legacy-auth.mjs`, `no-legacy-env-names.mjs` and `build-contract.mjs` all exited 0 (`build-contract: ok`).
Release oracles, in the full run and then each alone with `pnpm --filter @fxl-sales/web exec vitest run <path>`:
- `leads-board-scroll.test.tsx`: 13 passed.
- `leads-board-dropzones.test.tsx`: 7 passed.
- `leads-full-edition.test.tsx`: 5 passed.
- `leads-routing.test.tsx`: 22 passed.
The dropzones file prints a React `act(...)` environment warning on stderr; it is noise, not a failure.

## 7. API integration suite

Database: local Docker Postgres on `localhost:5006`; `TEST_DATABASE_URL` uses the `fxl_sales_test` role, the other two URLs are local (passwords masked, exported only for the command, no env file created in the worktree).
Command: `CI=true pnpm --filter @fxl-sales/api test:integration`.
Exit code: 0.
Counts: 51 files, 403 tests passed, 0 failed, duration 36.12s.

## 8. Security

Command: `pnpm audit --prod --audit-level=high`.
Exit code: 0.
Result: 13 vulnerabilities, 0 critical, 0 high, 12 moderate, 1 low (same shape as v4.7.0, no manifest or lockfile change).
Secret or token patterns (api key, secret, password, token, bearer, private key, AKIA, ghp_, gho_, eyJ) in added lines outside `nexo/`: 0.
Added lines with `dangerouslySetInnerHTML`, `innerHTML`, `fetch(`, `apiFetch`, `XMLHttp` or an em dash: 0.
Review: the change is web-only UI (new `BoardScrollbar.tsx` and `narrow-viewport.ts`, a sensor change in `LeadsBoard.tsx` and `LeadCard.tsx`, shell class changes in `SalesOpsApp.tsx`); no new network calls, no HTML injection, no raw ids rendered.

## 9. Reruns and pre-existing failures

No test failed or timed out, so no rerun was needed.
No pre-existing failures observed.

## Processes

Every command ran in the foreground in run-once mode.
Nothing started by this agent is left running.
The developer dev server on 8006 and 3006 and the Postgres container were not touched.
The worktree was removed with `git worktree remove --force` and `git worktree prune`; the main checkout `git status --short` shows only the pre-existing untracked entries.
