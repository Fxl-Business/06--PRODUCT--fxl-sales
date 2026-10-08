# Verify 02-web-client-picker-copy (Gate 2)

Verdict: PASS.

Target: worktree `.worktrees/20261008T114022Z-construbom-leads-ajustes/02-web-client-picker-copy`, branch `feat/20261008T114022Z-02-web-client-picker-copy`, commit `6978481`, base `b3ceab7`.
Contract: `nexo/plans/construbom-leads-ajustes/02-web-client-picker-copy.md` plus AC5 and AC6 and the human decision in `00-OVERVIEW.md`.
This verifier edited no product code and made no commit.

## 1. Scope

`git diff --name-only b3ceab7..HEAD` lists 7 files, all inside the plan's `files_modified`.
The files are `client-picker-copy.ts` (new), `contact-lead.ts`, `ContactLeadDialog.tsx`, `LeadDialog.tsx`, `__tests__/client-picker-copy.test.ts` (new), `__tests__/contact-lead-dialog.test.tsx` and `__tests__/lead-dialog.test.tsx`, all under `apps/web/src/sales-ops/leads/`.
Nothing under `nexo/` changed (0 paths).
No em dash (U+2014) was added: a grep of the full diff and of the seven files exits 1.
`combobox.tsx` and `inline-layer.ts` are untouched, and the primitive default `searchPlaceholder = 'Buscar...'` is still at `combobox.tsx:73`.
The diff matches the plan's "Exact changes" section line for line.

## 2. Oracle

Command, from the worktree root: `CI=true pnpm --filter @fxl-sales/web exec vitest run` with the nine oracle files of the plan.
Run 1: 9 files passed, 147 tests passed, exit 0.
Run 2: 9 files passed, 147 tests passed, exit 0.
No file timed out, so no isolated rerun was needed.

## 3. Lint and types

`pnpm exec eslint` on the seven changed files (from `apps/web`) exits 0 with no warnings.
`pnpm --filter @fxl-sales/web run type-check` (`tsc --noEmit`) exits 0.

## 4. Contract

AC5a (leads edition with `onCreateClient`): `contact-lead-dialog.test.tsx` "with inline create wired, the cliente trigger and search read Buscar ou criar novo cliente (AC5)" asserts the trigger text, `data-placeholder`, the search `placeholder` and `aria-label`, and that an unknown name still offers `[data-combobox-create]`.
AC5b (leads edition without `onCreateClient`): "without onCreateClient the cliente picker never promises creation (AC5)" asserts `Buscar cliente cadastrado` on the trigger, the search `placeholder` and `aria-label`, no create row, and no `criar` in the trigger or the search placeholder.
AC6 (full edition `LeadDialog`): `lead-dialog.test.tsx` "the cliente picker reads Buscar cliente cadastrado on the trigger and the search field (AC6)" asserts trigger, `data-placeholder`, search `placeholder` and `aria-label`, and no create row; the pre-existing "offers no create row on the cliente picker" still holds.
Escape: both dialogs have "Escape on the open cliente picker closes only the picker", run inside the REAL `Dialog`, finding the search field by its new accessible name, asserting the listbox closes and `onOpenChange` is not called, with the bare-Escape positive control on the trigger.
Pure rule: `client-picker-copy.test.ts` pins both approved literals and the two-outcome rule.
The old strings `Selecione ou crie um cliente`, `Selecione o cliente` and `clientPlaceholder` no longer exist in `apps/web/src` (grep exits 1).
The approved literals appear in assertions only in `client-picker-copy.test.ts`; the dialog tests import `CLIENT_PICKER_COPY`, and the literals in their `it` titles are the titles the plan prescribed.
Red-first check (M0): restoring `ContactLeadDialog.tsx`, `LeadDialog.tsx` and `contact-lead.ts` to `b3ceab7` while keeping the new module turns exactly the 5 new dialog tests red (5 failed, 33 passed), so every criterion has an assertion that fails without the change.

## 5. Mutation probes

Each mutant was applied with `perl -0pi`, confirmed applied by `git diff`, run against the full nine-file oracle, then restored with `git checkout -- <file>`.
11 of 11 mutants were killed, 0 survived.

| Id | File | Mutation | Result | Killer test(s) |
| --- | --- | --- | --- | --- |
| M1 | ContactLeadDialog.tsx | trigger `placeholder` back to `Selecione ou crie um cliente` | killed (2 red) | both AC5 tests in contact-lead-dialog.test.tsx |
| M2 | ContactLeadDialog.tsx | drop `searchPlaceholder` | killed (3 red) | both AC5 tests and the cliente Escape test in contact-lead-dialog.test.tsx |
| M3 | LeadDialog.tsx | drop `searchPlaceholder` | killed (2 red) | AC6 test and the cliente Escape test in lead-dialog.test.tsx |
| M4 | ContactLeadDialog.tsx | no-create branch reuses the create copy (`clientPickerCopy(true)`) | killed (1 red) | "without onCreateClient the cliente picker never promises creation (AC5)" |
| M5 | LeadDialog.tsx | wire `onCreate` on the cliente picker | killed (2 red) | "offers no create row on the cliente picker" and the AC6 test |
| M6 | LeadDialog.tsx | trigger `placeholder` back to `Selecione o cliente` | killed (1 red) | AC6 test |
| M7 | ContactLeadDialog.tsx | create row always wired, decoupled from `canCreateClient` | killed (1 red) | "without onCreateClient the cliente picker never promises creation (AC5)" |
| M8 | client-picker-copy.ts | rule inverted | killed (4 red) | "promises creation only when the create row is offered", both AC5 tests, the ContactLeadDialog cliente Escape test |
| M9 | client-picker-copy.ts | `searchOrCreate` literal gains `...` | killed (1 red) | "pins the approved strings" |
| M10 | LeadDialog.tsx | full-edition `searchPlaceholder` promises creation (`searchOrCreate`) | killed (2 red) | AC6 test and the LeadDialog cliente Escape test |
| M11 | combobox.tsx (probe only) | `useInlineLayer(open)` becomes `useInlineLayer(false)` | killed (3 red) | both new cliente Escape tests and the existing vendedor Escape test |

M11 touches a file outside the slice only as a probe, to prove the new Escape tests are not vacuous.

## 6. Cleanliness

`git status --porcelain` in the slice worktree is empty after every probe and at the end.
HEAD is still `6978481`.
Every vitest invocation was run-once (`vitest run`, `CI=true`) and exited; no process was left running.

## Advisory (not a Gate 2 defect)

The plan's recommended browser check (`make dev-fake`, `leads-owner` and `team-owner`) was not performed by this verifier, because happy-dom does not lay out and the Verify contract is the diff and the tests.
The new trigger copy has the same length as the old one (28 characters), so a layout change is unlikely, but a visual check of the 44px trigger beside `Limpar` remains worthwhile before release.
