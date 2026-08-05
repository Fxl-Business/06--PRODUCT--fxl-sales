# Final Review Repair Planning Report

## Verdict

PASS.

The three integrated-review blockers are decomposed into three executor-ready Nexo slices.
The slices are separate because runtime financial reconciliation, database deployment safety, and standing guidance have independent acceptance contracts and review outcomes.

## Plans

1. `nexo/plans/20260805-release-blocker-repair/05-legacy-professional-one-shot-reconciliation.md`
2. `nexo/plans/20260805-release-blocker-repair/06-phased-professional-identity-migration.md`
3. `nexo/plans/20260805-release-blocker-repair/07-capture-professional-payable-guidance.md`

## Dependency order

Slice 06 executes first because it introduces the authoritative `backfill-repeat` marker and updates the existing executable backfill extractor.
Slice 05 executes second because its locked upgrade-path oracle deliberately extracts that exact phased migration chunk.
Slice 07 executes only after separate-agent verification passes for slices 05 and 06.

The safe execution order is therefore `06 -> 05 -> 07`.

## Migration runner decision

The stock Drizzle PostgreSQL migrator wraps every pending statement in one outer transaction.
That transaction makes `CREATE INDEX CONCURRENTLY` illegal and retains the initial access-exclusive column-add lock until the backfill and validation finish.

The plan introduces one shared repository migration runner for production and integration startup.
Ordinary migrations remain journal-compatible and transactional.
One postgres-js connection is reserved for the complete run.
The runner uses explicit `BEGIN`, `COMMIT`, and rollback-on-error `ROLLBACK` through that reserved handle because the installed reserved handle has no `begin` method and the base pool cannot lease its only reserved connection.
The advisory lock, every migration statement, every admin-context candidate read, and the advisory unlock remain on one asserted backend PID.
Migration 0018 becomes a resumable phased migration using a short lock timeout, concurrent indexes, a not-valid foreign key, bounded `1000`-row backfill transactions, final validation, and journal insertion only after complete catalog and admin-context data checks.

This approach avoids relying on an unmeasured maintenance window and is tested against a populated scratch PostgreSQL database owned by a non-superuser, non-`BYPASSRLS` migration role with concurrent read and write canaries.

## Adversarial check repairs

- Ordinary migration commit and rollback are tested on the reserved backend, and every emitted phase must carry the same PID as the advisory lock owner.
- The SKIP LOCKED blocker is acquired only from the committed `post-constraint` seam, retained across one successful batch, released, and then proven to be updated by a later batch.
- Empty-batch and final pre-journal candidate reads run in explicit reserved-handle transactions with transaction-local admin context.
- A forced-RLS negative control proves the same candidate count falsely returns zero without admin context.
- Concurrent-index interruption uses a retained `REPEATABLE READ READ ONLY` snapshot, a five-second finite poll, and the exact `Lock` plus `virtualxid` wait state before cancellation.
- Upgrade tests locate the exact `backfill-repeat` chunk and remove only its runner marker before executing the shipped SQL.

## Principal risks

- Replacing the stock migrator is a high-leverage change, so production CLI, integration global setup, Docker contract, empty-database migration, retry, and concurrent-runner behavior are all mandatory verification surfaces.
- Concurrent index interruption can leave an invalid index, so the runner must inspect `pg_index.indisvalid`, drop invalid indexes concurrently, and retry.
- A session advisory lock and explicit transactions must stay on one reserved physical connection, otherwise the runner can deadlock its `max: 1` pool or lose serialization.
- Forced RLS can make an unprivileged completion count falsely read zero, so every candidate read must establish transaction-local admin context before journaling.
- A row blocker acquired before the column phase would deadlock the test contract, so the blocker seam exists only after the constraint commits.
- The historical one-shot detector must require null receivable plus exact full cost, otherwise a partial legacy payment could incorrectly suppress a complete professional obligation.
- Identified one-shots must be checked before ambiguous null-ID consumption, otherwise an identified professional could steal the only legacy count needed by another professional.
- Scratch database tests perform destructive cleanup, so database and role names are generated from validated hexadecimal UUID characters and every client is closed before dropping only those exact objects.

## Scope exclusions

The plans do not change UI behavior, payment split arithmetic, cancellation semantics, generated migration snapshots, unrelated backlog items, deployment branches, release tags, or milestone status.
