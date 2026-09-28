/**
 * Finance settlement consumer: `fxl-finance.settlement.recorded|reversed` v1
 * applied as `origin='finance'` facts through the ONE settlements writer, inside
 * the transaction `pullOnce` opens for the inbox insert and cursor advance.
 *
 * ANTI-ECHO: nothing in this module enqueues an event. Do not import
 * `enqueueIntegrationEvent`, `enqueueSaleEvents` or `enqueueEvent` here.
 */
import type {
  FeedEvent,
  FeedPage,
  FetchFeedPage,
  IntegrationEventHandler,
  IntegrationPullPair,
  IntegrationPullerOptions,
  SqlIntegrationAdapter,
  TicketClient,
} from '@fxl-business/fxl-contracts';
import { todayInSaoPaulo } from '@fxl-sales/shared-utils/sao-paulo-day';
import { and, eq } from 'drizzle-orm';
import { salesOpsPayables, salesOpsReceivables } from '../../db/schema.js';
import { setTenantContext } from '../../middleware/auth.js';
import {
  applyBaixaTx,
  applyEstornoTx,
  type SettlementTargetKind,
  type SettlementWriteResult,
} from '../sales-ops/settlements.js';
import type { CadastroActor, Db } from '../sales-ops/service.js';
import {
  FINANCE_SETTLEMENT_RECORDED,
  FINANCE_SETTLEMENT_REVERSED,
  isSupportedFinanceVersion,
  mapFinanceRecorded,
  mapFinanceReversed,
  type FinanceRejectCode,
} from './consumer-mapping.js';
import type { IntegrationDiscovery } from './hub-client.js';
import { drizzleTxOf, hasDrizzleTx } from './outbox-adapter.js';

export interface ConsumerDeps {
  adapter: SqlIntegrationAdapter;
  discovery: IntegrationDiscovery;
  ticketClient: TicketClient;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  intervalMs?: number;
  onError?: (error: unknown, pair: IntegrationPullPair | null) => void;
  onRejected?: (pair: IntegrationPullPair, code: FinanceRejectCode) => void;
}

/** Running counters for the heartbeat (`rejectedCount`). */
export type ConsumerCounters = { applied: number; rejected: number };

export type FinanceConsumer = IntegrationPullerOptions & { counters: ConsumerCounters };

const FINANCE_ACTOR_USER_ID = 'system';

function actorOf(displayName: string): CadastroActor {
  return { userId: FINANCE_ACTOR_USER_ID, displayName: displayName || 'FXL Finance' };
}

/** A remote fact that can never apply: counted, then the cursor moves on. */
class PermanentReject extends Error {
  constructor(readonly code: FinanceRejectCode) {
    super(code);
  }
}

/** A reversal cited a baixa that has not landed yet: throw so the tick retries. */
export class FinanceBaixaNotLandedError extends Error {
  constructor() {
    super('finance reversal cites a settlement that has not landed yet');
  }
}

/** Resolve an obligation row id to its direction inside the tenant tx. */
async function resolveObligationKind(
  tx: Db,
  orgId: string,
  rowId: string,
): Promise<SettlementTargetKind | null> {
  const [receivable] = await tx
    .select({ id: salesOpsReceivables.id })
    .from(salesOpsReceivables)
    .where(and(eq(salesOpsReceivables.orgId, orgId), eq(salesOpsReceivables.id, rowId)))
    .limit(1);
  if (receivable) return 'receivable';
  const [payable] = await tx
    .select({ id: salesOpsPayables.id })
    .from(salesOpsPayables)
    .where(and(eq(salesOpsPayables.orgId, orgId), eq(salesOpsPayables.id, rowId)))
    .limit(1);
  return payable ? 'payable' : null;
}

function requireApplied(result: SettlementWriteResult, transientNotFound: boolean): void {
  if (result.ok) return;
  if (result.reason === 'not_found' && transientNotFound) throw new FinanceBaixaNotLandedError();
  throw new PermanentReject(
    result.reason === 'invalid_amount' ? 'amount_mismatch' : 'rejected_by_writer',
  );
}

async function withCounting(
  counters: ConsumerCounters,
  deps: ConsumerDeps,
  pair: IntegrationPullPair,
  apply: () => Promise<void>,
): Promise<void> {
  try {
    await apply();
    counters.applied += 1;
  } catch (error) {
    if (error instanceof PermanentReject) {
      counters.rejected += 1;
      deps.onRejected?.(pair, error.code);
      return;
    }
    throw error;
  }
}

function tenantTx(tx: SqlIntegrationAdapter): Db {
  if (!hasDrizzleTx(tx)) throw new Error('consumer adapter must carry the drizzle transaction');
  return drizzleTxOf(tx) as unknown as Db;
}

