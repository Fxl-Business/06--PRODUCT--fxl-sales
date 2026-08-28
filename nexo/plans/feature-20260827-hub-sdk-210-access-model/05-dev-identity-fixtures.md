---
id: 05-dev-identity-fixtures
milestone: v2.8.0
status: todo
depends_on: [04-sdk-210-flip]
files_modified: [package.json, scripts/dev-only-testing-package.mjs, apps/api/package.json, apps/web/package.json, pnpm-lock.yaml, apps/api/src/auth/__tests__/dev-roster.ts, apps/api/src/auth/__tests__/dev-roster.test.ts, apps/api/src/middleware/__tests__/app-auth.test.ts, apps/api/src/domains/sales-ops/__tests__/routes.test.ts, apps/api/src/domains/sales-ops/__tests__/history-route.test.ts, apps/web/src/auth/__tests__/dev-roster.ts, apps/web/src/auth/__tests__/claims-hub-contract.test.ts]
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

Four test fixtures in `apps/api` hand-roll a Hub claims literal. They are the only places in this
repository that assert a claim shape, and they are hand-written, so they can drift from the real
contract without a single test going red. This slice replaces the CONSTRUCTION of those fixtures
with `devHubClaims(...)` from `@fxl-business/hub-sdk-testing@2.1.0`, which emits a real
`HubTokenClaims`. It adds one web-side test that runs the same Hub-shaped claim set through
`getRolesFromHubClaims`. It adds a tracked-file guard that fails the suite if the package ever
appears outside `devDependencies` or is ever imported outside a test directory. It adds nothing
else. No assertion and no test title is changed anywhere.

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

Export a single `const devRoster: DevIdentityRoster`. Its literals are chosen so that every
existing assertion in every file this slice touches keeps its current expected value. Do not
invent new ids.

```
audience: 'app.fxl-sales'
identities, in this order:
  1. id 'member'
     label 'Ordinary member', exercises 'the missing_role deny branch'
     accountId 'hub-account-1'
     activeOrganizationId 'org_existing_1'
     access true, modules []
     organizations: [{ workspaceId: 'org_existing_1', name: 'Org Existing', role: 'member', products: ['fxl-sales'] }]
  2. id 'owner'
     accountId 'hub-account-1', activeOrganizationId 'org_existing_1'
     access true, modules []
     organizations: [{ workspaceId: 'org_existing_1', name: 'Org Existing', role: 'owner', products: ['fxl-sales'] }]
  3. id 'super-admin'
     accountId 'hub-account-1', activeOrganizationId 'org_existing_1'
     access true, modules [], isSuperAdmin true
     organizations: [{ workspaceId: 'org_existing_1', name: 'Org Existing', role: 'member', products: ['fxl-sales'] }]
  4. id 'product-admin'
     accountId 'hub-account-1', activeOrganizationId 'org_existing_1'
     access true, modules [], productRoles ['admin']
     organizations: [{ workspaceId: 'org_existing_1', name: 'Org Existing', role: 'member', products: ['fxl-sales'] }]
  5. id 'product-seller-finder'
     accountId 'hub-account-1', activeOrganizationId 'org_existing_1'
     access true, modules [], productRoles ['seller', 'finder']
     organizations: [{ workspaceId: 'org_existing_1', name: 'Org Existing', role: 'member', products: ['fxl-sales'] }]
  6. id 'no-access'
     label 'Organization whose Effective Access is false', exercises 'the access deny branch'
     accountId 'hub-account-2', activeOrganizationId 'org_no_access'
     access false, modules []
     organizations: [{ workspaceId: 'org_no_access', name: 'Org Without Access', role: 'member', products: [] }]
  7. id 'sales-ops'
     accountId 'verified-account', activeOrganizationId 'verified-org'
     access true, modules []
     organizations: [{ workspaceId: 'verified-org', name: 'Verified Org', role: 'admin', products: ['fxl-sales'] }]
```

Rules `assertDevRoster` enforces that these literals already satisfy, stated so the executor does
not have to rediscover them by trial:

- `audience` must match `/^app\.[a-z0-9][a-z0-9-]*$/`.
- identity `id` values must be unique. `accountId` values need NOT be unique, which is why
  identities 1 to 5 share `hub-account-1`.
- `activeOrganizationId` must name an entry in that identity's own `organizations`.
- `modules` MUST be empty when `access` is false. Identity 6 obeys this. `devHubClaims` also
  forces `modules` to `[]` at mint time whenever `access` is false.
