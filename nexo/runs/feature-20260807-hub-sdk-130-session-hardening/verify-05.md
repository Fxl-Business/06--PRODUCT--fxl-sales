# VERDICT: PASS

Slice `05-auth-cache-flush`, branch `feat/05-auth-cache-flush`, commit `1e3a20d`, baseline `master` at `046c94f`.

Acceptance criterion under test:

> After a logout, after an in-page signed-out to signed-in transition, and after a workspace switch, `queryClient.getQueryCache().getAll()` is empty and a request issued before the event cannot write data back into it.

Proven. Every clause has at least one named oracle that was shown by mutation to redden on exactly the defect it names, and the four gate commands are green.

## Command results

| Command | Result | Notes |
| --- | --- | --- |
| `pnpm run type-check` | PASS | 4 projects, all `Done`. |
| `pnpm run lint` | PASS | `apps/api` and `apps/web` eslint clean. |
| `pnpm test` | PASS | `shared-utils` 80/80, `apps/api` 375/375, `apps/web` 641/641 (49 files). `build-contract: ok`. |
| `pnpm run build` | PASS | Vite `✓ built in 1.60s`. |

Re-run at the end of the session on the restored tree: identical counts, still green.

Integration tests were not run; the slice touches no API surface and the feature-level gate owns that.

## Mutation results

Every mutation was applied to the working tree, the full `apps/web` suite was run once (`vitest run`, never a watcher), and the file was restored with `git checkout` and the restoration confirmed by `shasum` against the committed blob.

| # | Mutation | Expected | Observed | Reverted |
| --- | --- | --- | --- | --- |
| M1 | Delete `queryClient.clear()` from `logout` (`react.tsx:373`) | logout oracle red | RED, exactly 1: `identity-scoped query cache > drops every cached entry on logout` (640/641) | yes, sha `4ef5952…` |
| M2 | Delete the `wasSignedIn` guard and flush from `observeToken` (`react.tsx:282-283`) | login-transition oracle red | RED, exactly 1: `drops the previous identity's cache on an in-page signed-out to signed-in transition` (640/641) | yes, sha `4ef5952…` |
| M3 | Delete `queryClient.clear()` from `setActive` (`react.tsx:405`) | switch oracle red | RED, 3: `drops every cached entry on a workspace switch`, `keeps the current tenant's cache while a workspace switch is still in flight`, `drops a query issued before a workspace switch instead of letting it repopulate the cache after it` (638/641) | yes, sha `4ef5952…` |
| M4 | **The named wrong implementation**: replace `if (!wasSignedIn) queryClient.clear()` with an unconditional `queryClient.clear()` on every non-null token | ladder-recovery oracle red | RED, exactly 1: `keeps the cache when the revalidation ladder recovers from a blip` (640/641) | yes, sha `4ef5952…` |
| M5 | Downgrade all three `queryClient.clear()` to `void queryClient.invalidateQueries()` | check 3 | RED, 5: all three site oracles plus the in-flight oracle plus the in-flight-ordering oracle (636/641) | yes |
| M6 | Hoist the `setActive` flush ABOVE `await client.setActive(...)` | switch-ordering oracle red | RED, exactly 1: `keeps the current tenant's cache while a workspace switch is still in flight` (640/641) | yes |
| M7 | Move the `setActive` flush after the `await` but BEFORE the `operationGeneration` check | generation-ordering oracle red | RED, exactly 1: `does not flush when a superseded workspace switch resolves late` (640/641) | yes |
| M8 | Swap `App.tsx` back to `AppAuthProvider` outermost | nesting pin red | RED, exactly 1: `dev-race regression contract > App.tsx mounts QueryClientProvider outside AppAuthProvider` (640/641) | yes, sha `d3b8074…` |

No mutation left the suite green.
Each of the three call sites has its own distinct oracle, and each ordering constraint has its own distinct oracle.

Working tree after the battery is byte-identical to the committed state: `apps/web/src/auth/react.tsx` `4ef5952d35fb15b62d85c904630efcd4cc42ec5a`, `apps/web/src/App.tsx` `d3b807491bfd2bf0020173b1f3b11e12695f07c7`.
The only dirty paths are `nexo/runs/.../budget.json`, `.vscode/` and `agents/exec-05.result.json`, all of which pre-dated this verification and none of which I touched.

