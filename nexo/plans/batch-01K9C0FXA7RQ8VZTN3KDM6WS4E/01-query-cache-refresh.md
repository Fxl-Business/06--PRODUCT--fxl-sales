---
id: 01-query-cache-refresh
milestone: v2.3.0
status: todo
depends_on: []
files_modified:
  - apps/web/src/lib/query-keys.ts
  - apps/web/src/lib/app-mutation.ts
  - apps/web/src/lib/__tests__/app-mutation.test.ts
  - apps/web/src/sales-ops/optimistic.ts
  - apps/web/src/sales-ops/hooks.ts
  - apps/web/src/sales-ops/SalesOpsApp.tsx
  - apps/web/src/sales-ops/__tests__/optimistic.test.ts
  - apps/web/src/sales-ops/__tests__/cadastros-refresh.test.tsx
  - apps/web/src/sales-ops/__tests__/sale-wizard-state-preservation.test.tsx
  - apps/web/src/admin/apps/useApps.ts
  - apps/web/src/admin/audit/useAuditLog.ts
  - apps/web/src/admin/commissions/useAdminCommissions.ts
  - apps/web/src/admin/conversions/useConversions.ts
  - apps/web/src/admin/finders/hooks/useFinders.ts
  - apps/web/src/admin/payouts/usePayouts.ts
  - apps/web/src/admin/products/useProducts.ts
  - apps/web/src/admin/sellers/hooks/useSellers.ts
  - apps/web/src/finder/clicks/useClicks.ts
  - apps/web/src/finder/links/useLinks.ts
  - apps/web/eslint.config.js
acceptance: "given cadastros/areas with an empty list, when the Nova área dialog is submitted, then the new Área is visible in the table before the POST resolves, is still visible after the POST and the bootstrap refetch resolve (exactly once, not duplicated), and is removed again if the POST fails - and the same list-reflects-the-change guarantee holds for cadastros/produtos once its POST resolves, with no manual reload and no refetch trigger from the user"
---

# Application-wide query cache refresh rail

## Goal

Make every mutation in `apps/web/src` refresh the cache it owns through one structural rail instead of nine hand-written `invalidateQueries` calls, then close the actual user-visible gap in `cadastros/areas` by adding true optimistic writes to the sales-ops cadastros lists whose rows the client can compute in full.
The rail has three parts: a single repo-wide query-key factory (`apps/web/src/lib/query-keys.ts`) so invalidation targets are declarative and impossible to typo, a `useAppMutation` wrapper (`apps/web/src/lib/app-mutation.ts`) whose `invalidates` field is a required non-empty tuple so a new mutation cannot type-check without declaring what it refreshes, and an ESLint ban on importing `useMutation` directly anywhere except the wrapper module.
Along the way this slice fixes a second, more severe bug that the existing broad invalidation actively causes: a bootstrap refetch remounts an open proposta wizard and destroys in-progress typing.

## Current state

### The reported bug is not a missing invalidation

Broad invalidation already exists and already fires.
`useInvalidateSalesOps` at `apps/web/src/sales-ops/hooks.ts:43-46` calls `queryClient.invalidateQueries({ queryKey: salesOpsKeys.all })`, and all nine sales-ops mutation hooks call it from `onSuccess` (`hooks.ts:51-57`, `63-69`, `75-81`, `87-93`, `99-105`, `111-117`, `123-129`, `135-141`, `147-153`).
The API side is correct too: `getSalesOpsSnapshot` at `apps/api/src/domains/sales-ops/service.ts:1300-1357` does return `areas` (`service.ts:1332-1336`) and the select normalizer at `hooks.ts:28-39` maps it through.
So the create does land in the payload, and the list does eventually update.

The verified root cause is a refresh that the UI neither waits for nor discloses:

1. `POST /api/v1/sales-ops/areas` resolves (`apps/web/src/sales-ops/api.ts:89-95`).
2. The hook-level `onSuccess` at `hooks.ts:90-92` fires `void invalidate()`. TanStack fires the hook-level `onSuccess` before the `mutate()`-scoped one, and neither awaits the returned promise.
3. The `mutate()`-scoped `onSuccess` at `apps/web/src/sales-ops/SalesOpsApp.tsx:1121` immediately runs `setModal(null)`, so the dialog disappears while the refresh is still in flight.
4. The refresh is a full snapshot refetch: ten sequential `SELECT`s inside one tenant transaction (`service.ts:1300-1357`) covering sales, products, clients, people, payables, saleItems, settings, areas, receivables and saleProfessionals. On staging this is the slowest read in the product.
5. During that window `bootstrapQuery.isLoading` is `false` because data already exists, so the guard at `SalesOpsApp.tsx:1019-1026` keeps rendering, and `AreasView` at `SalesOpsApp.tsx:1079-1084` / `2139-2200` renders the previous `bootstrap.areas` array with zero pending affordance.

Net effect: the operator closes the dialog and stares at a list that still lacks the new Área for one full snapshot round trip, with nothing on screen saying anything is happening.
That reads as "it did not update".

### Second, severe bug caused by the same invalidation

`SaleWizardDialog` at `SalesOpsApp.tsx:3632-3652` remounts `SaleWizardDialogBody` on a composite `key`:

```
key={`${props.editSale?.id ?? 'create'}-${props.bootstrap.clients[0]?.id ?? 'no-client'}-${props.bootstrap.products[0]?.id ?? 'no-product'}-${props.bootstrap.people.length}`}
```

`SaleWizardDialogBody` seeds its `useState` initializers from `bootstrap` (`SalesOpsApp.tsx:3667-3684`, first product / first client / first seller), and the composite key exists to re-seed them once data arrives.
The consequence is that any bootstrap refetch which changes the alphabetically-first client, the alphabetically-first product, or the people count destroys all in-progress wizard state.
Note that `bootstrap.clients` and `bootstrap.products` are ordered by `name` server-side (`service.ts:1312-1317`, `1307-1311`) and `people` by `displayName` (`service.ts:1318-1322`), so creating a client named "ACME" while a wizard is open is enough to wipe the form.
Making invalidation more aggressive without fixing this makes the product worse, so the fix belongs in this slice.

