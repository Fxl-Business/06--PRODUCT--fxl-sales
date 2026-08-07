---
id: 03-refresh-failure-classification
milestone: v2.6.0
status: todo
depends_on: [01-sdk-130-store-port]
files_modified:
  - apps/web/src/auth/refresh.ts
  - apps/web/src/auth/token.ts
  - apps/web/src/auth/react.tsx
  - apps/web/src/auth/__tests__/refresh.test.ts
  - apps/web/src/auth/__tests__/token.test.ts
  - apps/web/src/auth/__tests__/react.test.tsx
  - CLAUDE.md
  - nexo/ROADMAP.md
acceptance: "given the provider holds a signed-in session, a 401 from /auth/refresh signs the operator out on that single response with no revalidation timer ever scheduled, while a 503 or a 502 preserves the session and is retried on the unchanged SESSION_REVALIDATE_DELAYS_MS ladder whose consecutive-failure counter still resets on every recovery"
---

# 03 - Refresh failure classification

Web only.
No file under `apps/api/**` is touched by this slice.
The ladder itself, its delays and its reset semantics are NOT modified.
This slice changes only WHICH outcomes enter the ladder.

## 1. Context, and what was verified before designing

### 1.1 What 1.3.0 actually does

Read out of the staged tarball at `nexo/runs/feature-20260807-hub-sdk-130-session-hardening/sdk-1.3.0/` and out of the extracted `dist/server.js`, not inferred.

`POST /auth/refresh` in 1.3.0 answers exactly four ways:

| Condition | Status | Body |
| --- | --- | --- |
| No session cookie, or the record is past `expiresAt` / `absoluteExpiresAt` | `401` | `{error: 'no_session'}` |
| The Hub returned a permanent refresh code (`invalid`, `expired`, `revoked`, `reuse_detected`) | `401` | `{error: 'session_expired'}` |
| The upstream call threw, timed out, or answered `408` / `425` / `429` / any `5xx` | `503` | `{error: 'refresh_unavailable'}` |
| The Hub answered `401` with no recognized code, or a `200` body that is not a refresh response | `502` | `{error: 'invalid_refresh_response'}` |

Two consequences that drive the design below.

**There are TWO 401 bodies, not one.**
`MIGRATION.md` names only `session_expired`, but the handler also answers `401 {error: 'no_session'}` for a missing cookie and for an expired record.
Both mean the same single thing to this client: sign in again.
So the classification key is the STATUS, never the body string.

**A store failure is not in the table.**
Our store answers `503` on a hydrate or lock failure, and an unhandled throw out of `withSession` would surface as a `500`.
Both are non-`401`, so a status-keyed rule classifies them transient without needing a fifth branch, which is exactly right: neither is a verdict on the session.

### 1.2 The bundled browser client hides all of it

`dist/client.d.ts` in 1.3.0 still declares:

```ts
getToken(): Promise<string | null>;
```

and `dist/client.js` implements it as:

```js
try { res = await fetchImpl(`${bffBase}/auth/refresh`, { method: "POST", credentials: "include" }); }
catch { return null; }
if (res.status !== 200) { return null; }
const json = await res.json().catch(() => null);
return isRefreshResponse(json) ? json.accessToken : null;
```

`res.status` is read, tested, and thrown away.
`MIGRATION.md`'s claim that a client with a retry ladder "can now read it directly" is false through the bundled client, which is contradiction 4 in `HUB-RESPONSE.md`.
This slice therefore has to obtain the status itself.

### 1.3 What this repo does today

`apps/web/src/auth/react.tsx` line 43 declares `SESSION_REVALIDATE_DELAYS_MS = [500, 1_500, 4_000]`.
`observeToken(null)` enters the ladder while `hasSessionRef.current` is true, and the fourth CONSECUTIVE null (one direct read plus three rungs, about six seconds) calls `failSession()`.
The counter resets on every recovery, and `apps/web/src/auth/__tests__/react.test.tsx` pins that reset with the test `resets the ladder after each recovery, so unrelated blips never accumulate`.
CLAUDE.md records the lifetime-total variant as the original destroyed-form bug.
That reset is load-bearing and this slice must leave it exactly as it is.

`apps/web/src/auth/token.ts` wraps `client.getToken()` in a cache with a generation guard, a single in-flight refresh, and a JWT-expiry read.
Its public `getToken()` returns `Promise<string | null>`.

The provider's own `getToken`, exposed through `useAccessToken` to roughly forty call sites, also returns `Promise<string | null>`.
That public signature is NOT changed by this slice.

### 1.4 The hazard that makes `depends_on: [01-sdk-130-store-port]` hard, not soft

