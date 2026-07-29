---
id: 12-proposta-overrides
milestone: v2.3.0
status: todo
depends_on: [07-produtos-servicos-api, 11-payment-plan-builder]
files_modified:
  - packages/shared-utils/src/sale-financials.ts
  - packages/shared-utils/src/index.ts
  - packages/shared-utils/src/__tests__/sale-financials.test.ts
  - apps/api/src/db/schema.ts
  - apps/api/drizzle/0014_sale_professional_funcoes.sql
  - apps/api/drizzle/meta/_journal.json
  - apps/api/src/domains/sales-ops/service.ts
  - apps/api/src/domains/sales-ops/__tests__/sale-professional-funcoes.test.ts
  - apps/api/src/domains/sales-ops/__tests__/sale-margin-parity.test.ts
  - apps/api/test/rls/sale-professional-funcoes.test.ts
  - apps/web/src/sales-ops/types.ts
  - apps/web/src/sales-ops/calculations.ts
  - apps/web/src/sales-ops/SalesOpsApp.tsx
  - apps/web/src/sales-ops/__tests__/sale-wizard-overrides.test.tsx
  - apps/web/src/sales-ops/__tests__/sale-wizard-funcao-costs.test.tsx
  - apps/web/src/sales-ops/__tests__/sale-margin-parity.test.ts
  - apps/web/src/sales-ops/__tests__/sale-wizard-edit.test.tsx
  - apps/web/src/sales-ops/__tests__/sale-wizard-ui-contract.test.ts
  - apps/web/src/sales-ops/__tests__/calculations.test.ts
acceptance: "Given a product whose cadastro declares seller 7%, finder 3%, a Desenvolvedor default of 5% and a Testador default of R$ 300,00, when the operator opens a proposta with a R$ 20.000,00 item of that product, hand-types 15 into Comissão vendedor %, allocates a pessoa from the Pessoas registry with the função Desenvolvedor and a second with Testador, then switches the primary item to another product and saves, then the seller percentage stays 15 with an Alterado manualmente marker while the untouched finder percentage re-applies the new product default, the Desenvolvedor cost prefilled as R$ 1.000,00 and the Testador cost as R$ 300,00 with their derivation shown, the persisted rows carry funcao_id plus a server-derived funcao_name_snapshot, a funcaoId or personId from another org is rejected with 400 validation_error before any write, reopening the proposta for edit prefills every stored override unchanged and a mid-edit product change does not clobber any of them, the Margem líquida shown in Custos e margem and Revisão equals the netMarginBrl the API persists, and marking the proposta Ganha generates professional_cost payables whose amounts equal the overridden per-row costs."
---

# 12 - Overrides de proposta: percentuais, custos e profissionais alocados por função

## Goal

Make the cadastro a genuine default rather than a constraint: every commercial number a Produto/Serviço supplies (comissão do vendedor, comissão do finder, imposto, outros custos, and the new per-função cost defaults) becomes overridable inside a single proposta, a hand-typed value is pinned so no later product change or reload silently clobbers it, and the `Profissionais alocados` block stops being free text by picking a pessoa from the Pessoas registry and a função from the Funções registry with a cost prefilled from the chosen product's default for that função.
The slice also closes the one correctness hole that overrides expose: the wizard's margin arithmetic and the server's persisted `net_margin_brl` are computed by two independent implementations that already disagree, so an overridden percentage would display one number and save another.
Both sides are rewired onto one pure `computeSaleFinancials` in `packages/shared-utils`, which both `apps/api` and `apps/web` already depend on.

## Current state

### What is already overridable, honestly

The schema is not the gap.
`salesOpsSales` (`apps/api/src/db/schema.ts:551-591`) already carries the per-proposta overrides as first-class columns:

- `sellerCommissionPct numeric(5,2)` (`:574`), `finderCommissionPct numeric(5,2)` (`:575`), `taxPct numeric(5,2)` (`:576`)
- `otherCostsBrl integer` (`:577`), `professionalCostsBrl integer` (`:578`)
- the computed `sellerCommissionBrl` (`:579`), `finderCommissionBrl` (`:580`), `taxBrl` (`:581`), `netMarginBrl` (`:582`), `netMarginPct numeric(8,2)` (`:583`)

The write path accepts all of them per proposta: `SaleWriteBaseSchema` (`apps/api/src/domains/sales-ops/service.ts:179-197`) takes `sellerCommissionPct`, `finderCommissionPct`, `taxPct`, `otherCostsBrl` and a `professionals[]` array, and `buildSaleLedger` (`:346-454`) writes exactly what it was given.
The wizard already renders four editable inputs for them in step 3 (`apps/web/src/sales-ops/SalesOpsApp.tsx:4916-4943`: `Outros custos (R$)`, `Comissão vendedor %`, `Comissão finder %`, `Imposto %`) and an editable `CUSTO ALOCADO` per professional (`:4886-4898`).
So "the % of the seller, the finder, and the costs" are, field by field, already editable.

The real gap for item 8 is therefore **not** a read-only field.
It is three distinct defects, each with evidence:

**Gap 1 - a manual edit is silently clobbered.**
`SalesOpsApp.tsx:3772-3781` runs during render:

```
if (commissionDefaultsSource !== currentCommissionDefaultsSource) {
  const defaults = resolveSaleCommissionDefaults(primaryItemProduct, hasFinderForSale, bootstrap.settings);
  setCommissionDefaultsSource(currentCommissionDefaultsSource);
  setSellerCommissionPct(String(defaults.sellerCommissionPct));
  setFinderCommissionPct(String(defaults.finderCommissionPct));
}
```

`commissionDefaultsSourceKey` (`:3513-3530`) hashes the primary product id, its six commission fields, `hasFinder`, and the two org settings defaults.
Any change to any of those unconditionally overwrites both percentage inputs, with no knowledge of whether a human typed the current value.
Concretely: type `15` into `Comissão vendedor %`, go back to step 1, change the primary product, and the `15` is gone.
`taxPct` and `otherCostsBrl` have no re-apply path at all (`:3701`, `:3713` initialise once), so they are accidentally pin-safe today rather than deliberately so.

**Gap 2 - per-função cost defaults are not represented anywhere in a proposta.**
The product's only cost-ish configuration today is `salesOpsProducts.providers` jsonb (`apps/api/src/db/schema.ts:495`, `ProductProviderSchema` at `service.ts:58-62`: `{ personName, commissionType, commissionValue }`).
It is edited in the product dialog (`SalesOpsApp.tsx:3007-3084`) and read by **nothing else**: `grep -rn providers apps/web/src` returns only `types.ts:51`, the product-form block at `:2419-3084`, and test fixtures.
The wizard never reads it.
There is no função dimension on it at all, only a free-text `personName`, so "the Developer função earns 5% of the product and the Tester a fixed R$ 300,00" cannot be expressed, let alone prefilled.

**Gap 3 - `Profissionais alocados` is free text, twice over.**
`SalesOpsApp.tsx:4850-4874` is the `PROFISSIONAL` picker: a `NativeSelect` whose first option is literally `<option value="">Digite manualmente</option>` and whose remaining options come from the `collaborators` memo (`:3676-3679`, `person.isCollaborator && person.status === 'active'`).
Choosing the empty option leaves `personId: ''` and a free-text `personName`.
`FUNÇÃO NO PROJETO` (`:4875-4885`) is a bare `Input` bound to `professional.role`, seeded with the hardcoded literal `'Operacional'` when a row is added (`:4823`).
The storage matches: `salesOpsSaleProfessionals` (`apps/api/src/db/schema.ts:613-627`) has `personId uuid` (nullable FK), `personNameSnapshot text`, `role text NOT NULL` free text, `costBrl integer`.
There is no `funcaoId`.

**Gap 4 (not in the brief, found while auditing, and in scope because overrides make it visible) - the wizard's margin and the persisted margin are two different numbers.**
Client, `SalesOpsApp.tsx:3784-3787` and `:3849-3861`:

- `totalCents` = `Σ quantity × unitBrl` over items only.
- `sellerCommissionCents = Math.floor((totalCents × pct) / 100)`, one rounding over the item total.
- `marginPct` rounded to one decimal.

Server, `buildSaleLedger` (`service.ts:351-399`):

- `totalBrl = itemsTotalBrl + boundedRecurringBrl` (`:377`), so a bounded recorrência is inside the base.
- `sellerCommissionBrl = Σ over receivables of Math.floor((row.amountBrl × pct) / 100)` (`:380-383`), one rounding **per receivable row**, across installments and bounded recurring rows alike.
- `netMarginPct = (netMarginBrl / totalBrl).toFixed(2)` (`:399`).

