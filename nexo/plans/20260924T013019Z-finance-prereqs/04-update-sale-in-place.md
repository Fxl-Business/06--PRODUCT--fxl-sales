---
id: 04-update-sale-in-place
milestone: v4.1.0
status: done
depends_on: [01-sao-paulo-day, 02-liquidacao-reducer, 03-ledger-schema]
files_modified: [apps/api/src/domains/sales-ops/ledger-reconcile.ts, apps/api/src/domains/sales-ops/ledger-revision.ts, apps/api/src/domains/sales-ops/ledger-dates.ts, apps/api/src/domains/sales-ops/settlement-locks.ts, apps/api/src/domains/sales-ops/sale-edit-writes.ts, apps/api/src/domains/sales-ops/service.ts, apps/api/src/domains/sales-ops/routes.ts, apps/api/src/domains/sales-ops/leads/lead-service.ts, apps/api/src/domains/sales-ops/__tests__/ledger-reconcile.test.ts, apps/api/src/domains/sales-ops/__tests__/settlement-locks.test.ts, apps/api/src/domains/sales-ops/__tests__/update-sale-schema.test.ts, apps/api/src/domains/sales-ops/__tests__/service.test.ts, apps/api/src/domains/sales-ops/__tests__/routes.test.ts, apps/api/test/rls/update-sale-in-place.test.ts, apps/api/test/rls/proposal-write.test.ts, CLAUDE.md, nexo/knowledge/reference/propostas.md]
goal: "PUT /sales/:id reconciles items, professionals, receivables and (on won) payables in place by the ids the payload carries, voids or soft-removes what left the plan, refuses with 409 row_has_active_settlement when a settled row would change, and bumps revision only on a real change."
acceptance: ["updateSale issues no DELETE on sales_ops_sale_items, sales_ops_sale_professionals, sales_ops_receivables or sales_ops_payables (source guard plus integration oracle)", "an item, professional and receivable edited with its id keeps that id across PUT /sales/:id", "zeroing the middle of three installments voids exactly that row by id while the others keep their ids and relabel 1/2 and 2/2", "a receivable absent from the new plan is status void and still present in the table; an item or professional absent from the payload keeps its row with removed_at set and disappears from the bootstrap snapshot", "a row id that is not a live row of this sale answers 400 validation_error with reason item_not_found, professional_not_found, installment_not_found or recurring_row_not_found and is never used as an insert id", "a won proposta is editable with status won; its payables are updated in place by (kind, receivableId) and (saleProfessionalId, receivableId), missing ones are inserted and orphaned open ones become void", "PUT refuses lost and cancelled (409 sale_not_editable) and any move into or out of won (409 invalid_status_change)", "when a row with an active baixa (or status paid) would change amount or due date or be voided, PUT answers 409 {error: row_has_active_settlement, rows: [{kind, id, label}]} naming every blocking row and writes nothing", "every UPDATE that changes a receivable or payable column sets revision = revision + 1 and updated_at = now() in the same statement; an identical re-save leaves revision and updated_at unchanged", "the won to open revert and cancel-contract voids also bump revision", "a professional removed from a draft gets no payable when the proposta is won later", "CLAUDE.md and nexo/knowledge/reference/propostas.md state the new editing rules in the same change"]
---

# 04-update-sale-in-place

## Context

Verified in this worktree (`master` at `82a62a3`, before slices 01 to 03 land; line numbers will drift slightly once 01 and 03 merge, so find code by symbol, not by line).

- `updateSale` (`apps/api/src/domains/sales-ops/service.ts:2445-2529`) reads the sale WITHOUT `FOR UPDATE`, refuses `won|lost|cancelled` (`:2458-2460`), then DELETEs every payable, receivable, sale professional and sale item of the sale (`:2466-2479`) and re-inserts the whole `buildSaleLedger` output with fresh uuids (`:2495-2526`).
  So every edit changes every row id, including `sale_professional_id`, and would delete a `paid` row.
- `UpdateSaleSchema` (`service.ts:553-555`) is `SaleWriteBaseSchema.extend({ status: z.enum(['draft','open']) }).superRefine(validatePaymentPlan)`.
  No row carries an id.
  `SaleItemSchema` (`:453-470`) and `SaleProfessionalSchema` (`:477-511`) are `ZodEffects` (object plus `superRefine`), so they cannot be `.extend`ed as they stand.
  `z.object` strips unknown keys, so `CreateSaleSchema` will silently drop any `id` a client sends on create.
- `PUT /sales/:id` status is a real status write today: the wizard sends `draft` (`Salvar rascunho`) or `open` (`apps/web/src/sales-ops/SalesOpsApp.tsx:7674-7678`), and `ledger.sale.status = input.status` is written by the sale UPDATE.
- `buildSaleLedger` (`service.ts:873-1002`) drops zero-amount installments BEFORE labelling (`:884-891`, label `${index+1}/${kept.length}`) and generates recurring rows `M${i+1}/${cycles}` (`:893-904`).
  `ReceivableDraft` (`:859-865`) carries no identity.
  `service.test.ts` asserts `ledger.receivables` with `toEqual` at three places (`__tests__/service.test.ts` around lines 194, 245 and 274).
- `materializeWonPayables` (`service.ts:1065-1268`) is pure and derives drafts per non-void receivable: `seller_commission`, `finder_commission` (only with a finder), `tax` keyed `(kind, receivableId)`; `professional_cost` keyed `(saleProfessionalId, receivableId)` over installment (non-`M`) receivables via `resolveProfessionalSplit`, one-shot with `receivableId: null` and `dueDate = wonDate` when no installment exists; `other_cost` one-shot `(other_cost, null)` with `dueDate = wonDate`.
  Called with `existingPayables: []` it returns the COMPLETE desired payable set, which is what this slice reuses.
- `transitionSale` (`service.ts:2552-2664`) locks the sale `FOR UPDATE`; on `won` it reads ALL `sales_ops_sale_professionals` of the sale (`:2580-2588`); on `won -> open` it sets `status = 'void'` on open payables (`:2638-2649`).
  `cancelContract` (`:2671-2736`) sets `status = 'void'` on receivables (`:2710-2714`) and payables (`:2715-2727`).
  These three are the only other UPDATEs of receivables or payables in `apps/api/src` and `apps/api/scripts`.
- Schema (`apps/api/src/db/schema.ts`): `sales_ops_sale_items` (`:831-849`) and `sales_ops_sale_professionals` (`:851-887`) have NO status column.
  Nothing references `sales_ops_sale_items`.
  `sales_ops_payables` references `sales_ops_sale_professionals` through the composite `sales_ops_payables_org_sale_professional_fk` `ON DELETE RESTRICT` (`:1153-1161`, migration `0018`), so a professional that ever had a payable (void ones included, since a `won -> open` revert leaves void payables behind) cannot be deleted at all.
  `sales_ops_receivables` (`:1114-1129`) and `sales_ops_payables` (`:1131-1164`) have `status open|paid|void`; slice 03 adds `revision` and `updated_at` (C3).
