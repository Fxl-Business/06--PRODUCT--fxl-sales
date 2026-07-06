/**
 * Conversion ingest + commission + audit integration test (Phase 05 T13).
 *
 * Exercises the REAL ingestConversion on the BYPASSRLS admin connection (D-C): the
 * webhook is cross-tenant with no JWT and must read clicks/finders/commission_rules.
 * Asserts: idempotency dedupe (webhook_events + conversions.idempotency_key), quoted
 * snapshot (D-L), customer_email_hash, leads PII row, commission calc (setup+recurring,
 * string rate from numeric), pending status (D-K), audit hash-chain integrity, and the
 * promoteHoldExpired auto path pending→locked.
 *
 * Run: pnpm --filter @fxl-sales/api test:integration
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.js';
import {
  buildIdempotencyKey,
  hashCustomerEmail,
  ingestConversion,
  type WebhookBody,
} from '../../src/domains/conversions/service.js';
import { promoteHoldExpired } from '../../src/domains/commissions/service.js';
import { verifyChain, type AuditChainRow } from '../../src/domains/audit/service.js';

const ADMIN_DB_URL =
  process.env.ADMIN_DATABASE_URL ??
  'postgresql://fxl_finders_admin:fxl_finders_admin@localhost:5006/fxl_finders';
const SEED_DB_URL =
  process.env.TEST_MIGRATE_DATABASE_URL ??
  process.env.MIGRATE_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5006/fxl_finders';

describe('conversion ingest + commission + audit (Phase 05)', () => {
  let adminClient: postgres.Sql;
  let adminDb: ReturnType<typeof drizzle<typeof schema>>;
  let seed: postgres.Sql;

  const stamp = Date.now();
  const ORG = 'org_ci_' + stamp;
  const SOURCE = 'app-ci-' + stamp;
  const code = ('ci' + (stamp % 100000000)).slice(0, 10);
  const clickId = 'clk_ci_' + stamp;
  let appId = '';
  let productId = '';
  let finderId = '';
  let linkId = '';

  beforeAll(async () => {
    adminClient = postgres(ADMIN_DB_URL, { max: 5 });
    adminDb = drizzle(adminClient, { schema });
    seed = postgres(SEED_DB_URL);

    const [app] = await seed`
      INSERT INTO apps (slug, name, publishable_key, secret_key_hash, secret_key_prefix,
                        webhook_signing_secret, allowed_redirect_hosts, attribution_window_days,
                        commission_hold_days, status, created_by_user_id)
      VALUES (${SOURCE}, 'CI', ${'pk_ci_' + stamp}, 'h', 'sk_ci', 'whs_ci',
              ARRAY['checkout.example.com'], 30, 30, 'active', 'system') RETURNING id`;
    appId = (app as { id: string }).id;
    const [prod] = await seed`
      INSERT INTO products (app_id, slug, name, status)
      VALUES (${appId}, ${'p' + stamp}, 'Prod', 'active') RETURNING id`;
    productId = (prod as { id: string }).id;
    await seed`
      INSERT INTO commission_rules (product_id, setup_rate_pct, recurring_rate_pct, recurring_months, basis)
      VALUES (${productId}, '30.00', '20.00', 12, 'quoted_net')`;
    const [finder] = await seed`
      INSERT INTO finders (org_id, clerk_user_id, clerk_org_id, status, display_name, contact_email, cpf, pix_key)
      VALUES (${ORG}, ${'usr_ci_' + stamp}, ${'corg_ci_' + stamp}, 'approved', 'CI Finder', 'ci@x.com', '12345678901', 'ci@x.com')
      RETURNING id`;
    finderId = (finder as { id: string }).id;
    const [link] = await seed`
      INSERT INTO referral_links (org_id, code, finder_id, app_id, product_id,
                                  quoted_setup_brl, quoted_monthly_brl, signature, destination_url, status)
      VALUES (${ORG}, ${code}, ${finderId}, ${appId}, ${productId}, 100000, 10700, 'sig',
              'https://checkout.example.com/precos', 'active') RETURNING id`;
    linkId = (link as { id: string }).id;
    await seed`
      INSERT INTO clicks (click_id, org_id, link_id, finder_id, app_id, product_id, created_at)
      VALUES (${clickId}, ${ORG}, ${linkId}, ${finderId}, ${appId}, ${productId}, now())`;
  });

  afterAll(async () => {
    await seed`DELETE FROM audit_log WHERE actor_org_id = ${ORG}`;
    await seed`DELETE FROM commissions WHERE finder_id = ${finderId}`;
    await seed`DELETE FROM conversions WHERE org_id = ${ORG}`;
    await seed`DELETE FROM leads WHERE org_id = ${ORG}`;
    await seed`DELETE FROM webhook_events WHERE source = ${SOURCE}`;
    await seed`DELETE FROM clicks WHERE org_id = ${ORG}`;
    await seed`DELETE FROM referral_links WHERE org_id = ${ORG}`;
    await seed`DELETE FROM commission_rules WHERE product_id = ${productId}`;
    await seed`DELETE FROM products WHERE id = ${productId}`;
    await seed`DELETE FROM finders WHERE id = ${finderId}`;
    await seed`DELETE FROM apps WHERE id = ${appId}`;
    await adminClient.end();
    await seed.end();
  });

  function makeBody(): WebhookBody {
    return {
      source: SOURCE,
      external_order_id: 'ord_' + stamp,
      event_type: 'sale',
      idempotency_key: buildIdempotencyKey(SOURCE, 'ord_' + stamp, 'sale'),
      click_id: clickId,
      seller_clerk_id: null,
      customer_email: 'cust@x.com',
      customer_name: 'Cust',
      customer_phone: '+5511',
      customer_cpf: '99988877766',
      customer_org_id: null,
      realized_setup_brl: 100000,
      realized_monthly_brl: 10700,
      closed_at: new Date().toISOString(),
    };
  }

  it('ingests a conversion with quoted snapshot, email hash, leads PII, and commissions', async () => {
    const body = makeBody();
    const result = await ingestConversion(adminDb, body, 'rawhash_' + stamp);

    expect(result.isDuplicate).toBe(false);
    expect(result.conversion).not.toBeNull();
    // Quoted snapshot pinned from referral_links (D-L).
    expect(result.conversion!.quotedSetupBrl).toBe(100000);
    expect(result.conversion!.quotedMonthlyBrl).toBe(10700);
    // Org-salted email hash (D-L).
    expect(result.conversion!.customerEmailHash).toBe(hashCustomerEmail('cust@x.com', ORG));
    expect(result.conversion!.orgId).toBe(ORG);

    // Commission calc: setup 100000*30% = 30000; recurring 10700*20%*12 = 25680.
    const byKind = Object.fromEntries(result.commissions.map((c) => [c.kind, c]));
    expect(byKind.setup!.amountBrl).toBe(30000);
    expect(byKind.recurring!.amountBrl).toBe(25680);
    // Fresh commissions start pending (D-K).
    expect(result.commissions.every((c) => c.status === 'pending')).toBe(true);

    // webhook_events row stores the route-supplied rawBodyHash verbatim (D-L).
    const [evt] = await seed`SELECT body_hash FROM webhook_events WHERE source = ${SOURCE}`;
    expect((evt as { body_hash: string }).body_hash).toBe('rawhash_' + stamp);

    // leads PII row (LGPD §9).
    const [lead] = await seed`SELECT status, customer_name, customer_cpf FROM leads WHERE org_id = ${ORG}`;
    expect((lead as { status: string }).status).toBe('converted');
    expect((lead as { customer_cpf: string }).customer_cpf).toBe('99988877766');
  });

  it('dedupes a replayed webhook (idempotency)', async () => {
    const replay = await ingestConversion(adminDb, makeBody(), 'rawhash_' + stamp);
    expect(replay.isDuplicate).toBe(true);
    expect(replay.conversion).toBeNull();
    // Exactly one conversion + one webhook_events row exist.
    const convs = await seed`SELECT id FROM conversions WHERE org_id = ${ORG}`;
    expect(convs.length).toBe(1);
  });

  it('writes a valid hash-chained audit ledger (conversion.recorded + commission.created)', async () => {
    const rows = await seed`
      SELECT actor_user_id, actor_org_id, action, entity_type, entity_id,
             before_jsonb, after_jsonb, request_id, prev_hash, entry_hash
      FROM audit_log WHERE actor_org_id = ${ORG} ORDER BY id ASC`;
    expect(rows.length).toBeGreaterThanOrEqual(3); // 1 conversion + 2 commissions
    expect(rows.every((r) => (r as { actor_user_id: string }).actor_user_id === 'system')).toBe(true);

    const chainRows: AuditChainRow[] = rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        actorUserId: row.actor_user_id,
        actorOrgId: row.actor_org_id ?? null,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        beforeJsonb: row.before_jsonb ?? null,
        afterJsonb: row.after_jsonb ?? null,
        requestId: row.request_id ?? null,
        prevHash: row.prev_hash as string,
        entryHash: row.entry_hash as string,
      };
    });
    const result = verifyChain(chainRows);
    expect(result.valid).toBe(true);
    expect(result.brokenAt).toBeNull();
  });

  it('promoteHoldExpired auto path promotes pending→locked once hold_until passes (D-K)', async () => {
    // Backdate hold_until so the nightly auto path picks the commissions up — no manual action.
    await seed`UPDATE commissions SET hold_until = now() - interval '1 day' WHERE finder_id = ${finderId} AND status = 'pending'`;
    const promoted = await promoteHoldExpired(adminDb);
    expect(promoted).toBeGreaterThanOrEqual(2);
    const locked = await seed`SELECT count(*)::int AS n FROM commissions WHERE finder_id = ${finderId} AND status = 'locked'`;
    expect((locked[0] as { n: number }).n).toBeGreaterThanOrEqual(2);
    // No commission was auto-promoted to 'approved' (D-K: approved is never produced).
    const approved = await seed`SELECT count(*)::int AS n FROM commissions WHERE finder_id = ${finderId} AND status = 'approved'`;
    expect((approved[0] as { n: number }).n).toBe(0);
  });
});
