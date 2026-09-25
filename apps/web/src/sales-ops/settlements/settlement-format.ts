import type { ApiErrorRow } from '@/lib/api-client';
import type {
  SalesOpsPayable,
  SalesOpsReceivable,
  SalesOpsSale,
  SalesOpsSettlement,
  SalesOpsStatus,
} from '../types';
import { displayDate } from '../civil-day';

/**
 * Pure vocabulary of the settlement UI: row descriptions, civil-day and instant
 * formatting, and the "active baixa" rule. No React, so every rule here is
 * testable without a DOM.
 */

/*
  NOT a new helper: `displayDate` is the one civil-day formatter (string only,
  never `new Date(day)`, which is UTC midnight and prints the previous day in
  São Paulo). The alias only keeps this module's vocabulary.
*/
export { displayDate as formatCivilDay } from '../civil-day';

export type SettlementTargetKind = 'receivable' | 'payable';

/** Everything a row action needs to know about one receivable or payable. */
export type SettlementTarget = {
  kind: SettlementTargetKind;
  id: string;
  saleId: string;
  saleCode: string;
  saleStatus: SalesOpsStatus;
  description: string;
  amountBrl: number;
  status: 'open' | 'paid' | 'void';
  paidOn: string | null;
};

/** The server's `reverseSettlementSchema` cap on the estorno reason. */
export const REVERSE_REASON_MAX = 500;

/*
  Re-declared rather than imported from `SalesOpsApp.tsx` (`payableTypeMeta` is
  private there, and `SalesOpsApp.tsx` imports this module, so the reverse import
  would be a cycle). The precedent is `leads/board-ui.ts`.
*/
export const PAYABLE_KIND_LABELS: Record<string, string> = {
  seller_commission: 'Comissão do vendedor',
  finder_commission: 'Comissão do finder',
  tax: 'Imposto',
  professional_cost: 'Custo profissional',
  other_cost: 'Outros custos',
};

export function describeReceivable(row: Pick<SalesOpsReceivable, 'label' | 'dueDate'>): string {
  const label = row.label?.trim() ?? '';
  if (label.startsWith('M')) return `Recorrência ${label.slice(1)}`;
  if (label) return `Parcela ${label}`;
  return `Parcela de ${displayDate(row.dueDate)}`;
}

/**
 * `Comissão do vendedor · Ana · Parcela 1/3`. The suffix names WHICH of a
 * beneficiary's payables this is (a sale pays the same person once per
 * parcela): the linked receivable when there is one, otherwise the due day.
 * Without row context it is the kind and beneficiary alone.
 */
export function describePayable(
  row: Pick<SalesOpsPayable, 'kind' | 'beneficiaryName'> &
    Partial<Pick<SalesOpsPayable, 'receivableId' | 'dueDate'>>,
  receivableById?: ReadonlyMap<string, Pick<SalesOpsReceivable, 'label' | 'dueDate'>>,
): string {
  const base =
    row.kind === 'tax' || row.kind === 'other_cost'
      ? (PAYABLE_KIND_LABELS[row.kind] ?? '')
      : `${PAYABLE_KIND_LABELS[row.kind] ?? 'Conta a pagar'} · ${row.beneficiaryName}`;
  if (!receivableById) return base;
  const linked = row.receivableId ? receivableById.get(row.receivableId) : undefined;
  if (linked) return `${base} · ${describeReceivable(linked)}`;
  return row.dueDate ? `${base} · vencimento ${displayDate(row.dueDate)}` : base;
}

/** Receivables by id, the lookup `describePayable` names a payable's parcela from. */
export function receivablesById(
  receivables: readonly SalesOpsReceivable[],
): Map<string, SalesOpsReceivable> {
  return new Map(receivables.map((row) => [row.id, row]));
}

export function receivableSettlementTarget(
  row: SalesOpsReceivable,
  sale: SalesOpsSale,
): SettlementTarget {
  return {
    kind: 'receivable',
    id: row.id,
    saleId: sale.id,
    saleCode: sale.code,
    saleStatus: sale.status,
    description: describeReceivable(row),
    amountBrl: row.amountBrl,
    status: row.status,
    paidOn: row.paidOn ?? null,
  };
}

export function payableSettlementTarget(
  row: SalesOpsPayable & { id: string },
  sale: SalesOpsSale,
  receivableById: ReadonlyMap<string, Pick<SalesOpsReceivable, 'label' | 'dueDate'>>,
): SettlementTarget {
  return {
    kind: 'payable',
    id: row.id,
    saleId: sale.id,
    saleCode: sale.code,
    saleStatus: sale.status,
    description: describePayable(row, receivableById),
    amountBrl: row.amountBrl,
    status: row.status,
    paidOn: row.paidOn ?? null,
  };
}

/**
 * `23/09/2026 às 22:10`: the recorded INSTANT as a São Paulo wall clock. It is
 * the only date here that goes through `Intl`, and it is assembled from
 * `formatToParts` so the ICU separator cannot vary the text.
 */
export function formatRecordedAt(iso: string): string {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return `${part('day')}/${part('month')}/${part('year')} às ${part('hour')}:${part('minute')}`;
}

/**
 * The baixas of one row that no estorno cites, newest first (by `paidOn`, then
 * by `recordedAt`). Same "active" rule as the settlement reducer, which stays
 * authoritative server-side for the row's `status` and `paidOn`.
 */
export function activeBaixasFor(
  entries: readonly SalesOpsSettlement[],
  target: { kind: SettlementTargetKind; id: string },
): SalesOpsSettlement[] {
  const reversed = new Set(
    entries
      .filter((entry) => entry.type === 'estorno' && entry.reversesSettlementId !== null)
      .map((entry) => entry.reversesSettlementId),
  );
  return entries
    .filter(
      (entry) =>
        entry.type === 'baixa' &&
        (target.kind === 'receivable' ? entry.receivableId : entry.payableId) === target.id &&
        !reversed.has(entry.id),
    )
    .sort(
      (a, b) => b.paidOn.localeCompare(a.paidOn) || b.recordedAt.localeCompare(a.recordedAt),
    );
}

/** Row id to its human description, for the history and for locked-row lines. */
export function buildTargetDescriptions(
  receivables: readonly SalesOpsReceivable[],
  payables: readonly SalesOpsPayable[],
): Map<string, string> {
  const descriptions = new Map<string, string>();
  const byId = receivablesById(receivables);
  for (const row of receivables) descriptions.set(row.id, describeReceivable(row));
  for (const row of payables) {
    if (row.id) descriptions.set(row.id, describePayable(row, byId));
  }
  return descriptions;
}

/**
 * One line per row that blocked a write: the bootstrap description first, the
 * server's C5 label as the fallback (a payable's already reads `Ana (1/3)`), and
 * never the id.
 */
export function describeLockedRows(
  rows: readonly ApiErrorRow[],
  descriptions: Map<string, string>,
): string[] {
  return rows.map((row) => {
    const known = descriptions.get(row.id);
    if (known) return known;
    const label = typeof row.label === 'string' ? row.label.trim() : '';
    if (!label) return 'Linha sem rótulo';
    // A non-empty label never reaches the due-date branch of `describeReceivable`.
    return row.kind === 'receivable' ? describeReceivable({ label, dueDate: '' }) : label;
  });
}
