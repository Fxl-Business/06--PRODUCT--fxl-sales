# Autopilot audit - run 20261008T114022Z-construbom-leads-ajustes

## Decisions taken without the human
- The run was built from the Main checkout's session through worktrees, because Nexo's front door would only dispatch from Main, as in the previous runs; integration happened on `feat/20261008-00-run`, `master` is to be landed fast-forward only, and nothing was pushed.
- The WHAT came from two rounds of questions in chat (six answers); the run was otherwise autopilot, with no separate Gate 1 prompt.
- The leads-edition Lista also got the `Valor estimado` column (parity with the full edition), not only the R$ on the chips and the footer.
- The leads-edition card falls back to `Sem cliente` when a lead has no cliente (the wording propostas already use); the full edition keeps `Sem empresa`.
- The no-create picker copy is `Buscar cliente cadastrado`, in the full edition and in the leads edition whenever inline create is not wired, so the rule has exactly two outcomes; both strings live in `client-picker-copy.ts`.
- Import recognition details (plan 03): the document digits are tried first; several clientes with the same document are narrowed by the row's name; when the document points at another cliente there is no fallback to the name; the name rule applies only when every document attached to that name across the tab agrees; a recognized row emits no operation and no warning; `recognized` rides the preview, the commit and the `import.completed` audit; the screen shows one line, never one per row; the `Leia-me` tab text was updated to say so.
- Slice 03 added a third integration test beyond its plan (a plan-check suggestion): a cliente created between preview and commit is recognized by the commit, which proves the commit never trusts the preview.
- Slices 04 and 05 were inserted mid-flight from defects measured in the browser (one introduced by slice 01, the truncated Cliente line; three pre-existing: the double `Combobox` divider, the wrapped `+ Adicionar item livre`, the inline buttons shorter than their fields), and the orchestrator planned them directly from the measurements instead of dispatching a planner sub-agent.
- Slice 01's planned throwaway browser harness was skipped on the orchestrator's instruction, because the integrated end-to-end pass covered the same screens (and found the Cliente line defect).
- Slice 04 rewrote three assertions of the slice 01 test `shows the value beside the menu, formatted like the full card`, because they pinned the single-line `truncate` layout that slice 04 replaced by design.
- Waves 2 and 3 were verified by ONE integrated full-suite run at `55d8adf` instead of one run each.
- The repo configures no mutation tool, so the feature-tier mutation pass closed `not_applicable`; the slice Verifies ran 73 targeted mutants and killed all of them.
- The end-to-end test data stays in the local dev database (3 clientes and 6 leads in `org_fake_leads`).

## For you to test or decide
- [ ] TEST in production after the deploy: re-import Construbom's spreadsheet as is; the preview should show 0 clientes to create and one line saying N clientes were recognized.
  Until this release is live, delete the rows of the Clientes tab (keep the header) before re-importing.
- [ ] DECIDE: the import does not recognize leads already on the board; re-importing a Leads tab without deleting the leads first duplicates them with no warning.
  Should it?
- [ ] Web test output carries pre-existing noise (React Router v7 future-flag warnings and "not configured to support act(...)" in `leads-list-view`, `leads-board-dropzones`, `leads-board-columns`, `dev-identity-roles`); these are not failures, and they are a follow-up.
- [ ] A real 390px check was not possible in this session (the window resize did not apply); the Quadro columns have a fixed width, so the card layout should be the same on a phone.

## Ready to ship
- [ ] `/nexo-ship` to cut v4.7.0 (Gate 3) and promote - five slices (leads-edition board R$ and Cliente on the card, cliente picker copy, import recognition of clientes, dialog and `Combobox` polish, inline button height).
  The API part (the import) needs the production API on this release too.
