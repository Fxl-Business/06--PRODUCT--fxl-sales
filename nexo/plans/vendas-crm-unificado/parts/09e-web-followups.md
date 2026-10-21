# Part 09e - Follow-ups list (route, Minha/Equipe, period)

Part of slice `09-web-lead-resumo`. Depends on parts 08a, 08b, 09a, 09c, 09d.

## Context

- Contract: `GET /followups?scope=mine|team&from&to&status=open|done|all` (team needs admin; mine = owner is the caller's pessoa or created by the caller), `POST /followups/:id/done`. Period filter is `due_on` in Sao Paulo civil days. Client: `crmApi.listFollowups`, `crmApi.markFollowupDone`, hooks `useMarkFollowupDone` (09d). Wire assumption A1 (08a): `{ followups: FollowupListRow[] }`.
- Part 09a reserved the view id `follow-ups`, its title and `headerAction` null in `SalesOpsApp.tsx`. This part adds the nav entries and the screen.
- Nav lists are in `navigation.ts`: `operational` (line ~62), `meusDadosSeller` (~99), `leadsEditionOperational` (~124), `leadsEditionMeusDadosSeller` (~155). Entries are APPENDED (the first entry is the landing route). The feature has no edition branch, so all four lists get it. Literal tables pin the lists in `navigation-edition.test.ts` and `leads-stage-navigation.test.tsx`.
- Period control: `PeriodFilter` (08b) with presets that include `next7` for a forward-looking list.
- `showSellerFilter={workspace === 'operacional'}` is the precedent for "offer the team control only under operacional".

## Design

1. `navigation.ts`: import `CalendarClock` from `lucide-react`; append `{ id: 'follow-ups', label: 'Follow-ups', icon: CalendarClock }` to `operational`, `leadsEditionOperational`; append `{ id: 'follow-ups', label: 'Meus follow-ups', icon: CalendarClock }` to `meusDadosSeller`, `leadsEditionMeusDadosSeller`. `getDefaultSalesOpsRoute.landingView` keeps working (`items[0]` unchanged).
2. Pure `followups.ts`: `FOLLOWUP_COPY = { teamLabel: 'Equipe', mineLabel: 'Minha', statusOpen: 'Em aberto', statusDone: 'Concluídos', statusAll: 'Todos', empty: 'Nenhum follow-up neste período.', loadFailed: 'Não foi possível carregar os follow-ups.', openLead: 'Abrir lead', done: 'Concluir' }`; `FOLLOWUP_SCOPE_OPTIONS`/`FOLLOWUP_STATUS_OPTIONS` (value/label lists); `FOLLOWUP_PRESETS: readonly PeriodPreset[] = ['all','today','next7','last7','month','custom']`; `sortFollowups(rows)` by `dueOn` ascending then `leadContactName` (pt-BR); `followupsParams(scope, status, range: PeriodRange): ListFollowupsParams` using `periodQuery`.
3. `useFollowups(params)` in `crm-hooks.ts`: `queryKey: queryKeys.leads.followups({ scope, status, from, to })`, `queryFn: crmApi.listFollowups(params, token)`, select to the array.
4. `FollowupsView.tsx` (presentational): props `{ rows, today, scope, onScopeChange, showScopeToggle, status, onStatusChange, period, onPeriodChange, onOpenLead, onMarkDone, pendingId }`. Header controls: scope as a segmented control (reuse `segmentedContainerClass`, `segmentedButtonClass`, `segmentedButtonActiveClass` from `board-ui.ts`, buttons `Minha` / `Equipe`, `aria-pressed`, rendered only when `showScopeToggle`), status `Combobox` (`aria-label="Situação"`, `comboboxTriggerClass`), `PeriodFilter` (`aria-label="Período do follow-up"`, `presets={FOLLOWUP_PRESETS}`). Table-like list of `sortFollowups(rows)`: lead name (button `data-followup-open-lead={row.leadId}` calling `onOpenLead`), next step, due date `displayDate(dueOn)` with the `followupDueState` badge (09c), owner (`ownerName` or `Sem responsável`), and `Concluir` (`data-followup-done={row.id}`) for open rows, `Concluído` text for done ones. Empty state `FOLLOWUP_COPY.empty`. Never an id in text.
5. `FollowupsContainer.tsx` (names the hooks): props `{ workspace: SalesOpsWorkspace }`. State: `scope` (`'team'` under `operacional` for an admin, else `'mine'`; the toggle shows only under `operacional` AND `roles.includes('admin')`; under `meus-dados` the scope is fixed `mine`), `status` (`'open'`), `period: PeriodSelection` (`{ preset: 'next7', ... }` default for open follow-ups), all component state. `range = selectionToRange(period, todayInSaoPaulo())` memoized by `period`; a custom range with an error leaves the range open (08b). `onOpenLead` -> `navigate(buildLeadSummaryPath(workspace, id), { state: LEAD_SUMMARY_OPENED_IN_APP })`. `onMarkDone` -> `useMarkFollowupDone().mutateAsync(id)`. Pending -> `Skeleton`; error -> `FOLLOWUP_COPY.loadFailed`. A `403` on `team` is not specially classified (the toggle is admin-only).
6. `SalesOpsApp.tsx`: import `FollowupsContainer`; next to the other view mounts (after `{view === 'etapas' ...}` line ~2397) add `{view === 'follow-ups' ? <FollowupsContainer workspace={workspace} /> : null}`.
7. `board-write-surface.test.ts` `OWNED_FILES`: add nothing (follow-ups are not board files).
8. Docs: `CLAUDE.md` Sales Ops Routing `Routes:` bullet append `operacional|meus-dados/follow-ups`; `nexo/knowledge/reference/sales-ops-routing.md` and `kanban-de-leads.md` get one sentence each (scope rule, period default, appended nav entry).

## Steps (TDD)
1. Write `followups.test.ts`, `followups-view.test.tsx`, `followups-container.test.tsx`, the navigation table updates; red.
2. Implement items 1-6; green; docs.

## Tests
- `followups.test.ts` (node): `sortFollowups` order; `followupsParams('team','open', {from:'2026-10-20',to:'2026-10-26'})` equals `{scope:'team',status:'open',from:'2026-10-20',to:'2026-10-26'}`; open range omits `from`/`to`.
- `followups-view.test.tsx` (happy-dom, real Combobox): rows render with badge states; `Minha`/`Equipe` toggle renders only with `showScopeToggle` and `aria-pressed` follows `scope`; clicking `Concluir` calls `onMarkDone(id)` and a done row has none; clicking the lead name calls `onOpenLead(leadId)`; the status picker and period filter are Comboboxes (no native select); empty copy.
- `followups-container.test.tsx` (mock `../crm-hooks`): under `operacional` as admin the first query is `{scope:'team', status:'open', from: today, to: today+6}` computed from a mocked `todayInSaoPaulo` (`vi.mock('@fxl-sales/shared-utils/sao-paulo-day')` keeping the real `isIsoDay`/`saoPauloDayOf`); switching to `Minha` re-queries with `scope:'mine'`; under `meus-dados` there is no toggle and the scope is `mine`; changing the period to `Personalizado` with a reversed range keeps the query unfiltered and shows the error; selecting `Todo o período` sends no `from`/`to`; clicking a lead name navigates to `/operacional/leads/<leadId>`.
- Period correctness in Sao Paulo days is pinned by `period.test.ts` (08b); this container test pins that the container feeds it `todayInSaoPaulo()`.
- Navigation tables: `navigation-edition.test.ts` literal tables gain `follow-ups` as the LAST entry of the four lists named above; `leads-stage-navigation.test.tsx` expectations `['vendas','comissoes','leads','funil']` become `[..., 'follow-ups']` and `['leads','funil']` become `['leads','funil','follow-ups']`; `navigation.test.ts` gets `follow-ups resolves in operacional for an admin, in meus-dados for a seller, and not for a finder-only operator`.

## Affected tests search
`navigation-edition.test.ts`, `navigation.test.ts`, `leads-stage-navigation.test.tsx` (literal nav tables); `routing.test.tsx` and `leads-routing.test.tsx` mock hooks and do not assert nav length (searched `getSalesOpsNavigation` and `toHaveLength` over `sales-ops/__tests__`).

## Commands
- Oracle part: `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/leads/__tests__/followups.test.ts src/sales-ops/leads/__tests__/followups-view.test.tsx src/sales-ops/leads/__tests__/followups-container.test.tsx src/sales-ops/__tests__/navigation-edition.test.ts src/sales-ops/__tests__/navigation.test.ts`
- Affected: `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops`
- lint and type-check

## Risks
- The default `next7` preset hides overdue open follow-ups; the status/period controls make `Todo o período` one click away, and the overdue badge shows once visible. Accepted default for an agenda view.
- The team scope is admin-only on the API; the web never offers it otherwise.
- Phase 2 text says "sem listas paralelas por edicao"; the follow-ups entries are appended to the four existing parallel nav lists (`operational`, `meusDadosSeller`, `leadsEditionOperational`, `leadsEditionMeusDadosSeller`) and that is correct for now; phase 3 removes those parallel lists.
