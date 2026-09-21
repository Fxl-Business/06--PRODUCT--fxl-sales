# Autopilot audit - run 20260921T141216Z-dev-fake-identity-switch

## Plan beat - acceptance 3 is partially UNSATISFIABLE as written, and acceptance 5 with it

Found by the slice 01 planner, then verified independently by the orchestrator by reading the two
functions rather than taking the report at face value.

`getRolesFromHubClaims` in `apps/web/src/auth/claims.ts` has exactly two returns.
Every branch that can yield `admin` - `isSuperAdmin`, workspace `owner`, workspace `admin`, or a
product role `admin` - returns the SAME literal `fullAccessRoles = ['admin', 'seller', 'finder']`.
The only other return is `productRoleOrder.filter(...)`, and `productRoleOrder` is
`['seller', 'finder']`, so it can never contain `admin`.

Therefore the role sets reachable through the real claim translation are exactly five:
`['admin','seller','finder']`, `['seller']`, `['finder']`, `['seller','finder']`, and `[]`.
`['admin']` ALONE IS NOT PRODUCIBLE BY ANY TOKEN.

Feeding those five through `getVisibleWorkspaces` in `apps/web/src/sales-ops/navigation.ts` yields
only four distinct painel sets: all four painéis, `meus-dados` alone (from three different role
sets), and the empty set that keeps `/no-role`.
The combination "tatico + operacional + cadastros and NO meus-dados" is UNREACHABLE.

This matters beyond this run, and it is not a bug this feature introduced.
`CLAUDE.md` currently states, in the Sales Ops Routing section, that "team-only sees the three team
workspaces and no `meus-dados`".
No token this product accepts can put an operator in that state.
The sentence describes a state the claim translation cannot produce, so either the documentation is
wrong or `claims.ts` is, and this run is not the place to decide which.

### Decision taken without the human, and why

The acceptance criterion is NOT quietly reinterpreted and the roster does NOT fake the state by
writing `profile.roles` directly, because acceptance 4 forbids exactly that and it is the rule that
keeps the fixtures honest.
Instead:

- The roster covers all FIVE reachable role sets and all FOUR reachable painel sets.
- Three separate fixtures reach the full-access set through three DIFFERENT claim shapes, so each of
  the three literals in `claims.ts` has a fixture standing on it rather than one shape covering all.
- A named test records the unreachability as a property, so the day someone splits `admin` out of
  `fullAccessRoles` that test goes red and is the notification.
- Slice 07 must record the `CLAUDE.md` contradiction in the same pass that revises the file.

### [ ] FOR THE HUMAN - a product question this run deliberately did not answer

Should an operator who is a workspace owner or admin, and who is NOT a vendedor and NOT a finder,
see the `meus-dados` painel?
Today they do, because `getRolesFromHubClaims` hands them `seller` and `finder` as well.
`CLAUDE.md` says they should not.
Answering this changes `claims.ts` or `CLAUDE.md`, is outside this feature's WHAT, and is filed here
rather than guessed.

---

## Orchestrator collision - a SECOND session adopted the same dispatch token

Appended by the second session, which stopped rather than compete.

Two Claude Code sessions were driving run `20260921T141216Z-dev-fake-identity-switch` at the same
time, in the same worktree, against the same `.nexo/dispatch/` file. The second session was
invoked with `/nexo-feature --run v5ztl2dm --autopilot` and found `D.state` ALREADY `taken` at
step 0. `engine.md` only specifies the `pending -> taken` transition and says nothing about an
already-taken dispatch, so the second session treated it as adoptable and proceeded. That is the
gap: an already-`taken` dispatch is indistinguishable from a crashed worker's leftovers, and
nothing in the protocol makes a live second worker detectable before it has already written.

It became detectable only at the Decompose beat, when `nexo-policy.py consume` reported
`max_initial_slices:16` against counters the second session had not moved: `initial_slices: 7`,
`total_slices: 7`, `agent_dispatches: 9`. Reading `status.json` then showed seven slice nodes
(`01-auth-fake-package` ... `07-docs-reconciliation`) that the second session never registered.

### What the second session did before detecting it

- Re-ran `init` on `status.json`, re-declaring the phase set. The first session's slice nodes and
  `frame` verdict survived.
- Spawned two read-only research agents (both completed, both reported, no writes to the tree).
- Ran `CI=true pnpm test` once. Exit 0. Read-only with respect to the tree.
- Copied three gitignored `.env` files into the worktree.
- **Overwrote `nexo/plans/feature-20260921-dev-fake-identity-switch/00-OVERVIEW.md`.** This is the
  only destructive act. The file was untracked, so there is no git copy, and the original
  cross-slice design section is gone. A collision notice and a mechanical index reconstructed from
  the surviving slice frontmatter are now at the top of that file.
