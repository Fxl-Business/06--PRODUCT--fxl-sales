---
id: 03-preserve-session-and-route
milestone: v2.4.0
status: todo
depends_on: []
files_modified: [apps/web/src/auth/react.tsx, apps/web/src/auth/session-recovery.ts, apps/web/src/auth/__tests__/react.test.tsx, apps/web/src/auth/__tests__/session-recovery.test.ts]
acceptance: "given a signed-in provider whose next token read resolves null, when the null is a transient refresh failure that recovers, then the profile stays signed in and `login()` is never called; and when the failure is genuine and the bounded revalidation ladder is exhausted, then the pre-login route is captured, `login()` runs once, the route is restored on the next mount, and a hostile stored value such as `https://evil.example/` is discarded instead of navigated to."
---

# Slice 03 - preserve the session across a transient refresh failure, and the route across a real re-login

## What is broken (from FRAME.md, treated as established fact)

`getToken` in `apps/web/src/auth/react.tsx:141-145` calls `applyToken(token)` on every token read.
`applyToken(null)` (lines 126-139) sets `isSignedIn: false`.
`HubProtected` (lines 199-213) reacts to `!isSignedIn` by calling `login()`, which is
`window.location.assign(`${bffBase}/auth/login`)` - a full page navigation that destroys every byte of
React state, including a half-filled produto form.
The Hub SSO cookie is usually still valid, so the browser bounces through `/auth/callback`, which the
API redirects to `resolveHubPostLoginRedirect` = `CORS_ORIGIN` = the web root = the dashboard.

Two independent defects sit on top of each other:

1. The provider cannot tell "the network hiccuped" from "your session is dead", and treats both as dead.
   Verified in `node_modules/.pnpm/@fxl-business+hub-sdk@1.2.0_hono@4.12.25/node_modules/@fxl-business/hub-sdk/dist/client.js`:
   `getToken()` wraps the `fetch` in `try { ... } catch { return null }` and then does
   `if (res.status !== 200) return null`, and finally returns `null` when the body does not parse.
   Three genuinely different outcomes collapse into one `null`.
   `createHubAccessTokenCache` in `apps/web/src/auth/token.ts:57-63` faithfully forwards that `null`.
2. Nothing remembers where the user was, and nothing can: the post-login target is decided server side.

## Part 1 - do not tear down the session on a transient failure

### Decision

Add a **bounded revalidation ladder** to `HubAuthProvider`, gated on whether a token has ever been
observed.

- A `null` observed when the provider has **never** held a token is applied immediately, exactly as
  today. This is the cold-start path: there is no profile to preserve and no in-progress work to lose,
  so an immediate `login()` is the fastest correct answer.
- A `null` observed when the provider **is** holding a token does **not** touch the profile at all.
  `isSignedIn` stays `true`, the React tree stays mounted, the form stays on screen.
  Instead the provider schedules a re-read of `tokenCache.getToken()` after a backoff, over a fixed
  ladder `SESSION_REVALIDATE_DELAYS_MS = [500, 1500, 4000]`.
  Any attempt that yields a token restores the normal path and resets the ladder.
  When the ladder is exhausted (four consecutive nulls, roughly 6 seconds of continuous failure), the
  provider gives up, applies `null`, and the ordinary `HubProtected` re-login path runs.
- Concurrent readers cannot amplify the ladder: while a revalidation timer is pending, further nulls
  are no-ops. Roughly 40 call sites read `getToken()` per screen; they must produce one ladder, not 40.

Six seconds is the ceiling on a broken half-authenticated state, so the "must not strand the user"
requirement is met by construction, not by hoping something else calls `getToken()` again.
During those six seconds the token reads legitimately return `null`; surfacing that to the user as an
auth error rather than a blank bearer token is slice 02's job (`apps/web/src/lib/require-token.ts`),
which this slice must not touch.

### Rejected alternatives

