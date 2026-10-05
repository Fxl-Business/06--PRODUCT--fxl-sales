---
id: 05-web-edition-navigation
milestone: v4.3.0
status: todo
depends_on: [01-edition-contract]
files_modified:
  - apps/web/src/auth/react.tsx
  - apps/web/src/auth/__tests__/react.test.tsx
  - apps/web/src/sales-ops/navigation.ts
  - apps/web/src/sales-ops/__tests__/navigation.test.ts
  - apps/web/src/sales-ops/__tests__/navigation-edition.test.ts
  - apps/web/src/sales-ops/SalesOpsApp.tsx
  - apps/web/src/sales-ops/__tests__/leads-routing.test.tsx
  - apps/web/src/components/auth/RoleGuard.tsx
  - apps/web/src/pages/errors/NoRolePage.tsx
  - apps/web/src/__tests__/no-role-redirect.test.tsx
  - apps/web/src/dev/__tests__/dev-identity-roles.test.tsx
  - apps/web/src/auth/__tests__/auth-mock-edition-export.test.ts
  - apps/web/src/admin/products/__tests__/useProducts.test.ts
  - apps/web/src/admin/sellers/__tests__/AdminSellersPage.test.tsx
  - apps/web/src/sales-ops/__tests__/blank-bearer-token.test.tsx
  - apps/web/src/sales-ops/__tests__/cadastro-history.test.tsx
  - apps/web/src/sales-ops/__tests__/cadastros-refresh.test.tsx
  - apps/web/src/sales-ops/__tests__/entitlement-dead-end.test.tsx
  - apps/web/src/sales-ops/__tests__/financial-mutation-forbidden.test.tsx
  - apps/web/src/sales-ops/__tests__/forbidden-panel.test.tsx
  - apps/web/src/sales-ops/__tests__/missing-entitlement-panel.test.tsx
  - apps/web/src/sales-ops/__tests__/month-totals.test.tsx
  - apps/web/src/sales-ops/__tests__/optimistic-row-guard.test.tsx
  - apps/web/src/sales-ops/__tests__/routing.test.tsx
  - apps/web/src/sales-ops/__tests__/sale-deep-link.test.tsx
  - apps/web/src/sales-ops/__tests__/sale-wizard-save-error.test.tsx
  - apps/web/src/sales-ops/__tests__/sales-settlement-visibility.test.tsx
  - apps/web/src/sales-ops/__tests__/settings-currency-brl.test.tsx
  - apps/web/src/sales-ops/__tests__/shell-organization-switcher.test.tsx
  - apps/web/src/sales-ops/import/__tests__/import-routing.test.tsx
  - apps/web/src/sales-ops/import/__tests__/import-view.test.tsx
  - apps/web/src/sales-ops/leads/__tests__/lead-conversion.test.tsx
  - apps/web/src/sales-ops/leads/__tests__/leads-board-fanout.test.ts
  - apps/web/src/sales-ops/leads/__tests__/leads-move-rollback.test.ts
  - nexo/knowledge/reference/sales-ops-routing.md
acceptance: "A token whose entitlements.modules contains exactly 'sales.edition.leads' yields profile.edition === 'leads' and useSalesEdition() === 'leads'; any other token (absent entitlements, empty or unknown modules, signed out) yields 'full'. With edition 'full' or no edition argument, every navigation export returns exactly today's literals for all eight role combinations. With edition 'leads': an admin (any role set containing admin) sees only the workspaces operacional [leads 'Prospecção'] and cadastros [pessoas 'Vendedores', etapas 'Etapas do funil'] and lands on /operacional/leads; a seller without admin sees only meus-dados [leads 'Minha prospecção'] and lands on /meus-dados/leads; finder-only and no-role see no workspace and stay on /no-role without a redirect loop; every other URL redirects to the role default. The leads-edition operacional workspace description is 'Prospecção'. The Trocar painel menu lists exactly Operacional and Cadastros for a leads-edition admin, and the shell renders with bootstrap settings null. Every vi.mock('@/auth/react') factory in apps/web/src exports useSalesEdition (SEAM A5, pinned by auth-mock-edition-export.test.ts)."
goal: "Expose the Sales edition on the web auth profile (profile.edition plus useSalesEdition) and thread it through navigation.ts and every caller (SalesOpsApp shell, sidebar, Trocar painel, NoRoleGuard) so the leads edition shows only its allowed screens while the full edition stays byte-identical."
must_not_break:
  - apps/web/src/sales-ops/__tests__/navigation.test.ts (extended, never weakened)
  - apps/web/src/sales-ops/__tests__/routing.test.tsx
  - apps/web/src/sales-ops/__tests__/leads-routing.test.tsx (extended, never weakened)
  - apps/web/src/__tests__/no-role-redirect.test.tsx (extended, never weakened)
  - apps/web/src/dev/__tests__/dev-identity-roles.test.tsx
  - apps/web/src/auth/__tests__/react.test.tsx
  - apps/web/src/sales-ops/__tests__/entitlement-dead-end.test.tsx
  - apps/web/src/sales-ops/__tests__/sales-settlement-visibility.test.tsx
  - apps/web/src/sales-ops/__tests__/shell-organization-switcher.test.tsx
  - apps/web/src/sales-ops/__tests__/session-loss-keeps-route.test.tsx
  - apps/web/src/sales-ops/import/__tests__/import-routing.test.tsx
  - apps/web/src/sales-ops/leads/__tests__/board-write-surface.test.ts
  - "pnpm --filter @fxl-sales/web lint / type-check / test / build"
oracle: apps/web/src/sales-ops/__tests__/navigation-edition.test.ts
rules:
  - "Import the edition only from '@fxl-sales/shared-utils/sales-edition', never from the package root."
  - "Do NOT touch leads UI fields (slice 06), the Pessoas screen body, its page title or its header action (slice 07), the API, the auth-fake roster or seed-dev (slice 08)."
  - "SalesOpsApp and NoRoleGuard read the edition as profile.edition from the useAuthProfile() call they already make (the shell's ONE read site, named `edition`; slice 07 reuses that variable). They do NOT call useSalesEdition(). An absent profile.edition in a hand-written mock must fall into the navigation default parameter 'full'. Leaf components (slice 06's LeadsBoardContainer) call useSalesEdition()."
  - "SEAM A5: this slice adds `useSalesEdition: () => 'full'` to EVERY existing vi.mock('@/auth/react', ...) factory in apps/web/src (24 files, Step 7g) and pins it with auth-mock-edition-export.test.ts; slices 06 and 07 only add it to their own new test files."
  - "In navigation.ts the edition branch is `edition === 'leads'`; every other value (including undefined at runtime) is the full edition. Never derive the full-edition output through a new code path: the full branch keeps today's code verbatim."
  - "Expected values in tests are hand-written literals (the tables below). Never compute an expected value by calling navigation.ts."
  - "Legacy trees /admin/*, /finder/*, /seller/* and RoleGuard stay byte-unchanged."
  - "No new dependency. Tests use createRoot + act + happy-dom like the existing files."
verifier_focus: "That the full-edition tables in navigation-edition.test.ts are literals and assert both the no-argument call and the explicit 'full' call; that NoRoleGuard keys on getVisibleWorkspaces(roles, edition) (the leads finder-only /no-role case would loop otherwise); that SalesOpsApp passes the edition to all six navigation calls and to the workspace catalogue; and that profileFromToken reads entitlements.modules through resolveSalesEdition only."
---

# Slice 05 - web edition navigation

## Objective

The leads edition (Construbom) must show a gestor only Prospecção, Vendedores and Etapas do funil, and a vendedor only Minha prospecção.
The edition is read from the same verified token the roles come from (`entitlements.modules`), resolved by slice 01's pure `resolveSalesEdition`.
FXL (no module) must see exactly today's navigation, proven by literal oracle tables.

## Code facts (verified while planning)

- `apps/web/src/auth/react.tsx`:
  - `type AuthProfile` (line 74) is module-private and is the shape of `useAuthProfile()`; `HubAuthState = AuthProfile & {...}` and the context value spreads `...profile` (line 727), so a new `AuthProfile` field reaches the context automatically.
  - `profileFromToken(token)` (line 184) is module-private and pure; it returns `{ roles: [], workspaces: [] }` for `null` or an unparseable token.
  - Profiles are built in exactly three places: the `useState<AuthProfile>` initial value (line 325), `applyToken`'s `setProfile({...})` (line 353), and `useHubProfile()` (line 980), which destructures and re-lists every field. All three must gain `edition`.
  - Public hooks are exported as aliases at the bottom (`export const useAuthProfile = useHubProfile;`, line 1170).
- The dev identity path mints a real token: `apps/web/src/dev/install-dev-identity.ts` builds a session whose `requestToken` returns `fake.mintDevToken(identity, ...)`; `react.tsx` line 297 hands `devSession.requestToken` to the same token cache, and every token reaches `applyToken` and therefore `profileFromToken`. `packages/auth-fake/src/index.ts` `toHubClaims` (line 381) already writes `entitlements: { access, modules: [...identity.modules] }`. So the fake path decodes the edition with no change to `install-dev-identity.ts`.
- `apps/web/src/auth/claims.ts` `parseJwtPayload` returns `Record<string, unknown> | null`; `claims.entitlements` is `unknown`.
- `apps/web/src/sales-ops/navigation.ts` callers (whole repo, `grep -rnE "getVisibleWorkspaces|getSalesOpsNavigation|getDefaultSalesOpsRoute|resolveSalesOpsRoute|workspaceForView|salesOpsWorkspaces|canSettleInWorkspace" apps/web/src`):
  - `SalesOpsApp.tsx` lines 1330 (`getVisibleWorkspaces`), 1333 (`resolveSalesOpsRoute`), 1424 (`getSalesOpsNavigation`), 1431 (`canSettleInWorkspace`), 1645 (`getDefaultSalesOpsRoute` in `setWorkspace`, the `Trocar painel` menu), 1653 (`workspaceForView` in `go`), 1710 and 1713 (`salesOpsWorkspaces` for `availableWorkspaces` and `activeWorkspaceMeta`).
  - `components/auth/RoleGuard.tsx` line 60 (`NoRoleGuard`).
  - `pages/errors/NoRolePage.tsx` line 12 (doc comment only).
  - Tests: `navigation.test.ts`, `no-role-redirect.test.tsx`, `dev-identity-roles.test.tsx`, `sales-settlement-visibility.test.tsx`.
