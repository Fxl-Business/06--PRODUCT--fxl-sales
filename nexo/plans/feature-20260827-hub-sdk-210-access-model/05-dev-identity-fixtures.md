---
id: 05-dev-identity-fixtures
milestone: v2.8.0
status: todo
depends_on: [04-sdk-210-flip]
files_modified: [package.json, scripts/dev-only-testing-package.mjs, apps/api/package.json, apps/web/package.json, pnpm-lock.yaml, apps/api/src/auth/__tests__/dev-roster.ts, apps/api/src/auth/__tests__/dev-roster.test.ts, apps/api/src/auth/__tests__/hub-auth-context-fixture.ts, apps/api/src/middleware/__tests__/app-auth.test.ts, apps/web/src/auth/__tests__/dev-roster.ts, apps/web/src/auth/__tests__/claims-hub-contract.test.ts]
acceptance: "given @fxl-business/hub-sdk-testing is installed, when the dependency graph is inspected, then it appears only under devDependencies and a guard fails if it ever moves, and the Hub-shaped claim fixtures it emits flow through this app's own claim translation rather than around it"
goal: "Adopt the Hub testing package as a devDependency for Hub-shaped claim fixtures, with no runtime identity path"
must_not_break:
  - "the production and development runtime auth paths, which gain no bypass"
  - "what each replaced fixture previously proved"
rules:
  - "no em dash and no en dash on any added line"
  - "devDependency only, never a runtime dependency"
  - "no runtime development-identity path and no stubbed signature verification"
  - "shrink the slice rather than pad it if part of it buys nothing"
verifier_focus: "that no runtime auth bypass was introduced and that no replaced fixture now proves less than it did"
---

# 05 - dev-identity-fixtures

## What this slice is, in one paragraph

Slice 04 collapsed four hand-rolled Hub claims literals in `apps/api` into ONE fixture module,
`apps/api/src/auth/__tests__/hub-auth-context-fixture.ts`, whose claim skeleton is still
hand-written and can therefore drift from the real contract without a single test going red.
Slice 04's own docblock says this slice re-points it. This slice does exactly that: it replaces
the CONSTRUCTION of that skeleton with `devHubClaims(...)` from
`@fxl-business/hub-sdk-testing@2.1.0`, which emits a real `HubTokenClaims`, and the fixture's
three consumers move with it without being edited. It adds one web-side test that runs the same
Hub-shaped claim set through `getRolesFromHubClaims`. It adds a tracked-file guard that fails the
suite if the package ever appears outside `devDependencies` or is ever imported outside a test
directory. It adds one oracle, T5. It adds nothing else. No existing assertion and no existing
test title is changed anywhere.

### Handoff with slice 04, stated so the two plans agree in writing

Slice 04 CREATES `apps/api/src/auth/__tests__/hub-auth-context-fixture.ts` with a hand-written
claims literal, and moves `app-auth.test.ts`, `routes.test.ts` and `history-route.test.ts` onto
its `hubAuthContext(overrides)`. Slice 05 EDITS that same file, in place, keeping
`HubAuthOverrides`, `FIXTURE_AUDIENCE` and the `hubAuthContext` signature byte-compatible, and
replaces only the claims skeleton. The file is therefore declared in this slice's
`files_modified`. Slice 05 creates NO competing fixture module for the auth context, and
`routes.test.ts` and `history-route.test.ts` are not edited by this slice at all.

## What this slice deliberately does NOT do, and why

Read this before writing code. Three plausible-looking pieces of work were considered and cut.

### 1. No `createDevHubClient`, ever

`createDevHubClient` is the package's headline seam and it is the one thing this slice must not
use. It returns a `DevHubClient` that stands in for the real `HubClient` at runtime. Wiring it
would be a runtime development-identity path, which is exactly the production hazard the overview
forbids in an auth migration, and making it useful end to end would additionally require stubbing
signature verification, because `mintDevToken` signs with the literal string
`development-not-a-signature` and is worthless to any real verifier. This slice uses `devHubClaims`
and nothing downstream of it. `mintDevToken`, `isDevToken`, `readDevTokenSubject` and
`createDevHubClient` are NOT imported anywhere.

### 2. No mint-refusal test. This buys this repository nothing.

The brief asked whether a `mintRefusal` Organization is worth a test. It is not, and the slice is
smaller for saying so.

