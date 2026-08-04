/**
 * Pure arithmetic for splitting a professional's one-shot `cost_brl` across the
 * proposta's parcelas. See `nexo/plans/batch-20260804-props-costs/00-OVERVIEW-split.md`
 * (Decisions 1-3) for the full design. This module has no API, schema or UI
 * dependency by design: it is the single place the exact-sum rounding contract
 * lives, and everything downstream — `professional_cost` payable generation, the
 * wizard's split preview — is a caller of it, never a re-implementation.
 */

/** A basis-point weight vector always sums to this. `10000` === 100.00%. */
export const SPLIT_BP_TOTAL = 10_000;

/**
 * Distributes `totalCents` across `weights` so that the sum of the output is
 * EXACTLY `totalCents`, for every input. The last entry absorbs the whole floor
 * remainder — never `Math.round`, never a round-robin remainder, never a sort.
 * This generalizes `splitInstallmentsEqually`'s contract
 * (`apps/web/src/sales-ops/calculations.ts`) to arbitrary weights; the two are
 * pinned equal for equal weights by a direct test.
 *
 * Overflow: every caller in this codebase normalizes weights to basis points
 * first (`defaultSplitBp`, or a stored `cost_split_bp` array, both summing to
 * `SPLIT_BP_TOTAL`), so `totalCents * weights[i]` is at most
 * `2^31 × 10^4 ≈ 2.1 × 10^13` for a Postgres-`integer`-bounded `totalCents` —
 * comfortably inside `Number.MAX_SAFE_INTEGER` (`2^53`). `defaultSplitBp` is the
 * one place a raw (also `integer`-bounded) amount is used as a weight directly,
 * and its own total is the constant `SPLIT_BP_TOTAL`, so the same bound applies
 * there too. There is exactly one weight space in the system and it is bounded
 * by construction.
 */
export function splitCentsByWeights(totalCents: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];

  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) {
    return Array.from({ length: n }, (_, i) => (i === n - 1 ? totalCents : 0));
  }

  const out: number[] = [];
  let sumSoFar = 0;
  for (let i = 0; i < n - 1; i++) {
    const part = Math.floor((totalCents * weights[i]!) / total);
    out.push(part);
    sumSoFar += part;
  }
  out.push(totalCents - sumSoFar);
  return out;
}

/**
 * The default pro-rata split: `SPLIT_BP_TOTAL` distributed across a set of
 * receivable amounts under the same exact-sum contract. This is the ONLY place
 * a raw receivable amount is used as a split weight; see the overflow note on
 * `splitCentsByWeights`.
 */
export function defaultSplitBp(amountsBrl: number[]): number[] {
  return splitCentsByWeights(SPLIT_BP_TOTAL, amountsBrl);
}

/**
 * Character for character what `deriveWizardPrefill` already does at
 * `apps/web/src/sales-ops/SalesOpsApp.tsx`. Lives here because the API now
 * needs the same predicate; the `M` prefix is load-bearing (see CLAUDE.md).
 */
export function isRecurringReceivableLabel(label: string | null | undefined): boolean {
  return (label ?? '').startsWith('M');
}

export type SplitReceivable = {
  id: string;
  dueDate: string;
  amountBrl: number;
};

export type ProfessionalSplitPart = {
  receivableId: string | null;
  dueDate: string;
  amountBrl: number;
};

export type ResolveProfessionalSplitInput = {
  costBrl: number;
  costSplitBp: number[] | null | undefined;
  /**
   * The sale's eligible receivables. The caller is responsible for having
   * already excluded void and recurring rows — this function sorts what it is
   * given but does not filter it.
   */
  receivables: SplitReceivable[];
  fallbackDueDate: string;
};

/**
 * Resolves a professional's stored (or default) split against a sale's actual
 * parcelas. See Decision 2 in the overview doc for the front-aligned binding
 * rule and the fold behaviour when the stored split has more parts than there
 * are eligible receivables.
 */
export function resolveProfessionalSplit(
  input: ResolveProfessionalSplitInput,
): ProfessionalSplitPart[] {
  const eligible = [...input.receivables].sort((a, b) =>
    a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0,
  );

  const m = eligible.length;
  if (m === 0) {
    return [{ receivableId: null, dueDate: input.fallbackDueDate, amountBrl: input.costBrl }];
  }

  const weights =
    input.costSplitBp && input.costSplitBp.length > 0
      ? input.costSplitBp
      : defaultSplitBp(eligible.map((r) => r.amountBrl));

  const folded =
    weights.length > m
      ? [
          ...weights.slice(0, m - 1),
          weights.slice(m - 1).reduce((sum, w) => sum + w, 0),
        ]
      : weights;

  const parts = splitCentsByWeights(input.costBrl, folded);

  return parts.map((amountBrl, i) => ({
    receivableId: eligible[i]!.id,
    dueDate: eligible[i]!.dueDate,
    amountBrl,
  }));
}
