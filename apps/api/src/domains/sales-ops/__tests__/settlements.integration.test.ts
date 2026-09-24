/**
 * Slice 06 (settlements API) integration coverage.
 *
 * Drives the REAL salesOpsRouter and the real service functions through getDb()
 * (tenant role, RLS live). Fixtures are seeded and cleaned through getAdminDb();
 * settlements are removed first through deleteSettlementsForOrgs, the only
 * sanctioned path past the immutability trigger.
 *
 * Run: pnpm --filter @fxl-sales/api test:integration settlements.integration
 */
import { todayInSaoPaulo } from '@fxl-sales/shared-utils/sao-paulo-day';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hubAuthContext } from '../../../auth/__tests__/hub-auth-context-fixture.js';
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
import { cancelContract, transitionSale } from '../service.js';
import { recordSettlement, reverseSettlement } from '../settlements.js';

// The router transitively resolves the Hub contract at module scope; this file
// drives an already-verified context, so the ambient Hub configuration is made
// unambiguously absent before the router is imported (test/unit-setup.ts).
vi.hoisted(() => {
  for (const name of [
    'FXL_HUB_CONFIG',
    'FXL_HUB_API_URL',
    'FXL_HUB_ENVIRONMENT',
    'FXL_HUB_CLIENT_ID',
    'FXL_HUB_CLIENT_SECRET',
    'FXL_HUB_AUDIENCE',
    'SALES_ENV_FILE',
    'SALES_AUTH_FAKE',
  ]) {
    process.env[name] = '';
  }
});

const { salesOpsRouter } = await import('../routes.js');

const ACCOUNT_ID = 'hub-account-financeiro-7f3a';
const SETTLEMENT_ENTRY_KEYS = [
  'actorName',
  'amountBrl',
  'id',
  'origin',
  'paidOn',
  'payableId',
  'reason',
  'receivableId',
  'recordedAt',
  'reversedBySettlementId',
  'reversesSettlementId',
  'saleId',
  'targetKind',
  'type',
].sort();

const seededOrgIds: string[] = [];
const sequenceCounters = new Map<string, number>();

let currentOrgId = '';
let currentRole: 'admin' | 'seller' | 'finder' | undefined = 'admin';

function createTestApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', ACCOUNT_ID);
    c.set('orgId', currentOrgId);
    c.set('userRole', currentRole);
    c.set('userRoles', currentRole ? [currentRole] : []);
    c.set(
      'hubAuth',
      hubAuthContext({ accountId: ACCOUNT_ID, workspaceId: currentOrgId, name: 'Ana Financeiro' }),
    );
    await next();
  });
  app.route('/', salesOpsRouter);
  return app;
}

const app = createTestApp();

function postJson(path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const actor = { userId: ACCOUNT_ID, displayName: 'Ana Financeiro' };

function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('expected a row, got undefined');
  return v;
}

function nextSequence(orgId: string): number {
  const next = (sequenceCounters.get(orgId) ?? 0) + 1;
  sequenceCounters.set(orgId, next);
  return next;
}

function newOrg(tag: string): string {
  const orgId = `org_stl_${tag}_${crypto.randomUUID()}`;
  seededOrgIds.push(orgId);
  return orgId;
}

async function seedSale(orgId: string, overrides: Partial<typeof salesOpsSales.$inferInsert> = {}) {
  const sequence = overrides.sequence ?? nextSequence(orgId);
  const [sale] = await getAdminDb()
    .insert(salesOpsSales)
    .values({
      orgId,
      sequence,
      code: `${String(sequence).padStart(4, '0')}-0`,
      clientNameSnapshot: 'Cliente Teste',
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
      ...overrides,
    })
    .returning();
  return must(sale);
}

async function seedReceivable(
  orgId: string,
  saleId: string,
  overrides: Partial<typeof salesOpsReceivables.$inferInsert> = {},
) {
  const [row] = await getAdminDb()
    .insert(salesOpsReceivables)
    .values({
      orgId,
      saleId,
      label: '1/1',
      dueDate: new Date('2026-08-01T00:00:00.000Z'),
      amountBrl: 300000,
      method: 'pix',
      status: 'open',
      ...overrides,
    })
    .returning();
  return must(row);
}

