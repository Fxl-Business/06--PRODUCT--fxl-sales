# Recon — WEB slice — hub-sdk 1.3.1 → 2.1.0

Read-only factual map. No design proposed. All paths absolute-from-repo-root
(`/Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales/`).
Secret-looking values are redacted everywhere.

Installed SDK today: `apps/web/package.json:14` — `"@fxl-business/hub-sdk": "^1.3.1"`.
Resolved: `node_modules/.pnpm/@fxl-business+hub-sdk@1.3.1_hono@4.12.28`.

---

## 0. The 1.3.1 client surface the web half is written against

`node_modules/.pnpm/@fxl-business+hub-sdk@1.3.1_hono@4.12.28/node_modules/@fxl-business/hub-sdk/dist/client.d.ts`

- `:13-24` `CreateHubClientOptions { bffBasePath?: string; fetchImpl?: typeof fetch; navigate?: (url:string)=>void }`
- `:26-33` `SetActiveResult { accessToken: string; expiresIn: number; workspaceId: string }`
- `:35-54` `HubClient { login(): void; getToken(): Promise<string|null>; setActive(workspaceId: string): Promise<SetActiveResult>; logout(): Promise<void>; checkoutUrl(sku?): Promise<string>; manageUrl(): Promise<string> }`
- `:41-47` doc comment: *"POST the BFF `/auth/switch` … Returns a fresh access token for the new workspace"*
- `:59` `declare function createHubClient(config: HubSdkConfig, options?: CreateHubClientOptions): HubClient;`

`…/dist/config-CvYwarJp.d.ts:5-22` — `HubSdkConfig { apiUrl; publishableKey; secretKey?; audience? }`.
Note `secretKey` is an OPTIONAL member of the SAME type the browser passes today; 2.x's
`HubPublicConfig` + throw-on-`clientSecret` is the breaking change against this shape.

---

## 1. `apps/web/src/auth/` — full walkthrough

Files (6 source + 6 test):

| path | role |
| --- | --- |
| `apps/web/src/auth/provider.ts` | env → `BrowserHubConfig`, `getHubBffBasePath` |
| `apps/web/src/auth/react.tsx` | the provider, `Protected`, `UserControls`, ladder, renewal, flushes |
| `apps/web/src/auth/refresh.ts` | hand-rolled `POST <bff>/auth/refresh` + classification |
| `apps/web/src/auth/token.ts` | in-memory access-token cache (`getToken`/`renew`/`expiresAt`/`seed`/`clear`) |
| `apps/web/src/auth/claims.ts` | `parseJwtPayload`, `getRolesFromHubClaims`, `getRoleFromHubClaims` |
| `apps/web/src/auth/session-recovery.ts` | `sessionStorage` returnTo / login-attempt counter / logout intent |

### 1.1 `provider.ts` — the config object handed to `createHubClient`

```ts
// apps/web/src/auth/provider.ts:1-24
export type BrowserHubConfig = {
  apiUrl: string;
  publishableKey: string;
  audience?: string;
};

export function loadHubBrowserConfig(env: EnvLike): BrowserHubConfig {
  const apiUrl = env.VITE_FXL_HUB_API_URL;              // :10
  const publishableKey = env.VITE_FXL_HUB_PUBLISHABLE_KEY; // :11
  if (!apiUrl || !publishableKey) {                      // :12
    throw new Error('VITE_FXL_HUB_API_URL and VITE_FXL_HUB_PUBLISHABLE_KEY are required'); // :13
  }
  return { apiUrl, publishableKey, audience: env.VITE_FXL_HUB_AUDIENCE || undefined }; // :15-19
}

export function getHubBffBasePath(env: EnvLike): string {   // :22
  return (env.VITE_AUTH_BFF_BASE_PATH ?? env.VITE_API_URL ?? '').replace(/\/+$/, ''); // :23
}
```

Facts that matter for 2.x:
- The browser config object has EXACTLY three keys and **never carries `secretKey`/`clientSecret`**
  (`provider.ts:1-5`, `:15-19`). Nothing in `apps/web` reads `VITE_FXL_HUB_SECRET_KEY`
  (grep: zero hits repo-wide for a `VITE_*SECRET*` name).
- `audience` is spread in as `audience?: string`. If 2.x's `HubPublicConfig` forbids or
  renames it, `provider.ts:18` is the single site.
- `getHubBffBasePath` uses `??` not `||`, so a **declared-but-empty** `VITE_AUTH_BFF_BASE_PATH`
  (which is exactly what all three shipped `.env` files declare — see §5) does NOT fall through
  to `VITE_API_URL`; the base path resolves to `''` (same-origin). This is called out in the test
  at `apps/web/src/auth/__tests__/react.test.tsx:384-386`.

**Consumers of `getHubBffBasePath`** (exhaustive):
1. `apps/web/src/auth/react.tsx:202` — `const bffBasePath = useMemo(() => getHubBffBasePath(import.meta.env), []);`
2. `apps/web/src/auth/__tests__/provider.test.ts:25,31,36` — unit tests.
There are no others. The value is computed once and fed to BOTH `createHubClient` and
`requestHubAccessToken` (`react.tsx:203-210`) — the deliberate "cannot resolve to two origins"
invariant documented at `refresh.ts:14-24` and pinned by the react test at `:383-394`.

### 1.2 `react.tsx` — construction of the client

```tsx
// apps/web/src/auth/react.tsx:202-210
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

Import: `apps/web/src/auth/react.tsx:2`
`import { createHubClient, type HubClient } from '@fxl-business/hub-sdk/client';`

`HubClient` is also used as a public type in the context value: `react.tsx:101` (`client: HubClient`).

### 1.3 Every call into the SDK client surface (web)

| site | call | notes |
| --- | --- | --- |
| `apps/web/src/auth/react.tsx:204` | `createHubClient(config, { bffBasePath })` | only construction |
| `apps/web/src/auth/react.tsx:476` | `client.login()` — `const login = useCallback(() => client.login(), [client]);` | full-page assign; 2.x changes the forwarded query param `?workspace=` → `?organization=` **inside the SDK/BFF**, nothing in web spells either one (grep for `workspace=`/`organization=` in `apps/web/src` → **zero hits**) |
| `apps/web/src/auth/react.tsx:540` | `await client.logout()` — last statement of `logout()` | |
| `apps/web/src/auth/react.tsx:547` | `const result = await client.setActive(workspaceId);` | consumes `result.accessToken`, `result.expiresIn` (`:564-565`) |
| — | `client.getToken()` | **never called.** Deliberate; `react.test.tsx:368` asserts `expect(mocks.client.getToken).not.toHaveBeenCalled()` |
| — | `client.checkoutUrl()` / `client.manageUrl()` | **never called** in `apps/web/src` (only stubbed in tests) |

The app's own `getToken` is NOT the SDK's:

```tsx
// apps/web/src/auth/react.tsx:470-474
const getToken = useCallback(async () => {
  const result = await tokenCache.getToken();
  observeToken(result);
  return result.token;
}, [observeToken, tokenCache]);
```
Its doc block (`:464-469`) states the signature `Promise<string | null>` is kept deliberately for
~40 call sites and `AccessTokenHook`. 119 non-test sites reach it via `useAccessToken` /
`requireToken` (`apps/web/src/lib/require-token.ts:57-61`).

### 1.4 The hand-rolled fetch to `/auth/refresh`

`apps/web/src/auth/refresh.ts`

```ts
// :50-63
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
    return TRANSIENT_TOKEN_RESULT;   // network throw → transient
  }
