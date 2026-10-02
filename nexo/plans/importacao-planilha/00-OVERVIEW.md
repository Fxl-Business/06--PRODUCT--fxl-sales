---
feature: importacao-planilha
milestone: v4.2.0
---

# Feature: Importação por planilha (onboarding e sob demanda)

## WHAT / WHY (Frame)

Request, verbatim from the human (pt-BR): criar um modelo de planilha para importação do Sales, como processo de Onboarding e também para adicionar "on-demand" (por exemplo só mais algumas propostas via Excel).
Um onboarding usa modelos padrão para subir um Excel e configurar os produtos, trazer os leads da prospecção, as propostas etc.

Decisions the human approved in the brainstorm (Gate 1 is skipped by explicit autopilot):

1. Who: the FXL team runs an assisted onboarding by joining the customer's Hub organization as `admin` and switching to it. The import is an admin screen inside `cadastros`; the org is always the token's org.
2. Depth is the importer's choice, from the basic (an open proposta with just cliente, vendedor and produto, everything else from existing defaults) to everything (won propostas with items, professionals, parcelas, recorrência and payment history, plus lost and cancelled ones).
3. Create-only: an import never updates an existing record. Existing cadastros are referenced by name (produto also by code). Possible duplicates show as warnings in the preview.
4. Validate everything first: a dry-run preview with counts per sheet and every error with sheet, row, column and a pt-BR reason. `Importar` is enabled only with zero errors. Commit re-validates from scratch and writes everything in one transaction (all or nothing).
5. Approach A: one `.xlsx` with fixed tabs in dependency order, child tabs linked by a user-written `Ref`, empty tabs ignored, the template generated server-side from ONE column definition with dropdowns from the org's current cadastros, plus a filled example.

The authoritative interface for every shared name is `SEAM-CONTRACT.md` in this folder.

## HOW decisions taken by the orchestrator (recorded for the Report)

- D1. Writes reuse the existing domain services inside one `withTenant` transaction; nested `withTenant` becomes a savepoint. No raw INSERT into business tables, so code suffixes, função rules, won payables, settlement validators and the audit chain keep exactly one implementation.
- D2. Finance integration: when `isProducerFlowLive(orgId)` is true, `Ganha` propostas and every `Pagamentos` row are refused in the preview (`producer_flow_live`), and the executor re-checks before writing. Importing history into a connected org would either emit old facts as new events or leave Finance permanently missing them (backfill is a declared non-goal of the integration). Cadastros, leads and Rascunho/Aberta propostas are always allowed. Perdida/Cancelada are allowed: slice 05 planning proved `createSale` emits only for `won` and `transitionSale` only into or out of `won`, so an open sale moved to lost/cancelled emits nothing.
- D3. A historical won day is honoured by calling `createSale(..., now = <wonOn>T15:00:00Z)`; a won day in the future is an error.
- D4. Payment history marks a parcela paid through `applyBaixaTx` with the `manual` policy (the same validators as the UI: whole amount, never in the future, only on a won proposta). Origin stays `'manual'`, the same shape the 0024 migration used for its synthetic baixas. An optional `Repasses pagos` column also settles the payables linked to that parcela on the same day. One-shot payables not linked to a parcela (outros custos) are not settable from the sheet in v1; Leia-me says so.
- D5. A cadastro row (área, função, produto, etapa) whose name already exists ACTIVE in the org is an error (`duplicate_existing`), not a silent reuse: create-only means the row must be removed, and every reference elsewhere in the workbook already resolves to the existing record automatically. Clientes and pessoas have no unique name, so a same-name (or same document/e-mail) match is a WARNING (`possible_duplicate`).
- D6. A reference to an ARCHIVED record is an error (`archived_ref`), mirroring pickers that hide archived rows.
- D7. A lead cannot be imported into the conversion etapa (conversion only happens by creating a proposta in-app); a lead in the lost etapa requires `Motivo da perda`.
- D8. No database migration. `audit_log.action` is application-validated text, so `import.completed` is a zod enum addition only.
- D9. Limits: 5 MB upload, 5000 data rows in total, at most 500 issues returned (`truncated: true` beyond).
- D11. A fresh org may have zero etapas (`ensureLeadStages` had no production caller): both routes seed the default etapas inside their transaction before reading the catalog; preview rolls back.
- D10. Cadastro history UI does not list `import.completed` in v1 (the panel filters to cadastro lifecycle actions); the entry exists for audit.

## Scope limits (YAGNI / out of scope)

- No update/upsert, no "skip existing" mode, no per-row partial import.
- No CSV, no Google Sheets, no client-side parsing.
- No settings (`sales_ops_settings`) import, no Hub account provisioning, no seller invitations.
- No lead to proposta link (a lead imported as converted); no proposta `notes` history; no settlement of one-shot payables.
- No new self-service onboarding wizard; the import screen is the onboarding tool.
- Do NOT touch `apps/web/src/sales-ops/leads/**`: a live peer run (`20261002T122805Z-prospeccao-redesign`) is redesigning the leads board there.

