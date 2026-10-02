---
id: 04-plan-propostas
milestone: v4.2.0
status: done
depends_on: [02-catalog-refs-cadastros]
files_modified:
  - apps/api/src/domains/import/plan/propostas.ts
  - apps/api/src/domains/import/__tests__/propostas-fixtures.ts
  - apps/api/src/domains/import/__tests__/plan-propostas.test.ts
acceptance: "Given a ParsedWorkbook, an ImportCatalog and a RefIndex, planPropostas returns one createSale operation per valid Propostas row (planKey propostas:<row>, status draft|open|won with lost/cancelled mapped to open, wonOn = the raw Data de ganho only when Ganha) whose SaleDraft, once its refs are replaced by uuids, passes CreateSaleSchema; a basic row with only Cliente, Vendedor, Produto and Data base yields exactly the items, commissions, tax, payment plan (remainder on the LAST parcela) and recorrência the wizard derives from the produto and settings defaults; full depth honours Itens, Profissionais (cost basis default, divisão in basis points), Parcelas (sum must equal the items total) and the recorrência columns; and every refusal is a pt-BR ImportIssue with sheet, Excel row and header text, never a uuid."
goal: "Turn the Propostas, Itens da proposta, Profissionais da proposta and Parcelas sheets into createSale operations that reproduce the proposta the wizard would build from the same choices, with every validation the wizard and CreateSaleSchema apply reported up front as pt-BR issues."
must_not_break:
  - "pnpm --filter @fxl-sales/api test (whole unit suite)"
  - "pnpm --filter @fxl-sales/api lint"
  - "pnpm --filter @fxl-sales/api type-check (tsconfig.json, tsconfig.scripts.json, tsconfig.test.json)"
  - apps/api/src/domains/import/__tests__/parse.test.ts
  - apps/api/src/domains/import/__tests__/workbook-schema.test.ts
  - apps/api/src/domains/sales-ops/__tests__/default-payment-plan.test.ts
  - scripts/__tests__/auth-fake-isolation.test.mjs
rules:
  - "plan/propostas.ts is PURE: no I/O, no database, no clock (`new Date()` without an argument is forbidden), no process.env. It may import runtime values only from ../types.js (types), ../workbook-schema.js, ../cells.js, ../parse.js, ./cadastros.js (planCadastros), ../../sales-ops/service.js (CreateSaleSchema, resolveProductKind, slugifyFuncao, types) and @fxl-sales/shared-utils subpaths. Never import from apps/web."
  - "Never edit types.ts, workbook-schema.ts, cells.ts, parse.ts, refs.ts, catalog.ts or plan/cadastros.ts. Read cells ONLY through cellReader(sheet, row); headers ONLY through getColumnDef(sheet, key).header (never hand-typed header strings in propostas.ts)."
  - "Ref matching is normalizeLabel(ref) from cells.ts everywhere (duplicate detection and child lookup), the same rule slice 05 uses."
  - "createSale ops: planKey `propostas:<Excel row>`; input.status 'draft' for Rascunho, 'won' for Ganha, 'open' for Aberta, blank, Perdida and Cancelada; wonOn = cellReader(...).text('dataGanho') when situacao is 'won' (raw, unvalidated), else null. Never emit transitionSale or settleReceivable and never report a won-day or producer-live issue (slice 05 owns them)."
  - "A null in a required cell or any parser error on a proposta row or one of its child rows means: emit no op for that proposta and report nothing extra for that cell (the parser already did). Planner checks still run on the other non-null cells so the user sees every independent error at once."
  - "Money is integer cents end to end; percentages are numbers 0..100; costSplitBp is integer basis points. No float survives into the draft (Math.floor / Math.round exactly as specified per rule)."
  - "Generated parcelas follow the WIZARD (`generateInstallmentPlan` in apps/web/src/sales-ops/calculations.ts): remainder on the LAST row, dates by absolute offset from the anchor with month-end clamping. Do NOT call materializeDefaultPaymentPlan (it puts the remainder on the FIRST row)."
  - "Messages are pt-BR, name values as the user typed them or as RefLookup.label, format money as `R$ 1.234,56` and days as dd/mm/aaaa by string, and never contain a uuid or a column key."
  - "No em dash in any file; relative imports use the `.js` extension (NodeNext); no `any`."
  - "Do not touch apps/web/** (in particular apps/web/src/sales-ops/leads/**, owned by a live peer run)."
verifier_focus: "That the basic-depth draft equals, field by field, what the wizard derives (items[0] produto drives commissions via the resolveSaleCommissionDefaults rule incl. the fix-value fallback to settings, tax from settings, plan shape from defaultEntradaMode/Pct/Brl and defaultRemainingInstallments with remainder on the LAST row, unit price setupBrl || monthlyBrl, recorrência only when hasMonthly && monthlyBrl > 0, professionals empty); that every emitted draft passes CreateSaleSchema with placeholder uuids; that a parser error on any row of a proposta suppresses its op without a duplicate issue; that Perdida/Cancelada come out as status open and Ganha as won with wonOn = the raw cell; and that no message contains a uuid."
---

# Slice 04 - Plan propostas (Propostas, Itens, Profissionais, Parcelas)

## Objective

Implement `planPropostas(parsed, catalog, refs)` in `apps/api/src/domains/import/plan/propostas.ts`.
It reads the Propostas sheet and its three child sheets (Itens da proposta, Profissionais da proposta, Parcelas) and returns one `createSale` operation per valid proposta, plus every issue.
A basic row (Cliente, Vendedor, Produto, Data base) must produce the proposta the wizard would save by default (AC5); full depth adds explicit items, professionals, parcelas and recorrência.
Status outcomes (transitions), the won-day rules and the Pagamentos sheet are slice 05.

## Code facts (verified while planning)

