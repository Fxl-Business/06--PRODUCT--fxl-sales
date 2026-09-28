/**
 * Heartbeat wrapper. Metadata only: cursors, lag, counters, closed-enum codes.
 * Never money, counterpart names or obligation refs.
 */
import {
  buildHeartbeatBody,
  createHeartbeatReporter,
} from '@fxl-business/fxl-contracts';
import type {
  HeartbeatBody,
  HeartbeatEligibilityCode,
  HeartbeatErrorCode,
  HeartbeatInput,
  HeartbeatReporter,
} from '@fxl-business/fxl-contracts';
import { toAuthorityConfig, type IntegrationClientSeams, type IntegrationConfig } from './config.js';

export {
  HEARTBEAT_ELIGIBILITY_CODES,
  HEARTBEAT_ERROR_CODES,
  HEARTBEAT_ERROR_DETAIL,
} from '@fxl-business/fxl-contracts';
export type {
  HeartbeatBody,
  HeartbeatEligibilityCode,
  HeartbeatErrorCode,
  HeartbeatInput,
  HeartbeatReporter,
  HeartbeatReportResult,
} from '@fxl-business/fxl-contracts';

export interface HeartbeatPairState {
  organizationId: string;
  counterpartApplicationId: string;
  role: 'producer' | 'consumer';
  cursorPosition?: number | null;
  cursorLagEvents?: number | null;
  lastEventAt?: string | null;
  appliedCount?: number;
  rejectedCount?: number;
  heldCount?: number;
  eligibility?: 'eligible' | 'ineligible';
  eligibilityCode?: HeartbeatEligibilityCode | null;
  lastError?: { code: HeartbeatErrorCode; at: string };
}

export interface HeartbeatState {
  pairs: readonly HeartbeatPairState[];
}

/** One input per pair. Only whitelisted metadata fields are copied. */
export function collectHeartbeatInputs(state: HeartbeatState): HeartbeatInput[] {
  return state.pairs.map((p) => ({
    organizationId: p.organizationId,
    counterpartApplicationId: p.counterpartApplicationId,
    role: p.role,
    cursorPosition: p.cursorPosition ?? null,
    cursorLagEvents: p.cursorLagEvents ?? null,
    lastEventAt: p.lastEventAt ?? null,
    appliedCount: p.appliedCount ?? 0,
    rejectedCount: p.rejectedCount ?? 0,
    heldCount: p.heldCount ?? 0,
    eligibility: p.eligibility ?? 'eligible',
    eligibilityCode: p.eligibilityCode ?? null,
    ...(p.lastError ? { lastError: { code: p.lastError.code, at: p.lastError.at } } : {}),
  }));
}

export function buildSalesHeartbeatBody(input: HeartbeatInput): HeartbeatBody {
  return buildHeartbeatBody(input);
}

export function createSalesHeartbeatReporter(
  config: IntegrationConfig,
  seams?: IntegrationClientSeams,
): HeartbeatReporter {
  return createHeartbeatReporter(toAuthorityConfig(config, seams));
}
