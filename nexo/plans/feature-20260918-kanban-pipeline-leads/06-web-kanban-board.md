---
id: 06-web-kanban-board
milestone: v4.1.0
status: done
depends_on: [04-web-data-layer]
files_modified:
  - apps/web/package.json
  - apps/web/vite.config.ts
  - pnpm-lock.yaml
  - apps/web/src/sales-ops/leads/board-labels.ts
  - apps/web/src/sales-ops/leads/board-move.ts
  - apps/web/src/sales-ops/leads/board-ui.ts
  - apps/web/src/sales-ops/leads/LeadCard.tsx
  - apps/web/src/sales-ops/leads/LeadsBoard.tsx
  - apps/web/src/sales-ops/leads/MoveLeadDialog.tsx
  - apps/web/src/sales-ops/leads/LeadDialog.tsx
  - apps/web/src/sales-ops/leads/LeadsBoardContainer.tsx
  - apps/web/src/sales-ops/leads/__tests__/board-move.test.ts
  - apps/web/src/sales-ops/leads/__tests__/board-labels.test.ts
  - apps/web/src/sales-ops/leads/__tests__/leads-board-keyboard.test.tsx
  - apps/web/src/sales-ops/leads/__tests__/lead-dialog.test.tsx
  - apps/web/src/sales-ops/leads/__tests__/move-dialog-inline-layer.test.tsx
  - apps/web/src/sales-ops/leads/__tests__/board-write-surface.test.ts
acceptance: "given a Kanban board of leads rendered from slice 04's board model, when the operator moves a card with the keyboard-only `Mover para` dialog - to another stage OR to another position inside the same stage - then exactly one `MoveLeadPayload` is emitted through slice 04's `useMoveLead` and nothing else, a move into a `kind: 'lost'` stage is blocked in the UI until a non-empty reason is typed, a move into the `kind: 'conversion'` stage waits on the slice-08 handler and emits nothing when it resolves `null`, a CONVERTED card (`lead.saleId !== null`) offers no move trigger and no drag handle and renders its mirrored `sale.status`, and no file under `apps/web/src/sales-ops/leads/` that this slice writes can reach `POST /sales/:id/transition` or declare a second mutation."
goal: The Kanban board, the lead card, the keyboard-first move dialog and the lead create/edit dialog, in their own files, with an explicit props contract that slices 07 and 08 wire to without further design.
must_not_break:
  - "`apps/web/src/sales-ops/SalesOpsApp.tsx` gains NOTHING in this slice - not an import, not a line."
  - "`apps/web/src/sales-ops/navigation.ts` stays byte-unchanged in this slice."
  - "Every file slice 04 owns (`leads/types.ts`, `leads/api.ts`, `leads/calculations.ts`, `leads/optimistic.ts`, `leads/hooks.ts`, `lib/query-keys.ts`) stays byte-unchanged here; this slice CONSUMES them and never edits them."
  - "Slice 05's `leads/LeadStagesView.tsx` and its test are not touched; the wave is parallel."
  - "No file this slice writes imports `@/lib/app-mutation`, `@/lib/api-client`, or `useMutation` from `@tanstack/react-query`."
  - "The native-picker ESLint ban: no `<select>`, `<option>`, `<datalist>`, no raw `<input type=\"number\">`."
  - "Escape aimed at a `Combobox` panel inside `MoveLeadDialog` / `LeadDialog` must not close the dialog."
  - "No raw lead / client / person / product / org / sale id is ever rendered as user-facing text."
  - "The three new dependencies are pinned EXACTLY (no caret) in `apps/web/package.json`."
rules:
  - "Every derivation slice 04 already exports is CONSUMED, never re-derived: `boardStages`, `leadsInStage`, `groupLeadsByStage`, `conversionStage`, `lostStage`, `stageRequiresReason`, `daysInCurrentStage`, `leadIsConverted`. A per-call-site `kind === 'lost'` comparison anywhere in this slice is a defect. There is no `stageIsReadOnly`: read-only is a per-CARD question and `leadIsConverted` is the only way to ask it."
  - "The move payload type is slice 04's `MoveLeadPayload`. This slice declares no command type of its own."
  - "Every picker is `Combobox` from `@/components/ui/combobox`. Numeric input is `<Input type=\"number\">` from `@/components/ui/input`."
  - "Both dialogs use the REAL `Dialog`/`DialogContent` from `@/components/ui/dialog`; never a hand-rolled div, because `DialogContent` is the inline-layer registry host."
  - "No component here calls `useInlineLayer` directly - `Combobox` and `InfoHint` already do - but the REAL-`Dialog` regression test is still mandatory."
  - "Picker geometry: exactly two sizes, copied verbatim into `board-ui.ts` (44px `formSelectClass` in dialogs, 40px `comboboxTriggerClass` in the filter bar), per CLAUDE.md 'UI Controls'."
  - "`LeadsBoard`, `LeadCard`, `MoveLeadDialog` and `LeadDialog` are PURE presentational: props in, callbacks out, zero TanStack, zero `apiFetch`, zero `useAccessToken`. `LeadsBoardContainer.tsx` is the ONLY file that names a slice-04 hook."
  - "Money is integer CENTS (`estimatedValueBrl`) and is formatted with `formatMoneyBrl` from `../calculations`."
  - "Every button carries an explicit `type=\"button\"` on every render; never derive the attribute from state (CLAUDE.md, 'UI Controls')."
  - "pt-BR copy only. The strings below are pinned by tests; do not paraphrase them."
verifier_focus: "Three things. (1) That the KEYBOARD path is the real control: `MoveLeadDialog` and the dnd-kit `onDragEnd` must both funnel through the single `emitMove`, so deleting the entire dnd-kit layer leaves the board fully operable and every oracle still green - if any oracle needs a drag simulation to go red, the design has been inverted. (2) That `board-write-surface.test.ts` is NON-VACUOUS: it must run its scanner over an in-memory fixture carrying a planted violation and assert it is detected, or it is a permanently green check over nothing. (3) That the two ROLES of the single `kind: 'conversion'` stage are never conflated, and that neither is confused with a read-only CARD. There are exactly three kinds (`'normal' | 'conversion' | 'lost'`) and no `'converted'`. As a DESTINATION the conversion stage is a legitimate target for a non-converted lead and must be offered by `moveTargetsFor` whenever a conversion handler is attached - it hands back to the wizard and moves nothing optimistically. As a SOURCE it is nothing special: what refuses to move is the CARD, when `leadIsConverted(lead)` is true. `board-move.test.ts` oracles 1, 2 and 3 must distinguish all three of those, and a `moveTargetsFor` that excluded the conversion stage outright would pass a careless test while making acceptance 11 unreachable."
---

# 06 — Quadro Kanban de leads (board + card + mover + dialog de lead)

## 0. Scope

**Is:** the board surface. Columns, cards, the days-in-stage badge, the keyboard-first `Mover para`
dialog, the drag convenience layer on top of it, the lead create/edit dialog, and one thin
container that binds them to slice 04. All under `apps/web/src/sales-ops/leads/`.

**Is not:** routing (07), the stage cadastro screen (05), the conversion flow (08), or any API /
query / optimistic code (03 / 04). It adds **nothing** to `SalesOpsApp.tsx` — acceptance 18.

**Wave partner:** 05-web-stage-cadastro owns exactly `leads/LeadStagesView.tsx` and
`leads/__tests__/lead-stages-view.test.tsx`. Disjoint from every path above.
`apps/web/package.json`, `apps/web/vite.config.ts` and `pnpm-lock.yaml` belong to **this** slice
alone in wave 5 — 05's plan explicitly declares `package.json` byte-unchanged.

