# Verify - slice 01.1 `optimistic-row-edit-guard`

Verdict: **PASS**

Branch `feat/01.1-optimistic-row-edit-guard`, one commit `320668c` on top of `master` (`9bf198d`).
Reviewed adversarially, without the implementer's plan.

## 1. Gates

Run from the repo root on the branch as committed.

| Gate | Command | Exit |
| --- | --- | --- |
| lint | `pnpm run lint` | 0 |
| type-check | `pnpm run type-check` | 0 |
| test | `CI=true pnpm test` | 0 |

Totals:

| Package | Branch point | This branch | Delta |
| --- | --- | --- | --- |
| apps/web | 28 files / 181 tests | 29 files / 190 tests | +1 file / +9 tests |
| apps/api | 24 / 248 | 24 / 248 | unchanged |
| packages/shared-utils | 1 / 17 | 1 / 17 | unchanged |

Nothing was removed.
Gates were run twice: once before any probe and once after every probe was reverted, both clean.

## 2. Is the invariant actually complete?

I enumerated the bootstrap consumers myself with `grep -n 'bootstrap\|persistedBootstrap' apps/web/src/sales-ops/SalesOpsApp.tsx` and then read every hit.

`useSalesOpsBootstrap` is called in exactly one place, `SalesOpsApp.tsx:514`.
There is no second entry point into the snapshot anywhere in `apps/web/src`, so there is no bypass route.

### Filtered (`persistedBootstrap`)

| Line | Consumer |
| --- | --- |
| 546 | `dashboard = buildDashboardModel(persistedBootstrap)` |
| 1007 | sales area filter `<option>` list |
| 1052 | `DashboardView bootstrap` |
| 1056 | `SalesView bootstrap` |
| 1088 | `CommissionsView bootstrap` |
| 1091, 1092 | `ProductsView areas`, `products` |
| 1123, 1124 | `ProductDialog areas`, `collaborators` |
| 1158 | `SaleWizardDialog bootstrap` |

### Raw (`bootstrap`) - every surviving read, and why it is fine

| Line | Read | Justification |
| --- | --- | --- |
| 548-558 | `filteredSales` from `bootstrap.sales` + `bootstrap.saleItems` | neither collection is optimistically written; only sale/saleItem ids flow onward |
| 589, 804, 847, 1034 | `bootstrap.payables` aggregates and counts | payables only |
| 1068 | `PeopleView` (vendedores) | by design - the cadastro that creates pessoas |
| 1079 | `PeopleView` (finders) | by design - same |
| 1098 | `ClientsView` | by design - the cadastro that creates clientes |
| 1104 | `AreasView` | by design - the cadastro that creates áreas |
| 1110, 1113 | `SettingsView` key and `settings` | settings only |

The implementer's claim - exactly four raw reads by design (PeopleView twice, ClientsView, AreasView) plus
`sales` / `saleItems` / `payables` / `settings` - is **right and complete**.
I found no additional raw read that could surface an optimistic row into a picker or a request body.

### Transitivity of the single seam - checked directly, not taken on trust

`ProductDialog` receives only `areas` and `collaborators`, both filtered at 1123/1124.
It forwards `props.collaborators` at 2644.
Its internal `activeAreas` (2676) and the inactive-area extension `[currentArea, ...activeAreas]` (2682)
derive solely from the `areas` prop, and `currentArea` is looked up inside that same filtered list.

`SaleWizardDialog` (3680) receives only `props.bootstrap` and hands exactly that down to
`SaleWizardDialogBody` (3697).
Everything the body derives comes from that one prop:

- `sellers` (3721), `finders` (3725), `collaborators` (3728) memos over `bootstrap.people`
- `activeAreas` (3861) and `areaNameById` (3862) over `bootstrap.areas`
- cliente datalist (4264) and the name-to-id lookup that sets `clientId` (4255) over `bootstrap.clients`
- prestador datalist (3134) and the prestador select (4905, 4921) over the `collaborators` memo
- free-form item `areaId` options (4408) over `activeAreas`
- `deriveWizardPrefill` (3604) over the same prop

No memo derives from a different source and no collection is passed in separately.
The seam genuinely closes all six request-body pickers.

### Can an optimistic id reach a request body?

No. I could not construct such a state.

- The four cadastros edit affordances are the only writers of a row object into `modal`, and all four are
  now `disabled` for an optimistic row (verified by mutation, section 4).
- Products, sales, saleItems, payables, receivables and settings are never optimistically written
  (`OptimisticCollection = 'areas' | 'clients' | 'people'`), so no server-derived id can be a placeholder.
