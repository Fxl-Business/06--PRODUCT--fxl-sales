/**
 * Pure mapping and version policy of the Finance settlement consumer. No I/O.
 * A rejection here is PERMANENT (the handler counts it and the cursor advances).
 */
import {
  isSettlementRecordedV1,
  isSettlementReversedV1,
} from '@fxl-business/fxl-contracts';

export { deriveSettlementAnomaly, type SettlementAnomaly } from '../sales-ops/settlements.js';

export const FINANCE_SETTLEMENT_RECORDED = 'fxl-finance.settlement.recorded';
export const FINANCE_SETTLEMENT_REVERSED = 'fxl-finance.settlement.reversed';

/** N and N-1, newest first. Only v1 exists today. */
export const SUPPORTED_FINANCE_SETTLEMENT_VERSIONS: readonly number[] = [1];

export function isSupportedFinanceVersion(version: number): boolean {
  return SUPPORTED_FINANCE_SETTLEMENT_VERSIONS.some((supported) => supported === Number(version));
}

/** The only `recordedBy.app` the Finance feed may carry (echo guard). */
export const FINANCE_APP_ID = 'app.fxl-finance';
/** Ref prefix of Finance-minted settlement refs (`fxl-finance:<uuid>`). */
export const FINANCE_REF_PREFIX = 'fxl-finance';
/** Ref prefix of Sales obligation refs (`fxl-sales:<row uuid>`). */
export const SALES_REF_PREFIX = 'fxl-sales';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Strip `<prefix>:<uuid>` to the lower-cased uuid, or null. */
export function refUuid(ref: string, expectedPrefix: string): string | null {
  if (typeof ref !== 'string') return null;
  const prefix = `${expectedPrefix}:`;
  if (!ref.startsWith(prefix)) return null;
  const rest = ref.slice(prefix.length);
  return UUID.test(rest) ? rest.toLowerCase() : null;
}

/** obligationRef is `fxl-sales:<row uuid>`: the obligationRef -> row id resolver. */
export function obligationRowId(obligationRef: string): string | null {
  return refUuid(obligationRef, SALES_REF_PREFIX);
}

export type FinanceRejectCode =
  | 'unknown_version'
  | 'invalid_shape'
  | 'invalid_ref'
  | 'invalid_cents'
  | 'not_finance_origin'
  | 'amount_mismatch'
  | 'rejected_by_writer';

export type FinanceRecordedMapped = {
  localSettlementId: string;
  obligationRowId: string;
  amountCents: number;
  paidOn: string;
  recordedByDisplayName: string;
};

export type FinanceReversedMapped = {
  localEstornoId: string;
  localBaixaId: string;
  amountCents: number;
  reversedOn: string;
  reason: string | null;
  recordedByDisplayName: string;
};

function validCents(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export function mapFinanceRecorded(
  payload: unknown,
): FinanceRecordedMapped | { reject: FinanceRejectCode } {
  if (!isSettlementRecordedV1(payload)) return { reject: 'invalid_shape' };
  if (payload.recordedBy.app !== FINANCE_APP_ID) return { reject: 'not_finance_origin' };
  const localSettlementId = refUuid(payload.settlementRef, FINANCE_REF_PREFIX);
  const rowId = obligationRowId(payload.obligationRef);
  if (localSettlementId === null || rowId === null) return { reject: 'invalid_ref' };
  if (!validCents(payload.amountCents)) return { reject: 'invalid_cents' };
  return {
    localSettlementId,
    obligationRowId: rowId,
    amountCents: payload.amountCents,
    paidOn: payload.paidOn,
    recordedByDisplayName: payload.recordedBy.displayName,
  };
}

export function mapFinanceReversed(
  payload: unknown,
): FinanceReversedMapped | { reject: FinanceRejectCode } {
  if (!isSettlementReversedV1(payload)) return { reject: 'invalid_shape' };
  if (payload.recordedBy.app !== FINANCE_APP_ID) return { reject: 'not_finance_origin' };
  const localEstornoId = refUuid(payload.reversalRef, FINANCE_REF_PREFIX);
  const localBaixaId = refUuid(payload.reversesSettlementRef, FINANCE_REF_PREFIX);
  if (localEstornoId === null || localBaixaId === null) return { reject: 'invalid_ref' };
  if (!validCents(payload.amountCents)) return { reject: 'invalid_cents' };
  return {
    localEstornoId,
    localBaixaId,
    amountCents: payload.amountCents,
    reversedOn: payload.reversedOn,
    reason: payload.reason ?? null,
    recordedByDisplayName: payload.recordedBy.displayName,
  };
}
