# The development identity adapter is chosen at boot, and production is protected structurally rather than by a flag

**Date:** 2026-09-21
**Surfaced by:** `feature-20260921-dev-fake-identity-switch`

## Context

Development and review were blocked on a live Hub.
Before this feature, a Hub outage or a Hub contract change stopped every screen behind authentication, because `apps/api`'s only auth path went through `requireHubAuth`, and `apps/web`'s only token path went through the same real BFF.
A role-gated screen was also unreachable without an account that actually held that role, so reviewing the `meus-dados` painel needed a seller Seat, reviewing `cadastros` needed an admin Seat, and so on.
The request asked for the design already proven in the sibling repository, `/Users/cauetpinciara/Documents/fxl/projects/01--PRODUCT--fxl-finance`, whose `2026-08-17-identity-port-and-local-dev-environment.md` is worth reading as a model of shape and is not to be copied: that repository owns a full identity PORT with an anti-corruption layer over 31 domain folders and pins its own Hub token contract version, while Sales has neither.
Sales adapts at one middleware seam instead, and gets its contract pin from the exact SDK pin already recorded in `CLAUDE.md`, `@fxl-business/hub-sdk@2.3.0`.

## Decision, part one: boot-time replacement, never a request-path branch

The development identity adapter is chosen ONCE, at process boot, and it REPLACES the Hub middleware rather than standing beside it.
The alternative considered and rejected was a per-request branch reading an environment flag inside the ordinary request path.
A branch inside the request path ships inside the production artifact, because the artifact is the same code either way; it is one truthy environment variable away from authenticating anyone who can set that variable, and a reviewer auditing "is there a second gate" has to read the branch's condition correctly every time rather than confirm a structural absence once.
A boot-time replacement means a given process has exactly ONE gate active, in either mode, for the whole of its life, which is the same invariant `CLAUDE.md`'s Auth Model section has always asserted for the real gate: two gates would mean one live and one unreachable with a green suite over the dead one.

## Decision, part two: the four layers, and why a flag alone is not a bar

A single environment flag guarding an in-tree code path does not meet the bar for something that can authenticate a person, so the defence is structural first and assertive second, in four layers.

1. `packages/auth-fake` (`@fxl-sales/auth-fake`) is a devDependency of both `apps/api` and `apps/web`, and never a `dependency`, `peerDependency` or `optionalDependency`.
   This is what actually keeps it out of a production install: `pnpm install --prod` never places it on disk, so there is nothing to import even if every other layer failed.
2. Every access to the package is a DYNAMIC `import()`, never a static import, type-only included.
   A static import, even one the compiler erases at the type level, pulls the package into the module graph that a bundler or a `tsc` build walks, which is exactly what layer one exists to prevent from mattering: a graph edge to an absent package is a build failure, not a silent gap, so the two sanctioned seams (`apps/api/src/auth/select.ts`, `apps/web/src/dev/install-dev-identity.ts`) declare the package's shape structurally instead of importing its types.
3. The web half's dynamic import sits behind `const DEV_IDENTITY_ENABLED = import.meta.env.DEV`, which `vite build` replaces with the literal `false` at build time, so Rollup proves the whole guarded branch dead and drops it from the production bundle. This is elimination, not concealment: the code is not merely unreachable, it is absent from the shipped file.
4. The API refuses to boot, throwing a named error, when `SALES_AUTH_FAKE` is set while `NODE_ENV=production`.

CORRECTION, same day, from a verifier that BUILT the real `apps/api/Dockerfile` rather than reasoning about it.
Layers one to three were claimed to make the fake ABSENT from the production artifact by construction.
That is TRUE for the web bundle, and it is proven against the built artifact by `scripts/assert-web-bundle-clean.mjs`.
It is FALSE for the API image: the `deps` stage installs without `--prod` and the runtime stage copies the whole `packages/` tree, so the package is physically present inside the shipped image.
What actually holds the API artifact closed is layer four alone, `NODE_ENV=production` baked into that image plus the boot refusal that reads it, which was reproduced live refusing to boot.
The remediation is filed on `nexo/ROADMAP.md`: scope the runtime `packages` copy, install with `--prod`, and add a test that inspects the real built image the way the web check already does.
Layer four only makes the failure LEGIBLE: it exists for the case where an operator, on the wrong machine, sets the flag against a build that was never meant to carry the package (a `pnpm install` without `--prod`, or a misconfigured deploy), and it turns what would otherwise be an `ERR_MODULE_NOT_FOUND` stack trace into one sentence naming the cause.
Layer four is the belt, layers one to three are the braces, and it is listed last for that reason: deleting it alone leaves production safe and only leaves the operator less informed about why it refused to start.

## Rejected: a fake Hub server

Standing up a small server that reproduces the Hub's OAuth-style redirect flow and its BFF session protocol was considered and rejected.
Reproducing that protocol buys a thing this repository does not own, and it would be discarded the day the Hub's protocol moves, since a second implementation of someone else's contract drifts the moment the original changes and nobody remembers to update the copy until it breaks.
The local database guard's own history in this file already shows what a second, remote-capable door costs: `apps/api/drizzle.config.ts` is a known unguarded door precisely because it grew its own environment loading outside the two guarded entrypoints, and a fake Hub server would be the same shape of problem at a much larger surface, a whole HTTP service standing beside the real one that every future auth change has to remember to keep honest.

## Rejected: a flag-guarded in-tree branch

