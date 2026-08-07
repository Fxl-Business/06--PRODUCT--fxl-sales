---
id: 06-supersede-prior-session
milestone: v2.6.0
status: todo
depends_on: [01-sdk-130-store-port, 02-session-absolute-ttl]
files_modified: [apps/api/src/auth/hub-session-store.ts, apps/api/src/auth/hub-login-scope.ts, apps/api/src/middleware/app-auth.ts, apps/api/src/db/schema.ts, apps/api/src/auth/__tests__/hub-login-scope.test.ts, apps/api/src/auth/__tests__/hub-session-store.test.ts, apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts, apps/api/test/rls/hub-bff-session-store.test.ts, CLAUDE.md, nexo/ROADMAP.md, nexo/runs/feature-20260807-hub-sdk-130-session-hardening/HUB-RESPONSE.md]
acceptance: A second `/auth/callback` from a browser that already held session A deletes A's row in the SAME transaction that inserts the new session, so A no longer resolves through `withSession`, while a session held by any other browser or device is untouched.
---

# 06 - Supersede the prior session at login

## READ THIS FIRST: the slice is rescoped, deliberately

The Frame's wording for this slice is "a prior session superseded server-side at login, so two accounts cannot be authenticated at once", and the Hub's invariant 3 phrases the key as the account.
**Keying the supersede on the account id is both impossible and wrong, and this plan does neither.**

- It is impossible because `accountId` is never available.
  The 1.3.0 BFF never passes it to `store.create()` and never writes it on any later path, so `hub_bff_sessions.account_id` is unconditionally `NULL` in this product.
  Evidence in the next section.
- It is wrong because account-id keying does not close the threat the Hub is describing, and does close something we want left open.
  It logs an operator out of every other device, and it still leaves the previous *account's* row live in the one browser where two identities actually collide.
  Analysis in "The supersede key".

What this slice ships instead is a supersede keyed on **the session id the browser itself presented at `/auth/callback`**.
That is narrower, implementable, has no multi-device blast radius, and closes the one-browser-two-identities case that the account-id design provably does not.
This is a deviation from the Hub's phrasing and must be reported back to them in `HUB-RESPONSE.md`.

## Context and why

At login the SDK's `/auth/callback` mints a new session id, inserts a row, and `setCookie`s the new id over whatever the browser was carrying.
Nothing deletes the row the browser was carrying a moment earlier.
That row still holds a sealed, live, rotatable Hub refresh token, and it stays that way until its sliding TTL elapses and the nightly sweep removes it.

Concretely: an operator signs in as account A, then signs in as account B in the same browser.
Row A is orphaned from the browser's point of view but is fully usable by anyone holding its id, for up to 30 days of wall clock.
That is the "two identities live at once" condition.

## Finding on constraint 1: `accountId` is NOT available at `create()` time, ever

Read out of `@fxl-business/hub-sdk@1.3.0` `dist/server.js`.

`/auth/callback`, lines 407 to 413, is the only call site of `store.create` in the whole bundle:

```js
const current = now();
const sessionId = await store.create({
  hubRefreshToken: tokenJson.refresh_token,
  expiresAt: new Date(current + sessionTtlSeconds * 1e3).toISOString(),
  absoluteExpiresAt: new Date(current + sessionAbsoluteTtlSeconds * 1e3).toISOString()
});
setCookie(c, sessionCookieName, sessionId, baseCookieOptions());
```

Three keys, no `accountId`.

`grep -n accountId dist/server.js` returns exactly one hit, line 208, and it is unrelated:

```js
const claims = toHubTokenClaims(payload, options.audience);
return { accountId: claims.sub, workspaceId: claims.workspaceId, ... };
```

That is `verifyHubToken`'s return value for `requireHubAuth`, on the bearer-token path.
It never touches the store.

