# Verify 08-settlements-ui, attempt 2

Verdict: PASS.
Branch `feat/20260925-08-settlements-ui` at `8a11ac0` (base `e8ea0b9`), worktree clean before and after.

## Gates (run once in the worktree)

- `pnpm --filter @fxl-sales/shared-utils build`: ok.
- Named oracles (both plan commands, verbose reporter): 13 files, 87 tests, all green; every named title in the plan's oracle table is present, plus the new order oracles `renders payables in one write-independent order in the sale detail and in comissoes` and `keeps same-day parcelas in label order whatever the bootstrap order`.
- `pnpm run lint`: exit 0, no warnings.
- `pnpm run type-check`: exit 0.
- `CI=true pnpm test`: exit 0 (api 678, web 1048, shared-utils 155, auth-fake 35, scripts 55 pass, 0 fail).
- `pnpm run build`: exit 0.
- `node scripts/assert-web-bundle-clean.mjs`: clean.

## Previous failures

- F1 (settled payable jumped to the end): fixed.
  `apps/web/src/sales-ops/ledger-order.ts` holds `compareReceivables` and `comparePayables`.
  They read only civil due day, label or kind rank, kind, beneficiary, and end on the id, so the order is total and write-independent (no revision, updatedAt or status).
  The same `comparePayables` serves `SaleDetailDialog` Contas a pagar and `CommissionsView`; receivables use `compareReceivables`.
- The api.ts doc comment is back on `SALES_OPS_HISTORY_PATH` (d59e750).
- Identical banner lines: `describePayable` now appends the linked parcela or due day; the browser banner read `Parcela 1/3`, `Comissão do finder · Caio Indica · Parcela 1/3`, `Comissão do vendedor · Ana Diretora · Parcela 1/3`, `Imposto · Parcela 1/3`.

## Mutation probes (each restored with git checkout, tree clean)

| Probe | Result |
| --- | --- |
| Drop the sort in `CommissionsView` | RED: order oracle and `CommissionsView with canSettle ...` |
| Drop the payables sort in `SaleDetailDialog` | RED: order oracle |
| Drop the future-date guard in `MarkPaidDialog` | RED: `refuses a future payment date before calling the API` |
| UTC today instead of `todayInSaoPaulo()` | RED: 5 tests incl. the default-date oracle and the civil-day source guard |
| Add `amountBrl` to the record payload | RED: `confirms ... never an amount`, `submit posts the São Paulo day` |
| Render `actorUserId` as the author fallback | RED: `never renders the raw actor account id` |
| `SalesView` default `canSettle = true` | RED: `read-only SalesView shows Pago em but no settlement action` |
| `CommissionsView` default `canSettle = true` | RED: `CommissionsView without canSettle renders no settlement action` |
| `SalesOpsApp` `canSettle` without the admin check | survives the suite |
| `SalesOpsApp` `canSettle` without the operacional check | survives the suite |

The last two are the SalesOpsApp wiring, which the plan's oracle table explicitly assigns to the browser step; the browser confirmed both gates (below).
Non-blocking recommendation: add a SalesOpsApp-level oracle for `meus-dados` with an admin identity.

## Browser (make dev-fake from the worktree, API on local Postgres localhost:5006, identity team-owner)

- `operacional/comissoes`: `Marcar como pago` on row 4 (Rita Projeto). Date defaulted to 25/09/2026 (São Paulo today) with max 2026-09-25, input 44px high. Typing 26 showed `A data de pagamento não pode ser no futuro.` and disabled the confirm button. Enter in the date field did not submit or close. Paid on 24/09/2026: only that row changed (`Pago em 24/09/2026`), all 49 rows kept their positions. `Histórico` showed Baixa / Estorno entries with São Paulo recorded time and no ids. `Estornar` with `Teste de estorno`: the row went back to `Aberto` and the full list matched the snapshot taken before the baixa.
- Sale detail `0001-1`: marked the Ana Diretora commission (Parcela 2/3, row 7 of Contas a pagar) paid; only that row changed, receivables unchanged; Escape inside `Marcar como pago` closed only that dialog; `Histórico de pagamentos` > `Mostrar` lists entries with row descriptions and `Motivo: Teste de estorno`; estorno restored the exact prior table.
- `Reabrir` on the won `0001-1` (seeded paid parcela 1): the red banner listed four distinct rows, never an id. The confirm copy says to reverse a payment first.
- `meus-dados/comissoes` and `meus-dados/vendas` as the admin: no action, no `Ações` column, no history, `Pago em` shown, detail stays 760px. As `seller` (Diego): no action in `meus-dados/comissoes`; `/operacional/comissoes` redirects away.
- 390px (same-origin iframe, since the window would not resize): no page horizontal scroll on comissoes or the sale detail; the dialog fits (9.75 to 380px); detail tables scroll inside their own `overflow-x: auto` wrappers.
- Every baixa I recorded was reversed; rows ended open. The dev stack was stopped by killing process groups 67950, 68118, 68119 (the ones I started); ports 3006 and 8006 are free.

## Observations (non-blocking, outside this slice)

- History author reads `Autor não identificado` for baixas made under development identity mode, because this branch predates master's `1816f69` (slice 13, `applyHubAuthContext` sets hubAuth). Recheck after the merge.
- `Seed de desenvolvimento` author was not reached in the visible part of the history list; not re-checked.
- The seller-only identity sees all 49 org payables in `meus-dados/comissoes`; this is pre-existing list scoping, not introduced here, but worth a product check.
- No em dash in the diff; pt-BR copy throughout.