/** A won proposta with two parcelas and real payables. */
async function seedWonSale(orgId: string) {
  const sale = await seedSale(orgId);
  const r1 = await seedReceivable(orgId, sale.id, {
    label: '1/2',
    dueDate: new Date('2026-08-01T00:00:00.000Z'),
    amountBrl: 300000,
  });
  const r2 = await seedReceivable(orgId, sale.id, {
    label: '2/2',
    dueDate: new Date('2026-09-01T00:00:00.000Z'),
    amountBrl: 200000,
  });
  const won = await transitionSale(getDb(), orgId, sale.id, 'won');
  if (!won.ok) throw new Error('expected win');
  return { sale, r1, r2 };
}

async function receivableRow(id: string) {
  const [row] = await getAdminDb().select().from(salesOpsReceivables).where(eq(salesOpsReceivables.id, id));
  return must(row);
}

async function payablesOf(saleId: string) {
  return getAdminDb().select().from(salesOpsPayables).where(eq(salesOpsPayables.saleId, saleId));
}

async function settlementCount(orgId: string) {
  const rows = await getAdminDb()
    .select({ id: salesOpsSettlements.id })
    .from(salesOpsSettlements)
    .where(eq(salesOpsSettlements.orgId, orgId));
  return rows.length;
}

async function sellerPayableOf(saleId: string, receivableId: string) {
  const [row] = await getAdminDb()
    .select()
    .from(salesOpsPayables)
    .where(
      and(
        eq(salesOpsPayables.saleId, saleId),
        eq(salesOpsPayables.receivableId, receivableId),
        eq(salesOpsPayables.kind, 'seller_commission'),
      ),
    );
  return must(row);
}

type WriteBody = {
  settlement: Record<string, unknown> & { id: string; amountBrl: number; paidOn: string };
  row: { status: string; revision: number; paidOn: string | null; updatedAt: string };
};

async function baixa(targetId: string, paidOn?: string, targetKind = 'receivable') {
  return postJson('/settlements', { targetKind, targetId, ...(paidOn ? { paidOn } : {}) });
}

async function bootstrapRow(kind: 'receivables' | 'payables', id: string) {
  const response = await app.request('/bootstrap');
  const body = (await response.json()) as Record<string, Array<{ id: string; paidOn: string | null }>>;
  return must(body[kind]?.find((row) => row.id === id));
}

beforeEach(() => {
  currentRole = 'admin';
});

afterEach(async () => {
  await deleteSettlementsForOrgs(seededOrgIds);
  const adminDb = getAdminDb();
  for (const orgId of seededOrgIds) {
    await adminDb.delete(salesOpsPayables).where(eq(salesOpsPayables.orgId, orgId));
    await adminDb.delete(salesOpsReceivables).where(eq(salesOpsReceivables.orgId, orgId));
    await adminDb.delete(salesOpsSaleProfessionals).where(eq(salesOpsSaleProfessionals.orgId, orgId));
    await adminDb.delete(salesOpsSaleItems).where(eq(salesOpsSaleItems.orgId, orgId));
    await adminDb.delete(salesOpsSales).where(eq(salesOpsSales.orgId, orgId));
  }
  seededOrgIds.length = 0;
  sequenceCounters.clear();
});

afterAll(async () => {
  await closeDb();
});

