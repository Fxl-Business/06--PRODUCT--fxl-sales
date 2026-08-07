# Response to the FXL Hub session-store follow-up

Run: `feature-20260807-hub-sdk-130-session-hardening`
Date: 2026-08-07
Repo: `fxl-sales`, branch `master`, at `6f6bf49`.

This answers deliverables 1 and 4 of the Hub's message: the three questions, and everything in our codebase that contradicts what the message asserts.
Every claim below was read out of the code, not inferred from our earlier write-up.

## Q1. Does your session store serialize per session id?

**Closed. The lock exists and spans the read and the write.**

`apps/api/src/auth/hub-session-store.ts` hydrates with `.for('update')` - a `SELECT ... FOR UPDATE` - at line 206, and `withRequest` (line 293) wraps hydrate, handler and flush in a single `this.#db.transaction(...)`.
The row lock is therefore held from before the refresh token is read until after the rotated token is written.
Two concurrent requests for one session id serialize at Postgres; the second blocks on the lock until the first commits, then re-reads the rotated token.

The message's diagnostic ("if the flush happens after the response is sent, it is probably open") does not apply.
The flush runs inside the transaction, before the middleware returns, and therefore before Hono has emitted the response.

**However, one hole of exactly the shape Q1 describes does exist, reached differently.**

`withRequest`'s catch block, lines 302 to 314:

```ts
if (phase === 'flush') {
  console.error('[hub-session-store] flush failed', err);
  return handlerResult!.value;
}
```

The catch sits outside the transaction callback, so by the time it runs the transaction has already rolled back.
A flush failure is then swallowed and the handler's value is returned as if it had succeeded.
The sequence:

1. The Hub rotates `RT1` to `RT2` and the BFF hands the browser a fresh access token.
2. The flush fails (a commit error, a connection drop).
3. The client receives `200` and carries on. Postgres still holds `RT1`.
4. The next refresh presents `RT1`, which trips `reuse_detected`, and the family is revoked.
5. The user is force-logged-out.

That is the Q1 outcome by another route. It should answer `503`, which is what the hydrate path already does.
The port to `withSession` removes the separate flush phase entirely and closes this structurally.

## Q2. Do your persisted sessions expire?

**Half open. Sliding TTL yes, absolute lifetime no.**

The 1.2.0 record shape was not ported verbatim. `apps/api/src/auth/hub-session-store.ts` declares `SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000`, the `hub_bff_sessions` table carries a real `expires_at` column, the hydrate predicate is `and(eq(id, sessionId), gt(expiresAt, now))`, `get()` re-checks expiry against the working set, and `deleteExpiredHubBffSessions` sweeps both tables from the nightly scheduler.
Login transactions carry their own `LOGIN_TX_TTL_MS` of 10 minutes, matched to the SDK's `LOGIN_TX_MAX_AGE_SECONDS`.

So a stolen session id does not stay valid forever, and the specific regression the message warns about - persistence removing the implicit restart TTL without replacing it - did not happen here.

**But the TTL is sliding only.** `update()` rewrites `expiresAt` to `now + 30 days` on every refresh-token rotation, and there is no `absoluteExpiresAt` anywhere in the schema or the record.
An idle session dies after 30 days; a session that keeps refreshing never dies at all.
1.3.0's `sessionAbsoluteTtlSeconds` (365 days by default) is precisely the missing half, and we are adopting it.

## Q3. Where is refresh failure classified?

**Open, exactly as described.**

Classification is entirely client-side and count-based.
`apps/web/src/auth/react.tsx` line 43 declares `SESSION_REVALIDATE_DELAYS_MS = [500, 1_500, 4_000]`; `observeToken` enters the ladder on a `null` while a session is held, and the fourth consecutive `null` - roughly six seconds of continuous failure - calls `failSession()` and tears the session down.
`HubClient.getToken()` collapses a network throw, a non-200 and an unparseable body into one `null`, so the provider is choosing a retry count against two signals it genuinely cannot tell apart.
Nothing on our server side distinguishes a Hub `5xx` from a revoked family.

The counter resets on every recovery rather than accumulating - `apps/web/src/auth/__tests__/react.test.tsx` pins that - which is what stops the fourth unrelated blip signing an operator out.
That reset is a mitigation for the missing classification, not a substitute for it.

## Contradictions with the message

### 1. 1.3.0 is published

The message says to check the registry and to ask rather than assume, because the publish was human-gated and pending at the time of writing.

```
$ npm view @fxl-business/hub-sdk version
1.3.0
$ npm view @fxl-business/hub-sdk versions
[ '1.0.0', '1.2.0', '1.3.0' ]
```

