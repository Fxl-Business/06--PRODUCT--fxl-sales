# Verify 08-settlements-ui (attempt a1)

Verdict: FAIL.
Commit under test: 9af65ddddcea05c8b17918b96262682e533016e2 (branch feat/20260925-08-settlements-ui, base e8ea0b9).
Verifier did not write this code; no tracked file was modified; worktree clean at the end.

## Blocking finding

F1. A baixa or estorno makes the settled payable jump to the END of its list (UI regression in the slice's own primary flow).
- Reproduced in the real app (dev-fake, team-owner, Agencia Norte): in `/operacional/comissoes` the row `Ana Diretora | Vendedor | R$ 350 | 01/10/2026` was row 4 of 49; after `Marcar como pago` (and later `Estornar`) it is row 49, off screen. The same row also moved to the last line of `Contas a pagar` in the `0001-1` sale detail.
- Cause: the bootstrap reads `sales_ops_payables` with no ORDER BY (`apps/api/src/domains/sales-ops/service.ts:2943`), so the settlement UPDATE (revision bump) moves the heap tuple; `SaleDetailDialog` payables (`bootstrap.payables.filter(...)`) and `CommissionsView` (`bootstrap.payables.map(...)`) render that order verbatim.
- The slice already recognised this exact hazard for receivables (new tie-break sort in `SaleDetailDialog`, comment "so a refetch (a baixa, an estorno) never swaps two same-day rows under the operator's cursor", plus the oracle `keeps same-day parcelas in label order whatever the bootstrap order`) but left both payables tables unsorted, where the jump is far worse.
- Fix (web only, in scope): give both payables tables a deterministic order that does not depend on row writes (e.g. due day, then kind/beneficiary, then id), and add an oracle that shuffles bootstrap payables and asserts the rendered order is unchanged in both `SaleDetailDialog` and `CommissionsView`.

## Non-blocking findings

- N1. `apps/web/src/sales-ops/api.ts`: the new types were inserted between the existing JSDoc of `SALES_OPS_HISTORY_PATH` and its declaration, so that doc block now sits over `RecordSettlementPayload` (two stacked JSDoc blocks). Move the new types above the history comment.
- N2. Locked-row lines for payables use the bootstrap description without the installment, so several paid commissions of the same beneficiary render identical lines (e.g. two `Comissão do vendedor · Ana Diretora`). Plan-sanctioned (bootstrap first), but the C5 label `Ana Diretora (1/3)` is more informative; consider appending the due day or N/M.
- N3 (outside this slice, API/dev identity): in dev-fake mode every settlement is authored `Autor não identificado`, although fake tokens carry `name`/`email`. `cadastroActor` reads `c.get('hubAuth')`, which the fake adapter apparently does not populate. The plan's browser step expected `Ana ...`. The UI fallback is correct; report to slice 06 / dev-identity owner.
- N4. The in-app 390px check could not be performed: the Chrome window did not resize (innerWidth stayed 1374). At 1374px the settling detail is 820px wide, each table 770px inside an `overflow-x:auto` wrapper, no page horizontal scroll.

## Commands (run once, in the worktree)

| Command | Exit |
| --- | --- |
| `pnpm --filter @fxl-sales/shared-utils build` | 0 |
| oracle files (both plan commands, verbose reporter): 13 files, 86 tests, every plan-named title present | 0 |
| `pnpm run lint` | 0 |
| `pnpm run type-check` | 0 |
| `CI=true pnpm test` (auth-fake 1, shared-utils 5, api 63, web 93 files; node guards 55/55) | 0 |
| `pnpm run build` | 0 |
| `node scripts/assert-web-bundle-clean.mjs` | 0 |

Diff scope: 24 files, no `nexo/runs`, `nexo/plans` or `.env` files; `apps/web/src/lib/api-client.ts` untouched.

## Acceptance criteria

1. Actions in sale detail (Plano de pagamento, Contas a pagar) and operacional/comissoes for admin; Marcar on open non-void rows of won; Estornar on paid rows with paidOn - implemented; `settlement-row-actions.test.tsx`, `sales-settlement-visibility.test.tsx`; seen live.
2. Dialog default and max = todayInSaoPaulo, future refused pre-request, amount read-only - `mark-paid-dialog.test.tsx` (clock pinned 2026-09-24T01:30Z expects 2026-09-23); live: default and max 2026-09-25, 26/09 shows `A data de pagamento não pode ser no futuro.` and disables confirm; input height 44px.
3. Body exactly {targetKind,targetId,paidOn} - `settlements-api.test.ts`, `mark-paid-dialog.test.tsx`.
4. 422 and C5 409 in pt-BR inside dialog, stays open - `mark-paid-dialog.test.tsx` (422, 409), `reverse-settlement-dialog.test.tsx` (already_reversed).
5. `Pago em DD/MM/AAAA` by string for every viewer - PaidOnNote via `displayDate`; tests + live (seller and admin in meus-dados see it).
6. Estornar posts trimmed/omitted reason for latest active baixa from GET history - tests; live: with a reversed 25/09 baixa and an active 24/09 baixa the dialog targeted 24/09, reason recorded.
7. History: type, civil date, amount, actor_name fallback, SP recorded time, reason, no ids - `settlement-history.test.tsx`; live: `Registrado em 25/09/2026 às 16:54` at 19:54Z, no UUID in DOM.
8. useAppMutation + mutateAsync, invalidates salesOps.all - hooks.ts; live rows refresh without reload.
9. meus-dados read-only for everyone - tests for SalesView/CommissionsView props; the SalesOpsApp workspace gate has no unit oracle (probe P12 stayed green, plan accepts browser coverage); live: team-owner (admin) in meus-dados/comissoes and meus-dados/vendas detail and seller in meus-dados/comissoes show no action, no Ações column, no history.
10. 409 sale_has_active_settlements names blocking rows in MutationErrorBanner, no ids - `sale-action-error.test.tsx`, `mutation-error-banner.test.tsx`; live: Reabrir on 0001-1 shows the headline plus `Parcela 1/3`, `Comissão do finder · Caio Indica`, `Comissão do vendedor · Ana Diretora`, `Imposto`.
11. Reuses ApiError.rows, api-client.ts unmodified - confirmed.
12. SalesOpsSettlement equals API SettlementEntry, no actorUserId - compared with `apps/api/src/domains/sales-ops/settlements.ts:77`.
13. CLAUDE.md and propostas.md updated - present, no em dash.

## Mutation probes (each restored with git checkout; tree clean)

| Probe | Result |
| --- | --- |
| P1 MarkPaidDialog today = `new Date().toISOString().slice(0,10)` | RED (3 tests) |
| P2 drop isAfterTodayInSaoPaulo refusal | RED |
| P3 add amountBrl to payload | RED |
| P4 api body not built field by field | RED |
| P5 SalesView `canSettle` default true (non-admin/meus-dados sees actions) | RED (2) |
| P6 CommissionsView renders actions regardless of canSettle | RED |
| P7 MutationErrorBanner drops the lines list | RED (2) |
| P8 describeLockedRows returns row.id | RED (2) |
| P9 history renders actorUserId | RED |
| P10 reverse always sends untrimmed reason | RED (2) |
| P11 PaidOnNote via `new Date(paidOn).toLocaleDateString(... Sao_Paulo)` | RED (4) |
| P12 SalesOpsApp `canSettle` without workspace check | GREEN (no unit oracle; covered live) |

## UI observations (Chrome, dev-fake, local DB localhost:5006)

- Sale detail widens to 820px only with Ações; badges, `Pago em` notes and 32px row buttons align; dialogs match MoveLeadDialog styling; pt-BR copy throughout.
- Enter in the date field submits nothing; Escape in `Marcar como pago` closes only that dialog, the sale detail stays open.
- Histórico section and per-row Histórico dialog render cleanly; `Estornada` marker on reversed baixa.
- F1 (row jump) observed as described above.
- Local dev data now holds extra immutable baixa/estorno facts on 0001-1 (parcela 2/3 and Ana Diretora 01/10 commission, both reversed back to open).

Processes: started `make dev-fake` in its own session (PGID 76642; api PGID 76786, web PGID 76787); all three groups killed, ports 3006/8006 free afterwards.