```

- **URL** `` `${bffBasePath}/auth/refresh` `` (`:56`)
- **Method** `POST` (`:57`)
- **Body** — **none.** No `body`, no `Content-Type` header. (2.x's `setActive` POSTing
  `{organizationId}` to this same path is a body this file has never sent.)
- **Credentials** `'include'` (`:58`)

Status classification (`:73-82`):
```ts
if (res.status === 401) return { token: null, failure: 'session_expired' }; // :73
if (res.status !== 200) return TRANSIENT_TOKEN_RESULT;                      // :76 (503/502/500/…)
const body = await res.json().catch(() => null);                            // :78
const token = readAccessToken(body);                                        // :79
return token === null ? TRANSIENT_TOKEN_RESULT : { token };                 // :82
```
`readAccessToken` (`:44-48`) accepts only a non-empty string at `body.accessToken`.

Result types (`:34-42`):
```ts
export type HubRefreshFailure = 'session_expired' | 'transient';
export type HubTokenResult = { token: string } | { token: null; failure: HubRefreshFailure };
export const TRANSIENT_TOKEN_RESULT: HubTokenResult = Object.freeze({ token: null, failure: 'transient' } as const);
```

The module header `:1-25` states outright *"WHY THIS BYPASSES THE SDK CLIENT"* and *"If a future
SDK changes the method, the path or the credential mode of `/auth/refresh`, THIS FILE MUST CHANGE
WITH IT."* It names its two pinning tests: `apps/web/src/auth/__tests__/refresh.test.ts` and
`apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts`.

Note the collision surface for 2.x: `HubTokenResult`'s discriminator is `token: string | null` +
`failure`, whereas 2.x `getTokenResult()` is described as `ok` / `expired` / `unavailable`. The
mapping `expired → 'session_expired'`, `unavailable → 'transient'` is the entire branching
vocabulary of `react.tsx` (`:446`, `:458`) and `token.ts` (`:89`, `:125`).

### 1.5 `token.ts` — the token cache

`apps/web/src/auth/token.ts`
- `:4` `ACCESS_TOKEN_EXPIRY_SKEW_MS = 30_000`
- `:6-28` `HubAccessTokenCache = { getToken; renew; expiresAt; seed; clear }`
- `:49-51` `createHubAccessTokenCache(refresh: () => Promise<HubTokenResult>)` — takes an
  **injected refresher, not the SDK client** (header `:44-48`).
- `:57-66` `readFreshToken()` serves from memory until `expiresAt - 30s`.
- `:78-110` `requestRefresh()` coalesces in-flight refreshes; `generation` guards against a late
  answer from a superseded session (`:84-90`: a superseded result is downgraded to transient and
  can never report `session_expired`).
- `:96-102` caches only when `readJwtExpiry(result.token)` parses (`:30-36`, uses `parseJwtPayload`).
- `:112-116` `getToken` = cache hit or `requestRefresh()`.
- `:125` `renew = () => requestRefresh()` (unconditional).
- `:127` `expiresAt()`.
- `:129-144` `seed(accessToken, expiresInSeconds)` — bumps `generation`, drops `inFlight`, and
  takes `Math.min(jwtExpiry, serverExpiry)`. This is the workspace-switch path.
- `:146-150` `clear()` — bumps `generation`, drops `inFlight`, discards.

### 1.6 `claims.ts`

- `:1` `AppRole = 'admin' | 'finder' | 'seller'`
- `:3-9` `HubClaims { isSuperAdmin?; roles?: { productRoles?: unknown; workspace?: string } }`
- `:21-33` `getRolesFromHubClaims`: `isSuperAdmin || roles.workspace === 'owner' | 'admin'` →
  `['admin','seller','finder']`; else `productRoles` set; `productRoles.has('admin')` → full;
  else `['seller','finder'].filter(has)`.
- `:35-37` `getRoleFromHubClaims` = first of the above.
- `:39-53` `parseJwtPayload` — base64url, `atob` + `TextDecoder` (UTF-8 safe), returns `null` on any throw.

**The claim key is `roles.workspace`** (`:7`, `:22`). If 2.x renames the claim to
`roles.organization`, this file and its test are the only readers of that key in web.

### 1.7 `session-recovery.ts`

Pure `sessionStorage` module, no React, no SDK. Keys `:20-25`:
`RETURN_TO_KEY='fxl-sales.auth.returnTo'`, `LOGIN_ATTEMPTS_KEY='fxl-sales.auth.loginAttempts'`,
`LOGIN_ATTEMPT_WINDOW_MS=60_000`, `MAX_LOGIN_ATTEMPTS=3`, `LOGOUT_INTENT_KEY='fxl-sales.auth.logoutIntent'`,
sentinel `'1'` (`:32`).
- `:112` `TERMINAL_AUTH_ROUTES = ['/no-role']`; `:135-146` `isTerminalAuthRoute` (percent-decode
  per segment, case-insensitive, trailing-slash strip).
- `:179-214` `sanitizeReturnTo` — 9 numbered checks; rejects `/auth` and `/auth/*` at `:202`.
- `:217-225` `captureReturnTo`, `:232-239` `consumeReturnTo` (removes BEFORE validating).
- `:266-274` `isLoginBlocked`, `:287-303` `registerLoginAttempt` (fails OPEN), `:305-307` `clearLoginAttempts`.
- `:323-325` `markLogoutIntent`, `:332-334` `hasLogoutIntent`, `:336-338` `clearLogoutIntent`.
Nothing here touches the SDK — **unaffected by the 2.x migration** except by the `/auth/*` path
refusal at `:202`, which stays correct.

### 1.8 The revalidation ladder

`apps/web/src/auth/react.tsx:51`
```ts
export const SESSION_REVALIDATE_DELAYS_MS = [500, 1_500, 4_000] as const;
```
Header `:36-50`: entered ONLY by a transient failure; a 401 runs `failSession()` at once;
four consecutive transient failures (~6s) tear the session down; the counter resets on recovery.

- `:372-388` `scheduleRevalidate()` — one ladder for N concurrent readers (`:375`); on exhaustion
  `failSession()` (`:377-380`); rung body calls `tokenCache.getToken().then(observeToken, () => observeToken(TRANSIENT_TOKEN_RESULT))`.
- `:366-370` `failSession()` — `clearTimers(); revalidateAttempts.current = 0; applyToken(null);`
- `:390-459` `observeToken(result: HubTokenResult)` — the single classifier:
  - `:393` drop if unmounted
  - `:394-439` token present → maybe `queryClient.clear()` (`:419`), `clearRevalidateTimer()`,
    reset attempts, `clearLoginAttempts()` (`:424`), `clearLogoutIntent()` (`:433`),
    `applyToken(result.token)` (`:434`), `scheduleRenewal()` (`:438`)
  - `:446-449` `if (result.failure === 'session_expired') { failSession(); return; }`
  - `:458` everything else → `scheduleRevalidate()`

**This is the exact seam that `getTokenResult()`'s `ok`/`expired`/`unavailable` must map onto.**

### 1.9 The renewal timer

- `:66` `export const SESSION_RENEWAL_LEAD_MS = 60_000;` (deliberately LONGER than the cache's
  30s skew — header `:53-65` explains why `tokenCache.renew()` exists instead of driving
  renewal through `getToken`).
- `:226-227` refs `renewalTimer`, `renewalTarget`.
- `:305-308` `renewNow()` → `tokenCache.renew().then(observeToken, () => observeToken(TRANSIENT_TOKEN_RESULT))`.
- `:310-342` `scheduleRenewal()` — never while hidden (`:317-320`); no expiry → clear (`:321-325`);
  idempotent while target unchanged (`:326`); `delay = expiresAt - SESSION_RENEWAL_LEAD_MS - Date.now()`
  and **must be strictly positive** (`:334-335`).
- `:344-364` `handleVisibilityChange()` — hidden → clear; not signed in → return (`:351`);
  healthy → `scheduleRenewal()`; otherwise `renewNow()` synchronously (`:363`).
- `:592-598` effect registering `visibilitychange`.
- `:602-608` mount/unmount effect: re-arms `mountedRef`, `clearTimers()` on unmount.

2.x "proactive renewal" is the SDK-side equivalent of this whole block — a duplication risk
worth flagging, but the current implementation is entirely local.

### 1.10 The logout intent

`logout()` at `apps/web/src/auth/react.tsx:478-541`, in order, all before the single `await`:
1. `:495` `markLogoutIntent()` — doc `:479-494` insists it is the FIRST statement.
2. `:496` `operationGeneration.current += 1`
3. `:497` `tokenCache.clear()`
4. `:503` `failSession()`
5. `:521` `setSessionLost(false)`
6. `:531` `queryClient.clear()`
7. `:532` `clearLoginAttempts()`
8. `:539` `consumeReturnTo(currentOrigin())`
9. `:540` `await client.logout()` ← the only SDK call

Readers of the intent: `HubProtected` at `:706` (`logoutIntent = isLoaded && !isSignedIn && hasLogoutIntent()`),
branch at `:785-800` (`SignedOutPanel`), URL-reset effect `:737-740`, login-effect guard `:743`.
Cleared at `:433` (any observed token — the "backstop"), and at `:795` on the `Entrar` click.

### 1.11 queryClient flush points (exhaustive)

`queryClient` comes from `useQueryClient()` at `react.tsx:196` (context, never imported —
doc `:185-195`; `App.tsx` nesting pinned by a source test, see §4).

| line | flush | condition |
| --- | --- | --- |
| `react.tsx:419` | `queryClient.clear()` | inside `observeToken`, only when `!wasSignedIn` (in-page signed-out → signed-in) |
| `react.tsx:531` | `queryClient.clear()` | in `logout()`, synchronous, before the `await` |
| `react.tsx:563` | `queryClient.clear()` | in `setActive()`, **after** the `await` and **after** the generation check, **before** `seed`+`observeToken` |

### 1.12 The workspace switcher and `setActive`

```tsx
// apps/web/src/auth/react.tsx:543-568
const setActive = useCallback(
  async (workspaceId: string) => {
    operationGeneration.current += 1;
    const switchGeneration = operationGeneration.current;
    const result = await client.setActive(workspaceId);      // :547
    if (switchGeneration !== operationGeneration.current) return; // :548
    queryClient.clear();                                     // :563
    tokenCache.seed(result.accessToken, result.expiresIn);   // :564
    observeToken({ token: result.accessToken });             // :565
  },
  [client, observeToken, queryClient, tokenCache],
);
```
Type in the context: `react.tsx:105` `setActive: (workspaceId: string) => Promise<void>;`

UI: `HubUserControls` at `react.tsx:875-913`.
- `:876` `const { logout, setActive, workspaceName, workspaces } = useHubAuthContext();`
- `:880` renders the `Combobox` only when `workspaces.length > 1`
- `:885-887` `onChange={(workspaceId) => { void setActive(workspaceId); }}`
- `:896` current value resolved by **name**: `workspaces.find(w => w.name === workspaceName)?.id ?? ''`
- `:900-911` the `Sair` button → `void logout()`

Workspace list comes from the JWT: `readWorkspaces` at `react.tsx:116-146`, reading
`workspace.workspaceId ?? workspace.id` (`:134`) — comment `:121-133` records that the Hub mints
`workspaceId`, not `id`. `HubWorkspacePreview` at `:84-88` (`id`, `name?`, `products?`).
`workspaceName` claim read at `:162`.

Everything the web half calls the concept is **"workspace"**. If 2.x renames the wire/claim to
`organization`, `readWorkspaces` (`:116-146`), `profileFromToken` (`:148-165`), `HubWorkspacePreview`,
`AuthProfile.workspaceName` (`:81`), `setActive`'s parameter name, and `claims.ts:7,22` are the sites.

### 1.13 Panels and guards (context for the tests)

- `SessionRecoveryPanel` `:632-645` (loop-guard terminal state).
- `SignedOutPanel` `:659-675` (explicit `Sair`, and live loss with different copy).
- `HubProtected` `:677-857`: `logoutIntent` branch `:785`, `liveSessionLoss` overlay `:813-837`
  (keeps `children` mounted), `loginBlocked` `:839`, Skeleton `:852`, children `:856`.
- Exports `:915-920`: `AppAuthProvider`, `Protected`, `useAccessToken`, `useAuthProfile`,
  `useLogout`, `UserControls`.

---

## 2. The web env/config layer

Declared/read `VITE_*` variables and every read site:

| variable | read at | notes |
| --- | --- | --- |
| `VITE_FXL_HUB_API_URL` | `apps/web/src/auth/provider.ts:10` (required, throws at `:13`) | also declared `packages/shared-types/src/env.ts:14` as optional URL |
| `VITE_FXL_HUB_PUBLISHABLE_KEY` | `apps/web/src/auth/provider.ts:11` (required, throws at `:13`) | `packages/shared-types/src/env.ts:15` |
| `VITE_FXL_HUB_AUDIENCE` | `apps/web/src/auth/provider.ts:18` | `packages/shared-types/src/env.ts:16` |
| `VITE_AUTH_BFF_BASE_PATH` | `apps/web/src/auth/provider.ts:23` (first choice, `??`) | not in the shared zod schema |
| `VITE_API_URL` | `apps/web/src/auth/provider.ts:23` (fallback); `apps/web/src/lib/api-client.ts:16` (`?? 'http://localhost:3006'`); `apps/web/vite.config.ts:54` (proxy fallback) | |
| `VITE_AUTH_PROXY_TARGET` | `apps/web/vite.config.ts:54` ONLY (dev proxy) | never reaches the bundle |
| `VITE_SENTRY_DSN` | declared in all three `.env*` files and `packages/shared-types/src/env.ts:17`; **no read site in `apps/web/src`** | |

Shared zod fragment: `packages/shared-types/src/env.ts:13-18` `sharedClientEnv` — all four Hub/Sentry
client vars `.optional()`. Built copy at `packages/shared-types/dist/env.d.ts:18,23,28`.

Test stubs of these vars:
- `apps/web/src/auth/__tests__/provider.test.ts:8-9,19,25,31`
- `apps/web/src/auth/__tests__/react.test.tsx:321-322` and `:387`
- `apps/web/src/__tests__/session-journey.test.tsx:375-376`
- `apps/web/src/sales-ops/__tests__/session-loss-keeps-route.test.tsx:312-313`

---

## 3. `apps/web/vite.config.ts` + auth-related eslint rules

### 3.1 Proxy / ports

```ts
// apps/web/vite.config.ts:40-58
server: {
  port: 8006,
  strictPort: true,
  host: true,
  warmup: { clientFiles: ['./src/main.tsx','./src/App.tsx','./src/router.tsx','./src/sales-ops/SalesOpsApp.tsx'] },
  proxy: {
    '/auth': {
      target: env.VITE_AUTH_PROXY_TARGET || env.VITE_API_URL || 'http://localhost:3006',
      changeOrigin: false,
    },
  },
},
```
- `:6` `const env = loadEnv(mode, __dirname);`
- The proxy key is the **prefix `/auth`**, so `/auth/login`, `/auth/callback`, `/auth/refresh`,
  `/auth/logout` and (today) `/auth/switch` are all forwarded by one rule. Removing `/auth/switch`
  in 2.x requires **no vite change**.
- `changeOrigin: false` is load-bearing for cookie host matching.
- `:20-39` `optimizeDeps.include` lists `'@fxl-business/hub-sdk/client'` at `:27` — if 2.x changes
  the subpath export (e.g. `/browser`), this list must change; it is also source-pinned by a test
  (§4).
- `:10-15` `resolve.alias` `@` → `./src`; `dedupe: ['react','react-dom','react-router-dom']`.
- Build: `:59-76`, `outDir 'dist'`, `sourcemap: true`, manualChunks vendor split.

Web dev port `8006`, API `3006`, local Hub `9016` (README `:13-14`, `:44`).

### 3.2 `apps/web/eslint.config.js` — auth-related `no-restricted-syntax`

One auth rule, `:52-57`:
```js
{
  selector:
    "LogicalExpression[operator='??'] > AwaitExpression.left > CallExpression[callee.name='getToken']",
  message:
    'A missing access token must never be defaulted. Use `await requireToken(getToken)` from @/lib/require-token; `(await getToken()) ?? ""` sends an anonymous request that surfaces as a generic server fault.',
}
```
It matches on the **callee name `getToken` literally**. If the app-level reader is renamed
(e.g. to `getTokenResult`), this rule silently stops matching.

The other `no-restricted-syntax` entries (`:32-51`) are the UI-picker ban (`select`, `datalist`,
`option`, raw `input type="number"`) — not auth.
`:64-73` `no-restricted-imports` bans `useMutation` from `@tanstack/react-query` outside
`src/lib/app-mutation.ts` — relevant only because the flush story lives in the same provider.

---

## 4. Every web test that touches auth

Runner config: `apps/web/vitest.config.ts` — `environment: 'node'`, include
`src/**/__tests__/**/*.test.ts(x)`, `passWithNoTests: true`; DOM tests opt in per-file with
`// @vitest-environment happy-dom` (e.g. `react.test.tsx:1`).