`devHubClaims` throws `DevRosterError('mintRefusal', ...)` when the target `DevOrganization`
carries `mintRefusal: 'no_seat' | 'not_a_member'`. Asserting that throw would test the vendor
package, not this repository. The real behaviour it models is that the Hub's `getAuthzProjection`
returns not-ok, so NO TOKEN IS EVER MINTED on that path; it reaches an Application as a 403 from
its BFF. This repository does not mint, does not call `getAuthzProjection`, and has no code that
can observe a refusal as anything other than an ordinary upstream 403, which its existing 403
tests already cover. Reproducing the 403 end of it is what `createDevHubClient` does, and that is
banned by point 1.

Consequence for the roster: do NOT put a `mintRefusal` organization in either roster. An identity
whose active organization carries `mintRefusal` is not `isLive` for `devRosterCoverage`, so it
would silently subtract from the coverage assertion in oracle T1 while adding nothing.

### 3. `apps/web/src/auth/__tests__/claims.test.ts` is NOT rewritten

Its six `getRolesFromHubClaims` cases pass deliberately SPARSE literals such as
`{ roles: { workspace: 'admin' } }`, with no `entitlements`, no `isSuperAdmin` and no `iss`. That
sparseness is the point: it proves the reader tolerates a partial claims object rather than
throwing on a missing key. Replacing them with a full `HubTokenClaims` would REDUCE what they
prove, so they stay byte-identical. The Hub-shaped coverage is ADDED alongside them in a new file
instead.

## Which workspaces take the devDependency, and why

| workspace | takes it | why |
|---|---|---|
| `apps/api` | yes | owns all four hand-rolled claim fixtures and the entitlement gate that slice 03 rewrote. This is where drift costs the most. |
| `apps/web` | yes | owns `getRolesFromHubClaims`, the app's other claim-to-profile translation. Nothing on the web currently ties that reader to the Hub contract at all. One new test file closes that. |
| root | no | the guard script reads `package.json` files as JSON and does not import the package. |
| `packages/*` | no | neither shared package reads a claim. |

Declared EXACTLY as `"@fxl-business/hub-sdk-testing": "2.1.0"`, with no range prefix, in
`devDependencies` of both apps. The package peers on `@fxl-business/hub-sdk` at exactly `2.1.0`,
which slice 04 landed, so a caret or tilde here could resolve a version whose peer no longer
matches.

Install command, run once at the repository root:

```
pnpm --filter @fxl-sales/api add -D @fxl-business/hub-sdk-testing@2.1.0
pnpm --filter @fxl-sales/web add -D @fxl-business/hub-sdk-testing@2.1.0
```

If pnpm writes `^2.1.0`, edit both manifests down to `2.1.0` and re-run `pnpm install`. The guard
in step 3 fails on any leading character.

## Step 1 - RED. The rosters and the failing tests come first.

These files are written BEFORE the package is installed. They fail on module resolution. That is
the red.

### 1a. `apps/api/src/auth/__tests__/dev-roster.ts` (new, not a test file)

Vitest collects `src/**/__tests__/**/*.test.ts` only, so a non-`.test.ts` module in `__tests__` is
importable but never collected as a suite.

Export a single `const devRoster: DevIdentityRoster`. Do not invent new ids.

`DevIdentity` is read from the testing tarball's `dist/index.d.ts:54-104`. It requires EIGHT
fields and `label` and `exercises` are NOT optional: `id` (`:57`), `label` (`:58`),
`exercises` (`:60`), `accountId` (`:62`), `activeOrganizationId` (`:64`), `access` (`:71`),
`modules` (`:76`) and `organizations` (`:96`). `productRoles` (`:84`), `isSuperAdmin` (`:86`),
`profile` (`:88`), `trialEndsAt` (`:94`) and `previewOrganizations` (`:103`) are the five
optional ones. Every literal below carries all eight. A literal missing `label` or `exercises`
fails `tsc --noEmit`, and casting past it throws inside `assertDevRoster`, which reddens this
slice's own oracle T2.

`exercises` is free text, but it must NAME a real branch, so every value below uses a member of
`DevDenyBranch` (`dist/index.d.ts:127`): `access`, `no_org_access`, `missing_role`,
`missing_module`, `no_seat`, `not_a_member`, `super_admin`.