It is live. We pulled the tarball and read `MIGRATION.md`, `schema/session-store.sql` and the `.d.ts` surface before touching anything, as instructed.

### 1b. The published 1.3.0 tarball cannot be resolved at all - please republish

This is the one thing in this document that needs action on your side, and it blocks every consumer, not just us.

`1.3.0`'s published `package.json` carries the SOURCE-resolution fields at the top level:

```
$ npm view @fxl-business/hub-sdk@1.3.0 main exports
main = './src/index.ts'
exports = {
  '.':       { types: './src/index.ts',       default: './src/index.ts' },
  './server':{ types: './src/server.ts',      default: './src/server.ts' },
  './client':{ types: './src/client.ts',      default: './src/client.ts' }
}
```

while `files` is `["dist", "schema", "MIGRATION.md"]`, so `src/` is not in the tarball.
Every entry point therefore points at a file that does not exist:

```
$ node -e "import('@fxl-business/hub-sdk/server')"
ERR_MODULE_NOT_FOUND: Cannot find module '.../@fxl-business/hub-sdk/src/server.ts'
```

Vite fails the same way with `Failed to resolve entry for package "@fxl-business/hub-sdk"`.

`1.2.0` is correct - its published `package.json` has `main: "./dist/index.cjs"` and `exports` pointing at `dist`, which is exactly what your own `publishConfig` block says should happen.
So the `publishConfig` swap was applied when `1.2.0` was published and was not applied when `1.3.0` was.
The most likely cause is a publish run through `npm publish` rather than `pnpm publish`: npm does not honour `main`/`module`/`types`/`exports` inside `publishConfig`, pnpm does.
The `comment` field in your `package.json` already anticipates exactly this hazard.

We have bridged it locally with a `pnpm patch` (`patches/@fxl-business__hub-sdk@1.3.0.patch`) that rewrites those four fields to the `publishConfig` values already present in the same file.
It changes no code, and `dist/` in the tarball is complete and correct - only the pointers are wrong.
We will delete the patch as soon as a fixed version is on the registry.

Please republish as `1.3.1` with the swap applied, and consider adding a `prepublishOnly`/`postpack` assertion that the resolved entry points exist inside the packed tarball.

### 2. Q1's premise does not hold for this repo

The row lock spans the read and the write, per the answer above. The concern is closed, though the flush-failure hole it led us to is real and worth having found.

### 3. Q2's premise half does not hold

We did not port the 1.2.0 record shape verbatim, and sessions are not immortal. The sliding-versus-absolute distinction is the accurate framing.

### 4. `HubClient.getToken()` still hides the classification 1.3.0 added

This is the one that matters for other consumers.

`MIGRATION.md` says, under "Refresh failures are now classified":

> If your client has a retry ladder that guesses at this distinction, it can now read it directly.

It cannot, not through the bundled browser client. `dist/client.d.ts` in 1.3.0 declares:

```ts
getToken(): Promise<string | null>;
```

unchanged from 1.2.0, with the doc comment "returns the fresh access token (or null on failure)".
The `401` / `503` / `502` split is real at the BFF HTTP layer, but `createHubClient` discards it before the consumer sees it.
A consumer wanting to act on the classification has to bypass `HubClient.getToken()` and hand-roll a `fetch` against `/auth/refresh`, which also means re-implementing `bffBasePath` resolution and credential handling.

Either `getToken` should surface the status, or the migration guide should say plainly that the browser client does not expose it and the consumer must call the endpoint directly.
We are taking the hand-rolled route in slice 03 and would rather not have to.

### 4b. `HubSessionRecord.accountId` is declared but the bundled BFF never populates it, so invariant 3 cannot be implemented as worded

Your invariant 3 phrases the supersede as "a prior session for that ACCOUNT".
A consumer implementing that literally finds the field is always `undefined`.

`store.create` has exactly one call site in the whole 1.3.0 bundle, `dist/server.js:407-413`:

```js
const sessionId = await store.create({
  hubRefreshToken: tokenJson.refresh_token,
  expiresAt: ...,
  absoluteExpiresAt: ...
});
```

Three keys, no `accountId`.
`grep -n accountId dist/server.js` returns exactly one hit, `:208`, inside `verifyHubToken`'s return value on the bearer-token path, which never touches the store.
The two later write paths add nothing: `/auth/refresh` `:464` and `/auth/switch` `:519` are both `if (rotated) await tx.update({ ...record, hubRefreshToken: rotated })`, and `...record` is what `tx.get()` returned, so a value that was never written cannot appear later.

