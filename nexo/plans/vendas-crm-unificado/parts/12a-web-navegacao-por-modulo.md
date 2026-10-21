# Part 12a-web-navegacao-por-modulo of slice 12-web-modulos-navegacao

Original frontmatter (for reference, not a slice):

```yaml
id: 12a-web-navegacao-por-modulo
milestone: v4.8.0
status: todo
depends_on: ["11a-api-modulos-nucleo"]
files_modified: ["apps/web/src/sales-ops/org-modules.ts", "apps/web/src/sales-ops/navigation.ts", "apps/web/src/sales-ops/SalesOpsApp.tsx", "apps/web/src/components/auth/RoleGuard.tsx", "apps/web/src/sales-ops/__tests__/navigation-edition.test.ts", "apps/web/src/sales-ops/__tests__/navigation-modules.test.ts", "apps/web/src/__tests__/no-role-redirect.test.tsx", "apps/web/src/dev/__tests__/dev-identity-roles.test.tsx"]
affected_tests: [
  {path: apps/web/src/sales-ops/__tests__/navigation-edition.test.ts, impact: "THE equivalence oracle: every call passes an edition string as the third argument, which becomes modules", update: "mechanical: wrap the third argument with modulesFor(); every hand-written literal table stays byte-identical", command: "pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/navigation-edition.test.ts", owner: builder},
  {path: apps/web/src/sales-ops/__tests__/navigation.test.ts, impact: "calls the navigation functions with no third argument (default = every module)", update: none, command: "pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/navigation.test.ts", owner: builder},
  {path: apps/web/src/sales-ops/__tests__/leads-stage-navigation.test.tsx, impact: "imports navigation helpers", update: "only if tsc flags an edition string argument", command: "pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/leads-stage-navigation.test.tsx", owner: builder},
  {path: apps/web/src/sales-ops/__tests__/sales-settlement-visibility.test.tsx, impact: "canSettleInWorkspace without a third argument", update: none, command: "pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/sales-settlement-visibility.test.tsx", owner: builder},
  {path: apps/web/src/__tests__/no-role-redirect.test.tsx, impact: "calls getVisibleWorkspaces(roles, edition)", update: "pass modulesHintFromEdition(edition)", command: "pnpm --filter @fxl-sales/web exec vitest run src/__tests__/no-role-redirect.test.tsx", owner: builder},
  {path: apps/web/src/dev/__tests__/dev-identity-roles.test.tsx, impact: "calls getVisibleWorkspaces(roles, edition)", update: "pass modulesHintFromEdition(edition)", command: "pnpm --filter @fxl-sales/web exec vitest run src/dev/__tests__/dev-identity-roles.test.tsx", owner: builder},
  {path: apps/web/src/sales-ops/__tests__/leads-routing.test.tsx, impact: "mounts the real shell with edition leads/full through the profile", update: none, command: "pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/leads-routing.test.tsx src/sales-ops/__tests__/routing.test.tsx", owner: builder}
]
acceptance: "given the module set of today's leads edition, when the navigation functions run for every role combination, then the visible workspaces, items, labels, order, landing routes and redirects are EXACTLY today's leads lists (and for all modules exactly today's full lists), and turning one module off hides exactly the entries that require it"
goal: "Replace the parallel leadsEdition* lists in navigation.ts with ONE catalogue filtered by module (hasModule), proved equivalent to both editions"
must_not_break: ["navigation-edition.test.ts literal tables unchanged (only the call arguments change)", "getSalesOpsWorkspaces() with no argument or all modules returns the SAME salesOpsWorkspaces object", "the first entry of every list is still the landing route (appended, never prepended)", "buildSalesOpsPath / SALES_OPS_ROUTE_PATTERN / aliasLegacyView behaviour", "auth-mock-edition-export.test.ts (profile.edition and useSalesEdition keep existing)", "no-legacy-* guards"]
rules: ["Never use the em dash; use '-'", "Expected values in tests are hand-written literals, never derived by calling navigation.ts", "No view may be visible without an entry in the catalogue; a new view id must be classified (test 9)", "Do not add an admin toggle screen (decided: none)", "Never return null or a Skeleton while signed out (unchanged shell rule)"]
verifier_focus: "Diff navigation-edition.test.ts: only third arguments may differ, every literal identical; run it plus navigation-modules.test.ts; check the full call-site grep list compiles; confirm no 'leads' edition string remains in navigation.ts"
oracle: "apps/web/src/sales-ops/__tests__/navigation-edition.test.ts"
```

