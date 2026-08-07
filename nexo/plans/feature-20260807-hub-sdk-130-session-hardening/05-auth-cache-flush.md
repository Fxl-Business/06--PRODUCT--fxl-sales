---
id: 05-auth-cache-flush
milestone: v2.6.0
status: todo
depends_on: [03-refresh-failure-classification, 04-durable-logout-intent]
files_modified: [apps/web/src/App.tsx, apps/web/src/auth/react.tsx, apps/web/src/auth/__tests__/react.test.tsx, apps/web/src/__tests__/route-error-and-auth-context.test.tsx, CLAUDE.md, nexo/ROADMAP.md]
acceptance: After a logout, after an in-page signed-out to signed-in transition, and after a workspace switch, `queryClient.getQueryCache().getAll()` is empty and a request issued before the event cannot write data back into it.
---

# 05 - Query-cache flush on logout, login and workspace switch

## Context

`queryClient` is a module-level singleton created at `apps/web/src/App.tsx:7`.
It is created once per page load and survives every auth event that does not reload the page.

There is no cache flush anywhere in `apps/web`.
Confirmed by grep: the only `@tanstack/react-query` cache-mutating calls in `src/` outside tests are `cancelQueries` in `apps/web/src/sales-ops/hooks.ts:92` and `apps/web/src/admin/products/useProducts.ts:186`, both inside optimistic `onMutate` handlers, plus `invalidateQueries` in `apps/web/src/lib/app-mutation.ts:61`.
Nothing calls `clear`, `removeQueries` or `resetQueries`.

Every key in `apps/web/src/lib/query-keys.ts` is account-agnostic and org-agnostic.
`queryKeys.salesOps.bootstrap()` is literally `['sales-ops', 'bootstrap']`, and no key in the factory carries an account id or a workspace id.
So one cache entry is shared by every identity the tab ever holds.

Three consequences, in ascending order of sharpness.

1. Logout leaves the previous operator's data in the cache.
   In practice the tab is usually reloaded soon after, and `Protected` unmounts the tree, so the data is not on screen.
   It is still readable from `queryClient.getQueryData(...)` by anything that runs before the reload, and the second operator's first render can be served from it.
2. Login re-populates a provider whose cache was never emptied.
   `nexo/ROADMAP.md` already files the route half of this ("a second operator on the same tab lands on the first operator's screen") and explicitly calls it "a route leak, not a data leak".
   That framing is what this slice corrects: with no flush and identity-agnostic keys it is a data leak too.
3. `setActive` never touches the query client at all.
   `apps/web/src/auth/react.tsx:276` seeds the token cache and calls `observeToken`, and that is the whole switch.
   Every mounted screen therefore keeps rendering the PREVIOUS tenant's rows until each query happens to refetch, and the shared bootstrap entry is the previous tenant's until the network answers.
   This is cross-tenant inside one account, it happens entirely in-page with no reload, and it is nowhere in `nexo/ROADMAP.md`.

RLS remains the isolation control on the server.
This slice is about what the browser holds and renders, which RLS cannot reach.

## Dependency note

This section was written before `03-refresh-failure-classification.md` and `04-durable-logout-intent.md` existed.
Both now exist and have been reconciled against by plan-check.
The resolved facts, which supersede the speculative assumptions this section originally carried:

- Slice 03 reworks the null branch of `observeToken` and the `SESSION_REVALIDATE_DELAYS_MS` ladder inside the single `useMemo` at `react.tsx:199-253`, changes `observeToken`'s parameter to a `HubTokenResult`, and **DELETES `hasSessionRef` entirely**. It leaves no "a session is currently held" flag. Section 3b below is written against that reality; use `lastAppliedToken` as specified there.
- Slice 04 adds a durable logout intent written as the FIRST statement of the `logout` callback at `react.tsx:263-274`, read by `HubProtected`'s login effect, and adds a `SignedOutPanel`.

