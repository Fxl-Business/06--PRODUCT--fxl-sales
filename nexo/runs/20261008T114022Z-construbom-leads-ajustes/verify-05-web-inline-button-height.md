# Verify 05-web-inline-button-height

Verdict: PASS.

Target: worktree `.worktrees/20261008T114022Z-construbom-leads-ajustes/05-web-inline-button-height`, branch `feat/20261008T114022Z-05-web-inline-button-height`, commit `65cf81b`, base `67bed52`.
Contract: `nexo/plans/construbom-leads-ajustes/05-web-inline-button-height.md`.
The verifier did not edit product code and did not commit.

## 1 Scope

`git diff --name-only 67bed52..HEAD` lists exactly the four `files_modified` and nothing under `nexo/`.
The diff adds no em dash (grep for U+2014 over the diff found none), and the commit message has no co-author line.
Exactly four `className` values gained `self-stretch`: `LeadDialog.tsx` Limpar (line 219), Adicionar (line 255), `+ Adicionar item livre` (line 280), and `ContactLeadDialog.tsx` Limpar (line 213).
The footer buttons (`Cancelar`, `Salvar`, the `Excluir lead` outline button) are untouched in both dialogs.
`secondaryButtonClass` in `apps/web/src/sales-ops/leads/board-ui.ts` is unchanged (that file has no diff).
The only other source change is the Adicionar button reflowed from one line to a multi-line JSX element by the formatter, with no other attribute change.

## 2 Oracle

The plan's five oracle files ran twice with `pnpm --filter @fxl-sales/web exec vitest run <files>` under `CI=true`.
Run 1: 5 files passed, 85 tests passed, exit 0.
Run 2: 5 files passed, 85 tests passed, exit 0.
A first attempt passed the file list as one zsh word and vitest reported "No test files found" with exit 0; that vacuous run was discarded and both counted runs used an explicit array, each file confirmed present.

## 3 Lint and type-check

`eslint --max-warnings=0` on the four changed files exited 0, and a JSON-format run confirmed 4 files processed with 0 errors and 0 warnings.
`pnpm --filter @fxl-sales/web run type-check` (`tsc --noEmit`) exited 0.

## 4 Contract

Acceptance 1 holds: each of the four inline buttons carries `self-stretch`, and each sits in a `flex items-center gap-2` row beside a 44px field (`formSelectClass` or `formInputClass`, both `h-11`).
`secondaryButtonClass` sizes by padding with no fixed height, so `self-stretch` takes effect, and its `inline-flex items-center` keeps the label centred.
The Combobox panel is `absolute` inside a `relative w-full` wrapper, so an open picker does not grow the row and the button does not stretch to the panel.
The assertions are the new `stretches the inline action buttons to the field height` tests in `lead-dialog.test.tsx` (three buttons) and `contact-lead-dialog.test.tsx` (Cliente Limpar), proven to fail without the change by probes M1 to M4.
Acceptance 2 holds: the diff does not touch any footer button, and the `Cancelar` negative assertion in both tests is proven by probes M5a and M5b.
Acceptance 3 holds: no other class, copy or behaviour changed, the oracle is green, type-check and eslint exit 0, and no em dash was added.

## 5 Mutation probes

Each probe was applied with `sed`, run against both dialog test files, then restored with `git checkout -- <file>`, with `git status --porcelain` empty after each restore.
M1 removed `self-stretch` from LeadDialog Limpar: killed (`Limpar: expected false to be true`).
M2 removed it from LeadDialog Adicionar: killed (`Adicionar: expected false to be true`).
M3 removed it from LeadDialog `+ Adicionar item livre`: killed (`+ Adicionar item livre: expected false to be true`).
M4 removed it from ContactLeadDialog Limpar: killed (`expected false to be true`).
M5a added it to LeadDialog Cancelar: killed (`expected true to be false`).
M5b added it to ContactLeadDialog Cancelar: killed (`expected true to be false`).
Score: 6 of 6 killed, 0 survivors.

## 6 Working tree

`git status --porcelain` in the slice worktree is empty at the end.
No process was left running; every command was run-once and no server or port was used.

## Residual note

The oracle asserts the class, not the rendered height, because happy-dom has no layout.
The height claim rests on the CSS reasoning in section 4 and on the orchestrator's earlier browser measurement, and a real-browser check of the 44px result stays worth doing at the wave or feature level.
