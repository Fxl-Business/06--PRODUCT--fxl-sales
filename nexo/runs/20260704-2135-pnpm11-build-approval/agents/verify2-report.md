# Gate 2 Verify Report - pnpm11-build-approval

Verdict: PASS.

Branch verified as `fix/pnpm11-build-approval`.

The worktree was dirty before verification, with source and config changes belonging to the slice under test.
No application, source, or config files were edited by this verifier.

## Acceptance Criteria

1. `pnpm install --frozen-lockfile` exited 0 using pnpm v11.5.0.
No `ERR_PNPM_IGNORED_BUILDS` output was observed.

2. `printf '1\n' | make` built `@fxl-sales/shared-types` and `@fxl-sales/shared-utils` with `tsc`.
It then started `@fxl-sales/api` and printed `[fxl-sales-api] listening on http://localhost:3006 (development)`.

3. While the watcher was running, `curl -fsS -w '\nHTTP_STATUS:%{http_code}\n' http://localhost:3006/health` exited 0.
It returned JSON: `{"ok":true,"service":"fxl-sales-api","env":"development","version":"1.0.0","timestamp":"2026-07-05T00:45:03.278Z"}`.
The recorded status was `HTTP_STATUS:200`.
The watcher was stopped with Ctrl-C after the successful health check, and exit status 130 was treated as expected.
The server log also recorded `GET /health 200`.

4. Local quality checks completed as follows.
`pnpm run lint` exited 0.
It reported 20 warnings, all `react-refresh/only-export-components` warnings in `apps/web/src/components/ui/badge.tsx`, `apps/web/src/components/ui/button.tsx`, and `apps/web/src/router.tsx`.
`pnpm run type-check` exited 0 across the workspace.
`pnpm test` exited 0, with 14 test files and 154 tests passing across present workspace suites.
`docker compose ps db` showed the `db` service as `Up ... (healthy)`.
`pnpm --filter @fxl-sales/api test:integration` exited 0, with 7 test files and 26 tests passing.
`pnpm run perf:audit` exited 0 and reported `perf-audit: ok`.
