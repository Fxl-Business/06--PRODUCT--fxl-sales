---
id: 14-importacao-mapeamento
milestone: v4.8.0
status: todo
depends_on: ["13-dias-sem-comprar"]
files_modified: ["apps/api/src/domains/import/mapping/types.ts", "apps/api/src/domains/import/mapping/read-sheet.ts", "apps/api/src/domains/import/mapping/suggest.ts", "apps/api/src/domains/import/mapping/plan.ts", "apps/api/src/domains/import/mapping/__tests__/read-sheet.test.ts", "apps/api/src/domains/import/mapping/__tests__/suggest.test.ts", "apps/api/src/domains/import/mapping/__tests__/plan.test.ts", "apps/api/src/domains/import/mapping/catalog.ts", "apps/api/src/domains/import/mapping/executor.ts", "apps/api/src/domains/import/mapping/routes.ts", "apps/api/src/domains/import/routes.ts", "apps/api/src/domains/sales-ops/routes.ts", "apps/api/src/domains/crm/__tests__/crm-seed-callers.test.ts", "apps/api/src/domains/import/__tests__/mapping-routes.integration.test.ts", "apps/api/src/domains/import/__tests__/template-brand.test.ts", "nexo/knowledge/reference/importacao-por-planilha.md", "CLAUDE.md", "apps/web/src/sales-ops/import/mapping/api.ts", "apps/web/src/sales-ops/import/mapping/hooks.ts", "apps/web/src/sales-ops/import/mapping/mapping-state.ts", "apps/web/src/sales-ops/import/mapping/mapping-copy.ts", "apps/web/src/sales-ops/import/mapping/MappingImportView.tsx", "apps/web/src/sales-ops/import/ImportContainer.tsx", "apps/web/src/sales-ops/import/mapping/__tests__/mapping-state.test.ts", "apps/web/src/sales-ops/import/mapping/__tests__/mapping-import-view.test.tsx"]
affected_tests: [{path: apps/api/src/domains/import/__tests__/import-routes.integration.test.ts, impact: "routes.ts only gains `export` keywords and the sales-ops router gains a sibling mount; the official flow must be byte-identical in behaviour", update: "none expected, run to prove", command: "pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run src/domains/import/__tests__/import-routes.integration.test.ts", owner: builder},
  {path: apps/api/src/domains/import/__tests__/import-routes.test.ts, impact: "unit routing test of the import router", update: "none expected, run to prove", command: "pnpm --filter @fxl-sales/api exec vitest run src/domains/import/__tests__/import-routes.test.ts", owner: builder},
  {path: apps/api/src/domains/crm/__tests__/crm-seed-callers.test.ts, impact: "ALLOWED_CALLERS must list the new request path that calls ensureCrmDefaults", update: "add apps/api/src/domains/import/mapping/routes.ts to the allow-list", command: "pnpm --filter @fxl-sales/api exec vitest run src/domains/crm/__tests__/crm-seed-callers.test.ts", owner: builder},
  {path: apps/api/src/domains/sales-ops/__tests__/edition-gate-map.test.ts, impact: "maps every route to a capability; /import/mapping/* is under /import/* and must stay gated by the same capability/module", update: "none expected unless the test enumerates routes; then add /import/mapping/* beside /import/*", command: "pnpm --filter @fxl-sales/api exec vitest run src/middleware/__tests__/edition-gate-map.test.ts", owner: builder}, {path: apps/web/src/sales-ops/import/__tests__/import-view.test.tsx, impact: "ImportView is untouched; the container gains a mode toggle", update: "none expected, run to prove", command: "pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/import", owner: builder},
  {path: apps/web/src/sales-ops/import/__tests__/import-routing.test.tsx, impact: "mocks the containers; the shell mounting is unchanged", update: "none expected, run to prove", command: "pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/import/__tests__/import-routing.test.tsx", owner: builder}]
acceptance: "given a sheet with arbitrary headers, a column mapping, a stage-value mapping and an in-memory catalog, when planMappedImport runs, then it returns the cliente and lead operations, row-numbered issues, counts and recognized counts, recognizes a lead that already exists, and never reads the clock, the database or the environment AND given an admin, a sheet with arbitrary headers and a mapping, when POST /import/mapping/preview then /commit run, then preview writes nothing, commit writes leads and clientes through the domain services in one transaction, and committing the same file again creates nothing and reports the leads and clientes as recognized AND given an uploaded sheet with arbitrary headers, when the operator maps columns, maps the stage values to stages of a pipeline, validates and confirms, then the screen shows the preview counts (with recognized leads and clientes), blocks on errors, commits once and shows the created and recognized counts"
goal: "Spreadsheet import with column-to-field and stage mapping, idempotent preview and commit"
rules: ["execute the parts in order, TDD inside each part", "each part's Steps, Tests, Commands and Affected tests sections are binding", "depends_on names inside a part that point at another part of this slice mean that part"]
verifier_focus: "run every part's oracle and focused commands, then the affected package suites, lint and type-check"
oracle: "apps/web/src/sales-ops/import/mapping/__tests__/mapping-state.test.ts"
---