Verified against the currently installed SDK at `apps/api/node_modules/@fxl-business/hub-sdk/dist/server.js`:

```
384:      return c.json({ error: "no_session" }, 401);
401:      return c.json({ error: "refresh_failed" }, 401);   // upstream fetch threw
406:      return c.json({ error: "refresh_failed" }, 401);   // Hub answered 401
410:      return c.json({ error: "refresh_failed" }, 401);   // body did not parse
```

On the published 1.2.0, EVERY refresh failure is a `401`, including a network throw and an unparseable body.
Shipping this slice against a 1.2.0 API would classify every transient blip as `session_expired` and sign the operator out immediately, which is strictly worse than today's ladder.
Slice 01 must be merged first.
The executor's first action is the guard in section 6.0.

## 2. Design decisions, resolved

### 2.1 How the status is obtained: a hand-rolled fetch, in its own module

**Chosen.** A new `apps/web/src/auth/refresh.ts` exporting `requestHubAccessToken(bffBasePath, fetchImpl?)`, which issues the `POST` itself and returns a discriminated result.
`HubClient.getToken()` is no longer called anywhere in the app.

**Rejected: peeking the response through a custom `fetchImpl` handed to `createHubClient`.**
`CreateHubClientOptions.fetchImpl` does exist, and reading `res.status` is non-destructive so no `clone()` would be needed, which is why the option looked promising.
It was rejected on four counts.

1. It does not remove the coupling it was meant to remove.
   The wrapper still has to recognize which request is the refresh, and the only way to do that is to match the URL against the same `/auth/refresh` literal a hand-rolled fetch would spell out.
   So the path is hard-coded either way, and the peek adds a second coupling on top: that `getToken()` performs exactly one fetch whose status maps one-to-one onto the `null` it returns.
2. It creates a correlation problem with no correct answer.
   The wrapper observes a status; the caller observes a `null`.
   Joining them requires a mutable slot and the assumption that only one refresh is ever in flight.
   That assumption happens to hold today because the cache coalesces, but it is an invariant enforced in a different module from the one that depends on it, which is exactly the shape of bug this feature exists to remove.
3. The status-to-outcome mapping has to be written by us in either design, so the SDK is doing none of the work that matters.
4. It splits one decision across two modules: `token.ts`'s behaviour would depend on an option threaded through `react.tsx` into `createHubClient`.

The coupling that remains in the chosen design is two literals: the path `<bffBasePath>/auth/refresh` and `credentials: 'include'`.
Both are the BFF's public HTTP contract, documented by `MIGRATION.md`'s status table, not SDK internals.
`bffBasePath` comes from the SAME `getHubBffBasePath(import.meta.env)` call that is handed to `createHubClient`, computed once in the provider and passed to both, so the two can never resolve to different origins.
The coupling is stated loudly in the module header and pinned by a test that asserts the exact request shape, so a future SDK change to the method, the path or the credential mode surfaces as a red test rather than as a silent `404` that would read as a Hub outage.

### 2.2 The new semantics

- `401` tears the session down IMMEDIATELY, with no ladder.
  The session is provably dead, so six seconds of retries buy nothing and are pure latency in front of a login the operator already needs.
- `503` and `502` enter the existing bounded ladder, unchanged.
- Any other non-`200`, a `200` whose body is not a refresh response, and a network throw all enter the ladder too, because none of them is distinguishable from transient.

### 2.3 The ladder is untouched

`SESSION_REVALIDATE_DELAYS_MS` keeps its value, its export, and its four-consecutive-failure exhaustion.
`revalidateAttempts.current = 0` in the recovery branch of `observeToken` stays exactly where it is.
The existing test that pins the reset must keep passing without being weakened.

### 2.4 Cold start now waits out a transient failure

Today `observeToken(null)` with `hasSessionRef.current === false` calls `applyToken(null)` at once, which drives `HubProtected` into `captureReturnTo` plus `login()`.

That stays correct for a `401`, which is the overwhelmingly common cold-start case: an anonymous visitor has no session cookie, the BFF answers `401 no_session`, and the app redirects to login with the same latency as today.

It is wrong for a `503`.
An immediate redirect during a Hub outage lands on a login that also fails, burns the `registerLoginAttempt` budget, and after three attempts strands the operator on `SessionRecoveryPanel`.
That is the same class of bug the ladder exists to prevent, reached from the other end.

**Decision: the cold-start special case is deleted.**
Classification, not session presence, decides whether the ladder runs.
A cold-start `503` therefore holds `isLoaded` at `false` for up to about six seconds, during which `HubProtected` renders its existing full-screen `Skeleton`, and then exhausts the ladder into exactly today's behaviour: `applyToken(null)`, capture, login.

