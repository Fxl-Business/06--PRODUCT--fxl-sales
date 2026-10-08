# Verify 03-import-recognize-clients (Gate 2)

Verdict: PASS.

Target: worktree `.worktrees/20261008T114022Z-construbom-leads-ajustes/03-import-recognize-clients`, branch `feat/20261008T114022Z-03-import-recognize-clients`, commits `eabfded` and `3b161e6` on base `b3ceab7`.
Contract: `nexo/plans/construbom-leads-ajustes/03-import-recognize-clients.md` and AC7 to AC12 plus the human decisions in `00-OVERVIEW.md`.
The verifier edited no product code and made no commit.

## 1. Scope

`git diff --name-only b3ceab7..HEAD` lists 27 files, and every one is in the plan's `files_modified` (27 entries, set difference empty both ways).
Nothing under `nexo/`, no `CLAUDE.md` edit, and no migration file.
The only added files are `client-recognition.ts` and `client-recognition.test.ts`.
Zero U+2014 characters among the added diff lines and zero in the two commit messages.

## 2. Oracle (whole list, twice)

Every oracle file exists on disk (checked before running, because the unit config has `passWithNoTests`).

API unit, `pnpm --filter @fxl-sales/api exec vitest run` on the 12 unit oracle files: run 1 12 files 272 tests passed, run 2 12 files 272 tests passed.
Per file (run 1): client-recognition 14, refs 23, cadastros 46, plan-leads 27, plan-propostas 55, plan-index 11, executor 12, template 16, template-example 9, workbook-schema 15, import-routes 6, desfechos 38.
API integration, `pnpm --filter @fxl-sales/api test:integration` (verified as `VITEST_INTEGRATION=1 vitest run` in `apps/api/package.json`) on import-routes.integration, executor.integration and catalog.integration: run 1 3 files 28 tests passed, run 2 3 files 28 tests passed.
Per file: import-routes.integration 13, executor.integration 9, catalog.integration 6.
The integration database was the local Docker Postgres on `localhost:5006` through the `fxl_sales_test` role.
Web, `pnpm --filter @fxl-sales/web exec vitest run` on import-view, import-copy, issues and import-routing: run 1 4 files 35 tests passed, run 2 4 files 35 tests passed.
No file timed out, so no isolated rerun was needed.
Totals per run: 19 files, 335 tests, all green both times.

## 3. Lint and types

`eslint --max-warnings=0` on the 19 changed API files exits 0.
`eslint --max-warnings=0` on the 8 changed web files exits 0.
`pnpm --filter @fxl-sales/api type-check` (src, scripts and test tsconfigs) exits 0.
`pnpm --filter @fxl-sales/web type-check` exits 0.

## 4. Contract read of the diff

The product code matches the plan's exact implementation steps 1 to 9 with no deviation.
Document first: `recognizeClientRows` matches by `documentDigits` equality, recognizes under another name, narrows several same-document clientes to the one with the row's normalized name, and never falls back to the name when the document matched anyone (`if (byDoc.length > 0) continue`).
Name rule: exactly one existing cliente with the normalized name, and the distinct non-empty documents of that cliente plus every same-name row of the tab must number at most one.
Same name with another document is not recognized, and `planClientes` keeps its four warning texts unchanged in the diff (only `digits` became `documentDigits`).
A recognized row is skipped in `planClientes` before any warning, `createClient` or `seenName`/`seenDoc` bookkeeping, and only increments `recognizedCount`.
Nothing UPDATEs `sales_ops_clients` on the import path: the executor only calls `createClient`, and the one `update(salesOpsClients)` in the API (`updateClient` in `sales-ops/service.ts`) has no caller under `domains/import`.
The integration tests compare every column of every `sales_ops_clients` row (full `select()`, so `updated_at` included) before and after the re-import commit, and the row count is pinned.
In `buildRefIndex` a recognized row registers `{ existingId }` with the stored name as label, and `toLookup` deduplicates the pool by `refKey`, so the sheet spelling and the stored spelling both resolve to the existing id.
Leads `Empresa` is proven under both spellings (unit plan-leads plus integration test B, snapshot `Construtora Alfa`), and the leads-edition re-import of a Clientes + Leads workbook yields zero issues and links all three leads (integration test A).
`recognizeClientRows` has exactly one call site (`refs.ts:234`), and `planClientes` reads it only through `refs.recognizedClient(row.row)`, so planner and index structurally share one answer.
`recognized` rides `toPreviewBody` (preview and the 422 body), the 201 commit body and the `import.completed` `afterJsonb` as `{ counts, recognized, actorLabel }`.
Commit re-plans from scratch: the test `re-plans the recognition at commit` creates the cliente after the preview and the commit recognizes it.
Web: exactly one `[data-import-recognized]` under the counts table (document order asserted), one in the success panel, `nothingNew` as the empty text when everything was recognized, and `recognized` is optional on the wire type with `recognizedClientCount` reading absent, zero, NaN or other keys as 0.
`isImportPreviewBody` is unchanged and does not require the new key.
Tenancy: no new database read was added; the catalog read stays `eq(salesOpsClients.orgId, orgId)` inside the route's `withTenant` or `readOnlyTenant`, and recognized ids come only from that org-scoped catalog, never from the file or body.
The Leia-me line promising a warning for clientes is replaced by the two planned lines, and the template test pins both and the absence of the old one.

