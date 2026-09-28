---
id: 03-producer-outbox-and-events
milestone: v4.1.0
status: todo
depends_on: [01-pkg-and-transport-ddl]
files_modified: [apps/api/src/domains/integration/outbox-adapter.ts, apps/api/src/domains/integration/events.ts, apps/api/src/domains/integration/producer-gate.ts, apps/api/src/domains/integration/__tests__/producer-gate.test.ts, apps/api/src/domains/integration/__tests__/events.test.ts, apps/api/src/domains/integration/__tests__/outbox-adapter.test.ts, apps/api/src/domains/integration/__tests__/outbox-adapter.integration.test.ts]
acceptance:
  - "outbox-adapter.ts exports createIntegrationTxAdapter(runner) and createIntegrationPooledAdapter(db), both returning SqlIntegrationAdapter, plus enqueueEvent(tx, envelope) that delegates to the package's enqueueIntegrationEvent."
  - "adapter.query(text, params) runs the raw $n-placeholder SQL on the SAME runner via runner.execute(rawWithParams(text, params)), binding every occurrence in order; a repeated or out-of-order $n binds the right param."
  - "events.ts builders produce ONLY schema-valid v1 payloads: every obligation payload passes isObligationUpsertedV1, every recorded passes isSettlementRecordedV1, every reversed passes isSettlementReversedV1, every checkpoint passes isLedgerCheckpointV1."
  - "buildObligationUpsertedEnvelopes runs syncedObligationSubset on the candidates and emits ONLY for the included set: a tax payable and an indefinite-recurrence candidate produce no envelope; a fixed-count recurring receivable and an installment do."
  - "buildSettlementEnvelope returns null for origin='finance' (anti-echo) and a wrapped envelope for origin='manual'."
  - "idempotencyKey is stable per business fact: obligation:<ref>:rev:<n>, settlement:<ref>, reversal:<ref>, checkpoint:<saleRef>:page:<p>:<digest>."
  - "modules are pure at import: no clock, no crypto/random, no getDb() at module top level; newId and occurredAt are injected."
  - "the integration oracle enqueues one pending row (position IS NULL) and a second identical enqueue is a no-op on (organization_id, idempotency_key)."
---

# Slice 03 - Producer outbox adapter and event builders

## Goal and boundary

Deliver the PURE building blocks a producer needs, under `apps/api/src/domains/integration/`:

1. The `SqlIntegrationAdapter` in two forms (business-tx-wrapping, and pooled) plus a thin `enqueueEvent` seam over the package's `enqueueIntegrationEvent`.
2. The pure event builders that map a won sale's surviving obligations and its settlement facts into `ObligationUpsertedV1` / `SettlementRecordedV1` / `SettlementReversedV1` / `LedgerCheckpointV1` payloads wrapped in `IntegrationEventEnvelope`.
3. The producer-side `syncedObligationSubset` filter so an excluded obligation never becomes an event.

NOT in this slice (do not touch): transaction wiring of the emit seam into `createSale`/`transitionSale`/`cancelContract`/`updateSale`/settlement routes (slice 07); the position publisher, feed route, puller, prune scheduling and boot (slices 05/08); the consumer inbox (slice 04); auth-fake fixture (slice 06).
These modules are consumed later; this slice only creates them, so it stays file-disjoint from the rest of wave 2.

The package is already installed at exact `0.1.0` (slice 01) and the transport DDL + RLS policies (tenant + admin, mirroring 0008) are applied as migration `0025` (slice 01). This slice assumes those tables exist.

## Package facts this slice binds to (verified against dist/index.d.ts and the golden examples)

