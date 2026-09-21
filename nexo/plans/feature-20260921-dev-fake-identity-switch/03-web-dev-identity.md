---
id: 03-web-dev-identity
milestone: v4.1.0
status: todo
depends_on: ["01-auth-fake-package"]
files_modified:
  - apps/web/package.json
  - pnpm-lock.yaml
  - apps/web/vite.config.ts
  - apps/web/src/main.tsx
  - apps/web/src/auth/react.tsx
  - apps/web/src/dev/dev-identity-registry.ts
  - apps/web/src/dev/install-dev-identity.ts
  - apps/web/src/dev/dev-identity-switcher.ts
  - apps/web/src/dev/__tests__/dev-identity-roles.test.tsx
  - apps/web/src/dev/__tests__/dev-identity-isolation.test.ts
  - apps/web/src/dev/__tests__/dev-identity-switcher.test.ts
acceptance:
  - "With no Hub listening on localhost:9016 and VITE_AUTH_FAKE on, the browser boots signed in: the provider never calls client.login(), HubProtected never redirects, and the app reaches a sales-ops screen."
  - "A floating identity switcher is visible in dev-fake mode, outside the React root, listing the whole roster with a human label plus the branch each identity exercises."
  - "Choosing another identity writes its id to localStorage under fxl-sales.dev-identity and reloads the page; the choice survives reloads."
  - "The adopted identity's roles reach getVisibleWorkspaces only through the minted token, parseJwtPayload and getRolesFromHubClaims; nothing writes profile.roles and no fixture supplies a ready-made profile."
  - "An identity with zero recognized roles lands on /no-role, and an identity whose Organization carries no access renders MissingEntitlementPanel off the API's real 402; the switcher stays reachable on both screens."
  - "The whole web half sits behind import.meta.env.DEV plus the VITE_AUTH_FAKE runtime flag, @fxl-sales/auth-fake is a devDependency reached only by dynamic import, and no shipped web source names it."
  - "apps/web/src/auth/__tests__/react.test.tsx is byte-unchanged and green, and pnpm run lint, type-check, test and build all pass."
goal: >
  Put the dev-fake seam into apps/web at the two places this repo actually resolves an identity,
  the token refresher handed to createHubAccessTokenCache and the HubClient built by createHubClient,
  so that with no Hub running the browser boots signed in as a chosen roster identity and a
  developer can swap that identity from a floating switcher, while the production bundle provably
  cannot reach any of it.
must_not_break:
  - "Cold entry redirecting to the Hub for the REAL auth path. HubProtected's login effect, captureReturnTo and registerLoginAttempt are byte-unchanged; breaking cold entry means nobody can ever sign in."
  - "setActive's four-statement critical section in apps/web/src/auth/react.tsx, its ordering and its two dedicated oracles. Nothing in this slice reimplements it, and nothing in this slice calls queryClient.clear()."
  - "apps/web/src/auth/__tests__/react.test.tsx, byte-unchanged and green, including the ladder, renewal, logout-intent, sessionLost and cache-flush oracles."
  - "apps/web/src/sales-ops/__tests__/entitlement-dead-end.test.tsx and src/__tests__/route-error-and-auth-context.test.tsx."
  - "The UI-controls ban: no native select, option or datalist anywhere in apps/web/src, in JSX or via document.createElement."
  - "The URL as the single source of truth for the active Sales workspace and page. The switcher never navigates the router and never writes a route."
rules:
  - "Access to @fxl-sales/auth-fake is by DYNAMIC import only, from exactly one file, apps/web/src/dev/install-dev-identity.ts, and the dependency is a devDependency."
  - "import.meta.env.DEV is checked FIRST at every gate, before the runtime flag, so a production build short-circuits on a literal false."
  - "The switcher is imperative DOM mounted on document.body, outside the React root, and never lives in SalesOpsApp.tsx or anywhere in the component tree."
  - "Switching identity RELOADS; it never live-swaps."
  - "Storage failures are absorbed, never thrown, and always degrade to the roster default."
  - "PLAN-CHECK ADDITION: the three new TEST files must also reach `@fxl-sales/auth-fake` only through `await import(...)`. Slice 05's rule A, the static-import ban, applies to test files too, and a static import in an oracle turns that guard red."
  - "PLAN-CHECK ADDITION: the canonical web seam path is `apps/web/src/dev/install-dev-identity.ts`. Slice 05 hard-codes it, and it is the ONLY file in `apps/web` that may name the package."
