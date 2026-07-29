# Verify (Gate 2) - slice 03 `combobox-primitive` - attempt 2

Branch `feat/03-combobox-primitive`, one commit `1fb35e9` on top of `master` (`b6ae259`).

**Verdict: PASS.**

## 1. Gates

All run by me on the branch as checked out.

| Gate | Exit |
| --- | --- |
| `pnpm run lint` | 0 |
| `pnpm run type-check` | 0 |
| `CI=true pnpm test` | 0 |

Counts against the branch-point baseline:

| Project | Baseline (b6ae259) | This branch | Delta |
| --- | --- | --- | --- |
| web | 27 files / 152 tests | 28 files / 181 tests | +1 file / +29 tests |
| api | 23 / 215 | 23 / 215 | unchanged |
| shared-utils | 1 / 17 | 1 / 17 | unchanged |

Totals only rose. No test file was removed. The +29 is exactly the 29 `it(` blocks in the one new test file.

## 2. Source really is unchanged from attempt 1

`a7fbcc5` (pre-amend) is reachable via reflog, so this was checked directly rather than inferred.

`git diff --stat a7fbcc5..1fb35e9` touches **only** the test file (55 insertions, 1 deletion - the deletion is the rename of the `does not open when disabled` title).

Blob identity:

| File | pre-amend `a7fbcc5` | amended `1fb35e9` | worktree |
| --- | --- | --- | --- |
| `combobox.tsx` | `b0cfae0d` | `b0cfae0d` | `b0cfae0d` |
| `combobox-filter.ts` | `1239554b` | `1239554b` | `1239554b` |
| `combobox.test.tsx` | `2a731781` | `af6bcfc5` | `af6bcfc5` |

The implementer's claim is accurate: both source files are byte-identical, the remediation was test-only.

## 3. The four attempt-1 mutations, re-run by me

Each mutation was applied to the shipped source, the test file run, then the source restored and re-verified
against the pristine blob hashes above.

| # | Mutation | Result | Test(s) that went Red |
| --- | --- | --- | --- |
| 1 | Create row relocated to be a **sibling** of the `role="listbox"` div (still inside the panel, still `role="option"`, still found by `createRow()`) | **KILLED** (2 failed / 27 passed) | `shows the create row with the typed query when nothing matches`; `keeps the create row visible below the filtered options when some match` |
| 2a | `aria-activedescendant` create branch pointed at `` `${createId}-missing` `` | **KILLED** (2 failed) | `shows the create row...`; `selects the create row with Enter when it is the active row` |
| 2b | `aria-activedescendant` option branch pointed at `optionId(activeRow + 100)` | **KILLED** (4 failed) | `moves the active row with ArrowDown and ArrowUp...`; `wraps the active row at both ends`; `starts with the selected option active when reopening`; `resets the query and the active row on every open` |
| 3 | `if (disabled) return;` removed from **`handleTriggerKeyDown`** | **KILLED** (1 failed) | `does not open when disabled, and lets the key through instead of swallowing it` |
| 4 | Trigger toggle removed: `onClick={() => openPanel()}` | **KILLED** (1 failed) | `closes an open panel when the trigger is clicked again` |

All four attempt-1 findings are now genuinely killed. The vacuous-disabled-test finding was fixed the right
way: the test now drives a **keydown** (which does reach the React handler) instead of relying on a
programmatic click, it additionally asserts `event.defaultPrevented === false` so a disabled control cannot
silently swallow the keystroke, and a **positive control** test (`opens on a trigger keydown when enabled`)
was added so the absence assertion has meaning. That is the correct remediation shape.

## 4. Adjudication: is mutation 3b (`openPanel`'s own `disabled` guard) an equivalent mutant?

**Ruling: the implementer's reasoning is UPHELD. This surviving mutant is an equivalent mutant and must not
be held against the slice.**

I enumerated the callers myself rather than trusting the claim. `grep` for `openPanel` in the shipped source
yields exactly three hits: the declaration at line 150, and two call sites:

1. **line 201**, inside `handleTriggerKeyDown`, which returns at its own `if (disabled) return;` on line 193
   before reaching it.
2. **line 308**, the trigger `<button onClick={() => (open ? closePanel(true) : openPanel())}>`, on an element
   carrying `disabled={disabled}`.

