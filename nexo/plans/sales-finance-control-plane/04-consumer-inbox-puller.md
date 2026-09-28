---
id: 04-consumer-inbox-puller
milestone: v4.1.0
status: todo
depends_on: [01-pkg-and-transport-ddl, 02-hub-client-and-config, 03-producer-outbox-and-events]
files_modified: [apps/api/src/domains/integration/inbox-adapter.ts, apps/api/src/domains/integration/consumer.ts, apps/api/src/domains/integration/consumer-mapping.ts, apps/api/src/domains/sales-ops/settlements.ts, apps/api/src/domains/integration/__tests__/consumer.integration.test.ts]
acceptance:
  - Applying a `fxl-finance.settlement.recorded` v1 for a linked obligation inserts exactly one `sales_ops_settlements` row with `origin='finance'`, in the SAME transaction that wrote the inbox row and advanced the cursor.
  - Re-delivering the same finance event is a no-op (`pullOnce` inbox conflict -> handler not called, counted `skipped`); no second settlement row appears.
  - A `fxl-finance.settlement.reversed` v1 inserts one `origin='finance'` estorno row that reverses the local baixa mapped from `reversesSettlementRef`, mirroring org/sale/target/amount (passes the `FXS02` trigger and the one-estorno-per-baixa index).
  - An unknown event version is rejected explicitly (never applied), increments the consumer `rejectedCount`, and lets the cursor advance past the poison event (no stall).
  - Applying a finance settlement on a `void` (voided) obligation records the immutable fact and leaves the row derivable as `disputed`; the row status column is never silently flipped to `paid`.
  - Two concurrent integral baixas on one obligation (one manual, one finance) both persist, the row status cache is `paid`, and the state is derivable as `duplicidade`.
  - The consumer handler NEVER calls `enqueueIntegrationEvent`; after any consumer apply, `integration_outbox` has zero rows (anti-echo).
  - `POST /settlements` and `POST /settlements/:id/reverse` behave byte-identically to master (same status codes, same `{settlement,row}` body, same refusal codes).
---

# Slice 04: consumer inbox, puller, and finance settlement handlers

## Goal

Make FXL Sales consume `fxl-finance.settlement.recorded` v1 and `fxl-finance.settlement.reversed` v1 from the Finance feed, applying each as an `origin='finance'` settlement fact idempotently, filtered by Organization, inside the one transaction that `pullOnce` uses for the inbox insert and the cursor advance.
The apply goes through ONE writer in `settlements.ts` (extracted here) so the invariant "`sales_ops_settlements` is written only by `settlements.ts`" survives.
Applying a remote fact NEVER enqueues a local event (anti-echo).

This slice writes the consumer half only.
Slice 07 wires producer emission into the manual settlement routes and the sale writes.
Slice 08 mounts the puller at API boot.

## Dependencies this slice consumes (state assumptions, do not rebuild)

From slice 01 (`01-pkg-and-transport-ddl`):
- `@fxl-business/fxl-contracts@0.1.0` is installed at the exact pin and importable from `apps/api`.
- Migration `0025` created `integration_inbox` (PK `integration_inbox_pkey` on `(producer_application_id, organization_id, idempotency_key)`) and `integration_cursor` (PK `(producer_application_id, organization_id)`, `position bigint default 0`, `updated_at`), per `packages/fxl-contracts/schema/integration-transport.sql` CONSUMER SIDE.
- The three org-scoped transport tables carry an RLS model that the pooled transport adapter can read and write WITHOUT setting a per-Organization GUC (see "RLS and tenant context" below); `pullOnce` iterates many Organizations under one adapter and sets no GUC, so per-org GUC RLS on these tables is impossible by construction. If slice 01 landed a per-org GUC predicate on these tables, that is a blocker to raise before executing this slice.

From slice 02 (`02-hub-client-and-config`):
- A ticket client `TicketClient` with `.get({ organizationId, producerApplicationId }) -> { ticket, expiresAt, eventNames }` (real via `createTicketClient`, fake via `createFakeIntegrationAuthority`), already cached.
- Discovery over `GET /integration/contracts` and `GET /integration/activations`, exposing (a) the Finance producer Application id, (b) the Finance `api_url` in the authenticated Client's environment, (c) the live Organizations for this app. The Finance address is NEVER hardcoded and never a new env var.
- The integration config seam built from the existing hub config (`hubEnvBag`), no new `FXL_HUB_*` var.

