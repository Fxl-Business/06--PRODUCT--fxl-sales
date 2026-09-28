---
id: 08-wire-boot-and-prune
milestone: v4.1.0
status: todo
depends_on: [02-hub-client-and-config, 03-producer-outbox-and-events, 04-consumer-inbox-puller, 05-feed-route, 06-fake-dev-fixture-authority]
files_modified: [apps/api/src/server.ts, apps/api/src/auth/select.ts, apps/api/src/jobs/nightly-job.ts, apps/api/src/domains/integration/start-integration.ts, apps/api/src/domains/integration/__tests__/start-integration.test.ts, apps/api/src/jobs/__tests__/nightly-job.test.ts]
acceptance:
  - "A composition root `startIntegration()` resolves the runtime ONCE at boot: null when the integration is neither configured nor faked (boot stays byte-for-behaviour identical to today), the FAKE authority when SALES_AUTH_FAKE is set, the REAL authority (from the hub config) otherwise. Never a per-request branch."
  - "When a runtime exists, `startIntegration()` mounts the slice-05 feed router at `/integration/v1/feed` and, unless suppressed for tests, starts exactly one position publisher, one consumer puller, and one heartbeat loop (producer + consumer roles), each returning a stoppable handle."
  - "The FAKE branch reaches the fake authority ONLY through the slice-06 dev-only accessor via dynamic import; `start-integration.ts` never names `@fxl-business/fxl-contracts/testing` and never statically imports any dev-only module. The REAL branch calls slice-02 factories over the config built from the existing hub config, with NO new env var."
  - "With no hub config and no fake flag, `startIntegration()` returns null, mounts nothing, starts no loop, and does not throw; with a hub config present but zero activations, the loops start and make no network calls (pairs() is empty)."
  - "`nightly-job.ts` schedules a fourth task that calls `pruneIntegrationOutbox` with a FAIL-CLOSED low-water (`resolveOutboxLowWater()` returns null in the pilot), so it deletes nothing and never drops below OUTBOX_MIN_RETENTION_DAYS; it has its own try/catch and is stopped by `stopNightlyJob()`."
  - "Graceful shutdown (SIGTERM/SIGINT) stops the publisher, puller and heartbeat loop, stops the nightly job, closes the http server and the db pools, once and idempotently."
  - "Loops never auto-start under NODE_ENV=test; the oracle drives the pure composition functions with injected/mocked package start* helpers and a fake clock, never the timer."
  - "type-check, build, lint, full unit + integration suites, and `scripts/assert-web-bundle-clean.mjs` all stay green; this slice is API-only and touches no web source."
---

# 08 - Wire boot and prune

## Goal

Turn the modules that slices 02-05 built into a running system: at API boot, start the single
position publisher, the consumer puller, and the heartbeat loop; mount the feed route; and add a
nightly outbox-prune routine. Select the FAKE vs REAL authority exactly once at boot, mirroring
`apps/api/src/auth/select.ts`. Nothing here re-decides domain behaviour; it is pure composition,
gating and lifecycle.

The boot entry file is **`apps/api/src/server.ts`** (there is no `index.ts`; the local-database
guard and the whole dynamic-import block live in `server.ts`). Every rule in the project CLAUDE.md
"Local database guard" section applies: `server.ts` statically imports ONLY `./env.js` and
`./db/local-database-guard.js` and reaches everything else through `await import(...)`. This slice
MUST NOT convert any of that back to eager imports and MUST NOT add a new static import to
`server.ts`.

---

## Cross-slice contracts consumed

These symbols are produced by slices 02-05-06 (their plan files are not written yet; slices 02/03/06
land in Wave 2 and 04/05 in Wave 3, so all are merged before this slice runs in Wave 5). The names
below are the expected contract. **If a producing slice named a symbol differently, adapt the import
specifier only - the wiring shape in this plan is fixed and is not a design decision the executor
re-opens.** Every runtime import is from the package barrel `@fxl-business/fxl-contracts` (a runtime
dependency) or from a sibling `apps/api/src/domains/integration/*` module; the fake authority is
reached only through the slice-06 dev-only accessor.

