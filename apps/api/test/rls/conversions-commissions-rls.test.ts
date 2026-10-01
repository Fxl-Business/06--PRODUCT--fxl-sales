/**
 * conversions + commissions split-RLS integration test (Phase 05 T13, D10/D-G).
 *
 * Proves the split-INSERT pattern: the app can INSERT a conversion/commission
 * WITHOUT a tenant context (webhook path, conversions_insert_webhook WITH CHECK(true)),
 * and a finder reading under setTenantContext sees ONLY its own org's rows (positive
 * control + cross-org zero).
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { conversions } from '../../src/db/schema.js';
import { testDatabaseUrls } from '../../src/db/__tests__/test-database-urls.js';

const { appUrl: APP_DB_URL, adminUrl: SEED_DB_URL } = testDatabaseUrls();
const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;

describe('conversions/commissions split-RLS (D10/D-G)', () => {
  let appClient: postgres.Sql;
  let appDb: ReturnType<typeof drizzle<typeof schema>>;
  let seed: postgres.Sql;

  const stamp = Date.now();
  const ORG_A = 'org_ccr_a_' + stamp;
  const ORG_B = 'org_ccr_b_' + stamp;
  let appId = '';
  let productId = '';
  let finderAId = '';
  let webhookInsertedId = '';

  beforeAll(async () => {
    appClient = postgres(APP_DB_URL, { max: 5 });
    appDb = drizzle(appClient, { schema });
    seed = postgres(SEED_DB_URL, ADMIN_CONNECTION_OPTIONS);

    const rows = await appClient<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    if (rows[0]?.rolsuper || rows[0]?.rolbypassrls) {
      throw new Error('RLS tests must run as a non-superuser, non-BYPASSRLS role');
    }

    const [app] = await seed`
      INSERT INTO apps (slug, name, publishable_key, secret_key_hash, secret_key_prefix,
                        webhook_signing_secret, allowed_redirect_hosts, status, created_by_user_id)
      VALUES (${'app-ccr-' + stamp}, 'CCR', ${'pk_ccr_' + stamp}, 'h', 'sk_ccr', 'whs_ccr',
              ARRAY['x.com'], 'active', 'system') RETURNING id`;
    appId = (app as { id: string }).id;
    const [prod] = await seed`
      INSERT INTO products (app_id, slug, name, status)
      VALUES (${appId}, ${'p' + stamp}, 'P', 'active') RETURNING id`;
    productId = (prod as { id: string }).id;
    const [fa] = await seed`
      INSERT INTO finders (org_id, account_id, workspace_id, status, display_name, contact_email)
      VALUES (${ORG_A}, ${'usr_ccr_a_' + stamp}, ${'corg_ccr_a_' + stamp}, 'approved', 'A', 'a@ccr.com') RETURNING id`;
    finderAId = (fa as { id: string }).id;

    // Org A conversion seeded directly (org-scoped).
    await seed`
      INSERT INTO conversions (source, external_order_id, event_type, idempotency_key, org_id,
                               finder_id, app_id, product_id, quoted_setup_brl, quoted_monthly_brl,
                               realized_setup_brl, realized_monthly_brl, hold_until, closed_at)
      VALUES (${'app-ccr-' + stamp}, ${'oa_' + stamp}, 'sale', ${'idemA_' + stamp}, ${ORG_A},
              ${finderAId}, ${appId}, ${productId}, 100000, 10000, 100000, 10000, now(), now())`;
  });

  afterAll(async () => {
    if (seed) {
      await seed`DELETE FROM conversions WHERE org_id IN (${ORG_A}, ${ORG_B})`;
      if (finderAId) await seed`DELETE FROM finders WHERE id = ${finderAId}`;
      if (productId) await seed`DELETE FROM products WHERE id = ${productId}`;
      if (appId) await seed`DELETE FROM apps WHERE id = ${appId}`;
      await seed.end();
    }
    if (appClient) await appClient.end();
  });

  it('app role can INSERT a conversion with NO tenant context (webhook split-INSERT)', async () => {
    // No setTenantContext call - conversions_insert_webhook WITH CHECK(true) permits the
    // write. NOTE: under FORCE RLS, `INSERT ... RETURNING` re-reads the new row through the
    // SELECT policy, which (with no tenant context) would filter it and surface as an RLS
    // error - so the webhook split-INSERT path deliberately does NOT use RETURNING here.
    // The runtime ingest uses the admin DB handle. We assert the
    // INSERT itself is permitted, then confirm via the seed connection.
    await appDb.insert(conversions).values({
      source: 'app-ccr-' + stamp,
      externalOrderId: 'ob_' + stamp,
      eventType: 'sale',
      idempotencyKey: 'idemB_' + stamp,
      orgId: ORG_B,
      finderId: finderAId,
      appId,
      productId,
      quotedSetupBrl: 50000,
      quotedMonthlyBrl: 5000,
      realizedSetupBrl: 50000,
      realizedMonthlyBrl: 5000,
      holdUntil: new Date(),
      closedAt: new Date(),
    });
    const [row] = await seed`SELECT id FROM conversions WHERE idempotency_key = ${'idemB_' + stamp}`;
    expect((row as { id: string }).id).toBeTruthy();
    webhookInsertedId = (row as { id: string }).id;
  });

  it('finder under org A context sees ONLY org A conversion (positive control)', async () => {
    const result = await appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_org_id', ${ORG_A}, true)`);
      return tx.select().from(conversions);
    });
    expect(result.length).toBe(1);
    expect(result[0]?.orgId).toBe(ORG_A);
  });

  it('finder under org B context sees only org B (cross-tenant isolation)', async () => {
    const result = await appDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_org_id', ${ORG_B}, true)`);
      return tx.select().from(conversions);
    });
    expect(result.every((r) => r.orgId === ORG_B)).toBe(true);
    expect(result.some((r) => r.id === webhookInsertedId)).toBe(true);
    expect(result.some((r) => r.orgId === ORG_A)).toBe(false);
  });
});
