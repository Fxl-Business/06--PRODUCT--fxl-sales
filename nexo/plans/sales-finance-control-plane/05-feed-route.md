---
id: 05-feed-route
milestone: v4.1.0
status: todo
depends_on: [01-pkg-and-transport-ddl, 02-hub-client-and-config, 03-producer-outbox-and-events]
files_modified: [apps/api/src/domains/integration/feed-routes.ts, apps/api/src/domains/integration/__tests__/feed-route.integration.test.ts]
acceptance:
  - "A new router module `apps/api/src/domains/integration/feed-routes.ts` exports `createIntegrationFeedRouter({ adapter, verifier })` returning a Hono router with exactly one route, `GET /feed` (final path `/integration/v1/feed` once slice 08 mounts it at `/integration/v1`). The module is NOT mounted into `apps/api/src/server.ts` here."
  - "The route reads the ticket from `Authorization: Bearer <ticket>`, calls `verifier.verify(ticket)`, and NEVER carries `appAuthMiddleware`/`requireAdmin` (it is S2S via ticket introspection, not a Hub bearer route)."
  - "A missing/malformed `Authorization` header, an empty ticket, and a `verify` outcome of `{ status: 'refused' }` (an inactive/unknown ticket) all return `401 { \"error\": \"unauthorized\" }` with NO reason, code, or decision detail in the body."
  - "The Organization used for the read comes ONLY from `organizationForFeedRead(decision, requestedOrganizationId)`; a `?organizationId=` that disagrees yields `403 { \"error\": \"forbidden\" }`; the caller's query value is never passed to `readIntegrationFeed`."
  - "On `{ status: 'authorized' }` the route calls `readIntegrationFeed({ adapter, organizationId, after, limit })` with `organizationId` from the decision, `after` parsed from `?after=` (default `0n`, `/^\\d+$/` or `400`), and `limit = clampFeedLimit(...)` over the raw `?limit=` (undefined/non-finite -> default `FEED_DEFAULT_LIMIT`; `?limit=100000` -> `FEED_MAX_LIMIT`)."
  - "Events return in ascending position; the response serializes every `bigint` (`position`, `nextCursor`) as a decimal string so `c.json` never throws on BigInt."
  - "The ticket value is never logged on any path (success, refused, mismatch, or unavailable)."
  - "The named oracle `apps/api/src/domains/integration/__tests__/feed-route.integration.test.ts` passes under `pnpm --filter @fxl-sales/api test:integration feed-route`: it proves ascending events for the introspected org, limit clamping, a 401 on an inactive ticket, and that the org comes from introspection and not the query param."
  - "`pnpm run type-check` is clean; the module imports nothing from `@fxl-business/fxl-contracts/testing` and adds no `appAuthMiddleware` usage."
---

# Slice 05 - Producer feed route (`GET /integration/v1/feed`)

## Goal

Expose THIS app's producer feed as a cursor-paginated, ascending-by-position read, protected by
Hub ticket introspection.
The consumer (Finance) sends an opaque ticket in `Authorization: Bearer <ticket>`; the route
introspects it, derives the Organization to read SOLELY from the introspection decision, and
returns one page via the package's `readIntegrationFeed`.

This slice writes ONLY the router module and its oracle test.
Mounting the router at API boot, constructing the real verifier, and constructing the pooled
service adapter are slice 08's job.
The verifier and the adapter are CONSTRUCTOR DEPENDENCIES of the router factory precisely so slice
08 can inject the real ones in production and the fake authority's verifier in dev/fake mode
without touching this file.

## Background the executor must not re-derive

- Package types (EXACT, from `@fxl-business/fxl-contracts` `dist/index.d.ts` and
  `dist/heartbeat-reporter-*.d.ts`):
  - `readIntegrationFeed(request: FeedPageRequest): Promise<FeedPage>` where
    `FeedPageRequest = { adapter: SqlIntegrationAdapter; organizationId: string; after: bigint; limit?: number }`.
  - `FeedPage = { events: FeedEvent[]; nextCursor: bigint }` and
    `FeedEvent = { position: bigint; eventName: string; eventVersion: number; idempotencyKey: string; payload: unknown; occurredAt: string }`
    (`occurredAt` is already a normalized ISO string; `position`/`nextCursor` are `bigint`).
  - `clampFeedLimit(limit: number | undefined): number` - `undefined` -> `FEED_DEFAULT_LIMIT` (100);
    `< 1` -> `1`; `> FEED_MAX_LIMIT` (500) -> `FEED_MAX_LIMIT`. It does NOT sanitize `NaN`
    (NaN passes both comparisons unchanged), so the route must only ever hand it a finite number
    or `undefined` (see Request mapping).
  - `createIntrospectionVerifier(config): IntrospectionVerifier` with
    `verify(ticket: string): Promise<VerifyOutcome>` and
    `VerifyOutcome = { status: 'authorized'; decision: IntrospectionDecision; fromCache: boolean } | { status: 'refused' } | { status: 'unavailable'; reason: 'network' | 'timeout' | 'server'; httpStatus?: number }`.
    `IntrospectionDecision` carries `organizationId`, `consumerApplicationId`,
    `producerApplicationId`, `environment`, `eventNames`, `expiresAt`.
    NOTE: this slice does NOT call `createIntrospectionVerifier` - it receives an
    `IntrospectionVerifier` instance. Slice 02 owns the factory + config; slice 08 wires it.
  - `organizationForFeedRead(decision, requestedOrganizationId: string | undefined): { status: 'ok'; organizationId: string } | { status: 'mismatch' }`.
    `decision.organizationId` ALWAYS wins; a caller-supplied value can only ever produce
    `mismatch`, never be echoed back as the answer.
  - `SqlIntegrationAdapter = { query<R>(sql, params): Promise<R[]>; transaction<T>(op): Promise<T> }`.
