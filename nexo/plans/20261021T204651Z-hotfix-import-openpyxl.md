# Hotfix plan - importação recusa planilha salva por IA (openpyxl)

Run: 20261021T204651Z-hotfix-import-openpyxl
Milestone: v4.8.0
Follows: `20261021T201219Z-hotfix-import-openxml-sdk` (v4.7.2).

## Symptom
Customers fill the import template by uploading it to an AI assistant (ChatGPT, Claude), which opens and saves it with Python's openpyxl.
openpyxl writes the header notes as `xl/comments/comment<N>.xml` and their drawings as `xl/drawings/commentsDrawing<N>.vml`, with absolute targets.
exceljs 4.4.0 only routes `xl/comments<N>.xml`, so the worksheet reconcile throws `TypeError: Cannot read properties of undefined (reading 'comments')` and the upload is `400 invalid_file`, even on v4.7.2.
Reproduced on master: the template, opened and saved by openpyxl with one extra lead row, parses as `invalid_file`.

The Leia-me section `Como salvar o arquivo` (v4.7.2) also talks to a person with desktop Excel, while the person usually hands the file to an AI that never opens Excel.

## Fix
- `normalizeXlsxPackage` finds comments and VML drawing parts by the relationship TYPE that points at them, not by path, and renames each one exceljs would not route to a free `xl/comments<N>.xml` / `xl/drawings/vmlDrawing<N>.vml`, rewriting every relationship and the content-type override.
- The Leia-me section becomes instructions addressed to the AI assistant (open with `openpyxl.load_workbook` and `save`, never rebuild, keep tabs and headers, one row per record, `.xlsx` out), plus the person's lines.

## Acceptance criteria (oracle)
`apps/api/src/domains/import/__tests__/xlsx-package.test.ts`, new case: a real template converted to the openpyxl layout makes plain exceljs throw, and `parseWorkbook` reads it into the same rows with no issue and every header note intact.
`template.test.ts` asserts the AI instructions.
Manual proof in Verify: a real openpyxl round trip of the template and of the customer's corrected file parses with no issue.