- Readers of items and professionals in the API: `getSalesOpsSnapshot` (`service.ts:2782-2804`, the `/bootstrap` source, which also feeds `summarizeSalesOpsState` `revenueByProduct`) and `transitionSale` won (`:2580-2588`).
  The web reads them only from `/bootstrap`; `deriveWizardPrefill` (`SalesOpsApp.tsx:6182-6191`) already filters `status !== 'void'` receivables.
- `routes.ts:353-374` maps `not_found` to 404, `not_editable` to `409 {error:'sale_not_editable', status}` and `SaleInputError` to `400 {error:'validation_error', reason, itemIndex}`.
  `__tests__/routes.test.ts:759-774` pins the won refusal (`returns 409 when updating a won proposta`).
- `test/rls/proposal-write.test.ts` has `update fully replaces items, professionals, and receivables in one transaction` (`:223-275`, expects the removed professional GONE) and `update is rejected for a won proposta` (`:277-317`); both encode the old behaviour and must be rewritten.
- The API ESLint config (`apps/api/eslint.config.js`) only ignores `_`-prefixed ARGS, so destructuring a field away (`({ sourceId: _s, ...rest })`) fails lint; map fields explicitly instead.
- `leads/lead-service.ts:293` has a comment calling `replaceLeadProducts` "exactly the `replacePersonFuncoes` / `updateSale` shape", which becomes false.

## Design

### Decisions this plan takes (details under `## Decisions for AUDIT`)

- Receivables and payables that leave the plan become `status = 'void'` (C4).
- Items and professionals that leave the payload are SOFT-REMOVED with a new nullable `removed_at timestamptz` column (Contract deviation D1).
  A hard delete is impossible for any professional that ever had a payable (RESTRICT FK), and acceptance 1 says `updateSale` never deletes rows.
- `PUT /sales/:id` status rules: from `draft|open` the body may say `draft` or `open`; from `won` the body must say `won`; `lost|cancelled` stay `409 sale_not_editable`; anything else is `409 invalid_status_change`.
  Winning stays the job of `POST /sales/:id/transition` (payables, and slice 07's admin gate); leaving `won` stays the job of the transition route (slice 06's leave-won lock), so PUT can bypass neither.
- Drafts (H2): exactly the same code path as `open` and `won`, with no status branch except "derive payables only when the sale is `won`".
- On `draft|open` the payable set is NOT touched at all: after a revert every open payable is already void, and a legacy `paid` payable on a non-won sale is left alone.

### New pure module `apps/api/src/domains/sales-ops/ledger-reconcile.ts`

No imports from `db/`, `drizzle-orm` or `service.ts` at runtime (a `import type` from `./service.js` is allowed but not needed).
Every function is pure and deterministic given `newId`.

```ts
export type LedgerRowKind = 'receivable' | 'payable';
export type BlockedLedgerRow = { kind: LedgerRowKind; id: string; label: string };

export type ExistingLineRow = { id: string };               // live items / professionals (removed_at IS NULL)
export type ExistingReceivableRow = {
  id: string; label: string; dueDate: string; amountBrl: number; method: string; status: string;
};
export type ExistingPayableRow = {
  id: string; kind: string; beneficiaryName: string; receivableId: string | null;
  saleProfessionalId: string | null; dueDate: string; amountBrl: number; status: string;
};
export type DesiredReceivable = {
  sourceId: string | null; label: string; dueDate: string; amountBrl: number; method: string;
};
export type DesiredPayable = {
  kind: string; beneficiaryName: string; receivableId: string | null;
  saleProfessionalId: string | null; dueDate: string; amountBrl: number;
};
export type FinalReceivable = { id: string; label: string; dueDate: string; amountBrl: number; status: string };

export type ReceivableWrite = { id: string; label: string; dueDate: string; amountBrl: number; method: string };
export type ReceivableUpdate = ReceivableWrite & { lockRelevant: boolean };
export type PayableWrite = DesiredPayable & { id: string };
export type PayableUpdate = PayableWrite & { lockRelevant: boolean };

export type ReceivablePlan = { inserts: ReceivableWrite[]; updates: ReceivableUpdate[]; voids: string[]; final: FinalReceivable[] };
export type PayablePlan = { inserts: PayableWrite[]; updates: PayableUpdate[]; voids: string[] };
export type LinePlan<T> = {
  inserts: Array<{ id: string; row: T }>;
  updates: Array<{ id: string; row: T }>;
  removes: string[];
  finalIds: string[];                                       // aligned 1:1 with `desired`
};
export const EMPTY_PAYABLE_PLAN: PayablePlan = { inserts: [], updates: [], voids: [] };
```

Functions, in file order:

1. `checkEditableStatusChange(from: string, to: 'draft' | 'open' | 'won'): { ok: true } | { ok: false; reason: 'not_editable' | 'invalid_status_change' }`
   - `from` is `lost` or `cancelled` or anything not in `draft|open|won`: `not_editable`.
   - `from === 'won'` and `to !== 'won'`: `invalid_status_change`.
   - `from` is `draft|open` and `to === 'won'`: `invalid_status_change`.
   - otherwise `{ ok: true }`.
2. `liveRowIds(state: { items: ExistingLineRow[]; professionals: ExistingLineRow[]; receivables: ExistingReceivableRow[] }): { itemIds: Set<string>; professionalIds: Set<string>; receivableIds: Set<string> }`; receivables count as live when `status !== 'void'`.
3. `findUnknownRowId(payload, live): { code: 'item_not_found' | 'professional_not_found' | 'installment_not_found' | 'recurring_row_not_found'; index: number } | null`
   - `payload: { items: Array<{ id?: string }>; professionals: Array<{ id?: string }>; installments: Array<{ id?: string }>; recurring?: { receivableIds?: string[] } | null }`.
   - Checks, in this order, `items[i].id`, `professionals[i].id`, `installments[i].id` (ALL installments, zero-amount ones included), `recurring.receivableIds[i]`; returns the first id not in the matching live set, with its array index.
   - An installment id may name a live `M` row and a recurring id may name a live installment row: identity is the id, never the label.
4. `planLineReconcile<T>(live: readonly ExistingLineRow[], desired: ReadonlyArray<{ sourceId: string | null; row: T }>, newId: () => string): LinePlan<T>`
   - `sourceId` present: `updates.push({ id: sourceId, row })` (unconditional, items and professionals carry no revision), `finalIds[i] = sourceId`.
   - `sourceId` null: `id = newId()`, `inserts.push({ id, row })`, `finalIds[i] = id`.
   - `removes` = live ids not claimed by any `sourceId`, in `live` order.