**Consequence: `hasSessionRef` becomes dead and is REMOVED**, along with its declaration, its comment, the write in `observeToken`, and the write in `failSession`.
It has no other reader.
Leaving it would leave a ref whose doc comment ("Gates the ladder") is a lie.

The one behaviour that ref incidentally provided is that a `getToken()` read landing after an explicit `Sair` could not start a ladder.
Losing it is harmless: `applyToken(null)` is idempotent through the `lastAppliedToken` guard, so an exhausted post-logout ladder re-applies a state the app is already in, and the unmount effect still clears the pending timer.
The real fix for post-logout reads is slice 04's durable logout intent, which owns that story.

### 2.5 The sales-ops error panel is OUT OF SCOPE

The question is real: `requireToken(getToken)` throws `AuthTokenUnavailableError` whenever the provider hands back `null`, `isAuthFailure` returns true for it, and the panels in `apps/web/src/sales-ops/SalesOpsApp.tsx` and `apps/web/src/sales-ops/CadastroHistoryPanel.tsx` then say `Sessão expirada`.
After this slice a `503` still reads that way, and a Hub outage is not an expired session.

It is nonetheless excluded, for a reason and not for cost.

The classification stops at the provider on purpose.
Carrying it further means either widening the public token reader from `() => Promise<string | null>` at roughly forty call sites and in the `AccessTokenHook` type, or putting a `reason` on `AuthTokenUnavailableError` that only the provider can populate.
`apps/web/src/lib/require-token.ts` documents that it imports NOTHING, because `api-client.ts` imports it and any import back is a cycle, so neither option is a local edit.
The alternative of parking the last failure in a module-level variable the panel reads is a second source of truth for one fact, which is the pattern this feature is removing elsewhere.

Nothing gets worse either: before this slice a transient `null` already produced that same panel while signed in, and already signed the operator out at cold start.
The frequency is unchanged.

It is recorded in `nexo/ROADMAP.md` by section 5.5 rather than left implicit.

### 2.6 Boundaries with the neighbouring slices

- Do not touch `logout()` beyond the mechanical `observeToken` signature change, do not touch `apps/web/src/auth/session-recovery.ts`, and do not touch the query cache.
  Those are slices 04 and 05.
- Slice 05 also edits `react.tsx`.
  Execution is serial per the overview, so there is no worktree conflict to manage; just keep this slice's diff confined to the sections named below.

## 3. The new module: `apps/web/src/auth/refresh.ts`

Create it with this content.
The header comment is part of the deliverable, not decoration: it is where the coupling is stated loudly.

