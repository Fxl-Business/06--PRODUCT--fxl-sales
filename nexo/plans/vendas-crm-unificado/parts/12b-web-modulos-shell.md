# Part 12b-web-modulos-shell of slice 12-web-modulos-navegacao

Original frontmatter (for reference, not a slice):

```yaml
id: 12b-web-modulos-shell
milestone: v4.8.0
status: todo
depends_on: ["11c-api-modulos-admin", "12a-web-navegacao-por-modulo"]
files_modified: ["apps/web/src/sales-ops/types.ts", "apps/web/src/sales-ops/SalesOpsApp.tsx", "apps/web/src/auth/org-modules-context.ts", "apps/web/src/auth/react.tsx", "apps/web/src/sales-ops/__tests__/org-modules-shell.test.tsx", "CLAUDE.md", "nexo/knowledge/reference/modulos-por-organizacao.md", "nexo/knowledge/reference/kanban-de-leads.md", "nexo/knowledge/reference/sales-ops-routing.md"]
affected_tests: [
  {path: apps/web/src/sales-ops/__tests__/leads-routing.test.tsx, impact: "mounts the real shell with a hand-written bootstrap that has NO orgModules and a profile edition; the hint fallback must keep it green untouched", update: none, command: "pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/leads-routing.test.tsx", owner: builder},
  {path: apps/web/src/sales-ops/__tests__/routing.test.tsx, impact: "same", update: none, command: "pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/routing.test.tsx", owner: builder},
  {path: apps/web/src/auth/__tests__/auth-mock-edition-export.test.ts, impact: "every vi.mock('@/auth/react') factory must keep exporting useSalesEdition", update: none, command: "pnpm --filter @fxl-sales/web exec vitest run src/auth/__tests__/auth-mock-edition-export.test.ts", owner: builder},
  {path: apps/web/src/auth/__tests__/react.test.tsx, impact: "useSalesEdition and profile.edition keep their token-derived default", update: "add one case for the context override", command: "pnpm --filter @fxl-sales/web exec vitest run src/auth/__tests__/react.test.tsx", owner: builder},
  {path: apps/web/src/sales-ops/__tests__/entitlement-dead-end.test.tsx, impact: "classification order entitlement, forbidden, auth, generic must be untouched", update: none, command: "pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/entitlement-dead-end.test.tsx", owner: builder}
]
acceptance: "given a bootstrap whose orgModules are the leads set while the token hint says full, when the shell mounts, then it shows the leads navigation and lands on operacional/funil without ever redirecting a valid deep link while the bootstrap loads; given orgModules with orcamentos on while the hint says leads, a /operacional/vendas deep link opens and is not rewritten"
goal: "The shell takes the organization's modules from the bootstrap (token edition only as a hint until then), exposes them to leaf components, and the project docs state the new web rule"
must_not_break: ["the SalesOpsApp rule: never return null or a Skeleton while signed out; both <Navigate> early returns stay gated on profile.isSignedIn (now AND modules settled)", "the 402/403/401 bootstrap classification order and its oracle entitlement-dead-end.test.tsx", "profile.edition and useSalesEdition() keep working and every vi.mock('@/auth/react') factory keeps exporting useSalesEdition", "QueryClientProvider stays outside AppAuthProvider; no queryClient.clear() change", "the leads-edition board/dialog behaviour (leaf conditionals on edition keep working through the projection)", "no-legacy-* guards"]
rules: ["Never use the em dash; use '-'", "CLAUDE.md and reference docs: one sentence per line; edit only the paragraphs listed", "Do not fetch modules in the auth provider (token handling invariants); the bootstrap is the source", "No admin toggle screen (decided; onboarding is out of scope)", "A deep link must not be rewritten while the modules are still unknown"]
verifier_focus: "Run org-modules-shell.test.tsx, leads-routing, routing, entitlement-dead-end, auth-mock-edition-export and the whole web suite; read the CLAUDE.md diff to confirm only the two web paragraphs changed; confirm nothing under apps/web/src still compares the edition to 'leads' for NAVIGATION (leaf chrome conditionals may remain)"
oracle: "apps/web/src/sales-ops/__tests__/org-modules-shell.test.tsx"
```

