---
id: 01-persist-rotated-hub-session-cookie
milestone: v2.8.0
status: todo
depends_on: []
files_modified:
  - apps/api/src/auth/hub-rotated-cookie.ts
  - apps/api/src/auth/__tests__/hub-rotated-cookie.test.ts
  - apps/api/src/middleware/app-auth.ts
  - apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts
acceptance: "given the Hub rotates the session cookie as __Host-fxl_hub_session, when the BFF handles POST /auth/refresh or /auth/switch, then the session store persists the rotated refresh token"
goal: Make the BFF persist the Hub's rotated refresh token when the cookie carries the production __Host- prefix.
must_not_break:
  - the unprefixed fxl_hub_session rotation path used in local development
  - the browser-facing session cookie the BFF sets (secureCookies)
  - the trusted-origin shim in apps/api/src/auth/hub-bff-origin.ts
  - every existing test in apps/api
rules:
  - do not modify apps/api/src/auth/hub-session-store.ts
  - do not add a pnpm patch or patchedDependencies
  - no em dashes anywhere
verifier_focus: that the end-to-end oracle genuinely drives the real SDK refresh handler and fails when the wiring is removed, rather than only unit-testing the regex
---

# 01 - Persist the rotated Hub session cookie

## Context

In production every FXL Sales session dies about two minutes after login.
The measured chain is in `nexo/runs/feature-20260812-session-survives-one-refresh/evidence.md` and the frame is in `00-OVERVIEW.md`.
This slice fixes root cause A, which is the whole of the defect; slices 02 to 04 fix the two damage amplifiers on the web side.

The Hub's auth service runs with `NODE_ENV=production`, so on every successful refresh it rotates the session cookie as
`Set-Cookie: __Host-fxl_hub_session=<rotated>; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=...`.
Outside production it sends the unprefixed `fxl_hub_session=`, which is why this is invisible locally and always was.

`@fxl-business/hub-sdk@1.3.1` recovers the rotated refresh token from exactly one expression, and only from the response header.
The rotated token never appears in the JSON body, and `isRefreshSuccess` validates only `{accessToken, expiresIn}`, so nothing else can recover it.

The consequence is a silent write loss.
`rotated` is `undefined`, `tx.update` is never called, Postgres keeps the refresh token that was just spent, and the BFF still answers `200`.
The Hub forgives exactly one stale generation for 60 seconds (`HUB_SESSION_GRACE_SECONDS`), so the first replay is forgiven, the second trips `reuse_detected`, and the Hub revokes the whole token family.
Against a 120 second access token and a 60 second renewal lead, that is one dead session every one to three minutes, for every user.

`apps/api/src/auth/hub-session-store.ts` is correct and is deployed.
It is simply never called on the rotation path.
This slice does not touch it.

### Verified facts this plan is built on

All read out of the installed 1.3.1 tarball at
`node_modules/.pnpm/@fxl-business+hub-sdk@1.3.1_hono@4.12.28/node_modules/@fxl-business/hub-sdk/dist/server.js`, and all re-verified by running the shapes below on this machine's Node 22.

- `dist/server.js:275-278` declares `SESSION_COOKIE = "fxl_hub_session"`, `SESSION_COOKIE_SECURE = "__Host-fxl_hub_session"`, `LOGIN_TX_COOKIE = "fxl_hub_login"` and `BACKCHANNEL_COOKIE_NAME = SESSION_COOKIE`.
  The last one matters: the cookie the SDK SENDS to the Hub is always the unprefixed name, in both modes.
  The asymmetry this slice fixes is entirely on the RESPONSE.
- `dist/server.js:299-303` is `parseRotatedRefresh`, whose regex is `/(?:^|[,\s])fxl_hub_session=([^;]+)/`.
  A `__Host-` prefix leaves the name preceded by `-`, which is neither `^` nor `[,\s]`, so the regex cannot match.
- The SAME two lines appear twice: `dist/server.js:463-464` inside `POST /auth/refresh` and `dist/server.js:518-519` inside `POST /auth/switch`.
  A workspace switch that loses its rotation kills the session exactly like a refresh that does, so this slice must cover both routes and both must be pinned.
- `dist/server.js:317` is `const fetchImpl = options.fetchImpl ?? fetch;`, and `fetchImpl` is a documented option on `HubBffOptions` (`dist/server.d.ts:32`).
  Both handlers call it directly on `${base}/auth/refresh?productId=...` and `${base}/auth/switch`, with no `discover()` hop in between.
