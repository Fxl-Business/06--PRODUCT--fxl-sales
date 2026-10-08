# Verify 04-web-visual-polish (Gate 2)

Verdict: PASS.

## Target

Worktree `.worktrees/20261008T114022Z-construbom-leads-ajustes/04-web-visual-polish`, branch `feat/20261008T114022Z-04-web-visual-polish`.
Commits `17ff17a`, `7c1d7ab`, `45f27b8` on base `a146f13` (integrated wave 1); HEAD stayed `45f27b8` throughout.
Contract: `run/nexo/plans/construbom-leads-ajustes/04-web-visual-polish.md`.

## 1. Scope

`git diff --name-only a146f13..HEAD` lists 6 files, all inside the plan's `files_modified`.
Nothing under `nexo/` is touched.
Added lines carrying U+2014: 0; commit messages carrying U+2014: 0; commit messages carrying a co-author line: 0.
The full-edition branch of `LeadCard.tsx` (base lines 266-282, head lines 277-293) is byte-identical to `a146f13` by `diff`.
Everything above the `contact ? (` branch differs only by the added `clientLabel` const, and everything after the ternary is byte-identical.

## 2. Oracle (whole list, twice)

Command: `CI=true pnpm --filter @fxl-sales/web exec vitest run` over the 8 oracle files of the plan.
Run 1: 8 files passed, 148 tests passed, 0 failed.
Run 2: 8 files passed, 148 tests passed, 0 failed.
No timeout, so no single-file rerun was needed.

## 3. Lint and types

`pnpm exec eslint --max-warnings=0` on the 6 changed files (from `apps/web`): exit 0, no output.
`pnpm --filter @fxl-sales/web run type-check` (`tsc --noEmit`): exit 0.

## 4. Contract

Red-first check: the 3 product files were restored to `a146f13` with the HEAD tests kept, then the 3 changed test files ran.
Result: 4 failed, 66 passed, and the 4 failures are exactly the new or rewritten assertions.
The failures were `keeps the Cliente line out of the value row so a long name is never squeezed`, `shows the value beside the menu, formatted like the full card`, `renders a single divider above the create row when nothing matches` and `keeps + Adicionar item livre on one line`.
The product files were then restored with `git checkout HEAD --`.
Cliente line outside the value row, `line-clamp-2`, `break-words`, no `truncate`, `title` equal to the full label, and the birthday right under it, for both a long name and `Sem cliente`: asserted in `leads-contact-board.test.tsx`.
Name row keeps the value and menu group (`shrink-0`) on its right, with the name `min-w-0 break-words`: asserted in the rewritten Quadro test.
Combobox with no match plus `onCreate`: no `.overflow-y-auto` in the listbox and no `border-t` on the create section, with the search field's `border-b` as a positive control: asserted in `combobox.test.tsx`.
Combobox with some matches plus `onCreate`: the create section keeps `border-t`, asserted by the extended existing test.
Combobox with no match and no `onCreate`: the empty message still renders, held by the existing `shows the empty state instead of a create row when onCreate is absent`.
Keyboard navigation over the create row: `createIndex`, `navigableCount`, `activeRow` and the `scrollIntoView` effect (which queries `panelRef`, not the scroll area) are untouched, and the existing Enter-on-create, active-descendant, ArrowUp/ArrowDown and wrap tests stay green.
LeadDialog button `whitespace-nowrap` and `shrink-0`, and the free-item group `pt-2.5`: asserted in `lead-dialog.test.tsx`.
The diff changes layout classes and the conditional render of an empty strip only, with no copy change.

## 5. Mutation probes

Driver: a scratch Python script applied each mutant with an exact-anchor replacement (anchor count checked to be 1), ran the whole 8-file oracle list, and restored the file with `git checkout --`.
15 mutants applied, 15 killed, 0 survivors.
M01, client line moved back into a name column inside the value row: killed by `keeps the Cliente line out of the value row...` and `shows the value beside the menu...`.
M02, `title` dropped from the Cliente line: killed by `keeps the Cliente line out of the value row...`.
M03, `title` set to the contact name: killed by `keeps the Cliente line out of the value row...`.
M04, `line-clamp-2 break-words` replaced by `truncate`: killed by `keeps the Cliente line out of the value row...`.
M05, `break-words` dropped from the Cliente line: killed by `keeps the Cliente line out of the value row...`.
M06, `min-w-0` dropped from the name: killed by `shows the value beside the menu...`.
M07, `break-words` dropped from the name: killed by `shows the value beside the menu...`.
M08, birthday moved above the Cliente line: killed by `keeps the Cliente line out of the value row...`.
M09, scroll area always rendered (`listHasRows = true`): killed by `renders a single divider above the create row when nothing matches`.
M10, scroll area only with matches (empty message lost): killed by `shows the empty state instead of a create row when onCreate is absent`.
M11, create section always `border-t`: killed by `renders a single divider above the create row when nothing matches`.
M12, create section never `border-t`: killed by `keeps the create row visible below the filtered options when some match`.
M13, `whitespace-nowrap` dropped from the button: killed by `keeps + Adicionar item livre on one line`.
M14, `shrink-0` dropped from the button: killed by `keeps + Adicionar item livre on one line`.
M15, `pt-2.5` dropped from the free-item group: killed by `keeps + Adicionar item livre on one line`.
Each mutant run reported 1 failed and 7 passed files (M01 had 2 failed tests in that file), so no mutant broke an unrelated oracle.

## 6. Tree state

`git status --porcelain` is empty after every probe and at the end.
No process was left running: every command was a run-once `vitest run`, `eslint` or `tsc --noEmit` that exited on its own, and no dev server or port was used.

## Notes

The oracle proves class names and DOM structure, not rendered pixels.
A real-browser check of the clamp and the single divider is out of scope for this gate and belongs to the orchestrator's end-to-end pass.
