# v4.0.0 - the canonical Hub env contract, on hub-sdk 2.3.0

Tag: `v4.0.0` at `a1be9d6`
Cut: 2026-09-14
Flow: `/nexo-ship-prod-ready`
Chain: `master == staging == production == a1be9d6`
Range: `v3.0.0..a1be9d6`, 26 commits, 82 files

The second major bump in two weeks, and like `v3.0.0` it is a real one - but this time the break is entirely in the ENVIRONMENT rather than in the code's own contracts.
Three variables moved out of a namespace that now belongs to the SDK, and an operator who does not carry their values across gets a silent logout or a quiet misroute rather than an error.

No database migration in `v3.0.0..a1be9d6`, so rollback is a pure code revert.
That is the same property that made `v2.7.2`, `v2.8.0` and `v3.0.0` safe to promote straight through, and it is again the whole reason this cut could use the prod-ready flow rather than a staging validation pause.
The topology reinforces it: Vercel builds `apps/web` from the `production` branch ONLY, so a staging push produces no web deployment to validate and the pause would have bought no signal.

## The breaking change is a rename, and it is an operator action

`@fxl-business/hub-sdk@2.3.0` makes the `FXL_HUB_` prefix MEAN "the SDK resolves and validates this", and it publishes nine canonical names.
Three of this repo's own variables were sitting in that namespace without belonging to it, so they moved out:

| Old name | New name | Cost of missing it |
| --- | --- | --- |
| `HUB_SESSION_ENCRYPTION_KEY` | `SALES_SESSION_ENCRYPTION_IKM` | Every session seal stops opening and every user is logged out ONCE. Nothing throws, nothing logs. |
| `FXL_HUB_POST_LOGIN_REDIRECT` | `SALES_POST_LOGIN_REDIRECT` | Post-login lands on `CORS_ORIGIN` instead of the configured destination. Quiet. |
| `FXL_HUB_POST_LOGIN_ERROR_REDIRECT` | `SALES_POST_LOGIN_ERROR_REDIRECT` | Same, for the `?error=auth` path. Quiet. |

The first one is the dangerous one and the reason this is a MAJOR rather than a MINOR.
It is the HKDF input for the BFF session sealer; miss it and the sealer silently derives from `FXL_HUB_CLIENT_SECRET` instead, and an unopenable seal reports ABSENT by design rather than raising.
It is self-healing after one re-login, which is precisely what makes it easy to miss.

Semantics did not change by one byte in any of the three.
`FXL_HUB_REDIRECT_URI` is deliberately UNTOUCHED, because it IS one of the canonical nine.

## One resolver, and no wrapper around it

`loadHubConfig` from the SDK is now the only Hub env resolver in this repo.
`hubConfigPresence`'s two-forms detection, `HUB_DISCRETE_ENV_VARS`, `HUB_FIELD_TO_DISCRETE_VAR`, `nameDiscreteVar`, the local health-token requirement and `HubAuthConfig`'s local `healthToken` extension are all deleted, because 2.3.0 owns every one of them.

What survives in `apps/api/src/config/auth-provider.ts` is exactly two things:
`hubEnvBag`, the one bridge from the validated `env` object to the loaders, and `hubConfigIsAbsent`, which answers the single question the SDK has no API for - has this machine been given credentials at all?
That question is what keeps `503 hub_auth_not_configured` alive for a fresh clone, and chasing it found a defect in the adoption plan's own reasoning: the plan wanted `hubConfigPresence` deleted outright, and the obvious recovery would have been the blanket `try/catch` the file header forbids.
It was reported upstream, the SDK authors reproduced it, and a presence predicate is under consideration for 2.4.0.

`assertBootConfiguration` now runs EXACTLY ONCE, inside `createHubBff`, which calls it itself.
Calling it separately would validate one configuration and construct another, and the value they would silently disagree about is `redirectUri` - the exact divergence the origin check exists to catch.

## A deliberate behaviour change

A PARTIAL discrete configuration - some of the five identity variables set, not all - used to fall into the `null` door and answer `503`.
It is now a BOOT FAILURE carrying the SDK's own message.
Three of five is a misconfiguration, not an unconfigured machine, and answering `503` to every request tells the operator nothing about which variable is missing.

A fresh clone is unaffected only because both `.env` examples ship all five BLANK, which is still absent.
That is a claim about a FILE, so it is pinned by a test that reads the file.

