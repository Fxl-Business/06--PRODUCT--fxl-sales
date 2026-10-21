# Run 20261021T204651Z-hotfix-import-openpyxl

Flow: hotfix (promotion lane, express, Gate 3 approved by the operator: "sim, sobe a v4.7.3").
Release: v4.7.3 at `2e9ddbf` (production and staging), over v4.7.2 `ba1505f`.
Plan: `nexo/plans/20261021T204651Z-hotfix-import-openpyxl.md`.
Follows: `20261021T201219Z-hotfix-import-openxml-sdk` (v4.7.2).

## Symptom
The operator pointed out that customers fill the template by handing it to an AI assistant, not by opening desktop Excel, so the v4.7.2 Leia-me text talked to the wrong reader.
Testing that path showed a real defect: the template opened and saved by openpyxl (what ChatGPT and Claude run) was still `invalid_file` on v4.7.2.
openpyxl writes the header notes as `xl/comments/comment<N>.xml` and `xl/drawings/commentsDrawing<N>.vml`; exceljs 4.4.0 only routes `xl/comments<N>.xml`, and its reconcile throws `TypeError: Cannot read properties of undefined (reading 'comments')`.

## What shipped
- `normalizeXlsxPackage` finds comments and VML drawing parts by the relationship type that points at them, never by path, and renames the ones exceljs does not route.
- The Leia-me sections `Preencher com um assistente de IA` (instructions addressed to the assistant: open with `openpyxl.load_workbook`, save with `save`, never rebuild, keep tabs and headers, one record per row, `.xlsx` out) and `Salvar o arquivo`.
- Oracle: a real template converted to the openpyxl layout makes plain exceljs throw, and parses into the same rows with no issue and every header note intact.
- The operator's Desktop copy of the customer file was rebuilt with the same two sections; data identical to the original, parses clean before and after an openpyxl round trip.

## Slice log
| Leg | Agent | Result |
| --- | --- | --- |
| 01 build on master (`d1e1903`, merge `3323407`) | orchestrator (Opus) | red then green |
| 01 Gate 2 on master | Sonnet verify, 20:49 to 20:52 | PASS: lint, type-check, suite, build 0; integration 549; real openpyxl round trip of the template (1 lead, 1 cliente) and the customer file (102 and 102) with 0 issues; plain exceljs throws on both |
| v4.7.3 cherry-pick on `ba1505f` (`2e9ddbf`) | orchestrator | clean apply |
| v4.7.3 release-verify | Sonnet verify, 20:49 to 20:56, in parallel | PASS: lint, type-check, unit 3462, cold build, frozen lockfile, integration 403 on isolated `fxl_sales_v473` (dropped after) |

## Delivery
- Tag `v4.7.3` on `2e9ddbf`; production and staging fast-forwarded `ba1505f..2e9ddbf`.
- master merged `v4.7.3` with `-s ours` (`f38e5fe`, tree unchanged); production ⊆ staging ⊆ master checked after the push.
- The production API (AWS) deploy is not observable from here.

## Learning
Test the path the customer actually takes: the v4.7.2 fix proved the reported file but not the AI-assistant round trip that most customers use, and the same class of bug survived it.