- `SqlIntegrationAdapter = { query<R>(sql: string, params: readonly unknown[]): Promise<R[]>; transaction<T>(op: (tx) => Promise<T>): Promise<T> }`. The package emits Postgres `$1..$n` placeholder SQL; the adapter runs it verbatim. Read-committed-or-stronger isolation is required.
- `enqueueIntegrationEvent(tx: SqlIntegrationAdapter, event: IntegrationEventEnvelope): Promise<void>` - INSERT with `ON CONFLICT (organization_id, idempotency_key) DO NOTHING`, `position`/`published_at` born NULL. Call from INSIDE the business tx.
- `IntegrationEventEnvelope = { id, organizationId, eventName, eventVersion, idempotencyKey, payload: unknown, occurredAt: Date }`.
- `syncedObligationSubset(candidates: readonly ObligationCandidate[]): { included, excluded }`; `ObligationCandidate = { obligationRef, kind, recurrence: 'none'|'fixed_count'|'indefinite', direction: 'receivable'|'payable', amountCents }`. `SYNCED_SUBSET_EXCLUDED_KINDS_V1 = { tax: 'tax', affiliate_commission: 'affiliate_commission' }`. Order is excluded-kind table first, then indefinite recurrence.
- `reduceSettlement(obligation: ObligationSnapshot, facts: readonly SettlementInputFact[]): SettlementState` and `settlementDigest(state)`. `SettlementOrigin = 'local' | 'remote'`. `SettlementFact = { kind:'settlement', settlementRef, obligationRef, amountCents, paidOn, origin }`; `ReversalFact = { kind:'reversal', reversalRef, reversesSettlementRef, amountCents, reversedOn, origin }`. `reduceSettlement` throws `SettlementError` on a malformed set - do NOT write a second reducer.
- `ledgerCheckpointHash(payload: Omit<LedgerCheckpointV1,'hash'>): string`, `digestJson(value): string`, guards `isObligationUpsertedV1` / `isSettlementRecordedV1` / `isSettlementReversedV1` / `isLedgerCheckpointV1`, and examples `OBLIGATION_UPSERTED_V1_EXAMPLE`, `SETTLEMENT_RECORDED_V1_EXAMPLE_SALES`, `SETTLEMENT_REVERSED_V1_EXAMPLE`, `LEDGER_CHECKPOINT_V1_EXAMPLE`.

### Schema shapes that constrain the payloads (from EVENT_TYPES)

- `obligation.upserted.source` REQUIRES all four of `saleId`, `saleCode`, `displayLabel`, `deepLinkPath`. **deepLinkPath is NOT optional** (`pattern ^/[^\s]*$`). `kind` is `^[a-z][a-z0-9_]{0,63}$`. `obligationRef` is `^fxl-sales:[A-Za-z0-9_-]{1,64}$`. `amountCents` integer `minimum 1`. `method` optional (`minLength 1`). `voidReason` optional.
- `settlement.recorded/reversed` refs are `^(fxl-sales|fxl-finance):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` (a UUID). `recordedBy.app` is `^app\.[a-z0-9-]+$`. `recordedBy.displayName` `minLength 1`. `reason` optional on reversed.
- `ledger.checkpoint`: `items` `minItems 1`, each item `amountCents minimum 1`, `settlementDigest ^[0-9a-f]{64}$`, `hash ^[0-9a-f]{64}$`, `page minimum 1`.

Sales `sales_ops_sales.id`, `sales_ops_receivables.id`, `sales_ops_payables.id`, `sales_ops_settlements.id` are UUIDs, so they satisfy both the `[A-Za-z0-9_-]{1,64}` obligation pattern and the UUID settlement pattern.

## Repo facts this slice maps FROM (verified)

- `sales_ops_receivables`: `id` uuid, `label` (`N/M` installment or `MN/M` recurring), `dueDate` timestamptz, `amountBrl` integer cents, `method`, `status` `open|paid|void`, `revision` (>=1, monotonic per row).
- `sales_ops_payables`: `id` uuid, `beneficiaryName`, `kind` in `seller_commission|finder_commission|professional_cost|tax|other_cost` (`PayableKind` in `service.ts`), `dueDate`, `amountBrl`, `status`, `revision`. No `method` column.
- `sales_ops_sales`: `id`, `code`, `clientNameSnapshot`, `status`, `wonAt`.
- `sales_ops_settlements`: `id` uuid, `type` `baixa|estorno`, `reversesSettlementId` uuid|null (baixa id for an estorno), `paidOn` `date` mode `string` -> `YYYY-MM-DD`, `amountBrl`, `targetKind` `receivable|payable`, `receivableId`/`payableId`, `origin` `manual|finance`, `actorName` string|null, `reason` string|null.
- `asDateOnly(value: string|Date): string` in `apps/api/src/domains/sales-ops/ledger-dates.ts` - UTC-slice storage convention for `due_date`. Reuse it for `dueDate`; `paidOn` is already a civil day string.
- `isRecurringReceivableLabel(label): boolean` in `@fxl-sales/shared-utils/professional-split` - `label.startsWith('M')`. `buildSaleLedger` only persists recurring receivable ROWS when `recurring.cycles !== null`, so an INDEFINITE recurrence never yields a persisted receivable row (see Recurrence below).
- Voiding a row (`sale-edit-writes.ts`) sets `status:'void'` + revision bump and KEEPS `amountBrl` unchanged, so a voided obligation retains its nominal cents (>= 1).
- Driver is postgres.js via `drizzle-orm/postgres-js` (`apps/api/src/db/client.ts`); `getDb()`/`getAdminDb()`, `getAdminDb()` sets `app.fxl_admin='true'` at the connection level. `withTenant(db, orgId, fn)` (`service.ts`) opens `db.transaction` and calls `setTenantContext(tx, orgId)` (sets `app.current_org_id`) before `fn`. The hub session store (`apps/api/src/auth/hub-session-store.ts`) is the durable-store precedent.

