# exec 07-web-routing

Branch `feat/20260918-07-web-routing`, commit `0796839`.
Status: PASS.

## What shipped

`apps/web/src/sales-ops/navigation.ts` - five data edits and nothing else.
`SalesOpsView` gains `leads` and `etapas`; `operational` gains `{leads, Prospecção, LayoutGrid}` APPENDED; `cadastros` gains `{etapas, Etapas do funil, ListChecks}` between `funcoes` and `geral`; `meusDadosSeller` gains `{leads, Minha prospecção, LayoutGrid}` APPENDED; the `lucide-react` import list gains the two icons.
`getVisibleWorkspaces`, `salesOpsWorkspaces`, `buildSalesOpsPath`, `getDefaultSalesOpsRoute`, `aliasLegacyView`, `legacyCadastroViews`, `resolveSalesOpsRoute` and `workspaceForView` are byte-unchanged, and `meusDadosFinder` is byte-unchanged.

`apps/web/src/sales-ops/SalesOpsApp.tsx` - wiring only, no screen declared.
Two imports, two `titleForView` entries (the `leads` one with the `personal` ternary), one `leadSellerOptions` `useMemo` over `persistedBootstrap.people` filtered by `status === 'active' && hasFuncao(person, FUNCAO_SLUG_VENDEDOR)`, two conditional mount blocks placed after `funcoes` and before `geral`, and the `headerAction` guard `view === 'geral' || view === 'leads' || view === 'etapas'`.
`runHeaderAction` and the `Filtros` guard are byte-unchanged.
`onRequestConversion` is deliberately not passed; slice 08 owns it.

`apps/web/src/sales-ops/leads/LeadStagesContainer.tsx` - NEW. Four hooks, every callback `mutateAsync`, `stages` passed raw.

`apps/web/src/sales-ops/leads/LeadsBoardContainer.tsx` - the `sellerFilter` prop is replaced by `showSellerFilter`, and the container owns `sellerPersonId` state.

`CLAUDE.md` - the acceptance 24 correction, the canonical-route line, and the new `## Kanban de leads` section after `## Propostas domain`.

`nexo/ROADMAP.md` - two new backlog lines (`?vendedor=` deep link, `Alt+Arrow` card shortcut).

## Where the plan and the shipped code disagreed - shipped code won

1. **`LeadsBoardContainer` already had a `sellerFilter` prop**, documented as controlled by the routing layer, rather than the plan's `showSellerFilter`.
   The plan explicitly assigns the edit of this file to slice 07 (§4.2), the acceptance names `showSellerFilter`, the verifier focus names it, and the `CLAUDE.md` section this slice writes names it, so I made the planned edit: `showSellerFilter?: boolean`, with the filter state owned by the container.
   Nothing outside the file read `LeadsBoardContainerProps.sellerFilter` (`board-write-surface.test.ts` only reads the file's bytes), so the change breaks no shipped test.
   One addition beyond the plan's literal text, and it is stated here rather than left to be found: `sellerFilterValue` is `showSellerFilter ? sellerPersonId : null`, so a filter that is not offered can never narrow the query key.
2. **`ReorderLeadStagesPayload` is `{stageIds}`**, not the plan's `{orderedIds}`. `LeadStagesContainer` sends `{ stageIds: orderedIds }`.
3. **`SetLeadStageStatusPayload` is `{id, status}`** with no `name`, while `LeadStagesViewProps.onSetStageStatus` takes `{id, name, status}` for its confirmation copy. The container destructures and drops `name`.
4. **`useLeadStages()` and the memoized `stages` were already in `LeadsBoardContainer`**, so the plan's `EMPTY_STAGES` module constant was unnecessary; the shipped `React.useMemo(() => stagesQuery.data ?? [], [stagesQuery.data])` already gives a stable identity.
5. `LeadStagesView` imports `SalesOpsLeadStage` from `'./types'`, as the reconciled contract says; the container does not name the type at all.

## Oracles

`apps/web/src/sales-ops/__tests__/navigation.test.ts` - three new tests.
- `keeps every pre-existing canonical route at its exact segment`: a hand-written frozen literal table of the thirteen pre-existing `(workspace, view, roles)` triples plus the eight `getDefaultSalesOpsRoute` answers. Derived from nothing.
- `routes the three lead screens and scopes each to its workspace`.
- `does not alias either new view and keeps the alias scoped to cadastros`.
Five existing exhaustive `toEqual` arrays gained their new member, as §7.1 says they must. No `resolveSalesOpsRoute`, `getDefaultSalesOpsRoute`, `workspaceForView` or `buildSalesOpsPath` expectation already in the file was edited.

`apps/web/src/sales-ops/__tests__/leads-routing.test.tsx` - NEW, four tests, containers mocked so no query client is needed.
Fixtures: one ACTIVE pessoa with `vendedor`, one ACTIVE pessoa with only `finder`, one ARCHIVED pessoa with `vendedor`.

### Red observed, for the right reason
- `navigation.test.ts`: 3 failed / 11 passed before the implementation. The failure was `resolveSalesOpsRoute({workspace:'operacional',view:'leads'})` answering `/tatico/dashboard redirect:true`, not a compile error.
- `leads-routing.test.tsx`: 4 failed, all on `TypeError: Cannot read properties of undefined (reading 'title')` at `SalesOpsApp.tsx:1717` - `titleForView` had no `leads`/`etapas` entry.

### Mutation run in front of me
Replacing `showSellerFilter={workspace === 'operacional'}` with `showSellerFilter={true}` turned `mounts the same board at meus-dados/leads without the seller filter` RED and left the other three green. That is the pair the verifier was told to look hardest at.

## Commands and their real output

- `pnpm --filter @fxl-sales/web test src/sales-ops/__tests__/navigation.test.ts` -> 14 passed (14).
- `pnpm --filter @fxl-sales/web test src/sales-ops/__tests__/leads-routing.test.tsx` -> 4 passed (4).
- `pnpm --filter @fxl-sales/web test` -> `Test Files 70 passed (70)`, `Tests 894 passed (894)`. `routing.test.tsx`, `session-loss-keeps-route` and `shell-organization-switcher` are byte-unchanged and green inside that run.
- `pnpm run lint` -> api Done, web Done.
- `pnpm run type-check` -> shared-types, shared-utils, api, web all Done.
- `pnpm run build` -> `built in 2.05s`.

## Not done, by plan

No `?vendedor=` URL parameter, no `onRequestConversion` wiring, no `NoRoleGuard` or legacy-tree change, no `Alt+Arrow` shortcut, no export of `hasFuncao`, no change to `runHeaderAction`. The first and fourth are filed in `nexo/ROADMAP.md`.
