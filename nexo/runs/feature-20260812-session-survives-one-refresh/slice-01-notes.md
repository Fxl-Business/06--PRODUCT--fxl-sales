# Slice 01 - Persist the rotated Hub session cookie

Executor run notes.
Branch `fix/01-persist-rotated-hub-session-cookie`, off `master` at `b58c140`.

## What changed

Exactly the four files in the plan's `files_modified`, and nothing else.

1. `apps/api/src/auth/hub-rotated-cookie.ts` (new).
   The `fetchImpl` wrapper in front of the Hub BFF's BACKCHANNEL fetch.
   It reads `res.headers.getSetCookie()` per cookie and rewrites only the NAME of a `__Host-fxl_hub_session=` response cookie back to `fxl_hub_session=`, so the SDK's `parseRotatedRefresh` regex can see the rotated refresh token.
   Content is the plan's intended module verbatim in structure and behaviour: `assertSetCookieSupport()` at module load, a per-response throw rather than a silent `[]`, the original `Response` object returned unchanged when nothing matched, a streaming re-wrap with the `NULL_BODY_STATUS` guard on the rewrite path, and `globalThis.fetch` resolved at CALL time rather than captured at construction.

2. `apps/api/src/auth/__tests__/hub-rotated-cookie.test.ts` (new).
   All 14 unit tests from the plan, with the plan's exact names, driven by a fake inner fetch.

3. `apps/api/src/middleware/app-auth.ts`.
   One import plus one option: `fetchImpl: createHubRotatedCookieFetch()` immediately after `sessionStore` inside `createHubBff`, with the plan's comment.
   Nothing else in the file changed.

4. `apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts`.
   `CapturedBffOptions` gained `fetchImpl?: unknown`, `afterAll` gained `vi.unstubAllGlobals()`, and the helpers plus the two new `describe` blocks were added: 7 end-to-end tests against the real SDK handlers, plus the non-vacuity control.
   The `stubHub` helper was split into a bare `fakeHubFetch` and a `stubHub` that installs it globally, because the non-vacuity control needs the UNWRAPPED fake Hub as an explicit `fetchImpl` while the seven wired tests need it as the ambient global.
   That split is a mechanical consequence of the plan's own test 8, not a design change.

Also verified before writing anything, per the plan's execution order: the installed `@fxl-business/hub-sdk@1.3.1` tarball still reads exactly as cited.
`dist/server.js:275-278` (the four cookie constants, `BACKCHANNEL_COOKIE_NAME = SESSION_COOKIE`), `:299`/`:301` (`parseRotatedRefresh` and its regex), `:317` (`const fetchImpl = options.fetchImpl ?? fetch;`), `:463` and `:518` (the two identical rotation lines), and `dist/server.d.ts:32` (`fetchImpl?: typeof fetch`).
No line has moved.

## Proof step: the oracle genuinely goes red

`fetchImpl: createHubRotatedCookieFetch()` was commented out in `apps/api/src/middleware/app-auth.ts` and the wiring test re-run.

```
pnpm --filter @fxl-sales/api exec vitest run src/middleware/__tests__/app-auth-bff-wiring.test.ts
```