5. `planReceivableReconcile(existing: readonly ExistingReceivableRow[], desired: readonly DesiredReceivable[], newId): ReceivablePlan`
   - Matching is ONLY `desired.sourceId === existing.id` over existing rows with `status !== 'void'`. The label is never read for matching.
   - Matched and any of `label`, `dueDate`, `amountBrl`, `method` differs: an update carrying the desired values and `lockRelevant = amountBrl changed || dueDate changed`. Matched and identical: nothing.
   - Unmatched desired: insert with `id = newId()`.
   - Live existing rows not claimed: `voids` (in `existing` order).
   - `final`: one entry per desired row in desired order, `status` copied from the matched existing row (so `paid` stays `paid`) or `'open'` for inserts.
6. `payableIdentityKey(row: { kind: string; receivableId: string | null; saleProfessionalId: string | null }): string`
   - `professional_cost`: `professional_cost|${saleProfessionalId ?? ''}|${receivableId ?? ''}`.
   - every other kind: `${kind}|${receivableId ?? ''}`.
7. `planPayableReconcile(existing: readonly ExistingPayableRow[], desired: readonly DesiredPayable[], newId): PayablePlan`
   - Candidates are existing rows with `status !== 'void'`, sorted by `(dueDate asc, id asc)`. Void payables are never matched, revived or updated.
   - Pass 1 (identity): for each desired in order, take the first unclaimed candidate with the same `payableIdentityKey`.
   - Pass 2 (legacy heal, only `professional_cost`): an unmatched desired `professional_cost` takes the first unclaimed candidate with `kind === 'professional_cost'`, `saleProfessionalId === null`, the same `receivableId` and the same `beneficiaryName`; the update writes the desired `saleProfessionalId`.
   - For a matched candidate with `receivableId === null`, the desired `dueDate` is REPLACED by the candidate's stored `dueDate` before comparing (the one-shot date is the original won day and must not move on an edit, see Decisions).
   - Matched and any of `beneficiaryName`, `dueDate`, `amountBrl`, `saleProfessionalId`, `receivableId` differs: update with `lockRelevant = amountBrl changed || dueDate changed`. Identical: nothing.
   - Unmatched desired: insert with `id = newId()`.
   - Unclaimed candidates (including surplus duplicates of one key): `voids`.
8. `findBlockedRows(input: { existingReceivables: readonly ExistingReceivableRow[]; existingPayables: readonly ExistingPayableRow[]; receivables: ReceivablePlan; payables: PayablePlan; activeReceivableIds: ReadonlySet<string>; activePayableIds: ReadonlySet<string> }): BlockedLedgerRow[]`
   - A row is SETTLED when its id is in the active set OR its stored `status === 'paid'`.
   - A settled row is BLOCKED when it is in `voids` or has an update with `lockRelevant`.
   - Receivables first, in `existingReceivables` order, then payables in `existingPayables` order.
   - Receivable label: the stored `label` (pre-edit, e.g. `2/3`).
   - Payable label: `beneficiaryName` plus ` (${receivableLabel})` when `receivableId` names an existing receivable, else `beneficiaryName` alone (e.g. `Ana Martins (2/2)`, `Impostos (1/3)`, `Outros custos`).
9. `planSaleEdit<I, P>(input): SaleEditPlan<I, P>` - the one orchestrator the service calls.
   ```ts
   export type SaleEditState = {
     items: ExistingLineRow[]; professionals: ExistingLineRow[];
     receivables: ExistingReceivableRow[]; payables: ExistingPayableRow[];
   };
   export type SaleEditPlanInput<I, P> = {
     state: SaleEditState;
     desiredItems: ReadonlyArray<{ sourceId: string | null; row: I }>;
     desiredProfessionals: ReadonlyArray<{ sourceId: string | null; row: P }>;
     desiredReceivables: readonly DesiredReceivable[];
     /** null unless the stored sale is `won`. Receives the final non-void receivables sorted by (dueDate asc, plan index asc) and the professional ids aligned with desiredProfessionals. */
     derivePayables: null | ((args: { receivables: FinalReceivable[]; professionalIds: string[] }) => DesiredPayable[]);
     activeReceivableIds: ReadonlySet<string>;
     activePayableIds: ReadonlySet<string>;
     newId: () => string;
   };
   export type SaleEditPlan<I, P> = {
     items: LinePlan<I>; professionals: LinePlan<P>;
     receivables: ReceivablePlan; payables: PayablePlan; blocked: BlockedLedgerRow[];
   };
   ```
   Order: items plan, professionals plan, receivables plan, then `derivePayables` (skipping `final` rows whose status is `void`; there are none by construction) and `planPayableReconcile`, else `EMPTY_PAYABLE_PLAN`, then `findBlockedRows`.
   The due-date sort keeps "parts bind front-aligned to installments in due-date order" identical to `transitionSale`, which orders by `dueDate`.
10. Row labels for the C5 `rows` (the ONE label implementation; slice 06 imports these for `sale_has_active_settlements`, never a copy):
    - `export function receivableRowLabel(row: { label: string }): string` returns the stored label (`2/3`, `M1/12`).
    - `export function payableRowLabel(row: { beneficiaryName: string; receivableId: string | null }, receivableLabelById: ReadonlyMap<string, string>): string` returns `${beneficiaryName} (${receivableLabel})` when `receivableId` names a receivable in the map, else `beneficiaryName` alone.
    - `findBlockedRows` builds its labels only through these two.

### New `apps/api/src/domains/sales-ops/settlement-locks.ts`

Reused by slice 06 for the leave-won and cancel-contract locks.

```ts
export type SaleSettlementRow = {
  id: string; targetKind: 'receivable' | 'payable'; receivableId: string | null; payableId: string | null;
  type: 'baixa' | 'estorno'; reversesSettlementId: string | null; paidOn: string; amountBrl: number;
};
export async function loadSaleSettlementRows(tx: Db, orgId: string, saleId: string): Promise<SaleSettlementRow[]>;
export function activeSettlementTargetIds(
  rows: readonly SaleSettlementRow[],
): { receivableIds: Set<string>; payableIds: Set<string> };
```

- `loadSaleSettlementRows` selects from slice 03's `salesOpsSettlements` `WHERE org_id = orgId AND sale_id = saleId` (both predicates, never RLS alone), ordered by `recorded_at, id`.
- `activeSettlementTargetIds` groups rows by target id (`receivableId ?? payableId`), maps each group with slice 02's `eventoDeSettlement` and adds the target to the set of its kind when `temBaixaAtiva(group.map(eventoDeSettlement))` is true (both imported from `@fxl-sales/shared-utils/liquidacao`, the subpath, never the root).
  No adapter and no field renaming: slice 02's exported names ARE the contract (C2 as resolved in `00-OVERVIEW.md`), and the lock does not need the row amount.
  If the Drizzle `date` column comes back as a `Date` rather than a string, normalize `paidOn` with `.toISOString().slice(0, 10)` inside `loadSaleSettlementRows` (it is a stored civil day, C1), never in the reducer.