### Criteria asserted only weakly

Propostas `Cliente` is unit-tested only for a name-recognized row with the same spelling as the cadastro; no test covers a Propostas row naming a document-recognized row under the sheet spelling, and no integration re-import carries a Propostas tab.
That path uses the same `refs.resolve('client')` as Leads, and probes M3, M9 and M10 show the shared lookup is guarded by the refs tests, so this is a coverage gap, not a defect.
The 422 commit body carrying `recognized` is asserted only through the `toPreviewBody` unit tests, not at the route.
The in-sheet duplicate warnings of unrecognized rows are asserted by row, column, severity and code only; their byte-identity rests on the unchanged diff lines, not on a message assertion.
The tab-wide document agreement (M2), the several-documents no-fallback (M8), the existing-document check in the name rule (M14) and the stored-name label (M10) are killed only by unit oracles; the integration suite does not exercise them.

## 5. Mutation probes

Each probe was a perl edit, confirmed to change the file, run against the named oracles, then restored with `git checkout -- <file>`.
All failures were assertion failures (no transform or syntax error in any probe log).

| Mutant | Edit | Result | Killer tests |
| --- | --- | --- | --- |
| M1 | `client-recognition.ts`: document-first branch disabled | killed (unit 8 red, integration 1 red) | `recognizes a row by its document digits even under another name`, `lets the document win`, refs `resolves a recognized Clientes row...`, integration `links leads to an existing cliente recognized by document under another name` |
| M2 | `client-recognition.ts`: tab-wide document agreement replaced by the row's own document | killed (unit 1 red) | `does not recognize by name when the tab gives that name two different documents` |
| M3 | `refs.ts`: pool dedupe by `refKey` disabled | killed (unit 3, integration 2) | refs `never makes a recognized row ambiguous with its own existing cliente`, plan-leads `links a lead to a recognized cliente with no ambiguous_client`, plan-propostas `resolves the cliente to a recognized Clientes row`, integration test A |
| M4 | `cadastros.ts`: recognized row no longer skipped (createClient and warnings again) | killed (unit 2, integration 3) | cadastros `recognizes an existing cliente by document or name`, `two rows recognized as the same cliente`, integration tests A, B and re-plan |
| M5 | `routes.ts`: commit body drops `recognized` | killed (integration 3) | integration tests A, B and re-plan |
| M6 | `plan/index.ts`: `toPreviewBody` drops `recognized` | killed (unit 2, integration 3) | plan-index `carries the planners' recognized rows...`, integration tests A, B, re-plan |
| M7 | `executor.ts`: audit `afterJsonb` drops `recognized` | killed (integration 2) | executor.integration `writes exactly one import.completed entry...`, integration test A |
| M8 | `client-recognition.ts`: several same-document clientes fall back to the name | killed (unit 1) | `narrows several clientes with the row document ... never falls back to the name` |
| M9 | `refs.ts`: recognized rows registered as `planKey` again | killed (unit 5, integration 3) | refs recognition tests, plan-leads, integration tests A, B, re-plan |
| M10 | `refs.ts`: sheet name as label instead of the stored name | killed (unit 1) | refs `resolves a recognized Clientes row ... under the sheet name and the stored name` |
| M11 | `cadastros.ts`: `recognized` always `{}` | killed (unit 2, integration 3) | cadastros recognition tests, integration tests A, B, re-plan |
| M12 | `plan/index.ts`: `planImport` `recognized` always `{}` | killed (unit 1, integration 3) | plan-index `carries the planners' recognized rows...`, integration tests |
| M13 | `executor.ts`: result `recognized` always `{}` | killed (integration 4) | executor.integration `creates one of everything...`, integration tests A, B, re-plan |
| M14 | `client-recognition.ts`: name rule ignores the existing cliente's document | killed (unit 3) | refs `keeps an unrecognized same-name row ambiguous`, cadastros `warns on an unrecognized same-name cliente...`, client-recognition `does not recognize the same name with a different document` |
| W1 | `ImportView.tsx`: step-3 recognized line removed | killed (web 2) | `tells in one line how many clientes were recognized...`, `says there is nothing new to create...` |
| W2 | `ImportView.tsx`: empty text ignores recognized | killed (web 1) | `says there is nothing new to create when every row was recognized` |
| W3 | `issues.ts`: reader requires `recognized` (intolerant) | killed (web 11) | issues `recognizedClientCount reads ... absent ... as zero`, import-view tests with an old-shape body |
| W4 | `ImportView.tsx`: success-panel recognized line suppressed | killed (web 1) | `repeats the recognized count in the past tense after the import` |
| W5 | `ImportView.tsx`: one recognized line per row instead of one | killed (web 1) | `tells in one line how many clientes were recognized and leaves them out of the counts` |

Mutants: 19 applied, 19 killed, 0 survivors.

## 6. Tree state

`git status --porcelain` in the slice worktree is empty after the probes.
No process started by this verification is left running.

## Counts

Oracle: 19 files and 335 tests green on each of two runs (API unit 272, API integration 28, web 35).
Lint 0 errors on 27 changed files; api and web type-check exit 0.
Mutation: 19 of 19 killed.