From slice 03 (`03-producer-outbox-and-events`):
- A pooled `SqlIntegrationAdapter` factory over the app's admin connection whose transaction handle ALSO exposes the underlying Drizzle transaction so business writers (`settlements.ts`) can run on the same connection. The exact shape required by this slice is stated in "The consumer adapter" below; if slice 03's adapter does not expose the Drizzle handle, this slice adds the thin wrapper described there.

## Module list and signatures

### `apps/api/src/domains/integration/inbox-adapter.ts`

The consumer adapter over the pooled admin connection, plus the seam that lets a package-driven transaction reach the Drizzle transaction for business writes.

```ts
import type { SqlIntegrationAdapter } from '@fxl-business/fxl-contracts';
import type { Db } from '../sales-ops/service.js';

/**
 * A SqlIntegrationAdapter whose transaction handle also carries the Drizzle
 * transaction, so a handler can run Drizzle writes (settlements.ts) on the SAME
 * connection the inbox and cursor advance on. The package only ever calls
 * `query` and `transaction`; `drizzle` is an addition this app reads.
 */
export interface DrizzleIntegrationTx extends SqlIntegrationAdapter {
  readonly drizzle: Db;
}

/** True at runtime for a tx produced by this adapter. */
export function hasDrizzleTx(tx: SqlIntegrationAdapter): tx is DrizzleIntegrationTx;

/**
 * Build the pooled consumer adapter. `db` is the ADMIN Drizzle connection
 * (getAdminDb()); see "RLS and tenant context". `query` runs a parameterized
 * raw statement; `transaction` opens a Drizzle transaction and hands the package
 * a DrizzleIntegrationTx bound to it.
 *
 * REUSE slice 03's adapter if it already exposes `drizzle`; only add this file
 * if it does not.
 */
export function createConsumerAdapter(db: Db): SqlIntegrationAdapter;
```

Notes:
- `query<R>(sql, params)` executes via the Drizzle tx/connection with bound parameters (`tx.execute(...)` with a parameterized `SQL`); it returns rows in the column shape the package's SQL projects (the package's CONSUMER SQL names its own columns).
- `transaction(op)` opens `db.transaction(async (drizzleTx) => op(bind(drizzleTx)))` where `bind` returns a `DrizzleIntegrationTx` exposing both `query` (over `drizzleTx`) and `drizzle: drizzleTx`. Read-committed-or-stronger is Postgres's default and satisfies the package contract.

### `apps/api/src/domains/integration/consumer-mapping.ts`

Pure mapping and version policy. No I/O. Fully unit-testable without a DB.

```ts
import {
  isSettlementRecordedV1,
  isSettlementReversedV1,
  type SettlementRecordedV1,
  type SettlementReversedV1,
} from '@fxl-business/fxl-contracts';

/** The finance event names this consumer handles. */
export const FINANCE_SETTLEMENT_RECORDED = 'fxl-finance.settlement.recorded';
export const FINANCE_SETTLEMENT_REVERSED = 'fxl-finance.settlement.reversed';

/**
 * Accepted versions per finance event, newest first: N and N-1 (section 5.8 /
 * item 8). Only v1 exists today, so this is [1]; when v2 ships this becomes
 * [2, 1] and no other code changes. Membership is checked with Number equality.
 */
export const SUPPORTED_FINANCE_SETTLEMENT_VERSIONS: readonly number[]; // = [1]

export function isSupportedFinanceVersion(version: number): boolean;

/** `fxl-finance` is the only recordedBy.app this feed may carry (echo guard). */
export const FINANCE_APP_ID = 'fxl-finance';

/**
 * Strip a `<app>:<uuid>` ref to its uuid, or null when the prefix is not the
 * expected app or the suffix is not a uuid. Used to map remote settlement refs
 * to LOCAL sales_ops_settlements ids (the uuid is reused verbatim as the local
 * row id; see the mapping section).
 */
export function refUuid(ref: string, expectedApp: string): string | null;

/** obligationRef is `fxl-sales:<row uuid>`; returns the uuid or null. */
export function obligationRowId(obligationRef: string): string | null;

export type FinanceRecordedMapped = {
  localSettlementId: string;   // uuid from settlementRef
  obligationRowId: string;     // uuid from obligationRef
  amountCents: number;
  paidOn: string;              // YYYY-MM-DD
  recordedByApp: string;
};

export type FinanceReversedMapped = {
  localEstornoId: string;      // uuid from reversalRef
  localBaixaId: string;        // uuid from reversesSettlementRef
  amountCents: number;
  reversedOn: string;          // YYYY-MM-DD
  reason: string | null;
  recordedByApp: string;
};

/**
 * Parse + validate a recorded payload into the mapped shape, or return a typed
 * rejection. `isSettlementRecordedV1` gates the shape; refUuid/obligationRowId
 * gate the refs; cents must be a safe integer > 0; paidOn is left for the tx
 * layer to date-check against São Paulo today (needs `now`).
 */
export function mapFinanceRecorded(payload: unknown): FinanceRecordedMapped | { reject: FinanceRejectCode };
export function mapFinanceReversed(payload: unknown): FinanceReversedMapped | { reject: FinanceRejectCode };

export type FinanceRejectCode =
  | 'unknown_version'
  | 'invalid_shape'
  | 'invalid_ref'
  | 'invalid_cents'
  | 'not_finance_origin';
```