## Design decisions (made here, do not ask)

### D1 - deepLinkPath: EMIT the warm path `/operacional/vendas/<saleId>`
The published `OBLIGATION_UPSERTED_V1_SCHEMA` lists `deepLinkPath` in `source.required`, so omitting it produces a schema-invalid payload the guard rejects. Omission is therefore not an option. Emit the warm team-detail path, byte-identical to the web `buildSaleDetailPath` (CLAUDE.md: `buildSaleDetailPath` builds `/operacional/vendas/<id>`, the Finance `deepLinkPath`). The API cannot import web code, so define a local pure `deepLinkPathForSale(saleId) => `/operacional/vendas/${saleId}``, with a comment pinning it to `apps/web/src/sales-ops/navigation.ts:buildSaleDetailPath`. The cold-entry (no-session) route that makes this link resolve on a fresh browser does not exist yet; that is a separate follow-up already recorded in the Hub prompt (section 7) and the OVERVIEW, and does not block emission because Finance concatenates this relative path with the Sales `web_url` from Hub discovery only when a signed-in operator clicks it. Record in AUDIT.md.

### D2 - obligation `kind` and counterparty `role` taxonomy (from the doubts audit, sections 6-9)
`nexo/knowledge/doubts/20260922-sales-finance-two-way-sync-audit.md` fixes the Sales taxonomy: obligation `kind` in `sale_installment|sale_recurring|seller_commission|finder_commission|professional_cost|tax|other_cost` (line 713) and `role` in `client|seller|finder|professional|tax|other` (line 515). Use those. NOTE the golden `OBLIGATION_UPSERTED_V1_EXAMPLE` uses `role:"customer"`; the repo's own integration decision says `client`. Follow the repo taxonomy (`client`). `role` is a free string (`minLength 1`), is NOT identity, and is NOT what the subset filter keys on (only `kind` is), so a role value never breaks dedup or exclusion; if Finance turns out to key on `role`, the single change point is `roleForPayableKind`/the receivable role constant. Record in AUDIT.md.

### D3 - "affiliate commission" is never produced from a `sales_ops` row
The FXL affiliate system (`commissions`/`payouts`) is a DIFFERENT table set, explicitly OUTSIDE this integration (Hub prompt section 7; doubts Q8 "As comissoes de afiliados entram? Nao"). The `sales_ops_payables` `seller_commission` and `finder_commission` ARE synced obligations (they appear in the obligation `kind` enum). Therefore the mapper NEVER emits candidate `kind='affiliate_commission'`; only `tax` payables map to an excluded kind. The `affiliate_commission` branch of `syncedObligationSubset` is a defensive shared-package rule that does not fire for Sales; the oracle still proves it excludes a synthetic `affiliate_commission` candidate. Record in AUDIT.md.

### D4 - recurrence derivation
- Installment receivable (`label` = `N/M`, no `M` prefix) -> `recurrence: 'none'`, `kind: 'sale_installment'`.
- Bounded recurring receivable (`label` = `MN/M`) -> `recurrence: 'fixed_count'`, `kind: 'sale_recurring'`. These ARE emitted (`fixed_count` is not excluded).
- Indefinite recurrence produces NO persisted receivable row (`buildSaleLedger` skips them), so `recurrence:'indefinite'` never arises from a real Sales row. The mapper never invents it; the oracle proves the filter excludes a synthetic `indefinite` candidate.
- Every payable -> `recurrence: 'none'` (payables carry no recurrence).

