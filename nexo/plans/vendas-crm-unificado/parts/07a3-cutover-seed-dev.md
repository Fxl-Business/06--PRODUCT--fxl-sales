# Part 07a3-cutover-seed-dev of slice 07a-api-crm-cutover

Not a slice: no frontmatter. Depends on part 07a2.

## What this part does

`apps/api/scripts/seed-dev.ts` stops inserting into `sales_ops_lead_stages`, `sales_ops_leads` and `sales_ops_lead_products` and writes the same rows into the unified tables through the new pure adapter. The pure plan (`scripts/seed/plan.ts`) and `seed-plan.test.ts` are NOT edited. The local-database guard rules of `seed-dev.ts` stay: the adapter is loaded with `await import(...)` inside `main()`, never as a static import.

## Steps

1. TDD: create `apps/api/scripts/__tests__/crm-seed-rows.test.ts` (below); run it: fails (missing module).
2. Create `apps/api/scripts/seed/crm-rows.ts`.
3. Apply the `seed-dev.ts` diff with `git apply --whitespace=nowarn`.
4. Run the commands. Then, only if a local Docker database is up and `apps/api/.env` points at it, run `pnpm --filter @fxl-sales/api db:seed:dev` twice (idempotent) and check `select count(*) from sales_ops_crm_leads` is 6 for the full-edition fixture org and the three old tables received no insert.

## Tests

`crm-seed-rows.test.ts`: `projects the etapas keeping their ids, adds Ganho and Pausado, and builds the graph from the shared rule` (16 transitions for the four-etapa legacy shape); `keeps every lead with its id, value and etapa, with one first event each and descricao and produtos values`; `is null for an org with no etapa (the leads-edition fixture)`.

## Commands

- Oracle: `pnpm --filter @fxl-sales/api exec vitest run scripts/__tests__/crm-seed-rows.test.ts scripts/__tests__/seed-plan.test.ts`
- `pnpm --filter @fxl-sales/api exec tsc --noEmit -p tsconfig.scripts.json`; `pnpm --filter @fxl-sales/api lint`
- Guard: `node --test scripts/__tests__/local-database-guard.test.mjs`

## Code

#### `apps/api/scripts/seed/crm-rows.ts` (new file)

Create the file with exactly this content.