- The wizard cannot observe an optimistic row at all, so it cannot hold one in state - not even
  transiently, because the filter is applied before the wizard ever renders.
- The cadastros create dialogs render behind the wizard overlay, so there is no interleaving where the
  wizard is open while an optimistic row is being created; and even if there were, the wizard reads the
  filtered snapshot.

Proven mutationally rather than only by reading: reverting `ProductDialog areas` alone back to
`bootstrap.areas` turns the picker test red (section 4).

## 3. Does the reconcile test genuinely invert?

**Yes.**

Probe: no-oped the reconcile in `useOptimisticBootstrapWrite.onSuccess`
(`apps/web/src/sales-ops/hooks.ts:98-112`) by short-circuiting before the `setQueryData`.

Result - exactly one test went red, the intended one:

```
 ✓ ... disables the área edit affordance while the create POST is in flight
 ✓ ... keeps the área edit affordance blocked after the create dialog is dismissed mid-POST
 ✓ ... disables the cliente edit affordance while the create POST is in flight
 ✓ ... disables the pessoa edit affordance while the create POST is in flight
 ✓ ... re-enables the área edit affordance for a persisted row
 × the onSuccess reconcile is observable > edits the persisted uuid, not the optimistic id, once the create POST resolves
   -> button not found: Editar FXL BPO Sales
 ✓ withoutOptimisticRows > returns the same snapshot reference when no row is optimistic
 ✓ withoutOptimisticRows > strips optimistic áreas, clientes and pessoas ...
 ✓ an unsaved row is never offered to a picker > keeps an unsaved área out of the produto área picker
```

The pre-existing `optimistic.test.ts` (8 tests) stayed fully green under the same mutation, which
confirms the earlier gap precisely: the pure `reconcileOptimisticRow` had unit coverage, the wiring had
none. That is now closed.

**The refetch cannot mask the failure.** `salesOpsApi.bootstrap` is mocked to hand out a fresh deferred
per call and the test resolves only index 0. After the create POST resolves, it asserts
`bootstrap` was called twice (`toHaveBeenCalledTimes(2)`) and never resolves deferred 1, so the
invalidated refetch is left permanently in flight. The only thing that can have put the persisted uuid
into the cache is the `onSuccess` reconcile - and the assertion is on the actual PATCH payload
(`saveArea` call 1 equals `{ id: persistedArea.id, name: 'FXL BPO Sales Editado', status: 'active' }`),
not on rendered text.

Restored and verified byte-identical afterwards.

## 4. Vacuity hunt

Four mutation probes. Every one was caught.

### 4a. The post-click "no dialog opened" assertion is real

Probe (the one the implementer claims it ran, reproduced): removed `disabled={pending}` from the
`AreasView` button **and** replaced the test's own `expect(pendingButton.disabled).toBe(true)` with a
tautology, so nothing but the post-click assertion could catch it.

Result: 2 failed. The relevant one failed at the intended line with the AreaDialog form dumped into the
failure output:

```
 ❯ src/sales-ops/__tests__/optimistic-row-guard.test.tsx:336:45
   336|     expect(container.querySelector('form')).toBeNull();
```

So the click really does reach `onEdit(area)` and really does open the dialog when the button is not
disabled, and the negative assertion catches it. Not vacuous.

### 4b. Positive controls exist for every negative

- `re-enables the área edit affordance for a persisted row` (the ninth test) is the positive control for
  the four disabled-state negatives: it finds `Editar <name>`, asserts `disabled === false` and
  `title === 'Editar'`, asserts `Salvando <name>` is absent, then clicks and asserts the form appears
  with the prefilled value.
- The picker test carries its own inline positive control: `expect(values).toContain(existingArea.id)`.

### 4c. No absent-assertion without an established presence

Every `expect(querySelector('button[aria-label="Editar X"]')).toBeNull()` sits immediately after a
successful `requireButtonByAriaLabel('Salvando X')` on the same element, and the two labels are the two
branches of one ternary. The attribute is therefore provably rendered, so the negative is a real check on
the branch, not a check that the attribute exists at all. Same for the reverse pair in the ninth test.

### 4d. Two more mutants, both caught

| Mutation | Test that went red |
| --- | --- |
| removed the `withoutOptimisticRows` early return | `withoutOptimisticRows > returns the same snapshot reference when no row is optimistic` |
| reverted `ProductDialog areas` to raw `bootstrap.areas` | `an unsaved row is never offered to a picker` (`expected true to be false` on the `optimistic:` prefix scan) |

