---
id: 07-wire-producer-emission
milestone: v4.1.0
status: todo
depends_on: [03-producer-outbox-and-events, 04-consumer-inbox-puller]
files_modified: [apps/api/src/domains/sales-ops/service.ts, apps/api/src/domains/sales-ops/settlements.ts]
acceptance:
  - A sale created directly as `won` (`createSale`, `input.status === 'won'`) in a CONNECTED org enqueues one `fxl-sales.obligation.upserted` v1 row per surviving obligation (after `syncedObligationSubset`) INSIDE the same `withTenant` transaction; the same sale in an UNCONNECTED org enqueues nothing and behaves byte-identically to today.
  - `transitionSale` on `-> won` enqueues obligation upserts (state `active`) for every surviving obligation in the same tx; on `won -> open` enqueues obligation upserts with `state: 'voided'` and `voidReason` ONLY for the payables it voids (receivables stay `open` and emit nothing); `-> lost`, `-> cancelled` and any transition in an unconnected org emit nothing.
  - `cancelContract` enqueues `state: 'voided'` upserts (voidReason `contract-cancelled`) for exactly the receivables and payables it voids, in the same tx.
  - `updateSale` on a `won` sale enqueues `active` upserts for inserted/updated obligations and `voided` upserts for obligations that left the plan, reusing the STABLE persisted row ids as `obligationRef`; a `draft`/`open` edit emits nothing.
  - `recordSettlement` enqueues `fxl-sales.settlement.recorded` v1 and `reverseSettlement` enqueues `fxl-sales.settlement.reversed` v1 in the same tx, but ONLY when the settlement row's `origin === 'manual'`; a settlement applied by the consumer with `origin === 'finance'` enqueues NOTHING (anti-echo).
  - Emission is inside the existing business transaction, so a rollback drops the event (zero outbox rows); no existing business behavior for unconnected orgs changes; all amounts are integer cents; all dates are São Paulo civil days.
  - Named oracle `producer-emission.integration.test.ts` passes: connected won sale / baixa / estorno enqueue the expected outbox rows in the same tx; a forced rollback leaves zero rows; an unconnected org enqueues nothing; a `finance`-origin settlement enqueues nothing.
---

# Slice 07 - Wire producer emission into the sale/settlement transactions

## Goal

Call the producer emit seam INSIDE the same transaction as each business act that produces a Sales-owned obligation or settlement fact, gated on the Organization having a live producer Activation, and never for a fact that a consumer applied (anti-echo).
This slice adds NOTHING new to the schema, the package, the builders, the adapter, the gate, or the settlement writer.
It only inserts call sites into two existing files.

## What this slice does NOT do (reused verbatim from upstream slices, never rebuilt here)

- The outbox table, the tx-wrapping adapter, `enqueueIntegrationEvent`, the event builders and `syncedObligationSubset` filtering all come from slice 03.
- The tx-accepting settlement-apply and the `origin` parameter come from slice 04.
- The activation/connectivity data comes from slice 02, injected at boot by slice 08.
- The position publisher, feed route, puller, heartbeat and prune are OTHER slices; this slice writes only the enqueue call sites.
- `planSaleEdit` / `applySaleEditPlan` / `materializeWonPayables` / `buildSaleLedger` / `SALE_TRANSITIONS` / the "won sale with an active baixa cannot leave won" guard / `statusCacheDaLinha` are untouched.

## Upstream seam contract (consumed by this slice; provided by slices 03 and 04)

The executor calls these exact symbols. If any is missing when this slice runs, that is a dependency violation - STOP and report; do not invent a local copy.

From slice 03 (`apps/api/src/domains/integration/`, pure/testable modules):

