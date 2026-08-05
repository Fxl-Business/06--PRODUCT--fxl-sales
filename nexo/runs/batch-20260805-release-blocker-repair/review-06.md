# Final cumulative review - 06-phased-professional-identity-migration

Reviewed HEAD: `00d83854a01bd9e6da2b133b972c80faf6536c6b`

Reviewed commits:

- `d8574f696a624f2661b493b9912bb8b047e9340f fix(db): phase professional identity migration`
- `00d83854a01bd9e6da2b133b972c80faf6536c6b fix(db): bound migration retry paths`

Overall verdict: **PASS**

## Spec verdict: PASS

The cumulative implementation satisfies the approved slice contract and closes every prior review finding.

- Advisory-lock acquisition remains on the reserved backend and now has production defaults of 3,000 completed try-lock attempts at `100ms` intervals at `apps/api/src/db/migration-runner.ts:83-86` and `:255-284`.
  This retains the completed-query behavior needed to avoid an old waiting snapshot blocking `CREATE INDEX CONCURRENTLY`, while giving each startup attempt a finite terminal result.
  The runner still acquires the lock before any schema or journal mutation at `apps/api/src/db/migration-runner.ts:570-587`.
- The lock-contention oracle establishes that the owner has committed its first migration while still holding the advisory lock, then starts the contender, observes a completed failed poll, releases the owner, and proves both journal entries exactly once at `apps/api/test/rls/professional-payable-migration.integration.test.ts:392-451`.
  The exhaustion oracle holds the same real lock through three configured contender attempts and proves no contender row or journal entry was created at `apps/api/test/rls/professional-payable-migration.integration.test.ts:453-505`.
- The backfill retry loop validates finite controls before mutation, counts remaining candidates with transaction-local admin context, and fails on exactly the configured consecutive-empty threshold without reaching validation or journaling at `apps/api/src/db/migration-runner.ts:422-484`.
  The release-and-resume oracle uses one unambiguous candidate, proves forced RLS sees zero without admin context and one with it, observes batch sizes `[0, 1, 0]`, and journals only after the locked row is linked at `apps/api/test/rls/professional-payable-migration.integration.test.ts:800-856`.
  The exhaustion oracle keeps that only candidate locked through exactly 50 empty batches and proves the identity remains null and migration 0018 remains unjournaled at `apps/api/test/rls/professional-payable-migration.integration.test.ts:858-919`.
- Scratch resources are registered before DDL, cleanup attempts each client, connection termination, database drop, role drop, and admin shutdown independently, and setup rethrows the original error at `apps/api/test/rls/professional-payable-migration.integration.test.ts:119-204`.
  The injected post-database-create failure asserts object identity for the original error and independently confirms that neither generated database nor role remains at `apps/api/test/rls/professional-payable-migration.integration.test.ts:362-390`.
- Phase parsing now rejects malformed or unknown marker names, requires exactly one marker at the start of every breakpoint chunk, requires the marker immediately before SQL, and validates the exact ordered vocabulary before opening a database connection at `apps/api/src/db/migration-runner.ts:132-189` and `apps/api/src/db/__tests__/migration-runner.test.ts:40-83`.
- Explicit reserved-handle transactions and rollback, stable backend PID checks, Drizzle-compatible full-file hashes and timestamps, journal-prefix validation, concurrent invalid-index recovery, finite DDL lock timeouts, `NOT VALID` foreign-key enforcement, forced-RLS completion reads, final validation, and atomic journaling remain intact.
- Production and integration startup still route through the shared runner without passing test controls at `apps/api/src/db/migrate.ts:12-13` and `apps/api/test/rls/global-setup.ts:15-21`.
- The cumulative diff does not modify `apps/api/drizzle/meta/_journal.json` or `apps/api/drizzle/meta/0018_snapshot.json`.

No missing requirement, incorrect behavior, scope creep, or deploy-safety regression remains.

## Standards verdict: PASS

The cumulative change is cohesive, preserves the documented API migration conventions, and keeps test-only controls unused by both production startup paths.
The follow-up commit changes only the runner and its focused unit and PostgreSQL integration tests.
The new names expose their intent, cleanup paths preserve the primary failure, asynchronous test gates are released in `finally`, and no applicable baseline code smell rises to a finding.

The updated execution evidence records the focused static contracts, nine migration integration tests, all 128 integration tests, all 340 API unit tests, focused ESLint, type-check, build, and diff-check passing at the reviewed HEAD.
This review did not rerun the full suite.

## Findings

### Critical

None.

### Important

None.

### Minor

None.

## Summary

Spec: PASS with no findings.

Standards: PASS with no findings.
