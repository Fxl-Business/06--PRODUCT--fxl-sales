/**
 * Slice 04 oracle: the Finance settlement consumer through the REAL `pullOnce`,
 * the pooled admin adapter and the local test DB.
 * Run: pnpm --filter @fxl-sales/api test:integration consumer.integration
 */
import { randomUUID } from 'node:crypto';
import type { FeedEvent, FeedPage, IntegrationPullPair } from '@fxl-business/fxl-contracts';
import { pullOnce } from '@fxl-business/fxl-contracts';
import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { deleteSettlementsForOrgs } from '../../../db/__tests__/settlement-test-cleanup.js';
import { closeDb, getAdminDb } from '../../../db/client.js';
import {
  salesOpsReceivables,
  salesOpsSales,
  salesOpsSettlements,
} from '../../../db/schema.js';
import { applyBaixaTx, deriveSettlementAnomaly, toEvent } from '../../sales-ops/settlements.js';
import { reduzirLiquidacao } from '@fxl-sales/shared-utils/liquidacao';
import { withTenant } from '../../sales-ops/service.js';
import { createFinanceConsumer } from '../consumer.js';
import type { IntegrationDiscovery } from '../hub-client.js';
import { createIntegrationPooledAdapter } from '../outbox-adapter.js';

const FINANCE = 'app.fxl-finance';
const seededOrgIds: string[] = [];

function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('expected a row');
  return v;
}

async function seed(status: 'open' | 'void' = 'open') {
  const orgId = `org_cons_${randomUUID()}`;
  seededOrgIds.push(orgId);
  const db = getAdminDb();
  const [sale] = await db
    .insert(salesOpsSales)
    .values({
      orgId,
      sequence: 1,
      code: '0001-0',
      clientNameSnapshot: 'Cliente',
      sellerNameSnapshot: 'Ana',
      finderNameSnapshot: null,
      finderPersonId: null,
      status: 'won',
      paymentMethod: 'pix',
      condition: 'installments',
      installments: 1,
      baseDate: new Date('2026-07-29T00:00:00.000Z'),
      totalBrl: 100000,
      recurringBrl: 0,
      sellerCommissionPct: '0.00',
      finderCommissionPct: '0.00',
      taxPct: '0.00',
      otherCostsBrl: 0,
      netMarginPct: '0.00',
    })
    .returning();
  const [receivable] = await db
    .insert(salesOpsReceivables)
    .values({
      orgId,
      saleId: must(sale).id,
      label: '1/1',
      dueDate: new Date('2026-08-01T00:00:00.000Z'),
      amountBrl: 100000,
      method: 'pix',
      status,
    })
    .returning();
  return { orgId, saleId: must(sale).id, receivableId: must(receivable).id };
}

let position = 0n;
function feedEvent(
  eventName: string,
  payload: unknown,
  overrides: Partial<FeedEvent> = {},
): FeedEvent {
  position += 1n;
  return {
    position,
    eventName,
    eventVersion: 1,
    idempotencyKey: `${eventName}:${randomUUID()}`,
    payload,
    occurredAt: '2026-09-01T12:00:00.000Z',
    ...overrides,
  };
}

function recordedPayload(receivableId: string, settlementId: string, amountCents = 100000) {
  return {
    settlementRef: `fxl-finance:${settlementId}`,
    obligationRef: `fxl-sales:${receivableId}`,
    amountCents,
    paidOn: '2026-09-01',
    recordedBy: { app: FINANCE, displayName: 'Tesouraria' },
  };
}

function reversedPayload(baixaId: string, estornoId: string, amountCents = 100000) {
  return {
    reversalRef: `fxl-finance:${estornoId}`,
    reversesSettlementRef: `fxl-finance:${baixaId}`,
    amountCents,
    reversedOn: '2026-09-02',
    reason: 'devolvido',
    recordedBy: { app: FINANCE, displayName: 'Tesouraria' },
  };
}

function harness(orgId: string) {
  const pair: IntegrationPullPair = { producerApplicationId: FINANCE, organizationId: orgId };
  const discovery: IntegrationDiscovery = {
    contracts: async () => [],
    activations: async () => [pair],
    producerActivations: async () => [],
  };
  const consumer = createFinanceConsumer({
    adapter: createIntegrationPooledAdapter(),
    discovery,
    ticketClient: undefined as never,
    now: () => new Date('2026-09-10T15:00:00.000Z'),
  });
  const pages: FeedEvent[][] = [];
  consumer.config.fetchFeedPage = async (_pair, after): Promise<FeedPage> => {
    const events = pages.flat().filter((e) => e.position > after);
    return { events, nextCursor: events.length ? events[events.length - 1]!.position : after };
  };
  return {
    consumer,
    feed: (...events: FeedEvent[]) => pages.push(events),
    pull: () => pullOnce(consumer),
    pair,
  };
}