Any proposta with a bounded recorrência, or with more than one installment where the percentage does not divide evenly, shows one margin in steps 3 and 4 and saves another.
Additionally the step-4 payables preview gates recurring rows on `settings.commissionOnRecurring` (`:3873`) while `buildSaleLedger` and `materializeWonPayables` ignore that setting entirely, so the preview under-reports whenever the setting is off.

### What must not change

`materializeWonPayables` (`apps/api/src/domains/sales-ops/service.ts:496-575`) is the payables generation path.
It already sources `professional_cost` amounts from the `sales_ops_sale_professionals` rows read at `service.ts:1141-1149` inside `transitionSale`, and `other_cost` from `sale.otherCostsBrl` (`:1163`).
Per-receivable `seller_commission` / `finder_commission` / `tax` are generated from `Number(sale.sellerCommissionPct)` / `finderCommissionPct` / `taxPct` (`:1160-1162`), which are exactly the override columns.
Consequence, stated plainly so the executor does not go looking for work: **an overridden percentage or professional cost already flows into payables correctly, and this slice changes nothing inside the generation path.**
`SALE_TRANSITIONS` (`:1095-1101`), `canTransition` (`:1103`), the void-only-`open` rules (`:1189-1201`), `cancelContract` (`:1223-1288`), and the `"N/M"` / `"MN/M"` receivable labels (`:355`, `:366`) are all untouched.

### Sibling-slice facts this design is built on

- Slice 05 creates `sales_ops_funcoes` with `slug`, `isSystem`, `status`, the unique index `sales_ops_funcoes_org_id_id_idx` on `(org_id, id)`, and `sales_ops_person_funcoes`; it also adds `sales_ops_people_org_id_id_idx`. Its migration is `0012_sales_ops_funcoes`. It establishes the **composite `(org_id, fk)` foreign key** convention, because a plain single-column FK does not consult the RLS predicate.
- Slice 05 derives `isCollaborator` as "carries at least one non-system função" and seeds a non-system `prestador` função for orgs that had collaborators. This slice builds on that bridge and does not invent a parallel notion of "who may be allocated".
- Slice 01 removes the bootstrap-content-derived remount key at `SalesOpsApp.tsx:3644`. This slice must not reintroduce any dependency on it.
- Slice 03 ships an inline, non-portalled, single-select `Combobox` with `value` / `onChange` / `options` / `valueLabel` / `placeholder` / `onCreate` / `entityLabel` / `entityGender`, directly queryable in tests without `vi.mock`.
- Slice 06 (`combobox-adoption`) already swapped all 17 `NativeSelect` call sites, including the professional picker at `:4850`, onto that `Combobox`. This slice therefore changes the picker's **option source and semantics**, not its widget, and must preserve whatever `onCreate` wiring slice 06 established there.
- Slice 11 reworks step 2 into `Entrada + Restante em N x + Recorrência`. This slice reads the plan only through the wizard's `installmentRows` / recurring state and the derived receivable amount list.

### Assumed slice 07 contract - the single integration seam

Slice 07's plan does not exist yet, so this is stated as an assumption with one named adapter so a shape mismatch is a one-function fix rather than a redesign.

```ts
// apps/api/src/db/schema.ts, on salesOpsProducts
funcaoCosts: jsonb('funcao_costs').notNull().default(sql`'[]'::jsonb`)

// apps/api/src/domains/sales-ops/service.ts
export const ProductFuncaoCostSchema = z.object({
  funcaoId: uuid,
  costType: z.enum(['pct', 'fix']),
  costValue: z.number().nonnegative(), // pct: percent points (5 === 5%); fix: integer cents
});

// apps/web/src/sales-ops/types.ts
export type SalesOpsProductFuncaoCost = {
  funcaoId: string;
  costType: CommissionType;
  costValue: number;
};
// SalesOpsProduct gains: funcaoCosts: SalesOpsProductFuncaoCost[]
```

The **only** place in this slice that interprets `costType` / `costValue` is `resolveFuncaoCostCents` in `apps/web/src/sales-ops/calculations.ts` (see below).
If slice 07 lands `fix` in reais instead of cents, or names the field `defaultFuncaoCosts`, that function and one type import are the entire delta.
If `funcaoCosts` is absent on a product at runtime the wizard treats it as `[]`, so the função picker still works and the cost prefill is simply `0`; the executor must **not** invent the field on the product side here.
This slice also assumes slice 09 puts `funcoes: SalesOpsFuncao[]` on `SalesOpsBootstrap`, matching slice 05's `GET /bootstrap` addition.

### Test harness reality

`apps/web/vitest.config.ts:20` sets `environment: 'node'` and includes `src/**/__tests__/**/*.test.ts{,x}`.
There is no `@testing-library/*` in the repo.
Component tests put `// @vitest-environment happy-dom` on line 1, `vi.mock('@/components/ui/dialog')` down to plain divs, take `React.act` through a cast, render with `createRoot`, and query the DOM by hand.
The exact idiom to copy is `apps/web/src/sales-ops/__tests__/sale-wizard-commission-defaults.test.tsx:1-28` (pragma, dialog mock, act cast), `:148-174` (root lifecycle), `:176-214` (`buttonByText`, `fieldInput`, `click`, `changeSelect`, `flushReact`).
`sale-wizard-ui-contract.test.ts` is a source-text test that asserts literal substrings of `SalesOpsApp.tsx`.
`apps/api/vitest.config.ts:17` switches integration mode on `VITEST_INTEGRATION=1`; unit mode includes only `src/**/__tests__/**/*.test.ts`.
`apps/api/test/rls/setup-env.ts:21` hard-overrides `DATABASE_URL` from `TEST_DATABASE_URL`, which is the only thing keeping the integration suite off staging.
Do not weaken it.

## Override semantics

### The rule

One registry of pinned fields, seeded from what the operator actually did, consulted by every default re-apply.

```ts
type OverrideField = 'sellerCommissionPct' | 'finderCommissionPct' | 'taxPct' | 'otherCostsBrl';
const [manualOverrides, setManualOverrides] = useState<Record<OverrideField, boolean>>(...);
function markManual(field: OverrideField) { setManualOverrides((c) => (c[field] ? c : { ...c, [field]: true })); }
```

**What re-applies a default.**
Only the existing source-key block (`SalesOpsApp.tsx:3772-3781`), and only for fields whose flag is `false`:

```ts
if (commissionDefaultsSource !== currentCommissionDefaultsSource) {
  const defaults = resolveSaleCommissionDefaults(primaryItemProduct, hasFinderForSale, bootstrap.settings);
  setCommissionDefaultsSource(currentCommissionDefaultsSource);
  if (!manualOverrides.sellerCommissionPct) setSellerCommissionPct(String(defaults.sellerCommissionPct));
  if (!manualOverrides.finderCommissionPct) setFinderCommissionPct(String(defaults.finderCommissionPct));
}
```

`commissionDefaultsSource` is still advanced unconditionally, so the block cannot loop, and a pinned field simply stops being written.
No new re-apply path is added for `taxPct` or `otherCostsBrl`; they keep their single initialisation.
They join the registry only so the marker and the restore control below work uniformly.

**What pins a manual edit.**
The `onChange` of each of the four step-3 inputs calls `markManual(field)` before the setter.
The flag is per field, never global, so touching the seller percentage does not freeze the finder percentage.

**What the UI signals.**
`resolvedDefaults` is a memo over `resolveSaleCommissionDefaults(primaryItemProduct, hasFinderForSale, bootstrap.settings)` plus `settings.defaultTaxPct` and `'0.00'`.
When `manualOverrides[field]` is `true` **and** the input value differs from `String(resolvedDefaults[field])`, the field's `Field` label renders a muted amber chip reading `Alterado manualmente` and a text button reading `Restaurar padrão`.
`Restaurar padrão` clears the flag and writes the resolved default back in the same handler, so the field rejoins the re-apply path.
Requiring both conditions keeps the marker honest: retyping the default value by hand does not get flagged as a divergence.

**The edit path.**
`deriveWizardPrefill` (`SalesOpsApp.tsx:3556-3630`) already returns the stored `sellerCommissionPct`, `finderCommissionPct`, `taxPct`, `otherCostsBrl` and `professionals[]`, and the initial `commissionDefaultsSource` is seeded from the prefilled product plus `prefilledHasFinder` (`:3708-3712`), so nothing is clobbered on open.
That is necessary but not sufficient: change the product mid-edit and the key moves, and today the stored override dies.
Fix: seed the registry from the prefill.

