---
id: 01-contract-and-parser
milestone: v4.2.0
status: done
depends_on: []
files_modified:
  - apps/api/package.json
  - pnpm-lock.yaml
  - apps/api/src/domains/import/types.ts
  - apps/api/src/domains/import/workbook-schema.ts
  - apps/api/src/domains/import/cells.ts
  - apps/api/src/domains/import/parse.ts
  - apps/api/src/domains/import/__tests__/xlsx-fixture.ts
  - apps/api/src/domains/import/__tests__/cells.test.ts
  - apps/api/src/domains/import/__tests__/parse.test.ts
  - apps/api/src/domains/import/__tests__/workbook-schema.test.ts
  - apps/api/src/domains/import/__tests__/exceljs-pin.test.ts
acceptance: "Given xlsx bytes generated in-test with exceljs, parseWorkbook returns a ParsedWorkbook with all 13 SheetKeys, coerced cells (integer cents, ISO civil days, enum values, booleans, string lists) and pt-BR issues carrying sheet, Excel row and header text; a non-xlsx buffer yields exactly one invalid_file issue without throwing; a workbook made of every sheet's headers plus its example row parses with zero issues; and exceljs is pinned exactly at 4.4.0 in apps/api dependencies with the lockfile updated."
goal: "Ship the import seam foundation: the exact exceljs pin, every shared type (types.ts), the one sheet/column catalogue (workbook-schema.ts), pure cell coercers (cells.ts) and the xlsx parser (parse.ts), each with unit oracles, so slices 02-09 only consume and never edit these files."
must_not_break:
  - "pnpm --filter @fxl-sales/api test (whole unit suite)"
  - "pnpm --filter @fxl-sales/api lint"
  - "pnpm --filter @fxl-sales/api type-check (tsconfig.json, tsconfig.scripts.json, tsconfig.test.json)"
  - scripts/__tests__/auth-fake-isolation.test.mjs
  - scripts/__tests__/api-dockerfile-workspace-deps.test.mjs
  - scripts/__tests__/api-test-typecheck.test.mjs
  - scripts/__tests__/hub-sdk-pin.test.mjs
  - scripts/__tests__/fxl-contracts-pin.test.mjs
rules:
  - "exceljs is pinned EXACTLY (`\"exceljs\": \"4.4.0\"`, no caret, no tilde) in apps/api `dependencies`, added with `pnpm --filter @fxl-sales/api add exceljs@4.4.0 --save-exact`, and pnpm-lock.yaml changes in the same commit. No other dependency is added (no @types/exceljs: the package ships index.d.ts)."
  - "types.ts holds types only, plus `import type` from sales-ops; it has no runtime code. workbook-schema.ts, cells.ts and parse.ts never read the clock, process.env or the database."
  - "cells.ts and parse.ts never call `new Date()` without an argument and never use `toISOString().slice(0, 10)`; a civil day is built from getUTCFullYear/getUTCMonth/getUTCDate and validated with isIsoDay imported from '@fxl-sales/shared-utils/sao-paulo-day' (subpath, never the package root)."
  - "Money is integer cents everywhere; no float survives a money coercion."
  - "Every issue message is pt-BR, names the offending value as the user typed it, and never contains a uuid or a column key; `column` is always the header text."
  - "parseWorkbook NEVER throws for user input: any exceljs/JSZip failure becomes one `invalid_file` issue."
  - "Do not touch apps/web/** and do not touch apps/web/src/sales-ops/leads/** (live peer run)."
  - "No em dash in any file; relative imports use the `.js` extension (NodeNext)."
verifier_focus: "That types.ts is complete enough that no later slice must edit it (ProductCatalogEntry, ImportCatalog incl. settings, every ImportOperation, SaleDraft, RefKind/RefLookup/RefIndex, SheetPlanResult, preview/commit bodies); that the example-row round trip test truly builds a workbook from WORKBOOK_SHEETS headers and examples (not a hand-copied list); that a non-xlsx buffer does not throw; and that the exceljs pin is exact in both package.json and the lockfile importer entry."
---

# Slice 01 - Contract and parser

## Objective

Lay the shared foundation of the `importacao-planilha` feature in `apps/api/src/domains/import/`.
After this slice, `parseWorkbook(bytes)` turns an uploaded `.xlsx` into typed, coerced rows plus pt-BR issues, and every type the later slices need already exists.
Nothing is mounted, nothing is written to the database, no route exists yet.

## Code facts (verified while planning)

- Package name is `@fxl-sales/api`; unit tests run with `vitest run` and include `src/**/__tests__/**/*.test.ts` (see `apps/api/vitest.config.ts`); setup file `test/unit-setup.ts` only blanks Hub env vars.
- A helper file under `__tests__/` that does not end in `.test.ts` is not collected as a test (pattern above), so `xlsx-fixture.ts` is safe.
- `tsconfig.base.json`: `module`/`moduleResolution` `NodeNext`, `strict`, `noUncheckedIndexedAccess: true`, `esModuleInterop: true`, `isolatedModules: true`, `skipLibCheck: true`, `lib: ES2022, DOM`. Relative imports need `.js`.
- ESLint (`apps/api/eslint.config.js`): `@typescript-eslint/no-explicit-any: error`, `no-unused-vars` with `argsIgnorePattern: '^_'`, plus the recommended sets. So no `any`; use `unknown` and narrow.
- Shared-utils subpath import, exactly as `sales-ops/service.ts` does: `import { isIsoDay } from '@fxl-sales/shared-utils/sao-paulo-day';`. It resolves to `packages/shared-utils/dist`, which `pnpm run build:packages` builds (already built locally).
- `exceljs` latest 4.x is `4.4.0` (`pnpm view exceljs version`). It is CommonJS (`module.exports = require('./lib/exceljs.nodejs.js')`) with bundled `index.d.ts` (named exports only).
  Import it as `import ExcelJS from 'exceljs';` and use `new ExcelJS.Workbook()`; this is legal under NodeNext with `esModuleInterop` and works at runtime.
- `index.d.ts` declares its OWN module-scoped `interface Buffer extends ArrayBuffer {}`; `xlsx.load(buffer: Buffer)` therefore wants an ArrayBuffer-shaped value, and `xlsx.writeBuffer()` resolves to that same type.
  To stay type-safe without `as unknown as`, `parse.ts` copies the input into a fresh `ArrayBuffer` (`const ab = new ArrayBuffer(bytes.byteLength); new Uint8Array(ab).set(bytes);`) and calls `workbook.xlsx.load(ab)`. JSZip accepts an ArrayBuffer at runtime. In tests, `Buffer.from(await wb.xlsx.writeBuffer())`.
- exceljs reads a date-formatted numeric cell back as a JS `Date` built from the serial in UTC; a percent-formatted cell keeps its fraction (`0.1`) in `cell.value` and exposes the format in `cell.numFmt` (contains `%`).
  Cell values may also be `{ richText: [{ text }] }`, `{ text, hyperlink }`, `{ formula, result? }`, `{ sharedFormula, result? }` or `{ error: '#N/A' }`.
- Domain schemas this catalogue mirrors (`apps/api/src/domains/sales-ops/service.ts`): `AreaSchema` (name max 120), `FuncaoSchema` (name max 120), `ProductSchema` = `ProductFieldsSchema.superRefine(...)` (name max 140, `codeSuffix` `/^\d{1,2}$/`, money in cents, commission VALUES are plain numbers: percent for `pct`, REAIS for `fix`), `ProductFuncaoCostSchema` (`pct` with `valuePct` 0..100, or `fix` with `valueBrl` cents), `PersonSchema` (displayName max 120, contactEmail email), `ClientSchema` (name 160, contact 200, legalName 200, document 32, address 400, legalRepName 200, legalRepDocument 32), `CreateSaleSchema` (items, professionals with optional `costSplitBp`, installments 1..120, recurring with positive `monthlyBrl`, cycles 1..120 or null, methods `pix|card|boleto|transfer`).
  `LeadStageSchema` (name 120) in `leads/schemas.ts`; `CreateLeadSchema` (contactName 140, clientName 200, description 4000, products max 50) in `leads/lead-schemas.ts`; `MoveLeadSchema.reason` max 500.
- Product DB numeric columns (`seller_commission_value`, `default_entrada_pct`, ...) are `numeric` and come back from drizzle as STRINGS; `ProductCatalogEntry` below carries them as numbers (slice 02 converts once).
- The web labels payment methods `Pix`, `Cartão`, `Boleto`, `Transferência` and statuses `Rascunho`, `Aberta`, `Ganha`, `Perdida`, `Cancelada`.
- Seeded lead stages are `Novo`, `Em negociação`, `Proposta` (conversion), `Perdido` (lost) (`LEAD_STAGE_SEEDS` in `leads/stages-seed.ts`), so the Etapas example must be a different name.
- Excel serial for 2026-01-15 is `46037` (epoch 1899-12-30).

