---
id: 02-refresh-403-permanent
milestone: v2.8.0
status: todo
depends_on: []
files_modified: [apps/web/src/auth/refresh.ts, apps/web/src/auth/react.tsx, apps/web/src/auth/__tests__/refresh.test.ts, apps/web/src/auth/__tests__/token.test.ts, apps/web/src/auth/__tests__/react.test.tsx, CLAUDE.md]
acceptance: A `403` from `/auth/refresh` classifies as `request_refused`, schedules no revalidation timer, and reaches `HubProtected` as a terminal `authFault` that suppresses auto-login, while a `503`, a `502`, a `500` and a network throw still enter the unchanged ladder and its consecutive-failure reset still holds.
---

# 02 - a 403 from /auth/refresh is a permanent, explanatory outcome

## Context

`apps/web/src/auth/refresh.ts` classifies a refresh failure on the HTTP status alone.
`401` is `session_expired`; **everything else** - `403`, `502`, `503`, `500`, a network throw and an unparseable `200` body - collapses into `transient`.

That is what made the 2026-08-10 outage opaque.
The `hub-sdk@1.3.x` CSRF origin guard answered every `POST /auth/refresh` with `403 {"error":"forbidden"}`.
The web client preserved the session, walked all four rungs of `SESSION_REVALIDATE_DELAYS_MS` over about six seconds, exhausted the ladder, tripped the login loop guard, and showed `Não foi possível restabelecer sua sessão`.
The operator was fully entitled, and the diagnosis had to be made with `curl` rather than from the screen.
See `nexo/milestones/v2.7.1/SUMMARY.md`.

`v2.7.1` fixed the cause (`apps/api/src/auth/hub-bff-origin.ts` rewrites `Origin` for an allowlisted browser origin) and deliberately left the classification alone under hotfix pressure.
This slice closes that follow-up.

### What a `403` on `/auth/refresh` actually means - verified against the installed SDK

Read from `node_modules/.pnpm/@fxl-business+hub-sdk@1.3.1_hono@4.12.28/node_modules/@fxl-business/hub-sdk/dist/server.js`.

The `POST /auth/refresh` route handler (line 416) can only ever emit four statuses:

| Status | Body | Cause |
| --- | --- | --- |
| `200` | `{accessToken, expiresIn}` | success |
| `401` | `{error:'no_session'}` | no session cookie, or the record is missing/expired |
| `401` | `{error:'session_expired'}` | the Hub answered `401` with a code in `PERMANENT_REFRESH_CODES` |
| `502` | `{error:'invalid_refresh_response'}` | the Hub answered `401` without a permanent code, or any non-success body |
| `503` | `{error:'refresh_unavailable'}` | the Hub threw, timed out, or answered `408`/`425`/`429`/`5xx` |

The route handler emits **no `403` at all**.
The only `403` inside `createHubBff` is the CSRF guard in the `app.use('*')` at line 337, which runs on every POST *before* the route and before the session is ever consulted.
(The `403 {error:'forbidden', code:'not_a_member'}` at line 521 belongs to `POST /auth/switch`, not to `/auth/refresh`, and an upstream Hub `403` on refresh is folded into `502` by the fallthrough at line 459.)

So the honest meaning of a `403` here is narrower than "not entitled":

> **The BFF refused this request before looking at the session.**