- The SDK wraps its `fetchImpl` call in `try { ... } catch { return { status: 503, body: { error: "refresh_unavailable" }, clear: false }; }`.
  A throw out of the wrapper therefore becomes a visible transient 503 with the stored session untouched, never a silent stale-token success.
- `Headers.prototype.getSetCookie` exists on Node 18.14 and newer (undici 5.19+), so it is present on Node 20, which is the floor declared by root `package.json` `engines` and by `apps/api/Dockerfile` (`FROM node:20-alpine`).
  TypeScript 5.9's `lib.dom.d.ts` types it as a required `getSetCookie(): string[]`, and `apps/api` compiles with `lib: ["ES2022","DOM","DOM.Iterable"]`, so no type shim is needed.
- Measured on Node 22: `new Headers(res.headers)` preserves every `set-cookie` entry separately, `delete('set-cookie')` clears all of them, `append` re-adds them separately, and `headers.get('set-cookie')` then joins them with `", "`.
  A cookie containing a comma inside `Expires=Wed, 21 Oct 2026 07:28:00 GMT` still leaves the following cookie name preceded by a space, so the SDK's regex finds it.
  A null-body status yields `res.body === null`, so re-wrapping a 204 does not throw.
- `apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts` stubs `withSession` to return a canned `REFRESH_OK = { status: 200, body: { ok: true }, clear: false }` (line 53), so the SDK's real refresh handler, the Hub round trip and the rotation write have never executed in any test in this repository.
  Every other rotation test calls `handle.update(...)` directly.
  That gap is what let this ship, and closing it is the larger half of this slice.

## Scope

Exactly four files.
Nothing else is touched: not `hub-session-store.ts`, not `pnpm-workspace.yaml`, not `package.json`, not the access-token TTL, not `SESSION_RENEWAL_LEAD_MS`, not `CLAUDE.md` and not `nexo/ROADMAP.md`.
The `CLAUDE.md` Auth Model sentence and the upstream-SDK ROADMAP entry belong to the feature's capture step, not to this slice.

1. `apps/api/src/auth/hub-rotated-cookie.ts` - new module, the wrapper.
2. `apps/api/src/auth/__tests__/hub-rotated-cookie.test.ts` - new unit oracle for the wrapper itself.
3. `apps/api/src/middleware/app-auth.ts` - one option added to `createHubBff`, plus its comment.
4. `apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts` - the end-to-end oracle against the real SDK handler.

## The module: `apps/api/src/auth/hub-rotated-cookie.ts`

This is the intended content in full.
Adapt wording, not structure or behaviour.