- `SalesOpsApp` fires exactly one query on mount, `useSalesOpsBootstrap()`, which stays open in the leads edition (SEAM-CONTRACT section 2), so the shell renders in the leads edition without hitting a gated route.
- `salesOpsWorkspaces[].description` is not rendered anywhere today (only `label` reaches the sidebar and the `Painéis` menu); the leads-edition description is still set per the seam.
- In the full edition `getSalesOpsNavigation` ignores `roles` for `tatico`, `operacional` and `cadastros` (verified for all eight role sets); only `meus-dados` depends on roles.
- `getRolesFromHubClaims` returns `['admin','seller','finder']` for every admin-bearing claim, so a leads-edition gestor always also holds `seller`. AC2 says the gestor sees EXACTLY operacional/leads, cadastros/pessoas, cadastros/etapas, therefore in the leads edition `admin` wins and `meus-dados` is NOT added for an admin (decision D-05-1 below).
- `apps/web/vitest.config.ts`: default env `node`, component tests start with `// @vitest-environment happy-dom`. `@fxl-sales/shared-utils` subpaths resolve through the package `exports` to `dist/`, so `packages/shared-utils` must be built before the web tests and type-check.
- `@fxl-sales/web` scripts: `test` = `vitest run`, `lint` = `eslint src/`, `type-check` = `tsc --noEmit`.
- Twenty-four test files `vi.mock('@/auth/react', ...)` with a hand-written `useAuthProfile` that has no `edition` and no `useSalesEdition` export (`grep -rln "vi.mock('@/auth/react'" apps/web/src`).

## Decisions taken here (no executor choice left)

- D-05-1. Leads edition visibility: `admin` in the role set => `['operacional', 'cadastros']`; else `seller` => `['meus-dados']`; else `[]`. `tatico` is never visible. `finder` grants nothing in the leads edition.
- D-05-2. Leads edition navigation lists are three new module constants; `tatico` returns `[]`; `meus-dados` returns the seller list only when the role set has `seller` (so finder-only gets `[]`).
- D-05-3. The leads-edition workspace catalogue is a fourth constant built once from `salesOpsWorkspaces` with only the `operacional` description replaced by `'Prospecção'`. It is exposed by a new export `getSalesOpsWorkspaces(edition = 'full')` that returns the SAME `salesOpsWorkspaces` array object for the full edition. `salesOpsWorkspaces` stays exported and unchanged. This name is slice-local (only `SalesOpsApp` consumes it).
- D-05-4. `canSettleInWorkspace` also gains the trailing `edition: SalesEdition = 'full'` and answers `false` in the leads edition (it takes roles, so the seam rule "every exported function that takes roles" covers it; the settlement UI is unreachable there anyway).
- D-05-5. `getDefaultSalesOpsRoute(roles, preferredWorkspace?, edition = 'full')`: the edition is the THIRD parameter, after the existing optional `preferredWorkspace`. Internal callers pass `undefined` for `preferredWorkspace`.
- D-05-6. The empty-visibility fallback of `getDefaultSalesOpsRoute` stays `{ workspace: 'tatico', view: 'dashboard' }` in both editions; `SalesOpsApp` already sends a zero-workspace operator to `/no-role` before that route is ever used.
- D-05-7. `aliasLegacyView` is unchanged and edition-independent: in the leads edition `/cadastros/vendedores` and `/cadastros/finders` alias to `/cadastros/pessoas`, which exists there.
- D-05-8. `useSalesEdition` is defined as `function useHubSalesEdition(): SalesEdition { return useHubAuthContext().edition; }` and exported as `export const useSalesEdition = useHubSalesEdition;` beside the other aliases.

## Step 0 - prerequisite

Slice 01 is merged: `packages/shared-utils/src/sales-edition.ts` exists and `./sales-edition` is in `packages/shared-utils/package.json` `exports`.
Run `pnpm --filter @fxl-sales/shared-utils build` once so `dist/sales-edition.{js,d.ts}` exist.
If the subpath is missing, STOP and report the slice blocked; never inline a copy of the resolver.

## Step 1 - `apps/web/src/auth/react.tsx`

1. Add the import directly after the `./claims` import:

```ts
import { resolveSalesEdition, type SalesEdition } from '@fxl-sales/shared-utils/sales-edition';
```

2. In `type AuthProfile`, after `roles: AppRole[];`, add:

```ts
  /**
   * The Sales edition of the ACTIVE Organization, derived from the verified token's
   * `entitlements.modules` by the shared `resolveSalesEdition` (the API resolves the same
   * claim the same way in `applyHubAuthContext`). Always present: `'full'` while signed out
   * and for any token that does not carry exactly `sales.edition.leads`, which is FXL.
   * It changes with the token, so a workspace switch into a leads-edition Organization
   * flips it in the same `setProfile` as the roles.
   */
  edition: SalesEdition;
```

3. Directly above `function profileFromToken`, add:

```ts
/**
 * `entitlements.modules` as the token carries it, or `undefined` when the claim is absent
 * or not an array. Validation of the entries is `resolveSalesEdition`'s job, not this one.
 */
function readEntitlementModules(entitlements: unknown): readonly unknown[] | undefined {
  if (typeof entitlements !== 'object' || entitlements === null) return undefined;
  const modules = (entitlements as { modules?: unknown }).modules;
  return Array.isArray(modules) ? modules : undefined;
}
```

4. In `profileFromToken`: the early return becomes `return { roles: [], edition: 'full', workspaces: [] };` and the main return gains, right after `roles: getRolesFromHubClaims(claims),`:

```ts
    edition: resolveSalesEdition(readEntitlementModules(claims.entitlements)),
```

5. The `useState<AuthProfile>` initial value becomes `{ isLoaded: false, isSignedIn: false, roles: [], edition: 'full' }`.
6. In `applyToken`'s `setProfile({...})`, add `edition: next.edition,` right after `roles: next.roles,`.
7. In `useHubProfile`, add `edition` to the destructuring (after `roles`) and to the returned object (after `roles,`).
8. After `useHubProfile`, add:

```ts
/**
 * The ONE read of the Sales edition for components (slices 06 and 07). Shell code that
 * already holds `useAuthProfile()` reads `profile.edition` instead, so the many test files
 * that mock this module with a hand-written profile keep working unchanged.
 */
function useHubSalesEdition(): SalesEdition {
  return useHubAuthContext().edition;
}
```

9. At the bottom, after `export const useAuthProfile = useHubProfile;`, add `export const useSalesEdition = useHubSalesEdition;`.

Nothing else in the file changes. The unchanged-token early return in `applyToken` still holds because `edition` is a pure function of the token.

## Step 2 - `apps/web/src/sales-ops/navigation.ts`

1. Add after the `AppRole` import:

```ts
import type { SalesEdition } from '@fxl-sales/shared-utils/sales-edition';
```

2. After `meusDadosFinder`, add the leads-edition lists:

```ts
/*
  THE LEADS EDITION (Construbom). Three short lists, never a filter over the full ones:
  a filter would make every full-edition label and order depend on the leads rules, and
  the full edition must stay byte-identical (oracle: navigation-edition.test.ts).
  `[0]` is still the landing route of each workspace.
*/
const leadsEditionOperational: SalesOpsNavigationItem[] = [
  { id: 'leads', label: 'Prospecção', icon: LayoutGrid },
];

/** A pessoa is always a vendedor in this edition, so the screen is labelled for it. */
const leadsEditionCadastros: SalesOpsNavigationItem[] = [
  { id: 'pessoas', label: 'Vendedores', icon: UsersRound },
  { id: 'etapas', label: 'Etapas do funil', icon: ListChecks },
];

const leadsEditionMeusDadosSeller: SalesOpsNavigationItem[] = [
  { id: 'leads', label: 'Minha prospecção', icon: LayoutGrid },
];
```

3. After `salesOpsWorkspaces`, add:

```ts
const leadsEditionWorkspaces: ReadonlyArray<{
  id: SalesOpsWorkspace;
  label: string;
  description: string;
}> = salesOpsWorkspaces.map((item) =>
  item.id === 'operacional' ? { ...item, description: 'Prospecção' } : item,
);

/**
 * The workspace catalogue for an edition. The full edition gets the SAME
 * `salesOpsWorkspaces` array object, so nothing about it can drift.
 */
export function getSalesOpsWorkspaces(
  edition: SalesEdition = 'full',
): ReadonlyArray<{ id: SalesOpsWorkspace; label: string; description: string }> {
  return edition === 'leads' ? leadsEditionWorkspaces : salesOpsWorkspaces;
}
```

4. `getVisibleWorkspaces(roles: readonly AppRole[], edition: SalesEdition = 'full')`: insert right after `const roleSet = new Set(roles);`:

```ts
  if (edition === 'leads') {
    // The gestor always also holds `seller` (getRolesFromHubClaims), and AC2 gives the
    // gestor exactly Prospecção, Vendedores and Etapas, so `admin` wins outright here.
    // `finder` grants nothing: this edition has no finder screen.
    if (roleSet.has('admin')) return ['operacional', 'cadastros'];
    if (roleSet.has('seller')) return ['meus-dados'];
    return [];
  }
```

The rest of the function is unchanged.

5. `canSettleInWorkspace(workspace, roles, edition: SalesEdition = 'full')`: body becomes `return edition !== 'leads' && workspace === 'operacional' && roles.includes('admin');`. Extend its doc comment with one line: "The leads edition has no proposta, so it never settles."
6. `getSalesOpsNavigation(workspace, roles, edition: SalesEdition = 'full')`: insert before the existing `switch`:

```ts
  if (edition === 'leads') {
    switch (workspace) {
      case 'tatico':
        return [];
      case 'operacional':
        return leadsEditionOperational;
      case 'cadastros':
        return leadsEditionCadastros;
      case 'meus-dados':
        return roles.includes('seller') ? leadsEditionMeusDadosSeller : [];
    }
  }
```