# 14-importacao-mapeamento

Consolidated by the orchestrator from the planner's part plans (run budget: at most 24 slices).

## Parts, execute in order

- `parts/14a-importacao-mapeamento-nucleo.md` - oracle `apps/api/src/domains/import/mapping/__tests__/plan.test.ts`
- `parts/14b-importacao-mapeamento-api.md` - oracle `apps/api/src/domains/import/__tests__/mapping-routes.integration.test.ts`
- `parts/14c-importacao-mapeamento-web.md` - oracle `apps/web/src/sales-ops/import/mapping/__tests__/mapping-state.test.ts`

All oracles: `apps/api/src/domains/import/mapping/__tests__/plan.test.ts`, `apps/api/src/domains/import/__tests__/mapping-routes.integration.test.ts`, `apps/web/src/sales-ops/import/mapping/__tests__/mapping-state.test.ts`


## Plan-check addendum (orchestrator revision 3, binding)

Copied from the plan-check report `nexo/runs/20261021T011348Z-vendas-crm-unificado/agents/plan-check-fase34.md`. Where it conflicts with the body above, this addendum wins. Apply each fix in the part it names.

#### D1 [BLOCKER] 14b/14a: a lead cannot be created directly in an exit stage
Files: `parts/14b-importacao-mapeamento-api.md` (Step 0 last sentence, `executeMappingPlan` step 2, `toLeadWriteInput`), `parts/14a-importacao-mapeamento-nucleo.md` line ~204 ("places a lead directly in its stage (history and the unique initial event are written by the lead service at creation)").
Phase 2 facts: `parts/07a2-cutover-servicos-rotas-import.md:912` makes `createLead` refuse any stage whose `type !== 'normal'` with `LeadInputError('stage_not_open')` (asserted at `07a2:2761`). `LeadWriteBaseSchema` is `.strict()` and has NO `lostReason`/`stageChangedAt` (`07a2:2326` asserts `{lostReason:'x'}` is rejected), so `toLeadWriteInput` as written fails `invalid_lead` for every row. The official import does it in two steps: `createLead` into the first open stage, then `moveLead(tx, orgId, id, MoveLeadSchema.parse({stageId, position:0, reason}), scope, { skipTransitionGraph: true })` (`07b` diff of `import/executor.ts`, `MoveLeadOptions.skipTransitionGraph`). So the "STOP and write BLOCKED" branch of Step 0 is the actual situation; the orchestrator decision is: use create-then-move, exactly like the official executor.
Replace in 14b Step 0 the final sentence ("If the new lead service does not accept ... create-then-move).") with:
> DECIDED (phase 2 reconciliation): `createLead` refuses a non-`normal` stage (`stage_not_open`) and `LeadWriteBaseSchema` is strict with no `lostReason`. The executor therefore does what `import/executor.ts` does: `createLead` with `pipelineId` and, only when the target stage has `type === 'normal'`, its `stageId`; then, when the target stage differs from the stage the lead landed in (every `saida` stage, or a normal stage the create did not take), `moveLead(tx, orgId, created.lead.id, MoveLeadSchema.parse({ stageId: op.stageId, position: 0, ...(op.lostReason ? { reason: op.lostReason } : {}) }), scope, { skipTransitionGraph: true })`. A `moved.ok === false` becomes `MappingExecutionError(op.row, moved.reason)`. There is no BLOCKED branch.
Replace `toLeadWriteInput`'s object by (drop `stageId` unless normal, drop `lostReason`):
```ts
{
  contactName: op.contactName, contactPhone: op.contactPhone, contactEmail: op.contactEmail,
  pipelineId: config.pipelineId,
  ...(op.stageIsNormal ? { stageId: op.stageId } : {}),
  sellerPersonId: op.sellerPersonId,
  ...(clientId ? { clientId } : op.clientName ? { clientName: op.clientName } : {}),
  estimatedValueBrl: op.estimatedValueBrl,
  fields: op.fields.map((f) => ({ fieldId: f.fieldId, value: encode(f.value) })),
}
```
Add `stageIsNormal: boolean` to `MappingLeadOp` in `14a` `types.ts` and set it in `plan.ts` from the catalog stage (`stage.type === 'normal'`); add one `plan.test.ts` case `a saida stage op carries stageIsNormal false`. Replace the 14a line ~204 sentence with: "The import never walks the transition graph: the executor creates the lead in the pipeline's first open stage (or the target when it is `normal`) and moves it to an exit stage with `skipTransitionGraph: true`; the history event of that move is written by `moveLead`. Orcamento stages are refused." Add to 14b's `scope`: `{ userId: actor.userId, email: null, name: actor.displayName, isAdmin: true }` (07b's `recordStageChange` snapshots `scope.name`; without it the imported history has no author). Add an integration case to `mapping-routes.integration.test.ts`: a row mapped to a `ganho` stage and a row mapped to the `perdido` stage with a reason commit, the leads sit in those stages and each has exactly one `stage_changed` event (initial) plus one for the move.