**Instrument `fetchImpl` and read the HTTP status.**
`createHubClient(config, { bffBasePath, fetchImpl })` accepts a custom fetch, so a wrapper could watch
for `POST ${bffBase}/auth/refresh` and record `401` (dead session) versus a thrown error or a `5xx`
(transient), giving a genuine dead-session signal and an instant, correct sign-out.
Rejected: it couples this repo to the SDK's internal request shape (path, method) with no type-level
protection, it is invisible to the existing tests because `createHubClient` is mocked there, and the
distinction buys at most ~6 seconds on the dead-session path while adding a second source of truth for
"are we signed in". If the SDK ever renames the endpoint the wrapper silently degrades to exactly the
ladder proposed here, which is proof the ladder is the load-bearing half. Ship the load-bearing half.

**Count consecutive nulls with no timer.**
Sign out only after N nulls, driven purely by whatever the app happens to ask for next.
Rejected: an idle user produces no further reads, so a genuinely dead session would leave the app
mounted and silently broken until the user clicked something. The bound has to be in wall-clock time.

**Never sign out on `null` at all, and only sign out on an explicit user action.**
Rejected: it is the "broken half-authenticated state forever" outcome the task forbids.

**Retry inside `createHubAccessTokenCache` (`apps/web/src/auth/token.ts`).**
Rejected: the cache's contract is "one in-flight refresh per provider, memory-only, cached to
`exp - 30s`" (CLAUDE.md, Auth Model). A retry ladder is session-lifecycle policy, not caching, and
burying it there would make `getToken()` block for seconds, which every one of those ~40 call sites
would inherit. The provider is the right owner because the provider is what owns `isSignedIn`.

### Redirect-loop guard (required, not optional)

The replica-mismatch failure in FRAME S1 can produce a genuine infinite loop: sign out, `login()`,
callback lands on a replica that does have the session, first refresh lands on one that does not,
sign out again. That loop exists today at full speed; the ladder would merely slow it to a 6 second
period. It must be capped.

`registerLoginAttempt()` records attempts in `sessionStorage` under
`fxl-sales.auth.loginAttempts` as `{count, firstAt}`.
Up to `MAX_LOGIN_ATTEMPTS = 3` attempts inside `LOGIN_ATTEMPT_WINDOW_MS = 60_000` are allowed; the
fourth returns `false`, `HubProtected` refuses to navigate and renders a terminal recovery panel with a
manual retry button.
Any successfully observed token calls `clearLoginAttempts()`, so a normal re-login (attempt 1,
callback, token) leaves the counter at zero and the guard can never fire in normal operation.

## Part 2 - preserve the route across a real re-login

### Decision

Client-owned capture and restore, both inside `HubProtected`, both mediated by one pure sanitizer.

- **Capture**: in the same effect that calls `login()`, immediately before it, store the current route.
  The value comes from React Router's `useLocation()` (`${pathname}${search}`), not from
  `window.location`. `HubProtected` is rendered as a route element in `apps/web/src/router.tsx`
  (six sites, all inside `createBrowserRouter`), so the router location is available and is the app's
  own truth. For a `BrowserRouter` the two are identical in production; using the router location is
  what makes the behaviour testable under `MemoryRouter` without stubbing `window.location`.
  CLAUDE.md, "Sales Ops Routing": the URL is the single source of truth for the active workspace and
  page, so restoring the URL restores the screen. No view state has to be captured, and per FRAME's
  scope limits no form draft is captured either.
- **Restore**: once `isLoaded && isSignedIn`, consume the stored value exactly once and, if it
  sanitizes and differs from the current route, `navigate(target, { replace: true })`.
  `replace` so the post-callback root entry does not linger in history and send the user back to the
  dashboard on Back.

### Storage: `sessionStorage`

Justified against the alternatives:

- It survives a full-page navigation and the `/auth/callback` round trip, which is the only thing that
  actually has to work here.
- It is scoped to the tab. A route captured in tab A cannot hijack a login happening in tab B, which
  `localStorage` would allow.
- It dies with the tab, so a route captured today cannot be restored next week. `localStorage` would
  keep a stale, possibly no-longer-authorized route alive indefinitely.
- It is never sent to the server, unlike a cookie, so it cannot influence the server-side redirect
  decision and cannot leak the operator's route into API logs.
- The URL fragment is unusable: the login navigation and the callback redirect are both
  server-controlled, so nothing this app writes into the URL survives the round trip.
