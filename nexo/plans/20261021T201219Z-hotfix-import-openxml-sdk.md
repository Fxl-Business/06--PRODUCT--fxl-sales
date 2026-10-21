# Hotfix plan - importação recusa .xlsx gravado pelo Open XML SDK

Run: 20261021T201219Z-hotfix-import-openxml-sdk
Milestone: v4.8.0

## Symptom
A customer filled the import template in production and the upload was refused with `400 invalid_file` ("O arquivo não é uma planilha .xlsx válida.").
The data was correct.
The file had been re-saved by a tool built on the Open XML SDK, which writes a valid package that exceljs 4.4.0 cannot read:

- SpreadsheetML elements carry a namespace prefix (`<x:workbook>`, `<x:worksheet>`), and exceljs matches unprefixed tag names, so `model.sheets` is undefined and `load` throws `TypeError`.
- Relationship targets are absolute (`/xl/comments1.xml`), and exceljs keys comments and VML drawings by the relative target (`../comments1.xml`).
- VML drawings are named `vmldrawing.vml`, and exceljs only routes parts named `vmlDrawing<N>.vml`.

Reproduced against `origin/production` (v4.7.1) with the customer's file: `parseWorkbook` returns one `invalid_file` issue and no rows.
With the package normalized, the same production planner plans 101 clientes and 101 leads with zero issues.

## Fix
- New `apps/api/src/domains/import/xlsx-package.ts`: `normalizeXlsxPackage(bytes)` rewrites only the package shape, never a cell, before exceljs loads it.
  It drops a prefix bound to the SpreadsheetML main namespace, resolves absolute internal relationship targets against the source part, and renames VML drawings outside the `vmlDrawing<N>.vml` pattern (rewriting every relationship that points at them).
  A package that needs none of it is returned byte-identical, so every file exceljs already read takes exactly today's path.
- `parseWorkbook` loads the normalized bytes; a package jszip cannot open still ends as `invalid_file`.
- `jszip` becomes a direct dependency of `apps/api`, pinned exactly to the version exceljs already resolves (3.10.2), so the dependency tree does not move.
- The template's Leia-me gains a `Como salvar o arquivo` section after `Como importar`.

## Acceptance criteria (oracle)
`apps/api/src/domains/import/__tests__/xlsx-package.test.ts`:
1. A real template (with header notes) converted to the Open XML SDK shape makes plain exceljs throw (the fixture reproduces the bug).
2. `parseWorkbook` on that fixture returns the same sheets and rows as on the original, with no issue, and the header notes survive the normalization.
3. An exceljs-written package is returned byte-identical.
4. Garbage still answers `invalid_file`.

`template.test.ts` asserts the new Leia-me section.