## Step 0 - dependency

```bash
pnpm --filter @fxl-sales/api add exceljs@4.4.0 --save-exact
```

Then confirm `apps/api/package.json` has `"exceljs": "4.4.0"` in `dependencies` (alphabetical position between `dotenv` and `hono` is what pnpm writes) and that `pnpm-lock.yaml` has the `apps/api` importer entry `exceljs: specifier: 4.4.0`.
Run `pnpm audit --prod --filter @fxl-sales/api` once and paste the summary into the exec notes (exceljs 4.4.0 pulls `archiver@5`, `unzipper@0.10`, `tmp@0.2`, `uuid@8`); a high/critical advisory is a blocker to report, not to fix with overrides in this slice.

## File 1 - `apps/api/src/domains/import/types.ts`

Write it EXACTLY as below (comments may be shortened, names and shapes may not change).

```ts
import type {
  AreaInput,
  ClientInput,
  CreateSaleInput,
  FuncaoInput,
  PaymentMethod,
  PersonInput,
  ProductEntradaMode,
  ProductFuncaoCostInput,
  ProductInput,
  ProductKind,
} from '../sales-ops/service.js';
import type { LeadStageInput } from '../sales-ops/leads/schemas.js';
import type { CreateLeadInput } from '../sales-ops/leads/lead-schemas.js';

/** The 13 data sheets, in dependency order. `Leia-me` and `Listas` are not SheetKeys. */
export type SheetKey =
  | 'areas' | 'funcoes' | 'produtos' | 'custosProduto' | 'pessoas' | 'clientes' | 'etapas'
  | 'leads' | 'propostas' | 'itens' | 'profissionais' | 'parcelas' | 'pagamentos';

/** After coercion: money/int/pct are numbers (money in CENTS), day is an ISO civil day, enum is the option VALUE, list is string[]. */
export type CellValue = string | number | boolean | string[] | null;
export type ParsedRow = { row: number; cells: Record<string, CellValue> };
export type ParsedSheet = { key: SheetKey; rows: ParsedRow[] };
export type ParsedWorkbook = { sheets: Record<SheetKey, ParsedSheet>; issues: ImportIssue[] };

export type ImportIssueSeverity = 'error' | 'warning';
export type ImportIssue = {
  severity: ImportIssueSeverity;
  sheet: SheetKey | null;
  row: number | null;
  column: string | null;
  code: string;
  message: string;
};

export type CommissionType = 'pct' | 'fix';

export type ProductCatalogFuncaoCost =
  | { funcaoId: string; mode: 'pct'; valuePct: number }
  | { funcaoId: string; mode: 'fix'; valueBrl: number };

/**
 * The full product row projection the planners need. Numeric DB columns are
 * NUMBERS here (slice 02 converts drizzle's numeric strings once).
 * Commission values: percent when the type is 'pct', REAIS (not cents) when 'fix',
 * exactly as ProductSchema stores them. Money fields are integer cents.
 */
export type ProductCatalogEntry = {
  id: string;
  name: string;
  codeSuffix: string;
  kind: ProductKind;
  areaId: string | null;
  status: string;
  setupBrl: number;
  hasMonthly: boolean;
  monthlyBrl: number;
  recurringCommission: boolean;
  hasFinderCommission: boolean;
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
  productFuncaoCosts: ProductCatalogFuncaoCost[];
};

/** The org's sales_ops_settings defaults a proposta falls back to (10 / 3 / 6 when the org has no row). */
export type ImportCatalogSettings = {
  defaultSellerCommissionPct: number;
  defaultFinderCommissionPct: number;
  defaultTaxPct: number;
};

export type ImportCatalog = {
  today: string;
  producerFlowLive: boolean;
  settings: ImportCatalogSettings;
  areas: Array<{ id: string; name: string; status: string }>;
  funcoes: Array<{ id: string; name: string; slug: string; isSystem: boolean; status: string }>;
  /** Every produto of the org, archived included (code suffixes stay unique across both). */
  products: ProductCatalogEntry[];
  people: Array<{ id: string; displayName: string; contactEmail: string | null; status: string; funcaoSlugs: string[]; funcaoIds: string[] }>;
  clients: Array<{ id: string; name: string; document: string | null }>;
  stages: Array<{ id: string; name: string; kind: 'normal' | 'conversion' | 'lost'; status: string; position: number }>;
};

export type EntityRef = { existingId: string } | { planKey: string };

export type SaleDraft = Omit<CreateSaleInput, 'clientId' | 'sellerPersonId' | 'finderPersonId' | 'items' | 'professionals'> & {
  clientRef: EntityRef | null;
  sellerRef: EntityRef;
  finderRef: EntityRef | null;
  items: Array<Omit<CreateSaleInput['items'][number], 'productId' | 'areaId'> & { productRef: EntityRef | null; areaRef: EntityRef | null }>;
  professionals: Array<Omit<CreateSaleInput['professionals'][number], 'personId' | 'funcaoId'> & { personRef: EntityRef | null; funcaoRef: EntityRef | null }>;
};

export type ImportOperation =
  | { op: 'createArea'; planKey: string; input: AreaInput }
  | { op: 'createFuncao'; planKey: string; input: FuncaoInput }
  | { op: 'createProduct'; planKey: string; input: Omit<ProductInput, 'areaId' | 'productFuncaoCosts'>; areaRef: EntityRef; funcaoCosts: Array<{ funcaoRef: EntityRef; cost: Omit<ProductFuncaoCostInput, 'funcaoId'> }> }
  | { op: 'createPerson'; planKey: string; input: Omit<PersonInput, 'funcaoIds'>; funcaoRefs: EntityRef[] }
  | { op: 'createClient'; planKey: string; input: ClientInput }
  | { op: 'createLeadStage'; planKey: string; input: LeadStageInput }
  | { op: 'createLead'; planKey: string; input: Omit<CreateLeadInput, 'clientId' | 'sellerPersonId' | 'products'>; clientRef: EntityRef | null; sellerRef: EntityRef | null; products: Array<{ productRef: EntityRef | null; name: string }>; stageRef: EntityRef | null; lostReason: string | null }
  | { op: 'createSale'; planKey: string; input: SaleDraft; wonOn: string | null }
  | { op: 'transitionSale'; saleKey: string; to: 'lost' | 'cancelled' }
  | { op: 'settleReceivable'; saleKey: string; receivableLabel: string; paidOn: string; settlePayables: boolean };

export type ImportOperationKind = ImportOperation['op'];

export type ImportCounts = Partial<Record<SheetKey, number>>;

export type ImportPlan = { operations: ImportOperation[]; issues: ImportIssue[]; counts: ImportCounts };

export type SheetPlanResult = { operations: ImportOperation[]; issues: ImportIssue[]; counts: ImportCounts };

export type RefKind = 'area' | 'funcao' | 'product' | 'person' | 'client' | 'stage';
export type RefLookupFailureCode = 'unknown_ref' | 'archived_ref' | 'ambiguous_ref';
export type RefLookup =
  | { ok: true; ref: EntityRef; label: string }
  | { ok: false; code: RefLookupFailureCode; message: string };
export interface RefIndex {
  resolve(kind: RefKind, name: string): RefLookup;
}

/** Wire bodies of POST /preview and POST /commit (slice 07 answers them, slice 09 mirrors them). */
export type ImportPreviewBody = { ok: boolean; counts: ImportCounts; issues: ImportIssue[]; truncated: boolean };
export type ImportCommitBody = { counts: ImportCounts };
```

If `tsc` rejects `Omit<CreateSaleInput['items'][number], ...>` or any other line, fix the expression without changing the resulting shape and record it in the exec notes.

## File 2 - `apps/api/src/domains/import/workbook-schema.ts`

Imports: `import type { SheetKey } from './types.js';` only.

### Exports (exact)

