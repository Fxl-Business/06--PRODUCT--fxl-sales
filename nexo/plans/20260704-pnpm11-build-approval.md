# pnpm 11 build approval fix

## Frame
`make` selection `1` should start the API development server.
It currently fails during pnpm dependency verification with `ERR_PNPM_IGNORED_BUILDS`.

## Acceptance
Given a fresh invocation of `make`, when option `1` is selected, then pnpm install verification must not fail on unreviewed dependency build scripts.
Given pnpm 11 is used, when dependencies are resolved, then the root React type overrides must still be applied from `pnpm-workspace.yaml`.
Given the shared workspace packages have no `dist` output after install, when `make back` starts the API, then it must build the shared packages before starting watch mode.
Given local API env files are absent, when the API starts from `make back`, then its default port and CORS origin must match the project 06 local ports advertised by the Makefile.
Given the unit test suite runs without local database secrets, when `pnpm test` runs, then DB-backed finder state-machine coverage must not run as a unit test.
Given the integration test suite runs against the local Docker DB, when app modules import validated env, then integration setup must provide default app, admin, and migration database URLs first.

## Scope
Migrate only pnpm configuration required for pnpm 11 compatibility, the Makefile prerequisite required for the API startup path, mismatched API local defaults exposed by that startup path, and the DB-backed test harness gaps exposed by Gate 2.
Do not change application runtime behavior.

## Test Contract
Red was reproduced with `printf '1\n' | make`.
Green is proven when `printf '1\n' | make` builds shared packages and starts the API on `http://localhost:3006` instead of failing with `ERR_PNPM_IGNORED_BUILDS` or a missing shared package import.
Gate 2 is proven when `pnpm test` runs the DB-free unit suite without requiring `ADMIN_DATABASE_URL`.
Integration coverage is proven when `pnpm --filter @fxl-sales/api test:integration` can run against the local Docker DB with default local URLs.
