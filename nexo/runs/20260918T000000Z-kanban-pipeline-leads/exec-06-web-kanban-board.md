# exec 06-web-kanban-board

Branch `feat/20260918-06-web-kanban-board`, three atomic commits.
Status: **PASS**.

| commit | scope |
|---|---|
| `2336d60` | `chore(web)` the pinned dnd-kit dependency + `optimizeDeps` |
| `e64863b` | `feat(leads)` the pure `board-move` / `board-labels` / `board-ui` layers and their oracles |
| `c04bf32` | `feat(leads)` the board, card, move dialog, lead dialog, container and the three `.tsx` oracles plus the structural guard |

## Commands actually run, at the end, on the committed tree

| command | result |
|---|---|
| `pnpm --filter @fxl-sales/web test src/sales-ops/leads` | 11 files, **84 passed** |
| `pnpm --filter @fxl-sales/web test` | 67 files, **868 passed** |
| `pnpm run lint` | Done, 4 projects, 0 errors |
| `pnpm run type-check` | Done, 4 projects, 0 errors |
| `pnpm run build` | `built in 1.68s` |

Baseline for comparison: the web suite was 856 before this slice; the 12 added tests are this slice's.

## The dependency

`pnpm --filter @fxl-sales/web add --save-exact @dnd-kit/core@6.3.1 @dnd-kit/sortable@10.0.0 @dnd-kit/utilities@3.2.2` reached the registry and wrote three BARE versions.
Confirmed by re-reading `apps/web/package.json`: no caret on any of the three.
The park condition did not fire.
`@dnd-kit/accessibility` is left unpinned on purpose (a transitive), and no `pnpm-workspace.yaml` override was added, because nothing else in the workspace depends on `@dnd-kit/*`.

## Divergences from the plan, where the SHIPPED slice-04 / slice-03 code won

Recorded here because the executor contract requires it, and all three are the shipped wire contract rather than a choice.

1. **`lead.companyName` does not exist; the field is `clientNameSnapshot`, and it is NOT NULL.**
   Same for the seller: `sellerNameSnapshot`, NOT NULL.
   `leadCompanyLabel` / `leadSellerLabel` therefore resolve cadastro row, then the non-blank snapshot, then `Sem empresa` / `Sem vendedor`.
   Behaviour is exactly what the plan described; only the field names moved.

2. **`SaveLeadProductPayload` is the WRITE shape `{productId?, productName?}`, not the read shape `{productId, productNameSnapshot}`.**
   The plan's oracle 3 asserted `{productId: null, productNameSnapshot: 'Integração X'}`; the shipped `LeadProductSchema` is `.strict()` and would answer 400 to that body.
   The oracle now asserts `{productName: 'Integração X'}`, which is the same fact on the real wire.

3. **`LeadDialog` has NO `Etapa` picker, and the `stages` prop is gone from `LeadDialogProps`.**
   `CreateLeadSchema` / `UpdateLeadSchema` are `.strict()` and declare no `stageId`: a new lead always lands in the first active `kind = 'normal'` stage by position, deliberately, so a card born converted or lost is not expressible rather than merely rejected.
   A picker there could only ever offer a value nothing reads.
   The plan's oracle 7.4 #5 (`offers only open stages when creating a lead`) is therefore replaced by `offers no etapa picker at all, because the API assigns the stage`, which asserts both the absent control and the absent payload key.
   **Handoff consequence for slice 07:** do not pass a `stages` prop to `LeadDialog`; it does not take one.

4. **`SaveLeadPayload.clientName` is REQUIRED (`min(1)`) even when `clientId` resolves.**
   The dialog therefore always sends a non-empty `clientName`: the picked cliente's label when one is picked, the free text otherwise.
   The server overwrites the snapshot from the cadastro row anyway, so the value only has to be present.
   `blocks Salvar` fires on a blank contact name OR a blank empresa, and `picks a cliente and sends its id alongside the resolved name` pins the pair.

## Two oracle weaknesses found by mutation testing, and fixed

Both were caught by actually running the mutations rather than by reading the plan, and both would have shipped a green check over nothing.

**A. The plan's 5b did not separate a read-only CARD from a read-only COLUMN.**
The plan's wording - render a non-converted lead *alongside* the converted one and assert the conversion stage is among its destination options - puts the non-converted lead in a DIFFERENT column, so zeroing `targets` for every card sitting IN the conversion column left it green.
Mutation `M6` (`const targets = stageOpensConversion(stage) ? [] : moveTargetsFor(...)`) survived all 11 oracles.
Added `keeps a NON-converted card in the conversion column fully movable`, which puts both cards in the SAME column and asserts only the converted one is inert.
`M6` now reddens exactly that one test.

