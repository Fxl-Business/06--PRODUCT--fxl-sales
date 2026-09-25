import type { SalesOpsPayable, SalesOpsReceivable } from './types';
import { civilDayOf } from './civil-day';

/**
 * The ONE display order of ledger rows.
 *
 * The bootstrap reads receivables and payables with no ORDER BY, and a baixa or
 * estorno UPDATEs the row, which moves its heap tuple: rendered verbatim, the row
 * the operator just settled jumps to the end of its list. Every ledger table
 * therefore sorts through these comparators, which read only fields a settlement
 * never writes (due day, label, kind, beneficiary) and end on the id so the
 * order is total.
 */

export function compareReceivables(
  a: Pick<SalesOpsReceivable, 'dueDate' | 'label' | 'id'>,
  b: Pick<SalesOpsReceivable, 'dueDate' | 'label' | 'id'>,
): number {
  return (
    civilDayOf(a.dueDate).localeCompare(civilDayOf(b.dueDate)) ||
    (a.label ?? '').localeCompare(b.label ?? '') ||
    a.id.localeCompare(b.id)
  );
}

/** Commissions first, then tax, then costs: the order the proposta computes them. */
const PAYABLE_KIND_RANK: Record<string, number> = {
  seller_commission: 0,
  finder_commission: 1,
  tax: 2,
  professional_cost: 3,
  other_cost: 4,
};

function kindRank(kind: string): number {
  return PAYABLE_KIND_RANK[kind] ?? Object.keys(PAYABLE_KIND_RANK).length;
}

export function comparePayables(
  a: Pick<SalesOpsPayable, 'dueDate' | 'kind' | 'beneficiaryName' | 'id'>,
  b: Pick<SalesOpsPayable, 'dueDate' | 'kind' | 'beneficiaryName' | 'id'>,
): number {
  return (
    civilDayOf(a.dueDate).localeCompare(civilDayOf(b.dueDate)) ||
    kindRank(a.kind) - kindRank(b.kind) ||
    a.kind.localeCompare(b.kind) ||
    a.beneficiaryName.localeCompare(b.beneficiaryName, 'pt-BR') ||
    (a.id ?? '').localeCompare(b.id ?? '')
  );
}
