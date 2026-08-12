# feature-20260812-session-survives-one-refresh

Milestone: v2.8.0
Flow: `/nexo-feature --autopilot`
Trunk: `master`. Nothing was promoted; this run stops at `master`.

## The report

"I have asked more than 3 times for us to fix a session bug in sales, but it is still happening
even after all the updates, I even updated the HUB SDK."
Open the app, wait five minutes, come back to `Sua sessão expirou` at `/no-role`.
Click `Entrar` and land on `Acesso não autorizado`.
Quit the browser, reopen, and it works again.

## What it actually was

Not the bug that had been fixed three times.
All three previous attempts were browser-side, and the defect is server-side and upstream of this
repository entirely.

In production the Hub's auth service runs with `NODE_ENV=production`, so on every successful
refresh it rotates its session cookie as `Set-Cookie: __Host-fxl_hub_session=<rotated>`.
`@fxl-business/hub-sdk@1.3.1` recovers that token with one regex,
`/(?:^|[,\s])fxl_hub_session=([^;]+)/`, and the `__Host-` prefix leaves the cookie name preceded by
a dash, which is neither `^` nor `[,\s]`.
So the match fails, `tx.update()` is never called, Postgres keeps the refresh token that was just
spent, and the BFF still answers `200`.
The Hub forgives exactly one stale generation for 60 seconds, so the replay falls further behind on
every cycle: the first is forgiven, the second trips `reuse_detected`, and the Hub revokes the whole
token family.
Against a 120-second access token renewed at `exp - 60s`, every session in production died about
every one to three minutes, for every user.

It was invisible locally and always had been: outside production the Hub sends the unprefixed name
and the regex matches perfectly.
No test in this repository had ever driven the SDK's real refresh handler.

## Evidence

`evidence.md` in this directory. Measured, not inferred:

- three sequential `POST /auth/refresh` on one live production session answered `200`, then
  `401 session_expired`, then `401 no_session`, reproduced twice on two independent sessions
- the access token's own lifetime is 120 seconds
- driving the genuine `createHubBff` handler against a fake Hub: a `__Host-` prefixed rotation is
  silently dropped, an unprefixed one is persisted, and both answer `200`
- the regex, run in isolation against both cookie names

## Slices

One wave, four slices, no dependencies between them, disjoint `files_modified`.

| id | slice | fixes | Gate 2 |
| --- | --- | --- | --- |
| 01 | `persist-rotated-hub-session-cookie` | the root cause | PASS |
| 02 | `keep-the-route-on-session-loss` | URL destroyed under the overlay | PASS |
| 03 | `never-restore-the-no-role-route` | `/no-role` restored as a returnTo | PASS |
| 04 | `no-role-redirects-when-entitled` | the dead end itself | PASS |

Slices 02, 03 and 04 fix damage that the EARLIER attempts at this bug introduced.
Slice 02's amplifier is a direct consequence of the keep-children-mounted fix from
`quick-20260810-preserve-work-on-session-loss`: that branch kept the subtree alive and the child
immediately navigated it away.

## Execution mode, stated rather than degraded silently

Parallel-wave execution was NOT used.
`nexo-wave-exec.sh` hardcodes `git switch main` and this repo's trunk is `master`, and a fresh git
worktree in this pnpm workspace has no `node_modules`, so a slice could not run its own tests there.
The wave ran SERIALLY on `master`, one branch per slice.
Gate 2 was not weakened: a separate Verify agent graded every slice, and a separate wave-verify
graded the integration.

Mutation testing at the feature boundary did not run, because no mutation tooling is configured in
this repo (already an open ROADMAP item).
In its place every slice carries a targeted mutation proof, run by its Verify agent, recorded below.

## What each Verify agent actually proved

The point of each was to show the new test FAILS without the fix, not merely that it passes with it.

- **01.** The prescribed mutation turned out to be weaker than it looked, because removing
  `fetchImpl` also removes the call-time global resolution, so the un-wired run escaped to a real
  Hub on localhost. The verifier noticed and designed a sharper one: a pass-through `fetchImpl` that
  resolves `globalThis.fetch` at call time but does no rewriting. Exactly the two `__Host-` rotation
  tests then go red on the precise assertion that the store never received the token, with no
  network and fully deterministically.
- **02.** The forbidden URL-preserving-but-unmounting fix is caught by exactly ONE test out of 668,
  the one that collapses the sidebar before the loss. Tests asserting only the URL stay green while
  the operator's work is destroyed, which is why that oracle exists.
- **03.** A fuzz of 98 560 inputs, each independently confirmed by a control to really resolve to a
  pathname React Router renders as `NoRolePage`; attack count equalled block count. Plus 300 000
  random inputs with no leak, and percent-encoded dot segments found that the plan had not named.
- **04.** The `roles.length > 0` simplification produces exactly the predicted
  `redirect loop: /no-role -> / -> /no-role -> ...`, and it is the sole oracle separating the two
  conditions; neither lint nor type-check catches it.

## Wave-verify

PASS on integrated `master`: lint, type-check, `pnpm test` (1203 tests across 95 files: api 415,
web 708, shared-utils 80), and a real `pnpm run build` with `tsbuildinfo` swept first so it could not
pass vacuously.

The integration question no single slice could answer was whether 02, 03 and 04 compose.
The verifier built the composed round trip, ran five scenarios green, and deleted it.
That test is now filed in `nexo/ROADMAP.md` as the highest-value one still missing here: today the
journey the operator actually reported is covered only in three disjoint thirds.

Security review of the integrated diff found no token leak (the wrapper touches only the
backchannel, and a test asserts the browser-facing response carries no `Set-Cookie`), no new
open-redirect bypass, no real-looking secrets in fixtures, and no new dependency or patch.

## Deliberate exception taken

`CLAUDE.md`'s "keep the static legacy route trees and `/no-role` unchanged" is now amended rather
than violated silently.
The rule protects the SHAPE of those trees; it cannot sensibly be read as protecting a dead end,
and the same section already states the intended semantics four bullets earlier ("Zero recognized
roles keeps `/no-role`"), which a screen that never evaluates the condition was not implementing.

## Not done here, on purpose

The real fix is a one-line regex change in `16--INTERNAL--fxl-hub` plus a `1.3.2` publish.
That is a different product's repository and a separate decision, so it is filed in
`nexo/ROADMAP.md` with the exact patch.
Every other consumer of that SDK deployed with a split web/API origin has this bug right now.
`hub-rotated-cookie.ts` is written to stay correct and inert if that lands, and its own
non-vacuity test going red is the signal that it can be deleted.