```ts
/**
 * The rotated-session-cookie shim in front of the Hub BFF's BACKCHANNEL fetch.
 *
 * Sibling of `hub-bff-origin.ts`, and the same pattern for the same reason: a
 * small, reversible correction wrapped around the SDK, fully inside this
 * application, instead of a patched dependency. Read that file first if this one
 * is new to you.
 *
 * WHAT BREAKS WITHOUT IT
 *
 * On every successful `POST /auth/refresh` and `POST /auth/switch` the Hub
 * rotates the session's refresh token and returns the new one in a `Set-Cookie`
 * RESPONSE header. `@fxl-business/hub-sdk@1.3.1` recovers it with exactly one
 * expression, at `dist/server.js:463` and again at `518`:
 *
 *   const rotated = parseRotatedRefresh(res.headers.get("set-cookie"));
 *   if (rotated) await tx.update({ ...record, hubRefreshToken: rotated });
 *
 * and `parseRotatedRefresh` (`dist/server.js:299`) is
 *
 *   /(?:^|[,\s])fxl_hub_session=([^;]+)/
 *
 * When the Hub runs with `NODE_ENV=production` it names that cookie
 * `__Host-fxl_hub_session`. The character before the name is then `-`, which is
 * neither `^` nor `[,\s]`, so the regex misses, `rotated` is `undefined`,
 * `tx.update` is never called, and Postgres keeps the refresh token that was
 * just spent. The BFF still answers 200, so the loss is completely silent.
 *
 * The Hub forgives one stale generation for 60 seconds. The BFF then replays the
 * same original token on every cycle, so the second replay trips
 * `reuse_detected` and the Hub revokes the whole token family. Against a 120s
 * access token renewed at `exp - 60s`, that is one dead session every one to
 * three minutes, for every user, measured on 2026-08-12. See
 * `nexo/runs/feature-20260812-session-survives-one-refresh/evidence.md`.
 *
 * Locally the Hub sends the unprefixed name and the SDK's regex matches, which
 * is exactly why three rounds of browser-side fixes never touched this.
 *
 * WHAT THIS DOES
 *
 * It wraps the `fetchImpl` the BFF uses to call the Hub, and rewrites only the
 * NAME of a `__Host-fxl_hub_session` response cookie back to `fxl_hub_session`
 * before the SDK reads the header. The value, the attributes, every other
 * cookie, the status, the body and every other header are untouched.
 *
 * BACKCHANNEL, NOT BROWSER. DO NOT MERGE THIS WITH `secureCookies`.
 *
 * Two different cookies share these two names and they travel in opposite
 * directions:
 *
 *   - the BROWSER cookie the BFF sets on its OWN response. Its name is chosen by
 *     `secureCookies` in `app-auth.ts` and is `__Host-` prefixed in production.
 *     It carries a session ID, never a refresh token. This module never sees it
 *     and must never touch it: stripping that prefix on the browser side would
 *     drop a real security attribute.
 *   - the HUB cookie on the response to the BFF's own OUTBOUND call. It carries
 *     the rotated REFRESH TOKEN, it never reaches a browser, and it is the only
 *     thing rewritten here.
 *
 * The request the SDK sends the Hub already uses the unprefixed name in both
 * modes (`BACKCHANNEL_COOKIE_NAME = SESSION_COOKIE`, `dist/server.js:278`), so
 * the asymmetry corrected here is entirely on the response.
 *
 * WHY NOT A pnpm PATCH
 *
 * `patchedDependencies` was deleted from this workspace once already and must
 * not come back: a patch is invisible at the call site, silently re-applies to
 * an unrelated future version, and cannot be tested by anything in `src/`.
 * `fetchImpl` is a documented SDK option (`dist/server.d.ts:32`), so this is a
 * supported seam rather than a workaround.
 *
 * WHY THE RESPONSE IS REBUILT RATHER THAN MUTATED
 *
 * Headers on a `Response` produced by `fetch` are guarded immutable, so
 * `headers.set` throws. The response is therefore rebuilt with a copied, mutable
 * `Headers`, exactly as `hub-bff-origin.ts` rebuilds the REQUEST for the same
 * class of reason. The body is MOVED, not buffered: this wrapper never reads it,
 * the SDK consumes the returned response exactly once with `res.json()`, and
 * buffering would add a full body read inside the row-lock transaction and
 * inside the 5s `timeoutMs` budget for no gain. A null-body status carries
 * `res.body === null` already, but the explicit guard below keeps a future 204
 * from throwing in the `Response` constructor. The rebuild drops `res.url`,
 * `res.redirected` and `res.type`; the SDK reads none of them, and it only
 * happens on the rewrite path.
 *
 * WHY THERE IS NO SILENT FALLBACK
 *
 * An earlier sketch of this module read
 * `typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []`.
 * That is the one shape this module may never have: on a runtime without
 * `getSetCookie` it yields an empty list, the wrapper returns the response
 * untouched, and the exact silent write loss this file exists to eliminate comes
 * back with a green test suite. Degrading quietly into the defect is worse than
 * failing. So a missing `getSetCookie` is treated as a programming error:
 * `assertSetCookieSupport()` runs once at module load and stops the process
 * before any traffic, and the per-response check throws. A throw out of the
 * wrapper is caught by the SDK's own `try/catch` around `fetchImpl` and becomes
 * `503 refresh_unavailable` with the stored session untouched, which the web
 * ladder reads as transient. That is loud and recoverable; a stale token
 * answered 200 is neither. The assertion is unreachable in every environment
 * this ships to (Node 20 floor in root `package.json` `engines` and in
 * `apps/api/Dockerfile`), and it is reachable in a test only because it takes
 * its probe as an argument.
 *
 * WHY IT STAYS CORRECT IF THE SDK IS EVER FIXED
 *
 * The upstream fix filed in `nexo/ROADMAP.md` makes `parseRotatedRefresh` accept
 * `(?:__Host-)?fxl_hub_session=`. A name this wrapper has already rewritten
 * still matches that regex, and the VALUE is what the SDK uses, so the outcome
 * is identical with or without the shim. Iterating `getSetCookie()` upstream
 * would also be fine: the same cookies come back in the same order, with one
 * name differing. When the fixed SDK lands, the non-vacuity test named
 * `proves the rotation is genuinely lost without the wrapper` goes RED, and that
 * is the signal that this module can be deleted.
 */

/** The name `parseRotatedRefresh` is hard-coded to. No regex metacharacters, so no escaping. */
const ROTATED_COOKIE = 'fxl_hub_session';

/**
 * Anchored and exact, so only the one production name is rewritten.
 * `__Secure-fxl_hub_session=`, `__Host-fxl_hub_session_v2=`, `x__Host-fxl_hub_session=`
 * and `fxl_hub_login=` all miss, deliberately.
 */
const PREFIXED_ROTATED_COOKIE = new RegExp(`^__Host-${ROTATED_COOKIE}=`);

const UNPREFIXED_ASSIGNMENT = `${ROTATED_COOKIE}=`;

/** `new Response(body, { status })` throws for these unless the body is null. */
const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

/**
 * Loud at load time rather than silent at request time. See the header: an empty
 * list on a runtime without `getSetCookie` would reinstate the defect invisibly.
 * The probe is a parameter purely so the failure branch is testable.
 */
export function assertSetCookieSupport(probe: { getSetCookie?: unknown } = Headers.prototype): void {
  if (typeof probe.getSetCookie !== 'function') {
    throw new Error(
      'hub-rotated-cookie: this runtime has no Headers.prototype.getSetCookie, so a rotated Hub session cookie cannot be read per cookie. Node 20 or newer is required (root package.json engines, apps/api/Dockerfile node:20-alpine).',
    );
  }
}

assertSetCookieSupport();

function readSetCookies(res: Response): string[] {
  const headers: { getSetCookie?: unknown } = res.headers;
  if (typeof headers.getSetCookie !== 'function') {
    throw new Error(
      'hub-rotated-cookie: the Hub response carried a Headers without getSetCookie. Refusing to guess, because guessing here means silently losing a rotated refresh token.',
    );
  }
  return res.headers.getSetCookie();
}

/**
 * Wraps a fetch so the SDK's rotation parser can see a `__Host-` prefixed Hub
 * session cookie. Pass nothing to wrap the ambient global fetch, which is also
 * what `createHubBff` itself defaults to (`dist/server.js:317`).
 */
export function createHubRotatedCookieFetch(inner?: typeof fetch): typeof fetch {
  return async (input, init) => {
    // Resolved per call, never captured: `const f = inner ?? fetch` at
    // construction time would freeze whatever global fetch existed then, which
    // both hides a runtime `fetch` swap and makes the wiring untestable.
    const res = inner ? await inner(input, init) : await globalThis.fetch(input, init);

    const cookies = readSetCookies(res);
    let changed = false;
    const rewritten = cookies.map((cookie) => {
      const next = cookie.replace(PREFIXED_ROTATED_COOKIE, UNPREFIXED_ASSIGNMENT);
      if (next !== cookie) changed = true;
      return next;
    });
    // The common path, including every dev-mode response and every response with
    // no Set-Cookie at all: the ORIGINAL object goes back, with no Headers copy,
    // no Response allocation and no observable difference of any kind.
    if (!changed) return res;

    const headers = new Headers(res.headers);
    headers.delete('set-cookie');
    for (const cookie of rewritten) headers.append('set-cookie', cookie);

    return new Response(NULL_BODY_STATUS.has(res.status) ? null : res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  };
}
```