#### D5 [MAJOR] 14b: gate-map exhaustiveness and wrong paths in `affected_tests`/allow-list
File: `parts/14b-importacao-mapeamento-api.md` frontmatter lines 14-15 and "`crm-seed-callers.test.ts`" paragraph.
1. `apps/api/src/middleware/__tests__/edition-gate-map.test.ts:325-333` ("the gate map is exhaustive") enumerates EVERY route of `salesOpsRouter` and fails on an unclassified one. `/import/mapping/inspect|preview|commit` are new routes, so the test WILL fail; 14b says "none expected unless the test enumerates routes". The affected row also has the wrong path (`apps/api/src/domains/sales-ops/__tests__/...`; the file is `apps/api/src/middleware/__tests__/edition-gate-map.test.ts`). Replace the row by:
`{path: apps/api/src/middleware/__tests__/edition-gate-map.test.ts, impact: "the router gains POST /import/mapping/inspect, /preview and /commit; the exhaustiveness test requires them classified", update: "add the three routes to LEADS_GRANTED beside the three /import/* entries (lines ~142-144), same shape: r('salesOps','POST','/import/mapping/inspect', `${SO}/import/mapping/inspect`) and likewise preview and commit; no assertion weakened", command: "pnpm --filter @fxl-sales/api exec vitest run src/middleware/__tests__/edition-gate-map.test.ts", owner: builder}` and add the file to `files_modified`. After 11b the same three entries stay valid (the importacao module is on in the Construbom set).
2. `ALLOWED_CALLERS` entries are spelled relative to `src/` (`'domains/crm/defaults.ts'`, see the 07b diff). Replace in the affected row and in the paragraph `'apps/api/src/domains/import/mapping/routes.ts'` by `'domains/import/mapping/routes.ts'`. Also note the regex `SEED_CALL` matches `ensureCrmDefaults(` even in a comment of any other new file; 14b's `catalog.ts`/`executor.ts` must not contain that call text.
3. After phase 2 the allow-list is `['domains/crm/crm-read-service.ts','domains/crm/defaults.ts','domains/sales-ops/leads/stages-seed.ts']`; 14b's edit must be applied on top of that (append, keep the comments). Simpler and preferred: have `mapping/routes.ts` call the existing facade `ensureLeadStages(tx, orgId)` that `import/routes.ts`'s `seededCatalog` already uses, which needs no allow-list change. If the executor prefers `ensureCrmDefaults`, keep item 2.


#### m2 [MINOR] 14a: orcamento stage refusal is stricter than 11c
14a refuses any `type = 'orcamento'` stage (`stage_not_allowed`) even when `orcamentos` is off, where 11c says the stage is a normal one that accepts imported leads. Acceptable as a first cut (safer); state it in 14a's non-goals and in the import reference doc: "an orcamento stage is never an import target, even with the module off." If the owner wants parity, `readMappingCatalog` takes the D3 `modules` parameter and maps `type` through `effectiveStageBehavior`.


#### m4 [MINOR] 14c / 12a ordering of nav label for Importacao
No defect: `cadastros/importacao` requires `importacao`, the mapping UI is a mode inside it (ImportContainer toggle). Only record in 14c that `Planilha modelo` stays available and uses the FXL Vendas brand (`template-brand.test.ts` is in 14's files_modified; its assertion on the sheet title must be named in 14b Tests; currently only the file name is listed).

