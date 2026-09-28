import {
  isObligationUpsertedV1,
  isSettlementRecordedV1,
  isSettlementReversedV1,
  syncedObligationSubset,
  type IntegrationEventEnvelope,
  type ObligationCandidate,
  type ObligationUpsertedV1,
  type SettlementRecordedV1,
  type SettlementReversedV1,
} from '@fxl-business/fxl-contracts';
import { isRecurringReceivableLabel } from '@fxl-sales/shared-utils/professional-split';
import { asDateOnly } from '../sales-ops/ledger-dates.js';
import type { PayableKind } from '../sales-ops/service.js';

export const SALES_APP_ID = 'app.fxl-sales';
export const EVENT_VERSION_V1 = 1;
export const EVENT_OBLIGATION_UPSERTED = 'fxl-sales.obligation.upserted';
export const EVENT_SETTLEMENT_RECORDED = 'fxl-sales.settlement.recorded';
export const EVENT_SETTLEMENT_REVERSED = 'fxl-sales.settlement.reversed';

export const UNKNOWN_ACTOR_DISPLAY_NAME = 'Autor não identificado';

export function obligationRef(rowId: string): string {
  return `fxl-sales:${rowId}`;
}
export function settlementRef(rowId: string): string {
  return `fxl-sales:${rowId}`;
}
export function saleRef(saleId: string): string {
  return `fxl-sales:${saleId}`;
}
export function deepLinkPathForSale(saleId: string): string {
  return `/operacional/vendas/${saleId}`;
}

export type ReceivableRowForEvent = {
  id: string;
  label: string;
  dueDate: string | Date;
  amountBrl: number;
  method: string;
  status: 'open' | 'paid' | 'void';
  revision: number;
};
export type PayableRowForEvent = {
  id: string;
  kind: PayableKind;
  beneficiaryName: string;
  dueDate: string | Date;
  amountBrl: number;
  status: 'open' | 'paid' | 'void';
  revision: number;
};
export type ObligationRowInput =
  | { direction: 'receivable'; row: ReceivableRowForEvent }
  | { direction: 'payable'; row: PayableRowForEvent };

export type SaleObligationSource = { saleId: string; saleCode: string; clientName: string };

export type SettlementRowForEvent = {
  id: string;
  type: 'baixa' | 'estorno';
  reversesSettlementId: string | null;
  paidOn: string | Date;
  amountBrl: number;
  targetKind: 'receivable' | 'payable';
  receivableId: string | null;
  payableId: string | null;
  actorName: string | null;
  reason?: string | null;
};

/** Injected so the builders stay pure (no clock, no randomness). */
export type EmitMeta = { newId: () => string; occurredAt: Date };

export type ObligationEventsInput = {
  organizationId: string;
  source: SaleObligationSource;
  obligations: readonly ObligationRowInput[];
  meta: EmitMeta;
};
export type ObligationVoidedEventsInput = ObligationEventsInput & { voidReason: string };

export type SettlementEventInput = {
  organizationId: string;
  row: SettlementRowForEvent;
  meta: EmitMeta;
};

/**
 * Sales role -> the payload's counterparty role. The published schema only
 * requires a non-empty string; the golden uses `customer` for the client, the
 * repo taxonomy (doubts audit) says `client`. We follow the repo: `client`.
 */
export function roleForPayableKind(
  kind: PayableKind,
): 'seller' | 'finder' | 'professional' | 'tax' | 'other' {
  switch (kind) {
    case 'seller_commission':
      return 'seller';
    case 'finder_commission':
      return 'finder';
    case 'professional_cost':
      return 'professional';
    case 'tax':
      return 'tax';
    default:
      return 'other';
  }
}

export function obligationTargetId(input: ObligationRowInput): string {
  return input.row.id;
}

function kindOf(input: ObligationRowInput): string {
  if (input.direction === 'payable') return input.row.kind;
  return isRecurringReceivableLabel(input.row.label) ? 'sale_recurring' : 'sale_installment';
}

export function toObligationCandidate(input: ObligationRowInput): ObligationCandidate {
  return {
    obligationRef: obligationRef(obligationTargetId(input)),
    kind: kindOf(input),
    recurrence:
      input.direction === 'receivable' && isRecurringReceivableLabel(input.row.label)
        ? 'fixed_count'
        : 'none',
    direction: input.direction,
    amountCents: input.row.amountBrl,
  };
}

