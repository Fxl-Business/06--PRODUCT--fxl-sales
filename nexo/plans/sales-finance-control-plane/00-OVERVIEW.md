---
feature: sales-finance-control-plane
run: 20260928T220106Z-sales-finance-control-plane
milestone: v4.1.0
mode: autopilot
status: planning
---

# Sales <-> Finance integration via the Hub control plane

## What and why

The FXL Hub is the CONTROL PLANE and FXL Sales is a DATA PLANE.
The Hub only answers three questions (which event types/versions exist, which Contract links a producer Application to a consumer Application, and whether a given Organization has that flow live and authorized right now).
No business payload ever enters the Hub: no queue, no ingest, no sweeper, no dead letter.
Each app writes its own outbox in the SAME transaction as the business act, exposes its own cursor feed, and pulls the peer's feed DIRECTLY.

This run makes FXL Sales both a PRODUCER and a CONSUMER over that topology, using the published `@fxl-business/fxl-contracts@0.1.0` package (helpers, reducer, schemas, fake authority), and wires emission into the sale/settlement transactions that already exist.
The source of truth is `16--INTERNAL--fxl-hub/nexo/plans/platform-contratos-plano-de-controle/handoffs/PROMPT-SALES-integracao-plano-de-controle.md` plus sections 10-11 of `nexo/knowledge/doubts/20260922-sales-finance-two-way-sync-audit.md`.
Product decisions are already made; any remaining decision is chosen here and recorded in `AUDIT.md`.

Producer of four event types: `fxl-sales.obligation.upserted` v1, `fxl-sales.settlement.recorded` v1, `fxl-sales.settlement.reversed` v1, `fxl-sales.ledger.checkpoint` v1.
Consumer of two: `fxl-finance.settlement.recorded` v1 and `fxl-finance.settlement.reversed` v1.

## Preflight already established (Passo 0, all green)

- `@fxl-business/fxl-contracts@0.1.0` is published; all 32 root symbols and both `/testing` symbols (`createFakeIntegrationAuthority`, `FIXTURE_INTEGRATED_ORGANIZATION_ID`) are exported; the fake authority does not leak into the root barrel; `schema/integration-transport.sql` ships; zero runtime/peer deps.
- Baseline suites green before any change: unit 1953 (auth-fake 35 + shared-utils 155 + api 680 + web 1083), integration 272.
- Code-vs-prompt drift confirmed and logged: PC23 already landed, so `POST /sales/:id/transition`, `POST /sales/:id/cancel-contract`, `PUT /sales/:id`, `PUT /settings` are ALREADY `requireAdmin`; only `POST /sales` stays intentionally open (seller lead conversion, body-level admin check for `status:'won'`). The section-10 role gate is therefore already done and is NOT rebuilt here.
- Confirmed present and reused, never rebuilt: PC2 in-place `updateSale` (`planSaleEdit`/`applySaleEditPlan`, ids preserved, exits become `void`/`removed_at`); `sales_ops_settlements` with `origin in ('manual','finance')` + `FXS01` immutability trigger; `reduzirLiquidacao`; settlement routes under `requireAdmin`; `statusCacheDaLinha`; `revision`+`updated_at` on receivables/payables; `SALE_TRANSITIONS`; the "won sale with an active baixa cannot leave won" guard; `saoPauloDayOf`/`todayInSaoPaulo` on won/settlement dates; `asDateOnly` intentional. Highest migration is `0024`, so this run starts at `0025`.

## Non-negotiable domain rules (closed list, identical in Finance)

- Integer cents on the wire; no float path in any consumer handler.
- `YYYY-MM-DD` in the Sao Paulo day, never UTC, never in the future, refused at source and destination.
- The one settlement reducer is `reduceSettlement` from the package; neither app writes its own. It mirrors the existing `reduzirLiquidacao`.
- `obligationRef` is `fxl-sales:<row id>`; a label or parcela number is NEVER identity (renumbering).
- A `voided` obligation with an active settlement becomes `disputed`, never silently open/paid.
- `revision` only grows per row; `voided` is terminal; a value/due-date change on a row with an active settlement is refused AT SOURCE (already true in Sales).
- Nothing published is hard-deleted; a settlement fact is never edited, a reversal is a new fact.
- `syncedObligationSubset` runs on the PRODUCER before emit; it excludes tax (`kind:'tax'`), indefinite recurrence, and affiliate commission. The consumer never recomputes it.
- Anti-echo (hard rule): applying a REMOTE fact never emits a LOCAL fact. A settlement applied by a consumer handler is marked origin `finance` and never re-enqueued.
- Both apps stay 100% usable alone: every rule applies ONLY to a linked row in a connected Organization. A sale in an Organization without a live Activation behaves exactly as today.

