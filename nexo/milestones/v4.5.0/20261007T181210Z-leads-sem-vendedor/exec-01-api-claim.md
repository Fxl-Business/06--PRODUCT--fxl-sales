# exec 01-api-claim

Commit: 7884a82 on feat/20261007-01-api-claim.

Red (before implementation): oracle run had 11 failed of 13 new/rewritten cases (the rewritten leads-seller-scope pool case plus 10 of 11 in leads-unassigned-claim; only AC8 passed, as planned). Both race cases timed out at ~6s because the pool lead was invisible to the second vendedor.
Needed `pnpm run build:packages` first (shared-utils dist missing in the fresh worktree).

Green: oracle 2 files, 29 tests pass. Regression integration (leads-edition, no-financial-impact, leads-rls, lead-stages-rls, executor.integration) 55 pass. Unit set (leads __tests__ + plan-leads) 67 pass.
Type-check (src, scripts, test tsconfigs) clean. eslint on the 5 changed files clean. `git diff --stat -- apps/api/drizzle` empty. No em dash.

Deviations: none. Followed plan steps 1-11 verbatim.
Follow-up noted by plan (not fixed): moveLead/renumberStage lock-order deadlock risk (40P01) under concurrent moves in the same column; consider a per-org advisory lock.
