import { describe, expect, it } from 'vitest';
import {
  buildDashboardModel,
  buildSalePayload,
  formatMoneyBrl,
  parseCurrencyInputToCents,
} from '../calculations';
import type { SalesOpsBootstrap } from '../types';

describe('sales operations web calculations', () => {
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
});