# 12b - Shell on the organization's modules, leaf projection, docs (phase 3, web part 2)

## Context

- After 12a the navigation functions take `OrgModules`; `SalesOpsApp.tsx` passes `navModules = modulesHintFromEdition(edition)` where `const edition = profile.edition;` (token hint, line ~1303).
- After 11c `GET /bootstrap` returns `orgModules` (additive). `SalesOpsBootstrap` is in `apps/web/src/sales-ops/types.ts:320`; the shell reads `bootstrapQuery = useSalesOpsBootstrap()` (line ~1307) and `const bootstrap = bootstrapQuery.data ?? emptyBootstrap;` (~1387).
- The route resolution runs BEFORE the bootstrap resolves (`resolveSalesOpsRoute(routeParams, profile.roles, ...)` ~line 1358) and the two `<Navigate>` early returns are at ~1788-1801, guarded by `const rolesAreAuthoritative = profile.isSignedIn;`.
- Leaf components read `useSalesEdition()` (`apps/web/src/auth/react.tsx:1035-1036`, `export const useSalesEdition = useHubSalesEdition;` ~1214); shell code reads `profile.edition`. Tests mock `@/auth/react` with a hand-written profile and `useSalesEdition: () => ...`.
- Shell chrome conditionals still on the edition: `SalesOpsApp.tsx` ~1738, 2000-2013 (`hasCapability(edition ?? 'full', ...)`), 2118, 2323, 2473; they keep working through the projection.
- Harness to copy for the new test: `apps/web/src/sales-ops/__tests__/leads-routing.test.tsx` lines 1-230 (mocks `@/auth/react`, `../hooks`, the lead containers, `@/components/ui/dialog`, `renderRoute`).

## Design (decided)

1. `SalesOpsBootstrap` gets `orgModules?: OrgModules` (optional: hand-written test fixtures have none).
2. In the shell:
   ```ts
   const bootstrapModules = isOrgModules(bootstrapQuery.data?.orgModules) ? bootstrapQuery.data.orgModules : null;
   const modules = bootstrapModules ?? modulesHintFromEdition(profile.edition);   // replaces navModules
   const edition = editionFromModules(modules);                                   // the projection, for the leaf chrome below
   const modulesSettled = bootstrapModules !== null || !bootstrapQuery.isLoading;
   ```
   `edition` is now defined AFTER `bootstrapQuery`; the hint uses `profile.edition` directly. Every navigation call uses `modules`. The `edition` constant keeps feeding the existing chrome conditionals unchanged.
3. Deep links: `rolesAreAuthoritative` becomes `profile.isSignedIn && modulesSettled`, and BOTH `<Navigate>` early returns use it. While the bootstrap is loading with no modules yet, the shell renders (as it does today during loading, the content area shows `LoadingPanel`) and rewrites nothing, so a valid deep link of an org whose modules differ from the token hint is not lost. A failed bootstrap (`isError`) is settled and falls back to the hint. Update the comment above `rolesAreAuthoritative` accordingly (keep the paragraph forbidding `null`/Skeleton while signed out).
4. Leaf projection: new `apps/web/src/auth/org-modules-context.ts` exports `OrgModulesContext = createContext<OrgModules | null>(null)`. `useHubSalesEdition()` in `react.tsx` becomes: `const modules = useContext(OrgModulesContext); const hub = useHubAuthContext().edition; return modules ? editionFromModules(modules) : hub;`. The shell's MAIN return (the one after the two `<Navigate>` returns) is wrapped in `<OrgModulesContext.Provider value={modules}>`. Hence a leaf under the shell reads the real organization's projection; outside it (and under every test mock) nothing changes.
5. `profile.edition` stays the token-derived HINT (documented as such): `RoleGuard`/`NoRoleGuard` run before any bootstrap, so a finder-only operator of an org toggled away from its token may see `/no-role` wrongly until a reload path exists. Accepted and documented; not worth a second fetch in the auth provider (token invariants).
6. API-side `kind`/`behavior` projections (11c) already hide an `orcamento` stage's wizard behaviour when `orcamentos` is off, so the board and Mover dialog need no module branch; this slice adds none. The proposta-only chrome keeps keying on `hasCapability(edition, ...)` through the projection.
7. No admin toggle screen (decided). An admin changes a module with `PUT /api/v1/sales-ops/org-modules` (11c).

