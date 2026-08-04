# exec-01 notes — slice 01-produto-wizard-step3

## What changed

`apps/web/src/sales-ops/SalesOpsApp.tsx` (`ProductDialogBody`):

- Imported `type KeyboardEvent as ReactKeyboardEvent` from `react` alongside the existing
  `FormEvent` / `ReactNode` type imports.
- Added `handleWizardKeyDown`, placed right after `goBackProductWizard` and before `submit`,
  exactly as planned. It ignores anything but a plain `Enter` on a focused `<input>`, defers
  to any earlier handler that already called `preventDefault()` (this is what leaves
  `Combobox`'s own Enter-to-commit behaviour alone), lets `Enter` fall through unmodified on
  the last step, and otherwise calls `preventDefault()` + `advanceProductWizard()`.
- Wired `onKeyDown={handleWizardKeyDown}` onto the single `<form>` at what was line 3792,
  keeping the file's alphabetical JSX prop order (`className`, `onKeyDown`, `onSubmit`).

No change to `submit()`, `SaveProductPayload`, any button `type`, or the "one form around the
whole step tree" design, matching the plan's YAGNI section.

## Test (Red -> Green)

`apps/web/src/sales-ops/__tests__/product-service-dialog.test.tsx`:

- Added the `pressEnter(input)` helper next to `submit()`, implementing the two-phase browser
  implicit-submission semantics happy-dom does not simulate on its own.
- Added five tests to `describe('the produto wizard shell', ...)`, matching the plan's oracle
  list: Enter on Pagamento step 3, Enter on Valores step 2, Enter on an existing produto
  (edit-path default-button case), Enter inside the `Tipo de entrada` combobox search input
  (must stay on the picker), and Enter on the `Voltar` footer button (must not advance).

**Red confirmed at HEAD (pre-fix):** running only the target file showed 4 of 5 new tests
failing for exactly the stated reason — `onSave` had been called with a full payload after a
bare `Enter` on `Parcelas restantes` / `Setup (R$)` / the edit-path field, proving the
implicit-submission root cause. The 5th (`Tipo de entrada` combobox) passed even at HEAD,
because `Combobox` already calls `preventDefault()` on its own Enter handling — consistent
with the plan's note that this test guards the `defaultPrevented` early-return specifically,
not the base bug.

One test-authoring bug surfaced during Red: my first draft of "does not hijack Enter on a
footer button" reused `pressEnter`'s input-only fallback (call `submit()` if
`defaultPrevented` is false) on a `<button>` target, which is not how real browsers behave —
Enter's default action on a focused `<button>` is a click, not form submission. Fixed by
removing that fallback for the button case and asserting only that the wizard step and
`onSave` are unaffected, which is what the plan actually specified.

**Green after the fix:** all 5 new tests pass, and the full existing
`product-service-dialog.test.tsx` file (58 tests) stays green, including the two payload
tests that legitimately submit from an early step (`emits the identical SaveProductPayload...`
and `lands on step 1 with an existing produto prefilled and saves from any step`).

## Gates

- `pnpm run lint` — clean.
- `pnpm run type-check` — clean.
- `pnpm --filter @fxl-sales/web test` — 44 files / 489 tests, all green (single run-once
  invocation, no watcher left behind).

## Scope

Touched only the two files named in the plan's `files_modified`. No other file modified.