```ts
export type CellKind =
  | { type: 'text'; max: number }
  | { type: 'money' }
  | { type: 'int'; min: number; max: number }
  | { type: 'pct' }
  | { type: 'day' }
  | { type: 'enum'; options: readonly { label: string; value: string }[] }
  | { type: 'bool' }
  | { type: 'list'; max: number };

export type ListSource =
  | 'areas' | 'funcoes' | 'produtos' | 'pessoas' | 'vendedores' | 'finders'
  | 'clientes' | 'etapas' | 'enum';

export type ColumnDef = {
  key: string;
  header: string;
  kind: CellKind;
  required: boolean;
  help: string;
  example: string | number | null;
  list?: ListSource;
  /** Template hint (slice 08): the dropdown must ACCEPT values outside the list (Excel errorStyle 'information'). */
  freeText?: boolean;
};

export type SheetDef = { key: SheetKey; tab: string; columns: readonly ColumnDef[]; maxRows: number };

export const LEIAME_TAB = 'Leia-me';
export const LISTAS_TAB = 'Listas';
export const MAX_TOTAL_ROWS = 5000;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_RETURNED_ISSUES = 500;

export const SHEET_KEYS = ['areas','funcoes','produtos','custosProduto','pessoas','clientes','etapas','leads','propostas','itens','profissionais','parcelas','pagamentos'] as const satisfies readonly SheetKey[];

export const PRODUCT_KIND_OPTIONS = [{ label: 'Produto', value: 'product' }, { label: 'Serviço', value: 'service' }] as const;
export const PAYMENT_METHOD_OPTIONS = [
  { label: 'Pix', value: 'pix' }, { label: 'Cartão', value: 'card' },
  { label: 'Boleto', value: 'boleto' }, { label: 'Transferência', value: 'transfer' },
] as const;
export const SALE_STATUS_OPTIONS = [
  { label: 'Rascunho', value: 'draft' }, { label: 'Aberta', value: 'open' }, { label: 'Ganha', value: 'won' },
  { label: 'Perdida', value: 'lost' }, { label: 'Cancelada', value: 'cancelled' },
] as const;
/** Labels a bool column accepts on output (template dropdown); input is wider, see cells.ts. */
export const BOOL_LABELS = { true: 'Sim', false: 'Não' } as const;

export const WORKBOOK_SHEETS = [ /* the 13 SheetDefs below, in SHEET_KEYS order */ ] as const satisfies readonly SheetDef[];

/** Column key union of one sheet, derived from WORKBOOK_SHEETS (compile-time typo guard for planners). */
export type ColumnKey<K extends SheetKey> = Extract<(typeof WORKBOOK_SHEETS)[number], { key: K }>['columns'][number]['key'];

export function getSheetDef(key: SheetKey): SheetDef;           // throws Error for an unknown key (programmer error)
export function getColumnDef(sheet: SheetKey, key: string): ColumnDef; // throws Error when absent
```

`as const satisfies readonly SheetDef[]` is load-bearing: it keeps the literal keys for `ColumnKey` while checking every entry against `SheetDef`.
If TS cannot satisfy `options: readonly {...}[]` with the `as const` option tuples, keep `as const` on the options constants and reference them; do not widen `WORKBOOK_SHEETS` to `SheetDef[]` (that would erase `ColumnKey`).

Help sentences: one pt-BR sentence each, ending with a period, no em dash.
Examples: a cross-sheet coherent story (the example template must round-trip with zero errors in a fresh org).
`list: 'enum'` is set on EVERY enum and bool column and on no other column.
`freeText: true` is set on every `list`-kind column that has a reference list, and on `leads.empresa`.

### Sheet catalogue (implement every row verbatim)

Kind shorthand: `text(N)`, `money`, `int(a..b)`, `pct`, `day`, `enum(OPTS)`, `bool`, `list(N)`. `R` = required.

**1. `areas` - tab `Áreas` - maxRows 500**

| key | header | kind | R | list | example | help |
| --- | --- | --- | --- | --- | --- | --- |
| nome | Nome | text(120) | yes | - | `Tecnologia` | Nome da área, por exemplo Tecnologia ou Marketing. |

**2. `funcoes` - tab `Funções` - maxRows 200**

| key | header | kind | R | list | example | help |
| --- | --- | --- | --- | --- | --- | --- |
| nome | Nome | text(120) | yes | - | `Desenvolvedor` | Nome da função que uma pessoa exerce; Vendedor e Finder já existem e não precisam ser criados. |

**3. `produtos` - tab `Produtos` - maxRows 1000**

| key | header | kind | R | list | example | help |
| --- | --- | --- | --- | --- | --- | --- |
| nome | Nome | text(140) | yes | - | `Sistema de gestão` | Nome do produto ou serviço. |
| tipo | Tipo | enum(PRODUCT_KIND_OPTIONS) | no | enum | `Produto` | Produto ou Serviço; em branco vale Produto. |
| codigo | Código | int(0..99) | no | - | null | Número do código (0 a 99); em branco, o próximo número livre é usado. |
| area | Área | text(120) | yes | areas | `Tecnologia` | Área do produto, já cadastrada ou criada na aba Áreas. |
| valor | Valor (R$) | money | no | - | `R$ 5.000,00` | Preço de setup de um Produto ou valor base de um Serviço; em branco ou zero significa valor variável. |
| temMensalidade | Tem mensalidade | bool | no | enum | `Sim` | Sim quando o produto cobra mensalidade recorrente. |
| mensalidade | Mensalidade (R$) | money | no | - | `R$ 300,00` | Valor mensal padrão, usado quando Tem mensalidade é Sim. |
| comissaoRecorrente | Comissão sobre recorrência | bool | no | enum | `Não` | Sim quando a comissão também incide sobre as mensalidades. |
| comissionaFinder | Comissiona finder | bool | no | enum | `Sim` | Sim quando o produto paga comissão a quem indicou a venda. |
| comissaoVendedorPct | Comissão do vendedor (%) | pct | no | - | `10%` | Comissão padrão do vendedor em percentual; preencha esta coluna ou a de valor fixo, não as duas. |
| comissaoVendedorBrl | Comissão do vendedor (R$) | money | no | - | null | Comissão padrão do vendedor em valor fixo; preencha esta coluna ou a de percentual, não as duas. |
| comissaoVendedorComFinderPct | Comissão do vendedor com finder (%) | pct | no | - | `8%` | Comissão do vendedor quando há finder, em percentual; em branco vale a comissão do vendedor. |
| comissaoVendedorComFinderBrl | Comissão do vendedor com finder (R$) | money | no | - | null | Comissão do vendedor quando há finder, em valor fixo. |
| comissaoFinderPct | Comissão do finder (%) | pct | no | - | `3%` | Comissão padrão do finder em percentual; preencha esta coluna ou a de valor fixo, não as duas. |
| comissaoFinderBrl | Comissão do finder (R$) | money | no | - | null | Comissão padrão do finder em valor fixo. |
| formaPagamento | Forma de pagamento padrão | enum(PAYMENT_METHOD_OPTIONS) | no | enum | `Pix` | Forma de pagamento sugerida nas propostas; em branco vale Pix. |
| entradaPct | Entrada padrão (%) | pct | no | - | null | Entrada sugerida em percentual do total; preencha esta coluna ou a de valor, não as duas. |
| entradaBrl | Entrada padrão (R$) | money | no | - | null | Entrada sugerida em valor fixo; preencha esta coluna ou a de percentual, não as duas. |
| parcelas | Parcelas padrão | int(1..120) | no | - | `3` | Número de parcelas do restante, de 1 a 120; em branco vale 1. |
| ciclosRecorrencia | Ciclos de recorrência | int(1..120) | no | - | `12` | Número de mensalidades, de 1 a 120; em branco a recorrência é por prazo indeterminado. |

**4. `custosProduto` - tab `Custos por produto` - maxRows 2000**

| key | header | kind | R | list | example | help |
| --- | --- | --- | --- | --- | --- | --- |
| produto | Produto | text(140) | yes | produtos | `Sistema de gestão` | Produto que recebe o custo padrão, já cadastrado ou criado na aba Produtos. |
| funcao | Função | text(120) | yes | funcoes | `Desenvolvedor` | Função que recebe o custo; Vendedor e Finder não entram aqui porque já têm comissão. |
| custoPct | Custo (%) | pct | no | - | `20%` | Custo padrão em percentual do item; preencha esta coluna ou a de valor, não as duas. |
| custoBrl | Custo (R$) | money | no | - | null | Custo padrão em valor fixo; preencha esta coluna ou a de percentual, não as duas. |

**5. `pessoas` - tab `Pessoas` - maxRows 2000**

| key | header | kind | R | list | freeText | example | help |
| --- | --- | --- | --- | --- | --- | --- | --- |
| nome | Nome | text(120) | yes | - | - | `Ana Souza` | Nome da pessoa como aparece nas propostas. |
| email | E-mail | text(254) | no | - | - | `ana@exemplo.com.br` | E-mail de contato da pessoa. |
| funcoes | Funções | list(20) | yes | funcoes | true | `Vendedor; Desenvolvedor` | Funções da pessoa separadas por ponto e vírgula, por exemplo Vendedor; Finder. |

**6. `clientes` - tab `Clientes` - maxRows 5000**

