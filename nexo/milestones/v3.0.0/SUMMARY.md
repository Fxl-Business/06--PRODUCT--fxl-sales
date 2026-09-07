# v3.0.0 - hub-sdk 2.2.0 and access-model-v1

Tag: `v3.0.0` at `7ddf525`
Cut: 2026-09-07
Flow: `/nexo-ship-prod-ready`
Chain: `master == staging == production == 7ddf525`

The first major bump since `v2.0.0`, and it is a real one: the baseline access gate changed shape, the 402 body's code changed, and one token shape that used to be answered `402` is now answered `401`.

No database migration in `v2.8.0..master`, so rollback is a pure code revert.
That is the same property that made `v2.7.2` and `v2.8.0` safe to promote straight through, and it is the whole reason this cut could use the prod-ready flow rather than a staging validation pause.

## The breaking change

Baseline access is now the REQUIRED boolean `auth.claims.entitlements.access`, and nothing else.

`entitlements.modules` carries ADD-ON modules only and must never be read for baseline access.
The `sales.core` module was deleted in the Hub's access-model-v1, so the old `modules.includes('sales.core')` gate was false for every user and answered `402` to the entire product.
`CLAUDE.md` is the one place in the tree that still spells that string, deliberately, as the prose record of what was removed.

Two contract changes ride with it:

- The `402` body's code moves from `missing_entitlement` to `no_org_access`.
  Nothing in `apps/web` breaks on this, because `isEntitlementFailure` keys on `status === 402` alone and never reads the code - which is exactly the asymmetry that predicate was written for.
- A token whose `entitlements` object carries no `access` key at all is answered `401`, not `402`.
  The SDK validates the token against the contract before the entitlement gate runs, and such a token is not well-formed.
  A `401` reaches the login screen, which is the right destination for a token this app cannot use.
  `402` stays reserved for a well-formed token whose Organization simply has no access.

Both are pinned in `apps/api/src/middleware/__tests__/app-auth-access-gate.test.ts`, which drives the REAL verifier rather than a stub: it generates an RSA keypair in-process, serves the Hub's discovery document and JWKS off a stubbed `fetch`, and signs its own tokens, so the gate is proven live and the suite still never leaves the machine.

## Exactly one access gate

`requireHubAuth` from `@fxl-business/hub-sdk@2.2.0` is now the single authority and the only access gate in the API.
It allows only on `entitlements.access === true` and fails CLOSED: absent, `false`, non-boolean, or a missing `entitlements` object all deny.

`classifyHubAccess`, `hasHubOrgAccess`, `hasHubModule` and `requireHubModule` are DELETED.
They were this repo's one-wave bridge while it was on `1.3.1`, which exported no access gate at all.
Two gates would have meant one live gate and one unreachable one with a green suite over the dead one.

`MinimalHubAuthContext` is now an alias of the SDK's real `HubAuthContext` rather than a local declaration, so the gate is finally type-checked against the shape the Hub actually mints.
Under `1.3.1` the type degraded to `any` beneath `skipLibCheck` and the deny branch was unreachable at type level.

## Both vendored shims are deleted, and the deletions were gated on evidence

`2.2.0` fixes upstream the two defects this repo was bridging locally, so the bridges went with the bump rather than after it.

**The rotated-cookie wrapper.**
Through `1.3.1`, `parseRotatedRefresh` could not match the `__Host-fxl_hub_session` name the Hub sets in production, so a spent refresh token was replayed until the Hub revoked the family: one dead session per user every one to three minutes, measured 2026-08-12.
`2.2.0` tries the secure name first and falls back to the plain one (upstream `b301b98`).
The deletion was gated on evidence rather than on the version number - the non-vacuity oracle that proved rotation was lost without the wrapper was run against 2.2.0 first and had to go RED before a line was removed.
`app-auth-bff-wiring.test.ts` still drives the real `createHubBff` handler against a fake Hub sending a `__Host-` prefixed `Set-Cookie`, so the protection is continuous across the bump.

**The CSRF origin shim.**
`1.3.x` hardcoded the guard to the request's own origin, which 403ed every POST in this deployment because the web app and the API are on different hosts - the 2026-08-10 outage.
`2.2.0` adds `trustedOrigins` and computes its own origin from `x-forwarded-proto` (upstream `1cc4812`), so the mount is the ordinary `router.route('', bff)` and the allowed origin is passed as `trustedOrigins: [env.CORS_ORIGIN]`.
That option is required for this deployment and is not optional cleanup.

The vendored Hub config parser goes too, in favour of the SDK's `loadHubConfig`.
One narrow wrapper survives: when the presence is `discrete` or `incomplete`, a `HubConfigError` is rethrown naming the discrete variable, because the SDK names its own JSON form and would point an operator of the five discrete variables at a variable they never set.

## Hub configuration is explicit, validated, and a boot failure when wrong

The audience must equal `app.` plus the client id's slug, and the environment must equal the environment segment inside `pk_<slug>_<environment>_<random>`.
Neither is inferred from `NODE_ENV`: a staging deploy running with `NODE_ENV=production` would otherwise ask the Hub for the wrong Client, which is a 401 at runtime instead of a refusal to boot, and the agreement is checkable OFFLINE.

