---
id: 12-web-modulos-navegacao
milestone: v4.8.0
status: todo
depends_on: ["11-api-modulos-org"]
files_modified: ["apps/web/src/sales-ops/org-modules.ts", "apps/web/src/sales-ops/navigation.ts", "apps/web/src/sales-ops/SalesOpsApp.tsx", "apps/web/src/components/auth/RoleGuard.tsx", "apps/web/src/sales-ops/__tests__/navigation-edition.test.ts", "apps/web/src/sales-ops/__tests__/navigation-modules.test.ts", "apps/web/src/__tests__/no-role-redirect.test.tsx", "apps/web/src/dev/__tests__/dev-identity-roles.test.tsx", "apps/web/src/sales-ops/types.ts", "apps/web/src/auth/org-modules-context.ts", "apps/web/src/auth/react.tsx", "apps/web/src/sales-ops/__tests__/org-modules-shell.test.tsx", "CLAUDE.md", "nexo/knowledge/reference/modulos-por-organizacao.md", "nexo/knowledge/reference/kanban-de-leads.md", "nexo/knowledge/reference/sales-ops-routing.md"]
affected_tests: [{path: apps/web/src/sales-ops/__tests__/navigation-edition.test.ts, impact: "THE equivalence oracle: every call passes an edition string as the third argument, which becomes modules", update: "mechanical: wrap the third argument with modulesFor(); every hand-written literal table stays byte-identical", command: "pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/navigation-edition.test.ts", owner: builder},
  {path: apps/web/src/sales-ops/__tests__/navigation.test.ts, impact: "calls the navigation functions with no third argument (default = every module)", update: none, command: "pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/navigation.test.ts", owner: builder},
  {path: apps/web/src/sales-ops/__tests__/leads-stage-navigation.test.tsx, impact: "imports navigation helpers", update: "only if tsc flags an edition string argument", command: "pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/leads-stage-navigation.test.tsx", owner: builder},
  {path: apps/web/src/sales-ops/__tests__/sales-settlement-visibility.test.tsx, impact: "canSettleInWorkspace without a third argument", update: none, command: "pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/sales-settlement-visibility.test.tsx", owner: builder},
  {path: apps/web/src/__tests__/no-role-redirect.test.tsx, impact: "calls getVisibleWorkspaces(roles, edition)", update: "pass modulesHintFromEdition(edition)", command: "pnpm --filter @fxl-sales/web exec vitest run src/__tests__/no-role-redirect.test.tsx", owner: builder},
  {path: apps/web/src/dev/__tests__/dev-identity-roles.test.tsx, impact: "calls getVisibleWorkspaces(roles, edition)", update: "pass modulesHintFromEdition(edition)", command: "pnpm --filter @fxl-sales/web exec vitest run src/dev/__tests__/dev-identity-roles.test.tsx", owner: builder},
  {path: apps/web/src/sales-ops/__tests__/leads-routing.test.tsx, impact: "mounts the real shell with edition leads/full through the profile", update: none, command: "pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/leads-routing.test.tsx src/sales-ops/__tests__/routing.test.tsx", owner: builder}, {path: apps/web/src/sales-ops/__tests__/leads-routing.test.tsx, impact: "mounts the real shell with a hand-written bootstrap that has NO orgModules and a profile edition; the hint fallback must keep it green untouched", update: none, command: "pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/leads-routing.test.tsx", owner: builder},
  {path: apps/web/src/sales-ops/__tests__/routing.test.tsx, impact: "same", update: none, command: "pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/routing.test.tsx", owner: builder},
  {path: apps/web/src/auth/__tests__/auth-mock-edition-export.test.ts, impact: "every vi.mock('@/auth/react') factory must keep exporting useSalesEdition", update: none, command: "pnpm --filter @fxl-sales/web exec vitest run src/auth/__tests__/auth-mock-edition-export.test.ts", owner: builder},
  {path: apps/web/src/auth/__tests__/react.test.tsx, impact: "useSalesEdition and profile.edition keep their token-derived default", update: "add one case for the context override", command: "pnpm --filter @fxl-sales/web exec vitest run src/auth/__tests__/react.test.tsx", owner: builder},
  {path: apps/web/src/sales-ops/__tests__/entitlement-dead-end.test.tsx, impact: "classification order entitlement, forbidden, auth, generic must be untouched", update: none, command: "pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/entitlement-dead-end.test.tsx", owner: builder}]
acceptance: "given the module set of today's leads edition, when the navigation functions run for every role combination, then the visible workspaces, items, labels, order, landing routes and redirects are EXACTLY today's leads lists (and for all modules exactly today's full lists), and turning one module off hides exactly the entries that require it AND given a bootstrap whose orgModules are the leads set while the token hint says full, when the shell mounts, then it shows the leads navigation and lands on operacional/funil without ever redirecting a valid deep link while the bootstrap loads; given orgModules with orcamentos on while the hint says leads, a /operacional/vendas deep link opens and is not rewritten"
goal: "Navigation filtered by module instead of per-edition lists; shell reads modules from the bootstrap"
rules: ["execute the parts in order, TDD inside each part", "each part's Steps, Tests, Commands and Affected tests sections are binding", "depends_on names inside a part that point at another part of this slice mean that part"]
verifier_focus: "run every part's oracle and focused commands, then the affected package suites, lint and type-check"
oracle: "apps/web/src/sales-ops/__tests__/org-modules-shell.test.tsx"
---

# 12-web-modulos-navegacao

Consolidated by the orchestrator from the planner's part plans (run budget: at most 24 slices).

## Parts, execute in order

- `parts/12a-web-navegacao-por-modulo.md` - oracle `apps/web/src/sales-ops/__tests__/navigation-edition.test.ts`
- `parts/12b-web-modulos-shell.md` - oracle `apps/web/src/sales-ops/__tests__/org-modules-shell.test.tsx`

All oracles: `apps/web/src/sales-ops/__tests__/navigation-edition.test.ts`, `apps/web/src/sales-ops/__tests__/org-modules-shell.test.tsx`
