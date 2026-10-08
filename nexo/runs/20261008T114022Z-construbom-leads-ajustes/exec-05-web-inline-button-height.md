# Exec 05-web-inline-button-height

Branch `feat/20261008T114022Z-05-web-inline-button-height`, worktree `.worktrees/20261008T114022Z-construbom-leads-ajustes/05-web-inline-button-height`, base `67bed52`.

## Commit

- `65cf81b` fix(leads): stretch the inline dialog buttons to the field height

Exactly the four files in the plan's `files_modified`: `LeadDialog.tsx`, `ContactLeadDialog.tsx`, `lead-dialog.test.tsx`, `contact-lead-dialog.test.tsx`.
No co-author line, no agent name.

## Red first

Added the two tests the plan names, both called `stretches the inline action buttons to the field height`, and ran them before any source change.
Both failed for the intended reason:
- `lead-dialog.test.tsx`: `Limpar: expected false to be true` (no `self-stretch` on the first of the three buttons).
- `contact-lead-dialog.test.tsx`: `expected false to be true` on the Cliente `Limpar`.

Each test also asserts `Cancelar` does NOT carry `self-stretch`.
`contact-lead-dialog.test.tsx` had no button-by-text helper, so the test defines a local one (same shape as the one in `lead-dialog.test.tsx`), matching the rendered `Limpar` text.

## Green

Appended ` self-stretch` in the template-literal style slice 04 used:
- `LeadDialog.tsx` `Limpar` (empresa picker row): `${secondaryButtonClass} self-stretch`.
- `LeadDialog.tsx` `Adicionar` (produto picker row): `${secondaryButtonClass} self-stretch`; the one-line JSX tag became multi-line because the longer className no longer fits the line width.
- `LeadDialog.tsx` `+ Adicionar item livre`: `${secondaryButtonClass} shrink-0 self-stretch whitespace-nowrap`.
- `ContactLeadDialog.tsx` `Limpar` (Cliente picker row): `${secondaryButtonClass} self-stretch`.

Footer buttons (`Cancelar`, `Salvar`, `Excluir lead`) and `secondaryButtonClass` itself are untouched.
`secondaryButtonClass` is `inline-flex items-center justify-center`, so the label stays vertically centred inside the stretched button.

## Verification (run-once)

- Oracle list (5 files, `CI=true pnpm --filter @fxl-sales/web exec vitest run <5 files>`): 5 files, 85 tests passed (lead-dialog 13, contact-lead-dialog 26, lead-delete 23, leads-contact-container 18, leads-full-edition 5).
- `pnpm --filter @fxl-sales/web run type-check` (tsc --noEmit): exit 0.
- eslint on the four changed files: exit 0, no output.
- Em dash over the diff: 0.
- The repo has no Prettier; eslint is the formatting gate.
- The commit hook ran `perf:audit` (stub, ok).

## Deviations

None.
No browser check was made in this slice; the orchestrator's measurement (38px button vs 44px field) is the defect evidence, and `self-stretch` in a `flex items-center` row resolves the button to the row height, which is the tallest child (the 44px field).
No process was started beyond the run-once vitest, tsc and eslint invocations, all of which exited.
