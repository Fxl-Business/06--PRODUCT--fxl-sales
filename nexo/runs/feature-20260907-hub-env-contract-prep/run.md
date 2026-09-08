# Run record - feature-20260907-hub-env-contract-prep

Flow: feature, autopilot. Trunk: `master`. Not promoted, not tagged, not deployed.

## What was asked and what was actually possible

The handoff prompt's mandatory first step was "does 2.3.0 exist?". It does not:
`npm view @fxl-business/hub-sdk versions --json` answers
`["1.0.0","1.2.0","1.3.0","1.3.1","2.1.0","2.2.0"]`, and the Hub repo's own
`packages/hub-sdk/package.json` is still `2.2.0` with `nexo/plans/hub-env-contract/` slices 01-09
planned and unexecuted. The prompt's instruction for that case was to inventory, plan, install
nothing, change nothing and report parked.

The operator then widened it in session: they are running the Hub work in parallel and want this
repo left ready, with permission to consult the Hub repo directly. So the run executed the half of
the adoption that does not depend on the SDK, and staged the rest.

## Slices

| # | Slice | Verify | Merge |
| --- | --- | --- | --- |
| 00 | `guard-pathspec-fix` | PASS, separate agent | `09d32c0` |
| 01 | `local-session-ikm-rename` | PASS, separate agent | `288a0fc` |
| 02 | `local-post-login-rename` | PASS, separate agent | `bca655c` |
| 03 | `staged-sdk-230-adoption` | docs, see below | this commit |

## Slice 00 was not planned; it was found by taking a baseline

Before changing anything, `pnpm test` was run on `master` at `5eeff1e`. It was already RED.
`scripts/no-legacy-auth.mjs` ran `git grep` over every tracked file, and commit `5eeff1e` - a
docs-only commit closing the v3.0.0 promotion - added a release-verify record whose security section
correctly reports that one dead key NAME survives in the vendored SDK bundle. Reporting the finding
tripped the guard that the finding was about.

The fix is the guard's pathspec, not the record: `nexo/` is append-only evidence and `CLAUDE.md` is
the prose record, and rewriting either to dodge a grep would falsify what a Gate 2 verifier wrote.
`CLAUDE.md` already documents this exact carve-out shape for a different literal.

This matters beyond the fix: Gate 2 means nothing measured against a trunk that is already red, and
slice 01 was about to add a SECOND guard that would have inherited the same defect.

## Why the renames were necessary rather than cosmetic

Read from the Hub's own plan, not inferred from the handoff prompt. Decision D1 makes the canonical
`FXL_HUB_SESSION_ENCRYPTION_KEY` a REQUIRED strict-hex 64-character key decoded to exactly 32 bytes,
SDK-validated, keying the SDK's `SqlHubSessionStore`. This repo's same-named variable is an OPTIONAL
arbitrary-length HKDF input with a `clientSecret` fallback, for the store this repo keeps by the
`gate1_prior` decision. Two different types, two different lifecycles, one name apart, and
fxl-finance holds a third reading of the same string.

The post-login pair is not among the nine canonical names, is resolved start to finish inside this
repo, and falls back to `CORS_ORIGIN`, which the Hub plan places explicitly outside the contract.
After 2.3.0 the `FXL_HUB_` prefix on them would be a false claim of canonicity - a name that looks
SDK-resolved and is not, which is a strictly worse version of the defect the contract closes.

`FXL_HUB_REDIRECT_URI` was deliberately left alone: it IS one of the nine.

## The Hub's D6 was revised mid-session, and my reading of it was WRONG

The plan was read twice, and between readings the Hub reversed D6: `FXL_HUB_REDIRECT_URI` is now
REQUIRED outside `development`, with the `${apiUrl}/auth/callback` default surviving only in dev,
because that default is never correct for any Application (`apiUrl` is the HUB's origin). The staged
plan had been written against the original and was wrong. It was rewritten.

CORRECTION, 2026-09-08, left here rather than edited away because the record is the point. That
middle revision was ITSELF superseded, and the version recorded above is not what shipped. There is
NO presence rule for `FXL_HUB_REDIRECT_URI` in any environment: the shipped `parseRedirectUri`
returns `${apiUrl}/auth/callback` for an absent value unconditionally. What refuses outside
development is check 7 of `assertBootConfiguration`, comparing the ORIGIN of the effective callback
against the Hub's `apiUrl`. Verified by reading the 2.3.0 bundle, not the plan.

The operational conclusion barely moves - an unset variable in production still fails the boot,
because the default lands on the Hub's origin - which is exactly what makes the error easy to keep.
The mechanism differs, and a presence check would have been a weaker second encoding that waves
through the copy-error case the origin check exists to catch.

The transferable lesson is not about D6. A plan file read mid-revision is not a contract; the
shipped artifact is. Three of this run's findings came from reading shipped bytes rather than
documents, and this is the fourth.

## Four things the agents found that the plans did not anticipate

1. **A substring ban would have been wrong.** `HUB_SESSION_ENCRYPTION_KEY` is a strict SUFFIX of the
   canonical `FXL_HUB_SESSION_ENCRYPTION_KEY`, which the staged plan legitimately names. The guard
   uses `git grep -w`, so the longer name is tolerated while `env.X`, `X=` and `stubEnv('X', ...)`
   still match. The brief asked for this to be verified rather than assumed; the assumption would
   have been wrong.
2. **`type-check` is not a rename oracle here.** `type EnvLike = Record<string, string | undefined>`
   is an index signature, so reverting a renamed key read through it compiles cleanly. The post-login
   rename was therefore completely unpinned, and neither existing resolver test passed an explicit
   value - only the `CORS_ORIGIN` fallback. Three oracles were added, including one for the
   `/?error=auth` path that had no test at all.
3. **`git grep` reads the INDEX**, so an unstaged new file is invisible to both guards. A green guard
   run on unstaged work proves nothing.
4. **The guard caught its own explanatory comment.** The banned literal was correctly built by
   character code and then spelled out in a comment directly above it.

## Verification

Every slice: named oracles plus lint on the diff, by a SEPARATE Verify agent that had not seen the
implementer's reasoning, each proving non-vacuity by mutating the source and observing RED.
Slice 00 was proven from both sides: grep-everything and grep-nothing each turn a different oracle
red, so the exclusion set is pinned from above and below.

Integrated `master`: lint 0, type-check 0, `CI=true pnpm test` 0, both guards 0. API tests rose
425 -> 428 and the guard suites 0 -> 11; no package fell.

Honest gaps are in `AUDIT.md` and are not restated here: no integration suite, no security review,
no mutation tooling, and a structural Execute/Verify isolation leak caused by committing exec notes
on the slice branch.

## Not done, deliberately

No install, no `package.json` or lockfile change, no shim, no type augmentation, no `file:`
specifier, no vendored tarball. No deploy, no promotion, no tag. Gate 3 untouched.
