import { describe, expect, it } from 'vitest';
import {
  addMonthsToIsoDate,
  buildDashboardModel,
  buildFuncaoCostBasis,
  buildSalePayload,
  describeProfessionalCostBase,
  formatMoneyBrl,
  installmentSumCents,
  MAX_PRODUCT_CODE_SUFFIX,
  nextProductCodeSuffix,
  parseCurrencyInputToCents,
  professionalCostBaseCents,
  resolveProfessionalCostCents,
  resolveSaleCommissionDefaults,
  splitInstallmentsEqually,
  type SaleCommissionDefaultsProduct,
} from '../calculations';
import type {
  SalesOpsBootstrap,
  SalesOpsProduct,
  SalesOpsProductFuncaoCost,
  SalesOpsSale,
} from '../types';

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
      productFuncaoCosts: [],
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
      productFuncaoCosts: [],
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

  /*
    Rewritten deliberately. This used to pin `2026-03-03`, the native
    `Date.UTC(y, m + 1, 31)` rollover, while the API's own `addMonths` in
    `apps/api/src/domains/sales-ops/service.ts` clamps to `2026-02-28`. The web
    therefore previewed recurring due dates the API would never write, for any base
    day of 29-31. The clamp below is the API's behaviour, so the two now agree.
  */
  it('clamps month-end split dates to the last valid day like the API does', () => {
    expect(splitInstallmentsEqually(300, 2, '2026-01-31', 'pix')[1]!.dueDate).toBe('2026-02-28');
    expect(splitInstallmentsEqually(300, 2, '2028-01-31', 'pix')[1]!.dueDate).toBe('2028-02-29');
  });

  it('recomputes each offset from the anchor so a clamped month cannot drift', () => {
    // The month after a clamped February is the 31st again, not the 28th.
    expect(addMonthsToIsoDate('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsToIsoDate('2026-01-31', 2)).toBe('2026-03-31');
    expect(addMonthsToIsoDate('2026-01-31', 3)).toBe('2026-04-30');
    expect(addMonthsToIsoDate('2026-01-31', 12)).toBe('2027-01-31');
    // Ordinary days are untouched, which is the positive control for the clamp.
    expect(addMonthsToIsoDate('2026-07-10', 1)).toBe('2026-08-10');
    expect(addMonthsToIsoDate('2026-12-10', 1)).toBe('2027-01-10');
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

  it('carries funcaoId on a professional and still emits role for the legacy path', () => {
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
    };

    expect(
      buildSalePayload({
        ...base,
        professionals: [
          {
            personId: '  44444444-4444-4444-8444-444444444444  ',
            personName: '  Ana Martins  ',
            funcaoId: '  fc000010-0000-4000-8000-000000000010  ',
            role: '  Desenvolvedor  ',
            // Already CENTS: the wizard converts before calling, exactly as it does
            // for otherCostsBrl and every installment amount.
            costBrl: 100000,
          },
        ],
      }).professionals,
    ).toEqual([
      {
        personId: '44444444-4444-4444-8444-444444444444',
        personName: 'Ana Martins',
        funcaoId: 'fc000010-0000-4000-8000-000000000010',
        role: 'Desenvolvedor',
        costBrl: 100000,
        // A draft that states no schedule sends an explicit null, never an omitted
        // key: `null` is what asks the API for the default pro-rata split, and on an
        // UPDATE it is also what CLEARS a stored override.
        costSplitBp: null,
      },
    ]);

    // Legacy path: no funcaoId, so `role` is the only thing keeping the payload
    // valid against SaleProfessionalSchema's funcao_or_role_required refine.
    expect(
      buildSalePayload({
        ...base,
        professionals: [{ personName: 'Dev Externo', role: 'Operacional', costBrl: 50000 }],
      }).professionals,
    ).toEqual([
      {
        personId: undefined,
        personName: 'Dev Externo',
        funcaoId: undefined,
        role: 'Operacional',
        costBrl: 50000,
        // A row that predates `cost_split_bp` still sends the key, as an explicit null.
        costSplitBp: null,
      },
    ]);

    // An empty role becomes `undefined` rather than '', because the API declares
    // it as `.min(1).optional()` and '' would be a 400.
    expect(
      buildSalePayload({
        ...base,
        professionals: [
          {
            personName: 'Ana',
            funcaoId: 'fc000010-0000-4000-8000-000000000010',
            role: '   ',
            costBrl: 0,
          },
        ],
      }).professionals[0]?.role,
    ).toBeUndefined();
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

describe('professional cost unit resolution', () => {
  const devFuncaoId = 'fc000010-0000-4000-8000-000000000010';
  const testerFuncaoId = 'fc000011-0000-4000-8000-000000000011';
  const customProductId = '11111111-1111-4111-8111-111111111111';
  const landingProductId = '22222222-2222-4222-8222-222222222222';

  function costRow(patch: Partial<SalesOpsProductFuncaoCost>): SalesOpsProductFuncaoCost {
    return {
      id: `cost-${patch.productId}-${patch.funcaoId}`,
      orgId: 'org-test',
      productId: customProductId,
      funcaoId: devFuncaoId,
      mode: 'pct',
      valuePct: '5.00',
      valueBrl: null,
      createdAt: '2026-07-13T12:00:00.000Z',
      updatedAt: null,
      ...patch,
    };
  }

  /** One R$ 20.000,00 FXL Custom item declaring a 5% dev cost and a fixed tester cost. */
  const singleItemBasis = buildFuncaoCostBasis(
    [{ productId: customProductId, productName: 'FXL Custom', subtotalBrl: 2000000 }],
    [
      costRow({ funcaoId: devFuncaoId, mode: 'pct', valuePct: '5.00' }),
      costRow({ funcaoId: testerFuncaoId, mode: 'fix', valuePct: null, valueBrl: 30000 }),
    ],
  );

  it('resolves a wizard percent against the funcao-scoped item subtotal, floors it, and reads costBrl verbatim in fix mode', () => {
    // 1. A percentage of the função-scoped base.
    expect(
      resolveProfessionalCostCents({ costUnit: 'pct', costPct: '10', costBrl: '0' }, 2000000),
    ).toBe(200000);

    // 2. Floors, never rounds: 5% of 1999 cents is 99.95.
    expect(resolveProfessionalCostCents({ costUnit: 'pct', costPct: '5', costBrl: '0' }, 1999)).toBe(
      99,
    );

    // 3. `fix` ignores the base entirely.
    for (const base of [0, 1999, 2000000]) {
      expect(
        resolveProfessionalCostCents({ costUnit: 'fix', costPct: '99', costBrl: '300' }, base),
      ).toBe(30000);
    }

    // 4. Negative and garbage percentages clamp to zero rather than crediting money back.
    expect(
      resolveProfessionalCostCents({ costUnit: 'pct', costPct: '-10', costBrl: '0' }, 2000000),
    ).toBe(0);
    expect(
      resolveProfessionalCostCents({ costUnit: 'pct', costPct: 'abc', costBrl: '0' }, 2000000),
    ).toBe(0);
    expect(resolveProfessionalCostCents({ costUnit: 'pct', costPct: '', costBrl: '0' }, 2000000)).toBe(
      0,
    );
  });

  it('bases a percent on the summed subtotals of the items whose produto declares the funcao', () => {
    // 5. Two declaring items, and the base is the SUBTOTAL, not the default's own cents.
    const twoItemBasis = buildFuncaoCostBasis(
      [
        { productId: customProductId, productName: 'FXL Custom', subtotalBrl: 2000000 },
        { productId: landingProductId, productName: 'Landing Page', subtotalBrl: 1000000 },
      ],
      [
        costRow({ funcaoId: testerFuncaoId, mode: 'fix', valuePct: null, valueBrl: 30000 }),
        costRow({
          productId: landingProductId,
          funcaoId: testerFuncaoId,
          mode: 'fix',
          valuePct: null,
          valueBrl: 30000,
        }),
      ],
    );
    expect(professionalCostBaseCents(twoItemBasis.get(testerFuncaoId), 0)).toBe(3000000);
    // A `fix`-mode produto default still bases a wizard percent on the item subtotal.
    expect(professionalCostBaseCents(singleItemBasis.get(testerFuncaoId), 0)).toBe(2000000);
    expect(professionalCostBaseCents(singleItemBasis.get(devFuncaoId), 0)).toBe(2000000);
  });

  it('falls back to the product-item subtotal total only when no produto declares the funcao', () => {
    // 6. The fallback branch: an inline-created função no produto declares yet.
    expect(professionalCostBaseCents(undefined, 3000000)).toBe(3000000);
    // 7. The empty case the UI warns about instead of silently writing a zero.
    expect(professionalCostBaseCents(undefined, 0)).toBe(0);
    // A scoped entry always wins over the fallback.
    expect(professionalCostBaseCents(singleItemBasis.get(devFuncaoId), 9999999)).toBe(2000000);
  });

  it('never lets the recurring mensalidade into the percent base', () => {
    // 8. Neither function takes a recurring value at all, so a R$ 50,00 mensalidade
    // cannot reach the base of a professional_cost. Paying that cost out per
    // receivable did not change this: the split holds `Σ parts === cost_brl`, so the
    // cost is still a PAY-ONCE TOTAL and pricing it off a monthly stream would still
    // charge it against every cycle.
    const recurringMonthlyCents = 500000;
    expect(professionalCostBaseCents(singleItemBasis.get(devFuncaoId), 2000000)).toBe(2000000);
    expect(professionalCostBaseCents(singleItemBasis.get(devFuncaoId), 2000000)).not.toBe(
      2000000 + recurringMonthlyCents,
    );
  });

  it('describes which base a percent was taken from, naming the declaring produtos', () => {
    // 9. The derivation line and the cents come from the same entry.
    expect(describeProfessionalCostBase('10', singleItemBasis.get(devFuncaoId), 0)).toBe(
      '10% de R$ 20.000,00 (FXL Custom)',
    );

    const repeatedProduct = buildFuncaoCostBasis(
      [
        { productId: customProductId, productName: 'FXL Custom', subtotalBrl: 2000000 },
        { productId: customProductId, productName: 'FXL Custom', subtotalBrl: 1000000 },
        { productId: landingProductId, productName: 'Landing Page', subtotalBrl: 500000 },
      ],
      [
        costRow({ funcaoId: devFuncaoId, mode: 'pct', valuePct: '5.00' }),
        costRow({ productId: landingProductId, funcaoId: devFuncaoId, mode: 'pct', valuePct: '5.00' }),
      ],
    );
    expect(describeProfessionalCostBase('10', repeatedProduct.get(devFuncaoId), 0)).toBe(
      '10% de R$ 35.000,00 (FXL Custom + Landing Page)',
    );

    expect(describeProfessionalCostBase('10', undefined, 3000000)).toBe(
      '10% de R$ 30.000,00 (total dos itens de produto)',
    );
    expect(describeProfessionalCostBase('10', undefined, 0)).toBe('');
  });
});

/*
  `(org_id, code_suffix)` is UNIQUE and NOT partial, so every one of these cases is
  about which numbers are already permanently owned. The suggestion is `max + 1`,
  which is what the operator asked for, and NOT "lowest free slot" - case 3 is the
  assertion that decides the slice.
*/
describe('nextProductCodeSuffix', () => {
  function rows(...codeSuffixes: string[]): Array<Pick<SalesOpsProduct, 'codeSuffix'>> {
    return codeSuffixes.map((codeSuffix) => ({ codeSuffix }));
  }

  function productFixture(patch: Partial<SalesOpsProduct>): SalesOpsProduct {
    return {
      id: `product-${patch.codeSuffix ?? '0'}`,
      orgId: 'org-test',
      name: 'FXL Produto',
      kind: 'product',
      codeSuffix: '0',
      areaId: 'area-1',
      openPrice: false,
      setupBrl: 0,
      hasMonthly: false,
      monthlyBrl: 0,
      recurringCommission: false,
      hasFinderCommission: false,
      sellerCommissionType: 'pct',
      sellerCommissionValue: '10.00',
      sellerWithFinderCommissionType: 'pct',
      sellerWithFinderCommissionValue: '7.00',
      finderCommissionType: 'pct',
      finderCommissionValue: '3.00',
      defaultPaymentMethod: 'pix',
      defaultEntradaMode: 'none',
      defaultEntradaPct: null,
      defaultEntradaBrl: null,
      defaultRemainingInstallments: 1,
      defaultRecurringCycles: null,
      modules: [],
      providers: [],
      status: 'active',
      createdAt: '2026-07-30T12:00:00.000Z',
      updatedAt: null,
      ...patch,
    };
  }

  it('starts an empty catalogue at the column default 0', () => {
    expect(nextProductCodeSuffix([])).toBe('0');
  });

  it('increments the ordinary single-row case', () => {
    expect(nextProductCodeSuffix(rows('0'))).toBe('1');
  });

  it('takes the max and never fills a gap', () => {
    // 1, 2, 4, 5 and 6 are free and stay free: `max + 1`, not lowest-free.
    expect(nextProductCodeSuffix(rows('0', '3', '7'))).toBe('8');
  });

  it('is order-independent', () => {
    expect(nextProductCodeSuffix(rows('7', '0', '3'))).toBe('8');
  });

  it('ignores non-numeric suffixes, and a catalogue of only those is the empty case', () => {
    expect(nextProductCodeSuffix(rows('FIN', 'CST'))).toBe('0');
  });

  it('counts only strictly-shaped values, exactly as the API regex does', () => {
    // '007', '100', '' and ' 5' cannot round-trip through /^\d{1,2}$/, so none of
    // them is evidence that a slot is occupied. Only '2' counts.
    expect(nextProductCodeSuffix(rows('2', 'FIN', '007', '100', '', ' 5'))).toBe('3');
  });

  it('orders numerically, not lexicographically', () => {
    // A `.sort()`-based implementation would answer '10' here.
    expect(nextProductCodeSuffix(rows('9', '10'))).toBe('11');
  });

  it('falls back to the lowest free slot once 99 is taken', () => {
    expect(nextProductCodeSuffix(rows('99'))).toBe('0');
    expect(nextProductCodeSuffix(rows('0', '99'))).toBe('1');
  });

  it('returns 0 rather than 100 when the whole space is exhausted', () => {
    const everySuffix = Array.from({ length: 100 }, (_, index) => String(index));
    expect(nextProductCodeSuffix(rows(...everySuffix))).toBe('0');
  });

  it('counts archived rows and serviço rows too', () => {
    // The unique index has no WHERE clause: an archived produto owns its suffix
    // forever, and a Serviço owns one exactly like a Produto does.
    const catalogue: SalesOpsProduct[] = [
      productFixture({ codeSuffix: '4', status: 'archived' }),
      productFixture({ codeSuffix: '6', kind: 'service' }),
    ];
    expect(nextProductCodeSuffix(catalogue)).toBe('7');
  });

  it('bounds the domain at 99, matching the API regex and the input maxLength', () => {
    expect(MAX_PRODUCT_CODE_SUFFIX).toBe(99);
  });
});
