# Verify 01-api-lixeira (commit ad74ef0, base 1501b03): PASS

1. Diff: 16 files, all in plan files_modified; em dash count 0; nexo/ files 0.
2. Integration (cd apps/api; VITEST_INTEGRATION=1 pnpm exec vitest run test/rls/leads-lixeira.test.ts test/rls/lead-soft-delete-migration.test.ts test/rls/leads-schema-migration.test.ts): 3 files, 26/26, run twice, both green.
   Unit (vitest run lead-soft-delete-schema, lead-routes, lead-contract, edition-gate-map): 4 files, 260/260.
3. Oracle quality: leads-lixeira.test.ts has 10 tests with real assertions for every AC (admin/vendedor/pool delete, 404 colleague, 409 converted, list rows+total, get/update/move, dense renumber, no claim, audit entry + hash + commit-probe trigger for atomicity, restore own/first-open/no_open_stage, route-level 403, keyset/order/no deletedByUserId, cross-org).
   Mutant: removed liveLeadCondition() from listLeads conditions: 3 failed | 7 passed (red). Restored with git checkout; git status clean.
4. Diff review: migration 0028 is additive (3 nullable columns, CHECK, partial index, no data rewrite); journal idx 28 after 0027; snapshot prevId equals 0027 id. lockLeadBoard precedes row lock in delete and restore; delete uses leadIdentityConditions (same as read scope); /deleted and restore are requireAdmin; /deleted registered above /:id; audit written with tx last; lead-service.ts has no audit/getAdminDb text; deleted_by_user_id never selected; edition-gate-map has 3 OPEN entries.
5. Regression integration: 14 files, 140/140 (leads-unassigned-claim, seller-scope, move-concurrency, edition, rls, schema-migration, contact-fields-migration, stages-rls, no-financial-impact, audit-history-org-scope, cadastro-archive-audit, import executor/catalog/routes). Unit src/domains/sales-ops/leads src/middleware src/domains/audit src/db: 21 files, 425/425.
6. tsc --noEmit: 0; tsc -p tsconfig.test.json: 0; eslint on changed ts files: 0.
