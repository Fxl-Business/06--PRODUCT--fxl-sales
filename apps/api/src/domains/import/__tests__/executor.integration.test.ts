/**
 * Slice 06 oracles: executeImportPlan on the local test DB (tenant role, RLS live).
 * Fixtures are seeded and cleaned through getAdminDb(). Orgs are seeded the way the
 * import routes do (ensureLeadStages + ensureSystemFuncoes in a separate committed
 * transaction) and the seeds are referenced by { existingId }. Audit entries are scoped by a
 * fresh org id and removed per org in cleanup.
 *
 * Run: pnpm --filter @fxl-sales/api test:integration src/domains/import/__tests__/executor.integration.test.ts
 */
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { deleteSettlementsForOrgs } from '../../../db/__tests__/settlement-test-cleanup.js';
import { closeDb, getAdminDb, getDb } from '../../../db/client.js';
import {
  auditLog,
  salesOpsAreas,
  salesOpsClients,
  salesOpsFuncoes,
  salesOpsLeadProducts,
  salesOpsLeadStages,
  salesOpsLeads,
  salesOpsPayables,
  salesOpsPeople,
  salesOpsPersonFuncoes,
  salesOpsProductFuncaoCosts,
  salesOpsProducts,
  salesOpsReceivables,
  salesOpsSaleItems,
  salesOpsSaleProfessionals,
  salesOpsSales,
  salesOpsSettings,
  salesOpsSettlements,
} from '../../../db/schema.js';
import { registerProducerFlowGate } from '../../integration/producer-gate.js';
import { asDateOnly } from '../../sales-ops/ledger-dates.js';
import { ensureLeadStages } from '../../sales-ops/leads/stages-seed.js';
import { createArea, ensureSystemFuncoes, withTenant } from '../../sales-ops/service.js';
import { ImportExecutionError, executeImportPlan } from '../executor.js';
import type { ImportOperation, ImportPlan, SaleDraft } from '../types.js';

const ACTOR = { userId: 'hub-account-import-1', displayName: 'Equipe FXL' };
const NOW = new Date('2026-06-01T15:00:00.000Z');
const seededOrgIds: string[] = [];

const COUNT_TABLES = [
  'sales_ops_areas',
  'sales_ops_funcoes',
  'sales_ops_products',
  'sales_ops_product_funcao_costs',
  'sales_ops_people',
  'sales_ops_person_funcoes',
  'sales_ops_clients',
  'sales_ops_lead_stages',
  'sales_ops_leads',
  'sales_ops_lead_products',
  'sales_ops_sales',
  'sales_ops_sale_items',
  'sales_ops_sale_professionals',
  'sales_ops_receivables',
  'sales_ops_payables',
  'sales_ops_settlements',
] as const;

function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('expected a row, got undefined');
  return v;
}

function newOrg(tag: string): string {
  const orgId = `org_imp_${tag}_${randomUUID()}`;
  seededOrgIds.push(orgId);
  return orgId;
}

const run = (orgId: string, plan: ImportPlan) =>
  withTenant(getDb(), orgId, (tx) => executeImportPlan(tx, orgId, plan, ACTOR, NOW));

async function countOf(query: ReturnType<typeof sql>): Promise<number> {
  const result = (await getAdminDb().execute(query)) as unknown as Array<{ n: number }>;
  return Number(must(result[0]).n);
}

