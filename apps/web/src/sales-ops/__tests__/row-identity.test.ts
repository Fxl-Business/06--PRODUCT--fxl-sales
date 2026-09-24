import { describe, expect, it } from 'vitest';
import { buildSalePayload, generateInstallmentPlan } from '../calculations';
import { carryRowIdsPositionally, payloadReceivableIds, payloadRowId } from '../row-identity';
import type { SaleDraft } from '../types';

describe('carryRowIdsPositionally', () => {
  it('carries previous ids positionally onto a regenerated plan', () => {
    const previous = [
      { id: 'rec-1', amountBrl: '1600' },
      { id: 'rec-2', amountBrl: '1400' },
    ];
    const next = [
      { dueDate: '2026-07-10', amountBrl: '1500' },
      { dueDate: '2026-08-10', amountBrl: '1500' },
    ];

    expect(carryRowIdsPositionally(previous, next)).toEqual([
      { id: 'rec-1', dueDate: '2026-07-10', amountBrl: '1500' },
      { id: 'rec-2', dueDate: '2026-08-10', amountBrl: '1500' },
    ]);
  });

  it('gives rows beyond the previous length no id and drops surplus previous ids', () => {
    const grown = carryRowIdsPositionally([{ id: 'rec-1' }], [{ n: 1 }, { n: 2 }, { n: 3 }]);
    expect(grown.map((row) => row.id)).toEqual(['rec-1', null, null]);

    const shrunk = carryRowIdsPositionally(
      [{ id: 'rec-1' }, { id: 'rec-2' }, { id: 'rec-3' }],
      [{ n: 1 }, { n: 2 }],
    );
    expect(shrunk.map((row) => row.id)).toEqual(['rec-1', 'rec-2']);
    expect(JSON.stringify(shrunk)).not.toContain('rec-3');
  });

  it('keeps the id of a zero-amount generated row', () => {
    const generated = generateInstallmentPlan(
      0,
      { entradaMode: 'none', entradaValue: 0, restanteCount: 1, anchorDate: '2026-07-10' },
      ['pix'],
    );
    expect(generated).toHaveLength(1);
    expect(generated[0]!.amountBrl).toBe(0);

    expect(carryRowIdsPositionally([{ id: 'rec-1' }], generated)).toEqual([
      { ...generated[0], id: 'rec-1' },
    ]);
  });

  it('payloadRowId turns null, undefined and blank into undefined', () => {
    expect(payloadRowId(null)).toBeUndefined();
    expect(payloadRowId(undefined)).toBeUndefined();
    expect(payloadRowId('   ')).toBeUndefined();
    expect(payloadRowId(' rec-1 ')).toBe('rec-1');
  });

  it('payloadReceivableIds omits an empty list and keeps order', () => {
    expect(payloadReceivableIds([], 3)).toBeUndefined();
    expect(payloadReceivableIds(undefined, 3)).toBeUndefined();
    expect(payloadReceivableIds([' ', ''], 3)).toBeUndefined();
    expect(payloadReceivableIds(['m-2', 'm-1'], 3)).toEqual(['m-2', 'm-1']);
  });

  it('payloadReceivableIds sends at most cycles ids and none for an indefinite recorrência', () => {
    expect(payloadReceivableIds(['a', 'b', 'c'], 2)).toEqual(['a', 'b']);
    expect(payloadReceivableIds(['a'], null)).toBeUndefined();
    expect(payloadReceivableIds(['a'], 0)).toBeUndefined();
  });
});

function draft(overrides: Partial<SaleDraft> = {}): SaleDraft {
  return {
    clientName: 'Cliente',
    sellerName: 'Vendedor',
    status: 'open',
    baseDate: '2026-07-10',
    sellerCommissionPct: 10,
    finderCommissionPct: 3,
    taxPct: 6,
    otherCostsBrl: 0,
    installments: [
      { id: 'rec-1', dueDate: '2026-07-10', amountBrl: 100000, method: 'pix' },
      { id: 'rec-2', dueDate: '2026-08-10', amountBrl: 100000, method: 'pix' },
    ],
    recurring: null,
    items: [
      {
        id: 'item-1',
        productId: 'product-1',
        productName: 'Produto',
        productType: 'SaaS',
        quantity: 1,
        unitBrl: 200000,
      },
    ],
    professionals: [
      { id: 'prof-1', personId: 'person-1', personName: 'Ana', funcaoId: 'funcao-1', costBrl: 5000 },
    ],
    ...overrides,
  };
}

describe('buildSalePayload row ids', () => {
  it('sends the id of every item, professional and installment it was given', () => {
    const payload = buildSalePayload(draft());

    expect(payload.installments.map((row) => row.id)).toEqual(['rec-1', 'rec-2']);
    expect(payload.items.map((row) => row.id)).toEqual(['item-1']);
    expect(payload.professionals.map((row) => row.id)).toEqual(['prof-1']);
  });

  it('sends a zeroed installment with its id and amount 0', () => {
    const payload = buildSalePayload(
      draft({
        installments: [
          { id: 'rec-1', dueDate: '2026-07-10', amountBrl: 200000, method: 'pix' },
          { id: 'rec-2', dueDate: '2026-08-10', amountBrl: 0, method: 'pix' },
        ],
      }),
    );

    expect(payload.installments).toEqual([
      { id: 'rec-1', dueDate: '2026-07-10', amountBrl: 200000, method: 'pix' },
      { id: 'rec-2', dueDate: '2026-08-10', amountBrl: 0, method: 'pix' },
    ]);
  });

  it('omits id for new rows', () => {
    const payload = JSON.parse(
      JSON.stringify(
        buildSalePayload(
          draft({
            installments: [
              { id: null, dueDate: '2026-07-10', amountBrl: 100000, method: 'pix' },
              { dueDate: '2026-08-10', amountBrl: 100000, method: 'pix' },
            ],
            items: [
              { id: null, productName: 'Avulso', productType: 'SaaS', areaId: 'area-1', quantity: 1, unitBrl: 200000 },
            ],
            professionals: [{ id: null, personId: 'person-1', personName: 'Ana', funcaoId: 'funcao-1', costBrl: 0 }],
          }),
        ),
      ),
    ) as Record<string, Array<Record<string, unknown>>>;

    for (const key of ['installments', 'items', 'professionals']) {
      for (const row of payload[key]!) expect('id' in row).toBe(false);
    }
  });

  it('sends recurring receivableIds only when there are any', () => {
    const withIds = buildSalePayload(
      draft({
        recurring: { monthlyBrl: 100000, startDate: '2026-08-10', cycles: 2, method: 'boleto', receivableIds: ['m-1', 'm-2'] },
      }),
    );
    expect(withIds.recurring).toEqual({
      monthlyBrl: 100000,
      startDate: '2026-08-10',
      cycles: 2,
      method: 'boleto',
      receivableIds: ['m-1', 'm-2'],
    });

    const withoutIds = JSON.parse(
      JSON.stringify(
        buildSalePayload(
          draft({ recurring: { monthlyBrl: 100000, startDate: '2026-08-10', cycles: 2, method: 'boleto', receivableIds: [] } }),
        ),
      ),
    ) as { recurring: Record<string, unknown> };
    expect('receivableIds' in withoutIds.recurring).toBe(false);
  });
});
