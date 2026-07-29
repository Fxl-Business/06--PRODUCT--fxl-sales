# Verify (Gate 2) - slice 01-query-cache-refresh

Branch `feat/01-query-cache-refresh`, single commit `482d499` on top of `master` (`7e8cb0f`).
Verdict: **PASS**.

## 1. Gates

All three run from the repo root, on the branch, with a clean tree apart from untracked `nexo/` bookkeeping and `.vscode/`.

| Gate | Command | Exit |
| --- | --- | --- |
| lint | `pnpm run lint` | 0 |
| type-check | `pnpm run type-check` | 0 |
| test | `CI=true pnpm test` | 0 |

Full-suite counts (not a subset):

```
packages/shared-utils   Test Files  1 passed (1)    Tests  17 passed (17)
apps/api                Test Files 23 passed (23)   Tests 215 passed (215)
apps/web                Test Files 25 passed (25)   Tests 143 passed (143)
```

The `pnpm test` tracked-file guard for the removed auth provider ran and passed as part of the suite.

## 2. Is the acceptance criterion genuinely met?

Acceptance: empty `cadastros/areas`, submit Nova área, row visible **before** the POST resolves, still present **exactly once** after POST + bootstrap refetch, **removed** if the POST fails; and `cadastros/produtos` reflects its create once the POST resolves with no manual reload and no user-triggered refetch.

The evidence lives in `apps/web/src/sales-ops/__tests__/cadastros-refresh.test.tsx`.
This is a real integration test, not a unit stub: it mounts the actual `SalesOpsApp` under a `MemoryRouter` at `/cadastros/areas` and `/cadastros/produtos` with a real `QueryClient`, and mocks only `../api` (the HTTP layer) and `@/auth/react`.
`salesOpsApi.bootstrap` is a deferred-promise factory, so every fetch and every POST is resolved by hand at an exact point in the timeline. That is what makes the "before the POST resolves" assertion meaningful rather than incidental.

| Acceptance clause | Test | Would it fail if the implementation were reverted? |
| --- | --- | --- |
| visible before POST resolves | `shows a new área in the list before the create POST resolves` (l.266) | **Yes.** The `saveArea` deferred is never resolved. Without the `onMutate` optimistic write in `useOptimisticBootstrapWrite`, the cache still holds `areas: []`, so `AreasView` (`SalesOpsApp.tsx`) renders the `EmptyPanel`. Both assertions - `toContain('FXL BPO Sales')` and `not.toContain('Nenhuma área cadastrada')` - invert. |
| exactly one row after POST + refetch | `keeps exactly one row for the new área after the POST and the refetch resolve` (l.283) | Partially. `toHaveLength(1)` on `tbody tr` does hold, but see the test-strength note below: it would also pass without the `onSuccess` reconcile step, because the refetch replaces the whole snapshot. It is still a valid guard against duplication. |
| removed if POST fails | `removes the optimistic área row when the create request fails` (l.306) | **Yes.** The deferred is rejected. Without the `onError` rollback the optimistic row stays (the invalidated refetch is deliberately left unresolved), so `toHaveLength(0)` and `toContain('Nenhuma área cadastrada')` both invert. It additionally pins that the dialog stays open with the typed name intact. |
| produtos reflects the create, no manual reload, no user-triggered refetch | `shows a new produto in the list once the create POST resolves, with no further user action` (l.329) | This one is a regression guard rather than new-behaviour proof - `master` already invalidated in `onSuccess`, so it would pass on `master` too. It is nonetheless a genuine assertion of the clause: `bootstrap` is asserted to have been called exactly 2 times, and the second call's resolution is what puts the produto on screen, with no click or reload in between. |

Additional, genuinely new-behaviour tests:

- `discloses the pending refresh while the bootstrap refetch is in flight` (l.355) pins the new "Atualizando" header affordance. Fails on `master` (the element does not exist).
- `apps/web/src/sales-ops/__tests__/sale-wizard-state-preservation.test.tsx` (2 tests) pins the wizard `key` fix. Fails on `master`, whose key folded `clients[0].id`, `products[0].id` and `people.length`; re-rendering with a changed first cliente or a changed people count remounted `SaleWizardDialogBody` and wiped the typed value. Both tests assert the typed cliente survives. This is a real, more severe bug that the broader invalidation would otherwise have made worse, so fixing it here is correct.
- `apps/web/src/lib/__tests__/app-mutation.test.ts` (6 tests) pins the rail: invalidation on success **and** on failure, function-form `invalidates` resolved against variables, invalidation strictly before a caller-supplied `onSettled` (asserted via `invocationCallOrder`), `NO_CACHE_EFFECT` invalidating nothing, and `onMutate` context surviving to `onError`. Each spies on the real `QueryClient.invalidateQueries`, so none of these can pass vacuously.
- `apps/web/src/sales-ops/__tests__/optimistic.test.ts` (8 tests) covers the pure patch functions: insertion ordered by pt-BR name, edit-by-id replacement, non-mutation of sibling collections (asserted by reference identity, `toBe`), reconcile removing the optimistic id, and rollback for both insert and edit.

Conclusion: **acceptance proven**. The optimistic clause and the rollback clause are both proven by tests that demonstrably invert on revert.

## 3. Anti-gaming

`git diff master..feat/01-query-cache-refresh --name-status` shows **zero** modified test files. The only entries under a test path are four `A` (added) files:

```
A apps/web/src/lib/__tests__/app-mutation.test.ts
A apps/web/src/sales-ops/__tests__/cadastros-refresh.test.tsx
A apps/web/src/sales-ops/__tests__/optimistic.test.ts
A apps/web/src/sales-ops/__tests__/sale-wizard-state-preservation.test.tsx
```

`git diff --stat master..feat/01-query-cache-refresh -- '*test*'` is `4 files changed, 901 insertions(+)` - no deletions anywhere in test code.

Counts reconcile exactly:

- web files: 21 (`master`) + 4 added = 25 (branch). Matches.
- web tests: 122 (`master`) + 21 new (6 + 8 + 5 + 2) = 143 (branch). Matches to the test.
- api: 23 files / 215 tests on both sides; the branch touches no api file at all.

No `.only`, `.skip`, `xit`, `xdescribe`, `@ts-expect-error`, `@ts-ignore` or `eslint-disable` was added anywhere in the diff (grepped over added lines). No `as any` or `: any` was added. `git stash list` is empty and there are no extra worktrees.

The one pre-existing test whose contract could have been silently broken is `apps/web/src/admin/products/__tests__/useProducts.test.ts`, which asserts the literal key tuples `['admin','products']` and `['admin','products', appId ?? 'all']`. The new `queryKeys.adminProducts.all` / `.list()` are byte-identical to those tuples and the test file is untouched and still green, so the key factory was fitted to the existing test rather than the test loosened to the factory.

**tests_weakened: none.**

## 4. Scope discipline

Scope limits from `nexo/plans/batch-01K9C0FXA7RQ8VZTN3KDM6WS4E/00-OVERVIEW.md`, checked one by one against the diff:

- Propostas status machine, payables/receivables materialization, `"N/M"` / `"MN/M"` label conventions: **untouched**. `deriveWizardPrefill` is not in the diff. `apps/api/` is not in the diff at all. `useTransitionSalesOpsSale` / `useCancelSalesOpsContract` / `useCreateSalesOpsSale` only swap `onSuccess: invalidate` for `invalidates: [queryKeys.salesOps.all]`, with an explicit comment that they take no optimistic write precisely because the ledger is server-derived. Same effective refresh, no rule change.
- Hub auth model, tenancy filtering, `AppRole` visibility in `navigation.ts`: **untouched**. `navigation.ts`, `apps/web/src/auth/**` and every api route are absent from the diff. Nothing changes which rows a request returns.
- Legacy route trees `/admin/*`, `/finder/*`, `/seller/*`, `/no-role`: **untouched as routes**. The diff does edit hook files under `apps/web/src/admin/**` and `apps/web/src/finder/**`, but only their query keys and mutation wiring - no route definition, no page component, no `AppRole` gate. All eleven of those files are explicitly enumerated in the slice plan's `files_modified`, and the plan's mutation inventory lists every hook and its target `invalidates`. The diff matches that inventory item for item, including the two `NO_CACHE_EFFECT` opt-outs (#15 `useVerifyChain`, #22 `useDownloadPayoutCsv`) and the two rotation hooks (#13/#14) that previously refreshed nothing.
- No i18n extraction: the one new string ("Atualizando") is hardcoded pt-BR next to the existing hardcoded pt-BR, consistent with the limit.
- No new charting/reporting/export surface: none added.

The three `SalesOpsApp.tsx` hunks are the header refresh indicator, gating `SaleWizardDialog` behind `bootstrapQuery.isSuccess`, and the wizard `key` simplification. Nothing else in that 3.7k-line file moved.

**scope_ok: yes.**

## 5. Correctness review

Checked and found sound:

- **Rollback.** `onError` restores `patch.previous`, which is the exact object read out of the cache in `onMutate` (`optimistic.test.ts` asserts `patch.previous` is reference-identical to the input snapshot, so the patch builders provably never mutate in place). Pinned end to end by the failing-POST test.
- **Reconciliation.** Ordering is correct and load-bearing: TanStack fires the hook-level `onSuccess` (reconcile, swapping the optimistic row for the server row via `upsert` keyed on `patch.rowId`) before the `mutate()`-scoped `onSuccess` (`setModal(null)`), and `useAppMutation` puts invalidation in `onSettled`, which runs after both. So the real id lands in the cache before the dialog closes and before the refetch starts.
- **No duplication.** `upsert` replaces in place when `rows.some(row => row.id === rowId)`, appends otherwise. The reconcile path always hits the replace branch because `rowId` is the optimistic id still present in the cache.
- **No missing invalidation.** `grep` confirms zero remaining direct `useMutation` imports outside `lib/app-mutation.ts`, zero literal `queryKey:` tuples left in `apps/web/src` outside tests, and `invalidateQueries` called from exactly one place (the rail). The ESLint `no-restricted-imports` rule makes the bypass a build error rather than a convention. The `invalidates` type is a non-empty tuple, so `invalidates: []` does not type-check - a new mutation cannot ship without either declaring keys or naming `NO_CACHE_EFFECT`.
- **Prefix matching.** `queryKeys.salesOps.all = ['sales-ops']` prefix-matches `['sales-ops','bootstrap']`; `adminProducts.all = ['admin','products']` matches both `list()` and `detail()`; `payouts.all` matches both payout lists (a strict superset of the two explicit invalidations it replaced). Every replacement is equal-or-broader, never narrower.
- **Latent key collisions fixed, not introduced.** `adminFinders.list(status)` gained a `'list'` segment and `adminFinders.detail(id)` / `adminProducts.detail(id)` gained a `'detail'` segment, removing the real possibility of a list key colliding with a detail key. The matching guard `productListQueryMatchesApp` was correctly updated to exclude the `'detail'` segment - without that line the optimistic admin-products create would have tried to patch a detail cache entry as if it were a list.
- **Raw ids in UI.** No new raw account or workspace id is rendered. `orgId` is never rendered anywhere in `SalesOpsApp.tsx`; the optimistic row borrows `orgId` from a sibling row and falls back to `''` for a first row, which is invisible by construction. `AreasView` renders only `name`, `status` and a derived product count. The test asserts `not.toContain('optimistic:')` on the whole container.
- **Tenancy / visibility.** No change. All filtering stays server-side; the diff contains no api change and no role logic.
- **No suppressions.** No new `any`, no `@ts-expect-error`, no swallowed errors. The casts in `reconcileOptimisticRow` are type-level narrowing inside a discriminating `if (collection === ...)` chain, sound at runtime.
- **`select` stability.** Hoisting `selectSalesOpsBootstrap` out of the hook restores TanStack's per-selector memo, which the previous inline arrow defeated. This is a real improvement, not a behaviour change - the function body is byte-for-byte the old one.
- **Commit hygiene.** Exactly one commit. Conventional Commit subject (`feat(web): ...`). Author is `CauetPinciara <cauetpinciara@gmail.com>`; no co-author trailer, no AI attribution. Zero em dash characters on any added line - the only two em dashes the diff touches are on **removed** lines in `useAdminCommissions.ts` and `usePayouts.ts`, i.e. the slice removes em dashes rather than adding them. The commit message body is em-dash-free.

### Non-blocking follow-ups (reported, not blocking the merge)

1. **An optimistic id can escape into an edit request through a narrow race.** `isOptimisticId` is exported from `sales-ops/optimistic.ts` but never used in production code. `AreaDialogBody` renders `<Dialog onOpenChange={(open) => (!open ? onClose() : undefined)} open>`, so Esc or an outside click dismisses the create dialog **while the POST is still in flight**. The operator then sees the optimistic row in the table and can click its edit button; `onEdit(area)` captures the row object into React state, so `modal.area.id` is `optimistic:areas:<name>` and stays stale even after the cache reconciles. Submitting that dialog issues `PATCH /api/v1/sales-ops/areas/optimistic:areas:<name>`, which reaches `updateArea` and fails at the Postgres uuid cast (a 500), because `UpdateAreaSchema` validates only the body and the id comes from the path param. Assessed as low severity: the window is one round trip, the outcome is a rejected request rather than a duplicate row or any data corruption, slice 02 of this same batch removes outside-click dismissal, and the guard is a one-line use of the already-exported `isOptimisticId` (disable the row's edit affordance, or short-circuit the save). Same shape applies to clientes and pessoas.
2. **The reconcile step has no test that can fail.** `keeps exactly one row for the new área after the POST and the refetch resolve` would also pass with the `onSuccess` reconcile deleted, because the refetch overwrites the entire bootstrap snapshot, and because ids are not rendered the `not.toContain('optimistic:')` assertion is satisfied either way. A test that resolves the POST and asserts the cached row carries the persisted uuid **before** resolving the refetch would make that hunk load-bearing. Note `optimistic.test.ts` does cover `reconcileOptimisticRow` as a pure function, so the logic itself is tested - it is the wiring in `useOptimisticBootstrapWrite.onSuccess` that is not.

### Style notes (explicitly not defects)

- `aria-live="polite"` sits on a span that only mounts while fetching. A live region generally has to exist in the DOM before its content changes to be announced, so this likely announces nothing. Rendering the span always and toggling its content would be more robust.
- The rollback path is silent: on a failed create the optimistic row vanishes and the dialog stays open with no error message, because the call sites pass only `onSuccess`. Pre-existing (no error surface existed before either), but the optimistic write makes the silence more noticeable - a row now appears and disappears with no explanation.
- `queryKeys.adminApps.detail(id)` is invalidated by four hooks but no query uses that key (there is no admin-app detail query). Harmless dead target, and correct if such a query is added later.

## Verdict

**PASS.** All three gates exit 0 on the full suite. The acceptance criterion is honestly demonstrated, including the hard part - the pre-POST optimistic state and the failure rollback - by tests that provably invert if the implementation is reverted. No pre-existing test was modified, deleted, skipped or loosened; test and file counts reconcile exactly against the `master` baseline. Scope held to the slice plan. Two non-blocking follow-ups and three style notes are recorded above.
