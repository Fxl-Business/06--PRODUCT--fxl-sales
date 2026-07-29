import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.js';
import {
  AreaSchema,
  createArea,
  getArea,
  getSalesOpsSnapshot,
  listAreas,
  updateArea,
} from '../../src/domains/sales-ops/service.js';

const APP_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5006/fxl_sales';
const ADMIN_DB_URL = process.env.ADMIN_DATABASE_URL ?? APP_DB_URL;
const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;

/**
 * Builds a connection string for a different role against the same host/port/db as
 * APP_DB_URL, so the raw-RLS test below can exercise policies through a real
 * non-superuser role instead of the local dev "postgres" superuser role (which
 * always bypasses row security regardless of FORCE ROW LEVEL SECURITY).
 */
function withRole(url: string, username: string, password: string): string {
  const parsed = new URL(url);
  parsed.username = username;
  parsed.password = password;
  return parsed.toString();
}

describe('sales operations areas persistence and RLS', () => {
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

  it('area CRUD stays tenant-scoped through the service layer', async () => {
    const orgA = `org_areas_a_${Date.now()}`;
    const orgB = `org_areas_b_${Date.now()}`;
    orgIds.push(orgA, orgB);

    const areaA = await createArea(db, orgA, AreaSchema.parse({ name: 'FXL Tech' }));
    if (areaA === 'duplicate') throw new Error('unexpected duplicate');
    expect(areaA.status).toBe('active');

    const listedA = await listAreas(db, orgA);
    expect(listedA).toEqual([expect.objectContaining({ id: areaA.id })]);

    expect(await listAreas(db, orgB)).toEqual([]);
    expect(await getArea(db, orgB, areaA.id)).toBeNull();
    expect(await updateArea(db, orgB, areaA.id, { name: 'hijack' })).toBeNull();

    const archived = await updateArea(db, orgA, areaA.id, { status: 'archived' });
    if (archived === 'duplicate') throw new Error('unexpected duplicate');
    expect(archived?.status).toBe('archived');
    expect(archived?.updatedAt).not.toBeNull();
  });

  it('createArea reports duplicates per org but allows the same name in another org', async () => {
    const orgA = `org_areas_dup_a_${Date.now()}`;
    const orgB = `org_areas_dup_b_${Date.now()}`;
    orgIds.push(orgA, orgB);

    const first = await createArea(db, orgA, { name: 'FXL Tech', status: 'active' });
    if (first === 'duplicate') throw new Error('unexpected duplicate on first insert');

    const duplicate = await createArea(db, orgA, { name: 'FXL Tech', status: 'active' });
    expect(duplicate).toBe('duplicate');

    const otherOrg = await createArea(db, orgB, { name: 'FXL Tech', status: 'active' });
    expect(otherOrg).not.toBe('duplicate');
  });

  it('getArea refuses to resolve another org area for product binding', async () => {
    const orgA = `org_areas_bind_a_${Date.now()}`;
    const orgB = `org_areas_bind_b_${Date.now()}`;
    orgIds.push(orgA, orgB);

    const areaA = await createArea(db, orgA, AreaSchema.parse({ name: 'FXL Tech' }));
    if (areaA === 'duplicate') throw new Error('unexpected duplicate');

    expect(await getArea(db, orgB, areaA.id)).toBeNull();
  });

  it('bootstrap snapshot includes the org areas', async () => {
    const orgA = `org_areas_snap_a_${Date.now()}`;
    const orgB = `org_areas_snap_b_${Date.now()}`;
    orgIds.push(orgA, orgB);

    const areaA = await createArea(db, orgA, AreaSchema.parse({ name: 'FXL Visual' }));
    if (areaA === 'duplicate') throw new Error('unexpected duplicate');

    const orgAAreas = await listAreas(db, orgA);
    const snapshotA = await getSalesOpsSnapshot(db, orgA);
    expect(snapshotA.areas).toEqual(orgAAreas);

    const snapshotB = await getSalesOpsSnapshot(db, orgB);
    expect(snapshotB.areas).toEqual([]);
  });

  it('raw RLS blocks cross-org reads and WITH CHECK blocks smuggled inserts', async () => {
    // The local dev connection (postgres) is a cluster superuser and therefore
    // always bypasses row security, FORCE ROW LEVEL SECURITY included. To prove
    // the policies themselves are correct (not just the service layer's explicit
    // orgId filters), provision a scoped, non-superuser role for the duration of
    // this test and drop it again afterward.
    const roleName = `rls_probe_${randomUUID().replace(/-/g, '_')}`;
    const rolePassword = randomUUID();

    await adminClient.unsafe(
      `CREATE ROLE ${roleName} LOGIN PASSWORD '${rolePassword}' NOSUPERUSER NOBYPASSRLS`,
    );
    await adminClient.unsafe(`GRANT USAGE ON SCHEMA public TO ${roleName}`);
    await adminClient.unsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON sales_ops_areas TO ${roleName}`,
    );

    const roleClient = postgres(withRole(APP_DB_URL, roleName, rolePassword), { max: 1 });

    try {
      const ORG_A = `org_areas_rls_a_${Date.now()}`;
      const ORG_B = `org_areas_rls_b_${Date.now()}`;
      orgIds.push(ORG_A, ORG_B);

      const [inserted] = await roleClient.begin(async (tx) => {
        await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
        return tx`
          INSERT INTO sales_ops_areas (org_id, name)
          VALUES (${ORG_A}, 'RLS Probe Area')
          RETURNING id
        `;
      });
      const id = (inserted as { id: string }).id;

      const ownRows = await roleClient.begin(async (tx) => {
        await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
        return tx`SELECT id FROM sales_ops_areas WHERE id = ${id}`;
      });
      expect(ownRows).toHaveLength(1);

      const otherRows = await roleClient.begin(async (tx) => {
        await tx`SELECT set_config('app.current_org_id', ${ORG_B}, true)`;
        return tx`SELECT id FROM sales_ops_areas WHERE id = ${id}`;
      });
      expect(otherRows).toHaveLength(0);

      await expect(
        roleClient.begin(async (tx) => {
          await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
          return tx`
            INSERT INTO sales_ops_areas (org_id, name)
            VALUES (${ORG_B}, 'Smuggled Area')
            RETURNING id
          `;
        }),
      ).rejects.toThrow();
    } finally {
      await roleClient.end();
      await adminClient.unsafe(`DROP OWNED BY ${roleName}`);
      await adminClient.unsafe(`DROP ROLE ${roleName}`);
    }
  });
});
