import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProductSchema } from '../service.js';

const completeProduct = {
  name: 'Commission scenarios',
  areaId: '33333333-3333-4333-8333-333333333333',
  sellerCommissionType: 'pct' as const,
  sellerCommissionValue: 10,
  sellerWithFinderCommissionType: 'pct' as const,
  sellerWithFinderCommissionValue: 7,
  finderCommissionType: 'pct' as const,
  finderCommissionValue: 3,
};

describe('sales operations product commission contract', () => {
  it('accepts independent seller-only and seller-with-finder commission pairs', () => {
    const parsed = ProductSchema.parse(completeProduct);

    expect(parsed).toMatchObject({
      sellerCommissionType: 'pct',
      sellerCommissionValue: 10,
      sellerWithFinderCommissionType: 'pct',
      sellerWithFinderCommissionValue: 7,
      finderCommissionType: 'pct',
      finderCommissionValue: 3,
    });
  });

  it('accepts a legacy create payload without seller-with-finder fields', () => {
    const { sellerWithFinderCommissionType, sellerWithFinderCommissionValue, ...legacyProduct } =
      completeProduct;

    expect(sellerWithFinderCommissionType).toBe('pct');
    expect(sellerWithFinderCommissionValue).toBe(7);
    expect(ProductSchema.parse(legacyProduct)).not.toHaveProperty(
      'sellerWithFinderCommissionType',
    );
    expect(ProductSchema.parse(legacyProduct)).not.toHaveProperty(
      'sellerWithFinderCommissionValue',
    );
  });

  it.each([
    'sellerCommissionValue',
    'sellerWithFinderCommissionValue',
    'finderCommissionValue',
  ] as const)('rejects negative commission values for %s', (field) => {
    expect(ProductSchema.safeParse({ ...completeProduct, [field]: -0.01 }).success).toBe(false);
  });

  it.each([
    'sellerCommissionType',
    'sellerWithFinderCommissionType',
    'finderCommissionType',
  ] as const)('rejects unsupported commission types for %s', (field) => {
    expect(ProductSchema.safeParse({ ...completeProduct, [field]: 'rate' }).success).toBe(false);
  });

  it('backfills seller-with-finder fields from the existing seller pair before enforcing NOT NULL', () => {
    const migrationPath = resolve(process.cwd(), 'drizzle/0009_product_commission_scenarios.sql');
    expect(existsSync(migrationPath), `missing migration: ${migrationPath}`).toBe(true);

    const migration = readFileSync(migrationPath, 'utf8');
    const adminContextIndex = migration.indexOf(
      "SELECT set_config('app.fxl_admin', 'true', true)",
    );
    const updateIndex = migration.indexOf('UPDATE "sales_ops_products"');
    const typeNotNullIndex = migration.indexOf(
      'ALTER COLUMN "seller_with_finder_commission_type" SET NOT NULL',
    );
    const valueNotNullIndex = migration.indexOf(
      'ALTER COLUMN "seller_with_finder_commission_value" SET NOT NULL',
    );

    expect(migration).toContain(
      'ADD COLUMN "seller_with_finder_commission_type" text',
    );
    expect(migration).toContain(
      'ADD COLUMN "seller_with_finder_commission_value" numeric(10, 2)',
    );
    expect(migration).toMatch(
      /SET\s+"seller_with_finder_commission_type"\s*=\s*"seller_commission_type",\s*"seller_with_finder_commission_value"\s*=\s*"seller_commission_value"/s,
    );
    expect(adminContextIndex).toBeGreaterThan(-1);
    expect(adminContextIndex).toBeLessThan(updateIndex);
    expect(migration).not.toMatch(/set_config\('app\.fxl_admin',\s*'true',\s*false\)/i);
    expect(updateIndex).toBeGreaterThan(-1);
    expect(typeNotNullIndex).toBeGreaterThan(updateIndex);
    expect(valueNotNullIndex).toBeGreaterThan(updateIndex);
    expect(migration).not.toMatch(/DROP COLUMN/i);
    expect(migration).not.toMatch(/SET\s+"has_finder_commission"\s*=/i);
    expect(migration).not.toMatch(/SET\s+"seller_commission_(?:type|value)"\s*=/i);
    expect(migration).not.toMatch(/SET\s+"finder_commission_(?:type|value)"\s*=/i);
  });
});
