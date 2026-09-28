/**
 * Slice 07 oracle: producer emission wired into the sale and settlement
 * transactions. Real service functions through getDb() (tenant role, RLS live);
 * fixtures seeded and cleaned through getAdminDb().
 *
 * Run: pnpm --filter @fxl-sales/api test:integration producer-emission
 */
import { sql, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { deleteSettlementsForOrgs } from '../../../db/__tests__/settlement-test-cleanup.js';
import { closeDb, getAdminDb, getDb } from '../../../db/client.js';
import {
  salesOpsPayables,
  salesOpsReceivables,
  salesOpsSaleItems,
  salesOpsSaleProfessionals,
  salesOpsSales,
} from '../../../db/schema.js';
import { registerProducerFlowGate } from '../../integration/producer-gate.js';
import { cancelContract, transitionSale, withTenant } from '../service.js';
import { applyBaixaTx, recordSettlement, reverseSettlement } from '../settlements.js';

const actor = { userId: 'hub-account-emission-1', displayName: 'Ana Emissao' };
const liveOrgs = new Set<string>();
const seededOrgIds: string[] = [];

function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('expected a row, got undefined');
  return v;
}

function newOrg(tag: string, live: boolean): string {
  const orgId = `org_emit_${tag}_${crypto.randomUUID()}`;
  seededOrgIds.push(orgId);
  if (live) liveOrgs.add(orgId);
  return orgId;
}

async function seedOpenSale(orgId: string) {
  const admin = getAdminDb();
  const [sale] = await admin
    .insert(salesOpsSales)
    .values({
      orgId,
      sequence: 1,
      code: '0001-0',
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
    })
    .returning();
  const s = must(sale);
  const receivables = await admin
    .insert(salesOpsReceivables)
    .values([
      { orgId, saleId: s.id, label: '1/2', dueDate: new Date('2026-08-01T00:00:00.000Z'), amountBrl: 300000, method: 'pix', status: 'open' },
      { orgId, saleId: s.id, label: '2/2', dueDate: new Date('2026-09-01T00:00:00.000Z'), amountBrl: 200000, method: 'pix', status: 'open' },
    ])
    .returning();
  return { sale: s, r1: must(receivables[0]), r2: must(receivables[1]) };
}

type OutboxRow = { event_name: string; idempotency_key: string; payload: Record<string, unknown> };
async function outboxOf(orgId: string): Promise<OutboxRow[]> {
  return (await getAdminDb().execute(
    sql`SELECT event_name, idempotency_key, payload FROM integration_outbox WHERE organization_id = ${orgId} ORDER BY position`,
  )) as unknown as OutboxRow[];
}
const names = (rows: OutboxRow[]) => rows.map((r) => r.event_name);

beforeAll(() => {
  registerProducerFlowGate((orgId) => liveOrgs.has(orgId));
});

afterEach(async () => {
  await deleteSettlementsForOrgs(seededOrgIds);
  const admin = getAdminDb();
  for (const orgId of seededOrgIds) {
    await admin.execute(sql`DELETE FROM integration_outbox WHERE organization_id = ${orgId}`);
    await admin.delete(salesOpsPayables).where(eq(salesOpsPayables.orgId, orgId));
    await admin.delete(salesOpsReceivables).where(eq(salesOpsReceivables.orgId, orgId));
    await admin.delete(salesOpsSaleProfessionals).where(eq(salesOpsSaleProfessionals.orgId, orgId));
    await admin.delete(salesOpsSaleItems).where(eq(salesOpsSaleItems.orgId, orgId));
    await admin.delete(salesOpsSales).where(eq(salesOpsSales.orgId, orgId));
  }
  seededOrgIds.length = 0;
  liveOrgs.clear();
});

afterAll(async () => {
  registerProducerFlowGate(() => false);
  await closeDb();
});