## 0.1 Read these before writing a line

| file | why |
|---|---|
| `nexo/plans/feature-20260918-kanban-pipeline-leads/04-web-data-layer.md` §3–§7 | the exact symbols this slice consumes. **Not negotiable** — 04's plan says so, and this plan is written against them. |
| the **shipped** `apps/web/src/sales-ops/leads/{types,api,calculations,hooks}.ts` | 04 reconciles its own field names against slice 03's wire. If a field was renamed there, use the shipped name and note it in the exec notes. |
| `apps/web/src/sales-ops/ProfessionalSplitPanel.tsx` | the stand-alone sales-ops component shape, and the documented reason to live outside `SalesOpsApp.tsx` |
| `apps/web/src/sales-ops/CadastroHistoryPanel.tsx` (lines 1–60) | the local-copy-of-style-constants precedent and its comment |
| `apps/web/src/components/ui/combobox.tsx` + `combobox-filter.ts` | `ComboboxOption`, groups, the create row and its copy |
| `apps/web/src/components/ui/__tests__/inline-layer-escape.test.tsx` | the REAL-`Dialog` harness §7.5 copies |
| `apps/web/src/sales-ops/__tests__/sale-wizard-professional-split.test.tsx` | the `createRoot` + `React.act` harness every `.tsx` oracle here copies |
| `apps/web/eslint.config.js` | the four `no-restricted-syntax` selectors this slice must not trip |

---

## 1. The dependency decision (acceptance 22)

### Chosen

```jsonc
// apps/web/package.json, "dependencies", alphabetical (before "@fontsource-variable/geist"
// is wrong - "@dnd-kit/*" sorts first), EXACT, no caret:
"@dnd-kit/core": "6.3.1",
"@dnd-kit/sortable": "10.0.0",
"@dnd-kit/utilities": "3.2.2",
```

Verified against the registry on 2026-09-18:

| package | version | peers | notes |
|---|---|---|---|
| `@dnd-kit/core` | `6.3.1` | `react >=16.8.0`, `react-dom >=16.8.0` | deps `tslib`, `@dnd-kit/accessibility@^3.1.1`, `@dnd-kit/utilities@^3.2.2` |
| `@dnd-kit/sortable` | `10.0.0` | `react >=16.8.0`, `@dnd-kit/core@^6.3.0` | deps `@dnd-kit/utilities`, `tslib` |
| `@dnd-kit/utilities` | `3.2.2` | `react >=16.8.0` | imported directly (`CSS.Transform.toString`), so it is a direct dependency and not only a transitive one |

React 18.3.1 satisfies every peer. `@dnd-kit/accessibility` is a runtime dependency of core, not a
peer, and is **not** pinned here — pinning a transitive is how a manifest and a lockfile start
disagreeing. No `pnpm-workspace.yaml` `overrides` entry is needed: nothing else in the workspace
depends on `@dnd-kit/*`, so there is no second copy to deduplicate. That condition is what forced
the `hono` override and it does not hold here.

### Why exactly pinned

The same reason `@fxl-business/hub-sdk` is (CLAUDE.md): **the exact spelling is the only one that
survives an unrelated `pnpm install`.** A caret on the library that decides where a card lands is a
silent minor bump of untested behaviour, in a slice that deliberately does not simulate the pointer
path in happy-dom.

### Why dnd-kit, and not the two alternatives

- **`@hello-pangea/dnd@18.0.1`** (the maintained `react-beautiful-dnd` fork) is the closest shape
  fit and was rejected for one concrete reason: it measures the DOM eagerly at mount
  (`DragDropContext` installs a style element, `Droppable` measures via `getBoundingClientRect`).
  Every web oracle in this repo mounts real components with `createRoot` + `React.act` under
  **happy-dom**, so a library that needs real geometry to *render* would push the oracles onto a
  mock of the board instead of the board.
- **`react-dnd`** needs a backend provider and a second package, and yields no sortable index — it
  would hand-roll exactly the reorder maths dnd-kit ships.
- **dnd-kit** stays inert until a sensor fires: `DndContext` adds no geometry at mount and
  `useDroppable`'s `ResizeObserver` sits behind a `typeof window.ResizeObserver` guard. `LeadsBoard`
  therefore mounts clean in happy-dom and every oracle drives the real component.

### Commit-message justification (paste verbatim into the commit body)

```
Adds the repo's first drag-and-drop dependency: @dnd-kit/core 6.3.1,
@dnd-kit/sortable 10.0.0 and @dnd-kit/utilities 3.2.2, pinned exactly with no
caret for the same reason @fxl-business/hub-sdk is - an exact spelling is the
only one that survives an unrelated `pnpm install`, and a silent minor bump of
the library that decides where a card lands is not something this repo can see,
because the pointer path is deliberately not simulated in happy-dom.

dnd-kit over @hello-pangea/dnd: the board is presentational and every web oracle
mounts the real component under happy-dom with createRoot + act. @hello-pangea/dnd
measures the DOM at mount, which would force the oracles onto a mock of the board
instead of the board. dnd-kit adds no geometry until a sensor fires and guards its
ResizeObserver on feature detection, so the board mounts clean.

The keyboard "Mover para" dialog is the real control and is the single emitter of
a MoveLeadPayload; the drag layer calls the same emitter and installs no
KeyboardSensor. Deleting the dnd-kit layer removes a convenience, not a
capability, and leaves every oracle green.
```

### Install command, and the park condition

```bash
pnpm --filter @fxl-sales/web add --save-exact \
  @dnd-kit/core@6.3.1 @dnd-kit/sortable@10.0.0 @dnd-kit/utilities@3.2.2
```

`--save-exact` is **required**: `.npmrc` does not set `save-exact`, so without it pnpm writes
`^6.3.1` and the pin is lost. After installing, re-open `apps/web/package.json` and confirm all
three are bare versions. If a caret was written anyway, hand-edit the three lines and run
`pnpm install --lockfile-only`.

`pnpm add` needs the network. **If the registry is unreachable this is an autopilot PARK, not a
workaround.** Do not vendor the library, do not hand-write a lockfile entry, and do not ship the
board "without the drag layer for now" — wave 6 would wire to a half-landed slice. Record in
`AUDIT.md`:

> `06-web-kanban-board parked — npm registry unreachable; `pnpm --filter @fxl-sales/web add --save-exact @dnd-kit/core@6.3.1 @dnd-kit/sortable@10.0.0 @dnd-kit/utilities@3.2.2` could not run.`

leave the worktree clean, and return a partial-completion report.

### `apps/web/vite.config.ts`

Append to `optimizeDeps.include`, after `'@radix-ui/react-tabs'`:

```ts
'@dnd-kit/core',
'@dnd-kit/sortable',
'@dnd-kit/utilities',
```

Not tidiness: the comment already in that file records a real incident where a dep discovered
mid-load was re-served under a `?t=` URL and duplicated `src/auth/react.tsx`, splitting its React
context. `DndContext` is a React context, so it is the identical hazard.

Do **not** add a `manualChunks` branch — the default `'vendor'` bucket catches it.

---

## 2. The slice-04 seam (bind, do not redesign)

Consumed, by exact name:

```ts
// from './types'
type SalesOpsLead, SalesOpsLeadStage, SalesOpsLeadProduct, LeadStageKind,
     LeadBoardModel, LeadBoardFilters
// from './api'
type MoveLeadPayload, SaveLeadPayload, SaveLeadProductPayload
// from './calculations'
boardStages, leadsInStage, groupLeadsByStage, conversionStage, lostStage,
stageRequiresReason, daysInCurrentStage, leadIsConverted
// from './hooks'  (LeadsBoardContainer.tsx ONLY)
useLeadStages, useLeadsBoard, useMoveLead, useSaveLead
```

