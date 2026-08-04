import { describe, expect, it } from 'vitest';
import {
  SPLIT_BP_TOTAL,
  defaultSplitBp,
  isRecurringReceivableLabel,
  resolveProfessionalSplit,
  splitCentsByWeights,
  type SplitReceivable,
} from '../professional-split.js';

describe('splitCentsByWeights', () => {
  it('puts the whole floor remainder on the last part so the sum is exact', () => {
    expect(splitCentsByWeights(1000, [1, 1, 1])).toEqual([333, 333, 334]);
  });

  it('reproduces splitInstallmentsEqually exactly for equal weights', () => {
    const totals = [123, 1000, 999999, 123456789];
    const counts = [1, 2, 3, 7, 12];
    for (const total of totals) {
      for (const n of counts) {
        const actual = splitCentsByWeights(total, Array(n).fill(1));
        const base = Math.floor(total / n);
        const expected = Array.from({ length: n }, (_, i) =>
          i === n - 1 ? total - base * (n - 1) : base,
        );
        expect(actual).toEqual(expected);
      }
    }
  });

  const table: Array<{ name: string; total: number; weights: number[] }> = [
    { name: 'thirds', total: 1000, weights: [1, 1, 1] },
    { name: 'skewed 30/70', total: 1_000_000, weights: [3000, 7000] },
    { name: 'single weight', total: 555, weights: [1] },
    { name: 'prime weights', total: 9973, weights: [7, 11, 13, 17] },
    { name: 'zero-containing', total: 500, weights: [0, 10000] },
    { name: 'all zero but one', total: 12345, weights: [0, 0, 1, 0] },
    { name: 'large skew', total: 2_147_483_647, weights: [1, 999999] },
    { name: 'many equal parts', total: 1_000_003, weights: Array(12).fill(1) },
    { name: 'two equal', total: 1, weights: [1, 1] },
    { name: 'zero total', total: 0, weights: [1, 1, 1] },
    { name: 'zero total zero weights', total: 0, weights: [0, 0] },
    { name: 'huge single weight', total: 1_000_000, weights: [123456789] },
    { name: 'uneven bp-like', total: 999999, weights: [2500, 2500, 2500, 2500] },
    { name: 'fractional-looking bp', total: 333, weights: [3333, 3333, 3334] },
    { name: 'five parts', total: 100_000, weights: [1, 2, 3, 4, 5] },
    { name: 'six parts prime total', total: 7919, weights: [1, 1, 1, 1, 1, 1] },
    { name: 'single zero weight then positive', total: 250, weights: [0, 1] },
    { name: 'weights sum > total', total: 10, weights: [1000, 1000] },
    { name: 'negative-safe large product', total: 2_147_483_647, weights: [10_000] },
    { name: 'ten parts', total: 999, weights: Array(10).fill(1) },
  ];

  it.each(table)('is exact-sum for every weight vector: $name', ({ total, weights }) => {
    const out = splitCentsByWeights(total, weights);
    expect(out.reduce((sum, v) => sum + v, 0)).toBe(total);
  });

  it.each(table)('never emits a negative part: $name', ({ total, weights }) => {
    const out = splitCentsByWeights(total, weights);
    expect(out.every((v) => v >= 0)).toBe(true);
  });

  it('gives the whole total to the last part when every weight is zero', () => {
    expect(splitCentsByWeights(500, [0, 0, 0])).toEqual([0, 0, 500]);
  });

  it('returns an empty array for an empty weight vector', () => {
    expect(splitCentsByWeights(1000, [])).toEqual([]);
  });

  it('keeps the product inside MAX_SAFE_INTEGER at the domain ceiling', () => {
    expect(splitCentsByWeights(2_147_483_647, [10_000])).toEqual([2147483647]);
  });
});

describe('defaultSplitBp', () => {
  it('always sums to exactly 10000', () => {
    const cases: number[][] = [[10, 20, 20, 50], [1, 1, 1], [999999, 1], [0, 0]];
    for (const amounts of cases) {
      const bp = defaultSplitBp(amounts);
      expect(bp.reduce((sum, v) => sum + v, 0)).toBe(SPLIT_BP_TOTAL);
    }
  });

  it('distributes the 10k/20k/20k/50k case as 1000/2000/2000/5000', () => {
    expect(defaultSplitBp([10, 20, 20, 50])).toEqual([1000, 2000, 2000, 5000]);
  });

  it('gives the whole 10000 to the last part when every amount is zero', () => {
    expect(defaultSplitBp([0, 0])).toEqual([0, 10000]);
  });
});