## Overrides carried on top of the Hub prompt (from the operator prompt)

- Exact pin `"@fxl-business/fxl-contracts": "0.1.0"` (no caret/tilde), in the same commit as the lockfile.
- Use the shared fixture org `org_fake_integrado` bound to `FIXTURE_INTEGRATED_ORGANIZATION_ID` in this app's auth-fake roster, wiring `createFakeIntegrationAuthority` at the auth-fake boot, never per request.
- No promotion, tag, push, or production enable. Autopilot stops at LOCAL `master` merges; do NOT `git push` (explicit operator override of the usual autopilot push).
- End with a local end-to-end test in fake mode over the shared fixture org covering: a won sale appears in the Finance-facing feed; a settlement recorded in one app appears in the other; a reversal syncs; a sale with an active settlement cannot leave `won`; a simultaneous settlement in both apps becomes "registrada em duplicidade". Where the Finance side of the layer does not exist yet, record in `AUDIT.md` which cases stayed untested.

## Acceptance criteria (feature level, testable)

1. `apps/api` depends on `@fxl-business/fxl-contracts` at EXACT `0.1.0`; the lockfile resolves it in the same commit; no vendored copy of the package exists.
2. A new migration applies the producer + consumer transport DDL (outbox, publisher high-water, inbox, cursor) from the package's reference SQL, additively, on top of `0024`; drizzle schema knows the new tables.
3. When a sale in a connected Organization reaches `won` (via `createSale`/`transitionSale`), an `fxl-sales.obligation.upserted` v1 row is enqueued IN THE SAME transaction for each obligation that survives `syncedObligationSubset`; a sale in an unconnected Organization enqueues nothing and behaves exactly as today.
4. A baixa (`POST /settlements`) and an estorno (`POST /settlements/:id/reverse`) each enqueue `fxl-sales.settlement.recorded` / `fxl-sales.settlement.reversed` v1 in the same transaction; a settlement with origin `finance` (applied by the consumer) enqueues NOTHING (anti-echo).
5. `cancelContract` and a `won` edit (`updateSale`) enqueue obligation upserts/voids in the same transaction, reusing the stable persisted ids as `obligationRef`.
6. A single position publisher, elected by advisory lock, assigns feed positions AFTER commit; the package's monotonic-feed invariant holds.
7. `GET /integration/v1/feed?organizationId=&after=&limit=` returns events in ascending position, clamps `limit`, and is protected by ticket introspection; a ticket the authority reports `{active:false}` yields 401 with no reason; the Organization for the read comes only from the introspection decision.
8. The consumer puller (safe with multiple instances via `SELECT ... FOR UPDATE SKIP LOCKED` on the cursor), inbox idempotency (PK on the inbox), and per-`eventName` handlers apply `fxl-finance.settlement.recorded`/`reversed` as origin `finance` settlements; unknown versions are rejected and counted, never applied; N and N-1 are accepted.
9. A heartbeat body is built via `buildHeartbeatBody` with metadata only (no money, no counterpart name, no obligation ref) and reported via `createHeartbeatReporter`.
10. Outbox rows are pruned only past all active consumers and never under `OUTBOX_MIN_RETENTION_DAYS` (30); a null low-water never deletes.
11. The auth-fake roster gains `org_fake_integrado` = `FIXTURE_INTEGRATED_ORGANIZATION_ID` with coherent seed data (a won sale, at least one parcela); `createFakeIntegrationAuthority` is wired once at the auth-fake boot with `environment:'development'`, never per request; nothing from the fake path enters a production bundle.
12. A local E2E in fake mode over `org_fake_integrado` covers the five cases in the operator override; any case blocked by a missing Finance layer is recorded in `AUDIT.md`.
13. Full suite + lint + type-check + build stay green at every wave boundary; `assert-web-bundle-clean.mjs` still proves fake/dev code is absent from the web build.

