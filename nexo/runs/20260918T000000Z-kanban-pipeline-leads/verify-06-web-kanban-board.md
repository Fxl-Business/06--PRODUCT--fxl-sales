# Verify - 06-web-kanban-board

**Verdict: PASS**

Branch `feat/20260918-06-web-kanban-board`, three commits ahead of `master`
(`2336d60`, `e64863b`, `c04bf32`).
Worktree `.worktrees/20260918T000000Z-kanban-pipeline-leads/06-web-kanban-board`.
Diff reviewed: `git diff master...HEAD`.

I did not read the context pack, any `exec-*.md`, or any executor result file.

---

## 1. Gates - all four green, real output

### Named slice oracles

```
$ pnpm --filter @fxl-sales/web test src/sales-ops/leads

 ✓ src/sales-ops/leads/__tests__/board-move.test.ts (15 tests) 4ms
 ✓ src/sales-ops/leads/__tests__/leads-calculations.test.ts (6 tests) 7ms
 ✓ src/sales-ops/leads/__tests__/board-labels.test.ts (6 tests) 3ms
 ✓ src/sales-ops/leads/__tests__/board-write-surface.test.ts (6 tests) 6ms
 ✓ src/sales-ops/leads/__tests__/leads-optimistic.test.ts (10 tests) 4ms
 ✓ src/sales-ops/leads/__tests__/leads-api-contract.test.ts (6 tests) 29ms
 ✓ src/sales-ops/leads/__tests__/leads-move-rollback.test.ts (6 tests) 32ms
 ✓ src/sales-ops/leads/__tests__/leads-board-fanout.test.ts (5 tests) 26ms
 ✓ src/sales-ops/leads/__tests__/move-dialog-inline-layer.test.tsx (3 tests) 100ms
 ✓ src/sales-ops/leads/__tests__/lead-dialog.test.tsx (9 tests) 280ms
 ✓ src/sales-ops/leads/__tests__/leads-board-keyboard.test.tsx (12 tests) 461ms

 Test Files  11 passed (11)
      Tests  84 passed (84)
```

### Full web suite / lint / type-check / build

```
$ pnpm --filter @fxl-sales/web test
 Test Files  67 passed (67)
      Tests  868 passed (868)

$ pnpm run lint
apps/api lint: Done
apps/web lint: Done

$ pnpm run type-check
packages/shared-types type-check: Done
packages/shared-utils type-check: Done
apps/api type-check: Done
apps/web type-check: Done

$ pnpm run build
✓ built in 1.69s
```

`build:packages` ran automatically as part of `type-check`; `@fxl-sales/shared-utils`
resolved with no intervention.

---

## 2. The `useInlineLayer` guard and its known false positive - PROVEN BOTH WAYS

`apps/web/src/sales-ops/leads/MoveLeadDialog.tsx` and `LeadDialog.tsx` both use the REAL
`Dialog` / `DialogContent` from `@/components/ui/dialog`. Neither calls `useInlineLayer`
itself, which is correct: `apps/web/src/components/ui/combobox.tsx:93` calls
`useInlineLayer(open)` and `dialog.tsx:54` hosts the registry via `useInlineLayerHost()`.
The `Combobox` panels opened inside both dialogs therefore register.

`__tests__/move-dialog-inline-layer.test.tsx` renders the real Radix dialog and
deliberately does NOT `vi.mock('@/components/ui/dialog', ...)`.

**Mutation A1 - disable the registration** (`useInlineLayer(open)` -> `useInlineLayer(false)`
in `combobox.tsx`):

```
 × keeps the move dialog open when Escape puts away the destination picker
 × keeps the lead dialog open when Escape puts away the vendedor picker
 Tests  2 failed | 1 passed (3)
```
RED on two NAMED tests. The feature is real.

**Mutation A2 - the positive control** (`DialogContent` -> plain `<div role="dialog">` in
`MoveLeadDialog.tsx`):