Neither is modified here.
Before editing, re-read `apps/web/src/auth/react.tsx` as slices 03 and 04 actually left it - the line numbers in this plan are pre-03 and will have moved.
This slice adds exactly three call sites and one hook read.
If slice 04 added statements to `logout`, insert the flush beside them without reordering them, subject only to the "before the first `await`" rule below.

## Decision 1: how the auth provider reaches the query client

**Chosen: swap the nesting in `App.tsx` so `QueryClientProvider` is outermost, and call `useQueryClient()` inside `HubAuthProvider`.**

`App.tsx` becomes:

```tsx
export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppAuthProvider>
        <RouterProvider router={router} />
      </AppAuthProvider>
    </QueryClientProvider>
  );
}
```

Checked before committing to it: `RouterProvider` is the only thing between the two providers today, and every auth consumer in the app lives inside `router`, which stays inside `AppAuthProvider`.
`QueryClientProvider` itself reads no context.
`apps/web/src/main.tsx` renders `<App />` and nothing else.
`AppAuthProvider` is referenced in exactly two files, `App.tsx` and `apps/web/src/auth/__tests__/react.test.tsx`, so the blast radius of the swap is those two files.

Rejected alternatives:

- **Import the singleton into `react.tsx`.** `App.tsx` imports `./auth/react`, so importing the client back out of `App.tsx` is a module cycle. Extracting it to `apps/web/src/lib/query-client.ts` breaks the cycle but keeps the worse half of the problem: the auth provider would then flush a specific module instance rather than the client its own subtree reads, so the two could silently diverge, and a test could not inject a client without also owning a module-level singleton across test files.
- **Pass the client in as a prop.** No cycle and testable, but it creates a second declaration of which client is in play, one on `QueryClientProvider` and one on `AppAuthProvider`, and nothing forces them to agree. `useQueryClient()` reads the one authoritative answer.

The one cost of the chosen option is that `AppAuthProvider` now requires a `QueryClientProvider` above it.
That is already true of the app, and forcing the test harness to mirror the real nesting is a benefit, not a tax.

`apps/web/eslint.config.js` restricts only `useMutation` from `@tanstack/react-query`, so importing `useQueryClient` in `react.tsx` is allowed.

## Decision 2: what "flush" means

**Chosen: `queryClient.clear()`.**

Rejected: `invalidateQueries()`.
Invalidation marks entries stale and refetches the active ones, but the data stays in the cache and keeps being returned while the refetch is in flight.
A component reading `data` during that window renders the previous identity's rows, which is precisely the leak.

Rejected: `removeQueries()` alone.
It empties the query cache but leaves the mutation cache, so a paused or retrying mutation created under identity A can resume and fire under identity B's token.

`clear()` is `queryCache.clear()` plus `mutationCache.clear()` (`@tanstack/query-core@5.101.2`, `queryClient.js:296`), so it covers both.

In-flight semantics, read out of the installed `@tanstack/query-core@5.101.2` rather than assumed:

- `queryCache.clear()` iterates `getAll()` and calls `remove(query)` (`queryCache.js:49`), which calls `query.destroy()` (`queryCache.js:42`).
- `Query.destroy()` calls `this.cancel({ silent: true })` (`query.js:86`), which cancels the retryer.
- `createRetryer`'s `cancel` REJECTS the pending thenable, after which `isResolved()` is true and the later `resolve(value)` is a no-op (`retryer.js:29-47`).
  A `queryFn` promise that settles after the flush therefore cannot dispatch a success and cannot write data back.
- The underlying HTTP request is not aborted, because `salesOpsApi` and the admin API functions take no `AbortSignal`. The response is fetched and discarded.
- The query is also deleted from the cache map, so the next render's `observer.getOptimisticResult(...)` calls `queryCache.build(...)` (`queryObserver.js:121`), gets a fresh `Query` with `data: undefined`, and refetches. That is what makes a still-mounted screen go to its pending state after a workspace switch rather than sitting on stale rows.
- `clear()` is synchronous. It triggers no refetch of its own, which is why it is right on the logout path where a refetch would fire with no token.

