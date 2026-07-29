# Verify report - slice 03-combobox-primitive

Branch `feat/03-combobox-primitive`, single commit `a7fbcc5` on `master` (`b6ae259`).

**Verdict: FAIL** - on test evidence, not on product behaviour.

The shipped component is, as far as I could determine, functionally correct on every clause of the acceptance criterion.
I proved that directly against the rendered DOM.
It fails the gate because three specific things the acceptance criterion names as load-bearing are not actually pinned by any test: I broke each of them in the implementation and the whole 27-test suite stayed green.

## 1. Gates

All run from the repo root on the branch tip.

| Gate | Exit |
| --- | --- |
| `pnpm run lint` | 0 |
| `pnpm run type-check` | 0 |
| `CI=true pnpm test` | 0 |

Counts, against the stated branch-point baseline:

| Package | Baseline | Branch | Delta |
| --- | --- | --- | --- |
| web | 27 files / 152 tests | 28 files / 179 tests | +1 file, +27 tests |
| api | 23 / 215 | 23 / 215 | unchanged |
| shared-utils | 1 / 17 | 1 / 17 | unchanged |

Totals only went up.
No test file was removed.
The suite was run twice (before and after all mutation work) and was green both times, so no flakiness observed.

## 2. Are the tests real evidence?

Mostly yes, and emphatically so.
I ran 29 mutations against `combobox.tsx` / `combobox-filter.ts`, restoring the pristine file after each one.
**25 of them went Red.** That is a genuinely strong behavioural oracle, and the test file mocks nothing: it renders the real `Combobox` into a real container and queries real DOM. `vi.fn()` is used only for the `onChange` / `onCreate` callbacks and for an ancestor `onKeyDown` spy, which is exactly right.

Representative Red mutations (mutation -> the single test that caught it):

| Mutation | Result |
| --- | --- |
| `Escape` also commits the active row | Red - "closes on Escape without selecting..." |
| gender agreement hardcoded to `nova` | Red - "shows the create row with the typed query..." |
| gender agreement hardcoded to `novo` | Red - "uses feminine agreement when entityGender is f" |
| `commitCreate` no longer closes the panel | Red - "selects the create row with Enter..." |
| create row commits `onChange` instead of `onCreate` | Red - same test |
| `shouldShowCreateRow` ignores the exact-label match | Red - "hides the create row when the query exactly matches..." |
| `shouldShowCreateRow` ignores the missing handler | Red - 3 tests |
| `shouldShowCreateRow` ignores the empty query | Red - "hides the create row when the query is empty or whitespace only" |
| create label drops the quotes / the trim | Red - 2 tests |
| outside `mousedown` no longer closes | Red - "closes on outside mousedown..." |
| `Tab` no longer closes | Red - "closes on Tab without selecting..." |
| `moveActive` clamps instead of wrapping | Red - "wraps the active row at both ends" |
| reopen no longer resets the query | Red - "resets the query and the active row on every open" |
| normalizer stops stripping diacritics | Red - 2 tests |
| filtering removed entirely | Red - 8 tests |
| `aria-expanded` removed | Red - 3 tests |
| `aria-controls` always present (not gated on open) | Red - "renders a closed trigger..." |
| `role="option"` -> `role="listitem"` | Red - 12 tests |
| `role="listbox"` -> `role="group"` | Red - 6 tests |
| `aria-activedescendant` never set | Red - 4 tests |
| listbox loses `aria-labelledby` | Red - "takes its accessible name from a Label..." |
| search focus not moved on open | Red - "opens on trigger click, focuses the search field..." |
| focus not returned to trigger on close | Red - 3 tests |
| reopen ignores the selected option | Red - "starts with the selected option active when reopening" |
| caller `className` not merged | Red - "matches the Input box styling..." |

So the bar is high. That makes the four survivors below meaningful rather than nitpicking - they are the exact holes in an otherwise tight net.

### Survivor 1 (blocking) - the create row can leave the listbox

I moved the whole `{showCreate ? ... : null}` block out of the `<div role="listbox">` and into the panel wrapper next to it.
The create row then becomes an orphan `role="option"` with no owning listbox - a real ARIA violation, and it also invalidates the `aria-activedescendant` contract, which requires the referenced element to be inside the controlled listbox.

**All 27 tests stayed green.**

Cause: every create-row and option-row query in the test file is scoped to `container`, never to the listbox:

```ts
function createRow(): HTMLElement | null {
  const el = container.querySelector('[data-combobox-create="true"]');
```
```ts
function optionRows(): HTMLElement[] {
  return [...container.querySelectorAll('[role="option"]')]
```