- A reducer throw (malformed fact history) propagates and answers 500: a corrupt history must never read as "unlocked".

### New `apps/api/src/domains/sales-ops/ledger-revision.ts`

```ts
import { sql } from 'drizzle-orm';
import { salesOpsPayables, salesOpsReceivables } from '../../db/schema.js';
/** C7: spread into every .set() that changes a receivable. Same statement, never a second UPDATE. */
export function receivableRevisionBump() {
  return { revision: sql<number>`${salesOpsReceivables.revision} + 1`, updatedAt: sql<Date>`now()` };
}
export function payableRevisionBump() {
  return { revision: sql<number>`${salesOpsPayables.revision} + 1`, updatedAt: sql<Date>`now()` };
}
```

### New `apps/api/src/domains/sales-ops/ledger-dates.ts`

Move `asDateOnly` and `dateFromIsoDay` out of `service.ts:600-607` verbatim, `export` them, and import them back into `service.ts`.
If slice 01 already moved them into an importable module, import from there and do not create this file.

### New `apps/api/src/domains/sales-ops/sale-edit-writes.ts`

The DB half of the edit, so `service.ts` only wires.

- `loadSaleEditState(tx: Db, orgId: string, saleId: string): Promise<SaleEditState & { settlements: SaleSettlementRow[] }>`
  - items: `select({ id })` from `salesOpsSaleItems` `WHERE org_id AND sale_id AND removed_at IS NULL`.
  - professionals: same on `salesOpsSaleProfessionals`.
  - receivables: all rows of the sale (void included), `orderBy(asc(dueDate), asc(id))`, `dueDate` through `asDateOnly`.
  - payables: all rows of the sale, `orderBy(asc(dueDate), asc(id))`, `dueDate` through `asDateOnly`.
  - settlements: `loadSaleSettlementRows`.
- `applySaleEditPlan(tx: Db, orgId: string, saleId: string, plan: SaleEditPlan<SaleLedger['items'][number], SaleLedger['professionals'][number]>, now: Date): Promise<void>`, in this order (FKs need professionals before payables and receivables before payables):
  1. Items: each update `tx.update(salesOpsSaleItems).set({ productId: row.productId ?? null, productNameSnapshot, productTypeSnapshot, areaId, areaNameSnapshot, quantity, unitBrl, subtotalBrl }).where(and(eq(orgId), eq(saleId), eq(id)))`; inserts in one `insert(...).values([...])` with the explicit `id`, `orgId`, `saleId`; removes `set({ removedAt: now })` `WHERE org_id AND sale_id AND id IN (...) AND removed_at IS NULL`.
  2. Professionals: same shape with `{ personId: row.personId ?? null, personNameSnapshot, funcaoId, funcaoNameSnapshot, role, costBrl, costSplitBp }`.
  3. Receivables: inserts with explicit `id`, `status: 'open'`, `dueDate: dateFromIsoDay(...)`; each update `set({ label, dueDate: dateFromIsoDay(dueDate), amountBrl, method, ...receivableRevisionBump() })`; voids `set({ status: 'void', ...receivableRevisionBump() })` `WHERE org_id AND sale_id AND id IN (...) AND status <> 'void'`.
  4. Payables: inserts with explicit `id`, `status: 'open'`; each update `set({ beneficiaryName, kind, receivableId, saleProfessionalId, dueDate: dateFromIsoDay(dueDate), amountBrl, ...payableRevisionBump() })`; voids as for receivables with `payableRevisionBump()`.
  - Every WHERE carries `eq(table.orgId, orgId)` and `eq(table.saleId, saleId)`.
  - No `tx.delete(` anywhere in this file.

### `service.ts` changes (wiring only, kept small)

- Imports: `randomUUID` from `node:crypto`; `isNull` from `drizzle-orm`; `saoPauloDayOf` from `@fxl-sales/shared-utils/sao-paulo-day` (already imported by slice 01; the subpath, never the root); the new modules.
- Export `type Db` from `service.ts` (`export type Db = ReturnType<typeof getDb>;`, a one-word change) so `settlement-locks.ts` and `sale-edit-writes.ts` can type `tx`.
- Schemas:
  - Split `SaleItemSchema` into `SaleItemFieldsSchema` (the `z.object`) plus `function refineSaleItem(item, ctx)` (the existing body); `export const SaleItemSchema = SaleItemFieldsSchema.superRefine(refineSaleItem)`; `export const UpdateSaleItemSchema = SaleItemFieldsSchema.extend({ id: uuid.optional() }).superRefine(refineSaleItem)`.
  - Same split for `SaleProfessionalSchema` (`SaleProfessionalFieldsSchema`, `refineSaleProfessional`, `UpdateSaleProfessionalSchema` with `id: uuid.optional()`).
  - `export const UpdateSaleInstallmentSchema = SaleInstallmentSchema.extend({ id: uuid.optional() })`.
  - `export const UpdateSaleRecurringSchema = SaleRecurringSchema.extend({ receivableIds: z.array(uuid).max(120).optional() })`; `receivableIds[i]` is the id of the row for cycle `i + 1`.
  - `function validateRowIds(data, ctx)`: issue `duplicate_row_id` at `['items', i, 'id']` when an item id repeats; same for `professionals`; one shared set over `installments[].id` and `recurring.receivableIds[]` (path `['installments', i, 'id']` or `['recurring', 'receivableIds', i]`); issue `recurring_ids_exceed_cycles` at `['recurring', 'receivableIds']` when `receivableIds.length > (recurring.cycles ?? 0)`.
  - ```ts
    export const UpdateSaleSchema = SaleWriteBaseSchema.extend({
      status: z.enum(['draft', 'open', 'won']),
      items: z.array(UpdateSaleItemSchema).min(1),
      professionals: z.array(UpdateSaleProfessionalSchema).default([]),
      installments: z.array(UpdateSaleInstallmentSchema).min(1).max(120),
      recurring: UpdateSaleRecurringSchema.nullish(),
    })
      .superRefine(validatePaymentPlan)
      .superRefine(validateRowIds);
    ```
    `CreateSaleSchema` is unchanged, so a create body's ids are stripped.
- `SaleInputError.code` union gains `'item_not_found' | 'professional_not_found' | 'installment_not_found' | 'recurring_row_not_found'` (itemIndex = the index in the respective array); the route's existing `SaleInputError` mapping already answers `400 {error:'validation_error', reason, itemIndex}`.
- `ReceivableDraft` gains `sourceId: string | null`; `buildSaleLedger`'s parameter type becomes `UpdateSaleInput` (a superset that `CreateSaleInput` is assignable to); installments set `sourceId: row.id ?? null` (carried through the zero-amount filter), recurring cycle `i` sets `sourceId: recurring.receivableIds?.[i] ?? null`.
- `createSale` receivable insert maps fields explicitly (`label, dueDate: dateFromIsoDay(...), amountBrl, method, status, orgId, saleId`) so `sourceId` never reaches the insert.
- `UpdateSaleResult` becomes:
  ```ts
  export type UpdateSaleResult =
    | { ok: true; sale: typeof salesOpsSales.$inferSelect; ledger: SaleLedger }
    | { ok: false; reason: 'not_found' }
    | { ok: false; reason: 'not_editable'; status: string }
    | { ok: false; reason: 'invalid_status_change'; from: string; to: string }
    | { ok: false; reason: 'row_has_active_settlement'; rows: BlockedLedgerRow[] };
  ```
