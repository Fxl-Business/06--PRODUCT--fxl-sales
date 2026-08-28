---
feature: feature-20260827-hub-sdk-210-access-model
milestone: v2.8.0
---

# Migrate FXL Sales onto @fxl-business/hub-sdk 2.1.0 and the access-model-v1 gate

## What and why

FXL Sales is pinned to `@fxl-business/hub-sdk@^1.3.1`.
The Hub has moved to `2.1.0` and replaced its access model.
Two of the changes are not stylistic: they lock every operator out of the product.

- The Audience this app asks for is DERIVED as `product.<slug>` from the publishable key.
  Contract v1 Audiences are `app.<slug>`, so the Audience no longer names anything the Hub mints.
- Every request is gated on `auth.claims.entitlements.modules.includes('sales.core')`.
  The core module was DELETED in access-model-v1 and `entitlements.modules` now carries ADD-ON
  modules only, so that gate is false for every user.
  Access is now the required boolean `entitlements.access`, which appears in ZERO files here today
  (confirmed by grep over the whole repository, `nexo/` included).

The migration is therefore a correctness fix first and a version bump second.

## What the recon established that the brief did not

The three recon reports in `nexo/runs/feature-20260827-hub-sdk-210-access-model/` are the
factual basis for this plan set. Read them before planning a slice.

- `recon-sdk-surface.md` - the real 2.1.0 API surface, read from the shipped `.d.ts` and `dist`.
- `recon-api.md` - every API-side site that touches the SDK, with path:line.
- `recon-web.md` - every web-side site, plus the whole env and deployment surface.

Facts that changed the shape of this plan:

1. `HubSessionTransaction.get()` became `read()` and returns a discriminated
   `{status: 'found'|'expired'|'absent'}`. The brief said the store was already done because it
   implements `withSession`; it does, but its transaction handle still exposes `get(): Promise<HubSessionRecord | null>`
   at `apps/api/src/auth/hub-session-store.ts:261`. That rename alone reddens about fifteen tests.
   The distinction is load-bearing and is the reason the rename exists: `expired` clears the cookie,
   `absent` never does, so a database blip costs a retry instead of a logout.
2. `HubSessionStore.kind` (`'persistent' | 'ephemeral'`) is now REQUIRED and is asserted at
   construction. This repo carries `kind` on the FACTORY envelope, not on the store object.
3. `secureCookies` became `insecureCookies`, inverted, and legal only when
   `environment === 'development'`.
4. `sessionStore` is required in EVERY environment, not only production.
5. `healthToken` is REQUIRED outside development, and its absence is a boot failure.
   This is a token the operator generates; the Hub does not issue it.
6. `POST /auth/switch` is DELETED. `setActive` now rides `POST /auth/refresh` with
   `{organizationId}`. Nothing in `apps/web/src` spells either route, so the web half is unaffected;
   the pin in `apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts:605` is not.
7. `HubPublicConfig` is `{apiUrl, environment, audience}` and carries NO client id.
   `createHubClient` THROWS if handed anything carrying `clientSecret`. This repo has never put a
   secret in the browser, so the throw is a no-op here, but `VITE_FXL_HUB_PUBLISHABLE_KEY` is
   retired and `VITE_FXL_HUB_AUDIENCE`, empty in all three shipped `.env` files, becomes REQUIRED.
8. The rotated-refresh-cookie regex is UNCHANGED in 2.1.0:
   `/(?:^|[,\s])fxl_hub_session=([^;]+)/` at `dist/server.js:357`, byte-identical to 1.3.1.
   It still cannot match a `__Host-` prefixed name. `createHubRotatedCookieFetch` STAYS, and its
   non-vacuity test must stay green rather than going red.
9. The undocumented CSRF origin guard is STILL THERE, still hardcoded, and 2.1.0 adds no
   configuration escape: `CreateHubBffOptions` has no allowed-origins key. The existing
   `createHubBffOriginShim` is therefore still load-bearing and must keep working. This is the
   guard that took production down at v2.7.0.
10. `CreateHubBffOptions.redirectUri` DEFAULTS to `${config.apiUrl}/auth/callback`, which is the
    HUB's origin. It must be passed explicitly or the callback points at the wrong host.
11. The claim is `workspaceId`, not `organizationId`. `organizationId` appears only in the refresh
    body and the URL helpers. No web rename is needed.
12. 2.1.0 over 2.0.0 is purely additive (`loginWithPopup`); the access model did not move.

## Scope limits, stated explicitly

- The SDK's new proactive browser renewal is NOT adopted. This app has its own renewal timer,
  revalidation ladder, logout intent and cache-flush rules, all of them specified in `CLAUDE.md`
  and pinned by tests that took several runs to get right. Replacing them is a separate decision.
- `@fxl-business/hub-sdk-testing` is taken as a devDependency for Hub-shaped CLAIM fixtures in
  tests only. No runtime development-identity path is added: a runtime bypass in an auth migration
  is a production hazard and it would also require stubbing signature verification.
- No credential value is invented. Every Hub-issued value is wired as required configuration and
  left unset, and the run stops to ask for them.
- No network call is made to the Hub. It is not running.
- The deployment topology is not changed. The origin shim keeps the cross-host topology working.

## Acceptance criteria for the feature

- Given the Hub mints access-model-v1 claims, when an operator whose Organization holds
  `entitlements.access === true` calls any protected route, then the request is allowed, and no
  code anywhere reads a `<slug>.core` module.
- Given an Organization with `entitlements.access === false`, when it calls a protected route,
  then the answer is `402` and the web app is told to render a buy screen, never a login screen.
- Given a missing or invalid token, then the answer is `401`; given a valid token without the
  membership, Seat, module or role a route requires, then the answer is `403`.
- Given the API boots, when its configuration is read, then the Audience is an explicit configured
  value and nothing derives it from a publishable key.
- Given `FXL_HUB_CONFIG` is set alongside any discrete `FXL_HUB_*` variable, then the API refuses
  to boot and names the offenders.
- Given a configured environment that disagrees with the Client credential's environment segment,
  then the API refuses to boot, offline, with no network call.
- Given `FXL_HUB_REDIRECT_URI`, then the BFF callback resolves to this app's own origin plus
  `/auth/callback`, never the Hub's origin; locally that is `http://localhost:8006/auth/callback`.
- Given the full suite, lint, type-check and a real build, then all are green with no test weakened
  and no guard bypassed.

## Slice index

| id | slice | wave | acceptance |
|---|---|---|---|
| 01 | `session-store-read-contract` | 1 | the store transaction exposes `read()` with the three-state result and the store declares `kind`, and an unreadable store still reports `absent` rather than `expired` |
| 02 | `explicit-hub-config` | 1 | the Audience and the environment are explicit validated configuration, `FXL_HUB_CONFIG` is accepted, mixing it with a discrete variable fails at boot, and no code derives an Audience from a key |
| 03 | `access-entitlement-gate` | 2 | `entitlements.access` gates every protected route, the `<slug>.core` module is gone, and the 401 / 402 / 403 taxonomy is preserved exactly |
| 04 | `sdk-210-flip` | 3 | both apps resolve `@fxl-business/hub-sdk@2.1.0`, every 2.x contract is honoured, and the suite, lint, type-check and build are green |
| 05 | `dev-identity-fixtures` | 4 | `@fxl-business/hub-sdk-testing` is a devDependency only and Hub-shaped claim fixtures come from it, with no runtime surface |

Waves are derived by `waves.sh` from `depends_on`; this table records the expected shape.
