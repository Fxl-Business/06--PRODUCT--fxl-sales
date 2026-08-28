# Audit - feature-20260827-hub-sdk-210-access-model

## Status: PARKED after Stage 1. No migration code was written.

The run completed Frame, Decompose, Plan fan-out and Plan-check.
It did NOT enter Stage 2 (Execute), so no slice was built, verified or merged.
`master` carries exactly one commit from this run, and it is repository hygiene rather
than migration work.

## Why the run stopped here

Two independent reasons, and either one alone would have been sufficient.

1. The finite runtime budget was effectively spent. `nexo-policy.py` reported roughly
   13,200 of the policy's 14,400 active seconds consumed at the moment the plan-check
   verdict landed. Executing five slices, each with a separate Verify agent, plus a
   full-suite wave-verify per wave, is hours of work rather than the twenty minutes that
   remained. Starting it would have tripped exhaustion in the middle of a slice, which is
   the worst available outcome: a half-built worktree and an ambiguous trunk.
   The policy forbids extending the budget or opening a replacement run automatically,
   and under autopilot there is no human present to authorize an extension.

2. The plan-check returned PASS WITH REQUIRED EDITS with fifteen specific edits, and
   judged that FOUR of the five slices would land RED as written. Executing a plan set
   that the checker says is red is not a shortcut, it is a guaranteed revert.

Stopping here leaves the work at a coherent boundary: a complete, adversarially checked
plan set, a green trunk, and no partially built code.

## What the plan-check found, in order of severity

- C1. Slice 04 reverts slice 02's entire config architecture and does not own the
  fallout. It reinstates a catch that costs 02 its refuses-to-boot acceptance criterion
  and reddens six of 02's named tests. This is the largest defect in the set.
- Slice 05 is written against `MinimalHubAuthContext`, a type slice 04 deletes, and its
  fixture is not assignable to the `HubAuthContext` that 04 installs. It also omits two
  required `DevIdentity` fields on ten roster identities.
- W1. Slices 01 and 02 both declare `apps/api/src/auth/hub-session-store.ts` and both
  edit `CLAUDE.md`. They are in the SAME wave and build in parallel worktrees, so this
  is a real merge conflict, not a theoretical one.
- Slice 03 fails its own `sales.core` grep gate, because the explanatory doc comment it
  instructs the executor to write contains the very string the gate forbids.
- The 403 half of the deny taxonomy has NO web owner. The API will answer 403 and no web
  panel renders an "ask an administrator" screen for it, so `00-OVERVIEW.md`'s third
  acceptance criterion is unowned.
- 03 and 04 never agree on whether the API keeps its own 402 gate or delegates to
  2.1.0's `requireHubAuth`. 03's comments promise 04 deletes `requireHubModule`; 04 never
  mentions it.

The full report, with every finding cited to a plan section and a repository path and
line, is `plan-check.md` beside this file. The fifteen required edits are listed at its
end and are the exact input for the next run.

## What this run DID establish, and it is not small

The brief named four defects. All four are real and confirmed. `entitlements.access`
appears in zero files in this repository, exactly as the brief predicted.

But the migration is substantially larger than the brief described, and the recon proved
it by reading the shipped 2.1.0 tarball rather than trusting the brief. The twelve facts
that changed the shape of the plan are recorded in `00-OVERVIEW.md`. The load-bearing
ones:

- The session store is NOT already done. `withSession` exists, but the transaction handle
  still exposes `get()`, and 2.x requires `read()` with a three-state discriminated
  result. That rename alone reddens about fifteen tests, and the `expired` versus
  `absent` distinction is the whole point of the change.
- The rotated-refresh-cookie regex is BYTE-IDENTICAL in 2.1.0 and still cannot match a
  `__Host-` prefixed name. `createHubRotatedCookieFetch` stays.
- The undocumented CSRF origin guard is still hardcoded and 2.1.0 adds no configuration
  escape. `createHubBffOriginShim` stays. This is the guard that took production down at
  v2.7.0.
- `createHubBff`'s `redirectUri` DEFAULTS to the Hub's own origin, so it must be passed
  explicitly or the callback points at the wrong host.
- `healthToken` is required outside development and its absence is a boot failure. It is
  operator-generated; the Hub does not issue it. This is a sixth required value the brief
  did not list.
- `HubPublicConfig` carries no client id, so `VITE_FXL_HUB_PUBLISHABLE_KEY` is retired and
  `VITE_FXL_HUB_AUDIENCE`, empty in all three shipped example files, becomes required.

## Repository hygiene fixed along the way

Neither item was migration work; both were blocking.

- The managed-context preflight was red. `AGENTS.md` carried a stale format-3 block and
  `CLAUDE.md` carried none. Both are synchronized to format 4, and the repo-specific
  delivery facts the canonical block does not carry, notably that this trunk is `master`
  and not `main`, are restored outside the markers.
- `pnpm test` was red on `master` before this run started, and not because of any test.
  `scripts/no-legacy-auth.mjs` greps every tracked file for the removed provider's name,
  and a run note written on 2026-08-13 quoted that name while describing its removal. The
  note is reworded; the guard stays maximally strict. All 1213 tests were passing.

## No credential was invented

No clientId, clientSecret, audience, apiUrl, environment or health token was written to
any tracked file, and no network call was made to the Hub.

## Resuming

The next run should consume one `replans` unit, apply the fifteen required edits from
`plan-check.md`, re-run `waves.sh`, and then execute. The plan set is otherwise sound:
the decomposition and the wave ordering both passed.
