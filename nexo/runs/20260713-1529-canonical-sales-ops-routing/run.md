# Run: Canonical Sales Ops routing

- Flow: `feature`
- Mode: `autopilot`
- Started: `2026-07-13T15:29:27-03:00`
- Completed: `2026-07-13T17:20:09-03:00`
- Feature plan: `nexo/plans/20260713-canonical-sales-ops-routing/`
- Current beat: `capture`
- Status: `complete`

## Frame

Make workspace and page URLs canonical, deep-linkable, and browser-history aware.
The motivating route is `/operacional/vendas`.

## Slice log

- Current behavior was reproduced structurally: `SalesOpsApp` is mounted only at `/` and workspace/page selection is held only in component state.
- The authenticated in-app browser backend was unavailable, so live browser reproduction and visual verification are recorded in `AUDIT.md`.
- Gate 1 is skipped by explicit Autopilot instruction.
- The initial plan-check identified route-parameter, Cadastros authorization, interaction-oracle, and Gate 2 contract gaps; one correction pass resolved them and the independent recheck passed.
- Baseline `CI=true pnpm test` passed with 232 tests across 31 files.
- Slice commits `4d6e912` and `9048035` delivered the canonical routing behavior and replacement-history proof.
- The first product merge landed as `b4c37f9`.
- The first wave verifier returned FAIL on B1 because replacement history semantics were not yet proven.
- Revert `db022a0` removed the first merge while the B1 repair was completed.
- Reapply `a2a7764` restored the product change, and final merge `368fa58` integrated the test repair on `master`.
- Separate Gate 2 verification passed 92 focused canonical route tests.
- Final integrated verification passed 320 total tests across 32 files, plus lint, type-check, build, high-severity dependency audit, diff hygiene, and security and scope review.
- Feature-boundary mutation verification passed by killing the workspace-segment removal mutation.
- The authenticated browser audit remains manual because no signed-in app session and authenticated backend were available.
