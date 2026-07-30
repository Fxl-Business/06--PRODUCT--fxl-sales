import { describe, expect, it } from 'vitest';
import {
  defaultPlanShapeForProduct,
  entradaCentsFor,
  generateInstallmentPlan,
  inferPaymentPlanShape,
  type PaymentPlanShape,
} from '../calculations';
import type { PaymentMethod } from '../types';

/**
 * The declarative payment-plan generator, tested without a DOM.
 *
 * The three phrases the product owner named are each one shape here, and each has
 * its own test below:
 *   "tudo pago em 1x"                     -> entradaMode 'none', restanteCount 1
 *   "50% de entrada + o resto em 3x"      -> entradaMode 'pct',  entradaValue 50, restanteCount 3
 *   "valor fixo R$ X de entrada + 1 mês"  -> entradaMode 'fix',  entradaValue X,  restanteCount 1
 */
function shape(patch: Partial<PaymentPlanShape> = {}): PaymentPlanShape {
  return {
    entradaMode: 'none',
    entradaValue: 0,
    restanteCount: 1,
    anchorDate: '2026-07-29',
    ...patch,
  };
}

function sumOf(rows: Array<{ amountBrl: number }>): number {
  return rows.reduce((sum, row) => sum + row.amountBrl, 0);
}

function row(
  dueDate: string,
  amountBrl: number,
  method: PaymentMethod = 'pix',
): { dueDate: string; amountBrl: number; method: PaymentMethod } {
  return { dueDate, amountBrl, method };
}