| Symbol | From | Shape used here |
|---|---|---|
| `startPositionPublisher(options): PositionPublisherHandle` | `@fxl-business/fxl-contracts` | `{ adapter, onError, now? }` -> `{ stop() }` |
| `startIntegrationPuller(options): IntegrationPullerHandle` | `@fxl-business/fxl-contracts` | `{ adapter, config:{ pairs, fetchFeedPage, limit? }, handlers, onError, now? }` -> `{ stop() }` |
| `pruneIntegrationOutbox(options): Promise<number>` | `@fxl-business/fxl-contracts` | `{ adapter, lowWaterPosition, minRetentionDays?, now? }` |
| `OUTBOX_MIN_RETENTION_DAYS` | `@fxl-business/fxl-contracts` | `30` |
| `buildIntegrationAuthorityConfig(env): IntegrationAuthorityConfig \| null` | slice 02 `integration/config.ts` | null when hub config absent; built from `hubEnvBag`, never a new env var |
| `createRealIntegrationAuthority(config): { ticketClient, verifier, reporter, discovery }` | slice 02 `integration/hub-client.ts` | wraps `createTicketClient`/`createIntrospectionVerifier`/`createHeartbeatReporter` + contracts/activations discovery |
| `createStandaloneIntegrationAdapter(db): SqlIntegrationAdapter` | slice 03 `integration/outbox-adapter.ts` | wraps a Drizzle handle so `query()`/`transaction()` run raw SQL on the pooled connection (NOT a business tx) |
| `createFinanceConsumer({ adapter, ticketClient, discovery }): { pairs, fetchFeedPage, handlers }` | slice 04 `integration/consumer.ts` | `pairs: () => Promise<IntegrationPullPair[]>` from discovery, `fetchFeedPage` calling the Finance feed with a ticket, `handlers` keyed by `eventName` (finance settlement recorded/reversed, origin=finance, anti-echo) |
| `createIntegrationFeedRouter({ adapter, verifier }): Hono` | slice 05 `integration/feed-routes.ts` | the `GET /integration/v1/feed` handler; introspection-guarded; `organizationForFeedRead` resolves the org from the decision only |
| `collectHeartbeatInputs({ adapter, discovery, pairs }): Promise<HeartbeatInput[]>` | slice 02 `integration/heartbeat.ts` | one input per (counterpart, role); metadata only (no money, no names, no obligation refs) |
| `resolveFakeIntegrationAuthority(): Promise<{ ticketClient, verifier, reporter, pairs } \| null>` | slice 06 dev-only seam (see below) | the fake authority created ONCE at auth-fake boot, plus the fake activation pairs; null if the fake authority was not installed |

### The slice-06 fake seam (contract this slice depends on)

Slice 06 wires `createFakeIntegrationAuthority` (from `@fxl-business/fxl-contracts/testing`) once at
the `auth-fake` boot with `environment: 'development'`, `applicationId: 'app.fxl-sales'`, and the
fixture activations for `FIXTURE_INTEGRATED_ORGANIZATION_ID` (`org_fake_integrado`). It MUST expose
that single created authority to this slice through a **dev-only accessor reached only by dynamic
import**, so that `start-integration.ts` never itself names `@fxl-business/fxl-contracts/testing`
(keeping the `/testing` subpath confined to a dev seam, the same discipline `apps/api/src/auth/select.ts`
applies to `@fxl-sales/auth-fake`):

```ts
// produced by slice 06, e.g. apps/api/src/auth/integration-authority-select.ts
// (reached ONLY via `await import(...)`, never a static import).
export async function resolveFakeIntegrationAuthority(): Promise<{
  ticketClient: TicketClient;
  verifier: IntrospectionVerifier;
  reporter: HeartbeatReporter;
  /** The fake activations as pull pairs (producer = Finance, org = fixture). */
  pairs: IntegrationPullPair[];
} | null>;
```

If slice 06 shipped the accessor under a different filename or name, this slice adapts the dynamic
import specifier only. This slice does NOT reconstruct the fake authority itself (a second instance
would give the heartbeat `reports()` dev view a divergent history).

---

## New file: `apps/api/src/domains/integration/start-integration.ts`

This is the composition root. It is production-safe: it statically imports only the package barrel
and the sibling `integration/*` modules; the fake authority is reached only through a dynamic import
of the slice-06 seam. Split into a PURE resolver (testable, no side effects) and a starter (mounts +
starts, returns handles).

