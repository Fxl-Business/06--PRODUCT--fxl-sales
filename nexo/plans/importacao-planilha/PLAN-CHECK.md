# PLAN-CHECK - importacao-planilha

Checked against `SEAM-CONTRACT.md` (all amendments and the slice 06 resolution), every `NN-*.md` plan, and master `a373651` (`apps/api/src/domains/import/{types,workbook-schema,cells,parse}.ts`, `sales-ops/service.ts`, `settlements.ts`, `leads/*`, `audit/service.ts`, `db/schema.ts`).
Verdict: the set is buildable and every AC1-AC10 has an owner once the corrections below are applied.
Each correction is binding for the named slice executor and overrides the slice plan where they disagree.

## Required corrections

1. Slice 03 executor: switch to `ImportRefIndex` (Amendment slice 02 #2 and #7).
   `planLeads(parsed, catalog, refs: ImportRefIndex)`, with `import type { ImportRefIndex } from '../refs.js'`; the rule "never import from '../refs.js'" is superseded for TYPE imports only.
   Rewrite purity test case 23 to forbid only a VALUE import of refs.js (for example `/^import (?!type\b)[^;]*from '\.\.\/refs\.js'/m`), keeping the other bans.
   The vendedor check is `refs.resolvePersonWithFuncao(v, 'vendedor')`: a `missing_funcao` failure becomes your own `seller_not_a_vendedor` issue with your message; every other failure passes through with its own code and message.
   Delete `isVendedorFuncaoName`, `personIsVendedor` and the normalized-name fallback, and delete case 6 (a fresh org without Vendedor is unreachable under D11b; refs.ts owns membership).
   Cases 5 and 7 (workbook and existing pessoa membership) run against the REAL `buildRefIndex` over `seededCatalog()`/`richCatalog()` from `__tests__/plan-fixtures.ts`; any remaining fake must implement every `ImportRefIndex` method.

2. Slice 03 executor: reuse slice 02's `plan/plan-helpers.ts` (Amendment slice 02 #3).
   Use `PLACEHOLDER_UUID` (do not export `LEAD_PLACEHOLDER_ID`), `header`, `rowError`/`rowWarning`, `lookupIssue` and `erroredRowKeys` instead of local copies.
   `counts` carries `leads` only when at least one operation was emitted (a sheet whose rows all fail returns `counts: {}`, never `{ leads: 0 }`); add one test for it.

3. Slice 04 executor: switch to `ImportRefIndex` (Amendment slice 02 #2 and #7); without it `planPropostas` does not type-check, because it calls `planCadastros(parsed, catalog, refs)`, whose third parameter is `ImportRefIndex`.
   `planPropostas` and `planPropostasWith` take `refs: ImportRefIndex`; `fakeRefs` in `propostas-fixtures.ts` returns an `ImportRefIndex` implementing all five methods.
   Vendedor and finder checks are `refs.resolvePersonWithFuncao(name, 'vendedor' | 'finder')`: `missing_funcao` maps to your `seller_without_funcao` / `finder_without_funcao` code and message, other failures pass through.
   `person_lacks_funcao` is `!refs.personHasFuncao(personRef, funcaoRef)`.
   Delete `funcaoSlugsOfPerson` and `funcaoRefsOfPerson`; case 39 runs against the REAL `buildRefIndex`.

4. Slice 04 executor: own the `profissionais.pessoa` help fix (Amendment slice 04, binding).
   Add `apps/api/src/domains/import/workbook-schema.ts` to `files_modified`; the rule "Never edit workbook-schema.ts" is lifted for exactly this one string.
   New help text, verbatim: `Pessoa que exerce a função no projeto; o cadastro da pessoa não é alterado.`
   Nothing else in that file changes; run `src/domains/import/__tests__/workbook-schema.test.ts` and `template.test.ts` (slice 08, merged in wave 2) after the edit.

5. Slice 04 executor: the example round-trip oracle (case 51) must use a SEEDED catalog (D11/D11b): system funções Vendedor and Finder plus the four default etapas, and no other rows (`seededCatalog()` from `plan-fixtures.ts` is exactly that).
   With `funcoes: []` the example pessoa's `Vendedor` is `unknown_ref`, `resolvePersonWithFuncao` answers `missing_funcao`, and the oracle fails for a reason that cannot occur in production.
   The expected op (`clientes:2`, `pessoas:2`, `produtos:2`, `funcoes:2`, wonOn `2026-01-20`) is unchanged.

6. Slice 04 executor: one implementation of shared helpers.
   Use `refKey` and `sameRef` from `../refs.js` instead of exporting `refKeyOf` (key `ProposalProductIndex` by `refKey`), `PLACEHOLDER_UUID` from `./plan-helpers.js` instead of `DRAFT_PLACEHOLDER_UUID`, and `erroredRowKeys(parsed.issues)` instead of `errorRowKeys`.

7. Slice 05 executor: the planner signature is `planDesfechos(parsed, catalog, _refs: ImportRefIndex, propostas)` (Amendment slice 02 #2, `import type`); the throwing test stub implements all five `ImportRefIndex` methods, each throwing.

8. Slice 06 executor: apply the "Resolution of slice 06 planning deviations"; it overrides `06-executor.md` wherever they differ.
   Delete File 2 entirely: `apps/api/src/domains/sales-ops/service.ts` is NOT modified by this slice (slice 02 already exports `ensureSystemFuncoes(tx, orgId): Promise<void>`).
   Delete `SYSTEM_REF_PREFIX`, `SYSTEM_FUNCAO_REF_PREFIX`, `SYSTEM_LEAD_STAGE_REF_PREFIX`, algorithm step 3 (prelude), and the imports of `ensureSystemFuncoes`, `ensureLeadStages`, `LEAD_STAGE_SEEDS` and `SystemFuncaoSlug`.
   Remove `ensureLeadStages` and `ensureSystemFuncoes` from the rules' allowed-writes list and delete the rule about the service.ts change.
   Delete the unit test `keeps the reserved system ref keys stable`; `uses Importação for a system key` becomes `uses Importação for a malformed key` (for example `'x'`).
   Extend `executor source writes nothing itself` to also forbid `ensureLeadStages`, `ensureSystemFuncoes` and `system:`.

9. Slice 06 executor: integration tests seed like the routes do and reference seeds by `{ existingId }`.
   For each org, in a separate committed `withTenant(getDb(), orgId, async (tx) => { await ensureLeadStages(tx, orgId); await ensureSystemFuncoes(tx, orgId); })` run BEFORE `before = snapshot(orgId)`, then read the seeded Vendedor id (slug `vendedor`) and Perdido id (`kind = 'lost'`) through `getAdminDb()`.
   `fullPlan` step 4 uses `{ existingId: vendedorId }` and step 8 uses `{ existingId: perdidoId }`; no `system:` ref anywhere.
   Adjust assertions: funções are exactly `consultor`, `vendedor` and `finder`; lead stages stay 5 (4 seeds + Diagnóstico); rollback oracles compare to a `before` that already contains the seeds (drop the comment that the seeds are gone).

10. Slice 07 executor: implement D11b in the one catalog path.
    `seededCatalog(tx, orgId, now)` is `await ensureLeadStages(tx, orgId); await ensureSystemFuncoes(tx, orgId); return readImportCatalog(tx, orgId, now);`, with `ensureSystemFuncoes` imported from `../sales-ops/service.js` (slice 02's two-argument signature).
    Update rule 38, the top-of-file comment and Seam deviation 3 to name both seeds.
    Add to `preview seeds the default etapas only inside its rolled-back transaction` a Pessoas tab row with Funções `Vendedor` that resolves with zero errors in the fresh org, and keep `expectNothingWritten` after it (it covers `sales_ops_funcoes`).

11. Slice 07 executor: the 409 `message` is `error.message` (accepted 06 deviation 3), not a route-built sentence.
    Delete `describeExecutionFailure`, its export and its unit test; replace the unit test with one asserting the 409 body is `{ error: 'conflict', reason: 'import_execution_failed', message: <ImportExecutionError.message> }` and never contains `planKey`, `saleKey` or a uuid.
    The integration 409 assertion becomes `message` contains `Aba Propostas, linha 2`.
    Never serialize or log `error.operation`.

12. Slice 07 executor: the round-trip oracle uses the full example dataset (Amendment slice 08).
    Expected preview counts are `Object.fromEntries(SHEET_KEYS.map((k) => [k, buildExampleDataset(today)[k].length]))` with `today = todayInSaoPaulo(new Date())` from `@fxl-sales/shared-utils/sao-paulo-day`, never 1 per sheet and never literals.
    `createdBySheet` stays a one-to-one equality for the 11 sheets other than `itens` and `parcelas`, because basic propostas (P2, P3, P5) create sale items and receivables that no Itens or Parcelas row counts.
    For those two, assert totals derived from the dataset: `count(sale_items) === counts.itens + <number of dataset propostas rows with non-null produto>`, and `count(non-M receivables) === counts.parcelas + <sum over basic propostas of the generated installment count>` (the produto's `parcelas` default, plus one when it has an `entradaPct`/`entradaBrl` default; for the dataset this is 3 + 3 + 3).
    Replace "the sale row has status won" with: the only `won` sale has `won_at` São Paulo day `2026-01-20`, and the org has exactly one `open`, one `draft`, one `lost` and one `cancelled` sale.
    AC5 end to end: the `open` sale (P2, basic) has exactly one item with `unit_brl` 500000 and non-M receivables `166666, 166666, 166668` in due order (remainder on the last), plus 12 `M` receivables.
    AC6 end to end: the org has 2 receivable baixas with `origin 'manual'` (P1 `1/1` with its linked payables also settled, and P1 `M1/12`).

13. Slice 07 executor: make the 409 rollback test prove what it claims.
    With `gate.liveAfterCatalog`, the executor's producer PRE-SCAN throws before its first operation, so no cadastro is written (only the two seeds are); fix the test comment accordingly and keep the test.
    Add `rolls back cadastros, sales and the audit entry when execution fails after writing` (AC4 at the route): `vi.mock('../executor.js')` with a hoisted flag `gate.failAfterExecute` whose wrapper awaits the ACTUAL `executeImportPlan` and then throws `new actual.ImportExecutionError(plan.operations[plan.operations.length - 1], 'already_paid')`.
    Assert 409 and `expectNothingWritten(orgId)`; the round-trip oracle in the same file is the positive control showing the same commit writes rows when the flag is off.

## Non-blocking notes

- `00-OVERVIEW.md` slice table still shows 06 `depends_on: 01` and the old waves; the binding waves are 1={01}, 2={02,08,09}, 3={03,04,06}, 4={05}, 5={07}, and 06 depends on 02.
  No `files_modified` overlap exists inside any wave once correction 8 removes service.ts from 06 (02 is the only slice touching `sales-ops/service.ts`; 04 the only one touching `workbook-schema.ts`; 07 the only one touching `sales-ops/routes.ts`).
- 03 Seam deviation 2 and 08 Seam deviation 4 are superseded by D11/D11b; implement nothing for them.
- Issue sorting and truncation are owned once by 07 (`sortIssues` in `planImport`, truncation in `toPreviewBody`, `ok` from the full list); planners need not sort.
- 05 places its test in `plan/__tests__/desfechos.test.ts` while every other slice uses `import/__tests__/`; both are collected by the unit config, so either is fine.
- 04's generated plan can contain zero-amount rows when the restante in cents is smaller than the parcela count; `buildSaleLedger` drops them and 05's `plannedReceivableLabels` mirrors that, so labels stay consistent (wizard gate not replicated; acceptable for v1).
- `03`, `04` and `02` each define their own test workbook/catalog builders; reusing `plan-fixtures.ts` is preferred but not required.
- Slice 09 (already built) shows generic copy for 409 and does not surface the API `message`; acceptable, the row location is lost to the user, consider a follow-up.
- AC10 has no single owner by design: each wave verify and the final feature verify run full lint, type-check, unit, integration and `pnpm run build` (web build included).