describe('generateInstallmentPlan', () => {
  it('expresses tudo pago em 1x as a single row for the full total', () => {
    expect(generateInstallmentPlan(7300000, shape(), [])).toEqual([
      row('2026-07-29', 7300000),
    ]);
  });

  it('expresses 50% de entrada mais o resto em 3x as four rows summing to the total', () => {
    const rows = generateInstallmentPlan(
      7300000,
      shape({ entradaMode: 'pct', entradaValue: 50, restanteCount: 3 }),
      [],
    );

    expect(rows).toEqual([
      row('2026-07-29', 3650000),
      row('2026-08-29', 1216666),
      row('2026-09-29', 1216666),
      row('2026-10-29', 1216668),
    ]);
    expect(sumOf(rows)).toBe(7300000);
  });

  it('expresses valor fixo de entrada mais o resto em 1 mes as two rows', () => {
    const rows = generateInstallmentPlan(
      7300000,
      shape({ entradaMode: 'fix', entradaValue: 1000000, restanteCount: 1 }),
      [],
    );

    expect(rows).toEqual([row('2026-07-29', 1000000), row('2026-08-29', 6300000)]);
    expect(sumOf(rows)).toBe(7300000);
  });

  it('puts the whole rounding remainder on the last restante row', () => {
    expect(
      generateInstallmentPlan(7300000, shape({ restanteCount: 3 }), []).map(
        (item) => item.amountBrl,
      ),
    ).toEqual([2433333, 2433333, 2433334]);
    expect(
      generateInstallmentPlan(250000, shape({ restanteCount: 3 }), []).map(
        (item) => item.amountBrl,
      ),
    ).toEqual([83333, 83333, 83334]);

    // Exactness is the invariant the Soma line depends on, so it is asserted over a
    // grid rather than on one lucky case.
    for (const total of [1, 99, 7300000, 7300001]) {
      for (let count = 1; count <= 12; count += 1) {
        expect(sumOf(generateInstallmentPlan(total, shape({ restanteCount: count }), []))).toBe(
          total,
        );
        expect(
          sumOf(
            generateInstallmentPlan(
              total,
              shape({ entradaMode: 'pct', entradaValue: 33.33, restanteCount: count }),
              [],
            ),
          ),
        ).toBe(total);
      }
    }
  });

  it('stays exact and within the row cap when the restante count is at the ceiling', () => {
    /*
      The entrada row counts against the sale endpoints' `installments: max(120)`, so a
      120-row restante PLUS an entrada would overflow it. Truncating the tail would
      silently drop the row carrying the whole remainder, which is why the ceiling is
      enforced on the restante count inside this function rather than by chopping the
      finished array. Callers get exactness without having to know the rule.
    */
    for (const total of [100000000, 100000001, 1, 99]) {
      for (const entrada of [
        { entradaMode: 'none' as const, entradaValue: 0 },
        { entradaMode: 'pct' as const, entradaValue: 10 },
        { entradaMode: 'pct' as const, entradaValue: 33.33 },
        { entradaMode: 'fix' as const, entradaValue: 1000000 },
      ]) {
        const rows = generateInstallmentPlan(total, shape({ ...entrada, restanteCount: 120 }), []);
        expect(sumOf(rows)).toBe(total);
        expect(rows.length).toBeLessThanOrEqual(120);
      }
    }

    // The exact shape of the ceiling: 120 rows with no entrada, 120 with one (119
    // restante plus the entrada), never 121.
    expect(
      generateInstallmentPlan(100000000, shape({ restanteCount: 120 }), []),
    ).toHaveLength(120);
    expect(
      generateInstallmentPlan(
        100000000,
        shape({ entradaMode: 'pct', entradaValue: 10, restanteCount: 120 }),
        [],
      ),
    ).toHaveLength(120);
    // An absurd count is clamped rather than honoured, on both sides of the entrada.
    expect(generateInstallmentPlan(100000000, shape({ restanteCount: 9999 }), [])).toHaveLength(
      120,
    );
  });

  it('clamps month-end due dates to the last valid day without drifting', () => {
    expect(
      generateInstallmentPlan(400, shape({ anchorDate: '2026-01-31', restanteCount: 4 }), []).map(
        (item) => item.dueDate,
      ),
    ).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(
      generateInstallmentPlan(400, shape({ anchorDate: '2028-01-31', restanteCount: 4 }), []).map(
        (item) => item.dueDate,
      ),
    ).toEqual(['2028-01-31', '2028-02-29', '2028-03-31', '2028-04-30']);
  });

  it('generates no rows beyond the total when the entrada covers everything', () => {
    expect(
      generateInstallmentPlan(
        7300000,
        shape({ entradaMode: 'pct', entradaValue: 100, restanteCount: 3 }),
        [],
      ),
    ).toEqual([row('2026-07-29', 7300000)]);
    // A fixed entrada above the total is clamped down rather than producing a
    // negative restante, exactly as the API's materializeDefaultPaymentPlan does.
    expect(
      generateInstallmentPlan(
        7300000,
        shape({ entradaMode: 'fix', entradaValue: 99900000, restanteCount: 3 }),
        [],
      ),
    ).toEqual([row('2026-07-29', 7300000)]);
  });

  it('carries per-row payment methods positionally through regeneration', () => {
    expect(
      generateInstallmentPlan(
        7300000,
        shape({ entradaMode: 'pct', entradaValue: 50, restanteCount: 3 }),
        ['pix', 'boleto'],
      ).map((item) => item.method),
    ).toEqual(['pix', 'boleto', 'boleto', 'boleto']);
    // Positive control for the tail fill: with no methods at all every row is pix,
    // so the boletos above really came from the passed array.
    expect(
      generateInstallmentPlan(
        7300000,
        shape({ entradaMode: 'pct', entradaValue: 50, restanteCount: 3 }),
        [],
      ).map((item) => item.method),
    ).toEqual(['pix', 'pix', 'pix', 'pix']);
  });
});

describe('entradaCentsFor', () => {
  it('rounds a percentage on integer cents and clamps every mode into range', () => {
    expect(entradaCentsFor(7300000, shape({ entradaMode: 'none', entradaValue: 50 }))).toBe(0);
    expect(entradaCentsFor(7300000, shape({ entradaMode: 'pct', entradaValue: 50 }))).toBe(3650000);
    // 33.333% of 730,00 is 24333.09 cents: half-up, on integer cents.
    expect(entradaCentsFor(73000, shape({ entradaMode: 'pct', entradaValue: 33.333 }))).toBe(24333);
    expect(entradaCentsFor(73000, shape({ entradaMode: 'pct', entradaValue: 33.334 }))).toBe(24334);
    expect(entradaCentsFor(7300000, shape({ entradaMode: 'pct', entradaValue: 250 }))).toBe(7300000);
    expect(entradaCentsFor(7300000, shape({ entradaMode: 'pct', entradaValue: -10 }))).toBe(0);
    expect(entradaCentsFor(7300000, shape({ entradaMode: 'fix', entradaValue: 1000000 }))).toBe(
      1000000,
    );
    expect(entradaCentsFor(7300000, shape({ entradaMode: 'fix', entradaValue: 99900000 }))).toBe(
      7300000,
    );
  });
});

