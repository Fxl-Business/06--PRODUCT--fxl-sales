---
id: 04-no-role-redirects-when-entitled
milestone: v2.8.0
status: done
depends_on: []
files_modified:
  - apps/web/src/components/auth/RoleGuard.tsx
  - apps/web/src/router.tsx
  - apps/web/src/__tests__/no-role-redirect.test.tsx
acceptance: "given an operator who holds at least one recognized role lands on /no-role, when the profile has loaded, then they are redirected to / instead of seeing Acesso nao autorizado"
goal: Make /no-role self-correcting so an entitled operator is never stranded on it.
must_not_break:
  - an operator with genuinely zero recognized roles still sees the unauthorized screen
  - the legacy /admin, /finder and /seller RoleGuard redirects
  - the signed-out overlay path, where roles are empty and nothing should navigate
rules:
  - must not be able to ping-pong with the SalesOpsApp no-role redirect
  - do not touch SalesOpsApp.tsx or session-recovery.ts
  - no em dashes anywhere
verifier_focus: the redirect-loop proof between this guard and the SalesOpsApp visibleWorkspaceIds redirect, and that a genuinely role-less operator still sees the unauthorized screen
---

# 04 - `/no-role` redirects when entitled

## Context

`apps/web/src/router.tsx:144-152` is the whole `/no-role` route:

```jsx
{
  path: '/no-role',
  errorElement: <RouteErrorPage />,
  element: (
    <Protected>
      <NoRolePage />
    </Protected>
  ),
},
```

`NoRolePage` (`apps/web/src/pages/errors/NoRolePage.tsx`) renders `errors.noRole.title`, which is `Acesso não autorizado` in `apps/web/src/i18n/pt-BR.json:19`, unconditionally.
It reads `useLogout` and nothing else from auth.
It never asks whether the operator actually holds roles.

That is dead end C in `00-OVERVIEW.md`.
An operator who lands on `/no-role` for any reason and then signs in successfully still sees the unauthorized screen while holding full admin, seller and finder roles, with no way out except retyping a URL by hand.
That is exactly what the production report showed: after clicking `Entrar` the operator reached `/no-role` and read `Acesso não autorizado` while fully entitled.

Slices 02 and 03 stop `/no-role` from being reached and from being restored in the session-loss path.
This slice makes the screen itself self-correcting, which is defence in depth for that path and is also the only fix for a second, pre-existing and completely independent way in.

That second way in is the legacy trees.
`RoleGuard` in `apps/web/src/components/auth/RoleGuard.tsx:17-19` sends anyone lacking a tree's role to `/no-role` with `replace`.
So a seller who merely opens an `/admin/*` URL is bounced to `/no-role` and is then stranded there, even though they have a perfectly good `meus-dados` workspace one hop away.
Nothing in slice 02 or slice 03 touches that case.

## The CLAUDE.md exception, stated up front

CLAUDE.md, "Sales Ops Routing", last bullet:

> Keep the static legacy route trees `/admin/*`, `/finder/*`, `/seller/*`, and `/no-role` unchanged.

**This slice deliberately breaks that rule for `/no-role`, and only for `/no-role`.**
A later reader will otherwise read the router diff as a violation, so the justification is recorded here rather than left to be reconstructed.

What that rule protects is the SHAPE of those trees.
It was written while Sales Ops was being built alongside four legacy shells, and it exists to stop the legacy paths being renamed, re-parented, folded into the `/:workspace/:view` scheme, or quietly deleted while a migration was half done.
Read that way, this change is inside the rule rather than outside it:

- No path is added, removed or renamed. The route table still has exactly the same seven top-level entries.
- No shell changes. `AdminShell`, `FinderShell` and `SellerShell` are untouched.
- `RoleGuard` itself is untouched, so the three legacy redirects into `/no-role` behave byte for byte as they do today.
- `NoRolePage` is untouched. Its markup, its copy and its `Sair` button are unchanged, and it still renders for the operator the screen is actually for.

What does change is one wrapper element around `NoRolePage`, and only the behaviour of an operator who should never have been shown that screen in the first place.

The rule cannot be read as protecting the dead end itself, for two reasons.
First, the same CLAUDE.md section already states the intended semantics of the screen four bullets earlier: "Zero recognized roles keeps `/no-role`."
"Zero recognized roles" is a condition, and a screen that never evaluates it is not implementing that sentence, it is only accidentally agreeing with it in one case out of two.
Second, `00-OVERVIEW.md` acceptance criterion 4 for this feature is "`/no-role` is never a dead end for an operator who holds roles", which is a deliberate, human-approved decision taken after that rule was written.

**Capture step, not this slice.**
`files_modified` above is authoritative and does not include `CLAUDE.md`, so the executor must not edit it.
At the feature's Capture step, replace that bullet with:

> - Keep the static legacy route trees `/admin/*`, `/finder/*`, `/seller/*` and `/no-role` unchanged, with ONE exception: `/no-role`'s element is wrapped in `NoRoleGuard`, which redirects to `/` as soon as `getVisibleWorkspaces(profile.roles)` is non-empty.
>   The rule protects the SHAPE of those trees, meaning their paths, their shells and their role guards, and not the dead end.
>   `NoRolePage` and its copy are untouched and still render for an operator with no visible workspace.
>   The guard's condition is the exact complement of the `visibleWorkspaceIds.length === 0` redirect in `SalesOpsApp`, evaluated by the same function over the same profile, so the two cannot ping-pong.

## Boundary

IN: the `/no-role` route element, and one new exported component beside `RoleGuard`.

OUT, owned by slice 02: `apps/web/src/sales-ops/SalesOpsApp.tsx`.
This slice reads its `visibleWorkspaceIds.length === 0` branch and depends on it, mounts it in a test, and must not edit a character of it.

OUT, owned by slice 03: `apps/web/src/auth/session-recovery.ts`.
Nothing here reads `captureReturnTo`, `consumeReturnTo` or `sanitizeReturnTo`.

OUT: `apps/web/src/auth/react.tsx`.
`Protected`, the live-loss overlay and the login effect are all read here and none is edited.

OUT: `RoleGuard`, `RoleRouter`, `NoRolePage`, `apps/web/src/sales-ops/navigation.ts`, and every i18n string.

## Design decisions

### 1. Where the guard goes

**Decision: a new exported `NoRoleGuard` in `apps/web/src/components/auth/RoleGuard.tsx`, wrapped around `NoRolePage` in `router.tsx`.**

Three options were live.

*Inside `NoRolePage`.*
Rejected.
`NoRolePage` is a presentational error page in `apps/web/src/pages/errors/`, sitting beside `RouteErrorPage`, and its whole job is to render one message and one `Sair` button.
Putting a `<Navigate>` inside it means the component named "the unauthorized screen" is the component that decides not to be the unauthorized screen, which is the sort of hidden control flow that made this bug survivable in the first place.
It also makes the redirect invisible from the route table, and it makes the component untestable as a pure screen.

*Inline in `router.tsx`.*
Rejected.
The guard needs `useAuthProfile()`, so "inline" really means declaring a component inside the route module.
`router.tsx` is a route table with a `/* eslint-disable react-refresh/only-export-components */` at the top precisely because it is not a component module, and a component declared there would be the only one.

*A sibling in `RoleGuard.tsx`.*
**Chosen.**
`RoleGuard` is the component that sends operators INTO `/no-role`; the component that lets them out belongs directly beneath it, in the same file, so that a reader who finds one immediately sees the other.
The file already imports every symbol the new guard needs except one: `Navigate` from `react-router-dom`, `Skeleton` from `@/components/ui/skeleton`, `useAuthProfile` from `@/auth/react`.
`RoleRouter` already establishes that this file holds redirect-only components as well as gates, so the third export is not a new kind of thing.
The file-level docstring convention there ("Role gate (Phase 03 T09) ... UX-only") gives the new component an obvious place to say what it is.

The one new import is `getVisibleWorkspaces` from `@/sales-ops/navigation`.
That is the first `components/auth` to `sales-ops` edge in the app, so state why it is safe:

- `apps/web/src/sales-ops/navigation.ts` imports only `lucide-react` and `@/auth/claims` (a type-only import of `AppRole`), and `claims.ts` imports nothing local at all. There is no cycle and there cannot be one, because nothing in the `sales-ops` tree imports `components/auth`.
- There is no bundle cost. `router.tsx` already imports both `./components/auth/RoleGuard` and `./sales-ops/SalesOpsApp` eagerly, in the same module, so both trees are already in the entry chunk together.
- Reaching for the same function `SalesOpsApp` uses is the entire point, and section 4 below is why. A local re-implementation, or a thin `hasAnyWorkspace()` wrapper, would create a second expression of one predicate, which is the precise defect this slice is guarding against.

### 2. The loading state

**Decision: `if (!isLoaded) return <Skeleton className="h-screen w-full" />;`, character for character the same as `RoleGuard` and `RoleRouter` two functions above.**

`useAuthProfile()` exposes `isLoaded`, and `apps/web/src/components/auth/RoleGuard.tsx:15` and `:29` both already render exactly that Skeleton while it is false.
Matching them is not decoration.
Without the branch, a mounted `/no-role` with an unresolved profile would render `Acesso não autorizado` for however long the profile takes to arrive, and then redirect - a flash of the unauthorized screen at exactly the moment the operator is most likely to be watching, which is one frame after clicking `Entrar`.
The Skeleton is also what makes the "not yet loaded" oracle in section "The oracle" assertable: neither the copy nor a navigation is present.

