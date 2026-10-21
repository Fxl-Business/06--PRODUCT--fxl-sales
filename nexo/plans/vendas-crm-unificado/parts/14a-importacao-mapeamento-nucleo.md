# Part 14a-importacao-mapeamento-nucleo of slice 14-importacao-mapeamento

Original frontmatter (for reference, not a slice):

```yaml
id: 14a-importacao-mapeamento-nucleo
milestone: v4.8.0
status: todo
depends_on: ["13b-dias-sem-comprar-web"]
files_modified: ["apps/api/src/domains/import/mapping/types.ts", "apps/api/src/domains/import/mapping/read-sheet.ts", "apps/api/src/domains/import/mapping/suggest.ts", "apps/api/src/domains/import/mapping/plan.ts", "apps/api/src/domains/import/mapping/__tests__/read-sheet.test.ts", "apps/api/src/domains/import/mapping/__tests__/suggest.test.ts", "apps/api/src/domains/import/mapping/__tests__/plan.test.ts"]
affected_tests: []
acceptance: "given a sheet with arbitrary headers, a column mapping, a stage-value mapping and an in-memory catalog, when planMappedImport runs, then it returns the cliente and lead operations, row-numbered issues, counts and recognized counts, recognizes a lead that already exists, and never reads the clock, the database or the environment"
goal: "Pure core of the mapped import: read any sheet, suggest targets, validate a column/stage mapping and plan clientes and leads."
must_not_break: ["workbook-schema.ts stays the ONE definition of the official template: nothing in it changes", "recognizeClientRows and planCadastros are reused unchanged", "every existing import oracle stays green"]
rules: ["Pure planner: no I/O, no clock, no env, no database (the date is never read; the catalog and the existing-lead keys are arguments)", "Never hand-type a template header, tab name or column key of the official workbook", "Create-only: the mapped import never updates an existing record", "Cliente recognition is recognizeClientRows through buildRefIndex, not a second implementation", "pt-BR issue messages without ids", "Dynamic fields are addressed by field definition key, never by a column in the lead table"]
verifier_focus: "no DB or clock import in plan.ts/read-sheet.ts/suggest.ts; recognition by ordinal multiset; all-or-nothing is possible because every error is reported before any write; stage values unmapped are errors, not silent defaults; the official template path is untouched (git diff on workbook-schema.ts, parse.ts, plan/*.ts is empty)"
oracle: "apps/api/src/domains/import/mapping/__tests__/plan.test.ts"
```

# 14a - Importação com mapeamento: núcleo puro

## Context

- The official import (`apps/api/src/domains/import/*`, CLAUDE.md "Importação por planilha") is template driven: `workbook-schema.ts` defines the tabs and headers, `parse.ts` reads exactly those tabs, `plan/*.ts` plan them, `executor.ts` writes through the domain services, and the three routes (`routes.ts`) are admin-only with a rolled-back preview and an all-or-nothing commit.
- The template brand already reads FXL Vendas (`template.ts:91,99,120,133,515`, `plan/leads.ts:191`). Nothing in the template changes in 14a/14b/14c; a brand test is added in 14b.
- Reusable pieces, verified: `normalizeLabel`, `coerceCell`, `displayRaw`, `isBlankRaw`, `RawCell` in `cells.ts` (lines 50, 300, 60, 43, 7); `readRawCell` in `parse.ts:82`; `emptyParsedWorkbook` in `parse.ts:49`; `buildRefIndex` in `refs.ts:233` (builds from a ParsedWorkbook + ImportCatalog; recognition of Clientes rows happens inside via `recognizeClientRows`, `client-recognition.ts:26`); `planCadastros` in `plan/cadastros.ts:649` (plans Clientes: create, `recognized.clientes`, `possible_duplicate` warning); `sortIssues`, `mergeCounts` in `plan/index.ts`; `rowError`, `rowWarning`, `lookupIssue` in `plan/plan-helpers.ts:17,27,49` (they accept any column text); fixtures `richCatalog()`, `seededCatalog()`, `IDS` in `__tests__/plan-fixtures.ts`.
- CRM model (authoritative: `nexo/plans/vendas-crm-unificado/SEAM-CONTRACT.md` and `contracts/SEAM-CONTRACT-PHASE2.md`): a lead has `contact_name`, `contact_phone`, `contact_email`, a pipeline and stage (`type` normal|orcamento|saida, `exit_kind` ganho|perdido|pausado, `requires_reason`), `client_id` or `client_name_snapshot`, `estimated_value_brl`, `lost_reason`; every other datum is a dynamic field value addressed by definition `key` and typed `text|number|money|date|options|reference` (reference targets `cliente|contato|produto|servico|venda`). The Cliente definition (`key 'cliente'`) is a system field backed by `client_id`.
- ImportCatalog (`types.ts:84`) still serves people, products, clientes. Pipelines, stages and field definitions come from a new `MappingCatalog` argument (read from the database by 14b; plain objects here).

