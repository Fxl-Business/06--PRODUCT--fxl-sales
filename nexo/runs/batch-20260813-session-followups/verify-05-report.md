# Verify report - slice 05, pin the composed session journey

- Slice: `05-pin-the-composed-session-journey`
- Branch under test: `fix/05-pin-the-composed-session-journey`
- Verdict: **PASS**, with one finding recorded under point 4 that the implementer should read.
- Verifier did not read `slice-05-notes.md`. All three reverts below were performed first-hand.

---

## 1. The gate, run first-hand

All run-once. No watcher was started and no process was left running.

### `pnpm --filter @fxl-sales/web exec vitest run src/__tests__/session-journey.test.tsx`

```
 ✓ src/__tests__/session-journey.test.tsx (6 tests) 76ms

 Test Files  1 passed (1)
      Tests  6 passed (6)
   Duration  1.04s
```

### `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/session-loss-keeps-route.test.tsx`

```
 ✓ src/sales-ops/__tests__/session-loss-keeps-route.test.tsx (6 tests) 57ms

 Test Files  1 passed (1)
      Tests  6 passed (6)
   Duration  1.03s
```

### `pnpm --filter @fxl-sales/web test`

```
 Test Files  52 passed (52)
      Tests  715 passed (715)
   Duration  5.40s
```

### `pnpm run lint`

```
apps/api lint$ eslint src/
apps/web lint$ eslint src/
apps/api lint: Done
apps/web lint: Done
```

### `pnpm run type-check`

```
packages/shared-types type-check: Done
packages/shared-utils type-check: Done
apps/api type-check: Done
apps/web type-check: Done
```

Gate: green on all five commands.

---

## 2. THE CENTRAL QUESTION - does the new test bite for each of the three slices independently?

Yes. All three reverts were performed by the verifier, one at a time, each restored with
`git checkout -- <file>` and each proven clean with `git status --porcelain -- apps/web`
returning empty before the next one began.

### Revert A - slice 02: drop `&& rolesAreAuthoritative` from both early returns in `SalesOpsApp.tsx`

Applied diff:

```
-  if (visibleWorkspaceIds.length === 0 && rolesAreAuthoritative) {
+  if (visibleWorkspaceIds.length === 0) {
-  if (resolution.redirect && rolesAreAuthoritative) {
+  if (resolution.redirect) {
```

Result on `session-journey.test.tsx`: **4 of 6 red.**

```
 ❯ src/__tests__/session-journey.test.tsx (6 tests | 4 failed) 67ms
   × returns the operator to the route they were on after a lost session and a successful login
     → expected '/no-role' to be '/tatico/dashboard'          (line 406)
   × returns the operator to a non-tatico route, where the second guard is load-bearing
     → expected '/no-role' to be '/cadastros/produtos'        (line 439)
   × consumes the returnTo exactly once, so a later mount cannot replay it
     → expected '/tatico/dashboard' to be '/cadastros/produtos' (line 462)
   ✓ never restores a returnTo of /no-role, even if one is somehow stored
   × sends an operator who lost entitlement to /no-role and leaves them there without looping
     → expected null to be '/tatico/dashboard'                (line 493)
   ✓ lets an entitled operator out of /no-role even when nothing is stored to restore
```

The plan predicted scenarios 1 and 2. It gets 1, 2, 3 and 5. Scenario 5 fails on the
`captureReturnTo` assertion rather than on a URL, which is the correct downstream
consequence: with the guard gone the URL is already `/no-role` by the time `Entrar` is
clicked, `sanitizeReturnTo` refuses it, and the slot stays empty.

Additionally, the Part-2 hardening in `session-loss-keeps-route.test.tsx` also bites under
this same revert, including the newly added non-default-route case:

```
 ❯ src/sales-ops/__tests__/session-loss-keeps-route.test.tsx (6 tests | 4 failed)
   × keeps the URL on the route the operator was on instead of rewriting it to /no-role
   × keeps a non-default route on a live loss, where the second guard is visible
     → expected '/no-role' to be '/cadastros/produtos'
   × keeps the Sales Ops shell and its own component state mounted underneath the overlay
   × captures the route the operator was on when the operator clicks Entrar
```

