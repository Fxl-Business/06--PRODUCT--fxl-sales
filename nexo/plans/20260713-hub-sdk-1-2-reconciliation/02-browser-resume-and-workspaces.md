---
id: 02-browser-resume-and-workspaces
milestone: null
status: parked
depends_on: [01-sdk-contract-baseline]
files_modified: [apps/web/src/App.tsx, apps/web/src/auth/hub-browser.ts, apps/web/src/auth/resume.ts, apps/web/src/auth/hub-workspaces.ts, apps/web/src/auth/WorkspaceSwitcher.tsx, apps/web/src/auth/token.ts, apps/web/src/auth/claims.ts, apps/web/src/auth/react.tsx, apps/web/src/auth/__tests__/hub-browser.test.ts, apps/web/src/auth/__tests__/resume.test.ts, apps/web/src/auth/__tests__/hub-workspaces.test.tsx, apps/web/src/auth/__tests__/token.test.ts, apps/web/src/auth/__tests__/claims.test.ts, apps/web/src/auth/__tests__/react.test.tsx, apps/web/src/lib/authenticated-fetch.ts, apps/web/src/lib/api-client.ts, apps/web/src/lib/__tests__/authenticated-fetch.test.ts, apps/web/src/admin/apps/useApps.ts, apps/web/src/admin/audit/useAuditLog.ts, apps/web/src/admin/commissions/useAdminCommissions.ts, apps/web/src/admin/conversions/useConversions.ts, apps/web/src/admin/finders/hooks/useFinders.ts, apps/web/src/admin/payouts/usePayouts.ts, apps/web/src/admin/products/useProducts.ts, apps/web/src/admin/products/__tests__/useProducts.test.ts, apps/web/src/admin/sellers/hooks/useSellers.ts, apps/web/src/finder/clicks/useClicks.ts, apps/web/src/finder/links/useLinks.ts, apps/web/src/sales-ops/api.ts, apps/web/src/sales-ops/hooks.ts, apps/web/src/i18n/pt-BR.json, apps/web/src/i18n/en.json]
acceptance: "Given an authenticated or recoverable Hub browser session, when the tab resumes, a protected read receives 401, optional display claims are absent, or the workspace claim reaches its 40-entry cap, then one disposable focus and visibility recovery helper silently uses SDK getToken without navigation, temporary failures preserve the signed-in profile, only confirmed no_session or session_expired exposes a login action, GET and HEAD requests receive at most one forced-refresh replay while writes receive none, and the workspace selector pages the configured Hub GET /me/workspaces endpoint while switching through SDK setActive or starting the same-origin /auth/login?workspace= flow."
---

# Slice 02 - Browser resume and workspaces

## Goal

Make idle-tab recovery silent, make one authentication retry safe for reads, and keep the workspace selector complete beyond the Hub token claim's 40-entry cap.

This slice preserves the current SDK-owned BFF, OAuth, discovery, token verification, workspace switch, and logout paths.

## Installed SDK 1.2.0 findings and explicit limitation

The installed published artifact is `@fxl-business/hub-sdk@1.2.0` at `node_modules/.pnpm/@fxl-business+hub-sdk@1.2.0_hono@4.12.25/node_modules/@fxl-business/hub-sdk`.
Its browser entry is `@fxl-business/hub-sdk/client` and exposes exactly `createHubClient`, `login()`, `getToken(): Promise<string | null>`, `setActive(workspaceId)`, `logout()`, `checkoutUrl()`, and `manageUrl()`.

`getToken()` calls the configured BFF `POST /auth/refresh` with credentials and returns the access token only for a valid 200 JSON response.
It catches network failures and converts network errors, every non-200 status, and malformed success bodies to the same `null` value.
It does not accept a force-refresh option, expose the response status or error body, own a cache, or expose a focus helper.

The installed 1.2.0 BFF returns `401 { error: "no_session" }` for an absent product session.
It returns `401 { error: "refresh_failed" }` for both upstream 401 and network failure, so the published server cannot reliably distinguish permanent Hub expiry from a temporary refresh failure.
It never emits `session_expired` itself.

This is an SDK limitation, not a product decision.
The product must not infer sign-out from `null`, `refresh_failed`, HTTP 401 alone, malformed data, a timeout, or a network exception.