### Query client defaults

`apps/web/src/App.tsx:7-14` - one module-level `QueryClient`, `staleTime: 1000 * 60`, `retry: 1`.
No per-query `staleTime` / `gcTime` overrides exist anywhere.

### Referential instability

`useSalesOpsBootstrap` at `hooks.ts:25-40` passes an inline arrow as `select`, so the selector identity changes on every render, TanStack's per-selector memo is defeated, and a fresh `SalesOpsBootstrap` object is produced each render.
That in turn makes `useMemo(() => buildDashboardModel(bootstrap), [bootstrap])` at `SalesOpsApp.tsx:532` recompute on every render.

### Complete mutation-site inventory

Hook definitions (the write sites). Every one of these moves to `useAppMutation` + `queryKeys`.

| # | Hook | File:line | Today | Target `invalidates` | Optimistic? |
|---|---|---|---|---|---|
| 1 | `useSaveSalesOpsPerson` | `apps/web/src/sales-ops/hooks.ts:48-58` | invalidate `['sales-ops']` in `onSuccess` | `[queryKeys.salesOps.all]` | yes (people) |
| 2 | `useSaveSalesOpsProduct` | `apps/web/src/sales-ops/hooks.ts:60-70` | invalidate `['sales-ops']` | `[queryKeys.salesOps.all]` | no |
| 3 | `useSaveSalesOpsClient` | `apps/web/src/sales-ops/hooks.ts:72-82` | invalidate `['sales-ops']` | `[queryKeys.salesOps.all]` | yes (clients) |
| 4 | `useSaveSalesOpsArea` | `apps/web/src/sales-ops/hooks.ts:84-94` | invalidate `['sales-ops']` | `[queryKeys.salesOps.all]` | yes (areas) |
| 5 | `useCreateSalesOpsSale` | `apps/web/src/sales-ops/hooks.ts:96-106` | invalidate `['sales-ops']` | `[queryKeys.salesOps.all]` | no (server-derived) |
| 6 | `useUpdateSalesOpsSale` | `apps/web/src/sales-ops/hooks.ts:108-118` | invalidate `['sales-ops']` | `[queryKeys.salesOps.all]` | no (server-derived) |
| 7 | `useTransitionSalesOpsSale` | `apps/web/src/sales-ops/hooks.ts:120-130` | invalidate `['sales-ops']` | `[queryKeys.salesOps.all]` | no (server-derived) |
| 8 | `useCancelSalesOpsContract` | `apps/web/src/sales-ops/hooks.ts:132-142` | invalidate `['sales-ops']` | `[queryKeys.salesOps.all]` | no (server-derived) |
| 9 | `useSaveSalesOpsSettings` | `apps/web/src/sales-ops/hooks.ts:144-154` | invalidate `['sales-ops']` | `[queryKeys.salesOps.all]` | no |
| 10 | `useCreateApp` | `apps/web/src/admin/apps/useApps.ts:20-29` | invalidate `['admin','apps']` | `[queryKeys.adminApps.all]` | no |
| 11 | `useUpdateApp` | `apps/web/src/admin/apps/useApps.ts:31-42` | invalidate list + detail | `({ variables }) => [queryKeys.adminApps.all, queryKeys.adminApps.detail(variables.id)]` | no |
| 12 | `useSetAppStatus` | `apps/web/src/admin/apps/useApps.ts:44-55` | invalidate list + detail | `({ variables }) => [queryKeys.adminApps.all, queryKeys.adminApps.detail(variables.id)]` | no |
| 13 | `useRotateSecretKey` | `apps/web/src/admin/apps/useApps.ts:59-64` | **nothing** | `({ variables }) => [queryKeys.adminApps.all, queryKeys.adminApps.detail(variables)]` | no |
| 14 | `useRotateWebhookSecret` | `apps/web/src/admin/apps/useApps.ts:66-72` | **nothing** | `({ variables }) => [queryKeys.adminApps.all, queryKeys.adminApps.detail(variables)]` | no |
| 15 | `useVerifyChain` | `apps/web/src/admin/audit/useAuditLog.ts:18-23` | nothing | `NO_CACHE_EFFECT` (read-only ledger verification, writes nothing) | no |
| 16 | `useLockCommission` | `apps/web/src/admin/commissions/useAdminCommissions.ts:23-33` | invalidate `['admin','commissions']` | `[queryKeys.adminCommissions.all]` | no |
| 17 | `useReverseCommission` | `apps/web/src/admin/commissions/useAdminCommissions.ts:35-45` | invalidate `['admin','commissions']` | `[queryKeys.adminCommissions.all]` | no |
| 18 | `useApproveFinder` | `apps/web/src/admin/finders/hooks/useFinders.ts:30-40` | invalidate list + detail | `({ variables }) => [queryKeys.adminFinders.all, queryKeys.adminFinders.detail(variables)]` | no |
| 19 | `useSuspendFinder` | `apps/web/src/admin/finders/hooks/useFinders.ts:42-53` | invalidate list + detail | `({ variables }) => [queryKeys.adminFinders.all, queryKeys.adminFinders.detail(variables.id)]` | no |
| 20 | `useCreatePayoutBatches` | `apps/web/src/admin/payouts/usePayouts.ts:34-45` | invalidate both payout lists | `[queryKeys.payouts.all]` | no |
| 21 | `useMarkPayoutPaid` | `apps/web/src/admin/payouts/usePayouts.ts:47-58` | invalidate both payout lists | `[queryKeys.payouts.all]` | no |
| 22 | `useDownloadPayoutCsv` | `apps/web/src/admin/payouts/usePayouts.ts:65-80` | nothing | `NO_CACHE_EFFECT` (browser blob download, writes nothing) | no |
| 23 | `useCreateProduct` | `apps/web/src/admin/products/useProducts.ts:174-194` | full optimistic + invalidate in `onSettled` | `[queryKeys.adminProducts.all]` | yes, already (house pattern) |
| 24 | `useUpdateProduct` | `apps/web/src/admin/products/useProducts.ts:196-207` | invalidate list + detail | `({ variables }) => [queryKeys.adminProducts.all, queryKeys.adminProducts.detail(variables.id)]` | no |
| 25 | `useUpsertPriceBand` | `apps/web/src/admin/products/useProducts.ts:209-224` | invalidate detail only | `[queryKeys.adminProducts.detail(productId)]` | no |
| 26 | `useUpsertCommissionRule` | `apps/web/src/admin/products/useProducts.ts:226-236` | invalidate detail only | `[queryKeys.adminProducts.detail(productId)]` | no |
| 27 | `useInviteSeller` | `apps/web/src/admin/sellers/hooks/useSellers.ts:20-30` | invalidate `['admin','sellers']` | `[queryKeys.adminSellers.all]` | no |
| 28 | `useCreateLink` | `apps/web/src/finder/links/useLinks.ts:47-56` | invalidate `['finder','links']` | `[queryKeys.finderLinks.all]` | no |
| 29 | `useRevokeLink` | `apps/web/src/finder/links/useLinks.ts:58-68` | invalidate `['finder','links']` | `[queryKeys.finderLinks.all]` | no |