- Every access is wrapped in `try/catch`. Safari private mode and hardened enterprise profiles can make
  `sessionStorage` throw on access. A storage failure degrades to "no route restore" and must never
  break authentication.

This does not violate CLAUDE.md's "browser Hub access tokens are memory-only": what is stored is a
relative path, never a token, never a claim, never an id.

### Safety rules for the stored value (`sanitizeReturnTo`)

Applied on write **and** on read. Read is the security-critical side; write is defence in depth.

A value is honoured only if all of the following hold:

1. It is a non-empty string of at most 2048 characters.
2. It contains no ASCII control characters and no whitespace.
3. Its first character is `/`.
4. Its second character is neither `/` nor `\`, which rejects the protocol-relative forms
   `//evil.example/x` and `/\evil.example` (browsers normalize the backslash).
5. `new URL(value, origin)` parses and yields `url.origin === origin`. This is the belt to rules 3-4's
   braces: `URL` normalizes backslashes and percent-encodings, so anything that would resolve
   off-origin is caught here even if it slipped past the character checks.
6. `url.pathname` is neither `/auth` nor under `/auth/`. Those paths are Vite-proxied to the API BFF;
   restoring one would bounce the user straight back into the login flow.
7. The normalized result `${url.pathname}${url.search}` is not `/`. `/` is the default landing route,
   so there is nothing to restore and nothing to store.

The hash is deliberately dropped: no app route uses it, and dropping it removes a class of injection
without costing anything.
An absolute URL is rejected even when it is same-origin (rule 3), because "only ever a same-origin
relative path" is far easier to keep true than "an absolute URL that happens to match".

**Consume exactly once**: `consumeReturnTo` calls `removeItem` **before** it validates, so an invalid or
hostile value is destroyed on the same read that rejects it, and a throw anywhere downstream cannot
replay the restore. `HubProtected` additionally guards with a `restoredRef`, so React 18 StrictMode's
double effect invocation cannot restore twice.

## Part 3 - `applyToken` on every read: fix it here? Yes, in its minimal form only

`applyToken` builds a fresh profile object and a fresh workspaces array on every single `getToken()`.
Both go through `setProfile` / `setWorkspaces`, which bail out only on `Object.is`, so every token read
produces a new context `value` (the `useMemo` at `react.tsx:183-194` depends on `profile` and
`workspaces`) and re-renders every consumer of the auth context. With ~40 call sites reading the token
per screen, that is a measurable re-render storm.

**Recommendation: yes, but only the four-line memo, in this slice.**

Reason: the ladder makes it worse if left alone. A recovering ladder attempt resolves the same token
string and would gratuitously re-render the entire app in the middle of the very form this slice exists
to protect. The fix is a `lastAppliedTokenRef` inside `applyToken` that returns early when the incoming
token is identical to the last applied one. It is behaviour-preserving by construction: `profileFromToken`
is pure over the token, so the same token deterministically yields the same profile.
The ref is initialised to a unique sentinel so the very first apply (including a first apply of `null`,
which must flip `isLoaded`) always runs.

**Explicitly out of scope**: splitting the context into a stable-actions context and a profile-value
context, memoizing `workspaces` by content, or any other consumer-side re-render work. That is a
separate performance slice with its own risk surface and its own oracle.

## Files

### 1. NEW `apps/web/src/auth/session-recovery.ts`

Pure module, no React, no SDK. Everything that has to survive the login round trip lives here, which is
what makes both halves unit-testable without a DOM.

```ts
export const RETURN_TO_KEY = 'fxl-sales.auth.returnTo';
export const LOGIN_ATTEMPTS_KEY = 'fxl-sales.auth.loginAttempts';
export const LOGIN_ATTEMPT_WINDOW_MS = 60_000;
export const MAX_LOGIN_ATTEMPTS = 3;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): StorageLike | null;      // globalThis.sessionStorage, try/catch, null on throw
export function sanitizeReturnTo(value: string | null | undefined, origin: string): string | null;
export function captureReturnTo(path: string, origin: string, storage?: StorageLike | null): void;
export function consumeReturnTo(origin: string, storage?: StorageLike | null): string | null;
export function registerLoginAttempt(now?: number, storage?: StorageLike | null): boolean;
export function clearLoginAttempts(storage?: StorageLike | null): void;
```

