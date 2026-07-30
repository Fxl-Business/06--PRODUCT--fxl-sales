import { describe, expect, it } from 'vitest';
import {
  buildDashboardModel,
  buildSalePayload,
  formatMoneyBrl,
  installmentSumCents,
  parseCurrencyInputToCents,
  resolveSaleCommissionDefaults,
  splitInstallmentsEqually,
  type SaleCommissionDefaultsProduct,
} from '../calculations';
import type { SalesOpsBootstrap, SalesOpsSale } from '../types';

function saleFixture(overrides: Partial<SalesOpsSale> = {}): SalesOpsSale {
  return {
    id: 'sale-1',
    orgId: 'org-test',
    sequence: 1,
    code: 'P-0001',
    clientId: null,
    clientNameSnapshot: 'Cliente',
    sellerPersonId: null,
    sellerNameSnapshot: 'Vendedor',
    finderPersonId: null,
    finderNameSnapshot: null,
    status: 'open',
    paymentMethod: 'pix',
    condition: 'installments',
    installments: 1,
    baseDate: '2026-07-10',
    notes: null,
    wonAt: null,
    lostAt: null,
    totalBrl: 0,
    recurringBrl: 0,
    sellerCommissionPct: '10',
    finderCommissionPct: '3',
    taxPct: '6',
    otherCostsBrl: 0,
    professionalCostsBrl: 0,
    sellerCommissionBrl: 0,
    finderCommissionBrl: 0,
    taxBrl: 0,
    netMarginBrl: 0,
    netMarginPct: '0',
    createdAt: '2026-07-10T12:00:00.000Z',
    updatedAt: null,
    ...overrides,
  };
}