### 4.1 `apps/web/src/auth/__tests__/react.test.tsx` (the big one)

Harness facts:
- `:3` imports `type { HubClient }`; `:14-45` `vi.hoisted` builds a `client` object
  **`satisfies HubClient`** (`:22`) with all six methods `login/getToken/setActive/logout/checkoutUrl/manageUrl`,
  and a `cache` with `getToken/renew/expiresAt/seed/clear`.
- `:47-49` `vi.mock('@fxl-business/hub-sdk/client', () => ({ createHubClient: mocks.createHubClient }))`
- `:51-53` `vi.mock('../token', …)`; `:60-63` partial mock of `../refresh`.
- `:81-83` the three result shapes: `ok(token)`, `expired = {token:null,failure:'session_expired'}`,
  `transient = {token:null,failure:'transient'}`.
- `:316-341` beforeEach stubs `VITE_FXL_HUB_API_URL`, `VITE_FXL_HUB_PUBLISHABLE_KEY`,
  `cache.expiresAt → null`, `cache.renew → transient`, `client.login → undefined`,
  `client.logout → resolved`, `client.checkoutUrl/manageUrl → resolved strings`.

Describe/it inventory (line: title):

`describe('AppAuthProvider token cache wiring')` `:357`
- `:358` `hydrates the provider through the token cache instead of the SDK client`
- `:383` `wires the token cache to the BFF refresh endpoint at the same base path as the SDK client`
- `:405` `seeds the workspace-switch token before exposing the switched profile`
- `:434` `clears browser token state before SDK logout`
- `:459` `does not restore authentication when a workspace switch resolves after logout begins`
- `:497` `keeps the newest requested workspace authoritative when switches resolve out of order`

