# Plan check - fase 1b/1c (05a, 05b, 06, SEAM-CONTRACT)

Verdict: FAIL (1 blocker, 3 major, 4 minor). Everything else in the three plans reproduced cleanly.

## What I ran (own detached worktree, own scratch databases, all dropped; shared DB never touched)

Baseline on the run branch: `node --test scripts/__tests__/*.test.mjs` 112 pass / 0 fail; `vitest run src/db/__tests__` 76 pass.

I applied every embedded block verbatim to a detached worktree (ADR, schema append, finalize helper, drizzle-kit generate, crm-model + package.json export, defaults.ts, `drizzle-kit generate --custom` + 0030 body, parity edit, seed diff via `git apply`, all test files).
- 0029: 10 CREATE TABLE, 10 FORCE RLS, 20 policies, journal gets exactly idx 29. 0030 snapshot equals 0029 apart from id/prevId.
- `crm-schema.test.ts` 26, `crm-schema-rls.test.ts` 45, `crm-defaults.test.ts` 6, `crm-legacy-copy-migration.test.ts` 18 (also under the real 30s timeouts), shared-utils suite 187, API unit suite 1552, `seed-plan` 53, parity 9, scripts 112, additive guard 33 (scans 0029 and 0030 green), single-role contract green.
- `pnpm run type-check` (3 tsconfigs) clean, eslint on the new files clean.
- Existing integration tests on a fresh DB with 0029+0030 applied through the real global-setup path (leads-schema-migration, lead-stages-rls, leads-rls, cadastro-purge, leads-lixeira, finance-integration): all pass. Empty DB only, see defect 1 for the data-dependent breakage.
- Mutation probes on 0030: removing the lead-copy ON CONFLICT is caught (second-run case); an UPDATE on `sales_ops_leads` is caught (additive case); an UPDATE on payables is caught by 3 cases.
- Grep of the embedded SQL and code: 0029/0030 only CREATE/INSERT into the ten new tables, SELECT from sources; FKs point FROM new tables TO clients/people/sales/products. No write to legacy `leads`, `fxl-sales.*` events, payables/receivables/settlements or sales tables. No em dash in any plan.
- 12+ code anchors per plan verified (schema.ts:927/1000/1138/1473, LAST_HISTORICAL_MIGRATION=28, throughTag, scratch-database exports, 0022 RLS block, stages-seed, with-tenant, default-pipeline exports, SLICE-05-HOOK, seed-dev EXPECTED_DELETE_ORDER, seed-plan test tail). The seed diff applies cleanly.

## Defects

### 1. BLOCKER - `purgeOrgLedgerForTests` is not updated; an existing integration test breaks on a seeded dev DB (06, files_modified)

