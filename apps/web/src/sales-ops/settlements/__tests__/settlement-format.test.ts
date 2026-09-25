import { describe, expect, it } from 'vitest';
import type { SalesOpsSettlement } from '../../types';
import {
  activeBaixasFor,
  buildTargetDescriptions,
  describeLockedRows,
  describePayable,
  describeReceivable,
  formatCivilDay,
  formatRecordedAt,
} from '../settlement-format';

function entry(
  overrides: Partial<SalesOpsSettlement> & Pick<SalesOpsSettlement, 'id' | 'type' | 'paidOn'>,
): SalesOpsSettlement {
  return {
    saleId: 'sale-1',
    targetKind: 'receivable',
    receivableId: 'rec-1',
    payableId: null,
    reversesSettlementId: null,
    reversedBySettlementId: null,
    amountBrl: 100000,
    origin: 'manual',
    actorName: 'Ana',
    recordedAt: '2026-09-20T12:00:00.000Z',
    reason: null,
    ...overrides,
  };
}

describe('settlement-format', () => {
  it('formats a civil day by string with no timezone slip', () => {
    expect(formatCivilDay('2026-09-01')).toBe('01/09/2026');
    // A stored due_date (D T00:00:00Z) keeps its civil day.
    expect(formatCivilDay('2026-09-01T00:00:00.000Z')).toBe('01/09/2026');
  });

  it('formats the recorded instant as a São Paulo wall clock', () => {
    expect(formatRecordedAt('2026-09-24T01:10:00.000Z')).toBe('23/09/2026 às 22:10');
    expect(formatRecordedAt('2026-09-24T15:05:00.000Z')).toBe('24/09/2026 às 12:05');
  });

  it('describes installment, recurring and payable rows', () => {
    expect(describeReceivable({ label: '1/3', dueDate: '2026-09-01T00:00:00.000Z' })).toBe(
      'Parcela 1/3',
    );
    expect(describeReceivable({ label: 'M2/12', dueDate: '2026-09-01T00:00:00.000Z' })).toBe(
      'Recorrência 2/12',
    );
    expect(describeReceivable({ dueDate: '2026-09-01T00:00:00.000Z' })).toBe(
      'Parcela de 01/09/2026',
    );
    expect(describePayable({ kind: 'seller_commission', beneficiaryName: 'Ana Martins' })).toBe(
      'Comissão do vendedor · Ana Martins',
    );
    expect(describePayable({ kind: 'tax', beneficiaryName: 'Receita' })).toBe('Imposto');
    expect(describePayable({ kind: 'other_cost', beneficiaryName: 'X' })).toBe('Outros custos');
    expect(describePayable({ kind: 'mystery', beneficiaryName: 'Bia' })).toBe(
      'Conta a pagar · Bia',
    );

    // With row context, WHICH of a beneficiary's payables: the linked parcela,
    // else the due day. Never an id.
    const receivables = new Map([
      ['rec-2', { label: '2/3', dueDate: '2026-10-01T00:00:00.000Z' }],
      ['rec-m', { label: 'M3/12', dueDate: '2026-11-01T00:00:00.000Z' }],
    ]);
    expect(
      describePayable(
        { kind: 'seller_commission', beneficiaryName: 'Ana', receivableId: 'rec-2' },
        receivables,
      ),
    ).toBe('Comissão do vendedor · Ana · Parcela 2/3');
    expect(
      describePayable({ kind: 'tax', beneficiaryName: 'Receita', receivableId: 'rec-m' }, receivables),
    ).toBe('Imposto · Recorrência 3/12');
    expect(
      describePayable(
        {
          kind: 'other_cost',
          beneficiaryName: 'X',
          receivableId: null,
          dueDate: '2026-09-01T00:00:00.000Z',
        },
        receivables,
      ),
    ).toBe('Outros custos · vencimento 01/09/2026');
  });

  it('finds the active baixas of one row, newest first, skipping reversed ones', () => {
    const b1 = entry({ id: 'b1', type: 'baixa', paidOn: '2026-09-10' });
    const b2 = entry({ id: 'b2', type: 'baixa', paidOn: '2026-09-12', reversedBySettlementId: 'e1' });
    const e1 = entry({ id: 'e1', type: 'estorno', paidOn: '2026-09-13', reversesSettlementId: 'b2' });
    const b3 = entry({ id: 'b3', type: 'baixa', paidOn: '2026-09-15', receivableId: 'rec-2' });
    const p1 = entry({
      id: 'p1',
      type: 'baixa',
      paidOn: '2026-09-16',
      targetKind: 'payable',
      receivableId: null,
      payableId: 'rec-1',
    });

    expect(activeBaixasFor([e1, b3, b2, b1, p1], { kind: 'receivable', id: 'rec-1' })).toEqual([b1]);
    expect(activeBaixasFor([e1, b3, b2, b1, p1], { kind: 'payable', id: 'rec-1' })).toEqual([p1]);

    const older = entry({ id: 'b4', type: 'baixa', paidOn: '2026-09-01' });
    const sameDayLater = entry({
      id: 'b5',
      type: 'baixa',
      paidOn: '2026-09-10',
      recordedAt: '2026-09-21T12:00:00.000Z',
    });
    expect(
      activeBaixasFor([older, b1, sameDayLater], { kind: 'receivable', id: 'rec-1' }).map(
        (row) => row.id,
      ),
    ).toEqual(['b5', 'b1', 'b4']);
  });

  it('names locked rows from the bootstrap before the server label, never by id', () => {
    const descriptions = buildTargetDescriptions(
      [
        {
          id: 'rec-1',
          saleId: 'sale-1',
          label: '1/3',
          dueDate: '2026-09-01T00:00:00.000Z',
          amountBrl: 1,
          method: 'pix',
          status: 'paid',
        },
      ],
      [
        {
          id: 'pay-1',
          saleId: 'sale-1',
          beneficiaryName: 'Ana Martins',
          kind: 'seller_commission',
          receivableId: 'rec-1',
          dueDate: '2026-09-01T00:00:00.000Z',
          amountBrl: 1,
          status: 'paid',
        },
        {
          saleId: 'sale-1',
          beneficiaryName: 'Sem id',
          kind: 'tax',
          dueDate: '2026-09-01T00:00:00.000Z',
          amountBrl: 1,
          status: 'open',
        },
      ],
    );

    const lines = describeLockedRows(
      [
        { kind: 'receivable', id: 'rec-1', label: '1/3' },
        { kind: 'payable', id: 'pay-1', label: 'Ana Martins (1/3)' },
        { kind: 'receivable', id: 'rec-9', label: '3/3' },
        { kind: 'payable', id: 'pay-9', label: 'Bruno (2/3)' },
        { kind: 'payable', id: 'pay-8', label: '' },
      ],
      descriptions,
    );

    expect(lines).toEqual([
      'Parcela 1/3',
      'Comissão do vendedor · Ana Martins · Parcela 1/3',
      'Parcela 3/3',
      'Bruno (2/3)',
      'Linha sem rótulo',
    ]);
    expect(lines.join(' ')).not.toMatch(/rec-|pay-/);
  });
});