The smallest robust compatibility adapter uses only `createHubClient`'s documented `fetchImpl` and `navigate` seams.
It observes responses to SDK-initiated BFF refresh and switch calls, but it never initiates those calls itself.
It classifies only exact BFF error values `no_session` and `session_expired` as permanent.
Every other failed SDK token result is `temporarily_unavailable` and preserves the current profile.
Supporting `session_expired` in the observer is forward-compatible with the server session work, but 1.2.0 can currently confirm only `no_session`.

The SDK's `login()` also has no workspace argument.
For a workspace-specific reauthentication action, the adapter may navigate only to the SDK-owned same-origin BFF route `${bffBasePath}/auth/login?workspace=<encoded id>`.
It must not derive or hard-code an OAuth endpoint, JWKS URI, Hub web origin, authorization URL, or callback URL.

## Architecture and exact interfaces

### Browser SDK compatibility adapter

Create `apps/web/src/auth/hub-browser.ts` as the only compatibility layer around `createHubClient`.
Export these exact result types.

```ts
export type PermanentHubSessionReason = 'no_session' | 'session_expired';

export type HubTokenResult =
  | { status: 'authenticated'; token: string; source: 'cache' | 'refresh' }
  | { status: 'unauthenticated'; reason: PermanentHubSessionReason }
  | { status: 'temporarily_unavailable' };

export type HubWorkspaceSwitchResult =
  | { status: 'switched'; accessToken: string; expiresIn: number; workspaceId: string }
  | { status: 'unauthenticated'; reason: PermanentHubSessionReason }
  | { status: 'failed'; reason: 'not_a_member' | 'temporarily_unavailable' };

export type HubBrowserAdapter = {
  getToken: () => Promise<HubTokenResult>;
  setActive: (workspaceId: string) => Promise<HubWorkspaceSwitchResult>;
  logout: () => Promise<void>;
  login: (workspaceId?: string) => void;
};
```

Export `createHubBrowserAdapter(config, options): HubBrowserAdapter`.
The options accept the same BFF base path, an injectable `fetchImpl`, and an injectable `navigate` function used by tests and workspace-specific login.

Construct exactly one SDK `HubClient` inside the adapter.
Wrap its injected fetch once so an invocation-scoped attempt object observes the status and a cloned JSON body for the SDK request that the adapter just started.
The wrapper must forward the original input and init unchanged and must return the original `Response` to the SDK.
It must not consume the original response body, alter credentials, synthesize success, retry, or swallow a thrown fetch error.

`getToken()` must invoke the SDK client's real `getToken()` exactly once per adapter attempt.
Return `authenticated` for its string result.
For `null`, return `unauthenticated` only when the observed BFF body has exact `error` or `code` value `no_session` or `session_expired`.
Return `temporarily_unavailable` for every other response or fetch failure.

`setActive(workspaceId)` must invoke the SDK client's real `setActive(workspaceId)`.
Return the SDK `SetActiveResult` fields under `switched`.
On rejection, classify only an observed permanent session error as `unauthenticated`, classify exact `not_a_member` as that failure, and classify everything else as `temporarily_unavailable`.
Do not parse the SDK exception message to decide whether the user is signed out.

`logout()` delegates to SDK `logout()`.
`login()` with no argument delegates to SDK `login()`.
`login(workspaceId)` calls only the injected navigation seam with the configured BFF login route and an encoded `workspace` query value.

### Token cache and access-token getter

Change `apps/web/src/auth/token.ts` to cache `HubTokenResult` from `HubBrowserAdapter` instead of treating every SDK `null` as sign-out.
Export these exact interfaces.

```ts
export type GetAccessTokenOptions = { forceRefresh?: boolean };

export type AccessTokenGetter = (
  options?: GetAccessTokenOptions,
) => Promise<string | null>;

export type HubAccessTokenCache = {
  getToken: (options?: GetAccessTokenOptions) => Promise<HubTokenResult>;
  seed: (accessToken: string, expiresInSeconds: number) => void;
  clear: () => void;
};
```