verifier_focus:
  - "apps/web/src/dev/__tests__/dev-identity-roles.test.tsx"
  - "apps/web/src/dev/__tests__/dev-identity-isolation.test.ts"
  - "apps/web/src/dev/__tests__/dev-identity-switcher.test.ts"
  - "apps/web/src/auth/__tests__/react.test.tsx (unchanged, must stay green)"
  - "pnpm --filter @fxl-sales/web lint && pnpm --filter @fxl-sales/web type-check && pnpm --filter @fxl-sales/web test && pnpm --filter @fxl-sales/web build"
---

# 03 - web dev identity

## 1. The problem, stated exactly

The reference implementation in `fxl-finance` substitutes ONE thing.
It calls a `__setHubClient` seam that already existed for tests, hands it an object with `getToken` and `setActive`, and everything downstream is untouched because that repo reads its token through `HubClient.getToken()`.

This repo does not work that way, and there is no such seam.

`apps/web/src/auth/react.tsx` builds TWO independent things inside `HubAuthProvider`:

1. `tokenCache = createHubAccessTokenCache(() => requestHubAccessToken(bffBasePath))`.
   The token comes from `apps/web/src/auth/refresh.ts`, which POSTs `<bffBasePath>/auth/refresh` with `credentials: 'include'` itself.
   `HubClient.getToken()` is never called anywhere in this app, and CLAUDE.md records that bypass as a DECISION rather than a workaround.
2. `client = createHubClient(loadHubBrowserConfig(import.meta.env), { bffBasePath, autoRenew: false })`.
   This is what supplies `login()`, `logout()`, `setActive()`, `stop()` and `checkoutUrl()`, and it is handed out raw through `useOrganizations().client`.

Substituting only the client would leave every token read going to a BFF that is talking to a Hub that is not there.
Substituting only the refresher would leave `login()` assigning the document to a dead Hub, `setActive()` doing an HTTP round trip that fails, and `checkoutUrl()` rejecting inside `MissingEntitlementPanel`.

So the honest answer is BOTH, installed together, from one place, as one session object.

## 2. Where the seam goes, and why there

One new module holds a slot, and `react.tsx` reads that slot in exactly two `useMemo` bodies.

### 2.1 `apps/web/src/dev/dev-identity-registry.ts` - the slot

This file is deliberately tiny, imports nothing at runtime, and knows nothing about identities, rosters or UI.
It exists so that `auth/react.tsx` can be given a dev session without `auth/react.tsx` ever naming the fake package, the installer or the switcher.

It exports:

```
export type DevIdentitySession = {
  identityId: string;
  label: string;
  client: HubClient;                              // type-only import from '@fxl-business/hub-sdk/client'
  requestToken: () => Promise<HubTokenResult>;    // type-only import from '../auth/refresh'
};

export function setDevIdentitySession(session: DevIdentitySession | null): void;
export function getDevIdentitySession(): DevIdentitySession | null;
```

`getDevIdentitySession()` returns `null` immediately when `import.meta.env.DEV` is false, BEFORE reading the module variable.
Both imports are `import type`, so they leave no runtime edge and cannot create a cycle with `auth/refresh.ts`.

### 2.2 The two read sites in `apps/web/src/auth/react.tsx`

Read once per provider mount, then used by both memos:

```
const devSession = useMemo(() => getDevIdentitySession(), []);

const client = useMemo(
  () =>
    devSession
      ? devSession.client
      : createHubClient(loadHubBrowserConfig(import.meta.env), { bffBasePath, autoRenew: false }),
  [bffBasePath, devSession],
);

const tokenCache = useMemo(
  () =>
    createHubAccessTokenCache(
      devSession ? devSession.requestToken : () => requestHubAccessToken(bffBasePath),
    ),
  [bffBasePath, devSession],
);
```