# 12a - Navigation by module (phase 3, web, part 1)

## Context

- `apps/web/src/sales-ops/navigation.ts` (380 lines before phase 2): full lists `tacticalTeam`, `operational`, `cadastros`, `meusDadosSeller`, `meusDadosFinder`; parallel lists `leadsEditionOperational`, `leadsEditionCadastros`, `leadsEditionMeusDadosSeller`, `leadsEditionWorkspaces`; the functions `getSalesOpsWorkspaces`, `getVisibleWorkspaces`, `canSettleInWorkspace`, `getSalesOpsNavigation`, `getDefaultSalesOpsRoute`, `resolveSalesOpsRoute`, `workspaceForView`, each with a trailing `edition: SalesEdition = 'full'`.
- Today's leads-edition lists (hand-verified from the file and from `navigation-edition.test.ts` `*_LEADS` tables): `operacional` = Prospecção(`leads`), Funil(`funil`); `cadastros` = Vendedores(`pessoas`, FIRST), Clientes, Etapas do funil, Importação, Leads excluídos; `meus-dados` seller = Prospecção(`leads`), Funil; `tatico` empty; workspaces for admin `['operacional','cadastros']` (admin wins outright, no `meus-dados`), for a non-admin seller `['meus-dados']`, finder-only `[]`; `operacional` description `Prospecção`; `canSettle` false.
- Callers of the navigation functions (full list, from grep): `SalesOpsApp.tsx` (lines ~1355, 1358, 1449, 1463, 1677, 1685, 1749), `components/auth/RoleGuard.tsx:65`, tests `navigation-edition.test.ts`, `navigation.test.ts`, `sales-settlement-visibility.test.tsx`, `leads-stage-navigation.test.tsx`, `__tests__/no-role-redirect.test.tsx`, `dev/__tests__/dev-identity-roles.test.tsx`. `pages/errors/NoRolePage.tsx` only mentions it in a comment. RE-RUN `grep -rn "getVisibleWorkspaces\|getSalesOpsNavigation\|getSalesOpsWorkspaces\|canSettleInWorkspace\|resolveSalesOpsRoute\|getDefaultSalesOpsRoute\|workspaceForView" apps/web/src` after phase 2 and convert every hit.
- Phase 2 (slices 09, 10a, 10b) appended entries to these lists: a follow-ups view, and one route per Propostas submenu entry (names are decided by those plans; read `navigation.ts` as they left it).
- `@fxl-sales/shared-utils/crm-model` (11a) exports `OrgModules`, `ALL_MODULES_ENABLED`, `CrmModuleKey`, `CRM_MODULE_KEYS`, `modulesForEdition`, `editionFromModules`. Run `pnpm --filter @fxl-sales/shared-utils build` before the web tests.

## Design (decided)