```ts
const [manualOverrides, setManualOverrides] = useState<Record<OverrideField, boolean>>(() => {
  if (!prefill) return { sellerCommissionPct: false, finderCommissionPct: false, taxPct: false, otherCostsBrl: false };
  const d = resolveSaleCommissionDefaults(prefilledPrimaryProduct, prefilledHasFinder, bootstrap.settings);
  return {
    sellerCommissionPct: prefill.sellerCommissionPct !== String(d.sellerCommissionPct),
    finderCommissionPct: prefill.finderCommissionPct !== String(d.finderCommissionPct),
    taxPct: prefill.taxPct !== String(settings.defaultTaxPct ?? 6),
    otherCostsBrl: prefill.otherCostsBrl !== '0.00',
  };
});
```

Rule, absolute: **on the edit path a stored value always wins over a product default**, and a stored value that differs from the default it would have inherited is treated as a deliberate override for the whole session.
`ProfessionalForm.costManual` is seeded `true` for every prefilled row unconditionally, because a persisted professional cost is by definition a decision that was already saved.

### Professional cost prefill, same idiom

Adding the cost to the registry above would be wrong, because there are N rows.
The flag lives on the row (`ProfessionalForm.costManual`) and the re-apply uses the existing `planAutoKey` idiom (`SalesOpsApp.tsx:3789-3793`), one source key and at most one `setState` per change:

```ts
const funcaoCostBasis = useMemo(() => buildFuncaoCostBasis(items, bootstrap.products), [items, bootstrap.products]);
const funcaoCostKeyNow = JSON.stringify([...funcaoCostBasis.entries()]);
if (funcaoCostKey !== funcaoCostKeyNow) {
  setFuncaoCostKey(funcaoCostKeyNow);
  setProfessionals((current) =>
    current.map((row) =>
      row.costManual || !row.funcaoId
        ? row
        : { ...row, costBrl: centsToInput(funcaoCostBasis.get(row.funcaoId)?.cents ?? 0) },
    ),
  );
}
```

- Typing in a `CUSTO ALOCADO` input sets that row's `costManual = true` and it is never recomputed again.
- Changing the row's função recomputes the cost **only** when `costManual === false`.
- Changing the row's pessoa never touches the cost; a pessoa is not a cost driver.
- Changing item products, quantities or unit prices recomputes every non-manual row through the key above.

## Profissionais alocados design

### The two pickers

`PROFISSIONAL` keeps the slice-06 `Combobox` widget and changes its option source.
The `collaborators` memo (`SalesOpsApp.tsx:3676-3679`) is replaced for this picker by `activePeople = bootstrap.people.filter((p) => p.status === 'active')`, sorted by `displayName`.
Rationale: restricting allocation to `isCollaborator` hides a vendedor who also delivers, which is exactly the rigidity this batch removes, and slice 05 already reduced `isCollaborator` to a derived convenience flag.
The literal `Digite manualmente` option is **removed**; a pessoa is now always a registry row.
Legacy rows whose `personId` is null stay readable because the picker is given `valueLabel={row.personName}`, so the stored snapshot is what the trigger shows.
Whatever `onCreate` slice 06 wired on this picker stays exactly as it left it; this slice does not add a mutation to the wizard body (see Out of scope).

`FUNÇÃO NO PROJETO` becomes a `Combobox` over `bootstrap.funcoes.filter((f) => f.status === 'active')`, sorted `isSystem` last then by `name`, with `placeholder="Selecionar função..."`, `entityLabel="função"`, `entityGender="f"`, and `valueLabel={row.funcaoName}` so a legacy free-text snapshot such as `Operacional` still renders as the row's label with a null `funcaoId` behind it.
The hardcoded `role: 'Operacional'` seed at `:4823` is deleted; a new row starts with `funcaoId: ''` and an empty snapshot.

A professional row with neither a `funcaoId` nor a non-empty legacy snapshot is invalid.
`canAdvanceStepThree` (new, mirroring `canAdvanceStepTwo` at `:3826`) requires every row to satisfy that, and step 3 renders `Selecione a função de cada profissional alocado.` in the existing amber error style when the operator tries to advance.
Step 3 currently has no advance guard at all, which is why the guard is new rather than extended.

### `CUSTO ALOCADO`, the percent base, and making it visible

**The base is the item subtotal of the proposta items whose product declares a default for that função, and nothing else.**
Not the proposta total, not the net.
Stated as one formula, where `funcaoCosts` comes from the assumed slice-07 contract:

```
prefill(F) = Σ over items i, where products[i].funcaoCosts contains an entry c for F:
               c.costType === 'pct'  ->  Math.floor(subtotal(i) × c.costValue / 100)
               c.costType === 'fix'  ->  c.costValue
where subtotal(i) = max(1, quantity_i) × unitBrl_i
```

Three consequences, all deliberate:

1. The recurring `mensalidade` block is **excluded** from the base. A `professional_cost` payable is one-shot at win with `receivableId: null` (`service.ts:550-561`), so pricing it off a monthly stream would double-count it against a cost that is paid once. This is also why the base is the item subtotal rather than the server's `totalBrl`, which includes the bounded recurring block.
2. Free-form items (`productId` null) contribute nothing, because they have no product and therefore no defaults.
3. A two-product proposta where only one product declares `Desenvolvedor` prefills 5% of that one product, not 5% of everything. The additive rule is the only one that generalises without inventing a per-item professional relation, which `sales_ops_sale_professionals` deliberately does not have.

The number is never mysterious, because the derivation is rendered.
Under each `CUSTO ALOCADO` input, when the row is not `costManual` and its função has at least one contribution, a muted 11.5px line shows the contributions joined by ` + `:

- `5% de FXL Custom (R$ 20.000,00)`
- `Valor fixo de FXL Custom`
- `5% de FXL Custom (R$ 20.000,00) + R$ 300,00 de Landing Page`

When the row is `costManual` the line is replaced by the same `Alterado manualmente` chip used in step 3's percentage fields, plus `Restaurar padrão`, which clears `costManual` and re-prefills.
The helper that produces both the cents and the derivation strings is one function so they can never disagree:

```ts
// apps/web/src/sales-ops/calculations.ts
export type FuncaoCostContribution = { productName: string; subtotalBrl: number; costType: CommissionType; costValue: number; cents: number };
export type FuncaoCostBasisEntry = { cents: number; contributions: FuncaoCostContribution[] };
export function resolveFuncaoCostCents(cost: SalesOpsProductFuncaoCost, subtotalBrl: number): number;
export function buildFuncaoCostBasis(items, products): Map<string, FuncaoCostBasisEntry>;
export function describeFuncaoCostBasis(entry: FuncaoCostBasisEntry): string;
```

`resolveFuncaoCostCents` is the single adapter for the slice-07 shape named earlier.

### Schema decision and migration

**Decision: expand only. Add `funcao_id` and `funcao_name_snapshot`, keep `role` as a deprecated derived mirror, drop nothing.**

```ts
// apps/api/src/db/schema.ts, inside salesOpsSaleProfessionals (:613-627)
funcaoId: uuid('funcao_id'),
funcaoNameSnapshot: text('funcao_name_snapshot').notNull().default(''),
/** @deprecated derived mirror of funcaoNameSnapshot; drop in a later contract slice. */
role: text('role').notNull(),
```

plus, in the table's index/constraint array:

```ts
foreignKey({
  columns: [t.orgId, t.funcaoId],
  foreignColumns: [salesOpsFuncoes.orgId, salesOpsFuncoes.id],
  name: 'sales_ops_sale_professionals_org_funcao_fk',
}).onDelete('restrict'),
index('sales_ops_sale_professionals_org_funcao_idx').on(t.orgId, t.funcaoId),
```

Why this shape:

- `funcaoId` + `funcaoNameSnapshot` is the repo's own convention (`clientNameSnapshot` `:559`, `sellerNameSnapshot` `:561`, `productNameSnapshot` `:602`, `areaNameSnapshot` `:605`). A reviewer reading `role` cannot tell it is a snapshot; `funcaoNameSnapshot` says so.
- `role` is kept `NOT NULL` and written on every insert with the same string as `funcaoNameSnapshot`. Justification is identical to slice 05's for the three legacy person booleans: no destructive DDL, a clean revert, and no risk to any historical row. It is annotated for a later contract slice.
- The FK is **composite** `(org_id, funcao_id)`, mirroring slice 05, because a foreign key does not consult the RLS predicate and a single-column FK would accept another org's função id whenever a service filter is missed. The target unique index `sales_ops_funcoes_org_id_id_idx` is created by slice 05, so nothing new is needed on the parent.
- `funcao_id` is nullable while `org_id` is `NOT NULL`. With the default `MATCH SIMPLE`, a composite FK is satisfied without a lookup whenever any referencing column is NULL, so a legacy row with `funcao_id IS NULL` passes. This is subtle enough to be pinned by a test.
- `ON DELETE restrict` so a função referenced by a historical proposta can never be deleted out from under it. Slice 05 established that `salesOpsRouter` has no DELETE verb at all, so this is a database-level safety net rather than a behaviour.