## Findings against checks 1-8

### 1. Non-vacuity by mutation - PASS

Covered by M1, M2 and M3 above.
Three call sites, three disjoint named oracles, each proven by removal.
Every one of these tests also asserts its seed reads back before the event (`seedAlphaCache` at `react.test.tsx:1066-1070` does the `expect(...).toEqual(ALPHA_ROWS)` itself), so an empty cache afterwards cannot be a vacuous pass over a seed that never landed.

The harness detail that makes this sound is at `react.test.tsx:1085-1087`: the seed is written AFTER the mount's `await flushReact()`, because the cold-start flush fires on the first token and would otherwise wipe a pre-mount seed and produce a pass for the wrong reason. That is a real hazard and it was handled.

`BOOTSTRAP_KEY` is spelled literally at `react.test.tsx:1057` rather than imported from `query-keys.ts`, with a comment saying why: the leak is about the SHAPE of the key, and a future workspace-scoped factory must not be able to make these tests pass by changing it. That is the right call and it is worth keeping.

### 2. The "flush on every non-null token" defect - PASS

The guard is present and is exactly what the plan specifies.
`apps/web/src/auth/react.tsx:282-283`:

```ts
const wasSignedIn = typeof lastAppliedToken.current === 'string';
if (!wasSignedIn) queryClient.clear();
```

It is read BEFORE `applyToken(...)` (which overwrites `lastAppliedToken` at `react.tsx:202`) and it lives in `observeToken`, not in `applyToken` whose unchanged-token early return at `react.tsx:201` would skip it on a byte-identical re-login.
Both placement rules from the plan are respected.

M4 is the decisive result: making the flush unconditional on a non-null token reddens `keeps the cache when the revalidation ladder recovers from a blip` and nothing else.
The guard is therefore proven, not assumed, and the specific failure mode the ladder exists to prevent - a transient Hub blip destroying the operator's cached screen - is closed with an oracle.

Worth stating explicitly: M4 passed every other test in the suite, including all five other cache tests.
That is precisely the plan's claim about this being the obvious wrong implementation, and it is confirmed empirically.

### 3. `clear()` and not `invalidateQueries()` - PASS

All three sites call `queryClient.clear()`: `react.tsx:283` (login transition), `react.tsx:373` (logout), `react.tsx:405` (switch).
No `invalidateQueries`, `removeQueries` or `resetQueries` anywhere on these paths.

M5 proves this is load-bearing rather than incidental: swapping all three to `invalidateQueries()` reddens five tests, including the logout, switch and login-transition oracles.
Invalidation leaves the entry in the cache, so `getQueryData` still returns the previous identity's rows, which is the leak itself.

Verified against the installed `@tanstack/query-core@5.101.2` that `clear()` really is both caches (`build/modern/queryClient.js:296-299`):

```js
clear() {
  this.#queryCache.clear();
  this.#mutationCache.clear();
}
```

So the plan's mutation-cache argument holds: a paused or retrying mutation created under identity A cannot resume under identity B's token.

### 4. In-flight requests - PASS, and the mechanism is real

The oracle is `drops a query issued before a workspace switch instead of letting it repopulate the cache after it` (`react.test.tsx:1208-1236`).
It issues a `fetchQuery` against `['sales-ops','bootstrap']` backed by a `deferred`, drives the switch, asserts the cache is empty, THEN resolves the deferred and asserts the cache is still empty.
It is not vacuous: M3 and M5 both redden it.

I verified the mechanism against the installed package source rather than taking the plan's word for it:

- `queryCache.clear()` iterates `getAll()` and calls `remove(query)` (`queryCache.js:49-55`).
- `remove(query)` calls `query.destroy()` and deletes the hash from the map (`queryCache.js:39-48`).
- `Query.destroy()` calls `this.cancel({ silent: true })` (`query.js:86-89`).
- `createRetryer`'s `cancel` rejects the pending thenable when it is still pending (`retryer.js:29-35`), after which `isResolved()` is true.
- The queryFn settlement path is `Promise.resolve(promiseOrValue).then(resolve)` (`retryer.js:81`), and `resolve` is guarded by `if (!isResolved())` (`retryer.js:44-49`).
  A settlement after the flush is therefore a no-op: no success dispatch, no cache write.