- `updateSale(db, orgId, saleId, input, now: Date = new Date())` body:
  ```ts
  const [existing] = await tx.select().from(salesOpsSales)
    .where(and(eq(salesOpsSales.orgId, orgId), eq(salesOpsSales.id, saleId)))
    .for('update').limit(1);
  if (!existing) return { ok: false, reason: 'not_found' };
  const gate = checkEditableStatusChange(existing.status, input.status);
  if (!gate.ok && gate.reason === 'not_editable') return { ok: false, reason: 'not_editable', status: existing.status };
  if (!gate.ok) return { ok: false, reason: 'invalid_status_change', from: existing.status, to: input.status };

  const itemContexts = await resolveSaleItemContexts(tx, orgId, input.items);
  const parties = await resolvePartyContexts(tx, orgId, input);
  const ledger = buildSaleLedger(input, itemContexts, parties);

  const state = await loadSaleEditState(tx, orgId, saleId);
  const unknown = findUnknownRowId(input, liveRowIds(state));
  if (unknown) throw new SaleInputError(unknown.code, unknown.index);
  const active = activeSettlementTargetIds(state.settlements);
  const wonDate = saoPauloDayOf(existing.wonAt ?? now);

  const plan = planSaleEdit({
    state,
    desiredItems: ledger.items.map((row, i) => ({ sourceId: input.items[i]?.id ?? null, row })),
    desiredProfessionals: ledger.professionals.map((row, i) => ({ sourceId: input.professionals[i]?.id ?? null, row })),
    desiredReceivables: ledger.receivables,
    derivePayables: existing.status === 'won'
      ? ({ receivables, professionalIds }) => materializeWonPayables({
          sale: {
            sellerName: ledger.sale.sellerNameSnapshot,
            finderName: ledger.sale.finderNameSnapshot,
            hasFinder: input.finderPersonId != null,
            sellerCommissionPct: input.sellerCommissionPct,
            finderCommissionPct: input.finderCommissionPct,
            taxPct: input.taxPct,
            otherCostsBrl: input.otherCostsBrl,
          },
          professionals: ledger.professionals.map((p, i) => ({
            id: professionalIds[i]!, personName: p.personNameSnapshot, costBrl: p.costBrl, costSplitBp: p.costSplitBp,
          })),
          receivables,
          wonDate,
        })
      : null,
    activeReceivableIds: active.receivableIds,
    activePayableIds: active.payableIds,
    newId: randomUUID,
  });
  if (plan.blocked.length > 0) return { ok: false, reason: 'row_has_active_settlement', rows: plan.blocked };

  const [sale] = await tx.update(salesOpsSales).set({ /* exactly today's set, with updatedAt: now */ })
    .where(and(eq(salesOpsSales.orgId, orgId), eq(salesOpsSales.id, saleId))).returning();
  if (!sale) throw new Error('sale_update_failed');
  await applySaleEditPlan(tx, orgId, saleId, plan, now);
  return { ok: true, sale, ledger };
  ```
  The lock check runs before the first write, so a 409 changes nothing (no sale UPDATE either).
- `transitionSale` and `cancelContract` keep slice 01's trailing optional `now: Date = new Date()` parameter and its `saoPauloDayOf(now)` / `todayInSaoPaulo(now)` uses; this slice only adds the edits below.
- `transitionSale` won: the professionals select adds `isNull(salesOpsSaleProfessionals.removedAt)`; the `won -> open` void `.set({ status: 'void', ...payableRevisionBump() })`.
- `cancelContract`: both void `.set(...)` calls spread the matching bump (C7).
- `getSalesOpsSnapshot`: `saleItems` and `saleProfessionals` selects add `isNull(<table>.removedAt)`.

### `routes.ts`

In `salesOpsRouter.put('/sales/:id', ...)` after the `not_found` branch:
```ts
if (!result.ok && result.reason === 'not_editable') return c.json({ error: 'sale_not_editable', status: result.status }, 409);
if (!result.ok && result.reason === 'invalid_status_change') return c.json({ error: 'invalid_status_change', from: result.from, to: result.to }, 409);
if (!result.ok) return c.json({ error: 'row_has_active_settlement', rows: result.rows }, 409);
```
Nothing else in `routes.ts` changes (the admin gate is slice 07).

### Schema precondition (D1, resolved by plan-check)

Slice 03 ships `sales_ops_sale_items.removed_at` and `sales_ops_sale_professionals.removed_at` (`timestamptz NULL`, no default) in migration `0024`, plus `removedAt` on both Drizzle tables.
This slice adds NO migration, NO journal entry and NO `schema.ts` edit; it owns every reader (`removed_at IS NULL` filters) and writer (soft removal) of the column.
If step 0 finds the column missing, that is a slice 03 defect: stop and report it, never add a `0025`.

## Steps

Each step names the failing test first.

0. Precondition check (no test): confirm `salesOpsSettlements`, `salesOpsReceivables.revision`, `salesOpsReceivables.updatedAt`, `salesOpsPayables.revision`, `salesOpsPayables.updatedAt` exist in `apps/api/src/db/schema.ts`, `reduzirLiquidacao` is exported from `packages/shared-utils/src/index.ts`, and `saoPauloDayOf` is exported from the root index.
   Confirm `removedAt` exists on `salesOpsSaleItems` and `salesOpsSaleProfessionals` (slice 03), `eventoDeSettlement` and `temBaixaAtiva` are exported from `@fxl-sales/shared-utils/liquidacao` (slice 02), and `deleteSettlementsForOrgs` exists in `apps/api/src/db/__tests__/settlement-test-cleanup.ts` (slice 03).
   The settlement column names are slice 03's (`targetKind`, `receivableId`, `payableId`, `type`, `reversesSettlementId`, `paidOn`, `amountBrl`, `saleId`, `orgId`).
