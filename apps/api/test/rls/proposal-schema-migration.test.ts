import fs from 'node:fs';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.js';

const APP_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5006/fxl_sales';
const ADMIN_DB_URL = process.env.ADMIN_DATABASE_URL ?? APP_DB_URL;
const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;
const DRIZZLE_DIR = path.resolve(process.cwd(), 'drizzle');

describe('proposal schema migration 0011', () => {
  let adminClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const orgIds: string[] = [];

  beforeAll(() => {
    // Direct typed inserts below exercise raw schema/migration correctness (not
    // per-request RLS policy behavior, which is covered by areas-rls.test.ts), so
    // the admin connection is used throughout to bypass RLS and write freeform
    // fixture rows across the tables touched by migration 0011.
    adminClient = postgres(ADMIN_DB_URL, { max: 1, ...ADMIN_CONNECTION_OPTIONS });
    db = drizzle(adminClient, { schema });
  });

  afterAll(async () => {
    for (const orgId of orgIds) {
      await adminClient`DELETE FROM sales_ops_payables WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_receivables WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_sale_items WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_sales WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_areas WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_clients WHERE org_id = ${orgId}`;
    }
    await adminClient.end();
  });

  it('remaps legacy sale statuses and backfills won_at (replays the shipped 0011 backfill SQL)', async () => {
    const orgId = `org_proposal_migration_${Date.now()}`;
    orgIds.push(orgId);

    const createdAt = new Date('2026-01-01T09:00:00Z');
    const updatedAt = new Date('2026-01-05T12:00:00Z');

    const baseSale = {
      orgId,
      clientNameSnapshot: 'Cliente Teste',
      sellerNameSnapshot: 'Vendedor Teste',
      paymentMethod: 'pix',
      condition: 'cash',
      baseDate: createdAt,
      totalBrl: 100000,
      sellerCommissionPct: '10.00',
      finderCommissionPct: '0.00',
      taxPct: '6.00',
      netMarginPct: '80.00',
      createdAt,
    };

    const [closedRow] = await db
      .insert(schema.salesOpsSales)
      .values({ ...baseSale, sequence: 1, code: 'MIG-CLOSED', status: 'closed', updatedAt })
      .returning();
    const [completedRow] = await db
      .insert(schema.salesOpsSales)
      .values({
        ...baseSale,
        sequence: 2,
        code: 'MIG-COMPLETED',
        status: 'completed',
        updatedAt: null,
      })
      .returning();
    const [forecastRow] = await db
      .insert(schema.salesOpsSales)
      .values({ ...baseSale, sequence: 3, code: 'MIG-FORECAST', status: 'forecast' })
      .returning();
    const [inProgressRow] = await db
      .insert(schema.salesOpsSales)
      .values({ ...baseSale, sequence: 4, code: 'MIG-INPROGRESS', status: 'in_progress' })
      .returning();
    const [draftRow] = await db
      .insert(schema.salesOpsSales)
      .values({ ...baseSale, sequence: 5, code: 'MIG-DRAFT', status: 'draft' })
      .returning();
    const [cancelledRow] = await db
      .insert(schema.salesOpsSales)
      .values({ ...baseSale, sequence: 6, code: 'MIG-CANCELLED', status: 'cancelled' })
      .returning();

    const migrationFile = fs.readdirSync(DRIZZLE_DIR).find((f) => /^0011_.*\.sql$/.test(f));
    if (!migrationFile) throw new Error('migration 0011 file not found in drizzle directory');
    const sqlContent = fs.readFileSync(path.join(DRIZZLE_DIR, migrationFile), 'utf8');
    const statements = sqlContent
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter(Boolean);
    const backfillStartIndex = statements.findIndex((statement) =>
      statement.includes("set_config('app.fxl_admin'"),
    );
    if (backfillStartIndex === -1) {
      throw new Error('backfill statements not found in the shipped 0011 migration');
    }
    const backfillStatements = statements.slice(backfillStartIndex);

    await adminClient.begin(async (tx) => {
      for (const statement of backfillStatements) {
        await tx.unsafe(statement);
      }
    });

    const rows = await db
      .select()
      .from(schema.salesOpsSales)
      .where(eq(schema.salesOpsSales.orgId, orgId));
    const byId = new Map(rows.map((row) => [row.id, row]));

    const closed = byId.get(closedRow.id);
    expect(closed?.status).toBe('won');
    expect(closed?.wonAt?.toISOString()).toBe(updatedAt.toISOString());

    const completed = byId.get(completedRow.id);
    expect(completed?.status).toBe('won');
    expect(completed?.wonAt?.toISOString()).toBe(createdAt.toISOString());

    const forecast = byId.get(forecastRow.id);
    expect(forecast?.status).toBe('open');
    expect(forecast?.wonAt).toBeNull();

    const inProgress = byId.get(inProgressRow.id);
    expect(inProgress?.status).toBe('open');
    expect(inProgress?.wonAt).toBeNull();

    const draft = byId.get(draftRow.id);
    expect(draft?.status).toBe('draft');

    const cancelled = byId.get(cancelledRow.id);
    expect(cancelled?.status).toBe('cancelled');
  });

  it('new columns exist, accept writes, and receivable deletion nulls payable links', async () => {
    const orgId = `org_proposal_columns_${Date.now()}`;
    orgIds.push(orgId);

    const [client] = await db
      .insert(schema.salesOpsClients)
      .values({
        orgId,
        name: 'Cliente Legal',
        legalName: 'Cliente Legal LTDA',
        document: '12.345.678/0001-99',
        address: 'Rua Teste, 123',
        legalRepName: 'Fulano de Tal',
        legalRepDocument: '123.456.789-00',
      })
      .returning();

    const [area] = await db
      .insert(schema.salesOpsAreas)
      .values({ orgId, name: 'FXL Tech' })
      .returning();

    const wonAt = new Date('2026-02-01T10:00:00Z');
    const [sale] = await db
      .insert(schema.salesOpsSales)
      .values({
        orgId,
        sequence: 1,
        code: 'PROP-0001',
        clientId: client.id,
        clientNameSnapshot: client.name,
        sellerNameSnapshot: 'Vendedor Teste',
        status: 'won',
        wonAt,
        lostAt: null,
        paymentMethod: 'pix',
        condition: 'cash',
        baseDate: new Date('2026-02-01T00:00:00Z'),
        totalBrl: 500000,
        sellerCommissionPct: '10.00',
        finderCommissionPct: '0.00',
        taxPct: '6.00',
        netMarginPct: '80.00',
      })
      .returning();

    const [saleItem] = await db
      .insert(schema.salesOpsSaleItems)
      .values({
        orgId,
        saleId: sale.id,
        productNameSnapshot: 'Consultoria FXL Tech',
        productTypeSnapshot: 'Custom',
        areaId: area.id,
        areaNameSnapshot: 'FXL Tech',
        unitBrl: 500000,
        subtotalBrl: 500000,
      })
      .returning();

    const [receivable] = await db
      .insert(schema.salesOpsReceivables)
      .values({
        orgId,
        saleId: sale.id,
        label: 'Parcela unica',
        dueDate: new Date('2026-02-10T00:00:00Z'),
        amountBrl: 500000,
        method: 'boleto',
        status: 'void',
      })
      .returning();

    const [payable] = await db
      .insert(schema.salesOpsPayables)
      .values({
        orgId,
        saleId: sale.id,
        beneficiaryName: 'Vendedor Teste',
        kind: 'seller_commission',
        receivableId: receivable.id,
        dueDate: new Date('2026-02-10T00:00:00Z'),
        amountBrl: 50000,
      })
      .returning();

    const [readClient] = await db
      .select()
      .from(schema.salesOpsClients)
      .where(eq(schema.salesOpsClients.id, client.id));
    expect(readClient.legalName).toBe('Cliente Legal LTDA');
    expect(readClient.document).toBe('12.345.678/0001-99');
    expect(readClient.address).toBe('Rua Teste, 123');
    expect(readClient.legalRepName).toBe('Fulano de Tal');
    expect(readClient.legalRepDocument).toBe('123.456.789-00');

    const [readSale] = await db
      .select()
      .from(schema.salesOpsSales)
      .where(eq(schema.salesOpsSales.id, sale.id));
    expect(readSale.status).toBe('won');
    expect(readSale.wonAt?.toISOString()).toBe(wonAt.toISOString());
    expect(readSale.lostAt).toBeNull();

    const [readSaleItem] = await db
      .select()
      .from(schema.salesOpsSaleItems)
      .where(eq(schema.salesOpsSaleItems.id, saleItem.id));
    expect(readSaleItem.areaId).toBe(area.id);
    expect(readSaleItem.areaNameSnapshot).toBe('FXL Tech');

    const [readReceivable] = await db
      .select()
      .from(schema.salesOpsReceivables)
      .where(eq(schema.salesOpsReceivables.id, receivable.id));
    expect(readReceivable.method).toBe('boleto');
    expect(readReceivable.status).toBe('void');

    const [readPayable] = await db
      .select()
      .from(schema.salesOpsPayables)
      .where(eq(schema.salesOpsPayables.id, payable.id));
    expect(readPayable.receivableId).toBe(receivable.id);

    await db.delete(schema.salesOpsReceivables).where(eq(schema.salesOpsReceivables.id, receivable.id));

    const [payableAfterDelete] = await db
      .select()
      .from(schema.salesOpsPayables)
      .where(eq(schema.salesOpsPayables.id, payable.id));
    expect(payableAfterDelete.receivableId).toBeNull();

    const [defaultMethodReceivable] = await db
      .insert(schema.salesOpsReceivables)
      .values({
        orgId,
        saleId: sale.id,
        label: 'Parcela metodo padrao',
        dueDate: new Date('2026-03-10T00:00:00Z'),
        amountBrl: 100000,
      })
      .returning();
    expect(defaultMethodReceivable.method).toBe('pix');
  });
});