Component call sites that drive those hooks (no logic change needed in any of them, listed so nothing is missed):
`SalesOpsApp.tsx:1035` (cancelContract), `1038` (transition), `1089` (settings), `1105` (product), `1113` (client), `1121` (area), `1129` (person), `1139` and `1144` (sale update / create); `apps/web/src/admin/products/ProductDialog.tsx:56-57`; `apps/web/src/admin/products/PriceBandForm.tsx:22`; `apps/web/src/admin/products/CommissionRuleForm.tsx:24`; `apps/web/src/admin/commissions/CommissionsPage.tsx:37-38`; `apps/web/src/admin/apps/AppDialog.tsx:43-44`; `apps/web/src/admin/apps/AppsPage.tsx:23`; `apps/web/src/admin/apps/KeyRevealModal.tsx:63-64`; `apps/web/src/admin/audit/AuditLogPage.tsx:21`; `apps/web/src/admin/payouts/PayoutsPage.tsx:42`; `apps/web/src/admin/payouts/PayoutBatchesPage.tsx:47-48`; `apps/web/src/admin/finders/AdminFinderDetailPage.tsx:45-46`; `apps/web/src/admin/sellers/AdminSellersPage.tsx:31`; `apps/web/src/finder/links/LinkCard.tsx:36`; `apps/web/src/finder/links/LinkGeneratorForm.tsx:43`.

There are no `refetch()` calls anywhere in `apps/web/src`.

### Query definitions and their current keys

`hooks.ts:26` `salesOpsKeys.bootstrap()` = `['sales-ops','bootstrap']`; `hooks.ts:14-17` is the only existing key factory and it has only `all` and `bootstrap()`.
Everything else is an inline literal array: `useApps.ts:14`, `useAuditLog.ts:13`, `useAdminCommissions.ts:17`, `useConversions.ts:13`, `useFinders.ts:15` and `:24`, `usePayouts.ts:19` and `:28`, `useProducts.ts:159` and `:168`, `useSellers.ts:14`, `useClicks.ts:15` and `:25`, `useLinks.ts:22`, `:31`, `:40`, `:73`.

Two latent list/detail key collisions live in those literals:
`useAdminProducts(appId)` produces `['admin','products', appId ?? 'all']` (`useProducts.ts:159`) while `useAdminProduct(id)` produces `['admin','products', id]` (`useProducts.ts:168`); the same id can therefore address a list payload and a detail payload.
`useFinders(status)` produces `['admin','finders', status]` (`useFinders.ts:15`) while `useFinder(id)` produces `['admin','finders', id]` (`useFinders.ts:24`).
The factory fixes both by inserting an explicit `'detail'` / `'list'` segment.

### Test harness reality

There is no `@testing-library/*` dependency in the repo (`apps/web/package.json:41-59`).
`apps/web/vitest.config.ts:18-22` sets `environment: 'node'` with `include: ['src/**/__tests__/**/*.test.ts', 'src/**/__tests__/**/*.test.tsx']`.
DOM tests opt in with `// @vitest-environment happy-dom` on line 1 and render with `createRoot` from `react-dom/client` plus `React.act` reached through a cast (`apps/web/src/sales-ops/__tests__/areas-view.test.tsx:1-29`), then query the DOM by hand.
Dialog tests `vi.mock('@/components/ui/dialog')` into plain divs because Radix portals do not work in this harness (`areas-view.test.tsx:9-23`).
`apps/web/src/sales-ops/__tests__/routing.test.tsx:128-135` also strips `[data-radix-portal]` nodes in `afterEach`.
Non-DOM hook tests use `renderToString` from `react-dom/server` to capture a hook result under a real `QueryClientProvider` (`apps/web/src/admin/products/__tests__/useProducts.test.ts:30-51`).

`apps/web/src/sales-ops/__tests__/routing.test.tsx:57-83` `vi.mock`s the whole `../hooks` module, so it is insulated from these hook changes as long as no hook is renamed or removed.
`apps/web/src/admin/products/__tests__/useProducts.test.ts` asserts the literal keys `['admin','products','all']`, `['admin','products', app.id]`, `['admin','products','other-app']` and `invalidateQueries({ queryKey: ['admin','products'] })`, so `queryKeys.adminProducts.list()` and `.all` must stay byte-identical to today.

## Red

Four new test files. All four must fail before any implementation lands, and all four must pass after.

### 1. `apps/web/src/lib/__tests__/app-mutation.test.ts`

Node environment, no pragma. Uses the `renderToString` capture idiom from `apps/web/src/admin/products/__tests__/useProducts.test.ts:30-51` to obtain the mutation object under a real `QueryClientProvider`, plus `vi.spyOn(queryClient, 'invalidateQueries')`.

