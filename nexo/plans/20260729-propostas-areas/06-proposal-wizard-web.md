---
id: 06-proposal-wizard-web
milestone: v2.3.0
status: done
depends_on: [03-proposal-write-backend, 05-areas-web]
files_modified: [apps/web/src/sales-ops/SalesOpsApp.tsx, apps/web/src/sales-ops/types.ts, apps/web/src/sales-ops/calculations.ts, apps/web/src/sales-ops/api.ts, apps/web/src/sales-ops/hooks.ts, apps/web/src/sales-ops/__tests__/calculations.test.ts, apps/web/src/sales-ops/__tests__/sale-wizard-ui-contract.test.ts, apps/web/src/sales-ops/__tests__/sale-wizard-commission-defaults.test.tsx, apps/web/src/sales-ops/__tests__/sale-wizard-custom-item-labels.test.tsx, apps/web/src/sales-ops/__tests__/sale-wizard-payment-plan.test.tsx, apps/web/src/sales-ops/__tests__/sale-wizard-free-items.test.tsx, apps/web/src/sales-ops/__tests__/sale-wizard-edit.test.tsx]
acceptance: "Given a bootstrap with areas and products, when the user fills the Nova proposta wizard, applies Dividir em 3x on step 2, and clicks Salvar proposta on step 4, then onSave receives a status open payload whose installments array has 3 monthly rows summing exactly to the item total and whose items each carry a resolvable areaId."
---

# Slice 06: Proposal wizard web revamp

## Goal

Turn the sale closing wizard in `apps/web/src/sales-ops/SalesOpsApp.tsx` into the 4-step "Nova proposta" wizard: step 1 Proposta, step 2 Pagamento (parcela plan builder plus recurring block), step 3 Custos e margem, step 4 Revisão (previsão).
Ship the v2 payload (`installments[]`, optional `recurring`, `items[].areaId`, free-form item rows) through `SaleDraft`, `CreateSalePayload`, and `buildSalePayload`.
Ship the edit mechanism slice 07's "Editar" row action plugs into: an `editSale: SalesOpsSale | null` prop that prefills the whole wizard from an existing draft or open proposta and submits through a new PUT-based update mutation (see the "Edit support" section).
Update every named wizard contract test deliberately and add new oracle tests for the plan builder math, free-form items, and the edit path.
Keep the existing style of the file: no form library, plain `useState` hooks, hardcoded pt-BR copy, render-time state sync via source keys (the `commissionDefaultsSource` pattern).

## Step 0: Dependency and contract verification (do this before any edit)

Read `apps/web/src/sales-ops/types.ts` and confirm slice 05 shipped: a `SalesOpsArea` type (`id`, `orgId`, `name`, `status: 'active' | 'archived'`, `createdAt`, `updatedAt`), `areas: SalesOpsArea[]` on `SalesOpsBootstrap`, and `areaId: string | null` on `SalesOpsProduct`.
If any of those is missing, stop and report a dependency violation instead of improvising.
Read the createSale zod schema in `apps/api/src/domains/sales-ops/service.ts` (slice 03 shipped it) and confirm the v2 field names match this plan exactly: `installments: [{dueDate, amountBrl, method}]` (min 1, sum equals total), optional `recurring: {monthlyBrl, startDate, cycles: number | null}`, `items[].areaId`, and nullable/optional `items[].productId` for free-form rows.
If the shipped schema still requires top-level `paymentMethod` or `condition`, keep them in `CreateSalePayload` and derive them in `buildSalePayload` as: `paymentMethod = installments[0].method` and `condition = recurring ? 'recurring' : installments.length > 1 ? 'installments' : 'cash'`.
Per slice 03's shipped plan, the backend derives those legacy columns server-side, so the expected outcome of this check is that the web payload does NOT carry them.
Confirm slice 03 also shipped: `PUT /api/v1/sales-ops/sales/:id` (full replace of a non-won proposta, status capped at `draft|open`, 409 `not_editable` for `won|lost|cancelled`, 404 for unknown ids), `receivables` AND `saleProfessionals` both in the bootstrap snapshot (`getSalesOpsSnapshot`; this slice does not add either query itself, see E1), and receivable `label` values of the form `1/n` for installment rows and `M1/c` for bounded recurring rows.
If `saleProfessionals` is missing from slice 03's shipped bootstrap, stop and escalate rather than adding the backend query in this slice - it must stay in slice 03's wave so it never lands in the same wave as slice 04's `service.ts` edits.
Confirm whether slice 05 already added `areaId`/`areaNameSnapshot` to the web `SalesOpsSaleItem` type; if not, Step 1 below adds them.
Any other schema mismatch: stop and escalate to the orchestrator; do not fork the contract.

## Contract: v2 payload shape (shared with slice 03)

```ts
export type CreateSalePayload = {
  clientId?: string;
  clientName: string;
  sellerPersonId?: string;
  sellerName: string;
  finderPersonId?: string;
  finderName?: string | null;
  status: SalesOpsStatus;            // wizard only ever sends 'draft' or 'open'
  baseDate: string;                  // ISO yyyy-mm-dd, proposal date
  notes: string | null;
  sellerCommissionPct: number;
  finderCommissionPct: number;
  taxPct: number;
  otherCostsBrl: number;             // cents
  installments: Array<{ dueDate: string; amountBrl: number; method: PaymentMethod }>; // cents, must sum to items total
  recurring: { monthlyBrl: number; startDate: string; cycles: number | null; method?: PaymentMethod } | null; // cents; cycles null = indefinite
  items: Array<{
    productId?: string;              // omitted for free-form rows
    areaId?: string;                 // product rows: product.areaId; free rows: picked; omitted only when product has no area (server rejects)
    productName: string;             // free rows: the description
    productType: string;             // product rows: product.type; free rows: 'Avulso'
    quantity: number;
    unitBrl: number;                 // cents
  }>;
  professionals: Array<{ personId?: string; personName: string; role: string; costBrl: number }>;
};
```

The top-level `paymentMethod`, `condition`, and numeric `installments` fields of the old payload are removed (subject to the Step 0 check above).
`recurring.method` is slice 03's deliberately defaulted extension (`pix` when absent); the wizard never renders a UI for it and only sets it during edit prefill so a boleto-based recurring plan round-trips without silently flipping to pix.

## Step 1: types.ts changes

File: `apps/web/src/sales-ops/types.ts`.

1. Extend the status union so the wizard can submit the new lifecycle while slice 07 finishes the sweep:
```ts
export type SalesOpsStatus =
  | 'draft'
  | 'open'
  | 'won'
  | 'lost'
  | 'cancelled'
  // legacy statuses below are removed by slice 07-propostas-list-web
  | 'forecast'
  | 'closed'
  | 'in_progress'
  | 'completed';
```
2. Add the draft plan types:
```ts
export type SaleDraftInstallment = { dueDate: string; amountBrl: string | number; method: PaymentMethod };
export type SaleDraftRecurring = { monthlyBrl: string | number; startDate: string; cycles: number | null; method?: PaymentMethod };
```
3. On `SaleDraftItem`: add `areaId?: string;` (keep all existing fields).
4. On `SaleDraft`: delete `paymentMethod`, `condition`, and `installments: string | number`; add `installments: SaleDraftInstallment[];` and `recurring?: SaleDraftRecurring | null;`.
5. On `CreateSalePayload`: apply the contract shape above verbatim (delete `paymentMethod`, `condition`, numeric `installments`; add the `installments` array, `recurring`, and `items[].areaId`).
6. Leave `PaymentCondition` in place; it is still used by `conditionLabel` and the sales table until slice 07.
7. Add the receivable and sale-professional read types plus the bootstrap wiring the edit path needs (slice 07 step 0 line "slice 06 web wiring" pins this ownership):
```ts
export type SalesOpsReceivable = {
  id: string;
  orgId?: string;
  saleId: string;
  label?: string;             // '1/n' for installment rows, 'M1/c' for bounded recurring rows (slice 03 ledger contract)
  dueDate: string;
  amountBrl: number;
  method: PaymentMethod;
  status: 'open' | 'paid' | 'void';
  createdAt?: string;
  updatedAt?: string | null;
};

export type SalesOpsSaleProfessional = {
  id?: string;
  orgId?: string;
  saleId: string;
  personId: string | null;
  personNameSnapshot: string;
  role: string;
  costBrl: number;
};
```
8. On `SalesOpsBootstrap`: add `receivables: SalesOpsReceivable[];` and `saleProfessionals: SalesOpsSaleProfessional[];`.
9. On `SalesOpsSaleItem`: if slice 05 has not already done it, add `areaId?: string | null;` and `areaNameSnapshot?: string;`.

## Step 2: calculations.ts changes

File: `apps/web/src/sales-ops/calculations.ts`.

