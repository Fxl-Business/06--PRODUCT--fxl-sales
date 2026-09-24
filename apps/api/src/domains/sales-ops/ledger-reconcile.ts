/**
 * The pure half of editing a proposta in place (PC2).
 *
 * `updateSale` used to delete every item, professional, receivable and payable
 * of the sale and re-insert them with fresh uuids. This module decides, from the
 * stored rows and the desired ledger, which rows to update, insert, void or
 * soft-remove, and which settled rows would block the edit. It never reads the
 * database and never reads the clock: `sale-edit-writes.ts` applies the plan.
 *
 * Identity is ALWAYS the row id the payload carries. A receivable label (`N/M`,
 * `MN/M`) renumbers when a parcela is zeroed, so it is never read for matching.
 */

export type LedgerRowKind = 'receivable' | 'payable';
export type BlockedLedgerRow = { kind: LedgerRowKind; id: string; label: string };

/** A live item or professional (`removed_at IS NULL`). */
export type ExistingLineRow = { id: string };
export type ExistingReceivableRow = {
  id: string;
  label: string;
  dueDate: string;
  amountBrl: number;
  method: string;
  status: string;
};
export type ExistingPayableRow = {
  id: string;
  kind: string;
  beneficiaryName: string;
  receivableId: string | null;
  saleProfessionalId: string | null;
  dueDate: string;
  amountBrl: number;
  status: string;
};
export type DesiredReceivable = {
  sourceId: string | null;
  label: string;
  dueDate: string;
  amountBrl: number;
  method: string;
};
export type DesiredPayable = {
  kind: string;
  beneficiaryName: string;
  receivableId: string | null;
  saleProfessionalId: string | null;
  dueDate: string;
  amountBrl: number;
};
export type FinalReceivable = {
  id: string;
  label: string;
  dueDate: string;
  amountBrl: number;
  status: string;
};

export type ReceivableWrite = {
  id: string;
  label: string;
  dueDate: string;
  amountBrl: number;
  method: string;
};
export type ReceivableUpdate = ReceivableWrite & { lockRelevant: boolean };
export type PayableWrite = DesiredPayable & { id: string };
export type PayableUpdate = PayableWrite & { lockRelevant: boolean };

export type ReceivablePlan = {
  inserts: ReceivableWrite[];
  updates: ReceivableUpdate[];
  voids: string[];
  final: FinalReceivable[];
};
export type PayablePlan = { inserts: PayableWrite[]; updates: PayableUpdate[]; voids: string[] };
export type LinePlan<T> = {
  inserts: Array<{ id: string; row: T }>;
  updates: Array<{ id: string; row: T }>;
  removes: string[];
  /** Aligned 1:1 with `desired`. */
  finalIds: string[];
};
export const EMPTY_PAYABLE_PLAN: PayablePlan = { inserts: [], updates: [], voids: [] };

const EDITABLE_STATUSES = new Set(['draft', 'open', 'won']);

/**
 * `PUT /sales/:id` status rules: `draft <-> open` stays a save, a won proposta
 * stays won, and moving into or out of `won` belongs to the transition route.
 */
export function checkEditableStatusChange(
  from: string,
  to: 'draft' | 'open' | 'won',
): { ok: true } | { ok: false; reason: 'not_editable' | 'invalid_status_change' } {
  if (!EDITABLE_STATUSES.has(from)) return { ok: false, reason: 'not_editable' };
  if ((from === 'won') !== (to === 'won')) return { ok: false, reason: 'invalid_status_change' };
  return { ok: true };
}

export function liveRowIds(state: {
  items: readonly ExistingLineRow[];
  professionals: readonly ExistingLineRow[];
  receivables: readonly ExistingReceivableRow[];
}): { itemIds: Set<string>; professionalIds: Set<string>; receivableIds: Set<string> } {
  return {
    itemIds: new Set(state.items.map((row) => row.id)),
    professionalIds: new Set(state.professionals.map((row) => row.id)),
    receivableIds: new Set(
      state.receivables.filter((row) => row.status !== 'void').map((row) => row.id),
    ),
  };
}

