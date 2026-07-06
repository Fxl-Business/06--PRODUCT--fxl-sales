/**
 * Phase 06 T13 — automated e2e conversion-contract test (replaces deleted T02).
 *
 * The PRIMARY regression gate for the cross-repo webhook contract. Uses Hono's
 * test request against the assembled conversion route + HMAC middleware (exactly as
 * server.ts wires them) and posts the EXACT D-M body that the fxl-financiero sender
 * (Side B T08) emits, signed with the SEEDED `fxl-financiero` webhook_signing_secret
 * (T01). Asserts: 200 accepted + conversion + ≥1 commission + leads + webhook_events
 * row; replay → 200 duplicate, no dup rows; wrong sig → 401 (generic, D-O).
 *
 * Runs in the integration project (test/rls/** + global-setup migrations, which
 * include the T01 seed). source = 'fxl-financiero' (D-A, …ciero).
 *
 * Run: pnpm --filter @fxl-sales/api test:integration
 */
import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { hmacVerifyMiddleware } from '../../src/domains/conversions/hmac-middleware.js';
import { conversionsRouter } from '../../src/domains/conversions/routes.js';
import { buildIdempotencyKey } from '../../src/domains/conversions/service.js';

const SOURCE = 'fxl-financiero'; // D-A canonical slug (…ciero) — byte-identical to the seed
const SEED_DB_URL =
  process.env.TEST_MIGRATE_DATABASE_URL ??
  process.env.MIGRATE_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5006/fxl_finders';

/** Assemble the conversion webhook path exactly as server.ts does (HMAC before route). */
function buildApp() {
  const app = new Hono();
  app.use('/api/v1/conversions', hmacVerifyMiddleware);
  app.route('/api/v1/conversions', conversionsRouter);
  return app;
}