## Design

Scope of the mapped flow: it imports LEADS (and the clientes they point to). Propostas, pagamentos, produtos and cadastros stay on the official template. Operator experience: upload any .xlsx, choose a pipeline, map each column to a target, map the distinct values of the stage column to stages of that pipeline, preview, commit.

New directory `apps/api/src/domains/import/mapping/`. Files of THIS slice (all pure, no database import):

### `types.ts`

```ts
import { z } from 'zod';
import type { ImportCatalog, ImportCounts, ImportIssue } from '../types.js';
import type { RawCell } from '../cells.js';
import type { ClientInput } from '../../sales-ops/service.js';

export const MAPPING_CORE_FIELDS = [
  'contactName', 'contactPhone', 'contactEmail',
  'clientName', 'clientDocument', 'clientContact',
  'sellerName', 'estimatedValue', 'stage', 'lostReason',
] as const;
export type MappingCoreField = (typeof MAPPING_CORE_FIELDS)[number];

export const MappingTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('core'), field: z.enum(MAPPING_CORE_FIELDS) }).strict(),
  z.object({ kind: z.literal('field'), key: z.string().min(1).max(64) }).strict(),
  z.object({ kind: z.literal('ignore') }).strict(),
]);
export type MappingTarget = z.infer<typeof MappingTargetSchema>;

export const MappingConfigSchema = z
  .object({
    sheetName: z.string().min(1).max(120).nullish(),
    headerRow: z.number().int().min(1).max(50).default(1),
    pipelineId: z.string().uuid(),
    defaultStageId: z.string().uuid().nullish(),
    createClients: z.boolean().default(true),
    columns: z.array(z.object({ index: z.number().int().min(0).max(255), target: MappingTargetSchema }).strict()).max(256),
    stageMap: z.array(z.object({ value: z.string().max(200), stageId: z.string().uuid() }).strict()).max(200),
  })
  .strict();
export type MappingConfig = z.infer<typeof MappingConfigSchema>;

export type MappedSheet = {
  sheetNames: string[];          // visible tabs, `Leia-me` and `Listas` excluded
  sheetName: string;             // the tab that was read
  headers: string[];             // one per column, blank header -> `Coluna N` (N from 1)
  rows: Array<{ row: number; cells: RawCell[] }>; // Excel row numbers, blank rows skipped
  issues: ImportIssue[];         // file-level only (too_many_rows)
};

export type MappingStage = {
  id: string; pipelineId: string; name: string; position: number;
  type: 'normal' | 'orcamento' | 'saida';
  exitKind: 'ganho' | 'perdido' | 'pausado' | null;
  requiresReason: boolean; status: string;
};
export type MappingFieldDef = {
  id: string; key: string; label: string;
  kind: 'text' | 'number' | 'money' | 'date' | 'options' | 'reference';
  referenceTarget: 'cliente' | 'contato' | 'produto' | 'servico' | 'venda' | null;
  multiple: boolean; options: Array<{ key: string; label: string }> | null;
  isSystem: boolean; status: string;
};
export type MappingCatalog = {
  pipelines: Array<{ id: string; name: string; status: string; isDefault: boolean; position: number }>;
  stages: MappingStage[];
  fields: MappingFieldDef[];
};

export type MappedFieldValue =
  | { kind: 'text'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'money'; cents: number }
  | { kind: 'date'; day: string }
  | { kind: 'options'; keys: string[] }
  | { kind: 'products'; items: Array<{ productId: string | null; name: string }> };
export type MappedFieldInput = { fieldId: string; key: string; value: MappedFieldValue };

export type MappingClientOp = { planKey: string; row: number; input: ClientInput };
export type MappingLeadOp = {
  planKey: string;                 // `mapped:<excel row>`
  row: number;
  contactName: string;
  contactPhone: string | null;
  contactEmail: string | null;
  clientRef: { existingId: string } | { planKey: string } | null;
  clientName: string | null;       // free text when clientRef is null
  sellerPersonId: string | null;
  estimatedValueBrl: number;
  stageId: string;
  lostReason: string | null;
  fields: MappedFieldInput[];
};
export type MappingPlan = {
  clientOps: MappingClientOp[];
  leadOps: MappingLeadOp[];
  issues: ImportIssue[];
  counts: ImportCounts;            // { leads?, clientes? }
  recognized: ImportCounts;        // { leads?, clientes? }
};
export type MappingInput = {
  sheet: MappedSheet;
  config: MappingConfig;
  catalog: ImportCatalog;
  mapping: MappingCatalog;
  /** normalized `contactName|clientLabel` -> how many LIVE leads of the chosen pipeline already carry it. */
  existingLeadKeys: ReadonlyMap<string, number>;
};
```