Reading `SALES_AUTH_FAKE` inside `appAuthMiddleware` itself, and branching to a fake context builder when it is set, was considered and rejected.
It ships in the production artifact, which is the whole objection: the code exists in every build, the flag is the only thing standing between it and activation, and a reviewer has to trust that the flag can never be true in production rather than observe that the code enabling it is not there at all.
That is exactly the shape `nexo/plans/feature-20260827-hub-sdk-210-access-model/05-dev-identity-fixtures.md` refused in August, for the same reason, and refusing it there was correct for what it was judging.

## Superseded: the parked prohibition

`nexo/plans/feature-20260827-hub-sdk-210-access-model/05-dev-identity-fixtures.md` is `status: parked` and, in four places, forbids a runtime development-identity path: its frontmatter `goal`, its frontmatter `acceptance`, a rule reading "no runtime development-identity path and no stubbed signature verification", and the whole of its section "### 1. No `createDevHubClient`, ever".
It forbade wiring a fake `HubClient` into the SHIPPED request path during an auth migration that was, at the time, adopting `@fxl-business/hub-sdk-testing` purely as a devDependency for claim FIXTURES in test files, with no structural isolation behind a runtime identity path at all.
That reasoning was right for what it was judging: a fake client reachable at runtime, with nothing but a flag between it and production, inside a migration whose whole point was tightening the access gate.
It is void for what this feature actually built, which is a boot-time replacement that refuses to boot in production and is pinned by a guard that proves itself against mutated fixtures rather than merely asserting a happy path.
It is NOT absent from the API's production artifact; see the correction above, which is the part of this decision that a build disproved rather than an argument.
The prohibition is amended IN PLACE rather than deleted: a dated supersession note sits above the frontmatter's closing fence, a second pointer sits directly under the `### 1. No \`createDevHubClient\`, ever` heading for a reader who lands there by searching for that symbol, and the frontmatter, the `goal`, the `acceptance`, the `rules` and the body of that section are left byte-unchanged, because they remain the true record of what was decided in August and why.
Everything else in that plan is untouched and still parked: adopting `@fxl-business/hub-sdk-testing` as a devDependency for Hub-shaped claim fixtures remains unbuilt and remains a good idea, unrelated to what this feature shipped.

## Superseded: the `admin-only` acceptance criterion

The request asked the roster to include an identity holding `admin` alone, so that an operator could review the state "sees `tatico` plus `operacional` plus `cadastros`, and does NOT see `meus-dados`".
`getRolesFromHubClaims` in `apps/web/src/auth/claims.ts` cannot produce that role set from any claim shape it accepts: every branch that can yield `admin` (`isSuperAdmin`, a workspace `owner` role, a workspace `admin` role, or a seated product role of `admin`) returns the same literal `fullAccessRoles = ['admin', 'seller', 'finder']`, and the function's only other return path filters `['seller', 'finder']`, which can never contain `admin`.
So the reachable role sets are exactly five, and feeding them through `getVisibleWorkspaces` in `apps/web/src/sales-ops/navigation.ts` yields exactly four reachable painel sets, none of which is "the three team painéis and no `meus-dados`" alongside a nonzero role set other than those five.
Producing the requested identity would have meant changing `getRolesFromHubClaims` so that `admin` alone no longer implies `seller` and `finder`, which is a PRODUCTION behaviour change to the app's real claim reader, and the same request that asked for the roster also forbade exactly that: this feature ships no production auth behaviour change.
`nexo/knowledge/decisions/2026-09-19-documentation-that-is-law-is-code.md` states the rule this decision follows: documentation is written from the DECISION that was actually made, and a criterion planning could not satisfy as written must say so and say it was superseded, rather than being quietly reinterpreted until it reads as satisfied.
So the criterion was superseded rather than implemented.
The roster instead carries three identities, `team-owner`, `team-admin` and `product-admin` in `packages/auth-fake/src/index.ts`, that reach the full-access role set through the three DIFFERENT claim shapes the function actually has, each proving one of its three `admin`-yielding branches individually rather than one shape standing in for all three.
A named test records the unreachability as a property (`missingDevDenyBranches`-style coverage plus a direct assertion that no roster identity claims `['admin']` alone maps to a three-painel result), so the day someone splits `admin` out of `fullAccessRoles` that test goes red and is the notification that the roster needs a new member.

## Consequences, including the honest cost

A fake identity is not the Hub, and this mode can never prove that the Hub adapter itself works: it proves nothing about token verification, Organization switching against a live Hub, session rotation, or any of the properties `## Auth Model` pins against the real `requireHubAuth` and the real BFF.
That coverage is provided by the real Hub-integrated local run and by staging, not by daily development in this mode, and it must stay that way; the sibling repository, `fxl-finance`, learned this the expensive way when reviewers came to treat a green development-identity session as evidence the real integration was healthy.
Recorded here so this feature's daily convenience is never mistaken for that proof.
Every screen this mode makes reachable is reachable because the claims flow through the app's own real translation (`getRolesFromHubClaims`, `getVisibleWorkspaces`), which is what makes the mode worth having for UI and role-visibility review; it is not, and must never become, a substitute for testing the Hub integration itself.
The `CLAUDE.md` contradiction this feature found (`## Sales Ops Routing`'s "team-only sees the three team workspaces and no `meus-dados`" describing a role set no token can produce) is left open for the human rather than resolved by this feature, and is filed in `nexo/ROADMAP.md`.
