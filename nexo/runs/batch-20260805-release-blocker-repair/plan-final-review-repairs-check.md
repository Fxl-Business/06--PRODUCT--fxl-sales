# Final review repair plans recheck

Overall verdict: **PASS**.

The updated plans close all three original integrated-review blockers.
All three prior Critical findings and both prior Important findings are resolved.
The reordered `06 -> 05 -> 07` contract introduces no new Critical or Important defect.

## Prior finding closure

| Prior finding | Recheck result | Evidence in the repaired contract |
| --- | --- | --- |
| Critical: the reserved postgres-js connection could not execute the planned transaction primitive | Resolved | Plan 06 now defines explicit `BEGIN`, `COMMIT`, and rollback-on-error statements on the reserved handle, forbids base-client and reserved-handle `.begin` usage, checks the backend PID throughout the run, and requires commit and rollback PostgreSQL oracles on that session. |
| Critical: the row blocker prevented the initial column phase from reaching backfill | Resolved | Plan 06 now acquires the candidate row lock from a post-constraint hook after the locking DDL phases have committed, keeps the blocker open for one non-empty batch, releases it, and requires a later batch to fill the row before journaling. |
| Critical: remaining and final counts could bypass the required RLS admin context | Resolved | Plan 06 now requires every remaining-candidate and final count to run in a reserved-handle transaction after setting transaction-local `app.fxl_admin`, runs the scratch migration as a generated `NOSUPERUSER NOBYPASSRLS` database owner, and includes a negative control that sees zero without admin context and all fixtures with it. |
| Important: the interrupted concurrent-index oracle did not retain its snapshot | Resolved | Plan 06 now uses an explicit `REPEATABLE READ READ ONLY` transaction, establishes the snapshot before the build, polls with a finite deadline for the exact backend and `virtualxid` wait state while the index is invalid, and then requires cancellation with SQLSTATE `57014`. |
| Important: plan 06 made plan 05's backfill extractor stale | Resolved | Plan 06 now owns the compatibility edit that locates the exact `-- fxl-phase: backfill-repeat` chunk, and plan 05 requires the same marker-based extraction before adding its upgrade tests. |

## Original blocker closure

| Original blocker | Owning plan | Recheck result |
| --- | --- | --- |
| Critical: a paid v2.3.1 professional one-shot can be materialized again | Plan 05 | Covered by a production-data reconciliation and PostgreSQL upgrade oracles for null-receivable one-shots and non-null split parts. |
| Important: migration 0018 holds its initial access-exclusive lock through long work | Plan 06 | Covered by the phased runner, separate concurrent index phases, bounded skip-locked backfill, final validation, and journal-last contract. |
| Important: authoritative guidance still calls the repair unfixed | Plan 07 | Covered by a conditional documentation update that runs only after plans 06 and 05 verify. |

## Reordered dependency contract

The `06 -> 05 -> 07` sequence is executable.
Plan 06 establishes the phase-marker contract and owns the shared integration-test compatibility edit before plan 05 adds its locked upgrade tests.
The explicit dependency serializes that file overlap.
Plan 07 remains gated on both executable fixes and therefore cannot capture stale or unverified guidance.

## Findings

- Critical: none.
- Important: none.
- Minor: none.

No plan file was edited during this recheck.
