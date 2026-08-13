---
id: 05-pin-the-composed-session-journey
milestone: v2.8.0
status: done
depends_on: []
files_modified:
  - apps/web/src/__tests__/session-journey.test.tsx
  - apps/web/src/sales-ops/__tests__/session-loss-keeps-route.test.tsx
acceptance: "given a live session is lost and the operator clicks Entrar and the login succeeds, when the app remounts, then the operator is back on the exact route they were on, with the returnTo consumed exactly once and no redirect loop"
goal: Pin the operator's real end-to-end journey, which is currently covered only in three disjoint thirds.
must_not_break:
  - every existing assertion in session-loss-keeps-route.test.tsx
  - the five slice-04 redirect cases and the two navigation sweeps
rules:
  - test-only slice, no source file may change
  - no em dashes anywhere
verifier_focus: that the new test genuinely exercises the composed path rather than re-testing one slice, and that it fails if ANY of slices 02, 03 or 04 is reverted
---

# 05 - Pin the composed session journey

## Why

`feature-20260812-session-survives-one-refresh` fixed the every-two-minutes logout with four slices.
Three of them touch the same story from different angles, and each is tested in isolation:

- slice 02 keeps the URL when the session is lost, tested in `session-loss-keeps-route.test.tsx`
- slice 03 refuses `/no-role` as a returnTo, tested in `session-recovery.test.ts`
- slice 04 lets an entitled operator out of `/no-role`, tested in `no-role-redirect.test.tsx`

Nothing tests the JOURNEY, which is the only thing the operator actually experiences: lose the
session, click `Entrar`, complete the Hub round trip, and arrive somewhere.
The wave verifier for that feature built exactly this test, proved it green over five scenarios, and
then deleted it because its brief was to verify rather than to add.
This slice makes it permanent.

That matters more than usual here. This bug was reported and "fixed" three times before the real
cause was found, and each previous fix introduced the damage the next one had to repair. A test that
only covers thirds is how that happens: every third passed while the whole was broken.

## Scope

Two files, both tests. NO source file may change. If you find yourself wanting to change one, stop
and report it, because that is a finding rather than a task.

## Part 1 - the new file `apps/web/src/__tests__/session-journey.test.tsx`

Build it on the harness already proven in
`apps/web/src/sales-ops/__tests__/session-loss-keeps-route.test.tsx`.
Read that file first and lift its setup rather than inventing one: the `vi.hoisted` Hub client and
token cache mocks, the `../hooks` mock, the `jwt()` builder, `TokenProbe`, `LocationProbe`,
`flushReact()` and `clickButton()`.

The mount must use the REAL pieces, because a mock of any of them deletes the thing under test:

- the real `AppAuthProvider` and `Protected` from `@/auth/react`
- the real `SalesOpsApp`
- the real `NoRoleGuard` wrapping the real `NoRolePage` on `/no-role`, mirroring `router.tsx`
- the real `sanitizeReturnTo` path, by letting `captureReturnTo` and `consumeReturnTo` run for real

Model the Hub round trip honestly. `login()` is a full `window.location.assign`, so the document is
destroyed and a new one is created. In the test that means: unmount the root, keep `sessionStorage`
intact (it survives a same-tab navigation, which is exactly why the returnTo lives there), then
mount a fresh tree at `/` with the token cache now returning a good token. Do NOT simulate the
round trip by simply flipping a token on the existing tree; that skips the unmount and would not
exercise the restore effect.

### Scenarios, with these exact test names

1. `returns the operator to the route they were on after a lost session and a successful login`
   Sign in as admin at `/tatico/dashboard`, lose the session, assert the overlay and the preserved
   URL, click `Entrar`, assert `client.login` was called once and the returnTo slot holds
   `/tatico/dashboard`. Unmount, remount at `/` signed in, and assert the final URL is
   `/tatico/dashboard` and the returnTo slot is now EMPTY.

2. `returns the operator to a non-tatico route, where the second guard is load-bearing`
   The same, entered at `/cadastros/produtos`. This is the case the existing tests cannot see,
   because on `/tatico/dashboard` the second early return self-navigates and its URL rewrite is
   masked. Assert the final URL is `/cadastros/produtos`.

3. `consumes the returnTo exactly once, so a later mount cannot replay it`
   After scenario 1's remount, mount a THIRD time at `/` and assert the operator stays on the
   default route rather than being sent to `/tatico/dashboard` again.

4. `never restores a returnTo of /no-role, even if one is somehow stored`
   Seed `sessionStorage` directly with `/no-role` under `RETURN_TO_KEY`, mount signed in at `/`,
   and assert the operator lands on the role default and never renders `Acesso não autorizado`.
   This is slice 03 observed through the journey rather than through the unit.

5. `sends an operator who lost entitlement to /no-role and leaves them there without looping`
   Lose the session while admin, then remount with a token whose claims carry no recognized role.
   Assert the final URL is `/no-role`, the unauthorized copy IS on screen, and the number of
   distinct locations visited is bounded. Use a location probe that throws on more than a handful
   of navigations so a loop fails as one named error rather than as a timeout.

### The non-vacuity requirement

The point of this file is to fail if ANY of the three slices regresses. Prove that, and record the
output for each:

- revert slice 02's guard (drop `&& rolesAreAuthoritative` from both early returns in
  `SalesOpsApp.tsx`) and confirm at least scenarios 1 and 2 go red
- revert slice 03 (drop the `isTerminalAuthRoute` call in `session-recovery.ts`) and confirm
  scenario 4 goes red
- revert slice 04 (drop the `NoRoleGuard` wrapper in the test's own route table) and confirm
  scenario 4 or 5 goes red

Restore each immediately and prove the tree is clean with `git diff`. If any of the three reverts
leaves the whole file green, the test is not doing its job and you must say so rather than shipping
it.

## Part 2 - harden `session-loss-keeps-route.test.tsx`

Two changes, both small.

1. Replace the `<div data-testid="no-role-page">` stub on the `/no-role` route with the real
   `NoRoleGuard` wrapping the real `NoRolePage`, so that file's `/no-role` branch stops being a
   fiction. Its existing assertion `still redirects a signed-in operator with no visible workspaces
   to /no-role` must keep passing; adjust how it asserts arrival if it currently keys on the
   testid, but do not weaken what it proves.

2. Add one case: a live session loss entered at `/cadastros/produtos`, asserting the URL is still
   `/cadastros/produtos`. The existing five all enter at `/tatico/dashboard`, the one route where
   the second guard's URL rewrite is invisible.

## Commands

```
pnpm --filter @fxl-sales/web exec vitest run src/__tests__/session-journey.test.tsx
pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/session-loss-keeps-route.test.tsx
pnpm --filter @fxl-sales/web test
pnpm run lint
pnpm run type-check
```
