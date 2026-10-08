# Exec 04-web-visual-polish

Branch `feat/20261008T114022Z-04-web-visual-polish`, worktree `.worktrees/20261008T114022Z-construbom-leads-ajustes/04-web-visual-polish`, base `a146f13` (integrated wave 1).

## Commits

- `17ff17a` fix(leads): give the Cliente line its own full-width row on the leads-edition card (`LeadCard.tsx`, `leads-contact-board.test.tsx`)
- `7c1d7ab` fix(ui): draw a single divider above the Combobox create row when nothing matches (`combobox.tsx`, `combobox.test.tsx`)
- `45f27b8` fix(leads): keep + Adicionar item livre on one line in the lead dialog (`LeadDialog.tsx`, `lead-dialog.test.tsx`)

Exactly the six files in the plan's `files_modified`; nothing else changed.
No co-author line, no agent name.

## Red first

Wrote the three tests the plan names plus the `border-t` extension, then ran the three files before any source change.
Four tests failed, each for the intended reason:
- `renders a single divider above the create row when nothing matches`: the `.overflow-y-auto` scroll area was still rendered.
- `keeps the Cliente line out of the value row so a long name is never squeezed`: `valueRow.contains(client)` was `true`.
- `keeps + Adicionar item livre on one line`: the button had no `whitespace-nowrap`.
- `shows the value beside the menu, formatted like the full card` (updated, see Deviations): the value row's first child was still the old name + Cliente column.

The `border-t` extension of `keeps the create row visible below the filtered options when some match` passed before and after, as a guard against over-removal.

## Green

Applied the plan's markup verbatim.
- `LeadCard.tsx`: leads-edition branch only; `clientLabel = contact ? leadClientLabel(lead, lookups) : undefined` computed once at the top (`undefined` instead of skipping the call keeps `title` typed `string | undefined`).
  `git diff a146f13` shows the full-edition branch byte-identical.
- `combobox.tsx`: `listHasRows = filtered.length > 0 || !showCreate`; the scroll area renders only when `listHasRows`; the create section is `cn('p-1', filtered.length > 0 && 'border-t border-border')`.
- `LeadDialog.tsx`: `pt-2.5` on the `Produto não cadastrado` group; `${secondaryButtonClass} shrink-0 whitespace-nowrap` on `+ Adicionar item livre`.

## Verification (run-once)

- Oracle list (8 files): 8 files, 148 tests passed (`CI=true pnpm --filter @fxl-sales/web exec vitest run <8 files>`).
- Neighbours, as a guard for the full suite: `src/sales-ops/leads`, `src/components/ui`, `combobox-adoption`, `product-service-dialog`, `optimistic-row-guard`: 40 files, 532 tests passed.
- `pnpm --filter @fxl-sales/web run type-check` (tsc --noEmit): exit 0.
- eslint on the six changed files: exit 0, no output.
- Em dash over the added lines of the diff: 0.

## Visual check (real Chrome)

Throwaway Vite harness on port 8143 (no API, no DB, no shared port), started with `node_modules/.bin/vite` directly to avoid pnpm's pre-run install check.
Files deleted afterwards and never staged; Vite and its esbuild child stopped by process group (`kill -- -88104`); the Chrome tab I opened was closed.
The orchestrator's tab on 8006 was not touched.
- Leads-edition card at the real column width: `VILLA CONSTRUTORA E INCORPORADORA LTDA` now wraps across the full card width on two lines; a longer name clamps with an ellipsis on line two; the birthday sits under it; the value and menu stay top right; `Sem cliente` uses the same line.
- `Combobox` with `onCreate`, query `Obra Nova Ltda` (no match): one divider (the search field's) above `+ Criar novo cliente "Obra Nova Ltda"`, no empty strip.
  Query `Constr` (two matches): the divider between the options and the create row is still there.
- Full-edition `LeadDialog`: `+ Adicionar item livre` is one line (`white-space: nowrap`, one client rect); the field labels sit 82-83px apart all the way down (178, 260, 343, 425, 508, 590), and the produtos row to `Produto não cadastrado` gap is exactly 16px.

## Deviations

- `leads-contact-board.test.tsx` > `shows the value beside the menu, formatted like the full card` asserted the OLD layout (`[data-lead-client]` has `truncate`, its parent has `min-w-0` and `flex-1`), which the plan's markup removes by design.
  Its last three assertions were replaced with the new layout's contract from the acceptance ("name min-w-0 and wraps"): the value group's parent is the `justify-between` row, and its first child is the contact name with `min-w-0` and `break-words`.
  The value, menu and `shrink-0` assertions are unchanged.
  This file is in `files_modified`; no other test was edited beyond what the plan names.

## Observations outside this slice (not changed)

- In the full `LeadDialog` both secondary buttons (`Adicionar` and `+ Adicionar item livre`) are 38px tall beside 44px inputs (`secondaryButtonClass` versus `formSelectClass`/`formInputClass`).
  It is consistent between the two rows and was not part of the reported defect, so it is left as is.
