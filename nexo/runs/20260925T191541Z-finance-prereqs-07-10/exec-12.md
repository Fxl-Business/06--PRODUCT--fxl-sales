# Exec 12 - month totals follow the São Paulo month

Branch `feat/20260925-12-month-totals`, base `416c1a2`, head `21f355f`.

## Commits

- `e1691d1` test(sales-ops): pin settlement visibility in the SalesOpsApp shell
- `21f355f` fix(sales-ops): count the no mês totals by the São Paulo month

## What changed

- `apps/web/src/sales-ops/calculations.ts`: new pure `isInSaoPauloMonth(day, today)` and `sumPaidInSaoPauloMonth(payables, today)`; `buildDashboardModel(bootstrap, today)` now sums `wonRevenueBrl` only over won propostas whose `saoPauloDayOf(new Date(wonAt))` is in today's month, and exposes `wonThisMonthCount`.
  Imports only the `@fxl-sales/shared-utils/sao-paulo-day` subpath and never reads the clock.
- `apps/web/src/sales-ops/types.ts`: `DashboardModel.kpis.wonThisMonthCount` added.
- `apps/web/src/sales-ops/SalesOpsApp.tsx`: `today = todayInSaoPaulo()` per render feeds `buildDashboardModel`; `CommissionsView` computes `totalPaid` with `sumPaidInSaoPauloMonth(bootstrap.payables, todayInSaoPaulo())`; the "Receita ganha no mês" subtitle now uses `wonThisMonthCount` so the card's count matches its sum.
  Card layout unchanged.
- `apps/web/src/sales-ops/navigation.ts`: `canSettle` extracted verbatim into `canSettleInWorkspace(workspace, roles)` (no behaviour change) so the admin term has a killable oracle.
- `CLAUDE.md` (Civil days bullet, Settlement UI bullet) and `nexo/knowledge/reference/propostas.md` (month rule paragraph, canSettle predicate lines).

## Oracles

- `apps/web/src/sales-ops/__tests__/calculations.test.ts`, describe `São Paulo month totals` (today `2026-09-25`): paidOn 09-01/09-30 count, 08-31, 2025-09-25, null, undefined do not; due September paid August counts zero (and due August paid September counts); open/void ignored; wonAt `2026-09-01T02:00:00Z` excluded, `2026-09-01T03:00:00Z` and `2026-10-01T02:30:00Z` included, null excluded, last year excluded; `wonSalesCount` and rankings keep all-time meaning.
  Existing dashboard tests updated to pass `today`.
- `apps/web/src/sales-ops/__tests__/month-totals.test.tsx` (new): real `SalesOpsApp` shell, `vi.useFakeTimers({ toFake: ['Date'] })` + `vi.setSystemTime`; comissoes card in operacional and meus-dados, dashboard card and subtitle, the UTC-boundary instant `2026-10-01T01:00:00Z` (still September in São Paulo) for both cards, and a new month starting at zero.
- canSettle oracle: `apps/web/src/sales-ops/__tests__/sales-settlement-visibility.test.tsx` already existed from slice 08, so it was EXTENDED (no `settlement-visibility.test.tsx` created) with describe `settlement visibility in the SalesOpsApp shell`: admin in `operacional/comissoes` sees `Marcar como pago`; the same admin in `meus-dados/comissoes` and a seller-only profile see no settlement action; plus a predicate test for `canSettleInWorkspace`.

## Red, then green

- Month oracles were red on master for the right reason: `R$ 11.500` instead of `R$ 2.500` (all paid ever), `R$ 80.000` instead of `R$ 10.000` (all won ever), and `sumPaidInSaoPauloMonth is not a function`.
- Shell canSettle tests are characterization tests (behaviour pre-exists), green on arrival, then seen red by mutation.

## Mutations (all restored)