`apps/api/src/db/__tests__/settlement-test-cleanup.ts` `purgeOrgLedgerForTests` (used by `src/domains/integration/__tests__/finance-integration.integration.test.ts`, fixed org `org_fake_integrado`) deletes `sales_ops_leads` then `sales_ops_sales`.
The shared integration DB is the dev DB (`.env` TEST_* all point at database `fxl_sales`), and the dev seed writes leads for `org_fake_integrado`, one with `saleId: saleIdS1` (`apps/api/scripts/seed/plan.ts` ~1467-1700).
When global-setup applies 0030, that lead is copied to `sales_ops_crm_leads` with `sale_id`; the helper then fails with 23503 on `sales_ops_crm_leads_org_sale_fk` (the helper's own comment says a new reference to the sale tree must fail loudly).
Reproduced: running the helper's exact delete sequence on a scratch DB after 0030 fails 23503; the same sequence with the CRM deletes first succeeds.
No plan lists this file; the plans only patch the dev seed. This is the "most likely breakage" and it is real. All other cleanup helpers/tests (about 40 files that delete clientes/pessoas/produtos/propostas/stages) use their own orgs and are unaffected as long as no CRM row exists for those orgs.

Paste into 06:
- `files_modified` add `"apps/api/src/db/__tests__/settlement-test-cleanup.ts"`; `affected_tests` add `{path: apps/api/src/domains/integration/__tests__/finance-integration.integration.test.ts, impact: "its purge helper deletes sales that the CRM copy now references", update: none (helper fixed in step 7), command: "pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run src/domains/integration/__tests__/finance-integration.integration.test.ts", owner: builder}`.
- New step 7 (renumber the old 7 to 8): "In `purgeOrgLedgerForTests`, immediately BEFORE the line deleting `sales_ops_lead_products`, add five lines in this order, same pattern as the neighbours: `DELETE FROM sales_ops_crm_lead_notes`, `sales_ops_crm_lead_followups`, `sales_ops_crm_lead_field_values`, `sales_ops_crm_lead_events`, `sales_ops_crm_leads`, each `WHERE org_id = ANY(${ids})`. Extend its doc comment: 'the unified CRM lead copies restrict-reference the sale, the cliente, the pessoa and the produto'."
- Add one oracle case to `crm-legacy-copy-migration.test.ts`: on the migrated scratch DB (superuser, settlements first via `SET LOCAL session_replication_role = replica`), the helper's delete sequence WITHOUT the CRM deletes rejects with `code: '23503'`, and WITH them succeeds (wrap in a transaction that throws to roll back). I wrote and ran exactly this probe; it passes.
- Run `finance-integration.integration.test.ts` against the dev DB after global-setup applies 0030 (that DB holds the seeded leads).

### 2. MAJOR - 06 oracle fixture misses the AC "leads legados de finder com click/link/conversion" and does not fingerprint ALL source tables

The seed has one bare `INSERT INTO leads (id, org_id, status)`; no `finders`, `referral_links`, `clicks`, `conversions`, `apps`, `products`; `SOURCE_TABLES` has 13 entries and none of those. The request (1c AC) requires finder lead + click + link + conversion and "todas as tabelas de origem" identical.
Paste (tested, oracle stays 18/18 green): replace the `INSERT INTO leads ...` line of `SEED_SQL` with
```sql
INSERT INTO apps (id, slug, name, publishable_key, secret_key_hash, secret_key_prefix, webhook_signing_secret, allowed_redirect_hosts, status, created_by_user_id) VALUES
 ('d0000000-0000-4000-8000-0000000000a1','app-x','App X','pk_x','h','sk_','w','{example.com}','active','user_1');
INSERT INTO products (id, app_id, slug, name, status) VALUES ('d0000000-0000-4000-8000-0000000000a2','d0000000-0000-4000-8000-0000000000a1','p','P','active');
INSERT INTO finders (id, org_id, status, display_name, contact_email) VALUES ('d0000000-0000-4000-8000-0000000000a3','orgA','approved','Finder','f@x.com');
INSERT INTO referral_links (id, org_id, code, finder_id, app_id, product_id, quoted_setup_brl, quoted_monthly_brl, signature, destination_url) VALUES
 ('d0000000-0000-4000-8000-0000000000a4','orgA','CODE000001','d0000000-0000-4000-8000-0000000000a3','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000a2',1000,500,'sig','https://example.com/x');
INSERT INTO clicks (click_id, org_id, link_id, finder_id, app_id, product_id) VALUES
 ('CLICK0000000000000000000001','orgA','d0000000-0000-4000-8000-0000000000a4','d0000000-0000-4000-8000-0000000000a3','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000a2');
INSERT INTO leads (id, org_id, click_id, link_id, status) VALUES ('d0000000-0000-4000-8000-000000000001','orgA','CLICK0000000000000000000001','d0000000-0000-4000-8000-0000000000a4','converted');
INSERT INTO conversions (source, external_order_id, idempotency_key, org_id, link_id, click_id, finder_id, app_id, product_id, quoted_setup_brl, quoted_monthly_brl, realized_setup_brl, realized_monthly_brl, hold_until, closed_at) VALUES
 ('fxl-financiero','ord1','idem1','orgA','d0000000-0000-4000-8000-0000000000a4','CLICK0000000000000000000001','d0000000-0000-4000-8000-0000000000a3','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000a2',1000,500,1000,500,now(),now());
```
and add `'apps','products','finders','referral_links','clicks','conversions'` to `SOURCE_TABLES` (and a spot check `sourceBefore['conversions']!.n === 1`). Update oracle case 2 text from "13 tables" to "19 tables". Optional hardening (untested): build the list from `pg_tables` (all public tables except the ten CRM tables and the drizzle bookkeeping table) so "ALL" is literal.

### 3. MAJOR - "0031 repeats 0030 verbatim" silently loses every edit made between 0030 and the cutover (ADR Consequences + SEAM-CONTRACT rule 2)

0030 is `INSERT ... ON CONFLICT DO NOTHING`. The old API stays the write path until phase 2, so a lead moved, edited, soft-deleted/restored or re-produtized after 0030 is already present in `sales_ops_crm_leads` and a verbatim repeat keeps the STALE copy (value rows and first event too). The ADR only says "rows written in that window are not copied" (new rows), which understates it. The guard forbids DELETE, so a naive refresh is impossible.
Paste into the ADR Consequences and SEAM-CONTRACT rule: "The repeat in 0031 only adds rows that do not exist yet. A lead that already exists in the new table is NOT refreshed. The phase 2 cutover must therefore either (a) make 0031 a resync: after the repeated inserts, `UPDATE sales_ops_crm_leads ... FROM sales_ops_leads` for stage_id/position/stage_changed_at/seller/client/value/lost_reason/sale_id/deleted_* where they differ, `INSERT ... ON CONFLICT (org_id, lead_id, field_id, position) DO UPDATE` for value rows, and a stage_changed event for each changed stage, with a test that mutates the old tables between 0030 and 0031; or (b) dual-write old and new tables from the first phase 2 deploy until the cutover. Choose and test one; a verbatim repeat is not enough." Also change the SEAM-CONTRACT wording "repeats ... verbatim" to "repeats and RESYNCS".

### 4. MAJOR - SEAM-CONTRACT does not tell phase 2 to extend the test cleanups

Today no test writes CRM rows, so 40 cleanup sites are fine; the first phase 2 test that creates a CRM lead will break every `afterAll` that deletes the cliente/pessoa/produto/proposta (restrict FKs) and `purgeOrgLedgerForTests`.
Paste into SEAM-CONTRACT "Rules every later slice must keep": "Any slice that makes a test or fixture write `sales_ops_crm_*` rows must add one helper `deleteCrmForOrgs(orgIds)` next to `deleteSettlementsForOrgs` in `apps/api/src/db/__tests__/settlement-test-cleanup.ts` (order: notes, followups, field_values, events, leads, then pipelines tree: transitions, stages, pipelines, field_definitions, org_modules) and call it before every delete of clientes, pessoas, produtos or propostas (test/rls/*, `*.integration.test.ts`, `purgeOrgLedgerForTests`, `seed-dev.ts` already done in 06)."

### 5. MINOR - 05a step 4 check commands print 11, not 10
The header comment contains the words "CREATE TABLE" and "FORCE ROW LEVEL SECURITY", so `grep -c "CREATE TABLE"` and `grep -c "FORCE ROW LEVEL SECURITY"` print 11. A haiku executor will stop or "fix" it. Replace with `grep -c '^CREATE TABLE'` (10) and `grep -c '^ALTER TABLE .* FORCE ROW LEVEL SECURITY'` (10); `grep -c "CREATE POLICY"` stays 20.

### 6. MINOR - Shared-DB residue risk is unmentioned (06 Risks)
global-setup applies 0030 to whatever legacy leads sit in the shared DB (the dev DB, so seeded leads plus any residue). Add to Risks: "After the first integration run, `sales_ops_crm_leads` holds a copy of every legacy lead in the shared DB. A test that reuses an org with such a lead and deletes its cliente/pessoa/proposta hits 23503. Remedy: re-run the dev seed (SEED_DELETE_ORDER now clears the CRM tables) or delete the CRM rows of that org as the local superuser."

### 7. MINOR - Cliente "vira valor do campo" is met only through the backing column
The request says Cliente becomes the value of the reference field; the plans store it in `client_id` + snapshot and create only the definition row (documented in the ADR). Add one line to the ADR Consequences: "No `sales_ops_crm_lead_field_values` row is written for Cliente by design; the owner accepted the backing-column form (D3)" or confirm with the owner, so Verify does not flag the AC literally.

### 8. MINOR - ADR does not label the untouched high-risk entities as pendencias
1b AC: "entidades de risco alto sem alteração e listadas como pendência". D2 lists them as never touched. Append to D2: "They stay as pendencias of the survey (section 4); a later run owns them."

## Checks that passed without findings
- ADR cites the survey and its sections; EAV vs JSONB is justified.
- Additive guard green on 0029/0030 (run for real); 0029/0030 header and body carry no GRANT/ROLE, no DROP/DELETE/TRUNCATE/RENAME, no UPDATE in 0030.
- 0030 second run is a no-op (oracle case 18 + mutation probe); SQL transition graph equals `planPipelineTransitions` for all three orgs; 16/22 transition counts hold.
- Journal/snapshot procedure matches 0027/0028; `when` monotonic; custom-migration snapshot identical to 0029.
- `files_modified` otherwise complete and inline; commands runnable. `affected_tests` complete except defect 1.
- Dev seed delete order: ordering correct against all restrict FKs, `assertOrderMatches` satisfied (tsc + seed-plan green).
- Dropped: scratch DB `plancheck2_it`, worktree; test-created scratch DBs/roles cleaned (none left).