```
 × keeps the move dialog open when Escape puts away the destination picker
 × still closes the move dialog when Escape arrives with nothing inner open
 Tests  2 failed | 1 passed (3)
```
RED. The oracle does NOT pass vacuously without Radix.

The reason it cannot pass vacuously is written into the test itself: each guard test ends
with an in-test positive control that dispatches Escape with no inner layer open and asserts
`expect(onOpenChange).toHaveBeenCalledWith(false)`. With a hand-rolled div no Radix
capture-phase listener exists, so that assertion fails and the vacuous path is closed.
This is exactly the trap CLAUDE.md records as having shipped once, and it is closed here.

---

## 3. Drag / keyboard parity (acceptance 9) - PROVEN BY AMPUTATION

`LeadsBoard.tsx` has a single emitter, `emitMove`. `MoveLeadDialog`'s `onSubmit` IS
`emitMove`; `handleDragEnd` calls the same function. `useSensors` installs only a
`PointerSensor`; the only occurrence of `KeyboardSensor` anywhere in `apps/web/src` is a
comment on `LeadsBoard.tsx:175` saying one is deliberately absent.

**Mutation B - stripped every `@dnd-kit` import, `useSensors`/`PointerSensor`, the whole
`SortableLeadCard` component, `DndContext`, `SortableContext`, `useSortable`, `CSS.Transform`
and `handleDragEnd` out of `LeadsBoard.tsx`** (verified 0 remaining references), rendering
plain `LeadCard`s:

```
 ✓ src/sales-ops/leads/__tests__/leads-board-keyboard.test.tsx (12 tests) 445ms
 Test Files  1 passed (1)
      Tests  12 passed (12)
```

ALL 12 keyboard oracles still pass with the entire drag layer gone. The menu is the real
control and the drag layer is a convenience, exactly as the acceptance requires. Restored.

---

## 4. Read-only is CARD-keyed, not column-keyed - PROVEN

There is no `stageIsReadOnly` anywhere. `moveTargetsFor` keys on slice 04's
`leadIsConverted(lead)`.

Two oracles put a converted and a NON-converted card in the SAME `'conversion'` column:
- `board-move.test.ts`: `still offers every target for a NON-converted lead sitting in the conversion stage`
- `leads-board-keyboard.test.tsx`: `keeps a NON-converted card in the conversion column fully movable`

**Mutation C - zero out the targets for everything in the `'conversion'` column** (replaced
the card rule with `stages.some((st) => st.id === lead.stageId && st.kind === 'conversion')`):

```
 × moveTargetsFor > still offers every target for a NON-converted lead sitting in the conversion stage
 × LeadsBoard ... > keeps a NON-converted card in the conversion column fully movable
 Tests  2 failed | 82 passed (84)
```
RED at both the pure and the DOM level. A column-keyed rule cannot survive.

**Mutation J - delete the `leadIsConverted` early return entirely**:

```
 × moveTargetsFor > offers no move target at all for a converted lead
 × LeadsBoard ... > renders no move trigger and no drag handle on a converted card, and shows its sale status
 × LeadsBoard ... > keeps a NON-converted card in the conversion column fully movable
 Tests  3 failed | 81 passed (84)
```
RED. Acceptance 13 holds and is irremovable.

---

## 5. Conversion as a DESTINATION never moves the card optimistically - PROVEN

`emitMove` awaits `onRequestConversion` first; on `null` it returns before touching
`onMoveLead`. The board holds no lead state, so nothing can move locally either.
The oracle `never calls onMoveLead when the conversion handler resolves null` asserts
`onMoveLead` was never called AND that `columnOrder(NOVO_ID) === [LEAD_A]` /
`columnOrder(CONVERSAO_ID) === []`, so the card demonstrably did not move.

`moveTargetsFor` still OFFERS the conversion stage to a non-converted lead whenever a
handler is attached.

**Mutation E - `onMoveLead(payload)` before the `await`**:
```
 × never calls onMoveLead when the conversion handler resolves null
 × calls onMoveLead once the conversion handler resolves a sale id
```