async function settlements(orgId: string) {
  return getAdminDb().select().from(salesOpsSettlements).where(eq(salesOpsSettlements.orgId, orgId));
}
async function cursorOf(orgId: string): Promise<bigint> {
  const rows = (await getAdminDb().execute(
    sql`SELECT position FROM integration_cursor WHERE organization_id = ${orgId}`,
  )) as unknown as Array<{ position: string }>;
  return BigInt(rows[0]?.position ?? '0');
}
async function inboxCount(orgId: string): Promise<number> {
  const rows = (await getAdminDb().execute(
    sql`SELECT count(*)::int AS n FROM integration_inbox WHERE organization_id = ${orgId}`,
  )) as unknown as Array<{ n: number }>;
  return rows[0]!.n;
}
async function outboxCount(): Promise<number> {
  const rows = (await getAdminDb().execute(
    sql`SELECT count(*)::int AS n FROM integration_outbox`,
  )) as unknown as Array<{ n: number }>;
  return rows[0]!.n;
}
async function receivable(id: string) {
  const [row] = await getAdminDb().select().from(salesOpsReceivables).where(eq(salesOpsReceivables.id, id));
  return must(row);
}

afterEach(async () => {
  await deleteSettlementsForOrgs(seededOrgIds);
  const db = getAdminDb();
  for (const orgId of seededOrgIds) {
    await db.execute(sql`DELETE FROM integration_inbox WHERE organization_id = ${orgId}`);
    await db.execute(sql`DELETE FROM integration_cursor WHERE organization_id = ${orgId}`);
    await db.delete(salesOpsReceivables).where(eq(salesOpsReceivables.orgId, orgId));
    await db.delete(salesOpsSales).where(eq(salesOpsSales.orgId, orgId));
  }
  seededOrgIds.length = 0;
});

afterAll(async () => {
  await closeDb();
});