A TERNARY and never `devSession?.client ?? createHubClient(...)`.
That is load-bearing rather than stylistic: `??` evaluates its right operand, and `loadHubBrowserConfig` THROWS when `VITE_FXL_HUB_API_URL` or `VITE_FXL_HUB_AUDIENCE` is absent.
Dev-fake must boot on a machine that has never been given Hub configuration at all, so the real construction must not be evaluated when a dev session is installed.

Nothing else in `react.tsx` changes.
The existing `useEffect(() => () => client.stop(), [client])` keeps running and the stand-in's `stop()` is a no-op.
`autoRenew` is irrelevant to the stand-in, which owns no scheduler at all.

### 2.3 Rejected alternatives, recorded so they are not revisited

- **Intercepting `fetch` for `/auth/refresh`.**
  Rejected: it fakes a transport rather than an identity, it would also have to answer `/auth/login`, `/auth/logout` and the SDK's discovery calls, and a global `fetch` patch is exactly the kind of ambient change that makes a real bug unreproducible during review.
- **A `__setHubClient` seam mirroring finance.**
  Rejected on its own: it is necessary but not sufficient here, because the token does not come from the client.
  What this slice does is the finance seam plus the refresher, expressed as one object so the two can never be installed half-way.
- **Substituting inside `refresh.ts`.**
  Rejected: `requestHubAccessToken` is the CLASSIFICATION module, pinned by `refresh.test.ts` on its exact request shape, and putting a dev branch inside it would put a dev branch inside the one function whose whole job is to classify a real BFF answer.
- **A React context or provider prop carrying the dev identity.**
  Rejected: it would put a dev-only prop on the public shape of `AppAuthProvider`, which every test and `App.tsx` construct.

## 3. The installer

### 3.1 `apps/web/src/dev/install-dev-identity.ts`

The ONLY file in `apps/web` that may name `@fxl-sales/auth-fake`, and it names it only inside `await import(...)`.

Exports:

- `isDevIdentityEnabled(): boolean`
- `readDevIdentityId(): string | null`
- `switchDevIdentity(id: string): void`
- `installDevIdentityIfEnabled(): Promise<string | null>`

PLAN-CHECK REVISION, 2026-09-21: the `import.meta.env.DEV` read is HOISTED to a module-level
constant with an exact name, because slice 05's guard scans THIS file for it and the original
in-function read would have made that guard red.

```
const DEV_IDENTITY_ENABLED = import.meta.env.DEV;

export function isDevIdentityEnabled(): boolean {
  if (!DEV_IDENTITY_ENABLED) return false;
  const flag = import.meta.env.VITE_AUTH_FAKE;
  return typeof flag === 'string' && TRUTHY.has(flag.trim().toLowerCase());
}
```

`const DEV_IDENTITY_ENABLED = import.meta.env.DEV;` is the LITERAL line slice 05 asserts, and it
must be the FIRST `import.meta.env.DEV` occurrence in the file, strictly above the dynamic import of
the roster package.
`installDevIdentityIfEnabled()` opens with `if (!DEV_IDENTITY_ENABLED) return null;`, which is the
second literal shape slice 05 asserts, and only then calls `isDevIdentityEnabled()` for the runtime
flag.
That is one redundant-looking check and it is deliberate: the guard's ordering assertion is what
refuses a file that reaches the package at module top level and consults the flag afterwards, which
is the shape that defeats dead-code elimination while satisfying a naive presence check.

`TRUTHY` is the four-member set `1`, `true`, `yes`, `on`, matching the API half's flag parser from slice 02 exactly.
`DEV_IDENTITY_ENABLED` is read FIRST so a production build folds the whole function to `false` before the env var is consulted.

`installDevIdentityIfEnabled()`:

1. Returns `null` at once on `if (!DEV_IDENTITY_ENABLED) return null;`, then again when `isDevIdentityEnabled()` is false.
2. `const fake = await import('@fxl-sales/auth-fake')`.
3. Resolves the adopted identity as `fake.findIdentity(readDevIdentityId()) ?? fake.findIdentity(fake.DEFAULT_IDENTITY_ID)`, and returns `null` when even the default does not resolve.
4. Builds the stand-in client (section 3.2) and the refresher (section 3.3).
5. Calls `setDevIdentitySession({ identityId, label, client, requestToken })`.
6. `console.warn` naming the adopted identity id and label and saying in one line that the Hub is not being contacted and that the switcher changes it.
   This is the one line that stops a developer mistaking dev-fake for real auth in a screenshot.