A `fetchQuery` promise outstanding at the moment of the flush rejects with a silent `CancelledError`.
Nothing in `apps/web` calls `fetchQuery`, so this only matters to the test in RED 3, which must catch it.

## Decision 3: the three sites

The governing rule at all three sites: **the flush is synchronous and sits in the same synchronous block as the auth state change, before the first `await`.**
React batches the state updates in that block into one commit, so there is no render in which the new identity is live and the old cache is still populated.
An `await` inserted between them would open exactly that window, which is why the rule is stated rather than left implicit.

### 3a. Logout

In the `logout` callback (`react.tsx:263-274` before slices 03 and 04):

```ts
const logout = useCallback(async () => {
  operationGeneration.current += 1;
  tokenCache.clear();
  failSession();
  // The cache is identity-agnostic (`queryKeys.salesOps.bootstrap()` is
  // `['sales-ops','bootstrap']`), so the next operator on this tab would be
  // served the previous one's rows. Synchronous and before the first `await`, so
  // React commits one render with an empty cache and a signed-out profile.
  queryClient.clear();
  clearLoginAttempts();
  consumeReturnTo(currentOrigin());
  await client.logout();
}, [client, failSession, queryClient, tokenCache]);
```

`failSession()` and `queryClient.clear()` are both synchronous, so their relative order does not change what React commits.
`failSession()` is written first because reading it as "sign out, then drop what the signed-in session cached" matches the intent.
Whatever slice 04 adds to this callback stays where slice 04 put it.
Add `queryClient` to the dependency array.

### 3b. Login

Traced, not asserted.

`login()` is `client.login()`, a full-page navigation to the Hub.
The return trip is `/auth/callback` and a fresh page load, which builds a new module graph and therefore a new `QueryClient`.
So there is nothing to flush at the moment `login()` is called, and a flush there would be dead code.

The reachable in-page event is the **signed-out to signed-in transition inside `observeToken`**.
It is reachable by at least these routes:

- The ladder exhausts and `failSession()` runs, the profile goes signed-out, and a later `getToken()` resolves non-null before `HubProtected`'s login effect has navigated away. After slice 06 the token can belong to a different account, because a login in another tab supersedes this tab's session.
- `HubProtected` renders the `SessionRecoveryPanel` while `loginBlocked` is true, so no navigation happens at all, and a `getToken()` that starts succeeding flips the profile back to signed-in in place.

So the hook is in `observeToken`'s non-null branch, guarded on no session currently being held.

**Corrected by plan-check B1. Read this before writing the condition.**

An earlier draft of this section used `hasSessionRef.current`.
Slice 03 DELETES `hasSessionRef` outright - its declaration, its comment, and both writes - because its only reader was the cold-start branch at `react.tsx:245` that slice 03 removes.
So there is no such ref after slice 03, and the earlier hedge in section 2 ("use whatever flag it left") points at nothing.

The condition to use is `lastAppliedToken` (`react.tsx:153`), which slice 03 leaves untouched and which carries the same fact:

```ts
function observeToken(result: HubTokenResult) {   // slice 03's shape - re-read react.tsx as slice 03 left it
  if (!mountedRef.current) return;
  if (result.token !== null) {
    // Signed-out to signed-in, in-page. `lastAppliedToken` is `undefined` before
    // the first apply, `null` while signed out, and a token string while signed
    // in, so a non-string here means the previous identity was already torn down
    // and anything still in the cache belongs to it. A ladder RECOVERY leaves the
    // previous token string in place and therefore must NOT flush: a transient
    // blip destroying the operator's cached screen is the same class of bug the
    // ladder itself exists to prevent.
    //
    // `hasSessionRef` is gone as of slice 03; this ref is its exact behavioural
    // substitute. Do NOT weaken this to "flush on every non-null token" - RED 5
    // exists to catch exactly that.
    const wasSignedIn = typeof lastAppliedToken.current === 'string';
    if (!wasSignedIn) queryClient.clear();
    clearRevalidateTimer();
    revalidateAttempts.current = 0;
    clearLoginAttempts();
    applyToken(result.token);
    return;
  }
  // ... unchanged (slices 03 and 04 own this branch)
}
```

