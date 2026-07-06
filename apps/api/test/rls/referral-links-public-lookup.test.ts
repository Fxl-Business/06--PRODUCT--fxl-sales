/**
 * RLS integration test for the referral_links public-lookup policy (D-E).
 *
 * Proves the bug-distinguishing behavior: a valid `code` lookup under
 * fxl_finders_app with NO tenant context (app.current_org_id unset — exactly
 * what the public /r/[code] handler does) returns the row. Without the
 * referral_links_public_lookup PERMISSIVE SELECT policy this would return 0 rows
 * and every valid code would 410 instead of 302.
 *
 * Also asserts the tenant dashboard query (by finder_id, WITH org context) stays
 * org-isolated — the public SELECT policy only widens code lookups, it must NOT
 * leak org A's links into org B's dashboard.
 *
 * Connects as fxl_finders_app per D-G (postgres/admin BYPASS RLS → prove nothing).
 * Run with: pnpm --filter @fxl-sales/api test:integration
 */
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://fxl_finders_app:fxl_finders_app@localhost:5006/fxl_finders';

const CLEANUP_DB_URL =
  process.env.TEST_MIGRATE_DATABASE_URL ??
  process.env.MIGRATE_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5006/fxl_finders';

describe('RLS: referral_links public-lookup (as fxl_finders_app, D-E)', () => {
  let sql: postgres.Sql;
  let cleanup: postgres.Sql;

  const stamp = Date.now();
  const ORG_A = 'org_pl_a_' + stamp;
  const ORG_B = 'org_pl_b_' + stamp;
  const CODE = 'plcode' + (stamp % 10000); // <= 10 chars-ish; unique enough for the test
  let finderAId = '';
  let finderBId = '';
  let appId = '';
  let productId = '';

  beforeAll(async () => {
    sql = postgres(TEST_DB_URL);
    cleanup = postgres(CLEANUP_DB_URL);

    // Guard (D-G): the test role must NOT bypass RLS.
    const rows = await sql<{ rolsuper: boolean; rolbypassrls: boolean; current_user: string }[]>`
      SELECT rolsuper, rolbypassrls, current_user FROM pg_roles WHERE rolname = current_user
    `;
    const me = rows[0];
    if (!me) throw new Error('could not resolve current_user role');
    if (me.rolsuper || me.rolbypassrls) {
      throw new Error(
        `RLS tests must run as a non-superuser, non-BYPASSRLS role; got ${me.current_user}`,
      );
    }

    // Seed FK parents + the referral_links row via the owner connection (RLS bypass
    // is fine for SEEDING — the assertions below run as fxl_finders_app).
    const [app] = await cleanup`
      INSERT INTO apps (slug, name, publishable_key, secret_key_hash, secret_key_prefix,
                        webhook_signing_secret, allowed_redirect_hosts, status, created_by_user_id)
      VALUES (${'app-pl-' + stamp}, 'PL App', ${'pk_pl_' + stamp}, 'hash', 'sk_pl',
              'whs_pl', ARRAY['checkout.example.com'], 'active', 'system')
      RETURNING id
    `;
    appId = (app as { id: string }).id;

    const [product] = await cleanup`
      INSERT INTO products (app_id, slug, name, status)
      VALUES (${appId}, ${'prod-pl-' + stamp}, 'PL Product', 'active')
      RETURNING id
    `;
    productId = (product as { id: string }).id;

    const [finderA] = await cleanup`
      INSERT INTO finders (org_id, clerk_user_id, clerk_org_id, status, display_name, contact_email)
      VALUES (${ORG_A}, ${'usr_pl_a_' + stamp}, ${'corg_pl_a_' + stamp}, 'approved', 'Finder A', 'a@pl.com')
      RETURNING id
    `;
    finderAId = (finderA as { id: string }).id;

    const [finderB] = await cleanup`
      INSERT INTO finders (org_id, clerk_user_id, clerk_org_id, status, display_name, contact_email)
      VALUES (${ORG_B}, ${'usr_pl_b_' + stamp}, ${'corg_pl_b_' + stamp}, 'approved', 'Finder B', 'b@pl.com')
      RETURNING id
    `;
    finderBId = (finderB as { id: string }).id;

    await cleanup`
      INSERT INTO referral_links (org_id, code, finder_id, app_id, product_id,
                                  quoted_setup_brl, quoted_monthly_brl, signature, destination_url, status)
      VALUES (${ORG_A}, ${CODE}, ${finderAId}, ${appId}, ${productId},
              100000, 10000, 'sig_pl', 'https://checkout.example.com/precos', 'active')
    `;
  });

  afterAll(async () => {
    await cleanup`DELETE FROM referral_links WHERE code = ${CODE}`;
    await cleanup`DELETE FROM finders WHERE id IN (${finderAId}, ${finderBId})`;
    await cleanup`DELETE FROM products WHERE id = ${productId}`;
    await cleanup`DELETE FROM apps WHERE id = ${appId}`;
    await sql.end();
    await cleanup.end();
  });

  it('public lookup by code with NO tenant context returns 1 row (D-E: valid code → 302, not 410)', async () => {
    // NO set_config('app.current_org_id', ...) — mirrors the JWT-less /r/[code] path.
    const rows = await sql`SELECT id, finder_id FROM referral_links WHERE code = ${CODE}`;
    expect(rows).toHaveLength(1);
    expect((rows[0] as { finder_id: string }).finder_id).toBe(finderAId);
  });

  it('finder dashboard query (by finder_id, org B context) stays org-isolated — does NOT see org A link', async () => {
    const rows = await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_org_id', ${ORG_B}, true)`;
      // org B's dashboard lists by its own finder_id; org A's link is invisible.
      return tx`SELECT id FROM referral_links WHERE finder_id = ${finderBId}`;
    });
    expect(rows).toHaveLength(0);
  });

  it('finder dashboard query (org A context) sees its own link — positive control', async () => {
    const rows = await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
      return tx`SELECT id FROM referral_links WHERE finder_id = ${finderAId}`;
    });
    expect(rows).toHaveLength(1);
  });
});
