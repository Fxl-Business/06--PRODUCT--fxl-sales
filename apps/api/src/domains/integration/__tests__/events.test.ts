import {
  isObligationUpsertedV1,
  isSettlementRecordedV1,
  isSettlementReversedV1,
  OBLIGATION_UPSERTED_V1_EXAMPLE,
  SETTLEMENT_RECORDED_V1_EXAMPLE_SALES,
  SETTLEMENT_REVERSED_V1_EXAMPLE,
} from '@fxl-business/fxl-contracts';
import { describe, expect, it } from 'vitest';
import {
  buildObligationUpsertedEvents,
  buildObligationVoidedEvents,
  buildSettlementRecordedEvent,
  buildSettlementReversedEvent,
  type ObligationRowInput,
  type SettlementRowForEvent,
} from '../events.js';

let n = 0;
const meta = () => ({ newId: () => `evt-${++n}`, occurredAt: new Date('2026-10-01T12:00:00Z') });
const S1 = '6f1c9b3a-2d47-4e18-9c05-7ab3e2f81d64';
const S2 = '1d0a5c77-4b92-4f31-8e6a-30b8c1f24e09';
const source = { saleId: 'sale-1', saleCode: 'VD-2026-0001', clientName: 'Padaria Aurora ME' };

const rec = (id: string, label: string, revision = 1): ObligationRowInput => ({
  direction: 'receivable',
  row: {
    id, label, dueDate: new Date('2026-10-15T00:00:00Z'), amountBrl: 250000,
    method: 'pix', status: 'open', revision,
  },
});
const pay = (id: string, kind: 'seller_commission' | 'tax' | 'professional_cost' | 'finder_commission' | 'other_cost'): ObligationRowInput => ({
  direction: 'payable',
  row: { id, kind, beneficiaryName: 'Ana', dueDate: '2026-10-20', amountBrl: 1000, status: 'open', revision: 3 },
});

describe('obligation builders', () => {
  const obligations = [
    rec('r1', '1/3'),
    rec('r2', 'M1/6'),
    pay('p1', 'seller_commission'),
    pay('p2', 'professional_cost'),
    pay('p3', 'tax'),
  ];

  it('emits schema-valid envelopes only for the synced subset', () => {
    const events = buildObligationUpsertedEvents({ organizationId: 'org-1', source, obligations, meta: meta() });
    expect(events.map((e) => (e.payload as { obligationRef: string }).obligationRef)).toEqual([
      'fxl-sales:r1', 'fxl-sales:r2', 'fxl-sales:p1', 'fxl-sales:p2',
    ]);
    for (const e of events) {
      expect(isObligationUpsertedV1(e.payload)).toBe(true);
      expect(e.eventName).toBe('fxl-sales.obligation.upserted');
      expect(e.eventVersion).toBe(1);
      expect((e.payload as { source: { deepLinkPath: string } }).source.deepLinkPath).toBe('/operacional/vendas/sale-1');
    }
    const kinds = events.map((e) => (e.payload as { kind: string }).kind);
    expect(kinds).toEqual(['sale_installment', 'sale_recurring', 'seller_commission', 'professional_cost']);
  });

  it('matches the golden payload shape', () => {
    const [e] = buildObligationUpsertedEvents({ organizationId: 'org-1', source, obligations: [rec('cl9x7k2p00001', '1/3')], meta: meta() });
    const golden = OBLIGATION_UPSERTED_V1_EXAMPLE as Record<string, unknown>;
    const payload = e!.payload as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(Object.keys(golden).sort());
    expect(payload.counterparty).toEqual({ displayName: 'Padaria Aurora ME', role: 'client' });
  });

  it('idempotency key follows the row revision and is stable', () => {
    const a = buildObligationUpsertedEvents({ organizationId: 'o', source, obligations: [rec('r1', '1/3', 4)], meta: meta() });
    const b = buildObligationUpsertedEvents({ organizationId: 'o', source, obligations: [rec('r1', '1/3', 4)], meta: meta() });
    expect(a[0]!.idempotencyKey).toBe('obligation:fxl-sales:r1:rev:4');
    expect(b[0]!.idempotencyKey).toBe(a[0]!.idempotencyKey);
  });

  it('skips zeroed rows and builds voided events with the reason', () => {
    const base = rec('z', '2/3');
    const zero = { ...base, row: { ...base.row, amountBrl: 0 } } as ObligationRowInput;
    expect(buildObligationUpsertedEvents({ organizationId: 'o', source, obligations: [zero], meta: meta() })).toEqual([]);
    const [v] = buildObligationVoidedEvents({ organizationId: 'o', source, obligations: [pay('p1', 'finder_commission')], voidReason: 'sale_cancelled', meta: meta() });
    const payload = v!.payload as { state: string; voidReason: string };
    expect(payload.state).toBe('voided');
    expect(payload.voidReason).toBe('sale_cancelled');
    expect(isObligationUpsertedV1(v!.payload)).toBe(true);
  });
});

describe('settlement builders', () => {
  const baixa: SettlementRowForEvent = {
    id: S1, type: 'baixa', reversesSettlementId: null, paidOn: '2026-10-14', amountBrl: 250000,
    targetKind: 'receivable', receivableId: 'r1', payableId: null, actorName: 'Marina Alves',
  };
  it('records with app.fxl-sales and the settlement key', () => {
    const e = buildSettlementRecordedEvent({ organizationId: 'o', row: baixa, meta: meta() });
    expect(isSettlementRecordedV1(e.payload)).toBe(true);
    expect(e.idempotencyKey).toBe(`settlement:fxl-sales:${S1}`);
    expect(e.payload).toMatchObject({ obligationRef: 'fxl-sales:r1', recordedBy: { app: 'app.fxl-sales', displayName: 'Marina Alves' } });
    expect(Object.keys(e.payload as object).sort()).toEqual(Object.keys(SETTLEMENT_RECORDED_V1_EXAMPLE_SALES as object).sort());
  });
  it('uses the payable id for payable targets and a fallback actor', () => {
    const e = buildSettlementRecordedEvent({ organizationId: 'o', row: { ...baixa, targetKind: 'payable', receivableId: null, payableId: 'p9', actorName: null }, meta: meta() });
    expect(e.payload).toMatchObject({ obligationRef: 'fxl-sales:p9', recordedBy: { displayName: 'Autor não identificado' } });
  });
  it('reverses with the reversal key', () => {
    const e = buildSettlementReversedEvent({
      organizationId: 'o',
      row: { ...baixa, id: S2, type: 'estorno', reversesSettlementId: S1, reason: 'erro' },
      meta: meta(),
    });
    expect(isSettlementReversedV1(e.payload)).toBe(true);
    expect(e.idempotencyKey).toBe(`reversal:fxl-sales:${S2}`);
    expect(e.payload).toMatchObject({ reversesSettlementRef: `fxl-sales:${S1}`, reason: 'erro', recordedBy: { app: 'app.fxl-sales' } });
    const golden = Object.keys(SETTLEMENT_REVERSED_V1_EXAMPLE as object);
    for (const k of Object.keys(e.payload as object)) expect(golden).toContain(k);
  });
  it('refuses the wrong row type', () => {
    expect(() => buildSettlementReversedEvent({ organizationId: 'o', row: baixa, meta: meta() })).toThrow();
  });
});
