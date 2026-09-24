import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import {
  salesOpsPayables,
  salesOpsReceivables,
  salesOpsSaleItems,
  salesOpsSaleProfessionals,
} from '../../db/schema.js';
import { asDateOnly, dateFromIsoDay } from './ledger-dates.js';
import type { SaleEditPlan, SaleEditState } from './ledger-reconcile.js';
import { payableRevisionBump, receivableRevisionBump } from './ledger-revision.js';
import type { Db, SaleLedger } from './service.js';
import { loadSaleSettlementRows, type SaleSettlementRow } from './settlement-locks.js';

/**
 * The database half of editing a proposta in place (PC2). `ledger-reconcile.ts`
 * decides; this file reads the stored rows and applies the plan. It never
 * deletes a ledger row: what leaves the plan is voided (receivables, payables)
 * or soft-removed with `removed_at` (items, professionals).
 */
export async function loadSaleEditState(
  tx: Db,
  orgId: string,
  saleId: string,
): Promise<SaleEditState & { settlements: SaleSettlementRow[] }> {
  const items = await tx
    .select({ id: salesOpsSaleItems.id })
    .from(salesOpsSaleItems)
    .where(
      and(
        eq(salesOpsSaleItems.orgId, orgId),
        eq(salesOpsSaleItems.saleId, saleId),
        isNull(salesOpsSaleItems.removedAt),
      ),
    );
  const professionals = await tx
    .select({ id: salesOpsSaleProfessionals.id })
    .from(salesOpsSaleProfessionals)
    .where(
      and(
        eq(salesOpsSaleProfessionals.orgId, orgId),
        eq(salesOpsSaleProfessionals.saleId, saleId),
        isNull(salesOpsSaleProfessionals.removedAt),
      ),
    );
  const receivableRows = await tx
    .select({
      id: salesOpsReceivables.id,
      label: salesOpsReceivables.label,
      dueDate: salesOpsReceivables.dueDate,
      amountBrl: salesOpsReceivables.amountBrl,
      method: salesOpsReceivables.method,
      status: salesOpsReceivables.status,
    })
    .from(salesOpsReceivables)
    .where(and(eq(salesOpsReceivables.orgId, orgId), eq(salesOpsReceivables.saleId, saleId)))
    .orderBy(asc(salesOpsReceivables.dueDate), asc(salesOpsReceivables.id));
  const payableRows = await tx
    .select({
      id: salesOpsPayables.id,
      kind: salesOpsPayables.kind,
      beneficiaryName: salesOpsPayables.beneficiaryName,
      receivableId: salesOpsPayables.receivableId,
      saleProfessionalId: salesOpsPayables.saleProfessionalId,
      dueDate: salesOpsPayables.dueDate,
      amountBrl: salesOpsPayables.amountBrl,
      status: salesOpsPayables.status,
    })
    .from(salesOpsPayables)
    .where(and(eq(salesOpsPayables.orgId, orgId), eq(salesOpsPayables.saleId, saleId)))
    .orderBy(asc(salesOpsPayables.dueDate), asc(salesOpsPayables.id));
  const settlements = await loadSaleSettlementRows(tx, orgId, saleId);

  return {
    items,
    professionals,
    receivables: receivableRows.map((row) => ({ ...row, dueDate: asDateOnly(row.dueDate) })),
    payables: payableRows.map((row) => ({ ...row, dueDate: asDateOnly(row.dueDate) })),
    settlements,
  };
}

type ItemRow = SaleLedger['items'][number];
type ProfessionalRow = SaleLedger['professionals'][number];

function itemColumns(row: ItemRow) {
  return {
    productId: row.productId ?? null,
    productNameSnapshot: row.productNameSnapshot,
    productTypeSnapshot: row.productTypeSnapshot,
    areaId: row.areaId,
    areaNameSnapshot: row.areaNameSnapshot,
    quantity: row.quantity,
    unitBrl: row.unitBrl,
    subtotalBrl: row.subtotalBrl,
  };
}

function professionalColumns(row: ProfessionalRow) {
  return {
    personId: row.personId ?? null,
    personNameSnapshot: row.personNameSnapshot,
    funcaoId: row.funcaoId,
    funcaoNameSnapshot: row.funcaoNameSnapshot,
    role: row.role,
    costBrl: row.costBrl,
    costSplitBp: row.costSplitBp,
  };
}

/**
 * Applies a reconcile plan. Order matters for the FKs: professionals before
 * payables (sale_professional_id) and receivables before payables
 * (receivable_id). Every WHERE carries the org and the sale.
 */
