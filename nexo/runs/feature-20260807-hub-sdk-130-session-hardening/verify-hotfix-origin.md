# VERDICT: PASS (with one required follow-up and one deploy precondition)

Verify agent, production hotfix `fix/hub-bff-trusted-origin` @ `14e9a0d`, baseline `master`.
The fix is correct, load-bearing and preserves CSRF protection.
Every command is green, both mutations are non-vacuous, and no CSRF bypass succeeded.

The one thing that is NOT pinned by a test is the MOUNT itself.
Reverting `app-auth.ts` to `router.route('', bff)` reproduces the outage exactly and leaves all 391 API tests green.
That is a test-coverage gap, not a defect in the shipped fix, and it is written up as finding 1b with a concrete recipe.
It does not block the hotfix: production is down, the fix is proven correct against the real `createAppAuthBff()`, and shipping is strictly better than not shipping.

---

## Command results

All run-once, no watchers.

| Command | Result |
| --- | --- |
| `pnpm run type-check` | PASS (exit 0) |
| `pnpm run lint` | PASS (exit 0) |
| `pnpm test` | PASS (exit 0) - shared-utils 80/80, api 391/391 (40 files), web 641/641 (49 files) |
| `pnpm run build` | PASS (exit 0) |
| `pnpm --filter @fxl-sales/api test:integration` | PASS (exit 0) - 169/169 (25 files) |

`apps/api/src/auth/__tests__/hub-bff-origin.test.ts` is present in the run: `✓ src/auth/__tests__/hub-bff-origin.test.ts (9 tests)`.
The suite was re-run once more after both mutations were reverted, against a tree byte-identical to `14e9a0d`, and is still green.

---

## Root cause: verified, not assumed

Both claims were checked against artifacts rather than taken on trust.

**1.3.1 HAS the guard.**
Installed copy resolves to `node_modules/.pnpm/@fxl-business+hub-sdk@1.3.1_hono@4.12.28/.../hub-sdk`, `package.json` version `1.3.1`.
`dist/server.js` lines 331-342, the first `app.use("*")` inside `createHubBff`:

```js
if (method === "POST") {
  const origin = c.req.header("origin");
  const site = c.req.header("sec-fetch-site");
  if (site && site === "cross-site" || origin && origin !== new URL(c.req.url).origin) {
    return c.json({ error: "forbidden" }, 403);
  }
}
```

Matches the reported root cause.
Note it is POST-only, which is why `/auth/login` and `/auth/callback` (GETs) kept working and only `/auth/refresh`, `/auth/switch` and `/auth/logout` broke.

**1.2.0 does NOT have the guard.**
Fetched fresh from the registry with `npm pack @fxl-business/hub-sdk@1.2.0`, not read from the local store.
Tarball `package/package.json` version `1.2.0`.
`grep 'sec-fetch-site|cross-site' package/dist/server.js` returns nothing.
The only `forbidden` in the 1.2.0 bundle is line 456, the unrelated `not_a_member` workspace 403.
`createHubBff` at line 299 goes straight from its option defaults to `app.get("/auth/login")` at line 311 with no `app.use("*")` in between.
The locally installed 1.2.0 in the pnpm store agrees with the freshly fetched tarball.

**MIGRATION.md does not document it.**
`grep -i 'origin|csrf|forbidden|sec-fetch|cross-site'` over the 1.3.1 `MIGRATION.md` returns exactly one hit, line 199, the `not_a_member` row of the status table.
None of its 13 headings covers request origin or CSRF.
So this is a silent breaking change for any consumer whose browser origin differs from its BFF origin.

**The symptom chain corroborates.**
`apps/web/src/auth/refresh.ts` classifies on status alone: `401` is `session_expired`, everything else including `403` is `transient`.
So a 403 preserved the session and re-entered the revalidation ladder, the ladder exhausted after four consecutive failures, and the session-recovery panel appeared.
That is precisely the reported "four 403s, then the login loop".

---

## Mutation results

### Mutation A - revert the mount to `router.route('', bff)`

Applied to `apps/api/src/middleware/app-auth.ts`.

Full API unit suite: **40 files passed, 391 tests passed. STILL GREEN.**

So no committed test pins that `createAppAuthBff()` actually uses the shim.
`hub-bff-origin.test.ts` mounts `createHubBffOriginShim` directly onto a throwaway `Hono` and never calls `createAppAuthBff`, and `app-auth-bff-wiring.test.ts` never sends an `Origin` header (grep for `origin` in that file returns only `importOriginal` and a comment).

