# Exec 08-settlements-ui

Branch `feat/20260925-08-settlements-ui` (worktree `.worktrees/20260925T191541Z-finance-prereqs-07-10/08-settlements-ui`), base master `e8ea0b9`.

## Commits

- `4b058c3` feat(sales-ops): settlement transport, types and hooks
- `12ddd2e` feat(sales-ops): baixa, estorno and history dialogs
- `4cdb791` feat(sales-ops): settle rows from the sale detail and comissoes
- `9af65dd` docs(sales-ops): record the settlement UI rules

## Files

All inside `files_modified`: `lib/query-keys.ts`, `sales-ops/{api,hooks,types}.ts`, `SalesOpsApp.tsx`, `MutationErrorBanner.tsx`, `settlements/{settlement-format,settlement-errors,settlement-ui}.ts`, `settlements/{MarkPaidDialog,ReverseSettlementDialog,SettlementHistory,SettlementRowActions}.tsx`, the eight named test files, `CLAUDE.md`, `nexo/knowledge/reference/propostas.md`.
`api-client.ts` untouched.

## Preconditions

- `sao-paulo-day` export present in `packages/shared-utils/package.json`; dist built.
- Slice 06 C6 shapes confirmed in `apps/api/src/domains/sales-ops/settlements.ts` (`SettlementEntry` matches the web type exactly, reason max 500).
- `ApiError.rows` / `ApiErrorRow` (slice 05) and `MutationErrorBanner` / `MUTATION_ERROR_COPY` (slice 07) present.

## Red -> Green

Red run: every new file failed on missing modules; `mutation-error-banner` lines test, and all visibility tests failed on missing behaviour (`CommissionsView` not exported, no `Pago em`).
Green: all oracles pass.

## Oracle results

- `vitest run src/sales-ops/settlements/__tests__ .../sales-settlement-visibility.test.tsx .../mutation-error-banner.test.tsx .../financial-mutation-forbidden.test.tsx`: 10 files, 59 tests passed (every named test listed).
- `vitest run sales-transition-actions sales-view routing`: 3 files, 27 tests passed.
- `CI=true pnpm test`: shared-utils 155, auth-fake 35, api 678, web 1047, node scripts 55 pass / 0 fail.
- `pnpm run lint`, `pnpm run type-check`, `pnpm run build`, `node scripts/assert-web-bundle-clean.mjs`: all exit 0.

Hand mutations (restored after each), all turned the oracle red:
default date via UTC slice; amount added to the record payload; `actorName ?? actorUserId`; dropping `saleStatus === 'won'` from `canMarkPaid`; dropping the label tie-break in the receivable sort.

## Real-browser check (dev-fake, ports were free, local DB already migrated and seeded; no migrate run)

Driven as `team-owner` at 1374px:
- Sale detail `0001-1`: `Marcar como pago` on open rows, `Pago em` plus `Estornar` on paid rows, `Ações` column.
- `Marcar como pago`: date defaults to 25/09/2026 (today SP), typing 26/09 shows the future refusal and disables confirm; Enter in the date field submits nothing; Escape closes only the inner dialog, sale detail stays open.
- Confirm: row flips to `Paga` / `Pago em 25/09/2026` without reload.
- `Histórico de pagamentos` > `Mostrar`: baixa entries with civil dates, recorded time in SP, seed entries authored `Seed de desenvolvimento`, no ids.
- `Estornar` with `Teste de estorno`: row back to `Aberta`, history shows the estorno with the reason and the baixa marked `Estornada`.
- Row menu `Reabrir` on `0001-1`: red banner with the 409 copy and lines `Parcela 1/3`, `Comissão do finder · Caio Indica`, `Comissão do vendedor · Ana Diretora`, `Imposto`.
- `/operacional/comissoes`: `Marcar como pago` / `Estornar` / `Histórico` per row, no page overflow.
- `/meus-dados/vendas` (team-owner) and `/meus-dados/comissoes` (seller): `Pago em` shown, zero settlement actions, no `Ações` column, no history.
Dev stack stopped by killing exactly its three process groups (make, and the api and web groups it creates with `set -m`); ports 3006/8006 free afterwards.

## UI defects found in the browser and fixed in this slice

- The `Ações` column pushed the payables table min-content to 746px inside the 712px content box of the 760px detail dialog: amounts wrapped (`R$` / `180`) and the whole dialog scrolled sideways.
  Fix: amounts and dates nowrap, the detail widens to 820px only when `canSettle`, and the body gets `min-w-0` so on a phone each table scrolls inside its own wrapper (simulated 342px: dialog 342 wide, tables scroll internally; this also fixes a pre-existing sideways scroll of the read-only detail on phones).
  Oracle: `widens the detail only when the Ações column is present`.
- Same-day receivables swapped places after each refetch (sort by due day only).
  Fix: tie-break by label, then id. Oracle: `keeps same-day parcelas in label order whatever the bootstrap order`.
