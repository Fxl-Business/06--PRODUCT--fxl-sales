# Slice 02 - Keep the route on session loss

Branch: `fix/02-keep-the-route-on-session-loss`
Plan: `nexo/plans/feature-20260812-session-survives-one-refresh/02-keep-the-route-on-session-loss.md`

## What changed

Two files, exactly the two the plan lists.

### `apps/web/src/sales-ops/SalesOpsApp.tsx`

One edit, immediately after `const ActiveWorkspaceIcon = activeWorkspaceVisual.icon;`.
Added the derived constant `const rolesAreAuthoritative = profile.isSignedIn;` with the plan's doc comment, and added `&& rolesAreAuthoritative` to BOTH early returns:

- `if (visibleWorkspaceIds.length === 0 && rolesAreAuthoritative)` guarding `<Navigate to="/no-role" replace />`
- `if (resolution.redirect && rolesAreAuthoritative)` guarding `<Navigate to={resolution.path} replace />`

Nothing else in the file moved.
No import changes.
The suppression is of the two navigations ONLY: on a signed-out render the component falls through and keeps rendering its shell, so the subtree under `HubProtected`'s live-loss overlay is never unmounted.

### `apps/web/src/sales-ops/__tests__/session-loss-keeps-route.test.tsx` (new)

The oracle, five tests under `describe('Sales Ops keeps its route when a live session is lost')`, with the exact names the plan specifies.
Harness lifted from `apps/web/src/auth/__tests__/react.test.tsx` as instructed: the `vi.hoisted` client/cache block, `vi.mock('@fxl-business/hub-sdk/client')`, the token-cache mock respelled to `vi.mock('@/auth/token', ...)`, the `ok` / `expired` / `transient` constructors, `jwt()`, `TokenProbe`, `LocationProbe`, `flushReact()`, `clickButton()` and the `beforeEach` / `afterEach` bodies.
`../hooks` is mocked exactly as `routing.test.tsx` does it, with the empty bootstrap fixture.
`@/auth/react` is NOT mocked; the real `AppAuthProvider` and the real `Protected` are used, which is what makes the live-loss overlay real.

Deliberately absent, per the plan: no `vi.mock('../refresh', ...)`, no `vi.useFakeTimers()`, no timer assertions, no dialog mock (none was needed - no Radix or happy-dom problem appeared).
`mocks.cache.expiresAt` is pinned to `null` so the proactive renewal can never arm.

Test 2 gives `loseSessionWhileSignedIn` an optional `beforeLoss` callback (the plan explicitly allows this over an inline duplicate mount) and uses it to collapse the sidebar before the loss, so there is real `SalesOpsApp` `useState` to lose.

## Step 1 - RED before the fix

`pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/session-loss-keeps-route.test.tsx` on unmodified `SalesOpsApp.tsx`:

```
 ❯ src/sales-ops/__tests__/session-loss-keeps-route.test.tsx (5 tests | 3 failed) 52ms
   × Sales Ops keeps its route when a live session is lost > keeps the URL on the route the operator was on instead of rewriting it to /no-role 32ms
     → expected '/no-role' to be '/tatico/dashboard' // Object.is equality
   × Sales Ops keeps its route when a live session is lost > keeps the Sales Ops shell and its own component state mounted underneath the overlay 8ms
     → expected undefined to be 'Visão geral' // Object.is equality
   × Sales Ops keeps its route when a live session is lost > captures the route the operator was on when the operator clicks Entrar 5ms
     → expected '/no-role' to be '/tatico/dashboard' // Object.is equality
   ✓ Sales Ops keeps its route when a live session is lost > still redirects a signed-in operator with no visible workspaces to /no-role 2ms
   ✓ Sales Ops keeps its route when a live session is lost > still rewrites the legacy cadastros alias for a signed-in operator 5ms

 Test Files  1 failed (1)
      Tests  3 failed | 2 passed (5)
```

Tests 1, 2 and 3 fail; tests 4 and 5 pass.
That is exactly the prediction in the plan's Verification section, failure message for failure message: test 1 with `'/no-role'`, test 2 because `main h1` is gone once the route no longer matches `/:workspace/:view`, test 3 with `'/no-role'` in the return-to slot.

Note on test 3: the pre-click assertions (`sessionStorage.getItem(RETURN_TO_KEY)` is `null`, `login` not yet called) passed even before the fix, and the post-click assertion is the one that failed. That is the intended shape - it proves the captured `/no-role` was produced by the click and not left over.