I then proved the mutation is a REAL regression rather than a no-op, with a throwaway probe driving the actual `createAppAuthBff()` through the exact `app.route('', authBff)` mount `server.ts` uses, with `CORS_ORIGIN=http://localhost:8006` and a request to `http://localhost/auth/refresh` (genuinely cross-origin):

| | mutation applied | mutation reverted |
| --- | --- | --- |
| `Origin: http://localhost:8006` (trusted) | **403** - outage reproduced | **401** - fixed |
| `Origin: http://evil.test` (untrusted) | 403 | 403 |

Mutation reverted, `git status` clean, probe deleted.

**Conclusion: the fix is load-bearing and does fix the reported failure. The mount is not test-pinned.**

### Mutation B - remove `bff.onError(hubBffErrorHandler)`

Applied to `apps/api/src/middleware/app-auth.ts`.

`app-auth-bff-wiring.test.ts`:

```
× createAppAuthBff store outage > answers 503 rather than a cookie-clearing 401
  when withSession rejects, through app.route('', authBff)
  → expected 500 to be 503
```

**RED, with exactly the 500 the finding predicts.**
11 other tests in that file stayed green, so the oracle is specific.
Mutation reverted; the test is green on the shipped tree.

The 503 guarantee is therefore both restored and genuinely non-vacuous.
The comment in `app-auth.ts` explaining why the handler must sit on both apps is accurate: because the BFF is now invoked through its own `fetch` rather than flattened by `route()`, a `HubSessionStoreUnavailableError` is caught by the sub-app's error handler and never reaches the outer router.

---

## CSRF bypass attempts

Allowlist `['https://sales.example.test']`, request `POST https://sales-api.example.test/auth/refresh`, driven against the REAL `createHubBff`.
`403` is the desired outcome for every row below except the last two.

| Attempt | `Origin` sent | Result |
| --- | --- | --- |
| Subdomain of the trusted origin | `https://evil.sales.example.test` | **403** |
| Trusted origin as a subdomain of an attacker domain | `https://sales.example.test.evil.test` | **403** |
| Different scheme | `http://sales.example.test` | **403** |
| Different port | `https://sales.example.test:8443` | **403** |
| Trailing slash on the incoming header | `https://sales.example.test/` | **403** |
| Uppercase host | `https://SALES.EXAMPLE.TEST` | **403** |
| Uppercase scheme | `HTTPS://sales.example.test` | **403** |
| Literal `null` origin | `null` | **403** |
| Prefix truncation | `https://sales.example.tes` | **403** |
| Userinfo smuggling | `https://sales.example.test@evil.test` | **403** |
| Untrusted origin lying about `sec-fetch-site: same-origin` | `https://evil.example.test` | **403** |
| Untrusted origin with no `sec-fetch-site` | `https://evil.example.test` | **403** |
| `Origin` header sent TWICE, trusted first | `https://sales.example.test, https://evil.example.test` | **403** |
| `Origin` header sent TWICE, trusted last | `https://evil.example.test, https://sales.example.test` | **403** |
| Empty string as the only allowlist entry | `https://sales.example.test` | **403** |
| Trusted origin, `sec-fetch-site: cross-site` | `https://sales.example.test` | 401 - correctly admitted |
| Trusted origin, `sec-fetch-site: same-site` | `https://sales.example.test` | 401 - correctly admitted |

**NOTHING SLIPPED THROUGH.**
The reason is structural and worth stating: the allowlist check is `trusted.has(origin)`, an exact string match of a `Set` built once at construction from `new URL(x).origin`.
`URL.origin` is scheme + host + non-default port and nothing else, so every "looks similar" variant above is a different string and fails closed.
There is no prefix match, no `endsWith`, no regex, and no wildcard anywhere in `hub-bff-origin.ts`.
Anything not on the list is passed through **unchanged**, so the SDK's own guard - not our code - issues the 403.
The shim can only ever widen to the allowlist; it can never narrow the SDK's protection.

One probe deserves a note because it initially looked like a bypass.
`Origin: 'https://sales.example.test '` (trailing space) returned 401 rather than 403.
This is NOT a bypass: the Fetch `Headers` layer strips leading and trailing HTTP whitespace from header values per spec, and Node's HTTP parser does the same per RFC 9110 OWS handling.
Verified directly: `new Headers().set('origin', 'https://sales.example.test ')` then `.get('origin')` returns `'https://sales.example.test'` with no space.
The shim saw the exact trusted origin, so admitting it is correct.
My test case was invalid, not the code.

### Attacker-controlled `CORS_ORIGIN`: not reachable

