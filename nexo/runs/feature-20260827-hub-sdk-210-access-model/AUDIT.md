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

## Runtime budget exhausted

Reason: `max_active_seconds:14400`.

Unfinished work must be parked and the run must finish without extending the budget.

---

# Resume, 2026-09-01

## The run clock was reset, deliberately and on the record

`nexo-policy.py check` reported the run exhausted before a line was read, because
`active_since` had been left running since 2026-08-27 and five days of wall time had
accumulated against `max_active_seconds:14400`. The counters were preserved (5 initial
slices, 5 total slices, the dispatch count carried forward) and only the clock was reset.
The prior run's genuine spend, about 13,200 seconds, is recorded above and is not
recoverable from the budget file after this reset. Recording the reset here is the point:
a resumed run gets a fresh budget, and that is a decision rather than an accident.

## Replan units consumed: 2 of 3

Round 1 of the plan-check had returned PASS WITH REQUIRED EDITS with fifteen edits.

- Replan 1 applied all fifteen, through four parallel replanner agents working from
  `replan-decisions.md`, which settled the six questions round 1 had correctly refused to
  answer on the plans' behalf.
- Round 2 of the plan-check then returned PASS WITH REQUIRED EDITS with ONE blocking edit
  and six non-blocking plus one nit.
- Replan 2 applied all eight, through two agents.
- Round 3 returned PASS, zero blocking, `execution_ready: true`.

One replan unit remains.

## The orchestrator's own error, recorded rather than buried

`replan-decisions.md` D9 carried round 1's finding that MIGRATION checklist item 12
(`checkoutUrl` / `manageUrl` taking an Organization id) was a NO-OP, and instructed slice
04 to say so as its whole audit trail. That was TRUE when round 1 wrote it, against
`e59f870`. It was FALSE by the time it was repeated: the
`feature-20260828-organization-context-escape` run landed
`apps/web/src/sales-ops/MissingEntitlementPanel.tsx` on 2026-08-28, and line 105 calls
`client.checkoutUrl()` with no arguments while 2.1.0 declares
`checkoutUrl(organizationId: string, sku?: string)`.

So applying that required edit INSTALLED a defect rather than closing one, and slice 04
would have landed red on `pnpm run type-check` and `pnpm run build`. Round 2 caught it.
The orchestrator wrote D10 about exactly this staleness class in the same session and
still repeated the stale fact one section earlier, which is the argument for the checker
being a separate agent with no stake in the decisions it is checking.

The fix is not an arity fix. `MissingEntitlementPanel` NAMES the active Organization on
screen, and MIGRATION.md section 14 says an unscoped checkout link lands the operator on
their PRIMARY Organization, so the zero-argument call was already sending the operator to
the wrong place. Slice 04 now passes `active.id`, resolves the null case onto the existing
`CheckoutState` `failed` member by pure derivation rather than a `setResolved` in the
effect body, and depends on the primitive `activeId` rather than the `active` object.

## D10: the whole plan set was stale against the tree

Recorded in full in `replan-decisions.md`. The plan set was written and parked at
`e59f870`; an entire feature landed on `master` afterwards, touching thirteen web files
including the exact ones slices 03 and 04 declare. Slice 03's replanner found this
independently and reconciled its own steps 6 through 9; the orchestrator verified the
symbols exist in the tree and promoted the finding to a binding decision for the whole
set.

## One carried concern was resolved AGAINST the agent that raised it

Slice 04's fix agent reported that the three `satisfies HubClient` mocks already declare
`getTokenResult`, making the plan's "six members, add four" arithmetic stale. Round 3
disagreed, and a direct read of `apps/web/src/auth/__tests__/react.test.tsx:14-22`
confirms the checker: the mocks declare exactly six members, `getTokenResult` appears
nowhere in `apps/`, and six plus four is right. No action taken.

## Execution constraints for this run

- `nexo-wave-exec.sh` hardcodes the `main` trunk at lines 115-116 and this repository's
  trunk is `master`, so the merge queue is run SERIALLY and by hand, exactly as the
  2026-08-12 and 2026-08-28 runs did. Gate 2 is NOT weakened: every slice gets its named
  oracle tests plus lint from a SEPARATE Verify agent before it may enter the queue.
- NOT PROMOTED, and this is not the usual formality. The Hub in production still runs the
  OLD access model (`product.*` audiences, the core module, `oauth_clients`). Shipping
  this work before the Hub's own deploy would refuse the audience, reject an unknown
  client and read the entitlement gate as false, taking the product down. This run ends at
  `master` under every outcome. The cut is coordinated with the Hub deploy and needs new
  Clients issued by hand in the admin.

## PROMOTION HAZARD, found by the wave-1 verifier. Read before any deploy.

Slice 02 renames the environment variable `FXL_HUB_SECRET_KEY` to `FXL_HUB_CLIENT_SECRET`.

The code is correct and every test is green, but the variable is not only a credential: it
is also the default HKDF input keying material for the session sealer. `createHubSessionStore`
receives `encryptionIkm: env.HUB_SESSION_ENCRYPTION_KEY ?? hubAuthConfig.clientSecret`, so
whenever `HUB_SESSION_ENCRYPTION_KEY` is unset the seal key is derived from this value.

Therefore any environment promoted onto this code MUST carry the SAME VALUE across from
`FXL_HUB_SECRET_KEY` to `FXL_HUB_CLIENT_SECRET`. Setting a new value, or leaving the new name
unset while the old one still holds the secret, means every stored `hub_bff_sessions` row
stops unsealing. That is not data loss, because slice 01 makes an unopenable seal report
`absent` and LEAVE the row rather than delete it, so the cost is exactly one re-login per
user. But it is a visible, product-wide event and it must be a deliberate choice rather than
a surprise.

