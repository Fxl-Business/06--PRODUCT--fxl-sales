---
id: 05-wizard-row-ids
milestone: v4.1.0
status: done
depends_on: [04-update-sale-in-place]
files_modified: [apps/web/src/sales-ops/row-identity.ts, apps/web/src/sales-ops/sale-save-error.ts, apps/web/src/sales-ops/types.ts, apps/web/src/sales-ops/calculations.ts, apps/web/src/sales-ops/SalesOpsApp.tsx, apps/web/src/lib/api-client.ts, apps/web/src/lib/__tests__/api-client-token-guard.test.ts, apps/web/src/sales-ops/__tests__/row-identity.test.ts, apps/web/src/sales-ops/__tests__/sale-save-error.test.ts, apps/web/src/sales-ops/__tests__/sale-wizard-row-ids.test.tsx, apps/web/src/sales-ops/__tests__/sale-wizard-save-error.test.tsx, apps/web/src/sales-ops/__tests__/sale-wizard-edit.test.tsx, apps/web/src/sales-ops/__tests__/sales-transition-actions.test.tsx, CLAUDE.md, nexo/knowledge/reference/propostas.md]
goal: "The proposta wizard carries the persisted id of every item, professional, installment and recurring row it loaded through every edit and sends it back on PUT, opens a won proposta for edit, and names the blocking row of a 409 row_has_active_settlement inside the still-open wizard."
acceptance: ["An untouched edit of a loaded proposta sends back the stored id of every item, professional and installment row, plus the stored recurring receivable ids in cycle order.", "A hand edit of a parcela amount or date keeps that row's id.", "A plan regeneration (live, or through Aplicar) keeps ids positionally by row index; rows beyond the old length carry no id; surplus old ids are omitted from the payload.", "Manter parcelas keeps every row and every id verbatim.", "A zero-amount installment row keeps its id through carryRowIdsPositionally and buildSalePayload (neither filters by amount).", "Brand-new items, professionals and parcelas send no id; the create path sends no id at all.", "Matching never reads the N/M label: no function added in this slice reads `label` except the pre-existing M-prefix split in deriveWizardPrefill.", "A won proposta shows Editar in the vendas list, opens the wizard, hides Salvar rascunho and saves with status won; lost and cancelled stay non-editable.", "A 409 row_has_active_settlement renders a pt-BR alert inside the open wizard naming each blocking row by its label, e.g. 'A parcela 2/6 tem baixa ativa.' followed by 'Estorne a baixa antes de mudar valor ou vencimento.'; the wizard stays open and the operator's edits survive.", "apiFetch keeps the C5 rows array of an error body as ApiError.rows (and no other extra body field) so the 409 rows reach the UI.", "A recurring block sends at most `cycles` receivableIds (the first ones in cycle order), so shrinking Número de ciclos never produces a 400 recurring_ids_exceed_cycles.", "CLAUDE.md and nexo/knowledge/reference/propostas.md carry the new wizard rules in the same change."]
---

# 05 - Wizard row ids (web side of PC2, contract C4, H1)

## Context

Everything below was verified in this worktree at `82a62a3`.

The wizard lives in `apps/web/src/sales-ops/SalesOpsApp.tsx`.

- Row form types, all module-private:
  - `SaleItemForm` at `SalesOpsApp.tsx:5912-5926`.
  - `InstallmentRowForm` at `:5928` (`{ dueDate; amountBrl; method }`).
  - `ProfessionalForm` at `:5930-5991`.
  - None of them carries an id today.
- `WizardPrefill` at `:6025-6054`.
- `deriveWizardPrefill(sale, bootstrap)` at `:6182-6295`.
  - It filters out `void` receivables and sorts the rest by `dueDate.slice(0,10)`, then by label (`:6183-6189`).
  - It splits `M`-prefixed rows (recurring) from installment rows (`:6190-6191`).
  - It maps items (`:6192-6223`), professionals (`:6252-6273`) and installments (`:6275-6279`) WITHOUT their ids, although bootstrap carries full rows. `apps/api/src/domains/sales-ops/service.ts:2782-2803` selects `*` from items, receivables and professionals, so `id` is always present on the wire.
