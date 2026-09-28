---
id: 09-e2e-fake-mode
milestone: v4.1.0
status: todo
depends_on: [02-hub-client-and-config, 03-producer-outbox-and-events, 04-consumer-inbox-puller, 05-feed-route, 06-fake-dev-fixture-authority, 07-wire-producer-emission, 08-wire-boot-and-prune]
files_modified: [apps/api/src/domains/integration/__tests__/finance-integration.integration.test.ts, apps/api/src/domains/integration/__tests__/simulated-finance-feed.ts]
acceptance:
  - "The file is picked up by the integration project only (src/**/*.integration.test.ts glob, VITEST_INTEGRATION=1) and never by the unit suite."
  - "All five operator cases run green against the local Docker test DB over org_fake_integrado (FIXTURE_INTEGRATED_ORGANIZATION_ID), driving real service + real slice 03/04/05/07 code, the package helpers, and createFakeIntegrationAuthority as the Hub."
  - "Case 1: a won proposta enqueues fxl-sales.obligation.upserted, publishPendingPositions assigns positions, and GET /integration/v1/feed with a fake-authority ticket returns those events; a garbage bearer returns 401 with no reason."
  - "Case 2: a local baixa emits fxl-sales.settlement.recorded onto the feed; a simulated fxl-finance.settlement.recorded applied through the real consumer handler writes a local origin='finance' baixa and enqueues NOTHING (anti-echo)."
  - "Case 3: an estorno on each side syncs (fxl-sales.settlement.reversed on the feed; a simulated fxl-finance.settlement.reversed applied as an origin='finance' estorno that reopens the row)."
  - "Case 4: a won sale with an active baixa is refused when leaving won (409 sale_has_active_settlements) and enqueues no obligation void."
  - "Case 5: a simultaneous integral baixa in both apps leaves the row paid with two active settlements (one local, one remote) and is detectable as registrada em duplicidade; the finance one still emits nothing."
  - "Deterministic: publishPendingPositions and pullOnce are called directly (no setInterval timers, no wall-clock waits); every date is an explicit Sao Paulo civil day and every amount is integer cents."
  - "Cleanup: all fixture rows (settlements via deleteSettlementsForOrgs, then ledger + sale rows, then integration_outbox/inbox/cursor for the fixture org) are removed in afterEach; closeDb + the standalone adapter close in afterAll."
  - "AUDIT.md records the exact cross-process cases this in-repo E2E cannot cover because no Finance app and no real Hub exist here."
---

# Slice 09 - Local E2E in fake mode over `org_fake_integrado`

## What this slice proves

This slice is its own named oracle.
It is the single end-to-end test that ties slices 02-08 together and drives the five operator cases from the overview override and from doubts doc sections 10-11 (`nexo/knowledge/doubts/20260922-sales-finance-two-way-sync-audit.md`, lines 1072-1157, ending with "registrada em duplicidade").

It runs in the DB-backed integration project, exactly like `apps/api/src/domains/sales-ops/__tests__/settlements.integration.test.ts`, and it drives as much REAL code as exists in this repo:

- Real service writes: `createSale`, `transitionSale`, `cancelContract`, `updateSale` (`apps/api/src/domains/sales-ops/service.ts`) and `recordSettlement`, `reverseSettlement` (`apps/api/src/domains/sales-ops/settlements.ts`).
- Real slice 07 producer emission wired inside those business transactions (obligation upserts and settlement facts enqueued in the same tx).
- Real slice 03 event builders + `syncedObligationSubset` filter (exercised transitively by slice 07).
- Real slice 04 consumer handlers + the tx-accepting finance-origin settlement apply.
- Real slice 05 feed route (`GET /integration/v1/feed`) with the introspection guard.
- The published package helpers `publishPendingPositions`, `readIntegrationFeed`, `pullOnce`, `reduceSettlement` (`@fxl-business/fxl-contracts`).
- `createFakeIntegrationAuthority` + `FIXTURE_INTEGRATED_ORGANIZATION_ID` (`@fxl-business/fxl-contracts/testing`) standing in for the Hub, wired once per test file.