- Drop the payable month filter: 6 red.
- Read `dueDate` instead of `paidOn`: 5 red.
- Drop the won month filter: 3 red.
- Use the UTC slice of `wonAt` instead of `saoPauloDayOf`: 2 red.
- Dashboard caller passes `new Date().toISOString().slice(0, 10)`: initially SURVIVED; added the dashboard UTC-boundary render test, now 1 red.
- Comissoes caller passes the UTC day: 1 red.
- canSettle: remove the operacional term (inline in SalesOpsApp before extraction, and in the predicate after): shell test `the same admin in meus-dados/comissoes...` red plus predicate test red.
- canSettle: remove the admin term: only the predicate test turns red.

## Finding: the admin term is unreachable through the shell

Through the real `SalesOpsApp` shell a non-admin can never stand in `operacional`: `getVisibleWorkspaces` gives `operacional` only to `admin`, and route resolution returns `<Navigate>` before any view renders.
So removing the admin term from an INLINE `canSettle` is an equivalent mutant for any shell-rendered oracle.
Resolution: the predicate was extracted to `canSettleInWorkspace` in `navigation.ts` (behaviour unchanged) and the admin term is pinned there; the shell tests pin the wiring and the operacional term.
Residual: someone inlining `workspace === 'operacional'` back into `SalesOpsApp.tsx` instead of calling the predicate would survive the suite; CLAUDE.md now names the predicate as the one place.

## Other "no mês" figures reviewed

- Dashboard `Receita ganha no mês`: fixed (value and its subtitle count).
- Comissoes `Total pago no mês`: fixed.
- Sidebar `A pagar este mês` (`SalesOpsApp.tsx`, `payableBrl`, every open payable): label says "este mês", not "no mês", so NOT changed per the plan; what it should count (open payables due this month?) is an open product question, recorded in `propostas.md`.
- Tatico dashboard page subtitle `Receita, recorrência, comissões e ranking do mês`: a page description, not a figure; `MRR ativo`, `Comissões a pagar`, `Propostas ganhas`, rankings and `Receita por produto` keep all-time meaning (no "no mês" in their labels). The subtitle is now slightly inaccurate for the rankings; flagged, not changed.

## Verification (run-once)

- Named oracles: `calculations.test.ts`, `month-totals.test.tsx`, `sales-settlement-visibility.test.tsx`: 53 passed.
- `CI=true pnpm test`: exit 0; shared-utils 155, auth-fake 35, api 680, web 1083 (96 files), node script tests `fail 0`.
- `pnpm run lint`: clean. `pnpm run type-check`: clean. `pnpm run build`: exit 0, bundle-clean assertion passed.
- Browser check with `make dev-fake` not performed; the render oracle drives the real shell with a fixed clock. No process was started that remains running.

## Attempt 2 (after verify-12-a1)

Commit `c5e31e1` docs(sales-ops): one sentence per line in the month rule; unnest mock buttons.

- The CLAUDE.md "Civil days" month bullet now has its second sentence ("The helpers take ...") on an indented continuation line.
  I rechecked every other added line in CLAUDE.md and `propostas.md`: each holds one sentence.
- The `DropdownMenuItem` mock in `sales-settlement-visibility.test.tsx` honours `asChild` (it renders the child alone), so the shell's Organization rows no longer nest a `<button>` in a `<button>`.
  `validateDOMNesting` no longer appears in the named-oracle run.
- The full-suite log still showed the same warning from the pre-existing `financial-mutation-forbidden.test.tsx` (slice 07), whose mock had the same shape; fixed the same way in `e202c88` test(sales-ops): unnest mock buttons in the forbidden-mutation shell test.
  After it the full-suite log has zero `validateDOMNesting` lines.
- Correction to attempt 1: the named-oracle count is 53, not 58.
- Final head `e202c88`.
  Rerun (run-once): named oracles 53 passed, `financial-mutation-forbidden.test.tsx` 3 passed; `pnpm run lint` clean; `pnpm run type-check` clean; `CI=true pnpm test` exit 0 (shared-utils 155, auth-fake 35, api 680, web 1083, node scripts `fail 0`).
  The build was not rerun because only a test file and CLAUDE.md changed.
