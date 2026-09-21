# Frame findings (orchestrator, before decompose)

## F1 - "admin-only" is UNREACHABLE through the real claim translation

Acceptance 3 asks the roster to carry an `admin-only` identity that "ve tatico+operacional+cadastros
e NENHUM meus-dados", i.e. `profile.roles === ['admin']`.
Acceptance 4 requires the roles to travel the REAL path, `getRolesFromHubClaims` then
`getVisibleWorkspaces`, with no fixture writing `profile.roles` directly.

`apps/web/src/auth/claims.ts` `getRolesFromHubClaims` has exactly three outcomes:

- `isSuperAdmin` OR `roles.workspace === 'owner'|'admin'` -> `['admin','seller','finder']`
- `productRoles` contains `'admin'`                       -> `['admin','seller','finder']`
- otherwise                                               -> `['seller','finder']` filtered by `productRoles`

There is NO input that yields `['admin']` alone. Every admin-bearing claim set also carries
`seller` and `finder`, and `getVisibleWorkspaces` therefore always adds `meus-dados`.

So acceptances 3 and 4 cannot both be satisfied as literally written, and the only way to satisfy 3
is to change `getRolesFromHubClaims`, which is a PRODUCTION behaviour change and is forbidden by
acceptance 8 ("o caminho de producao permanece intacto") and acceptance 12 (no existing test
loosened).

DECISION (autopilot, no human available): acceptance 4 wins over acceptance 3's `admin-only` label.
The roster carries an `owner` identity that exercises the admin branch and legitimately sees all
FOUR paineis, and this is recorded as such rather than faked. The roster still reaches six or more
identities and every OTHER branch acceptance 3 names is genuinely reachable. The gap is reported
to the human as a question at the end of the run.

## F2 - the token does NOT enter through `HubClient.getToken()`

`CLAUDE.md` is explicit: the browser reads `/auth/refresh` itself through
`requestHubAccessToken` in `apps/web/src/auth/refresh.ts` and NEVER through `HubClient.getToken()`,
and `createHubClient` is given `autoRenew: false` with `start()` never called.

The `@fxl-business/hub-sdk-testing` README recipe substitutes `createHubClient` at the client
boundary. In THIS repo that substitution alone would deliver no token at all, because the token
path is the hand-rolled fetch. This is the main "seam fxl-sales does NOT have" the request warns
about: the dev-fake seam here has to be at `requestHubAccessToken`, and `createDevHubClient` is
only useful for the `setActive` / organizations / checkout-link half.

## F3 - `@fxl-business/hub-sdk-testing@2.3.0` exists and matches the pinned SDK

`npm view` reports 2.1.0, 2.2.0, 2.3.0; the tarball peers on `@fxl-business/hub-sdk` at exactly
`2.3.0`, which is what both apps pin. It ships `dist/` only (the 1.3.0 packaging scar does not
repeat), has zero imports, zero `require(`, zero `fetch(` in `dist/index.js`, and both
`DEV_TOKEN_ISSUER` and `DEV_HUB_WEB_ORIGIN` are `https://hub.invalid`, a reserved TLD.
It is the natural spine for `packages/auth-fake` here, which becomes a thin roster + seam package
rather than a re-implementation of the claim encoding.

## F4 - the parked prohibition to reconcile (acceptance 11)

`nexo/plans/feature-20260827-hub-sdk-210-access-model/05-dev-identity-fixtures.md` states it in four
places: frontmatter `goal` and `acceptance` ("with no runtime identity path"), the rule
"no runtime development-identity path and no stubbed signature verification", and section
"### 1. No `createDevHubClient`, ever".
`CLAUDE.md:135` additionally records that the twin is in no `package.json` and no lockfile entry,
and says "Re-ground it if the twin is ever installed" - which this feature does.

## F5 - MEASURED: the API does not boot locally today

Reproduced on 2026-09-21 in this worktree, with the operator's own `apps/api/.env` copied in from the
main checkout:

```
[fxl-sales-api] database host=localhost port=5006
HubConfigError: hub-sdk: FXL_HUB_CONFIG.environment must be exactly one of "production",
"staging" or "development". It is EXPLICIT configuration and is never inferred from the
process environment.
  at loadHubConfig ... at tryLoadHubAuthConfig (apps/api/src/config/auth-provider.ts:141)
  at apps/api/src/middleware/app-auth.ts:96  at apps/api/src/server.ts:48
```

The cause is that the local `.env` still carries the pre-v4.0.0 names
`FXL_HUB_PUBLISHABLE_KEY` and `FXL_HUB_SECRET_KEY` plus `FXL_HUB_API_URL`, so `hubConfigIsAbsent`
is FALSE (one of the six credential-bearing names is set) while the discrete set is partial - the
v3.1.0 "three of five is a misconfiguration, not an unconfigured machine" boot failure.

So the feature's first acceptance ("com NENHUM Hub escutando em localhost:9016, `make dev-fake` sobe
API e web") is not merely about the Hub being down: today the API refuses to boot at all before any
Hub is contacted. The dev-fake API path must therefore SKIP the Hub configuration load and the BFF
mount entirely, exactly as fxl-finance's `index.ts` skips its BFF under `AUTH_FAKE`, rather than
merely tolerating a Hub that does not answer.

## F6 - fxl-finance hand-rolls its claim encoding; fxl-sales must NOT

`packages/auth-fake` in fxl-finance predates `@fxl-business/hub-sdk-testing` and re-implements
`toHubClaims`, `mintDevToken`, `readTokenSubject` and the 40-workspace cap by hand.
This repo pins `@fxl-business/hub-sdk@2.3.0` and the twin at the same exact version is published,
so mirroring the hand-rolled encoding here would create a SECOND encoding of a contract the twin
already owns and guards against `token-contract.json`.
The mirror therefore keeps fxl-finance's STRUCTURE - a private `packages/auth-fake` workspace
package, source-only exports, the `exercises`-per-identity rule, the boot-time selector, the
vanilla-DOM switcher, the guard test, the planner/writer seed - and takes the CLAIM and TOKEN
encoding from `@fxl-business/hub-sdk-testing@2.3.0` (`DevIdentityRoster`, `devHubClaims`,
`mintDevToken`, `isDevToken`, `readDevTokenSubject`, `assertDevRoster`, `missingDevDenyBranches`).

## F7 - two vacuity holes in fxl-finance's guard, to be closed rather than copied

`scripts/__tests__/auth-fake-isolation.test.mjs` there has `walk()` return `[]` for a missing
directory and then asserts `deepEqual([], [])`, so a renamed source root silently scans nothing;
and its dynamic-import allowlist is a PERMISSION with no matching OBLIGATION, so a file that stops
importing the roster leaves the guard green.
Its `apps/api/scripts/**` tree is also entirely unscanned, and the seed there does statically
import the roster.
The mirror asserts a non-zero file count per scanned root, asserts each allowlisted file really
does carry the dynamic import, scans the scripts tree too, and proves itself by re-spawning against
mutated fixture trees in the mould of `scripts/__tests__/local-database-guard.test.mjs`.

## F8 - MEASURED baseline, the floor this feature must not move

`CI=true pnpm test` in this worktree at `aa5a615`, exit 0:

| workspace | files | tests |
|---|---|---|
| `packages/shared-utils` | 3 | 80 |
| `apps/api` | 50 | 526 |
| `apps/web` | 72 | 915 |
| root guards (`node --test`) | 3 | 21 |
| **total** | **128** | **1542** |

Acceptance 12 is measured against exactly this: the count may only GROW, and no existing title or
assertion may be loosened.

Note for every executor: this worktree's `apps/api/.env`, `apps/api/.env.staging` and
`apps/web/.env` were copied in from the main checkout because a git worktree does not carry
untracked files and the integration suite needs `TEST_DATABASE_URL`. All three are gitignored and
must never be committed. `DATABASE_URL` in that file is `localhost:5006`, which is the local docker
container, and the 2026-09-16 staging incident does NOT reproduce.