```
audience: 'app.fxl-sales'
identities, in this order:
  1. id 'member'
     label 'Ordinary member'
     exercises 'the missing_role branch, and the ordinary access branch beside it'
     accountId <slice 04 fixture default account id>
     activeOrganizationId <slice 04 fixture default organization id>
     access true, modules []
     organizations: [{ workspaceId: <same organization id>, name: 'Org Existing', role: 'member', products: ['fxl-sales'] }]
  2. id 'owner'
     label 'Organization owner'
     exercises 'the missing_role branch for an unseated owner, whose admin mapping comes from the Organization role'
     accountId <same as identity 1>, activeOrganizationId <same as identity 1>
     access true, modules []
     organizations: [{ workspaceId: <same organization id>, name: 'Org Existing', role: 'owner', products: ['fxl-sales'] }]
  3. id 'super-admin'
     label 'Hub super admin'
     exercises 'the super_admin branch'
     accountId <same as identity 1>, activeOrganizationId <same as identity 1>
     access true, modules [], isSuperAdmin true
     organizations: [{ workspaceId: <same organization id>, name: 'Org Existing', role: 'member', products: ['fxl-sales'] }]
  4. id 'product-admin'
     label 'Seated product admin'
     exercises 'the access branch with a seated productRoles claim'
     accountId <same as identity 1>, activeOrganizationId <same as identity 1>
     access true, modules [], productRoles ['admin']
     organizations: [{ workspaceId: <same organization id>, name: 'Org Existing', role: 'member', products: ['fxl-sales'] }]
  5. id 'product-seller-finder'
     label 'Seated seller and finder'
     exercises 'the access branch with two product roles on one Seat'
     accountId <same as identity 1>, activeOrganizationId <same as identity 1>
     access true, modules [], productRoles ['seller', 'finder']
     organizations: [{ workspaceId: <same organization id>, name: 'Org Existing', role: 'member', products: ['fxl-sales'] }]
  6. id 'no-access'
     label 'Organization whose Effective Access is false'
     exercises 'the no_org_access branch'
     accountId 'hub-account-2', activeOrganizationId 'org_no_access'
     access false, modules []
     organizations: [{ workspaceId: 'org_no_access', name: 'Org Without Access', role: 'member', products: [] }]
  7. id 'sales-ops'
     label 'Sales Ops route actor'
     exercises 'the access branch under the ids the sales-ops route fixtures already assert on'
     accountId 'verified-account', activeOrganizationId 'verified-org'
     access true, modules []
     organizations: [{ workspaceId: 'verified-org', name: 'Verified Org', role: 'admin', products: ['fxl-sales'] }]
```

Identity 6's `exercises` names `no_org_access` and NOT `access`. `devRosterCoverage` computes
`access` as `live.some((i) => i.access)` and `no_org_access` as `live.some((i) => !i.access)`, so
`access` is the ORDINARY path and `access: false` is the deny branch called `no_org_access`. The
`.d.ts` says the same at `:119-127`.

**Identity 1's ids are NOT free.** They are the DEFAULT identity of this roster
(`defaultDevIdentity` returns `identities[0]`) and they become the default account and
Organization of slice 04's `hubAuthContext()` once section 2a re-points it. Read the default
literals slice 04 actually left in `apps/api/src/auth/__tests__/hub-auth-context-fixture.ts` and
copy them here verbatim, into identities 1 to 5. At the time this plan was written slice 04's
draft defaults are `user_existing_1` and `org_existing_1`. If they differ when this slice runs,
THE ROSTER FOLLOWS THE FIXTURE, never the reverse: every assertion in `app-auth.test.ts`,
`routes.test.ts` and `history-route.test.ts` is written against slice 04's defaults, and moving
them here would silently redden files this slice is not allowed to touch.

Rules `assertDevRoster` enforces that these literals already satisfy, stated so the executor does
not have to rediscover them by trial:

- `audience` must match `/^app\.[a-z0-9][a-z0-9-]*$/`.
- identity `id` values must be unique. `accountId` values need NOT be unique, which is why
  identities 1 to 5 share one account id.
- `activeOrganizationId` must name an entry in that identity's own `organizations`.
- `modules` MUST be empty when `access` is false. Identity 6 obeys this. `devHubClaims` also
  forces `modules` to `[]` at mint time whenever `access` is false.