```ts
import type { Hono } from 'hono';
import {
  startPositionPublisher,
  startIntegrationPuller,
  type PositionPublisherHandle,
  type IntegrationPullerHandle,
} from '@fxl-business/fxl-contracts';
import { getAdminDb } from '../../db/client.js';
import { isFakeAuthRequested, isProductionEnv } from '../../auth/select.js';
import { buildIntegrationAuthorityConfig } from './config.js';           // slice 02
import { createRealIntegrationAuthority } from './hub-client.js';        // slice 02
import { collectHeartbeatInputs } from './heartbeat.js';                 // slice 02
import { createStandaloneIntegrationAdapter } from './outbox-adapter.js';// slice 03
import { createFinanceConsumer } from './consumer.js';                   // slice 04
import { createIntegrationFeedRouter } from './feed-routes.js';          // slice 05

export interface IntegrationRuntime {
  mode: 'fake' | 'real';
  adapter: SqlIntegrationAdapter;
  ticketClient: TicketClient;
  verifier: IntrospectionVerifier;
  reporter: HeartbeatReporter;
  discovery: Discovery | null;            // null in fake mode
  pairs: () => Promise<IntegrationPullPair[]>;
  fetchFeedPage: FetchFeedPage;
  handlers: Record<string, IntegrationEventHandler>;
}

/**
 * Decide the runtime ONCE. No network, no timers, no route mounting - side-effect free except
 * for the dynamic import of the fake seam. Returns null when the integration is neither
 * configured (a real hub config) nor faked (SALES_AUTH_FAKE): boot then behaves exactly as today.
 */
export async function resolveIntegrationRuntime(
  env: NodeJS.ProcessEnv = process.env,
  deps = defaultRuntimeDeps,
): Promise<IntegrationRuntime | null> {
  const adapter = deps.makeAdapter(getAdminDb());

  // FAKE first, and it wins whenever SALES_AUTH_FAKE is set - the same precedence select.ts uses.
  if (isFakeAuthRequested(env)) {
    if (isProductionEnv(env)) return null;           // fail closed; select.ts already throws first
    const fake = await deps.loadFakeAuthority();      // dynamic import of the slice-06 seam
    if (!fake) return null;
    const consumer = createFinanceConsumer({ adapter, ticketClient: fake.ticketClient, discovery: null });
    return {
      mode: 'fake',
      adapter,
      ticketClient: fake.ticketClient,
      verifier: fake.verifier,
      reporter: fake.reporter,
      discovery: null,
      pairs: async () => fake.pairs,                   // fixed fake activations
      fetchFeedPage: consumer.fetchFeedPage,
      handlers: consumer.handlers,
    };
  }

  const config = buildIntegrationAuthorityConfig(env);
  if (!config) return null;                            // no hub config -> integration off, boot as today
  const authority = createRealIntegrationAuthority(config);
  const consumer = createFinanceConsumer({
    adapter,
    ticketClient: authority.ticketClient,
    discovery: authority.discovery,
  });
  return {
    mode: 'real',
    adapter,
    ticketClient: authority.ticketClient,
    verifier: authority.verifier,
    reporter: authority.reporter,
    discovery: authority.discovery,
    pairs: consumer.pairs,
    fetchFeedPage: consumer.fetchFeedPage,
    handlers: consumer.handlers,
  };
}

export interface IntegrationHandles {
  stop: () => Promise<void>;
}

/**
 * Mount the feed route and start the three loops. `startLoops` defaults to false under
 * NODE_ENV=test so importing server.ts in a test never opens a network loop; production boot
 * passes true. Returns a single stoppable handle for graceful shutdown.
 */
export async function startIntegration(options: {
  app: Hono;
  env?: NodeJS.ProcessEnv;
  runtime?: IntegrationRuntime | null;   // injectable for the oracle
  startLoops?: boolean;
  startPublisher?: typeof startPositionPublisher;   // injectable for the oracle
  startPuller?: typeof startIntegrationPuller;       // injectable for the oracle
  now?: () => Date;
  heartbeatIntervalMs?: number;                      // default 60_000
}): Promise<IntegrationHandles | null> {
  const env = options.env ?? process.env;
  const runtime = options.runtime ?? (await resolveIntegrationRuntime(env));
  if (!runtime) return null;

  // Mount the feed route (no network; no appAuthMiddleware - the route is ticket-introspected).
  options.app.route('/integration/v1/feed', createIntegrationFeedRouter({
    adapter: runtime.adapter,
    verifier: runtime.verifier,
  }));

  const startLoops = options.startLoops ?? (env.NODE_ENV !== 'test');
  if (!startLoops) {
    return { stop: async () => {} };   // route mounted, no loops (test / opt-out)
  }

  const publisher = (options.startPublisher ?? startPositionPublisher)({
    adapter: runtime.adapter,
    now: options.now,
    onError: (err) => console.error('[integration] position publisher tick failed:', err),
  });

  const puller = (options.startPuller ?? startIntegrationPuller)({
    adapter: runtime.adapter,
    config: { pairs: runtime.pairs, fetchFeedPage: runtime.fetchFeedPage },
    handlers: runtime.handlers,
    now: options.now,
    onError: (err, pair) => console.error('[integration] puller tick failed:', pair, err),
  });

  const heartbeat = startHeartbeatLoop(runtime, options.heartbeatIntervalMs ?? 60_000, options.now);

  let stopped = false;
  return {
    stop: async () => {
      if (stopped) return;
      stopped = true;
      await Promise.allSettled([publisher.stop(), puller.stop(), heartbeat.stop()]);
    },
  };
}
```