1. New `apps/web/src/sales-ops/org-modules.ts` (pure): `hasModule`, `hasEveryModule`, `isCompactProfile` (= `orcamentos` off), `modulesHintFromEdition(edition)`, `modulesCacheKey(modules)`. The hint turns the token-derived `profile.edition` into a module set (`'leads'` => `modulesForEdition('leads')`, otherwise `ALL_MODULES_ENABLED`); slice 12b replaces it by the real modules from the bootstrap once loaded.
2. ONE catalogue. Every entry is `{ id, label, icon, requires: CrmModuleKey[], compactLabel?, compactFirst? }`. The entry lists keep today's FULL order and labels. An entry is visible iff `hasEveryModule(modules, entry.requires)`. In the compact profile (`orcamentos` off) an entry shows `compactLabel` when set, and `compactFirst` entries are stably moved to the front. Nothing else varies by edition inside the lists.
3. The `requires` table (catalogue, workspace -> id -> requires, compactLabel, compactFirst):

   | Workspace | id | label | requires | compactLabel | compactFirst |
   | --- | --- | --- | --- | --- | --- |
   | tatico | dashboard | Visão geral | orcamentos | | |
   | operacional | vendas | Propostas | orcamentos | | |
   | operacional | comissoes | Comissões | comissoes | | |
   | operacional | leads | Prospecção | (none) | | |
   | operacional | funil | Funil | (none) | | |
   | cadastros | produtos | Produtos & Serviços | catalogo | | |
   | cadastros | areas | Áreas | catalogo | | |
   | cadastros | clientes | Clientes | clientes | | |
   | cadastros | pessoas | Pessoas | (none) | Vendedores | yes |
   | cadastros | funcoes | Funções | catalogo | | |
   | cadastros | etapas | Etapas do funil | (none) | | |
   | cadastros | importacao | Importação | importacao | | |
   | cadastros | leads-excluidos | Leads excluídos | (none) | | |
   | cadastros | geral | Geral | financeiro | | |
   | meus-dados (seller) | vendedores | Meu painel | orcamentos | | |
   | meus-dados (seller) | comissoes | Comissões | comissoes | | |
   | meus-dados (seller) | leads | Minha prospecção | (none) | Prospecção | |
   | meus-dados (seller) | funil | Funil | (none) | | |
   | meus-dados (finder) | finders | Meu painel | finders | | |
   | meus-dados (finder) | vendas | Indicações | finders | | |

   Phase 2 entries: any entry for the Propostas submenu routes (they live under `operacional` and open propostas) requires `['orcamentos']`; the follow-ups entries (`operacional` and `meus-dados` seller) and the lead summary route require nothing. If phase 2 added a view id that is neither a Propostas submenu route nor follow-ups, STOP and report to the orchestrator (do not invent a rule). Where phase 2 inserted entries, keep their position in the full list; the compact result must equal today's leads list with the phase 2 non-orcamento entries inserted at the same relative position.
4. Workspace visibility, `getVisibleWorkspaces(roles, modules)`: candidates = `admin` => `tatico`, `operacional`, `cadastros`; plus `meus-dados` when (`seller` or `finder`) AND NOT (compact profile AND `admin`) - in the compact profile the admin wins outright, as the leads edition does today. Then keep a candidate only if `getSalesOpsNavigation(candidate, roles, modules).length > 0`. (This reproduces today: compact admin => `['operacional','cadastros']` because `tatico` is empty; compact finder-only => `[]` because both finder entries need `finders`; full unchanged because no list is ever empty.)
5. `getSalesOpsWorkspaces(modules)`: the unchanged `salesOpsWorkspaces` object when not compact, otherwise the same array with `operacional.description = 'Prospecção'` (built once at module load, as `leadsEditionWorkspaces` is today).
6. `canSettleInWorkspace(workspace, roles, modules)` = `hasModule(modules, 'orcamentos') && workspace === 'operacional' && roles.includes('admin')`.
7. `getSalesOpsNavigation` memoizes by `workspace + roles-flags + modulesCacheKey` so a repeated call returns the same array identity (the shell calls it every render). `meus-dados` = seller entries when `seller`, then finder entries when `finder`, each filtered.
8. `getDefaultSalesOpsRoute`, `resolveSalesOpsRoute`, `workspaceForView`: only rename the parameter `edition: SalesEdition = 'full'` to `modules: OrgModules = ALL_MODULES_ENABLED` and pass it through; no logic change.
9. The shell keeps a derived `edition` (projection) for its remaining chrome conditionals; in THIS slice it feeds the navigation functions with `modulesHintFromEdition(edition)` (so behaviour is unchanged); 12b feeds the real modules.
10. No admin toggle screen (decided, onboarding is out of scope): a toggle is the API call from 11c.

