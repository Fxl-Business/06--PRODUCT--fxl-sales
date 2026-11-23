---
id: 01-api-plano-por-funil
milestone: v4.8.0
status: todo
depends_on: []
files_modified: [apps/api/src/domains/import/types.ts, apps/api/src/domains/import/workbook-schema.ts, apps/api/src/domains/import/catalog.ts, apps/api/src/domains/import/pipeline-resolution.ts, apps/api/src/domains/import/refs.ts, apps/api/src/domains/import/parse.ts, apps/api/src/domains/import/plan/cadastros.ts, apps/api/src/domains/import/plan/leads.ts, apps/api/src/domains/import/plan/stage-map.ts, apps/api/src/domains/import/plan/index.ts, apps/api/src/domains/import/executor.ts, apps/api/src/domains/import/routes.ts, apps/api/src/domains/import/template.ts]
affected_tests: [apps/api/src/domains/import, tests/acceptance/mapear-etapas, tests/acceptance/exportar-leads]
acceptance: Contract sections Workbook (columns and parser skip), Catalog, Funil resolution, Planning rules and HTTP hold, proven by unit tests and by an integration test on the real router with two funis.
---

# 01 - Plano e gravação por funil

Goal: implement every section of `contracts/SEAM-CONTRACT.md` except "Template and export".

Order (TDD, Red first):
1. `pipeline-resolution.ts` with `__tests__/pipeline-resolution.test.ts` (every rule and code, case/diacritics, archived vs active same name, map wins, invalid target).
2. Schema columns, `FUNIS_TAB`, parser skip.
3. Catalog (`readPipelineFuncaoLinks` from `../crm/pipeline-access.js` gives `funcaoIds`; read pipelines with the org filter; stage kind through `legacyStageKindFor(row, modules)` as today).
4. `refs.resolveStage`, `checkNewStage`, planEtapas, planLeads, stage-map summary, `planImport(parsed, catalog, stageMap?, pipelineMap?)`.
5. Executor and routes. `createLeadStageInPipeline` also answers `'pipeline_not_found'`: map it to `ImportExecutionError(operation, 'pipeline_not_found')` with a pt-BR reason in the table.
6. `import-routes.integration.test.ts`: two funis (create the second with `createPipelineWithDefaultStages` or `POST /pipelines`) - rows for both, same etapa name in both, blank refused, unknown then mapped, an id of another org refused, vendedor without access refused, Etapas tab into the second funil, old sheet without the column in a one-funil org.

Hand-written catalogs (`plan-fixtures.ts`, `propostas-fixtures.ts`, `plan-index.test.ts`, `template.test.ts`, `plan-leads.test.ts` and the other import tests) need one default `pipelines` entry and `pipelineId` on every stage: with `pipelines: []` every blank Funil would be `funil_required`.

Keep: admin gate, all-or-nothing, preview writes nothing, no second implementation of any rule.
The example template still imports with zero errors (`template-example.test.ts`, round trip).
Existing tests change only where the contract changed the shape (op `pipelineId`, catalog `pipelines`, `resolveStage`); never weaken an assertion and never edit `tests/acceptance/`.
The template must keep building (the `'funis'` list source must not break `buildListColumns`: add the plain list of active funis here; the dependent dropdown is slice 02). The `etapas` list keeps its present values for a one-funil org.

Oracle: `apps/api/src/domains/import/__tests__/pipeline-resolution.test.ts` and `import-routes.integration.test.ts`.
Lint: `pnpm --filter @fxl-sales/api lint`. Types: `pnpm --filter @fxl-sales/api type-check`.
