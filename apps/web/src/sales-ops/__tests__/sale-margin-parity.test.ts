// GOLDEN FIXTURE - must stay byte-identical to
// apps/api/src/domains/sales-ops/__tests__/sale-margin-parity.test.ts.
//
// The two files cannot share a module: apps/web cannot import from apps/api, and a
// test-only fixture inside packages/shared-utils is not in that package's dist
// export map. (The web imports the `/sale-financials` subpath rather than the
// package root, because the root also re-exports the Node-only hmac module.) They duplicate the literals on purpose and both assert against the
// same `computeSaleFinancials`, so a real behaviour divergence breaks one of them.
import { computeSaleFinancials } from '@fxl-sales/shared-utils/sale-financials';
import { describe, expect, it } from 'vitest';

import {
  buildFuncaoCostBasis,
  describeFuncaoCostBasis,
  resolveFuncaoCostCents,
} from '../calculations';
import type { SalesOpsProductFuncaoCost } from '../types';

const devFuncaoId = '55555555-5555-4555-8555-555555555555';
const testerFuncaoId = '66666666-6666-4666-8666-666666666666';
const customProductId = '44444444-4444-4444-8444-444444444444';
const landingProductId = '99999999-9999-4999-8999-999999999999';

function costRow(patch: Partial<SalesOpsProductFuncaoCost>): SalesOpsProductFuncaoCost {
  return {
    id: `cost-${patch.funcaoId}-${patch.productId}`,
    orgId: 'org-test',
    productId: customProductId,
    funcaoId: devFuncaoId,
    mode: 'pct',
    valuePct: '5.00',
    valueBrl: null,
    createdAt: '2026-07-29T12:00:00.000Z',
    updatedAt: null,
    ...patch,
  };
}

