# Wave verify 1 - integrated master c79abed

Verdict: PASS.
Scope: slices 07 (merge e8ea0b9, PC23 admin gate, BRL lock, MutationErrorBanner) and 10 (merge c79abed, migration lock yielding) on top of 2f1f406.
Worktree: detached `.worktrees/20260925T191541Z-finance-prereqs-07-10/wave-verify-1` at c79abed, `.env` files copied from the main checkout, `pnpm install --frozen-lockfile --offline`, removed at the end.

## Checks

| # | Command | Exit | Result |
| --- | --- | --- | --- |
| 1 | `pnpm run lint` | 0 | clean, no warnings |
| 2 | `pnpm run type-check` | 0 | clean (api src + scripts, web, packages) |
| 3 | `CI=true pnpm test` | 0 | auth-fake 35, shared-utils 155, api 678 (63 files), web 998 (85 files), node scripts 55/55, 0 failed, 0 skipped |
| 4 | `CI=true pnpm --filter @fxl-sales/api test:integration` | 0 | 272/272 passed, 35 files |
| 5 | cold `pnpm run build` (all `*.tsbuildinfo` and `dist/` under apps and packages deleted first) | 0 | built |
| 5b | `node scripts/assert-web-bundle-clean.mjs` | 0 | fake-roster sentinel absent from `apps/web/dist` |

DB safety: `TEST_DATABASE_URL` and `TEST_MIGRATE_DATABASE_URL` in the copied `apps/api/.env` point at `localhost:5006` (the `fxl_sales_test` role for the app URL); `setup-env.ts` hard-overrides `DATABASE_URL`. `db:migrate` was never run.

## Security review of `git diff 2f1f406 c79abed`

- Secrets: none. The only URL/token strings added are test fixtures (`https://hub.example/checkout`, `hub-access-token`, `test-token`).
- Access gate: `requireHubAuth` and the deny taxonomy untouched. Changes are strictly additive (stricter).
- Admin gate fails closed: `hasAdminRole` is `c.get('userRole') === 'admin'`, so a missing or other role is denied. `requireAdmin` now guards `POST /sales/:id/transition`, `POST /sales/:id/cancel-contract`, `PUT /sales/:id`, `PUT /settings`. `POST /sales` refuses a raw body `status: 'won'` from a non-admin with the same 403 body before validation. One predicate and one body (`ADMIN_ROLE_REQUIRED_BODY`), no inline admin checks.
- Org scoping: no tenant query was added or changed; handlers only gained a middleware or a pre-validation guard. `SettingsSchema.currency` became `z.literal('BRL')`.
- UI identifiers: the banner and 403 copy name no role, module or raw id; `describeSaleSaveError` still prints labels, not ids. 403 keyed on status via `isForbiddenFailure`, consistent with the rule.
- Outbound calls / integration code: none. No outbox, feed, Hub or Finance calls added (Finance appears only in comments and docs).
- Migrations: no new migration files (`git diff --name-status` shows none under migrations/drizzle).
- Runner retry cannot journal a partial migration: `retryOnLockContention` retries only on SQLSTATE `55P03`/`40P01`, bounded (50 attempts, 200 ms), everything else rethrows immediately. Ordinary migrations retry the whole `withReservedTransaction` unit (BEGIN, statements, journal INSERT, COMMIT; ROLLBACK on error, AggregateError if ROLLBACK fails, which is not retried), so the journal row commits atomically with the DDL. Phased migrations retry only the single lock-bounded `column`/`constraint` statement (autocommit, rolled back as a unit, `RESET lock_timeout` in `finally`); the phased journal INSERT stays after all phases. `lock_timeout` is interpolated from an integer read from `pg_settings.deadlock_timeout` (floor/2, rejected below 2), not from input.

## Observations (non-blocking)

- `PUT /sales/:id` is now admin-only, so any seller-side edit path of a proposta would 403; CLAUDE.md records this as the PC23 decision and the UI already hides the edit/manage affordances for non-admins.

No process left running.