## Step 3 - GREEN after the fix

```
 ✓ src/sales-ops/__tests__/session-loss-keeps-route.test.tsx (5 tests) 63ms

 Test Files  1 passed (1)
      Tests  5 passed (5)
```

## Step 4 - mutation checks

### Mutation A: `&& rolesAreAuthoritative` deleted from the FIRST condition only

```
   × keeps the URL on the route the operator was on instead of rewriting it to /no-role 36ms
   × keeps the Sales Ops shell and its own component state mounted underneath the overlay 8ms
   × captures the route the operator was on when the operator clicks Entrar 6ms
   ✓ still redirects a signed-in operator with no visible workspaces to /no-role 1ms
   ✓ still rewrites the legacy cadastros alias for a signed-in operator 4ms
      Tests  3 failed | 2 passed (5)
```

Tests 1, 2 and 3 go red again. Restored.

### Mutation B: `&& rolesAreAuthoritative` deleted from the SECOND condition only

Run as a real probe rather than by reading: the first guard was left intact, and test 1's entry was temporarily changed to `/cadastros/produtos` with the matching expectation.

```
   × keeps the URL on the route the operator was on instead of rewriting it to /no-role 33ms
       Expected: "/cadastros/produtos"
       Received: "/tatico/dashboard"
   × keeps the Sales Ops shell and its own component state mounted underneath the overlay 8ms
   ✓ captures the route the operator was on when the operator clicks Entrar 6ms
   ✓ still redirects a signed-in operator with no visible workspaces to /no-role 1ms
   ✓ still rewrites the legacy cadastros alias for a signed-in operator 4ms
      Tests  2 failed | 3 passed (5)
```

This confirms the plan's claim directly: with `roles === []` every URL resolves `redirect: true`, so an unguarded second branch rewrites `/cadastros/produtos` to `/tatico/dashboard`.
Test 2 (at `/tatico/dashboard`) also went red, which is the other half of the same claim: the second branch re-navigates to the path it is already on, and that `return <Navigate />` is itself an unmount.
Guarding only the first branch really would have relocated the bug rather than fixed it.
Both the source mutation and the scratch test edit were restored.

### Mutation C: the forbidden fix, `return null` instead of suppressing the navigation

First guarded return replaced with `return rolesAreAuthoritative ? <Navigate to="/no-role" replace /> : null;`.

```
   ✓ keeps the URL on the route the operator was on instead of rewriting it to /no-role 30ms
   × keeps the Sales Ops shell and its own component state mounted underneath the overlay 10ms
     → expected undefined to be 'Visão geral' // Object.is equality
   ✓ captures the route the operator was on when the operator clicks Entrar 5ms
   ✓ still redirects a signed-in operator with no visible workspaces to /no-role 2ms
   ✓ still rewrites the legacy cadastros alias for a signed-in operator 5ms
      Tests  1 failed | 4 passed (5)
```

Test 2 is the ONLY test that catches it, which is precisely why it exists.
The URL is preserved under this mutation, so tests 1 and 3 pass with the operator's work destroyed.
Restored.

## Final gate

| command | result |
| --- | --- |
| `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/session-loss-keeps-route.test.tsx` | 5 passed |
| `pnpm --filter @fxl-sales/web test` | 50 files, 668 tests passed |
| `pnpm run lint` | clean (api + web) |
| `pnpm run type-check` | clean (4 projects) |

Neither watched file moved in the full run:

```
 ✓ src/auth/__tests__/react.test.tsx (52 tests) 291ms
 ✓ src/sales-ops/__tests__/routing.test.tsx (16 tests) 680ms
```

No em dash in either touched file (`grep -n "—"` returns nothing).
No processes were left running; every command was run-once.

## Disagreement with the plan

None. The plan was followed literally and every prediction it made held, including the three mutation outcomes and the exact failure messages of the red run.

Two small observations, neither a deviation:

1. The plan offered a choice for test 2's structure ("its own inline mount, or give that helper an optional `beforeLoss` callback"). The callback was chosen, so the mock setup exists once.
2. The plan's fallback advice for a Radix or happy-dom problem (lift the dialog mock from `routing.test.tsx:127-141`) was not needed. No dialog mock is present, confirming the plan's reasoning that every `*Dialog` early-returns `null` on `modal === null`.
