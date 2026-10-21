---
id: 07b-api-pipeline-historico-followups
milestone: v4.8.0
status: todo
depends_on: ["07a-api-crm-cutover"]
files_modified: ["CLAUDE.md", "apps/api/src/domains/crm/__tests__/crm-seed-callers.test.ts", "apps/api/src/domains/crm/crm-read-service.ts", "apps/api/src/domains/crm/lead-input-error.ts", "apps/api/src/domains/import/executor.ts", "apps/api/src/domains/sales-ops/crm-routes.ts", "apps/api/src/domains/sales-ops/leads/lead-filters.ts", "apps/api/src/domains/sales-ops/leads/lead-history-service.ts", "apps/api/src/domains/sales-ops/leads/lead-history.ts", "apps/api/src/domains/sales-ops/leads/lead-routes.ts", "apps/api/src/domains/sales-ops/leads/lead-schemas.ts", "apps/api/src/domains/sales-ops/leads/lead-service.ts", "apps/api/src/domains/sales-ops/leads/lead-trash-service.ts", "apps/api/src/domains/sales-ops/routes.ts", "apps/api/src/middleware/__tests__/edition-gate-map.test.ts", "apps/api/test/rls/crm-cutover-frozen-tables.test.ts", "apps/api/test/rls/crm-pipeline-history.test.ts", "apps/api/test/rls/lead-path.ts", "apps/api/test/rls/leads-lixeira.test.ts", "apps/api/test/rls/leads-seller-scope.test.ts", "apps/api/test/rls/leads-stage-summary.test.ts", "apps/api/test/rls/leads-unassigned-claim.test.ts", "nexo/knowledge/reference/kanban-de-leads.md", "packages/shared-utils/src/__tests__/sao-paulo-range.test.ts", "packages/shared-utils/src/sao-paulo-day.ts"]
affected_tests: [
  {path: apps/api/src/domains/crm/__tests__/crm-seed-callers.test.ts, impact: "crm-read-service.ts (GET /pipelines, GET /field-definitions) calls ensureCrmDefaults", update: "add the path to ALLOWED_CALLERS with a comment; assertion shape unchanged", command: "pnpm --filter @fxl-sales/api exec vitest run src/domains/crm/__tests__/crm-seed-callers.test.ts", owner: builder},
  {path: apps/api/src/middleware/__tests__/edition-gate-map.test.ts, impact: "the gate map is exhaustive over every mounted route; eight new routes exist", update: "append the eight routes to OPEN (they are ungated like /leads, so the leads edition reaches their handler); no assertion changes", command: "pnpm --filter @fxl-sales/api exec vitest run src/middleware/__tests__/edition-gate-map.test.ts", owner: builder},
  {path: apps/api/test/rls/crm-cutover-frozen-tables.test.ts, impact: "a cross-stage move now needs a graph edge and writes a history event", update: "move to Qualificação (adjacent to Novo), reorder the etapas LAST (it changes which etapa is the first open one), expect 2 events, delete the audit_log rows the flow wrote; the frozen-tables assertion is unchanged", command: "pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/crm-cutover-frozen-tables.test.ts", owner: builder},
  {path: apps/api/test/rls/leads-lixeira.test.ts, impact: "the conversion move must come from Em negociação", update: "call walkToConversionDoor(db, orgId, leadId, scope) before the conversion move; assertions unchanged", command: "pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/leads-lixeira.test.ts", owner: builder},
  {path: apps/api/test/rls/leads-seller-scope.test.ts, impact: "same", update: "walkToConversionDoor before the first conversion attempt; the rejects.toMatchObject sale_required_for_conversion assertions unchanged", command: "pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/leads-seller-scope.test.ts", owner: builder},
  {path: apps/api/test/rls/leads-stage-summary.test.ts, impact: "same", update: "walkToConversionDoor before the conversion move", command: "pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/leads-stage-summary.test.ts", owner: builder},
  {path: apps/api/test/rls/leads-unassigned-claim.test.ts, impact: "same", update: "walkToConversionDoor before the conversion move", command: "pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/leads-unassigned-claim.test.ts", owner: builder}
]
acceptance: "given the cut-over API, when a lead is moved across stages, advanced, noted or given a follow-up, then a transition outside the pipeline graph answers 409, an advance writes exactly one server-side history event with the actor name from the token, a follow-up with a date is mandatory unless the destination is an exit, a reason is mandatory for perdido, lists filter by America/Sao_Paulo civil days and by dynamic fields of filterable definitions, a seller sees only own leads and an org never sees another, and the Cliente definition has no mutating route"
goal: "Server-side pipelines, transition graph, stage history, Avançar, notes, follow-ups, period filters and dynamic field filters on the unified CRM tables"
must_not_break: ["the move, delete, restore, claim and board lock contracts of slice 07a", "a reorder inside one column writes no event and never moves stage_changed_at", "no id of another org is ever readable or writable (RLS plus the explicit org filter)", "no new route can edit or archive a pipeline or a field definition", "the lead list and summary keep answering the same shape when no new query key is sent"]
rules: ["Never use the em dash; use '-'", "Apply the embedded diffs with git apply; if one does not apply cleanly STOP and report", "TDD: create crm-pipeline-history.test.ts first and watch it fail", "Run shared-utils build after editing sao-paulo-day.ts; the API resolves the package through dist", "Every writer of stage_id or position takes lockLeadBoard first; advanceLead does", "Actor names come from the token (scopeActorName), never from a body", "No audit_log entry for a stage change; the history is sales_ops_crm_lead_events", "CLAUDE.md and the kanban reference are edited by THIS slice only"]
verifier_focus: "Run the oracle and read each of its 17 cases against the acceptance; run the whole API unit and integration suites serially; grep that no route under /field-definitions or /pipelines accepts a mutating verb; mutate a throwaway copy (skip the transition check in moveLead, write the event before the move in advanceLead outside the transaction, compare created_at with UTC days) and confirm a test fails each time"
oracle: "apps/api/test/rls/crm-pipeline-history.test.ts"
---

# 07b - Pipelines, history, Avançar, follow-ups, period and field filters (API)

## Context

Depends on slice 07a: the unified tables carry every lead, `moveLead`, `insertLead`, the trash service and the import write them, and `LeadWriteSchema`, `fields`, `readLeadView`, `deleteCrmForOrgs` exist. Contract: `contracts/SEAM-CONTRACT-PHASE2.md` (section New routes) plus the web needs recorded in the web plans (W1 `fields`, W2 default vendedor, A1 follow-up list shape, A2 advance answers `{ lead }`, A3 notes, follow-up create and done may answer anything).

Anchors on the tree after 07a: `lead-service.ts` `moveLead`, `lockLeadBoard`, `claimantFor`, `resolveSellerPersonId`, `renumberStage`; `lead-trash-service.ts` `restoreLead`; `lead-routes.ts` (`failureResponse`, `leadInputErrorResponse`, `leadScope`); `lead-schemas.ts` (`ListLeadsQuerySchema`, `LeadStageSummaryQuerySchema` as `.pick` before this slice); `crm/defaults.ts` `ensureCrmDefaults`; `sales-ops/routes.ts` mounts `leadStagesRouter` and `leadsRouter`.

## Design (decisions already made)