1. Move `addMonthsToIsoDate` out of `SalesOpsApp.tsx` into `calculations.ts` as an export, and make it timezone-safe with `Date.UTC` so unit tests never flake by TZ:
```ts
export function addMonthsToIsoDate(value: string, months: number): string {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Date(Date.UTC(year, month - 1 + months, day)).toISOString().slice(0, 10);
}
```
2. Add the plan builder helpers (import `PaymentMethod` from `./types`):
```ts
export function splitInstallmentsEqually(
  totalCents: number,
  count: number,
  startDate: string,
  method: PaymentMethod,
): Array<{ dueDate: string; amountBrl: number; method: PaymentMethod }> {
  const n = Math.max(1, Math.floor(count));
  const base = Math.floor(totalCents / n);
  return Array.from({ length: n }, (_, index) => ({
    dueDate: addMonthsToIsoDate(startDate, index),
    amountBrl: index === n - 1 ? totalCents - base * (n - 1) : base,
    method,
  }));
}

export function installmentSumCents(rows: Array<{ amountBrl: string | number }>): number {
  return rows.reduce((sum, row) => sum + parseCurrencyInputToCents(row.amountBrl), 0);
}
```
3. Rework `buildSalePayload` (keep `cleanId`, `toNumber`, and all other exports untouched, including `resolveSaleCommissionDefaults`):
```ts
export function buildSalePayload(draft: SaleDraft): CreateSalePayload {
  return {
    clientId: cleanId(draft.clientId),
    clientName: draft.clientName.trim(),
    sellerPersonId: cleanId(draft.sellerPersonId),
    sellerName: draft.sellerName.trim(),
    finderPersonId: cleanId(draft.finderPersonId),
    finderName: cleanId(draft.finderName) ?? null,
    status: draft.status,
    baseDate: draft.baseDate,
    notes: cleanId(draft.notes) ?? null,
    sellerCommissionPct: toNumber(draft.sellerCommissionPct),
    finderCommissionPct: toNumber(draft.finderCommissionPct),
    taxPct: toNumber(draft.taxPct),
    otherCostsBrl: Math.max(0, Math.floor(toNumber(draft.otherCostsBrl))),
    installments: draft.installments.map((row) => ({
      dueDate: row.dueDate,
      amountBrl: Math.max(0, Math.floor(toNumber(row.amountBrl))),
      method: row.method,
    })),
    recurring: draft.recurring
      ? {
          monthlyBrl: Math.max(0, Math.floor(toNumber(draft.recurring.monthlyBrl))),
          startDate: draft.recurring.startDate,
          cycles: draft.recurring.cycles === null ? null : Math.max(1, Math.floor(draft.recurring.cycles)),
          method: draft.recurring.method ?? 'pix',
        }
      : null,
    items: draft.items.map((item) => ({
      productId: cleanId(item.productId),
      areaId: cleanId(item.areaId),
      productName: item.productName.trim(),
      productType: item.productType.trim() || 'SaaS',
      quantity: Math.max(1, Math.floor(toNumber(item.quantity, 1))),
      unitBrl: Math.max(0, Math.floor(toNumber(item.unitBrl))),
    })),
    professionals: draft.professionals.map((professional) => ({
      personId: cleanId(professional.personId),
      personName: professional.personName.trim(),
      role: professional.role.trim(),
      costBrl: Math.max(0, Math.floor(toNumber(professional.costBrl))),
    })),
  };
}
```
4. Do not touch `closedStatuses` or `buildDashboardModel`; the status sweep is slice 07.

## Step 3: SalesOpsApp.tsx rename sweep (outside the wizard body)

1. Line ~592 header CTA fallback: `'Nova venda'` becomes `'Nova proposta'`.
2. Line ~796 sidebar `AccentButton`: `<span>Nova venda</span>` becomes `<span>Nova proposta</span>`.
3. Line ~1124 vendas EmptyPanel: text becomes `"Use o botão Nova proposta para registrar a primeira proposta."`.
4. `statusMeta` (~line 192): the `Record<SalesOpsStatus, ...>` map must stay exhaustive after the union grows, so add exactly these three entries (legacy entries stay until slice 07):
```ts
open: { label: 'Aberta', className: 'bg-[#d3e3f6] text-[#2664ad]' },
won: { label: 'Ganha', className: 'bg-[#c9e7cf] text-[#1f7d43]' },
lost: { label: 'Perdida', className: 'bg-[#f6d1c5] text-[#a5341c]' },
```
5. Delete the local `addMonthsToIsoDate` (~line 229) and add `addMonthsToIsoDate`, `splitInstallmentsEqually`, and `installmentSumCents` to the existing import from `./calculations`.
6. Keep `dateOnly`, `displayDate`, `inputDateToday`, `conditionLabel`, and the sales table untouched.

## Step 4: wizard state shape

Inside `SaleWizardDialogBody`:

1. Item rows become a tagged shape (single type, not a union, to keep `setItem` simple):
```ts
type SaleItemForm = {
  kind: 'product' | 'free';
  productId: string;    // '' on free rows
  areaId: string;       // '' on product rows (derived from the product); picked on free rows
  customLabel: string;  // open-price custom label on product rows; the description on free rows
  quantity: string;     // always '1' on free rows
  unitBrl: string;
};

type InstallmentRowForm = { dueDate: string; amountBrl: string; method: PaymentMethod };
```
2. Delete these states: `paymentMethod`, `condition`, `installments`.
3. Rename `showCustomItemErrors` to `showItemErrors` (it now also covers missing áreas and free rows).
4. `wizardStep` becomes `useState<1 | 2 | 3 | 4>(1)`.
5. Add plan states:
```ts
const [installmentRows, setInstallmentRows] = useState<InstallmentRowForm[]>([
  { dueDate: baseDateInitial, amountBrl: centsToInput(initialTotalCents), method: 'pix' },
]);
const [planAuto, setPlanAuto] = useState(true);
const [planAutoKey, setPlanAutoKey] = useState('');
const [splitCount, setSplitCount] = useState('3');
const [showPlanErrors, setShowPlanErrors] = useState(false);
```
The initial row can simply be `{ dueDate: inputDateToday(), amountBrl: '0', method: 'pix' }` because the auto-sync below overwrites it on first render.
6. Add recurring states:
```ts
const [recurringEnabled, setRecurringEnabled] = useState(false);
const [recurringMonthlyBrl, setRecurringMonthlyBrl] = useState('0');
const [recurringStartDate, setRecurringStartDate] = useState(addMonthsToIsoDate(inputDateToday(), 1));
const [recurringCycles, setRecurringCycles] = useState('12');
const [recurringIndefinite, setRecurringIndefinite] = useState(false);
const [recurringSource, setRecurringSource] = useState('');
```
7. Existing `items` initial state gains `kind: 'product'` and `areaId: ''` on the seeded row.

## Step 5: render-time sync blocks (mirror the commissionDefaultsSource pattern)

Place both right after the existing commission defaults sync block.

1. Auto plan: while the user has not touched the plan, keep it as one parcela worth the full total due at `baseDate`:
```ts
const planAutoKeyNow = JSON.stringify([totalCents, baseDate]);
if (planAuto && planAutoKey !== planAutoKeyNow) {
  setPlanAutoKey(planAutoKeyNow);
  setInstallmentRows([{ dueDate: baseDate, amountBrl: centsToInput(totalCents), method: 'pix' }]);
}
```
Every manual plan mutation (row edit, add, remove, Dividir) calls `setPlanAuto(false)` first.
2. Recurring suggestion: when the primary product changes to one with a mensalidade, auto-enable and prefill; when it changes to one without, auto-disable (the user can re-enable on demand):
```ts
const recurringSourceNow = JSON.stringify([
  primaryItemProduct?.id,
  primaryItemProduct?.hasMonthly,
  primaryItemProduct?.monthlyBrl,
]);
if (recurringSource !== recurringSourceNow) {
  const suggested = Boolean(primaryItemProduct?.hasMonthly && primaryItemProduct.monthlyBrl > 0);
  setRecurringSource(recurringSourceNow);
  setRecurringEnabled(suggested);
  setRecurringMonthlyBrl(centsToInput(primaryItemProduct?.monthlyBrl));
  setRecurringStartDate(addMonthsToIsoDate(baseDate, 1));
  setRecurringIndefinite(false);
}
```

## Step 6: derived values and validation rules

Replace `installmentCount`, `paymentRows`, and `recurringLine` with:

```ts
const activeAreas = bootstrap.areas.filter((area) => area.status === 'active');
const areaNameById = new Map(bootstrap.areas.map((area) => [area.id, area.name]));
const planSumCents = installmentSumCents(installmentRows);
const planDeltaCents = planSumCents - totalCents;
const planRowsValid =
  installmentRows.length >= 1 &&
  installmentRows.every(
    (row) => /^\d{4}-\d{2}-\d{2}$/.test(row.dueDate) && parseCurrencyToCents(row.amountBrl) > 0,
  );
const planValid = planRowsValid && planDeltaCents === 0;
const recurringMonthlyCents = parseCurrencyToCents(recurringMonthlyBrl);
const recurringCyclesCount = Math.max(1, Math.min(120, Math.floor(Number(recurringCycles) || 0)));
const recurringValid =
  !recurringEnabled ||
  (recurringMonthlyCents > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(recurringStartDate) &&
    (recurringIndefinite || Math.floor(Number(recurringCycles) || 0) >= 1));
const canAdvanceStepTwo = planValid && recurringValid;
```

