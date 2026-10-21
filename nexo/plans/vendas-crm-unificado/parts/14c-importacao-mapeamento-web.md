# Part 14c-importacao-mapeamento-web of slice 14-importacao-mapeamento

Original frontmatter (for reference, not a slice):

```yaml
id: 14c-importacao-mapeamento-web
milestone: v4.8.0
status: todo
depends_on: ["14b-importacao-mapeamento-api"]
files_modified: ["apps/web/src/sales-ops/import/mapping/api.ts", "apps/web/src/sales-ops/import/mapping/hooks.ts", "apps/web/src/sales-ops/import/mapping/mapping-state.ts", "apps/web/src/sales-ops/import/mapping/mapping-copy.ts", "apps/web/src/sales-ops/import/mapping/MappingImportView.tsx", "apps/web/src/sales-ops/import/ImportContainer.tsx", "apps/web/src/sales-ops/import/mapping/__tests__/mapping-state.test.ts", "apps/web/src/sales-ops/import/mapping/__tests__/mapping-import-view.test.tsx"]
affected_tests: [
  {path: apps/web/src/sales-ops/import/__tests__/import-view.test.tsx, impact: "ImportView is untouched; the container gains a mode toggle", update: "none expected, run to prove", command: "pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/import", owner: builder},
  {path: apps/web/src/sales-ops/import/__tests__/import-routing.test.tsx, impact: "mocks the containers; the shell mounting is unchanged", update: "none expected, run to prove", command: "pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/import/__tests__/import-routing.test.tsx", owner: builder}
]
acceptance: "given an uploaded sheet with arbitrary headers, when the operator maps columns, maps the stage values to stages of a pipeline, validates and confirms, then the screen shows the preview counts (with recognized leads and clientes), blocks on errors, commits once and shows the created and recognized counts"
goal: "Add the 'Mapear minha planilha' flow to the Importação screen: upload, column mapping, stage mapping, preview and commit."
must_not_break: ["ImportView and its tests are unchanged", "UI Controls: every picker is the Combobox, numeric field is <Input type=number>, no native select", "errors classified by HTTP status only, a 403 renders inline and never ForbiddenPanel", "the web never parses xlsx"]
rules: ["Pickers use Combobox from @/components/ui/combobox with formSelectClass-equivalent local copy (44px) in form rows", "Style constants are local copies (import cycle with SalesOpsApp, same convention as ImportView.tsx)", "A new file selection discards the inspect result, the draft and the preview, so a commit can never send a file other than the one validated", "No raw ids in the UI: pipelines, stages and fields appear by name", "Component state only, nothing in the URL", "The commit button is type=button"]
verifier_focus: "commit sends the SAME file and config the preview validated; changing any mapping clears the preview; an unmapped stage value blocks Validar with a clear hint; recognized leads and clientes are displayed; 422 renders the preview body; 403 inline; no native select"
oracle: "apps/web/src/sales-ops/import/mapping/__tests__/mapping-state.test.ts"
```

# 14c - Importação com mapeamento: tela

## Context

- Existing screen: `apps/web/src/sales-ops/import/ImportContainer.tsx` (no state, mutateAsync callbacks) mounts `ImportView.tsx` (327 lines, template flow). Reusable, unchanged: `ImportCountsTable.tsx` (props `counts`, `heading`, `emptyText`), `ImportIssueList.tsx` (props `issues`, `truncated`), `issues.ts` (`groupImportIssues`, `totalCount`), `types.ts` (`ImportPreviewBody`, `ImportCommitBody`, `isImportPreviewBody`, `MAX_IMPORT_UPLOAD_BYTES`, `XLSX_ACCEPT`), `import-copy.ts` (`IMPORT_COPY`, `importErrorMessage` keyed on HTTP status), hooks pattern in `hooks.ts` (`useAppMutation`, `NO_CACHE_EFFECT`, `requireToken`, commit invalidates `[queryKeys.salesOps.all, queryKeys.leads.all]`), `api.ts` (`apiUpload`, `BASE = '/api/v1/sales-ops/import'`).
- The server (slice 14b) exposes `POST /import/mapping/inspect|preview|commit` (multipart `file`, plus the JSON string field `config` for preview and commit; `sheetName` and `headerRow` form fields for inspect). Wire types are specified in 14a (`MappingConfig`, `MappingTarget`) and 14b (`MappingInspectBody`); mirror them by hand (the web never imports from apps/api).
- Preview/commit bodies are the existing `ImportPreviewBody`/`ImportCommitBody`; the mapped flow puts `leads` and `clientes` in `counts` and `recognized` (`SHEET_LABELS` already labels both). `recognizedClientCount` in `issues.ts` only reads `clientes`; this slice adds its own `recognizedCount(body, key)` in `mapping-state.ts` and does NOT edit `issues.ts`.
- `Combobox` API: `apps/web/src/components/ui/combobox.tsx` (`options`, `value`, `onChange`, `aria-label`, `className`, `placeholder`, `searchPlaceholder`; trigger `role="combobox"`, options `role="option"`). The page is not inside a Dialog, so `useInlineLayer` is not needed. The confirm dialog is the same `AlertDialog` composition as `ImportView.tsx:170-185`.

