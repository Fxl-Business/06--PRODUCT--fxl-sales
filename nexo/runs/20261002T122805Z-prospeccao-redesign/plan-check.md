# Plan-check: prospeccao-redesign

execution_ready: false

Adversarial review of the plan-set against the README brief, the binding write-surface oracle, and the current `leads/` code.
One blocking defect: slice 04 removes the board card's `data-move-trigger`, but a full-app integration oracle that is in NO slice (`lead-conversion.test.tsx`, 8 tests) drives the board through exactly that attribute, so the complete web suite goes red at the slice-04 wave boundary - the precise failure mode the serial ordering was designed to prevent.

The design spine is otherwise sound: the stage-color object-lookup (`KIND_COLORS[stage.kind]` + `stageIsNormal` via `!KIND_COLORS[...]`) does NOT trip any write-surface regex; the serial order 01->04 is correct for every oracle EXCEPT the one listed below; all invented symbols resolve; the lucide icons exist.

## blocking

### B1 - Slice 04: `lead-conversion.test.tsx` breaks and is declared in no slice

- **Where**: `apps/web/src/sales-ops/leads/__tests__/lead-conversion.test.tsx:449-460` (helper `moveIntoConversionColumn`), consumed by 8 tests (`:477, :499, :539, :571, :589, :610, :624, :634`).
- **What's wrong**: that helper opens the move flow with `await click(required(\`[data-move-trigger="${LEAD_ID}"]\`))` while the app is in the DEFAULT **Quadro** view. Slice 04 explicitly REMOVES `data-move-trigger` from the card (04 rules line 21: "REMOVER data-move-trigger e data-edit-lead DO CARD"). `required()` throws "not found", so all 8 tests fail. The file is in no slice's `files_modified` and no slice's `must_not_break`, so a literal executor never touches it. 00-OVERVIEW:60-61 claims the full suite stays green at every wave boundary because slice 02 introduces the List-mode `data-move-trigger` before slice 04 removes the card's - but that only rescues oracles that drive through List mode. `lead-conversion.test.tsx` drives through the **Quadro** card and is never switched to List mode. This is the same hole the feature's own binding note warns about, missed for this one file.
- **Minimal plan edit**: add `apps/web/src/sales-ops/leads/__tests__/lead-conversion.test.tsx` to slice 04 `files_modified`, and in slice 04's "Reescrita dos oráculos" add: rewrite `moveIntoConversionColumn()` to first `await click(required('[data-view-option="list"]'))` and then click the List row's `[data-move-trigger="${LEAD_ID}"]` (the List "Mover" button, which `openMoveDialog`s the same dialog with the conversion stage among its targets), keeping the rest of the flow (destination picker "Proposta enviada" -> `[data-move-confirm]`). The converted-card test at `:646-664` stays as-is: it never calls the helper, runs in Quadro, and its assertions (`[data-move-trigger]` null at `:655`, `[data-conversion-column]` textContent "Ganha" at `:658`) remain valid because slice 03 keeps `data-conversion-column` and slice 04 makes `data-move-trigger` null for every board card.

## non_blocking

### N1 - Slice 02: `[data-leads-board]` is the permanent outer wrapper, so it cannot witness "board hidden"
- `LeadsBoard.tsx:339` puts `data-leads-board="true"` on the OUTERMOST div, which also wraps the toolbar, MoveLeadDialog and "Carregar mais" (all kept outside the view conditional). Slice 02 Red item 1 says clicking List "esconde o board" and checks `[data-leads-board]`. That attribute is always present, so an executor that asserts its absence in List mode writes a permanently-failing oracle.
- Fix: assert board visibility via a marker INSIDE the conditional - `[data-stage-column]` or the `.overflow-x-auto` scroller - present in Quadro / absent in List; or add a distinct `data-leads-board-view` marker on the conditional board region. Leave the outer `data-leads-board` wrapper alone.

### N2 - Slice 03: dead imports will fail `no-unused-vars` lint
- Slice 03 replaces `<header className={columnHeaderClass}>` (LeadsBoard.tsx:402) with `columnHeaderCardClass`, and replaces the empty-column `<p className={mutedStateClass}>` (LeadsBoard.tsx:436) with the dashed `data-empty-column` block. That leaves the imports `columnHeaderClass` (LeadsBoard.tsx:28) and `mutedStateClass` (LeadsBoard.tsx:33) unused. `pnpm run lint` on the diff then fails. Slice 03 should state: remove the now-dead `columnHeaderClass` and `mutedStateClass` imports (keep `cardButtonClass`, still used by "Carregar mais" at LeadsBoard.tsx:466).