- `workspaceId` must be unique within one identity only, not across identities, which is why
  identities 1 to 5 all use one Organization id.

Also export the pinned clock this roster and its consumer share:

```ts
export const FIXTURE_NOW_SECONDS = 1_700_000_000;
```

`nowSeconds` is pinned so `iat`, `exp` and the deterministic `jti` are stable across runs. Section
2a's `hubAuthContext` passes it into `devHubClaims` and passes no `ttlSeconds`; the default
`DEV_TOKEN_TTL_SECONDS` of 900 (`dist/index.d.ts:178`) is fine and nothing asserts on it.

**There is deliberately NO `devAuthContext` helper in this module.** An earlier draft exported one,
an identity-id-to-`HubAuthContext` builder sitting beside the roster. It has no importer and can
have none: section 2a's `hubAuthContext` is the ONE context builder in the API tree, it calls
`devHubClaims` directly because it must also apply `HubAuthOverrides` on top of the claim
skeleton, and all four oracles of section 1b use `devHubClaims`, `assertDevRoster` and
`missingDevDenyBranches`. Keeping an exported builder with no caller is worse than dropping it:
nothing lints it, and the next reader finds two context builders for one fixture and wires up the
wrong one by guessing, which is the same two-modules-for-one-fixture defect section 2a already
records as finding C3. So it is DROPPED, and decision D7's requirement that a complete six-member
`HubAuthContext` be constructed is satisfied by `hubAuthContext` alone, whose return literal at the
end of section 2a is `{ accountId, workspaceId, entitlements, roles, aud: base.aud, claims }`. If a
future slice genuinely needs an override-free builder keyed by identity id, it adds one THEN, with
its caller in the same commit.

**The six members, and where each comes from.** This is the mapping `hubAuthContext` performs in
section 2a, stated once here because it is a property of the roster's claims, not of the overrides
layered on top. `HubAuthContext` is read from the SDK tarball's
`dist/index.d.ts:118-126` and has SIX required members, none optional: `accountId` (`:119`),
`workspaceId` (`:121`), `entitlements` (`:122`), `roles` (`:123`), `aud` (`:124`) and
`claims` (`:125`). The mapping below is the same one the SDK's own verifier performs, which
builds its context from the verified claims at `dist/server.js:221` (`accountId: claims.sub`),
so the fixture reproduces a real verify rather than inventing a context shape.

- `accountId` <- `claims.sub`, which `devHubClaims` sets from `DevIdentity.accountId`.
- `workspaceId` <- `claims.workspaceId`, which `devHubClaims` sets from the RESOLVED
  Organization's `workspaceId`, not from `activeOrganizationId` directly.
- `entitlements` <- `claims.entitlements`, `{access: boolean, modules: string[]}`
  (`dist/index.d.ts:45-54`). `modules` is forced to `[]` whenever `access` is false.
- `roles` <- `claims.roles`, `{workspace: HubWorkspaceRole, productRoles?: string[]}`
  (`dist/index.d.ts:56-61`). `workspace` comes from the resolved Organization's `role`, and
  `productRoles` is OMITTED entirely when the identity declares none, which is exactly the
  unseated `missing_role` shape.
- `aud` <- `claims.aud`, which is `devRoster.audience`.
- `claims` <- the whole `HubTokenClaims` (`dist/index.d.ts:78-116`).

There is no assignability question left to discover. The earlier draft of this plan hedged that
`MinimalHubAuthContext` might not be satisfiable; that symbol does not survive slice 04, which
deletes it and retypes the `declare module 'hono'` augmentation to `hubAuth?: HubAuthContext`.
The resolved shape is the six-member literal above, and no line of code this slice writes may
name that deleted symbol.
### 1b. `apps/api/src/auth/__tests__/dev-roster.test.ts` (new)

Four tests. Exact titles in the oracle section below.

### 1c. `apps/web/src/auth/__tests__/dev-roster.ts` (new, not a test file)

A separate, smaller roster. It is NOT shared with the API roster: a cross-app import would couple
two independently versioned workspaces through a test file, and the two rosters exercise different
things. Web needs role variety only; it has no access gate.

All three literals carry the same eight required `DevIdentity` fields, `label` and `exercises`
included.