/** Inline sign (D-O): the EXACT formula the fxl-financiero sender uses. */
function signRequest(rawBody: string, secret: string) {
  const t = Math.floor(Date.now() / 1000).toString(); // within the 300s replay window
  const v1 = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

describe('conversion webhook contract (Phase 06 T13, D-M/D-N/D-O)', () => {
  let seed: postgres.Sql;
  let secret = '';
  let appId = '';
  let productId = '';
  let finderId = '';
  let linkId = '';

  const stamp = Date.now();
  const ORG = 'org_e2e_' + stamp;
  const code = ('e2e' + (stamp % 10000000)).slice(0, 10);
  const clickId = 'clk_e2e_' + stamp;
  const externalOrderId = 'org_attr_' + stamp;

  beforeAll(async () => {
    seed = postgres(SEED_DB_URL);

    // The T01 seed (run by global-setup migrations) created the fxl-financiero app.
    const [app] = await seed`
      SELECT id, webhook_signing_secret FROM apps WHERE slug = ${SOURCE} LIMIT 1`;
    if (!app) throw new Error('seed app fxl-financiero missing — global-setup did not run T01');
    appId = (app as { id: string }).id;
    secret = (app as { webhook_signing_secret: string }).webhook_signing_secret;

    const [prod] = await seed`
      SELECT id FROM products WHERE app_id = ${appId} AND slug = 'fxl-financiero-core' LIMIT 1`;
    productId = (prod as { id: string }).id;

    // A finder + referral_link + click so attribution resolves by click_id.
    const [finder] = await seed`
      INSERT INTO finders (org_id, clerk_user_id, clerk_org_id, status, display_name, contact_email, cpf, pix_key)
      VALUES (${ORG}, ${'usr_e2e_' + stamp}, ${'corg_e2e_' + stamp}, 'approved', 'E2E Finder', 'e2e@x.com', '12345678901', 'e2e@x.com')
      RETURNING id`;
    finderId = (finder as { id: string }).id;
    const [link] = await seed`
      INSERT INTO referral_links (org_id, code, finder_id, app_id, product_id,
                                  quoted_setup_brl, quoted_monthly_brl, signature, destination_url, status)
      VALUES (${ORG}, ${code}, ${finderId}, ${appId}, ${productId}, 100000, 10700, 'sig',
              'https://fxlfinanceiro.com.br/precos', 'active') RETURNING id`;
    linkId = (link as { id: string }).id;
    await seed`
      INSERT INTO clicks (click_id, org_id, link_id, finder_id, app_id, product_id, created_at)
      VALUES (${clickId}, ${ORG}, ${linkId}, ${finderId}, ${appId}, ${productId}, now())`;
  });

  afterAll(async () => {
    const key = buildIdempotencyKey(SOURCE, externalOrderId, 'sale');
    await seed`DELETE FROM audit_log WHERE actor_org_id = ${ORG}`;
    await seed`DELETE FROM commissions WHERE finder_id = ${finderId}`;
    await seed`DELETE FROM conversions WHERE org_id = ${ORG}`;
    await seed`DELETE FROM leads WHERE org_id = ${ORG}`;
    await seed`DELETE FROM webhook_events WHERE source = ${SOURCE} AND event_id = ${key}`;
    await seed`DELETE FROM clicks WHERE org_id = ${ORG}`;
    await seed`DELETE FROM referral_links WHERE org_id = ${ORG}`;
    await seed`DELETE FROM finders WHERE id = ${finderId}`;
    await seed.end();
  });

  /** The EXACT D-M field set the fxl-financiero sender emits (T08). */
  function makeBody() {
    return {
      source: SOURCE,
      external_order_id: externalOrderId,
      event_type: 'sale',
      idempotency_key: buildIdempotencyKey(SOURCE, externalOrderId, 'sale'),
      click_id: clickId,
      finder_code: code,
      seller_clerk_id: null,
      customer_email: 'e2e-cust@x.com',
      customer_name: 'José Antônio Açaí', // non-ASCII PII — byte-stable sign/verify
      customer_phone: '+5511999998888',
      customer_cpf: '99988877766',
      customer_org_id: externalOrderId,
      realized_setup_brl: 100000,
      realized_monthly_brl: 10700,
      closed_at: new Date().toISOString(),
    };
  }

  it('accepts a valid signed conversion → 200 accepted + conversion + commissions + leads + webhook_events', async () => {
    const app = buildApp();
    const rawBody = JSON.stringify(makeBody());
    const sig = signRequest(rawBody, secret);

    const res = await app.request('/api/v1/conversions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-FXL-Signature': sig },
      body: rawBody,
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string; conversionId?: string };
    expect(json.status).toBe('accepted');
    expect(json.conversionId).toBeTruthy();

    const key = buildIdempotencyKey(SOURCE, externalOrderId, 'sale');
    const convs = await seed`SELECT id FROM conversions WHERE idempotency_key = ${key}`;
    expect(convs.length).toBe(1);

    const comms = await seed`SELECT status FROM commissions WHERE finder_id = ${finderId}`;
    expect(comms.length).toBeGreaterThanOrEqual(1);
    expect(comms.every((c) => (c as { status: string }).status === 'pending')).toBe(true);

    const leadsRows = await seed`SELECT customer_cpf FROM leads WHERE org_id = ${ORG}`;
    expect(leadsRows.length).toBe(1);
    expect((leadsRows[0] as { customer_cpf: string }).customer_cpf).toBe('99988877766');

    const evt = await seed`SELECT body_hash FROM webhook_events WHERE source = ${SOURCE} AND event_id = ${key}`;
    expect(evt.length).toBe(1);
    expect((evt[0] as { body_hash: string }).body_hash.length).toBe(64); // sha256 hex
  });

  it('replays the identical signed request → 200 duplicate, no dup rows', async () => {
    const app = buildApp();
    const rawBody = JSON.stringify(makeBody());
    const sig = signRequest(rawBody, secret);

    const res = await app.request('/api/v1/conversions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-FXL-Signature': sig },
      body: rawBody,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string };
    expect(json.status).toBe('duplicate');

    const key = buildIdempotencyKey(SOURCE, externalOrderId, 'sale');
    const convs = await seed`SELECT id FROM conversions WHERE idempotency_key = ${key}`;
    expect(convs.length).toBe(1); // unchanged
    const leadsRows = await seed`SELECT id FROM leads WHERE org_id = ${ORG}`;
    expect(leadsRows.length).toBe(1); // unchanged
  });

  it('rejects a wrong-secret signature → 401 generic (no source-existence oracle, D-O)', async () => {
    const app = buildApp();
    const rawBody = JSON.stringify(makeBody());
    const sig = signRequest(rawBody, 'totally-wrong-secret');

    const res = await app.request('/api/v1/conversions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-FXL-Signature': sig },
      body: rawBody,
    });
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('unauthorized');
  });
});
