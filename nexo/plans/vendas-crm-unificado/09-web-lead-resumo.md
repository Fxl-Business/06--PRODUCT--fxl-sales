---
id: 09-web-lead-resumo
milestone: v4.8.0
status: todo
depends_on: ["08-web-lead-form-unico"]
files_modified: ["apps/web/src/sales-ops/navigation.ts", "apps/web/src/sales-ops/SalesOpsApp.tsx", "apps/web/src/sales-ops/leads/use-undo-notice.tsx", "apps/web/src/sales-ops/leads/summary-format.ts", "apps/web/src/sales-ops/leads/lead-summary-nav.ts", "apps/web/src/sales-ops/leads/LeadSummary.tsx", "apps/web/src/sales-ops/leads/LeadSummaryContainer.tsx", "apps/web/src/sales-ops/leads/advance.ts", "apps/web/src/sales-ops/leads/AdvanceDialog.tsx", "apps/web/src/sales-ops/leads/SummaryComposers.tsx", "apps/web/src/sales-ops/leads/followups.ts", "apps/web/src/sales-ops/leads/FollowupsView.tsx", "apps/web/src/sales-ops/leads/FollowupsContainer.tsx", "apps/web/src/sales-ops/leads/crm-hooks.ts", "apps/web/src/sales-ops/leads/LeadCard.tsx", "apps/web/src/sales-ops/leads/LeadsBoard.tsx", "apps/web/src/sales-ops/leads/LeadsBoardContainer.tsx", "apps/web/src/sales-ops/leads/board-labels.ts", "CLAUDE.md", "nexo/knowledge/reference/sales-ops-routing.md", "nexo/knowledge/reference/kanban-de-leads.md"]
affected_tests: ["apps/web/src/sales-ops/leads/__tests__/leads-board-keyboard.test.tsx", "apps/web/src/sales-ops/leads/__tests__/leads-contact-board.test.tsx", "apps/web/src/sales-ops/leads/__tests__/leads-list-view.test.tsx", "apps/web/src/sales-ops/leads/__tests__/leads-board-dropzones.test.tsx", "apps/web/src/sales-ops/leads/__tests__/leads-board-scroll.test.tsx", "apps/web/src/sales-ops/leads/__tests__/leads-board-search.test.tsx", "apps/web/src/sales-ops/leads/__tests__/lead-board-totals.test.tsx", "apps/web/src/sales-ops/leads/__tests__/lead-unassigned-marker.test.tsx", "apps/web/src/sales-ops/leads/__tests__/lead-delete.test.tsx", "apps/web/src/sales-ops/leads/__tests__/lead-conversion.test.tsx", "apps/web/src/sales-ops/leads/__tests__/leads-full-edition.test.tsx", "apps/web/src/sales-ops/leads/__tests__/lead-undo.test.tsx", "apps/web/src/sales-ops/leads/__tests__/leads-contact-container.test.tsx", "apps/web/src/sales-ops/leads/__tests__/board-write-surface.test.ts", "apps/web/src/sales-ops/__tests__/leads-stage-navigation.test.tsx", "apps/web/src/sales-ops/__tests__/navigation-edition.test.ts", "apps/web/src/sales-ops/__tests__/navigation.test.ts", "apps/web/src/sales-ops/__tests__/lead-routes.test.ts", "apps/web/src/sales-ops/leads/__tests__/use-undo-notice.test.tsx", "apps/web/src/sales-ops/leads/__tests__/lead-summary.test.tsx", "apps/web/src/sales-ops/leads/__tests__/lead-summary-container.test.tsx", "apps/web/src/sales-ops/leads/__tests__/summary-format.test.ts", "apps/web/src/sales-ops/leads/__tests__/advance.test.ts", "apps/web/src/sales-ops/leads/__tests__/advance-dialog.test.tsx", "apps/web/src/sales-ops/leads/__tests__/followups.test.ts", "apps/web/src/sales-ops/leads/__tests__/followups-view.test.tsx", "apps/web/src/sales-ops/leads/__tests__/followups-container.test.tsx"]
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


## Plan-check addendum (orchestrator revision 3, binding)

Copied from the plan-check report `nexo/runs/20261021T011348Z-vendas-crm-unificado/agents/plan-check-fase2.md`. Where it conflicts with the body above, this addendum wins. Apply each fix in the part it names.

#### 1. BLOCKER - the edit undo always answers 400 field_invalid (08c leadToWriteSeed, 08e saveWithUndo, 09c container)

Evidence: `readLeadFields` (07a1 `lead-fields.ts`, the `definitions.map` at the end of the function) returns ONE entry per active definition INCLUDING the Cliente (`key 'cliente'`, value `[{id,name}]` or `null`, read from `client_id`). `leadToWriteSeed` (08c item 11) copies `lead.fields` verbatim AND sends top-level `clientId`. The API refuses that pair: 07a2 `lead-service.ts` `pickClientId`: `if (topLevel !== undefined && cliente !== null) throw new LeadInputError('field_invalid', cliente.index)`. So the PATCH sent by "Lead editado" undo (board in 08e, summary in 09c) is a 400. The planned tests do not see it: the round trip fixture in 08c and the `lead-undo`/`lead-summary-container` fixtures contain no cliente entry (vacuous for this path).