### D5 - amountCents guard
Every builder SKIPS a row whose `amountBrl < 1` (returns no envelope / omits the candidate), keeping every payload schema-valid (`amountCents minimum 1`). In practice materialized rows are always `>= 1` and voiding keeps the amount; this is defensive. Record as defensive-only.

### D6 - anti-echo at the builder
`buildSettlementEnvelope` returns `null` when the settlement row `origin === 'finance'`. Applying a remote fact must never re-emit it (Hub prompt section 5.5). Co-locating the guard with the builder makes it unit-testable in THIS slice even though the emission call site is slice 07.

### D7 - adapter runs SQL via `runner.execute` + a `$n`->drizzle-param converter
Both adapter forms translate the package's `(text, params)` into a drizzle `SQL` via a pure `rawWithParams(text, params)` and run it through `runner.execute(...)`. This is the "Drizzle `execute` with bound params" path the context pack calls for, avoids postgres.js private internals, and binds every `$n` occurrence (including repeats and out-of-order) correctly because it re-emits each occurrence as a fresh drizzle parameter. Rows come back as postgres.js row objects (`RowList`), returned as `R[]`. (bigint columns such as `position` come back as strings from postgres.js; the feed/publisher consumers in slices 05/08 wrap them with `BigInt(...)` - noted, not this slice's code.)

### D8 - adapter RLS scoping
- Tx-wrapping adapter (enqueue): built over the drizzle `tx` already inside `withTenant(db, orgId, ...)`, so `app.current_org_id` is set by the business transaction and the outbox INSERT (`organization_id = orgId`) passes the tenant policy. No extra context.
- Pooled adapter (publisher/feed/prune, consumed in slices 05/08): built over `getAdminDb()`, whose connection carries `app.fxl_admin='true'`; the publisher and prune are cross-tenant and `integration_outbox_position` is a global row, and the feed is ticket-authenticated (not tenant-session authenticated) and already filters `organization_id` in the package SQL. This slice only constructs the factory; the consumers pass `getAdminDb()`.

### D9 - idempotencyKey scheme (justification)
Idempotency is `(organizationId, idempotencyKey)`; re-emitting the same business fact must be a no-op, and a genuinely new fact must produce a new row.

| Event | idempotencyKey | Why |
|---|---|---|
| `obligation.upserted` | `obligation:<obligationRef>:rev:<revision>` | An obligation is upserted many times over its life; `revision` is the monotonic per-row version that only grows. Keying on it makes re-running the same won-materialization at the same revision a no-op, while a real change (revision bump on amount/due/status) is a distinct fact that MUST be delivered. Omitting revision would suppress every update after the first. |
| `settlement.recorded` | `settlement:<settlementRef>` | A baixa row is immutable and uniquely identified by its uuid ref. One event per baixa; a retry dedups. |
| `settlement.reversed` | `reversal:<reversalRef>` | An estorno row is immutable and uniquely identified by its own uuid ref. Distinct `reversal:` prefix keeps it unambiguous from any baixa key. |
| `ledger.checkpoint` | `checkpoint:<saleRef>:page:<page>:<digest>` where `digest = digestJson({ saleRef, page, items })` | A checkpoint's business fact is "the reconcilable state of this sale (page P) is exactly this". `asOf` (when we looked) is deliberately EXCLUDED from the key so re-checkpointing an unchanged ledger on a new day is a no-op, while any change to a `revision`/`state`/`amountCents`/`settlementDigest` yields a new key. Reuses the package's `digestJson` - no second digest. |

## Module and file list

### `apps/api/src/domains/integration/outbox-adapter.ts` (new)
The SQL adapter over the transport tables plus the enqueue seam. Imports: `sql`, type `SQL` from `drizzle-orm`; `enqueueIntegrationEvent`, types `SqlIntegrationAdapter`, `IntegrationEventEnvelope` from `@fxl-business/fxl-contracts`. No `getDb()` at module top level.

