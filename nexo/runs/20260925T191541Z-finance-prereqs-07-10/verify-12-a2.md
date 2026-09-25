# Verify 12-month-totals (attempt 2)

Verdict: PASS.
Commit under test: e202c8845428ed66db2311660e471999d337ba4b (branch feat/20260925-12-month-totals, base 416c1a2), confirmed with `git log -1` before the test runs.
Working tree clean before and after.

## Previous findings

- CLAUDE.md: the new "Civil days" rule is now two lines, one sentence each; the modified "Settlement UI" line is one sentence.
- propostas.md: every added line checked, one sentence per line (mechanical check for a sentence break inside an added line found none).
- No em dash in any added line of the diff.
- validateDOMNesting: 0 occurrences in the named oracle output and 0 in the full `CI=true pnpm test` log.
  Both `sales-settlement-visibility.test.tsx` and `financial-mutation-forbidden.test.tsx` (commit e202c88) now render `asChild` DropdownMenuItem children unwrapped.
  e202c88 changes only that mock; no assertion was removed or weakened.

## Acceptance

- `sumPaidInSaoPauloMonth(payables, today)` counts `status === 'paid'` with `paidOn` in today's month; null `paidOn` counts zero; `dueDate` is never read.
- `buildDashboardModel(bootstrap, today)` counts won revenue by `saoPauloDayOf(new Date(wonAt))`; null or invalid `wonAt` excluded; subtitle count follows the same set (`wonThisMonthCount`).
- Helpers read no clock; `SalesOpsApp` and `CommissionsView` pass `todayInSaoPaulo()` from the `/sao-paulo-day` subpath.
- calculations.test.ts covers 2026-09-01 in, 2026-08-31 and null out, due-Sept-paid-Aug zero, wonAt 02:00Z excluded and 03:00Z included.
- month-totals.test.tsx renders the real shell with `vi.setSystemTime`, including the `2026-10-01T01:00:00Z` São Paulo boundary, for both cards.
- Settlement visibility oracle lives in the sibling `sales-settlement-visibility.test.tsx`, rendering the real `SalesOpsApp`: admin in operacional sees `Marcar como pago`, admin in meus-dados and seller-only see none.
  The admin term is pinned on the extracted `canSettleInWorkspace` predicate (the only thing `canSettle` reads), because the shell never lets a non-admin stand in operacional.
- Other "no mês" labels: none; the sidebar `A pagar este mês` is recorded as an open product question in propostas.md and left unchanged, within scope.
- No API change.

## Checks (run-once)

- Named oracles (calculations, month-totals, sales-settlement-visibility, financial-mutation-forbidden): 4 files, 56 tests passed, no validateDOMNesting, no React warnings.
- `pnpm run lint`: exit 0.
- `pnpm run type-check`: exit 0.
- `CI=true pnpm test` first run: one API test (`dev-identity-hub-config-independence.test.ts`) timed out at 5000ms while lint and type-check ran concurrently; alone it passed 4/4.
  Second full run alone: exit 0 (auth-fake 1, shared-utils 5, api 63, web 96 test files passed; scripts node tests 58 pass, 0 fail).
- `pnpm run build`: exit 0, bundle-clean assertion passed.

## Mutation probes (all restored with `git checkout --`, tree clean)

| Probe | Result |
| --- | --- |
| Drop the paidOn month filter | killed, 6 failed |
| Drop the won-month filter | killed, 4 failed |
| Read dueDate instead of paidOn | killed, 5 failed |
| wonAt UTC day instead of São Paulo day | killed, 3 failed |
| Remove admin term from canSettleInWorkspace | killed, 1 failed |
| Remove operacional term from canSettleInWorkspace | killed, 2 failed |

## Notes

- The API test timeout under concurrent load is a pre-existing flake risk unrelated to this slice (5000ms default on a boot test).