Keep the existing 30-second JWT expiry skew, memory-only storage, one in-flight operation, switch seeding, logout clearing, and generation guards.
For a normal getter, return `{ status: 'authenticated', token, source: 'cache' }` while the cached token is healthy.
At the skew boundary, call the adapter once.
On `temporarily_unavailable`, leave the cached token and profile data in memory, but return the temporary result because an expired token must not be presented as fresh.
On `unauthenticated`, discard the cache.

`forceRefresh: true` must bypass a healthy cache and invalidate that rejected access token before starting one adapter refresh.
Concurrent normal or forced callers share the same in-flight adapter call.
A forced refresh is used only after an application API 401, where the old token has already proved unusable.

The React provider exposes an `AccessTokenGetter` that converts only an authenticated cache result to a string.
It applies refreshed claims only for an authenticated result, clears auth only for an unauthenticated result, and returns `null` without clearing profile state for temporary unavailability.

### Disposable resume helper

Create `apps/web/src/auth/resume.ts` with this exact surface.

```ts
export function listenForHubResume(
  resume: () => Promise<unknown>,
  targets?: { window: Window; document: Document },
): () => void;
```

Create one callback function and register that same function once for `window.focus` and once for `document.visibilitychange`.
Ignore visibility changes while `document.visibilityState !== 'visible'`.
Share one in-flight resume promise so paired focus and visibility events do not start overlapping work.
Invoke only the supplied silent getter.
Do not call login, navigate, reload, mutate history, create an interval, or create a background timer.
Return one disposer that removes both registrations and marks the listener inactive.

`HubAuthProvider` calls this helper from one `useEffect` and returns its disposer.
That effect owns an `active` guard around the supplied async resume callback, and it checks the guard after `tokenCache.getToken()` resolves before applying any lifecycle or profile state.
Cleanup marks the callback inactive before removing the listeners, so an already in-flight refresh cannot apply state after disposal.
The silent getter uses the normal cache path, so a healthy token causes no SDK request and a stale token calls SDK `getToken()` once.

### Auth lifecycle and route guard

Replace the current two-boolean-only internal state with an explicit provider lifecycle while preserving the public `isLoaded` and `isSignedIn` fields used by existing screens.

```ts
type HubAuthLifecycle = 'loading' | 'signed_in' | 'reconnecting' | 'signed_out';
```

Initial authenticated refresh sets `signed_in`.
Initial temporary failure sets `reconnecting` and renders a stable reconnecting view without login navigation.
A temporary resume or forced refresh failure while signed in leaves the profile, roles, workspace label, workspace previews, route, and document mounted.
An exact `no_session` or `session_expired` clears the cache and profile, sets `signed_out`, and exposes a button that invokes the adapter `login()` only after the user clicks.

Delete the `HubProtected` effect that automatically calls `login()` whenever `isLoaded && !isSignedIn`.
`HubProtected` renders the existing full-page skeleton while loading, a translated reconnecting state while no valid initial profile is available temporarily, and a translated sign-in affordance only for `signed_out`.
It must never initiate navigation during render or an effect.

If `setActive(workspaceId)` succeeds, retain the existing ordering: generation check, token cache seed, then profile application.
If it fails temporarily or with `not_a_member`, preserve the current active workspace and show a translated non-destructive error next to the selector.
If it returns a permanent session reason, clear auth, remember only the requested workspace id in memory, and let the sign-in button call `login(requestedWorkspaceId)`.
Logout continues to increment the provider operation generation, clear token and profile state before awaiting SDK logout, and ends in the signed-out affordance without reusing a stale switch result.

### Optional display claims

Move or expose the current display parsing from `react.tsx` through `apps/web/src/auth/claims.ts` so it is independently testable.
The parser accepts optional `name`, `email`, `avatarUrl`, `workspaceName`, and `workspaces` entries.
Each workspace preview may contain optional `name` and `products`.
Missing, malformed, or unknown display fields are ignored.

Do not add any optional display field to a token validity decision, route authorization decision, API authorization header decision, or entitlement decision.
The existing role projection remains based on `roles.workspace` and allowlisted `roles.productRoles` for browser UX, while the API verifier and API authorization remain authoritative.
The product's core entitlement remains `entitlements.modules` and is not inferred from workspace preview `products`.

