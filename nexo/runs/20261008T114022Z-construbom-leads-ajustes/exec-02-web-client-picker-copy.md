# Exec 02-web-client-picker-copy

Branch `feat/20261008T114022Z-02-web-client-picker-copy`, worktree `.worktrees/20261008T114022Z-construbom-leads-ajustes/02-web-client-picker-copy`, base `b3ceab7`.

## Commits

- `6978481` feat(leads): say what the cliente picker does in both lead dialogs

Exactly the seven files in the plan's `files_modified`; nothing else changed.

## Red first

1. Wrote `client-picker-copy.test.ts` and the five dialog tests from the plan verbatim.
   All three files failed to import the missing `../client-picker-copy`.
2. Added only `client-picker-copy.ts`, reran: the pure test passed and exactly the five new dialog tests failed for the right reason.
   AC5/AC6 copy tests saw the old trigger text (`Selecione ou crie um cliente`, `Selecione o cliente`); both Escape tests threw `cliente search not found by its name`.
3. Applied the plan's changes to `contact-lead.ts`, `ContactLeadDialog.tsx` and `LeadDialog.tsx`; all green.

## Verification (run-once)

- Oracle list (9 files): 9 files, 147 tests passed.
  `client-picker-copy` 2, `contact-lead-dialog` 25, `lead-dialog` 11, `contact-lead` 23, `lead-delete` 23, `leads-contact-container` 18, `leads-full-edition` 5, `board-write-surface` 10, `combobox` 30.
- `pnpm --filter @fxl-sales/web run type-check` (tsc --noEmit): exit 0.
- eslint on the seven changed files: exit 0, no warnings.
- `grep -rn -e 'Selecione ou crie um cliente' -e 'Selecione o cliente' -e 'clientPlaceholder' apps/web/src`: exit 1 (no match).
- Em dash grep over the seven files: exit 1 (no match).
- The approved literals appear only in `client-picker-copy.ts` and once in `client-picker-copy.test.ts`.

## Visual check (real Chrome)

Done with a throwaway Vite harness on port 8142 (no API, no DB, no shared ports), files deleted afterwards and never staged; Vite stopped by its process group.
- Leads edition with `onCreateClient`: trigger reads `Buscar ou criar novo cliente` on one line beside `Limpar`; the opened search field shows the same placeholder; typing `Nova Obra` offers `+ Criar novo cliente "Nova Obra"`; Escape closes only the panel.
- Leads edition without `onCreateClient`: trigger and search read `Buscar cliente cadastrado`; an unknown name shows `Nenhum resultado encontrado.` and no create row.
- Full edition `LeadDialog`: `Empresa (cliente cadastrado)` trigger and search read `Buscar cliente cadastrado` (placeholder and aria-label confirmed in the DOM), no create row; Escape closes only the panel, dialog stays open.

## Deviations

None from the plan.

## Observations outside this slice (not changed, no design decision taken)

- Full edition `LeadDialog`: the `+ Adicionar item livre` button wraps onto two lines and ends up taller than the 44px input beside it, and the `Produto não cadastrado` label sits tight under the product row.
  Out of this slice's scope (product picker area); worth a follow-up.
- `Combobox` with the create row and no matching options draws the search divider and the create section's top border a few pixels apart, which reads as a double line.
  Lives in `combobox.tsx`, which the plan forbids touching.
- `pnpm exec vite` briefly spawned a `pnpm install` child inside the same process group (likely pnpm's pre-run dependency check); it was ended with the group.
  The oracle suite and type-check were re-run green afterwards, and `git status` showed no lockfile change.
