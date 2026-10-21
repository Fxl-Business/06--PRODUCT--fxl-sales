# Run 20261021T201219Z-hotfix-import-openxml-sdk

Flow: hotfix (promotion lane, express, Gate 3 approved by the operator).
Release: v4.7.2 at `ba1505f` (production and staging).
Plan: `nexo/plans/20261021T201219Z-hotfix-import-openxml-sdk.md`.

## Symptom
A customer filled the import template with 101 clientes and 101 leads and the upload was refused in production with `400 invalid_file`.
The file had been re-saved by a tool built on the Open XML SDK: SpreadsheetML tags prefixed `x:`, absolute relationship targets, VML drawings named `vmldrawing.vml`.
exceljs 4.4.0 threw `TypeError: Cannot read properties of undefined (reading 'sheets')`, and `parseWorkbook` turned it into `invalid_file`.
Reproduced against `origin/production` with the customer's file before any change.

## What shipped
- `normalizeXlsxPackage` (`apps/api/src/domains/import/xlsx-package.ts`) rewrites only the package shape before exceljs loads it and returns any other package byte-identical.
- `jszip@3.10.2` exact-pinned in `apps/api` (the version exceljs already resolved).
- The template's Leia-me gains `Como salvar o arquivo`.
- Oracle `xlsx-package.test.ts`: a real template converted to the SDK shape makes plain exceljs throw, and parses into the same rows with no issue and every header note intact.
- The customer's original file parses with 0 issues and plans 101 clientes and 101 leads on both master and v4.7.2.
- A corrected copy of the customer's file, with the same `Como salvar o arquivo` section in its Leia-me, was handed to the operator on their Desktop for an immediate import.

## Slice log
| Leg | Agent | Result |
| --- | --- | --- |
| 01 build on master (`35409e2`, merge `bd42fe3`) | orchestrator (Opus) | red then green |
| 01 Gate 2 on master | Sonnet verify, 20:19 to 20:30 | PASS: unit 2331 + 112 guards, lint 0, type-check 0, build 0, integration 549 |
| v4.7.2 cherry-pick on `6465c92` (`ba1505f`) | orchestrator | clean apply |
| v4.7.2 release-verify | Sonnet verify, 20:31 to 20:33 | lint, type-check, unit 3459 + 91 guards, cold build, frozen lockfile all 0; integration could not run (shared test DB at master's schema) |
| v4.7.2 integration | Sonnet verify, 20:34 to 20:35 | PASS: 51 files, 403 tests on a fresh isolated DB `fxl_sales_v471` (dropped after) |

## Delivery
- Gate 3: the operator asked for a true hotfix (production stays v4.7.1 plus the fix, master stays as it is plus the fix), so the express lane shipped an isolated patch instead of master's tip, which carries 176 unreleased commits (CRM unificado, migrations 0029 to 0031).
- Tag `v4.7.2` on `ba1505f`; production and staging fast-forwarded `6465c92..ba1505f` with plain pushes.
- master merged `v4.7.2` with `-s ours` (`4c60730`, tree unchanged), so production ⊆ staging ⊆ master holds.
- The master push also published the 173 local master commits that were ahead of `origin/master` (the vendas-crm-unificado run); no deployment branch moved because of it.
- The production API runs on AWS and `/health` reports `version: unknown`, so the API deploy of `ba1505f` must be confirmed by the operator.

## Learning
A hotfix on a promotion repo whose master carries unreleased work is an isolated patch on the production tip, verified there, with the trunk reconciled by an `-s ours` merge; and a release-verify of an old tag needs its own fresh test database, because the shared one runs master's migrations.