**Migration.**
File `apps/api/drizzle/0014_sale_professional_funcoes.sql`, plus one appended entry in `apps/api/drizzle/meta/_journal.json`.
Ordering rule, binding, because slice 07 may or may not consume `0013`: the executor takes the **next free `idx` after the highest entry currently in `_journal.json`**, names the file `<NNNN>_sale_professional_funcoes.sql`, and sets `when` strictly greater than the previous entry's.
`0014` is the expectation given slice 05 takes `0012` and slice 07 is expected to take `0013`; if the numbers land differently, the rule wins and `files_modified` is corrected in the commit.
Before writing the FK statement the executor must confirm `sales_ops_funcoes_org_id_id_idx` is created by an **earlier-numbered** migration; if slice 05's migration is not yet present, stop and escalate rather than inlining the index here.

Generate with `pnpm --filter @fxl-sales/api db:generate`, then hand-rename the file and the `tag` in `_journal.json`, then hand-edit the body to exactly this, `--> statement-breakpoint` between every statement:

```sql
ALTER TABLE "sales_ops_sale_professionals" ADD COLUMN "funcao_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_ops_sale_professionals" ADD COLUMN "funcao_name_snapshot" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "sales_ops_sale_professionals_org_funcao_idx" ON "sales_ops_sale_professionals" USING btree ("org_id","funcao_id");--> statement-breakpoint
ALTER TABLE "sales_ops_sale_professionals"
  ADD CONSTRAINT "sales_ops_sale_professionals_org_funcao_fk"
  FOREIGN KEY ("org_id","funcao_id") REFERENCES "public"."sales_ops_funcoes"("org_id","id")
  ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
SELECT set_config('app.fxl_admin', 'true', true);--> statement-breakpoint
UPDATE "sales_ops_sale_professionals"
SET "funcao_name_snapshot" = "role"
WHERE "funcao_name_snapshot" = '';--> statement-breakpoint
UPDATE "sales_ops_sale_professionals" sp
SET "funcao_id" = f."id"
FROM "sales_ops_funcoes" f
WHERE f."org_id" = sp."org_id"
  AND lower(btrim(f."name")) = lower(btrim(sp."role"))
  AND sp."funcao_id" IS NULL;
```

No `ENABLE` / `FORCE ROW LEVEL SECURITY` and no new policies: `sales_ops_sale_professionals` already carries `sales_ops_sale_professionals_tenant_isolation` and `_admin_context` from `0007_marvelous_valeria_richards.sql`, and adding a column inherits them.
The `set_config('app.fxl_admin', 'true', true)` line is still required, because the backfill writes across every org and would otherwise be filtered by the tenant policy.
Both `UPDATE`s are guarded (`funcao_name_snapshot = ''`, `funcao_id IS NULL`) so a replay is a no-op.

**How existing free-text `role` values are backfilled.**
`funcao_name_snapshot` always takes the old `role` verbatim, so no label is ever lost.
`funcao_id` is set only where the org already has a função whose `name` matches the `role` after `lower(btrim(...))`.
Matching is case-insensitive and whitespace-trimmed but **not** diacritic-insensitive, because that would require the `unaccent` extension, which this database does not install.
An unmatched `role` keeps `funcao_id = NULL` and its snapshot; no função is invented from historical free text, because minting org cadastro rows out of typos is worse than a null.
Those rows render in the wizard through the picker's `valueLabel`, and the operator promotes them by picking a real função on the next edit.

### Tenancy - every id that arrives from the client

`c.get('orgId')` remains the only source of the org, and no handler reads an org from a body.
Today `SaleProfessionalSchema.personId` (`service.ts:155`), `sellerPersonId` (`:182`) and `finderPersonId` (`:184`) are accepted as bare uuids and written straight through (`createSale` `:907-908, :932`; `updateSale` `:1047-1048, :1073`) with **no** check that they belong to the caller's org, and the single-column FKs to `sales_ops_people` do not consult RLS.
That is a live cross-org write hole, and this slice adds a fourth id to the same path, so it is closed here rather than deferred.

One new resolver, modelled 1:1 on `resolveSaleItemContexts` (`service.ts:287-336`), called inside the existing `withTenant` transaction of both `createSale` and `updateSale`, before `buildSaleLedger`:

```ts
async function resolveSalePartyContexts(tx: Db, orgId: string, input: CreateSaleInput): Promise<{
  people: Map<string, { id: string; displayName: string }>;
  funcoes: Map<string, { id: string; name: string }>;
}>
```

- Collects the distinct non-null `input.sellerPersonId`, `input.finderPersonId` and `input.professionals[].personId`, then one `select` with `and(eq(salesOpsPeople.orgId, orgId), inArray(salesOpsPeople.id, ids))`.
- Collects the distinct non-null `input.professionals[].funcaoId`, then one `select` with `and(eq(salesOpsFuncoes.orgId, orgId), inArray(salesOpsFuncoes.id, ids))`.
- Any id not returned throws `SaleInputError` with a new code: `'seller_not_found'` and `'finder_not_found'` at index `-1`, `'person_not_found'` and `'funcao_not_found'` at the professional's array index.
- `SaleInputError.code` (`service.ts:271-279`) gains those four members; `itemIndex` stays `number` and `-1` means "not an item", documented on the field.
- `routes.ts` needs **no** change: `POST /sales` (`:170-181`) and `PUT /sales/:id` (`:223-236`) already map `SaleInputError` to `400 { error: 'validation_error', reason: error.code, itemIndex }`.

`buildSaleLedger` then takes the resolved maps and writes server-authoritative snapshots:

- `personNameSnapshot` = the resolved `displayName` when `personId` is present, else the body `personName` (the legacy unregistered path).
- `funcaoNameSnapshot` = the resolved `name` when `funcaoId` is present, else the body `role`.
- `role` = the same string as `funcaoNameSnapshot`, always.

A `funcaoNameSnapshot` in the request body is never read; the schema does not declare the field.

Zod:

```ts
export const SaleProfessionalSchema = z
  .object({
    personId: uuid.optional(),
    personName: z.string().min(1),
    funcaoId: uuid.optional(),
    role: z.string().min(1).optional(),
    costBrl: money,
  })
  .superRefine((row, ctx) => {
    if (!row.funcaoId && !row.role?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['funcaoId'], message: 'funcao_or_role_required' });
    }
  });
```

`role` becomes optional so a funcaoId-only payload is legal, and the refine keeps the legacy role-only payload legal too.

## Payables and margin impact

### Payables: nothing in the generation path changes

`materializeWonPayables` (`service.ts:496-575`) is not edited.
Evidence that overrides already reach it:

| Payable kind | Amount source | Override that drives it |
| --- | --- | --- |
| `seller_commission` | `pctOf(row.amountBrl, input.sale.sellerCommissionPct)` `:511` | `sales_ops_sales.seller_commission_pct` |
| `finder_commission` | `pctOf(row.amountBrl, input.sale.finderCommissionPct)` `:524` | `sales_ops_sales.finder_commission_pct` |
| `tax` | `pctOf(row.amountBrl, input.sale.taxPct)` `:537` | `sales_ops_sales.tax_pct` |
| `professional_cost` | `professional.costBrl` `:556` | `sales_ops_sale_professionals.cost_brl` |
| `other_cost` | `input.sale.otherCostsBrl` `:568` | `sales_ops_sales.other_costs_brl` |

`transitionSale` feeds it those exact columns at `:1155-1181`.
The three commission/tax kinds stay per-receivable and `receivableId`-linked; `professional_cost` and `other_cost` stay one-shot at the won date with `receivableId: null`.
The only edit anywhere near it is mechanical: the local `pctOf` helper (`:267-269`) is replaced by the imported `pctOfCents` from `packages/shared-utils`, which is the identical `Math.floor((amount * rate) / 100)`.
`beneficiaryName` for `professional_cost` stays `professional.personName`; it deliberately does **not** gain the função, because that would rewrite the text of payables that already exist.
Voiding on revert/lose/cancel, the paid-row immunity, and `cancelContract` are untouched.

So this slice's obligation on payables is a **proof** obligation, discharged by the integration tests in Red, not a change.

### Margin: one implementation, two call sites

New pure module, no I/O, no dependency beyond TypeScript.

