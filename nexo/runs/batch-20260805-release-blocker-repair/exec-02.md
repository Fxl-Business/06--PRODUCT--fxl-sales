# Execute evidence - 02-professional-payable-identity

Tested commit: `8ac14bc522c3ffce465b00a5dba668b5313f44ec`

## Red evidence

The locked end-user-aligned PostgreSQL oracle exercised two real `transitionSale` wins around a won to open to won cycle.

Before production changes, `re-win creates exactly one missing payable for same-name professionals` exited 1 because the surviving paid row suppressed both same-name candidates.

The observed active payable count was `1` instead of `2`, the active total was `100000` instead of `200000`, and no new active payable existed.

The migration and materializer contract run exited 1 with 13 expected failures.

The failures proved migration 0018 was absent, payable drafts lacked explicit identity, current rows were still matched by display name, and one legacy null-ID row suppressed both candidates.

The Red oracle was not weakened after recording this failure.

## Green implementation

Migration `0018_professional_payable_identity` adds nullable `sale_professional_id`, its lookup index, the composite target unique index, and the organization-and-sale-scoped composite foreign key with `ON DELETE restrict`.

Drizzle generated the journal and `0018_snapshot.json` artifacts.

The generated SQL initially placed the foreign key before its target unique index, and PostgreSQL rejected the migration with code `42830`.

The generated DDL statements in the SQL migration were reordered so the unique index exists before the foreign key.

The snapshot was not hand-edited.

The migration applies admin context and backfills only unambiguous same-organization, same-sale, same-snapshot professional-cost rows.

Ambiguous history remains null and replay is idempotent.

New professional-cost drafts persist their database-owned sale-professional ID.

Commission, tax, and other-cost drafts deliberately persist null identity.

Current professional payables match by `(sale_professional_id, receivable_id)`.

Historical null-ID payables use a consumable multiset keyed by `(beneficiary_name, receivable_id, amount_brl)`.

Both direct-won creation and won transitions pass authoritative inserted or selected professional rows into the same materializer.

## Verification evidence

`pnpm run build:packages && pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/__tests__/professional-payable-identity.test.ts src/domains/sales-ops/__tests__/sale-transitions.test.ts src/domains/sales-ops/__tests__/service.test.ts` exited 0 with 29 tests passing.

`VITEST_INTEGRATION=1 pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/__tests__/sale-transitions.integration.test.ts test/rls/proposal-write.test.ts` exited 0 with 16 tests passing.

The locked same-name re-win oracle passed through the real PostgreSQL transition path.

Executable migration coverage proved unique matches link, ambiguous matches stay null, cross-organization names do not affect uniqueness, and replay is stable.

Raw admin-context controls proved both cross-organization and cross-sale identities fail with PostgreSQL code `23503`, while the matching tuple succeeds.

Direct-won creation proved the professional-cost payable carries the inserted row ID and every non-professional payable keeps null identity.

`pnpm --filter @fxl-sales/api test` exited 0 with 336 tests passing.

The first extra full integration run used the worktree fallback superuser URL and correctly failed the pre-existing non-superuser guard.

The full integration suite was rerun with the documented local role split: `fxl_sales_test` for application access and `postgres` for migration and admin access.

That run exited 0 with 119 tests passing across 20 files.

`pnpm --filter @fxl-sales/api exec eslint` over every changed TypeScript file exited 0.

`pnpm --filter @fxl-sales/api type-check` exited 0.

`pnpm --filter @fxl-sales/api db:generate` reported `No schema changes, nothing to migrate` after the generated artifacts were present.

Snapshot inspection confirmed a nullable UUID column, non-unique lookup index, exact three-column foreign key direction, `ON DELETE restrict`, and the unique composite target index.

Journal inspection confirmed migration 0018 is last and all indices are strictly increasing.

`git diff --check` and `git diff --cached --check` exited 0.

The commit hook's performance audit exited 0.

## Review fix evidence

The executable backfill fixture, both production backfill executions, and all related assertions now run inside one explicit admin transaction.

The successful assertion path calls `tx.rollback()` and expects `TransactionRollbackError`.

Any earlier assertion or query failure also causes Drizzle to roll the transaction back automatically.

After the explicit rollback, organization-scoped reads prove that none of the three fixture sales survived.

The backfill may still inspect all qualifying shared-database rows, as the production migration does, but every write made by the test execution is now rolled back.

Every reviewed admin tenant-table read now includes its organization predicate.

The same-name oracle's paid-row mutation also includes both organization and row ID predicates.

After these review fixes, the focused unit run exited 0 with 29 tests passing.

The focused PostgreSQL run exited 0 with 16 tests passing.

The full integration suite under the documented non-superuser and admin role split exited 0 with 119 tests passing across 20 files.

Changed-file ESLint, API type-check, migration drift generation, snapshot inspection, journal inspection, `git diff --check`, and `git diff --cached --check` all exited 0.

The review-fix commit hook's performance audit exited 0.

## Commit

`ef16dbcac127fa51b74d50f2f0db5aa080fdbe13 fix(sales-ops): persist professional payable identity`

`8ac14bc522c3ffce465b00a5dba668b5313f44ec test(sales-ops): harden professional payable integration coverage`

No long-running process was started or left active.
