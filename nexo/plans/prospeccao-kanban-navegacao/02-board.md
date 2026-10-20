---
id: 02-board
milestone: v4.8.0
status: todo
depends_on: [01-navigation]
files_modified:
  - apps/web/src/sales-ops/leads/LeadsBoard.tsx
  - apps/web/src/sales-ops/leads/LeadCard.tsx
  - apps/web/src/sales-ops/leads/board-ui.ts
  - apps/web/src/sales-ops/leads/board-search.ts
  - apps/web/src/sales-ops/leads/__tests__/board-search.test.ts
  - apps/web/src/sales-ops/leads/__tests__/leads-board-scroll.test.tsx
  - apps/web/src/sales-ops/leads/__tests__/leads-board-keyboard.test.tsx
  - apps/web/src/sales-ops/leads/__tests__/leads-board-search.test.tsx
acceptance: "On the Kanban page, column headers stay visible while each card area scrolls independently and the page itself does not grow with cards; typing a lead name, company, phone, or email filters loaded cards immediately and clearing restores them; every movable card has a Mover action that opens the existing destination dialog, persists through the existing move callback, and leaves drag and drop working."
must_not_break:
  - Existing seller and server scope remain authoritative.
  - Conversion, lost-reason, list-row move, and drag flows keep using the existing move emitter.
  - Converted cards remain read-only.
verifier_focus: "Check board height in the new route, search semantics, card action event isolation, and drag activation."
---

# Kanban column scroll, search and Mover action

## Scope and design

The current board already has `boardFillClass`, `boardViewportClass`, a header outside each `data-stage-scroll` area, and independent `overflow-y-auto` column scrollers.
Keep that structure and make sure the Kanban route from `01-navigation` gives the board a bounded flex parent with `min-h-0` and no document-height growth from card count.
Do not introduce a second scroller for the entire page.
Keep the board's horizontal scrollbar above the columns.
The existing scroll oracle proves DOM structure; add a regression assertion for the routed board's height contract where the navigation slice exposes it.
Visual screenshots are review evidence, not an automated gate.

Add a controlled search field to the Kanban toolbar with an accessible name such as `Buscar leads`.
Filter the already loaded, tenant-scoped `visibleLeads` in memory on each input change by `contactName`, the same resolved company name/snapshot used on the card, `contactPhone`, and `contactEmail`.
Match case-insensitively and accent-insensitively after trimming the query; an empty query restores every loaded card.
Search must affect drawn cards only, not the server summary totals or the seller filter's query keys.
Do not imply a global search over unloaded pages: retain `Carregar mais` and its honest loaded/total count.
An empty search result should show a clear search-specific empty state rather than the normal empty-column hint if a column has loaded cards that the query hid.
Leave the existing list and aggregate Funil behavior outside this slice.

Expose a visible `Mover` button on each non-converted Kanban card with an available move target.
Pass an `onMove` callback through `SortableLeadCard` to `LeadCard`, calling the existing `openMoveDialog` and `emitMove` path.
Use a native button with an accessible name including the lead, and isolate its click, pointer, mouse, and touch events from the card's edit handler and dnd-kit activators.
Generalize the existing card-control guard so the delete menu and Mover button are both protected without disabling drag on the card surface.
Do not add a second mutation path or a stage-only quick move that bypasses required lost reason or conversion.
The `MoveLeadDialog` already chooses a destination and persists through `onMoveLead`; reuse it.

`01-navigation` changes view routing and may edit `LeadsBoard.tsx`.
The explicit `depends_on` edge schedules this slice after the navigation route contract.
Apply this work against the merged route contract and update old toggle-based assertions only where that route contract supersedes them.
Keep the implementation within eight source/test files and about 600 changed lines; if it grows beyond that, ask the orchestrator to split before execution.

## Locked oracle, red first

Add `board-search.test.ts` for normalized matching of name, resolved company/snapshot, phone, email, empty query and non-matches.
Add `leads-board-search.test.tsx` using the real board to type into the search field, observe cards disappear across columns immediately, clear the field, and verify counts/totals remain server-wide.
Extend `leads-board-keyboard.test.tsx` to open Mover from a card without opening edit or starting a drag, choose a destination through the real dialog, and assert one `onMoveLead` payload.
Keep a regression case for mouse or touch drag from the card body; the existing scroll test already exercises dnd-kit sensors and independent column scroll.
Update any prior assertion that intentionally required the Kanban card to have no move trigger.
Extend `leads-board-scroll.test.tsx` only as needed for the navigation contract and assert header is outside each card scroller, the board scroller has no vertical overflow, and the board fills its bounded parent.

Named locked oracle:

```sh
pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/leads/__tests__/board-search.test.ts src/sales-ops/leads/__tests__/leads-board-search.test.tsx src/sales-ops/leads/__tests__/leads-board-keyboard.test.tsx src/sales-ops/leads/__tests__/leads-board-scroll.test.tsx
```

Complete affected suite:

```sh
pnpm --filter @fxl-sales/web test
```

Lint and typecheck:

```sh
pnpm --filter @fxl-sales/web lint
pnpm --filter @fxl-sales/web type-check
```

No plan-specific global guard is touched.
Use run-once commands only.
Store any screenshot under the run's `.nexo/tmp/` and record a visual access issue as a Revisão item without blocking automated green gates.