`CORS_ORIGIN` is declared in `apps/api/src/env.ts:29` as `z.string().url().default('http://localhost:8006')`, so it is validated process env.
`app-auth.ts:267` reads `env.CORS_ORIGIN` - the validated object, not `process.env` - once, at `createAppAuthBff()` time.
`createHubBffOriginShim` freezes it into a `Set` in its closure at construction; nothing per-request can add to or read from that set.
No request header, query param or body reaches the allowlist.
The shim also correctly ignores an unparseable entry (`normalizeOrigin` returns `null` and it is filtered out) rather than throwing at boot, and an empty-string entry cannot admit anything.

### Pre-existing SDK behaviour worth recording (NOT introduced by this hotfix)

The SDK guard compares `Origin` against `new URL(c.req.url).origin`, and in Hono on Node that URL is built from the `Host` header.
So a request whose `Origin` equals its own spoofed `Host` satisfies the guard.
I confirmed this behaves IDENTICALLY with and without the shim:

| | bare SDK (`route('', bff)`) | shimmed |
| --- | --- | --- |
| `POST https://evil.example.test/auth/refresh`, `Origin: https://evil.example.test` | 401 (not 403) | 401 (not 403) |
| same, plus `sec-fetch-site: cross-site` | - | **403** |

The shim neither introduces nor widens this.
It is also not browser-exploitable: a browser sets `Host` from the URL it actually connects to, so an attacker page cannot make it disagree with `Origin`, and the SDK's `sec-fetch-site: cross-site` clause 403s the real-browser shape anyway.
Recording it only so a future reader does not mistake it for something this hotfix did.

---

## Findings

### 1. Does it actually fix the reported failure? YES

`apps/api/src/auth/__tests__/hub-bff-origin.test.ts` drives the **real** `createHubBff` imported from `@fxl-business/hub-sdk/server`, with a real `InMemoryHubSessionStore`.
There is no fake BFF anywhere in the file.
Only `fetchImpl` is stubbed, and only to keep the Hub round trip off the network - every assertion resolves before that call is reached.

The non-vacuity test is present and real:

```
it('proves the guard is real by 403ing that same request without the shim', ...)
  const bare = new Hono();
  bare.route('', buildBff());
  expect(res.status).toBe(403);
  await expect(res.json()).resolves.toEqual({ error: 'forbidden' });
```

That is the same request the oracle above sends, through the exact `master` mount, and it asserts both the status and the body.
So if the SDK ever drops the guard, this file goes red rather than silently becoming dead code.

Load-bearingness proven end to end by mutation A above: 403 with the mount reverted, 401 with it restored, against the real `createAppAuthBff()`.

### 1b. GAP - the mount is not pinned by any test (required follow-up, non-blocking)

Mutation A left all 391 API tests green.
The oracle proves the shim WORKS; nothing proves it is USED.
Someone resolving a future merge conflict in `app-auth.ts`, or a future SDK bump that tempts a "simplify back to `route()`" cleanup, would re-break production with a fully green suite.

The recipe is small and I verified it works - it is exactly the probe I threw away.
Add to `app-auth-bff-wiring.test.ts`, which already builds the real `authBff` with `CORS_ORIGIN` stubbed to `http://localhost:8006`:

```ts
it('does not 403 a cross-origin refresh from CORS_ORIGIN, through app.route("", authBff)', async () => {
  const app = new Hono();
  app.route('', authBff!);
  const res = await app.request('http://localhost/auth/refresh', {
    method: 'POST',
    headers: { origin: 'http://localhost:8006', 'sec-fetch-site': 'same-site' },
  });
  expect(res.status).not.toBe(403);   // 403 on `router.route('', bff)`
});

it('still 403s a refresh from an untrusted origin, through the same mount', async () => {
  // ... origin: 'http://evil.test', 'sec-fetch-site': 'cross-site' → expect 403
});
```

`http://localhost` vs `http://localhost:8006` is genuinely cross-origin, so this needs no new env stubbing.
Confirmed red under mutation A and green on the shipped tree.

This is the same class of gap the file header of `app-auth-bff-wiring.test.ts` already describes for `sessionStore` and for the login-supersede mount, so it belongs in that file by precedent.

### 2. Is CSRF protection genuinely preserved? YES

See the bypass table above: 14 of 14 hostile shapes returned 403, and the two legitimate shapes were admitted.
The allowlist comes from validated env and cannot be influenced by a request.
An untrusted origin is passed through untouched so the SDK issues its own 403, which means the shim's failure mode is "the SDK still decides", not "we decide".