- `CreateSaleSchema` (`apps/api/src/domains/sales-ops/service.ts` ~L583-603): `clientId?` uuid, `clientName` min 1, `sellerPersonId?`, `sellerName` min 1, `finderPersonId?`, `finderName?` nullable, `status` `draft|open|won`, `baseDate` isoDate, `notes?` nullable, `sellerCommissionPct`/`finderCommissionPct`/`taxPct` pct (defaults 10/3/6 - we always send explicit values), `otherCostsBrl` money, `items` min 1, `professionals` default [], `installments` 1..120, `recurring` nullish; `.superRefine(validatePaymentPlan)` demands `sum(installments.amountBrl) === sum(items.quantity * unitBrl)` (message `installments_sum_mismatch: ...`, path `['installments']`).
- `SaleItemSchema`: `productId?`, `productName` trim min 1 max 140, `areaId?`, `quantity` int positive, `unitBrl` money; refine: `areaId` required when `productId` absent. The server takes the área of a product item from the produto (`resolveSaleItemContexts`), so a product item may omit `areaId`.
- `SaleProfessionalSchema`: `personId?`, `personName` min 1, `funcaoId?`, `role?`, `costBrl` money, `costSplitBp` int 0..10000 array 1..120 nullish; refine: `funcaoId` or `role`; `costSplitBp` sums to exactly 10000.
- `SaleInstallmentSchema`: `{ dueDate, amountBrl, method }`; `SaleRecurringSchema`: `monthlyBrl` int POSITIVE, `startDate`, `cycles` 1..120 or null, `method` default pix.
- `buildSaleLedger` drops `amountBrl === 0` installments and labels the rest `N/M`; bounded recurring adds `M1/C..MC/C`; indefinite recurring adds none. Slice 05 mirrors this with its own `plannedReceivableLabels`.
- `createSale` does NOT check that the vendedor has the vendedor função nor the finder the finder função; the planner must (task rule).
- `createProduct` stores `sellerWithFinderCommissionType ?? sellerCommissionType` and `sellerWithFinderCommissionValue ?? sellerCommissionValue`; `resolveProductKind(data)` is exported (`kind` wins, then `openPrice`, else `'product'`); `slugifyFuncao(name)` is exported; system função slugs are `vendedor` and `finder` and system funções cannot be renamed, so a função NAME whose slug is `vendedor` is the vendedor função.
- Wizard defaults (`SaleWizardDialog` in apps/web/src/sales-ops/SalesOpsApp.tsx ~L6774-7330 and calculations.ts):
  - item for a produto: quantity 1, `unitBrl = productBaseValueBrl(product) = setupBrl || monthlyBrl`, productName = produto name (a serviço may carry its own description instead).
  - primary produto = `items[0]` produto; commissions = `resolveSaleCommissionDefaults(primary, hasFinder, settings)`: without finder, seller = product `sellerCommissionValue` if type `pct` else settings seller default, finder = settings finder default; with finder, seller = `sellerWithFinderCommission*` (pct) else settings, finder = `finderCommission*` (pct) else settings.
  - tax = settings `defaultTaxPct`; other costs 0.
  - plan = `generateInstallmentPlan(total, defaultPlanShapeForProduct(primary, baseDate), methods)`: entrada `pct` -> `Math.round(total * pct / 100)`, `fix` -> `Math.floor(brl)`, clamped into [0, total]; restante split by `splitInstallmentsEqually` (floor base, LAST row absorbs the remainder) over `restanteCountFor` = clamp(defaultRemainingInstallments, 1, 120 or 119 with an entrada mode other than none); entrada row on the anchor, restante rows at offset `index + (entrada > 0 ? 1 : 0)` months via `addMonthsToIsoDate` (absolute offset, month-end clamp); a 100 percent entrada produces only the entrada row.
  - recorrência suggested only when `primary.hasMonthly && primary.monthlyBrl > 0`: monthly = `primary.monthlyBrl`, start = baseDate + 1 month.
  - auto-seeded professional rows are personless and `professionalRowWillPersist` drops them from the payload, so a default save has `professionals: []`.
  - wizard gates: free item needs área, description and value > 0; a serviço item needs a negotiated value > 0; total > 0; every parcela > 0; `costSplitBp.length <= max(1, parcela count)`.
- `buildFuncaoCostBasis` (calculations.ts L230): per função, sum over items WITH a produto of `fix ? max(0, floor(valueBrl)) : max(0, floor(subtotal * valuePct / 100))` for each cost the produto declares.
- `ImportCatalog.products` carries every org produto (archived included) as `ProductCatalogEntry` with numbers; `catalog.settings` carries the three defaults (10/3/6 when absent). `catalog.people[].funcaoSlugs` lists an existing person's função slugs.
- `RefIndex.resolve(kind, name)` returns `{ ok: true, ref, label }` or `{ ok: false, code, message }` (pt-BR message already naming the value). A workbook row resolves to `{ planKey: '<sheet>:<row>' }`.
- Unit tests: `apps/api/vitest.config.ts` collects `src/**/__tests__/**/*.test.ts`; helpers under `__tests__/` not ending in `.test.ts` are not collected. Importing `service.ts` in unit tests is safe (see `sales-ops/__tests__/default-payment-plan.test.ts`).
- zod is 3.24: `z.string().uuid()` accepts `00000000-0000-4000-8000-000000000000`.

## Decisions taken by this plan (recorded for the Report)

- P1. The product defaults of a produto CREATED in the same workbook are read from the `createProduct` operations of `planCadastros(parsed, catalog, refs)`, called inside `planPropostas`. One implementation of the Produtos-row-to-ProductInput rules (slice 02), no new seam name, no re-parsing of the Produtos sheet here. `planCadastros` is pure, so running it twice (here and in `plan/index.ts`) is harmless; its issues are ignored here (plan/index reports them).
- P2. Generated parcelas mirror the WIZARD (remainder on the last row), not `materializeDefaultPaymentPlan` (remainder on the first). AC5 is defined against what the wizard saves.
- P3. Two blank-column defaults follow the column help in workbook-schema.ts rather than the wizard's initial state: blank `Forma de pagamento` uses the primary produto's `defaultPaymentMethod` (the wizard starts at Pix), and blank `Ciclos da recorrência` uses the produto's `defaultRecurringCycles`, `null` meaning indefinite (the wizard starts at 12). The column help is what the user reads in the template, and both values are the produto's own declared defaults.
- P4. Parcelas rows are ordered by `vencimento` ascending, ties by Excel row, so the generated labels `1/N..N/N` are chronological (the labels Pagamentos cites).
- P5. A professional row is never a reason to change the pessoa cadastro (create-only, decision 3). When the pessoa does not have the função, the proposta still records it and the planner emits a WARNING (see Seam deviations 1).
- P6. Item área for a produto item is `areaRef: null` (the server derives it from the produto); only free-form items carry an `areaRef`.

## File 1 - `apps/api/src/domains/import/plan/propostas.ts`

### Imports

```ts
import { z } from 'zod';
import {
  CreateSaleSchema,
  resolveProductKind,
  slugifyFuncao,
  type CreateSaleInput,
  type PaymentMethod,
  type ProductEntradaMode,
  type ProductKind,
} from '../../sales-ops/service.js';
import { normalizeLabel, coercePctList } from '../cells.js';
import { cellReader } from '../parse.js';
import { getColumnDef } from '../workbook-schema.js';
import { planCadastros } from './cadastros.js';
import type {
  CommissionType, EntityRef, ImportCatalog, ImportCounts, ImportIssue, ImportOperation,
  ParsedRow, ParsedWorkbook, RefIndex, RefKind, SaleDraft, SheetKey, SheetPlanResult,
} from '../types.js';
```

(`z` is needed only for the `z.ZodIssue` type: use `import type { ZodIssue } from 'zod'` instead if lint flags an unused value import.)

### Exports (exact)