### `read-sheet.ts`

`export async function readMappingSheet(bytes: Uint8Array, opts: { sheetName?: string | null; headerRow: number }): Promise<MappedSheet | null>`; returns `null` for an unreadable file (the route answers `400 invalid_file` exactly like `readUpload`).
- Load: copy to an `ArrayBuffer` and `new ExcelJS.Workbook().xlsx.load(ab)` inside try/catch (same as `parse.ts:173-186`); any throw -> `null`.
- `sheetNames = workbook.worksheets.filter(ws => ws.state === 'visible' && !SKIP.has(normalizeLabel(ws.name))).map(ws => ws.name)` with `SKIP = new Set([normalizeLabel(LEIAME_TAB), normalizeLabel(LISTAS_TAB)])` imported from `../workbook-schema.js`. No visible sheet -> `null`.
- `sheetName = opts.sheetName` matched by `normalizeLabel` against `sheetNames`, else the first of `sheetNames`; an unknown `opts.sheetName` -> `null`.
- `columnCount = Math.min(ws.columnCount, 256)`. Header `c` (1-based) = `displayRaw(readRawCell(row.getCell(c)))`, empty -> `Coluna ${c}`.
- Data rows: for `r = headerRow + 1 .. ws.rowCount`: `cells[c-1] = readRawCell(row.getCell(c))`; skip the row when every cell `isBlankRaw`; push `{ row: r, cells }`. When the kept count would exceed `MAX_TOTAL_ROWS` (5000, from `../workbook-schema.js`) push ONE file-level issue `{severity:'error', sheet:null, row:null, column:null, code:'too_many_rows', message:'A planilha tem mais de 5000 linhas preenchidas; divida em arquivos menores.'}` and stop.

### `suggest.ts`

`export type SuggestedTarget = MappingTarget | null; export function suggestTarget(header: string, fields: readonly Pick<MappingFieldDef,'key'|'label'|'kind'|'referenceTarget'|'status'|'isSystem'>[]): MappingTarget`. Returns `{kind:'ignore'}` when nothing matches. `n = normalizeLabel(header)`. First rule that matches wins:
1. exact match in `CORE_SYNONYMS` (all values already normalized):
   - `contactName`: `nome`, `nome do contato`, `contato`, `lead`, `nome do lead`, `nome completo`
   - `contactPhone`: `telefone`, `celular`, `whatsapp`, `fone`, `tel`, `telefone do contato`
   - `contactEmail`: `email`, `e-mail`, `e mail`, `email do contato`
   - `clientName`: `empresa`, `cliente`, `razao social`, `nome da empresa`
   - `clientDocument`: `cnpj`, `cpf`, `cnpj/cpf`, `documento`
   - `clientContact`: `contato da empresa`
   - `sellerName`: `vendedor`, `responsavel`, `vendedor responsavel`
   - `estimatedValue`: `valor`, `valor estimado`, `valor do negocio`, `valor (r$)`
   - `stage`: `etapa`, `fase`, `estagio`, `status`, `situacao`
   - `lostReason`: `motivo da perda`, `motivo`, `motivo de perda`
