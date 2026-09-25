# Wave verify 3 (Gate 2, integration tier, final)

Target: integrated master `39a8f50`.
Previous green point: `80d425c`.
This wave covers slice 09 (proposta deep link, `416c1a2`) and slice 12 (no mes totals, `39a8f50`).
Verified in a detached worktree at `.worktrees/20260925T191541Z-finance-prereqs-07-10/wave-verify-3`, using `.env` files copied from the main checkout and `pnpm install --frozen-lockfile --offline`.

Verdict: **PASS**

## Checks (each run once)

| Check | Exit | Result |
| --- | --- | --- |
| `pnpm run lint` | 0 | clean |
| `pnpm run type-check` | 0 | clean (api src, scripts, test tsconfigs; web) |
| `CI=true pnpm test` | 0 | auth-fake 35, shared-utils 155, api 680 (63 files), web 1083 (96 files), node script tests 58/58; no timeouts, so no rerun was needed |
| `CI=true pnpm --filter @fxl-sales/api test:integration` | 0 | 272/272 (35 files) |
| cold `pnpm run build` (every `*.tsbuildinfo` and `dist/` under apps and packages deleted first) | 0 | built |
| `node scripts/assert-web-bundle-clean.mjs` | 0 | sentinel absent from `apps/web/dist` |

The web unit count went from 1048 at `80d425c` to 1083, which matches the new slice 09 and 12 tests.

Integration DB safety:
- `TEST_DATABASE_URL`, `TEST_MIGRATE_DATABASE_URL` and `ADMIN_DATABASE_URL` were exported from `apps/api/.env` and asserted to be `localhost:5006` before the run.
- `TEST_DATABASE_URL` uses the `fxl_sales_test` role.
- `setup-env.ts` hard-overrides `DATABASE_URL`.
- `db:migrate` was never run.

## Security review of `git diff 80d425c 39a8f50`

- `sanitizeReturnTo`, `captureReturnTo` and `consumeReturnTo` are unchanged: the diff has no production file under `apps/web/src/auth` or `apps/web/src/lib`.
  It still refuses `/auth*`, terminal routes such as `/no-role` (on the normalized path), `//` and `/\` prefixes, control and whitespace characters, and cross-origin input.
  New tests pin two behaviours: a proposta deep link survives the round trip, and a stale slot is overwritten by a new capture.
- Open redirect: the deep link is only ever an in-app path.
  `buildSalesOpsPath` applies `encodeURIComponent` to `saleId`, so a crafted id such as `//evil` becomes `%2F%2Fevil` inside a same-origin path.
  `navigate` only receives paths built from the fixed workspace and view enums or `-1`.
- Existence leak: `detailSale` is resolved only from the org-scoped bootstrap.
  An unknown id and another organization's id share the same `SaleNotFoundDialog` ("Proposta não encontrada"), and the dialog never renders the id.
  This is pinned by `sale-deep-link.test.tsx` ("shows Proposta não encontrada for an unknown or other-organization id", which asserts the id is absent from the operator text).
  No new API request is made per id.
- Settlement actions are admin-only.
  `canSettleInWorkspace` returns true only for `workspace === 'operacional'` together with the `admin` role.
  It is the same predicate as before, only extracted, and `meus-dados` stays read-only.
  The API `requireAdmin` gate is untouched in this range.
- Secrets: none were added. The only new Hub-looking URLs are `https://hub.example/checkout` mocks inside tests.
- Integration code: there are no outbox, feed, Hub or Finance calls.
  `buildSaleDetailPath` only builds a path string, the future Finance `deepLinkPath`.
- Migrations: no new migration or SQL file appears in either range.
  The `migration-runner.ts` change in the run range is slice 10, which wave 2 already verified.
- Legacy trees: `/admin/*`, `/finder/*`, `/seller/*` and `/no-role` have no diff in the whole run range.
  An empirical `matchRoutes` check with the same route shapes shows that every legacy path still resolves to its legacy route: `/admin/products/abc`, `/admin/finders/x`, `/admin/payouts/batches`, `/finder/dashboard`, `/seller/deals` and `/no-role`.
  The new optional `:saleId?` segment does not outrank the nested static children, and a 4-segment path still falls to `*`.
- Route scope: `saleId` is honoured only on the `vendas` view.
  On any other view it is dropped with a redirect, and a workspace the operator cannot see falls back to the role default route.

## Run range skim (`git diff 2f1f406 39a8f50 --stat`)

74 files changed, all attributable to slices 07-13: the admin gate and BRL, the settlements UI, the deep link, the migration 0018 lock yield, api test type-check, month totals, and the fake identity hubAuth.
Nothing unexpected turned up.

## Observations (non-blocking)

- `/auth/callback` matches `/:workspace/:view/:saleId?` in the SPA router table.
  This is pre-existing: it matched `/:workspace/:view` before this change.
  It is harmless because `/auth/*` is proxied to the API, so the SPA never serves it.

## Cleanup

- The worktree was removed with `git worktree remove --force`.
- No process is left running: the background unit run finished with exit code 0.
