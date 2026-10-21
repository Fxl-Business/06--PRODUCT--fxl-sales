---
id: 09-web-lead-resumo
milestone: v4.8.0
status: todo
depends_on: ["08-web-lead-form-unico"]
files_modified: ["apps/web/src/sales-ops/navigation.ts", "apps/web/src/sales-ops/SalesOpsApp.tsx", "apps/web/src/sales-ops/leads/use-undo-notice.tsx", "apps/web/src/sales-ops/leads/summary-format.ts", "apps/web/src/sales-ops/leads/lead-summary-nav.ts", "apps/web/src/sales-ops/leads/LeadSummary.tsx", "apps/web/src/sales-ops/leads/LeadSummaryContainer.tsx", "apps/web/src/sales-ops/leads/advance.ts", "apps/web/src/sales-ops/leads/AdvanceDialog.tsx", "apps/web/src/sales-ops/leads/SummaryComposers.tsx", "apps/web/src/sales-ops/leads/followups.ts", "apps/web/src/sales-ops/leads/FollowupsView.tsx", "apps/web/src/sales-ops/leads/FollowupsContainer.tsx", "apps/web/src/sales-ops/leads/crm-hooks.ts", "apps/web/src/sales-ops/leads/LeadCard.tsx", "apps/web/src/sales-ops/leads/LeadsBoard.tsx", "apps/web/src/sales-ops/leads/LeadsBoardContainer.tsx", "apps/web/src/sales-ops/leads/board-labels.ts", "CLAUDE.md", "nexo/knowledge/reference/sales-ops-routing.md", "nexo/knowledge/reference/kanban-de-leads.md"]
affected_tests: []
acceptance: "given a lead, when its card or Lista row is clicked, then the summary route opens (never the form); Avançar lists only the valid next stages and requires próximo passo plus data unless the destination is an exit; the follow-ups list filters Minha/Equipe and by period; the stage selection moved to ?etapa="
goal: "Lead summary route and page, Avançar, notes, shared undo and the follow-ups list"
must_not_break: ["every existing web test not listed in a part's affected list", "board-write-surface.test.ts", "/operacional/vendas/<id> Finance deep link", "no em dash, no native select"]
rules: ["execute the parts in order, one executor step each, TDD inside each part", "each part's own Steps, Tests, Commands and Affected tests sections are binding", "SalesOpsApp.tsx edits only at the anchors the parts name"]
verifier_focus: "run every part's focused command, then the whole web suite, lint and type-check; confirm no reference to deleted symbols survives"
oracle: "apps/web/src/sales-ops/__tests__/lead-routes.test.ts"
---

# 09-web-lead-resumo

## Parts, execute in order

- `parts/09a-web-lead-rotas.md` - focused tests: __tests__/lead-routes.test.ts and the updated leads-stage-navigation.test.tsx
- `parts/09b-web-undo-compartilhado.md` - focused tests: leads/__tests__/lead-undo.test.tsx lead-delete.test.tsx use-undo-notice.test.tsx
- `parts/09c-web-lead-resumo.md` - focused tests: leads/__tests__/lead-summary.test.tsx lead-summary-container.test.tsx summary-format.test.ts
- `parts/09d-web-lead-avancar-notas.md` - focused tests: leads/__tests__/advance.test.ts advance-dialog.test.tsx
- `parts/09e-web-followups.md` - focused tests: leads/__tests__/followups*.test.ts(x)

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
