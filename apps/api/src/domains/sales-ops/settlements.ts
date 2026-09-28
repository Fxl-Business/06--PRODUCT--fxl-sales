import {
  eventoDeSettlement,
  reduzirLiquidacao,
  statusCacheDaLinha,
  validarEstorno,
  validarNovaBaixa,
  type Liquidacao,
  type LiquidacaoEvento,
  type StatusLinhaLiquidavel,
  type StatusVendaLiquidavel,
} from '@fxl-sales/shared-utils/liquidacao';
import { isIsoDay, todayInSaoPaulo } from '@fxl-sales/shared-utils/sao-paulo-day';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  salesOpsPayables,
  salesOpsReceivables,
  salesOpsSales,
  salesOpsSettlements,
} from '../../db/schema.js';
import {
  payableRowLabel,
  receivableRowLabel,
  type BlockedLedgerRow,
} from './ledger-reconcile.js';
import { payableRevisionBump, receivableRevisionBump } from './ledger-revision.js';
import type { CadastroActor, Db } from './service.js';
import { withTenant } from './service.js';
import { activeSettlementTargetIds, loadSaleSettlementRows } from './settlement-locks.js';

/**
 * Baixas and estornos (C6). The ONLY writer of `sales_ops_settlements` and of
 * the `paid` status cache of receivables and payables. Every rule comes from
 * the shared reducer in `@fxl-sales/shared-utils/liquidacao`; this module only
 * reads, locks, calls it and writes the verdict.
 */

export type SettlementTargetKind = 'receivable' | 'payable';
export type SettlementType = 'baixa' | 'estorno';
export const SETTLEMENT_REASON_MAX = 500;

export const RecordSettlementSchema = z
  .object({
    targetKind: z.enum(['receivable', 'payable']),
    targetId: z.string().uuid(),
    paidOn: z.string().optional(),
  })
  .strict();

export const ReverseSettlementSchema = z
  .object({ reason: z.string().trim().max(SETTLEMENT_REASON_MAX).optional() })
  .strict();

export type SettlementErrorCode =
  | 'not_found'
  | 'sale_not_won'
  | 'row_void'
  | 'already_paid'
  | 'already_reversed'
  | 'invalid_paid_on'
  | 'paid_on_in_future'
  | 'invalid_amount';

export const SETTLEMENT_ERROR_STATUS: Record<SettlementErrorCode, 404 | 409 | 422> = {
  not_found: 404,
  sale_not_won: 409,
  row_void: 409,
  already_paid: 409,
  already_reversed: 409,
  invalid_paid_on: 422,
  paid_on_in_future: 422,
  invalid_amount: 422,
};

/** C5 row shape of `sale_has_active_settlements`: slice 04's type, one vocabulary. */
export type ActiveSettlementRow = BlockedLedgerRow;

/** C6 history entry. `actor_user_id` is never projected. */
export type SettlementEntry = {
  id: string;
  saleId: string;
  targetKind: SettlementTargetKind;
  receivableId: string | null;
  payableId: string | null;
  type: SettlementType;
  reversesSettlementId: string | null;
  reversedBySettlementId: string | null;
  paidOn: string;
  amountBrl: number;
  origin: 'manual' | 'finance';
  actorName: string | null;
  recordedAt: string;
  reason: string | null;
};

export type SettledRowState = {
  kind: SettlementTargetKind;
  id: string;
  status: 'open' | 'paid' | 'void';
  revision: number;
  updatedAt: string;
  paidOn: string | null;
};

export type SettlementWriteResult =
  | { ok: true; settlement: SettlementEntry; row: SettledRowState }
  | { ok: false; reason: SettlementErrorCode };

export type SettlementFactRow = typeof salesOpsSettlements.$inferSelect;

type FactLike = {
  id: string;
  type: string;
  reversesSettlementId: string | null;
  paidOn: string | Date;
  amountBrl: number;
  receivableId: string | null;
  payableId: string | null;
};