The two later write paths preserve the record and add nothing.
`/auth/refresh` line 464 and `/auth/switch` line 519 are both `if (rotated) await tx.update({ ...record, hubRefreshToken: rotated })`.
`...record` is what `tx.get()` returned, so an `accountId` that was never written cannot appear later.

**Conclusion.** `HubSessionRecord.accountId` is a vestigial optional field on the 1.3.0 interface that the bundled BFF never populates.
Our `hub_bff_sessions.account_id` column is written as `data.accountId ?? null`, which is always `null`.
There is no supported seam that would change this: the access token carrying `sub` is fetched inside the SDK's callback handler and is never handed to the store.
The only way to obtain it would be to wrap `options.fetchImpl`, sniff the token-endpoint response body, parse an unverified JWT, and smuggle `sub` into the store, which puts an unverified-claims parse in the login path and couples us to the SDK's internal call ordering.
That is rejected outright.

**Consequence for this file:** the executor MUST NOT write a `WHERE account_id = ...` supersede.
It would compile, deploy, match zero rows forever, and read as a shipped feature.

**Guard shipped with this slice:** a comment on `accountId` in `apps/api/src/db/schema.ts` recording that the 1.3.0 BFF never populates it, so the next reader does not build on a column that is always NULL.
The column is NOT dropped here; that is a separate, irreversible cleanup and belongs in `nexo/ROADMAP.md`.

## Assumptions about slices 01 and 02

Neither `01-*.md` nor `02-*.md` existed when this plan was written; only `00-OVERVIEW.md` was in `nexo/plans/feature-20260807-hub-sdk-130-session-hardening/`.
This slice is planned against `sdk-1.3.0/session-store.d.ts` and the Frame's acceptance criteria, assuming the post-01/02 store looks like this:

1. `create(data: HubSessionRecord): Promise<string>` is async and owns its own `this.#db.transaction(...)`.
2. `withSession<T>(id, op): Promise<T>` opens a transaction, takes `SELECT ... FOR UPDATE` on the row, and passes a `{get, update, delete}` handle to `op`.
3. A record past `expiresAt` or `absoluteExpiresAt` is deleted inside that transaction and `get()` resolves `null`.
4. `hub_bff_sessions` gained an `absolute_expires_at` column in slice 02.
5. `apps/api/src/auth/hub-session-scope.ts` is deleted, the hydrate/flush `AsyncLocalStorage` unit of work and `HubSessionScopeError` are gone, and `createAppAuthBff` mounts the BFF with no session-scope middleware.

**The one contingency.** If slice 01 left `create()` NOT owning a transaction (for example writing through a bare `this.#db.insert(...)`), the executor must give it one before adding the delete.
Constraint 5 is non-negotiable: the delete and the insert are one transaction or the slice is not done.

**Cookie-name constants.** `SESSION_COOKIE`, `SESSION_COOKIE_SECURE`, `LOGIN_TX_COOKIE` and `hubSessionCookieName()` currently live in `hub-session-scope.ts`, which slice 01 deletes.
If slice 01 relocated them, import from wherever it put them.
If slice 01 deleted them outright, recreate `SESSION_COOKIE`, `SESSION_COOKIE_SECURE` and `hubSessionCookieName()` in the new `apps/api/src/auth/hub-login-scope.ts` and re-pin the comment to `@fxl-business/hub-sdk@1.3.0 dist/server.js:275-277`, which is where they now sit:

```js
var SESSION_COOKIE = "fxl_hub_session";
var SESSION_COOKIE_SECURE = "__Host-fxl_hub_session";
var LOGIN_TX_COOKIE = "fxl_hub_login";
```

The names are unchanged from 1.2.0, and the unit test pins them either way.

## The supersede key

### The threat, stated precisely

Two identities authenticated and rotatable at the same time **in one browser**, because login is a blind insert that orphans rather than revokes.
That is what invariant 3 is protecting against.

### Option A, rejected: key on the account id

Delete every other `hub_bff_sessions` row carrying the same `account_id`.

