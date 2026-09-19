---
id: 08-web-conversion
milestone: v4.1.0
status: done
depends_on: [07-web-routing]
files_modified:
  - apps/web/src/sales-ops/leads/conversion.ts
  - apps/web/src/sales-ops/leads/LeadsBoard.tsx
  - apps/web/src/sales-ops/leads/LeadsBoardContainer.tsx
  - apps/web/src/sales-ops/leads/api.ts
  - apps/web/src/sales-ops/SalesOpsApp.tsx
  - apps/web/src/sales-ops/leads/__tests__/lead-conversion-prefill.test.ts
  - apps/web/src/sales-ops/leads/__tests__/lead-conversion.test.tsx
  - CLAUDE.md
  - nexo/ROADMAP.md
acceptance: "Given a lead on the Kanban board, when the operator moves it into the org's single `kind: 'conversion'` stage, then `onRequestConversion` opens the proposta wizard prefilled with the lead's empresa, vendedor, produtos, valor estimado and descricao, and NO request of any kind is issued; and when the operator completes the wizard and `POST /api/v1/sales-ops/sales` answers 201, then and only then the cliente is resolved-or-created if the lead carried no `clientId`, the handler resolves the created `sale.id`, and the board emits exactly one `POST /leads/:id/move {stageId, position, saleId}` carrying it, so the card lands in the conversion column and is rendered read-only there because it now carries a `saleId`; and when the operator cancels the wizard, or the wizard's own unchanged `canSaveBasics` / `draftValid` gate refuses an incomplete lead, then `onRequestConversion` resolves `null`, no `POST /clients`, no `POST /sales` and no `POST /leads/:id/move` is issued, and the card is still rendered in its original column."
goal: Moving a lead into the conversion stage opens the proposta wizard prefilled, and the card moves only once the proposta really exists.
must_not_break:
  - "The proposta wizard EDIT path is behaviourally identical. Every seam this slice adds is an `?? ` fallback placed strictly AFTER `prefill?.x` in the same expression, so `editSale !== null` reaches identical state. `apps/web/src/sales-ops/__tests__/sale-wizard-edit.test.tsx` stays green untouched."
  - "The proposta wizard ordinary CREATE path (`Nova proposta`, no lead) is behaviourally identical. `leadPrefill` is absent there, so every initializer takes the branch it takes today. `sale-wizard-ui-contract.test.tsx`, `sale-wizard-payment-plan.test.ts`, `sale-wizard-funcao-costs.test.tsx`, `sale-wizard-professional-split.test.tsx`, `sale-wizard-commission-defaults.test.tsx` and `funcao-cost-seeding.test.ts` stay green untouched."
  - "`canSave`, `canSaveBasics`, `canAdvanceStepOne`, `draftValid`, `itemsValid`, `canAdvanceStepThree`, `submit` and `createPayload` are UNCHANGED. Conversion never relaxes a wizard gate; it seeds state the existing gates then judge."
  - "`SALE_TRANSITIONS` and `EXPECTED_MATRIX` byte-unchanged. `apps/api` is not edited by this slice at all."
  - "Slice 06's `board-write-surface.test.ts` stays green with `leads/conversion.ts` present: nothing under `apps/web/src/sales-ops/leads/` reaches `/transition` or `cancel-contract`, imports `@/lib/app-mutation` outside the container, or declares a second mutation."
  - "Slice 06's `moveTargetsFor` early return on a CONVERTED LEAD (`leadIsConverted`), and its per-card read-only rendering, are untouched. There is no stage-level read-only concept and no `stageIsReadOnly` to preserve. This slice adds no move affordance anywhere."
  - "No new screen inside `SalesOpsApp.tsx`. This slice adds one union arm, two pieces of state, one handler and one optional prop group there."
  - "Stage movement still writes no `audit_log` row, and no lead value reaches `/bootstrap`, `getSalesOpsSummary`, the dashboard or `computeSaleFinancials`."
  - "`apps/web/src/sales-ops/navigation.ts` byte-unchanged by THIS slice (07 owns it)."
rules:
  - "`apps/web/src/sales-ops/leads/conversion.ts` is PURE. It imports only types plus `productBaseValueBrl` from `../calculations`. No React, no fetch, no formatting. Money crosses its boundary as integer CENTS, never as an input string, because `centsToInput` and `parseCurrencyToCents` are module-private to `SalesOpsApp.tsx` and must stay that way."
  - "No native `<select>` / `<option>` / `<datalist>` and no raw `<input type=\"number\">`. This slice adds no picker at all; it reuses the wizard's existing `Combobox`es."
  - "No raw entity id in user-facing copy. Conversion error copy names the proposta's `code` (`V-0001`), never a `saleId` or a `leadId`."
  - "Every value the prefill carries is a DEFAULT the operator may overwrite, exactly like a produto's commission default. Nothing is locked."
  - "`SaleItemForm`, `ProfessionalForm`, `InstallmentRowForm` and `WizardPrefill` stay module-private in `SalesOpsApp.tsx`. The seam type is declared in `leads/conversion.ts` in wizard-agnostic terms and widened at the single call site."
  - "The stage `kind` literals this slice reads are `'normal' | 'conversion' | 'lost'`, per slice 01's schema. Never `'open'`, never `'converted'`. See DEFECT 3."
verifier_focus: "That the lead move is provably downstream of a 201 and of nothing else: drive the REAL `apiFetch` through a stubbed global `fetch`, with `../api` and `../hooks` unmocked, and assert no `/leads/:id/move` request exists while the `POST /sales` is still in flight. That cancelling the wizard issues ZERO non-GET requests, `POST /clients` included. That an incomplete lead (free-text produto, no area) cannot reach `Salvar rascunho` - that is the ghost-card case - and that the test proves non-vacuity by enabling the button once an area is picked. That the three cross-slice defects in section 1 were actually repaired rather than worked around: `MoveLeadPayload.saleId` exists on slice 04's type and is serialized onto the wire as `saleId` by `leadsApi.moveLead`; `LeadsBoard.tsx`'s `emitMove` really spells `onMoveLead({ ...payload, saleId })` after awaiting the handler; and `LeadStageKind` is the three-member union with no `stageIsReadOnly` anywhere. There is no `board-model.ts` and no `LeadMoveCommand` in this feature - if either appears, something re-invented a type slice 06 deliberately does not declare. That the wizard's create and edit initializers took no behaviour change: read the diff of every `useState` initializer in `SaleWizardDialogBody` and confirm each new branch sits strictly after the existing `prefill?.x ??`."
---