```ts
// packages/shared-utils/src/sale-financials.ts
export function pctOfCents(amountBrl: number, ratePct: number): number; // Math.floor((amountBrl * ratePct) / 100)

export type SaleFinancialsInput = {
  itemsTotalBrl: number;            // Σ quantity × unitBrl, integer cents
  boundedRecurringBrl: number;      // monthlyBrl × cycles when cycles !== null, else 0
  receivableAmountsBrl: number[];   // every non-void receivable amount, installments then bounded recurring
  sellerCommissionPct: number;
  finderCommissionPct: number;
  hasFinder: boolean;
  taxPct: number;
  otherCostsBrl: number;
  professionalCostsBrl: number;
};

export type SaleFinancials = {
  totalBrl: number;
  sellerCommissionBrl: number;
  finderCommissionBrl: number;
  taxBrl: number;
  professionalCostsBrl: number;
  otherCostsBrl: number;
  netMarginBrl: number;
  netMarginPct: string;             // toFixed(2), the exact string the sale row stores
};

export function computeSaleFinancials(input: SaleFinancialsInput): SaleFinancials;
```

Semantics are the **server's current algorithm, verbatim**, so no persisted number moves:
`totalBrl = itemsTotalBrl + boundedRecurringBrl`; each of seller / finder / tax is `Σ pctOfCents(amount, pct)` over `receivableAmountsBrl`; finder is `0` when `hasFinder` is false; `netMarginBrl = totalBrl - seller - finder - professionalCosts - otherCosts - tax`; `netMarginPct = totalBrl > 0 ? ((netMarginBrl / totalBrl) * 100).toFixed(2) : '0.00'`.

**Server change.**
`buildSaleLedger` (`service.ts:346-454`) keeps building `receivables` itself, so the `"N/M"` and `"MN/M"` labels (`:355`, `:366`) never move, and then delegates:

```ts
const financials = computeSaleFinancials({
  itemsTotalBrl,
  boundedRecurringBrl,
  receivableAmountsBrl: receivables.map((r) => r.amountBrl),
  sellerCommissionPct: input.sellerCommissionPct,
  finderCommissionPct: input.finderCommissionPct,
  hasFinder: Boolean(input.finderPersonId),
  taxPct: input.taxPct,
  otherCostsBrl: input.otherCostsBrl,
  professionalCostsBrl: input.professionals.reduce((s, p) => s + p.costBrl, 0),
});
```

and spreads `financials` into `ledger.sale` in place of lines `:380-399` and `:423-434`.
Behaviour-neutral by construction; pinned by the existing `proposal-write.test.ts` and `sale-transitions.integration.test.ts`, which assert persisted ledger numbers today.

**Client change.**
`SalesOpsApp.tsx:3849-3861` is replaced by a call to the same function.
The wizard already derives the receivable amount list at `:3868-3879` (`previewReceivables`), so:

- `itemsTotalBrl` = the existing `totalCents`.
- `boundedRecurringBrl` = `recurringEnabled && !recurringIndefinite ? recurringMonthlyCents * recurringCyclesCount : 0`.
- `receivableAmountsBrl` = `previewReceivables.map((r) => r.amountCents)`.
- `professionalCostsBrl` = the existing `professionalCents`.

Two consequences that are bug fixes and must be stated because they change displayed numbers:

1. The `Margem líquida` panels in step 3 (`:4946-4997`) and step 4 (`:5062-5105`) now include the bounded recorrência in the base and round per receivable, so they finally equal what `PUT`/`POST` persists.
2. `previewReceivables` (`:3873`) **drops** its `settings.commissionOnRecurring` gate, because `buildSaleLedger` and `materializeWonPayables` ignore that setting entirely and the preview was lying whenever it was off. Making the server honour the setting would change payables materialization, which the batch scope limits forbid, so the preview is aligned to the server and the dead setting is flagged to the human as a follow-up.

`marginPct` for display becomes `Number(financials.netMarginPct)`, so the bar width and the persisted percentage agree to two decimals.

**Step 4 (Revisão) additions**, so an override is visible where the operator confirms:

- `Dados da proposta` (`:5010`) keeps its jump to step 1.
- The `Margem líquida` card (`:5062`) keeps its jump to step 3 and splits `Custos + imposto` (`:5099`) into three explicit lines: `Custos profissionais`, `Imposto`, `Outros custos`, and labels the two commission lines with their effective percentage, `Comissão vendedor (15%)`.
- `Previsão de contas a pagar` (`:5111`) keeps its jump to step 3 and its per-receivable rows; the `Custo profissional` rows gain the função in the description, `Alocação - Ana Martins · Desenvolvedor`, which is preview text only and does not touch the `beneficiaryName` that is actually persisted.

## Red

Write these first and watch them fail.
Prerequisite for any oracle that touches `packages/shared-utils`: `pnpm run build:packages`, because `apps/api` and `apps/web` resolve the package through its `dist` export map.

### 1. `packages/shared-utils/src/__tests__/sale-financials.test.ts` (new)

- `it('floors each percentage per receivable row rather than once over the total')` - two receivables of `333333` at `10` yields `66666`, proving `Σ floor` and not `floor(Σ)`.
- `it('includes a bounded recurring block in totalBrl and excludes an indefinite one')` - `boundedRecurringBrl` of `0` with recurring receivable rows absent yields `totalBrl === itemsTotalBrl`.
- `it('drops the finder commission entirely when hasFinder is false')` - a non-zero `finderCommissionPct` with `hasFinder: false` yields `finderCommissionBrl === 0` and a larger `netMarginBrl`.
- `it('subtracts professional and other costs from the net margin')`
- `it('returns netMarginPct as a two-decimal string and 0.00 when the total is zero')`
- `it('pctOfCents floors toward zero and returns zero for a zero rate')`

ORACLE

```bash
CI=true pnpm --filter @fxl-sales/shared-utils exec vitest run src/__tests__/sale-financials.test.ts
```

### 2. `apps/api/src/domains/sales-ops/__tests__/sale-margin-parity.test.ts` (new)

Carries the **golden fixture**: one item of `2 × 1000000`, three installments of `666667 / 666667 / 666666`, a bounded recurring block of `250000 × 4`, `sellerCommissionPct: 15`, `finderCommissionPct: 3.5`, a finder present, `taxPct: 6`, `otherCostsBrl: 12345`, two professionals at `100000` and `30000`.
Header comment: `// GOLDEN FIXTURE - must stay byte-identical to apps/web/src/sales-ops/__tests__/sale-margin-parity.test.ts`.

- `it('buildSaleLedger reports the golden fixture financials')` - asserts every field of `ledger.sale` from `totalBrl` through `netMarginPct` against explicit literals, computed by hand from the algorithm above and written into the test.
- `it('buildSaleLedger keeps the N/M and MN/M receivable labels while delegating the money to computeSaleFinancials')` - asserts the exact label sequence `['1/3','2/3','3/3','M1/4','M2/4','M3/4','M4/4']`.
- `it('buildSaleLedger mirrors funcaoNameSnapshot into the deprecated role column')`

ORACLE

```bash
CI=true pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/__tests__/sale-margin-parity.test.ts
```

### 3. `apps/web/src/sales-ops/__tests__/sale-margin-parity.test.ts` (new)

Same fixture, same literals, same header comment pointing back at the API file.
Pure module test, no DOM, so no happy-dom pragma.

- `it('the wizard margin model reports the same golden fixture financials as the API ledger')` - drives `computeSaleFinancials` through the web-side derivation helper and asserts the identical literals.
- `it('excludes the recurring mensalidade from the funcao cost base')` - `buildFuncaoCostBasis` over an item plus a recurring block returns cents derived from the item subtotal only.
- `it('sums a percent funcao default across every item whose product declares it')`
- `it('resolveFuncaoCostCents treats pct as percent points and fix as integer cents')`
- `it('describeFuncaoCostBasis renders 5% de FXL Custom (R$ 20.000,00) and joins several contributions with a plus')`

ORACLE

```bash
CI=true pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/sale-margin-parity.test.ts
```

### 4. `apps/web/src/sales-ops/__tests__/sale-wizard-overrides.test.tsx` (new)

Copy the harness of `sale-wizard-commission-defaults.test.tsx:1-28` and `:148-214` verbatim.
Fixture: `productA` seller-only `10` / with-finder `7` / finder `3`, `productB` `12 / 8 / 4`, org settings `defaultTaxPct: '6'`.