## Gate 2 failed once, correctly, on the orchestrator's own unverified premise

The adoption run's plan claimed `.env.example` ships all five identity variables blank, and used that to justify making a partial config a boot failure.
It shipped THREE POPULATED.
So the documented copy step produced a partial configuration, a fresh clone stopped booting, and the `503` fail-soft door died on the exact path it exists for.
No test in the repository had ever read the artefact a human is told to copy.

That oracle now exists, with a VACUITY GUARD proven necessary - a parser returning `{}` makes all four absence assertions trivially green, and only the guard catches it - and it was extended to the fenced dotenv blocks in `README.md` and `CLAUDE.md`, which carried the identical trap one file over.

## Release verification

PASS by a SEPARATE Verify agent on the exact release commit `a1be9d6`, never the implementer.

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm run lint` | 0 | clean, api + web |
| `pnpm run type-check` | 0 | clean, all four projects |
| `CI=true pnpm test` | 0 | 1309 tests / 103 files, plus 11 guard tests = 1320 passing |
| `pnpm run build` | 0 | COLD - both tsbuildinfo and all four `dist/` deleted first |
| `pnpm --filter @fxl-sales/api test:integration` | 0 | 169 tests / 25 files |

Per package: 80 `shared-utils`, 445 `api`, 784 `web`, 11 repo guards.

The integration suite was PROVEN to have run against the local Docker database rather than the staging database `apps/api/.env` points `DATABASE_URL` at, by four independent lines of evidence rather than by assumption.
The verifier explicitly refused the easy argument: `fxl-db-server` IS resolvable from this machine over Tailscale, so "staging is unreachable" was not available and the pinning had to be shown positively.
The decisive evidence is a measured delta of 2552 committed transactions on `pg_stat_database` inside the local container across a second full run, alongside the hard assignment in `setup-env.ts` resolving to `localhost:5006` and the non-superuser `fxl_sales_test` role being the one that connects.

Security review of `v3.0.0..a1be9d6`, no findings on any of the five axes:
no credential VALUE anywhere in the diff (both env examples ship every secret slot blank);
no changed line touching the single access gate - the four grep hits are all comment text, and `allowWithoutAccess` is still at its default `false` with no `requiredModule` anywhere;
zero changed lines touching org scoping, RLS or `withTenant`;
not one line of `apps/web/src` changed at all, so no identifier-rendering path could have moved;
and no new outbound call, the only dependency movement being the exact-pinned SDK bump with a byte-identical transitive tree, which is why the `pnpm-workspace.yaml` Hono override did not need to move.

The net security direction is inward: `trustedOrigins` is no longer hand-passed as an option, and a partial configuration is now a boot failure instead of a silent `503`.

## Rollback

Pure code revert to `v3.0.0` (`7ddf525`). There is no schema change to undo, no backfill to reverse and no forward-only DDL.

One asymmetry to know before reverting: `v3.0.0`'s code reads the OLD variable names, so if the three renamed values were set under their new names they must be restored under the old ones.
This is exactly why the runbook says to CREATE the new name alongside the old rather than renaming in place - a revert inside the rollback window then still finds its value.
`FXL_HUB_TRUSTED_ORIGINS` can be left set; `v3.0.0` ignores it and uses `CORS_ORIGIN`.

## Operator items this cut does NOT close

Recorded here rather than in the run only, because they are the live risk and the repository cannot check any of them.
They were surfaced at Gate 3 and the release was approved with them open, on the operator's explicit statement that there are no production users yet.

- `FXL_HUB_TRUSTED_ORIGINS` must be set in staging and production. Unset, the list is `[]`, and because the web app is on `sales.fxlbusiness.com` while the API is on `sales-api.fxlbusiness.com`, every browser POST to `/auth/*` answers `403 origin_not_trusted`. That is the 2026-08-10 outage exactly. Confirmed against the shipped `dist` to have NO fallback.
- `FXL_HUB_REDIRECT_URI` must be explicit outside development. NOT a presence rule: the SDK defaults an absent value to `${apiUrl}/auth/callback`, which is the Hub's own origin, and the boot refuses that origin. Loud, not silent.
- The three renamed variables must carry their VALUES, created alongside the old names.
- `VITE_*` variables on Vercel validate at RENDER, not at build. A green Vercel build is not evidence the browser can boot.

Carried forward to the next milestone until an operator confirms each one.
