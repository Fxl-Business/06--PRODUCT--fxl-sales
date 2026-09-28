# @fxl-business/fxl-contracts@0.1.0 - distilled surface (for planners/executors)

The published package is extracted for reading at:
`/private/tmp/claude-501/-Users-cauetpinciara-Documents-fxl-projects-06--PRODUCT--fxl-sales/0ccde427-4c74-434f-859b-462986d2bba3/scratchpad/pkg/package`
- `dist/index.d.ts` (root barrel types + fn signatures), `dist/testing.d.ts` (fake authority), `schema/integration-transport.sql` (reference DDL).
Read those files directly for exact signatures; this note is the map, not a substitute.

## Exports (root barrel `@fxl-business/fxl-contracts`)
Reducer/domain: `reduceSettlement`, `settlementDigest`, `syncedObligationSubset`, `obligationExclusionReason`, `SYNCED_SUBSET_EXCLUDED_KINDS_V1`, `SettlementError`.
Producer: `enqueueIntegrationEvent`, `startPositionPublisher`, `publishPendingPositions`, `positionPublisherLockKey`, `POSITION_PUBLISHER_LOCK_CLASS`, `readIntegrationFeed`, `clampFeedLimit`, `FEED_DEFAULT_LIMIT`, `FEED_MAX_LIMIT`, `pruneIntegrationOutbox`, `OUTBOX_MIN_RETENTION_DAYS`.
Consumer: `pullOnce`, `startIntegrationPuller`.
Hub client: `createTicketClient`, `TICKET_SAFETY_WINDOW_MS`, `createIntrospectionVerifier`, `effectiveCacheSeconds`, `organizationForFeedRead`, `INTROSPECTION_CACHE_CEILING_SECONDS`.
Heartbeat: `createHeartbeatReporter`, `buildHeartbeatBody`, `HEARTBEAT_ERROR_CODES`, `HEARTBEAT_ELIGIBILITY_CODES`, `HEARTBEAT_ERROR_DETAIL`.
Event types: `EVENT_TYPES`, `eventTypeKey`, plus per-event `*_V1_SCHEMA` / `*_V1_EXAMPLE`, `isObligationUpsertedV1`, `isSettlementRecordedV1`, `isSettlementReversedV1`, `isLedgerCheckpointV1`, `EVENT_SCHEMA_DIGESTS`.
Type-only: `IntegrationEventEnvelope`, `SqlIntegrationAdapter`, `PositionPublisherOptions/Handle`, `FeedPageRequest/FeedEvent/FeedPage/FetchFeedPage`, `IntegrationPullPair/PullerConfig/PullerOptions/PullerHandle/PullReport`, `IntegrationEventHandler`, `OutboxPruneOptions`, `ObligationUpsertedV1`, `SettlementRecordedV1/ReversedV1`, `LedgerCheckpointV1`, `SettlementFact/ReversalFact/State/Status/Origin`, `ObligationCandidate/Snapshot/State/Recurrence/ExclusionReason`, `SyncedObligationSubset`.

## Subpath `@fxl-business/fxl-contracts/testing` (dev only)
`createFakeIntegrationAuthority`, `FIXTURE_INTEGRATED_ORGANIZATION_ID` (and likely `assertAuthorityConfig`). NEVER imported from the root barrel; keep it in dev-only code paths so `assert-web-bundle-clean.mjs` stays true.

## The adapter seam (load-bearing)
```ts
interface SqlIntegrationAdapter {
  query<R>(sql: string, params: readonly unknown[]): Promise<R[]>;
  transaction<T>(operation: (tx: SqlIntegrationAdapter) => Promise<T>): Promise<T>;
}
```
All producer/consumer/feed/prune helpers take `{ adapter }` or a `tx: SqlIntegrationAdapter`.
- `enqueueIntegrationEvent(tx, event)` - call INSIDE the existing business transaction. Implement a thin adapter that wraps the ongoing Drizzle tx so `query()` runs raw SQL on the SAME connection (Drizzle `tx.execute(sql.raw(text))` with bound params, e.g. via `postgres`/`pg` parameterization). The app already opens `db.transaction`/`withTenant` for every sale/settlement write; the enqueue is one more INSERT on that tx.
- The publisher, puller, feed and prune use a standalone adapter over the pooled connection (a short local tx or a plain query), NOT the business tx.
- Read-committed-or-stronger isolation is REQUIRED (the null-position-until-publish mechanism depends on uncommitted rows staying invisible).

## Transport DDL (four tables; see schema/integration-transport.sql)
- PRODUCER: `integration_outbox` (id text PK, organization_id, event_name, event_version, idempotency_key, payload jsonb, occurred_at, created_at, `position bigint NULL`, published_at) + unique `(organization_id, idempotency_key)` + partial pending idx `(occurred_at,id) WHERE position IS NULL` + unique `(position) WHERE position IS NOT NULL` + feed idx `(organization_id, position) WHERE position IS NOT NULL`. `integration_outbox_position` (id text PK, last_position bigint default 0, updated_at) seeded with row id='default'.
- CONSUMER: `integration_inbox` PK `integration_inbox_pkey (producer_application_id, organization_id, idempotency_key)` + event_name/version/position/occurred_at/applied_at. `integration_cursor` PK `(producer_application_id, organization_id)` + position default 0 + updated_at.
- RLS: the three org-scoped tables (outbox, inbox, cursor) are tenant data and MUST get ENABLE+FORCE RLS with an org predicate matching this repo's single-role RLS convention (see `apps/api/drizzle/0008_single_role_rls_context.sql` and how sales-ops tables are scoped). `integration_outbox_position` is a global counter row - no policy (mirror how `hub_bff_*` global tables are handled if a policy is nonetheless required by the role model).

## Envelope shape (`IntegrationEventEnvelope`)
`{ id, organizationId, eventName, eventVersion, idempotencyKey, payload, occurredAt }`. Idempotency is `(organizationId, idempotencyKey)`. Position born NULL.

## Config (no new env)
The package reads NO env; it takes a config object you build. Basic auth to the Hub integration routes uses THIS app's `application_client` credential; per the Hub prompt no new `FXL_HUB_*` var is created, so build the integration config from the existing hub config (`hubEnvBag` in `apps/api/src/config/auth-provider.ts`: client id/secret, hub api url, environment, audience `app.fxl-sales`). In fake mode `createFakeIntegrationAuthority` REPLACES the real ticket client / verifier / reporter (same object shapes), wired once at boot.

## Domain rules the builders must honor
- obligationRef = `fxl-sales:<row id>`; settlementRef `fxl-sales:<uuid>`; cents integer; dates `YYYY-MM-DD` Sao Paulo (`@fxl-sales/shared-utils/sao-paulo-day`), never future.
- `syncedObligationSubset(candidates)` runs on the producer before emit; excludes tax, indefinite recurrence, affiliate commission.
- Anti-echo: a settlement row with `origin='finance'` (applied by the consumer) NEVER emits.
- `reduceSettlement` mirrors the repo's `reduzirLiquidacao`; do not write a second reducer.