### Design points, settled

- **Its own module, with the heavy header above.**
  `hub-bff-origin.ts` is the established precedent for a shim in front of the SDK and this is its sibling.
  Inlining a closure in `app-auth.ts` would put the reasoning nowhere and would leave the wrapper untestable in isolation.
- **The default `fetchImpl`.**
  `createHubBff` defaults to global fetch, and so does the wrapper, resolved through `globalThis.fetch` at CALL time.
  This is not a style choice: the end-to-end oracle stubs `globalThis.fetch` after `createAppAuthBff()` has already run, and a binding captured at construction would make that oracle impossible to write and would silently pin the wrong function in any future runtime that swaps fetch.
- **Only the exact `__Host-fxl_hub_session` name is rewritten.**
  The regex is anchored at `^` and terminated by `=`, so no other cookie can be caught, including `fxl_hub_login`.
  A broad rewrite would be a real hazard, because the wrapper sits on the only channel that carries live credentials.
- **A no-op returns the ORIGINAL object.**
  `changed` is computed during the same `map` that produces the rewrite, so the common dev path costs one array copy of a usually empty array and returns the identical `Response` reference.
  This is asserted with `toBe`, not merely with equality, so a future refactor that always rebuilds is caught.
- **Streaming re-wrap, not buffering.**
  Stated and justified in the header: the wrapper never reads the body, so handing `res.body` to the new `Response` moves the stream rather than copying it; the SDK reads the result exactly once; buffering would add a full body read inside the row-lock transaction and inside the 5s timeout, and would break null-body statuses.
