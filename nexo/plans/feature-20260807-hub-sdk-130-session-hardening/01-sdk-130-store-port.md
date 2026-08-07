---
id: 01-sdk-130-store-port
milestone: v2.6.0
status: todo
depends_on: []
files_modified: [pnpm-lock.yaml, apps/api/package.json, apps/web/package.json, apps/api/src/auth/hub-session-store.ts, apps/api/src/auth/hub-bff-errors.ts, apps/api/src/auth/hub-session-scope.ts, apps/api/src/middleware/app-auth.ts, apps/api/src/auth/__tests__/hub-session-store.test.ts, apps/api/src/auth/__tests__/hub-bff-errors.test.ts, apps/api/src/auth/__tests__/hub-session-scope.test.ts, apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts, apps/api/test/rls/hub-bff-session-store.test.ts, CLAUDE.md, nexo/ROADMAP.md]
acceptance: With `@fxl-business/hub-sdk` at 1.3.0 and `apps/api/src/auth/hub-session-scope.ts` deleted, the named oracles prove that two concurrent refreshes on one session id serialize behind a `SELECT ... FOR UPDATE` taken inside `withSession`, that a commit failure surfaces as a 503 with the session cookie intact instead of as a swallowed success, that a PKCE verifier is consumed exactly once, and that the durable store instance still reaches `createHubBff` with a bounded `timeoutMs`.
---

# 01 - SDK 1.3.0 bump and session-store port

## Context

`@fxl-business/hub-sdk@1.3.0` replaces the synchronous, id-keyed `HubSessionStore` (`get` / `update` / `delete`) with an async, transactional one (`create` / `withSession` / `createLoginTransaction` / `consumeLoginTransaction`).
Our store exists only because 1.2.0's interface was synchronous: `apps/api/src/auth/hub-session-scope.ts` hydrates a request-scoped working set before the BFF handler and flushes it afterwards, purely to give the synchronous methods somewhere to do I/O.
1.3.0 gives the store a place to hold a lock across the whole read-modify-write, so the bridge has no reason to exist and the flush phase - the one that swallows a commit failure and returns the handler's value as success - disappears with it.

This slice is atomic and cannot be split: `createHubBff` throws at construction time for a 1.x-shaped store (`assertModernSessionStore`, 1.3.0 `dist/server.js:304-310`), so the codebase does not boot or type-check between the bump, the port and the unmount.

### Verified facts this plan is built on

All read out of the staged 1.3.0 tarball, not inferred.

- **Cookie names are unchanged.** 1.3.0 `dist/server.js:275-277` declares `SESSION_COOKIE = "fxl_hub_session"`, `SESSION_COOKIE_SECURE = "__Host-fxl_hub_session"`, `LOGIN_TX_COOKIE = "fxl_hub_login"`.
  The pin in `hub-session-scope.ts:16` pointed at 1.2.0 `dist/server.js:271-273`; the same three constants now sit at `275-277`, byte-identical.
- **The SDK never catches a store throw.** `/auth/refresh` (`server.js:422`), `/auth/switch` (`481`), `/auth/logout` (`535`, `552`), `/auth/callback` (`371`, `408`) and `/auth/login` (`348`) all `await` the store with no `try`.
  A store rejection therefore propagates out of the Hono handler; it is **not** collapsed into a `401`, and `result.clear` never runs, so the SDK cannot delete the session cookie on a store failure.
  That closes the "database blip logs everyone out" failure mode at the SDK layer, but it lands as Hono's default `500 Internal Server Error`, not a `503`.