Note that this branch is close to unreachable through `Protected` today, since `HubProtected` renders its own `Skeleton` while `!isLoaded` and does not mount `children`.
It is written anyway, because the guard must be correct as a component and not only as a component in one particular wrapper, and because the live-loss branch of `HubProtected` does mount `children` in a state the cold path never reaches.
Guarding on the profile the component itself reads is cheaper than reasoning about every caller.

### 3. The redirect target

**Decision: `<Navigate to="/" replace />`.**

`/` is `<Protected><SalesOpsApp /></Protected>` (`router.tsx:73-81`).
`SalesOpsApp` computes `resolveSalesOpsRoute(routeParams, profile.roles)` with empty route params, which in `apps/web/src/sales-ops/navigation.ts:179` finds no workspace, falls through to `getDefaultSalesOpsRoute(roles)` and returns `redirect: true`, and `SalesOpsApp.tsx:1249` then renders `<Navigate to={resolution.path} replace />`.

Traced through `getVisibleWorkspaces` and `getSalesOpsNavigation`, `/` lands each shape here:

| roles | visible workspaces | `/` settles on |
| --- | --- | --- |
| `['admin','seller','finder']` (what `getRolesFromHubClaims` returns for a Hub workspace owner or admin) | `tatico`, `operacional`, `cadastros`, `meus-dados` | `/tatico/dashboard` |
| `['admin']` alone | `tatico`, `operacional`, `cadastros` | `/tatico/dashboard` |
| `['seller']` | `meus-dados` | `/meus-dados/vendedores` |
| `['finder']` | `meus-dados` | `/meus-dados/finders` |
| `['seller','finder']` | `meus-dados` | `/meus-dados/vendedores` |

All five are sensible landings, and all five are pinned by a test in this slice.
Note the first row is what production actually produces: `getRolesFromHubClaims` in `apps/web/src/auth/claims.ts` returns the full triple for an owner or admin and never `['admin']` on its own, so the `['admin']` row is a robustness case rather than a live one.

`/` and not the resolved default path directly.
Computing `getDefaultSalesOpsRoute(roles)` inside the guard and navigating straight to `/meus-dados/vendedores` would save one hop, but it would put a second copy of "where does this operator belong" outside `SalesOpsApp`, which slice 02 owns and which this slice must not touch.
`/` is already the app's single documented entry point for exactly that question.
One extra `replace` hop, invisible in the address bar, is the right price.

`replace` and not a push, on both hops.
The dead end must not be reachable by pressing Back.
With `replace` at the guard and `replace` inside `SalesOpsApp`, the history entry that held `/no-role` is overwritten first by `/` and then by the final route, so Back goes to whatever preceded `/no-role` and the entry is gone.
`RoleGuard`'s own redirect into `/no-role` also uses `replace`, so for the legacy case the `/admin/*` URL was already overwritten and Back walks past both.

### 4. The loop proof

This is the single most important part of the slice.

Two guards now navigate on the same fact, in opposite directions:

- `SalesOpsApp.tsx:1245-1247`: at `/` or `/:workspace/:view`, `if (visibleWorkspaceIds.length === 0) return <Navigate to="/no-role" replace />;` where `visibleWorkspaceIds` is `getVisibleWorkspaces(profile.roles)`.
- This slice, at `/no-role`: navigate to `/` when the operator is entitled.

If both conditions can be true for one operator, the app renders `/` then `/no-role` then `/` forever.
Under React 18 that is not a browser history loop, because both use `replace`; it is an unbounded effect-driven re-render, which surfaces as a hung tab or as `Maximum update depth exceeded`.
So the two conditions must be provably exclusive.

**Decision: the guard's condition is `getVisibleWorkspaces(roles).length > 0`, NOT `roles.length > 0`.**

First, the question the brief asks: does "has at least one recognized role" imply "has at least one visible workspace"?

Walk `getVisibleWorkspaces` (`apps/web/src/sales-ops/navigation.ts:95-105`):

```ts
export function getVisibleWorkspaces(roles: readonly AppRole[]): SalesOpsWorkspace[] {
  const roleSet = new Set(roles);
  const visible: SalesOpsWorkspace[] = [];
  if (roleSet.has('admin')) {
    visible.push('tatico', 'operacional', 'cadastros');
  }
  if (roleSet.has('seller') || roleSet.has('finder')) {
    visible.push('meus-dados');
  }
  return visible;
}
```

`AppRole` is `'admin' | 'finder' | 'seller'` (`apps/web/src/auth/claims.ts:1`).
Every non-empty subset of that union contains `admin`, or `seller`, or `finder`, and each of the three branches pushes at least one workspace.
So today the implication DOES hold, for all seven non-empty subsets, and `roles.length > 0` would in fact be correct.

It is still the wrong condition, for three reasons, and the third one alone settles it.

