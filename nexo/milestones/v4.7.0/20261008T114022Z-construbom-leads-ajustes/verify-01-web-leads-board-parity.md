# Verify 01-web-leads-board-parity (Gate 2)

Verdict: PASS.

Target: worktree `.worktrees/20261008T114022Z-construbom-leads-ajustes/01-web-leads-board-parity`, branch `feat/20261008T114022Z-01-web-leads-board-parity`, commit `16187da`, base `b3ceab7`.
Contract: `nexo/plans/construbom-leads-ajustes/01-web-leads-board-parity.md` and AC1-AC4 plus the human decisions in `00-OVERVIEW.md`.
This verifier is independent from the executor and judged only the plan, the diff and the test results.

## 1. Scope

`git log --oneline b3ceab7..HEAD` shows exactly one commit, `16187da feat(leads): show R$ and Nome & Cliente on the leads-edition board`.
`git diff --name-only b3ceab7..HEAD` lists 5 files, exactly the plan's `files_modified`:
- `apps/web/src/sales-ops/leads/board-labels.ts`
- `apps/web/src/sales-ops/leads/LeadCard.tsx`
- `apps/web/src/sales-ops/leads/LeadsBoard.tsx`
- `apps/web/src/sales-ops/leads/__tests__/board-labels.test.ts`
- `apps/web/src/sales-ops/leads/__tests__/leads-contact-board.test.tsx`

Nothing under `nexo/` is in the diff.
`contact-lead.ts`, `LeadsBoardContainer.tsx`, `SalesOpsApp.tsx`, `leads-full-edition.test.tsx` and every API file are untouched.
The em dash check (`git diff b3ceab7..HEAD | grep -n` for U+2014, double-checked with a perl `\x{2014}` scan) found 0 lines.

## 2. Oracle

Command: `CI=true pnpm --filter @fxl-sales/web exec vitest run <the 15 oracle files>` from the worktree root.
Run 1: 15 files passed, 212 tests passed, 0 failed.
Run 2: 15 files passed, 212 tests passed, 0 failed.
Run 3 (after fixing my output filter): 15 files passed, 212 tests passed, 0 failed.
No timeout or flake was seen.

## 3. Lint and types

`pnpm exec eslint` on the 5 changed files from `apps/web` exited 0.
`pnpm --filter @fxl-sales/web run type-check` (`tsc --noEmit`) exited 0.

## 4. Contract review

The product diff matches the plan's design sections 1 to 3 line for line.

AC1 (column header): the `!contact` wrapper around `[data-stage-total]`, `PERCENT_OF_TOTAL(share)` and `[data-stage-bar]` is removed and the children are unchanged.
Asserted by `shows the stage R$ total, % do total and the bar from the loaded cards` (150_000 and 300_000, 33% and 67%, bar widths) and `takes the column total, share and bar from the server summary` (9_000_000, 97% and 3%).

AC2 (card): the leads-edition branch shows the name, `[data-lead-client]` via `leadClientLabel`, the birthday, and `[data-lead-value]` with the menu inside a `flex shrink-0 items-start gap-0.5` group.
`leadClientLabel` and `NO_CLIENT_LABEL = 'Sem cliente'` share the private `resolvedClientName` ladder with `leadCompanyLabel`, which still falls back to `Sem empresa`.
Asserted by the Quadro tests (live name beats snapshot, snapshot fallback, `Sem cliente`, no `[data-lead-contact]`, no phone or e-mail text, value `brl0(150_000)` and `brl0(0)`, `shrink-0` group holding `[data-lead-menu]`, `truncate` client inside a `min-w-0 flex-1` column), by `contact LeadCard header` (unknown client id never rendered, no product chip) and by the new `leadClientLabel` block in `board-labels.test.ts`.

AC3 (Lista): both chips and the footer `TOTAL` render unconditionally, the contact thead gains a right-aligned `Valor estimado` th before `Ações`, the value td renders in both editions, and the empty row is `colSpan={7}`.
The Lead cell still renders `[data-row-contact]` with `leadContactLine`, and the `Aniversário` column stays.
Asserted by the exact header array, the `text-right` th and td checks, td index 5 values, 7 tds per row, chip and footer figures from loaded cards and from the summary, colspan 7, and Ana's first td not containing the client name.