# 08 - Conversao: lead para proposta

## 0. Provenance of this plan

Written after reading, in full: `00-OVERVIEW.md`, `01-leads-schema.md`, `02-api-stage-cadastro.md`,
`03-api-leads.md`, `04-web-data-layer.md`, `06-web-kanban-board.md`, the whole proposta wizard in
`apps/web/src/sales-ops/SalesOpsApp.tsx`, `apps/web/src/sales-ops/hooks.ts`,
`apps/web/src/sales-ops/api.ts`, `apps/web/src/sales-ops/optimistic.ts`,
`apps/web/src/lib/query-keys.ts`, `apps/api/src/domains/sales-ops/routes.ts` and
`apps/api/src/db/schema.ts`.

**`07-web-routing.md` was absent** at every one of four checks spread across the whole research
pass, and it is this slice's only declared dependency. What 08 needs from 07 is exactly one thing:

> `LeadsBoardContainer` is rendered from somewhere that can also reach the proposta wizard, and 08
> supplies that render site's `onRequestConversion` prop.

Because `SaleWizardDialog` is mounted in `SalesOpsApp.tsx` (`:2021`) and 06 forbids itself from
touching that file, the only coherent place for 07's mount is inside `SalesOpsApp.tsx`'s own view
switch, beside the other views. **This plan assumes that.** If 07 mounted the container anywhere
else, retarget section 4 to that component and change nothing else: the handler, the state and the
prefill are all location-independent.

---

## 1. THREE CROSS-SLICE DEFECTS THIS SLICE MUST REPAIR

These are not style notes. Each one makes the feature's headline acceptance criterion
unimplementable as the upstream slices are currently written. All three upstream slices are
`status: todo`, so the cheapest repair is in their own files; but because 08 is alone in wave 7 and
04 and 06 are merged by then, 08 can and must repair them itself if they arrive unfixed. Their
files are listed in this slice's `files_modified` for exactly that reason.

**Executor: check each one first. If the upstream slice already fixed it, skip that edit and say so
in the slice report. Do not apply it twice.**

### DEFECT 1 - `MoveLeadPayload` cannot express a conversion move (slice 04)

`03-api-leads.md` section 5 states the contract verbatim:

> Slice 08 therefore drives conversion as: `POST /sales` -> `201` -> `POST /leads/:id/move
> {stageId: <conversion>, position, saleId: <the 201's sale.id>}`.

Note the WIRE spelling: `stageId` and `position`, because `MoveLeadSchema` is `.strict()`. Slice
04 keeps the UI-facing `toStageId` / `toIndex` on `MoveLeadPayload` and translates once, inside
`leadsApi.moveLead`. Nothing in this slice builds a move body by hand.

and `moveLead` step 6 answers `400 validation_error / sale_required_for_conversion` when the
destination is the conversion stage and `input.saleId` is absent.

`04-web-data-layer.md` declares:

```ts
export type MoveLeadPayload = { leadId: string; toStageId: string; toIndex: number; reason?: string | null };
```

**There is no `saleId`.** Every conversion move built through slice 04's client is a guaranteed 400.

**Repair.** In `apps/web/src/sales-ops/leads/api.ts`:

```ts
export type MoveLeadPayload = {
  leadId: string;
  toStageId: string;
  toIndex: number;
  reason?: string | null;
  /**
   * REQUIRED by the API iff the destination stage is `kind: 'conversion'`, and REFUSED
   * (`sale_not_allowed`) for every other destination. It is optional on this type because
   * one payload serves every destination; slice 08 is its only producer, and it produces it
   * only from a `POST /sales` that already answered 201.
   */
  saleId?: string;
};
```

and include `saleId` in the body `leadsApi.moveLead` serializes. Nothing else in 04 changes: the
optimistic patch does not need it (the board's read-only branch keys on `saleId` arriving from the
server refetch, and an optimistic `saleId` would make the card read-only for a beat before the
server has agreed).

### DEFECT 2 - `emitMove` resolves the sale id and throws it away (slice 06)

**First, what slice 06 actually declares**, because an earlier revision of this section named
artifacts that do not exist. There is **no** `apps/web/src/sales-ops/leads/board-model.ts`, **no**
`LeadMoveCommand` type and **no** `board-model.test.ts` anywhere in this feature. Slice 06's own
`rules` say it plainly: *"The move payload type is slice 04's `MoveLeadPayload`. This slice declares
no command type of its own."* The real artifacts are:

| what | where |
|---|---|
| the payload type | `MoveLeadPayload`, in slice 04's `apps/web/src/sales-ops/leads/api.ts` |
| the single emitter | `const emitMove = React.useCallback(...)` in `apps/web/src/sales-ops/leads/LeadsBoard.tsx` (slice 06 §4.3, "The single emitter") |
| the builder | `buildMovePayload` in `apps/web/src/sales-ops/leads/board-move.ts` |

The defect itself is real: slice 06's `emitMove` awaits `onRequestConversion`, gets a `saleId`, and
then calls `onMoveLead(payload)` with a payload that does not carry it. The one value the whole
conversion exists to produce is discarded one line after it arrives, so the move that follows trips
DEFECT 1's `400 sale_required_for_conversion` even after DEFECT 1 is repaired.

**Repair, one line, in `apps/web/src/sales-ops/leads/LeadsBoard.tsx`,** inside `emitMove`'s
conversion branch, replacing `onMoveLead(payload);`:

```ts
      if (saleId === null) return;   // cancelled: the card never moved
      onMoveLead({ ...payload, saleId });
```

That is the whole of it. `saleId` is optional on `MoveLeadPayload` (DEFECT 1), so the
non-conversion branch keeps calling `onMoveLead(payload)` unchanged and never sets the key - which
is what keeps slice 03's `sale_not_allowed` unreachable from the board. `leadsApi.moveLead`
serializes it with a CONDITIONAL spread (`...(saleId ? { saleId } : {})`), so a payload without one
sends no key at all; sending the key with an `undefined` value against a `.strict()` schema is not
a shape this repo should rely on.

`LeadsBoardContainer.tsx` needs **no** mapping edit: it already forwards the payload verbatim
(`onMoveLead={(payload) => moveLead.mutate(payload)}`), and `MoveLeadPayload` is the same type on
both sides. It stays in this slice's `files_modified` only for the `onRequestConversion` wiring.

**Check before editing.** Slice 06 is merged by the time this runs and its plan already carries
this line. If `LeadsBoard.tsx` already spells `onMoveLead({ ...payload, saleId })`, skip this edit
and say so in the slice report.

