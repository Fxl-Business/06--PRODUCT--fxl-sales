/**
 * Slice 09: local end-to-end of the Sales <-> Finance control plane in fake
 * mode over the shared fixture org `org_fake_integrado`.
 *
 * Real: service writes, settlements, producer emission in the business tx, the
 * outbox adapter, the feed router, the finance consumer (real `pullOnce`, inbox,
 * cursor, handlers). The Hub is `createFakeIntegrationAuthority`. The Finance
 * app is SIMULATED: its feed is served through the `fetchFeedPage` seam.
 *
 * NOT testable cross-process here (recorded in nexo/runs/.../AUDIT.md):
 *  - a real Finance app reading OUR feed over HTTP and reconciling on its side;
 *  - a real Finance app producing the feed (its payload fidelity is assumed to
 *    match the contract, only simulated);
 *  - a real Hub: ticket issuance/introspection, activation discovery over the
 *    network, api_url discovery, heartbeat delivery, ticket 401 refresh;
 *  - true simultaneity of the two baixas across two processes (case 5 orders
 *    them sequentially; the row lock makes real races serialize the same way);
 *  - the boot wiring timers (setInterval publisher/puller/heartbeat) - here
 *    publishPendingPositions and pullOnce are called directly;
 *  - the Finance-side "registrada em duplicidade" surface (only Sales' derivation).
 *
 * Run: pnpm --filter @fxl-sales/api test:integration finance-integration
 */