1. RED `apps/api/src/domains/sales-ops/__tests__/ledger-reconcile.test.ts` (unit, pure, fixed `newId` counter `id-new-1`, `id-new-2`, ...):
   - `checkEditableStatusChange refuses lost and cancelled and any move into or out of won`
   - `findUnknownRowId reports the first foreign or void id with its array index`
   - `planLineReconcile updates claimed rows, inserts rows without id and removes unclaimed ones`
   - `planReceivableReconcile keeps the id of a receivable whose label renumbers when a middle installment is zeroed`
   - `planReceivableReconcile voids a live receivable whose id is absent and never matches by label`
   - `planReceivableReconcile emits no update for an identical row`
   - `planReceivableReconcile marks amount and due-date changes lock-relevant but not method or label changes`
   - `planReceivableReconcile keeps paid status on a matched row in final`
   - `planPayableReconcile matches by (kind, receivableId) and (saleProfessionalId, receivableId), never by beneficiary name`
   - `planPayableReconcile voids an open payable whose receivable left the plan and never revives a void payable`
   - `planPayableReconcile keeps the stored due date of a null-receivable payable`
   - `planPayableReconcile heals a legacy null saleProfessionalId payable by receivable and beneficiary`
   - `planPayableReconcile voids the surplus duplicate of one identity key`
   - `findBlockedRows names every blocking row with kind, id and label`
   - `payableRowLabel names the beneficiary and the linked parcela, or the beneficiary alone`
   - `findBlockedRows lets a method-only change through on a settled row`
   - `findBlockedRows treats a paid status row as settled even without facts`
   - `planSaleEdit derives payables only when derivePayables is given and feeds it receivables in due-date order`
   GREEN: write `ledger-reconcile.ts`.