```ts
/** Stable key of an EntityRef: `id:<uuid>` or `plan:<planKey>`. Used to key maps by reference, never shown to users. */
export function refKeyOf(ref: EntityRef): string;

/** The produto defaults the proposta planner reads, for a catalog produto or one the workbook creates. */
export type ProposalProductFuncaoCost =
  | { funcaoKey: string; mode: 'pct'; valuePct: number }
  | { funcaoKey: string; mode: 'fix'; valueBrl: number };   // valueBrl in CENTS
export type ProposalProduct = {
  ref: EntityRef;
  name: string;
  kind: ProductKind;
  setupBrl: number;
  monthlyBrl: number;
  hasMonthly: boolean;
  sellerCommissionType: CommissionType;
  sellerCommissionValue: number;
  sellerWithFinderCommissionType: CommissionType;
  sellerWithFinderCommissionValue: number;
  finderCommissionType: CommissionType;
  finderCommissionValue: number;
  defaultPaymentMethod: PaymentMethod;
  defaultEntradaMode: ProductEntradaMode;
  defaultEntradaPct: number | null;
  defaultEntradaBrl: number | null;
  defaultRemainingInstallments: number;
  defaultRecurringCycles: number | null;
  funcaoCosts: ProposalProductFuncaoCost[];
};
export type ProposalProductIndex = ReadonlyMap<string, ProposalProduct>; // keyed by refKeyOf(ref)

/** Catalog produtos (by existingId) plus every createProduct op (by planKey). */
export function buildProposalProductIndex(catalog: ImportCatalog, cadastroOperations: readonly ImportOperation[]): ProposalProductIndex;

export type PropostaIssueCode =
  | 'duplicate_ref' | 'unknown_proposta_ref' | 'product_has_errors'
  | 'seller_without_funcao' | 'finder_without_funcao'
  | 'items_conflict' | 'no_items'
  | 'free_item_description_required' | 'free_item_area_required' | 'free_item_value_required'
  | 'negotiated_value_required' | 'description_ignored' | 'area_ignored' | 'zero_total'
  | 'plan_conflict' | 'installments_sum_mismatch' | 'zero_installment' | 'too_many_installments'
  | 'entrada_exceeds_total' | 'recurrence_without_monthly'
  | 'cost_split_sum_mismatch' | 'cost_split_too_many_parts' | 'person_lacks_funcao'
  | 'invalid_proposta';
  // plus, passed through verbatim: RefLookup failure codes (unknown_ref | archived_ref | ambiguous_ref)
  // and coercePctList codes (invalid_pct | out_of_range) for Divisão do custo.

/** THE seam planner (contract signature). Wires buildProposalProductIndex(catalog, planCadastros(parsed, catalog, refs).operations). */
export function planPropostas(parsed: ParsedWorkbook, catalog: ImportCatalog, refs: RefIndex): SheetPlanResult;

/** The same planner with the produto index injected (unit tests use it with hand-built indexes). */
export function planPropostasWith(parsed: ParsedWorkbook, catalog: ImportCatalog, refs: RefIndex, products: ProposalProductIndex): SheetPlanResult;

/** Where each draft array entry came from, so a schema issue can be pinned to a sheet, row and header. */
export type DraftSources = {
  propostaRow: number;
  ref: string;
  items: Array<{ sheet: 'propostas' | 'itens'; row: number }>;
  professionals: Array<{ row: number }>;
  installments: { kind: 'parcelas'; rows: number[] } | { kind: 'generated' };
};
/** Safety net: maps CreateSaleSchema issues onto ImportIssues (one per distinct sheet/row/column). */
export function mapSaleSchemaIssues(issues: readonly z.ZodIssue[], sources: DraftSources): ImportIssue[];

/** Valid-uuid placeholder used ONLY to run CreateSaleSchema on a draft whose refs are not ids yet. */
export const DRAFT_PLACEHOLDER_UUID = '00000000-0000-4000-8000-000000000000';
```

Nothing else is exported (slice 05 needs only the op shape; see `## Exports for slice 05`).

### Private helpers (exact behaviour)

- `header(sheet, key)` = `getColumnDef(sheet, key).header`.
- `issue(severity, sheet, row, column, code, message): ImportIssue`.
- `brl(cents)`: `R$ ` + integer reais with `.` thousands (`String(Math.floor(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')`) + `,` + `String(c % 100).padStart(2, '0')`. Example `123456` -> `R$ 1.234,56`, `0` -> `R$ 0,00`.
- `dayBr(iso)`: `const [y, m, d] = iso.split('-'); return \`${d}/${m}/${y}\``.
- `addMonths(iso, months)`: split into numbers; `t = new Date(Date.UTC(y, m - 1 + months, 1))`; `last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate()`; day = `Math.min(d, last)`; return `pad4(t.getUTCFullYear())-pad2(t.getUTCMonth() + 1)-pad2(day)` built from UTC parts (NOT `toISOString().slice`). `addMonths('2026-01-31', 1) === '2026-02-28'`, `addMonths('2026-01-31', 2) === '2026-03-31'`.
- `planKeyRow(planKey, sheet)`: returns the integer after `${sheet}:` or null.
- `errorRowKeys(parsed)`: `Set` of `${sheet}:${row}` for every parsed issue with `severity === 'error'` and non-null sheet and row.
- `funcaoSlugsOfPerson(ref, parsed, catalog, refs)`: returns `Set<string> | null` (null = "unknown, skip the check"):
  - `existingId` -> `new Set(catalog.people.find(p => p.id === id)?.funcaoSlugs ?? [])`;
  - `planKey` `pessoas:N` -> the Pessoas row N; its `cellReader('pessoas', row).list('funcoes')`; null list -> `null`; else for each name: `l = refs.resolve('funcao', name)`; when `l.ok` and `'existingId' in l.ref`, use `catalog.funcoes.find(f => f.id === l.ref.existingId)?.slug ?? slugifyFuncao(name)`; otherwise `slugifyFuncao(name)`.
  - any other planKey -> `null`.
- `funcaoRefsOfPerson(ref, parsed, catalog, refs)`: same walk, returning the set of `refKeyOf` função refs the pessoa will hold (existing: from `catalog.people[].funcaoIds` as `{ existingId }`; workbook: from each resolved name; unresolved names skipped); null when unknown. Used only for the `person_lacks_funcao` warning.
- `resolveOrIssue(kind, name, sheet, row, column, issues)`: `l = refs.resolve(kind, name)`; `!l.ok` -> push `issue('error', sheet, row, column, l.code, l.message)` and return null; else return `l`.
- `generatePlan(totalCents, shape, method)` - the wizard generator, verbatim semantics:
  ```ts
  type Shape = { entradaMode: ProductEntradaMode; entradaValue: number; restanteCount: number; anchorDate: string };
  const entrada = shape.entradaMode === 'pct' ? Math.round((total * shape.entradaValue) / 100)
    : shape.entradaMode === 'fix' ? Math.floor(shape.entradaValue) : 0;
  const entradaCents = Math.min(Math.max(entrada, 0), total);
  const restante = total - entradaCents;
  const maxRest = shape.entradaMode === 'none' ? 120 : 119;
  const n = Math.max(1, Math.min(maxRest, Math.floor(shape.restanteCount) || 1));
  rows: entradaCents > 0 -> { dueDate: anchor, amountBrl: entradaCents };
  restante > 0 -> base = Math.floor(restante / n); for i in 0..n-1: { dueDate: addMonths(anchor, i + (entradaCents > 0 ? 1 : 0)), amountBrl: i === n - 1 ? restante - base * (n - 1) : base };
  rows empty -> [{ dueDate: anchor, amountBrl: 0 }] (unreachable here because total > 0 is enforced first);
  every row gets `method`.
  ```
- `productShape(product | undefined, baseDate)` (mirror of `defaultPlanShapeForProduct`): mode = `product?.defaultEntradaMode ?? 'none'`; value = pct -> `Math.max(0, product.defaultEntradaPct ?? 0)`, fix -> `Math.max(0, Math.floor(product.defaultEntradaBrl ?? 0))`, none -> 0; restanteCount = `Math.max(1, Math.min(120, Math.floor(product?.defaultRemainingInstallments ?? 1) || 1))`; anchor = baseDate.
- `commissionDefaults(primary | undefined, hasFinder, settings)` (mirror of `resolveSaleCommissionDefaults`): `pctOr(type, value, fallback) = type === 'pct' ? value : fallback`. No finder: seller = `pctOr(primary?.sellerCommissionType, primary?.sellerCommissionValue, settings.defaultSellerCommissionPct)`, finder = `settings.defaultFinderCommissionPct`. With finder: seller = `pctOr(sellerWithFinderType, sellerWithFinderValue, settings seller)`, finder = `pctOr(finderType, finderValue, settings finder)`. A missing primary means both fall back to settings.
- `baseValue(product)` = `product.setupBrl || product.monthlyBrl` (cents).
- `isService(product)` = `product.kind === 'service'`.
- `funcaoCostBasis(items)`: `Map<funcaoKey, cents>`; for each built item with a `product`: `subtotal = quantity * unitBrl`; for each `product.funcaoCosts` entry add `fix ? Math.max(0, Math.floor(valueBrl)) : Math.max(0, Math.floor((subtotal * valuePct) / 100))`.
- `probeInput(draft): unknown` - the draft with refs replaced by ids: `clientId` / `sellerPersonId` / `finderPersonId` = `DRAFT_PLACEHOLDER_UUID` when the ref is present (else omitted), items `productId`/`areaId` the placeholder when the ref is present, professionals `personId`/`funcaoId` likewise; every other field copied; the `*Ref` keys removed.

