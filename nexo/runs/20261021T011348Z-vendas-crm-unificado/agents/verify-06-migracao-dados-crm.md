# Verify 06-migracao-dados-crm - verdict PASS

Commands (slice worktree, CI=true, one at a time):
- Oracle `test/rls/crm-legacy-copy-migration.test.ts` (VITEST_INTEGRATION=1): 19/19.
- Parity + seed-plan + src/db/__tests__ (includes additive guard): 10 files, 164/164.
- `pnpm --filter @fxl-sales/api test:integration` (whole suite, applies 0030 to shared DB): 55 files, 485/485 (includes crm-defaults no-pipeline guard, finance-integration purge helper, leads-schema-migration).
- API lint 0, type-check (src, scripts, test) 0. No em dash in new text. Slice worktree status clean before/after.
- Shared dev DB after suite: sales_ops_crm_leads 54 = sales_ops_leads 54.

SQL read: after the set_config, every statement is INSERT INTO one of 7 CRM tables, all ON CONFLICT DO NOTHING; no UPDATE/DELETE/DROP/TRUNCATE/RENAME/GRANT/ROLE. Legacy `leads` is not read. No triggers on the CRM tables (only settlements has triggers), so no side-effect writes.

Acceptance clauses all asserted (full org with won/lost/converted/soft-deleted/unassigned leads, Construbom org, org without etapas, finder chain apps/products/finders/links/clicks/conversions/leads, same ids, counts and value sums, first history event = stage_changed_at, Cliente system non-removable backing client_id, free and catalog produtos, legacy leads not copied, FK orphans 0, RLS, second run no-op, purge helper 23503 probe).

Mutation probes (scratch copy of apps/api with own drizzle dir; worktree untouched), all RED:
- value column replaced by 0: 2 failed
- copy legacy leads into crm_leads: 2 failed
- skip soft-deleted leads: beforeAll fails (event FK), 19 not run
- remove ON CONFLICT of lead copy: idempotency test failed
- UPDATE receivables: 3 failed; DELETE lead_products: 3 failed
- skip free produtos: 1 failed; event time = created_at: 1 failed
- Cliente without backing column: 1 failed; no history event: 1 failed
- extra: widened fingerprint to ALL 37 non-CRM public tables: still 19/19 green; INSERT into unlisted sales_ops_areas: red (additive/prefix case plus fingerprint).

Findings:
- minor: oracle SOURCE_TABLES has 19 of 37 non-CRM tables (omits audit_log, sale_items, sale_professionals, areas, funcoes, person_funcoes, product_funcao_costs, commissions, payouts, sellers, hub_bff_*, etc.). Mitigated: statement-prefix check proves only 7 CRM targets are written, and I verified all 37 unchanged in a widened scratch run. Optional fix: build the list from pg_tables.
No blocker or major.