- Flipped `budget.json` to `exhausted` by consuming 10 slices on top of the existing 7. **Repaired:**
  `exhausted` is back to `null`. The counters were left as they stand, because the 2
  `agent_dispatches` the second session added were real spawns.

### What it did NOT do

No branch was created, no commit was made, no source file outside `nexo/` was modified, and no
process was left running.

### Independently reached the same acceptance-3 finding

Before detecting the collision, the second session derived the same unreachability result recorded
above, by reading `claims.ts` and `navigation.ts` directly: every `admin`-bearing branch of
`getRolesFromHubClaims` returns the same `['admin','seller','finder']` literal, so `['admin']`
alone is not producible and "team panels without `meus-dados`" is unreachable. Two independent
derivations agreeing is worth more than one, and the first session's analysis above is the fuller
one. Its survey of the fxl-finance reference design, the measured green baseline and the
reproduced local boot failure are in `frame-findings.md` beside this file.

### [ ] FOR THE HUMAN - do not run two `--run <token>` workers on one dispatch

Whatever launched the second session handed it a token whose dispatch was already `taken`. Until
the protocol refuses that, a dispatched Nexo worker should verify no peer is live before its first
write.

## Plan beat - a concurrent writer clobbered 00-OVERVIEW.md mid-fan-out

While the seven planners were running, `00-OVERVIEW.md` was overwritten by an agent that had
adopted this run's dispatch token and believed itself to be a second orchestrator session.
It left a collision notice, consumed slice budget that flipped `budget.json` to
`exhausted: max_initial_slices`, reverted that flag itself, copied three gitignored `.env` files
into the worktree, and added `frame-findings.md`.

`ListAgents` shows no live peer session driving this run, so the likelier reading is that one of
this run's own sub-agents exceeded its brief after reading `dispatch.state == taken`.
The cause was not established and is recorded as unresolved rather than asserted.

### Damage, measured rather than assumed

- LOST: the original `00-OVERVIEW.md` prose. It was untracked, so git held no copy.
  RESTORED by the orchestrator from its own generator, not reconstructed from frontmatter.
- INTACT, verified by listing: all seven slice plans, all seven `agents/plan-*.result.json`,
  and `AUDIT.md`.
- `budget.json` verified healthy after the fact: 7/16 initial slices, 9/64 dispatches,
  `exhausted: null`.
- The planners for 01, 02, 03, 05, 06 and 07 read the ORIGINAL file.
  Only 04's planner read the damaged one, and its own briefing carried the third-door obligation in
  full, which its report confirms it honoured. So no slice is less protected for this.

### [ ] FOR THE HUMAN - two things this run did not clean up

- `frame-findings.md` claims a measured green baseline of 1542 tests at `aa5a615` and a REPRODUCED
  local API boot failure. Neither claim was produced by this orchestrator and neither is trusted.
  The baseline is re-measured by this run's own wave-verify; the boot-failure claim is worth your
  attention on its own terms if it is true.
- `apps/api/.env`, `apps/api/.env.staging` and `apps/web/.env` were copied into the worktree by that
  writer. They are gitignored and their `DATABASE_URL` reads `localhost:5006`, which was confirmed.
  They are left in place because the integration suite needs `TEST_DATABASE_URL`, but they were not
  put there by this run.

## Execute beat - serial builds, declared rather than silent

`standalone.md` says a degrade must never pass silently, so this is the declaration.
This run builds its slices SERIALLY on the run branch inside one worktree, instead of building a
wave's parallel-safe slices concurrently in a worktree per slice.
The reason is mechanical: pnpm worktrees carry no `node_modules`, so a per-slice worktree would need
its own full install before it could run a single test, and this repository already paid that cost
once - `nexo/state.json` records the previous run going serial for the same reason.

Gate 2 is NOT weakened by this and that is the point worth checking.
Every slice still gets its named oracle tests plus lint on the diff, by a separate Verify agent that
never saw the implementer's reasoning.
Every wave still gets one full suite plus lint plus type-check on the integrated branch, by another
separate Verify agent.
What is lost is build concurrency, which is wall-clock, not assurance.

## Carry-forward from slice 01's Verify into slice 03's Verify

Slice 01's verifier confirmed the roster is correct today, but flagged that `roster.test.ts` compares
each identity's declared `expectedRoles` and `expectedPaineis` against HAND-TYPED literal sets rather
than against the real `getRolesFromHubClaims` and `getVisibleWorkspaces`.
That is correct for slice 01 and is not a defect against it: a package under `packages/` must not
import an app, and the approved plan assigns the cross-check to slice 03 for exactly that reason.