## Design

### `mapping/mapping-state.ts` (pure, no React)

```ts
export const CORE_TARGET_LABELS = {
  contactName: 'Nome do contato', contactPhone: 'Telefone', contactEmail: 'E-mail',
  clientName: 'Empresa', clientDocument: 'CNPJ/CPF da empresa', clientContact: 'Contato da empresa',
  sellerName: 'Vendedor', estimatedValue: 'Valor estimado', stage: 'Etapa', lostReason: 'Motivo da perda',
} as const;
export type CoreTargetKey = keyof typeof CORE_TARGET_LABELS;
export type MappingTarget =
  | { kind: 'core'; field: CoreTargetKey } | { kind: 'field'; key: string } | { kind: 'ignore' };

export type MappingInspectBody = {
  sheetNames: string[]; sheetName: string; headerRow: number; rowCount: number;
  columns: Array<{ index: number; header: string; sample: string[]; distinct: string[] | null; suggested: MappingTarget }>;
  pipelines: Array<{ id: string; name: string; isDefault: boolean; stages: Array<{ id: string; name: string; type: string; exitKind: string | null; requiresReason: boolean }> }>;
  fields: Array<{ key: string; label: string; kind: string; mappable: boolean }>;
  issues: ImportIssue[];
};

export type MappingDraft = {
  sheetName: string | null; headerRow: number;
  pipelineId: string; defaultStageId: string | null; createClients: boolean;
  targets: Record<number, MappingTarget>;           // column index -> target
  stageByValue: Record<string, string>;              // sheet value (as shown) -> stage id ('' = not mapped yet)
};

export const targetKey = (t: MappingTarget): string => t.kind === 'core' ? `core:${t.field}` : t.kind === 'field' ? `field:${t.key}` : 'ignore';
export function parseTargetKey(key: string): MappingTarget;   // inverse; unknown -> {kind:'ignore'}
export function targetOptions(inspect: MappingInspectBody, draft: MappingDraft, columnIndex: number): Array<{ value: string; label: string }>;
//   'ignore' -> 'Ignorar esta coluna'; core fields -> CORE_TARGET_LABELS; fields with mappable -> `Campo: ${label}`.
//   A target already used by ANOTHER column is still offered (choosing it moves it, see setColumnTarget).
export function initialDraft(inspect: MappingInspectBody): MappingDraft;
export function setColumnTarget(draft: MappingDraft, inspect: MappingInspectBody, columnIndex: number, key: string): MappingDraft;
export function stageColumnIndex(draft: MappingDraft): number | null;
export function stageValuesToMap(draft: MappingDraft, inspect: MappingInspectBody): { values: string[]; tooMany: boolean };
export function activeStages(draft: MappingDraft, inspect: MappingInspectBody): MappingInspectBody['pipelines'][number]['stages'];
export function buildMappingConfig(draft: MappingDraft): MappingConfigWire;   // exactly the server MappingConfigSchema JSON
export function mappingBlockers(draft: MappingDraft, inspect: MappingInspectBody): string[]; // pt-BR hints, [] when ready
export function recognizedCount(body: { recognized?: Partial<Record<string, number | undefined>> }, key: 'leads' | 'clientes'): number;
```
Rules (already decided):
- `initialDraft`: `pipelineId` = the `isDefault` pipeline else the first; `targets[i] = column.suggested`; `headerRow = inspect.headerRow`; `sheetName = inspect.sheetName`; `createClients = true`; `defaultStageId = null`; `stageByValue`: for every distinct value of the stage column, the id of the active stage of the chosen pipeline whose `normalize(name) === normalize(value)` (normalize = trim, NFD, strip accents, lower, collapse spaces) and `type !== 'orcamento'`, else `''`.
- `setColumnTarget`: `parseTargetKey(key)`; when the new target is `core`/`field` and another column already holds the same core field or field key, that other column becomes `{kind:'ignore'}` (a target belongs to one column). Changing a column to or from the stage target rebuilds `stageByValue` the way `initialDraft` does (keeping already chosen ids for values that still exist).
- `activeStages`: stages of the chosen pipeline, `type !== 'orcamento'` (orçamento stages are not importable and are not offered).
- `buildMappingConfig`: `{ sheetName, headerRow, pipelineId, defaultStageId: defaultStageId || null, createClients, columns: [{index, target}] (skip nothing: ignore targets are sent), stageMap: entries of stageByValue with a non-empty id as `{value, stageId}` }`.
- `mappingBlockers` (the server re-checks everything; these only guard the button): contact name column missing -> 'Escolha a coluna do Nome do contato.'; neither Telefone nor E-mail mapped -> 'Escolha a coluna do Telefone ou do E-mail.'; stage column mapped with `tooMany` -> 'A coluna de etapa tem mais de 100 valores diferentes; use outra coluna ou ajuste a planilha.'; any value of the stage column with an empty stage id -> `Escolha a etapa do valor "${v}".` (one hint per value, at most 3 shown then 'e mais N valores sem etapa'); no active stage in the pipeline -> 'O funil escolhido não tem etapa disponível para importação.'

