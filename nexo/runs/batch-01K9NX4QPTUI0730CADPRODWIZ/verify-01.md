# Verify 01 - `01-funcao-optimistic`

Branch: `feat/01-funcao-optimistic`.
Subject: the uncommitted working tree (`git diff`), 6 files, +319 / -50.
Verifier did not read the executor notes.

## Commands run

### 1. `pnpm test`

```
apps/api test:  Test Files  29 passed (29)
apps/api test:       Tests  300 passed (300)
apps/web test:  Test Files  38 passed (38)
apps/web test:       Tests  361 passed (361)
```

Baseline was 354 web tests across 38 files.
Actual is **361 across 38 files**, so +7 tests and no file lost.
The +7 accounts exactly for the new coverage: `cadastros-refresh` +1, `optimistic-row-guard` +2, `optimistic.test.ts` +4.
No test count dropped anywhere.

`grep` over the added lines of the diff for `.skip`, `.only` and `todo(` returns nothing.

### 2. `pnpm run lint`

```
apps/api lint: Done
apps/web lint: Done
```

Clean, zero warnings.

### 3. `pnpm run type-check`

```
packages/shared-types type-check: Done
packages/shared-utils type-check: Done
apps/api type-check: Done
apps/web type-check: Done
```

Clean.

### 4. `pnpm --filter @fxl-sales/api test:integration`

```
 Test Files  19 passed (19)
      Tests  101 passed (101)
```

Exactly the 101 / 19 baseline.
No integration coverage lost, none added, which is right for a web-only change.

## Hard safety invariant: can an `optimistic:` id reach a request?

Verified by reading the call sites, not by trusting a test.

`git grep '\.funcoes'` across `apps/web/src` shows the collection is read in only three files: `optimistic.ts`, `hooks.ts` (the `select` normalizer) and `SalesOpsApp.tsx`.
Inside `SalesOpsApp.tsx` there are exactly four reads of a `funcoes` array, and every one of them is accounted for:

| Consumer | Line | Snapshot it is fed | Verdict |
| --- | --- | --- | --- |
| `ProductDialog funcoes=` (`productFuncaoCosts[].funcaoId`) | 1357 | `persistedBootstrap.funcoes` | stripped, safe |
| `PersonDialog funcoes=` (`savePerson.funcaoIds`) | 1391 | `persistedBootstrap.funcoes` | stripped, safe |
| `SaleWizardDialog bootstrap=` -> `allocatableFuncoes` (`professionals[].funcaoId`) | 1402, 5035 | `persistedBootstrap` | stripped, safe |
| `FuncoesView bootstrap=` | 1329 | `funcoesBootstrap` (raw `funcoes`) | intentional, see trap 2 |

Followed each of the three write paths one step further rather than stopping at the prop:

- **`savePerson.funcaoIds`.** `PersonDialogBody` seeds `assignedIds` from `modal.person.funcoes` (persisted nested rows), and `selectableFuncoes` is `[...funcoes, ...createdFuncoes]`. `createdFuncoes` is appended only inside `handleCreateFuncao`, which `await`s `onCreateFuncao` -> `createFuncaoByName` -> `saveFuncao.mutateAsync` and pushes `response.funcao`, the server row with a real uuid. There is no branch that puts a client-built id into `assignedIds`. `submit` sends `funcaoIds: assignedIds`. Safe.
- **`saveProduct.productFuncaoCosts[].funcaoId`.** `ProductDialog` receives no `onCreateFuncao` prop at all (line 1347-1365 passes only `onCreateArea`), matching the CLAUDE.md rule that the cost picker gets no create row. Its only source of ids is the stripped `funcoes` prop. Safe.
- **`createSale`/`updateSale.professionals[].funcaoId`.** The wizard gets `persistedBootstrap` and has no `onCreateFuncao`. `allocatableFuncoes` filters that stripped list. Safe.

**Fourth path the criteria did not list, and it is real:** `saveFuncao` itself is a PATCH to `/funcoes/:id` when `payload.id` is set, so an optimistic id would land in the URL path.
This is handled: `FuncoesView` computes `pending = isOptimisticId(funcao.id)` and renders the edit button `disabled` with `aria-label="Salvando <nome>"`, so `onEdit` cannot fire on an optimistic row and `FuncaoDialog` can never be opened with one.
That is the only affordance on the row; there is no delete and no inline archive toggle (archiving goes through the same dialog).
An optimistic row always carries `isSystem: false`, so it always takes the editable branch and therefore always hits the `pending` guard - it can never slip through the `isSystem` lock branch instead.

Also checked the reverse direction: `withoutOptimisticRows` filters `people` by the person's own id, not by nested `person.funcoes`, so an optimistic funcao id smuggled into a person row would survive the strip.
Confirmed above that no such path exists, and `optimisticPerson`'s `previous.funcoes.find(...)` only resolves a label for ids that already came from the persisted picker.

Verdict: **trap 1 handled.**

## Second trap: does `FuncoesView` actually see the optimistic row?

Handled, and handled with more care than the minimum.
`funcoesBootstrap` (SalesOpsApp.tsx:723) is `{ ...persistedBootstrap, funcoes: bootstrap.funcoes }` - raw `funcoes` so the new row renders, but persisted `people` so an in-flight optimistic *pessoa* cannot inflate the `Nº pessoas` column, which counts `bootstrap.people`.
That is the correct reading of "an optimistic row belongs only to the cadastro that created it", and it would have been easy to get wrong by passing raw `bootstrap` wholesale.
The `bootstrap.funcoes === persistedBootstrap.funcoes` identity short-circuit means the memo returns `persistedBootstrap` by reference in the normal case, so no downstream identity churn.

