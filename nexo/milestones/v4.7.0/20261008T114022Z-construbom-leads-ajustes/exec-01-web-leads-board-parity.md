# Exec 01-web-leads-board-parity

Branch `feat/20261008T114022Z-01-web-leads-board-parity`, worktree `.worktrees/20261008T114022Z-construbom-leads-ajustes/01-web-leads-board-parity`, base `b3ceab7`.

## Commits

- `16187da` feat(leads): show R$ and Nome & Cliente on the leads-edition board

One atomic commit holding the five `files_modified` and nothing else.

## Red (before any product change)

Command: `vitest run src/sales-ops/leads/__tests__/leads-contact-board.test.tsx src/sales-ops/leads/__tests__/board-labels.test.ts`.
Result: 17 failed, 19 passed (36).

Failing, all for the expected reason:

- `leadClientLabel` > prefers the cadastro client name over the snapshot; falls back to the snapshot, then to Sem cliente, and never to the id; agrees with leadCompanyLabel whenever a name resolves (TypeError, not exported); spells the fallback Sem cliente (undefined).
- `contact board, Quadro` > shows the name, the Cliente and the birthday on the card, and no contact line; falls back to the snapshot, then to Sem cliente; shows the value beside the menu, formatted like the full card; shows the stage R$ total, % do total and the bar from the loaded cards; takes the column total, share and bar from the server summary (no `[data-lead-client]`, `[data-lead-value]`, `[data-stage-total]`).
- `contact board, Lista` > uses the contact headers plus Valor estimado before Ações; shows the contact line and the birthday per row (6 td, not 7); shows the estimated value right-aligned before the actions; phase chips keep their counts and carry their R$; the footer counts leads and shows the TOTAL; takes the chips and the footer from the server summary; an empty phase spans the seven contact columns (colspan 6).
- `contact LeadCard header` > never renders an unresolvable client id.

Green at red, as intended (guards): the three `the full edition keeps its own card and Lista` cases, and `contact LeadCard header` > shows no product chip even when the row carries products (chips were already gated on `!contact`; the plan's "expected red" line lumps this describe as failing, but this one case is a guard that pins existing behaviour).

## Green

- Slice oracles: `leads-contact-board.test.tsx` 26 passed, `board-labels.test.ts` 10 passed.
- Full oracle list (15 files): 212 passed, 0 failed.
- Extra safety run, whole `src/sales-ops/leads` directory: 31 files, 379 passed.
- `pnpm --filter @fxl-sales/web run type-check`: exit 0.
- `eslint` on the five changed files: exit 0. The repo has no Prettier config.
- No em dash in any changed file.

## Diff checks

- `LeadCard.tsx`: only the contact branch changed; the full branch (`) : (` to the end of the header) is byte-identical, so the full card gets no new hook.
- `LeadsBoard.tsx`: the eight edits of plan section 3, nothing else; no import change.
- `board-labels.ts`: private `resolvedClientName`, `leadCompanyLabel` rewired to it, `NO_CLIENT_LABEL` and `leadClientLabel` added.
- Not touched: `contact-lead.ts`, `LeadsBoardContainer.tsx`, `SalesOpsApp.tsx`, any API file, `leads-full-edition.test.tsx`.

## Layout review (JSX re-read, no browser per orchestrator instruction)

- Card: the left column keeps `flex min-w-0 flex-1 flex-col gap-0.5`, the client line is `truncate`, so a long client name ellipsizes and cannot push the value or the kebab out; the right group is the full card's own `flex shrink-0 items-start gap-0.5` with the full card's value span classes.
- Column header: the same two blocks the full edition renders, unchanged classes and expressions.
- Lista: both editions now have seven columns inside the existing `min-w-[900px]` scroller; the value th and td carry `text-right`.

## Deviations

- The plan's throwaway browser harness visual check was skipped on the orchestrator's instruction (the orchestrator runs the real app end to end after integration).
- None otherwise.