## Steps (TDD)

1. Write `org-modules-shell.test.tsx` (Tests). RED.
2. Types, context file, `react.tsx` hook, shell wiring (diffs below). GREEN.
3. Run affected suites, whole web suite, lint, type-check.
4. Docs.

### Diffs

`types.ts` (inside `SalesOpsBootstrap`): add `orgModules?: OrgModules;` and `import type { OrgModules } from '@fxl-sales/shared-utils/crm-model';`.

`auth/org-modules-context.ts` (new):
```ts
import { createContext } from 'react';
import type { OrgModules } from '@fxl-sales/shared-utils/crm-model';

/** The organization's modules as the Sales shell resolved them from the bootstrap. Null outside the shell. */
export const OrgModulesContext = createContext<OrgModules | null>(null);
```

`auth/react.tsx`: add `import { useContext } from 'react'` (merge with the existing react import), `import { editionFromModules } from '@fxl-sales/shared-utils/crm-model';`, `import { OrgModulesContext } from './org-modules-context';` and replace the body of `useHubSalesEdition` as in Design 4; update its doc comment: "The shell publishes the organization's modules through `OrgModulesContext`; this projects them to the legacy edition and falls back to the token-derived hint outside the shell."

`SalesOpsApp.tsx`: apply Design 2 and 3; wrap the main `return (<div className="sales-ops ...">...)` in the provider; import `OrgModulesContext` from `@/auth/org-modules-context`, `editionFromModules`, `isOrgModules` from `@fxl-sales/shared-utils/crm-model`, `modulesHintFromEdition` from `./org-modules`. Remove 12a's `navModules` memo.

## Tests

`org-modules-shell.test.tsx` (new; copy the mock block and `renderRoute` of `leads-routing.test.tsx`, but make the `../hooks` mock return a `bootstrapData` variable that the test sets, and `isLoading` a variable). Cases:
1. `the bootstrap's leads modules win over a full token hint`: profile edition `undefined` (hint full), roles `['admin','seller','finder']`, bootstrap `orgModules` = hand-written literal `{ orcamentos:false, comissoes:false, financeiro:false, finders:false, catalogo:false, importacao:true, clientes:true }`; `renderRoute('/tatico/dashboard', ...)` -> the router location ends at `/operacional/funil` (use the location probe the harness has), the sidebar has no `Propostas` item and has `Prospecção`.
2. `the bootstrap's full modules win over a leads token hint`: profile edition `'leads'`, bootstrap modules all true; `renderRoute('/operacional/vendas', ...)` stays at `/operacional/vendas` (not rewritten) and the sidebar shows `Propostas`.
3. `no redirect while the bootstrap is loading`: `isLoading: true`, `data: undefined`, profile edition `'leads'`, path `/operacional/vendas` -> location unchanged (still `/operacional/vendas`) while loading; then flip `isLoading: false` with full modules and re-render: still `/operacional/vendas`. (With the old code this URL would have been rewritten to `/operacional/funil` by the leads hint.)
4. `a failed bootstrap falls back to the hint`: `isError: true`, `isLoading: false`, edition `'leads'`, path `/operacional/vendas` -> redirected to `/operacional/funil`.
5. `a toggled flag shows its entry`: bootstrap modules = leads set with `comissoes: true`; the `operacional` sidebar lists `Comissões` before `Prospecção`.
6. `leaf components see the projection`: render a probe child inside the shell is not possible; instead unit-test the hook in `src/auth/__tests__/react.test.tsx`: `useSalesEdition()` under `<OrgModulesContext.Provider value={modulesForEdition('leads')}>` returns `'leads'` even when the token hint is `'full'`, and returns the hint with no provider (use the existing harness of that file; add one case).
7. Existing suites listed in `affected_tests` stay green untouched.

