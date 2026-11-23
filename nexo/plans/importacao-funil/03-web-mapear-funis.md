---
id: 03-web-mapear-funis
milestone: v4.8.0
status: done
depends_on: [01-api-plano-por-funil]
files_modified: [apps/web/src/sales-ops/import/types.ts, apps/web/src/sales-ops/import/api.ts, apps/web/src/sales-ops/import/hooks.ts, apps/web/src/sales-ops/import/stage-map.ts, apps/web/src/sales-ops/import/pipeline-map.ts, apps/web/src/sales-ops/import/StageMapStep.tsx, apps/web/src/sales-ops/import/PipelineMapStep.tsx, apps/web/src/sales-ops/import/ImportView.tsx, apps/web/src/sales-ops/import/ImportContainer.tsx, apps/web/src/sales-ops/import/import-copy.ts]
affected_tests: [apps/web/src/sales-ops/import, tests/acceptance/mapear-etapas, tests/acceptance/exportar-leads]
acceptance: The screen lists the sheet funis, lets the operator choose the destination funil, scopes the etapa options to it, sends pipelineMap and blocks Importar until everything is resolved and revalidated.
---

# 03 - Mapear funis na tela

- `types.ts`: mirror the contract; all new preview keys optional and read defensively like `readLeadStages` (`readLeadPipelines`, `readPipelineTargets`); a leadStage without `funil` reads `null`, a target without `pipelineId` reads `null` (shown for every funil).
- `importApi.preview(file, token, stageMap?, pipelineMap?)` and `commit` alike; `pipelineMap` is appended only when it has keys. `stageMap` keeps carrying the etapas of blank-funil rows only.
- `PipelineMapStep` (title `Mapear funis`, columns `Funil na planilha`, `Leads`, `Vai para`, one `Combobox` per sheet funil, pre-filled when it exists, `data-import-map-pipelines`, `data-map-pipeline-row`) renders only when `leadPipelines` is not empty AND (some entry does not exist OR the org has more than one funil). Same visual as `StageMapStep`, placed above it. No native select.
- Changing a funil's destination drops the etapa choices of that sheet funil and hides its etapa rows until the next validation (they were resolved in another funil).
- `StageMapStep` groups rows by sheet funil when any row has one, with a heading row `Funil: <nome na planilha>`; blank-funil rows get no heading when they are the only group. Options are the `stageTargets` of that group's funil plus the two special options. Choices are keyed by (funil, etapa), never by the name alone. One `Validar novamente` button for both steps (rendered by whichever step is last).
- `Importar` needs every sheet funil and every etapa resolved, the maps current (both in `validatedMapKey`) and zero errors. On the commit's `422` keep the four summaries already on screen.
- With `defaultChoice` a funil that exists sends NO `pipelineId` while the operator keeps the same funil (it resolves by name).
- Copy: pending text covers funis (`Defina o destino de todos os funis e etapas e valide novamente para importar.` while any funil row exists; the present text otherwise), `step1Text` mentions the `Funis e etapas` tab.

Tests: `__tests__/pipeline-map.test.ts` (pure), additions to `import-view.test.tsx`. Locked acceptance tests stay green untouched.
Oracle: `apps/web/src/sales-ops/import/__tests__/pipeline-map.test.ts`, `import-view.test.tsx`.