```ts
/** A drizzle db or tx: anything that can run a prepared SQL. */
export interface SqlRunner {
  execute(query: SQL): Promise<unknown>;
}
/** A runner that can also open a nested transaction (a top-level db). */
export interface TxCapableRunner extends SqlRunner {
  transaction<T>(fn: (tx: SqlRunner) => Promise<T>): Promise<T>;
}

/** Pure: translate a $1..$n placeholder query + params into a bound drizzle SQL.
 *  Every $n occurrence (repeats and any order) binds params[n-1] as a fresh param. */
export function rawWithParams(text: string, params: readonly unknown[]): SQL;

/** Adapter over an in-progress business tx (from withTenant). `transaction`
 *  runs the operation on the SAME tx (enqueue never nests); no new tx is opened. */
export function createIntegrationTxAdapter(tx: SqlRunner): SqlIntegrationAdapter;

/** Adapter over a pooled/top-level db (getAdminDb() for cross-tenant work).
 *  `transaction` opens a REAL drizzle transaction and re-wraps it. */
export function createIntegrationPooledAdapter(db: TxCapableRunner): SqlIntegrationAdapter;

/** The enqueue seam: build a tx-adapter over the ongoing business tx and delegate
 *  to the package. Call from INSIDE withTenant, in the same tx as the business act. */
export function enqueueEvent(tx: SqlRunner, event: IntegrationEventEnvelope): Promise<void>;
```

Adapter `query` implementation: `async <R>(text, params) => (await runner.execute(rawWithParams(text, params))) as unknown as R[]`. The tx-adapter's `transaction` is `(op) => op(self)`; the pooled adapter's `transaction` is `(op) => db.transaction((tx) => op(createIntegrationTxAdapter(tx)))`.

### `apps/api/src/domains/integration/events.ts` (new)
Pure builders. Imports: from `@fxl-business/fxl-contracts` the types/functions `syncedObligationSubset`, `reduceSettlement`, `settlementDigest`, `ledgerCheckpointHash`, `digestJson`, and types `ObligationCandidate`, `ObligationUpsertedV1`, `SettlementRecordedV1`, `SettlementReversedV1`, `LedgerCheckpointV1`, `LedgerCheckpointItemV1`, `SettlementInputFact`, `SettlementOrigin`, `ObligationSnapshot`, `IntegrationEventEnvelope`; `asDateOnly` from `../sales-ops/ledger-dates.js`; `isRecurringReceivableLabel` from `@fxl-sales/shared-utils/professional-split`; `PayableKind` type from `../sales-ops/service.js` (type-only). No clock, no crypto, no I/O.

Constants and ref helpers:
```ts
export const SALES_APP_ID = 'app.fxl-sales';
export const EVENT_VERSION_V1 = 1;
export const EVENT_OBLIGATION_UPSERTED = 'fxl-sales.obligation.upserted';
export const EVENT_SETTLEMENT_RECORDED = 'fxl-sales.settlement.recorded';
export const EVENT_SETTLEMENT_REVERSED = 'fxl-sales.settlement.reversed';
export const EVENT_LEDGER_CHECKPOINT = 'fxl-sales.ledger.checkpoint';

export function obligationRef(rowId: string): string;   // `fxl-sales:${rowId}`
export function settlementRef(rowId: string): string;    // `fxl-sales:${rowId}`
export function saleRef(saleId: string): string;         // `fxl-sales:${saleId}`
export function deepLinkPathForSale(saleId: string): string; // `/operacional/vendas/${saleId}`
```

Row input types (map straight from Drizzle `$inferSelect`, dueDate accepted as string|Date):
```ts
export type ReceivableRowForEvent = {
  id: string; label: string; dueDate: string | Date; amountBrl: number;
  method: string; status: 'open' | 'paid' | 'void'; revision: number;
};
export type PayableRowForEvent = {
  id: string; kind: PayableKind; beneficiaryName: string; dueDate: string | Date;
  amountBrl: number; status: 'open' | 'paid' | 'void'; revision: number;
};
export type ObligationRowInput =
  | { direction: 'receivable'; row: ReceivableRowForEvent }
  | { direction: 'payable'; row: PayableRowForEvent };

export type SaleObligationSource = { saleId: string; saleCode: string; clientName: string };

export type SettlementRowForEvent = {
  id: string; type: 'baixa' | 'estorno'; reversesSettlementId: string | null;
  paidOn: string | Date; amountBrl: number;
  targetKind: 'receivable' | 'payable'; receivableId: string | null; payableId: string | null;
  origin: 'manual' | 'finance'; actorName: string | null; reason?: string | null;
};

export type EmitMeta = { newId: () => string; occurredAt: Date }; // injected, keeps the module pure
```