export function toIsoDay(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

export function toEvent(fact: FactLike): LiquidacaoEvento {
  return eventoDeSettlement({ ...fact, paidOn: toIsoDay(fact.paidOn) });
}

export function liquidacaoDaLinha(amountBrl: number, facts: readonly FactLike[]): Liquidacao {
  return reduzirLiquidacao({ valorOriginalCentavos: amountBrl, eventos: facts.map(toEvent) });
}

function toIsoInstant(value: Date | string | null): string {
  if (value === null) return new Date(0).toISOString();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function toEntry(row: SettlementFactRow, reversedBySettlementId: string | null): SettlementEntry {
  return {
    id: row.id,
    saleId: row.saleId,
    targetKind: row.targetKind as SettlementTargetKind,
    receivableId: row.receivableId,
    payableId: row.payableId,
    type: row.type as SettlementType,
    reversesSettlementId: row.reversesSettlementId,
    reversedBySettlementId,
    paidOn: toIsoDay(row.paidOn),
    amountBrl: row.amountBrl,
    origin: row.origin as SettlementEntry['origin'],
    actorName: row.actorName,
    recordedAt: toIsoInstant(row.recordedAt),
    reason: row.reason,
  };
}

/** Adds the reducer's `paidOn` to bootstrap rows from ONE org-wide facts list. */
export function attachSettlementState<T extends { id: string; amountBrl: number }>(
  rows: T[],
  facts: readonly FactLike[],
  kind: SettlementTargetKind,
): Array<T & { paidOn: string | null }> {
  const groups = new Map<string, FactLike[]>();
  for (const fact of facts) {
    const targetId = kind === 'receivable' ? fact.receivableId : fact.payableId;
    if (targetId === null) continue;
    const group = groups.get(targetId);
    if (group) group.push(fact);
    else groups.set(targetId, [fact]);
  }
  return rows.map((row) => {
    const group = groups.get(row.id);
    return {
      ...row,
      paidOn: group ? liquidacaoDaLinha(row.amountBrl, group).dataUltimoPagamento : null,
    };
  });
}

/** A UNIQUE violation of `reverses_settlement_id` (two estornos racing on one baixa). */
export function isReversesUniqueViolation(error: unknown): boolean {
  const candidates = [error, (error as { cause?: unknown } | null)?.cause];
  for (const candidate of candidates) {
    const pgError = candidate as
      | { code?: string; constraint_name?: string; constraint?: string }
      | null
      | undefined;
    if (!pgError || pgError.code !== '23505') continue;
    const constraint = pgError.constraint_name ?? pgError.constraint ?? '';
    if (constraint.includes('reverses_settlement') || constraint.includes('one_estorno_per_baixa')) {
      return true;
    }
  }
  return false;
}

export async function selectOrgSettlements(tx: Db, orgId: string): Promise<SettlementFactRow[]> {
  return tx.select().from(salesOpsSettlements).where(eq(salesOpsSettlements.orgId, orgId));
}

async function selectSaleSettlements(
  tx: Db,
  orgId: string,
  saleId: string,
): Promise<SettlementFactRow[]> {
  return tx
    .select()
    .from(salesOpsSettlements)
    .where(and(eq(salesOpsSettlements.orgId, orgId), eq(salesOpsSettlements.saleId, saleId)))
    .orderBy(desc(salesOpsSettlements.recordedAt), desc(salesOpsSettlements.id));
}

/**
 * The rows of a sale that carry an active baixa, labelled with the C5 labels.
 * `scope` narrows to the rows a caller would touch (cancel-contract).
 */
export async function findActiveSettlementRows(
  tx: Db,
  orgId: string,
  saleId: string,
  scope?: { receivableIds?: readonly string[]; payableIds?: readonly string[] },
): Promise<ActiveSettlementRow[]> {
  const facts = await loadSaleSettlementRows(tx, orgId, saleId);
  if (facts.length === 0) return [];
  const active = activeSettlementTargetIds(facts);
  const inScope = (ids: Set<string>, allowed: readonly string[] | undefined) =>
    [...ids].filter((id) => (scope ? (allowed ?? []).includes(id) : true));
  const receivableIds = inScope(active.receivableIds, scope?.receivableIds);
  const payableIds = inScope(active.payableIds, scope?.payableIds);
  if (receivableIds.length === 0 && payableIds.length === 0) return [];

  const receivables = await tx
    .select({
      id: salesOpsReceivables.id,
      label: salesOpsReceivables.label,
    })
    .from(salesOpsReceivables)
    .where(and(eq(salesOpsReceivables.orgId, orgId), eq(salesOpsReceivables.saleId, saleId)))
    .orderBy(asc(salesOpsReceivables.dueDate), asc(salesOpsReceivables.id));
  const receivableLabelById = new Map(receivables.map((row) => [row.id, receivableRowLabel(row)]));

  const rows: ActiveSettlementRow[] = receivables
    .filter((row) => receivableIds.includes(row.id))
    .map((row) => ({ kind: 'receivable', id: row.id, label: receivableRowLabel(row) }));

  if (payableIds.length > 0) {
    const payables = await tx
      .select({
        id: salesOpsPayables.id,
        beneficiaryName: salesOpsPayables.beneficiaryName,
        receivableId: salesOpsPayables.receivableId,
      })
      .from(salesOpsPayables)
      .where(
        and(
          eq(salesOpsPayables.orgId, orgId),
          eq(salesOpsPayables.saleId, saleId),
          inArray(salesOpsPayables.id, payableIds),
        ),
      )
      .orderBy(asc(salesOpsPayables.dueDate), asc(salesOpsPayables.id));
    for (const row of payables) {
      rows.push({ kind: 'payable', id: row.id, label: payableRowLabel(row, receivableLabelById) });
    }
  }
  return rows;
}

type TargetRow = {
  id: string;
  saleId: string;
  amountBrl: number;
  status: string;
  revision: number;
  updatedAt: Date | null;
};

function targetTable(kind: SettlementTargetKind) {
  return kind === 'receivable' ? salesOpsReceivables : salesOpsPayables;
}

async function lockSaleForShare(tx: Db, orgId: string, saleId: string) {
  const [sale] = await tx
    .select({ status: salesOpsSales.status })
    .from(salesOpsSales)
    .where(and(eq(salesOpsSales.orgId, orgId), eq(salesOpsSales.id, saleId)))
    .for('share')
    .limit(1);
  return sale;
}

async function lockTargetRow(
  tx: Db,
  orgId: string,
  kind: SettlementTargetKind,
  targetId: string,
): Promise<TargetRow | undefined> {
  const table = targetTable(kind);
  const [row] = await tx
    .select({
      id: table.id,
      saleId: table.saleId,
      amountBrl: table.amountBrl,
      status: table.status,
      revision: table.revision,
      updatedAt: table.updatedAt,
    })
    .from(table)
    .where(and(eq(table.orgId, orgId), eq(table.id, targetId)))
    .for('update')
    .limit(1);
  return row;
}

async function selectTargetFacts(
  tx: Db,
  orgId: string,
  kind: SettlementTargetKind,
  targetId: string,
): Promise<SettlementFactRow[]> {
  const column =
    kind === 'receivable' ? salesOpsSettlements.receivableId : salesOpsSettlements.payableId;
  return tx
    .select()
    .from(salesOpsSettlements)
    .where(and(eq(salesOpsSettlements.orgId, orgId), eq(column, targetId)))
    .orderBy(asc(salesOpsSettlements.recordedAt), asc(salesOpsSettlements.id));
}

/** Writes the reducer's status cache with `revision + 1`, only when it changes (C7). */
async function writeStatusCache(
  tx: Db,
  orgId: string,
  kind: SettlementTargetKind,
  row: TargetRow,
  facts: readonly SettlementFactRow[],
): Promise<SettledRowState> {
  const after = liquidacaoDaLinha(row.amountBrl, facts);
  const current = row.status as StatusLinhaLiquidavel;
  const next = statusCacheDaLinha(current, after);
  let status: StatusLinhaLiquidavel = current;
  let revision = row.revision;
  let updatedAt = row.updatedAt;
  if (next !== current) {
    if (kind === 'receivable') {
      const [updated] = await tx
        .update(salesOpsReceivables)
        .set({ status: next, ...receivableRevisionBump() })
        .where(and(eq(salesOpsReceivables.orgId, orgId), eq(salesOpsReceivables.id, row.id)))
        .returning({
          status: salesOpsReceivables.status,
          revision: salesOpsReceivables.revision,
          updatedAt: salesOpsReceivables.updatedAt,
        });
      status = updated!.status as StatusLinhaLiquidavel;
      revision = updated!.revision;
      updatedAt = updated!.updatedAt;
    } else {
      const [updated] = await tx
        .update(salesOpsPayables)
        .set({ status: next, ...payableRevisionBump() })
        .where(and(eq(salesOpsPayables.orgId, orgId), eq(salesOpsPayables.id, row.id)))
        .returning({
          status: salesOpsPayables.status,
          revision: salesOpsPayables.revision,
          updatedAt: salesOpsPayables.updatedAt,
        });
      status = updated!.status as StatusLinhaLiquidavel;
      revision = updated!.revision;
      updatedAt = updated!.updatedAt;
    }
  }
  return {
    kind,
    id: row.id,
    status,
    revision,
    updatedAt: toIsoInstant(updatedAt),
    paidOn: after.dataUltimoPagamento,
  };
}

/**
 * Acceptance policy of the ONE baixa/estorno writers. `manual` runs the shared
 * validators exactly as the HTTP routes always did. `finance` records an
 * immutable remote fact: structural checks only (a real SP civil day, never in
 * the future, safe integer cents), never `sale_not_won`, `row_void` or
 * `already_paid`, so a duplicate or a settlement on a voided row is kept and
 * later derived as `duplicidade` / `disputed`.
 */
export type SettlementPolicy = { mode: 'manual' } | { mode: 'finance'; amountCents: number };

export type ApplyBaixaInput = {
  target: { kind: SettlementTargetKind; id: string };
  paidOn: string;
  /** São Paulo today; the caller passes it, this module never reads the clock. */
  today: string;
  origin: 'manual' | 'finance';
  actor: CadastroActor;
  /** Finance only: the remote settlement uuid reused as the local row id. */
  id?: string;
};

export type ApplyEstornoInput = {
  baixaId: string;
  reversedOn: string;
  today: string;
  origin: 'manual' | 'finance';
  actor: CadastroActor;
  reason: string | null;
  /** Finance only: the remote reversal uuid reused as the local row id. */
  id?: string;
};

function isSafePositiveCents(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/**
 * The ONE baixa writer. `tx` already carries the tenant context (withTenant, or
 * `setTenantContext` in the consumer handler). Emission-free by design.
 */
export async function applyBaixaTx(
  tx: Db,
  orgId: string,
  input: ApplyBaixaInput,
  policy: SettlementPolicy,
): Promise<SettlementWriteResult> {
  const kind = input.target.kind;
  const table = targetTable(kind);
  const [target] = await tx
    .select({ saleId: table.saleId })
    .from(table)
    .where(and(eq(table.orgId, orgId), eq(table.id, input.target.id)))
    .limit(1);
  if (!target) return { ok: false, reason: 'not_found' };

  // Lock order: sale (FOR SHARE) then row (FOR UPDATE), like every sale write.
  const sale = await lockSaleForShare(tx, orgId, target.saleId);
  if (!sale) return { ok: false, reason: 'not_found' };
  const row = await lockTargetRow(tx, orgId, kind, input.target.id);
  if (!row) return { ok: false, reason: 'not_found' };

  const facts = await selectTargetFacts(tx, orgId, kind, row.id);
  let paidOn: string;
  let amountBrl: number;
  if (policy.mode === 'manual') {
    const verdict = validarNovaBaixa({
      valorOriginalCentavos: row.amountBrl,
      eventos: facts.map(toEvent),
      statusLinha: row.status as StatusLinhaLiquidavel,
      statusVenda: sale.status as StatusVendaLiquidavel,
      dataPagamento: input.paidOn,
      hojeSaoPaulo: input.today,
    });
    if (!verdict.ok) return { ok: false, reason: verdict.codigo };
    paidOn = verdict.data;
    amountBrl = verdict.valorCentavos;
  } else {
    if (!isIsoDay(input.paidOn)) return { ok: false, reason: 'invalid_paid_on' };
    if (input.paidOn > input.today) return { ok: false, reason: 'paid_on_in_future' };
    if (!isSafePositiveCents(policy.amountCents)) return { ok: false, reason: 'invalid_amount' };
    paidOn = input.paidOn;
    amountBrl = policy.amountCents;
  }

  const [inserted] = await tx
    .insert(salesOpsSettlements)
    .values({
      ...(input.id !== undefined ? { id: input.id } : {}),
      orgId,
      saleId: row.saleId,
      targetKind: kind,
      receivableId: kind === 'receivable' ? row.id : null,
      payableId: kind === 'payable' ? row.id : null,
      type: 'baixa',
      reversesSettlementId: null,
      paidOn,
      amountBrl,
      origin: input.origin,
      actorUserId: input.actor.userId,
      actorName: input.actor.displayName,
      reason: null,
    })
    .returning();
  const state = await writeStatusCache(tx, orgId, kind, row, [...facts, inserted!]);
  // SLICE-07-EMISSION-HOOK (baixa): slice 07 fills this spot, gated on
  // `policy.mode === 'manual'`. Nothing may be enqueued from here in slice 04.
  return { ok: true, settlement: toEntry(inserted!, null), row: state };
}

/** The ONE estorno writer. Same contract as `applyBaixaTx`. */
export async function applyEstornoTx(
  tx: Db,
  orgId: string,
  input: ApplyEstornoInput,
  policy: SettlementPolicy,
): Promise<SettlementWriteResult> {
  const [baixa] = await tx
    .select()
    .from(salesOpsSettlements)
    .where(and(eq(salesOpsSettlements.orgId, orgId), eq(salesOpsSettlements.id, input.baixaId)))
    .limit(1);
  if (!baixa) return { ok: false, reason: 'not_found' };
  const kind = baixa.targetKind as SettlementTargetKind;
  const targetId = kind === 'receivable' ? baixa.receivableId : baixa.payableId;
  if (targetId === null) return { ok: false, reason: 'not_found' };

  const sale = await lockSaleForShare(tx, orgId, baixa.saleId);
  if (!sale) return { ok: false, reason: 'not_found' };
  const row = await lockTargetRow(tx, orgId, kind, targetId);
  if (!row) return { ok: false, reason: 'not_found' };

  const facts = await selectTargetFacts(tx, orgId, kind, targetId);
  let estornaBaixaId: string;
  let paidOn: string;
  let amountBrl: number;
  if (policy.mode === 'manual') {
    const verdict = validarEstorno({
      baixaId: input.baixaId,
      eventos: facts.map(toEvent),
      hojeSaoPaulo: input.today,
    });
    if (!verdict.ok) return { ok: false, reason: verdict.codigo };
    estornaBaixaId = verdict.estornaBaixaId;
    paidOn = verdict.data;
    amountBrl = verdict.valorCentavos;
  } else {
    if (baixa.type !== 'baixa') return { ok: false, reason: 'not_found' };
    if (!isIsoDay(input.reversedOn)) return { ok: false, reason: 'invalid_paid_on' };
    if (input.reversedOn > input.today) return { ok: false, reason: 'paid_on_in_future' };
    if (facts.some((fact) => fact.reversesSettlementId === baixa.id)) {
      return { ok: false, reason: 'already_reversed' };
    }
    if (!isSafePositiveCents(policy.amountCents) || policy.amountCents !== baixa.amountBrl) {
      return { ok: false, reason: 'invalid_amount' };
    }
    estornaBaixaId = baixa.id;
    paidOn = input.reversedOn;
    amountBrl = baixa.amountBrl;
  }

  const [inserted] = await tx
    .insert(salesOpsSettlements)
    .values({
      ...(input.id !== undefined ? { id: input.id } : {}),
      orgId,
      saleId: baixa.saleId,
      targetKind: kind,
      receivableId: baixa.receivableId,
      payableId: baixa.payableId,
      type: 'estorno',
      reversesSettlementId: estornaBaixaId,
      paidOn,
      amountBrl,
      origin: input.origin,
      actorUserId: input.actor.userId,
      actorName: input.actor.displayName,
      reason: input.reason,
    })
    .returning();
  const state = await writeStatusCache(tx, orgId, kind, row, [...facts, inserted!]);
  // SLICE-07-EMISSION-HOOK (estorno): slice 07 fills this spot, gated on
  // `policy.mode === 'manual'`. Nothing may be enqueued from here in slice 04.
  return { ok: true, settlement: toEntry(inserted!, null), row: state };
}

export type SettlementAnomaly = 'none' | 'disputed' | 'duplicidade';

/**
 * Pure derivation from the row's Sales-owned status and its immutable facts.
 * `disputed`: an active baixa on a voided row. `duplicidade`: overpaid through
 * more than one active baixa. No column, no enum: recoverable from the facts.
 */
export function deriveSettlementAnomaly(
  rowStatus: StatusLinhaLiquidavel,
  amountBrl: number,
  facts: readonly FactLike[],
): SettlementAnomaly {
  const liquidacao = liquidacaoDaLinha(amountBrl, facts);
  if (rowStatus === 'void') return liquidacao.baixasAtivas.length > 0 ? 'disputed' : 'none';
  if (liquidacao.pagoCentavos > amountBrl && liquidacao.baixasAtivas.length > 1) {
    return 'duplicidade';
  }
  return 'none';
}

export async function recordSettlement(
  db: Db,
  orgId: string,
  actor: CadastroActor,
  input: z.infer<typeof RecordSettlementSchema>,
  opts: { now?: Date } = {},
): Promise<SettlementWriteResult> {
  const now = opts.now ?? new Date();
  const today = todayInSaoPaulo(now);
  const paidOn = input.paidOn ?? today;

  return withTenant(db, orgId, (tx) =>
    applyBaixaTx(
      tx,
      orgId,
      {
        target: { kind: input.targetKind, id: input.targetId },
        paidOn,
        today,
        origin: 'manual',
        actor,
      },
      { mode: 'manual' },
    ),
  );
}

export async function reverseSettlement(
  db: Db,
  orgId: string,
  actor: CadastroActor,
  settlementId: string,
  input: z.infer<typeof ReverseSettlementSchema>,
  opts: { now?: Date } = {},
): Promise<SettlementWriteResult> {
  const now = opts.now ?? new Date();
  const today = todayInSaoPaulo(now);
  const reason = input.reason && input.reason !== '' ? input.reason : null;

  try {
    return await withTenant(db, orgId, (tx) =>
      applyEstornoTx(
        tx,
        orgId,
        { baixaId: settlementId, reversedOn: today, today, origin: 'manual', actor, reason },
        { mode: 'manual' },
      ),
    );
  } catch (error) {
    // The violation aborts the transaction, so it is caught outside withTenant.
    if (isReversesUniqueViolation(error)) return { ok: false, reason: 'already_reversed' };
    throw error;
  }
}

export async function listSaleSettlements(
  db: Db,
  orgId: string,
  saleId: string,
): Promise<{ ok: true; settlements: SettlementEntry[] } | { ok: false; reason: 'not_found' }> {
  return withTenant(db, orgId, async (tx) => {
    const [sale] = await tx
      .select({ id: salesOpsSales.id })
      .from(salesOpsSales)
      .where(and(eq(salesOpsSales.orgId, orgId), eq(salesOpsSales.id, saleId)))
      .limit(1);
    if (!sale) return { ok: false as const, reason: 'not_found' as const };
    const facts = await selectSaleSettlements(tx, orgId, saleId);
    const reversedBy = new Map<string, string>();
    for (const fact of facts) {
      if (fact.reversesSettlementId !== null) reversedBy.set(fact.reversesSettlementId, fact.id);
    }
    return {
      ok: true as const,
      settlements: facts.map((fact) => toEntry(fact, reversedBy.get(fact.id) ?? null)),
    };
  });
}
