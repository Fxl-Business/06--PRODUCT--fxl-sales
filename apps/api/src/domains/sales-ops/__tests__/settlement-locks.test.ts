import { LiquidacaoErro } from '@fxl-sales/shared-utils/liquidacao';
import { describe, expect, it } from 'vitest';
import { activeSettlementTargetIds, type SaleSettlementRow } from '../settlement-locks.js';

function baixa(
  id: string,
  target: { receivableId: string } | { payableId: string },
  overrides: Partial<SaleSettlementRow> = {},
): SaleSettlementRow {
  const isReceivable = 'receivableId' in target;
  return {
    id,
    targetKind: isReceivable ? 'receivable' : 'payable',
    receivableId: isReceivable ? target.receivableId : null,
    payableId: isReceivable ? null : target.payableId,
    type: 'baixa',
    reversesSettlementId: null,
    paidOn: '2026-08-01',
    amountBrl: 100000,
    ...overrides,
  };
}

function estorno(id: string, of: SaleSettlementRow): SaleSettlementRow {
  return {
    ...of,
    id,
    type: 'estorno',
    reversesSettlementId: of.id,
    paidOn: '2026-08-02',
  };
}

describe('activeSettlementTargetIds', () => {
  it('an active baixa locks its receivable', () => {
    const result = activeSettlementTargetIds([baixa('b1', { receivableId: 'r1' })]);
    expect([...result.receivableIds]).toEqual(['r1']);
    expect([...result.payableIds]).toEqual([]);
  });

  it('a reversed baixa does not lock', () => {
    const first = baixa('b1', { receivableId: 'r1' });
    const second = baixa('b2', { receivableId: 'r2' });
    const result = activeSettlementTargetIds([first, estorno('e1', first), second]);
    expect([...result.receivableIds]).toEqual(['r2']);
  });

  it('an active baixa on a payable locks only that payable', () => {
    const result = activeSettlementTargetIds([
      baixa('b1', { payableId: 'p1' }, { amountBrl: 10000 }),
    ]);
    expect([...result.payableIds]).toEqual(['p1']);
    expect([...result.receivableIds]).toEqual([]);
  });

  it('a malformed history throws instead of reading as unlocked', () => {
    const first = baixa('b1', { receivableId: 'r1' });
    expect(() =>
      activeSettlementTargetIds([first, { ...estorno('e1', first), amountBrl: 1 }]),
    ).toThrow(LiquidacaoErro);
  });
});