The ONE piece it cannot drive is a real Finance app or a real Hub over the network.
Every consumer case is therefore driven by a SIMULATED Finance feed served through the package's `fetchFeedPage` seam, inside `pullOnce`, so the real inbox, cursor, idempotency and handler code all run against the real DB while only the network fetch is a test double.
The producer cases run against this app's own real feed.

## Planning note the executor must read first

At the time this plan was written, sibling slice plans 01-08 were NOT yet authored (only `00-OVERVIEW.md` existed).
This plan is therefore written against the seam contract declared in `00-OVERVIEW.md` (the slice index and acceptance criteria) plus the published package surface.
By the time slice 09 executes (it is the last wave), slices 02-08 are merged to `master` and their modules exist under `apps/api/src/domains/integration/`.
Where this plan names an app-side export whose exact identifier is a sibling slice's decision, the executor MUST open the delivered sibling module, confirm the seam, and bind to the delivered name.
This is a mechanical bind to an already-designed seam, not a new design decision.
Section "Seam contract and binding" lists every such point with the grep to run.

## Files

Create two files, both under `apps/api/src/domains/integration/__tests__/`:

1. `finance-integration.integration.test.ts` - the E2E suite (the five cases + the fixtures/harness).
2. `simulated-finance-feed.ts` - a small, dependency-free helper that builds a `FetchFeedPage` over an in-memory ordered list of `FeedEvent`.

The `.integration.test.ts` suffix is load-bearing: `apps/api/vitest.config.ts` includes `src/**/*.integration.test.ts` ONLY when `VITEST_INTEGRATION=1`, and excludes it from the unit suite.
Do not name the helper `*.test.ts`; it is imported, not a suite.

## Seam contract and binding

The E2E imports the following.
Package and service names are exact and stable.
App-integration names marked "BIND" are the seam a sibling slice owns; open the delivered module, confirm the shape, and use the delivered identifier.

| Import | From | Notes |
|---|---|---|
| `FIXTURE_INTEGRATED_ORGANIZATION_ID`, `createFakeIntegrationAuthority` | `@fxl-business/fxl-contracts/testing` | exact |
| `publishPendingPositions`, `readIntegrationFeed`, `pullOnce`, `reduceSettlement`, `type SqlIntegrationAdapter`, `type FeedEvent`, `type FeedPage`, `type IntegrationEventHandler`, `type ObligationUpsertedV1`, `type SettlementRecordedV1`, `type SettlementReversedV1`, `isObligationUpsertedV1`, `isSettlementRecordedV1`, `isSettlementReversedV1` | `@fxl-business/fxl-contracts` | exact |
| `createSale`, `transitionSale`, `cancelContract`, `updateSale`, `withTenant`, `type Db`, `type CadastroActor` | `apps/api/src/domains/sales-ops/service.js` | exact |
| `recordSettlement`, `reverseSettlement`, `selectOrgSettlements` | `apps/api/src/domains/sales-ops/settlements.js` | exact |
| `getDb`, `getAdminDb`, `closeDb`, `resolveAdminDatabaseUrl` | `apps/api/src/db/client.js` | exact |
| `deleteSettlementsForOrgs` | `apps/api/src/db/__tests__/settlement-test-cleanup.js` | exact |
| `salesOpsSales`, `salesOpsReceivables`, `salesOpsPayables`, `salesOpsSaleItems`, `salesOpsSaleProfessionals`, `salesOpsSettlements` | `apps/api/src/db/schema.js` | exact |
| `hubAuthContext` | `apps/api/src/auth/__tests__/hub-auth-context-fixture.js` | exact (used by settlements.integration.test.ts) |
| `todayInSaoPaulo` | `@fxl-sales/shared-utils/sao-paulo-day` | exact |
| Feed router factory (BIND) | slice 05 `apps/api/src/domains/integration/feed-routes.js` | expected `createIntegrationFeedRouter({ adapter, verifier })` returning a Hono router mounted at `/integration/v1`. Grep: `grep -n "export" apps/api/src/domains/integration/feed-routes.ts`. Bind to the delivered factory name and to how it receives the introspection `verifier` and the `SqlIntegrationAdapter`. If slice 05 reads the verifier from a module-level config seam rather than a parameter, use slice 02's config seam to inject the fake authority's `verifier` (grep `apps/api/src/domains/integration/config.ts`). |
| Finance consumer handlers (BIND) | slice 04 `apps/api/src/domains/integration/consumer.js` | expected a `Record<string, IntegrationEventHandler>` keyed by `fxl-finance.settlement.recorded` and `fxl-finance.settlement.reversed` (e.g. `FINANCE_EVENT_HANDLERS` or `createFinanceHandlers()`). Grep: `grep -n "fxl-finance.settlement" apps/api/src/domains/integration/*.ts`. These handlers apply the fact through slice 04's tx-accepting finance-origin apply extracted from `settlements.ts`. |
| Connected-org provider (BIND) | slice 03/07 producer emit seam | slice 07 gates emission on "is this Organization connected" (overview acceptance 3). Find the injectable provider it consults (grep: `grep -rn "connected\|activation\|isOrganizationConnected\|connectedOrg" apps/api/src/domains/integration apps/api/src/domains/sales-ops/service.ts`). In `beforeAll`, set it so `org_fake_integrado` is connected and one control org is NOT. If the provider is derived at boot from the authority's activations, set it directly for the test; the requirement on slice 07 is that this provider is injectable in-process (record in AUDIT.md if it is not and the case had to be adapted). |
| Standalone transport adapter (BUILD, do not BIND) | this test | See "The standalone adapter" below. The E2E builds its own `SqlIntegrationAdapter`; it does not depend on any sibling adapter export. |
| Duplicidade signal (BIND, secondary) | slice 04 | If slice 04 exposes a named "registrada em duplicidade" predicate or a row marker, assert it in case 5. The PRIMARY case-5 oracle is `reduceSettlement` and the two persisted facts (always present); the named signal is an additional assertion. Grep: `grep -rn "duplicidade\|duplicate\|duplicid" apps/api/src/domains/integration apps/api/src/domains/sales-ops`. |