7. `getDefaultSalesOpsRoute(roles, preferredWorkspace?, edition: SalesEdition = 'full')`: pass `edition` to its `getVisibleWorkspaces` call and to both `getSalesOpsNavigation` calls. The final fallback line is unchanged.
8. `resolveSalesOpsRoute(params, roles, edition: SalesEdition = 'full')`: pass `edition` to `getVisibleWorkspaces` and `getSalesOpsNavigation`; the fallback becomes `getDefaultSalesOpsRoute(roles, undefined, edition)`.
9. `workspaceForView(view, roles, edition: SalesEdition = 'full')`: pass `edition` to `getVisibleWorkspaces`, `getSalesOpsNavigation`, and the fallback `getDefaultSalesOpsRoute(roles, undefined, edition)`.
10. `buildSalesOpsPath`, `buildSaleDetailPath`, `aliasLegacyView`, `SALES_OPS_ROUTE_PATTERN` and all types are unchanged.

The prototype of exactly these edits was run against today's file for all eight role sets and fifteen URLs: the full branch (no argument and `'full'`) was deep-equal to today's output everywhere, and the leads tables below are its output.

## Step 3 - `apps/web/src/sales-ops/SalesOpsApp.tsx`

Exactly these edits, nothing else:

1. Import list (lines 96-104): replace `salesOpsWorkspaces,` with `getSalesOpsWorkspaces,` (keep alphabetical order of the existing block as the linter wants; `salesOpsWorkspaces` has no other use in the file).
2. Right after `const profile = useAuthProfile();` (line 1282) add:

```ts
  /**
   * Read off the profile this component already holds, never through a second hook:
   * the shell's test harnesses mock `@/auth/react` with a hand-written profile, and an
   * absent `edition` there must fall into navigation.ts's default `'full'`.
   */
  const edition = profile.edition;
```

3. Line 1330: `() => getVisibleWorkspaces(profile.roles, edition),` with deps `[profile.roles, edition]`.
4. Line 1333: `resolveSalesOpsRoute(routeParams, profile.roles, edition)`.
5. Line 1424: `getSalesOpsNavigation(workspace, profile.roles, edition)`.
6. Line 1431: `canSettleInWorkspace(workspace, profile.roles, edition)`.
7. Line 1645 (`setWorkspace`, the `Trocar painel` menu): `getDefaultSalesOpsRoute(profile.roles, next, edition)`.
8. Line 1653 (`go`): `workspaceForView(next, profile.roles, edition)`.
9. Lines 1710-1713: add `const workspaceCatalogue = getSalesOpsWorkspaces(edition);` right before `availableWorkspaces`, and replace both `salesOpsWorkspaces.` with `workspaceCatalogue.`.

Do NOT touch `titleForView`, `headerAction`, `runHeaderAction`, the Pessoas body or any lead component (slices 06 and 07).

## Step 4 - `apps/web/src/components/auth/RoleGuard.tsx`

`NoRoleGuard` only:

- `const { isLoaded, roles, edition } = useAuthProfile();`
- `if (getVisibleWorkspaces(roles, edition).length > 0) {`
- In its doc comment, replace `getVisibleWorkspaces(...).length > 0` with `getVisibleWorkspaces(roles, edition).length > 0` and add one paragraph:

```
 * The EDITION is part of the predicate for the same reason. In the leads edition a
 * finder-only operator holds a role but sees no workspace; keyed on roles alone this guard
 * would send them to `/` while `SalesOpsApp` (which reads the edition) sends them straight
 * back, the exact ping-pong this comment exists to forbid.
```

`RoleGuard` (the function above it) is byte-unchanged.

## Step 5 - `apps/web/src/pages/errors/NoRolePage.tsx`

Doc comment only: `getVisibleWorkspaces(roles)` becomes `getVisibleWorkspaces(roles, edition)`.
No code change.

## Step 6 - `nexo/knowledge/reference/sales-ops-routing.md`

Append one bullet block at the end (one sentence per line):

```
- Sales edition (feature `edicao-leads`, v4.3.0). `profile.edition` comes from the token's `entitlements.modules` through `resolveSalesEdition` (`@fxl-sales/shared-utils/sales-edition`) in `profileFromToken`; `useSalesEdition()` reads it.
  Every navigation export that takes roles takes a trailing `edition = 'full'`; the full branch is today's code verbatim and is pinned by literal tables in `navigation-edition.test.ts`.
  Leads edition: `admin` sees `operacional` [`leads` Prospecção] and `cadastros` [`pessoas` labelled Vendedores, `etapas`]; a non-admin `seller` sees `meus-dados` [`leads` Minha prospecção]; `finder` grants nothing; `tatico` is never visible.
  An admin does not get `meus-dados` in the leads edition, because every admin-bearing claim also yields `seller` and AC2 gives the gestor exactly three screens.
  `NoRoleGuard` keys on `getVisibleWorkspaces(roles, edition)`; a leads-edition finder-only operator stays on `/no-role` with no loop (oracle `no-role-redirect.test.tsx`).
  `SalesOpsApp` and `NoRoleGuard` read `profile.edition` from `useAuthProfile()`, never `useSalesEdition()`, so the shell harnesses that mock `@/auth/react` keep working.
```

## Step 7 - tests

### 7a. New oracle `apps/web/src/sales-ops/__tests__/navigation-edition.test.ts`

Environment `node` (no pragma).
Header:

```ts
import { describe, expect, it } from 'vitest';
import type { AppRole } from '@/auth/claims';
import {
  buildSalesOpsPath,
  canSettleInWorkspace,
  getDefaultSalesOpsRoute,
  getSalesOpsNavigation,
  getSalesOpsWorkspaces,
  getVisibleWorkspaces,
  resolveSalesOpsRoute,
  salesOpsWorkspaces,
  workspaceForView,
  type SalesOpsView,
  type SalesOpsWorkspace,
} from '../navigation';

/*
  THE EDITION FENCE. Every expected value below is a hand-written literal captured from
  the pre-edition navigation.ts. Never derive one by calling navigation.ts: a derived
  table moves with the bug.
*/
const COMBOS = {
  none: [],
  admin: ['admin'],
  seller: ['seller'],
  finder: ['finder'],
  adminSeller: ['admin', 'seller'],
  adminFinder: ['admin', 'finder'],
  sellerFinder: ['seller', 'finder'],
  everything: ['admin', 'seller', 'finder'],
} as const satisfies Record<string, readonly AppRole[]>;
type ComboName = keyof typeof COMBOS;
const COMBO_NAMES = Object.keys(COMBOS) as ComboName[];
const WORKSPACES: SalesOpsWorkspace[] = ['tatico', 'operacional', 'cadastros', 'meus-dados'];
const TEAM_WORKSPACES = ['tatico', 'operacional', 'cadastros'] as const;
const URLS = [
  '/tatico/dashboard', '/operacional/vendas', '/operacional/comissoes', '/operacional/leads',
  '/cadastros/produtos', '/cadastros/pessoas', '/cadastros/vendedores', '/cadastros/etapas',
  '/cadastros/importacao', '/cadastros/geral', '/meus-dados/vendedores', '/meus-dados/comissoes',
  '/meus-dados/leads', '/meus-dados/finders', '/meus-dados/vendas',
];
const pairs = (items: { id: SalesOpsView; label: string }[]) =>
  items.map((item): [SalesOpsView, string] => [item.id, item.label]);
const params = (url: string) => {
  const [, workspace, view] = url.split('/');
  return { workspace, view };
};
```

Then paste these literal tables verbatim (they are the captured outputs; FULL = today, LEADS = the D-05 rules):