`stageIsReadOnly` does **not** exist in slice 04 and must not be invented here. See the table
below.

**The THREE stage kinds, and the one distinction this slice must never blur:**

| `kind` | meaning here | move target? |
|---|---|---|
| `'normal'` | an ordinary pipeline column | yes |
| `'lost'` | the terminal negative stage, at most one per org | yes, **only with a non-empty reason** |
| `'conversion'` | the **door**: picking it opens the proposta wizard (acceptance 11), at most one per org | yes, **only when `onRequestConversion` is attached** |

There is no `'converted'` kind. An earlier revision of this plan had four, and the fourth existed
in no migration, no service and no API response. Slice 01 is the schema owner: the CHECK is
`kind in ('normal','conversion','lost')` and the partial unique index on `(org_id, kind)` makes
`'conversion'` and `'lost'` each at most one per org.

**Read-only is a property of the CARD, not of the column.** A card is read-only exactly when
`leadIsConverted(lead)` (`lead.saleId !== null`): it renders the `sale.status` mirror, gets no
move trigger, gets no drag handle, and `moveTargetsFor` offers it nothing (acceptance 13). The
single `kind: 'conversion'` column is where those cards live, but the column is not read-only -
it is also the DESTINATION a non-converted card is dropped onto to start a conversion.

**The two roles of the `'conversion'` stage, which is the whole of the distinction:**

| direction | rule |
|---|---|
| as a SOURCE | irrelevant. A card there is converted, so the CARD's own rule already refuses to move it. |
| as a DESTINATION | a legitimate target for a non-converted card, and the ONE target that never moves the card optimistically: `emitMove` hands back to `onRequestConversion`, which opens the proposta wizard. The card changes stage only after `POST /sales` answers `201` and the resolved `saleId` rides the move. Cancelling leaves the card exactly where it was, with nothing persisted and no request issued. |

`stageRequiresReason(stage)` is the only way this slice asks the `'lost'` question and
`leadIsConverted(lead)` the only way it asks the read-only one. The `'conversion'` question is
asked in exactly one place too — §2.1 below — for the same reason.

### 2.1 `apps/web/src/sales-ops/leads/board-move.ts`

The small pure layer slice 04 does not provide. React-free, imports only types plus slice 04's
`calculations`.

```ts
/** The one place this slice asks "is this the conversion door?". */
export function stageOpensConversion(stage: SalesOpsLeadStage | undefined): boolean;
// implementation: stage?.kind === 'conversion'

/**
 * The stages `lead` may be moved to. `stages` is already `boardStages`-filtered by the caller.
 *  - `[]` when `leadIsConverted(lead)` - a converted card has NO move affordance at all
 *    (acceptance 13). This is the ONLY read-only rule, and it keys on the LEAD, never on a stage.
 *  - the `kind: 'conversion'` stage IS a target for a non-converted lead whenever
 *    `hasConversionHandler` is true. It is the door to the wizard (acceptance 11), and excluding
 *    it would make the whole feature's headline criterion unreachable from the keyboard. What is
 *    special about it is not that it is forbidden but that `emitMove` does not move the card when
 *    it is chosen: it hands back to `onRequestConversion` first (§4.3).
 *  - the `kind: 'conversion'` stage is excluded ONLY when `hasConversionHandler` is false, so a
 *    pre-slice-08 board cannot produce a card sitting in a conversion column with no proposta
 *    behind it (acceptance 11's ghost-card clause).
 *  - the lead's OWN stage is INCLUDED: that is the reorder-within-column case.
 *  - there is no `kind: 'converted'` stage to exclude; that kind does not exist.
 */
export function moveTargetsFor(
  lead: SalesOpsLead,
  stages: readonly SalesOpsLeadStage[],
  hasConversionHandler: boolean,
): SalesOpsLeadStage[];

export type MovePositionOption = { value: string; label: string; index: number };

/**
 * Positions offered for `lead` landing in the column of `toStageId`.
 * `columnLeads` is already `leadsInStage`-ordered and still CONTAINS `lead` when the destination
 * is its own column. Indexes are POST-REMOVAL insertion indexes, which is exactly what
 * `MoveLeadPayload.toIndex` means.
 *   index 0     -> 'Início da coluna'
 *   index n > 0 -> `Depois de ${<contactName of the n-th card, with `lead` itself skipped>}`
 * Own column: yields `columnLeads.length - 1` options (the lead's current slot is not an option,
 * because moving a card to where it already is is not a move).
 * Other column: yields `columnLeads.length + 1` options.
 * NEVER renders an id.
 */
export function movePositionOptions(
  lead: SalesOpsLead,
  toStageId: string,
  columnLeads: readonly SalesOpsLead[],
): MovePositionOption[];

/** pt-BR days copy. 0 -> 'hoje'; 1 -> 'há 1 dia'; n -> `há ${n} dias`. */
export function describeDaysInStage(days: number): string;

/**
 * The single validity gate `MoveLeadDialog`'s primary button reads.
 * Returns null when the move may be sent, or the pt-BR refusal when it may not, in this order:
 *   1. targetStage == null              -> 'Escolha a etapa de destino.'
 *   2. targetIndex == null              -> 'Escolha a posição na coluna.'
 *   3. stageRequiresReason(targetStage) && reason.trim() === ''
 *                                       -> 'Informe o motivo da perda.'
 *   4. otherwise                        -> null
 * Rule 3 is acceptance 6's CLIENT half: blocked before the request, in addition to the API's
 * 400 validation_error. It keys on stageRequiresReason and never on the stage's NAME, which is
 * org-renameable.
 */
export function validateMove(input: {
  targetStage: SalesOpsLeadStage | null;
  targetIndex: number | null;
  reason: string;
}): string | null;

/**
 * Builds slice 04's payload. THROWS when `validateMove` would have refused - a belt to the
 * button's braces, so a future call site cannot bypass the gate.
 * `reason` is the TRIMMED string when `stageRequiresReason(targetStage)`, and `null` for every
 * other destination - so a reason typed and then re-targeted at a non-lost stage is never
 * smuggled onto the wire.
 */
export function buildMovePayload(input: {
  lead: SalesOpsLead;
  targetStage: SalesOpsLeadStage;
  targetIndex: number;
  reason: string;
}): MoveLeadPayload;
```

### 2.2 `apps/web/src/sales-ops/leads/board-labels.ts`

Every identifier→label resolution in this slice, in one pure module, so no component ever holds a
raw id for display (CLAUDE.md, "UI Identifiers"). React-free.

```ts
export type LabelLookups = {
  clientNameById: ReadonlyMap<string, string>;
  personNameById: ReadonlyMap<string, string>;
  productNameById: ReadonlyMap<string, string>;
};

/** Builds the three maps from the bootstrap rows the container is given. */
export function buildLabelLookups(input: {
  clients: readonly SalesOpsClient[];
  people: readonly SalesOpsPerson[];
  products: readonly SalesOpsProduct[];
}): LabelLookups;

/** clientId -> the client's name; otherwise the free-text companyName; otherwise 'Sem empresa'.
 *  A clientId the cache does not know degrades to the free text, then to 'Sem empresa' - NEVER
 *  to the id itself. */
export function leadCompanyLabel(lead: SalesOpsLead, lookups: LabelLookups): string;

/** sellerPersonId -> the pessoa's displayName; else the server's sellerNameSnapshot; else
 *  'Sem vendedor'. Never an id. */
export function leadSellerLabel(lead: SalesOpsLead, lookups: LabelLookups): string;

/** One label per lead product: the catalog name when productId resolves, otherwise
 *  productNameSnapshot. Never an id, and never an empty string. */
export function leadProductLabels(lead: SalesOpsLead, lookups: LabelLookups): string[];

/** pt-BR labels for the mirrored sale status shown on a converted card. */
export const SALE_STATUS_LABEL: Record<SalesOpsStatus, string>;
// draft: 'Rascunho', open: 'Aberta', won: 'Ganha', lost: 'Perdida', cancelled: 'Cancelada'
```

