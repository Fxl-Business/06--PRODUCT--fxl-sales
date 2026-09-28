# Integração Sales <-> Finance (plano de controle)

Reasoning, design and oracle names behind the `## Integração Sales-Finance (plano de controle)` section of `CLAUDE.md`.
Delivered by run `20260928T220106Z-sales-finance-control-plane` (autopilot).
Source of truth for the contract: `16--INTERNAL--fxl-hub/nexo/plans/platform-contratos-plano-de-controle/handoffs/PROMPT-SALES-integracao-plano-de-controle.md` and sections 10-11 of `nexo/knowledge/doubts/20260922-sales-finance-two-way-sync-audit.md`.

## Topology

The FXL Hub is the CONTROL PLANE; FXL Sales is a DATA PLANE.
The Hub answers only three questions (which event types/versions exist, which Contract links a producer Application to a consumer Application, and whether an Organization has that flow live and authorized now) and never stores a business payload.
Each app writes its own outbox in the SAME transaction as the business act, exposes a cursor feed, and pulls the peer's feed directly.
The Hub being down pauses sync for at most 60s and loses nothing, because the producer outbox holds events until the consumer returns.

## The package

`@fxl-business/fxl-contracts` is pinned EXACTLY at `0.1.0` (no caret/tilde) in `apps/api` and `packages/auth-fake`, in the same commit as the lockfile.
It has zero runtime/peer deps and reads no environment variable (it takes a config object).
The fake authority for dev lives ONLY under the `@fxl-business/fxl-contracts/testing` subpath; the root barrel never re-exports it, which keeps an accidental import visible in review.
Gate G5: the package must be published before integrating; a 404 on install is a STOP-and-report, never a vendored copy.

## What was already in place (not rebuilt)

PC2 in-place `updateSale` (`planSaleEdit`/`applySaleEditPlan`, ids preserved, exits become `void`/`removed_at`); `sales_ops_settlements` with `origin in ('manual','finance')` + the `FXS01` immutability trigger; `reduzirLiquidacao`; the settlement routes under `requireAdmin`; `statusCacheDaLinha`; `revision`+`updated_at` on receivables/payables; `SALE_TRANSITIONS`; the "won sale with an active baixa cannot leave won" guard; São Paulo-day dates; `asDateOnly` intentional.
The PC23 role gate had ALREADY landed before this run: `POST /sales/:id/transition`, `POST /sales/:id/cancel-contract`, `PUT /sales/:id`, `PUT /settings` are `requireAdmin`; only `POST /sales` stays open by design (seller lead conversion, with a body-level admin check for `status:'won'`).
So the section-10 "gate before production" was already satisfied and was not rebuilt.

## Transport (migration 0025)

`0025_integration_transport.sql` creates four tables from the package's reference DDL: `integration_outbox` (producer, `position` NULL until published), `integration_outbox_position` (the single global high-water counter, id `default`), `integration_inbox` (PK `integration_inbox_pkey` on `(producer_application_id, organization_id, idempotency_key)`), and `integration_cursor` (PK on `(producer_application_id, organization_id)`).
RLS follows the repo's two-policy model on the three org-scoped tables (`tenant_isolation` on `app.current_org_id` + `admin_context` on `app.fxl_admin`) and admin-only on the global counter.
Never assign a `position` at INSERT; positions are assigned after commit by the single elected publisher, so an uncommitted row can never take a position a reader would skip.

## The adapter seam

All adapters live in `apps/api/src/domains/integration/outbox-adapter.ts`.
`createIntegrationTxAdapter(tx)` wraps an in-progress Drizzle business tx (so `enqueueIntegrationEvent` runs on the same connection inside the sale/settlement transaction); `createIntegrationPooledAdapter()` runs over `getAdminDb()` for the publisher, feed, prune and the puller.
The pooled adapter's `transaction()` carries the Drizzle tx so a consumer handler can reach `drizzleTxOf(tx)`/`hasDrizzleTx(tx)` for its `sales_ops_*` writes.

## Producer

