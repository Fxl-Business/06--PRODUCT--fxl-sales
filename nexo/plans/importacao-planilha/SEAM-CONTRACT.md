# SEAM CONTRACT - importacao-planilha

This file is AUTHORITATIVE for every name, path, type and wire shape shared between slices.
A planner or executor that needs a shared name takes it from here verbatim.
If a slice discovers this contract is wrong, it records the deviation in its plan's `## Seam deviations` section and the orchestrator amends THIS file; nobody silently renames.

## Module layout

All API code lives in `apps/api/src/domains/import/`.

| File | Owner slice | Purpose |
| --- | --- | --- |
| `types.ts` | 01 | Every shared type below (type-only imports from sales-ops). No later slice edits it. |
| `workbook-schema.ts` | 01 | THE one sheet/column definition. Template, parser and planners read only this. |
| `cells.ts` | 01 | Pure cell coercers (text, money, int, pct, day, enum, bool, list). |
| `parse.ts` | 01 | `parseWorkbook(buffer)` - xlsx bytes to `ParsedWorkbook`. |
| `catalog.ts` | 02 | `readImportCatalog(tx, orgId, now)` - the org snapshot. |
| `refs.ts` | 02 | `RefIndex` builder: resolves names to existing ids or workbook refs. |
| `plan/cadastros.ts` | 02 | Áreas, Funções, Produtos, Custos por produto, Pessoas, Clientes, Etapas. |
| `plan/leads.ts` | 03 | Leads. |
| `plan/propostas.ts` | 04 | Propostas, Itens, Profissionais, Parcelas (incl. recorrência). |
| `plan/desfechos.ts` | 05 | Status Ganha/Perdida/Cancelada effects and the Pagamentos sheet. |
| `plan/index.ts` | 07 | `planImport(parsed, catalog)` - runs the sheet planners in order. |
| `executor.ts` | 06 | `executeImportPlan(tx, orgId, plan, actor, now)` - one transaction of domain-service calls. |
| `template.ts` | 08 | `buildTemplateWorkbook(catalog, { example })` - xlsx bytes. |
| `routes.ts` | 07 | `importRouter`, mounted by 07 at `salesOpsRouter.route('/import', importRouter)`. |

Web code lives in `apps/web/src/sales-ops/import/` (slice 09).

## Dependency

`exceljs` is added by slice 01 to `apps/api/package.json` `dependencies`, pinned EXACTLY (no caret, no tilde), at the latest published 4.x, in the same commit as `pnpm-lock.yaml`.
No other slice adds a dependency.
The web app never parses xlsx; it only uploads and downloads bytes.

## Sheets (order is load-bearing: it is the dependency order)

The `SheetKey` union and its pt-BR tab names, in this exact order:

| SheetKey | Tab name | Child of |
| --- | --- | --- |
| `leiame` | `Leia-me` | - (instructions only, never parsed) |
| `areas` | `Áreas` | - |
| `funcoes` | `Funções` | - |
| `produtos` | `Produtos` | - |
| `custosProduto` | `Custos por produto` | `produtos` (by produto name) |
| `pessoas` | `Pessoas` | - |
| `clientes` | `Clientes` | - |
| `etapas` | `Etapas` | - |
| `leads` | `Leads` | - |
| `propostas` | `Propostas` | - |
| `itens` | `Itens da proposta` | `propostas` (by `Ref`) |
| `profissionais` | `Profissionais da proposta` | `propostas` (by `Ref`) |
| `parcelas` | `Parcelas` | `propostas` (by `Ref`) |
| `pagamentos` | `Pagamentos` | `propostas` (by `Ref`) |

There is also a hidden `Listas` tab written by the template for dropdown sources; the parser ignores it.
A sheet that is absent, or present with only its header row, is EMPTY and produces nothing.
Row 1 is the header row; data starts at row 2. Fully blank rows are skipped silently.
`row` numbers in issues are the 1-based Excel row number the user sees.

## Column definition shape (`workbook-schema.ts`)