describe('POST /settlements (baixa)', () => {
  it('records a baixa for the whole open amount and caches paid with the day', async () => {
    const orgId = newOrg('record');
    currentOrgId = orgId;
    const { r1 } = await seedWonSale(orgId);
    const before = await receivableRow(r1.id);

    const response = await baixa(r1.id, '2026-09-01');
    expect(response.status).toBe(201);
    const text = await response.text();
    expect(text).not.toContain('actorUserId');
    expect(text).not.toContain(ACCOUNT_ID);
    const body = JSON.parse(text) as WriteBody;
    expect(Object.keys(body.settlement).sort()).toEqual(SETTLEMENT_ENTRY_KEYS);
    expect(body.settlement.amountBrl).toBe(300000);
    expect(body.settlement.actorName).toBe('Ana Financeiro');
    expect(body.settlement.type).toBe('baixa');
    expect(body.settlement.origin).toBe('manual');
    expect(body.row.status).toBe('paid');
    expect(body.row.revision).toBe(before.revision + 1);
    expect(body.row.paidOn).toBe('2026-09-01');

    const after = await receivableRow(r1.id);
    expect(after.status).toBe('paid');
    expect(after.revision).toBe(before.revision + 1);
    const [stored] = await getAdminDb()
      .select()
      .from(salesOpsSettlements)
      .where(eq(salesOpsSettlements.id, body.settlement.id));
    expect(must(stored).saleId).toBe(r1.saleId);
    expect(must(stored).actorUserId).toBe(ACCOUNT_ID);
    expect(must(stored).paidOn).toBe('2026-09-01');
  });

  it('refuses a second baixa on a paid row with 409 already_paid and writes nothing', async () => {
    const orgId = newOrg('twice');
    currentOrgId = orgId;
    const { r1 } = await seedWonSale(orgId);
    expect((await baixa(r1.id, '2026-09-01')).status).toBe(201);
    const revision = (await receivableRow(r1.id)).revision;

    const response = await baixa(r1.id, '2026-09-02');
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'already_paid' });
    expect(await settlementCount(orgId)).toBe(1);
    expect((await receivableRow(r1.id)).revision).toBe(revision);
  });

  it('refuses a paidOn after São Paulo today with 422 paid_on_in_future', async () => {
    const orgId = newOrg('future');
    currentOrgId = orgId;
    const { r1 } = await seedWonSale(orgId);
    const [y, m, d] = todayInSaoPaulo().split('-').map(Number);
    const tomorrow = new Date(Date.UTC(y!, m! - 1, d! + 1)).toISOString().slice(0, 10);

    const response = await baixa(r1.id, tomorrow);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'paid_on_in_future' });
    expect(await settlementCount(orgId)).toBe(0);
  });

  it('refuses a non-day paidOn with 422 invalid_paid_on', async () => {
    const orgId = newOrg('nonday');
    currentOrgId = orgId;
    const { r1 } = await seedWonSale(orgId);
    for (const paidOn of ['2026-02-30', '26-09-2026']) {
      const response = await baixa(r1.id, paidOn);
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: 'invalid_paid_on' });
    }
    expect(await settlementCount(orgId)).toBe(0);
  });

  it('defaults paidOn to the São Paulo day near UTC midnight', async () => {
    const orgId = newOrg('default');
    const { r1 } = await seedWonSale(orgId);
    const result = await recordSettlement(
      getDb(),
      orgId,
      actor,
      { targetKind: 'receivable', targetId: r1.id },
      { now: new Date('2026-09-24T01:30:00Z') },
    );
    expect(result.ok).toBe(true);
    const [stored] = await getAdminDb()
      .select()
      .from(salesOpsSettlements)
      .where(eq(salesOpsSettlements.orgId, orgId));
    expect(must(stored).paidOn).toBe('2026-09-23');
  });

  it('refuses a baixa on a void row with 409 row_void', async () => {
    const orgId = newOrg('void');
    currentOrgId = orgId;
    const { r1 } = await seedWonSale(orgId);
    await getAdminDb()
      .update(salesOpsReceivables)
      .set({ status: 'void' })
      .where(eq(salesOpsReceivables.id, r1.id));

    const response = await baixa(r1.id, '2026-09-01');
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'row_void' });
    expect(await settlementCount(orgId)).toBe(0);
  });

  it('refuses a baixa on a non-won proposta with 409 sale_not_won', async () => {
    const orgId = newOrg('notwon');
    currentOrgId = orgId;
    const sale = await seedSale(orgId);
    const r1 = await seedReceivable(orgId, sale.id, { label: '1/1' });

    const response = await baixa(r1.id, '2026-09-01');
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'sale_not_won' });
    expect(await settlementCount(orgId)).toBe(0);
  });
});

