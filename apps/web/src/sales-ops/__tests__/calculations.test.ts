import { describe, expect, it } from 'vitest';
import {
  buildDashboardModel,
  buildSalePayload,
  formatMoneyBrl,
  parseCurrencyInputToCents,
  resolveSaleCommissionDefaults,
  type SaleCommissionDefaultsProduct,
} from '../calculations';
import type { SalesOpsBootstrap } from '../types';

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
      people: [],
      payables: [],
      saleItems: [],
      settings: null,
    };

    const model = buildDashboardModel(bootstrap);

    expect(model.kpis.closedRevenueBrl).toBe(0);
    expect(model.revenueByProduct).toEqual([]);
    expect(model.topSellers).toEqual([]);
    expect(model.latestSales).toEqual([]);
  });

  it('normalizes wizard draft values into the API sale payload', () => {
    const payload = buildSalePayload({
      clientId: '11111111-1111-4111-8111-111111111111',
      clientName: 'Dias Pet',
      sellerPersonId: '22222222-2222-4222-8222-222222222222',
      sellerName: 'Ana Martins',
      finderPersonId: '',
      finderName: '',
      status: 'closed',
      paymentMethod: 'pix',
      condition: 'installments',
      installments: 3,
      baseDate: '2026-07-10',
      notes: '',
      sellerCommissionPct: '10',
      finderCommissionPct: '3',
      taxPct: '6',
      otherCostsBrl: '60000',
      items: [
        {
          productId: '33333333-3333-4333-8333-333333333333',
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
