# Relatório: sales-finance-control-plane

## Status da solicitação
pass · All 9 slices delivered and merged to master, every wave gate green; Sales is now producer+consumer over the Hub control plane in fake mode. No push/promotion per operator override.
Pedido: Sales<->Finance integration via Hub control plane: producer outbox+feed+publisher, consumer puller+inbox+handlers, ticket/introspection/heartbeat, fake-dev fixture org + authority, wired into existing sale/settlement transactions; ends with local fake-mode E2E

## Entregue
- 01-pkg-and-transport-ddl  71d0c31  Pinned @fxl-business/fxl-contracts at exact 0.1.0 and added migration 0025 with the four transport tables (outbox, high-water, inbox, cursor) and their RLS.
- 02-hub-client-and-config  77b784f  Integration config built from the existing hub config (no new env), the real ticket client / introspection verifier / discovery, and the heartbeat reporter.
- 03-producer-outbox-and-events  1ecae75  The SqlIntegrationAdapter over the app DB, the pure event builders (obligation upserted/voided, settlement recorded/reversed) with the synced-subset filter, and the producer gate.
- 06-fake-dev-fixture-authority  39bb8c0  The shared fixture org org_fake_integrado + integrated-owner identity and getFakeIntegrationAuthority() for local dev, kept out of the web/prod bundle.
- 04-consumer-inbox-puller  a039ffc  The consumer puller + finance settlement handlers applying remote facts as origin=finance through the one settlement writer, with idempotency, version policy and the duplicidade/disputed derivations.
- 05-feed-route  dfceba4  GET /integration/v1/feed guarded by ticket introspection, org from the introspection decision only, bigints as strings, ticket never logged.
- 07-wire-producer-emission  60bfe27  Emission wired into createSale/transitionSale/cancelContract/updateSale and the settlement writers, inside the business tx, gated on a live activation, with anti-echo at one choke point.
- 08-wire-boot-and-prune  9c052f8  Boot composition (publisher, heartbeat, feed mount, puller in real mode only) via server.ts await-import, the fake/real authority seam in select.ts, and the fail-closed nightly outbox prune.
- 09-e2e-fake-mode  5f6c2ee  A local end-to-end test over the fixture org covering all five operator cases (won->feed, baixa both ways, estorno sync, cannot leave won with an active baixa, simultaneous baixa = registrada em duplicidade).

## Não feito e por quê
- ledger-checkpoint-emission  skip · not_applicable
  fxl-sales.ledger.checkpoint is a builder only this run; no emitter is wired (deferred non-goal). If ever emitted, its ref prefix must follow origin. Audit: nexo/runs/20260928T220106Z-sales-finance-control-plane/AUDIT.md
- backfill  skip · not_applicable
  No backfill of sales won before an Activation goes live (A3 no-backfill stance). Audit: nexo/runs/20260928T220106Z-sales-finance-control-plane/AUDIT.md
- cold-entry-deep-link-route  skip · not_applicable
  The no-session cold-entry route for a proposta deep link does not exist yet; the warm path /operacional/vendas/<id> resolves for a signed-in operator. Audit: nexo/runs/20260928T220106Z-sales-finance-control-plane/AUDIT.md
- cross-process-e2e  skip · not_applicable
  No real Finance app / real Hub in this repo, so true cross-process delivery, cross-process ticket introspection and end-to-end convergence are unexercised; the in-repo E2E uses a simulated Finance feed. Exact untested cases listed in AUDIT. Audit: nexo/runs/20260928T220106Z-sales-finance-control-plane/AUDIT.md

## Decisões tomadas sem você
- Section-10 role gate was already satisfied (PC23 shipped after the Hub prompt was written); only POST /sales stays open by design, so no gate was rebuilt. (AUDIT.md)
- recordedBy.app uses the app. prefix (app.fxl-sales / app.fxl-finance) per the published schema; the Hub prompt's 'fxl-finance' shorthand was wrong. (SEAM-CONTRACT.md / reference)
- source.deepLinkPath is required by the v1 schema, so it is emitted as the warm path /operacional/vendas/<saleId>. (AUDIT.md / reference)
- The nightly outbox prune uses a fail-closed null low-water (the pilot exposes no consumer-cursor read). (AUDIT.md / reference)
- Ran as a standalone orchestrator building via feat branches serially within each wave (Execute!=Verify held); stopped at local master with NO push/promotion per operator override. (AUDIT.md)
- Two pre-existing brittle/isolation-dependent test assertions were fixed-forward (the 0024 journal last-entry test; the 0025 counter live-value assertions). (AUDIT.md)

## Perguntas
1. Do you want a follow-up run to build the Finance side of the integration layer and a true cross-process two-app E2E once it exists?
   a) Yes, schedule it next
   b) Not now
   c) outra: ___

Responda para retomar: <n><k>
