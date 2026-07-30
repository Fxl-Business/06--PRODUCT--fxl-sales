/**
 * The ONE implementation of a proposta's commercial arithmetic.
 *
 * It exists because the wizard and the API used to compute the same five numbers
 * twice, with two different algorithms: the wizard rounded a percentage once over
 * the item total, the server rounded it once per receivable row and counted a
 * bounded recorrência inside the base. Any proposta with a bounded recorrência or
 * with uneven installments therefore displayed one margin and persisted another.
 *
 * The semantics below are the SERVER's algorithm, verbatim, so adopting this
 * module moved no persisted number. Every amount is integer cents; every
 * percentage is percent points (`15` means 15%).
 */

/**
 * A percentage of an amount, floored. The single rounding primitive: commissions,
 * finder commissions and tax all go through it, once per receivable row, which is
 * what makes `Σ floor(row)` and never `floor(Σ)` the rule.
 */
export function pctOfCents(amountBrl: number, ratePct: number): number {
  return Math.floor((amountBrl * ratePct) / 100);
}

export type SaleFinancialsInput = {
  /** Σ quantity × unitBrl over the proposta items, integer cents. */
  itemsTotalBrl: number;
  /** monthlyBrl × cycles when `cycles !== null`; `0` for an indefinite recorrência. */
  boundedRecurringBrl: number;
  /** Every non-void receivable amount: the installments, then the bounded recurring rows. */
  receivableAmountsBrl: number[];
  sellerCommissionPct: number;
  finderCommissionPct: number;
  /** When false the finder commission is zero regardless of `finderCommissionPct`. */
  hasFinder: boolean;
  taxPct: number;
  otherCostsBrl: number;
  professionalCostsBrl: number;
};

export type SaleFinancials = {
  totalBrl: number;
  sellerCommissionBrl: number;
  finderCommissionBrl: number;
  taxBrl: number;
  professionalCostsBrl: number;
  otherCostsBrl: number;
  netMarginBrl: number;
  /** `toFixed(2)`, the exact string `sales_ops_sales.net_margin_pct` stores. */
  netMarginPct: string;
};

export function computeSaleFinancials(input: SaleFinancialsInput): SaleFinancials {
  const totalBrl = input.itemsTotalBrl + input.boundedRecurringBrl;
  const sumPct = (ratePct: number) =>
    input.receivableAmountsBrl.reduce((sum, amountBrl) => sum + pctOfCents(amountBrl, ratePct), 0);

  const sellerCommissionBrl = sumPct(input.sellerCommissionPct);
  const finderCommissionBrl = input.hasFinder ? sumPct(input.finderCommissionPct) : 0;
  const taxBrl = sumPct(input.taxPct);
  const netMarginBrl =
    totalBrl -
    sellerCommissionBrl -
    finderCommissionBrl -
    input.professionalCostsBrl -
    input.otherCostsBrl -
    taxBrl;
  const netMarginPct = totalBrl > 0 ? ((netMarginBrl / totalBrl) * 100).toFixed(2) : '0.00';

  return {
    totalBrl,
    sellerCommissionBrl,
    finderCommissionBrl,
    taxBrl,
    professionalCostsBrl: input.professionalCostsBrl,
    otherCostsBrl: input.otherCostsBrl,
    netMarginBrl,
    netMarginPct,
  };
}
