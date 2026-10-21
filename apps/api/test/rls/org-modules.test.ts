/**
 * Per-organization modules against the real database: the one-time token backfill,
 * its concurrency, the token that stops deciding after it, RLS isolation and the
 * admin update. Same harness as `leads-edition.test.ts`: `db` is the app role under
 * RLS, `adminClient` runs with `app.fxl_admin` and reads the stored rows.
 */
import { randomUUID } from 'node:crypto';
import { CRM_MODULE_KEYS, modulesForEdition, type OrgModules } from '@fxl-sales/shared-utils/crm-model';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { salesOpsOrgModules } from '../../src/db/schema.js';
import { testDatabaseUrls } from '../../src/db/__tests__/test-database-urls.js';
import { loadOrgModules, updateOrgModules } from '../../src/domains/org-modules/service.js';
import { withTenant } from '../../src/domains/sales-ops/leads/with-tenant.js';

const { appUrl: APP_DB_URL, adminUrl: ADMIN_DB_URL } = testDatabaseUrls();
const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;
const LEADS_TOKEN = ['sales.edition.leads'];
const LEADS_SET = modulesForEdition('leads');
const FULL_SET = modulesForEdition('full');

function enabledKeys(modules: OrgModules): string[] {
  return CRM_MODULE_KEYS.filter((key) => modules[key]).sort();
}

