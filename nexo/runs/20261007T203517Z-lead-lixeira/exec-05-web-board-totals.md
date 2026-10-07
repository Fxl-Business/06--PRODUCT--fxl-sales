# Exec 05-web-board-totals

Branch feat/20261007-05-web-board-totals, commit 7e46146 (on f4f9c6a).

## Red
New `lead-board-totals.test.tsx` (38 cases), edited `lead-funnel.test.tsx` and `leads-contact-container.test.tsx`, run before any implementation.
Result: 3 files failed, 49 tests failed, 22 passed (missing exports, stageSummary not wired, funnel signature).
The runner listed all three files (no vacuous pass).

## Green
- Oracle command (3 files): 3 passed, 71 tests passed (lead-board-totals 38).
- `src/sales-ops/leads` folder: 31 files, 366 tests passed.
- Full web suite (`CI=true vitest run`): 127 files, 1699 tests passed.
- `tsc --noEmit` clean; eslint on all 14 changed files clean; no em dash in changed files.
- The pre-existing oracles (columns, list-view, contact-board, full-edition, move-rollback, fanout, lead-conversion, write-surface, api-contract) are green and unedited.

## Deviations and adaptations
1. Plan-check nit 1 applied: `resolveStageAggregates` takes `max(summary, loaded)` per stage (when the loaded cards win, their value total comes with them). Two oracle cases added (pure and board).
2. Plan-check nit 2: with the loaded-cards fallback now derived from `visibleLeads`, the R$ totals, shares and chips also shift during a pending conversion (the badge already did).
3. `useDeleteLead` (real slice 03): variable is the lead id string and it already sweeps every board entry and cancels `queryKeys.leads.all`; the deleted row is found with `flattenLeadPages(previousData).find(id)` per entry, then `patchPairedSummary(boardFiltersOf(key))`. Context extended with `summaries`.
4. Exact revert is asserted with `toEqual`, not `toBe`: TanStack `setQueryData` structural sharing rebuilds the root object, so the restored summary is deep-equal but not reference-identical. Behaviour is the same (restored whole from the snapshot).
5. `useRestoreLead` already invalidated `queryKeys.leads.all`; only its doc comment changed.
6. Added `data-load-more` to the load-more button (the plan's oracle selects it).
7. `useMoveLead` context type moved above its doc comment so the doc stays on the hook.
8. Container test uses the plan's mocks unchanged (no extra `@/auth/react` export was needed).
