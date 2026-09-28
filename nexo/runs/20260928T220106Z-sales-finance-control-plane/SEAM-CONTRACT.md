# SEAM CONTRACT (authoritative) - sales-finance-control-plane

This file resolves the plan-check FAIL (6 cross-slice seam gaps). It is AUTHORITATIVE: where a slice plan (`01-*.md` .. `09-*.md`) names a symbol, path, or value differently, THIS file wins and the executor uses these names. Every integration module lives under `apps/api/src/domains/integration/` unless stated otherwise.

## Canonical module map + exported symbols

### slice 03 - `outbox-adapter.ts` (all adapters live here, one owner)
- `type DrizzleTx` - the in-progress drizzle transaction type used by the repo (`PgTransaction`/the type `withTenant`/`db.transaction` hands its callback).
- `createIntegrationTxAdapter(tx: DrizzleTx): SqlIntegrationAdapter` - wraps an IN-PROGRESS business tx; `query` runs raw parameterized SQL on that same tx; carries the drizzle tx (see `drizzleTxOf`). Used by slice 07 (producer, in-tx) and by the consumer's per-event handler.
- `createIntegrationPooledAdapter(): SqlIntegrationAdapter` - over `getAdminDb()` (connection-level `app.fxl_admin`), for the position publisher, the feed route, and the prune job. Its `transaction()` opens a drizzle tx and the yielded adapter also carries that tx (so a consumer handler run through it can reach drizzle). This is the adapter the puller uses too.
- `hasDrizzleTx(adapter: SqlIntegrationAdapter): boolean` and `drizzleTxOf(adapter: SqlIntegrationAdapter): DrizzleTx` - the consumer handler calls `drizzleTxOf(tx)` to get the drizzle tx for `applyBaixaTx`/`applyEstornoTx`. `drizzleTxOf` throws if absent. The pooled adapter's `transaction()` MUST attach the drizzle tx so `hasDrizzleTx` is true inside `pullOnce`'s handler tx.