1. `enqueueSaleEvents(tx: Db, events: readonly IntegrationEventEnvelope[]): Promise<void>` - wraps the ongoing Drizzle `tx` as a `SqlIntegrationAdapter` (via `tx.execute(sql.raw(...))` with bound params) and calls `enqueueIntegrationEvent(adapter, event)` for each envelope, on the SAME connection/transaction. A `[]` is a no-op. (Slice 03 file hint: `outbox-adapter.ts`.)
2. Pure event builders (slice 03 file hint: `events.ts`), each returning `IntegrationEventEnvelope[]`, that OWN payload shaping, `syncedObligationSubset` filtering, `obligationRef`/`settlementRef` construction, `idempotencyKey`, envelope `id`, `occurredAt`, `eventName`/`eventVersion`, and the `deepLinkPath`/`source` block:
   - `buildObligationUpsertedEvents(input: { orgId; sale: SaleContext; obligations: ObligationRowInput[]; state: 'active' | 'voided'; voidReason?: string; now: Date }): IntegrationEventEnvelope[]`
     - It runs each obligation through `syncedObligationSubset` (excludes `tax`, indefinite recurrence, affiliate commission) and drops the excluded ones. State `active` and `voided` both flow through the SAME builder; a `voided` call carries `voidReason`.
   - `buildSettlementRecordedEvent(input: { orgId; sale: SaleContext; settlement: SettlementRowInput; obligationRef: string; actor: CadastroActor; now: Date }): IntegrationEventEnvelope[]`
   - `buildSettlementReversedEvent(input: { orgId; sale: SaleContext; estorno: SettlementRowInput; reversesSettlementId: string; obligationRef: string; actor: CadastroActor; now: Date }): IntegrationEventEnvelope[]`
   - `SaleContext`, `ObligationRowInput`, `SettlementRowInput` are the builder's own input types (slice 03 defines them). This slice passes the persisted rows and sale record described per call site below; it does not shape payloads.

3. The connectivity gate (slice 03 file hint: `producer-gate.ts`; a holder with no compile-time dependency on slice 02):
   - `isProducerFlowLive(orgId: string): boolean` - returns `true` only when `orgId` has a LIVE producer Activation for the Sales -> Finance contract right now.
   - `registerProducerFlowGate(fn: ((orgId: string) => boolean) | null): void` - sets the backing check; slice 08 wires slice 02's activation cache in (real mode) or slice 06's fake authority activations in (fake mode). When unset (the default), `isProducerFlowLive` returns `false`.

From slice 04 (`apps/api/src/domains/sales-ops/settlements.ts`): a tx-accepting settlement-apply, extracted so both `POST /settlements` and the finance consumer reuse it, carrying an `origin: 'manual' | 'finance'` parameter and returning the inserted settlement row plus the resolved target obligation ref/row. This slice adds the emission INSIDE that shared apply, guarded on `origin === 'manual'` (see "Anti-echo").

## Decision: how "connected" is known in-process (RECORD in AUDIT.md)

- The gate is the single predicate `isProducerFlowLive(orgId)` from slice 03's `producer-gate.ts`.
- Its backing check is injected once at boot (`registerProducerFlowGate`, slice 08), never per request. In real mode the backing check reads slice 02's cached `GET /integration/activations` state (refreshed on the puller/heartbeat cadence, bounded by the same revocation ceiling the rest of the integration uses); in fake mode it reads the `activations` list handed to `createFakeIntegrationAuthority` (slice 06).
- It is FAIL-CLOSED and DEFAULT-CLOSED: with no gate registered (every current unit test, and any process that has not wired the integration) it returns `false`, so no emission happens and every sale/settlement behaves exactly as today. This is what lets slice 07 land WITHOUT editing a single existing service/settlement unit test.
- Rationale for a module-level registered holder rather than a threaded parameter: the sale/settlement service functions are module-level (`createSale(db, orgId, ...)`), called from routes and dozens of tests; threading a gate through every caller is invasive and off-scope for a two-file slice. The holder keeps the call-site edits to one guard each, is injectable for the oracle test, and defaults closed. (Alternatives considered and rejected: a new required parameter on all five functions - breaks every caller and test; reading activation state from the DB per act - a per-request branch the integration prompt forbids.)

## Anti-echo (hard rule)