describe('POST /settlements/:id/reverse (estorno)', () => {
  it('reverses a baixa, reopens the row, and a new baixa pays it again with the greatest active day', async () => {
    const orgId = newOrg('reverse');
    currentOrgId = orgId;
    const { r1 } = await seedWonSale(orgId);
    const first = (await (await baixa(r1.id, '2026-09-01')).json()) as WriteBody;
    const paidRevision = first.row.revision;

    const reverse = await postJson(`/settlements/${first.settlement.id}/reverse`, {
      reason: '  pago em duplicidade  ',
    });
    expect(reverse.status).toBe(201);
    const reversed = (await reverse.json()) as WriteBody;
    expect(reversed.settlement.type).toBe('estorno');
    expect(reversed.settlement.reversesSettlementId).toBe(first.settlement.id);
    expect(reversed.settlement.reason).toBe('pago em duplicidade');
    expect(reversed.settlement.amountBrl).toBe(300000);
    expect(reversed.row.status).toBe('open');
    expect(reversed.row.revision).toBe(paidRevision + 1);
    expect(reversed.row.paidOn).toBeNull();
    expect((await bootstrapRow('receivables', r1.id)).paidOn).toBeNull();

    const again = (await (await baixa(r1.id, '2026-08-20')).json()) as WriteBody;
    expect(again.row.status).toBe('paid');
    expect((await receivableRow(r1.id)).status).toBe('paid');
    expect((await bootstrapRow('receivables', r1.id)).paidOn).toBe('2026-08-20');
  });

  it('refuses a second reverse with 409 already_reversed', async () => {
    const orgId = newOrg('rev2');
    currentOrgId = orgId;
    const { r1 } = await seedWonSale(orgId);
    const first = (await (await baixa(r1.id, '2026-09-01')).json()) as WriteBody;
    expect((await postJson(`/settlements/${first.settlement.id}/reverse`, {})).status).toBe(201);

    const second = await postJson(`/settlements/${first.settlement.id}/reverse`, {});
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: 'already_reversed' });
    expect(await settlementCount(orgId)).toBe(2);
  });

  it('answers 404 when the id names an estorno', async () => {
    const orgId = newOrg('revestorno');
    currentOrgId = orgId;
    const { r1 } = await seedWonSale(orgId);
    const first = (await (await baixa(r1.id, '2026-09-01')).json()) as WriteBody;
    const estorno = (await (
      await postJson(`/settlements/${first.settlement.id}/reverse`, {})
    ).json()) as WriteBody;

    const response = await postJson(`/settlements/${estorno.settlement.id}/reverse`, {});
    expect(response.status).toBe(404);
  });

  it('maps a reverses_settlement_id UNIQUE race to 409 already_reversed', async () => {
    const orgId = newOrg('race');
    const { r1 } = await seedWonSale(orgId);
    const first = await recordSettlement(getDb(), orgId, actor, {
      targetKind: 'receivable',
      targetId: r1.id,
      paidOn: '2026-09-01',
    });
    if (!first.ok) throw new Error('expected baixa');

    const results = await Promise.all([
      reverseSettlement(getDb(), orgId, actor, first.settlement.id, {}),
      reverseSettlement(getDb(), orgId, actor, first.settlement.id, {}),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === 'already_reversed')).toHaveLength(1);
    const estornos = await getAdminDb()
      .select()
      .from(salesOpsSettlements)
      .where(and(eq(salesOpsSettlements.orgId, orgId), eq(salesOpsSettlements.type, 'estorno')));
    expect(estornos).toHaveLength(1);
  });

  it('revision increments by exactly one on each state change', async () => {
    const orgId = newOrg('revision');
    currentOrgId = orgId;
    const { r1 } = await seedWonSale(orgId);
    const start = (await receivableRow(r1.id)).revision;

    const first = (await (await baixa(r1.id, '2026-09-01')).json()) as WriteBody;
    expect((await receivableRow(r1.id)).revision).toBe(start + 1);
    expect((await baixa(r1.id, '2026-09-01')).status).toBe(409);
    expect((await receivableRow(r1.id)).revision).toBe(start + 1);
    await postJson(`/settlements/${first.settlement.id}/reverse`, {});
    expect((await receivableRow(r1.id)).revision).toBe(start + 2);
    await baixa(r1.id, '2026-09-02');
    expect((await receivableRow(r1.id)).revision).toBe(start + 3);
  });
});