| key | header | kind | R | example | help |
| --- | --- | --- | --- | --- | --- |
| nome | Nome | text(160) | yes | `Padaria Pão Quente` | Nome do cliente como aparece nas propostas. |
| contato | Contato | text(200) | no | `Marcos Pereira, (11) 98888-7777` | Pessoa de contato, telefone ou e-mail. |
| razaoSocial | Razão social | text(200) | no | `Padaria Pão Quente Ltda.` | Razão social do cliente. |
| documento | CNPJ/CPF | text(32) | no | `12.345.678/0001-90` | CNPJ ou CPF do cliente, digitado como texto. |
| endereco | Endereço | text(400) | no | `Rua das Flores, 100, São Paulo - SP` | Endereço completo do cliente. |
| representante | Representante legal | text(200) | no | `Marcos Pereira` | Nome do representante legal. |
| documentoRepresentante | CPF do representante | text(32) | no | `123.456.789-00` | CPF do representante legal, digitado como texto. |

**7. `etapas` - tab `Etapas` - maxRows 50**

| key | header | kind | R | example | help |
| --- | --- | --- | --- | --- | --- |
| nome | Nome | text(120) | yes | `Diagnóstico` | Nome de uma nova etapa do funil de leads, criada depois das etapas existentes. |

**8. `leads` - tab `Leads` - maxRows 5000**

| key | header | kind | R | list | freeText | example | help |
| --- | --- | --- | --- | --- | --- | --- | --- |
| contato | Contato | text(140) | yes | - | - | `Carlos Lima` | Nome da pessoa de contato do lead. |
| empresa | Empresa | text(200) | yes | clientes | true | `Padaria Pão Quente` | Nome da empresa; quando é um cliente cadastrado, o lead fica ligado a ele. |
| valorEstimado | Valor estimado (R$) | money | no | - | - | `R$ 12.000,00` | Valor estimado do negócio. |
| descricao | Descrição | text(4000) | no | - | - | `Quer trocar o sistema de caixa.` | Observações sobre o lead. |
| vendedor | Vendedor | text(120) | no | vendedores | - | `Ana Souza` | Pessoa com a função Vendedor responsável pelo lead; em branco o lead fica sem vendedor. |
| produtos | Produtos | list(50) | no | produtos | true | `Sistema de gestão` | Produtos de interesse separados por ponto e vírgula; nomes fora do cadastro ficam como texto. |
| etapa | Etapa | text(120) | no | etapas | - | `Diagnóstico` | Etapa do funil; em branco o lead entra na primeira etapa, e a etapa de conversão não é aceita. |
| motivoPerda | Motivo da perda | text(500) | no | - | - | null | Obrigatório quando a etapa é a de leads perdidos. |

**9. `propostas` - tab `Propostas` - maxRows 2000**

| key | header | kind | R | list | example | help |
| --- | --- | --- | --- | --- | --- | --- |
| ref | Ref | text(40) | yes | - | `P1` | Identificador que você escolhe para a proposta; as abas de itens, profissionais, parcelas e pagamentos usam o mesmo Ref. |
| cliente | Cliente | text(160) | yes | clientes | `Padaria Pão Quente` | Cliente da proposta, já cadastrado ou criado na aba Clientes. |
| vendedor | Vendedor | text(120) | yes | vendedores | `Ana Souza` | Pessoa com a função Vendedor. |
| finder | Finder | text(120) | no | finders | null | Pessoa com a função Finder que indicou a venda, se houver. |
| situacao | Situação | enum(SALE_STATUS_OPTIONS) | no | enum | `Ganha` | Rascunho, Aberta, Ganha, Perdida ou Cancelada; em branco vale Aberta. |
| dataBase | Data base | day | yes | - | `15/01/2026` | Data de referência da proposta, no formato dd/mm/aaaa. |
| dataGanho | Data de ganho | day | no | - | `20/01/2026` | Dia em que a proposta foi ganha; obrigatória quando a situação é Ganha e nunca no futuro. |
| produto | Produto | text(140) | no | produtos | null | Produto de uma proposta simples; deixe em branco quando a proposta usa a aba Itens da proposta. |
| quantidade | Quantidade | int(1..100000) | no | - | null | Quantidade do produto da proposta simples; em branco vale 1. |
| valorUnitario | Valor unitário (R$) | money | no | - | null | Valor negociado do produto da proposta simples; em branco usa o valor do cadastro. |
| formaPagamento | Forma de pagamento | enum(PAYMENT_METHOD_OPTIONS) | no | enum | `Pix` | Forma de pagamento das parcelas geradas; em branco usa o padrão do produto. |
| entradaBrl | Entrada (R$) | money | no | - | null | Valor de entrada quando as parcelas são geradas; deixe em branco ao usar a aba Parcelas. |
| numeroParcelas | Número de parcelas | int(1..120) | no | - | null | Número de parcelas geradas para o restante; deixe em branco ao usar a aba Parcelas. |
| mensalidade | Mensalidade (R$) | money | no | - | `R$ 300,00` | Valor da recorrência mensal; em branco usa o padrão do produto e zero significa sem recorrência. |
| inicioRecorrencia | Início da recorrência | day | no | - | `20/02/2026` | Primeiro vencimento da recorrência; em branco é um mês depois da data base. |
| ciclosRecorrencia | Ciclos da recorrência | int(1..120) | no | - | `12` | Número de mensalidades; em branco usa o padrão do produto ou prazo indeterminado. |
| comissaoVendedorPct | Comissão do vendedor (%) | pct | no | - | null | Comissão do vendedor nesta proposta; em branco usa o padrão do produto ou da configuração. |
| comissaoFinderPct | Comissão do finder (%) | pct | no | - | null | Comissão do finder nesta proposta; em branco usa o padrão do produto ou da configuração. |
| impostoPct | Imposto (%) | pct | no | - | null | Imposto sobre a proposta; em branco usa o padrão da configuração. |
| outrosCustos | Outros custos (R$) | money | no | - | null | Outros custos da proposta, pagos de uma vez. |
| observacoes | Observações | text(2000) | no | - | `Migrada da planilha antiga.` | Anotações livres sobre a proposta. |

**10. `itens` - tab `Itens da proposta` - maxRows 5000**

| key | header | kind | R | list | example | help |
| --- | --- | --- | --- | --- | --- | --- |
| ref | Ref | text(40) | yes | - | `P1` | Ref da proposta na aba Propostas. |
| produto | Produto | text(140) | no | produtos | `Sistema de gestão` | Produto do item; deixe em branco para um item avulso. |
| descricao | Descrição | text(140) | no | - | null | Nome do item avulso, obrigatório quando Produto está em branco. |
| area | Área | text(120) | no | areas | null | Área do item avulso, obrigatória quando Produto está em branco. |
| quantidade | Quantidade | int(1..100000) | no | - | `1` | Quantidade do item; em branco vale 1. |
| valorUnitario | Valor unitário (R$) | money | no | - | `R$ 5.000,00` | Valor negociado por unidade; em branco usa o valor do cadastro do produto. |

**11. `profissionais` - tab `Profissionais da proposta` - maxRows 5000**

| key | header | kind | R | list | example | help |
| --- | --- | --- | --- | --- | --- | --- |
| ref | Ref | text(40) | yes | - | `P1` | Ref da proposta na aba Propostas. |
| funcao | Função | text(120) | yes | funcoes | `Desenvolvedor` | Função do profissional no projeto. |
| pessoa | Pessoa | text(120) | yes | pessoas | `Ana Souza` | Pessoa que exerce a função; ela recebe a função se ainda não a tiver. |
| custo | Custo (R$) | money | no | - | `R$ 1.000,00` | Custo alocado ao profissional; em branco usa o custo padrão do produto para a função. |
| divisaoCusto | Divisão do custo (%) | text(1000) | no | - | null | Percentuais do custo por parcela separados por ponto e vírgula e somando 100, por exemplo 50; 50; em branco divide proporcionalmente. |

`divisaoCusto` is deliberately `text`, not `list`: a list splits on commas, and a Brazilian decimal like `12,5` contains one. Slice 04 parses it with `coercePctList` from `cells.ts`.

**12. `parcelas` - tab `Parcelas` - maxRows 5000**

| key | header | kind | R | list | example | help |
| --- | --- | --- | --- | --- | --- | --- |
| ref | Ref | text(40) | yes | - | `P1` | Ref da proposta na aba Propostas. |
| vencimento | Vencimento | day | yes | - | `20/01/2026` | Data de vencimento da parcela, no formato dd/mm/aaaa. |
| valor | Valor (R$) | money | yes | - | `R$ 5.000,00` | Valor da parcela; a soma das parcelas deve ser igual ao total dos itens. |
| formaPagamento | Forma de pagamento | enum(PAYMENT_METHOD_OPTIONS) | no | enum | `Pix` | Forma de pagamento da parcela; em branco usa a da proposta. |

