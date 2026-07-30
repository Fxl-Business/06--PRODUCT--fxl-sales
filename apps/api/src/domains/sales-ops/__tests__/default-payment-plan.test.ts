import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CreateSaleSchema,
  materializeDefaultPaymentPlan,
  type ProductPaymentDefaults,
} from '../service.js';

const BASE_DATE = '2026-01-31';

function defaults(patch: Partial<ProductPaymentDefaults> = {}): ProductPaymentDefaults {
  return {
    defaultPaymentMethod: 'pix',
    defaultEntradaMode: 'none',
    defaultEntradaPct: null,
    defaultEntradaBrl: null,
    defaultRemainingInstallments: 1,
    defaultRecurringCycles: 12,
    ...patch,
  };
}

/** Wraps a generated plan in the smallest proposta the write endpoint accepts. */
function saleFor(
  installments: Array<{ dueDate: string; amountBrl: number; method: string }>,
  totalBrl: number,
) {
  return {
    clientName: 'Cliente',
    sellerName: 'Vendedor',
    status: 'draft' as const,
    baseDate: BASE_DATE,
    items: [{ productId: randomUUID(), productName: 'Item', quantity: 1, unitBrl: totalBrl }],
    installments,
  };
}

describe('materializeDefaultPaymentPlan', () => {
  it('entrada 50 percent plus restante 3x yields four rows summing to the total', () => {
    const plan = materializeDefaultPaymentPlan({
      defaults: defaults({
        defaultEntradaMode: 'pct',
        // numeric(5,2) comes back from drizzle as a string.
        defaultEntradaPct: '50.00',
        defaultRemainingInstallments: 3,
      }),
      totalBrl: 100000,
      baseDate: BASE_DATE,
      hasMonthly: false,
      monthlyBrl: 0,
    });

    expect(plan.installments.map((row) => row.amountBrl)).toEqual([50000, 16668, 16666, 16666]);
    expect(plan.installments.reduce((sum, row) => sum + row.amountBrl, 0)).toBe(100000);
    expect(plan.installments.map((row) => row.dueDate)).toEqual([
      BASE_DATE,
      // addMonths clamps to the shorter month, which is existing behaviour.
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
    expect(plan.installments.every((row) => row.method === 'pix')).toBe(true);
    expect(plan.recurring).toBeNull();
  });

  it('no entrada with one parcela reproduces the cash plan on the base date', () => {
    const plan = materializeDefaultPaymentPlan({
      defaults: defaults(),
      totalBrl: 100000,
      baseDate: BASE_DATE,
      hasMonthly: false,
      monthlyBrl: 0,
    });

    expect(plan.installments).toEqual([
      { dueDate: BASE_DATE, amountBrl: 100000, method: 'pix' },
    ]);
  });

  it('honours the configured forma de pagamento on every row', () => {
    const plan = materializeDefaultPaymentPlan({
      defaults: defaults({
        defaultPaymentMethod: 'boleto',
        defaultEntradaMode: 'pct',
        defaultEntradaPct: '50.00',
        defaultRemainingInstallments: 2,
      }),
      totalBrl: 100000,
      baseDate: BASE_DATE,
      hasMonthly: false,
      monthlyBrl: 0,
    });

    expect(plan.installments.map((row) => row.method)).toEqual(['boleto', 'boleto', 'boleto']);
  });

  it('gives the rounding remainder to the first restante parcela', () => {
    const plan = materializeDefaultPaymentPlan({
      defaults: defaults({
        defaultEntradaMode: 'fix',
        defaultEntradaBrl: 30000,
        defaultRemainingInstallments: 2,
      }),
      totalBrl: 99999,
      baseDate: BASE_DATE,
      hasMonthly: false,
      monthlyBrl: 0,
    });

    expect(plan.installments.map((row) => row.amountBrl)).toEqual([30000, 35000, 34999]);
    expect(plan.installments.reduce((sum, row) => sum + row.amountBrl, 0)).toBe(99999);
  });

  it('clamps a fixed entrada to the proposta total and emits no zero parcela', () => {
    const plan = materializeDefaultPaymentPlan({
      defaults: defaults({
        defaultEntradaMode: 'fix',
        defaultEntradaBrl: 80000,
        defaultRemainingInstallments: 3,
      }),
      totalBrl: 50000,
      baseDate: BASE_DATE,
      hasMonthly: false,
      monthlyBrl: 0,
    });

    expect(plan.installments).toEqual([{ dueDate: BASE_DATE, amountBrl: 50000, method: 'pix' }]);
  });

  it('emits exactly one zero row for a zero-total proposta', () => {
    const plan = materializeDefaultPaymentPlan({
      defaults: defaults({ defaultRemainingInstallments: 4 }),
      totalBrl: 0,
      baseDate: BASE_DATE,
      hasMonthly: false,
      monthlyBrl: 0,
    });

    expect(plan.installments).toEqual([{ dueDate: BASE_DATE, amountBrl: 0, method: 'pix' }]);
  });

  it('emits an indefinite recurring block when defaultRecurringCycles is null', () => {
    const indefinite = materializeDefaultPaymentPlan({
      defaults: defaults({ defaultRecurringCycles: null }),
      totalBrl: 100000,
      baseDate: BASE_DATE,
      hasMonthly: true,
      monthlyBrl: 9900,
    });

    expect(indefinite.recurring).toEqual({
      monthlyBrl: 9900,
      startDate: '2026-02-28',
      cycles: null,
    });

    const bounded = materializeDefaultPaymentPlan({
      defaults: defaults({ defaultRecurringCycles: 6 }),
      totalBrl: 100000,
      baseDate: BASE_DATE,
      hasMonthly: true,
      monthlyBrl: 9900,
    });
    expect(bounded.recurring).toEqual({ monthlyBrl: 9900, startDate: '2026-02-28', cycles: 6 });

    const noRecurrence = materializeDefaultPaymentPlan({
      defaults: defaults({ defaultRecurringCycles: 12 }),
      totalBrl: 100000,
      baseDate: BASE_DATE,
      hasMonthly: false,
      monthlyBrl: 9900,
    });
    expect(noRecurrence.recurring).toBeNull();
  });

  it('every generated plan satisfies the API installments sum rule', () => {
    const vectors: Array<{ defaults: ProductPaymentDefaults; totalBrl: number }> = [
      {
        defaults: defaults({
          defaultEntradaMode: 'pct',
          defaultEntradaPct: '50.00',
          defaultRemainingInstallments: 3,
        }),
        totalBrl: 100000,
      },
      { defaults: defaults(), totalBrl: 100000 },
      {
        defaults: defaults({
          defaultEntradaMode: 'fix',
          defaultEntradaBrl: 30000,
          defaultRemainingInstallments: 2,
        }),
        totalBrl: 99999,
      },
      {
        defaults: defaults({
          defaultEntradaMode: 'fix',
          defaultEntradaBrl: 80000,
          defaultRemainingInstallments: 3,
        }),
        totalBrl: 50000,
      },
      {
        defaults: defaults({
          defaultEntradaMode: 'pct',
          defaultEntradaPct: '33.33',
          defaultRemainingInstallments: 7,
        }),
        totalBrl: 123457,
      },
      // Boundary: no entrada plus the maximum 120 parcelas is exactly the API ceiling.
      { defaults: defaults({ defaultRemainingInstallments: 120 }), totalBrl: 100001 },
      // Boundary: an entrada row plus 119 parcelas is also exactly 120 rows.
      {
        defaults: defaults({
          defaultEntradaMode: 'pct',
          defaultEntradaPct: '10.00',
          defaultRemainingInstallments: 119,
        }),
        totalBrl: 1000000,
      },
    ];

    for (const vector of vectors) {
      const plan = materializeDefaultPaymentPlan({
        defaults: vector.defaults,
        totalBrl: vector.totalBrl,
        baseDate: BASE_DATE,
        hasMonthly: false,
        monthlyBrl: 0,
      });
      const parsed = CreateSaleSchema.safeParse(saleFor(plan.installments, vector.totalBrl));
      expect(
        parsed.success,
        `plan for ${JSON.stringify(vector)} was rejected: ${
          parsed.success ? '' : JSON.stringify(parsed.error.issues)
        }`,
      ).toBe(true);
      expect(plan.installments.length).toBeLessThanOrEqual(120);
    }
  });

  it('documents the one template that overflows the 120-row API ceiling', () => {
    // An entrada row sits ON TOP of defaultRemainingInstallments, so the maximum
    // configurable 120 parcelas plus an entrada is 121 rows, one more than
    // `installments: max(120)` accepts. Pinned here rather than clamped, because
    // clamping would make the web mirror in slice 11 diverge from this reference
    // implementation. Slice 10's editor should cap the pair instead.
    const plan = materializeDefaultPaymentPlan({
      defaults: defaults({
        defaultEntradaMode: 'pct',
        defaultEntradaPct: '10.00',
        defaultRemainingInstallments: 120,
      }),
      totalBrl: 1000000,
      baseDate: BASE_DATE,
      hasMonthly: false,
      monthlyBrl: 0,
    });

    expect(plan.installments).toHaveLength(121);
    expect(CreateSaleSchema.safeParse(saleFor(plan.installments, 1000000)).success).toBe(false);
  });
});
