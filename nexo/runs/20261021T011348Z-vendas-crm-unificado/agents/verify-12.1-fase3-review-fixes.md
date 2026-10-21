# Verify 12.1-fase3-review-fixes: FAIL

Blocker/major: `apps/api/src/domains/sales-ops/leads/__tests__/lead-contract.test.ts:166-168` still asserts the old source text `stageChangedAt: new Date()` in lead-service.ts, so the API unit suite is red (1 failed | 1602 passed). The slice changed the product line (lead-service.ts:1304) to `sql\`now()\`` without updating this source-guard test. Fix: change the regex to `/\.\.\.\(stageChanged \? \{ stageChangedAt: sql`now\(\)` \} : \{\}\),/` (keep the key-omission intent).

Green: web suite 156 files / 1968 tests; api integration 61 files / 549 tests; leads-move-concurrency 5/5 runs green; crm-pipeline-history 22/22; web+api lint 0, type-check 0. grep `stageChangedAt: new Date` in apps/api/src non-test: none.
Mutations (reverted, tree clean): hard-coding Nova proposta / commission card gate -> 2 org-modules-shell tests red; legacyKindOf forcing orcamento->conversion -> proposta-stage-modules "orcamentos off" red. Mutating the container's fieldSet door alone stays green (behavior projection carries the case; minor, redundant guard).
Note: mutations were applied in place in the slice worktree and restored (git status clean), not in a scratch copy.