- `it('invalidates every declared query key after a successful mutation')` - a `useAppMutation` with `invalidates: [['a'], ['b','c']]` resolves, then `invalidateQueries` was called with `{ queryKey: ['a'] }` and with `{ queryKey: ['b','c'] }`.
- `it('invalidates every declared query key after a failed mutation')` - the same mutation rejects; `mutateAsync` rejects and both keys were still invalidated. This is the property that makes a failed optimistic write self-heal.
- `it('resolves a function invalidates spec against the mutation variables')` - `invalidates: ({ variables }) => [['x', variables.id]]` with `variables = { id: 'p1' }` invalidates `{ queryKey: ['x','p1'] }`.
- `it('runs a caller-supplied onSettled after invalidating')` - a caller `onSettled` spy is called exactly once with `(data, error, variables, context)` and the `invalidateQueries` spy call ordering precedes it.
- `it('does not invalidate anything for a NO_CACHE_EFFECT mutation')` - `invalidates: NO_CACHE_EFFECT` resolves and `invalidateQueries` was never called.
- `it('preserves onMutate context through to onError')` - `onMutate` returns `{ token: 1 }`, the mutation rejects, and `onError` receives that context. This guards the rollback path the sales-ops hooks depend on.

Oracle: `pnpm --filter @fxl-sales/web test -- --run src/lib/__tests__/app-mutation.test.ts`

### 2. `apps/web/src/sales-ops/__tests__/optimistic.test.ts`

Node environment, no pragma. Pure functions, no React.

- `it('inserts a new área into the snapshot ordered by name')` - snapshot with áreas `['Alfa','Zeta']`, payload `{ name: 'Meta', status: 'active' }`; result `areas.map(a => a.name)` equals `['Alfa','Meta','Zeta']` and the inserted row's `id` starts with `optimistic:`.
- `it('replaces the matching área when the payload carries an id')` - editing `Zeta` to `Beta` keeps `areas.length` at 2, keeps the original `id`, and reorders to `['Beta','Alfa']` sorted so `['Alfa','Beta']`.
- `it('does not touch other collections')` - after an área insert, `clients`, `products`, `people`, `sales`, `receivables`, `payables` are referentially the same arrays as the input snapshot.
- `it('reconciles the optimistic row with the persisted row')` - `reconcileOptimisticRow` swaps the `optimistic:` row for the server row, and no `optimistic:`-prefixed id remains.
- `it('rolls back an optimistic insert by dropping the optimistic row')`.
- `it('rolls back an optimistic edit by restoring the previous snapshot row')`.
- `it('inserts a new cliente ordered by name')` and `it('inserts a new pessoa ordered by displayName')` - the same three assertions for the other two collections.

Oracle: `pnpm --filter @fxl-sales/web test -- --run src/sales-ops/__tests__/optimistic.test.ts`

### 3. `apps/web/src/sales-ops/__tests__/cadastros-refresh.test.tsx`

`// @vitest-environment happy-dom` on line 1. This is the acceptance reproduction.
Renders the real `SalesOpsApp` inside a real `QueryClientProvider` and a `MemoryRouter`, mocking only three modules:

- `vi.mock('@/auth/react')` returning `useAuthProfile` (`{ isLoaded: true, isSignedIn: true, roles: ['admin'], name: 'Test User', email: 'test.user@fxl.example' }`), `useLogout` (`vi.fn(async () => undefined)`) and `useAccessToken` (`() => ({ getToken: async () => 'test-token' })`).
- `vi.mock('@/components/ui/dialog')` into plain divs, copied verbatim from `areas-view.test.tsx:9-23`.
- `vi.mock('../api')` exporting `salesOpsApi` with `vi.fn()` for all ten methods (`bootstrap`, `savePerson`, `saveProduct`, `saveClient`, `saveArea`, `createSale`, `updateSale`, `transitionSale`, `cancelContract`, `saveSettings`).

`QueryClient` is created per test with `{ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }`.
Routes mirror `routing.test.tsx:149-152` (`/` and `/:workspace/:view`), initial entry `/cadastros/areas` or `/cadastros/produtos`.
`afterEach` unmounts, removes the container and strips `[data-radix-portal]` nodes, as in `routing.test.tsx:128-135`.
Use the `createDeferred` helper shape from `useProducts.test.ts:53-61` so each `bootstrap` / `saveArea` / `saveProduct` resolution is controlled by the test.

- `it('shows a new área in the list before the create POST resolves')` - bootstrap call 1 resolves with an empty snapshot; the empty panel text `Nenhuma área cadastrada` is on screen; click `Nova área`, type `FXL BPO Sales` into the dialog name input, dispatch `submit` on the form; while the deferred `saveArea` promise is still pending, the document text contains `FXL BPO Sales` and no longer contains `Nenhuma área cadastrada`. This is the acceptance sentence and it fails today.
- `it('keeps exactly one row for the new área after the POST and the refetch resolve')` - continue the previous scenario, resolve `saveArea` with `{ area: <server row, uuid id> }`, resolve bootstrap call 2 with `{ areas: [serverRow], ... }`, then assert the table has exactly one `tr` in `tbody` and no element text starts with `optimistic:`.
- `it('removes the optimistic área row when the create request fails')` - reject the deferred `saveArea`; after settle the table is gone and `Nenhuma área cadastrada` is back, and the dialog is still on screen so the typed name is not lost.
- `it('shows a new produto in the list once the create POST resolves, with no further user action')` - initial entry `/cadastros/produtos`, bootstrap call 1 returns one área and no produtos; open `Novo produto`, fill `Nome` and the `Área do produto` select (selectors as in `areas-view.test.tsx:242-251`), submit; resolve `saveProduct`; resolve bootstrap call 2 with the created produto; assert the produto name is on screen. `saleOpsApi.bootstrap` must have been called exactly twice, proving the refresh came from the mutation and not from the test.
- `it('discloses the pending refresh while the bootstrap refetch is in flight')` - between resolving `saveProduct` and resolving bootstrap call 2, the header contains `Atualizando`.

