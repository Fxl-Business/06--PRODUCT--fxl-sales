---
id: 03-transactional-server-sessions
milestone: null
status: parked
depends_on: [01-sdk-contract-baseline]
files_modified: [CLAUDE.md, apps/api/.env.dev.example, apps/api/.env.example, apps/api/drizzle/0010_durable_bff_sessions.sql, apps/api/drizzle/meta/0010_snapshot.json, apps/api/drizzle/meta/_journal.json, apps/api/src/db/__tests__/hub-session-migration-contract.test.ts, apps/api/src/db/schema.ts, apps/api/src/env.ts, apps/api/src/lib/__tests__/hub-bff-compat.test.ts, apps/api/src/lib/__tests__/hub-session-crypto.test.ts, apps/api/src/lib/__tests__/hub-session-persistence.test.ts, apps/api/src/lib/__tests__/hub-session-request-coordinator.test.ts, apps/api/src/lib/__tests__/hub-session-request-scope.test.ts, apps/api/src/lib/__tests__/hub-session-store.test.ts, apps/api/src/lib/hub-bff-compat.ts, apps/api/src/lib/hub-session-crypto.ts, apps/api/src/lib/hub-session-persistence.ts, apps/api/src/lib/hub-session-request-coordinator.ts, apps/api/src/lib/hub-session-request-scope.ts, apps/api/src/lib/hub-session-store.ts, apps/api/src/middleware/__tests__/app-auth-bff.test.ts, apps/api/src/middleware/__tests__/app-auth.test.ts, apps/api/src/middleware/app-auth.ts, apps/api/src/server.ts]
acceptance: "Given concurrent SDK 1.2 callback, refresh, switch, and logout requests, when same-session refresh credentials rotate, a recoverable upstream failure occurs, or the API restarts, then each response awaits only its request-scoped encrypted Postgres mutation, same-session operations are serialized, unrelated sessions proceed independently, recoverable cookies survive, permanent sessions become unauthenticated, and production never falls back to memory-only storage."
---

# Slice 03 - Transactional Server Sessions

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` for Red, Green, and Refactor, then hand the locked oracle to a separate Nexo Verify agent.

## Goal

Bridge the published `@fxl-business/hub-sdk` 1.2.0 synchronous `HubSessionStore` surface to awaited encrypted Postgres persistence at the product request boundary.
Serialize refresh-token-consuming SDK routes by opaque session ID, make callback durability request-scoped, classify recoverable and permanent Hub outcomes without replacing the SDK routes, and refuse production memory-only storage.

## Installed Contract and Compatibility Boundary

The installed artifact is `@fxl-business/hub-sdk@1.2.0` from `apps/api/node_modules/@fxl-business/hub-sdk`.
Its exact `HubSessionStore` contract is synchronous: `create(record): string`, `get(id): record | null`, `update(id, refreshToken): void`, `delete(id): void`, `createLogin(tx): string`, and `consumeLogin(id): tx | null`.
Its `createHubBff` option accepts that store and an injectable `fetchImpl`, but it does not expose the callback-created session ID, an async transaction callback, a clock, or a response hook.
The SDK remains the only implementation of OAuth, PKCE, discovery, callback exchange, refresh, switch, logout, JWKS, and bearer verification.
Do not copy SDK routes into this repository, call Hub OAuth endpoints from product routes, or edit the installed package.

The product compatibility layer may use only the SDK's documented injection seams and an outer Hono middleware.
The synchronous store mutates a process-local read view immediately because SDK 1.2.0 requires it, queues the matching Postgres mutation, and registers that exact promise in the current request scope.
The outer middleware does not acknowledge the SDK response until the request scope's own promises settle.
This is the awaited transaction boundary for SDK 1.2.0.

`HubSessionRequestScope` uses `AsyncLocalStorage` so a callback scope follows the SDK handler across discovery and token exchange awaits.
When `store.create()` generates the callback session ID, it registers `{ sessionId, operation }` in that callback's scope.
The scope therefore identifies and awaits the callback-created session without scanning global pending work.
There is no no-argument `whenIdle()`, all-session snapshot, global callback mutex, or process-wide persistence barrier.

Refresh, switch, and logout read the opaque secure or non-secure session cookie before the SDK handler runs.
`HubSessionRequestCoordinator.run(sessionId, task)` holds one process-local slot across the SDK store read, Hub call, SDK mutation, request-scoped persistence barrier, and response normalization.
Different session IDs use different slots and never await each other.
This slice is correct for the repository's current single API instance.
Distributed locks, replica coherence, and a future migration to the SDK's eventual native async transaction surface remain outside this slice.

## Required Interfaces

Implement these exact public shapes so the executor has no naming decision left.

```ts
export type HubSessionClock = () => Date;