- `it('keeps a hand-typed seller commission when the primary product changes')` - the load-bearing override test. Advance to step 3, type `15` into `Comissão vendedor %`, go back to step 1, switch the primary item to `productB`, return to step 3, assert the value is still `15` while `Comissão finder %` moved to `4`.
- `it('keeps a hand-typed percentage when finder participation is toggled off and back on')`
- `it('re-applies the product default to a field the operator never touched')` - the guard against over-pinning; asserts `sale-wizard-commission-defaults.test.tsx`'s behaviour is preserved.
- `it('marks an overridden field with Alterado manualmente and restores the product default')` - after typing `15` the chip `Alterado manualmente` is in the DOM; clicking `Restaurar padrão` sets the input back to `7` and removes the chip.
- `it('does not mark a field whose typed value equals the default')` - type `7` by hand, no chip.
- `it('keeps every stored override when editing an existing proposta and then changing the product')` - the prefill round trip. `editSale` carries `sellerCommissionPct: '15.00'`, `taxPct: '9.00'`, `otherCostsBrl: 50000`; open, assert `15 / 9 / 500`, switch the primary product, assert all three unchanged.
- `it('sends the overridden percentages and costs in the save payload')` - `expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ sellerCommissionPct: 15, taxPct: 9, otherCostsBrl: 50000 }))`.

ORACLE

```bash
CI=true pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/sale-wizard-overrides.test.tsx
```

### 5. `apps/web/src/sales-ops/__tests__/sale-wizard-funcao-costs.test.tsx` (new)

Same harness.
Fixture: `funcoes` = `Desenvolvedor` / `Testador` / `Vendedor (isSystem)` / an `archived` one; `productCustom` with `funcaoCosts: [{ funcaoId: devId, costType: 'pct', costValue: 5 }, { funcaoId: testerId, costType: 'fix', costValue: 30000 }]` and an item of `1 × 2000000`; a second product `productLanding` declaring only `{ funcaoId: testerId, costType: 'fix', costValue: 30000 }`; three active pessoas of which one has `isCollaborator: false`, plus one `inactive`.
Queries reach the slice-03 `Combobox` directly through `[role="combobox"]` and `[role="option"]`, no mocking.

- `it('offers every active pessoa in the profissional picker and no longer offers Digite manualmente')` - the non-collaborator active pessoa is present, the inactive one is absent, and no option reads `Digite manualmente`.
- `it('picks a funcao from the registry and lists only active funcoes')` - the archived função is absent.
- `it('prefills a percent funcao cost from the declaring item subtotal and shows the derivation')` - pick `Desenvolvedor`, assert `CUSTO ALOCADO` is `1000.00` and the panel text contains `5% de FXL Custom`.
- `it('prefills a fixed funcao cost and leaves it editable')` - pick `Testador`, assert `300`, type `450`, change the item unit price, assert it is still `450` and the row shows `Alterado manualmente`.
- `it('sums a fixed default across every item whose product declares the funcao')` - with both products in the proposta, `Testador` prefills `600`.
- `it('excludes the recurring mensalidade from the percent base')` - enabling recorrência does not move the `Desenvolvedor` prefill.
- `it('re-prefills the cost when the funcao changes on a row the operator never typed into')` - switch `Desenvolvedor` to `Testador`, cost becomes `300`.
- `it('does not touch the cost when only the pessoa changes')`
- `it('keeps a stored professional cost when editing an existing proposta')` - `editSale` with a stored `costBrl: 777777` prefills `7777.77` and survives an item price change.
- `it('renders a legacy free-text funcao snapshot when the row has no funcaoId')` - a stored row with `funcaoId: null, role: 'Operacional'` shows `Operacional` on the função trigger.
- `it('blocks advancing past Custos e margem when a profissional row has no funcao')` - assert the step stays `3` and `Selecione a função de cada profissional alocado.` is rendered.
- `it('sends funcaoId and the funcao name as role in the save payload')` - `professionals: [{ personId, personName, funcaoId: devId, role: 'Desenvolvedor', costBrl: 100000 }]`.

ORACLE

```bash
CI=true pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/sale-wizard-funcao-costs.test.tsx
```

### 6. `apps/api/src/domains/sales-ops/__tests__/sale-professional-funcoes.test.ts` (new, unit)

Model the migration assertions on `areas-contract.test.ts:37-80` (index-ordered `indexOf` comparisons over the file text).
The migration path is resolved from `_journal.json`'s highest `*_sale_professional_funcoes` tag rather than hardcoded, so the idx rule above cannot desync the test.

- `it('accepts a professional row identified only by funcaoId')`
- `it('still accepts a legacy free-text role row')`
- `it('rejects a professional row with neither funcaoId nor role')`
- `it('never accepts funcaoNameSnapshot from the request body')` - the parsed object has no such key.
- `it('extends SaleInputError with the four party resolution codes')`
- `it('the shipped migration adds funcao_id nullable and funcao_name_snapshot not null with an empty default')` - also asserts `not.toMatch(/"funcao_id"\s+uuid\s+NOT NULL/i)`.
- `it('the shipped migration declares an org-scoped composite foreign key to sales_ops_funcoes')` - contains `FOREIGN KEY ("org_id","funcao_id") REFERENCES "public"."sales_ops_funcoes"("org_id","id")`.
- `it('the shipped migration backfills behind the admin context and is replay safe')` - `set_config('app.fxl_admin', 'true', true)` index is greater than the last `ALTER TABLE` index and less than the first `UPDATE` index; both `UPDATE`s carry their guard predicates; the file contains no `DROP`.
- `it('registers the sale professional funcao migration in the drizzle journal after the funcoes migration')` - its `idx` and `when` both exceed the `0012_sales_ops_funcoes` entry's.

ORACLE

```bash
CI=true pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/__tests__/sale-professional-funcoes.test.ts
```

### 7. `apps/api/test/rls/sale-professional-funcoes.test.ts` (new, integration)

Model on `apps/api/test/rls/proposal-write.test.ts:1-70` (the `APP_DB_URL` / `ADMIN_DB_URL` / `ADMIN_CONNECTION_OPTIONS` preamble and the per-org `afterAll` delete cascade), extended to delete `sales_ops_person_funcoes` and `sales_ops_funcoes`.
Fixtures are created through the real `createArea` / `createProduct` / `createFuncao` / `createPerson` service functions so RLS is genuinely enforced by the non-superuser `fxl_sales_test` role.

- `it('rejects a professional funcaoId from another org with funcao_not_found and writes nothing')` - `createSale` throws `SaleInputError` with `code === 'funcao_not_found'` and `itemIndex === 0`, and no `sales_ops_sales` row exists for the org afterwards.
- `it('rejects a professional personId from another org with person_not_found')`
- `it('rejects a sellerPersonId from another org and a finderPersonId from another org')` - both at `itemIndex === -1`.
- `it('persists funcao_id and a server-derived funcao_name_snapshot and mirrors it into role')`
- `it('ignores a personName that disagrees with the resolved pessoa')` - snapshot equals the registry `displayName`.
- `it('the composite foreign key rejects a cross-org funcao_id even in the admin context')` - a raw admin insert pairing org A's `sale_id` and `org_id` with org B's `funcao_id` rejects. Proves the constraint, not the service filter.
- `it('a null funcao_id passes the composite foreign key')` - the MATCH SIMPLE pin.
- `it('the migration backfill maps a legacy role to the matching org funcao case-insensitively and leaves an unmatched role null')` - replay the shipped SQL from the `set_config` statement onward inside one `adminClient.begin`, exactly as `proposal-schema-migration.test.ts:96-115` does.
- `it('professional_cost payables at won equal the overridden per-row costs')` - two professionals at `100000` and `30000`, transition to `won`, assert exactly two `professional_cost` payables with those amounts, `receivable_id IS NULL`, due on the won date.
- `it('overridden seller, finder and tax percentages drive the per-receivable payables at won')` - `sellerCommissionPct: 15` over three uneven installments yields three `seller_commission` payables each equal to `floor(amount * 15 / 100)`, each linked to its receivable.
- `it('reverting a won proposta voids the overridden professional_cost payables but never a paid one')` - the regression guard on the untouched void rules.

ORACLE

```bash
docker compose up -d
VITEST_INTEGRATION=1 CI=true pnpm --filter @fxl-sales/api exec vitest run test/rls/sale-professional-funcoes.test.ts
```

### 8. Existing tests to update, not rewrite

- `apps/web/src/sales-ops/__tests__/sale-wizard-edit.test.tsx` - `professionalRowInputs()` (`:285-293`) locates the role and cost inputs positionally after a `<select>`; the role field is no longer an input. Rewrite the helper against the new row shape and change the `role` assertions at `:328` and `:356` to `funcaoId` plus the função snapshot. Add `it('prefills a legacy professional row with a null funcaoId and its role snapshot')`.
- `apps/web/src/sales-ops/__tests__/sale-wizard-ui-contract.test.ts` - add `Alterado manualmente`, `Restaurar padrão`, `Custos profissionais`, `Selecione a função de cada profissional alocado.`; add `expect(source).not.toContain('Digite manualmente')` and `expect(source).not.toContain("role: 'Operacional'")`.
- `apps/web/src/sales-ops/__tests__/calculations.test.ts` - `buildSalePayload` now carries `funcaoId` on professionals; add a case proving `role` is still emitted for the legacy path.
- `apps/web/src/sales-ops/__tests__/sale-wizard-commission-defaults.test.tsx` - **expected to pass unchanged.** It is the oracle proving the default re-apply for untouched fields survives the pinning work. If it needs a change, the pinning is over-broad.