2. else a field definition (status `active`, not `isSystem`, kind not `reference` unless `referenceTarget` is `produto` or `servico`) whose `normalizeLabel(label)` or `normalizeLabel(key)` equals `n` -> `{kind:'field', key}`.
3. else `{kind:'ignore'}`.
`suggestTargets(headers, fields)` maps all headers and makes a second pass so a core field or a field key is suggested for the FIRST matching column only (later duplicates become ignore).

### `plan.ts`

`export function planMappedImport(input: MappingInput): MappingPlan`. Structure (follow it literally):

1. `const issues: ImportIssue[] = [...sheet.issues]`. A local `const err = (row, column, code, message) => rowError('leads', row, column, code, message)` and `warn` likewise; `fileErr(code, message)` builds `{severity:'error', sheet:null, row:null, column:null, code, message}`.
2. CONFIG VALIDATION (collect all, then return early if any error; rows are not planned):
   - pipeline: `mapping.pipelines.find(p => p.id === config.pipelineId && p.status === 'active')` else `pipeline_not_found` "O funil escolhido não existe ou está arquivado."
   - `stagesOfPipeline = mapping.stages.filter(s => s.pipelineId === config.pipelineId && s.status === 'active').sort(by position)`.
   - each `columns[i].index < sheet.headers.length` else `column_out_of_range`; no repeated `index` (`duplicate_column`); each core field at most once and each field key at most once (`duplicate_target`, message names the target in pt-BR: contactName "Nome do contato", contactPhone "Telefone", contactEmail "E-mail", clientName "Empresa", clientDocument "CNPJ/CPF da empresa", clientContact "Contato da empresa", sellerName "Vendedor", estimatedValue "Valor estimado", stage "Etapa", lostReason "Motivo da perda").
   - `{kind:'field', key}`: definition must exist, be `active`, not `isSystem` (key `cliente` -> `field_not_mappable` "O campo Cliente recebe a Empresa; escolha o destino Empresa."), and not a reference with `referenceTarget` in `cliente|contato|venda` (`field_not_mappable` "O campo X não pode receber colunas da planilha."); otherwise `unknown_field`.
   - required: `contactName` mapped; AND (`contactPhone` or `contactEmail`) mapped, else `missing_required_mapping` "Mapeie uma coluna para Nome do contato e outra para Telefone ou E-mail." (one issue).
   - `stageMap`: each `stageId` must be in `stagesOfPipeline` and `type !== 'orcamento'` else `stage_not_allowed` "A etapa escolhida para "X" não aceita importação (etapas de orçamento nascem de uma proposta)." Duplicate normalized `value` -> keep the last, no issue.
   - default stage: `config.defaultStageId` (must be in `stagesOfPipeline`, not orcamento, else `stage_not_allowed`) or the first of `stagesOfPipeline` with `type === 'normal'`; none -> `no_open_stage` "O funil escolhido não tem etapa ativa para receber leads."