**Mutation F - exclude the conversion stage from `moveTargetsFor` outright**:
```
 × still offers every target for a NON-converted lead sitting in the conversion stage
 × offers the conversion door as an ordinary target when a conversion handler is attached
 × keeps the conversion column a drop target for a card that is not converted
 × keeps a NON-converted card in the conversion column fully movable
 × never calls onMoveLead when the conversion handler resolves null
 × calls onMoveLead once the conversion handler resolves a sale id
 Tests  6 failed | 78 passed (84)
```
Both RED. The two roles of the single `'conversion'` stage are never conflated.

---

## 6. `lost` requires a reason, blocked BEFORE the request is built - PROVEN

`MoveLeadDialog` computes `refusal = validateMove(...)`, disables the primary button on it,
and `confirm()` also early-returns on it. `buildMovePayload` throws rather than build a
payload the gate refused. The gate keys on `stageRequiresReason` (stage KIND), never a name.

**Mutation D - delete rule 3 from `validateMove`**:
```
 × validateMove > refuses a move into a lost stage with a blank or whitespace-only reason
 × validateMove > keys the reason requirement on the stage kind and not on its name
 × buildMovePayload > throws rather than building a payload the gate would have refused
 × LeadsBoard ... > blocks the confirm button until a lost reason is typed, and sends it trimmed
 Tests  4 failed | 80 passed (84)
```
RED on four NAMED tests, including the UI oracle that asserts `disabled === true` and
`onMoveLead` was never called before typing, then that the reason arrives trimmed.

---

## 7. Days parked - correct in code, one COVERAGE GAP recorded

`LeadCard.tsx` calls `daysInCurrentStage(lead.stageChangedAt, now)`. A same-column reorder
cannot touch that timestamp from the client at all: `MoveLeadSchema` is `.strict()` and
declares only `{stageId, position, reason?, saleId?}`, so `stageChangedAt` is structurally
not expressible on the wire. Slice 04 pins `daysInCurrentStage counts whole days from
stageChangedAt and never returns NaN`.

**Mutation G - make the CARD read `lead.updatedAt ?? lead.createdAt` instead**:
```
 Test Files  11 passed (11)
      Tests  84 passed (84)
```
SURVIVED GREEN. No oracle in this slice pins WHICH lead field feeds the card's days badge.

Assessment: not a blocker. The code is correct, the property is not in this slice's declared
`acceptance` frontmatter (which covers move emission, lost reason, conversion, the converted
card and the write surface), and the plan names no oracle for it - `describeDaysInStage`
(pt-BR copy) and `daysInCurrentStage` (arithmetic) are both pinned, only the wiring between
them is not. Recommend slice 07 or a follow-up add one line asserting the badge changes when
`stageChangedAt` changes and not when `updatedAt` does.

---

## 8. UI law - clean

- No `<select>`, `<option>`, `<datalist>` added anywhere in the diff.
- No `components/ui/select` or `@radix-ui/react-select` import under `leads/`.
- Every single-select picker is `Combobox` from `@/components/ui/combobox`: the vendedor
  filter bar, `Etapa de destino`, `Posição na coluna`, cliente, produto, vendedor.
- No raw `<input type="number">`; the estimated value uses `<Input type="number">` from
  `@/components/ui/input`.
- 12 `<button>` elements across the five new components, 12 literal `type="button"`.
  Zero `type={...}` expressions anywhere under `leads/` - the attribute is never derived
  from state, per CLAUDE.md's activation-behaviour rule.
- Picker geometry is the two canonical sizes copied into `board-ui.ts`: `formSelectClass`
  (44px, dialogs) and `comboboxTriggerClass` (40px, filter bar only).