export type PersistedHubSession = HubSessionRecord & { id: string };

export interface HubSessionPersistence {
  loadAll(): Promise<PersistedHubSession[]>;
  put(sessionId: string, record: HubSessionRecord, changedAt: Date): Promise<void>;
  remove(sessionId: string): Promise<void>;
}

export type HubAuthMutationRoute = 'callback' | 'refresh' | 'switch' | 'logout';

export type HubUpstreamOutcome =
  | { kind: 'permanent'; code: 'invalid' | 'expired' | 'revoked' | 'reuse_detected' | 'no_session' }
  | { kind: 'retryable'; reason: 'network' | 'timeout' | 'hub_unavailable' }
  | { kind: 'invalid_response' };

export type HubSessionRequestInput = {
  route: HubAuthMutationRoute;
  sessionId?: string;
};

export class HubSessionRequestScope {
  run<T>(input: HubSessionRequestInput, task: () => Promise<T>): Promise<T>;
  track(sessionId: string, operation: Promise<void>): void;
  currentSessionId(): string | undefined;
  markOutcome(outcome: HubUpstreamOutcome): void;
  currentOutcome(): HubUpstreamOutcome | undefined;
  shouldInspectBackchannel(): boolean;
}

// Exported from hub-session-request-scope.ts.
export class HubSessionPersistenceError extends Error {
  constructor();
}

export class DurableHubSessionStore implements HubSessionStore {
  constructor(options: {
    persistence: HubSessionPersistence;
    requestScope: HubSessionRequestScope;
    clock: HubSessionClock;
  });
  hydrate(): Promise<void>;
  create(data: HubSessionRecord): string;
  get(sessionId: string): HubSessionRecord | null;
  update(sessionId: string, hubRefreshToken: string): void;
  delete(sessionId: string): void;
  createLogin(transaction: HubLoginTransaction): string;
  consumeLogin(transactionId: string): HubLoginTransaction | null;
}

export class HubSessionRequestCoordinator {
  run<T>(sessionId: string, task: () => Promise<T>): Promise<T>;
  activeCount(): number;
}

export function createHubBffFetchCompat(options: {
  fetchImpl: typeof fetch;
  requestScope: HubSessionRequestScope;
  sessionStore: Pick<HubSessionStore, 'update'>;
  timeoutMs: number;
}): typeof fetch;

export function normalizeHubBffResponse(
  response: Response,
  outcome: HubUpstreamOutcome | undefined,
): Response;