```ts
const VISIBLE_FULL: Record<ComboName, SalesOpsWorkspace[]> = {
  none: [],
  admin: ['tatico', 'operacional', 'cadastros'],
  seller: ['meus-dados'],
  finder: ['meus-dados'],
  adminSeller: ['tatico', 'operacional', 'cadastros', 'meus-dados'],
  adminFinder: ['tatico', 'operacional', 'cadastros', 'meus-dados'],
  sellerFinder: ['meus-dados'],
  everything: ['tatico', 'operacional', 'cadastros', 'meus-dados'],
};

const DEFAULT_PATH_FULL: Record<ComboName, string> = {
  none: '/tatico/dashboard',
  admin: '/tatico/dashboard',
  seller: '/meus-dados/vendedores',
  finder: '/meus-dados/finders',
  adminSeller: '/tatico/dashboard',
  adminFinder: '/tatico/dashboard',
  sellerFinder: '/meus-dados/vendedores',
  everything: '/tatico/dashboard',
};

/** Preferred workspace order: tatico, operacional, cadastros, meus-dados. */
const PREFERRED_PATH_FULL: Record<ComboName, [string, string, string, string]> = {
  none: ['/tatico/dashboard', '/tatico/dashboard', '/tatico/dashboard', '/tatico/dashboard'],
  admin: ['/tatico/dashboard', '/operacional/vendas', '/cadastros/produtos', '/tatico/dashboard'],
  seller: ['/meus-dados/vendedores', '/meus-dados/vendedores', '/meus-dados/vendedores', '/meus-dados/vendedores'],
  finder: ['/meus-dados/finders', '/meus-dados/finders', '/meus-dados/finders', '/meus-dados/finders'],
  adminSeller: ['/tatico/dashboard', '/operacional/vendas', '/cadastros/produtos', '/meus-dados/vendedores'],
  adminFinder: ['/tatico/dashboard', '/operacional/vendas', '/cadastros/produtos', '/meus-dados/finders'],
  sellerFinder: ['/meus-dados/vendedores', '/meus-dados/vendedores', '/meus-dados/vendedores', '/meus-dados/vendedores'],
  everything: ['/tatico/dashboard', '/operacional/vendas', '/cadastros/produtos', '/meus-dados/vendedores'],
};

/** Role-independent team workspaces: the role set is ignored for these three. */
const TEAM_NAV_FULL: Record<'tatico' | 'operacional' | 'cadastros', Array<[SalesOpsView, string]>> = {
  'tatico': [['dashboard', 'Visão geral']],
  'operacional': [['vendas', 'Propostas'], ['comissoes', 'Comissões'], ['leads', 'Prospecção']],
  'cadastros': [['produtos', 'Produtos & Serviços'], ['areas', 'Áreas'], ['clientes', 'Clientes'], ['pessoas', 'Pessoas'], ['funcoes', 'Funções'], ['etapas', 'Etapas do funil'], ['importacao', 'Importação'], ['geral', 'Geral']],
};

const MEUS_DADOS_NAV_FULL: Record<ComboName, Array<[SalesOpsView, string]>> = {
  none: [],
  admin: [],
  seller: [['vendedores', 'Meu painel'], ['comissoes', 'Comissões'], ['leads', 'Minha prospecção']],
  finder: [['finders', 'Meu painel'], ['vendas', 'Indicações']],
  adminSeller: [['vendedores', 'Meu painel'], ['comissoes', 'Comissões'], ['leads', 'Minha prospecção']],
  adminFinder: [['finders', 'Meu painel'], ['vendas', 'Indicações']],
  sellerFinder: [['vendedores', 'Meu painel'], ['comissoes', 'Comissões'], ['leads', 'Minha prospecção'], ['finders', 'Meu painel'], ['vendas', 'Indicações']],
  everything: [['vendedores', 'Meu painel'], ['comissoes', 'Comissões'], ['leads', 'Minha prospecção'], ['finders', 'Meu painel'], ['vendas', 'Indicações']],
};

/** url -> [resolved path, redirect]. */
const RESOLVE_FULL: Record<ComboName, Record<string, [string, boolean]>> = {
  none: {
    '/tatico/dashboard': ['/tatico/dashboard', true],
    '/operacional/vendas': ['/tatico/dashboard', true],
    '/operacional/comissoes': ['/tatico/dashboard', true],
    '/operacional/leads': ['/tatico/dashboard', true],
    '/cadastros/produtos': ['/tatico/dashboard', true],
    '/cadastros/pessoas': ['/tatico/dashboard', true],
    '/cadastros/vendedores': ['/tatico/dashboard', true],
    '/cadastros/etapas': ['/tatico/dashboard', true],
    '/cadastros/importacao': ['/tatico/dashboard', true],
    '/cadastros/geral': ['/tatico/dashboard', true],
    '/meus-dados/vendedores': ['/tatico/dashboard', true],
    '/meus-dados/comissoes': ['/tatico/dashboard', true],
    '/meus-dados/leads': ['/tatico/dashboard', true],
    '/meus-dados/finders': ['/tatico/dashboard', true],
    '/meus-dados/vendas': ['/tatico/dashboard', true],
  },
  admin: {
    '/tatico/dashboard': ['/tatico/dashboard', false],
    '/operacional/vendas': ['/operacional/vendas', false],
    '/operacional/comissoes': ['/operacional/comissoes', false],
    '/operacional/leads': ['/operacional/leads', false],
    '/cadastros/produtos': ['/cadastros/produtos', false],
    '/cadastros/pessoas': ['/cadastros/pessoas', false],
    '/cadastros/vendedores': ['/cadastros/pessoas', true],
    '/cadastros/etapas': ['/cadastros/etapas', false],
    '/cadastros/importacao': ['/cadastros/importacao', false],
    '/cadastros/geral': ['/cadastros/geral', false],
    '/meus-dados/vendedores': ['/tatico/dashboard', true],
    '/meus-dados/comissoes': ['/tatico/dashboard', true],
    '/meus-dados/leads': ['/tatico/dashboard', true],
    '/meus-dados/finders': ['/tatico/dashboard', true],
    '/meus-dados/vendas': ['/tatico/dashboard', true],
  },
  seller: {
    '/tatico/dashboard': ['/meus-dados/vendedores', true],
    '/operacional/vendas': ['/meus-dados/vendedores', true],
    '/operacional/comissoes': ['/meus-dados/vendedores', true],
    '/operacional/leads': ['/meus-dados/vendedores', true],
    '/cadastros/produtos': ['/meus-dados/vendedores', true],
    '/cadastros/pessoas': ['/meus-dados/vendedores', true],
    '/cadastros/vendedores': ['/meus-dados/vendedores', true],
    '/cadastros/etapas': ['/meus-dados/vendedores', true],
    '/cadastros/importacao': ['/meus-dados/vendedores', true],
    '/cadastros/geral': ['/meus-dados/vendedores', true],
    '/meus-dados/vendedores': ['/meus-dados/vendedores', false],
    '/meus-dados/comissoes': ['/meus-dados/comissoes', false],
    '/meus-dados/leads': ['/meus-dados/leads', false],
    '/meus-dados/finders': ['/meus-dados/vendedores', true],
    '/meus-dados/vendas': ['/meus-dados/vendedores', true],
  },
  finder: {
    '/tatico/dashboard': ['/meus-dados/finders', true],
    '/operacional/vendas': ['/meus-dados/finders', true],
    '/operacional/comissoes': ['/meus-dados/finders', true],
    '/operacional/leads': ['/meus-dados/finders', true],
    '/cadastros/produtos': ['/meus-dados/finders', true],
    '/cadastros/pessoas': ['/meus-dados/finders', true],
    '/cadastros/vendedores': ['/meus-dados/finders', true],
    '/cadastros/etapas': ['/meus-dados/finders', true],
    '/cadastros/importacao': ['/meus-dados/finders', true],
    '/cadastros/geral': ['/meus-dados/finders', true],
    '/meus-dados/vendedores': ['/meus-dados/finders', true],
    '/meus-dados/comissoes': ['/meus-dados/finders', true],
    '/meus-dados/leads': ['/meus-dados/finders', true],
    '/meus-dados/finders': ['/meus-dados/finders', false],
    '/meus-dados/vendas': ['/meus-dados/vendas', false],
  },
  adminSeller: {
    '/tatico/dashboard': ['/tatico/dashboard', false],
    '/operacional/vendas': ['/operacional/vendas', false],
    '/operacional/comissoes': ['/operacional/comissoes', false],
    '/operacional/leads': ['/operacional/leads', false],
    '/cadastros/produtos': ['/cadastros/produtos', false],
    '/cadastros/pessoas': ['/cadastros/pessoas', false],
    '/cadastros/vendedores': ['/cadastros/pessoas', true],
    '/cadastros/etapas': ['/cadastros/etapas', false],
    '/cadastros/importacao': ['/cadastros/importacao', false],
    '/cadastros/geral': ['/cadastros/geral', false],
    '/meus-dados/vendedores': ['/meus-dados/vendedores', false],
    '/meus-dados/comissoes': ['/meus-dados/comissoes', false],
    '/meus-dados/leads': ['/meus-dados/leads', false],
    '/meus-dados/finders': ['/tatico/dashboard', true],
    '/meus-dados/vendas': ['/tatico/dashboard', true],
  },
  adminFinder: {
    '/tatico/dashboard': ['/tatico/dashboard', false],
    '/operacional/vendas': ['/operacional/vendas', false],
    '/operacional/comissoes': ['/operacional/comissoes', false],
    '/operacional/leads': ['/operacional/leads', false],
    '/cadastros/produtos': ['/cadastros/produtos', false],
    '/cadastros/pessoas': ['/cadastros/pessoas', false],
    '/cadastros/vendedores': ['/cadastros/pessoas', true],
    '/cadastros/etapas': ['/cadastros/etapas', false],
    '/cadastros/importacao': ['/cadastros/importacao', false],
    '/cadastros/geral': ['/cadastros/geral', false],
    '/meus-dados/vendedores': ['/tatico/dashboard', true],
    '/meus-dados/comissoes': ['/tatico/dashboard', true],
    '/meus-dados/leads': ['/tatico/dashboard', true],
    '/meus-dados/finders': ['/meus-dados/finders', false],
    '/meus-dados/vendas': ['/meus-dados/vendas', false],
  },
  sellerFinder: {
    '/tatico/dashboard': ['/meus-dados/vendedores', true],
    '/operacional/vendas': ['/meus-dados/vendedores', true],
    '/operacional/comissoes': ['/meus-dados/vendedores', true],
    '/operacional/leads': ['/meus-dados/vendedores', true],
    '/cadastros/produtos': ['/meus-dados/vendedores', true],
    '/cadastros/pessoas': ['/meus-dados/vendedores', true],
    '/cadastros/vendedores': ['/meus-dados/vendedores', true],
    '/cadastros/etapas': ['/meus-dados/vendedores', true],
    '/cadastros/importacao': ['/meus-dados/vendedores', true],
    '/cadastros/geral': ['/meus-dados/vendedores', true],
    '/meus-dados/vendedores': ['/meus-dados/vendedores', false],
    '/meus-dados/comissoes': ['/meus-dados/comissoes', false],
    '/meus-dados/leads': ['/meus-dados/leads', false],
    '/meus-dados/finders': ['/meus-dados/finders', false],
    '/meus-dados/vendas': ['/meus-dados/vendas', false],
  },
  everything: {
    '/tatico/dashboard': ['/tatico/dashboard', false],
    '/operacional/vendas': ['/operacional/vendas', false],
    '/operacional/comissoes': ['/operacional/comissoes', false],
    '/operacional/leads': ['/operacional/leads', false],
    '/cadastros/produtos': ['/cadastros/produtos', false],
    '/cadastros/pessoas': ['/cadastros/pessoas', false],
    '/cadastros/vendedores': ['/cadastros/pessoas', true],
    '/cadastros/etapas': ['/cadastros/etapas', false],
    '/cadastros/importacao': ['/cadastros/importacao', false],
    '/cadastros/geral': ['/cadastros/geral', false],
    '/meus-dados/vendedores': ['/meus-dados/vendedores', false],
    '/meus-dados/comissoes': ['/meus-dados/comissoes', false],
    '/meus-dados/leads': ['/meus-dados/leads', false],
    '/meus-dados/finders': ['/meus-dados/finders', false],
    '/meus-dados/vendas': ['/meus-dados/vendas', false],
  },
};

const WORKSPACE_FOR_VIEW_FULL: Record<ComboName, Partial<Record<SalesOpsView, SalesOpsWorkspace>>> = {
  none: { dashboard: 'tatico', vendas: 'tatico', comissoes: 'tatico', leads: 'tatico', produtos: 'tatico', pessoas: 'tatico', etapas: 'tatico', vendedores: 'tatico', finders: 'tatico' },
  admin: { dashboard: 'tatico', vendas: 'operacional', comissoes: 'operacional', leads: 'operacional', produtos: 'cadastros', pessoas: 'cadastros', etapas: 'cadastros', vendedores: 'tatico', finders: 'tatico' },
  seller: { dashboard: 'meus-dados', vendas: 'meus-dados', comissoes: 'meus-dados', leads: 'meus-dados', produtos: 'meus-dados', pessoas: 'meus-dados', etapas: 'meus-dados', vendedores: 'meus-dados', finders: 'meus-dados' },
  finder: { dashboard: 'meus-dados', vendas: 'meus-dados', comissoes: 'meus-dados', leads: 'meus-dados', produtos: 'meus-dados', pessoas: 'meus-dados', etapas: 'meus-dados', vendedores: 'meus-dados', finders: 'meus-dados' },
  adminSeller: { dashboard: 'tatico', vendas: 'operacional', comissoes: 'operacional', leads: 'operacional', produtos: 'cadastros', pessoas: 'cadastros', etapas: 'cadastros', vendedores: 'meus-dados', finders: 'tatico' },
  adminFinder: { dashboard: 'tatico', vendas: 'operacional', comissoes: 'operacional', leads: 'operacional', produtos: 'cadastros', pessoas: 'cadastros', etapas: 'cadastros', vendedores: 'tatico', finders: 'meus-dados' },
  sellerFinder: { dashboard: 'meus-dados', vendas: 'meus-dados', comissoes: 'meus-dados', leads: 'meus-dados', produtos: 'meus-dados', pessoas: 'meus-dados', etapas: 'meus-dados', vendedores: 'meus-dados', finders: 'meus-dados' },
  everything: { dashboard: 'tatico', vendas: 'operacional', comissoes: 'operacional', leads: 'operacional', produtos: 'cadastros', pessoas: 'cadastros', etapas: 'cadastros', vendedores: 'meus-dados', finders: 'meus-dados' },
};

const VISIBLE_LEADS: Record<ComboName, SalesOpsWorkspace[]> = {
  none: [],
  admin: ['operacional', 'cadastros'],
  seller: ['meus-dados'],
  finder: [],
  adminSeller: ['operacional', 'cadastros'],
  adminFinder: ['operacional', 'cadastros'],
  sellerFinder: ['meus-dados'],
  everything: ['operacional', 'cadastros'],
};

const DEFAULT_PATH_LEADS: Record<ComboName, string> = {
  none: '/tatico/dashboard',
  admin: '/operacional/leads',
  seller: '/meus-dados/leads',
  finder: '/tatico/dashboard',
  adminSeller: '/operacional/leads',
  adminFinder: '/operacional/leads',
  sellerFinder: '/meus-dados/leads',
  everything: '/operacional/leads',
};

/** Preferred workspace order: tatico, operacional, cadastros, meus-dados. */
const PREFERRED_PATH_LEADS: Record<ComboName, [string, string, string, string]> = {
  none: ['/tatico/dashboard', '/tatico/dashboard', '/tatico/dashboard', '/tatico/dashboard'],
  admin: ['/operacional/leads', '/operacional/leads', '/cadastros/pessoas', '/operacional/leads'],
  seller: ['/meus-dados/leads', '/meus-dados/leads', '/meus-dados/leads', '/meus-dados/leads'],
  finder: ['/tatico/dashboard', '/tatico/dashboard', '/tatico/dashboard', '/tatico/dashboard'],
  adminSeller: ['/operacional/leads', '/operacional/leads', '/cadastros/pessoas', '/operacional/leads'],
  adminFinder: ['/operacional/leads', '/operacional/leads', '/cadastros/pessoas', '/operacional/leads'],
  sellerFinder: ['/meus-dados/leads', '/meus-dados/leads', '/meus-dados/leads', '/meus-dados/leads'],
  everything: ['/operacional/leads', '/operacional/leads', '/cadastros/pessoas', '/operacional/leads'],
};

/** Role-independent team workspaces: the role set is ignored for these three. */
const TEAM_NAV_LEADS: Record<'tatico' | 'operacional' | 'cadastros', Array<[SalesOpsView, string]>> = {
  'tatico': [],
  'operacional': [['leads', 'Prospecção']],
  'cadastros': [['pessoas', 'Vendedores'], ['etapas', 'Etapas do funil']],
};

const MEUS_DADOS_NAV_LEADS: Record<ComboName, Array<[SalesOpsView, string]>> = {
  none: [],
  admin: [],
  seller: [['leads', 'Minha prospecção']],
  finder: [],
  adminSeller: [['leads', 'Minha prospecção']],
  adminFinder: [],
  sellerFinder: [['leads', 'Minha prospecção']],
  everything: [['leads', 'Minha prospecção']],
};

/** url -> [resolved path, redirect]. */
const RESOLVE_LEADS: Record<ComboName, Record<string, [string, boolean]>> = {
  none: {
    '/tatico/dashboard': ['/tatico/dashboard', true],
    '/operacional/vendas': ['/tatico/dashboard', true],
    '/operacional/comissoes': ['/tatico/dashboard', true],
    '/operacional/leads': ['/tatico/dashboard', true],
    '/cadastros/produtos': ['/tatico/dashboard', true],
    '/cadastros/pessoas': ['/tatico/dashboard', true],
    '/cadastros/vendedores': ['/tatico/dashboard', true],
    '/cadastros/etapas': ['/tatico/dashboard', true],
    '/cadastros/importacao': ['/tatico/dashboard', true],
    '/cadastros/geral': ['/tatico/dashboard', true],
    '/meus-dados/vendedores': ['/tatico/dashboard', true],
    '/meus-dados/comissoes': ['/tatico/dashboard', true],
    '/meus-dados/leads': ['/tatico/dashboard', true],
    '/meus-dados/finders': ['/tatico/dashboard', true],
    '/meus-dados/vendas': ['/tatico/dashboard', true],
  },
  admin: {
    '/tatico/dashboard': ['/operacional/leads', true],
    '/operacional/vendas': ['/operacional/leads', true],
    '/operacional/comissoes': ['/operacional/leads', true],
    '/operacional/leads': ['/operacional/leads', false],
    '/cadastros/produtos': ['/operacional/leads', true],
    '/cadastros/pessoas': ['/cadastros/pessoas', false],
    '/cadastros/vendedores': ['/cadastros/pessoas', true],
    '/cadastros/etapas': ['/cadastros/etapas', false],
    '/cadastros/importacao': ['/operacional/leads', true],
    '/cadastros/geral': ['/operacional/leads', true],
    '/meus-dados/vendedores': ['/operacional/leads', true],
    '/meus-dados/comissoes': ['/operacional/leads', true],
    '/meus-dados/leads': ['/operacional/leads', true],
    '/meus-dados/finders': ['/operacional/leads', true],
    '/meus-dados/vendas': ['/operacional/leads', true],
  },
  seller: {
    '/tatico/dashboard': ['/meus-dados/leads', true],
    '/operacional/vendas': ['/meus-dados/leads', true],
    '/operacional/comissoes': ['/meus-dados/leads', true],
    '/operacional/leads': ['/meus-dados/leads', true],
    '/cadastros/produtos': ['/meus-dados/leads', true],
    '/cadastros/pessoas': ['/meus-dados/leads', true],
    '/cadastros/vendedores': ['/meus-dados/leads', true],
    '/cadastros/etapas': ['/meus-dados/leads', true],
    '/cadastros/importacao': ['/meus-dados/leads', true],
    '/cadastros/geral': ['/meus-dados/leads', true],
    '/meus-dados/vendedores': ['/meus-dados/leads', true],
    '/meus-dados/comissoes': ['/meus-dados/leads', true],
    '/meus-dados/leads': ['/meus-dados/leads', false],
    '/meus-dados/finders': ['/meus-dados/leads', true],
    '/meus-dados/vendas': ['/meus-dados/leads', true],
  },
  finder: {
    '/tatico/dashboard': ['/tatico/dashboard', true],
    '/operacional/vendas': ['/tatico/dashboard', true],
    '/operacional/comissoes': ['/tatico/dashboard', true],
    '/operacional/leads': ['/tatico/dashboard', true],
    '/cadastros/produtos': ['/tatico/dashboard', true],
    '/cadastros/pessoas': ['/tatico/dashboard', true],
    '/cadastros/vendedores': ['/tatico/dashboard', true],
    '/cadastros/etapas': ['/tatico/dashboard', true],
    '/cadastros/importacao': ['/tatico/dashboard', true],
    '/cadastros/geral': ['/tatico/dashboard', true],
    '/meus-dados/vendedores': ['/tatico/dashboard', true],
    '/meus-dados/comissoes': ['/tatico/dashboard', true],
    '/meus-dados/leads': ['/tatico/dashboard', true],
    '/meus-dados/finders': ['/tatico/dashboard', true],
    '/meus-dados/vendas': ['/tatico/dashboard', true],
  },
  adminSeller: {
    '/tatico/dashboard': ['/operacional/leads', true],
    '/operacional/vendas': ['/operacional/leads', true],
    '/operacional/comissoes': ['/operacional/leads', true],
    '/operacional/leads': ['/operacional/leads', false],
    '/cadastros/produtos': ['/operacional/leads', true],
    '/cadastros/pessoas': ['/cadastros/pessoas', false],
    '/cadastros/vendedores': ['/cadastros/pessoas', true],
    '/cadastros/etapas': ['/cadastros/etapas', false],
    '/cadastros/importacao': ['/operacional/leads', true],
    '/cadastros/geral': ['/operacional/leads', true],
    '/meus-dados/vendedores': ['/operacional/leads', true],
    '/meus-dados/comissoes': ['/operacional/leads', true],
    '/meus-dados/leads': ['/operacional/leads', true],
    '/meus-dados/finders': ['/operacional/leads', true],
    '/meus-dados/vendas': ['/operacional/leads', true],
  },
  adminFinder: {
    '/tatico/dashboard': ['/operacional/leads', true],
    '/operacional/vendas': ['/operacional/leads', true],
    '/operacional/comissoes': ['/operacional/leads', true],
    '/operacional/leads': ['/operacional/leads', false],
    '/cadastros/produtos': ['/operacional/leads', true],
    '/cadastros/pessoas': ['/cadastros/pessoas', false],
    '/cadastros/vendedores': ['/cadastros/pessoas', true],
    '/cadastros/etapas': ['/cadastros/etapas', false],
    '/cadastros/importacao': ['/operacional/leads', true],
    '/cadastros/geral': ['/operacional/leads', true],
    '/meus-dados/vendedores': ['/operacional/leads', true],
    '/meus-dados/comissoes': ['/operacional/leads', true],
    '/meus-dados/leads': ['/operacional/leads', true],
    '/meus-dados/finders': ['/operacional/leads', true],
    '/meus-dados/vendas': ['/operacional/leads', true],
  },
  sellerFinder: {
    '/tatico/dashboard': ['/meus-dados/leads', true],
    '/operacional/vendas': ['/meus-dados/leads', true],
    '/operacional/comissoes': ['/meus-dados/leads', true],
    '/operacional/leads': ['/meus-dados/leads', true],
    '/cadastros/produtos': ['/meus-dados/leads', true],
    '/cadastros/pessoas': ['/meus-dados/leads', true],
    '/cadastros/vendedores': ['/meus-dados/leads', true],
    '/cadastros/etapas': ['/meus-dados/leads', true],
    '/cadastros/importacao': ['/meus-dados/leads', true],
    '/cadastros/geral': ['/meus-dados/leads', true],
    '/meus-dados/vendedores': ['/meus-dados/leads', true],
    '/meus-dados/comissoes': ['/meus-dados/leads', true],
    '/meus-dados/leads': ['/meus-dados/leads', false],
    '/meus-dados/finders': ['/meus-dados/leads', true],
    '/meus-dados/vendas': ['/meus-dados/leads', true],
  },
  everything: {
    '/tatico/dashboard': ['/operacional/leads', true],
    '/operacional/vendas': ['/operacional/leads', true],
    '/operacional/comissoes': ['/operacional/leads', true],
    '/operacional/leads': ['/operacional/leads', false],
    '/cadastros/produtos': ['/operacional/leads', true],
    '/cadastros/pessoas': ['/cadastros/pessoas', false],
    '/cadastros/vendedores': ['/cadastros/pessoas', true],
    '/cadastros/etapas': ['/cadastros/etapas', false],
    '/cadastros/importacao': ['/operacional/leads', true],
    '/cadastros/geral': ['/operacional/leads', true],
    '/meus-dados/vendedores': ['/operacional/leads', true],
    '/meus-dados/comissoes': ['/operacional/leads', true],
    '/meus-dados/leads': ['/operacional/leads', true],
    '/meus-dados/finders': ['/operacional/leads', true],
    '/meus-dados/vendas': ['/operacional/leads', true],
  },
};

const WORKSPACE_FOR_VIEW_LEADS: Record<ComboName, Partial<Record<SalesOpsView, SalesOpsWorkspace>>> = {
  none: { dashboard: 'tatico', vendas: 'tatico', comissoes: 'tatico', leads: 'tatico', produtos: 'tatico', pessoas: 'tatico', etapas: 'tatico', vendedores: 'tatico', finders: 'tatico' },
  admin: { dashboard: 'operacional', vendas: 'operacional', comissoes: 'operacional', leads: 'operacional', produtos: 'operacional', pessoas: 'cadastros', etapas: 'cadastros', vendedores: 'operacional', finders: 'operacional' },
  seller: { dashboard: 'meus-dados', vendas: 'meus-dados', comissoes: 'meus-dados', leads: 'meus-dados', produtos: 'meus-dados', pessoas: 'meus-dados', etapas: 'meus-dados', vendedores: 'meus-dados', finders: 'meus-dados' },
  finder: { dashboard: 'tatico', vendas: 'tatico', comissoes: 'tatico', leads: 'tatico', produtos: 'tatico', pessoas: 'tatico', etapas: 'tatico', vendedores: 'tatico', finders: 'tatico' },
  adminSeller: { dashboard: 'operacional', vendas: 'operacional', comissoes: 'operacional', leads: 'operacional', produtos: 'operacional', pessoas: 'cadastros', etapas: 'cadastros', vendedores: 'operacional', finders: 'operacional' },
  adminFinder: { dashboard: 'operacional', vendas: 'operacional', comissoes: 'operacional', leads: 'operacional', produtos: 'operacional', pessoas: 'cadastros', etapas: 'cadastros', vendedores: 'operacional', finders: 'operacional' },
  sellerFinder: { dashboard: 'meus-dados', vendas: 'meus-dados', comissoes: 'meus-dados', leads: 'meus-dados', produtos: 'meus-dados', pessoas: 'meus-dados', etapas: 'meus-dados', vendedores: 'meus-dados', finders: 'meus-dados' },
  everything: { dashboard: 'operacional', vendas: 'operacional', comissoes: 'operacional', leads: 'operacional', produtos: 'operacional', pessoas: 'cadastros', etapas: 'cadastros', vendedores: 'operacional', finders: 'operacional' },
};
```