- Repo Hono conventions (from `apps/api/src/domains/sales-ops/routes.ts`): a router is
  `new Hono()`; handlers return `c.json(body, status)`; error bodies are flat
  `{ error: '<snake_case>' , ... }`. Byte-identical status bodies used elsewhere in this repo:
  `401 { error: 'unauthorized' }`, `403 { error: 'forbidden' }`, `503 { error: 'unavailable' }`,
  `400 { error: 'validation_error' }`. Reuse those spellings.
- RLS / tenant boundary (load-bearing): per slice 01 the `integration_outbox` table gets
  ENABLE + FORCE RLS with an org predicate. This route has NO Hub tenant token and sets no tenant
  context, so it CANNOT rely on RLS to scope the read. The `adapter` it receives is the pooled
  SERVICE adapter from slice 03 (the same admin-session connection the publisher/prune use, which
  FORCE RLS admits). The ONLY tenant boundary for this S2S read is the `organizationId` the
  introspection decision produced, passed straight into `readIntegrationFeed`'s `WHERE organization_id = $1`.
  That is exactly why `organizationForFeedRead` refuses to let a caller's `?organizationId=` become
  the read's org. Do not weaken this: never pass the raw query `organizationId` to the adapter.

## The router module: `apps/api/src/domains/integration/feed-routes.ts`

Exported symbol:

```ts
import { Hono } from 'hono';
import {
  clampFeedLimit,
  organizationForFeedRead,
  readIntegrationFeed,
  type IntrospectionVerifier,
  type SqlIntegrationAdapter,
} from '@fxl-business/fxl-contracts';

export interface IntegrationFeedRouterDeps {
  /** The pooled SERVICE adapter (slice 03). Runs with the admin session context
   * FORCE RLS admits; the org boundary is the introspected organizationId below. */
  adapter: SqlIntegrationAdapter;
  /** Injected so slice 08 supplies the real verifier in prod and the fake
   * authority's verifier in dev/fake mode. This slice never constructs it. */
  verifier: IntrospectionVerifier;
}

export function createIntegrationFeedRouter(deps: IntegrationFeedRouterDeps): Hono {
  const router = new Hono();
  router.get('/feed', async (c) => {
    /* handler, spelled out below */
  });
  return router;
}
```

Final path is `/integration/v1/feed` because slice 08 mounts this router at `/integration/v1`
(`app.route('/integration/v1', createIntegrationFeedRouter({ adapter, verifier }))`), with NO
`app.use('/integration/v1/*', appAuthMiddleware)` line. Document that intended mount in a comment
here so slice 08 has an unambiguous target, but DO NOT edit `server.ts` in this slice.

### Handler order (exact)

1. **Extract the ticket.** Read `c.req.header('Authorization')`. Accept only a value that, after
   trimming, begins with a case-insensitive `Bearer ` prefix; the ticket is the remainder trimmed.
   If the header is absent, does not match, or the remainder is empty ->
   `return c.json({ error: 'unauthorized' }, 401)`. Never log the header or ticket.
2. **Introspect.** `const outcome = await deps.verifier.verify(ticket);`
   - `outcome.status === 'refused'` -> `return c.json({ error: 'unauthorized' }, 401)` (inactive /
     unknown ticket; no reason body). Same body as step 1 - the caller learns nothing about WHY.
   - `outcome.status === 'unavailable'` -> the Hub introspection could not be reached; fail closed
     WITHOUT telling the consumer its ticket is bad (a 401 here would make the consumer invalidate a
     still-valid ticket). `return c.json({ error: 'unavailable' }, 503)`. Log only
     `outcome.reason`/`outcome.httpStatus` (never the ticket). Decision D-05a (AUDIT).
   - `outcome.status === 'authorized'` -> continue with `outcome.decision`.