export function financeSettlementRecordedHandler(
  deps: ConsumerDeps,
  counters: ConsumerCounters,
): IntegrationEventHandler {
  const now = deps.now ?? (() => new Date());
  return (tx, event, pair) =>
    withCounting(counters, deps, pair, async () => {
      if (!isSupportedFinanceVersion(event.eventVersion)) throw new PermanentReject('unknown_version');
      const mapped = mapFinanceRecorded(event.payload);
      if ('reject' in mapped) throw new PermanentReject(mapped.reject);
      const dtx = tenantTx(tx);
      await setTenantContext(dtx, pair.organizationId);
      const kind = await resolveObligationKind(dtx, pair.organizationId, mapped.obligationRowId);
      if (kind === null) throw new PermanentReject('invalid_ref');
      const result = await applyBaixaTx(
        dtx,
        pair.organizationId,
        {
          target: { kind, id: mapped.obligationRowId },
          paidOn: mapped.paidOn,
          today: todayInSaoPaulo(now()),
          origin: 'finance',
          actor: actorOf(mapped.recordedByDisplayName),
          id: mapped.localSettlementId,
        },
        { mode: 'finance', amountCents: mapped.amountCents },
      );
      requireApplied(result, false);
    });
}

export function financeSettlementReversedHandler(
  deps: ConsumerDeps,
  counters: ConsumerCounters,
): IntegrationEventHandler {
  const now = deps.now ?? (() => new Date());
  return (tx, event, pair) =>
    withCounting(counters, deps, pair, async () => {
      if (!isSupportedFinanceVersion(event.eventVersion)) throw new PermanentReject('unknown_version');
      const mapped = mapFinanceReversed(event.payload);
      if ('reject' in mapped) throw new PermanentReject(mapped.reject);
      const dtx = tenantTx(tx);
      await setTenantContext(dtx, pair.organizationId);
      const result = await applyEstornoTx(
        dtx,
        pair.organizationId,
        {
          baixaId: mapped.localBaixaId,
          reversedOn: mapped.reversedOn,
          today: todayInSaoPaulo(now()),
          origin: 'finance',
          actor: actorOf(mapped.recordedByDisplayName),
          reason: mapped.reason,
          id: mapped.localEstornoId,
        },
        { mode: 'finance', amountCents: mapped.amountCents },
      );
      requireApplied(result, true);
    });
}

type WireEvent = Omit<FeedEvent, 'position'> & { position: string | number };
type WirePage = { events: WireEvent[]; nextCursor: string | number };

/**
 * Feed fetch: ticket from the ticket client, Finance `api_url` from discovery
 * (never hardcoded). The ticket travels only in `Authorization` and is never
 * logged. A 401 invalidates the cached ticket and throws so the tick retries.
 */
export function financeFetchFeedPage(deps: ConsumerDeps): FetchFeedPage {
  const fetchImpl = deps.fetchImpl ?? fetch;
  return async (pair, after, limit): Promise<FeedPage> => {
    const request = {
      organizationId: pair.organizationId,
      producerApplicationId: pair.producerApplicationId,
    };
    const outcome = await deps.ticketClient.get(request);
    if (outcome.status !== 'ok') throw new Error(`finance feed ticket ${outcome.status}`);
    const contracts = await deps.discovery.contracts();
    const peer = contracts.find(
      (c) =>
        c.role === 'consumer' &&
        c.counterpart.applicationId === pair.producerApplicationId &&
        c.counterpart.apiUrl,
    );
    const apiUrl = peer?.counterpart.apiUrl;
    if (!apiUrl) throw new Error('finance api_url not discovered');
    const qs = new URLSearchParams({
      organizationId: pair.organizationId,
      after: after.toString(),
      limit: String(limit),
    });
    const response = await fetchImpl(`${apiUrl.replace(/\/+$/, '')}/integration/v1/feed?${qs}`, {
      headers: { authorization: `Bearer ${outcome.ticket.ticket}`, accept: 'application/json' },
    });
    if (response.status === 401) {
      deps.ticketClient.invalidate(request);
      throw new Error('feed_unauthorized');
    }
    if (!response.ok) throw new Error(`finance feed answered ${response.status}`);
    const body = (await response.json()) as WirePage;
    return {
      events: body.events.map((e) => ({ ...e, position: BigInt(e.position) })),
      nextCursor: BigInt(body.nextCursor),
    };
  };
}

export function createFinanceConsumer(deps: ConsumerDeps): FinanceConsumer {
  const counters: ConsumerCounters = { applied: 0, rejected: 0 };
  return {
    counters,
    adapter: deps.adapter,
    config: {
      pairs: () => deps.discovery.activations(),
      fetchFeedPage: financeFetchFeedPage(deps),
      limit: 100,
    },
    handlers: {
      [FINANCE_SETTLEMENT_RECORDED]: financeSettlementRecordedHandler(deps, counters),
      [FINANCE_SETTLEMENT_REVERSED]: financeSettlementReversedHandler(deps, counters),
    },
    intervalMs: deps.intervalMs,
    onError: deps.onError,
    now: deps.now,
  };
}
