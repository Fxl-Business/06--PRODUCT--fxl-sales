# Verify report - slice 01-auth-fake-package

Status: PASS

## Commands run and observed output

1. `pnpm --filter @fxl-sales/auth-fake test`
   - `Test Files  1 passed (1)`, `Tests  35 passed (35)`.

2. `pnpm --filter @fxl-sales/auth-fake type-check`
   - `tsc --noEmit` completed with no output (clean).

3. `pnpm run lint` (root)
   - `pnpm -r lint` across 5 workspace projects. `packages/auth-fake` runs its no-op
     `echo 'no lint for auth-fake'`. `apps/api lint` (`eslint src/`) and `apps/web lint`
     (`eslint src/`) both ran and reported `Done` with no errors, confirming no lint
     regressions were introduced and no apps/ file references the new package.

4. `pnpm run type-check` (root)
   - Ran `build:packages` (only `@fxl-sales/shared-types` and `@fxl-sales/shared-utils`
     built - `auth-fake` is correctly excluded from the build chain), then
     `pnpm -r type-check`. All five type-check scripts (`auth-fake`, `shared-types`,
     `shared-utils`, `apps/web`, `apps/api`) reported `Done` with no errors.

5. `pnpm run test` (root, full suite)
   - Exit code 0.
   - `packages/auth-fake test`: 1 file, 35 tests passed.
   - `packages/shared-utils test`: 3 files, 80 tests passed.
   - `apps/api test`: 50 files, 526 tests passed.
   - `apps/web test`: 72 files, 915 tests passed.
   - `scripts/__tests__/local-database-guard.test.mjs` and the tracked-file /
     legacy-env-name guard suite (`node --test`): 21/21 passed, including the
     `FAILS when ...` negative-control subtests that prove the guard oracle is not
     vacuous.
   - `build-contract: ok`.
   - No failures anywhere in the full run.

## Static checks

- `git grep -l '@fxl-sales/auth-fake' -- apps` -> no output (exit 1, no matches). Nothing
  under `apps/api` or `apps/web` references the package, static or otherwise.
- `git grep -nE 'require\(|from .node:|\bBuffer\b|process\.env' -- packages/auth-fake` ->
  no output (exit 1, no matches). No Node-only API, no `require`, no `Buffer`, no
  `process.env` anywhere in the package.
- `grep -rnP '[\x{2014}\x{2013}]' packages/auth-fake/src` -> no output. No em dash or en
  dash in any added file.
- `packages/auth-fake/package.json` has no `dependencies` key at all; only
  `devDependencies: { typescript, vitest }`. `private: true`, `type: module`,
  `main`/`types`/`exports` all point at `./src/index.ts` (source, no build step).
- `pnpm-lock.yaml` diff is minimal and exactly what is expected: one new
  `packages/auth-fake:` importer entry with its two devDependencies. No other lockfile
  churn.
- `git status`/`git diff` at the start of verification showed only
  `packages/auth-fake/` (untracked), `pnpm-lock.yaml` (modified) and
  `nexo/runs/.../budget.json` (modified, orchestration bookkeeping) plus one untracked
  execute-result JSON. No pre-existing test file was touched by this slice.
- `package.json`'s root `build` / `build:packages` scripts name only
  `@fxl-sales/shared-types` and `@fxl-sales/shared-utils`; `auth-fake` is never invoked
  by `pnpm run build`, confirmed by the `type-check` run's `build:packages` step above.

## Scrutiny beyond green tests

### Claim emission vs. the real readers

Read `apps/web/src/auth/claims.ts` and `apps/web/src/sales-ops/navigation.ts` directly:

- `getRolesFromHubClaims` has exactly 4 branches that return the literal
  `['admin','seller','finder']` (isSuperAdmin, workspace owner, workspace admin,
  productRoles has admin) and one fallback `['seller','finder'].filter(...)`, which can
  only yield `[]`, `['seller']`, `['finder']`, or `['seller','finder']`. Total producible
  role sets: 5 exactly matching the package's `covers every role set...` test set
  `{'admin|seller|finder','seller','finder','seller|finder',''}`.
- `getVisibleWorkspaces` pushes `tatico,operacional,cadastros` for `admin` and
  `meus-dados` for `seller`/`finder`. Given the role sets above (no claim shape can
  produce `['admin']` alone, confirmed structurally), the only producible painel sets
  are `[]`, `['meus-dados']`, and all four in that push order - matching the package's
  `covers every painel set...` test exactly.
- The roster's 9 fixtures reach the full-access set via three distinct claim shapes
  (`workspaceRole: 'owner'`, `workspaceRole: 'admin'`, `productRoles: ['admin']` from a
  `member`), each pinned by its own test.