No customer-facing option may render a raw account or workspace id.
When a workspace name is absent, render the translated ordinal label `Workspace {{index}}` or `Espaço de trabalho {{index}}`.
The raw id remains only the internal `<option value>` passed to `setActive` or the encoded BFF login query.

### Authenticated request replay

Create `apps/web/src/lib/authenticated-fetch.ts` as the single bearer injection and replay primitive.

```ts
export async function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit,
  getToken: AccessTokenGetter,
  fetchImpl?: typeof fetch,
): Promise<Response>;
```

Resolve the initial token through `getToken()` and send one request with its bearer header when present.
Preserve caller headers and never log the token.

If the response is not 401, return it unchanged.
If the method is not `GET` or `HEAD`, return the 401 unchanged and never force refresh or replay.
Derive the effective method from `init.method`, then from `input.method` when `input` is a `Request`, and only default to `GET` when neither supplies one.
Normalize the effective method to uppercase before the replay allowlist check.
Merge headers from a `Request` input and `init.headers`, with explicit init headers taking precedence, then replace only `Authorization` with the current bearer.

For one `GET` or `HEAD` 401, call `getToken({ forceRefresh: true })` exactly once.
If that returns a token, replay the original read exactly once with the new bearer and return the replay response, even when it is another 401.
If forced refresh returns `null`, return the original 401 without replay.
Never add a recursive retry, a loop, a TanStack mutation retry, or automatic replay for `POST`, `PUT`, `PATCH`, or `DELETE`.

Route both `apiFetch` and `apiFetchBlob` through `authenticatedFetch` and change their auth option from a token string to an `AccessTokenGetter`.
Keep JSON parsing, blob parsing, filenames, and `ApiError` behavior unchanged.

Export a small `shouldRetryQuery(failureCount, error)` policy and configure the `QueryClient` in `apps/web/src/App.tsx` so a terminal `ApiError` with status 401 is not retried again by TanStack Query.
Keep one TanStack retry for non-auth query failures.
This prevents the query layer from multiplying the one internal authentication replay.

Change every current query and mutation caller to pass its stable `getToken` callback into the API facade instead of eagerly resolving `(await getToken()) ?? ''`.
The complete caller set is:

- `apps/web/src/admin/apps/useApps.ts`
- `apps/web/src/admin/audit/useAuditLog.ts`
- `apps/web/src/admin/commissions/useAdminCommissions.ts`
- `apps/web/src/admin/conversions/useConversions.ts`
- `apps/web/src/admin/finders/hooks/useFinders.ts`
- `apps/web/src/admin/payouts/usePayouts.ts`
- `apps/web/src/admin/products/useProducts.ts`
- `apps/web/src/admin/sellers/hooks/useSellers.ts`
- `apps/web/src/finder/clicks/useClicks.ts`
- `apps/web/src/finder/links/useLinks.ts`
- `apps/web/src/sales-ops/hooks.ts`

Change every API facade signature in `apps/web/src/lib/api-client.ts` and `apps/web/src/sales-ops/api.ts` from `token: string` to `getToken: AccessTokenGetter`.
Do not change endpoint paths, request methods, bodies, invalidation keys, optimistic updates, CSV behavior, or response types.

### Workspace cap and paginated Hub fallback

Create `apps/web/src/auth/hub-workspaces.ts` for the canonical Hub membership read.

```ts
export const WORKSPACES_CLAIM_MAX = 40;
export const ME_WORKSPACES_PAGE_LIMIT = 100;

export type HubWorkspace = {
  id: string;
  name?: string;
  role?: string;
  kind?: string;
  products?: string[];
};

export type HubWorkspacePage = {
  workspaces: HubWorkspace[];
  nextCursor?: string;
};

export function fetchHubWorkspacePage(input: {
  hubApiUrl: string;
  cursor?: string;
  getToken: AccessTokenGetter;
  fetchImpl?: typeof fetch;
}): Promise<HubWorkspacePage>;
```

Build the URL from only `loadHubBrowserConfig(import.meta.env).apiUrl`, which is the SDK's configured Hub API base serving discovery and JWKS.
Append exactly `/me/workspaces`, `limit=100`, and an encoded `cursor` only when present.
Call it through `authenticatedFetch` with method `GET` and the current product access token.
This endpoint accepts any valid `product.*` audience and returns only memberships for verified token `sub`.