```ts
/**
 * The one place the browser asks the Hub BFF for an access token, and the one
 * place a refresh failure is classified.
 *
 * WHY THIS BYPASSES THE SDK CLIENT. `@fxl-business/hub-sdk@1.3.0` classifies
 * refresh failures at the BFF - a `401` means the session is dead, a `503`
 * (`refresh_unavailable`) and a `502` (`invalid_refresh_response`) are transient
 * and must be retried - but `HubClient.getToken()` still declares
 * `Promise<string | null>` and discards `res.status` before any consumer sees it
 * (`dist/client.js`, the `if (res.status !== 200) return null` branch). The
 * classification is unreachable through the client, so this module issues the
 * request itself.
 *
 * COUPLING, STATED LOUDLY. This module hard-codes two things the SDK also
 * hard-codes: the path `<bffBasePath>/auth/refresh` and `credentials: 'include'`.
 * They are the BFF's public HTTP contract, documented by the status table in the
 * SDK's MIGRATION.md, not SDK internals - and `bffBasePath` comes from the SAME
 * `getHubBffBasePath` call that is handed to `createHubClient`, so the two cannot
 * resolve to different origins. If a future SDK changes the method, the path or
 * the credential mode of `/auth/refresh`, THIS FILE MUST CHANGE WITH IT.
 * `__tests__/refresh.test.ts` pins the request shape so that change lands as a
 * red test rather than as a silent 404 that would read as a Hub outage.
 */

/**
 * Why a refresh produced no token.
 *
 * `session_expired` is the BFF's own `401` verdict and is the ONLY outcome that
 * proves the session is dead. Everything else is `transient`: it must preserve
 * the session and be retried.
 */
export type HubRefreshFailure = 'session_expired' | 'transient';

export type HubTokenResult = { token: string } | { token: null; failure: HubRefreshFailure };

/** Shared, so the several "this should be impossible" sites cannot disagree. */
export const TRANSIENT_TOKEN_RESULT: HubTokenResult = Object.freeze({
  token: null,
  failure: 'transient',
} as const);

function readAccessToken(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const accessToken = (body as { accessToken?: unknown }).accessToken;
  return typeof accessToken === 'string' && accessToken.length > 0 ? accessToken : null;
}

export async function requestHubAccessToken(
  bffBasePath: string,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): Promise<HubTokenResult> {
  let res: Response;
  try {
    res = await fetchImpl(`${bffBasePath}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
  } catch {
    // The network threw. Indistinguishable from a Hub outage, so: transient.
    return TRANSIENT_TOKEN_RESULT;
  }

  /*
    Classified on the STATUS ALONE, deliberately. 1.3.0 answers `401` with TWO
    different bodies - `{error:'session_expired'}` when the Hub revoked the family,
    `{error:'no_session'}` when there is no cookie or the record has expired - and
    both mean exactly one thing here: sign in again. Reading the body would add a
    branch with no consumer, and would make a body-less 401 from a proxy read as
    transient, which is the wrong way round.
  */
  if (res.status === 401) return { token: null, failure: 'session_expired' };
  // A 503 `refresh_unavailable`, a 502 `invalid_refresh_response`, and the 500 an
  // unhandled store failure would produce all land here. Preserve; retry.
  if (res.status !== 200) return TRANSIENT_TOKEN_RESULT;

  const body = await res.json().catch(() => null);
  const token = readAccessToken(body);
  // A 200 whose body is not a refresh response is our own bug or a proxy's, never
  // a verdict on the session.
  return token === null ? TRANSIENT_TOKEN_RESULT : { token };
}
```

## 4. `apps/web/src/auth/token.ts`

The cache keeps every one of its current behaviours: coalescing, the generation guard, the JWT-expiry read, `seed`, `clear`.
Two things change.

**4.1 It no longer takes the SDK client.**
It takes an injected refresher, so the cache is the CACHE and `refresh.ts` is the classification.
One seam each.

```ts
export function createHubAccessTokenCache(
  refresh: () => Promise<HubTokenResult>,
): HubAccessTokenCache
```

The `import type { HubClient }` at the top goes away.
Add `import { TRANSIENT_TOKEN_RESULT, type HubTokenResult } from './refresh';`.

**4.2 `getToken` returns `Promise<HubTokenResult>`.**

```ts
export type HubAccessTokenCache = {
  getToken: () => Promise<HubTokenResult>;
  seed: (accessToken: string, expiresInSeconds: number) => void;
  clear: () => void;
};
```

`inFlight` becomes `Promise<HubTokenResult> | null`.
A cache hit returns `Promise.resolve({ token: freshToken })`.

The refresh body becomes, with the `.then` callback's return type annotated so every branch is checked:

```ts
const refreshPromise = refresh()
  .then((result): HubTokenResult => {
    if (generation !== refreshGeneration) {
      // Superseded by a `seed` (workspace switch) or a `clear` (logout). A late
      // answer proves nothing about the CURRENT session, so it is never allowed
      // to report `session_expired` and tear one down.
      const current = readFreshToken();
      return current === null ? TRANSIENT_TOKEN_RESULT : { token: current };
    }
    if (result.token === null) {
      discardCachedToken();
      return result;
    }
    const jwtExpiry = readJwtExpiry(result.token);
    if (jwtExpiry !== null) {
      cachedToken = result.token;
      expiresAt = jwtExpiry;
    } else {
      discardCachedToken();
    }
    return result;
  })
  .finally(() => {
    if (inFlight === refreshPromise) inFlight = null;
  });