That is a real, source-verified mechanism, not an assumption.

One scope note, green but worth recording. The test exercises `fetchQuery`, whereas the app's real readers are `useQuery` observers. The cancellation path is the same retryer for both, and the query is additionally deleted from the cache map so the next render rebuilds a fresh `Query` with `data: undefined`, so the property generalizes. I checked and there is no residual write-back path.

Second note, also green. The underlying HTTP request is NOT aborted: `apps/web/src/lib/api-client.ts` takes no `AbortSignal` (grep for `signal` returns nothing). The response is fetched and discarded. That matches what the plan says and is not a correctness problem for this acceptance, only a wasted round trip.

Third note on completeness. The acceptance clause "a request issued before the event cannot write data back into it" is worded for all three events, and there is exactly one in-flight test, for the switch. I judge the clause proven for all three by composition rather than under-tested: the in-flight property is a property of the `clear()` primitive itself, and M5 independently proves that all three sites invoke that exact primitive rather than a weaker one. A per-site in-flight test would re-prove the same primitive three times.

### 5. Workspace-switch ordering - PASS

`apps/web/src/auth/react.tsx:385-410`, statement order:

```
387  operationGeneration.current += 1;
388  const switchGeneration = operationGeneration.current;
389  const result = await client.setActive(workspaceId);
390  if (switchGeneration !== operationGeneration.current) return;
405  queryClient.clear();
406  tokenCache.seed(result.accessToken, result.expiresIn);
407  observeToken({ token: result.accessToken });
```

After the `await`, after the generation check, before `seed` and before `observeToken`. Exactly as specified.

Both ordering constraints have dedicated oracles and both were proven by mutation, M6 and M7.
This is the part of the slice I scrutinized hardest, because the plan asserted that the existing test `keeps the newest requested workspace authoritative when switches resolve out of order` would cover the generation half and that RED 3 would cover the `await` half. Neither claim is true: M6 and M7 each redden exactly one test, and in both cases it is one of the two tests the executor added beyond the plan (`keeps the current tenant's cache while a workspace switch is still in flight` at `react.test.tsx:1129` and `does not flush when a superseded workspace switch resolves late` at `react.test.tsx:1161`).
So the executor found a genuine hole in the plan's oracle coverage and closed it. Had they implemented the plan as written, both orderings would have shipped unproven.

The in-flight test is also non-vacuous in the other direction, which is easy to get wrong: after asserting the cache SURVIVES while the switch is pending, it resolves the switch and asserts the flush then happens (`react.test.tsx:1150-1158`). Without that second half the test would pass equally well against a `setActive` that never flushed at all.

A rejection from `client.setActive` propagates and no flush happens, since the flush is below the `await`. Correct: no switch, no flush.

### 6. Provider nesting swap - PASS

`apps/web/src/App.tsx:28-34` mounts `QueryClientProvider` outermost with `AppAuthProvider` inside it, and `HubAuthProvider` reads the client via `useQueryClient()` at `apps/web/src/auth/react.tsx:158`.

Blast radius independently re-checked rather than taken from the plan. `grep -rn AppAuthProvider apps/web/src` returns only `App.tsx`, the export at `react.tsx:658`, `react.test.tsx`, and the new source pin. `RouterProvider` is the sole child and stays inside `AppAuthProvider`, so every auth consumer in the app is still below the auth provider. `QueryClientProvider` is a plain context provider and reads no context, so nothing it depends on moved. Nothing depended on auth being outermost.

The nesting is pinned by `App.tsx mounts QueryClientProvider outside AppAuthProvider` (`route-error-and-auth-context.test.tsx:87-95`), which asserts both `indexOf` results are non-negative before comparing them, so it cannot pass on a file that lost one of the providers entirely.
M8 proves the pin bites.