```ts
/**
 * The dev seed's unified CRM rows (phase 2 cutover, slice 07a3).
 *
 * `buildDevSeedPlan` still describes etapas, leads and lead produtos in the pre-cutover vocabulary
 * (its pure plan and its tests stay as they are). Nothing writes the three old tables any more, so
 * `seed-dev.ts` materializes those plan rows into the unified tables through this PURE adapter:
 * one default pipeline per org that has etapas, the plan's etapas keeping their ids plus the Ganho
 * and Pausado exits migration 0030 adds, the transition graph from the shared rule, the field
 * definitions the data needs, and for every lead the row, its descricao and produtos values and its
 * first history event.
 *
 * An org with no etapa (the leads-edition fixture) yields `null`: it is seeded on first read.
 * No database, no clock, no environment.
 */
import { DEFAULT_PIPELINE_KEY, DEFAULT_PIPELINE_NAME } from '@fxl-sales/shared-utils/default-pipeline';
import { planPipelineTransitions, type TransitionPlanStage } from '@fxl-sales/shared-utils/crm-model';
import { deterministicUuid, type LeadProductRow, type LeadRow, type LeadStageRow } from './plan.js';

export interface CrmSeedRows {
  pipeline: { id: string; orgId: string; name: string; systemKey: string; position: number; isDefault: boolean };
  stages: Array<{
    id: string;
    orgId: string;
    pipelineId: string;
    name: string;
    position: number;
    type: 'normal' | 'orcamento' | 'saida';
    behavior: 'none' | 'opens_orcamentos';
    exitKind: 'ganho' | 'perdido' | 'pausado' | null;
    requiresReason: boolean;
    status: 'active' | 'archived';
    archivedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  transitions: Array<{ orgId: string; pipelineId: string; fromStageId: string; toStageId: string }>;
  fields: Array<{
    id: string;
    orgId: string;
    key: string;
    label: string;
    kind: 'reference' | 'text';
    referenceTarget: 'cliente' | 'produto' | null;
    multiple: boolean;
    filterable: boolean;
    isSystem: boolean;
    removable: boolean;
    backingColumn: string | null;
    position: number;
  }>;
  leads: Array<{
    id: string;
    orgId: string;
    contactName: string;
    pipelineId: string;
    stageId: string;
    position: number;
    stageChangedAt: Date;
    sellerPersonId: string | null;
    sellerNameSnapshot: string;
    clientId: string | null;
    clientNameSnapshot: string;
    estimatedValueBrl: number;
    lostReason: string | null;
    saleId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  values: Array<{
    orgId: string;
    leadId: string;
    fieldId: string;
    position: number;
    valueText: string | null;
    valueProductId: string | null;
    refNameSnapshot: string | null;
  }>;
  events: Array<{
    orgId: string;
    leadId: string;
    kind: 'stage_changed';
    fromStageId: null;
    toStageId: string;
    reason: string | null;
    actorUserId: string;
    actorNameSnapshot: string;
    occurredAt: Date;
  }>;
}

const typeOf = (kind: LeadStageRow['kind']) => (kind === 'conversion' ? 'orcamento' : kind === 'lost' ? 'saida' : 'normal');

export function buildCrmSeedRows(
  orgId: string,
  stages: readonly LeadStageRow[],
  leads: readonly LeadRow[],
  leadProducts: readonly LeadProductRow[],
): CrmSeedRows | null {
  const orgStages = stages.filter((stage) => stage.orgId === orgId);
  if (orgStages.length === 0) return null;
  const orgLeads = leads.filter((lead) => lead.orgId === orgId);
  const orgProducts = leadProducts.filter((row) => row.orgId === orgId);

  const pipelineId = deterministicUuid(`${orgId}:pipeline:${DEFAULT_PIPELINE_KEY}`);
  const rows = orgStages.map((stage) => ({
    id: stage.id,
    orgId,
    pipelineId,
    name: stage.name,
    position: stage.position,
    type: typeOf(stage.kind) as 'normal' | 'orcamento' | 'saida',
    behavior: (stage.kind === 'conversion' ? 'opens_orcamentos' : 'none') as 'none' | 'opens_orcamentos',
    exitKind: (stage.kind === 'lost' ? 'perdido' : null) as 'perdido' | null,
    requiresReason: stage.kind === 'lost',
    status: stage.status,
    archivedAt: stage.archivedAt ? new Date(stage.archivedAt) : null,
    createdAt: new Date(stage.createdAt),
    updatedAt: new Date(stage.updatedAt),
  }));
  // The two exits migration 0030 adds to a legacy-shaped org, after the highest position.
  const top = Math.max(...orgStages.map((stage) => stage.position));
  const extra = (key: 'ganho' | 'pausado', name: string, offset: number) => ({
    id: deterministicUuid(`${orgId}:stage:${key}`),
    orgId,
    pipelineId,
    name,
    position: top + offset,
    type: 'saida' as const,
    behavior: 'none' as const,
    exitKind: key,
    requiresReason: false,
    status: 'active' as const,
    archivedAt: null,
    createdAt: new Date(orgStages[0]!.createdAt),
    updatedAt: new Date(orgStages[0]!.updatedAt),
  });
  const allStages = [...rows, extra('ganho', 'Ganho', 1), extra('pausado', 'Pausado', 2)] as CrmSeedRows['stages'];

  const plan: TransitionPlanStage[] = allStages.map((stage) => ({
    id: stage.id,
    name: stage.name,
    position: stage.position,
    type: stage.type,
    exitKind: stage.exitKind,
    status: stage.status,
  }));
  const transitions = planPipelineTransitions(plan).map(([fromStageId, toStageId]) => ({ orgId, pipelineId, fromStageId, toStageId }));

  const fieldId = (key: string) => deterministicUuid(`${orgId}:field:${key}`);
  const fields: CrmSeedRows['fields'] = [
    { id: fieldId('cliente'), orgId, key: 'cliente', label: 'Cliente', kind: 'reference', referenceTarget: 'cliente', multiple: false, filterable: true, isSystem: true, removable: false, backingColumn: 'client_id', position: 1 },
  ];
  if (orgProducts.length > 0) {
    fields.push({ id: fieldId('produtos'), orgId, key: 'produtos', label: 'Produtos', kind: 'reference', referenceTarget: 'produto', multiple: true, filterable: true, isSystem: false, removable: true, backingColumn: null, position: 2 });
  }
  if (orgLeads.some((lead) => lead.description !== null)) {
    fields.push({ id: fieldId('descricao'), orgId, key: 'descricao', label: 'Descrição', kind: 'text', referenceTarget: null, multiple: false, filterable: false, isSystem: false, removable: true, backingColumn: null, position: 3 });
  }

  const values: CrmSeedRows['values'] = [];
  for (const lead of orgLeads) {
    if (lead.description !== null) {
      values.push({ orgId, leadId: lead.id, fieldId: fieldId('descricao'), position: 0, valueText: lead.description, valueProductId: null, refNameSnapshot: null });
    }
    orgProducts
      .filter((row) => row.leadId === lead.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .forEach((row, position) => {
        values.push({
          orgId,
          leadId: lead.id,
          fieldId: fieldId('produtos'),
          position,
          valueText: row.productId === null ? row.productNameSnapshot : null,
          valueProductId: row.productId,
          refNameSnapshot: row.productNameSnapshot,
        });
      });
  }

  return {
    pipeline: { id: pipelineId, orgId, name: DEFAULT_PIPELINE_NAME, systemKey: DEFAULT_PIPELINE_KEY, position: 0, isDefault: true },
    stages: allStages,
    transitions,
    fields,
    leads: orgLeads.map((lead) => ({
      id: lead.id,
      orgId,
      contactName: lead.contactName,
      pipelineId,
      stageId: lead.stageId,
      position: lead.position,
      stageChangedAt: new Date(lead.stageChangedAt),
      sellerPersonId: lead.sellerPersonId,
      sellerNameSnapshot: lead.sellerNameSnapshot,
      clientId: lead.clientId,
      clientNameSnapshot: lead.clientNameSnapshot,
      estimatedValueBrl: lead.estimatedValueBrl,
      lostReason: lead.lostReason,
      saleId: lead.saleId,
      createdAt: new Date(lead.createdAt),
      updatedAt: new Date(lead.updatedAt),
    })),
    values,
    events: orgLeads.map((lead) => ({
      orgId,
      leadId: lead.id,
      kind: 'stage_changed' as const,
      fromStageId: null,
      toStageId: lead.stageId,
      reason: lead.lostReason,
      actorUserId: 'system',
      actorNameSnapshot: 'Seed de desenvolvimento',
      occurredAt: new Date(lead.stageChangedAt),
    })),
  };
}
```