```

The superseded branch is the one genuinely new rule in this file, and it is why it carries a comment: mapping it to `session_expired` would sign the operator out on a workspace switch that raced a dying refresh.

`seed`, `clear`, `readFreshToken`, `discardCachedToken`, `readJwtExpiry` and `readServerExpiry` are unchanged.

## 5. `apps/web/src/auth/react.tsx`

Nine edits, all inside `HubAuthProvider` except the first and the last.

**5.1 Imports.**
Add `import { requestHubAccessToken, TRANSIENT_TOKEN_RESULT, type HubTokenResult } from './refresh';`.

**5.2 One `bffBasePath`, feeding both constructions.**
This is what makes the hand-rolled path unable to drift from the SDK's.

```ts
const bffBasePath = useMemo(() => getHubBffBasePath(import.meta.env), []);
const client = useMemo(
  () => createHubClient(loadHubBrowserConfig(import.meta.env), { bffBasePath }),
  [bffBasePath],
);
const tokenCache = useMemo(
  () => createHubAccessTokenCache(() => requestHubAccessToken(bffBasePath)),
  [bffBasePath],
);
```

**5.3 Delete `hasSessionRef`**, its declaration and its doc comment.

**5.4 `failSession`** loses only its `hasSessionRef.current = false;` line.
It still clears the timer, resets the attempt counter, and applies `null`.

**5.5 `scheduleRevalidate`'s rung** becomes:

```ts
void tokenCache.getToken().then(observeToken, () => observeToken(TRANSIENT_TOKEN_RESULT));
```

The delays, the pending-timer short circuit, the `attempt >= SESSION_REVALIDATE_DELAYS_MS.length` exhaustion and the increment are all untouched.

**5.6 `observeToken`** takes the classified result:

```ts
function observeToken(result: HubTokenResult) {
  // A resolution that lands after unmount is dropped whole: applying it would be a
  // setState on a dead root, and rescheduling from it would leak a timer forever.
  if (!mountedRef.current) return;
  if (result.token !== null) {
    clearRevalidateTimer();
    revalidateAttempts.current = 0;
    // A normal re-login (attempt 1, callback, token) leaves the loop guard at
    // zero, so it can never fire during ordinary operation.
    clearLoginAttempts();
    applyToken(result.token);
    return;
  }
  /*
    The BFF's own `401`. The session is provably dead - revoked, reused, expired,
    or never there - so the ladder has nothing left to prove and six seconds of
    retries would be pure latency in front of a login the operator already needs.
  */
  if (result.failure === 'session_expired') {
    failSession();
    return;
  }
  /*
    Transient, and that includes a COLD START. Signing out on a boot-time Hub blip
    would redirect into a login that also fails, burn the `registerLoginAttempt`
    budget and strand the operator on `SessionRecoveryPanel` - the same class of
    bug the ladder exists to prevent, reached from the other end. `isLoaded` stays
    false meanwhile, so `HubProtected` holds its Skeleton rather than flashing a
    signed-out screen.
  */
  scheduleRevalidate();
}
```

**5.7 The public `getToken` keeps its `Promise<string | null>` signature.**
This is deliberate: roughly forty call sites and `AccessTokenHook` depend on it, and section 2.5 explains why the classification stops here.

```ts
const getToken = useCallback(async () => {
  const result = await tokenCache.getToken();
  observeToken(result);
  return result.token;
}, [observeToken, tokenCache]);
```

**5.8 `setActive`** passes `observeToken({ token: result.accessToken })`.
Nothing else in it changes, including the `operationGeneration` guard.

**5.9 The mount effect** classifies its own catch:

```ts
void tokenCache
  .getToken()
  .then((result) => {
    if (active) observeToken(result);
  })
  .catch(() => {
    // `requestHubAccessToken` already absorbs a network throw, so reaching here is
    // a bug rather than an outage. It is still transient: a throw is not a verdict.
    if (active) observeToken(TRANSIENT_TOKEN_RESULT);
  });
```

The stale comment about `hasSessionRef` on that catch goes with it.

**5.10 The `SESSION_REVALIDATE_DELAYS_MS` doc comment** is rewritten, because its current text describes the guess this slice removes:

```ts
/**
 * The bounded revalidation ladder, entered only by a TRANSIENT refresh failure.
 *
 * `requestHubAccessToken` classifies against the BFF's status: a `401` means the
 * session is dead and `failSession()` runs at once, with no rung ever scheduled.
 * Everything else - `503 refresh_unavailable`, `502 invalid_refresh_response`, a
 * network throw, an unparseable body - preserves the session and schedules a
 * re-read instead, because treating a Hub blip as a dead session is what destroyed
 * a half-filled form every time a refresh hiccuped.
 *
 * Four CONSECUTIVE transient failures (about six seconds) exhaust the ladder and
 * the session really is torn down, so a Hub that never recovers cannot leave the
 * app stranded half-authenticated. The counter resets on every recovery; a
 * lifetime total reships the original bug.
 */
```

## 6. Tests, RED first

Every test below is written and seen to FAIL before the corresponding production edit.
`vitest.config.ts` sets `environment: 'node'`, so `refresh.test.ts` needs no pragma; `react.test.tsx` keeps its `// @vitest-environment happy-dom` first line.

Note the standing warning in CLAUDE.md: happy-dom cannot observe browser activation behaviour, and a DOM-level test once passed with the bug fully present.
The oracle for "did it enter the ladder" is therefore NOT a latency observation.
It is `vi.getTimerCount()`, an invariant that makes the failure impossible to hide: the ladder is the only thing in this file that schedules a timer, so a count of `0` after a `401` is proof no rung exists, not evidence that none has fired yet.