**13. `pagamentos` - tab `Pagamentos` - maxRows 5000**

| key | header | kind | R | list | example | help |
| --- | --- | --- | --- | --- | --- | --- |
| ref | Ref | text(40) | yes | - | `P1` | Ref de uma proposta Ganha na aba Propostas. |
| parcela | Parcela | text(20) | yes | - | `1/1` | Rótulo da parcela paga, como 1/3 para parcelas ou M2/12 para mensalidades; formate a coluna como texto. |
| dataPagamento | Data do pagamento | day | yes | - | `20/01/2026` | Dia em que a parcela foi paga, nunca no futuro. |
| repassesPagos | Repasses pagos | bool | no | enum | `Sim` | Sim para dar baixa também nas comissões e custos ligados a esta parcela no mesmo dia. |

Example story check (all must hold, the schema test asserts them): `produtos.area` = `areas.nome`; `custosProduto.produto` = `produtos.nome`; `custosProduto.funcao` = `funcoes.nome`; `pessoas.funcoes` contains `Vendedor` and `funcoes.nome`; `leads.empresa` = `propostas.cliente` = `clientes.nome`; `leads.vendedor` = `propostas.vendedor` = `profissionais.pessoa` = `pessoas.nome`; `leads.etapa` = `etapas.nome` and is not a `LEAD_STAGE_SEEDS` name; `leads.produtos` and `itens.produto` = `produtos.nome`; every child `ref` = `propostas.ref`; `parcelas.valor` = `itens.quantidade` x `itens.valorUnitario` (500000 cents); `profissionais.funcao` = `funcoes.nome`.

## File 3 - `apps/api/src/domains/import/cells.ts`

Imports: `isIsoDay` from `'@fxl-sales/shared-utils/sao-paulo-day'`; `import type { CellKind } from './workbook-schema.js'`; `import type { CellValue } from './types.js'`.

### Exports (exact)

```ts
export type RawScalar = string | number | boolean | Date | null;
/** One cell as the parser read it. `percent` is true when the cell's number format contains '%'. */
export type RawCell = { value: RawScalar; percent: boolean; problem: null | 'formula_without_result' | 'cell_error' };
export function rawCell(value: RawScalar, percent = false): RawCell; // problem: null

export type CellIssueCode =
  | 'invalid_text' | 'too_long' | 'date_in_text_column'
  | 'invalid_money' | 'negative_value' | 'too_many_decimals'
  | 'invalid_int' | 'out_of_range'
  | 'invalid_pct' | 'invalid_day' | 'invalid_option' | 'invalid_bool'
  | 'too_many_items' | 'formula_without_result' | 'cell_error';
export type CoerceResult = { ok: true; value: CellValue } | { ok: false; code: CellIssueCode; message: string };

export function isBlankRaw(raw: RawCell): boolean;              // value null, or a string that is empty after trim; problem null
export function normalizeLabel(text: string): string;           // trim, NFD, strip U+0300..U+036F, lowercase, collapse \s+ to one space
export function coerceCell(kind: CellKind, raw: RawCell): CoerceResult;
export function coercePctList(text: string): { ok: true; value: number[] | null } | { ok: false; code: 'invalid_pct' | 'out_of_range'; message: string };
export function displayRaw(raw: RawCell): string;               // how a value is quoted in messages
export const MONEY_MAX_CENTS = 2_147_483_647;                   // Postgres int4, the money columns' type
```

`normalizeLabel` is THE matcher for tab names, headers and enum labels here, and slice 02's `refs.ts` must import it (see Seam deviations) so name matching has one implementation.

### Coercion rules (in this order inside `coerceCell`)

1. `raw.problem === 'formula_without_result'` -> `formula_without_result`, message `A célula tem uma fórmula sem valor calculado; abra o arquivo no Excel, salve e envie de novo.`
   `raw.problem === 'cell_error'` -> `cell_error`, message `A célula contém um erro do Excel (<display>).`
2. Blank (`isBlankRaw`) -> `{ ok: true, value: null }` for EVERY kind. Required is the parser's job, not the coercer's.
3. Per kind (`display` = `displayRaw(raw)`: a Date is shown as `dd/mm/aaaa` from its UTC parts, a number with `String(n)`, a boolean as `Sim`/`Não`, a string trimmed):

**text(max)**: string -> trimmed; number -> `String(n)`; boolean -> `Sim`/`Não`; Date -> error `date_in_text_column` `O Excel transformou "<display>" em data; formate a coluna como texto e digite o valor de novo.`
Length (after trim, counted with `[...s].length`) > max -> `too_long` `O texto tem <n> caracteres; o limite é <max>.`

**money**: result integer cents, `0 <= cents <= MONEY_MAX_CENTS`.
- number: `NaN`/infinite -> `invalid_money`; `< 0` -> `negative_value`; `c = n * 100`, if `Math.abs(c - Math.round(c)) > 1e-6` -> `too_many_decimals`; cents `Math.round(c)`.
- string: remove `R$` (case-insensitive) and ALL whitespace (incl. U+00A0). A leading `-` -> `negative_value`. Then, with `s` the remainder:
  - `/^\d{1,3}(\.\d{3})*,\d+$/` or `/^\d+,\d+$/` -> Brazilian decimal comma: integer part = digits with dots removed, fraction = after comma; fraction longer than 2 -> `too_many_decimals`.
  - `/^\d{1,3}(\.\d{3})+$/` -> dots are thousands (`1.234` is R$ 1.234,00; `1.500` is R$ 1.500,00).
  - `/^\d+\.\d{1,2}$/` -> dot decimal (`1234.5`, `1.50`).
  - `/^\d+$/` -> whole reais.
  - anything else -> `invalid_money` `"<display>" não é um valor em reais válido; use o formato 1.234,56.`
  Compute cents with integer string arithmetic (`BigInt` or `Number(intPart) * 100 + Number(fracPadded)`), never `parseFloat`.
- boolean or Date -> `invalid_money`.
- `> MONEY_MAX_CENTS` -> `out_of_range` `O valor "<display>" passa do limite de R$ 21.474.836,47.`

**int(min..max)**: number must be `Number.isInteger`; string must match `/^-?\d+$/` after trim (no decimals, no separators) else `invalid_int` `"<display>" não é um número inteiro.`; outside `[min, max]` -> `out_of_range` `O número <n> está fora do intervalo de <min> a <max>.`; boolean/Date -> `invalid_int`.

**pct**: result a number in `[0, 100]` rounded to 2 decimals (`Math.round(v * 100) / 100`).
- number with `raw.percent` -> `v = n * 100`; number without -> `v = n` (so `10` is 10% and an unformatted `0.1` is 0,1%).
- string: strip whitespace and one trailing `%`; accept `/^-?\d+([.,]\d+)?$/`, comma or dot as the decimal mark; else `invalid_pct` `"<display>" não é um percentual válido; use por exemplo 10 ou 12,5%.`
- `v < 0 || v > 100` -> `out_of_range` `O percentual <display> deve estar entre 0 e 100.`
- boolean/Date -> `invalid_pct`.

**day**: result `YYYY-MM-DD`, `isIsoDay` true, year >= 1900; otherwise `invalid_day` `"<display>" não é uma data válida; use o formato dd/mm/aaaa.`
- Date: `Number.isNaN(d.getTime())` -> invalid; else the UTC civil day `pad4(getUTCFullYear())-pad2(getUTCMonth()+1)-pad2(getUTCDate())`. Never the local timezone.
- number (an unformatted Excel serial): integer part `k = Math.floor(n)`, valid when `61 <= k <= 2958465`; day = UTC 1899-12-30 plus `k` days (build with `Date.UTC(1899, 11, 30 + k)`, read back UTC parts).
- string trimmed: `/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/` (dd/mm/aaaa, single digits allowed) or `/^(\d{4})-(\d{2})-(\d{2})$/`; a two-digit year, `dd-mm-aaaa` or text month is invalid.
- boolean -> invalid.

**enum(options)**: `s = normalizeLabel(String(value))` (numbers/booleans stringified, Date -> invalid); match an option whose `normalizeLabel(label)` OR `normalizeLabel(value)` equals `s`; result is the option VALUE.
No match -> `invalid_option` `"<display>" não é uma opção válida; use <labels joined: "A, B ou C">.`

**bool**: boolean -> itself; number `1`/`0` -> true/false (other numbers invalid); string normalized: true set `sim, s, x, true, verdadeiro, 1, yes`; false set `nao, n, false, falso, 0, no`; Date -> invalid. Else `invalid_bool` `"<display>" não é Sim ou Não.`