### `buildProposalProductIndex(catalog, ops)`

1. For each `p` of `catalog.products`: key `refKeyOf({ existingId: p.id })`, value: every scalar copied from `ProductCatalogEntry`; `funcaoCosts` = `p.productFuncaoCosts.map(c => c.mode === 'pct' ? { funcaoKey: refKeyOf({ existingId: c.funcaoId }), mode: 'pct', valuePct: c.valuePct } : { funcaoKey: ..., mode: 'fix', valueBrl: c.valueBrl })`.
2. For each op with `op.op === 'createProduct'`: key `refKeyOf({ planKey: op.planKey })`, from `i = op.input`: `kind = resolveProductKind(i)`; `setupBrl`, `monthlyBrl`, `hasMonthly`, `sellerCommissionType`, `sellerCommissionValue`, `finderCommissionType`, `finderCommissionValue`, `defaultPaymentMethod`, `defaultEntradaMode`, `defaultRemainingInstallments` copied; `sellerWithFinderCommissionType = i.sellerWithFinderCommissionType ?? i.sellerCommissionType`; `sellerWithFinderCommissionValue = i.sellerWithFinderCommissionValue ?? i.sellerCommissionValue` (exactly what `createProduct` stores); `defaultEntradaPct = i.defaultEntradaPct ?? null`; `defaultEntradaBrl = i.defaultEntradaBrl ?? null`; `defaultRecurringCycles = i.defaultRecurringCycles ?? null`; `funcaoCosts = op.funcaoCosts.map(({ funcaoRef, cost }) => ({ funcaoKey: refKeyOf(funcaoRef), ...cost }))`.

### `planPropostas(parsed, catalog, refs)`

```ts
return planPropostasWith(parsed, catalog, refs, buildProposalProductIndex(catalog, planCadastros(parsed, catalog, refs).operations));
```

### `planPropostasWith` algorithm

Let `issues = []`, `operations = []`, `counts = { propostas: 0, itens: 0, profissionais: 0, parcelas: 0 }`, `errorRows = errorRowKeys(parsed)`.
`P = 'propostas'`; `h(key) = header(P, key)`.

**Step 1 - Ref index and duplicates.**
`firstByRef = new Map<string, { row: ParsedRow; ref: string }>()`.
For each Propostas row in order: `ref = cellReader(P, row).text('ref')`; null -> skip (parser reported). `k = normalizeLabel(ref)`.
If `firstByRef.has(k)`: error `duplicate_ref`, column `Ref`, `O Ref "<ref>" já foi usado na linha <first.row> da aba Propostas; cada proposta precisa de um Ref diferente.`; the duplicate row is never planned (children attach to the first).
Else `firstByRef.set(k, { row, ref })`.

**Step 2 - group children.**
For `sheet` of `['itens', 'profissionais', 'parcelas']` in that order, for each row: `ref = cellReader(sheet, row).text('ref')`; null -> skip. `k = normalizeLabel(ref)`.
Not in `firstByRef` -> error `unknown_proposta_ref` (sheet = that sheet), column `Ref`, `O Ref "<ref>" não existe na aba Propostas; use o Ref de uma proposta desta planilha.`.
Else push the row into `children.get(k)[sheet]` (row order preserved).

**Step 3 - per proposta** (each `firstByRef` entry, in Propostas row order). `r = cellReader(P, row)`, `ref` as typed, `kids = children.get(k) ?? { itens: [], profissionais: [], parcelas: [] }`.
`failed = errorRows.has('propostas:<row>') || any kid row in errorRows (with its own sheet)`; every error pushed below for this proposta also sets `failed = true` (warnings do not).

3.1 **Cliente**: `name = r.text('cliente')`; non-null -> `resolveOrIssue('client', ...)` with column `h('cliente')`; ok -> `clientRef = l.ref`, `clientName = l.label`.

3.2 **Vendedor**: `name = r.text('vendedor')`; non-null -> resolve `'person'` (column `Vendedor`); ok -> `sellerRef`, `sellerName = l.label`; `slugs = funcaoSlugsOfPerson(l.ref)`; `slugs !== null && !slugs.has('vendedor')` -> error `seller_without_funcao`, column `Vendedor`, `"<label>" não tem a função Vendedor; inclua a função Vendedor no cadastro da pessoa ou escolha outro vendedor.`

3.3 **Finder** (optional): `name = r.text('finder')`; non-null -> resolve `'person'` (column `Finder`); ok -> `finderRef`, `finderName = l.label`; slug check with `'finder'` -> error `finder_without_funcao`, `"<label>" não tem a função Finder; inclua a função Finder no cadastro da pessoa ou deixe o Finder em branco.` `hasFinder = name !== null` (used for commission defaults even if resolution failed; the proposta has failed anyway).

3.4 **Items.** `shortcut = { produto: r.text('produto'), quantidade: r.number('quantidade'), valor: r.number('valorUnitario') }`; `anyShortcut` = any of the three non-null.
- `anyShortcut && kids.itens.length > 0` -> error `items_conflict`, column = header of the first non-null among produto, quantidade, valorUnitario, `A proposta "<ref>" tem Produto, Quantidade ou Valor unitário preenchidos e também linhas na aba Itens da proposta; use só uma das duas formas.`; skip the item build.
- `!anyShortcut && kids.itens.length === 0` -> error `no_items`, column `Produto`, `A proposta "<ref>" não tem itens; preencha o Produto ou adicione linhas na aba Itens da proposta.` (Only when the Propostas row itself is free of parser errors on `produto`, `quantidade` and `valorUnitario`; a coercion error there already explains it.)
- Shortcut with `produto === null` (quantidade or valor given, no Itens) -> error `no_items` with the same message, column `Produto`.
- Shortcut with produto: build ONE item from (`sheet 'propostas'`, row, produto, descricao = null, area = null, quantidade, valor) with the item rule below; header context = the Propostas headers (`Produto`, `Quantidade`, `Valor unitário (R$)`).
- Itens rows: build one item per row, in row order, with `c = cellReader('itens', row)`: produto `c.text('produto')`, descricao `c.text('descricao')`, area `c.text('area')`, quantidade `c.number('quantidade')`, valor `c.number('valorUnitario')`; header context = Itens headers.

Item rule (`built = { draft: SaleDraft['items'][number]; product: ProposalProduct | null; source }`):
- `quantity = quantidade ?? 1`.
- produto non-null: `l = resolve('product')` (column Produto of that sheet); fail -> issue, no item. ok -> `product = products.get(refKeyOf(l.ref))`; undefined -> error `product_has_errors`, column Produto, `O produto "<label>" tem erros na aba Produtos; corrija a linha do produto primeiro.`; no item.
  - `unitBrl = valor ?? baseValue(product)`.
  - `isService(product) && unitBrl === 0` -> error `negotiated_value_required`, column Valor unitário, `O serviço "<label>" não tem valor no cadastro; informe o Valor unitário (R$) negociado.`
  - descricao non-null (Itens only): serviço -> `productName = descricao`; produto -> warning `description_ignored`, column Descrição, `A Descrição "<descricao>" foi ignorada: ela só vale para itens avulsos e para serviços.`, `productName = product.name`. descricao null -> `productName = product.name`.
  - area non-null (Itens only) -> warning `area_ignored`, column Área, `A Área "<area>" foi ignorada: o item usa a área do produto "<label>".`
  - draft `{ productRef: l.ref, areaRef: null, productName, quantity, unitBrl }`.