```
audience: 'app.fxl-sales'
identities:
  1. id 'workspace-owner'
     label 'Organization owner on the web'
     exercises 'the access branch with a workspace owner role'
     accountId 'acct_web_1' activeOrganizationId 'org_web_1'
     access true, modules []
     organizations: [{ workspaceId: 'org_web_1', name: 'Org Web', role: 'owner', products: ['fxl-sales'] }]
  2. id 'plain-member'
     label 'Ordinary member on the web'
     exercises 'the missing_role branch'
     accountId 'acct_web_2' activeOrganizationId 'org_web_2'
     access true, modules []
     organizations: [{ workspaceId: 'org_web_2', name: 'Org Web Two', role: 'member', products: ['fxl-sales'] }]
  3. id 'super-admin'
     label 'Hub super admin on the web'
     exercises 'the super_admin branch'
     accountId 'acct_web_3' activeOrganizationId 'org_web_3'
     access true, modules [], isSuperAdmin true
     organizations: [{ workspaceId: 'org_web_3', name: 'Org Web Three', role: 'member', products: ['fxl-sales'] }]
```

No coverage assertion on this roster. It is not the access-gating side and forcing it to reach all
four required deny branches would be padding.
### 1d. `apps/web/src/auth/__tests__/claims-hub-contract.test.ts` (new)

Three tests, titles in the oracle section. Each calls
`getRolesFromHubClaims(devHubClaims(webDevRoster, identity, { nowSeconds: 1_700_000_000 }))` and
asserts the same role arrays `claims.test.ts` already asserts for the equivalent shape. This is the
point of the slice: the claims flow THROUGH the app's own translation, not around it.

Import path note: web uses the Bundler resolver, so imports carry no `.js` extension
(`from '../claims'`, `from './dev-roster'`). The API uses the Node resolver and its test files
already import `'../app-auth.js'`, so the API roster import is `'./dev-roster.js'`.

## Step 2 - GREEN. Install, then re-point slice 04's fixture.

Install as specified above, then make ONE source edit. The rule is absolute and it is the same
rule the earlier draft applied to three files: ONLY the fixture construction moves. No `it(...)`
title, no `expect` argument and no control flow changes.

### 2a. Re-point `apps/api/src/auth/__tests__/hub-auth-context-fixture.ts`

This file is CREATED BY SLICE 04, in its section 7.4, and slice 04's own docblock says
"Slice 05 re-points the claims half of this at `devHubClaims` from
`@fxl-business/hub-sdk-testing`. Until then the literals live here." This section is that
re-point. It is the whole of the API-side swap.

Slice 04 has already moved `apps/api/src/middleware/__tests__/app-auth.test.ts`,
`apps/api/src/domains/sales-ops/__tests__/routes.test.ts` and
`apps/api/src/domains/sales-ops/__tests__/history-route.test.ts` onto `hubAuthContext(overrides)`.
Re-pointing the one fixture therefore moves all three consumers at once, without this slice
editing any of them. That is why `routes.test.ts` and `history-route.test.ts` are deliberately
ABSENT from `files_modified` and MUST NOT be edited here: their `currentHubClaims` seam and its
five assignments belong to slice 04's shape and this slice has no reason to disturb them.

The earlier draft of this plan created a competing `devAuthContext(...)` call at each of those
three sites. That would have left slice 04's module created and then orphaned one wave later with
no importer, which is finding C3 of `plan-check.md`. Two fixture modules for one fixture is the
defect, not the fix.

What changes inside the file:

- The hand-rolled `claims` literal is DELETED. The claim SKELETON now comes from
  `devHubClaims`: `iss`, `aud`, `typ`, `contractVersion`, `iat`, `exp` and `jti` are the Hub
  testing package's, not this repository's. That is the drift this slice exists to close.
- `HubAuthOverrides`, `FIXTURE_AUDIENCE` and the `hubAuthContext(overrides)` SIGNATURE are
  unchanged, so every existing call site compiles untouched.
- `FIXTURE_AUDIENCE` becomes `devRoster.audience` rather than a second `'app.fxl-sales'`
  literal, so the two cannot drift.