**Finding, not a defect**: the package's own test suite (`roster.test.ts`) does NOT
import or execute the real `getRolesFromHubClaims`/`getVisibleWorkspaces` functions. It
compares the roster's own hand-declared `expectedRoles`/`expectedPaineis` fields against
a second hand-typed literal set. This is architecturally deliberate and explicitly
documented, not an oversight: the module docblock states `expectedRoles` is "A DECLARED
expectation, cross-checked against the real function by slice 03," and the plan
(`nexo/plans/feature-20260921-dev-fake-identity-switch/01-auth-fake-package.md`, Handoff
section) states in writing: "This package cannot import `apps/web/src/auth/claims.ts` -
a package must not reach into an app - so the cross-check is slice 03's... Slice 03 OWNS
the cross-check this package cannot perform... Without that test `expectedRoles` is an
unverified claim, so it is not optional." I independently verified by reading
`claims.ts` and `navigation.ts` that the hand-typed expectation sets in this slice do in
fact match the real functions' producible output today. The double hand-coding is a real
weakness in isolation, but it is explicitly scoped out of slice 01 and made a hard
requirement of slice 03, which is outside the boundary of this verification. Recorded
here for the record; does not count against this slice's acceptance criterion, which
speaks to "the package's own suite" only.

### entitlements.access resolution

Confirmed by reading `toHubClaims`: `access: active.products.includes(SALES_APPLICATION)`,
where `active` is resolved via `resolveActiveWorkspace`, which honors an explicit
`organizationId` override only when the identity is actually a member of that
Organization (`identity.workspaces.find(...)`), else falls back to the identity's own
`activeWorkspaceId` entry. This is NOT a fixed per-identity flag - `identity.hasAccess`
exists only as a declared/cross-checked expectation and is never read by `toHubClaims`,
`toHubAuthContext`, or `mintDevToken` to compute the emitted claim. The `no-access`
fixture (`Heitor`) proves the escape is real: switching `organizationId` to
`org_fake_norte` (a real membership) flips `entitlements.access` to `true` in the test
`mints an entitled token for an entitled Organization the identity switched to`.
Mutation probe 2 below independently confirms this is load-bearing.

### Contract version

`node_modules/.pnpm/@fxl-business+hub-sdk@2.3.0.../dist/chunk-*.js` defines
`HUB_TOKEN_CONTRACT_VERSION = 1`, and `dist/server.js` answers `401
contract_version_mismatch` for anything else, including absent. The package emits the
literal `contractVersion: 1` unconditionally for every identity, matching the SDK
requirement exactly.

### Browser safety

No `Buffer`, no `process.env`, no `node:` import, no `require(` anywhere in
`packages/auth-fake` (confirmed by grep above). Base64url encode/decode uses only
`TextEncoder`/`TextDecoder`/`btoa`/`atob`, all DOM globals available in both Node and
browser.

### No consumers yet

Confirmed: `git grep -l '@fxl-sales/auth-fake' -- apps` prints nothing.

### No existing test weakened

`git status`/`git diff` show no modification to any pre-existing test file; the only new
test file is `packages/auth-fake/src/__tests__/roster.test.ts`, which is new and part of
this slice's own deliverable.

### House rule: no em/en dash

Confirmed via grep above - none found in any added file.

## Mutation probes

### Probe 1: `contractVersion` mutated from `1` to `2`

Changed line 355 (`contractVersion: 1,` -> `contractVersion: 2,`). Re-ran
`pnpm --filter @fxl-sales/auth-fake test`:

- Result: **1 test failed** -
  `toHubClaims > announces contract version 1, which is the only version requireHubAuth accepts`
  (`expected 2 to be 1`). 34 other tests still passed.
- Reverted the file (`mv index.ts.bak index.ts`) and confirmed the file is byte-identical
  to its pre-mutation state.

### Probe 2: `entitlements.access` mutated to a fixed `true`

Changed line 357 (`access: active.products.includes(SALES_APPLICATION),` ->
`access: true,`). Re-ran `pnpm --filter @fxl-sales/auth-fake test`:

- Result: **2 tests failed** -
  `toHubClaims > carries Effective Access explicitly and never derives it from modules`
  (expected `{access: false, modules: []}` for the `no-access` identity, got
  `{access: true, modules: []}`), and
  `the active Organization override > pins hasAccess as a declared expectation against what toHubClaims computes`
  (expected `false`, got `true`). 33 other tests still passed.
- Reverted the file, diffed against a saved copy of the original
  (`diff packages/auth-fake/src/index.ts /tmp/index.ts.orig`) and confirmed byte-for-byte
  identical.

Both mutation probes went red as required. Neither probe survived.

## Post-probe confirmation

- Re-ran `pnpm --filter @fxl-sales/auth-fake test` after both reverts: `35 passed (35)`.
- Final `git status --porcelain` shows only the pre-existing modifications
  (`nexo/.../budget.json`, `pnpm-lock.yaml`) and untracked
  (`nexo/.../agents/execute-01-auth-fake-package.result.json`, `packages/auth-fake/`)
  that were present before this verification began. No stray `.bak` files, no staged
  changes, no stash entries.

## Verdict

PASS. All five required commands are green with the exact numbers claimed by the
execute agent (auth-fake 35/35, apps/api 526, apps/web 915). Both required mutation
probes went red for the correct reason and were cleanly reverted. Static checks (no
apps/ consumer, no Node-only API, no em/en dash, `devDependencies`-only, no `dist`/build
wiring) all hold. The one weakness found - the roster's `expectedRoles`/`expectedPaineis`
being hand-declared rather than checked against the real `apps/web` functions inside
this slice's own suite - is explicitly and correctly scoped to slice 03 by the approved
plan, not a gap in this slice's acceptance criterion.