Rejected on three independent grounds, any one of which is sufficient.

1. **Not implementable.** `account_id` is always `NULL`. See the finding above.
2. **Does not close the threat.** In one browser: account A logs in, giving row 1 with account A.
   Account B then logs in in the same browser, giving row 2 with account B, and the supersede deletes B's *other* rows.
   Row 1 is not one of them, so account A's session survives, live and rotatable, which is exactly the condition invariant 3 names.
   Account-id keying solves "one account, many sessions", which is a different problem and is mostly a desirable feature.
3. **Multi-device blast radius.** An operator with a laptop and a desktop is signed out of the desktop every time they sign in on the laptop, and back again.
   Nothing in the threat model asks for this, and no mainstream product does it, including the Hub.

### Option B, chosen: key on the session id this browser presented

At `/auth/callback` the browser sends its existing session cookie alongside the login-transaction cookie.
The cookie is `HttpOnly; SameSite=Lax; Path=/`, and `/auth/callback` is a top-level GET navigation, which `Lax` permits even when the navigation was initiated cross-site by the Hub's redirect.
So the prior session id for **this browser** is knowable at exactly the moment a new session is minted.

That row is, by construction, about to be orphaned: the SDK unconditionally overwrites the cookie two lines later.
Deleting it is therefore not a policy decision about other devices, it is collection of a row this very request just made unreachable.

Why this is strictly better than option A against the actual threat:

- One browser, two accounts: A's row **is** the prior session id that B's callback presents, so A is deleted.
  Option A leaves it live.
- One browser, one account, re-login: the old row is deleted rather than left rotatable for 30 days.
- A stolen session cookie: victim and attacker share one session id and one row, so the victim's next login deletes the row out from under the attacker.
  Option A achieves this too; option B achieves it without the cost.
- A second device: its cookie is a different session id and is never presented on this request, so it is untouched.
  This is the intended behaviour, and it is the difference the multi-device test asserts.

**What option B deliberately does not reach.** A row orphaned without a login, for example because the browser cleared its cookies or the cookie expired before the next sign-in, is never presented and so is never superseded.
Those rows are bounded by the sliding TTL, by slice 02's `absoluteExpiresAt`, and by the nightly `deleteExpiredHubBffSessions` sweep.
**That is why this slice depends on 02**: the absolute TTL is the backstop for every row the supersede key cannot see, and shipping 06 without it would leave an unbounded tail.

### Report back to the Hub

Add to `nexo/runs/feature-20260807-hub-sdk-130-session-hardening/HUB-RESPONSE.md`, as a new numbered contradiction:

- `HubSessionRecord.accountId` is declared on the 1.3.0 interface but the bundled BFF never populates it.
  A consumer implementing invariant 3 as literally written finds the field is always undefined.
  Either `/auth/callback` should set it from the token exchange it already performed, or the field and the invariant's wording should be corrected.
- We are keying the supersede on the prior session id the browser presented, not the account, and we consider that the correct key on the merits.
  Account-id keying does not close one-browser-two-identities and does log users out of every other device.

## What "supersede" means: DELETE

Delete the prior row inside the transaction.
Not a `superseded_at` marker.

- The SDK model has no superseded state.
  `HubSessionRecord` carries no such field, and `tx.get()` returning a record means live.
  A marker column would have to be checked inside our `withSession` and translated into "absent", which is what the delete achieves with fewer moving parts.
- A marked row still holds a sealed refresh token at rest for no benefit.
- The SDK's own expiry rule is already "delete it inside the transaction and resolve `null`" (`MIGRATION.md`, "Sessions now expire").
  Superseding should behave the same way, so there is one way for a session to stop existing, not two.