export function toObligationPayload(
  source: SaleObligationSource,
  input: ObligationRowInput,
  state: 'active' | 'voided',
  voidReason?: string,
): ObligationUpsertedV1 {
  const base = {
    obligationRef: obligationRef(obligationTargetId(input)),
    direction: input.direction,
    kind: kindOf(input),
    amountCents: input.row.amountBrl,
    currency: 'BRL' as const,
    dueDate: asDateOnly(input.row.dueDate),
    source: {
      saleId: source.saleId,
      saleCode: source.saleCode,
      displayLabel:
        input.direction === 'receivable'
          ? `Proposta ${source.saleCode} - ${input.row.label}`
          : `Proposta ${source.saleCode} - ${input.row.beneficiaryName}`,
      deepLinkPath: deepLinkPathForSale(source.saleId),
    },
    revision: input.row.revision,
    state,
  };
  const counterparty =
    input.direction === 'receivable'
      ? { displayName: source.clientName, role: 'client' }
      : { displayName: input.row.beneficiaryName, role: roleForPayableKind(input.row.kind) };
  return {
    ...base,
    ...(input.direction === 'receivable' ? { method: input.row.method } : {}),
    counterparty,
    ...(state === 'voided' && voidReason ? { voidReason } : {}),
  };
}

function buildObligationEvents(
  input: ObligationEventsInput,
  state: 'active' | 'voided',
  voidReason?: string,
): IntegrationEventEnvelope[] {
  const { included } = syncedObligationSubset(input.obligations.map(toObligationCandidate));
  const includedRefs = new Set(included.map((c) => c.obligationRef));
  const events: IntegrationEventEnvelope[] = [];
  for (const obligation of input.obligations) {
    const ref = obligationRef(obligationTargetId(obligation));
    // The package requires amountCents >= 1; a zeroed row has nothing to publish.
    if (!includedRefs.has(ref) || obligation.row.amountBrl < 1) continue;
    const payload = toObligationPayload(input.source, obligation, state, voidReason);
    if (!isObligationUpsertedV1(payload)) {
      throw new Error(`obligation payload for ${ref} is not a valid ObligationUpsertedV1`);
    }
    events.push({
      id: input.meta.newId(),
      organizationId: input.organizationId,
      eventName: EVENT_OBLIGATION_UPSERTED,
      eventVersion: EVENT_VERSION_V1,
      idempotencyKey: `obligation:${ref}:rev:${obligation.row.revision}`,
      payload,
      occurredAt: input.meta.occurredAt,
    });
  }
  return events;
}

/** Active obligations; only the synced subset is returned. */
export function buildObligationUpsertedEvents(
  input: ObligationEventsInput,
): IntegrationEventEnvelope[] {
  return buildObligationEvents(input, 'active');
}

/** Same as upserted but `state: 'voided'` with the caller's reason. */
export function buildObligationVoidedEvents(
  input: ObligationVoidedEventsInput,
): IntegrationEventEnvelope[] {
  return buildObligationEvents(input, 'voided', input.voidReason);
}

function settlementTargetRef(row: SettlementRowForEvent): string {
  const id = row.targetKind === 'receivable' ? row.receivableId : row.payableId;
  if (!id) throw new Error(`settlement ${row.id} has no ${row.targetKind} id`);
  return obligationRef(id);
}

function recordedBy(row: SettlementRowForEvent) {
  return { app: SALES_APP_ID, displayName: row.actorName?.trim() || UNKNOWN_ACTOR_DISPLAY_NAME };
}

export function buildSettlementRecordedEvent(input: SettlementEventInput): IntegrationEventEnvelope {
  const { row } = input;
  if (row.type !== 'baixa') throw new Error(`settlement ${row.id} is not a baixa`);
  const payload: SettlementRecordedV1 = {
    settlementRef: settlementRef(row.id),
    obligationRef: settlementTargetRef(row),
    amountCents: row.amountBrl,
    paidOn: asDateOnly(row.paidOn),
    recordedBy: recordedBy(row),
  };
  if (!isSettlementRecordedV1(payload)) {
    throw new Error(`settlement payload for ${row.id} is not a valid SettlementRecordedV1`);
  }
  return {
    id: input.meta.newId(),
    organizationId: input.organizationId,
    eventName: EVENT_SETTLEMENT_RECORDED,
    eventVersion: EVENT_VERSION_V1,
    idempotencyKey: `settlement:${payload.settlementRef}`,
    payload,
    occurredAt: input.meta.occurredAt,
  };
}

export function buildSettlementReversedEvent(input: SettlementEventInput): IntegrationEventEnvelope {
  const { row } = input;
  if (row.type !== 'estorno' || !row.reversesSettlementId) {
    throw new Error(`settlement ${row.id} is not an estorno`);
  }
  const reason = row.reason?.trim();
  const payload: SettlementReversedV1 = {
    reversalRef: settlementRef(row.id),
    reversesSettlementRef: settlementRef(row.reversesSettlementId),
    amountCents: row.amountBrl,
    reversedOn: asDateOnly(row.paidOn),
    ...(reason ? { reason } : {}),
    recordedBy: recordedBy(row),
  };
  if (!isSettlementReversedV1(payload)) {
    throw new Error(`reversal payload for ${row.id} is not a valid SettlementReversedV1`);
  }
  return {
    id: input.meta.newId(),
    organizationId: input.organizationId,
    eventName: EVENT_SETTLEMENT_REVERSED,
    eventVersion: EVENT_VERSION_V1,
    idempotencyKey: `reversal:${payload.reversalRef}`,
    payload,
    occurredAt: input.meta.occurredAt,
  };
}