describe('leave-won and cancel-contract locks', () => {
  it('leaving won with an active baixa answers 409 and changes nothing', async () => {
    const orgId = newOrg('leave');
    currentOrgId = orgId;
    const { sale, r1 } = await seedWonSale(orgId);
    expect((await baixa(r1.id, '2026-09-01')).status).toBe(201);
    const payablesBefore = await payablesOf(sale.id);

    const response = await postJson(`/sales/${sale.id}/transition`, { status: 'open' });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'sale_has_active_settlements',
      rows: [{ kind: 'receivable', id: r1.id, label: '1/2' }],
    });

    const [saleAfter] = await getAdminDb().select().from(salesOpsSales).where(eq(salesOpsSales.id, sale.id));
    expect(must(saleAfter).status).toBe('won');
    const payablesAfter = await payablesOf(sale.id);
    const project = (rows: typeof payablesBefore) =>
      rows
        .map((p) => ({ id: p.id, status: p.status, revision: p.revision }))
        .sort((a, b) => a.id.localeCompare(b.id));
    expect(project(payablesAfter)).toEqual(project(payablesBefore));
  });

  it('leaving won with a baixa on a payable names the payable', async () => {
    const orgId = newOrg('leavepay');
    currentOrgId = orgId;
    const { sale, r1 } = await seedWonSale(orgId);
    const seller = await sellerPayableOf(sale.id, r1.id);
    expect((await baixa(seller.id, '2026-09-01', 'payable')).status).toBe(201);

    const response = await postJson(`/sales/${sale.id}/transition`, { status: 'open' });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'sale_has_active_settlements',
      rows: [{ kind: 'payable', id: seller.id, label: 'Ana Martins (1/2)' }],
    });
  });

  it('after the estorno the proposta leaves won and open payables are voided with a revision bump', async () => {
    const orgId = newOrg('leaveok');
    currentOrgId = orgId;
    const { sale, r1 } = await seedWonSale(orgId);
    const first = (await (await baixa(r1.id, '2026-09-01')).json()) as WriteBody;
    await postJson(`/settlements/${first.settlement.id}/reverse`, {});
    const payablesBefore = await payablesOf(sale.id);

    const response = await postJson(`/sales/${sale.id}/transition`, { status: 'open' });
    expect(response.status).toBe(200);
    const payablesAfter = await payablesOf(sale.id);
    expect(payablesAfter.every((p) => p.status === 'void')).toBe(true);
    for (const p of payablesAfter) {
      expect(p.revision).toBe(must(payablesBefore.find((b) => b.id === p.id)).revision + 1);
    }
  });

  async function seedRecurringWonSale(orgId: string) {
    const sale = await seedSale(orgId, { recurringBrl: 100000 });
    const rows = [];
    for (const [label, due] of [
      ['M1/3', '2026-08-01'],
      ['M2/3', '2026-09-01'],
      ['M3/3', '2026-10-01'],
    ] as const) {
      rows.push(
        await seedReceivable(orgId, sale.id, {
          label,
          dueDate: new Date(`${due}T00:00:00.000Z`),
          amountBrl: 100000,
        }),
      );
    }
    const won = await transitionSale(getDb(), orgId, sale.id, 'won');
    if (!won.ok) throw new Error('expected win');
    return { sale, rows };
  }

  it('cancel-contract refuses while a row it would void has an active baixa', async () => {
    const orgId = newOrg('cancel');
    currentOrgId = orgId;
    const { sale, rows } = await seedRecurringWonSale(orgId);
    const seller = await sellerPayableOf(sale.id, must(rows[1]).id);
    expect((await baixa(seller.id, '2026-09-01', 'payable')).status).toBe(201);
    const receivablesBefore = await getAdminDb()
      .select()
      .from(salesOpsReceivables)
      .where(eq(salesOpsReceivables.saleId, sale.id));
    const payablesBefore = await payablesOf(sale.id);

    const result = await cancelContract(getDb(), orgId, sale.id, '2026-08-15');
    expect(result).toEqual({
      ok: false,
      reason: 'sale_has_active_settlements',
      rows: [{ kind: 'payable', id: seller.id, label: 'Ana Martins (M2/3)' }],
    });
    const receivablesAfter = await getAdminDb()
      .select()
      .from(salesOpsReceivables)
      .where(eq(salesOpsReceivables.saleId, sale.id));
    const statusOf = (list: Array<{ id: string; status: string }>) =>
      Object.fromEntries(list.map((r) => [r.id, r.status]));
    expect(statusOf(receivablesAfter)).toEqual(statusOf(receivablesBefore));
    expect(statusOf(await payablesOf(sale.id))).toEqual(statusOf(payablesBefore));
  });

  it('cancel-contract ignores an active baixa on a row it would not void', async () => {
    const orgId = newOrg('cancelok');
    currentOrgId = orgId;
    const { sale, rows } = await seedRecurringWonSale(orgId);
    expect((await baixa(must(rows[0]).id, '2026-08-01')).status).toBe(201);

    const result = await cancelContract(getDb(), orgId, sale.id, '2026-08-15');
    expect(result.ok).toBe(true);
    expect((await receivableRow(must(rows[0]).id)).status).toBe('paid');
    expect((await receivableRow(must(rows[1]).id)).status).toBe('void');
  });
});