There is no `expect(listbox()!.contains(createRow())).toBe(true)` anywhere.
The nearest assertion, `expect(createRow()!.closest('.overflow-y-auto')).toBeNull()` (line 251), only proves the row is outside the *scroll* container - it is satisfied by the broken arrangement too.

### Survivor 2 (blocking) - the create row need not be the active descendant

I replaced

```ts
const activeDescendantId =
  navigableCount === 0 ? undefined : createIsActive ? createId : optionId(activeRow);
```

with

```ts
const activeDescendantId = navigableCount === 0 ? undefined : optionId(activeRow);
```

In the acceptance scenario (query `adsad`, zero filtered options) this makes `aria-activedescendant` point at `<baseId>-option-0`, an id that does not exist in the document. A screen reader announces nothing at all for the create row.

**All 27 tests stayed green.**

Cause: `activeDescendant()` is asserted in four tests, all of them for *option* rows (lines 312, 316, 322, 334, 337, 346, 456). It is never once asserted for the create row. The create row's activeness is only checked indirectly, by the fact that `Enter` commits it - which routes through `createIsActive`, not through `activeDescendantId`.

### Survivor 3 (blocking, vacuous test) - "does not open when disabled"

```ts
it('does not open when disabled', async () => {
  await renderCombobox({ disabled: true });
  expect(trigger().disabled).toBe(true);
  await open();
  expect(listbox()).toBeNull();
});
```

I deleted `if (disabled) return;` from `openPanel()`. **Green.**

This is the vacuous-absence pattern the brief warns about. The programmatic `click` dispatched on a `disabled` button never reaches React's handler, so `openPanel` is not called whether or not the guard exists. The assertion therefore tests the browser's native `disabled` attribute - which the test's own first line already asserts - and nothing about the component. Both `disabled` guards in the source (`openPanel` line 151 and `handleTriggerKeyDown` line 193) are unexercised.

A version that would bite: assert the panel stays closed after a `keydown` on the trigger, and/or flip `disabled` to false and confirm the same interaction *does* open the panel, establishing that the interaction is capable of opening it.

### Survivor 4 (not blocking on its own) - the toggle deviation is untested

I replaced `onClick={() => (open ? closePanel(true) : openPanel())}` with `onClick={() => openPanel()}`. **Green.** The `open()` helper always clicks from the closed state, so no test ever clicks the trigger while the panel is open. See the deviations section.

## 3. Acceptance criterion, clause by clause

I ran a throwaway probe (`apps/web/src/components/ui/__tests__/zz-probe-verify.test.tsx`, since deleted) that opens the combobox **with the keyboard** exactly as the criterion words it, types `adsad`, and dumps the real markup. Result, verbatim from the probe:

```
trigger role              : combobox
trigger aria-expanded     : true
trigger aria-controls     : :r0:-listbox
listbox id                : :r0:-listbox
aria-controls === lb id   : true
search aria-activedesc    : :r0:-create
activedesc resolves       : true
activedesc === create row : true
activedesc role           : option
createRow inside listbox  : true
option rows total         : 1
create rows total         : 1
create text               : "+ Criar novo contato \"adsad\""
after Enter onCreate calls : [["adsad"]]
after Enter onChange calls : []
after Enter listbox null   : true
after Escape listbox null  : true
after Escape onCreate calls: 0
after Escape onChange calls: 0
```

| Clause | Behaviour correct? | Pinned by a test? |
| --- | --- | --- |
| no option row matches | yes | yes (line 231, `optionRows()` length 1 and row 0 is the create row) |
| exactly ONE create row | yes | yes (lines 231-232) |
| ...rendered **inside the listbox** | yes | **NO - survivor 1** |
| text is exactly `+ Criar novo contato "adsad"` | yes | yes (line 230, exact `toBe` on trimmed text) |
| it is the `aria-activedescendant` | yes | **NO - survivor 2** |
| `Enter` calls `onCreate('adsad')` | yes | yes (lines 362-363) |
| `Enter` closes the panel | yes | yes (line 365) |
| `Escape` closes without `onChange` or `onCreate` | yes | yes (lines 391-398) |
| opened with the keyboard | yes | partially - keyboard open is covered on its own (line 168) but never composed with the create-row scenario; both paths funnel through `openPanel()`, so I do not count this as a hole |

Two clauses unproven.

## 4. A11y wiring, read off the markup

Verified directly, not through the tests:

- trigger: `role="combobox"`, `aria-expanded` flips false/true, `aria-haspopup="listbox"`, `aria-controls` present only while open and exactly equal to the listbox id.
- panel: `role="listbox"` with `aria-labelledby` pointing at the trigger id; option rows carry `role="option"` and `aria-selected`; group wrappers carry `role="group"` with `aria-labelledby` at a heading that exists and is inside the panel (the test uses `document.getElementById`, correctly avoiding a colon-bearing CSS selector).
- `aria-activedescendant` lives on the search input (correct for a combobox whose focus stays in the text field) and resolves to a real element that is inside the listbox and has `role="option"`, including for the create row.
- accessible name: with `id` + `aria-labelledby` + a `<Label htmlFor>` the name resolves; with no props the name falls back to the trigger's own text content (the placeholder). Documented in the prop JSDoc, and the label path is tested.
- `React.useId` ids do contain colons (confirmed: `:r0:`). Nothing in the shipped code builds a `#id` selector - the one `querySelector` in the component is `[data-active="true"]`, an attribute selector. Clean.

Minor, non-blocking: the two `role="presentation"` wrapper divs between the listbox and its options rely on presentation-role children being re-parented. Standard, widely used, fine.

## 5. Keyboard and interaction completeness

Covered and tested: type-to-filter, Up/Down with wrap, Enter to select, Enter on the create row, Escape to close (with `stopPropagation` + `stopImmediatePropagation` so a surrounding Radix Dialog does not also close), Tab to close without `preventDefault`, outside `mousedown` to close, Enter never submitting a surrounding `<form>`, query and active row reset on each open, focus to the search field on open and back to the trigger on close.

No stuck-open state: Escape, Tab, outside mousedown, and a trigger click all close the panel.

One robustness nit I could not fully verify under happy-dom: option rows and the create row call `event.preventDefault()` on `onMouseDown` to keep focus in the search field, but the group headings, the `border-t` wrapper and the scroll container padding do not. In a real browser, a mousedown on that padding would move focus to `<body>` while the panel stays open, after which Escape is no longer handled. Not a lock-in (outside click and trigger click still close it) and not a FAIL, but worth a `preventDefault` on the panel wrapper.

## 6. pt-BR correctness

- Both genders are implemented (`entityGender === 'f' ? 'nova' : 'novo'`) and both are independently pinned: hardcoding `nova` reddens the masculine test, hardcoding `novo` reddens the feminine test. This is the correct shape - a single-gender test would have let a hardcode through.
- No em dash anywhere in the added lines. I scanned every added line for non-ASCII codepoints; the only ones present are `é`, `í`, `á` in prop docs and a comment. `U+2014` count: zero.
- No English user-facing string. Defaults are `Selecionar...`, `Buscar...`, `Nenhum resultado encontrado.`. The `entityLabel` default is `'item'`, which is a valid pt-BR word.

Nit: `entityLabel` defaulting to `'item'` means a slice-06 call site that forgets the prop silently ships `+ Criar novo item "..."` rather than failing loudly. Consider making it required whenever `onCreate` is passed.

## 7. Anti-gaming

`git diff master..feat/03-combobox-primitive -- '*test*'` contains additions only - the sole `-` line in the whole diff is the `--- /dev/null` header. `--numstat` confirms `526/0`, `119/0`, `389/0`: 1034 insertions, zero deletions, across three new files. No `.only`, `.skip`, `.todo`, `xit`, `fit`, or `eslint-disable` anywhere in the added code. No pre-existing test was touched, let alone weakened.

## 8. Scope discipline

Clean.

- Exactly three new files, all under `apps/web/src/components/ui/`: `combobox.tsx`, `combobox-filter.ts`, `__tests__/combobox.test.tsx`.
- `apps/web/src/sales-ops/SalesOpsApp.tsx` untouched. No existing picker touched. No number input touched. No api change, no propostas/payables change, no auth/tenancy change, no `navigation.ts`, no legacy route trees, no i18n extraction.
- No new dependency. `apps/web/package.json` and `pnpm-lock.yaml` are byte-identical to `master`; `cmdk` and `@radix-ui/react-popover` appear in neither, nor anywhere else in the repo. `apps/web/vite.config.ts` untouched. The only imports are `react`, `lucide-react` and `@/lib/utils`, all already in use.
- No multi-select. `value` is `string | null`, `onChange` is `(value: string) => void`; no `multiple`/`multi`/`string[]` surface exists.

## 9. Correctness review of the component

I found **no correctness defect** in the component. Specifically checked:

- **Controlled semantics.** If the parent does not update `value` after `onChange`, the trigger keeps showing the placeholder. That is the correct behaviour for a controlled input, and `valueLabel` is the documented escape hatch for a value with no matching option (tested at line 149).
- **Create row when the query matches some but not all options.** Correct: it renders below the filtered options, outside the scroll container, and is reachable by Down-arrowing past the last option because `moveActive` wraps modulo `navigableCount = filtered.length + 1` (tested at line 243).
- **Stale index / effect deps.** No bug. `activeRow` is derived and clamped every render via `Math.min(activeIndex, navigableCount - 1)`, and `moveActive` re-clamps its own starting point, so an option list shrinking under an active index cannot produce an out-of-range row or a dangling descendant id. `handleQueryChange` resets the index to 0 on every keystroke. The one cosmetic wrinkle: the raw `activeIndex` state is preserved, so if the parent shrinks then re-grows the list while the panel is open, an older larger index resurfaces. Harmless.
- **`onCreate` with an empty or whitespace-only query.** Cannot happen. `shouldShowCreateRow` returns false for an empty trimmed query, `createIsActive` requires `showCreate`, and `commitCreate` is otherwise only reachable by clicking a row that is not rendered. Probe confirmed: with the query set to `'   '`, Enter yields `onCreate` calls `0`. (It commits the highlighted first option instead, which is standard combobox behaviour and matches what is visibly highlighted.)
- **Type hygiene.** No `any`, no `@ts-expect-error`, no `@ts-ignore`, no swallowed error, no `eslint-disable` in any of the three files. The two casts in the test file (`React & { act }`, `globalThis & { IS_REACT_ACT_ENVIRONMENT }`) are narrow intersection casts for harness plumbing, not `any`.
- **Commit hygiene.** Exactly one commit. `feat(ui): add searchable Combobox primitive with explicit create-new row` - valid Conventional Commit, 66 chars. No `Co-Authored-By` trailer, no AI attribution, author and committer both `CauetPinciara <cauetpinciara@gmail.com>`. The body is long but substantive and records three real decisions.

## Deviations judged

**Trigger toggles rather than only opens: accepted on merit, but untested.** This is the right behaviour - the WAI-ARIA combobox pattern has the trigger toggle, and it gives a mouse user an obvious way to dismiss the panel. It is a genuine improvement over the plan. But it is dead to the test suite: replacing the toggle with an open-only handler leaves all 27 tests green, because `open()` only ever clicks from the closed state. One test (click trigger, assert open; click trigger again, assert closed and `onChange` not called) closes this.

**File longer than the plan estimated: accepted, no concern.** 389 lines for `combobox.tsx` is proportionate for a fully keyboard-operable ARIA combobox with grouping, descriptions and a create affordance, and the author already did the right structural thing by extracting the pure filtering/labelling logic into a separate 119-line module - both for testability and to keep `react-refresh/only-export-components` satisfied. Length here is not a smell.

## What would flip this to PASS

Three assertions, no source change needed:

1. In "shows the create row with the typed query when nothing matches": `expect(listbox()!.contains(createRow())).toBe(true)` and `expect(activeDescendant()).toBe(createRow()!.id)`.
2. Rewrite "does not open when disabled" so it can fail - drive it from a trigger `keydown`, and/or establish that the same interaction opens the panel when `disabled` is false.
3. Optionally, a trigger-toggle test to cover the reported deviation.

I would expect a re-verify of a fixed version to pass: the implementation is right, the net just has three holes in it.

## Tree state

Every mutation was applied by writing a pristine copy back afterwards, and every probe file was removed.

- Probe file `apps/web/src/components/ui/__tests__/zz-probe-verify.test.tsx` - **deleted**, confirmed.
- `git diff --stat HEAD` - empty. The working tree matches `a7fbcc5` exactly.
- `git hash-object` on all three files matches the values recorded before any mutation: `b0cfae0d9803fbb23e6fe02dad253ad52e14d877` (`combobox.tsx`), `1239554bb72bfe06cad44044b72df9624caeb327` (`combobox-filter.ts`), `2a7317819d10ad927705ff74504c51443a1f65bc` (the test file).
- `git status --porcelain` shows `?? .vscode/` and `?? nexo/runs/.../exec-03-combobox-primitive.result.json`. `.vscode/` was already untracked when I started; the exec result file is the implementer's own run artefact. Neither is mine and neither was modified. This matches the state I found, plus my own result file.
- Still on `feat/03-combobox-primitive`. Nothing merged, pushed, committed, or amended.
- The full suite was re-run after all mutation work and is green (exit 0), confirming nothing was left mutated.
- All temporary logs and file backups were written under the session scratchpad, outside the repo.
