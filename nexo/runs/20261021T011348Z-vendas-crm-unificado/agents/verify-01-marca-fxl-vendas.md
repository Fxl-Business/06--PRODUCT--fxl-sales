# Verify 01-marca-fxl-vendas - PASS

Commands (slice worktree, DB suite not run as instructed):
- node --test scripts/__tests__/brand-and-technical-ids.test.mjs: 20/20
- web vitest (panel, dead-end, AdminSellersPage, src/sales-ops/import): 139/139 (7 files)
- api vitest src/domains/import: 325/325 (16 files)
- no-legacy-env-names + auth-fake-isolation: 29/29
- web and api lint + type-check: 0 errors
- package.json test script includes the new guard file

Independent grep: no user-visible "FXL Sales" / bare "Sales" left in apps/web/src, index.html, apps/api/src (remaining hits are comments, README, docs, test fixture useProducts.test.ts). No em dash in diff. Technical ids untouched (diff shows none renamed).

Mutations in scratch copy (git archive): literal in missing-entitlement-copy.ts red; JSON "Fxl Sales" red; renamed storage key red; missing index.html red (loud); bare "dentro do Sales" red; comment-only "FXL Sales" stays green. Worktree status unchanged.

Findings:
- minor: download filenames (fxl-sales-importacao.xlsx) are not covered by the brand regex (needs a space), so a regression in types.ts/routes.ts passes the guard. Fix: pin the 4 filename constants as positive assertions.