- produto null (Itens only, free-form):
  - descricao null -> error `free_item_description_required`, column Descrição, `Preencha a Descrição do item avulso ou escolha um Produto.`
  - area null -> error `free_item_area_required`, column Área, `Preencha a Área do item avulso "<descricao or 'sem descrição'>".`; else `resolve('area')` (column Área).
  - `valor === null || valor === 0` -> error `free_item_value_required`, column Valor unitário, `Informe o Valor unitário (R$) do item avulso "<descricao or 'sem descrição'>".` (Only when the valor cell has no parser issue; a coercion error already explains it.)
  - draft `{ productRef: null, areaRef, productName: descricao, quantity, unitBrl: valor }`.

After items: `primary = builtItems[0]?.product ?? undefined` (a free-form first item means no primary produto, exactly like the wizard). `total = sum(quantity * unitBrl)`.
If at least one item was built, no item error occurred and `total === 0` -> error `zero_total`, column null, `A proposta "<ref>" tem total R$ 0,00; informe o Valor unitário de pelo menos um item.`

3.5 **Commissions, tax, other.** `defaults = commissionDefaults(primary, hasFinder, catalog.settings)`;
`sellerCommissionPct = r.number('comissaoVendedorPct') ?? defaults.seller`; `finderCommissionPct = r.number('comissaoFinderPct') ?? defaults.finder`; `taxPct = r.number('impostoPct') ?? catalog.settings.defaultTaxPct`; `otherCostsBrl = r.number('outrosCustos') ?? 0`; `notes = r.text('observacoes')` (null stays null); `baseDate = r.text('dataBase')`.

3.6 **Status.** `situacao = r.text('situacao')`; `status = situacao === 'draft' ? 'draft' : situacao === 'won' ? 'won' : 'open'`; `wonOn = situacao === 'won' ? r.text('dataGanho') : null`.

3.7 **Payment method.** `method = r.text('formaPagamento') ?? primary?.defaultPaymentMethod ?? 'pix'` (cast through a `PAYMENT_METHODS.includes` guard, not `as`).

3.8 **Installments.** Skip this step when `baseDate === null` or items failed.
- Parcelas rows present:
  - `r.number('entradaBrl') !== null || r.number('numeroParcelas') !== null` -> error `plan_conflict`, column = header of the first non-null of the two, `A proposta "<ref>" tem parcelas na aba Parcelas; deixe Entrada e Número de parcelas em branco.`
  - `kids.parcelas.length > 120` -> error `too_many_installments`, sheet parcelas, row = the 121st row, column Ref, `A proposta "<ref>" tem <n> parcelas; o limite é 120.`
  - rows with both `vencimento` and `valor` non-null become `{ dueDate, amountBrl, method: c.text('formaPagamento') ?? method }`; a row with `valor === 0` -> error `zero_installment`, column Valor, `A parcela de <dayBr> da proposta "<ref>" tem valor zero; remova a linha ou informe o valor.`
  - sort by `dueDate` ascending, ties by Excel row (P4); `installmentRows` records the sorted Excel rows for `DraftSources`.
  - when every parcela row parsed cleanly and `sum !== total` -> error `installments_sum_mismatch`, sheet parcelas, row = the FIRST parcela row of the Ref (sheet order), column `Valor (R$)`, `As parcelas da proposta "<ref>" somam <brl(sum)>, mas o total dos itens é <brl(total)>.`
- No Parcelas rows: `entrada = r.number('entradaBrl')`, `count = r.number('numeroParcelas')`;
  - `shape = productShape(primary, baseDate)`; when `entrada !== null`: `shape.entradaMode = entrada > 0 ? 'fix' : 'none'`, `shape.entradaValue = entrada`; when `count !== null`: `shape.restanteCount = count`.
  - `entrada !== null && entrada > total` (and total > 0) -> error `entrada_exceeds_total`, column Entrada, `A Entrada <brl(entrada)> da proposta "<ref>" é maior que o total dos itens <brl(total)>.`
  - `count !== null && shape.entradaMode !== 'none' && count > 119` -> error `too_many_installments`, column Número de parcelas, `Com entrada, a proposta "<ref>" pode ter no máximo 119 parcelas além da entrada.`
  - otherwise (and `total > 0`) `installments = generatePlan(total, shape, method)`.

3.9 **Recorrência.** `monthly = r.number('mensalidade')`, `start = r.text('inicioRecorrencia')`, `cycles = r.number('ciclosRecorrencia')`.
- `monthlyBrl = monthly !== null ? monthly : (primary && primary.hasMonthly && primary.monthlyBrl > 0 ? primary.monthlyBrl : 0)`.
- `monthlyBrl === 0` -> `recurring = null`; then if `start !== null || cycles !== null` -> error `recurrence_without_monthly`, column = header of the first non-null of `inicioRecorrencia`, `ciclosRecorrencia`, `A proposta "<ref>" tem Início ou Ciclos da recorrência, mas nenhuma mensalidade; preencha a Mensalidade (R$) ou deixe esses campos em branco.` (When `monthly === 0` was typed explicitly the same rule applies.)
- else (`baseDate` non-null) `recurring = { monthlyBrl, startDate: start ?? addMonths(baseDate, 1), cycles: cycles ?? primary?.defaultRecurringCycles ?? null, method }`.

3.10 **Professionals** (each Profissionais row, row order), `c = cellReader('profissionais', row)`:
- `funcaoName = c.text('funcao')`, `pessoaName = c.text('pessoa')`; resolve `'funcao'` (column Função) and `'person'` (column Pessoa) when non-null.
- `costBrl = c.number('custo') ?? funcaoCostBasis(builtItems).get(refKeyOf(funcaoRef)) ?? 0` (blank cost only when the função resolved).
- `split = c.text('divisaoCusto')`; non-null -> `res = coercePctList(split)`; `!res.ok` -> error with `res.code`, column `Divisão do custo (%)`, `res.message`; ok and value non-null -> `bp = value.map(p => Math.round(p * 100))`;
  - `sum(bp) !== 10000` -> error `cost_split_sum_mismatch`, `A divisão do custo de "<pessoa>" soma <sum/100 formatted with comma, e.g. 90 or 12,5>%; os percentuais precisam somar 100.`
  - `bp.length > Math.max(1, installmentCount)` (installmentCount = number of installments with amountBrl > 0 in this draft; check only when installments were built) -> error `cost_split_too_many_parts`, `A divisão do custo de "<pessoa>" tem <n> partes, mas a proposta "<ref>" tem <m> parcelas.`
  - `costSplitBp = bp`; blank -> `costSplitBp = null`.
- Warning `person_lacks_funcao` when both resolved and `funcaoRefsOfPerson(personRef)` is non-null and lacks `refKeyOf(funcaoRef)`: column Pessoa, `"<pessoa label>" não tem a função <função label> no cadastro; a proposta registra a função, mas o cadastro da pessoa não é alterado.`
- draft `{ personRef, funcaoRef, personName: personLabel, costBrl, costSplitBp }` (no `role`: `funcaoId` satisfies the refine).

3.11 **Assemble and probe.** When `!failed`:
```ts
const draft: SaleDraft = {
  clientRef, clientName, sellerRef, sellerName, finderRef: finderRef ?? null, finderName: finderName ?? null,
  status, baseDate, notes, sellerCommissionPct, finderCommissionPct, taxPct, otherCostsBrl,
  items, professionals, installments, recurring,
};
```
`parsedProbe = CreateSaleSchema.safeParse(probeInput(draft))`; `!success` -> `issues.push(...mapSaleSchemaIssues(parsedProbe.error.issues, sources))` and no op (this branch is a safety net: every rule it can fire is pre-checked above).
Success -> `operations.push({ op: 'createSale', planKey: \`propostas:${row.row}\`, input: draft, wonOn })`; `counts.propostas += 1`, `counts.itens += kids.itens.length`, `counts.profissionais += kids.profissionais.length`, `counts.parcelas += kids.parcelas.length`.

