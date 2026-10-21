---
id: 08-web-lead-form-unico
milestone: v4.8.0
status: todo
depends_on: ["07b-api-pipeline-historico-followups"]
files_modified: ["apps/web/src/sales-ops/leads/crm-types.ts", "apps/web/src/sales-ops/leads/crm-api.ts", "apps/web/src/sales-ops/leads/crm-hooks.ts", "apps/web/src/sales-ops/leads/crm-pipeline.ts", "apps/web/src/sales-ops/leads/types.ts", "apps/web/src/sales-ops/leads/lead-form.ts", "apps/web/src/sales-ops/leads/LeadForm.tsx", "apps/web/src/sales-ops/leads/LeadFormFields.tsx", "apps/web/src/sales-ops/leads/api.ts", "apps/web/src/sales-ops/leads/hooks.ts", "apps/web/src/sales-ops/leads/contact-lead.ts", "apps/web/src/sales-ops/leads/client-picker-copy.ts", "apps/web/src/sales-ops/leads/LeadsBoardContainer.tsx", "apps/web/src/sales-ops/leads/LeadDialog.tsx", "apps/web/src/sales-ops/leads/ContactLeadDialog.tsx", "apps/web/src/sales-ops/period.ts", "apps/web/src/sales-ops/PeriodFilter.tsx", "apps/web/src/lib/query-keys.ts", "CLAUDE.md", "nexo/knowledge/reference/kanban-de-leads.md"]
affected_tests: []
acceptance: "given the org's field definitions, when Novo lead opens in either edition, then the one LeadForm requires name plus one contact, always shows the non-removable Cliente picker with inline empresa creation and contact prefill, renders dynamic fields by kind, keeps the dialog open on a refused save, and the old LeadDialog and ContactLeadDialog are gone"
goal: "Web data layer, shared period filter and the single LeadForm replacing both lead dialogs"
must_not_break: ["every existing web test not listed in a part's affected list", "board-write-surface.test.ts", "/operacional/vendas/<id> Finance deep link", "no em dash, no native select"]
rules: ["execute the parts in order, one executor step each, TDD inside each part", "each part's own Steps, Tests, Commands and Affected tests sections are binding", "SalesOpsApp.tsx edits only at the anchors the parts name"]
verifier_focus: "run every part's focused command, then the whole web suite, lint and type-check; confirm no reference to deleted symbols survives"
oracle: "apps/web/src/sales-ops/leads/__tests__/lead-form.test.tsx"
---

# 08-web-lead-form-unico

## Parts, execute in order

- `parts/08a-web-crm-data-layer.md` - focused tests: crm-api-contract.test.ts crm-pipeline.test.ts (leads/__tests__)
- `parts/08b-web-period-filter.md` - focused tests: __tests__/period.test.ts __tests__/period-filter.test.tsx (sales-ops)
- `parts/08c-web-lead-form-logica.md` - focused tests: leads/__tests__/lead-form.test.ts
- `parts/08d-web-lead-form-componente.md` - focused tests: leads/__tests__/lead-form.test.tsx
- `parts/08e-web-lead-form-cutover.md` - focused tests: leads/__tests__/leads-contact-container.test.tsx plus the affected list in the part

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
