/**
 * Slice 01 (sao-paulo-day) integration coverage.
 *
 * Exercises the REAL createSale/transitionSale/cancelContract service
 * functions against the local test DB through the non-superuser app role,
 * following the proposal-write.test.ts pattern: real functions on
 * drizzle(postgres(TEST_DATABASE_URL), { schema }), with an admin
 * (superuser) connection used for raw verification and cleanup.
 *
 * Run: pnpm --filter @fxl-sales/api test:integration test/rls/sao-paulo-day.test.ts
 */
import crypto from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.js';
import {
  AreaSchema,
  CreateSaleSchema,
  ProductSchema,
  cancelContract,
  createArea,
  createProduct,
  createSale,
  transitionSale,
} from '../../src/domains/sales-ops/service.js';
import { testDatabaseUrls } from '../../src/db/__tests__/test-database-urls.js';

const { appUrl: APP_DB_URL, adminUrl: ADMIN_DB_URL } = testDatabaseUrls();
const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;

describe('Sao Paulo civil day decisions (won date, cancel-contract cut-off)', () => {
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

  function newOrgId(name: string) {
    const orgId = `org_spday_${name}_${crypto.randomUUID()}`;
    orgIds.push(orgId);
    return orgId;
  }

  function saleBody(
    productId: string,
    overrides: {
      status: 'draft' | 'open' | 'won';
      installments: Array<{ dueDate: string; amountBrl: number; method: 'pix' }>;
    },
  ) {
    return {
      clientName: 'Cliente SP',
      sellerName: 'Ana Martins',
      status: overrides.status,
      baseDate: '2026-02-20',
      otherCostsBrl: 20000,
      items: [
        { productId, productName: 'Item SP', quantity: 1, unitBrl: 500000 },
      ],
      installments: overrides.installments,
    };
  }

  async function dueDayOf(orgId: string, saleId: string, kind: string) {
    const rows = await adminClient`
      SELECT to_char(due_date AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day
      FROM sales_ops_payables
      WHERE org_id = ${orgId} AND sale_id = ${saleId} AND kind = ${kind}
    `;
    return rows[0]?.day as string | undefined;
  }

  async function receivableStatus(orgId: string, dueDate: string) {
    const rows = await adminClient`
      SELECT status FROM sales_ops_receivables
      WHERE org_id = ${orgId} AND to_char(due_date AT TIME ZONE 'UTC', 'YYYY-MM-DD') = ${dueDate}
    `;
    return rows[0]?.status as string | undefined;
  }

  it('createSale straight into won dates the one-shot other_cost on the Sao Paulo day of the win', async () => {
    const orgId = newOrgId('create_won');
    const { product } = await seedAreaAndProduct(orgId, 'FXL SP Create');

    const input = CreateSaleSchema.parse(
      saleBody(product.id, {
        status: 'won',
        installments: [{ dueDate: '2026-02-20', amountBrl: 500000, method: 'pix' }],
      }),
    );
    const { sale } = await createSale(db, orgId, input, new Date('2026-03-01T01:30:00Z'));

    const day = await dueDayOf(orgId, sale.id, 'other_cost');
    expect(day).toBe('2026-02-28');
  });

  it('transitionSale to won dates the one-shot other_cost on the Sao Paulo day of the win', async () => {
    const orgId = newOrgId('transition_won');
    const { product } = await seedAreaAndProduct(orgId, 'FXL SP Transition');

    const input1 = CreateSaleSchema.parse(
      saleBody(product.id, {
        status: 'open',
        installments: [{ dueDate: '2026-02-20', amountBrl: 500000, method: 'pix' }],
      }),
    );
    const { sale: sale1 } = await createSale(db, orgId, input1);
    const result1 = await transitionSale(db, orgId, sale1.id, 'won', new Date('2026-03-01T01:30:00Z'));
    if (!result1.ok) throw new Error('expected transition 1 to succeed');
    const day1 = await dueDayOf(orgId, sale1.id, 'other_cost');
    expect(day1).toBe('2026-02-28');

    // Control: a later instant on the same UTC calendar day, after 03:00 UTC,
    // is already the next Sao Paulo day. Proves the helper is not a blanket
    // minus one.
    const input2 = CreateSaleSchema.parse(
      saleBody(product.id, {
        status: 'open',
        installments: [{ dueDate: '2026-02-20', amountBrl: 500000, method: 'pix' }],
      }),
    );
    const { sale: sale2 } = await createSale(db, orgId, input2);
    const result2 = await transitionSale(db, orgId, sale2.id, 'won', new Date('2026-03-01T03:30:00Z'));
    if (!result2.ok) throw new Error('expected transition 2 to succeed');
    const day2 = await dueDayOf(orgId, sale2.id, 'other_cost');
    expect(day2).toBe('2026-03-01');
  });

  it('cancelContract without an effective date cuts off at the Sao Paulo day, not the UTC day', async () => {
    const orgId = newOrgId('cancel_cutoff');
    const { product } = await seedAreaAndProduct(orgId, 'FXL SP Cancel');

    const input = CreateSaleSchema.parse(
      saleBody(product.id, {
        status: 'won',
        installments: [
          { dueDate: '2026-02-28', amountBrl: 250000, method: 'pix' },
          { dueDate: '2026-03-01', amountBrl: 250000, method: 'pix' },
        ],
      }),
    );
    const { sale } = await createSale(db, orgId, input);

    const result = await cancelContract(
      db,
      orgId,
      sale.id,
      undefined,
      new Date('2026-03-01T01:30:00Z'),
    );

    expect(result).toMatchObject({ ok: true, voidedReceivables: 1 });

    const feb28Status = await receivableStatus(orgId, '2026-02-28');
    const mar01Status = await receivableStatus(orgId, '2026-03-01');
    expect(feb28Status).toBe('open');
    expect(mar01Status).toBe('void');
  });
});