#### `apps/api/scripts/__tests__/crm-seed-rows.test.ts` (new file)

Create the file with exactly this content.

```ts
import { planPipelineTransitions, type TransitionPlanStage } from '@fxl-sales/shared-utils/crm-model';
import { describe, expect, it } from 'vitest';
import { buildCrmSeedRows } from '../seed/crm-rows.js';
import { buildDevSeedPlan, type SeedIdentity } from '../seed/plan.js';

/**
 * The dev seed's unified CRM rows (slice 07a3): a pure projection of the plan's pre-cutover rows.
 */
const ORGS = ['org_fake_alpha', 'org_fake_beta'];
const IDENTITIES: SeedIdentity[] = [
  { accountId: 'acct_owner', workspaceIds: [ORGS[0]!], workspaceRole: 'owner', productRoles: [], name: 'Owner Test', email: 'owner@test.local' },
  { accountId: 'acct_adminseller', workspaceIds: ORGS, workspaceRole: 'member', productRoles: ['admin', 'seller'], name: 'Admin Seller Test', email: 'adminseller@test.local' },
];

function plan() {
  return buildDevSeedPlan({ orgIds: ORGS, identities: IDENTITIES, cutoff: { iso: '2026-09-01', year: 2026, month: 9, day: 1 } });
}

describe('buildCrmSeedRows', () => {
  it('projects the etapas keeping their ids, adds Ganho and Pausado, and builds the graph from the shared rule', () => {
    const p = plan();
    const orgId = ORGS[0]!;
    const crm = buildCrmSeedRows(orgId, p.rows.salesOpsLeadStages, p.rows.salesOpsLeads, p.rows.salesOpsLeadProducts)!;
    const legacy = p.rows.salesOpsLeadStages.filter((s) => s.orgId === orgId);
    expect(legacy).toHaveLength(4);
    for (const stage of legacy) expect(crm.stages.find((s) => s.id === stage.id)).toBeDefined();
    expect(crm.stages.map((s) => [s.name, s.type, s.exitKind, s.requiresReason])).toEqual([
      ['Novo', 'normal', null, false],
      ['Em negociação', 'normal', null, false],
      ['Proposta', 'orcamento', null, false],
      ['Perdido', 'saida', 'perdido', true],
      ['Ganho', 'saida', 'ganho', false],
      ['Pausado', 'saida', 'pausado', false],
    ]);
    const plan2: TransitionPlanStage[] = crm.stages.map((s) => ({ id: s.id, name: s.name, position: s.position, type: s.type, exitKind: s.exitKind, status: s.status }));
    expect(crm.transitions).toHaveLength(planPipelineTransitions(plan2).length);
    expect(crm.transitions).toHaveLength(16);
  });

  it('keeps every lead with its id, value and etapa, with one first event each and descricao and produtos values', () => {
    const p = plan();
    const orgId = ORGS[0]!;
    const crm = buildCrmSeedRows(orgId, p.rows.salesOpsLeadStages, p.rows.salesOpsLeads, p.rows.salesOpsLeadProducts)!;
    const legacy = p.rows.salesOpsLeads.filter((l) => l.orgId === orgId);
    expect(crm.leads.map((l) => [l.id, l.stageId, l.estimatedValueBrl, l.saleId])).toEqual(
      legacy.map((l) => [l.id, l.stageId, l.estimatedValueBrl, l.saleId]),
    );
    expect(crm.events).toHaveLength(legacy.length);
    expect(crm.values.filter((v) => v.valueText !== null || v.valueProductId !== null).length).toBeGreaterThan(0);
    expect(new Set(crm.fields.map((f) => f.key))).toEqual(new Set(['cliente', 'produtos', 'descricao']));
    const free = crm.values.find((v) => v.valueProductId === null && v.refNameSnapshot === 'Site institucional');
    expect(free?.valueText).toBe('Site institucional');
  });

  it('is null for an org with no etapa (the leads-edition fixture)', () => {
    const p = plan();
    expect(buildCrmSeedRows('org_without', p.rows.salesOpsLeadStages, p.rows.salesOpsLeads, p.rows.salesOpsLeadProducts)).toBeNull();
  });
});
```