### DEFECT 3 - `LeadStageKind` disagrees with the column it describes (slice 04 vs 01/03)

`01-leads-schema.md` (the schema owner) and `03-api-leads.md` both state the column is
`kind text NOT NULL DEFAULT 'normal'` over `'normal' | 'conversion' | 'lost'`, with a partial unique
index `(org_id, kind) WHERE kind <> 'normal'` making the conversion stage and the Perdido stage each
AT MOST ONE per org.

`04-web-data-layer.md` declares `export type LeadStageKind = 'open' | 'conversion' | 'lost' | 'converted';`
- four members, of which `'open'` and `'converted'` exist in no migration, no service and no API
response. (`02-api-stage-cadastro.md` quotes the same four-member version in its inherited-contract
block, which is where the error appears to have propagated from.)

This is not cosmetic. `'converted'` invites a reader to believe there is a second, terminal column
distinct from the conversion column. **There is not.** Per 01's partial unique index and 06's
section 5.3, the org has ONE `kind: 'conversion'` stage; it is BOTH the drop target that opens the
wizard AND the read-only column the card lands in. Acceptance 11 and acceptance 13 are two
descriptions of one column.

**Repair.** `export type LeadStageKind = 'normal' | 'conversion' | 'lost';` and fix every reader.
`01` wins; if 01 shipped different literals, 01 still wins and this slice adapts to it.

**The second half of that repair, which is where the design question actually was.** Slice 04 used
to export `stageIsReadOnly(stage) === (stage.kind === 'converted')` and slice 06 keyed a read-only
COLUMN on it. With no fourth kind there is nothing for that predicate to test, and the resolution
is not to re-point it at `'conversion'` - that would make the conversion column un-droppable and
acceptance 11 unreachable. The resolution is:

- **`stageIsReadOnly` is DELETED.** Read-only is a property of the CARD:
  `leadIsConverted(lead) === (lead.saleId !== null)`. A converted card renders the `sale.status`
  mirror, gets no move trigger, gets no drag handle, and `moveTargetsFor` offers it nothing
  (acceptance 13).
- **No column is read-only.** The `kind: 'conversion'` column is an ordinary drop target.
- **The `'conversion'` stage has two directions and they are different.** As a SOURCE it is
  nothing special (its cards are converted, so the card rule already refuses them). As a
  DESTINATION it is the one target that never moves the card optimistically: `emitMove` hands back
  to `onRequestConversion`, the wizard opens, and the card changes stage only after `POST /sales`
  answers 201 with the resolved `saleId` riding the move. Cancelling leaves the card exactly where
  it was, with nothing persisted.
- **The keyboard menu and drag do exactly the same thing** (acceptance 9), because both end in
  `emitMove`.

Both slices 04 and 06 carry this in their own plans now, so by the time this slice runs there
should be nothing to repair. Check first; if `stageIsReadOnly` exists anywhere, delete it and
re-point its readers at `leadIsConverted`.

### What this slice does NOT need from the API

Nothing. `03-api-leads.md` already delivers every server behaviour 08 relies on: the `saleId`
requirement on a conversion move, the in-org `SELECT` that validates it, `sale_not_allowed` for a
`saleId` aimed elsewhere, and `409 already_converted` for a lead whose `sale_id` is already set. **No
decimal mid-flight slice is required.** Had 03 omitted the `saleId` field on the move, `03.1` would
have been the answer; it did not.

---

## 2. What this slice is

Three things, and deliberately nothing else.

1. **A pure prefill module** (`leads/conversion.ts`) turning a `SalesOpsLead` plus the sales-ops
   bootstrap into wizard-agnostic seed values, plus the cliente name matcher.
2. **A `'convert'` arm** on the `SaleWizardRequest` union at `SalesOpsApp.tsx:299`, plus an optional
   `leadPrefill` prop on `SaleWizardDialog` that seeds five `useState` initializers and nothing else.
3. **A promise-shaped conversion handler** wired to 06's `onRequestConversion`, running
   resolve-or-create-cliente, then `POST /sales`, then resolving the created sale id, strictly in
   that order, and resolving `null` on every other outcome.

It is **not** a change to how propostas work. Every gate, every payload, every render-phase guard and
every calculation in the wizard is untouched. The conversion seeds state; the wizard then judges it
with exactly the rules it already has. That is why acceptance 11's ghost-card clause needs no new
validation at all: the wizard already refuses to save without a cliente, an item carrying an area,
and `totalCents > 0`.

### Why 06's promise seam makes acceptance 11 structural rather than merely tested

`onRequestConversion: (request) => Promise<string | null>` is the right shape and it is worth saying
why, because a future refactor will be tempted to flatten it into a callback. The board's `emitMove`
does not move the card before `await`ing it, and `null` means "do nothing at all". So "the card only
moves after the proposta exists" is not a rule enforced by a guard somewhere; it is the only thing
the control flow can express. Slice 08 must keep it that way: **the handler must never call any lead
mutation itself.** It resolves an id, and the board owns the move. One writer.

---

## 3. Read this before you start

The wizard is roughly 3000 lines inside an 8946-line file. These are the landmarks (line numbers
from the commit this plan was written against - grep the symbol, do not trust the number):

| what | where |
|---|---|
| `type SaleWizardRequest` | `SalesOpsApp.tsx:299` |
| `const [saleWizard, setSaleWizard]` | `:1164` |
| `createClientByName` (the existing inline-create seam) | `:1233` |
| `<SaleWizardDialog ...>` mount, incl. `onSave` | `:2021-2048` |
| `type SaleItemForm` | `:5659` |
| `type WizardPrefill` | `:5765` |
| `deriveWizardPrefill` | `:5884` |
| `export function SaleWizardDialog` | `:5999` |
| `key={props.editSale?.id ?? 'create'}` | `:6032` |
| `function SaleWizardDialogBody` | `:6048` |
| `const prefill = editSale ? deriveWizardPrefill(...) : null` | `:6155` |
| the `clientId` / `clientName` / `sellerPersonId` / `notes` initializers | `:6160-6165` |
| the `items` initializer with its `firstProduct` seed | `:6213-6228` |
| `const canSave = Boolean(clientName.trim() && sellerPersonId && items.length > 0)` | `:6405` |
| `const canSaveBasics = canSave && totalCents > 0` | `:6698` |
| `draftValid` | `:6700` |
| `createPayload` | `:7243` |
| `function submit` | `:7349` |