describe('inferPaymentPlanShape', () => {
  it('infers nenhuma plus N when the rows are an even split', () => {
    expect(
      inferPaymentPlanShape(
        300000,
        [row('2026-07-10', 150000), row('2026-08-10', 150000, 'boleto')],
        '2026-07-10',
      ),
    ).toEqual({
      shape: {
        entradaMode: 'none',
        entradaValue: 0,
        restanteCount: 2,
        anchorDate: '2026-07-10',
      },
      matchesFormula: true,
    });
  });

  it('infers a clean percentage entrada in preference to a fixed one', () => {
    expect(
      inferPaymentPlanShape(
        7300000,
        [
          row('2026-07-29', 3650000),
          row('2026-08-29', 1216666),
          row('2026-09-29', 1216666),
          row('2026-10-29', 1216668),
        ],
        '2026-07-29',
      ),
    ).toEqual({
      shape: {
        entradaMode: 'pct',
        entradaValue: 50,
        restanteCount: 3,
        anchorDate: '2026-07-29',
      },
      matchesFormula: true,
    });
  });

  it('infers a fixed entrada when the percentage is not clean', () => {
    /*
      100001 of 300000 is 33.3336666...%, which no operator would have typed, so the
      pct candidate is rejected as unclean. The entrada also differs from the two
      restante rows, which is what makes this distinguishable from a plain 3x split
      at all: when an entrada happens to equal the restante base, `nenhuma + N x` is
      the truthful description and is returned instead.
    */
    expect(
      inferPaymentPlanShape(
        300000,
        [row('2026-07-10', 100001), row('2026-08-10', 99999), row('2026-09-10', 100000)],
        '2026-07-10',
      ),
    ).toEqual({
      shape: {
        entradaMode: 'fix',
        entradaValue: 100001,
        restanteCount: 2,
        anchorDate: '2026-07-10',
      },
      matchesFormula: true,
    });

    // Positive control for the paragraph above: an even 3x split reads as nenhuma.
    expect(
      inferPaymentPlanShape(
        300000,
        [row('2026-07-10', 100000), row('2026-08-10', 100000), row('2026-09-10', 100000)],
        '2026-07-10',
      ).shape.entradaMode,
    ).toBe('none');
  });

  it('anchors inference on the first row rather than the proposta base date', () => {
    expect(
      inferPaymentPlanShape(
        300000,
        [row('2026-09-10', 150000), row('2026-10-10', 150000)],
        '2026-07-10',
      ),
    ).toEqual({
      shape: {
        entradaMode: 'none',
        entradaValue: 0,
        restanteCount: 2,
        anchorDate: '2026-09-10',
      },
      matchesFormula: true,
    });
  });

  it('reports matchesFormula false for a hand-edited plan and describes it best-effort', () => {
    expect(
      inferPaymentPlanShape(
        300000,
        [row('2026-07-10', 200000), row('2026-08-10', 50000), row('2026-11-30', 50000)],
        '2026-07-10',
      ),
    ).toEqual({
      shape: {
        entradaMode: 'fix',
        entradaValue: 200000,
        restanteCount: 2,
        anchorDate: '2026-07-10',
      },
      matchesFormula: false,
    });
  });

  it('recognises a clamped month-end plan the API would have written', () => {
    // Before the addMonthsToIsoDate clamp this reproduced as 2026-03-03 and the plan
    // was misread as hand-edited.
    expect(
      inferPaymentPlanShape(
        300,
        [row('2026-01-31', 100), row('2026-02-28', 100), row('2026-03-31', 100)],
        '2026-01-31',
      ).matchesFormula,
    ).toBe(true);
  });

  /*
    The API's `materializeDefaultPaymentPlan` puts the floor remainder on the FIRST
    restante row where this file puts it on the LAST. That function has no production
    caller today, so the divergence is inert, but this pins what would actually happen
    if it were wired up - and keeps the CLAUDE.md sentence describing it honest.
  */
  it('reads an API-shaped remainder-first plan the way CLAUDE.md documents', () => {
    // No entrada: the API's leading 33334 is reproduced EXACTLY by a fixed entrada of
    // 33334 plus 2 x, so this is a formula, not a hand edit. Nothing is lost; the
    // header merely calls "entrada" what the API meant as an ordinary first parcela.
    expect(
      inferPaymentPlanShape(
        100000,
        [row('2026-07-10', 33334), row('2026-08-10', 33333), row('2026-09-10', 33333)],
        '2026-07-10',
      ),
    ).toEqual({
      shape: {
        entradaMode: 'fix',
        entradaValue: 33334,
        restanteCount: 2,
        anchorDate: '2026-07-10',
      },
      matchesFormula: true,
    });

    // With an entrada there is no such reinterpretation available, so the safe branch
    // is taken and the rows are preserved verbatim.
    expect(
      inferPaymentPlanShape(
        100000,
        [
          row('2026-07-10', 50000),
          row('2026-08-10', 16668),
          row('2026-09-10', 16666),
          row('2026-10-10', 16666),
        ],
        '2026-07-10',
      ).matchesFormula,
    ).toBe(false);

    // Positive control: an evenly divisible split is byte-identical on both sides.
    expect(
      inferPaymentPlanShape(
        90000,
        [row('2026-07-10', 30000), row('2026-08-10', 30000), row('2026-09-10', 30000)],
        '2026-07-10',
      ),
    ).toEqual({
      shape: {
        entradaMode: 'none',
        entradaValue: 0,
        restanteCount: 3,
        anchorDate: '2026-07-10',
      },
      matchesFormula: true,
    });
  });

  it('returns a single-parcela default for an empty row set', () => {
    expect(inferPaymentPlanShape(500000, [], '2026-07-29')).toEqual({
      shape: {
        entradaMode: 'none',
        entradaValue: 0,
        restanteCount: 1,
        anchorDate: '2026-07-29',
      },
      matchesFormula: true,
    });
  });

  it('round-trips every shape the generator can produce', () => {
    const cases: PaymentPlanShape[] = [
      shape({ anchorDate: '2026-07-10' }),
      shape({ restanteCount: 4, anchorDate: '2026-07-10' }),
      shape({ entradaMode: 'pct', entradaValue: 50, restanteCount: 3, anchorDate: '2026-07-10' }),
      shape({ entradaMode: 'pct', entradaValue: 25, restanteCount: 6, anchorDate: '2026-01-31' }),
      shape({ entradaMode: 'fix', entradaValue: 90000, restanteCount: 2, anchorDate: '2026-07-10' }),
    ];
    for (const candidate of cases) {
      const rows = generateInstallmentPlan(300000, candidate, []);
      expect(inferPaymentPlanShape(300000, rows, '1999-01-01').matchesFormula).toBe(true);
    }
  });
});

