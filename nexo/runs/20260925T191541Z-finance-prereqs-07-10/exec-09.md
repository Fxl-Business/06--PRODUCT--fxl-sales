# Exec notes - 09-sale-deep-link

Branch `feat/20260925-09-sale-deep-link`, base `80d425c`, head `d1f3443` (one commit: `feat(sales-ops): open a proposta detail from its URL`).

## What changed

- `navigation.ts`: `SALES_OPS_ROUTE_PATTERN` (`/:workspace/:view/:saleId?`), `saleId` on `SalesOpsRoute`/params, `buildSalesOpsPath` encodes the id segment, `buildSaleDetailPath`, and `resolveSalesOpsRoute` keeps the id only on `vendas` (redirects when it drops one; the fallback branch is untouched).
- `router.tsx`: `routes` exported; the Sales Ops route uses `SALES_OPS_ROUTE_PATTERN` (one route object).
- `SalesOpsApp.tsx`: `useLocation`; `detailSaleId` comes from the route; `openSaleDetail` pushes with the `SALE_DETAIL_OPENED_IN_APP` marker; `closeSaleDetail` pops when the marker is present and otherwise replaces with the list; `openSaleFromBoard(saleId)` opens `buildSaleDetailPath(saleId)`, still inside the fence and writing nothing; `SalesView` lost its `useState` and takes `detailSaleId`/`onOpenDetail`/`onCloseDetail`; `detailLayer` renders in all three return branches; new `SaleNotFoundDialog` names no id. Slice 08's `canSettle` prop and the 820px width are kept.
- Docs: CLAUDE.md `## Sales Ops Routing`, and `nexo/knowledge/reference/sales-ops-routing.md` gets one appended block.

## Files outside files_modified (and why)

- `apps/web/src/sales-ops/__tests__/controlled-sales-view.tsx` (new): a shared `ControlledSalesView` harness that stands in for the URL when `SalesView` is rendered alone. I used it instead of copying an inline harness into four files.
- `apps/web/src/sales-ops/__tests__/sales-settlement-visibility.test.tsx` and `sale-detail-civil-day.test.tsx`: both render `SalesView` directly and click a row. Once the detail became URL state, 7 of their tests went red. Each file now renders `ControlledSalesView` and nothing else changed (import plus element name).

## Red -> green evidence

- navigation: `builds the proposta detail path...` and `keeps a proposta id only on the vendas view` were red for the right reason (`expected '/operacional/vendas' to be '/operacional/vendas/<id>'`). `drops a proposta id...` passed before the change and is a guard; M4 below kills it.
- sale-deep-link-route: red (`routes` not exported). With the export in place and only the path reverted, the two route oracles are red and the catch-all guard stays green.
- sales-view: both new branch oracles were red (`to contain 'Plano de pagamento'` / `'Proposta não encontrada'`).
- sale-deep-link.test.tsx: 5 of 7 were red before the wiring (`onOpenDetail is not a function`, and the detail was missing). The visibility and comissoes cases are guards that pass today.
- session-recovery: three new tests (`keeps a proposta deep link with its id segment`, `round-trips a proposta deep link with its id segment`, `overwrites a stale slot when a proposta deep link is captured`) pin the contract and were green on arrival, as the plan expected.
- session-journey: the harness now mirrors `router.tsx` (the optional segment plus the `*` Navigate outside Protected). The new tests are `lands on the proposta deep link after a cold entry with no session and a login` and `is not hijacked by a stale returnTo left by an abandoned login`.

Mutations run for real (each one was red, then restored):
- M1: journey harness path set back to `/:workspace/:view` -> both journey deep-link tests red.
- M2: close always pushes the list -> `pushes ... pops it on close` and `replaces the deep link ...` red.
- M3: close always `navigate(-1)` -> `replaces the deep link ...` and `shows Proposta não encontrada ...` red.
- M4: carry `saleId` into the fallback route -> `drops a proposta id for an operator who cannot see the workspace` red.
- M5: `openSaleFromBoard` back to the bare list -> `opens the proposta from a converted lead card and returns to the board on close` red.

## Revalidation note (stale returnTo)

`captureReturnTo` with a null result leaves an older slot in place (`session-recovery.ts`). A cold entry at `/operacional/vendas/<id>` now reaches `Protected` intact, so its capture OVERWRITES any stale value. The journey test seeds `/cadastros/produtos` in the slot, enters cold, logs in, lands on the deep link, and asserts `/cadastros/produtos` was never visited. The unit test pins the overwrite. Under M1 the journey test goes red.
The auth code is unchanged, as the plan's out-of-scope requires.
Residual (not in this slice): a cold entry at `/` itself still does not clear a stale slot. If Verify or the lead wants that closed, it needs its own ticket.

## Added oracle beyond the plan

`opens the proposta from a converted lead card and returns to the board on close` (in `sale-deep-link.test.tsx`, with a stubbed `LeadsBoardContainer` that calls `onOpenSale`) covers the lead-card acceptance item.

## Real browser (make dev-fake, team-owner, local DB on :5006, Chrome)

- A fresh tab opened directly at `/operacional/vendas/97398992-...` (a seeded won proposta `0001-1`): the detail opened with no click. X closed it to `/operacional/vendas` and history.length did not change (replace).
- From `/tatico/dashboard` I navigated to the list, clicked the row (URL `/operacional/vendas/<uuid>`), and closed it (`/operacional/vendas`). Browser Back went to `/tatico/dashboard` and the detail did not reopen.
- One hex digit changed: `Proposta não encontrada` over the list, centred, button right-aligned. The id is absent from `innerText`. Escape goes to `/operacional/vendas`.
- `/meus-dados/vendas/<uuid>`: the read-only detail opens with no settlement actions.
- `/operacional/comissoes/<uuid>` is rewritten to `/operacional/comissoes`.
- Prospecção: the converted card link (`data-open-sale`) opens `/operacional/vendas/<uuid>` with the detail. Closing it returns to `/operacional/leads`.
- 375px: Chrome clamped the window resize (viewport stayed 1374), so I checked this by calculation, not in a narrow viewport. The dialog is `calc(100vw-48px)` = 327px. The title text measures 211px, so it ends at 235px and the X starts at about 295px. There is no overlap and no horizontal scroll.
- Not covered in the browser: the Organization switch (step 5 of the plan's browser check); I did not attempt it here.
- The no-session login round trip cannot happen in dev-fake (it always mints a token). The journey oracles cover it; no local Hub was used.
- The dev-fake process groups I started (62308 make, 62544 api, 62545 web) were killed by pgid. Ports 3006 and 8006 were free afterwards.

## Gates (run-once)

The named oracle command passed (10 files, 151 tests). `CI=true pnpm test` passed (web 95 files / 1069 tests, api 63/680, shared-utils 155, auth-fake 35, scripts 58). `pnpm run lint`, `pnpm run type-check` and `pnpm run build` passed. `node scripts/assert-web-bundle-clean.mjs` reports clean.
