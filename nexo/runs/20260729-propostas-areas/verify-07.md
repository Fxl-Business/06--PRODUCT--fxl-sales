# Verify: 07-propostas-list-web

Note: written in this VERIFY agent's isolated worktree at `nexo/runs/20260729-propostas-areas/verify-07.md` (same relative path as the main repo) because the harness's worktree-isolation guard refused a direct write to the main repo checkout. The main repo directory did exist and other slice reports (`verify-01.md` .. `verify-06.md`) already live there; this file should be copied/merged in by the orchestrator if it needs to live alongside them.

Verdict: PASS

## Setup

- Branch `feat/07-propostas-list-web` was already checked out in a sibling worktree (`agent-a7de5872de567b17b`), so this VERIFY agent's isolated worktree checked out the same SHA detached: `8116247970fa8af477b909c7b0b8947a42b503f6` ("feat(sales-ops): add propostas list view, transition actions, and won-status sweep").
- `pnpm install --prefer-offline` ran clean (413 packages resolved from cache, no downloads).
- Diffed against merge-base with master/main: `9f7f633e374c81f09f59c0ea1887a992370f1fa0`.

## 1. Change surface

`git diff --stat` shows only `apps/web/src/sales-ops/*` files touched (SalesOpsApp.tsx, api.ts, calculations.ts, hooks.ts, navigation.ts, types.ts, and 5 test files under `__tests__/`). 12 files, all under `apps/web`. No fixture reconciliation files outside sales-ops. Matches plan's `files_modified` list exactly (plus `sale-wizard-edit.test.tsx`, a minor fixture reconciliation for the new `wonAt`/`lostAt` fields, which is in-scope as a documented reconciliation).

## 2. Diff read (contract points)

a. **Nav rename, slug unchanged**: `navigation.ts` renames the operational nav item label `'Vendas'` -> `'Propostas'` while `id: 'vendas'` (the route slug) is untouched. Workspace catalogue description updated to `'Propostas e conferência'`. `meusDadosFinder` keeps `{ id: 'vendas', label: 'Indicações' }` (confirmed unchanged in the diff - no hunk touches it). CLAUDE.md's canonical route list (`operacional/vendas|comissoes`) is preserved.

b. **Real filter state**: `SalesFilters` type + `salesFilters` state added; `filteredSales` memo filters by status and area over `bootstrap.sales`/`bootstrap.saleItems`. The filters strip is split so `view === 'vendas'` gets live `NativeSelect` controls (status, área) plus a live count, and `view === 'comissoes'` keeps its own block (still reading `bootstrap.payables.length`, no `view === 'vendas'` ternary buried inside it anymore). Placeholder panel is gone for vendas.