`describe('session preservation and route restore')` `:550`
- `:593` `signs out at once when the BFF says the session expired, without entering the ladder`
- `:614` `keeps the session and enters the ladder when a refresh is transiently unavailable`
- `:639` `holds a cold start on a transient failure instead of signing out`
- `:667` `signs out at cold start when the BFF says the session expired`
- `:681` `keeps the signed-in session when a refresh fails transiently once`
- `:719` `resets the ladder after each recovery, so unrelated blips never accumulate`
- `:758` `clears the login attempt counter once a token is observed`
- `:771` `clears a still-pending ladder timer at unmount`
- `:799` `drops a ladder refresh that resolves after unmount instead of rescheduling`
- `:851` `captures and restores the pre-login route across a genuine re-login`
- `:895` `it.each(['https://evil.example/', '//evil.example/x'])` (open-redirect refusal)
- `:910` `stops re-logging in and offers a manual retry after repeated failures`
- `:935` `does not re-render auth consumers when a refresh returns the same token`

`describe('live session loss')` `:963`
- `:1001` `does not navigate to the Hub when a session is lost while the app is signed in`
- `:1015` `keeps the page mounted when a session is lost`
- `:1030` `still redirects to the Hub when the app is opened with no session`
- `:1047` `redirects on a cold entry whose very first read is a transient ladder exhaustion`
- `:1064` `navigates only when the operator asks, capturing the route they were on`
- `:1076` `shows the explicit sign-out state rather than the session-loss state after Sair`
- `:1098` `does not carry a spent sign-in request into a later loss in the same document`
- `:1130` `keeps offering a working sign-in after a live loss inside a blocked login window`

`describe('proactive token renewal')` `:1151`
- `:1189` `renews the token before it expires while the document is visible`
- `:1224` `arms exactly one renewal however many times the token is read`
- `:1267` `does not schedule a renewal while the document is hidden`
- `:1281` `renews immediately on becoming visible with an expired token`
- `:1310` `schedules rather than renews when the tab becomes visible with a healthy token`
- `:1325` `drops a pending renewal when the tab is hidden again`
- `:1340` `does not renew for a tab that is not signed in`
- `:1356` `clears a pending renewal at unmount`
- `:1378` `shows the session-loss state instead of navigating when a renewal finds the session dead`

`describe('explicit logout intent')` `:1405`
- `:1429` `does not capture the route or spend a login attempt when the operator signs out`
- `:1445` `keeps the return-to slot empty across a remount after an explicit sign-out`
- `:1469` `does not auto-login while the logout intent is set`
- `:1482` `resets the URL to the default route while the logout intent is set`
- `:1492` `resets the URL to the default route after an explicit sign-out`
- `:1504` `clears the intent and re-arms the login effect when the operator clicks Entrar`
- `:1540` `signs in on the first Entrar click after a Sair inside a live tab`
- `:1570` `clears the intent whenever a live token is observed, so a stale intent can never lock the tab out`

`describe('identity-scoped query cache')` `:1601`
- `:1623` `drops every cached entry on logout`
- `:1642` `drops every cached entry on a workspace switch`
- `:1671` `keeps the current tenant's cache while a workspace switch is still in flight`
- `:1703` `does not flush when a superseded workspace switch resolves late`
- `:1750` `drops a query issued before a workspace switch instead of letting it repopulate the cache after it`
- `:1780` `drops the previous identity's cache on an in-page signed-out to signed-in transition`
- `:1822` `keeps the cache when the revalidation ladder recovers from a blip`

**What breaks in this file, concretely:**

1. **Client CONFIG SHAPE change** (`HubPublicConfig`, throw on `clientSecret`):
   - `:383` `wires the token cache to the BFF refresh endpoint at the same base path as the SDK client`
     — asserts at `:399-402`
     ```ts
     expect(mocks.createHubClient).toHaveBeenCalledWith(
       expect.anything(),
       expect.objectContaining({ bffBasePath: 'http://localhost:3006' }),
     );
     ```
     The first arg is `expect.anything()`, so a config-shape change alone does not redden it —
     but the **arity/options-object shape** change would. If 2.x moves `bffBasePath` out of the
     second positional options object, this is the first red test.
   - `createHubClient` is fully mocked in every DOM test, so a real 2.x throw on a bad config
     is **never exercised by any web test today**. There is no test asserting the config object
     contents at all except the pure unit `provider.test.ts:5-17` (which asserts
     `{ apiUrl, publishableKey, audience: undefined }`).
2. **`HubClient` TYPE change (removal of `getToken`, `setActive` signature, addition of `getTokenResult`)**:
   - `:14-22` — the mock object is declared `satisfies HubClient`. Any member removed from or
     added-as-required to `HubClient` in 2.x makes this a **type-check failure**
     (`pnpm --filter @fxl-sales/web type-check`, and `vitest` typechecks nothing but `tsc --noEmit`
     runs in `build`). Same construct at `session-journey.test.tsx:41-47` and
     `session-loss-keeps-route.test.tsx:16-23`.
   - `:18` `setActive: vi.fn<HubClient['setActive']>()`; `:460`, `:503-504`, `:1672`, `:1709`
     `deferred<Awaited<ReturnType<HubClient['setActive']>>>()` — if `setActive` returns a
     different shape (e.g. no `expiresIn`, or `organizationId` instead of `workspaceId`),
     the `mockResolvedValue({ accessToken, expiresIn: 120, workspaceId: 'workspace-beta' })`
     literals at `:409-412`, `:1644-1647`, `:1752-1755`, and the `switchRequest.resolve({…})`
     calls at `:481-485`, `:513-517` become type errors and the `seed(token, 120)` assertions
     (`:420-421`) break.
   - `:368` `expect(mocks.client.getToken).not.toHaveBeenCalled();` and `:431` the same — these
     assert a method that would no longer exist on `HubClient`; `mocks.client.getToken` at `:17`
     is `vi.fn<HubClient['getToken']>()` and becomes a type error.
