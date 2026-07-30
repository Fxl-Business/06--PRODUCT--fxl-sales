/**
 * Slice 03 (proposal-write-backend) integration coverage.
 *
 * Exercises the REAL createSale/updateSale service functions against the
 * local test DB through the non-superuser app role (so RLS is genuinely
 * enforced), following the areas-rls.test.ts / conversion-ingest.test.ts
 * pattern: real functions on drizzle(postgres(TEST_DATABASE_URL), { schema }),
 * with an admin (superuser) connection used for raw verification, cleanup,
 * and seeding fixtures the Zod schemas would otherwise reject (an area-less
 * product).
 *
 * Run: pnpm --filter @fxl-sales/api test:integration
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.js';
import {
  AreaSchema,
  CreateSaleSchema,
  ProductSchema,
  SaleInputError,
  UpdateSaleSchema,
  createArea,
  createProduct,
  createSale,
  getSalesOpsSnapshot,
  updateSale,
} from '../../src/domains/sales-ops/service.js';

const APP_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5006/fxl_sales';
const ADMIN_DB_URL = process.env.ADMIN_DATABASE_URL ?? APP_DB_URL;
const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;

describe('proposal write backend (create v2 + update + payable materialization)', () => {
  let appClient: postgres.Sql;
  let adminClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const orgIds: string[] = [];

  beforeAll(() => {
    appClient = postgres(APP_DB_URL, { max: 5 });
    adminClient = postgres(ADMIN_DB_URL, { max: 5, ...ADMIN_CONNECTION_OPTIONS });
    db = drizzle(appClient, { schema });
  });

  afterAll(async () => {
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

  async function seedAreaAndProduct(orgId: string, areaName: string) {
    const area = await createArea(db, orgId, AreaSchema.parse({ name: areaName }));
    if (area === 'duplicate') throw new Error('unexpected duplicate area');
    const { product } = await createProduct(
      db,
      orgId,
      ProductSchema.parse({ name: `Produto ${areaName}`, areaId: area.id }),
    );
    return { area, product };
  }

  it('create v2 persists the explicit plan without payables until won', async () => {
    const orgId = `org_pw_create_${Date.now()}`;
    orgIds.push(orgId);

    const { product } = await seedAreaAndProduct(orgId, 'FXL Tech');
    const freeArea = await createArea(db, orgId, AreaSchema.parse({ name: 'FXL Visual' }));
    if (freeArea === 'duplicate') throw new Error('unexpected duplicate area');

    const input = CreateSaleSchema.parse({
      clientName: 'Cliente Proposta',
      sellerName: 'Ana Martins',
      status: 'open',
      baseDate: '2026-07-29',
      items: [
        { productId: product.id, productName: 'Consultoria FXL Tech', quantity: 1, unitBrl: 400000 },
        {
          productName: 'Serviço avulso',
          areaId: freeArea.id,
          quantity: 1,
          unitBrl: 100000,
        },
      ],
      professionals: [],
      installments: [
        { dueDate: '2026-08-01', amountBrl: 300000, method: 'pix' },
        { dueDate: '2026-09-01', amountBrl: 200000, method: 'boleto' },
      ],
      recurring: { monthlyBrl: 50000, startDate: '2026-10-01', cycles: 2, method: 'transfer' },
    });

    const result = await createSale(db, orgId, input);

    expect(result.sale.wonAt).toBeNull();
    expect(result.payables).toEqual([]);
    expect(result.sale.paymentMethod).toBe('pix');
    expect(result.sale.condition).toBe('recurring');
    expect(result.sale.installments).toBe(2);
    expect(result.sale.totalBrl).toBe(600000);

    const receivableRows = await adminClient`
      SELECT label, method, amount_brl, due_date FROM sales_ops_receivables
      WHERE sale_id = ${result.sale.id} ORDER BY due_date ASC`;
    expect(receivableRows.map((row) => [row.label, row.method, row.amount_brl])).toEqual([
      ['1/2', 'pix', 300000],
      ['2/2', 'boleto', 200000],
      ['M1/2', 'transfer', 50000],
      ['M2/2', 'transfer', 50000],
    ]);
    expect((receivableRows[0] as { due_date: Date }).due_date.toISOString().slice(0, 10)).toBe(
      '2026-08-01',
    );
    expect((receivableRows[3] as { due_date: Date }).due_date.toISOString().slice(0, 10)).toBe(
      '2026-11-01',
    );

    const itemRows = await adminClient`
      SELECT area_id, area_name_snapshot, product_name_snapshot FROM sales_ops_sale_items
      WHERE sale_id = ${result.sale.id}`;
    expect(itemRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          area_id: product.areaId,
          area_name_snapshot: 'FXL Tech',
          product_name_snapshot: 'Consultoria FXL Tech',
        }),
        expect.objectContaining({
          area_id: freeArea.id,
          area_name_snapshot: 'FXL Visual',
          product_name_snapshot: 'Serviço avulso',
        }),
      ]),
    );

    const payableCount = await adminClient`
      SELECT count(*)::int AS n FROM sales_ops_payables WHERE sale_id = ${result.sale.id}`;
    expect((payableCount[0] as { n: number }).n).toBe(0);
  });

  it('create with status won materializes per-receivable payables immediately', async () => {
    const orgId = `org_pw_won_${Date.now()}`;
    orgIds.push(orgId);

    const { product } = await seedAreaAndProduct(orgId, 'FXL Tech');

    const input = CreateSaleSchema.parse({
      clientName: 'Cliente Ganho',
      sellerName: 'Ana Martins',
      status: 'won',
      baseDate: '2026-07-29',
      sellerCommissionPct: 10,
      finderCommissionPct: 3,
      taxPct: 6,
      otherCostsBrl: 20000,
      items: [
        { productId: product.id, productName: 'Consultoria FXL Tech', quantity: 1, unitBrl: 500000 },
      ],
      professionals: [{ personName: 'Rafael Nunes', role: 'Desenvolvimento', costBrl: 100000 }],
      installments: [{ dueDate: '2026-07-29', amountBrl: 500000, method: 'pix' }],
    });

    const result = await createSale(db, orgId, input);
    expect(result.sale.wonAt).not.toBeNull();

    const receivable = await adminClient`
      SELECT id, amount_brl FROM sales_ops_receivables WHERE sale_id = ${result.sale.id}`;
    expect(receivable).toHaveLength(1);
    const receivableId = (receivable[0] as { id: string }).id;

    const payables = await adminClient`
      SELECT kind, amount_brl, receivable_id, beneficiary_name FROM sales_ops_payables
      WHERE sale_id = ${result.sale.id} ORDER BY kind ASC, amount_brl DESC`;
    const byKind = Object.fromEntries(
      payables.map((row) => [
        (row as { kind: string }).kind,
        row as { amount_brl: number; receivable_id: string | null; beneficiary_name: string },
      ]),
    );

    expect(byKind.seller_commission?.amount_brl).toBe(50000);
    expect(byKind.seller_commission?.receivable_id).toBe(receivableId);
    expect(byKind.tax?.amount_brl).toBe(30000);
    expect(byKind.tax?.receivable_id).toBe(receivableId);
    expect(byKind.professional_cost?.amount_brl).toBe(100000);
    expect(byKind.professional_cost?.receivable_id).toBeNull();
    expect(byKind.other_cost?.amount_brl).toBe(20000);
    expect(byKind.other_cost?.receivable_id).toBeNull();
    expect(byKind.finder_commission).toBeUndefined();
  });

  it('update fully replaces items, professionals, and receivables in one transaction', async () => {
    const orgId = `org_pw_update_${Date.now()}`;
    orgIds.push(orgId);

    const { product } = await seedAreaAndProduct(orgId, 'FXL Tech');

    const draftInput = CreateSaleSchema.parse({
      clientName: 'Cliente Draft',
      sellerName: 'Ana Martins',
      status: 'draft',
      baseDate: '2026-07-29',
      items: [
        { productId: product.id, productName: 'Consultoria inicial', quantity: 1, unitBrl: 200000 },
      ],
      professionals: [{ personName: 'Julia Prado', role: 'Design', costBrl: 50000 }],
      installments: [{ dueDate: '2026-07-29', amountBrl: 200000, method: 'pix' }],
    });
    const created = await createSale(db, orgId, draftInput);

    const updateInput = UpdateSaleSchema.parse({
      clientName: 'Cliente Atualizado',
      sellerName: 'Ana Martins',
      status: 'open',
      baseDate: '2026-08-01',
      items: [
        { productId: product.id, productName: 'Consultoria renovada', quantity: 1, unitBrl: 300000 },
      ],
      professionals: [],
      installments: [{ dueDate: '2026-08-01', amountBrl: 300000, method: 'boleto' }],
    });
    const updated = await updateSale(db, orgId, created.sale.id, updateInput);

    if (!updated.ok) throw new Error(`expected ok, got ${JSON.stringify(updated)}`);
    expect(updated.sale.code).toBe(created.sale.code);
    expect(updated.sale.sequence).toBe(created.sale.sequence);
    expect(updated.sale.clientNameSnapshot).toBe('Cliente Atualizado');

    const items = await adminClient`
      SELECT product_name_snapshot, unit_brl FROM sales_ops_sale_items WHERE sale_id = ${created.sale.id}`;
    expect(items).toEqual([
      expect.objectContaining({ product_name_snapshot: 'Consultoria renovada', unit_brl: 300000 }),
    ]);

    const professionals = await adminClient`
      SELECT * FROM sales_ops_sale_professionals WHERE sale_id = ${created.sale.id}`;
    expect(professionals).toHaveLength(0);

    const receivables = await adminClient`
      SELECT label, amount_brl, method FROM sales_ops_receivables WHERE sale_id = ${created.sale.id}`;
    expect(receivables).toEqual([
      expect.objectContaining({ label: '1/1', amount_brl: 300000, method: 'boleto' }),
    ]);
  });

  it('update is rejected for a won proposta', async () => {
    const orgId = `org_pw_won_update_${Date.now()}`;
    orgIds.push(orgId);

    const { product } = await seedAreaAndProduct(orgId, 'FXL Tech');

    const wonInput = CreateSaleSchema.parse({
      clientName: 'Cliente Fechado',
      sellerName: 'Ana Martins',
      status: 'won',
      baseDate: '2026-07-29',
      items: [
        { productId: product.id, productName: 'Consultoria', quantity: 1, unitBrl: 200000 },
      ],
      professionals: [],
      installments: [{ dueDate: '2026-07-29', amountBrl: 200000, method: 'pix' }],
    });
    const wonSale = await createSale(db, orgId, wonInput);

    const before = await adminClient`
      SELECT count(*)::int AS n FROM sales_ops_sale_items WHERE sale_id = ${wonSale.sale.id}`;

    const attempt = UpdateSaleSchema.parse({
      clientName: 'Tentativa de edição',
      sellerName: 'Ana Martins',
      status: 'open',
      baseDate: '2026-07-30',
      items: [
        { productId: product.id, productName: 'Consultoria alterada', quantity: 1, unitBrl: 300000 },
      ],
      professionals: [],
      installments: [{ dueDate: '2026-07-30', amountBrl: 300000, method: 'pix' }],
    });
    const result = await updateSale(db, orgId, wonSale.sale.id, attempt);

    expect(result).toEqual({ ok: false, reason: 'not_editable', status: 'won' });

    const after = await adminClient`
      SELECT count(*)::int AS n FROM sales_ops_sale_items WHERE sale_id = ${wonSale.sale.id}`;
    expect((after[0] as { n: number }).n).toBe((before[0] as { n: number }).n);
  });

  it('update returns not_found across tenants', async () => {
    const orgA = `org_pw_tenant_a_${Date.now()}`;
    const orgB = `org_pw_tenant_b_${Date.now()}`;
    orgIds.push(orgA, orgB);

    const { product } = await seedAreaAndProduct(orgA, 'FXL Tech');

    const input = CreateSaleSchema.parse({
      clientName: 'Cliente Tenant A',
      sellerName: 'Ana Martins',
      status: 'draft',
      baseDate: '2026-07-29',
      items: [
        { productId: product.id, productName: 'Consultoria', quantity: 1, unitBrl: 150000 },
      ],
      professionals: [],
      installments: [{ dueDate: '2026-07-29', amountBrl: 150000, method: 'pix' }],
    });
    const createdA = await createSale(db, orgA, input);

    const crossTenantUpdate = UpdateSaleSchema.parse({
      clientName: 'Sequestro tentado',
      sellerName: 'Invasor',
      status: 'open',
      baseDate: '2026-07-30',
      items: [
        { productId: product.id, productName: 'Consultoria', quantity: 1, unitBrl: 150000 },
      ],
      professionals: [],
      installments: [{ dueDate: '2026-07-30', amountBrl: 150000, method: 'pix' }],
    });
    const result = await updateSale(db, orgB, createdA.sale.id, crossTenantUpdate);

    expect(result).toEqual({ ok: false, reason: 'not_found' });

    const stillThere = await adminClient`
      SELECT client_name_snapshot FROM sales_ops_sales WHERE id = ${createdA.sale.id}`;
    expect(stillThere).toEqual([expect.objectContaining({ client_name_snapshot: 'Cliente Tenant A' })]);
  });

  it('create rejects a product without an area', async () => {
    const orgId = `org_pw_no_area_${Date.now()}`;
    orgIds.push(orgId);

    const [areaLessProduct] = await adminClient`
      INSERT INTO sales_ops_products
        (org_id, name, seller_commission_value, seller_with_finder_commission_value, finder_commission_value)
      VALUES (${orgId}, 'Produto sem area', '10.00', '10.00', '3.00')
      RETURNING id`;
    const productId = (areaLessProduct as { id: string }).id;

    const input = CreateSaleSchema.parse({
      clientName: 'Cliente Sem Area',
      sellerName: 'Ana Martins',
      status: 'open',
      baseDate: '2026-07-29',
      items: [{ productId, productName: 'Produto sem area', quantity: 1, unitBrl: 100000 }],
      professionals: [],
      installments: [{ dueDate: '2026-07-29', amountBrl: 100000, method: 'pix' }],
    });

    let caught: unknown;
    try {
      await createSale(db, orgId, input);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SaleInputError);
    expect((caught as SaleInputError).code).toBe('product_area_missing');
    expect((caught as SaleInputError).itemIndex).toBe(0);
  });

  it('bootstrap snapshot includes receivables', async () => {
    const orgId = `org_pw_snapshot_${Date.now()}`;
    orgIds.push(orgId);

    const { product } = await seedAreaAndProduct(orgId, 'FXL Tech');

    const input = CreateSaleSchema.parse({
      clientName: 'Cliente Snapshot',
      sellerName: 'Ana Martins',
      status: 'open',
      baseDate: '2026-07-29',
      items: [
        { productId: product.id, productName: 'Consultoria', quantity: 1, unitBrl: 100000 },
      ],
      professionals: [{ personName: 'Equipe Interna', role: 'Suporte', costBrl: 20000 }],
      installments: [{ dueDate: '2026-07-29', amountBrl: 100000, method: 'pix' }],
    });
    const created = await createSale(db, orgId, input);

    const snapshot = await getSalesOpsSnapshot(db, orgId);

    expect(snapshot.receivables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ saleId: created.sale.id, amountBrl: 100000 }),
      ]),
    );
    expect(snapshot.saleProfessionals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ saleId: created.sale.id, personNameSnapshot: 'Equipe Interna' }),
      ]),
    );
  });
});
