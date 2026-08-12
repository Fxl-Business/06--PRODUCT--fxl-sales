# Verify report - slice 02, keep the route on session loss

Verdict: **PASS**

Branch under test: `fix/02-keep-the-route-on-session-loss` at `f7bbfa1`.
Trunk: `master`.
Verifier did not write, fix, merge, commit or push any code.
The one file written is this report plus the agent result JSON.

## Acceptance criterion

> Given a live session is lost while the operator is on `/tatico/dashboard`, when the signed-out overlay renders, then the URL stays `/tatico/dashboard` and `Entrar` captures that route rather than `/no-role`.

Met, and pinned by three separate assertions in
`apps/web/src/sales-ops/__tests__/session-loss-keeps-route.test.tsx`.

## 1. The gate, run first-hand

All four commands were run from a clean checkout of the branch, run-once, no watcher.

### `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/session-loss-keeps-route.test.tsx`

```
 ✓ src/sales-ops/__tests__/session-loss-keeps-route.test.tsx (5 tests) 51ms

 Test Files  1 passed (1)
      Tests  5 passed (5)
```

### `pnpm --filter @fxl-sales/web test`

```
 Test Files  50 passed (50)
      Tests  668 passed (668)
   Duration  5.45s
```

`apps/web`'s `test` script is `vitest run`, so this is run-once by construction.

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

### Root gate, re-run on the restored tree after all mutations

```
packages/shared-utils test:  Test Files  3 passed (3)
packages/shared-utils test:       Tests  80 passed (80)
apps/api test:  Test Files  41 passed (41)
apps/api test:       Tests  415 passed (415)
apps/web test:  Test Files  50 passed (50)
apps/web test:       Tests  668 passed (668)
```

1163 tests, all green, including the tracked-file guard.

## 2. The central question: preserved subtree, or a relocated unmount?

This was the primary focus, and it is answered by mutation rather than by reading.
Four mutations were applied to `apps/web/src/sales-ops/SalesOpsApp.tsx`, each one restored
byte-exactly afterwards.

Baseline checksum of the file, recorded before the first mutation and re-confirmed after every
restore: `md5 = 6eeb01e752f93f79222bb740d25cc2b5`.

### M1a - the literal instruction: replace the guarded `/no-role` Navigate with `return null`

```diff
   if (visibleWorkspaceIds.length === 0 && rolesAreAuthoritative) {
-    return <Navigate to="/no-role" replace />;
+    return null;
   }
```

Caught, by one test:

```
 × still redirects a signed-in operator with no visible workspaces to /no-role
   → expected '/tatico/dashboard' to be '/no-role' // Object.is equality
 Tests  1 failed | 20 passed (21)
```

Note what this mutation does and does not prove.
Because the branch is guarded, it is unreachable on a session loss, so this variant only exercises
the signed-in zero-workspace path.
It proves test 4 bites.
It does not, on its own, answer the central question, so the mutation below was run as well.

### M1b - the forbidden fix: preserve the URL but still unmount while signed out

This is the mutation that actually tests "does the fix preserve the subtree, or merely move the
unmount". It is the exact shape the plan forbids in its "Why the obvious fix is forbidden" section:
the URL is left alone, so the visible bug appears fixed, while the operator's work is still destroyed.

```diff
+  if (!rolesAreAuthoritative) {
+    return null;
+  }
+
   if (visibleWorkspaceIds.length === 0 && rolesAreAuthoritative) {
```

Run against the ENTIRE web suite, not just the new file:

```
 × keeps the Sales Ops shell and its own component state mounted underneath the overlay
   → expected undefined to be 'Visão geral' // Object.is equality
 Test Files  1 failed | 49 passed (50)
      Tests  1 failed | 667 passed (668)
```

Exactly one test out of 668 catches it, and it is the right one:
`keeps the Sales Ops shell and its own component state mounted underneath the overlay`.

Tests 1 and 3 stay green under this mutation, which is the correct and honest result: the URL really
is preserved and `Entrar` really does capture `/tatico/dashboard`, so a URL-only oracle would have
passed a fix that throws the operator's wizard away.
Test 2 is therefore not redundant with tests 1 and 3, it is the only thing standing between this
slice and a regression of `quick-20260810-preserve-work-on-session-loss`.