3. **`/auth/switch` disappearing (setActive → POST `/auth/refresh` with `{organizationId}`)**:
   - No web test names `/auth/switch` (grep: zero hits in `apps/web`). The switch is exercised
     purely through the mocked `client.setActive`. So the disappearance of the route breaks
     **nothing in web tests directly** — it breaks `apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts:605`
     (`persists the rotated refresh token when the Hub rotates __Host-fxl_hub_session on /auth/switch`,
     asserting `seen[0]` contains `/auth/switch` at `:629`) — API slice.
   - Indirect web risk: `refresh.test.ts:83` pins that `/auth/refresh` is called with **exactly**
     `{ method: 'POST', credentials: 'include' }` and no body. If `setActive` in 2.x POSTs a JSON
     body to the same path, `requestHubAccessToken` and that assertion still hold (they are
     different callers) — but the two callers now share one endpoint.
4. **`getToken` → `getTokenResult`**: the *cache*'s `getToken` is mocked at `:24` and used in
   ~every test (`mocks.cache.getToken.mockResolvedValue(ok(...))`). If the migration renames the
   cache method or replaces `HubTokenResult` with the SDK's `ok/expired/unavailable` union,
   **`ok`/`expired`/`transient` helpers at `:81-83` and every `mockResolvedValue` in the file**
   (dozens) must change. The three highest-signal titles that encode the classification are:
   - `:593` `signs out at once when the BFF says the session expired, without entering the ladder`
   - `:614` `keeps the session and enters the ladder when a refresh is transiently unavailable`
   - `:1378` `shows the session-loss state instead of navigating when a renewal finds the session dead`

### 4.2 `apps/web/src/auth/__tests__/refresh.test.ts`

- `:4` `const BFF_BASE = 'http://localhost:3006';`
- `:11-30` `classifies every 401 as session_expired, whichever body the BFF sends (%s)` —
  `it.each` over `['the revoked-family verdict', {error:'session_expired'}]`,
  `['the missing-or-expired-record verdict', {error:'no_session'}]`, `['an empty body', {}]`
- `:32-42` `classifies a transient status as transient so the session survives a Hub outage (%i)` —
  `it.each([503, 502, 500, 429, 418])`
- `:44` `classifies a network throw as transient`
- `:53-68` `classifies a 200 whose body is not a refresh response as transient (%s)` — `it.each` over
  `no accessToken at all`, `a non-string accessToken`, `an empty accessToken`, `a body that is not JSON`
- `:70` `returns the access token on a 200 refresh response`
- `:83` `posts to the BFF refresh endpoint with credentials included` — the request-shape pin:
  ```ts
  expect(fetchImpl).toHaveBeenCalledWith('http://localhost:3006/auth/refresh', {
    method: 'POST', credentials: 'include',
  });                                                     // :87-90
  await requestHubAccessToken('', sameOrigin);
  expect(sameOrigin).toHaveBeenCalledWith('/auth/refresh', {
    method: 'POST', credentials: 'include',
  });                                                     // :96-99
  ```

**Breakage:** this whole file is written against the hand-rolled fetch. If the migration deletes
`requestHubAccessToken` in favour of `client.getTokenResult()`, **all seven tests are deleted or
rewritten**. If the fetch merely gains a body/header, `:83 posts to the BFF refresh endpoint with
credentials included` fails on the exact-object match (both assertions). If the result union
changes to `ok/expired/unavailable`, all `resolves.toEqual({token:null,failure:'…'})` assertions
at `:25-28`, `:37-40`, `:47-50`, `:64-67` fail.

### 4.3 `apps/web/src/auth/__tests__/provider.test.ts`

- `:5` `loads Hub browser config from Vite env vars` — asserts the returned object equals
  `{ apiUrl: 'http://localhost:9016', publishableKey: 'pk_fxl-sales_test', audience: undefined }` (`:12-15`)
- `:18` `requires the Hub browser vars` — `expect(() => loadHubBrowserConfig({})).toThrow(/VITE_FXL_HUB_API_URL/)`
- `:24` `uses the API origin for auth routes when configured`
- `:30` `uses an explicit Hub BFF base path when configured`
- `:36` `falls back to same-origin auth routes when no override is configured`

**Breakage:** `:5` is the ONLY assertion on the exact config object shape. Renaming/removing
`audience`, or adding a required `HubPublicConfig` field, reddens it. It never constructs a real
client, so the 2.x throw-on-`clientSecret` is not covered anywhere.

### 4.4 `apps/web/src/auth/__tests__/token.test.ts` (14 tests)

`:38 coalesces concurrent cache misses into one SDK refresh`, `:59 serves a fresh JWT from memory
until the expiry skew boundary`, `:81 reads JWT expiry from a token carrying multibyte display
claims`, `:94 does not cache a normal refresh token without a valid JWT expiry`, `:104 clears
cached state when the refresh reports no token`, `:125 passes the failure classification straight
through to the caller`, `:135 clear discards a cached token and a late in-flight refresh result`,
`:161 reports a superseded refresh as transient, never as an expired session`, `:175 seed makes the
workspace-switch token authoritative over an older in-flight refresh`, `:204 renew forces a refresh
even while the cached token is still servable`, `:230 renew joins an in-flight refresh instead of
issuing a second one`, `:251 reports the cached expiry, and null whenever nothing is cached`,
`:280 does not report an expiry for a token it refused to cache`, `:288 seed uses the earlier JWT
or server expiry and rejects immortal fallback lifetimes`.

**Breakage:** `:125 passes the failure classification straight through to the caller` and
`:161 reports a superseded refresh as transient, never as an expired session` are written against
`HubTokenResult`'s `failure: 'session_expired' | 'transient'`. `:175` and `:288` are written
against `seed(accessToken, expiresInSeconds)` — i.e. against `SetActiveResult.expiresIn`.
If the whole cache is replaced by the SDK's proactive renewal, the entire file goes.

### 4.5 `apps/web/src/auth/__tests__/claims.test.ts` (9 tests)

`:5 maps Hub super-admins to admin`, `:11 maps Hub workspace admins to admin`, `:15 maps product
admin roles to full sales access`, `:21 maps product seller and finder roles independently`,
`:29 does not grant a sales role to ordinary Hub workspace members without product roles`,
`:33 ignores unknown product roles from display claims`, `:43 decodes a base64url JWT payload
without verifying display-only claims`, `:54 decodes multibyte UTF-8 claims as correct UTF-8, not
Latin-1 mojibake`.
**Breakage:** only if the claim key `roles.workspace` is renamed by 2.x (`:11` fixture).

### 4.6 `apps/web/src/auth/__tests__/session-recovery.test.ts` (~20 tests, `:129-380`)

Pure storage module. **No SDK coupling → no expected breakage.**

### 4.7 `apps/web/src/__tests__/session-journey.test.tsx` — THE journey test

- `:27` imports `type { HubClient }`; `:41-47` the same `satisfies HubClient` mock object;
  `:67-69` `vi.mock('@fxl-business/hub-sdk/client', …)`; `:50-52` `vi.mock('@/auth/token', …)`;
  `:45-49` comment: `../refresh` is deliberately NOT mocked.
- `describe('the composed session journey')` `:402`
  - `:403` `returns the operator to the route they were on after a lost session and a successful login`
  - `:459` `returns the operator to a non-tatico route, where the second guard is load-bearing`
  - `:480` `consumes the returnTo exactly once, so a later mount cannot replay it`
  - `:502` `never restores a returnTo of /no-role, even if one is somehow stored`
  - `:518` `sends an operator who lost entitlement to /no-role and leaves them there without looping`
  - `:533` `lets an entitled operator out of /no-role even when nothing is stored to restore`

**Breakage:** the `satisfies HubClient` object at `:41-47` (type-check) and
`mocks.client.setActive`/`getToken` members. The six titles themselves are behavioural and should
survive if the classification mapping is preserved. `:518` is the only place the word
"entitlement" appears in a web test title.

### 4.8 `apps/web/src/sales-ops/__tests__/session-loss-keeps-route.test.tsx`