## Binding constraints (house rules every slice obeys)

- Tenancy: org only from `c.get('orgId')`; every read filters by org; the import never trusts an org/user id from the file.
- `requireAdmin` on every import route; the 403 renders `MutationErrorBanner`-style inline copy on the import screen, never `ForbiddenPanel`.
- Civil days: every date is an ISO civil day validated by `isIsoDay`; "today" is `todayInSaoPaulo`; never `new Date().toISOString().slice(0,10)`; never format a civil day through `new Date` in the browser.
- Money is integer cents end to end.
- UI controls: no native `<select>`/`<input type="number">`; `<input type="file">` is allowed; dialogs follow `useInlineLayer` rules if any inline layer is used.
- Never render raw ids in the UI; issue messages name values, never uuids.
- Lint, type-check, unit and integration tests stay green at every merge.

## Acceptance criteria (feature-level)

- AC1: `GET /api/v1/sales-ops/import/template` returns an xlsx with the `Leia-me` tab and the 13 data tabs in contract order, headers exactly as `workbook-schema.ts`, dropdowns sourced from the org's active cadastros; `?example=1` returns the same layout with example rows.
- AC2: Parsing the example template from a fresh org yields a plan with zero errors (round trip oracle), and committing it creates exactly the counted rows.
- AC3: Preview reports every error with sheet, Excel row, header text and a pt-BR message, and never writes anything.
- AC4: Commit re-plans from scratch inside one transaction; any error or service refusal rolls back everything (oracle: a failing last operation leaves zero new rows in every table touched).
- AC5: Basic depth works: a `Propostas` row with only cliente, vendedor, produto and data base creates an Aberta proposta whose items and payment plan come from the produto defaults.
- AC6: Full depth works: Itens, Profissionais, Parcelas, recorrência, Ganha with a historical won day (payables materialized for that day), Perdida, Cancelada, and Pagamentos as baixas visible in the settlement history.
- AC7: In a producer-flow-live org, Ganha and Pagamentos rows are errors and nothing is emitted to the integration outbox.
- AC8: Only admins reach the routes (non-admin gets the `requireAdmin` 403 body on the real router).
- AC9: `cadastros/importacao` screen: download blank and example templates, upload, preview with counts and grouped issues, `Importar` enabled only at zero errors, success summary; nav entry inserted before `Geral`.
- AC10: Full lint, type-check, unit suite, integration suite and web build are green.

## Slices

| # | slice | delivers | depends_on | files (primary) |
| --- | --- | --- | --- | --- |
| 01 | contract-and-parser | `exceljs` pinned; `types.ts`, `workbook-schema.ts`, `cells.ts`, `parse.ts` with unit oracles | - | apps/api/package.json, pnpm-lock.yaml, domains/import/{types,workbook-schema,cells,parse}.ts, domains/import/__tests__/{cells,parse,workbook-schema}.test.ts |
| 02 | catalog-refs-cadastros | `catalog.ts`, `refs.ts`, `plan/cadastros.ts` (Áreas, Funções, Produtos, Custos por produto, Pessoas, Clientes, Etapas) | 01 | domains/import/{catalog,refs}.ts, domains/import/plan/cadastros.ts, tests |
| 03 | plan-leads | `plan/leads.ts` | 02 | domains/import/plan/leads.ts, tests |
| 04 | plan-propostas | `plan/propostas.ts`: basic and full depth, Itens, Profissionais, Parcelas, recorrência | 02 | domains/import/plan/propostas.ts, tests |
| 05 | plan-desfechos | `plan/desfechos.ts`: Ganha/Perdida/Cancelada and Pagamentos; producer-live refusal | 04 | domains/import/plan/desfechos.ts, tests |
| 06 | executor | `executor.ts` + `import.completed` audit action; integration tests on the real DB with hand-built plans | 01 | domains/import/executor.ts, domains/audit/service.ts, tests |
| 07 | routes-and-roundtrip | `plan/index.ts`, `routes.ts`, mount in `sales-ops/routes.ts`; integration tests incl. admin gate and example round trip | 03, 05, 06, 08 | domains/import/{routes.ts,plan/index.ts}, domains/sales-ops/routes.ts, tests |
| 08 | template | `template.ts`: Leia-me, headers, hidden Listas, dropdown validations, example rows | 01 | domains/import/template.ts, tests |
| 09 | web-import-view | `cadastros/importacao` view, nav entry, api calls, preview and commit UI | 01 | apps/web/src/sales-ops/import/**, navigation.ts, SalesOpsApp.tsx (one mount line), tests |

Expected waves: 1 = {01}; 2 = {02, 06, 08, 09}; 3 = {03, 04}; 4 = {05}; 5 = {07}.
Builds run in isolated worktrees; merges into `master` are serial and wave-verify runs separately from the merge (repo memory: wave-exec timeout reverts healthy waves).