Fix in `parts/08c-web-lead-form-logica.md`, Design item 11, replace the `fields` part of the sentence by:

```text
`fields`: `[...(lead.fields ?? []).filter((f) => f.key !== CLIENTE_FIELD_KEY).map((f) => ({ fieldId: f.fieldId, value: f.value })), ...clearFieldIds.map((fieldId) => ({ fieldId, value: null }))]`, with `export const CLIENTE_FIELD_KEY = 'cliente';` declared in `lead-form.ts` (it equals `SYSTEM_FIELD_CLIENTE.key`). The Cliente is carried ONLY by the top-level `clientId`/`clientName`, because the API refuses `clientId` together with a Cliente entry of `fields` (`400 field_invalid`). `fieldIdsWithValue` also skips the cliente key.
```

Add to the 08c Tests list:

```text
- `leadToWriteSeed never sends a Cliente entry`: the lead fixture carries `{ fieldId: 'f-cli', key: 'cliente', value: [{ id: 'c1', name: 'Acme' }] }` and `{ fieldId: 'f-cli', key: 'cliente', value: null }` in two cases; the seed has `clientId` and NO entry with `fieldId 'f-cli'`. The round trip case also includes the cliente entry and still deep-equals.
```

Add to 08e Tests (`lead-undo.test.tsx`) and 09c Tests (`lead-summary-container.test.tsx`): the lead fixture has the cliente entry in `fields`, and the inverse PATCH body `fields` is asserted to contain only `{ fieldId: 'f-desc', value: 'Antes' }` (no `f-cli`). In 08e the `added` computation also filters `f.key !== CLIENTE_FIELD_KEY`.


#### 6. MAJOR - CLAUDE.md rules about the card click and the edit form are left false by 09c

CLAUDE.md "Kanban de leads" says the card "otherwise clicking it opens edit via `onEdit`", "the Lista row and both edit forms (edit mode) also offer `Excluir`", and "`data-move-trigger`/`data-edit-lead` now live on the Lista rows". 09c renames to `onOpen`/`onOpenLead`/`data-open-lead`, moves the editor behind the summary and removes the board edit path, but its text has no docs step (only 09a, 09e, 10a, 10b do). The repo header says to update the reference in the same change when a rule moves, and the AC "clicar no card abre o resumo, nao o form" is itself a rule.

Fix: add to `parts/09c-web-lead-resumo.md` a Docs step: in CLAUDE.md replace `otherwise clicking it opens edit via \`onEdit\` and dragging moves it` by `otherwise clicking it opens the lead summary (operacional|meus-dados/leads/:leadId) via \`onOpen\` and dragging moves it, and a converted card still opens its proposta`; replace `The Lista row and both edit forms (edit mode) also offer \`Excluir\`` by `The Lista row and the LeadForm in edit mode (opened from the summary) also offer \`Excluir\``; replace `\`data-move-trigger\`/\`data-edit-lead\` now live on the Lista rows` by `\`data-move-trigger\`/\`data-open-lead\` live on the Lista rows`. Mirror one sentence per line in `nexo/knowledge/reference/kanban-de-leads.md`.


#### 7. MINOR - `affected_tests: []` in the frontmatter of 08, 09 and 10

About 25 existing web tests are edited (renames in 09c, container mocks in 10a, literal nav tables in 09e/10b, `board-write-surface.test.ts` OWNED_FILES). They are listed only in the parts. Fill the three frontmatters with the part lists (path, impact, update, command, owner) so Verify and wave tooling see them. Minimum for 09: `leads-board-keyboard`, `leads-contact-board`, `leads-list-view`, `leads-board-dropzones`, `leads-board-scroll`, `leads-board-search`, `lead-board-totals`, `lead-unassigned-marker`, `lead-delete`, `lead-conversion`, `leads-full-edition`, `lead-undo`, `leads-stage-navigation`, `navigation-edition`, `navigation`, `board-write-surface`.


#### 11. MINOR - bookkeeping

- 07a `files_modified` omits the deleted `apps/api/src/domains/sales-ops/leads/__tests__/contact-lead-contract.test.ts` (it is in affected_tests as DELETE); add it.
- `apps/api/scripts/seed-dev.ts.bak2` is a tracked backup that names the three frozen tables; delete it in 07a3 (it is outside `frozen-lead-tables.test.ts` scope, but it is dead text that a grep for the frozen names will keep finding).
- `lead-path.ts` (07b) hard-codes `stage.position > 1`; derive it from the graph (`allowedTargets of Novo`) or comment that it assumes the seven default etapas.
- 07b design item 3 says moveLead refusals are "results"; the existing `sale_required_for_conversion` on a plain move is still a thrown `LeadInputError` (400 from 07a). Say so in item 3 so a reader does not expect 409 on `/move` for that case (the 409 `sale_required_for_conversion` is `/advance` only).
- Phase 2 text says "sem listas paralelas por edicao"; 09e appends follow-ups to the four existing parallel lists (correct for now, phase 3 removes them). Note it in 09e Risks.

