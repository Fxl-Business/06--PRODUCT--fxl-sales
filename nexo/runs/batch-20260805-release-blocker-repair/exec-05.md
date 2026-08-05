# Execute 05: Legacy Professional One-Shot Reconciliation

## Outcome

Status: PASS.

Tested commit: `93950c6da8e6c4e9680f65b33bf795ad51c443c4`.

The runtime now separates null-receivable full one-shots from non-null per-receivable legacy parts.
An exact identified full one-shot covers its durable professional before an unidentified same-name and same-cost one-shot is consumed.
Each unidentified historical one-shot is consumed at most once, amount mismatches do not cover a professional, and no historical row is rewritten.

## Red Evidence

The shared packages were built first so Vitest could resolve the workspace imports.

`pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/__tests__/sale-transitions.test.ts` failed with the two intended new unit oracles.
The identified full one-shot incorrectly produced two split drafts, and the one null-ID full one-shot incorrectly left two drafts instead of one.

`VITEST_INTEGRATION=1 pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/__tests__/sale-transitions.integration.test.ts -t "v2.3.1"` failed after the exact shipped `backfill-repeat` SQL and both real transition sequences completed.
The identified upgrade path produced `200000` instead of `100000`.
The ambiguous same-name upgrade path produced `300000` instead of `200000`.

## Green and Refactor

The implementation maintains separate full one-shot and per-part count maps with visibly separate keys and classification predicates.
It consumes exact identified full one-shots before exact unidentified full one-shots, then preserves the existing durable-ID and null-ID per-part reconciliation.
A shared decrement helper removes count-consumption duplication without merging the two key spaces.

The locked PostgreSQL oracles execute the migration chunk selected by the exact `-- fxl-phase: backfill-repeat` marker and remove only that leading marker line.
The v2.3.1 fixtures explicitly insert both `receivableId: null` and `saleProfessionalId: null` before the backfill.
The unambiguous row receives its professional ID, the same-name ambiguous row stays null, and the active totals exclude void rows after real won to open to won transitions.

## Verification Run by Execute Agent

- Focused unit file: PASS, 14 tests.
- Focused v2.3.1 PostgreSQL oracles: PASS, 2 tests.
- Full sale transition PostgreSQL file: PASS, 11 tests.
- API unit suite: PASS, 35 files and 342 tests.
- Full integration suite with `fxl_sales_test` as the non-superuser application role and separate local `postgres` migration and admin URLs: PASS, 21 files and 130 tests.
- Changed-file ESLint: PASS.
- API type-check: PASS.
- Root production build: PASS.
- `git diff --check` and `git diff --cached --check`: PASS.

An exploratory full integration invocation without the explicit role split correctly failed the existing RLS guards because it resolved to the local `postgres` superuser.
The authoritative rerun used the repository's documented non-superuser and admin role split and passed completely.

## Commit and Cleanup

Commit: `93950c6 fix(sales-ops): reconcile legacy professional one-shots`.

Only the three planned source and test files are in the implementation commit.
No test runner, build worker, watcher, server, or other process started by this slice remains running.

## Concerns

No implementation concern remains.
Gate 2 still requires the separate Verify agent defined by Nexo.
