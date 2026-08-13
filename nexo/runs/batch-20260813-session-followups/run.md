# batch-20260813-session-followups

Milestone: v2.8.0
Flow: `/nexo-feature --autopilot`, follow-up wave to
`feature-20260812-session-survives-one-refresh`.
Trunk: `master`. Nothing promoted. The operator asked explicitly to keep the promotion for
themselves, so this run stops at `master` and does not tag, push a release, or touch
`staging`/`production`.

## Why this run exists

The feature run fixed the every-two-minutes logout in production and closed with a set of
follow-ups its Gate 2 verifiers had filed rather than fixed. This run closes them.

The operator also asked for the upstream SDK fix. That lives in `16--INTERNAL--fxl-hub`, and they
asked NOT to have this session touch that repo, but to be handed a prompt to run there instead.
That prompt is `nexo/playbooks/fix-hub-sdk-rotated-cookie-prefix.md`.

## Slices

| id | slice | Gate 2 |
| --- | --- | --- |
| 05 | `pin-the-composed-session-journey` | PASS |
| 06 | `close-the-verifier-follow-ups` | PASS |

## Slice 05, and the finding that justifies the whole run

The four feature slices were each tested in isolation. Nothing tested the JOURNEY: lose the
session, click `Entrar`, complete the Hub round trip, arrive somewhere.
`apps/web/src/__tests__/session-journey.test.tsx` now pins it, with everything real except the Hub
client, the token cache and the Sales Ops data hooks, and with the round trip modelled as a genuine
unmount and remount so the restore effect actually runs.

What it exposed is the important part.

**The slices cover for each other.** With slice 03 fully reverted (so `/no-role` IS restored as a
returnTo), the operator still ENDS UP on the right screen, because slice 04's guard rescues them
from the dead end. A test asserting only the final URL stays green with slice 03 entirely gone.
Only `expect(visited).not.toContain('/no-role')` distinguishes a refused restore from a rescued one.

That is the mechanism by which three individually-green thirds coexisted with a broken whole, and it
is invisible to any isolated test. It is also, in miniature, why this bug was reported and "fixed"
three times.

**The plan's own revert prediction was wrong, and the executor caught it.** Scenarios 4 and 5 both
stay green without `NoRoleGuard`: scenario 4 never reaches `/no-role` because slice 03 refuses it,
and scenario 5's operator genuinely has no roles, which is exactly who the guard is meant to leave
there. Slice 04 is only observable with an ENTITLED operator at `/no-role` and an empty returnTo
slot. The executor reasoned that out and added a sixth scenario the plan had not asked for. Without
it this run would have shipped a file with zero slice-04 coverage while claiming to have it.
Do not delete that scenario as "not in the plan".

## Slice 06, and a test that could not fail

Four independent follow-ups, four atomic commits.

1. `RoleRouter` deleted. It read like the `/` root redirect and was referenced from nowhere.
2. `sanitizeReturnTo`'s `/auth` refusal is now case-insensitive, matching the sibling check added
   directly beneath it. Verified over 400 535 differential inputs that nothing rejected before is
   accepted now; the only behaviour change is 315 mixed-case `/auth` spellings now refused.
3. A comment on the unprefixed-cookie api test recording that its redness under the `fetchImpl`
   probe is a harness artifact rather than a real dependency. Two separate reviewers had re-derived
   that from scratch.
4. The substantive one. `session-journey.test.tsx` scenario 1 carried the acceptance criterion as
   its title and could not demonstrate it: it entered at `/tatico/dashboard`, which is ALSO the
   admin default landing route, so "restored to where I was" and "fell back to the default" were the
   same string, and the empty returnTo slot came from `consumeReturnTo`'s destroy-before-validate
   whether or not a navigation followed.
   It now enters at `/operacional/vendas` and asserts the slot and the URL together against the
   captured value.
   Proven by probe: neuter ONLY the restore navigation in `react.tsx` and scenario 1 goes red at
   `expected '/tatico/dashboard' to be '/operacional/vendas'`. The slice 06 verifier ran that same
   probe against `master`'s version of the file and confirmed it stayed GREEN there, so the
   "previously could not fail" half is independently established rather than asserted.

## Verification

Both slices passed Gate 2 by separate Verify agents that re-ran every gate first-hand and performed
their own mutations rather than trusting reported ones.

The per-wave integration gate was NOT a separate agent this time, and that is a deliberate,
stated deviation rather than an oversight: slice 06's Verify agent ran the FULL web and api suites
on a branch already containing slice 05, which is the integration. After the merge the orchestrator
re-ran lint, type-check, the full suite (1213 tests: 80 shared-utils, 415 api, 718 web) and a real
`pnpm run build` with every `tsbuildinfo` deleted first. All green. No code in this run was written
by the orchestrator, so no author graded their own work.

Mutation testing at the feature boundary again did not run, because no tooling is configured
(`nexo/ROADMAP.md` carries that as an open chore). Per-slice mutation proofs stood in, as before.

## Documentation

`CLAUDE.md` no longer claims `RoleRouter` exists and records why it went.
Five ROADMAP entries this run closed were retired rather than left to rot.