So `HubSessionRecord.accountId` is vestigial in practice, and our `hub_bff_sessions.account_id` is unconditionally `NULL`.
The only way to obtain the account id would be to wrap `options.fetchImpl`, sniff the token-endpoint response body, parse an unverified JWT and smuggle `sub` into the store - an unverified-claims parse in the login path, coupled to your internal call ordering. We rejected that outright.

Either `/auth/callback` should set `accountId` from the token exchange it has already performed, or the field and invariant 3's wording should be corrected.

**What we shipped instead, and why we think it is the better key on the merits.**
We supersede the session id THE BROWSER ITSELF PRESENTED at `/auth/callback`, deleting that row in the same transaction that inserts the new one.

- One browser, two accounts - the case invariant 3 names - is closed by our key and is NOT closed by the account key. With the account key, A logs in, then B logs in and the supersede deletes B's other rows; A's row is not one of them, so A stays live and rotatable in that same browser. The account key solves "one account, many sessions", which is a different and mostly desirable thing.
- The account key also logs an operator out of every other device on every login. Nothing in the threat model asks for that, and no mainstream product does it, including the Hub.
- Our key has no multi-device blast radius by construction: only the browser holding a session id can present it, so a second device is untouched. We have a standing integration test asserting exactly that, precisely so nobody later "fixes" the key to be broader.
- The row we delete is one your handler is about to orphan anyway - it overwrites the session cookie two lines later - so this is collection of a row the request just made unreachable, not a policy decision about anyone else's device.

The deliberate gap: a row orphaned WITHOUT a subsequent login, for example when the browser clears its cookies, is never presented and so is never superseded. We bound those with the absolute session TTL and a nightly sweep instead, which is why we shipped the absolute lifetime first.

### 5. The upgrade invalidates two load-bearing statements in our own `CLAUDE.md`

Ours, not the Hub's, but they are the reason the port is not mechanical:

- `CLAUDE.md` documents "`HubSessionStore` is a SYNCHRONOUS interface, so the store hydrates around the handler instead of awaiting inside it" as an invariant, with the hydrate-around-the-handler shape justified at length. That entire section becomes false and is rewritten by this run.
- `apps/api/src/auth/hub-session-scope.ts` line 16 pins the BFF cookie names to "`@fxl-business/hub-sdk@1.2.0` dist/server.js:271-273" with a comment that a future SDK bump must re-check those exact lines. This is that bump, and the check is part of slice 01's acceptance.

### 6. A note on the connection-pool warning, which we think is under-sold

`schema/session-store.sql` documents that the BFF calls the Hub over HTTP from inside the transaction holding the row lock, and warns about pool exhaustion.
Our current 1.2.0 implementation already has this shape - `withRequest` runs the whole BFF handler inside `this.#db.transaction` - but on 1.2.0 there is **no `timeoutMs` at all**, so a hung Hub pins a pooled connection with an open transaction indefinitely.
That is a live production exposure on the published version, not merely a sizing consideration on the new one, and it is not mentioned in the message's comparison table row for "Upstream timeouts" (which reads only "none" versus "bounded, 10s default").
Worth calling out explicitly to other consumers still on 1.2.0: the absence of the timeout is not just a slow-request problem, it is an unbounded connection hold.

## What we are doing about it

Six slices, planned and executed under `/nexo-feature --autopilot`, landing on `master`.
Nothing is promoted to staging or production without a separate human Gate 3.

| # | Slice | Addresses |
|---|---|---|
| 01 | SDK `^1.3.0` bump, store ported to `withSession`, hydrate/flush bridge deleted | Q1 residual hole, the upgrade itself |
| 02 | Absolute session TTL, both timestamps enforced inside `withSession` | Q2 |
| 03 | Refresh-failure classification consumed by the web retry ladder | Q3 |
| 04 | Durable logout intent gating the recovery path | logout leak, invariant 2 |
| 05 | Query-cache flush on logout, login and workspace switch | logout leak, invariant 1 |
| 06 | Prior session superseded server-side at login | logout leak, invariant 3 |

We are keeping our own store rather than adopting `SqlHubSessionStore`, because ours carries repo-specific posture the bundled one cannot know about: `FORCE` RLS reached only through `getAdminDb()`, an HKDF-SHA256 sealer keyed off `FXL_HUB_SECRET_KEY` with the row id as AEAD additional data, the Drizzle schema, and the nightly purge job.
We read your reference store's DDL first and found our posture and yours agree, which was reassuring.