**list(max)**: string (number -> `String(n)`; boolean/Date -> `invalid_text` `"<display>" não é uma lista de nomes.`); split on `/[;,]/`; trim each; drop empty; dedupe by `normalizeLabel`, keeping the FIRST spelling; each item longer than 200 characters -> `too_long`; empty after split -> `{ ok: true, value: null }`; more than `max` items -> `too_many_items` `A lista tem <n> nomes; o limite é <max>.`

**coercePctList(text)**: trim; empty -> `{ ok: true, value: null }`; split on `;` ONLY; trim each part; drop empty parts; every part goes through the pct rule for strings (`invalid_pct` / `out_of_range` with the part quoted); returns the numbers in order. It does NOT check the sum (slice 04 converts to basis points and enforces 10000).

## File 4 - `apps/api/src/domains/import/parse.ts`

Imports: `ExcelJS` default from `'exceljs'`; `WORKBOOK_SHEETS, SHEET_KEYS, LEIAME_TAB, LISTAS_TAB, MAX_TOTAL_ROWS, type ColumnDef, type SheetDef, type ColumnKey` from `./workbook-schema.js`; `coerceCell, isBlankRaw, normalizeLabel, displayRaw, type RawCell, type RawScalar` from `./cells.js`; types from `./types.js`.

### Exports (exact)

```ts
export type ParseIssueCode =
  | 'invalid_file' | 'no_known_sheets' | 'unknown_sheet' | 'duplicate_sheet' | 'too_many_rows'
  | 'missing_column' | 'unknown_column' | 'duplicate_column' | 'required'
  | CellIssueCode;
export const INVALID_FILE_CODE = 'invalid_file';
export async function parseWorkbook(input: Buffer | Uint8Array): Promise<ParsedWorkbook>;
export function readRawCell(cell: ExcelJS.Cell): RawCell;
export function emptyParsedWorkbook(): ParsedWorkbook; // every SheetKey with rows [], issues []
export function cellReader<K extends SheetKey>(sheet: K, row: ParsedRow): {
  text(key: ColumnKey<K>): string | null;
  number(key: ColumnKey<K>): number | null;
  bool(key: ColumnKey<K>): boolean | null;
  list(key: ColumnKey<K>): string[] | null;
};
```

`cellReader` returns `null` for a missing or null cell and throws `TypeError('cell <sheet>.<key> is not <type>')` when the stored runtime type disagrees (a programmer error; impossible after coercion). Planners in 02-05 read cells ONLY through it, so a typo in a key is a compile error. `sheet` is used only in the error text.

### `readRawCell(cell)`

- `percent = typeof cell.numFmt === 'string' && cell.numFmt.includes('%')`.
- `unwrap(v: unknown)`: `null`/`undefined` -> `null`; string/number/boolean -> itself; `Date` -> itself; object with `richText` array -> concatenated `text`; object with `text` (hyperlink) -> `unwrap(text)`; object with `error` -> problem `cell_error`, value `String(error)`; object with `formula` or `sharedFormula` -> if `'result' in v && v.result !== undefined` then `unwrap(result)` else problem `formula_without_result`; any other object -> `String(v)` is NOT used, it is problem `cell_error`.
- Narrow with `typeof`/`in` checks on `unknown`; no `any`, no `as any`.

### `parseWorkbook(input)` algorithm

1. `const parsed = emptyParsedWorkbook()`.
2. `input.byteLength === 0` -> push the invalid-file issue and return.
3. Copy into a fresh `ArrayBuffer`; `try { await workbook.xlsx.load(ab) } catch { push invalid-file issue; return }`.
   Invalid-file issue: `{ severity: 'error', sheet: null, row: null, column: null, code: 'invalid_file', message: 'O arquivo não é uma planilha .xlsx válida.' }`. Never rethrow.
4. Map tabs over `workbook.worksheets` in workbook order: `n = normalizeLabel(ws.name)`; skip silently when `n` is `normalizeLabel(LEIAME_TAB)` or `normalizeLabel(LISTAS_TAB)`; find the SheetDef whose `normalizeLabel(tab)` equals `n`;
   none -> warning `unknown_sheet` (sheet null) `A aba "<ws.name>" não faz parte do modelo e foi ignorada.`;
   a SheetDef already matched by an earlier tab -> error `duplicate_sheet` (sheet = key) `As abas "<first>" e "<ws.name>" são a mesma aba do modelo; deixe só uma.` and keep the first.
