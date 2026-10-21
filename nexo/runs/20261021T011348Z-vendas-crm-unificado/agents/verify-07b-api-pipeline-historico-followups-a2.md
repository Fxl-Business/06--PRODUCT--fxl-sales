# Verify 07b-api-pipeline-historico-followups, attempt 2

Verdict: PASS

## Commands
- `VITEST_INTEGRATION=1 npx vitest run test/rls/crm-pipeline-history.test.ts` on the real code, 3 runs: 18/18 each time (lock-order case about 320-400ms, not flaky).
- `pnpm --filter @fxl-sales/api test:integration` (serial): 59 files, 527/527 passed.
- `pnpm run lint`: 0 problems. `pnpm run type-check`: 0 errors (api, web, shared, auth-fake).

## Mutation probes (scratch copy, worktree untouched; git status identical before and after)
- A: `lockLeadBoard` moved after the card `FOR UPDATE` in `advanceLead`: RED 3/3 runs, `1 failed | 17 passed`, SQLSTATE 40P01 (deadlock detected). The case bites now.
- B: `lockLeadBoard` removed entirely from `advanceLead`: stays GREEN 3/3. Explanation: with a single lead id all writers serialize on the same card row `FOR UPDATE`, and `advance` has no second lock resource taken in opposite order, so no cycle forms; the case only detects the inversion (lock after row lock), which is the actual regression class. Minor, not blocking.

## Findings
- minor: `nexo/knowledge/reference/kanban-de-leads.md:106` (Funil shapes bullet) still says "There is NO stage history (`sales_ops_leads` holds only the current `stage_id`...)". Stale after the stage-history work; CLAUDE.md wording was aligned in 06f317b but this reference line was not. Fix: reword to say the cumulative shape stays a linear assumption by design while history now exists.
- minor: probe B above (full removal of the lock not caught).