**Step 4 - result.** `counts` keeps only keys with a value > 0; return `{ operations, issues, counts }`.
Issue order: Step 1 duplicates, Step 2 unknown child refs (sheet order then row), then per proposta in row order, in the order the steps above push them.

### `mapSaleSchemaIssues(issues, sources)`

For each zod issue, pick `(sheet, row, column)` from `path`:
- `['items', i, field?]`: `src = sources.items[i]`; sheet `src.sheet`, row `src.row`; column by field: `productName` -> itens `Descrição` (propostas `Produto`), `quantity` -> `Quantidade`, `unitBrl` -> `Valor unitário (R$)`, `areaId` -> itens `Área` (propostas `Produto`), `productId` or none -> `Produto`.
- `['professionals', i, field?]`: sheet profissionais, row `sources.professionals[i].row`; `costBrl` -> `Custo (R$)`, `costSplitBp` -> `Divisão do custo (%)`, `personName`/`personId` -> `Pessoa`, `funcaoId`/`role` -> `Função`, other -> null.
- `['installments', i?, field?]`: `kind 'parcelas'` -> sheet parcelas, row `rows[i] ?? rows[0]`, column `dueDate` -> `Vencimento`, `method` -> `Forma de pagamento`, else `Valor (R$)`; `kind 'generated'` -> propostas row, column `Número de parcelas`.
- `['recurring', field?]`: propostas; `monthlyBrl` -> `Mensalidade (R$)`, `startDate` -> `Início da recorrência`, `cycles` -> `Ciclos da recorrência`, `method` -> `Forma de pagamento`.
- top level on propostas: `clientName`/`clientId` -> `Cliente`, `sellerName`/`sellerPersonId` -> `Vendedor`, `finderName`/`finderPersonId` -> `Finder`, `baseDate` -> `Data base`, `status` -> `Situação`, `sellerCommissionPct` -> `Comissão do vendedor (%)`, `finderCommissionPct` -> `Comissão do finder (%)`, `taxPct` -> `Imposto (%)`, `otherCostsBrl` -> `Outros custos (R$)`, `notes` -> `Observações`; anything else -> propostas row, column null.
Every result: severity error, code `invalid_proposta`, message `A proposta "<ref>" foi recusada na coluna "<column>"; revise o valor.` (column null -> `A proposta "<ref>" foi recusada; revise os dados da proposta e das abas ligadas a ela.`). Dedupe by `sheet|row|column`. Headers via `getColumnDef`. The zod message is never copied (English).

## File 2 - `apps/api/src/domains/import/__tests__/propostas-fixtures.ts` (test helper, not collected)

```ts
export const IDS: { area: string; areaArchived: string; vendedor: string; finder: string; dev: string; ana: string; bruno: string; carla: string; padaria: string; sistema: string; consultoria: string; licenca: string; mensal: string };
// fixed literal uuids (v4 shaped), e.g. '11111111-1111-4111-8111-000000000001'

export function catalogProduct(patch: Partial<ProductCatalogEntry> & { id: string; name: string }): ProductCatalogEntry; // sane defaults: product, setup 0, no monthly, pct 10/10/3, pix, none, 1 parcela, cycles null, no costs, active, codeSuffix '0', areaId IDS.area
export function testCatalog(patch?: Partial<ImportCatalog>): ImportCatalog;
/*
 testCatalog defaults: today '2026-10-02', producerFlowLive false, settings { 10, 3, 6 },
 areas [Tecnologia (active)], funcoes [Vendedor vendedor system, Finder finder system, Desenvolvedor desenvolvedor],
 people [Ana Souza: vendedor+desenvolvedor; Bruno Lima: finder; Carla Dias: desenvolvedor],
 clients [Padaria Pão Quente],
 products:
   Sistema de gestão (sistema): setup 500000, hasMonthly true, monthly 30000, seller pct 12, sellerWithFinder pct 8, finder pct 4, method boleto, entrada none, 3 parcelas, cycles 12, funcaoCosts [dev pct 20]
   Consultoria (consultoria): kind service, setup 0, monthly 0, seller fix 500 (reais), finder fix 100
   Licença (licenca): setup 100000, defaults otherwise
   Plano mensal (mensal): setup 0, hasMonthly true, monthly 25000, cycles null
*/
export function fakeRefs(extra?: Partial<Record<RefKind, Record<string, RefLookup>>>): RefIndex;
/* resolves catalog names (normalizeLabel) of testCatalog to { existingId }, '#<codeSuffix>' for products,
   plus `extra` entries (workbook planKeys, archived/ambiguous failures) keyed by normalizeLabel(name);
   unknown -> { ok: false, code: 'unknown_ref', message: `"<name>" não está cadastrado.` } */
export function workbook(rows: Partial<Record<SheetKey, Array<{ row: number; cells: Record<string, CellValue> }>>>, issues?: ImportIssue[]): ParsedWorkbook; // starts from emptyParsedWorkbook()
export function productIndex(catalog: ImportCatalog, ops?: ImportOperation[]): ProposalProductIndex; // = buildProposalProductIndex
export function probe(draft: SaleDraft): ReturnType<typeof CreateSaleSchema.safeParse>; // replaces refs by fresh randomUUID()s and runs CreateSaleSchema
```

## File 3 - `apps/api/src/domains/import/__tests__/plan-propostas.test.ts`

Red first: write every case below, run, watch them fail (module missing), then implement.
Unless stated, cases call `planPropostasWith(workbook(...), testCatalog(), fakeRefs(), productIndex(testCatalog()))`, base date `2026-01-31` where month-end clamping matters, else `2026-01-15`.