Conclusion: **no vacuous tests**.

## 5. Anti-gaming

```
$ git diff --numstat master..feat/01.1-optimistic-row-edit-guard -- '*test*'
521  0  apps/web/src/sales-ops/__tests__/optimistic-row-guard.test.tsx
```

Additions only, one new file. No pre-existing test file is touched.
No `.only`, `.skip`, `xit`, `xdescribe` or `todo` in any added line.

## 6. Scope discipline

Read `### Scope limits (YAGNI)` in `nexo/plans/batch-01K9C0FXA7RQ8VZTN3KDM6WS4E/00-OVERVIEW.md`.

Three files touched, all under `apps/web/src/sales-ops/`:

```
apps/web/src/sales-ops/SalesOpsApp.tsx
apps/web/src/sales-ops/optimistic.ts
apps/web/src/sales-ops/__tests__/optimistic-row-guard.test.tsx
```

`git diff --name-only master..branch -- apps/web/src/admin apps/api packages apps/web/src/sales-ops/navigation.ts apps/web/src/seller apps/web/src/finder`
returns empty.

`apps/web/src/admin/**` is confirmed untouched, and the twin defect is confirmed still present there:
`apps/web/src/admin/products/useProducts.ts` `optimisticProductRowFromBody` mints
`` id: `optimistic:${data.appId}:${data.slug}` ``, and `apps/web/src/admin/products/ProductsPage.tsx`
feeds `product.id` into both `setEditProduct(product)` and
`` navigate(`/admin/products/${product.id}`) `` with no guard. Leaving it alone is correct: CLAUDE.md
fences the legacy `/admin/*` tree and the plan defers it for a human decision. Touching it here would
have been scope creep.

No api change, no propostas status machine, no payables/receivables, no auth/tenancy, no `navigation.ts`,
no legacy route trees.

## 7. Correctness and UX review

### The memo is reference-stable - tested in the real component, not just read

The unit test only covers the pure function, so I instrumented the component. Temporary probe: recorded
`bootstrap` and `persistedBootstrap` identities per render into a global from inside `SalesOpsApp`, then
drove three extra re-renders by toggling `Filtros` on `/operacional/vendas`.

| Scenario | Renders | Distinct raw identities | Distinct filtered identities |
| --- | --- | --- | --- |
| nothing optimistic | 5 | 2 | 2 |
| an optimistic área cached | 5 | 2 | 2 |

The two identities are `emptyBootstrap` during loading and the loaded snapshot; element-wise `toBe`
comparison of the two recorded sets passed, i.e. `persistedBootstrap` **is the same object as**
`bootstrap` when nothing is optimistic. Zero per-render allocation in either scenario. Removing the early
return flips the unit guard red (4d), so the property is also locked in by a test.

Why it holds: `useMemo(..., [bootstrap])` plus the hoisted `selectSalesOpsBootstrap` in `hooks.ts:40`
keeping TanStack's per-selector memo alive. Independently, the wizard-remount class of bug is fenced by
`key={props.editSale?.id ?? 'create'}` at `SalesOpsApp.tsx:3696`, so even a churn would not have
remounted the wizard.

### The disabled affordance genuinely looks and behaves disabled

`iconButtonPendingClass` is `iconButtonBaseClass + 'cursor-not-allowed border-[#ececf1] bg-[#f6f6f8] text-[#b6b6bd]'`.
`iconButtonClass` is not applied at all when pending, so the two are genuinely disjoint and there is no
`hover:` / `disabled:` specificity tie to lose. No hover utility survives on the pending variant.
The rationale in the code comment is sound, and the `disabled:`-variant alternative really would have been
order-dependent.

For the pessoa card the pending class swaps `hover:border-[#d8c79a]` for `cursor-not-allowed opacity-60`,
and `panelClass` (`SalesOpsApp.tsx:136`) carries no `hover:` of its own, so that path is clean too.

Behaviour: native `disabled` on a `<button>`, so it is not focusable, not keyboard-activatable, and the
click handler does not fire - proven by 4a, where removing `disabled` was the single change that let the
dialog open. `cursor-not-allowed` does not set `pointer-events: none`, so the `Salvando...` tooltip still
appears on hover.

### The disabled state is never stuck

Probe: created an área, dismissed the dialog mid-POST, then rejected the POST.

```
PROBE before reject: pendingButtonPresent = true
PROBE dialog dismissed, form = false
PROBE after reject { rowTextPresent: false, stuckDisabled: false, editable: false, bootstrapCalls: 2 }
```

