# Verify (Gate 2) - slice 12 proposta-overrides, amendment re-verify

Branch `feat/12-proposta-overrides`, commit `9aa8350` on top of `master` (`d92a8e2`).
Narrow re-verify of the amendment `1dc0032..9aa8350`.
Verdict: **PASS**.

## 1. Gates

All five run from a pristine tree, all exit 0.

| Gate | Exit | Result |
| --- | --- | --- |
| `pnpm run lint` | 0 | clean |
| `pnpm run type-check` | 0 | clean |
| `CI=true pnpm test` | 0 | web 38/354, api 29/300, shared-utils 2/23 |
| `pnpm --filter @fxl-sales/api test:integration` | 0 | 19/101 |
| `pnpm run build` | 0 | built |

Every count matches the expectation exactly.
`db:generate` reports `No schema changes, nothing to migrate`, so there is no drift, and `db:migrate` was never run.
No `.skip`, `.only`, `xit` or `xdescribe` anywhere in `apps/*/src`, `apps/api/test` or `packages/*/src`.

A final confirmation run of `pnpm test` and the integration suite on the restored tree reproduced the same counts.

## 2. Amendment scope

`git diff 1dc0032..9aa8350 --name-only` is exactly four files, 73 insertions and 1 deletion:

- `CLAUDE.md` - one added clause.
- `apps/api/test/rls/sale-professional-funcoes.test.ts` - 3 added lines, the `sales_ops_people` delete plus its comment.
- `apps/web/src/sales-ops/SalesOpsApp.tsx` - the single `Total` line swapped, plus an explanatory comment.
- `apps/web/src/sales-ops/__tests__/sale-wizard-overrides.test.tsx` - one helper and two tests, 57 insertions, 0 deletions.

No `service.ts`, no `schema.ts`, no `drizzle/` migration, no `sale-financials.ts`, no `routes.ts`.
**No tenancy, margin-computation, migration or payables logic changed, so the previous PASS transfers for those areas.**
The only production change in the whole amendment is one render expression.

## 3. Is the Revisão screen coherent?

`financials.totalBrl` is `itemsTotalBrl + boundedRecurringBrl` (`packages/shared-utils/src/sale-financials.ts`).
`buildSaleLedger` (`apps/api/src/domains/sales-ops/service.ts:736`) spreads that same `financials` into the sale row, and `totalBrl` maps to the `total_brl` column (`apps/api/src/db/schema.ts:750`).
`boundedRecurringBrl` is `0` when `cycles === null` on the server and when `recurringIndefinite` in the wizard.
So the line now states exactly the basis that persists, in both the bounded and the indeterminada case.

Five shapes driven through the real wizard (`SaleWizardDialog`), reading the rendered Revisão card:

| Shape | Total rendered | Check |
| --- | --- | --- |
| itens 1.000, recorrência 500/mês x 4, zero costs | R$ 3.000,00 | = 1.000 + 2.000; margin R$ 3.000 (100%), equal to the total as intended |
| itens 1.000, recorrência 250/mês x 1, default pcts | R$ 1.250,00 | margin R$ 1.050 (84%) = 1.250 - 200, coherent |
| itens 1.000, entrada R$ 333,33 + 2x restante, recorrência 300/mês x 5, seller 10% imposto 6% | R$ 2.500,00 | parcelas 333,33 / 333,33 / 333,34 sum to 1.000; margin R$ 2.100 = 2.500 - 399,97; payables `Total previsto R$ 399,97` matches the deduction exactly |
| itens 1.000, no recorrência | R$ 1.000,00 | margin R$ 840 (84%), coherent |
| itens 1.000, recorrência 500/mês indeterminada | R$ 1.000,00 | correctly stays at the itens total; the Recorrência line reads `R$ 500/mês (indeterminado)` |

The uneven-parcelas shape is the sharpest one: the seller commission `Σ floor` per row is 33,33 + 33,33 + 33,33 + 30 x 5 = R$ 249,99 and imposto is 19,99 + 19,99 + 20,00 + 18 x 5 = R$ 149,98, and the Revisão margin, the cost breakdown and the payables preview total all agree with the Total line on the same basis.
No other line on the card disagrees with the ones beside it.

**Reverting the fix** (`financials.totalBrl` back to `totalCents`) turns the bounded test Red and reproduces the reported contradiction verbatim: `TotalR$ 1.000,00` rendered beside `Margem líquidaR$ 3.000 (100%)`.
The control test stayed Green under this mutation, which confirms it genuinely passed before the fix and is a control rather than a duplicate.

**Over-reach mutation applied**: rendering `financials.totalBrl + (recurringMode === 'monthly' && recurringIndefinite ? recurringMonthlyCents * 12 : 0)`, i.e. letting an indeterminada recorrência into the total.
The control test went Red (`TotalR$ 7.000,00` beside `Margem R$ 1.000`), while the bounded test stayed Green.
The control test therefore genuinely guards the indeterminada case against over-reach in both directions.

## 4. Was leaving step 2 alone correct?

Yes, read directly rather than taken on trust.
`validatePaymentPlan` (`apps/api/src/domains/sales-ops/service.ts:376`) computes `itemsTotalBrl` as `Σ quantity × unitBrl` and `planTotalBrl` as `Σ installments.amountBrl`, and raises `installments_sum_mismatch` whenever `planTotalBrl !== itemsTotalBrl`.
It is attached via `.superRefine` to both `CreateSaleSchema` and `UpdateSaleSchema`, so it gates every write endpoint.