7. `const { mountDevIdentitySwitcher } = await import('./dev-identity-switcher')`, then mounts it with the roster, the adopted id and `switchDevIdentity`.
8. Returns the adopted id.

### 3.2 The stand-in client

Declared as a full, explicitly typed `HubClient` with `satisfies HubClient`, NOT an `as never` cast.
The interface is ten methods and every one of them is a line or two, so a real implementation costs nothing and buys drift detection the day the SDK adds a method.

| method | dev-fake behaviour |
| --- | --- |
| `login()` | `window.location.reload()`. There is no Hub to redirect to. A reload re-enters the ordinary cold-boot path, mints a token again, and `observeToken`'s live-token branch clears the durable logout intent, which CLAUDE.md already names as the anti-lockout backstop. |
| `logout()` | Sets the stand-in's own `signedOut` flag and resolves. After it, `requestToken()` answers `session_expired` until a reload, so `Sair` really ends the session in dev-fake instead of silently re-minting. |
| `getToken()` | The current minted token, or `null` when `signedOut`. |
| `getTokenResult()` | A projection of the same, never a second mint. |
| `setActive(organizationId)` | Mints a token for the SAME identity with the active Organization set to `organizationId`, and resolves `{ accessToken, expiresIn: DEV_TOKEN_TTL_SECONDS, organizationId }`. It performs no navigation, no flush and no reload. |
| `start()` / `stop()` | No-ops. The stand-in owns no scheduler. |
| `checkoutUrl(organizationId)` | Resolves `https://dev-fake.invalid/checkout/<organizationId>`. `.invalid` is reserved by RFC 2606, so the anchor renders the panel's `ready` branch, which is the branch worth reviewing, and a click can only ever land on a DNS failure rather than on a real checkout. |
| `manageUrl(organizationId)` | The same shape, `https://dev-fake.invalid/billing/<organizationId>`. |
| `loginWithPopup()` | Resolves `{ status: 'unavailable' }`. Nothing in this app calls it, and `unavailable` is the outcome that means "no answer about the session" rather than a fabricated success. |

`setActive` rides the SAME `setActive` in `react.tsx`, through the SAME `useOrganizations` seam.
The stand-in supplies only the mint; the four-statement critical section, the generation check and the single `queryClient.clear()` are untouched and stay the only copy in the app.
The active Organization chosen this way is in-memory on the stand-in and is deliberately NOT persisted: a reload returns to the identity's own default Organization, because the localStorage slot names an IDENTITY and turning it into an identity-plus-Organization tuple is a second piece of state for a convenience nobody asked for.

### 3.3 The refresher

`requestToken()` mints a FRESH token on every call and returns `{ token }`, or `{ token: null, failure: 'session_expired' }` when the stand-in is `signedOut`.

Fresh on every call, not memoized, because the token carries a real `exp` and `createHubAccessTokenCache` derives its expiry from `parseJwtPayload`.
A memoized token would make the proactive renewal at `exp - SESSION_RENEWAL_LEAD_MS` hand back the very token that is about to expire, which is the exact no-op `HubAccessTokenCache.renew()` exists to avoid.

The refresher NEVER answers `transient`.
That is a deliberate limitation and section 6 records what it costs.

## 4. The contract this slice consumes from slice 01

From `@fxl-sales/auth-fake`, by dynamic import:

- `IDENTITIES: readonly DevIdentityOption[]`, where `DevIdentityOption` carries at least `id: string`, `label: string` and `exercises: string`.
- `DEFAULT_IDENTITY_ID: string`.
- `findIdentity(id: string | null | undefined): DevIdentityOption | undefined`.
- `mintDevToken(identity: DevIdentityOption, options?: { nowSeconds?: number; organizationId?: string }): string`, returning a structurally valid three-segment JWT whose payload carries Hub-shaped claims: `exp`, `iat`, `sub`, `aud`, `name`, `email`, `contractVersion`, `entitlements`, `roles: { workspace?, productRoles? }`, `workspaceId`, `workspaceName` and `workspaces: [{ workspaceId, name, products }]`.
- `DEV_TOKEN_TTL_SECONDS: number`.