Add `queryClient` to the `useMemo` dependency array at `react.tsx:253`.
`useQueryClient()` returns a stable reference, so the memo does not churn.

Case-by-case equivalence with the deleted `hasSessionRef`, which is why this substitution is exact rather than approximate:

| Case | `lastAppliedToken.current` | Flush? | Matches old behaviour |
| --- | --- | --- | --- |
| Cold start, first token | `undefined` | yes | yes, and a provable no-op (see below) |
| Ladder recovery after a transient failure | the previous token string | no | yes - RED 5 |
| Recovery after `failSession()` tore the session down | `null` | yes | yes - RED 4 |
| `setActive` workspace switch | the previous token string | no | yes - 3c owns it, no double flush |

Placement notes the executor must respect:

- The flush goes in `observeToken`, NOT in `applyToken`. `applyToken` returns early when the token is unchanged (`react.tsx:177`), so a flush behind that guard would be skipped whenever a re-login happened to yield a byte-identical token.
- The flush must read `lastAppliedToken.current` BEFORE `applyToken(...)` runs, since `applyToken` is what overwrites it.
- This fires once on cold start, when `lastAppliedToken.current` is `undefined` and the first token arrives. That is a provable no-op: every data hook in the app lives inside `Protected`, which renders a `Skeleton` until `isSignedIn`, so no query can exist yet. Suppressing that first flush was considered and rejected: its only effect would be to skip a flush of a cache that is empty by construction, and the unconditional form is the one that stays correct if a query ever mounts outside `Protected`.
- `setActive` also calls `observeToken`, but with a token string already in `lastAppliedToken`, so this branch does not fire on a workspace switch. The switch gets its own explicit flush below, and the two can never double-flush.

### 3c. Workspace switch

This is the sharpest case: no reload, components stay mounted, and it crosses tenants inside one account.

```ts
const setActive = useCallback(
  async (workspaceId: string) => {
    operationGeneration.current += 1;
    const switchGeneration = operationGeneration.current;
    const result = await client.setActive(workspaceId);
    if (switchGeneration !== operationGeneration.current) return;
    // Before the new tenant's token becomes reachable. `tokenCache.seed` is what
    // makes it readable by every data hook and `observeToken` is what re-renders
    // them, so both must land on an already-empty cache. All three are
    // synchronous, so React commits one render: new token, no old rows.
    queryClient.clear();
    tokenCache.seed(result.accessToken, result.expiresIn);
    observeToken(result.accessToken);
  },
  [client, observeToken, queryClient, tokenCache],
);
```

Ordering rationale, all of it load-bearing:

- **After the `await`, never before.** Flushing before `client.setActive` resolves would wipe the CURRENT tenant's data on a switch that then fails or is superseded, leaving the operator on an empty screen for a workspace they never left.
- **After the generation check.** A superseded switch discards its result whole, so it must discard its flush too. The existing test `keeps the newest requested workspace authoritative when switches resolve out of order` covers the surrounding behaviour and must stay green.
- **Before `seed` and `observeToken`.** They are the two statements that make the new identity reachable and visible. The three are in one synchronous block so no render can interleave today, but the ordering is what keeps this correct if anyone later inserts an `await`.
- A rejection from `client.setActive` propagates out of the callback, as it does today, and no flush happens. No switch, no flush, correct.

Add `queryClient` to the dependency array.

## Decision 4: workspace-scoped query keys

**Recommended, as a follow-up, not in this slice.**

Scoping every key by the active workspace id would make cross-tenant data structurally unreachable rather than merely cleared.
It would also close the one case a flush cannot: two switches in flight, where the second flush lands before the first switch's refetch resolves under an identical key.
That case is narrow today because `setActive` bumps `operationGeneration`, but it is real.

