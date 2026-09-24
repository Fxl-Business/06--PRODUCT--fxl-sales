/**
 * Slice 04 (update-sale-in-place) integration oracles.
 *
 * `updateSale` reconciles items, professionals, receivables and (on won)
 * payables IN PLACE by the ids the payload carries; nothing is deleted, rows
 * that leave the plan are voided or soft-removed, a settled row blocks the edit,
 * and `revision` moves only on a real change.
 *
 * Real service functions on drizzle(postgres(TEST_DATABASE_URL)) through the
 * non-superuser app role (RLS enforced); an admin connection verifies, seeds
 * settlement facts and cleans up.
 *
 * Run: pnpm --filter @fxl-sales/api test:integration test/rls/update-sale-in-place.test.ts
 */
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteSettlementsForOrgs } from '../../src/db/__tests__/settlement-test-cleanup.js';
import * as schema from '../../src/db/schema.js';
import {
  AreaSchema,
  CreateSaleSchema,
  ProductSchema,
  UpdateSaleSchema,
  createArea,
  createProduct,
  createSale,
  getSalesOpsSnapshot,
  transitionSale,
  updateSale,
} from '../../src/domains/sales-ops/service.js';

const APP_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5006/fxl_sales';
const ADMIN_DB_URL = process.env.ADMIN_DATABASE_URL ?? APP_DB_URL;
const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;

type ReceivableRow = {
  id: string;
  label: string;
  amount_brl: number;
  method: string;
  status: string;
  revision: number;
  updated_at: Date;
  due_date: Date;
};
type PayableRow = {
  id: string;
  kind: string;
  beneficiary_name: string;
  receivable_id: string | null;
  sale_professional_id: string | null;
  amount_brl: number;
  status: string;
  revision: number;
  due_date: Date;
};