Also read, in full: `CLAUDE.md` sections "Propostas domain", "Produtos & Servicos", "UI Controls",
"Tenancy", "UI Identifiers".

Two facts from that reading are load-bearing and easy to miss.

**`prefill` is derived from `editSale` and from nothing else.** There is no existing external prefill
seam. That is why this slice adds one rather than reusing `deriveWizardPrefill`.

**`editSale` is a behavioural discriminator, not merely data.** `if (!editSale)` gates the
produto-funcao seeding block (`:6550`); `deriveWizardPrefill` marks every prefilled professional row
`costManual: true` unconditionally; the dialog title reads `Editar proposta`; and `submit` refuses
when `editSale.status` is not `draft`/`open`. **Therefore a conversion must NEVER be expressed as a
synthetic `editSale`.** A conversion is a CREATE that happens to arrive with seed values, and it must
keep every create-path behaviour: funcoes seeded from the produtos, produto commission defaults
applied, `Nova proposta` as the title. A fake sale there silently disables all three, and nothing in
the type system would notice.

---

## 4. File 1 - `apps/web/src/sales-ops/leads/conversion.ts` (new, pure)

No React, no fetch, no formatting. Imports `productBaseValueBrl` from `../calculations` and types
only. It sits under `leads/`, so slice 06's `board-write-surface.test.ts` scanner already covers it
and will fail if it ever grows a mutation or a `/transition` string. That is deliberate.

```ts
import { productBaseValueBrl } from '../calculations';
import type { SalesOpsBootstrap } from '../types';
import type { SalesOpsLead } from './api';   // slice 04's module; retarget if 04 split types out

/**
 * A wizard seed item expressed in terms the wizard does not own. Money crosses as
 * integer CENTS, never as an input string: `centsToInput` is module-private to
 * SalesOpsApp.tsx and exporting it to reach in here would widen that file's public
 * surface for a formatting detail.
 */
export type LeadConversionItem =
  | { kind: 'product'; productId: string; unitCents: number }
  | { kind: 'free'; customLabel: string; unitCents: number };

export type LeadConversionPrefill = {
  /**
   * Wizard session identity. Feeds `SaleWizardDialogBody`'s `key`, so converting lead A,
   * cancelling, then converting lead B re-seeds instead of showing A's values.
   */
  leadId: string;
  clientId: string;
  clientName: string;
  sellerPersonId: string;
  notes: string;
  /** EMPTY means "no opinion": the wizard then takes its ordinary create-path seed. */
  items: LeadConversionItem[];
};

export function buildLeadConversionPrefill(
  lead: SalesOpsLead,
  bootstrap: Pick<SalesOpsBootstrap, 'clients' | 'people' | 'products'>,
): LeadConversionPrefill;

/**
 * Case-, accent- and whitespace-insensitive match against the clientes already in the
 * snapshot. Returns the id, or `null`.
 */
export function findClientByName(
  clients: readonly SalesOpsBootstrap['clients'][number][],
  name: string,
): string | null;
```

### 4.1 `buildLeadConversionPrefill` - exact rules

**`leadId`** is `lead.id`.

**empresa.** `clientId = lead.clientId ?? ''`. `clientName` is the `name` of the bootstrap cliente
whose id equals `lead.clientId` when it resolves, otherwise `lead.clientNameSnapshot` (slice 03's
`LeadView` projects that column NOT NULL and is its only writer, so it is always present; there is no
third fallback and no `companyName` field on the wire). A `lead.clientId` that does not resolve in
the snapshot keeps the id AND falls back to the snapshot name: the wizard's cliente `Combobox`
renders exactly that through its `valueLabel` prop, which is what it already does for a name typed
into the create row.

**vendedor.** `sellerPersonId = lead.sellerPersonId` **only if** that person is in `bootstrap.people`,
has `status === 'active'`, and carries the `vendedor` system funcao. Otherwise `''`.

> This is a **deliberate divergence** from the create path, which seeds `firstSeller?.id`. Seeding
> whoever sorts first onto a conversion would silently attribute a real proposta - and every
> commission derived from it - to the wrong person, which is the same class of bug as the deleted
> `allocatablePeople[0]` professional seed that `CLAUDE.md` already records. `''` is not a dead end:
> `canSave` requires a vendedor, so the wizard simply refuses to advance until the operator picks one.
> An inactive or de-funcionado vendedor must cost one click, never one silent misattribution.
>
> The funcao test is `person.funcaoIds` resolved against the `vendedor` SYSTEM funcao, per acceptance
> 4 and `CLAUDE.md` "Pessoas e Funcoes". **Never** the deprecated `is_seller` mirror, which
> `SalesOpsPerson` does not even declare on the web side. If `SalesOpsApp`'s module-private
> `hasFuncao` is the only spelling of this test, hoist it to `../calculations` in this slice and have
> both sites import it rather than writing a second copy - a per-call-site slug comparison is
> explicitly banned by `CLAUDE.md`.

**descricao.** `notes = lead.description ?? ''`, verbatim, including whitespace. `notes` is free text
and trimming it would silently edit the operator's words.

**produtos.** One item per entry of `lead.products`, in stored order:

