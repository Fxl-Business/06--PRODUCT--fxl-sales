# Wave verification: release blocker repair

Status: PASS

Agent: `wave-verify`

Slice: `release-blocker-repair`

Tested commit: `c2c480dc0f7c17258fd0ab20f33be12efdf3c092`

## Preflight

`HEAD` and `master` both resolved to the tested commit.

The tracked worktree and index were clean before verification.

The only untracked path was the user-owned `.vscode/settings.json`, which was excluded as instructed.

The local PostgreSQL role check confirmed that `fxl_sales_test` is neither superuser nor `BYPASSRLS` and that the separate `postgres` migration/admin role is superuser.

The integration suite used the repository's documented `TEST_DATABASE_URL` application role and separate `TEST_MIGRATE_DATABASE_URL` and `ADMIN_DATABASE_URL` admin role split.

## Required commands

| Command | Exit | Evidence |
| --- | ---: | --- |
| `CI=true pnpm run lint` | 0 | Four workspace projects completed with no lint error. |
| `CI=true pnpm run type-check` | 0 | Package builds and type checks completed for all four workspace projects. |
| `CI=true pnpm test` | 0 | 83 test files and 950 tests passed: shared-utils 3 files and 80 tests, API 34 files and 336 tests, web 46 files and 534 tests. The tracked-file and build-contract guards also passed. |
| `CI=true pnpm --filter @fxl-sales/api test:integration` | 0 | 20 test files and 119 PostgreSQL integration tests passed. |
| `CI=true pnpm run build` | 0 | Shared packages, API, and production web bundle built successfully. |
| `pnpm audit --prod --audit-level high` | 0 | Eight moderate findings, zero high findings, and zero critical findings. |
| `pnpm audit --audit-level high` | 0 | Eight moderate findings, zero high findings, and zero critical findings. |
| `git diff --check v2.3.1..HEAD` | 0 | No whitespace errors. |

## Focused risk review

### Session row lock scope and error semantics

PASS.

The durable session store starts one admin-database transaction before hydration and keeps it open through the BFF handler and ordered mutation flush.

Hydration locks only the matching unexpired `hub_bff_sessions` row through its primary-key predicate and `FOR UPDATE`, so unrelated session rows are not locked.

The PostgreSQL concurrency oracle passed and proved that a competing replica waits for the rotated token while a different session remains independently accessible.

Transaction acquisition and hydration errors remain wrapped as `HubSessionStoreUnavailableError` before the handler runs.

Handler errors remain the identical error object and roll back request mutations.

Flush and commit failures are classified after a handler value exists, roll back the transaction, log the bounded persistence error, and return the already formed value.

### Migration 0018 ordering, backfill, and composite foreign key

PASS.

The journal records migration `0018_professional_payable_identity` at index 18 after migration 0017 with a later timestamp.

The 0018 snapshot `prevId` exactly equals the 0017 snapshot `id`.

The SQL is expand-only and orders the nullable column, target unique index, three-column foreign key, lookup index, transaction-local admin context, and conservative backfill correctly.

The backfill restricts matches by organization, sale, professional-cost kind, and beneficiary snapshot.

Its `NOT EXISTS` ambiguity guard prevents guessed identities, and repeated `sale_professional_id IS NULL` predicates make replay safe.

The foreign key maps `(org_id, sale_id, sale_professional_id)` to `(org_id, sale_id, id)` with `ON DELETE restrict`.

The schema, generated snapshot, journal, and SQL agree on the nullable column, both indexes, and composite foreign key.

No destructive DDL is present.

The full migration-backed integration suite and the static migration contract tests passed, with no generated or migration snapshot drift observed.

### Payable tenant isolation and legacy behavior

PASS.

Both create and transition flows source professional identity from persisted database rows.

Transition reads remain scoped by `org_id` and `sale_id`, and payable inserts use the trusted transaction organization and sale.

The composite foreign key and passing PostgreSQL negative controls reject both cross-organization and wrong-sale professional identities.

Current professional payables match by durable professional ID and receivable ID.

Only non-void legacy professional rows with a null identity enter the fallback multiset.

The collision-safe key includes beneficiary snapshot, receivable ID, and amount, and each legacy row is consumed at most once.

Identified matches are checked before legacy consumption, preserving counts for another same-name professional.

Non-professional payable kinds deliberately persist a null professional identity.

### Dependency override scope

PASS.

The only workspace override added by the repair is `brace-expansion@<1.1.18: 1.1.18`.

Direct manifest changes are limited to development tooling roots in the API and web packages: ESLint, `@eslint/js`, `typescript-eslint`, and web PostCSS.

No runtime dependency manifest changed in the dependency repair commit.

The lock resolves `brace-expansion` to patched 1.1.18 and 5.0.9 lines and PostCSS to 8.5.25.

Both production and complete audits contain no high or critical finding, and the workspace quality gates remain green.

### Generated context-pack whitespace exemption

PASS.

`.gitattributes` contains one rule: `nexo/runs/**/context-pack.md -whitespace`.

Git reports `whitespace: unset` for generated context packs under `nexo/runs/`.

Git reports `whitespace: unspecified` for an ordinary run record, a plans path, and `package.json`, so authored files remain covered.

The historical context packs are byte-identical between the pre-repair release commit `5162d4d` and the tested commit.

The release-range whitespace command exits zero.

## Verdict

PASS.

Every required command exited zero, the focused security and migration review found no release blocker, and no process started by this verification remains running.