import { pullOnce, publishPendingPositions, reduceSettlement } from '@fxl-business/fxl-contracts';
import type { IntegrationPullPair } from '@fxl-business/fxl-contracts';
import {
  FIXTURE_INTEGRATED_ORGANIZATION_ID,
  createFakeIntegrationAuthority,
} from '@fxl-business/fxl-contracts/testing';
import { and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { deleteSettlementsForOrgs } from '../../../db/__tests__/settlement-test-cleanup.js';
import { closeDb, getAdminDb, getDb } from '../../../db/client.js';
import {
  salesOpsPayables,
  salesOpsReceivables,
  salesOpsSaleItems,
  salesOpsSaleProfessionals,
  salesOpsSales,
  salesOpsSettlements,
} from '../../../db/schema.js';
import { transitionSale } from '../../sales-ops/service.js';
import {
  deriveSettlementAnomaly,
  recordSettlement,
  reverseSettlement,
} from '../../sales-ops/settlements.js';
import { createFinanceConsumer } from '../consumer.js';
import { createIntegrationFeedRouter } from '../feed-routes.js';
import type { IntegrationDiscovery } from '../hub-client.js';
import { createIntegrationPooledAdapter } from '../outbox-adapter.js';
import { registerProducerFlowGate } from '../producer-gate.js';
import { FINANCE_APP, createSimulatedFinanceFeed } from './simulated-finance-feed.js';

const FIX = FIXTURE_INTEGRATED_ORGANIZATION_ID;
const SALES_APP = 'app.fxl-sales';
const SALES_EVENTS = [
  'fxl-sales.obligation.upserted',
  'fxl-sales.settlement.recorded',
  'fxl-sales.settlement.reversed',
  'fxl-sales.ledger.checkpoint',
];
const FINANCE_EVENTS = ['fxl-finance.settlement.recorded', 'fxl-finance.settlement.reversed'];
const actor = { userId: 'hub-account-financeiro-7f3a', displayName: 'Ana Financeiro' };
const adapter = createIntegrationPooledAdapter();

// The fake verifier accepts only tickets THIS instance issued, and `get` needs
// consumerApplicationId === applicationId. So the ticket that reads the Sales
// feed is minted through a self-consumer activation (fixture only; the feed
// route reads decision.organizationId alone).
const authority = createFakeIntegrationAuthority({
  applicationId: SALES_APP,
  environment: 'development',
  activations: [
    {
      organizationId: FIX,
      producerApplicationId: SALES_APP,
      consumerApplicationId: SALES_APP,
      eventNames: SALES_EVENTS,
    },
    {
      organizationId: FIX,
      producerApplicationId: FINANCE_APP,
      consumerApplicationId: SALES_APP,
      eventNames: FINANCE_EVENTS,
    },
  ],
});

const feedApp = new Hono();
feedApp.route('/integration/v1', createIntegrationFeedRouter({ adapter, verifier: authority.verifier }));

function must<T>(v: T | undefined | null): T {
  if (v === undefined || v === null) throw new Error('expected a value');
  return v;
}

let sequence = 0;
async function seedWonSale() {
  sequence += 1;
  const db = getAdminDb();
  const [sale] = await db
    .insert(salesOpsSales)
    .values({
      orgId: FIX,
      sequence,
      code: `${String(sequence).padStart(4, '0')}-0`,
      clientNameSnapshot: 'Cliente Integrado',
      sellerNameSnapshot: 'Ana Martins',
      finderNameSnapshot: null,
      finderPersonId: null,
      status: 'open',
      paymentMethod: 'pix',
      condition: 'installments',
      installments: 2,
      baseDate: new Date('2026-07-29T00:00:00.000Z'),
      totalBrl: 500000,
      recurringBrl: 0,
      sellerCommissionPct: '10.00',
      finderCommissionPct: '0.00',
      taxPct: '6.00',
      otherCostsBrl: 0,
      netMarginPct: '0.00',
    })
    .returning();
  const saleId = must(sale).id;
  const [r1] = await db
    .insert(salesOpsReceivables)
    .values({
      orgId: FIX,
      saleId,
      label: '1/2',
      dueDate: new Date('2026-08-01T00:00:00.000Z'),
      amountBrl: 300000,
      method: 'pix',
      status: 'open',
    })
    .returning();
  await db.insert(salesOpsReceivables).values({
    orgId: FIX,
    saleId,
    label: '2/2',
    dueDate: new Date('2026-09-01T00:00:00.000Z'),
    amountBrl: 200000,
    method: 'pix',
    status: 'open',
  });
  const won = await transitionSale(getDb(), FIX, saleId, 'won');
  if (!won.ok) throw new Error('expected win');
  return { saleId, receivableId: must(r1).id };
}

type Row = { n?: number; event_name?: string };
async function outboxCount(eventName?: string): Promise<number> {
  const rows = (await getAdminDb().execute(
    eventName
      ? sql`SELECT count(*)::int AS n FROM integration_outbox WHERE organization_id = ${FIX} AND event_name = ${eventName}`
      : sql`SELECT count(*)::int AS n FROM integration_outbox WHERE organization_id = ${FIX}`,
  )) as unknown as Row[];
  return must(rows[0]).n as number;
}

type WireEvent = { position: string; eventName: string; payload: Record<string, unknown> };
async function readFeed(): Promise<WireEvent[]> {
  const got = await authority.ticketClient.get({ organizationId: FIX, producerApplicationId: SALES_APP });
  if (got.status !== 'ok') throw new Error(`ticket ${got.status}`);
  const res = await feedApp.request('/integration/v1/feed?after=0&limit=500', {
    headers: { Authorization: `Bearer ${got.ticket.ticket}` },
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { events: WireEvent[] }).events;
}

function financeHarness() {
  const pair: IntegrationPullPair = { producerApplicationId: FINANCE_APP, organizationId: FIX };
  const discovery: IntegrationDiscovery = {
    contracts: async () => [],
    activations: async () => [pair],
    producerActivations: async () => [],
  };
  const consumer = createFinanceConsumer({
    adapter,
    discovery,
    ticketClient: authority.ticketClient,
    now: () => new Date('2026-09-10T15:00:00.000Z'),
  });
  const feed = createSimulatedFinanceFeed();
  consumer.config.fetchFeedPage = async (p, after, limit) => feed.fetchFeedPage(p, after, limit);
  return { consumer, feed, pull: () => pullOnce(consumer) };
}

const financeRecorded = (receivableId: string, id: string, amountCents: number) => ({
  settlementRef: `fxl-finance:${id}`,
  obligationRef: `fxl-sales:${receivableId}`,
  amountCents,
  paidOn: '2026-09-01',
  recordedBy: { app: FINANCE_APP, displayName: 'Tesouraria' },
});
const financeReversed = (baixaId: string, estornoId: string, amountCents: number) => ({
  reversalRef: `fxl-finance:${estornoId}`,
  reversesSettlementRef: `fxl-finance:${baixaId}`,
  amountCents,
  reversedOn: '2026-09-02',
  reason: 'devolvido',
  recordedBy: { app: FINANCE_APP, displayName: 'Tesouraria' },
});

async function facts(receivableId: string) {
  return getAdminDb()
    .select()
    .from(salesOpsSettlements)
    .where(and(eq(salesOpsSettlements.orgId, FIX), eq(salesOpsSettlements.receivableId, receivableId)));
}
async function receivableRow(id: string) {
  const [row] = await getAdminDb().select().from(salesOpsReceivables).where(eq(salesOpsReceivables.id, id));
  return must(row);
}

beforeAll(async () => {
  const got = await authority.ticketClient.get({ organizationId: FIX, producerApplicationId: SALES_APP });
  expect(got.status).toBe('ok');
  if (got.status !== 'ok') return;
  const verdict = await authority.verifier.verify(got.ticket.ticket);
  expect(verdict.status).toBe('authorized');
  if (verdict.status === 'authorized') expect(verdict.decision.organizationId).toBe(FIX);
  registerProducerFlowGate((orgId) => orgId === FIX);
});

afterEach(async () => {
  await deleteSettlementsForOrgs([FIX]);
  const db = getAdminDb();
  await db.delete(salesOpsPayables).where(eq(salesOpsPayables.orgId, FIX));
  await db.delete(salesOpsReceivables).where(eq(salesOpsReceivables.orgId, FIX));
  await db.delete(salesOpsSaleProfessionals).where(eq(salesOpsSaleProfessionals.orgId, FIX));
  await db.delete(salesOpsSaleItems).where(eq(salesOpsSaleItems.orgId, FIX));
  await db.delete(salesOpsSales).where(eq(salesOpsSales.orgId, FIX));
  await db.execute(sql`DELETE FROM integration_outbox WHERE organization_id = ${FIX}`);
  await db.execute(sql`DELETE FROM integration_inbox WHERE organization_id = ${FIX}`);
  await db.execute(sql`DELETE FROM integration_cursor WHERE organization_id = ${FIX}`);
});

afterAll(async () => {
  registerProducerFlowGate(() => false);
  await closeDb();
});

describe('Sales <-> Finance integration over org_fake_integrado', () => {
  it('case 1: a won proposta enqueues obligation.upserted and the feed serves it', async () => {
    const { receivableId } = await seedWonSale();
    expect(await outboxCount('fxl-sales.obligation.upserted')).toBeGreaterThan(0);
    await publishPendingPositions({ adapter });

    const events = await readFeed();
    const upserts = events.filter((e) => e.eventName === 'fxl-sales.obligation.upserted');
    expect(upserts.length).toBeGreaterThan(0);
    const positions = events.map((e) => BigInt(e.position));
    expect(positions).toEqual([...positions].sort((a, b) => (a < b ? -1 : 1)));
    expect(upserts.some((e) => e.payload.obligationRef === `fxl-sales:${receivableId}`)).toBe(true);

    const bad = await feedApp.request('/integration/v1/feed?after=0', {
      headers: { Authorization: 'Bearer garbage-ticket' },
    });
    expect(bad.status).toBe(401);
    expect(await bad.json()).toEqual({ error: 'unauthorized' });
  });

  it('case 2: a local baixa reaches the feed; a finance baixa applies as origin=finance and emits nothing', async () => {
    const { receivableId } = await seedWonSale();
    const local = await recordSettlement(getDb(), FIX, actor, {
      targetKind: 'receivable',
      targetId: receivableId,
      paidOn: '2026-09-01',
    });
    expect(local.ok).toBe(true);
    await publishPendingPositions({ adapter });
    const recorded = (await readFeed()).filter((e) => e.eventName === 'fxl-sales.settlement.recorded');
    expect(recorded).toHaveLength(1);

    // A second, still-open parcela is paid from Finance.
    const [other] = await getAdminDb()
      .select()
      .from(salesOpsReceivables)
      .where(and(eq(salesOpsReceivables.orgId, FIX), eq(salesOpsReceivables.label, '2/2')));
    const otherId = must(other).id;
    const before = await outboxCount();
    const h = financeHarness();
    const settlementId = crypto.randomUUID();
    h.feed.publish('fxl-finance.settlement.recorded', financeRecorded(otherId, settlementId, 200000));
    const report = await h.pull();
    expect(report.applied).toBe(1);

    const rows = await facts(otherId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: settlementId, origin: 'finance', type: 'baixa', amountBrl: 200000 });
    expect((await receivableRow(otherId)).status).toBe('paid');
    expect(await outboxCount()).toBe(before);
  });

  it('case 3: an estorno syncs on each side', async () => {
    const { receivableId, saleId } = await seedWonSale();
    const baixa = await recordSettlement(getDb(), FIX, actor, {
      targetKind: 'receivable',
      targetId: receivableId,
      paidOn: '2026-09-01',
    });
    if (!baixa.ok) throw new Error('baixa');
    const estorno = await reverseSettlement(getDb(), FIX, actor, baixa.settlement.id, { reason: 'erro' });
    expect(estorno.ok).toBe(true);
    await publishPendingPositions({ adapter });
    const reversed = (await readFeed()).filter((e) => e.eventName === 'fxl-sales.settlement.reversed');
    expect(reversed).toHaveLength(1);

    // Finance side: baixa then estorno on the other parcela.
    const [other] = await getAdminDb()
      .select()
      .from(salesOpsReceivables)
      .where(and(eq(salesOpsReceivables.saleId, saleId), eq(salesOpsReceivables.label, '2/2')));
    const otherId = must(other).id;
    const before = await outboxCount();
    const h = financeHarness();
    const baixaId = crypto.randomUUID();
    const estornoId = crypto.randomUUID();
    h.feed.publish('fxl-finance.settlement.recorded', financeRecorded(otherId, baixaId, 200000));
    h.feed.publish('fxl-finance.settlement.reversed', financeReversed(baixaId, estornoId, 200000));
    await h.pull();
    const rows = await facts(otherId);
    expect(rows).toHaveLength(2);
    expect(must(rows.find((r) => r.type === 'estorno'))).toMatchObject({
      id: estornoId,
      origin: 'finance',
      reversesSettlementId: baixaId,
    });
    expect((await receivableRow(otherId)).status).toBe('open');
    expect(await outboxCount()).toBe(before);
  });

  it('case 4: a won proposta with an active baixa cannot leave won and enqueues no void', async () => {
    const { receivableId, saleId } = await seedWonSale();
    const baixa = await recordSettlement(getDb(), FIX, actor, {
      targetKind: 'receivable',
      targetId: receivableId,
      paidOn: '2026-09-01',
    });
    expect(baixa.ok).toBe(true);
    const before = await outboxCount();
    const result = await transitionSale(getDb(), FIX, saleId, 'open' as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('sale_has_active_settlements');
    expect(await outboxCount()).toBe(before);
    const [sale] = await getAdminDb().select().from(salesOpsSales).where(eq(salesOpsSales.id, saleId));
    expect(must(sale).status).toBe('won');
  });

  it('case 5: a baixa in both apps leaves the row paid with two active settlements, flagged duplicidade, finance emits nothing', async () => {
    const { receivableId } = await seedWonSale();
    const local = await recordSettlement(getDb(), FIX, actor, {
      targetKind: 'receivable',
      targetId: receivableId,
      paidOn: '2026-09-01',
    });
    expect(local.ok).toBe(true);
    await publishPendingPositions({ adapter });
    const before = await outboxCount();

    const h = financeHarness();
    h.feed.publish('fxl-finance.settlement.recorded', financeRecorded(receivableId, crypto.randomUUID(), 300000));
    await h.pull();

    const rows = await facts(receivableId);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.origin).sort()).toEqual(['finance', 'manual']);
    const row = await receivableRow(receivableId);
    expect(row.status).toBe('paid');
    const state = reduceSettlement(
      { obligationRef: `fxl-sales:${receivableId}`, amountCents: row.amountBrl, state: 'active' },
      rows.map((r) => ({
        kind: 'settlement' as const,
        settlementRef: `${r.origin === 'finance' ? 'fxl-finance' : 'fxl-sales'}:${r.id}`,
        obligationRef: `fxl-sales:${receivableId}`,
        amountCents: r.amountBrl,
        paidOn: String(r.paidOn).slice(0, 10),
        origin: r.origin === 'finance' ? ('remote' as const) : ('local' as const),
      })),
    );
    expect(state.activeSettlementRefs).toHaveLength(2);
    expect(state.localSettlementRefs).toHaveLength(1);
    expect(state.remoteSettlementRefs).toHaveLength(1);
    expect(state.settledAmountCents).toBe(600000);
    expect(deriveSettlementAnomaly('paid', row.amountBrl, rows)).toBe('duplicidade');
    expect(await outboxCount()).toBe(before);
  });
});