describe('sale margin parity - wizard model', () => {
  it('the wizard margin model reports the same golden fixture financials as the API ledger', () => {
    /*
      Exactly what the wizard derives: `itemsTotalBrl` from the item rows,
      `boundedRecurringBrl` from the recorrência block, and the receivable amounts
      from the parcelas followed by the bounded recurring cycles - the same order
      `buildSaleLedger` pushes them in.
    */
    const financials = computeSaleFinancials({
      itemsTotalBrl: 2 * 1000000,
      boundedRecurringBrl: 250000 * 4,
      receivableAmountsBrl: [666667, 666667, 666666, 250000, 250000, 250000, 250000],
      sellerCommissionPct: 15,
      finderCommissionPct: 3.5,
      hasFinder: true,
      taxPct: 6,
      otherCostsBrl: 12345,
      professionalCostsBrl: 100000 + 30000,
    });

    expect(financials.totalBrl).toBe(3000000);
    expect(financials.sellerCommissionBrl).toBe(449999);
    expect(financials.finderCommissionBrl).toBe(104999);
    expect(financials.taxBrl).toBe(179999);
    expect(financials.professionalCostsBrl).toBe(130000);
    expect(financials.otherCostsBrl).toBe(12345);
    expect(financials.netMarginBrl).toBe(2122658);
    expect(financials.netMarginPct).toBe('70.76');
  });

  it('excludes the recurring mensalidade from the funcao cost base', () => {
    const basis = buildFuncaoCostBasis(
      [{ productId: customProductId, productName: 'FXL Custom', subtotalBrl: 2000000 }],
      [costRow({ valuePct: '5.00' })],
    );

    // 5% of the ITEM subtotal, and nothing else. A recorrência of any size cannot
    // reach this function: it takes items only, because a professional_cost is a
    // PAY-ONCE TOTAL and pricing it off a monthly stream would double-count it. The
    // per-receivable split decides only WHEN that total is paid, under
    // `Σ parts === cost_brl`, and it skips the `M`-labelled rows too.
    expect(basis.get(devFuncaoId)?.cents).toBe(100000);
    // Positive control: doubling the ITEM subtotal does move the number, so the
    // insensitivity above is about the recorrência and not a frozen result.
    expect(
      buildFuncaoCostBasis(
        [{ productId: customProductId, productName: 'FXL Custom', subtotalBrl: 4000000 }],
        [costRow({ valuePct: '5.00' })],
      ).get(devFuncaoId)?.cents,
    ).toBe(200000);
  });

  it('sums a percent funcao default across every item whose product declares it', () => {
    const basis = buildFuncaoCostBasis(
      [
        { productId: customProductId, productName: 'FXL Custom', subtotalBrl: 2000000 },
        { productId: landingProductId, productName: 'Landing Page', subtotalBrl: 1000000 },
      ],
      [costRow({ valuePct: '5.00' }), costRow({ productId: landingProductId, valuePct: '5.00' })],
    );

    expect(basis.get(devFuncaoId)?.cents).toBe(150000);
    expect(basis.get(devFuncaoId)?.contributions).toHaveLength(2);
  });

  it('gives a free-form item no funcao cost, because it has no product to read defaults from', () => {
    const basis = buildFuncaoCostBasis(
      [
        { productId: undefined, productName: 'Item avulso', subtotalBrl: 2000000 },
        { productId: customProductId, productName: 'FXL Custom', subtotalBrl: 1000000 },
      ],
      [costRow({ valuePct: '5.00' })],
    );

    // Only the product row contributed: 5% of 1000000, not of 3000000.
    expect(basis.get(devFuncaoId)?.cents).toBe(50000);
    expect(basis.get(devFuncaoId)?.contributions.map((row) => row.productName)).toEqual([
      'FXL Custom',
    ]);
  });

  it('resolveFuncaoCostCents treats pct as percent points and fix as integer cents', () => {
    expect(resolveFuncaoCostCents({ mode: 'pct', valuePct: '5.00', valueBrl: null }, 2000000)).toBe(
      100000,
    );
    // A fixed default ignores the subtotal entirely.
    expect(resolveFuncaoCostCents({ mode: 'fix', valuePct: null, valueBrl: 30000 }, 2000000)).toBe(
      30000,
    );
    expect(resolveFuncaoCostCents({ mode: 'fix', valuePct: null, valueBrl: 30000 }, 9999999)).toBe(
      30000,
    );
    // Floors rather than rounds, matching every other money rule in the product.
    expect(resolveFuncaoCostCents({ mode: 'pct', valuePct: '5.00', valueBrl: null }, 1999)).toBe(
      99,
    );
  });

  it('describeFuncaoCostBasis renders the percent derivation and joins several contributions with a plus', () => {
    const single = buildFuncaoCostBasis(
      [{ productId: customProductId, productName: 'FXL Custom', subtotalBrl: 2000000 }],
      [costRow({ valuePct: '5.00' })],
    );
    expect(describeFuncaoCostBasis(single.get(devFuncaoId))).toBe(
      '5% de FXL Custom (R$ 20.000,00)',
    );

    const mixed = buildFuncaoCostBasis(
      [
        { productId: customProductId, productName: 'FXL Custom', subtotalBrl: 2000000 },
        { productId: landingProductId, productName: 'Landing Page', subtotalBrl: 500000 },
      ],
      [
        costRow({ funcaoId: testerFuncaoId, valuePct: '5.00' }),
        costRow({
          funcaoId: testerFuncaoId,
          productId: landingProductId,
          mode: 'fix',
          valuePct: null,
          valueBrl: 30000,
        }),
      ],
    );
    expect(describeFuncaoCostBasis(mixed.get(testerFuncaoId))).toBe(
      '5% de FXL Custom (R$ 20.000,00) + R$ 300,00 de Landing Page',
    );
    expect(mixed.get(testerFuncaoId)?.cents).toBe(130000);

    expect(describeFuncaoCostBasis(undefined)).toBe('');
  });
});