Then the `describe` blocks:

```ts
/** `undefined` is the call with NO edition argument; it must equal 'full' and today. */
const FULL_CALLS = [undefined, 'full'] as const;

describe('full edition is exactly today (FXL)', () => {
  it('keeps the workspace catalogue object and literals', () => {
    expect(getSalesOpsWorkspaces()).toBe(salesOpsWorkspaces);
    expect(getSalesOpsWorkspaces('full')).toBe(salesOpsWorkspaces);
    expect(salesOpsWorkspaces).toEqual([
      { id: 'tatico', label: 'Tático', description: 'Indicadores e painéis' },
      { id: 'operacional', label: 'Operacional', description: 'Propostas e conferência' },
      { id: 'cadastros', label: 'Cadastros', description: 'Pessoas, catálogo e regras' },
      { id: 'meus-dados', label: 'Meus dados', description: 'Painel e comissões pessoais' },
    ]);
  });

  for (const edition of FULL_CALLS) {
    describe(`edition argument ${String(edition)}`, () => {
      it.each(COMBO_NAMES)('visible workspaces for %s', (name) => {
        expect(getVisibleWorkspaces(COMBOS[name], edition)).toEqual(VISIBLE_FULL[name]);
      });
      it.each(COMBO_NAMES)('navigation for %s', (name) => {
        for (const workspace of TEAM_WORKSPACES) {
          expect(pairs(getSalesOpsNavigation(workspace, COMBOS[name], edition))).toEqual(
            TEAM_NAV_FULL[workspace],
          );
        }
        expect(pairs(getSalesOpsNavigation('meus-dados', COMBOS[name], edition))).toEqual(
          MEUS_DADOS_NAV_FULL[name],
        );
      });
      it.each(COMBO_NAMES)('default route for %s, with and without a preferred workspace', (name) => {
        expect(buildSalesOpsPath(getDefaultSalesOpsRoute(COMBOS[name], undefined, edition))).toBe(
          DEFAULT_PATH_FULL[name],
        );
        WORKSPACES.forEach((workspace, index) => {
          expect(
            buildSalesOpsPath(getDefaultSalesOpsRoute(COMBOS[name], workspace, edition)),
          ).toBe(PREFERRED_PATH_FULL[name][index]);
        });
      });
      it.each(COMBO_NAMES)('resolves every URL for %s', (name) => {
        for (const url of URLS) {
          const resolution = resolveSalesOpsRoute(params(url), COMBOS[name], edition);
          expect([resolution.path, resolution.redirect]).toEqual(RESOLVE_FULL[name][url]);
        }
      });
      it.each(COMBO_NAMES)('workspaceForView for %s', (name) => {
        for (const [view, workspace] of Object.entries(WORKSPACE_FOR_VIEW_FULL[name])) {
          expect(workspaceForView(view as SalesOpsView, COMBOS[name], edition)).toBe(workspace);
        }
      });
      it('settles exactly as before', () => {
        expect(canSettleInWorkspace('operacional', ['admin'], edition)).toBe(true);
        expect(canSettleInWorkspace('operacional', ['seller'], edition)).toBe(false);
        expect(canSettleInWorkspace('meus-dados', ['admin'], edition)).toBe(false);
      });
    });
  }
});

describe('leads edition (Construbom)', () => {
  it.each(COMBO_NAMES)('visible workspaces for %s', (name) => {
    expect(getVisibleWorkspaces(COMBOS[name], 'leads')).toEqual(VISIBLE_LEADS[name]);
  });
  it.each(COMBO_NAMES)('navigation for %s', (name) => {
    for (const workspace of TEAM_WORKSPACES) {
      expect(pairs(getSalesOpsNavigation(workspace, COMBOS[name], 'leads'))).toEqual(
        TEAM_NAV_LEADS[workspace],
      );
    }
    expect(pairs(getSalesOpsNavigation('meus-dados', COMBOS[name], 'leads'))).toEqual(
      MEUS_DADOS_NAV_LEADS[name],
    );
  });
  it.each(COMBO_NAMES)('default route for %s', (name) => {
    expect(buildSalesOpsPath(getDefaultSalesOpsRoute(COMBOS[name], undefined, 'leads'))).toBe(
      DEFAULT_PATH_LEADS[name],
    );
    WORKSPACES.forEach((workspace, index) => {
      expect(buildSalesOpsPath(getDefaultSalesOpsRoute(COMBOS[name], workspace, 'leads'))).toBe(
        PREFERRED_PATH_LEADS[name][index],
      );
    });
  });
  it.each(COMBO_NAMES)('resolves every URL for %s, redirecting all others to the role default', (name) => {
    for (const url of URLS) {
      const resolution = resolveSalesOpsRoute(params(url), COMBOS[name], 'leads');
      expect([resolution.path, resolution.redirect]).toEqual(RESOLVE_LEADS[name][url]);
    }
  });
  it.each(COMBO_NAMES)('workspaceForView for %s', (name) => {
    for (const [view, workspace] of Object.entries(WORKSPACE_FOR_VIEW_LEADS[name])) {
      expect(workspaceForView(view as SalesOpsView, COMBOS[name], 'leads')).toBe(workspace);
    }
  });
  it('drops a proposta id: there is no vendas view', () => {
    const resolution = resolveSalesOpsRoute(
      { workspace: 'operacional', view: 'vendas', saleId: '5b0e7c1e-3f4a-4c2d-9e8b-1a2b3c4d5e6f' },
      ['admin', 'seller', 'finder'],
      'leads',
    );
    expect(resolution).toEqual({
      route: { workspace: 'operacional', view: 'leads' },
      path: '/operacional/leads',
      redirect: true,
    });
    expect('saleId' in resolution.route).toBe(false);
  });
  it('never settles', () => {
    expect(canSettleInWorkspace('operacional', ['admin'], 'leads')).toBe(false);
  });
});

describe('leads edition labels', () => {
  it('describes operacional as Prospecção and changes nothing else in the catalogue', () => {
    expect(getSalesOpsWorkspaces('leads')).toEqual([
      { id: 'tatico', label: 'Tático', description: 'Indicadores e painéis' },
      { id: 'operacional', label: 'Operacional', description: 'Prospecção' },
      { id: 'cadastros', label: 'Cadastros', description: 'Pessoas, catálogo e regras' },
      { id: 'meus-dados', label: 'Meus dados', description: 'Painel e comissões pessoais' },
    ]);
    // The full catalogue object was not mutated by building the leads one.
    expect(salesOpsWorkspaces[1]).toEqual({
      id: 'operacional',
      label: 'Operacional',
      description: 'Propostas e conferência',
    });
  });
  it('labels the pessoas screen Vendedores only in the leads edition', () => {
    const leadsLabel = getSalesOpsNavigation('cadastros', ['admin'], 'leads').find(
      (item) => item.id === 'pessoas',
    )?.label;
    const fullLabel = getSalesOpsNavigation('cadastros', ['admin']).find(
      (item) => item.id === 'pessoas',
    )?.label;
    expect(leadsLabel).toBe('Vendedores');
    expect(fullLabel).toBe('Pessoas');
  });
  it('keeps Prospecção and Minha prospecção as the lead screen labels', () => {
    expect(getSalesOpsNavigation('operacional', ['admin'], 'leads')[0]?.label).toBe('Prospecção');
    expect(getSalesOpsNavigation('meus-dados', ['seller'], 'leads')[0]?.label).toBe(
      'Minha prospecção',
    );
  });
});
```