Restored, `git status --porcelain -- apps/web` empty.

### Revert B - slice 03: drop the `isTerminalAuthRoute` call from `session-recovery.ts`

Applied diff:

```
-  if (isTerminalAuthRoute(url.pathname)) return null;
+  // REVERTED FOR VERIFY
```

Result: **exactly 1 of 6 red - scenario 4, the one the plan named.**

```
 ❯ src/__tests__/session-journey.test.tsx (6 tests | 1 failed) 102ms
   × never restores a returnTo of /no-role, even if one is somehow stored
     → expected [ '/', '/no-role', '/', …(1) ] to not include '/no-role'   (line 485)
```

This is the most interesting of the three, and it is worth calling out as a POSITIVE.
The failure lands on `expect(visited).not.toContain('/no-role')` and **not** on the final
URL. The `visited` trace `['/', '/no-role', '/', ...]` shows exactly what the file comment
predicts: with slice 03 reverted the returnTo really is restored to `/no-role`, and then
slice 04's `NoRoleGuard` immediately rescues the operator back out, so the final URL is
still `/tatico/dashboard` and an assertion on the final URL alone would have been green.
The author anticipated that mutual cover and installed the only oracle that can see through
it. This is the single best-designed assertion in the file.

Restored, `git status --porcelain -- apps/web` empty.

### Revert C - slice 04: drop the `NoRoleGuard` wrapper from the test's own route tables

Applied to both test files:

```
-                    <NoRoleGuard>
-                      <NoRolePage />
-                    </NoRoleGuard>
+                    <NoRolePage />
```

Result: **1 of 6 red - but NOT scenario 4 or 5.**

```
 ✓ src/sales-ops/__tests__/session-loss-keeps-route.test.tsx (6 tests)
 ❯ src/__tests__/session-journey.test.tsx (6 tests | 1 failed) 81ms
   ✓ returns the operator to the route they were on after a lost session and a successful login
   ✓ returns the operator to a non-tatico route, where the second guard is load-bearing
   ✓ consumes the returnTo exactly once, so a later mount cannot replay it
   ✓ never restores a returnTo of /no-role, even if one is somehow stored
   ✓ sends an operator who lost entitlement to /no-role and leaves them there without looping
   × lets an entitled operator out of /no-role even when nothing is stored to restore
     → expected '/no-role' to be '/tatico/dashboard'          (line 518)
```

Two observations, both material.

First, the plan's own prediction was wrong: it expected "scenario 4 or 5" to go red, and
neither does. Scenario 4 passes because with `sanitizeReturnTo` intact the returnTo is
refused before `/no-role` is ever visited, so the guard has nothing to do. Scenario 5
passes because a genuinely unentitled operator is exactly who `NoRoleGuard` leaves in
place, so removing the guard changes nothing for them. Had the implementer built only the
five scenarios the plan specified, **slice 04 would have had zero coverage in this file**
and this gate would have failed.

Second, the implementer added a sixth scenario beyond the plan,
`lets an entitled operator out of /no-role even when nothing is stored to restore`, and it
is the only thing in the entire branch that catches slice 04. That is a correct and
necessary addition, and the reasoning in its comment (empty returnTo slot, so nothing but
the guard can move an entitled operator off the dead end) is exactly right.

Third, `session-loss-keeps-route.test.tsx` stays **fully green** under this revert. The
Part-2 swap of the `data-testid` stub for the real `NoRoleGuard` plus `NoRolePage` makes
that file honest - its `/no-role` branch is no longer a fiction - but it adds no regression
oracle of its own. That matches what the plan asked for (remove the fiction, do not weaken
what it proves) so it is not a defect, only worth knowing.

Restored, `git status --porcelain -- apps/web` empty.

### Summary

| Revert | Slice | Scenarios red | Bites |
| --- | --- | --- | --- |
| A | 02, `rolesAreAuthoritative` | 1, 2, 3, 5 | yes, strongly |
| B | 03, `isTerminalAuthRoute` | 4 | yes, precisely |
| C | 04, `NoRoleGuard` | 6 | yes, and only via the added scenario 6 |

No revert leaves the file green. The non-vacuity requirement is met.

---

## 3. Is it actually composed, or three unit tests in a trench coat?