3. **Resolve the Organization.** `const requested = c.req.query('organizationId');`
   `const org = organizationForFeedRead(outcome.decision, requested);`
   - `org.status === 'mismatch'` -> `return c.json({ error: 'forbidden' }, 403)`. The ticket is
     valid but not for the org the caller named; refuse rather than silently reading the ticket's
     org. Decision D-05b (AUDIT).
   - `org.status === 'ok'` -> use `org.organizationId` (from the decision) for the read.
4. **Parse `after`.** `const rawAfter = c.req.query('after');`
   - absent -> `after = 0n`.
   - `/^\d+$/.test(rawAfter)` -> `after = BigInt(rawAfter)`.
   - otherwise -> `return c.json({ error: 'validation_error' }, 400)`.
5. **Parse and clamp `limit`.** `const rawLimit = c.req.query('limit');`
   `const n = rawLimit === undefined ? undefined : Number(rawLimit);`
   `const limit = clampFeedLimit(Number.isFinite(n) ? (n as number) : undefined);`
   (Only a finite number or `undefined` ever reaches `clampFeedLimit`, so `?limit=abc` becomes the
   default and `?limit=100000` becomes `FEED_MAX_LIMIT`.)
6. **Read the feed.**
   `const page = await readIntegrationFeed({ adapter: deps.adapter, organizationId: org.organizationId, after, limit });`
7. **Serialize (BigInt-safe).** `c.json` uses `JSON.stringify`, which throws on `bigint`. Map:

   ```ts
   return c.json({
     events: page.events.map((e) => ({
       position: e.position.toString(),
       eventName: e.eventName,
       eventVersion: e.eventVersion,
       idempotencyKey: e.idempotencyKey,
       payload: e.payload,
       occurredAt: e.occurredAt,
     })),
     nextCursor: page.nextCursor.toString(),
   });
   ```

### Wire contract (for slice 04's `fetchFeedPage`)

Response body on `200`:
`{ events: Array<{ position: string; eventName: string; eventVersion: number; idempotencyKey: string; payload: unknown; occurredAt: string }>, nextCursor: string }`.
`position` and `nextCursor` are DECIMAL STRINGS; slice 04's consumer `fetchFeedPage` parses them
back to `bigint` before returning a `FeedPage`. This shape is a cross-slice contract - do not change
it without updating slice 04.

### Status summary

| Condition | Status | Body |
|---|---|---|
| No / malformed `Authorization`, empty ticket | 401 | `{ "error": "unauthorized" }` |
| `verify` -> `refused` (inactive/unknown ticket) | 401 | `{ "error": "unauthorized" }` |
| `verify` -> `unavailable` (Hub unreachable) | 503 | `{ "error": "unavailable" }` |
| `organizationForFeedRead` -> `mismatch` | 403 | `{ "error": "forbidden" }` |
| `after` present but not `/^\d+$/` | 400 | `{ "error": "validation_error" }` |
| authorized + ok | 200 | `{ events: [...], nextCursor: "<n>" }` |

## Decisions to record in `AUDIT.md`

- **D-05a**: an `unavailable` introspection outcome returns `503 { error: 'unavailable' }`, not
  `401`. Rationale: a 401 would make the consumer treat its (still-valid) ticket as revoked and
  invalidate its cache; `503` is the fail-closed "try again" that preserves the revocation budget.
- **D-05b**: an `organizationId` query param that disagrees with the introspection decision returns
  `403 { error: 'forbidden' }`, not a silent read of the ticket's org. The query param is only ever
  validated against the decision, never used as the read's org.
- **D-05c**: `after` and `nextCursor`/`position` cross the wire as decimal strings (BigInt is not
  JSON-serializable); the consumer parses them back to `bigint`.

## Named oracle test

`apps/api/src/domains/integration/__tests__/feed-route.integration.test.ts`
(a `*.integration.test.ts` file, so it runs under `VITEST_INTEGRATION=1` against the local test DB;
run `pnpm --filter @fxl-sales/api test:integration feed-route`).

It drives the REAL router through a Hono app, the REAL package `readIntegrationFeed`, a REAL DB
service adapter, and a STUB `IntrospectionVerifier` (injected). Do not mock `readIntegrationFeed` or
the DB - only the verifier is a stub, because the verifier is exactly the injected seam.

Setup:

- Blank the six Hub credential names + `SALES_AUTH_FAKE` + `SALES_ENV_FILE` via `vi.hoisted(...)`
  before importing anything that resolves Hub config at module scope (copy the block from
  `apps/api/src/domains/sales-ops/__tests__/settlements.integration.test.ts`). The feed router does
  NOT resolve Hub config itself, but the DB client / schema imports must load with an unambiguous
  environment.