---

## 3. `apps/web/src/sales-ops/leads/board-ui.ts`

Class-name constants only. No React, no component export (keeps
`react-refresh/only-export-components` quiet).

Copy **verbatim** from `apps/web/src/sales-ops/SalesOpsApp.tsx` lines 205–219 — copy, do **not**
import, because slice 07 imports this board *into* `SalesOpsApp.tsx` and an import the other way is
a cycle. `CadastroHistoryPanel.tsx` sets the precedent and carries the comment explaining it; write
the same comment here.

- `formInputClass` (44px)
- `comboboxTriggerClass` (40px compact)
- `formSelectClass` = `` `${comboboxTriggerClass} h-11 rounded-[10px]` ``

Plus board-local: `boardScrollerClass`, `columnClass`, `columnHeaderClass`, `cardClass`,
`cardDraggingClass`, `daysBadgeClass`, `readOnlyCardClass`, `chipClass`.

`readOnlyCardClass` and not `readOnlyColumnClass`: read-only is a property of the CARD
(`leadIsConverted`), never of a column. §2.

Geometry rule (CLAUDE.md "UI Controls"): the two dialogs' pickers use `formSelectClass`; the
board's vendedor filter uses `comboboxTriggerClass`. Call sites pass only non-geometry extras.

---

## 4. Components

### 4.1 `LeadCard.tsx`

```ts
export type LeadCardProps = {
  lead: SalesOpsLead;
  lookups: LabelLookups;
  /** Injected clock, so the days badge is deterministic in tests. */
  now: Date;
  /** Absent => no move trigger and no drag handle (a converted or otherwise immovable card). */
  onRequestMove?: (lead: SalesOpsLead) => void;
  onEdit?: (lead: SalesOpsLead) => void;
  /** dnd-kit plumbing supplied by LeadsBoard. Absent on a read-only card. */
  dragHandleProps?: React.HTMLAttributes<HTMLElement> & Record<string, unknown>;
  isDragging?: boolean;
};
export function LeadCard(props: LeadCardProps): JSX.Element;
```

Renders, in order:

1. `lead.contactName` (bold), `leadCompanyLabel(lead, lookups)` (muted, second line).
2. Up to three `leadProductLabels(...)` as chips, plus a `+N` chip when there are more.
3. `Valor estimado` + `formatMoneyBrl(lead.estimatedValueBrl)` in the `sales-ops-num` class the
   rest of the app uses for money. The label says *estimado* so the number can never be read as a
   closed value (acceptance 2).
4. `leadSellerLabel(lead, lookups)`.
5. The days badge: `describeDaysInStage(daysInCurrentStage(lead.stageChangedAt, now))`, carrying
   `data-days-in-stage={days}` and the accessible label
   `` `${describeDaysInStage(days)} nesta etapa` ``. (Acceptance 7.)
6. When `lead.saleStatus !== null`: a badge with `SALE_STATUS_LABEL[lead.saleStatus]` and
   `data-sale-status={lead.saleStatus}`. **No button of any kind.**
   A converted card (`leadIsConverted(lead)`) additionally carries `data-read-only-card` and
   `readOnlyCardClass`. `LeadsBoard` is what decides not to pass it `onRequestMove` or
   `dragHandleProps`; the card renders the marker so an oracle can assert the read-only state on
   the CARD rather than inferring it from a column.
7. When `onRequestMove` is present: a `type="button"` trigger, visible text `Mover para…`,
   `aria-label={`Mover para… ${lead.contactName}`}`, `data-move-trigger={lead.id}`.
8. When `onEdit` is present: a `type="button"` `Editar` with `data-edit-lead={lead.id}`.

The card carries `data-lead-card={lead.id}`. The card element is **not** itself a `<button>` and
the move trigger is **not** nested inside the drag handle: a control that is both draggable and
activatable has an activation behaviour that depends on how far the pointer moved, which is the
class of bug CLAUDE.md's `type="button"` paragraph exists about.

### 4.2 `MoveLeadDialog.tsx` — **the real control**

```ts
export type MoveLeadDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: SalesOpsLead;
  /** Already filtered by moveTargetsFor. */
  targets: SalesOpsLeadStage[];
  /** All leads, so the position picker can read any destination column. */
  leads: readonly SalesOpsLead[];
  /** Pre-selected destination, used when a drag handed control back (see 4.3). null = the lead's own stage. */
  initialStageId?: string | null;
  onSubmit: (payload: MoveLeadPayload) => void;
  /** true while a previous move is in flight; disables the confirm button. */
  pending?: boolean;
};
export function MoveLeadDialog(props: MoveLeadDialogProps): JSX.Element;
```

Real `Dialog` / `DialogContent` / `DialogHeader` / `DialogTitle` / `DialogDescription` from
`@/components/ui/dialog`. Title `Mover para`. Description names the lead by `contactName`, never by
id.

Body, in order:

1. **`Etapa de destino`** — `Combobox`, `className={formSelectClass}`, options
   `targets.map(s => ({value: s.id, label: s.name}))`, seeded to `initialStageId ?? lead.stageId`
   when that stage is among `targets`. **No `onCreate`**: a stage needs `kind`, `position`,
   `isSystem` and `status`, so an inline create cannot yield a complete valid record — CLAUDE.md's
   `onCreate` rule. Stages are created in slice 05's `cadastros/etapas`.
2. **`Posição na coluna`** — `Combobox`, `className={formSelectClass}`, options from
   `movePositionOptions(lead, selectedStageId, leadsInStage(leads, selectedStageId))`, re-seeded to
   the first option whenever the destination changes.
   **This is the keyboard affordance for reordering WITHIN a column** (acceptance 9): the operator
   leaves `Etapa de destino` on the lead's own stage and picks a different `Depois de <contato>`
   row. Not a separate control, not a separate menu, not a separate command — the same dialog, the
   same `onSubmit`, the same `MoveLeadPayload`; the only difference is that
   `toStageId === lead.stageId`.
3. **`Motivo da perda`** — a `<textarea>` (prose, not an `Input`), rendered **only** when
   `stageRequiresReason(selectedStage)`, `required`, `aria-required="true"`, `data-lost-reason`.
   Help text: `Uma etapa de perda exige o motivo.`
4. **`Abrir proposta`** notice — rendered only when `stageOpensConversion(selectedStage)`:
   `Esta etapa abre o wizard de proposta. O card só muda de etapa depois que a proposta for
   criada.` (`data-conversion-notice`). The dialog itself does nothing about conversion; it emits
   the payload and `LeadsBoard.emitMove` owns the wizard handshake.
5. The refusal line: `validateMove(...)`'s string in the muted-warning style with
   `data-move-blocked`; `null` renders nothing.

Footer: `Cancelar` (`type="button"`, closes, emits nothing) and the primary `Mover`,
**`type="button"` on every render**, `disabled={validateMove(...) !== null || pending}`, `onClick`
building the payload with `buildMovePayload` then calling `onSubmit` and `onOpenChange(false)`.

Local state (`selectedStageId`, `selectedIndex`, `reason`) resets on every `false → true`
transition of `open` and on every `lead.id` change, via one `useEffect` keyed on both. A cancelled
move therefore leaves nothing behind — acceptance 11's "sem estado intermediário persistido" at the
UI layer.