- Row action buttons showed the browser's default blue focus ring on dialog open; now `focus-visible:border-[#eaa81a]` like the house inputs.

## Decisions and deviations

- D1-D8 as planned.
- `MutationErrorBanner`: the message `span` is wrapped in a `div` so the lines list sits under it inside the flex row; the message itself is unchanged.
- `describeLockedRows` falls back to `describeReceivable` for a receivable label, so a recurring fallback reads `Recorrência 2/12` rather than `Parcela M2/12`.
- `SettlementRowActions` stops propagation on its wrapper (covers the portalled dialogs through the React tree) rather than on each button.
- The settling detail dialog is 820px, not 760px (see defects above); the plan's Verify step 6 names 760px.

## Findings for the orchestrator (not changed here)

- Baixas recorded by a dev-fake identity show `Autor não identificado`: `getHubActorDisplayName` finds no name or email in the fake claims. API / auth-fake scope; production Hub tokens carry a name.
- As `seller` ("Diego"), `/meus-dados/vendas` redirected to `/meus-dados/vendedores` in dev-fake, so the seller read-only sale detail was checked as `team-owner` in `meus-dados` instead (same component path, `canSettle` false). Routing is outside this slice.
- The pre-existing `Total pago no mês` metric still sums every paid payable regardless of month (out of scope per plan).

## Attempt 2 (after verify-08-a1: F1 plus N1, N2, N4)

Commits on the same branch:
- `d59e750` refactor(sales-ops): put the history path comment back on its constant (N1)
- `8d16af8` fix(sales-ops): keep settled ledger rows in place and name them apart (F1, N2, phone wrapping)
- `8a11ac0` docs(sales-ops): record the ledger display order and payable descriptions

F1, settled payable jumped to the end of its list:
- New pure `apps/web/src/sales-ops/ledger-order.ts` with `compareReceivables` (civil due day, label, id) and `comparePayables` (civil due day, kind rank, kind, beneficiary, id), reading only fields a settlement never writes.
- `SaleDetailDialog` sorts both of its tables through it, and `CommissionsView` sorts through the same `comparePayables`, so the two views always agree.
- New file outside `files_modified`: it is the shared home the coordinator asked for, and it sits outside `settlements/` because it orders every ledger table, not only the settling ones.
- Oracle `renders payables in one write-independent order in the sale detail and in comissoes` (in `sales-settlement-visibility.test.tsx`) feeds the payables shuffled, and in the order after a simulated baixa (settled row last, now paid), and asserts both views render the same expected order.
  Red without the detail sort (1 failure) and without the comissoes sort (2 failures).
- Real app: in `/operacional/comissoes` the first open row (row 4, `Rita Projeto | Prestador | R$ 900 | 01/09/2026`) stayed at row 4 with the full order unchanged after `Marcar como pago`, and again after `Estornar` (which restored the data).

N2, identical blocking-row lines:
- `SalesOpsPayable` declares `receivableId` (already present in the bootstrap JSON, `select()` of the table).
- `describePayable(row, receivableById)` appends the linked parcela (`· Parcela 1/3`, `· Recorrência 2/12`), or `· vencimento DD/MM/AAAA` for a one-shot cost; never an id.
  `buildTargetDescriptions` and `payableSettlementTarget` use it, so banner lines, history and dialog titles read the same.
- `sale-action-error.test.tsx` now has two paid commissions to the same person and asserts distinct lines; red when the suffix is dropped.
  `settlement-format.test.ts` covers the parcela, recurring and due-day forms.

N4, phone width, checked in the real app with the page loaded in a 390px iframe (the Chrome window cannot resize):
- The sale detail dialog is 340px wide with no page horizontal scroll; each table scrolls inside its own box.
  `Plano de pagamento` amounts wrapped (`R$` / `6.000`); money and date cells in all three detail tables are now `whitespace-nowrap`.
  The history section wraps cleanly.
- `/operacional/comissoes` at 390px has no page horizontal scroll, but the whole sales-ops shell is not responsive: the 245px sidebar never collapses, so page content gets about 130px on every screen.
  This predates the slice and is app-shell scope; reported, not changed.

N3 (dev-fake settlements authored `Autor não identificado`) remains an API / dev-identity finding outside this slice.

Gates, run once each in the worktree:
- Named oracles: 10 files, 60 tests; and 3 files, 27 tests; all pass.
- `CI=true pnpm test`: shared-utils 155, auth-fake 35, api 678, web 1048, node scripts 55 pass / 0 fail.
- `pnpm run lint`, `pnpm run type-check`, `pnpm run build`, `node scripts/assert-web-bundle-clean.mjs`: all exit 0.
- Dev stack started for the browser check was stopped by killing exactly its three process groups; ports 3006/8006 free.