If slice 01 lands different names, the executor adapts the three call sites inside `install-dev-identity.ts` and NOTHING else, because the registry, `react.tsx` and the switcher are all written against this repo's own types rather than against the package's.

One constraint on slice 01 that this slice depends on and must be stated: the package must carry ZERO runtime dependencies on the browser mint path.
`apps/web/vite.config.ts` already records, at length, that a dependency discovered mid-load is re-served under a `?t=` URL and once split the auth context in two.
A workspace package is treated as source and is not pre-bundled, but a transitive npm dependency of it would be discovered late, after `App.tsx` has already loaded.
If a late discovery is nonetheless observed in dev, the accepted remedy is adding the package to `optimizeDeps.include` in `vite.config.ts` behind the existing `mode` branch, and the executor must record that in the slice notes because it puts the package name into a shipped config file, which slice 07's isolation guard then has to allow by name.

## 5. Bootstrap order

`apps/web/src/main.tsx` becomes:

```
async function bootstrap() {
  if (import.meta.env.DEV) {
    const { installDevIdentityIfEnabled } = await import('./dev/install-dev-identity');
    await installDevIdentityIfEnabled();
  }
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
```

The install must complete BEFORE `render`, because `HubAuthProvider` reads the registry in a `useMemo` during its first render and a session installed after that would never be seen.

The `if (import.meta.env.DEV)` wrapper is what makes this structural rather than merely conditional.
Vite replaces `import.meta.env.DEV` with the literal `false` in a production build, Rollup drops the whole branch, and with it the only `import('./dev/install-dev-identity')` in the tree, so no chunk for the dev tree is ever emitted.

ACCEPTED COST, recorded rather than discovered later: `bootstrap` is async, so in EVERY build the first render is one microtask later than today.
The root element lookup, the `StrictMode` wrapper and the `render` call are byte-identical, and the alternative, a top-level `await` in the entry module, would make the whole entry chunk async in production, which is a worse trade for the same saving.

## 6. What stays exercised, and what dev-fake disarms

This is stated honestly because a dev mode that silently disarms the session machinery is worse than no dev mode.

STILL EXERCISED, end to end, through the real code:

- `parseJwtPayload`, `getRolesFromHubClaims`, `getRoleFromHubClaims`, `readWorkspaces` and `profileFromToken`.
- `getVisibleWorkspaces`, `resolveSalesOpsRoute`, `getDefaultSalesOpsRoute`, `NoRoleGuard` and the `/no-role` dead end.
- `HubAccessTokenCache`: the `exp` based expiry, the 30 second skew, `seed`, `clear`, the generation guard and the in-flight coalescing.
- The visibility-gated proactive renewal, because the minted token carries a real, finite `exp` and `renew()` really does mint a new one.
- `logout()`'s whole synchronous block: the durable logout intent, `failSession()`, the `setSessionLost(false)` correction, `queryClient.clear()` and `consumeReturnTo`, then `SignedOutPanel` and the `Entrar` re-login.
- `setActive`'s critical section and its cache flush, driven from `MissingEntitlementPanel` and from the sales-ops account dropdown.
- `useOrganizations`' id-first matching, `others`, and the `MissingEntitlementPanel` 402 screen, which is produced by the API's REAL gate in slice 02 and not faked in the browser.

DISARMED, and named so nobody assumes otherwise:

- The bounded revalidation ladder, `SESSION_REVALIDATE_DELAYS_MS`.
  `requestToken` never answers `transient`, so no rung is ever scheduled and `SessionRecoveryPanel` plus `isLoginBlocked` are unreachable in dev-fake.
- The LIVE LOSS overlay.
  The only signed-out transition dev-fake can produce is an explicit `Sair`, which sets the logout intent, and `liveSessionLoss` excludes exactly that case.
  So `Sua sessão expirou` over a still-mounted subtree is not reachable in dev-fake.
- `captureReturnTo` on cold entry, because cold entry never redirects in dev-fake.
- `requestHubAccessToken` itself, whole: the `/auth/refresh` request shape, the 401 versus transient classification, and every status the BFF can answer.
- The real `createHubClient`, the Hub BFF round trip, PKCE, the durable Postgres session store, cookie rotation and the CSRF origin guard.