### `mapping/api.ts`, `mapping/hooks.ts`

`mappingImportApi.inspect(file, opts: {sheetName: string | null; headerRow: number}, token)`, `.preview(file, config, token)`, `.commit(file, config, token)`; BASE `${'/api/v1/sales-ops/import/mapping'}`; `FormData`: `file`, and `config` (`JSON.stringify(config)`) or for inspect `sheetName` (only when non-null) and `headerRow` (String). Hooks `useInspectMappingFile`, `usePreviewMappedImport`, `useCommitMappedImport` with the same shape as `hooks.ts` (inspect and preview `NO_CACHE_EFFECT`; commit invalidates `[queryKeys.salesOps.all, queryKeys.leads.all]`); variables `{ file, config }` / `{ file, sheetName, headerRow }`.

### `mapping/mapping-copy.ts`

`MAPPING_COPY` (all pt-BR, no em dash): `modeTemplate: 'Planilha modelo'`, `modeMapping: 'Mapear minha planilha'`, `intro: 'Envie qualquer planilha .xlsx com leads: você escolhe o que cada coluna significa. A importação só cria registros novos e nunca altera nada existente.'`, `step1Title: '1. Envie a planilha'`, `sheetLabel: 'Aba'`, `headerRowLabel: 'Linha dos títulos'`, `read: 'Ler planilha'`, `reading: 'Lendo...'`, `step2Title: '2. O que cada coluna significa'`, `columnHeader: 'Coluna da planilha'`, `examplesHeader: 'Exemplos'`, `targetHeader: 'Destino'`, `step3Title: '3. Funil e etapas'`, `pipelineLabel: 'Funil'`, `defaultStageLabel: 'Etapa para linhas sem etapa'`, `defaultStageAuto: 'Primeira etapa do funil'`, `stageValueHeader: 'Valor na planilha'`, `stageTargetHeader: 'Etapa do funil'`, `createClientsLabel: 'Criar as empresas que ainda não estão no cadastro'`, `step4Title: '4. Confira e importe'`, `validate: 'Validar'`, `validating: 'Validando...'`, `recognizedLeads: (n) => n === 1 ? '1 lead da planilha já existe neste funil (mesmo nome e empresa) e não será criado de novo.' : \`${n} leads da planilha já existem neste funil (mesmo nome e empresa) e não serão criados de novo.\``, `recognizedLeadsDone` (past tense variant), `recognizedClients: (n) => ...` (same idea, "clientes já cadastrados"), `confirmTitle: 'Importar leads?'`, `confirmText: (total) => \`Serão criados ${total} registros nesta organização, de uma vez. Se qualquer linha for recusada, nada é criado. Registros existentes nunca são alterados.\``, `blockersTitle: 'Falta completar'`, `stageValuesHint: 'Cada valor da coluna de etapa precisa de uma etapa do funil.'`, `noneToCreate: 'Nenhum registro novo para criar.'`, reuse `IMPORT_COPY` entries for the rest (`errorsBlock`, `readyOk`, `readyClean`, `truncated`, `allOrNothing`, `import`, `importing`, `confirmCancel`, `confirmAction`, `successTitle`, `successText`, `another`, `tooLargeLocal`, `notXlsxLocal`).

### `mapping/MappingImportView.tsx`