## Harness and fixtures

Model the file on `apps/api/src/domains/sales-ops/__tests__/settlements.integration.test.ts`.

### Module-scope Hub-absence hoist

Copy the `vi.hoisted(() => { for (const name of [...]) process.env[name] = ''; })` block verbatim from settlements.integration.test.ts (blanks `FXL_HUB_*`, `SALES_ENV_FILE`, `SALES_AUTH_FAKE`).
The router graph resolves the Hub contract at module scope; the E2E drives an already-verified context, so the ambient Hub config must be unambiguously absent before any router import.
Import the slice 05 feed router with a top-level `await import(...)` AFTER the hoist, the same pattern the settlements file uses for `salesOpsRouter`.

### The fake authority (one per file)

Application ids used throughout: this app is `app.fxl-sales`, the peer is `app.fxl-finance`.
Event-name constants:

- `SALES_EVENT_NAMES = ['fxl-sales.obligation.upserted','fxl-sales.settlement.recorded','fxl-sales.settlement.reversed','fxl-sales.ledger.checkpoint']`
- `FINANCE_EVENT_NAMES = ['fxl-finance.settlement.recorded','fxl-finance.settlement.reversed']`

Build ONE authority in `beforeAll`:

```ts
const authority = createFakeIntegrationAuthority({
  applicationId: 'app.fxl-sales',
  environment: 'development',
  activations: [
    // Case 1 needs a ticket THIS authority's own verifier will accept.
    // The fake shares issuedTickets only within one instance and get() requires
    // consumerApplicationId === applicationId, so the ticket that verifies a read
    // of the Sales producer feed must be minted with consumer 'app.fxl-sales'.
    // The consumer id is inconsequential to the feed route: organizationForFeedRead
    // reads decision.organizationId only. This is a test fixture, documented as such.
    {
      organizationId: FIXTURE_INTEGRATED_ORGANIZATION_ID,
      producerApplicationId: 'app.fxl-sales',
      consumerApplicationId: 'app.fxl-sales',
      eventNames: SALES_EVENT_NAMES,
    },
    // Sales-as-consumer reading Finance (kept for completeness / heartbeat parity).
    {
      organizationId: FIXTURE_INTEGRATED_ORGANIZATION_ID,
      producerApplicationId: 'app.fxl-finance',
      consumerApplicationId: 'app.fxl-sales',
      eventNames: FINANCE_EVENT_NAMES,
    },
  ],
});
```