```
 ❯ src/middleware/__tests__/app-auth-bff-wiring.test.ts (22 tests | 7 failed) 224ms
   ✓ createAppAuthBff wiring > boots with the blank HUB_SESSION_ENCRYPTION_KEY that .env.dev.example ships 0ms
   ✓ createAppAuthBff wiring > builds a durable session store rather than the SDK in-memory default 0ms
   ✓ createAppAuthBff wiring > hands the durable session store to createHubBff 0ms
   ✓ createAppAuthBff wiring > bounds the upstream Hub call with timeoutMs 0ms
   ✓ createAppAuthBff wiring > wires the SDK session TTLs to the store constants so the two views cannot disagree 0ms
   ✓ createAppAuthBff cookie routing, against the real SDK > routes the fxl_hub_session cookie into withSession on /auth/refresh 3ms
   ✓ createAppAuthBff cookie routing, against the real SDK > routes the fxl_hub_login cookie into consumeLoginTransaction on /auth/callback 1ms
   ✓ createAppAuthBff cookie routing, against the real SDK > reads the __Host- session cookie when secureCookies is on 1ms
   ✓ the SDK BFF route contract apps/web/src/auth/refresh.ts is coupled to > answers 401 to a cookieless POST /auth/refresh, which is the verdict the web classifier keys on 1ms
   ✓ the SDK BFF route contract apps/web/src/auth/refresh.ts is coupled to > does not route a neighbouring path, so a moved endpoint cannot pass as a live one 0ms
   ✓ createAppAuthBff login supersede > mounts the login-supersede middleware on /auth/callback 1ms
   ✓ createAppAuthBff trusted-origin mount > does not 403 a cross-origin refresh from CORS_ORIGIN, through the real mount 1ms
   ✓ createAppAuthBff trusted-origin mount > still 403s a cross-origin refresh from an origin that is not CORS_ORIGIN 0ms
   ✓ createAppAuthBff store outage > answers 503 rather than a cookie-clearing 401 when withSession rejects, through app.route('', authBff) 1ms
   × createAppAuthBff rotated Hub session cookie, against the real SDK handlers > persists the rotated refresh token when the Hub rotates __Host-fxl_hub_session on /auth/refresh 129ms
     -> expected [ { op: 'get' }, { op: 'delete' } ] to deeply equal [ { op: 'get' }, ...(1) ]
   × createAppAuthBff rotated Hub session cookie, against the real SDK handlers > persists the rotated refresh token when the Hub rotates __Host-fxl_hub_session on /auth/switch 10ms
     -> expected 401 to be 200 // Object.is equality
   × createAppAuthBff rotated Hub session cookie, against the real SDK handlers > still persists the rotated refresh token when the Hub sends the unprefixed fxl_hub_session 4ms
     -> expected [ { op: 'get' }, { op: 'delete' } ] to deeply equal [ { op: 'get' }, ...(1) ]
   × createAppAuthBff rotated Hub session cookie, against the real SDK handlers > does not write to the session when the Hub sends no Set-Cookie at all 5ms
     -> expected 401 to be 200 // Object.is equality
   × createAppAuthBff rotated Hub session cookie, against the real SDK handlers > answers the accessToken and status the SDK produced, unchanged by the wrapper 4ms
     -> expected 401 to be 200 // Object.is equality
   × createAppAuthBff rotated Hub session cookie, against the real SDK handlers > does not leak the Hub Set-Cookie headers to the browser 18ms
     -> expected [ Array(1) ] to deeply equal []
   × createAppAuthBff rotated Hub session cookie, against the real SDK handlers > hands createHubBff a wrapped fetchImpl rather than the bare global fetch 0ms
     -> expected undefined to be defined
   ✓ the SDK rotation defect this wrapper exists for > proves the rotation is genuinely lost without the wrapper, through the same real SDK handler 1ms

------- Failed Tests 7 -------

 FAIL  src/middleware/__tests__/app-auth-bff-wiring.test.ts > createAppAuthBff rotated Hub session cookie, against the real SDK handlers > persists the rotated refresh token when the Hub rotates __Host-fxl_hub_session on /auth/refresh
AssertionError: expected [ { op: 'get' }, { op: 'delete' } ] to deeply equal [ { op: 'get' }, ...(1) ]

- Expected
+ Received

  [
    {
      "op": "get",
    },
    {
-     "op": "update",
-     "token": "RT2",
+     "op": "delete",
    },
  ]

 ❯ src/middleware/__tests__/app-auth-bff-wiring.test.ts:599:27
    597|     }
    598|
    599|     expect(session.calls).toEqual([{ op: 'get' }, { op: 'update', toke...
       |                           ^
    600|     expect(session.stored()).toBe('RT2');
    601|     expect(seen).toHaveLength(1);

-----------------------------[1/7]-----------------------------

 FAIL  src/middleware/__tests__/app-auth-bff-wiring.test.ts > createAppAuthBff rotated Hub session cookie, against the real SDK handlers > persists the rotated refresh token when the Hub rotates __Host-fxl_hub_session on /auth/switch
AssertionError: expected 401 to be 200 // Object.is equality

- Expected
+ Received

- 200
+ 401

 ❯ src/middleware/__tests__/app-auth-bff-wiring.test.ts:625:25
    623|     }
    624|
    625|     expect(res?.status).toBe(200);
       |                         ^
    626|     expect(session.calls).toEqual([{ op: 'get' }, { op: 'update', toke...
    627|     expect(session.stored()).toBe('RT2');

-----------------------------[2/7]-----------------------------

 FAIL  src/middleware/__tests__/app-auth-bff-wiring.test.ts > createAppAuthBff rotated Hub session cookie, against the real SDK handlers > still persists the rotated refresh token when the Hub sends the unprefixed fxl_hub_session
AssertionError: expected [ { op: 'get' }, { op: 'delete' } ] to deeply equal [ { op: 'get' }, ...(1) ]

- Expected
+ Received

  [
    {
      "op": "get",
    },
    {
-     "op": "update",
-     "token": "RT2",
+     "op": "delete",
    },
  ]

 ❯ src/middleware/__tests__/app-auth-bff-wiring.test.ts:649:27
    647|     }
    648|
    649|     expect(session.calls).toEqual([{ op: 'get' }, { op: 'update', toke...
       |                           ^
    650|     expect(session.stored()).toBe('RT2');
    651|   });

-----------------------------[3/7]-----------------------------

 FAIL  src/middleware/__tests__/app-auth-bff-wiring.test.ts > createAppAuthBff rotated Hub session cookie, against the real SDK handlers > does not write to the session when the Hub sends no Set-Cookie at all
AssertionError: expected 401 to be 200 // Object.is equality

- Expected
+ Received

- 200
+ 401

 ❯ src/middleware/__tests__/app-auth-bff-wiring.test.ts:669:25
    667|     }
    668|
    669|     expect(res?.status).toBe(200);
       |                         ^
    670|     expect(session.calls).toEqual([{ op: 'get' }]);
    671|     expect(session.stored()).toBe('RT1');

-----------------------------[4/7]-----------------------------

 FAIL  src/middleware/__tests__/app-auth-bff-wiring.test.ts > createAppAuthBff rotated Hub session cookie, against the real SDK handlers > answers the accessToken and status the SDK produced, unchanged by the wrapper
AssertionError: expected 401 to be 200 // Object.is equality

- Expected
+ Received

- 200
+ 401

 ❯ src/middleware/__tests__/app-auth-bff-wiring.test.ts:690:25
    688|     }
    689|
    690|     expect(res?.status).toBe(200);
       |                         ^
    691|     expect(await res?.json()).toEqual(HUB_REFRESH_BODY);
    692|   });

-----------------------------[5/7]-----------------------------

 FAIL  src/middleware/__tests__/app-auth-bff-wiring.test.ts > createAppAuthBff rotated Hub session cookie, against the real SDK handlers > does not leak the Hub Set-Cookie headers to the browser
AssertionError: expected [ Array(1) ] to deeply equal []

- Expected
+ Received

- []
+ [
+   "fxl_hub_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax",
+ ]

 ❯ src/middleware/__tests__/app-auth-bff-wiring.test.ts:712:41
    710|     }
    711|
    712|     expect(res?.headers.getSetCookie()).toEqual([]);
       |                                         ^
    713|   });

-----------------------------[6/7]-----------------------------

 FAIL  src/middleware/__tests__/app-auth-bff-wiring.test.ts > createAppAuthBff rotated Hub session cookie, against the real SDK handlers > hands createHubBff a wrapped fetchImpl rather than the bare global fetch
AssertionError: expected undefined to be defined
 ❯ src/middleware/__tests__/app-auth-bff-wiring.test.ts:718:35
    716|     // Weak on its own, deliberately kept: deleting the option fails h...
    717|     // one-line diagnosis before it fails the oracle above with a long...
    718|     expect(bffOptions?.fetchImpl).toBeDefined();
       |                                   ^
    719|     expect(bffOptions?.fetchImpl).not.toBe(globalThis.fetch);
    720|   });

-----------------------------[7/7]-----------------------------

 Test Files  1 failed (1)
      Tests  7 failed | 15 passed (22)
```

