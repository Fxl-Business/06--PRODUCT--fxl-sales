# Verify 12-month-totals (attempt a1)

Verdict: FAIL (one documentation criterion; code, oracles and mutations are all green).
Branch feat/20260925-12-month-totals, head 21f355f, base 416c1a2.

## Gates

- Named oracles (calculations.test.ts, month-totals.test.tsx, sales-settlement-visibility.test.tsx): 53/53 pass.
- `pnpm run lint`: exit 0.
- `pnpm run type-check`: exit 0.
- `CI=true pnpm test`: first run failed 2 tests + 1 suite in apps/api (dev-identity-production-refusal, dev-identity-hub-config-independence, app-auth-bff-memory-path hook timeout), all 5s/10s timeouts under machine load average about 60; the three files pass alone, and the full rerun is green (auth-fake 35, shared-utils 155, api 680, web 1083, node scripts 58 pass / 0 fail).
  These API files are untouched by the slice; the timeouts are a load flake worth a separate fix.
- `pnpm run build`: exit 0, assert-web-bundle-clean clean.

## Acceptance

- `sumPaidInSaoPauloMonth(payables, today)` counts `status === 'paid'` with `paidOn` in today's YYYY-MM; null/undefined `paidOn` counts zero; `dueDate` is not in its input type and never read. Met.
- `buildDashboardModel(bootstrap, today)` counts won revenue by `saoPauloDayOf(new Date(wonAt))`; null or invalid `wonAt` excluded. Met.
- Neither helper reads the clock (no `new Date()`/`Date.now` in calculations.ts); `SalesOpsApp` and `CommissionsView` pass `todayInSaoPaulo()` from the `/sao-paulo-day` subpath. Met.
- Calculations oracle covers 09-01 in, 08-31 and null out, due-Sep-paid-Aug zero, wonAt 02:00Z excluded and 03:00Z included. Met.
- Render oracle fixes the clock (`vi.useFakeTimers({toFake:['Date']})` + `vi.setSystemTime`) on the real shell for both cards, including 2026-10-01T01:00Z (still September in São Paulo). Met.
- Other dashboard numbers: `Propostas ganhas` (`wonSalesCount`), MRR, `Comissões a pagar`, rankings and `Total a pagar` keep all-time meaning (asserted). The `Receita ganha no mês` card subtitle now counts `wonThisMonthCount`, consistent with its value and documented. The sidebar `A pagar este mês` is unchanged and recorded as an open product question (label says "este mês", not "no mês"). Met.
- Settlement visibility shell oracle: admin in operacional/comissoes sees `Marcar como pago`; same admin in meus-dados/comissoes and seller-only see none. The gate moved to `canSettleInWorkspace` in navigation.ts, pinned by a predicate test. Met.
- Docs: propostas.md paragraph is one sentence per line. CLAUDE.md "Civil days" new bullet carries TWO sentences on one physical line. NOT met (see Finding 1).

## Mutation probes (each restored with git checkout; tree clean)

| Probe | Result |
| --- | --- |
| M1 drop month filter on payables | red (5 tests) |
| M2 read dueDate instead of paidOn | red (5 tests) |
| M3 UTC day of wonAt instead of São Paulo day | red (3 tests) |
| M4 count a null paidOn | red (1 test) |
| M5a remove admin term in `canSettleInWorkspace` | red (predicate test) |
| M5b call site passes `['admin']` instead of `profile.roles` | survives; equivalent through the shell, since `getVisibleWorkspaces` gives `operacional` only to admins and route resolution redirects others (documented in propostas.md) |
| M6a remove operacional term in predicate | red (shell + predicate) |
| M6b call site hardcodes `'operacional'` | red (shell) |
| M7 dashboard caller uses UTC today | red |
| M8 drop wonAt month filter | red (4 tests) |
| M9 CommissionsView caller uses UTC today | red |

## Findings

1. BLOCKING (criterion 4): `CLAUDE.md` line added in "Civil days" holds two sentences on one line:
   `... never by \`dueDate\`. The helpers take \`today\` and never read the clock; callers pass \`todayInSaoPaulo()\`.`
   Fix: move `The helpers take ...` to an indented continuation line under the same bullet (the pattern already used by the `Leaving \`won\` is refused` bullet).
2. Non-blocking: the new shell block in `sales-settlement-visibility.test.tsx` logs `validateDOMNesting: <button> cannot appear as a descendant of <button>` because the `DropdownMenuItem` mock renders a `<button>` around an `asChild` button in the sidebar account menu. Test-mock noise, not product behaviour; worth rendering the mock item as a fragment/`div` when the fix is made.
3. Non-blocking: api auth tests time out under heavy machine load (pre-existing flake, not caused by this slice).

No process left running by this agent; worktree clean.
