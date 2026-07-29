---
run: 20260729-propostas-areas
milestone: v2.3.0
flow: feature
mode: autopilot
trunk: master
status: done
---

# Run: Propostas + Áreas

## Frame

FXL Sales stops recording only finished sales.
Every deal now starts life as a Proposta with a lifecycle (`draft -> open -> won / lost / cancelled`), so the team can see how many each seller opens and closes.
Products and free-form service lines belong to configurable Áreas (business units: FXL Tech, FXL Visual, FXL Advisor, FXL BPO Sales, FXL Influência Estratégica, FXL Treinamentos), enabling per-área reporting later.
The payment plan became a flexible list of parcelas (date + amount + method each) instead of "condição + N parcelas mensais", supporting cases like "R$ 20k PIX today + 3x R$ 3.333 boleto" and cancellable monthly contracts.
This feature also laid the data foundation for contract-document generation (client legal fields, full snapshots); document generation itself is a follow-up feature.
Full design contract and locked user decisions are recorded in `nexo/plans/20260729-propostas-areas/00-OVERVIEW.md`.

## Constraints

Gate 1 (human approves WHAT) was skipped per `--autopilot`.
Gate 2 (independent Verify agent proves tests pass locally, on an isolated worktree, per slice) remained mandatory and was performed by an agent that did not implement the slice.
No release or promotion was authorized as part of this run.

## Wave table

Eight slices landed on `master` across six waves.
Waves 2 and 4 each ran two independent slices in parallel because their dependency edges only pointed at already-merged work.

| Wave | Slice | Branch | Exec verdict | Verify verdict | Merge commit |
| --- | --- | --- | --- | --- | --- |
| 1 | 01-areas-backend | `feat/01-areas-backend` | PASS | PASS | `14149b0` |
| 2 | 02-proposal-schema-backend | `feat/02-proposal-schema-backend` | PASS | PASS | `5f72c9d` |
| 2 | 05-areas-web | `feat/05-areas-web` | PASS | PASS | `8884479` |
| 3 | 03-proposal-write-backend | `feat/03-proposal-write-backend` | PASS | PASS | `8f94211` |
| 4 | 04-proposal-transition-backend | `feat/04-proposal-transition-backend` | PASS | PASS | `5816958` |
| 4 | 06-proposal-wizard-web | `feat/06-proposal-wizard-web` | PASS | PASS | `9f7f633` |
| 5 | 07-propostas-list-web | `feat/07-propostas-list-web` | PASS | PASS | `d20c9f1` |
| 6 | 08-client-legal-web | `feat/08-client-legal-web` | PASS | PASS | `42663ee` |

Two quick fixes rode alongside the feature and landed directly on `master` (not part of the slice/wave graph):

| Quick fix | Branch | Verdict | Merge commit |
| --- | --- | --- | --- |
| auth-context-dev-race | `fix/auth-context-dev-race` | PASS | `c3d98df` |
| hermetic-integration-tests | `fix/hermetic-integration-tests` | PASS | `3e3d8dc` |

Web slices 05 through 08 all touch `apps/web/src/sales-ops/SalesOpsApp.tsx` and related shared files, so the plan deliberately serialized their dependency edges (05 before 06, 06 before 07, 07 before 08) so none of them ever ran in the same wave as another web slice.

## Incidents

### wave-exec trunk-alias workaround

`scripts/nexo-wave-exec.sh` (the Nexo wave harness) hardcodes the integration branch name as `main` (`git switch -q main`, `git merge --no-ff -m "Merge branch '$branch' into main" "$branch"`), but this repo trunks on `master` (`nexo/state.json` sets `"trunk": "master"`).
The workaround was to keep a local branch literally named `main` as a trunk alias: the harness ran its serial merge queue against `main`, and after each wave went green the session fast-forwarded `master` onto it (`git switch master && git merge main`, a fast-forward since `master` never diverged).
This is why every slice merge commit message reads "Merge branch '...' into main" even though the commit lives on `master`'s history, and why `git reflog` shows repeated `checkout: moving from main to master` / `merge main: Fast-forward` pairs at each wave boundary.
Wave 1 (`01-areas-backend`) additionally hit the harness's built-in revert/reapply recovery loop once on the `main` alias before landing clean (visible in reflog as `Revert "Merge branch 'feat/01-areas-backend' into main"` followed by `Reapply ...`); this is the harness's documented self-healing behavior for a wave that failed its `--wave-verify` gate and was not a manual intervention.
No change was made to the harness script itself; the alias-and-fast-forward workaround is local to this run.