```ts
export type CellKind =
  | { type: 'text'; max: number }
  | { type: 'money' }              // to integer cents
  | { type: 'int'; min: number; max: number }
  | { type: 'pct' }                // 0..100, accepts 10, "10", "10%", or a %-formatted 0.1
  | { type: 'day' }                // to ISO 'YYYY-MM-DD' validated by isIsoDay
  | { type: 'enum'; options: readonly { label: string; value: string }[] }
  | { type: 'bool' }               // Sim/Não (also accepts true/false, s/n, x/blank)
  | { type: 'list'; max: number }; // comma/semicolon separated names, trimmed, deduped

export type ColumnDef = {
  key: string;          // camelCase, stable, used in code and in ParsedRow.cells
  header: string;       // pt-BR header text, exact, what the user sees in row 1
  kind: CellKind;
  required: boolean;    // required means "a non-blank value", checked by the parser
  help: string;         // one pt-BR sentence for Leia-me and the header comment
  example: string | number | null; // the value the example template writes in its first row
  list?: ListSource;    // template dropdown source, see below
};

export type ListSource =
  | 'areas' | 'funcoes' | 'produtos' | 'pessoas' | 'vendedores' | 'finders'
  | 'clientes' | 'etapas' | 'enum';

export type SheetDef = { key: SheetKey; tab: string; columns: readonly ColumnDef[]; maxRows: number };
export const WORKBOOK_SHEETS: readonly SheetDef[];   // in the order of the table above, leiame excluded
export const MAX_TOTAL_ROWS = 5000;                  // across all sheets
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
```

Header matching in the parser is by `header` text after trim and case/diacritic-insensitive comparison.
An unknown header is a warning (`unknown_column`), a missing required header is an error (`missing_column`, row 1).
Column order in the file does not matter.

## Shared types (`types.ts`)

```ts
export type SheetKey =
  | 'areas' | 'funcoes' | 'produtos' | 'custosProduto' | 'pessoas' | 'clientes' | 'etapas'
  | 'leads' | 'propostas' | 'itens' | 'profissionais' | 'parcelas' | 'pagamentos';

export type CellValue = string | number | boolean | string[] | null; // after coercion; money/int are numbers, day is ISO string
export type ParsedRow = { row: number; cells: Record<string, CellValue> };
export type ParsedSheet = { key: SheetKey; rows: ParsedRow[] };
export type ParsedWorkbook = { sheets: Record<SheetKey, ParsedSheet>; issues: ImportIssue[] };

export type ImportIssue = {
  severity: 'error' | 'warning';
  sheet: SheetKey | null;   // null = whole-file problem
  row: number | null;       // Excel row, null = whole sheet/file
  column: string | null;    // the pt-BR HEADER text, never the key
  code: string;             // stable snake_case, e.g. 'required', 'unknown_ref', 'duplicate_existing'
  message: string;          // pt-BR, names the offending value, never a raw uuid
};

export type ImportCatalog = {
  today: string;                       // todayInSaoPaulo(now)
  producerFlowLive: boolean;           // isProducerFlowLive(orgId)
  areas: Array<{ id: string; name: string; status: string }>;
  funcoes: Array<{ id: string; name: string; slug: string; isSystem: boolean; status: string }>;
  products: Array<ProductCatalogEntry>; // id, name, codeSuffix, kind, areaId, status + every default the proposta planner needs
  people: Array<{ id: string; displayName: string; contactEmail: string | null; status: string; funcaoSlugs: string[]; funcaoIds: string[] }>;
  clients: Array<{ id: string; name: string; document: string | null }>;
  stages: Array<{ id: string; name: string; kind: 'normal' | 'conversion' | 'lost'; status: string; position: number }>;
};
// ProductCatalogEntry is defined by slice 01 in types.ts as the full product row projection
// (id, name, codeSuffix, kind, areaId, status, setupBrl, hasMonthly, monthlyBrl, every commission
// field, every payment default, productFuncaoCosts). Slice 01 owns types.ts ENTIRELY; no later slice edits it.

/** A reference to something that will exist after commit: an existing id, or a workbook row created earlier in the same plan. */
export type EntityRef = { existingId: string } | { planKey: string };

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

/**
 * A CreateSaleInput whose foreign keys are still refs. The executor resolves every ref to an id,
 * then MUST parse the result with CreateSaleSchema before calling createSale.
 */
export type SaleDraft = Omit<CreateSaleInput, 'clientId' | 'sellerPersonId' | 'finderPersonId' | 'items' | 'professionals'> & {
  clientRef: EntityRef | null;
  sellerRef: EntityRef;
  finderRef: EntityRef | null;
  items: Array<Omit<CreateSaleInput['items'][number], 'productId' | 'areaId'> & { productRef: EntityRef | null; areaRef: EntityRef | null }>;
  professionals: Array<Omit<CreateSaleInput['professionals'][number], 'personId' | 'funcaoId'> & { personRef: EntityRef | null; funcaoRef: EntityRef | null }>;
};

export type ImportCounts = Partial<Record<SheetKey, number>>; // rows that will be / were created, per sheet

export type ImportPlan = {
  operations: ImportOperation[];   // in execution order (sheet order, then row order; transitions/settlements after their sale)
  issues: ImportIssue[];           // parser issues + planner issues, errors and warnings together
  counts: ImportCounts;
};
```