## Slice index

| id | goal | depends_on | primary files (hint) |
|---|---|---|---|
| 01-pkg-and-transport-ddl | Add the exact-pinned package + apply the producer/consumer transport DDL as migration 0025 + drizzle schema for the new tables | - | apps/api/package.json, packages/auth-fake/package.json, pnpm-lock.yaml, apps/api/drizzle/0025_integration_transport.sql, apps/api/drizzle/meta/*, apps/api/src/db/schema.ts |
| 02-hub-client-and-config | Integration config seam (built from existing hub config, no new env) + ticket client + introspection verifier + discovery (contracts/activations) + heartbeat reporter/body builder, as pure modules | 01 | apps/api/src/domains/integration/config.ts, apps/api/src/domains/integration/hub-client.ts, apps/api/src/domains/integration/heartbeat.ts |
| 03-producer-outbox-and-events | Outbox adapter over the DDL tables + enqueue seam + event builders (obligation.upserted, settlement.recorded/reversed, ledger.checkpoint) + syncedObligationSubset filter | 01 | apps/api/src/domains/integration/outbox-adapter.ts, apps/api/src/domains/integration/events.ts |
| 04-consumer-inbox-puller | Inbox/cursor adapter + puller config + fetchFeedPage (finance feed with ticket) + handlers applying finance settlement.recorded/reversed as origin=finance (anti-echo, version N/N-1); extracts a tx-accepting settlement-apply in settlements.ts reused by both route and consumer | 01, 02, 03 | apps/api/src/domains/integration/inbox-adapter.ts, apps/api/src/domains/integration/consumer.ts, apps/api/src/domains/sales-ops/settlements.ts |
| 05-feed-route | GET /integration/v1/feed router: readIntegrationFeed + clampFeedLimit + introspection guard + organizationForFeedRead | 01, 02, 03 | apps/api/src/domains/integration/feed-routes.ts |
| 06-fake-dev-fixture-authority | 4th fixture org org_fake_integrado (FIXTURE_INTEGRATED_ORGANIZATION_ID) + createFakeIntegrationAuthority at auth-fake boot + coherent seed | 01 | packages/auth-fake/src/index.ts, apps/api/scripts/seed-dev.ts, apps/api/src/auth/select.ts, apps/web/src/dev/install-dev-identity.ts |
| 07-wire-producer-emission | Call the emit seam inside createSale(won), transitionSale, cancelContract, updateSale, and settlement record/reverse, in the same tx; anti-echo for finance-origin settlements | 03, 04 | apps/api/src/domains/sales-ops/service.ts, apps/api/src/domains/sales-ops/settlements.ts |
| 08-wire-boot-and-prune | Mount at API boot: position publisher, puller, heartbeat loop, feed route; add outbox prune to nightly-job | 02, 03, 04, 05 | apps/api/src/index.ts (or server bootstrap), apps/api/src/jobs/nightly-job.ts, route registration |
| 09-e2e-fake-mode | Local E2E in fake mode over org_fake_integrado covering the five operator cases | 02, 03, 04, 05, 06, 07, 08 | apps/api/test/integration/finance-integration.e2e.test.ts (or equivalent) |

## Wave shape (derived, to be confirmed by waves.sh)

- Wave 1: 01
- Wave 2: 02, 03, 06 (file-disjoint)
- Wave 3: 04, 05 (both need 02+03; disjoint)
- Wave 4: 07 (edits settlements.ts after 04)
- Wave 5: 08 (boot wiring)
- Wave 6: 09 (E2E)

## Known open decisions to make and log (not to ask)

- `deepLinkPath` in `fxl-sales.obligation.upserted.source`: a warm-session path already resolves via `buildSaleDetailPath` (`/operacional/vendas/<id>`), but a cold-entry (no session) route does not exist yet. Decide whether to emit the warm path or omit the field, honoring the published v1 schema's required/optional shape; record the choice in `AUDIT.md`.
- The prune low-water source (from consumer heartbeats the Hub keeps) is a producer concern; in fake mode there is no real Hub store, so pick a safe fail-closed default and log it.
- Whether the Finance side of the layer exists; if not, the cross-app E2E cases run against a simulated finance feed within this repo and the untested cross-process cases are logged.
