import { eventoDeSettlement, temBaixaAtiva } from '@fxl-sales/shared-utils/liquidacao';
import { and, asc, eq } from 'drizzle-orm';
import { salesOpsSettlements } from '../../db/schema.js';
import type { Db } from './service.js';

/**
 * The settlement facts of one sale, as the row locks read them. Shared by the
 * in-place edit (slice 04) and the leave-won / cancel-contract locks (slice 06).
 */
export type SaleSettlementRow = {
  id: string;
  targetKind: 'receivable' | 'payable';
  receivableId: string | null;
  payableId: string | null;
  type: 'baixa' | 'estorno';
  reversesSettlementId: string | null;
  paidOn: string;
  amountBrl: number;
};

export async function loadSaleSettlementRows(
  tx: Db,
  orgId: string,
  saleId: string,
): Promise<SaleSettlementRow[]> {
  const rows = await tx
    .select({
      id: salesOpsSettlements.id,
      targetKind: salesOpsSettlements.targetKind,
      receivableId: salesOpsSettlements.receivableId,
      payableId: salesOpsSettlements.payableId,
      type: salesOpsSettlements.type,
      reversesSettlementId: salesOpsSettlements.reversesSettlementId,
      paidOn: salesOpsSettlements.paidOn,
      amountBrl: salesOpsSettlements.amountBrl,
    })
    .from(salesOpsSettlements)
    .where(and(eq(salesOpsSettlements.orgId, orgId), eq(salesOpsSettlements.saleId, saleId)))
    .orderBy(asc(salesOpsSettlements.recordedAt), asc(salesOpsSettlements.id));
  // The table CHECKs pin target_kind and type to these literals.
  return rows.map((row) => ({
    ...row,
    targetKind: row.targetKind as SaleSettlementRow['targetKind'],
    type: row.type as SaleSettlementRow['type'],
  }));
}

/**
 * The receivables and payables that carry an active baixa, through the ONE
 * shared reducer. A malformed history throws (answered 500): a corrupt history
 * must never read as "unlocked".
 */
export function activeSettlementTargetIds(rows: readonly SaleSettlementRow[]): {
  receivableIds: Set<string>;
  payableIds: Set<string>;
} {
  const groups = new Map<string, { kind: SaleSettlementRow['targetKind']; rows: SaleSettlementRow[] }>();
  for (const row of rows) {
    const targetId = row.receivableId ?? row.payableId;
    if (targetId === null) continue;
    const group = groups.get(targetId);
    if (group) group.rows.push(row);
    else groups.set(targetId, { kind: row.targetKind, rows: [row] });
  }

  const receivableIds = new Set<string>();
  const payableIds = new Set<string>();
  for (const [targetId, group] of groups) {
    if (!temBaixaAtiva(group.rows.map(eventoDeSettlement))) continue;
    if (group.kind === 'receivable') receivableIds.add(targetId);
    else payableIds.add(targetId);
  }
  return { receivableIds, payableIds };
}