- `productId` non-null AND resolvable in `bootstrap.products` ->
  `{ kind: 'product', productId, unitCents: productBaseValueBrl(product) }`.
  `productBaseValueBrl` is the ONE place a catalog own value is read (`CLAUDE.md`, "Produtos &
  Servicos"), so a Servico with no base value seeds `0` - which the wizard's `needsNegotiatedValue`
  gate then refuses to save. That is correct and is the ghost-card oracle's second case.
- `productId` null, OR non-null but NOT resolvable ->
  `{ kind: 'free', customLabel: productNameSnapshot, unitCents: 0 }`.
  A stale id is downgraded to free text rather than dropped: the operator's words survive, and a free
  row then requires an `areaId` the operator must pick.

**valor estimado.** After the rows are built: **if** `lead.estimatedValueBrl > 0` (integer cents,
despite the `Brl` suffix - that is this repo's universal convention, see `unitBrl`, `costBrl`,
`amountBrl`) **and** the sum of the rows' `unitCents` is `0`, write the whole estimate onto row `0`'s
`unitCents`. Otherwise the estimate is written nowhere.

> Stated as a rule rather than a heuristic. A catalog price is a number the cadastro asserts; an
> estimate is a guess. When the catalog says nothing at all - every row free text, or every produto a
> Servico with no base value - the estimate is the only number anyone has and it beats zero. When the
> catalog does speak, overwriting it with a single lump sum would destroy the per-item prices to make
> a total agree, and the operator can always retype. **The estimate is never split across rows**:
> no defensible split exists, and `splitCentsByWeights` is a payment primitive, not a pricing one.

**zero produtos.** Return `items: []`. The call site then takes the wizard's existing `firstProduct`
create-path seed. Returning one empty row instead would put an unsaveable row on screen and hide the
wizard's own default.

### 4.2 `findClientByName` - exact rules

`normalize(s) = s.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase().replace(/\s+/g, ' ')`.

Return the id of the first cliente whose normalized `name` equals `normalize(name)`, in array order;
`null` when `name` normalizes to `''` or nothing matches.

Accent folding is deliberate: `Construtora Ipe` and `Construtora Ipê` are one company, and creating
the second is exactly the duplicate this function exists to prevent. `\p{Diacritic}` with the `u`
flag is ES2018 and already within this repo's target.

> **`sales_ops_clients` has NO unique index on `(org_id, name)`** - only the non-unique
> `sales_ops_clients_org_id_idx` on `(org_id, name)`. So this is a best-effort dedupe against a
> possibly-stale snapshot and `ON CONFLICT` is not available. Two operators converting the same
> empresa concurrently still create two clientes; each proposta correctly points at one of them, no
> data is lost, and `cadastros/clientes` can merge them by hand. Adding the unique index is not free -
> existing orgs may already hold duplicate names, so it is a destructive migration against live data,
> on a table this slice does not own. Recorded in `nexo/ROADMAP.md` rather than attempted here.

---

## 5. File 2 - `apps/web/src/sales-ops/SalesOpsApp.tsx` (edit)

### 5.1 The union gains one arm (`:299`)

```ts
type SaleWizardRequest =
  | { mode: 'create' }
  | { mode: 'edit'; sale: SalesOpsSale }
  | { mode: 'convert'; lead: SalesOpsLead; prefill: LeadConversionPrefill; settle: ConversionSettle };
```

where

```ts
/** The two halves of the promise 06's `onRequestConversion` returned. */
type ConversionSettle = {
  resolve: (saleId: string | null) => void;
  reject: (error: unknown) => void;
};
```

The prefill is computed ONCE, when the request arrives, and carried on the request rather than
recomputed per render. That keeps it out of the render path and makes the wizard `key` stable.

### 5.2 Two pieces of state, beside `saleWizard` (`:1164`)

```ts
/**
 * The proposta a conversion has ALREADY created but whose move has not landed. It exists so a
 * failed move is retried with the SAME sale, never by POSTing a second proposta. Keyed by lead
 * id. Cleared when a later conversion for that lead resolves.
 */
const [convertedSales, setConvertedSales] =
  useState<Record<string, { saleId: string; saleCode: string }>>({});
```

### 5.3 The handler wired to 06's seam

```ts
/**
 * Slice 06's `onRequestConversion`. Returns a promise the BOARD awaits before it moves
 * anything, so "the card only moves after the proposta exists" is the shape of the control
 * flow rather than a rule some guard enforces.
 *
 * This function must NEVER call a lead mutation. It resolves an id; the board owns the move.
 */
function requestLeadConversion(request: LeadConversionRequest): Promise<string | null> {
  // Slice 06 declares `LeadConversionRequest = { lead, toStageId, toIndex }`. The field is
  // `lead`; there is no `source`.
  const lead = request.lead;

  // A proposta already exists for this lead in this session: only the move is outstanding.
  const already = convertedSales[lead.id];
  if (already) return Promise.resolve(already.saleId);

  return new Promise<string | null>((resolve, reject) => {
    setSaleWizard({
      mode: 'convert',
      lead,
      prefill: buildLeadConversionPrefill(lead, persistedBootstrap),
      settle: { resolve, reject },
    });
  });
}
```

and the conversion save:

```ts
async function saveLeadConversion(
  wizard: Extract<SaleWizardRequest, { mode: 'convert' }>,
  payload: CreateSalePayload,
) {
  // STEP 1 - resolve-or-create the cliente. HERE and nowhere earlier (acceptance 12).
  let clientId = payload.clientId ?? '';
  if (!clientId) {
    const existing = findClientByName(persistedBootstrap.clients, payload.clientName);
    if (existing) {
      clientId = existing;
    } else {
      const created = await createClientByName(payload.clientName);
      if (!created) return;                    // wizard stays open; no sale POSTed; card unmoved
      clientId = created.id;
    }
  }

  // STEP 2 - the proposta. The card has still not moved.
  let response: { sale: unknown };
  try {
    response = await createSale.mutateAsync({ ...payload, clientId });
  } catch {
    return;                                    // 400/500: wizard stays open; card unmoved
  }
  const created = createdSaleIdentity(response.sale);
  if (!created) return;                        // malformed 201: fail closed, do not move

  // STEP 3 - and ONLY now, hand the id back so the board may move the card.
  setConvertedSales((current) => ({ ...current, [wizard.lead.id]: created }));
  wizard.settle.resolve(created.id);
  setSaleWizard(null);
}
```

`createdSaleIdentity(sale: unknown): { saleId: string; saleCode: string } | null` is a local runtime
guard (`typeof sale === 'object' && sale !== null && typeof (sale as {id?: unknown}).id === 'string'`,
and likewise for `code`). It exists because `salesOpsApi.createSale` is typed
`{ sale: unknown; ledger: unknown }` and **that typing is deliberately not widened by this slice**:
widening it would be an unchecked assertion over a response nothing validates, and the one place
that needs the id can afford ten lines of guard. It fails CLOSED - no id means no move, leaving a
real proposta and an unmoved card, which is the recoverable direction.

### 5.4 Cancellation

`onClose` becomes:

```tsx
onClose={() => {
  if (saleWizard?.mode === 'convert') saleWizard.settle.resolve(null);
  setSaleWizard(null);
}}
```

That `resolve(null)` is the whole of acceptance 11's "sem estado intermediario persistido": 06's
`emitMove` sees `null` and returns before touching the optimistic cache, before calling `onMoveLead`
and before issuing any request. Nothing is undone because nothing was started.

**A conversion request must always settle.** If the component unmounts with a `'convert'` wizard
open, the promise is left pending forever and 06's `emitMove` never returns. Add a cleanup effect
keyed on nothing (`useEffect(() => () => { ... }, [])` reading the latest wizard through a ref) that
resolves `null` on unmount. The alternative - leaving it hanging - is invisible in tests and shows up
as a board that silently stops accepting moves.

### 5.5 The mount site (`:2021-2048`)

```tsx
  editSale={saleWizard?.mode === 'edit' ? saleWizard.sale : null}
  leadPrefill={saleWizard?.mode === 'convert' ? saleWizard.prefill : null}
  onSave={(payload) => {
    if (saleWizard?.mode === 'edit') {
      updateSale.mutate({ saleId: saleWizard.sale.id, payload }, { onSuccess: () => setSaleWizard(null) });
    } else if (saleWizard?.mode === 'convert') {
      void saveLeadConversion(saleWizard, payload);
    } else {
      createSale.mutate(payload, { onSuccess: () => setSaleWizard(null) });
    }
  }}
```

`saving` is unchanged (`createSale.isPending || updateSale.isPending`): the lead move is the board's,
not the wizard's, and the wizard is already closed by the time it runs.

The container gets `onRequestConversion={requestLeadConversion}` at 07's mount site and nothing else.

### 5.6 `SaleWizardDialog` - the optional prop

```ts
export function SaleWizardDialog(props: {
  ...existing props, unchanged...
  /**
   * Seed values for a lead -> proposta conversion. Mutually exclusive with `editSale` by
   * construction: `{mode:'convert'}` carries no sale. Every initializer reads it only AFTER
   * `prefill?.x`, so the edit path is provably unaffected.
   */
  leadPrefill?: LeadConversionPrefill | null;
})
```

forwarded to the body, and the session key becomes

```tsx
key={props.editSale?.id ?? props.leadPrefill?.leadId ?? 'create'}
```

### 5.7 `SaleWizardDialogBody` - exactly five initializers change

Every one keeps `prefill?.x ??` FIRST. Nothing else in the body is edited.

```ts
const [clientId, setClientId] =
  useState(prefill?.clientId ?? leadPrefill?.clientId ?? firstClient?.id ?? '');

const [clientName, setClientName] =
  useState(prefill?.clientName ?? leadPrefill?.clientName ?? firstClient?.name ?? '');

// NOTE the shape: when a leadPrefill exists there is NO firstSeller fallback (section 4.1).
const [sellerPersonId, setSellerPersonId] = useState(
  prefill?.sellerPersonId ?? (leadPrefill ? leadPrefill.sellerPersonId : (firstSeller?.id ?? '')),
);

const [notes, setNotes] = useState(prefill?.notes ?? leadPrefill?.notes ?? '');

const [items, setItems] = useState<SaleItemForm[]>(() =>
  prefill?.items ??
  (leadPrefill && leadPrefill.items.length > 0
    ? leadPrefill.items.map(toSaleItemForm)
    : (firstProduct ? [ ...the existing single-row seed, byte-unchanged... ] : [])),
);
```

with the widener declared beside `itemsTotalCents`:

```ts
function toSaleItemForm(item: LeadConversionItem): SaleItemForm {
  return item.kind === 'product'
    ? { kind: 'product', productId: item.productId, areaId: '', customLabel: '',
        quantity: '1', unitBrl: centsToInput(item.unitCents), descriptionOpen: false }
    : { kind: 'free', productId: '', areaId: '', customLabel: item.customLabel,
        quantity: '1', unitBrl: centsToInput(item.unitCents), descriptionOpen: false };
}
```

`areaId: ''` on a product row is the existing convention - a product row derives its area from the
produto. `areaId: ''` on a **free** row is the ghost-card guard: `draftValid` requires
`Boolean(item.areaId)` for a free row, so a lead whose produto is only free text cannot be saved
until the operator picks an area. **This is load-bearing. Do not seed it.**

### 5.8 What is deliberately NOT seeded, and why

- **`commissionDefaultsSource` / `planShapeSource` / `manualOverrides`.** Untouched. They key on
  `firstProduct` on the create path, and on the first render the render-phase guards re-apply
  defaults for whatever produto item 0 names - exactly what already happens when the operator changes
  item 0's produto by hand. A conversion is therefore indistinguishable from a hand-built proposta
  from the guards' point of view, which is the point.
- **`funcaoCostSeedKey` and the produto-funcao seeding block.** Untouched, and it FIRES, because
  `editSale` is `null`. A converted lead gets its produtos' declared funcoes seeded like any new
  proposta. Expressing conversion as a fake `editSale` would have silently killed this.
- **The payment plan, the recorrencia, the profissionais, the impostos, the comissoes.** A lead
  carries none of them; they take their ordinary create-path defaults.
- **The step.** The wizard opens at step 1, as always. A conversion has more to fill in, not less.

---

## 6. The one remaining hazard, named

`POST /sales` succeeds and the lead move then fails. The proposta exists; the card has not moved.
Without a guard the operator retries, the wizard opens again, and a SECOND proposta is created for
one lead - worse than a ghost card, because a proposta carries a code and a sequence and cannot be
un-created (`salesOpsRouter` has no DELETE verb, by law).

The guard is two-sided and both halves are required.

- **Client, within a session.** `convertedSales[lead.id]` survives the wizard closing.
  `requestLeadConversion` returns the stored id immediately, so the retry re-issues only the move and
  `POST /sales` is unreachable a second time for that lead. The board should surface it: pass the
  stored `saleCode` down so the card can show a muted `Proposta V-0001 criada - reenvie para mover`
  line. (If 06's `BoardLead` has no slot for that, it is a nice-to-have, not a requirement; the
  correctness is in `convertedSales`, not in the copy.)
- **Server, across a reload.** `convertedSales` dies with the page. Slice 03's
  `409 already_converted` is what survives it - but note precisely what it does and does not buy.
  After a reload the retry DOES issue a second `POST /sales`; the move that follows is then refused
  409 only if the FIRST move had landed. If the first move never landed, `sale_id` is still null, the
  second move succeeds, and the first proposta is orphaned - it exists, it is visible on the
  propostas screen as a `Rascunho`, and it is not linked to any lead.

**That orphan is a real, narrow, accepted cost**, recorded here and in `nexo/ROADMAP.md` rather than
discovered later. It is bounded: it requires a failed move, a page reload, and a retry, and its
worst outcome is one extra rascunho an operator can see and delete-by-archiving. Closing it properly
needs a single transactional `POST /leads/:id/convert` that creates the sale and moves the lead in
one transaction - which would duplicate the whole `CreateSaleSchema` surface, make a second creator
of `sales_ops_sales`, and contradict acceptance 11's explicit naming of `POST /sales`. Out of scope.

---

## 7. Tests

Both under `apps/web/src/sales-ops/leads/__tests__/` (the directory slice 06 establishes, so 06's
`board-write-surface.test.ts` scanner covers the new source file too).

```bash
pnpm --filter @fxl-sales/web test src/sales-ops/leads/__tests__/lead-conversion-prefill.test.ts
pnpm --filter @fxl-sales/web test src/sales-ops/leads/__tests__/lead-conversion.test.tsx
```

`apps/web/package.json` already spells `"test": "vitest run"`. **Never** a bare watching `vitest`.

### 7.1 `lead-conversion-prefill.test.ts` - pure, no DOM

| # | title | decisive mutation |
|---|---|---|
| P1 | `seeds empresa, vendedor, descricao and produtos from the lead` | delete any single field's assignment in `buildLeadConversionPrefill` |
| P2 | `leaves the vendedor blank when the pessoa is inactive or does not carry the vendedor funcao` | pass `lead.sellerPersonId` straight through, or add a `firstSeller` fallback - the exact misattribution bug |
| P3 | `downgrades a produto id that resolves to nothing into a free-text row` | drop the resolvability check and emit `kind:'product'` with a dangling id |
| P4 | `writes the estimated value only when no produto supplies a price` | make the estimate unconditional (it overwrites a catalog price -> red), or delete the estimate branch (a free-text-only lead seeds 0 -> red) |
| P5 | `returns no items for a lead with no produtos, so the wizard keeps its own seed` | return a single empty row instead of `[]` |
| P6 | `matches an existing cliente across case, accents and surrounding whitespace` | drop the NFD fold: `Construtora Ipê` stops matching `  construtora ipe  ` and a duplicate cliente is created |
| P7 | `keeps the clientId when the lead names a cliente the snapshot does not carry, and falls back to its name snapshot` | drop either half - losing the id silently un-links a real cliente; losing the name renders a blank trigger |

### 7.2 `lead-conversion.test.tsx` - the oracles acceptance 11, 12 and 13 demand

`// @vitest-environment happy-dom`. It drives the **REAL** `apiFetch` through a stubbed global
`fetch`, with `../../api`, `../../hooks`, `../api` and `../hooks` UNMOCKED, exactly as
`entitlement-dead-end.test.tsx` does - because the whole claim under test is *which HTTP requests are
issued, and in what order*. A mocked hook lets the ordering bug pass.

Each test records every `fetch` call into `writes: Array<{method, url, body}>`, filtered to non-GET.
It renders the real `LeadsBoardContainer` (or 07's mount, if 07 renders something above it) together
with the real `SaleWizardDialog`, moves a card through the **keyboard** `Mover para` dialog - never
through a drag simulation, per 06's `verifier_focus`: the keyboard path is the real control.

| # | title | asserts | decisive mutation |
|---|---|---|---|
| **C1** | **`issues no request at all when the conversion wizard is cancelled, and leaves the card in its column`** | `writes` is `[]`; the card is still inside its original `[data-stage-column]` | move the `onMoveLead(command)` call in 06's `emitMove` above the `await`, i.e. optimistic-first conversion -> a `POST /leads/:id/move` appears and the test goes red. Also red if the cliente resolve-or-create is hoisted to wizard-open, or if `onClose` forgets `settle.resolve(null)` (the board then never returns and the card never settles anywhere) |
| **C2** | **`refuses to convert a lead whose only produto is free text, so an incomplete lead cannot become a ghost card`** | lead with one `productId: null` product and `estimatedValueBrl: 250000`; the wizard opens at step 1; `Salvar rascunho` AND the step-4 `Salvar proposta` are both `disabled`; `writes` is `[]`; the card is still in its original column. **Then** pick an area in the item's `Combobox` and assert `Salvar rascunho` becomes enabled | seed `areaId` in `toSaleItemForm` from anything at all, or give conversion mode its own relaxed gate -> `draftValid` turns true with no area and the card moves with an invalid proposta. The second half is the **non-vacuity control**: without it the test passes against a wizard that renders nothing |
| **C3** | **`moves the card only after POST /sales resolves 201, and never while it is in flight`** | hold the `POST /sales` `fetch` on a manually-resolved promise. While pending: no `/leads/` `move` request in `writes`, and the card is still in its original column. Then resolve `201 {sale:{id,code,status:'draft'}}` and assert exactly one `POST /leads/<id>/move` fired, its body carries `saleId` equal to the returned `sale.id` and `stageId` equal to the `kind:'conversion'` stage id (the WIRE names, per slice 03's strict `MoveLeadSchema`), and the card is now in that column | fire the move in parallel with the POST, resolve the promise before the POST settles, or settle from a `finally` -> red on the in-flight assertion. **Deleting DEFECT 2's repair is also red here**, on the `saleId` body assertion |
| **C4** | **`leaves the card in place and issues no lead move when POST /sales fails`** | the POST answers `400 {error:'validation_error'}`; no `/move` request anywhere in `writes`; card unmoved; the wizard is still open (its `Nova proposta` title still on screen) | settle from `onSettled` rather than the success path, or resolve the id before the guard |
| **C5** | **`creates the cliente only when the conversion is saved, and never when the wizard opens`** | lead with `clientId: null` and a name matching no cliente. At wizard-open: `writes` is `[]`. After saving: `writes[0]` is `POST .../clients`, `writes[1]` is `POST .../sales`, **in that order**, and the `/sales` body's `clientId` equals the id the `/clients` response returned | hoist the resolve-or-create into `requestLeadConversion`, into 06's `emitMove`, or into a wizard mount effect -> red on the open-time assertion. Also red if the order is swapped |
| **C6** | **`reuses an existing cliente by name instead of creating a second one`** | bootstrap already carries `Construtora Ipê`; the lead's snapshot name is `  construtora ipe  `. `writes` contains **no** `POST .../clients`, and the `/sales` body carries the existing cliente's id | delete the `findClientByName` branch, leaving create-always -> a duplicate cliente is POSTed |
| **C7** | **`converts once and retries only the move, never a second proposta`** | complete a conversion whose `/move` answers 500; then move the same lead into the conversion stage again and save. The second attempt issues **no** second `POST .../sales`, and issues one more `/move` carrying the SAME `saleId` | clear `convertedSales` in `onClose`, or drop the early return in `requestLeadConversion` -> a second proposta is created, which is unrecoverable because there is no DELETE verb |
| **C8** | **`the conversion path never reaches the sale transition endpoints`** | across every test in the file, no recorded url contains `/transition` or `/cancel-contract`; and with a lead already converted (`saleId` set, `saleStatus: 'won'`) the card renders no `[data-move-trigger]`, carries `[data-read-only-card]`, sits inside the `[data-conversion-column]`, and shows `Ganha` | wire any board or conversion control to `useTransitionSalesOpsSale`, or make a converted card a drag source -> red. **The structural half already exists upstream** as 06's `moveTargetsFor` oracle 3 and `board-write-surface.test.ts`; this test must not re-implement the source scanner, it asserts the BEHAVIOUR of the live conversion path so the two are independent |

> On C8's division of labour, stated so nobody deletes the wrong half later: 06's
> `board-write-surface.test.ts` reads the `leads/` directory's source text and is what makes the ban
> irreversible for code no test exercises. C8 drives the real conversion flow and is what proves the
> path this slice actually adds does not reach a transition. Neither subsumes the other, and
> `conversion.ts` living under `leads/` is what puts this slice's new module inside 06's scanner for
> free.

### 7.3 Regression set Verify must also run (unchanged behaviour, must stay green)

```bash
pnpm --filter @fxl-sales/web test \
  src/sales-ops/__tests__/sale-wizard-edit.test.tsx \
  src/sales-ops/__tests__/sale-wizard-ui-contract.test.tsx \
  src/sales-ops/__tests__/sale-wizard-payment-plan.test.ts \
  src/sales-ops/__tests__/sale-wizard-funcao-costs.test.tsx \
  src/sales-ops/__tests__/sale-wizard-professional-split.test.tsx \
  src/sales-ops/__tests__/sale-wizard-commission-defaults.test.tsx \
  src/sales-ops/__tests__/funcao-cost-seeding.test.ts \
  src/sales-ops/__tests__/sales-transition-actions.test.tsx \
  src/sales-ops/leads/__tests__/board-move.test.ts \
  src/sales-ops/leads/__tests__/leads-board-keyboard.test.tsx \
  src/sales-ops/leads/__tests__/board-write-surface.test.ts
```

Then the wave gate: `pnpm run lint`, `pnpm run type-check`, `pnpm test`, `pnpm run build`,
`pnpm --filter @fxl-sales/api test:integration`.

`apps/api` is not edited by this slice, so `SALE_TRANSITIONS` / `EXPECTED_MATRIX` are byte-unchanged
by construction. Verify should still confirm with

```bash
git diff --stat <slice-base>..HEAD -- apps/api
```

returning empty.

---

## 8. Documentation

`CLAUDE.md` gains, inside the leads-domain section slice 01 or 07 opens (**do not open a second
one**), these paragraphs - each recording a decision invisible from the code:

- The conversion sequence is cliente, then `POST /sales`, then the lead move, in that order, and the
  lead move is the BOARD's, never the handler's. `onRequestConversion` resolves an id or `null`; 06's
  `emitMove` awaits it before touching anything. "The card only moves after the proposta exists" is
  therefore the shape of the control flow rather than a rule a guard enforces, and flattening that
  promise into a callback would silently destroy it.
- A conversion is a CREATE and is **never** expressed as a synthetic `editSale`. `editSale` is a
  behavioural discriminator: it gates the produto-funcao seeding block, it marks every professional
  row `costManual`, it retitles the dialog, and it gates `submit` on the sale's status. A fake sale
  there disables all four and nothing in the type system notices.
- The conversion prefill relaxes **no** wizard gate. `canSaveBasics` and `draftValid` are unchanged,
  and a free-text lead produto seeds `areaId: ''` on purpose so an incomplete lead is refused by the
  rules the wizard already had. That is the whole of the ghost-card guarantee.
- The lead's vendedor is seeded only when the pessoa is active and carries the `vendedor` system
  funcao; otherwise the field is left BLANK and is deliberately **not** defaulted to `firstSeller`,
  because attributing a real proposta and its commissions to whoever sorts first is the same class of
  bug as the deleted `allocatablePeople[0]` professional seed.
- There is exactly ONE `kind: 'conversion'` stage per org (slice 01's partial unique index on
  `(org_id, kind) WHERE kind <> 'normal'`), and it is BOTH the drop target that opens the wizard AND
  the column the card lands in. Acceptance 11 and acceptance 13 describe one column, not two.
  `LeadStageKind` is `'normal' | 'conversion' | 'lost'`; `'open'` and `'converted'` were a drafting
  error in slices 02 and 04, exist in no migration, and are gone from both plans.
  Read-only is a property of the CARD (`leadIsConverted`), never of the column: the conversion
  column is a live drop target for a card that has no proposta yet, and that is precisely the
  gesture that opens the wizard.
- `sale_id` and "is in the conversion column" cannot diverge, and the API is what guarantees it:
  `sale_required_for_conversion` refuses a conversion move with no sale, `sale_not_allowed` refuses a
  sale aimed at any other stage, and `already_converted` refuses a second one.
- The duplicate-proposta window: `convertedSales` closes it within a session, and slice 03's
  `409 already_converted` closes the sub-case where the first move landed. The remaining case - failed
  move, page reload, retry - leaves ONE orphaned rascunho, and that is accepted and filed rather than
  prevented.
- `sales_ops_clients` has no unique index on `(org_id, name)`, so `findClientByName` is a best-effort
  dedupe against a possibly-stale snapshot; concurrent conversions of the same empresa still create
  two clientes.

`nexo/ROADMAP.md` gains two entries, matching the last two bullets above.

---

## 9. Deliberately left out

- **A transactional `POST /leads/:id/convert`.** It would remove the reload window entirely, but it
  duplicates the whole `CreateSaleSchema` surface, makes a second creator of `sales_ops_sales`, and
  contradicts acceptance 11's explicit naming of `POST /sales`. Filed to ROADMAP.
- **A unique index on `sales_ops_clients (org_id, name)`.** It would make resolve-or-create race-free
  via `ON CONFLICT`, but it is a destructive migration against data that may already violate it, on a
  table this slice does not own. Filed to ROADMAP.
- **Splitting the lead's estimated value across multiple produtos.** No defensible split exists.
- **Prefilling the payment plan, the recorrencia, the impostos or the comissoes.** A lead carries
  none of them.
- **Widening `salesOpsApi.createSale`'s `{ sale: unknown }` return type.** An unchecked assertion over
  a response nothing validates; a ten-line guard that fails closed is cheaper and honest.
- **Persisting the wizard's in-progress state across a cancel.** Out of scope for the whole product
  and already filed in `nexo/ROADMAP.md`.
- **Any change to `SALE_TRANSITIONS`, `EXPECTED_MATRIX`, `computeSaleFinancials`, `buildSalePayload`,
  `createPayload`, `submit` or any wizard gate.** By law.