`events.ts` holds pure builders: `buildObligationUpsertedEvents` (runs `syncedObligationSubset`, `state:'active'`), `buildObligationVoidedEvents` (`state:'voided'` + `voidReason`), `buildSettlementRecordedEvent`, `buildSettlementReversedEvent`.
`recordedBy.app` is `app.fxl-sales` (WITH the `app.` prefix; the Hub prompt's `'fxl-finance'` shorthand was wrong, the published schema requires the prefix).
`source.deepLinkPath` is REQUIRED by the v1 schema and is emitted as `/operacional/vendas/<saleId>` (matching `buildSaleDetailPath`).
`obligationRef` is `fxl-sales:<row uuid>`, never a label/parcela number; idempotency keys are `obligation:<ref>:rev:<n>`, `settlement:<ref>`, `reversal:<ref>`.
`syncedObligationSubset` excludes tax; indefinite recurrence is excluded upstream; affiliate `payouts` is a different system, out of scope (only `tax` maps to an excluded kind from a sales_ops row).
`producer-gate.ts` holds `isProducerFlowLive(orgId)` (default false) and `registerProducerFlowGate(fn)`; the boot registers the real/fake activation predicate once.

## Emission call sites (slice 07)

Emission runs INSIDE the same business tx, gated on `isProducerFlowLive(orgId)`, so an unconnected org emits nothing and behaves exactly as today, and a rollback drops the event.
`createSale`(won) and `transitionSale`(->won) emit upserts; `transitionSale`(won->open) emits voids (`contract-reverted`); `cancelContract` emits voids (`contract-cancelled`); `updateSale`(won) emits upserts + voids (`edited-out-of-plan`); the settlement record/reverse emit inside the shared writers.
Anti-echo is ONE choke point, inside `applyBaixaTx`/`applyEstornoTx` in `settlements.ts`, guarded by `policy.mode === 'manual' && isProducerFlowLive(orgId)`; the finance path never emits.
Draft/open/lost emit nothing.

## Consumer

`consumer.ts` `createFinanceConsumer({ adapter, discovery, ticketClient })` returns the puller options with handlers for `fxl-finance.settlement.recorded` v1 and `fxl-finance.settlement.reversed` v1.
Each handler applies the remote fact through the ONE settlement writer (`applyBaixaTx`/`applyEstornoTx` with `policy.mode: 'finance'`, `origin='finance'`), reusing the remote settlement uuid as the local `sales_ops_settlements.id` for a deterministic reversal mapping.
It accepts only `recordedBy.app === 'app.fxl-finance'`; `SUPPORTED_FINANCE_SETTLEMENT_VERSIONS = [1]` (N, N-1); a permanent reject (unknown version, bad shape/ref/cents, non-finance origin, estorno amount mismatch) is counted toward `rejectedCount` and lets the cursor advance past the poison event; only a reversal citing a not-yet-landed baixa throws to retry.
`deriveSettlementAnomaly` is a pure derivation (disputed = active baixa on a voided row; "registrada em duplicidade" = overpaid with more than one active baixa) with no new status enum or column; the immutable `origin='finance'` fact is what is recorded, and `statusCacheDaLinha` stays mirror-parity-locked.

## Feed, hub client, heartbeat, prune, boot

`feed-routes.ts` `createIntegrationFeedRouter({ adapter, verifier })` exposes `GET /feed`, mounted by the boot at base `/integration/v1` (final path `/integration/v1/feed`); the Organization comes ONLY from `organizationForFeedRead(decision, ?organizationId)`, a disagreeing query org is `403`, an inactive/absent ticket is `401` with no reason, `unavailable` is `503`, bigints serialize as decimal strings, and the ticket is never logged.
`hub-client.ts` `createRealIntegrationAuthority(config)` returns `{ ticketClient, verifier, reporter, discovery }` built from the EXISTING hub config (no new `FXL_HUB_*` var), Basic-authed with the app's client credential.
`heartbeat.ts` `collectHeartbeatInputs`/`createSalesHeartbeatReporter` sends metadata only.
`start-integration.ts` resolves the authority ONCE via `getIntegrationAuthority()` in `apps/api/src/auth/select.ts` (the only file the `auth-fake-isolation` guard allows to import `@fxl-sales/auth-fake`), registers the producer gate, mounts the feed router, and starts one publisher + one heartbeat loop; the puller starts ONLY in real mode (fake mode has no peer feed server); no loop auto-starts under `NODE_ENV=test`; `server.ts` reaches it via `await import(...)` keeping the static-import discipline, with graceful shutdown.
The nightly prune calls `pruneIntegrationOutbox` with a fail-closed `null` low-water (the pilot exposes no consumer-cursor read), so it deletes nothing and never drops below `OUTBOX_MIN_RETENTION_DAYS` (30).

## Fake-dev

`packages/auth-fake` adds a fourth fixture org `INTEGRADO` whose id is imported as `FIXTURE_INTEGRATED_ORGANIZATION_ID` (never hand-typed) plus the `integrated-owner` identity, and exports `getFakeIntegrationAuthority()` (a memoized singleton built with `environment:'development'`, both-direction activations over the fixture org).
The dev seed already seeds a won sale for every roster org, so the fixture org is seeded for free.
`assert-web-bundle-clean` and `auth-fake-isolation` stay green: the `/testing` subpath and the authority never enter the web/prod bundle.

## Oracles (named locked tests)

- `apps/api/test/rls/integration-transport-schema.test.ts` (0025 tables/indexes/RLS; counter assertions are isolation-safe: assert the seeded column default and that the tenant context leaves the counter unchanged, never a fixed live value).
- `scripts/__tests__/fxl-contracts-pin.test.mjs` (exact `0.1.0` pin; wired into root `pnpm test`).
- `apps/api/src/domains/integration/__tests__/{events,outbox-adapter,producer-gate,config,hub-client,heartbeat,consumer-mapping}.test.ts` and `{outbox-adapter,consumer,feed-route,finance-integration}.integration.test.ts`.
- `apps/api/src/domains/sales-ops/__tests__/producer-emission.integration.test.ts` (emission in-tx, unconnected emits nothing, finance-origin emits nothing).
- `apps/api/src/domains/sales-ops/__tests__/settlements.test.ts` guard: asserts exactly two `enqueueSaleEvents` sites, both behind the manual+live gate (the anti-echo choke point).
- `packages/auth-fake/src/__tests__/integration-authority.test.ts` and the `roster.test.ts` (4 orgs).
- E2E: `apps/api/src/domains/integration/__tests__/finance-integration.integration.test.ts` covers the five operator cases over `org_fake_integrado` with the fake authority as the Hub and a simulated Finance feed (only `fetchFeedPage` doubled).

## Known non-goals / gaps (this run)

`fxl-sales.ledger.checkpoint` is NOT emitted (a builder may exist for the future; nothing wires an emitter). If ever emitted, its ref prefix must follow `origin` so the Sales digest matches Finance for finance-origin settlements.
No backfill of sales won before an Activation goes live (A3 no-backfill stance).
The cold-entry (no-session) deep-link route does not exist yet; the warm path resolves for a signed-in operator.
No real cross-process two-app delivery, cross-process ticket introspection, or real-Hub path is exercised here: the Finance side of the layer does not exist in this repo, so the E2E uses a simulated Finance feed. The untested cross-process cases are listed verbatim in the run's `AUDIT.md`.