Pure functions:
```ts
export function roleForPayableKind(kind: PayableKind): 'seller' | 'finder' | 'professional' | 'tax' | 'other';
export function obligationTargetId(input: ObligationRowInput): string;             // row.id
export function toObligationCandidate(input: ObligationRowInput): ObligationCandidate;
export function toObligationUpsertedPayload(source: SaleObligationSource, input: ObligationRowInput): ObligationUpsertedV1;

/** Runs syncedObligationSubset and wraps ONE envelope per INCLUDED obligation
 *  with amountBrl >= 1. eventName = EVENT_OBLIGATION_UPSERTED, version 1,
 *  idempotencyKey = `obligation:<ref>:rev:<revision>`. */
export function buildObligationUpsertedEnvelopes(
  organizationId: string, source: SaleObligationSource,
  obligations: readonly ObligationRowInput[], meta: EmitMeta,
): IntegrationEventEnvelope[];

/** null for origin='finance' (anti-echo) or amount < 1; otherwise a recorded/reversed
 *  envelope. `obligationRefFor(row)` uses receivableId/payableId per targetKind. */
export function buildSettlementEnvelope(
  organizationId: string, row: SettlementRowForEvent, meta: EmitMeta,
): IntegrationEventEnvelope | null;

/** Package fact from a settlement row: origin 'finance' -> 'remote', else 'local'. */
export function settlementFactFromRow(row: SettlementRowForEvent): SettlementInputFact;

export type CheckpointObligationInput = {
  rowId: string; revision: number; state: 'active' | 'voided';
  amountCents: number; settlements: readonly SettlementRowForEvent[];
};
/** Builds items via reduceSettlement + settlementDigest (the ONE reducer),
 *  hashes via ledgerCheckpointHash, wraps one envelope.
 *  idempotencyKey = `checkpoint:<saleRef>:page:<page>:<digestJson({saleRef,page,items})>`. */
export function buildLedgerCheckpointEnvelope(
  organizationId: string, saleId: string, asOf: string,
  obligations: readonly CheckpointObligationInput[], meta: EmitMeta, page?: number,
): IntegrationEventEnvelope;
```

## Mapping tables

### Receivable row -> `ObligationUpsertedV1`
| Payload field | Source |
|---|---|
| `obligationRef` | `obligationRef(row.id)` |
| `direction` | `'receivable'` |
| `kind` | `isRecurringReceivableLabel(row.label) ? 'sale_recurring' : 'sale_installment'` |
| `amountCents` | `row.amountBrl` (skip row if `< 1`) |
| `currency` | `'BRL'` |
| `dueDate` | `asDateOnly(row.dueDate)` |
| `method` | `row.method` (always present on receivables) |
| `counterparty` | `{ displayName: source.clientName, role: 'client' }` |
| `source` | `{ saleId: source.saleId, saleCode: source.saleCode, displayLabel: `Proposta ${source.saleCode} - ${row.label}`, deepLinkPath: deepLinkPathForSale(source.saleId) }` |
| `revision` | `row.revision` |
| `state` | `row.status === 'void' ? 'voided' : 'active'` |
| `voidReason` | omitted (Sales stores none on the row) |

### Payable row -> `ObligationUpsertedV1`
| Payload field | Source |
|---|---|
| `obligationRef` | `obligationRef(row.id)` |
| `direction` | `'payable'` |
| `kind` | `row.kind` literally (`seller_commission|finder_commission|professional_cost|tax|other_cost`) |
| `amountCents` | `row.amountBrl` (skip if `< 1`) |
| `currency` | `'BRL'` |
| `dueDate` | `asDateOnly(row.dueDate)` |
| `method` | omitted (payables carry no method) |
| `counterparty` | `{ displayName: row.beneficiaryName, role: roleForPayableKind(row.kind) }` |
| `source` | as receivable, `displayLabel: `Proposta ${source.saleCode} - ${row.beneficiaryName}`` |
| `revision` | `row.revision` |
| `state` | `row.status === 'void' ? 'voided' : 'active'` |

