# Plan check: 03-move-lock-order

Verdict: PASS (executable as written, no blocking defect). Notes below.

## 1. Deadlock freedom
- Writers of `sales_ops_leads.stage_id/position`: only `lead-service.ts` (`insertLead` ~L873, `moveLead` L1093). Grep of src, scripts and test shows no other writer (seed-dev and test files are out of band). So every board writer takes the board lock; the set is complete.
- Order after fix: gate (L881 / L1101) -> board advisory lock -> identity FOR UPDATE (L1109) / MAX read -> UPDATE/INSERT -> renumber (L1178-1179). Two board writers cannot hold lead rows while waiting on each other: the second waits holding no lead row.
- `applyLeadUpdate` (L994-1010): gate then single-card FOR UPDATE, never asks for the board, only waits on ONE card or an FK KEY SHARE; the board holder never holds anything the PATCH needs except the very card it may be waiting for. No cycle.
- `reorderLeadStages` (stage-service L219): locks stage rows FOR UPDATE, then updates stage rows only, no lead read or write, no board lock. Lead INSERT/UPDATE FK checks take KEY SHARE on stage rows and just wait; reorder never waits on a lead writer. No cycle. `createLeadStage`/`updateLeadStage` likewise touch no lead.
- Import executor (executor.ts L329/L340): `createLead` then `moveLead` on one tx. Lock is re-entrant in the same tx; a released SAVEPOINT passes the lock to the parent (Postgres subtransaction commit semantics). Import seeds etapas/funcoes BEFORE the executor, so it holds no board lock while waiting on seed conflicts.
- Gate before lock is sound: the gate can wait on unique-index conflicts (leads-edition provision, funcoes seed vs an import's uncommitted seed) and take a people-row lock (self-claim UPDATE, L~190). Under the board lock a provisioner could hold the board while waiting on an import that waits for the board. Gate-first means a gate-holder only waits for the board while holding rows nobody on the board path needs (uncommitted own person/funcao rows are invisible to others; self-claim is FOR NO KEY UPDATE because the hub_account index is partial, schema.ts L501-503, so it never conflicts with lead FK KEY SHARE). Verified.
- Conversion (POST /sales then move): separate transactions; nothing in sales code touches `sales_ops_leads` (grep). `moveLead` only takes KEY SHARE on the sale row. No cycle.
- The stale gate (canClaimUnassigned computed before the lock) is a fresh-statement read race of milliseconds; the identity read after the lock is fresh. Acceptable.

## 2. Advisory lock correctness
- `pg_advisory_xact_lock(hashtext('fxl-sales:lead-board'), hashtext(orgId))`: two-int4 form, different key space from the only other advisory lock (migration-runner.ts L282/L714, single bigint). No other `pg_advisory` in the repo. Released at COMMIT/ROLLBACK on every path (`{ok:false}` commits, thrown LeadInputError rolls back). Re-acquire in one tx is immediate. A lock taken in a savepoint that is ROLLED BACK is released, but every import failure aborts the whole tx, so nothing relies on it.
- Hash collision only merges two orgs' queues.

## 3. Behaviour kept
- Only two statements added plus comments; the `stageChanged ? {stageChangedAt}` spread, already_converted, lost reason, conversion sale checks, claim, renumber order are untouched. Case 3 (claim race) stays deterministic: the loser waits on the board, then its fresh identity read finds seller=Ana and answers not_found. Slice 01 race tests (raw row holder) still park Bruno on the card after he takes the free board lock.

## 4. Throughput
- Per-org serialization of drags/creates is fine for a kanban (ms per move). Note (non-blocking): an import holds the board for its whole tx, and each waiting request holds a pooled connection (api pool max 10, db/client.ts L29) with no lock_timeout. A long import with many active vendedores could drain the pool for other endpoints. Today the same import already blocks on column row locks, so this is not a regression of kind; the plan Risks section covers the wait but not pool pressure. Optional follow-up, not required for this slice.

## 5. Oracle quality
- Traced each case against the code: case 1 and 2 deadlock on the old order only after `hold.release()` (Ana needs the other's card), 40P01 surfaces as a rejected outcome, reported by SQLSTATE; case 4 holds the INSERT on the vendedor FK KEY SHARE vs FOR UPDATE (conflicting modes) after MAX is read, old code finishes the second create first (settled branch), new code parks it on the board; case 5 old code moves without waiting and leaves the gap, new code waits behind the import pid. Expected final columns recomputed by hand and match.
- Determinism: no sleep-based races; waits are `pg_blocking_pids` keyed on backend pids, 5s cap, per-test orgs, holds released in finally. Assertions are outcome-based, not vacuous (dense lists compared exactly, claim ownership, stage_changed_at byte equal, rejection as data).
- Imports resolve: `CreateLeadSchema`/`MoveLeadSchema` (lead-schemas.ts L80/L88), `LeadScope`/`LeadView`/`WriteLeadResult`/`createLead`/`moveLead` exported, `ensureLeadStagesForOrg`, `PersonSchema`/`createPerson`/`withTenant` exported from service.ts, `testDatabaseUrls` path exists. Run command is correct (`test:integration` = `VITEST_INTEGRATION=1 vitest run`, include `test/rls/**`, 30s timeout).
- I did not re-run the red/green (read-only role); the plan records 3 red and 5 green runs plus a mutation check.

## 6. Scope hygiene
- files_modified = lead-service.ts + the new test; wave 2 has only this slice; no CLAUDE.md or knowledge edits (suggested lines are Capture notes only); no em dash in the plan (grep clean); the new comments avoid the strings `lead-contract.test.ts` forbids (auditLog, getAdminDb, isSeller, salesOpsClients, computeSaleFinancials).

## Nits
- Pool-pressure note above (optional).
- Comment says lock "passes to the parent when the savepoint is released"; true, and a rolled-back savepoint releases it - harmless here, could be one clause longer.