The security posture change is real but narrow and correctly reasoned in the file header: the SDK's implicit "origin must equal my own" is replaced by an explicit one-entry allowlist.
A browser sets `Origin` itself and page script cannot forge it, so an allowlist check on that header is a sound CSRF control - and it is the same header the `cors` middleware sitting beside it already trusts with `credentials: true`.
The session cookie is `SameSite=Lax` (SDK `baseCookieOptions`), which is a second, independent barrier on cross-site POSTs.

### 3. The 503-not-500 regression: FIXED and non-vacuous

The oracle `answers 503 rather than a cookie-clearing 401 when withSession rejects, through app.route('', authBff)` passes on the shipped tree.
Mutation B (delete `bff.onError(hubBffErrorHandler)`) turns it red with `expected 500 to be 503`, which is exactly the silent regression described.
The test also asserts `res.headers.get('set-cookie')` is null, so it pins the actual guarantee - a store blip must not delete the session cookie - and not merely the status number.

### 4. Redirects still work: YES

Tested against the **real** BFF, not a stub, by supplying a valid discovery document to `fetchImpl`.
`GET /auth/login` with a trusted `Origin` (so it takes the rewrite path) returned:

- status **302**
- `Location: https://hub.example.test/oauth/authorize?response_type=code&client_id=...&code_challenge_method=S256` - intact, all params present
- `Set-Cookie: fxl_hub_login=<txid>; Max-Age=600; Path=/; HttpOnly; SameSite=Lax` - intact

Also confirmed with a stub sub-app that a 302 carrying its own `Set-Cookie` passes through unchanged (`Location` and `Set-Cookie` both preserved).

The `redirect: 'manual'` in the shim is harmless but is not what makes this work: `Hono.fetch()` dispatches to the router and returns the `Response` directly, it never follows redirects.
The response object is returned by reference and is never rebuilt, so there is no path by which a redirect could be swallowed.

Worth noting these two routes are GETs and the SDK guard is POST-only, so `/auth/login` and `/auth/callback` were never part of the outage.
They are also usually top-level navigations that carry no `Origin` at all, in which case the shim's first branch passes them straight through untouched.

### 5. Cookies survive the rebuild: YES

- Inbound `Cookie: fxl_hub_session=abc; other=zzz` arrived at the sub-app byte-identical.
- Outbound **multiple** `Set-Cookie` headers survive: `getSetCookie()` returned exactly `['a=1; Path=/; HttpOnly', 'b=2; Path=/; HttpOnly']`, two distinct entries, not folded into one.

Structurally guaranteed: the shim returns `bff.fetch(...)`'s `Response` unmodified, so nothing on the response side can be lost.
On the request side `new Headers(raw.headers)` copies every header, and only `origin` and (conditionally) `sec-fetch-site` are overwritten.

### 6. POST bodies survive: YES

`POST /auth/switch?workspace=w1` with `{"workspaceId":"w1"}` through the shim, observed at the sub-app:

```
body        = {"workspaceId":"w1"}     (exact)
cookie      = fxl_hub_session=abc; other=zzz
content-type= application/json
authorization = Bearer tok             (unrelated headers preserved)
method      = POST
url         = https://sales-api.example.test/auth/switch?workspace=w1   (query string preserved)
origin      = https://sales-api.example.test   (rewritten, as designed)
sec-fetch-site = same-origin                   (rewritten from cross-site, as designed)
```

The `arrayBuffer()` buffering is safe here: these are auth payloads of tens of bytes, and buffering is what avoids needing `duplex: 'half'`.
`GET`/`HEAD` correctly pass `body: undefined` rather than an empty buffer.

### 7. Slice 06's supersede middleware still runs: YES

`mounts the login-supersede middleware on /auth/callback` passes on the shipped tree, and passed under both mutations, so it is unaffected by the reshape.
Ordering holds structurally: `router.use('/auth/callback', ...)` is registered at `app-auth.ts:243`, before `router.all('/auth/*', shim)` at line 267, and Hono matches in registration order.
Its `AsyncLocalStorage` login context propagates across the `await bff.fetch(...)` boundary normally, and the test asserts the observed context is exactly `[{ priorSessionId: 'session-prior' }]` - so it proves propagation, not merely invocation.

### 8. No other guarantee regressed

Every listed guarantee still has a live oracle, and all of them ran green in the final full-suite run.