1. `profile.roles` is typed `AppRole[]` but is produced at runtime from a JWT. Today `getRolesFromHubClaims` filters to known literals, so nothing unrecognized can get through, but that is a property of a different file that this guard would be silently depending on.
2. The implication is a property of the current body of `getVisibleWorkspaces`. It is not written down anywhere, nothing enforces it, and it is not the kind of thing a future edit would think to check.
3. Decisively: the two conditions would be two DIFFERENT expressions, in two different files, of one fact. The day `AppRole` gains a member that `getVisibleWorkspaces` maps to no workspace - a `'viewer'`, an `'auditor'`, a read-only role, any of which is an ordinary thing to add - `roles.length > 0` is true and `visibleWorkspaceIds.length === 0` is also true, and the app locks into an infinite `/` to `/no-role` ping-pong for that operator. The failure is total for the affected user and the cause is two files away from the change that caused it.

With `getVisibleWorkspaces(roles).length > 0` the proof is structural rather than arithmetic, and it takes one line:

> Let `V = getVisibleWorkspaces(profile.roles)`.
> `SalesOpsApp` navigates to `/no-role` if and only if `V.length === 0`.
> `NoRoleGuard` navigates to `/` if and only if `V.length > 0`.
> Both call the same function with the same argument, in the same render pass, reading the same `useAuthProfile()` context value.
> `V.length === 0` and `V.length > 0` are complements, so at most one of the two guards ever navigates, for every possible value of `profile.roles`, including values `AppRole` does not currently admit.

That is why the guard keys on visible workspaces and not on raw roles: it is not that the role-based condition is wrong today, it is that only the workspace-based one CANNOT become wrong.

Two follow-on questions, both of which the proof leaves open and which the plan closes explicitly.

**Does the second hop terminate?**
Yes, in one more step, and the chain is exactly two navigations long.
`/no-role` navigates to `/`.
`SalesOpsApp` at `/` has `V.length > 0`, so it skips the no-role branch, finds `resolution.redirect === true` (no workspace param), and navigates to `buildSalesOpsPath(getDefaultSalesOpsRoute(roles))`.
That path matches `/:workspace/:view`, which mounts `SalesOpsApp` again; `resolveSalesOpsRoute` now finds both the workspace and the view in `getVisibleWorkspaces` / `getSalesOpsNavigation`, and `redirect` is `view !== params.view`, which is `false` for a default route because the default is drawn from the same nav list.
So it renders.
Final sequence from `/no-role`: `/no-role` then `/` then `/{workspace}/{view}`, and stop.
There is one deliberate exception to "the default is canonical", and it is not reachable here: `getDefaultSalesOpsRoute` falls back to `{ workspace: 'tatico', view: 'dashboard' }` when `visible` is empty, which for an operator with no roles is NOT visible and would resolve back to itself with `redirect: true`.
That fallback is unreachable from this guard, because the guard only navigates when `V.length > 0`, and it is unreachable from `SalesOpsApp` too, because the `visibleWorkspaceIds.length === 0` branch returns above the resolution branch.
A test pins that the default route is canonical for every non-empty role set, so this stays true.

**Does the guard loop with `RoleGuard`?**
No.
Take the motivating legacy case: a seller opens `/admin/apps`.
`RoleGuard role="admin"` sees `roles` without `admin` and replaces to `/no-role`.
`NoRoleGuard` sees `V = ['meus-dados']` and replaces to `/`.
`SalesOpsApp` replaces to `/meus-dados/vendedores`, which renders.
Nothing re-enters `/admin/apps`, because no code path navigates back to a URL the operator typed; the chain is strictly forward and terminates in three navigations.
The same holds for `/finder/*` and `/seller/*`.

### 5. Interaction with a live session loss

The condition is inert while signed out, and this is checked rather than assumed.

`HubProtected` has exactly one branch that renders `children` while not signed in: the `liveSessionLoss` branch at `apps/web/src/auth/react.tsx:812`, which renders `{children}` plus a `fixed inset-0` overlay carrying `SignedOutPanel` ("Sua sessão expirou").
That branch is what CLAUDE.md calls "the only branch in that component that does not replace the subtree".
Every other signed-out branch (`logoutIntent`, `loginBlocked`, and the `!isLoaded || !isSignedIn` Skeleton) returns before `children` and unmounts the subtree entirely, so the guard is not even mounted.

In the live-loss branch, what does `useAuthProfile()` say?
`applyToken(null)` sets `setProfile({ isLoaded: true, isSignedIn: false, ... })` from `profileFromToken(null)`, and `profileFromToken` returns `{ roles: [], workspaces: [] }` for a null token (`apps/web/src/auth/react.tsx:148-155`).
So during a live loss the profile is LOADED with `roles: []`.

Therefore, at `/no-role` under a live loss:

- `!isLoaded` is false, so the Skeleton branch does not fire.
- `getVisibleWorkspaces([]).length > 0` is false, so the guard does NOT navigate.
- `NoRolePage` renders underneath the overlay, exactly as it does today, and the operator sees `Sua sessão expirou` on top of it.

That is the required behaviour: nothing navigates while the overlay is up, so the overlay cannot have the URL pulled out from under it.
It is also worth noting that the same reasoning shows this guard is not a fix for amplifier B - it is inert in precisely that state - which is why slices 02 and 03 exist and why this slice does not overlap them.

When the operator clicks `Entrar` and a token comes back, `roles` becomes non-empty in the same commit as `isSignedIn`, `V` becomes non-empty, and the guard fires on the next render.
That is the production symptom from `00-OVERVIEW.md`, fixed.

### 6. What the guard deliberately does not do

- It does not read, write or clear the return-to slot. That is slice 03's file.
- It does not touch the login attempt counter or the logout intent. An operator arriving at `/no-role` has a live session by definition of the branch that navigates.
- It does not render anything of its own besides the Skeleton and its children. There is no new copy and no i18n key.
- It is not applied to `/admin/*`, `/finder/*` or `/seller/*`. Those keep `RoleGuard` unchanged.

## The exact diff

### `apps/web/src/components/auth/RoleGuard.tsx`

Add one import and one exported component. Nothing else in the file changes.

```diff
 import { Navigate } from 'react-router-dom';
 import { Skeleton } from '@/components/ui/skeleton';
 import { useAuthProfile } from '@/auth/react';
+import { getVisibleWorkspaces } from '@/sales-ops/navigation';
 
 type Role = 'admin' | 'finder' | 'seller';
```

Append at the end of the file, after `RoleRouter`:

```tsx
/**
 * The way OUT of `/no-role`, and the exact complement of the redirect INTO it.
 *
 * `RoleGuard` above sends anyone lacking a legacy tree's role here, and `SalesOpsApp`
 * sends anyone with no visible workspace here, but until now nothing re-checked on
 * arrival: `NoRolePage` rendered `Acesso não autorizado` unconditionally. An operator
 * who reached this screen and then signed in successfully, or a seller who merely
 * opened an `/admin/*` URL, stayed on the unauthorized screen holding real roles with
 * no way out but retyping a URL by hand.
 *
 * The condition is `getVisibleWorkspaces(...).length > 0`, which is the LITERAL
 * negation of the `visibleWorkspaceIds.length === 0` test that `SalesOpsApp` redirects
 * here on, evaluated by the same function over the same `useAuthProfile()` value in the
 * same render pass. That is what makes a ping-pong between the two impossible by
 * construction rather than by argument: at most one of the two guards can ever want to
 * navigate, for any value of `roles` at all.
 *
 * Do NOT weaken it to `roles.length > 0`. The two predicates happen to agree for every
 * non-empty subset of today's `AppRole` union, and they would silently stop agreeing the
 * day a role is added that maps to no workspace. The failure mode is an infinite
 * `/` to `/no-role` redirect loop, two files away from the change that caused it.
 *
 * `!isLoaded` renders the same `Skeleton` as `RoleGuard`, so a profile that is still
 * resolving shows neither the unauthorized screen nor a navigation. While a session is
 * LOST the profile is loaded with `roles: []`, so this guard is inert and the children
 * `HubProtected` keeps mounted under its overlay stay exactly where they are.
 */