- `workspaceId` must be unique within one identity only, not across identities, which is why
  identities 1 to 5 all use `org_existing_1`.

Also export a helper so the three consumer files construct their fixture identically:

```ts
export function devAuthContext(identityId: string, nowSeconds = 1_700_000_000) {
  const identity = findDevIdentity(devRoster, identityId);
  if (!identity) throw new Error(`unknown dev identity ${identityId}`);
  const claims = devHubClaims(devRoster, identity, { nowSeconds });
  return { accountId: claims.sub, workspaceId: claims.workspaceId, claims };
}
```

`nowSeconds` is pinned so `iat`, `exp` and the deterministic `jti` are stable across runs. Pass no
`ttlSeconds`; the default 900 is fine and nothing asserts on it.

Note on assignability, so the executor does not fight the compiler: `MinimalHubAuthContext` is a
structural SUBSET of what `devAuthContext` returns. TypeScript's excess property check applies
only to fresh object literals, and this value is not fresh at the call site, so the return value is
assignable to `MinimalHubAuthContext` as is. If it is NOT assignable after slices 03 and 04, that
is a real finding: this repo's hand-written claim type has drifted from `HubTokenClaims`. Report
it, do not widen the fixture to paper over it.

### 1b. `apps/api/src/auth/__tests__/dev-roster.test.ts` (new)

Four tests. Exact titles in the oracle section below.

### 1c. `apps/web/src/auth/__tests__/dev-roster.ts` (new, not a test file)

A separate, smaller roster. It is NOT shared with the API roster: a cross-app import would couple
two independently versioned workspaces through a test file, and the two rosters exercise different
things. Web needs role variety only; it has no access gate.

```
audience: 'app.fxl-sales'
identities:
  1. id 'workspace-owner'  accountId 'acct_web_1' activeOrganizationId 'org_web_1'
     access true, modules []
     organizations: [{ workspaceId: 'org_web_1', name: 'Org Web', role: 'owner', products: ['fxl-sales'] }]
  2. id 'plain-member'     accountId 'acct_web_2' activeOrganizationId 'org_web_2'
     access true, modules []
     organizations: [{ workspaceId: 'org_web_2', name: 'Org Web Two', role: 'member', products: ['fxl-sales'] }]
  3. id 'super-admin'      accountId 'acct_web_3' activeOrganizationId 'org_web_3'
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

## Step 2 - GREEN. Install, then swap the three consumer fixtures.

Install as specified above, then make these three edits. In all three the rule is the same and it
is absolute: ONLY the fixture construction moves. No `it(...)` title, no `expect` argument and no
control flow changes. Every literal in the roster was chosen to make that possible.

### 2a. `apps/api/src/middleware/__tests__/app-auth.test.ts`

Slices 03 and 04 have already rewritten this file. Apply the swap to WHATEVER STATE THEY LEFT. Do
not restore a test they deleted and do not re-add `sales.core` anywhere.

- The `baseHubAuth` literal at the top becomes `const baseHubAuth: MinimalHubAuthContext = devAuthContext('member');`
- Each test that currently builds a variant by spreading over `baseHubAuth.claims` switches to the
  roster identity that already encodes that variant, with the same expected value:

  | current variant built by spread | becomes |
  |---|---|
  | `claims.isSuperAdmin = true` | `devAuthContext('super-admin')` |
  | `claims.roles = { workspace: 'owner' }` | `devAuthContext('owner')` |
  | `claims.roles = { workspace: 'member', productRoles: ['admin'] }` | `devAuthContext('product-admin')` |
  | `claims.roles = { workspace: 'member', productRoles: ['seller', 'finder'] }` | `devAuthContext('product-seller-finder')` |
  | an entitlements variant that denies access, if slice 03 left one | `devAuthContext('no-access')` |

  All of these keep `userId: 'hub-account-1'` and `orgId: 'org_existing_1'`, which is why the
  `toEqual` and `toMatchObject` assertions do not move.
- If slice 03 left a test whose denial variant is NOT expressible from the roster, LEAVE THAT TEST
  ALONE and note it in the run log. A weakened test is a worse outcome than an unswapped one.
- ADD one new test, T5 below, whose only job is to fail if someone reverts the fixture to a
  hand-rolled literal.

### 2b. `apps/api/src/domains/sales-ops/__tests__/routes.test.ts`

Current shape at approximately `:81-93`: a mutable `currentHubClaims` holding `{ name?, email? }`,
spread over a hard-coded claims literal inside `hubAuthContext()`.

Keep `currentHubClaims` and every assignment to it (`:217`, `:315`, `:336`) EXACTLY as they are.
It is the seam three tests use to exercise the display-name branches, and replacing it with roster
identities that differ only by a `profile` would be pure churn. Change only the base:

```ts
const baseHubClaims = devAuthContext('sales-ops');