export type UnknownRowIdCode =
  | 'item_not_found'
  | 'professional_not_found'
  | 'installment_not_found'
  | 'recurring_row_not_found';

export function findUnknownRowId(
  payload: {
    items: ReadonlyArray<{ id?: string }>;
    professionals: ReadonlyArray<{ id?: string }>;
    installments: ReadonlyArray<{ id?: string }>;
    recurring?: { receivableIds?: readonly string[] } | null;
  },
  live: { itemIds: ReadonlySet<string>; professionalIds: ReadonlySet<string>; receivableIds: ReadonlySet<string> },
): { code: UnknownRowIdCode; index: number } | null {
  const firstUnknown = (ids: ReadonlyArray<string | undefined>, known: ReadonlySet<string>) =>
    ids.findIndex((id) => id !== undefined && !known.has(id));

  const checks: Array<[UnknownRowIdCode, ReadonlyArray<string | undefined>, ReadonlySet<string>]> = [
    ['item_not_found', payload.items.map((row) => row.id), live.itemIds],
    ['professional_not_found', payload.professionals.map((row) => row.id), live.professionalIds],
    ['installment_not_found', payload.installments.map((row) => row.id), live.receivableIds],
    ['recurring_row_not_found', payload.recurring?.receivableIds ?? [], live.receivableIds],
  ];
  for (const [code, ids, known] of checks) {
    const index = firstUnknown(ids, known);
    if (index >= 0) return { code, index };
  }
  return null;
}

export function planLineReconcile<T>(
  live: readonly ExistingLineRow[],
  desired: ReadonlyArray<{ sourceId: string | null; row: T }>,
  newId: () => string,
): LinePlan<T> {
  const plan: LinePlan<T> = { inserts: [], updates: [], removes: [], finalIds: [] };
  const claimed = new Set<string>();
  for (const entry of desired) {
    if (entry.sourceId !== null) {
      claimed.add(entry.sourceId);
      plan.updates.push({ id: entry.sourceId, row: entry.row });
      plan.finalIds.push(entry.sourceId);
    } else {
      const id = newId();
      plan.inserts.push({ id, row: entry.row });
      plan.finalIds.push(id);
    }
  }
  plan.removes = live.filter((row) => !claimed.has(row.id)).map((row) => row.id);
  return plan;
}

export function planReceivableReconcile(
  existing: readonly ExistingReceivableRow[],
  desired: readonly DesiredReceivable[],
  newId: () => string,
): ReceivablePlan {
  const liveById = new Map(
    existing.filter((row) => row.status !== 'void').map((row) => [row.id, row]),
  );
  const plan: ReceivablePlan = { inserts: [], updates: [], voids: [], final: [] };
  const claimed = new Set<string>();

  for (const want of desired) {
    const match = want.sourceId !== null ? liveById.get(want.sourceId) : undefined;
    if (match && !claimed.has(match.id)) {
      claimed.add(match.id);
      const amountChanged = match.amountBrl !== want.amountBrl;
      const dueDateChanged = match.dueDate !== want.dueDate;
      if (amountChanged || dueDateChanged || match.label !== want.label || match.method !== want.method) {
        plan.updates.push({
          id: match.id,
          label: want.label,
          dueDate: want.dueDate,
          amountBrl: want.amountBrl,
          method: want.method,
          lockRelevant: amountChanged || dueDateChanged,
        });
      }
      plan.final.push({
        id: match.id,
        label: want.label,
        dueDate: want.dueDate,
        amountBrl: want.amountBrl,
        status: match.status,
      });
      continue;
    }
    const id = newId();
    plan.inserts.push({
      id,
      label: want.label,
      dueDate: want.dueDate,
      amountBrl: want.amountBrl,
      method: want.method,
    });
    plan.final.push({ id, label: want.label, dueDate: want.dueDate, amountBrl: want.amountBrl, status: 'open' });
  }

  plan.voids = [...liveById.keys()].filter((id) => !claimed.has(id));
  return plan;
}

