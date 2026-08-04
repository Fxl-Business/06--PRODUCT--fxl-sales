// GOLDEN FIXTURE - must stay byte-identical to
// apps/web/src/sales-ops/__tests__/sale-margin-parity.test.ts.
//
// The two files cannot share a module: apps/api cannot import from apps/web, and a
// test-only fixture inside packages/shared-utils is not in that package's dist
// export map. They duplicate the literals on purpose and both assert against the
// same `computeSaleFinancials`, so a real behaviour divergence breaks one of them.
import { describe, expect, it } from 'vitest';

import {
  CreateSaleSchema,
  buildSaleLedger,
  type ResolvedItemContext,
  type ResolvedPartyContexts,
} from '../service.js';

const productId = '44444444-4444-4444-8444-444444444444';
const areaId = '77777777-7777-4777-8777-777777777777';
const sellerId = '22222222-2222-4222-8222-222222222222';
const finderId = '33333333-3333-4333-8333-333333333333';
const devFuncaoId = '55555555-5555-4555-8555-555555555555';
const testerFuncaoId = '66666666-6666-4666-8666-666666666666';

/** GOLDEN FIXTURE. Every literal below is duplicated in the web parity test. */
const goldenPayload = {
  clientId: '11111111-1111-4111-8111-111111111111',
  clientName: 'SegPro',
  sellerPersonId: sellerId,
  sellerName: 'Ana Martins',
  finderPersonId: finderId,
  finderName: 'Bruno Reis',
  status: 'open' as const,
  baseDate: '2026-07-14',
  sellerCommissionPct: 15,
  finderCommissionPct: 3.5,
  taxPct: 6,
  otherCostsBrl: 12345,
  items: [{ productId, productName: 'FXL Custom', quantity: 2, unitBrl: 1000000 }],
  professionals: [
    { personId: sellerId, personName: 'Ana Martins', funcaoId: devFuncaoId, costBrl: 100000 },
    { personId: finderId, personName: 'Bruno Reis', funcaoId: testerFuncaoId, costBrl: 30000 },
  ],
  installments: [
    { dueDate: '2026-07-14', amountBrl: 666667, method: 'pix' as const },
    { dueDate: '2026-08-14', amountBrl: 666667, method: 'pix' as const },
    { dueDate: '2026-09-14', amountBrl: 666666, method: 'pix' as const },
  ],
  recurring: {
    monthlyBrl: 250000,
    startDate: '2026-08-14',
    cycles: 4,
    method: 'pix' as const,
  },
};

const itemContexts: ResolvedItemContext[] = [
  { areaId, areaNameSnapshot: 'FXL Tech', productTypeSnapshot: 'product' },
];

const parties: ResolvedPartyContexts = {
  people: new Map([
    [sellerId, { id: sellerId, displayName: 'Ana Martins' }],
    [finderId, { id: finderId, displayName: 'Bruno Reis' }],
  ]),
  funcoes: new Map([
    [devFuncaoId, { id: devFuncaoId, name: 'Desenvolvedor' }],
    [testerFuncaoId, { id: testerFuncaoId, name: 'Testador' }],
  ]),
};