Oracle: `pnpm --filter @fxl-sales/web test -- --run src/sales-ops/__tests__/cadastros-refresh.test.tsx`

### 4. `apps/web/src/sales-ops/__tests__/sale-wizard-state-preservation.test.tsx`

`// @vitest-environment happy-dom` on line 1. Mirrors the fixture and mock setup of `apps/web/src/sales-ops/__tests__/sale-wizard-payment-plan.test.tsx` (same dialog mock, same bootstrap fixture builder).

The step-1 cliente field is the probe. It is `container.querySelector('input[placeholder="Buscar ou digitar um novo cliente..."]')` (`SalesOpsApp.tsx:4198-4209`) and its `value` is the wizard's `clientName` state, seeded from `bootstrap.clients[0]`.

- `it('keeps typed wizard state when a bootstrap refetch changes the first cliente')` - render `SaleWizardDialog` with `open`, `editSale: null` and a bootstrap whose clients are `[Zeta]`; drive the cliente input to `Cliente Digitado` with the `changeInput` helper from `sale-wizard-payment-plan.test.tsx:52-58`; call `root.render` again with the same element but a bootstrap whose clients are `[Alfa, Zeta]`; assert the input `value` is still `Cliente Digitado`. Today it resets to `Alfa` because `SalesOpsApp.tsx:3644` folds `clients[0]?.id` into the `key`.
- `it('keeps typed wizard state when a bootstrap refetch changes the people count')` - same shape, appending one pessoa to `bootstrap.people`, which today flips the `people.length` segment of the same `key`.

Oracle: `pnpm --filter @fxl-sales/web test -- --run src/sales-ops/__tests__/sale-wizard-state-preservation.test.tsx`

### Full gate

`pnpm run lint && pnpm run type-check && CI=true pnpm test` must all exit 0.

## Green

### Step 1 - create `apps/web/src/lib/query-keys.ts`

One exported `queryKeys` object. Every tuple is `as const`.
`adminProducts.all` and `adminProducts.list()` must stay byte-identical to today because `useProducts.test.ts` asserts them literally.

```ts
import type { FinderStatus } from '@/admin/types';
import type { CommissionStatus } from '@/lib/api-client';

type CommissionFilters = { status?: CommissionStatus; finderId?: string } | undefined;
type ConversionFilters = { source?: string; finderId?: string } | undefined;

export const queryKeys = {
  salesOps: {
    all: ['sales-ops'] as const,
    bootstrap: () => ['sales-ops', 'bootstrap'] as const,
  },
  adminApps: {
    all: ['admin', 'apps'] as const,
    list: () => ['admin', 'apps'] as const,
    detail: (id: string) => ['admin', 'apps', 'detail', id] as const,
  },
  adminProducts: {
    all: ['admin', 'products'] as const,
    // keep the `appId ?? 'all'` shape: useProducts.test.ts asserts it literally
    list: (appId?: string) => ['admin', 'products', appId ?? 'all'] as const,
    detail: (id: string) => ['admin', 'products', 'detail', id] as const,
  },
  adminSellers: {
    all: ['admin', 'sellers'] as const,
    list: () => ['admin', 'sellers'] as const,
  },
  adminFinders: {
    all: ['admin', 'finders'] as const,
    list: (status?: FinderStatus) => ['admin', 'finders', 'list', status ?? 'all'] as const,
    detail: (id: string) => ['admin', 'finders', 'detail', id] as const,
  },
  adminCommissions: {
    all: ['admin', 'commissions'] as const,
    list: (filters: CommissionFilters) => ['admin', 'commissions', 'list', filters ?? null] as const,
  },
  adminConversions: {
    all: ['admin', 'conversions'] as const,
    list: (filters: ConversionFilters) => ['admin', 'conversions', 'list', filters ?? null] as const,
  },
  adminAudit: {
    all: ['admin', 'audit'] as const,
    list: (page: number, action?: string) => ['admin', 'audit', 'list', page, action ?? 'all'] as const,
  },
  payouts: {
    all: ['payouts'] as const,
    findersReady: () => ['payouts', 'finders-ready'] as const,
    list: () => ['payouts', 'list'] as const,
  },
  finderLinks: {
    all: ['finder', 'links'] as const,
    list: () => ['finder', 'links'] as const,
  },
  finderCatalog: {
    all: ['finder', 'apps'] as const,
    apps: () => ['finder', 'apps'] as const,
    products: (appId?: string) => ['finder', 'apps', appId ?? 'all', 'products'] as const,
  },
  finderClicks: {
    all: ['finder', 'clicks'] as const,
    list: (linkId?: string) => ['finder', 'clicks', 'list', linkId ?? 'all'] as const,
    stats: () => ['finder', 'clicks', 'stats'] as const,
  },
} as const;
```

If importing `CommissionStatus` / `FinderStatus` into this module creates an import cycle with `@/lib/api-client`, widen those two parameters to `string | undefined` rather than restructuring api-client. Nothing else in the factory may change.

### Step 2 - create `apps/web/src/lib/app-mutation.ts`

