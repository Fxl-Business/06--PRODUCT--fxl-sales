/**
 * Cross-tenant integration test for listFinderLinks (plan-brief D-D).
 *
 * Proves a finder in org B calling listFinderLinks does NOT see org A's links —
 * the setTenantContext(tx, orgB) + the referral_links_tenant_isolation RLS
 * policy returns 0 rows. Positive control: under org A context the link is
 * returned. Exercises the REAL service fn (not a raw query) so the D-D
 * transaction wrapping + RLS are validated end-to-end.
 *
 * Connects via getDb() pointed at fxl_finders_app (D-G). Run with:
 *   pnpm --filter @fxl-sales/api test:integration
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { listFinderLinks } from '../../src/domains/links/service.js';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://fxl_finders_app:fxl_finders_app@localhost:5006/fxl_finders';
const CLEANUP_DB_URL =
  process.env.TEST_MIGRATE_DATABASE_URL ??
  process.env.MIGRATE_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5006/fxl_finders';

describe('listFinderLinks cross-tenant isolation (D-D)', () => {
  let client: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let cleanup: postgres.Sql;

  const stamp = Date.now();
  const ORG_A = 'org_lfl_a_' + stamp;
  const ORG_B = 'org_lfl_b_' + stamp;
  const USER_A = 'usr_lfl_a_' + stamp;
  const USER_B = 'usr_lfl_b_' + stamp;
  let finderAId = '';
  let finderBId = '';
  let appId = '';
  let productId = '';

  beforeAll(async () => {
    client = postgres(TEST_DB_URL, { max: 5 });
    db = drizzle(client, { schema });
    cleanup = postgres(CLEANUP_DB_URL);

    // RLS guard (D-G).
    const rows = await client<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user
    `;
    if (rows[0]?.rolsuper || rows[0]?.rolbypassrls) {
      throw new Error('RLS tests must run as a non-superuser, non-BYPASSRLS role');
    }

    const [app] = await cleanup`
      INSERT INTO apps (slug, name, publishable_key, secret_key_hash, secret_key_prefix,
                        webhook_signing_secret, allowed_redirect_hosts, status, created_by_user_id)
      VALUES (${'app-lfl-' + stamp}, 'LFL App', ${'pk_lfl_' + stamp}, 'hash', 'sk_lfl',
              'whs_lfl', ARRAY['checkout.example.com'], 'active', 'system')
      RETURNING id`;
    appId = (app as { id: string }).id;
    const [product] = await cleanup`
      INSERT INTO products (app_id, slug, name, status)
      VALUES (${appId}, ${'prod-lfl-' + stamp}, 'LFL Product', 'active') RETURNING id`;
    productId = (product as { id: string }).id;

    const [fa] = await cleanup`
      INSERT INTO finders (org_id, clerk_user_id, clerk_org_id, status, display_name, contact_email)
      VALUES (${ORG_A}, ${USER_A}, ${'corg_lfl_a_' + stamp}, 'approved', 'A', 'a@lfl.com') RETURNING id`;
    finderAId = (fa as { id: string }).id;
    const [fb] = await cleanup`
      INSERT INTO finders (org_id, clerk_user_id, clerk_org_id, status, display_name, contact_email)
      VALUES (${ORG_B}, ${USER_B}, ${'corg_lfl_b_' + stamp}, 'approved', 'B', 'b@lfl.com') RETURNING id`;
    finderBId = (fb as { id: string }).id;

    await cleanup`
      INSERT INTO referral_links (org_id, code, finder_id, app_id, product_id,
                                  quoted_setup_brl, quoted_monthly_brl, signature, destination_url, status)
      VALUES (${ORG_A}, ${'lflc' + (stamp % 100000)}, ${finderAId}, ${appId}, ${productId},
              100000, 10000, 'sig', 'https://checkout.example.com/precos', 'active')`;
  });

  afterAll(async () => {
    await cleanup`DELETE FROM referral_links WHERE finder_id IN (${finderAId}, ${finderBId})`;
    await cleanup`DELETE FROM finders WHERE id IN (${finderAId}, ${finderBId})`;
    await cleanup`DELETE FROM products WHERE id = ${productId}`;
    await cleanup`DELETE FROM apps WHERE id = ${appId}`;
    await client.end();
    await cleanup.end();
  });

  it('org A finder sees its own link (positive control)', async () => {
    const links = await listFinderLinks(db, ORG_A, USER_A);
    expect(links).toHaveLength(1);
    expect(links[0]?.orgId).toBe(ORG_A);
  });

  it('org B finder does NOT see org A link (cross-tenant zero)', async () => {
    const links = await listFinderLinks(db, ORG_B, USER_B);
    expect(links).toHaveLength(0);
  });
});