Why this exact shape is forced (from reading the package's `dist/testing.js`):

- `createFakeIntegrationAuthority` refuses any `environment` other than `'development'`.
- `ticketClient.get({ organizationId, producerApplicationId })` succeeds only when an activation matches AND `activation.consumerApplicationId === applicationId`; it stores the ticket in a per-instance `issuedTickets` map.
- `verifier.verify(ticket)` accepts ONLY a ticket string that THIS SAME instance's `get` issued (map lookup), then echoes `decision.organizationId = activation.organizationId`.
- Consequence: to present a valid ticket to the Sales feed route (whose verifier is this authority), the ticket must be minted by this same authority with the Sales producer and a consumer equal to `applicationId`. The self-consumer activation above is the minimal fixture that satisfies that; record this reasoning in a code comment.

In `beforeAll`, add a sanity round-trip assertion: `get({ organizationId: FIX, producerApplicationId: 'app.fxl-sales' })` returns `status:'ok'`, and `verify(thatTicket)` returns `status:'authorized'` with `decision.organizationId === FIX`.
If the delivered slice 06 wiring constructs the authority differently (e.g. only the Finance-direction activation), the E2E still constructs its OWN authority for the test as above; it does not reuse slice 06's boot instance.

### The standalone adapter

The transport helpers (`publishPendingPositions`, `readIntegrationFeed`, `pullOnce`) run process-level and cross-org, so they must not be constrained by tenant RLS.
Build ONE `SqlIntegrationAdapter` over a raw `postgres` client that carries the admin session setting, mirroring `getAdminDb`'s `connection: { 'app.fxl_admin': 'true' }`, so the integration tables' admin RLS policy admits the cross-tenant work exactly as the real boot-time publisher/puller do.
This keeps the oracle independent of any sibling adapter export name and faithful to the admin-policy path.

```ts
import postgres from 'postgres';
// url: resolveAdminDatabaseUrl(process.env) ?? the settlement-cleanup default
const adminSql = postgres(url, { max: 3, connection: { 'app.fxl_admin': 'true' } });

const adapter: SqlIntegrationAdapter = {
  async query(text, params) {
    return adminSql.unsafe(text, params as unknown[]);
  },
  async transaction(op) {
    return adminSql.begin(async (tx) => op({
      query: (t, p) => tx.unsafe(t, p as unknown[]),
      transaction: (inner) => inner({ /* nested: reuse tx */ } as SqlIntegrationAdapter),
    } as SqlIntegrationAdapter));
  },
};
```

Notes for the executor:

- `postgres`-js `.unsafe(text, params)` runs a parameterized query and returns rows; that is the whole `query` contract.
- The package's `transaction` needs read-committed-or-stronger; Postgres default is read committed, so no isolation override is required. Add a code comment stating this (the package's `SqlIntegrationAdapter` doc requires it).
- Confirm the exact nested-transaction shape the helpers use by reading the package's `publishPendingPositions` / `pullOnce` bodies in `node_modules/@fxl-business/fxl-contracts/dist/index.js`; implement the adapter to match (a single flat `begin` is sufficient for these helpers, which open one transaction per call and do not re-enter).
- Close `adminSql` in `afterAll` before `closeDb()`.

### Actor and app for HTTP-style calls

Reuse the settlements-file pattern for any route call.
`const actor: CadastroActor = { userId: 'hub-account-financeiro-7f3a', displayName: 'Ana Financeiro' };`
Service functions take `(getDb(), orgId, ...)` directly; no Hono app is needed for them.
For the feed route (case 1), mount the slice 05 router in a bare Hono app: `const app = new Hono(); app.route('/', feedRouter);` and call `app.request('/integration/v1/feed?after=0&limit=100', { headers: { Authorization: 'Bearer ' + ticket } })`.

### Connectedness

In `beforeAll`, after building the authority, set the slice 03/07 connected-org provider (see BIND row) so `org_fake_integrado` is connected.
Also define one control org id that is NOT connected, `const UNCONNECTED_ORG = 'org_e2e_unconnected';`, used by the case-1 negative sub-assertion.

### Seeding