export function payableIdentityKey(row: {
  kind: string;
  receivableId: string | null;
  saleProfessionalId: string | null;
}): string {
  if (row.kind === 'professional_cost') {
    return `professional_cost|${row.saleProfessionalId ?? ''}|${row.receivableId ?? ''}`;
  }
  return `${row.kind}|${row.receivableId ?? ''}`;
}

function compareByDueDateThenId(
  a: { dueDate: string; id: string },
  b: { dueDate: string; id: string },
): number {
  if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

export function planPayableReconcile(
  existing: readonly ExistingPayableRow[],
  desired: readonly DesiredPayable[],
  newId: () => string,
): PayablePlan {
  // A void payable is history: never matched, revived or updated.
  const candidates = existing.filter((row) => row.status !== 'void').sort(compareByDueDateThenId);
  const claimed = new Set<string>();
  const matches: Array<ExistingPayableRow | undefined> = desired.map(() => undefined);

  desired.forEach((want, index) => {
    const key = payableIdentityKey(want);
    const match = candidates.find((row) => !claimed.has(row.id) && payableIdentityKey(row) === key);
    if (match) {
      claimed.add(match.id);
      matches[index] = match;
    }
  });

  // Legacy heal: a pre-0018 professional_cost row has no sale_professional_id.
  desired.forEach((want, index) => {
    if (matches[index] || want.kind !== 'professional_cost') return;
    const match = candidates.find(
      (row) =>
        !claimed.has(row.id) &&
        row.kind === 'professional_cost' &&
        row.saleProfessionalId === null &&
        row.receivableId === want.receivableId &&
        row.beneficiaryName === want.beneficiaryName,
    );
    if (match) {
      claimed.add(match.id);
      matches[index] = match;
    }
  });

  const plan: PayablePlan = { inserts: [], updates: [], voids: [] };
  desired.forEach((want, index) => {
    const match = matches[index];
    if (!match) {
      plan.inserts.push({ ...want, id: newId() });
      return;
    }
    // A one-shot payable keeps the won day it was written with.
    const dueDate = match.receivableId === null ? match.dueDate : want.dueDate;
    const amountChanged = match.amountBrl !== want.amountBrl;
    const dueDateChanged = match.dueDate !== dueDate;
    const changed =
      amountChanged ||
      dueDateChanged ||
      match.beneficiaryName !== want.beneficiaryName ||
      match.saleProfessionalId !== want.saleProfessionalId ||
      match.receivableId !== want.receivableId;
    if (!changed) return;
    plan.updates.push({
      id: match.id,
      kind: want.kind,
      beneficiaryName: want.beneficiaryName,
      receivableId: want.receivableId,
      saleProfessionalId: want.saleProfessionalId,
      dueDate,
      amountBrl: want.amountBrl,
      lockRelevant: amountChanged || dueDateChanged,
    });
  });

  plan.voids = candidates.filter((row) => !claimed.has(row.id)).map((row) => row.id);
  return plan;
}

/** C5 row label of a receivable: its stored label (`2/3`, `M1/12`). */
export function receivableRowLabel(row: { label: string }): string {
  return row.label;
}

/** C5 row label of a payable: `<beneficiary> (<receivable label>)`, or the beneficiary alone. */
export function payableRowLabel(
  row: { beneficiaryName: string; receivableId: string | null },
  receivableLabelById: ReadonlyMap<string, string>,
): string {
  const receivableLabel =
    row.receivableId !== null ? receivableLabelById.get(row.receivableId) : undefined;
  return receivableLabel !== undefined ? `${row.beneficiaryName} (${receivableLabel})` : row.beneficiaryName;
}

export function findBlockedRows(input: {
  existingReceivables: readonly ExistingReceivableRow[];
  existingPayables: readonly ExistingPayableRow[];
  receivables: ReceivablePlan;
  payables: PayablePlan;
  activeReceivableIds: ReadonlySet<string>;
  activePayableIds: ReadonlySet<string>;
}): BlockedLedgerRow[] {
  const touched = (plan: { updates: Array<{ id: string; lockRelevant: boolean }>; voids: string[] }) =>
    new Set([
      ...plan.voids,
      ...plan.updates.filter((row) => row.lockRelevant).map((row) => row.id),
    ]);
  const touchedReceivables = touched(input.receivables);
  const touchedPayables = touched(input.payables);
  const receivableLabelById = new Map(
    input.existingReceivables.map((row) => [row.id, receivableRowLabel(row)]),
  );

  const blocked: BlockedLedgerRow[] = [];
  for (const row of input.existingReceivables) {
    const settled = input.activeReceivableIds.has(row.id) || row.status === 'paid';
    if (settled && touchedReceivables.has(row.id)) {
      blocked.push({ kind: 'receivable', id: row.id, label: receivableRowLabel(row) });
    }
  }
  for (const row of input.existingPayables) {
    const settled = input.activePayableIds.has(row.id) || row.status === 'paid';
    if (settled && touchedPayables.has(row.id)) {
      blocked.push({ kind: 'payable', id: row.id, label: payableRowLabel(row, receivableLabelById) });
    }
  }
  return blocked;
}

export type SaleEditState = {
  items: ExistingLineRow[];
  professionals: ExistingLineRow[];
  receivables: ExistingReceivableRow[];
  payables: ExistingPayableRow[];
};

export type SaleEditPlanInput<I, P> = {
  state: SaleEditState;
  desiredItems: ReadonlyArray<{ sourceId: string | null; row: I }>;
  desiredProfessionals: ReadonlyArray<{ sourceId: string | null; row: P }>;
  desiredReceivables: readonly DesiredReceivable[];
  /**
   * null unless the stored sale is `won`. Receives the final non-void
   * receivables sorted by (dueDate asc, plan index asc) and the professional ids
   * aligned with desiredProfessionals.
   */
  derivePayables:
    | null
    | ((args: { receivables: FinalReceivable[]; professionalIds: string[] }) => DesiredPayable[]);
  activeReceivableIds: ReadonlySet<string>;
  activePayableIds: ReadonlySet<string>;
  newId: () => string;
};

export type SaleEditPlan<I, P> = {
  items: LinePlan<I>;
  professionals: LinePlan<P>;
  receivables: ReceivablePlan;
  payables: PayablePlan;
  blocked: BlockedLedgerRow[];
};

export function planSaleEdit<I, P>(input: SaleEditPlanInput<I, P>): SaleEditPlan<I, P> {
  const items = planLineReconcile(input.state.items, input.desiredItems, input.newId);
  const professionals = planLineReconcile(
    input.state.professionals,
    input.desiredProfessionals,
    input.newId,
  );
  const receivables = planReceivableReconcile(
    input.state.receivables,
    input.desiredReceivables,
    input.newId,
  );

  let payables = EMPTY_PAYABLE_PLAN;
  if (input.derivePayables) {
    // Same order transitionSale reads (`ORDER BY due_date`), ties by plan index,
    // so professional parts bind front-aligned exactly as on a win.
    const ordered = receivables.final
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.status !== 'void')
      .sort((a, b) =>
        a.row.dueDate !== b.row.dueDate ? (a.row.dueDate < b.row.dueDate ? -1 : 1) : a.index - b.index,
      )
      .map(({ row }) => row);
    const desiredPayables = input.derivePayables({
      receivables: ordered,
      professionalIds: professionals.finalIds,
    });
    payables = planPayableReconcile(input.state.payables, desiredPayables, input.newId);
  }

  const blocked = findBlockedRows({
    existingReceivables: input.state.receivables,
    existingPayables: input.state.payables,
    receivables,
    payables,
    activeReceivableIds: input.activeReceivableIds,
    activePayableIds: input.activePayableIds,
  });

  return { items, professionals, receivables, payables, blocked };
}
