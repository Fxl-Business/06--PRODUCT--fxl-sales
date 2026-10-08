# Exec 03 - import recognizes existing clientes

Slice: `03-import-recognize-clients`.
Branch: `feat/20261008T114022Z-03-import-recognize-clients` (worktree `.worktrees/20261008T114022Z-construbom-leads-ajustes/03-import-recognize-clients`), base `b3ceab7`.

## Step 0 - reproduction (unchanged product code)

Test A of `import-routes.integration.test.ts` was written first and run alone (`-t "recognizes the clientes"`) on the unchanged code.
For this run only, step 2 asserted `counts` alone (the plan's exact step 2 also expects `recognized: {}`, a field that does not exist yet, so it would have stopped before the bug), and the re-preview body was printed.
The final test file was restored byte-for-byte afterwards.

Printed re-preview body (leads edition, after the first commit and the lixeira deletes):

```
{"counts":{"clientes":3,"leads":3},"warnings":8,"issues":[["clientes",2,"Nome","possible_duplicate"],["clientes",2,"CNPJ/CPF","possible_duplicate"],["clientes",3,"Nome","possible_duplicate"],["clientes",3,"CNPJ/CPF","possible_duplicate"],["clientes",4,"Nome","possible_duplicate"],["leads",2,"Empresa","ambiguous_client"],["leads",3,"Empresa","ambiguous_client"],["leads",4,"Empresa","ambiguous_client"]]}
```

Failing assertion:

```
AssertionError: expected { clientes: 3, leads: 3 } to deeply equal { leads: 3 }
 ❯ src/domains/import/__tests__/import-routes.integration.test.ts:593:32
```

This is exactly the predicted shape: `recognized` undefined, 3 duplicate clientes to create, 8 warnings (3 existing-name, 2 existing-document since one row has no document, 3 `ambiguous_client`), the 114 x 3 pattern the human saw.

## Red

API unit, before any product change: 15 failures across `client-recognition.test.ts` (module missing), `refs.test.ts` (3, `ambiguous_ref` and no `recognizedClient`), `cadastros.test.ts` (5, `recognized` undefined and duplicate `createClient`), `plan-leads.test.ts` (2, `ambiguous_client`), `plan-propostas.test.ts` (1, ambiguous cliente error), `plan-index.test.ts` (3), `template.test.ts` (1).
Web, before the web change: 6 failures (`issues.test.ts` 1, `import-copy.test.ts` 2, `import-view.test.tsx` 3).
Every failure was for the reason the plan names.

## Green

Implemented exactly as the plan's steps 1 to 9 (`satisfies` form kept: lint accepted it).

| Oracle | Result |
| --- | --- |
| API unit `vitest run src/domains/import` (16 files) | 325 passed |
| API integration `import-routes.integration.test.ts` | 13 passed (10 existing + A + B + re-plan test) |
| API integration `executor.integration.test.ts` + `catalog.integration.test.ts` | 15 passed (9 + 6) |
| Web `vitest run src/sales-ops/import` (4 files, `import-routing` included) | 35 passed |
| Extra: `leads-edition-no-seed.test.ts`, `edition-gate-map.test.ts` (the only other tests reaching the import modules) | 231 passed |
| `pnpm --filter @fxl-sales/api type-check` (src, scripts, test tree) | exit 0 |
| `pnpm --filter @fxl-sales/web type-check` | exit 0 |
| eslint on every changed api and web file | exit 0 |

The diff touches exactly the 27 paths of `files_modified` and nothing else, and adds no em dash character.

## Commits

- `eabfded` feat(import): recognize existing clientes on re-import (API, product and tests).
- `3b161e6` feat(import): show recognized clientes in one line on the import screen (web).

Each commit is green on its own: the web field is optional, so the API commit alone changes nothing on screen.

## Deviations and additions

- Step 0 ran a temporary variant of test A (step 2 on `counts` only, plus a body print) so the run reached the re-preview; the committed test A is the plan's exact version.
- Plan-check note 7 applied: a third integration test, `re-plans the recognition at commit: a cliente created after the preview is recognized by the commit`, previews (`counts { clientes: 1, leads: 1 }`, `recognized {}`), creates the cliente through `createClient`, then commits and gets `201 { counts: { leads: 1 }, recognized: { clientes: 1 } }` with one cliente in the org and the lead linked to it.
- Plan-check note 1 applied: the recognized line sits right under the counts table, as the plan's JSX and test say.
- `client-recognition.test.ts` test 13 reverses `catalog.clients` for test 2's exact input (one cliente, trivially) and for test 9's (three clientes, the meaningful check), as the plan lists.
- The `renders no recognized line ...` web test also asserts the second Validar really called the preview again and step 3 is shown, so its "still none" is not vacuous.
- `CLAUDE.md` and `nexo/knowledge/**` were not edited; the plan's "Docs to update at Capture" section is left to the Capture scribe.

## Processes

Every run was a foreground run-once invocation (`vitest run`, `test:integration`, `tsc --noEmit`, `eslint`); nothing was left running.
