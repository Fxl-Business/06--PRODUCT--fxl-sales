import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AreaSchema, ProductSchema } from '../service.js';

const completeProductWithoutAreaId = {
  name: 'Commission scenarios',
  sellerCommissionType: 'pct' as const,
  sellerCommissionValue: 10,
  sellerWithFinderCommissionType: 'pct' as const,
  sellerWithFinderCommissionValue: 7,
  finderCommissionType: 'pct' as const,
  finderCommissionValue: 3,
};

describe('sales operations areas contract', () => {
  it('accepts a minimal area payload and defaults status to active', () => {
    const parsed = AreaSchema.parse({ name: '  FXL Tech  ' });

    expect(parsed).toEqual({ name: 'FXL Tech', status: 'active' });
  });

  it('rejects an empty or blank area name', () => {
    expect(AreaSchema.safeParse({ name: '' }).success).toBe(false);
    expect(AreaSchema.safeParse({ name: '   ' }).success).toBe(false);
  });

  it('rejects unsupported area statuses', () => {
    expect(AreaSchema.safeParse({ name: 'X', status: 'deleted' }).success).toBe(false);
  });

  it('requires areaId on product create payloads', () => {
    expect(ProductSchema.safeParse(completeProductWithoutAreaId).success).toBe(false);
    expect(ProductSchema.partial().safeParse({ name: 'x' }).success).toBe(true);
  });

  it('seeds the six FXL areas behind the admin context after enabling forced RLS', () => {
    const migrationPath = resolve(process.cwd(), 'drizzle/0010_sales_ops_areas.sql');
    expect(existsSync(migrationPath), `missing migration: ${migrationPath}`).toBe(true);

    const migration = readFileSync(migrationPath, 'utf8');
    const enableRlsIndex = migration.indexOf('ENABLE ROW LEVEL SECURITY');
    const forceRlsIndex = migration.indexOf('FORCE ROW LEVEL SECURITY');
    const adminContextIndex = migration.indexOf(
      "SELECT set_config('app.fxl_admin', 'true', true)",
    );
    const insertIndex = migration.indexOf('INSERT INTO "sales_ops_areas"');

    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('sales_ops_areas_tenant_isolation');
    expect(migration).toContain('sales_ops_areas_admin_context');
    expect(migration).toContain("SELECT set_config('app.fxl_admin', 'true', true)");
    expect(migration).toContain('FXL Tech');
    expect(migration).toContain('FXL Visual');
    expect(migration).toContain('FXL Advisor');
    expect(migration).toContain('FXL BPO Sales');
    expect(migration).toContain('FXL Influência Estratégica');
    expect(migration).toContain('FXL Treinamentos');
    expect(migration).toContain('ON CONFLICT ("org_id", "name") DO NOTHING');
    expect(migration).toContain('ADD COLUMN "area_id" uuid');

    expect(enableRlsIndex).toBeGreaterThan(-1);
    expect(forceRlsIndex).toBeGreaterThan(enableRlsIndex);
    expect(adminContextIndex).toBeGreaterThan(-1);
    expect(adminContextIndex).toBeLessThan(insertIndex);
    expect(insertIndex).toBeGreaterThan(-1);

    expect(migration).not.toMatch(/set_config\('app\.fxl_admin',\s*'true',\s*false\)/i);
    expect(migration).not.toMatch(/"area_id"\s+uuid\s+NOT NULL/i);
  });
});