Rules already specified above. Additional implementation notes:

- Every function takes an optional `storage` defaulting to `defaultStorage()`, and every single call
  into it is individually wrapped in `try/catch`. A throwing `sessionStorage` must be indistinguishable
  from an empty one.
- `captureReturnTo` sanitizes first and writes nothing when the result is `null`.
- `consumeReturnTo` does `removeItem` first, then sanitizes what it read.
- `registerLoginAttempt(now = Date.now())`:
  - unreadable, unparseable, or older than `LOGIN_ATTEMPT_WINDOW_MS` since `firstAt` -> write
    `{count: 1, firstAt: now}`, return `true`;
  - `count >= MAX_LOGIN_ATTEMPTS` -> return `false` without incrementing (the counter must not run away);
  - otherwise write `{count: count + 1, firstAt}`, return `true`.
  - A storage that cannot be written to returns `true`. Failing open here is correct: the guard is a
    safety net for a server-side pathology, and refusing to log a user in because their browser blocks
    storage would be a worse bug than the loop it prevents.

### 2. `apps/web/src/auth/react.tsx`

**New imports**: `useLocation`, `useNavigate` from `react-router-dom`; `Button` from
`@/components/ui/button`; the five helpers plus `SESSION_REVALIDATE_DELAYS_MS` (declare that constant in
this file, exported, so the test can drive the exact ladder).

```ts
export const SESSION_REVALIDATE_DELAYS_MS = [500, 1_500, 4_000] as const;
```

**Inside `HubAuthProvider`**, add three refs and restructure token observation:

- `const lastAppliedToken = useRef<string | null | undefined>(undefined);`
- `const hasSessionRef = useRef(false);`  // a token has been observed and not yet invalidated
- `const revalidateAttempts = useRef(0);`
- `const revalidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);`

`applyToken` gains the memo guard as its first statement:

```ts
const applyToken = useCallback((token: string | null) => {
  if (lastAppliedToken.current === token) return;
  lastAppliedToken.current = token;
  // ... existing body unchanged
}, []);
```

New internals (plain `useCallback`s, declared in this order so the mutual recursion goes through refs
rather than through the dependency graph - `observeToken` and `scheduleRevalidate` call each other, so
implement `scheduleRevalidate` with a `useRef` holding the latest `observeToken`, or declare both as
stable functions inside a single `useMemo`; either is acceptable, pick one and keep
`react-hooks/exhaustive-deps` clean):

```ts
clearRevalidateTimer()   // clearTimeout + null the ref

failSession()            // clearRevalidateTimer(); revalidateAttempts.current = 0;
                         // hasSessionRef.current = false; applyToken(null);

scheduleRevalidate()     // if (revalidateTimer.current !== null) return;
                         // const attempt = revalidateAttempts.current;
                         // if (attempt >= SESSION_REVALIDATE_DELAYS_MS.length) { failSession(); return; }
                         // revalidateAttempts.current = attempt + 1;
                         // revalidateTimer.current = setTimeout(() => {
                         //   revalidateTimer.current = null;
                         //   void tokenCache.getToken().then(observeToken, () => observeToken(null));
                         // }, SESSION_REVALIDATE_DELAYS_MS[attempt]);

observeToken(token)      // if (token !== null) {
                         //   clearRevalidateTimer(); revalidateAttempts.current = 0;
                         //   hasSessionRef.current = true; clearLoginAttempts(); applyToken(token);
                         //   return;
                         // }
                         // if (!hasSessionRef.current) { applyToken(null); return; }  // cold start
                         // scheduleRevalidate();                                       // hold the session
```

Use the bare global `setTimeout`, not `window.setTimeout`, so the ref types cleanly under both DOM and
Node lib settings and so `vi.useFakeTimers()` patches it.

Rewire the three existing call sites:

- `getToken` (lines 141-145): `const token = await tokenCache.getToken(); observeToken(token); return token;`
- the hydration effect (lines 168-181): `.then(token => { if (active) observeToken(token); })` and
  `.catch(() => { if (active) observeToken(null); })`.
  A throw on cold start is still an immediate `applyToken(null)` because `hasSessionRef` is false;
  a throw once signed in now enters the ladder, which is the point.
