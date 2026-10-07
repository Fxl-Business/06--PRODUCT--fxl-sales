# Verify 03-move-lock-order (b6066dd): PASS

1. Diff c6289bd..HEAD: only lead-service.ts and leads-move-concurrency.test.ts; no schema/migration; 0 em dashes. PASS
2. `VITEST_INTEGRATION=1 pnpm exec vitest run test/rls/leads-move-concurrency.test.ts` x3: 5/5, 5/5, 5/5. PASS
3. Mutant (both `await lockLeadBoard(tx, orgId);` calls commented out via perl): 4 failed, 1 passed; 40P01 on two move tests, create and import-shaped tests also red. Restored via git checkout; git status clean, git diff empty. PASS
4. Regression integration (leads-unassigned-claim, leads-seller-scope, leads-edition, leads-rls, lead-stages-rls, import executor + import-routes integration): 7 files, 93/93. Unit src/domains/sales-ops/leads + src/domains/import: 20 files, 339/339. PASS
5. Review: one private lockLeadBoard (pg_advisory_xact_lock(hashtext('fxl-sales:lead-board'), hashtext(orgId))); called in insertLead after scope gate before MAX(position), and in moveLead after scope gate before the FOR UPDATE read; not in applyLeadUpdate/getLead/listLeads; no export change. PASS
6. eslint on both files exit 0; tsc --noEmit exit 0; tsc -p tsconfig.test.json exit 0. PASS
