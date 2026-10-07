# Plan check - web slices 03, 04, 05 (lead-lixeira)

Verdict: PASS (no blocking defect; nits below).

## Method
- Read 00-OVERVIEW, SEAM-CONTRACT, 03, 04, 05 (and the 01/02 contract surface) against the worktree at d8ccf14.
- Compared the wire with the REAL slice 01 code (lead-routes.ts:176-262, lead-trash-service.ts:49-60, 289).
- Executed in a throwaway copy outside the repo (scratchpad, deleted afterwards): applied the 03 Appendix A patch (git apply clean, 17 files = the 17 in files_modified), ran apps/web `src/sales-ops/leads` + `src/lib` (34 files, 340 tests green, includes the 23 new lead-delete cases), eslint on src/lib and src/sales-ops/leads clean. Then dropped 04's deleted-leads.ts, DeletedLeadsView.tsx, DeletedLeadsContainer.tsx, the new oracle and the query-keys line on top of 03: 17/17 green, `tsc --noEmit` and eslint clean. 03 and 04 compose without touching each other.

## 1. Coverage
- AC1 (kebab + right-click, no drag, no edit): 03 D2/D3, oracle cases on pointerdown guard `startsOnCardMenu`; the board has PointerSensor only (LeadsBoard.tsx:396-399), no KeyboardSensor, no card onKeyDown, so Enter/Space on the kebab cannot start a drag or edit; the click path is guarded in handleClick.
- AC2 Lista `Excluir` after Mover/Editar; AC3 both forms, edit only, converted excluded (container passes undefined); AC4 AlertDialog, never window.confirm (asserted); AC5 converted card has no menu, API 409 mapped to copy.
- AC9/AC10 UI (04): nav entry in both editions, columns, `Autor não identificado`, Restaurar, 400 no_open_stage, 403 inline banner, 404 gone, load more. AC11 (05): badge, R$ total, share, bar, Lista chips/footer, both Funil shapes, load-more label.
- No scope creep beyond small, justified extras: 05 optimistic summary patches on move/delete and the `(100 de 115)` load-more label.

## 2. Wire vs real slice 01
- delete: 204 via `c.body(null, 204)`, 404 `{error:'not_found'}`, 409 `{error:'conflict', reason:'lead_already_converted'}`, 403 `{error:'forbidden', reason}`: matches 03 (apiFetch sets `ApiError.reason` from body.reason, api-client.ts:87). 03 D1 correctly fixes the 204 `res.json()` crash (oracle proves a json()-throwing 204).
- restore: 200 `{lead}`, 400 `{error:'validation_error', reason:'no_open_stage'}` (LeadInputError), 403 via requireAdmin, 404: matches 04 `restoreFailureKind` (status + reason).
- deleted list: `{items, nextCursor}`, DeletedLeadView fields identical to 04's type; cursor is `${at}_${id}` and 04 never renders it. Path `/leads/deleted` registered before `/:id` (lead-routes.ts:172-176).
- 02 summary: `{stages:[{stageId,count,estimatedValueBrl}]}`, no stage join, empty sellerPersonId is 400: 05 sends the param only when set and filters totals to active columns.

## 3. Cross-slice consistency
- Keys: `['leads','board',f]` (existing), `['leads','deleted']` (04), `['leads','summary',f]` (05); all under `['leads']`, so `queryKeys.leads.all` invalidations (03 delete, 04 restore, 05 mutations) reach each other.
- 05 vs 03's real useDeleteLead (checked in the patched copy): it already cancels `queryKeys.leads.all`, invalidates `[queryKeys.leads.all]`, context is `{boards:[{key, previous}]}` holding only boards that contained the lead, `previous` is raw infinite data. 05 step 6c (pair each snapshot's filters via `boardFiltersOf(key)` and patch the paired summary, restore on error) fits exactly; no narrowed key to widen.
- 05 step 6b changes useMoveLead's context type; leads-move-rollback and leads-board-fanout have no summary cache so `patchPairedSummary` returns null and they stay green.
- 05's wave-3 edits to hooks.ts, optimistic.ts, api.ts, deleted-leads.ts, leads-contact-container.test.tsx follow 03/04 sequentially; 05 explicitly keeps 03's `useDeleteLead` mock entry.

## 4. File ownership
- 03 files_modified (17) and 04 files_modified (11) are disjoint (verified by list comparison). 04 only imports `LEADS_PATH`, `LeadResponse`, `noticeClass`, `blockedNoticeClass`, all existing on master. No plan code block references a symbol another plan never defines (05 consumes `useDeleteLead`, `useRestoreLead`, both defined; 05's mock of `@/auth/react` and `../hooks` is told to keep 03's additions).
- SalesOpsApp.tsx: only 04 edits it, outside BOARD-WRITE-FENCE. 03 adds delete-copy.ts and LeadDeleteDialog.tsx to the board-write-surface scan and stays green.

## 5. Correctness / UX
- Menu trigger: guard on card handlers (not stopPropagation, with a sound reason); right-click calls preventDefault and opens the same controlled menu; converted or no-onDelete cards keep the browser menu.
- Escape: AlertDialog and Dialog share Radix's DismissableLayer stack, so Escape closes only the confirm; `useInlineLayer` is for non-Radix inline panels and must not be used here. 03 is right; oracle uses the real Dialog and AlertDialog and proves second Escape closes the form. Focus return handled (D7).
- Copy: no em dash in any plan or new code (grep clean; the two em dashes in api-client.ts are pre-existing comments). No raw id/cursor rendered. Nav: entry appended after Importação and before Geral in full, last in leads edition; `produtos`/`pessoas` stay `[0]`.
- 03 error path: 403 maps through `salesOpsMutationErrorMessage` (status-keyed) inline in the dialog, consistent with "403 on a mutation = MutationErrorBanner copy".
- 05 fallback: pending, failed or non-`stages` body falls back to loaded cards, never 0 (cases 13, 14, 19, 20). Funnel builder signature change is deliberate; lead-funnel.test.tsx keeps every number through `aggregatesFromLeads`.

## 6. Oracles
- New oracles are red on current code (modules or exports absent) and 03/04 were run green after applying. Run commands are correct (run-once, `CI=true`/`vitest run`); 05 correctly warns that `passWithNoTests: true` makes a mistyped path pass vacuously and asks to read the file list.
- 05 was not executed (needs 02 API merged and 03/04 landed); reviewed against 03's real hook and the real LeadsBoard.tsx lines it rewrites (301-329, 725, 738, 758-766 all exist as described).

## Nits (non-blocking)
1. 05 fallback granularity: when a valid summary lacks a stage that has loaded cards (race right after a create, before the invalidation refetch lands), the column shows 0 until the refetch. Optional hardening: per stage use `max(summary, loaded)`. Not required by AC11.
2. 05 changes the fallback figures to derive from `visibleLeads` (they were `leads`) so R$ totals and chips now also shift during a pending conversion, like the badge already did. Deliberate and consistent, but a behavior change; mention in exec notes.
3. 03 command uses `/tmp/slice-03.patch`; prefer the session scratchpad (the user's convention). Harmless.
4. The card (dnd-kit `role=button`) now contains a real button; a nested-interactive a11y smell inherent to the approved design. The kebab has its own accessible name.
5. 03 expects slice 05 to widen nothing; capture (AC12) must rewrite the CLAUDE.md "a card has no buttons" sentence as 03 lists.