**B. The inline-layer oracle 1 was the exact false positive the plan warns about, in a second form.**
Replacing `DialogContent` with `<div role="dialog">` left oracle 1 GREEN: with no Radix, no capture-phase listener exists at all, so `onOpenChange` is never called and `not.toHaveBeenCalled()` passes vacuously.
Only oracle 2 went red.
Both Escape oracles now carry the positive control in the same test - a second Escape with nothing inner open MUST call `onOpenChange(false)` - so the same mutation reddens oracle 1 too.

## Non-vacuity, measured

Every mutation below was applied, run, and reverted; the file was restored from a byte copy each time and the suite re-confirmed green afterwards.

| mutation | oracle that went red |
|---|---|
| delete `moveTargetsFor`'s `leadIsConverted` early return | `offers no move target at all for a converted lead` (only) |
| key the refusal on the STAGE instead of the lead | `still offers every target for a NON-converted lead sitting in the conversion stage` (only) |
| delete `validateMove`'s lost-reason rule | 3 in `board-move`, plus `blocks the confirm button until a lost reason is typed` |
| neutralise the own-column branch of `movePositionOptions` | `offers the lead's own column as a target, without its own current slot` (only) |
| `onMoveLead(payload)` BEFORE awaiting `onRequestConversion` | both conversion oracles |
| make the whole conversion COLUMN read-only | `keeps a NON-converted card in the conversion column fully movable` |
| give a converted card a move trigger | `renders no move trigger and no drag handle on a converted card` |
| `<div role="dialog">` instead of `DialogContent` | both move-dialog Escape oracles |
| remove the confirm button's `disabled` guard | `blocks the confirm button until a lost reason is typed` |
| a `useState` mirror of the `leads` prop | `holds no local copy of the lead list` |

**The design claim, proven rather than described.**
With every dnd-kit import, the `PointerSensor`, `DndContext`, `SortableContext`, `useSortable` and `handleDragEnd` stripped out of `LeadsBoard.tsx`, **all 12 keyboard oracles stayed green**.
Deleting the drag layer removes a convenience, not a capability.

`board-write-surface.test.ts` carries the mandatory planted-violation control and asserts all four planted defects are reported, so the scanner cannot glob zero files and stay green.

## Contract points held

- `LeadStageKind` is the shipped three-member union; the literal `'converted'` appears in no file this slice wrote, and the write-surface scanner fails if it comes back.
- No `stageIsReadOnly` anywhere. `leadIsConverted` is imported from slice 04 and is the only read-only predicate.
- No `board-model.ts`, no `LeadMoveCommand`. The payload type is slice 04's `MoveLeadPayload`.
- `moveTargetsFor` offers the conversion stage to a non-converted lead when a handler is attached, and offers nothing to a converted one.
- The lost reason is blocked in the UI before the request is built, in addition to the API's own refusal.
- The days badge reads `stage_changed_at` through slice 04's `daysInCurrentStage`.
- Every move is optimistic through slice 04's `useMoveLead`; the board holds no second source of truth.
- Native `<select>` / `<option>` / `<datalist>` and raw `<input type="number">`: none, and repo lint confirms it.
- `SalesOpsApp.tsx`, `navigation.ts` and slice 04's five files plus `lib/query-keys.ts` are byte-unchanged (`git diff --stat` over those paths is empty).
- Slice 05's `LeadStagesView.tsx` was never opened.

## One engineering note worth carrying forward

The repo's `eslint-plugin-react-hooks@7` enforces `react-hooks/set-state-in-effect`, which rejects the plan's "reset local state in a `useEffect` keyed on `open` and `lead.id`" idiom outright.
Both dialogs are therefore **mount-scoped**: they seed from `useState` initializers and the caller mounts them only while open, keyed by the entity's id (`key={moveLead.id}`, `key={dialogSeed?.id ?? 'novo'}`).
That is a stronger guarantee than a reset effect, because a reset effect has to remember every field while an unmount cannot forget one, and the plan's requirement ("a cancelled move leaves nothing behind") is met structurally.
`MoveLeadDialog`'s two pickers are stored as an OVERRIDE over a derived default (`stagePick ?? seedStageId`, `indexPick ?? positionOptions[0]?.index`), which is what lets the position re-seed itself when the destination changes with no state written outside an event handler.

## Handoff, unchanged from the plan except where noted above

- **Slice 07** mounts `<LeadsBoardContainer>`, never `<LeadsBoard>`, and builds `sellers` with `SalesOpsApp.tsx`'s own `hasFuncao` - never a slug comparison and never `is_seller`. It passes NO `stages` prop to `LeadDialog` (see divergence 3).
- **Slice 08** attaches one optional prop, `onRequestConversion`, on `LeadsBoardContainer`. `LeadConversionRequest` is `{lead, toStageId, toIndex}`. `emitMove` already threads the resolved id as `onMoveLead({ ...payload, saleId })`, so 08 should need to edit no file in this slice.
