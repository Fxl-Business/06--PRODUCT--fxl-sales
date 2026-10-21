# Verify 10-web-kanban-funil-periodo (parts 10a, 10b)

Verdict: PASS

## Commands
- `CI=true pnpm --filter @fxl-sales/web exec vitest run` (whole web suite): 153 files, 1923/1923 tests passed.
- `pnpm --filter @fxl-sales/web lint`: 0 problems. `pnpm --filter @fxl-sales/web type-check`: 0 errors.
- `node --test scripts/__tests__/brand-and-technical-ids.test.mjs`: 21 pass, 0 fail.
- `pnpm --filter @fxl-sales/web build`: built; `node scripts/assert-web-bundle-clean.mjs`: clean.
- No em dash in added lines. Worktree git status identical (empty) before and after (build output is ignored).
- API integration suite not run, as instructed.

## Mutation probes (in place with backup, restored; all went red)
- Drop periodQuery from board filters: leads-period oracle red.
- Drop pipelineId from filters: 4 tests red (container, totals, period).
- NON_PROGRESSION_EXIT without pausado: 2 lead-funnel tests red.
- moveTargetsFor ignoring allowed set: board-move red.
- sales-views period filter removed / vendas-abertas statuses widened: sales-views and propostas-lists red.
- 409 transition_not_allowed copy key broken: leads-pipeline-container red.
- stageColors ignoring exitKind/type: board-ui red.

## Acceptance
- Selector switches columns from GET /pipelines; same memoized filters object (pipelineId, from, to) feeds board, summary, move: asserted.
- Period in SP civil days on Quadro, Lista, Funil (shared filters), Propostas lists, Follow-ups (own container, default next7). Colours by object lookup; no inline kind ===. board-write-surface green.
- Each Propostas list is its own route; /operacional/vendas/<id> unchanged and detail closes onto its own list.
- Funil Acumulado excludes perdido and pausado, ganho kept (defensible: a won lead passed every stage); Pausado shown in [data-funnel-parked].
- 409 transition_not_allowed on Lista Mover shows MOVE copy via MutationErrorBanner: tested.
- filteredSales un-memoized: linear pass, suite shows no loop or slowdown (15s).

## Findings
- minor: drag-drop pre-check and notice (LeadsBoard.tsx handleDragEnd, setMoveNotice) has no unit test; the pure pieces (isTransitionAllowed, moveTargetsFor) are tested.
- minor: `pipelineId={pipelineId}` passed to LeadForm on create has no container-level assertion.
- minor/gap (request item: every list has a period filter): lists WITHOUT a period filter are Comissões, Clientes, Pessoas/Vendedores, Leads excluídos, Cadastros lists, Dashboard (static chip). Propostas lists, Quadro/Lista/Funil, Follow-ups have one. Clientes has no date-typed list column the plan covered; owner should confirm whether Comissões/Clientes/Leads excluídos need it.
