# Plan-check fase2 (07a, 07b, 08, 09, 10)

Verdict: FAIL (1 blocker, 5 major, 7 minor).

Method: read the slice files, all parts of 08, 09, 10, 07a1/07a3, the API-facing parts of 07a2 (schemas, lead-service, trash, stage-service, lead-fields) and all of 07b; compared with the two contracts, with the planner summary deviations and with the current tree (git blob ids of every diff base were checked: lead-schemas, lead-routes, lead-service, lead-trash-service, routes.ts, executor.ts all match, and the 07a2 -> 07b blob chains are consistent; only seed-dev.ts differs, which is expected because slice 06 edits it first).
Deviations confirmed consistent between API and web plans: conversion still sets sale_id through moveLead; no server proposta period filter (web `filterSalesByPeriod`); 7 etapas; `skipTransitionGraph` import only; `fields: [{fieldId|key, value}]`; W2; A1 (`{followups:[{id,leadId,leadContactName,nextStep,dueOn,ownerName,doneAt}]}`); A2 (`{lead}`); A3 (201 bodies ignored). Verified on the tree: lock order (scope gate, lockLeadBoard, row lock) is kept in insertLead, moveLead, restoreLead and advanceLead; seller predicate and claim are reused through `leadIdentityConditions`/`claimantFor`; soft delete/restore keep the same `tx` audit entries; every tests that names the old tables is either in 07a affected_tests or is a migration/schema test that legitimately keeps the old tables; board-write fence regexes do not match any planned owned file; SalesOpsApp anchors (1358, 448, 1720-1727, 2365, 2379, 1295/1296) match the tree.

## Defects

### 1. BLOCKER - the edit undo always answers 400 field_invalid (08c leadToWriteSeed, 08e saveWithUndo, 09c container)

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

### 2. MAJOR - 08e step 8(b) edits a CLAUDE.md line that 07b already rewrote (the executor will STOP)

07b (Docs, Old line 360) replaces `- Leads writes use \`ContactLeadFieldsSchema\` ...` by `- Lead writes use ONE strict schema, \`LeadWriteSchema\` ...`. 08e Design item 8(b) then asks to replace "the bullet starting `Leads writes use ContactLeadFieldsSchema`", which no longer exists (checked: the 07b old text for line 360 is present in the current CLAUDE.md exactly once; after 07b it is gone). 08e (a), (c), (d) anchors (lines 315, 363, 377 of the current CLAUDE.md) are NOT touched by 07b and stay valid.

Fix in `parts/08e-web-lead-form-cutover.md` Design item 8, replace (b) by:

```text
(b) the bullet that 07b already rewrote (it now starts `- Lead writes use ONE strict schema, \`LeadWriteSchema\``): append at its end `The web writes it through the single LeadForm (apps/web/src/sales-ops/leads/LeadForm.tsx, logic in lead-form.ts): nome and one contact (telefone or e-mail) are required, dynamic fields come from GET /field-definitions, the Cliente is always present and not removable.` Do not search for the pre-07b text.
```

Also in `07b-api-pipeline-historico-followups.md` rules, replace `"CLAUDE.md and the kanban reference are edited by THIS slice only"` by `"CLAUDE.md and the kanban reference: this slice owns the API rules; the web slices 08e, 09a, 09c, 09e, 10a and 10b edit only the bullets they name (read the file first, anchors of bullets rewritten here are the post-07b text)"`.

### 3. MAJOR - the phase 2 AC "ao escolher empresa preenche contatos e RESPONSAVEL" is only half met and not recorded as a gap

Binding request (section 2, Fase 2) and `SEAM-CONTRACT-PHASE2.md` (Web section) both say the responsible seller is prefilled. 08c/08d/08e implement contact prefill only and pin "the vendedor is never prefilled" because `sales_ops_clients` (schema.ts, `salesOpsClients`) has no seller column (verified). The slice `acceptance` of 08 does not mention it and nothing is filed as a pendência, so Verify would read the AC as met.

Fix: in `08-web-lead-form-unico.md` replace the end of `acceptance` (`... keeps the dialog open on a refused save, and the old LeadDialog and ContactLeadDialog are gone`) by:

```text
..., keeps the dialog open on a refused save, and the old LeadDialog and ContactLeadDialog are gone; choosing an empresa prefills only the blank contact fields, and the responsible seller is NOT prefilled because a cliente has no responsible-seller column (open product question, filed as pendência in AUDIT.md: either add a default seller to the cliente or prefill from the cliente's most recent lead)
```

and add the same sentence under "Wire assumptions" in 08. The orchestrator must file the pendência in `AUDIT.md`.

### 4. MAJOR - Funil "Acumulado" counts paused leads as won (10a Risks accepts it, but the figure is wrong, not just coarse)

`LEGACY_KIND_BY_EXIT` maps `pausado` and `ganho` to `normal` (08a), and `buildCumulativeFunnel` keeps every non-`lost` stage in the progression in board order (CLAUDE.md, Edição Leads). With the 7 default etapas (Novo, Qualificação, Em negociação, Proposta, Ganho, Perdido, Pausado) a lead in Pausado (last) counts in EVERY earlier stage, Ganho included, so the Ganho revenue/volume and the retention `% do topo` are inflated by every paused lead. A new org gets this pipeline on first read (07a), so it is visible at once.

Fix in `parts/10a-web-kanban-funil-periodo.md`: add Design item 6b and a test:

```text
6b. Funnel progression. `buildCumulativeFunnel` removes from the progression every stage whose exit is `perdido` OR `pausado` (a lost or paused lead has no known path), decided by an object lookup on `exitKind` (`NON_PROGRESSION_EXIT: Partial<Record<PipelineExitKind, true>> = { perdido: true, pausado: true }`, in `board-ui.ts`; no inline kind comparison). Both are reported in the aside (`[data-funnel-lost]` keeps the lost stage, a new `[data-funnel-parked]` line shows the Pausado count and value). Stages without `exitKind` (legacy fixtures) behave as today. The footer grand totals still read `buildLeadFunnel` (all leads).
Test (`lead-funnel.test.tsx`, appended): with stages Novo, Proposta, Ganho, Perdido, Pausado and one lead in each, the `Acumulado` Ganho row counts 1 (not 2), the Pausado lead appears only in `[data-funnel-parked]`, and the footer total is 5.
```

(Drop the first Risks bullet of 10a accordingly.)

### 5. MAJOR - 0031 leaves an etapa created after 0030 with no transitions (07a1)

The transition statement of the repeated 0030 body is guarded by `NOT EXISTS (SELECT 1 FROM sales_ops_pipeline_transitions t WHERE t.pipeline_id = s.pipeline_id)`. In the exact scenario 0031 exists for (a database that ran 0030 and kept using the old code, i.e. every dev and staging copy), an etapa created in `sales_ops_lead_stages` after 0030 is copied by statement 2 but gets NO edge, because its pipeline already has transitions. With 07b enforcing the graph, no lead can ever be moved into or out of that etapa (409 `transition_not_allowed`) and the oracle (`crm-cutover-resync.test.ts` "copies the rows ... same ids", "renames an etapa ...") does not look at transitions. Silent, and the 0031 header calls the resync complete.

Fix in `parts/07a1-cutover-fundacao.md`: append to the 0031 body, after the etapa `UPDATE` and before the event INSERT, one statement (the same CTE as statement 6 without the pipeline-level guard, restricted to pairs that involve a stage with no edge at all; `ON CONFLICT DO NOTHING` keeps it idempotent), and add the oracle case:

```text
INSERT INTO "sales_ops_pipeline_transitions" ("org_id", "pipeline_id", "from_stage_id", "to_stage_id")
WITH act AS (<same as statement 6 but WITHOUT the NOT EXISTS on transitions>), opn AS (<same>)
SELECT "org_id", "pipeline_id", "from_id", "to_id" FROM (<same four UNION branches>) AS g
WHERE NOT EXISTS (SELECT 1 FROM "sales_ops_pipeline_transitions" t WHERE t."pipeline_id" = g."pipeline_id" AND (t."from_stage_id" = g."from_id" OR t."to_stage_id" = g."from_id"))
   OR NOT EXISTS (SELECT 1 FROM "sales_ops_pipeline_transitions" t WHERE t."pipeline_id" = g."pipeline_id" AND (t."from_stage_id" = g."to_id" OR t."to_stage_id" = g."to_id"))
ON CONFLICT DO NOTHING;
```
Oracle case (`crm-cutover-resync.test.ts`): `an etapa created in the old table after 0030 gets its edges, and a graph the org shaped is left alone`. Update the 0031 header comment accordingly. If the planner prefers not to change SQL, the alternative is to record the limitation in the header AND in 07a Risks and keep a test that pins it; silence is not acceptable.

### 6. MAJOR - CLAUDE.md rules about the card click and the edit form are left false by 09c

CLAUDE.md "Kanban de leads" says the card "otherwise clicking it opens edit via `onEdit`", "the Lista row and both edit forms (edit mode) also offer `Excluir`", and "`data-move-trigger`/`data-edit-lead` now live on the Lista rows". 09c renames to `onOpen`/`onOpenLead`/`data-open-lead`, moves the editor behind the summary and removes the board edit path, but its text has no docs step (only 09a, 09e, 10a, 10b do). The repo header says to update the reference in the same change when a rule moves, and the AC "clicar no card abre o resumo, nao o form" is itself a rule.

Fix: add to `parts/09c-web-lead-resumo.md` a Docs step: in CLAUDE.md replace `otherwise clicking it opens edit via \`onEdit\` and dragging moves it` by `otherwise clicking it opens the lead summary (operacional|meus-dados/leads/:leadId) via \`onOpen\` and dragging moves it, and a converted card still opens its proposta`; replace `The Lista row and both edit forms (edit mode) also offer \`Excluir\`` by `The Lista row and the LeadForm in edit mode (opened from the summary) also offer \`Excluir\``; replace `\`data-move-trigger\`/\`data-edit-lead\` now live on the Lista rows` by `\`data-move-trigger\`/\`data-open-lead\` live on the Lista rows`. Mirror one sentence per line in `nexo/knowledge/reference/kanban-de-leads.md`.

### 7. MINOR - `affected_tests: []` in the frontmatter of 08, 09 and 10

About 25 existing web tests are edited (renames in 09c, container mocks in 10a, literal nav tables in 09e/10b, `board-write-surface.test.ts` OWNED_FILES). They are listed only in the parts. Fill the three frontmatters with the part lists (path, impact, update, command, owner) so Verify and wave tooling see them. Minimum for 09: `leads-board-keyboard`, `leads-contact-board`, `leads-list-view`, `leads-board-dropzones`, `leads-board-scroll`, `leads-board-search`, `lead-board-totals`, `lead-unassigned-marker`, `lead-delete`, `lead-conversion`, `leads-full-edition`, `lead-undo`, `leads-stage-navigation`, `navigation-edition`, `navigation`, `board-write-surface`.

### 8. MINOR - legacy leads without contact cannot be edited, against the API rule "rows without contact stay valid"

Most existing full-edition leads have no phone/e-mail. `LeadForm` requires one before Salvar (08c validate) and `buildLeadWritePayload` always sends `contactPhone`/`contactEmail`, which touches the contact and makes the API answer `400 contact_required` otherwise. Editing only the value of an old lead is therefore blocked. Suggested text for 08c item 8 and 10: `on edit, when the initial lead has neither phone nor e-mail and the draft still has neither, the contact problem is not raised and buildLeadWritePayload omits contactPhone and contactEmail`. Needs a product confirmation if "contato obrigatorio" is meant to apply to old leads; either way record the decision in 08c.

### 9. MINOR - no oracle pins the lock order of advanceLead (07b)

The brief lists the board lock order as top risk; 07b states "same lock order" and leaves it to review (Risks). Add a case to `crm-pipeline-history.test.ts`: `advance, move and create on the same org run concurrently without deadlock and keep positions dense` (Promise.all of `advanceLead` on lead A, `moveLead` on lead B inside the same stage, `createLead`; all resolve, column positions 1..N). Mutation to list for Verify: take the card row lock before `lockLeadBoard` in `advanceLead`.

### 10. MINOR - 409 `transition_not_allowed` has no visible copy outside the drag (10a)

10a only reverts the optimistic move on a stale graph. Add to 10a Design 3: `a 409 from POST /leads/:id/move (Lista Mover, MoveLeadDialog) renders MOVE_NOT_ALLOWED_COPY through the existing MutationErrorBanner path (keyed on status 409 and error 'transition_not_allowed')`, plus one test in `leads-pipeline-container.test.tsx`.

### 11. MINOR - bookkeeping

- 07a `files_modified` omits the deleted `apps/api/src/domains/sales-ops/leads/__tests__/contact-lead-contract.test.ts` (it is in affected_tests as DELETE); add it.
- `apps/api/scripts/seed-dev.ts.bak2` is a tracked backup that names the three frozen tables; delete it in 07a3 (it is outside `frozen-lead-tables.test.ts` scope, but it is dead text that a grep for the frozen names will keep finding).
- `lead-path.ts` (07b) hard-codes `stage.position > 1`; derive it from the graph (`allowedTargets of Novo`) or comment that it assumes the seven default etapas.
- 07b design item 3 says moveLead refusals are "results"; the existing `sale_required_for_conversion` on a plain move is still a thrown `LeadInputError` (400 from 07a). Say so in item 3 so a reader does not expect 409 on `/move` for that case (the 409 `sale_required_for_conversion` is `/advance` only).
- Phase 2 text says "sem listas paralelas por edicao"; 09e appends follow-ups to the four existing parallel lists (correct for now, phase 3 removes them). Note it in 09e Risks.

## Per-slice summary

- 07a: API cutover is consistent (one write schema, frozen-tables scan, W2, contact rule at HTTP only, import through the Base schema). Defect 5 and bookkeeping in 11.
- 07b: routes, shapes, seller scope and period/filters agree with the web plans. Defect 2 (docs anchor), 9, 11.
- 08: defects 1, 2, 3, 7, 8.
- 09: defects 1 (via 08c helper), 6, 7. Route change to `?etapa=` is complete (all four consumers of `stageId`: `buildSalesOpsPath`, `resolveSalesOpsRoute`, `LeadSidebarNavigation`, `LeadsBoardContainer.onOpenStage`; SalesOpsApp reads it at 1952 and 2379).
- 10: defects 4, 7, 10. Propostas routes keep the Finance deep link.