Accept only the canonical response `{ workspaces: [{ workspaceId, name, role, kind }], nextCursor? }`.
Normalize `workspaceId` to internal `id`.
Ignore malformed rows and treat absent or non-string `nextCursor` as terminal.
Reject non-success responses and a malformed top-level body with a fixed token-free error so TanStack Query can retain the claim-preview fallback and expose translated membership feedback.
Do not send `accountId`, `workspaceId`, product id, publishable key, secret key, or any user-controlled subject selector.

Create `WorkspaceSwitcher.tsx` and let TanStack `useInfiniteQuery` own the paginated server state.
Use token claim previews directly while there are fewer than 40 valid entries.
Enable `GET /me/workspaces` when the valid claim preview length is greater than or equal to `WORKSPACES_CLAIM_MAX`, because exactly 40 cannot prove the claim is complete.
Use `nextCursor` as `getNextPageParam` and provide a translated load-more control while another page exists.

Flatten and de-duplicate endpoint pages by workspace id.
Merge optional claim-only `products` into matching endpoint entries for display only.
If the endpoint is loading or temporarily unavailable, keep the claim preview selectable rather than replacing it with an empty control.
Never hide the active workspace merely because optional display claims or the uncapped endpoint are unavailable.

Selecting an authenticated workspace calls only provider `setActive(workspaceId)`, which delegates to SDK `setActive` and updates in place without reload.
A confirmed expired session after that selection exposes the user-clicked login action for `/auth/login?workspace=<encoded id>`.

Add matching `auth` strings to both `pt-BR.json` and `en.json` for reconnecting, sign-in title and body, workspace label, unnamed workspace ordinal, load-more, loading, switch failure, and membership failure.

## Locked RED oracle

The executor writes all tests in this section before changing implementation code.
Once a named test has produced its expected RED failure, its behavioral assertions are locked and the implementer must not weaken or delete them during Green.

### RED 1 - SDK compatibility adapter

Create `apps/web/src/auth/__tests__/hub-browser.test.ts` with a mocked `createHubClient`, injected fetch, and injected navigation.
Lock these cases:

1. `calls SDK getToken once and reports an authenticated token`.
2. `classifies exact no_session and session_expired responses as unauthenticated`.
3. `classifies refresh_failed, network rejection, 5xx, malformed JSON, and null without an observed response as temporarily unavailable`.
4. `does not consume or alter the SDK response while observing its cloned error body`.
5. `delegates successful workspace switching to SDK setActive`.
6. `preserves a switch on not_a_member or temporary failure and classifies only permanent session codes as unauthenticated`.
7. `delegates plain login and logout to the SDK`.
8. `navigates workspace login only to the encoded configured BFF route`.
9. `never derives an OAuth, JWKS, discovery, callback, or Hub web URL`.

Run once from the repository root:

```sh
pnpm --filter @fxl-sales/web exec vitest run src/auth/__tests__/hub-browser.test.ts
```

Expected RED: the module and compatibility result types do not exist.

### RED 2 - Cache force refresh and disposable resume

Extend `apps/web/src/auth/__tests__/token.test.ts` while retaining every existing cache race and expiry test.
Replace the old test that requires every failed refresh to clear cache with lifecycle-aware cases.
Lock these new cases:

1. A healthy normal getter returns the cached source without another adapter call.
2. `forceRefresh: true` bypasses and invalidates a healthy cached token, calls the adapter once, and caches a successful replacement.
3. Concurrent forced and normal misses share one adapter promise.
4. A temporary normal refresh failure leaves the prior token state intact but does not return an expired token as fresh.
5. A permanent result clears cached state.
6. Switch seed and logout clear still defeat older refresh completions.

Create `apps/web/src/auth/__tests__/resume.test.ts`.
Lock these cases:

7. The same callback is attached once to focus and once to visibilitychange.
8. Hidden visibility changes do nothing.
9. Paired visible and focus events share one in-flight silent getter.
10. The disposer removes both registrations and later events do nothing.
11. The helper never calls navigation, reload, history, or login because none is accepted by its interface.

Run once:

```sh
pnpm --filter @fxl-sales/web exec vitest run src/auth/__tests__/token.test.ts src/auth/__tests__/resume.test.ts
```

Expected RED: the cache has no forced or typed lifecycle path, clears state for every null result, and the disposable resume helper does not exist.

### RED 3 - One safe replay and no write replay

Create `apps/web/src/lib/__tests__/authenticated-fetch.test.ts` with an injected fetch and getter spy.
Lock these cases:

1. A GET 401 forces one refresh and replays once with the replacement bearer.
2. A HEAD 401 follows the same one-replay rule.
3. A second 401 is returned without a third fetch or second forced refresh.
4. A forced getter returning null returns the original 401 without replay.
5. POST, PUT, PATCH, and DELETE each perform one fetch, never call the forced getter, and never replay after 401.
6. A non-401 read response performs no forced refresh.
7. Caller headers survive both attempts while the new Authorization header replaces the old bearer.
8. `apiFetch` and `apiFetchBlob` use the same primitive.
9. A `Request` input whose method is POST and whose init omits `method` performs one fetch and is never replayed.
10. `shouldRetryQuery` returns false for an `ApiError` 401 and preserves one retry for non-auth failures.

Run once:

```sh
pnpm --filter @fxl-sales/web exec vitest run src/lib/__tests__/authenticated-fetch.test.ts
```

Expected RED: the helper does not exist and `apiFetch` accepts a pre-resolved token with no replay seam.

### RED 4 - Provider lifecycle, optional claims, and large workspaces

Extend `claims.test.ts` to prove missing optional display fields remain valid input, malformed optional fields are ignored, workspace products are display-only, and role mapping behavior is unchanged.

Extend `react.test.tsx` with the real cache and a mocked `HubBrowserAdapter`.
Wrap rendered `UserControls` in a fresh `QueryClientProvider` with retries disabled for deterministic tests.
Retain the existing hydration, switch ordering, newest-switch, logout ordering, and late-switch tests.
Lock these additional cases:

1. A stale authenticated profile receives paired focus and visibility events, calls adapter getToken once, updates silently on success, and preserves the exact pathname and mounted probe identity.
2. A temporary resume result preserves the rendered name, roles, workspace, selector, URL, and signed-in profile and never calls login.
3. An initial temporary result renders reconnecting rather than sign-in and never navigates.
4. Exact no_session or session_expired renders a sign-in button but does not call login until click.
5. Unmount disposes resume handling, a later event performs no token call, and an already in-flight resume result cannot apply profile state after cleanup.
6. A temporary or not_a_member workspace-switch failure retains the previous workspace and renders translated feedback.
7. A permanent switch failure preserves the requested workspace only for the clicked sign-in action and calls `login(requestedWorkspaceId)` after click.
8. Missing workspace names render translated ordinal labels and never raw ids.

Create `hub-workspaces.test.tsx` for the pure page client and the rendered switcher.
Lock these cases:

9. Fewer than 40 claim entries perform no Hub membership request.
10. Exactly 40 claim entries request `${hubApiUrl}/me/workspaces?limit=100` with the current bearer.
11. A next cursor is encoded and followed once per load-more action, and an absent cursor is terminal.
12. Canonical `workspaceId`, name, role, and kind fields normalize correctly while malformed rows are ignored.
13. Pages de-duplicate by id and retain optional claim products only as display metadata.
14. A loading or failed fallback retains the capped claim preview instead of emptying the selector.
15. Selecting an endpoint-only workspace calls the provider switch with its id and never reloads.

Update `useProducts.test.ts` to lock one representative write caller.
Assert the create hook passes the stable getter function into `adminProductsApi.create` and does not pre-resolve it in the hook.
The centralized write test remains the oracle that this mutation cannot replay.

Run once:

```sh
pnpm --filter @fxl-sales/web exec vitest run src/auth/__tests__/claims.test.ts src/auth/__tests__/react.test.tsx src/auth/__tests__/hub-workspaces.test.tsx src/admin/products/__tests__/useProducts.test.ts
```

Expected RED: the provider auto-navigates on signed-out hydration, has no resume lifecycle, exposes raw-id fallbacks, uses only capped token workspaces, and eagerly resolves mutation tokens.

