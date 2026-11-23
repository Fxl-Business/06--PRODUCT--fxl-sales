# SEAM CONTRACT - importacao-funil

Authoritative. English identifiers, pt-BR user copy. Never use the em dash.
Base: `apps/api/src/domains/import/`. The org is only the token's org. No migration. No new route.

## Workbook

- `workbook-schema.ts`: `ListSource` gains `'funis'`.
- Leads tab: new OPTIONAL column `{ key: 'funil', header: 'Funil', kind: text max 120, list: 'funis', example: null }` placed immediately BEFORE `etapa`.
- Etapas tab: new OPTIONAL column `{ key: 'funil', header: 'Funil', ... same }` placed AFTER `nome`.
- `FUNIS_TAB = 'Funis e etapas'` exported beside `LISTAS_TAB`; the parser skips it exactly like `Leia-me` and `Listas` (no `unknown_sheet` warning).

## Catalog

```ts
pipelines: Array<{ id: string; name: string; isDefault: boolean; status: string; position: number; funcaoIds: string[] }>; // every pipeline, archived included, board order (position, name)
stages: Array<{ id; name; kind; status; position; pipelineId: string; type: string; exitKind: string | null; requiresReason: boolean }>; // stages of ACTIVE pipelines, archived stages included, in pipeline board order then stage order
```

## Funil resolution: new pure module `pipeline-resolution.ts`

```ts
export type PipelineMapEntry = { pipelineId?: string; stages?: StageMap };
export type PipelineMap = Readonly<Record<string, PipelineMapEntry>>; // key: Funil as written in the sheet, matched by normalizeLabel
export type PipelineLookup = { ok: true; pipelineId: string; name: string } | { ok: false; code: PipelineIssueCode; message: string };
export type PipelineIssueCode = 'funil_required' | 'unknown_ref' | 'archived_ref' | 'invalid_pipeline_target';
export function buildPipelineIndex(catalog: ImportCatalog, pipelineMap?: PipelineMap): PipelineIndex;
interface PipelineIndex { resolve(funil: string | null): PipelineLookup; resolveUnmapped(funil: string): PipelineLookup; stageEntry(funil: string | null, etapa: string): StageMapEntry | undefined }
```

Rules of `resolve`:
1. A map entry with `pipelineId` wins for a non-blank funil: it must be an ACTIVE pipeline of the catalog, else `invalid_pipeline_target`.
2. Non-blank, no `pipelineId`: exactly the ACTIVE pipeline with that name (`normalizeLabel`); only an archived one is `archived_ref`; none is `unknown_ref`. An active one always wins over an archived one of the same name. More than one active name match after normalization picks the exact trimmed spelling, else `unknown_ref`.
3. Blank: the only active pipeline when there is exactly one; otherwise `funil_required`.

Every failure is a row error on the Funil column, on the Leads tab and on the Etapas tab.
`stageEntry`: the top-level `stageMap` (existing field, unchanged shape) applies ONLY to rows whose Funil is blank; `pipelineMap[funil].stages` applies to rows with that funil. Both match etapa names with `normalizeLabel`.
A row with a failed Funil gets no Etapa issue (its etapa cannot be judged) but every other column is still checked.

## Planning rules

- `refs`: the generic kind `'stage'` is replaced by `resolveStage(pipelineId, name): RefLookup`; workbook Etapas rows register under (pipelineId, name). `buildRefIndex(parsed, catalog, pipelines)`.
- `checkNewStage(nome, catalog, pipelineId)`: duplicate rules are per funil; the messages name the funil.
- `duplicate_in_sheet` for Etapas is per (funil, nome).
- Operations: `createLeadStage` and `createLead` carry `pipelineId: string`; the executor passes it to `createLeadStageInPipeline` and into the `createLead` input (no second implementation, no raw INSERT).
- `{ stageId }` must be an active, non-conversion etapa OF THE ROW'S funil, else `invalid_stage_target`.
- `{ create: true }` is one creation per (resolved pipeline, normalized etapa name), also when two sheet funis map to the same pipeline; plan key stays `stageMap:<n>`. It never duplicates an Etapas tab row of the same funil.
- `no_open_stage` is judged per funil used by the Leads tab: one file-level error per funil with no open etapa, naming the funil. An Etapas tab row of that funil counts as open.
- `possible_duplicate` of leads compares contato + empresa + funil.
- Vendedor access: for a resolved vendedor and a resolved funil, `accessiblePipelineIds(catalog.pipelines, funções held)` (from `@fxl-sales/shared-utils/crm-model`, the one rule) must include the funil; otherwise row error `seller_without_pipeline_access` on the Vendedor column. Held = every catalog função for which `refs.personHasFuncao(person, função)` (existing or workbook pessoa).
- The reason rule stays `kind === 'lost'`.

## HTTP

- `POST /import/preview` and `/commit` accept an optional multipart `pipelineMap` (JSON of `PipelineMap`, strict entries, `pipelineId` non-empty string). Malformed is the same `400` body as a malformed `stageMap`. Blank means none. The commit re-plans with both maps.
- Preview body adds and changes (additive):

```ts
leadStages: Array<{ name: string; leads: number; resolution: LeadStageResolution; funil: string | null }>; // one per (sheet funil, etapa); funil null when the cell is blank
stageTargets: Array<{ id: string; name: string; kind: 'normal' | 'lost'; pipelineId: string }>; // of EVERY active funil, board order
leadPipelines: Array<{ name: string; leads: number; resolution: { kind: 'existing'; pipelineId: string } | { kind: 'not_found' } }>; // distinct non-blank Funil names of the Leads and Etapas tabs, first spelling, WITHOUT the map; archived reads not_found
pipelineTargets: Array<{ id: string; name: string; isDefault: boolean }>; // active funis, board order
```

`leadStages` is resolved inside the row's funil WITH `pipelineMap[...].pipelineId` applied and WITHOUT the stage maps; an etapa whose funil does not resolve (blank included when blank is refused) is left out.

## Template and export (slice 02)

- Tab order: `Leia-me`, `Funis e etapas` (visible), the data tabs, hidden `Listas`.
- `Funis e etapas` columns: `Funil`, `Etapa`, `Tipo`, `Aceita lead na importação`, `Exige motivo da perda`, `Funções com acesso`. One row per active etapa of each active funil, in board order, Funil repeated on every row.
- `Tipo`: `Em andamento` | `Proposta` | `Saída: Ganho` | `Saída: Perdido` | `Saída: Pausado`. A stage whose catalog `kind` is not `conversion` while its `type` is `orcamento` (orcamentos module off) reads `Em andamento`. `Aceita lead na importação` is `Não` only for `kind === 'conversion'`. `Exige motivo da perda` is `Sim` only for `kind === 'lost'`.
- `Funções com acesso`: linked função names joined by `; ` (an archived one as `Nome (arquivada)`); the default funil appends / is `Quem não tem função ligada a nenhum funil`; a non-default funil with none is `Só administradores`.
- Dropdowns: `Funil` lists active funis. `Etapa` (Leads): with ONE active funil, the plain static list as today; with several, a formula list that depends on the row's Funil cell (exact, case-insensitive, no wildcard semantics), nothing offered for a blank or unknown Funil.
- With several active funis the Funil header of both tabs is styled and noted as required, and the Leia-me column lines say `obrigatória`.
- The example dataset writes the default funil's name in Funil of Leads and Etapas.
- Export fills `funil` with the lead's pipeline name.