Props: `{ onInspect(file, opts): Promise<MappingInspectBody>; onPreview(file, config): Promise<ImportPreviewBody>; onCommit(file, config): Promise<ImportCommitBody> }` (the container passes `mutateAsync`). Local style copies as in `ImportView.tsx:25-35` (`panelClass`, `primaryButtonClass`, `secondaryButtonClass`, `errorBannerClass`) plus `formSelectClass = 'h-11 rounded-[10px] border-[#dcdce2] bg-[#fafafb] px-3 text-sm font-medium text-[#201f24] focus-visible:border-[#eaa81a] focus-visible:ring-0 focus-visible:ring-offset-0'` for the pickers inside form rows. State: `file`, `inspect`, `draft`, `preview`, `result`, `error`, `localError`, `busy: 'inspect'|'preview'|'commit'|null`, `confirmOpen`, `sheetName`, `headerRow` (inspect options, defaults `null`/`1`).
Layout (same `StepPanel` look as `ImportView`, each with `data-mapping-step="1".."4"`):
1. File: hidden `<input type="file" accept={XLSX_ACCEPT}>` behind a `Escolher arquivo` label button; local validations (`.xlsx`, `MAX_IMPORT_UPLOAD_BYTES`) with the `IMPORT_COPY` messages; when `inspect.sheetNames.length > 1` a `Combobox` (`aria-label="Aba"`) and a `<Input type="number" min={1} max={50} aria-label="Linha dos títulos">` appear and changing either re-runs inspect for the same file. Button `Ler planilha` (type="button"). A NEW file selection or a re-inspect resets `inspect`, `draft`, `preview`, `result`, errors.
2. Columns (only after inspect): a table `Coluna da planilha | Exemplos | Destino`; Exemplos = up to 3 `sample` values joined with ` · ` (muted, truncated with `title`); Destino = `Combobox` (`aria-label={\`Destino da coluna ${header}\`}`, options from `targetOptions`, `onChange={(k) => update(setColumnTarget(draft, inspect, index, k))}`). Every draft change sets `preview` to `null`.
3. Funil e etapas: `Combobox` Funil (pipeline names; changing it resets `defaultStageId` and rebuilds `stageByValue`); `Combobox` `Etapa para linhas sem etapa` with option `''` -> `Primeira etapa do funil` plus `activeStages`; when a stage column is mapped, a table `Valor na planilha | Etapa do funil` with one `Combobox` per distinct value (`aria-label={\`Etapa para o valor ${value}\`}`; placeholder `Escolher etapa`; options `activeStages`); a checkbox-like switch row `createClients` using the same `<input type="checkbox">` styling as other forms (a native checkbox is allowed; only select/option/datalist/number inputs are banned).
4. Conferir: `mappingBlockers` list (`data-mapping-blockers`) when not empty; button `Validar` (disabled while blockers or busy; type="button") -> `onPreview(file, buildMappingConfig(draft))`. The preview block mirrors `ImportView.tsx:120-168`: `ImportCountsTable` (`heading: 'Registros a criar'`), `MAPPING_COPY.recognizedLeads(n)` / `recognizedClients(n)` lines (`data-mapping-recognized`) from `recognizedCount`, `ImportIssueList`, ready text, and `Importar` (type="button", disabled with errors, `nothingNew` when `totalCount(counts) === 0`) opening the AlertDialog; confirm calls `onCommit(file, config)` with the SAME `file` and a config rebuilt from the SAME draft, then shows the success block (`ImportCountsTable` heading `Registros criados`, recognized-done lines, `Importar outra planilha` -> reset).
Errors: `catch (e)`: `status === 422 && isImportPreviewBody(body)` -> `setPreview(body)` plus `importErrorMessage(e)` banner; otherwise `importErrorMessage(e)` (a 403 is the inline admin message; never `ForbiddenPanel`).

### `ImportContainer.tsx`

Add component state `mode: 'template' | 'mapping'` (default `'template'`) and a two-button segmented control above the content (`data-import-mode`, buttons `type="button"`, `aria-pressed`), labels `MAPPING_COPY.modeTemplate` / `modeMapping`. `mode === 'template'` renders the existing `<ImportView .../>` unchanged; `'mapping'` renders `<MappingImportView onInspect={(file, opts) => inspect.mutateAsync({ file, ...opts })} onPreview={(file, config) => preview.mutateAsync({ file, config })} onCommit={(file, config) => commit.mutateAsync({ file, config })} />`. The container keeps "no logic" otherwise.

## Steps (TDD)