```ts
import { devHubClaims, findDevIdentity } from '@fxl-business/hub-sdk-testing';
import type { HubAuthContext, HubTokenClaims } from '@fxl-business/hub-sdk';
import { devRoster, FIXTURE_NOW_SECONDS } from './dev-roster.js';

export const FIXTURE_AUDIENCE = devRoster.audience;

export function hubAuthContext(overrides: HubAuthOverrides = {}): HubAuthContext {
  const identity = findDevIdentity(devRoster, 'member');
  if (!identity) throw new Error('the dev roster lost its default identity');
  const base = devHubClaims(devRoster, identity, { nowSeconds: FIXTURE_NOW_SECONDS });

  const accountId = overrides.accountId ?? base.sub;
  const workspaceId = overrides.workspaceId ?? base.workspaceId;
  const entitlements = {
    access: overrides.access ?? base.entitlements.access,
    modules: overrides.modules ?? base.entitlements.modules,
  };
  const roles = {
    workspace: overrides.workspaceRole ?? base.roles.workspace,
    ...(overrides.productRoles !== undefined ? { productRoles: overrides.productRoles } : {}),
  };
  const claims: HubTokenClaims = {
    ...base,
    sub: accountId,
    workspaceId,
    entitlements,
    roles,
    ...(overrides.isSuperAdmin !== undefined ? { isSuperAdmin: overrides.isSuperAdmin } : {}),
    ...(overrides.name !== undefined ? { name: overrides.name } : {}),
    ...(overrides.email !== undefined ? { email: overrides.email } : {}),
  };
  return { accountId, workspaceId, entitlements, roles, aud: base.aud, claims };
}
```

The OVERRIDES half survives on purpose. A roster identity cannot express an arbitrary
`{workspaceRole: 'admin'}` or `{name: 'Ana Verificada'}` without one identity per assertion, and
the three consumer files already spell their variants as overrides. Only the CLAIM SKELETON moves,
which is precisely what slice 04 said would move.

`jti` keeps the value `devHubClaims` derived for the default identity even when `accountId` is
overridden, so it can read as `dev.<default account>.<default org>.<iat>` beside an overridden
`sub`. Nothing in the repository asserts on `jti`, and inventing a second `jti` encoding here
would be exactly the hand-rolling this slice removes. Left as is, deliberately.

### 2b. The two tests slice 03 wrote that CANNOT move, and must not be weakened

Slice 03's `denies a claim set with no access key at all` and
`denies a non-boolean access claim rather than coercing it` are NOT expressible through
`DevIdentity`, whose `access` is a required `boolean` (`dist/index.d.ts:71`). They pass a claim
set the Hub can never mint, which is their entire point. LEAVE THOSE TESTS ALONE, exactly as they
stand, and note the exclusion in the run log. A weakened test is a worse outcome than an unswapped
one.

The same rule generalizes: if slice 03 or slice 04 left any test whose variant is not expressible
from the roster or from `HubAuthOverrides`, leave it alone and record it.

### 2c. ADD one test to `apps/api/src/middleware/__tests__/app-auth.test.ts`

T5 below, and nothing else in that file. Its only job is to fail if someone reverts the fixture to
a hand-rolled literal. No existing title, assertion or control flow in the file is touched.
## Step 3 - the guard. `scripts/dev-only-testing-package.mjs`

Precedent: `scripts/no-legacy-auth.mjs` and `scripts/build-contract.mjs` are plain node scripts
appended to the root `test` script. Follow it. This is a real assertion, not a comment, and it runs
on every `pnpm test`.

Wire it into the root `package.json`:

```
"test": "pnpm run build:packages && pnpm -r --if-present test && node scripts/no-legacy-auth.mjs && node scripts/build-contract.mjs && node scripts/dev-only-testing-package.mjs"
```

The script does exactly four things. Collect every failure, print them all, exit 1 if any.

1. **Manifest placement.** Read `package.json` at the root, at `apps/*` and at `packages/*`. For
   each, fail if the string `@fxl-business/hub-sdk-testing` appears as a key under
   `dependencies`, `peerDependencies` or `optionalDependencies`. This is THE assertion the
   acceptance criterion names.
2. **Exact pin.** Where it appears under `devDependencies`, fail unless the value is the exact
   string `2.1.0`. A range would let the peer on `@fxl-business/hub-sdk@2.1.0` drift.