3. CLIENTES via the existing machinery. Rows of the `clientName` column (+ optional `clientDocument`, `clientContact` columns) are collected: for each sheet row with a non-blank empresa text (`coerceCell({type:'text',max:160})`; a failed coercion is reported by the row loop below), key = `normalizeLabel(name) + '|' + documentDigits(doc)` (`documentDigits` from `../client-recognition.js`); the FIRST row of each key becomes a synthetic Clientes row `{ row: <excel row>, cells: { nome, documento: doc ?? null, contato: contact ?? null } }`. Build `const parsed = emptyParsedWorkbook(); parsed.sheets.clientes.rows = synthetic` (empty when `config.createClients === false`), `const refs = buildRefIndex(parsed, catalog)`, `const cad = planCadastros(parsed, catalog, refs)`. `cad.operations` are `createClient` ops -> `clientOps` (`{ planKey: op.planKey, row: Number(op.planKey.split(':')[1]), input: op.input }`; take only `op.op === 'createClient'`); `cad.issues` go to `issues` unchanged (sheet `'clientes'`, Excel row numbers because the synthetic rows reuse them); `cad.counts.clientes` and `cad.recognized.clientes` feed the totals. This is what keeps D12 recognition (`recognizeClientRows`) the ONE implementation.
4. ROW LOOP over `sheet.rows` (skip when config invalid). Helpers: `colOf(field)` = index of the mapped column or `undefined`; `cell(row, idx)` = `row.cells[idx]`; `headerOf(idx)` = `sheet.headers[idx]`. For every row:
   - `contactName`: `coerceCell({type:'text',max:140}, raw)`; failure -> `err(row, header, result.code, result.message)`; blank -> `err(..., 'required', 'Preencha o nome do contato.')`.
   - `contactPhone` (`text`, max 40) and `contactEmail` (`text`, max 254; non-blank must match `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` else `invalid_email` "O e-mail "X" não parece válido."); when both end blank/absent -> `err(row, null, 'contact_required', 'Informe pelo menos um telefone ou e-mail para o lead.')`.
   - empresa: blank -> `clientRef = null`, `clientName = null`. Non-blank: `const l = refs.resolve('client', empresa)`; `l.ok` -> `clientRef = l.ref`, `clientLabel = l.label`; `l.code === 'ambiguous_ref'` -> `warn(row, header, 'ambiguous_client', 'Há mais de um cliente chamado "X"; o lead fica com o nome como texto, sem ligação a um cadastro.')`, `clientName = empresa`; any other failure with `createClients === false` -> `clientName = empresa` (free text, no issue); `archived_ref` -> `lookupIssue`.
   - `sellerName`: blank -> `null`; else `refs.resolvePersonWithFuncao(name,'vendedor')`: ok -> `existingId` (a `planKey` ref cannot happen because no Pessoas rows are planned); `missing_funcao` -> `err(..., 'seller_not_a_vendedor', '"X" não tem a função Vendedor; só uma pessoa com essa função pode ser o vendedor de um lead.')`; other failure -> `lookupIssue`.
   - `estimatedValue`: `coerceCell({type:'money'}, raw)`; failure -> err; blank -> `0`.
   - stage: if the `stage` column is mapped and the cell is non-blank: `shown = displayRaw(raw)`; `stageId = stageByValue.get(normalizeLabel(shown))` else `err(row, header, 'stage_unmapped', 'O valor "' + shown + '" da coluna "' + header + '" não foi mapeado para uma etapa do funil.')`. Blank or no stage column -> default stage. `stage = stagesOfPipeline.find(id)`.
   - lost reason: `reasonRaw = lostReason column cell` (`text`, max 500). If `stage.requiresReason` and blank -> `err(row, header-or-null, 'lost_reason_required', 'Preencha o motivo da perda, porque a etapa "' + stage.name + '" exige um motivo.')`. If `!stage.requiresReason` and non-blank -> `warn(row, header, 'lost_reason_ignored', 'O motivo da perda só vale em etapas que o exigem e será ignorado nesta linha.')` and `lostReason = null`.
   - dynamic fields, one per mapped `{kind:'field'}` column, blank cell -> no value. By definition kind:
     | kind | coercion | value |
     |---|---|---|
     | text | `coerceCell({type:'text',max:4000})` | `{kind:'text'}` |
     | number | `coerceCell({type:'money'})` then `cents / 100` (decimal comma accepted, 2 decimals, negative refused by the money coercer) | `{kind:'number'}` |
     | money | `coerceCell({type:'money'})` | `{kind:'money', cents}` |
     | date | `coerceCell({type:'day'})` (dd/mm/aaaa, ISO or Excel date) | `{kind:'date', day}` |
     | options | text split on `;` (single option when `!multiple`; more than one value -> `too_many_values`); each value matched by `normalizeLabel` against option `label` or `key`; no match -> `unknown_option` 'O valor "X" não é uma opção do campo "L"; opções: a, b e c.' | `{kind:'options', keys}` |
     | reference produto/servico | `coerceCell({type:'list',max:50})`; each name: `refs.resolve('product', name)` ok -> `{productId: ref.existingId, name: label}` (a `planKey` ref is impossible, throw if seen); `unknown_ref` -> `{productId:null, name}` (free item, name max 140 else `too_long`); `archived_ref` -> `lookupIssue`; `!multiple` and more than one -> `too_many_values` | `{kind:'products'}` |
     Any `coerceCell` failure -> `err(row, header, result.code, result.message)`.
   - RECOGNITION KEY: `key = leadRecognitionKey(contactName, clientLabel ?? empresa ?? null)`, where `plan.ts` EXPORTS `export function leadRecognitionKey(contactName: string, clientLabel: string | null): string { return normalizeLabel(contactName) + '|' + normalizeLabel(clientLabel ?? ''); }` (slice 14b imports it for the database side, so there is one spelling). Keep `seenInFile: Map<string, number>`; `ordinal = (seen.get(key) ?? 0) + 1`; store it. If the row has NO error: when `ordinal > 1` and `(existingLeadKeys.get(key) ?? 0) < ordinal` add `warn(row, contactHeader, 'possible_duplicate', 'O lead de "X" na empresa "Y" repete a linha N desta planilha; confira se não é o mesmo lead.')` (N = first row of the key); then if `(existingLeadKeys.get(key) ?? 0) >= ordinal` the row is RECOGNIZED: `recognizedLeads += 1`, no op. Else push a `MappingLeadOp`.
   - A row with any error pushes no op.