### `apps/api/src/domains/integration/consumer.ts`

Wires the package puller to the two handlers, the finance feed fetch, and the pair discovery. Exposes a factory; slice 08 starts it.

```ts
import {
  type FeedEvent,
  type FeedPage,
  type FetchFeedPage,
  type IntegrationEventHandler,
  type IntegrationPullPair,
  type IntegrationPullerConfig,
  type IntegrationPullerOptions,
  type SqlIntegrationAdapter,
} from '@fxl-business/fxl-contracts';

/** Injected, so fake mode and tests supply their own. */
export interface ConsumerDeps {
  adapter: SqlIntegrationAdapter;                 // slice 03 pooled admin adapter
  ticketClient: TicketClient;                     // slice 02 (real or fake)
  discovery: IntegrationDiscovery;                // slice 02: finance app id, api_url, live orgs
  metrics: ConsumerMetrics;                       // this slice
  fetchImpl?: typeof fetch;                        // default globalThis.fetch; tests inject
  now?: () => Date;                               // default () => new Date()
  intervalMs?: number;                            // default 5000 (package default)
  onError?: (error: unknown, pair: IntegrationPullPair | null) => void;
}

/** In-memory heartbeat counters this slice owns; slice 08 reads them. */
export interface ConsumerMetrics {
  recordApplied(pair: IntegrationPullPair): void;
  recordRejected(pair: IntegrationPullPair, code: FinanceRejectCode): void;
  recordHeld(pair: IntegrationPullPair): void;
  snapshot(): { applied: number; rejected: number; held: number };
}
export function createConsumerMetrics(): ConsumerMetrics;

/** (producer=Finance, organization) pairs, from discovery + activations. */
export function financePairs(discovery: IntegrationDiscovery): IntegrationPullerConfig['pairs'];

/**
 * FetchFeedPage: resolve the ticket (slice 02) and the Finance api_url
 * (discovery, never hardcoded), GET `${financeApiUrl}/integration/v1/feed`
 * with the ticket in `Authorization: Bearer` (NEVER logged), parse the JSON
 * page into a FeedPage (position strings -> bigint). A 401 throws so the tick
 * retries with a refreshed ticket and the heartbeat reports feed_unauthorized.
 */
export function financeFetchFeedPage(deps: ConsumerDeps): FetchFeedPage;

export function financeSettlementRecordedHandler(deps: ConsumerDeps): IntegrationEventHandler;
export function financeSettlementReversedHandler(deps: ConsumerDeps): IntegrationEventHandler;

/** Assemble IntegrationPullerOptions for startIntegrationPuller/pullOnce. */
export function buildFinanceConsumer(deps: ConsumerDeps): IntegrationPullerOptions;
```