- A settlement row applied by the consumer carries `origin === 'finance'`; a manual baixa/estorno carries `origin === 'manual'` (already the literal in `recordSettlement`/`reverseSettlement`, and parameterized by slice 04's shared apply for the consumer).
- The settlement emission lives at ONE choke point: INSIDE slice 04's shared tx-accepting apply, immediately after the settlement row is inserted and its status cache written, guarded by `if (settlement.origin === 'manual' && isProducerFlowLive(orgId))`. Because the finance consumer flows through the SAME apply with `origin === 'finance'`, it provably enqueues nothing. There is no second guard elsewhere.
- Obligation upserts have no echo risk (obligations are Sales-owned; the consumer never writes them), so they are gated on `isProducerFlowLive(orgId)` alone.

## Uniform emission strategy at every call site

At each site, AFTER the business writes complete and while still inside the `withTenant` `tx`:

1. If `!isProducerFlowLive(orgId)` do nothing (early skip; zero queries, zero rows). Obligation sites use this guard; the settlement site combines it with the `origin === 'manual'` guard above.
2. Re-select the AFFECTED obligation rows by id from `salesOpsReceivables` / `salesOpsPayables` on `tx`, selecting ALL columns so the POST-write `revision` and `status` are accurate (revision bumps have already been applied by the business writes). Re-selection - rather than expanding each `.returning()` - keeps revisions correct and the strategy identical across all four obligation sites.
3. Hand the rows + the sale record + `now` to the slice 03 builder, which filters via `syncedObligationSubset` and returns envelopes.
4. `await enqueueSaleEvents(tx, events)`.

Because every enqueue runs on the business `tx`, a rollback drops both the business rows and the events atomically.

## Call sites (exact insertion points)

All line numbers are anchors at planning time; the executor MUST re-locate by the quoted code, not the number.

### 1. `createSale` (service.ts ~2394-2536) - direct `won`

- Insertion point: at the END of the `withTenant` callback, immediately BEFORE `return { sale, ledger, payables };` (~line 2534), inside `if (input.status === 'won')` semantics - i.e. only emit when `input.status === 'won'` (a `draft`/`open` create emits nothing).
- Affected obligations: for a brand-new won sale, ALL of its rows are the emit set. Re-select on `tx`: `salesOpsReceivables` and `salesOpsPayables` `WHERE orgId = orgId AND saleId = sale.id AND status <> 'void'` (all columns).
- Emit: `buildObligationUpsertedEvents({ orgId, sale, obligations: [...receivables, ...payables], state: 'active', now })` -> `enqueueSaleEvents(tx, events)`.
- Note: the existing payables `INSERT` (~2523) does not `.returning()`; do NOT change it - the re-select supplies the payable rows with their ids.

### 2. `transitionSale` (service.ts ~2666-2786)

Two emitting branches; `-> lost` and `-> cancelled` emit nothing.

- `to === 'won'` branch (after the payables `INSERT` at ~2753 and after `patch` is set, before the final sale `UPDATE`, or right after it - both are inside `tx`): re-select all non-void receivables + payables for the sale (as in createSale) and emit `state: 'active'` upserts. This covers a sale that reached `won` via `open -> won` or `draft -> won`.
- `to === 'open'` branch WHEN `sale.status === 'won'` (~2759-2771): the code voids the `open` payables. Capture them: change that `UPDATE ... set({ status: 'void', ...payableRevisionBump() })` to add `.returning()` (all columns, post-bump), bind to a local `voidedPayables`. Then emit `buildObligationUpsertedEvents({ orgId, sale, obligations: voidedPayables, state: 'voided', voidReason: 'contract-reverted', now })`. Receivables stay `open` and emit NOTHING.
  - `voidReason` value for a won->open revert: `'contract-reverted'` (RECORD in AUDIT.md; keep distinct from cancelContract's `'contract-cancelled'`).
- Gate both branches on `isProducerFlowLive(orgId)`.

### 3. `cancelContract` (service.ts ~2794-2898)

- The two void `UPDATE`s (~2872 receivables, ~2877 payables) currently `.returning({ id })`. Change both to `.returning()` (all columns, post-bump) so the full voided rows are available.
- Insertion point: before `return { ok: true, ... }` (~2891), gated on `isProducerFlowLive(orgId)`.
- Emit: `buildObligationUpsertedEvents({ orgId, sale, obligations: [...voidedReceivables, ...voidedPayables], state: 'voided', voidReason: 'contract-cancelled', now })` -> `enqueueSaleEvents(tx, events)`.
- If `futureIds.length === 0` (nothing voided) the arrays are empty and the builder returns `[]`; no event.

### 4. `updateSale` (service.ts ~2551-2642) - editing a `won` sale

- The plan is `plan` (`SaleEditPlan`), applied by `applySaleEditPlan(tx, orgId, saleId, plan, now)` (~2638). Emit AFTER that call, before `return { ok: true, sale, ledger };` (~2640).
- Emit ONLY when `existing.status === 'won'` (a `draft`/`open` edit emits nothing; payables do not exist there and receivables are pre-won drafts).
- Affected obligation ids from the plan (stable persisted ids, PC2):
  - active set (receivables): `plan.receivables.inserts.map(r => r.id)` ∪ `plan.receivables.updates.map(r => r.id)`
  - active set (payables): `plan.payables.inserts.map(r => r.id)` ∪ `plan.payables.updates.map(r => r.id)`
  - voided set (receivables): `plan.receivables.voids`
  - voided set (payables): `plan.payables.voids`
- Re-select each set by id on `tx` (all columns; post-write revision/status). Then two builder calls, both gated on `isProducerFlowLive(orgId)`:
  - `buildObligationUpsertedEvents({ orgId, sale, obligations: activeReceivables ∪ activePayables, state: 'active', now })`
  - `buildObligationUpsertedEvents({ orgId, sale, obligations: voidedReceivables ∪ voidedPayables, state: 'voided', voidReason: 'edited-out-of-plan', now })`
  - `voidReason` for an edit-driven void: `'edited-out-of-plan'` (RECORD in AUDIT.md).
- `enqueueSaleEvents(tx, [...activeEvents, ...voidedEvents])` (one enqueue call is fine; envelopes are independent).

### 5. `recordSettlement` / `reverseSettlement` (settlements.ts ~381-505) - via slice 04's shared apply

- Emission lives INSIDE slice 04's extracted tx-accepting apply, after the `INSERT` into `salesOpsSettlements` and after `writeStatusCache`, guarded by `if (inserted.origin === 'manual' && isProducerFlowLive(orgId))`.
- The apply already knows the settlement `type` (`'baixa'` | `'estorno'`), the inserted row, the actor, and the resolved target row/kind, so it can compute `obligationRef = 'fxl-sales:' + targetRow.id` (the builder does the `fxl-sales:` prefix; pass the raw id) and choose the builder:
  - `type === 'baixa'`  -> `buildSettlementRecordedEvent({ orgId, sale, settlement: inserted, obligationRef, actor, now })`
  - `type === 'estorno'` -> `buildSettlementReversedEvent({ orgId, sale, estorno: inserted, reversesSettlementId: inserted.reversesSettlementId!, obligationRef, actor, now })`
- `await enqueueSaleEvents(tx, events)` on the same `tx`.
- `recordSettlement`/`reverseSettlement` bodies themselves get NO enqueue call - all settlement emission is the single guarded block inside the shared apply. This is the anti-echo choke point.

## Shared-file sequencing with slice 04 (settlements.ts)

- Slices 04 and 07 BOTH edit `apps/api/src/domains/sales-ops/settlements.ts`. Per the overview wave shape, 04 lands first (Wave 3) and 07 after (Wave 4); this slice's `depends_on` names 04 for exactly that reason.
- The executor MUST build on the settlements.ts that slice 04 left: the shared tx-accepting apply with its `origin` parameter must already exist. If slice 04 did NOT extract it (e.g. it kept two inline writers), STOP and report a dependency gap rather than re-shaping the settlement writer here - re-extraction is slice 04's scope, not slice 07's.
- Do not merge 07 before 04. If both are open at once, rebase 07 on 04's merged settlements.ts before touching it.

## Non-negotiable constraints honored

- Emission is INSIDE the existing `withTenant`/`db.transaction`; a rollback never leaves an orphan event (the outbox row is born on the same tx and dies with it).
- Unconnected orgs: `isProducerFlowLive` returns `false` -> the guard skips before any re-select or enqueue -> identical behavior and identical query count to today.
- Integer cents only (`amountBrl` is cents; builders keep it integer). Dates are São Paulo civil days already stored on the rows (`paidOn`, `dueDate` via `asDateOnly`); this slice passes them through, never re-derives via `new Date`.
- `obligationRef`/`settlementRef` derive from STABLE persisted ids (PC2 preserves them), never from labels or parcela numbers.
- `deepLinkPath` inside `obligation.upserted.source` is the builder's concern (slice 03). The feature-level decision (emit the warm `/operacional/vendas/<id>` path vs omit) is recorded in AUDIT.md by slice 03; this slice does not construct it.

## Named oracle test

Add `apps/api/src/domains/sales-ops/__tests__/producer-emission.integration.test.ts` (VITEST_INTEGRATION, real service functions through `getDb()` with RLS live, fixtures via `getAdminDb()`, settlements removed only via `deleteSettlementsForOrgs`, same harness as `settlements.integration.test.ts`). Register a fake gate in `beforeEach` via `registerProducerFlowGate((orgId) => orgId === CONNECTED_ORG_ID)` and clear it in `afterEach` (`registerProducerFlowGate(null)`). Cases:

1. `enqueues obligation upserts for a won sale in a connected org, in the same tx` - `createSale` (or `open -> won` via `transitionSale`) on `CONNECTED_ORG_ID`; assert `integration_outbox` (read on `getDb()` under the tenant, RLS-scoped) has one `fxl-sales.obligation.upserted` v1 row per surviving obligation, `position IS NULL`, and NONE for a `tax` payable (proves `syncedObligationSubset` ran).
2. `enqueues settlement.recorded for a manual baixa and settlement.reversed for its estorno` - `recordSettlement` then `reverseSettlement` on a won sale in `CONNECTED_ORG_ID`; assert the two settlement events with `obligationRef`/`settlementRef` = `fxl-sales:<id>` and integer `amountCents`.
3. `enqueues NOTHING for a finance-origin settlement` - drive slice 04's shared apply with `origin: 'finance'` (the consumer path) on `CONNECTED_ORG_ID`; assert zero new outbox rows (anti-echo).
4. `enqueues NOTHING in an unconnected org` - repeat case 1 and case 2 on `UNCONNECTED_ORG_ID` (gate returns `false`); assert zero outbox rows and that the sale/settlement rows are written exactly as today.
5. `a rolled-back transaction leaves zero outbox rows` - run `createSale`/`recordSettlement` inside a `db.transaction` that throws after the service call (or use a service call forced to fail after enqueue); assert `integration_outbox` has zero rows for that org (event and act are atomic).
6. `won -> open voids only payables` - `transitionSale('open')` on a won sale in `CONNECTED_ORG_ID`; assert `state: 'voided'` upserts for the payables only, and NO event for any receivable (they stay `open`).

## Executor checklist

- [ ] Re-locate all five call sites by quoted code, not line number.
- [ ] Add the `isProducerFlowLive(orgId)` guard at sites 1-4 and the combined `origin === 'manual' && isProducerFlowLive(orgId)` guard inside slice 04's shared apply for site 5.
- [ ] Change `transitionSale` won->open payable void `UPDATE` and both `cancelContract` void `UPDATE`s to `.returning()` (all columns).
- [ ] Import `enqueueSaleEvents`, the three builders, and the gate from the slice 03 integration modules; import `isProducerFlowLive` where used.
- [ ] Write `producer-emission.integration.test.ts` with the six cases.
- [ ] Locked oracle for this slice: `producer-emission.integration.test.ts`, plus the untouched-green `settlements.integration.test.ts` and `sale-transitions.integration.test.ts` (prove no behavior regression for unconnected orgs). Lint changed files.
- [ ] Record in AUDIT.md: the connectivity-gate decision, the three `voidReason` string choices (`contract-reverted`, `contract-cancelled`, `edited-out-of-plan`), and that no existing service/settlement unit test was edited.
