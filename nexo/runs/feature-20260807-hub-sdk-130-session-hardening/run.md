# Run record - feature-20260807-hub-sdk-130-session-hardening

Flow: `/nexo-feature --autopilot`
Milestone: `v2.6.0`
Trunk: `master` (promotion-mode repo; this run stops at `master`)
Baseline: `6f6bf49`
Head: `54fe86f`

## Outcome

All six slices planned, executed, independently verified at Gate 2, and merged to `master`.
Nothing is promoted; Gate 3 remains human-gated and there is one decision waiting there (see `AUDIT.md` A1).

Final gate on integrated `master`:

| Command | Result |
| --- | --- |
| `pnpm run type-check` | Done, 4 projects |
| `pnpm run lint` | Done, api + web clean |
| `pnpm test` | 1103 tests / 91 files (api 382, web 641, shared-utils 80), `build-contract: ok` |
| `pnpm run build` | built |
| `pnpm --filter @fxl-sales/api test:integration` | 169 tests / 25 files against local Docker |

Baseline for comparison: the run started at 1038 unit tests and 159 integration tests.

## Slices

| # | Slice | Commit | Merge |
| --- | --- | --- | --- |
| 01 | `sdk-130-store-port` | `1d0b0a0` | `b742321` |
| 04 | `durable-logout-intent` | `3303d8e` | `b81e456` |
| 02 | `session-absolute-ttl` | `c5a44d6` | (wave 2) |
| 03 | `refresh-failure-classification` | `f10668c` | (wave 2) |
| 05 | `auth-cache-flush` | `1e3a20d` | (wave 3) |
| 06 | `supersede-prior-session` | `27a5e40` | `54fe86f` |

Waves: `1 = {01, 04}`, `2 = {02, 03}`, `3 = {05, 06}`.
Executed SERIAL rather than worktree-parallel, deliberately and stated up front: max wave width was 2, every slice touches `CLAUDE.md` and `nexo/ROADMAP.md` so no wave was conflict-free, and slice 01 rewrites the lockfile that a parallel worktree would have to install against.

## Gates

- **Gate 1 (WHAT):** skipped, autopilot, recorded in `nexo/state.json`. The one design fork that mattered was pre-answered at the front door: keep our own store, do not adopt `SqlHubSessionStore`.
- **Gate 2 (Machine):** enforced per slice by a SEPARATE Verify agent that never saw the implementer's notes or the repo context pack. Every verifier ran the full gate plus adversarial mutation testing. Twenty-nine mutations were applied across the six slices; every one turned red on its predicted oracle and every one was reverted with the tree confirmed byte-identical afterwards.
- **Gate 3 (Release):** not reached. Nothing pushed past `master`.

## What the plan-check caught

The six planners worked in parallel and mostly could not see each other's output.
An independent plan-checker returned FAIL on three cross-slice seams before any code was written:

1. Slice 05 flushed on `hasSessionRef`, which slice 03 provably deletes, and slice 05's stated fallback ("use whatever flag it left") pointed at nothing. Slice 04 had spotted the same seam and explicitly disowned it, so it was unowned by all three. Fixed by naming `lastAppliedToken` with a case-by-case equivalence table.
2. Slice 06 typed itself on `DurableHubSessionStore` and on a durable-only branch, both of which slice 01 deletes, and its `app-auth.ts` snippet silently dropped slice 01's `router.onError`. Left as-is this would have thrown `TypeError: store.withLoginContext is not a function` on every `/auth/callback` in local dev. Slice 01's executor later confirmed the seam was live exactly as described, and slice 06's verifier reproduced the `TypeError` by mutation.
3. Frame acceptance criterion 8 was unimplementable as worded and slice 06 had rescoped it unilaterally. Amended explicitly rather than silently.

It also caught that slice 04's ordering rationale was mechanically wrong and would have written an incorrect mechanism permanently into `CLAUDE.md`.

## What execution caught that planning missed

- **The published `@fxl-business/hub-sdk@1.3.0` is unresolvable.** Its `package.json` points `main`/`types`/`exports` at `./src/*.ts` while `files` ships only `dist`, `schema` and `MIGRATION.md`. Both the plan and the plan-check read the staged `dist/` and verified every line citation, but neither ever installed the package. Bridged with a `pnpm patch` touching package metadata only. See `AUDIT.md` A1.
- **The hono pin lives in a `pnpm-workspace.yaml` override.** Moving only `apps/api/package.json` left the install resolving `1.3.0(hono@4.12.25)`, the exact silent unmet-peer state the plan warned about.
- **Slice 05's plan named ordering oracles that did not exist.** Hoisting the workspace-switch flush above the `await` left the whole suite green. The executor added two tests, each mutation-proven to redden on exactly one mutation. Implementing that plan as written would have shipped both orderings unproven.
- **Slice 02's key-absence oracle would have passed vacuously**, since `update` never mentioned the column before the change. The executor added the non-vacuity half.

## Deliberate deviations

- **Acceptance criterion 8 narrowed** from account-keyed to session-id-keyed supersede. `store.create` is never passed an `accountId`, so the account form would match zero rows forever, and it would fail to close the one-browser-two-identities case while logging operators out of every other device. Reported to the Hub.
- **No manual browser E2E for slice 06.** `apps/api/.env` points `DATABASE_URL` at STAGING, so a manual login would have written and deleted rows in staging. The executor added `apps/api/test/rls/hub-bff-login-supersede.test.ts` instead, driving a real cookie-jar browser through `GET /auth/login` then `GET /auth/callback` over the real `createHubBff` and real Postgres with only the Hub stubbed. A human two-profile click-through against a LOCAL database is still owed before production.

## Residuals

Recorded in `AUDIT.md` and `nexo/ROADMAP.md`:

- The patch-versus-hold decision for promotion (`AUDIT.md` A1).
- The patch is keyed to exact `1.3.0` while both apps declare `^1.3.0` (`AUDIT.md` A1a).
- Workspace-scoped query keys, deferred for blast radius.
- Slice 02's migration backfill safety argument expires 2026-11-01.
- The absent/already-swept prior-session-id case has no standing test.

## Files

Plans: `nexo/plans/feature-20260807-hub-sdk-130-session-hardening/`
Verify reports: `verify-01.md` through `verify-06.md`
Implementer notes: `notes-01.md` through `notes-06.md`
Plan audit: `plan-check.md`
Hub reply: `HUB-RESPONSE.md`
Parked decisions: `AUDIT.md`
