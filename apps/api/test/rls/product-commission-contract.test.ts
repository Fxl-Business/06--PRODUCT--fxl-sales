import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.js';
import {
  AreaSchema,
  ProductSchema,
  createArea,
  createProduct,
  listProducts,
  updateProduct,
} from '../../src/domains/sales-ops/service.js';

/**
 * The actor threaded through every sales-ops cadastro write. Only the
 * archive/restore lifecycle is audited, so most calls here produce no ledger row
 * at all - but the parameter is required, and passing it is what keeps these
 * suites exercising the real route-to-service signature.
 */
const TEST_ACTOR = { userId: 'acct_rls_test', displayName: 'RLS Test Actor' } as const;

const APP_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5006/fxl_sales';
const ADMIN_DB_URL = process.env.ADMIN_DATABASE_URL ?? APP_DB_URL;
const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;

describe('sales operations product commission persistence', () => {
  let appClient: postgres.Sql;
  let adminClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const orgIds: string[] = [];

  beforeAll(() => {
    appClient = postgres(APP_DB_URL, { max: 2 });
    adminClient = postgres(ADMIN_DB_URL, { max: 1, ...ADMIN_CONNECTION_OPTIONS });
    db = drizzle(appClient, { schema });
  });

  afterAll(async () => {
    for (const orgId of orgIds) {
      await adminClient`DELETE FROM sales_ops_products WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_areas WHERE org_id = ${orgId}`;
    }
    await appClient.end();
    await adminClient.end();
  });

  it('persists independent commission pairs through create, partial updates, and list', async () => {
    const orgId = `org_product_commission_${Date.now()}`;
    orgIds.push(orgId);
    const area = await createArea(db, orgId, AreaSchema.parse({ name: 'FXL Tech' }));
    if (area === 'duplicate') throw new Error('unexpected duplicate area');
    const { product: created } = await createProduct(
      db,
      orgId,
      ProductSchema.parse({
        name: 'Independent commissions',
        codeSuffix: '91',
        areaId: area.id,
        sellerCommissionType: 'pct',
        sellerCommissionValue: 10,
        sellerWithFinderCommissionType: 'pct',
        sellerWithFinderCommissionValue: 7,
        finderCommissionType: 'pct',
        finderCommissionValue: 3,
      }),
    );

    expect(created.sellerCommissionValue).toBe('10.00');
    expect(created.sellerWithFinderCommissionValue).toBe('7.00');
    expect(created.finderCommissionValue).toBe('3.00');

    const sellerOnlyUpdate = await updateProduct(
      db,
      orgId,
      created.id,
      {
        sellerCommissionValue: 11,
      },
      TEST_ACTOR,
    );
    if (typeof sellerOnlyUpdate === 'string' || !sellerOnlyUpdate) {
      throw new Error(`unexpected update outcome: ${String(sellerOnlyUpdate)}`);
    }
    expect(sellerOnlyUpdate.product.sellerCommissionValue).toBe('11.00');
    expect(sellerOnlyUpdate.product.sellerWithFinderCommissionValue).toBe('7.00');

    const splitUpdate = await updateProduct(
      db,
      orgId,
      created.id,
      {
        sellerWithFinderCommissionValue: 8,
      },
      TEST_ACTOR,
    );
    if (typeof splitUpdate === 'string' || !splitUpdate) {
      throw new Error(`unexpected update outcome: ${String(splitUpdate)}`);
    }
    expect(splitUpdate.product.sellerCommissionValue).toBe('11.00');
    expect(splitUpdate.product.sellerWithFinderCommissionValue).toBe('8.00');
    expect(splitUpdate.product.finderCommissionValue).toBe('3.00');

    const listed = await listProducts(db, orgId);
    expect(listed).toEqual([
      expect.objectContaining({
        areaId: created.areaId,
        sellerCommissionValue: '11.00',
        sellerWithFinderCommissionType: 'pct',
        sellerWithFinderCommissionValue: '8.00',
        finderCommissionValue: '3.00',
      }),
    ]);
  });

  it('copies the seller-only pair when a legacy create payload omits the new pair', async () => {
    const orgId = `org_product_commission_legacy_${Date.now()}`;
    orgIds.push(orgId);
    const area = await createArea(db, orgId, AreaSchema.parse({ name: 'FXL Tech' }));
    if (area === 'duplicate') throw new Error('unexpected duplicate area');
    const { product: created } = await createProduct(
      db,
      orgId,
      ProductSchema.parse({
        name: 'Legacy fixed commission',
        codeSuffix: '92',
        areaId: area.id,
        sellerCommissionType: 'fix',
        sellerCommissionValue: 1234.56,
        finderCommissionType: 'fix',
        finderCommissionValue: 321,
      }),
    );

    expect(created.sellerWithFinderCommissionType).toBe('fix');
    expect(created.sellerWithFinderCommissionValue).toBe('1234.56');
  });
});
