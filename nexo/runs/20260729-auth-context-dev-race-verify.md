# Verify: fix/auth-context-dev-race

Date: 2026-07-29.
Branch: fix/auth-context-dev-race.
HEAD: c5b4368 "fix(web): survive dev-server module duplication in hub auth context".
Base compared: master (1d0bab0).

## Diff surface

`git diff master...HEAD --stat` shows 6 files changed, 181 insertions, 2 deletions.
Files touched:
- `apps/web/src/__tests__/route-error-and-auth-context.test.tsx` (new, oracle test).
- `apps/web/src/auth/react.tsx` (HubAuthContext singleton).
- `apps/web/src/pages/errors/RouteErrorPage.tsx` (new error page).
- `apps/web/src/router.tsx` (errorElement wiring + `@/auth/react` import).
- `apps/web/vite.config.ts` (dedupe, optimizeDeps.include, server.warmup).
- `nexo/plans/20260729-auth-context-dev-race.md` (new plan doc).

All changes are scoped to the dev-race fix.
Nothing unrelated to the feature was touched.

## Acceptance criteria check

1. `RouteErrorPage` is added and wired as `errorElement` on every top-level route in `router.tsx` (`/`, `/admin`, `/finder`, `/seller`, `/no-role`, `/:workspace/:view`).
It renders "Algo deu errado" and a "Recarregar" button that calls `window.location.reload()`.
The oracle test `apps/web/src/__tests__/route-error-and-auth-context.test.tsx` exercises this with a throwing route element and asserts the friendly page and button render.
This matches criterion 1.

2. `apps/web/vite.config.ts` adds `resolve.dedupe` (`react`, `react-dom`, `react-router-dom`), `optimizeDeps.include` with a list of packages including `@radix-ui/react-dropdown-menu`, and `server.warmup.clientFiles`.
`apps/web/src/auth/react.tsx` pins `HubAuthContext` to a `globalThis.__fxlHubAuthContext` singleton using `??=` so duplicated module instances share one context object.
This matches criterion 2 exactly.

3. No other regressions found; see machine gate results below.

## Machine gate

- `pnpm run lint`: PASS. `eslint src/` clean for both `apps/api` and `apps/web`.
- `pnpm run type-check`: PASS. `tsc --noEmit` clean for `shared-types`, `shared-utils`, `apps/api`, `apps/web`.
- `CI=true pnpm test` (run-once, no watchers): PASS, exit code 0.
  - `packages/shared-utils`: 1 file, 17 tests passed.
  - `apps/api`: 20 files, 174 tests passed.
  - `apps/web`: 14 files, 84 tests passed, including the new oracle test file (4 tests, all green) and the pre-existing `src/auth/__tests__/react.test.tsx` (5 tests, still green after the singleton change).
  - The tracked-file guard (`node scripts/no-legacy-auth.mjs`) ran as part of the same `pnpm test` chain and did not fail (overall exit code 0).

## Security lens

Reviewed the diff for secrets, unsafe eval, XSS sinks, and tenant-data leaks.
- No secrets or credentials introduced.
- No `eval`, `Function`, or `dangerouslySetInnerHTML` anywhere in the diff.
- `RouteErrorPage` renders `error.message` as a plain text React child (`{message}` inside a `<p>`), not raw HTML, so there is no injection sink.
- The globalThis singleton (`__fxlHubAuthContext`) stores only a React context object reference, not user or tenant data, and is process-local to the browser tab.
- `vite.config.ts` changes are dev-server-only build tooling (dedupe, prebundle list, warmup) with no runtime or production security surface.
- Minor non-blocking note: `RouteErrorPage` displays the raw `Error.message` to the end user for any route-level render error, not just the auth-race case it was built for.
  Today's target error message ("Hub auth context is missing") is generic and safe, but if a future thrown error's message ever embedded sensitive detail, it would render to the browser.
  This is a pre-existing pattern risk to watch, not a blocker for this change.

## Verdict

PASS.
All three acceptance criteria are met, the diff is scoped to the intended fix, and lint, type-check, and test are all green.
