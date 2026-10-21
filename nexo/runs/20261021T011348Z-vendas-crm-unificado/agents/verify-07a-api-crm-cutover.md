# Verify 07a-api-crm-cutover - FAIL

Verdict: FAIL (1 major: full integration suite is not green because of a test-hygiene defect in the new oracle).

## Commands
- `pnpm --filter @fxl-sales/api lint`: 0 problems. `type-check` (3 tsconfigs): 0 errors.
- `pnpm --filter @fxl-sales/api test`: 106 files, 1555/1555 passed.
- `node --test` local-database-guard + auth-fake-isolation: 38 pass, 0 fail.
- `pnpm --filter @fxl-sales/api test:integration` (serial, once): 58 files, 508 passed, 1 failed (509).
- Failing test: `test/rls/conversion-ingest.test.ts` "writes a valid hash-chained audit ledger". Fails deterministically alone while audit_log holds the 2 rows left by the new oracle; passes 4/4 once they are deleted.

## Findings
- MAJOR: `apps/api/test/rls/crm-cutover-frozen-tables.test.ts` afterAll (line 60-66) calls `deleteCrmForOrgs` and deletes the old tables but never `DELETE FROM audit_log WHERE actor_org_id = ${orgId}`. Its flow writes `lead.deleted` + `lead.restored` (2 rows, org_frozen_*). conversion-ingest verifies a chain from the genesis hash, so any leftover audit row (when audit_log is otherwise empty, as in a clean test DB) turns it red. Fix: add `await adminClient\`DELETE FROM audit_log WHERE actor_org_id = ${orgId}\`;` as leads-lixeira.test.ts:156 does.
- Minor: `scripts/seed-dev.ts` still DELETEs (dev reset only, local guarded) from the three old tables to unblock the sale deletes; no inserts. Acceptable, noted.
- Minor: full-edition create no longer requires clientName (schema now optional); plan-documented behaviour change.

## Acceptance checks
- (1) No reader/writer of the 3 old tables in src/ (only comments in stage-service.ts/schemas.ts, schema.ts definitions); scripts only the dev reset delete. Test uses: migrations tests, frozen proofs, test cleanup. Oracle frozen-tables: mutation (raw UPDATE of old table, name hidden from source scan) turned it RED.
- (2) 0031 part 1 compared by the oracle against 0030; part 2 only INSERT/UPDATE of unified tables, no DROP/DELETE/ALTER. Mutations: ON CONFLICT DO UPDATE -> DO NOTHING on descricao upsert: RED (field values case); drop the old-is-newer guard on the lead UPDATE: RED ("never overwrites a row the NEW code wrote").
- (3) lockLeadBoard present in insertLead, moveLead, deleteLead, restoreLead before row locks; removing it from moveLead: 3 failures in leads-move-concurrency. Seller scope/claim, no_open_stage, soft-delete audit in same tx covered by passing rls tests. Conversion/sale_id, one lead per proposta pass.
- (4) leads-rls, lead-stages-rls, tenant tests pass on unified tables.
- (5) Test diff reviewed: removed expectations are table switches, 4->7 default etapas, W2 seller rule, contact-lead-contract moved into lead-write-contract.test.ts (all rules re-asserted), produtos moved to field values; the "leads edition rejects produtos" case was intentionally dropped (one write schema, plan-listed).
- (6) No fxl-sales events, ledger, outbox or sales tables in the diff.
- No em dash in new text. Slice worktree status unchanged (clean); scratch copy removed; leaked audit rows deleted from the test DB.
