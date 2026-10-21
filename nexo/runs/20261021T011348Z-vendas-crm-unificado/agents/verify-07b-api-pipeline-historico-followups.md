# Verify 07b-api-pipeline-historico-followups

Verdict: FAIL (1 major, 1 minor). Everything else proven.

## Commands (slice worktree, baseline 7899e78)
- Oracle `crm-pipeline-history.test.ts` (VITEST_INTEGRATION=1): 18/18 (17 plan cases + lock-order case from addendum item 9).
- shared-utils build + test: 191/191.
- API unit `pnpm --filter @fxl-sales/api test`: 1579/1579 (106 files).
- API integration `test:integration` (serial, alone): 527/527 (59 files).
- lint 0, type-check 0 (3 tsc projects), `node --test scripts/__tests__/local-database-guard.test.mjs` 17/17.
- Worktree `git status --porcelain` empty before and after. No em dash in added lines.

## Oracle red without source
Scratch copy with the 12 source files reverted to baseline (new files removed): 18/18 red.

## Mutation probes (scratch copy, oracle only)
- M1 skip graph in moveLead: red (2).
- M2 skip graph in advance: red (1).
- M4 advance writes no event: red (3).
- M5 follow-up optional: red. M6 reason optional: red.
- M7 UTC days for period: red. M8 non-filterable key accepted: red.
- M9 notes ignore seller scope gate: red. M10 sale_required dropped: red.
- M3 lock order of advance: GREEN (survives) - see finding 1.

## Acceptance coverage
409 transition_not_allowed on advance and cross-stage move (M1, M2); one server-side event with actor from token (M4); follow-up mandatory unless exit (M5); perdido reason (M6); no mutating route for /field-definitions and /pipelines (404 probes in case 2); SP civil-day period (M7); f.<key> only filterable (M8); seller scope / other org 404 (M9). CLAUDE.md "CRM unificado" section matches the code.

## Findings
1. MAJOR - lock order of advanceLead is not pinned. `crm-pipeline-history.test.ts:448` (case "advance, move and create ... without deadlock") uses two different leads, so no cycle can form. Mutations: removing `lockLeadBoard` from advanceLead (lead-history-service.ts:216) and moving it AFTER the card `FOR UPDATE` both leave 18/18 green. A probe in the scratch copy (advance(A) + 3x move(A) in parallel, 15 rounds) DOES hit `40P01 deadlock detected` under the reordered mutation and passes on the real code. Fix: make the case run advance and moves on the SAME lead concurrently (repeat several rounds), expect only 200/409 and no 500.
2. MINOR - CLAUDE.md line 365 (funil bullet) still says "there is no stage history", contradicted by the new CRM unificado section (stage_changed events). Reword to say the funnel keeps its linear assumption by design.
