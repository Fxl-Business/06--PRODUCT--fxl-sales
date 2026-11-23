---
id: 02-api-modelo-e-exportacao
milestone: v4.8.0
status: todo
depends_on: [01-api-plano-por-funil]
files_modified: [apps/api/src/domains/import/template.ts, apps/api/src/domains/import/export.ts, apps/api/src/domains/import/funis-sheet.ts]
affected_tests: [apps/api/src/domains/import, tests/acceptance/exportar-leads]
acceptance: Contract section "Template and export" holds, proven on the generated workbook bytes re-read with exceljs, and an export of two funis imports back by funil.
---

# 02 - Modelo e exportação

Goal: the contract's "Template and export" section.

- New pure `funis-sheet.ts`: `buildFunisRows(catalog)` (the rows) plus the small writer; `template.ts` only calls it. Bold header, frozen first row, auto filter, readable widths (Funil 28, Etapa 28, Tipo 18, the two flags 26, Funções 48), wrapped text, text numFmt, a thin top border where the funil changes. No merged cells.
- Dependent dropdown: hidden `Listas` gets two aligned helper columns (`Funil da etapa`, `Etapa do funil`), one row per importable active etapa, contiguous per funil. The Leads Etapa validation is `OFFSET(<etapa first cell>,MATCH(<funil cell relative>,<funil range>,0)-1,0,SUMPRODUCT(--(<funil range>=<funil cell relative>)),1)`. No COUNTIF (funil names may contain `*`, `?`, `~`, `>`), under 255 characters, relative row, absolute column, `showErrorMessage: false`. MATCH is also wildcard-aware for text in exact mode, so a `*` `?` `~` in the typed name must not select another funil: use `MATCH(1,INDEX(--(<range>=<cell>),0),0)`.
- A catalog stage name list that is empty must not produce an invalid range.
- Leia-me: explain the Funil column, the blank rule, the reference tab, that a funil is only created in Cadastros > Funis e etapas, and in the IA section that the `Funis e etapas` tab must not be renamed or edited and that funil and etapa names are copied from it. Update `SHEET_PURPOSE` for etapas and leads and the schema `help` texts of Funil and Etapa.
- Export: `funil` = pipeline name, joined in the same query with the org filter.

Tests: `__tests__/funis-sheet.test.ts`, additions to `template.test.ts`, `export-roundtrip.integration.test.ts` (two funis, same etapa name in both, back into the same names).
Never weaken an assertion; never edit `tests/acceptance/`.
Oracle: `apps/api/src/domains/import/__tests__/funis-sheet.test.ts`, `template.test.ts`, `export-roundtrip.integration.test.ts`.

The dropdown FORMULA is unit-tested as text; its evaluation is checked by the orchestrator in a real spreadsheet program, not by this slice.
An export test covers a lead in an archived funil (the name is written).