`AreaInput`, `FuncaoInput`, `ProductInput`, `ProductFuncaoCostInput`, `PersonInput`, `ClientInput`, `CreateSaleInput` come from `apps/api/src/domains/sales-ops/service.ts`; `LeadStageInput` from `sales-ops/leads/schemas.ts`; `CreateLeadInput` from `sales-ops/leads/lead-schemas.ts`.
`planKey` is `<sheetKey>:<row>` (for example `produtos:7`); `saleKey` is the `planKey` of the createSale operation.

## Planner signatures

Every sheet planner is pure (no I/O, no clock, no env) and has the shape:

```ts
export function planCadastros(parsed: ParsedWorkbook, catalog: ImportCatalog, refs: RefIndex): SheetPlanResult;
export function planLeads(parsed: ParsedWorkbook, catalog: ImportCatalog, refs: RefIndex): SheetPlanResult;
export function planPropostas(parsed: ParsedWorkbook, catalog: ImportCatalog, refs: RefIndex): SheetPlanResult;
export function planDesfechos(parsed: ParsedWorkbook, catalog: ImportCatalog, refs: RefIndex, propostas: SheetPlanResult): SheetPlanResult;
export type SheetPlanResult = { operations: ImportOperation[]; issues: ImportIssue[]; counts: ImportCounts };
```

The `RefKind`, `RefLookup`, `RefIndex` and `SheetPlanResult` TYPES live in `types.ts` (slice 01). The implementation `buildRefIndex` lives in `refs.ts` (slice 02). It is built ONCE by `buildRefIndex(parsed, catalog)` before any planner runs and answers lookups by kind and name:

```ts
export type RefKind = 'area' | 'funcao' | 'product' | 'person' | 'client' | 'stage';
export type RefLookup =
  | { ok: true; ref: EntityRef; label: string }
  | { ok: false; code: 'unknown_ref' | 'archived_ref' | 'ambiguous_ref'; message: string };
export interface RefIndex { resolve(kind: RefKind, name: string): RefLookup; }
```

Name matching is trim + case-insensitive + diacritic-insensitive.
A produto also resolves by its code suffix written as `#<suffix>` (for example `#3`).
A workbook row wins over nothing; an existing ACTIVE row and a workbook row with the same name is impossible because the cadastro planner errors on it (`duplicate_existing`).
An archived existing row resolves to `archived_ref` (an error), never silently.

`planImport(parsed, catalog)` (slice 07) = parser issues + `planCadastros` + `planLeads` + `planPropostas` + `planDesfechos`, concatenated in that order; `ok` is "zero issues with severity error".

## Executor contract (`executor.ts`, slice 06)

```ts
export type ImportActor = CadastroActor; // from sales-ops/service.ts
export type ImportExecutionResult = { counts: ImportCounts };
export async function executeImportPlan(tx: Db, orgId: string, plan: ImportPlan, actor: ImportActor, now: Date): Promise<ImportExecutionResult>;
export class ImportExecutionError extends Error { constructor(readonly operation: ImportOperation, readonly reason: string) }
```

- `tx` is the transaction opened by the route with `withTenant`; every domain-service call receives that `tx` as its `db` (nested `withTenant` becomes a savepoint; that is intended).
- It calls ONLY existing domain services: `createArea`, `createFuncao`, `createProduct`, `createPerson`, `createClient`, `createLeadStage`, `createLead`(+`moveLead` for a non-default etapa), `createSale`, `transitionSale`, `applyBaixaTx` (policy `{ mode: 'manual' }`, origin `'manual'`). Never a raw INSERT into a business table.
- A service result `{ ok: false }` or a returned sentinel string (`'duplicate'`, etc.) throws `ImportExecutionError`; the route turns that into a rollback and a 409.
- A won proposta is created with `createSale(tx, orgId, input, wonAt)` where `wonAt = new Date(`${wonOn}T15:00:00.000Z`)` (noon in São Paulo), so `won_at` and the payables' won day are the historical day.
- A settlement resolves the receivable by `saleKey` + exact `label`, and when `settlePayables` is true also settles every non-void payable whose `receivable_id` is that receivable, same `paidOn`.
- Last step: ONE `writeAuditEntry(tx, { action: 'import.completed', actorUserId, actorOrgId: orgId, entityType: 'importacao', entityId: <a fresh uuid>, beforeJsonb: {}, afterJsonb: { counts, actorLabel } })`. `'import.completed'` is added to `AuditActionSchema` by slice 06.
- Integration safety: `planDesfechos` already refuses Ganha and Pagamentos when `catalog.producerFlowLive`; the executor ALSO re-checks `isProducerFlowLive(orgId)` before any `createSale` with `status: 'won'` or any settlement and throws `ImportExecutionError(op, 'producer_flow_live')`. No emission path is modified.