Judgement on oracle quality: test 2 is a good oracle rather than a coincidental one.
It does not merely assert that some DOM exists.
It collapses the sidebar BEFORE the loss and then asserts `button[aria-label="Expandir menu"]` is
still present afterwards.
`sidebarCollapsed` is `useState` on `SalesOpsApp` itself, so that assertion can only pass if the
identical component instance survived the loss.
A remount would reset it to the expanded state and the assertion would fail even though the shell
looked correct.
`shellTitle` is scoped to `main h1`, which cannot collide with `SignedOutPanel`'s own `h1` because
that one renders in the overlay sibling outside `main`.

### M2 - remove the guard from the FIRST condition only

```diff
-  if (visibleWorkspaceIds.length === 0 && rolesAreAuthoritative) {
+  if (visibleWorkspaceIds.length === 0) {
```

Three tests red, exactly the three the plan predicts, and they reproduce the production report
verbatim:

```
 × keeps the URL on the route the operator was on instead of rewriting it to /no-role
   → expected '/no-role' to be '/tatico/dashboard'
 × keeps the Sales Ops shell and its own component state mounted underneath the overlay
   → expected undefined to be 'Visão geral'
 × captures the route the operator was on when the operator clicks Entrar
   → expected '/no-role' to be '/tatico/dashboard'
 Tests  3 failed | 665 passed (668)
```

The third failure is the money shot: the return-to slot really does end up holding `/no-role`
without the guard, so `Entrar` really would restore a dead end.

### M3 - remove the guard from the SECOND condition (`resolution.redirect`) only

```diff
-  if (resolution.redirect && rolesAreAuthoritative) {
+  if (resolution.redirect) {
```

Against the shipped suite:

```
 × keeps the Sales Ops shell and its own component state mounted underneath the overlay
   → expected undefined to be 'Visão geral'
 Tests  1 failed | 667 passed (668)
```

Caught, but only by the mount oracle, and the prompt is right that on `/tatico/dashboard` this looks
almost harmless: with an empty role set the resolution falls back to `/tatico/dashboard`, so the
`Navigate` targets the URL it is already on and tests 1 and 3 stay green.

To judge it honestly I probed a different entry route.
With M3 still applied I created a throwaway copy of the test file with the entry changed from
`/tatico/dashboard` to `/cadastros/produtos`, ran it, then deleted it:

```
 × keeps the URL on the route the operator was on ...
   → expected '/tatico/dashboard' to be '/cadastros/produtos'
 × keeps the Sales Ops shell and its own component state mounted ...
   → expected undefined to be 'Visão geral'
 × captures the route the operator was on when the operator clicks Entrar
   → expected '/tatico/dashboard' to be '/cadastros/produtos'
 ✓ still redirects a signed-in operator with no visible workspaces to /no-role
 ✓ still rewrites the legacy cadastros alias for a signed-in operator
```

Finding: the second guard is genuinely load-bearing, not defence in depth.
Without it, an operator who loses a session anywhere outside `tatico` has the URL rewritten to
`/tatico/dashboard` and `Entrar` captures `/tatico/dashboard`, so the bug is relocated rather than
fixed, precisely as the plan argued at lines 66 to 77.
The shipped suite does catch M3, via test 2.

Coverage nit, non-blocking: every loss scenario in the shipped file enters at `/tatico/dashboard`,
which is the one route where the second guard's URL-rewrite half is invisible.
A sixth test entering at a non-`tatico` route would pin that half directly instead of relying on the
mount oracle to catch it by side effect.
Not a gate failure, because the mutation IS caught and the acceptance criterion names
`/tatico/dashboard` explicitly.

### M4 - make the guard unconditional, i.e. over-broad

```diff
-  const rolesAreAuthoritative = profile.isSignedIn;
+  const rolesAreAuthoritative = false as boolean;
```

Seven tests red across two files:

```
 × still redirects a signed-in operator with no visible workspaces to /no-role
   → expected '/tatico/dashboard' to be '/no-role'
 × still rewrites the legacy cadastros alias for a signed-in operator
   → expected '/cadastros/vendedores' to be '/cadastros/pessoas'
 × Sales Ops canonical routing > replaces invalid and role-forbidden routes with the role default
 × Sales Ops canonical routing > does not restore a role-forbidden route after canonical replacement
 × Sales Ops canonical routing > lands seller-only users in Meus dados and blocks team workspaces
 × Sales Ops canonical routing > keeps pessoas management in Cadastros and personal panels read-only
 × Sales Ops canonical routing > rewrites the legacy cadastros seller and finder URLs to Pessoas
 Tests  7 failed | 661 passed (668)
```

### Restoration

After every single mutation the file was restored with `git checkout --` and the checksum
re-verified as `6eeb01e752f93f79222bb740d25cc2b5`.
Final tracked diff of the working tree:

```
 nexo/runs/feature-20260812-session-survives-one-refresh/budget.json | 5 +++--
 1 file changed, 3 insertions(+), 2 deletions(-)
```

`budget.json` was already modified before this verification began and was not touched by the
verifier. No source file carries any residue.

## 3. Correct, or over-broad?

Both must-not-breaks are covered by tests that provably fail if the guard becomes unconditional,
which is what M4 above demonstrates.

- Genuine zero-workspace redirect. `still redirects a signed-in operator with no visible workspaces
  to /no-role` mounts with `noRoleToken` (`roles.workspace: 'member'`, empty `productRoles`), asserts
  the URL becomes `/no-role`, asserts the `/no-role` element rendered, and asserts the overlay text
  `Sua sessão expirou` is ABSENT. That last assertion matters: it proves the test is observing a real
  signed-in redirect rather than an accidental session loss.
- Legacy alias. `still rewrites the legacy cadastros alias for a signed-in operator` enters at
  `/cadastros/vendedores`, asserts the URL becomes `/cadastros/pessoas` AND that the rendered shell
  title is `Pessoas`, so it pins the destination screen and not just the string in the address bar.
  The pre-existing `routing.test.tsx` alias test also goes red under M4, so the behaviour has two
  independent guards.

The guard term itself is the narrowest one available.
`profile.isSignedIn` is written by `applyToken` in the same `setProfile` call as `roles`, so the two
cannot disagree, and `profile.roles.length` would have been wrong because a signed-in operator with
genuinely zero roles is exactly the person `/no-role` exists for.
The `profile.isLoaded` term is correctly absent: the provider's initial state is
`{ isLoaded: false, isSignedIn: false }` and `applyToken` only ever writes `isLoaded: true`, so
`isLoaded && isSignedIn` is identical to `isSignedIn` for every reachable state.

## 4. Does the test drive the REAL auth provider?

Yes, and this was checked rather than assumed.

- The only `vi.mock` calls in the new file are `@fxl-business/hub-sdk/client`, `@/auth/token` and
  `../hooks`. `@/auth/react` is NOT mocked, unlike `routing.test.tsx` and
  `blank-bearer-token.test.tsx`, both of which mock it and therefore could never have observed this
  bug.
- `AppAuthProvider` and `Protected` are the real exports: `apps/web/src/auth/react.tsx:915-916`
  define them as `HubAuthProvider` and `HubProtected`.
- The loss is driven through a genuine token transition, not a prop. `mocks.cache.getToken` is
  primed `mockResolvedValueOnce(ok(adminToken)).mockResolvedValue(expired)`, and the test then calls
  the real `getToken` it obtained from the real `useAccessToken()` hook. `expired` is
  `{ token: null, failure: 'session_expired' }`, the BFF's own `401` verdict, which is the one result
  that routes straight to `failSession()` with no ladder rung scheduled.
- The branch actually reached is provably the live-loss branch. `SignedOutPanel`'s default title is
  `Você saiu da sua conta` (react.tsx:661); `Sua sessão expirou` is passed only by the
  `liveSessionLoss` branch at react.tsx:813-837, which is the sole branch that renders `{children}`
  alongside the overlay. Asserting that exact string therefore proves both which branch fired and
  that the keep-mounted branch is the one under test.