Step 2 renders `{formatMoneyBrl(planSumCents)} / {formatMoneyBrl(totalCents)}` with `totalCents` the itens total, and `planDeltaCents = planSumCents - totalCents` drives the green/red styling.
Had step 2 been moved to `financials.totalBrl`, a valid plan would have rendered red, and an operator "correcting" the parcelas to match would have produced a payload the API rejects.
Leaving step 2 on the itens basis is correct, and the two screens differ for a stated, verified reason.

## 5. Teardown

Ordering verified against the live FK catalogue, not the comment:
`sales_ops_sales.seller_person_id` and `.finder_person_id` and `sales_ops_sale_professionals.person_id` reference `sales_ops_people` with `NO ACTION`, so people must be deleted after those tables.
`sales_ops_person_funcoes.funcao_id` references `sales_ops_funcoes` with `RESTRICT`, so funções must come last.
The added delete sits exactly between the two constraints.

Measurement reproduced from a hand-cleaned baseline of 0 rows:

| | people | person_funcoes | funcoes | areas | sales | products |
| --- | --- | --- | --- | --- | --- | --- |
| committed code | 0 | 0 | 0 | 0 | 0 | 0 |
| delete removed | 19 | 19 | 57 | 0 | 0 | 0 |

Reproduced twice, deterministically.
The fix is load-bearing: without it the suite leaks, with it the database is left completely clean.

One nuance worth recording, non-blocking.
The implementer reported "19 orphans"; the true leak is 95 rows.
The mechanism is that the explicit `DELETE FROM sales_ops_person_funcoes` is not what clears those rows in practice - the `sales_ops_people` delete's `CASCADE` onto `person_funcoes` is, and clearing them is what lets the subsequent `RESTRICT`-guarded `funcoes` delete take all four rows per org instead of one.
That is precisely what the added comment asserts ("BEFORE funções, which person_funcoes holds by `restrict`"), so the stated rationale is correct and the commit body merely understates the size of the leak it fixes.
An understatement in a commit message is not a code defect.

## 6. CLAUDE.md clause

The added sentence makes five checkable claims. All five are true:

1. The Revisão `Total` line reads `financials.totalBrl` - true, `SalesOpsApp.tsx:7006`.
2. That is the basis `total_brl` persists - true, `buildSaleLedger` spreads `financials` into the sale row and `totalBrl` maps to `total_brl`.
3. Rendering the itens total let the card show a margin larger than its own total once a bounded recorrência existed - true, reproduced by mutation: `Total R$ 1.000,00` beside `Margem R$ 3.000`.
4. Step 2's `Soma das parcelas / total` keeps the ITENS total - true, `SalesOpsApp.tsx:6593` uses `totalCents`.
5. `validatePaymentPlan` requires the parcelas to equal exactly that - true, read at `service.ts:376`.

## 7. Previously-passed properties spot-checked

- **Cross-tenant tenancy still load-bearing**: deleting the `eq(salesOpsFuncoes.orgId, orgId)` filter in `resolvePartyContexts` turns `rejects a cross-org funcaoId even when row security cannot hide the miss (admin context)` Red (1 failed / 100 passed). Restored and re-verified green.
- **Cross-tenant write is still a clean 400**: `routes.ts:265` and `:320` map any `SaleInputError` to `{error: 'validation_error', reason, itemIndex}` with status 400; `routes.ts` is untouched by the amendment and the integration suite still proves the service throws the right code.
- **No persisted number moved**: the amendment contains no server code at all; `buildSaleLedger`, `computeSaleFinancials`, the schema and the migrations are byte-identical to `1dc0032`. api 300 and integration 101 pass unchanged.
- **Payables untouched**: no payables code in the diff; the payables preview total was checked on screen and agrees with the margin deduction.
- **No test weakened**: both test files are pure additions, 0 deletions. The single deletion in the whole amendment is the one `Total` render line.

## 8. Hygiene

One commit, `feat(sales-ops): make produto defaults overridable per proposta and bind profissionais to the funções cadastro` - Conventional Commit.
No trailers at all, so no co-author and no AI attribution.
No em dash in any added line.
Strings are pt-BR (`Total`, `Recorrência`, `Margem líquida`, `indeterminado`, `Alterado manualmente`).

## Non-blocking observation

On the Revisão cost breakdown, `Comissão finder (2%)` renders a percentage label even when the proposta has no finder (`Finder: Sem finder`), showing `R$ 0,00`.
The margin correctly excludes it (`hasFinder: false`), the line is byte-identical to `master` and predates this batch entirely.
Cosmetic only, out of scope for this amendment.

## Cleanup

Every probe was reverted and byte-identity confirmed with `git hash-object`:

- `apps/web/src/sales-ops/SalesOpsApp.tsx` -> `e2e10c2de87c30c0a757c02534aabfb1f563c7f2`
- `apps/api/test/rls/sale-professional-funcoes.test.ts` -> `44bc794d79201139683a0b87c6e31b5c1ef13b40`
- `apps/api/src/domains/sales-ops/service.ts` -> `4b7cfb9d3c059fe2702f5244acbd18408251de01`

The temporary probe file `apps/web/src/sales-ops/__tests__/zz-probe.test.tsx` was deleted.
`git diff HEAD` is empty.
`git status --porcelain` shows only the four pre-existing untracked entries that were present before this verification started (`.vscode/`, the two `agents/*.result.json` files and `verify-12.md`).
Still on `feat/12-proposta-overrides` at `9aa8350`; nothing merged, pushed, committed or amended.
The test database is clean and working: every sales-ops table reads 0 rows and the full integration suite passes against it.