## Steps (TDD)

1. Convert `navigation-edition.test.ts` mechanically (Tests 1). It fails to compile against the old signatures (RED by tsc) - run vitest: runtime still passes with edition strings, so also run `pnpm --filter @fxl-sales/web type-check` and expect errors.
2. Write `navigation-modules.test.ts` (Tests 2-9). RED (module missing).
3. Create `org-modules.ts` (code below).
4. Rewrite the lists and functions in `navigation.ts` (code below). GREEN for both navigation tests.
5. Update the callers: `SalesOpsApp.tsx` (7 call sites, pass `modulesHintFromEdition(edition)` computed once: `const navModules = useMemo(() => modulesHintFromEdition(edition), [edition]);` next to `const edition = profile.edition;` and use `navModules` in every navigation call), `RoleGuard.tsx:65` (`getVisibleWorkspaces(roles, modulesHintFromEdition(edition))`), the two other test files.
6. Run the affected commands, lint, type-check.

### Code: `apps/web/src/sales-ops/org-modules.ts` (new)

```ts
import {
  ALL_MODULES_ENABLED,
  CRM_MODULE_KEYS,
  modulesForEdition,
  type CrmModuleKey,
  type OrgModules,
} from '@fxl-sales/shared-utils/crm-model';
import type { SalesEdition } from '@fxl-sales/shared-utils/sales-edition';

export { ALL_MODULES_ENABLED };
export type { OrgModules };

export function hasModule(modules: OrgModules, key: CrmModuleKey): boolean {
  return modules[key] === true;
}

export function hasEveryModule(modules: OrgModules, keys: readonly CrmModuleKey[]): boolean {
  return keys.every((key) => hasModule(modules, key));
}

/** `orcamentos` off: the compact CRM profile (what the leads edition is today). */
export function isCompactProfile(modules: OrgModules): boolean {
  return !hasModule(modules, 'orcamentos');
}

/**
 * The module set implied by the token-derived `profile.edition`. A HINT used only until
 * the bootstrap delivers the organization's real modules (slice 12b), and as the fallback
 * for a hand-written test profile with no modules. Correct for every organization the
 * backfill has not been toggled away from.
 */
export function modulesHintFromEdition(edition: SalesEdition | undefined): OrgModules {
  return edition === 'leads' ? modulesForEdition('leads') : ALL_MODULES_ENABLED;
}

/** Stable key for memoizing per module set, for example `1011010`. */
export function modulesCacheKey(modules: OrgModules): string {
  return CRM_MODULE_KEYS.map((key) => (hasModule(modules, key) ? '1' : '0')).join('');
}
```

### Code: `navigation.ts` (replace the list section and the five functions; keep everything else)

Imports: delete `import type { SalesEdition } ...`; add
`import { type CrmModuleKey } from '@fxl-sales/shared-utils/crm-model';`
`import { ALL_MODULES_ENABLED, hasEveryModule, isCompactProfile, modulesCacheKey, type OrgModules } from './org-modules';`

Replace the arrays `tacticalTeam` ... `leadsEditionMeusDadosSeller` (and the big comment above the leads lists) by:

```ts
type NavEntry = SalesOpsNavigationItem & {
  /** Every module here must be enabled for the entry to show. Empty = always. */
  requires: readonly CrmModuleKey[];
  /** Label in the compact profile (`orcamentos` off). */
  compactLabel?: string;
  /** Moved to the front, stably, in the compact profile (its landing entry). */
  compactFirst?: true;
};

/*
  THE navigation catalogue. One list per workspace, in the FULL order. Visibility is
  `requires` against the organization's modules; the only other variance is the compact
  profile (`orcamentos` off): `compactLabel` and `compactFirst`. APPENDED, never prepended:
  `getDefaultSalesOpsRoute` lands on `[0]` of the visible list. Oracles:
  navigation-edition.test.ts (equivalence with both former editions) and
  navigation-modules.test.ts.
*/
const tacticalTeam: NavEntry[] = [
  { id: 'dashboard', label: 'Visão geral', icon: BarChart3, requires: ['orcamentos'] },
];
const operational: NavEntry[] = [
  { id: 'vendas', label: 'Propostas', icon: BriefcaseBusiness, requires: ['orcamentos'] },
  { id: 'comissoes', label: 'Comissões', icon: BadgeDollarSign, requires: ['comissoes'] },
  { id: 'leads', label: 'Prospecção', icon: LayoutGrid, requires: [] },
  { id: 'funil', label: 'Funil', icon: LayoutGrid, requires: [] },
  // phase 2 entries stay here, in the position slice 10b gave them
];
const cadastros: NavEntry[] = [
  { id: 'produtos', label: 'Produtos & Serviços', icon: Database, requires: ['catalogo'] },
  { id: 'areas', label: 'Áreas', icon: Layers, requires: ['catalogo'] },
  { id: 'clientes', label: 'Clientes', icon: ContactRound, requires: ['clientes'] },
  { id: 'pessoas', label: 'Pessoas', icon: UsersRound, requires: [], compactLabel: 'Vendedores', compactFirst: true },
  { id: 'funcoes', label: 'Funções', icon: Tags, requires: ['catalogo'] },
  { id: 'etapas', label: 'Etapas do funil', icon: ListChecks, requires: [] },
  { id: 'importacao', label: 'Importação', icon: FileSpreadsheet, requires: ['importacao'] },
  { id: 'leads-excluidos', label: 'Leads excluídos', icon: Trash2, requires: [] },
  { id: 'geral', label: 'Geral', icon: Cog, requires: ['financeiro'] },
];
const meusDadosSeller: NavEntry[] = [
  { id: 'vendedores', label: 'Meu painel', icon: UsersRound, requires: ['orcamentos'] },
  { id: 'comissoes', label: 'Comissões', icon: BadgeDollarSign, requires: ['comissoes'] },
  { id: 'leads', label: 'Minha prospecção', icon: LayoutGrid, requires: [], compactLabel: 'Prospecção' },
  { id: 'funil', label: 'Funil', icon: LayoutGrid, requires: [] },
];
const meusDadosFinder: NavEntry[] = [
  { id: 'finders', label: 'Meu painel', icon: Search, requires: ['finders'] },
  { id: 'vendas', label: 'Indicações', icon: BriefcaseBusiness, requires: ['finders'] },
];

function visibleEntries(entries: readonly NavEntry[], modules: OrgModules): SalesOpsNavigationItem[] {
  const compact = isCompactProfile(modules);
  const shown = entries.filter((entry) => hasEveryModule(modules, entry.requires));
  const ordered = compact
    ? [...shown.filter((entry) => entry.compactFirst), ...shown.filter((entry) => !entry.compactFirst)]
    : shown;
  return ordered.map(({ id, label, icon, compactLabel }) => ({
    id,
    icon,
    label: compact && compactLabel ? compactLabel : label,
  }));
}

const navigationCache = new Map<string, SalesOpsNavigationItem[]>();
```

`salesOpsWorkspaces` stays; replace `leadsEditionWorkspaces` by `compactWorkspaces` (same `.map` body) and the functions:

```ts
export function getSalesOpsWorkspaces(modules: OrgModules = ALL_MODULES_ENABLED) {
  return isCompactProfile(modules) ? compactWorkspaces : salesOpsWorkspaces;
}

export function getSalesOpsNavigation(
  workspace: SalesOpsWorkspace,
  roles: readonly AppRole[],
  modules: OrgModules = ALL_MODULES_ENABLED,
): SalesOpsNavigationItem[] {
  const seller = roles.includes('seller');
  const finder = roles.includes('finder');
  const key = `${workspace}|${workspace === 'meus-dados' ? `${seller ? 1 : 0}${finder ? 1 : 0}` : '-'}|${modulesCacheKey(modules)}`;
  const cached = navigationCache.get(key);
  if (cached) return cached;
  let items: SalesOpsNavigationItem[];
  switch (workspace) {
    case 'tatico':
      items = visibleEntries(tacticalTeam, modules);
      break;
    case 'operacional':
      items = visibleEntries(operational, modules);
      break;
    case 'cadastros':
      items = visibleEntries(cadastros, modules);
      break;
    case 'meus-dados':
      items = [
        ...(seller ? visibleEntries(meusDadosSeller, modules) : []),
        ...(finder ? visibleEntries(meusDadosFinder, modules) : []),
      ];
      break;
  }
  navigationCache.set(key, items);
  return items;
}

export function getVisibleWorkspaces(
  roles: readonly AppRole[],
  modules: OrgModules = ALL_MODULES_ENABLED,
): SalesOpsWorkspace[] {
  const roleSet = new Set(roles);
  const admin = roleSet.has('admin');
  const candidates: SalesOpsWorkspace[] = [];
  if (admin) candidates.push('tatico', 'operacional', 'cadastros');
  // In the compact profile the admin wins outright (the leads-edition rule).
  if ((roleSet.has('seller') || roleSet.has('finder')) && !(admin && isCompactProfile(modules))) {
    candidates.push('meus-dados');
  }
  return candidates.filter((id) => getSalesOpsNavigation(id, roles, modules).length > 0);
}

export function canSettleInWorkspace(
  workspace: SalesOpsWorkspace,
  roles: readonly AppRole[],
  modules: OrgModules = ALL_MODULES_ENABLED,
): boolean {
  return hasModule(modules, 'orcamentos') && workspace === 'operacional' && roles.includes('admin');
}
```
(import `hasModule` too). Rename the `edition` parameter to `modules` in `getDefaultSalesOpsRoute`, `resolveSalesOpsRoute`, `workspaceForView` and in their inner calls, with type `OrgModules` and default `ALL_MODULES_ENABLED`. Delete the leftover comment about "THE LEADS EDITION" lists. Add `export const NAVIGATION_CATALOGUE = { tatico: tacticalTeam, operacional: operational, cadastros, meusDadosSeller, meusDadosFinder } as const;` for the coverage test.

## Tests

1. `navigation-edition.test.ts` (oracle): add near the top `import { modulesForEdition } from '@fxl-sales/shared-utils/crm-model'; import { ALL_MODULES_ENABLED, type OrgModules } from '../org-modules';` and
   ```ts
   /** The edition fence now drives the module API with the exact module sets of the two former editions. */
   const modulesFor = (edition: SalesEdition | undefined): OrgModules | undefined =>
     edition === undefined ? undefined : modulesForEdition(edition);
   ```
   Replace the third argument of EVERY call of the six navigation functions with `modulesFor(<that argument>)` (the literal `'leads'` becomes `modulesForEdition('leads')`). `getSalesOpsWorkspaces()` / `getSalesOpsWorkspaces('full')` become `getSalesOpsWorkspaces()` / `getSalesOpsWorkspaces(modulesForEdition('full'))`; the `toBe(salesOpsWorkspaces)` identity assertions stay. Do not touch a single literal table. Keep the phase 2 additions in the tables that 10b added.
