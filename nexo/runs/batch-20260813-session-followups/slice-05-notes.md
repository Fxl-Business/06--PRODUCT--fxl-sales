# Slice 05 - Pin the composed session journey

Branch: `fix/05-pin-the-composed-session-journey` (off `master`).
Test-only slice. No source file changed; `git diff` over `apps/web/src` shows only the two test files.

## What was added

### `apps/web/src/__tests__/session-journey.test.tsx` (new, 6 tests)

The harness is lifted from `apps/web/src/sales-ops/__tests__/session-loss-keeps-route.test.tsx`:
the `vi.hoisted` Hub client and token cache mocks, the `jwt()` builder, `TokenProbe`, a location
probe, `flushReact()` and `clickButton()`.
Everything under test is real - `AppAuthProvider`, `Protected`, `SalesOpsApp`, `NoRoleGuard`
wrapping `NoRolePage` exactly as `router.tsx` wires it, and the real
`captureReturnTo` / `consumeReturnTo` / `sanitizeReturnTo` path through `sessionStorage`.
Only the Hub client, the token cache and the Sales Ops data hooks are mocked.

The Hub round trip is modelled honestly, in `completeHubRoundTrip`: the root is UNMOUNTED, a fresh
`QueryClient` and a fresh tree are mounted at the landing route, and `sessionStorage` is deliberately
left intact because it is the one thing that survives a same-tab navigation.
Flipping a token on the live tree was rejected: it skips the unmount, so `HubProtected`'s restore
effect - half of what this file exists to pin - would never run.

Scenarios:

1. `returns the operator to the route they were on after a lost session and a successful login`
2. `returns the operator to a non-tatico route, where the second guard is load-bearing`
3. `consumes the returnTo exactly once, so a later mount cannot replay it`
4. `never restores a returnTo of /no-role, even if one is somehow stored`
5. `sends an operator who lost entitlement to /no-role and leaves them there without looping`
6. `lets an entitled operator out of /no-role even when nothing is stored to restore`

Two deliberate departures from the plan's letter, both to stop a scenario being vacuous:

- Scenario 3 is driven from `/cadastros/produtos` rather than from scenario 1's
  `/tatico/dashboard`.
  `/tatico/dashboard` IS the admin default route, so "replayed the returnTo" and "landed on the
  default" are the same string there and the assertion would have proved nothing.
  From `/cadastros/produtos` the third mount must land on `/tatico/dashboard`, which only a
  genuinely consumed slot produces.
- Scenario 6 is an ADDITION, not one of the five named scenarios.
  It is what makes the file non-vacuous with respect to slice 04; see the third revert proof below
  for why neither scenario 4 nor scenario 5 can be.

The location probe records every path the router settles on across every mount in one test and
throws past eight, so a redirect loop fails as one named error printing the cycle rather than as a
five second timeout.

### `apps/web/src/sales-ops/__tests__/session-loss-keeps-route.test.tsx` (hardened)

1. The `<div data-testid="no-role-page">` stub on `/no-role` is replaced by the real `NoRoleGuard`
   wrapping the real `NoRolePage` (plus `import '@/i18n'`), so that file's `/no-role` branch stops
   being a fiction.
   The two testid assertions now key on `NoRolePage`'s own copy, `Acesso não autorizado`.
   `still redirects a signed-in operator with no visible workspaces to /no-role` keeps passing and
   now proves more: the operator really reaches the real page through the real guard.
2. One case added, `keeps a non-default route on a live loss, where the second guard is visible`,
   entering at `/cadastros/produtos`.
   The existing five all entered at `/tatico/dashboard`, the one route where the second early
   return's URL rewrite is masked because it self-navigates.

## Revert proof 1 - slice 02

Dropped `&& rolesAreAuthoritative` from both early returns in `apps/web/src/sales-ops/SalesOpsApp.tsx`.

```
 ❯ src/__tests__/session-journey.test.tsx (6 tests | 4 failed) 71ms
 FAIL  ... > returns the operator to the route they were on after a lost session and a successful login
AssertionError: expected '/no-role' to be '/tatico/dashboard' // Object.is equality
 FAIL  ... > returns the operator to a non-tatico route, where the second guard is load-bearing
AssertionError: expected '/no-role' to be '/cadastros/produtos' // Object.is equality
 FAIL  ... > consumes the returnTo exactly once, so a later mount cannot replay it
AssertionError: expected '/tatico/dashboard' to be '/cadastros/produtos' // Object.is equality
 FAIL  ... > sends an operator who lost entitlement to /no-role and leaves them there without looping
AssertionError: expected null to be '/tatico/dashboard' // Object.is equality
 Test Files  1 failed (1)
      Tests  4 failed | 2 passed (6)
```

The hardened file went red too, on four of its six:

```
 FAIL  ... > keeps the URL on the route the operator was on instead of rewriting it to /no-role
AssertionError: expected '/no-role' to be '/tatico/dashboard' // Object.is equality
 FAIL  ... > keeps a non-default route on a live loss, where the second guard is visible
AssertionError: expected '/no-role' to be '/cadastros/produtos' // Object.is equality
 FAIL  ... > keeps the Sales Ops shell and its own component state mounted underneath the overlay
AssertionError: expected undefined to be 'Visão geral' // Object.is equality
 FAIL  ... > captures the route the operator was on when the operator clicks Entrar
AssertionError: expected null to be '/tatico/dashboard' // Object.is equality
 Test Files  1 failed (1)
      Tests  4 failed | 2 passed (6)
```