### 4.3 `LeadsBoard.tsx`

```ts
/** The slice-08 seam. Nothing else in this slice knows the wizard exists. */
export type LeadConversionRequest = {
  lead: SalesOpsLead;
  toStageId: string;
  toIndex: number;
};

export type LeadsBoardProps = {
  stages: SalesOpsLeadStage[];
  leads: SalesOpsLead[];
  lookups: LabelLookups;
  now: Date;
  /** Emitted once per confirmed move. The container hands this to slice 04's useMoveLead. */
  onMoveLead: (payload: MoveLeadPayload) => void;
  movePending?: boolean;
  onCreateLead?: () => void;
  onEditLead?: (lead: SalesOpsLead) => void;
  /**
   * SLICE 08 ATTACHES HERE, and 08 edits no file in this slice.
   * Called INSTEAD of onMoveLead when the destination stage is the conversion door.
   *   resolve(saleId) -> the board then calls onMoveLead(payload)
   *   resolve(null)   -> the operator cancelled: the board does NOTHING. No optimistic write,
   *                      no request, no card movement, no intermediate state.
   *   reject          -> surfaced exactly like any other failed move.
   */
  onRequestConversion?: (request: LeadConversionRequest) => Promise<string | null>;
  /** Controlled by slice 07; the board renders the picker and owns no filter state. */
  sellerFilter?: {
    value: string | null;
    options: ComboboxOption[];
    onChange: (value: string | null) => void;
  };
  /** Keyset pagination from useLeadsBoard (acceptance 16). */
  hasMore?: boolean;
  onLoadMore?: () => void;
  loadingMore?: boolean;
};
export function LeadsBoard(props: LeadsBoardProps): JSX.Element;
```

Structure:

- **Header**: optional `Novo lead` (`type="button"`); when `sellerFilter` is given, a `Combobox`
  with `className={comboboxTriggerClass}` whose first option is
  `{value: '', label: 'Todos os vendedores'}` mapped to `null` on change.
  **The board does not filter its own `leads` array.** Scoping is server-applied inside `withTenant`
  (acceptance 15) and the admin narrowing rides `useLeadsBoard`'s filters. A comment says so and
  §7.3 oracle 6 pins it.
- **Columns**: `boardStages(stages)` in order; each column's cards are `leadsInStage(leads, id)`.
  `<section data-stage-column={stage.id}>` with the stage name and the card count in the header.
- The `kind: 'conversion'` column carries `data-conversion-column` and is an ordinary DROPPABLE
  like every other column: dropping a non-converted card on it is how a conversion starts
  (acceptance 11). It is **not** read-only. No column is.
- **Read-only is per CARD.** A card where `leadIsConverted(lead)` gets **no** `onRequestMove`,
  **no** `dragHandleProps` and is **not** wrapped in a `useSortable`; it renders
  `data-read-only-card` and its `sale.status` badge (acceptance 13). Since its cards are
  individually inert, the conversion column needs no column-level special case, which is exactly
  what lets it stay a drop target.
- Every other card gets `onRequestMove` **iff**
  `moveTargetsFor(lead, boardStages(stages), Boolean(onRequestConversion)).length > 0`.
- **Footer**: when `hasMore`, a `type="button"` `Carregar mais leads` calling `onLoadMore`,
  disabled while `loadingMore`.

**The single emitter.** Every input method funnels here and nowhere else:

```ts
const emitMove = React.useCallback(
  async (payload: MoveLeadPayload) => {
    const target = stages.find((stage) => stage.id === payload.toStageId);
    if (stageOpensConversion(target)) {
      // Structurally unreachable when absent: moveTargetsFor already excluded the stage.
      if (!onRequestConversion) return;
      const lead = leads.find((row) => row.id === payload.leadId);
      if (!lead) return;
      const saleId = await onRequestConversion({
        lead,
        toStageId: payload.toStageId,
        toIndex: payload.toIndex,
      });
      if (saleId === null) return;   // cancelled: the card never moved
      // The resolved sale id RIDES the move. Slice 03 answers
      // `400 validation_error / sale_required_for_conversion` to a conversion move without one,
      // so dropping it here is a guaranteed 400 for every conversion. It is the one value the
      // whole handshake exists to produce, and this is the single line that carries it.
      onMoveLead({ ...payload, saleId });
      return;
    }
    onMoveLead(payload);
  },
  [leads, onMoveLead, onRequestConversion, stages],
);
```

`MoveLeadPayload.saleId` is slice 04's optional field (04 §4) and this `emitMove` is its ONLY
producer in the app. The non-conversion branch never sets it, which is what keeps slice 03's
`sale_not_allowed` unreachable from the board.

`MoveLeadDialog.onSubmit` **is** `emitMove`. `DndContext.onDragEnd` also calls `emitMove`, after
translating dnd-kit's `active` / `over` through `buildMovePayload`. That is the entire relationship
between the two input methods, and it is why deleting the drag layer changes no behaviour.

**Drag layer (convenience only).** One `DndContext` around the columns; `PointerSensor` with
`activationConstraint: { distance: 6 }` so a click on `Mover para…` is never swallowed by a drag;
`closestCorners`; one `SortableContext` + `verticalListSortingStrategy` per non-read-only column;
one `useSortable` per movable card.

**Do not install `KeyboardSensor`.** It would be a *second* keyboard command path competing with
the dialog, with its own semantics and its own bugs, and CLAUDE.md's standing objection applies:
two gates means one live and one nobody exercises. Write
`// deliberately no KeyboardSensor - see the Mover para dialog, which is the real control` at the
sensor list.

`onDragEnd` early-returns when `over === null`, when `active.id === over.id`, or when the dragged
lead is converted (which cannot happen, because a converted card is never a drag source - it is a
belt to that brace). There is **no** "destination is read-only" branch, because no destination is
read-only.

When the destination `stageRequiresReason(...)` or `stageOpensConversion(...)`, it does **not**
emit: it opens `MoveLeadDialog` pre-seeded with that destination via `initialStageId`, because a
drag has nowhere to type a reason and nowhere to fill a wizard. That is the one place drag hands
back to the keyboard control, and it is precisely why the dialog is the real control rather than a
fallback.

Note what that means for the conversion destination specifically, because it is the case the
acceptance criteria are most explicit about: **a drag onto the conversion column moves nothing.**
It opens the dialog seeded to that column; the operator confirms; `emitMove` then awaits
`onRequestConversion`; and only a resolved `saleId` produces an `onMoveLead`. Cancelling the dialog
or cancelling the wizard leaves the card exactly where it was, with no optimistic write, no request
and no intermediate state. Drag and the keyboard menu therefore do exactly the same thing
(acceptance 9), because they end in the same `emitMove`.

### 4.4 `LeadDialog.tsx` — create / edit

```ts
export type LeadDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null => create. On edit, the container maps the SalesOpsLead into a SaveLeadPayload seed. */
  initial: SaveLeadPayload | null;
  /** Creatable-into stages only: boardStages(stages).filter(s => s.kind === 'normal'). */
  stages: SalesOpsLeadStage[];
  clients: ComboboxOption[];
  products: ComboboxOption[];
  /**
   * Pessoas carrying the `vendedor` SYSTEM função, already resolved to options by the caller.
   * This slice deliberately does NOT derive it: `hasFuncao` is module-private in SalesOpsApp.tsx,
   * CLAUDE.md forbids a per-call-site slug comparison, and a second copy here would be exactly
   * that. Slice 07 MUST build this with
   *   people.filter(p => hasFuncao(p, FUNCAO_SLUG_VENDEDOR) && p.status === 'active')
   * and must NEVER read the deprecated `is_seller` mirror (acceptance 4).
   */
  sellers: ComboboxOption[];
  onSubmit: (payload: SaveLeadPayload) => void;
  pending?: boolean;
};
export function LeadDialog(props: LeadDialogProps): JSX.Element;
```