2. `navigation-modules.test.ts` (new, plain vitest, no DOM). Local constants: `ROLE_COMBOS` (the same eight combos as the oracle), `OFF = (key) => ({ ...ALL_MODULES_ENABLED, [key]: false })`. All expectations are hand-written literals.
   - `it('every module off hides exactly the entries that require it')` with a hand-written table `HIDDEN_WHEN_OFF` (workspace/view pairs, checked for `['admin','seller','finder']`):
     - `comissoes`: `operacional/comissoes`, `meus-dados/comissoes`
     - `catalogo`: `cadastros/produtos`, `cadastros/areas`, `cadastros/funcoes`
     - `clientes`: `cadastros/clientes`
     - `importacao`: `cadastros/importacao`
     - `financeiro`: `cadastros/geral`
     - `finders`: `meus-dados/finders`, `meus-dados/vendas`
     - `orcamentos`: `tatico/dashboard`, `operacional/vendas`, `meus-dados/vendedores` (plus the Propostas submenu entries phase 2 added), and the compact relabels apply.
     For each key, every OTHER catalogue entry of the all-modules lists is still present (compare item id lists after removing the hidden ids; order preserved, except that for `orcamentos` off the `cadastros` order is the compact one).
   - `it('orcamentos off with every other module on keeps the full order and shows the compact labels')`: `cadastros` order `pessoas, produtos, areas, clientes, funcoes, etapas, importacao, leads-excluidos, geral` with `pessoas` labelled `Vendedores`; `meus-dados` seller `leads` labelled `Prospecção`; `getVisibleWorkspaces(['admin','seller','finder'])` is `['operacional','cadastros']`.
   - `it('the leads module set plus one extra flag shows exactly that entry')`: `{ ...modulesForEdition('leads'), comissoes: true }` adds `operacional/comissoes` between nothing and `leads` (list `comissoes, leads, funil`), and `{ ...modulesForEdition('leads'), catalogo: true }` adds `produtos, areas, funcoes` to `cadastros` (after `pessoas`, `clientes` positions per the catalogue order: `pessoas, produtos, areas, clientes, funcoes, etapas, importacao, leads-excluidos`).
   - `it('a hidden view redirects to the role default, never renders')`: `resolveSalesOpsRoute({ workspace: 'cadastros', view: 'produtos' }, ['admin'], OFF('catalogo'))` -> `{ path: '/tatico/dashboard', redirect: true }`; with the leads set -> `/operacional/funil`.
   - `it('canSettleInWorkspace follows orcamentos')`: true for `(operacional, admin)` with all modules, false with `OFF('orcamentos')`.
   - `it('identity: getSalesOpsWorkspaces() with all modules is the exported salesOpsWorkspaces object')` and `it('repeated getSalesOpsNavigation calls return the same array')` (`toBe`).
   - `it('a finder-only operator sees meus-dados only while the finders module is on')`.
   - `it('every SalesOpsView is classified in the catalogue and every requires is a known module key')`: `const ALL_VIEWS: Record<SalesOpsView, true> = {...every id}` (so tsc fails when a view is added without a line here); assert each id appears in at least one `NAVIGATION_CATALOGUE` list and every `requires` entry satisfies `isCrmModuleKey`.
3. `no-role-redirect.test.tsx` and `dev-identity-roles.test.tsx`: `getVisibleWorkspaces(roles, edition)` -> `getVisibleWorkspaces(roles, modulesHintFromEdition(edition))` (import from `@/sales-ops/org-modules`).

## Commands

- Oracle: `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/navigation-edition.test.ts src/sales-ops/__tests__/navigation-modules.test.ts`
- Affected: every command in `affected_tests`, then `pnpm --filter @fxl-sales/web test` (whole web unit suite).
- `pnpm --filter @fxl-sales/web lint`, `pnpm --filter @fxl-sales/web type-check`.
- Guards: `node --test scripts/__tests__/no-legacy-auth.test.mjs scripts/__tests__/no-legacy-env-names.test.mjs scripts/__tests__/brand-and-technical-ids.test.mjs`.
- `grep -n "leadsEdition\|=== 'leads'" apps/web/src/sales-ops/navigation.ts` prints nothing.

## Risks

- The exact equivalence rests on the table in Design 3; the oracle proves it for all eight role combinations and every URL in `URLS`.
- An org with `orcamentos` on but `finders` off loses the finder `meus-dados` entries (today's full edition had them): only reachable after a deliberate toggle; the backfill never produces it.
- NoRoleGuard still keys on the token-derived hint until 12b (documented there).