A bad Hub configuration is now a BOOT FAILURE and not a 503.
`503 hub_auth_not_configured` stays alive only for the `absent` and `incomplete` presences, which is the machine that has simply not been given credentials yet.

`healthToken` is now passed to `createHubBff`; it was validated and loaded long before `1.3.1` had an option to receive it.
`secureCookies` is gone as an option and is replaced by its inverse `insecureCookies`, which the boot assertion refuses outside `environment === 'development'`.

## Operator-facing configuration changes

These were confirmed set in both environments before the cut, and they are the part of this release that lives outside the repository.

- `FXL_HUB_SECRET_KEY` is renamed to `FXL_HUB_CLIENT_SECRET`, and that value is the default HKDF input keying material for the session sealer.
  Any byte difference stops every stored `hub_bff_sessions` row unsealing.
  That is not data loss - an unopenable seal reports `absent` and LEAVES the row - but it costs every user exactly one re-login, so it has to be a deliberate choice rather than a surprise.
  The value was carried across unchanged.
- `FXL_HUB_HEALTH_TOKEN` is new and is generated by the OPERATOR, never issued by the Hub.
  It is required whenever the environment is not `development`, and a missing one is a boot failure.
- `FXL_HUB_ENVIRONMENT` and `FXL_HUB_AUDIENCE` are explicit and validated at boot.
- `VITE_FXL_HUB_ENVIRONMENT` is new and `VITE_FXL_HUB_AUDIENCE` is now required, and both are validated at RENDER rather than at build.
  A Vercel build missing them goes green and then white-screens, which is why they were checked separately from the API's own variables.
- New Hub Clients were issued by hand in the Hub admin: the audience moved from `product.fxl-sales` to `app.fxl-sales`, and the old client id has no environment segment, so it is not a valid 2.x credential.

The Hub deployed access-model-v1 before this promotion.
That ordering was the release's hard precondition, recorded in the run's AUDIT.md and in `nexo/ROADMAP.md`, and it was confirmed by the operator at Gate 3 rather than assumed.

## Also in this cut

- The web half branches on the full deny taxonomy.
  `ForbiddenPanel` is new: a `403` with `missing_module` or `missing_role` renders the ask-an-administrator panel rather than the generic API-fault copy.
  It names no module, no role and no raw identifier, because a `403` body's `code` is a machine token and its `module` field is a Hub-internal identifier that the identifier law keeps out of user-facing copy.
- The classification chain in `SalesOpsApp` is `isEntitlementFailure`, then `isForbiddenFailure`, then `isAuthFailure`, then generic.
  All three predicates key on the STATUS alone, and `entitlement-dead-end.test.tsx` is the oracle for all four arms.
- The session transaction answers `read()` with a three-state `{found | expired | absent}`, because `expired` clears the browser's session cookie and `absent` never does.
  Collapsing the two turns a database blip into a logout the operator cannot recover from.
- `createHubClient` is given `autoRenew: false` and the provider calls `client.stop()` at unmount, so the SDK's own renewal scheduler can never race this app's visibility-gated one.
- A flake was fixed along the way: `professional-payable-migration.integration.test.ts` created a `CREATE INDEX CONCURRENTLY` promise up to five seconds before anything attached a rejection handler, which failed no test but exited the runner nonzero.

## What did NOT ship

Slice 05 of the `feature-20260827-hub-sdk-210-access-model` run, `05-dev-identity-fixtures`, remains parked.
It is developer tooling and carries nothing production-facing.

## Verification

Release-verify by a SEPARATE agent on the exact release commit `7ddf525`, each command run once and non-watching:

```
pnpm run lint                                  exit 0
pnpm run type-check                            exit 0
pnpm test                                      exit 0   1288 tests, 101 files (80 shared-utils, 424 api, 784 web)
pnpm run build                                 exit 0
pnpm --filter @fxl-sales/api test:integration  exit 0   169 tests, 25 files
```

The integration suite was confirmed to have run against `localhost:5006` and not the staging database that `apps/api/.env` points `DATABASE_URL` at.

A security review of `v2.8.0..master` returned no findings on any of its five axes: the gate fails closed and there is exactly one of it; no credential reaches the browser bundle; the durable session store, `trustedOrigins`, `healthToken`, `timeoutMs` and `autoRenew: false` are all still wired; no query dropped its `orgId` filter and the history route still filters on `actorOrgId`; and nothing new logs a secret or renders a raw identifier.

One doc-drift note, recorded rather than swept: `CLAUDE.md` claims to be the only place spelling `sales.core`, and two other occurrences exist - a negative test fixture and a `checkoutUrl` product id.
Neither reads `modules` for baseline access, so the invariant holds and only the sentence about it is imprecise.

## Gate 3

Approved explicitly in-session on 2026-09-07, under `/nexo-ship-prod-ready`, which pushes `staging` and then `production` with no validation pause between them.

The approval was taken in two parts rather than one, because release-verify surfaced a risk the first question had not covered.
The first covered the Hub's own access-model-v1 deploy and the Coolify variables for both environments.
The second covered the Vercel web variables, which sit on a different platform, are validated at render, and would have produced a green build and a white screen.
Both were answered before anything was tagged.

The validate pause bought no signal by topology rather than by shortcut, the same reasoning recorded for `v2.7.2` and `v2.8.0`: Vercel builds `apps/web` from the `production` branch only, so a staging push produces no web deployment to test.
