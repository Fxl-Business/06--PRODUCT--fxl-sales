# Importação por planilha

Rules live in `CLAUDE.md` under "Importação por planilha".
This file holds the reasoning and the map.
Run record: `nexo/runs/20261002T124500Z-importacao-planilha/run.md`.
Re-import recognition of clientes (D12): run `20261008T114022Z-construbom-leads-ajustes`, plan `nexo/plans/construbom-leads-ajustes/03-import-recognize-clients.md`.
Plans and the authoritative interface: `nexo/plans/importacao-planilha/` (`SEAM-CONTRACT.md`).

## Purpose and audience

The import is the onboarding tool and the on-demand bulk loader of FXL Sales.
The FXL team runs an assisted onboarding: it joins the customer's Hub organization as `admin`, switches to it, and uploads one `.xlsx`.
The same screen serves a customer admin who wants to add a few more propostas from Excel.
The screen is `cadastros/importacao` ("Importação"), visible only where Cadastros is visible (admin).
The org is always the token's org; nothing in the file is trusted for tenancy.

## The workbook

One `.xlsx`, fixed tabs, in dependency order.
`Leia-me` is instructions only and is never parsed.
A hidden `Listas` tab carries the dropdown sources and is ignored by the parser.

| Tab | Sheet key | Child of |
| --- | --- | --- |
| Áreas | `areas` | - |
| Funções | `funcoes` | - |
| Produtos | `produtos` | - |
| Custos por produto | `custosProduto` | Produtos (by produto name) |
| Pessoas | `pessoas` | - |
| Clientes | `clientes` | - |
| Etapas | `etapas` | - |
| Leads | `leads` | - |
| Propostas | `propostas` | - |
| Itens da proposta | `itens` | Propostas (by `Ref`) |
| Profissionais da proposta | `profissionais` | Propostas (by `Ref`) |
| Parcelas | `parcelas` | Propostas (by `Ref`) |
| Pagamentos | `pagamentos` | Propostas (by `Ref`) |

Row 1 is the header row, data starts at row 2, fully blank rows are skipped.
A tab that is absent or has only its header is empty and produces nothing.
Headers match by trimmed, case and diacritic insensitive text; column order does not matter.
An unknown header is a warning (`unknown_column`), a missing required header is an error (`missing_column`).
Issue rows are the 1-based Excel row the user sees, and issue columns are the pt-BR header text, never the key.

### Ref linking

Child tabs of Propostas point at their proposta through a user-written `Ref` (any text, unique in the Propostas tab).
`Custos por produto` points at a produto by name.
Existing cadastros are referenced by name (trim, case and diacritic insensitive); a produto also resolves by its code suffix written `#<suffix>`.
Resolution order is existing active record, or a workbook row created earlier in the same plan.
A Clientes row recognized as an existing cliente (D12) resolves to that cliente under its sheet name, deduplicated against the cliente's own entry, so neither spelling is ambiguous.
A reference to an archived record is an error (`archived_ref`), an unknown one is `unknown_ref`, an ambiguous one is `ambiguous_ref`.

### Basic versus full depth

The importer chooses the depth per proposta.
Basic: a `Propostas` row with only cliente, vendedor, produto and base date creates an `Aberta` proposta whose items and payment plan come from the produto defaults and the org settings (commission and tax, exactly like the wizard).
Full: Itens, Profissionais, Parcelas (including recorrência), `Ganha` with a historical day, `Perdida`, `Cancelada`, and Pagamentos as baixas.
Status mapping: Rascunho creates `draft`; Ganha creates `won`; blank or Aberta creates `open`; Perdida and Cancelada create `open` and then `transitionSale` to `lost` or `cancelled`.

## Rules and decisions