Verdict against the plan's requirement:

- tests 1, 2, 3 and 7 all RED, as required.
- test 8, the non-vacuity control (`proves the rotation is genuinely lost without the wrapper, through the same real SDK handler`), stayed GREEN.
- tests 4, 5 and 6 went red as well, which is more than the plan predicted and is explained below.

### Why the un-wired failures read as `401` and `delete` rather than `[{ op: 'get' }]`

Worth recording, because a verifier reading the plan will expect
`session.calls` to be `[{ op: 'get' }]` and `stored()` to be `'RT1'`.

With the option removed, the SDK falls back to `const fetchImpl = options.fetchImpl ?? fetch;` at `dist/server.js:317`.
That binds the ORIGINAL global fetch at `createHubBff` time, which happens inside this file's `beforeAll`.
The tests' `vi.stubGlobal('fetch', ...)` runs much later, so it never reaches the SDK at all: the un-wired BFF bypasses the fake Hub entirely and issues a real HTTP request to `FXL_HUB_API_URL`, which this file stubs to `http://localhost:9016`.

A local Hub happens to be listening on that port on this machine, and it answers the stale probe token `RT1` with a permanent `401`, verified directly:

```
$ curl -s -o /dev/null -w '%{http_code}\n' -X POST \
    'http://localhost:9016/auth/refresh?productId=product.fxl-sales' \
    -H 'Cookie: fxl_hub_session=RT1'
401
```