`describe('basic depth (AC5)')`:
1. `creates an Aberta proposta from cliente, vendedor, produto and data base only` - Propostas row 2 `{ ref: 'P1', cliente: 'Padaria Pão Quente', vendedor: 'Ana Souza', produto: 'Licença', dataBase: '2026-01-15' }` -> exactly one op `{ op: 'createSale', planKey: 'propostas:2', wonOn: null }`, `input` deep-equals `{ clientRef: { existingId: IDS.padaria }, clientName: 'Padaria Pão Quente', sellerRef: { existingId: IDS.ana }, sellerName: 'Ana Souza', finderRef: null, finderName: null, status: 'open', baseDate: '2026-01-15', notes: null, sellerCommissionPct: 10, finderCommissionPct: 3, taxPct: 6, otherCostsBrl: 0, items: [{ productRef: { existingId: IDS.licenca }, areaRef: null, productName: 'Licença', quantity: 1, unitBrl: 100000 }], professionals: [], installments: [{ dueDate: '2026-01-15', amountBrl: 100000, method: 'pix' }], recurring: null }`; issues `[]`; counts `{ propostas: 1 }`.
2. `splits the produto default parcelas with the remainder on the last row like the wizard` - Sistema de gestão with a Licença-like total: use a produto with setup 100000 and 3 parcelas -> amounts `[33333, 33333, 33334]`, dates `2026-01-31`, `2026-02-28`, `2026-03-31`, method = the produto default.
3. `honours a produto default entrada percent with the restante one month later` - entrada pct 30, 2 parcelas, total 100000 -> `[30000 @ base, 35000 @ +1, 35000 @ +2]`.
4. `clamps a produto fixed entrada larger than the total to one parcela` - entrada fix 999999 cents on total 100000 -> `[{ base, 100000 }]`.
5. `caps the produto restante at 119 when it has an entrada` - entrada pct 10, defaultRemainingInstallments 120 -> 120 rows total.
6. `takes the recorrência from the produto mensalidade and default cycles` - Sistema de gestão, base `2026-01-31` -> `recurring: { monthlyBrl: 30000, startDate: '2026-02-28', cycles: 12, method: 'boleto' }`.
7. `leaves the recorrência indefinite when the produto has no default cycles` - Plano mensal -> `cycles: null`.
8. `uses the mensalidade as the unit price of a produto without setup value` - Plano mensal -> `unitBrl: 25000` (the `setupBrl || monthlyBrl` rule) and `recurring.monthlyBrl: 25000`.
9. `takes the seller commission from the produto percent and tax from the settings` - Sistema de gestão, settings `{ 9, 2, 7.5 }` -> seller 12, finder 2, tax 7.5.
10. `falls back to the settings when the produto commission is a fixed value` - Consultoria with valorUnitario 80000 -> seller 10 (settings), finder 3.
11. `uses the with-finder commissions when a Finder is filled` - Sistema de gestão + finder `Bruno Lima` -> seller 8, finder 4, `finderRef { existingId: IDS.bruno }`, `finderName 'Bruno Lima'`.
12. `uses the Quantidade and Valor unitário shortcut columns` - Licença qty 2 valor 45000 -> item `{ quantity: 2, unitBrl: 45000 }`, plan total 90000.
13. `maps Situação to the createSale status and wonOn` - five rows: blank -> open/null; Rascunho (`draft`) -> draft/null; Ganha (`won`, dataGanho `2026-01-20`) -> won/`'2026-01-20'`; Ganha with dataGanho null -> won/null (no issue: slice 05 owns it); Perdida (`lost`) and Cancelada (`cancelled`) with a dataGanho -> open/null.
14. `uses the produto default payment method and lets Forma de pagamento override it` - Sistema de gestão blank -> boleto on every parcela and on the recorrência; `formaPagamento: 'card'` -> card everywhere.

`describe('full depth')`:
15. `builds items from Itens rows in sheet order, produto and free-form` - Itens rows 2 (Licença, qty 1) and 3 (descricao `Treinamento`, area `Tecnologia`, valor 20000) -> items `[{ productRef licenca, areaRef: null, productName 'Licença', 1, 100000 }, { productRef: null, areaRef: { existingId: IDS.area }, productName: 'Treinamento', quantity: 1, unitBrl: 20000 }]`; counts `{ propostas: 1, itens: 2 }`.
16. `takes the defaults from the first item only` - Itens Licença then Sistema de gestão -> seller 10 (Licença), no recorrência; reversed -> seller 12 and the Sistema recorrência.
17. `uses Parcelas rows sorted by vencimento with the method falling back to the proposta then the produto` - two Parcelas rows given out of order (row 2 `2026-03-01`, row 3 `2026-02-01`, one with formaPagamento card) -> installments in date order, the blank one with the proposta/produto method; counts parcelas 2.
18. `refuses Parcelas that do not sum to the items total` - total 100000, parcelas 40000 + 50000 -> one error `{ sheet: 'parcelas', row: <first row>, column: 'Valor (R$)', code: 'installments_sum_mismatch' }` whose message contains `R$ 900,00` and `R$ 1.000,00`; no op.
19. `refuses a zero-value parcela` -> `zero_installment` on that row.
20. `refuses more than 120 parcelas` -> `too_many_installments` on the 121st parcela row.
21. `refuses Parcelas together with Entrada or Número de parcelas` -> `plan_conflict` on the Propostas row, column `Entrada (R$)`.
22. `generates parcelas from the Entrada and Número de parcelas columns over the produto shape` - Sistema de gestão (3 parcelas default) total 500000, entrada 100000, numeroParcelas 2 -> `[100000 @ base, 200000 @ +1, 200000 @ +2]`; numeroParcelas alone 4 -> four rows `[125000 x4]`.
23. `refuses an Entrada larger than the total` and `refuses 120 parcelas with an entrada` -> `entrada_exceeds_total` (column `Entrada (R$)`), `too_many_installments` (column `Número de parcelas`).
24. `overrides the recorrência with Mensalidade, Início and Ciclos` -> `{ monthlyBrl: 40000, startDate: '2026-03-10', cycles: 6 }`.
25. `turns the recorrência off with Mensalidade zero` - Sistema de gestão, mensalidade 0 -> `recurring: null`.
26. `refuses Início or Ciclos without any mensalidade` - Licença + ciclos 6 -> `recurrence_without_monthly`, column `Ciclos da recorrência`.
27. `builds professionals with função, pessoa, explicit cost and divisão in basis points` - Profissionais `{ funcao: 'Desenvolvedor', pessoa: 'Carla Dias', custo: 150000, divisaoCusto: '50; 50' }` with 3 parcelas -> `{ personRef: { existingId: IDS.carla }, funcaoRef: { existingId: IDS.dev }, personName: 'Carla Dias', costBrl: 150000, costSplitBp: [5000, 5000] }`; `'12,5; 87,5'` -> `[1250, 8750]`.
28. `defaults a blank professional cost to the produto função cost basis` - Sistema de gestão (dev pct 20) qty 1 unit 500000 -> `costBrl: 100000`; a função no item declares -> `costBrl: 0`.
29. `refuses a divisão that does not sum to 100, invalid divisão text and more parts than parcelas` -> `cost_split_sum_mismatch` (message contains `90%`), `invalid_pct` (coercePctList code passed through), `cost_split_too_many_parts`; all at column `Divisão do custo (%)`.
30. `warns when the pessoa lacks the função in the cadastro` - Bruno Lima as Desenvolvedor -> one WARNING `person_lacks_funcao` and the op is still emitted.
31. `overrides commissions, tax, outros custos and observações from the columns` -> exact values in the draft.
32. `resolves a produto created in the same workbook through the cadastro planner` (wiring) - `planPropostas` (not `With`) on a workbook whose Produtos tab has one valid row 2 `Produto novo` (area `Tecnologia`, valor 70000, parcelas 2) and a Propostas row citing it; refs = the REAL `buildRefIndex(parsed, catalog)` from `../refs.js` -> item `productRef { planKey: 'produtos:2' }`, `unitBrl 70000`, installments `[35000, 35000]`.