- No raw id is rendered as user-facing text. `board-labels.ts` resolves every id through a
  live-row / snapshot / fixed-pt-BR ladder and never falls through to the id itself; pinned
  by `board-labels.test.ts`, by `labels positions by contact name and never by id`, and by
  `never renders a raw identifier` in `lead-dialog.test.tsx`. Ids appear only as
  `data-*` attributes, which are not user-facing text.

---

## 9. Dependency (acceptance 22) - pinned exactly and justified

`apps/web/package.json`:
```
"@dnd-kit/core": "6.3.1",
"@dnd-kit/sortable": "10.0.0",
"@dnd-kit/utilities": "3.2.2",
```
Bare versions, no caret, no range. `pnpm-lock.yaml` agrees:
`specifier: 6.3.1` / `specifier: 10.0.0` / `specifier: 3.2.2`.
`@dnd-kit/accessibility@3.1.1` is present only as a transitive of core and is correctly NOT
pinned in the manifest.

Commit `2336d60` carries the justification in its body: the exact-pin rationale mirroring
`@fxl-business/hub-sdk`, dnd-kit over `@hello-pangea/dnd` (which measures the DOM at mount
and would push the oracles onto a mock of the board), why `@dnd-kit/utilities` is direct and
`@dnd-kit/accessibility` is not, why no `pnpm-workspace.yaml` override is needed, and why the
three packages join `optimizeDeps.include`.

`apps/web/vite.config.ts` appends the three to `optimizeDeps.include` with a comment tying it
to the recorded split-React-context incident. `DndContext` is a React context, so this is the
same hazard.

---

## 10. Payload agreement with the SHIPPED slice-04 data layer and slice-03 API - VERIFIED
AGAINST THE REAL SCHEMAS, not a fixture

I read `apps/web/src/sales-ops/leads/{api,types,hooks}.ts` and
`apps/api/src/domains/sales-ops/leads/lead-schemas.ts` directly, then wrote a THROWAWAY test
that imports the REAL `CreateLeadSchema` and `MoveLeadSchema` from the API package, drives the
REAL `LeadDialog` through happy-dom, takes the payload it actually emits, applies the exact
translation `leadsApi.saveLead` / `leadsApi.moveLead` perform, and `safeParse`s the result:

```
 ✓ src/sales-ops/leads/__tests__/zz-payload-crosscheck.test.tsx (2 tests) 29ms
   ✓ the LeadDialog payload is accepted by CreateLeadSchema.strict()
   ✓ the buildMovePayload body is accepted by MoveLeadSchema.strict()
```

Both pass against the `.strict()` schemas. The throwaway file was DELETED afterwards and is
not in the tree.

Field by field:
- `SaveLeadPayload` body = `{contactName, clientId, clientName, estimatedValueBrl,
  description, sellerPersonId, products}` - exactly `LeadFieldsSchema`'s seven keys, no
  extras. `clientId` / `description` / `sellerPersonId` are sent as `null`, which the schema's
  `.nullish()` accepts. `id` is stripped into the path by `leadsApi.saveLead`.
- **No `stageId`**: `LeadDialog` renders no stage picker at all and sends no such key. Pinned
  by the oracle `offers no etapa picker at all, because the API assigns the stage`, which
  asserts both that `Etapa` is absent from the dialog's `textContent` and that `stageId` is
  absent from the emitted payload's keys.
- Products: `{productId}` for a catalog row and `{productName}` for a free row, matching
  `LeadProductSchema.strict()`'s superRefine (at least one of the two).
- `MoveLeadPayload` = `{leadId, toStageId, toIndex, reason}` plus `saleId` spread by
  `emitMove`; `leadsApi.moveLead` translates to `{stageId, position, reason?, saleId?}` with
  `leadId` as the path segment and both optionals conditionally spread, so a `reason: null`
  never reaches the wire.

---

## 11. `must_not_break` - every file byte-identical, diff scope exact