export function NoRoleGuard({ children }: { children: React.ReactNode }) {
  const { isLoaded, roles } = useAuthProfile();

  if (!isLoaded) return <Skeleton className="h-screen w-full" />;

  // `/` is `SalesOpsApp`, which resolves this operator's default workspace from these
  // same roles, so the landing decision stays in one place. `replace` so Back cannot
  // walk into the dead end again.
  if (getVisibleWorkspaces(roles).length > 0) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
```

`React.ReactNode` with no `React` import is correct here and matches `RoleGuard`'s existing signature on line 12.

### `apps/web/src/router.tsx`

```diff
-import { RoleGuard } from './components/auth/RoleGuard';
+import { NoRoleGuard, RoleGuard } from './components/auth/RoleGuard';
```

```diff
   {
     path: '/no-role',
     errorElement: <RouteErrorPage />,
     element: (
       <Protected>
-        <NoRolePage />
+        <NoRoleGuard>
+          <NoRolePage />
+        </NoRoleGuard>
       </Protected>
     ),
   },
```

`NoRoleGuard` goes INSIDE `Protected`, not outside, and the nesting order is load-bearing.
Outside, it would run against an unresolved profile on a cold entry, before `HubProtected`'s login effect has handed the browser to the Hub, and would be making a routing decision about a session that does not exist yet.
Inside, it only ever runs when `HubProtected` has decided to mount children, which is either a live signed-in session or the live-loss overlay - and section 5 shows it is inert in the second.
This is also the same nesting the three legacy trees already use for `RoleGuard`.

The route count and the `errorElement` count are both unchanged, so the existing source pin in `apps/web/src/__tests__/route-error-and-auth-context.test.tsx` ("router.tsx uses the @ alias for auth and mounts errorElement on every top-level route") stays green.

## The oracle

**Decision: a NEW file, `apps/web/src/__tests__/no-role-redirect.test.tsx`.**

Not an addition to `apps/web/src/__tests__/route-error-and-auth-context.test.tsx`.
That file is two things: a `RouteErrorPage` render test and a `dev-race regression contract` block of source pins.
It has no auth mock, no role fixture and no router harness.
Adding this suite there would require a module-scope `vi.mock('@/auth/react')`, which applies to the whole file and would change what its existing `RouteErrorPage` test exercises, and it would bury the most important invariant in this feature inside a file whose name says nothing about roles.
A new file whose name states the invariant is worth the ~60 lines of duplicated harness.

The harness is copied from `apps/web/src/sales-ops/__tests__/routing.test.tsx`, which already proves that `SalesOpsApp` mounts and routes under happy-dom with a mocked `@/auth/react` and a mocked `../hooks`.
Mounting the REAL `SalesOpsApp` next to the REAL `NoRoleGuard` is deliberate: it is the only way the loop question gets a genuine end-to-end answer rather than an answer about a stub the test wrote itself.
Mounting `SalesOpsApp` is not touching it, and this slice edits none of it.

Two notes on details that will otherwise cost the executor time:

- The copy carries an accent. The string to assert is `Acesso não autorizado`, from `apps/web/src/i18n/pt-BR.json:19`. The test imports `@/i18n` for its side effect so i18next is initialized; without it `useTranslation` renders the raw key and the assertions fail loudly, which is the desired self-check.
- `vi.mock('@/sales-ops/hooks', ...)` and `SalesOpsApp`'s own `import ... from './hooks'` resolve to the same absolute file, and vitest keys mock registrations by resolved path, so the alias form works from `src/__tests__/`.

### `apps/web/src/__tests__/no-role-redirect.test.tsx`

```tsx
// @vitest-environment happy-dom

import * as React from 'react';
import { useEffect } from 'react';
import type { HTMLAttributes } from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import type { AppRole } from '@/auth/claims';
import {
  buildSalesOpsPath,
  getDefaultSalesOpsRoute,
  getVisibleWorkspaces,
  resolveSalesOpsRoute,
} from '@/sales-ops/navigation';
import { NoRoleGuard } from '../components/auth/RoleGuard';
import { NoRolePage } from '../pages/errors/NoRolePage';
import { SalesOpsApp } from '../sales-ops/SalesOpsApp';

const act = (
  React as typeof React & { act: typeof import('react-dom/test-utils').act }
).act;

const webRoot = path.resolve(__dirname, '../..');
const readSource = (relative: string) => readFileSync(path.join(webRoot, relative), 'utf8');

const UNAUTHORIZED = 'Acesso não autorizado';

let profileRoles: AppRole[] = [];
let profileLoaded = true;

const authMocks = vi.hoisted(() => ({ logout: vi.fn(async () => undefined) }));

vi.mock('@/auth/react', () => ({
  useAuthProfile: () => ({
    isLoaded: profileLoaded,
    isSignedIn: profileLoaded,
    roles: profileRoles,
    name: 'Test User',
    email: 'test.user@fxl.example',
  }),
  useLogout: () => authMocks.logout,
}));

const mutation = {
  isPending: false,
  mutate: vi.fn(),
  mutateAsync: vi.fn(async () => ({})),
};

vi.mock('@/sales-ops/hooks', () => ({
  useSalesOpsBootstrap: () => ({
    data: {
      sales: [],
      products: [],
      clients: [],
      areas: [],
      funcoes: [],
      people: [],
      payables: [],
      saleItems: [],
      receivables: [],
      productFuncaoCosts: [],
      saleProfessionals: [],
      settings: null,
    },
    isLoading: false,
    isError: false,
  }),
  useCreateSalesOpsSale: () => mutation,
  useUpdateSalesOpsSale: () => mutation,
  useTransitionSalesOpsSale: () => mutation,
  useCancelSalesOpsContract: () => mutation,
  useSaveSalesOpsArea: () => mutation,
  useSaveSalesOpsClient: () => mutation,
  useSaveSalesOpsFuncao: () => mutation,
  useSaveSalesOpsPerson: () => mutation,
  useSaveSalesOpsProduct: () => mutation,
  useSaveSalesOpsSettings: () => mutation,
  useSetSalesOpsCadastroStatus: () => mutation,
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: HTMLAttributes<HTMLDivElement>) => <div>{children}</div>,
  DialogContent: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
  DialogDescription: ({ children, ...props }: HTMLAttributes<HTMLParagraphElement>) => (
    <p {...props}>{children}</p>
  ),
  DialogHeader: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
  DialogTitle: ({ children, ...props }: HTMLAttributes<HTMLHeadingElement>) => (
    <h2 {...props}>{children}</h2>
  ),
}));