It does mean the declared fields are, until slice 03 lands, unverified claims that happen to be true.
SLICE 03's VERIFY MUST CONFIRM the cross-check test actually exists, actually runs, and actually
drives the real functions rather than re-asserting the same literals.
If slice 03 ships without it, the roster's central promise is untested in both slices while looking
tested in each.

## Carry-forward into slice 05 - the guard must honour its own two-scope split

Slice 02 landed `vi.mock('@fxl-sales/auth-fake', ...)` inside
`apps/api/src/auth/__tests__/dev-identity-production-refusal.test.ts`.
That is a STRING REFERENCE, not a static import, and it is necessary: without it the test cannot
prove the selector's own production refusal, because `installAppAuthAdapter`'s independent second
guard masks the deletion of the first one.

The plan-check's ruling already allows this - the static-import ban binds test files, the bare
reference ban does not - but slice 05's guard has to actually IMPLEMENT that carve-out.
If it applies the reference ban to test files, it goes red on arrival against code that is correct.
Slice 05's executor must check this specific file, and slice 05's verifier must confirm the carve-out
is real rather than assumed.

## Pre-existing flaky test observed during slice 03, to be investigated this run

Slice 03's executor reported that `apps/web/src/sales-ops/leads/__tests__/leads-board-keyboard.test.tsx`
failed once and passed on rerun, and judged it unrelated to its change.
It is NOT in this feature's scope and it was not caused by this feature.

`CLAUDE.md` is explicit that test flakiness is to be fixed when seen, even when it is not caused by
the work in hand, so this is not being left as a note.
It is investigated after wave 2's integration verify, because a flake is diagnosed by REPEATED runs
and doing that mid-slice would confound this slice's own verification.
If it reproduces, it becomes a mid-flight slice under the replan budget rather than an unrecorded
drive-by edit.

## Flake characterized and closed, not left hanging

`apps/web/src/sales-ops/leads/__tests__/leads-board-keyboard.test.tsx` was run 5 times in isolation by
slice 03's verifier: 0 failures out of 5.
It is not reproducible on demand and it is not caused by this feature's diff, which touches nothing
the leads board reads.
The single observed failure happened during a FULL parallel suite run, which points at load or
timing under concurrency rather than a deterministic defect.

No mid-flight slice is opened for it, and that is a decision rather than an omission: 0 of 5 is not
enough signal to change code by, and editing a test that currently passes 5 times out of 5 would be
guessing at a fix with no red to confirm it against.
It is left recorded here so the next observation has something to join.

## Wave 2 - the end-to-end probe found what 1597 green tests could not

Acceptance 1 has no automated oracle, by the plan-check's explicit and correct decision, so at the
wave 2 boundary the orchestrator actually booted the API with `SALES_AUTH_FAKE=1` and nothing
listening on `localhost:9016`.

IT DID NOT BOOT. The error was
`HubConfigError: hub-sdk: FXL_HUB_CONFIG.environment must be exactly one of "production", "staging"
or "development"`, thrown from inside `installFakeAuthIfRequested` itself:

```
at apps/api/src/middleware/app-auth.ts:96   (module top level)
at async installFakeAuthIfRequested (apps/api/src/auth/select.ts:237)
at async apps/api/src/server.ts:47
```

The cause was then ISOLATED rather than guessed. Re-running the identical probe with
`FXL_HUB_API_URL` blanked boots cleanly in 2 seconds, prints the roster banner, and answers `200` on
both `/health` and `/api/v1/sales-ops/bootstrap`. So the feature itself works.

What breaks it is a PARTIAL Hub configuration. This machine's `apps/api/.env` carries
`FXL_HUB_API_URL` set and the other four identity variables empty, which `CLAUDE.md` records as a
boot failure by deliberate design since v3.1.0.

That design is right for the real path and is not being changed. The defect is narrower and it is
ours: the development identity mode exists precisely so the product can run WITHOUT the Hub, and it
currently cannot survive a leftover Hub variable, because installing the adapter imports a module
that loads Hub configuration at its own top level.
The operator also gets a message naming `FXL_HUB_CONFIG.environment`, a variable they never set,
which `CLAUDE.md` already records as an accepted diagnostic regression of the SDK migration - it is
merely more confusing here, where the Hub is supposed to be irrelevant.

This is a direct failure of acceptance 1 on the developer's real machine, so it is being fixed in
this run as mid-flight slice `02.1`, under the replan budget, rather than filed.

A SECOND observation from the same probe, recorded deliberately: `/api/v1/sales-ops/bootstrap`
answered `200` with NO `Authorization` header at all, because the adapter falls back to the roster
default when nothing names an identity. That is intended, matches the reference implementation, and
is reachable only behind a flag that two independent guards refuse under `NODE_ENV=production`.
It is written down because it is exactly the kind of behaviour that looks alarming later if nobody
recorded that it was a decision.
