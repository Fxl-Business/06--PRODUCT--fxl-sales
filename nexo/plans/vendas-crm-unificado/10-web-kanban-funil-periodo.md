---
id: 10-web-kanban-funil-periodo
milestone: v4.8.0
status: todo
depends_on: ["09-web-lead-resumo"]
files_modified: ["apps/web/src/sales-ops/navigation.ts", "apps/web/src/sales-ops/SalesOpsApp.tsx", "apps/web/src/sales-ops/sales-views.ts", "apps/web/src/lib/query-keys.ts", "apps/web/src/sales-ops/leads/types.ts", "apps/web/src/sales-ops/leads/api.ts", "apps/web/src/sales-ops/leads/hooks.ts", "apps/web/src/sales-ops/leads/board-ui.ts", "apps/web/src/sales-ops/leads/board-move.ts", "apps/web/src/sales-ops/leads/board-labels.ts", "apps/web/src/sales-ops/leads/LeadsBoard.tsx", "apps/web/src/sales-ops/leads/LeadsBoardContainer.tsx", "CLAUDE.md", "nexo/knowledge/reference/kanban-de-leads.md", "nexo/knowledge/reference/sales-ops-routing.md", "nexo/knowledge/reference/propostas.md"]
affected_tests: []
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