```ts
import {
  useMutation,
  useQueryClient,
  type QueryKey,
  type UseMutationOptions,
  type UseMutationResult,
} from '@tanstack/react-query';

/**
 * Sentinel for mutations that change nothing the query cache holds - blob
 * downloads and read-only server verifications. Anything that writes a row
 * MUST list the keys it owns instead.
 */
export const NO_CACHE_EFFECT = Symbol('no-cache-effect');

/** Non-empty on purpose: `invalidates: []` must not type-check. */
type NonEmptyKeys = readonly [QueryKey, ...QueryKey[]];

export type InvalidateSpec<TData, TVariables> =
  | NonEmptyKeys
  | ((context: { variables: TVariables; data: TData | undefined }) => readonly QueryKey[])
  | typeof NO_CACHE_EFFECT;

export type AppMutationOptions<TData, TError, TVariables, TContext> =
  UseMutationOptions<TData, TError, TVariables, TContext> & {
    /**
     * Query keys this mutation owns. Every listed key is invalidated by prefix
     * match after the mutation settles - on success AND on failure, so a rolled
     * back optimistic write always re-syncs with the server.
     */
    invalidates: InvalidateSpec<TData, TVariables>;
  };

export function useAppMutation<TData = unknown, TError = Error, TVariables = void, TContext = unknown>(
  options: AppMutationOptions<TData, TError, TVariables, TContext>,
): UseMutationResult<TData, TError, TVariables, TContext> {
  const queryClient = useQueryClient();
  const { invalidates, onSettled, ...rest } = options;
  return useMutation<TData, TError, TVariables, TContext>({
    ...rest,
    onSettled: (data, error, variables, context) => {
      if (invalidates !== NO_CACHE_EFFECT) {
        const keys = typeof invalidates === 'function' ? invalidates({ variables, data }) : invalidates;
        for (const queryKey of keys) {
          void queryClient.invalidateQueries({ queryKey });
        }
      }
      return onSettled?.(data, error, variables, context);
    },
  });
}
```

Two notes for the executor.
`useMutation` is imported here and nowhere else; step 10 enforces that with ESLint.
Invalidation moves from `onSuccess` to `onSettled` deliberately, so a failed mutation also re-syncs.

### Step 3 - create `apps/web/src/sales-ops/optimistic.ts`

Pure functions over a `SalesOpsBootstrap` snapshot. No React, no `QueryClient`.

```ts
import type {
  SalesOpsArea,
  SalesOpsBootstrap,
  SalesOpsClient,
  SalesOpsPerson,
} from './types';
import type { SaveAreaPayload, SaveClientPayload, SavePersonPayload } from './api';

export const OPTIMISTIC_ID_PREFIX = 'optimistic:';

export function isOptimisticId(id: string): boolean;
export function optimisticId(collection: string, seed: string): string; // `${OPTIMISTIC_ID_PREFIX}${collection}:${seed}`

/** pt-BR collation so the optimistic order matches the server `ORDER BY name`. */
function byLabel<T>(label: (row: T) => string) {
  return (a: T, b: T) => label(a).localeCompare(label(b), 'pt-BR');
}

export type OptimisticPatch = {
  /** the snapshot to write into the cache during onMutate */
  next: SalesOpsBootstrap;
  /** the untouched snapshot, for onError rollback */
  previous: SalesOpsBootstrap;
  /** the id of the row that was inserted or edited */
  rowId: string;
};

export function optimisticArea(
  previous: SalesOpsBootstrap,
  payload: SaveAreaPayload,
): OptimisticPatch;

export function optimisticClient(
  previous: SalesOpsBootstrap,
  payload: SaveClientPayload,
): OptimisticPatch;

export function optimisticPerson(
  previous: SalesOpsBootstrap,
  payload: SavePersonPayload,
): OptimisticPatch;

/** Swap the optimistic row for the row the server returned. */
export function reconcileOptimisticRow<K extends 'areas' | 'clients' | 'people'>(
  snapshot: SalesOpsBootstrap,
  collection: K,
  rowId: string,
  persisted: SalesOpsBootstrap[K][number],
  label: (row: SalesOpsBootstrap[K][number]) => string,
): SalesOpsBootstrap;
```

Row construction rules, exhaustive so the executor decides nothing:

- New row `id` is `optimisticId(collection, payload.name ?? payload.displayName)`.
- `orgId` is copied from the first existing row of the same collection, else `''`. It is never rendered anywhere (CLAUDE.md UI Identifiers), so a placeholder is correct.
- `createdAt` is `new Date().toISOString()`, `updatedAt` is `null`.
- Área: `name: payload.name`, `status: payload.status ?? 'active'`.
- Cliente: `name: payload.name`, and `contact`, `legalName`, `document`, `address`, `legalRepName`, `legalRepDocument` each `payload.<field> ?? null`.
- Pessoa: `displayName: payload.displayName`, `contactEmail: payload.contactEmail ?? null`, `status: payload.status ?? 'active'`, `isSeller`, `isFinder`, `isCollaborator` each `payload.<flag> ?? false`.
- Edit (`payload.id` present): merge the payload over the existing row, keep `id`, `orgId` and `createdAt`, leave `updatedAt` untouched.
- After insert or edit, re-sort the collection with `byLabel` (`name` for áreas / clientes, `displayName` for pessoas) so the optimistic position matches the server ordering at `apps/api/src/domains/sales-ops/service.ts:1307-1322` and `1332-1336`.
- Every other collection in the snapshot must be carried over by reference, untouched.

### Step 4 - rewrite `apps/web/src/sales-ops/hooks.ts`

1. Delete the local `salesOpsKeys` (`hooks.ts:14-17`) and import `queryKeys` instead. Keep a named export `export const salesOpsKeys = queryKeys.salesOps;` only if type-check reports an outside importer - a repo grep shows none, so prefer deleting it.
2. Hoist the selector out of the hook so its identity is stable:

```ts
function selectSalesOpsBootstrap(data: SalesOpsBootstrap): SalesOpsBootstrap {
  return { /* the exact body of hooks.ts:28-39, unchanged */ };
}

export function useSalesOpsBootstrap() {
  const { getToken } = useAccessToken();
  return useQuery({
    queryKey: queryKeys.salesOps.bootstrap(),
    queryFn: async () => salesOpsApi.bootstrap(await requireToken(getToken)),
    select: selectSalesOpsBootstrap,
  });
}
```

3. Delete `useInvalidateSalesOps` (`hooks.ts:43-46`). `useAppMutation` owns invalidation now.
4. Add one shared optimistic helper used by the three optimistic hooks:

```ts
type OptimisticCollection = 'areas' | 'clients' | 'people';

function useOptimisticBootstrapWrite<TPayload extends { id?: string }>(
  collection: OptimisticCollection,
  build: (previous: SalesOpsBootstrap, payload: TPayload) => OptimisticPatch,
  label: (row: never) => string,
) { /* returns { onMutate, onError, onSuccess } wired against queryKeys.salesOps.bootstrap() */ }
```