- **Backchannel only.**
  Spelled out at length in the header so nobody later folds this together with `secureCookies`.
  The end-to-end oracle also pins it behaviourally: the BFF's browser-facing response must carry no `Set-Cookie` at all on a successful refresh.
- **Harmless once upstream is fixed**, with an explicit retirement signal, as described in the header.
- **No silent fallback**, as described in the header: a boot-time assertion plus a per-response throw, never an empty list.

## The wiring: `apps/api/src/middleware/app-auth.ts`

Add the import beside the existing auth imports, keeping alphabetical order with `hub-login-scope.js`:

```ts
import { createHubRotatedCookieFetch } from '../auth/hub-rotated-cookie.js';
```

Then one option inside `createHubBff`, immediately after `sessionStore`:

```ts
  const bff = createHubBff(hubSdkConfig, {
    sessionStore: session.store,
    // The BACKCHANNEL fetch, not the browser cookie below. In production the Hub
    // rotates the session cookie as `__Host-fxl_hub_session`, which the SDK's
    // `parseRotatedRefresh` regex cannot match, so the rotated refresh token was
    // dropped on every /auth/refresh and every /auth/switch while the BFF still
    // answered 200 - and the Hub revoked the family on the second replay. See
    // hub-rotated-cookie.ts. This has nothing to do with `secureCookies`.
    fetchImpl: createHubRotatedCookieFetch(),
    secureCookies,
    timeoutMs: HUB_BFF_TIMEOUT_MS,
    ...
```

Nothing else in the file changes.
`requireHubAuth` also accepts a `fetchImpl` (for JWKS) and is deliberately left alone: it reads no cookies.

Applying the wrapper to every BFF outbound call, not only the two rotating ones, is intentional and inert.
`/auth/callback`'s token exchange reads `access_token` and `refresh_token` out of the JSON BODY and never looks at `Set-Cookie`, and `discover()` reads JSON only, so the rewrite cannot change either outcome.
One wrapper with no route condition is simpler than a conditional one and cannot be wired to the wrong subset.

## The oracle

### A. Unit oracle: `apps/api/src/auth/__tests__/hub-rotated-cookie.test.ts`

New file, in the style of `hub-bff-origin.test.ts`, with a header comment naming the production defect.
No SDK import is needed here; the wrapper is driven with a fake `inner`.

Shared helpers:

```ts
import { describe, expect, it, vi } from 'vitest';
import { assertSetCookieSupport, createHubRotatedCookieFetch } from '../hub-rotated-cookie.js';

/** The SDK's own parser, copied verbatim from 1.3.1 dist/server.js:300. */
const SDK_ROTATION_REGEX = /(?:^|[,\s])fxl_hub_session=([^;]+)/;
/** The upstream fix filed in nexo/ROADMAP.md, for the forward-compatibility pin. */
const FIXED_SDK_ROTATION_REGEX = /(?:^|[,\s])(?:__Host-)?fxl_hub_session=([^;]+)/;

const PROD_ROTATION = '__Host-fxl_hub_session=RT2; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000';
const DEV_ROTATION = 'fxl_hub_session=RT2; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000';
const UNRELATED = 'hub_edge=iad1; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT';

function hubResponse(setCookies: readonly string[], status = 200): Response {
  const headers = new Headers({ 'content-type': 'application/json' });
  for (const cookie of setCookies) headers.append('set-cookie', cookie);
  return new Response(JSON.stringify({ accessToken: 'AT2', expiresIn: 120 }), {
    status,
    statusText: 'OK',
    headers,
  });
}

function rotatedTokenTheSdkWouldSee(res: Response): string | undefined {
  return SDK_ROTATION_REGEX.exec(res.headers.get('set-cookie') ?? '')?.[1];
}
```

Exact test names, all inside `describe('hub rotated session cookie fetch wrapper', ...)`:

1. `renames __Host-fxl_hub_session so the SDK rotation regex can see the token`
   Drive with `[PROD_ROTATION]`; assert `rotatedTokenTheSdkWouldSee(out)` is `'RT2'`.
2. `keeps every other Set-Cookie byte-identical and in order`
   Drive with `[UNRELATED, PROD_ROTATION]`; assert `out.headers.getSetCookie()` equals `[UNRELATED, PROD_ROTATION.replace('__Host-', '')]`.
3. `finds the rotated token even when an earlier cookie carries a comma`
   Same input as 2, asserting through `rotatedTokenTheSdkWouldSee`.
   `Expires=Wed, 21 Oct 2026 ...` is what makes the joined header ambiguous, and this is why the wrapper works per cookie instead of on the joined string.