- **An upstream Hono middleware CANNOT catch a downstream throw.** `hono@4.12.25 dist/compose.js` wraps every dispatch level in its own `try`/`catch` and, because an `onError` always exists (Hono installs a default), the innermost level swallows the error into `onError`'s response and **resolves** normally.
  A `try { await next() } catch` in a middleware mounted above the BFF would never fire.
  This is the mechanism that must be designed around, and it is why the 503 moves to an `onError` handler - see [The 503](#the-503-constraint-2).
  `compose.js` and `hono-base.js` are byte-identical between `hono@4.12.25` and `hono@4.12.28`, verified by diff.
- **`hub-sdk@1.3.0` declares `peerDependencies: { hono: ">=4.12.28" }`**, up from `>=4.11.4` in 1.2.0, and `apps/api` pins `hono` to an exact `4.12.25`.
  `.npmrc` sets `strict-peer-dependencies=false` and `auto-install-peers=true`, so the install would not fail - it would quietly resolve a *second* copy of Hono for the SDK, and the BFF's `Hono`/`Context`/`compose` would no longer be the ones `server.ts` composes with.
  `apps/api`'s `hono` pin must move to `4.12.28` in this slice.
- **`apps/web` needs no code change.** It imports only `@fxl-business/hub-sdk/client`, and `dist/client.d.ts` is byte-identical between 1.2.0 and 1.3.0 while `dist/client.js` differs only in the internal chunk filename.
  `getToken(): Promise<string | null>` is unchanged; the `401`/`503`/`502` classification is not exposed there, which is why slice 03 calls `/auth/refresh` directly.
  The web bump is **purely version alignment**, so the workspace resolves one SDK copy rather than two.
- **The SDK hands `tx.update` the record it got from `tx.get`**, spread with only `hubRefreshToken` replaced (`server.js:464`, `519`).
  It does not slide `expiresAt`.
  Our 1.2.0 `update()` rewrote `expiresAt` to `now + 30 days` on every rotation, so the sliding TTL must be re-implemented inside our `update`, or it silently becomes a hard 30-day cap.
- **`InMemoryHubSessionStore` in 1.3.0** has an async `create` and retains a synchronous `get(id)` for tests only.
  The integration suite's non-vacuity control uses it and must be adapted to `await memA.create(...)`.

## Scope

1. Bump `@fxl-business/hub-sdk` to `^1.3.0` in `apps/api` and `apps/web`, and `hono` to `4.12.28` in `apps/api`.
2. Port `apps/api/src/auth/hub-session-store.ts` to the 1.3.0 contract.
3. Delete `apps/api/src/auth/hub-session-scope.ts` and its test.
4. Add `apps/api/src/auth/hub-bff-errors.ts`, mounted as the BFF router's `onError`, which is where the `503` now comes from.
5. Set `timeoutMs` on `createHubBff`.
6. Update every affected test and the two `CLAUDE.md` statements the port invalidates.

Explicitly **not** in this slice: `absoluteExpiresAt`, the column that carries it, and any migration.
That is slice 02, and nothing here needs to be touched to make it possible - `withSession`'s expiry branch is written as one predicate over the row so slice 02 adds a second timestamp to it and a second column to the `set`, with no restructuring.

## The exact new shape of `hub-session-store.ts`

### Header comment

The existing 25-line header describes hydrate-around-the-handler and is now false in every sentence.
Replace it with a description of the transactional shape: one `db.transaction` per `withSession`, the row lock taken before the operation runs, the sealer and `getAdminDb()` posture unchanged, and the operational consequence of rotating `FXL_HUB_SECRET_KEY`.

### What is deleted

- `AsyncLocalStorage` and the `#als` field.
- `HubSessionScopeError`, `HubSessionHydrateInput`, `RequestPhase`, `SessionOp`, `UnitOfWork`, `#scope()`, `#hydrate()`, `#flush()`, `withRequest()`.
- The `DurableHubSessionStore` interface. It added exactly one member (`withRequest`) and now adds none; an empty extension is noise, so `createDurableHubSessionStore` returns `HubSessionStore` and `createHubSessionStore` returns `{ kind: 'durable' | 'memory'; store: HubSessionStore }`.
  `kind` stays: it is what the wiring test asserts to prove the durable path was taken, and it drives the `console.warn` on the memory fallback.
- The `and` and `gt` imports (`lte` stays, for the purge).

### What is unchanged

`SESSION_TTL_MS` (30 days, sliding), `LOGIN_TX_TTL_MS` (10 minutes), `newId()` (256 bits, base64url), `HubSessionStoreUnavailableError`, `createSessionSealer` and its AES-256-GCM / HKDF-SHA256 / row-id-as-AAD contract, `getAdminDb()` as the only connection, `createHubSessionStore`'s production guard, and `deleteExpiredHubBffSessions`.

### Method signatures

```ts
class PostgresHubSessionStore implements HubSessionStore {
  create(data: HubSessionRecord): Promise<string>;
  withSession<T>(sessionId: string, operation: (tx: HubSessionTransaction) => Promise<T>): Promise<T>;
  createLoginTransaction(tx: HubLoginTransaction): Promise<string>;
  consumeLoginTransaction(id: string): Promise<HubLoginTransaction | null>;
}
```

### One private helper

```ts
#unavailable(message: string, cause: unknown): HubSessionStoreUnavailableError {
  if (cause instanceof HubSessionStoreUnavailableError) return cause;
  console.error(`[hub-session-store] ${message}`, cause);
  return new HubSessionStoreUnavailableError(message, { cause });
}
```

### `create(data)`

One `INSERT`, no enclosing transaction (it runs at `/auth/callback`, before any session id exists).

- `id = newId()`.
- `expiresAt = new Date(this.#now().getTime() + SESSION_TTL_MS)`.
  `data.expiresAt` and `data.absoluteExpiresAt` from the SDK are deliberately **ignored**: this store owns the columns, the nightly sweeper and the sliding rule, and the SDK's create-time value cannot express sliding.
  A comment must say so, because "the SDK gave us a value and we dropped it" is otherwise indistinguishable from a bug.
- `hubRefreshTokenEnc = this.#sealer.seal(data.hubRefreshToken, id)`.
- `accountId = data.accountId ?? null`.
- Any throw becomes `this.#unavailable('hub session create failed', err)`.
- Returns `id`.

### `withSession(sessionId, operation)` - where the lock is taken

```ts
async withSession<T>(sessionId, operation) {
  try {
    return await this.#db.transaction(async (tx) => {
      // The lock is taken FIRST, before `operation` runs, and is held until this
      // transaction commits. That is the whole point of the 1.3.0 contract.
      const rows = await tx
        .select()
        .from(hubBffSessions)
        .where(eq(hubBffSessions.id, sessionId))
        .for('update')
        .limit(1);

      const now = this.#now().getTime();
      let row = rows[0] ?? null;

      // Expired: delete inside this transaction and report absent, per MIGRATION.md.
      // Slice 02 adds `|| absoluteExpiresAt <= now` to this one predicate.
      if (row && row.expiresAt.getTime() <= now) {
        await tx.delete(hubBffSessions).where(eq(hubBffSessions.id, sessionId));
        row = null;
      }

      // A seal that will not open reads as an unknown session and the row is LEFT
      // IN PLACE - see "seal-open failure" below.
      const token = row ? this.#sealer.open(row.hubRefreshTokenEnc, row.id) : null;
      const live = token === null ? null : row;

      const handle: HubSessionTransaction = {
        get: async () =>
          live && token !== null
            ? {
                hubRefreshToken: token,
                ...(live.accountId ? { accountId: live.accountId } : {}),
                expiresAt: live.expiresAt.toISOString(),
              }
            : null,
        update: async (record) => {
          await tx
            .update(hubBffSessions)
            .set({
              hubRefreshTokenEnc: this.#sealer.seal(record.hubRefreshToken, sessionId),
              accountId: record.accountId ?? null,
              // SLIDING, deliberately ignoring record.expiresAt: the SDK spreads back
              // the value it got from get(), so honouring it would freeze the TTL at
              // 30 days from login and silently pre-empt slice 02's absolute cap.
              expiresAt: new Date(this.#now().getTime() + SESSION_TTL_MS),
              updatedAt: new Date(),
            })
            .where(eq(hubBffSessions.id, sessionId));
        },
        delete: async () => {
          await tx.delete(hubBffSessions).where(eq(hubBffSessions.id, sessionId));
        },
      };

      return await operation(handle);
    });
  } catch (err) {
    throw this.#unavailable('hub session transaction failed', err);
  }
}
```

Behaviour, stated exhaustively:

- **On a miss** (`rows` empty): `tx.get()` resolves `null`.
  No lock is held, because `FOR UPDATE` on a row that does not exist locks nothing; there is no lost update to prevent when there is nothing to lose.
  The SDK answers `401 no_session` and clears the cookie, which is correct - the id is genuinely unknown.
- **On an expired row**: deleted inside the transaction, `tx.get()` resolves `null`.
  This changes an existing assertion: the 1.2.0 integration test pinned "expiry is enforced on READ - the rows are still sitting in the table", and that is now false by design (`MIGRATION.md`, "Sessions now expire").
- **On a seal-open failure**: `tx.get()` resolves `null` and **the row is left in place**.
  This is a deliberate divergence from the bundled `SqlHubSessionStore`, which throws.
  `session-crypto.ts` documents the product decision: a key rotation must cost every user one re-login, not a wall of 503s, and deleting rows as a side effect of presenting the wrong key would destroy data on a misconfigured deploy.
- **On any throw** - the lock read, a handle method, the operation itself, or the commit - the whole transaction rolls back and `withSession` rejects with `HubSessionStoreUnavailableError`.
  There is exactly **one** rule and no phase tracking.
  This is what structurally closes the flush hole: the operation's return value is never captured outside the transaction, so there is no variable a `catch` could return in place of a failure.
- `update` on a session id whose row is absent matches zero rows and is a silent no-op, which reproduces the interface's documented "no-op if unknown".
  It is unreachable through the SDK, which only calls `update` after a non-null `get`.

### `createLoginTransaction(tx)`

One `INSERT`, no enclosing transaction.

- `id = newId()`, `codeVerifierEnc = this.#sealer.seal(tx.codeVerifier, id)`, `state = tx.state`.
- `expiresAt`: honour `tx.expiresAt` when it is a string that `Date.parse` resolves to a finite number, otherwise `now + LOGIN_TX_TTL_MS`.
  1.3.0 supplies it (`server.js:348`, `now() + 6e5`), so the fallback is only for a caller that omits it, and `LOGIN_TX_TTL_MS` stays as that fallback and as the documented match to `LOGIN_TX_MAX_AGE_SECONDS` (`server.js:279`).
- Any throw becomes `this.#unavailable('hub login transaction create failed', err)`.

### `consumeLoginTransaction(id)` - constraint 4

Single-use at the DATABASE level, mapped straight onto one statement:

```ts
const rows = await this.#db
  .delete(hubBffLoginTxns)
  .where(eq(hubBffLoginTxns.id, id))
  .returning();
```

- One `DELETE ... RETURNING`, atomic on its own, no `WHERE` on `expires_at`.
  Only one replica's statement can return the row, so a replayed `/auth/callback` cannot retry the verifier even across replicas.
- The expiry check moves **after** the delete: if `row.expiresAt <= now`, return `null` - the row is gone either way.
  This is stricter than 1.2.0, which left an expired row for the sweeper, and it matches the SDK's own DDL comment: "the store deletes the row on consume, expired or not, so a replayed callback cannot retry a stale verifier".
- A seal that will not open returns `null`.
- Returns `{ codeVerifier, state, expiresAt: row.expiresAt.toISOString() }` on success.
- Any throw becomes `this.#unavailable('hub login transaction consume failed', err)`.

## The 503 (constraint 2)

### What 1.3.0 actually does when the store throws

`dist/server.js:422` is `const result = await store.withSession(sessionId, async (tx) => { ... });` with no `try` around it, and the same shape appears at `481`, `535`, `552`, `371`, `408` and `348`.
The SDK does **not** swallow a store throw into a `401`.
`if (result.clear) deleteCookie(...)` at line `467` is never reached, so the session cookie survives.

So the good half is free: a database outage can no longer be mistaken for "no session".
The missing half is the status code - an uncaught throw lands on Hono's default error handler and becomes `500 Internal Server Error` as plain text.

### Why a middleware cannot do it

`hono@4.12.25 dist/compose.js` puts a `try`/`catch` around `handler(context, next)` at **every** dispatch level, and the `catch` fires `onError` whenever one exists.
Hono always installs a default `onError`.
So when the BFF handler at level *i* throws, level *i* catches it, produces the error response, sets `context.res`, and **returns normally**; the `await next()` inside a middleware at level *i-1* resolves.
A `try { await next() } catch` above the BFF is dead code.

This is not a theoretical distinction: it is exactly why the deleted `hub-session-scope.ts` worked - the throw it caught came from `store.withRequest`, which the middleware called *itself*, not from downstream.

### The mechanism

A Hono `onError` on the router that wraps the BFF.

`apps/api/src/auth/hub-bff-errors.ts` (new):

```ts
import type { ErrorHandler } from 'hono';
import { HubSessionStoreUnavailableError } from './hub-session-store.js';

/**
 * The BFF router's error handler, and the only place the session-store 503 comes
 * from now that the hydrate/flush middleware is gone.
 *
 * It has to be an onError and not a middleware: hono's compose catches a thrown
 * error at the dispatch level that threw and resolves upward, so an upstream
 * middleware's try/catch around next() never fires.
 *
 * The 503 is load-bearing. A store outage must not read as "no session": the SDK
 * would answer 401 and delete the session cookie, and a two-second database blip
 * would permanently log out every user. The SDK already declines to do that - it
 * never catches a store throw - but without this handler the honest failure is a
 * bare 500.
 *
 * Every other error reproduces hono's default handler byte for byte, so mounting
 * this changes nothing outside the store-outage branch.
 */
export const hubBffErrorHandler: ErrorHandler = (err, c) => {
  if (err instanceof HubSessionStoreUnavailableError) {
    console.error('[hub-bff] session store unavailable', err);
    return c.json({ error: 'unavailable', code: 'session_store_unavailable' }, 503);
  }
  if ('getResponse' in err) {
    const res = (err as { getResponse(): Response }).getResponse();
    return c.newResponse(res.body, res);
  }
  console.error(err);
  return c.text('Internal Server Error', 500);
};
```

Duck-typing `getResponse` rather than importing `HTTPException` is deliberate: it is what `hono-base.js`'s default handler does, so the non-store branches are provably identical to what runs today.
Re-throwing instead was rejected - `compose.js` calls `await onError(...)` *inside* its `catch`, un-guarded, so a re-throw behaves differently depending on whether the router is requested directly or mounted, and this handler must behave the same either way.

### Why mounting it on the router survives `app.route`

`hono-base.js`'s `route(path, app)` flattens the sub-app's routes into the parent and, when the sub-app carries a non-default `errorHandler`, wraps each handler in `compose([], app.errorHandler)`.
So `router.onError(hubBffErrorHandler)` followed by `app.route('', router)` in `server.ts` keeps our handler in front of the BFF's routes.
Conversely, `bff.errorHandler` is the default when `router.route('', bff)` runs, so the BFF's handlers go in unwrapped and are covered by ours.

**This is the false-positive trap for the test.** A test that requests the router directly passes even if the flattening dropped the handler, because a directly-requested router composes with its own `errorHandler`.
The oracle must go through `const app = new Hono(); app.route('', authBff); await app.request(...)`, reproducing `server.ts:33`.
Both shapes are asserted below so neither can regress alone.

## Every file to change

### `apps/api/package.json`

- `"@fxl-business/hub-sdk": "^1.2.0"` becomes `"^1.3.0"`.
- `"hono": "4.12.25"` becomes `"4.12.28"`, to satisfy the SDK's `>=4.12.28` peer range.
  Keep the exact pin (no caret) - that is the existing convention here.

### `apps/web/package.json`

- `"@fxl-business/hub-sdk": "^1.2.0"` becomes `"^1.3.0"`. No other change, and no `apps/web/src` change at all.

### `pnpm-lock.yaml`

Regenerated by `pnpm install`. Do not hand-edit.

### `apps/api/src/auth/hub-session-store.ts`

Rewritten as specified above.

### `apps/api/src/auth/hub-bff-errors.ts`

New, content as specified above.

### `apps/api/src/auth/hub-session-scope.ts`

**DELETED.**
Nothing in `apps/api/src` reads `SESSION_COOKIE`, `SESSION_COOKIE_SECURE`, `LOGIN_TX_COOKIE` or `hubSessionCookieName` afterwards - the SDK reads its own cookies.
The constants are not relocated; see [constraint 6](#the-cookie-name-pin-constraint-6).

### `apps/api/src/middleware/app-auth.ts`

Inside `createAppAuthBff()`:

- Drop the `createHubSessionScopeMiddleware` import.
- Add `import { hubBffErrorHandler } from '../auth/hub-bff-errors.js';`.
- Add above `createHubBff`:

```ts
/**
 * Bounds the Hub round-trip the BFF makes from INSIDE the transaction that holds
 * a session's row lock. 1.2.0 had no timeout at all, so a hung Hub pinned a
 * pooled connection with an open transaction indefinitely. 5s rather than the
 * SDK's 10s default: the Hub is same-region, a healthy refresh is tens of
 * milliseconds, and getAdminDb()'s pool is `max: 5` and is shared with the audit,
 * history and nightly-job paths - so the worst-case connection hold is the number
 * that matters, not the average latency. See nexo/ROADMAP.md for the pool sizing.
 */
const HUB_BFF_TIMEOUT_MS = 5_000;
```

- Pass `timeoutMs: HUB_BFF_TIMEOUT_MS` to `createHubBff`.
- Do **not** pass `sessionTtlSeconds` or `sessionAbsoluteTtlSeconds`: the store ignores the record fields they produce, and passing them would imply they are load-bearing.
- Replace the tail:

```ts
  // The error handler is mounted INSIDE the returned router, so server.ts stays
  // `app.route('', authBff)` and it cannot be forgotten. It must be an onError
  // rather than a middleware - see hub-bff-errors.ts.
  const router = new Hono();
  router.onError(hubBffErrorHandler);
  router.route('', bff);
  return router;
```

The `if (session.kind === 'memory') return bff;` early return goes away.
The in-memory store never throws `HubSessionStoreUnavailableError`, so mounting the handler unconditionally is inert for it and removes a branch.

### `CLAUDE.md`

Two statements in **Auth Model** become false and must be rewritten in this slice.

Replace the paragraph beginning "`HubSessionStore` is a SYNCHRONOUS interface, so the store hydrates around the handler..." in full with:

> `HubSessionStore` is ASYNC and TRANSACTIONAL as of `@fxl-business/hub-sdk@1.3.0`, and the store owns the lock.
> `withSession(id, op)` opens ONE `db.transaction`, takes `SELECT ... FOR UPDATE` on the session row BEFORE `op` runs, and holds it until commit, so two concurrent refreshes of one session id serialize at Postgres and a rotated refresh token cannot be lost.
> There is no hydrate phase, no flush phase and no `AsyncLocalStorage` working set; `apps/api/src/auth/hub-session-scope.ts` is deleted and must not come back.
> Because the operation's return value is never captured outside the transaction, a commit failure cannot be returned as success - which was the pre-1.3.0 hole where the Hub had rotated `RT1` to `RT2` while Postgres still held `RT1`.
> A row past `expires_at` is deleted inside the same transaction and reported absent; a seal that will not open reports absent and LEAVES the row, because a wrong key must cost one re-login rather than destroy data.
> `update` re-slides `expires_at` to `now + SESSION_TTL_MS` and deliberately ignores the `expiresAt` the SDK spreads back from `get`, which would otherwise freeze the TTL at 30 days from login.
> Any throw inside `withSession` - lock read, handle method, operation or commit - becomes `HubSessionStoreUnavailableError`.
> That is answered `503` by `hubBffErrorHandler`, the BFF router's `onError`, NOT by a middleware: hono's `compose` catches a throw at the dispatch level that threw and resolves upward, so a `try { await next() } catch` mounted above the BFF is dead code.
> The `503` is load-bearing for the same reason it always was - a store outage read as "no session" makes the SDK answer `401` and delete the session cookie, logging every user out over a brief database blip.
> `createHubBff` is given `timeoutMs: 5_000`, because the BFF calls the Hub over HTTP from inside the row-lock transaction and an unbounded call pins a `getAdminDb()` connection (`max: 5`, shared with the audit and history paths) with an open transaction.

Then replace the sentence in the preceding paragraph that reads "Omitting `sessionStore` makes `createHubBff` fall back to the SDK's `InMemoryHubSessionStore`..." with the 1.3.0 truth: 1.3.0 **throws at construction** when `sessionStore` is absent and `NODE_ENV === 'production'`, and throws at construction for a store that does not implement `withSession`; `app-auth-bff-wiring.test.ts` still asserts the exact store instance reaches `createHubBff`, and still asserts the failure earlier than a boot would.

### `nexo/ROADMAP.md`

Add one backlog bullet:

> - chore: `getAdminDb()`'s pool is `max: 5` and is now the pool the Hub BFF holds across a bounded (5s) Hub round-trip inside a row-lock transaction, alongside the audit router, the history service and the nightly job. A degraded Hub therefore caps that pool at roughly one refresh per second and stalls those other paths, not just auth. Size the pool for peak concurrent REFRESHES, or give the session store its own pool, and set `idle_in_transaction_session_timeout` on the role so a wedged transaction cannot block VACUUM. Not changed in `feature-20260807-hub-sdk-130-session-hardening` slice 01, which only made the hold bounded.

## RED tests - the locked oracle

Write these FIRST. Each must fail before the change and pass after.

### 1. `apps/api/src/auth/__tests__/hub-session-store.test.ts` (rewritten)

Keep `describe('createHubSessionStore')` unchanged (memory fallback outside production; throws in production without `DATABASE_URL`).
Keep `describe('TTLs')`, updating the `LOGIN_TX_TTL_MS` comment to cite 1.3.0 `dist/server.js:279`.
**Delete** `describe('request scope guard')`, both "logs and swallows" tests, and `describe('cookie names')`.

Add `describe('withSession failure semantics')`, driven by a hand-rolled fake `db` (no database needed):

- `it('rejects with HubSessionStoreUnavailableError when the commit fails, and never resolves the operation value')`
  Fake `transaction: async (fn) => { await fn(fakeTx); throw commitError; }`.
  Assert the promise **rejects** with `{ name: 'HubSessionStoreUnavailableError', cause: commitError }`, and assert it does not resolve to the operation's sentinel value.
  **This is the constraint-3 oracle.** It is red against the deleted `withRequest`, and it is the test that goes red again if anyone reintroduces a `return handlerResult.value` in a `catch`.
- `it('rejects with HubSessionStoreUnavailableError when the row lock cannot be taken, and never runs the operation')`
  Fake `transaction` rejects immediately; assert the operation spy was never called.
- `it('rejects with HubSessionStoreUnavailableError when the operation itself throws')`
  Pins the deliberate one-rule decision, so a later "let handler errors through" refactor is a conscious change and not a silent one.

### 2. `apps/api/src/auth/__tests__/hub-bff-errors.test.ts` (new, replaces `hub-session-scope.test.ts`)

Build a stand-in sub-app whose `/auth/refresh` handler throws, and whose alternate branch reproduces the SDK's cookie-deleting `401` so a degrade is visible as a `Set-Cookie` rather than as a passing test - the same construction the deleted `hub-session-scope.test.ts` used.

- `it('answers 503 with the session cookie intact when the store is unavailable, through the double route() mount server.ts uses')`
  `router.onError(hubBffErrorHandler); router.route('', sub);` then `const app = new Hono(); app.route('', router);` and request through `app`.
  Assert `503`, body `{ error: 'unavailable', code: 'session_store_unavailable' }`, and `res.headers.get('set-cookie') === null`.
  **This is the constraint-2 oracle**, and the double mount is what makes it non-vacuous.
- `it('answers 503 when the router is requested directly as well')`
  Same router, requested without the outer `app.route`. Both mount shapes must agree.
- `it('leaves any other error as a plain 500 and never claims session_store_unavailable')`
  Throw a bare `Error`; assert `500` and that the body is not our JSON.

### 3. `apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts` (updated)

Keep the three existing assertions: the blank-`HUB_SESSION_ENCRYPTION_KEY` boot, `sessionStoreKind === 'durable'`, and the store-instance identity reaching `createHubBff`.
Change `DurableHubSessionStore` imports to `HubSessionStore` and drop `HubSessionHydrateInput`.

- **Replace** `it('mounts the session-scope middleware on /auth/*')` with
  `it('routes the fxl_hub_session cookie into withSession on /auth/refresh')`
  Spy on the durable store's `withSession`, request `/auth/refresh` with `cookie: 'fxl_hub_session=session-alpha; fxl_hub_login=login-alpha'`, assert it was called with `'session-alpha'`.
- `it('routes the fxl_hub_login cookie into consumeLoginTransaction on /auth/callback')`
  Spy on `consumeLoginTransaction`, request `/auth/callback?state=x`, assert it was called with `'login-alpha'`.
- `it('reads the __Host- session cookie when secureCookies is on')`
  Build a local `createHubBff(hubSdkConfig, { sessionStore: probe, secureCookies: true, fetchImpl })` with a probe store implementing the 1.3.0 interface, send both `__Host-fxl_hub_session=right` and `fxl_hub_session=wrong`, assert `withSession` saw `'right'`.
- `it('bounds the upstream Hub call with timeoutMs')` - `expect(bffOptions?.timeoutMs).toBe(5_000)`.
- `it('answers 503 rather than a cookie-clearing 401 when withSession rejects, through app.route(\'\', authBff)')`
  Mock `withSession` to reject with `HubSessionStoreUnavailableError`, mount the real `createAppAuthBff()` result via `const app = new Hono(); app.route('', authBff);`, request `/auth/refresh` with a session cookie, assert `503` and `set-cookie === null`.
  This is the end-to-end constraint-2 proof against the **real** SDK, and it is the one that would catch a regression the isolated `hub-bff-errors` test cannot.

### The cookie-name pin (constraint 6)

The pin does **not** become a string constant somewhere else - it becomes the four behavioural assertions above.
Comparing `SESSION_COOKIE === 'fxl_hub_session'` only ever proved our constant matched itself; asserting that a request carrying `fxl_hub_session=<id>` makes the **real** SDK call `withSession('<id>')` fails if the SDK renames the cookie, which the constant never could.
Add a comment at the top of that `describe` recording that 1.3.0 declares the three names at `dist/server.js:275-277`, unchanged from 1.2.0's `271-273`, and that these tests - not a constant - are what a future bump re-checks.

### 4. `apps/api/test/rls/hub-bff-session-store.test.ts` (rewritten)

Drop the `createHubSessionScopeMiddleware` / `Hono` / `deleteCookie` imports; the store is now driven directly.

- `it('serializes two concurrent refreshes on one session id so no rotation is lost')`
  **The constraint-1 oracle.** Two independent stores over the same admin connection.
  Store A's operation reads `token-old`, signals a deferred, awaits a release, then `tx.update({ hubRefreshToken: 'token-a' })`.
  While A holds the lock, start store B's `withSession` on the same id, which reads and writes `token-b`.
  Race B against a 1s delay before releasing A.
  Assert as one object: B was `'blocked'`, B observed `'token-a'` (not `'token-old'`), and a third store reads `'token-b'`.
  `bSaw === 'token-a'` is the non-vacuity: delete the `.for('update')` and it becomes `'token-old'`.
  Release both deferreds in a `finally`.
- `it('does not block a different session id while one row lock is held')`
  Proves the lock is per row, not a global mutex.
- `it('rolls back the update and rejects when the operation fails after writing')`
  Operation calls `tx.update` then throws; assert `HubSessionStoreUnavailableError` and that the row still holds the pre-operation token, against real Postgres.
  This is the integration-grade half of constraint 3; the commit-failure half is the unit test above, because forcing a genuine commit failure needs a deferred constraint this schema does not have.
- `it('treats an expired session as absent and deletes the row inside the transaction')`
  Replaces the old "the rows are still sitting in the table" assertion, which is now false by design.
- `it('slides expires_at on update instead of persisting the expiresAt the SDK hands back')`
  Read `expires_at`, `tx.update` with the record spread exactly as `server.js:464` does, assert the stored `expires_at` moved forward.
  Without this, a port that honours `record.expiresAt` looks correct and silently turns the sliding TTL into a hard cap.
- `it('consumes a login transaction exactly once across instances')` - adapted to `createLoginTransaction` / `consumeLoginTransaction`.
- `it('deletes an expired login transaction on consume and returns null')` - the row must be gone afterwards.
- Keep, adapted to the new methods: `resolves a session created by another store instance, which the in-memory default cannot` (with `await memA.create(...)`), `carries a rotated refresh token across store instances`, `never stores the Hub refresh token in plaintext`, `is invisible to the ordinary tenant connection`, `removes only expired rows`.
- **Delete** `rolls back every buffered mutation when persistence fails after the handler returns` - it asserted the swallow this slice removes.

### 5. `apps/api/src/auth/__tests__/hub-session-scope.test.ts`

**DELETED**, together with the file it tests.

## Verify

Run once, never in watch mode.

```bash
pnpm install

# The named oracles, unit.
pnpm --filter @fxl-sales/api exec vitest run \
  src/auth/__tests__/hub-session-store.test.ts \
  src/auth/__tests__/hub-bff-errors.test.ts \
  src/middleware/__tests__/app-auth-bff-wiring.test.ts

# The named oracles, integration, against the local Docker test DB.
pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run \
  test/rls/hub-bff-session-store.test.ts

# Lint the diff.
pnpm --filter @fxl-sales/api lint
pnpm --filter @fxl-sales/web lint

# Full gate.
pnpm run type-check
pnpm test
pnpm run build
pnpm --filter @fxl-sales/api test:integration
```

Also confirm the resolved version, since a stale lockfile is the failure mode that makes every other check pass against 1.2.0:

```bash
grep -n "hub-sdk" pnpm-lock.yaml
```

It must show `1.3.0` and no remaining `@fxl-business/hub-sdk@1.2.0` entry.

## Risks and rollback

- **The peer-dependency trap.** `strict-peer-dependencies=false` means an unmet `hono >= 4.12.28` is a warning, not an error, and `auto-install-peers=true` would resolve a second Hono copy for the SDK.
  The symptom would be bizarre and remote from the cause - `app.route` composing a `Context` from a different Hono than the BFF built against.
  Mitigated by moving `apps/api`'s pin to `4.12.28` in this slice and by the `grep` above. `compose.js` and `hono-base.js` are byte-identical across `4.12.25` and `4.12.28`, so the Hono bump carries no behavioural change of its own.
- **The 503 mechanism depends on Hono's `route()` flatten-and-wrap.** If a future Hono changes it, the `onError` could stop covering the flattened BFF routes and a store outage would silently become a 500 - not a logout, but a worse diagnosis.
  Mitigated by asserting it through the real `app.route('', authBff)` mount in the wiring test rather than against the router in isolation.
- **`/auth/login` and `/auth/callback` now answer a 503 JSON body to a browser navigation** when the store is down, rather than redirecting to `postLoginErrorRedirect`.
  This is not a regression - the deleted scope middleware did exactly the same - and redirecting instead would loop the browser between the Hub and a dead store.
- **Everyone is logged out once.** Not because of an encryption-key change, but because 1.3.0's `create` writes rows this store shape reads differently and the session cookie's id space is unchanged, so an in-flight session survives; the real exposure is a rolling deploy where one replica runs the 1.2.0 store and another the 1.3.0 store against the same rows.
  Both read and write the same columns with the same sealer, so a mixed window is safe; the only asymmetry is that a 1.3.0 replica deletes an expired row a 1.2.0 replica would have left.
  Acceptable, and no truncation is required.
- **Rollback** is `git revert` of the single commit plus `pnpm install`.
  No migration runs, no column changes, no data is rewritten, and both SDK versions read and write `hub_bff_sessions` and `hub_bff_login_txns` identically, so a revert needs no data step.