- `:3` `import type { HubClient }`; `:16-23` mock client incl. `setActive: vi.fn<HubClient['setActive']>()`;
  `:34,46-47` `vi.mock('@fxl-business/hub-sdk/client', …)`; `:312-314` env stubs + `createHubClient.mockReturnValue`.
- `describe('Sales Ops keeps its route when a live session is lost')` `:344`
  - `:345` `keeps the URL on the route the operator was on instead of rewriting it to /no-role`
  - `:359` `keeps a non-default route on a live loss, where the second guard is visible`
  - `:367` `keeps the Sales Ops shell and its own component state mounted underneath the overlay`
  - `:392` `captures the route the operator was on when the operator clicks Entrar`
  - `:410` `still redirects a signed-in operator with no visible workspaces to /no-role`
  - `:420` `still rewrites the legacy cadastros alias for a signed-in operator`

**Breakage:** same `HubClient` type coupling. `:410` is written in terms of "visible workspaces".

### 4.9 `apps/web/src/__tests__/route-error-and-auth-context.test.tsx` — SOURCE pins

- `describe('RouteErrorPage')` `:18`; `:35 renders the friendly error page with a reload button when a route element throws`
- `describe('dev-race regression contract')` `:58`
  - `:59` `router.tsx uses the @ alias for auth and mounts errorElement on every top-level route`
    — asserts `source.toContain("from '@/auth/react'")` (`:61`)
  - `:69` `vite.config.ts pins dep optimization so auth modules cannot be served twice` —
    asserts `dedupe`, `'react-router-dom'`, `optimizeDeps`, `'@radix-ui/react-dropdown-menu'`,
    `warmup` (`:71-76`). **Does not** currently assert the hub-sdk entry, so changing
    `'@fxl-business/hub-sdk/client'` in `optimizeDeps` will not redden it.
  - `:87` `App.tsx mounts QueryClientProvider outside AppAuthProvider` — the structural
    precondition for every `queryClient.clear()` above
  - `:96` `HubAuthContext is a globalThis singleton so duplicated modules share one context`
    — asserts `__fxlHubAuthContext` and `\?\?=` in `src/auth/react.tsx`

### 4.10 Peripheral auth-touching tests (no SDK coupling)

- `apps/web/src/lib/__tests__/api-client-token-guard.test.ts` — `:18 rejects an empty token without
  calling fetch`, `:25 rejects a whitespace-only token…`, `:32 rejects an empty token in
  apiFetchBlob…`, `:39 sends Bearer for a real token`, `:49 requireToken throws when the reader
  resolves null`, `:55 isAuthFailure recognises a 401 ApiError`.
- `apps/web/src/sales-ops/__tests__/blank-bearer-token.test.tsx` — mocks
  `useAccessToken: () => ({ getToken: mocks.getToken })` at `:25`; `:122 does not issue a request
  when getToken resolves null`, `:132 renders a session-expired panel, not the generic API fault`,
  `:143 sends the Bearer header when a token IS available`. These pin the app-level
  `getToken(): Promise<string|null>` contract — if `useAccessToken` is reshaped to return a result
  object, this file and the eslint selector in §3.2 both need changing.
- `apps/web/src/__tests__/no-role-redirect.test.tsx` — `:180`, `:193`, `:207`, `:216`, `:243`,
  `:250`, `:260`, `:277 router.tsx wraps NoRolePage in NoRoleGuard inside Protected`. Role-shaped,
  no SDK.
- `apps/web/src/admin/products/__tests__/useProducts.test.ts:75` — a fixture with
  `publishableKey: 'pk_test'`. This is the ADMIN *product* entity (`apps/web/src/admin/types.ts:12`,
  rendered at `apps/web/src/admin/apps/AppsPage.tsx:72,84`), **not** the SDK config. Unrelated.

---

## 5. Deployment / environment surface (whole repo)

### 5.1 `.env*` files (values redacted; only presence reported)

`apps/web/.env` (gitignored)
| line | key | value present |
| --- | --- | --- |
| 2 | `VITE_API_URL` | yes |
| 3 | `VITE_AUTH_PROXY_TARGET` | yes |
| 4 | `VITE_AUTH_BFF_BASE_PATH` | **no (declared empty)** |
| 7 | `VITE_FXL_HUB_API_URL` | yes |
| 8 | `VITE_FXL_HUB_PUBLISHABLE_KEY` | yes — **REDACTED** |
| 9 | `VITE_FXL_HUB_AUDIENCE` | no |
| 12 | `VITE_SENTRY_DSN` | no |

`apps/web/.env.dev.example` (committed) — same seven keys at lines 5,6,7,10,11,12,15; identical
presence pattern (`VITE_AUTH_BFF_BASE_PATH` and `VITE_FXL_HUB_AUDIENCE` empty). Header `:1-3`:
*"Local dev defaults for the Vite app."*

`apps/web/.env.example` (committed) — same seven keys at lines 2,3,4,7,8,9,12; identical pattern.

`apps/api/.env` (gitignored)
| line | key | value present |
| --- | --- | --- |
| 16 | `FXL_HUB_API_URL` | yes |
| 17 | `FXL_HUB_PUBLISHABLE_KEY` | yes — **REDACTED** |
| 18 | `FXL_HUB_SECRET_KEY` | **yes — REDACTED (real secret present in the working tree)** |
| 19 | `FXL_HUB_REDIRECT_URI` | yes |
(plus `NODE_ENV`, `PORT`, `CORS_ORIGIN`, `DATABASE_URL`, `SENTRY_DSN`(empty),
`RESEND_API_KEY`(empty), `RESEND_FROM`(empty), `TEST_DATABASE_URL`, `TEST_MIGRATE_DATABASE_URL`,
`ADMIN_DATABASE_URL`.) Note `FXL_HUB_AUDIENCE` is **absent** from this file.

`apps/api/.env.dev.example` (committed) — `FXL_HUB_API_URL`:24 (present),
`FXL_HUB_PUBLISHABLE_KEY`:25 (present, **REDACTED**), `FXL_HUB_SECRET_KEY`:27 (empty),
`FXL_HUB_AUDIENCE`:28 (empty), `FXL_HUB_REDIRECT_URI`:30 (empty),
`FXL_HUB_POST_LOGIN_REDIRECT`:32 (empty), `FXL_HUB_POST_LOGIN_ERROR_REDIRECT`:33 (empty),
`HUB_SESSION_ENCRYPTION_KEY`:38 (empty). Comment `:26` — *"Secret key is shown once by the Hub
admin panel. Never commit a real value."*; `:35-37` — the HKDF derivation note.

`apps/api/.env.example` (committed) — `FXL_HUB_API_URL`:10 (present),
`FXL_HUB_PUBLISHABLE_KEY`:11 (present, **REDACTED**), `FXL_HUB_SECRET_KEY`:12 (empty),
`FXL_HUB_AUDIENCE`:13 (empty), `FXL_HUB_REDIRECT_URI`:15 (empty),
`FXL_HUB_POST_LOGIN_REDIRECT`:17 (empty), `FXL_HUB_POST_LOGIN_ERROR_REDIRECT`:18 (empty).

**No `.env` file anywhere declares a `VITE_*SECRET*` key.** The browser has never been handed a
secret through env.

### 5.2 `vercel.json` (repo root)

```json
{ "framework": "vite",
  "buildCommand": "pnpm --filter @fxl-sales/web build",   // :9
  "outputDirectory": "apps/web/dist",                     // :10
  "installCommand": "pnpm install",                       // :11
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] // :12-17
}
```
- `:3-7` `git.deploymentEnabled.master = false`.
- **The catch-all rewrite at `:13-16` swallows `/auth/*` too** — there is no scoped `/auth/*`
  rewrite to the API origin. This is exactly the second option README `:66` describes:
  production must set `VITE_AUTH_BFF_BASE_PATH` (and `FXL_HUB_REDIRECT_URI`) to the API origin.
  No `env`/`build.env` block exists here, so all `VITE_*` come from the Vercel project settings.

### 5.3 `docker-compose.yml` (root)

