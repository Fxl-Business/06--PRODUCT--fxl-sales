# Verify report - slice 01, persist the rotated Hub session cookie

- Branch under test: `fix/01-persist-rotated-hub-session-cookie`
- Verified against: `master`
- Date: 2026-08-12
- Verdict: **PASS**, with one minor non-blocking finding (em dashes in a framing doc, see point 7).

The acceptance criterion under test:

> Given the Hub rotates the session cookie as `__Host-fxl_hub_session`, when the BFF handles `POST /auth/refresh` or `POST /auth/switch`, then the session store persists the rotated refresh token.

I did not read `slice-01-notes.md`.
Every result below is from a command I ran myself in this session.

## 1. The gate, run first-hand

All run-once, no watchers.

| Command | Result |
| --- | --- |
| `pnpm --filter @fxl-sales/api exec vitest run src/auth/__tests__/hub-rotated-cookie.test.ts` | 14 passed (1 file) |
| `pnpm --filter @fxl-sales/api exec vitest run src/middleware/__tests__/app-auth-bff-wiring.test.ts` | 22 passed (1 file) |
| `pnpm --filter @fxl-sales/api test` | 415 passed, 41 files |
| `pnpm run lint` | api Done, web Done |
| `pnpm run type-check` | shared-types, shared-utils, api, web all Done |
| `pnpm test` (root, from the plan's gate) | api green, web 663 passed / 49 files, `build-contract: ok` |

```
 ✓ src/auth/__tests__/hub-rotated-cookie.test.ts (14 tests) 7ms
 Test Files  1 passed (1)
      Tests  14 passed (14)

 ✓ src/middleware/__tests__/app-auth-bff-wiring.test.ts (22 tests) 150ms
 Test Files  1 passed (1)
      Tests  22 passed (22)

 Test Files  41 passed (41)
      Tests  415 passed (415)
```

## 2. THE CENTRAL QUESTION: is the end-to-end oracle vacuous?

**It is not vacuous. The rotation oracles bite, and I proved it twice, with the second experiment being the load-bearing one.**

### 2a. The prescribed mutation: comment out `fetchImpl:`

I commented out line 226 of `apps/api/src/middleware/app-auth.ts` and re-ran the wiring test.
**7 of 22 tests went red**, including both rotation oracles:

```
 × ... persists the rotated refresh token when the Hub rotates __Host-fxl_hub_session on /auth/refresh
     -> expected [ { op: 'get' }, { op: 'delete' } ] to deeply equal [ { op: 'get' }, ...(1) ]
 × ... persists the rotated refresh token when the Hub rotates __Host-fxl_hub_session on /auth/switch
     -> expected 401 to be 200
 × ... still persists the rotated refresh token when the Hub sends the unprefixed fxl_hub_session
     -> expected [ { op: 'get' }, { op: 'delete' } ] to deeply equal [ { op: 'get' }, ...(1) ]
 × ... does not write to the session when the Hub sends no Set-Cookie at all
     -> expected 401 to be 200
 × ... answers the accessToken and status the SDK produced, unchanged by the wrapper
     -> expected 401 to be 200
 × ... does not leak the Hub Set-Cookie headers to the browser
     -> expected [ "fxl_hub_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax" ] to deeply equal []
 × ... hands createHubBff a wrapped fetchImpl rather than the bare global fetch
     -> expected undefined to be defined

 Test Files  1 failed (1)
      Tests  7 failed | 15 passed (22)
```

The non-vacuity control `proves the rotation is genuinely lost without the wrapper` stayed **green**, as designed.

### 2b. Honest assessment of that failure MODE: it is partly environmental

I judged the mode rather than the count, and this run is **weaker evidence than it first looks**.

The SDK captures its fetch once, at construction:

```js
// dist/server.js:317
const fetchImpl = options.fetchImpl ?? fetch;
```

`createAppAuthBff()` runs in `beforeAll`, i.e. **before** any `vi.stubGlobal('fetch', ...)`.
So with the option removed the SDK holds the *real* global fetch, and the tests' fake Hub is never consulted at all.
I confirmed a real Hub is in fact listening on this machine:

```
$ lsof -nP -iTCP:9016 -sTCP:LISTEN
node    61948 cauetpinciara  ... TCP *:9016 (LISTEN)
$ curl -s -o /dev/null -w "status=%{http_code}\n" -X POST \
    "http://localhost:9016/auth/refresh?productId=product.fxl-sales" -H 'Cookie: fxl_hub_session=RT1'
status=401
```

That explains the `401` and the `{ op: 'delete' }`: the real local Hub rejected the bogus `RT1`, and the SDK took its `PERMANENT_REFRESH_CODES` branch (`dist/server.js:448-452`).
So this red is not the predicted "silent 200 with no `update`". On a machine or CI runner with no Hub on 9016, the fetch would throw and the SDK's `catch` would return `503`; tests 1, 2, 3, 5 and 7 would still be red, but test 6 would flip to green.

More importantly, **this mutation conflates two things**: it removes the cookie rewrite *and* it removes the call-time `globalThis.fetch` resolution that lets the test reach its fake Hub at all. On its own it does not prove the *rewrite* is load-bearing.

### 2c. The decisive experiment I added: a pass-through mutant

To isolate the rewrite, I replaced the option with a fetch that resolves the global at call time but performs **no** cookie rewriting:

```ts
fetchImpl: ((input: never, init: never) => globalThis.fetch(input, init)) as typeof fetch,
```

The fake Hub is now reached, no network is involved, and the result is exactly the discriminating signal:

```
 × ... rotates __Host-fxl_hub_session on /auth/refresh
     -> expected [ { op: 'get' } ] to deeply equal [ { op: 'get' }, ...(1) ]
 × ... rotates __Host-fxl_hub_session on /auth/switch
     -> expected [ { op: 'get' } ] to deeply equal [ { op: 'get' }, ...(1) ]
 ✓ ... still persists the rotated refresh token when the Hub sends the unprefixed fxl_hub_session
 ✓ ... does not write to the session when the Hub sends no Set-Cookie at all
 ✓ ... answers the accessToken and status the SDK produced, unchanged by the wrapper
 ✓ ... does not leak the Hub Set-Cookie headers to the browser
 ✓ ... hands createHubBff a wrapped fetchImpl rather than the bare global fetch
 ✓ the SDK rotation defect this wrapper exists for > proves the rotation is genuinely lost ...
```

This is the strongest possible failure mode and it is fully deterministic:

- Exactly the two `__Host-` rotation tests go red, on **both** required routes.
- They fail on **the precise assertion that the store never received the rotated token**: `[{op:'get'}]` versus `[{op:'get'},{op:'update',token:'RT2'}]`. Not a network error, not a timeout, not a thrown `TypeError`.
- The dev-mode test correctly stays green, because the SDK's own regex handles the unprefixed name.

**Conclusion: the cookie rewrite itself is provably load-bearing, on `/auth/refresh` and `/auth/switch`, with no environmental dependence.** The oracle is not vacuous.

### 2d. Restoration verified byte-for-byte

```
hash before mutations: bea656a17922782dc93603ab1707b1d810829578
hash after restoring : bea656a17922782dc93603ab1707b1d810829578
$ git diff -- apps/ packages/
(clean)
```

The re-run after restoration is the 22-passed result in point 1.

## 3. Does the test drive the REAL SDK?

Yes.
The file's `beforeAll` mocks `@fxl-business/hub-sdk/server` only to *capture* the options and then delegates:

```ts
createHubBff: (config, options) => {
  bffOptions = options as CapturedBffOptions;
  return actual.createHubBff(config, options);   // the real handler
},
```

`authBff` is the real `createAppAuthBff()` router, so the requests traverse the real origin shim, the real SDK `/auth/refresh` and `/auth/switch` handlers, and the real `hub-rotated-cookie.ts` wrapper.
The only fakes are the Hub itself (`globalThis.fetch`) and the transaction body.
The assertion is on a store `update` receiving the rotated value: `expect(session.calls).toEqual([{ op: 'get' }, { op: 'update', token: 'RT2' }])` plus `expect(session.stored()).toBe('RT2')`.
The non-vacuity control additionally builds a bare `actual.createHubBff(...)` with an unwrapped `fetchImpl`, which is a genuine SDK instance and not a mock.

This is an end-to-end oracle, not a wrapper-in-isolation test.

## 4. Both routes

Covered and independently proven.
`/auth/refresh` and `/auth/switch` each have a dedicated `__Host-` rotation test, and **both** went red under the pass-through mutant in 2c.

I confirmed the SDK really does repeat the defect at the switch route:

```js
// dist/server.js, /auth/switch
const rotated = parseRotatedRefresh(res.headers.get("set-cookie"));
if (rotated) await tx.update({ ...record, hubRefreshToken: rotated });
```

and the constants the fix depends on:

```js
var SESSION_COOKIE = "fxl_hub_session";
var SESSION_COOKIE_SECURE = "__Host-fxl_hub_session";
var LOGIN_TX_COOKIE = "fxl_hub_login";
var BACKCHANNEL_COOKIE_NAME = SESSION_COOKIE;   // request side is unprefixed in both modes
```

The plan's claim that the asymmetry is entirely on the response is therefore accurate.

## 5. No regression in the dev path

The unprefixed `fxl_hub_session` rotation still persists, pinned in two places, both green:

- wiring test `still persists the rotated refresh token when the Hub sends the unprefixed fxl_hub_session` -> `update(RT2)`.
- unit test `leaves an already unprefixed fxl_hub_session alone` -> asserts object **identity** (`toBe`), so the wrapper is a true no-op there.

My own probe (point 6) independently confirms the dev cookie returns the original `Response` reference unchanged.

## 6. Security and correctness review of `hub-rotated-cookie.ts`

I drove the real module with `tsx` against adversarial inputs the test suite does not cover.

**Does it rewrite only `__Host-fxl_hub_session`?** Yes. I could not find a cookie name it wrongly rewrites.
The pattern is `^__Host-fxl_hub_session=`, anchored and terminated by `=`, no `g` flag (so no `lastIndex` statefulness).

```
REWRITTEN | identity=NEW  | __Host-fxl_hub_session=RT2; Path=/; Secure   -> fxl_hub_session=RT2; Path=/; Secure
unchanged | identity=same | fxl_hub_session=RT2; Path=/
unchanged | identity=same | __Secure-fxl_hub_session=X; Path=/
unchanged | identity=same | __Host-fxl_hub_session_v2=Y; Path=/
unchanged | identity=same | x__Host-fxl_hub_session=Z; Path=/
unchanged | identity=same | __Host-fxl_hub_login=W; Path=/
unchanged | identity=same | __HOST-fxl_hub_session=CASE; Path=/
unchanged | identity=same | __Host-fxl_hub_session =SPACE; Path=/
unchanged | identity=same | a=1; __Host-fxl_hub_session=EMBED
unchanged | identity=same | __Host-fxl_hub_sessionX=Q; Path=/
```

The case variant `__HOST-` is deliberately not rewritten, which is correct: the SDK constant is exactly `__Host-fxl_hub_session`, so matching exactly is the conservative and right choice.

I specifically probed a `String.replace` metacharacter hazard, since `$` in a replacement string is special. It is safe, because the replacement literal `fxl_hub_session=` contains no `$`, and only the matched *name* is replaced:

```
REWRITTEN | sdkToken="RT$2"    | __Host-fxl_hub_session=RT$2; Path=/    -> fxl_hub_session=RT$2; Path=/
REWRITTEN | sdkToken="RT2$&x"  | __Host-fxl_hub_session=RT2$&x; Path=/  -> fxl_hub_session=RT2$&x; Path=/
```

Token values round-trip byte-exactly.

**Could it leak the rotated refresh token to the browser?** No.
The wrapper sits only on the BFF's outbound `fetchImpl`; the rewritten `Response` is consumed inside the SDK, which returns `{status, body, clear}` and answers the browser with `c.json(...)`. This is pinned behaviourally by `does not leak the Hub Set-Cookie headers to the browser`, asserting `res.headers.getSetCookie()` is `[]` on a successful refresh. That test is genuinely sensitive: under the 2a mutation it went red with a real leaked `Set-Cookie`. The browser-facing cookie name remains governed by `secureCookies`, untouched by this slice.

**Does it silently swallow anything?** No, and this was checked closely because a quiet fallback would reinstate the exact defect.
There is no `?? []` and no `try/catch`. A missing `getSetCookie` fails twice over: `assertSetCookieSupport()` at module load, and a per-response throw in `readSetCookies`. Both are pinned (`throws rather than silently skipping ...`, `refuses to load on a runtime whose Headers has no getSetCookie`, `accepts the real Headers of the runtime this ships to`). A throw is caught by the SDK's own `try/catch` and becomes a transient `503` with the stored session untouched, which is loud and recoverable rather than a stale token answered `200`.

**Is the body handled safely?** Yes. The wrapper never reads the body; it moves the stream.

```
304 rewrite -> status=304 bodyNull=true cookie=fxl_hub_session=RT9; Path=/
origBodyUsed=false newBodyReadable=true json={"accessToken":"AT"}
```

No double read, and the `NULL_BODY_STATUS` guard means a `304`/`204` does not throw in the `Response` constructor. Status, statusText and other headers are preserved.

**Is `globalThis.fetch` resolved per call?** Yes, inside the returned async function (line 167), never captured at construction. This is pinned by `resolves the ambient global fetch at call time when no inner fetch is given`, and it is exactly what the pass-through experiment in 2c relied on to reach the fake Hub.

One observation, not a defect and not caused by this slice: in the SDK's `/auth/switch` handler the rotation write happens *before* the `403`/body-shape checks, so a switch that ultimately answers `502` still persists a rotation. That is upstream SDK behaviour and is unchanged by the wrapper.

## 7. Repo rules

| Rule | Result |
| --- | --- |
| No `pnpm patch` / `patchedDependencies` | PASS. `pnpm-workspace.yaml`, `package.json`, `apps/api/package.json`, `patches/` all untouched in the diff; `grep patchedDependencies` finds none. |
| `apps/api/src/auth/hub-session-store.ts` unmodified | PASS. Empty diff for that path. |
| No em dash in the diff | **MINOR FINDING**, see below. |
| No agent attribution in commit messages | PASS. All four commits are clean Conventional Commits with no `Co-Authored-By` and no agent name. |

**Em dash finding.** `git diff master..HEAD` does contain 5 em dashes, but **zero** of them are in this slice's code:

```
5  nexo/runs/feature-20260812-session-survives-one-refresh/evidence.md

$ grep -c '—' <the four source files>
apps/api/src/auth/hub-rotated-cookie.ts:0
apps/api/src/auth/__tests__/hub-rotated-cookie.test.ts:0
apps/api/src/middleware/app-auth.ts:0
apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts:0
```

All 5 are in `evidence.md`, which was authored by the **framing** commit `b58c140`, before slice 01 execution began. I am recording this as a minor cleanup item for the capture step rather than failing the slice, because the slice's own deliverable is clean and the rule's intent is not violated by the implementer's work.

## 8. Scope

Exact. The two implementation commits touch precisely the four files in the plan's `files_modified`:

```
32885d8 fix(auth): rename the Hub rotated session cookie so the SDK can read it
    apps/api/src/auth/__tests__/hub-rotated-cookie.test.ts | 208 +
    apps/api/src/auth/hub-rotated-cookie.ts                | 191 +

9431a77 fix(auth): wire the rotated-cookie fetch into the BFF, and prove it end to end
    apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts | 300 +-
    apps/api/src/middleware/app-auth.ts                           |   8 +
```

Everything else in `master..HEAD` is Nexo bookkeeping: `nexo/plans/**`, `nexo/runs/**` and `nexo/state.json`, from the framing commit `b58c140` and the notes commit `2974b70`. No product or configuration file outside the four is touched.

## Working tree left as found

```
 M nexo/runs/feature-20260812-session-survives-one-refresh/budget.json
?? .vscode/
?? nexo/runs/feature-20260812-session-survives-one-refresh/agents/execute-01.result.json
```

All three predate this verification. `git diff -- apps/ packages/` is clean. No branch switch, no merge, no commit, no push. No long-running process was started.

## Verdict

**PASS.**

Every gate command passes. The end-to-end oracle genuinely drives the real SDK refresh and switch handlers, and I proved it bites with a mutation the implementer did not run: a pass-through `fetchImpl` turns exactly the two `__Host-` rotation tests red on the precise "the store never received the rotated token" assertion, deterministically and with no network involved. The module rewrites only the one intended cookie name, cannot leak the rotated token to the browser, has no silent fallback, handles the body safely, and resolves the global fetch per call. Scope and repo rules are respected, with one cosmetic em-dash cleanup owed in a framing document.