Its `onMutate(payload)` must:
- `await queryClient.cancelQueries({ queryKey: queryKeys.salesOps.all })` first, exactly as the house pattern does at `apps/web/src/admin/products/useProducts.ts:181`, so an in-flight snapshot fetch cannot land on top of the optimistic write;
- read the raw cache entry with `queryClient.getQueryData<SalesOpsBootstrap>(queryKeys.salesOps.bootstrap())`, and return `undefined` (no optimistic write) when it is absent - `select` runs on top of the raw payload, so `setQueryData` writes the raw shape;
- `setQueryData(queryKeys.salesOps.bootstrap(), patch.next)` and return `patch` as the mutation context.

Its `onError(_error, _payload, context)` restores `context.previous` with `setQueryData`.
Its `onSuccess(response, _payload, context)` calls `reconcileOptimisticRow` with the row the server returned (`response.area` / `response.client` / `response.person`) so the real id and timestamps land immediately, before the invalidated refetch arrives.

5. Convert all nine hooks from `useMutation` to `useAppMutation` with the `invalidates` values in the inventory table. The three optimistic hooks (`useSaveSalesOpsArea`, `useSaveSalesOpsClient`, `useSaveSalesOpsPerson`) additionally spread the helper's `onMutate` / `onError` / `onSuccess`.
6. On the six non-optimistic hooks, add a one-line comment stating why there is no optimistic write. For `useCreateSalesOpsSale`, `useUpdateSalesOpsSale`, `useTransitionSalesOpsSale` and `useCancelSalesOpsContract` the reason is that the server materialises receivables and payables with the `"N/M"` and `"MN/M"` label conventions plus `code`, `sequence`, `sellerCommissionBrl`, `finderCommissionBrl`, `taxBrl` and `netMarginBrl`, none of which the client can compute. For `useSaveSalesOpsProduct` the reason is that `SalesOpsProduct.type` is dropped from the payload (`api.ts:22-37`) and the three commission values are re-serialised by Postgres `numeric` (`apps/api/src/domains/sales-ops/service.ts:669-686`). For `useSaveSalesOpsSettings` the reason is the same numeric re-serialisation plus the `updatedAt`-keyed remount at `SalesOpsApp.tsx:1087`.

Public hook names and signatures must not change - `routing.test.tsx:57-83` mocks this module by name.

### Step 5 - `apps/web/src/sales-ops/SalesOpsApp.tsx`

Three surgical edits.

1. Fix the wizard remount bug at line 3644. Replace the composite key with the wizard session identity only:

```tsx
<SaleWizardDialogBody
  key={props.editSale?.id ?? 'create'}
  ...
/>
```

This is safe because `SaleWizardDialog` returns `null` when `!props.open` (line 3640), which unmounts the body, so re-opening the wizard already remounts it. The only in-flight identity change worth remounting on is switching which proposta is being edited, and that cannot happen without closing the dialog first.

2. Do not mount the wizard before the snapshot has loaded, so the body still seeds its defaults from real data. Wrap the `<SaleWizardDialog .../>` element at lines 1133-1149:

```tsx
{bootstrapQuery.isSuccess ? (
  <SaleWizardDialog ... />
) : null}
```

3. Disclose the pending refresh instead of silently showing stale rows. Add to the header action cluster at line 930, before the `headerAction` block:

```tsx
{bootstrapQuery.isFetching && !bootstrapQuery.isLoading ? (
  <span
    aria-live="polite"
    className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#8b8b92]"
  >
    <Loader2 className="h-[13px] w-[13px] animate-spin" />
    Atualizando
  </span>
) : null}
```

`Loader2` is already imported (used by `LoadingPanel` at line 494). The string is pt-BR. Do not touch any other string in this file.

### Step 6 - `apps/web/src/admin/apps/useApps.ts`

Replace `useMutation`/`useQueryClient` with `useAppMutation`, and the inline keys with `queryKeys.adminApps`.
Fill the two missing invalidations at lines 59-64 and 66-72: both rotations now invalidate `[queryKeys.adminApps.all, queryKeys.adminApps.detail(variables)]`.
Delete the stale comment at lines 57-58 that justified having none, and replace it with a one-liner saying the rotation refreshes the app row because the stored secret metadata changed.
`useAdminApps` keeps `queryKeys.adminApps.list()`.

### Step 7 - `apps/web/src/admin/products/useProducts.ts`

Route every key through `queryKeys.adminProducts`.
`productListQueryMatchesApp` (line 47) must additionally return `false` when `queryKey[2] === 'detail'`, so a detail entry is never mistaken for a list.
`useAdminProduct` (line 168) moves to `queryKeys.adminProducts.detail(id)`; `useUpsertPriceBand` and `useUpsertCommissionRule` invalidate that same detail key.
`useCreateProduct` keeps its optimistic body verbatim; only `useMutation` becomes `useAppMutation`, `invalidates: [queryKeys.adminProducts.all]`, and its explicit `onSettled` at lines 190-192 is deleted because the wrapper now owns it. Its `onMutate`, `onSuccess` and `onError` stay exactly as they are.

### Step 8 - remaining hook modules

Mechanical, one file at a time, no behaviour change beyond the table:
`apps/web/src/admin/audit/useAuditLog.ts` (`queryKeys.adminAudit`, `useVerifyChain` gets `NO_CACHE_EFFECT` plus a one-line reason),
`apps/web/src/admin/commissions/useAdminCommissions.ts` (`queryKeys.adminCommissions`),
`apps/web/src/admin/conversions/useConversions.ts` (`queryKeys.adminConversions`, query only),
`apps/web/src/admin/finders/hooks/useFinders.ts` (`queryKeys.adminFinders`, list/detail now disambiguated),
`apps/web/src/admin/payouts/usePayouts.ts` (`queryKeys.payouts`, `useDownloadPayoutCsv` gets `NO_CACHE_EFFECT` plus a one-line reason),
`apps/web/src/admin/sellers/hooks/useSellers.ts` (`queryKeys.adminSellers`),
`apps/web/src/finder/clicks/useClicks.ts` (`queryKeys.finderClicks`, query only),
`apps/web/src/finder/links/useLinks.ts` (`queryKeys.finderLinks` and `queryKeys.finderCatalog`).