function hubAuthContext() {
  return {
    ...baseHubClaims,
    claims: { ...baseHubClaims.claims, ...currentHubClaims },
  };
}
```

The `sales-ops` identity was given `accountId: 'verified-account'` and
`workspaceId: 'verified-org'` precisely so that `baseHubClaims.accountId` and
`baseHubClaims.workspaceId` equal the values the surrounding `c.set('userId', ...)` and
`c.set('orgId', ...)` calls already use. Nothing else in the file changes.

### 2c. `apps/api/src/domains/sales-ops/__tests__/history-route.test.ts`

Identical treatment at approximately `:49-57`. `currentHubClaims` and its two assignments (`:78`,
`:163`) stay. `c.set('hubAuth', { ... })` becomes
`c.set('hubAuth', { ...baseHubClaims, claims: { ...baseHubClaims.claims, ...currentHubClaims } })`
with the same `const baseHubClaims = devAuthContext('sales-ops');` at module scope.

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
3. Swap the three consumer fixtures (2a, 2b, 2c). Run `pnpm test`, `pnpm lint`, `pnpm type-check`.
   All green, with no assertion or title edited.
4. Add `scripts/dev-only-testing-package.mjs` and wire it into the root `test` script. Run it
   directly once and confirm the self-check line prints and passes.
5. Run a real `pnpm build`. It must not pull the testing package into the web bundle; nothing
   reachable from `apps/web/src/main.tsx` imports it.

## Commits, atomic and conventional

1. `test(auth): add Hub-shaped dev identity rosters and contract oracles`
2. `chore(deps): add @fxl-business/hub-sdk-testing@2.1.0 as a devDependency`
3. `test(auth): build the Hub claim fixtures from the Hub testing package`
4. `build(guard): fail the suite if hub-sdk-testing leaves devDependencies`

## The exact NAMED oracle tests

`apps/api/src/auth/__tests__/dev-roster.test.ts`

- **T1** `covers every deny branch the Hub contract requires a fixture roster to reach`
  `expect(missingDevDenyBranches(devRoster)).toEqual([])`.
  This is the one test this repository could not write before this slice. It is not a vendor test:
  it asserts that THIS repo's fixture set reaches `access`, `no_org_access`, `missing_role` and
  `super_admin`, and it goes red on a future upgrade that adds a branch this repo does not cover.
- **T2** `is a roster the Hub testing package accepts, so a malformed fixture cannot reach a test`
  `expect(() => assertDevRoster(devRoster)).not.toThrow()`.
- **T3** `forces modules empty when Effective Access is false, which is the only shape the Hub mints`
  `expect(devHubClaims(devRoster, noAccessIdentity, { nowSeconds: 1_700_000_000 }).entitlements).toEqual({ access: false, modules: [] })`.
- **T4** `mints for this application's own Audience, so a fixture cannot pass under another app id`
  `expect(devHubClaims(devRoster, memberIdentity, { nowSeconds: 1_700_000_000 }).aud).toBe('app.fxl-sales')`.

`apps/api/src/middleware/__tests__/app-auth.test.ts` (one test ADDED, none renamed)

- **T5** `builds its auth context fixture from Hub-shaped claims rather than a hand-rolled literal`
  `expect(baseHubAuth.claims).toMatchObject({ typ: 'at+jwt', contractVersion: 1, iss: 'https://hub.invalid' })`.
  Goes red the moment anyone reverts the fixture to a literal.

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

- Confirm `git grep -n 'hub-sdk-testing'` returns hits ONLY in the two rosters, the two new test
  files, the guard script and the `devDependencies` block of the two app manifests.
- Confirm `git grep -n 'createDevHubClient\|mintDevToken\|isDevToken\|readDevTokenSubject'` returns
  nothing. If any of those appear, a runtime identity path was introduced and the slice fails.
- Diff `apps/api/src/middleware/__tests__/app-auth.test.ts`,
  `routes.test.ts` and `history-route.test.ts` against their pre-slice state and confirm that no
  line inside an `it(...)` title or an `expect(...)` argument changed, other than the single added
  test T5.
- Confirm no added line contains an em dash or an en dash.