There is no `useImperativeHandle`. The forwarded ref (`setTriggerRef`) publishes only the raw
`HTMLButtonElement`, so no caller can reach `openPanel` through the ref. None of the three effects
(search focus, outside-mousedown dismissal, `scrollIntoView`) calls it. There is no `onFocus`/`onBlur`
handler at all.

Rather than argue this from memory about React's `shouldPreventMouseEvent`, I proved it empirically. I wrote a
throwaway probe that renders `<Combobox disabled>` inside a `<form>` and, in one test, attempts **63 distinct
input paths** to open the panel: `ref.current.click()`, `btn.click()`, dispatched bubbling `click` on the
button / on the inner `<span>` / on the chevron `<svg>`, dispatched `mousedown` and `mouseup`, `focus()`,
`blur()`, dispatched `focus`/`focusin`/`blur`, `form.reset()`, a dispatched `submit`, and dispatched
`keydown`/`keyup` for each of `Enter`, `Space`, `ArrowDown`, `ArrowUp`, `a`, `Escape`, `Tab`, `Home`, `End`
on both the button and its inner span.

- Against **pristine** source: all 63 attempts leave the panel closed. `onChange` and `onCreate` never fire.
- Against the **3b mutant** (`openPanel`'s guard deleted, so `disabled` survives only in
  `handleTriggerKeyDown` and in the JSX `disabled={disabled}`): **all 63 attempts still leave the panel
  closed.**

So no reachable input can invoke `openPanel` while `disabled` is true. The guard is redundant defence, and
deleting it is behaviour-preserving. It is correctly classified as an equivalent mutant, not a coverage hole.
The implementer was also right to leave correct source alone during a test-only remediation and flag it
instead. Keeping the guard is fine as defence-in-depth.

## 5. New mutations I ran

39 mutations attempted by me in total (mutation 1 above plus a 38-mutation driver), **35 killed**.
Beyond the five in section 3, these were killed:

Create row: two create rows rendered instead of one; `+` dropped from the label; `Criar` to `Adicionar`;
gender agreement hard-wired to `novo`; `entityLabel` dropped; the quoting around the query dropped; create row
loses `role="option"`; create row never becomes active (`createIsActive = false`); create row shown for an
empty/whitespace query.

Callbacks / lifecycle: `onChange` also firing on create; panel left open after Enter on create; Escape
committing the active row; Enter losing `preventDefault()` (form submit); Tab gaining `preventDefault()`.

A11y wiring: `aria-expanded` pinned to `false`; `aria-controls` always set even when closed; `aria-controls`
pointing at a wrong id; listbox losing `aria-labelledby`.

Behaviour: no wrap in `moveActive`; search field not focused on open; trigger not refocused on close; query
not reset on open; selected index not restored on reopen; outside-mousedown dismissal removed; description
line excluded from filtering; filtering made case-sensitive; exact-match check made diacritic-insensitive;
`valueLabel` ignored; caller `className` not merged; empty message never shown.

### Survivors (4 of 39) and my assessment

**a. `openPanel` disabled guard removed - EQUIVALENT MUTANT.** Adjudicated in section 4. Not a defect.

**b. `event.nativeEvent.stopImmediatePropagation()` removed from the Escape branch - EQUIVALENT MUTANT.**
The plan claims test 20's ancestor-`onKeyDown` spy locks this call. It does not, so I probed what the call
actually buys. With a **native** `document.addEventListener('keydown', ...)` spy (i.e. exactly the Radix
`DismissableLayer` shape the comment cites):

- pristine: native document listener called **0** times;
- `stopImmediatePropagation` removed but `stopPropagation()` kept: still **0** times;
- **both** removed: native document listener called **1** time, React ancestor called **1** time, and the
  shipped test `closes on Escape ... stops the event from reaching an ancestor` goes **Red**.

React's synthetic `stopPropagation()` forwards to the native event, and React 18 dispatches at the root
container which is below `document`, so `stopPropagation()` alone already prevents a Radix Dialog on
`document` from seeing the Escape. `stopImmediatePropagation()` is genuinely redundant belt-and-braces here.
Crucially, **the load-bearing call is covered**: the suite kills its removal. Not a coverage hole, not a
defect. Worth noting only that the plan slightly overclaims which of the three calls the test pins.

