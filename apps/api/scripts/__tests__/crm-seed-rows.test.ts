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
