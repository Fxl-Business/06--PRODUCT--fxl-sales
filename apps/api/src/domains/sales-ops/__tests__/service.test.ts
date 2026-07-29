import { describe, expect, it } from 'vitest';
import {
  CreateSaleSchema,
  buildSaleLedger,
  materializeWonPayables,
  summarizeSalesOpsState,
  type ResolvedItemContext,
} from '../service.js';

const sharedProductId = '44444444-4444-4444-8444-444444444444';
const sharedAreaId = '77777777-7777-4777-8777-777777777777';

const singleContext: ResolvedItemContext[] = [
  { areaId: sharedAreaId, areaNameSnapshot: 'FXL Tech', productTypeSnapshot: 'SaaS' },
];

const basePayload = {
  clientId: '11111111-1111-4111-8111-111111111111',
  clientName: 'SegPro',
  sellerPersonId: '22222222-2222-4222-8222-222222222222',
  sellerName: 'Ana Martins',
  status: 'open' as const,
  baseDate: '2026-07-14',
  sellerCommissionPct: 10,
  finderCommissionPct: 3,
  taxPct: 6,
  otherCostsBrl: 0,
  items: [
    {
      productId: sharedProductId,
      productName: 'Módulo Vendas',
      quantity: 1,
      unitBrl: 400000,
    },
  ],
  professionals: [],
  installments: [{ dueDate: '2026-07-14', amountBrl: 400000, method: 'pix' as const }],
};