### N3 - Slice 01 -> 03 transient visual regression on the Quadro day badge
- Slice 01 correctly strips color out of `daysBadgeClass` (geometry only) so color comes from `dayBadgeTone` (this is the right call - two conflicting `bg-[...]` utilities do NOT override by className order, only stylesheet order, so composition must put color in a separate token). But `LeadCard.tsx:120` still renders bare `daysBadgeClass` until slice 04 adopts `${daysBadgeClass} ${dayBadgeTone(days)}`. Between slices 01 and 03 the card badge loses its grey pill background. No oracle breaks (`lead-card-days-parked.test.tsx` asserts only the data attr, text and aria-label), and slice 04 restores it. Acceptable; noted so it is not mistaken for a defect mid-feature.

### N4 - "Novo lead" Plus icon never added
- README:32 specifies the primary button "Novo lead" with a "+" icon, and 00-OVERVIEW:38 lists `Plus` among the icons to use, but slice 02 keeps the button "inalterado" (LeadsBoard.tsx:359-363, text-only). Minor fidelity gap; either add the `Plus` icon in slice 02 or drop `Plus` from the 00-OVERVIEW icon list.

### N5 - Slice 04 activation guard is adequate, with a minor caveat
- The pointer-distance guard (`Math.hypot` > 6px between `pointerdown` and `click`) satisfies "click does not edit at the end of a drag". `pointerDown.current` is set on every pointerdown and cleared at click entry, so it is read exactly once per click - fine. It is not cleared on `pointerup`/`pointercancel`, but since it is only consulted inside `handleClick` and reset there, a stale start cannot leak into a later unrelated click. The happy-dom test (synthetic `pointerdown` at (0,0), `click` at (20,20)) will exercise it because happy-dom carries `clientX/clientY` on the synthetic events and React forwards them. No change required.

### N6 - Slice 04 keyboard oracle: board-mode move-trigger presence assertions must be re-pointed
- `leads-board-keyboard.test.tsx:361-362` asserts `[data-move-trigger="${LEAD_B}"]` is NOT null in Quadro; after slice 04 it IS null for every board card. Slice 04 already lists this file and instructs a rewrite "via o modo Lista", which covers it, but the plan should name these two lines so the executor re-points them (switch to List, then assert the row's `data-move-trigger`) rather than only the generic `openMoveDialog` helper.

## Checks that PASSED (for the record)
- Write-surface safety: `stageColors`/`stageIsNormal`/`KIND_COLORS` use object-lookup only; no `kind === 'normal'|'lost'`, no `kind === 'conversion'` outside `board-move.ts`, no `'converted'`, no `/transition`, `transitionSale`, own `useMutation`, or `@/lib/api-client`/`@/lib/app-mutation`. The oracle regexes (board-write-surface.test.ts:171-180) match only the literal `kind === '...'` forms, so the lookup approach is safe.
- Symbols referenced by the plans all exist: `formatMoneyBrl(cents, {minimumFractionDigits,maximumFractionDigits})` in `sales-ops/calculations.ts` (reached as `../calculations` from `leads/`); `describeDaysInStage` in `board-move.ts`; `daysInCurrentStage`/`leadIsConverted`/`boardStages`/`leadsInStage`/`conversionStage`/`lostStage` in `leads/calculations.ts`. New symbols `stageColors`/`stageIsNormal`/`dayBadgeTone`/`avatarInitials` are net-new in slice 01, consistent with their consumers.
- lucide-react@0.475.0 exports `SquareKanban`, `List`, `Plus` (and the deprecated `KanbanSquare` alias the plan correctly avoids).
- All new data hooks (`data-view-option`, `data-view-toggle`, `data-leads-list`, `data-phase-chip`, `data-list-row`, `data-list-total`, `data-empty-column`, `data-stage-total`, `data-stage-bar`, `data-stage-count`, `data-view-in-list`) are net-new (no pre-existing collisions).
- String-breakage grep: the board empty text "Nenhum lead nesta etapa." (LeadsBoard.tsx:436) and the card "Valor estimado" label (LeadCard.tsx:108) are asserted by NO test; `lead-dialog.test.tsx:231` asserts "Valor estimado (R$)" which is the untouched LeadDialog form label, not the card. So slice 03's board-empty swap and slice 04's label removal break nothing beyond B1.
- Serial order 01->02->03->04 keeps every oracle green at each boundary EXCEPT for B1 at the slice-04 boundary.