## HTTP wire contract (`routes.ts`, slice 07)

Mounted under the existing sales-ops router, so the base is `/api/v1/sales-ops/import`. Every route is behind `requireAdmin`.

| Method + path | Request | Response |
| --- | --- | --- |
| `GET /template?example=0|1` | - | `200` xlsx bytes, `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `Content-Disposition: attachment; filename="fxl-sales-importacao.xlsx"` (example: `fxl-sales-importacao-exemplo.xlsx`) |
| `POST /preview` | `multipart/form-data`, field `file` | `200 ImportPreviewBody` |
| `POST /commit` | `multipart/form-data`, field `file` (the SAME file again) | `201 ImportCommitBody`, or `422 ImportPreviewBody` when the fresh plan has errors, or `409 { error: 'conflict', reason: 'import_execution_failed', message }` when a service refused mid-transaction (nothing written) |

Upload refusals: no file / not xlsx -> `400 { error: 'validation_error', reason: 'invalid_file' }`; over `MAX_UPLOAD_BYTES` -> `413 { error: 'payload_too_large', reason: 'file_too_large' }`.

```ts
export type ImportPreviewBody = {
  ok: boolean;                                  // zero errors
  counts: ImportCounts;
  issues: ImportIssue[];                        // errors first, then warnings; each group by sheet order then row
  truncated: boolean;                           // true when issues was cut at 500 entries
};
export type ImportCommitBody = { counts: ImportCounts };
```

`commit` NEVER trusts the preview: it re-parses the file, re-reads the catalog INSIDE the transaction, re-plans, and executes only when the fresh plan has zero errors.

## Web contract (slice 09)

- New Cadastros view id `importacao`, label `Importação`, lucide icon `FileSpreadsheet`, inserted immediately before `geral` in `navigation.ts` (`produtos` stays `[0]`).
- Route `/cadastros/importacao`; visible only where Cadastros is visible (admin).
- Screens live in `apps/web/src/sales-ops/import/`; `SalesOpsApp.tsx` gains only the one mount line `{view === 'importacao' ? <ImportContainer /> : null}` plus its import.
- Downloads use `apiFetchBlob`; uploads use `FormData` through the existing authenticated fetch path (no hand-built `Authorization` header outside `api-client.ts`).
- The web mirrors `ImportPreviewBody`/`ImportCommitBody`/`ImportIssue`/`SheetKey` as types in `apps/web/src/sales-ops/import/types.ts`, plus `SHEET_LABELS: Record<SheetKey, string>` with the tab names above.

## Amendments accepted from slice 01 planning (binding, override anything above)

The full text of `types.ts` and the complete column catalogue are in `01-contract-and-parser.md`; that plan is authoritative for every column key, header and kind.


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

## Amendment D11 (orchestrator, binding): default etapas in a fresh org

`ensureLeadStages(tx, orgId)` (apps/api/src/domains/sales-ops/leads/stages-seed.ts) has no production caller, so an org created after migration 0022 may have zero etapas.
Both import routes therefore open `withTenant(getDb(), orgId, tx => ...)` and call `ensureLeadStages(tx, orgId)` BEFORE `readImportCatalog(tx, orgId, now)`:
- `POST /preview` plans inside that transaction and then ROLLS IT BACK (throw a private sentinel caught outside `withTenant`), so the preview still writes nothing.
- `POST /commit` keeps the seed as part of the committed transaction.
`readImportCatalog` itself never writes. The executor does not seed. Tests for the planners may assume the catalog contains the seeded default etapas.

## Amendments from slice 04 planning (binding)

- Slice 04 owns a one-line help-text fix in `workbook-schema.ts` (already merged by slice 01): `profissionais.pessoa` help becomes "Pessoa que exerce a função no projeto; o cadastro da pessoa não é alterado." The planner emits `person_lacks_funcao` as a WARNING instead of granting the função.
- `planCadastros` MUST stay pure and deterministic: `planPropostas` calls it internally to read same-workbook produto defaults.
- Status mapping on the createSale op: Rascunho -> `draft`, Ganha -> `won` (with raw `wonOn`), blank/Aberta/Perdida/Cancelada -> `open`; slice 05 appends `transitionSale` for Perdida/Cancelada.

## Amendments from slice 02 planning (binding)

1. D11b (system funções, same shape as D11): an org created after migration 0012 has NO Vendedor/Finder função, so `Vendedor` in Pessoas, and every vendedor/finder reference, would be `unknown_ref` in a fresh org and AC2 would fail. Slice 02 adds `ensureSystemFuncoes(tx, orgId)` to `apps/api/src/domains/sales-ops/service.ts` (additive export over the existing private seed; no other slice owns that file in this feature). Slice 07's routes call it right after `ensureLeadStages(tx, orgId)` and before `readImportCatalog`, in both preview (rolled back) and commit. `readImportCatalog` still never writes; the executor still never seeds.
2. Planner signatures take `refs: ImportRefIndex` (exported by `refs.ts`, extends `RefIndex` with `resolvePersonWithFuncao`, `personHasFuncaoSlug`, `personHasFuncao`, `funcaoIsSystem`) instead of the bare `RefIndex`; `buildRefIndex(parsed, catalog): ImportRefIndex`. `types.ts` is unchanged.
3. New shared file `apps/api/src/domains/import/plan/plan-helpers.ts` (owned by slice 02) with the issue builders and the zod mapper; slices 03-05 import it.
4. New test helper `apps/api/src/domains/import/__tests__/plan-fixtures.ts` (owned by slice 02), reused read-only by slices 03-07.
5. Issue codes added by this slice: `duplicate_existing`, `duplicate_archived`, `duplicate_in_sheet`, `duplicate_slug`, `reserved_funcao`, `invalid_funcao_name`, `duplicate_code`, `no_free_code`, `both_pct_and_brl`, `conflicting_values`, `too_many_installments`, `existing_product_cost`, `system_funcao_cost`, `cost_required`, `duplicate_cost`, `funcao_required`, `possible_duplicate` (warning), `invalid_value` (zod), `missing_funcao` (refs), plus the contract's `unknown_ref`, `archived_ref`, `ambiguous_ref`.
6. D5 refinement: for áreas, funções and etapas an ARCHIVED same-name row is also an error (`duplicate_archived`), because the database name index covers archived rows and `createArea`/`createFuncao`/`createLeadStage` would refuse at commit. For produtos (no name index) an archived same name is only a `possible_duplicate` warning.
7. Slices 03 and 04 were planned against the bare RefIndex with fakes; their executors switch the planner parameter type to ImportRefIndex and use its person/função helpers for vendedor/finder checks, keeping their fakes compatible.

## Amendments from slice 08 planning (binding)

- The example dataset lives in `template.ts` as `buildExampleDataset(today)`; row 1 of each tab equals the schema `example` fields. Slice 07's round-trip oracle expects `buildExampleDataset(today)[sheet].length` rows per tab (not one), and "the won sale" is the one created from P1.
- D11/D11b already make the routes seed default etapas and system funções before the catalog read, so the template download (slice 07 seeds there too, rolled back) shows them in the dropdowns.

## Resolution of slice 06 planning deviations (orchestrator, binding, overrides 06-executor.md)

- REJECTED 06 deviation 1 (reserved `system:` refs, virtual catalog rows, executor seeding) and 06 deviation 2 (06's own `ensureSystemFuncoes(tx, orgId, slugs)`). D11/D11b stand: the ROUTES (slice 07) call `ensureLeadStages(tx, orgId)` and slice 02's `ensureSystemFuncoes(tx, orgId)` inside their transaction before `readImportCatalog`; preview and template roll back. The executor never seeds, has no `system:` prefix, and slice 06 does NOT modify `apps/api/src/domains/sales-ops/service.ts`.
- Therefore 06 now depends on 02 (wave 3): its integration tests seed the org with `ensureLeadStages` + `ensureSystemFuncoes` (from 02) before running hand-built plans, and reference the seeded rows by `{ existingId }`.
- ACCEPTED 06 deviations 3 (`ImportExecutionError.message` is the pt-BR user message; slice 07's 409 `message` = `error.message`; zod reasons `invalid_<entity>`) and 4 (result counts = plan.counts, stored in the audit entry).