describe('updateSale edits a proposta in place', () => {
  let appClient: postgres.Sql;
  let adminClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const orgIds: string[] = [];
  let sequence = 0;

  beforeAll(() => {
    appClient = postgres(APP_DB_URL, { max: 5 });
    adminClient = postgres(ADMIN_DB_URL, { max: 5, ...ADMIN_CONNECTION_OPTIONS });
    db = drizzle(appClient, { schema });
  });

  afterAll(async () => {
    // Settlements first: they refuse DELETE and pin the ledger rows (RESTRICT).
    await deleteSettlementsForOrgs(orgIds);
    for (const orgId of orgIds) {
      await adminClient`DELETE FROM sales_ops_payables WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_receivables WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_sale_items WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_sale_professionals WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_sales WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_products WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_areas WHERE org_id = ${orgId}`;
    }
    await appClient.end();
    await adminClient.end();
  });

  function newOrg(tag: string): string {
    sequence += 1;
    const orgId = `org_upd_${tag}_${Date.now()}_${sequence}`;
    orgIds.push(orgId);
    return orgId;
  }

  async function seedProduct(orgId: string) {
    const area = await createArea(db, orgId, AreaSchema.parse({ name: 'FXL Tech' }));
    if (area === 'duplicate') throw new Error('unexpected duplicate area');
    const { product } = await createProduct(
      db,
      orgId,
      ProductSchema.parse({ name: 'Consultoria', areaId: area.id }),
    );
    return { area, product };
  }

  async function receivablesOf(saleId: string): Promise<ReceivableRow[]> {
    return (await adminClient`
      SELECT id, label, amount_brl, method, status, revision, updated_at, due_date
      FROM sales_ops_receivables WHERE sale_id = ${saleId}
      ORDER BY due_date ASC, id ASC`) as unknown as ReceivableRow[];
  }

  async function payablesOf(saleId: string): Promise<PayableRow[]> {
    return (await adminClient`
      SELECT id, kind, beneficiary_name, receivable_id, sale_professional_id, amount_brl, status,
             revision, due_date
      FROM sales_ops_payables WHERE sale_id = ${saleId}
      ORDER BY kind ASC, due_date ASC, id ASC`) as unknown as PayableRow[];
  }

  async function idsOf(table: 'items' | 'professionals', saleId: string) {
    const rows =
      table === 'items'
        ? await adminClient`SELECT id, removed_at FROM sales_ops_sale_items WHERE sale_id = ${saleId}`
        : await adminClient`SELECT id, removed_at FROM sales_ops_sale_professionals WHERE sale_id = ${saleId}`;
    return rows as unknown as Array<{ id: string; removed_at: Date | null }>;
  }

  async function seedBaixa(
    orgId: string,
    saleId: string,
    target: { receivableId: string } | { payableId: string },
    amountBrl: number,
  ) {
    const receivableId = 'receivableId' in target ? target.receivableId : null;
    const payableId = 'payableId' in target ? target.payableId : null;
    const kind = receivableId ? 'receivable' : 'payable';
    await adminClient`
      INSERT INTO sales_ops_settlements
        (id, org_id, sale_id, target_kind, receivable_id, payable_id, type, reverses_settlement_id,
         paid_on, amount_brl, origin, actor_user_id, actor_name)
      VALUES (${randomUUID()}, ${orgId}, ${saleId}, ${kind}, ${receivableId}, ${payableId}, 'baixa',
              NULL, '2026-08-01', ${amountBrl}, 'manual', 'test', 'Teste')`;
  }

  /** A won proposta: 7 payables (seller x2, tax x2, professional x2, other_cost). */
  async function createWonSale(orgId: string) {
    const { product } = await seedProduct(orgId);
    const created = await createSale(
      db,
      orgId,
      CreateSaleSchema.parse({
        clientName: 'Cliente Ganho',
        sellerName: 'Ana Martins',
        status: 'won',
        baseDate: '2026-08-01',
        sellerCommissionPct: 10,
        taxPct: 6,
        otherCostsBrl: 5000,
        items: [{ productId: product.id, productName: 'Consultoria', quantity: 1, unitBrl: 300000 }],
        professionals: [{ personName: 'Julia Prado', role: 'Design', costBrl: 60000 }],
        installments: [
          { dueDate: '2026-08-01', amountBrl: 100000, method: 'pix' },
          { dueDate: '2026-09-01', amountBrl: 200000, method: 'pix' },
        ],
      }),
    );
    const saleId = created.sale.id;
    const [item] = await idsOf('items', saleId);
    const [professional] = await idsOf('professionals', saleId);
    const [r1, r2] = await receivablesOf(saleId);
    return { product, saleId, itemId: item!.id, professionalId: professional!.id, r1: r1!, r2: r2! };
  }

  function wonUpdate(
    fixture: Awaited<ReturnType<typeof createWonSale>>,
    overrides: Record<string, unknown> = {},
  ) {
    return UpdateSaleSchema.parse({
      clientName: 'Cliente Ganho',
      sellerName: 'Ana Martins',
      status: 'won',
      baseDate: '2026-08-01',
      sellerCommissionPct: 10,
      taxPct: 6,
      otherCostsBrl: 5000,
      items: [
        {
          id: fixture.itemId,
          productId: fixture.product.id,
          productName: 'Consultoria',
          quantity: 1,
          unitBrl: 300000,
        },
      ],
      professionals: [
        { id: fixture.professionalId, personName: 'Julia Prado', role: 'Design', costBrl: 60000 },
      ],
      installments: [
        { id: fixture.r1.id, dueDate: '2026-08-01', amountBrl: 150000, method: 'pix' },
        { id: fixture.r2.id, dueDate: '2026-09-01', amountBrl: 150000, method: 'pix' },
      ],
      ...overrides,
    });
  }

  it('keeps item, professional and receivable ids across an edit', async () => {
    const orgId = newOrg('ids');
    const { product, area } = await seedProduct(orgId);
    const created = await createSale(
      db,
      orgId,
      CreateSaleSchema.parse({
        clientName: 'Cliente',
        sellerName: 'Ana Martins',
        status: 'draft',
        baseDate: '2026-08-01',
        items: [{ productId: product.id, productName: 'Consultoria', quantity: 1, unitBrl: 200000 }],
        professionals: [{ personName: 'Julia Prado', role: 'Design', costBrl: 50000 }],
        installments: [
          { dueDate: '2026-08-01', amountBrl: 100000, method: 'pix' },
          { dueDate: '2026-09-01', amountBrl: 100000, method: 'pix' },
        ],
      }),
    );
    const saleId = created.sale.id;
    const [item] = await idsOf('items', saleId);
    const [professional] = await idsOf('professionals', saleId);
    const [r1, r2] = await receivablesOf(saleId);

    const result = await updateSale(
      db,
      orgId,
      saleId,
      UpdateSaleSchema.parse({
        clientName: 'Cliente',
        sellerName: 'Ana Martins',
        status: 'open',
        baseDate: '2026-08-01',
        items: [
          { id: item!.id, productId: product.id, productName: 'Consultoria', quantity: 1, unitBrl: 250000 },
          { productName: 'Serviço avulso', areaId: area.id, quantity: 1, unitBrl: 50000 },
        ],
        professionals: [
          { id: professional!.id, personName: 'Julia Prado', role: 'Design', costBrl: 70000 },
        ],
        installments: [
          { id: r1!.id, dueDate: '2026-08-01', amountBrl: 150000, method: 'pix' },
          { id: r2!.id, dueDate: '2026-09-01', amountBrl: 150000, method: 'pix' },
        ],
      }),
    );
    expect(result.ok).toBe(true);

    const items = (await adminClient`
      SELECT id, unit_brl, product_name_snapshot FROM sales_ops_sale_items WHERE sale_id = ${saleId}`) as unknown as Array<{
      id: string;
      unit_brl: number;
      product_name_snapshot: string;
    }>;
    expect(items).toHaveLength(2);
    expect(items.find((row) => row.id === item!.id)?.unit_brl).toBe(250000);
    const added = items.find((row) => row.id !== item!.id);
    expect(added?.product_name_snapshot).toBe('Serviço avulso');

    const professionals = (await adminClient`
      SELECT id, cost_brl FROM sales_ops_sale_professionals WHERE sale_id = ${saleId}`) as unknown as Array<{
      id: string;
      cost_brl: number;
    }>;
    expect(professionals).toEqual([{ id: professional!.id, cost_brl: 70000 }]);

    const receivables = await receivablesOf(saleId);
    expect(receivables.map((row) => [row.id, row.label, row.amount_brl, row.status])).toEqual([
      [r1!.id, '1/2', 150000, 'open'],
      [r2!.id, '2/2', 150000, 'open'],
    ]);
  });

  it('voids exactly the zeroed middle installment, matched by id not label', async () => {
    const orgId = newOrg('zero');
    const { product } = await seedProduct(orgId);
    const created = await createSale(
      db,
      orgId,
      CreateSaleSchema.parse({
        clientName: 'Cliente',
        sellerName: 'Ana Martins',
        status: 'open',
        baseDate: '2026-08-01',
        items: [{ productId: product.id, productName: 'Consultoria', quantity: 1, unitBrl: 300000 }],
        installments: [
          { dueDate: '2026-08-01', amountBrl: 100000, method: 'pix' },
          { dueDate: '2026-09-01', amountBrl: 100000, method: 'pix' },
          { dueDate: '2026-10-01', amountBrl: 100000, method: 'pix' },
        ],
      }),
    );
    const saleId = created.sale.id;
    const [a, b, c] = await receivablesOf(saleId);

    const result = await updateSale(
      db,
      orgId,
      saleId,
      UpdateSaleSchema.parse({
        clientName: 'Cliente',
        sellerName: 'Ana Martins',
        status: 'open',
        baseDate: '2026-08-01',
        items: [{ productId: product.id, productName: 'Consultoria', quantity: 1, unitBrl: 300000 }],
        installments: [
          { id: a!.id, dueDate: '2026-08-01', amountBrl: 150000, method: 'pix' },
          { id: b!.id, dueDate: '2026-09-01', amountBrl: 0, method: 'pix' },
          { id: c!.id, dueDate: '2026-10-01', amountBrl: 150000, method: 'pix' },
        ],
      }),
    );
    expect(result.ok).toBe(true);

    const rows = await receivablesOf(saleId);
    expect(rows.map((row) => [row.id, row.label, row.amount_brl, row.status])).toEqual([
      [a!.id, '1/2', 150000, 'open'],
      [b!.id, '2/3', 100000, 'void'],
      [c!.id, '2/2', 150000, 'open'],
    ]);
  });

  it('a receivable removed from the plan is void and still in the database', async () => {
    const orgId = newOrg('void');
    const { product } = await seedProduct(orgId);
    const created = await createSale(
      db,
      orgId,
      CreateSaleSchema.parse({
        clientName: 'Cliente',
        sellerName: 'Ana Martins',
        status: 'draft',
        baseDate: '2026-08-01',
        items: [{ productId: product.id, productName: 'Consultoria', quantity: 1, unitBrl: 200000 }],
        installments: [
          { dueDate: '2026-08-01', amountBrl: 100000, method: 'pix' },
          { dueDate: '2026-09-01', amountBrl: 100000, method: 'pix' },
        ],
      }),
    );
    const saleId = created.sale.id;
    const [r1, r2] = await receivablesOf(saleId);

    const result = await updateSale(
      db,
      orgId,
      saleId,
      UpdateSaleSchema.parse({
        clientName: 'Cliente',
        sellerName: 'Ana Martins',
        status: 'draft',
        baseDate: '2026-08-01',
        items: [{ productId: product.id, productName: 'Consultoria', quantity: 1, unitBrl: 200000 }],
        installments: [{ id: r1!.id, dueDate: '2026-08-01', amountBrl: 200000, method: 'pix' }],
      }),
    );
    expect(result.ok).toBe(true);

    const rows = await receivablesOf(saleId);
    expect(rows.map((row) => [row.id, row.label, row.status, row.revision])).toEqual([
      [r1!.id, '1/1', 'open', 2],
      [r2!.id, '2/2', 'void', 2],
    ]);
  });

  it('a professional removed from the payload keeps its row with removed_at and leaves the bootstrap snapshot', async () => {
    const orgId = newOrg('prof');
    const { product } = await seedProduct(orgId);
    const created = await createSale(
      db,
      orgId,
      CreateSaleSchema.parse({
        clientName: 'Cliente',
        sellerName: 'Ana Martins',
        status: 'draft',
        baseDate: '2026-08-01',
        items: [{ productId: product.id, productName: 'Consultoria', quantity: 1, unitBrl: 100000 }],
        professionals: [{ personName: 'Julia Prado', role: 'Design', costBrl: 20000 }],
        installments: [{ dueDate: '2026-08-01', amountBrl: 100000, method: 'pix' }],
      }),
    );
    const saleId = created.sale.id;
    const [item] = await idsOf('items', saleId);
    const [professional] = await idsOf('professionals', saleId);
    const [r1] = await receivablesOf(saleId);

    const result = await updateSale(
      db,
      orgId,
      saleId,
      UpdateSaleSchema.parse({
        clientName: 'Cliente',
        sellerName: 'Ana Martins',
        status: 'draft',
        baseDate: '2026-08-01',
        items: [{ productId: product.id, productName: 'Outro nome', quantity: 1, unitBrl: 100000 }],
        professionals: [],
        installments: [{ id: r1!.id, dueDate: '2026-08-01', amountBrl: 100000, method: 'pix' }],
      }),
    );
    expect(result.ok).toBe(true);

    const professionals = await idsOf('professionals', saleId);
    expect(professionals).toHaveLength(1);
    expect(professionals[0]?.id).toBe(professional!.id);
    expect(professionals[0]?.removed_at).not.toBeNull();
    // The item was sent without its id: the old row is soft-removed, a new one exists.
    const items = await idsOf('items', saleId);
    expect(items).toHaveLength(2);
    expect(items.find((row) => row.id === item!.id)?.removed_at).not.toBeNull();

    const snapshot = await getSalesOpsSnapshot(db, orgId);
    expect(snapshot.saleProfessionals.filter((row) => row.saleId === saleId)).toEqual([]);
    const snapshotItems = snapshot.saleItems.filter((row) => row.saleId === saleId);
    expect(snapshotItems.map((row) => row.productNameSnapshot)).toEqual(['Outro nome']);
  });

  it('bumps revision and updated_at only on a real change', async () => {
    const orgId = newOrg('rev');
    const { product } = await seedProduct(orgId);
    const created = await createSale(
      db,
      orgId,
      CreateSaleSchema.parse({
        clientName: 'Cliente',
        sellerName: 'Ana Martins',
        status: 'open',
        baseDate: '2026-08-01',
        items: [{ productId: product.id, productName: 'Consultoria', quantity: 1, unitBrl: 200000 }],
        installments: [
          { dueDate: '2026-08-01', amountBrl: 100000, method: 'pix' },
          { dueDate: '2026-09-01', amountBrl: 100000, method: 'pix' },
        ],
      }),
    );
    const saleId = created.sale.id;
    const before = await receivablesOf(saleId);
    const [r1, r2] = before;
    const [item] = await idsOf('items', saleId);
    const payload = (secondMethod: 'pix' | 'boleto') =>
      UpdateSaleSchema.parse({
        clientName: 'Cliente',
        sellerName: 'Ana Martins',
        status: 'open',
        baseDate: '2026-08-01',
        items: [
          { id: item!.id, productId: product.id, productName: 'Consultoria', quantity: 1, unitBrl: 200000 },
        ],
        installments: [
          { id: r1!.id, dueDate: '2026-08-01', amountBrl: 100000, method: 'pix' },
          { id: r2!.id, dueDate: '2026-09-01', amountBrl: 100000, method: secondMethod },
        ],
      });

    expect((await updateSale(db, orgId, saleId, payload('pix'))).ok).toBe(true);
    const identical = await receivablesOf(saleId);
    expect(identical.map((row) => row.revision)).toEqual([1, 1]);
    expect(identical.map((row) => row.updated_at.getTime())).toEqual(
      before.map((row) => row.updated_at.getTime()),
    );

    expect((await updateSale(db, orgId, saleId, payload('boleto'))).ok).toBe(true);
    const changed = await receivablesOf(saleId);
    expect(changed.map((row) => [row.id, row.method, row.revision])).toEqual([
      [r1!.id, 'pix', 1],
      [r2!.id, 'boleto', 2],
    ]);
    expect(changed[0]!.updated_at.getTime()).toBe(r1!.updated_at.getTime());
    expect(changed[1]!.updated_at.getTime()).toBeGreaterThan(r2!.updated_at.getTime());
  });

  it('reconciles payables of a won proposta in place', async () => {
    const orgId = newOrg('won');
    const fixture = await createWonSale(orgId);
    const before = await payablesOf(fixture.saleId);
    expect(before).toHaveLength(7);

    const result = await updateSale(db, orgId, fixture.saleId, wonUpdate(fixture));
    expect(result.ok).toBe(true);

    const after = await payablesOf(fixture.saleId);
    expect(after.map((row) => row.id).sort()).toEqual(before.map((row) => row.id).sort());
    const summary = after.map((row) => [
      row.kind,
      row.receivable_id === fixture.r1.id ? 'r1' : row.receivable_id === fixture.r2.id ? 'r2' : null,
      row.amount_brl,
      row.revision,
      row.status,
    ]);
    expect(summary).toEqual([
      ['other_cost', null, 5000, 1, 'open'],
      ['professional_cost', 'r1', 30000, 2, 'open'],
      ['professional_cost', 'r2', 30000, 2, 'open'],
      ['seller_commission', 'r1', 15000, 2, 'open'],
      ['seller_commission', 'r2', 15000, 2, 'open'],
      ['tax', 'r1', 9000, 2, 'open'],
      ['tax', 'r2', 9000, 2, 'open'],
    ]);
    expect(
      after
        .filter((row) => row.kind === 'professional_cost')
        .every((row) => row.sale_professional_id === fixture.professionalId),
    ).toBe(true);
  });

  it('voids the open payables of a professional removed from a won proposta', async () => {
    const orgId = newOrg('won_prof');
    const fixture = await createWonSale(orgId);

    const result = await updateSale(
      db,
      orgId,
      fixture.saleId,
      wonUpdate(fixture, {
        professionals: [],
        installments: [
          { id: fixture.r1.id, dueDate: '2026-08-01', amountBrl: 100000, method: 'pix' },
          { id: fixture.r2.id, dueDate: '2026-09-01', amountBrl: 200000, method: 'pix' },
        ],
      }),
    );
    expect(result.ok).toBe(true);

    const after = await payablesOf(fixture.saleId);
    expect(after).toHaveLength(7);
    expect(
      after.map((row) => [row.kind, row.status, row.revision]).filter(([kind]) => kind === 'professional_cost'),
    ).toEqual([
      ['professional_cost', 'void', 2],
      ['professional_cost', 'void', 2],
    ]);
    expect(
      after.filter((row) => row.kind !== 'professional_cost').every((row) => row.status === 'open' && row.revision === 1),
    ).toBe(true);
    const [professional] = await idsOf('professionals', fixture.saleId);
    expect(professional?.removed_at).not.toBeNull();
  });

  it('refuses with row_has_active_settlement naming the blocking row and changes nothing', async () => {
    const orgId = newOrg('lock');
    const fixture = await createWonSale(orgId);
    await seedBaixa(orgId, fixture.saleId, { receivableId: fixture.r1.id }, 100000);
    const receivablesBefore = await receivablesOf(fixture.saleId);
    const payablesBefore = await payablesOf(fixture.saleId);

    const result = await updateSale(
      db,
      orgId,
      fixture.saleId,
      wonUpdate(fixture, { clientName: 'Cliente Renomeado' }),
    );

    expect(result).toEqual({
      ok: false,
      reason: 'row_has_active_settlement',
      rows: [{ kind: 'receivable', id: fixture.r1.id, label: '1/2' }],
    });
    const [sale] = await adminClient`
      SELECT client_name_snapshot FROM sales_ops_sales WHERE id = ${fixture.saleId}`;
    expect((sale as { client_name_snapshot: string }).client_name_snapshot).toBe('Cliente Ganho');
    expect(await receivablesOf(fixture.saleId)).toEqual(receivablesBefore);
    expect(await payablesOf(fixture.saleId)).toEqual(payablesBefore);
    expect(await idsOf('items', fixture.saleId)).toHaveLength(1);
    expect(await idsOf('professionals', fixture.saleId)).toHaveLength(1);
  });

  it('names a settled payable whose amount would change', async () => {
    const orgId = newOrg('lock_pay');
    const fixture = await createWonSale(orgId);
    const payables = await payablesOf(fixture.saleId);
    const sellerOnR2 = payables.find(
      (row) => row.kind === 'seller_commission' && row.receivable_id === fixture.r2.id,
    )!;
    await seedBaixa(orgId, fixture.saleId, { payableId: sellerOnR2.id }, sellerOnR2.amount_brl);

    const result = await updateSale(
      db,
      orgId,
      fixture.saleId,
      wonUpdate(fixture, {
        sellerCommissionPct: 12,
        installments: [
          { id: fixture.r1.id, dueDate: '2026-08-01', amountBrl: 100000, method: 'pix' },
          { id: fixture.r2.id, dueDate: '2026-09-01', amountBrl: 200000, method: 'pix' },
        ],
      }),
    );

    expect(result).toEqual({
      ok: false,
      reason: 'row_has_active_settlement',
      rows: [{ kind: 'payable', id: sellerOnR2.id, label: 'Ana Martins (2/2)' }],
    });
    expect(await payablesOf(fixture.saleId)).toEqual(payables);
  });

  it('lets a method-only change through on a settled receivable', async () => {
    const orgId = newOrg('lock_method');
    const fixture = await createWonSale(orgId);
    await seedBaixa(orgId, fixture.saleId, { receivableId: fixture.r1.id }, 100000);

    const result = await updateSale(
      db,
      orgId,
      fixture.saleId,
      wonUpdate(fixture, {
        installments: [
          { id: fixture.r1.id, dueDate: '2026-08-01', amountBrl: 100000, method: 'boleto' },
          { id: fixture.r2.id, dueDate: '2026-09-01', amountBrl: 200000, method: 'pix' },
        ],
      }),
    );
    expect(result.ok).toBe(true);

    const rows = await receivablesOf(fixture.saleId);
    expect(rows.map((row) => [row.id, row.method, row.revision])).toEqual([
      [fixture.r1.id, 'boleto', 2],
      [fixture.r2.id, 'pix', 1],
    ]);
    expect((await payablesOf(fixture.saleId)).every((row) => row.revision === 1)).toBe(true);
  });

  it('refuses to move a proposta into or out of won through PUT', async () => {
    const orgId = newOrg('status');
    const fixture = await createWonSale(orgId);
    const outOfWon = await updateSale(
      db,
      orgId,
      fixture.saleId,
      wonUpdate(fixture, { status: 'open' }),
    );
    expect(outOfWon).toEqual({ ok: false, reason: 'invalid_status_change', from: 'won', to: 'open' });

    const created = await createSale(
      db,
      orgId,
      CreateSaleSchema.parse({
        clientName: 'Cliente Aberto',
        sellerName: 'Ana Martins',
        status: 'open',
        baseDate: '2026-08-01',
        items: [
          { productId: fixture.product.id, productName: 'Consultoria', quantity: 1, unitBrl: 100000 },
        ],
        installments: [{ dueDate: '2026-08-01', amountBrl: 100000, method: 'pix' }],
      }),
    );
    const intoWon = await updateSale(
      db,
      orgId,
      created.sale.id,
      UpdateSaleSchema.parse({
        clientName: 'Cliente Aberto',
        sellerName: 'Ana Martins',
        status: 'won',
        baseDate: '2026-08-01',
        items: [
          { productId: fixture.product.id, productName: 'Consultoria', quantity: 1, unitBrl: 100000 },
        ],
        installments: [{ dueDate: '2026-08-01', amountBrl: 100000, method: 'pix' }],
      }),
    );
    expect(intoWon).toEqual({ ok: false, reason: 'invalid_status_change', from: 'open', to: 'won' });
    const payables = await payablesOf(created.sale.id);
    expect(payables).toEqual([]);
  });

  it('rejects a row id from another sale', async () => {
    const orgId = newOrg('foreign');
    const { product } = await seedProduct(orgId);
    const base = {
      clientName: 'Cliente A',
      sellerName: 'Ana Martins',
      status: 'draft' as const,
      baseDate: '2026-08-01',
      items: [{ productId: product.id, productName: 'Consultoria', quantity: 1, unitBrl: 100000 }],
      installments: [{ dueDate: '2026-08-01', amountBrl: 100000, method: 'pix' as const }],
    };
    const saleA = await createSale(db, orgId, CreateSaleSchema.parse(base));
    const saleB = await createSale(db, orgId, CreateSaleSchema.parse({ ...base, clientName: 'Cliente B' }));
    const [foreignItem] = await idsOf('items', saleB.sale.id);

    await expect(
      updateSale(
        db,
        orgId,
        saleA.sale.id,
        UpdateSaleSchema.parse({
          ...base,
          clientName: 'Sequestro',
          items: [{ ...base.items[0], id: foreignItem!.id }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'item_not_found', itemIndex: 0 });

    const [sale] = await adminClient`
      SELECT client_name_snapshot FROM sales_ops_sales WHERE id = ${saleA.sale.id}`;
    expect((sale as { client_name_snapshot: string }).client_name_snapshot).toBe('Cliente A');
    expect(await idsOf('items', saleA.sale.id)).toHaveLength(1);
    expect(await idsOf('items', saleB.sale.id)).toEqual([{ id: foreignItem!.id, removed_at: null }]);
  });

  it('a professional removed from a draft gets no payable when the proposta is won later', async () => {
    const orgId = newOrg('draft_win');
    const { product } = await seedProduct(orgId);
    const created = await createSale(
      db,
      orgId,
      CreateSaleSchema.parse({
        clientName: 'Cliente',
        sellerName: 'Ana Martins',
        status: 'draft',
        baseDate: '2026-08-01',
        items: [{ productId: product.id, productName: 'Consultoria', quantity: 1, unitBrl: 100000 }],
        professionals: [{ personName: 'Julia Prado', role: 'Design', costBrl: 20000 }],
        installments: [{ dueDate: '2026-08-01', amountBrl: 100000, method: 'pix' }],
      }),
    );
    const saleId = created.sale.id;
    const [r1] = await receivablesOf(saleId);
    const edited = await updateSale(
      db,
      orgId,
      saleId,
      UpdateSaleSchema.parse({
        clientName: 'Cliente',
        sellerName: 'Ana Martins',
        status: 'draft',
        baseDate: '2026-08-01',
        items: [{ productId: product.id, productName: 'Consultoria', quantity: 1, unitBrl: 100000 }],
        professionals: [],
        installments: [{ id: r1!.id, dueDate: '2026-08-01', amountBrl: 100000, method: 'pix' }],
      }),
    );
    expect(edited.ok).toBe(true);

    const won = await transitionSale(db, orgId, saleId, 'won');
    expect(won.ok).toBe(true);
    const payables = await payablesOf(saleId);
    expect(payables.map((row) => row.kind)).toEqual(['seller_commission', 'tax']);
  });

  it('the won to open revert bumps the revision of each voided payable', async () => {
    const orgId = newOrg('revert');
    const fixture = await createWonSale(orgId);

    const reverted = await transitionSale(db, orgId, fixture.saleId, 'open');
    expect(reverted.ok).toBe(true);

    const payables = await payablesOf(fixture.saleId);
    expect(payables).toHaveLength(7);
    expect(payables.every((row) => row.status === 'void' && row.revision === 2)).toBe(true);
  });

  it('a counterparty change bumps the revision of the affected payables', async () => {
    const orgId = newOrg('counterparty');
    const fixture = await createWonSale(orgId);
    const before = await payablesOf(fixture.saleId);

    const result = await updateSale(
      db,
      orgId,
      fixture.saleId,
      wonUpdate(fixture, {
        sellerName: 'Bruno Lima',
        installments: [
          { id: fixture.r1.id, dueDate: '2026-08-01', amountBrl: 100000, method: 'pix' },
          { id: fixture.r2.id, dueDate: '2026-09-01', amountBrl: 200000, method: 'pix' },
        ],
      }),
    );
    expect(result.ok).toBe(true);

    const after = await payablesOf(fixture.saleId);
    expect(after.map((row) => row.id)).toEqual(before.map((row) => row.id));
    for (const row of after) {
      if (row.kind === 'seller_commission') {
        expect([row.beneficiary_name, row.revision]).toEqual(['Bruno Lima', 2]);
      } else {
        expect(row.revision).toBe(1);
      }
    }
  });
});