```
SAME  apps/web/src/sales-ops/SalesOpsApp.tsx
SAME  apps/web/src/sales-ops/navigation.ts
SAME  apps/web/src/sales-ops/leads/types.ts
SAME  apps/web/src/sales-ops/leads/api.ts
SAME  apps/web/src/sales-ops/leads/calculations.ts
SAME  apps/web/src/sales-ops/leads/optimistic.ts
SAME  apps/web/src/sales-ops/leads/hooks.ts
SAME  apps/web/src/lib/query-keys.ts
```
(compared by `git rev-parse master:<path>` vs `HEAD:<path>`)

`git diff master...HEAD --name-only` lists exactly 17 paths: the 14 declared source and test
files, `apps/web/package.json`, `apps/web/vite.config.ts` and `pnpm-lock.yaml`. Nothing else.
Slice 05's `leads/LeadStagesView.tsx` is not touched. No file under `leads/` written by this
slice imports `@/lib/app-mutation`, `@/lib/api-client` or `useMutation` - proven structurally
below.

---

## 12. Judging the tests themselves

`board-write-surface.test.ts` is genuinely non-vacuous, proven two ways:

**Mutation H - make the scanner glob zero files**:
```
 × the board write surface > the scanner actually read every file this slice owns
```
**Mutation I - plant a real `apiFetch` import plus a `/transition` fetch in `LeadsBoard.tsx`**:
```
 × no board file can reach POST /sales/:id/transition
 × no board file declares a second write path
 × reports nothing at all over the real files
```
Both RED. It also uses `readFileSync` on a fixed list, so a rename throws rather than
silently emptying the set, and it carries the mandatory planted-violation positive control.

Oracles I judged and found sound: `emits exactly one move payload per confirmation`
(`toHaveBeenCalledTimes(1)` catches a double-wire), `holds no local copy of the lead list`
(re-renders with the original array and asserts DOM order), `renders the vendedor filter
without filtering its own leads` (both cards must survive a filter value naming one seller).
The DOM oracles assert on `[data-move-trigger]`, `[data-read-only-card]`, `[data-lost-reason]`
and `[data-move-confirm]` markers, so no panel case can pass by rendering nothing.

**The one oracle gap: none pins the card's days badge to `stageChangedAt`** (mutation G,
section 7). Recorded, not blocking.

### Two plan defects the implementation correctly overrode

1. The plan's `lead-dialog.test.tsx` oracle 5, `offers only open stages when creating a lead`,
   is unimplementable against the shipped API: `CreateLeadSchema` is `.strict()` and declares
   no `stageId`, so a stage picker could only offer a value nothing reads. The shipped test is
   the stronger `offers no etapa picker at all, because the API assigns the stage`, asserting
   both the absent control and the absent payload key. Correct deviation.
2. The plan's §7.5 oracle 1 names "replace `DialogContent` with a plain `<div>`" as an
   external mutation but specifies no in-test positive control, which is precisely how the
   recorded false positive shipped last time. The implementation added the control INSIDE each
   guard test. Correct strengthening, and I verified it works (mutation A2).

---

## 13. Housekeeping

Every mutation was restored with `git checkout --` or by restoring the `.bak`. The throwaway
crosscheck test was deleted. Final state:

```
$ pnpm --filter @fxl-sales/web test src/sales-ops/leads
 Test Files  11 passed (11)
      Tests  84 passed (84)

$ git status --porcelain
TREE CLEAN
```

No watcher was run and no process was left running.

---

## Verdict

**PASS.** The slice meets its acceptance. The inline-layer oracle carries a real positive
control and goes red on both the feature deletion and the Radix removal. All 12 keyboard
oracles survive amputating the entire dnd-kit layer, so the `Mover para` dialog is the single
emitter and the real control. The read-only rule is card-keyed and dies on the
column-keyed mutation. Conversion as a destination emits nothing on cancel while remaining an
offered target. Payloads were validated against the real `.strict()` API schemas rather than a
fixture. `must_not_break` holds byte for byte and the diff touches only declared paths.

One non-blocking coverage gap is recorded: no oracle pins the card's days badge to
`stageChangedAt`.