### The heartbeat loop (this slice owns the timer)

The package ships `createHeartbeatReporter` and `buildHeartbeatBody` but NO loop, so the interval is
boot code. Keep it minimal, reentrancy-guarded (mirroring the package's own publisher/puller
`setInterval` shape), and non-throwing:

```ts
function startHeartbeatLoop(runtime: IntegrationRuntime, intervalMs: number, now?: () => Date) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const inputs = await collectHeartbeatInputs({
        adapter: runtime.adapter,
        discovery: runtime.discovery,
        pairs: runtime.pairs,
      });
      for (const input of inputs) {
        await runtime.reporter.report(input);   // reporter builds the body via buildHeartbeatBody
      }
    } catch (err) {
      console.error('[integration] heartbeat tick failed:', err);   // best-effort, never crash
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => { void tick(); }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();   // never keep the process alive on this alone
  return {
    stop: async () => {
      clearInterval(timer);
      while (running) await new Promise((r) => setTimeout(r, 5));
    },
  };
}
```

Notes:
- `reporter.report` is best-effort (never throws except on a 401, which is a config error that must
  stay loud); the try/catch around the loop keeps a transient network failure from crashing the
  process, and a 401 surfaces in the log rather than being swallowed.
- Heartbeat body is metadata only (Hub prompt section 9): `collectHeartbeatInputs` in slice 02 is
  the only place that shapes it; this slice never assembles a body by hand.
- Multiple API instances each report their own heartbeats; the Hub upserts per
  `(reporterApplicationId, organizationId, counterpartApplicationId, role)`, so duplicate reporters
  are last-write-wins and safe. No leader election is needed for the heartbeat (see PC31 below).

### `defaultRuntimeDeps` (the injected seams)

```ts
const defaultRuntimeDeps = {
  makeAdapter: (db) => createStandaloneIntegrationAdapter(db),
  loadFakeAuthority: async () => {
    const seam = await import('../../auth/integration-authority-select.js'); // slice-06 dev seam
    return seam.resolveFakeIntegrationAuthority();
  },
};
```

The standalone adapter runs over `getAdminDb()` (cross-tenant, admin session) because the position
publisher assigns positions across every org and locks the single global high-water row, and the
prune spans orgs - the same reason `nightly-job.ts` and `hub_bff_*` use `getAdminDb()`. The feed
route still restricts every read to the introspection-decided org (`readIntegrationFeed` takes
`organizationId`), so admin access does not widen what a ticket can read.

---

## Boot insertion points in `apps/api/src/server.ts`

All edits stay inside the existing dynamic-import discipline (no new static imports).