5. No SheetDef matched at all -> error `no_known_sheets` (sheet null) `A planilha não tem nenhuma aba do modelo de importação; baixe o modelo e preencha as abas.` and return.
6. First pass, per matched sheet (in `WORKBOOK_SHEETS` order): header map from row 1 (`ws.getRow(1).eachCell({ includeEmpty: false }, ...)`): header text = `displayRaw(readRawCell(cell))` trimmed; skip blank headers; match by `normalizeLabel(header) === normalizeLabel(def.header)`;
   unknown -> warning `unknown_column` (row 1, column = the user's header text) `A coluna "<text>" não faz parte da aba e foi ignorada.`;
   second column mapping to the same def -> error `duplicate_column` (row 1, column = def.header) `A coluna "<def.header>" aparece mais de uma vez.` (first one wins).
   Data rows: `ws.eachRow({ includeEmpty: false }, (row, n) => n >= 2 && ...)`; a row is BLANK when every one of its cells (`row.eachCell({ includeEmpty: false })`, ALL columns, mapped or not) is `isBlankRaw`; blank rows are skipped and never renumber the others (`row` = `row.number`).
7. If the sheet has zero non-blank data rows -> it is EMPTY: drop its header issues, rows `[]`.
8. Total: sum of non-blank data rows across matched sheets `> MAX_TOTAL_ROWS` -> error `too_many_rows` (sheet null) `A planilha tem <n> linhas preenchidas; o limite é 5000 por importação.`; every sheet's rows stay `[]`; drop all header issues; return file issues plus this one.
9. Per non-empty sheet: data rows `> def.maxRows` -> error `too_many_rows` (sheet = key, row null) `A aba "<tab>" tem <n> linhas; o limite é <maxRows>.`; rows `[]`, header issues kept; skip coercion.
10. Otherwise emit header issues and, for every required def with no mapped column, error `missing_column` (row 1, column = def.header) `Falta a coluna obrigatória "<def.header>".`.
11. Coerce each data row: for every def in schema order: unmapped column -> `cells[key] = null` with NO issue (the missing_column error, if required, was already reported once);
    else `raw = readRawCell(row.getCell(col))`; `res = coerceCell(def.kind, raw)`; error -> issue `{ severity: 'error', sheet, row: row.number, column: def.header, code: res.code, message: res.message }` and `cells[key] = null`;
    ok with `null` and `def.required` -> error `required` `Preencha a coluna "<def.header>".`;
    otherwise `cells[key] = res.value`. Rows with issues are STILL returned (planners need them for cross-references; see Handoff).
12. Issue order in the result: file-level issues first (in the order found), then per sheet in `WORKBOOK_SHEETS` order: row-1 header issues, then by row ascending, then by schema column order.

## File 5 - `apps/api/src/domains/import/__tests__/xlsx-fixture.ts` (test helper, reused by later slices)

```ts
export type FixtureCell =
  | string | number | boolean | Date | null
  | { value: number | Date; numFmt: string }
  | { formula: string; result?: string | number }
  | { richText: Array<{ text: string }> }
  | { text: string; hyperlink: string }
  | { error: '#N/A' | '#DIV/0!' | '#VALUE!' };
export type FixtureTab = { name: string; rows: FixtureCell[][]; hidden?: boolean };
export async function buildXlsx(tabs: FixtureTab[]): Promise<Buffer>;
/** Header row (schema header texts in schema order) for one sheet. */
export function headerRow(sheet: SheetKey): string[];
/** The schema example values in header order (null where example is null). */
export function exampleRow(sheet: SheetKey): FixtureCell[];
/** One tab per SheetDef (tab name = def.tab) with its header row and its example row: the example workbook as the parser sees it. */
export function exampleTabs(): FixtureTab[];
```

`buildXlsx`: `new ExcelJS.Workbook()`, `addWorksheet(name, hidden ? { state: 'hidden' } : undefined)`, write rows with `getRow(r).getCell(c).value = ...`, set `numFmt` when given, return `Buffer.from(await wb.xlsx.writeBuffer())`.

## Red tests (write first, watch them fail, then implement)

### `apps/api/src/domains/import/__tests__/cells.test.ts`

`describe('coerceCell money')`:
- `parses Brazilian currency text to cents` - `R$ 1.234,56` -> 123456; `1234,56` -> 123456; `R$ 1.234,56` -> 123456; `R$ 0,00` -> 0; `1,5` -> 150.
- `reads dots as thousands only in groups of three` - `1.234` -> 123400; `1.500.000` -> 150000000; `1234.5` -> 123450; `1.50` -> 150.
- `converts numeric cells to cents without float drift` - 1234.56 -> 123456; 0.1 + 0.2 -> 30; 10 -> 1000.
- `refuses negatives, extra decimals, garbage and overflow` - `-5` -> negative_value; -1 -> negative_value; `1,234` -> too_many_decimals; 1.005 -> too_many_decimals; `abc` -> invalid_money; `12,34,5` -> invalid_money; 21474836.48 -> out_of_range; true -> invalid_money.
`describe('coerceCell int')`: 3 -> 3; `' 3 '` -> 3; 2.5 -> invalid_int; `3,0` -> invalid_int; `0` with min 1 -> out_of_range; 121 with max 120 -> out_of_range.
`describe('coerceCell pct')`: 10 -> 10; `10%` -> 10; `12,5 %` -> 12.5; `12.5` -> 12.5; `rawCell(0.1, true)` -> 10; `rawCell(0.125, true)` -> 12.5; 0.1 unformatted -> 0.1; 101 -> out_of_range; `-1` -> out_of_range; `dez` -> invalid_pct.
`describe('coerceCell day')`:
- `takes the UTC civil day of a Date` - `new Date(Date.UTC(2026, 0, 15))` -> `2026-01-15`; `new Date(Date.UTC(2026, 0, 15, 23, 59, 59))` -> `2026-01-15`.
- `parses dd/mm/aaaa and ISO text` - `15/01/2026`, `5/1/2026` -> `2026-01-05`, `2026-01-15`.
- `converts an unformatted Excel serial` - 46037 -> `2026-01-15`; 46037.75 -> `2026-01-15`.
- `refuses impossible or ambiguous days` - `31/02/2026`, `2026-13-01`, `15/01/26`, `15-01-2026`, `1899-12-31`, 10 (serial below 61), true -> all invalid_day.
`describe('coerceCell enum')`: `Ganha` -> won; `ganha`, `GANHA`, `  Ganha ` -> won; `Cartao` -> card; `pix` (the value) -> pix; `Fechada` -> invalid_option whose message contains `Rascunho, Aberta, Ganha, Perdida ou Cancelada`.
`describe('coerceCell bool')`: `Sim`, `sim`, `S`, `x`, `true`, true, 1 -> true; `Não`, `nao`, `N`, false, 0 -> false; `talvez` -> invalid_bool; 2 -> invalid_bool.
`describe('coerceCell list')`: `A, B; c` -> `['A','B','c']`; `Á; a; A` -> `['Á']`; ` ; , ` -> null; 21 names with max 20 -> too_many_items; 123 -> `['123']`.
`describe('coerceCell text')`: `  Ana  ` -> `Ana`; 123 -> `'123'`; 121 chars with max 120 -> too_long; a Date -> date_in_text_column.
- `treats null, empty and whitespace as blank for every kind` - loop every CellKind variant: `null`, `''`, `'   '` -> `{ ok: true, value: null }`.
- `reports formula and Excel error problems` - `{ value: null, percent: false, problem: 'formula_without_result' }` -> formula_without_result; `problem: 'cell_error'` -> cell_error.
- `messages are pt-BR and quote the value` - the invalid_money message for `abc` contains `"abc"` and `1.234,56`.
`describe('normalizeLabel')`: `  Áreas ` -> `areas`; `Funções` -> `funcoes`; `Custos   por produto` -> `custos por produto`.
`describe('coercePctList')`: `50; 50` -> [50, 50]; `12,5; 87,5` -> [12.5, 87.5]; `''` -> null; `50; x` -> invalid_pct; `50; 120` -> out_of_range.

### `apps/api/src/domains/import/__tests__/parse.test.ts`

All inputs are real bytes from `buildXlsx`.
- `parses a minimal Áreas tab` - tab `Áreas`, rows `[['Nome'], ['Tecnologia']]` -> `sheets.areas.rows` = `[{ row: 2, cells: { nome: 'Tecnologia' } }]`, issues `[]`.
- `returns every SheetKey even when absent` - Object.keys(sheets) equals `SHEET_KEYS`, each `rows: []`.
- `matches tab names ignoring case and accents` - tabs `areas` and `FUNCOES` populate `areas` and `funcoes`.
- `matches headers ignoring case, accents and order` - Produtos with headers `['área', 'NOME']` -> cells `area` and `nome` read correctly.
- `skips blank rows without renumbering` - Áreas rows: header, `A`, blank, `   `, `B` -> rows numbered 2 and 5.
- `treats a header-only or absent tab as empty and reports nothing` - Etapas with only `Nome`, plus Áreas missing its required column but with no data -> issues `[]`.
- `reports a missing required column once at row 1` - Produtos header `['Nome']` with 2 data rows -> exactly one `missing_column` for `Área` (row 1) and no `required` issue for `Área`.
- `fills a missing optional column with null silently` - Produtos without `Tipo` -> `cells.tipo === null`, no issue for it.
- `warns about an unknown column using the user's header text` - header `Cor favorita` -> warning `unknown_column`, column `Cor favorita`.
- `refuses a duplicated column` - two `Nome` headers -> `duplicate_column`.
- `reports a blank required cell with sheet, Excel row and header` - Áreas data row 3 blank-in-`Nome` but another column filled -> `{ sheet: 'areas', row: 3, column: 'Nome', code: 'required' }`.
- `reports a coercion failure with header text and a pt-BR message` - Parcelas `Valor (R$)` = `abc` at row 2 -> `{ sheet: 'parcelas', row: 2, column: 'Valor (R$)', code: 'invalid_money' }`, message contains `"abc"`; the row is still returned with `valor: null`.
- `reads Date cells as UTC civil days` - Parcelas `Vencimento` = `new Date(Date.UTC(2026, 0, 20))` -> `'2026-01-20'`.
- `reads percent-formatted cells as percentages` - Custos por produto `Custo (%)` = `{ value: 0.2, numFmt: '0%' }` -> 20.
- `unwraps rich text, hyperlinks and cached formula results` - Pessoas `Nome` richText `[{text:'Ana '},{text:'Souza'}]` -> `Ana Souza`; `E-mail` hyperlink `{ text: 'ana@x.com', hyperlink: 'mailto:ana@x.com' }` -> `ana@x.com`; Parcelas `Valor (R$)` `{ formula: '2500*2', result: 5000 }` -> 500000.
- `refuses a formula without a cached result and an Excel error cell` - `{ formula: '1+1' }` -> formula_without_result; `{ error: '#N/A' }` -> cell_error.
- `ignores Leia-me and a hidden Listas tab, warns on other tabs` - tabs `Leia-me`, `Listas` (hidden), `Rascunho do João` -> one warning `unknown_sheet` naming `Rascunho do João`.
- `refuses two tabs that map to the same sheet` - `Áreas` and `areas` -> one `duplicate_sheet` error.
- `turns a non-xlsx buffer into one invalid_file issue without throwing` - `Buffer.from('hello')`, `Buffer.alloc(0)`, 64 random bytes: each resolves (no rejection) to issues of length 1 with code `invalid_file` and every sheet empty.
- `refuses an xlsx with no template tab` - one tab `Plan1` -> `no_known_sheets` error plus the `unknown_sheet` warning.
- `refuses a sheet over its maxRows` - Etapas with 51 data rows -> `too_many_rows` for `etapas`, `rows: []`.
- `refuses a workbook over MAX_TOTAL_ROWS` - Clientes 3000 rows + Leads 2001 rows (each under its own max) -> one file-level `too_many_rows`, every sheet empty. (Write rows in a loop; keep the test under the default 5s timeout; if it is slower, set a 20s per-test timeout, never skip it.)
- `accepts a Uint8Array as well as a Buffer` - same bytes wrapped in `new Uint8Array(buf)` parse identically.
- `orders issues by file, sheet order, row, then column` - a workbook with an unknown tab, an error on Parcelas row 3 and row 2 and one on Áreas row 2 -> codes in the asserted order.
- `round-trips the example row of every sheet with zero issues` (THE oracle) - `parseWorkbook(await buildXlsx(exampleTabs()))` -> `issues` is `[]`; for every SheetDef exactly one row with `row: 2`; spot-check `produtos.valor === 500000`, `propostas.situacao === 'won'`, `propostas.dataBase === '2026-01-15'`, `pessoas.funcoes` equals `['Vendedor', 'Desenvolvedor']`, `custosProduto.custoPct === 20`, `pagamentos.repassesPagos === true`, `pagamentos.parcela === '1/1'`.
- `cellReader returns typed values and throws on a type mismatch` - on the parsed example: `cellReader('produtos', row).number('valor') === 500000`; `.text('nome')`; `.bool('temMensalidade') === true`; `.list` on `pessoas.funcoes`; `.text` on a missing key value -> null; `.number('nome')` throws TypeError.

### `apps/api/src/domains/import/__tests__/workbook-schema.test.ts`

- `lists the 13 data sheets in contract order with the contract tab names` - `WORKBOOK_SHEETS.map(s => [s.key, s.tab])` equals the SEAM-CONTRACT table (areas `Áreas` ... pagamentos `Pagamentos`) and keys equal `SHEET_KEYS`.
- `has unique keys and headers per sheet` - keys match `/^[a-z][a-zA-Z0-9]*$/`; keys unique; `normalizeLabel(header)` unique.
- `has unique tab names that never collide with Leia-me or Listas`.
- `gives every column a pt-BR help sentence` - non-empty, ends with `.`, contains no em dash (assert `!help.includes("\u2014")`).
- `every example coerces cleanly with its own kind` - for every column with a non-null example, `coerceCell(kind, rawCell(example)).ok === true`.
- `every required column has an example` - required implies `example !== null`.
- `marks enum and bool columns, and only them, with list enum`; `enum examples are option labels`.
- `child sheets and propostas start with a required Ref text column` - itens, profissionais, parcelas, pagamentos, propostas: `columns[0]` is `{ key: 'ref', header: 'Ref', required: true, kind.type: 'text' }`; custosProduto has a required `produto`.
- `list columns with a reference source accept free text` - every `kind.type === 'list'` column with a `list` has `freeText === true`; `leads.empresa.freeText === true`.
- `option values mirror the domain enums` - `PAYMENT_METHOD_OPTIONS` values equal `SaleInstallmentSchema.shape.method.options`; `PRODUCT_KIND_OPTIONS` values equal `ProductKindSchema.options`; `SALE_STATUS_OPTIONS` values equal `['draft','open','won','lost','cancelled']`.
- `text limits mirror the domain schemas` - `areas.nome` = `AreaSchema.shape.name.maxLength` (120); `funcoes.nome` = `FuncaoSchema.shape.name.maxLength`; `produtos.nome` = `ProductSchema.innerType().shape.name.maxLength` (140); `pessoas.nome` = `PersonSchema.shape.displayName.maxLength`; each `clientes` text column = the matching `ClientSchema` field (unwrap `nullish` with `.unwrap().unwrap()` or assert the literal number if unwrapping is awkward, and say so in a comment); `etapas.nome` = `LeadStageSchema.shape.name.maxLength`; `leads.contato`/`leads.empresa`/`leads.descricao` = `CreateLeadSchema.shape.contactName/clientName/description`.
- `the example story is coherent across sheets` - every equality listed under "Example story check" above, using `coerceCell` results (cents, lists), plus `LEAD_STAGE_SEEDS` does not contain `etapas.nome` example.
- `MAX_TOTAL_ROWS, MAX_UPLOAD_BYTES and MAX_RETURNED_ISSUES match D9` - 5000, 5242880, 500.
- `getSheetDef and getColumnDef throw on unknown names`.

### `apps/api/src/domains/import/__tests__/exceljs-pin.test.ts`

- `pins exceljs exactly in apps/api dependencies` - read `apps/api/package.json` via `new URL('../../../../package.json', import.meta.url)`; `dependencies.exceljs` matches `/^4\.\d+\.\d+$/` (no `^`/`~`); `devDependencies?.exceljs` is undefined.

## Commands (run once each, never watch mode)

```bash
pnpm --filter @fxl-sales/api exec vitest run src/domains/import/__tests__
pnpm --filter @fxl-sales/api exec eslint src/domains/import
pnpm --filter @fxl-sales/api type-check
pnpm --filter @fxl-sales/api test
```

Named locked oracles for this slice: `src/domains/import/__tests__/parse.test.ts` (`round-trips the example row of every sheet with zero issues`, `turns a non-xlsx buffer into one invalid_file issue without throwing`), `src/domains/import/__tests__/workbook-schema.test.ts`, `src/domains/import/__tests__/cells.test.ts`, `src/domains/import/__tests__/exceljs-pin.test.ts`.
If `@fxl-sales/shared-utils/sao-paulo-day` fails to resolve, run `pnpm run build:packages` once at the repo root and retry; do not add an alias.

## Handoff notes for later slices (put a short version as a top-of-file comment in parse.ts)

- A `null` in a REQUIRED column means the parser already reported it (`required`, `missing_column` or a coercion error). Planners treat it as "skip this row silently", never report it again.
- A `null` bool means "not given"; planners apply the default (false, unless the column help says otherwise).
- Money cells are CENTS. Product commission `(R$)` columns must be divided by 100 into the REAIS number `ProductSchema` stores for `fix`; funções cost `(R$)` and every other money stays cents.
- `propostas.ciclosRecorrencia` blank means "product default"; `produtos.ciclosRecorrencia` blank means indefinite (`null`).
- `divisaoCusto` is text; parse it with `coercePctList`.
- Read cells only via `cellReader(sheet, row)`.
- The template (slice 08) should format every `text` and `list` column as text (`numFmt '@'`) so Excel never turns `1/3` into a date, and use `freeText` to choose the validation error style.
- A fresh org may have no `vendedor`/`finder` função rows yet (they are seeded on demand by `LEGACY_FUNCAO_SEEDS` paths in service.ts); slice 02 must make `Vendedor`/`Finder` resolvable so the example round trip (AC2) passes.

## Seam deviations (proposed amendments to SEAM-CONTRACT.md)

1. `ImportCatalog` gains `settings: ImportCatalogSettings` (`defaultSellerCommissionPct`, `defaultFinderCommissionPct`, `defaultTaxPct`, numbers; 10/3/6 when the org has no settings row).
   Reason: a basic-depth proposta must take its commission and tax from product or settings defaults exactly like the wizard (`resolveSaleCommissionDefaults` in apps/web), and `CreateSaleSchema` would otherwise silently apply hard-coded 10/3/6. Slice 02 fills it in `readImportCatalog`.
2. `ProductCatalogEntry` is fully specified in `types.ts` (see File 1) with numeric DB columns as numbers, plus `ProductCatalogFuncaoCost` and `CommissionType`. Slice 04 converts `defaultEntradaPct` back to `String(...)` if it calls `materializeDefaultPaymentPlan`, whose `ProductPaymentDefaults` takes a string.
3. `ImportPreviewBody` and `ImportCommitBody` live in `types.ts` (not `routes.ts`) so slices 07 and 09 share one definition; `ImportOperationKind`, `ImportIssueSeverity` and `RefLookupFailureCode` are added as convenience aliases.
4. `ColumnDef` gains optional `freeText?: true` (template dropdown accepts values outside the list): set on `leads.empresa` and every list-kind column with a reference source.
5. `workbook-schema.ts` additionally exports `SHEET_KEYS`, `LEIAME_TAB`, `LISTAS_TAB`, `MAX_RETURNED_ISSUES = 500` (D9, used by slice 07), `PRODUCT_KIND_OPTIONS`, `PAYMENT_METHOD_OPTIONS`, `SALE_STATUS_OPTIONS`, `BOOL_LABELS`, `ColumnKey<K>`, `getSheetDef`, `getColumnDef`. `WORKBOOK_SHEETS` is declared `as const satisfies readonly SheetDef[]` (still assignable to the contract's `readonly SheetDef[]`).
6. `cells.ts` exports `normalizeLabel`, and `refs.ts` (slice 02) MUST use it for name matching, so tabs, headers, enums and refs share one trim/case/diacritic rule.
7. `parse.ts` exports `INVALID_FILE_CODE = 'invalid_file'`; slice 07 answers `400 { error: 'validation_error', reason: 'invalid_file' }` when `parsed.issues.some(i => i.code === INVALID_FILE_CODE)`. A readable xlsx with no template tab is NOT a 400: it is a `no_known_sheets` error in a normal preview body.
8. `parse.ts` exports `cellReader(sheet, row)`; planners read cells through it.
9. The `bool` kind treats a blank cell as `null` ("not given"), not as false; the contract's "x/blank" wording should read "x = Sim; blank = not given".
10. `profissionais.divisaoCusto` is a `text` column parsed by `coercePctList` (`;` separator only) rather than a `list`, because the comma is the Brazilian decimal mark.
11. Test helper `apps/api/src/domains/import/__tests__/xlsx-fixture.ts` (`buildXlsx`, `headerRow`, `exampleRow`, `exampleTabs`) is owned by slice 01 and reused read-only by slices 02-08 tests.