The test harness mirrors the real nesting in BOTH `renderProvider` (`react.test.tsx:178-186`) and `renderProtected` (`react.test.tsx:210-230`), so the auth suite is exercising the production shape rather than a convenience shape.

### 7. Slices 03 and 04 undisturbed - PASS

The slice commit touches `react.tsx` in three places only, all additive, and moves no slice-03 or slice-04 statement.

- Slice 04's `markLogoutIntent()` is still the first statement of the `logout` callback body (`react.tsx:355`), above `operationGeneration`, `tokenCache.clear()`, `failSession()`, the new flush, and well above the first `await` at `react.tsx:382`. The flush was inserted after `failSession()` and did not reorder anything slice 04 placed. The whole `explicit logout intent` describe (7 tests, `react.test.tsx:908-1041`) is green.
- Slice 03's refresh classification is intact: `signs out at once when the BFF says the session expired, without entering the ladder`, `keeps the session and enters the ladder when a refresh is transiently unavailable`, `holds a cold start on a transient failure instead of signing out` and `signs out at cold start when the BFF says the session expired` all green.
- Slice 03's consecutive-failure reset is intact: `revalidateAttempts.current = 0` still sits in the non-null branch of `observeToken` immediately after the new guard, and `resets the ladder after each recovery, so unrelated blips never accumulate` is green.
- The three tests the plan flagged as most at risk from the reordering are all present and green: `does not restore authentication when a workspace switch resolves after logout begins`, `keeps the newest requested workspace authoritative when switches resolve out of order`, and `does not re-render auth consumers when a refresh returns the same token`. The last of these is the one that would catch the flush being folded into `applyToken` or made to run on every token read.

`react.test.tsx` is 34 tests, all passing.

### 8. Scope - PASS

`git show --name-only 1e3a20d` is exactly seven files: `CLAUDE.md`, `apps/web/src/App.tsx`, `apps/web/src/__tests__/route-error-and-auth-context.test.tsx`, `apps/web/src/auth/__tests__/react.test.tsx`, `apps/web/src/auth/react.tsx`, `nexo/ROADMAP.md`, and the run notes.

`git diff master...HEAD --stat -- apps/web/src/lib/query-keys.ts apps/api` is empty.
No `apps/api` file, no session store, no query-key factory. The deferral is honoured, and the follow-up is filed verbatim in `nexo/ROADMAP.md` with the blast-radius reasoning intact.

The files actually changed are a subset of the plan's declared `files_modified`.

## Green but worth recording

1. **The plan's oracle claims for the two `setActive` orderings were wrong, and the executor caught it.** Section 3c and the Verification section both name existing tests as the coverage for the `await` and generation orderings. I confirmed by mutation that neither named test reddens on either mutation. The two tests the executor added beyond the plan are the only coverage, and both are correct. This is a plan defect that was fixed in execution, and `CLAUDE.md` now records the two oracle names so it cannot regress silently.

2. **The cold-start flush is real but harmless.** On first mount `lastAppliedToken.current` is `undefined`, so `!wasSignedIn` is true and `clear()` runs on the very first token. That is a no-op today because every data hook lives inside `Protected`, which renders a `Skeleton` until `isSignedIn`. It is worth remembering that this makes the tests order-sensitive: any future cache test in this file must seed AFTER the mount flush or it will pass for the wrong reason. The existing tests do this and say why at `react.test.tsx:1085-1087`.

3. **The switch flush and `observeToken` cannot double-flush**, because `setActive` reaches `observeToken` with a token string already in `lastAppliedToken`. This is asserted only implicitly (no test counts `clear` calls). It is correct as written and a double flush would be harmless, so this is an observation, not a defect.

4. **The residual gap the slice deliberately does not close** is two switches in flight resolving under an identical key, since the keys remain identity-agnostic. It is filed in `nexo/ROADMAP.md` with an honest description of what the flush does and does not buy, which is the right disposition for a session-hardening slice.

5. **`CLAUDE.md` documentation is accurate against the code I read.** Each of its seven new lines corresponds to something I independently confirmed in the source or by mutation. No drift.