3. **Import location.** Walk `apps/*/src` and `packages/*/src` for `.ts` and `.tsx` files,
   skipping `node_modules` and `dist`. Fail on any file that mentions `@fxl-business/hub-sdk-testing`
   unless its path contains a `__tests__` segment or a `/test/` segment. This is what proves no
   runtime development-identity path exists, and it is what catches the case that matters most
   here: `apps/api` compiles its own test files into `dist` (there are already
   `apps/api/dist/**/__tests__/*.test.js` artifacts), so a stray import from a non-test module
   would ship.

   **The emitted dist artifact is understood and ACCEPTED.** Verified against the real
   `apps/api/tsconfig.json`, which sets `"noEmit": false`, `"rootDir": "./src"` and
   `"include": ["src/**/*"]` with no test exclusion. `apps/api/dist/auth/__tests__/dev-roster.js`
   and `dist/auth/__tests__/hub-auth-context-fixture.js` WILL therefore be emitted into the
   production build output, each carrying a top-level import of
   `@fxl-business/hub-sdk-testing`, which a `--prod` install drops by construction. Nothing in
   the runtime graph reaches either file, so the import is never evaluated and nothing breaks.
   This is recorded here rather than left for a reviewer to discover. Do NOT "fix" it in this
   slice by adding a tsconfig exclude: `apps/api` already emits
   `dist/**/__tests__/*.test.js` today, so excluding test paths is a build-shape change with its
   own blast radius and it belongs to its own slice, not to a fixture swap.
4. **Self-check, so the guard is not vacuous.** Before scanning anything on disk, run the same
   classifier used by checks 1 and 2 over two in-memory literal manifests: one carrying the
   package under `dependencies`, one carrying it under `devDependencies` at `2.1.0`. Exit 1 with a
   distinct message if the first is not flagged, or if the second is. No file is written. A guard
   that cannot fail is not a guard.

Failure messages must name the offending path and the offending key. `no-legacy-auth.mjs` writes
to stderr and exits 1; do the same.

## Sequencing

1. Write `apps/api/src/auth/__tests__/dev-roster.ts`, `dev-roster.test.ts`,
   `apps/web/src/auth/__tests__/dev-roster.ts` and `claims-hub-contract.test.ts`.
   Run `pnpm test`. RED, on unresolved module `@fxl-business/hub-sdk-testing`.
2. Install the devDependency in both apps at the exact pin. Run `pnpm test`. The four new files go
   GREEN. Nothing else has moved yet.
3. Re-point `apps/api/src/auth/__tests__/hub-auth-context-fixture.ts` (2a) and add T5 (2c). Run
   `pnpm test`, `pnpm lint`, `pnpm type-check`. All green, with no existing assertion or title
   edited and with `routes.test.ts` and `history-route.test.ts` untouched.
4. Add `scripts/dev-only-testing-package.mjs` and wire it into the root `test` script. Run it
   directly once and confirm the self-check line prints and passes.
5. Run a real `pnpm build`. It must not pull the testing package into the web bundle; nothing
   reachable from `apps/web/src/main.tsx` imports it.

## Commits, atomic and conventional

1. `test(auth): add Hub-shaped dev identity rosters and contract oracles`
2. `chore(deps): add @fxl-business/hub-sdk-testing@2.1.0 as a devDependency`
3. `test(auth): build the Hub auth context fixture from the Hub testing package`
4. `build(guard): fail the suite if hub-sdk-testing leaves devDependencies`

## The exact NAMED oracle tests

`apps/api/src/auth/__tests__/dev-roster.test.ts`

- **T1** `covers every deny branch the Hub contract requires a fixture roster to reach`
  `expect(missingDevDenyBranches(devRoster)).toEqual([])`.
  This is the one test this repository could not write before this slice. It is not a vendor test:
  it asserts that THIS repo's fixture set reaches the four branches the testing package REQUIRES,
  and it goes red on a future upgrade that adds a fifth this repo does not cover. Re-verified
  against the tarball: `REQUIRED_DEV_DENY_BRANCHES` is declared at `dist/index.d.ts:135` and its
  value in `dist/index.js:2-7` is exactly `['access', 'no_org_access', 'missing_role',
  'super_admin']`. `dist/index.d.ts:128-134` states that `missing_module`, `no_seat` and
  `not_a_member` are "additionally SUPPORTED and reported by devRosterCoverage, but not
  required", which is what makes the ban on a `mintRefusal` organization sound: `no_seat` and
  `not_a_member` are the only two branches such an organization reaches, neither is required, and
  an identity whose active organization carries one is not `isLive`, so it would SUBTRACT from
  `access`, `no_org_access` and `missing_role` coverage while adding nothing required.
