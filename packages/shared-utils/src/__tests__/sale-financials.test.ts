import { describe, expect, it } from 'vitest';

import { computeSaleFinancials, pctOfCents } from '../sale-financials.js';

function input(overrides: Partial<Parameters<typeof computeSaleFinancials>[0]> = {}) {
  return {
    itemsTotalBrl: 0,
    boundedRecurringBrl: 0,
    receivableAmountsBrl: [] as number[],
    sellerCommissionPct: 0,
    finderCommissionPct: 0,
    hasFinder: false,
    taxPct: 0,
    otherCostsBrl: 0,
    professionalCostsBrl: 0,
    ...overrides,
  };
}

describe('computeSaleFinancials', () => {
  it('floors each percentage per receivable row rather than once over the total', () => {
    const result = computeSaleFinancials(
      input({
        itemsTotalBrl: 666666,
        receivableAmountsBrl: [333333, 333333],
        sellerCommissionPct: 10,
      }),
    );

    // Σ floor(333333 * 10 / 100) = 33333 + 33333 = 66666.
    expect(result.sellerCommissionBrl).toBe(66666);
    // The positive control for the negative claim below: floor(Σ) would be 66666
    // too on this split, so the discriminating case is an odd single row.
    expect(pctOfCents(666666, 10)).toBe(66666);
    expect(
      computeSaleFinancials(
        input({
          itemsTotalBrl: 666667,
          receivableAmountsBrl: [333334, 333333],
          sellerCommissionPct: 10,
        }),
      ).sellerCommissionBrl,
    ).toBe(66666);
    // floor over the total would have produced 66666 as well, so pin the case
    // where the two genuinely differ: three rows each losing a fraction.
    expect(
      computeSaleFinancials(
        input({
          itemsTotalBrl: 300,
          receivableAmountsBrl: [100, 100, 100],
          sellerCommissionPct: 15,
        }),
      ).sellerCommissionBrl,
    ).toBe(45);
    expect(pctOfCents(300, 15)).toBe(45);
    expect(
      computeSaleFinancials(
        input({ itemsTotalBrl: 27, receivableAmountsBrl: [9, 9, 9], sellerCommissionPct: 15 }),
      ).sellerCommissionBrl,
    ).toBe(3); // Σ floor(1.35) = 1+1+1; floor(27 * 15 / 100) would be 4.
    expect(pctOfCents(27, 15)).toBe(4);
  });

  it('includes a bounded recurring block in totalBrl and excludes an indefinite one', () => {
    const bounded = computeSaleFinancials(
      input({
        itemsTotalBrl: 2000000,
        boundedRecurringBrl: 1000000,
        receivableAmountsBrl: [2000000, 250000, 250000, 250000, 250000],
      }),
    );
    expect(bounded.totalBrl).toBe(3000000);

    // Indefinite: `cycles: null` generates no bounded rows anywhere, so the caller
    // passes 0 and no recurring receivable row.
    const indefinite = computeSaleFinancials(
      input({ itemsTotalBrl: 2000000, boundedRecurringBrl: 0, receivableAmountsBrl: [2000000] }),
    );
    expect(indefinite.totalBrl).toBe(2000000);
  });

  it('drops the finder commission entirely when hasFinder is false', () => {
    const shared = {
      itemsTotalBrl: 1000000,
      receivableAmountsBrl: [1000000],
      finderCommissionPct: 3,
    };
    const without = computeSaleFinancials(input({ ...shared, hasFinder: false }));
    const withFinder = computeSaleFinancials(input({ ...shared, hasFinder: true }));

    expect(without.finderCommissionBrl).toBe(0);
    // Positive control: the same percentage does produce a commission when the
    // finder is present, so the zero above is the flag and not a zero rate.
    expect(withFinder.finderCommissionBrl).toBe(30000);
    expect(without.netMarginBrl).toBe(withFinder.netMarginBrl + 30000);
  });

  it('subtracts professional and other costs from the net margin', () => {
    const result = computeSaleFinancials(
      input({
        itemsTotalBrl: 1000000,
        receivableAmountsBrl: [1000000],
        sellerCommissionPct: 10,
        taxPct: 6,
        professionalCostsBrl: 130000,
        otherCostsBrl: 12345,
      }),
    );

    expect(result.sellerCommissionBrl).toBe(100000);
    expect(result.taxBrl).toBe(60000);
    expect(result.professionalCostsBrl).toBe(130000);
    expect(result.otherCostsBrl).toBe(12345);
    expect(result.netMarginBrl).toBe(1000000 - 100000 - 60000 - 130000 - 12345);
    expect(result.netMarginBrl).toBe(697655);
  });

  it('returns netMarginPct as a two-decimal string and 0.00 when the total is zero', () => {
    const result = computeSaleFinancials(
      input({ itemsTotalBrl: 300000, receivableAmountsBrl: [300000], sellerCommissionPct: 7 }),
    );
    expect(result.netMarginBrl).toBe(279000);
    expect(result.netMarginPct).toBe('93.00');

    const empty = computeSaleFinancials(input({ itemsTotalBrl: 0, receivableAmountsBrl: [] }));
    expect(empty.totalBrl).toBe(0);
    expect(empty.netMarginPct).toBe('0.00');
  });

  it('pctOfCents floors toward zero and returns zero for a zero rate', () => {
    expect(pctOfCents(1999, 10)).toBe(199);
    expect(pctOfCents(1000, 0)).toBe(0);
    expect(pctOfCents(0, 15)).toBe(0);
    expect(pctOfCents(100000, 3.5)).toBe(3500);
  });
});