1. **Add to the dynamic-import block** (after the existing `const { setupNightlyJob } = await import('./jobs/nightly-job.js');` line, before `const app = new Hono();`):

   ```ts
   const { stopNightlyJob } = await import('./jobs/nightly-job.js');   // reuse the existing dynamic import; add stopNightlyJob to its destructuring instead of a second import
   const { startIntegration } = await import('./domains/integration/start-integration.js');
   const { closeDb } = await import('./db/client.js');
   ```
   (Prefer extending the existing `await import('./jobs/nightly-job.js')` destructuring to also bind
   `stopNightlyJob` rather than importing the module twice.)

2. **Mount + start the integration**, placed AFTER the last `app.route(...)` for the existing domains
   and BEFORE `app.get('/', ...)`/`app.notFound(...)` so the feed route is registered on the same
   `app` (the feed router is mounted inside `startIntegration`):

   ```ts
   // Sales<->Finance control-plane integration (v4.1.0). Resolves fake vs real ONCE; returns
   // null (and mounts/starts nothing) when the integration is neither configured nor faked, so an
   // unconfigured boot behaves exactly as before. Loops are gated off under NODE_ENV=test.
   const integration = await startIntegration({ app, env });
   ```

3. **Nightly job stays where it is** (`setupNightlyJob();` after `notFound`). The new prune task is
   added inside `nightly-job.ts` (next section), not in `server.ts`.

4. **Capture the server and register graceful shutdown**, replacing the final `serve(...)` call:

   ```ts
   const server = serve({ fetch: app.fetch, port, hostname });

   let shuttingDown = false;
   const shutdown = async (signal: string) => {
     if (shuttingDown) return;
     shuttingDown = true;
     console.log(`[fxl-sales-api] ${signal} received, shutting down`);
     try {
       await integration?.stop();
       stopNightlyJob();
       await new Promise<void>((resolve) => server.close(() => resolve()));
       await closeDb();
     } finally {
       process.exit(0);
     }
   };
   process.once('SIGTERM', () => void shutdown('SIGTERM'));
   process.once('SIGINT', () => void shutdown('SIGINT'));
   ```

   This is additive: today `server.ts` registers no signal handlers and never calls `stopNightlyJob`.
   The publisher/puller/heartbeat handles are the reason a clean stop matters now (the global
   CLAUDE.md rule forbids leaving loops orphaned), and `stopNightlyJob` + `closeDb` come along for
   free. When `integration` is null the shutdown still stops the nightly job and closes the pools,
   which is correct and harmless.

---

## Nightly-job addition: `apps/api/src/jobs/nightly-job.ts`

Add a fourth scheduled task, its own `try/catch`, running LAST (after the destructive purge at
`30 3`), at `45 3 * * *`. Extend `stopNightlyJob()` to stop it.

```ts
import { pruneIntegrationOutbox, OUTBOX_MIN_RETENTION_DAYS } from '@fxl-business/fxl-contracts';
import { createStandaloneIntegrationAdapter } from '../domains/integration/outbox-adapter.js';
// ...existing imports...

let outboxPruneTask: ScheduledTask | null = null;

// inside setupNightlyJob(), after cadastroPurgeTask:
outboxPruneTask = cron.schedule('45 3 * * *', async () => {
  try {
    const deleted = await runIntegrationOutboxPrune();
    console.log(`[nightly-job] integration outbox prune: ${deleted} rows removed`);
  } catch (err) {
    console.error('[nightly-job] integration outbox prune failed:', err);
  }
});

/**
 * FAIL-CLOSED low-water. See the decision below and AUDIT.md: the pilot has no Application-facing
 * API to read the consumer cursor positions the Hub keeps, so the lowest position every active
 * consumer has passed is UNKNOWN, and unknown must never authorize a delete. Returns null, which
 * `pruneIntegrationOutbox` treats as "delete nothing".
 */
export function resolveOutboxLowWater(): bigint | null {
  return null;
}

/** Extracted for testability, mirroring runHoldPromotion(). */
export async function runIntegrationOutboxPrune(): Promise<number> {
  const adapter = createStandaloneIntegrationAdapter(getAdminDb());
  return pruneIntegrationOutbox({
    adapter,
    lowWaterPosition: resolveOutboxLowWater(),
    minRetentionDays: OUTBOX_MIN_RETENTION_DAYS,
  });
}

// inside stopNightlyJob():
if (outboxPruneTask) {
  outboxPruneTask.stop();
  outboxPruneTask = null;
}
```