**Explicit non-goal.** We do not call the Hub's `/auth/logout` for the superseded row.
Doing so would mean a Hub HTTP round trip inside the transaction on the login path, which is exactly the pooled-connection hazard `session-store.sql` warns about.
Deleting our row destroys the only copy of that refresh token that anyone can reach, because the plaintext exists only inside the sealed column.
The Hub-side family remains valid until it expires or rotates, and an attacker who exfiltrated the plaintext token from process memory is outside this slice's threat model.
Record this in `nexo/ROADMAP.md`.

## Migration

**None. No schema change, no index.**

The supersede lookup is `DELETE FROM hub_bff_sessions WHERE id = $1`, which is the primary key.
This is a further point in option B's favour: option A would have needed an index on the nullable `account_id`, plus a decision about whether to make it partial.

RLS posture, the AES-256-GCM sealer, and `getAdminDb()` are all unchanged.
The delete runs on the same admin connection inside the same transaction as the insert, so the existing `hub_bff_sessions_admin_context` policy covers it with no new grant.

## Implementation

### 1. `apps/api/src/auth/hub-login-scope.ts` (new)

An `AsyncLocalStorage` carrying one optional string, plus the Hono middleware that fills it.

Why `AsyncLocalStorage` and not a parameter: `create()` is invoked **by the SDK**, from inside `createHubBff`'s handler.
There is no seam to pass an extra argument, and there is no `createHubBff` option that would carry one.
A side channel is the only mechanism available, and a request-keyed `Map` would be strictly worse.
Do not "simplify" this away.

State clearly in the file header that this is **not** a resurrection of the deleted `hub-session-scope.ts`: it carries a single string, performs no I/O, holds no lock, hydrates no working set, and cannot fail.

```ts
export type HubLoginContext = { priorSessionId: string | undefined };

export function createHubLoginSupersedeMiddleware(
  store: DurableHubSessionStore,
  options: { secureCookies: boolean },
): MiddlewareHandler;
```

**Corrected by plan-check B2.** Slice 01 DELETES the `DurableHubSessionStore` interface, on the reasoning that it would extend `HubSessionStore` by nothing once `withRequest` is gone.
This slice adds `withLoginContext`, so the interface is non-empty again and that reasoning no longer applies.

**Reinstate it in this slice**, in `hub-session-store.ts`:

```ts
export interface DurableHubSessionStore extends HubSessionStore {
  withLoginContext<T>(context: HubLoginContext, fn: () => Promise<T>): Promise<T>;
}
```

and restore `createHubSessionStore`'s discriminated return so the mount site narrows:

```ts
export function createHubSessionStore(deps: {...}):
  | { kind: 'durable'; store: DurableHubSessionStore }
  | { kind: 'memory'; store: HubSessionStore }
```

This is not a reversal of slice 01's judgement; it is the same judgement applied to a now-different fact.
Say so in a one-line comment above the interface so a later reader does not delete it again.

Behaviour:

- Reads `getCookie(c, hubSessionCookieName(options.secureCookies))`.
- Runs `next()` inside `store.withLoginContext({ priorSessionId }, ...)`.
- Mounted on `/auth/callback` **only**.
  `store.create` is called from exactly one place in the whole SDK bundle, `dist/server.js:408` inside the `/auth/callback` handler, so capturing there is provably complete.
  Scoping it narrowly also means `/auth/refresh` and `/auth/logout` cannot accidentally acquire a supersede context.

### 2. `apps/api/src/auth/hub-session-store.ts`

Add to `DurableHubSessionStore`:

```ts
withLoginContext<T>(context: HubLoginContext, fn: () => Promise<T>): Promise<T>;
```

It owns the `AsyncLocalStorage` instance, matching the ownership the deleted `withRequest` had, and is a thin `als.run(context, fn)`.

Change `create()` so the delete and the insert share one transaction:

```ts
async create(data: HubSessionRecord): Promise<string> {
  const id = this.#newId();
  const priorSessionId = this.#loginAls.getStore()?.priorSessionId;
  await this.#db.transaction(async (tx) => {
    // Supersede FIRST, in the same transaction as the insert. A crash between
    // the two would otherwise leave the orphaned session live and rotatable
    // (delete after insert) or leave the browser with no session at all
    // (delete in its own transaction). See slice 06.
    if (priorSessionId !== undefined && priorSessionId !== id) {
      await tx.delete(hubBffSessions).where(eq(hubBffSessions.id, priorSessionId));
    }
    await tx.insert(hubBffSessions).values({ /* unchanged fields */ });
  });
  return id;
}
```

Rules the executor must not vary:

- **Absence of the login context is never an error.** No prior session id means supersede nothing, insert as before.
  This keeps every direct `create()` call in the integration suite and the non-durable dev path working, and it is the correct behaviour for a browser arriving with no cookie.
  Do NOT reintroduce a `HubSessionScopeError`-style guard here.
- `priorSessionId !== id` is cheap defence that can never fire against a 256-bit random id.
  Keep it, do not write a test for it.
- The delete is unconditional on row existence.
  A prior id that names an already-swept row deletes zero rows and is fine.
- Nothing else about `create()` changes: same sealer call, same `aad = id`, same TTL columns slice 02 introduced.

Add a test-only `newId?: () => string` dependency to `createDurableHubSessionStore`, defaulting to the existing `randomBytes(32).toString('base64url')`.
It is the same shape as the existing `now?: () => Date` injection and it is what makes the atomicity test deterministic (see RED test 4).

### 3. `apps/api/src/middleware/app-auth.ts`

Inside `createAppAuthBff`, mount the middleware on the router that already exists for this purpose, using the SAME `secureCookies` boolean that is handed to `createHubBff`.

**Corrected by plan-check B2.** Two things the original snippet got wrong, both of which would have shipped a regression:

1. **It dropped `router.onError(hubBffErrorHandler)`.** Slice 01 puts that handler on this exact router, and it is the ONLY thing that turns a session-store outage into a `503` instead of a cookie-clearing `500`. It must survive.
2. **It said "on the durable branch only" while slice 01 removes the `if (session.kind === 'memory') return bff;` early return.** Without that early return, the memory store flows through the same router, and `InMemoryHubSessionStore` has no `withLoginContext` - so every `/auth/callback` in a local dev environment without `DATABASE_URL` would throw `TypeError: store.withLoginContext is not a function`. The mount must therefore be explicitly narrowed.

The correct shape:

```ts
const router = new Hono();
// Narrowed explicitly: the memory fallback (local dev without DATABASE_URL) flows
// through this same router as of slice 01, and the SDK's InMemoryHubSessionStore
// has no withLoginContext. Only the durable store can supersede.
if (session.kind === 'durable') {
  router.use('/auth/callback', createHubLoginSupersedeMiddleware(session.store, { secureCookies }));
}
router.onError(hubBffErrorHandler);   // slice 01 owns this - do NOT drop it
router.route('', bff);
return router;
```

Keep the existing comment's point: the middleware is mounted INSIDE the returned router so `server.ts` stays `app.route('', authBff)` and it cannot be forgotten.

Add a test asserting `createAppAuthBff()` on the **memory** path still serves `/auth/callback` without throwing.
Nothing in the original slice 06 test list covered that branch, which is how the `TypeError` would have reached local dev unnoticed.

### 4. `apps/api/src/db/schema.ts`

Comment only, on `hubBffSessions.accountId`:

```ts
// Always NULL. @fxl-business/hub-sdk@1.3.0's BFF never passes accountId to
// store.create() (dist/server.js:408) and never adds it on refresh or switch
// (:464, :519), so nothing can ever populate this column. Do NOT build a
// supersede or any other lookup on it - see slice 06. Dropping it is tracked
// in nexo/ROADMAP.md.
```

### 5. `CLAUDE.md`

Add to the Auth Model section, after the `hub_bff_sessions` paragraph:

> A login SUPERSEDES the session id the browser presented at `/auth/callback`, deleting that row in the SAME transaction that inserts the new one, so a re-login cannot orphan a live rotatable refresh token.
> The key is deliberately the prior SESSION ID and not the account id.
> The 1.3.0 BFF never populates `HubSessionRecord.accountId`, so `hub_bff_sessions.account_id` is always NULL; and keying on the account would log the operator out of every other device while still leaving the previous account's row live in the one browser where two identities actually collide, which is the case invariant 3 exists to close.
> Sessions this key cannot see, orphaned without a login, are bounded by `absoluteExpiresAt` and the nightly sweep instead.
> The prior session id reaches `create()` through an `AsyncLocalStorage` owned by the store and set by a `/auth/callback`-only middleware, because the SDK calls `store.create` from inside its own handler with no seam for an extra argument.
> That is NOT a return of the deleted hydrate-around-the-handler bridge, and the paragraph above forbidding a working set still stands: this context carries one string, performs no I/O, holds no lock, and has no failure mode.

### 6. `nexo/ROADMAP.md`

Two entries:

- `hub_bff_sessions.account_id` is provably dead under SDK 1.3.0 and can be dropped in a later migration.
- A superseded session's Hub-side refresh family is not revoked at the Hub, only unreachable from this product.
  Revisit if the Hub ever offers a revoke endpoint that does not require a round trip inside the login transaction.

## RED tests, written FIRST

### Integration: `apps/api/test/rls/hub-bff-session-store.test.ts`

New `describe('prior-session supersede at login')`.
These are the real oracles, because the invariant is about rows and transactions.
Track every created id with the existing `trackSession` helper so `afterAll` cleans up.

1. **`it('deletes the session id the browser presented at login')`**
   Create session A.
   Then `await store.withLoginContext({ priorSessionId: A }, () => store.create({ hubRefreshToken: 'token-new' }))` giving B.
   Assert A's row count is 0, B's is 1.
   Red today because `create()` deletes nothing.

2. **`it('leaves a session held by another browser untouched')`**
   The multi-device oracle, and the anti-oracle for the rejected option A.
   Create A (browser 1) and C (browser 2).
   Supersede presenting only A.
   Assert A is gone and **C still resolves through `withSession`** with its original token.
   This test is what goes red if anyone later "fixes" the key to be broader.
   Write a comment saying so.

3. **`it('makes the superseded session unresolvable through withSession')`**
   After the supersede, `await store.withSession(A, async (tx) => tx.get())` resolves `null`.
   Asserted through the SDK-facing accessor rather than a raw row count, because "no longer refreshes" is a statement about what `/auth/refresh` will see: `dist/server.js:423-426` turns a null `get()` into `401 no_session` with the cookie cleared.

4. **`it('keeps the prior session when the new insert fails')`**
   The atomicity oracle for constraint 5.
   Pre-insert a decoy row with a known id `X` via `adminClient`.
   Build the store with `newId: () => X`.
   Create session A with an ordinary store.
   `await expect(store.withLoginContext({ priorSessionId: A }, () => store.create({...}))).rejects.toThrow()` on the primary-key violation.
   Assert A's row is **still present** and still resolves through `withSession`.
   An implementation that deletes outside the transaction, or in a separate transaction, loses A and has nothing to replace it with, so this goes red on exactly the mistake constraint 5 names.

5. **`it('creates a session normally when no prior session was presented')`**
   `create()` with no `withLoginContext` at all, and `create()` inside `withLoginContext({ priorSessionId: undefined })`.
   Both insert normally and throw nothing.
   Non-vacuity for the other four, and the fresh-browser path.

### Unit: `apps/api/src/auth/__tests__/hub-login-scope.test.ts` (new)

Drive a real `Hono` app with the middleware mounted, as `hub-session-scope.test.ts` does today.