Mutations this file must kill (check by hand once, then revert): deleting the `edition === 'leads'` branch of `getVisibleWorkspaces`; returning the leads lists for `'full'`; making `admin` also add `meus-dados` in the leads edition; passing `edition` to only one of the two `getSalesOpsNavigation` calls inside `getDefaultSalesOpsRoute`; dropping `edition` from the `resolveSalesOpsRoute` fallback.

### 7b. `apps/web/src/sales-ops/__tests__/navigation.test.ts`

Add `getSalesOpsWorkspaces` to the import and one test at the end of the existing `describe`:

```ts
  it('hands the full edition the very same workspace catalogue', () => {
    expect(getSalesOpsWorkspaces()).toBe(salesOpsWorkspaces);
  });
```

No existing assertion changes.

### 7c. `apps/web/src/auth/__tests__/react.test.tsx`

1. Add `useSalesEdition` to the `from '../react'` import.
2. Add a helper and a probe after `OrganizationProbe`:

```ts
/** A token shaped like the Hub mints it, with an optional `entitlements` claim. */
function editionToken(entitlements?: unknown, workspaceName = 'Alpha'): string {
  return jwt({
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    workspaceName,
    roles: { workspace: 'admin' },
    workspaces: [
      { workspaceId: 'workspace-alpha', name: 'Alpha' },
      { workspaceId: 'workspace-beta', name: 'Beta' },
    ],
    ...(entitlements === undefined ? {} : { entitlements }),
  });
}

function EditionProbe() {
  const profile = useAuthProfile();
  const edition = useSalesEdition();
  return <output data-testid="edition">{`${profile.edition}|${edition}`}</output>;
}

function renderEditionProvider() {
  const host = document.createElement('div');
  document.body.append(host);
  const editionRoot = createRoot(host);
  act(() => {
    editionRoot.render(
      <QueryClientProvider client={queryClient}>
        <AppAuthProvider>
          <EditionProbe />
          <UserControls />
        </AppAuthProvider>
      </QueryClientProvider>,
    );
  });
  return { container: host, root: editionRoot };
}

const editionText = (host: HTMLElement) =>
  host.querySelector('[data-testid="edition"]')?.textContent;
```