describe('isolation, roles and history', () => {
  it('a baixa, a reverse and a history read across orgs answer 404', async () => {
    const orgA = newOrg('xa');
    const orgB = newOrg('xb');
    currentOrgId = orgA;
    const { sale, r1, r2 } = await seedWonSale(orgA);
    const first = (await (await baixa(r1.id, '2026-09-01')).json()) as WriteBody;
    const before = await receivableRow(r2.id);

    currentOrgId = orgB;
    expect((await baixa(r2.id, '2026-09-01')).status).toBe(404);
    expect((await postJson(`/settlements/${first.settlement.id}/reverse`, {})).status).toBe(404);
    expect((await app.request(`/sales/${sale.id}/settlements`)).status).toBe(404);

    expect(await settlementCount(orgA)).toBe(1);
    expect(await settlementCount(orgB)).toBe(0);
    const after = await receivableRow(r2.id);
    expect(after.status).toBe(before.status);
    expect(after.revision).toBe(before.revision);
    expect((await receivableRow(r1.id)).status).toBe('paid');
  });

  it("history lists the sale's baixas and estornos newest first without account ids", async () => {
    const orgId = newOrg('history');
    currentOrgId = orgId;
    const { sale, r1 } = await seedWonSale(orgId);
    const first = (await (await baixa(r1.id, '2026-09-01')).json()) as WriteBody;
    await postJson(`/settlements/${first.settlement.id}/reverse`, { reason: 'duplicado' });
    await baixa(r1.id, '2026-09-02');

    const response = await app.request(`/sales/${sale.id}/settlements`);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(ACCOUNT_ID);
    expect(text).not.toContain('actorUserId');
    const body = JSON.parse(text) as { settlements: Array<Record<string, unknown>> };
    expect(body.settlements.map((s) => s.type)).toEqual(['baixa', 'estorno', 'baixa']);
    for (const entry of body.settlements) {
      expect(Object.keys(entry).sort()).toEqual(SETTLEMENT_ENTRY_KEYS);
    }
    const [newest, estorno, oldest] = body.settlements;
    expect(oldest?.id).toBe(first.settlement.id);
    expect(oldest?.reversedBySettlementId).toBe(estorno?.id);
    expect(newest?.reversedBySettlementId).toBeNull();
    expect(estorno?.reason).toBe('duplicado');
    expect(oldest?.reason).toBeNull();
    expect(newest?.reason).toBeNull();
  });

  it('every settlement route answers 403 for a non-admin and writes nothing', async () => {
    const orgId = newOrg('roles');
    currentOrgId = orgId;
    const { sale, r1, r2 } = await seedWonSale(orgId);
    const first = (await (await baixa(r1.id, '2026-09-01')).json()) as WriteBody;
    const count = await settlementCount(orgId);

    for (const role of ['seller', 'finder', undefined] as const) {
      currentRole = role;
      const responses = [
        await baixa(r2.id, '2026-09-01'),
        await postJson(`/settlements/${first.settlement.id}/reverse`, {}),
        await app.request(`/sales/${sale.id}/settlements`),
      ];
      for (const response of responses) {
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ error: 'forbidden', reason: 'admin_role_required' });
      }
    }
    expect(await settlementCount(orgId)).toBe(count);
    expect((await receivableRow(r2.id)).status).toBe('open');
  });

  it('bootstrap rows carry revision, updatedAt and paidOn', async () => {
    const orgId = newOrg('bootstrap');
    currentOrgId = orgId;
    const { r1 } = await seedWonSale(orgId);
    await baixa(r1.id, '2026-09-01');

    const response = await app.request('/bootstrap');
    const body = (await response.json()) as {
      receivables: Array<{ id: string; revision: unknown; updatedAt: unknown; paidOn: unknown }>;
      payables: Array<{ id: string; revision: unknown; updatedAt: unknown; paidOn: unknown }>;
    };
    const rows = [...body.receivables, ...body.payables];
    expect(body.receivables.length).toBeGreaterThan(0);
    expect(body.payables.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(typeof row.revision).toBe('number');
      expect(typeof row.updatedAt === 'string' && !Number.isNaN(Date.parse(row.updatedAt))).toBe(true);
      expect(row.paidOn === null || typeof row.paidOn === 'string').toBe(true);
    }
    expect(body.receivables.find((r) => r.id === r1.id)?.paidOn).toBe('2026-09-01');
  });
});
