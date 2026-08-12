# Verify report - slice 04, `/no-role` redirects when entitled

Branch under test: `fix/04-no-role-redirects-when-entitled` at `08f4cb7`.
Verifier did not write this code, did not read `slice-04-notes.md`, and fixed nothing.

**Verdict: PASS.**

## 1. The gate, run first-hand

All run-once. No watcher was started and no process was left running.

### `pnpm --filter @fxl-sales/web exec vitest run src/__tests__/no-role-redirect.test.tsx`

```
 RUN  v3.2.7 /Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales/apps/web

 ✓ src/__tests__/no-role-redirect.test.tsx (26 tests) 41ms

 Test Files  1 passed (1)
      Tests  26 passed (26)
   Duration  978ms
```

### `pnpm --filter @fxl-sales/web test`

```
 Test Files  51 passed (51)
      Tests  708 passed (708)
   Duration  6.28s
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

Not optional, as the plan says: the test's `const ROLE_COVERAGE: Record<AppRole, true>` is a compile-time exhaustiveness assertion that vitest alone never evaluates.
It compiles, so the `NON_EMPTY_ROLE_SETS` sweep really does enumerate the whole `AppRole` union rather than a stale hand-written subset.

### `pnpm test` (the full documented gate, run for completeness)

```
packages/shared-utils test:  Test Files  3 passed (3)   Tests  80 passed (80)
apps/api test:               Test Files 41 passed (41)  Tests 415 passed (415)
apps/web test:               Test Files 51 passed (51)  Tests 708 passed (708)
build-contract: ok
```

The tracked-file guard (`build-contract: ok`) passes.

## 2. THE CENTRAL QUESTION: can this guard ping-pong with `SalesOpsApp`?

### The two conditions as they actually stand

Guard, `apps/web/src/components/auth/RoleGuard.tsx:64-77`:

```tsx
export function NoRoleGuard({ children }: { children: React.ReactNode }) {
  const { isLoaded, roles } = useAuthProfile();
  if (!isLoaded) return <Skeleton className="h-screen w-full" />;
  if (getVisibleWorkspaces(roles).length > 0) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}
```

`SalesOpsApp`, `apps/web/src/sales-ops/SalesOpsApp.tsx:1272-1276` - note this does NOT match the version quoted in the plan, because slice 02 on this same branch added the `rolesAreAuthoritative` term:

```tsx
const rolesAreAuthoritative = profile.isSignedIn;

if (visibleWorkspaceIds.length === 0 && rolesAreAuthoritative) {
  return <Navigate to="/no-role" replace />;
}
```

with `visibleWorkspaceIds = useMemo(() => getVisibleWorkspaces(profile.roles), [profile.roles])` at `:1036-1039`.

### My own exclusivity proof

Let `V = getVisibleWorkspaces(profile.roles)` and let `S = profile.isSignedIn`, both read from the one `useAuthProfile()` / `useHubAuthContext()` context value in the same render pass.

- `SalesOpsApp` navigates to `/no-role` iff `|V| = 0 AND S`.
- `NoRoleGuard` navigates to `/` iff `isLoaded AND |V| > 0`.

The two navigation predicates carry `|V| = 0` and `|V| > 0` respectively.
Those are complements over the integers, so their conjunction is empty regardless of what `S`, `isLoaded` or `roles` are.
At most one of the two guards can ever want to navigate, for every possible value of `profile.roles`, including values `AppRole` does not currently admit.

Three things make that a real proof rather than a restatement of the plan's:

1. **Same function, same argument.** Both sides call the identical exported `getVisibleWorkspaces` from `apps/web/src/sales-ops/navigation.ts:95` over `profile.roles`. There is no second expression of the predicate to drift. The guard's import is the first `components/auth` to `sales-ops` edge in the app; I confirmed `navigation.ts` imports only `lucide-react` and a type-only `AppRole`, and that nothing under `sales-ops/` imports `components/auth`, so no cycle exists.
2. **The `rolesAreAuthoritative` term does not weaken it, it strengthens it.** Slice 02 added a conjunct to the `SalesOpsApp` side only. Adding a conjunct can only make that side fire strictly less often, so an exclusivity that held without it holds a fortiori with it. Crucially it was added to the side that would have to fire *simultaneously*; had it been added to the guard instead, the analysis would be the same, because the disjointness lives entirely in the `|V|` term.
3. **The reverse direction terminates too.** At `/` with `|V| = 0` and signed in, `SalesOpsApp` sends the operator to `/no-role`; there the guard sees `|V| = 0` and renders `NoRolePage`. Chain length 1, stop.

Forward termination, checked rather than assumed: from `/no-role` with `|V| > 0`, the guard replaces to `/`; `SalesOpsApp` at `/` skips the no-role branch, hits `resolution.redirect === true` (no workspace param) and replaces to `buildSalesOpsPath(getDefaultSalesOpsRoute(roles))`; that path matches `/:workspace/:view`, where `resolveSalesOpsRoute` now finds both parts and returns `redirect: false`, so it renders. Exactly three locations, then stop. The `{ workspace: 'tatico', view: 'dashboard' }` fallback in `getDefaultSalesOpsRoute` - the one route that would resolve back to itself with `redirect: true` - is unreachable from here, because the guard only navigates when `|V| > 0`. The `the default route for %j is canonical` sweep in the test pins that for all seven non-empty role sets.

**No other navigator can join the cycle.** I grepped every `/no-role` navigation in `apps/web/src`: `SalesOpsApp.tsx:1275`, `RoleGuard.tsx:19` (`RoleGuard`) and `RoleGuard.tsx:34` (`RoleRouter`). `RoleRouter` is dead code - it is referenced nowhere outside its own declaration and one comment in `NoRolePage.tsx`. `RoleGuard` guards `/admin`, `/finder` and `/seller`, and nothing in the chain above ever navigates back into a legacy tree, so the seller-opens-`/admin/apps` case is a strictly forward chain of three: `/admin/apps` -> `/no-role` -> `/` -> `/meus-dados/vendedores`.

**Conclusion: exclusivity genuinely holds, by construction and not by arithmetic over today's role union.**

### Mutation A: `getVisibleWorkspaces(roles).length > 0` becomes `roles.length > 0`

Applied to `apps/web/src/components/auth/RoleGuard.tsx:72`, then re-ran the slice test.

```
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/__tests__/no-role-redirect.test.tsx > /no-role is not a dead end for an entitled operator >
       keeps the unauthorized screen for a role the app does not recognize, and does not ping-pong
