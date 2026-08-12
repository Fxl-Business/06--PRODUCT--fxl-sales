# Slice 04 - `/no-role` redirects when entitled

Plan: `nexo/plans/feature-20260812-session-survives-one-refresh/04-no-role-redirects-when-entitled.md`
Branch: `fix/04-no-role-redirects-when-entitled`

## What changed

Three files, exactly the plan's `files_modified` list and nothing else.

`apps/web/src/components/auth/RoleGuard.tsx`
Added one import (`getVisibleWorkspaces` from `@/sales-ops/navigation`) and one exported component, `NoRoleGuard`, appended after `RoleRouter` with the plan's docstring verbatim.
`RoleGuard` and `RoleRouter` are byte-unchanged.
The condition is `getVisibleWorkspaces(roles).length > 0`, the literal complement of the `visibleWorkspaceIds.length === 0` branch at `apps/web/src/sales-ops/SalesOpsApp.tsx:1274`, evaluated by the same function over the same `useAuthProfile()` value.
`!isLoaded` renders the same `Skeleton className="h-screen w-full"` as the two guards above it.

`apps/web/src/router.tsx`
Import widened to `import { NoRoleGuard, RoleGuard } from './components/auth/RoleGuard';`, and `NoRolePage` wrapped in `NoRoleGuard` INSIDE `Protected`.
The route count and the `errorElement` count are unchanged, so the existing source pin in `route-error-and-auth-context.test.tsx` stays green (it does: 51 web files, 708 tests, all passing).

`apps/web/src/__tests__/no-role-redirect.test.tsx`
New, created from the plan's listing without deviation. 26 tests.

Nothing else was touched.
`SalesOpsApp.tsx`, `session-recovery.ts`, `react.tsx`, `NoRolePage.tsx`, `navigation.ts`, every i18n file, `CLAUDE.md` and `nexo/ROADMAP.md` are all unmodified.

## Red before the fix

The test file was written first.
With no `NoRoleGuard` export at all, all six render tests failed on an invalid React element type rather than on their own assertions, so a minimal stub (`({ children }) => <>{children}</>`, i.e. today's behaviour) was added to make the individual verdicts visible.
That reproduced the plan's predicted table exactly:

```
 × sends a ["admin","seller","finder"] operator from /no-role to /tatico/dashboard in exactly two navigations
 × sends a ["seller"] operator from /no-role to /meus-dados/vendedores in exactly two navigations
 × sends a ["finder"] operator from /no-role to /meus-dados/finders in exactly two navigations
 ✓ keeps the unauthorized screen for an operator with zero recognized roles
 ✓ keeps the unauthorized screen for a role the app does not recognize, and does not ping-pong
 × renders neither the unauthorized screen nor a navigation while the profile is still loading
 × router wiring > router.tsx wraps NoRolePage in NoRoleGuard inside Protected

 Test Files  1 failed (1)
      Tests  5 failed | 21 passed (26)
```

Five red, and the two over-correction guards green on both sides, which is what the plan's "which of these fail on current code" table specifies.
The stub was removed when the real component went in; it exists nowhere in the committed tree.

## Mutation proof

Condition changed from `getVisibleWorkspaces(roles).length > 0` to `roles.length > 0`, nothing else:

```
 FAIL  src/__tests__/no-role-redirect.test.tsx > /no-role is not a dead end for an entitled
       operator > keeps the unauthorized screen for a role the app does not recognize, and
       does not ping-pong
Error: redirect loop: /no-role -> / -> /no-role -> / -> /no-role -> / -> /no-role
 ❯ src/__tests__/no-role-redirect.test.tsx:118:13
 ❯ commitHookEffectListMount react-dom.development.js:23189:26

 Test Files  1 failed (1)
      Tests  2 failed | 24 passed (26)
```

That is the named oracle going red with the exact failure the plan predicted, and it prints the cycle rather than hanging.
The second reported failure (`renders neither the unauthorized screen nor a navigation while the profile is still loading`, `Error: Should not already be working.`) is collateral: the loop test's throw escapes React's act queue and poisons the next test in the file.
It is not an independent verdict and it disappears with the mutation.
Note that the three positive redirect cases and the zero-roles case all STAY GREEN under the mutation, which is the point: only this one test separates the two conditions.

Condition restored, and the file re-run green before anything else was done.

## Final green

```
pnpm --filter @fxl-sales/web exec vitest run src/__tests__/no-role-redirect.test.tsx
  Test Files  1 passed (1)
       Tests  26 passed (26)

pnpm --filter @fxl-sales/web test
  Test Files  51 passed (51)
       Tests  708 passed (708)

pnpm run lint            apps/api Done, apps/web Done
pnpm run type-check      shared-types, shared-utils, apps/api, apps/web all Done
pnpm test                api 41 files / 415 tests, shared-utils 3 files / 80 tests,
                         web 51 files / 708 tests, build-contract: ok
```

`type-check` genuinely evaluates the `Record<AppRole, true>` exhaustiveness guard: `apps/web/tsconfig.json` has `"include": ["src/**/*", "vite.config.ts"]`, so the new test file is inside the program.

No processes were left running; every command was a run-once invocation.

## Disagreement

None. The plan was followed literally.

Two observations for the record, neither of which changed anything:

1. `SalesOpsApp`'s no-role branch is now `visibleWorkspaceIds.length === 0 && rolesAreAuthoritative`, where slice 02 added `rolesAreAuthoritative = profile.isSignedIn`. The plan quotes the pre-slice-02 form at line 188. This makes the exclusivity proof strictly STRONGER, not weaker: `SalesOpsApp` now navigates on a proper subset of the states it used to, while `NoRoleGuard` still navigates on the exact complement of the workspace predicate, so the two still cannot both want to navigate. The test harness mocks `isSignedIn: profileLoaded`, so the live branch is the one exercised.
2. The plan's `files_modified` correctly excludes `CLAUDE.md`. The "Sales Ops Routing" bullet that says to keep `/no-role` unchanged is now inaccurate; the replacement wording is drafted in the plan's "The CLAUDE.md exception, stated up front" section and belongs to the feature's Capture step.