## Mechanical GREEN implementation steps

- [ ] Create the browser SDK compatibility adapter and make its adapter tests green without changing the installed SDK.
- [ ] Preserve the exact lossy 1.2.0 limitation in code comments next to the permanent error allowlist so future cleanup knows why the observer exists.
- [ ] Convert the cache to typed adapter results, add forced bypass, preserve all current generation races, and make cache plus resume tests green.
- [ ] Add the one disposable resume effect to the provider and remove the route guard's automatic login effect.
- [ ] Add explicit loading, reconnecting, signed-in, and signed-out state transitions.
- [ ] Preserve the signed profile on every temporary refresh or switch failure.
- [ ] Clear browser token and profile state only on logout or exact permanent session classification.
- [ ] Keep workspace switch seeding before profile exposure and keep newest-operation generation checks.
- [ ] Add user-clicked normal and workspace-specific login actions through the adapter.
- [ ] Extract optional display parsing, keep authorization fields separate, and replace raw workspace-id labels with translated ordinal labels.
- [ ] Create the authenticated fetch primitive and prove the exact read replay and write non-replay matrix.
- [ ] Route JSON and blob API helpers through that primitive.
- [ ] Change the QueryClient retry predicate so terminal 401 errors receive no outer query retry.
- [ ] Change every listed query and mutation hook to pass its getter function rather than a token string.
- [ ] Change every API facade method signature consistently and run type-check to catch any missed caller.
- [ ] Create the canonical Hub workspace page client from the configured Hub API URL only.
- [ ] Add the cap-aware TanStack infinite query, preview fallback, de-duplication, translated selector, load-more state, and SDK switch action.
- [ ] Add every new auth string to both locale files and run the existing i18n key parity test.
- [ ] Run the complete focused command until Green without weakening the locked tests.
- [ ] Refactor only on Green, keeping protocol observation, cache policy, React lifecycle, authenticated fetch, and workspace pagination in their focused files.

## Exact focused and Gate 2 commands

The executor and separate Verify agent run this focused oracle once per attempt, never in watch mode:

```sh
pnpm --filter @fxl-sales/web exec vitest run src/auth/__tests__/hub-browser.test.ts src/auth/__tests__/resume.test.ts src/auth/__tests__/hub-workspaces.test.tsx src/auth/__tests__/token.test.ts src/auth/__tests__/claims.test.ts src/auth/__tests__/react.test.tsx src/lib/__tests__/authenticated-fetch.test.ts src/admin/products/__tests__/useProducts.test.ts src/i18n/__tests__/keys-resolve.test.ts
```

Expected Green: every named adapter, resume, cache, replay, provider, display-claim, workspace pagination, representative mutation, and i18n assertion passes.

Run these secondary web checks once:

```sh
pnpm --filter @fxl-sales/web type-check
pnpm --filter @fxl-sales/web lint
pnpm --filter @fxl-sales/web build
git diff --check
```

The separate Gate 2 Verify agent then runs the repository-wide commands once:

```sh
CI=true pnpm test
pnpm lint
pnpm type-check
pnpm build
pnpm audit --audit-level high
git diff --check
```

The Verify agent must inspect the diff and confirm no write method can enter the replay branch, no remaining tracked web caller eagerly passes a token string, and no raw workspace id is rendered.
The Verify agent must also confirm all access-token state remains memory-only and no OAuth, JWKS, discovery, or Hub web-origin value was added to product code.

## End-user UI and E2E verification

Run this after the automated Green checks with the real local Hub, API, database, and web configuration from `CLAUDE.md`.
Use an account with a valid FXL Sales session, one account whose workspace membership count is at least 40, and one workspace without optional display claims if a fixture is available.