describe('resolveProfessionalSplit', () => {
  const r = (id: string, dueDate: string, amountBrl: number): SplitReceivable => ({
    id,
    dueDate,
    amountBrl,
  });

  it('distributes a cost pro rata over the parcelas — the 10k/20k/20k/50k case', () => {
    const receivables = [
      r('r1', '2026-01-01', 1_000_000),
      r('r2', '2026-02-01', 2_000_000),
      r('r3', '2026-03-01', 2_000_000),
      r('r4', '2026-04-01', 5_000_000),
    ];
    const parts = resolveProfessionalSplit({
      costBrl: 1_000_000,
      costSplitBp: null,
      receivables,
      fallbackDueDate: '2026-01-01',
    });
    expect(parts).toEqual([
      { receivableId: 'r1', dueDate: '2026-01-01', amountBrl: 100000 },
      { receivableId: 'r2', dueDate: '2026-02-01', amountBrl: 200000 },
      { receivableId: 'r3', dueDate: '2026-03-01', amountBrl: 200000 },
      { receivableId: 'r4', dueDate: '2026-04-01', amountBrl: 500000 },
    ]);
    expect(parts.reduce((sum, p) => sum + p.amountBrl, 0)).toBe(1_000_000);
  });

  it('honours a 30/70 override and leaves the third parcela unpaid', () => {
    const receivables = [
      r('r1', '2026-01-01', 100),
      r('r2', '2026-02-01', 100),
      r('r3', '2026-03-01', 100),
    ];
    const parts = resolveProfessionalSplit({
      costBrl: 1_000_000,
      costSplitBp: [3000, 7000],
      receivables,
      fallbackDueDate: '2026-01-01',
    });
    expect(parts).toEqual([
      { receivableId: 'r1', dueDate: '2026-01-01', amountBrl: 300000 },
      { receivableId: 'r2', dueDate: '2026-02-01', amountBrl: 700000 },
    ]);
  });

  it('pays a one-part override entirely out of the first parcela', () => {
    const receivables = [
      r('r1', '2026-01-01', 100),
      r('r2', '2026-02-01', 100),
      r('r3', '2026-03-01', 100),
    ];
    const parts = resolveProfessionalSplit({
      costBrl: 1_000_000,
      costSplitBp: [10000],
      receivables,
      fallbackDueDate: '2026-01-01',
    });
    expect(parts).toEqual([{ receivableId: 'r1', dueDate: '2026-01-01', amountBrl: 1_000_000 }]);
  });

  it('folds the tail of an override that has more parts than parcelas', () => {
    const receivables = [r('r1', '2026-01-01', 100), r('r2', '2026-02-01', 100)];
    const parts = resolveProfessionalSplit({
      costBrl: 1_000_000,
      costSplitBp: [2500, 2500, 2500, 2500],
      receivables,
      fallbackDueDate: '2026-01-01',
    });
    expect(parts).toEqual([
      { receivableId: 'r1', dueDate: '2026-01-01', amountBrl: 250000 },
      { receivableId: 'r2', dueDate: '2026-02-01', amountBrl: 750000 },
    ]);
    expect(parts.reduce((sum, p) => sum + p.amountBrl, 0)).toBe(1_000_000);
  });

  it('orders by due date regardless of the order the caller passed', () => {
    const receivables = [
      r('r3', '2026-03-01', 100),
      r('r1', '2026-01-01', 100),
      r('r2', '2026-02-01', 100),
    ];
    const parts = resolveProfessionalSplit({
      costBrl: 300,
      costSplitBp: null,
      receivables,
      fallbackDueDate: '2026-01-01',
    });
    expect(parts.map((p) => p.receivableId)).toEqual(['r1', 'r2', 'r3']);
  });

  it('falls back to a single unlinked part when there is no eligible receivable', () => {
    const parts = resolveProfessionalSplit({
      costBrl: 1_000_000,
      costSplitBp: null,
      receivables: [],
      fallbackDueDate: '2026-07-29',
    });
    expect(parts).toEqual([{ receivableId: null, dueDate: '2026-07-29', amountBrl: 1_000_000 }]);
  });

  it('sums to cost_brl for every override and every parcela count', () => {
    const costs = [1, 999999, 1_000_000, 2_147_483_647];
    for (let partCount = 1; partCount <= 6; partCount++) {
      for (let parcelaCount = 1; parcelaCount <= 6; parcelaCount++) {
        for (const costBrl of costs) {
          const receivables = Array.from({ length: parcelaCount }, (_, i) =>
            r(`r${i}`, `2026-${String(i + 1).padStart(2, '0')}-01`, 1000 * (i + 1)),
          );
          // build a costSplitBp of partCount entries summing to 10000
          const base = Math.floor(SPLIT_BP_TOTAL / partCount);
          const costSplitBp = Array.from({ length: partCount }, (_, i) =>
            i === partCount - 1 ? SPLIT_BP_TOTAL - base * (partCount - 1) : base,
          );
          const parts = resolveProfessionalSplit({
            costBrl,
            costSplitBp,
            receivables,
            fallbackDueDate: '2026-01-01',
          });
          const sum = parts.reduce((s, p) => s + p.amountBrl, 0);
          expect(sum).toBe(costBrl);
        }
      }
    }
  });

  it('treats a zero part as a parcela that pays nothing', () => {
    const receivables = [r('r1', '2026-01-01', 100), r('r2', '2026-02-01', 100)];
    const parts = resolveProfessionalSplit({
      costBrl: 1_000_000,
      costSplitBp: [0, 10000],
      receivables,
      fallbackDueDate: '2026-01-01',
    });
    expect(parts).toEqual([
      { receivableId: 'r1', dueDate: '2026-01-01', amountBrl: 0 },
      { receivableId: 'r2', dueDate: '2026-02-01', amountBrl: 1_000_000 },
    ]);
  });
});

describe('isRecurringReceivableLabel', () => {
  it('reads the M prefix as recurring and everything else as an installment', () => {
    expect(isRecurringReceivableLabel('M1/12')).toBe(true);
    expect(isRecurringReceivableLabel('1/3')).toBe(false);
    expect(isRecurringReceivableLabel('')).toBe(false);
    expect(isRecurringReceivableLabel(undefined)).toBe(false);
  });
});