let container: HTMLDivElement;
let root: Root | null;
let visited: string[];

/**
 * Records every distinct path the router settles on, in order, and converts an
 * unbounded ping-pong into ONE named failure that prints the cycle. Without the throw a
 * regression here shows up as a five second vitest timeout with no explanation, or as a
 * `Maximum update depth exceeded` stack pointing at react-router rather than at the two
 * guards that disagree.
 */
function LocationProbe() {
  const { pathname } = useLocation();
  useEffect(() => {
    visited.push(pathname);
    if (visited.length > 6) {
      throw new Error(`redirect loop: ${visited.join(' -> ')}`);
    }
  }, [pathname]);
  return <output data-testid="location-path">{pathname}</output>;
}

/**
 * The `/no-role` wiring from `router.tsx`, minus `Protected`, next to the REAL
 * `SalesOpsApp` on the two routes it owns. Mounting the real component is what makes the
 * loop assertions mean something: a stub `/` would only ever prove what the stub does.
 * `Protected` is omitted because it needs the real Hub provider; the source pin at the
 * bottom of this file is what holds the nesting inside `router.tsx` itself.
 */
async function renderAt(entry: string) {
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        initialEntries={[entry]}
      >
        <Routes>
          <Route
            element={
              <NoRoleGuard>
                <NoRolePage />
              </NoRoleGuard>
            }
            path="/no-role"
          />
          <Route element={<SalesOpsApp />} path="/" />
          <Route element={<SalesOpsApp />} path="/:workspace/:view" />
        </Routes>
        <LocationProbe />
      </MemoryRouter>,
    );
  });
  for (let index = 0; index < 3; index += 1) {
    await act(async () => Promise.resolve());
  }
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = null;
  visited = [];
  profileRoles = [];
  profileLoaded = true;
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
  }
  container.remove();
  vi.clearAllMocks();
});

describe('/no-role is not a dead end for an entitled operator', () => {
  it.each([
    [['admin', 'seller', 'finder'] as AppRole[], '/tatico/dashboard'],
    [['seller'] as AppRole[], '/meus-dados/vendedores'],
    [['finder'] as AppRole[], '/meus-dados/finders'],
  ])('sends a %j operator from /no-role to %s in exactly two navigations', async (roles, destination) => {
    profileRoles = roles;

    await renderAt('/no-role');

    expect(visited).toEqual(['/no-role', '/', destination]);
    expect(container.textContent).not.toContain(UNAUTHORIZED);
  });

  it('keeps the unauthorized screen for an operator with zero recognized roles', async () => {
    profileRoles = [];

    await renderAt('/no-role');

    expect(visited).toEqual(['/no-role']);
    expect(container.textContent).toContain(UNAUTHORIZED);
  });

  /**
   * The over-correction guard AND the loop guard in one. A `roles.length > 0` condition
   * passes the three cases above and fails here, by ping-ponging `/no-role` to `/` to
   * `/no-role` until `LocationProbe` throws.
   */
  it('keeps the unauthorized screen for a role the app does not recognize, and does not ping-pong', async () => {
    profileRoles = ['viewer' as AppRole];

    await renderAt('/no-role');

    expect(visited).toEqual(['/no-role']);
    expect(container.textContent).toContain(UNAUTHORIZED);
  });

  it('renders neither the unauthorized screen nor a navigation while the profile is still loading', async () => {
    profileLoaded = false;
    profileRoles = ['admin', 'seller', 'finder'];

    await renderAt('/no-role');

    expect(visited).toEqual(['/no-role']);
    expect(container.textContent).not.toContain(UNAUTHORIZED);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });
});

/**
 * `Record<AppRole, true>` is exhaustive by construction, so adding a member to `AppRole`
 * without adding it here is a TYPE error under `pnpm run type-check`. That is what keeps
 * the subset sweep below honest about a union it cannot enumerate at runtime.
 */
const ROLE_COVERAGE: Record<AppRole, true> = { admin: true, seller: true, finder: true };
const ALL_ROLES = Object.keys(ROLE_COVERAGE) as AppRole[];
const NON_EMPTY_ROLE_SETS: Array<[AppRole[]]> = Array.from(
  { length: 1 << ALL_ROLES.length },
  (_value, mask) => ALL_ROLES.filter((_role, index) => (mask & (1 << index)) !== 0),
)
  .filter((roles) => roles.length > 0)
  .map((roles) => [roles]);