Error: redirect loop: /no-role -> / -> /no-role -> / -> /no-role -> / -> /no-role
 ❯ src/__tests__/no-role-redirect.test.tsx:118:13

 Test Files  1 failed (1)
      Tests  2 failed | 24 passed (26)
```

**The test that fires is `keeps the unauthorized screen for a role the app does not recognize, and does not ping-pong`, and it fires with exactly the redirect-loop error the plan predicted**, naming the cycle rather than timing out.
It is the only genuine oracle: it is the sole test whose fixture (`profileRoles = ['viewer' as AppRole]`) separates the two predicates.
The second reported failure, `renders neither the unauthorized screen nor a navigation while the profile is still loading` with `Error: Should not already be working`, is React act-queue collateral from the throw inside the previous test's passive-effect flush, not an independent oracle. Neither lint nor type-check catches this mutation, so that one test carries the whole condition choice - and it does carry it.

Worth recording for the loop analysis: the loop reproduces even though `SalesOpsApp` now carries `rolesAreAuthoritative`, because the test's auth mock returns `isSignedIn: profileLoaded`, which is `true` in that case. The slice-02 term therefore does not accidentally disarm this oracle.

### Mutation B: redirect unconditionally (over-correction, item 3)

Condition replaced with `if (true)`.

```
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  ... > keeps the unauthorized screen for an operator with zero recognized roles
Error: redirect loop: /no-role -> / -> /no-role -> / -> /no-role -> / -> /no-role
 FAIL  ... > keeps the unauthorized screen for a role the app does not recognize, and does not ping-pong
 FAIL  ... > renders neither the unauthorized screen nor a navigation while the profile is still loading

 Test Files  1 failed (1)
      Tests  3 failed | 23 passed (26)
```

`keeps the unauthorized screen for an operator with zero recognized roles` is red, so item 3 is satisfied: an operator with genuinely zero recognized roles still sees `Acesso nao autorizado`, and a fix that is too broad is caught.

### Mutation C: drop the `!isLoaded` branch (item 6)

```
 FAIL  ... > renders neither the unauthorized screen nor a navigation while the profile is still loading
AssertionError: expected [ '/no-role', '/' ] to deeply equal [ '/no-role' ]

 Test Files  1 failed (1)
      Tests  1 failed | 25 passed (26)
```

The loading state is pinned by a real oracle too. While the profile is unresolved the guard renders the `Skeleton` (`container.querySelector('.animate-pulse')` is non-null), so neither the unauthorized copy nor a navigation happens.

### Restoration, proven

`apps/web/src/components/auth/RoleGuard.tsx` was backed up before the first mutation and restored from that copy after each.

```
$ git hash-object apps/web/src/components/auth/RoleGuard.tsx
c01c8f49699fa0415ee535590136658eb52503f8   # identical to the pre-mutation hash

$ git diff --stat
 nexo/runs/feature-20260812-session-survives-one-refresh/budget.json | 5 +++--
 1 file changed, 3 insertions(+), 2 deletions(-)