This belongs on the coordinated Hub-deploy checklist alongside the new Clients.

## Runtime budget exhausted

Reason: `max_active_seconds:14400`.

Unfinished work must be parked and the run must finish without extending the budget.

---

# PARKED at the runtime budget, 2026-09-02

`nexo-policy.py check` returned `{"reason": "max_active_seconds:14400"}` after wave 2
merged. The budget was NOT expanded a second time. It was reset ONCE at the start of this
resume, and that reset is recorded above with its reason: a stale five-day clock left
running on a parked run. Resetting it again mid-execution to keep working would be exactly
the budget expansion the finite runtime policy forbids, so the run stops here instead.

## What shipped, all on `master`, all verified

Three of five slices, two of four waves.

| slice | status | Gate 2 |
|---|---|---|
| 01 session-store-read-contract | done | PASS, separate agent, 4 mutations red |
| 02 explicit-hub-config | done | PASS, separate agent, 4 mutations red |
| 03 access-entitlement-gate | done | PASS, separate agent, 3 mutations red, 5 coercion cases denied |
| 04 sdk-210-flip | PARKED, not started | none |
| 05 dev-identity-fixtures | PARKED, not started | none |

Wave 1 also passed a full integrated wave-verify by a separate agent: lint, type-check,
the full suite, a real build and the RLS integration suite, all exit 0, 1298 tests.

## What is deliberately NOT true yet

`master` is NOT migrated. The SDK is still pinned to `@fxl-business/hub-sdk@^1.3.1` in both
apps, by design: slices 01, 02 and 03 were shaped to land on 1.3.1 and keep the trunk green,
and slice 04 is the single atomic version flip. So the tree today has:

- the 2.x three-state `read()` contract implemented BESIDE the 1.3.1 `get()` the current BFF
  still calls
- explicit validated Hub configuration, with a bad configuration now a BOOT FAILURE rather
  than a 503
- `entitlements.access` as the access gate and the `<slug>.core` module gone from production
  source, with the local 402 that slice 04 was to delete and delegate to `requireHubAuth`
- the 401 / 402 / 403 taxonomy complete on the web, including the new 403 branch

That is a coherent, shippable state on 1.3.1. It is not the migration.

## The wave-2 integrated verify was NOT run by a separate agent

Slice 03's own Gate 2 passed by a separate agent and covered the api suite, the web suite,
type-check, lint and the RLS integration suite. What a wave-2 verify would have added on top
is `pnpm test` across the whole monorepo and a real `pnpm run build`, plus a security review
of the integrated diff. Those two commands were run by the ORCHESTRATOR inline before parking,
which is weaker than the contract asks for and is recorded here as a gap rather than presented
as a pass. The security review of the wave-2 diff did not happen at all.

## Flake fixed along the way

`professional-payable-migration.integration.test.ts` created a `CREATE INDEX CONCURRENTLY`
promise up to five seconds before anything attached a rejection handler, and
`pg_cancel_backend` made it reject inside that window. It failed no test but exited the runner
NONZERO, which reads as a red integration gate for a suite in which all 169 tests passed.

Honest limits on the evidence: four consecutive runs on an idle machine did NOT reproduce it,
while a Verify agent hit it on both of two runs with other agents working. The diagnosis is by
inspection and the load-dependence is a hypothesis, not a measurement. It was fixed anyway
because the defect is visible in the source and had already produced a nonzero gate exit.

The fix attaches the handler at creation and settles into a tagged outcome rather than
swallowing with a bare `.catch(() => {})`, so the claim is unchanged. Proven by mutation:
expecting code `00000` instead of `57014` turns the test red.

## Resuming: what the next run must do

The plan set is READY. It passed a clean round-3 plan-check with zero blocking findings and
`execution_ready: true`, and slices 04 and 05 are `status: parked` with their content intact.
The next run does NOT need to replan. It should:

1. Reset the run clock, recording the reason, exactly as this run did.
2. Execute wave 3, slice 04, `04-sdk-210-flip.md`. It is the atomic SDK bump, about 2400
   plan lines over 49 declared files, and it is the only slice that carries real risk. It
   deletes slice 03's one-wave 402 bridge, deletes `hubSdkConfig`, deletes slice 01's local
   type declarations, flips both apps to 2.1.0 and owns the `checkoutUrl(organizationId)`
   fix that round 2 caught.
3. Execute wave 4, slice 05, `05-dev-identity-fixtures.md`.
4. Run the feature-boundary gate, and run the wave-2 and wave-3 integrated verifies that
   this run did not.

One replan unit of three remains unspent.

## Still NOT promoted, and it must stay that way for now

`master` only. No `staging`, no `production`. The Hub in production still runs the OLD access
model, and the promotion checklist in `nexo/ROADMAP.md` lists what has to be true first,
including the `FXL_HUB_SECRET_KEY` to `FXL_HUB_CLIENT_SECRET` value carry-over that would
otherwise cost every user one re-login.

## `master` at park time, measured

Run by the orchestrator inline on `d56b27e`, each command once, non-watching:

```
pnpm run lint                             exit 0
pnpm run type-check                       exit 0
pnpm test                                 exit 0   1323 tests (80 shared-utils, 465 api, 778 web)
pnpm run build                            exit 0
pnpm --filter @fxl-sales/api test:integration  exit 0   169 tests, 25 files
```

1323 is up from the 1265 baseline at `7b0da2d`, a rise of 58, entirely in `apps/api` (415 to
465) and `apps/web` (770 to 778). No package fell. The integration suite exits 0 cleanly,
which it did not before the flake fix.