6. **`it('captures the prior session id from the session cookie on /auth/callback')`**
   Request with `cookie: fxl_hub_session=sid-prior`, handler asserts the captured context.

7. **`it('captures nothing on a request that carries no session cookie')`**
   Context present, `priorSessionId` undefined.

8. **`it('reads __Host-fxl_hub_session when secureCookies is true')`**
   Both names pinned, and the 1.3.0 line reference in the file header re-checked.

### Unit: `apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts`

9. **`it('mounts the login-supersede middleware on /auth/callback')`**
   Same shape as the existing `mounts the session-scope middleware on /auth/*`.
   Deleting the `router.use(...)` line must go red, because the integration tests call `withLoginContext` directly and would all stay green with the middleware unmounted.
   That is the exact gap the file header already describes for `sessionStore`.

### Manual E2E, once, in a real browser

The multi-device claim is the whole justification for the chosen key and deserves an actual observation, not only a test double.

1. Start the API and web dev servers.
   Sign in at `http://localhost:8006`.
   Record the row: `SELECT id, created_at FROM hub_bff_sessions;` over the admin connection.
2. Sign out and sign in again in the same browser.
   Expect exactly one row, with a new id.
   Before this slice there are two.
3. Sign in from a second browser profile.
   Expect two rows.
   Sign in again in the first profile.
   Expect still two rows, and **the second profile stays signed in** without a reload prompt.
   That is the multi-device guarantee.
4. Kill both dev servers by the process-group id of the command that launched them.

## Verification

Run-once only, never a watcher.

```bash
pnpm --filter @fxl-sales/api exec vitest run src/auth src/middleware
pnpm --filter @fxl-sales/api test:integration
pnpm run lint
pnpm run type-check
pnpm test
pnpm run build
```

The integration suite needs the local Docker test database.
`apps/api/test/rls/setup-env.ts` hard-overrides `DATABASE_URL`, so it cannot fall back to the staging database `apps/api/.env` points at.

## Risks and rollback

**Multi-device blast radius of the chosen design: none.**
That is the point of choosing it.
A session is superseded only when its own id is presented on a `/auth/callback` in the browser holding it, and only that request's browser can present it.
No other device, browser profile, or incognito window is reachable.
Test 2 is the standing guard.

**Blast radius of the rejected design, for the record.**
Option A would have signed an operator out of every other device on every login, silently, with no UI acknowledging it.
If a future reader is tempted back toward it, test 2 goes red and this section is why.

**Lock contention on the login path.**
The supersede `DELETE` blocks if a `/auth/refresh` is concurrently holding `FOR UPDATE` on the prior row.
Bounded by the BFF `timeoutMs` slice 01 sets, and it is the correct ordering: the delete should serialize behind an in-flight rotation rather than interleave with it.
Same pooled-connection consideration `sdk-1.3.0/session-store.sql` documents, and it applies to one extra statement on a rare path.
No new mitigation needed beyond the pool sizing slice 01 already records.

**A wrong prior id is harmless.**
The value comes from an `HttpOnly` cookie our own server set, and the delete is by primary key.
A stale or swept id deletes zero rows.
The worst case is a no-op, never a foreign row, because ids are 256-bit random and unguessable.

**The `newId` seam is test-only.**
It defaults to the existing `randomBytes(32)` and is never overridden in `createHubSessionStore`.
If it is ever wired to anything but a test, the session id stops being unguessable, which is the one thing `hub_bff_sessions.id` must be.
Say so in a comment at the declaration.

**Rollback.**
Revert the commit.
There is no migration and no data shape change, so nothing to undo in the database.
Rows this slice deleted stay deleted, and the effect is that those browsers were logged out once at their next login, which is what the deploy does anyway per `MIGRATION.md`'s upgrade checklist step 6.
The narrower intermediate rollback is to unmount the middleware in `createAppAuthBff`: `create()` then finds no login context, supersedes nothing, and behaves exactly as it did before this slice.