describe('producer emission (connected org)', () => {
  it('emits upserts on win, settlement events on baixa/estorno, voids on revert', async () => {
    const orgId = newOrg('flow', true);
    const { sale, r1 } = await seedOpenSale(orgId);

    expect((await transitionSale(getDb(), orgId, sale.id, 'won')).ok).toBe(true);
    const afterWin = await outboxOf(orgId);
    expect(afterWin.length).toBeGreaterThanOrEqual(2);
    expect(new Set(names(afterWin))).toEqual(new Set(['fxl-sales.obligation.upserted']));
    expect(afterWin.every((r) => r.payload.state === 'active')).toBe(true);
    const receivableRefs = afterWin.map((r) => r.payload.obligationRef);
    expect(receivableRefs).toContain(`fxl-sales:${r1.id}`);

    const paid = await recordSettlement(getDb(), orgId, actor, {
      targetKind: 'receivable',
      targetId: r1.id,
      paidOn: '2026-08-02',
    });
    if (!paid.ok) throw new Error('baixa failed');
    const afterBaixa = await outboxOf(orgId);
    expect(names(afterBaixa).filter((n) => n === 'fxl-sales.settlement.recorded')).toHaveLength(1);
    const recorded = must(afterBaixa.find((r) => r.event_name === 'fxl-sales.settlement.recorded'));
    expect(recorded.idempotency_key).toBe(`settlement:fxl-sales:${paid.settlement.id}`);

    const reversed = await reverseSettlement(getDb(), orgId, actor, paid.settlement.id, {});
    expect(reversed.ok).toBe(true);
    const afterEstorno = await outboxOf(orgId);
    expect(names(afterEstorno).filter((n) => n === 'fxl-sales.settlement.reversed')).toHaveLength(1);

    const before = afterEstorno.length;
    expect((await transitionSale(getDb(), orgId, sale.id, 'open')).ok).toBe(true);
    const afterRevert = (await outboxOf(orgId)).slice(before);
    expect(afterRevert.length).toBeGreaterThan(0);
    expect(afterRevert.every((r) => r.event_name === 'fxl-sales.obligation.upserted')).toBe(true);
    expect(afterRevert.every((r) => r.payload.state === 'voided')).toBe(true);
    expect(afterRevert.every((r) => r.payload.voidReason === 'contract-reverted')).toBe(true);
    expect(afterRevert.every((r) => String(r.payload.obligationRef) !== `fxl-sales:${r1.id}`)).toBe(true);
  });

  it('emits voided events with contract-cancelled for the rows cancelContract voids', async () => {
    const orgId = newOrg('cancel', true);
    const { sale } = await seedOpenSale(orgId);
    await transitionSale(getDb(), orgId, sale.id, 'won');
    const before = (await outboxOf(orgId)).length;

    const result = await cancelContract(getDb(), orgId, sale.id, '2026-01-01');
    expect(result.ok).toBe(true);
    const emitted = (await outboxOf(orgId)).slice(before);
    expect(emitted.length).toBeGreaterThanOrEqual(2);
    expect(emitted.every((r) => r.payload.state === 'voided')).toBe(true);
    expect(emitted.every((r) => r.payload.voidReason === 'contract-cancelled')).toBe(true);
  });

  it('rolls the outbox row back with the business transaction', async () => {
    const orgId = newOrg('rollback', true);
    const { sale, r1 } = await seedOpenSale(orgId);
    await transitionSale(getDb(), orgId, sale.id, 'won');
    const before = (await outboxOf(orgId)).length;

    await expect(
      withTenant(getDb(), orgId, async (tx) => {
        const result = await applyBaixaTx(
          tx,
          orgId,
          {
            target: { kind: 'receivable', id: r1.id },
            paidOn: '2026-08-02',
            today: '2026-09-28',
            origin: 'manual',
            actor,
          },
          { mode: 'manual' },
        );
        expect(result.ok).toBe(true);
        expect((await outboxOf(orgId)).length).toBe(before);
        throw new Error('force rollback');
      }),
    ).rejects.toThrow('force rollback');
    expect((await outboxOf(orgId)).length).toBe(before);
  });

  it('emits nothing for a finance-origin settlement (anti-echo)', async () => {
    const orgId = newOrg('finance', true);
    const { sale, r1 } = await seedOpenSale(orgId);
    await transitionSale(getDb(), orgId, sale.id, 'won');
    const before = (await outboxOf(orgId)).length;

    const result = await withTenant(getDb(), orgId, (tx) =>
      applyBaixaTx(
        tx,
        orgId,
        {
          target: { kind: 'receivable', id: r1.id },
          paidOn: '2026-08-02',
          today: '2026-09-28',
          origin: 'finance',
          actor: { userId: 'system', displayName: 'Financeiro' },
          id: crypto.randomUUID(),
        },
        { mode: 'finance', amountCents: r1.amountBrl },
      ),
    );
    expect(result.ok).toBe(true);
    expect((await outboxOf(orgId)).length).toBe(before);
  });
});

describe('producer emission (unconnected org)', () => {
  it('enqueues nothing for win, baixa, estorno, revert', async () => {
    const orgId = newOrg('off', false);
    const { sale, r1 } = await seedOpenSale(orgId);
    await transitionSale(getDb(), orgId, sale.id, 'won');
    const paid = await recordSettlement(getDb(), orgId, actor, {
      targetKind: 'receivable',
      targetId: r1.id,
      paidOn: '2026-08-02',
    });
    if (!paid.ok) throw new Error('baixa failed');
    await reverseSettlement(getDb(), orgId, actor, paid.settlement.id, {});
    await transitionSale(getDb(), orgId, sale.id, 'open');
    expect(await outboxOf(orgId)).toHaveLength(0);
  });
});