AC4 (full edition unchanged): the full branch of the LeadCard header has no changed line in the diff, and every LeadsBoard edit emits identical DOM for `fieldSet !== 'contact'`.
Asserted by the unedited `leads-full-edition`, `lead-board-totals`, `leads-board-columns` and `leads-list-view` suites plus the new `the full edition keeps its own card and Lista` describe.

Red check: with the three product files reset to `b3ceab7` and the new tests kept, the two edited test files ran 17 failed and 19 passed, which matches the plan's expected red.
The full-edition guards and the `shows no product chip` test are pins that were already green at the base, as the plan intends; mutant M21 proves the product-chip pin still bites.

Weak spots (not failures):
- The Vendedor `cellIndex` 3 rule is pinned only by the pre-existing `lead-unassigned-marker.test.tsx`, not by the slice's own tests.
- The layout claims (ellipsis on one line, value and kebab inside the card at 390px) are asserted only as class names, because happy-dom has no layout.
- The plan's real-browser harness check was skipped on the orchestrator's instruction (recorded in the exec notes), so the post-integration end-to-end run must still look at the leads-edition card and column header at desktop and 390px widths.

## 5. Mutation probes

Each mutant was applied with an exact-count string replacement, the whole 15-file oracle list was run, and the product files were restored with `git checkout --`.
22 mutants were applied, and all 22 were killed.
A first M01 attempt without a fragment did not compile, so it was discarded and redone as a valid fragment.

| Mutant | Change | Killed by |
| --- | --- | --- |
| M01 | Re-gate the column header R$ total, share and bar behind `!contact` | Quadro `shows the stage R$ total...` and `takes the column total...` |
| M02 | `NO_CLIENT_LABEL = 'Sem empresa'` | `board-labels` `spells the fallback Sem cliente` and `falls back...`, contact `falls back to the snapshot, then to Sem cliente`, `never renders an unresolvable client id` |
| M03 | Card client line uses `leadCompanyLabel` | contact `falls back to the snapshot, then to Sem cliente`, `never renders an unresolvable client id` |
| M04 | Card renders the `telefone · email` line again in `[data-lead-contact]` | `shows the name, the Cliente and the birthday on the card, and no contact line` |
| M05 | Lista value td re-gated on `!contact` | `shows the contact line and the birthday per row`, `shows the estimated value right-aligned before the actions` |
| M06 | `Todas as fases` chip R$ re-gated | `phase chips keep their counts and carry their R$`, `takes the chips and the footer from the server summary` |
| M07 | Per-phase chip R$ re-gated | same two Lista chip tests |
| M08 | Footer `TOTAL` re-gated | `the footer counts leads and shows the TOTAL`, `takes the chips and the footer from the server summary` |
| M09 | Empty row back to `colSpan={contact ? 6 : 7}` | `an empty phase spans the seven contact columns` |
| M10 | Contact `Valor estimado` th dropped | `uses the contact headers plus Valor estimado before Ações` |
| M11 | Contact `Valor estimado` th not right-aligned | `uses the contact headers plus Valor estimado before Ações` |
| M12 | Lista value td not right-aligned | `shows the estimated value right-aligned before the actions` |
| M13 | Card value group loses `shrink-0` | `shows the value beside the menu, formatted like the full card` |
| M14 | Card client line loses `truncate` | `shows the value beside the menu, formatted like the full card` |
| M15 | Shared ladder prefers the snapshot over the live name | `board-labels` `leadClientLabel` and `leadCompanyLabel` live-name tests, contact card Cliente test, full Lista company-line guard |
| M16 | Lista Lead cell also shows the client name | `shows the contact line and the birthday per row` |
| M17 | Card value formatted with default (2) decimals | `shows the value beside the menu, formatted like the full card` |
| M18 | Full card uses `leadClientLabel` (`Sem cliente`) | `the full card keeps Sem empresa and gets no leads-edition hook` |
| M19 | Header `% do total` label re-gated | both Quadro column-header tests |
| M20 | `leadCompanyLabel` falls back to `Sem cliente` | `board-labels` `leadCompanyLabel` fallback test, full-card guard |
| M21 | Product chips ungated on the contact card | `shows no product chip even when the row carries products` |
| M22 | Card client column loses `min-w-0` | `shows the value beside the menu, formatted like the full card` |

## 6. Clean tree

`git status --porcelain` in the worktree is empty after every probe and at the end, and HEAD is still `16187da`.
No `git stash` was used, no long-running process was started, and nothing was written to the main checkout.