- `:8-12` explicit env: `NODE_ENV`, `PORT=3006`, `DATABASE_URL`, `CORS_ORIGIN=http://localhost:8006`
- `:13-14` `env_file: [apps/api/.env]` ← this is how the API container receives every `FXL_HUB_*`
- `:22-26` db host port `5006:5432`
- **No web service.** No `VITE_*` anywhere in compose.

### 5.4 `apps/api/Dockerfile`

No `FXL_HUB_*` / `VITE_*` ARG or ENV; only `PNPM_HOME`, `PATH`, `NODE_ENV=production` (`:3-4`, `:31`).
Builds only shared-types, shared-utils, api (`:24-26`).

### 5.5 Coolify

No coolify config file exists in the repo. Coolify appears only as documentation:
`CLAUDE.md:380-381` (`staging` / `production` rows: *"Coolify staging DB"*, *"Coolify prod DB"*,
secrets from *Infisical `staging`/`prod` env*).

### 5.6 `README.md`

- `:6` — *"Authentication, workspace membership, active workspace switching, and commerce deep
  links are owned by FXL Hub through `@fxl-business/hub-sdk`."*
- `:13-14` ports table: API `http://localhost:3006`, Web `http://localhost:8006`
- `:44-48` API dotenv block: `FXL_HUB_API_URL`, `FXL_HUB_PUBLISHABLE_KEY` (**value present in the
  committed README — REDACTED here**), `FXL_HUB_SECRET_KEY=<operator-issued-secret>`,
  `FXL_HUB_REDIRECT_URI`, `PUBLIC_LINK_BASE_URL`
- `:54-58` web dotenv block: `VITE_API_URL`, `VITE_AUTH_PROXY_TARGET`, `VITE_AUTH_BFF_BASE_PATH=`,
  `VITE_FXL_HUB_API_URL`, `VITE_FXL_HUB_PUBLISHABLE_KEY` (**REDACTED**)
- `:62` *"Only set `FXL_HUB_AUDIENCE` when an operator explicitly asks for an override."*
- `:63-64` local same-origin `/auth/*` on `:8006`, proxied to `:3006`, callback
  `http://localhost:8006/auth/callback`
- `:66` — **the `/auth/switch` mention**: *"In production, either keep the same route shape with a
  scoped web rewrite for `/auth/login`, `/auth/callback`, `/auth/refresh`, `/auth/switch`, and
  `/auth/logout`, or set `VITE_AUTH_BFF_BASE_PATH` and `FXL_HUB_REDIRECT_URI` to the same
  API-origin callback."* ← **must change when `/auth/switch` is deleted in 2.x.**
- `:79` *"The API mounts the Hub BFF at `/auth/*`."*

### 5.7 `CLAUDE.md` — sections documenting these env vars / the SDK contract

| line | content |
| --- | --- |
| `:11` | stack line naming `@fxl-business/hub-sdk` |
| `:17-19` | BFF mounted at `/auth/*`; same-origin web `/auth/*`; Vite proxy; callback `http://localhost:8006/auth/callback` |
| `:32` | `sessionStore` construction rules under `1.3.0` |
| `:34-36` | `HubSessionStore` async/transactional as of `1.3.0` |
| `:47` | `createHubRotatedCookieFetch` wrapper |
| `:55` | **"`/auth/switch` carries the identical defect at `dist/server.js:518` … both routes are pinned."** ← must change |
| `:59` | **"The minimum usable SDK release is `@fxl-business/hub-sdk@1.3.1`, and the floor is a PACKAGING floor, not a behavioural one."** ← the version floor statement |
| `:65-67` | `hub_bff_sessions` / `hub_bff_login_txns`; sealing keyed by HKDF-SHA256 from `FXL_HUB_SECRET_KEY` unless `HUB_SESSION_ENCRYPTION_KEY` overrides |
| `:69-75` | login supersession, `withLoginContext`, discriminated store union |
| `:77` | **the whole "browser reads `/auth/refresh` itself through `requestHubAccessToken` … never through `HubClient.getToken()` … `dist/client.*` is byte-identical between `1.3.0` and `1.3.1`"** paragraph, naming the two pinning tests ← must change |
| `:81` | the ladder counter reset, naming `apps/web/src/auth/__tests__/react.test.tsx` |
| `:102` | `sanitizeReturnTo` normalized re-assertion |
| `:130` | names the two dedicated cache-ordering oracles by title |
| `:150` | Combobox rule incl. "the workspace switcher in `apps/web/src/auth/react.tsx`" |
| `:187` | `admin` is synthesized in-app from the Hub workspace `owner`/`admin` flag — `getRolesFromHubClaims` |
| **`:375-381`** | `## Environments` heading + the local/staging/production table (Infisical, Coolify) |
| **`:383-391`** | "Required API vars:" dotenv block — `FXL_HUB_API_URL`, `FXL_HUB_PUBLISHABLE_KEY` (**value committed — REDACTED**), `FXL_HUB_SECRET_KEY`, `FXL_HUB_REDIRECT_URI`, `PUBLIC_LINK_BASE_URL` |
| **`:393-401`** | "Required web vars:" dotenv block — `VITE_API_URL`, `VITE_AUTH_PROXY_TARGET`, `VITE_AUTH_BFF_BASE_PATH=` (empty), `VITE_FXL_HUB_API_URL`, `VITE_FXL_HUB_PUBLISHABLE_KEY` (**REDACTED**) |
| `:403-404` | `PUBLIC_LINK_BASE_URL` / `/r/:code` |
| `:406-414` | `## Commands` block (see §7) |
| `:416` | "`pnpm test` includes a tracked-file guard that fails when the removed auth provider is reintroduced." |

### 5.8 Test fixtures/setup that set `FXL_HUB_*`

- Browser side: `vi.stubEnv` only, no setup file — `apps/web/src/auth/__tests__/react.test.tsx:321-322,387`,
  `apps/web/src/__tests__/session-journey.test.tsx:375-376`,
  `apps/web/src/sales-ops/__tests__/session-loss-keeps-route.test.tsx:312-313`,
  `apps/web/src/auth/__tests__/provider.test.ts:8-9`.
  All use `VITE_FXL_HUB_API_URL='http://hub.test'` (or `http://localhost:9016`) and
  `VITE_FXL_HUB_PUBLISHABLE_KEY='pk_fxl-sales_test'` — placeholders, not secrets.
- `apps/web/vitest.config.ts` has **no `setupFiles`**.
- API side: `apps/api/test/rls/setup-env.ts` hard-overrides `DATABASE_URL` (CLAUDE.md `:373`); it is
  the API slice's concern.

---

## 6. Grep results — `apps/web` + `packages/` (auth-relevant hits)

**`hub-sdk` / `createHubClient`**
- `apps/web/package.json:14` (dependency `^1.3.1`)
- `apps/web/vite.config.ts:27` (`optimizeDeps.include`)
- `apps/web/src/auth/react.tsx:2` (import), `:204` (construction)
- `apps/web/src/auth/refresh.ts:5`, `:18` (doc references)
- `apps/web/src/auth/__tests__/react.test.tsx:3,34,47-48,399`
- `apps/web/src/__tests__/session-journey.test.tsx:27,58,67-68,377`
- `apps/web/src/sales-ops/__tests__/session-loss-keeps-route.test.tsx:3,34,46-47,314`

**`publishableKey` / `PUBLISHABLE_KEY`**
- `apps/web/src/auth/provider.ts:3,11,12,13,17`
- `apps/web/src/auth/__tests__/provider.test.ts:9,13`
- `apps/web/src/auth/__tests__/react.test.tsx:322`
- `apps/web/src/__tests__/session-journey.test.tsx:376`
- `apps/web/src/sales-ops/__tests__/session-loss-keeps-route.test.tsx:313`
- `packages/shared-types/src/env.ts:15`; `packages/shared-types/dist/env.d.ts:18,23,28`
- NOT auth: `apps/web/src/admin/types.ts:12`, `apps/web/src/admin/apps/AppsPage.tsx:72,84`,
  `apps/web/src/admin/products/__tests__/useProducts.test.ts:75` (the admin *app registry* entity)

**`setActive`**
- `apps/web/src/auth/react.tsx:105` (context type), `:543` (callback), `:547` (SDK call),
  `:416` (comment), `:618`, `:621` (memo), `:876`, `:886` (UI)