### Obligation -> `ObligationCandidate` (for the subset filter)
| Candidate field | Source |
|---|---|
| `obligationRef` | `obligationRef(row.id)` |
| `kind` | receivable: `sale_installment`/`sale_recurring`; payable: `row.kind` (so a `tax` payable -> excluded) |
| `recurrence` | receivable: `isRecurringReceivableLabel(label) ? 'fixed_count' : 'none'`; payable: `'none'` |
| `direction` | `input.direction` |
| `amountCents` | `row.amountBrl` |

`buildObligationUpsertedEnvelopes`: `candidates = obligations.map(toObligationCandidate)`; `included = syncedObligationSubset(candidates).included`; keep obligations whose `obligationRef(row.id)` is in the included set AND `row.amountBrl >= 1`; build payload; wrap envelope.

### `baixa` row -> `SettlementRecordedV1`
| Payload field | Source |
|---|---|
| `settlementRef` | `settlementRef(row.id)` |
| `obligationRef` | `obligationRef(row.targetKind === 'receivable' ? row.receivableId! : row.payableId!)` |
| `amountCents` | `row.amountBrl` |
| `paidOn` | `asDateOnly(row.paidOn)` (already a civil SP day) |
| `recordedBy` | `{ app: SALES_APP_ID, displayName: row.actorName ?? 'FXL Sales' }` |