1. Write `mapping-state.test.ts`; run (fails).
2. Create `mapping-state.ts`, then `mapping-copy.ts`; run until green.
3. Write `mapping-import-view.test.tsx`; run (fails).
4. Create `api.ts`, `hooks.ts`, `MappingImportView.tsx`; edit `ImportContainer.tsx`; run until green.
5. Lint, type-check, whole web suite.

## Tests

`mapping-state.test.ts` (plain vitest, oracle):
- `it('initialDraft takes the server suggestions, the default pipeline and auto-matches stage values by accent-free name')` (inspect fixture with `Fase` column distinct `['Novo','Em contato','Fechado']`, pipeline stages `Novo`, `Contato feito`, `Orçamento`(orcamento), `Perdido`; `Novo` auto-maps, the others stay `''`; `Orçamento` is never an auto target).
- `it('setColumnTarget moves a target: assigning Telefone to a second column turns the first into ignore')`.
- `it('changing a column to the stage target rebuilds stageByValue and keeps chosen ids for values that remain')`.
- `it('activeStages hides orcamento stages')`.
- `it('mappingBlockers: missing name, missing phone/email, unmapped stage values (three shown then "e mais N"), too many distinct values, empty pipeline')`.
- `it('buildMappingConfig is exactly the server schema: ignore columns are sent, empty stage ids are not, defaultStageId null when blank')`.
- `it('parseTargetKey is the inverse of targetKey and an unknown key is ignore')`.
- `it('recognizedCount reads leads and clientes, absent or invalid is 0')`.

`mapping-import-view.test.tsx` (`// @vitest-environment happy-dom`, `createRoot` + `act`; mock `@/components/ui/alert-dialog` with the CloseCtx version copied from `people/__tests__/vendedores-view.test.tsx:28-60`; callbacks are `vi.fn`):
- `it('walks upload, inspect, mapping, stage mapping, validate and commit with the same file and config')`: choose a `File` named `leads.xlsx`; `onInspect` resolves the fixture; click `Ler planilha`; the three steps render; choose the Telefone destination for the second column through the Combobox (click trigger, click option); map the stage value `Fechado`; click `Validar`; `onPreview` was called with the same `File` object and a config whose `columns` and `stageMap` match; click `Importar` then the dialog action; `onCommit` called with the same file and a toEqual config; success counts shown.
- `it('uses Combobox pickers only: no native select element')`.
- `it('Validar is disabled while a stage value has no stage and shows the blocker line')`.
- `it('changing any destination clears the preview and the Importar button')`.
- `it('selecting another file clears inspect, draft and preview')`.
- `it('shows recognized leads and clientes lines from the preview and from the result')`.
- `it('a 422 with a preview body shows the issues and the changed-since-validation banner; a 403 shows the admin message inline')` (reject with `{status: 422, body: {ok:false,...}}` / `{status: 403}`).
- `it('rejects a non-xlsx and an oversize file locally without calling inspect')`.
- `it('shows the Aba picker and the Linha dos títulos number input only when the workbook has several tabs, and re-inspects on change')`.
- `it('ImportContainer toggles between the template flow and the mapping flow')`: render `ImportContainer` with `vi.mock('../hooks')` and `vi.mock('../mapping/hooks')` returning `{ mutateAsync: vi.fn() }` objects; default shows the template steps (`[data-import-step]`), clicking `Mapear minha planilha` shows `[data-mapping-step]`.

## Commands

```bash
pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/import/mapping/__tests__/mapping-state.test.ts
pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/import
pnpm --filter @fxl-sales/web lint
pnpm --filter @fxl-sales/web type-check
pnpm --filter @fxl-sales/web exec vitest run
```

Browser check for Verify (one pass, local only, `make dev-fake`, identity `team-admin`): open `cadastros/importacao`, switch to `Mapear minha planilha`, upload a small .xlsx built with the repo's real template headers changed to arbitrary names (see memory note "E2E import in the browser": dev-fake identity via localStorage, inject the file with DataTransfer), check the 44px pickers line up with the number input, the stage table does not overflow at 1280px and at 390px, and a second commit of the same file reports the leads as recognized.

## Risks

- `import-copy.test.ts` pins `IMPORT_COPY`; the new copy lives in `mapping-copy.ts` so that test is unaffected.
- A very wide sheet (256 columns) makes a long mapping table; it scrolls inside its panel (`overflow-x-auto`, `max-h-[420px] overflow-y-auto`).
- The inspect response is only trusted for display; the server re-validates every id, so a tampered draft cannot write outside the org.