- Build the SERVICE `SqlIntegrationAdapter` for the test. Prefer slice 03's exported pooled-adapter
  factory (from `apps/api/src/domains/integration/outbox-adapter.ts`) if present; otherwise build an
  inline adapter over a `postgres` client opened with the admin session so FORCE RLS admits the
  read and the writes:

  ```ts
  import postgres from 'postgres';
  const sql = postgres(process.env.TEST_DATABASE_URL!, {
    max: 4,
    connection: { 'app.fxl_admin': 'true' },
  });
  const adapter: SqlIntegrationAdapter = {
    query: (text, params) => sql.unsafe(text, params as unknown[]) as unknown as Promise<any[]>,
    transaction: (op) => sql.begin((tx) => op({
      query: (text, params) => tx.unsafe(text, params as unknown[]) as unknown as Promise<any[]>,
      transaction: () => { throw new Error('nested tx unused'); },
    })) as Promise<any>,
  };
  ```

  Close it in `afterAll`.
- Seed outbox rows with ASSIGNED positions for a test org `ORG_A` and at least one row for a second
  org `ORG_B`. Seed via the package's own helpers so the DDL columns are never hand-typed:
  `enqueueIntegrationEvent(adapter, envelope)` (writes position NULL) for several `ORG_A` envelopes
  with increasing `occurredAt`, plus one `ORG_B` envelope, then
  `await publishPendingPositions({ adapter })` to assign positions after "commit". Use distinct
  `idempotencyKey`s and small JSON payloads. Record the assigned `ORG_A` positions by reading the
  feed once with a wide limit, so the test asserts on real positions rather than guesses.
- A stub verifier factory:

  ```ts
  const verifierFor = (org: string | null): IntrospectionVerifier => ({
    verify: async (ticket: string) =>
      ticket === 'good'
        ? { status: 'authorized', fromCache: false,
            decision: { organizationId: org!, consumerApplicationId: 'app.fxl-finance',
              producerApplicationId: 'app.fxl-sales', environment: 'development',
              eventNames: [], expiresAt: new Date(Date.now() + 60000).toISOString() } }
        : { status: 'refused' },
    clear: () => {},
  });
  ```

- Mount: `const app = new Hono(); app.route('/integration/v1', createIntegrationFeedRouter({ adapter, verifier }));`
  and drive it with `app.request('/integration/v1/feed?...', { headers: { Authorization: 'Bearer good' } })`.

Cases (each an `it`):

1. **Ascending events for the introspected org.** verifier authorized for `ORG_A`; request with no
   `organizationId` and `after=0`. Expect `200`; `events` are `ORG_A`'s rows only (no `ORG_B` row);
   `position` values are strictly increasing decimal strings; `nextCursor` equals the last event's
   `position`.
2. **Clamps limit.** Seed more than `FEED_MAX_LIMIT` is impractical, so assert the clamp two ways:
   (a) `?limit=1` returns exactly one event and `nextCursor` = that event's position (proves the
   limit is applied); (b) a spy/wrapper around the adapter, OR a direct unit assertion, confirms
   `?limit=100000` results in a read of at most `FEED_MAX_LIMIT` - simplest: seed 3 `ORG_A` rows,
   request `?limit=100000`, expect all 3 back with no error (proves `clampFeedLimit` prevented the
   raw value reaching the DB). Also assert `?limit=abc` returns rows (default applied, no 400/500).
3. **401s an inactive ticket.** verifier returns `{ status: 'refused' }` (send
   `Authorization: Bearer stale`); expect `401` and body exactly `{ error: 'unauthorized' }` with no
   `reason`/`code` key. Also assert a request with NO `Authorization` header is `401` with the same
   body.
4. **Org comes from introspection, not the query param.** verifier authorized for `ORG_A`; request
   `?organizationId=<ORG_B>`. Expect `403 { error: 'forbidden' }` (mismatch), and separately, a
   request authorized for `ORG_A` with `?organizationId=<ORG_A>` returns `ORG_A`'s rows. Critically:
   a request authorized for `ORG_A` with `?organizationId=<ORG_B>` must NEVER return `ORG_B`'s row -
   assert the body is the 403, proving the caller's org value cannot steer the read.

Cleanup: delete the seeded outbox rows (and the `integration_outbox_position` high-water reset if
the harness shares the counter) in `afterAll`/`afterEach` through the same service adapter, and
close the `postgres` client.

## Out of scope (explicit)

- Mounting the router in `apps/api/src/server.ts` (slice 08).
- Constructing the real `IntrospectionVerifier` / the integration config (slice 02) and the pooled
  service adapter (slice 03).
- Any producer emission, publisher loop, prune, or consumer puller.
- Any `appAuthMiddleware` / `requireHubAuth` / `requireAdmin` on this route - it is S2S by ticket.