4. `returns the original Response object untouched when nothing matched`
   Drive with `['hub_edge=iad1; Path=/']`; assert `out` `toBe` the response the inner fetch returned.
5. `returns the original Response object untouched when there is no Set-Cookie at all`
   Same, with `[]`.
6. `leaves an already unprefixed fxl_hub_session alone`
   Drive with `[DEV_ROTATION]`; assert identity with `toBe` and that the token is still `'RT2'`.
7. `does not rewrite a cookie whose name merely resembles the session cookie`
   Drive with `['__Secure-fxl_hub_session=X; Path=/', '__Host-fxl_hub_session_v2=Y; Path=/', 'x__Host-fxl_hub_session=Z; Path=/', '__Host-fxl_hub_login=W; Path=/']`; assert identity with `toBe`.
8. `preserves status, statusText, other headers and the body on the rewrite path`
   Drive with `[PROD_ROTATION]` at status 200; assert `out).not.toBe(res)`, `out.status === 200`, `out.statusText === 'OK'`, `out.headers.get('content-type') === 'application/json'`, and `await out.json()` equals `{ accessToken: 'AT2', expiresIn: 120 }`.
9. `passes input and init through to the inner fetch unchanged`
   Capture `(input, init)` in the fake inner; assert the URL string and that `init` is the SAME object reference (`toBe`), carrying the `AbortSignal` the SDK attaches.
10. `resolves the ambient global fetch at call time when no inner fetch is given`
    Build the wrapper FIRST, then `vi.stubGlobal('fetch', ...)`, then call it, then `vi.unstubAllGlobals()` in a `finally`.
    This is the no-stale-binding oracle, and it is the same mechanism the end-to-end oracle depends on.
11. `stays correct if the SDK parser is fixed to accept both names`
    Drive with `[PROD_ROTATION]`; assert the rewritten header matches BOTH `SDK_ROTATION_REGEX` and `FIXED_SDK_ROTATION_REGEX` with the same captured `'RT2'`.
12. `throws rather than silently skipping when a response carries a Headers without getSetCookie`
    Fake inner returns an object shaped like a response whose `headers` is `{ get: () => null }`, cast through `as unknown as Response`; assert the call rejects with `/getSetCookie/`.
    A silent `[]` here would reinstate the defect, which is the whole point.
13. `refuses to load on a runtime whose Headers has no getSetCookie`
    `expect(() => assertSetCookieSupport({})).toThrow(/Node 20/)`.
14. `accepts the real Headers of the runtime this ships to`
    `expect(() => assertSetCookieSupport()).not.toThrow()`.
    This is the pin on the "unreachable in production" assumption, so a runtime downgrade fails a test instead of a deploy.

### B. End-to-end oracle: `apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts`

This is the important half and the `verifier_focus`.
It reuses the existing harness in that file: `beforeAll` already builds the REAL `createAppAuthBff()` with the durable store, with `createHubBff` delegating to the actual SDK.
Nothing in the existing setup changes except three additions.

**Addition 1.** Extend `CapturedBffOptions` with `fetchImpl?: unknown;`.

**Addition 2.** Extend `afterAll` with `vi.unstubAllGlobals();`.

**Addition 3.** Three helpers plus two new `describe` blocks.

```ts
import type { HubSessionRecord, HubSessionTransaction } from '@fxl-business/hub-sdk';

const HUB_ROTATION_PROD = '__Host-fxl_hub_session=RT2; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000';
const HUB_ROTATION_DEV = 'fxl_hub_session=RT2; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000';
const HUB_UNRELATED = 'hub_edge=iad1; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT';
const HUB_REFRESH_BODY = { accessToken: 'AT2', expiresIn: 120 };
const HUB_SWITCH_BODY = { accessToken: 'AT3', expiresIn: 120, workspace: { id: 'ws-2', name: 'Segunda' } };

type RecordedCall = { op: 'get' | 'update' | 'delete'; token?: string };

/**
 * A recording, in-memory stand-in for ONE durable transaction. It honours the
 * withSession contract the SDK is written against - a single transaction object,
 * `get` first, `update` writing through - so the SDK's real handler runs its
 * whole read-modify-write with no database.
 */
function recordingSession(initialToken = 'RT1') {
  const calls: RecordedCall[] = [];
  let record: HubSessionRecord | null = {
    hubRefreshToken: initialToken,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    absoluteExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  };
  const tx: HubSessionTransaction = {
    get: async () => {
      calls.push({ op: 'get' });
      return record;
    },
    update: async (next) => {
      calls.push({ op: 'update', token: next.hubRefreshToken });
      record = next;
    },
    delete: async () => {
      calls.push({ op: 'delete' });
      record = null;
    },
  };
  return { calls, tx, stored: () => record?.hubRefreshToken ?? null };
}

/** Points the DURABLE store's withSession at that transaction, so no Postgres is reached. */
function useRecordingSession(session: ReturnType<typeof recordingSession>) {
  return vi
    .spyOn(requireDurableStore(), 'withSession')
    .mockImplementation(((_id: string, operation: (tx: HubSessionTransaction) => Promise<unknown>) =>
      operation(session.tx)) as never);
}

/** The fake Hub. Production shape: multiple Set-Cookie headers, the rotation `__Host-` prefixed. */
function stubHub(setCookies: readonly string[], body: unknown, status = 200) {
  const seen: string[] = [];
  vi.stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    seen.push(String(input));
    const headers = new Headers({ 'content-type': 'application/json' });
    for (const cookie of setCookies) headers.append('set-cookie', cookie);
    return new Response(JSON.stringify(body), { status, headers });
  }) as typeof fetch);
  return seen;
}
```