- `setActive` (lines 156-166): after `tokenCache.seed(...)`, call `observeToken(result.accessToken)`
  instead of `applyToken(result.accessToken)`, so a workspace switch also marks the session live and
  clears the login-attempt counter. The generation guard above it is unchanged.
- `logout` (lines 149-154): keep `applyToken(null)` but first set `hasSessionRef.current = false`,
  `revalidateAttempts.current = 0` and `clearRevalidateTimer()`, so an in-flight ladder cannot resurrect
  a profile after an explicit sign-out. Also `clearLoginAttempts()` and remove any stored return path
  (call `consumeReturnTo(window.location.origin)` and discard the result) - a deliberate logout must not
  bounce the next login back into the previous operator's screen.

Add an unmount cleanup: `useEffect(() => () => clearRevalidateTimer(), [clearRevalidateTimer]);`

**`HubProtected`** is rewritten:

```tsx
function HubProtected({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, login } = useHubAuthContext();
  const location = useLocation();
  const navigate = useNavigate();
  const [loginBlocked, setLoginBlocked] = useState(false);
  const restoredRef = useRef(false);
  const currentPath = `${location.pathname}${location.search}`;

  useEffect(() => {
    if (!isLoaded || !isSignedIn || restoredRef.current) return;
    restoredRef.current = true;
    const target = consumeReturnTo(window.location.origin);
    if (target && target !== currentPath) navigate(target, { replace: true });
  }, [currentPath, isLoaded, isSignedIn, navigate]);

  useEffect(() => {
    if (!isLoaded || isSignedIn || loginBlocked) return;
    if (!registerLoginAttempt()) {
      setLoginBlocked(true);
      return;
    }
    captureReturnTo(currentPath, window.location.origin);
    login();
  }, [currentPath, isLoaded, isSignedIn, login, loginBlocked]);

  if (isLoaded && !isSignedIn && loginBlocked) {
    return <SessionRecoveryPanel onRetry={() => { clearLoginAttempts(); setLoginBlocked(false); }} />;
  }
  if (!isLoaded || !isSignedIn) return <Skeleton className="h-screen w-full" />;
  return <>{children}</>;
}
```

Clearing `loginBlocked` re-arms the login effect, so the retry button needs no direct `login()` call.

`SessionRecoveryPanel` is a local component in this file, styled after
`apps/web/src/pages/errors/NoRolePage.tsx` and using hardcoded pt-BR strings, matching the strings
already hardcoded in this file (`Sair`, `Buscar workspace...`). Do not add i18n keys: `src/i18n/**` is
outside this slice's file boundary.

```tsx
<div className="flex h-screen flex-col items-center justify-center gap-4 px-6 text-center">
  <h1 className="text-2xl font-semibold">Não foi possível restabelecer sua sessão</h1>
  <p className="max-w-md text-muted-foreground">
    Tentamos entrar novamente algumas vezes e a sessão não foi aceita. Isso costuma ser temporário.
  </p>
  <Button onClick={onRetry} variant="outline">Tentar novamente</Button>
</div>
```

`Protected` now requires a Router context. Every existing render site is a route element in
`apps/web/src/router.tsx`, so production is unaffected; the new tests must wrap it in `MemoryRouter`.

### 3. `apps/web/src/auth/__tests__/react.test.tsx` (extend, keep all five existing tests green)

Setup changes:

- `beforeEach`: add `sessionStorage.clear();`
- `afterEach`: add `vi.useRealTimers();` before `vi.restoreAllMocks()`.
- New imports: `MemoryRouter, useLocation` from `react-router-dom`; `Protected` from `../react`;
  `SESSION_REVALIDATE_DELAYS_MS` from `../react`; `RETURN_TO_KEY, LOGIN_ATTEMPTS_KEY` from
  `../session-recovery`.