export function createDrizzleHubSessionPersistence(
  encryptionKey: string | undefined,
): HubSessionPersistence;
```

`HubSessionRequestScope.run()` must create one fresh state containing only that request's writes and upstream outcome.
It must execute `task`, await every promise registered through `track`, throw one sanitized `HubSessionPersistenceError` when any tracked write rejects, and then release the `AsyncLocalStorage` state.
It must await tracked writes even when `task` throws so an SDK mutation is never abandoned after response construction starts.
It must reject `track()` outside an active scope with a fixed invariant error so no future route can silently enqueue an unacknowledged durable mutation.

`DurableHubSessionStore` must keep independent healed write tails per session so synchronous SDK calls preserve create, update, and delete order.
Every queued operation is registered directly with the current request scope.
The store must not retain a process-global pending-write set and must not expose `whenIdle()`.
`update()` must be a no-op when the refresh token already equals the stored value because the compatibility fetch wrapper can persist a rotated token before SDK 1.2.0 repeats the same update on a successful response.
The injected clock is called at mutation time and its `Date` is passed to `put()` for deterministic `created_at` and `updated_at` values.
The returned `get()` and consumed login transaction are defensive copies.

## Upstream Failure Compatibility

SDK 1.2.0 deletes a session for every upstream `401` before it examines the body, and it has no bounded request timeout.
`createHubBffFetchCompat()` must bridge those two gaps through the SDK's `fetchImpl` option while leaving SDK route ownership intact.
It must inspect response bodies and rotated cookies only for `/auth/refresh` and `/auth/switch` backchannel calls made inside a matching request scope.
Discovery, OAuth token exchange, JWKS, and logout requests remain SDK-owned pass-through calls, while the compatibility fetch still applies the bounded abort timer and marks a rejection during refresh or switch as retryable.

For a refresh or switch response, clone the response before inspection so the SDK still receives the original body.
Inspect a cloned `2xx` body against the route's published success shape and mark `invalid_response` before returning the untouched original when the shape is unusable.
If the response has a rotated `fxl_hub_session` cookie, parse only that cookie value and call `sessionStore.update(currentSessionId, rotatedToken)` before returning or classifying the response.
This makes rotated credentials durable even when the Hub later reports `403`, `5xx`, or a malformed payload.
The store's equality guard prevents the SDK's later success-path update from creating a duplicate write.

If Hub returns `401` with JSON `code` equal to `invalid`, `expired`, `revoked`, `reuse_detected`, or `no_session`, mark the outcome permanent and return the original response to the SDK.
The SDK then deletes the session, the request scope awaits the durable delete, and response normalization returns `401 { "error": "session_expired" }` with the SDK's cookie deletion preserved.
If the `401` body has an unknown code, no code, malformed JSON, or non-JSON content, mark `invalid_response` and throw a fixed compatibility error before the SDK sees the response.
The SDK catches that fetch error without deleting the store or browser cookie, and normalization returns `502 { "error": "invalid_refresh_response" }` with `Cache-Control: no-store`.

If the underlying fetch rejects, distinguish `AbortError` as timeout and all other failures as network, record a retryable outcome, and rethrow without including the cause.
If Hub returns `408`, `425`, `429`, or any `5xx`, record `hub_unavailable` and return the original response so any rotated cookie can still be processed.
Normalization returns `503 { "error": "refresh_unavailable" }`, preserves the opaque browser cookie, and sets `Cache-Control: no-store`.
If the SDK rejects a `2xx` body as malformed and no stronger outcome exists, normalization returns `502 { "error": "invalid_refresh_response" }` and preserves the cookie.
Do not expose upstream bodies, codes outside the permanent allowlist, session IDs, refresh tokens, ciphertext, keys, abort details, database errors, or stack traces.

An explicit logout remains an intentional local sign-out.
SDK 1.2.0 performs best-effort Hub logout, deletes the product session, clears the cookie, and returns `204` even when the backchannel is unavailable.
The coordinator and request scope must still await the durable local delete before acknowledging that `204`.

## Locked RED Oracle

The first RED must be the end-user-aligned in-process HTTP journey in `apps/api/src/middleware/__tests__/app-auth-bff.test.ts`.
It must use the real published SDK router, real Hono request handling, controlled cookies, fake Hub discovery and OAuth responses, and a controllable persistence adapter.
It must not mock `createHubBff`, duplicate SDK route handlers, or replace the SDK store calls with test-only shortcuts.

Run this exact run-once command after adding all locked tests and before implementation:

```bash
pnpm --filter @fxl-sales/api test -- src/middleware/__tests__/app-auth-bff.test.ts src/middleware/__tests__/app-auth.test.ts src/lib/__tests__/hub-session-request-scope.test.ts src/lib/__tests__/hub-session-store.test.ts src/lib/__tests__/hub-session-request-coordinator.test.ts src/lib/__tests__/hub-bff-compat.test.ts src/lib/__tests__/hub-session-crypto.test.ts src/lib/__tests__/hub-session-persistence.test.ts src/db/__tests__/hub-session-migration-contract.test.ts
```

Expected RED is compilation or module-resolution failure for the new compatibility, request-scope, store, persistence, crypto, and migration modules.
If any new oracle passes before implementation, strengthen it until it proves behavior absent from current master.
After RED is captured, test files are locked and the implementer must not weaken assertions, change expected statuses, delete cases, add skips, or replace the real SDK router.

### HTTP Journey Cases

`apps/api/src/middleware/__tests__/app-auth-bff.test.ts` must lock all of these cases.

1. Complete `/auth/login` and `/auth/callback`, hold the callback-created session `put`, and assert the callback promise exposes neither redirect nor session cookie until that exact `put` resolves.
2. Keep session A's write pending, complete callback B's own write, and assert callback B returns its configured redirect and opaque cookie before A settles.
3. Reject session A's pending write after callback B completes and assert B remains successful, while A alone receives sanitized `503 session_persistence_failed`.
4. Rehydrate a fresh BFF from callback B's persistence and assert `/auth/refresh` sends B's persisted refresh credential to Hub.
5. Start refresh then switch for one cookie, hold refresh first at Hub and then at persistence, and assert switch reaches neither the store read nor Hub until refresh is durable.
6. Release refresh with `rt-after-refresh`, let switch rotate to `rt-after-switch`, and assert Hub receives those credentials in order and a fresh BFF restores only `rt-after-switch`.
7. Repeat with switch first and refresh second, then with two switches, and assert arrival order is the serialization order.
8. Parameterize refresh and switch followed by logout, hold the first operation through persistence, and assert logout reads the latest record only after the first operation settles.
9. Start logout first, hold its durable remove, then start refresh and switch, and assert neither reaches Hub until logout returns `204`, after which both return local `401 no_session`.
10. Hold refresh or switch for session A at Hub and persistence, run the same route for session B, and assert B reaches Hub, persists, and resolves independently.
11. Return a rotated cookie with a switch `403 not_a_member`, a refresh `500`, and a malformed success body, and assert each rotated credential is persisted before the response is visible.
12. Parameterize network rejection, abort timeout, `500`, malformed success JSON, malformed upstream `401`, and unknown upstream `401`, and assert the durable record and opaque browser cookie remain present.
13. Assert network, timeout, and `5xx` normalize to `503 refresh_unavailable`, while malformed responses normalize to `502 invalid_refresh_response`.
14. Parameterize `invalid`, `expired`, `revoked`, `reuse_detected`, and `no_session` upstream `401` codes for refresh and switch, and assert each waits for durable removal, returns `401 session_expired`, and clears the browser cookie.
15. Send a missing or unknown local session cookie and assert the SDK's local `401 no_session` behavior remains intact without calling Hub.
16. Reject callback put, refresh rotation, switch rotation, and logout removal persistence, and assert only the affected request returns sanitized `503 session_persistence_failed` with no success payload or redirect.
17. After each success and failure matrix, assert `coordinator.activeCount()` is zero and no request-scope state leaks into a later request.
18. Capture logs and response bodies and assert they contain none of the session IDs, refresh tokens, encryption key, ciphertext, account ID, database error text, upstream raw body, or serialized records.
19. Delay `loadAll()` and assert `createAppAuthBff()` does not resolve until hydration finishes.
20. With Hub auth unconfigured, assert `createAppAuthBff()` returns `null` without constructing Postgres, a cipher, a coordinator, or a memory store.
21. With production Hub auth configured, assert construction fails closed when the database, migration, or encryption key is unavailable and never falls back to `InMemoryHubSessionStore`.

### Focused Unit Cases

`apps/api/src/lib/__tests__/hub-session-request-scope.test.ts` must prove two concurrent scopes track disjoint promises, callback-created IDs remain scoped to their creator, one scope's rejection cannot reject another, task errors still wait for tracked writes, state is released after settlement, and `track()` outside `run()` fails with fixed text.

`apps/api/src/lib/__tests__/hub-session-store.test.ts` must prove hydration, restart recovery, create/update/delete ordering, defensive copies, 256-bit base64url IDs, equality-deduplicated updates, fixed-clock timestamps, healed per-session write tails, login transaction single use, and the absence of any all-session idle method.

`apps/api/src/lib/__tests__/hub-session-request-coordinator.test.ts` must prove FIFO execution for one key, immediate independent execution for another key, release after success or rejection, reuse after cleanup, `activeCount() === 0`, and secret-free errors and logs.

`apps/api/src/lib/__tests__/hub-bff-compat.test.ts` must prove permanent-code allowlisting, unknown and malformed `401` preservation, timeout abort, retryable `408/425/429/5xx` mapping, rotated-cookie extraction on success and failure responses, no duplicate equal-token update, pass-through for discovery/token/logout URLs, no-store responses, and redaction.

`apps/api/src/lib/__tests__/hub-session-crypto.test.ts` must prove AES-256-GCM round trip, fresh 12-byte IVs, 16-byte authentication tags, opaque-session-ID additional authenticated data, versioned base64url envelopes, tamper rejection, wrong-session rejection, malformed-envelope rejection, and the exact 64-hex key error with `openssl rand -hex 32` guidance.

`apps/api/src/lib/__tests__/hub-session-persistence.test.ts` must mock the existing `getDb()` boundary, call the real Drizzle adapter, prove plaintext never reaches insert or update values, decrypt captured ciphertext with the real cipher, prove `changedAt` drives timestamps, load valid rows, skip only corrupt rows with fixed logging, and delete only by opaque primary key.

`apps/api/src/db/__tests__/hub-session-migration-contract.test.ts` must read generated artifacts from disk and assert the following facts.

1. `0010_durable_bff_sessions.sql` creates exactly one `hub_sessions` table with `id text PRIMARY KEY`, `encrypted_refresh_token text NOT NULL`, nullable `account_id text`, and non-null timezone-aware `created_at` and `updated_at` defaults.
2. The SQL has no plaintext refresh-token value, seed, default, comment, or `hub_refresh_token` column.
3. `0010_snapshot.json` registers `public.hub_sessions` with the same columns, types, nullability, defaults, and primary key.
4. `_journal.json` retains the existing `idx: 9`, `tag: "0009_product_commission_scenarios"` entry unchanged and adds exactly one `idx: 10`, `tag: "0010_durable_bff_sessions"` entry at the current journal version.
5. `0009_product_commission_scenarios.sql` and `0009_snapshot.json` remain byte-for-byte unchanged from the slice baseline.

## Mechanical Implementation Steps

### Task 1: Lock the HTTP and focused RED oracles

**Files:** Create the eight new test files named in the locked command and update the existing `apps/api/src/middleware/__tests__/app-auth.test.ts` factory contract for the awaited `createAppAuthBff()` return value without weakening slice 01's SDK route and verifier assertions.

- [ ] Port reusable fake Hub and controllable persistence helpers from commit `9e9d26603aad1c672c9e1351029e8d6d25f3048b` by reading them with `git show`, not by merging, cherry-picking, switching to, or rebasing onto that branch.
- [ ] Update every migration assertion from parked `0009_durable_bff_sessions` to new generator-owned `0010_durable_bff_sessions` and add explicit preservation assertions for current `0009_product_commission_scenarios`.
- [ ] Replace the parked callback global-barrier test with the callback-B-versus-session-A cases above.
- [ ] Add the upstream failure matrix and request-scope isolation cases before implementation.
- [ ] Preserve every slice 01 SDK route, audience, and verifier assertion while changing its BFF factory calls to await the now-asynchronous construction path.
- [ ] Run the locked oracle command once and record the expected RED output in the execution run.
- [ ] Treat the tests as immutable after RED.

### Task 2: Add the request scope and keyed coordinator

**Files:** Create `apps/api/src/lib/hub-session-request-scope.ts` and `apps/api/src/lib/hub-session-request-coordinator.ts`.

- [ ] Implement the exact interfaces above with `AsyncLocalStorage` and one fresh state per `run()` call.
- [ ] Store tracked writes as `{ sessionId, operation }` entries owned by that state, not in a global set.
- [ ] Await all tracked writes with `Promise.allSettled`, throw only fixed sanitized errors, and clear references after settlement.
- [ ] Implement the coordinator as per-key completion gates released in `finally`, with map deletion only when the completing gate remains the current tail.
- [ ] Run `pnpm --filter @fxl-sales/api test -- src/lib/__tests__/hub-session-request-scope.test.ts src/lib/__tests__/hub-session-request-coordinator.test.ts` and expect all focused cases to pass.

### Task 3: Implement encrypted durable SDK store adaptation

**Files:** Create `apps/api/src/lib/hub-session-crypto.ts`, `apps/api/src/lib/hub-session-store.ts`, and `apps/api/src/lib/hub-session-persistence.ts`.

- [ ] Port the parked cipher only after verifying its AES-256-GCM parameters, envelope canonicalization, authenticated session ID, and fixed error text against the locked tests.
- [ ] Implement the synchronous SDK methods over defensive in-memory records and independent healed per-session write tails.
- [ ] Register every create, update, and delete operation directly with the active request scope.
- [ ] Use the injected clock for each `put()` timestamp and skip equal-token updates.
- [ ] Keep PKCE login transactions process-local, opaque, defensive-copy, and single-use because SDK 1.2.0 exposes only synchronous login transaction methods and the feature acceptance concerns durable product sessions.
- [ ] Implement Drizzle `loadAll`, encrypted `put` with `onConflictDoUpdate`, and primary-key `remove` through the existing `getDb()` boundary.
- [ ] Make corrupt-row logging one fixed string and omit raw error objects and identifiers.
- [ ] Run `pnpm --filter @fxl-sales/api test -- src/lib/__tests__/hub-session-store.test.ts src/lib/__tests__/hub-session-crypto.test.ts src/lib/__tests__/hub-session-persistence.test.ts` and expect all focused cases to pass.

### Task 4: Generate the next migration without rewriting history

**Files:** Modify `apps/api/src/db/schema.ts`; generate `apps/api/drizzle/0010_durable_bff_sessions.sql`, `apps/api/drizzle/meta/0010_snapshot.json`, and the new `_journal.json` entry.

- [ ] Add `hubSessions` as a global infrastructure table with the exact columns locked by the migration test.
- [ ] Capture baseline hashes with `git hash-object apps/api/drizzle/0009_product_commission_scenarios.sql apps/api/drizzle/meta/0009_snapshot.json`.
- [ ] Run `pnpm --filter @fxl-sales/api db:generate -- --name durable_bff_sessions` exactly once.
- [ ] Require the generator to emit prefix `0010`; stop if it proposes another number or rewrites an older migration.
- [ ] Inspect generated SQL and metadata, but never edit `0010_snapshot.json` or `_journal.json` manually.
- [ ] Re-run the baseline hash command and require both `0009` hashes to match.
- [ ] Run `pnpm --filter @fxl-sales/api test -- src/db/__tests__/hub-session-migration-contract.test.ts` and expect it to pass.

### Task 5: Bridge SDK 1.2.0 upstream outcomes

**Files:** Create `apps/api/src/lib/hub-bff-compat.ts`.

- [ ] Implement `createHubBffFetchCompat()` with the permanent allowlist, bounded abort timer, response clone inspection, retryable mapping, and rotated-cookie persistence rules above.
- [ ] Use fixed typed compatibility errors without causes or secret-bearing fields.
- [ ] Implement `normalizeHubBffResponse()` to return fresh sanitized JSON for retryable or invalid outcomes, preserve only the SDK's intended permanent cookie deletion, and set `Cache-Control: no-store`.
- [ ] Never synthesize OAuth, authorize, callback, discovery, JWKS, refresh, switch, or logout requests outside the SDK's own calls.
- [ ] Run `pnpm --filter @fxl-sales/api test -- src/lib/__tests__/hub-bff-compat.test.ts` and expect all cases to pass.

### Task 6: Wire the durable runtime around the real SDK router

**Files:** Modify `apps/api/src/middleware/app-auth.ts`, `apps/api/src/middleware/__tests__/app-auth-bff.test.ts`, `apps/api/src/env.ts`, and `apps/api/src/server.ts`.

- [ ] Make `createAppAuthBff()` async and add test-only dependency options for `persistence`, `fetchImpl`, `clock`, `timeoutMs`, `requestScope`, and `coordinator`.
- [ ] Return `null` before constructing dependencies when Hub auth is not configured.
- [ ] On the runtime path, construct only `createDrizzleHubSessionPersistence(env.FXL_HUB_SESSION_ENCRYPTION_KEY)`, `HubSessionRequestScope`, `DurableHubSessionStore`, and `HubSessionRequestCoordinator`.
- [ ] Await `sessionStore.hydrate()` before calling `createHubBff()` and before the server listens.
- [ ] Pass the exact durable store and compatible fetch into `createHubBff()` with the redirect options owned by slice 01.
- [ ] Register outer `/auth/*` middleware before mounting the SDK router.
- [ ] For refresh, switch, or logout with a cookie, run `coordinator.run(sessionId, () => requestScope.run(...))` around `await next()`, normalization, and the persistence barrier.
- [ ] For callback, run only its fresh request scope and let `store.create()` register the generated ID and write.
- [ ] Do not coordinate login, callback, or a cookie-less request under a shared sentinel key.
- [ ] On `HubSessionPersistenceError`, emit one fixed warning, replace the response with `503 session_persistence_failed`, remove redirect and success headers, and expire only the configured Hub session cookie.
- [ ] Make `server.ts` await `createAppAuthBff()` before mounting and before `serve()`.
- [ ] Validate optional `FXL_HUB_SESSION_ENCRYPTION_KEY` as exactly 64 hexadecimal characters, then fail BFF construction when Hub auth is configured and the key is absent.
- [ ] Run the full locked oracle command and expect Green.

### Task 7: Document the production contract and verify the slice

**Files:** Modify `apps/api/.env.dev.example`, `apps/api/.env.example`, and `CLAUDE.md`.

- [ ] Add only an empty `FXL_HUB_SESSION_ENCRYPTION_KEY=` placeholder and `openssl rand -hex 32` generation guidance.
- [ ] Document that the key must remain stable across restarts and live only in Infisical or an untracked local override.
- [ ] Document that BFF refresh credentials are encrypted in Postgres, browser cookies contain only opaque IDs, production has no in-memory fallback, and startup fails closed before listening when hydration cannot complete.
- [ ] Run the exact commands below in run-once mode and stop all processes before handoff.

```bash
pnpm --filter @fxl-sales/api test -- src/middleware/__tests__/app-auth-bff.test.ts src/middleware/__tests__/app-auth.test.ts src/lib/__tests__/hub-session-request-scope.test.ts src/lib/__tests__/hub-session-store.test.ts src/lib/__tests__/hub-session-request-coordinator.test.ts src/lib/__tests__/hub-bff-compat.test.ts src/lib/__tests__/hub-session-crypto.test.ts src/lib/__tests__/hub-session-persistence.test.ts src/db/__tests__/hub-session-migration-contract.test.ts
pnpm --filter @fxl-sales/api lint
pnpm --filter @fxl-sales/api type-check
pnpm --filter @fxl-sales/api build
git diff --check
```

The separate slice Verify agent must run the same locked oracle, lint, type-check, build, migration-history checks, secret scan, and `git diff --check`.
At the wave boundary, the separate wave Verify agent must also run `CI=true pnpm test`, `pnpm run lint`, `pnpm run type-check`, `pnpm run build`, and `pnpm audit --prod --audit-level=high` from the repository root.
The feature-boundary verifier must mutate the request scope to await all process writes and prove the callback-B-versus-session-A oracle fails, then restore the clean tree.

## Migration and Data Rules

`hub_sessions` is global BFF infrastructure keyed by the opaque product session ID.
It has no `org_id`, tenant RLS policy, or workspace foreign key because one Hub account session may switch active workspaces.
It stores no browser access token and no plaintext Hub refresh credential.
The only sensitive column is an AES-256-GCM envelope authenticated with the row's opaque ID.

Current migration `0009_product_commission_scenarios` is product history and must remain unchanged.
The durable-session migration is the next generated migration, `0010_durable_bff_sessions`.
Drizzle owns `0010_snapshot.json` and `_journal.json`; neither may be hand-edited, copied from commit `9e9d266`, or renumbered.
Do not delete, overwrite, or repurpose any existing migration or snapshot.
This slice generates the migration locally but does not apply it to staging or production.

## Security and Failure Behavior

`FXL_HUB_SESSION_ENCRYPTION_KEY` is a dedicated 32-byte key encoded as exactly 64 hexadecimal characters.
Do not derive it from `FXL_HUB_SECRET_KEY`, commit a real value, send it to the browser, or log it.
Key rotation and bulk re-encryption are outside this slice.

Database unavailability, missing migration, invalid key, or initial `loadAll()` failure aborts startup before the listener opens.
A corrupt encrypted row is skipped in isolation with fixed logging, while valid rows hydrate.
A post-start persistence failure fails only that auth request closed with sanitized `503 session_persistence_failed`, clears its opaque browser cookie, releases the coordinator slot, and leaves unrelated sessions runnable.
Per-session write tails heal after an observed failure so a later request is not permanently poisoned.

Network failure, timeout, `408`, `425`, `429`, `5xx`, malformed success, malformed `401`, and unknown `401` preserve both the durable session and opaque browser cookie.
Only local `no_session` and allowlisted upstream `invalid`, `expired`, `revoked`, `reuse_detected`, or `no_session` become unauthenticated.
Explicit logout always clears locally after its durable delete because it is a user-requested sign-out, not a recoverable refresh attempt.
All auth protocol responses are `Cache-Control: no-store` and contain no credentials or internal identifiers.

## Scope Limits

- Do not modify, patch, vendor, or replace `@fxl-business/hub-sdk` 1.2.0.
- Do not hand-roll OAuth, PKCE, discovery, JWKS, bearer verification, callback, refresh, switch, or logout routes.
- Do not merge or cherry-pick `fix/durable-bff-session-store`; use `git show 9e9d266:<path>` only as a reference.
- Do not persist browser access tokens, authorization codes, PKCE verifiers, or login transaction cookies in `hub_sessions`.
- Do not add Redis, multi-replica locks, pub-sub invalidation, sticky-session changes, or cross-instance live coherence.
- Do not add session cleanup jobs, encryption-key rotation, or bulk re-encryption.
- Do not modify browser resume, workspace selector, protected-request retry, or operator endpoint behavior owned by slices 01 and 02.
- Do not apply a migration to staging or production, rotate secrets, cut a release, or promote deployment branches.
- Preserve unrelated `.vscode/` content, `nexo/knowledge/doubts/20260707-missing-entitlement.md`, and all current user changes.