Composed. Verified by reading the mount, not by trusting the comments.

- Real `AppAuthProvider` and `Protected`, imported from `@/auth/react` (line 126). Not mocked.
- Real `SalesOpsApp`, imported from `@/sales-ops/SalesOpsApp` (line 130). Not mocked.
- Real `NoRoleGuard` from `@/components/auth/RoleGuard` wrapping real `NoRolePage`
  (lines 128-129, 256-260), mirroring `router.tsx`.
- Real `sanitizeReturnTo` path. `@/auth/session-recovery` is imported only for the
  `RETURN_TO_KEY` constant; `captureReturnTo` and `consumeReturnTo` run for real against
  the real happy-dom `sessionStorage`. Proven by revert B, which could not have gone red
  through a mock.
- Only the Hub client, the token cache and `@/sales-ops/hooks` are mocked, which is the
  network and nothing else. `@/auth/refresh` is deliberately not mocked, and the comment
  explaining why (the real refresher is constructed and never called because the cache that
  would call it is mocked) checks out against `react.tsx`.

The Hub round trip is a **genuine unmount and remount**. `completeHubRoundTrip` (line 363)
calls `unmountApp`, which does `root.unmount()` inside `act` and then `host.remove()`, and
only afterwards constructs a fresh `createRoot` with a fresh `QueryClient`. `sessionStorage`
is deliberately not cleared between the two. No token is flipped on a live tree anywhere in
the file. This genuinely does exercise `HubProtected`'s restore effect, which is gated on a
`restoredRef` that only resets on a fresh provider instance - a live-tree token flip would
have left `restoredRef.current === true` and never fired it.

---

## 4. Assertions that pass for the wrong reason - the finding

I probed this directly rather than reasoning about it. **One real weakness found.**

### Finding: scenario 1 does not prove its own name

Scenario 1 is `returns the operator to the route they were on after a lost session and a
successful login`. It is the acceptance criterion stated verbatim, and it is the flagship
case of the file. It enters at `/tatico/dashboard`.

`/tatico/dashboard` is the admin **default landing route**. So on the remount at `/`, an
admin arrives at `/tatico/dashboard` whether the returnTo was restored or whether the
restore mechanism does not exist at all. Its two post-remount assertions both survive a
total deletion of the restore:

- `expect(locationText(next.host)).toBe('/tatico/dashboard')` - satisfied by the default
  landing.
- `expect(sessionStorage.getItem(RETURN_TO_KEY)).toBeNull()` - satisfied because
  `consumeReturnTo()` destroys the slot before it validates, which happens whether or not a
  navigation follows.

I proved this with a fourth probe, neutering only the restore navigation in
`apps/web/src/auth/react.tsx` while keeping the consume:

```
-    if (target && target !== currentPath) navigate(target, { replace: true });
+    void target; // PROBE: restore navigation removed, consume kept
```

```
 ❯ src/__tests__/session-journey.test.tsx (6 tests | 2 failed) 91ms
   ✓ returns the operator to the route they were on after a lost session and a successful login
   × returns the operator to a non-tatico route, where the second guard is load-bearing
     → expected '/tatico/dashboard' to be '/cadastros/produtos'
   × consumes the returnTo exactly once, so a later mount cannot replay it
     → expected '/tatico/dashboard' to be '/cadastros/produtos'
   ✓ never restores a returnTo of /no-role, even if one is somehow stored
   ✓ sends an operator who lost entitlement to /no-role and leaves them there without looping
   ✓ lets an entitled operator out of /no-role even when nothing is stored to restore
```

Scenario 1 stays green with the entire route restore deleted. Probe reverted, tree clean.

**Why this is a finding and not a FAIL.** The behaviour is still covered: scenarios 2 and 3
both enter at `/cadastros/produtos`, both go red under the probe, and the author clearly
understood the masking - the comment on scenario 2 says `/tatico/dashboard` is where "the
second early return self-navigates and its rewrite is invisible", and the comment on
scenario 3 says the same about the default route making the assertion "prove nothing". So
the file as a whole is sound. The gap is that the one scenario that carries the acceptance
criterion as its name is the one scenario that cannot demonstrate it, and a future reader
who trusts the test name will be misled. The cheap fix, if the implementer wants it, is one
extra assertion in scenario 1 - for instance asserting `visited` contains `/tatico/dashboard`
after a `/` entry, or simply moving scenario 1 to a non-default route and leaving
`/tatico/dashboard` to a separate case. Not required to pass.

