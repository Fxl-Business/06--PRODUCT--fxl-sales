# Run 20260704-2135-pnpm11-build-approval

## Slice
Fix local API startup through `make` after pnpm 11 install checks.

## Branch
`fix/pnpm11-build-approval`

## Acceptance
`printf '1\n' | make` builds shared workspace packages and starts the API on `http://localhost:3006`.
`pnpm install` does not fail with `ERR_PNPM_IGNORED_BUILDS`.

## Local Evidence
Red 1: `printf '1\n' | make` failed with `ERR_PNPM_IGNORED_BUILDS`.
Red 2: after pnpm config migration, `printf '1\n' | make` failed with missing `@fxl-sales/shared-utils/dist/index.js`.
Green: `printf '1\n' | make` built shared packages, started API on `http://localhost:3006`, and `curl -fsS http://localhost:3006/health` returned HTTP 200 JSON.
Gate 2 attempt 1: separate verifier passed install, startup, health, lint, type-check, and perf audit, but failed `pnpm test` because a DB-backed finder state-machine test ran in the unit suite.
Fix: renamed the DB-backed finder state-machine test to `*.integration.test.ts`, excluded integration tests from unit runs, and added integration env setup for local Docker database URLs.
Local recheck after fix: `pnpm install --frozen-lockfile`, `pnpm run lint`, `pnpm run type-check`, `pnpm test`, `pnpm --filter @fxl-sales/api test:integration`, and `pnpm run perf:audit` exited 0.