- New helpers, alongside the existing `renderProvider`:
  - `function LocationProbe()` -> renders `<output data-testid="location">{`${pathname}${search}`}</output>`
    from `useLocation()`.
  - `function TokenProbe({ onReady })` -> `const { getToken } = useAccessToken();` and an effect that
    hands `getToken` to `onReady` once. This is how a test simulates a data hook reading the token.
  - `renderProtected(initialEntries: string[], onReady?)` -> mounts
    `<AppAuthProvider><MemoryRouter initialEntries={initialEntries}><Protected><Probe/><LocationProbe/><TokenProbe onReady={onReady}/></Protected></MemoryRouter></AppAuthProvider>`
    with the same `createRoot` / `act` pattern already used in this file.
    `Protected` renders the `Skeleton` while signed out, so `LocationProbe` is only readable when signed
    in; put `LocationProbe` inside `Protected` for the restore assertions and outside it (as a sibling of
    `Protected`, still inside `MemoryRouter`) for the signed-out assertions. Two small render helpers is
    fine; do not add conditional rendering to `Protected` to accommodate a test.
  - `const profileText = (host) => host.querySelector('[data-testid="profile"]')?.textContent;`

**ORACLE 1 - `it('keeps the signed-in session when a refresh resolves null once')`**

- `vi.useFakeTimers()`.
- `mocks.cache.getToken` -> `mockResolvedValueOnce(profileToken('Alpha'))` (hydration),
  `mockResolvedValueOnce(null)` (the transient failure), then `mockResolvedValue(profileToken('Alpha'))`.
- Render at `['/cadastros/produtos']`; flush; assert `signed-in:Alpha`.
- `await act(async () => { await capturedGetToken(); })` - the null read.
- **Assert immediately**: `mocks.client.login` not called; profile still `signed-in:Alpha`;
  `data-testid="location"` still `/cadastros/produtos`; `sessionStorage.getItem(RETURN_TO_KEY)` is null.
  This is the behavioural core: a null read did not sign the user out and did not navigate them away.
- Advance `SESSION_REVALIDATE_DELAYS_MS[0]` inside `act`; assert `login` still not called and the
  profile is still `signed-in:Alpha`, proving recovery rather than mere postponement.

**ORACLE 2 - `it('captures and restores the pre-login route across a genuine re-login')`**

- `vi.useFakeTimers()`; `mockResolvedValueOnce(profileToken('Alpha'))` then `mockResolvedValue(null)`.
- Render at `['/cadastros/produtos?f=1']`; flush; trigger one `capturedGetToken()`.
- Advance through each of the three ladder delays in order inside `act`. After the third, the fourth
  consecutive null exhausts the ladder and the provider signs out.
- Assert `mocks.client.login` called exactly **once** and
  `sessionStorage.getItem(RETURN_TO_KEY) === '/cadastros/produtos?f=1'`.
- Simulate the browser round trip: `root.unmount()`, `mocks.cache.getToken.mockReset()` then
  `mockResolvedValue(profileToken('Alpha'))`, re-render at `['/']` (the server-chosen post-login target).
- Assert `data-testid="location"` reads `/cadastros/produtos?f=1` and
  `sessionStorage.getItem(RETURN_TO_KEY)` is `null` (consumed exactly once).

**ORACLE 3 - `it('discards a hostile stored return path instead of navigating to it')`**

- Seed `sessionStorage.setItem(RETURN_TO_KEY, 'https://evil.example/')`.
- `mocks.cache.getToken.mockResolvedValue(profileToken('Alpha'))`; render at `['/']`; flush.
- Assert `data-testid="location"` is still `/`, that `container.textContent` does not contain
  `evil.example`, and that the key was consumed (`null`).
- Repeat the body for `'//evil.example/x'` (use `it.each` over the two values) so the protocol-relative
  form is proven at the behavioural level too, not only in the unit test.

**GUARD - `it('stops re-logging in and offers a manual retry after repeated failures')`**

- Seed `sessionStorage.setItem(LOGIN_ATTEMPTS_KEY, JSON.stringify({ count: 3, firstAt: Date.now() }))`.
- `mocks.cache.getToken.mockResolvedValue(null)`; render at `['/']`; flush.
- Assert `mocks.client.login` **not** called and the panel text `Não foi possível restabelecer sua sessão`
  is on screen. This is the anti-redirect-loop oracle.
- Click `Tentar novamente`; assert `mocks.client.login` is then called once.

**PERF - `it('does not re-render auth consumers when a refresh returns the same token')`**

