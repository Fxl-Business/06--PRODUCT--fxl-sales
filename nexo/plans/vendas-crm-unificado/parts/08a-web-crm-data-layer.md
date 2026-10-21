# Part 08a - Web CRM data layer

Part of slice `08-web-lead-form-unico`.

## Context

- The authoritative route list and wire shapes are in `nexo/plans/vendas-crm-unificado/contracts/SEAM-CONTRACT-PHASE2.md` (sections "Lead wire shape", "New routes").
- Today's lead client is `apps/web/src/sales-ops/leads/api.ts` (`leadsApi`, token last, `apiFetch` from `@/lib/api-client`) and hooks are in `apps/web/src/sales-ops/leads/hooks.ts` (`useLeadStages` at line 61 is the pattern: `useAccessToken` + `requireToken` + `queryKeys`).
- Query keys live in `apps/web/src/lib/query-keys.ts`, `leads` block at lines 111-124. Every key sits under the `['leads']` root so each lead write (`invalidates: [queryKeys.leads.all]`) refreshes it.
- `SalesOpsLeadStage` and `SalesOpsLead` are in `apps/web/src/sales-ops/leads/types.ts` (stage at lines 38-52, lead at lines 62-120). Existing test fixtures build these objects literally, so every new field MUST be optional or those fixtures stop compiling.
- `GET /lead-stages` already keeps the legacy `kind` (derived by the API) so the whole board keeps working; the new board columns will come from `GET /pipelines` through the adapter below (consumed by slice 10a).
- Wire assumptions BEYOND the contract (the contract does not fix them; they are isolated in this slice so a reconcile edits one file):
  - A1 `GET /followups` answers `{ followups: FollowupListRow[] }` with `FollowupListRow = { id, leadId, leadContactName, nextStep, dueOn, ownerName, doneAt }`.
  - A2 `POST /leads/:id/advance` answers `200 { lead: SalesOpsLead }` (same envelope as `/move`).
  - A3 `POST /leads/:id/notes`, `POST /leads/:id/followups` and `POST /followups/:id/done` answer a success status; the web ignores the body and refetches the summary.

## Design

1. `crm-types.ts` holds only types and string-literal constants, imports nothing at runtime. It uses `import type { SalesOpsLead } from './types'` (type-only cycle with `types.ts` is fine).
2. `crm-pipeline.ts` is PURE (no React, no fetch). It owns the lookups that turn the new model into the legacy shape the board already understands:
   - `LEGACY_KIND_BY_TYPE: Record<PipelineStageType, LeadStageKind> = { normal: 'normal', orcamento: 'conversion', saida: 'normal' }`
   - `LEGACY_KIND_BY_EXIT: Record<PipelineExitKind, LeadStageKind> = { ganho: 'normal', perdido: 'lost', pausado: 'normal' }`
   - the rule is the API's: `type orcamento -> conversion`, `exit perdido -> lost`, everything else `normal`.
3. `crm-api.ts` is a second client object `crmApi` (not an edit of `leadsApi`) so the existing `leads-api-contract.test.ts` is untouched.
4. `crm-hooks.ts` gets only the two READ hooks needed by 08c and 10a. The mutation hooks are added by 09c and 09d in this same file.
5. Query keys added under `queryKeys.leads` (all under `['leads']`):
   - `pipelines: () => ['leads', 'pipelines'] as const`
   - `fieldDefinitions: () => ['leads', 'field-definitions'] as const`
   - `detail: (leadId: string) => ['leads', 'detail', leadId] as const`
   - `followups: (filters: FollowupFilters) => ['leads', 'followups', filters] as const`
   `FollowupFilters` is declared locally in `query-keys.ts` (same rule as `LeadBoardFilters` there: this file imports nothing from `sales-ops`): `type FollowupFilters = { scope: 'mine' | 'team'; status: 'open' | 'done' | 'all'; from?: string; to?: string }`.

## Steps (TDD)