Do not rely on slice 06's dev seed (it targets the local dev DB, not the test DB).
Seed per test in the test DB through `getAdminDb()`, following `seedSale` / `seedReceivable` / `seedWonSale` from settlements.integration.test.ts.
All sales use `orgId = FIXTURE_INTEGRATED_ORGANIZATION_ID` (the connected org) unless a case says otherwise.
A won sale is seeded open then transitioned: seed the sale (`status:'open'`) and two receivables, then `await transitionSale(getDb(), FIX, sale.id, 'won')`.
This is the arrange that triggers slice 07's obligation emission for the won transition.

### Cleanup

`afterEach`:

1. `await deleteSettlementsForOrgs([FIXTURE_INTEGRATED_ORGANIZATION_ID, UNCONNECTED_ORG])` FIRST (the only sanctioned path past the `sales_ops_settlements` FXS01 trigger and its RESTRICT FKs).
2. Delete `salesOpsPayables`, `salesOpsReceivables`, `salesOpsSaleProfessionals`, `salesOpsSaleItems`, `salesOpsSales` for those orgs via `getAdminDb()`.
3. Delete integration transport rows for those orgs via the standalone adapter: `DELETE FROM integration_outbox WHERE organization_id = ANY($1)`, then `integration_inbox`, then `integration_cursor`. The outbox has no immutability trigger and is designed to be pruned/deleted, so an ordinary DELETE is correct here.
4. Do NOT reset `integration_outbox_position` (`id='default'`): it is a global monotonic counter, positions are unique only among non-null rows that we just deleted, so leaving `last_position` high is safe and keeps positions strictly increasing across tests.

`afterAll`: `await adminSql.end(); await closeDb();`.

Set `fileParallelism:false` is already forced by the integration vitest config; still, keep every case self-contained so ordering never matters.

## Deterministic control (rules for every case)

