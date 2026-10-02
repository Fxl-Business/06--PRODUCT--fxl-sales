/**
 * Slice 02 oracle: readImportCatalog against the local test DB (tenant role, RLS live).
 * Fixtures are seeded and cleaned through getAdminDb().
 *
 * Run: VITEST_INTEGRATION=1 pnpm exec vitest run src/domains/import/__tests__/catalog.integration.test.ts
 */
import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { closeDb, getAdminDb, getDb } from '../../../db/client.js';
import {
  salesOpsAreas,
  salesOpsClients,
  salesOpsFuncoes,
  salesOpsLeadStages,
  salesOpsPeople,
  salesOpsPersonFuncoes,
  salesOpsProductFuncaoCosts,
  salesOpsProducts,
  salesOpsSettings,
} from '../../../db/schema.js';
import { registerProducerFlowGate } from '../../integration/producer-gate.js';
import { ensureLeadStages } from '../../sales-ops/leads/stages-seed.js';
import { ensureSystemFuncoes, withTenant } from '../../sales-ops/service.js';
import { DEFAULT_IMPORT_SETTINGS, numericToNumber, readImportCatalog } from '../catalog.js';

const NOW = new Date('2026-03-10T15:00:00.000Z');
const orgs: string[] = [];

function newOrg(label: string): string {
  const orgId = `org_import_catalog_${label}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  orgs.push(orgId);
  return orgId;
}

function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('expected a row');
  return v;
}

const catalogOf = (orgId: string, now = NOW) =>
  withTenant(getDb(), orgId, (tx) => readImportCatalog(tx, orgId, now));

async function counts(orgId: string) {
  const admin = getAdminDb();
  const stages = await admin.select().from(salesOpsLeadStages).where(eq(salesOpsLeadStages.orgId, orgId));
  const funcoes = await admin.select().from(salesOpsFuncoes).where(eq(salesOpsFuncoes.orgId, orgId));
  return { stages: stages.length, funcoes: funcoes.length };
}

afterEach(() => {
  registerProducerFlowGate(() => false);
});

afterAll(async () => {
  const admin = getAdminDb();
  for (const orgId of orgs) {
    await admin.delete(salesOpsProductFuncaoCosts).where(eq(salesOpsProductFuncaoCosts.orgId, orgId));
    await admin.delete(salesOpsPersonFuncoes).where(eq(salesOpsPersonFuncoes.orgId, orgId));
    await admin.delete(salesOpsPeople).where(eq(salesOpsPeople.orgId, orgId));
    await admin.delete(salesOpsProducts).where(eq(salesOpsProducts.orgId, orgId));
    await admin.delete(salesOpsFuncoes).where(eq(salesOpsFuncoes.orgId, orgId));
    await admin.delete(salesOpsAreas).where(eq(salesOpsAreas.orgId, orgId));
    await admin.delete(salesOpsClients).where(eq(salesOpsClients.orgId, orgId));
    await admin.delete(salesOpsLeadStages).where(inArray(salesOpsLeadStages.orgId, [orgId]));
    await admin.delete(salesOpsSettings).where(eq(salesOpsSettings.orgId, orgId));
  }
  registerProducerFlowGate(() => false);
  await closeDb();
});

describe('numericToNumber', () => {
  it('converts numeric strings and keeps null', () => {
    expect(numericToNumber('12.50')).toBe(12.5);
    expect(numericToNumber(null)).toBeNull();
    expect(() => numericToNumber('abc')).toThrow('invalid numeric value');
  });
});

describe('readImportCatalog', () => {
  it('returns the org snapshot with numbers, costs, people funções and settings', async () => {
    const admin = getAdminDb();
    const orgA = newOrg('a');
    const orgB = newOrg('b');

    const [tec] = await admin.insert(salesOpsAreas).values({ orgId: orgA, name: 'Tecnologia' }).returning();
    await admin.insert(salesOpsAreas).values({ orgId: orgA, name: 'Antiga', status: 'archived' });
    const [vendedor] = await admin.insert(salesOpsFuncoes).values({ orgId: orgA, name: 'Vendedor', slug: 'vendedor', isSystem: true }).returning();
    const [dev] = await admin.insert(salesOpsFuncoes).values({ orgId: orgA, name: 'Desenvolvedor', slug: 'desenvolvedor' }).returning();
    const [design] = await admin.insert(salesOpsFuncoes).values({ orgId: orgA, name: 'Designer', slug: 'designer' }).returning();
    const [product] = await admin
      .insert(salesOpsProducts)
      .values({
        orgId: orgA,
        name: 'Sistema',
        codeSuffix: '3',
        areaId: must(tec).id,
        sellerCommissionValue: '12.50',
        sellerWithFinderCommissionValue: '8.00',
        finderCommissionValue: '3.00',
        defaultEntradaMode: 'pct',
        defaultEntradaPct: '30.00',
        defaultRecurringCycles: null,
      })
      .returning();
    await admin.insert(salesOpsProductFuncaoCosts).values([
      { orgId: orgA, productId: must(product).id, funcaoId: must(dev).id, mode: 'pct', valuePct: '20.00' },
      { orgId: orgA, productId: must(product).id, funcaoId: must(design).id, mode: 'fix', valueBrl: 120000 },
    ]);
    const [ana] = await admin.insert(salesOpsPeople).values({ orgId: orgA, displayName: 'Ana', contactEmail: 'ana@x.com' }).returning();
    await admin.insert(salesOpsPersonFuncoes).values([
      { orgId: orgA, personId: must(ana).id, funcaoId: must(vendedor).id },
      { orgId: orgA, personId: must(ana).id, funcaoId: must(dev).id },
    ]);
    await admin.insert(salesOpsPeople).values({ orgId: orgA, displayName: 'Inativa', status: 'inactive' });
    await admin.insert(salesOpsClients).values({ orgId: orgA, name: 'Padaria', document: '12.345.678/0001-90' });
    await admin.insert(salesOpsSettings).values({
      orgId: orgA,
      defaultSellerCommissionPct: '12.00',
      defaultFinderCommissionPct: '4.00',
      defaultTaxPct: '5.50',
    });
    await withTenant(getDb(), orgA, (tx) => ensureLeadStages(tx, orgA));
    await admin.insert(salesOpsAreas).values({ orgId: orgB, name: 'Outra' });
    await admin.insert(salesOpsPeople).values({ orgId: orgB, displayName: 'Beto' });

    const catalog = await catalogOf(orgA);

    expect(catalog.areas.map((a) => [a.name, a.status])).toEqual([['Antiga', 'archived'], ['Tecnologia', 'active']]);
    const p = must(catalog.products[0]);
    expect(catalog.products).toHaveLength(1);
    expect(p).toMatchObject({
      name: 'Sistema', codeSuffix: '3', kind: 'product', areaId: must(tec).id,
      sellerCommissionType: 'pct', sellerCommissionValue: 12.5, sellerWithFinderCommissionValue: 8,
      finderCommissionValue: 3, defaultEntradaMode: 'pct', defaultEntradaPct: 30, defaultEntradaBrl: null,
      defaultRecurringCycles: null, defaultPaymentMethod: 'pix',
    });
    expect(p.productFuncaoCosts).toEqual(
      expect.arrayContaining([
        { funcaoId: must(dev).id, mode: 'pct', valuePct: 20 },
        { funcaoId: must(design).id, mode: 'fix', valueBrl: 120000 },
      ]),
    );
    expect(p.productFuncaoCosts).toHaveLength(2);
    const anaRow = must(catalog.people.find((x) => x.displayName === 'Ana'));
    expect(anaRow.funcaoSlugs).toEqual(expect.arrayContaining(['vendedor', 'desenvolvedor']));
    expect(anaRow.funcaoIds).toHaveLength(2);
    expect(catalog.people.find((x) => x.displayName === 'Inativa')).toMatchObject({ status: 'inactive', funcaoIds: [] });
    expect(catalog.clients).toEqual([{ id: expect.any(String), name: 'Padaria', document: '12.345.678/0001-90' }]);
    expect(catalog.settings).toEqual({ defaultSellerCommissionPct: 12, defaultFinderCommissionPct: 4, defaultTaxPct: 5.5 });
    expect(catalog.stages.map((s) => [s.name, s.kind, s.position])).toEqual([
      ['Novo', 'normal', 1], ['Em negociação', 'normal', 2], ['Proposta', 'conversion', 3], ['Perdido', 'lost', 4],
    ]);
    expect(catalog.funcoes.map((f) => f.slug).sort()).toEqual(['desenvolvedor', 'designer', 'vendedor']);
    expect(JSON.stringify(catalog)).not.toContain('Outra');
    expect(JSON.stringify(catalog)).not.toContain('Beto');
  });

  it('computes today in São Paulo from the given instant', async () => {
    const catalog = await catalogOf(newOrg('today'), new Date('2026-03-10T02:00:00.000Z'));
    expect(catalog.today).toBe('2026-03-09');
  });

  it('falls back to 10/3/6 and writes nothing in a fresh org', async () => {
    const orgId = newOrg('fresh');
    const catalog = await catalogOf(orgId);
    expect(catalog.settings).toEqual(DEFAULT_IMPORT_SETTINGS);
    expect(catalog.settings).not.toBe(DEFAULT_IMPORT_SETTINGS);
    expect(catalog.stages).toEqual([]);
    expect(catalog.funcoes).toEqual([]);
    expect(catalog.products).toEqual([]);
    expect(await counts(orgId)).toEqual({ stages: 0, funcoes: 0 });
  });

  it('sees system funções and default etapas once the route seeds them (D11/D11b)', async () => {
    const orgId = newOrg('seeded');
    const catalog = await withTenant(getDb(), orgId, async (tx) => {
      await ensureLeadStages(tx, orgId);
      await ensureSystemFuncoes(tx, orgId);
      await ensureSystemFuncoes(tx, orgId);
      return readImportCatalog(tx, orgId, NOW);
    });
    expect(catalog.funcoes.map((f) => [f.name, f.isSystem]).sort()).toEqual([['Finder', true], ['Vendedor', true]]);
    expect(catalog.stages.map((s) => s.name)).toEqual(['Novo', 'Em negociação', 'Proposta', 'Perdido']);
  });

  it('mirrors the producer gate', async () => {
    const orgA = newOrg('gate-a');
    const orgB = newOrg('gate-b');
    registerProducerFlowGate((id) => id === orgA);
    expect((await catalogOf(orgA)).producerFlowLive).toBe(true);
    expect((await catalogOf(orgB)).producerFlowLive).toBe(false);
  });
});
