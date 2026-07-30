# Verify - slice 06-combobox-adoption (Gate 2)

Branch `feat/06-combobox-adoption`, one commit `8dd3273` on top of `master` (`e2c43a0`).
Verdict: **FAIL**, on exactly one narrow, objective defect (a false sentence in the `CLAUDE.md` contract this slice shipped).
Everything else in this slice is clean, and several parts are notably better than the bar.

## 1. Gates

All four run by me, all exit 0.

| Gate | Exit | Result |
| --- | --- | --- |
| `pnpm run lint` | 0 | clean |
| `pnpm run type-check` | 0 | shared-types, shared-utils, api, web all Done |
| `CI=true pnpm test` | 0 | web 30 files / 210 tests, api 24 / 248, shared-utils 1 / 17 |
| `pnpm run build` | 0 | built in 1.42s |

Branch-point baseline was web 29/190, api 24/248, shared-utils 1/17.
Web rose by 1 file and 20 tests; api and shared-utils are unchanged.
No test file and no test was removed: I compared `it(` counts per modified file against `master` and every count is identical, and the assertion-set diffs (below) show removals only where an assertion was translated into a stronger form.

## 2. Completeness - my own grep, not the report's

`grep -rn` over `apps/web/src`:

- `<select` - 2 hits, both string literals inside guard tests (`combobox-adoption.test.tsx:734`, `sale-wizard-ui-contract.test.ts:46`). Zero in production source.
- `<option` - 2 hits, same two guard tests. Zero in production source.
- `datalist` - 10 hits: 3 explanatory comments in `SalesOpsApp.tsx`, the rest guard-test assertions and test names. Zero markup.
- raw `<input` - exactly 4 in all of `apps/web/src`: `SalesOpsApp.tsx:2886` (`type="text"`, the 2-digit code suffix), `admin/payouts/PayoutsPage.tsx:130` (`type="checkbox"`), `components/ui/combobox.tsx:329` (the panel search field), `components/ui/input.tsx:6` (the primitive). **Zero raw `<input type="number">`.**
- `type="number"` - 19 hits, all on the shadcn `<Input>` wrapper.
- `type="date"` - 3 hits, all on `<Input type="date">`, untouched (the deliberate batch-level exclusion).

I also checked the `master` baseline: the coordinator's note that raw number inputs existed in `admin/*` and `finder/*` before this slice is **not accurate**. On `e2c43a0` the only raw `<input>` anywhere were the same four shapes; `admin/products/CommissionRuleForm.tsx`, `admin/products/PriceBandForm.tsx` and `admin/apps/AppDialog.tsx` already used `<Input type="number">`. Nothing needed migrating there; the ESLint rule simply now guards them.

## 3. Does the ESLint rule enforce what CLAUDE.md claims?

Yes, for every claim it attributes to ESLint. Scope is `eslint src/` (`apps/web/package.json:11`) with `files: ['**/*.{ts,tsx}']` and only `dist` ignored - **no file or directory was excluded to make lint pass**.

I wrote three throwaway probes (`apps/web/src/__verify_probe__.tsx`, `apps/web/src/admin/__probe__/p.tsx`, `apps/web/src/finder/__probe__/p.tsx`) violating each banned form, and ran `npx eslint` on them. Result: 7 `no-restricted-syntax` errors, one per violation, with the intended messages:

- `<select>` - flagged in `src/` and in `src/finder/`
- `<option>` - flagged in `src/` and in `src/finder/`
- `<datalist>` - flagged in `src/`
- raw `<input type="number">` - flagged in `src/` and in `src/admin/`

All three probes deleted; `git status` confirms.

One theoretical hole worth recording, not a defect: the number-input selector matches `value.value="number"`, so `<input type={'number'}>` (a JSX expression) would slip past. Not reachable today and not worth widening.

## 4. Anti-gaming - every rewritten pre-existing test

Method: for each modified test file I diffed the **sorted set of `expect(...)` lines** between `master` and the branch, counted `it(` blocks, and grepped for `.skip`/`.only`.

Zero `.skip`, zero `.only`, `it(` counts identical in every file.