- `SaleWizardDialog` at `:6297-6356` returns `null` unless `editSale.status` is `draft` or `open` (`:6334`).
- `SaleWizardDialogBody` state:
  - `installmentRows` seeded from the prefill, or one `{ dueDate: today, amountBrl: '0', method: 'pix' }` row on create (`:6581-6585`).
  - `planDirty`, `appliedPlanKey` (`:6602-6612`).
  - The ONE regeneration site is the render-phase guard at `:6766-6780`: it calls `generateInstallmentPlan(totalCents, planShape, installmentRows.map(row => row.method))` and replaces the rows. Methods are already carried POSITIONALLY there.
  - `regeneratePlan()` (`Regerar plano` and the confirm bar's `Aplicar`) clears `planDirty` and `appliedPlanKey` (`:7379-7382`), which makes that guard regenerate on the next render.
  - `keepEditedRows()` (`Manter parcelas`) rewinds the header only and never touches the rows (`:7385-7392`).
  - `setInstallmentRow(index, patch)` patches a row in place (`:7356-7360`); rows are never re-sorted and there is no add or remove control (the builder is declarative).
- Item constructors: `toSaleItemForm` (`:6070-6090`, lead conversion), the prefill (`:6196-6222`), the create seed (`:6544-6550`), `addItem` (`:7320-7334`), `addFreeItem` (`:7336-7350`). `setItem` (`:7300-7318`) patches in place, including a produto swap.
- Professional constructors: the prefill (`:6252-6273`), the create-only seeding guard (`:6895-6916`), the `+ profissional` button (`:8540-8562`).
- `planRowsValid` (`:6931-6935`) requires every parcela amount `> 0`, and `draftValid` includes `planValid` (`:7026-7028`), so the UI cannot submit a zero-amount parcela today.
- `createPayload(status: 'draft' | 'open')` at `:7569-7672` builds a `SaleDraft` and calls `buildSalePayload` (`calculations.ts:802-860`), which maps items, professionals and installments field by field and never filters by amount.
- `submit(status)` at `:7674-7678` also refuses anything but draft/open; `advanceWizard` ends with `submit('open')` (`:7562`).
- `Salvar rascunho` renders only when `!editSale || editSale.status === 'draft'` (`:9248`).
- The host wiring is `SalesOpsApp` `:2273-2314`: the edit branch calls `updateSale.mutate({ saleId, payload }, { onSuccess: () => setSaleWizard(null) })` with no `onError`, so a failed save today silently does nothing. `saleWizardRef` (`:1414`) mirrors `saleWizard` in an effect.
- `SalesView` row dropdown (`:2668-2698`) shows `Editar` only for draft/open; the won block has `Reabrir` and `Cancelar contrato`.
- `apps/web/src/lib/api-client.ts:17-58`: `apiFetch` throws `ApiError = { error, code?, message?, status }` and DROPS every other body field, so a `rows` array in a 409 body never reaches the caller today.
- Payload types: `SaleDraft*` and `CreateSalePayload` at `apps/web/src/sales-ops/types.ts:315-403`. The recurring block is `{ monthlyBrl, startDate, cycles, method }`; bounded recurring receivables (`M1/c` ...) are generated by the API from that block (`service.ts:893-904`), so the wizard holds no per-cycle row.
- API today: `UpdateSaleSchema` accepts `status: 'draft' | 'open'` only (`service.ts:552-554`) and `updateSale` refuses `won` (`service.ts:2458-2460`). Slice 04 (dependency) changes both; this slice only consumes its result.

## Design

### 1. Row identity is a field of the row form, required

- Add `id: string | null` (REQUIRED, not optional) to `SaleItemForm`, `InstallmentRowForm` and `ProfessionalForm`.
  Required for the same reason `ProfessionalForm.costSplitBp` is required: TypeScript then flags every constructor listed in Context, so none can forget it.
- `null` means "a row the API has never seen".
- Every constructor except `deriveWizardPrefill` writes `id: null`.
- `deriveWizardPrefill` writes:
  - items: `id: item.id ?? null`;
  - professionals: `id: row.id ?? null`;
  - installments: `id: row.id` (receivable ids are always present).
- `WizardPrefill` gains `recurringReceivableIds: string[]`, set to `recurringRows.map((row) => row.id)`.
  `recurringRows` is already non-void and sorted by due date, so this IS cycle order.
- `setItem`, `setInstallmentRow` and the professional patch helpers spread the old row, so a patch keeps the id with no change.
  A produto swap on an item row keeps its id (see Decisions for AUDIT).
- Deleting an item or professional row (`filter((_, i) => i !== index)`) drops its id from state, so the payload omits it and the API voids or removes it (slice 04 decides which).

### 2. Regeneration maps ids POSITIONALLY by row index

New module `apps/web/src/sales-ops/row-identity.ts` (pure, no React, no imports except types):

```ts
/** A persisted row id, or `null` for a row the API has never seen. */
export type RowId = string | null;

/**
 * Carries persisted ids onto a regenerated plan BY ROW INDEX: row `i` of `next`
 * takes `previous[i].id`, rows past the end of `previous` get `null`, and ids of
 * `previous` rows past the end of `next` are dropped (the API voids them).
 * Never matches by label (`N/M` renumbers) or by due date (a moved anchor moves
 * every date). The amount is never read, so a zero-amount row keeps its id.
 */
export function carryRowIdsPositionally<T extends object>(
  previous: ReadonlyArray<{ readonly id: RowId }>,
  next: ReadonlyArray<T>,
): Array<T & { id: RowId }> {
  return next.map((row, index) => ({ ...row, id: previous[index]?.id ?? null }));
}

/** `null`, `undefined` and blank become `undefined`, so JSON omits the key. */
export function payloadRowId(id: RowId | undefined): string | undefined {
  const trimmed = id?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * The first `cycles` non-blank ids in the given (cycle) order, or `undefined` when
 * none remain. The API binds cycle i+1 to index i, refuses more ids than cycles
 * (`recurring_ids_exceed_cycles`), and voids every live `M` row not listed, so a
 * shrunk recorrência simply sends fewer ids. `cycles` null (indefinite) sends none.
 */
export function payloadReceivableIds(
  ids: ReadonlyArray<string> | undefined,
  cycles: number | null | undefined,
): string[] | undefined {
  const limit = typeof cycles === 'number' && cycles > 0 ? Math.floor(cycles) : 0;
  const kept = (ids ?? []).map((id) => id.trim()).filter((id) => id !== '').slice(0, limit);
  return kept.length > 0 ? kept : undefined;
}
```

The regeneration guard at `SalesOpsApp.tsx:6766-6780` becomes (the only edit there):

```ts
setInstallmentRows(
  carryRowIdsPositionally(
    installmentRows,
    generateInstallmentPlan(totalCents, planShape, installmentRows.map((row) => row.method)).map(
      (row) => ({ dueDate: row.dueDate, amountBrl: centsToInput(row.amountBrl), method: row.method }),
    ),
  ),
);
```

Justification for positional mapping, which also goes into `propostas.md`:
- It is the rule `Forma` already follows through a regeneration (`methods` carried positionally), so ids and methods can never disagree about which row is which.
- A receivable's identity for Finance is "the k-th obligation of this proposta".
  Changing `Parcelas restantes` from 6 to 4 then keeps parcelas 1-4 (amounts and dates updated, revision bumped by the API) and voids 5-6, which is exactly the operator's intent.
- Matching by label is forbidden (C4): the API renumbers `N/M` when a row is zeroed and when the count changes.
- Matching by due date fails on the most common regeneration, an anchor or base-date move, which shifts EVERY date and would void and recreate the whole plan.
- Matching by amount fails for an even split (all rows equal).
- A row with an active baixa whose position is re-assigned a new amount or date is refused by the API with `409 row_has_active_settlement` naming it, which is the section 11 rule ("estorne antes"); positional mapping keeps that row's id, so the refusal names the right row.
- Every regeneration path goes through the one guard: live regeneration when `planDirty` is false, `Aplicar` and `Regerar plano` (both via `regeneratePlan`), the produto template reseed (it changes header state and the guard regenerates), and the initial edit-path render when `inferPaymentPlanShape` returned `matchesFormula: true` and the seeded key differs.
  `matchesFormula: false` and `Manter parcelas` never regenerate, so rows and ids stay verbatim.

### 3. Recurring rows travel as an ordered id list

- The wizard has no per-cycle rows, so the recurring ids ride on the recurring block: `recurring.receivableIds?: string[]`, the stored non-void `M` receivable ids in cycle order (see Contract deviations).
- State in `SaleWizardDialogBody`: `const [recurringReceivableIds] = useState<string[]>(() => prefill?.recurringReceivableIds ?? []);` (no setter: the wizard never edits the list).
- `createPayload` sends it only inside a non-null recurring block, so switching `Recorrência` to `nenhuma` sends `recurring: null` and the API voids every `M` row; switching back to `mensal` in the same session sends the list again.
- A `Número de ciclos` or `Valor da mensalidade` or `Início` edit keeps the list in state untouched; the payload sends only its first `cycles` ids (`payloadReceivableIds`), the API binds cycle `i + 1` to `receivableIds[i]`, voids every live `M` row not listed and creates rows past the list (contract C4 as resolved; identical to slice 04's `UpdateSaleRecurringSchema`).
- An indefinite recorrência has no `M` rows, so the list is empty and `payloadReceivableIds` omits the key.

### 4. Payload types and builder

`apps/web/src/sales-ops/types.ts`:
- `SaleDraftItem`, `SaleDraftProfessional`, `SaleDraftInstallment` each gain `id?: string | null`.
- `SaleDraftRecurring` gains `receivableIds?: string[]`.
- `CreateSalePayload.items[]`, `.professionals[]`, `.installments[]` each gain `id?: string`; `.recurring` gains `receivableIds?: string[]`.
  Add one doc comment on `CreateSalePayload`: "`id` fields are sent only on `PUT /sales/:id`; an absent `id` is a new row. The API never matches by `label`."

`apps/web/src/sales-ops/calculations.ts` `buildSalePayload`: import `payloadRowId` and `payloadReceivableIds` from `./row-identity` and add:
- installments: `id: payloadRowId(row.id)` as the FIRST key of each mapped row;
- items: `id: payloadRowId(item.id)` first;
- professionals: `id: payloadRowId(professional.id)` first;
- recurring: `receivableIds: payloadReceivableIds(draft.recurring.receivableIds, draft.recurring.cycles)` last (use the draft's real cycles field; `null` means indefinite).
- Do NOT add any amount filter; a zero-amount row keeps its id (the API voids it).

`createPayload` in `SalesOpsApp.tsx` passes `id: row.id` / `id: item.id` / `id: professional.id` into the draft rows and `receivableIds: recurringReceivableIds` into the recurring draft.
It already maps `persistedProfessionals`, which is the list `professionalRowWillPersist` keeps; a dropped personless row therefore drops its id too, which is correct (a stored row always has a pessoa).

### 5. Won propostas open for edit (H1)

- `calculations.ts` gains:
  ```ts
  /** H1: draft, open and won open in the wizard for edit; lost and cancelled never do. */
  export function isSaleEditableStatus(status: SalesOpsStatus): boolean {
    return status === 'draft' || status === 'open' || status === 'won';
  }
  ```
- `SaleWizardDialog` (`:6334`): `if (props.editSale && !isSaleEditableStatus(props.editSale.status)) return null;`.
- `submit` (`:7676`): same predicate. Its signature and `createPayload`'s become `(status: 'draft' | 'open' | 'won')`.
- `advanceWizard` final line: `submit(editSale?.status === 'won' ? 'won' : 'open');`.
  A won proposta is saved with `status: 'won'` so the PUT never doubles as a transition; leaving `won` still goes only through `POST /sales/:id/transition`.
- `Salvar rascunho` condition at `:9248` is unchanged (`!editSale || editSale.status === 'draft'`), which already hides it for won.
- `SalesView` dropdown: inside the existing `sale.status === 'won'` fragment add, as its FIRST item, `<DropdownMenuItem onSelect={() => onEdit(sale)}>Editar</DropdownMenuItem>`. The draft/open block is unchanged; lost/cancelled get nothing.
- The wizard primary button stays `type="button"` on every step (it already is); no new submit button is introduced.

### 6. The 409 is rendered inside the open wizard

`apps/web/src/lib/api-client.ts` (this slice OWNS the change; slice 08 reuses it and does not touch the file):
- Add `export type ApiErrorRow = { kind: 'receivable' | 'payable'; id: string; label: string };`.
- `ApiError` gains `rows?: ApiErrorRow[]` with a doc comment: "The C5 `rows` of a 409 (`row_has_active_settlement`, `sale_has_active_settlements`): the ledger rows that blocked the write. Display data only; never used to classify auth failures, which key on `status` alone."
- In BOTH `apiFetch` and `apiFetchBlob`, add `rows: Array.isArray(body.rows) ? (body.rows as ApiErrorRow[]) : undefined` to the thrown object. No other body field is added (the error body is not echoed wholesale).
  `require-token.ts` is untouched (it imports nothing and keys on status).

New module `apps/web/src/sales-ops/sale-save-error.ts` (pure):

```ts
export type SettlementBlockingRow = { kind: 'receivable' | 'payable'; id: string; label: string };

/** pt-BR lines to show inside the wizard after a failed PUT /sales/:id. */
export function describeSaleSaveError(error: unknown): string[]
```

Rules, in this order (status and `error` code both read from the thrown `ApiError`, duck-typed like `require-token.ts`):
1. `status === 409 && error === 'row_has_active_settlement'`:
   - Read `error.rows` (the `ApiError.rows` above); keep entries that are objects with `kind` in `receivable|payable` and a string `label`.
   - One line per kept row:
     - receivable whose label starts with `M`: `A mensalidade ${label.slice(1)} tem baixa ativa.` (so `M3/12` reads `A mensalidade 3/12 tem baixa ativa.`);
     - other receivable: `A parcela ${label} tem baixa ativa.`;
     - receivable with blank label: `Uma parcela tem baixa ativa.`;
     - payable: `A conta a pagar ${label} tem baixa ativa.` (the C5 payable label is `Ana Martins (2/6)`, so it reads `A conta a pagar Ana Martins (2/6) tem baixa ativa.`); blank label: `Uma conta a pagar tem baixa ativa.`
   - Then one closing line: `Estorne a baixa antes de mudar valor ou vencimento.` when exactly one row was named, `Estorne as baixas antes de mudar valor ou vencimento.` otherwise.
   - No valid row: `['Uma linha com baixa ativa impede esta alteração.', 'Estorne a baixa antes de mudar valor ou vencimento.']`.
   - Never print `id` (CLAUDE.md UI Identifiers).
2. `status === 409 && error === 'sale_not_editable'`: `['Esta proposta não pode mais ser editada.']`.
3. `status === 403`: `['Somente administradores podem editar propostas.']` (slice 07 gates the PUT and then replaces this line with its shared `MUTATION_ERROR_COPY.adminRequired`, contract H7).
4. Anything else: `['Não foi possível salvar a proposta. Tente novamente.']`.

`SaleWizardDialog` gains an optional prop `saveError?: string[] | null` (forwarded to the body).
The body renders, between the scrolling body and `wizardFooterClass`, only when `saveError && saveError.length > 0`:

```tsx
<div
  className="shrink-0 border-t border-[#f0dcd5] bg-[#fbeee9] px-[26px] py-3 text-[12.5px] font-semibold text-[#b23a22]"
  role="alert"
>
  {saveError.map((line) => (
    <p key={line}>{line}</p>
  ))}
</div>
```

(Same palette as the existing `Selecione a pessoa de cada profissional alocado.` bar at `:8893`.)

`SalesOpsApp` host (`:2273-2314`), a small localized edit:
- `const [saleWizardSaveError, setSaleWizardSaveError] = useState<string[] | null>(null);` next to `saleWizard`.
- Pass `saveError={saleWizardSaveError}` to `SaleWizardDialog`.
- `onClose`: add `setSaleWizardSaveError(null);`.
- Edit branch of `onSave`:
  ```ts
  const saleId = saleWizard.sale.id;
  setSaleWizardSaveError(null);
  updateSale.mutate(
    { saleId, payload },
    {
      onSuccess: () => setSaleWizard(null),
      onError: (error) => {
        const current = saleWizardRef.current;
        if (current?.mode === 'edit' && current.sale.id === saleId) {
          setSaleWizardSaveError(describeSaleSaveError(error));
        }
      },
    },
  );
  ```
  The ref check stops a late error from an abandoned wizard from painting the next one.
- The wizard body is keyed on `editSale.id`, and the failed mutation's bootstrap invalidation only changes props read by initializers, so the operator's typed state survives the error untouched; nothing closes the dialog.
- The create and convert branches are unchanged.

## Steps

Run every test with `pnpm --filter @fxl-sales/web exec vitest run <file>` (run-once, never watch).

1. Red - `apps/web/src/sales-ops/__tests__/row-identity.test.ts`, describe `carryRowIdsPositionally`:
   - `carries previous ids positionally onto a regenerated plan`
   - `gives rows beyond the previous length no id and drops surplus previous ids`
   - `keeps the id of a zero-amount generated row` (use `generateInstallmentPlan(0, { entradaMode: 'none', entradaValue: 0, restanteCount: 1, anchorDate: '2026-07-10' }, ['pix'])`, which yields one `amountBrl: 0` row, and previous `[{ id: 'rec-1' }]`)
   - `payloadRowId turns null, undefined and blank into undefined`
   - `payloadReceivableIds omits an empty list and keeps order`
   - `payloadReceivableIds sends at most cycles ids and none for an indefinite recorrência` (`(['a','b','c'], 2)` gives `['a','b']`; `(['a'], null)` gives `undefined`)
   Green - create `row-identity.ts` exactly as in Design 2.
2. Red - same file, describe `buildSalePayload row ids`:
   - `sends the id of every item, professional and installment it was given`
   - `sends a zeroed installment with its id and amount 0`
   - `omits id for new rows` (assert `'id' in row` is false after `JSON.parse(JSON.stringify(payload))`)
   - `sends recurring receivableIds only when there are any`
   Green - types.ts and `buildSalePayload` changes of Design 4.
3. Red - `apps/web/src/sales-ops/__tests__/sale-save-error.test.ts`, describe `describeSaleSaveError`:
   - `names a single blocking parcela by its label` expects exactly `['A parcela 2/6 tem baixa ativa.', 'Estorne a baixa antes de mudar valor ou vencimento.']` for `{ status: 409, error: 'row_has_active_settlement', rows: [{ kind: 'receivable', id: 'r2', label: '2/6' }] }`.
   - `names every blocking row, recurring and payable included` (`2/6`, `M3/12`, payable `Ana Martins (2/6)`; expects the plural closing line).
   - `falls back to a generic lock message when rows are missing or malformed`
   - `maps sale_not_editable, 403 and any other failure`
   - `never prints a row id` (assert no line contains `r2`).
   Green - create `sale-save-error.ts`.
4. Red - `apps/web/src/lib/__tests__/api-client-token-guard.test.ts`, add `apiFetch keeps the rows of a 409 body on the thrown ApiError` (409 with `rows`; also asserts an unrelated body key such as `secret` is NOT on the error) and `apiFetchBlob keeps the rows of a 409 body on the thrown ApiError`.
   Green - `api-client.ts` change of Design 6.
5. Red - `apps/web/src/sales-ops/__tests__/sale-wizard-row-ids.test.tsx`, a new happy-dom file built by copying the harness of `sale-wizard-edit.test.tsx` (dialog mock, `act`, fixture, `renderWizard`, `buttonByText`, `labeledInput`, `comboboxTrigger`, `changeInput`, `click`) plus `pickOption` from `sale-wizard-payment-plan.test.tsx`, with `renderWizard(sale, bootstrapOverride?, saveError?)`.
   Fixture difference from `sale-wizard-edit.test.tsx`: the professional row carries `id: 'prof-1'`; items keep `item-1`, `item-2`; receivables keep `rec-1`..`rec-4` (`rec-3`, `rec-4` are `M1/2`, `M2/2`).
   A `saveToEnd()` helper clicks `Avançar` three times and then `Salvar proposta`, and `lastPayload()` returns `onSave.mock.calls.at(-1)![0]`.
   Describe `sale wizard row ids`, tests:
   - `round-trips every loaded row id through an untouched edit`: installments ids `['rec-1','rec-2']`, `recurring.receivableIds` `['rec-3','rec-4']`, items ids `['item-1','item-2']`, professionals ids `['prof-1']`.
   - `keeps ids through a hand edit of a parcela amount and date`: on step 2 set `Valor da parcela 1` to `1600`, `Valor da parcela 2` to `1400`, `Vencimento da parcela 2` to `2026-08-20`; payload installments `[{ id: 'rec-1', amountBrl: 160000, ... }, { id: 'rec-2', dueDate: '2026-08-20', amountBrl: 140000, ... }]`.
   - `keeps ids positionally through Aplicar after a header change`: hand edit as above, then `Parcelas restantes` to `3`, click `Aplicar`; installment ids `['rec-1','rec-2',undefined]` and amounts `[100000,100000,100000]`.
   - `keeps ids verbatim through Manter parcelas`: hand edit, `Parcelas restantes` to `3`, click `Manter parcelas`; ids `['rec-1','rec-2']`, amounts `[160000,140000]`.
   - `drops the surplus id when the plan shrinks`: bootstrap with three even installments `rec-1`..`rec-3` of 100000 (`1/3`..`3/3`, dates `2026-07-10`, `2026-08-10`, `2026-09-10`) and `M` rows `rec-4`, `rec-5`; set `Parcelas restantes` to `2`; ids `['rec-1','rec-2']`, `rec-3` absent from the whole payload.
   - `keeps recurring receivable ids through a ciclos edit and sends none without recorrência`: `Número de ciclos` to `3` keeps `['rec-3','rec-4']`; `Número de ciclos` to `1` sends `['rec-3']` only; then `pickOption('Recorrência', 'nenhuma')` gives `recurring: null`.
   - `sends no id for a new item or a new parcela`: add a free item with `+ item avulso`, type `Descrição do item 3` and `Valor unitário do item 3` (`100`), let the formula plan regenerate, and set `Parcelas restantes` to `3`; after a JSON round trip `items[2]` and `installments[2]` have no `id` key while `items[0..1]` and `installments[0..1]` keep theirs. (A new professional's missing id is pinned by the pure `omits id for new rows` test, because a personless new row is dropped and picking a pessoa needs a função fixture this harness does not have.)
   - `never reads the label to match rows`: bootstrap whose installment labels are swapped (`rec-1` labelled `2/2`, `rec-2` labelled `1/2`, dates unchanged); payload order is by due date and ids follow their rows (`['rec-1','rec-2']`).
   - `opens a won proposta for edit and saves it with status won`: `renderWizard({ ...editSale, status: 'won', wonAt: '2026-07-11T12:00:00.000Z' })`; `Editar proposta` present, `Salvar rascunho` absent, payload `status: 'won'` with the ids of the first test.
   - `still refuses to open a lost or cancelled proposta`: container text is empty for both.
   - `renders the save error inside the open wizard`: render with `saveError={['A parcela 2/2 tem baixa ativa.', 'Estorne a baixa antes de mudar valor ou vencimento.']}`; `[role="alert"]` text contains both lines and `Editar proposta` is still present.
   Green - Design 1, 2, 3, 5 and the `saveError` prop of Design 6 in `SalesOpsApp.tsx`, plus `isSaleEditableStatus` in `calculations.ts`.
6. Red - `apps/web/src/sales-ops/__tests__/sales-transition-actions.test.tsx`: rename `routes edit to the wizard for draft and open only` to `routes edit to the wizard for draft, open and won only`; it asserts `P-003` (won) has `Editar` and clicking it calls `onEdit(wonRecurringSale)`, and `P-004` / `P-005` have none.
   Green - the `SalesView` dropdown item of Design 5.
7. Red - `apps/web/src/sales-ops/__tests__/sale-wizard-save-error.test.tsx`, a full-app happy-dom test built from the harness of `cadastros-refresh.test.tsx` (mocked `@/auth/react` with `roles: ['admin']`, mocked `@/components/ui/dialog`, mocked `../api` with `salesOpsApi.bootstrap` resolving a fixture, `QueryClientProvider` with `retry: false`, `MemoryRouter` at `/operacional/vendas`) plus the `@/components/ui/dropdown-menu` mock of `sales-view.test.tsx`.
   The fixture is the `sale-wizard-edit.test.tsx` bootstrap with the sale `status: 'won'`.
   Test `keeps the wizard open with the operator edits and names the blocking row on 409 row_has_active_settlement`:
   - click the row's `Editar`; set `Valor da parcela 1` to `1600` and `Valor da parcela 2` to `1400` on step 2; advance to step 4; `salesOpsApi.updateSale` rejects once with `{ error: 'row_has_active_settlement', status: 409, rows: [{ kind: 'receivable', id: 'rec-2', label: '2/2' }] }`; click `Salvar proposta`; flush.
   - Assert `[role="alert"]` text is `A parcela 2/2 tem baixa ativa.Estorne a baixa antes de mudar valor ou vencimento.` (two `<p>`), `Editar proposta` still present, `updateSale` called once with a payload whose `installments[1]` is `{ id: 'rec-2', amountBrl: 140000, ... }` and `status: 'won'`.
   - Click `Voltar` twice and assert `Valor da parcela 1` is still `1600` and `Valor da parcela 2` is `1400`.
   Green - the host wiring of Design 6.
8. Refactor - update the two edit-path expectations that now carry ids in `apps/web/src/sales-ops/__tests__/sale-wizard-edit.test.tsx`:
   - `submits the reconstructed update payload with status open`: installments become `{ id: 'rec-1', ... }`, `{ id: 'rec-2', ... }`; recurring becomes `{ monthlyBrl: 100000, startDate: '2026-08-10', cycles: 2, method: 'boleto', receivableIds: ['rec-3', 'rec-4'] }`.
   - `round-trips a hand-edited plan through save without rewriting it`: installments gain `id: 'rec-1'`, `'rec-2'`, `'rec-3'`.
   Then run the whole web suite once and fix any other exact-equality expectation that broke only because an edit-path payload now carries ids (create-path payloads carry none, so they must not change).
9. Docs - the CLAUDE.md and `propostas.md` edits below.
10. Lint and types: `pnpm --filter @fxl-sales/web exec eslint <every changed file under apps/web/src>` and `pnpm --filter @fxl-sales/web run type-check`.

## Oracle tests

Command for all of them (run-once):

```bash
pnpm --filter @fxl-sales/web exec vitest run \
  src/sales-ops/__tests__/row-identity.test.ts \
  src/sales-ops/__tests__/sale-save-error.test.ts \
  src/sales-ops/__tests__/sale-wizard-row-ids.test.tsx \
  src/sales-ops/__tests__/sale-wizard-save-error.test.tsx \
  src/sales-ops/__tests__/sale-wizard-edit.test.tsx \
  src/sales-ops/__tests__/sales-transition-actions.test.tsx \
  src/lib/__tests__/api-client-token-guard.test.ts
```

Plus lint on changed files and `pnpm --filter @fxl-sales/web run type-check`.

Named oracles and the mutation that proves each is not vacuous:
- `row-identity.test.ts` > `carries previous ids positionally onto a regenerated plan`: make `carryRowIdsPositionally` return `id: null` always; it fails.
- `row-identity.test.ts` > `keeps the id of a zero-amount generated row`: add `.filter((row) => Number(row.amountBrl) !== 0)`-style amount logic; it fails.
- `row-identity.test.ts` > `sends a zeroed installment with its id and amount 0`: filter zero rows in `buildSalePayload`; it fails.
- `row-identity.test.ts` > `omits id for new rows`: send `id: row.id ?? ''`; it fails.
- `sale-wizard-row-ids.test.tsx` > `round-trips every loaded row id through an untouched edit`: drop `id: row.id` from the prefill of any one row type; it fails.
- `sale-wizard-row-ids.test.tsx` > `keeps ids positionally through Aplicar after a header change`: revert the regeneration guard to the old mapping (no `carryRowIdsPositionally`); it fails.
- `sale-wizard-row-ids.test.tsx` > `drops the surplus id when the plan shrinks`: make the carry append surplus previous ids; it fails.
- `sale-wizard-row-ids.test.tsx` > `never reads the label to match rows`: map ids by `label` index (`Number(label.split('/')[0]) - 1`); it fails.
- `sale-wizard-row-ids.test.tsx` > `opens a won proposta for edit and saves it with status won`: restore the draft/open guard at `SaleWizardDialog`, or `submit('open')`; it fails.
- `sale-wizard-row-ids.test.tsx` > `still refuses to open a lost or cancelled proposta`: make `isSaleEditableStatus` return true; it fails.
- `sale-save-error.test.ts` > `names a single blocking parcela by its label`: return the generic line for every error; it fails.
- `sale-wizard-save-error.test.tsx` > `keeps the wizard open with the operator edits and names the blocking row on 409 row_has_active_settlement`: remove the `onError`, or call `setSaleWizard(null)` in it; it fails.
- `sales-transition-actions.test.tsx` > `routes edit to the wizard for draft, open and won only`: remove the won `Editar` item; it fails.
- `api-client-token-guard.test.ts` > `apiFetch keeps the rows of a 409 body on the thrown ApiError`: drop `rows` from the thrown object; it fails.

Verify must run each named mutation at least for the three wizard oracles (round-trip, Aplicar, won) and revert it, because happy-dom tests with `expect.objectContaining` can pass vacuously when an assertion targets the wrong array.

## Docs

`CLAUDE.md`, section `## Propostas domain`, add a new sub-block right after `Payment plan builder (step 2):` and before `Items and defaults:` (one sentence per line, no em dash):

```markdown
Row identity in the wizard:
- The wizard carries the persisted `id` of every loaded item, professional and installment row, and the recurring `receivableIds` in cycle order, through every edit and sends them on `PUT /sales/:id`; a new row carries none.
- A regenerated plan keeps ids by ROW INDEX through `carryRowIdsPositionally` in `apps/web/src/sales-ops/row-identity.ts`, never by label, date or amount; surplus old ids are omitted so the API voids those rows.
- `buildSalePayload` never filters by amount, so a zero-amount row keeps its id.
- A `won` proposta opens in the wizard (`isSaleEditableStatus`) and saves with `status: 'won'`; `lost` and `cancelled` never open.
- A failed edit save renders `describeSaleSaveError` inside the still-open wizard; a `409 row_has_active_settlement` names each blocking row by its label and never by id.
```

`nexo/knowledge/reference/propostas.md`, append these bullets after the `inferPaymentPlanShape` bullet:

```markdown
- The wizard carries row identity as a REQUIRED `id: string | null` on `SaleItemForm`, `InstallmentRowForm` and `ProfessionalForm`, for the same reason `costSplitBp` is required: TypeScript then flags every row constructor, so none can forget it.
  `deriveWizardPrefill` is the only constructor that writes a non-null id; the recurring `M` rows travel as `recurring.receivableIds`, in due-date order, because the wizard holds the recorrência as a block and never as rows.
- A regeneration maps ids POSITIONALLY by row index, exactly like `Forma`, so ids and methods can never disagree about which row is which.
  Label matching is impossible because the API renumbers `N/M`; due-date matching would void the whole plan on an anchor move; amount matching is ambiguous on an even split.
  The cost is that a position whose amount or date changes keeps its id and is updated in place; when that row has an active baixa the API answers `409 row_has_active_settlement`, which is the intended "estorne antes" rule.
  `Manter parcelas` and `matchesFormula: false` never regenerate, so their ids stay verbatim.
- `planRowsValid` still refuses a zero-amount parcela, so the UI cannot send one; the id guarantee for a zeroed row lives in `carryRowIdsPositionally` and `buildSalePayload`, which never read the amount, and is pinned in `row-identity.test.ts`.
- `apiFetch` keeps the C5 `rows` of an error body as `ApiError.rows` (and nothing else extra) so the 409 blocking rows reach the UI; auth classification still keys on `status` alone.
```

Also in `propostas.md`, change the sentence in the manual-edit bullet "`a Forma edit does NOT, because methods are carried positionally through a regeneration.`" to "`a Forma edit does NOT, because methods and row ids are carried positionally through a regeneration.`"

## Security notes

- The client-sent ids are only hints: slice 04 must resolve every id inside `withTenant` filtered by `org_id` AND `sale_id`, and reject an id that belongs to another sale or org. This slice adds no trust in the body.
- The error message never renders a raw id (CLAUDE.md UI Identifiers); `sale-save-error.test.ts` > `never prints a row id` pins it.
- `ApiError.rows` is data for display logic only; no auth decision reads it, and no other body field is echoed onto the error.
- No new route, no new permission; the admin gate on `PUT /sales/:id` belongs to slice 07.

## Contract deviations

1. C4 says "optional `id` on every ... installment/recurring row", but recurring cycles are not payload rows (the payload carries one `recurring` block and the API expands it, `service.ts:893-904`).
   RESOLVED (plan-check, identical in slice 04): `recurring.receivableIds?: string[]`, the stored non-void `M` receivable ids in cycle order, at most `cycles` of them; the API binds cycle `i + 1` to `receivableIds[i]`, creates rows past the list and voids every live `M` row not listed.
   The executor MUST first read the `UpdateSaleSchema` that slice 04 actually merged (`apps/api/src/domains/sales-ops/service.ts`) and use its exact field names for all four id carriers; if 04 chose another name or shape, change only `types.ts` and `buildSalePayload` to match and record the difference in the exec notes.
2. RESOLVED (plan-check, identical in slice 04): this slice sends `status: 'won'` when editing a won proposta; slice 04 accepts `won` on PUT only when the stored status is already `won` ("won stays won") and answers `409 invalid_status_change` for `won -> open|draft` and `draft|open -> won`.
3. RESOLVED (plan-check): the C5 payable label is `<beneficiaryName> (<receivable label>)` or `<beneficiaryName>` (slice 04 `payableRowLabel`); the UI prints it after `A conta a pagar`.
4. RESOLVED (plan-check): the shared `apiFetch` drops every error body field except `error`, `code`, `message`; this slice adds `ApiError.rows` (typed `ApiErrorRow[]`), which slice 08 reuses without re-planning it.

## Decisions for AUDIT

- D05-1 (HOW, id mapping): a regenerated plan keeps ids by row index; justification in Design 2.
- D05-2 (product detail): the wizard gains no way to zero a parcela; `planRowsValid` still refuses `0`. The zeroed-row id guarantee is at the payload layer, which is what the API voids.
- D05-3 (product detail): no client-side pre-check of paid rows; the API is the single authority and its 409 is rendered after the save attempt, keeping the operator's edits.
- D05-4 (product detail): swapping the produto of an item row keeps the item id (the proposta line is edited in place, not replaced).
- D05-5 (copy): recurring rows read `A mensalidade N/M`, payables read `A conta a pagar <label>`; non-409 failures read `Não foi possível salvar a proposta. Tente novamente.`, and a 403 reads `Somente administradores podem editar propostas.`
- D05-6 (product detail): a won proposta has no `Salvar rascunho` and saves with `status: 'won'`; the PUT never changes status for a won proposta.

## Out of scope

- Any API change (slice 04 owns `updateSale`, the schema and the 409).
- Settlement UI, paid badges or a preflight lock in the wizard (slice 08).
- Surfacing errors on the create and lead-convert paths.
- The deep link route (slice 09) and the admin gate (slice 07).
- Payable ids: payables are derived server-side from receivables and professionals and never travel in the wizard payload.