## Docs (one sentence per line; only these paragraphs)

`CLAUDE.md`:
- Edição Leads, the bullet starting `- Web: the shell reads \`profile.edition\``: replace its first sentence by: `Web: the shell takes the organization's modules from \`GET /bootstrap\` (\`orgModules\`) and passes them to every navigation function; \`profile.edition\` is the token-derived HINT used only until the bootstrap settles, for \`NoRoleGuard\`, and as the fallback of a hand-written test profile.` Then: `Leaf components read \`useSalesEdition()\`, which projects the shell's modules through \`OrgModulesContext\` (\`orcamentos\` off => \`leads\`).` Keep the following sentences (every \`vi.mock('@/auth/react')\` factory exports \`useSalesEdition\`; chrome rules). Replace `when the edition has the capability (\`hasCapability\`)` by `when the organization's modules grant the capability`.
- Sales Ops Routing, the bullet starting `- In the leads edition (\`profile.edition === 'leads'\``: replace with: `- Navigation is ONE catalogue filtered by the organization's modules (\`org-modules.ts\`, \`hasModule\`): every entry in \`navigation.ts\` carries \`requires\`, there are no parallel per-edition lists, and every navigation function takes a trailing \`modules\` (default every module). With \`orcamentos\` off (the compact profile, today's leads edition) \`admin\` sees only \`operacional\` and \`cadastros\` (\`pessoas\` first and labelled Vendedores), a non-admin \`seller\` only \`meus-dados\`, and the entries that need a disabled module are absent. A deep link is never rewritten while the bootstrap is loading.` followed by the line `  Oracles: \`navigation-edition.test.ts\` (exact equivalence with both former editions), \`navigation-modules.test.ts\`, \`org-modules-shell.test.tsx\`.`
The bullets for the API (CLAUDE.md Auth Model and Edição Leads API bullets) belong to 11c; do not touch them.

`nexo/knowledge/reference/modulos-por-organizacao.md`: append section `Web` (the catalogue table of Design 3 of 12a, the hint rule, the deep link rule, the leaf projection, no toggle screen).
`nexo/knowledge/reference/kanban-de-leads.md` (section Edição Leads) and `nexo/knowledge/reference/sales-ops-routing.md` (the leads-edition navigation section): replace the per-edition list wording by the module rule in the same words as CLAUDE.md.

## Commands

- Oracle: `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/org-modules-shell.test.tsx`
- Affected: the commands in `affected_tests`, then `pnpm --filter @fxl-sales/web test`.
- `pnpm --filter @fxl-sales/web lint`, `pnpm --filter @fxl-sales/web type-check`, `pnpm --filter @fxl-sales/web build`.
- Whole-run guards (package.json `test`): `node --test scripts/__tests__/no-legacy-auth.test.mjs scripts/__tests__/no-legacy-env-names.test.mjs scripts/__tests__/auth-fake-isolation.test.mjs scripts/__tests__/dev-identity-docs-reconciliation.test.mjs scripts/__tests__/hub-sdk-pin.test.mjs scripts/__tests__/fxl-contracts-pin.test.mjs scripts/__tests__/brand-and-technical-ids.test.mjs`.

## Risks

- During the first bootstrap load of a never-toggled org the hint equals the real modules (the backfill reproduces the token), so nothing flashes. After a toggle that differs from the token the sidebar may show the hint's items for the duration of the first load; the content area shows `LoadingPanel`, and no URL is rewritten.
- `NoRoleGuard` uses the hint: documented limitation (Design 5).
- Wrapping the main return in a Provider adds no DOM; snapshot tests of the shell are unaffected.
