# Run record: Construbom, kanban values, cliente on the card and import recognition

Run id: `20261008T114022Z-construbom-leads-ajustes`
Mode: autopilot, milestone v4.7.0, integrated on `feat/20261008-00-run` (base `b3ceab7`, head `55d8adf` before Capture).
Plan: `nexo/plans/construbom-leads-ajustes/00-OVERVIEW.md`.

## Request

First part, verbatim:
"Vamos precisar liberar uma funcionalidade para o módulo da Construbom.
Mostrar a soma de valores no topo da coluna do Kanban (igual tem na versão normal).
Isso pode mudar para ambos: o que aparece direto no Kanban tem que ser Nome & Cliente, ao invés de Nome e contato como é hoje.
No input de cliente o texto deve ser 'Buscar ou criar novo', algo assim para ficar claro."

Second part, mid-run, verbatim:
"Aproveite e já resolva isso: tive que apagar todo mundo e importar a mesma planilha de novo; ao invés dele já identificar os clientes já criados, ele deu esse monte de mensagem (342 avisos: 'Já existe um cliente chamado ... no cadastro', 'O documento ... já é do cliente ...').
Posso importar normalmente ou vai acabar duplicando?"

The human's answers, from two rounds of questions in chat:
- R$ in the leads edition: the same as the full edition (column header with total, `% do total` and bar; value on the card; R$ on the Lista chips and footer).
- Card versus Lista: only the CARD swaps the contact for the Cliente; the Lista keeps `telefone · email` under the name.
- Cliente field: the leads edition says "Buscar ou criar novo cliente"; the full edition, whose picker does not create a cliente, says "Buscar cliente cadastrado" (the rule that a full-edition lead never creates a cliente stays).
- Import, how to recognize an existing cliente: by CNPJ/CPF; without a document, by name; the same name with different documents still creates a new cliente, with a warning.
- Import, a recognized cliente: it is NOT changed, only reused (the import stays create-only).

Root cause of the import report, confirmed in code before planning: `planClientes` always emitted `createClient` and only warned on a same-name or same-document cliente, so `refs.ts` saw two candidates for every empresa in the Leads tab and answered `ambiguous_ref`.
342 = 114 name warnings + 114 document warnings + 114 `ambiguous_client` warnings; committing that preview would have created 114 duplicate clientes and 114 leads linked to none.

## Slices

| Slice | Slice commit(s) | Merge | What |
| --- | --- | --- | --- |
| 01-web-leads-board-parity | 16187da | 112d13e | Leads-edition column header R$ total, `% do total` and bar; card shows Nome, Cliente (`Sem cliente`) and birthday with the value beside the menu; Lista R$ chips, footer `TOTAL` and a `Valor estimado` column |
| 02-web-client-picker-copy | 6978481 | 3cb5d37 | `client-picker-copy.ts`: `Buscar ou criar novo cliente` where the picker creates, `Buscar cliente cadastrado` where it does not, on the trigger and the search field |
| 03-import-recognize-clients | eabfded, 3b161e6 | a146f13 | `recognizeClientRows` in `client-recognition.ts`: a Clientes row that is an existing cliente is reused, never written, and reported in one line on the import screen |
| 04-web-visual-polish | 17ff17a, 7c1d7ab, 45f27b8 | 67bed52 | Cliente on its own full-width card row; one `Combobox` divider above the create row; `+ Adicionar item livre` on one line with the 16px field rhythm |
| 05-web-inline-button-height | 65cf81b | 55d8adf | `self-stretch` on the inline dialog buttons so they match the field height |

Slices 01 to 03 were planned up front and ran in parallel in wave 1.
Slices 04 and 05 were inserted mid-flight from defects measured in the browser during the end-to-end pass, and ran as waves 2 and 3.

## Verify

- Slice 01: oracle 15 files 212/212 on three runs; lint and type-check exit 0; red check 17 failed and 19 passed at the base; 22 of 22 mutants killed; PASS.
- Slice 02: oracle 9 files 147/147 twice; the 5 new dialog tests red at the base; 11 of 11 mutants killed (one probe in `combobox.tsx` only to prove the Escape tests are not vacuous); PASS.
- Slice 03: oracle 19 files 335 tests twice (API unit 272, API integration 28, web 35); lint and both type-checks exit 0; 19 of 19 mutants killed; PASS.
- Slice 04: oracle 8 files 148/148 twice; red check 4 failed and 66 passed at the base; 15 of 15 mutants killed; PASS.
- Slice 05: oracle 5 files 85/85 twice (a vacuous "No test files found" run was discarded); 6 of 6 mutants killed; PASS.
- Wave 1 (`a146f13`): cold build with `assert-web-bundle-clean`, lint, type-check, unit (auth-fake 48, shared-utils 174, api 1482, web 1726, node:test 91), integration 51 files 403 tests, audit with no high advisories (12 moderate, 1 low, pre-existing), no em dash in the diff; PASS.
- Waves 2 and 3 (`55d8adf`), ONE integrated run: cold build, lint, type-check, unit (auth-fake 48, shared-utils 174, api 1482, web 1731, node:test 91), integration 51 files 403 tests, the same audit result, no em dash; PASS.
- Feature-tier mutation testing: no tool is configured, so it closed `not_applicable`; the slice Verifies ran 73 targeted mutants (22 + 11 + 19 + 15 + 6), all killed.

Reports: `verify-01-web-leads-board-parity.md` to `verify-05-web-inline-button-height.md`, `verify-wave-1.md` and `verify-wave-2.md`.

## E2E

The orchestrator drove the real app (`make dev-fake` pair, local Postgres, Chrome at 1440x900) from `a146f13`, then `67bed52` and `55d8adf`.
The import reproduced the Construbom report with a 3-cliente workbook: the re-import showed ONE recognized line and zero warnings, the commit created only the leads, and each cliente exists once with every lead linked to it.
The leads-edition Quadro, card and Lista showed the R$ figures, the card showed the Cliente, and `leads-seller` saw the same chrome over his own scope.
The leads-edition picker read `Buscar ou criar novo cliente` and the full-edition one `Buscar cliente cadastrado`.
Four defects were found and fixed in the run: the truncated Cliente line (introduced by slice 01), the double `Combobox` divider, the wrapped `+ Adicionar item livre`, and the inline buttons shorter than their fields (all three pre-existing).
Not covered: a real 390px viewport (the window resize did not apply).
Details: `e2e.md`.

## Budget

17 agent dispatches of 64, 2 replans of 3, 5 slices of 24 (3 initial plus 2 inserted), one Verify attempt per slice, 0 wave recoveries.

## Decisions

- Slices 04 and 05 were planned by the orchestrator directly from the browser measurements, not by a planner sub-agent.
- The leads-edition Lista also got the `Valor estimado` column, not only the R$ chips and footer.
- The leads-edition card falls back to `Sem cliente`; the full edition keeps `Sem empresa`.
- The no-create picker copy is `Buscar cliente cadastrado` in the full edition and in the leads edition when inline create is not wired.
- Recognition is decided once, inside `buildRefIndex`, and is carried by preview, commit and the `import.completed` audit as `recognized: { clientes: N }`.
- Rules: `CLAUDE.md` (UI Controls, Kanban de leads, Edição Leads, Importação por planilha) and `nexo/knowledge/reference/` (`importacao-por-planilha.md` D12, `kanban-de-leads.md`, `ui-controls.md`).

## Audit

`AUDIT.md` lists the autopilot decisions and the open items: re-import the Construbom spreadsheet in production after the deploy, decide whether the import should recognize leads, the pre-existing web test noise, and the missing 390px check.