| File | assertions master -> branch | Judgment |
| --- | --- | --- |
| `auth/__tests__/react.test.tsx` | see below | **stronger** |
| `areas-view` | 17 -> 21, additions only | stronger |
| `cadastros-refresh` | 18 -> 20, additions only | stronger (migration) |
| `optimistic-row-guard` | 49 -> 51 | **stronger**, detailed below (migration) |
| `product-commission-editor` | 23 -> 24, additions only | stronger |
| `sale-wizard-commission-defaults` | 15 -> 18 | stronger |
| `sale-wizard-custom-item-labels` | 26 -> 27, additions only | stronger |
| `sale-wizard-edit` | 28 -> 28, 3 translated | equivalent, detailed below |
| `sale-wizard-free-items` | 8 -> 9, additions only | stronger |
| `sale-wizard-payment-plan` | 15 -> 18, additions only | stronger |
| `sale-wizard-state-preservation` | 5 -> 9 | stronger |
| `routing` | unchanged | added `mutateAsync` to a mock, no assertion touched |
| `sale-wizard-ui-contract` | +14 lines | new test, 4 negatives plus a positive control |
| `components/ui/__tests__/combobox.test.tsx` | +25 lines | positive control added to an existing test, plus one new test |

### `auth/__tests__/react.test.tsx` - the file the brief singled out

Assertion-set diff is exactly: 3 `expect(select).not.toBeNull()` removed, 1 `expect(container.textContent).not.toContain('workspace-beta')` and 1 `expect(workspaceTrigger(container).textContent?.trim()).toBe('Alpha')` added.

The 3 removals are not a loss: the replacement `workspaceTrigger()` helper **throws** if the picker is absent, and it is called by `switchWorkspace()` at all three sites, so the existence check survives at every one.

**Every Hub token assertion is byte-identical**: `setActive` called with `'workspace-beta'`, `cache.seed` called exactly once, the seed-before-profile ordering, the `getToken` call counts, the out-of-order-response rejection and the post-logout rejection. None were weakened, dropped, or reordered. `auth_token_assertions_intact: yes`.

### `optimistic-row-guard` - the `option[value]` -> payload rewrite

Removed: `expect(values).toContain(existingArea.id)`, `expect(values.some(v => v.startsWith('optimistic:'))).toBe(false)`, `expect(options.map(...)).not.toContain('AAA Área Nova')`.

Added: `expect(offered).toEqual([existingArea.name])` (exact list, not just "does not contain"), `expect(offered).not.toContain('AAA Área Nova')`, then the test **picks the row, fills the name, submits**, and asserts `saveProduct` was called once, `productPayload.areaId === existingArea.id`, and `String(productPayload.areaId)` does not match `/^optimistic:/`.

Judgment: **genuinely stronger**. The old form inspected a DOM attribute; the new form proves the id a real request body would carry, which is the actual invariant slice 01.1 established. The claim holds.

### `sale-wizard-edit` - the only file with net-zero assertion count

Three translations, all equivalent:
- `fieldInput('Cliente').value === 'SegPro'` -> `comboboxText('Cliente') === 'SegPro'`.
- `labeledSelect('Forma de pagamento da parcela 2').value === 'boleto'` -> `comboboxText(...) === 'Boleto'`. The value->label map (`paymentMethodOptions`) is injective, so this is equivalent.
- `labeledSelect('Área do item 2').value === areaTwoId` -> `comboboxText('Área do item 2') === 'FXL Advisor'`. I checked the fixture: `areaOneId` is `'FXL Tech'` and `areaTwoId` is `'FXL Advisor'`, names unique, so the label uniquely identifies the id. The **id-level** assertion also still exists in the same test at line 354 (`expect.objectContaining({ areaId: areaTwoId, ... })`), untouched.

`professionalRowInputs()` changed from "find the `<select>` containing `Digite manualmente`" to `comboboxTrigger('Profissional 1').closest('div.grid')`. Necessary (that option is deleted) and still throws when the row is absent.

### The two files the plan did not list

Both are genuine migrations, not convenience edits:
- `cadastros-refresh.test.tsx`: two `changeSelect(select, existingArea.id)` calls became `pickOption('Área do produto', existingArea.name)` plus a new trigger-label assertion each. Only possible change - the `<select>` it drove no longer exists.
- `optimistic-row-guard.test.tsx`: as above, and net stronger.