describe('sales operations sale ledger', () => {
  it('preserves ordered custom labels as snapshots while retaining the shared product id', () => {
    const parsed = CreateSaleSchema.parse({
      ...basePayload,
      items: [
        {
          productId: sharedProductId,
          productName: '  Módulo Vendas  ',
          quantity: 1,
          unitBrl: 400000,
        },
        {
          productId: sharedProductId,
          productName: 'Módulo RH',
          quantity: 1,
          unitBrl: 900000,
        },
      ],
      installments: [{ dueDate: '2026-07-14', amountBrl: 1300000, method: 'pix' as const }],
    });

    const itemContexts: ResolvedItemContext[] = [
      { areaId: sharedAreaId, areaNameSnapshot: 'FXL Tech', productTypeSnapshot: 'Custom' },
      { areaId: sharedAreaId, areaNameSnapshot: 'FXL Tech', productTypeSnapshot: 'Custom' },
    ];

    const ledger = buildSaleLedger(parsed, itemContexts);

    expect(ledger.items).toEqual([
      {
        productId: sharedProductId,
        productNameSnapshot: 'Módulo Vendas',
        productTypeSnapshot: 'Custom',
        areaId: sharedAreaId,
        areaNameSnapshot: 'FXL Tech',
        quantity: 1,
        unitBrl: 400000,
        subtotalBrl: 400000,
      },
      {
        productId: sharedProductId,
        productNameSnapshot: 'Módulo RH',
        productTypeSnapshot: 'Custom',
        areaId: sharedAreaId,
        areaNameSnapshot: 'FXL Tech',
        quantity: 1,
        unitBrl: 900000,
        subtotalBrl: 900000,
      },
    ]);
  });

  it('rejects blank and overlong sale item names at the API boundary', () => {
    expect(
      CreateSaleSchema.safeParse({
        ...basePayload,
        items: [{ ...basePayload.items[0], productName: '   ' }],
      }).success,
    ).toBe(false);
    expect(
      CreateSaleSchema.safeParse({
        ...basePayload,
        items: [{ ...basePayload.items[0], productName: 'x'.repeat(141) }],
      }).success,
    ).toBe(false);
  });

  it('builds the 20k PIX plus 3x boleto plan with per-row floored commissions', () => {
    const parsed = CreateSaleSchema.parse({
      ...basePayload,
      finderPersonId: '33333333-3333-4333-8333-333333333333',
      finderName: 'Carlinhos',
      items: [
        {
          productId: sharedProductId,
          productName: 'Consultoria FXL',
          quantity: 1,
          unitBrl: 2999999,
        },
      ],
      installments: [
        { dueDate: '2026-07-29', amountBrl: 2000000, method: 'pix' as const },
        { dueDate: '2026-08-29', amountBrl: 333333, method: 'boleto' as const },
        { dueDate: '2026-09-29', amountBrl: 333333, method: 'boleto' as const },
        { dueDate: '2026-10-29', amountBrl: 333333, method: 'boleto' as const },
      ],
    });

    const ledger = buildSaleLedger(parsed, singleContext);

    expect(ledger.receivables).toEqual([
      { label: '1/4', dueDate: '2026-07-29', amountBrl: 2000000, method: 'pix', status: 'open' },
      { label: '2/4', dueDate: '2026-08-29', amountBrl: 333333, method: 'boleto', status: 'open' },
      { label: '3/4', dueDate: '2026-09-29', amountBrl: 333333, method: 'boleto', status: 'open' },
      { label: '4/4', dueDate: '2026-10-29', amountBrl: 333333, method: 'boleto', status: 'open' },
    ]);
    expect(ledger.sale.totalBrl).toBe(2999999);
    expect(ledger.sale.sellerCommissionBrl).toBe(299999);
    expect(ledger.sale.finderCommissionBrl).toBe(89997);
    expect(ledger.sale.taxBrl).toBe(179997);
    expect(ledger.sale.netMarginBrl).toBe(2430006);
    expect(ledger.sale.netMarginPct).toBe('81.00');
    expect(ledger.sale.paymentMethod).toBe('pix');
    expect(ledger.sale.condition).toBe('installments');
    expect(ledger.sale.installments).toBe(4);
  });

  it('rejects a payment plan that does not sum to the items total', () => {
    const result = CreateSaleSchema.safeParse({
      ...basePayload,
      installments: [{ dueDate: '2026-07-14', amountBrl: 399999, method: 'pix' as const }],
    });
    expect(result.success).toBe(false);
  });

  it('requires areaId on free-form items', () => {
    const withoutArea = CreateSaleSchema.safeParse({
      ...basePayload,
      items: [{ productName: 'Serviço avulso', quantity: 1, unitBrl: 400000 }],
    });
    expect(withoutArea.success).toBe(false);

    const withArea = CreateSaleSchema.safeParse({
      ...basePayload,
      items: [
        { productName: 'Serviço avulso', areaId: sharedAreaId, quantity: 1, unitBrl: 400000 },
      ],
    });
    expect(withArea.success).toBe(true);
  });

  it('materializes bounded recurring cycles as monthly receivable rows', () => {
    const parsed = CreateSaleSchema.parse({
      ...basePayload,
      items: [
        {
          productId: sharedProductId,
          productName: 'Consultoria FXL Advisor',
          quantity: 1,
          unitBrl: 500000,
        },
      ],
      installments: [{ dueDate: '2026-08-01', amountBrl: 500000, method: 'pix' as const }],
      recurring: {
        monthlyBrl: 1000000,
        startDate: '2026-09-01',
        cycles: 3,
        method: 'boleto' as const,
      },
    });

    const ledger = buildSaleLedger(parsed, singleContext);

    expect(ledger.receivables).toEqual([
      { label: '1/1', dueDate: '2026-08-01', amountBrl: 500000, method: 'pix', status: 'open' },
      {
        label: 'M1/3',
        dueDate: '2026-09-01',
        amountBrl: 1000000,
        method: 'boleto',
        status: 'open',
      },
      {
        label: 'M2/3',
        dueDate: '2026-10-01',
        amountBrl: 1000000,
        method: 'boleto',
        status: 'open',
      },
      {
        label: 'M3/3',
        dueDate: '2026-11-01',
        amountBrl: 1000000,
        method: 'boleto',
        status: 'open',
      },
    ]);
    expect(ledger.sale.totalBrl).toBe(3500000);
    expect(ledger.sale.recurringBrl).toBe(1000000);
    expect(ledger.sale.condition).toBe('recurring');
  });

  it('keeps indefinite recurring off the receivable rows', () => {
    const parsed = CreateSaleSchema.parse({
      ...basePayload,
      items: [
        {
          productId: sharedProductId,
          productName: 'Consultoria FXL Advisor',
          quantity: 1,
          unitBrl: 500000,
        },
      ],
      installments: [{ dueDate: '2026-08-01', amountBrl: 500000, method: 'pix' as const }],
      recurring: {
        monthlyBrl: 1000000,
        startDate: '2026-09-01',
        cycles: null,
        method: 'boleto' as const,
      },
    });

    const ledger = buildSaleLedger(parsed, singleContext);

    expect(ledger.receivables).toEqual([
      { label: '1/1', dueDate: '2026-08-01', amountBrl: 500000, method: 'pix', status: 'open' },
    ]);
    expect(ledger.sale.totalBrl).toBe(500000);
    expect(ledger.sale.recurringBrl).toBe(1000000);
  });

  it('drops zero-amount installments so a zero-setup recurring proposta has no setup rows', () => {
    const parsed = CreateSaleSchema.parse({
      ...basePayload,
      items: [
        {
          productId: sharedProductId,
          productName: 'FXL Advisor mensal',
          quantity: 1,
          unitBrl: 0,
        },
      ],
      installments: [{ dueDate: '2026-08-01', amountBrl: 0, method: 'pix' as const }],
      recurring: {
        monthlyBrl: 1000000,
        startDate: '2026-09-01',
        cycles: null,
        method: 'pix' as const,
      },
    });

    const ledger = buildSaleLedger(parsed, singleContext);

    expect(ledger.receivables).toEqual([]);
    expect(ledger.sale.installments).toBe(1);
  });

  it('materializeWonPayables links per-row payables and skips voided rows', () => {
    const drafts = materializeWonPayables({
      sale: {
        sellerName: 'Ana Martins',
        finderName: 'Carlinhos',
        hasFinder: true,
        sellerCommissionPct: 10,
        finderCommissionPct: 3,
        taxPct: 6,
        otherCostsBrl: 60000,
      },
      professionals: [{ personName: 'Rafael Nunes', costBrl: 240000 }],
      receivables: [
        { id: 'r1', dueDate: '2026-07-29', amountBrl: 2000000, status: 'open' },
        { id: 'r2', dueDate: '2026-08-29', amountBrl: 333333, status: 'void' },
        { id: 'r3', dueDate: '2026-09-29', amountBrl: 333333, status: 'open' },
        { id: 'r4', dueDate: '2026-10-29', amountBrl: 333333, status: 'open' },
      ],
      wonDate: '2026-07-29',
    });

    expect(drafts).toEqual([
      {
        beneficiaryName: 'Ana Martins',
        kind: 'seller_commission',
        dueDate: '2026-07-29',
        amountBrl: 200000,
        status: 'open',
        receivableId: 'r1',
      },
      {
        beneficiaryName: 'Carlinhos',
        kind: 'finder_commission',
        dueDate: '2026-07-29',
        amountBrl: 60000,
        status: 'open',
        receivableId: 'r1',
      },
      {
        beneficiaryName: 'Impostos',
        kind: 'tax',
        dueDate: '2026-07-29',
        amountBrl: 120000,
        status: 'open',
        receivableId: 'r1',
      },
      {
        beneficiaryName: 'Ana Martins',
        kind: 'seller_commission',
        dueDate: '2026-09-29',
        amountBrl: 33333,
        status: 'open',
        receivableId: 'r3',
      },
      {
        beneficiaryName: 'Carlinhos',
        kind: 'finder_commission',
        dueDate: '2026-09-29',
        amountBrl: 9999,
        status: 'open',
        receivableId: 'r3',
      },
      {
        beneficiaryName: 'Impostos',
        kind: 'tax',
        dueDate: '2026-09-29',
        amountBrl: 19999,
        status: 'open',
        receivableId: 'r3',
      },
      {
        beneficiaryName: 'Ana Martins',
        kind: 'seller_commission',
        dueDate: '2026-10-29',
        amountBrl: 33333,
        status: 'open',
        receivableId: 'r4',
      },
      {
        beneficiaryName: 'Carlinhos',
        kind: 'finder_commission',
        dueDate: '2026-10-29',
        amountBrl: 9999,
        status: 'open',
        receivableId: 'r4',
      },
      {
        beneficiaryName: 'Impostos',
        kind: 'tax',
        dueDate: '2026-10-29',
        amountBrl: 19999,
        status: 'open',
        receivableId: 'r4',
      },
      {
        beneficiaryName: 'Rafael Nunes',
        kind: 'professional_cost',
        dueDate: '2026-07-29',
        amountBrl: 240000,
        status: 'open',
        receivableId: null,
      },
      {
        beneficiaryName: 'Outros custos',
        kind: 'other_cost',
        dueDate: '2026-07-29',
        amountBrl: 60000,
        status: 'open',
        receivableId: null,
      },
    ]);
  });

  it('summarizes empty persisted state without prototype seed rows', () => {
    const summary = summarizeSalesOpsState({
      sales: [],
      products: [],
      clients: [],
      people: [],
      payables: [],
    });

    expect(summary.kpis.closedRevenueBrl).toBe(0);
    expect(summary.kpis.activeMrrBrl).toBe(0);
    expect(summary.kpis.payableBrl).toBe(0);
    expect(summary.latestSales).toEqual([]);
    expect(summary.revenueByProduct).toEqual([]);
  });

  it('summarizes won sales as closed revenue', () => {
    const summary = summarizeSalesOpsState({
      sales: [
        {
          id: 'won-sale',
          code: '0001-01',
          clientNameSnapshot: 'SegPro',
          sellerNameSnapshot: 'Ana Martins',
          finderNameSnapshot: null,
          status: 'won',
          totalBrl: 500000,
          recurringBrl: 0,
          baseDate: '2026-07-14',
        },
        {
          id: 'open-sale',
          code: '0002-01',
          clientNameSnapshot: 'Dias Pet',
          sellerNameSnapshot: 'Ana Martins',
          finderNameSnapshot: null,
          status: 'open',
          totalBrl: 300000,
          recurringBrl: 0,
          baseDate: '2026-07-15',
        },
      ],
      products: [],
      clients: [],
      people: [],
      payables: [],
    });

    expect(summary.kpis.closedSalesCount).toBe(1);
    expect(summary.kpis.closedRevenueBrl).toBe(500000);
  });
});
