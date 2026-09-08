# Autopilot audit - run feature-20260907-hub-env-contract-prep

Four slices planned, four landed on `master`, none parked. The items below are things only the
operator can do, plus two honest gaps in this run's own process.

## Blocking the rest of the work

- [ ] **The SDK is not published.** `@fxl-business/hub-sdk@2.3.0` does not exist on the registry and
      the Hub repo is still at `2.2.0` with its own slices unexecuted. Everything that depends on it
      is staged in `nexo/plans/feature-20260907-hub-sdk-230-env-contract/00-OVERVIEW.md` and NOT
      started. Nothing here installs, shims or vendors anything to get around that.

## DO before the next deploy of this repo - two renamed variables

Both were renamed on `master` in this run. Coolify and Vercel are not touched by Nexo, so this is
yours. The binding rule is that the variable must exist under its new name BEFORE the deploy that
reads it.

- [ ] **`HUB_SESSION_ENCRYPTION_KEY` is now `SALES_SESSION_ENCRYPTION_IKM`** (staging and production).
      This one can hurt. It is the HKDF input for the BFF session sealer, so if the old variable
      holds a value, copy it byte-for-byte under the new name. Miss it and the sealer silently falls
      back to deriving from `FXL_HUB_CLIENT_SECRET`, every `hub_bff_sessions` seal stops opening, and
      every user is logged out once. Nothing throws and nothing logs a warning; it is silent and
      self-healing after one re-login.
      If the variable is blank in both environments - which is the documented default and what the
      shipped examples carry - there is nothing to carry across and the rename is free. CONFIRM per
      environment rather than assuming; this run could not read Coolify.

- [ ] **`FXL_HUB_POST_LOGIN_REDIRECT` and `FXL_HUB_POST_LOGIN_ERROR_REDIRECT` are now
      `SALES_POST_LOGIN_REDIRECT` and `SALES_POST_LOGIN_ERROR_REDIRECT`.**
      Both are optional and blank in the shipped examples, falling back to `CORS_ORIGIN`, so the
      expected case is free. If either carries a real value today, copy it under the new name. The
      failure mode is quiet: no crash, no log, post-login just lands on `CORS_ORIGIN` instead of the
      configured destination, so it has to be checked rather than noticed.

## Ready to ship

- [ ] **`/nexo-ship`** - `master` carries four merged slices and is green on lint, type-check, the
      full suite and both guards. Autopilot never ships and Gate 3 is human. There is no version
      bump here and nothing is promoted; the last release remains v3.0.0.

## Process gaps in THIS run, recorded rather than hidden

- [ ] **Execute/Verify isolation leaked, structurally, and it was my sequencing.** Each Execute agent
      commits its own `exec-NN-notes.md` on the slice branch, so the notes arrive inside
      `git diff master...<branch>` and the Verify agent sees the implementer's reasoning whether or
      not it is told to avoid it. Both verifiers disclosed this rather than staying quiet, and both
      re-derived their own probes instead of trusting the notes' numbers. Fix for the next run: have
      Execute write notes to the run directory WITHOUT committing them, or have the orchestrator
      diff with `':(exclude)nexo'`.

- [ ] **No integration suite ran.** `pnpm --filter @fxl-sales/api test:integration` was not executed.
      No slice touched SQL, a route, RLS or a migration - the diff is env names, comments, examples
      and two guard scripts - so the tier is arguably right, but it is a deliberate omission and not
      a claim of coverage.

- [ ] **No security review and no mutation-testing pass** at the feature boundary. Mutation tooling
      is still not configured in this repo, so the per-slice mutation batteries stood in: every slice
      proved its oracles non-vacuous by mutating the source and observing RED. Slice 00 was proven
      from BOTH sides (grep-everything and grep-nothing both go red).

## Two non-blocking observations from the verifiers

- [ ] `scripts/no-legacy-auth.mjs`'s pathspec is cwd-relative, inherited from the original `'.'`.
      Harmless for every real invocation from the repo root; `:/nexo` would be tighter.
- [ ] `node --test <directory>` does not work on this repo's declared Node floor, so each file under
      `scripts/__tests__/` must be named explicitly in the root `test` script. A third guard test
      added later will be silently unrun if someone forgets.

- [ ] **Seven em dashes are committed in `nexo/runs/.../context-pack.md`.** The repo forbids the
      character. They are tool-generated boilerplate from `nexo-context-pack.sh`, not written by any
      agent here, and there are zero under `apps/`, `packages/` or `scripts/`. The fix belongs in the
      generator in `15--SKILL--nexo`, not in a rewrite of a generated artifact.

## Pre-existing, not caused by this run, found by the wave-verify

- [ ] **`.github/workflows/ci.yml` triggers on `main`, but this repo's trunk is `master`.** It only
      runs `fxl-doctor.sh`, so nothing important is being skipped, but it has never fired on a real
      push and nobody would notice if it started mattering.
- [ ] **`apps/api/.env` points `DATABASE_URL` at STAGING.** The integration suite is provably pinned
      away from it - `test/rls/setup-env.ts` hard-overrides the value - but anything that bypasses
      that file talks to staging. Already documented in `CLAUDE.md`; repeated here because it is a
      live foot-gun.

## Rollback note

Zero migrations in this range, so a revert is a pure code revert - BUT only if the operator CREATES
`SALES_SESSION_ENCRYPTION_IKM` alongside the old variable rather than renaming it in place. If the
old name is deleted and the code is later reverted, the sealer loses its IKM in the other direction.
Keep both names present until the revert window closes.