describe('defaultPlanShapeForProduct', () => {
  it('falls back to a single cash parcela for a product with no stored template', () => {
    expect(defaultPlanShapeForProduct(undefined, '2026-07-29')).toEqual({
      entradaMode: 'none',
      entradaValue: 0,
      restanteCount: 1,
      anchorDate: '2026-07-29',
    });
    expect(defaultPlanShapeForProduct({}, '2026-07-29')).toEqual({
      entradaMode: 'none',
      entradaValue: 0,
      restanteCount: 1,
      anchorDate: '2026-07-29',
    });
  });

  it('reads the six flat default columns the produto cadastro persists', () => {
    expect(
      defaultPlanShapeForProduct(
        {
          defaultEntradaMode: 'pct',
          defaultEntradaPct: '50',
          defaultEntradaBrl: null,
          defaultRemainingInstallments: 3,
        },
        '2026-07-29',
      ),
    ).toEqual({
      entradaMode: 'pct',
      entradaValue: 50,
      restanteCount: 3,
      anchorDate: '2026-07-29',
    });
    expect(
      defaultPlanShapeForProduct(
        {
          defaultEntradaMode: 'fix',
          defaultEntradaPct: null,
          defaultEntradaBrl: 100000,
          defaultRemainingInstallments: 2,
        },
        '2026-07-29',
      ),
    ).toEqual({
      entradaMode: 'fix',
      entradaValue: 100000,
      restanteCount: 2,
      anchorDate: '2026-07-29',
    });
  });
});