- `apps/web/src/auth/__tests__/react.test.tsx:18,409,422,460,465,473,503-504,509,519-520,1644,1662,1664,1672,1674,1681,1686,1709-1710,1712,1752`
- `apps/web/src/__tests__/session-journey.test.tsx:42`
- `apps/web/src/sales-ops/__tests__/session-loss-keeps-route.test.tsx:18`
- NOT auth: `apps/web/src/components/ui/combobox.tsx:86,163,194,252,277,385` (`setActiveIndex`)

**`auth/switch`** — **zero hits in `apps/web` and `packages/`.**
Repo hits are API-only: `apps/api/src/middleware/app-auth.ts:223`,
`apps/api/src/auth/hub-rotated-cookie.ts:11`,
`apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts:605,615,629`;
plus docs `README.md:66`, `CLAUDE.md:55`.

**`workspace`** — the dominant vocabulary. Auth-relevant sites:
`apps/web/src/auth/claims.ts:7,22` (`roles.workspace` claim);
`apps/web/src/auth/react.tsx:81` (`workspaceName`), `:84-88` (`HubWorkspacePreview`),
`:105` (`setActive(workspaceId)`), `:116-146` (`readWorkspaces`, incl. `workspaceId ?? id` at `:134`),
`:162-163`, `:240`, `:262`, `:271`, `:606-621`, `:876-897` (the switcher, `aria-label="Workspace"`,
`searchPlaceholder="Buscar workspace..."`);
`apps/web/src/lib/displayNames.ts` via `orgLabel`/`isOrgLabelFallback` (`react.tsx:20,890,893`).
**No literal `?workspace=` or `?organization=` query string exists anywhere in `apps/web/src`.**

**`entitlements`** — no `entitlements` identifier in `apps/web` or `packages`. Prose only:
`apps/web/src/sales-ops/SalesOpsApp.tsx:1252` (*"profile say nothing at all about entitlement"*)
and the test title `apps/web/src/__tests__/session-journey.test.tsx:518`.

**`getToken`**
- SDK-typed mocks: `react.test.tsx:17`, `session-journey.test.tsx:15`(rel. `:41`),
  `session-loss-keeps-route.test.tsx` client mock
- app provider: `apps/web/src/auth/react.tsx:102` (context type), `:470-474` (impl),
  `:386` (ladder rung), `:471` (cache read), `:572` (bootstrap effect), `:615`, `:860-861` (`useHubAccessToken`)
- cache: `apps/web/src/auth/token.ts:7,112,116`
- guard: `apps/web/src/lib/require-token.ts:57-61`; eslint selector
  `apps/web/eslint.config.js:53-54` matches `callee.name='getToken'`
- ~119 non-test call sites reach it through `useAccessToken()`/`requireToken(getToken)`.

---

## 7. How the suite runs + root scripts

`apps/web/package.json:7` `"test": "vitest run"` ; `:5` `"type-check": "tsc --noEmit"` ;
`:6` `"lint": "eslint src/"` ;
`:4` `"build": "pnpm --filter @fxl-sales/web^... build && tsc --noEmit && vite build"`.

Root `package.json:7-16`, verbatim:
```json
"scripts": {
  "build": "pnpm run build:packages && pnpm --filter @fxl-sales/api build && pnpm --filter @fxl-sales/web build",
  "build:packages": "pnpm --filter @fxl-sales/shared-types build && pnpm --filter @fxl-sales/shared-utils build",
  "type-check": "pnpm run build:packages && pnpm -r type-check",
  "lint": "pnpm -r lint",
  "test": "pnpm run build:packages && pnpm -r --if-present test && node scripts/no-legacy-auth.mjs && node scripts/build-contract.mjs",
  "perf:audit": "node scripts/perf-audit.mjs",
  "install:all": "pnpm install",
  "prepare": "husky || true"
}
```
`package.json:5` `"packageManager": "pnpm@10.17.1"`; `:6` `"fxlContractVersion": "1.0"`;
`:7` (block above); engines `node >=20`, `pnpm >=9`.

**The tracked-file guard `pnpm test` includes** is `scripts/no-legacy-auth.mjs` (18 lines):
```js
const banned = String.fromCharCode(99, 108, 101, 114, 107);           // :3  -> the removed provider name
const result = spawnSync('git', ['grep', '-n', '-i', '--', banned, '--', '.'], { encoding: 'utf8' }); // :4-6
if (result.status === 1) process.exit(0);                              // :8-10  (no match => pass)
if (result.error) { console.error(result.error.message); process.exit(1); } // :12-15
process.stderr.write(result.stdout); process.exit(1);                  // :17-18
```
It is a **`git grep` over TRACKED files only** for the removed legacy auth provider's name
(obfuscated so the guard does not trip on itself). Any tracked file — including a new plan or
recon doc — that contains that word fails `pnpm test`.

The second root guard is `scripts/build-contract.mjs` (header `:1-14`): asserts the two static
config invariants that broke a Vercel deploy when `apps/web` first imported
`@fxl-sales/shared-utils` (dist absent on a clean clone, `vercel.json.buildCommand` built only web).

`CLAUDE.md:408-414` documents the command set:
```bash
pnpm run lint
pnpm run type-check
pnpm test
pnpm run build
pnpm --filter @fxl-sales/api test:integration
```
and `CLAUDE.md:416` states the tracked-file guard explicitly.

---

## 8. Condensed breakage inventory (web only)

| 2.x change | web sites that must change | tests that go red |
| --- | --- | --- |
| `HubPublicConfig`, throw on `clientSecret` | `apps/web/src/auth/provider.ts:1-20`, `react.tsx:204` | `provider.test.ts:5` (`loads Hub browser config from Vite env vars`); nothing else — every DOM test mocks `createHubClient` |
| `bffBasePath` option moved/renamed | `react.tsx:202-210`, `provider.ts:22-23` | `react.test.tsx:383` (`wires the token cache to the BFF refresh endpoint at the same base path as the SDK client`) |
| `getToken` removed / `getTokenResult()` added | `HubClient` mock objects `react.test.tsx:14-22`, `session-journey.test.tsx:12-20`, `session-loss-keeps-route.test.tsx:16-23` (all `satisfies HubClient`) | type-check failure; assertions `react.test.tsx:368`, `:431` reference `mocks.client.getToken` |
| `ok/expired/unavailable` replacing `HubTokenResult` | `refresh.ts:27-42,73-82`, `token.ts` throughout, `react.tsx:390-459` | ALL of `refresh.test.ts`; `token.test.ts:125,161`; `react.test.tsx:81-83` + every `mockResolvedValue`, headline titles `:593`, `:614`, `:1378` |
| `setActive` → POST `/auth/refresh` `{organizationId}` | `react.tsx:543-568`, `refresh.ts:50-63` (now shares the endpoint) | `refresh.test.ts:83` (`posts to the BFF refresh endpoint with credentials included`) if a body is ever added by the shared caller; `react.test.tsx:405,459,497,1642,1671,1703,1750` if `SetActiveResult` reshapes |
| `/auth/switch` deleted | nothing in `apps/web/src`; `apps/web/vite.config.ts:53` prefix rule already covers | zero web tests; `apps/api/.../app-auth-bff-wiring.test.ts:605` (API slice); docs `README.md:66`, `CLAUDE.md:55` |
| login `?organization=` instead of `?workspace=` | nothing — no query-string literal in `apps/web/src` | none |
| SDK-side proactive renewal | duplicates `react.tsx:66,226-227,305-364,592-598` and `token.ts:118-125` | the nine `describe('proactive token renewal')` tests, `react.test.tsx:1151-1403` |
| `roles.workspace` claim renamed | `claims.ts:7,22`; `react.tsx:116-146,162` | `claims.test.ts:11`; `react.test.tsx` `profileToken` fixture `:103-120` |
| SDK subpath export change | `react.tsx:2`, `vite.config.ts:27`, 3 `vi.mock` factories | none directly (`route-error-and-auth-context.test.tsx:69` does not assert the hub-sdk entry) |