3. New `describe('Sales edition from the token', ...)` at the end of the file, each case assigning `({ container, root } = renderEditionProvider());` so the shared `afterEach` unmounts it:

| case | `mocks.cache.getToken` resolves | expected `editionText` |
| --- | --- | --- |
| `reads the leads edition from entitlements.modules` | `ok(editionToken({ access: true, modules: ['sales.edition.leads'] }))` | `'leads|leads'` |
| `stays full when the token carries no entitlements claim` | `ok(editionToken())` | `'full|full'` |
| `stays full for empty modules` | `ok(editionToken({ access: true, modules: [] }))` | `'full|full'` |
| `stays full for unknown or malformed modules` | `ok(editionToken({ access: true, modules: ['sales.edition.leadsx', 42, null] }))` | `'full|full'` |
| `stays full when modules is not an array` | `ok(editionToken({ access: true, modules: 'sales.edition.leads' }))` | `'full|full'` |
| `is full while signed out` | `expired` | `'full|full'` |
| `reads the module beside paid add-ons` | `ok(editionToken({ access: true, modules: ['sales.addon.x', 'sales.edition.leads'] }))` | `'leads|leads'` |

Each case: set the mock, render, `await flushReact()`, assert.

4. One switch case in the same describe, `flips the edition with the token on a workspace switch`:
   - `mocks.cache.getToken.mockResolvedValue(ok(editionToken({ access: true, modules: [] })))`;
   - `mocks.client.setActive.mockResolvedValue({ accessToken: editionToken({ access: true, modules: ['sales.edition.leads'] }, 'Beta'), expiresIn: 120, organizationId: 'workspace-beta' })`;
   - render, flush, expect `'full|full'`, then `await switchWorkspace(container, 'Beta')` (existing helper) and expect `'leads|leads'`.

### 7d. `apps/web/src/dev/__tests__/dev-identity-roles.test.tsx`

1. `Probe` becomes:

```tsx
function Probe() {
  const { roles, edition } = useAuthProfile();
  return (
    <output data-testid="workspaces">{getVisibleWorkspaces(roles, edition).join(',')}</output>
  );
}
```

Every existing assertion stays green (every roster identity carries `modules: []`, so `edition` is `'full'`).
This is also what lets slice 08 declare `expectedPaineis` for its leads identities against the real edition.

2. Add one test after `takes its roles only from the minted token, never from a fixture profile`, mirroring its hand-built session:

```ts
  it('decodes the leads edition from a dev-minted token through the real provider', async () => {
    vi.stubEnv('VITE_AUTH_FAKE', '1');
    const fake = await import('@fxl-sales/auth-fake');
    const identity = fake.findIdentity('team-owner');
    if (!identity) throw new Error('team-owner identity missing from the roster');

    const claims = fake.toHubClaims(identity) as Record<string, unknown>;
    claims.entitlements = { access: true, modules: ['sales.edition.leads'] };
    const leadsToken = jwt(claims);

    setDevIdentitySession({
      identityId: identity.id,
      label: identity.label,
      client: buildStubClient(leadsToken),
      requestToken: async () => ({ token: leadsToken }),
    });

    const { host, root } = renderProbe();
    await flush();

    // The owner holds every role; the leads edition still shows the gestor only these two.
    expect(workspacesText(host)).toBe('operacional,cadastros');

    teardown(host, root);
  });
```

### 7e. `apps/web/src/__tests__/no-role-redirect.test.tsx`

1. Add `import type { SalesEdition } from '@fxl-sales/shared-utils/sales-edition';`, a module `let profileEdition: SalesEdition | undefined;`, `edition: profileEdition,` in the mocked `useAuthProfile`, and `profileEdition = undefined;` in `beforeEach`.
2. New `describe('the leads edition shares one predicate between NoRoleGuard and SalesOpsApp', ...)`:

```ts
  it.each([
    [['admin', 'seller', 'finder'] as AppRole[], '/operacional/leads'],
    [['admin'] as AppRole[], '/operacional/leads'],
    [['seller'] as AppRole[], '/meus-dados/leads'],
    [['seller', 'finder'] as AppRole[], '/meus-dados/leads'],
  ])('sends a leads-edition %j operator from /no-role to %s in exactly two navigations', async (roles, destination) => {
    profileEdition = 'leads';
    profileRoles = roles;
    await renderAt('/no-role');
    expect(visited).toEqual(['/no-role', '/', destination]);
    expect(container.textContent).not.toContain(UNAUTHORIZED);
  });

  /** THE decisive case: keyed on roles alone, NoRoleGuard ping-pongs here. */
  it('keeps a leads-edition finder-only operator on /no-role without a loop', async () => {
    profileEdition = 'leads';
    profileRoles = ['finder'];
    await renderAt('/no-role');
    expect(visited).toEqual(['/no-role']);
    expect(container.textContent).toContain(UNAUTHORIZED);
  });

  it('sends a leads-edition finder-only operator entering at / to /no-role and stops there', async () => {
    profileEdition = 'leads';
    profileRoles = ['finder'];
    await renderAt('/');
    expect(visited).toEqual(['/', '/no-role']);
    expect(container.textContent).toContain(UNAUTHORIZED);
  });

  it.each(NON_EMPTY_ROLE_SETS)(
    'in the leads edition the default route for %j is canonical whenever a workspace is visible',
    (roles) => {
      if (getVisibleWorkspaces(roles, 'leads').length === 0) {
        expect(roles).toEqual(['finder']);
        return;
      }
      const route = getDefaultSalesOpsRoute(roles, undefined, 'leads');
      const resolution = resolveSalesOpsRoute(route, roles, 'leads');
      expect(resolution.redirect).toBe(false);
      expect(resolution.path).toBe(buildSalesOpsPath(route));
    },
  );
```

