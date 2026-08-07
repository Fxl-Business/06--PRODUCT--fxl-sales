# Slice 05 - query-cache flush on logout, login and workspace switch, working notes

## What changed

`apps/web/src/App.tsx`

- `QueryClientProvider` is now OUTSIDE `AppAuthProvider`.
  The swap is the whole of the production change here; `queryClient` itself, its options and `RouterProvider` are untouched.
- A doc comment states why the nesting is load-bearing and names the source test that pins it.

`apps/web/src/auth/react.tsx`

- `const queryClient = useQueryClient()` as the first line of `HubAuthProvider`.
- Three flush sites, exactly as the plan specifies and nowhere else.
  1. `logout()`: `queryClient.clear()` immediately after `failSession()`, synchronous and above `await client.logout()`.
     `markLogoutIntent()` is still the first statement and nothing slice 04 wrote moved.
  2. `observeToken()`'s live-token branch: `const wasSignedIn = typeof lastAppliedToken.current === 'string'; if (!wasSignedIn) queryClient.clear();` as the FIRST statement of that branch, above `clearRevalidateTimer()` and well above `applyToken`.
  3. `setActive()`: `queryClient.clear()` after the `await` and after the `operationGeneration` check, above `tokenCache.seed` and `observeToken`.
- `queryClient` added to three dependency lists: the `useMemo` that builds `observeToken`, `logout`'s `useCallback`, and `setActive`'s.
  `useQueryClient()` returns a stable reference, so the memo does not churn.

`apps/web/src/auth/__tests__/react.test.tsx`

- Harness: `QueryClient` / `QueryClientProvider` imported, a file-scoped `queryClient` rebuilt per test in `beforeEach` with `retry: false`, and BOTH `renderProvider` and `renderProtected` wrapped in `<QueryClientProvider>` OUTSIDE `<AppAuthProvider>`, mirroring `App.tsx`.
- `TokenReader` and `TokenProbe` moved above `renderProvider`, and `renderProvider` gained the optional second `onReady` parameter plus a mounted `TokenProbe`.
  `renderProtected` is unchanged apart from the wrap.
- One new describe, `identity-scoped query cache`, with seven tests.

`apps/web/src/__tests__/route-error-and-auth-context.test.tsx`

- `App.tsx mounts QueryClientProvider outside AppAuthProvider` in the existing `dev-race regression contract` block.

`CLAUDE.md` "Auth Model" and `nexo/ROADMAP.md` per the plan, with two additions noted below.

## Deviation from the plan, and why

**The plan's claimed oracle for the `setActive` ordering does not exist. I added two that do.**

The plan says RED 3 "fails if someone [...] moves the flush before the `await`".
Verified by mutation: it does not.
Hoisting `queryClient.clear()` to the top of `setActive` left all 32 tests green, RED 3 included.
The reason is that RED 3 only ever asserts that the pre-switch fetch cannot write back, and the cancel happens either way - earlier, but still before the deferred `queryFn` settles.
So the plan's sharpest stated ordering rule shipped with no test behind it at all.

Two tests were added to close that, and each was mutation-checked to fail on exactly one mutation and nothing else:

- `keeps the current tenant's cache while a workspace switch is still in flight`.
  Seeds the cache, drives a switch whose `client.setActive` never resolves, and asserts the cache and the Alpha profile are both intact; then resolves it and asserts the flush really did happen, so the test cannot pass against a `setActive` that never flushes.
  This is the ONLY test in the repo that reddens when the flush is hoisted above the `await`.
- `does not flush when a superseded workspace switch resolves late`.
  Beta then Gamma, Gamma resolves first, the cache is seeded with Gamma's rows, then Beta resolves late; asserts Gamma's rows survive.
  The ONLY test that reddens when the flush is moved above the `operationGeneration` check.

The plan's own generation-check rationale ("a superseded switch must discard its flush too") was likewise untested before this.
Both invariants are now recorded in `CLAUDE.md` together with the names of their oracles, since neither is derivable from any other test.

Everything else in the plan was followed as written, including section 3b's `typeof lastAppliedToken.current === 'string'` condition and RED 4's `transient` (not `expired`) mock shape.

## Test evidence

RED confirmed before any production edit, in a single run over both files: **5 failed, 32 passed**.

