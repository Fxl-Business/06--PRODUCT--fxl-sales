# Verify 02-board

Verdict: **PASS** for commit `fe1fc60384bb282c7aee39e54cfb28765a2fb8a4` against `2a5fd3e`.

## Evidence

- Named locked oracle: 4 files, 39 tests passed with `NODE_ENV=test pnpm --filter @fxl-sales/web exec vitest run` and the four plan paths.
- Complete affected web suite: 132 files, 1,773 tests passed with `NODE_ENV=test pnpm --filter @fxl-sales/web test`.
- `pnpm --filter @fxl-sales/web lint` passed.
- `pnpm --filter @fxl-sales/web type-check` passed.
- `git diff --check 2a5fd3e fe1fc60384bb282c7aee39e54cfb28765a2fb8a4` passed.
- A temporary search predicate mutation failed the pure and rendered search tests.
- A temporary disabled `onMove` callback failed the card Mover oracle.
- Both temporary changes were restored; a targeted Mover test passed afterward and `git status --short` was clean before this report.

## Independent inspection

- The routed Funil content area is a bounded `min-h-0` flex column.
  The board fills that parent, the horizontal board scroller hides vertical overflow, and each column's card scroller has `overflow-y-auto` beneath a sibling header.
- Search normalizes accents and case, trims the query, and checks contact name, the resolved company label or snapshot, phone, and email.
  It filters only loaded cards, while server summary badges, totals, and the loaded/total pagination label retain their original scope.
  A column whose loaded cards are hidden gets a search-specific empty state.
- Cards with valid move targets receive a named `Mover` button.
  Its callback opens the existing move dialog and emitter path.
  The card event guard excludes move and menu controls from edit and drag activation while preserving drag from the card surface.
  Converted cards remain read-only.
- The full suite includes existing mouse and touch drag activation cases, converted-card cases, and lost-reason and conversion move cases.

## Revisão

- No live-app screenshot was captured in this Verify pass.
  Visual geometry remains a review item under the dispatch rule that visual access is not a delivery gate.
- The web suite passes but emits existing React `act(...)` and React Router future-flag warnings.