### 6.0 Guard, before writing anything

```bash
grep -c refresh_unavailable apps/api/node_modules/@fxl-business/hub-sdk/dist/server.js
```

Must print a non-zero count.
A `0` means slice 01 has not landed and the installed BFF still answers `401` for every failure (section 1.4); STOP and report, because shipping onto that BFF makes every transient blip an instant sign-out.

### 6.1 New file `apps/web/src/auth/__tests__/refresh.test.ts`

`describe('requestHubAccessToken')`, with a `vi.fn<typeof fetch>()` and real `Response` objects (Node 20 has both globals).

1. `classifies every 401 as session_expired, whichever body the BFF sends` - `it.each` over `{error: 'session_expired'}`, `{error: 'no_session'}`, and an empty body.
   All three resolve `{token: null, failure: 'session_expired'}`.
   This is the test that pins section 1.1's two-bodies finding.
2. `classifies a transient status as transient so the session survives a Hub outage` - `it.each([503, 502, 500, 429, 418])`, each resolving `{token: null, failure: 'transient'}`.
3. `classifies a network throw as transient` - the fake fetch rejects.
4. `classifies a 200 whose body is not a refresh response as transient` - `it.each` over `{}`, `{accessToken: 42}`, `{accessToken: ''}`, and a non-JSON text body.
5. `returns the access token on a 200 refresh response`.
6. `posts to the BFF refresh endpoint with credentials included` - asserts the fake fetch was called with `'http://localhost:3006/auth/refresh'` and `{method: 'POST', credentials: 'include'}`, and separately that an empty base path yields `'/auth/refresh'`.

7. **Added by plan-check N2 - the real-SDK contract pin.** Test 6 above asserts our literal against our literal, which is exactly the weakness slice 01 identified in the old cookie-name pin ("comparing `SESSION_COOKIE === 'fxl_hub_session'` only ever proved our constant matched itself"). If a future SDK moves the refresh path or method, test 6 stays green while the app silently 404s - and this slice's own classifier reads a 404 as neither 401 nor 5xx, so every page load would burn the full ladder and then bounce to a login.

   Add one Node-environment test that constructs the REAL BFF - `createHubBff(config, { sessionStore: new InMemoryHubSessionStore() })` from `@fxl-business/hub-sdk/server` - and asserts that `POST /auth/refresh` with no cookie answers `401`, and that `POST /auth/refreshx` does not exist. That is the slice-01-grade version of the same pin: it fails loudly on an SDK path change instead of silently.

   Put it beside the slice 01 wiring tests if the environments differ; the point is that it exercises the SDK's real router, not a fake.
   This is the loud coupling pin from section 2.1; its failure message should be read as "the SDK's BFF contract moved".

### 6.2 `apps/web/src/auth/__tests__/token.test.ts`

The existing `fakeClient(getToken)` helper is replaced by passing the refresher directly, and every mocked resolution is wrapped (`token` becomes `{token}`, `null` becomes `{token: null, failure: 'transient'}`).
Every existing assertion keeps its meaning; `resolves.toBe(token)` becomes `resolves.toEqual({token})`.

One test is added:

7. `reports a superseded refresh as transient, never as an expired session` - start a refresh, call `clear()`, then resolve the in-flight refresh with `{token: null, failure: 'session_expired'}`, and assert the pending promise resolves `{token: null, failure: 'transient'}`.
   Without the generation branch of section 4.2, a workspace switch or a logout that races a dying refresh would report a dead session and tear down the one that just replaced it.

### 6.3 `apps/web/src/auth/__tests__/react.test.tsx`

Add three local helpers next to the existing `jwt` / `profileToken` helpers, and retype the cache mock to `vi.fn<() => Promise<HubTokenResult>>()`:

```ts
const ok = (token: string): HubTokenResult => ({ token });
const expired: HubTokenResult = { token: null, failure: 'session_expired' };
const transient: HubTokenResult = { token: null, failure: 'transient' };
```

`TokenReader` stays `() => Promise<string | null>`, because that is the unchanged public shape of `useAccessToken`.

**The four new tests, all inside `describe('session preservation and route restore')` and all under `useLadderTimers()`.**

8. RED - `signs out at once when the BFF says the session expired, without entering the ladder`.
   Mount signed in (`ok(token)`), then the probe read resolves `expired`.
   Assert, with NO timer advance at all: `profileText(container)` is `'signed-out:'`, `vi.getTimerCount()` is `0`, and `mocks.cache.getToken` has been called exactly twice (mount plus probe).
   The timer count is the invariant; the call count proves no rung ran.