Proven end to end by `cadastros-refresh.test.tsx > shows a new função in the list before the create POST resolves`, which asserts the row is in `tbody tr` while the POST deferred is unresolved and the bootstrap refetch has not been answered.

Verdict: **trap 2 handled.**

## Adversarial: do the new tests fail without the implementation?

Backed up the three source files to the scratchpad, checksummed them, `git checkout --` reverted only `optimistic.ts`, `hooks.ts` and `SalesOpsApp.tsx` (tests left modified), and re-ran.

```
 FAIL  cadastros-refresh.test.tsx > shows a new função in the list before the create POST resolves
 FAIL  optimistic-row-guard.test.tsx > disables the função edit affordance while the create POST is in flight
 FAIL  optimistic-row-guard.test.tsx > withoutOptimisticRows > strips optimistic áreas, clientes, funções and pessoas ...
 FAIL  optimistic-row-guard.test.tsx > keeps an unsaved função out of the pessoa função picker
 Test Files  2 failed (2)
      Tests  4 failed | 16 passed (20)
```

All four new behavioural tests fail without the implementation, for the right reasons (the row is absent from the DOM, not a crash or an import error).
Restored the three files from the backup and re-verified byte-identical checksums; `git status --porcelain` matches the pre-check state exactly and the three suites are green again (34 passed).
The tree is exactly as I found it.

## Are the tests asserting real behavior?

Yes, not tautological.
`keeps an unsaved função out of the pessoa função picker` is the strongest one: it drives the real UI across two cadastro screens, opens the actual Combobox, asserts `offered` **equals** `[funcaoPrestador.name]` (a positive control, not just a `not.toContain`), then submits and inspects the real `salesOpsApi.savePerson` payload for `funcaoIds` and asserts it does not match `/^optimistic:/`.
The mock is only the HTTP boundary; everything between the click and the payload is production code.
`optimistic.test.ts` tests the pure functions against concrete expected orderings and slug strings rather than against re-derived values.

## Other findings

- **Slug mirror is exact.** `provisionalFuncaoSlug` in `optimistic.ts` is character-for-character identical to `slugifyFuncao` in `apps/api/src/domains/sales-ops/service.ts:261`, including the trailing double `replace(/-+$/g, '')` after the `slice(0, 120)`. Diffed both by eye.
- **Ordering mirrors the API.** `funcaoOrder` is `Number(b.isSystem) - Number(a.isSystem) || localeCompare(pt-BR)`, which matches `orderBy(desc(isSystem), asc(name))` at service.ts:1075 / 1312 / 2374. The alternative (plain name order, as the other three cadastros use) would have floated a new função above Vendedor and made it visibly hop when the refetch landed. Getting this right required the `sortRows(rows, label)` -> per-collection `Comparator<T>` refactor, since a `(row) => string` label cannot express a two-key sort. That refactor is therefore load-bearing, not scope creep.
- **`isSystem` is never taken from the payload** on the edit branch (`isSystem: existing.isSystem`) and is hardcoded `false` on the create branch, matching the API's `values({ ...data, orgId, slug, isSystem: false })`. Pinned by `never flips isSystem when editing a função optimistically`.
- **Hook wiring is consistent** with the other three cadastros: same `{ mutationFn, invalidates, ...optimistic }` shape, same `queryKeys.salesOps.all` invalidation. `useAppMutation` only wraps `onSettled`, so the spread `onMutate` / `onError` / `onSuccess` reach `useMutation` untouched.
- **No em dash** introduced anywhere in the diff (`grep -P "\x{2014}"` over added lines returns nothing). Comments use the plain dash.
- **No scope creep.** All six touched files serve the stated outcome or the safety invariant. The `pending` / disabled edit affordance is the existing pattern already applied to áreas (2576), clientes (2512) and pessoas (2654), so this makes funções consistent rather than adding a new concept.

Non-blocking observations, recorded and not held against the verdict:

1. `provisionalFuncaoSlug` duplicates the API's `slugifyFuncao` in web code with no shared test pinning the two together, so they can drift silently. Impact is bounded: nothing renders a `funcao.slug`, the `onSuccess` reconcile replaces the whole row with the persisted one inside one round trip, and I confirmed the value cannot reach role derivation - `hasFuncao` reads `person.funcoes[].slug`, a different array that `optimisticFuncao` never touches. Acceptable as written and the comment says so.
2. If `payload.id` is set but the row is absent from the snapshot, `optimisticFuncao` falls into the create branch and inserts a row carrying that real uuid with `isSystem: false`. Unreachable from the UI (the dialog only edits rows drawn from the rendered list) and self-heals on reconcile. Cosmetic.
3. `onError` restores `patch.previous`, the whole snapshot, so a second optimistic write started mid-flight would be wiped by the first one's failure. Pre-existing to all four cadastros, not introduced by this slice.

## Verdict

**PASS.**

All four commands are green.
Web tests rose 354 -> 361 across the same 38 files, api unit is 300 / 29, integration is exactly the 101 / 19 baseline; nothing was skipped, deleted or narrowed.
Both traps are genuinely handled and I confirmed each by reading the call sites rather than by trusting the suite: every one of the four `funcaoId` write paths (`savePerson.funcaoIds`, `saveProduct.productFuncaoCosts[].funcaoId`, `createSale`/`updateSale.professionals[].funcaoId`, and the `saveFuncao` PATCH path the criteria did not list) is fed either the stripped snapshot or a disabled affordance.
`FuncoesView` really does render the optimistic row, and does so without leaking an optimistic pessoa into its `Nº pessoas` column.
The four new behavioural tests were shown to fail against reverted source, and the tree was restored byte-identically.