- Never call `startPositionPublisher` or `startIntegrationPuller`. Call `publishPendingPositions({ adapter })` and `pullOnce({ adapter, config, handlers })` directly and await them.
- After any emission, call `publishPendingPositions({ adapter })` and assert its return count before reading the feed; a feed read before publish legitimately returns nothing (positions are assigned after commit).
- Pass explicit `paidOn` civil days (`'2026-09-01'` etc.) to `recordSettlement` and explicit `now: Date` where a function accepts it. Never rely on the wall clock for a value under assertion.
- All amounts are integer cents (the schema's `amountBrl` is cents; the event `amountCents` is cents).
- Read positions as `bigint` (`after: 0n`); the feed returns `position` and `nextCursor` as `bigint`.

## The simulated Finance feed helper (`simulated-finance-feed.ts`)

A pure, in-memory feed the consumer cases pull from through the real `pullOnce`.
It exercises the real inbox/cursor/handler path; only the network fetch is doubled.

```ts
import type { FeedEvent, FeedPage, FetchFeedPage, IntegrationPullPair } from '@fxl-business/fxl-contracts';

export class SimulatedFinanceFeed {
  private readonly events: FeedEvent[] = [];
  private nextPosition = 1n;

  /** Append one finance event; assigns the next ascending position. */
  push(e: Omit<FeedEvent, 'position'>): FeedEvent {
    const event = { ...e, position: this.nextPosition++ } as FeedEvent;
    this.events.push(event);
    return event;
  }

  fetchFeedPage: FetchFeedPage = async (_pair: IntegrationPullPair, after: bigint, limit: number): Promise<FeedPage> => {
    const page = this.events.filter((e) => e.position > after).slice(0, limit);
    const nextCursor = page.length > 0 ? page[page.length - 1]!.position : after;
    return { events: page, nextCursor };
  };
}
```

Each pushed `FeedEvent` carries `eventName`, `eventVersion: 1`, a unique `idempotencyKey` (e.g. the settlementRef), `occurredAt` (ISO string), and `payload` shaped as the matching `*V1` type.
The `IntegrationPullerConfig` for `pullOnce` is:

```ts
const config = {
  pairs: async () => [{ producerApplicationId: 'app.fxl-finance', organizationId: FIXTURE_INTEGRATED_ORGANIZATION_ID }],
  fetchFeedPage: feed.fetchFeedPage,
  limit: 100,
};
const handlers = FINANCE_EVENT_HANDLERS; // BIND: slice 04
await pullOnce({ adapter, config, handlers });
```

Finance payload construction (matches the doubts doc section 11.4 and the package `*V1` types):

- `fxl-finance.settlement.recorded` payload (`SettlementRecordedV1`): `{ settlementRef: 'fxl-finance:<uuid>', obligationRef: 'fxl-sales:<local receivable id>', amountCents: <open amount>, paidOn: '<SP day>', recordedBy: { app: 'fxl-finance', displayName: 'Financeiro Finance' } }`. The `obligationRef` is the SALES row ref, because Finance stores and echoes the ref Sales published; that is what lets slice 04 map the fact back to the local row.
- `fxl-finance.settlement.reversed` payload (`SettlementReversedV1`): `{ reversalRef: 'fxl-finance:<uuid>', reversesSettlementRef: '<the recorded settlementRef>', amountCents: <same>, reversedOn: '<SP day>', reason?: 'estorno teste', recordedBy: { app: 'fxl-finance', displayName: 'Financeiro Finance' } }`.

Generate uuids with `crypto.randomUUID()`.

## The five cases

Small shared reader helpers to define in the file:

- `readOutbox(orgId, eventName?)` -> rows of `integration_outbox` for the org (optionally one event name), via the standalone adapter; used for emission counts and anti-echo.
- `readFeed(orgId)` -> `readIntegrationFeed({ adapter, organizationId: orgId, after: 0n, limit: 500 })` from the package; used for payload-level assertions independent of the route wrapper.
- `settlementsOf(orgId)` -> `selectOrgSettlements(getAdminDb(), orgId)` for origin / count assertions.

### Case 1 - a won proposta appears in the Finance-facing feed

Arrange:

- Seed a won sale in `org_fake_integrado` (open sale + two receivables `1/2` 300000, `2/2` 200000, then `transitionSale(getDb(), FIX, sale.id, 'won')`).

Act:

- `const published = await publishPendingPositions({ adapter });`

Assert:

- `published` is greater than or equal to the number of obligation events emitted (at least the two receivables).
- Route path (required, task wording "GET /integration/v1/feed with a ticket"):
  - `const ticket = (await authority.ticketClient.get({ organizationId: FIX, producerApplicationId: 'app.fxl-sales' }));` assert `ticket.status === 'ok'`.
  - `const res = await app.request('/integration/v1/feed?after=0&limit=100', { headers: { Authorization: 'Bearer ' + ticket.ticket.ticket } });`
  - `res.status === 200`; body events include two `fxl-sales.obligation.upserted` entries.
- Payload detail (via `readFeed(FIX)` and `isObligationUpsertedV1`): for each of the two receivables there is exactly one obligation event with `obligationRef === 'fxl-sales:' + receivable.id`, `direction === 'receivable'`, `state === 'active'`, `currency === 'BRL'`, `amountCents` equal to the seeded cents, `dueDate` the civil day of the receivable, and `revision` a positive integer (the persisted per-row revision).
- Negative (unconnected org): repeat the arrange in `UNCONNECTED_ORG` (seed + won). After `publishPendingPositions`, assert `readOutbox(UNCONNECTED_ORG)` is empty and `readFeed(UNCONNECTED_ORG).events` is empty. This is overview acceptance 3 ("a sale in an unconnected Organization enqueues nothing and behaves exactly as today").
- 401 (unauthorized ticket): `const bad = await app.request('/integration/v1/feed?after=0&limit=100', { headers: { Authorization: 'Bearer garbage' } });` assert `bad.status === 401` and the body carries no reason string (matches the Hub prompt: "sem dizer por que").

### Case 2 - a settlement recorded in one app appears in the other

Producer half (local baixa -> feed):

- Arrange: seed a won sale; take `r1` (the `1/2` receivable).
- Act: `const b = await recordSettlement(getDb(), FIX, actor, { targetKind: 'receivable', targetId: r1.id, paidOn: '2026-09-01' }); expect(b.ok).toBe(true);` then `await publishPendingPositions({ adapter });`.
- Assert: `readFeed(FIX)` (or the mounted feed route) contains one `fxl-sales.settlement.recorded` whose payload (`isSettlementRecordedV1`) has `obligationRef === 'fxl-sales:' + r1.id`, `settlementRef === 'fxl-sales:' + b.settlement.id` (or the slice-03 settlementRef shape; assert the `fxl-sales:` prefix and the persisted settlement uuid), `amountCents === 300000`, `paidOn === '2026-09-01'`, `recordedBy.app === 'fxl-sales'`.

Consumer half (finance settlement -> local origin='finance' baixa, anti-echo):

- Arrange: on the SAME sale take `r2` (the `2/2` receivable, still open). Build a `SimulatedFinanceFeed`, push a `fxl-finance.settlement.recorded` with `obligationRef: 'fxl-sales:' + r2.id`, `amountCents: 200000`, `paidOn: '2026-09-02'`, a fresh `settlementRef`.
- Act: `const report = await pullOnce({ adapter, config, handlers });`.
- Assert:
  - `report.applied === 1` (the handler ran once) and re-running `pullOnce` again yields `applied === 0`, `skipped >= 1` (inbox idempotency; the cursor has advanced).
  - `settlementsOf(FIX)` now contains a `sales_ops_settlements` row for `r2` with `type === 'baixa'` and `origin === 'finance'`.
  - The `r2` row status cache is `paid` (`liquidacaoDaLinha` / the reducer applied). Read `salesOpsReceivables` for `r2.id` and assert `status === 'paid'`.
  - Anti-echo (hard rule): `await publishPendingPositions({ adapter });` then assert `readOutbox(FIX, 'fxl-sales.settlement.recorded')` still has ONLY the producer-half event (the one for `r1`) and NO event referencing the finance `settlementRef` or `r2`. A remote fact never emits a local fact.

### Case 3 - a reversal syncs on each side

Producer half (local estorno -> feed):

- Arrange: seed a won sale; `recordSettlement` a baixa on `r1` (`paidOn:'2026-09-01'`).
- Act: `const rev = await reverseSettlement(getDb(), FIX, actor, b.settlement.id, { reason: 'duplicado' }); expect(rev.ok).toBe(true);` then `await publishPendingPositions({ adapter });`.
- Assert: the feed contains one `fxl-sales.settlement.reversed` whose payload (`isSettlementReversedV1`) has `reversesSettlementRef` pointing at the baixa's settlementRef, `amountCents === 300000`, `reversedOn` a civil day, `recordedBy.app === 'fxl-sales'`, and (if present) `reason === 'duplicado'`. The row `r1` returns to `open`.

Consumer half (finance estorno -> local origin='finance' estorno):

- Arrange: reuse the case-2 consumer setup on a fresh receivable `r2`: push and `pullOnce` a `fxl-finance.settlement.recorded` (origin finance baixa) first, then push a `fxl-finance.settlement.reversed` citing that `settlementRef`.
- Act: `await pullOnce({ adapter, config, handlers });` for the reversal.
- Assert:
  - `settlementsOf(FIX)` has an `estorno` row for `r2` with `origin === 'finance'` and `reversesSettlementId` linking the finance baixa row (the local row that mirrors the finance baixa).
  - `r2` status cache is back to `open` (`salesOpsReceivables`), and `reduceSettlement` over the two finance facts yields `openAmountCents === 200000`, `status === 'open'`.
  - Anti-echo again: after `publishPendingPositions`, no `fxl-sales.settlement.reversed` was emitted for the finance estorno.

### Case 4 - a sale with an active baixa cannot leave `won`

This guard already exists (`transitionSale` checks `findActiveSettlementRows` before applying `SALE_TRANSITIONS`); assert it still holds and produces no spurious emission.

- Arrange: seed a won sale; `recordSettlement` a baixa on `r1`.
- Act: `const t = await transitionSale(getDb(), FIX, sale.id, 'open');`.
- Assert:
  - `t.ok === false` and `t.reason === 'sale_has_active_settlements'` with `t.rows` naming `{ kind:'receivable', id: r1.id, label:'1/2' }` (mirror the settlements.integration.test.ts assertion).
  - The sale is still `won` (`salesOpsSales`), and payables are unchanged.
  - `await publishPendingPositions({ adapter });` then assert no `fxl-sales.obligation.upserted` with `state === 'voided'` for this sale's rows was emitted by the failed transition (the refusal writes nothing, so nothing was enqueued). Compare `readOutbox(FIX)` count before and after the failed transition: unchanged.

### Case 5 - simultaneous integral baixa in both apps -> "registrada em duplicidade"

Per doubts doc line 1157: two integral baixas (one in each app) both stay recorded, the row is paid, and it is marked "registrada em duplicidade" for a human to reverse one.

- Arrange: seed a won sale; take `r1` (300000 open).
- Act:
  1. Local integral baixa: `await recordSettlement(getDb(), FIX, actor, { targetKind:'receivable', targetId: r1.id, paidOn:'2026-09-01' })` -> origin `manual`, row becomes `paid`.
  2. Finance integral baixa on the SAME row through the consumer: push `fxl-finance.settlement.recorded` with `obligationRef:'fxl-sales:'+r1.id`, `amountCents:300000`, `paidOn:'2026-09-03'`, then `await pullOnce({ adapter, config, handlers })`. Slice 04's finance apply records the fact as an immutable baixa even though the row is already `paid` (a remote fact is always recorded; the reducer handles the union), which is exactly the concurrency the marking exists for. `report.applied === 1`.
- Assert (primary, always available):
  - `settlementsOf(FIX)` for `r1` has exactly two `type==='baixa'` rows, one `origin==='manual'` and one `origin==='finance'`, and zero `estorno` rows.
  - Build the `reduceSettlement` inputs from those two facts (obligation snapshot `{ obligationRef:'fxl-sales:'+r1.id, amountCents:300000, state:'active' }`; two `SettlementFact`s with `origin:'local'` for the manual and `origin:'remote'` for the finance one) and assert: `status === 'paid'`, `activeSettlementRefs.length === 2`, `localSettlementRefs.length === 1`, `remoteSettlementRefs.length === 1`, `openAmountCents === 0`. A row that is paid while carrying one local AND one remote active settlement IS the "registrada em duplicidade" condition.
- Assert (secondary, BIND): if slice 04 exposes a named duplicidade predicate or a persisted marker (grep result), assert it reports `r1` as duplicated. If none exists, record in AUDIT.md that the marking is asserted only at the reducer level in this repo.
- Anti-echo: after `publishPendingPositions`, the org emitted exactly ONE `fxl-sales.settlement.recorded` (the local manual baixa) and NONE for the finance baixa.

## Cross-process cases left untested (record verbatim in AUDIT.md)

This E2E runs in one process against one repo. The following are out of reach here and MUST be logged so the gaps are explicit before any production enable:

1. A REAL Finance app producing `fxl-finance.settlement.*` over HTTP and consuming `fxl-sales.*` from this app's real feed: the Finance side is a simulated in-memory feed through `fetchFeedPage`, so the true cross-app wire (Finance's outbox -> Finance's feed route -> this app's puller with a real ticket) is not exercised.
2. A REAL Hub answering `POST /integration/tickets`, `POST /integration/tickets/introspect` and `POST /integration/heartbeat` over the network: replaced by `createFakeIntegrationAuthority`, whose `issuedTickets` map is per-instance, so cross-process ticket verification (Finance mints, Sales verifies) cannot be tested here at all.
3. Multi-instance concurrency of the position publisher (advisory lock) and the puller (`SELECT ... FOR UPDATE SKIP LOCKED`) across real concurrent API instances: covered by the package's own tests, not re-proven here.
4. The real heartbeat POST to a live Hub and the operator revocation budget (60s introspection cache ceiling) in a real deployment.
5. `deepLinkPath` resolution: this app emits the field per the slice 03/07 decision, but the absolute URL is built by the real Finance web from the Hub's `web_url`, and the cold-entry Sales route does not exist yet; the round trip cannot be validated in-repo.
6. The outbox prune low-water sourced from real consumer heartbeats the Hub keeps: in fake mode there is no Hub store, so prune is validated (if at all) only with an injected low-water, not the real Hub-derived value.

## Run command

```bash
pnpm --filter @fxl-sales/api test:integration finance-integration
```

This requires the local Docker test DB up and the `fxl_sales_test` role, exactly as every other integration test (project CLAUDE.md "Testing"; `apps/api/test/rls/setup-env.ts` hard-overrides `DATABASE_URL`).
Never run it in watch mode; `test:integration` is `VITEST_INTEGRATION=1 vitest run` (run-once).

## Oracle status

This file IS slice 09's named locked oracle.
Its five `it` blocks (case 1 through case 5) plus the anti-echo and unconnected-org sub-assertions are the acceptance gate for the whole feature's E2E claim.