### Low-water decision (to record in AUDIT.md)

- The producer's prune low-water is "the lowest position every ACTIVE consumer of the Sales feed has
  passed". The pilot's only way to learn that is the consumer cursor positions the Hub stores from
  heartbeats. The five Application-facing Hub routes are `contracts`, `activations`, `tickets`,
  `tickets/introspect`, `heartbeat` (Hub prompt section 11) - **none returns a peer consumer's
  cursor**. In fake mode there is no real Hub store at all.
- Therefore `resolveOutboxLowWater()` returns **null** (fail-closed): the prune is SCHEDULED and
  runs, but with a null low-water it deletes nothing (`pruneIntegrationOutbox` returns 0 without
  running the DELETE). The 30-day floor (`OUTBOX_MIN_RETENTION_DAYS`) is honoured trivially. This is
  the safe default the overview asked to pick and log; the wiring is in place so future work only
  swaps the low-water source once the Hub exposes a consumer-cursor read.
- Record this in `AUDIT.md` under the run's decisions, alongside the `deepLinkPath` decision owned by
  slice 03/07.

### PC31 (jobs and multiple instances)

The existing `if (task) return` guard is per-process, and there is no leader election across
instances (PC31, still open). This slice's prune is safe under multiple instances regardless: with a
null low-water it is a no-op, and when a real low-water later exists the DELETE
(`position <= lowWater AND occurred_at < now - 30d`) is idempotent, so two instances running it the
same night converge. The position publisher is advisory-lock elected and the puller uses
`FOR UPDATE SKIP LOCKED`, so both are already multi-instance safe by construction. No new leader
election is introduced here; the residual PC31 gap is unchanged and remains an out-of-scope note.

---

## Gating rules (closed list)

- **Fake vs real is decided once**, in `resolveIntegrationRuntime`, by `isFakeAuthRequested(env)`
  (fake wins) else the presence of a real hub config. Never a per-request branch.
- **Unconfigured boot is unchanged**: no hub config and no fake flag -> runtime null -> nothing is
  mounted, nothing is started, no throw.
- **No new env var**: the real config comes from `buildIntegrationAuthorityConfig` over the existing
  hub config (`hubEnvBag`); the fake path from `SALES_AUTH_FAKE`, already defined by the dev-identity
  mode. `SALES_INTEGRATION_*` is NOT introduced.
- **Loops off under tests**: `startLoops` defaults to `env.NODE_ENV !== 'test'`. `server.ts` is not
  imported by any test, and the oracle drives the pure functions directly, so no network loop opens
  during `pnpm test` or `pnpm --filter @fxl-sales/api test:integration`.
- **Production + fake is impossible**: `isProductionEnv(env)` short-circuits the fake branch to null;
  `select.ts` already throws before `startIntegration` is reached, so this is belt-and-suspenders.

---

## Named oracle tests

### 1. `apps/api/src/domains/integration/__tests__/start-integration.test.ts` (NEW)

Drives the pure composition functions with mocked package start* helpers and injected deps; never
the real timer, never a socket. Mock `@fxl-business/fxl-contracts` (for `startPositionPublisher` /
`startIntegrationPuller`), and inject `runtime`, `startPublisher`, `startPuller` where the signature
allows, plus a fake `now`.

Cases (each named in the `it(...)` title):

- **`resolveIntegrationRuntime returns null when neither configured nor faked`** - env without
  SALES_AUTH_FAKE and with `buildIntegrationAuthorityConfig` stubbed to null -> null; assert no
  fake-seam import was attempted.
- **`resolveIntegrationRuntime selects the fake authority when SALES_AUTH_FAKE is set`** - env
  `{ SALES_AUTH_FAKE: '1', NODE_ENV: 'development' }`, `loadFakeAuthority` stub returns a fake
  authority with `pairs` -> `mode: 'fake'`, and `buildIntegrationAuthorityConfig` is NOT consulted.
- **`resolveIntegrationRuntime refuses the fake authority under NODE_ENV=production`** - fake flag +
  production -> null; `loadFakeAuthority` never called.