It says nothing about whether the session is alive.
It cannot be fixed by retrying (the guard is deterministic on the request's own headers) and it cannot be fixed by signing in again (a fresh session would be refused identically - which is exactly the redirect storm the outage produced).
An intermediate proxy or WAF answering `403` lands in the same place and has the same property: it is a deployment fault, not a user fault.

That is why the variant is named for the refusal and not for entitlement.

## The new `HubTokenResult` shape

In `apps/web/src/auth/refresh.ts`:

```ts
export type HubRefreshFailure = 'session_expired' | 'transient' | 'request_refused';

export type HubTokenResult = { token: string } | { token: null; failure: HubRefreshFailure };
```

`request_refused` is the name slice 03 branches on.
It is deliberately **not** `not_entitled`, `forbidden` or `access_denied`:

- `not_entitled` would be a lie, per the status table above - the BFF never gets far enough to judge entitlement on this endpoint.
- `forbidden` / `access_denied` just re-spell the status number, which is what the current code already does and what this slice exists to stop.
- `request_refused` states the one fact that is true and the one that determines the UX: the request itself was refused, so neither a retry nor a re-login can help, and the screen must say something about the environment rather than about the operator.

No new frozen constant is added.
`TRANSIENT_TOKEN_RESULT` exists because several "this should be impossible" sites needed one shared object; `request_refused` is produced at exactly one site, and tests build their own literal.

## Exact changes

### 1. `apps/web/src/auth/refresh.ts`

Widen `HubRefreshFailure` as above, and add the branch immediately after the `401` branch and before the `res.status !== 200` fallthrough:

```ts
if (res.status === 401) return { token: null, failure: 'session_expired' };
/*
  The BFF refused the REQUEST, before the session was ever consulted. In 1.3.1
  the `/auth/refresh` ROUTE emits no 403 at all - the only one inside
  `createHubBff` is the CSRF origin guard in its `app.use('*')`, which runs on
  every POST ahead of the route - so a 403 here says nothing about the session
  and everything about how this deployment is wired. An intermediate proxy or
  WAF answering 403 has the same property.

  Permanent, therefore, in the precise sense that matters: retrying cannot
  change a deterministic verdict on the request's own headers, and signing in
  again cannot either, because the next refresh is refused identically. That is
  the 2026-08-10 outage - four silent retries and a generic panel in front of a
  misconfiguration - see `nexo/milestones/v2.7.1/SUMMARY.md`.
*/
if (res.status === 403) return { token: null, failure: 'request_refused' };
// A 503 `refresh_unavailable`, a 502 `invalid_refresh_response`, and the 500 an
// unhandled store failure would produce all land here. Preserve; retry.
if (res.status !== 200) return TRANSIENT_TOKEN_RESULT;
```

Also extend the existing status-only comment block above the `401` branch to say the classification stays status-only for `403` too, for the reason in "The `401` versus `403` boundary" below.

### 2. `apps/web/src/auth/token.ts` - NO source change

Stated explicitly so the executor does not go looking for one.

`createHubAccessTokenCache` never reinterprets a verdict; it only caches tokens.
The `result.token === null` branch already discards cached state and returns the result verbatim, so `request_refused` reaches the caller unchanged with no edit.
The superseded-generation branch already downgrades any late failure to `TRANSIENT_TOKEN_RESULT`, and that is correct for `request_refused` for exactly the reason it is correct for `session_expired`: a late answer proves nothing about the current session and must not be allowed to tear one down.

The module gets **tests only** (see RED tests), pinning both of those behaviours so a future edit cannot quietly acquire an opinion about the new variant.

### 3. `apps/web/src/auth/react.tsx`

**a. New provider state.** Beside the existing `profile` / `workspaces` state in `HubAuthProvider`:

```ts
/**
 * The terminal, non-transient reason the provider has no session, or `null`.
 * Written only by the refusal branch of `observeToken` and cleared by every other
 * terminal outcome, so it always names the MOST RECENT verdict.
 */
const [authFault, setAuthFault] = useState<HubAuthFault | null>(null);
```

with, above the provider:

```ts
export type HubAuthFault = 'request_refused';
```

A one-member union today on purpose: slice 03 widens it, and a union rather than a boolean is what lets it do so without touching this slice's writers.

`setAuthFault` is a `useState` setter, so it is referentially stable and can join the `useMemo` dependency list without breaking the stable identity that ~40 `getToken` call sites depend on.

**b. `failSession()` clears it.** One line, first statement after `clearRevalidateTimer()`:

```ts
function failSession() {
  clearRevalidateTimer();
  revalidateAttempts.current = 0;
  // Every terminal outcome that is NOT a refusal clears the fault: ladder
  // exhaustion, and `logout()`, which calls this. The refusal branch below sets
  // it AFTER calling this, which is the whole ordering rule.
  setAuthFault(null);
  applyToken(null);
}
```

This is what makes a stale fault structurally impossible rather than merely improbable, and it gives `logout()` the clear for free with no edit to `logout()` itself.

**c. `observeToken` becomes exhaustive.** The current `if (session_expired) ... else scheduleRevalidate()` shape would silently route the new variant into the ladder, which is the exact bug this slice removes.
Replace the two trailing branches with a `switch` that the compiler checks:

```ts
switch (result.failure) {
  case 'request_refused':
    /*
      The BFF refused the REQUEST. Retrying is futile - the verdict is
      deterministic on the request's own headers - and so is signing in again,
      because the next refresh is refused identically; that loop is what turned
      the 2026-08-10 misconfiguration into a blank minute followed by a panel
      blaming the operator's session. No rung is ever scheduled, exactly as for a
      401. `failSession()` FIRST, then the fault, because `failSession` clears it.
    */
    failSession();
    setAuthFault('request_refused');
    return;
  case 'session_expired':
    /* ...existing comment, unchanged... */
    failSession();
    return;
  case 'transient':
    /* ...existing comment, unchanged... */
    scheduleRevalidate();
    return;
  default: {
    const unhandled: never = result.failure;
    // A future variant that forgets a branch fails type-check here instead of
    // falling into the ladder, which is how a `403` reached it in the first place.
    throw new Error(`unhandled refresh failure: ${String(unhandled)}`);
  }
}
```

`no-unused-vars` in `apps/web/eslint.config.js` only ignores `^_` for **arguments**, not for variables, so the name is `unhandled` and the `String(unhandled)` in the message is what uses it.

**d. The success branch clears the fault.** In the `result.token !== null` block, beside the existing `revalidateAttempts.current = 0` / `clearLoginAttempts()` / `clearLogoutIntent()` group:

```ts
setAuthFault(null);
```

Same argument as `clearLogoutIntent()` sitting there: a token in hand is proof the refusal is over.

**e. Expose it.** Add `authFault` to the `HubAuthState` type and to the `value` `useMemo` (and to its dependency array).
No new exported hook in this slice - `HubProtected` lives in the same module and reads `useHubAuthContext()` directly.
Slice 03 adds a hook if it needs one outside this file.

**f. `HubProtected` treats it as terminal.**

- Derive it in the same idiom as the two existing guards:
  ```ts
  const sessionRefused = isLoaded && !isSignedIn && authFault !== null;
  ```
  The `isLoaded && !isSignedIn` prefix is belt and braces on top of (d): a signed-in tree can never render a fault panel.
- Add `!sessionRefused` to the auto-login effect's guard (`if (!isLoaded || isSignedIn || loginBlocked || logoutIntent || sessionRefused) return;`).
  **This is load-bearing, not cosmetic.** Without it the refusal signs the operator out, the effect immediately redirects to the Hub, the callback succeeds, the next refresh is refused again, and the outage's minute-long redirect storm comes back - only faster, because the six seconds of ladder that used to absorb it are gone.
- Add the render branch **after** `logoutIntent` and **before** `loginBlocked`:
  ```ts
  if (sessionRefused) {
    return <SessionRecoveryPanel onRetry={...} />;
  }
  ```
  After `logoutIntent` because an explicit `Sair` is the operator's own action and the most truthful thing to show, and the two can only ever co-occur through an ordering accident.
  Before `loginBlocked` because a named verdict beats the loop guard's generic "we tried a few times", and because with the effect guarded above the loop guard will not even have fired.
  Its `onRetry` is exactly:
  ```tsx
  onRetry={() => {
    // Clearing the fault re-arms the login effect on the next render, the same
    // way the loop guard's retry re-arms it by clearing the counter. No direct
    // `login()` call: one path into `login()` is what keeps `captureReturnTo`
    // and `registerLoginAttempt` on that path too.
    clearAuthFault();
    clearLoginAttempts();
    recheckRecoveryGuards();
  }}
  ```
  which requires `clearAuthFault: () => void` on `HubAuthState`, implemented in the provider as `useCallback(() => setAuthFault(null), [])` and added to the `value` `useMemo` and its dependency array.
  `clearLoginAttempts()` is included because a refusal reached after the loop guard had already fired must not leave the operator stuck behind a second guard on the next render.

**g. Update the module doc comment** above `SESSION_REVALIDATE_DELAYS_MS` (lines 36-50): a `403` is now a second outcome that schedules no rung, and the "everything else" sentence must stop claiming it covers `403`.

### The boundary this slice does NOT cross

**No new screens.** Slice 03 owns them.
`sessionRefused` deliberately renders the **existing** `SessionRecoveryPanel`, with its existing pt-BR copy, unchanged.
The value delivered here is the classification, the absent timer, the suppressed redirect loop and the plumbing - all of it tested - not the words on the screen.
Slice 03's only job on this axis is to swap which component that branch returns and to widen `HubAuthFault`.

## What slice 03 receives

- `HubRefreshFailure` carries `'request_refused'`, produced only by a `403` from `/auth/refresh`.
- `HubAuthFault` is an exported one-member union, ready to widen.
- The auth context exposes `authFault: HubAuthFault | null` and `clearAuthFault()`.
- `HubProtected` already has a terminal render branch keyed on `sessionRefused`, positioned between `logoutIntent` and `loginBlocked`, with auto-login already suppressed while it is set.
- Slice 03's other two states (account not entitled, active workspace not entitled) do **not** arrive through this seam and must not be forced through it: they are read from the claims of a token that DID arrive (`profileFromToken` already parses `claims.workspaces`), because a BFF that refuses the request never returns claims at all.

## RED tests

Written first, each red before the corresponding change.

### `apps/web/src/auth/__tests__/refresh.test.ts`

1. `classifies a 403 as request_refused, because the BFF refused the request rather than judging the session`
   - `it.each` over the shapes the guard and a proxy can send: `{"error":"forbidden"}`, an empty body, and a body that is not JSON.
   - Each resolves to `{token: null, failure: 'request_refused'}`.
   - The non-JSON case is what pins that the classification never reads the body.
2. Extend the existing `classifies a transient status as transient so the session survives a Hub outage (%i)` case list - it already covers `503, 502, 500, 429, 418`.
   Leave it exactly as is and add `404` to it if anything, but **do not remove any status from it**: this parameterised test is the regression oracle for design point 3, and it must stay green untouched.

### `apps/web/src/auth/__tests__/token.test.ts`

3. Extend `passes the failure classification straight through to the caller` (line 125) to cover `request_refused` as well as `session_expired`, ideally by turning it into an `it.each` over both.
4. Extend `reports a superseded refresh as transient, never as an expired session` (line 161) to run for `request_refused` too.
   A late refusal must be downgraded to `transient`, for the same reason a late `session_expired` is.

### `apps/web/src/auth/__tests__/react.test.tsx`

Add the literal beside the existing ones at line 79-81 and update the doc comment above them from "three shapes" to four:

```ts
const refused: HubTokenResult = { token: null, failure: 'request_refused' };
```

5. `does not enter the ladder when the BFF refuses the refresh request` - in the `session preservation and route restore` describe, modelled on `signs out at once when the BFF says the session expired, without entering the ladder` (line 550).
   - `useLadderTimers()`; `getToken` resolves `ok(token)` once then `refused`.
   - After `readToken(held)`, with **no** timer advance: `expect(vi.getTimerCount()).toBe(0)` - the oracle required by design point 2, and the one the file's own comment (line 542-549) names as the only non-vacuous form.
   - `expect(mocks.cache.getToken).toHaveBeenCalledTimes(2)` - mount read plus probe read; a third would mean a rung ran.
6. `shows a terminal state and stops re-logging in when the BFF refuses the refresh request` - cold start, `getToken.mockResolvedValue(refused)`.
   - `expect(vi.getTimerCount()).toBe(0)`.
   - `expect(mocks.client.login).not.toHaveBeenCalled()` - this is the assertion that pins **3f**, the suppressed redirect loop, and it is the one that reproduces the outage if deleted.
   - `expect(container.textContent).toContain('Não foi possível restabelecer sua sessão')` - asserting the terminal panel is reached, deliberately against the CURRENT copy, so slice 03 has to update exactly one string here when it swaps the component.
   - `expect(sessionStorage.getItem(RETURN_TO_KEY)).toBeNull()` and the login-attempt counter untouched: a refusal must not spend the operator's login budget.
7. `still enters the ladder on a transient failure after a refusal has been observed` - not strictly required, but cheap and it pins that `failSession()` clears the fault: refuse, then remount/recover, then a transient failure, and assert `vi.getTimerCount()` is `1`.

### Regression tests that must stay green and stay non-vacuous

These are not new; they are the slice's guard rails and the executor must confirm each still passes **without editing its body**:

- `keeps the session and enters the ladder when a refresh is transiently unavailable` (line 571) - `503`/`502`/throw stay on the ladder.
- `holds a cold start on a transient failure instead of signing out` (line 596).
- `keeps the signed-in session when a refresh fails transiently once` (line 638).
- `resets the ladder after each recovery, so unrelated blips never accumulate` (line 676) - **design point 4**.
  It drives `SESSION_REVALIDATE_DELAYS_MS.length + 1` blips with a recovery between each and asserts `getToken` was called `1 + blips * 2` times, so it cannot pass vacuously.
  Nothing in this slice touches `revalidateAttempts`, and the reset lines in the success branch are untouched.
- `signs out at once when the BFF says the session expired, without entering the ladder` (line 550) and `signs out at cold start when the BFF says the session expired` (line 624) - the `401` path is byte-identical after this slice.
- `classifies a transient status as transient... (%i)` in `refresh.test.ts` - the parameterised status list.

### Mutation checks (run once each, revert immediately)

Cheap and they are what prove the new tests are not vacuous:

- Change the new `refresh.ts` branch to `return TRANSIENT_TOKEN_RESULT` - tests 1, 5 and 6 go red.
- Delete `sessionRefused` from the auto-login effect guard - test 6 goes red on `mocks.client.login`.
- Delete `setAuthFault(null)` from `failSession()` - test 7 goes red.

## The `401` versus `403` boundary, judged

**The `403` classification stays status-only, and so does the `401`.**

Design point 5 asks whether the new state needs to tell `session_expired` from `no_session`.
It does not, and reading the body would be a regression:

1. **Both `401` bodies end in the same place.** `no_session` means "there is no session"; `session_expired` means "there was and it is dead". The operator's next action is identical - sign in - and slice 03's "not signed in" screen is one screen, not two. A branch with no consumer is exactly what the current comment (lines 65-72) refuses to add.
2. **Slice 03's entitlement states do not come from a `401` at all.** "This account is not entitled" and "this workspace is not entitled" are properties of claims on a token that arrived successfully. A `401` carries no claims, so no body field on a `401` could ever produce them.
3. **Reading the body reintroduces the failure mode the previous slice designed out.** `await res.json()` can reject, and a body-less `401` from a proxy or a load balancer would then have to be classified by a fallback - and the natural fallback (`transient`) is precisely the wrong way round for a dead session.
4. **The same argument settles the `403`.** In 1.3.1 the only body a `403` on this endpoint carries is `{"error":"forbidden"}` from the CSRF guard, with no discriminating field, and a proxy's `403` may be an HTML error page. There is nothing to read.

If a future SDK adds a body-carrying `403` to `/auth/refresh` (it already does on `/auth/switch`, with `code: 'not_a_member'`), the body branch belongs in `refresh.ts` at that point and would split `request_refused` into two variants - which is exactly the change `HubAuthFault` being a union makes cheap.
Record it as a possibility, not as work.

## Verification

Run-once, never in watch mode.

```bash
cd /Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales

# Focused, during the loop
pnpm --filter @fxl-sales/web exec vitest run src/auth/__tests__/refresh.test.ts src/auth/__tests__/token.test.ts src/auth/__tests__/react.test.tsx

# Full gates, before capture
pnpm run lint
pnpm run type-check
pnpm test
pnpm run build
```

`pnpm test` runs `build:packages` first plus the tracked-file guard and the build contract, so it is the authoritative one.
No API test is affected: nothing in `apps/api` changes.

## Risks

1. **Making a genuinely transient `403` permanent.** `v2.7.1`'s own summary notes that an intermediate proxy can answer `403` transiently.
   Judged acceptable: a proxy `403` that clears on its own is far rarer than a misconfiguration that does not, the failure mode is a truthful terminal panel with a retry button rather than a silent sign-out, and the operator's session cookie is untouched, so a single retry recovers fully.
   The previous behaviour - six seconds of silence then a panel blaming the session - is worse in both cases.
2. **The transient set silently shrinking.** The `refresh.ts` `it.each` over `503, 502, 500, 429, 418` is the only thing standing between this slice and design point 3. Do not touch it.
3. **The exhaustiveness `switch` changing `observeToken`'s shape.** The three case bodies must be moved verbatim, comments included; the branch semantics for `session_expired` and `transient` do not change by one character.
4. **A stale `authFault`.** Prevented structurally by the single ordering rule (`failSession()` clears; the refusal branch sets afterwards) plus the `isLoaded && !isSignedIn` prefix on `sessionRefused` plus `setAuthFault(null)` in the success branch. Test 7 pins the first of those.
5. **`useMemo` identity.** `setAuthFault` must be added to the `useMemo` dependency array, and it is stable, so `getToken`'s identity is unaffected. If the executor reaches for a ref instead, `HubProtected` will not re-render on a refusal and the panel will never appear.
6. **CLAUDE.md drift.** Add one bullet under "Auth Model" recording that a `403` on `/auth/refresh` is permanent, that it means the request was refused rather than the session judged, and that `503`/`502`/a network throw remain on the unchanged ladder. Without it the next reader re-derives the wrong classification from the surrounding paragraphs.
