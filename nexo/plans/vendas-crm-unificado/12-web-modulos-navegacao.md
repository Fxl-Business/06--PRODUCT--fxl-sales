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


## Plan-check addendum (orchestrator revision 3, binding)

Copied from the plan-check report `nexo/runs/20261021T011348Z-vendas-crm-unificado/agents/plan-check-fase34.md`. Where it conflicts with the body above, this addendum wins. Apply each fix in the part it names.

#### D6 [MAJOR] 12b: the web re-derives `kind` from `type`, so 11c's projection does not reach the board
Files: `parts/12b-web-modulos-shell.md` Design item 6 ("the board and Mover dialog need no module branch"); upstream `parts/08a-web-crm-data-layer.md:77-80,94` (`LEGACY_KIND_BY_TYPE: orcamento -> 'conversion'`, `legacyKindOf(stage)` uses `type`, applied by `pipelineStagesAsBoardStages`) and `parts/10a` (`KIND_COLORS` keyed `orcamento` by `type`).
11c leaves `type` as stored and only changes `kind`/`behavior` in `GET /lead-stages` and `GET /pipelines`. The board consumes `GET /pipelines` and computes `kind` itself from `type`, so with orcamentos off the Proposta stage is still `kind: 'conversion'` in the web: drag/Mover opens the proposta wizard (the org has no `proposals` capability, `POST /sales` answers 403). 12b item 6 is false as written.
Fix in 12b (add to Design, Steps and files_modified; `apps/web/src/sales-ops/leads/` file that 08a created exporting `legacyKindOf`, find with `grep -rn "legacyKindOf" apps/web/src`):
> 6. The board must key the conversion kind on the EFFECTIVE `behavior`, not on `type`: change `legacyKindOf` to `(stage) => stage.exitKind ? LEGACY_KIND_BY_EXIT[stage.exitKind] : (stage.behavior === OPENS_ORCAMENTOS_BEHAVIOR ? 'conversion' : 'normal')` (lookup by object, no inline `kind ===`, the write-surface scan stays green) and drop `LEGACY_KIND_BY_TYPE`. `isSystem` stays `type !== 'normal'`. Colours may keep reading `type` (cosmetic). Add tests in the 08a data-layer test file: `an orcamento stage with behavior none (orcamentos off) maps to kind normal`, and in `org-modules-shell.test.tsx` `with orcamentos off the Proposta stage is a normal board stage and a drop on it calls the move, not onRequestConversion`.
Also require 11c to return the effective `behavior` from `GET /pipelines` (already in 11c Design 3 bullet 2; add `GET /pipelines` explicitly to the 11c test 8 assertions: `behavior: 'none'` with the module off, `'opens_orcamentos'` with it on).


#### D8 [MAJOR] 12a: make the phase 2 entries explicit in the catalogue and the equivalence oracle
File: `parts/12a-web-navegacao-por-modulo.md`, Design item 3 table and Tests.
Phase 2 actually appended (verified in `09e` and `10b`): `operacional`: `vendas-abertas` (Em aberto), `vendas-ganhas` (Vendidas), `vendas-encerradas` (Perdidas e canceladas) right after `vendas`, and `follow-ups` last, in the FULL list only for the first three; `follow-ups` in all four lists (`operacional` label `Follow-ups`, `meus-dados` seller label `Meus follow-ups`); the leads summary route `operacional|meus-dados/leads/:leadId` and `?etapa=<stageId>` (09a) are not nav entries. 12a's "names are decided by those plans" invites haiku to guess. Append these rows to the table:
| operacional | vendas-abertas | Em aberto | orcamentos | | |
| operacional | vendas-ganhas | Vendidas | orcamentos | | |
| operacional | vendas-encerradas | Perdidas e canceladas | orcamentos | | |
| operacional | follow-ups | Follow-ups | (none) | | |
| meus-dados (seller) | follow-ups | Meus follow-ups | (none) | | |
and state the resulting lists, which the equivalence oracle must pin literally: full `operacional` = `vendas, vendas-abertas, vendas-ganhas, vendas-encerradas, comissoes, leads, funil, follow-ups`; compact (`orcamentos` off, today's leads set) `operacional` = `leads, funil, follow-ups`; full seller `meus-dados` = `vendedores, comissoes, leads, funil, follow-ups`; compact seller `meus-dados` = `leads, funil, follow-ups`. These equal today's `navigation-edition.test.ts` tables after 09e/10b (the `*_LEADS` tables gain only `follow-ups`), so "modulesFor(edition)" keeps the oracle's meaning.
Add tests to `navigation-modules.test.ts`: (1) `vendas-abertas|vendas-ganhas|vendas-encerradas` are hidden together when only `orcamentos` is off and shown together when only `orcamentos` is on over the leads set; (2) `resolveSalesOpsRoute({workspace:'operacional', view:'vendas-ganhas', saleId:'x'}, ['admin'], leadsSet)` redirects to the role default and drops the id; with all modules it keeps `saleId` (the `isSalesListView` rule of 10b); (3) `resolveSalesOpsRoute({workspace:'operacional', view:'leads', saleId:'<lead uuid>'}, ['admin'], leadsSet)` and with the full set both resolve to the same non-redirect route (the lead summary), and a `?etapa=` query survives `buildSalesOpsPath` unchanged; (4) `follow-ups` stays visible when every module is off except the empty set `{}` all-false (still `leads, funil, follow-ups`). Add `resolveSalesOpsRoute` anchoring of `isSalesListView` (introduced by 10b) to the list of functions 12a must not change in logic.
Add to 12b test 3 ("no redirect while the bootstrap is loading") a second path `/operacional/leads/<lead uuid>?etapa=<id>` so the summary deep link is covered.


#### m4 [MINOR] 14c / 12a ordering of nav label for Importacao
No defect: `cadastros/importacao` requires `importacao`, the mapping UI is a mode inside it (ImportContainer toggle). Only record in 14c that `Planilha modelo` stays available and uses the FXL Vendas brand (`template-brand.test.ts` is in 14's files_modified; its assertion on the sheet title must be named in 14b Tests; currently only the file name is listed).