### slice 03 - `events.ts` (pure builders; no side effects, no origin logic)
- `buildObligationUpsertedEvents(input): IntegrationEventEnvelope[]` - active obligations (`state:'active'`); runs `syncedObligationSubset` internally and only returns included ones. `recordedBy` N/A. `source.deepLinkPath = "/operacional/vendas/<saleId>"` (REQUIRED by the v1 schema). `role` values must match the published `OBLIGATION_UPSERTED_V1_SCHEMA` enum (verify against the schema; if it constrains, map `client|seller|finder|professional|tax|other` to the schema's spelling - the golden uses `customer` for the client role, so confirm and map).
- `buildObligationVoidedEvents(input): IntegrationEventEnvelope[]` - `state:'voided'`, `voidReason` set from the caller.
- `buildSettlementRecordedEvent(input): IntegrationEventEnvelope` - `recordedBy.app = "app.fxl-sales"` (WITH the `app.` prefix).
- `buildSettlementReversedEvent(input): IntegrationEventEnvelope` - `recordedBy.app = "app.fxl-sales"`.
- `buildLedgerCheckpointEvent(...)` - MAY exist but is NOT emitted this run (see Non-goals).
- `enqueueSaleEvents(tx: SqlIntegrationAdapter, events: IntegrationEventEnvelope[]): Promise<void>` - loops `enqueueIntegrationEvent`.
- idempotencyKeys: `obligation:<ref>:rev:<n>`, `settlement:<ref>`, `reversal:<ref>`.

### slice 03 - `producer-gate.ts` (owner: 03; files_modified MUST list it)
- `isProducerFlowLive(orgId: string): boolean` - default returns `false`.
- `registerProducerFlowGate(fn: (orgId: string) => boolean): void` - the boot (slice 08) calls this once to install the real/fake activation predicate.

### slice 02 - `config.ts`
- `type IntegrationConfig`; `buildIntegrationConfig(env): IntegrationConfig | null` (null when unconfigured, throw on partial); `toAuthorityConfig(config): IntegrationAuthorityConfig`.

### slice 02 - `hub-client.ts`
- `type IntegrationDiscovery = { contracts(): Promise<...>; activations(): Promise<IntegrationPullPair[]>; producerActivations(): Promise<...> }` - the discovery interface used by 04 and 08. DEFINED HERE (04 imports the type from here).
- `createRealIntegrationAuthority(config: IntegrationConfig): IntegrationAuthority` where `type IntegrationAuthority = { ticketClient: TicketClient; verifier: IntrospectionVerifier; reporter: HeartbeatReporter; discovery: IntegrationDiscovery }` - SAME shape the fake authority is adapted to (see select seam). This is the single real factory 08 calls.
- re-export `organizationForFeedRead`.

### slice 02 - `heartbeat.ts`
- `collectHeartbeatInputs(state): HeartbeatInput[]` - assembles producer + consumer heartbeat inputs (metadata only) from cursor/lag/counter state.
- `createSalesHeartbeatReporter(config): HeartbeatReporter` (or reuse the authority's `reporter`).

### slice 04 - `consumer.ts`
- `createFinanceConsumer(deps: { adapter: SqlIntegrationAdapter; discovery: IntegrationDiscovery; ticketClient: TicketClient }): IntegrationPullerOptions` (handlers for `fxl-finance.settlement.recorded` v1 and `fxl-finance.settlement.reversed` v1 pre-registered) - 08 hands this to `startIntegrationPuller`. The puller adapter is `createIntegrationPooledAdapter()` (from 03) so handler txs carry the drizzle tx.
- Consumer expects incoming `recordedBy.app === "app.fxl-finance"`; `SUPPORTED_FINANCE_SETTLEMENT_VERSIONS = [1]`.
- `consumer-mapping.ts`: `deriveSettlementAnomaly(...)` (disputed / duplicidade derivations), the obligationRef->row resolver.

### slice 04 - `apps/api/src/domains/sales-ops/settlements.ts` (extraction)
- `applyBaixaTx(tx: DrizzleTx, input, policy): ...` and `applyEstornoTx(tx: DrizzleTx, input, policy): ...` exported, tx-accepting. `policy` is `{ mode: 'manual' } | { mode: 'finance', amountCents: number }`. The `manual` mode runs `validarNovaBaixa`/`validarEstorno` exactly as today; `finance` records the immutable remote fact (structural SP-day/cents checks only). `recordSettlement`/`reverseSettlement` keep their `withTenant` wrapper and delegate, so the HTTP routes are byte-identical.
- **Anti-echo = ONE choke point, and it lives HERE (added by slice 07):** at the end of `applyBaixaTx`/`applyEstornoTx`, `if (policy.mode === 'manual' && isProducerFlowLive(orgId)) { enqueueSaleEvents(createIntegrationTxAdapter(tx), [buildSettlement{Recorded,Reversed}Event(...)]) }`. The `finance` path never emits. Slice 04 LEAVES this hook point clearly marked and emission-free; slice 07 fills it. `events.ts` builders contain NO origin logic.

### slice 05 - `feed-routes.ts`
- `createIntegrationFeedRouter({ adapter, verifier }): Hono` with ONE route `GET /feed`. **Mounted by slice 08 at base `/integration/v1`** so the final path is exactly `/integration/v1/feed` (NOT `/integration/v1/feed/feed`). Org from `organizationForFeedRead(decision, ?organizationId)` only.

### slice 06 - `packages/auth-fake/src/index.ts`
- Adds `INTEGRADO` workspace = `FIXTURE_INTEGRATED_ORGANIZATION_ID` (imported from `@fxl-business/fxl-contracts/testing`) + a dedicated identity.
- Exports `getFakeIntegrationAuthority(): IntegrationAuthority`-shaped object (memoized singleton, built via `createFakeIntegrationAuthority({ activations, environment:'development', applicationId:'app.fxl-sales' })`, exposing `{ ticketClient, verifier, reporter }` and a discovery derived from the activations). Activations cover BOTH directions over the fixture org with the correct v1 event names.
- 06 does NOT edit `packages/auth-fake/package.json` (slice 01 owns that dep) and does NOT edit `apps/api/src/auth/select.ts` (slice 08 owns the boot seam).

### slice 08 - the boot seam
- **`apps/api/src/auth/select.ts` (EDIT - the ONLY file allowed by `auth-fake-isolation.test.mjs` to import `@fxl-sales/auth-fake`):** add `getIntegrationAuthority(): IntegrationAuthority` returning the fake authority (`getFakeIntegrationAuthority()` from `@fxl-sales/auth-fake`) when `SALES_AUTH_FAKE` is set, else `createRealIntegrationAuthority(buildIntegrationConfig(env))`. Do NOT create a separate `integration-authority-select.ts` (it would break the isolation allowlist).
- `start-integration.ts` (NEW): resolves the authority via `getIntegrationAuthority()` once at boot; calls `registerProducerFlowGate(orgId => authority.discovery`-backed activation check`)`; mounts the feed router at `/integration/v1`; starts the position publisher + heartbeat loop; starts the consumer puller ONLY when a real peer feed exists. **Fake mode: do NOT auto-start the puller loop** (the fake authority has no feed server; there is no Finance address), and start the publisher + feed + heartbeat. Consumer behavior in fake mode is exercised by the slice-09 E2E calling `pullOnce` directly with a simulated feed.
- `nightly-job.ts`: fourth task calling `pruneIntegrationOutbox` with `resolveOutboxLowWater()` returning `null` (fail-closed).
- 08 `depends_on` MUST include `06-fake-dev-fixture-authority` (for the select seam).

## Resolved values / decisions
- `recordedBy.app`: producer emits `app.fxl-sales`; consumer accepts only `app.fxl-finance`. (schema-verified against the golden examples.)
- `source.deepLinkPath`: REQUIRED; emit `/operacional/vendas/<saleId>`.
- `@fxl-business/fxl-contracts@0.1.0`: `dependencies` of BOTH `apps/api` and `packages/auth-fake` (auth-fake imports `/testing` in its own runtime code; it is kept out of prod because the apps depend on auth-fake as a devDependency and the web seam is DEV-gated). Slice 01 owns both package.json edits + the lockfile.
- RLS: slice-01's two-policy model (tenant_isolation on `app.current_org_id` + admin_context on `app.fxl_admin`) on the three org-scoped tables; admin-only on the global counter. The consumer sets `app.current_org_id` (via `setTenantContext`) inside the puller handler tx before the `sales_ops_*` writes; the transport-table writes (inbox/cursor) go through the admin policy. Delete slice-04's contradictory "admin-only required" wording.

## Non-goals (log in AUDIT, do not build)
- `fxl-sales.ledger.checkpoint` is NOT emitted in this run (a builder may exist for the future but nothing wires an emitter). If ever emitted, its ref prefix must follow `origin` so the Sales digest matches Finance for finance-origin settlements.
- No backfill of sales won before an Activation goes live (consistent with the A3 no-backfill stance).
- No real cross-process two-app delivery / cross-process ticket introspection (no Finance app + no real Hub in this repo); covered only by the in-repo simulated-feed E2E.