Item validity replaces `customItemsValid`:
```ts
function itemAreaId(item: SaleItemForm): string {
  return item.kind === 'free' ? item.areaId : selectedProduct(item)?.areaId ?? '';
}
const itemsValid = items.every((item) => {
  if (item.kind === 'free') {
    return Boolean(item.areaId) && Boolean(item.customLabel.trim()) && parseCurrencyToCents(item.unitBrl) > 0;
  }
  const product = selectedProduct(item);
  const openPriceOk =
    !product?.openPrice || (Boolean(item.customLabel.trim()) && parseCurrencyToCents(item.unitBrl) > 0);
  return openPriceOk && Boolean(product?.areaId);
});
const canAdvanceStepOne = canSaveBasics && itemsValid;
```

`canSaveBasics` loses the `Boolean(paymentMethod)` term: `const canSaveBasics = canSave && totalCents > 0;`.
Draft validity: open-price product rows may keep an empty custom label for drafts (name falls back to the catalog name), but área, free rows, and the plan must be valid because the API rejects them otherwise:
```ts
const draftValid =
  canSaveBasics &&
  planValid &&
  recurringValid &&
  items.every((item) =>
    item.kind === 'free'
      ? Boolean(item.areaId) && Boolean(item.customLabel.trim()) && parseCurrencyToCents(item.unitBrl) > 0
      : Boolean(selectedProduct(item)?.areaId),
  );
```

When errors surface:
- Step 1 field errors (open-price label/value, missing product área, free row description/value) render only after `showItemErrors` is true, which `advanceWizard` sets on a blocked step 1 advance (existing behavior, extended).
- The step 2 sum mismatch message renders live whenever `planDeltaCents !== 0`; it does not wait for a click.
- Step 2 per-row errors (`dueDate` empty, amount zero) and recurring errors render only after `showPlanErrors` is true, which `advanceWizard` sets on a blocked step 2 advance.

`totalCents` keeps summing item subtotals only; the recurring mensalidade is additive on top and never enters the parcela sum check or the margin math.

## Step 7: item row functions and free-form rows

1. `selectedProduct` returns `undefined` for free rows:
```ts
function selectedProduct(item: SaleItemForm) {
  if (item.kind === 'free') return undefined;
  return bootstrap.products.find((product) => product.id === item.productId) ?? firstProduct;
}
```
2. `saleItemDisplayName`: free rows return `item.customLabel.trim() || 'Item avulso'`; product rows unchanged.
3. `addItem` keeps seeding a product row and now sets `kind: 'product'`, `areaId: ''`.
4. New `addFreeItem`:
```ts
function addFreeItem() {
  if (activeAreas.length === 0) return;
  setItems((current) => [
    ...current,
    { kind: 'free', productId: '', areaId: activeAreas[0]!.id, customLabel: '', quantity: '1', unitBrl: '0' },
  ]);
}
```
5. Items card header gains a second button between "Cadastrar produto" and "+ item":
```jsx
<button
  className="rounded-[9px] border border-[#dcdce2] bg-white px-3 py-[7px] text-[12.5px] font-semibold text-[#57575f] transition hover:bg-[#f2f2f4] disabled:cursor-not-allowed disabled:opacity-45"
  disabled={activeAreas.length === 0}
  onClick={addFreeItem}
  title={activeAreas.length === 0 ? 'Cadastre áreas em Cadastros > Áreas' : undefined}
  type="button"
>
  + item avulso
</button>
```
6. Product rows keep the exact existing 5-column grid, aria-labels, and open-price sub-row; two additions:
- The first cell becomes a `flex flex-col gap-1` wrapping the product `NativeSelect` plus an área chip below it:
```jsx
{product?.areaId ? (
  <span className="self-start rounded-full bg-[#ececf1] px-2 py-[2px] text-[11px] font-bold text-[#57575f]">
    {areaNameById.get(product.areaId) ?? 'Área'}
  </span>
) : (
  <span className="self-start rounded-full bg-[#fdf0cf] px-2 py-[2px] text-[11px] font-bold text-[#9c7210]">
    Sem área
  </span>
)}
```
- When `showItemErrors && !product?.areaId`, render a full-width sub-row under the item (same grid pattern as the open-price sub-row) with the destructive text `Defina a área deste produto em Cadastros > Produtos.`.
7. Free rows render in the same 5-column grid to preserve alignment:
- Column 1: `NativeSelect` with `aria-label={`Área do item ${index + 1}`}` listing `activeAreas` (no empty option; value is `item.areaId`).
- Column 2: static muted centered text `1` (free rows have fixed quantity 1; no input).
- Column 3: value `Input` reusing `aria-label={`Valor unitário do item ${index + 1}`}` with the same destructive styling when `showItemErrors` and value is zero.
- Column 4: subtotal (`1 * unit`), same classes as product rows.
- Column 5: the same remove button with `aria-label={`Remover item ${index + 1}`}`.
- Below, a full-width sub-row exactly like the open-price one with label text `Descrição do item`, an `Input` with `aria-label={`Descrição do item ${index + 1}`}`, `placeholder="Ex.: Consultoria de processos"`, `maxLength={140}`, storing into `customLabel`.
- Sub-row helper line when not erroring: `Item avulso - informe a área, a descrição e o valor` with the existing amber `AlertTriangle` styling.
- Error lines when `showItemErrors`: `Selecione a área deste item.` (empty `areaId`), `Informe a descrição deste item avulso.` (empty description), `Informe um valor negociado maior que zero.` (zero value).
8. `setItem` keeps its product-change reset behavior; it only ever runs for the fields present on the row being edited, and never flips `kind`.

## Step 8: step restructure and step indicator

1. `wizardSteps` becomes:
```ts
const wizardSteps: Array<{ step: 1 | 2 | 3 | 4; label: string }> = [
  { step: 1, label: 'Proposta' },
  { step: 2, label: 'Pagamento' },
  { step: 3, label: 'Custos e margem' },
  { step: 4, label: 'Revisão' },
];
```
2. Step indicator button `disabled` becomes `(item.step > 1 && !canAdvanceStepOne) || (item.step > 2 && !canAdvanceStepTwo)`.
3. Navigation:
```ts
function advanceWizard() {
  if (wizardStep === 1) {
    setShowItemErrors(true);
    if (!canAdvanceStepOne) return;
  }
  if (wizardStep === 2) {
    setShowPlanErrors(true);
    if (!canAdvanceStepTwo) return;
  }
  if (wizardStep < 4) {
    setWizardStep((current) => (current + 1) as 2 | 3 | 4);
    return;
  }
  submit('open');
}

function goBack() {
  setWizardStep((current) => (current > 1 ? ((current - 1) as 1 | 2 | 3) : current));
}
```
4. `const primaryLabel = wizardStep < 4 ? 'Avançar' : 'Salvar proposta';`.
5. Dialog header:
- `DialogTitle` text: `Nova proposta`.
- `DialogDescription` text: `Cliente, itens, pagamento e custos - salve como rascunho a qualquer momento`.
6. EmptyPanel text inside the wizard (~line 3181) becomes `"Cadastre pelo menos um produto e um vendedor para registrar uma proposta."`.
7. Step 1 content changes:
- The "Cliente e responsáveis" card keeps cliente datalist plus vendedor/finder grid unchanged, except the finder CTA copy becomes `Essa proposta teve um finder` and, below the vendedor/finder grid, add `<div className="mt-4 grid gap-4 md:grid-cols-2"><Field label="Data da proposta"><Input className={`sales-ops-num ${formInputClass}`} onChange={(event) => setBaseDate(event.target.value)} type="date" value={baseDate} /></Field></div>`.
- The Itens card changes per Step 7.
- Delete the whole "Pagamento e recebimento" card (forma/condição/parcelas/data-base selects, recurring green line, and the read-only "Parcelas a receber" table); its concerns move to step 2.
- Keep Observações (placeholder becomes `Notas internas sobre a proposta...`) and the total footer (label becomes `Total da proposta`).

## Step 9: step 2 Pagamento JSX

Render when `wizardStep === 2`, as a `flex flex-col gap-[18px]` with two cards.