**c. `onCreate?.(query.trim())` to `onCreate?.(query)` - REAL BUT MINOR COVERAGE GAP, not a defect.**
No test commits a create with surrounding whitespace, so the trim on the callback payload is unpinned.
The shipped code is correct (it trims); only the assertion is missing. This is outside the acceptance
criterion, whose query `"adsad"` has no whitespace, and outside the a11y contract, so it does not fail the
slice. Note the divergence it would allow: `createRowLabel` trims independently, so a mutant here would show
`+ Criar novo contato "Maria"` while handing `"  Maria  "` to the handler. Recommend one assertion in the
adoption slice: type `"  Maria  "`, press Enter, expect `onCreate` called with `"Maria"`.

**d. `overflow-y-auto` removed from the options scroll container - REAL WEAK ASSERTION, not a defect.**
Test 10 asserts `createRow()!.closest('.overflow-y-auto')` is `null`. That is a negative assertion with no
positive control: delete the class from the scroll container entirely and it stays green. The plan states this
assertion locks the pinned-footer design; it does not. The pinning itself is real in the source, and the
criterion clause that *does* matter (create row inside the listbox) is strongly pinned - mutation 1 killed it
via two tests. Layout/scroll behaviour is not observable in happy-dom anyway. Recommend adding the positive
half: assert the options container itself carries `overflow-y-auto` and that the create row is not a
descendant of it.

None of the four survivors is a defect and none is a hole on a criterion clause or on the a11y contract.

## 6. Acceptance criterion

Proven in full. Options Valéria / Vinícius / Bruno, `onCreate`, `entityLabel="contato"`:

| Clause | Where | Mutation that pins it |
| --- | --- | --- |
| opens with the keyboard | `opens on ArrowDown, Enter and Space from the trigger`, `opens on a trigger keydown when enabled` | m3, n17 |
| typing `adsad` matches no option row | `expect(optionRows()).toHaveLength(1)` with `row(0) === createRow()` | n23, n24 |
| a **single** row reading exactly `+ Criar novo contato "adsad"` | `textContent.trim()` equality | n1, n2a-n2e |
| visually prominent | amber `bg-[#fdf7e8]` / `text-[#9c7210]`, plus the `className` merge test | n28 |
| rendered **inside the listbox** | `listbox()!.contains(createRow())` | mutation 1 (killed, 2 tests) |
| **as the active descendant** | `activeDescendant() === createRow()!.id` | m2a, n10, n12 |
| Enter calls `onCreate('adsad')` | `toHaveBeenCalledWith('Cliente Novo')`, times 1 | n4, n5 |
| ...and closes the panel | `expect(listbox()).toBeNull()` + focus returns to trigger | n5, n18 |
| Escape closes without `onChange` or `onCreate` | dedicated test, both spies asserted not called | n6 |

## 7. Anti-gaming

`git diff master..feat/03-combobox-primitive -- '*test*'` adds one file and modifies none - there was no
pre-existing test to weaken. The amend diff (section 2) is purely **additive** assertions plus one test
renamed and strengthened plus two new tests; nothing was loosened. No `.only`, `.skip`, `.todo`, `xit` or
`xdescribe` anywhere in the file. No `vi.mock` at all - every assertion is a real DOM query against real
rendered markup, which is why the mutation kill rate is high. The new tests are not trivially satisfiable:
35 of 39 hostile mutations went Red.

## 8. Scope discipline

Per `### Scope limits (YAGNI)` in `00-OVERVIEW.md`, plus the slice-03 `## Out of scope`:

- Exactly **three** files, all under `apps/web/src/components/ui/`. Confirmed by `--name-status`.
- `SalesOpsApp.tsx` untouched (not in the diff at all).
- No multi-select: `value: string | null`, single `onChange`; no `multiple`/`string[]` anywhere.
- **No new dependency.** `apps/web/package.json`, `pnpm-lock.yaml`, `package.json` and
  `apps/web/vite.config.ts` are all byte-identical to master (empty `git diff --stat`). No `cmdk`, no
  `@radix-ui/react-popover`.