c. **Row actions per status**: `DropdownMenuItem` set in `SalesView` matches the plan's gating table exactly:
   - draft/open: Editar, Marcar como ganha (no confirm), Marcar como perdida (confirm), Cancelar (confirm)
   - won: Reabrir (confirm), Cancelar contrato only when `recurringBrl > 0` (confirm)
   - lost/cancelled: Reabrir (no confirm, direct `onTransition(sale, 'open')`)
   Editar calls `onEdit={(sale) => setSaleWizard({ mode: 'edit', sale })}` - confirmed this reuses the slice-06-shipped `SaleWizardRequest`/`saleWizard`/`<SaleWizardDialog>` wiring (those lines appear as unchanged context in the diff, not additions; `SaleWizardDialog`/`SaleWizardDialogBody` bodies are untouched by this slice's diff). Destructive transitions (`lost`, `cancelled`, `reopen-won`, `cancel-contract`) all route through the single controlled `AlertDialog` with pt-BR copy matching the plan word-for-word (checked `confirmCopy` map).

d. **Transition/cancel-contract wiring**: `api.ts` adds `transitionSale`/`cancelContract` calling `POST /api/v1/sales-ops/sales/${saleId}/transition` and `.../cancel-contract`. Verified against the API: `apps/api/src/domains/sales-ops/routes.ts` registers `salesOpsRouter.post('/sales/:id/transition', ...)` and `.post('/sales/:id/cancel-contract', ...)`, and `apps/api/src/server.ts:75` mounts `app.route('/api/v1/sales-ops', salesOpsRouter)` - paths match exactly. `hooks.ts` adds `useTransitionSalesOpsSale`/`useCancelSalesOpsContract`, both using the existing `requireToken` + `useInvalidateSalesOps` pattern identical to the other mutations in the same file (`onSuccess: () => void invalidate()`).

e. **SaleDetailDialog**: new component renders Itens (from `bootstrap.saleItems`, includes Área column via `areaNameSnapshot`), "Plano de pagamento" (from `bootstrap.receivables` sorted by `dueDate`, three-state chip Aberta/Paga/Anulada, recurring footer line when `recurringBrl > 0`, `EmptyPanel` when no rows), "Contas a pagar" (rendered only when `bootstrap.payables.some(p => p.saleId === sale.id)`, i.e. present once won), and "Margem" summary block ending in bold "Margem líquida". `detailSale` derivation falls back from filtered `sales` to `bootstrap.sales` so it survives filter changes/invalidation, matching the plan exactly.

f. **statusMeta**: exactly `draft/open/won/lost/cancelled` with labels Rascunho/Aberta/Ganha/Perdida/Cancelada and a fallback branch (`map[status] ?? {...}`) for safety against unmigrated data. All legacy statuses (`forecast|closed|in_progress|completed`) removed from both the map and the `SalesOpsStatus` union in `types.ts`.

g. **Won-based dashboard/person aggregates**: `calculations.ts` replaces `closedStatuses`/`closedSales` with `wonStatuses = new Set(['won'])`/`wonSales`; `DashboardModel.kpis` renamed to `wonRevenueBrl`/`wonSalesCount`. `SalesOpsApp.tsx` `personMetrics` switches its filter from `status !== 'cancelled'` to `status === 'won'`. KPI labels updated: "Receita ganha no mês", "Propostas ganhas" / "Propostas com status ganha", "Últimas propostas" panel heading, ranking empty text "a partir das propostas ganhas", `PeopleView` sub line "propostas ganhas no período".

h. **meus-dados read-only reuse**: single `SalesView` call site passes `canManage={workspace === 'operacional'}`; the Ações column and its `TableHead`/`TableCell` are conditionally rendered only when `canManage`. Verified with the new `sales-view.test.tsx` test "hides all row actions when canManage is false" (no `aria-label^="Ações da proposta"` button, no "Marcar como ganha" text) - the detail dialog remains available regardless (row `onClick` is unconditional).

i. **Payable status value parity**: web `SalesOpsPayable['status']` changed from `'open' | 'paid' | 'voided'` to `'open' | 'paid' | 'void'`. Verified against the API: `apps/api/src/db/schema.ts:641,661` documents payable `status` as `'open' | 'paid' | 'void'`, and `apps/api/src/domains/sales-ops/service.ts` sets/reads the literal string `'void'` in the contract-cancellation and reopen-won paths (e.g. lines 498, 504, 1165, 1236, 1241). Web and API now agree exactly. `CommissionsView`'s payable badge in `SalesOpsApp.tsx` gained the third `void` -> "Anulado" state.

Global sweep: `grep -rn "'closed'|'completed'|'forecast'|'in_progress'"` across `apps/web/src` returns only one unrelated hit (`LinkGeneratorForm key={dialogOpen ? 'open' : 'closed'}` in the finder links page, a dialog remount key, not a sale status). `grep -rn "'voided'"` returns only `apps/web/src/lib/api-client.ts` (`PayoutStatus`), an unrelated referral-admin enum, consistent with the plan's allowance for hits outside sales-ops.

## 3. Verification commands (run-once, full workspace)

- `pnpm run lint` - clean (`apps/api lint: Done`, `apps/web lint: Done`).
- `pnpm run type-check` - clean (`apps/api type-check: Done`, `apps/web type-check: Done`, plus shared-types/shared-utils).
- `CI=true pnpm test` - exit code 0. `shared-utils`: 17/17 passed. `apps/api`: 23 files, 212/212 tests passed (includes `sale-transitions.test.ts`, `transition-routes.test.ts`). `apps/web`: 20 files, 119/119 tests passed, including all five named oracle files:
  - `sales-transition-actions.test.tsx`: 7/7 passed (all named scenarios: ganha no-confirm, perdida confirm, cancelar confirm+voids copy, reabrir won-confirm vs lost/cancelled no-confirm, cancelar-contrato gated by recurringBrl, editar draft/open only, Voltar aborts without mutating).
  - `sales-view.test.tsx`: 4/4 passed (columns + one chip per status, joined área names, read-only detail dialog opens with Plano de pagamento/Contas a pagar/Margem líquida, actions hidden when canManage false).
  - `calculations.test.ts`: 13/13 passed (new "aggregates dashboard KPIs from won propostas only" test verifies wonRevenueBrl/wonSalesCount/topSellers/activeMrrBrl/latestSales exclude cancelled).
  - `navigation.test.ts`: 10/10 passed (Propostas label assertion added).
  - `routing.test.tsx`: 14/14 passed (heading updated to "Propostas", personal card text "0 propostas ganhas no período", mocks extended with the two new hooks).
  - The tracked-file no-legacy-auth guard ran as part of `pnpm test` and the whole command exited 0.

## 4. Security/UX lens

- No raw account/workspace/database ids are rendered anywhere in the new code; `sale.id` is only used as a React key, a filter/lookup key, or a mutation argument - the visible identifier is always `sale.code` (a business code, e.g. `P-001`), matching the pre-existing pattern.
- Confirmation copy is clear pt-BR and matches the plan's `confirmCopy` map verbatim (e.g. "A proposta {code} será marcada como perdida.", "As parcelas futuras em aberto da proposta {code} e as comissões vinculadas serão anuladas. Parcelas pagas não são afetadas.").
- `git diff | grep -P '^\+' | grep '—'` returned no matches - no em dash characters introduced anywhere in the diff.

## Conclusion

All plan contract points (a) through (i) are proven directly against the diff and cross-checked against the API's actual route/schema code, not just the plan's assumptions. Lint, type-check, and the full run-once test suite (348 tests across 3 workspaces) are green. No scope leakage outside `apps/web`.