- **`resolveIntegrationRuntime selects the real authority from the hub config`** - no fake flag,
  `buildIntegrationAuthorityConfig` returns a config -> `mode: 'real'`, discovery non-null.
- **`startIntegration mounts the feed route at /integration/v1/feed`** - inject a runtime; assert the
  app now routes `GET /integration/v1/feed` (e.g. `app.request('/integration/v1/feed')` reaches the
  slice-05 handler, not the 404 fallback). Use a stub feed router that returns a sentinel.
- **`startIntegration starts exactly one publisher, one puller and one heartbeat loop when startLoops is true`**
  - injected `startPublisher`/`startPuller` spies each called once; assert a heartbeat timer was
  created (fake timers) and that `reporter.report` fires on the first tick.
- **`startIntegration starts no loop when startLoops is false`** - `startPublisher`/`startPuller`
  spies never called; the feed route is still mounted; the returned handle's `stop()` resolves.
- **`startIntegration returns null and mounts nothing when runtime is null`** - `runtime: null` ->
  returns null; `/integration/v1/feed` still 404s.
- **`the returned handle stops the publisher, puller and heartbeat, idempotently`** - call `stop()`
  twice; each underlying `stop` spy called exactly once; `clearInterval` observed.

### 2. `apps/api/src/jobs/__tests__/nightly-job.test.ts` (EDIT the existing wiring oracle)

Extend the existing mocked-cron wiring test (it already mocks `node-cron`, `db/client`, etc.). Add
mocks for the package and the slice-03 adapter:

```ts
vi.mock('@fxl-business/fxl-contracts', () => ({
  OUTBOX_MIN_RETENTION_DAYS: 30,
  pruneIntegrationOutbox: vi.fn(async () => 0),
}));
vi.mock('../../domains/integration/outbox-adapter.js', () => ({
  createStandaloneIntegrationAdapter: vi.fn(() => ({})),
}));
```

Cases:

- **Update `registers the ... nightly tasks on ONE scheduler and stops every one of them`** to expect
  FOUR expressions `['0 3 * * *', '15 3 * * *', '30 3 * * *', '45 3 * * *']` and `cronMock.stops`
  length 4, each stopped once.
- **`the outbox prune runs fail-closed - null low-water deletes nothing`** - `resolveOutboxLowWater()`
  returns null; invoke `runIntegrationOutboxPrune()` and assert `pruneIntegrationOutbox` was called
  with `lowWaterPosition: null` and `minRetentionDays: OUTBOX_MIN_RETENTION_DAYS`, returning 0.
- **`the prune task is contained in its own try/catch`** - make the package `pruneIntegrationOutbox`
  mock reject; grab the 4th registered handler and assert it resolves to undefined and logs
  `'[nightly-job] integration outbox prune failed:'` (mirrors the existing purge-isolation case).

Both oracles are locked names for this slice's slice-level verification.

---

## Constraints checklist (verify before done)

- [ ] `server.ts` still statically imports ONLY `./env.js` and `./db/local-database-guard.js`; every
      new dependency is reached via `await import(...)`. No line was converted back to a static
      import.
- [ ] `start-integration.ts` never names `@fxl-business/fxl-contracts/testing` and never statically
      imports a dev-only module; the fake authority is reached only through the dynamic import of the
      slice-06 seam. `scripts/__tests__/auth-fake-isolation.test.mjs` is about `@fxl-sales/auth-fake`
      and stays green (this slice adds no reference to that package).
- [ ] Boot with no hub config and no `SALES_AUTH_FAKE` is behaviourally identical to today (runtime
      null; nothing mounted or started; no throw). Boot with a hub config but zero activations starts
      the loops and makes no network calls (`pairs()` empty).
- [ ] The nightly prune deletes nothing (null low-water) and never drops below
      `OUTBOX_MIN_RETENTION_DAYS`; the decision is recorded in `AUDIT.md`.
- [ ] Graceful shutdown stops publisher, puller, heartbeat, nightly job, http server and db pools,
      once and idempotently; no loop is left orphaned.
- [ ] `pnpm run type-check`, `pnpm run build`, `pnpm run lint`, `pnpm test`,
      `pnpm --filter @fxl-sales/api test:integration`, and `scripts/assert-web-bundle-clean.mjs` are
      green. This slice is API-only and edits no `apps/web` source.