1. Write `apps/web/src/sales-ops/leads/__tests__/crm-pipeline.test.ts` and `crm-api-contract.test.ts` (Tests section). Run them: they fail (modules missing).
2. Create `apps/web/src/sales-ops/leads/crm-types.ts` with exactly:
   ```ts
   import type { SalesOpsLead } from './types';
   export type PipelineStageType = 'normal' | 'orcamento' | 'saida';
   export type PipelineExitKind = 'ganho' | 'perdido' | 'pausado';
   export type CrmStatus = 'active' | 'archived';
   export type CrmPipelineStage = { id: string; name: string; position: number; type: PipelineStageType; behavior: string; exitKind: PipelineExitKind | null; requiresReason: boolean; status: CrmStatus };
   export type CrmPipelineTransition = { fromStageId: string; toStageId: string };
   export type CrmPipeline = { id: string; name: string; isDefault: boolean; position: number; status: CrmStatus; stages: CrmPipelineStage[]; transitions: CrmPipelineTransition[] };
   export type PipelinesResponse = { pipelines: CrmPipeline[] };
   export type FieldKind = 'text' | 'number' | 'money' | 'date' | 'options' | 'reference';
   export type FieldReferenceTarget = 'cliente' | 'contato' | 'produto' | 'servico' | 'venda';
   export type FieldOption = { key: string; label: string };
   export type FieldDefinition = { id: string; key: string; label: string; kind: FieldKind; referenceTarget: FieldReferenceTarget | null; multiple: boolean; options: FieldOption[] | null; filterable: boolean; isSystem: boolean; removable: boolean; position: number };
   export type FieldDefinitionsResponse = { fields: FieldDefinition[] };
   export type FieldReferenceItem = { id: string | null; name: string };
   /** Read shape of one dynamic value: money in integer cents, date as ISO civil day, option as option key, references as items. */
   export type LeadFieldValue = { fieldId: string; key: string; value: string | number | null | FieldReferenceItem[] };
   export type LeadTimelineKind = 'stage_changed' | 'note' | 'followup';
   export type LeadTimelineItem = { kind: LeadTimelineKind; at: string; actorName: string | null; fromStageName?: string | null; toStageName?: string | null; reason?: string | null; body?: string; nextStep?: string; dueOn?: string; doneAt?: string | null };
   export type LeadFollowup = { id: string; nextStep: string; dueOn: string; ownerName: string | null; doneAt: string | null };
   export type LeadNextStage = { id: string; name: string; type: PipelineStageType; exitKind: PipelineExitKind | null; requiresReason: boolean };
   export type LeadSummaryResponse = { lead: SalesOpsLead; pipeline: { id: string; name: string }; stage: { id: string; name: string; type: PipelineStageType; exitKind: PipelineExitKind | null }; nextStages: LeadNextStage[]; timeline: LeadTimelineItem[]; followups: LeadFollowup[] };
   export type FollowupScope = 'mine' | 'team';
   export type FollowupStatus = 'open' | 'done' | 'all';
   export type FollowupListRow = { id: string; leadId: string; leadContactName: string; nextStep: string; dueOn: string; ownerName: string | null; doneAt: string | null };
   export type FollowupsResponse = { followups: FollowupListRow[] };
   export type AdvanceLeadPayload = { leadId: string; toStageId: string; nextStep?: string; dueOn?: string; note?: string; reason?: string };
   export type AddLeadNotePayload = { leadId: string; body: string };
   export type AddLeadFollowupPayload = { leadId: string; nextStep: string; dueOn: string; ownerPersonId?: string };
   export type ListFollowupsParams = { scope: FollowupScope; status: FollowupStatus; from?: string; to?: string };
   ```
3. Edit `apps/web/src/sales-ops/leads/types.ts` (additive, all optional):
   - add near the top `import type { LeadFieldValue, PipelineExitKind, PipelineStageType } from './crm-types';`
   - in `SalesOpsLeadStage` (after `updatedAt`, line 51) add `pipelineId?: string; type?: PipelineStageType; behavior?: string; exitKind?: PipelineExitKind | null; requiresReason?: boolean;`
   - in `SalesOpsLead` (after `updatedAt`, line 119) add `pipelineId?: string; stageType?: PipelineStageType; stageExitKind?: PipelineExitKind | null; fields?: LeadFieldValue[];` with the comment "additive wire fields of the phase 2 API; optional so pre-cutover fixtures still compile".