1. Open a protected canonical Sales Ops URL such as `/operacional/vendas` and record the pathname, selected role, selected workspace, and a visible unsaved UI state such as an open non-destructive menu.
2. Background the tab until the access token crosses its 30-second cache skew, restore it, and confirm the URL, document, route, open UI state, workspace, and profile stay in place without a Hub page flash.
3. In browser network controls, make the refresh request fail temporarily, repeat the background and focus journey, and confirm there is no reload, login call, redirect, blank shell, lost profile, or raw id.
4. Restore connectivity and focus again, then confirm the same document recovers silently and protected GET data can load.
5. Make one protected GET return 401, confirm one BFF refresh and exactly one GET replay, and confirm a second 401 is surfaced without a third request.
6. Make a representative POST such as a safe local fixture create return 401 before the API accepts it, and confirm there is exactly one POST and no automatic replay.
7. Confirm logout clears the visible profile immediately, makes one SDK logout call, and leaves a user-clicked sign-in action rather than an automatic redirect.
8. With at least 40 memberships, open the workspace control and confirm the Hub `GET /me/workspaces?limit=100` request uses `VITE_FXL_HUB_API_URL`, not the product API, OAuth origin, or Hub web UI origin.
9. Follow load more when present, select a workspace beyond the token preview, and confirm SDK `POST /auth/switch` updates the selector and profile without reload.
10. Expire that BFF session, select another workspace, and confirm the old workspace remains visible until a confirmed permanent result exposes a sign-in button whose navigation is `/auth/login?workspace=<encoded id>` only after click.
11. Inspect the selector at desktop and narrow widths for clipping, keyboard focus, translated states, stable control height, and absence of raw account or workspace ids.
12. Check the browser console and network log for access tokens, session ids, refresh tokens, repeated refresh storms, or unexpected cross-origin auth requests.

Any temporary-failure result that cannot be induced with the local 1.2.0 BFF is verified with the locked adapter fixture and recorded as an environment limitation rather than reclassified as sign-out.
Stop every API, web, Hub, browser-test, database-tail, or watcher process started for this audit by terminating its complete process group before handoff.

## Security and privacy invariants

- Access tokens remain only in provider memory and request headers.
- Refresh tokens remain exclusively behind the HttpOnly BFF session.
- No token, cookie, session identifier, raw auth response, or workspace id is logged.
- JWT payload decoding is display and cache metadata only and never replaces API verification.
- A temporary or ambiguous failure never signs the user out.
- Only exact allowlisted permanent BFF codes can expose login.
- The workspace membership request derives identity only from the verified bearer and never sends an account id.
- The workspace endpoint is read-only and receives one safe forced-refresh replay at most.
- Mutation methods never enter the application replay branch.

## Scope limits

- Do not modify, patch, fork, vendor, or replace `@fxl-business/hub-sdk`.
- Do not upgrade to the proposed SDK 2.0 lifecycle contract in this slice.
- Do not hand-roll OAuth, PKCE, callback, discovery, JWKS, access-token verification, refresh-token rotation, or Hub web-origin discovery.
- Do not add a product API proxy for `/me/workspaces`; call the canonical configured Hub API base directly with its bearer.
- Do not invent permanent session codes or treat 1.2.0 `refresh_failed` as permanent.
- Do not add localStorage, sessionStorage, IndexedDB, cookies, cross-tab synchronization, service workers, intervals, or proactive background timers.
- Do not automatically retry POST, PUT, PATCH, DELETE, application-level idempotency keys, or business mutations.
- Do not change endpoint payloads, optimistic updates, query invalidation, Sales Ops routing, API authorization, database tenancy, entitlement policy, or server session persistence.
- Do not implement Hub Admin, invite delivery, grants, trials, organizations, or reconciliation jobs.
- Do not add a new UI framework, state library, auth dependency, or test runner.
- Do not alter `.vscode/`, `CHANGELOG.md`, generated files, or unrelated doubts and run artifacts.

## Done contract

The locked focused command passes without skipped or weakened tests.
The provider has one disposable resume helper and no resume path can navigate, reload, or invoke login.
Temporary and ambiguous failures preserve signed-in UI, while only exact `no_session` or `session_expired` permits a user-clicked login action.
One API read 401 can cause one forced SDK refresh and one replay, with no outer query retry, while every write is sent at most once.
Optional display claims remain optional and no customer-facing raw workspace id appears.
Accounts at the 40-entry claim boundary can page canonical Hub workspaces, switch through SDK `setActive`, and use the encoded same-origin workspace login route after confirmed expiry.
The full local Gate 2 passes under a separate Verify agent, and the end-user audit passes or records a concrete external fixture blocker.
