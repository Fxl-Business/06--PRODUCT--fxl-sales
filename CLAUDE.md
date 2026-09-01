# CLAUDE.md

## Product

FXL Sales is the affiliate and referral product for FXL.
The product audience is `app.fxl-sales`.
Keep the repository folder name unchanged until the editor session can safely move.

## Stack

- API: Hono, Drizzle ORM, PostgreSQL, Zod, and `@fxl-business/hub-sdk`.
- Web: React, Vite, TypeScript, Tailwind, TanStack Query, React Router, and react-i18next.
- Auth and commerce: FXL Hub only.

## Auth Model

- The API mounts the Hub BFF at `/auth/*`.
- Local browser auth enters through same-origin web `/auth/*` routes.
- Vite proxies those routes to the API BFF, and the local registered callback is `http://localhost:8006/auth/callback`.
- Protected API routes use Hub bearer tokens through `appAuthMiddleware`.
- `requireHubAuth` verifies access tokens and exposes `c.get('hubAuth')`.
- `userId` is the Hub account id.
- `orgId` is the active Hub workspace id.
- Baseline access is the REQUIRED boolean `auth.claims.entitlements.access`, and nothing else.
  `entitlements.modules` carries ADD-ON modules only and must NEVER be read for baseline access: the `sales.core` module was deleted in the Hub's access-model-v1, so the old `modules.includes('sales.core')` gate was false for every user and answered 402 to the entire product.
  This is the ONE place in the tree that still spells that string, deliberately, as the prose record of what was removed; `CLAUDE.md` is outside the grep gate's pathspec for exactly that reason.
- `classifyHubAccess` in `apps/api/src/middleware/app-auth.ts` is the single authority, allows only on `access === true`, and fails CLOSED: absent, false, non-boolean, or a missing `entitlements` object all deny.
- `MinimalHubAuthContext` declares `access: boolean` LOCALLY and never imports the SDK's `HubEntitlements`, which through at least 1.3.1 is re-exported from an unshipped package and degrades to `any` under `skipLibCheck`, making the deny branch unreachable at type level. The SDK's own MIGRATION.md section 10 says so.
- `classifyHubAccess`, `hasHubOrgAccess`, `hasHubModule`, `requireHubModule` and the 402 branch inside `appAuthMiddleware` are a DELIBERATE ONE-WAVE BRIDGE while this repo is on `@fxl-business/hub-sdk@1.3.1`, which exports no access gate at all.
  The SDK bump deletes them and delegates to 2.1.0's `requireHubAuth`, whose `allowWithoutAccess` defaults to false, because two gates would mean one live gate and one unreachable one with a green suite over it.
  `requireHubModule` is meanwhile the only seam that may read `modules`, for a paid add-on, and no route mounts it today.
- The deny taxonomy is exact and EXHAUSTIVE, and the web half branches on it: `401 {"error":"unauthorized"}` is a missing or invalid token and reaches the login screen, which is the correct destination for every one of its codes, `contract_version_mismatch` included - that code is new in `@fxl-business/hub-sdk@2.1.0` and means the token's `contractVersion` is not 1, an absent one included, so it is a token this app cannot use and a fresh login is the only answer; `402 {"error":"payment_required","code":"no_org_access"}` is an Organization without access and MUST render the buy screen, never a login screen, never the expired-session panel, and never the generic API-fault panel where it landed before v2.8.0; `403 {"error":"forbidden"}`, with `missing_module` or `missing_role`, is authenticated but without the membership, Seat, module or role the route requires, and MUST render the ask-an-administrator panel, never the generic API-fault panel; `503 {"error":"unavailable","code":"hub_auth_not_configured"}` is the API having no Hub configuration at all.
  Every body is byte-identical to the one 2.1.0's `requireHubAuth` returns natively, so the SDK flip changes no contract.
- `isAuthFailure` is 401-only, `isEntitlementFailure` is 402-only and `isForbiddenFailure` is 403-only, all three in `apps/web/src/lib/require-token.ts`, and all three key on the STATUS ALONE.
  The 402 and 403 predicates deliberately do not also require a `code`: `apiFetch` builds its error from `await res.json().catch(() => ({}))`, so a response whose body does not parse carries no code at all, and requiring one would fail CLOSED back onto the server-outage copy both predicates exist to remove.
  `isEntitlementFailure is true for a 402 that carries no code at all` and `isForbiddenFailure is true for a 403 that carries no code at all` are the pins.
  The classification chain in `SalesOpsApp` is `isEntitlementFailure`, then `isForbiddenFailure`, then `isAuthFailure`, then generic, and the INVARIANT is that the generic `Verifique o servidor local` copy is reachable ONLY for an error that is none of the classified kinds.
  The order matters not because `isAuthFailure` is true for a 402 or a 403 today - it is false for both - but because a later widening of it placed above them would silently steal a billing or a permission answer into `Sessão expirada`, telling the operator to sign in again to fix the one thing that is not broken, and a re-login answers it with the same status forever.
  `apps/web/src/sales-ops/__tests__/entitlement-dead-end.test.tsx` is the oracle for all four arms, drives the REAL `apiFetch` error path with `../api`, `@/lib/api-client` and `../hooks` unmocked, and its decisive mutations are the `[data-missing-entitlement]` and `[data-forbidden]` markers, so neither panel case can pass by rendering nothing.
- `ForbiddenPanel` names no module and no role, and its `names no module, no role and no raw identifier` test pins that.
  A 403 body is not something this app can render trustworthily: the `code` is a machine token and the `module` field is a Hub-internal identifier that the identifier law keeps out of user-facing copy. "Peça a quem administra" is the whole of what this app knows.
- ONE-WAVE INTERNAL DISAGREEMENT, dated 2026-09-01 rather than left to be discovered. The taxonomy above says the 402 body is `no_org_access`, while the `Organization context` section below still says `402 {error: 'payment_required', code: 'missing_entitlement'}` and still names `apps/api/src/middleware/app-auth.ts` as its producer.
  It is deliberate and it is bounded: the SDK-bump slice rewrites that line in the same pass that sweeps every other stale `missing_entitlement` literal out of the tree, and splitting the sweep across two waves would give two slices a claim on the same lines.
  Nothing is broken in the interval, because `isEntitlementFailure` keys on `status === 402` alone and never reads the code.
- The Hub Audience and the Hub environment are EXPLICIT validated configuration, read off the validated `env` object through `hubEnvBag` in `apps/api/src/config/auth-provider.ts` and never off raw `process.env`.
  The Audience is `app.<slug>` and must equal `app.` plus the Client id's slug; nothing derives it from a key, and `parseAudienceFromPublishableKey` is deleted.
  The environment must equal the environment segment inside `pk_<slug>_<environment>_<random>` and is NEVER inferred from `NODE_ENV`: a staging deploy that happens to run with `NODE_ENV=production` would otherwise ask the Hub for the wrong Client, which is a 401 at runtime instead of a refusal to boot, and the agreement is checkable OFFLINE.
  `FXL_HUB_CONFIG`, one JSON object with `apiUrl`, `environment`, `clientId`, `clientSecret` and `audience`, is this repo's documented form; setting it beside ANY of the five discrete variables is a boot failure whose message names every offender by NAME and never prints a value.
  `FXL_HUB_REDIRECT_URI` stays its own variable because 2.x's `HubConfig` has no `redirectUri` and `createHubBff`'s default of `${config.apiUrl}/auth/callback` is the HUB's origin, which is always wrong for this app.
  `FXL_HUB_HEALTH_TOKEN` is generated by the OPERATOR, not issued by the Hub, and is required whenever the environment is not `development`.
  A bad Hub configuration is a BOOT FAILURE and not a 503: there is no blanket `try/catch` in `auth-provider.ts`, and `tryLoadHubAuthConfig` returns `null` only for the `absent` and `incomplete` presences, which is what keeps `503 hub_auth_not_configured` alive for a machine that has simply not been given credentials yet.
- Browser Hub access tokens are memory-only, cached until JWT `exp` minus 30 seconds, and concurrent `getToken()` calls share one in-flight refresh per provider; logout and workspace generation guards reject late responses.
- A missing access token is never defaulted.
  `requireToken(getToken)` in `apps/web/src/lib/require-token.ts` throws `AuthTokenUnavailableError`, and `apiFetch` / `apiFetchBlob` take a REQUIRED non-empty `token` and assert it before calling `fetch`, so a null token can never become an anonymous request that reads as a server outage.
  `no-restricted-syntax` in `apps/web/eslint.config.js` fails lint if `(await getToken()) ?? ...` comes back.
  The sales-ops error panel routes `isAuthFailure` (an unavailable token, or an `ApiError` with `status: 401`) to `Sessão expirada` rather than to the generic API-fault copy.
- The Hub BFF session store is DURABLE, in Postgres, and `createAppAuthBff` must always pass it.
  Under `@fxl-business/hub-sdk@1.3.0` omitting `sessionStore` THROWS at construction when `NODE_ENV === 'production'`, and a store that does not implement `withSession` throws at construction unconditionally (`assertModernSessionStore`); outside production a missing option still falls back silently to the SDK's `InMemoryHubSessionStore`, which puts the Hub refresh token in one process's memory, so every restart or redeploy logs every user out and a second replica cannot see a session the first created.
  `apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts` still asserts the exact store instance reaches `createHubBff`, so deleting the option fails a test rather than silently regressing, and it fails earlier than a boot would.