Envelope: `eventName EVENT_SETTLEMENT_RECORDED`, version 1, `idempotencyKey = settlement:${settlementRef(row.id)}`, `occurredAt = meta.occurredAt` (wired to the row's `recordedAt` in slice 07).

### `estorno` row -> `SettlementReversedV1`
| Payload field | Source |
|---|---|
| `reversalRef` | `settlementRef(row.id)` |
| `reversesSettlementRef` | `settlementRef(row.reversesSettlementId!)` |
| `amountCents` | `row.amountBrl` |
| `reversedOn` | `asDateOnly(row.paidOn)` |
| `reason` | `row.reason ?? undefined` (omit when null) |
| `recordedBy` | `{ app: SALES_APP_ID, displayName: row.actorName ?? 'FXL Sales' }` |

Envelope: `eventName EVENT_SETTLEMENT_REVERSED`, version 1, `idempotencyKey = reversal:${settlementRef(row.id)}`.

Anti-echo: for either type, if `row.origin === 'finance'` return `null`.

### Settlement row -> package `SettlementInputFact` (`settlementFactFromRow`)
| Fact field | Source |
|---|---|
| `origin` | `row.origin === 'finance' ? 'remote' : 'local'` |
| baixa `kind` | `'settlement'`; `settlementRef`, `obligationRef`, `amountCents = row.amountBrl`, `paidOn = asDateOnly(row.paidOn)` |
| estorno `kind` | `'reversal'`; `reversalRef`, `reversesSettlementRef = settlementRef(row.reversesSettlementId!)`, `amountCents`, `reversedOn = asDateOnly(row.paidOn)` |

### Checkpoint obligation -> `LedgerCheckpointItemV1`
For each `CheckpointObligationInput`: `snapshot = { obligationRef: obligationRef(rowId), amountCents, state }`; `facts = settlements.map(settlementFactFromRow)`; `digest = settlementDigest(reduceSettlement(snapshot, facts))`; item = `{ obligationRef, revision, state, amountCents, settlementDigest: digest }`. `hash = ledgerCheckpointHash({ saleRef: saleRef(saleId), asOf, page, items })`.

## Named oracle tests

### `apps/api/src/domains/integration/__tests__/events.test.ts` (unit, vitest, run-once)
- **`builds schema-valid obligation.upserted envelopes from fixtures`** - a fixture won sale with one installment receivable, one recurring (`M1/12`) receivable, a `seller_commission` and a `professional_cost` payable; assert every built payload passes `isObligationUpsertedV1`, `eventName`/`eventVersion` correct, `deepLinkPath === '/operacional/vendas/<id>'`, `dueDate` matches `asDateOnly`, and the payload shape has the same key set as `OBLIGATION_UPSERTED_V1_EXAMPLE` (minus optionals).
- **`syncedObligationSubset excludes tax, indefinite recurrence and affiliate commission`** - candidates = the above PLUS a `tax` payable, a synthetic `indefinite` receivable candidate, and a synthetic `affiliate_commission` candidate; assert `buildObligationUpsertedEnvelopes` emits envelopes for exactly the installment/recurring/seller/professional set and NONE for tax/indefinite/affiliate.
- **`skips a zero-amount obligation`** - a row with `amountBrl: 0` yields no envelope (D5).
- **`builds schema-valid settlement.recorded / reversed`** - a `baixa` fixture passes `isSettlementRecordedV1` and a `estorno` fixture passes `isSettlementReversedV1`; refs match the UUID pattern; `paidOn`/`reversedOn` are civil days; `reason` omitted when null.
- **`a finance-origin settlement builds no envelope (anti-echo)`** - `origin:'finance'` -> `buildSettlementEnvelope` returns `null` for both types (D6).
- **`idempotencyKey is stable per business fact`** - obligation key is `obligation:<ref>:rev:<n>` and changes only when `revision` changes; settlement key `settlement:<ref>`; reversal key `reversal:<ref>`; two builds of the same row at the same revision produce the same key.
- **`builds a schema-valid ledger.checkpoint`** - two obligations (one active with a baixa, one voided) -> payload passes `isLedgerCheckpointV1`; `hash === ledgerCheckpointHash({saleRef,asOf,page,items})`; each `settlementDigest` equals `settlementDigest(reduceSettlement(...))`; idempotencyKey excludes `asOf` (same items, different `asOf` -> same key; changed revision -> different key).

### `apps/api/src/domains/integration/__tests__/outbox-adapter.test.ts` (unit)
- **`rawWithParams binds every $n in order`** - `rawWithParams('a=$1 and b=$2 and c=$1', [10,20])` produces a drizzle `SQL` whose bound params are `[10,20,10]` and whose raw fragments are `a=`, ` and b=`, ` and c=`, `` (inspect via `.getSQL()`/`.queryChunks` or by running through a fake dialect).
- **`the tx adapter forwards query text and params to runner.execute`** - a fake `SqlRunner` records the `SQL` handed to `execute` and returns `[]`; `adapter.query('insert into x(a) values ($1)', ['v'])` calls `execute` once with a SQL carrying param `'v'`; `adapter.query` returns the runner's rows as `R[]`.
- **`the tx adapter transaction reuses the same adapter`** - `adapter.transaction(op)` invokes `op` with the same adapter and does not open a nested transaction.
- **`the pooled adapter transaction opens one real transaction`** - a fake `TxCapableRunner` whose `transaction` records that it was called once and passes a child runner; assert `enqueueEvent`/`query` inside runs on the child.

### `apps/api/src/domains/integration/__tests__/outbox-adapter.integration.test.ts` (integration, `fxl_sales_test` DB, run-once)
Requires migration 0025 (slice 01) applied.
- **`enqueueEvent writes one pending row inside withTenant`** - inside `withTenant(getDb(), orgId, tx => enqueueEvent(tx, envelope))`, then read back: exactly one `integration_outbox` row for the org with `position IS NULL` and `published_at IS NULL`, payload round-trips.
- **`re-enqueuing the same fact is idempotent on (organization_id, idempotency_key)`** - two `enqueueEvent` calls with the same `organizationId`+`idempotencyKey` (different envelope `id`) leave exactly one row (ON CONFLICT DO NOTHING).
- **`the tenant policy scopes the outbox`** - a read under a different org's tenant context does not see the row (proves RLS + the slice-01 policies).

## Acceptance checklist (mirror of frontmatter)
See frontmatter `acceptance`. Verification for this slice: the two `__tests__` unit files plus the integration file pass; `pnpm run lint` and `pnpm run type-check` clean on the new files; no side-effectful import (a smoke test importing `events.ts`/`outbox-adapter.ts` opens no DB connection). Full-suite + build run at the wave boundary (OVERVIEW criterion 13), not per slice.
