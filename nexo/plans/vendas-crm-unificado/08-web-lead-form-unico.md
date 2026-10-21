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


## Plan-check addendum (orchestrator revision 3, binding)

Copied from the plan-check report `nexo/runs/20261021T011348Z-vendas-crm-unificado/agents/plan-check-fase2.md`. Where it conflicts with the body above, this addendum wins. Apply each fix in the part it names.

Orchestrator decision on 3: `sales_ops_clients` has no responsible seller, so the form prefills only the contact; record "responsavel da empresa" as a pending item (needs a cliente field or a decision) in the slice docs; do not add a column in this run.

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


#### 2. MAJOR - 08e step 8(b) edits a CLAUDE.md line that 07b already rewrote (the executor will STOP)

07b (Docs, Old line 360) replaces `- Leads writes use \`ContactLeadFieldsSchema\` ...` by `- Lead writes use ONE strict schema, \`LeadWriteSchema\` ...`. 08e Design item 8(b) then asks to replace "the bullet starting `Leads writes use ContactLeadFieldsSchema`", which no longer exists (checked: the 07b old text for line 360 is present in the current CLAUDE.md exactly once; after 07b it is gone). 08e (a), (c), (d) anchors (lines 315, 363, 377 of the current CLAUDE.md) are NOT touched by 07b and stay valid.

Fix in `parts/08e-web-lead-form-cutover.md` Design item 8, replace (b) by:

```text
(b) the bullet that 07b already rewrote (it now starts `- Lead writes use ONE strict schema, \`LeadWriteSchema\``): append at its end `The web writes it through the single LeadForm (apps/web/src/sales-ops/leads/LeadForm.tsx, logic in lead-form.ts): nome and one contact (telefone or e-mail) are required, dynamic fields come from GET /field-definitions, the Cliente is always present and not removable.` Do not search for the pre-07b text.
```

Also in `07b-api-pipeline-historico-followups.md` rules, replace `"CLAUDE.md and the kanban reference are edited by THIS slice only"` by `"CLAUDE.md and the kanban reference: this slice owns the API rules; the web slices 08e, 09a, 09c, 09e, 10a and 10b edit only the bullets they name (read the file first, anchors of bullets rewritten here are the post-07b text)"`.


#### 3. MAJOR - the phase 2 AC "ao escolher empresa preenche contatos e RESPONSAVEL" is only half met and not recorded as a gap

Binding request (section 2, Fase 2) and `SEAM-CONTRACT-PHASE2.md` (Web section) both say the responsible seller is prefilled. 08c/08d/08e implement contact prefill only and pin "the vendedor is never prefilled" because `sales_ops_clients` (schema.ts, `salesOpsClients`) has no seller column (verified). The slice `acceptance` of 08 does not mention it and nothing is filed as a pendência, so Verify would read the AC as met.

Fix: in `08-web-lead-form-unico.md` replace the end of `acceptance` (`... keeps the dialog open on a refused save, and the old LeadDialog and ContactLeadDialog are gone`) by:

```text
..., keeps the dialog open on a refused save, and the old LeadDialog and ContactLeadDialog are gone; choosing an empresa prefills only the blank contact fields, and the responsible seller is NOT prefilled because a cliente has no responsible-seller column (open product question, filed as pendência in AUDIT.md: either add a default seller to the cliente or prefill from the cliente's most recent lead)
```

and add the same sentence under "Wire assumptions" in 08. The orchestrator must file the pendência in `AUDIT.md`.


#### 7. MINOR - `affected_tests: []` in the frontmatter of 08, 09 and 10

About 25 existing web tests are edited (renames in 09c, container mocks in 10a, literal nav tables in 09e/10b, `board-write-surface.test.ts` OWNED_FILES). They are listed only in the parts. Fill the three frontmatters with the part lists (path, impact, update, command, owner) so Verify and wave tooling see them. Minimum for 09: `leads-board-keyboard`, `leads-contact-board`, `leads-list-view`, `leads-board-dropzones`, `leads-board-scroll`, `leads-board-search`, `lead-board-totals`, `lead-unassigned-marker`, `lead-delete`, `lead-conversion`, `leads-full-edition`, `lead-undo`, `leads-stage-navigation`, `navigation-edition`, `navigation`, `board-write-surface`.


#### 8. MINOR - legacy leads without contact cannot be edited, against the API rule "rows without contact stay valid"

Most existing full-edition leads have no phone/e-mail. `LeadForm` requires one before Salvar (08c validate) and `buildLeadWritePayload` always sends `contactPhone`/`contactEmail`, which touches the contact and makes the API answer `400 contact_required` otherwise. Editing only the value of an old lead is therefore blocked. Suggested text for 08c item 8 and 10: `on edit, when the initial lead has neither phone nor e-mail and the draft still has neither, the contact problem is not raised and buildLeadWritePayload omits contactPhone and contactEmail`. Needs a product confirmation if "contato obrigatorio" is meant to apply to old leads; either way record the decision in 08c.