- No api, propostas, payables, auth, tenancy, `navigation.ts` or legacy-route changes - impossible given the
  three-file diff.

## 9. Remaining correctness review

No defects found.

- **Controlled-value semantics.** No internal selected state; the trigger renders from `value` via
  `options.find`, falling back to `valueLabel` then `placeholder`. If the parent does not update `value`
  after `onChange`, the trigger correctly keeps showing the old label - standard controlled behaviour, not a
  bug. `valueLabel` is the deliberate escape hatch for a just-created value not yet in `options`.
- **Create row on a partial match.** `shouldShowCreateRow` keys off exact label equality over the **full**
  option list, not the filtered list, so `Val` shows both `Valéria` and the create row. Covered and pinned.
- **Stale closures / active-index when the list changes while open.** Clean. `activeRow` is **derived** on
  every render (`Math.min(activeIndex, navigableCount - 1)`), not stored, and `moveActive` re-clamps `from`
  the same way inside its updater. So if `options` shrinks while the panel is open with a high active index,
  the active row clamps into range instead of dangling, and `aria-activedescendant` degrades to `undefined`
  when `navigableCount === 0` rather than pointing at a removed id. No effect-dependency bug: `groups`/
  `filtered` memo on `[options, query]` and `showCreate` on `[options, query, onCreate]`, both complete.
- **`onCreate` on an empty/whitespace query.** Unreachable. `shouldShowCreateRow` returns `false` for a
  trimmed-empty query, so `showCreate` is false, so `createIsActive` is false and `commitActiveRow` cannot
  route to `commitCreate`; the row that carries the `onClick` is not rendered at all. Pinned by n16.
- **No `any`, no `as any`, no `@ts-expect-error`, no `@ts-ignore`, no `eslint-disable`** in any added line.

Minor observation, not a defect and not in scope for this slice: if a parent flips `disabled` to `true`
**while** the panel is already open, the trigger becomes disabled but the panel stays mounted and the search
input is not disabled, so keyboard commit still works. Reaching that requires an unusual parent, no call site
exists yet (adoption is slice 06), and it is outside the criterion. Flagging for slice 06 only.

## 10. Commit hygiene

- Exactly **one** commit ahead of master.
- Conventional Commit: `feat(ui): add searchable Combobox primitive with explicit create-new row`.
- Author and committer both `CauetPinciara <cauetpinciara@gmail.com>`. No `Co-Authored-By`, no
  `Generated with`, no Claude/Anthropic/robot attribution.
- No em dash in any added line (checked with a `\x{2014}` grep over the `+` lines).
- The body documents the trigger-toggle deviation, which is now also **tested** (m4 kills its removal).

## 11. Restoration

Every probe and mutation was reverted.

- Both source files restored from pristine copies and re-verified by `git hash-object` after **every**
  mutation (the driver asserts the two expected hashes each cycle and would have aborted otherwise):
  `combobox.tsx` = `b0cfae0d9803fbb23e6fe02dad253ad52e14d877`,
  `combobox-filter.ts` = `1239554bb72bfe06cad44044b72df9624caeb327`.
- The throwaway probe `apps/web/src/components/ui/__tests__/zz-probe.test.tsx` was deleted. It did **not**
  exist in the start-of-session `git status`, so creating and removing it is net-zero; I did not delete
  another slice's file. The `__tests__` directory now contains only `combobox.test.tsx`,
  `dialog-close-affordances.test.tsx` and `dialog-outside-close.test.tsx`.
- `git diff HEAD` is **empty**. `git status --porcelain` is identical to what I found at session start:
  `?? .vscode/`, `?? nexo/.../agents/exec-03-combobox-primitive.result.json`,
  `?? nexo/.../agents/verify-03-combobox-primitive.result.json`, `?? nexo/.../verify-03.md`.
- Final confirming run on the restored tree: 29/29 green.
- Nothing merged, pushed, committed, amended or rebased. Still on `feat/03-combobox-primitive`. All
  scratch artefacts (driver, logs, pristine copies) live in the session scratchpad, outside the repo.
- No long-running process left behind: every vitest invocation was `vitest run` (run-once, never a watcher),
  and the two backgrounded gate commands both exited on their own.