#### `apps/api/scripts/seed-dev.ts` (edit, 57 changed lines)

```diff
diff --git a/apps/api/scripts/seed-dev.ts b/apps/api/scripts/seed-dev.ts
index b014fea..cc3fca9 100644
--- a/apps/api/scripts/seed-dev.ts
+++ b/apps/api/scripts/seed-dev.ts
@@ -36,9 +36,6 @@ import type {
   ClientRow,
   DevSeedPlan,
   FuncaoRow,
-  LeadProductRow,
-  LeadRow,
-  LeadStageRow,
   PayableRow,
   PersonFuncaoRow,
   PersonRow,
@@ -181,15 +178,6 @@ function toProductFuncaoCostInsert(row: ProductFuncaoCostRow) {
   return { ...row, createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt) };
 }
 
-function toLeadStageInsert(row: LeadStageRow) {
-  return {
-    ...row,
-    archivedAt: row.archivedAt ? new Date(row.archivedAt) : null,
-    createdAt: new Date(row.createdAt),
-    updatedAt: new Date(row.updatedAt),
-  };
-}
-
 function toSaleInsert(row: SaleRow) {
   return {
     ...row,
@@ -221,19 +209,6 @@ function toSettlementInsert(row: SettlementRow) {
   return { ...row, recordedAt: new Date(row.recordedAt) };
 }
 
-function toLeadInsert(row: LeadRow) {
-  return {
-    ...row,
-    stageChangedAt: new Date(row.stageChangedAt),
-    createdAt: new Date(row.createdAt),
-    updatedAt: new Date(row.updatedAt),
-  };
-}
-
-function toLeadProductInsert(row: LeadProductRow) {
-  return { ...row, createdAt: new Date(row.createdAt) };
-}
-
 async function main(): Promise<void> {
   assertOrderMatches(SEED_DELETE_ORDER, EXPECTED_DELETE_ORDER, 'SEED_DELETE_ORDER');
   assertOrderMatches(SEED_WRITE_ORDER, EXPECTED_WRITE_ORDER, 'SEED_WRITE_ORDER');
@@ -315,6 +290,7 @@ async function main(): Promise<void> {
   const { withTenant } = await import('../src/domains/sales-ops/service.js');
   const schema = await import('../src/db/schema.js');
   const { eq, sql } = await import('drizzle-orm');
+  const { buildCrmSeedRows } = await import('./seed/crm-rows.js');
 
   const db = getDb();
 
@@ -426,11 +402,6 @@ async function main(): Promise<void> {
           .values(orgProductFuncaoCosts.map(toProductFuncaoCostInsert));
       }
 
-      const orgLeadStages = plan.rows.salesOpsLeadStages.filter((row) => row.orgId === orgId);
-      if (orgLeadStages.length > 0) {
-        await tx.insert(schema.salesOpsLeadStages).values(orgLeadStages.map(toLeadStageInsert));
-      }
-
       const orgSales = plan.rows.salesOpsSales.filter((row) => row.orgId === orgId);
       if (orgSales.length > 0) {
         await tx.insert(schema.salesOpsSales).values(orgSales.map(toSaleInsert));
@@ -467,16 +438,24 @@ async function main(): Promise<void> {
           .values(orgSettlements.map(toSettlementInsert));
       }
 
-      const orgLeads = plan.rows.salesOpsLeads.filter((row) => row.orgId === orgId);
-      if (orgLeads.length > 0) {
-        await tx.insert(schema.salesOpsLeads).values(orgLeads.map(toLeadInsert));
-      }
-
-      const orgLeadProducts = plan.rows.salesOpsLeadProducts.filter(
-        (row) => row.orgId === orgId,
+      // The plan still speaks the pre-cutover vocabulary (etapas, leads, lead produtos); since the
+      // phase 2 cutover those rows are written into the UNIFIED CRM tables only, through the pure
+      // adapter. The three old tables are never inserted into. They come after the propostas
+      // because a lead references its proposta.
+      const crm = buildCrmSeedRows(
+        orgId,
+        plan.rows.salesOpsLeadStages,
+        plan.rows.salesOpsLeads,
+        plan.rows.salesOpsLeadProducts,
       );
-      if (orgLeadProducts.length > 0) {
-        await tx.insert(schema.salesOpsLeadProducts).values(orgLeadProducts.map(toLeadProductInsert));
+      if (crm) {
+        await tx.insert(schema.salesOpsPipelines).values(crm.pipeline);
+        await tx.insert(schema.salesOpsPipelineStages).values(crm.stages);
+        await tx.insert(schema.salesOpsPipelineTransitions).values(crm.transitions);
+        await tx.insert(schema.salesOpsFieldDefinitions).values(crm.fields);
+        if (crm.leads.length > 0) await tx.insert(schema.salesOpsCrmLeads).values(crm.leads);
+        if (crm.values.length > 0) await tx.insert(schema.salesOpsCrmLeadFieldValues).values(crm.values);
+        if (crm.events.length > 0) await tx.insert(schema.salesOpsCrmLeadEvents).values(crm.events);
       }
     });
   }
```