`buildFinanceConsumer` returns:
```ts
{
  adapter: deps.adapter,
  config: { pairs: financePairs(deps.discovery), fetchFeedPage: financeFetchFeedPage(deps), limit: 100 },
  handlers: {
    [FINANCE_SETTLEMENT_RECORDED]: financeSettlementRecordedHandler(deps),
    [FINANCE_SETTLEMENT_REVERSED]: financeSettlementReversedHandler(deps),
  },
  intervalMs: deps.intervalMs,
  onError: deps.onError,
  now: deps.now,
}
```

## The consumer adapter (Drizzle seam + why admin connection)

`pullOnce` opens the transaction (`adapter.transaction`) and passes the handler a `tx: SqlIntegrationAdapter`.
The handler must run Drizzle business writes on that same transaction, so the adapter's tx exposes `drizzle: Db` (`DrizzleIntegrationTx`).
Inside a handler:
```ts
if (!hasDrizzleTx(tx)) throw new Error('consumer adapter must expose the Drizzle tx');
const dtx = tx.drizzle;
await setTenantContext(dtx, pair.organizationId);   // reuse middleware/auth.js
// ...map, then call applyBaixaTx/applyEstornoTx(dtx, pair.organizationId, ...)
```

## RLS and tenant context (decision, record in AUDIT.md)

- The transport tables (`integration_outbox`, `integration_inbox`, `integration_cursor`) follow the `hub_bff_*` precedent: FORCE RLS with the admin policy only, and the pooled transport adapter runs over `getAdminDb()`.
  This is forced by `pullOnce`: it services many Organizations under one adapter and sets no per-Organization GUC, so a per-org GUC predicate on these tables cannot be satisfied.
  Org isolation for these tables is carried by the `(producer_application_id, organization_id, ...)` scoping in every statement the package emits.
  (This is a dependency on slice 01's DDL and slice 03's adapter; flag it if slice 01 landed a per-org GUC predicate instead.)
- The consumer BUSINESS writes go to `sales_ops_*`, which DO enforce per-org RLS.
  The handler sets `app.current_org_id` for `pair.organizationId` on the Drizzle tx via the existing `setTenantContext` (from `apps/api/src/middleware/auth.js`, `SELECT set_config('app.current_org_id', $org, true)`) before any `applyBaixaTx`/`applyEstornoTx` call, and every extracted writer keeps its explicit `eq(table.orgId, orgId)` filters (defense in depth, and it matches the existing "admin transitions via getAdminDb + set_config" pattern noted in `server.ts`).

## settlements.ts extraction plan (behavior-preserving)

Goal: extract the tx-body of `recordSettlement` and `reverseSettlement` into two exported tx-accepting writers that BOTH the HTTP route path and the consumer handler call, so `sales_ops_settlements` keeps exactly one writer.
The acceptance policy (manual vs finance) is injected, so the shared writer does the locking, the insert, and the status-cache write once.

### New exported writers

```ts
export type SettlementAcceptance =
  | { mode: 'manual' }                               // manual: validarNovaBaixa / validarEstorno
  | { mode: 'finance'; amountCents: number };        // remote fact: record as-is, no business gate

export type ApplyBaixaArgs = {
  target: { kind: SettlementTargetKind; id: string };
  paidOn: string;                 // manual: caller default (SP today); finance: event paidOn
  today: string;                  // hojeSaoPaulo (caller passes; module never reads the clock)
  acceptance: SettlementAcceptance;
  origin: 'manual' | 'finance';
  actor: CadastroActor;
  id?: string;                    // finance: local uuid from settlementRef; manual: omitted (defaultRandom)
};

export type ApplyEstornoArgs = {
  baixaId: string;                // LOCAL settlement id to reverse
  reversedOn: string;             // manual: today (validarEstorno pins today); finance: event reversedOn
  today: string;
  acceptance: SettlementAcceptance;
  origin: 'manual' | 'finance';
  actor: CadastroActor;
  reason: string | null;
  id?: string;                    // finance: local estorno uuid from reversalRef
};

/** The ONE baixa writer. tx already carries the tenant context. */
export async function applyBaixaTx(tx: Db, orgId: string, args: ApplyBaixaArgs): Promise<SettlementWriteResult>;

/** The ONE estorno writer. tx already carries the tenant context. */
export async function applyEstornoTx(tx: Db, orgId: string, args: ApplyEstornoArgs): Promise<SettlementWriteResult>;
```