Card 1, plan builder:
```jsx
<div className="rounded-[14px] border border-[#e8e8ec] bg-white p-4">
  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
    <div className="text-[13px] font-bold">Plano de pagamento</div>
    <div className="flex items-center gap-2">
      <span className="text-[12.5px] font-semibold text-[#8b8b92]">Dividir em</span>
      <Input
        aria-label="Número de parcelas"
        className={`sales-ops-num h-9 w-16 rounded-[9px] text-center ${formInputClass}`}
        min={1}
        onChange={(event) => setSplitCount(event.target.value)}
        type="number"
        value={splitCount}
      />
      <span className="text-[12.5px] font-semibold text-[#8b8b92]">x</span>
      <button
        className="rounded-[9px] border border-[#dcdce2] bg-white px-3 py-[7px] text-[12.5px] font-semibold text-[#9c7210] transition hover:bg-[#f2f2f4]"
        onClick={applySplit}
        type="button"
      >
        Dividir
      </button>
      <button
        className="rounded-[9px] bg-[#201f24] px-3 py-[7px] text-[12.5px] font-semibold text-white transition hover:bg-[#33333a]"
        onClick={addInstallmentRow}
        type="button"
      >
        + parcela
      </button>
    </div>
  </div>
  {/* column header row, grid-cols-[44px_minmax(0,1fr)_150px_150px_36px]: Nº | Vencimento | Valor | Forma | (remove) */}
  {/* one editable row per installmentRows entry */}
  {/* footer sum line */}
</div>
```
Each parcela row (index `i`):
- `<div className="sales-ops-num text-[13px] font-semibold">{i + 1}</div>`.
- Date `Input` `type="date"` with `aria-label={`Vencimento da parcela ${i + 1}`}`, destructive border when `showPlanErrors` and the date is invalid.
- Amount `Input` (right aligned, `sales-ops-num`) with `aria-label={`Valor da parcela ${i + 1}`}`, destructive border when `showPlanErrors` and the parsed value is zero.
- `NativeSelect` with `aria-label={`Forma de pagamento da parcela ${i + 1}`}` and the four options Pix, Cartão, Boleto, Transferência (values `pix|card|boleto|transfer`).
- Remove button with `aria-label={`Remover parcela ${i + 1}`}`, same trash styling as item rows, `disabled={installmentRows.length === 1}`.
All row mutators call `setPlanAuto(false)` before updating `installmentRows`.
```ts
function applySplit() {
  const count = Math.max(1, Math.min(120, Math.floor(Number(splitCount) || 1)));
  setPlanAuto(false);
  setInstallmentRows(
    splitInstallmentsEqually(totalCents, count, baseDate, installmentRows[0]?.method ?? 'pix').map((row) => ({
      dueDate: row.dueDate,
      amountBrl: centsToInput(row.amountBrl),
      method: row.method,
    })),
  );
}

function addInstallmentRow() {
  setPlanAuto(false);
  setInstallmentRows((current) => {
    const last = current.at(-1);
    return [
      ...current,
      { dueDate: addMonthsToIsoDate(last?.dueDate ?? baseDate, 1), amountBrl: '0', method: last?.method ?? 'pix' },
    ];
  });
}
```
Footer sum line, always rendered under the rows:
```jsx
<div className="mt-3 flex items-center justify-between border-t border-[#eeeef1] pt-3 text-[12.5px]">
  <span className="font-semibold text-[#8b8b92]">Soma das parcelas</span>
  <span className={`sales-ops-num font-bold ${planDeltaCents === 0 ? 'text-[#2f7d4b]' : 'text-[#b23a22]'}`}>
    {formatMoneyBrl(planSumCents)} / {formatMoneyBrl(totalCents)}
  </span>
</div>
{planDeltaCents !== 0 ? (
  <div className="mt-2 rounded-[10px] border border-[#f0dcd5] bg-[#fbeee9] px-3 py-2 text-[12.5px] font-semibold text-[#b23a22]">
    A soma das parcelas precisa ser igual ao total da proposta. Diferença: {formatMoneyBrl(Math.abs(planDeltaCents))}
  </div>
) : null}
```

Card 2, recurring block:
```jsx
<div className="rounded-[14px] border border-[#e8e8ec] bg-white p-4">
  <div className="mb-3 flex items-center justify-between">
    <div className="text-[13px] font-bold">Recorrência</div>
    {recurringEnabled ? (
      <button className="text-xs font-semibold text-[#b23a22]" onClick={() => setRecurringEnabled(false)} type="button">
        remover
      </button>
    ) : null}
  </div>
  {recurringEnabled ? (
    <>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Mensalidade (R$)">
          <Input aria-label="Valor da mensalidade" className={`sales-ops-num text-right ${formInputClass}`} onChange={...} value={recurringMonthlyBrl} />
        </Field>
        <Field label="Início">
          <Input aria-label="Início da recorrência" className={`sales-ops-num ${formInputClass}`} onChange={...} type="date" value={recurringStartDate} />
        </Field>
        <Field label="Nº de ciclos">
          <Input aria-label="Número de ciclos" className={`sales-ops-num ${formInputClass}`} disabled={recurringIndefinite} min={1} onChange={...} type="number" value={recurringCycles} />
        </Field>
      </div>
      {/* checkbox button in the sellerIsFinder style toggling recurringIndefinite, label: Prazo indeterminado */}
      {/* green summary line, same styling as the old recurringLine banner */}
    </>
  ) : (
    <button
      className="flex h-11 w-full items-center justify-center gap-2 rounded-[10px] border border-dashed border-[#d8cdb0] bg-[#fafafb] px-3 text-[13.5px] font-semibold text-[#9c7210] transition hover:bg-[#f4efe2]"
      onClick={() => setRecurringEnabled(true)}
      type="button"
    >
      <Plus className="h-[15px] w-[15px]" />
      Adicionar recorrência
    </button>
  )}
</div>
```
Green summary line (reuse the old `recurringLine` banner classes with `RotateCcw`):
`Mensalidade de {formatMoneyBrl(recurringMonthlyCents, { maximumFractionDigits: 0 })} a partir de {displayDate(recurringStartDate)}{recurringIndefinite ? ', por prazo indeterminado' : `, por ${recurringCyclesCount} ciclos`}`.
When `recurringIndefinite`, add a muted info line below: `Sem parcelas futuras geradas agora - a mensalidade entra como receita recorrente (MRR).`.
Recurring error lines when `showPlanErrors && recurringEnabled`: `Informe uma mensalidade maior que zero.` (zero mensalidade) and `Informe o número de ciclos ou marque prazo indeterminado.` (no cycles and not indefinite), destructive styling.

## Step 10: step 3 Custos e margem

The existing step 2 block (profissionais alocados, outros custos, comissões, imposto, margem card) moves to `wizardStep === 3` unchanged except the condition check.
No content edits in this step.

## Step 11: step 4 Revisão (previsão)

The existing step 3 block moves to `wizardStep === 4` with these edits:
1. Prepend a banner above the two-column grid:
```jsx
<div className="rounded-[11px] border border-[#f0dfae] bg-[#fdf0cf] px-[14px] py-[11px] text-[13px] text-[#57575f]">
  Esta é uma previsão - nada é lançado no financeiro até a proposta ser marcada como Ganha.
</div>
```
2. Left card title `Dados da venda` becomes `Dados da proposta`; its `editar` button keeps `setWizardStep(1)`.
3. Replace the `Condição` row with:
- `Pagamento` row: value `` `${installmentRows.length} parcela${installmentRows.length > 1 ? 's' : ''}` ``.
- When `recurringEnabled`, add a `Recorrência` row: value `` `${formatMoneyBrl(recurringMonthlyCents, { maximumFractionDigits: 0 })}/mês${recurringIndefinite ? ' (indeterminado)' : ` por ${recurringCyclesCount} ciclos`}` ``.
4. `Produto(s)` row label stays; it already joins `saleItemDisplayName`, which now covers free rows.
5. Right margem card: the `editar` button targets `setWizardStep(3)`; the "editar custos" button on the payables card also targets `setWizardStep(3)`.
6. Payables card title `Contas a pagar geradas` becomes `Previsão de contas a pagar`, and under the title add a muted line: `Estes lançamentos serão gerados quando a proposta for marcada como Ganha.`.
7. Rebuild `payablesPreview` from the plan, mirroring the backend per-receivable materialization:
```ts
const previewReceivables = [
  ...installmentRows.map((row) => ({ dueDate: row.dueDate, amountCents: parseCurrencyToCents(row.amountBrl) })),
  ...(recurringEnabled && !recurringIndefinite && settings.commissionOnRecurring
    ? Array.from({ length: recurringCyclesCount }, (_, index) => ({
        dueDate: addMonthsToIsoDate(recurringStartDate, index),
        amountCents: recurringMonthlyCents,
      }))
    : []),
];
```
Rows, in order, skipping any row whose value is zero or less:
- Per receivable `i`: seller commission `{ label: `Comissão - ${sellerName} (parcela ${i + 1})`, type: 'Comissão vendedor', date: displayDate(dueDate), value: Math.floor((amountCents * parseDecimal(sellerCommissionPct, 0)) / 100) }` with the existing amber chip class.
- Per receivable, when `hasFinderForSale`: `Comissão - ${finderName} (finder, parcela ${i + 1})`, type `Comissão finder`, same date, `Math.floor((amountCents * parseDecimal(finderCommissionPct, 0)) / 100)`.
- Per receivable, when `parseDecimal(taxPct, 0) > 0`: `Imposto sobre a parcela ${i + 1} (${taxPct}%)`, type `Imposto`, same date, `Math.floor((amountCents * parseDecimal(taxPct, 0)) / 100)`, existing red chip class.
- One row per professional, unchanged (`Alocação - ...`, due `displayDate(baseDate)`).
- One `Outros custos do projeto` row when `otherCents > 0`, due `displayDate(baseDate)`.
Per-row flooring may differ from the aggregate step 3 numbers by a few cents; that is expected and matches the backend contract.
8. The totals row label `Total a pagar` becomes `Total previsto`.