describe('sales operations web calculations', () => {
  const commissionProduct: SaleCommissionDefaultsProduct = {
    sellerCommissionType: 'pct',
    sellerCommissionValue: '10',
    sellerWithFinderCommissionType: 'pct',
    sellerWithFinderCommissionValue: '7',
    finderCommissionType: 'pct',
    finderCommissionValue: '3',
  };
  const organizationDefaults = {
    defaultSellerCommissionPct: '9',
    defaultFinderCommissionPct: '2',
  };

  it('formats integer cents as BRL without leaking floating point math', () => {
    expect(formatMoneyBrl(4250000, { maximumFractionDigits: 0 })).toBe('R$ 42.500');
    expect(formatMoneyBrl(382000)).toBe('R$ 3.820,00');
  });

  it('parses Brazilian and decimal currency inputs into cents', () => {
    expect(parseCurrencyInputToCents('8000')).toBe(800000);
    expect(parseCurrencyInputToCents('8000.00')).toBe(800000);
    expect(parseCurrencyInputToCents('8.000,00')).toBe(800000);
    expect(parseCurrencyInputToCents('1.200')).toBe(120000);
    expect(parseCurrencyInputToCents('1200,50')).toBe(120050);
  });

  it('builds an empty dashboard model from empty API data without prototype seed rows', () => {
    const bootstrap: SalesOpsBootstrap = {
      sales: [],
      products: [],
      clients: [],
      areas: [],
      funcoes: [],
      people: [],
      payables: [],
      saleItems: [],
      receivables: [],
      saleProfessionals: [],
      settings: null,
    };

    const model = buildDashboardModel(bootstrap);

    expect(model.kpis.wonRevenueBrl).toBe(0);
    expect(model.revenueByProduct).toEqual([]);
    expect(model.topSellers).toEqual([]);
    expect(model.latestSales).toEqual([]);
  });

  it('aggregates dashboard KPIs from won propostas only', () => {
    const bootstrap: SalesOpsBootstrap = {
      sales: [
        saleFixture({ id: 'won-1', status: 'won', totalBrl: 100000, sellerNameSnapshot: 'Ana' }),
        saleFixture({ id: 'open-1', status: 'open', totalBrl: 50000 }),
        saleFixture({ id: 'draft-1', status: 'draft', totalBrl: 20000 }),
        saleFixture({ id: 'lost-1', status: 'lost', totalBrl: 30000 }),
        saleFixture({
          id: 'cancelled-1',
          status: 'cancelled',
          totalBrl: 40000,
          recurringBrl: 10000,
        }),
      ],
      products: [],
      clients: [],
      areas: [],
      funcoes: [],
      people: [],
      payables: [],
      saleItems: [],
      receivables: [],
      saleProfessionals: [],
      settings: null,
    };

    const model = buildDashboardModel(bootstrap);

    expect(model.kpis.wonRevenueBrl).toBe(100000);
    expect(model.kpis.wonSalesCount).toBe(1);
    expect(model.topSellers).toEqual([{ name: 'Ana', totalBrl: 100000, commissionBrl: 0, count: 1 }]);
    expect(model.kpis.activeMrrBrl).toBe(0);
    expect(model.latestSales.map((sale) => sale.id)).toEqual(
      expect.arrayContaining(['won-1', 'open-1', 'draft-1', 'lost-1']),
    );
    expect(model.latestSales.map((sale) => sale.id)).not.toContain('cancelled-1');
  });

  it('normalizes wizard draft values into the API sale payload', () => {
    const payload = buildSalePayload({
      clientId: '11111111-1111-4111-8111-111111111111',
      clientName: 'Dias Pet',
      sellerPersonId: '22222222-2222-4222-8222-222222222222',
      sellerName: 'Ana Martins',
      finderPersonId: '',
      finderName: '',
      status: 'open',
      baseDate: '2026-07-10',
      notes: '',
      sellerCommissionPct: '10',
      finderCommissionPct: '3',
      taxPct: '6',
      otherCostsBrl: '60000',
      installments: [
        { dueDate: '2026-07-10', amountBrl: 400000, method: 'pix' },
        { dueDate: '2026-08-10', amountBrl: '400000', method: 'boleto' },
      ],
      recurring: { monthlyBrl: '100000', startDate: '2026-08-10', cycles: null },
      items: [
        {
          productId: '33333333-3333-4333-8333-333333333333',
          areaId: '66666666-6666-4666-8666-666666666666',
          productName: 'FXL Finance',
          productType: 'SaaS',
          quantity: '1',
          unitBrl: '800000',
        },
      ],
      professionals: [],
    });

    expect(payload.finderPersonId).toBeUndefined();
    expect(payload.notes).toBeNull();
    expect(payload.otherCostsBrl).toBe(60000);
    expect(payload.items[0]?.quantity).toBe(1);
    expect(payload.items[0]?.areaId).toBe('66666666-6666-4666-8666-666666666666');
    expect(payload.installments).toEqual([
      { dueDate: '2026-07-10', amountBrl: 400000, method: 'pix' },
      { dueDate: '2026-08-10', amountBrl: 400000, method: 'boleto' },
    ]);
    expect(payload.recurring).toEqual({
      monthlyBrl: 100000,
      startDate: '2026-08-10',
      cycles: null,
      method: 'pix',
    });
  });

  it('splits a total into equal monthly installments with the remainder on the last row', () => {
    expect(splitInstallmentsEqually(250000, 3, '2026-07-10', 'boleto')).toEqual([
      { dueDate: '2026-07-10', amountBrl: 83333, method: 'boleto' },
      { dueDate: '2026-08-10', amountBrl: 83333, method: 'boleto' },
      { dueDate: '2026-09-10', amountBrl: 83334, method: 'boleto' },
    ]);
    expect(splitInstallmentsEqually(100, 1, '2026-07-10', 'pix')).toEqual([
      { dueDate: '2026-07-10', amountBrl: 100, method: 'pix' },
    ]);
    expect(splitInstallmentsEqually(100, 0, '2026-07-10', 'pix')).toEqual([
      { dueDate: '2026-07-10', amountBrl: 100, method: 'pix' },
    ]);
  });

  it('rolls month-end split dates forward like native Date arithmetic', () => {
    expect(splitInstallmentsEqually(300, 2, '2026-01-31', 'pix')[1]!.dueDate).toBe('2026-03-03');
  });

  it('sums installment rows from mixed string and numeric inputs', () => {
    expect(
      installmentSumCents([{ amountBrl: '8.000,00' }, { amountBrl: 250000 }, { amountBrl: '833.34' }]),
    ).toBe(800000 + 250000 + 83334);
  });

  it('normalizes a free-form item without productId', () => {
    const payload = buildSalePayload({
      clientId: undefined,
      clientName: 'Cliente',
      sellerPersonId: undefined,
      sellerName: 'Vendedor',
      status: 'draft',
      baseDate: '2026-07-10',
      sellerCommissionPct: '10',
      finderCommissionPct: '3',
      taxPct: '6',
      otherCostsBrl: 0,
      installments: [{ dueDate: '2026-07-10', amountBrl: 500000, method: 'pix' }],
      recurring: null,
      items: [
        {
          productName: 'Consultoria',
          productType: 'Avulso',
          areaId: 'x',
          quantity: '1',
          unitBrl: 500000,
        },
      ],
      professionals: [],
    });

    expect(payload.items[0]?.productId).toBeUndefined();
    expect(payload.items[0]?.areaId).toBe('x');
  });

  it('passes the recurring method through and defaults to pix when absent', () => {
    const base = {
      clientId: undefined,
      clientName: 'Cliente',
      sellerPersonId: undefined,
      sellerName: 'Vendedor',
      status: 'draft' as const,
      baseDate: '2026-07-10',
      sellerCommissionPct: '10',
      finderCommissionPct: '3',
      taxPct: '6',
      otherCostsBrl: 0,
      installments: [{ dueDate: '2026-07-10', amountBrl: 500000, method: 'pix' as const }],
      items: [
        {
          productName: 'Consultoria',
          productType: 'Avulso',
          areaId: 'x',
          quantity: '1',
          unitBrl: 500000,
        },
      ],
      professionals: [],
    };
    expect(
      buildSalePayload({
        ...base,
        recurring: { monthlyBrl: 100000, startDate: '2026-08-10', cycles: null, method: 'boleto' },
      }).recurring,
    ).toEqual({ monthlyBrl: 100000, startDate: '2026-08-10', cycles: null, method: 'boleto' });
    expect(
      buildSalePayload({
        ...base,
        recurring: { monthlyBrl: 100000, startDate: '2026-08-10', cycles: null },
      }).recurring,
    ).toEqual({ monthlyBrl: 100000, startDate: '2026-08-10', cycles: null, method: 'pix' });
  });

  it('resolves seller-only product percentage without applying the product finder rate', () => {
    expect(resolveSaleCommissionDefaults(commissionProduct, false, organizationDefaults)).toEqual({
      sellerCommissionPct: 10,
      finderCommissionPct: 2,
    });
  });

  it('resolves seller-with-finder and finder percentages when a finder participates', () => {
    expect(resolveSaleCommissionDefaults(commissionProduct, true, organizationDefaults)).toEqual({
      sellerCommissionPct: 7,
      finderCommissionPct: 3,
    });
  });

  it('falls back per side for missing products and fixed product commissions', () => {
    expect(resolveSaleCommissionDefaults(undefined, true, organizationDefaults)).toEqual({
      sellerCommissionPct: 9,
      finderCommissionPct: 2,
    });
    expect(
      resolveSaleCommissionDefaults(
        {
          ...commissionProduct,
          sellerCommissionType: 'fix',
          sellerWithFinderCommissionType: 'fix',
          finderCommissionType: 'fix',
        },
        true,
        organizationDefaults,
      ),
    ).toEqual({ sellerCommissionPct: 9, finderCommissionPct: 2 });
    expect(
      resolveSaleCommissionDefaults(
        { ...commissionProduct, sellerWithFinderCommissionType: 'fix' },
        true,
        organizationDefaults,
      ),
    ).toEqual({ sellerCommissionPct: 9, finderCommissionPct: 3 });
    expect(
      resolveSaleCommissionDefaults({ ...commissionProduct, sellerCommissionValue: '0' }, false, null),
    ).toEqual({ sellerCommissionPct: 0, finderCommissionPct: 3 });
  });
});