2. RED `apps/api/src/domains/sales-ops/__tests__/settlement-locks.test.ts` (unit, pure half only):
   - `an active baixa locks its receivable` (facts built with slice 02's `eventoDeSettlement` shape)
   - `a reversed baixa does not lock`
   - `an active baixa on a payable locks only that payable`
   GREEN: write `settlement-locks.ts`.
3. RED `apps/api/src/domains/sales-ops/__tests__/update-sale-schema.test.ts`:
   - `UpdateSaleSchema accepts row ids on items, professionals, installments and recurring`
   - `UpdateSaleSchema refuses a duplicate row id`
   - `UpdateSaleSchema refuses more recurring ids than cycles`
   - `UpdateSaleSchema accepts status won`
   - `CreateSaleSchema strips row ids`
   - `buildSaleLedger carries installment and recurring ids through the zero-amount filter as sourceId`
   - `updateSale and sale-edit-writes never delete a ledger row` (source guard: `readFileSync` of `service.ts` and `sale-edit-writes.ts` via `new URL('../<file>', import.meta.url)`; slice the `updateSale` body from `export async function updateSale(` to `export type SaleStatus`; first `expect(body.length).toBeGreaterThan(500)` and `expect(body).toContain('applySaleEditPlan')` so a missing or mis-sliced file cannot pass vacuously; then `expect(body).not.toMatch(/\.delete\(/)` and the same on the whole `sale-edit-writes.ts`, which must also `toContain('receivableRevisionBump')`)
   GREEN: schema split, `validateRowIds`, `ReceivableDraft.sourceId`, `buildSaleLedger`; add `sourceId: null` to the three `ledger.receivables` `toEqual` expectations in `__tests__/service.test.ts`.
4. Write `ledger-revision.ts`, `ledger-dates.ts` (move), `sale-edit-writes.ts`.
5. RED `apps/api/test/rls/update-sale-in-place.test.ts` (integration; same harness as `test/rls/proposal-write.test.ts`: `postgres(TEST_DATABASE_URL)` app client through `drizzle(appClient, { schema })`, admin client with `app.fxl_admin`, unique `org_upd_*_${Date.now()}` org ids, fixtures through `createArea` / `createProduct` / `createSale`):
   - `keeps item, professional and receivable ids across an edit` (draft with one item, one professional, two installments; PUT with all ids and changed amounts plus one new item without id; assert the three original ids are still present with the new values, the new item has a fresh id, and one extra item row exists)
   - `voids exactly the zeroed middle installment, matched by id not label` (installments A, B, C of 100000 each; PUT A 150000, B 0 with its id, C 150000; assert A is `1/2` and C is `2/2` with their original ids, B is `void`, keeps label `2/3` and amount 100000, and 3 rows exist)
   - `a receivable removed from the plan is void and still in the database`
   - `a professional removed from the payload keeps its row with removed_at and leaves the bootstrap snapshot`
   - `bumps revision and updated_at only on a real change` (re-save identical payload with ids: every receivable still `revision = 1` and same `updated_at`; then change only installment 2's method: installment 2 `revision = 2` and later `updated_at`, installment 1 untouched)
   - `reconciles payables of a won proposta in place` (won via `createSale` status `won`: items 300000, installments 100000 and 200000, seller 10%, tax 6%, professional `Julia Prado` cost 60000, `otherCostsBrl` 5000; PUT status `won` with ids and installments 150000 and 150000; assert the same 7 payable ids, seller 15000 and 15000, tax 9000 and 9000, professional 30000 and 30000, each of those `revision = 2`, `other_cost` still 5000 with `revision = 1`, and no new payable row)
   - `voids the open payables of a professional removed from a won proposta`
   - `refuses with row_has_active_settlement naming the blocking row and changes nothing` (won sale as above; seed one `baixa` on receivable 1 by admin SQL; PUT that also renames the client and moves the amounts; expect `{ ok: false, reason: 'row_has_active_settlement', rows: [{ kind: 'receivable', id: r1, label: '1/2' }] }` exactly; assert client name, every receivable and payable amount and revision, and the row counts are unchanged)
   - `names a settled payable whose amount would change` (seed a baixa on receivable 2's `seller_commission`; PUT with `sellerCommissionPct: 12`; expect exactly `[{ kind: 'payable', id, label: 'Ana Martins (2/2)' }]`)
   - `lets a method-only change through on a settled receivable`
   - `refuses to move a proposta into or out of won through PUT` (`invalid_status_change` both ways)
   - `rejects a row id from another sale` (`rejects.toMatchObject({ code: 'item_not_found', itemIndex: 0 })`, no write)
   - `a professional removed from a draft gets no payable when the proposta is won later` (`transitionSale` to `won`)
   - `the won to open revert bumps the revision of each voided payable`
   - `a counterparty change bumps the revision of the affected payables` (won sale as above; PUT with the same amounts but a different seller pessoa: every `seller_commission` payable keeps its id, carries the new `beneficiary_name` and `revision = 2`; the `tax` and `other_cost` payables stay at `revision = 1`; acceptance 8's counterparty clause)
   - Settlement seed SQL (admin client, RLS bypassed): `INSERT INTO sales_ops_settlements (id, org_id, sale_id, target_kind, receivable_id, payable_id, type, reverses_settlement_id, paid_on, amount_brl, origin, actor_user_id, actor_name) VALUES (${randomUUID()}, ${orgId}, ${saleId}, 'receivable', ${r1}, NULL, 'baixa', NULL, '2026-08-01', ${amount}, 'manual', 'test', 'Teste')`; the row's own `status` stays `open`, so only the reducer path can block.
   - Cleanup in `afterAll`: `await deleteSettlementsForOrgs(orgIds)` FIRST (slice 03's helper in `apps/api/src/db/__tests__/settlement-test-cleanup.ts`; the immutability trigger refuses DELETE and the RESTRICT FKs block the ledger deletes otherwise), then payables, receivables, items, professionals, sales, products, areas as in `proposal-write.test.ts`.
   GREEN: rewrite `updateSale`, add the `transitionSale` / `cancelContract` / `getSalesOpsSnapshot` edits.
6. Rewrite the two stale tests in `apps/api/test/rls/proposal-write.test.ts`:
   - `update fully replaces items, professionals, and receivables in one transaction` becomes `update edits items and receivables in place and soft-removes a dropped professional` (the same fixture; the update payload carries the item id and no installment id, so assert the item id is unchanged, the professional row still exists with `removed_at IS NOT NULL`, the old receivable is `void` and a new `1/1` row with `method = 'boleto'` exists).
   - `update is rejected for a won proposta` becomes `update refuses to move a won proposta out of won` expecting `{ ok: false, reason: 'invalid_status_change', from: 'won', to: 'open' }` and the unchanged item count.
7. RED `apps/api/src/domains/sales-ops/__tests__/routes.test.ts`:
   - rename `returns 409 when updating a won proposta` to `returns 409 when updating a lost proposta` (mock `status: 'lost'`, expect `{ error: 'sale_not_editable', status: 'lost' }`)
   - `maps invalid_status_change to 409 with from and to`
   - `maps row_has_active_settlement to 409 with the blocking rows`
   - `accepts a won status and row ids in the PUT body` (asserts `updateSale` was called with `status: 'won'` and the ids)
   GREEN: the three route branches.
8. REFACTOR: fix the `leads/lead-service.ts:293` comment to `/** Full-set replacement, exactly the \`replacePersonFuncoes\` shape. */`; confirm `grep -n "tx.delete(" apps/api/src/domains/sales-ops/sale-edit-writes.ts` is empty and the `updateSale` body contains no `.delete(`.
9. Docs (below), then `pnpm --filter @fxl-sales/api run lint`, `pnpm --filter @fxl-sales/api run type-check`, `pnpm --filter @fxl-sales/api test`, and the integration oracles.

## Oracle tests

Unit (no DB):
```bash
pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/__tests__/ledger-reconcile.test.ts src/domains/sales-ops/__tests__/settlement-locks.test.ts src/domains/sales-ops/__tests__/update-sale-schema.test.ts src/domains/sales-ops/__tests__/service.test.ts src/domains/sales-ops/__tests__/routes.test.ts
```
Integration (local Docker test DB only; the suite's global setup migrates it, never run `db:migrate` by hand):
```bash
pnpm --filter @fxl-sales/api test:integration test/rls/update-sale-in-place.test.ts test/rls/proposal-write.test.ts src/domains/sales-ops/__tests__/sale-transitions.integration.test.ts
```

Non-vacuity, one mutation per rule (each must turn a named test red):
- Match receivables by `label` instead of `sourceId` in `planReceivableReconcile`: `planReceivableReconcile keeps the id ... zeroed` and the integration `voids exactly the zeroed middle installment` fail (B's id would carry `2/2`).
- Restore the old DELETE + re-insert body of `updateSale`: `keeps item, professional and receivable ids across an edit` and the source guard `updateSale and sale-edit-writes never delete a ledger row` fail.
- Drop the `status !== 'void'` candidate filter in `planPayableReconcile`: `never revives a void payable` fails.
- Remove `lockRelevant` from the void branch of `findBlockedRows` (only updates block): `refuses with row_has_active_settlement` still passes but `findBlockedRows names every blocking row` fails; remove the active-set check entirely and the integration 409 test fails because the seeded row's status is `open`.
- Move the lock check after `applySaleEditPlan`: the integration 409 test's "changes nothing" assertions fail (withTenant does not roll back on a returned result).
- Always spread the revision bump (update every matched row): `bumps revision and updated_at only on a real change` and `emits no update for an identical row` fail.
- Drop the bump from `cancelContract` or the revert: `the won to open revert bumps the revision` fails (cancel is covered by the unit review plus slice 06's oracles).
- Recompute the one-shot `dueDate` from `wonDate`: `keeps the stored due date of a null-receivable payable` fails.
- Remove `isNull(removedAt)` from `transitionSale`: `a professional removed from a draft gets no payable when the proposta is won later` fails.
- Allow `to === 'won'` from `open` in `checkEditableStatusChange`: the unit and integration status tests fail.
- The `refuses with row_has_active_settlement` oracle asserts `rows` with `toEqual` on the exact array, so an implementation that names only the first blocker, or adds non-blocking rows, fails.

## Docs

`CLAUDE.md`, section `## Propostas domain`, block `Statuses and payables:`:
- Replace the first bullet with:
  `- Statuses \`draft|open|won|lost|cancelled\` (Rascunho, Aberta, Ganha, Perdida, Cancelada). Transitions only via \`POST /sales/:id/transition\` and \`POST /sales/:id/cancel-contract\`; \`PUT /sales/:id\` may only move between \`draft\` and \`open\` and keeps a \`won\` proposta \`won\` (\`409 invalid_status_change\`).`
- Replace the labels bullet with:
  `- Receivable labels \`N/M\` and \`MN/M\` are load-bearing (\`deriveWizardPrefill\` parses the \`M\`) but are NEVER row identity: they renumber when a parcela is zeroed.`
- Leave the `Leaving \`won\`` bullet to slice 06.
- Add a new block after `Statuses and payables:`:
  ```
  Editing a proposta (PC2):
  - `updateSale` never deletes and recreates. Rows are reconciled by the ids the payload carries (`items[].id`, `professionals[].id`, `installments[].id`, `recurring.receivableIds[i]` for cycle i+1); a row without an id is new and gets a server uuid.
  - An id that is not a live row of this sale answers `400` (`item_not_found`, `professional_not_found`, `installment_not_found`, `recurring_row_not_found`) and is never used as an insert id.
  - A receivable or payable that left the plan becomes `void` and stays. An item or professional that left gets `removed_at`; every reader filters `removed_at IS NULL`.
  - `draft`, `open` and `won` share one path. On `won` payables are reconciled in place by `payableIdentityKey`, never by beneficiary name; a one-shot payable keeps its stored due date.
  - A settled row (active baixa or `status = 'paid'`) whose amount or due date would change, or that would be voided, fails the whole edit with `409 row_has_active_settlement` naming every blocking row; nothing is written.
  - The reconcile is the pure `planSaleEdit` in `apps/api/src/domains/sales-ops/ledger-reconcile.ts`; `service.ts` only wires it and `sale-edit-writes.ts` holds the writes.
  - Every UPDATE that changes a receivable or payable column spreads `receivableRevisionBump()` / `payableRevisionBump()` from `ledger-revision.ts`; an unchanged row gets no UPDATE.
  ```

`nexo/knowledge/reference/propostas.md`:
- Add this as a new indented second line of the `Receivable label conventions` bullet: `The labels are display only and never identity: \`buildSaleLedger\` drops zero-amount installments before numbering, so zeroing one renumbers every later row.`
- Append a section `## Editing in place (PC2, 2026-09-24)` with these lines (one sentence per line):
  - `Until v4.1.0 \`updateSale\` deleted every item, professional, receivable and payable of the proposta and re-inserted them with new uuids, which broke \`sale_professional_id\` on every edit and would have deleted a paid row.`
  - `The owner decided (audit section 10, PC2) that an edit alters the existing rows, because the Finance mirror keys each obligation by the Sales row id.`
  - `The wizard sends the id of every row it edits; the recurring block sends \`receivableIds\`, where index i is cycle i+1, and never more ids than cycles.`
  - `Identity is the id alone: a zeroed installment carries its id, falls out of the plan, and becomes \`void\`, while the surviving rows keep their ids and relabel.`
  - `Items and professionals have no status, so a removed one gets \`removed_at\` instead of a delete; a hard delete was impossible anyway, because the RESTRICT FK from \`sales_ops_payables\` pins every professional that ever had a payable.`
  - `Drafts take the same path as \`open\` and \`won\` (decision H2): a draft can be won directly, so its ids must already be stable, and void rows carry no money in any summary.`
  - `A won proposta is editable (decision H1); its payables are recomputed with \`materializeWonPayables\` over the final receivables and matched to the stored ones by \`(kind, receivableId)\` or \`(saleProfessionalId, receivableId)\`, with a legacy heal by receivable and beneficiary for pre-0018 rows.`
  - `A one-shot payable (\`other_cost\`, the professional fallback) keeps its stored due date, because recomputing it from the won day in São Paulo would move rows written with the old UTC day.`
  - `The row lock reads the settlement facts through the shared reducer (\`activeSettlementTargetIds\` in \`settlement-locks.ts\`) and also treats \`status = 'paid'\` as settled, so an inconsistent cache fails closed.`
  - `The lock is evaluated on the full plan before the first write and names every blocking row, receivables first; a payable's label is its beneficiary plus the receivable label in parentheses.`
  - `\`revision\` moves only when the row really changes, including method and label changes, because the integration publishes those fields too.`
  - `Oracles: \`apps/api/src/domains/sales-ops/__tests__/ledger-reconcile.test.ts\` and \`apps/api/test/rls/update-sale-in-place.test.ts\`.`

## Security notes

- Every row id in the body is checked against the live rows of THIS sale, loaded inside `withTenant` with explicit `org_id` and `sale_id` predicates, so another org's or another sale's id is `400`, never a write (C4, tenancy rule "never trust ids from bodies").
- New rows always get a server-generated uuid; an unknown client id is refused, never adopted as an insert id.
- The sale row is locked `FOR UPDATE` for the whole edit; slice 06's settlement writes lock the same sale row first (`FOR SHARE`, which conflicts with this `FOR UPDATE`, D6) so a baixa cannot land between the lock check and the writes.
- The 409 body names only row ids and labels of the caller's own sale; no actor or settlement data leaks.
- The admin-only gate on `PUT /sales/:id` is slice 07 (H4); this slice does not widen who can call the route, only which statuses it accepts.

## Contract deviations

- D1 (C3/C4, RESOLVED by plan-check): items and professionals need a `removed_at timestamptz NULL` column each, because they have no status and the RESTRICT FK from `sales_ops_payables` makes deleting a professional impossible once it had any payable. Slice 03 adds both columns (and the Drizzle fields) to `0024`; this slice has no migration.
- D2 (C4, RESOLVED and confirmed identical in slice 05): the recurring block carries identity as `recurring.receivableIds: uuid[]`, index i = the live row of cycle i+1, length at most `cycles` (0 for indefinite). Slice 05 sends the live `M` rows' ids sorted by due date and only the first `cycles` of them; every live `M` row not listed becomes `void`.
- D3 (clarification for slices 05 and 06): editing a won proposta sends `status: 'won'`; PUT cannot move into or out of `won` (`409 invalid_status_change`). The wizard must also stop refusing `won` in `submit`.
- D4 (C7 clarification): the bump fires on ANY column change the reconcile writes (receivable `label` and `method`, payable `sale_professional_id` heal included), a superset of C7's list; a no-op still bumps nothing.
- D5 (C5, RESOLVED as the contract label): a receivable's `label` in `rows` is its stored label; a payable's is `beneficiaryName` plus ` (receivableLabel)` when linked, built only by `receivableRowLabel` / `payableRowLabel`, which slice 06 reuses.
- D6 (C6 addition, RESOLVED): every ledger writer locks the parent `sales_ops_sales` row before any ledger row. `updateSale`, `transitionSale` and `cancelContract` take it `FOR UPDATE`; slice 06's settlement writes take it `FOR SHARE` (which conflicts with `FOR UPDATE`, so a baixa cannot land between this slice's lock check and its writes) and then lock the target row `FOR UPDATE`.
- D7: this slice already adds the revision bump to the `won -> open` payable void and both `cancelContract` voids; slice 06 must not add a second bump there and reuses `loadSaleSettlementRows`, `activeSettlementTargetIds`, `receivableRowLabel` and `payableRowLabel` for its locks.

## Decisions for AUDIT

- Items and professionals that leave the payload are soft-removed (`removed_at`), not voided and not deleted.
- `PUT /sales/:id` never wins and never leaves `won`; `draft <-> open` through PUT stays as today.
- On `draft|open` the payable set is not touched by an edit; legacy `paid` payables there stay as they are.
- A void receivable or payable is never revived by an edit; its id in a payload is `installment_not_found` / not matched.
- One-shot payables (`receivableId` null) keep their stored due date on an edit; a newly created one uses the São Paulo day of `won_at`.
- The lock treats `status = 'paid'` as settled even without an active baixa (fail closed).
- Pre-0018 `professional_cost` rows with a null `sale_professional_id` are healed in place by `(receivable_id, beneficiary_name)` instead of being voided and recreated.
- An archived produto, área, pessoa or função referenced only by a removed item or professional stays unpurgeable by `runArchivedCadastroPurge` (it still relies on `23503`); history wins over cleanup.

## Out of scope

- Web wizard ids, won editing UI and the blocked-row message (slice 05).
- Settlement routes, the reducer-backed `paid` cache, the leave-won lock and the cancel-contract lock, and the stale `Leaving won` doc bullet (slice 06); the stale comment in `apps/web/src/sales-ops/hooks.ts` `useCancelSalesOpsContract` (slice 08).
- The admin gate (slice 07).
- Editing a won proposta after `cancel-contract`: the server keeps any row the payload names and inserts rows without ids, so slice 05's prefill must not regenerate cancelled cycles.
- Any integration code (outbox, events, external ids).