## Step 12: footer

```jsx
<div className="flex items-center justify-between border-t border-[#e8e8ec] bg-white px-[26px] py-4">
  <button className={...same...} onClick={goBack} type="button">Voltar</button>
  <div className="flex items-center gap-3">
    <span className="text-[13px] text-[#9b9ba3]">Passo {wizardStep} de 4</span>
    <button
      className={...same secondary...}
      disabled={!draftValid || saving}
      onClick={() => submit('draft')}
      title="Salvar como rascunho para terminar depois"
      type="button"
    >
      Salvar rascunho
    </button>
    <button className={...same primary...} disabled={saving || (wizardStep === 1 && !canSave)} onClick={advanceWizard} type="button">
      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : primaryLabel}
    </button>
  </div>
</div>
```
`submit` narrows to `function submit(status: 'draft' | 'open')` and keeps the `if (!canSave) return;` guard.

## Step 13: payload construction

`createPayload(status: 'draft' | 'open')` builds the draft with:
```ts
const draft: SaleDraft = {
  clientId,
  clientName,
  sellerPersonId,
  sellerName: seller?.displayName ?? '',
  finderPersonId: hasFinderForSale ? (sellerIsFinder ? sellerPersonId : finderPersonId || undefined) : undefined,
  finderName: finder?.displayName,
  status,
  baseDate,
  notes,
  sellerCommissionPct,
  finderCommissionPct,
  taxPct,
  otherCostsBrl: otherCents,
  installments: installmentRows.map((row) => ({
    dueDate: row.dueDate,
    amountBrl: parseCurrencyToCents(row.amountBrl),
    method: row.method,
  })),
  recurring: recurringEnabled
    ? {
        monthlyBrl: parseCurrencyToCents(recurringMonthlyBrl),
        startDate: recurringStartDate,
        cycles: recurringIndefinite ? null : recurringCyclesCount,
        method: recurringMethod,
      }
    : null,
  items: items.map((item) => {
    if (item.kind === 'free') {
      return {
        productId: undefined,
        areaId: item.areaId,
        productName: item.customLabel.trim() || 'Item avulso',
        productType: 'Avulso',
        quantity: '1',
        unitBrl: parseCurrencyToCents(item.unitBrl),
      };
    }
    const product = selectedProduct(item);
    return {
      productId: product?.id,
      areaId: product?.areaId ?? undefined,
      productName: saleItemDisplayName(item),
      productType: product?.type ?? 'SaaS',
      quantity: item.quantity,
      unitBrl: parseCurrencyToCents(item.unitBrl),
    };
  }),
  professionals: professionals.map((professional) => ({ ...unchanged... })),
};
return buildSalePayload(draft);
```
Free-form rows therefore reach the API as `productId` absent, `productName` = description, `areaId` picked, per the overview 2026-07-14 name-snapshot decision.
In edit mode the draft additionally carries `recurring.method` from the prefill (see Edit support step E6); in create mode `recurring.method` is omitted and the API defaults it to `pix`.

## Edit support (the mechanism slice 07's "Editar" row action plugs into)

This section amends Steps 3, 4, 8, and 12 and is part of this slice's scope.
It implements exactly the contract slice 07 section 6.4 states: `SaleWizardDialog` accepts `editSale: SalesOpsSale | null`, prefills from `editSale` plus `bootstrap.saleItems` and `bootstrap.receivables`, and submits through a PUT-based update mutation.
This plan adopts slice 07's names verbatim (`SaleWizardRequest`, `saleWizard`, `setSaleWizard`, `editSale`), so slice 07 needs no renaming and only adds the row action that calls `setSaleWizard({ mode: 'edit', sale })`.

### E1. Bootstrap plumbing for receivables and sale professionals