async function snapshot(orgId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of COUNT_TABLES) {
    out[table] = await countOf(
      sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)} WHERE org_id = ${orgId}`,
    );
  }
  out.audit_log = await countOf(sql`SELECT count(*)::int AS n FROM audit_log WHERE actor_org_id = ${orgId}`);
  out.integration_outbox = await countOf(
    sql`SELECT count(*)::int AS n FROM integration_outbox WHERE organization_id = ${orgId}`,
  );
  return out;
}

type Seeded = { orgId: string; areaId: string; vendedorId: string; perdidoId: string };

/** Seeds like the routes do (committed, separate transaction), plus one existing area. */
async function seededOrg(tag: string): Promise<Seeded> {
  const orgId = newOrg(tag);
  await withTenant(getDb(), orgId, async (tx) => {
    await ensureLeadStages(tx, orgId);
    await ensureSystemFuncoes(tx, orgId);
  });
  const area = await createArea(getDb(), orgId, { name: 'Área Existente', status: 'active' });
  if (area === 'duplicate') throw new Error('unexpected duplicate area');
  const admin = getAdminDb();
  const [vendedor] = await admin
    .select({ id: salesOpsFuncoes.id })
    .from(salesOpsFuncoes)
    .where(and(eq(salesOpsFuncoes.orgId, orgId), eq(salesOpsFuncoes.slug, 'vendedor')));
  const [perdido] = await admin
    .select({ id: salesOpsLeadStages.id })
    .from(salesOpsLeadStages)
    .where(and(eq(salesOpsLeadStages.orgId, orgId), eq(salesOpsLeadStages.kind, 'lost')));
  return { orgId, areaId: area.id, vendedorId: must(vendedor).id, perdidoId: must(perdido).id };
}

const PRODUCT_INPUT = {
  name: 'Produto Importado',
  kind: 'product',
  codeSuffix: '7',
  setupBrl: 300000,
  hasMonthly: false,
  monthlyBrl: 0,
  recurringCommission: false,
  hasFinderCommission: false,
  sellerCommissionType: 'pct',
  sellerCommissionValue: 10,
  finderCommissionType: 'pct',
  finderCommissionValue: 3,
  defaultPaymentMethod: 'pix',
  defaultEntradaMode: 'none',
  defaultEntradaPct: null,
  defaultEntradaBrl: null,
  defaultRemainingInstallments: 1,
  defaultRecurringCycles: null,
  modules: [],
  providers: [],
  status: 'active',
} as const;

const cliente = { planKey: 'clientes:2' };
const pessoa = { planKey: 'pessoas:2' };
const produto = { planKey: 'produtos:2' };
const funcao = { planKey: 'funcoes:2' };
const etapa = { planKey: 'etapas:2' };

function draft(overrides: Partial<SaleDraft>): SaleDraft {
  return {
    clientRef: cliente,
    clientName: 'Cliente Importado',
    sellerRef: pessoa,
    sellerName: 'Ana Importada',
    finderRef: null,
    finderName: null,
    status: 'open',
    baseDate: '2026-03-01',
    notes: null,
    sellerCommissionPct: 10,
    finderCommissionPct: 0,
    taxPct: 6,
    otherCostsBrl: 0,
    items: [],
    professionals: [],
    installments: [],
    recurring: null,
    ...overrides,
  } as SaleDraft;
}

function fullOperations(s: Seeded): ImportOperation[] {
  return [
    { op: 'createArea', planKey: 'areas:2', input: { name: 'Área Importada', status: 'active' } },
    { op: 'createFuncao', planKey: 'funcoes:2', input: { name: 'Consultor', status: 'active' } },
    {
      op: 'createProduct',
      planKey: 'produtos:2',
      input: { ...PRODUCT_INPUT } as never,
      areaRef: { planKey: 'areas:2' },
      funcaoCosts: [{ funcaoRef: funcao, cost: { mode: 'pct', valuePct: 5 } as never }],
    },
    {
      op: 'createPerson',
      planKey: 'pessoas:2',
      input: { displayName: 'Ana Importada', contactEmail: 'ana.importada@example.com', status: 'active' } as never,
      funcaoRefs: [{ existingId: s.vendedorId }, funcao],
    },
    {
      op: 'createClient',
      planKey: 'clientes:2',
      input: { name: 'Cliente Importado', document: '12.345.678/0001-90' } as never,
    },
    { op: 'createLeadStage', planKey: 'etapas:2', input: { name: 'Diagnóstico', status: 'active' } as never },
    {
      op: 'createLead',
      planKey: 'leads:2',
      input: { contactName: 'Bruno', clientName: 'Cliente Importado', estimatedValueBrl: 120000 } as never,
      clientRef: cliente,
      sellerRef: pessoa,
      products: [{ productRef: produto, name: 'Produto Importado' }],
      stageRef: etapa,
      lostReason: null,
    },
    {
      op: 'createLead',
      planKey: 'leads:3',
      input: { contactName: 'Carla', clientName: 'Empresa Livre', estimatedValueBrl: 0 } as never,
      clientRef: null,
      sellerRef: null,
      products: [{ productRef: null, name: 'Consultoria avulsa' }],
      stageRef: { existingId: s.perdidoId },
      lostReason: 'Sem orçamento',
    },
    {
      op: 'createLead',
      planKey: 'leads:4',
      input: { contactName: 'Diego', clientName: 'Cliente Importado', estimatedValueBrl: 0 } as never,
      clientRef: cliente,
      sellerRef: pessoa,
      products: [],
      stageRef: etapa,
      lostReason: null,
    },
    {
      op: 'createSale',
      planKey: 'propostas:2',
      wonOn: '2026-03-10',
      input: draft({
        status: 'won',
        otherCostsBrl: 10000,
        items: [{ productRef: produto, areaRef: null, productName: 'Produto Importado', quantity: 1, unitBrl: 300000 }],
        professionals: [
          { personRef: pessoa, funcaoRef: funcao, personName: 'Ana Importada', costBrl: 40000, costSplitBp: null },
        ],
        installments: [
          { dueDate: '2026-03-10', amountBrl: 150000, method: 'pix' },
          { dueDate: '2026-04-10', amountBrl: 150000, method: 'pix' },
        ],
      } as Partial<SaleDraft>),
    },
    {
      op: 'createSale',
      planKey: 'propostas:3',
      wonOn: null,
      input: draft({
        items: [
          {
            productRef: null,
            areaRef: { existingId: s.areaId },
            productName: 'Diagnóstico avulso',
            quantity: 1,
            unitBrl: 50000,
          },
        ],
        installments: [{ dueDate: '2026-05-01', amountBrl: 50000, method: 'boleto' }],
      } as Partial<SaleDraft>),
    },
    {
      op: 'createSale',
      planKey: 'propostas:4',
      wonOn: null,
      input: draft({
        status: 'draft',
        items: [{ productRef: produto, areaRef: null, productName: 'Produto Importado', quantity: 1, unitBrl: 300000 }],
        installments: [{ dueDate: '2026-05-10', amountBrl: 300000, method: 'pix' }],
      } as Partial<SaleDraft>),
    },
    { op: 'transitionSale', saleKey: 'propostas:3', to: 'lost' },
    { op: 'transitionSale', saleKey: 'propostas:4', to: 'cancelled' },
    {
      op: 'settleReceivable',
      saleKey: 'propostas:2',
      receivableLabel: '1/2',
      paidOn: '2026-03-15',
      settlePayables: true,
    },
  ];
}

const FULL_COUNTS = {
  areas: 1,
  funcoes: 1,
  produtos: 1,
  custosProduto: 1,
  pessoas: 1,
  clientes: 1,
  etapas: 1,
  leads: 3,
  propostas: 3,
  pagamentos: 1,
};

const fullPlan = (s: Seeded): ImportPlan => ({
  operations: fullOperations(s),
  issues: [],
  counts: { ...FULL_COUNTS },
});

afterEach(async () => {
  registerProducerFlowGate(() => false);
  await deleteSettlementsForOrgs(seededOrgIds);
  const admin = getAdminDb();
  for (const orgId of seededOrgIds) {
    await admin.execute(sql`DELETE FROM integration_outbox WHERE organization_id = ${orgId}`);
    // Same precedent as the other audit tests: chain-order oracles (conversion-ingest) need
    // the global chain free of leftovers, so each test removes its own org's entries.
    await admin.execute(sql`DELETE FROM audit_log WHERE actor_org_id = ${orgId}`);
    await admin.delete(salesOpsLeadProducts).where(eq(salesOpsLeadProducts.orgId, orgId));
    await admin.delete(salesOpsLeads).where(eq(salesOpsLeads.orgId, orgId));
    await admin.delete(salesOpsLeadStages).where(eq(salesOpsLeadStages.orgId, orgId));
    await admin.delete(salesOpsPayables).where(eq(salesOpsPayables.orgId, orgId));
    await admin.delete(salesOpsReceivables).where(eq(salesOpsReceivables.orgId, orgId));
    await admin.delete(salesOpsSaleItems).where(eq(salesOpsSaleItems.orgId, orgId));
    await admin.delete(salesOpsSaleProfessionals).where(eq(salesOpsSaleProfessionals.orgId, orgId));
    await admin.delete(salesOpsSales).where(eq(salesOpsSales.orgId, orgId));
    await admin.delete(salesOpsProductFuncaoCosts).where(eq(salesOpsProductFuncaoCosts.orgId, orgId));
    await admin.delete(salesOpsProducts).where(eq(salesOpsProducts.orgId, orgId));
    await admin.delete(salesOpsAreas).where(eq(salesOpsAreas.orgId, orgId));
    await admin.delete(salesOpsPersonFuncoes).where(eq(salesOpsPersonFuncoes.orgId, orgId));
    await admin.delete(salesOpsPeople).where(eq(salesOpsPeople.orgId, orgId));
    await admin.delete(salesOpsFuncoes).where(eq(salesOpsFuncoes.orgId, orgId));
    await admin.delete(salesOpsClients).where(eq(salesOpsClients.orgId, orgId));
    await admin.delete(salesOpsSettings).where(eq(salesOpsSettings.orgId, orgId));
  }
  seededOrgIds.length = 0;
});

afterAll(async () => {
  registerProducerFlowGate(() => false);
  await closeDb();
});

describe('executeImportPlan', () => {
  it('creates one of everything from a hand-built plan, including a won proposta on its historical day and a settled parcela', async () => {
    const s = await seededOrg('full');
    const result = await run(s.orgId, fullPlan(s));
    expect(result.counts).toEqual(FULL_COUNTS);

    const admin = getAdminDb();
    const areas = await admin.select().from(salesOpsAreas).where(eq(salesOpsAreas.orgId, s.orgId));
    expect(areas).toHaveLength(2);
    const funcoes = await admin.select().from(salesOpsFuncoes).where(eq(salesOpsFuncoes.orgId, s.orgId));
    expect(funcoes.map((f) => f.slug).sort()).toEqual(['consultor', 'finder', 'vendedor']);
    const products = await admin.select().from(salesOpsProducts).where(eq(salesOpsProducts.orgId, s.orgId));
    expect(products).toHaveLength(1);
    expect(must(products[0]).codeSuffix).toBe('7');
    const costs = await admin
      .select()
      .from(salesOpsProductFuncaoCosts)
      .where(eq(salesOpsProductFuncaoCosts.orgId, s.orgId));
    expect(costs).toHaveLength(1);
    const personFuncoes = await admin
      .select()
      .from(salesOpsPersonFuncoes)
      .where(eq(salesOpsPersonFuncoes.orgId, s.orgId));
    expect(personFuncoes).toHaveLength(2);
    const stages = await admin.select().from(salesOpsLeadStages).where(eq(salesOpsLeadStages.orgId, s.orgId));
    expect(stages).toHaveLength(5);

    const sales = await admin
      .select()
      .from(salesOpsSales)
      .where(eq(salesOpsSales.orgId, s.orgId))
      .orderBy(salesOpsSales.sequence);
    expect(sales.map((x) => x.status)).toEqual(['won', 'lost', 'cancelled']);
    expect(sales.map((x) => x.code)).toEqual(['0001-7', '0002-0', '0003-7']);
    const won = must(sales[0]);
    expect(won.wonAt?.toISOString()).toBe('2026-03-10T15:00:00.000Z');

    const payables = await admin
      .select()
      .from(salesOpsPayables)
      .where(and(eq(salesOpsPayables.orgId, s.orgId), eq(salesOpsPayables.saleId, won.id)));
    expect(payables).toHaveLength(7);
    const byKind = (kind: string) => payables.filter((p) => p.kind === kind);
    expect(byKind('seller_commission').map((p) => p.amountBrl)).toEqual([15000, 15000]);
    expect(byKind('tax').map((p) => p.amountBrl)).toEqual([9000, 9000]);
    expect(byKind('professional_cost').map((p) => p.amountBrl)).toEqual([20000, 20000]);
    const other = byKind('other_cost');
    expect(other).toHaveLength(1);
    expect(must(other[0]).amountBrl).toBe(10000);
    expect(must(other[0]).receivableId).toBeNull();
    expect(asDateOnly(must(other[0]).dueDate)).toBe('2026-03-10');
    expect(must(other[0]).status).toBe('open');

    const receivables = await admin
      .select()
      .from(salesOpsReceivables)
      .where(and(eq(salesOpsReceivables.orgId, s.orgId), eq(salesOpsReceivables.saleId, won.id)));
    expect(receivables.find((r) => r.label === '1/2')?.status).toBe('paid');
    expect(receivables.find((r) => r.label === '2/2')?.status).toBe('open');

    const settlements = await admin
      .select()
      .from(salesOpsSettlements)
      .where(eq(salesOpsSettlements.orgId, s.orgId));
    expect(settlements).toHaveLength(4);
    for (const settlement of settlements) {
      expect(settlement.type).toBe('baixa');
      expect(settlement.origin).toBe('manual');
      expect(asDateOnly(settlement.paidOn)).toBe('2026-03-15');
      expect(settlement.actorName).toBe('Equipe FXL');
    }
  });

  it('lands leads in a workbook etapa in row order and in Perdido with its reason', async () => {
    const s = await seededOrg('leads');
    await run(s.orgId, fullPlan(s));
    const admin = getAdminDb();
    const stages = await admin.select().from(salesOpsLeadStages).where(eq(salesOpsLeadStages.orgId, s.orgId));
    const diagnostico = must(stages.find((x) => x.name === 'Diagnóstico'));
    const leads = await admin.select().from(salesOpsLeads).where(eq(salesOpsLeads.orgId, s.orgId));
    const bruno = must(leads.find((l) => l.contactName === 'Bruno'));
    const carla = must(leads.find((l) => l.contactName === 'Carla'));
    const diego = must(leads.find((l) => l.contactName === 'Diego'));
    expect(bruno.stageId).toBe(diagnostico.id);
    expect(diego.stageId).toBe(diagnostico.id);
    expect(bruno.position).toBeLessThan(diego.position);
    expect(carla.stageId).toBe(s.perdidoId);
    expect(carla.lostReason).toBe('Sem orçamento');
    expect(bruno.sellerNameSnapshot).toBe('Ana Importada');
    const products = await admin
      .select()
      .from(salesOpsLeadProducts)
      .where(eq(salesOpsLeadProducts.orgId, s.orgId));
    expect(products.filter((p) => p.leadId === bruno.id && p.productId !== null)).toHaveLength(1);
    expect(products.filter((p) => p.leadId === carla.id && p.productId === null)).toHaveLength(1);
  });

  it('writes exactly one import.completed entry, last, with the counts and the actor label', async () => {
    const s = await seededOrg('audit');
    const plan = fullPlan(s);
    await run(s.orgId, plan);
    const rows = await getAdminDb().select().from(auditLog).where(eq(auditLog.actorOrgId, s.orgId));
    expect(rows).toHaveLength(1);
    const entry = must(rows[0]);
    expect(entry.action).toBe('import.completed');
    expect(entry.entityType).toBe('importacao');
    expect(entry.entityId).toMatch(/^[0-9a-f-]{36}$/);
    expect(entry.afterJsonb).toEqual({ counts: plan.counts, actorLabel: 'Equipe FXL' });
    expect(entry.beforeJsonb).toEqual({});
    expect(entry.entryHash).toHaveLength(64);
    // Last: nothing else wrote to the global chain after it for this org's run.
    const [tail] = await getAdminDb().select().from(auditLog).orderBy(sql`id desc`).limit(1);
    expect(must(tail).id).toBeGreaterThanOrEqual(entry.id);
  });

  it('rolls back every table when the last operation is refused (all or nothing)', async () => {
    const s = await seededOrg('rollback');
    const before = await snapshot(s.orgId);
    const plan = fullPlan(s);
    plan.operations.push({
      op: 'settleReceivable',
      saleKey: 'propostas:2',
      receivableLabel: '9/9',
      paidOn: '2026-03-15',
      settlePayables: false,
    });
    const error = await run(s.orgId, plan).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImportExecutionError);
    expect((error as ImportExecutionError).reason).toBe('receivable_not_found');
    expect((error as ImportExecutionError).message).toContain('Aba Propostas, linha 2 (parcela 9/9)');
    expect(await snapshot(s.orgId)).toEqual(before);
    // Non-vacuity: the successful run on the same plan shape moves every table.
    const other = await seededOrg('rollback-ok');
    await run(other.orgId, fullPlan(other));
    const after = await snapshot(other.orgId);
    const baseline = await snapshot(newOrg('empty'));
    for (const table of COUNT_TABLES) {
      expect(after[table], table).toBeGreaterThan(baseline[table]!);
    }
    expect(after.audit_log).toBe(1);
  });

  it('rolls back every table when a service throws a database error inside its savepoint', async () => {
    const s = await seededOrg('dberror');
    const before = await snapshot(s.orgId);
    const ops = fullOperations(s);
    const plan: ImportPlan = {
      operations: [
        must(ops[0]),
        must(ops[2]),
        { ...must(ops[2]), planKey: 'produtos:3', input: { ...(must(ops[2]) as { input: object }).input, name: 'Outro Produto' } } as ImportOperation,
      ],
      issues: [],
      counts: {},
    };
    // The first product needs its função: create it first.
    plan.operations.splice(1, 0, must(ops[1]));
    const error = await run(s.orgId, plan).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImportExecutionError);
    expect((error as ImportExecutionError).reason).toBe('db_unique_violation');
    expect(((error as ImportExecutionError).operation as { planKey: string }).planKey).toBe('produtos:3');
    expect(await snapshot(s.orgId)).toEqual(before);
  });

  it('refuses a won proposta in a producer-live org and writes nothing, outbox included', async () => {
    const s = await seededOrg('live');
    const before = await snapshot(s.orgId);
    registerProducerFlowGate((id) => id === s.orgId);
    const error = await run(s.orgId, fullPlan(s)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImportExecutionError);
    expect((error as ImportExecutionError).reason).toBe('producer_flow_live');
    expect(((error as ImportExecutionError).operation as { planKey: string }).planKey).toBe('propostas:2');
    const after = await snapshot(s.orgId);
    expect(after).toEqual(before);
    expect(after.integration_outbox).toBe(0);
    expect(after.audit_log).toBe(0);
  });

  it('executes cadastros and open propostas in a producer-live org with an empty outbox', async () => {
    const s = await seededOrg('live-ok');
    registerProducerFlowGate((id) => id === s.orgId);
    const ops = fullOperations(s);
    const pick = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 12].map((i) => must(ops[i]));
    const plan: ImportPlan = { operations: pick, issues: [], counts: { areas: 1, propostas: 1 } };
    await run(s.orgId, plan);
    const after = await snapshot(s.orgId);
    expect(after.integration_outbox).toBe(0);
    expect(after.audit_log).toBe(1);
    expect(after.sales_ops_sales).toBe(1);
  });
});
