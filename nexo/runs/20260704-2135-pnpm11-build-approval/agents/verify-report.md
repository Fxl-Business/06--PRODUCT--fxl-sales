# Gate 2 Verify Report - pnpm11-build-approval

Verdict: FAIL.

Branch: `fix/pnpm11-build-approval`.

Started: `2026-07-04T21:35:00-03:00`.

Ended: `2026-07-04T21:38:14-03:00`.

## Acceptance Criteria

- `pnpm install` exited 0 with pnpm `11.5.0`.
- No `ERR_PNPM_IGNORED_BUILDS` error was observed.
- `printf '1\n' | make` built `@fxl-sales/shared-types` and `@fxl-sales/shared-utils`.
- The API watcher started and printed `[fxl-sales-api] listening on http://localhost:3006 (development)`.
- While the watcher was running, `curl -fsS -i http://localhost:3006/health` returned `HTTP/1.1 200 OK` with `content-type: application/json`.
- The health body was `{"ok":true,"service":"fxl-sales-api","env":"development","version":"1.0.0","timestamp":"2026-07-05T00:37:23.684Z"}`.
- The watcher was stopped with Ctrl-C after the successful health response.
- The Ctrl-C exit was treated as expected for the long-running watcher.

## Quality Checks

- `pnpm run lint` exited 0.
- Lint reported 20 React Fast Refresh warnings in `apps/web`, but no errors.
- `pnpm run type-check` exited 0.
- `pnpm test` exited 1.
- `pnpm run perf:audit` exited 0 and printed `perf-audit: ok`.

## Failing Check

`pnpm test` failed in `apps/api` at `src/domains/finders/__tests__/finder-state-machine.test.ts`.

Vitest reported 7 failed tests and 115 passed tests in the API package.

The repeated failure was `ADMIN_DATABASE_URL not configured. Set it in apps/api/.env`.

The stack traces point to `apps/api/src/db/client.ts:46` through the finder state machine test setup.

No application, source, or config files were edited by this verifier.
