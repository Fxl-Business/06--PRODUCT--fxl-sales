# Part 10a - Kanban as a view of the selected pipeline, with period filter

Part of slice `10-web-kanban-funil-periodo`. Depends on parts 08a, 08b, 09a-09e.

## Context

- The board container reads its columns from `useLeadStages()` (`LeadsBoardContainer.tsx` line ~140, `GET /lead-stages`) and fans out one `GET /leads?stageId=` per column (`useLeadsBoard`, `hooks.ts` lines 79-150). Summary: `leadsApi.stageSummary(filters)` (`api.ts` ~line 180). Filters object `LeadBoardFilters = { sellerPersonId?: string } | undefined` is declared in `types.ts` (line 151) and locally in `lib/query-keys.ts` (line 21), memoized once in the container and shared by the board read, the move and the summary (a mismatch silently loses the optimistic write).
- Phase 2 contract: `GET /pipelines` gives pipelines with stages (`type`, `behavior`, `exitKind`, `requiresReason`) and `transitions`; `GET /leads` and `GET /leads/summary` accept `pipelineId` (default: the org's default), `from`, `to`; a cross-stage move not in the graph answers `409 transition_not_allowed`; a reorder inside one column is always allowed. The legacy `kind` the board branches on is derived from `type`/`exitKind` by the lookups of part 08a (`pipelineStagesAsBoardStages`), so `stageOpensConversion`, `stageRequiresReason` and `dragHandsBackToDialog` keep working untouched.
- Colours: `stageColors` and `stageIsNormal` in `board-ui.ts` (lines 251-276) use `KIND_COLORS[stage.kind]` with only `conversion` and `lost` keys; the write-surface scan forbids inline `kind === 'normal'|'lost'`.
- Board header: view toggle (lines 551-583), vendedor filter (585-600), search (601-609), `Novo lead` (611-620). Move target menus: `moveTargetsFor(lead, columns, hasConversionHandler)` at `LeadsBoard.tsx` lines 747 and 1074; the move emitter is `emitMove` (lines 429-466); drop handler `handleDragEnd` (506-540).
- Routed modes: `funil` renders the Quadro (`routedMode 'board'`), `leads?etapa=` renders the Lista of one stage (`'stage'`). The funnel shapes read `useLeadStageSummary` aggregates.
- Pipeline selector is component state (query string would also do; the contract says not a path segment). Component state matches `leadView` and keeps the URL as the source of truth only for workspace/page/lead/stage.

## Design

1. Filters (types, key, api, hooks):
   - `types.ts` line 151 and `query-keys.ts` line 21: `LeadBoardFilters = { sellerPersonId?: string; pipelineId?: string; from?: string; to?: string } | undefined`.
   - `api.ts`: `ListLeadsParams` gains `pipelineId?`, `from?`, `to?`; `listLeadsQuery` sets them when present (`pipelineId`, `from`, `to` keys); `stageSummary(filters, token)` sets the same three plus `sellerPersonId` from `filters`.
   - `hooks.ts` `useLeadsBoard`: pass `pipelineId: filters?.pipelineId, from: filters?.from, to: filters?.to` into `leadsApi.listLeads`; `boardFiltersOf` casts to `LeadBoardFilters`.
2. Colours (object lookup): in `board-ui.ts` widen the key type: `type ColorKey = LeadStageKind | PipelineExitKind | PipelineStageType;` `KIND_COLORS: Partial<Record<ColorKey, StageColor>>` adds `orcamento` (amber `{dot:'#b7791f', soft:'#fdf6e7', border:'#f3e2b8', ink:'#8a5a0a'}`), `ganho` (the existing conversion green object), `perdido` (the existing lost object), `pausado` (grey `{dot:'#8b8b92', soft:'#f4f4f6', border:'#e1e1e6', ink:'#57575f'}`); `conversion` and `lost` stay. Add `function colorKeyOf(stage: Pick<SalesOpsLeadStage,'kind'|'type'|'exitKind'>): ColorKey { return stage.exitKind ?? stage.type ?? stage.kind; }` - careful: a `saida` stage has `exitKind` set and a `normal` stage has `type 'normal'` which would hit no key and fall to the palette: this is intended (`KIND_COLORS['normal']` is undefined, so `stageIsNormal` is true). `stageColors` and `stageIsNormal` take `Pick<..., 'id'|'kind'|'type'|'exitKind'>` (the new two optional) and look up `KIND_COLORS[colorKeyOf(stage)]`. A `type 'orcamento'` stage therefore turns amber instead of the old conversion green; legacy fixtures without `type` keep the old colours.
3. Move graph (pure, `board-move.ts`): `moveTargetsFor(lead, stages, hasConversionHandler, allowedStageIds?: ReadonlySet<string>)` adds, after the existing filter, `.filter((stage) => !allowedStageIds || allowedStageIds.has(stage.id))`. Callers in `LeadsBoard.tsx` (lines 747, 1074) pass `pipeline ? allowedTargetIds(pipeline, lead.stageId) : undefined`. `LeadsBoard` gets the prop `pipeline?: CrmPipeline`. In `handleDragEnd` after `target` is resolved (line ~516) add: `if (pipeline && !isTransitionAllowed(pipeline, dragged.stageId, toStageId)) { setMoveNotice(MOVE_NOT_ALLOWED_COPY); return; }`; `const [moveNotice, setMoveNotice] = React.useState<string | null>(null)` cleared in `handleDragStart`; render `<p className={noticeClass} data-move-notice role="status">{moveNotice}</p>` under the header; `MOVE_NOT_ALLOWED_COPY = 'Esse movimento não é permitido neste funil.'` in `board-labels.ts`. The API stays authoritative (a stale graph answers 409 and the optimistic move reverts).
4. New board props (all optional, so existing tests mount the board unchanged): `pipelineSelector?: { value: string | null; options: ComboboxOption[]; onChange: (id: string) => void }` rendered only when `options.length > 1` as a `Combobox` (`aria-label="Funil"`, `comboboxTriggerClass`, `w-[200px]`, placed first in the header filter row); `periodFilter?: { value: PeriodSelection; onChange: (next: PeriodSelection) => void }` rendered as `<PeriodFilter aria-label="Período dos leads" .../>` after the vendedor filter for ALL three views (Quadro, Lista, Funil); `pipeline?: CrmPipeline`.
5. Container (`LeadsBoardContainer.tsx`):
   - `const pipelinesQuery = usePipelines();` replaces the board's `useLeadStages()` (the sidebar and `LeadStagesContainer` keep `useLeadStages`). `pipelines = pipelinesQuery.data ?? []`.
   - state `pipelineChoice: string | null`, `period: PeriodSelection` (default `PERIOD_ALL_SELECTION`).
   - `const pipeline = pickPipeline(pipelines, selectedStageId ? (pipelines.find((p) => p.stages.some((s) => s.id === selectedStageId))?.id ?? pipelineChoice) : pipelineChoice);` (an `?etapa=` link lands on the pipeline that owns the stage).
   - `stages = React.useMemo(() => pipelineStagesAsBoardStages(pipeline), [pipeline])`.
   - `range = React.useMemo(() => selectionToRange(period, todayInSaoPaulo()), [period])`.
   - `filters = React.useMemo<LeadBoardFilters>(() => ({ ...(sellerFilterValue ? { sellerPersonId: sellerFilterValue } : {}), ...(pipeline ? { pipelineId: pipeline.id } : {}), ...periodQuery(range) }), [sellerFilterValue, pipeline?.id, range.from, range.to])` and `undefined` when the object is empty (keeps the old key `['leads','board',null]` for the default case). The SAME object feeds `useLeadsBoard`, `useLeadStageSummary`, `useMoveLead`.
   - loading/error: `pipelinesQuery.isPending` replaces `stagesQuery.isPending`; `pipelinesQuery.isError` joins the error branch.
   - create: the form gets `pipelineId={pipeline?.id}`.
   - hands the board `pipelineSelector` (options = active pipelines by `position`: `{ value: p.id, label: p.name }`), `periodFilter`, `pipeline`.
   - `useLeadStages` stays imported only if still used (it is not, in this file): remove the import.
6. The Lista/Quadro/Funil figures already read the filtered summary, so the period applies to columns, totals and both funnel shapes with no further change. `Carregar mais leads` keeps working (cursor is per column and the filters ride every request).
7. Docs: `CLAUDE.md` "Kanban de leads": add `The Quadro is a view of the SELECTED pipeline: columns come from GET /pipelines through pipelineStagesAsBoardStages (legacy kind derived by lookup), the pipeline selector and the period filter are component state shared by Quadro, Lista and Funil, and a cross-stage move outside the pipeline's transition graph is not offered (API 409 transition_not_allowed).` and update the colour sentence to mention `type`/`exitKind` keys. Mirror in `nexo/knowledge/reference/kanban-de-leads.md`.

## Steps (TDD)
1. Write/extend the tests below; red.
2. Items 1-4, then 5; update the legacy container tests' mocks.
3. Docs; run `src/sales-ops`.

## Tests
- New `kanban-pipeline.test.tsx` (real `LeadsBoard`, props only): with a `pipeline` of two columns and a `pipelineSelector` of two options, picking the second option calls `onChange(id)`; with one option no selector renders; the selector switches the columns when the container is driven (container test below).
- `leads-pipeline-container.test.tsx` (mock `../crm-hooks` and `../hooks`): two pipelines `A` (default) and `B`; the board shows A's columns; choosing `B` in the `Funil` picker re-renders with B's columns and the next `useLeadsBoard`/`useLeadStageSummary`/`useMoveLead` call receives the SAME filters object containing `pipelineId: B.id`; a `selectedStageId` that belongs to B opens B; creating a lead sends `pipelineId` of the selected pipeline.
- Period correctness (named oracle `leads-period.test.tsx`): with the mocked clock at `2026-10-20T01:30:00.000Z` (22:30 on 2026-10-19 in Sao Paulo) the `Hoje` preset yields filters `{ from: '2026-10-19', to: '2026-10-19' }` (not the UTC day `2026-10-20`); `Todo o período` yields no `from`/`to` and the key `null`; a reversed custom range is reported and leaves the filters open; the same `filters` object reaches board, summary and move; the period control exists in the Quadro, the Lista and the Funil views.
- `crm-api`/`leads-api-contract.test.ts`: `listLeads({stageId, pipelineId, from, to})` builds `?stageId=...&limit=100&pipelineId=...&from=...&to=...`; `stageSummary` carries the same three; absent ones are absent.
- `board-ui.test.ts`: `stageColors` for `{type:'orcamento'}`, `{exitKind:'ganho'}`, `{exitKind:'perdido'}`, `{exitKind:'pausado'}` returns the four distinct entries; legacy `{kind:'conversion'}` and `{kind:'lost'}` still return their colours; `stageIsNormal` false for those and true for `{kind:'normal', type:'normal'}`. The write-surface scan stays green (no inline kind comparison was added).
- `board-move.test.ts`: `moveTargetsFor` with an `allowedStageIds` set excludes disallowed stages and still includes the lead's own stage when it is in the set.
- Drag: `leads-board-dropzones.test.tsx` gets `a drop outside the transition graph emits no move and shows the notice` (props `pipeline` with transitions; assert `onMoveLead` not called and `[data-move-notice]` text equals `MOVE_NOT_ALLOWED_COPY`).
- Existing container tests that mock `../hooks` for `useLeadStages` now also need `vi.mock('../crm-hooks', () => ({ usePipelines: () => ({ isPending:false, isError:false, data:[pipeline] }), useFieldDefinitions: ... }))` with `pipeline` built from the same stage fixtures: `leads-contact-container.test.tsx`, `leads-stage-navigation.test.tsx` (container half), `lead-undo.test.tsx`, `lead-delete.test.tsx`, `lead-board-totals.test.tsx` (fetch-level ones add `GET .../pipelines` to their fetcher returning the stages as one pipeline with the matching ids). Assertions unchanged.

## Affected tests search
Searched `useLeadStages`, `lead-stages` and `LeadsBoardContainer` over `apps/web/src`: `leads-contact-container`, `leads-stage-navigation`, `lead-undo`, `lead-delete`, `lead-board-totals` render the real container (updated as above); `leads-routing`, `vendedores-routing`, `no-role-redirect`, `sale-deep-link`, `import-routing` mock the container; `lead-stages-view`/`LeadStagesContainer` keep using `useLeadStages` and are untouched.

## Commands
- Oracle part: `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/leads/__tests__/leads-period.test.tsx src/sales-ops/leads/__tests__/leads-pipeline-container.test.tsx src/sales-ops/leads/__tests__/kanban-pipeline.test.tsx src/sales-ops/leads/__tests__/board-ui.test.ts src/sales-ops/leads/__tests__/board-move.test.ts src/sales-ops/leads/__tests__/board-write-surface.test.ts`
- Affected: `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops`
- lint and type-check

## Risks
- The funnel `Acumulado` treats every non-`lost` stage as progression, so `pausado` and `ganho` exits count like normal stages; acceptable for this run, flagged as follow-up (the shapes need a pipeline-aware progression).
- The pipeline selector is not in the URL: reloading returns to the default pipeline.