```

No source file carries an uncommitted change. `budget.json` was already modified before this verification began (it is nexo bookkeeping, not source), as was the untracked `agents/execute-04.result.json`.

## 3. The signed-out interaction (item 4) - inert, and I checked it rather than assuming it

`HubProtected` has exactly one branch that mounts `children` while not signed in: `liveSessionLoss` at `apps/web/src/auth/react.tsx:813`, which renders `{children}` plus the `fixed inset-0` overlay carrying `Sua sessao expirou`. `logoutIntent` (`:785`), `loginBlocked` (`:839`) and the `!isLoaded || !isSignedIn` Skeleton (`:852`) all return before `children`, so the guard is not even mounted in those states.

In that one branch, what does the guard see? `applyToken` at `apps/web/src/auth/react.tsx:261-272` writes

```tsx
const next = profileFromToken(token);
setProfile({ isLoaded: true, isSignedIn: token !== null, ..., roles: next.roles, ... });
```

and `profileFromToken(null)` returns `{ roles: [], workspaces: [] }` at `:152-154`.
`roles` and `isSignedIn` are written in ONE `setProfile` call, so they can never be committed out of step: a signed-out profile always reports `roles: []`.

Therefore at `/no-role` under a live loss: `isLoaded` is `true` so the Skeleton branch does not fire; `getVisibleWorkspaces([]).length > 0` is `false` so the guard does NOT navigate; `NoRolePage` renders underneath the overlay. **The guard is inert during a live session loss.**

**I could not construct a case where a session loss at `/no-role` causes a navigation.** It would require `|V| > 0` while signed out, which requires non-empty `roles` while `isSignedIn` is false, which the single-`setProfile` write above makes unreachable. The only remaining way in would be a stale render between the two, and there is none, because they ride the same state object.

## 4. Nesting (item 5)

`apps/web/src/router.tsx:144-154` puts `NoRoleGuard` INSIDE `Protected`:

```jsx
element: (
  <Protected>
    <NoRoleGuard>
      <NoRolePage />
    </NoRoleGuard>
  </Protected>
),
```

Same nesting the three legacy trees already use for `RoleGuard`. It is pinned by the source test `router.tsx wraps NoRolePage in NoRoleGuard inside Protected`, whose regex `/<Protected>\s*<NoRoleGuard>\s*<NoRolePage \/>\s*<\/NoRoleGuard>\s*<\/Protected>/` would not match if the two wrappers were swapped.

## 5. Scope and rules (item 7)

```
$ git diff --stat master..HEAD
 apps/web/src/__tests__/no-role-redirect.test.tsx   | 283 +++++++++++++++++++++
 apps/web/src/components/auth/RoleGuard.tsx         |  43 ++++
 apps/web/src/router.tsx                            |   6 +-
 .../slice-04-notes.md                              |  99 +++++++
 4 files changed, 429 insertions(+), 2 deletions(-)
```

Exactly `RoleGuard.tsx`, `router.tsx`, the new test, and run notes under `nexo/runs/`. Nothing else - in particular `SalesOpsApp.tsx`, `session-recovery.ts`, `auth/react.tsx`, `NoRolePage.tsx`, `navigation.ts`, the i18n files and `CLAUDE.md` are all untouched, as the plan's boundary requires.

- **`RoleGuard` and `RoleRouter` unchanged.** The `RoleGuard.tsx` diff is `+43 / -0`: one added import line and one appended component. Both existing functions are outside the hunks.
- **Route count unchanged.** 7 top-level route objects and 6 `errorElement: <RouteErrorPage />` entries on both `master` and `HEAD`.
- **No em dash characters in the diff.** Grepping the U+2014 character across `git diff master..HEAD` returns nothing.
- **No agent attribution.** The single commit `08f4cb7` is authored `CauetPinciara <cauetpinciara@gmail.com>` and carries no trailers at all, so no co-author line was added.

The one documented rules tension is the CLAUDE.md line "Keep the static legacy route trees `/admin/*`, `/finder/*`, `/seller/*`, and `/no-role` unchanged". The plan takes that exception deliberately and in writing, scoped to `/no-role` alone, and correctly defers the CLAUDE.md wording to the feature's Capture step rather than editing it here. No path, shell, guard or page copy changed; only one wrapper element was added. I accept that as in scope for this slice, and flag that **the Capture step still owes the CLAUDE.md amendment drafted in the plan** - without it a later reader reads the router diff as a violation.

## Verdict

**PASS.**

The gate is green first-hand, including `type-check`, which the compile-time exhaustiveness guard needs.
Exclusivity between `NoRoleGuard` and the `SalesOpsApp` no-role redirect holds by construction over complementary predicates on the same function's output, and survives the `rolesAreAuthoritative` term slice 02 added.
The `roles.length > 0` mutation is caught, by `keeps the unauthorized screen for a role the app does not recognize, and does not ping-pong`, with the predicted redirect-loop error.
An unconditional redirect and a dropped loading guard are each caught by their own test.
The guard is inert during a live session loss, sits inside `Protected` with a source pin, and the diff is in scope with no em dashes and no agent attribution.