The PUT endpoint fully replaces items, professionals, and receivables (slice 03 updateSale step 6), so the wizard must be able to reconstruct and resubmit all three or an edit would silently wipe them.
Plan-check update (2026-07-29): both `receivables` and `saleProfessionals` are backend-side bootstrap additions now owned entirely by slice 03 (`getSalesOpsSnapshot` gains both queries there), specifically so no wave containing this slice ever touches `apps/api/src/domains/sales-ops/service.ts` at the same time as slice 04 - this slice makes NO backend change and does not list `apps/api/src/domains/sales-ops/service.ts` in `files_modified`.
Before starting, verify `snapshot.saleProfessionals` is present in slice 03's shipped bootstrap; if slice 03 did not land it, stop and escalate rather than adding the backend query here.
On the web side (this slice's actual scope):
- `emptyBootstrap` in `SalesOpsApp.tsx` (~line 101) gains `receivables: []` and `saleProfessionals: []` (plus `areas: []` if slice 05 has not already added it).
- The `useSalesOpsBootstrap` select guard in `apps/web/src/sales-ops/hooks.ts` gains `receivables: Array.isArray(data.receivables) ? data.receivables : []` and `saleProfessionals: Array.isArray(data.saleProfessionals) ? data.saleProfessionals : []` (plus the `areas` guard if slice 05 has not already added it).

### E2. api.ts: updateSale

Add to `salesOpsApi` in `apps/web/src/sales-ops/api.ts`, right after `createSale`:
```ts
updateSale: (saleId: string, payload: CreateSalePayload, token: Token) =>
  apiFetch<{ sale: unknown; ledger: unknown }>(`/api/v1/sales-ops/sales/${saleId}`, {
    method: 'PUT',
    token,
    body: JSON.stringify(payload),
  }),
```
The endpoint is slice 03's `PUT /api/v1/sales-ops/sales/:id` with full-replace semantics; it returns 409 `not_editable` when the sale is `won|lost|cancelled` and caps status at `draft|open`.

### E3. hooks.ts: useUpdateSalesOpsSale

Add to `apps/web/src/sales-ops/hooks.ts`, following the exact pattern of `useCreateSalesOpsSale` (shared `useInvalidateSalesOps` invalidation):
```ts
export function useUpdateSalesOpsSale() {
  const { getToken } = useAccessToken();
  const invalidate = useInvalidateSalesOps();
  return useMutation({
    mutationFn: async ({ saleId, payload }: { saleId: string; payload: CreateSalePayload }) =>
      salesOpsApi.updateSale(saleId, payload, await requireToken(getToken)),
    onSuccess: () => {
      void invalidate();
    },
  });
}
```

### E4. SalesOpsApp wiring: SaleWizardRequest union (replaces the boolean)

Replace `const [saleWizardOpen, setSaleWizardOpen] = useState(false)` with slice 07's exact shape:
```ts
type SaleWizardRequest = { mode: 'create' } | { mode: 'edit'; sale: SalesOpsSale };
const [saleWizard, setSaleWizard] = useState<SaleWizardRequest | null>(null);
```
Every `setSaleWizardOpen(true)` call site (sidebar CTA, `runHeaderAction` fallback) becomes `setSaleWizard({ mode: 'create' })`, and every close becomes `setSaleWizard(null)`.
Add `const updateSale = useUpdateSalesOpsSale();` next to the existing `createSale` mutation.
The dialog wiring becomes:
```jsx
<SaleWizardDialog
  bootstrap={bootstrap}
  editSale={saleWizard?.mode === 'edit' ? saleWizard.sale : null}
  onClose={() => setSaleWizard(null)}
  onSave={(payload) => {
    if (saleWizard?.mode === 'edit') {
      updateSale.mutate(
        { saleId: saleWizard.sale.id, payload },
        { onSuccess: () => setSaleWizard(null) },
      );
    } else {
      createSale.mutate(payload, { onSuccess: () => setSaleWizard(null) });
    }
  }}
  open={saleWizard !== null}
  saving={createSale.isPending || updateSale.isPending}
/>
```
No UI in this slice sets `mode: 'edit'`; the entry point is slice 07's row action, and this slice proves the mechanism through component tests that pass `editSale` directly.

### E5. SaleWizardDialog prop and remount key

`SaleWizardDialog` props gain `editSale: SalesOpsSale | null`, threaded into `SaleWizardDialogBody`.
Statuses that allow editing are `draft` and `open` only; guard at the shell so a non-editable sale can never render an editable wizard:
```ts
if (!props.open) return null;
if (props.editSale && props.editSale.status !== 'draft' && props.editSale.status !== 'open') return null;
```
Extend the remount key so state never leaks between an edit and the next create (slice 07 section 6.4 pins this suffix):
```ts
key={`${props.editSale?.id ?? 'create'}-${...existing key parts...}`}
```
The remount also guarantees `wizardStep` restarts at 1 for every open.

### E6. Prefill derivation inside SaleWizardDialogBody

Add a module-level pure helper directly above `SaleWizardDialogBody` (module-level so the initializer logic is inspectable and unit-testable through the component tests):
```ts
type WizardPrefill = {
  clientId: string;
  clientName: string;
  sellerPersonId: string;
  finderVisible: boolean;
  sellerIsFinder: boolean;
  finderPersonId: string;
  baseDate: string;
  notes: string;
  sellerCommissionPct: string;
  finderCommissionPct: string;
  taxPct: string;
  otherCostsBrl: string;
  items: SaleItemForm[];
  professionals: ProfessionalForm[];
  installmentRows: InstallmentRowForm[];
  recurringEnabled: boolean;
  recurringMonthlyBrl: string;
  recurringStartDate: string;
  recurringCycles: string;
  recurringIndefinite: boolean;
  recurringMethod: PaymentMethod;
};

function deriveWizardPrefill(sale: SalesOpsSale, bootstrap: SalesOpsBootstrap): WizardPrefill {
  const receivables = bootstrap.receivables
    .filter((row) => row.saleId === sale.id && row.status !== 'void')
    .sort(
      (a, b) =>
        a.dueDate.slice(0, 10).localeCompare(b.dueDate.slice(0, 10)) ||
        (a.label ?? '').localeCompare(b.label ?? ''),
    );
  const recurringRows = receivables.filter((row) => (row.label ?? '').startsWith('M'));
  const installmentReceivables = receivables.filter((row) => !(row.label ?? '').startsWith('M'));
  const items: SaleItemForm[] = bootstrap.saleItems
    .filter((item) => item.saleId === sale.id)
    .map((item) => {
      if (!item.productId) {
        return {
          kind: 'free' as const,
          productId: '',
          areaId: item.areaId ?? '',
          customLabel: item.productNameSnapshot,
          quantity: '1',
          unitBrl: centsToInput(item.unitBrl),
        };
      }
      const product = bootstrap.products.find((candidate) => candidate.id === item.productId);
      return {
        kind: 'product' as const,
        productId: item.productId,
        areaId: '',
        customLabel:
          product?.openPrice && item.productNameSnapshot !== product.name
            ? item.productNameSnapshot
            : '',
        quantity: String(item.quantity),
        unitBrl: centsToInput(item.unitBrl),
      };
    });
  const hasRecurring = sale.recurringBrl > 0;
  const bounded = hasRecurring && recurringRows.length > 0;
  return {
    clientId: sale.clientId ?? '',
    clientName: sale.clientNameSnapshot,
    sellerPersonId: sale.sellerPersonId ?? '',
    finderVisible: Boolean(sale.finderPersonId || sale.finderNameSnapshot),
    sellerIsFinder: Boolean(sale.finderPersonId && sale.finderPersonId === sale.sellerPersonId),
    finderPersonId: sale.finderPersonId ?? '',
    baseDate: sale.baseDate.slice(0, 10),
    notes: sale.notes ?? '',
    sellerCommissionPct: pctToInput(sale.sellerCommissionPct),
    finderCommissionPct: pctToInput(sale.finderCommissionPct),
    taxPct: pctToInput(sale.taxPct),
    otherCostsBrl: centsToInput(sale.otherCostsBrl),
    items,
    professionals: bootstrap.saleProfessionals
      .filter((row) => row.saleId === sale.id)
      .map((row) => ({
        personId: row.personId ?? '',
        personName: row.personNameSnapshot,
        role: row.role,
        costBrl: centsToInput(row.costBrl),
      })),
    installmentRows: installmentReceivables.map((row) => ({
      dueDate: row.dueDate.slice(0, 10),
      amountBrl: centsToInput(row.amountBrl),
      method: row.method,
    })),
    recurringEnabled: hasRecurring,
    recurringMonthlyBrl: centsToInput(sale.recurringBrl),
    recurringStartDate: bounded
      ? recurringRows[0]!.dueDate.slice(0, 10)
      : addMonthsToIsoDate(sale.baseDate.slice(0, 10), 1),
    recurringCycles: bounded ? String(recurringRows.length) : '12',
    recurringIndefinite: hasRecurring && !bounded,
    recurringMethod: bounded ? recurringRows[0]!.method : 'pix',
  };
}
```
Inside `SaleWizardDialogBody`, compute once per mount (the remount key makes mount-time evaluation correct):
```ts
const prefill = editSale ? deriveWizardPrefill(editSale, bootstrap) : null;
```
Every existing `useState` initializer becomes prefill-aware, keeping the current create defaults as the fallback, for example `useState(prefill?.clientName ?? firstClient?.name ?? '')`, `useState<SaleItemForm[]>(() => prefill?.items ?? <existing seed>)`, `useState(prefill?.notes ?? '')`, and likewise for every field in `WizardPrefill`.
Add the silent `recurringMethod` state: `const [recurringMethod] = useState<PaymentMethod>(prefill?.recurringMethod ?? 'pix');` (no setter is needed because no UI edits it), and pass it into the draft's `recurring.method`.
Anti-clobber guards for the render-time sync blocks:
- `commissionDefaultsSource` initializes from the prefilled inputs so the sync does not fire on the first edit render: `useState(() => commissionDefaultsSourceKey(prefilledPrimaryProduct, prefilledHasFinder, bootstrap.settings))`, where `prefilledPrimaryProduct` is the product of the first prefilled item and `prefilledHasFinder = Boolean(prefill ? prefill.finderVisible && (prefill.sellerIsFinder || prefill.finderPersonId) : false)`.
- `planAuto` initializes to `!prefill || prefill.installmentRows.length === 0` so a prefilled plan is never regenerated, while a legacy sale with no receivable rows still gets the auto single-row plan.
- `recurringSource` initializes to the mount-time key `JSON.stringify([prefilledPrimaryProduct?.id, prefilledPrimaryProduct?.hasMonthly, prefilledPrimaryProduct?.monthlyBrl])` when `prefill` exists, and to `''` otherwise, so the recurring suggestion sync never overwrites the reconstructed recurring block on the first edit render.
Known accepted edge: if a prefilled item references a product that no longer exists in the catalog, `selectedProduct` falls back to `firstProduct` exactly as the create flow already does for stale ids.

### E7. Submit branch and edit-mode chrome

`submit` keeps its signature and gains the status guard the coordinator contract requires even though the shell already blocks non-editable sales:
```ts
function submit(status: 'draft' | 'open') {
  if (!canSave) return;
  if (editSale && editSale.status !== 'draft' && editSale.status !== 'open') return;
  onSave(createPayload(status));
}
```
The dialog body never chooses create vs update; `onSave` bubbles the payload and the `SalesOpsApp` wiring from E4 picks `createSale.mutate` or `updateSale.mutate({ saleId, payload })`.
`DialogTitle` becomes the ternary `{editSale ? 'Editar proposta' : 'Nova proposta'}` (amends Step 8 item 5); the description stays the same in both modes.
Footer amendment to Step 12: the `Salvar rascunho` button renders only when `!editSale || editSale.status === 'draft'`, because demoting an open proposta back to draft is a slice 07 transition concern, not a wizard edit concern; when it renders during an edit it submits `status: 'draft'` (keeping the draft a draft), and the step 4 primary `Salvar proposta` submits `status: 'open'` in both modes (which is exactly how editing promotes a draft to open).

## Step 14: exact copy string inventory (pt-BR, hardcoded)

New or changed strings, verbatim:
- `Nova proposta` (dialog title in create mode, sidebar CTA, header CTA fallback).
- `Editar proposta` (dialog title in edit mode).
- `Cliente, itens, pagamento e custos - salve como rascunho a qualquer momento` (dialog description).
- Step labels: `Proposta`, `Pagamento`, `Custos e margem`, `Revisão`.
- `Essa proposta teve um finder`.
- `Data da proposta`.
- `+ item avulso`.
- `Cadastre áreas em Cadastros > Áreas` (disabled title).
- `Sem área` (chip), `Defina a área deste produto em Cadastros > Produtos.`.
- `Descrição do item`, `Ex.: Consultoria de processos`, `Item avulso - informe a área, a descrição e o valor`.
- `Selecione a área deste item.`, `Informe a descrição deste item avulso.`.
- `Notas internas sobre a proposta...`, `Total da proposta`.
- `Plano de pagamento`, `Dividir em`, `Dividir`, `+ parcela`, `Soma das parcelas`.
- `A soma das parcelas precisa ser igual ao total da proposta. Diferença: ` (plus the formatted amount).
- `Recorrência`, `Adicionar recorrência`, `Mensalidade (R$)`, `Início`, `Nº de ciclos`, `Prazo indeterminado`.
- `Sem parcelas futuras geradas agora - a mensalidade entra como receita recorrente (MRR).`.
- `Informe uma mensalidade maior que zero.`, `Informe o número de ciclos ou marque prazo indeterminado.`.
- `Esta é uma previsão - nada é lançado no financeiro até a proposta ser marcada como Ganha.`.
- `Dados da proposta`, `Previsão de contas a pagar`, `Estes lançamentos serão gerados quando a proposta for marcada como Ganha.`, `Total previsto`.
- `Passo {wizardStep} de 4`, `Salvar rascunho`, `Salvar como rascunho para terminar depois`, `Salvar proposta`.
- `Cadastre pelo menos um produto e um vendedor para registrar uma proposta.`.
- `Use o botão Nova proposta para registrar a primeira proposta.`.
- statusMeta labels: `Aberta`, `Ganha`, `Perdida`.
Strings that must no longer exist anywhere in the file: `Fechamento da venda`, `Nova venda`, `Salvar incompleto`, `Confirmar venda`, `Registro da venda`, `Pagamento e recebimento`, `Essa venda teve um finder`, `Total da venda`, `Dados da venda`, `Contas a pagar geradas`, `Passo {wizardStep} de 3`, `Cliente, itens e pagamento - só o primeiro passo é obrigatório`.
Unchanged strings that stay verbatim (contract-relevant): `Cadastrar produto`, `+ item`, `Avançar`, `Voltar`, `Parcelas a receber` is removed with the step 1 table (do not re-add), aria-labels `Produto / serviço do item N`, `Quantidade do item N`, `Valor unitário do item N`, `Nome / descrição do item N`, `Remover item N`.

## Step 15: test updates (never delete a contract test)

### 15a. `apps/web/src/sales-ops/__tests__/sale-wizard-ui-contract.test.ts`

Rewrite the assertion body to the new copy, keeping the source-grep mechanism:
```ts
expect(source).toContain('Nova proposta');
expect(source).toContain('Editar proposta');
expect(source).toContain('Cliente, itens, pagamento e custos - salve como rascunho a qualquer momento');
expect(source).toContain("label: 'Proposta'");
expect(source).toContain("label: 'Pagamento'");
expect(source).toContain('Custos e margem');
expect(source).toContain('Revisão');
expect(source).toContain('Essa proposta teve um finder');
expect(source).toContain('Cadastrar produto');
expect(source).toContain('+ item avulso');
expect(source).toContain('Plano de pagamento');
expect(source).toContain('Dividir em');
expect(source).toContain('A soma das parcelas precisa ser igual ao total da proposta.');
expect(source).toContain('Adicionar recorrência');
expect(source).toContain('Prazo indeterminado');
expect(source).toContain('Previsão de contas a pagar');
expect(source).toContain('Passo {wizardStep} de 4');
expect(source).toContain('Avançar');
expect(source).toContain('Salvar proposta');
expect(source).toContain('Salvar rascunho');
expect(source).not.toContain('Fechamento da venda');
expect(source).not.toContain('Nova venda');
expect(source).not.toContain('Salvar incompleto');
expect(source).not.toContain('Confirmar venda');
expect(source).not.toContain('Passo {wizardStep} de 3');
expect(source).not.toContain('Salvar venda');
```
Rename the `it` description to `keeps the proposal dialog aligned with the Nova proposta wizard shell`.

### 15b. Shared fixture updates for all wizard component tests

In `sale-wizard-commission-defaults.test.tsx`, `sale-wizard-custom-item-labels.test.tsx`, and the three new files:
- Add `areas` to the bootstrap fixture: one active area `{ id: '66666666-6666-4666-8666-666666666666', orgId: 'org-test', name: 'FXL Tech', status: 'active', createdAt: <fixture date>, updatedAt: null }` (the free-items and edit files add a second area `77777777-7777-4777-8777-777777777777` named `FXL Advisor`).
- Add `receivables: []` and `saleProfessionals: []` to every bootstrap fixture (the edit file populates them; see 15h).
- Set `areaId: '66666666-6666-4666-8666-666666666666'` on every product fixture (the product factory gains an `areaId` field).
- Pass `editSale={null}` wherever `SaleWizardDialog` is rendered outside the edit file.

### 15c. `sale-wizard-commission-defaults.test.tsx`

- Replace every `buttonByText('Essa venda teve um finder')` with `buttonByText('Essa proposta teve um finder')`.
- Replace every `buttonByText('Salvar incompleto')` with `buttonByText('Salvar rascunho')`.
- Commission fields now live on step 3: everywhere the test clicked `Avançar` once to reach them, click it twice (`Avançar`, `Avançar`); everywhere it clicked `Voltar` once to return to step 1, click it twice.
- The auto plan keeps the parcela sum equal to the total in these tests (no manual plan edits), so step 2 never blocks.
- Payload expectations keep `sellerCommissionPct`/`finderCommissionPct`/`finderPersonId` assertions unchanged, and add one structural assertion on the first save: `expect(onSave.mock.lastCall?.[0].installments).toHaveLength(1);`.

### 15d. `sale-wizard-custom-item-labels.test.tsx`

- `Confirmar venda` becomes `Salvar proposta`; expected submitted status `'closed'` becomes `'open'`.
- `Salvar incompleto` becomes `Salvar rascunho`.
- Review is now reached with three `Avançar` clicks; after the first expect `Plano de pagamento`, after the second expect `Custos e margem`, after the third expect the review content (`Módulo Vendas, Módulo RH`).
- The blocked-advance test asserts the wizard stays on step 1 via `expect(container.textContent).toContain('Cliente e responsáveis')` instead of `Registro da venda`.
- The draft fallback test keeps asserting `productName: 'FXL Custom'` with `status: 'draft'` and additionally asserts `areaId: '66666666-6666-4666-8666-666666666666'` on the item.
- All `Nome / descrição do item N`, `Valor unitário do item N`, `Quantidade do item N`, and `Remover item N` aria-label queries stay byte-identical (product-row labels do not change).

### 15e. New `apps/web/src/sales-ops/__tests__/sale-wizard-payment-plan.test.tsx`

Same harness (happy-dom, dialog mock, `act`, `buttonByText`, `labeledInput`, `changeInput` helpers) copied from `sale-wizard-custom-item-labels.test.tsx`.
Fixture: one fixed-price product (`openPrice: false`, `setupBrl: 250000`, `areaId` set) plus one recurring product (`hasMonthly: true`, `monthlyBrl: 100000`, `setupBrl: 100000`, `areaId` set), one client, one seller, one area.
Tests:
1. `splits the plan into N equal monthly parcelas with the remainder on the last`: advance to step 2, set `Número de parcelas` to `3`, click `Dividir`; expect `Valor da parcela 1` = `833.33`, `Valor da parcela 2` = `833.33`, `Valor da parcela 3` = `833.34`, and `Vencimento da parcela 2` one month after `Vencimento da parcela 1`; click `Avançar` and expect `Custos e margem`.
2. `blocks advancing while the parcelas do not sum to the total`: on step 2, change `Valor da parcela 1` to `100`; expect the message `A soma das parcelas precisa ser igual ao total da proposta.` to appear; click `Avançar` and expect the content still shows `Plano de pagamento` and not `Custos e margem`; restore the value to `2500` and expect the message gone, then `Avançar` reaches `Custos e margem`.
3. `prefills and submits the recurring block for a mensalidade product`: switch the item product to the recurring product, advance to step 2, expect `Valor da mensalidade` prefilled with `1000`; click the `Prazo indeterminado` toggle; advance to step 4 and click `Salvar proposta`; expect `onSave` called with `expect.objectContaining({ status: 'open', recurring: { monthlyBrl: 100000, startDate: expect.any(String), cycles: null } })` and `installments` an array of one row summing to the product setup.
4. `submits the edited plan rows with per-parcela method and date`: on step 2 apply `Dividir` into 2, change `Forma de pagamento da parcela 2` to `boleto`, advance and save; expect `payload.installments` to equal two rows with `method: 'pix'` and `method: 'boleto'` and amounts `125000` and `125000`.

### 15f. New `apps/web/src/sales-ops/__tests__/sale-wizard-free-items.test.tsx`

Same harness; fixture with one fixed-price product (`areaId` set), two areas, one client, one seller.
Tests:
1. `adds a free-form item and submits it without productId`: click `+ item avulso`; select area two via `Área do item 2`; fill `Descrição do item 2` with `Consultoria de processos` and `Valor unitário do item 2` with `5000`; advance three times and click `Salvar proposta`; expect the second submitted item to match `expect.objectContaining({ areaId: '77777777-7777-4777-8777-777777777777', productName: 'Consultoria de processos', productType: 'Avulso', quantity: 1, unitBrl: 500000 })` and `payload.items[1].productId` to be `undefined`.
2. `blocks advance until the free row has description and value`: add a free row, click `Avançar`; expect `Informe a descrição deste item avulso.` and `Informe um valor negociado maior que zero.` in the DOM and step 1 still visible (`Cliente e responsáveis`); fill both and expect `Avançar` to reach `Plano de pagamento`.
3. `blocks advance when a product has no área`: render with a product fixture whose `areaId` is `null`; click `Avançar`; expect `Defina a área deste produto em Cadastros > Produtos.` and step 1 still visible.

### 15g. `apps/web/src/sales-ops/__tests__/calculations.test.ts`

- Update the `buildSalePayload` test draft to the new `SaleDraft` shape: `installments: [{ dueDate: '2026-07-10', amountBrl: 400000, method: 'pix' }, { dueDate: '2026-08-10', amountBrl: '400000', method: 'boleto' }]`, `recurring: { monthlyBrl: '100000', startDate: '2026-08-10', cycles: null }`, and item `areaId: '66666666-6666-4666-8666-666666666666'`; assert the payload floors amounts to `400000`/`400000`, preserves `method` per row, keeps `cycles: null`, and passes `areaId` through.
- Add `it('splits a total into equal monthly installments with the remainder on the last row')`: `splitInstallmentsEqually(250000, 3, '2026-07-10', 'boleto')` equals `[{ dueDate: '2026-07-10', amountBrl: 83333, method: 'boleto' }, { dueDate: '2026-08-10', amountBrl: 83333, method: 'boleto' }, { dueDate: '2026-09-10', amountBrl: 83334, method: 'boleto' }]`; also `splitInstallmentsEqually(100, 1, '2026-07-10', 'pix')` equals a single full row, and a `count` of `0` clamps to one row.
- Add `it('rolls month-end split dates forward like native Date arithmetic')`: `splitInstallmentsEqually(300, 2, '2026-01-31', 'pix')[1]!.dueDate` equals `'2026-03-03'` (documenting JS Date rollover as the pinned behavior).
- Add `it('sums installment rows from mixed string and numeric inputs')`: `installmentSumCents([{ amountBrl: '8.000,00' }, { amountBrl: 250000 }, { amountBrl: '833.34' }])` equals `800000 + 250000 + 83334`.
- Add `it('normalizes a free-form item without productId')`: draft item `{ productName: 'Consultoria', productType: 'Avulso', areaId: 'x', quantity: '1', unitBrl: 500000 }` produces `productId: undefined` and `areaId: 'x'`.
- Extend the recurring `buildSalePayload` assertion to cover the method passthrough: a draft `recurring` with `method: 'boleto'` keeps `method: 'boleto'`, and one without `method` produces `method: 'pix'`.

### 15h. New `apps/web/src/sales-ops/__tests__/sale-wizard-edit.test.tsx`

Same harness as 15e (happy-dom, dialog mock, `act`, `buttonByText`, `labeledInput`, `fieldInput`, `changeInput` helpers).
Fixture: bootstrap with one fixed-price product (`id` `22222222-2222-4222-8222-222222222222`, `setupBrl: 250000`, `areaId` area one), the two areas from 15b, one client, one seller, one finder person, and an existing sale `editSale`:
```ts
const editSale: SalesOpsSale = {
  id: '88888888-8888-4888-8888-888888888888',
  status: 'open',
  clientId: <client id>, clientNameSnapshot: 'SegPro',
  sellerPersonId: <seller id>, sellerNameSnapshot: 'Ana Martins',
  finderPersonId: null, finderNameSnapshot: null,
  baseDate: '2026-07-10', notes: 'nota interna',
  totalBrl: 300000, recurringBrl: 100000,
  sellerCommissionPct: '8', finderCommissionPct: '0', taxPct: '6',
  otherCostsBrl: 30000, professionalCostsBrl: 50000,
  ...remaining SalesOpsSale fields with plausible zero/fixture values...
};
```
Bootstrap children for that sale id:
- `saleItems`: one product item (`productId` set, `quantity: 1`, `unitBrl: 250000`, `productNameSnapshot` = catalog name) and one free item (`productId: null`, `areaId` area two, `productNameSnapshot: 'Consultoria de processos'`, `quantity: 1`, `unitBrl: 50000`).
- `receivables`: `{label: '1/2', dueDate: '2026-07-10', amountBrl: 150000, method: 'pix', status: 'open'}`, `{label: '2/2', dueDate: '2026-08-10', amountBrl: 150000, method: 'boleto', status: 'open'}`, `{label: 'M1/2', dueDate: '2026-08-10', amountBrl: 100000, method: 'boleto', status: 'open'}`, `{label: 'M2/2', dueDate: '2026-09-10', amountBrl: 100000, method: 'boleto', status: 'open'}`.
- `saleProfessionals`: one row `{personId: null, personNameSnapshot: 'Dev Externo', role: 'Operacional', costBrl: 50000}`.
Render `SaleWizardDialog` with `editSale={editSale}`.
Named tests:
1. `prefills every step from the existing proposta`: asserts the title text `Editar proposta`; client input value `SegPro`; `Valor unitário do item 1` is `2500`; `Descrição do item 2` is `Consultoria de processos` with `Área do item 2` set to area two; one `Avançar` reaches `Plano de pagamento` with `Valor da parcela 1` `1500`, `Valor da parcela 2` `1500`, `Forma de pagamento da parcela 2` `boleto`, `Valor da mensalidade` `1000`, `Número de ciclos` `2`; a second `Avançar` reaches `Custos e margem` with `Comissão vendedor %` still `8` (proving the commission defaults sync did not clobber the sale value) and the professional row `Dev Externo` with cost `500`.
2. `submits the reconstructed update payload with status open`: advances to step 4 and clicks `Salvar proposta`; expects `onSave` called with `expect.objectContaining({ status: 'open', notes: 'nota interna', otherCostsBrl: 30000, installments: [{ dueDate: '2026-07-10', amountBrl: 150000, method: 'pix' }, { dueDate: '2026-08-10', amountBrl: 150000, method: 'boleto' }], recurring: { monthlyBrl: 100000, startDate: '2026-08-10', cycles: 2, method: 'boleto' } })`, `payload.items[1]` matching `expect.objectContaining({ areaId: '77777777-7777-4777-8777-777777777777', productName: 'Consultoria de processos' })` with `payload.items[1].productId` undefined, and `payload.professionals` equal to `[{ personId: undefined, personName: 'Dev Externo', role: 'Operacional', costBrl: 50000 }]`.
3. `hides Salvar rascunho when editing an open proposta`: asserts no button with text `Salvar rascunho` exists for the `open` fixture, then re-renders with `{...editSale, status: 'draft'}` and asserts the button exists and submitting it yields `status: 'draft'`.
4. `keeps the prefilled plan when the total changes mid-edit`: changes `Quantidade do item 1` to `2` (total now 550000), advances to step 2, asserts the two parcela inputs still read `1500` (planAuto stayed false) and the mismatch message `A soma das parcelas precisa ser igual ao total da proposta.` is shown, and `Avançar` does not leave `Plano de pagamento`.

## Verification

Run, in order, from the repo root:
1. `pnpm run lint`.
2. `pnpm run type-check`.
3. `pnpm test`.
4. `pnpm run build`.
This slice makes no API change, so `pnpm --filter @fxl-sales/api test:integration` is not part of this slice's verification (it was already required at slice 03's wave boundary).
All four must pass with zero new warnings.
The named oracle tests for this slice are `apps/web/src/sales-ops/__tests__/sale-wizard-payment-plan.test.tsx`, `apps/web/src/sales-ops/__tests__/sale-wizard-free-items.test.tsx`, `apps/web/src/sales-ops/__tests__/sale-wizard-edit.test.tsx`, the rewritten `apps/web/src/sales-ops/__tests__/sale-wizard-ui-contract.test.ts`, plus the updated `sale-wizard-commission-defaults.test.tsx`, `sale-wizard-custom-item-labels.test.tsx`, and `calculations.test.ts`.

## Out of scope (owned by other slices)

- Propostas list table, filters, row actions (including the `Editar` action that calls `setSaleWizard({ mode: 'edit', sale })`), detail drawer, dashboard KPI copy, `closedStatuses` sweep, and removal of legacy statuses: slice 07.
- Areas CRUD page, product dialog área select, ProductsView column: slice 05.
- Any API or database change, including the `getSalesOpsSnapshot` `receivables`/`saleProfessionals` bootstrap additions (both owned by slice 03): slices 01 to 04.
- Client legal fields: slice 08.
