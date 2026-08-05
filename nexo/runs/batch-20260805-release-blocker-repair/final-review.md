# Final integrated review - release blocker repair

Reviewed range: `603f9f9b5c2dc60164f143376c3f66d5d1cfe607..c2c480dc0f7c17258fd0ab20f33be12efdf3c092`

Reviewed commit: `c2c480dc0f7c17258fd0ab20f33be12efdf3c092`

Review package: `.superpowers/sdd/release-blocker-repair-final/review-603f9f9..c2c480d.diff`

Overall verdict: **FAIL**

Gate 3a must remain blocked.

This review did not rerun the full suite.
It used the independent wave verification evidence for the exact reviewed commit and inspected the integrated implementation, migration chain, generated snapshot, dependency closure, and test contracts.

## Critical findings

### 1. Historical paid professional costs can be materialized a second time after the v2.4 upgrade

Axes: Standards and Spec.

The v2.3.1 implementation materialized each `professional_cost` as one one-shot payable with `receivable_id = NULL`, as shown by `git show v2.3.1:apps/api/src/domains/sales-ops/service.ts` at lines 942-951.
Migration `0017` changes future materialization to one row per installment but performs no payable data migration at `apps/api/drizzle/0017_professional_payment_split.sql:3-9` and `:29`.
Migration `0018` then backfills every unambiguous historical professional-cost row with a professional ID without distinguishing the old one-shot shape at `apps/api/drizzle/0018_professional_payable_identity.sql:9-33`.

When a won sale is reopened, only open payables are voided, so a paid historical one-shot row survives at `apps/api/src/domains/sales-ops/service.ts:2347-2358`.
The materializer excludes that backfilled row from the null-ID legacy multiset at `apps/api/src/domains/sales-ops/service.ts:953-963`.
It then recognizes an identified payable only when both its professional ID and receivable ID equal the new candidate at `apps/api/src/domains/sales-ops/service.ts:1054-1062`.
Every new installment candidate has a non-null receivable ID, so the paid historical row with a null receivable ID suppresses no candidate.
The full professional cost is emitted again at `apps/api/src/domains/sales-ops/service.ts:1063-1069`, leaving the old paid full amount plus a newly generated full split active.

This violates the requirement to preserve payable amounts and receivable behavior at `nexo/plans/20260805-release-blocker-repair/02-professional-payable-identity.md:35` and the requirement that the total payable amount remain correct at `nexo/plans/20260805-release-blocker-repair/00-DESIGN.md:92-96`.
The impact is a potential duplicate financial obligation for sales and paid professional costs created before v2.4.

The current tests do not exercise the deployed upgrade path.
The re-win oracle creates already-split rows under the new runtime at `apps/api/src/domains/sales-ops/__tests__/sale-transitions.integration.test.ts:256-315`.
The migration test creates a null-receivable paid row and backfills it, but rolls back without calling `transitionSale` at `apps/api/src/domains/sales-ops/__tests__/sale-transitions.integration.test.ts:386-433`.
The legacy unit fixture already uses `receivableId: 'r1'` at `apps/api/src/domains/sales-ops/__tests__/sale-transitions.test.ts:365-403`.
That gap explains why the complete test and integration suites can pass while the release upgrade remains unsafe.

Required before release: add a PostgreSQL upgrade-path oracle seeded with the v2.3.1 paid one-shot shape, apply the identity backfill, execute won to open to won, and prove the active professional total is not duplicated.
The migration and runtime reconciliation must treat a surviving full-cost one-shot as covering that professional exactly once, including the ambiguous null-ID case.

## Important findings

### 2. Migration `0018` can block production table access for the full index, validation, and backfill duration

Axis: Standards.

The migration starts with `ALTER TABLE ... ADD COLUMN` at `apps/api/drizzle/0018_professional_payable_identity.sql:4`, which takes an `ACCESS EXCLUSIVE` lock on `sales_ops_payables`.
The same transaction then builds non-concurrent indexes, validates the composite foreign key, and performs the full-table backfill at `apps/api/drizzle/0018_professional_payable_identity.sql:5-33`.
PostgreSQL retains the initial table lock until transaction end, so ordinary reads and writes can remain blocked while all later work completes.
The fresh-database verification proves correctness on an empty database, but it does not bound lock time against production-sized tables or concurrent traffic.

Required before release: either provide an explicitly approved maintenance-window deployment with measured production-scale timing, or change the migration path so long-running index creation, constraint validation, and backfill do not run while an access-exclusive lock is retained.

### 3. Capture leaves authoritative project guidance describing the repaired behavior as still unfixed

Axis: Standards.

`AGENTS.md:19` requires Capture to distill learnings and curate `CLAUDE.md`.
`CLAUDE.md:157-160` still says the re-win guard uses beneficiary name and that `sale_professional_id` is not in the milestone.
`nexo/ROADMAP.md:19` still lists the completed payable-identity repair as an unfixed backlog item.
Those statements directly contradict the reviewed schema and runtime and can misdirect subsequent agents and release work.

Required before release: update the standing domain guidance and remove or resolve the completed roadmap entry through the normal Nexo capture flow.

## Minor findings

None.

## Axis verdicts

Standards: **FAIL**.

Spec: **FAIL**.

The generated snapshot is structurally consistent with `0017`, tenant-safe foreign-key direction is correct, session serialization and error-phase handling match their approved contract, the dependency override is narrowly scoped, and generated context-pack whitespace handling remains isolated.
Those passing areas do not offset the critical payable upgrade defect.
