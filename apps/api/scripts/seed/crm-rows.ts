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