4. Create `crm-pipeline.ts` (pure):
   ```ts
   import type { CrmPipeline, CrmPipelineStage, PipelineExitKind, PipelineStageType } from './crm-types';
   import type { LeadStageKind, SalesOpsLeadStage } from './types';
   export const OPENS_ORCAMENTOS_BEHAVIOR = 'opens_orcamentos';
   export const LEGACY_KIND_BY_TYPE: Record<PipelineStageType, LeadStageKind> = { normal: 'normal', orcamento: 'conversion', saida: 'normal' };
   export const LEGACY_KIND_BY_EXIT: Record<PipelineExitKind, LeadStageKind> = { ganho: 'normal', perdido: 'lost', pausado: 'normal' };
   export function legacyKindOf(stage: Pick<CrmPipelineStage, 'type' | 'exitKind'>): LeadStageKind {
     return stage.exitKind ? LEGACY_KIND_BY_EXIT[stage.exitKind] : LEGACY_KIND_BY_TYPE[stage.type];
   }
   /** Selected pipeline, else the default one, else the first (position order). undefined when there is none. */
   export function pickPipeline(pipelines: readonly CrmPipeline[], selectedId: string | null): CrmPipeline | undefined {
     const active = pipelines.filter((p) => p.status === 'active');
     return active.find((p) => p.id === selectedId) ?? active.find((p) => p.isDefault) ?? active[0];
   }
   /** One board stage per ACTIVE pipeline stage, in position order, with the legacy kind filled by lookup. */
   export function pipelineStagesAsBoardStages(pipeline: CrmPipeline | undefined): SalesOpsLeadStage[] {
     if (!pipeline) return [];
     return [...pipeline.stages]
       .filter((s) => s.status === 'active')
       .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'pt-BR'))
       .map((s) => ({
         id: s.id, orgId: '', name: s.name, position: s.position, kind: legacyKindOf(s),
         isSystem: s.type !== 'normal', status: s.status, archivedAt: null, createdAt: '', updatedAt: null,
         pipelineId: pipeline.id, type: s.type, behavior: s.behavior, exitKind: s.exitKind, requiresReason: s.requiresReason,
       }));
   }
   /** Allowed destinations from a stage. A stage always "allows" itself (reorder inside the column). */
   export function isTransitionAllowed(pipeline: CrmPipeline | undefined, fromStageId: string, toStageId: string): boolean {
     if (fromStageId === toStageId) return true;
     if (!pipeline) return false;
     return pipeline.transitions.some((t) => t.fromStageId === fromStageId && t.toStageId === toStageId);
   }
   export function allowedTargetIds(pipeline: CrmPipeline | undefined, fromStageId: string): Set<string> {
     const ids = new Set<string>([fromStageId]);
     for (const t of pipeline?.transitions ?? []) if (t.fromStageId === fromStageId) ids.add(t.toStageId);
     return ids;
   }
   export function stageOpensOrcamentos(stage: Pick<CrmPipelineStage, 'behavior'> | undefined): boolean {
     return stage?.behavior === OPENS_ORCAMENTOS_BEHAVIOR;
   }
   ```
   `LEGACY_KIND_BY_*` are object lookups, so the board-write-surface scan (`kind === 'normal'|'lost'`) never matches.
5. Create `crm-api.ts`:
   ```ts
   import { apiFetch } from '@/lib/api-client';
   import type { ... } from './crm-types';
   import type { LeadResponse } from './types';
   type Token = string;
   export const PIPELINES_PATH = '/api/v1/sales-ops/pipelines';
   export const FIELD_DEFINITIONS_PATH = '/api/v1/sales-ops/field-definitions';
   export const FOLLOWUPS_PATH = '/api/v1/sales-ops/followups';
   const LEADS = '/api/v1/sales-ops/leads';
   export const crmApi = {
     listPipelines: (token: Token) => apiFetch<PipelinesResponse>(PIPELINES_PATH, { method: 'GET', token }),
     listFieldDefinitions: (token: Token) => apiFetch<FieldDefinitionsResponse>(FIELD_DEFINITIONS_PATH, { method: 'GET', token }),
     getLeadSummary: (leadId: string, token: Token) => apiFetch<LeadSummaryResponse>(`${LEADS}/${leadId}/summary`, { method: 'GET', token }),
     advanceLead: ({ leadId, toStageId, nextStep, dueOn, note, reason }: AdvanceLeadPayload, token: Token) =>
       apiFetch<LeadResponse>(`${LEADS}/${leadId}/advance`, { method: 'POST', token, body: JSON.stringify({
         toStageId, ...(nextStep ? { nextStep } : {}), ...(dueOn ? { dueOn } : {}), ...(note ? { note } : {}), ...(reason ? { reason } : {}) }) }),
     addLeadNote: ({ leadId, body }: AddLeadNotePayload, token: Token) =>
       apiFetch<unknown>(`${LEADS}/${leadId}/notes`, { method: 'POST', token, body: JSON.stringify({ body }) }),
     addLeadFollowup: ({ leadId, nextStep, dueOn, ownerPersonId }: AddLeadFollowupPayload, token: Token) =>
       apiFetch<unknown>(`${LEADS}/${leadId}/followups`, { method: 'POST', token, body: JSON.stringify({ nextStep, dueOn, ...(ownerPersonId ? { ownerPersonId } : {}) }) }),
     listFollowups: (params: ListFollowupsParams, token: Token) => {
       const search = new URLSearchParams();
       search.set('scope', params.scope); search.set('status', params.status);
       if (params.from) search.set('from', params.from);
       if (params.to) search.set('to', params.to);
       return apiFetch<FollowupsResponse>(`${FOLLOWUPS_PATH}?${search.toString()}`, { method: 'GET', token });
     },
     markFollowupDone: (id: string, token: Token) => apiFetch<unknown>(`${FOLLOWUPS_PATH}/${id}/done`, { method: 'POST', token }),
   };
   ```