Restored with `git checkout`; `git diff apps/web/src/sales-ops/SalesOpsApp.tsx` is empty.

## Revert proof 2 - slice 03

Dropped `if (isTerminalAuthRoute(url.pathname)) return null;` from `sanitizeReturnTo` in
`apps/web/src/auth/session-recovery.ts`.

```
 ❯ src/__tests__/session-journey.test.tsx (6 tests | 1 failed) 90ms
 FAIL  ... > never restores a returnTo of /no-role, even if one is somehow stored
AssertionError: expected [ '/', '/no-role', '/', …(1) ] to not include '/no-role'
 Test Files  1 failed (1)
      Tests  1 failed | 5 passed (6)
```

Exactly scenario 4, and exactly on the assertion written for it.
Note what the recorded path shows: `['/', '/no-role', '/', '/tatico/dashboard']`.
The operator still ENDS on `/tatico/dashboard`, because slice 04's guard rescues them from the dead
end the restored returnTo sent them to.
A final-URL assertion alone would therefore have stayed green with slice 03 fully reverted; only
"never visited `/no-role`" can tell a refused restore from a rescued one.
That is the sharpest thing this slice learned and it is only visible when the three fixes are
composed - the unit test for slice 03 cannot see it, because it never renders a router.

Restored with `git checkout`; `git diff apps/web/src/auth/session-recovery.ts` is empty.

## Revert proof 3 - slice 04

Dropped the `NoRoleGuard` wrapper from the `/no-role` route table in BOTH test files.

```
 ❯ src/__tests__/session-journey.test.tsx (6 tests | 1 failed) 84ms
 FAIL  ... > lets an entitled operator out of /no-role even when nothing is stored to restore
AssertionError: expected '/no-role' to be '/tatico/dashboard' // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 5 passed (6)
```

`session-loss-keeps-route.test.tsx` stayed green (6 passed), which is correct: its only `/no-role`
case is an operator with zero recognized roles, and that is precisely the operator `NoRoleGuard`
deliberately leaves on the unauthorized screen.

The plan expected scenario 4 or 5 to catch this. Neither can, and the reason is structural rather
than a gap in how they were written:

- Scenario 4 holds slices 02 and 03 fixed, so the returnTo `/no-role` is refused and the journey
  never reaches `/no-role` at all. There is nothing for the guard to do.
- Scenario 5's operator has no roles, so `getVisibleWorkspaces([]).length === 0` and the guard is
  inert by design; with or without it the operator lands on `/no-role` and reads
  `Acesso não autorizado`.

Slice 04 is the THIRD line of defence against the same dead end, so it can only be observed when
the first two are not covering for it. Scenario 6 constructs exactly that: an entitled operator at
`/no-role` with an EMPTY returnTo slot - a restored tab, a bookmark, or a Back into a URL an earlier
build left in history - where nothing but `NoRoleGuard` can move them.
It is additive over `no-role-redirect.test.tsx`, which mocks `@/auth/react` wholesale and therefore
cannot show the guard working inside the real `Protected` over a profile derived from a real token.

Restored; `git status` shows only the two intended test files modified.

## Final green

```
pnpm --filter @fxl-sales/web exec vitest run src/__tests__/session-journey.test.tsx
  ✓ 6 tests, 1 file
pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/session-loss-keeps-route.test.tsx
  ✓ 6 tests, 1 file
pnpm test
  shared-utils  3 files,  80 tests passed
  api          41 files, 415 tests passed
  web          52 files, 715 tests passed
pnpm run lint        Done (api, web)
pnpm run type-check  Done (shared-types, shared-utils, api, web)
```

Web went from 708 to 715 tests: 6 new in the journey file, 1 new in the hardened file.

## What the composed test showed that the isolated ones could not

- **The three fixes cover for each other, which is how a broken whole passed three green thirds.**
  Revert proof 2 is the demonstration: with slice 03 gone, the operator still ARRIVES in the right
  place, because slice 04 catches them on the way. Any assertion phrased as "where did they end up"
  is blind to that. The journey has to assert the PATH, not the destination.
- **`/tatico/dashboard` is a poor fixture for anything about routes**, because it is the admin
  default: a rewrite to it, a restore of it and a plain landing on it are indistinguishable. Both
  files now carry a `/cadastros/produtos` case for that reason, and scenario 3 is built on it.
- **Effect ordering makes the restore win, and it has to.** On the remount at `/`, `SalesOpsApp`'s
  `<Navigate>` is a child effect and `HubProtected`'s restore effect is the parent's, so the child
  fires first and the restore lands last. React batches both into one location update, which is why
  the intermediate default-route hop is never even recorded. If that order were reversed the
  operator would be dropped on the default route after every login.
- **`sessionStorage` surviving the unmount is the entire mechanism**, and it is only observable
  across two document lifetimes. A single-mount test can prove the slot was WRITTEN; only the round
  trip proves it is read, honoured, and then gone.