`tests_weakened: none`.

## 5. Acceptance criterion, clause by clause

| Clause | Status | Evidence |
| --- | --- | --- |
| no native `<select>` / `<datalist>` anywhere in `apps/web/src` | **proven** | my grep (section 2), my ESLint probe (section 3), plus `combobox-adoption.test.tsx:513-524` which walks all 4 wizard steps asserting `querySelectorAll('select, option, datalist')` is empty, with a positive control that Combobox triggers really are rendered |
| exactly ONE create row, text exactly `+ Criar novo cliente "Dias Pet"` | **proven** | exact-text assertion at `combobox-adoption.test.tsx:395`; the "exactly one, and it is the only row" count is pinned at the primitive level (`combobox.test.tsx:231-234`: `optionRows()` length 1 and `row(0) === createRow()`), and the produto case pins it at the adoption level (`:358-361`, length 2 with `[1] === createRow()`). Structurally the primitive renders one conditional create block. |
| clicking it POSTs to `/sales-ops/clients` and selects the result | **proven, in two halves** | the adoption test proves selection and adoption of the returned id into the payload (`:399-406`). The transport is verified by reading: `SalesOpsApp.tsx:633` `saveClient.mutateAsync({name})` -> `hooks.ts:160` -> `api.ts:82-88`, `POST /api/v1/sales-ops/clients` when no `id`. No single test spans both halves, but each half is unambiguous. |
| typing `Advis` narrows the produto picker to one row that ArrowDown + Enter selects | **proven in intent, literally different** | `:355-381`. The filter narrows to one produto. Because the produto picker also offers a create row (which the same criterion requires), the create row is the last navigable row, so a single `ArrowDown` from the search field lands on it; plain `Enter` selects the narrowed match, and `ArrowDown, ArrowDown, Enter` also selects it - which is what the test asserts, honestly commented. Standard combobox behaviour, not a defect, but the literal keystroke pair in the criterion selects the create row rather than `FXL Advisor`. |
| every picker matches the adjacent `Input` in height, font size and border radius | **proven at class-token level only** | `:542-565` asserts `h-11`, `rounded-[10px]`, `text-sm` present on both trigger and neighbour `Input`, and asserts the stale `h-10`, `rounded-md`, `text-[13.5px]`, `rounded-[9px]` tokens are absent (proving tailwind-merge displaced the primitive's base geometry). I confirmed the item-row `Input`s resolve to the same values: `cn('sales-ops-num h-10 rounded-[9px] text-right', formInputClass, ...)` puts `formInputClass` last, so `h-11 rounded-[10px] text-sm` win. Rendered pixels are not asserted - see section 11. |

`acceptance_proven: yes` (with the two notes above recorded, neither of which is a defect).

## 6. Behaviour preservation across the 17 call sites plus 2 typeaheads

- **Cliente free-type fallback: preserved.** `canSave` is `Boolean(clientName.trim() && sellerPersonId && items.length > 0)` (`SalesOpsApp.tsx:3990`) - it keys off the name, never the id. `createClient()` sets `clientName` and clears `clientId` **before** awaiting, so a failed or absent create leaves exactly the old datalist state. Locked by `combobox-adoption.test.tsx:423-436` (no `onCreateClient` wired: saves with `clientName: 'Dias Pet'`, `clientId: undefined`) and by both `sale-wizard-state-preservation` tests, which now drive that exact fallback path.
- **Prestador free-type: preserved.** `ProductDialogBody` providers picker keeps `value={provider.personName}` with `valueLabel`, and `onCreate` writes the typed name verbatim into `personName`. Locked by `combobox-adoption.test.tsx:665-694`, which asserts the saved `providers` payload carries `personName: 'Estúdio Externo'`.
- **Profissional free-type: preserved and improved.** The old `<option value="">Digite manualmente</option>` cleared the name and offered nowhere to type it; the create row now sets `personId: ''` and `personName: <typed>`. Locked by `:490-511`, asserting the payload `{ personId: undefined, personName: 'Dev Externo', ... }`.
- **Finder empty state:** the old `<option value="">Sem finder cadastrado</option>` became `emptyMessage="Nenhum finder cadastrado"`. Equivalent.
- **Same value to the same state at every site:** I walked all 19 migrated call sites in the diff. Each `onChange` body is either byte-identical to the old `NativeSelect` handler or the minimal id/name adaptation, and the state setter is the same in every case. The two `Filtros` pickers keep `'all'` as a real option value.
- **Produto create opens `ProductDialog` prefilled, never POSTs an invalid produto.** `onCreateProduct` only calls `setModal({kind:'product', prefillName: name})`; `productForm(product, prefillName)` seeds `name`, and `ProductDialog`'s key now includes `prefillName` so a second create row re-seeds the field. `:472-488` asserts the create row calls the handler and that the primitive did **not** mutate the picker's value.
- **Clearing / reset:** the primitive has no clear affordance, which slice 03's plan put explicitly out of scope ("Multi-select, per-option `disabled`, a clear button ... Slice 03 owns the primitive"). Net effect per site: closed enums were never clearable via a native `<select>` (no change); `ProductDialog`'s Área had a `disabled` empty option (not selectable, no change); item Área and Produto had no empty option (no change); Finder is cleared by the "remover" button; prestador and profissional rows are deletable via their trash buttons. The only in-place narrowing is that the Cliente trigger and a prestador name can no longer be emptied to `''` in place, only replaced. Plan-sanctioned and low-impact - recorded, not counted as a regression.

`behaviour_preserved: yes`.

## 7. Precondition (not re-litigated)

`SalesOpsApp.tsx:3837`: `key={props.editSale?.id ?? 'create'}` - session identity only, with the original comment intact. `git show 8dd3273 -- SalesOpsApp.tsx | grep 'key={props.editSale'` returns nothing, so **this slice did not touch that line**; it only added three `onCreate*` props to the same JSX element. The `bootstrapQuery.isSuccess` mount gate at `:1232` is intact.

`remount_key_untouched: yes`.

## 8. Scope discipline

- `apps/api/**`: zero files in the diffstat. Untouched.
- `<input type="date">`: 3 sites, unchanged.
- Propostas status machine, payables/receivables materialization, `"N/M"` / `"MN/M"` conventions, `deriveWizardPrefill`: untouched. The only prefill-adjacent edits are `selectableAreas` and widening `areaNameById` to include locally created áreas.
- Legacy route trees: routing unchanged, `routing.test.tsx` green. Three files **inside** those trees were edited (`admin/products/ProductDialog.tsx`, `finder/links/LinkGeneratorForm.tsx`, plus the shared `auth/react.tsx`). The slice plan sanctions this explicitly ("only the data-driven pickers convert" in the frozen trees), and the CLAUDE.md rule is about route trees, not the components behind them.
- **The two deleted comissões pickers were genuinely inert on `master`.** Confirmed from the diff: `<NativeSelect className="w-[190px]" onChange={() => undefined} value="all">` with a single `<option value="all">` each. `grep -rn "Todos os responsáveis"` across `apps/web/src` and `apps/api/src` returns nothing, so nothing depended on them. Deleting rather than migrating a control that provably cannot filter is the right call. `inert_pickers_were_inert: yes`.
- Two additions beyond the plan, both defensible: local `createdAreas` state so a just-created área is selectable before the refetch lands (necessary for the create row to work at all), and wiring the previously dead `Cadastrar produto` button (which is the same handler and is correctly `disabled` when none is supplied).

`scope_ok: yes`.

## 9. Correctness review

Real defects hunted, and what I found:

- **Create-then-select race: none.** Both create paths take their id from the `mutateAsync` **response** (`const { client } = await saveClient.mutateAsync(...)`), i.e. server truth, never a cache read and never an optimistic row. Selection happens after the await.
- **Optimistic id reaching a request body: cannot happen.** `useSaveSalesOpsClient` / `useSaveSalesOpsArea` do insert `optimistic:`-prefixed rows into the bootstrap cache while pending, but every picker in the wizard and `ProductDialog` reads `persistedBootstrap = withoutOptimisticRows(bootstrap)`, and the created ids come from the response. The invariant from slice 01.1 holds, and `optimistic-row-guard` now proves it at the payload level. `optimistic_invariant_intact: yes`.
- **Keyboard behaviour: preserved everywhere.** One primitive, one keyboard implementation, `ArrowUp`/`ArrowDown`/`Enter`/`Escape`/`Tab` handled centrally. `Enter` is unconditionally `preventDefault`ed so a surrounding `<form>` cannot submit - locked positively and negatively by `combobox-adoption.test.tsx:627-650`.
- **`disabled` flipped true while a panel is open:** reachable at the wizard Finder picker and `LinkGeneratorForm`'s product picker. Not a defect - a real pointer click fires `mousedown` first and the primitive dismisses on document `mousedown`. Locked by `:567-581` using a realistic `mousedown`+`click` pair.
- **`any` casts, `@ts-ignore`, `eslint-disable`: none** in any added line.
- **Swallowed errors:** `createClientByName` / `createAreaByName` use `catch { return null }`. Not a defect introduced here: `apps/web/src/sales-ops` has **no** mutation-error surface at all on `master` either (only `bootstrapQuery.isError`), and the failure degrades to the documented snapshot fallback rather than losing the operator's typing. Pre-existing gap, worth a separate follow-up.
- **Commit hygiene: clean.** One commit, Conventional Commit subject, no co-author trailer, no AI attribution, no em dash in any added line, pt-BR gender correct at every site (`+ Criar nova área` feminine via `entityGender="f"`, `+ Criar novo cliente` / `produto` / `prestador` / `profissional` masculine; the feminine agreement is locked by a test at `:449-470`).

### The one defect

**`CLAUDE.md`, `## UI Controls`, first sentence is false.**

> Every single-select picker in `apps/web/src` uses `Combobox` from `@/components/ui/combobox`.

Two single-select pickers in `apps/web/src` do not:

- `apps/web/src/admin/products/ProductDialog.tsx:132` - product status, Radix `Select`, 2 options.
- `apps/web/src/admin/products/CommissionRuleForm.tsx:94` - commission basis, Radix `Select`, 2 options.

The exclusion is deliberate and reasoned - the slice plan's own text says the frozen legacy trees convert only their data-driven pickers and that "the two closed-enum `Select`s there keep the shadcn `Select`, which is not a native picker and so already satisfies the rule", and the plan's Refactor section says to leave `components/ui/select.tsx` and `@radix-ui/react-select` in place. The exec report also flags it under `notes`. I agree with the engineering decision: a Radix `Select` is not a browser-native picker, so the **user's** stated core rule ("we do not use those standard input pickers") is fully satisfied at every one of the 19 sites, and machine-enforced.

What shipped wrong is the contract text. The plan's step 11 wrote the bullet unscoped and the implementer made it worse by adding the explicit `in apps/web/src` scope, which is precisely the scope that makes it demonstrably false. `CLAUDE.md` is the file that governs every future agent on this codebase; a future reader will believe no Radix `Select` remains. This is a one-line fix, for example:

> Every single-select picker in `src/sales-ops/**` and `src/auth/react.tsx` uses `Combobox` from `@/components/ui/combobox`; it is the only searchable picker in the app. In the frozen legacy trees (`src/admin/**`, `src/finder/**`) only the data-driven pickers converted - two closed-enum shadcn `Select`s remain at `admin/products/ProductDialog.tsx` (status) and `admin/products/CommissionRuleForm.tsx` (basis), which is allowed because a Radix `Select` is not a browser-native picker.

Note that the **ESLint claims** in the same section are all accurate and I probed every one of them (section 3), as is the `<input type="date">` bullet, the geometry bullet (two constants, exactly the stated sites), and the `onCreate` bullet. Only the universality sentence is wrong.

## 10. The confounded pinned-footer assertion

**Diagnosis upheld.**

The wizard body is `SalesOpsApp.tsx:4423`, `className="max-h-[calc(92vh-210px)] overflow-y-auto px-[26px] py-6"`, and the `ProductDialog` body is `:2864`, `"flex min-h-0 flex-1 flex-col gap-[15px] overflow-y-auto px-6 py-[22px]"`. The `Combobox` panel is inline and non-portalled, so at every real call site a create row **is** a descendant of an `.overflow-y-auto` element. A bare `createRow().closest('.overflow-y-auto')` therefore resolves to the dialog body and is non-null - it could never have proved footer pinning at an adoption call site, and in the primitive's own standalone harness it passed only because no ancestor happened to carry the class, which means it would also have passed if the scroll area had been deleted outright. Confounded, exactly as reported.

The fix is correct on both levels:
- `combobox.test.tsx:262-269` now queries `listbox().querySelector('.overflow-y-auto')`, asserts it exists, asserts it does **not** contain the create row, and adds the positive control that it **does** contain `row(0)`. The original bare assertion is kept alongside, which is fine.
- `combobox-adoption.test.tsx:362-368` carries the same panel-scoped pair with the reason written in a comment.

## 11. Left visually unverified (for Gate 3, by eye)

The implementer had no browser. These are the specific things no test in this slice can see. None of them is a reason to fail, but the human should look.

The two claims the implementer names (plan Green step 12):

1. **The create rows working end to end against the real API.** Open `cadastros/produtos` -> new produto and confirm the Área picker searches and the amber `+ Criar nova área "..."` row appears and actually creates. Open `operacional/vendas` -> `Nova proposta` and confirm the Cliente create row creates a cliente that then shows up in `cadastros/clientes`. Everything below the `onCreateClient` / `onCreateArea` boundary is spy-mocked in tests; only the transport was verified by reading.
2. **The two CSS-only claims.** No number field anywhere shows OS spin buttons (the `index.css` base-layer rule, including inside Radix Dialog portals), and the admin/finder Radix `Select` and `DropdownMenu` panels now have a background where `bg-popover` previously emitted nothing.

Three more I would add:

3. **Rendered pixel geometry.** The acceptance clause is proven at class-token level only; happy-dom computes no Tailwind. Worth eyeballing an Itens row and a parcela row, which are the rows that change from 40px to 44px.
4. **The inline panel inside the two `overflow-y-auto` dialog bodies.** A native `<select>` popped an OS layer that floated above everything; the `Combobox` panel is `absolute` inside a scroll container, so opening the picker on the **last** parcela or the **last** profissional row extends the dialog's scroll area rather than floating over it. Inherent to the primitive's approved non-portalled design, not introduced by this slice, but this slice is the first time it appears at those rows.
5. **Two stacked Radix modal dialogs.** The now-wired `Cadastrar produto` button and the produto create row open `ProductDialog` **while** the wizard dialog is still open - a state unreachable on `master`, since that button had no `onClick`. Radix supports nesting, but confirm the backdrop, focus trap and focus-return-to-wizard behave, and that the wizard's in-progress state survives (it should: the remount key is stable).

## 12. Restoration

Everything I mutated or created is gone:

- Deleted `apps/web/src/__verify_probe__.tsx`, `apps/web/src/admin/__probe__/`, `apps/web/src/finder/__probe__/`.
- `git diff HEAD --stat` is **empty** - no tracked file differs from `8dd3273`.
- `git rev-parse HEAD` is `8dd32731896b5d3ed8428f0cbd04fb362a2ddebc`, still on `feat/06-combobox-adoption`. No merge, push, commit or amend.
- `git status --porcelain` shows exactly the two untracked entries that were present when I started: `.vscode/` and `nexo/runs/batch-01K9C0FXA7RQ8VZTN3KDM6WS4E/agents/exec-06-combobox-adoption.result.json`. Identical to the pre-existing state.
- All scratch output (gate logs, the diff dump) lives outside the repo, in the session scratchpad.
- No process was left running; every command was a single run-once invocation.

## 13. Verdict

**FAIL**, and it is a cheap one. Gates are green, the migration is genuinely complete and machine-enforced, not one pre-existing test was weakened (several are materially stronger), the Hub token assertions are byte-identical, every behaviour I was asked to check is preserved with a test pinning it, the remount key and the optimistic-row invariant are untouched and still guarded, scope holds, and the confounded-assertion diagnosis is correct and correctly fixed. Equivalent mutants - the label-for-id translations in `sale-wizard-edit`, the `expect(select).not.toBeNull()` removals in the auth test - are **not** defects, and I say so explicitly.

The single blocker is that the `## UI Controls` section this slice added to `CLAUDE.md` makes a universal claim its own codebase contradicts at two named call sites. Fix that one sentence (the deliberate exception just needs to be written down where the rule is written down) and re-run the four gates; nothing else needs to move.