### Full gate before handing off

```bash
pnpm run build:packages
pnpm run lint
pnpm run type-check
CI=true pnpm test
docker compose up -d
pnpm --filter @fxl-sales/api test:integration
pnpm run build
```

All must exit 0.

## Green

1. Create `packages/shared-utils/src/sale-financials.ts` with `pctOfCents`, `SaleFinancialsInput`, `SaleFinancials` and `computeSaleFinancials` exactly as specified in Payables and margin impact. Pure TypeScript, no imports, no `any`.
2. Add `export * from './sale-financials.js';` to `packages/shared-utils/src/index.ts`, then run `pnpm run build:packages`.
3. `apps/api/src/domains/sales-ops/service.ts` - import `computeSaleFinancials` and `pctOfCents` from `@fxl-sales/shared-utils`, delete the local `pctOf` (`:267-269`) and replace its two call sites in `materializeWonPayables` and its uses in `buildSaleLedger` with `pctOfCents`.
4. Same file - in `buildSaleLedger` (`:346-454`), keep the receivable construction and its labels, then replace the money block (`:380-399`) with one `computeSaleFinancials` call and spread the result into the returned `sale` object in place of `:423-434`. Verify the existing `proposal-write.test.ts` numbers are unchanged before going further.
5. `apps/api/src/db/schema.ts` - add `funcaoId: uuid('funcao_id')` and `funcaoNameSnapshot: text('funcao_name_snapshot').notNull().default('')` to `salesOpsSaleProfessionals` (`:613-627`), annotate `role` as the deprecated derived mirror, and add the composite `foreignKey` plus `index('sales_ops_sale_professionals_org_funcao_idx')` to its constraint array. Import `foreignKey` from `drizzle-orm/pg-core` if slice 05 has not already added it.
6. Run `pnpm --filter @fxl-sales/api db:generate`. Take the next free `idx` from `apps/api/drizzle/meta/_journal.json`, hand-rename the emitted file to `<NNNN>_sale_professional_funcoes.sql`, and hand-edit the matching `tag`. Confirm `sales_ops_funcoes_org_id_id_idx` is created by an earlier-numbered migration; if not, stop and escalate.
7. Hand-edit that SQL file to the exact seven statements in Profissionais alocados design, `--> statement-breakpoint` between each. Add no RLS statements.
8. `apps/api/src/domains/sales-ops/service.ts` - extend `SaleInputError.code` (`:271-279`) with `'seller_not_found' | 'finder_not_found' | 'person_not_found' | 'funcao_not_found'` and document that `itemIndex === -1` means the error is not about an item.
9. Same file - rewrite `SaleProfessionalSchema` (`:154-159`) to the `funcaoId` + optional `role` + `superRefine` shape.
10. Same file - add `resolvePartyContexts(tx, orgId, input)` next to `resolveSaleItemContexts` (`:287`), doing one in-org `select` over `salesOpsPeople` and one over `salesOpsFuncoes`, both `and(eq(table.orgId, orgId), inArray(table.id, ids))`, throwing the four new `SaleInputError` codes.
11. Same file - call it from `createSale` (`:881`) and `updateSale` (`:1024`) inside the existing `withTenant` transaction, before `buildSaleLedger`, and thread the two maps into `buildSaleLedger` so `personNameSnapshot`, `funcaoNameSnapshot` and the `role` mirror are written from the resolved rows. `routes.ts` needs no edit.
12. `apps/web/src/sales-ops/types.ts` - add `SalesOpsProductFuncaoCost` and `funcaoCosts` to `SalesOpsProduct` only if slice 07 did not already; add `funcaoId: string | null` and `funcaoNameSnapshot: string` to `SalesOpsSaleProfessional`; add `funcaoId?: string` and make `role` optional on `SaleDraftProfessional` and `CreateSalePayload['professionals'][number]`.
13. `apps/web/src/sales-ops/calculations.ts` - add `resolveFuncaoCostCents`, `buildFuncaoCostBasis`, `describeFuncaoCostBasis` and the two result types; map `funcaoId` through `buildSalePayload` (`:188-193`), emitting `role` from the snapshot so the legacy path survives.
14. `apps/web/src/sales-ops/SalesOpsApp.tsx` - extend `ProfessionalForm` (`:3506-3511`) to `{ personId, personName, funcaoId, funcaoName, costBrl, costManual }`, dropping `role`.
15. Same file - add the `OverrideField` type, the `manualOverrides` state seeded from the prefill per Override semantics, `markManual`, and the `resolvedDefaults` memo.
16. Same file - guard the two setters in the source-key block (`:3772-3781`) on `!manualOverrides[field]`, leaving the `setCommissionDefaultsSource` call unconditional.
17. Same file - add `funcaoCostBasis`, `funcaoCostKey` state and the render-time re-prefill block, placed immediately after the existing `planAutoKey` block (`:3789-3793`) so the two source-key syncs sit together.
18. Same file - extend `deriveWizardPrefill` (`:3608-3615`) to map `funcaoId`, `funcaoName` from `funcaoNameSnapshot` with a fallback to `role`, and `costManual: true`.
19. Same file - rework the step-3 professional rows (`:4845-4911`): the pessoa `Combobox` sources `activePeople` and drops the `Digite manualmente` option, the função column becomes a `Combobox` over active `bootstrap.funcoes` with `valueLabel={row.funcaoName}`, and the cost input gains `markRowManual(index)` plus the derivation line or the `Alterado manualmente` chip with `Restaurar padrão`.
20. Same file - delete the `role: 'Operacional'` seed at `:4823` and replace it with `funcaoId: ''`, `funcaoName: ''`, `costManual: false`; the pessoa seed becomes `activePeople[0]`.
21. Same file - add the four `markManual` calls to the step-3 percentage and cost inputs (`:4916-4943`) and render the chip plus `Restaurar padrão` per field.
22. Same file - add `canAdvanceStepThree` and wire it into `advanceWizard` (`:4034-4048`) and the step-tab `disabled` expression (`:4153`), rendering `Selecione a função de cada profissional alocado.` when it blocks.
23. Same file - replace the margin block (`:3849-3861`) with `computeSaleFinancials`, drop the `settings.commissionOnRecurring` gate from `previewReceivables` (`:3873`), and add the função to the `Custo profissional` preview label (`:3911-3917`).
24. Same file - split `Custos + imposto` (`:5099`) into `Custos profissionais` / `Imposto` / `Outros custos` and add the effective percentage to the two commission labels in step 4.
25. Same file - update `createPayload` (`:4109-4114`) to send `funcaoId` and `role: funcaoName`.
26. Run every ORACLE, then the full gate. One atomic commit, for example `feat(sales-ops): make product defaults overridable per proposta and bind profissionais to the funcoes registry`.

## Refactor

- Once green, `manualOverrides` and `ProfessionalForm.costManual` are the same idea at two scopes. Leave them separate: one is a fixed four-key record and the other is per row, and a generic "dirty field registry" abstraction would hide the render-time re-apply guards that are the whole point.
- `commissionDefaultsSourceKey` (`:3513`), `planAutoKey` (`:3789`), `recurringSource` (`:3795`) and the new `funcaoCostKey` are now four instances of the same render-time source-key sync. Extract a local `useSourceKeySync(key, apply)` hook **only if** it keeps each `apply` callback visible at its own call site; if it makes the re-apply implicit, leave the four blocks explicit.
- `SalesOpsApp.tsx` is over 5200 lines before this slice and grows further. Extract `SaleWizardDialogBody`'s step-3 body into a sibling `SaleWizardCostsStep.tsx` in the same directory once green, moving no logic, so the diff of this slice stays reviewable and the file stops growing. Do this as the last step, after all oracles pass, and re-run them.
- Keep `resolveFuncaoCostCents` in `calculations.ts` rather than `packages/shared-utils`. It interprets a product-shape the server never needs to interpret, and moving it would couple the package to slice 07's jsonb shape.
- Do not touch the product dialog's `providers` editor (`:3007-3084`). Retiring it in favour of `funcaoCosts` is slice 10's call.

## Out of scope