describe('the /no-role redirect cannot ping-pong with the SalesOpsApp redirect', () => {
  it.each(NON_EMPTY_ROLE_SETS)(
    '%j yields at least one visible workspace, so the two guards can never both want to navigate',
    (roles) => {
      expect(getVisibleWorkspaces(roles).length).toBeGreaterThan(0);
    },
  );

  it.each(NON_EMPTY_ROLE_SETS)(
    'the default route for %j is canonical, so / settles in exactly one further hop',
    (roles) => {
      const route = getDefaultSalesOpsRoute(roles);
      const resolution = resolveSalesOpsRoute(route, roles);
      expect(resolution.redirect).toBe(false);
      expect(resolution.path).toBe(buildSalesOpsPath(route));
    },
  );

  it.each([
    [['admin', 'seller', 'finder'] as AppRole[], '/tatico/dashboard'],
    [['admin'] as AppRole[], '/tatico/dashboard'],
    [['seller'] as AppRole[], '/meus-dados/vendedores'],
    [['finder'] as AppRole[], '/meus-dados/finders'],
    [['seller', 'finder'] as AppRole[], '/meus-dados/vendedores'],
  ])('a %j operator entering at / lands on %s', (roles, destination) => {
    expect(buildSalesOpsPath(getDefaultSalesOpsRoute(roles))).toBe(destination);
  });
});

describe('router wiring', () => {
  /**
   * The harness above rebuilds the `/no-role` route by hand, so this is what pins that
   * `router.tsx` really wraps the page, and that the guard sits INSIDE `Protected` rather
   * than outside it, where it would judge an unresolved profile on a cold entry.
   */
  it('router.tsx wraps NoRolePage in NoRoleGuard inside Protected', () => {
    const source = readSource('src/router.tsx');
    expect(source).toMatch(
      /<Protected>\s*<NoRoleGuard>\s*<NoRolePage \/>\s*<\/NoRoleGuard>\s*<\/Protected>/,
    );
  });
});
```

### Which of these fail on current code

Before the source change the file does not even resolve, because `NoRoleGuard` is not exported from `RoleGuard.tsx`.
That is the intended TDD red, and after stubbing the export the individual verdicts are:

| test | today | why |
| --- | --- | --- |
| `sends a %j operator from /no-role to %s in exactly two navigations` (3 cases) | **FAIL** | `visited` is `['/no-role']` and `Acesso não autorizado` is on screen. This is dead end C. |
| `keeps the unauthorized screen for an operator with zero recognized roles` | pass | The over-correction guard. It is here to fail on a fix that is too broad, and it must stay green throughout. |
| `keeps the unauthorized screen for a role the app does not recognize, and does not ping-pong` | pass | Also an over-correction guard. It is the one test that separates the specified condition from `roles.length > 0`, which loops here. |
| `renders neither the unauthorized screen nor a navigation while the profile is still loading` | **FAIL** | `NoRolePage` renders regardless of `isLoaded` today, so the copy is present. |
| the two `NON_EMPTY_ROLE_SETS` sweeps | pass | Regression fences on `navigation.ts`, which this slice does not change. They are what turns the loop proof from prose into something CI re-checks. |
| `a %j operator entering at / lands on %s` | pass | Pins the landing table in section 3. |
| `router.tsx wraps NoRolePage in NoRoleGuard inside Protected` | **FAIL** | The wrapper does not exist. |

So five assertions in this file are red before the change and green after, and three groups are green on both sides by design.
Acceptance criterion 5 of `00-OVERVIEW.md` is satisfied by the first and last rows.

## Commands

Slice loop:

```bash
pnpm --filter @fxl-sales/web exec vitest run src/__tests__/no-role-redirect.test.tsx
```

Before handing to Verify:

```bash
pnpm run lint && pnpm run type-check && pnpm test
```

`pnpm run type-check` is not optional here: the `Record<AppRole, true>` exhaustiveness guard in the test is a compile-time assertion and vitest alone will not evaluate it.

## Executor checklist

1. Add the `getVisibleWorkspaces` import and the `NoRoleGuard` component to `apps/web/src/components/auth/RoleGuard.tsx`, exactly as written above. Do not modify `RoleGuard` or `RoleRouter`.
2. Wrap `NoRolePage` in `NoRoleGuard` inside `Protected` in `apps/web/src/router.tsx`, and update the import to `import { NoRoleGuard, RoleGuard } from './components/auth/RoleGuard';`.
3. Create `apps/web/src/__tests__/no-role-redirect.test.tsx` from the listing above.
4. Run the slice command, then the full gate.
5. Do not edit `apps/web/src/sales-ops/SalesOpsApp.tsx`, `apps/web/src/auth/session-recovery.ts`, `apps/web/src/auth/react.tsx`, `apps/web/src/pages/errors/NoRolePage.tsx`, `apps/web/src/sales-ops/navigation.ts` or any i18n file.
6. Do not edit `CLAUDE.md`. The exception wording is drafted above and belongs to the feature's Capture step.