- **T2** `is a roster the Hub testing package accepts, so a malformed fixture cannot reach a test`
  `expect(() => assertDevRoster(devRoster)).not.toThrow()`.
- **T3** `forces modules empty when Effective Access is false, which is the only shape the Hub mints`
  `expect(devHubClaims(devRoster, noAccessIdentity, { nowSeconds: 1_700_000_000 }).entitlements).toEqual({ access: false, modules: [] })`.
- **T4** `mints for this application's own Audience, so a fixture cannot pass under another app id`
  `expect(devHubClaims(devRoster, memberIdentity, { nowSeconds: 1_700_000_000 }).aud).toBe('app.fxl-sales')`.

`apps/api/src/middleware/__tests__/app-auth.test.ts` (one test ADDED, none renamed)

- **T5** `builds its auth context fixture from Hub-shaped claims rather than a hand-rolled literal`
  `expect(hubAuthContext().claims).toMatchObject({ typ: 'at+jwt', contractVersion: 1, iss: 'https://hub.invalid' })`.
  Goes red the moment anyone reverts the fixture to a literal. `'https://hub.invalid'` is
  `DEV_TOKEN_ISSUER` (testing tarball `dist/index.d.ts:188`), a reserved TLD that can never
  resolve, so no hand-written literal would ever plausibly carry it.

`apps/web/src/auth/__tests__/claims-hub-contract.test.ts` (new file, three tests)

- **T6** `maps a Hub-shaped workspace owner claim set to full sales access`
  `toEqual(['admin', 'seller', 'finder'])` from the `workspace-owner` identity.
- **T7** `does not grant a sales role from a Hub-shaped member claim set without product roles`
  `toEqual([])` from the `plain-member` identity.
- **T8** `maps a Hub-shaped super admin claim set to full sales access`
  `toEqual(['admin', 'seller', 'finder'])` from the `super-admin` identity.

`scripts/dev-only-testing-package.mjs`, three named checks reported by the script

- **G1** `hub-sdk-testing must not appear under dependencies, peerDependencies or optionalDependencies`
- **G2** `hub-sdk-testing must be pinned to exactly 2.1.0 in devDependencies`
- **G3** `hub-sdk-testing must not be imported outside a __tests__ or test directory`
- plus the self-check, which fails with
  `guard self-check failed: the classifier does not flag a dependencies entry`

## Verifier notes

- Confirm `git grep -n 'hub-sdk-testing'` returns hits ONLY in the two rosters,
  `apps/api/src/auth/__tests__/hub-auth-context-fixture.ts`, the two new test files, the guard
  script and the `devDependencies` block of the two app manifests.
- Confirm `git grep -n 'MinimalHubAuthContext'` returns NOTHING. Slice 04 deleted the symbol and
  this slice must not resurrect it.
- Confirm `git grep -n 'createDevHubClient\|mintDevToken\|isDevToken\|readDevTokenSubject'` returns
  nothing. If any of those appear, a runtime identity path was introduced and the slice fails.
- Confirm `apps/api/src/domains/sales-ops/__tests__/routes.test.ts` and
  `apps/api/src/domains/sales-ops/__tests__/history-route.test.ts` are BYTE-UNCHANGED by this
  slice. They move onto Hub-shaped claims through slice 04's fixture and need no edit here.
- Diff `apps/api/src/middleware/__tests__/app-auth.test.ts` against its pre-slice state and
  confirm the only change is the single added test T5: no line inside an existing `it(...)` title
  or `expect(...)` argument moved.
- Confirm `hubAuthContext()`'s exported signature and `HubAuthOverrides` are unchanged, so slice
  04's three consumers still compile with no call-site edit.
- Confirm the `hubAuthContext` return literal names all SIX `HubAuthContext` members:
  `accountId`, `workspaceId`, `entitlements`, `roles`, `aud`, `claims`. It is the ONE context
  builder in the tree.
- Confirm `git grep -n 'devAuthContext'` returns NOTHING. Section 1a drops it deliberately, and an
  exported builder with no caller is what this slice refuses to leave behind.
- Confirm every `DevIdentity` literal in both rosters carries all EIGHT required fields:
  `id`, `label`, `exercises`, `accountId`, `activeOrganizationId`, `access`, `modules`,
  `organizations`.
- Confirm no added line contains an em dash or an en dash.