- Any change to the propostas status machine, the payables materialization rules, the void-only-`open` semantics, the paid-row immunity, or the `"N/M"` / `"MN/M"` receivable label conventions. `materializeWonPayables`, `transitionSale` and `cancelContract` keep their current behaviour; the only edit is swapping the local `pctOf` for the identical imported `pctOfCents`.
- Adding a função dimension to `sales_ops_products` (`funcaoCosts`) and its cadastro UI. Slices 07 and 10. This slice **consumes** the field and degrades to a zero prefill when it is absent.
- Retiring or migrating `sales_ops_products.providers`. Slice 10.
- Dropping `sales_ops_sale_professionals.role`. A later contract slice, after this one has shipped, matching slice 05's expand/contract discipline for the person booleans.
- An inline `Criar nova pessoa` / `Criar nova função` affordance inside the wizard. `SaleWizardDialogBody` takes `bootstrap` plus `onSave` and performs no mutations; adding one would put a `useSaveSalesOpsPerson` mutation inside a form component. Whatever `onCreate` slice 06 wired on the pessoa picker stays untouched, and new pessoas and funções are created in Cadastros.
- Making the server honour `sales_ops_settings.commission_on_recurring`. It is currently read by nothing on the server and only by the step-4 preview, which this slice aligns to the server. **Flag to the human:** `commissionOnRecurring` is a dead setting; commissions are generated for every non-void receivable including bounded recurring rows, and honouring the toggle would change payables materialization, which the batch scope limits forbid.
- Fixing the `professional_cost` re-win dedup collapse. `alreadyExists('professional_cost', null)` (`service.ts:551`) keys on `(kind, receivableId)` and every professional row has `receivableId: null`, so on a re-win where one professional payable survived as `paid`, **all** professional rows are skipped, including ones that were voided and should regenerate. Pre-existing, orthogonal to overrides, and fixing it means giving professional payables a discriminator. **Flag to the human as its own slice.** This slice's tests pin the current fresh-win behaviour so the bug cannot silently widen.
- Validating `sellerCommissionType: 'fix'` products. `resolveSaleCommissionDefaults` (`calculations.ts:37-79`) silently falls back to the org settings percentage when a product's commission is a fixed amount, so a `fix` product's cadastro value never reaches a proposta. Pre-existing and a separate decision about whether a proposta can carry a fixed-amount commission at all. **Flag to the human.**
- Any per-item professional allocation relation (`sale_item_id` on `sales_ops_sale_professionals`). The additive percent base makes it unnecessary; adding it would be unbacked speculation.
- i18n extraction. New pt-BR strings live where the existing ones do.
- Any change to Hub auth, tenancy filtering, `getVisibleWorkspaces`, `AppRole`, or the legacy `/admin/*`, `/finder/*`, `/seller/*`, `/no-role` route trees.

## Risks

- **This is the largest slice in the batch and may not land as one commit.** It is designed to, and the ordering has no internal hazard: the shared-financials extraction is behaviour-neutral, the migration is additive, and the web rework depends on both. *If the Verify agent times out or the diff proves unreviewable*, split at exactly this boundary. **12a `proposta-overrides-backend`**: Green steps 1 through 11 plus Red items 1, 2, 6 and 7; touches `packages/shared-utils/*`, `apps/api/*`; oracle `pnpm run build:packages && CI=true pnpm --filter @fxl-sales/api test && VITEST_INTEGRATION=1 pnpm --filter @fxl-sales/api test:integration`. **12b `proposta-overrides-web`**: Green steps 12 through 26 plus Red items 3, 4, 5 and 8; touches `apps/web/*`; `depends_on: [12a]`. The boundary is clean because 12a's only web-visible effect is two additive fields on the professional payload, which 12b is the sole consumer of. Do not pre-emptively split; it costs a second Verify cycle for no correctness gain.
- **A cross-org `funcaoId` or `personId` slipping through.** Two independent defences, both tested. The service resolver rejects any id not returned by an `and(eq(table.orgId, orgId), inArray(table.id, ids))` read inside `withTenant`, and the composite `(org_id, funcao_id)` foreign key rejects it at the database level even under the admin context, because a foreign key does not consult the RLS predicate and a single-column FK would have accepted it. The "even in the admin context" test is the one that proves the constraint rather than the filter.
- **The pre-existing unvalidated `sellerPersonId` / `finderPersonId` becoming a regression.** Adding validation could break a test that seeds a sale with a person id that has no row. Verified: `sale-transitions.integration.test.ts` seeds real people through `seedFinderPerson` (`:37-44`) and `proposal-write.test.ts` never sends a person id, so nothing existing breaks. Confirm by running the API suites before touching the web side, which Green step 4 already sequences.
- **The margin extraction silently changing a persisted number.** `computeSaleFinancials` reproduces the server's current algorithm literally, including `Math.floor` per receivable and `toFixed(2)`. Green step 4 requires `proposal-write.test.ts` and `sale-transitions.integration.test.ts` to be green **before** any further work, so a drift is caught while the diff is still one function.
- **The two golden-fixture parity tests drifting apart.** They duplicate the literals because `apps/api` cannot import from `apps/web` and a test-only fixture in `packages/shared-utils/src/__tests__` is not in the package's `dist` export map. Mitigated by a cross-referencing header comment in both files and by both being asserted against the same shared implementation, so a real divergence in behaviour breaks one of them. Accepted cost, stated so it is not mistaken for an oversight.
- **The client margin numbers changing visibly for existing propostas.** They do, and that is the fix: today steps 3 and 4 disagree with what gets saved whenever there is a bounded recorrência or uneven installments. Called out explicitly in Payables and margin impact so it is not read as a regression, and pinned by the parity tests.
- **Over-pinning, so a product change stops updating anything.** Avoided by making the flag per field and set only by a real `onChange`, and locked by `it('re-applies the product default to a field the operator never touched')` plus the requirement that `sale-wizard-commission-defaults.test.tsx` passes unchanged.
- **Under-pinning on the edit path.** A stored override that happens to equal the default is not flagged, which is correct; a stored override that differs is flagged for the whole session, which is what makes a mid-edit product change safe. Locked by `it('keeps every stored override when editing an existing proposta and then changing the product')`.
- **A render-time `setState` loop from the new `funcaoCostKey` sync.** Avoided by advancing the key unconditionally before mapping the rows, exactly as `planAutoKey` (`:3789-3793`) and `recurringSource` (`:3795-3807`) already do, and by deriving the key from a memoized basis so it is stable across renders.
- **`funcao_id` nullable inside a composite FK behaving unexpectedly.** `MATCH SIMPLE` skips the lookup when any referencing column is NULL, which is what legacy rows need. Pinned by `it('a null funcao_id passes the composite foreign key')` rather than assumed.
- **The migration idx colliding with slice 07's.** Slice 07's plan does not exist yet, so the number is unknowable at planning time. Avoided by making the binding instruction "next free `idx` after the highest journal entry" rather than a literal, and by resolving the migration path in the contract test from `_journal.json` instead of hardcoding it.
- **Slice 07 landing a different `funcaoCosts` shape.** Avoided by routing every interpretation of `costType` / `costValue` through the single `resolveFuncaoCostCents` adapter, and by tolerating an absent field as `[]` so the função picker still ships even if only the cost prefill degrades.
- **Slice 11 renaming the wizard's plan state.** This slice reads the plan only through `installmentRows` and the recurring state to build `receivableAmountsBrl`. If slice 11 renames them, that is a one-expression fix at the `computeSaleFinancials` call site, which is the only consumer.
- **`sale-wizard-edit.test.tsx`'s positional `professionalRowInputs()` helper breaking silently.** It locates inputs by index after a `<select>` (`:285-293`), and both of those assumptions die in this slice. Called out explicitly in Red item 8 so it is updated deliberately rather than discovered as a red run.
- **Product fixtures across eight web test files needing `funcaoCosts`.** If slice 07 makes the field required on `SalesOpsProduct`, those fixtures are slice 10's to update, not this slice's. This slice's own new fixtures declare it; if `type-check` fails on somebody else's fixture, add the minimal `funcaoCosts: []` and say so in the commit body rather than reshaping their tests.
- **The integration suite reaching staging.** `apps/api/.env` points `DATABASE_URL` at staging in this repo; `apps/api/test/rls/setup-env.ts:21` hard-overrides it from `TEST_DATABASE_URL`. Do not weaken that override and do not read `DATABASE_URL` in a new test file before `setupFiles` runs.
- **The shared-utils oracle failing on a cold tree.** `apps/api` and `apps/web` resolve `@fxl-sales/shared-utils` through `dist`, so a single-file oracle run needs `pnpm run build:packages` first. Stated as a prerequisite at the top of Red; the repo-wide `pnpm test` and `pnpm type-check` already run it themselves.