So the SDK takes its `PERMANENT_REFRESH_CODES` branch, calls `tx.delete()` and answers `401 session_expired` with `clear: true`, which is also where the leaked `fxl_hub_session=; Max-Age=0` cookie in failure 6 comes from.
On a machine with nothing on 9016 the same run would instead produce `503 refresh_unavailable` with `session.calls === [{ op: 'get' }]`, and tests 1, 2, 3, 4, 5 and 7 would still be red while 6 would pass.
Either way the four the plan named go red, and the wired run reaches the fake Hub in one hop.

This is not a weakness of the oracle: it is the plan's "resolve `globalThis.fetch` at CALL time" design point demonstrating itself.
The wrapper is the only thing in the chain that can see a fetch stub installed after construction, so the wired and un-wired paths are distinguishable by construction and cannot silently converge.

Line was then restored and the same command re-run:

```
 ✓ src/middleware/__tests__/app-auth-bff-wiring.test.ts (22 tests) 61ms

 Test Files  1 passed (1)
      Tests  22 passed (22)
```

## Final green

```
$ pnpm --filter @fxl-sales/api exec vitest run src/auth/__tests__/hub-rotated-cookie.test.ts
 ✓ src/auth/__tests__/hub-rotated-cookie.test.ts (14 tests) 5ms
 Test Files  1 passed (1)
      Tests  14 passed (14)

$ pnpm --filter @fxl-sales/api exec vitest run src/middleware/__tests__/app-auth-bff-wiring.test.ts
 ✓ src/middleware/__tests__/app-auth-bff-wiring.test.ts (22 tests) 61ms
 Test Files  1 passed (1)
      Tests  22 passed (22)

$ pnpm --filter @fxl-sales/api test
 Test Files  41 passed (41)
      Tests  415 passed (415)

$ pnpm run lint
apps/api lint: Done
apps/web lint: Done

$ pnpm run type-check
apps/api type-check: Done
apps/web type-check: Done

$ pnpm test
apps/api test:  Test Files  41 passed (41)
apps/api test:       Tests  415 passed (415)
apps/web test:  Test Files  49 passed (49)
apps/web test:       Tests  663 passed (663)
build-contract: ok
```

`pnpm --filter @fxl-sales/api test:integration` was deliberately not run: it needs Docker Postgres and this slice touches nothing it covers.

## Disagreements with the plan

None material. Two notes, both recorded rather than acted on.

1. The plan predicts the un-wired run gives `session.calls === [{ op: 'get' }]` with a `200`.
   As measured above it gives `[{ op: 'get' }, { op: 'delete' }]` with a `401` on this machine, because a real local Hub is listening on the stubbed `FXL_HUB_API_URL`.
   The prediction is directionally right and the four named tests do go red, so the plan was followed unchanged.
   The environment-sensitivity is worth knowing for anyone re-running the proof: the exact failure text depends on whether port 9016 is occupied, but the pass/fail verdict does not.

2. The plan's `stubHub` helper cannot serve test 8, which needs the fake Hub as an explicit `fetchImpl` rather than as a global stub.
   It was therefore split into `fakeHubFetch` (the bare fetch) and `stubHub` (installs it globally), with `stubHub`'s signature and return value unchanged from the plan.
   This is the plan's own requirement made compilable, not a deviation from it.
