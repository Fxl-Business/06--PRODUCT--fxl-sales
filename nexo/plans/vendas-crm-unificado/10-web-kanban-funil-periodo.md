---
id: 10-web-kanban-funil-periodo
milestone: v4.8.0
status: todo
depends_on: ["09-web-lead-resumo"]
files_modified: ["apps/web/src/sales-ops/navigation.ts", "apps/web/src/sales-ops/SalesOpsApp.tsx", "apps/web/src/sales-ops/sales-views.ts", "apps/web/src/lib/query-keys.ts", "apps/web/src/sales-ops/leads/types.ts", "apps/web/src/sales-ops/leads/api.ts", "apps/web/src/sales-ops/leads/hooks.ts", "apps/web/src/sales-ops/leads/board-ui.ts", "apps/web/src/sales-ops/leads/board-move.ts", "apps/web/src/sales-ops/leads/board-labels.ts", "apps/web/src/sales-ops/leads/LeadsBoard.tsx", "apps/web/src/sales-ops/leads/LeadsBoardContainer.tsx", "CLAUDE.md", "nexo/knowledge/reference/kanban-de-leads.md", "nexo/knowledge/reference/sales-ops-routing.md", "nexo/knowledge/reference/propostas.md"]
affected_tests: ["apps/web/src/sales-ops/leads/__tests__/leads-period.test.tsx | new oracle, period filter on the board | new | vitest run | 10a", "apps/web/src/sales-ops/leads/__tests__/leads-pipeline-container.test.tsx | new, pipeline choice and shared filters | new | vitest run | 10a", "apps/web/src/sales-ops/leads/__tests__/kanban-pipeline.test.tsx | new, selector and period on the board props | new | vitest run | 10a", "apps/web/src/sales-ops/leads/__tests__/pipeline-fixture.ts | new fixture for GET /pipelines | new | n/a | 10a", "apps/web/src/sales-ops/leads/__tests__/board-ui.test.ts | colour keys by type and exit | update | vitest run | 10a", "apps/web/src/sales-ops/leads/__tests__/board-move.test.ts | moveTargetsFor allowed set | update | vitest run | 10a", "apps/web/src/sales-ops/leads/__tests__/lead-funnel.test.tsx | paused stage parked apart | update | vitest run | 10a", "apps/web/src/sales-ops/leads/__tests__/leads-api-contract.test.ts | pipelineId, from, to on list and summary | update | vitest run | 10a", "apps/web/src/sales-ops/leads/__tests__/lead-board-totals.test.tsx | pipelines fixture, summary scoped to pipeline | update | vitest run | 10a", "apps/web/src/sales-ops/leads/__tests__/lead-conversion.test.tsx | pipelines fixture | update | vitest run | 10a", "apps/web/src/sales-ops/leads/__tests__/lead-delete.test.tsx | pipelines fixture | update | vitest run | 10a", "apps/web/src/sales-ops/leads/__tests__/lead-undo.test.tsx | pipelines fixture | update | vitest run | 10a", "apps/web/src/sales-ops/__tests__/leads-stage-navigation.test.tsx | usePipelines fixture, operacional nav literal | update | vitest run | 10a and 10b", "apps/web/src/sales-ops/__tests__/sales-views.test.ts | new, Propostas list groups and filter | new | vitest run | 10b", "apps/web/src/sales-ops/__tests__/propostas-lists.test.tsx | new, one route per Propostas list | new | vitest run | 10b", "apps/web/src/sales-ops/__tests__/navigation.test.ts | Propostas list routes, operacional literal | update | vitest run | 10b", "apps/web/src/sales-ops/__tests__/navigation-edition.test.ts | operacional literal | update | vitest run | 10b"]
acceptance: "given several pipelines and a period, when the pipeline selector or the period changes, then the Quadro, Lista and Funil show the selected pipeline's columns and figures for that Sao Paulo day range, a move outside the transition graph is not offered, and each Propostas list is its own route with a period filter"
goal: "Kanban as a view of the selected pipeline with period filter, and one route per Propostas list"
must_not_break: ["every existing web test not listed in a part's affected list", "board-write-surface.test.ts", "/operacional/vendas/<id> Finance deep link", "no em dash, no native select"]
rules: ["execute the parts in order, one executor step each, TDD inside each part", "each part's own Steps, Tests, Commands and Affected tests sections are binding", "SalesOpsApp.tsx edits only at the anchors the parts name"]
verifier_focus: "run every part's focused command, then the whole web suite, lint and type-check; confirm no reference to deleted symbols survives"
oracle: "apps/web/src/sales-ops/leads/__tests__/leads-period.test.tsx"
---

# 10-web-kanban-funil-periodo

## Parts, execute in order