All of those keep their own unit oracles, untouched by this slice, and dev-fake is a mode for REVIEWING SCREENS rather than a substitute for them.

## 7. The switcher

`apps/web/src/dev/dev-identity-switcher.ts` exports one function:

```
export function mountDevIdentitySwitcher(
  identities: readonly DevIdentityOption[],
  activeId: string,
  onSelect: (id: string) => void,
): void
```

### 7.1 Imperative DOM outside the React root, and the decisive reason

The roster exists to reach screens that only some identities can see, and TWO of those screens replace the subtree entirely.
An identity with zero recognized roles lands on `/no-role`.
An identity whose Organization carries no access renders `MissingEntitlementPanel`.
A switcher living inside the app tree would be unmounted by exactly the two screens it exists to get the developer out of, and a switcher inside `Protected` would additionally vanish behind the Skeleton.

Mounted on `document.body`, outside the React root, it is reachable from every screen the roster can produce, including `/no-role`, the entitlement panel, the forbidden panel and the signed-out panel.

Three further consequences, all wanted:

- It never enters the React tree, so it cannot perturb state or re-render behaviour while a developer is debugging exactly that.
- It is not product copy, so it stays out of `src/i18n/**`.
- CLAUDE.md forbids the sales-ops screens from living in `SalesOpsApp.tsx`; being outside the React root satisfies that absolutely rather than by convention.

### 7.2 Controls

Built from `div`, `button` and one `input[type="text"]` search box, adapted from the finance implementation.

The UI-controls ban applies in full: no `select`, no `option`, no `datalist`, in JSX or through `document.createElement`.
`no-restricted-syntax` in `apps/web/eslint.config.js` matches JSX opening elements ONLY, so it would not catch `document.createElement('select')`.
That gap is closed by a source-scan assertion in the isolation oracle rather than left to review.

`Combobox` from `@/components/ui/combobox` is deliberately NOT used: it is a React component and this widget is outside the React root by design.
Search over the label plus the `exercises` line is implemented directly, case- and accent-folded, term by term, so `402`, `no-role` or `admin` all find the right identity.

### 7.3 Behaviour carried over from the reference, including its bug fixes

- Collapsed by default to a small pill that still names the adopted identity, because in a multi-identity session that is the one fact always needed on screen.
  The collapse preference is its own key, `fxl-sales.dev-identity.collapsed`.
- `mountDevIdentitySwitcher` is IDEMPOTENT, keyed on a host element id, so a hot reload does not stack copies.
- Highlight repainting MUTATES the existing row nodes and never rebuilds the list on `mouseenter`.
  This is a fix carried over deliberately: a browser only fires `click` when mousedown and mouseup land on the same element, and a list that rebuilds on hover destroys the row under the cursor, so selecting an identity silently does nothing.
  Rebuild only when the FILTER changes.
- A row's primary label is `identity.label` and its secondary line is `identity.exercises`.
  The raw identity `id` appears only in the console warning and as the stored value, never as a row's primary label.

## 8. Storage, and why a reload

### 8.1 The key

`fxl-sales.dev-identity`, in `localStorage`.

The `fxl-sales.` prefix matches this repo's existing convention, `fxl-sales.auth.returnTo`, `fxl-sales.auth.loginAttempts`, `fxl-sales.auth.logoutIntent`, and is deliberately NOT the reference repo's `fxl.dev-identity`, because two apps on `localhost` share an origin per port but a developer running both should not have one repo's roster id read by the other's.

`localStorage` and not `sessionStorage`, which is the opposite choice from the logout intent, and for the opposite reason.
The logout intent must die with the tab because a stale one is a lockout.
The adopted identity must survive the tab, because the whole point is to open the app tomorrow still being the seller.

### 8.2 Switching reloads, and never live-swaps

`switchDevIdentity(id)` writes the key and calls `window.location.reload()`.