A note the executor must keep as a comment in the test file, because it is the first thing a reviewer will challenge:
this file stubs `NODE_ENV=test`, so `secureCookies` is false and the BFF reads the browser's session id from the unprefixed request cookie.
That is correct and does not weaken the oracle.
The defect is in how the SDK parses the Hub's RESPONSE, and the SDK's response parser is the same code in both modes.
The request-side `__Host-` behaviour is already pinned separately by the existing test `reads the __Host- session cookie when secureCookies is on`.

Exact test names, in a new `describe('createAppAuthBff rotated Hub session cookie, against the real SDK handlers', ...)`:

1. `persists the rotated refresh token when the Hub rotates __Host-fxl_hub_session on /auth/refresh`
   THE oracle.
   `stubHub([HUB_UNRELATED, HUB_ROTATION_PROD], HUB_REFRESH_BODY)`, `POST /auth/refresh` with `cookie: 'fxl_hub_session=session-alpha'`, then assert
   `session.calls` equals `[{ op: 'get' }, { op: 'update', token: 'RT2' }]`,
   `session.stored()` is `'RT2'`,
   and that the Hub was called once on a URL containing `/auth/refresh`.
2. `persists the rotated refresh token when the Hub rotates __Host-fxl_hub_session on /auth/switch`
   Same, with `stubHub([HUB_UNRELATED, HUB_ROTATION_PROD], HUB_SWITCH_BODY)` and
   `POST /auth/switch` carrying `content-type: application/json` and `JSON.stringify({ workspaceId: 'ws-2' })`.
   `isSwitchSuccess` needs `workspace.id`, which `HUB_SWITCH_BODY` provides, so the route answers 200 as well.
3. `still persists the rotated refresh token when the Hub sends the unprefixed fxl_hub_session`
   The dev-mode no-regression pin: `[HUB_ROTATION_DEV]` must also end in `update(RT2)`.
4. `does not write to the session when the Hub sends no Set-Cookie at all`
   `stubHub([], HUB_REFRESH_BODY)`; assert `session.calls` equals `[{ op: 'get' }]`, `session.stored()` is `'RT1'`, and the route still answers 200 without throwing.
5. `answers the accessToken and status the SDK produced, unchanged by the wrapper`
   Assert `res.status === 200` and `await res.json()` equals `HUB_REFRESH_BODY`.
6. `does not leak the Hub's Set-Cookie headers to the browser`
   On the same successful refresh, assert `res.headers.getSetCookie()` is `[]`.
   This is the behavioural form of the backchannel-versus-browser rule: the rotated token must never appear on a response to the browser.
7. `hands createHubBff a wrapped fetchImpl rather than the bare global fetch`
   `expect(bffOptions?.fetchImpl).toBeDefined()` and `expect(bffOptions?.fetchImpl).not.toBe(globalThis.fetch)`.
   Weak on its own, deliberately kept: it fails with a one-line diagnosis if someone deletes the option, before test 1 fails with a longer one.

And, in a second `describe('the SDK rotation defect this wrapper exists for', ...)`, the non-vacuity control, following the `proves the guard is real by 403ing that same request without the shim` precedent in `hub-bff-origin.test.ts`:

8. `proves the rotation is genuinely lost without the wrapper, through the same real SDK handler`
   Build a bare `actual.createHubBff(config, { sessionStore: probe, fetchImpl: <the UNWRAPPED fake Hub> })` where `probe` is a `HubSessionStore` whose `withSession` delegates to a fresh `recordingSession()` and whose other three methods are stubs.
   Drive the same `POST /auth/refresh`, assert the status is `200` and the calls are `[{ op: 'get' }]` with `stored()` still `'RT1'`.
   If this ever goes green with an `update`, the SDK was fixed upstream and this whole module can be deleted.