- Count `Probe` render invocations with a module-level counter incremented in its body.
- Hydrate with a token, record the count, call `capturedGetToken()` twice (cache returns the same token
  string), flush, and assert the count is unchanged.

### 4. NEW `apps/web/src/auth/__tests__/session-recovery.test.ts`

Node environment (no `// @vitest-environment` pragma needed; the default is `node`). Uses a hand-rolled
`StorageLike` fake (a `Map`) passed explicitly, so nothing depends on a DOM.

- `describe('sanitizeReturnTo')` - table-driven over the origin `'https://app.example'`:
  - accepted: `/cadastros/produtos`, `/cadastros/produtos?kind=service&x=1`, `/meus-dados/comissoes`.
  - rejected: `https://evil.example/`, `http://app.example/cadastros` (absolute even when same-origin),
    `//evil.example/x`, `/\evil.example`, `javascript:alert(1)`, `\t/ok`, `''`, `null`, `undefined`,
    `'/'`, `/auth/login`, `/auth`, a 3000-character path, and `/x y`.
  - `'/produtos#frag'` normalizes to `/produtos` (the hash is dropped, not a rejection).
- `describe('captureReturnTo / consumeReturnTo')`:
  - a captured path round-trips once and the second `consumeReturnTo` returns `null`;
  - a hostile value written directly into the fake storage is removed by the failed consume;
  - `captureReturnTo('/')` writes nothing;
  - a storage whose methods throw makes every helper return `null` / no-op rather than propagate.
- `describe('registerLoginAttempt')`:
  - returns `true` for attempts 1..3 and `false` on the 4th inside the window;
  - a 4th attempt after `LOGIN_ATTEMPT_WINDOW_MS + 1` returns `true` and resets `count` to 1;
  - `clearLoginAttempts()` restores a `true`;
  - a corrupt stored value (`'{'`) is treated as absent and returns `true`;
  - a throwing storage returns `true` (fails open, by design).

## How to run

```bash
pnpm --filter @fxl-sales/web exec vitest run src/auth/__tests__
pnpm run lint
pnpm run type-check
pnpm test
```

`vitest run` only, never a watcher.

## Risks

- **Redirect loop.** The primary one. Mitigated by `registerLoginAttempt` (3 per 60s per tab) plus the
  terminal recovery panel, and by `clearLoginAttempts()` on every successfully observed token so the
  guard cannot fire during normal operation. Explicitly covered by the GUARD test.
- **Open redirect.** Mitigated by the seven sanitizer rules, applied on read as well as write, with
  `URL`-origin comparison as the backstop behind the character checks, and by destroying the stored
  value before validating it. Covered behaviourally (ORACLE 3) and exhaustively (the unit test table).
- **Session held open too long.** The ladder is hard-bounded at three retries / ~6 seconds; there is no
  path that keeps `isSignedIn` true indefinitely against a persistently failing refresh.
- **Stale timer after unmount.** `clearRevalidateTimer` runs in an unmount cleanup and in `logout`, and
  `logout` clears `hasSessionRef` so a late resolution cannot re-apply a profile.
- **StrictMode double effects.** `restoredRef` plus consume-before-validate makes a double restore
  inert; `applyToken`'s new identity guard makes a double apply inert.
- **Fake timers plus `act`.** Advance with `await act(async () => { await vi.advanceTimersByTimeAsync(ms) })`
  and always `vi.useRealTimers()` in `afterEach`, otherwise a leaked fake clock will hang unrelated tests
  in this file.
- **`Protected` now needs a Router.** True for all six production sites already. Any future render of
  `Protected` outside a router will throw at mount rather than degrade, which is the loud failure mode.
- **Slice interaction.** Slice 01 (persistent BFF session store) removes most of the cause; slice 02
  (`require-token`) makes the `null` window visible as an auth error instead of a blank bearer token.
  This slice must not edit `apps/web/src/lib/api-client.ts`, `apps/web/src/lib/require-token.ts`,
  `apps/web/src/sales-ops/**`, `apps/web/src/admin/**`, `apps/web/src/finder/**`, or `apps/api/**`.
  It is independently valuable and independently testable, hence `depends_on: []`.