- RED 1, 2, 3, 4 all failed on `expected { products: [ 'alpha-only' ] } to be undefined` - the seeded entry surviving the auth event, which is the leak stated literally.
- RED 6 failed on `expected 423 to be less than 399`, i.e. `<AppAuthProvider>` still preceding `<QueryClientProvider>` in `App.tsx`.
- RED 5 (`keeps the cache when the revalidation ladder recovers from a blip`) passed RED, as it must: it asserts an ABSENCE of flush, so it is green both before and after and earns its keep only against the wrong implementation.
- All 27 pre-existing `react.test.tsx` tests stayed green through the harness change alone, which is what makes the four failures attributable to the missing feature rather than to the wrap.

Five mutations run against the finished implementation:

| # | Mutation | Red | Verdict |
| --- | --- | --- | --- |
| 1 | `if (!wasSignedIn) queryClient.clear()` to an unconditional `queryClient.clear()` | 1 | exactly `keeps the cache when the revalidation ladder recovers from a blip` |
| 2 | `setActive` flush hoisted above the `await` | 1 | exactly `keeps the current tenant's cache while a workspace switch is still in flight` |
| 3 | `setActive` flush moved above the generation check | 1 | exactly `does not flush when a superseded workspace switch resolves late` |
| 4 | all three `clear()` to `invalidateQueries()` | 5 | every positive-flush test |
| 5 | logout flush deleted | 1 | exactly `drops every cached entry on logout` |

Mutation 4 is the one that proves the choice of `clear()` over `invalidateQueries()` is enforced rather than merely documented: invalidation leaves the entry in the cache, so `getQueryData` still returns the previous identity's rows.

The three tests the plan flagged as most likely to be disturbed by the reordering are all green and unmodified: `does not restore authentication when a workspace switch resolves after logout begins`, `keeps the newest requested workspace authoritative when switches resolve out of order`, `does not re-render auth consumers when a refresh returns the same token`.

Final gates, all run once, never in watch mode:

- `pnpm run type-check` green.
- `pnpm run lint` green.
- `pnpm test` green: api 375 tests / 37 files, web 641 tests / 49 files (was 633), plus the build contract.
- `pnpm run build` green.
- `pnpm --filter @fxl-sales/api test:integration` NOT run: this slice touches no API code at all, and the plan does not require it.

No dev server, watcher or background process was started.

## Recommendation on workspace-scoped query keys

**Recommended as a follow-up, and deliberately not done here.**
Filed verbatim from the plan in the `## Backlog` section of `nexo/ROADMAP.md`, directly under the mutation-testing entry.

The flush closes every reachable sequence today, but it closes the sequences rather than the shape.
Scoping each key by the active workspace id would make cross-tenant data structurally unreachable, and would additionally close the one case a flush cannot: two switches in flight where the second flush lands before the first switch's refetch resolves under an identical key.
`operationGeneration` makes that narrow today, but not impossible.

It does not belong in a session-hardening slice.
`apps/web/src/lib/query-keys.ts` is consumed by every data hook in the sales-ops, `admin/**` and `finder/**` trees; the workspace id has to reach the factory from auth context, so either every call site gains an argument or the factory becomes a curried per-org scope; and `apps/web/src/admin/products/__tests__/useProducts.test.ts` asserts `adminProducts` tuples literally, with the header of `query-keys.ts` recording that those tuples are byte-identical to what they replaced on purpose.
That is a cross-cutting refactor with its own acceptance.

One small guard was taken against it here: the new tests spell `['sales-ops','bootstrap']` literally rather than importing `queryKeys.salesOps.bootstrap()`, so a future workspace-scoped factory cannot make them pass by changing the key shape out from under them.

## For slice 06

- `HubAuthProvider` now opens with `useQueryClient()`, so `AppAuthProvider` REQUIRES a `QueryClientProvider` above it.
  Any new test harness that mounts it must wrap it, and the wrap goes outside.
- `observeToken`'s live-token branch now has four statements before `applyToken`: the `wasSignedIn` read and conditional flush, `clearRevalidateTimer()`, the attempts reset, `clearLoginAttempts()`, `clearLogoutIntent()`.
  The flush must stay FIRST in that branch and must stay out of `applyToken`, for the same early-return reason `clearLogoutIntent()` must.
- If slice 06 makes a login in another tab supersede this tab's session, the `wasSignedIn` condition is what decides whether the resulting token flush happens.
  A supersede that tears the session down first (`failSession()`, so `lastAppliedToken.current === null`) flushes correctly on the way back in.
  A supersede that swaps one live token for another account's WITHOUT an intervening signed-out state would NOT flush, because `lastAppliedToken.current` is still a string.
  Nothing in the app does that today, and `setActive` is the only same-tab identity change, which has its own explicit flush.
  If slice 06 introduces such a path, it needs its own flush at that site; do not weaken this condition to cover it, because that reintroduces the blip-destroys-the-screen bug mutation 1 catches.