### Assertions I checked and found sound

- **Scenario 4's `expect(visited).not.toContain('/no-role')`.** The obvious wrong assertion
  here would have been the final URL, which `NoRoleGuard` rescues. Revert B proves the
  author picked the only oracle that sees the regression. Correct.
- **Scenario 3's third mount asserting `/tatico/dashboard`.** Discriminating, because the
  journey ran from `/cadastros/produtos`, so a replayed returnTo and a default landing are
  different strings. Correct, and the comment says exactly why.
- **Scenario 5's `visited.filter(p => p === '/no-role').toHaveLength(1)`.** Distinguishes
  "settled once" from "first lap of a loop", which a final-URL assertion cannot. Backed by
  `MAX_VISITED = 8` throwing a named `redirect loop: a -> b -> c` error rather than a
  timeout. Correct.
- **Scenario 6's `expect(sessionStorage.getItem(RETURN_TO_KEY)).toBeNull()` opening line.**
  Not decoration - it is what makes the rest of the scenario attributable to the guard
  rather than to a restore. Correct.
- **`mocks.cache.expiresAt.mockReturnValue(null)`.** Correctly pins the proactive renewal
  inert, per CLAUDE.md's note that happy-dom reports `visibilityState` as `visible`
  whenever the document has a `defaultView`. Without it the second timer source could arm
  and make these assertions timing-dependent.

---

## 5. Scope

```
$ git diff --stat master..HEAD
 apps/web/src/__tests__/session-journey.test.tsx    | 523 +++++++++++++++++++++
 .../__tests__/session-loss-keeps-route.test.tsx    |  36 +-
 .../slice-05-notes.md                              | 188 ++++++++
 3 files changed, 744 insertions(+), 3 deletions(-)
```

Two test files plus run notes under `nexo/runs/`. **Zero source files changed.** Test-only
slice requirement satisfied.

---

## 6. Rules

- **Em dashes.** Grepping the branch diff for U+2014 returns nothing. Clean.
- **Agent attribution.** No commit was made on this branch beyond the slice work; the
  branch commits carry no agent co-author line.
- **No assertion lost in the hardened file.** Compared against `master`:
  `master` had 5 `it(` blocks and 18 `expect(` calls; `HEAD` has 6 and 21. The two removed
  assertions were both `data-testid="no-role-page"` queries against a stub, and both were
  replaced in place by strictly-stronger checks against the real page copy
  (`not.toContain(UNAUTHORIZED)` plus `toContain('Sua sessão expirou')` in the first case,
  `toContain(UNAUTHORIZED)` in the second). The five original cases and both navigation
  sweeps all still pass. Nothing was weakened.
- **Tree left as found.** After all four probes, `git status --porcelain` shows only the
  pre-existing `nexo/runs/batch-20260813-session-followups/budget.json` modification, the
  untracked `.vscode/`, and the untracked agents directory - all of which were present
  before this verification began. No process was left running.

---

## Verdict

**PASS.**

The gate is green on all five commands. All three reverts bite, each on a distinct and
correctly-chosen assertion. The test is genuinely composed, with real provider, real
`Protected`, real `SalesOpsApp`, real `NoRoleGuard` over the real `NoRolePage`, the real
`sanitizeReturnTo` path, and a real unmount-and-remount for the Hub round trip. Scope is
test-only and no rule is violated.

Two things the implementer should know:

1. The plan's prediction for revert C was wrong, and the sixth scenario the implementer
   added beyond the plan is the only coverage slice 04 has anywhere on this branch. Do not
   let anyone delete it as "not in the plan".
2. Scenario 1 passes with the entire route restore deleted, because `/tatico/dashboard` is
   the admin default landing. The behaviour is covered by scenarios 2 and 3, so this is a
   naming and readability hazard rather than a coverage hole, but the scenario that carries
   the acceptance criterion as its title cannot currently demonstrate it.