9. RED - `keeps the session and enters the ladder when a refresh is transiently unavailable`.
   Mount signed in, probe read resolves `transient`.
   Assert `profileText` is still `'signed-in:Alpha'`, `mocks.client.login` was not called, and `vi.getTimerCount()` is `1`.
   Then `advance(SESSION_REVALIDATE_DELAYS_MS[0])` with the next read resolving `ok(token)`, and assert still signed in with `vi.getTimerCount()` back to `0`.
10. RED - `holds a cold start on a transient failure instead of signing out`.
    Every read resolves `transient` from the mount read onward.
    After `flushReact()`: `profileText` is `'loading'` (`isLoaded` is still false), `vi.getTimerCount()` is `1`, and `mocks.client.login` was not called.
    Then walk the full ladder with `advance` and assert it ends `'signed-out:'` with `login` called exactly once - the ladder terminates, it does not hang.
11. RED - `signs out at cold start when the BFF says the session expired`.
    The mount read resolves `expired`.
    Assert `profileText` is `'signed-out:'` immediately, `vi.getTimerCount()` is `0`, and `mocks.client.login` was called exactly once.
    This is the anonymous-visitor path and it must keep today's latency exactly.

**The existing tests, updated.**

- `resets the ladder after each recovery, so unrelated blips never accumulate` - wrap the mocked values (`transient` for the blip, `ok(token)` for the recovery) and change NOTHING else.
  It must stay green.
  It is the pinned behaviour named in CLAUDE.md and it is the reason this slice may not touch `revalidateAttempts`.
- `keeps the signed-in session when a refresh resolves null once` - rename the `null` in the mock to `transient`; the title's "null" may become "transient".
- `hydrates the provider through the token cache instead of the SDK client` - `expect(mocks.createHubAccessTokenCache).toHaveBeenCalledWith(expect.any(Function))` replaces the `mocks.client` assertion.
  Keep `expect(mocks.client.getToken).not.toHaveBeenCalled()`; it is now permanent rather than incidental.
- ADD `wires the token cache to the BFF refresh endpoint at the same base path as the SDK client`.
  `vi.mock('../refresh', async (importOriginal) => ({...(await importOriginal()), requestHubAccessToken: mocks.requestHubAccessToken}))`, `vi.stubEnv('VITE_API_URL', 'http://localhost:3006')` inside the test, then invoke the function captured from `createHubAccessTokenCache` and assert `requestHubAccessToken` was called with `'http://localhost:3006'` AND that `createHubClient` received `{bffBasePath: 'http://localhost:3006'}`.
  This is the drift guard for section 2.2's shared `bffBasePath`.
- `stops re-logging in and offers a manual retry after repeated failures` - the mock becomes `expired`.
  A `transient` mock would hold `isLoaded` at false and never reach `loginBlocked`, and a dead session is the realistic cause of that panel anyway.
- `captures and restores the pre-login route across a genuine re-login` - keep it on `transient`, so it exercises the whole ladder end to end before the sign-out.
- `clears a still-pending ladder timer at unmount` and `drops a ladder refresh that resolves after unmount instead of rescheduling` - `transient`, otherwise unchanged.
  The `deferred<string | null>` in the second becomes `deferred<HubTokenResult>`.
- Every remaining `mocks.cache.getToken.mockResolvedValue(profileToken(...))` becomes `ok(profileToken(...))`.

`apps/web/src/sales-ops/__tests__/blank-bearer-token.test.tsx` needs NO change: it mocks `@/auth/react` wholesale and consumes the `string | null` public reader, which section 5.7 preserves.
Confirm it is still green rather than editing it.

## 7. Documentation

**7.1 CLAUDE.md, "Auth Model".**
Replace the paragraph beginning "A null token read does NOT immediately sign the user out." with:

```
- A failed token read does NOT immediately sign the user out, and WHICH failure it was decides whether the ladder runs at all.
  The browser reads `/auth/refresh` itself through `requestHubAccessToken` in `apps/web/src/auth/refresh.ts` and never through `HubClient.getToken()`, because the bundled 1.3.0 client still declares `Promise<string | null>` and discards `res.status`; that hand-rolled fetch is coupled to the path and to `credentials: 'include'`, which is why one `getHubBffBasePath` result feeds both it and `createHubClient` and why `refresh.test.ts` pins the request shape.
  A `401` is the BFF's own verdict that the session is dead - both of its bodies, `session_expired` and `no_session`, mean the same thing - so classification keys on the STATUS and `failSession()` runs on that single response with no rung ever scheduled.
  Everything else preserves the session and enters the bounded ladder (`SESSION_REVALIDATE_DELAYS_MS`), which gives up only after four CONSECUTIVE transient failures.
  A cold start is no longer a special case: it follows the same rule, so a boot-time Hub outage holds the Skeleton for about six seconds instead of bouncing into a login that would also fail and burn the attempt budget.
  The counter resets on every recovery; making it a lifetime total signs the operator out on roughly the fourth unrelated blip, which is the original destroyed-form bug, and `apps/web/src/auth/__tests__/react.test.tsx` pins the reset.
```