describe('org modules: token backfill, concurrency, RLS and admin update', () => {
  let appClient: postgres.Sql;
  let adminClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const orgIds: string[] = [];

  function newOrg(label: string): string {
    const orgId = `org_mod_${label}_${Date.now()}_${randomUUID().slice(0, 8)}`;
    orgIds.push(orgId);
    return orgId;
  }

  function rowsOf(orgId: string) {
    return adminClient<{ module_key: string; enabled: boolean; source: string; updated_at: Date | null }[]>`
      SELECT module_key, enabled, source, updated_at FROM sales_ops_org_modules
      WHERE org_id = ${orgId} ORDER BY module_key`;
  }

  beforeAll(() => {
    appClient = postgres(APP_DB_URL, { max: 5 });
    adminClient = postgres(ADMIN_DB_URL, { max: 2, ...ADMIN_CONNECTION_OPTIONS });
    db = drizzle(appClient, { schema });
  });

  afterAll(async () => {
    for (const orgId of orgIds) {
      await adminClient`DELETE FROM sales_ops_org_modules WHERE org_id = ${orgId}`;
    }
    await appClient.end();
    await adminClient.end();
  });

  it('a Construbom-like org (token module sales.edition.leads, no rows) backfills exactly the leads set', async () => {
    const orgId = newOrg('leads');
    const state = await loadOrgModules(orgId, LEADS_TOKEN, db);
    expect(state.modules).toEqual(LEADS_SET);
    const rows = await rowsOf(orgId);
    expect(rows).toHaveLength(7);
    expect(rows.every((row) => row.source === 'token_backfill')).toBe(true);
    expect(rows.filter((row) => row.enabled).map((row) => row.module_key).sort()).toEqual(['clientes', 'importacao']);
  });

  it('a full org (token modules []) backfills all seven enabled', async () => {
    const orgId = newOrg('full');
    const state = await loadOrgModules(orgId, [], db);
    expect(state.modules).toEqual(FULL_SET);
    expect(await rowsOf(orgId)).toHaveLength(7);
  });

  it('token near-misses and unrelated add-ons backfill full; the exact module flips to leads', async () => {
    for (const tokenModules of [['sales.some-other-addon'], ['SALES.EDITION.LEADS'], ['sales.edition.leads '], undefined, null]) {
      const orgId = newOrg('nearmiss');
      expect(enabledKeys((await loadOrgModules(orgId, tokenModules, db)).modules)).toEqual(enabledKeys(FULL_SET));
    }
    const mixed = newOrg('mixed');
    expect((await loadOrgModules(mixed, ['sales.some-other-addon', 'sales.edition.leads'], db)).modules).toEqual(LEADS_SET);
  });

  it('after the backfill the token no longer decides', async () => {
    const orgId = newOrg('after');
    await loadOrgModules(orgId, LEADS_TOKEN, db);
    const second = await loadOrgModules(orgId, [], db);
    expect(second.modules).toEqual(LEADS_SET);
    const rows = await rowsOf(orgId);
    expect(rows).toHaveLength(7);
    expect(rows.every((row) => row.updated_at === null)).toBe(true);
  });

  it('twelve concurrent first calls with mixed tokens write one coherent set', async () => {
    const orgId = newOrg('race');
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) => loadOrgModules(orgId, index % 2 === 0 ? LEADS_TOKEN : [], db)),
    );
    const first = results[0]!.modules;
    for (const result of results) expect(result.modules).toEqual(first);
    const rows = await rowsOf(orgId);
    expect(rows).toHaveLength(7);
    expect(new Set(rows.map((row) => row.source))).toEqual(new Set(['token_backfill']));
    const enabledCount = rows.filter((row) => row.enabled).length;
    expect([2, 7]).toContain(enabledCount);
    expect(first).toEqual(enabledCount === 2 ? LEADS_SET : FULL_SET);
  });

  it('RLS isolates orgs', async () => {
    const orgA = newOrg('rls_a');
    const orgB = newOrg('rls_b');
    await loadOrgModules(orgA, LEADS_TOKEN, db);
    await loadOrgModules(orgB, [], db);
    const visibleToB = await withTenant(db, orgB, (tx) => tx.select().from(salesOpsOrgModules));
    expect(visibleToB).toHaveLength(7);
    expect(visibleToB.every((row) => row.orgId === orgB)).toBe(true);
    const leakedA = await withTenant(db, orgB, (tx) =>
      tx.select().from(salesOpsOrgModules).where(eq(salesOpsOrgModules.orgId, orgA)),
    );
    expect(leakedA).toEqual([]);
  });

  it('updateOrgModules turns a flag on as source admin and leaves the rest', async () => {
    const orgId = newOrg('admin');
    await loadOrgModules(orgId, LEADS_TOKEN, db);
    const state = await updateOrgModules(orgId, LEADS_TOKEN, { orcamentos: true }, db);
    expect(state.modules.orcamentos).toBe(true);
    expect(state.sources.orcamentos).toBe('admin');
    expect(state.sources.clientes).toBe('token_backfill');
    expect(state.modules.comissoes).toBe(false);
    const rows = await rowsOf(orgId);
    const touched = rows.filter((row) => row.updated_at !== null).map((row) => row.module_key);
    expect(touched).toEqual(['orcamentos']);
  });

  it('updateOrgModules on a never-seen org backfills first', async () => {
    const orgId = newOrg('admin_first');
    const state = await updateOrgModules(orgId, LEADS_TOKEN, { comissoes: true }, db);
    expect(state.modules).toEqual({ ...LEADS_SET, comissoes: true });
    expect(state.sources.comissoes).toBe('admin');
    expect(state.sources.clientes).toBe('token_backfill');
    expect(await rowsOf(orgId)).toHaveLength(7);
  });

  it('a partially populated org is not backfilled; a missing key reads false', async () => {
    const orgId = newOrg('partial');
    await adminClient`INSERT INTO sales_ops_org_modules (org_id, module_key, enabled, source)
      VALUES (${orgId}, 'orcamentos', true, 'admin')`;
    const state = await loadOrgModules(orgId, [], db);
    expect(enabledKeys(state.modules)).toEqual(['orcamentos']);
    const count = await adminClient`SELECT count(*)::int AS n FROM sales_ops_org_modules WHERE org_id = ${orgId}`;
    expect(count[0]?.n).toBe(1);
  });

  it('an unknown module_key row is ignored and an unknown source reads default', async () => {
    const orgId = newOrg('unknown');
    await adminClient`INSERT INTO sales_ops_org_modules (org_id, module_key, enabled, source)
      VALUES (${orgId}, 'zzz', true, 'admin'), (${orgId}, 'clientes', true, 'weird')`;
    const state = await loadOrgModules(orgId, [], db);
    expect(Object.keys(state.modules)).not.toContain('zzz');
    expect(state.modules.clientes).toBe(true);
    expect(state.sources.clientes).toBe('default');
  });
});