1. Routes (all under `/api/v1/sales-ops`, all behind the access gate, org only from `c.get('orgId')`, ungated by `requireCapability` like `/leads`): `GET /pipelines`, `GET /field-definitions`, `GET /leads/:id/summary`, `POST /leads/:id/advance`, `POST /leads/:id/notes`, `POST /leads/:id/followups`, `GET /followups`, `POST /followups/:id/done`. `crm-routes.ts` holds the first, second, seventh and eighth; `lead-routes.ts` the rest. Its helpers (`leadScope`, `failureResponse`, `leadInputErrorResponse`, `validationResponse`) are exported and reused.
2. Shapes: `GET /pipelines` -> `{ pipelines: [{ id, name, isDefault, position, status, stages: [{ id, name, position, type, behavior, exitKind, requiresReason, status }], transitions: [{ fromStageId, toStageId }] }] }` (active pipelines by position, ALL their etapas including archived ones with `status`). `GET /field-definitions` -> `{ fields: [...] }` (active, with `id, key, label, kind, referenceTarget, multiple, options, filterable, isSystem, removable, position`). `GET /leads/:id/summary` -> exactly the contract (`lead` is the full lead view with `fields`; `nextStages` only the ACTIVE etapas that are edges of the graph from the current one, by position; `timeline` ascending by `at` with `stage_changed` (from/to names, reason, actor), `note` (body, actor) and `followup` (nextStep, dueOn, doneAt, actor); `followups` ordered by due day). `POST /leads/:id/advance` -> `200 { lead }`. Notes -> `201 { note }`, follow-up create -> `201 { followup }`, done -> `200 { followup }`. `GET /followups` -> `{ followups: [{ id, leadId, leadContactName, nextStep, dueOn, ownerName, doneAt }] }` ordered by `due_on`, `limit` default and max 200.
3. Transition rule: `stageTransitionAllowed` (`lead-history.ts`) reads `sales_ops_pipeline_transitions` by `(org, pipeline, from, to)`. `moveLead` checks it only when the etapa changes; a destination in another pipeline is `409` (not `400`); the import executor passes `{ skipTransitionGraph: true }` (a historical lead is placed straight into its etapa). The refusals are results, not exceptions: `{ ok: false, reason: 'transition_not_allowed' | 'sale_required_for_conversion' }`, mapped to `409 { error: reason }`.
4. History: `recordStageChange` (`lead-history.ts`) inserts one `stage_changed` event (`from`, `to`, `reason`, `actor_user_id`, `actor_name_snapshot` = `scopeActorName(scope)`). Called by `moveLead` (cross-stage only; reason stored only for a `perdido` destination), `advanceLead`, and `restoreLead` when the restore lands in another etapa. Never an `audit_log` entry.
5. `advanceLead` (in `lead-history-service.ts`): scope gate, `lockLeadBoard`, the card `FOR UPDATE` through `leadIdentityConditions`, `already_converted`, destination checks (active, same pipeline, edge of the graph) -> `409 transition_not_allowed`, an `orcamento` + `opens_orcamentos` destination -> `409 sale_required_for_conversion`, then `400 followup_required` when a non-exit destination lacks `nextStep` AND `dueOn` (or exactly one of the two is given anywhere), `400 reason_required` when the destination `requires_reason`. Writes in the same transaction: the lead (end of the destination column through `renumberStage(..., at: 100000)`, `stage_changed_at = now()`, `lost_reason` for `perdido`, the claim of a pool lead), the event, the note linked to the event (`event_id`), the follow-up (owner = the claimant or the lead's vendedor).
6. Notes and follow-ups read the lead through `leadIdentityConditions` (a colleague's lead is `404`). The follow-up owner (`ownerPersonId`) must be a pessoa of the org (`400 owner_not_found`); the default owner is the lead's vendedor. `POST /followups/:id/done` is scoped by the same seller predicate through the lead and is idempotent (the first `done_at` is kept). `GET /followups`: `mine` = created by the caller OR owned by the caller's pessoa; `team` needs `hasAdminRole` (`ADMIN_ROLE_REQUIRED_BODY`); `status` open|done|all; `from`/`to` compare `due_on` (a `date`) as written; deleted leads' follow-ups are not listed.
7. Period (`from`, `to`, inclusive civil days, `isIsoDay`, reversed range `400`): new `saoPauloDayRangeToInstants` and `addDaysToIsoDay` in `packages/shared-utils/src/sao-paulo-day.ts` -> `[from 00:00 -03:00, to+1 00:00 -03:00)` over `sales_ops_crm_leads.created_at` (`boardNarrowingConditions` in `lead-filters.ts`). Applied to `GET /leads` and `GET /leads/summary`. `GET /leads/summary` and a list WITHOUT `stageId` semantics unchanged; the summary additionally defaults to the default pipeline (`pipelineId` narrows both).
8. Dynamic filters: `f.<key>`, `f.<key>.min`, `f.<key>.max` parsed by `parseDynamicFilters` from the raw query; validated against the ACTIVE, `filterable` definitions of the org inside the tenant transaction (`LeadFilterError` -> `400 { error:'validation_error', reason:'invalid_filter', filter }`). Cliente (backing column) -> `client_id = uuid`; other references -> EXISTS on `value_client_id`/`value_product_id`/`value_sale_id`; options -> `value_option`; text -> `ILIKE %x%` with `%` and `_` escaped; number, money, date -> `=`/`>=`/`<=` on `value_number`/`value_cents`/`value_date`. A range operator on a text, options or reference field is `400`.
9. The Cliente definition: `ensureSystemFieldDefinitions` re-creates it if the row vanishes; `removable = false` is guarded by the schema CHECK; and there is NO mutating route for definitions or pipelines. The oracle probes `POST/PUT/PATCH/DELETE` on `/field-definitions`, `/field-definitions/:id`, `/pipelines`, `/pipelines/:id` (all `404`).
10. Edition compatibility with phase 3: no new code reads the edition; `leadScope(c)` stays the only reader. The new routes need no capability.
11. Contract notes (deviations, all additive): `LeadWriteBaseSchema`/`LeadPatchSchema` names; `fields` entries accept `fieldId` or `key`; the timeline is ascending; the proposta period filter has no server route (the web filters the bootstrap, same civil-day rule); `409` for a cross-pipeline move.

## Steps

1. TDD: create `apps/api/test/rls/crm-pipeline-history.test.ts` and `packages/shared-utils/src/__tests__/sao-paulo-range.test.ts` (embedded below). Run them: they fail.
2. `packages/shared-utils`: apply the `sao-paulo-day.ts` diff, then `pnpm --filter @fxl-sales/shared-utils build`, then `pnpm --filter @fxl-sales/shared-utils exec vitest run src/__tests__/sao-paulo-range.test.ts`.
3. Create the five API source files and `lead-path.ts`; apply the source diffs (one `git apply --whitespace=nowarn` per file).
4. Apply the existing-test diffs.
5. Run the commands. Then do the docs step below.
6. Docs (this slice only): apply the CLAUDE.md edits, add the CLAUDE.md section, append the kanban reference section. One sentence per line in the markdown you add.

## Tests

`crm-pipeline-history.test.ts` (17 cases, real `salesOpsRouter`, real Postgres, RLS applies; it removes its own `audit_log` rows because delete/restore write the hash chain):
- `seed the default pipeline (7 stages, 22 transitions) and the Cliente field on first read, scoped to the org`
- `the Cliente definition cannot be removed or archived through any route, and is re-created if its row vanishes`
- `an absent pair is 409 transition_not_allowed and writes nothing; an allowed pair writes exactly one event`
- `a reorder inside one column writes no event and never moves stage_changed_at`
- `a stage of another pipeline is never reachable`
- `lists only the graph-allowed next stages and the timeline of the lead`
- `advance writes exactly ONE server-side event, the note linked to it and the follow-up, in one act`
- `a follow-up with a date is mandatory unless the destination is an exit`
- `perdido requires a reason and stores it; ganho does not`
- `an invalid transition is 409, and Proposta (opens a proposta) is 409 sale_required_for_conversion`
- `a restore into another etapa writes the event too`
- `POST notes and followups answer 201 with the created row; blank input is 400`
- `GET /followups: mine vs team, status and a due-day period; team needs an admin; done is idempotent`
- `a seller reads the summary and advances only leads in scope; another org answers 404`
- `filters on created_at by Sao Paulo civil days: 02:30Z on D+1 is day D, 03:00Z is D+1`
- `filters by cliente, options and money (min/max); an unknown or non-filterable key is 400`
- `POST and PATCH answer the lead with a fields array, null clears and an omitted field stays`

`sao-paulo-range.test.ts`: the half-open interval, the 02:30Z/03:00Z boundary, open ends and an impossible day, `addDaysToIsoDay` across month and year ends.

Existing tests changed: see `affected_tests`. Searched: every test calling `moveLead` with a stage that is not adjacent in the default graph (found by running the whole integration suite on the prototype: only the four conversion cases above and the frozen-tables case moved across non-adjacent etapas; the other lead suites move Novo to Qualificação, between open etapas, or to an exit, all edges).

## Commands

Prototype result on the tree after 07a plus this slice: API unit 1,575 tests, API integration 520 tests (serial), `lint` and the three `tsc` projects clean.

- Oracle: `pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/crm-pipeline-history.test.ts`
- Shared: `pnpm --filter @fxl-sales/shared-utils exec vitest run src/__tests__/sao-paulo-range.test.ts src/__tests__/sao-paulo-day.test.ts` (after `pnpm --filter @fxl-sales/shared-utils build`)
- Affected unit: `pnpm --filter @fxl-sales/api exec vitest run src/domains/crm src/domains/sales-ops src/domains/import src/middleware`
- Affected integration (serial): `pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls src/domains/import`
- Whole: `pnpm --filter @fxl-sales/api test`, `pnpm --filter @fxl-sales/api test:integration`, `pnpm --filter @fxl-sales/api lint`, `pnpm --filter @fxl-sales/api type-check`, `pnpm --filter @fxl-sales/shared-utils test`
- Global guards: `node --test scripts/__tests__/local-database-guard.test.mjs`

## Risks

- A month boundary with a fixed `-03:00` offset is correct for 2019 and later; a period that reaches before 2019 would be off by an hour around the old DST changes. Accepted and documented in the helper.
- `team` follow-ups of a large org are capped at 200 rows per call; the web filters by period.
- The web (08, 09, 10) consumes these shapes; a rename here must be reconciled in `parts/08a-web-crm-data-layer.md`.
- The pool claim happens on `advanceLead` exactly as on `moveLead`; a reviewer should read both against `leads-unassigned-claim.test.ts`.

## Source code

#### `apps/api/src/domains/crm/crm-read-service.ts` (new file)

Create the file with exactly this content.

```ts
import { and, asc, eq } from 'drizzle-orm';
import type { getDb } from '../../db/client.js';
import { salesOpsPipelineStages, salesOpsPipelineTransitions, salesOpsPipelines } from '../../db/schema.js';
import { withTenant } from '../sales-ops/leads/with-tenant.js';
import { ensureCrmDefaults } from './defaults.js';

/**
 * The read side of the CRM configuration: `GET /pipelines` and `GET /field-definitions`.
 * Both seed the org's defaults on first read (the default pipeline and the Cliente system field),
 * so a brand-new org answers a usable configuration. There is no write side in this run: pipelines,
 * stages and definitions are not editable through the API, which is what keeps the Cliente
 * definition impossible to remove or archive.
 */
type Db = ReturnType<typeof getDb>;

export type PipelineView = {
  id: string;
  name: string;
  isDefault: boolean;
  position: number;
  status: string;
  stages: Array<{
    id: string;
    name: string;
    position: number;
    type: string;
    behavior: string;
    exitKind: string | null;
    requiresReason: boolean;
    status: string;
  }>;
  transitions: Array<{ fromStageId: string; toStageId: string }>;
};

export function listPipelines(db: Db, orgId: string): Promise<PipelineView[]> {
  return withTenant(db, orgId, async (tx) => {
    await ensureCrmDefaults(tx, orgId);
    const pipelines = await tx
      .select()
      .from(salesOpsPipelines)
      .where(and(eq(salesOpsPipelines.orgId, orgId), eq(salesOpsPipelines.status, 'active')))
      .orderBy(asc(salesOpsPipelines.position), asc(salesOpsPipelines.name));
    const stages = await tx
      .select()
      .from(salesOpsPipelineStages)
      .where(eq(salesOpsPipelineStages.orgId, orgId))
      .orderBy(asc(salesOpsPipelineStages.position), asc(salesOpsPipelineStages.name));
    const transitions = await tx
      .select()
      .from(salesOpsPipelineTransitions)
      .where(eq(salesOpsPipelineTransitions.orgId, orgId));
    return pipelines.map((pipeline) => ({
      id: pipeline.id,
      name: pipeline.name,
      isDefault: pipeline.isDefault,
      position: pipeline.position,
      status: pipeline.status,
      stages: stages
        .filter((stage) => stage.pipelineId === pipeline.id)
        .map((stage) => ({
          id: stage.id,
          name: stage.name,
          position: stage.position,
          type: stage.type,
          behavior: stage.behavior,
          exitKind: stage.exitKind,
          requiresReason: stage.requiresReason,
          status: stage.status,
        })),
      transitions: transitions
        .filter((transition) => transition.pipelineId === pipeline.id)
        .map((transition) => ({ fromStageId: transition.fromStageId, toStageId: transition.toStageId })),
    }));
  });
}

export type FieldDefinitionView = {
  id: string;
  key: string;
  label: string;
  kind: string;
  referenceTarget: string | null;
  multiple: boolean;
  options: unknown;
  filterable: boolean;
  isSystem: boolean;
  removable: boolean;
  position: number;
};

export function listFieldDefinitions(db: Db, orgId: string): Promise<FieldDefinitionView[]> {
  return withTenant(db, orgId, async (tx) => {
    const { fields } = await ensureCrmDefaults(tx, orgId);
    return fields
      .filter((field) => field.status === 'active')
      .map((field) => ({
        id: field.id,
        key: field.key,
        label: field.label,
        kind: field.kind,
        referenceTarget: field.referenceTarget,
        multiple: field.multiple,
        options: field.options,
        filterable: field.filterable,
        isSystem: field.isSystem,
        removable: field.removable,
        position: field.position,
      }));
  });
}
```

#### `apps/api/src/domains/sales-ops/crm-routes.ts` (new file)

Create the file with exactly this content.

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../../db/client.js';
import { ADMIN_ROLE_REQUIRED_BODY, hasAdminRole } from '../../middleware/require-admin.js';
import { listFieldDefinitions, listPipelines } from '../crm/crm-read-service.js';
import { listFollowups, markFollowupDone } from './leads/lead-history-service.js';
import { ListFollowupsQuerySchema } from './leads/lead-schemas.js';
import { failureResponse, leadScope, validationResponse } from './leads/lead-routes.js';

/**
 * The CRM configuration reads and the follow-up list, mounted at '/' into salesOpsRouter.
 *
 * Read-only on purpose. There is no POST, PATCH or DELETE for pipelines or field definitions in
 * this run (onboarding is out of scope), so the Cliente system field can never be removed or
 * archived through any route. Every read takes the org from `c.get('orgId')` only.
 */
export const crmRouter = new Hono();

crmRouter.get('/pipelines', async (c) => {
  const pipelines = await listPipelines(getDb(), c.get('orgId'));
  return c.json({ pipelines });
});

crmRouter.get('/field-definitions', async (c) => {
  const fields = await listFieldDefinitions(getDb(), c.get('orgId'));
  return c.json({ fields });
});

/** `team` needs an admin and answers the shared 403 body; `mine` is the caller's own. */
crmRouter.get('/followups', async (c) => {
  const parsed = ListFollowupsQuerySchema.safeParse({
    scope: c.req.query('scope'),
    status: c.req.query('status'),
    from: c.req.query('from'),
    to: c.req.query('to'),
    limit: c.req.query('limit'),
  });
  if (!parsed.success) return validationResponse(c, parsed.error);
  if (parsed.data.scope === 'team' && !hasAdminRole(c)) return c.json(ADMIN_ROLE_REQUIRED_BODY, 403);
  const result = await listFollowups(getDb(), c.get('orgId'), parsed.data, leadScope(c));
  if (!result.ok) return failureResponse(c, result.reason);
  return c.json({ followups: result.followups });
});

crmRouter.post('/followups/:id/done', async (c) => {
  const id = z.string().uuid().safeParse(c.req.param('id'));
  if (!id.success) return c.json({ error: 'not_found' }, 404);
  const result = await markFollowupDone(getDb(), c.get('orgId'), id.data, leadScope(c));
  if (!result.ok) return failureResponse(c, result.reason);
  return c.json({ followup: result.followup });
});
```

#### `apps/api/src/domains/sales-ops/leads/lead-filters.ts` (new file)

Create the file with exactly this content.

```ts
import { isIsoDay, saoPauloDayRangeToInstants } from '@fxl-sales/shared-utils/sao-paulo-day';
import { eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import type { getDb } from '../../../db/client.js';
import { salesOpsCrmLeadFieldValues, salesOpsCrmLeads } from '../../../db/schema.js';
import { loadFieldDefinitions, type FieldDefinitionRow } from '../../crm/lead-fields.js';
import { defaultPipelineId } from '../../crm/pipeline-read.js';
import type { DynamicFilterInput } from './lead-schemas.js';

/**
 * The board read narrowing added by phase 2: pipeline, period (America/Sao_Paulo civil days over
 * `created_at`) and dynamic filters on FILTERABLE field definitions. One builder serves
 * `listLeads` and `summarizeLeadStages`, so a column's total and the summary's count always cover
 * the same set.
 */
type Db = ReturnType<typeof getDb>;

/** A filter key that is unknown, not filterable, or whose value does not fit its kind. The route answers 400. */
export class LeadFilterError extends Error {
  constructor(readonly filter: string) {
    super(`invalid_filter:${filter}`);
    this.name = 'LeadFilterError';
  }
}

const FILTER_KEY = /^f\.([a-z0-9_-]{1,60})(?:\.(min|max))?$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads every `f.<key>` / `f.<key>.min` / `f.<key>.max` entry of a query string. Any other `f.` shape is a 400. */
export function parseDynamicFilters(query: Record<string, string>): DynamicFilterInput[] {
  const filters: DynamicFilterInput[] = [];
  for (const [name, raw] of Object.entries(query)) {
    if (!name.startsWith('f.')) continue;
    const match = FILTER_KEY.exec(name);
    if (!match) throw new LeadFilterError(name);
    filters.push({ key: match[1]!, op: (match[2]?.toLowerCase() as 'min' | 'max' | undefined) ?? 'eq', raw });
  }
  return filters;
}

function valueExists(def: FieldDefinitionRow, predicate: SQL): SQL {
  return sql`EXISTS (
    SELECT 1 FROM ${salesOpsCrmLeadFieldValues} v
    WHERE v.org_id = ${salesOpsCrmLeads.orgId} AND v.lead_id = ${salesOpsCrmLeads.id}
      AND v.field_id = ${def.id} AND ${predicate})`;
}

function escapeLike(raw: string): string {
  return raw.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function condition(def: FieldDefinitionRow, filter: DynamicFilterInput): SQL {
  const bad = () => new LeadFilterError(`f.${filter.key}`);
  const range = filter.op !== 'eq';
  const raw = filter.raw.trim();
  if (raw === '') throw bad();
  if (def.backingColumn === 'client_id') {
    if (range || !UUID.test(raw)) throw bad();
    return eq(salesOpsCrmLeads.clientId, raw);
  }
  switch (def.kind) {
    case 'text':
      if (range) throw bad();
      return valueExists(def, sql`v.value_text ILIKE ${`%${escapeLike(raw)}%`} ESCAPE '\\'`);
    case 'options':
      if (range) throw bad();
      return valueExists(def, sql`v.value_option = ${raw}`);
    case 'number':
    case 'money': {
      const n = Number(raw);
      if (!Number.isFinite(n) || (def.kind === 'money' && !Number.isSafeInteger(n))) throw bad();
      const column = def.kind === 'number' ? sql`v.value_number` : sql`v.value_cents`;
      if (filter.op === 'min') return valueExists(def, sql`${column} >= ${n}`);
      if (filter.op === 'max') return valueExists(def, sql`${column} <= ${n}`);
      return valueExists(def, sql`${column} = ${n}`);
    }
    case 'date': {
      if (!isIsoDay(raw)) throw bad();
      if (filter.op === 'min') return valueExists(def, sql`v.value_date >= ${raw}::date`);
      if (filter.op === 'max') return valueExists(def, sql`v.value_date <= ${raw}::date`);
      return valueExists(def, sql`v.value_date = ${raw}::date`);
    }
    case 'reference': {
      if (range || !UUID.test(raw)) throw bad();
      switch (def.referenceTarget) {
        case 'cliente':
          return valueExists(def, sql`v.value_client_id = ${raw}::uuid`);
        case 'produto':
        case 'servico':
          return valueExists(def, sql`v.value_product_id = ${raw}::uuid`);
        case 'venda':
          return valueExists(def, sql`v.value_sale_id = ${raw}::uuid`);
        default:
          throw bad();
      }
    }
    default:
      throw bad();
  }
}

export type BoardNarrowing = {
  pipelineId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  filters?: DynamicFilterInput[] | undefined;
};

/**
 * The extra WHERE conjuncts of a board read. `defaultToDefaultPipeline` is true for the summary,
 * which has no stageId: it then covers the org's default pipeline unless one is named.
 */
export async function boardNarrowingConditions(
  tx: Db,
  orgId: string,
  narrowing: BoardNarrowing,
  options: { defaultToDefaultPipeline: boolean },
): Promise<SQL[]> {
  const conditions: SQL[] = [];
  const pipelineId =
    narrowing.pipelineId ?? (options.defaultToDefaultPipeline ? await defaultPipelineId(tx, orgId) : null);
  if (pipelineId) conditions.push(eq(salesOpsCrmLeads.pipelineId, pipelineId));

  const { start, endExclusive } = saoPauloDayRangeToInstants(narrowing.from, narrowing.to);
  if (start) conditions.push(gte(salesOpsCrmLeads.createdAt, start));
  if (endExclusive) conditions.push(lt(salesOpsCrmLeads.createdAt, endExclusive));

  if (narrowing.filters && narrowing.filters.length > 0) {
    const definitions = (await loadFieldDefinitions(tx, orgId)).filter((def) => def.status === 'active');
    for (const filter of narrowing.filters) {
      const def = definitions.find((candidate) => candidate.key === filter.key);
      if (!def || !def.filterable) throw new LeadFilterError(`f.${filter.key}`);
      conditions.push(condition(def, filter));
    }
  }
  return conditions;
}
```

#### `apps/api/src/domains/sales-ops/leads/lead-history.ts` (new file)

Create the file with exactly this content.

```ts
import { and, eq } from 'drizzle-orm';
import type { getDb } from '../../../db/client.js';
import { salesOpsCrmLeadEvents, salesOpsPipelineTransitions } from '../../../db/schema.js';

/**
 * The two primitives every stage change shares (`moveLead`, `advanceLead`, a restore that lands in
 * another etapa): the transition rule and the history event. Kept free of the lead service so the
 * service can import them without a cycle.
 */
type Db = ReturnType<typeof getDb>;

/** Is `from -> to` an edge of the pipeline graph? A pair that is absent is not allowed. */
export async function stageTransitionAllowed(
  tx: Db,
  orgId: string,
  pipelineId: string,
  fromStageId: string,
  toStageId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: salesOpsPipelineTransitions.id })
    .from(salesOpsPipelineTransitions)
    .where(
      and(
        eq(salesOpsPipelineTransitions.orgId, orgId),
        eq(salesOpsPipelineTransitions.pipelineId, pipelineId),
        eq(salesOpsPipelineTransitions.fromStageId, fromStageId),
        eq(salesOpsPipelineTransitions.toStageId, toStageId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export type StageChange = {
  orgId: string;
  leadId: string;
  fromStageId: string;
  toStageId: string;
  reason: string | null;
  actorUserId: string;
  actorName: string | null;
};

/** One `stage_changed` event, actor name snapshotted from the verified token. Returns the event id. */
export async function recordStageChange(tx: Db, change: StageChange): Promise<string> {
  const [event] = await tx
    .insert(salesOpsCrmLeadEvents)
    .values({
      orgId: change.orgId,
      leadId: change.leadId,
      kind: 'stage_changed',
      fromStageId: change.fromStageId,
      toStageId: change.toStageId,
      reason: change.reason,
      actorUserId: change.actorUserId,
      actorNameSnapshot: change.actorName,
    })
    .returning({ id: salesOpsCrmLeadEvents.id });
  return event!.id;
}
```

#### `apps/api/src/domains/sales-ops/leads/lead-history-service.ts` (new file)

Create the file with exactly this content.

```ts
import { and, asc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { getDb } from '../../../db/client.js';
import {
  salesOpsCrmLeadEvents,
  salesOpsCrmLeadFollowups,
  salesOpsCrmLeadNotes,
  salesOpsCrmLeads,
  salesOpsPeople,
  salesOpsPipelineStages,
  salesOpsPipelineTransitions,
  salesOpsPipelines,
} from '../../../db/schema.js';
import { LeadInputError } from '../../crm/lead-input-error.js';
import type {
  AdvanceLeadInput,
  LeadFollowupInput,
  LeadNoteInput,
  ListFollowupsQuery,
} from './lead-schemas.js';
import { recordStageChange, stageTransitionAllowed } from './lead-history.js';
import {
  claimantFor,
  leadIdentityConditions,
  leadSellerCondition,
  liveLeadCondition,
  lockLeadBoard,
  readLeadView,
  renumberStage,
  resolveCallerPersonId,
  resolveLeadScopePredicate,
  resolveSellerPersonId,
  scopeActorName,
  type LeadScope,
  type LeadView,
  type WriteLeadResult,
} from './lead-service.js';
import { withTenant } from './with-tenant.js';

/**
 * Lead history, follow-ups and the Avançar act (phase 2b). Every function opens the caller's tenant
 * transaction, passes the one seller-scope gate and reads leads only through `leadIdentityConditions`
 * (org + live + seller rule), so an out-of-scope lead is `not_found` here exactly as it is on the
 * board. Actor names are snapshotted from the verified token (`scopeActorName`), never from a body.
 */
type Db = ReturnType<typeof getDb>;

/** Position far past any column length: `renumberStage` clamps it, so the card lands at the END. */
const APPEND = 100_000;

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

export type TimelineItem = {
  kind: 'stage_changed' | 'note' | 'followup';
  at: string;
  actorName: string | null;
  fromStageName?: string | null;
  toStageName?: string | null;
  reason?: string | null;
  body?: string;
  nextStep?: string;
  dueOn?: string;
  doneAt?: string | null;
};

export type FollowupView = { id: string; nextStep: string; dueOn: string; ownerName: string | null; doneAt: string | null };

export type LeadSummary = {
  lead: LeadView;
  pipeline: { id: string; name: string };
  stage: { id: string; name: string; type: string; exitKind: string | null };
  nextStages: Array<{ id: string; name: string; type: string; exitKind: string | null; requiresReason: boolean }>;
  timeline: TimelineItem[];
  followups: FollowupView[];
};

export type LeadSummaryResult =
  | { ok: true; summary: LeadSummary }
  | { ok: false; reason: 'not_found' | 'seller_person_unmapped' };

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

export function getLeadSummary(db: Db, orgId: string, id: string, scope: LeadScope): Promise<LeadSummaryResult> {
  return withTenant(db, orgId, async (tx) => {
    const gate = await resolveLeadScopePredicate(tx, orgId, scope);
    if (!gate.ok) return { ok: false, reason: gate.reason } as const;
    const [row] = await tx
      .select({ id: salesOpsCrmLeads.id, pipelineId: salesOpsCrmLeads.pipelineId, stageId: salesOpsCrmLeads.stageId })
      .from(salesOpsCrmLeads)
      .where(and(...leadIdentityConditions(orgId, id, gate)))
      .limit(1);
    if (!row) return { ok: false, reason: 'not_found' } as const;

    const lead = await readLeadView(tx, orgId, id);
    const [pipeline] = await tx
      .select({ id: salesOpsPipelines.id, name: salesOpsPipelines.name })
      .from(salesOpsPipelines)
      .where(and(eq(salesOpsPipelines.orgId, orgId), eq(salesOpsPipelines.id, row.pipelineId)))
      .limit(1);
    const stages = await tx
      .select()
      .from(salesOpsPipelineStages)
      .where(and(eq(salesOpsPipelineStages.orgId, orgId), eq(salesOpsPipelineStages.pipelineId, row.pipelineId)))
      .orderBy(asc(salesOpsPipelineStages.position), asc(salesOpsPipelineStages.name));
    const current = stages.find((stage) => stage.id === row.stageId)!;
    const nameOf = new Map(stages.map((stage) => [stage.id, stage.name]));

    // Only the stages the explicit graph allows from the current one, and only active ones.
    const edges = await tx
      .select({ toStageId: salesOpsPipelineTransitions.toStageId })
      .from(salesOpsPipelineTransitions)
      .where(
        and(
          eq(salesOpsPipelineTransitions.orgId, orgId),
          eq(salesOpsPipelineTransitions.pipelineId, row.pipelineId),
          eq(salesOpsPipelineTransitions.fromStageId, row.stageId),
        ),
      );
    const reachable = new Set(edges.map((edge) => edge.toStageId));
    const nextStages = stages
      .filter((stage) => reachable.has(stage.id) && stage.status === 'active')
      .map((stage) => ({ id: stage.id, name: stage.name, type: stage.type, exitKind: stage.exitKind, requiresReason: stage.requiresReason }));

    const events = await tx
      .select()
      .from(salesOpsCrmLeadEvents)
      .where(and(eq(salesOpsCrmLeadEvents.orgId, orgId), eq(salesOpsCrmLeadEvents.leadId, id)));
    const notes = await tx
      .select()
      .from(salesOpsCrmLeadNotes)
      .where(and(eq(salesOpsCrmLeadNotes.orgId, orgId), eq(salesOpsCrmLeadNotes.leadId, id)));
    const followupRows = await tx
      .select()
      .from(salesOpsCrmLeadFollowups)
      .where(and(eq(salesOpsCrmLeadFollowups.orgId, orgId), eq(salesOpsCrmLeadFollowups.leadId, id)))
      .orderBy(asc(salesOpsCrmLeadFollowups.dueOn), asc(salesOpsCrmLeadFollowups.id));

    const timeline: TimelineItem[] = [
      ...events.map((event) => ({
        kind: 'stage_changed' as const,
        at: event.occurredAt.toISOString(),
        actorName: event.actorNameSnapshot,
        fromStageName: event.fromStageId ? (nameOf.get(event.fromStageId) ?? null) : null,
        toStageName: event.toStageId ? (nameOf.get(event.toStageId) ?? null) : null,
        reason: event.reason,
      })),
      ...notes.map((note) => ({
        kind: 'note' as const,
        at: note.createdAt.toISOString(),
        actorName: note.authorNameSnapshot,
        body: note.body,
      })),
      ...followupRows.map((followup) => ({
        kind: 'followup' as const,
        at: followup.createdAt.toISOString(),
        actorName: followup.createdByName,
        nextStep: followup.nextStep,
        dueOn: followup.dueOn,
        doneAt: iso(followup.doneAt),
      })),
    ].sort((a, b) => a.at.localeCompare(b.at));

    return {
      ok: true,
      summary: {
        lead,
        pipeline: pipeline!,
        stage: { id: current.id, name: current.name, type: current.type, exitKind: current.exitKind },
        nextStages,
        timeline,
        followups: followupRows.map((followup) => ({
          id: followup.id,
          nextStep: followup.nextStep,
          dueOn: followup.dueOn,
          ownerName: followup.ownerNameSnapshot,
          doneAt: iso(followup.doneAt),
        })),
      },
    } as const;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Avançar
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Moves a lead along an edge of its pipeline graph and records why, in ONE transaction:
 *  - the move (end of the destination column, `stage_changed_at = now()`, the claim of a pool lead),
 *  - exactly one `stage_changed` event (actor name from the token),
 *  - the note (linked to that event) and the follow-up, when given.
 * Same lock order as `moveLead`: scope gate, board lock, then the card row.
 *
 * Refusals: `409 transition_not_allowed` (pair absent, or a stage of another pipeline);
 * `409 sale_required_for_conversion` (the destination opens a proposta, owned by the wizard);
 * `400 followup_required` (a non-exit destination without próximo passo AND data, or only one of the two);
 * `400 reason_required` (the destination requires a reason).
 */
export function advanceLead(
  db: Db,
  orgId: string,
  id: string,
  input: AdvanceLeadInput,
  scope: LeadScope,
): Promise<WriteLeadResult> {
  return withTenant(db, orgId, async (tx) => {
    const gate = await resolveLeadScopePredicate(tx, orgId, scope);
    if (!gate.ok) return { ok: false, reason: gate.reason } as const;
    await lockLeadBoard(tx, orgId);

    const [current] = await tx
      .select()
      .from(salesOpsCrmLeads)
      .where(and(...leadIdentityConditions(orgId, id, gate)))
      .limit(1)
      .for('update');
    if (!current) return { ok: false, reason: 'not_found' } as const;
    if (current.saleId !== null) return { ok: false, reason: 'already_converted' } as const;

    const [destination] = await tx
      .select()
      .from(salesOpsPipelineStages)
      .where(
        and(
          eq(salesOpsPipelineStages.orgId, orgId),
          eq(salesOpsPipelineStages.id, input.toStageId),
          eq(salesOpsPipelineStages.status, 'active'),
        ),
      )
      .limit(1);
    if (
      !destination ||
      destination.pipelineId !== current.pipelineId ||
      destination.id === current.stageId ||
      !(await stageTransitionAllowed(tx, orgId, current.pipelineId, current.stageId, destination.id))
    ) {
      return { ok: false, reason: 'transition_not_allowed' } as const;
    }
    if (destination.type === 'orcamento' && destination.behavior === 'opens_orcamentos') {
      return { ok: false, reason: 'sale_required_for_conversion' } as const;
    }

    const isExit = destination.type === 'saida';
    const hasStep = input.nextStep !== undefined;
    const hasDay = input.dueOn !== undefined;
    if ((!isExit && !(hasStep && hasDay)) || hasStep !== hasDay) throw new LeadInputError('followup_required');
    if (destination.requiresReason && input.reason === undefined) throw new LeadInputError('reason_required');

    const claimant = claimantFor(gate, current);
    const claimed = claimant !== null ? await resolveSellerPersonId(tx, orgId, claimant) : null;

    await tx
      .update(salesOpsCrmLeads)
      .set({
        stageId: destination.id,
        stageChangedAt: new Date(),
        lostReason: destination.exitKind === 'perdido' ? (input.reason ?? null) : null,
        ...(claimed ? { sellerPersonId: claimed.id, sellerNameSnapshot: claimed.displayName } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(salesOpsCrmLeads.orgId, orgId), eq(salesOpsCrmLeads.id, id), liveLeadCondition()));
    await renumberStage(tx, orgId, destination.id, { moved: id, at: APPEND });
    await renumberStage(tx, orgId, current.stageId, null);

    const actorName = scopeActorName(scope);
    const eventId = await recordStageChange(tx, {
      orgId,
      leadId: id,
      fromStageId: current.stageId,
      toStageId: destination.id,
      reason: input.reason ?? null,
      actorUserId: scope.userId,
      actorName,
    });
    if (input.note !== undefined) {
      await tx.insert(salesOpsCrmLeadNotes).values({
        orgId,
        leadId: id,
        eventId,
        body: input.note,
        authorUserId: scope.userId,
        authorNameSnapshot: actorName,
      });
    }
    if (hasStep && hasDay) {
      await tx.insert(salesOpsCrmLeadFollowups).values({
        orgId,
        leadId: id,
        nextStep: input.nextStep!,
        dueOn: input.dueOn!,
        ownerPersonId: claimed?.id ?? current.sellerPersonId,
        ownerNameSnapshot: claimed?.displayName ?? (current.sellerNameSnapshot || null),
        createdByUserId: scope.userId,
        createdByName: actorName,
      });
    }
    return { ok: true, lead: await readLeadView(tx, orgId, id) } as const;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Notes and follow-ups
// ─────────────────────────────────────────────────────────────────────────────

export type LeadNoteView = { id: string; body: string; authorName: string | null; createdAt: string };

export type AddNoteResult =
  | { ok: true; note: LeadNoteView }
  | { ok: false; reason: 'not_found' | 'seller_person_unmapped' };

async function inScopeLead(tx: Db, orgId: string, id: string, scope: LeadScope) {
  const gate = await resolveLeadScopePredicate(tx, orgId, scope);
  if (!gate.ok) return { gate, lead: null } as const;
  const [lead] = await tx
    .select({ id: salesOpsCrmLeads.id, sellerPersonId: salesOpsCrmLeads.sellerPersonId, sellerNameSnapshot: salesOpsCrmLeads.sellerNameSnapshot })
    .from(salesOpsCrmLeads)
    .where(and(...leadIdentityConditions(orgId, id, gate)))
    .limit(1);
  return { gate, lead: lead ?? null } as const;
}

export function addLeadNote(db: Db, orgId: string, id: string, input: LeadNoteInput, scope: LeadScope): Promise<AddNoteResult> {
  return withTenant(db, orgId, async (tx) => {
    const { gate, lead } = await inScopeLead(tx, orgId, id, scope);
    if (!gate.ok) return { ok: false, reason: gate.reason } as const;
    if (!lead) return { ok: false, reason: 'not_found' } as const;
    const [note] = await tx
      .insert(salesOpsCrmLeadNotes)
      .values({ orgId, leadId: id, eventId: null, body: input.body, authorUserId: scope.userId, authorNameSnapshot: scopeActorName(scope) })
      .returning();
    return {
      ok: true,
      note: { id: note!.id, body: note!.body, authorName: note!.authorNameSnapshot, createdAt: note!.createdAt.toISOString() },
    } as const;
  });
}

export type AddFollowupResult =
  | { ok: true; followup: FollowupView }
  | { ok: false; reason: 'not_found' | 'seller_person_unmapped' };

const toFollowupView = (row: typeof salesOpsCrmLeadFollowups.$inferSelect): FollowupView => ({
  id: row.id,
  nextStep: row.nextStep,
  dueOn: row.dueOn,
  ownerName: row.ownerNameSnapshot,
  doneAt: iso(row.doneAt),
});

export function addLeadFollowup(db: Db, orgId: string, id: string, input: LeadFollowupInput, scope: LeadScope): Promise<AddFollowupResult> {
  return withTenant(db, orgId, async (tx) => {
    const { gate, lead } = await inScopeLead(tx, orgId, id, scope);
    if (!gate.ok) return { ok: false, reason: gate.reason } as const;
    if (!lead) return { ok: false, reason: 'not_found' } as const;
    let ownerId = lead.sellerPersonId;
    let ownerName: string | null = lead.sellerNameSnapshot || null;
    if (input.ownerPersonId) {
      const [owner] = await tx
        .select({ id: salesOpsPeople.id, displayName: salesOpsPeople.displayName })
        .from(salesOpsPeople)
        .where(and(eq(salesOpsPeople.orgId, orgId), eq(salesOpsPeople.id, input.ownerPersonId)))
        .limit(1);
      if (!owner) throw new LeadInputError('owner_not_found');
      ownerId = owner.id;
      ownerName = owner.displayName;
    }
    const [row] = await tx
      .insert(salesOpsCrmLeadFollowups)
      .values({
        orgId,
        leadId: id,
        nextStep: input.nextStep,
        dueOn: input.dueOn,
        ownerPersonId: ownerId,
        ownerNameSnapshot: ownerName,
        createdByUserId: scope.userId,
        createdByName: scopeActorName(scope),
      })
      .returning();
    return { ok: true, followup: toFollowupView(row!) } as const;
  });
}

export type DoneResult =
  | { ok: true; followup: FollowupView }
  | { ok: false; reason: 'not_found' | 'seller_person_unmapped' };

/** Idempotent: marking an already-done follow-up keeps its original `done_at`. */
export function markFollowupDone(db: Db, orgId: string, followupId: string, scope: LeadScope): Promise<DoneResult> {
  return withTenant(db, orgId, async (tx) => {
    const gate = await resolveLeadScopePredicate(tx, orgId, scope);
    if (!gate.ok) return { ok: false, reason: gate.reason } as const;
    const [row] = await tx
      .select({ followup: salesOpsCrmLeadFollowups })
      .from(salesOpsCrmLeadFollowups)
      .innerJoin(
        salesOpsCrmLeads,
        and(eq(salesOpsCrmLeads.orgId, salesOpsCrmLeadFollowups.orgId), eq(salesOpsCrmLeads.id, salesOpsCrmLeadFollowups.leadId)),
      )
      .where(
        and(
          eq(salesOpsCrmLeadFollowups.orgId, orgId),
          eq(salesOpsCrmLeadFollowups.id, followupId),
          liveLeadCondition(),
          ...(gate.sellerPersonId ? [leadSellerCondition(gate.sellerPersonId, gate.canClaimUnassigned)] : []),
        ),
      )
      .limit(1)
      .for('update', { of: salesOpsCrmLeadFollowups });
    if (!row) return { ok: false, reason: 'not_found' } as const;
    if (row.followup.doneAt !== null) return { ok: true, followup: toFollowupView(row.followup) } as const;
    const [done] = await tx
      .update(salesOpsCrmLeadFollowups)
      .set({ doneAt: new Date(), updatedAt: new Date() })
      .where(and(eq(salesOpsCrmLeadFollowups.orgId, orgId), eq(salesOpsCrmLeadFollowups.id, followupId)))
      .returning();
    return { ok: true, followup: toFollowupView(done!) } as const;
  });
}

export type FollowupListRow = {
  id: string;
  leadId: string;
  leadContactName: string;
  nextStep: string;
  dueOn: string;
  ownerName: string | null;
  doneAt: string | null;
};

export type ListFollowupsResult =
  | { ok: true; followups: FollowupListRow[] }
  | { ok: false; reason: 'seller_person_unmapped' };

/**
 * `mine`: the caller's pessoa owns it, or the caller created it. `team`: every follow-up of the org
 * (the route admits only an admin). The period is on `due_on`, a civil `date`, so the days are
 * compared as written and no timezone is involved. Deleted leads' follow-ups are not listed.
 */
export function listFollowups(db: Db, orgId: string, query: ListFollowupsQuery, scope: LeadScope): Promise<ListFollowupsResult> {
  return withTenant(db, orgId, async (tx) => {
    const conditions: SQL[] = [eq(salesOpsCrmLeadFollowups.orgId, orgId), liveLeadCondition()];
    if (query.scope === 'mine') {
      const personId = await resolveCallerPersonId(tx, orgId, scope);
      const mine: SQL[] = [eq(salesOpsCrmLeadFollowups.createdByUserId, scope.userId)];
      if (personId) mine.push(eq(salesOpsCrmLeadFollowups.ownerPersonId, personId));
      conditions.push(mine.length === 1 ? mine[0]! : sql`(${mine[0]} OR ${mine[1]})`);
    }
    if (query.status === 'open') conditions.push(isNull(salesOpsCrmLeadFollowups.doneAt));
    if (query.status === 'done') conditions.push(sql`${salesOpsCrmLeadFollowups.doneAt} IS NOT NULL`);
    if (query.from) conditions.push(sql`${salesOpsCrmLeadFollowups.dueOn} >= ${query.from}::date`);
    if (query.to) conditions.push(sql`${salesOpsCrmLeadFollowups.dueOn} <= ${query.to}::date`);
    const rows = await tx
      .select({ followup: salesOpsCrmLeadFollowups, contactName: salesOpsCrmLeads.contactName })
      .from(salesOpsCrmLeadFollowups)
      .innerJoin(
        salesOpsCrmLeads,
        and(eq(salesOpsCrmLeads.orgId, salesOpsCrmLeadFollowups.orgId), eq(salesOpsCrmLeads.id, salesOpsCrmLeadFollowups.leadId)),
      )
      .where(and(...conditions))
      .orderBy(asc(salesOpsCrmLeadFollowups.dueOn), asc(salesOpsCrmLeadFollowups.id))
      .limit(query.limit);
    return {
      ok: true,
      followups: rows.map(({ followup, contactName }) => ({
        id: followup.id,
        leadId: followup.leadId,
        leadContactName: contactName,
        nextStep: followup.nextStep,
        dueOn: followup.dueOn,
        ownerName: followup.ownerNameSnapshot,
        doneAt: iso(followup.doneAt),
      })),
    } as const;
  });
}
```

#### `packages/shared-utils/src/sao-paulo-day.ts` (edit, 33 changed lines)

```diff
diff --git a/packages/shared-utils/src/sao-paulo-day.ts b/packages/shared-utils/src/sao-paulo-day.ts
index d8ddcad..a00584a 100644
--- a/packages/shared-utils/src/sao-paulo-day.ts
+++ b/packages/shared-utils/src/sao-paulo-day.ts
@@ -51,3 +51,36 @@ export function isAfterTodayInSaoPaulo(day: string, now: Date = new Date()): boo
   if (!isIsoDay(day)) throw new RangeError('invalid_iso_day');
   return day > todayInSaoPaulo(now);
 }
+
+/** Brazil has no daylight saving time since 2019, so a Sao Paulo midnight is 03:00Z. */
+const SAO_PAULO_OFFSET_HOURS = 3;
+
+/** The civil day after `day` (`YYYY-MM-DD`), by calendar arithmetic and never through the local timezone. */
+export function addDaysToIsoDay(day: string, days: number): string {
+  if (!isIsoDay(day)) throw new RangeError('invalid_iso_day');
+  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
+  const moved = new Date(Date.UTC(year, month - 1, date + days));
+  return moved.toISOString().slice(0, 10);
+}
+
+/**
+ * A civil-day range in America/Sao_Paulo (both ends inclusive, both optional) as the half-open
+ * instant interval `[start, endExclusive)`: `from` 00:00 -03:00 up to the day AFTER `to` 00:00 -03:00.
+ * A lead created at 02:30Z on day D+1 is 23:30 on day D in Sao Paulo and belongs to day D.
+ * Used for every period filter on a timestamp column; a `date` column compares the civil days directly.
+ */
+export function saoPauloDayRangeToInstants(
+  from?: string | null,
+  to?: string | null,
+): { start: Date | null; endExclusive: Date | null } {
+  const midnight = (day: string) => {
+    const [year, month, date] = day.split('-').map(Number) as [number, number, number];
+    return new Date(Date.UTC(year, month - 1, date, SAO_PAULO_OFFSET_HOURS));
+  };
+  if (from != null && !isIsoDay(from)) throw new RangeError('invalid_iso_day');
+  if (to != null && !isIsoDay(to)) throw new RangeError('invalid_iso_day');
+  return {
+    start: from == null ? null : midnight(from),
+    endExclusive: to == null ? null : midnight(addDaysToIsoDay(to, 1)),
+  };
+}
```

#### `apps/api/src/domains/crm/lead-input-error.ts` (edit, 6 changed lines)

```diff
diff --git a/apps/api/src/domains/crm/lead-input-error.ts b/apps/api/src/domains/crm/lead-input-error.ts
index 53a71fd..b3d5d82 100644
--- a/apps/api/src/domains/crm/lead-input-error.ts
+++ b/apps/api/src/domains/crm/lead-input-error.ts
@@ -24,7 +24,11 @@ export type LeadInputErrorCode =
   | 'contact_required'
   | 'field_not_found'
   | 'field_invalid'
-  | 'field_reference_not_found';
+  | 'field_reference_not_found'
+  // Phase 2b (advance, follow-ups)
+  | 'followup_required'
+  | 'reason_required'
+  | 'owner_not_found';
 
 export class LeadInputError extends Error {
   constructor(
```

#### `apps/api/src/domains/sales-ops/leads/lead-schemas.ts` (edit, 84 changed lines)

```diff
diff --git a/apps/api/src/domains/sales-ops/leads/lead-schemas.ts b/apps/api/src/domains/sales-ops/leads/lead-schemas.ts
index 7045484..858cdc9 100644
--- a/apps/api/src/domains/sales-ops/leads/lead-schemas.ts
+++ b/apps/api/src/domains/sales-ops/leads/lead-schemas.ts
@@ -200,26 +200,84 @@ const CURSOR_RE =
  * three-part composite. It also caps the worst case at one column rather than
  * the whole board.
  */
-export const ListLeadsQuerySchema = z.object({
-  stageId: uuid,
-  limit: z.coerce.number().int().min(1).max(LEADS_MAX_LIMIT).optional(),
-  cursor: z.string().regex(CURSOR_RE).optional(),
-  sellerPersonId: uuid.optional(),
-});
+const isoDay = z.string().refine((value) => isIsoDay(value), { message: 'must be a real calendar day (YYYY-MM-DD)' });
+
+/** `from` / `to`: inclusive civil days in America/Sao_Paulo; a reversed range is a 400. */
+const periodShape = {
+  pipelineId: uuid.optional(),
+  from: isoDay.optional(),
+  to: isoDay.optional(),
+};
+const periodRefine = (query: { from?: string | undefined; to?: string | undefined }) =>
+  query.from === undefined || query.to === undefined || query.from <= query.to;
+const periodIssue = { message: 'from must not be after to', path: ['from'] };
+
+export const ListLeadsQuerySchema = z
+  .object({
+    stageId: uuid,
+    limit: z.coerce.number().int().min(1).max(LEADS_MAX_LIMIT).optional(),
+    cursor: z.string().regex(CURSOR_RE).optional(),
+    sellerPersonId: uuid.optional(),
+    ...periodShape,
+  })
+  .refine(periodRefine, periodIssue);
 
 /**
- * GET /leads/summary. The list's own `sellerPersonId` parsing, PICKED and not
- * re-spelled, so the two board reads can never disagree about what a valid
- * narrowing is. There is no stageId: the summary covers every column in one
- * GROUP BY.
+ * GET /leads/summary. No stageId: the summary covers every column of the pipeline in one GROUP BY.
+ * The same narrowing keys as the list (seller, pipeline, period), so a column's total and the
+ * summary's count are computed over the same set.
  */
-export const LeadStageSummaryQuerySchema = ListLeadsQuerySchema.pick({ sellerPersonId: true });
+export const LeadStageSummaryQuerySchema = z
+  .object({ sellerPersonId: uuid.optional(), ...periodShape })
+  .refine(periodRefine, periodIssue);
+
+/** One dynamic filter parsed from `f.<fieldKey>[.min|.max]=<value>` (validated against the definitions in the service). */
+export type DynamicFilterInput = { key: string; op: 'eq' | 'min' | 'max'; raw: string };
+
+export type ListLeadsQuery = z.infer<typeof ListLeadsQuerySchema> & { filters?: DynamicFilterInput[] };
+export type LeadStageSummaryQuery = z.infer<typeof LeadStageSummaryQuerySchema> & { filters?: DynamicFilterInput[] };
+
+const blankToUndefined = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value);
+
+/** POST /leads/:id/advance. Blank strings are read as absent (the web drops empties anyway). */
+export const AdvanceLeadSchema = z
+  .object({
+    toStageId: uuid,
+    nextStep: z.preprocess(blankToUndefined, z.string().trim().min(1).max(300).optional()),
+    dueOn: z.preprocess(blankToUndefined, isoDay.optional()),
+    note: z.preprocess(blankToUndefined, z.string().trim().min(1).max(4000).optional()),
+    reason: z.preprocess(blankToUndefined, z.string().trim().min(1).max(500).optional()),
+  })
+  .strict();
+export type AdvanceLeadInput = z.infer<typeof AdvanceLeadSchema>;
+
+export const LeadNoteSchema = z.object({ body: z.string().trim().min(1).max(4000) }).strict();
+export type LeadNoteInput = z.infer<typeof LeadNoteSchema>;
+
+export const LeadFollowupSchema = z
+  .object({
+    nextStep: z.string().trim().min(1).max(300),
+    dueOn: isoDay,
+    ownerPersonId: z.preprocess((value) => (value === '' ? null : value), uuid.nullish()),
+  })
+  .strict();
+export type LeadFollowupInput = z.infer<typeof LeadFollowupSchema>;
+
+/** GET /followups. `mine` is the caller's; `team` needs an admin (checked at the route). */
+export const ListFollowupsQuerySchema = z
+  .object({
+    scope: z.enum(['mine', 'team']).default('mine'),
+    status: z.enum(['open', 'done', 'all']).default('open'),
+    from: isoDay.optional(),
+    to: isoDay.optional(),
+    limit: z.coerce.number().int().min(1).max(LEADS_MAX_LIMIT).default(LEADS_MAX_LIMIT),
+  })
+  .refine(periodRefine, periodIssue);
+export type ListFollowupsQuery = z.infer<typeof ListFollowupsQuerySchema>;
 
 export type LeadWriteInput = z.infer<typeof LeadWriteBaseSchema>;
 export type LeadPatchInput = z.infer<typeof LeadPatchSchema>;
 export type MoveLeadInput = z.infer<typeof MoveLeadSchema>;
-export type ListLeadsQuery = z.infer<typeof ListLeadsQuerySchema>;
-export type LeadStageSummaryQuery = z.infer<typeof LeadStageSummaryQuerySchema>;
 
 /**
  * The deleted-list keyset cursor: `<deleted_at as UTC ISO with MICROseconds>_<id>`.
```

#### `apps/api/src/domains/sales-ops/leads/lead-service.ts` (edit, 73 changed lines)

```diff
diff --git a/apps/api/src/domains/sales-ops/leads/lead-service.ts b/apps/api/src/domains/sales-ops/leads/lead-service.ts
index 1de638b..7df21ed 100644
--- a/apps/api/src/domains/sales-ops/leads/lead-service.ts
+++ b/apps/api/src/domains/sales-ops/leads/lead-service.ts
@@ -20,6 +20,8 @@ import {
 } from '../../crm/lead-fields.js';
 import { LeadInputError } from '../../crm/lead-input-error.js';
 import { defaultPipelineId, pipelineExists } from '../../crm/pipeline-read.js';
+import { boardNarrowingConditions } from './lead-filters.js';
+import { recordStageChange, stageTransitionAllowed } from './lead-history.js';
 import type {
   LeadPatchInput,
   LeadStageSummaryQuery,
@@ -361,7 +363,7 @@ async function boundPersonId(tx: Db, orgId: string, userId: string): Promise<str
   return bound?.id ?? null;
 }
 
-type ResolvedSeller = { id: string; displayName: string };
+export type ResolvedSeller = { id: string; displayName: string };
 
 /**
  * The pessoa when it is an ACTIVE vendedor, else null. The one spelling of that
@@ -411,7 +413,7 @@ async function findActiveVendedor(
  * makes `personNameSnapshot` server-authoritative, so a disagreeing body label
  * loses.
  */
-async function resolveSellerPersonId(
+export async function resolveSellerPersonId(
   tx: Db,
   orgId: string,
   sellerPersonId: string,
@@ -577,6 +579,7 @@ export async function listLeads(
     // counts exactly the rows a page can return.
     const conditions = leadBoardConditions(orgId, gate, query.sellerPersonId);
     conditions.push(eq(salesOpsCrmLeads.stageId, query.stageId));
+    conditions.push(...(await boardNarrowingConditions(tx, orgId, query, { defaultToDefaultPipeline: false })));
 
     const [{ total }] = (await tx
       .select({ total: sql<number>`count(*)::int` })
@@ -665,7 +668,12 @@ export async function summarizeLeadStages(
         estimatedValueBrl: sql<string>`sum(${salesOpsCrmLeads.estimatedValueBrl})::bigint`.mapWith(Number),
       })
       .from(salesOpsCrmLeads)
-      .where(and(...leadBoardConditions(orgId, gate, query.sellerPersonId)))
+      .where(
+        and(
+          ...leadBoardConditions(orgId, gate, query.sellerPersonId),
+          ...(await boardNarrowingConditions(tx, orgId, query, { defaultToDefaultPipeline: true })),
+        ),
+      )
       .groupBy(salesOpsCrmLeads.stageId)
       .orderBy(asc(salesOpsCrmLeads.stageId));
 
@@ -718,7 +726,7 @@ export async function getLead(
  * would escape the org conjunct beside it and reach every org's pool. Anyone
  * else keeps exactly their own leads.
  */
-function leadSellerCondition(sellerPersonId: string, canClaimUnassigned: boolean): SQL {
+export function leadSellerCondition(sellerPersonId: string, canClaimUnassigned: boolean): SQL {
   const own = eq(salesOpsCrmLeads.sellerPersonId, sellerPersonId);
   if (!canClaimUnassigned) return own;
   return or(own, isNull(salesOpsCrmLeads.sellerPersonId))!;
@@ -791,7 +799,7 @@ function leadBoardConditions(
  * The `canClaimUnassigned` conjunct is redundant with the read predicate today
  * and kept so a future predicate change can never turn a finder into a claimant.
  */
-function claimantFor(gate: LeadScopeAllowed, current: LeadRow): string | null {
+export function claimantFor(gate: LeadScopeAllowed, current: LeadRow): string | null {
   if (gate.sellerPersonId === null || !gate.canClaimUnassigned) return null;
   return current.sellerPersonId === null ? gate.sellerPersonId : null;
 }
@@ -804,7 +812,15 @@ export type WriteLeadResult =
   | { ok: true; lead: LeadView }
   | {
       ok: false;
-      reason: 'not_found' | 'seller_scope' | 'seller_person_unmapped' | 'already_converted';
+      reason:
+        | 'not_found'
+        | 'seller_scope'
+        | 'seller_person_unmapped'
+        | 'already_converted'
+        // Phase 2b: the destination is not reachable from the lead's stage in its pipeline graph
+        | 'transition_not_allowed'
+        // Phase 2b (advance only): the destination opens a proposta, which the wizard owns
+        | 'sale_required_for_conversion';
     };
 
 /** The snapshot name of the actor of a write: the verified token name, else the e-mail, else null. */
@@ -1163,9 +1179,18 @@ async function applyLeadUpdate(
   });
 }
 
+export type MoveLeadOptions = {
+  /**
+   * The spreadsheet import places a historical lead straight into its etapa; there is no path to
+   * walk. Only the import executor passes it. Every other caller is held to the transition graph.
+   */
+  skipTransitionGraph?: boolean;
+};
+
 /**
- * The ONLY writer of `stage_id`, `position`, `stage_changed_at`, `lost_reason`
- * and `sale_id`.
+ * The writer of `stage_id`, `position`, `stage_changed_at`, `lost_reason` and `sale_id` for the
+ * board (`advanceLead` in lead-history-service.ts is the other one, sharing the lock order, the
+ * transition rule and the history event).
  */
 export async function moveLead(
   db: Db,
@@ -1173,6 +1198,7 @@ export async function moveLead(
   id: string,
   input: MoveLeadInput,
   scope: LeadScope,
+  options: MoveLeadOptions = {},
 ): Promise<WriteLeadResult> {
   return withTenant(db, orgId, async (tx) => {
     const gate = await resolveLeadScopePredicate(tx, orgId, scope);
@@ -1199,6 +1225,7 @@ export async function moveLead(
     const [destination] = await tx
       .select({
         id: salesOpsPipelineStages.id,
+        pipelineId: salesOpsPipelineStages.pipelineId,
         type: salesOpsPipelineStages.type,
         behavior: salesOpsPipelineStages.behavior,
         exitKind: salesOpsPipelineStages.exitKind,
@@ -1208,7 +1235,6 @@ export async function moveLead(
       .where(
         and(
           eq(salesOpsPipelineStages.orgId, orgId),
-          eq(salesOpsPipelineStages.pipelineId, current.pipelineId),
           eq(salesOpsPipelineStages.id, input.stageId),
           eq(salesOpsPipelineStages.status, 'active'),
         ),
@@ -1216,6 +1242,19 @@ export async function moveLead(
       .limit(1);
     if (!destination) throw new LeadInputError('stage_not_found');
 
+    const stageChanged = destination.id !== current.stageId;
+    // A reorder inside one column is always allowed. A cross-stage move must be an edge of the
+    // pipeline's explicit transition graph (a stage of another pipeline is never reachable).
+    if (stageChanged && !options.skipTransitionGraph) {
+      const allowed =
+        destination.pipelineId === current.pipelineId &&
+        (await stageTransitionAllowed(tx, orgId, current.pipelineId, current.stageId, destination.id));
+      if (!allowed) return { ok: false, reason: 'transition_not_allowed' } as const;
+    } else if (destination.pipelineId !== current.pipelineId) {
+      // Only the import can get here (graph skipped); the composite FK would refuse it anyway.
+      throw new LeadInputError('stage_not_found');
+    }
+
     // This cannot be a zod refine: the requirement depends on the DESTINATION
     // row, which is a database read. So it is the service sentinel 400, the same
     // shape routes.ts already returns for entrada_mode_value_mismatch.
@@ -1245,8 +1284,6 @@ export async function moveLead(
     const claimant = claimantFor(gate, current);
     const claimed = claimant !== null ? await resolveSellerPersonId(tx, orgId, claimant) : null;
 
-    const stageChanged = destination.id !== current.stageId;
-
     await tx
       .update(salesOpsCrmLeads)
       .set({
@@ -1264,7 +1301,19 @@ export async function moveLead(
       .where(and(eq(salesOpsCrmLeads.orgId, orgId), eq(salesOpsCrmLeads.id, id), liveLeadCondition()));
 
     await renumberStage(tx, orgId, destination.id, { moved: id, at: input.position });
-    if (stageChanged) await renumberStage(tx, orgId, current.stageId, null);
+    if (stageChanged) {
+      await renumberStage(tx, orgId, current.stageId, null);
+      // Exactly one history event per stage change, written by the server in this transaction.
+      await recordStageChange(tx, {
+        orgId,
+        leadId: id,
+        fromStageId: current.stageId,
+        toStageId: destination.id,
+        reason: destination.exitKind === 'perdido' ? (input.reason ?? null) : null,
+        actorUserId: scope.userId,
+        actorName: scopeActorName(scope),
+      });
+    }
 
     return { ok: true, lead: await readLeadView(tx, orgId, id) } as const;
   });
```

#### `apps/api/src/domains/sales-ops/leads/lead-trash-service.ts` (edit, 13 changed lines)

```diff
diff --git a/apps/api/src/domains/sales-ops/leads/lead-trash-service.ts b/apps/api/src/domains/sales-ops/leads/lead-trash-service.ts
index 600871c..1326b48 100644
--- a/apps/api/src/domains/sales-ops/leads/lead-trash-service.ts
+++ b/apps/api/src/domains/sales-ops/leads/lead-trash-service.ts
@@ -16,6 +16,7 @@ import {
   renumberStage,
   resolveLeadScopePredicate,
 } from './lead-service.js';
+import { recordStageChange } from './lead-history.js';
 import { withTenant } from './with-tenant.js';
 
 /**
@@ -208,6 +209,18 @@ export function restoreLead(
       .where(restoreConditions);
     // Appended at the end; the renumber keeps the column dense even if it was not.
     await renumberStage(tx, orgId, target.id, null);
+    // A restore that lands in another etapa is a stage change like any other: one history event.
+    if (stageChanged) {
+      await recordStageChange(tx, {
+        orgId,
+        leadId: id,
+        fromStageId: current.stageId,
+        toStageId: target.id,
+        reason: null,
+        actorUserId: actor.userId,
+        actorName: actor.name,
+      });
+    }
 
     const lead = await readLeadView(tx, orgId, id);
     // LAST: the ledger tail lock is global and held until COMMIT. A restore is a
```

#### `apps/api/src/domains/sales-ops/leads/lead-routes.ts` (edit, 119 changed lines)

```diff
diff --git a/apps/api/src/domains/sales-ops/leads/lead-routes.ts b/apps/api/src/domains/sales-ops/leads/lead-routes.ts
index 4ed19f8..47ac90e 100644
--- a/apps/api/src/domains/sales-ops/leads/lead-routes.ts
+++ b/apps/api/src/domains/sales-ops/leads/lead-routes.ts
@@ -4,6 +4,9 @@ import { getDb } from '../../../db/client.js';
 import { requireAdmin } from '../../../middleware/require-admin.js';
 import { cadastroActor } from '../cadastro-actor.js';
 import {
+  AdvanceLeadSchema,
+  LeadFollowupSchema,
+  LeadNoteSchema,
   LeadPatchSchema,
   LeadStageSummaryQuerySchema,
   LeadWriteSchema,
@@ -22,6 +25,8 @@ import {
   summarizeLeadStages,
   updateLead,
 } from './lead-service.js';
+import { LeadFilterError, parseDynamicFilters } from './lead-filters.js';
+import { addLeadFollowup, addLeadNote, advanceLead, getLeadSummary } from './lead-history-service.js';
 import { type LeadActor, deleteLead, listDeletedLeads, restoreLead } from './lead-trash-service.js';
 
 /**
@@ -62,12 +67,12 @@ const leadIdSchema = z.string().uuid();
  * e-mail, then null, never the account id), taken here because the act is the
  * only moment it is knowable.
  */
-function leadActor(c: Context): LeadActor {
+export function leadActor(c: Context): LeadActor {
   const actor = cadastroActor(c);
   return { userId: actor.userId, name: actor.displayName };
 }
 
-function leadScope(c: Context): LeadScope {
+export function leadScope(c: Context): LeadScope {
   const claims = c.get('hubAuth')?.claims;
   const email = claims?.email;
   const name = claims?.name;
@@ -84,7 +89,12 @@ function leadScope(c: Context): LeadScope {
   };
 }
 
-function validationResponse(c: Context, error: z.ZodError) {
+/** A dynamic filter on an unknown or non-filterable field, or with a value its kind cannot take. */
+function invalidFilterResponse(c: Context, error: LeadFilterError) {
+  return c.json({ error: 'validation_error', reason: 'invalid_filter', filter: error.filter }, 400);
+}
+
+export function validationResponse(c: Context, error: z.ZodError) {
   return c.json({ error: 'validation_error', issues: error.flatten() }, 400);
 }
 
@@ -97,11 +107,22 @@ function validationResponse(c: Context, error: z.ZodError) {
  * An out-of-scope lead is `not_found` and never `forbidden`, because a 403 on a
  * specific uuid confirms the row exists.
  */
-function failureResponse(
+export function failureResponse(
   c: Context,
-  reason: 'not_found' | 'seller_scope' | 'seller_person_unmapped' | 'already_converted',
+  reason:
+    | 'not_found'
+    | 'seller_scope'
+    | 'seller_person_unmapped'
+    | 'already_converted'
+    | 'transition_not_allowed'
+    | 'sale_required_for_conversion',
 ) {
   if (reason === 'not_found') return c.json({ error: 'not_found' }, 404);
+  // The pair is absent from the pipeline graph (or the stage is another pipeline's), or the
+  // destination opens a proposta that only the wizard may create.
+  if (reason === 'transition_not_allowed' || reason === 'sale_required_for_conversion') {
+    return c.json({ error: reason }, 409);
+  }
   if (reason === 'already_converted') {
     return c.json({ error: 'conflict', reason: 'lead_already_converted' }, 409);
   }
@@ -114,7 +135,7 @@ function failureResponse(
  * "does this destination stage require a reason?" - so they cannot be zod
  * refines.
  */
-function leadInputErrorResponse(c: Context, error: LeadInputError) {
+export function leadInputErrorResponse(c: Context, error: LeadInputError) {
   return c.json(
     { error: 'validation_error', reason: error.code, itemIndex: error.itemIndex },
     400,
@@ -127,13 +148,28 @@ leadsRouter.get('/', async (c) => {
     limit: c.req.query('limit'),
     cursor: c.req.query('cursor'),
     sellerPersonId: c.req.query('sellerPersonId'),
+    pipelineId: c.req.query('pipelineId'),
+    from: c.req.query('from'),
+    to: c.req.query('to'),
   });
   if (!parsed.success) {
     return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
   }
-  const result = await listLeads(getDb(), c.get('orgId'), parsed.data, leadScope(c));
-  if (!result.ok) return failureResponse(c, result.reason);
-  return c.json({ leads: result.leads, nextCursor: result.nextCursor, total: result.total });
+  let filters;
+  try {
+    filters = parseDynamicFilters(c.req.query());
+  } catch (error) {
+    if (error instanceof LeadFilterError) return invalidFilterResponse(c, error);
+    throw error;
+  }
+  try {
+    const result = await listLeads(getDb(), c.get('orgId'), { ...parsed.data, ...(filters.length > 0 ? { filters } : {}) }, leadScope(c));
+    if (!result.ok) return failureResponse(c, result.reason);
+    return c.json({ leads: result.leads, nextCursor: result.nextCursor, total: result.total });
+  } catch (error) {
+    if (error instanceof LeadFilterError) return invalidFilterResponse(c, error);
+    throw error;
+  }
 });
 
 leadsRouter.post('/', async (c) => {
@@ -174,11 +210,20 @@ leadsRouter.get('/deleted', requireAdmin, async (c) => {
 leadsRouter.get('/summary', async (c) => {
   const parsed = LeadStageSummaryQuerySchema.safeParse({
     sellerPersonId: c.req.query('sellerPersonId'),
+    pipelineId: c.req.query('pipelineId'),
+    from: c.req.query('from'),
+    to: c.req.query('to'),
   });
   if (!parsed.success) return validationResponse(c, parsed.error);
-  const result = await summarizeLeadStages(getDb(), c.get('orgId'), parsed.data, leadScope(c));
-  if (!result.ok) return failureResponse(c, result.reason);
-  return c.json({ stages: result.stages });
+  try {
+    const filters = parseDynamicFilters(c.req.query());
+    const result = await summarizeLeadStages(getDb(), c.get('orgId'), { ...parsed.data, ...(filters.length > 0 ? { filters } : {}) }, leadScope(c));
+    if (!result.ok) return failureResponse(c, result.reason);
+    return c.json({ stages: result.stages });
+  } catch (error) {
+    if (error instanceof LeadFilterError) return invalidFilterResponse(c, error);
+    throw error;
+  }
 });
 
 leadsRouter.get('/:id', async (c) => {
@@ -222,6 +267,56 @@ leadsRouter.post('/:id/move', async (c) => {
   }
 });
 
+/** GET /leads/:id/summary: stage, pipeline, the allowed next stages, the timeline and the follow-ups. */
+leadsRouter.get('/:id/summary', async (c) => {
+  const id = leadIdSchema.safeParse(c.req.param('id'));
+  if (!id.success) return c.json({ error: 'not_found' }, 404);
+  const result = await getLeadSummary(getDb(), c.get('orgId'), id.data, leadScope(c));
+  if (!result.ok) return failureResponse(c, result.reason);
+  return c.json(result.summary);
+});
+
+/** POST /leads/:id/advance: the Avançar act. Same envelope as /move. */
+leadsRouter.post('/:id/advance', async (c) => {
+  const id = leadIdSchema.safeParse(c.req.param('id'));
+  if (!id.success) return c.json({ error: 'not_found' }, 404);
+  const parsed = AdvanceLeadSchema.safeParse(await c.req.json().catch(() => ({})));
+  if (!parsed.success) return validationResponse(c, parsed.error);
+  try {
+    const result = await advanceLead(getDb(), c.get('orgId'), id.data, parsed.data, leadScope(c));
+    if (!result.ok) return failureResponse(c, result.reason);
+    return c.json({ lead: result.lead });
+  } catch (error) {
+    if (error instanceof LeadInputError) return leadInputErrorResponse(c, error);
+    throw error;
+  }
+});
+
+leadsRouter.post('/:id/notes', async (c) => {
+  const id = leadIdSchema.safeParse(c.req.param('id'));
+  if (!id.success) return c.json({ error: 'not_found' }, 404);
+  const parsed = LeadNoteSchema.safeParse(await c.req.json().catch(() => ({})));
+  if (!parsed.success) return validationResponse(c, parsed.error);
+  const result = await addLeadNote(getDb(), c.get('orgId'), id.data, parsed.data, leadScope(c));
+  if (!result.ok) return failureResponse(c, result.reason);
+  return c.json({ note: result.note }, 201);
+});
+
+leadsRouter.post('/:id/followups', async (c) => {
+  const id = leadIdSchema.safeParse(c.req.param('id'));
+  if (!id.success) return c.json({ error: 'not_found' }, 404);
+  const parsed = LeadFollowupSchema.safeParse(await c.req.json().catch(() => ({})));
+  if (!parsed.success) return validationResponse(c, parsed.error);
+  try {
+    const result = await addLeadFollowup(getDb(), c.get('orgId'), id.data, parsed.data, leadScope(c));
+    if (!result.ok) return failureResponse(c, result.reason);
+    return c.json({ followup: result.followup }, 201);
+  } catch (error) {
+    if (error instanceof LeadInputError) return leadInputErrorResponse(c, error);
+    throw error;
+  }
+});
+
 // Open to every board caller: the scope gate inside the service decides which
 // leads he may delete (exactly the ones he can read). 204 with no body.
 leadsRouter.post('/:id/delete', async (c) => {
```

#### `apps/api/src/domains/sales-ops/routes.ts` (edit, 4 changed lines)

```diff
diff --git a/apps/api/src/domains/sales-ops/routes.ts b/apps/api/src/domains/sales-ops/routes.ts
index 2424f64..296e577 100644
--- a/apps/api/src/domains/sales-ops/routes.ts
+++ b/apps/api/src/domains/sales-ops/routes.ts
@@ -10,6 +10,7 @@ import { requireCapability } from '../../middleware/require-capability.js';
 import { HISTORY_MAX_LIMIT, listOrgAuditHistory } from '../audit/history-service.js';
 import { importRouter } from '../import/routes.js';
 import { cadastroActor } from './cadastro-actor.js';
+import { crmRouter } from './crm-routes.js';
 import { leadsRouter } from './leads/lead-routes.js';
 import { leadStagesRouter } from './leads/stage-routes.js';
 import { ensureLeadStagesForOrg } from './leads/stages-seed.js';
@@ -321,6 +322,9 @@ salesOpsRouter.patch('/funcoes/:id', requireAdmin, async (c) => {
 // prefix is '/'. The lead entity mounts its own router separately at '/leads'.
 salesOpsRouter.route('/', leadStagesRouter);
 
+// The CRM configuration reads (pipelines, field definitions) and the follow-up list.
+salesOpsRouter.route('/', crmRouter);
+
 // The lead entity. Two imports, two mounts, two distinct identifiers and no
 // alias: '/lead-stages...' and '/leads...' do not overlap, and naming the
 // difference here is what keeps a reader from thinking one router grew a second
```

#### `apps/api/src/domains/import/executor.ts` (edit, 3 changed lines)

```diff
diff --git a/apps/api/src/domains/import/executor.ts b/apps/api/src/domains/import/executor.ts
index 2a9476a..4539718 100644
--- a/apps/api/src/domains/import/executor.ts
+++ b/apps/api/src/domains/import/executor.ts
@@ -337,7 +337,8 @@ export async function executeImportPlan(
           ...(operation.lostReason !== null ? { reason: operation.lostReason } : {}),
         });
         if (!move.success) throw new ImportExecutionError(operation, 'invalid_lead');
-        const moved = await moveLead(tx, orgId, created.lead.id, move.data, scope);
+        // A historical lead is placed straight into its etapa: there is no path to walk.
+        const moved = await moveLead(tx, orgId, created.lead.id, move.data, scope, { skipTransitionGraph: true });
         if (!moved.ok) throw new ImportExecutionError(operation, moved.reason);
         return;
       }
```

#### `apps/api/test/rls/lead-path.ts` (new file)

Create the file with exactly this content.

```ts
import type { getDb } from '../../src/db/client.js';
import { MoveLeadSchema } from '../../src/domains/sales-ops/leads/lead-schemas.js';
import { moveLead, type LeadScope } from '../../src/domains/sales-ops/leads/lead-service.js';
import { listLeadStages } from '../../src/domains/sales-ops/leads/stage-service.js';

/**
 * Walks a lead along the default pipeline graph to the etapa just BEFORE the conversion etapa
 * (Novo -> Qualificação -> Em negociação), one allowed edge at a time. Since the phase 2b cutover a
 * cross-stage move must be an edge of the pipeline graph, so a fixture that wants a lead parked next
 * to Proposta walks there instead of jumping. A lead that is already past a step skips it.
 */
export async function walkToConversionDoor(
  db: ReturnType<typeof getDb>,
  orgId: string,
  leadId: string,
  scope: LeadScope,
): Promise<void> {
  const stages = (await listLeadStages(db, orgId)).filter((stage) => stage.status === 'active');
  const conversion = stages.find((stage) => stage.kind === 'conversion')!;
  const path = stages
    .filter((stage) => stage.kind === 'normal' && stage.type === 'normal' && stage.position > 1 && stage.position < conversion.position)
    .sort((a, b) => a.position - b.position);
  for (const stage of path) {
    const moved = await moveLead(db, orgId, leadId, MoveLeadSchema.parse({ stageId: stage.id, position: 0 }), scope);
    if (!moved.ok) throw new Error(`walk refused at ${stage.name}: ${moved.reason}`);
  }
}
```

## Tests (new)

#### `packages/shared-utils/src/__tests__/sao-paulo-range.test.ts` (new file)

Create the file with exactly this content.

```ts
import { describe, expect, it } from 'vitest';
import { addDaysToIsoDay, saoPauloDayOf, saoPauloDayRangeToInstants } from '../sao-paulo-day.js';

describe('saoPauloDayRangeToInstants', () => {
  it('turns inclusive civil days into [from 00:00 -03:00, to+1 00:00 -03:00)', () => {
    const { start, endExclusive } = saoPauloDayRangeToInstants('2026-10-20', '2026-10-20');
    expect(start!.toISOString()).toBe('2026-10-20T03:00:00.000Z');
    expect(endExclusive!.toISOString()).toBe('2026-10-21T03:00:00.000Z');
  });

  it('puts 02:30Z of day D+1 inside day D and 03:00Z inside D+1', () => {
    const { start, endExclusive } = saoPauloDayRangeToInstants('2026-10-20', '2026-10-20');
    const inside = new Date('2026-10-21T02:30:00.000Z');
    expect(inside >= start! && inside < endExclusive!).toBe(true);
    expect(saoPauloDayOf(inside)).toBe('2026-10-20');
    const next = new Date('2026-10-21T03:00:00.000Z');
    expect(next < endExclusive!).toBe(false);
    expect(saoPauloDayOf(next)).toBe('2026-10-21');
  });

  it('leaves an open end null and refuses an impossible day', () => {
    expect(saoPauloDayRangeToInstants(undefined, undefined)).toEqual({ start: null, endExclusive: null });
    expect(saoPauloDayRangeToInstants('2026-10-20', null).endExclusive).toBeNull();
    expect(() => saoPauloDayRangeToInstants('2026-02-30', null)).toThrow(RangeError);
  });

  it('adds days across month and year ends', () => {
    expect(addDaysToIsoDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToIsoDay('2026-03-01', -1)).toBe('2026-02-28');
  });
});
```

#### `apps/api/test/rls/crm-pipeline-history.test.ts` (new file)

Create the file with exactly this content.

```ts
/**
 * ORACLE of slice 07b: pipelines, field definitions, the lead summary, Avançar, the transition graph
 * on move, notes, follow-ups, period filters in America/Sao_Paulo and dynamic field filters - all
 * through the REAL salesOpsRouter against the test database (RLS applies).
 *
 * Run: pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/crm-pipeline-history.test.ts
 */
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import postgres from 'postgres';
import { afterAll, describe, expect, it, vi } from 'vitest';

// routes.ts imports middleware/app-auth.js, which resolves the Hub contract at module scope.
vi.hoisted(() => {
  for (const name of ['FXL_HUB_CONFIG', 'FXL_HUB_API_URL', 'FXL_HUB_ENVIRONMENT', 'FXL_HUB_CLIENT_ID', 'FXL_HUB_CLIENT_SECRET', 'FXL_HUB_AUDIENCE', 'SALES_ENV_FILE', 'SALES_AUTH_FAKE']) {
    process.env[name] = '';
  }
});

import { hubAuthContext } from '../../src/auth/__tests__/hub-auth-context-fixture.js';
import { closeDb, getDb } from '../../src/db/client.js';
import { deleteCrmForOrgs } from '../../src/db/__tests__/settlement-test-cleanup.js';
import { testDatabaseUrls } from '../../src/db/__tests__/test-database-urls.js';
import { ClientSchema, PersonSchema, createClient, createPerson } from '../../src/domains/sales-ops/service.js';

const { salesOpsRouter } = await import('../../src/domains/sales-ops/routes.js');

const { adminUrl } = testDatabaseUrls();
const sql = postgres(adminUrl, { max: 2, connection: { 'app.fxl_admin': 'true' } });
const orgIds: string[] = [];

type Who = { userId: string; role: 'admin' | 'seller'; name?: string };
const ADMIN: Who = { userId: 'hub_admin', role: 'admin', name: 'Gestora Ana' };

function appFor(orgId: string, who: Who): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', who.userId);
    c.set('orgId', orgId);
    c.set('userRole', who.role);
    c.set('userRoles', (who.role === 'admin' ? ['admin', 'seller'] : ['seller']) as never);
    c.set('salesEdition', 'full' as never);
    c.set('hubAuth', hubAuthContext({ accountId: who.userId, workspaceId: orgId, ...(who.name ? { name: who.name } : {}), email: `${who.userId}@x.test` }));
    await next();
  });
  app.route('/', salesOpsRouter);
  return app;
}

async function call(app: Hono, method: string, path: string, body?: unknown) {
  const response = await app.request(path, {
    method,
    ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let json: Record<string, any> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, any>) : {};
  } catch {
    // Hono answers an unmatched route with the plain text '404 Not Found'.
  }
  return { status: response.status, json };
}

function newOrg(label: string): string {
  const orgId = `org_hist_${label}_${Date.now()}_${randomUUID().slice(0, 6)}`;
  orgIds.push(orgId);
  return orgId;
}

afterAll(async () => {
  for (const orgId of orgIds) {
    // Delete and restore write hash-chained audit entries; the chain-order oracles need it free of leftovers.
    await sql`DELETE FROM audit_log WHERE actor_org_id = ${orgId}`;
    await deleteCrmForOrgs([orgId]);
    await sql`DELETE FROM sales_ops_person_funcoes WHERE org_id = ${orgId}`;
    await sql`DELETE FROM sales_ops_people WHERE org_id = ${orgId}`;
    await sql`DELETE FROM sales_ops_funcoes WHERE org_id = ${orgId}`;
    await sql`DELETE FROM sales_ops_clients WHERE org_id = ${orgId}`;
  }
  await sql.end();
  await closeDb();
});

async function world(label: string) {
  const orgId = newOrg(label);
  const app = appFor(orgId, ADMIN);
  const { json } = await call(app, 'GET', '/pipelines');
  const pipeline = json.pipelines[0] as { id: string; stages: Array<{ id: string; name: string }>; transitions: unknown[] };
  const stage = (name: string) => pipeline.stages.find((s) => s.name === name)!.id;
  const create = async (extra: Record<string, unknown> = {}, who: Who = ADMIN) => {
    const res = await call(appFor(orgId, who), 'POST', '/leads', { contactName: 'Ana', contactEmail: 'ana@x.com', ...extra });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    return res.json.lead as { id: string; stageId: string; fields: Array<{ key: string; value: unknown }> };
  };
  const events = async (leadId: string) =>
    sql<Array<{ from_stage_id: string | null; to_stage_id: string; reason: string | null; actor_name_snapshot: string | null }>>`
      SELECT from_stage_id, to_stage_id, reason, actor_name_snapshot FROM sales_ops_crm_lead_events WHERE lead_id = ${leadId} ORDER BY occurred_at, id`;
  return { orgId, app, pipeline, stage, create, events };
}

describe('GET /pipelines and GET /field-definitions', () => {
  it('seed the default pipeline (7 stages, 22 transitions) and the Cliente field on first read, scoped to the org', async () => {
    const a = await world('seed-a');
    const b = await world('seed-b');
    expect(a.pipeline.stages.map((s) => s.name)).toEqual(['Novo', 'Qualificação', 'Em negociação', 'Proposta', 'Ganho', 'Perdido', 'Pausado']);
    expect(a.pipeline.transitions).toHaveLength(22);
    const res = await call(a.app, 'GET', '/pipelines');
    expect(res.json.pipelines).toHaveLength(1);
    expect(res.json.pipelines[0]).toMatchObject({ name: 'Funil CRM padrão', isDefault: true, status: 'active' });
    expect(res.json.pipelines[0].stages[3]).toMatchObject({ name: 'Proposta', type: 'orcamento', behavior: 'opens_orcamentos', exitKind: null, requiresReason: false, status: 'active' });
    expect(res.json.pipelines[0].stages[5]).toMatchObject({ name: 'Perdido', type: 'saida', exitKind: 'perdido', requiresReason: true });
    // RLS plus the explicit org filter: org B's pipeline shares no id with org A's.
    expect(b.pipeline.id).not.toBe(a.pipeline.id);
    const fields = await call(a.app, 'GET', '/field-definitions');
    expect(fields.status).toBe(200);
    expect(fields.json.fields).toEqual([
      expect.objectContaining({ key: 'cliente', label: 'Cliente', kind: 'reference', referenceTarget: 'cliente', multiple: false, filterable: true, isSystem: true, removable: false, position: 1 }),
    ]);
  });

  it('the Cliente definition cannot be removed or archived through any route, and is re-created if its row vanishes', async () => {
    const w = await world('cliente-def');
    const [def] = await sql<{ id: string }[]>`SELECT id FROM sales_ops_field_definitions WHERE org_id = ${w.orgId} AND key = 'cliente'`;
    for (const [method, path, body] of [
      ['POST', '/field-definitions', { key: 'x', label: 'X', kind: 'text' }],
      ['PUT', '/field-definitions', {}],
      ['PATCH', `/field-definitions/${def!.id}`, { status: 'archived' }],
      ['PUT', `/field-definitions/${def!.id}`, { removable: true }],
      ['DELETE', `/field-definitions/${def!.id}`, undefined],
      ['POST', `/field-definitions/${def!.id}/archive`, {}],
      ['DELETE', '/pipelines', undefined],
      ['PATCH', `/pipelines/${w.pipeline.id}`, { status: 'archived' }],
    ] as const) {
      const res = await call(w.app, method, path, body);
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    const [still] = await sql<{ status: string; removable: boolean }[]>`SELECT status, removable FROM sales_ops_field_definitions WHERE id = ${def!.id}`;
    expect(still).toEqual({ status: 'active', removable: false });
    // The database refuses a removable non-system row and the service re-seeds a missing Cliente.
    await expect(sql`INSERT INTO sales_ops_field_definitions (org_id, key, label, removable, is_system) VALUES (${w.orgId}, 'k', 'K', false, false)`).rejects.toThrow();
    await sql`DELETE FROM sales_ops_field_definitions WHERE id = ${def!.id}`;
    const again = await call(w.app, 'GET', '/field-definitions');
    expect(again.json.fields.map((f: { key: string }) => f.key)).toEqual(['cliente']);
  });
});

describe('the transition graph on move', () => {
  it('an absent pair is 409 transition_not_allowed and writes nothing; an allowed pair writes exactly one event', async () => {
    const w = await world('move');
    const lead = await w.create();
    const before = await w.events(lead.id);
    expect(before).toHaveLength(1);

    const refused = await call(w.app, 'POST', `/leads/${lead.id}/move`, { stageId: w.stage('Em negociação'), position: 0 });
    expect(refused.status).toBe(409);
    expect(refused.json).toEqual({ error: 'transition_not_allowed' });
    expect(await w.events(lead.id)).toHaveLength(1);
    const [stuck] = await sql<{ stage_id: string }[]>`SELECT stage_id FROM sales_ops_crm_leads WHERE id = ${lead.id}`;
    expect(stuck!.stage_id).toBe(lead.stageId);

    const ok = await call(w.app, 'POST', `/leads/${lead.id}/move`, { stageId: w.stage('Qualificação'), position: 0 });
    expect(ok.status).toBe(200);
    const events = await w.events(lead.id);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ from_stage_id: lead.stageId, to_stage_id: w.stage('Qualificação'), actor_name_snapshot: 'Gestora Ana' });
  });

  it('a reorder inside one column writes no event and never moves stage_changed_at', async () => {
    const w = await world('reorder');
    const first = await w.create({ contactName: 'Um' });
    await w.create({ contactName: 'Dois' });
    const [before] = await sql<{ stage_changed_at: Date }[]>`SELECT stage_changed_at FROM sales_ops_crm_leads WHERE id = ${first.id}`;
    const res = await call(w.app, 'POST', `/leads/${first.id}/move`, { stageId: first.stageId, position: 1 });
    expect(res.status).toBe(200);
    const [after] = await sql<{ stage_changed_at: Date }[]>`SELECT stage_changed_at FROM sales_ops_crm_leads WHERE id = ${first.id}`;
    expect(after!.stage_changed_at.toISOString()).toBe(before!.stage_changed_at.toISOString());
    expect(await w.events(first.id)).toHaveLength(1);
  });

  it('a stage of another pipeline is never reachable', async () => {
    const w = await world('crosspipe');
    const lead = await w.create();
    const [other] = await sql<{ id: string }[]>`INSERT INTO sales_ops_pipelines (org_id, name, position) VALUES (${w.orgId}, 'Carteira', 1) RETURNING id`;
    const [foreign] = await sql<{ id: string }[]>`INSERT INTO sales_ops_pipeline_stages (org_id, pipeline_id, name, position) VALUES (${w.orgId}, ${other!.id}, 'Novo', 1) RETURNING id`;
    const res = await call(w.app, 'POST', `/leads/${lead.id}/move`, { stageId: foreign!.id, position: 0 });
    expect(res).toMatchObject({ status: 409, json: { error: 'transition_not_allowed' } });
  });
});

describe('POST /leads/:id/advance and GET /leads/:id/summary', () => {
  it('lists only the graph-allowed next stages and the timeline of the lead', async () => {
    const w = await world('summary');
    const lead = await w.create();
    const res = await call(w.app, 'GET', `/leads/${lead.id}/summary`);
    expect(res.status).toBe(200);
    expect(res.json.pipeline).toEqual({ id: w.pipeline.id, name: 'Funil CRM padrão' });
    expect(res.json.stage).toMatchObject({ name: 'Novo', type: 'normal', exitKind: null });
    expect(res.json.nextStages.map((s: { name: string }) => s.name)).toEqual(['Qualificação', 'Ganho', 'Perdido', 'Pausado']);
    expect(res.json.nextStages.find((s: { name: string }) => s.name === 'Perdido')).toMatchObject({ type: 'saida', exitKind: 'perdido', requiresReason: true });
    expect(res.json.timeline).toEqual([expect.objectContaining({ kind: 'stage_changed', fromStageName: null, toStageName: 'Novo', actorName: 'Gestora Ana' })]);
    expect(res.json.followups).toEqual([]);
    expect(res.json.lead.id).toBe(lead.id);
  });

  it('advance writes exactly ONE server-side event, the note linked to it and the follow-up, in one act', async () => {
    const w = await world('advance');
    const lead = await w.create();
    const res = await call(w.app, 'POST', `/leads/${lead.id}/advance`, {
      toStageId: w.stage('Qualificação'),
      nextStep: 'Ligar na segunda',
      dueOn: '2026-10-26',
      note: 'Cliente pediu retorno',
    });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.lead).toMatchObject({ id: lead.id, stageId: w.stage('Qualificação') });
    expect(res.json.lead.fields).toBeInstanceOf(Array);
    const events = await w.events(lead.id);
    expect(events).toHaveLength(2);
    const [event] = await sql<{ id: string }[]>`SELECT id FROM sales_ops_crm_lead_events WHERE lead_id = ${lead.id} AND from_stage_id IS NOT NULL`;
    const notes = await sql<{ event_id: string | null; body: string; author_name_snapshot: string }[]>`SELECT event_id, body, author_name_snapshot FROM sales_ops_crm_lead_notes WHERE lead_id = ${lead.id}`;
    expect(notes).toEqual([{ event_id: event!.id, body: 'Cliente pediu retorno', author_name_snapshot: 'Gestora Ana' }]);
    const followups = await sql<{ next_step: string; due_on: string; created_by_name: string }[]>`SELECT next_step, due_on::text AS due_on, created_by_name FROM sales_ops_crm_lead_followups WHERE lead_id = ${lead.id}`;
    expect(followups).toEqual([{ next_step: 'Ligar na segunda', due_on: '2026-10-26', created_by_name: 'Gestora Ana' }]);
    // The card is at the END of the destination column and stage_changed_at moved.
    const summary = await call(w.app, 'GET', `/leads/${lead.id}/summary`);
    expect(summary.json.timeline.map((t: { kind: string }) => t.kind).sort()).toEqual(['followup', 'note', 'stage_changed', 'stage_changed']);
    expect(summary.json.nextStages.map((s: { name: string }) => s.name)).toEqual(['Novo', 'Em negociação', 'Ganho', 'Perdido', 'Pausado']);
  });

  it('a follow-up with a date is mandatory unless the destination is an exit', async () => {
    const w = await world('followup-required');
    const lead = await w.create();
    const to = w.stage('Qualificação');
    for (const body of [{ toStageId: to }, { toStageId: to, nextStep: 'Ligar' }, { toStageId: to, dueOn: '2026-10-26' }, { toStageId: to, nextStep: '  ', dueOn: '2026-10-26' }]) {
      const res = await call(w.app, 'POST', `/leads/${lead.id}/advance`, body);
      expect(res.status).toBe(400);
      expect(res.json).toMatchObject({ error: 'validation_error', reason: 'followup_required' });
    }
    expect((await call(w.app, 'POST', `/leads/${lead.id}/advance`, { toStageId: to, nextStep: 'Ligar', dueOn: '2026-02-30' })).status).toBe(400);
    expect(await w.events(lead.id)).toHaveLength(1);
    // An exit needs none ...
    const pausa = await call(w.app, 'POST', `/leads/${lead.id}/advance`, { toStageId: w.stage('Pausado') });
    expect(pausa.status).toBe(200);
    // ... and a half follow-up on an exit is still refused.
    const lead2 = await w.create({ contactName: 'Dois' });
    const half = await call(w.app, 'POST', `/leads/${lead2.id}/advance`, { toStageId: w.stage('Ganho'), nextStep: 'x' });
    expect(half.json).toMatchObject({ reason: 'followup_required' });
  });

  it('perdido requires a reason and stores it; ganho does not', async () => {
    const w = await world('reason');
    const lead = await w.create();
    const missing = await call(w.app, 'POST', `/leads/${lead.id}/advance`, { toStageId: w.stage('Perdido') });
    expect(missing.status).toBe(400);
    expect(missing.json).toMatchObject({ error: 'validation_error', reason: 'reason_required' });
    expect(await w.events(lead.id)).toHaveLength(1);
    const lost = await call(w.app, 'POST', `/leads/${lead.id}/advance`, { toStageId: w.stage('Perdido'), reason: 'Sem orçamento' });
    expect(lost.status).toBe(200);
    expect(lost.json.lead).toMatchObject({ lostReason: 'Sem orçamento', stageExitKind: 'perdido', stageType: 'saida' });
    const events = await w.events(lead.id);
    expect(events[1]).toMatchObject({ reason: 'Sem orçamento' });
    const won = await w.create({ contactName: 'Ganha' });
    expect((await call(w.app, 'POST', `/leads/${won.id}/advance`, { toStageId: w.stage('Ganho') })).status).toBe(200);
  });

  it('an invalid transition is 409, and Proposta (opens a proposta) is 409 sale_required_for_conversion', async () => {
    const w = await world('invalid');
    const lead = await w.create();
    const bad = await call(w.app, 'POST', `/leads/${lead.id}/advance`, { toStageId: w.stage('Em negociação'), nextStep: 'x', dueOn: '2026-10-26' });
    expect(bad).toMatchObject({ status: 409, json: { error: 'transition_not_allowed' } });
    expect(await w.events(lead.id)).toHaveLength(1);
    for (const to of ['Qualificação', 'Em negociação']) {
      expect((await call(w.app, 'POST', `/leads/${lead.id}/advance`, { toStageId: w.stage(to), nextStep: 'x', dueOn: '2026-10-26' })).status).toBe(200);
    }
    const conversion = await call(w.app, 'POST', `/leads/${lead.id}/advance`, { toStageId: w.stage('Proposta'), nextStep: 'x', dueOn: '2026-10-26' });
    expect(conversion).toMatchObject({ status: 409, json: { error: 'sale_required_for_conversion' } });
    expect(await w.events(lead.id)).toHaveLength(3);
  });

  it('a restore into another etapa writes the event too', async () => {
    const w = await world('restore');
    const lead = await w.create();
    expect((await call(w.app, 'POST', `/leads/${lead.id}/delete`)).status).toBe(204);
    await call(w.app, 'PATCH', `/lead-stages/${w.stage('Novo')}`, { status: 'archived' });
    const restored = await call(w.app, 'POST', `/leads/${lead.id}/restore`);
    expect(restored.status).toBe(200);
    const events = await w.events(lead.id);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ from_stage_id: w.stage('Novo'), to_stage_id: w.stage('Qualificação') });
  });
});

describe('notes and follow-ups', () => {
  it('POST notes and followups answer 201 with the created row; blank input is 400', async () => {
    const w = await world('notes');
    const lead = await w.create();
    const note = await call(w.app, 'POST', `/leads/${lead.id}/notes`, { body: '  Ligou  ' });
    expect(note.status).toBe(201);
    expect(note.json.note).toMatchObject({ body: 'Ligou', authorName: 'Gestora Ana' });
    expect((await call(w.app, 'POST', `/leads/${lead.id}/notes`, { body: '  ' })).status).toBe(400);
    expect((await call(w.app, 'POST', `/leads/${randomUUID()}/notes`, { body: 'x' })).status).toBe(404);
    const followup = await call(w.app, 'POST', `/leads/${lead.id}/followups`, { nextStep: 'Enviar proposta', dueOn: '2026-10-22' });
    expect(followup.status).toBe(201);
    expect(followup.json.followup).toMatchObject({ nextStep: 'Enviar proposta', dueOn: '2026-10-22', doneAt: null });
    expect((await call(w.app, 'POST', `/leads/${lead.id}/followups`, { nextStep: 'x' })).status).toBe(400);
    expect((await call(w.app, 'POST', `/leads/${lead.id}/followups`, { nextStep: 'x', dueOn: '2026-10-22', ownerPersonId: randomUUID() })).json).toMatchObject({ reason: 'owner_not_found' });
  });

  it('GET /followups: mine vs team, status and a due-day period; team needs an admin; done is idempotent', async () => {
    const w = await world('list');
    const db = getDb();
    const ana = await createPerson(db, w.orgId, PersonSchema.parse({ displayName: 'Ana Vendedora', isSeller: true, contactEmail: 'ana@x.test' }));
    if (typeof ana === 'string') throw new Error(ana);
    await sql`UPDATE sales_ops_people SET hub_account_id = 'hub_ana' WHERE id = ${ana.id}`;
    const seller: Who = { userId: 'hub_ana', role: 'seller', name: 'Ana Vendedora' };
    const bruno = await createPerson(db, w.orgId, PersonSchema.parse({ displayName: 'Bruno', isSeller: true }));
    if (typeof bruno === 'string') throw new Error(bruno);
    await sql`UPDATE sales_ops_people SET hub_account_id = 'hub_bruno' WHERE id = ${bruno.id}`;
    const brunoWho: Who = { userId: 'hub_bruno', role: 'seller', name: 'Bruno' };

    const anaLead = await w.create({ contactName: 'Lead da Ana', sellerPersonId: ana.id });
    const brunoLead = await w.create({ contactName: 'Lead do Bruno', sellerPersonId: bruno.id });
    const a1 = await call(appFor(w.orgId, seller), 'POST', `/leads/${anaLead.id}/followups`, { nextStep: 'A1', dueOn: '2026-10-20' });
    await call(appFor(w.orgId, seller), 'POST', `/leads/${anaLead.id}/followups`, { nextStep: 'A2', dueOn: '2026-11-05' });
    await call(appFor(w.orgId, brunoWho), 'POST', `/leads/${brunoLead.id}/followups`, { nextStep: 'B1', dueOn: '2026-10-21' });

    const mine = await call(appFor(w.orgId, seller), 'GET', '/followups?scope=mine');
    expect(mine.json.followups.map((f: { nextStep: string }) => f.nextStep)).toEqual(['A1', 'A2']);
    expect(mine.json.followups[0]).toEqual({ id: expect.any(String), leadId: anaLead.id, leadContactName: 'Lead da Ana', nextStep: 'A1', dueOn: '2026-10-20', ownerName: 'Ana Vendedora', doneAt: null });
    expect((await call(appFor(w.orgId, seller), 'GET', '/followups?scope=team')).status).toBe(403);
    const team = await call(w.app, 'GET', '/followups?scope=team');
    expect(team.json.followups.map((f: { nextStep: string }) => f.nextStep)).toEqual(['A1', 'B1', 'A2']);
    const period = await call(w.app, 'GET', '/followups?scope=team&from=2026-10-21&to=2026-10-31');
    expect(period.json.followups.map((f: { nextStep: string }) => f.nextStep)).toEqual(['B1']);
    expect((await call(w.app, 'GET', '/followups?from=2026-10-31&to=2026-10-01')).status).toBe(400);

    // A colleague cannot see or complete it; the owner can, twice, keeping the first done_at.
    expect((await call(appFor(w.orgId, brunoWho), 'POST', `/followups/${a1.json.followup.id}/done`)).status).toBe(404);
    const done = await call(appFor(w.orgId, seller), 'POST', `/followups/${a1.json.followup.id}/done`);
    expect(done.status).toBe(200);
    const again = await call(appFor(w.orgId, seller), 'POST', `/followups/${a1.json.followup.id}/done`);
    expect(again.json.followup.doneAt).toBe(done.json.followup.doneAt);
    const open = await call(appFor(w.orgId, seller), 'GET', '/followups?scope=mine&status=open');
    expect(open.json.followups.map((f: { nextStep: string }) => f.nextStep)).toEqual(['A2']);
    const doneList = await call(appFor(w.orgId, seller), 'GET', '/followups?scope=mine&status=done');
    expect(doneList.json.followups.map((f: { nextStep: string }) => f.nextStep)).toEqual(['A1']);
  });
});

describe('seller scope and RLS isolation on the new routes', () => {
  it('a seller reads the summary and advances only leads in scope; another org answers 404', async () => {
    const w = await world('scope');
    const other = await world('scope-other');
    const db = getDb();
    const ana = await createPerson(db, w.orgId, PersonSchema.parse({ displayName: 'Ana', isSeller: true }));
    const bruno = await createPerson(db, w.orgId, PersonSchema.parse({ displayName: 'Bruno', isSeller: true }));
    if (typeof ana === 'string' || typeof bruno === 'string') throw new Error('person');
    await sql`UPDATE sales_ops_people SET hub_account_id = 'hub_ana' WHERE id = ${ana.id}`;
    await sql`UPDATE sales_ops_people SET hub_account_id = 'hub_bruno' WHERE id = ${bruno.id}`;
    const anaWho: Who = { userId: 'hub_ana', role: 'seller', name: 'Ana' };
    const brunosLead = await w.create({ sellerPersonId: bruno.id });
    const anasLead = await w.create({ sellerPersonId: ana.id });
    const foreign = await other.create();

    const mineRes = await call(appFor(w.orgId, anaWho), 'GET', `/leads/${anasLead.id}/summary`);
    expect(mineRes.status).toBe(200);
    expect((await call(appFor(w.orgId, anaWho), 'GET', `/leads/${brunosLead.id}/summary`)).status).toBe(404);
    expect((await call(appFor(w.orgId, anaWho), 'POST', `/leads/${brunosLead.id}/advance`, { toStageId: w.stage('Perdido'), reason: 'x' })).status).toBe(404);
    expect((await call(appFor(w.orgId, anaWho), 'POST', `/leads/${brunosLead.id}/notes`, { body: 'x' })).status).toBe(404);
    expect((await call(appFor(w.orgId, anaWho), 'POST', `/leads/${brunosLead.id}/followups`, { nextStep: 'x', dueOn: '2026-10-26' })).status).toBe(404);
    // Org isolation: the id of another org's lead is a plain 404, for an admin too.
    expect((await call(w.app, 'GET', `/leads/${foreign.id}/summary`)).status).toBe(404);
    expect((await call(w.app, 'POST', `/leads/${foreign.id}/advance`, { toStageId: w.stage('Perdido'), reason: 'x' })).status).toBe(404);
    const own = await call(appFor(w.orgId, anaWho), 'POST', `/leads/${anasLead.id}/advance`, { toStageId: w.stage('Qualificação'), nextStep: 'x', dueOn: '2026-10-26' });
    expect(own.status).toBe(200);
    const [events] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM sales_ops_crm_lead_events WHERE lead_id = ${brunosLead.id}`;
    expect(events!.n).toBe(1);
  });
});

describe('period and dynamic filters', () => {
  it('filters on created_at by Sao Paulo civil days: 02:30Z on D+1 is day D, 03:00Z is D+1', async () => {
    const w = await world('period');
    const inside = await w.create({ contactName: 'Dia 20 a noite' });
    const next = await w.create({ contactName: 'Dia 21' });
    const earlier = await w.create({ contactName: 'Dia 19' });
    await sql`UPDATE sales_ops_crm_leads SET created_at = '2026-10-21T02:30:00Z' WHERE id = ${inside.id}`;
    await sql`UPDATE sales_ops_crm_leads SET created_at = '2026-10-21T03:00:00Z' WHERE id = ${next.id}`;
    await sql`UPDATE sales_ops_crm_leads SET created_at = '2026-10-20T02:59:59Z' WHERE id = ${earlier.id}`;
    const names = async (qs: string) => ((await call(w.app, 'GET', `/leads?stageId=${inside.stageId}&${qs}`)).json.leads as Array<{ contactName: string }>).map((l) => l.contactName).sort();
    expect(await names('from=2026-10-20&to=2026-10-20')).toEqual(['Dia 20 a noite']);
    expect(await names('from=2026-10-21&to=2026-10-21')).toEqual(['Dia 21']);
    expect(await names('from=2026-10-19&to=2026-10-19')).toEqual(['Dia 19']);
    expect(await names('from=2026-10-20')).toEqual(['Dia 20 a noite', 'Dia 21']);
    expect(await names('to=2026-10-19')).toEqual(['Dia 19']);
    const summary = await call(w.app, 'GET', '/leads/summary?from=2026-10-20&to=2026-10-20');
    expect(summary.json.stages).toEqual([{ stageId: inside.stageId, count: 1, estimatedValueBrl: 0 }]);
    expect((await call(w.app, 'GET', `/leads?stageId=${inside.stageId}&from=2026-10-21&to=2026-10-20`)).status).toBe(400);
    expect((await call(w.app, 'GET', `/leads?stageId=${inside.stageId}&from=2026-02-30`)).status).toBe(400);
  });

  it('filters by cliente, options and money (min/max); an unknown or non-filterable key is 400', async () => {
    const w = await world('dynamic');
    const db = getDb();
    const alfa = await createClient(db, w.orgId, ClientSchema.parse({ name: 'Alfa' }));
    const beta = await createClient(db, w.orgId, ClientSchema.parse({ name: 'Beta' }));
    await sql`INSERT INTO sales_ops_field_definitions (org_id, key, label, kind, options, filterable, position) VALUES (${w.orgId}, 'origem', 'Origem', 'options', ${JSON.stringify([{ key: 'site', label: 'Site' }, { key: 'indicacao', label: 'Indicação' }])}::jsonb, true, 5)`;
    await sql`INSERT INTO sales_ops_field_definitions (org_id, key, label, kind, filterable, position) VALUES (${w.orgId}, 'verba', 'Verba', 'money', true, 6)`;
    await sql`INSERT INTO sales_ops_field_definitions (org_id, key, label, kind, filterable, position) VALUES (${w.orgId}, 'obs', 'Obs', 'text', false, 7)`;
    const l1 = await w.create({ contactName: 'L1', clientId: alfa.id, fields: [{ key: 'origem', value: 'site' }, { key: 'verba', value: 100000 }, { key: 'obs', value: 'x' }] });
    await w.create({ contactName: 'L2', clientId: beta.id, fields: [{ key: 'origem', value: 'indicacao' }, { key: 'verba', value: 500000 }] });
    const names = async (qs: string) => ((await call(w.app, 'GET', `/leads?stageId=${l1.stageId}&${qs}`)).json.leads as Array<{ contactName: string }>).map((l) => l.contactName).sort();
    expect(await names(`f.cliente=${alfa.id}`)).toEqual(['L1']);
    expect(await names(`f.cliente=${beta.id}`)).toEqual(['L2']);
    expect(await names('f.origem=indicacao')).toEqual(['L2']);
    expect(await names('f.verba.min=200000')).toEqual(['L2']);
    expect(await names('f.verba.max=200000')).toEqual(['L1']);
    expect(await names(`f.verba.min=50000&f.verba.max=600000&f.cliente=${alfa.id}`)).toEqual(['L1']);
    const summary = await call(w.app, 'GET', `/leads/summary?f.cliente=${beta.id}`);
    expect(summary.json.stages).toEqual([{ stageId: l1.stageId, count: 1, estimatedValueBrl: 0 }]);
    for (const qs of ['f.obs=x', 'f.nope=1', 'f.cliente=not-a-uuid', 'f.verba.min=abc', 'f.cliente.min=1', 'f.=1', 'f.origem.min=1']) {
      const res = await call(w.app, 'GET', `/leads?stageId=${l1.stageId}&${qs}`);
      expect(res.status, qs).toBe(400);
      expect(res.json).toMatchObject({ error: 'validation_error', reason: 'invalid_filter' });
    }
  });
});

describe('lead write responses carry the dynamic fields', () => {
  it('POST and PATCH answer the lead with a fields array, null clears and an omitted field stays', async () => {
    const w = await world('wire');
    await sql`INSERT INTO sales_ops_field_definitions (org_id, key, label, kind, position) VALUES (${w.orgId}, 'obs', 'Obs', 'text', 5)`;
    const [def] = await sql<{ id: string }[]>`SELECT id FROM sales_ops_field_definitions WHERE org_id = ${w.orgId} AND key = 'obs'`;
    const created = await call(w.app, 'POST', '/leads', { contactName: 'Ana', contactPhone: '119', fields: [{ fieldId: def!.id, value: 'texto' }] });
    expect(created.status).toBe(201);
    expect(created.json.lead.fields.find((f: { key: string }) => f.key === 'obs')).toEqual({ fieldId: def!.id, key: 'obs', value: 'texto' });
    const id = created.json.lead.id as string;
    const untouched = await call(w.app, 'PATCH', `/leads/${id}`, { contactName: 'Outra' });
    expect(untouched.json.lead.fields.find((f: { key: string }) => f.key === 'obs').value).toBe('texto');
    const cleared = await call(w.app, 'PATCH', `/leads/${id}`, { fields: [{ fieldId: def!.id, value: null }] });
    expect(cleared.json.lead.fields.find((f: { key: string }) => f.key === 'obs').value).toBeNull();
    expect((await call(w.app, 'POST', '/leads', { contactName: 'Sem contato' })).status).toBe(400);
  });
});
```

## Existing tests (diffs)

#### `apps/api/src/domains/crm/__tests__/crm-seed-callers.test.ts` (edit, 6 changed lines)

```diff
diff --git a/apps/api/src/domains/crm/__tests__/crm-seed-callers.test.ts b/apps/api/src/domains/crm/__tests__/crm-seed-callers.test.ts
index 4e8d5b5..a7d8a3f 100644
--- a/apps/api/src/domains/crm/__tests__/crm-seed-callers.test.ts
+++ b/apps/api/src/domains/crm/__tests__/crm-seed-callers.test.ts
@@ -16,7 +16,11 @@ import { describe, expect, it } from 'vitest';
 
 const SRC_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
 const SEED_CALL = /\bensure(DefaultPipeline|SystemFieldDefinitions|CrmDefaults|CrmDefaultsForOrg)\s*\(/;
-const ALLOWED_CALLERS = ['domains/crm/defaults.ts', 'domains/sales-ops/leads/stages-seed.ts'];
+const ALLOWED_CALLERS = [
+  'domains/crm/crm-read-service.ts', // GET /pipelines and GET /field-definitions
+  'domains/crm/defaults.ts',
+  'domains/sales-ops/leads/stages-seed.ts', // the legacy facade: GET /lead-stages, bootstrap, import routes
+];
 
 function walk(dir: string, visited: { count: number }, hits: string[]): void {
   for (const entry of readdirSync(dir, { withFileTypes: true })) {
```

#### `apps/api/src/middleware/__tests__/edition-gate-map.test.ts` (edit, 9 changed lines)

```diff
diff --git a/apps/api/src/middleware/__tests__/edition-gate-map.test.ts b/apps/api/src/middleware/__tests__/edition-gate-map.test.ts
index be26d51..6c443ef 100644
--- a/apps/api/src/middleware/__tests__/edition-gate-map.test.ts
+++ b/apps/api/src/middleware/__tests__/edition-gate-map.test.ts
@@ -163,6 +163,15 @@ const OPEN: readonly RouteCase[] = [
   r('salesOps', 'GET', '/leads/summary', `${SO}/leads/summary`),
   r('salesOps', 'POST', '/leads/:id/delete', `${SO}/leads/${ID}/delete`),
   r('salesOps', 'POST', '/leads/:id/restore', `${SO}/leads/${ID}/restore`),
+  // Phase 2b: the CRM reads, the lead history acts and the follow-ups. Ungated like /leads.
+  r('salesOps', 'GET', '/pipelines', `${SO}/pipelines`),
+  r('salesOps', 'GET', '/field-definitions', `${SO}/field-definitions`),
+  r('salesOps', 'GET', '/leads/:id/summary', `${SO}/leads/${ID}/summary`),
+  r('salesOps', 'POST', '/leads/:id/advance', `${SO}/leads/${ID}/advance`),
+  r('salesOps', 'POST', '/leads/:id/notes', `${SO}/leads/${ID}/notes`),
+  r('salesOps', 'POST', '/leads/:id/followups', `${SO}/leads/${ID}/followups`),
+  r('salesOps', 'GET', '/followups', `${SO}/followups`),
+  r('salesOps', 'POST', '/followups/:id/done', `${SO}/followups/${ID}/done`),
 ];
 
 let app: Hono;
```

#### `apps/api/test/rls/crm-cutover-frozen-tables.test.ts` (edit, 13 changed lines)

```diff
diff --git a/apps/api/test/rls/crm-cutover-frozen-tables.test.ts b/apps/api/test/rls/crm-cutover-frozen-tables.test.ts
index 947e87d..ccb8413 100644
--- a/apps/api/test/rls/crm-cutover-frozen-tables.test.ts
+++ b/apps/api/test/rls/crm-cutover-frozen-tables.test.ts
@@ -58,6 +58,7 @@ describe('the frozen pre-cutover lead tables are never written', () => {
   });
 
   afterAll(async () => {
+    await adminClient`DELETE FROM audit_log WHERE actor_org_id = ${orgId}`;
     await deleteCrmForOrgs([orgId]);
     await adminClient`DELETE FROM sales_ops_lead_products WHERE org_id = ${orgId}`;
     await adminClient`DELETE FROM sales_ops_leads WHERE org_id = ${orgId}`;
@@ -90,30 +91,32 @@ describe('the frozen pre-cutover lead tables are never written', () => {
 
     const stages = await ensureLeadStagesForOrg(db, orgId);
     const novo = stages.find((s) => s.name === 'Novo')!;
-    const negociacao = stages.find((s) => s.name === 'Em negociação')!;
+    const qualificacao = stages.find((s) => s.name === 'Qualificação')!;
     const created = await createLeadStage(db, orgId, LeadStageSchema.parse({ name: 'Diagnóstico' }));
     if (typeof created === 'string') throw new Error('unexpected duplicate');
     await updateLeadStage(db, orgId, created.id, { name: 'Diagnóstico 2' });
     const active = (await ensureLeadStagesForOrg(db, orgId)).filter((s) => s.status === 'active').map((s) => s.id);
-    await reorderLeadStages(db, orgId, [...active].reverse());
 
     const a = await createLead(db, orgId, LeadWriteBaseSchema.parse({ contactName: 'Ana', contactEmail: 'a@x.com', products: [{ productName: 'Livre' }], description: 'd' }), SCOPE);
     if (!a.ok) throw new Error('create refused');
     await updateLead(db, orgId, a.lead.id, LeadPatchSchema.parse({ contactName: 'Ana 2', products: [{ productName: 'Outro' }] }), SCOPE);
-    const moved = await moveLead(db, orgId, a.lead.id, MoveLeadSchema.parse({ stageId: negociacao.id, position: 0 }), SCOPE);
+    const moved = await moveLead(db, orgId, a.lead.id, MoveLeadSchema.parse({ stageId: qualificacao.id, position: 0 }), SCOPE);
     expect(moved.ok).toBe(true);
     expect((await getLead(db, orgId, a.lead.id, SCOPE)).ok).toBe(true);
-    await listLeads(db, orgId, ListLeadsQuerySchema.parse({ stageId: negociacao.id }), SCOPE);
+    await listLeads(db, orgId, ListLeadsQuerySchema.parse({ stageId: qualificacao.id }), SCOPE);
     await summarizeLeadStages(db, orgId, {}, SCOPE);
     expect(await deleteLead(db, orgId, a.lead.id, SCOPE, ACTOR)).toEqual({ ok: true });
     expect((await listDeletedLeads(db, orgId, {})).items).toHaveLength(1);
     expect((await restoreLead(db, orgId, a.lead.id, true, ACTOR)).ok).toBe(true);
 
+    // The reorder comes last: it changes which etapa is the first open one.
+    await reorderLeadStages(db, orgId, [...active].reverse());
     expect(await fingerprint()).toEqual(before);
     expect(await crmCount('sales_ops_crm_leads')).toBe(1);
     expect(await crmCount('sales_ops_pipeline_stages')).toBe(8);
     expect(await crmCount('sales_ops_crm_lead_field_values')).toBeGreaterThan(0);
-    expect(await crmCount('sales_ops_crm_lead_events')).toBe(1);
+    // The initial entry plus the one the move wrote.
+    expect(await crmCount('sales_ops_crm_lead_events')).toBe(2);
     expect(novo.id).toBeDefined();
   });
 });
```

#### `apps/api/test/rls/leads-lixeira.test.ts` (edit, 2 changed lines)

```diff
diff --git a/apps/api/test/rls/leads-lixeira.test.ts b/apps/api/test/rls/leads-lixeira.test.ts
index 7c6dd7a..2b589c6 100644
--- a/apps/api/test/rls/leads-lixeira.test.ts
+++ b/apps/api/test/rls/leads-lixeira.test.ts
@@ -65,6 +65,7 @@ import { createLeadStage, updateLeadStage } from '../../src/domains/sales-ops/le
 import { ensureLeadStagesForOrg } from '../../src/domains/sales-ops/leads/stages-seed.js';
 import { PersonSchema, createPerson } from '../../src/domains/sales-ops/service.js';
 import { deleteCrmForOrgs } from '../../src/db/__tests__/settlement-test-cleanup.js';
+import { walkToConversionDoor } from './lead-path.js';
 
 const { leadsRouter } = await import('../../src/domains/sales-ops/leads/lead-routes.js');
 
@@ -419,6 +420,7 @@ describe('sales operations leads: the lixeira', () => {
       VALUES (${w.orgId}, 1, 'PROP-LIX-1', 'Empresa A', 'Vendedor A', 'pix', 'cash', now(),
               100000, 10, 3, 6, 0, 0, 0)
       RETURNING id`;
+    await walkToConversionDoor(db, w.orgId, lead.id, ADMIN_SCOPE);
     okLead(
       await moveLead(
         db,
```

#### `apps/api/test/rls/leads-seller-scope.test.ts` (edit, 3 changed lines)

```diff
diff --git a/apps/api/test/rls/leads-seller-scope.test.ts b/apps/api/test/rls/leads-seller-scope.test.ts
index fc7a7d0..b47a53c 100644
--- a/apps/api/test/rls/leads-seller-scope.test.ts
+++ b/apps/api/test/rls/leads-seller-scope.test.ts
@@ -48,6 +48,7 @@ import {
 } from '../../src/domains/sales-ops/service.js';
 import { testDatabaseUrls } from '../../src/db/__tests__/test-database-urls.js';
 import { deleteCrmForOrgs } from '../../src/db/__tests__/settlement-test-cleanup.js';
+import { walkToConversionDoor } from './lead-path.js';
 
 const { appUrl: APP_DB_URL, adminUrl: ADMIN_DB_URL } = testDatabaseUrls();
 const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;
@@ -582,6 +583,8 @@ describe('sales operations leads: seller scope, movement and isolation', () => {
 
     const created = await expectOk(createLead(adminDb, orgA, leadPayload(), ADMIN_SCOPE));
     const id = (created as unknown as { lead: { id: string } }).lead.id;
+    // The graph only lets a lead reach Proposta from Em negociação.
+    await walkToConversionDoor(adminDb, orgA, id, ADMIN_SCOPE);
 
     await expect(
       moveLead(
```

#### `apps/api/test/rls/leads-stage-summary.test.ts` (edit, 2 changed lines)

```diff
diff --git a/apps/api/test/rls/leads-stage-summary.test.ts b/apps/api/test/rls/leads-stage-summary.test.ts
index 8aaed22..244835b 100644
--- a/apps/api/test/rls/leads-stage-summary.test.ts
+++ b/apps/api/test/rls/leads-stage-summary.test.ts
@@ -23,6 +23,7 @@ import { deleteLead } from '../../src/domains/sales-ops/leads/lead-trash-service
 import { ensureLeadStagesForOrg } from '../../src/domains/sales-ops/leads/stages-seed.js';
 import { PersonSchema, createPerson } from '../../src/domains/sales-ops/service.js';
 import { deleteCrmForOrgs } from '../../src/db/__tests__/settlement-test-cleanup.js';
+import { walkToConversionDoor } from './lead-path.js';
 
 // Org assertions are made over `adminDb` (where only the service's own org
 // predicate scopes the read); seller assertions are load-bearing over either
@@ -245,6 +246,7 @@ describe('sales operations leads: per-stage summary', () => {
       if (i === 1) brunoId = lead.id;
     }
     const saleId = await insertSale(w.orgId, 'PROP-LSS-1');
+    await walkToConversionDoor(db, w.orgId, unassignedId, ADMIN_SCOPE);
     okLead(
       await moveLead(
         db,
```

#### `apps/api/test/rls/leads-unassigned-claim.test.ts` (edit, 2 changed lines)

```diff
diff --git a/apps/api/test/rls/leads-unassigned-claim.test.ts b/apps/api/test/rls/leads-unassigned-claim.test.ts
index a4a9a3f..5fa33b5 100644
--- a/apps/api/test/rls/leads-unassigned-claim.test.ts
+++ b/apps/api/test/rls/leads-unassigned-claim.test.ts
@@ -25,6 +25,7 @@ import { createLeadStage } from '../../src/domains/sales-ops/leads/stage-service
 import { ensureLeadStagesForOrg } from '../../src/domains/sales-ops/leads/stages-seed.js';
 import { PersonSchema, createPerson } from '../../src/domains/sales-ops/service.js';
 import { deleteCrmForOrgs } from '../../src/db/__tests__/settlement-test-cleanup.js';
+import { walkToConversionDoor } from './lead-path.js';
 
 const { appUrl: APP_DB_URL, adminUrl: ADMIN_DB_URL } = testDatabaseUrls();
 const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;
@@ -664,6 +665,7 @@ describe('sales operations leads: the unassigned pool and claim-on-write', () =>
       VALUES (${w.orgId}, 1, 'PROP-LUC-1', 'Empresa A', 'Vendedor A', 'pix', 'cash', now(),
               100000, 10, 3, 6, 0, 0, 0)
       RETURNING id`;
+    await walkToConversionDoor(db, w.orgId, pool.id, ADMIN_SCOPE);
     expect(
       okLead(
         await moveLead(
```

## Docs

### CLAUDE.md

Edit these bullets (exact old text, then the new text). Use the Edit tool with the old text as `old_string`; if a line differs from the quoted one, STOP and report.

Old (line 313):

```text
- A lead lives in `sales_ops_leads`, never in `sales_ops_sales`, and creating one consumes no proposta code. Leads never enter `/bootstrap`, summaries, the dashboard or `computeSaleFinancials`.
```

New:

```text
- A lead lives in `sales_ops_crm_leads` (the pre-cutover `sales_ops_leads` is a frozen copy no code writes), never in `sales_ops_sales`, and creating one consumes no proposta code. Leads never enter `/bootstrap`, summaries, the dashboard or `computeSaleFinancials`.
```

Old (line 317):

```text
- Lead produtos are a child table (nullable `product_id` plus name snapshot), not `jsonb`.
```

New:

```text
- Lead produtos are the `produtos` field values of the lead (reference Produto: `value_product_id` plus a name snapshot, or `value_text` for a free item), not a child table; the legacy `products` payload key is still accepted and mapped onto them.
```

Old (line 319):

```text
- Etapas follow the funções precedent: org-scoped, `is_system`, ordered, archived never deleted. `Perdido` requires a reason, enforced in both UI and API. The default four are seeded on first read (see Edição Leads).
```

New:

```text
- Etapas live in `sales_ops_pipeline_stages` (org-scoped, ordered, archived never deleted) and `GET /lead-stages` projects the legacy `kind` (`orcamento` -> `conversion`, exit `perdido` -> `lost`, else `normal`) and `isSystem` (`kind <> normal`) from `type`/`exit_kind`; new code reads `type`, `exit_kind`, `behavior`, `requires_reason`. `Perdido` requires a reason, enforced in both UI and API. A new org gets the seven etapas of the default CRM pipeline on first read (see Edição Leads).
```

Old (line 360):

```text
- Leads writes use `ContactLeadFieldsSchema` (strict, `null` or `''` clears an optional) through `createContactLead` / `updateContactLead`, chosen by `leadFieldSet`; the full schemas stay byte-identical and still reject the contact keys.
```

New:

```text
- Lead writes use ONE strict schema, `LeadWriteSchema` (`LeadPatchSchema` for PATCH), through `createLead` / `updateLead`, in BOTH editions: `contactName` plus at least one of `contactPhone`/`contactEmail` on create, `null` or `''` clears an optional, `fields: [{ fieldId | key, value }]` writes dynamic values (`null` clears, an omitted field stays). The spreadsheet import writes through `LeadWriteBaseSchema` (no contact rule). `leadFieldSet` no longer picks a schema.
```

Old (line 361):

```text
  A leads-edition lead MAY carry an empresa (`clientId` resolves the snapshot, else the free-text `clientName`) and a `estimatedValueBrl`; it still stores no produtos. The contact schema rejects `products` and the move/terminal keys.
```

New:

```text
  A lead MAY carry an empresa (`clientId` resolves the snapshot, else the free-text `clientName`), an `estimatedValueBrl` and the legacy `description`, `contactBirthDate`, `products` keys, stored as the `descricao`, `nascimento`, `produtos` field values.
```

Old (line 362):

```text
- The leads edition grants exactly two capabilities, `clients` and `import` (`LEADS_CAPABILITIES` in `sales-edition.ts`); `clients` is its OWN capability split from `catalog`, so `/clients/*` is `requireCapability('clients')` while produtos/areas/funcoes stay `catalog` (403 in leads). Empresa and valor on a lead are carried by the contact schema, NOT by `leadFullFields`.
```

New:

```text
- The leads edition grants exactly two capabilities, `clients` and `import` (`LEADS_CAPABILITIES` in `sales-edition.ts`); `clients` is its OWN capability split from `catalog`, so `/clients/*` is `requireCapability('clients')` while produtos/areas/funcoes stay `catalog` (403 in leads).
```

Old (line 367):

```text
  `GET /lead-stages` (inside `listLeadStages`, same transaction) and `GET /bootstrap` (before the snapshot, via `ensureLeadStagesForOrg`) seed the four default etapas when the org has NO stage row at all.
```

New:

```text
  `GET /lead-stages` (inside `listLeadStages`, same transaction) and `GET /bootstrap` (before the snapshot, via `ensureLeadStagesForOrg`) seed the seven etapas of the default CRM pipeline (through `ensureCrmDefaults`, behind the `stages-seed.ts` facade) when the org has NO pipeline row at all.
```

Old (line 368):

```text
  The guard is "any row", never "each of the four", so a renamed or archived etapa is never reinserted.
```

New:

```text
  The guard is "any row", never "each of the seven", so a renamed or archived etapa is never reinserted.
```

Old (line 376):

```text
- A non-admin vendedor creating a lead in the leads edition sends no `sellerPersonId`: `createContactLead` (only) assigns the caller's own pessoa, the Vendedor picker is hidden for non-admins, and an explicit other id is still `403 seller_scope`.
```

New:

```text
- A non-admin vendedor creating a lead sends no `sellerPersonId` in EITHER edition: `createLead` assigns the caller's own pessoa, the Vendedor picker is hidden for non-admins, and an explicit other id is still `403 seller_scope`.
```

Old (line 88):

```text
  The seed plan gives that org no etapas, no settings row and one UNBOUND vendedor pessoa with `leads-seller`'s email; the first `GET /lead-stages` or `GET /bootstrap` seeds the four default etapas at runtime (see Edição Leads).
```

New:

```text
  The seed plan gives that org no etapas, no settings row and one UNBOUND vendedor pessoa with `leads-seller`'s email; the first `GET /lead-stages` or `GET /bootstrap` seeds the seven default etapas at runtime (see Edição Leads).
```

Then add this new section to `CLAUDE.md` immediately BEFORE the heading `## Integração Sales-Finance (plano de controle)`:

```markdown
## CRM unificado

Full reference: `nexo/knowledge/reference/kanban-de-leads.md` (section CRM unificado, API), `nexo/knowledge/decisions/2026-10-21-crm-unificado-modelo.md`.

- Leads, etapas, history, notes and follow-ups live in the unified tables (`sales_ops_crm_leads`, `sales_ops_pipeline_stages`, `sales_ops_crm_lead_events`, `..._notes`, `..._followups`, `sales_ops_crm_lead_field_values`). `sales_ops_leads`, `sales_ops_lead_products` and `sales_ops_lead_stages` are a FROZEN copy: no product code reads or writes them (`frozen-lead-tables.test.ts`, `crm-cutover-frozen-tables.test.ts`).
- A pipeline is a flowchart: etapas of `type` `normal | orcamento | saida` (exit `ganho | perdido | pausado`) and the explicit `sales_ops_pipeline_transitions` graph; a pair that is absent is not allowed. A cross-stage `POST /leads/:id/move` or `POST /leads/:id/advance` outside the graph answers `409 {"error":"transition_not_allowed"}` (a stage of another pipeline included); a reorder inside one column is always allowed. The spreadsheet import places historical leads with `skipTransitionGraph`.
- The history is written by the SERVER in the same transaction as the stage change: exactly one `stage_changed` event per change (create writes the initial one, a move, an advance and a restore that lands in another etapa write one), the actor name snapshotted from the token. It is NOT an `audit_log` entry.
- `POST /leads/:id/advance { toStageId, nextStep?, dueOn?, note?, reason? }` follows the lock order of `moveLead`; `400 followup_required` unless the destination is an exit (and a half follow-up is refused even on an exit), `400 reason_required` when the destination requires one, `409 sale_required_for_conversion` for an etapa that opens a proposta (the wizard and `POST /sales` own that conversion, and the lead's `sale_id` is still set by `moveLead`).
- Follow-ups: `GET /followups?scope=mine|team&from&to&status=open|done|all` (`team` is admin only, the shared 403 body), `POST /leads/:id/followups`, `POST /followups/:id/done` (idempotent). Their period is on `due_on`, a civil `date`, compared as written.
- Period filters on a timestamp column go through `saoPauloDayRangeToInstants` (`@fxl-sales/shared-utils/sao-paulo-day`): `[from 00:00 -03:00, to+1 00:00 -03:00)`, so a lead created at 02:30Z on day D+1 belongs to day D. Never `slice(0, 10)` of an instant.
- `GET /leads` and `GET /leads/summary` accept `pipelineId`, `from`, `to` and `f.<fieldKey>[.min|.max]` for FILTERABLE definitions only (cliente by id, options by key, text contains, number/money/date by min/max); an unknown, non-filterable or ill-typed key is `400 {"error":"validation_error","reason":"invalid_filter"}`. The summary defaults to the org's default pipeline.
- `GET /pipelines` and `GET /field-definitions` are read-only and seed the org's defaults on first read (registered in `crm-seed-callers.test.ts`). There is no route that creates, edits, archives or deletes a pipeline or a definition, so the Cliente definition (`removable = false`, backed by `client_id`) can never be removed. Onboarding of pipelines and fields is out of scope.
- Tests that create CRM rows delete them with `deleteCrmForOrgs` BEFORE deleting clientes, pessoas, produtos or propostas.

```

### nexo/knowledge/reference/kanban-de-leads.md

Append at the END of the file this section (keep one sentence per line):

```markdown

## CRM unificado, API (2026-10-21, vendas-crm-unificado phase 2)

This section records the server rules that replaced the single-table lead model.
The tables, the migrations 0029 to 0031 and the decisions are in `nexo/knowledge/decisions/2026-10-21-crm-unificado-modelo.md`.

- The cut-over moved every lead and etapa reader and writer to the unified tables.
  The three old tables stay as a frozen copy, and migration 0031 resyncs what they received after 0030 (rows changed last in the old table win, removals are not mirrored).
- One write schema serves both editions.
  The old "full" and "contact" contracts collapsed into `LeadWriteSchema`; the edition no longer picks a schema, it only travels in the scope for the leads-edition seller auto-provision until the org modules replace it.
- A non-admin seller who names no vendedor files the lead as their own in both editions (the full edition used to answer `403 seller_scope`).
- The default pipeline has seven etapas (Novo, Qualificação, Em negociação, Proposta, Ganho, Perdido, Pausado) and 22 transitions.
  A new etapa created through `POST /lead-stages` is an ordinary open etapa and receives the transitions the shared rule gives it; a reorder never regenerates the graph.
- Moves: cross-stage moves must be an edge of the graph (`409 transition_not_allowed`), a same-column reorder is free and writes no event.
  Every stage change writes one history event in the same transaction; the actor name is the token name, then the e-mail, then null.
- Avançar adds the human layer on top of the move: próximo passo plus date (a follow-up) unless the destination is an exit, a reason where the etapa requires it, an optional note linked to the event.
- Why `409 sale_required_for_conversion` on Avançar: the proposta wizard owns the conversion, so an etapa of type `orcamento` is entered through `POST /leads/:id/move` with the `saleId` the wizard got from `POST /sales`.
- Period filters are civil days in `America/Sao_Paulo`.
  Brazil has no daylight saving time since 2019, so a Sao Paulo midnight is 03:00Z; the helper is fixed-offset and documents that it is not meant for dates before 2019.
  The proposta list has no server route (the web filters the bootstrap by `created_at` for open propostas and `won_at` for won ones with the same civil-day rule), so there is no proposta period filter on the API.
- Oracles: `crm-cutover-resync.test.ts`, `crm-cutover-frozen-tables.test.ts`, `crm-lead-write-fields.test.ts`, `crm-pipeline-history.test.ts`, `lead-write-contract.test.ts`, `frozen-lead-tables.test.ts`.

```