describe('finance settlement consumer applies once, is idempotent, versions, disputes and never echoes', () => {
  it("applies a finance settlement.recorded as exactly one origin='finance' row in the inbox+cursor transaction", async () => {
    const { orgId, receivableId } = await seed();
    const h = harness(orgId);
    const settlementId = randomUUID();
    const ev = feedEvent('fxl-finance.settlement.recorded', recordedPayload(receivableId, settlementId));
    h.feed(ev);
    const report = await h.pull();
    expect(report.applied).toBe(1);
    const rows = await settlements(orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: settlementId,
      origin: 'finance',
      type: 'baixa',
      amountBrl: 100000,
      paidOn: '2026-09-01',
      actorUserId: 'system',
      actorName: 'Tesouraria',
    });
    expect(await inboxCount(orgId)).toBe(1);
    expect(await cursorOf(orgId)).toBe(ev.position);
    expect((await receivable(receivableId)).status).toBe('paid');
    expect(await outboxCount()).toBe(0);
  });

  it('replays are skipped and never double-apply', async () => {
    const { orgId, receivableId } = await seed();
    const h = harness(orgId);
    const ev = feedEvent('fxl-finance.settlement.recorded', recordedPayload(receivableId, randomUUID()));
    h.feed(ev);
    await h.pull();
    // Redeliver the same event from a rewound cursor.
    await getAdminDb().execute(sql`UPDATE integration_cursor SET position = 0 WHERE organization_id = ${orgId}`);
    const report = await h.pull();
    expect(report.applied).toBe(0);
    expect(report.skipped).toBeGreaterThanOrEqual(1);
    expect(await settlements(orgId)).toHaveLength(1);
  });

  it('rejects an unknown version without applying and lets the cursor advance', async () => {
    const { orgId, receivableId } = await seed();
    const h = harness(orgId);
    const bad = feedEvent('fxl-finance.settlement.recorded', recordedPayload(receivableId, randomUUID()), {
      eventVersion: 2,
    });
    h.feed(bad);
    await h.pull();
    expect(await settlements(orgId)).toHaveLength(0);
    expect(h.consumer.counters.rejected).toBe(1);
    expect(await cursorOf(orgId)).toBe(bad.position);
    const good = feedEvent('fxl-finance.settlement.recorded', recordedPayload(receivableId, randomUUID()));
    h.feed(good);
    await h.pull();
    expect(await settlements(orgId)).toHaveLength(1);
    expect(await cursorOf(orgId)).toBe(good.position);
  });

  it('rejects a sales-origin, unknown-obligation and bad-cents fact permanently', async () => {
    const { orgId, receivableId } = await seed();
    const h = harness(orgId);
    const echo = recordedPayload(receivableId, randomUUID());
    h.feed(
      feedEvent('fxl-finance.settlement.recorded', { ...echo, recordedBy: { app: 'app.fxl-sales', displayName: 'X' } }),
      feedEvent('fxl-finance.settlement.recorded', recordedPayload(randomUUID(), randomUUID())),
      feedEvent('fxl-finance.settlement.recorded', recordedPayload(receivableId, randomUUID(), 0)),
    );
    await h.pull();
    expect(await settlements(orgId)).toHaveLength(0);
    expect(h.consumer.counters.rejected).toBe(3);
  });

  it('applies a finance settlement.reversed against the mapped local baixa', async () => {
    const { orgId, receivableId } = await seed();
    const h = harness(orgId);
    const baixaId = randomUUID();
    const estornoId = randomUUID();
    h.feed(
      feedEvent('fxl-finance.settlement.recorded', recordedPayload(receivableId, baixaId)),
      feedEvent('fxl-finance.settlement.reversed', reversedPayload(baixaId, estornoId)),
    );
    await h.pull();
    const rows = await settlements(orgId);
    expect(rows).toHaveLength(2);
    const estorno = must(rows.find((r) => r.type === 'estorno'));
    expect(estorno).toMatchObject({ id: estornoId, origin: 'finance', reversesSettlementId: baixaId, reason: 'devolvido' });
    const liquidacao = reduzirLiquidacao({ valorOriginalCentavos: 100000, eventos: rows.map(toEvent) });
    expect(liquidacao.baixasAtivas).toHaveLength(0);
    expect((await receivable(receivableId)).status).toBe('open');
    expect(await outboxCount()).toBe(0);
  });

  it('holds a reversal that cites a baixa that has not landed (no inbox row, cursor stays)', async () => {
    const { orgId } = await seed();
    const h = harness(orgId);
    const baixaId = randomUUID();
    const rev = feedEvent('fxl-finance.settlement.reversed', reversedPayload(baixaId, randomUUID()));
    h.feed(rev);
    const errors: unknown[] = [];
    h.consumer.onError = (e) => errors.push(e);
    await pullOnce(h.consumer);
    expect(await cursorOf(orgId)).toBe(0n);
    expect(await inboxCount(orgId)).toBe(0);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('marks disputed when the obligation is voided', async () => {
    const { orgId, receivableId } = await seed('void');
    const h = harness(orgId);
    h.feed(feedEvent('fxl-finance.settlement.recorded', recordedPayload(receivableId, randomUUID())));
    await h.pull();
    const rows = await settlements(orgId);
    expect(rows).toHaveLength(1);
    const row = await receivable(receivableId);
    expect(row.status).toBe('void');
    expect(deriveSettlementAnomaly('void', row.amountBrl, rows)).toBe('disputed');
  });

  it('marks duplicidade on two concurrent integral baixas', async () => {
    const { orgId, receivableId } = await seed();
    const h = harness(orgId);
    const manual = await withTenant(getAdminDb() as never, orgId, (tx) =>
      applyBaixaTx(
        tx,
        orgId,
        {
          target: { kind: 'receivable', id: receivableId },
          paidOn: '2026-09-01',
          today: '2026-09-10',
          origin: 'manual',
          actor: { userId: 'u1', displayName: 'Ana' },
        },
        { mode: 'manual' },
      ),
    );
    expect(manual.ok).toBe(true);
    h.feed(feedEvent('fxl-finance.settlement.recorded', recordedPayload(receivableId, randomUUID())));
    await h.pull();
    const rows = await settlements(orgId);
    expect(rows).toHaveLength(2);
    const row = await receivable(receivableId);
    expect(row.status).toBe('paid');
    expect(deriveSettlementAnomaly('paid', row.amountBrl, rows)).toBe('duplicidade');
  });

  it('never enqueues an outbox row', async () => {
    expect(await outboxCount()).toBe(0);
  });
});