A live swap is refused for a reason this repo already states in prose.
Changing identity changes the role set, the entitlement, the Organization list, the active Organization and every cached query AT ONCE.
Applying that in place would mean flushing the query cache, re-seeding the token cache, re-deriving `sessionLost` and crossing a tenant boundary, which is a SECOND copy of `setActive`'s four-statement critical section, and CLAUDE.md is explicit that there must be exactly one copy of that ordering in the app.
A reload re-enters through the ordinary cold-boot path, which is a path the product really has and really tests.
It also removes the whole class of half-reconciled states that a reviewer would otherwise report as a product bug.

### 8.3 When storage is unavailable

Every read and every write is wrapped and absorbed.

- A read that throws or returns `null`, which covers private mode, disabled site data and a cleared origin, yields the roster default, and the mode still works.
- A write that throws is IGNORED and the reload still happens, so the tab lands on the roster default rather than on a half-applied choice.
- The collapse preference behaves the same way and defaults to collapsed.

Nothing here ever throws into the boot path.
A developer preference is not worth failing a session over, which is the same rule `hasLogoutIntent` follows when it fails open.

## 9. Flag and environment

The web flag is `VITE_AUTH_FAKE`, the mirror of slice 02's API-side flag, with the same four truthy spellings matched after `trim().toLowerCase()`.

PLAN-CHECK RULING, 2026-09-21: this slice touches NO `.env` example at all.
The original draft added a commented line to `apps/web/.env.dev.example`, which slice 06 also claims
and documents in full, with an oracle that reads its exact text.
Two slices in different waves writing one file is how the later one silently reverts the earlier.
Slice 06 owns all four committed examples, and `apps/web/.env.dev.example` is removed from this
slice's `files_modified`.

`apps/web/package.json` gains `"@fxl-sales/auth-fake": "workspace:*"` under `devDependencies` and NEVER under `dependencies`.

## 10. Oracles

### 10.1 `apps/web/src/dev/__tests__/dev-identity-roles.test.tsx`

`// @vitest-environment happy-dom`.
Drives the REAL `AppAuthProvider` and `Protected` from `@/auth/react`, the REAL `@fxl-sales/auth-fake` roster, the REAL `getRolesFromHubClaims` and the REAL `getVisibleWorkspaces`.
It mocks NOTHING in the auth path.
It installs the session by calling `installDevIdentityIfEnabled()` with `vi.stubEnv('VITE_AUTH_FAKE', '1')`, and resets with `setDevIdentitySession(null)` in `afterEach`.
A probe component reads `useAuthProfile().roles` and renders `getVisibleWorkspaces(roles).join(',')`.

1. `drives getVisibleWorkspaces from the adopted identity through the real claim translation`
   PLAN-CHECK REVISION, 2026-09-21. The original draft parametrized over an `admin-only` identity and asserted `three team workspaces and no meus-dados`.
   NO SUCH IDENTITY EXISTS and no such assertion can pass: `getRolesFromHubClaims` returns the literal `['admin','seller','finder']` from every admin-bearing branch, so `getVisibleWorkspaces` always adds `meus-dados`, and writing `profile.roles` to fake it is what acceptance 4 forbids.
   Slice 01's F3 records the finding and its roster reflects it; this test now matches that roster.
   Parametrize over the FIVE reachable role sets, by slice 01's roster ids, asserting the exact visible-workspace list for each: `team-owner` and `team-admin` and `product-admin` all four painéis, `seller` `['meus-dados']`, `finder` `['meus-dados']`, `seller-finder` `['meus-dados']`, and `no-role` the empty list.
   Add one named assertion, `no roster identity reaches the team painéis without meus-dados`, asserting that no identity in `IDENTITIES` yields exactly `['tatico','operacional','cadastros']`, with the F3 reason in a comment, so the unreachability is RECORDED through the real translation rather than merely declared on the roster object.
   DECISIVE MUTATION: replacing the provider's dev branch with the real refresher makes every case time out signed-out; replacing `getRolesFromHubClaims` with a constant makes four of the five cases fail.
2. `takes its roles only from the minted token, never from a fixture profile`
   Asserts the probe's roles for the seller-only identity change to the empty list when the test mints a token whose `roles` claim is stripped, proving the claim path is live rather than a lookup on the identity object.
3. `signs the operator in without ever calling login, so cold entry never redirects to a Hub that is not there`
   Spies on `window.location.assign` and on the stand-in's `login`, renders `Protected`, waits for the signed-in child, and asserts neither was called.