The `onError` rollback removes the row entirely and `useAppMutation` invalidates in `onSettled` - on
success **and** on failure, documented at `apps/web/src/lib/app-mutation.ts` - so the cache always
re-syncs with the server. Both terminal states exit the disabled state: reconcile leaves a persisted uuid
with an enabled affordance, rollback leaves no row at all. No permanently unactionable row exists.

Two observations, neither a defect of this slice:

- The failed-create rollback is **silent** once the dialog has been dismissed: the row simply vanishes
  with no toast. This is pre-existing behaviour from slice 01 and is neither introduced nor worsened here.
  Worth a follow-up doubt rather than a block.
- Two concurrent creates where the second fails will roll back to a snapshot that momentarily resurrects
  the first row's optimistic id (classic optimistic-rollback clobber, also pre-existing). The `onSettled`
  invalidate immediately replaces it with server truth, and while it is present the row is disabled rather
  than dangerous - which is strictly better than before this slice.

### pt-BR strings and em dashes

Added user-facing strings are `Salvando...`, `Salvando <label>`, `Editar <label>` and `Editar`. No English
user-facing string. `grep '^+' | grep '—'` over the diff returns nothing; added comments use `-`.

### Commit hygiene

One commit `320668c`, Conventional Commit subject `fix(sales-ops): keep optimistic row ids out of every
request`, author and committer both `CauetPinciara <cauetpinciara@gmail.com>`, no `Co-Authored-By`
trailer, no AI attribution.

## Forward-looking coupling: the `Produtos` nav label

**Acceptable.** `navigation.ts:59` is `{ id: 'produtos', label: 'Produtos', ... }` and the nav renders
`aria-label={item.label}` at `SalesOpsApp.tsx:807`, so slice 10's rename to "Produtos & Serviços" breaks
the picker test at exactly one line, loudly, with an explicit `nav Produtos not found` throw. Single
point, obvious cause, one-line fix that the renaming slice must make anyway. Not a defect.

Robustness nit (style only): navigating by route or by a `data-testid` would have decoupled it.

## Style-only observations (not grounds for FAIL)

- `PeopleView` sets `title` only when pending (`: undefined`), while the two row buttons set
  `title="Editar"` when enabled. Minor inconsistency; it does preserve the card's prior no-tooltip
  behaviour.
- The pending state is communicated by tooltip plus dimming, with no visible inline "Salvando..." badge.
  This satisfies "labelled" through the accessible name and the tooltip, but on the pessoa cards - where
  the whole card dims - a visible badge would read better.
- `aria-disabled` / `aria-busy` were not added. Native `disabled` is the stricter choice and matches the
  acceptance wording, so this is a preference, not a gap.

## Restoration

Every probe and mutation was reverted. Baseline hashes recorded before any mutation and re-checked after:

| File | Hash before | Hash after |
| --- | --- | --- |
| `apps/web/src/sales-ops/hooks.ts` | `63c94448325f3ff8da7305757b00eabc36ab26a9` | identical |
| `apps/web/src/sales-ops/SalesOpsApp.tsx` | `21ce06f26b9edfd23208f5c62d59bb697aa27dd2` | identical |
| `apps/web/src/sales-ops/optimistic.ts` | `560812e8fec4d94f2af440bd5860b74e2874059a` | identical |
| `apps/web/src/sales-ops/__tests__/optimistic-row-guard.test.tsx` | `f80d79ca0d1595cddefe4f53d9027fdbdfd59f31` | identical |

The throwaway probe file `apps/web/src/sales-ops/__tests__/zz-probe-memo.test.tsx` was deleted.
`git diff HEAD` is empty. `git status --porcelain` is:

```
?? .vscode/
?? nexo/runs/batch-01K9C0FXA7RQ8VZTN3KDM6WS4E/agents/exec-01.1-optimistic-row-edit-guard.result.json
```

which matches exactly what I found at the start (both pre-existing untracked entries; the second is the
implementer's own run artifact). Nothing was merged, pushed, committed or amended, and no finding was
"fixed".

## Verdict

**PASS.** No defects.

The acceptance criterion is fully proven, including the clause the earlier slice could not prove: the
reconcile is now observable and the test inverts. The stated invariant is complete - my independent
enumeration of the snapshot consumers matches the implementer's claim exactly, the single seam genuinely
closes all six request-body pickers transitively, and I could not construct a state where a placeholder id
reaches a request body or path. The memo is reference-stable in the real component, the disabled state is
never stuck, no test was weakened, and scope was held including the correct deliberate deferral of the
legacy `/admin/*` twin.