| Guarantee | Oracle |
| --- | --- |
| Row lock | `hub-session-store.test.ts` - "rejects with HubSessionStoreUnavailableError when the row lock cannot be taken, and never runs the operation"; `test/rls/hub-bff-session-store.test.ts` - "does not block a different session id while one row lock is held" |
| PKCE single-use | `test/rls/hub-bff-session-store.test.ts` - "consumes a login transaction exactly once across instances", "deletes an expired login transaction on consume and returns null" |
| Absolute TTL | "sets the absolute expiry once at create from the store constant, ignoring the value the SDK supplies", "does not extend the absolute expiry when the SDK spreads the record back into update", "does not move absolute_expires_at when a rotation slides expires_at", "keeps the session TTL at 30 days and caps it with a 90-day absolute TTL" |
| Refresh classification | `apps/web/src/auth/__tests__/refresh.test.ts` - "classifies a network throw as transient"; `token.test.ts` - "passes the failure classification straight through to the caller", "reports a superseded refresh as transient, never as an expired session" |
| Ladder reset | `apps/web/src/auth/__tests__/react.test.tsx` - "resets the ladder after each recovery, so unrelated blips never accumulate", "keeps the cache when the revalidation ladder recovers from a blip", "clears a still-pending ladder timer at unmount" |
| Logout intent | `react.test.tsx` - "does not auto-login while the logout intent is set", "resets the URL to the default route while the logout intent is set", "does not restore authentication when a workspace switch resolves after logout begins" |
| Cache flush | `react.test.tsx` - "drops every cached entry on logout", "clears browser token state before SDK logout", "does not flush when a superseded workspace switch resolves late" |

The route surface is also unchanged.
All five routes the SDK BFF registers are under `/auth/` (`GET /auth/login`, `GET /auth/callback`, `POST /auth/refresh`, `POST /auth/switch`, `POST /auth/logout`), so `router.all('/auth/*', shim)` covers exactly what `router.route('', bff)` covered - nothing was dropped and nothing new was exposed.
CORS preflight is unaffected: `app.use('*', corsMiddleware)` in `server.ts` runs before the router and short-circuits `OPTIONS`.

---

## Green but concerning

**A. DEPLOY PRECONDITION - production `CORS_ORIGIN` must be exactly `https://sales.fxlbusiness.com`.**
The whole fix keys on that one value.
It lives in Infisical/Coolify, which I cannot read from here, so this is the one thing I could not verify.
A trailing slash is handled (`normalizeOrigin` strips it), but a `www.` prefix, an `http://` scheme, or an unset value falling back to the `http://localhost:8006` default would leave production exactly as broken as it is now, with the same 403.
There is indirect evidence it is already correct - the browser could read the 403 body across origins, which a credentialed cross-origin response only permits when `Access-Control-Allow-Origin` matches exactly, and that header is emitted from this same `env.CORS_ORIGIN` - but that inference is not airtight and should be confirmed before or immediately after the deploy.
Confirm with one `curl -i -X POST https://sales-api.fxlbusiness.com/auth/refresh -H 'Origin: https://sales.fxlbusiness.com'` against the deployed API: a `401` means fixed, a `403` means the env var is wrong.

**B. The allowlist is a single origin.**
`trustedOrigins: [env.CORS_ORIGIN]`.
That is right for today and keeps the blast radius minimal, and I would not change it in a hotfix.
But if a preview deployment, a second web host or a custom tenant domain is ever added, this is the second place that has to change and it is not obvious from the `CORS_ORIGIN` name.
A comment at the call site, or eventually a dedicated `TRUSTED_WEB_ORIGINS`, would prevent that.

**C. A `403` is still classified `transient` by the web.**
`apps/web/src/auth/refresh.ts` classifies on status alone and only `401` is permanent, so any future origin misconfiguration will again present as four silent retries and a session-recovery panel rather than as a clear error.
That is what turned a config mismatch into an opaque outage and made it hard to diagnose from the UI.
The current design is deliberate and well argued in that file's comment, and I would NOT change it under hotfix pressure - a 403 from a proxy really can be transient.
But an operator-visible signal for a repeated non-401, non-503 refusal would have cut the diagnosis time here substantially.
Worth a ROADMAP entry.

**D. The upstream SDK issue should be reported.**
An undocumented CSRF guard added in a patch-level-adjacent release that breaks every split-origin consumer belongs in `MIGRATION.md`, ideally with a `trustedOrigins` option in `createHubBff` so consumers do not each have to write this shim.
If that option ever lands, `hub-bff-origin.ts` should be deleted in favour of it - the file header already frames the shim as reversible, which is the right posture.

---

## Working tree

Restored exactly as found.
`git status --porcelain` reports only the pre-existing untracked `?? .vscode/`.
Both mutations reverted from a byte-for-byte backup of `app-auth.ts`, and all three throwaway probe files deleted.
`git diff HEAD` is empty.
No background process was left running; every command was run once, none in watch mode.
