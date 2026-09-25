---
id: 12-month-totals
milestone: v4.1.0
status: done
depends_on: [09-sale-deep-link]
files_modified: [apps/web/src/sales-ops/calculations.ts, apps/web/src/sales-ops/SalesOpsApp.tsx, apps/web/src/sales-ops/__tests__/calculations.test.ts, apps/web/src/sales-ops/__tests__/month-totals.test.tsx, apps/web/src/sales-ops/__tests__/settlement-visibility.test.tsx, CLAUDE.md, nexo/knowledge/reference/propostas.md]
goal: "'Total pago no mês' and 'Receita ganha no mês' count only the current São Paulo month (by paidOn and by the won day), instead of every paid payable and every won sale ever"
acceptance: ["A pure helper in calculations.ts (e.g. sumPaidInSaoPauloMonth(payables, today)) counts a payable only when status === 'paid' and paidOn is a day whose YYYY-MM equals today's YYYY-MM; a paid row with paidOn null counts zero; dueDate is never read", "buildDashboardModel takes today as an argument and 'Receita ganha no mês' counts a won sale only when saoPauloDayOf(new Date(sale.wonAt)) is in today's São Paulo month; a null wonAt is excluded", "Neither helper reads the clock; the callers pass todayInSaoPaulo() from @fxl-sales/shared-utils/sao-paulo-day", "Oracle (calculations.test.ts, today = 2026-09-25): paidOn 2026-09-01 counts, 2026-08-31 and null do not; a row due in September but paid in August counts zero; wonAt 2026-09-01T02:00:00Z (Aug 31 in São Paulo) is excluded, 2026-09-01T03:00:00Z is included", "Render oracle (month-totals.test.tsx): the comissoes card 'Total pago no mês' shows only the current month's amount with a fixed clock (vi.setSystemTime), and the dashboard 'Receita ganha no mês' likewise", "No other dashboard number changes meaning; any other 'no mês' figure found is listed in the exec notes and fixed the same way only if its label says 'no mês'", "Settlement visibility oracle (month-totals.test.tsx or a sibling file, rendering the real SalesOpsApp shell): an admin in operacional/comissoes sees Marcar como pago; the same admin in meus-dados/comissoes and a seller-only profile see no settlement action; removing either the admin term or the operacional term from canSettle in SalesOpsApp.tsx turns it red", "CLAUDE.md (Civil days) and propostas.md record the month rule in the same change; CI=true pnpm test, lint, type-check, build green"]
---

# 12 - Month totals follow the São Paulo month

## Context

Found while building slice 08 and diagnosed by the orchestrator on 2026-09-25.
- `CommissionsView` in `apps/web/src/sales-ops/SalesOpsApp.tsx` (master `:3069-3071`, card `:3084`; after 08 about `:3159`/`:3174`) sums every payable with `status === 'paid'` with no date filter, while the card says "Total pago no mês" and its subtitle "Baixas registradas".
  `CommissionsView` is shared by `operacional/comissoes` and `meus-dados/comissoes`, so sellers see the wrong total too.
- The dashboard "Receita ganha no mês" (`SalesOpsApp.tsx:2361`) comes from `buildDashboardModel` (`apps/web/src/sales-ops/calculations.ts:880`, sum at `:923`), which sums every `won` sale; `sale.wonAt` (`types.ts:185`) is never read.
- After slice 08, `SalesOpsPayable` carries `paidOn` (the reducer's greatest active baixa day, `propostas.md`).
- No reference defines "no mês". Decision (AUDIT P7): the São Paulo civil month of `today`, by `paidOn` for payments and by the São Paulo day of `wonAt` for won revenue; never `dueDate`.

## Steps

1. Red: the calculations oracle and the render oracle from the acceptance list.
2. Green: add the helper(s) in `calculations.ts` (imports only the `/sao-paulo-day` subpath), thread `today` into `buildDashboardModel` and `CommissionsView`, compute `today` once per render with `todayInSaoPaulo()`.
3. Read the rest of `buildDashboardModel` and the dashboard cards for other "no mês" labels; fix the same way only those whose label says "no mês".
4. Docs: CLAUDE.md "Civil days" gets one bullet; propostas.md one paragraph.
5. Mutations: drop the month filter (oracle red); read `dueDate` instead of `paidOn` (oracle red); restore.

## Scope limits

No API change.
Keep the card layout; only the number changes.

## Addendum 2026-09-25 (orchestrator, from slice 08 verify a2)

Slice 08's Verify found that the `canSettle` wiring in `SalesOpsApp.tsx` (admin AND operacional) has no automated oracle: removing either term survives the suite; it was only browser-verified.
This slice already edits `SalesOpsApp.tsx`, so it adds that oracle (acceptance above) without changing behaviour.