**7.2 `nexo/ROADMAP.md`,** appended to the Backlog list:

```
- fix: a TRANSIENT `/auth/refresh` failure (`503 refresh_unavailable`, `502 invalid_refresh_response`) still reads as `Sessão expirada` in the sales-ops bootstrap panel and in `CadastroHistoryPanel`, because the classification stops at the provider. The public token reader is `() => Promise<string | null>` at roughly forty call sites, so `requireToken` throws an undifferentiated `AuthTokenUnavailableError` and `isAuthFailure` cannot tell a dead session from a Hub outage. `apps/web/src/lib/require-token.ts` deliberately imports nothing (`api-client.ts` imports it, so any import back is a cycle), so the fix is not a local edit: it needs either a `reason` on the error threaded from the provider, or a widened reader contract. Scoped out of `feature-20260807-hub-sdk-130-session-hardening` slice 03 with that reasoning; nothing got worse there, the copy was already wrong for this case.
```

## 8. Verification, run-once only

Never a bare watching `vitest`.
`apps/web`'s `test` script is already `vitest run`.

```bash
# 0. the slice-01 guard from section 6.0
grep -c refresh_unavailable apps/api/node_modules/@fxl-business/hub-sdk/dist/server.js

# 1. the three touched suites, narrowest first, while iterating
pnpm --filter @fxl-sales/web exec vitest run src/auth/__tests__/refresh.test.ts
pnpm --filter @fxl-sales/web exec vitest run src/auth/__tests__/token.test.ts
pnpm --filter @fxl-sales/web exec vitest run src/auth/__tests__/react.test.tsx

# 2. the whole auth surface plus the one sales-ops test that reads a token
pnpm --filter @fxl-sales/web exec vitest run src/auth src/sales-ops/__tests__/blank-bearer-token.test.tsx

# 3. the web package whole
pnpm --filter @fxl-sales/web lint
pnpm --filter @fxl-sales/web type-check
pnpm --filter @fxl-sales/web test

# 4. the repo gates
pnpm run lint
pnpm run type-check
pnpm test
pnpm run build
```

`pnpm --filter @fxl-sales/api test:integration` is not required by this slice, which touches no API file, but slice 01 already owes it for the same milestone.

No dev server, file watcher or background process is started by this slice, so there is nothing to kill afterwards.

## 9. Risks and rollback

**R1. Landing ahead of slice 01 is actively harmful.**
Verified in section 1.4: the installed 1.2.0 BFF answers `401` for a network throw and for an unparseable body as well as for a dead session, so this slice on that BFF converts every transient blip into an instant sign-out.
Mitigated by `depends_on`, by serial execution, and by the hard guard in section 6.0.

**R2. A proxy or CDN that rewrites the BFF's `401` costs a first-time visitor about six seconds of Skeleton.**
Bounded by the ladder, which then produces exactly today's behaviour.
Accepted: the alternative, treating an unknown status as dead, is the bug this slice exists to remove.

**R3. The hand-rolled request drifts from the SDK's.**
This is the acknowledged cost of rejecting the `fetchImpl` peek.
Mitigated by the shared `bffBasePath` (they cannot disagree about the origin), by the loud module header, by test 6.1.6 pinning the exact request shape, and by test 6.3's drift guard.
A drift surfaces as a red test, and in production as a `404` classified transient, which is a six-second delay and then a login rather than a silent wrong answer.

**R4. A ladder can now start after an explicit `Sair`,** because `hasSessionRef` is gone.
Harmless: `applyToken(null)` is idempotent through `lastAppliedToken`, and the unmount effect clears the timer.
Slice 04's durable logout intent owns the real fix.

**R5. `react.test.tsx` is edited broadly** (every mocked resolution changes shape), so a careless edit could weaken the pinned reset test.
Mitigation: change ONLY the mocked value shapes in that test, never its loop, its counts or its assertions, and re-read it against `git diff` before committing.

**Rollback.** `git revert` the slice commit.
There is no migration, no API change, no persisted state and no schema; the three source files are self-contained and `HubClient.getToken()` still exists in the SDK, so the previous wiring compiles again unchanged.