- Create-only. An import never updates, there is no upsert and no skip-existing mode.
- D5. A cadastro row (área, função, produto, etapa) whose name already exists ACTIVE in the org is an error `duplicate_existing`, not a silent reuse. The row must be removed from the file; every reference elsewhere already resolves to the existing record. Áreas, funções and etapas also error on an archived same name (`duplicate_archived`), because the database name index covers archived rows. A produto with an archived same name is a `possible_duplicate` warning. Pessoas have no unique name, so a same-name or same-email match is a warning `possible_duplicate`; clientes follow D12, and only an UNRECOGNIZED same-name or same-document cliente row is a `possible_duplicate` warning.
- D6. A reference to an ARCHIVED record is an error `archived_ref`, mirroring the pickers that hide archived rows.
- D1. Writes reuse the domain services inside one `withTenant` transaction (nested `withTenant` is a savepoint). No raw INSERT into a business table, so code suffixes, função rules, won payables, settlement validators and the audit chain keep one implementation.
- D2. Finance rule. When `isProducerFlowLive(orgId)` is true, `Ganha` propostas and every `Pagamentos` row are errors `producer_flow_live` in the preview, and the executor re-checks before any won `createSale` or settlement. Importing history into a connected org would either emit old facts as new events or leave Finance missing them (backfill is a declared non-goal of the integration). Cadastros, leads, Rascunho and Aberta are always allowed. Perdida and Cancelada are allowed because `createSale` emits only for `won` and `transitionSale` only into or out of `won`.
- D3. A historical won day calls `createSale(..., now = <wonOn>T15:00:00Z)` (noon in São Paulo), so `won_at` and the payables' won day are historical. A won day after `todayInSaoPaulo` is an error (`won_on_in_future`), also re-checked by the executor.
- D4. A payment is a baixa through `applyBaixaTx` with the `manual` policy (whole open amount, never in the future, only on a won proposta), origin `manual`. An optional `Repasses pagos` column also settles the payables linked to that parcela on the same day.
- D7. A lead cannot be imported into the conversion etapa (conversion only happens by creating a proposta in-app). A lead in the lost etapa needs `Motivo da perda`.
- D8. No migration. `audit_log.action` is application-validated text, so `import.completed` is an `AuditActionSchema` addition only.
- D9. Limits: 5 MB upload (`MAX_UPLOAD_BYTES`), 5000 data rows across all sheets (`MAX_TOTAL_ROWS`), at most 500 issues returned (`MAX_RETURNED_ISSUES`, `truncated: true` beyond).
- D10. The cadastro history panel does not list `import.completed` in v1; the entry exists for audit.
- D11 and D11b. A fresh org gets the default etapas on its first `GET /lead-stages` or bootstrap (seed on read, slice 02 of run 20261021T011348Z-vendas-crm-unificado), and it may have no Vendedor/Finder funções until the import or a first seed creates them. Both routes call `ensureLeadStages` and `ensureSystemFuncoes` inside their transaction before `readImportCatalog`. Preview and template download run in a transaction that is ALWAYS rolled back (`readOnlyTenant`), so they still write nothing; commit keeps the seed. `readImportCatalog` and the executor never seed. A rejected design had the executor seed through `system:` refs.
- D12. Re-import recognition of clientes (run 20261008T114022Z-construbom-leads-ajustes).
  Construbom deleted its leads and re-imported the same workbook: the preview showed 342 warnings (114 "Já existe um cliente chamado ...", 114 "O documento ... já é do cliente ...", 114 `ambiguous_client`) and, had it been committed, would have created 114 duplicate clientes plus 114 leads linked to none.
  The cause was `planClientes` always emitting `createClient` and only warning, so `refs.ts` saw two candidates (the existing cliente and the workbook row) for every empresa in the Leads tab and answered `ambiguous_ref`.
  `recognizeClientRows` now decides once, inside `buildRefIndex`: equal document digits first (several clientes with them narrow to the one with the row's name, otherwise not recognized and never a name fallback), then exactly one same-name cliente whose document agrees with every same-name row of the tab.
  A recognized row is reused and never written, emits no operation and no issue, and both its sheet name and the stored name resolve to the existing id with the stored name as label.
  The same name with a different document is created with the old `possible_duplicate` warning.
  The human chose the rule (document first, then name; same name with different documents stays a new cliente with a warning) and that a recognized cliente is never updated, so the import stays create-only.
  Rejected: one warning per row (the reported bug), one file-level warning issue (reads as a problem and never reaches the commit body or the audit), passing the recognition as a planner argument (two entry points could disagree), and picking one of several same-document clientes by id (an arbitrary link).
  Known edges: a recognized row skips `ClientSchema` validation of its optional columns (nothing is written) and the in-sheet duplicate bookkeeping, so an unrecognized row reusing its sheet name gets no in-sheet name warning, but a lead naming that name still raises `ambiguous_client`, so nothing is silent.
- D13. Mapear etapas (run m-202611111703-mapear-as-etapas-da-planilha).
  Leads exported from another organization carry etapa names that do not exist here, and the import refused each row with `Não encontramos a etapa` or with the conversion error, so the only way out was editing the sheet by hand.
  Preview and commit take an optional multipart field `stageMap` (JSON): the name as written in the Leads tab maps to `{ stageId }`, `{ create: true }` or `{ first: true }`.
  Names are matched with `normalizeLabel`, like every other lookup.
  The planner applies the map in `plan/leads.ts` BEFORE `refs.resolve('stage')`; a name with no entry keeps the old behaviour, and a request with no `stageMap` plans exactly as before.
  `{ stageId }` is never trusted: it must be an ACTIVE, non-conversion etapa found in the catalog, which holds only the default pipeline of the org read from the token.
  An id of another organization, an unknown id, an archived etapa or the conversion etapa is the row error `invalid_stage_target` on the Etapa column, and nothing is written (all or nothing, as always).
  `{ first: true }` is the same as a blank Etapa cell: the executor puts the lead in the first open etapa.
  `{ create: true }` goes through `checkNewStage` in `plan/cadastros.ts`, the one core that `planEtapas` (the Etapas tab) also uses, so the `duplicate_existing` and `duplicate_archived` rules and `LeadStageSchema` have no second implementation.
  It emits one `createLeadStage` with the plan key `stageMap:<n>` for all the leads of that name; when the Etapas tab of the same file already creates the etapa, the leads reuse that plan key and there is still one creation.
  The loss reason rule still runs on the resolved etapa: mapping to the lost etapa without `Motivo da perda` is a row error.
  A malformed `stageMap` (not JSON, wrong shape, an unknown key inside an entry, or a file instead of text) is `400 { error: 'validation_error', reason: 'invalid_file' }` with no write; a blank field means no map.
  The commit re-parses, re-reads the catalog and re-plans WITH the map it receives, so it never relies on the preview.

## Preview versus commit

Preview parses, reads the catalog and plans inside a rolled-back transaction and answers `ImportPreviewBody`.
Commit never trusts a preview: it re-parses the same file, re-reads the catalog inside its own transaction, re-plans, and executes only at zero errors.
Any plan error answers `422` with the fresh preview body; any service refusal mid-transaction answers `409` and rolls back everything (cadastros, sales, ledger and the audit entry).
The executor runs the operations in plan order and ends with exactly one `import.completed` audit entry (`entityType: 'importacao'`, `afterJsonb: { counts, recognized, actorLabel }`), written in the same transaction.
`isPlanOk` treats a file-level error (`sheet: null`, such as `too_many_rows`) as not ok.

## HTTP contract

Base `/api/v1/sales-ops/import`, every route behind `requireAdmin`.

| Route | Answer |
| --- | --- |
| `GET /template?example=0\|1` | `200` xlsx attachment (`fxl-vendas-importacao.xlsx` or `fxl-vendas-importacao-exemplo.xlsx`), `Cache-Control: no-store`, dropdowns from the org's active cadastros |
| `POST /preview` (multipart `file`, optional `stageMap`) | `200 ImportPreviewBody { ok, counts, recognized, issues, truncated, leadStages, stageTargets }` |
| `POST /commit` (the same file and the same `stageMap` again) | `201 { counts, recognized }`, `422 ImportPreviewBody`, or `409 { error: 'conflict', reason: 'import_execution_failed', message }` |

Upload refusals: no file or not an xlsx is `400 { error: 'validation_error', reason: 'invalid_file' }`; over the limit is `413 { error: 'payload_too_large', reason: 'file_too_large' }`.
A readable xlsx with no template tab is not a 400: it is a `no_known_sheets` error in a normal preview.
`leadStages` lists the distinct names of the Etapa column of the Leads tab (first spelling wins, order of first appearance) as `{ name, leads, resolution }`; `resolution` is `{ kind: 'existing', stageId }` (an etapa with that name, `stageId: null` when the Etapas tab of the same file creates it), `{ kind: 'not_found' }` or `{ kind: 'conversion' }`.
`stageTargets` lists the etapas a lead may be sent to (`{ id, name, kind: 'normal' | 'lost' }`): active, of the default pipeline, in board order, never the conversion etapa.
Both are computed by `summarizeLeadStages` WITHOUT the map, so the table of the web screen keeps showing the sheet as written, while `issues` reflect the map that was sent.
The `409` message is the pt-BR sentence of `ImportExecutionError` naming tab and row, with no ids.

## Module layout (API)

All code is in `apps/api/src/domains/import/`.

- `workbook-schema.ts`: THE one sheet and column definition (tabs, headers, kinds, required, help, example, dropdown source). The template, the parser and every planner read only this. Never hand-type a header, tab or column key anywhere else.
- `types.ts`: every shared type, including `ImportPlan`, `ImportOperation`, `ImportPreviewBody`.
- `cells.ts`: pure cell coercers; `normalizeLabel` is the one trim/case/diacritic rule, shared with refs.
- `parse.ts`: `parseWorkbook(bytes)` to `ParsedWorkbook`.
- `catalog.ts`: `readImportCatalog(tx, orgId, now)`, the org snapshot (never writes).
- `client-recognition.ts`: `recognizeClientRows` and `documentDigits`, the D12 rule; pure, called only by `buildRefIndex`.
- `refs.ts`: `buildRefIndex`, name to existing id or workbook ref; it owns the Clientes recognition (`recognizedClient`).
- `plan/stage-map.ts`: `StageMapSchema` (strict Zod shape of the field) and `summarizeLeadStages`; pure.
- `plan/`: `cadastros.ts`, `leads.ts`, `propostas.ts`, `desfechos.ts`, `plan-helpers.ts`, and `index.ts` (`planImport`, `isPlanOk`, `toPreviewBody`). Planners are pure: no I/O, no clock, no env.
- `executor.ts`: `executeImportPlan`, only existing domain services.
- `template.ts`: `buildTemplateWorkbook` and `buildExampleDataset(today)`; row 1 of each tab equals the schema example fields.
- `routes.ts`: `importRouter`, mounted at `salesOpsRouter.route('/import', ...)`.

## The web screen

`apps/web/src/sales-ops/import/`: `ImportContainer.tsx`, `ImportView.tsx`, `ImportCountsTable.tsx`, `ImportIssueList.tsx`, `hooks.ts`, `api.ts`, `issues.ts`, `import-copy.ts`, `types.ts`.
`StageMapStep.tsx` is the Mapear etapas step.
`SalesOpsApp.tsx` has one mount line for `view === 'importacao'`; the nav entry sits right before `Geral`.
Steps: download the blank or example template, upload and validate, map the etapas (only when the Leads tab has etapas), then import.
`Importar` is enabled only for an ok preview with something to create, and asks for confirmation; it commits the same file.
Mapear etapas shows the table `Etapa na planilha | Leads | Vai para`, one `Combobox` per etapa name (no native select), with the `stageTargets`, `Criar etapa com este nome` and `Primeira etapa`.
Names already matched by `resolution` come pre-filled (an etapa created by the Etapas tab reads `Criada pela aba Etapas` and sends no entry); the unresolved ones, and the conversion one, start empty and highlighted.
`Validar novamente` sends the file again with the `stageMap` of the choices, and `Importar` stays disabled while any etapa has no destination or the preview has any error; commit sends the same `stageMap`.
A new file selection discards the previous preview.
Errors are classified by HTTP status only: a 403 renders inline admin copy and never `ForbiddenPanel`; a 409 shows `Nada foi importado: <body.message>` (slice 09.1); 413, 422 and generic have their own copy.
The web never parses xlsx and never renders an id.
When the server recognized clientes, one line under the counts table says how many (`IMPORT_COPY.recognizedClients`, `data-import-recognized`), and the success panel repeats it in the past tense (`recognizedClientsDone`); with nothing to create the table reads `Nenhum registro novo para criar.` (`nothingNew`).
The wire field is optional and `recognizedClientCount` reads an absent or malformed value as 0, so an older API shows no line.

## Oracles

API (`apps/api/src/domains/import/__tests__/`):
- `import-routes.integration.test.ts`: real router and database, admin gate, template download, rolled-back seeding in preview, round trip of the example template on a fresh org (AC2), re-plan at commit, all-or-nothing, producer-live refusal with an empty outbox, oversize upload.
  D12 re-import tests: `recognizes the clientes of a re-imported Clientes + Leads workbook in the leads edition and links the new leads to them without writing the cadastro` (every `sales_ops_clients` column compared before and after), `links leads to an existing cliente recognized by document under another name, with the stored name as snapshot`, and `re-plans the recognition at commit: a cliente created after the preview is recognized by the commit`.
- `executor.integration.test.ts`: hand-built plans, historical won day, settled parcela, one last `import.completed`, rollback of every table, producer-live and future-day re-checks.
- `template-example.test.ts` and `template.test.ts`: example dataset is consistent, never after today, every reference resolves.
- `workbook-schema.test.ts`, `cells.test.ts`, `parse.test.ts`: the one definition, coercers, parser.
- `cadastros.test.ts`, `plan-leads.test.ts`, `plan-propostas.test.ts`, `plan/__tests__/desfechos.test.ts`, `plan-index.test.ts`, `refs.test.ts`, `plan-helpers.test.ts`, `catalog.integration.test.ts`: the planners and the catalog.
- `client-recognition.test.ts`: the D12 rule (document first, name with tab-wide document agreement, several same-document clientes never fall back to the name, purity).
- `plan-stage-map.test.ts`: the map in the planner (stageId, first, create, invalid targets, loss reason, no map equals today) and `summarizeLeadStages`.
  `import-routes.test.ts` covers the shape of the field; `tests/acceptance/mapear-etapas/` drives preview and commit with the real database (`map-stages.integration.test.ts`) and the screen (`map-stages-step.web.test.tsx`).
- `exceljs-pin.test.ts`: `exceljs` pinned exactly.
- `xlsx-package.test.ts`: a real template re-saved in the Open XML SDK shape makes plain exceljs throw, and `parseWorkbook` reads it into the same rows with no issue and the header notes intact; an exceljs-written package comes back byte-identical.

Web (`apps/web/src/sales-ops/import/__tests__/`): `import-view.test.tsx` (including the one recognized line, `nothingNew` and the past-tense success line), `import-routing.test.tsx`, `import-copy.test.ts`, `issues.test.ts`.

Slice 10 added tests for the five mutation survivors: parcelas above the items total, a file-level error in `isPlanOk`, the executor's `producer_flow_live` re-check before a settlement, its `won_on_in_future` re-check, and the singular error title.

## Package shape (hotfix 2026-10-21)

A customer's file re-saved by a tool built on the Open XML SDK was refused in production as `invalid_file` although every row was valid.
exceljs 4.4.0 reads only the package shape it writes: it matches unprefixed SpreadsheetML tags (the SDK writes `<x:workbook>`), it keys comments and VML drawings by the relative relationship target (the SDK writes `/xl/comments1.xml`), and it routes only `vmlDrawing<N>.vml` (the SDK writes `vmldrawing.vml`).
`parseWorkbook` therefore loads the bytes through `normalizeXlsxPackage` (`apps/api/src/domains/import/xlsx-package.ts`), which rewrites only the package shape, never a cell, and returns a package that needs nothing as the same bytes.
`jszip` is a direct dependency pinned exactly to the version exceljs already resolves, so the tree does not move.
The template's Leia-me carries a `Como salvar o arquivo` section after `Como importar`.
A new package quirk that exceljs cannot read belongs in `normalizeXlsxPackage` with a fixture in `xlsx-package.test.ts`, never in a second parser.

Follow-up hotfix v4.7.3 (same day): customers usually fill the template by handing it to an AI assistant (ChatGPT, Claude), which opens and saves it with openpyxl.
openpyxl writes the header notes as `xl/comments/comment<N>.xml` and their drawings as `xl/drawings/commentsDrawing<N>.vml`, and exceljs only routes `xl/comments<N>.xml`, so every AI-filled file was still `invalid_file` on v4.7.2.
`normalizeXlsxPackage` now finds the comments and VML drawing parts by the relationship type that points at them, never by path, and renames the ones exceljs does not route.
The Leia-me section became `Preencher com um assistente de IA`, written as instructions TO the assistant (open with `openpyxl.load_workbook`, save with `save`, never rebuild, keep tabs and headers, one record per row, `.xlsx` out), followed by `Salvar o arquivo` for people editing by hand.

## Known gaps

- One-shot payables not linked to a parcela (outros custos) cannot be settled from the sheet in v1; `Leia-me` says so.
- `exceljs` brings one moderate advisory (`exceljs > uuid`); fixing it needs a major `uuid` change under `exceljs`. The two high `brace-expansion` advisories were fixed by raising the existing override in `pnpm-workspace.yaml` to `1.1.21`.
- `pnpm install` is needed after pulling: without it `make dev` fails with `Cannot find package 'exceljs'`.
- A CNPJ typed as a number in Excel loses leading zeros, so it can miss a cliente stored with them and fall back to the name rule.
- Re-importing a Leads tab duplicates the leads already on the board with no warning, because leads are not recognized; open as a product question in the run's `AUDIT.md`.
- Not built: update or upsert, CSV or Google Sheets, settings import, Hub account provisioning or seller invitations, a lead imported as converted, proposta notes history, recognition of existing Pessoas, Produtos or Leads (only Clientes are recognized, D12).
- Outside this feature: a fresh org gets the default etapas on its first read (seed on read), and it still has no Vendedor/Finder funções on Pessoas until the import (or a first seed) creates them. The audit chain's `canonicalJson` does not hash the nested `beforeJsonb`/`afterJsonb` content. Both are open questions in the run's `AUDIT.md`.