4. `adopts the identity stored under fxl-sales.dev-identity over the roster default`
5. `falls back to the roster default when localStorage throws on read`

### 10.2 `apps/web/src/dev/__tests__/dev-identity-isolation.test.ts`

The production-unreachability oracle.
It reads source files from disk rather than shelling out to `git grep`, for the same reason `scripts/__tests__/local-database-guard.test.mjs` does: a repo-wide grep passes with the call sitting in some third irrelevant file and does not notice a rename.

1. `getDevIdentitySession answers null when import.meta.env.DEV is false, even after a session was installed`
   `vi.stubEnv('DEV', false)`, install a session, assert `null`.
   This is the RUNTIME half of the guarantee.
2. `no web source outside src/dev names @fxl-sales/auth-fake`
   Walks every `.ts` and `.tsx` under `apps/web/src`, excluding `src/dev/**`, and asserts the package name appears in none of them.
3. `install-dev-identity.ts names the roster package only inside a dynamic import`
   Asserts the file contains no `from '@fxl-sales/auth-fake'` and at least one `await import('@fxl-sales/auth-fake')`.
4. `main.tsx reaches the dev tree only through a dynamic import inside an import.meta.env.DEV branch`
   Asserts `main.tsx` contains no static `./dev/` import, contains `if (import.meta.env.DEV)`, and that the only `./dev/install-dev-identity` occurrence is inside an `import(` call.
5. `auth/react.tsx names only the registry, never the installer, the switcher or the roster package`
6. `the switcher builds no native select, option or datalist`
   Scans `dev-identity-switcher.ts` for `createElement('select'|'option'|'datalist')` in any quoting, closing the gap that the JSX-only ESLint selector leaves open.

DECISIVE MUTATION for this file: making `getDevIdentitySession` ignore `import.meta.env.DEV`, or converting `main.tsx`'s dynamic import to a static one, must turn it red.

### 10.3 `apps/web/src/dev/__tests__/dev-identity-switcher.test.ts`

`// @vitest-environment happy-dom`.

1. `lists the whole roster with its human label and the branch it exercises`
2. `calls onSelect with the chosen identity id`
   Selects by clicking a row, which is what makes the carried-over hover fix non-vacuous.
3. `mounts once, so a hot reload does not stack copies`
4. `filters on the exercises line as well as the label`
5. `switchDevIdentity stores the id under fxl-sales.dev-identity and reloads`
   `vi.stubGlobal('location', { reload: vi.fn(), origin: 'http://localhost:8006' })` before importing the installer.
6. `switchDevIdentity still reloads when localStorage refuses the write`

### 10.4 Unchanged oracles that must stay green

`apps/web/src/auth/__tests__/react.test.tsx` is byte-unchanged.
It mocks `createHubClient` and the token cache, and the registry answers `null` in it, so the ternary picks exactly the construction it already asserts.
If it goes red, the seam has been placed wrong.

`apps/web/src/sales-ops/__tests__/entitlement-dead-end.test.tsx` and `apps/web/src/__tests__/route-error-and-auth-context.test.tsx` likewise.

## 11. Executor checklist

1. Add `@fxl-sales/auth-fake` to `apps/web/package.json` devDependencies as `workspace:*`, then `pnpm install`.
2. Write `apps/web/src/dev/dev-identity-registry.ts` exactly as section 2.1 describes, with both imports type-only.
3. Edit the two `useMemo` bodies in `apps/web/src/auth/react.tsx` per section 2.2, plus the one `devSession` memo above them, and change NOTHING else in that file.
4. Write `apps/web/src/dev/install-dev-identity.ts` per section 3, with the stand-in typed `satisfies HubClient` and no `as` cast.
5. Write `apps/web/src/dev/dev-identity-switcher.ts` per section 7, carrying over the hover fix and the idempotent mount.
6. Rewrite `apps/web/src/main.tsx` per section 5, keeping the root lookup, the `StrictMode` wrapper and the `render` call byte-identical.
7. Touch NO `.env` example. Slice 06 owns all four, including `apps/web/.env.dev.example`.
8. Write the three oracle files.
9. Run the verifier focus commands.