### staging-DB test leak discovery and fix

While planning the wave sequence, the session found that `apps/api/.env` sets `DATABASE_URL` to the staging Postgres instance (`fxl-db-server:5432/fxl_sales_stg_db`), and `apps/api/test/rls/setup-env.ts` only set `TEST_DATABASE_URL`/`DATABASE_URL` with `??=` (only-if-unset).
With a checked-out `.env` present, the integration suite silently connected to and migrated staging instead of the local Docker test database, every time it ran.
Fixed on `fix/hermetic-integration-tests` (commit `6a6a3cb`, merged `3e3d8dc`) by:
- Provisioning a local non-superuser `fxl_sales_test` role in the local Docker Postgres so RLS is genuinely enforced (superuser connections bypass `FORCE ROW LEVEL SECURITY`).
- Adding `TEST_DATABASE_URL`, `TEST_MIGRATE_DATABASE_URL`, and `ADMIN_DATABASE_URL` pins to `apps/api/.env`, all pointed at the local Docker instance on port 5006.
- Hard-overriding `process.env.DATABASE_URL` (not `??=`) in `apps/api/test/rls/setup-env.ts` so the API under test always talks to the local test DB regardless of what `.env` sets for the dev server.
- Making `apps/api/test/rls/global-setup.ts` honor `TEST_MIGRATE_DATABASE_URL` so migrations apply to the same local DB before any RLS test connects.

Full rationale and the exact role-provisioning SQL are captured in `nexo/knowledge/decisions/2026-07-29-integration-tests-are-hermetic-local.md`.

## Deviations

- Gate 1 was skipped per `--autopilot`; the eight-slice plan set was approved by an independent plan-check agent instead of a human (`nexo/runs/20260729-propostas-areas/agents/plan-check.result.json`, verdict PASS).
- Mutation testing was skipped for every slice: no mutation-testing tool is configured in this repo, so the feature-boundary mutation gate could not run.
  Logged as a roadmap follow-up rather than silently dropped.
- Scribe capture (this run record plus the decision docs) ran once at feature end instead of once per wave, to keep the six-wave, eight-slice run moving without a capture pause at every merge.

## Totals

- Commits: 18 commits landed on `master` from `c3d98df` (exclusive) to `HEAD` (`42663ee`), across 8 feature slices and 2 quick fixes.
- Files touched by the feature+fixes range: 43 files changed, 14220 insertions, 614 deletions (`git diff --stat c3d98df..HEAD`).
- Integration tests: went from 8 files / 27 tests (pre-feature baseline) to 13 files / 47 tests (`08-client-legal-web` final count).
- Unit tests (final, `CI=true pnpm test`): 215 tests in `apps/api`, 122 tests in `apps/web`, 17 tests in `packages/shared-utils` - 354 total, all passing.
- Every slice and both quick fixes report lint, type-check, `pnpm test`, and `pnpm --filter @fxl-sales/api test:integration` green at merge time; no slice required a repair commit after its integrated Gate 2 verify.

## Evidence

- `nexo/plans/20260729-propostas-areas/00-OVERVIEW.md` and the eight per-slice plan files.
- `nexo/runs/20260729-propostas-areas/agents/plan-check.result.json`, `exec-01..08.result.json`, `verify-01..08.result.json`.
- `nexo/runs/20260729-propostas-areas/verify-01.md` through `verify-08.md` (independent Verify agent narratives, each including a full diff-vs-plan review, lint/type-check/unit/integration runs, and a security lens pass).
- `nexo/plans/20260729-auth-context-dev-race.md` and `nexo/runs/20260729-propostas-areas/agents/verify-quick-auth.result.json` for the auth-context quick fix.
- `apps/api/test/rls/setup-env.ts` and `apps/api/test/rls/global-setup.ts` for the hermetic-test fix.