- `HubSessionStore` is ASYNC and TRANSACTIONAL as of `@fxl-business/hub-sdk@1.3.0`, and the store owns the lock.
  `withSession(id, op)` opens ONE `db.transaction`, takes `SELECT ... FOR UPDATE` on the session row BEFORE `op` runs, and holds it until commit, so two concurrent refreshes of one session id serialize at Postgres and a rotated refresh token cannot be lost.
  There is no hydrate phase, no flush phase and no `AsyncLocalStorage` working set; `apps/api/src/auth/hub-session-scope.ts` is deleted and must not come back.
  Because the operation's return value is never captured outside the transaction, a commit failure cannot be returned as success - which was the pre-1.3.0 hole where the Hub had rotated `RT1` to `RT2` while Postgres still held `RT1`.
  The transaction handle answers `read()` with a three-state `{status: 'found', record} | {status: 'expired'} | {status: 'absent'}`, because `expired` clears the browser's session cookie and `absent` never does, so collapsing the two turns a database blip into a logout the operator cannot recover from.
  A row past EITHER `expires_at` or `absolute_expires_at` is deleted inside the same transaction and reported `expired`; a missing row is `absent`; a seal that will not open is `absent` and LEAVES the row, because a wrong key must cost one re-login rather than destroy data, and anything the store cannot positively prove is expiry is `absent` by rule.
  `get()` survives only until the SDK flip and is a PROJECTION of `read()`, never a second lookup, so the two cannot drift.
  `expires_at` is SLIDING (30 days, rewritten by `update`) and `absolute_expires_at` is a hard ceiling (90 days, written ONCE by `create` and absent from `update`'s `set` object entirely), so a continuously refreshing session cannot live forever.
  `update` deliberately ignores BOTH timestamps the SDK spreads back from `get` (`dist/server.js:464`): honouring `expiresAt` would freeze the sliding TTL at 30 days from login, and honouring `absoluteExpiresAt` would let a rotation extend the ceiling.
  `createHubBff` is given `sessionTtlSeconds` and `sessionAbsoluteTtlSeconds` derived from those same constants, so the SDK's 90-day sliding / 365-day absolute defaults are never in play, and both expiries reach the SDK as ISO strings through the single `toSessionRecord` boundary - the SDK reads them with `Date.parse`, and a `Date` object there yields `NaN` and silently disarms its own gate.
  The nightly `deleteExpiredHubBffSessions` sweeps on either timestamp.
  Any throw inside `withSession` - lock read, handle method, operation or commit - becomes `HubSessionStoreUnavailableError`.
  That is answered `503` by `hubBffErrorHandler`, the BFF router's `onError`, NOT by a middleware: hono's `compose` catches a throw at the dispatch level that threw and resolves upward, so a `try { await next() } catch` mounted above the BFF is dead code.
  The `503` is load-bearing for the same reason it always was - a store outage read as "no session" makes the SDK answer `401` and delete the session cookie, logging every user out over a brief database blip.
  `createHubBff` is given `timeoutMs: 5_000`, because the BFF calls the Hub over HTTP from inside the row-lock transaction and an unbounded call pins a `getAdminDb()` connection (`max: 5`, shared with the audit and history paths) with an open transaction.
- The BFF's BACKCHANNEL fetch is wrapped by `createHubRotatedCookieFetch` in `apps/api/src/auth/hub-rotated-cookie.ts`, passed as `createHubBff`'s `fetchImpl`, and without it a session survives exactly ONE refresh in production.
  The Hub's auth service runs with `NODE_ENV=production`, so it rotates its session cookie as `Set-Cookie: __Host-fxl_hub_session=<rotated>`; outside production it uses the unprefixed name.
  `parseRotatedRefresh` (`dist/server.js:299`) is `/(?:^|[,\s])fxl_hub_session=([^;]+)/`, and the `__Host-` prefix leaves the name preceded by `-`, which is neither `^` nor `[,\s]`, so the regex misses, `tx.update()` is never called, Postgres keeps the refresh token that was just spent, AND THE BFF STILL ANSWERS 200.
  The Hub forgives exactly one stale generation for 60 seconds (`HUB_SESSION_GRACE_SECONDS`), so the replay falls further behind on every cycle: the first is forgiven, the second trips `reuse_detected` and the Hub revokes the whole family.
  Against a 120-second access token renewed at `exp - 60s`, that is one dead session every one to three minutes, for every user, measured in production on 2026-08-12.
  The wrapper rewrites ONLY that exact cookie NAME, per cookie through `getSetCookie()`, and returns the ORIGINAL `Response` object by identity when nothing matched, so the dev path allocates nothing and changes nothing.
  It must never gain a silent fallback: an earlier sketch read `typeof res.headers.getSetCookie === 'function' ? ... : []`, which on a runtime without it would reinstate the exact defect invisibly and with a green suite, so a missing `getSetCookie` throws instead and the SDK's own `try/catch` turns that into a visible `503` with the session untouched.
  This is the BACKCHANNEL, and it has NOTHING to do with `secureCookies`: that names the BROWSER cookie the BFF sets on its own response, which carries a session id rather than a refresh token, and stripping a `__Host-` prefix there would drop a real security attribute.
  `/auth/switch` carries the identical defect at `dist/server.js:518`, so a workspace switch was losing its rotation the same way, and both routes are pinned.
  The oracle is `apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts`, which drives the REAL `createHubBff` handler against a fake Hub and asserts the store persisted the rotated token.
  Before this run NO test in the repo had ever executed that handler: every rotation test called `handle.update(...)` directly and the wiring test stubbed `withSession` to return a canned `REFRESH_OK`, which is precisely why three rounds of browser-side fixes all missed the real defect.
  Delete this module when the SDK is fixed upstream to accept `(?:__Host-)?fxl_hub_session=`; its own non-vacuity test going red is the signal that it has become redundant.
- The minimum usable SDK release is `@fxl-business/hub-sdk@1.3.1`, and the floor is a PACKAGING floor, not a behavioural one.
  `1.3.0` shipped `main`/`types`/`exports` pointing at `./src/*.ts` while `files` was `["dist","schema","MIGRATION.md"]`, so `src/` was absent from the tarball and neither Node nor Vite could resolve the package at all; the `publishConfig` swap that `1.2.0` applied was not applied to `1.3.0`.
  `1.3.1` is that fix and nothing else: `dist/server.*`, `dist/client.*` and both chunks are BYTE-IDENTICAL to `1.3.0`, and the only code difference in the whole package is the `HUB_SDK_VERSION` constant.
  So every behavioural statement in this section that says "as of 1.3.0" is still exactly true on `1.3.1`.
  Do not drop the range below `^1.3.1`; `1.3.0` INSTALLS fine and then fails to RESOLVE at import time, which is the nastier shape of the two, and the `pnpm patch` that once bridged it has been deleted along with its `patchedDependencies` entry.
  `hono` is pinned to `4.12.28` by a `pnpm-workspace.yaml` OVERRIDE, not only by `apps/api/package.json`: the SDK peer-requires `>= 4.12.28` and `.npmrc` sets `strict-peer-dependencies=false`, so without moving the override the workspace resolves a second Hono copy and the BFF's `Context` stops being the one `server.ts` composes with.
- `hub_bff_sessions` and `hub_bff_login_txns` are global, non-tenant tables and cannot be otherwise: a session row is written at `/auth/callback`, before any workspace is known, so there is no `org_id` to key a tenant policy on.
  Both carry FORCE RLS with only the `app.fxl_admin` policy, so the ordinary `getDb()` connection sees zero rows; the store goes through `getAdminDb()`.
  Refresh tokens and PKCE verifiers are AES-256-GCM sealed with the row id as AEAD additional data, keyed by HKDF-SHA256 from `FXL_HUB_CLIENT_SECRET` unless `HUB_SESSION_ENCRYPTION_KEY` overrides it, so rotating either one logs every user out.
  Read that override through the validated `env` object, never `process.env`: `.env.dev.example` ships it blank and `??` does not catch `''`, which fails the 32-char floor and stops the API booting.
- A login SUPERSEDES the session id the browser presented at `/auth/callback`, deleting that row in the SAME transaction that inserts the new one, so a re-login cannot orphan a live rotatable refresh token.
  The key is deliberately the prior SESSION ID and not the account id.
  The 1.3.0 BFF never populates `HubSessionRecord.accountId`, so `hub_bff_sessions.account_id` is always NULL; and keying on the account would log the operator out of every other device while still leaving the previous account's row live in the one browser where two identities actually collide, which is the case invariant 3 exists to close.
  Sessions this key cannot see, orphaned without a login, are bounded by `absoluteExpiresAt` and the nightly sweep instead.
  The prior session id reaches `create()` through an `AsyncLocalStorage` owned by the store and set by a `/auth/callback`-only middleware, because the SDK calls `store.create` from inside its own handler with no seam for an extra argument.
  That is NOT a return of the deleted hydrate-around-the-handler bridge, and the paragraph above forbidding a working set still stands: this context carries one string, performs no I/O, holds no lock, and has no failure mode.
  `createHubSessionStore` returns a DISCRIMINATED union so `session.kind === 'durable'` narrows the store to `DurableHubSessionStore`, and the middleware is mounted only on that branch: the memory fallback flows through the same router and the SDK's `InMemoryHubSessionStore` has no `withLoginContext`, so an unnarrowed mount 500s every local `/auth/callback`.
- A failed token read does NOT immediately sign the user out, and WHICH failure it was decides whether the ladder runs at all.
  The browser reads `/auth/refresh` itself through `requestHubAccessToken` in `apps/web/src/auth/refresh.ts` and never through `HubClient.getToken()`, because the bundled client through at least `1.3.1` still declares `Promise<string | null>` and discards `res.status` - `dist/client.*` is byte-identical between `1.3.0` and `1.3.1`, so the republish did not change this, and the SDK's own `MIGRATION.md` now carries a caveat confirming it and recommending exactly this direct-fetch pattern; that hand-rolled fetch is coupled to the path and to `credentials: 'include'`, which is why one `getHubBffBasePath` result feeds both it and `createHubClient` and why `refresh.test.ts` pins the request shape while `apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts` pins that the real SDK router still answers that path.
  A `401` is the BFF's own verdict that the session is dead - both of its bodies, `session_expired` and `no_session`, mean the same thing - so classification keys on the STATUS and `failSession()` runs on that single response with no rung ever scheduled.
  Everything else preserves the session and enters the bounded ladder (`SESSION_REVALIDATE_DELAYS_MS`), which gives up only after four CONSECUTIVE transient failures.
  A cold start is no longer a special case: it follows the same rule, so a boot-time Hub outage holds the Skeleton for about six seconds instead of bouncing into a login that would also fail and burn the attempt budget.
  The counter resets on every recovery; making it a lifetime total signs the operator out on roughly the fourth unrelated blip, which is the original destroyed-form bug, and `apps/web/src/auth/__tests__/react.test.tsx` pins the reset.
- Losing a session while the app is OPEN never navigates.
  `login()` is `client.login()`, a full `window.location.assign` to the Hub, so calling it destroys the document and every byte of unsaved form state with it; `captureReturnTo` restores the ROUTE and has never restored form state.
  `HubProtected`'s login effect therefore splits the two cases `isSignedIn === false` conflates, on the `sessionLost` flag the provider derives from `lastAppliedToken` (`undefined` before the first apply, `null` after a loss, a string while signed in - so a live loss is exactly "was a string, is now null").
  COLD ENTRY keeps redirecting exactly as it always did, and that is the must-not-break: nothing is on screen yet so nothing is destroyed, and breaking it means nobody can ever sign in.
  A LIVE LOSS renders `SignedOutPanel` (`Sua sessão expirou`) in a `fixed inset-0` overlay WITH `children` still mounted underneath - the only branch in that component that does not replace the subtree, which is precisely why the operator's half-filled wizard survives - and waits for their `Entrar` click, so the navigation is theirs and the loss is expected rather than inflicted.
  That branch sits AHEAD of `loginBlocked` and its click clears the attempt counter, because the loop guard exists to stop AUTOMATIC re-login loops and a live loss never spends an attempt on its own; letting a leftover counter swap in `SessionRecoveryPanel` would unmount the work the branch exists to protect.
  The durable logout intent still wins over it, so an explicit `Sair` keeps its own copy rather than being told the session expired.
  Persisting form state ACROSS a redirect remains deliberately out of scope and is filed in `nexo/ROADMAP.md`.
  Keeping `children` mounted is only half the guarantee, and the other half lives in the CHILD: `SalesOpsApp` gates BOTH of its `<Navigate>` early returns on `rolesAreAuthoritative = profile.isSignedIn`.
  A `return <Navigate />` is itself an unmount, so before that guard the overlay kept the subtree alive and the child immediately threw it away: `applyToken(null)` sets `roles: []`, `getVisibleWorkspaces([])` is `[]`, and the child navigated to `/no-role`, destroying the operator's wizard AND rewriting the URL that this file makes the single source of truth for the active workspace and page.
  The login effect then captured `/no-role` as the returnTo, so `Entrar` restored a dead end - which is the production report, `Sua sessão expirou` rendered at `sales.fxlbusiness.com/no-role` for an operator who had been on `/tatico/dashboard`.
  The SECOND early return needs the guard just as much as the first: with an empty role set `resolveSalesOpsRoute` matches no workspace and falls through to `getDefaultSalesOpsRoute`, so `redirect` is `true` for EVERY url, and guarding only the first relocates the bug into "rewrite any non-`/tatico/dashboard` url to `/tatico/dashboard`".
  `profile.isLoaded` is deliberately absent, because `applyToken` only ever writes `isLoaded: true` and no reachable state has `isSignedIn` true while it is false.
  Do NOT "fix" this by returning `null` or a Skeleton while signed out; that unmounts the subtree too, and exactly ONE test out of 708 catches it - `keeps the Sales Ops shell and its own component state mounted underneath the overlay`, which collapses the sidebar BEFORE the loss and asserts the collapsed state survives, because a URL-only oracle passes a fix that destroys the operator's work.
- While the document is VISIBLE the access token renews itself at `exp - SESSION_RENEWAL_LEAD_MS` (60s), so a long-open tab never drifts into expiry and the first read after the operator returns is not a failure path.
  The lead is deliberately longer than the cache's `ACCESS_TOKEN_EXPIRY_SKEW_MS` (30s), which is why `HubAccessTokenCache` exposes `renew()`: at that moment `getToken()` would still answer from memory, so a renewal driven through it would issue no request at all.
  Nothing is scheduled while `document.visibilityState === 'hidden'` - a throttled tab renews late and uselessly, and holding a session alive for a tab nobody is looking at is not a service - and `visibilitychange` to visible renews SYNCHRONOUSLY on the event when the token is expired or already inside the window, so a focus-triggered query refetch cannot win that race.
  A non-positive delay never schedules: arming the next rung out of the answer to this one is an unbounded loop for any token whose whole life is shorter than the lead, and that case belongs to the visibility handler, which fires once per event.
  This is the SECOND timer source in `react.tsx`, so `vi.getTimerCount()` is only a ladder oracle while the renewal provably cannot arm; `react.test.tsx` pins `tokenCache.expiresAt()` to `null` outside the renewal block for exactly that, and the renewal block asserts a finite expiry really does arm one.
  happy-dom reports `visibilityState` as `visible` whenever the document has a `defaultView`, so a visibility guard alone would NOT have kept those tests inert.
- `sanitizeReturnTo` in `apps/web/src/auth/session-recovery.ts` re-asserts its structural checks on the NORMALIZED value it returns, not only on the raw input.
  Validating only the raw string let dot-segment normalization through, so `/..//evil.example` returned `//evil.example` and resolved off-origin.
  The stored path is destroyed BEFORE it is validated, so a hostile value is consumed exactly once and cannot be retried on a later mount.
  The same normalized value is also refused outright when it names a TERMINAL auth screen, which today is the one-member `TERMINAL_AUTH_ROUTES = ['/no-role']`.
  A terminal screen is where a failed authorization ENDS, so it is never an answer to "where was this operator before we sent them to the Hub", and restoring one is exactly the reported "I click `Entrar` and get `Acesso não autorizado`".
  `isTerminalAuthRoute` matches it the way React Router matches it and not by string equality, because anything looser leaves a spelling the guard permits and the router still renders: per-segment percent-decoding mirroring `decodePath` (including its `/` re-encoding and its malformed-escape fallback), all trailing slashes stripped, and `toLowerCase` because `compilePath` carries the `i` flag unless a route opts into `caseSensitive` and none does.
  It sits with the other re-asserted checks and NOT on the raw input, for the same reason they do: `/foo/../no-role` has `.` as its second character and resolves same-origin, so it walks past every raw check and only BECOMES `/no-role` inside `new URL`.
  The constant is deliberately not exported, so the oracle pins literal paths rather than whatever the implementation happens to contain, and `refuses a terminal route that only appears after dot-segment normalization` is the test that fails on the raw-input placement while every other new test still passes.
  The legacy trees are deliberately NOT members: `RoleGuard` bounces an unentitled operator off them to `/no-role`, but an entitled one lands on a real page, so refusing them would strand a legitimate restore for the only operator who can reach them.
- An explicit `Sair` writes a DURABLE logout intent, `fxl-sales.auth.logoutIntent` in `sessionStorage`, and `markLogoutIntent()` is SYNCHRONOUS and lands BEFORE THE FIRST `await` in `logout()`; it is written as the first statement, above `tokenCache.clear()` and above `failSession()`.
  The measured bug is not an ordering bug INSIDE that synchronous block - React cannot re-render in the middle of a synchronous function, so every statement from `markLogoutIntent()` through `consumeReturnTo()` completes before any flush.
  It is that `logout()` had no durable intent at all: `consumeReturnTo()` cleared the slot, the discrete click's state update then flushed when the handler returned, and `HubProtected`'s login effect refilled the slot with the exact route the logout was clearing, spent a login attempt, and redirected to the Hub.
  The "before the first `await`" rule is what makes the intent visible to that flush, and it is the position that stays correct if an `await` is ever inserted above it.
  This is deliberately NOT the same mechanism as the proposta wizard's submit button, which races two browser phases within a single click; do not conflate them.
  While the intent is set, `HubProtected` refuses to auto-login BEFORE calling `registerLoginAttempt()`, so the attempt budget is unspent - which is also the test oracle, since it proves the effect body never ran rather than merely that no redirect was seen.
  It reduces the URL to `/` so the previous operator's route is neither on screen nor available to capture the instant the intent clears, and it renders `SignedOutPanel` in preference to `SessionRecoveryPanel`, whose "Tentamos entrar novamente algumas vezes" would be a lie when no automatic attempt was made.
  Auto-re-login after an explicit `Sair` is deliberately not offered: on a shared machine the Hub's own SSO cookie can complete it with no prompt, undoing the one action the product has for ending a session.
  The intent is cleared in exactly two places, and BOTH are needed: the panel's `Entrar` button, and `observeToken`'s live-token branch beside `clearLoginAttempts()`.
  The second is the anti-lockout backstop - any token at all proves the session is live, so the intent can only ever persist while no token is obtainable.
  It must not move into `applyToken`, whose unchanged-token early return would skip it whenever a re-login yielded a byte-identical token.
  `sessionStorage` and not `localStorage`: the intent must die with the tab, because a week-old intent from a closed tab suppressing a fresh login is a lockout bought for nothing, and `client.logout()` destroys the session server-side anyway, so other tabs sign out on their own next refresh.
  `hasLogoutIntent` matches an exact sentinel and fails OPEN on an unreadable storage, both for the same reason: an over-broad or fail-closed read is a lockout, while a narrow or fail-open one is only a return to the prior behaviour.
- The TanStack query cache is FLUSHED with `queryClient.clear()` on logout, on an in-page signed-out to signed-in transition inside `observeToken`, and on every completed workspace switch inside `setActive`.
  This is why `QueryClientProvider` is OUTSIDE `AppAuthProvider` in `apps/web/src/App.tsx`: the auth provider reads the client with `useQueryClient()`, so it can only ever flush the exact client its own subtree reads.
  Every key in `apps/web/src/lib/query-keys.ts` is account- and org-agnostic, and `queryClient` is a module-level singleton that survives every auth event short of a page reload, so without the flush a workspace switch renders the previous tenant's rows and a second operator on the tab is served the first one's data.
  `clear()` and not `invalidateQueries()`: invalidation leaves the stale data in the cache to be rendered while the refetch is in flight, which is the leak itself. It also clears the mutation cache, so a paused mutation from the previous identity cannot resume under the new one.
  `Query.destroy()` cancels the retryer, and a cancelled retryer's thenable is already settled, so a request issued before the flush cannot write its result back afterwards.
  The switch flush goes AFTER `await client.setActive(...)` and after the `operationGeneration` check, and BEFORE `tokenCache.seed` and `observeToken`: flushing earlier would wipe the current tenant's data on a switch that is still in flight, fails, or is superseded.
  Those two orderings have DEDICATED oracles, because nothing else in the suite catches either one - `keeps the current tenant's cache while a workspace switch is still in flight` and `does not flush when a superseded workspace switch resolves late`, both in `apps/web/src/auth/__tests__/react.test.tsx`.
  A ladder recovery must NOT flush. The condition is `typeof lastAppliedToken.current === 'string'`, i.e. a token arriving while NO session is held, so a transient blip cannot destroy the operator's cached screen; `keeps the cache when the revalidation ladder recovers from a blip` is the only test that fails on the obvious wrong implementation of "flush on every non-null token".

## Tenancy

- Database tenancy remains keyed by `org_id`.
- Hub workspace ids must be provisioned to match existing org ids.
- Every tenant query must filter by `eq(table.orgId, c.get('orgId'))`.
- Never trust `user_id`, `org_id`, `account_id`, or `workspace_id` from request bodies.

## UI Identifiers

- Never render raw account or workspace ids in user-facing UI.
- Use display helpers such as `userLabel` and `orgLabel`.
- When a raw fallback is unavoidable for an operator screen, style it as muted monospace text.

## UI Controls

- Native `<select>`, `<option>` and `<datalist>` are banned everywhere in `apps/web/src`, and `no-restricted-syntax` in `apps/web/eslint.config.js` fails lint if one comes back.
  A browser picker cannot be searched and cannot offer to create the item the operator just typed, which is why this is an enforced rule and not a preference.
- Every single-select picker in `apps/web/src/sales-ops/**`, plus the workspace switcher in `apps/web/src/auth/react.tsx` and every data-driven picker in the legacy `admin/**` and `finder/**` trees, uses `Combobox` from `@/components/ui/combobox`.
  It is the only searchable picker in the app.
- Documented exception, and the only one: `apps/web/src/admin/products/ProductDialog.tsx` (product status) and `apps/web/src/admin/products/CommissionRuleForm.tsx` (commission basis) keep the shadcn `Select`.
  Both are two-option closed enums that never grow, so search buys nothing, and a Radix `Select` is not a browser-native picker, so both already satisfy the ban above.
  Convert them to `Combobox` whenever those two screens are next worked on, and do not add a third such site.
- Numeric fields use `<Input type="number">` from `@/components/ui/input`; the OS spin buttons are suppressed by a base-layer rule in `apps/web/src/index.css`.
  A raw `<input type="number">` is banned by the same ESLint rule.
- `<input type="date">` is the one browser-native picker still allowed, by explicit decision.
- Any component that opens an inline layer inside a dialog - `Combobox`'s panel, `InfoHint`'s disclosure - MUST call `useInlineLayer(open)` from `@/components/ui/inline-layer`.
  Radix registers `useEscapeKeydown` on `document` with `{capture: true}`, so it runs before the event reaches React's root container and **no** handler inside the React tree can pre-empt it - `stopPropagation` and `stopImmediatePropagation` are both inert against it.
  Without the registry, Escape aimed at an open picker closes the whole wizard and discards the operator's typed work.
  `DialogContent` owns the registry and `preventDefault`s `onEscapeKeyDown` while any layer is open; the open count is a ref, so a picker opening does not re-render the dialog, and release is idempotent so a StrictMode double cleanup cannot strand the count negative and silently disarm the guard.
  A regression test for this must render the component inside a REAL `Dialog` and assert `onOpenChange` was not called. A spy on a React sibling's `onKeyDown` passes even with the protection deleted - that exact false positive already shipped once.
- Picker geometry has exactly two canonical sizes in sales-ops: `formSelectClass` (44px, matching `formInputClass` so a picker and the `Input` beside it line up) and `comboboxTriggerClass` (40px, the compact `Filtros` bar only).
  Call sites pass only non-geometry extras.
- `onCreate` is wired only where an inline create yields a complete, valid record: cliente, área and função create through the API, and profissional accepts the typed name verbatim.
  Produto opens `ProductDialog` prefilled instead, because a produto is invalid without an área.
  The `Custos padrão por função` picker inside `ProductDialog` gets no create row, because creating a função is admin-gated and belongs to `cadastros/funcoes`; its empty state points there.
  The vendedor and finder pickers get no create row, because a pessoa is invalid without a função; the função picker inside the Pessoa dialog does have one, because a função needs only a name.
  The proposta wizard's `FUNÇÃO NO PROJETO` picker has one too, for the same reason as the Pessoa dialog's; the two deliberate exclusions above are unchanged.
- A wizard's primary button carries `type="button"` on EVERY step, and the final step saves through `onClick`.
  Never derive that attribute from the step (`type={step < 4 ? 'button' : 'submit'}`), because the click that advances the step would then also be the click that changes the element's own activation behaviour.
  A click runs in two phases - the event dispatch, then the browser's activation behaviour for the element - and React 18 flushes a discrete event's state update synchronously, so the re-render lands BETWEEN them.
  The browser then asks "is this a submit button?" of an element React has already rewritten to `submit`, submits the form, and persists a record the operator never reviewed.
  That was the produto dialog's step 3 to 4 autosave; the proposta wizard never had it because its primary button was always `type="button"`.
- A DOM-level click test CANNOT catch that regression: happy-dom's `dispatchEvent` never runs activation behaviour, so `advances from step 3 to step 4 without saving` passes with the bug fully present.
  The oracle is the invariant `keeps one activation behaviour on every step` in `apps/web/src/sales-ops/__tests__/product-service-dialog.test.tsx`, which was the only one of 537 web tests to go red on the mutation.
  Anything of this class has to be proven in a real browser; assert the invariant that makes the race impossible rather than trying to observe the race in jsdom or happy-dom.

## Sales Ops Routing

- Canonical Sales Ops routes are `tatico/dashboard`, `operacional/vendas|comissoes`, `cadastros/produtos|areas|clientes|pessoas|funcoes|geral`, and `meus-dados/vendedores|comissoes|finders|vendas`.
- `cadastros/vendedores` and `cadastros/finders` no longer exist; `resolveSalesOpsRoute` aliases both legacy views to `pessoas` and returns `redirect: true` so the URL is rewritten to `/cadastros/pessoas`.
- `aliasLegacyView` returns the view unchanged unless the resolved workspace is `cadastros`, so the alias can only ever fire there. The `meus-dados/vendedores` and `meus-dados/finders` views keep those exact ids and must never be aliased.
- The URL is the single source of truth for the active Sales Ops workspace and page.
- Workspace visibility is driven purely by the Hub role set `profile.roles: AppRole[]` (`AppRole = 'admin' | 'seller' | 'finder'`) via `getVisibleWorkspaces` in `apps/web/src/sales-ops/navigation.ts`. There is no viewing-level switcher; the old "Nível de visualização" selector was removed.
- Visibility rule: `admin` (team) sees `tatico` + `operacional` + `cadastros`; holding `seller` or `finder` adds the `meus-dados` workspace. So seller-only or finder-only sees only `meus-dados` and defaults there; team-only sees the three team workspaces and no `meus-dados`; team + seller/finder sees all four. Zero recognized roles keeps `/no-role`.
- "Team" is not a Hub product role. `admin` is synthesized in-app from the Hub workspace `owner`/`admin` flag (see `getRolesFromHubClaims` in `apps/web/src/auth/claims.ts`); the Hub product config defines only `seller` and `finder`.
- `meus-dados` reuses existing panels and view components (seller: `vendedores` "Meu painel" + `comissoes`; finder: `finders` "Meu painel" + `vendas` "Indicações"); it is not a new page. Data scoping stays backend/RLS-authoritative.
- `MeuPainelView` (formerly `PeopleView`) in `apps/web/src/sales-ops/SalesOpsApp.tsx` is the read-only `meus-dados` performance panel behind the `vendedores` and `finders` views and takes no `onEdit` prop at all. People cadastro editing lives only in `PessoasView` under `cadastros/pessoas`.
- Pessoa and função create or edit controls are admin-only and live under Cadastros (`cadastros/pessoas` and `cadastros/funcoes`). No `meus-dados` route exposes a pessoa or função create or edit affordance.
- Open-price sale item labels use the existing `items[].productName` to `productNameSnapshot` path while preserving the original `productId`, so do not add a parallel description field or migration.
- Keep the static legacy route trees `/admin/*`, `/finder/*`, `/seller/*`, and `/no-role` unchanged, with ONE exception: `/no-role`'s element is wrapped in `NoRoleGuard`, which redirects to `/` as soon as `getVisibleWorkspaces(profile.roles)` is non-empty.
  The rule protects the SHAPE of those trees - their paths, their shells and their role guards - and not the dead end.
  No path is added, removed or renamed, the three shells are untouched, `RoleGuard` is byte-unchanged, and `NoRolePage` still renders unaltered for the operator the screen is actually for.
  `RoleRouter` used to sit in that same file and has been deleted: it read like the `/` root redirect but was referenced from nowhere, while `/` is really `SalesOpsApp` inside `Protected` resolving the default workspace itself.
  What it fixes is that the screen never re-checked on arrival, so an operator who reached it and then signed in successfully stayed on `Acesso não autorizado` holding full roles, and a seller who merely opened an `/admin/*` URL was stranded there by `RoleGuard` with a perfectly good `meus-dados` workspace one hop away.
  The condition is `getVisibleWorkspaces(roles).length > 0` and must NOT be simplified to `roles.length > 0`.
  The two agree for all seven non-empty subsets of today's `AppRole`, so tests do not distinguish them by accident; they stop agreeing the day a role is added that maps to no workspace, and at that moment `SalesOpsApp` wants `/no-role` while the guard wants `/` and the app locks into an infinite redirect loop for that operator, two files from the change that caused it.
  Keyed on visible workspaces the exclusivity is structural rather than arithmetic: the guard fires iff `|V| > 0` and `SalesOpsApp` fires iff `|V| === 0` (and `isSignedIn`), over the same function and the same profile in the same render pass, so at most one can ever navigate for ANY role value.
  `keeps the unauthorized screen for a role the app does not recognize, and does not ping-pong` is the sole oracle separating the two conditions, and neither lint nor type-check catches the difference.
  `NoRoleGuard` lives beside `RoleGuard`, which is what sends operators INTO `/no-role`, and is mounted INSIDE `<Protected>`: outside it would judge an unresolved profile on a cold entry.
  It is inert during a live session loss, because the profile is then loaded with `roles: []`, so the overlay never has the URL pulled out from under it.

## Organization context

- A Hub ORGANIZATION and a Sales WORKSPACE are two different things that once shared one word on screen, and the whole of this section exists because that collision produced a dead end nobody could get out of.
  An Organization is the Hub tenant the session is anchored to; a Sales workspace is the internal view group (`tatico`, `operacional`, `cadastros`, `meus-dados`) that the URL names.
  The Hub gives each Application its OWN Organization context, so switching Organization in the Hub web does NOT move Sales' session, and Sales anchors on the account's primary Organization at session mint.
- An operator whose active Organization does not carry FXL Sales gets `402 {error: 'payment_required', code: 'missing_entitlement'}` from `apps/api/src/middleware/app-auth.ts` on every sales-ops call, and that `402` is CORRECT.
  What was wrong was that the shell rendered it as `A API de vendas não respondeu corretamente. Verifique o servidor local e tente novamente.`, which blames a machine that answered perfectly and said exactly why, and that the shell's account dropdown offered only `Sair`, whose re-login lands on the same Organization and therefore in the same dead end.
- The classification chain in `SalesOpsApp`'s `isError` branch is `isEntitlementFailure` then `isAuthFailure` then generic, and the INVARIANT is that the generic `Verifique o servidor local` copy is reachable ONLY for an error that is neither an entitlement failure nor an auth failure.
  The entitlement branch is deliberately FIRST.
  `isAuthFailure` is false for a 402 today, so the order is not what makes the branch reachable now - it is what keeps it reachable if `isAuthFailure` is ever widened, because a widened predicate placed above it would silently steal every 402 into `Sessão expirada` and the operator would be told to sign in again to fix an entitlement they do not hold.
  The four cases are pinned together in `apps/web/src/sales-ops/__tests__/entitlement-dead-end.test.tsx`, which drives the REAL `apiFetch` error path with `../api`, `@/lib/api-client` and `../hooks` unmocked, so it proves the status survives into the `ApiError` the shell classifies rather than only pinning a ternary.
  Replacing the panel with an empty fragment is the decisive mutation and goes red on the `[data-missing-entitlement]` marker, so the 402 case cannot pass by rendering nothing.
- `isEntitlementFailure` in `apps/web/src/lib/require-token.ts` keys on `status === 402` ALONE and deliberately does NOT also require `code === 'missing_entitlement'`.
  `apiFetch` builds its error from `await res.json().catch(() => ({}))`, so a 402 whose body does not parse - a proxy error page, a truncated response, a gateway that rewrites the payload - carries no `code` at all, and requiring the code would classify exactly that response as NOT an entitlement failure and route it straight back onto the `Verifique o servidor local` copy this work exists to remove.
  The two failure modes are asymmetric: keying on the code fails CLOSED onto that lie, keying on the status fails OPEN onto a panel that names the Organization and offers a switch.
  The predicate stays narrow otherwise - no `>= 400`, no error-string alternative, strict `===`, `null` and `undefined` handled - and `isEntitlementFailure is true for a 402 that carries no code at all` is the pin that fails the day someone makes the code mandatory.
  A SECOND 402 code meaning something other than "no Sales entitlement" is the one thing that would invalidate this, and that is the day the predicate must grow a discriminator.
  `require-token.ts` still imports NOTHING, so the predicate is duck-typed on `status` rather than importing `ApiError`, which would be a cycle.
- `MissingEntitlementPanel` in `apps/web/src/sales-ops/MissingEntitlementPanel.tsx` is the honest state: it names the currently active Organization, then offers switching to another of the account's Organizations, then a Hub checkout link for the active one, in that order.
  Switch comes before checkout because switching is free and instant while checkout costs money, and offering the expensive escape first would sell an entitlement to an operator who already holds one next door.
  Its `onRetry` prop is OPTIONAL and the shell passes NOTHING.
  That is not an oversight: `setActive` already runs `queryClient.clear()`, which DESTROYS the query so its observer re-subscribes at `status: 'pending'` and the shell renders the loading skeleton, whereas a `refetch()` would leave the query at `status: 'error'` and keep this panel on screen still naming the OLD Organization the operator has just left.
  Nothing in the panel calls `window.location.reload`, and the oracle installs a `reload` spy and asserts it was never called on both the success and the `setActive`-rejects paths.
  The checkout href is unreachable while it is resolving, because `CheckoutState` is a discriminated union and `href` exists only on its `ready` member, so TypeScript itself forbids an anchor with an unresolved destination; the loading branch renders a `Skeleton` and never an empty state.
- `useOrganizations()` in `apps/web/src/auth/react.tsx` is the ONE place `setActive` plus the token's `workspaces` claim is projected, and it is a THIN projection: no state, no request, no timer, and above all no reimplementation of `setActive`, which is handed through BY REFERENCE.
  `setActive` owns a four-statement critical section whose ordering this file documents at length and whose two orderings have dedicated oracles, so there must be exactly one copy of it in the app; the seam must never call `queryClient.clear()` itself, because that second flush would land on the WRONG side of the `await` and is precisely the failure the in-flight oracle exists to catch.
  `others` is derived HERE, as `workspaces.filter((w) => w.id !== active?.id)`, so no caller re-derives it - a per-call-site filter is exactly where name matching creeps back in, and there are two callers.
  When `active` is null it removes nothing, which is the honest answer: if we cannot tell where the operator is, every Organization is somewhere else they could go.
- The active Organization is matched by the `workspaceId` claim and NEVER by name.
  A name cannot disambiguate two Organizations both called `Alpha`, it yields nothing whenever the name claim is absent, and it misses entirely whenever the active Organization sits outside the capped `workspaces` preview - all three were live defects in `HubUserControls`, which marked the active entry by name before this.
  The name match survives only as the documented fallback for a token carrying no `workspaceId` claim, so such a token degrades to yesterday's behaviour rather than reporting that no Organization is active, and it must never be promoted back to the primary path.
  `active.name` prefers the top-level `workspaceName` claim over the matched preview entry, because that claim describes the ACTIVE Organization and is present even when the preview does not contain it.
- The sales-ops account dropdown carries its own Organization section above the `Sair` group, driven entirely by the same seam, because the shell draws its own chrome and never renders `HubUserControls`.
  Its render guard is `others.length === 0` and must NOT be `organizations.length > 1`.
  The one-entry-preview-that-is-not-the-active-Organization case is the whole point: the account has somewhere to go and the arithmetic guard hides it, which is the dead end all over again with a different cause.
  `workspaces` is a CAPPED, display-only preview, so an empty picker must never render and both zero-target cases (one Organization total, and an empty preview) return `null` after the hook call rather than an empty list.
  The active row is rendered but `disabled` and `aria-current`, never a switch target; a raw id appears only in the secondary line behind `isOrgLabelFallback`, in muted monospace, and never as the primary label.
- The sidebar view-group chrome was renamed from `Workspace` to `Painel`, and the fence is hard: ONLY display strings moved.
  `SalesOpsWorkspace`, the `workspace` URL segment, `getVisibleWorkspaces`, `salesOpsWorkspaces`, `workspaceForView`, `resolveSalesOpsRoute` and `buildSalesOpsPath` are unchanged, and `navigation.ts` is byte-unchanged, because the URL remains the single source of truth for the active Sales workspace and page and renaming the type or the segment would rewrite every stored link an operator holds.
  Five strings moved and no more: `Trocar workspace` to `Trocar painel`, the eyebrow `Workspace` to `Painel`, the collapsed trigger's `aria-label` `Workspace: ${label}` to `Painel: ${label}`, the scrim's `Fechar workspaces` to `Fechar painéis`, and the menu heading `Workspaces` to `Painéis`.
  The two `aria-label`-only renames are NOT pinned by any test, because `textContent` does not see an attribute, and that gap is recorded rather than hidden - the visible strings are pinned both by presence and by `not.toContain('Workspace')` on the sidebar text.
- `?organization=` deep linking is NOT available on `@fxl-business/hub-sdk` 1.3.x, which drops the parameter, so do not build a link that relies on it.
  It belongs to the parked SDK 2.1.0 migration run, and until that lands a switch is always an in-app `setActive` call.

## Arquivamento e histórico

- There is still no DELETE **verb**: `salesOpsRouter` exposes none and must not gain one. "Arquivar" is a status-only PATCH on the endpoint that already exists, and it is reversible from `cadastros/geral`.
  A hard delete now happens in exactly ONE place - the nightly `runArchivedCadastroPurge()` job - and only for a row that is archived, older than 30 days, not a system função, and that **nothing references**.
- The purge lets the DATABASE decide what may be deleted. It attempts the `DELETE` and treats a Postgres `23503` foreign-key violation as "still referenced, skip"; it never hand-writes an "is it referenced?" query, because that would drift out of sync with the schema the moment a new FK is added.
  The existing FK rules are therefore the safety mechanism, and no `ON DELETE CASCADE` may be added to `sale_items.product_id`, `sales.seller_person_id` / `finder_person_id`, `sale_professionals.person_id` / `funcao_id`, `person_funcoes.funcao_id`, `product_funcao_costs.funcao_id` or either `area_id` - each of those is what makes a produto or pessoa with real history undeletable.
  The two CASCADE edges that DO exist (`product_funcao_costs.product_id`, `person_funcoes.person_id`) are the item's own configuration rather than shared history, so losing them with the item is correct.
- Each purge is one transaction per row: the `cadastro.purged` ledger entry is written FIRST with the transaction handle, then the delete. A `23503` rolls the whole thing back, entry included, so a skipped purge leaves no trace - which is also the atomicity oracle, because the FK violation is a failure that lands AFTER the ledger write.
  `actor_user_id` is the `'system'` sentinel and `actor_org_id` is the purged row's OWN org: a NULL there would make the entry invisible to the tenant's org-scoped history, hiding the deletion from the only screen meant to show it.
- Archived rows are hidden from the four cadastro LISTS and from every picker, and nowhere else. They still render wherever a record already references them - a sale item's produto, a person's função chips, a produto cost row's função, `selectableAreas`' archived-but-current área - and those paths are load-bearing, not incidental.
  Because an archived row is no longer listed, there is no row-level `Restaurar`; restore exists only in `Histórico de arquivamentos`. A purged entity offers none at all and reads `Excluído definitivamente`.
  The PATCH body carries `status` and nothing else, so a stale cached `name` or `funcaoIds` can never be written back as a side effect of archiving or restoring.
  Produto, área and função archive to `archived`; a pessoa goes to `inactive`.
- A **cliente cannot be archived**: `sales_ops_clients` has no `status` column, `ClientSchema` declares no such key, and zod strips unknown keys, so `PATCH /clients/:id {"status":"archived"}` answers `200` with an unchanged row - a silent no-op that reads as success. Do not add the control before the column; the six-step recipe is in `nexo/runs/feature-20260805-cadastro-archive-history/00-OVERVIEW.md`.
- Archiving and restoring append a hash-chained `audit_log` entry from INSIDE the same `withTenant` transaction as the status write, so a status change can never land without its ledger row.
  Only the archive/restore lifecycle is audited; an ordinary rename or price edit writes nothing, because the ledger cannot be purged and every audited write queues behind a global tail lock.
  Handing `writeAuditEntry` the pooled `db` instead of the transaction's `tx` compiles cleanly and silently breaks that guarantee - the only assertion that catches it is a `DEFERRABLE INITIALLY DEFERRED` constraint trigger firing at COMMIT, because both ordinary rollback probes throw before the entry exists and pass either way.
- The actor's display name is SNAPSHOTTED at write time from the verified token (`name`, then `email`, then `null` - never the account id), because `sales_ops_people` has no account-id column and the Hub SDK exposes no directory. There is no join path from a Hub account id to a pessoa, so without the snapshot the history could only ever name the reader themselves.
- `GET /api/v1/sales-ops/history` is org-scoped and is NOT the same thing as `/api/v1/admin/audit`.
  That admin router reads through `getAdminDb()`, documents `audit_log` as cross-tenant, and applies no org filter at all, while `requireAdmin` here is synthesized from a Hub WORKSPACE owner/admin flag rather than a platform superuser - pointing an operator at it would hand one tenant every other tenant's audit trail.
  `audit_log` carries no RLS, so `eq(auditLog.actorOrgId, orgId)` is the ONLY control enforcing isolation. It is deliberately the conditions array's first literal element, the query schema declares no org key so a smuggled `?orgId=` is never read, and the history service must never import `getAdminDb`.
- `audit_log.id` is a `bigserial` that arrives as a JS `BigInt`, which `JSON.stringify` throws on. Project `String(row.id)`. `/api/v1/admin/audit` still does not, and 500s on any non-empty ledger - see `nexo/ROADMAP.md`.
- A restore is a NEW ledger entry, never an undo: the chain is append-only and hash-verified, so no UI may imply the history was rewritten. `Restaurar` is offered only where it can succeed - an archive event whose entity is still archived, non-optimistic and not a system função - and an already-active entity reads `Já restaurado` rather than showing a button that would 200 and do nothing.

## Pessoas e Funções

- A Pessoa is the single people cadastro; a Função is an org-scoped role assigned to a pessoa. They are separate entities with separate Cadastros screens.
- `vendedor` and `finder` are the only system funções (`isSystem: true`), seeded per org. They cannot be renamed or archived, the API answers `409 funcao_is_system`, and the UI therefore exposes no edit affordance for them at all.
- Every other função is org-created and dynamic (designer, desenvolvedor, tester, P.O.) and is what the proposta professional-cost rows draw from. `Prestador` is one of these, not a system função, so never special-case its slug.
- A função is never deleted, only archived via `status`, exactly like an área. `salesOpsRouter` has no DELETE verb. An archived função stays visible on the people who already carry it but disappears from the assignment picker.
- The `sales_ops_people` columns `is_seller`, `is_finder` and `is_collaborator` are deprecated derived mirrors that the API still returns but the web type no longer declares. Web code goes through `hasFuncao` in `apps/web/src/sales-ops/SalesOpsApp.tsx`, never through a per-call-site slug comparison and never through a mirror.
- `isCollaboratorPerson` is GONE from `apps/web`; a tombstone comment sits where it was declared in `apps/web/src/sales-ops/SalesOpsApp.tsx`. It meant "carries at least one non-system função", character for character how the API still derives `is_collaborator` in `deriveBooleanMirrors`, neither side considering `status`. Both call sites are retired: the produto Prestador picker (a produto default cost keys on a `funcaoId` now) and the proposta wizard's Profissional picker, which partitions on the ROW's `funcaoId` instead - see the Propostas domain entry. Do not reintroduce it. "Carries at least one non-system função" is not a question this app asks any more; `person.funcaoIds.includes(rowFuncaoId)` is.
- Person writes send `funcaoIds` as a full set replacement; the API rejects an empty set with `funcao_required`. There are no assignment sub-resource endpoints.
- Hub `AppRole` values (`admin`, `seller`, `finder`) and `roleSummaryLabel` are unrelated to funções. Workspace visibility keeps deriving purely from `profile.roles`, never from a função assignment.

## Produtos & Serviços

- `cadastros/produtos` is one screen labelled "Produtos & Serviços". The route segment stays `produtos`; what changed is the nav label, the page title and its subtitle. The wizard's missing-área hint points at `Cadastros > Produtos & Serviços` to match.
- Every catalog row carries `kind: 'product' | 'service'` (pt-BR labels Produto/Serviço). BOTH kinds may carry an own value in `setupBrl`/`monthlyBrl`. For a Produto it is a catalog price; for a Serviço it is a BASE VALUE - a suggestion the proposta prefills and the operator negotiates, exactly like every other number in that dialog. `0` is the whole expression of "no base value": there is no separate flag, the list prints `Variável` instead of `R$ 0,00`, the product dialog seeds the field BLANK with a `Definido na venda` placeholder rather than a literal `0` (`centsToOptionalInput`), the wizard prefills `"0"` into an item's `Valor negociado`, and the step-1 negotiated-value gate still blocks. That is what every pre-0015 Serviço stores, so nothing about an existing Serviço changed.
- The old "a Serviço has no own value" invariant is gone, and with it all four of its enforcement points: `sales_ops_products_service_no_fixed_value_check` (dropped by `0015_servico_base_value`), the `service_cannot_have_fixed_value` zod refine, the `INVALID_PRODUCT_KIND_VALUE` sentinel with its `updateProduct` merged-row guard and its `routes.ts` 400 branch, and the dialog's `isService ? 0 :` submit coercion. `DefinedOnSaleNotice` (`Definido na venda`) and the `Serviços têm valor variável, definido em cada proposta.` banner are deleted too - the dialog already says once, at the top, that everything in it is a default.
- `openPrice` survives only as a server-written projection of `kind`, enforced by `sales_ops_products_kind_open_price_check` (`(kind = 'service') = open_price`), which slice 07 deliberately did NOT relax: that CHECK asserts "this row is a Serviço", and a Serviço carrying a base value is still a Serviço. `openPrice` never meant "has no own value" - that was only ever the constraint above, and slice 07 rewrote every web reader that conflated the two. What survives in `apps/web` is exactly two CLASSIFICATION reads, both fallbacks for a row whose `kind` never arrived: `productRowRequirements` and the wizard's edit-path `customLabel` prefill. Deliberately not folded into `isServiceProduct`, because an unclassifiable row must keep its negotiated-value gate rather than pass as a fixed-price Produto and let an item through at R$ 0. No MONEY read consults it any more; that question goes through `productBaseValueBrl`. The product dialog has no `Preço em aberto` switch and never sends `openPrice`; the `Produto | Serviço` segmented control is the single way to express the same fact.
- `isServiceProduct` in `apps/web/src/sales-ops/calculations.ts` is the one place any branch on the discriminator happens, and `productBaseValueBrl` beside it is the one place a catalog own value is read (`setupBrl || monthlyBrl`, integer CENTS, `0` = none; the `||` is why a row with no setup that recurs suggests its mensalidade). Every unit-price prefill and the Serviço `Valor` column go through it, so "does this row suggest a price" is never re-derived per call site. `productForm` reads `product.kind` directly only to seed the dialog's own state. A row without `kind` reads as a Produto.
- The list is one table filtered by a `Produto | Serviço` segmented bar that renders inside the card and above the empty state, so an empty bucket is never a dead end. Serviço trades the `Setup | Mensalidade | Recorrente` columns for `Valor | Plano padrão | Custos padrão`, and the `Valor` cell prints `productBaseValueBrl` when it is non-zero, `Variável` when it is `0`. The dialog names that same number `Valor base (R$)` for a Serviço and `Setup (R$)` for a Produto.
- The kind filter is component state in `SalesOpsApp`, not URL state: the URL is the source of truth for the workspace and the page, and this is neither. The header action reads it, so it cannot live inside `ProductsView`.
- Every value in the product dialog is a DEFAULT that a proposta may override. The dialog says so once, at the top, and the commission section is titled `Comissionamento padrão`.
- The default payment plan is six flat columns, not a nested object: `defaultPaymentMethod`, `defaultEntradaMode` (`'none' | 'pct' | 'fix'` - the literal is `fix`, never `fixed`), `defaultEntradaPct`, `defaultEntradaBrl` (cents), `defaultRemainingInstallments`, `defaultRecurringCycles`. `'none'` plus `1` IS the app default and reproduces a single cash parcela, so there is no "no plan" state. The recurring amount is deliberately absent: it is `monthlyBrl`, and `hasMonthly` already means "recurs".
- A blank `Número de ciclos` is the only way to express prazo indeterminado, and it submits `defaultRecurringCycles: null`. There is no `Prazo indeterminado` checkbox in the product dialog.
- The entrada row sits on top of `defaultRemainingInstallments` when the plan is materialized, and the sale write endpoints cap `installments` at 120. The editor therefore caps the pair: 120 remaining parcelas with no entrada, 119 with one.
- Default costs per função live in `sales_ops_product_funcao_costs` and reach the web FLAT under `bootstrap.productFuncaoCosts`, never nested on a product, so every consumer scopes them by `productId`. A row is `{funcaoId, mode: 'pct', valuePct}` or `{funcaoId, mode: 'fix', valueBrl}` where `valueBrl` is integer CENTS. Never format one with `formatProductCommission`, whose `fix` branch formats reais; use `formatFuncaoCost`.
- A NEW função cost row draws from active, non-system funções only. `vendedor` and `finder` are already paid by `Comissionamento padrão`, so offering them here would create two competing ways to pay one role. A função already used by another row is filtered out, so the client can never trip `duplicate_funcao_cost`.
- A row's OWN stored função always stays selectable on that row, resolved against the unfiltered `funcoes` and labelled `<nome> (arquivada)` when archived. Funções are never deleted, only archived, so a cost row pointing at an archived função is the expected end state of archiving one that carries money; hiding it would make the row read as money owed to nobody and would let a stray edit silently retarget the cost. A `funcaoId` that resolves to nothing at all reads `Função não encontrada`, never a raw id.
- That is the same principle the Pessoa dialog follows, reached differently because the two dialogs are shaped differently. A pessoa splits the job across two controls, so `assignedFuncoes` resolves the chips from the unfiltered list while `selectableFuncoes` offers only active ones - which is why an archived função really does vanish from *that* picker. A cost row is one control doing both jobs, so the stored value has to be admitted into the row's own options; the direct precedent is `selectableAreas` in this same product dialog, which prepends an archived-but-current área into the picker it belongs to.
- `sales_ops_products.providers` is deprecated and has no editor. Product writes OMIT the key rather than sending `[]`, so a PATCH leaves the column untouched, and the dialog surfaces the legacy names read-only inside the função cost section for manual re-entry. There is no backfill from `providers` to `productFuncaoCosts` and there cannot be one: a provider row keys on a free-text `personName` with no deterministic mapping to a `funcaoId`.
- `code_suffix` is UNIQUE per org (`sales_ops_products_org_code_suffix_idx`, no `WHERE` clause), so an archived produto permanently occupies its slot.
  A NEW produto seeds the field from the pure `nextProductCodeSuffix` in `apps/web/src/sales-ops/calculations.ts`: max+1 over every produto in the org, both `kind`s and both statuses, gaps deliberately left unfilled, non-numeric values ignored, numeric rather than lexicographic ordering, and a lowest-free fallback past 99.
  The EDIT path is guarded by the `??` short-circuit on `modal?.product`, the same shape as the `name` seed, so an existing produto always renders its stored suffix and can never be silently renumbered.
  The API still has no 23505 handling, so a genuine collision surfaces as a bare 500 - see `nexo/ROADMAP.md`.

## Propostas domain

- Every deal is a Proposta with statuses `draft|open|won|lost|cancelled` (pt-BR labels Rascunho/Aberta/Ganha/Perdida/Cancelada).
- Payables materialize only when a proposta transitions to `won`.
  `seller_commission`, `finder_commission` and `tax` are generated per receivable row and linked via `payables.receivable_id`; `professional_cost` is now ALSO per receivable, split across the INSTALLMENT rows only by `resolveProfessionalSplit`; `other_cost` alone stays one-shot with `receivableId: null`, because it names no beneficiary - its `beneficiaryName` is the literal `'Outros custos'` - and has no wizard row to hang a schedule on.
- The split deliberately skips every `M`-prefixed recurring receivable.
  An indefinite recorrência generates no bounded rows at all, so any design that included them would need this branch anyway; spreading a pay-once cost over 24 cycles delays a professional's pay years past delivery; and the installment rows are the only ones the wizard can preview, since step 2 holds `installmentRows` and the recorrência as separate state.
- A proposta with NO eligible installment receivable at win - every row `M`-labelled or void - falls back to the legacy one-shot `professional_cost` at the won date with `receivableId: null`.
  That branch is what keeps `cancelContract` on a pure-recurring sale behaving exactly as before.
- `sales_ops_sale_professionals.cost_split_bp` (`jsonb`, nullable, migration `0017_professional_payment_split`) is the per-professional payment schedule: 1..120 non-negative integers in BASIS POINTS summing to exactly `10000`.
  `NULL` means the default, which is `cost_brl` distributed pro rata over the installment receivable amounts.
  Basis points and not cents, deliberately: `cost_brl` is edited one control away in the same wizard row, so a cents array would go stale on every cost edit and would need a cross-field refine plus a rewrite inside `Restaurar padrão` and inside every cost keystroke, whereas bp keep `cost_brl` (how much) and the schedule (when) ORTHOGONAL.
  It is a column and not a child table for the mirror image of the reason `sales_ops_product_funcao_costs` is a table: that one holds a `funcao_id` which must not dangle inside jsonb, while a split part holds no id at all, only a number.
  The `Σ === 10000` rule is enforced in `SaleProfessionalSchema`, not in SQL, because a `jsonb` array sum needs a subquery a CHECK cannot contain.
- The part count is INDEPENDENT of the parcela count, because "this one receives in 1 time" on a three-parcela plan is the whole feature.
  Parts bind POSITIONALLY and FRONT-ALIGNED to the installment receivables in due-date order: part `i` pays out of parcela `i`.
  Fewer parts than parcelas means the later parcelas carry no `professional_cost` at all; more parts than parcelas folds the tail weights into the last available parcela.
  Front-aligned rather than back-aligned so that adding a part never renumbers the ones already there.
  The rule is total for every stored value against every plan, which matters because step 2 can be revisited after step 3.
- `splitCentsByWeights` in `packages/shared-utils/src/professional-split.ts` is the ONE distribution primitive, following the `computeSaleFinancials` precedent of a single shared implementation rather than two copies: every part but the last is `floor(total × w / Σw)` and the LAST absorbs the whole remainder, so `Σ parts === total` exactly for every input, and for equal weights the output is byte-identical to `splitInstallmentsEqually`'s amounts - pinned by a direct test so the two rounding rules cannot drift.
  Every caller normalizes to basis points through `defaultSplitBp` first, which is also what keeps `total × w` inside `Number.MAX_SAFE_INTEGER` given that both `cost_brl` and a receivable amount are Postgres `integer`s.
- Newly materialized `professional_cost` payables persist `sale_professional_id` from the originating `sales_ops_sale_professionals` row.
  Current split-row idempotency matches durable professional ID plus receivable ID, never display name.
  Migration `0018_professional_payable_identity` backfills only one unambiguous same-organization, same-sale, same-beneficiary match and leaves ambiguous identities null.
  Null-ID split rows use a consumable `(beneficiary_name, receivable_id, amount_brl)` multiset, so one historical row suppresses at most one candidate.
  A surviving v2.3.1 full-cost one-shot has a null receivable and covers exactly one professional before per-receivable parts are considered.
  An identified full-cost one-shot covers its durable professional ID, while an ambiguous null-ID one-shot is consumed once by beneficiary snapshot plus full cost.
- Migration `0018_professional_payable_identity` is applied in phases by the shared repository migration runner.
  Its indexes are built concurrently, its foreign key is added as not valid and then validated, and its conservative backfill runs in bounded transactions.
  Production and integration startup must use the shared runner instead of the stock all-migrations Drizzle transaction.
- `Detalhe de pagamento` is an IN-FLOW disclosure inside the step-3 professionals table, spanning the row with `col-span-full`, and it deliberately does NOT call `useInlineLayer`.
  That hook guards ABSOLUTELY POSITIONED layers - `Combobox`'s panel, `InfoHint`'s panel - where an Escape aimed at the layer would otherwise close the whole wizard.
  An expander that pushes content in flow is not such a layer, and the existing precedent is `SaleItemForm.descriptionOpen`, which does the same thing the same way.
  It lives in its own `apps/web/src/sales-ops/ProfessionalSplitPanel.tsx`, and its trigger sits inside the existing `CUSTO ALOCADO` cell as that cell's last child, so the slice edits no grid template and adds no column.
- Each part is entered as a PERCENTAGE and prints its resolved reais beside it; there is no `R$` input mode per part and there must not be one.
  A reais-denominated part would have to be reconverted on every `CUSTO ALOCADO` keystroke, one control away in the same row, and would be stale in between - which is the same reason `cost_split_bp` stores basis points rather than cents.
  The wizard's preview calls the SAME `defaultSplitBp` / `splitCentsByWeights` the server calls, over `installmentRows` and nothing else, so the parcela amounts on screen are the payables that will be written at win.
  `ProfessionalForm.costSplitBp` and `.splitOpen` are REQUIRED and non-optional so TypeScript catches every one of the three row constructors; an optional field would let a forgotten seed send `undefined` and silently mean "no override".
- `canAdvanceStepThree` gates on `professionalSplitsValid` as well as `professionalsValid`: an override must have between 1 and `installmentRows.length` parts and must sum to exactly 10000 bp.
  Adding or removing a part deliberately does NOT renormalize - the `Soma` line goes red and the operator fixes it, exactly as step 2's `Soma das parcelas` behaves.
  Only `Distribuir igualmente` and `Personalizar divisão` write a guaranteed-100% vector, and both go through `splitCentsByWeights`, so the editor obeys the same last-part-absorbs-the-remainder rule as everything else.
  The panel's no-parcela branch is a guard, not a reachable screen: `canSaveBasics` requires `totalCents > 0` and step 2's `planRowsValid` requires every parcela amount `> 0`, so the operator cannot reach step 3 with an empty plan; it is asserted by rendering the panel directly.
- Leaving `won` (revert, lose, cancel) voids only `open` payables and receivables; `paid` rows are never touched.
- Payment plans are explicit installments `[{dueDate, amountBrl, method}]` plus an optional recurring block `{monthlyBrl, startDate, cycles|null}` (`cycles: null` means indefinite, no bounded rows generated beyond any setup parcela).
- Receivable label conventions `"N/M"` (installment N of M) and `"MN/M"` (recurring cycle N of M, `M` prefix) are load-bearing: `deriveWizardPrefill` in `apps/web/src/sales-ops/SalesOpsApp.tsx` parses the `M` prefix to split installment rows from recurring rows when prefilling the edit wizard.
- Wizard step 2 is a DECLARATIVE builder, not a manual editor: `Entrada (nenhuma | % | R$ fixo)` plus `Restante em N x` plus `Recorrência (nenhuma | mensal)` regenerate the `Parcelas a receber` table live, and every generated row stays individually editable.
  The `Dividir em` / `Número de parcelas` / `+ parcela` / `Remover parcela N` / `Adicionar recorrência` controls are gone, and `not.toContain` guards in `apps/web/src/sales-ops/__tests__/sale-wizard-ui-contract.test.ts` fail if any of those strings comes back.
- The generation rules are pure exported functions in `apps/web/src/sales-ops/calculations.ts` - `PaymentPlanShape`, `entradaCentsFor`, `generateInstallmentPlan`, `inferPaymentPlanShape`, `defaultPlanShapeForProduct` - and the wizard holds only state and calls them.
  `PaymentPlanShape.entradaMode` reuses the produto cadastro's literals `'none' | 'pct' | 'fix'`, so `fix` is the one spelling in the codebase for both the stored template and the per-proposta builder.
- The restante split delegates to `splitInstallmentsEqually`, whose LAST row absorbs the whole floor remainder, so `entrada + Σ restante === total` exactly for every input and `Soma das parcelas` can only disagree with the total after a manual row edit.
  The API's `materializeDefaultPaymentPlan` puts that remainder on the FIRST restante row instead, so the two disagree on placement; that is inert today because the function has no production caller.
  Were it wired up, `inferPaymentPlanShape` would read an API plan whose restante does not divide evenly and that HAS an entrada as hand-edited, which is the safe outcome, but one with NO entrada as a `R$ fixo` entrada plus n-1 parcelas.
  That second reading is arithmetically exact and loses nothing - it reproduces the stored rows to the cent - but it labels as an entrada what the API meant as an ordinary first parcela.
  Both cases are pinned in `apps/web/src/sales-ops/__tests__/payment-plan-generation.test.ts`, so this paragraph cannot drift away from the code again.
- `addMonthsToIsoDate` clamps to the last valid day of the target month, matching the API's `addMonths` in `apps/api/src/domains/sales-ops/service.ts`; before this it rolled `2026-01-31` over to `2026-03-03` while the API persisted `2026-02-28`.
  Every due date is recomputed from the anchor with an absolute month offset, never stepped one month at a time, so a clamped February cannot drift the months after it.
- Manual plan edits are governed by one whole-plan `planDirty` flag, never per-row pinning, because recomputing an entrada or a restante redistributes value across every row to hold the exact-sum invariant.
  A row date or amount edit sets it and freezes the rows; a `Forma` edit does NOT, because methods are carried positionally through a regeneration.
  Changing a header control while dirty raises an amber confirm bar (`Aplicar` / `Manter parcelas`) instead of regenerating, and both `Aplicar` and the header's `Regerar plano` clear the flag AND `appliedPlanKey`, because a row edit alone leaves the key untouched and the guard would otherwise find nothing to do.
- `inferPaymentPlanShape` reads a shape back out of stored rows by regenerate-and-compare over three ordered candidates (`none`, a clean percentage, a fixed value), comparing `dueDate` and `amountBrl` but not `method`.
  `matchesFormula: false` means the rows are hand-tuned: they are kept verbatim, the header only describes them, and nothing but an explicit `Aplicar` or `Regerar plano` click overwrites them.
  A false negative costs one extra `Plano ajustado manualmente` line; a false positive is impossible, because `matchesFormula` is only true after a full regenerate-and-compare.
- A blank `Número de ciclos` is the only way to express prazo indeterminado in the wizard too, exactly as in the product dialog; there is no `Prazo indeterminado` checkbox anywhere.
- `defaultPlanShapeForProduct` is the single seam by which a produto's `defaultEntradaMode` / `defaultEntradaPct` / `defaultEntradaBrl` / `defaultRemainingInstallments` reach a proposta, applied through a render-phase guard keyed on the product ID and its template and skipped while `planDirty` is true.
  `defaultPaymentMethod` and `defaultRecurringCycles` are persisted and editable in the cadastro but are not read by the wizard yet.
- Áreas are org-configurable (`cadastros/areas`) and required on every product and every proposal item; the old free-text product `Tipo` is gone from both the UI and the schema, and classification is Área plus the `kind` discriminator described under "Produtos & Serviços".
- Free-form proposal items are `productId`-null rows using `productName` as the description (same `productNameSnapshot` path as the open-price convention above) and require an `areaId` picked directly on the item.
- Every commercial number a produto supplies is a per-proposta DEFAULT, never a constraint: `sellerCommissionPct`, `finderCommissionPct`, `taxPct`, `otherCostsBrl` and each profissional's `costBrl` are editable inside one proposta and already have their own columns.
  A hand-typed value is PINNED by the per-field `manualOverrides` registry in `apps/web/src/sales-ops/SalesOpsApp.tsx`, so the render-phase `commissionDefaultsSource` guard re-applies a produto default only to fields nobody touched; the source key still advances unconditionally, so the guard cannot loop.
  On the edit path the registry is SEEDED by comparing each stored value against the default it would have inherited, which is what makes a mid-edit produto change unable to clobber a stored override; a stored value that equals its default is deliberately not pinned.
  `Alterado manualmente` renders only when a field is pinned AND diverges from the current default, and `Restaurar padrão` clears the pin and rewrites the default in one handler so the field rejoins the re-apply path.
- `sales_ops_sale_professionals` carries `funcao_id` plus `funcao_name_snapshot` behind a composite `(org_id, funcao_id)` FK to `sales_ops_funcoes` (migration `0014_sale_professional_funcoes`); the old free-text `role` is a DEPRECATED mirror written with the same string as the snapshot on every insert, never independently.
  `funcao_id` is nullable and MATCH SIMPLE skips the FK lookup when it is NULL, which is what lets a legacy row whose `role` matched no cadastro função keep its label; the backfill matches on `lower(btrim(...))` and invents no função from historical text.
  `FUNÇÃO NO PROJETO` is the FIRST column of `Profissionais alocados` and `PROFISSIONAL` the second, because the função is what partitions the person list.
  The person picker is DISABLED, placeholdered `Selecione a função primeiro`, until the row names a função; it then lists every ACTIVE pessoa who already carries that função in the headingless bucket and every other ACTIVE pessoa under the `Adicionar a esta função` group heading, which is `ComboboxOption.group` and needs nothing new in the primitive.
  Selecting a flagged pessoa GRANTS her that função through the `onAssignFuncao` prop, which `SalesOpsApp` wires to the ordinary `useSaveSalesOpsPerson` - so the bootstrap invalidation and the optimistic patch come for free and the flag disappears at once.
  The payload is her EXISTING `funcaoIds` PLUS the new one and must also carry `contactEmail`: person writes are a full set replacement and a PATCH that omits `contactEmail` clears it.
  Listing everyone unflagged before a função is chosen was rejected: it re-creates the unchecked pick this rule exists to stop, and leaves the grant with no moment to happen.
  The ONE exception is a legacy row carrying a free-text `funcaoName` with no `funcaoId` - it keeps the picker enabled and groups nobody, because there is no id to partition on and locking it would make a stored proposta uneditable.
  `FUNÇÃO NO PROJETO` is a Combobox over active funções; both free-text escape hatches (`Digite manualmente`, the seeded `role: 'Operacional'`) are gone and `sale-wizard-ui-contract.test.tsx` fails if either string returns.
  A fresh `+ profissional` row seeds NO pessoa - the old `allocatablePeople[0]` seed silently allocated whoever sorted first - so step 3 also refuses to advance with `Selecione a pessoa de cada profissional alocado.`, and `createPayload` drops a row whose `personName` is blank rather than sending one the API's `personName: z.string().min(1)` answers with a 400.
  `draftValid` deliberately does NOT gate on professionals, so `Salvar rascunho` stays reachable mid-edit.
- A profissional's `CUSTO ALOCADO` prefills from `sales_ops_product_funcao_costs` through `buildFuncaoCostBasis` in `apps/web/src/sales-ops/calculations.ts`, whose base is the ITEM SUBTOTAL of the proposta items whose produto declares that função, summed.
  The recurring mensalidade is excluded on purpose, and the per-receivable split did NOT weaken that: a `professional_cost` is still a PAY-ONCE TOTAL, so pricing it off a monthly stream would charge it against every cycle.
  The split re-prices nothing - it takes an already-computed `cost_brl` and decides only WHEN it is paid, under a `Σ parts === cost_brl` contract - and it skips the `M`-labelled rows too, so the money the cost is measured against and the money it is paid out of are the same non-recurring stream.
  That is a tighter invariant than before, not a looser one.
  Free-form items contribute nothing.
  The derivation is rendered under the input (`5% de FXL Custom (R$ 20.000,00)`) by `describeFuncaoCostBasis`, which reads the same entry the cents came from; a row goes `costManual` on the first keystroke and is never recomputed again, and a row prefilled from a STORED proposta by `deriveWizardPrefill` is `costManual` unconditionally, because a persisted cost is a saved decision.
  A row SEEDED from a produto on the create path is the opposite object and is deliberately NOT `costManual`: a produto number is a default that must keep following the item value, and a Serviço seeds at 75% of the `"0"` its `Valor negociado` prefills with, so pinning it would freeze the cost at R$ 0,00 for the whole session.
  The guard cannot clobber such a row either way, because it writes exactly the expression the seed used, and leaving it unpinned also keeps `Alterado manualmente` off a row nobody touched.
- A NEW proposta AUTO-SEEDS one `Profissionais alocados` row per função declared by the produtos on its itens, função filled from the cadastro and PROFISSIONAL left empty for the operator, through the pure `planFuncaoCostSeeds` in `apps/web/src/sales-ops/calculations.ts` driven by a fifth render-phase guard beside the `funcaoCostKey` one.
  The seed fires once per `(produto, função)` declaration, tracked by `funcaoCostSeedKey` in a session key set that only ever GROWS, which is what makes deleting a seeded row permanent, re-adding the produto inert, and a re-render a no-op; the ROW is deduped per função instead, so two produtos declaring `Mentor` produce two keys and one row carrying the summed basis.
  Only `editSale === null` seeds, so reopening a saved proposta can never add a row on top of its stored `sales_ops_sale_professionals`: the absence of a row there is itself a saved decision. Only funções that are currently allocatable seed, because a seeded row is a new assignment and an archived função disappears from assignment pickers; `buildFuncaoCostBasis` still reads the unfiltered declarations, so a hand-picked função still prefills.
  A seeded row needs no new gate: it arrives with a função, so the person picker is already unlocked, and the existing `professionalPeopleValid` bar (`Selecione a pessoa de cada profissional alocado.`) is what stops step 3 until every row names one or is removed via `Remover profissional N`.
  `draftValid` is deliberately still not gated on professionals, so `Salvar rascunho` stays reachable from step 1, and a personless row is dropped on the way out - the API declares `personName: z.string().min(1)`.
  That drop is expressed ONCE, by `professionalRowWillPersist` in `apps/web/src/sales-ops/calculations.ts`, which `createPayload`, the step-3 `professionalCents` sum and the `professionalPeopleValid` gate all reference: a personless row is excluded from BOTH the payload and the DISPLAYED cost, which is what keeps the `Margem líquida` on screen equal to the persisted `net_margin_brl`.
  Spelling `personName.trim() !== ''` at each call site instead is exactly how those two once disagreed - every seeded row is personless by definition, so a new proposta showed `Margem líquida R$ 15.500 / Custos profissionais R$ 1.300` while the `Salvar rascunho` in that same footer persisted R$ 16.800.
  The remaining limitation is deliberate and filed in `nexo/ROADMAP.md`: a rascunho saved before the pessoas are picked loses the produto's seeded funções permanently, because `if (!editSale)` correctly refuses to re-seed on reopen. It is made VISIBLE rather than prevented, by a muted `#6a6a72` line in `Profissionais alocados` shown only while some row has a função and no pessoa.
- The wizard's `CUSTO ALOCADO` accepts `%` or `R$` through the same `UnitToggle`/`UnitInput` pair the produto dialog uses.
  The unit is an INPUT MODE and is NOT persisted, because `sales_ops_sale_professionals.cost_brl` is a single integer-cents column and nothing ever re-evaluates a stored percentage against a later item edit; a saved proposta therefore always reopens in `R$` with the resolved cents, which is the decision that was saved.
  `cost_split_bp` is the deliberate opposite - persisted as a RULE rather than as cents - precisely because it MUST survive a later `cost_brl` edit unchanged.
  A `%` resolves through `resolveProfessionalCostCents` against `professionalCostBaseCents`, which is the função-scoped item subtotal, falling back to the total of all product-item subtotals when no produto declares the função (the inline-created função case), and never includes the recorrência in either branch.
  With no product item at all the base is zero and the row states so explicitly rather than writing a silent `0`.
  Toggling the unit pins the row (`costManual: true`) in both directions and never un-pins it, so the render-phase produto-default guard cannot resurrect a stale default over a derived number; only `Restaurar padrão` un-pins, and it also resets the unit to `fix` because restoring the produto default means restoring its cents.
- `computeSaleFinancials` in `packages/shared-utils/src/sale-financials.ts` is the ONE margin implementation: `buildSaleLedger` delegates its money block to it and the wizard drives its step-3 and step-4 panels from it, so the `Margem líquida` on screen equals the persisted `net_margin_brl`.
  Its semantics are the server's prior algorithm verbatim - `totalBrl = items + bounded recorrência`, `Σ floor` per receivable row, `netMarginPct` as `toFixed(2)` - so adopting it moved no persisted number. `apps/web` imports the `/sale-financials` subpath because the package root also re-exports the Node-only hmac module.
  The Revisão card's `Total` line reads `financials.totalBrl` for the same reason, so it states the basis `total_brl` persists rather than the itens total; rendering the itens total there let the card show a margin larger than its own total once a bounded recorrência existed. Step 2's `Soma das parcelas / total` keeps the ITENS total, because the API's `validatePaymentPlan` requires the parcelas to equal exactly that.
- `resolvePartyContexts` validates `sellerPersonId`, `finderPersonId` and every `professionals[].personId` / `.funcaoId` in-org inside the caller's `withTenant` transaction, throwing `SaleInputError` with `seller_not_found` / `finder_not_found` (`itemIndex: -1`) or `person_not_found` / `funcao_not_found` (the row index), which `routes.ts` already maps to `400 validation_error`.
  Its snapshots are server-authoritative: `personNameSnapshot` and `funcaoNameSnapshot` come from the resolved cadastro row and a disagreeing body label loses. Cross-org rejection is proven over an `app.fxl_admin` connection in `apps/api/test/rls/sale-professional-funcoes.test.ts`, because over the ordinary app connection RLS satisfies the assertion even with the `orgId` filter deleted.
- `sales_ops_settings.commission_on_recurring` is a DEAD setting: it is stored and editable but read by nothing that computes anything. Commissions are generated for every non-void receivable, bounded recurring rows included, and the wizard's payables preview no longer gates on it.
- Transition endpoints are `POST /sales/:id/transition` (`{status}` for open/won/lost/cancelled/reopen) and `POST /sales/:id/cancel-contract` (mid-contract cancellation on a won recurring sale); there is no free status write.
- Integration tests are pinned to the local Docker test database: `apps/api/.env` carries `TEST_DATABASE_URL`/`TEST_MIGRATE_DATABASE_URL`/`ADMIN_DATABASE_URL`, the app connects as the non-superuser `fxl_sales_test` role so RLS is genuinely enforced, and `apps/api/test/rls/setup-env.ts` hard-overrides `DATABASE_URL` so the suite can never fall back to whatever `.env` points the dev server at (staging, in this repo).

## Environments

| Level | Hub Client | Postgres | Secrets |
| --- | --- | --- | --- |
| local | `app.fxl-sales` local client | Local Docker | `.env.dev.example` copied to `.env` |
| staging | `app.fxl-sales` staging client | Coolify staging DB | Infisical `staging` env |
| production | `app.fxl-sales` production client | Coolify prod DB | Infisical `prod` env |

Required API vars:

```dotenv
FXL_HUB_API_URL=http://localhost:9016
FXL_HUB_ENVIRONMENT=development
FXL_HUB_CLIENT_ID=
FXL_HUB_CLIENT_SECRET=
FXL_HUB_AUDIENCE=app.fxl-sales
FXL_HUB_HEALTH_TOKEN=
FXL_HUB_REDIRECT_URI=http://localhost:8006/auth/callback
PUBLIC_LINK_BASE_URL=http://localhost:3006
```

Required web vars:

```dotenv
VITE_API_URL=http://localhost:3006
VITE_AUTH_PROXY_TARGET=http://localhost:3006
VITE_AUTH_BFF_BASE_PATH=
VITE_FXL_HUB_API_URL=http://localhost:9016
VITE_FXL_HUB_PUBLISHABLE_KEY=pk_fxl-sales_VzQ9-LUONCnlKllxCRLffN3nw6Z9PQl2
```

The API owns public referral redirects at `/r/:code`.
Keep `PUBLIC_LINK_BASE_URL` pointed at the API public origin.

## Commands

```bash
pnpm run lint
pnpm run type-check
pnpm test
pnpm run build
pnpm --filter @fxl-sales/api test:integration
```

`pnpm test` includes a tracked-file guard that fails when the removed auth provider is reintroduced.

## Shipping

Follow the Nexo flow in `AGENTS.md`.
Keep changes atomic, verify locally, capture the run under `nexo/`, commit with a Conventional Commit message, and push `master` after Gate 2 passes.

<!-- nexo:managed:start version=4 sha256=02fd055249adb37ac71ec0db87e5e313c575eadc762d972ac81c07a1a398a84b -->
## Nexo workflow contract

Nexo owns the delivery workflow while a Nexo flow is active.
Work moves through Frame, Plan, Execute, Verify, and Capture.
Feature and batch flows plan the complete initial slice set before execution, then adapt only within the finite runtime policy.

The human owns WHAT and why.
The agent owns HOW.
Gate 1 is human approval of WHAT and is skipped only by explicit autopilot.
Gate 2 is local verification and is never skipped.
Gate 3 is the human-approved release cut and is never automatic.

Verification is tiered.
Each slice runs its named locked oracle tests plus lint on changed files.
Each integrated wave runs the full suite, full lint, and security checks once.
Each feature runs mutation testing once after all waves are green.
Execute and Verify use separate agents whenever the host supports them and the user has not explicitly required single-agent execution.

Delivery is local trunk flow.
Verified short-lived branches merge serially to `main` with no pull request and no hosted CI requirement.
Promotion to `staging` and `production` exists only when `nexo/state.json` opts into it, and every promotion is fast-forward-only.
The user never commits by hand because Nexo owns branch, commit, verification, merge, and cleanup.

Autopilot never waits for a human and never expands a budget.
A blocker or exhausted budget is recorded in `AUDIT.md`, unfinished work is parked, owned worktrees and processes are cleaned up, and the run returns a partial completion report.
<!-- nexo:managed:end -->