### Step 9 - write the four test files from `## Red`

### Step 10 - `apps/web/eslint.config.js`

Append a second config object so the wrapper is the only door:

```js
{
  files: ['**/*.{ts,tsx}'],
  ignores: ['src/lib/app-mutation.ts'],
  rules: {
    'no-restricted-imports': ['error', {
      paths: [{
        name: '@tanstack/react-query',
        importNames: ['useMutation'],
        message:
          'Use useAppMutation from @/lib/app-mutation. It requires an `invalidates` query-key list so a new mutation cannot ship without refreshing the cache it owns.',
      }],
    }],
  },
}
```

`ignores` paths in flat config resolve relative to the config file, so `src/lib/app-mutation.ts` is correct for `apps/web/eslint.config.js`.
Verify with `pnpm --filter @fxl-sales/web lint`.

### Step 11 - run the full gate

`pnpm run lint`, `pnpm run type-check`, `CI=true pnpm test`.

## Refactor

- Delete `useInvalidateSalesOps` and the local `salesOpsKeys` once nothing references them; leave no compatibility alias behind.
- Delete the now-redundant explicit `onSettled` in `useCreateProduct` (`useProducts.ts:190-192`) and the two obsolete comment blocks that document hand-rolled invalidation (`apps/web/src/admin/payouts/usePayouts.ts:9-14`, `apps/web/src/admin/finders/hooks/useFinders.ts:6-10`), replacing each with a single line pointing at the `invalidates` declaration as the source of truth.
- Confirm with `grep -rn "invalidateQueries" apps/web/src` that the only remaining occurrence outside tests is inside `apps/web/src/lib/app-mutation.ts`.
- Confirm with `grep -rn "queryKey: \[" apps/web/src` that no inline key literal survives outside `apps/web/src/lib/query-keys.ts` and the tests.

## Out of scope

- Splitting `GET /api/v1/sales-ops/bootstrap` into per-collection endpoints, or adding per-collection query keys under `queryKeys.salesOps`. The whole sales-ops UI reads one query today; changing that is a separate slice.
- Any API change. This slice touches `apps/api` not at all.
- Optimistic writes for produtos, settings, or any sale mutation. Reasons are recorded inline in step 4.6.
- The dialog outside-click behaviour (slice 02), the Combobox primitive (slice 03), and every Pessoas/Funções or Produtos & Serviços change (slices 05, 07, 09, 10).
- The legacy route trees `/admin/*`, `/finder/*`, `/seller/*` and `/no-role` keep their routing untouched; only the hook internals under `apps/web/src/admin` and `apps/web/src/finder` change.
- No i18n extraction. The one new string, `Atualizando`, stays inline in pt-BR like its neighbours.

## Risks

- **`useProducts.test.ts` depends on literal key tuples.** It asserts `['admin','products','all']`, `['admin','products', app.id]`, `['admin','products','other-app']` and `invalidateQueries({ queryKey: ['admin','products'] })` (`useProducts.test.ts:128-131`, `:173`). Avoided by keeping `queryKeys.adminProducts.all` and `.list()` byte-identical and by moving only the detail key, which that test never touches.
- **`sale-wizard-ui-contract.test.ts` is a source-text test.** It `readFileSync`s `SalesOpsApp.tsx` and asserts about 25 literal substrings plus 6 negative assertions (`sale-wizard-ui-contract.test.ts:10-37`). Avoided because step 5 only changes a `key` expression, adds a `bootstrapQuery.isSuccess` guard, and adds the word `Atualizando`, none of which collide with an asserted or forbidden substring. The executor must re-run this test after step 5 regardless.
- **`routing.test.tsx` mocks the whole `../hooks` module by hook name** (`routing.test.tsx:57-83`). Avoided by keeping all nine hook names and signatures unchanged. Renaming or removing an export would silently make that mock incomplete.
- **`cancelQueries` on the initial load.** If `onMutate` cancels an in-flight first bootstrap fetch, the query has no data to fall back on. Avoided because `onMutate` returns early without an optimistic write when the cache entry is absent, and because the wrapper's `onSettled` invalidation re-triggers the fetch either way. This mirrors the house pattern at `useProducts.ts:181`.
- **Optimistic ordering drifts from the server.** JS `localeCompare(b, 'pt-BR')` is not bit-identical to the Postgres collation used by `ORDER BY name`. Accepted: the optimistic row is replaced by server truth on the very next refetch, so at worst a row shifts one position for one round trip. Documented in `optimistic.ts`.
- **`invalidates: []` as an escape hatch.** Mitigated structurally: the array branch is typed as a non-empty tuple so `[]` does not compile, and the deliberate opt-out is the named, greppable `NO_CACHE_EFFECT` sentinel. A function spec could still return an empty array; that residual hole is accepted as the cost of supporting variable-dependent keys.
- **Moving invalidation from `onSuccess` to `onSettled` fires a refetch after failures too.** That is intended (it re-syncs a rolled back optimistic write) and cheap, but it does mean a failing mutation now issues one extra GET. Accepted.
- **Atomicity.** This lands as one commit. It is a single rail: the key factory, the wrapper, the ESLint ban and every call-site migration have to move together, because the ESLint rule fails the build the moment one module still imports `useMutation` directly, and the wrapper is useless without call sites. If the executor finds the diff unreviewable, the only defensible split is (a) `query-keys.ts` + `app-mutation.ts` + their unit tests + migration of all 29 hook sites + the ESLint rule, then (b) `optimistic.ts` + the three optimistic sales-ops hooks + the wizard-key fix + the `Atualizando` affordance + the two DOM test files. Both halves are independently green and (b) depends on (a). Do not split any other way.