- `parts/10a-web-kanban-funil-periodo.md` - focused tests: leads/__tests__/leads-period.test.tsx leads-pipeline-container.test.tsx kanban-pipeline.test.tsx board-ui.test.ts board-move.test.ts
- `parts/10b-web-propostas-rotas.md` - focused tests: __tests__/sales-views.test.ts navigation*.test.ts routing.test.tsx sale-deep-link.test.tsx

The parts hold the full plan (Context, Design, Steps, Tests, Commands, Risks). Part files carry no frontmatter on purpose.

## Slice commands

- Per part: the `Commands` section of that part.
- Slice affected suite: `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops src/__tests__ src/lib`
- `pnpm --filter @fxl-sales/web lint` and `pnpm --filter @fxl-sales/web type-check`
- Wave level: `pnpm test`, `pnpm lint`, `pnpm type-check`, `pnpm build`.

## Affected tests search

Per part; the exact files and edits are listed in each part's `Affected tests` section (08e, 09a, 09c, 09e, 10a, 10b carry the non-trivial ones). Test edits only port assertions to the new behaviour and never weaken them.

## Wire assumptions to reconcile with 07a/07b

W1 lead write `fields: [{fieldId, value}]` (null clears, omitted untouched); W2 non-admin create omits sellerPersonId and the API assigns the caller's pessoa in both editions; A1 `GET /followups` returns `{followups: [{id, leadId, leadContactName, nextStep, dueOn, ownerName, doneAt}]}`; A2 advance returns `{lead}`; A3 notes/followups/done ignore the body. Part 08a and 08c isolate them.


## Plan-check addendum (orchestrator revision 3, binding)

Copied from the plan-check report `nexo/runs/20261021T011348Z-vendas-crm-unificado/agents/plan-check-fase2.md`. Where it conflicts with the body above, this addendum wins. Apply each fix in the part it names.

#### 4. MAJOR - Funil "Acumulado" counts paused leads as won (10a Risks accepts it, but the figure is wrong, not just coarse)

`LEGACY_KIND_BY_EXIT` maps `pausado` and `ganho` to `normal` (08a), and `buildCumulativeFunnel` keeps every non-`lost` stage in the progression in board order (CLAUDE.md, Edição Leads). With the 7 default etapas (Novo, Qualificação, Em negociação, Proposta, Ganho, Perdido, Pausado) a lead in Pausado (last) counts in EVERY earlier stage, Ganho included, so the Ganho revenue/volume and the retention `% do topo` are inflated by every paused lead. A new org gets this pipeline on first read (07a), so it is visible at once.

Fix in `parts/10a-web-kanban-funil-periodo.md`: add Design item 6b and a test:

```text
6b. Funnel progression. `buildCumulativeFunnel` removes from the progression every stage whose exit is `perdido` OR `pausado` (a lost or paused lead has no known path), decided by an object lookup on `exitKind` (`NON_PROGRESSION_EXIT: Partial<Record<PipelineExitKind, true>> = { perdido: true, pausado: true }`, in `board-ui.ts`; no inline kind comparison). Both are reported in the aside (`[data-funnel-lost]` keeps the lost stage, a new `[data-funnel-parked]` line shows the Pausado count and value). Stages without `exitKind` (legacy fixtures) behave as today. The footer grand totals still read `buildLeadFunnel` (all leads).
Test (`lead-funnel.test.tsx`, appended): with stages Novo, Proposta, Ganho, Perdido, Pausado and one lead in each, the `Acumulado` Ganho row counts 1 (not 2), the Pausado lead appears only in `[data-funnel-parked]`, and the footer total is 5.
```

(Drop the first Risks bullet of 10a accordingly.)


#### 7. MINOR - `affected_tests: []` in the frontmatter of 08, 09 and 10

About 25 existing web tests are edited (renames in 09c, container mocks in 10a, literal nav tables in 09e/10b, `board-write-surface.test.ts` OWNED_FILES). They are listed only in the parts. Fill the three frontmatters with the part lists (path, impact, update, command, owner) so Verify and wave tooling see them. Minimum for 09: `leads-board-keyboard`, `leads-contact-board`, `leads-list-view`, `leads-board-dropzones`, `leads-board-scroll`, `leads-board-search`, `lead-board-totals`, `lead-unassigned-marker`, `lead-delete`, `lead-conversion`, `leads-full-edition`, `lead-undo`, `leads-stage-navigation`, `navigation-edition`, `navigation`, `board-write-surface`.


#### 10. MINOR - 409 `transition_not_allowed` has no visible copy outside the drag (10a)

10a only reverts the optimistic move on a stale graph. Add to 10a Design 3: `a 409 from POST /leads/:id/move (Lista Mover, MoveLeadDialog) renders MOVE_NOT_ALLOWED_COPY through the existing MutationErrorBanner path (keyed on status 409 and error 'transition_not_allowed')`, plus one test in `leads-pipeline-container.test.tsx`.