describe('sale margin parity - API ledger', () => {
  it('buildSaleLedger reports the golden fixture financials', () => {
    const ledger = buildSaleLedger(CreateSaleSchema.parse(goldenPayload), itemContexts, parties);

    // itemsTotal 2 x 1000000 = 2000000; bounded recorrência 250000 x 4 = 1000000.
    expect(ledger.sale.totalBrl).toBe(3000000);
    expect(ledger.sale.recurringBrl).toBe(250000);
    // Σ floor(amount * 15 / 100) over 666667, 666667, 666666, then 4 x 250000.
    // 100000 + 100000 + 99999 + 4 x 37500 = 449999.
    expect(ledger.sale.sellerCommissionBrl).toBe(449999);
    // Σ floor(amount * 3.5 / 100): 23333 + 23333 + 23333 + 4 x 8750 = 104999.
    expect(ledger.sale.finderCommissionBrl).toBe(104999);
    // Σ floor(amount * 6 / 100): 40000 + 40000 + 39999 + 4 x 15000 = 179999.
    expect(ledger.sale.taxBrl).toBe(179999);
    expect(ledger.sale.professionalCostsBrl).toBe(130000);
    expect(ledger.sale.otherCostsBrl).toBe(12345);
    // 3000000 - 449999 - 104999 - 130000 - 12345 - 179999.
    expect(ledger.sale.netMarginBrl).toBe(2122658);
    expect(ledger.sale.netMarginPct).toBe('70.76');
    expect(ledger.sale.sellerCommissionPct).toBe('15.00');
    expect(ledger.sale.finderCommissionPct).toBe('3.50');
    expect(ledger.sale.taxPct).toBe('6.00');
  });

  it('drops the finder commission when no finder is on the proposta, keeping every other number', () => {
    const withoutFinder = { ...goldenPayload, finderPersonId: undefined, finderName: null };
    const ledger = buildSaleLedger(CreateSaleSchema.parse(withoutFinder), itemContexts, parties);

    expect(ledger.sale.finderCommissionBrl).toBe(0);
    // Positive control: the seller commission and the tax are untouched, so the
    // zero above is the hasFinder flag and not a collapsed fixture.
    expect(ledger.sale.sellerCommissionBrl).toBe(449999);
    expect(ledger.sale.taxBrl).toBe(179999);
    expect(ledger.sale.netMarginBrl).toBe(2122658 + 104999);
  });

  it('keeps the N/M and MN/M receivable labels while delegating the money to computeSaleFinancials', () => {
    const ledger = buildSaleLedger(CreateSaleSchema.parse(goldenPayload), itemContexts, parties);

    expect(ledger.receivables.map((row) => row.label)).toEqual([
      '1/3',
      '2/3',
      '3/3',
      'M1/4',
      'M2/4',
      'M3/4',
      'M4/4',
    ]);
    expect(ledger.receivables.map((row) => row.amountBrl)).toEqual([
      666667, 666667, 666666, 250000, 250000, 250000, 250000,
    ]);
  });

  it('mirrors the resolved funcao name into funcaoNameSnapshot and the deprecated role column', () => {
    const ledger = buildSaleLedger(CreateSaleSchema.parse(goldenPayload), itemContexts, parties);

    expect(ledger.professionals).toEqual([
      {
        personId: sellerId,
        personNameSnapshot: 'Ana Martins',
        funcaoId: devFuncaoId,
        funcaoNameSnapshot: 'Desenvolvedor',
        role: 'Desenvolvedor',
        costBrl: 100000,
        costSplitBp: null,
      },
      {
        personId: finderId,
        personNameSnapshot: 'Bruno Reis',
        funcaoId: testerFuncaoId,
        funcaoNameSnapshot: 'Testador',
        role: 'Testador',
        costBrl: 30000,
        costSplitBp: null,
      },
    ]);
  });

  it('falls back to the body role and personName only on the legacy unregistered path', () => {
    const legacy = buildSaleLedger(
      CreateSaleSchema.parse({
        ...goldenPayload,
        professionals: [{ personName: 'Prestador avulso', role: 'Operacional', costBrl: 50000 }],
      }),
      itemContexts,
      parties,
    );

    expect(legacy.professionals).toEqual([
      {
        personId: undefined,
        personNameSnapshot: 'Prestador avulso',
        funcaoId: null,
        funcaoNameSnapshot: 'Operacional',
        role: 'Operacional',
        costBrl: 50000,
        costSplitBp: null,
      },
    ]);
  });

  it('ignores a personName and a role that disagree with the resolved cadastro rows', () => {
    const ledger = buildSaleLedger(
      CreateSaleSchema.parse({
        ...goldenPayload,
        professionals: [
          {
            personId: sellerId,
            personName: 'Nome forjado',
            funcaoId: devFuncaoId,
            role: 'Função forjada',
            costBrl: 100000,
          },
        ],
      }),
      itemContexts,
      parties,
    );

    expect(ledger.professionals[0]?.personNameSnapshot).toBe('Ana Martins');
    expect(ledger.professionals[0]?.funcaoNameSnapshot).toBe('Desenvolvedor');
    expect(ledger.professionals[0]?.role).toBe('Desenvolvedor');
  });
});