`NON_EMPTY_ROLE_SETS` is declared later in the file today (line ~393); move the new `describe` BELOW that declaration (after the existing ping-pong `describe`) so the constant is initialised.

### 7g. SEAM A5: `useSalesEdition` in every existing `@/auth/react` mock

Add `useSalesEdition: () => 'full',` to the returned object of the `vi.mock('@/auth/react', ...)` factory in each of these 24 files (the exact output of `grep -rln "vi.mock('@/auth/react'" apps/web/src` on master 554362b):
`__tests__/no-role-redirect.test.tsx`, `admin/products/__tests__/useProducts.test.ts`, `admin/sellers/__tests__/AdminSellersPage.test.tsx`, `sales-ops/__tests__/blank-bearer-token.test.tsx`, `cadastro-history.test.tsx`, `cadastros-refresh.test.tsx`, `entitlement-dead-end.test.tsx`, `financial-mutation-forbidden.test.tsx`, `forbidden-panel.test.tsx`, `leads-routing.test.tsx`, `missing-entitlement-panel.test.tsx`, `month-totals.test.tsx`, `optimistic-row-guard.test.tsx`, `routing.test.tsx`, `sale-deep-link.test.tsx`, `sale-wizard-save-error.test.tsx`, `sales-settlement-visibility.test.tsx`, `settings-currency-brl.test.tsx`, `shell-organization-switcher.test.tsx` (all under `sales-ops/__tests__/`), `sales-ops/import/__tests__/import-routing.test.tsx`, `import-view.test.tsx`, `sales-ops/leads/__tests__/lead-conversion.test.tsx`, `leads-board-fanout.test.ts`, `leads-move-rollback.test.ts`.
Exceptions: in `leads-routing.test.tsx` and `no-role-redirect.test.tsx` write `useSalesEdition: () => profileEdition ?? 'full',` so the hook agrees with the mocked profile.
If a factory spreads `importActual`, still add the key explicitly.
No other line of those files changes.

New guard `apps/web/src/auth/__tests__/auth-mock-edition-export.test.ts` (node environment): walk `apps/web/src` with `node:fs` (`readdirSync(..., { withFileTypes: true })`), read every `*.test.ts` / `*.test.tsx`, and collect the files whose text contains `vi.mock('@/auth/react'`.
Assert the collected list has at least 24 entries (non-vacuity) and that every collected file's text also contains `useSalesEdition` (failure message names the file).
Mutation check: delete the key from one factory, the guard must fail.

### 7f. `apps/web/src/sales-ops/__tests__/leads-routing.test.tsx` (the shell render test)

1. Imports: add `useLocation` to the `react-router-dom` import and `import type { SalesEdition } from '@fxl-sales/shared-utils/sales-edition';`.
2. Add `let profileEdition: SalesEdition | undefined;` beside `profileRoles`, and `edition: profileEdition,` to the mocked `useAuthProfile` return.
3. Add before `renderRoute`:

```tsx
function LocationProbe() {
  const { pathname } = useLocation();
  return <output data-testid="location-path">{pathname}</output>;
}

const locationPath = () =>
  container.querySelector('[data-testid="location-path"]')?.textContent;
```

4. `renderRoute(path: string, roles: AppRole[], edition?: SalesEdition)`: set `profileEdition = edition;` next to `profileRoles = [...roles];`, render `<LocationProbe />` inside `MemoryRouter` after `</Routes>`, and replace the single trailing `await act(async () => Promise.resolve());` with a loop of three (as `no-role-redirect.test.tsx` does) so a `<Navigate>` hop settles. Existing tests pass no third argument and are unaffected.
5. Helpers:

```ts
const navLabel = (label: string) => container.querySelector(`aside button[aria-label="${label}"]`);

async function openWorkspaceMenu() {
  const trigger = container.querySelector<HTMLButtonElement>('button[title="Trocar painel"]');
  if (!trigger) throw new Error('Trocar painel trigger not rendered');
  await act(async () => trigger.click());
}

/** The menu rows under the `Painéis` heading, in render order. */
function workspaceMenuLabels(): string[] {
  const heading = [...container.querySelectorAll('aside div')].find(
    (node) => node.textContent?.trim() === 'Painéis',
  );
  const menu = heading?.parentElement;
  if (!menu) throw new Error('Painéis menu not open');
  return [...menu.querySelectorAll(':scope > button')].map((button) => button.textContent?.trim() ?? '');
}
```

6. Every leads-edition case below renders with the bootstrap fixture's `settings` set to `null` (a freshly activated leads-edition org has no settings row; slice 08 seeds none), proving the shell renders on `settings: null`.
7. New `describe('the leads edition inside the Sales Ops shell', ...)`:

| test | render | assertions |
| --- | --- | --- |
| `lands a leads-edition gestor on operacional/leads` | `renderRoute('/', ['admin', 'seller', 'finder'], 'leads')` | `locationPath()` is `'/operacional/leads'`; `[data-leads-board]` present; `h1` text `'Prospecção'`. |
| `redirects operacional/vendas to the gestor default` | `renderRoute('/operacional/vendas', ['admin', 'seller', 'finder'], 'leads')` | `locationPath()` is `'/operacional/leads'`; header has no `'Nova proposta'`. |
| `redirects every screen outside the edition` | loop over `['/tatico/dashboard', '/operacional/comissoes', '/cadastros/produtos', '/cadastros/funcoes', '/cadastros/importacao', '/cadastros/geral', '/meus-dados/leads', '/meus-dados/vendedores']`, each `renderRoute(path, ['admin', 'seller', 'finder'], 'leads')` | `locationPath()` is `'/operacional/leads'` each time. |
| `shows the gestor only Prospecção in operacional` | `renderRoute('/operacional/leads', ['admin', 'seller', 'finder'], 'leads')` | `navLabel('Prospecção')` not null; `navLabel('Propostas')` and `navLabel('Comissões')` null. |
| `shows Vendedores and Etapas do funil in cadastros` | `renderRoute('/cadastros/etapas', ['admin', 'seller', 'finder'], 'leads')` | `navLabel('Vendedores')` and `navLabel('Etapas do funil')` not null; `navLabel('Pessoas')`, `navLabel('Produtos & Serviços')`, `navLabel('Funções')`, `navLabel('Importação')`, `navLabel('Geral')` all null; `[data-lead-stages]` present. |
| `offers only Operacional and Cadastros under Trocar painel` | `renderRoute('/operacional/leads', ['admin', 'seller', 'finder'], 'leads')`, `await openWorkspaceMenu()` | `workspaceMenuLabels()` equals `['Operacional', 'Cadastros']`; click the `Cadastros` row inside `act`, settle three ticks, `locationPath()` is `'/cadastros/pessoas'`. |
| `lands a leads-edition vendedor on meus-dados/leads only` | `renderRoute('/', ['seller'], 'leads')` | `locationPath()` `'/meus-dados/leads'`; `boardProps().showSellerFilter` is `false`; `navLabel('Meu painel')` and `navLabel('Comissões')` null; then `renderRoute('/meus-dados/vendedores', ['seller'], 'leads')` gives `'/meus-dados/leads'`. |
| `full edition control: the same gestor lands on tatico/dashboard` | `renderRoute('/', ['admin', 'seller', 'finder'], 'full')` then `renderRoute('/', ['admin', 'seller', 'finder'])` | `locationPath()` is `'/tatico/dashboard'` both times; `openWorkspaceMenu()` then `workspaceMenuLabels()` equals `['Tático', 'Operacional', 'Cadastros', 'Meus dados']`. |

The `/cadastros/etapas` case is chosen over `/cadastros/pessoas` on purpose: the Pessoas body is slice 07's.

## Step 8 - run-once verification

```bash
pnpm run build:packages
pnpm --filter @fxl-sales/web test -- src/auth/__tests__/auth-mock-edition-export.test.ts
pnpm --filter @fxl-sales/web test -- src/sales-ops/__tests__/navigation-edition.test.ts src/sales-ops/__tests__/navigation.test.ts
pnpm --filter @fxl-sales/web test -- src/auth/__tests__/react.test.tsx src/dev/__tests__/dev-identity-roles.test.tsx
pnpm --filter @fxl-sales/web test -- src/__tests__/no-role-redirect.test.tsx src/sales-ops/__tests__/leads-routing.test.tsx
pnpm --filter @fxl-sales/web test
pnpm --filter @fxl-sales/web lint
pnpm --filter @fxl-sales/web type-check
pnpm --filter @fxl-sales/web build
```

`test` is `vitest run` (run-once), so no watcher is left behind.
Then a manual mutation check of the five mutations listed in 7a (each must turn `navigation-edition.test.ts` red), reverted before commit.
Lint on changed files must be clean; any pre-existing lint or flaky test met on the way is fixed, not skipped.

## Seam notes for downstream slices

- Slices 06 and 07: Step 7g already added `useSalesEdition: () => 'full'` to every existing mock (SEAM A5), and the guard test fails on any new mock without it.
  Slice 06's container calls `useSalesEdition()`; slice 07 reuses this slice's `edition` variable inside `SalesOpsApp`.
- Slice 07: `titleForView('pessoas')` still renders the page `h1` `Pessoas` and its subtitle; in the leads edition the sidebar says `Vendedores`, so slice 07 owns making the title and header action edition-aware.
- Slice 08: `dev-identity-roles.test.tsx`'s `Probe` now passes `edition`, so `leads-owner` must declare `expectedPaineis: ['operacional', 'cadastros']` and `leads-seller` `['meus-dados']`.