export async function applySaleEditPlan(
  tx: Db,
  orgId: string,
  saleId: string,
  plan: SaleEditPlan<ItemRow, ProfessionalRow>,
  now: Date,
): Promise<void> {
  for (const { id, row } of plan.items.updates) {
    await tx
      .update(salesOpsSaleItems)
      .set(itemColumns(row))
      .where(
        and(
          eq(salesOpsSaleItems.orgId, orgId),
          eq(salesOpsSaleItems.saleId, saleId),
          eq(salesOpsSaleItems.id, id),
        ),
      );
  }
  if (plan.items.inserts.length > 0) {
    await tx
      .insert(salesOpsSaleItems)
      .values(plan.items.inserts.map(({ id, row }) => ({ id, orgId, saleId, ...itemColumns(row) })));
  }
  if (plan.items.removes.length > 0) {
    await tx
      .update(salesOpsSaleItems)
      .set({ removedAt: now })
      .where(
        and(
          eq(salesOpsSaleItems.orgId, orgId),
          eq(salesOpsSaleItems.saleId, saleId),
          inArray(salesOpsSaleItems.id, plan.items.removes),
          isNull(salesOpsSaleItems.removedAt),
        ),
      );
  }

  for (const { id, row } of plan.professionals.updates) {
    await tx
      .update(salesOpsSaleProfessionals)
      .set(professionalColumns(row))
      .where(
        and(
          eq(salesOpsSaleProfessionals.orgId, orgId),
          eq(salesOpsSaleProfessionals.saleId, saleId),
          eq(salesOpsSaleProfessionals.id, id),
        ),
      );
  }
  if (plan.professionals.inserts.length > 0) {
    await tx.insert(salesOpsSaleProfessionals).values(
      plan.professionals.inserts.map(({ id, row }) => ({
        id,
        orgId,
        saleId,
        ...professionalColumns(row),
      })),
    );
  }
  if (plan.professionals.removes.length > 0) {
    await tx
      .update(salesOpsSaleProfessionals)
      .set({ removedAt: now })
      .where(
        and(
          eq(salesOpsSaleProfessionals.orgId, orgId),
          eq(salesOpsSaleProfessionals.saleId, saleId),
          inArray(salesOpsSaleProfessionals.id, plan.professionals.removes),
          isNull(salesOpsSaleProfessionals.removedAt),
        ),
      );
  }

  if (plan.receivables.inserts.length > 0) {
    await tx.insert(salesOpsReceivables).values(
      plan.receivables.inserts.map((row) => ({
        id: row.id,
        orgId,
        saleId,
        label: row.label,
        dueDate: dateFromIsoDay(row.dueDate),
        amountBrl: row.amountBrl,
        method: row.method,
        status: 'open',
      })),
    );
  }
  for (const row of plan.receivables.updates) {
    await tx
      .update(salesOpsReceivables)
      .set({
        label: row.label,
        dueDate: dateFromIsoDay(row.dueDate),
        amountBrl: row.amountBrl,
        method: row.method,
        ...receivableRevisionBump(),
      })
      .where(
        and(
          eq(salesOpsReceivables.orgId, orgId),
          eq(salesOpsReceivables.saleId, saleId),
          eq(salesOpsReceivables.id, row.id),
        ),
      );
  }
  if (plan.receivables.voids.length > 0) {
    await tx
      .update(salesOpsReceivables)
      .set({ status: 'void', ...receivableRevisionBump() })
      .where(
        and(
          eq(salesOpsReceivables.orgId, orgId),
          eq(salesOpsReceivables.saleId, saleId),
          inArray(salesOpsReceivables.id, plan.receivables.voids),
          ne(salesOpsReceivables.status, 'void'),
        ),
      );
  }

  if (plan.payables.inserts.length > 0) {
    await tx.insert(salesOpsPayables).values(
      plan.payables.inserts.map((row) => ({
        id: row.id,
        orgId,
        saleId,
        beneficiaryName: row.beneficiaryName,
        kind: row.kind,
        receivableId: row.receivableId,
        saleProfessionalId: row.saleProfessionalId,
        dueDate: dateFromIsoDay(row.dueDate),
        amountBrl: row.amountBrl,
        status: 'open',
      })),
    );
  }
  for (const row of plan.payables.updates) {
    await tx
      .update(salesOpsPayables)
      .set({
        beneficiaryName: row.beneficiaryName,
        kind: row.kind,
        receivableId: row.receivableId,
        saleProfessionalId: row.saleProfessionalId,
        dueDate: dateFromIsoDay(row.dueDate),
        amountBrl: row.amountBrl,
        ...payableRevisionBump(),
      })
      .where(
        and(
          eq(salesOpsPayables.orgId, orgId),
          eq(salesOpsPayables.saleId, saleId),
          eq(salesOpsPayables.id, row.id),
        ),
      );
  }
  if (plan.payables.voids.length > 0) {
    await tx
      .update(salesOpsPayables)
      .set({ status: 'void', ...payableRevisionBump() })
      .where(
        and(
          eq(salesOpsPayables.orgId, orgId),
          eq(salesOpsPayables.saleId, saleId),
          inArray(salesOpsPayables.id, plan.payables.voids),
          ne(salesOpsPayables.status, 'void'),
        ),
      );
  }
}
