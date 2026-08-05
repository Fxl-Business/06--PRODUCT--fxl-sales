# Gate 2 Verify - 02 Professional Payable Identity

## Verdict

PASS.

The exact cumulative commit `8ac14bc522c3ffce465b00a5dba668b5313f44ec` was verified independently against base `95f746492e0780bd4aec4bba80a9a2a309990300`.
No implementation file was edited and no commit was created.

## Database isolation

The PostgreSQL application connection used role `fxl_sales_test` on local port 5006.
Catalog inspection confirmed `rolsuper = false` and `rolbypassrls = false`.
Migration and admin connections used the separate local `postgres` role.

## Command evidence

- `pnpm run build:packages` exited 0.
- Focused professional payable unit command exited 0 with 3 files and 29 tests passed.
- The real PostgreSQL sale transition file exited 0 with 9 tests passed.
- The proposal-write RLS file exited 0 with 7 tests passed.
- `pnpm --filter @fxl-sales/api test` exited 0 with 34 files and 336 tests passed.
- The full API PostgreSQL integration suite exited 0 with 20 files and 119 tests passed.
- Changed-file ESLint exited 0 for all seven changed TypeScript files.
- `pnpm --filter @fxl-sales/api type-check` exited 0.
- Isolated Drizzle generation reported `No schema changes, nothing to migrate` and did not modify repository migration outputs.
- A fresh scratch database applied the full migration journal through `0018` and was dropped in the command's cleanup path.
- `git diff --check 95f7464..HEAD` exited 0.

## Migration and schema inspection

- Migration `0018` creates `sales_ops_sale_professionals_org_sale_id_id_idx` before adding `sales_ops_payables_org_sale_professional_fk`.
- Fresh-database catalog inspection found the target unique index, the nullable UUID source column, the source lookup index, and the composite foreign key in the required direction with `ON DELETE RESTRICT`.
- The latest scratch migration record had timestamp `1785941449505` and SHA-256 `801792146696d52b7d0f434c52cdd30c883b10bd8f35b967c082b629d2ba04dc`, matching the shipped SQL.
- The snapshot is PostgreSQL version 7, contains 29 tables, chains its `prevId` to the exact `0017` snapshot ID, and records the nullable column, both indexes, and the three-column foreign key.
- The journal orders `0018_professional_payable_identity` after `0017_professional_payment_split` with increasing index and timestamp.
- The migration contains no destructive DDL, `NOT NULL`, or default for `sale_professional_id`.

## Acceptance evidence

- The source identity remains nullable, while every newly materialized `professional_cost` draft carries its persisted sale-professional ID.
- Seller commission, finder commission, tax, and other-cost drafts deliberately carry null identity.
- Both create-as-won and transition-to-won paths persist database-owned professional row IDs.
- Current payable suppression matches durable `(sale_professional_id, receivable_id)` identity.
- The legacy null-ID path uses a consumable multiset keyed by beneficiary name, receivable ID, and amount, so one historical row suppresses at most one duplicate candidate.
- The same-name re-win PostgreSQL oracle preserves the paid professional, creates exactly one missing payable, and preserves the expected total.
- The conservative backfill matches organization, sale, and snapshot, rejects ambiguous duplicates through `NOT EXISTS`, and repeats safely because both candidate selection and update require null identity.
- The executable backfill test runs entirely inside an explicit transaction, calls `tx.rollback()`, asserts the rollback exception, and confirms all fixture organizations have zero persisted sales afterward.
- The raw PostgreSQL controls reject both cross-organization and same-organization cross-sale professional references with error `23503` and accept the matching tuple.
- Every admin read introduced or modified by this slice's professional identity coverage is explicitly organization-scoped.
- Service reads and mutations used by the transition path retain organization and sale predicates.

## Worktree hygiene

The final implementation tree remained unchanged by verification commands.
Only pre-existing executor/reviewer artifacts and this verifier's required report/result artifacts are untracked.
No test runner, server, watcher, or database client process remains running.