Every test restores its spy and its global stub in a `finally`, exactly as the existing tests in that file do.

### Why this oracle is the one that matters

It runs the REAL `createHubBff` handler, through the REAL `createAppAuthBff()` router and its origin shim, with the REAL wrapper wired the way production wires it.
The only fakes are the Hub itself and the transaction body.
Test 1 fails on current `main` for the right reason: without `fetchImpl: createHubRotatedCookieFetch()` in `app-auth.ts`, the SDK's regex never matches, `tx.update` is never called, `session.calls` is `[{ op: 'get' }]` and the assertion on `'RT2'` fails while the route still answers 200 - which is exactly the production symptom, reproduced.

## Execution order

1. Re-read `apps/api/src/auth/hub-bff-origin.ts` for the header style, and confirm `dist/server.js:299-303`, `463-464` and `518-519` still read as quoted above.
   If the installed SDK has moved, stop and re-plan: the line numbers are cited in the module header.
2. Write `apps/api/src/auth/hub-rotated-cookie.ts`.
3. Write `apps/api/src/auth/__tests__/hub-rotated-cookie.test.ts` and get all 14 green.
4. Add the two lines to `apps/api/src/middleware/app-auth.ts`.
5. Add the helpers and the two `describe` blocks to `apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts`.
6. Prove the oracle is real: comment out the `fetchImpl:` line in `app-auth.ts`, run the wiring test, confirm tests 1, 2, 3 and 7 go RED and that test 8 stays green, then restore the line and confirm everything is green again.
   Record that red output in the run notes; the verifier will ask for it.
7. Full gate.

## Commands

```bash
# the wrapper's own oracle
pnpm --filter @fxl-sales/api exec vitest run src/auth/__tests__/hub-rotated-cookie.test.ts

# THE oracle
pnpm --filter @fxl-sales/api exec vitest run src/middleware/__tests__/app-auth-bff-wiring.test.ts

# the whole API unit suite (integration is a separate script and is untouched here)
pnpm --filter @fxl-sales/api test

# the gate
pnpm run lint
pnpm run type-check
pnpm test
```

`pnpm --filter @fxl-sales/api test` is unit only by `vitest.config.ts` (`include: ['src/**/__tests__/**/*.test.ts']`), and no database is reached by anything this slice adds.
`pnpm --filter @fxl-sales/api test:integration` needs no change and must stay green if it is run.

## Anticipated challenges

- **`vi.spyOn(store, 'withSession').mockImplementation(...)` and generics.**
  `withSession<T>` is generic over the operation's return, and the mock cannot express that.
  The existing file already casts with `as never` for exactly this reason; follow that precedent rather than widening any type.
- **`@typescript-eslint/no-explicit-any` is an error in `apps/api`.**
  Use `unknown` plus a narrow cast, never `any`, in both new files.
- **`noUnusedLocals` is on.**
  Every constant sketched above is used; do not add a `__Host-` constant that only appears in a comment.
- **`vi.stubGlobal('fetch', ...)` must be undone.**
  Per test in a `finally`, and once more in `afterAll`.
  A leaked fetch stub makes an unrelated later test fail in a way that reads as a different bug.
- **Do not stub global fetch around `/auth/login` or `/auth/callback`.**
  Those routes call `discover()`, which would hit the fake Hub and answer nonsense.
  The new tests touch only `/auth/refresh` and `/auth/switch`, which call `fetchImpl` directly.
- **The origin shim is in the path.**
  The new requests send no `Origin` header, so the shim hands them straight to `bff.fetch(raw)` and the body is not consumed twice.
  Do not add an `Origin` header to the switch test.
- **`res.body` reuse.**
  Never read the body inside the wrapper, not even for logging.
  One read is all there is, and the SDK owns it.

## Out of scope

- `apps/api/src/auth/hub-session-store.ts`. It is correct, and this slice proves it by finally calling it.
- Any `pnpm patch` or `patchedDependencies` entry.
- The access-token TTL and `SESSION_RENEWAL_LEAD_MS`. Once rotation persists, a 60 second renewal cadence is correct behaviour.
- The upstream SDK fix in `16--INTERNAL--fxl-hub`, and the `nexo/ROADMAP.md` and `CLAUDE.md` entries that record it. Those belong to the feature's capture step.
- Amplifiers B and C, which are slices 02, 03 and 04 and touch only `apps/web`.