- No fake timers anywhere, and `mocks.cache.expiresAt` is pinned to `null` so the proactive renewal
  timer provably cannot arm. This respects the CLAUDE.md warning about happy-dom always reporting
  `visibilityState` as `visible`.

## 5. Is the returnTo assertion real?

Yes.

- `RETURN_TO_KEY` is imported from `@/auth/session-recovery`, where it is
  `'fxl-sales.auth.returnTo'` (line 20) and is the exact key `captureReturnTo` writes to via
  `writeItem(storage, RETURN_TO_KEY, safe)` (line 155). The test reads the real slot the real
  production code writes.
- It is read with `sessionStorage.getItem`, not with `consumeReturnTo()`, which is correct:
  `consumeReturnTo` drops the key at line 168 before validating, so using it in an assertion would
  poison any later read.
- `expect(sessionStorage.getItem(RETURN_TO_KEY)).toBeNull()` is asserted BEFORE the click, alongside
  `expect(mocks.client.login).not.toHaveBeenCalled()`, so the post-click `/tatico/dashboard` is
  provably caused by the click and not by an earlier mount.
- The click path is the real one. `Entrar` is `SignedOutPanel`'s button; its `onSignIn` sets
  `signInRequested` and bumps `guardTick`, which re-arms the login effect, which calls
  `captureReturnTo(currentPath, currentOrigin())` and then `login()`. The test asserts
  `login` was called exactly once, so the whole path executed rather than just the storage write.

## 6. Scope and rules

`git diff --stat master..HEAD`:

```
 apps/web/src/sales-ops/SalesOpsApp.tsx             |  42 ++-
 .../__tests__/session-loss-keeps-route.test.tsx    | 396 +++++++++++++++++++++
 .../slice-02-notes.md                              | 146 ++++++++
 3 files changed, 582 insertions(+), 2 deletions(-)
```

- Only the implementation file, the new test, and run notes under `nexo/runs/`. In scope.
- No edits to `apps/web/src/auth/react.tsx`, `apps/web/src/auth/session-recovery.ts`,
  `apps/web/src/router.tsx` or `apps/web/src/sales-ops/navigation.ts`. Confirmed absent from the
  diffstat.
- The production change is 4 functional lines plus comments: one derived constant and one added
  term on each of two conditions. Nothing below line 1289 was touched, so the fallthrough render
  reasoning in the plan holds by construction rather than by inspection.
- Commit messages carry no agent attribution. Author is `CauetPinciara <cauetpinciara@gmail.com>` on
  both commits.
- Em dash check, `git diff master..HEAD | grep -n '—'`: ONE hit.

  ```
  600:+No em dash in either touched file (`grep -n "—"` returns nothing).
  ```

  Per-file greps confirm the hit is in `nexo/runs/.../slice-02-notes.md` only.
  `apps/web/src/sales-ops/SalesOpsApp.tsx` and the new test file are both clean.

  Assessment: a documentation nit, not a functional violation, and deliberately not treated as a gate
  failure. The character appears inside run-notes prose that is quoting the grep pattern being
  described, it ships in no artifact, and the two files the rule is aimed at contain none. It is
  nonetheless self-contradictory prose and the notes line should be reworded, for example to
  "no em dash in either touched file". Flagged for the human to decide.

## Findings summary

No blocking defects.

Two non-blocking observations, both recorded above:

1. Every session-loss scenario in the new file enters at `/tatico/dashboard`. That is the one route
   where the second guard's URL-rewrite half is masked by a self-navigation, so that half is caught
   only indirectly, through the mount oracle. A sixth test at a non-`tatico` entry would pin it
   directly. Proven reachable by the scratch probe under M3 above.
2. One em dash in `slice-02-notes.md`, in a sentence asserting there are none.

The fix does what it claims. It suppresses two navigations and nothing else, the subtree provably
survives, and the single test that catches a relocated unmount is a real oracle rather than an
incidental one.