### `applyBaixaTx` body (moved verbatim from `recordSettlement`'s withTenant callback, with the policy branch)

1. `targetTable(kind)`, `select saleId` for `args.target.id` (`not_found` if absent).
2. `lockSaleForShare` (sale FOR SHARE), `lockTargetRow` (row FOR UPDATE). Lock order unchanged: sale then row.
3. `selectTargetFacts`.
4. Acceptance branch:
   - `mode: 'manual'`: `validarNovaBaixa({ valorOriginalCentavos: row.amountBrl, eventos: facts.map(toEvent), statusLinha: row.status, statusVenda: sale.status, dataPagamento: args.paidOn, hojeSaoPaulo: args.today })`; on `!ok` return `{ ok: false, reason: verdict.codigo }`. `amountBrl = verdict.valorCentavos`, `paidOn = verdict.data` (identical to master).
   - `mode: 'finance'`: gate ONLY on structure: `isIsoDay(args.paidOn)` else `{ ok:false, reason:'invalid_paid_on' }`; `isAfterTodayInSaoPaulo(args.paidOn)` (using `args.today` via the caller's clock) else `{ ok:false, reason:'paid_on_in_future' }`; `args.acceptance.amountCents` must be a safe integer > 0 (the table CHECK also enforces > 0). Do NOT gate on `sale_not_won`, `row_void`, or `already_paid`: a remote fact is immutable and is recorded even on a paid or voided obligation (that is what produces `duplicidade` / `disputed`). `amountBrl = args.acceptance.amountCents`, `paidOn = args.paidOn`.
5. Insert `salesOpsSettlements` (`type:'baixa'`, `receivableId`/`payableId` per kind, `reversesSettlementId: null`, `origin: args.origin`, `actorUserId/actorName` from `args.actor`, `reason: null`, and `id: args.id` when provided).
6. `writeStatusCache(tx, orgId, kind, row, [...facts, inserted])` (unchanged; keeps `void` terminal, sets `paid` only when an active baixa exists and open is 0).
7. Return `{ ok: true, settlement: toEntry(inserted, null), row: state }`.

`recordSettlement` becomes: resolve `now`/`today`/`paidOn` (unchanged) then `withTenant(db, orgId, (tx) => applyBaixaTx(tx, orgId, { target:{kind, id: input.targetId}, paidOn, today, acceptance:{mode:'manual'}, origin:'manual', actor }))`.
The HTTP route (`routes.ts`) is untouched; the returned `SettlementWriteResult` and `SETTLEMENT_ERROR_STATUS` mapping are unchanged.

### `applyEstornoTx` body (moved from `reverseSettlement`'s withTenant callback)

1. Load the baixa row by `args.baixaId` in `orgId` (`not_found` if absent); read `kind`, `receivableId`/`payableId`, `saleId`.
2. `lockSaleForShare`, `lockTargetRow` for the resolved target.
3. `selectTargetFacts`.
4. Acceptance branch:
   - `mode:'manual'`: `validarEstorno({ baixaId: args.baixaId, eventos: facts.map(toEvent), hojeSaoPaulo: args.today })`; on `!ok` return `{ ok:false, reason: verdict.codigo }`. `estornaBaixaId = verdict.estornaBaixaId`, `amountBrl = verdict.valorCentavos`, `paidOn = verdict.data` (today) (identical to master).
   - `mode:'finance'`: `isIsoDay(args.reversedOn)` and not future, else return the matching structural reject; `args.acceptance.amountCents` must equal the cited baixa's `amountBrl` (reducer parity: an estorno carries the same amount as its baixa) else a typed reject; `estornaBaixaId = args.baixaId`, `amountBrl = baixa.amountBrl`, `paidOn = args.reversedOn`.
5. Insert `type:'estorno'`, `reversesSettlementId: estornaBaixaId`, mirror fields from the baixa row (org, sale, target_kind, target id, amount) so the `FXS02` INSERT trigger passes, `origin: args.origin`, `reason: args.reason`, `id: args.id` when provided.
6. `writeStatusCache`.
7. Return `{ ok:true, ... }`.

`reverseSettlement` becomes: keep the outer `try/catch` for `isReversesUniqueViolation` (unchanged, returns `already_reversed`), then `withTenant(db, orgId, (tx) => applyEstornoTx(tx, orgId, { baixaId: settlementId, reversedOn: today, today, acceptance:{mode:'manual'}, origin:'manual', actor, reason }))`.
Behavior byte-identical to master.

### The one writer invariant

`applyBaixaTx` / `applyEstornoTx` are the only INSERTers of `sales_ops_settlements`, and both the route path and the consumer call them.
No other module inserts into that table.
Emission (slice 07) is placed in the manual wrappers (`recordSettlement` / `reverseSettlement`) or gated `origin === 'manual'`, NEVER inside these writers and NEVER inside the consumer handler, so a finance-origin apply emits nothing (anti-echo). This is the seam slice 07 relies on; keep the writers emission-free.

## Finance event -> local row mapping

`obligationRef` and the settlement refs are the only identity; labels and parcela numbers are never identity.

Recorded (`fxl-finance.settlement.recorded` v1, payload `SettlementRecordedV1`):
- Version: `event.eventVersion` must satisfy `isSupportedFinanceVersion`; else reject `unknown_version` (permanent).
- Shape: `isSettlementRecordedV1(payload)`; else reject `invalid_shape` (permanent).
- Echo guard: `payload.recordedBy.app === FINANCE_APP_ID`; else reject `not_finance_origin` (permanent; a sales-origin fact must never round-trip).
- `obligationRowId(payload.obligationRef)` -> the local `sales_ops_receivables`/`sales_ops_payables` row uuid.
- Resolve direction by lookup in `pair.organizationId`: query the receivable by `(orgId, id)`, else the payable by `(orgId, id)`; that decides `targetKind`. If neither exists, reject `invalid_ref` (permanent: Sales OWNS obligation existence and emits `obligation.upserted` before any settlement, so an unknown obligation is a producer contract violation, not a wait).
- `localSettlementId = refUuid(payload.settlementRef, FINANCE_APP_ID)` becomes the LOCAL `sales_ops_settlements.id`. Reusing the remote uuid as the local PK (a) needs no new column, (b) makes the later reversal mapping deterministic, (c) is a belt-and-suspenders idempotency layer beyond the inbox (a re-insert of the same id trips the PK). Manual rows keep `defaultRandom()`, and uuids never collide, so `origin='manual'` and `origin='finance'` ids share one namespace safely.
- Call `applyBaixaTx(dtx, org, { target:{ kind, id: obligationRowId }, paidOn: payload.paidOn, today: todayInSaoPaulo(now), acceptance:{ mode:'finance', amountCents: payload.amountCents }, origin:'finance', actor: FINANCE_ACTOR, id: localSettlementId })`.
- `FINANCE_ACTOR = { userId: 'system', displayName: payload.recordedBy.displayName ?? 'FXL Finance' }` (the table requires a non-blank `actor_user_id`; the history projects `actor_name` only).

Reversed (`fxl-finance.settlement.reversed` v1, payload `SettlementReversedV1`):
- Version + shape + echo guard as above (`isSettlementReversedV1`).
- `localBaixaId = refUuid(payload.reversesSettlementRef, FINANCE_APP_ID)`: the LOCAL baixa row id to reverse. Load it in `orgId`; it must exist and be `type='baixa'`. If absent, this is the ONLY transient case: THROW so `pullOnce` rolls back the inbox insert and the cursor advance and the next tick re-fetches (the reducer's "a reversal delivered before its settlement waits in the inbox until the settlement lands"). Ordered delivery makes this rare; do not treat it as a permanent reject.
- `localEstornoId = refUuid(payload.reversalRef, FINANCE_APP_ID)` becomes the local estorno row id.
- Call `applyEstornoTx(dtx, org, { baixaId: localBaixaId, reversedOn: payload.reversedOn, today: todayInSaoPaulo(now), acceptance:{ mode:'finance', amountCents: payload.amountCents }, origin:'finance', actor: FINANCE_ACTOR, reason: payload.reason ?? null, id: localEstornoId })`.

## Version policy

- `SUPPORTED_FINANCE_SETTLEMENT_VERSIONS` holds N and N-1 (currently `[1]`); an event whose `eventVersion` is not in the set is rejected `unknown_version`, never applied.
- A rejection is PERMANENT: the handler catches it, calls `metrics.recordRejected(pair, code)` (feeds the heartbeat `rejectedCount`), and RETURNS NORMALLY so `pullOnce` commits the inbox insert and advances the cursor past the poison event (no stall).
- Only the missing-baixa case for a reversal THROWS (transient retry). Nothing else throws from a handler except infrastructure errors.
- Handler outcomes summarized:
  - applied -> `metrics.recordApplied`, return.
  - permanent reject (`unknown_version` | `invalid_shape` | `invalid_ref` | `invalid_cents` | `not_finance_origin` | amount mismatch on estorno) -> `metrics.recordRejected`, return (cursor advances).
  - transient (reversal cites a not-yet-present local baixa; infra error) -> throw (cursor does not advance; retried).

## The duplicidade and disputed decision (record in AUDIT.md)

Concrete marking, chosen here: NO new status enum value and NO new column.
Both `disputed` and `duplicidade` are PURE DERIVATIONS from the immutable settlement facts (which ARE persisted) plus the row's Sales-owned status.
The "record it" requirement is satisfied by recording the immutable `origin='finance'` fact; the anomaly is computed on demand by a pure helper, exported from `settlements.ts` for the writer path and any later bootstrap/UI use:

```ts
export type SettlementAnomaly = 'none' | 'disputed' | 'duplicidade';

/** Pure. `rowStatus` is the Sales-owned column ('open'|'paid'|'void'); facts are
 * the row's full immutable history. */
export function deriveSettlementAnomaly(
  rowStatus: StatusLinhaLiquidavel,
  amountBrl: number,
  facts: readonly FactLike[],
): SettlementAnomaly;
```

Rules (mirrors the package `reduceSettlement` status ordering and doubts doc 11.4):
- `disputed`: `rowStatus === 'void'` AND `liquidacaoDaLinha(amountBrl, facts).baixasAtivas.length > 0` (an active settlement on a voided obligation; `statusCacheDaLinha` keeps the column `void`, never silently `paid`, and this helper names the conflict).
- `duplicidade`: not disputed, AND `pagoCentavos > amountBrl` AND `baixasAtivas.length > 1` (two concurrent integral baixas; the status cache is correctly `paid`, and the marker says "registrada em duplicidade" so a person estornos one).
- else `none`.

Rationale to log: the status column stays `open|paid|void` (no migration, no churn to `statusCacheDaLinha` which is locked mirror-parity with Finance's reducer); the anomaly is always recoverable from persisted immutable facts; resolution stays manual (estornar), never an automatic undo.

## Anti-echo (hard rule)

- The consumer handler NEVER imports or calls `enqueueIntegrationEvent`.
- The extracted writers `applyBaixaTx`/`applyEstornoTx` NEVER emit; emission is slice 07's, placed only on the manual path.
- Every consumer-written fact carries `origin='finance'`, and slice 07's emission is gated to `origin='manual'`, so a finance fact is never republished.
- The oracle asserts `SELECT count(*) FROM integration_outbox` is 0 after a consumer apply.

## Coordination flag: slice 04 and slice 07 both edit settlements.ts

This slice EXTRACTS `applyBaixaTx`/`applyEstornoTx` and rewrites `recordSettlement`/`reverseSettlement` to delegate to them; it adds `deriveSettlementAnomaly`.
Slice 07 then ADDS `enqueueIntegrationEvent` calls into `recordSettlement`/`reverseSettlement` (manual path) and the sale writes.
They are sequenced into different waves (04 in wave 3, 07 in wave 4) precisely so these two edits to `settlements.ts` do not race.
Slice 04 must leave the emission seam clean (writers emission-free; wrappers are where slice 07 hooks) and must NOT pre-empt slice 07's emission.

## Named oracle test

`apps/api/src/domains/integration/__tests__/consumer.integration.test.ts` (real local test DB via the `fxl_sales_test` role, per the repo integration-test convention; `apps/api/test/rls/setup-env.ts` hard-overrides `DATABASE_URL`).
It drives `pullOnce` with a stub `fetchFeedPage` that returns crafted `FeedPage`s over the shared fixture org, and asserts against the real tables.

Test name: `finance settlement consumer applies once, is idempotent, versions, disputes and never echoes`.

Cases (each an `it` under that describe, all against a seeded `won` sale with at least one receivable in the fixture org):
1. `applies a finance settlement.recorded as exactly one origin='finance' row in the inbox+cursor transaction`: one recorded event -> `pullOnce` report `applied === 1`; exactly one `sales_ops_settlements` row with `origin='finance'`, `id` = the settlementRef uuid, amount and paidOn from the payload; `integration_inbox` has the row; `integration_cursor` advanced to the event position.
2. `replays are skipped and never double-apply`: feeding the SAME event again -> report `skipped >= 1`, `applied === 0`; still exactly one settlement row.
3. `rejects an unknown version without applying and lets the cursor advance`: a recorded event at `eventVersion: 2` -> no settlement row; `metrics.snapshot().rejected === 1`; the cursor advanced past it (a following valid event applies on the next page).
4. `applies a finance settlement.reversed against the mapped local baixa`: recorded then reversed -> one estorno row with `origin='finance'`, `reverses_settlement_id` = the recorded row id; `reduzirLiquidacao` shows no active baixa; the receivable status cache back to `open`.
5. `marks disputed when the obligation is voided`: void the receivable (Sales decision), then apply a finance recorded -> the fact is recorded, the status column stays `void`, and `deriveSettlementAnomaly` returns `disputed`.
6. `marks duplicidade on two concurrent integral baixas`: a manual `applyBaixaTx` baixa plus a finance recorded baixa on the same receivable -> both rows persist, status cache `paid`, `deriveSettlementAnomaly` returns `duplicidade`.
7. `never enqueues an outbox row`: after cases 1 and 4, `SELECT count(*) FROM integration_outbox` is 0.

Pure companion unit tests (no DB) in the same describe or a sibling `consumer-mapping.test.ts`:
- `refUuid` / `obligationRowId` parse valid refs and reject wrong app / non-uuid.
- `isSupportedFinanceVersion` accepts 1 and rejects 0 and 2.
- `mapFinanceRecorded` / `mapFinanceReversed` return the mapped shape for the golden `SETTLEMENT_RECORDED_V1_EXAMPLE_FINANCE` / `SETTLEMENT_REVERSED_V1_EXAMPLE` and the typed reject for a malformed payload.

Keep-green oracles that must still pass unchanged (extraction is behavior-preserving):
- `apps/api/src/domains/sales-ops/__tests__/settlements.test.ts`
- `apps/api/src/domains/sales-ops/__tests__/settlements.integration.test.ts`
- `apps/api/src/domains/sales-ops/__tests__/settlement-locks.test.ts`

## Constraints honored (checklist for the executor)

- Integer cents only; `amountCents` from the event is asserted a safe integer > 0; no float path.
- Dates are São Paulo civil days via `@fxl-sales/shared-utils/sao-paulo-day` (`todayInSaoPaulo`, `isIsoDay`, `isAfterTodayInSaoPaulo`); never `new Date().toISOString().slice(0,10)`; never a future day.
- The one reducer stays `reduzirLiquidacao` (already in `settlements.ts`); this slice writes no second reducer.
- The feed fetch runs OUTSIDE any transaction (`pullOnce` guarantees this); the apply + inbox insert + cursor advance are ONE transaction (`pullOnce` guarantees this).
- Multi-instance safety comes from `pullOnce`'s `SELECT ... FOR UPDATE SKIP LOCKED` on the cursor per pair; this slice adds no second locking scheme.
- No external scheduler; the puller runs in-process (started by slice 08).
- The ticket value is never logged.

## Open items to log in AUDIT.md

- The RLS model for the transport tables (admin policy + `getAdminDb`) and the reasoning (see "RLS and tenant context").
- The `disputed` / `duplicidade` derivation-not-column decision and rationale.
- Reusing the remote settlement uuid as the local `sales_ops_settlements.id`.
- Permanent-vs-transient reject taxonomy (only a missing local baixa for a reversal throws/retries).
- If the real Finance feed does not exist yet, the cross-process cases run against the stubbed `fetchFeedPage` in this repo and the untested cross-app path is recorded (this slice's oracle uses a stub feed regardless; the true cross-app E2E is slice 09's concern).