6. Create `crm-hooks.ts` with `usePipelines()` and `useFieldDefinitions()`, hoisted selects (`(data: PipelinesResponse) => Array.isArray(data.pipelines) ? data.pipelines : []`, same for `fields`), `useAccessToken` + `requireToken(getToken)`, keys `queryKeys.leads.pipelines()` / `queryKeys.leads.fieldDefinitions()`. Import `useQuery` from `@tanstack/react-query` (reads are allowed there; only `useMutation` is banned outside `app-mutation`). Do not import `@/lib/api-client` in this file.
7. Edit `apps/web/src/lib/query-keys.ts`: add the local `FollowupFilters` type under `LeadBoardFilters` (line 21) and the four keys inside `leads` after `deleted` (line 123). Change no existing tuple.
8. Run the new tests green, then the whole `leads/__tests__` folder.

## Tests

`crm-pipeline.test.ts` (plain node, no DOM):
- `derives the legacy kind from type and exit kind by lookup`: `{type:'orcamento',exitKind:null}` -> `conversion`; `{type:'saida',exitKind:'perdido'}` -> `lost`; `{type:'saida',exitKind:'ganho'}` -> `normal`; `{type:'saida',exitKind:'pausado'}` -> `normal`; `{type:'normal',exitKind:null}` -> `normal`.
- `pipelineStagesAsBoardStages keeps active stages in position order and fills the additive fields`: three stages (one archived, positions 3,1,2) -> two entries ordered by position, each with `pipelineId`, `type`, `exitKind`, `requiresReason`, and `kind` per the lookup; `undefined` pipeline -> `[]`.
- `pickPipeline prefers the selected, then the default, then the first active`: selected archived id falls through to default; no default falls to first active; empty -> `undefined`.
- `isTransitionAllowed treats the same stage as allowed and an absent pair as refused`.
- `allowedTargetIds always contains the stage itself plus its transition targets`.
- `stageOpensOrcamentos keys on the behavior string only`.

`crm-api-contract.test.ts` (mock `@/lib/api-client` exactly like `leads-api-contract.test.ts` lines 1-31):
- `every crm endpoint sends the bearer token it was given` (call each function with `'token-1'`, assert `calls().every(c => c[1].token === 'token-1')`).
- `uses the contract paths and verbs`: listPipelines GET `/api/v1/sales-ops/pipelines`; listFieldDefinitions GET `/field-definitions`; getLeadSummary GET `/leads/L1/summary`; advanceLead POST `/leads/L1/advance`; addLeadNote POST `/leads/L1/notes`; addLeadFollowup POST `/leads/L1/followups`; markFollowupDone POST `/followups/F1/done`.
- `advanceLead sends only the keys that carry a value and never the lead id`: `{leadId:'L1',toStageId:'S2'}` -> body `{toStageId:'S2'}`; with `nextStep`, `dueOn`, `note`, `reason` all present -> those four plus `toStageId`; empty strings are dropped.
- `addLeadFollowup omits ownerPersonId when absent`.
- `listFollowups builds the query with URLSearchParams`: `{scope:'team',status:'open',from:'2026-10-01',to:'2026-10-31'}` -> `?scope=team&status=open&from=2026-10-01&to=2026-10-31`; without from/to those keys are absent.
- `queryKeys.leads exposes the new keys under the leads root and leaves board and summary untouched`: `queryKeys.leads.pipelines()[0] === 'leads'`, `detail('L1')` equals `['leads','detail','L1']`, `queryKeys.leads.board(undefined)` equals `['leads','board',null]`, `queryKeys.leads.summary(undefined)` equals `['leads','summary',null]`.

## Affected tests search

Searched `apps/web/src` for importers of `types.ts` fixtures (`SalesOpsLead`, `SalesOpsLeadStage` literals in `leads/__tests__`, `__tests__/leads-stage-navigation.test.tsx`) and for `queryKeys.leads` consumers. The new fields are optional and the new keys are additive, so no existing assertion changes. Nothing is impacted.

## Commands

- Oracle: `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/leads/__tests__/crm-api-contract.test.ts src/sales-ops/leads/__tests__/crm-pipeline.test.ts`
- Affected suite: `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/leads src/lib`
- `pnpm --filter @fxl-sales/web lint` and `pnpm --filter @fxl-sales/web type-check`

## Risks

- The wire assumptions A1-A3 may differ from what `07b` ships; they are confined to `crm-types.ts` and `crm-api.ts`. The orchestrator reconciles at plan-check.
- A type-only import cycle `types.ts <-> crm-types.ts` is legal; keep both `import type` or the build gains a runtime cycle.