Fields, all inside the real `DialogContent`. Title `Novo lead` / `Editar lead`.

| label | control | notes |
|---|---|---|
| `Nome do contato` | `Input` | required; a blank value blocks `Salvar` |
| `Empresa (cliente cadastrado)` | `Combobox`, `formSelectClass`, over `clients` | **no `onCreate`** — acceptance 2 forbids a lead from creating a `sales_ops_clients` row; the resolve-or-create happens at conversion time (acceptance 12, slice 08). Write that sentence as a comment. A `Limpar` button clears back to `null`. |
| `Empresa (texto livre)` | `Input` | the fallback; `disabled` while `clientId !== null`, and cleared when a cliente is picked |
| `Produtos em negociação` | `Combobox` over `products` + `Adicionar` (`type="button"`); chips below, each with `Remover ${label}` | the catalog path; an already-added produto is filtered out of the options so a duplicate cannot be added |
| `Produto não cadastrado` | `Input` + `+ Adicionar item livre` (`type="button"`) | appends `{productId: null, productNameSnapshot: <typed>}`, mirroring `sales_ops_sale_items`' snapshot convention (acceptance 3). Deliberately **not** the `Combobox`'s `onCreate` row, whose copy is `+ Criar novo produto "X"` and would promise a catalog row this never creates. |
| `Valor estimado (R$)` | `<Input type="number" step="0.01" min="0">` | parsed with `parseCurrencyInputToCents` from `../calculations` into `estimatedValueBrl` (integer CENTS). Both the label and the field name say *estimado* (acceptance 2). |
| `Descrição` | `<textarea>` | free prose, optional |
| `Vendedor responsável` | `Combobox`, `formSelectClass`, over `sellers` | **no `onCreate`** — a pessoa is invalid without a função (CLAUDE.md's `onCreate` rule) |
| `Etapa` | `Combobox`, `formSelectClass`, over `stages` | the caller passes only `kind: 'normal'` stages: a lead is never CREATED into the conversion door (that needs a proposta) nor into the lost column (that needs a reason, which belongs to the move dialog) |

Footer: `Cancelar` and `Salvar`, both `type="button"` on every render. Blank-required refusals render
inline with `data-lead-blocked`, never as a bare disabled button with no explanation.

### 4.5 `LeadsBoardContainer.tsx`

The **only** file naming a slice-04 hook.

```ts
export type LeadsBoardContainerProps = {
  clients: SalesOpsClient[];
  people: SalesOpsPerson[];
  products: SalesOpsProduct[];
  /** Built by slice 07 with hasFuncao(person, FUNCAO_SLUG_VENDEDOR); see LeadDialogProps.sellers. */
  sellers: ComboboxOption[];
  /** Controlled vendedor filter; slice 07 owns the state so the URL/route layer can too. */
  sellerFilter?: { value: string | null; onChange: (value: string | null) => void };
  /** Forwarded verbatim to LeadsBoard. Slice 08's entire attachment surface. */
  onRequestConversion?: (request: LeadConversionRequest) => Promise<string | null>;
};
export function LeadsBoardContainer(props: LeadsBoardContainerProps): JSX.Element;
```

It:

1. calls `useLeadStages()` FIRST — the columns are needed before the board query can run at all,
   because slice 04's `useLeadsBoard` fans out one per-column request per stage and slice 03's
   `GET /leads` requires a `stageId`;
2. builds `filters: LeadBoardFilters = sellerFilter?.value ? { sellerPersonId: sellerFilter.value } : undefined`,
   **memoized on the value alone**, and passes the *same* object to
   `useLeadsBoard(stages, filters)` and `useMoveLead(filters)` — slice 04's plan makes that
   coupling explicit and a mismatch silently degrades to no optimistic write. The `stages`
   argument is the raw `useLeadStages()` result; `useLeadsBoard` applies `boardStages` itself, and
   it stays disabled while the list is empty, so the board shows its Skeleton rather than issuing a
   request slice 03 would answer `400`;
3. `buildLabelLookups({clients, people, products})`, memoized;
4. `const now = new Date()` **once per render**, passed down — no presentational component reads
   the clock;
5. renders `<LeadsBoard …>` with `onMoveLead={(payload) => moveLead.mutate(payload)}`,
   `movePending={moveLead.isPending}`, `hasMore`, `onLoadMore={() => fetchNextPage()}`;
6. owns the `LeadDialog` open/edit state and wires `onSubmit` to `useSaveLead()`;
7. renders the loading `Skeleton` and, on error, the plain inline failure copy — it does **not**
   classify `isEntitlementFailure` / `isForbiddenFailure`, because `SalesOpsApp` already owns that
   chain one level up and a second classifier is a second gate.

It contains **no** `useAppMutation`, **no** `apiFetch`, **no** `useQuery` of its own, and no
`transition` symbol. §7.6 makes that structural.

---

## 5. Deliberate omissions (and why)

- **No dnd-kit `KeyboardSensor`.** §4.3.
- **No `Alt+Arrow` card shortcut.** A third command path duplicating the dialog, with nowhere to
  type a lost reason. If wanted later it is a `nexo/ROADMAP.md` entry, not this slice.
- **No drag simulation in any test.** happy-dom runs neither pointer capture nor activation
  behaviour (CLAUDE.md records the `dispatchEvent` trap). The design answer is that the drag layer
  emits through `emitMove`, which the keyboard oracles cover end to end; a real-browser check of
  the drag gesture belongs to the manual pass, using the standalone Vite harness pattern.
- **No client-side seller filtering.** Server-scoped, acceptance 15.
- **No `useInlineLayer` call of our own.** `Combobox` and `InfoHint` already call it; our job is to
  use the real `DialogContent`, which is the registry host.
- **No lost reason on the card.** It belongs to the lead detail, not a column glance; putting it on
  the card invites rendering it for a non-lost lead.
- **No board-local copy of `leads`.** The board renders straight from props so slice 04's optimistic
  cache is the single source of truth — §7.3 oracle 9 pins it.

---

## 6. Copy strings pinned by tests (do not paraphrase)

`Mover para` · `Mover para…` · `Etapa de destino` · `Posição na coluna` · `Início da coluna` ·
`Depois de ` · `Motivo da perda` · `Uma etapa de perda exige o motivo.` ·
`Informe o motivo da perda.` · `Escolha a etapa de destino.` · `Escolha a posição na coluna.` ·
`Esta etapa abre o wizard de proposta. O card só muda de etapa depois que a proposta for criada.` ·
`Mover` · `Cancelar` · `hoje` · `há 1 dia` · `há N dias` · `nesta etapa` · `Valor estimado` ·
`Sem vendedor` · `Sem empresa` · `Todos os vendedores` · `Carregar mais leads` · `Novo lead` ·
`Editar` · `Nome do contato` · `Empresa (cliente cadastrado)` · `Empresa (texto livre)` ·
`Produtos em negociação` · `Produto não cadastrado` · `+ Adicionar item livre` ·
`Valor estimado (R$)` · `Descrição` · `Vendedor responsável` · `Etapa` · `Salvar` ·
`Rascunho` / `Aberta` / `Ganha` / `Perdida` / `Cancelada`.

---

## 7. Tests — named oracles and their decisive mutations

Whole-slice command (never a watcher):

```bash
pnpm --filter @fxl-sales/web test src/sales-ops/leads
```

Single file, e.g.:

```bash
pnpm --filter @fxl-sales/web test src/sales-ops/leads/__tests__/leads-board-keyboard.test.tsx
```

Every `.tsx` oracle opens with `// @vitest-environment happy-dom` and uses the `createRoot` +
`React.act` harness from `apps/web/src/sales-ops/__tests__/sale-wizard-professional-split.test.tsx`.
`.ts` oracles run in the default `node` environment.

### 7.1 `__tests__/board-move.test.ts` (node, pure)

| # | oracle title | decisive mutation |
|---|---|---|
| 1 | `offers no move target at all for a converted lead` | delete the `leadIsConverted` early return in `moveTargetsFor` → red. Fixture: a lead with `saleId` set, sitting in the `kind: 'conversion'` stage. **Acceptance 13, structural.** |
| 2 | `still offers every target for a NON-converted lead sitting in the conversion stage` | keying the refusal on the STAGE instead of the lead → red. This is the pair to oracle 1 and it is what proves the read-only rule is per CARD; without it, `moveTargetsFor` returning `[]` for anything in the conversion column would pass. |
| 3 | `hides the conversion door when no conversion handler is attached` | make `hasConversionHandler` ignored → red. **Acceptance 11's ghost-card clause.** |
| 4 | `offers the conversion door as an ordinary target when a conversion handler is attached` | excluding the conversion stage outright → red. **Acceptance 11 needs this stage reachable from the keyboard menu; it is a legitimate destination, and what is special about it lives in `emitMove`, not here.** |
| 5 | `offers the lead's own column as a target, without its own current slot` | delete the own-column branch of `movePositionOptions` → red. **The reorder-within-column oracle.** |
| 6 | `labels positions by contact name and never by id` | assert no option label contains any lead-id fixture; rendering an id → red |
| 7 | `refuses a move into a lost stage with a blank or whitespace-only reason` | delete `validateMove`'s rule 3 → red |
| 8 | `keys the reason requirement on the stage kind and not on its name` | a stage NAMED `Perdido` with `kind: 'normal'` must NOT require a reason and one named `Arquivado` with `kind: 'lost'` MUST → red on any name match |
| 9 | `drops the reason when the destination is not a lost stage` | pass the reason through unconditionally in `buildMovePayload` → red |
| 10 | `throws rather than building a payload the gate would have refused` | replace the `buildMovePayload` guard with a silent return → red |
| 11 | `describes zero, one and many days in pt-BR` | swap `há 1 dia`/`há 1 dias` → red |

### 7.2 `__tests__/board-labels.test.ts` (node, pure)

| # | oracle title | decisive mutation |
|---|---|---|
| 1 | `prefers the cadastro client name over the free-text company` | flip the precedence → red |
| 2 | `falls back to the free text, then to Sem empresa, and never to the id` | make an unresolved `clientId` render itself → red. **CLAUDE.md "UI Identifiers".** |
| 3 | `prefers the live pessoa name over the server snapshot, and never renders a person id` | drop the snapshot fallback, or leak the id → red |
| 4 | `labels a free lead product from its snapshot and a catalog one from the catalog` | resolve everything through the catalog → red. **Acceptance 3's UI half.** |

### 7.3 `__tests__/leads-board-keyboard.test.tsx` (happy-dom)

Mounts the REAL `LeadsBoard` with real stages of all four kinds, real `MoveLeadDialog`, real
`Combobox`, and a `vi.fn()` `onMoveLead`. The dialog opens by clicking `[data-move-trigger]`;
pickers are driven through the `Combobox` trigger + option rows exactly as
`apps/web/src/sales-ops/__tests__/combobox-adoption.test.tsx` does. **No drag is ever simulated.**

| # | oracle title | decisive mutation |
|---|---|---|
| 1 | `moves a card to another column through the keyboard dialog alone, with no pointer drag` | delete `MoveLeadDialog`'s `onSubmit` wiring → red. Proves the keyboard path is complete on its own. |
| 2 | `reorders a card inside its own column through the same dialog` | asserts the emitted payload has `toStageId === lead.stageId` and the chosen `toIndex`; deleting the own-column option → red. **Acceptance 9's keyboard-reorder half.** |
| 3 | `emits exactly one move payload per confirmation` | a double emit (wiring both `onClick` and a form `onSubmit`) → red |
| 4 | `blocks the confirm button until a lost reason is typed, and sends it trimmed` | asserts `disabled` is true and `onMoveLead` was not called, then types `"  orçamento apertado  "` and asserts `reason === 'orçamento apertado'`; removing the guard → red. **Acceptance 6's UI half.** |
| 5 | `renders no move trigger and no drag handle on a converted card, and shows its sale status` | a lead with `saleId` set and `saleStatus: 'won'` in the `kind: 'conversion'` column: asserts `[data-move-trigger]` is absent for that lead, `[data-read-only-card]` is present on it, and the card renders `Ganha`. Removing the `leadIsConverted` branch → red. **Acceptance 13.** |
| 5b | `keeps the conversion column a drop target for a card that is not converted` | render a NON-converted lead alongside the converted one, open its dialog, and assert the conversion stage's name IS among the `Etapa de destino` options. Making the whole column read-only → red. **Acceptance 11: the door must stay open.** |
| 6 | `renders the vendedor filter without filtering its own leads` | pass `sellerFilter.value` naming one seller while `leads` holds two; assert BOTH cards still render and that `onChange` fired. A client-side `.filter()` sneaking in → red. **Acceptance 15.** |
| 7 | `never calls onMoveLead when the conversion handler resolves null` | `onRequestConversion` resolving `null`; move to the conversion door; assert `onMoveLead` was never called and the card is still under its original column. Calling `onMoveLead` before the `await` → red. **Acceptance 11 + the slice-08 seam.** |
| 8 | `calls onMoveLead once the conversion handler resolves a sale id` | the positive half of #7; an unconditional early return → red |
| 9 | `holds no local copy of the lead list, so a rejected move reverts with the cache` | re-render with the ORIGINAL `leads` prop after a move was emitted and assert the DOM order matches the original. A `useState` mirror of `leads` inside the board → red. **This is what keeps acceptance 10 slice-04's job and a second source of truth out of the board.** |
| 10 | `does not offer the conversion door at all when no conversion handler is attached` | render with `onRequestConversion` undefined, open the dialog, assert the conversion stage name is absent from the `Etapa de destino` options → red on a missing exclusion |

### 7.4 `__tests__/lead-dialog.test.tsx` (happy-dom)

| # | oracle title | decisive mutation |
|---|---|---|
| 1 | `offers no create row on the cliente picker` | type a name matching nothing; assert no `+ Criar` row. Wiring `onCreate` → red. **Acceptance 2: a lead never creates a cliente.** |
| 2 | `keeps a free-text company when no cliente is picked` | submit with `clientId: null` plus typed text; assert both land correctly in the payload |
| 3 | `adds a free product line with a null productId and its typed name` | assert `products` contains `{productId: null, productNameSnapshot: 'Integração X'}`; forcing a catalog id → red. **Acceptance 3's UI half.** |
| 4 | `renders exactly the sellers it is given and derives none itself` | pass three options while nothing in the props resembles a função list; assert the picker shows exactly those three. Any inline `hasFuncao`-lookalike → red. **Acceptance 4's boundary.** |
| 5 | `offers only open stages when creating a lead` | pass a conversion, a lost and a converted stage alongside two open ones; assert only the two open names appear → red if the filter moves into the component |
| 6 | `blocks Salvar with a blank contact name` | delete the guard → red |
| 7 | `names the estimated value as an estimate and submits integer cents` | assert the label contains `estimado` and that `1234.56` submits `123456`; a reais-not-cents bug → red |
| 8 | `never renders a raw identifier` | assert the dialog's `textContent` contains none of the uuid fixtures |

### 7.5 `__tests__/move-dialog-inline-layer.test.tsx` (happy-dom) — the false-positive trap

Structure copied from `apps/web/src/components/ui/__tests__/inline-layer-escape.test.tsx`. This file
renders the REAL `@radix-ui/react-dialog`: **no `vi.mock('@/components/ui/dialog', …)` here**,
unlike most sales-ops tests.

| # | oracle title | decisive mutation |
|---|---|---|
| 1 | `keeps the move dialog open when Escape puts away the destination picker` | open `MoveLeadDialog`, open the `Etapa de destino` `Combobox`, dispatch a capture-phase `keydown` `Escape` on `document`; assert the panel closed and `onOpenChange` was **not** called. Replacing `DialogContent` with a plain `<div>` → red. |
| 2 | `still closes the move dialog when Escape arrives with nothing inner open` | the affordance must survive; an unconditional `preventDefault` → red |
| 3 | `keeps the lead dialog open when Escape puts away the vendedor picker` | the same for `LeadDialog` |

The trap, recorded because it already shipped once in this repo: a spy on a React sibling's
`onKeyDown` passes with the protection fully deleted, because Radix's `useEscapeKeydown` is a
**capture-phase `document` listener**. The assertion must be on `onOpenChange`, and the `Dialog`
must be real.

### 7.6 `__tests__/board-write-surface.test.ts` (node, filesystem) — the structural guard

Reads every `.ts`/`.tsx` file under `apps/web/src/sales-ops/leads/` **that this slice owns**
(the `files_modified` list, excluding `__tests__/`) with `node:fs`. It does **not** shell out to
`git grep`, for the reason CLAUDE.md gives about `scripts/__tests__/local-database-guard.test.mjs`:
a repo-wide grep passes with the offending call sitting in a third file and does not notice a
rename. It scopes to this slice's own files so slice 04's legitimate `apiFetch` in `leads/api.ts`
is not a false positive.

Factor the scanner as an exported pure function inside the test file:

```ts
export function scanBoardSources(files: Map<string, string>): string[];
```

called once with the real files read off disk, and once with an in-memory fixture map.

| # | oracle title | decisive mutation |
|---|---|---|
| 1 | `no board file can reach POST /sales/:id/transition` | asserts no file matches `/\/transition\b/` nor contains `transitionSale`, `useTransitionSalesOpsSale`, `cancelContract` or `useCancelSalesOpsContract`. Adding any one → red. **Acceptance 13 / 14, made irremovable.** |
| 2 | `no board file declares a second write path` | asserts no file imports `@/lib/app-mutation`, `@/lib/api-client`, or `useMutation` from `@tanstack/react-query`. Writing a local mutation instead of consuming `useMoveLead` → red. **Acceptance 10.** |
| 3 | `no board file asks the stage-kind question inline` | asserts no file matches `/kind\s*===\s*'(normal|lost)'/` anywhere, and no file outside `board-move.ts` matches `/kind\s*===\s*'conversion'/` (`board-move.ts` owns `stageOpensConversion` and is the one place that literal may appear). Also asserts the literal `'converted'` appears in NO file, since it is not a stage kind. A per-call-site comparison → red. |
| 4 | `the scanner detects a planted violation` | **mandatory positive control.** Runs `scanBoardSources` over a fixture map containing `import { apiFetch } from '@/lib/api-client';`, `fetch('/api/v1/sales-ops/sales/x/transition')` and `stage.kind === 'lost'`, and asserts all three are reported. Without it, a scanner that globs zero files is a permanently green check over nothing — the exact `vacuous-green-checks` failure this repo has already paid for. |
| 5 | `the scanner actually read every file this slice owns` | asserts the real file-set size equals the expected list and that each path exists. A rename that empties the glob → red. |

### 7.7 Slice-level verification

```bash
pnpm --filter @fxl-sales/web test src/sales-ops/leads
pnpm --filter @fxl-sales/web exec eslint src/sales-ops/leads
pnpm --filter @fxl-sales/web run type-check
```

The wave runs the full suite, full lint and `pnpm run build` (acceptance 23). Verify also that
`git diff --stat` for this slice touches exactly the paths in `files_modified` and that
`apps/web/src/sales-ops/SalesOpsApp.tsx`, `navigation.ts` and slice 04's five files are
byte-identical to their pre-slice blobs.

---

## 8. Handoff notes the next slices need

**To 07 (routing / mounting):**
- Mount `<LeadsBoardContainer>` — never `<LeadsBoard>` — passing `clients`, `people`, `products`
  from the existing bootstrap.
- Build `sellers` as
  `people.filter(p => hasFuncao(p, FUNCAO_SLUG_VENDEDOR) && p.status === 'active').map(p => ({value: p.id, label: p.displayName}))`
  using `SalesOpsApp.tsx`'s own `hasFuncao`. Do **not** re-derive it with a slug comparison and do
  **not** read `is_seller` (acceptance 4). If `hasFuncao` must be exported to do this, that export
  is 07's edit to `SalesOpsApp.tsx`, not this slice's.
- `sellerFilter` is controlled: 07 owns the state, and it must reach `useLeadsBoard` through the
  container so the narrowing stays a server query rather than a client filter.
- The admin board (`operacional/`) passes a `sellerFilter`; the seller board (`meus-dados/`) passes
  none, because that scope is server-applied.
- `apps/web/src/sales-ops/navigation.ts` is untouched here, so 07 owns every line of it.

**To 08 (conversion):**
- The seam is one optional prop, `onRequestConversion?: (request: LeadConversionRequest) =>
  Promise<string | null>`, on `LeadsBoardContainer`, forwarded verbatim to `LeadsBoard`. **08 should
  need to edit no file in this slice.**
- `LeadConversionRequest` is `{ lead, toStageId, toIndex }`. The lead is on `request.lead`, not
  `request.source`; there is no `source` field and no `LeadMoveCommand` type anywhere in this
  slice — the move payload is slice 04's `MoveLeadPayload` and nothing else.
- `emitMove` already threads the resolved id (`onMoveLead({ ...payload, saleId })`), so 08 adds
  nothing here. If it arrives missing, that one line in `LeadsBoard.tsx` is the whole repair.
- Contract: resolve with the created sale's id → the board emits the move. Resolve `null` → the
  board does nothing at all. Reject → surfaced like any other failed move.
- While `onRequestConversion` is absent, the conversion door is not offered as a move target at
  all, so there is no intermediate state to clean up and no ghost card to explain.
- Resolving-or-creating the `sales_ops_clients` row (acceptance 12) happens entirely inside 08's
  handler before it resolves; the board never learns about it.
- `LeadConversionRequest` carries the whole `SalesOpsLead`, so 08 prefills the wizard from
  `clientId` / `companyName` / `products` / `estimatedValueBrl` / `description` / `sellerPersonId`
  with no second fetch.

**To whoever writes the CLAUDE.md leads section (acceptance 24):** the paragraph this slice earns is
*"the keyboard `Mover para` dialog is the single emitter of a `MoveLeadPayload`; the dnd-kit layer
calls the same emitter and installs no `KeyboardSensor`, so deleting the drag layer removes a
convenience and not a capability"*, plus the three-stage-kind table from §2, the two-roles table
beside it (the `'conversion'` stage is a legitimate DESTINATION and read-only is a property of the
CARD), and the exact-pin justification from §1.