5. Totals: `counts = { ...(leadOps.length ? {leads: leadOps.length} : {}), ...(clientOps.length ? {clientes: clientOps.length} : {}) }`; `recognized` = `{ ...(cad.recognized.clientes ? {clientes} : {}), ...(recognizedLeads ? {leads: recognizedLeads} : {}) }`. `issues` sorted with `sortIssues` (from `../plan/index.js`).

Decisions already made (no open questions):
- Idempotency rule for leads (the recognition rule): a sheet row IS an existing lead when the chosen pipeline already holds, among LIVE leads (`deleted_at IS NULL`), at least `n` leads whose key `normalizeLabel(contact_name) + '|' + normalizeLabel(client name or client_name_snapshot)` equals the row's key, where `n` is the row's occurrence number among rows with that key in the file (multiset rule, so a file with two identical rows imports two and a re-import creates none). It writes and updates nothing. Soft-deleted leads do not count, so a deleted lead is re-created by a re-import (documented in 14b's reference update).
- The import never walks the transition graph: it places a lead directly in its stage (history and the unique initial event are written by the lead service at creation). Orcamento stages are refused. `ganho` and `pausado` exits are allowed; `perdido` (`requires_reason`) needs the reason.
- A stage column value with no mapping is an ERROR (never silently the default stage). Blank stage -> default stage.
- Money in cents, dates as ISO civil days (`coerceCell` day), never `new Date`.

## Steps (TDD)

1. `mapping/__tests__/suggest.test.ts` and `read-sheet.test.ts`, `plan.test.ts` first (see Tests); run, they fail (modules missing).
2. Create `types.ts`, then `suggest.ts`, `read-sheet.ts`, `plan.ts` in that order; after each, run its test file.
3. `git diff --stat` must show NO change to `workbook-schema.ts`, `parse.ts`, `refs.ts`, `plan/*.ts`, `executor.ts`, `routes.ts`.

## Tests

Fixtures: `xlsx-fixture.ts` `buildXlsx(tabs)` (exists: builds a workbook from rows of cells) for `read-sheet`; `richCatalog()` from `../../__tests__/plan-fixtures.js` for `ImportCatalog` (clientes: `Padaria Pão Quente` doc `12.345.678/0001-90`; people: `Ana Souza` vendedor, `Beto Inativo`; products incl. `Sistema legado`); a local `mappingCatalog()` in `plan.test.ts` with one active pipeline `PIPE` (stages by position: `Novo` normal, `Contato feito` normal, `Orçamento` type orcamento, `Perdido` saida/perdido requiresReason, `Ganho` saida/ganho, `Pausado` saida/pausado, `Antiga` archived) and fields `descricao` (text), `nascimento` (date), `origem` (options `site`/`Site`, `indicacao`/`Indicação`), `ticket` (money), `peso` (number), `produtos` (reference produto multiple), `cliente` (system reference cliente), `venda` (reference venda). A `sheet(headers, rows)` builder makes a `MappedSheet` with Excel rows from 2; `cfg(columns, over)` builds a `MappingConfig`.

`read-sheet.test.ts`:
- `it('reads the first visible tab with arbitrary headers and numbers rows from the header row')`.
- `it('skips Leia-me, Listas and hidden tabs, and picks a named tab case-insensitively')`.
- `it('a blank header becomes Coluna N and blank rows are skipped')`.
- `it('headerRow 3 reads the header from row 3 and data from row 4')`.
- `it('returns null for a non-xlsx buffer and for an unknown sheetName')`.
- `it('more than 5000 filled rows yields one too_many_rows file issue')` (build 5001 rows; allow 20s timeout).

`suggest.test.ts`:
- `it('maps common Portuguese headers to core fields')` (Telefone -> contactPhone, E-mail -> contactEmail, Empresa -> clientName, CNPJ -> clientDocument, Responsável -> sellerName, Valor estimado -> estimatedValue, Fase -> stage, Motivo da perda -> lostReason, Nome -> contactName).
- `it('matches a dynamic field by label or key, never the system Cliente field')`.
- `it('a repeated header only suggests the first column')`.
- `it('unknown header is ignore')`.

`plan.test.ts` (oracle):
- `it('plans a clean sheet: leads, a new cliente, a recognized cliente by document, counts and recognized')`: columns Nome/Telefone/Empresa/CNPJ/Etapa; row A empresa `Padaria Pão Quente` with doc `12345678000190` -> no createClient, `recognized.clientes === 1`, lead `clientRef = {existingId: IDS.clientPadaria}`; row B empresa `Mercado Novo` -> one createClient op; `counts` `{leads: 2, clientes: 1}`.
- `it('missing required mapping is one file-level error and plans no row')` (no contact column / no phone-or-email).
- `it('duplicate target, unknown field, system Cliente field and venda reference are config errors')`.
- `it('stage values map through stageMap; an unmapped value is stage_unmapped, never the default stage')`.
- `it('blank stage goes to defaultStageId, else the first normal stage')`.
- `it('an orcamento stage in stageMap or as default is stage_not_allowed')`.
- `it('the perdido stage needs a lost reason; a reason on another stage is only a warning and is dropped')`.
- `it('coerces dynamic fields: money in cents, date dd/mm/aaaa to ISO, number, option by label or key')`, `it('unknown option is unknown_option with the allowed list')`, `it('products: catalog hit keeps the id, unknown name is a free item, archived is archived_ref')`.
- `it('seller without the Vendedor funcao is seller_not_a_vendedor; unknown seller is unknown_ref')`.
- `it('email shape and contact_required')`.
- `it('RECOGNITION: a sheet row whose key is already in existingLeadKeys creates nothing and counts recognized.leads')`; `it('multiset: two identical rows with one existing lead recognize one and create one, with possible_duplicate warning')`; `it('the key uses the resolved cliente label, not the typed text')` (typed `padaria pao quente` against stored `Padaria Pão Quente`).
- `it('leadRecognitionKey ignores accents, case and spacing and treats a null cliente as empty')`.
- `it('createClients false: unknown empresa stays free text, no createClient op')`.
- `it('is deterministic and pure: planning twice gives toEqual plans and the input is not mutated')`.
- `it('no file in mapping/ (except read-sheet.ts importing exceljs) imports the database, the clock or process.env')`: read the three source files with `readFileSync` and assert none matches `/db\/|process\.env|new Date\(|Date\.now|getDb|drizzle/` (positive control: the same regex DOES match a literal string `'new Date()'` in the test).

## Commands

```bash
pnpm --filter @fxl-sales/api exec vitest run src/domains/import/mapping/__tests__/plan.test.ts
pnpm --filter @fxl-sales/api exec vitest run src/domains/import
pnpm --filter @fxl-sales/api lint
pnpm --filter @fxl-sales/api type-check
```

## Risks

- `planCadastros` also looks at the other (empty) sheets: confirm with `plan.test.ts` that no issue with a sheet other than `clientes`/`leads`/null appears.
- Names of phase 2 types are NOT used in this slice (that is on purpose): the adapter to the lead write schema lives in 14b.
- Excel dates arrive as `Date` in `RawCell`; `coerceCell` day handles them. `displayRaw` of a `Date` is dd/mm/aaaa in UTC; stage values that are dates are unsupported (documented in the web copy).