`describe('validation')`:
33. `refuses the Produto shortcut together with Itens rows` -> `items_conflict`, column `Produto`, no op.
34. `refuses a proposta without Produto and without Itens` -> `no_items`.
35. `refuses Quantidade or Valor unitário without a Produto` -> `no_items`, column `Produto`.
36. `refuses a duplicated Ref ignoring case and accents and attaches children to the first` - rows 2 `P1`, 3 `p1` -> `duplicate_ref` on row 3 whose message names line 2; one op for row 2 that holds the Itens rows.
37. `refuses child rows whose Ref is not in Propostas` - one Itens, one Profissionais, one Parcelas row with Ref `P9` -> three `unknown_proposta_ref` with their own sheet and column `Ref`.
38. `refuses a vendedor without the Vendedor função` (Carla Dias) and `refuses a finder without the Finder função` (Ana Souza as Finder) -> `seller_without_funcao` / `finder_without_funcao` on the right header.
39. `accepts a workbook pessoa whose Funções list includes Vendedor` - Pessoas row 2 `{ nome: 'Nova Pessoa', funcoes: ['Vendedor'] }`, fakeRefs extra `person: { 'nova pessoa': { ok: true, ref: { planKey: 'pessoas:2' }, label: 'Nova Pessoa' } }` -> no issue, `sellerRef { planKey: 'pessoas:2' }`; with `funcoes: ['Desenvolvedor']` -> `seller_without_funcao`.
40. `reports a failed reference lookup with the lookup code and message on the right header` - unknown cliente (`unknown_ref`, column `Cliente`), archived produto in Itens (`archived_ref`, sheet itens, column `Produto`), ambiguous pessoa in Profissionais (`ambiguous_ref`, column `Pessoa`); each message equals the fake's message.
41. `refuses a free-form item without Descrição, Área or value` -> the three codes on their headers; `refuses a serviço with no value` (Consultoria shortcut, no valor) -> `negotiated_value_required`.
42. `uses Descrição as the item name only for a serviço and warns otherwise` - Consultoria + descricao `Diagnóstico inicial` + valor 80000 -> productName `Diagnóstico inicial`; Licença + descricao -> warning `description_ignored`, productName `Licença`; Licença + area -> warning `area_ignored`.
43. `refuses a proposta whose total is zero` - Licença with valorUnitario 0 -> `zero_total`, column null.
44. `emits no operation and no extra issue for a proposta with a parser error on its own row or a child row` - `workbook(..., [parserIssue('itens', 3, ...)])` -> `operations` `[]` and the planner `issues` `[]`; same for an error on the Propostas row itself.
45. `skips null required cells silently` - Propostas row with `cliente: null` (and a matching parser `required` issue) -> no op, no planner issue about Cliente.
46. `never puts a raw uuid in a message` - run cases 18, 33, 36-43 and assert no issue message matches `/[0-9a-f]{8}-[0-9a-f]{4}-/i`.
47. `every emitted draft passes CreateSaleSchema once refs become ids` - collect every op produced by cases 1-32 (use a shared helper) and assert `probe(op.input).success === true`.
48. `maps CreateSaleSchema issues to sheet, row and header` - call `mapSaleSchemaIssues` with synthetic issues (`{ code: 'custom', path: ['items', 1, 'unitBrl'], message: 'x' }`, `['professionals', 0, 'costSplitBp']`, `['installments']` with generated and with parcelas sources, `['recurring', 'cycles']`, `['taxPct']`, `['unknown']`) -> the exact `(sheet, row, column)` triples, code `invalid_proposta`, deduped, messages without the zod text.
49. `counts created propostas and the child rows they consume` - two propostas, one refused -> counts include only the created one's Itens/Profissionais/Parcelas rows; zero-valued keys absent.
50. `is pure and deterministic` - deep-freeze (`Object.freeze` recursively) parsed, catalog and the index; two calls return deep-equal results and nothing throws.
51. `round-trips the example workbook with zero errors` (THE oracle for this slice) - `parsed = await parseWorkbook(await buildXlsx(exampleTabs()))`, a fresh catalog (`testCatalog({ areas: [], funcoes: [], people: [], clients: [], products: [], stages: [] })`), refs = REAL `buildRefIndex(parsed, catalog)`; `planPropostas` -> zero issues with severity error, exactly one op `{ planKey: 'propostas:2', wonOn: '2026-01-20' }` with `input.status 'won'`, `clientRef { planKey: 'clientes:2' }`, `sellerRef { planKey: 'pessoas:2' }`, `baseDate '2026-01-15'`, `items [{ productRef: { planKey: 'produtos:2' }, areaRef: null, productName: 'Sistema de gestão', quantity: 1, unitBrl: 500000 }]`, `installments [{ dueDate: '2026-01-20', amountBrl: 500000, method: 'pix' }]`, `recurring { monthlyBrl: 30000, startDate: '2026-02-20', cycles: 12, method: 'pix' }`, `professionals [{ personRef: { planKey: 'pessoas:2' }, funcaoRef: { planKey: 'funcoes:2' }, personName: 'Ana Souza', costBrl: 100000, costSplitBp: null }]`, `sellerCommissionPct 10`, `finderCommissionPct 3`, `taxPct 6`, `notes 'Migrada da planilha antiga.'`; counts `{ propostas: 1, itens: 1, profissionais: 1, parcelas: 1 }`.
    If `buildRefIndex` resolves the example's `Vendedor` função to an existing-shaped ref the check still passes (slug rule); if it does not resolve `Ana Souza` to `{ planKey: 'pessoas:2' }`, STOP and report the seam mismatch with slice 02 rather than editing refs.ts.

`describe('buildProposalProductIndex')`:
52. `projects catalog produtos and createProduct ops with the createProduct with-finder fallback` - an op without `sellerWithFinderCommission*` -> index entry carries the seller type/value; funcaoCosts keyed by `refKeyOf(funcaoRef)`; catalog costs keyed by `id:<funcaoId>`.

## Exports for slice 05

Agreed with slice 05's plan (`05-plan-desfechos.md`, Seam deviations 1-3); nothing extra is exported for it:
- every createSale op has `planKey === \`propostas:${excelRow}\``;
- `input.status` is `'draft'` for Rascunho, `'won'` for Ganha, `'open'` for blank, Aberta, Perdida and Cancelada (slice 05 appends the transition);
- `wonOn` is `cellReader('propostas', row).text('dataGanho')` when Situação is Ganha (raw, possibly null, never validated here) and `null` otherwise;
- `input.installments` and `input.recurring` are exactly what the executor passes to createSale, so slice 05's `plannedReceivableLabels(op.input)` gives the labels createSale will write;
- a refused proposta (any error on it or its children, or a duplicate Ref row) has NO op; slice 05 then stays silent;
- Ref equality is `normalizeLabel(ref)`; a Ref that appears twice is reported here as `duplicate_ref`.

## Commands (run once each, never watch mode)

```bash
pnpm --filter @fxl-sales/api exec vitest run src/domains/import/__tests__/plan-propostas.test.ts
pnpm --filter @fxl-sales/api exec eslint src/domains/import/plan/propostas.ts src/domains/import/__tests__/plan-propostas.test.ts src/domains/import/__tests__/propostas-fixtures.ts
pnpm --filter @fxl-sales/api type-check
pnpm --filter @fxl-sales/api test
```

Named locked oracle: `apps/api/src/domains/import/__tests__/plan-propostas.test.ts` (in particular `creates an Aberta proposta from cliente, vendedor, produto and data base only`, `splits the produto default parcelas with the remainder on the last row like the wizard`, `every emitted draft passes CreateSaleSchema once refs become ids`, `round-trips the example workbook with zero errors`).
If `@fxl-sales/shared-utils/*` fails to resolve, run `pnpm run build:packages` once at the repo root and retry.

## Seam deviations (proposed amendments, for the orchestrator)

1. `profissionais.pessoa` help in `workbook-schema.ts` (slice 01) says "ela recebe a função se ainda não a tiver". The import is create-only and `ImportOperation` has no op that changes a pessoa, so the planner cannot grant the função. Proposed help text: `Pessoa que exerce a função no projeto; o cadastro da pessoa não é alterado.` Slice 04 emits the warning `person_lacks_funcao` instead. If slice 01 is already merged, the text change is a one-line follow-up owned by slice 01's files (also re-check that the `gives every column a pt-BR help sentence` test still passes); the example story is unaffected (Ana Souza already holds Desenvolvedor).
2. `planPropostas` calls `planCadastros(parsed, catalog, refs)` internally to read the defaults of produtos the workbook creates (decision P1). Slice 07's `planImport` therefore runs `planCadastros` twice per plan; it is pure, so the result is unchanged. Slice 02 must keep `planCadastros` free of side effects and of non-determinism (no random planKeys), which the contract already demands.
3. Slice 05 stated its expectations of this slice; this plan adopts them verbatim (see `## Exports for slice 05`). No receivable-label export is added here.