It does not belong here.
`apps/web/src/lib/query-keys.ts` is consumed by every data hook in both the sales-ops tree and the legacy `admin/**` and `finder/**` trees, and the workspace id has to reach the factory from auth context, so either every call site gains an argument or the factory becomes a curried per-org scope.
`apps/web/src/admin/products/__tests__/useProducts.test.ts` asserts `adminProducts.all` and `adminProducts.list()` tuples literally, and the file header of `query-keys.ts` records that those tuples are deliberately byte-identical to what they replaced.
That is a cross-cutting refactor with its own acceptance, not a rider on a session-hardening slice.

Land this line in the `## Backlog` section of `nexo/ROADMAP.md`, verbatim:

```
- feat: scope the TanStack query keys by the active Hub workspace id, so cross-tenant data is structurally unreachable rather than merely flushed. `feature-20260807-hub-sdk-130-session-hardening` slice 05 added a `queryClient.clear()` on logout, on the in-page signed-out to signed-in transition and on workspace switch, which closes the leak for every reachable sequence today. It does not close the shape of the problem: every key in `apps/web/src/lib/query-keys.ts` is still account- and org-agnostic, so two switches in flight can have the second flush land before the first switch's refetch resolves under an identical key. Blast radius is why it was deferred - the factory is consumed by every data hook in the sales-ops, `admin/**` and `finder/**` trees, and `apps/web/src/admin/products/__tests__/useProducts.test.ts` asserts `adminProducts` tuples literally.
```

## RED tests, written first

All of these go in `apps/web/src/auth/__tests__/react.test.tsx` except the last, which goes in `apps/web/src/__tests__/route-error-and-auth-context.test.tsx`.
`react.test.tsx` already owns the `HubClient` and token-cache mocks, the `switchWorkspace` operator-level helper, and the ladder timer helpers, so extending it is much cheaper and much more faithful than a new file.

### Harness changes required first

These are prerequisites, not tests.
Making them is what turns the suite RED, because `useQueryClient()` throws without a provider.

1. Import `QueryClient`, `QueryClientProvider` and `useQueryClient` is not needed in the test; import `QueryClient` and `QueryClientProvider` from `@tanstack/react-query`.
2. Add a file-scoped `let queryClient: QueryClient`, assigned in `beforeEach` to `new QueryClient({ defaultOptions: { queries: { retry: false } } })`. `retry: false` so a cancelled fetch does not enter a retry ladder of its own.
3. Wrap the trees in BOTH `renderProvider` and `renderProtected` in `<QueryClientProvider client={queryClient}>`, OUTSIDE `<AppAuthProvider>`, mirroring `App.tsx` exactly.
4. Give `renderProvider` an optional second parameter `onReady?: (getToken: TokenReader) => void` and render `<TokenProbe onReady={onReady} />` alongside `Probe` and `UserControls`. `renderProtected` already has this; `renderProvider` needs it because `Protected` renders a `Skeleton` while signed out, which unmounts the probe exactly when RED 4 needs to read a token.
5. Move `TokenProbe` and the `TokenReader` type above `renderProvider` if declaration order requires it.
6. Every test that seeds the cache must seed it AFTER the mount's `await flushReact()`. The cold-start flush described in 3b fires on the first token, so a seed written before the mount resolves would be wiped by it and the test would pass for the wrong reason.

### RED 1 - `drops every cached entry on logout`

Render signed-in as Alpha via `renderProvider`.
After `flushReact()`, `queryClient.setQueryData(['sales-ops', 'bootstrap'], { products: ['alpha-only'] })`.
Assert the seed reads back, so the test cannot pass vacuously.
Click `button[aria-label="Sair"]` inside `act`.
Assert `queryClient.getQueryData(['sales-ops', 'bootstrap'])` is `undefined` and `queryClient.getQueryCache().getAll()` has length `0`.

### RED 2 - `drops every cached entry on a workspace switch`

Render signed-in as Alpha with `mocks.client.setActive` resolving to a Beta token, exactly as the existing `seeds the workspace-switch token before exposing the switched profile` test does.
Seed `['sales-ops', 'bootstrap']` after the mount flush and assert it reads back.
Drive `switchWorkspace(container, 'Beta')`.
Assert the cache is empty AND `profileText(container)` is `'signed-in:Beta'`, so the test proves the flush happened on a switch that actually completed rather than on one that failed.

### RED 3 - `drops a query issued before a workspace switch instead of letting it repopulate the cache after it`

This is the in-flight oracle and the one that fails if someone downgrades `clear()` to `removeQueries()` on a filtered subset, or moves the flush before the `await`.

```ts
const pending = deferred<{ products: string[] }>();
// `clear()` rejects an outstanding fetch with a silent CancelledError; an
// uncaught rejection fails the run.
const fetched = queryClient
  .fetchQuery({ queryKey: ['sales-ops', 'bootstrap'], queryFn: () => pending.promise })
  .catch(() => undefined);

await switchWorkspace(container, 'Beta');
expect(queryClient.getQueryData(['sales-ops', 'bootstrap'])).toBeUndefined();

pending.resolve({ products: ['alpha-only'] });
await fetched;
await flushReact();

// The request was issued as Alpha. It must not be able to write into Beta's cache.
expect(queryClient.getQueryData(['sales-ops', 'bootstrap'])).toBeUndefined();
expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
```

### RED 4 - `drops the previous identity's cache on an in-page signed-out to signed-in transition`

`useLadderTimers()`.

**Mock shape corrected by plan-check N5.** This test was drafted against the pre-slice-03 token cache, which resolved `string | null`.
After slice 03 the cache resolves a `HubTokenResult`, so the bare `null` must become an explicit transient failure:

`mocks.cache.getToken.mockResolvedValueOnce(profileToken('Alpha')).mockResolvedValue({ token: null, failure: 'transient' })`.

It must be `transient` and NOT `expired`.
An `expired` read short-circuits straight to `failSession()` with no ladder at all (slice 03's whole point), so the "advance through every rung" step below would never run and the test would reach the signed-out state by a path it is not trying to exercise.
Confirm the exact `HubTokenResult` field names against `apps/web/src/auth/token.ts` as slice 03 left it before writing this.

Render with `renderProvider(undefined, (getToken) => { held.current = getToken; })`, so the token reader survives the signed-out state.
Read the token once, then advance through every rung of `SESSION_REVALIDATE_DELAYS_MS` until `profileText(container)` is `'signed-out:'`.
Now seed `queryClient.setQueryData(['sales-ops', 'bootstrap'], { products: ['alpha-only'] })` and assert it reads back.
Reset the mock to resolve `profileToken('Beta')` and read the token again.
Assert `profileText(container)` is `'signed-in:Beta'` and the cache is empty.

### RED 5 - `keeps the cache when the revalidation ladder recovers from a blip`

The guard against implementing 3b as "flush on every non-null token".
Without it, the obvious wrong implementation passes RED 1 to RED 4 and destroys the operator's cached screen on every transient blip, which is the same failure mode `SESSION_REVALIDATE_DELAYS_MS` exists to prevent.

Modelled on the existing `keeps the signed-in session when a refresh resolves null once`.
`useLadderTimers()`, mount signed-in as Alpha, seed `['sales-ops', 'bootstrap']` after the mount flush, drive one null read, advance the first rung so the ladder recovers with the same token.
Assert the seeded data is STILL in the cache and `profileText(container)` is still `'signed-in:Alpha'`.

### RED 6 - `App.tsx mounts QueryClientProvider outside AppAuthProvider`

In `apps/web/src/__tests__/route-error-and-auth-context.test.tsx`, in the existing `dev-race regression contract` describe, which already reads source files with the `readSource` helper.

Read `src/App.tsx` and assert `source.indexOf('<QueryClientProvider') < source.indexOf('<AppAuthProvider')`, with both `indexOf` results asserted to be non-negative first.

This pins the structural precondition that makes `useQueryClient()` inside `HubAuthProvider` legal.
Reverting the nesting also breaks the auth tests, but only because the harness happens to wrap them, which reads as a test-setup failure rather than as the contract violation it is.
A source pin says what the invariant is.

## Verification

Run-once only. No watching invocation anywhere.

```bash
pnpm --filter @fxl-sales/web exec vitest run src/auth/__tests__/react.test.tsx
pnpm --filter @fxl-sales/web exec vitest run src/__tests__/route-error-and-auth-context.test.tsx
pnpm --filter @fxl-sales/web test
pnpm run lint
pnpm run type-check
pnpm test
pnpm run build
```

`@fxl-sales/web`'s `test` script is already `vitest run`, so `pnpm --filter @fxl-sales/web test` and the root `pnpm test` are both single-pass.

Expected: RED 1 to RED 6 fail before the source change, all pass after, and every pre-existing test in `react.test.tsx` stays green.
Watch in particular that these three keep passing, because they are the ones the reordering could disturb:

- `does not restore authentication when a workspace switch resolves after logout begins` - proves the stale-generation early return still skips the flush.
- `keeps the newest requested workspace authoritative when switches resolve out of order` - proves the generation check still gates.
- `does not re-render auth consumers when a refresh returns the same token` - proves the flush did not get folded into `applyToken` or otherwise made to run on every token read.

No API-side change, so `pnpm --filter @fxl-sales/api test:integration` is not required by this slice; the feature-level gate still runs it.

## CLAUDE.md

Add to the `## Auth Model` section:

> The TanStack query cache is FLUSHED with `queryClient.clear()` on logout, on an in-page signed-out to signed-in transition inside `observeToken`, and on every completed workspace switch inside `setActive`.
> This is why `QueryClientProvider` is OUTSIDE `AppAuthProvider` in `apps/web/src/App.tsx`: the auth provider reads the client with `useQueryClient()`, so it can only ever flush the exact client its own subtree reads.
> Every key in `apps/web/src/lib/query-keys.ts` is account- and org-agnostic, and `queryClient` is a module-level singleton that survives every auth event short of a page reload, so without the flush a workspace switch renders the previous tenant's rows and a second operator on the tab is served the first one's data.
> `clear()` and not `invalidateQueries()`: invalidation leaves the stale data in the cache to be rendered while the refetch is in flight, which is the leak itself. It also clears the mutation cache, so a paused mutation from the previous identity cannot resume under the new one.
> `Query.destroy()` cancels the retryer, and a cancelled retryer's thenable is already settled, so a request issued before the flush cannot write its result back afterwards.
> The switch flush goes AFTER `await client.setActive(...)` and after the `operationGeneration` check, and BEFORE `tokenCache.seed` and `observeToken`: flushing earlier would wipe the current tenant's data on a switch that fails or is superseded.
> A ladder recovery must NOT flush. The condition is a token arriving while NO session is held, so a transient blip cannot destroy the operator's cached screen.

## Risks and rollback

- **The nesting swap breaks a consumer that needs auth context above the query client.** Checked: `AppAuthProvider` appears only in `App.tsx` and `react.test.tsx`, `RouterProvider` is the sole child, and `QueryClientProvider` reads no context. Low.
- **The cold-start flush wipes something.** It cannot today, because every data hook lives inside `Protected`, which renders a `Skeleton` until the first token. If that ever changes, the flush still runs before the first signed-in render, so the worst case is a redundant refetch.
- **The logout flush leaves a mounted screen momentarily empty.** `failSession()` and `queryClient.clear()` are in the same synchronous block, so React commits one render in which the tree is already replaced by `Protected`'s `Skeleton`. There is no intermediate frame.
- **A future `await` inserted between the flush and the identity change reopens the window.** Mitigated by stating the rule in `CLAUDE.md` and by RED 3, which fails if the flush moves before the `await` in `setActive`.
- **Someone downgrades `clear()` to `invalidateQueries()` to avoid a refetch.** RED 1 and RED 2 both fail on that, because invalidation leaves the entries in the cache.

Rollback is a straight revert of the six files.
There is no migration, no persisted state and no API surface, so a revert restores the prior behaviour exactly.
