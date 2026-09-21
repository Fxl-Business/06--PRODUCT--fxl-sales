# Plan check - feature-20260921-dev-fake-identity-switch

VERDICT: NEEDS-REVISION

The set was NOT coherent as planned.
Seven planners running in parallel produced four flag spellings, two web seam paths, two production-refusal
constant names, two token-minter names, an incompatible minter signature, a make target pointing at a pnpm
script that does not exist, two slices claiming one `.env` example, and one oracle that promised an assertion
the production code makes impossible.
Two of those would have shipped a live defect rather than a merge annoyance, and both are named under
REQUIRED EDITS 8 and 9.

Every required edit below has been APPLIED to the slice plan files.
The verdict stays NEEDS-REVISION because the set needed revision, not because anything is left outstanding.
The `status` written to `plan-check.result.json` is `PASS`, which per the brief means the set is coherent
after these edits, and it is.

Files I changed, all inside `nexo/plans/feature-20260921-dev-fake-identity-switch/`:
`01-auth-fake-package.md`, `02-api-dev-adapter.md`, `03-web-dev-identity.md`, `04-dev-seed.md`,
`05-isolation-guard.md`, `06-make-targets.md`, `07-docs-reconciliation.md`.
Every edit is an in-place insertion or replacement marked `PLAN-CHECK`, and no plan was rewritten.
`00-OVERVIEW.md` and `AUDIT.md` were not touched.

---

## The canonical table

Everything below is now spelled this way in every plan that names it.

### Environment variables

| Half | Canonical name | Why, against this repo's own naming law |
| --- | --- | --- |
| API (Node process env) | `SALES_AUTH_FAKE` | `FXL_HUB_` means "the SDK resolves and validates this", so it is unavailable. Every repo-owned Node variable in the tree carries `SALES_`: `SALES_ENV_FILE`, `SALES_POST_LOGIN_REDIRECT`, `SALES_POST_LOGIN_ERROR_REDIRECT`, `SALES_SESSION_ENCRYPTION_IKM`. A bare `AUTH_FAKE` would be the only unprefixed repo-owned name in the tree and is the spelling an operator is most likely to have left exported in a shell from the reference project, which is exactly the leak that would turn fake auth on by accident. |
| Web (Vite env) | `VITE_AUTH_FAKE` | There is no `VITE_SALES_` variable anywhere in this repository. The web half's repo-owned names are `VITE_API_URL`, `VITE_AUTH_PROXY_TARGET` and `VITE_AUTH_BFF_BASE_PATH`, and the only namespaced ones are the `VITE_FXL_HUB_` mirrors of the SDK's own. `VITE_AUTH_FAKE` joins the existing `VITE_AUTH_*` family; `VITE_SALES_AUTH_FAKE` would invent a second naming scheme inside one file. The shell-leak argument that carries the API half does not carry here: Vite reads its env from the app's own `.env` plus the command line. |

Slice 02 declared `VITE_SALES_AUTH_FAKE` normative; slices 03 and 06 landed `VITE_AUTH_FAKE`; slice 07 predicted
a bare `AUTH_FAKE` for the API half.
The tie is broken on the evidence above, not by averaging: `SALES_AUTH_FAKE` + `VITE_AUTH_FAKE`.
Neither side widens to accept both spellings.

Truthy set, identical in both halves: `1`, `true`, `yes`, `on`, compared after `.trim().toLowerCase()`.
Absent, blank, `0`, `false` and anything else are OFF.

### Paths

| Thing | Canonical path |
| --- | --- |
| The roster package | `packages/auth-fake`, specifier `@fxl-sales/auth-fake` |
| The bundle sentinel's home | `packages/auth-fake/src/index.ts` |
| The API seam | `apps/api/src/auth/select.ts` |
| The API adapter slot | `apps/api/src/middleware/app-auth.ts` |
| The web seam (the ONE file in `apps/web` that may name the package) | `apps/web/src/dev/install-dev-identity.ts` |
| The web registry slot | `apps/web/src/dev/dev-identity-registry.ts` |
| The web switcher | `apps/web/src/dev/dev-identity-switcher.ts` |
| The seed writer | `apps/api/scripts/seed-dev.ts` |
| The pure seed plan | `apps/api/scripts/seed/plan.ts` |
| The isolation guard | `scripts/__tests__/auth-fake-isolation.test.mjs` |
| The bundle check | `scripts/assert-web-bundle-clean.mjs` |
| The docs guard | `scripts/__tests__/dev-identity-docs-reconciliation.test.mjs` |

### Symbols

| Symbol | Declared in | Canonical signature or literal |
| --- | --- | --- |
| `DEV_IDENTITY_ADAPTER_IN_PRODUCTION_MESSAGE` | `apps/api/src/middleware/app-auth.ts` | exported const, thrown by BOTH `installAppAuthAdapter` and `installFakeAuthIfRequested` |
| `DEV_IDENTITY_ENABLED` | `apps/web/src/dev/install-dev-identity.ts` | `const DEV_IDENTITY_ENABLED = import.meta.env.DEV;`, module scope, FIRST `import.meta.env.DEV` in the file |
| `FAKE_IDENTITY_HEADER` | `apps/api/src/auth/select.ts` | `'x-fake-identity'` |
| `FXL_SALES_DEV_FAKE_ROSTER_SENTINEL` | `packages/auth-fake/src/index.ts` | exported const whose value is its own name |
| `mintDevToken` | the package | `(identity, options?: { nowSeconds?: number; organizationId?: string }) => string` |
| `toHubClaims` | the package | `(identity, options?: FakeClaimOptions) => Record<string, unknown>` |
| `toHubAuthContext` | the package | `(identity, options?: FakeClaimOptions) => FakeHubAuthContext` |
| `readTokenSubject` | the package | `(token) => string \| null` |
| `readTokenWorkspaceId` | the package | `(token) => string \| null` - NEW, see edit 8 |
| `identityHasWorkspace` | the package | `(identity, workspaceId) => boolean` - NEW, see edit 8 |
| `findIdentity`, `findIdentityByAccountId`, `IDENTITIES`, `DEFAULT_IDENTITY_ID`, `allFakeOrgIds` | the package | unchanged from slice 01 |
| `installFakeAuthIfRequested`, `isFakeAuthRequested`, `isProductionEnv` | `apps/api/src/auth/select.ts` | unchanged from slice 02 |
| `isDevIdentityEnabled`, `readDevIdentityId`, `switchDevIdentity`, `installDevIdentityIfEnabled` | the web seam | unchanged from slice 03 |

### Operator surface

| Thing | Canonical |
| --- | --- |
| pnpm script | `db:seed:dev` in `apps/api/package.json` |
| make targets | `dev-fake`, `back-fake`, `front-fake`, `db-seed`, `dev-fake-setup` |
| localStorage keys | `fxl-sales.dev-identity`, `fxl-sales.dev-identity.collapsed` |
| fake org ids | `org_fake_norte`, `org_fake_sul`, `org_fake_sem_acesso`, all prefixed `org_fake_` |

---

## REQUIRED EDITS

All eleven are APPLIED.
Each says what changed, where, and the replacement text where it is short enough to quote.

### 1. Flag name, web half - `02-api-dev-adapter.md`

The paragraph beginning `**The enable flag is \`SALES_AUTH_FAKE\`.**` named the web half
`VITE_SALES_AUTH_FAKE` and declared itself normative.
REPLACED with `VITE_AUTH_FAKE` plus a `PLAN-CHECK RULING` paragraph carrying the justification in the
canonical table above, and the note that the `SALES_` argument keeps full force on the API half and does not
transfer to Vite env.
Two downstream mentions in the same file (`## Out of scope`) were swept to `VITE_AUTH_FAKE`.

### 2. Flag name, API half - `07-docs-reconciliation.md`

Every occurrence of the bare `AUTH_FAKE` meaning the API flag became `SALES_AUTH_FAKE`: the `## Development
identity mode` bullet, the ONE-gate qualification line, the "NEW name" note, the Step 1 grep, the Step 1
predicted-names sentence, the `Required API vars` block and the verifier note.
Step 1's list is also relabelled from "predicted names" to "the CANONICAL names, fixed by the plan-check pass
of 2026-09-21 and no longer predictions", because leaving it as a prediction invites a seventh spelling.

### 3. The `CLAUDE.md` env-block shape - `07-docs-reconciliation.md`

Slice 07 wrote an ACTIVE blank line `AUTH_FAKE=` into the `Required API vars` fence and `VITE_AUTH_FAKE=` into
the web fence.
Slice 06 reasons at length that an active blank line is worse than a commented one even when blank, because
the next person to edit the file sees a slot and fills it, and it ships the commented shape into all four
`.env` examples with an oracle reading its exact text.
`CLAUDE.md`'s block is copyable prose that a human copies wholesale into those same files, so the two must
carry one shape.
REPLACED with, in `Required API vars`:

```dotenv
# Development identity mode. COMMENTED here and commented in every .env example:
# absent means the ordinary Hub path, which is what a copied block must
# reproduce. Set it through `make dev-fake` rather than by hand. The API refuses
# to boot with it set while NODE_ENV=production.
# SALES_AUTH_FAKE=1
```

and in `Required web vars`:

```dotenv
# Development identity mode. COMMENTED, for the same reason. The whole web half
# is behind import.meta.env.DEV, so a production build eliminates it.
# VITE_AUTH_FAKE=1
```

### 4. Web seam path - `05-isolation-guard.md`

Slice 05 hard-coded `apps/web/src/dev/dev-identity.ts`; slice 03 ships
`apps/web/src/dev/install-dev-identity.ts`.
Slice 03's path wins: it owns the web half, and its three-file split is load-bearing, because the registry
`auth/react.tsx` reads must NOT name the package and the switcher is loaded from the installer.
REPLACED at four sites in slice 05: acceptance 4, acceptance 6, "The names this guard pins", and test 1's
mutation.
A rule was added to slice 03 naming the same path as canonical, so the two cannot drift back apart.

### 5. Production-refusal constant - `05-isolation-guard.md`

Slice 05 expected `DEV_FAKE_AUTH_IN_PRODUCTION_MESSAGE`; slice 02 exports
`DEV_IDENTITY_ADAPTER_IN_PRODUCTION_MESSAGE` from `apps/api/src/middleware/app-auth.ts`.
Slice 02's name wins, because it is the constant BOTH refusals share and sharing it is what stops the two
saying different things about one rule.
Acceptance 5, the "names this guard pins" bullet, test 2's signature symbol and test 7 were all rewritten.

### 6. Slice 05's test 7 regexes would have gone RED on the shipped code - `05-isolation-guard.md`

Two separate defects in one test, both fixed.
Slice 05 asserted the stripped `select.ts` source matches `nodeEnv === 'production'`.
Slice 02's `isProductionEnv` really reads `(env.NODE_ENV ?? '').trim().toLowerCase() === 'production'`, so
that regex never matches and the guard is red from its first run.
Slice 05 also asserted `throw new Error(DEV_FAKE_AUTH_IN_PRODUCTION_MESSAGE)` with nothing between the
parentheses, while slice 02 reaches the constant through its dynamic-import binding as
`appAuth.DEV_IDENTITY_ADAPTER_IN_PRODUCTION_MESSAGE`.
REPLACED with the two regexes `/'production'/` and
`` /throw new Error\([^)]*DEV_IDENTITY_ADAPTER_IN_PRODUCTION_MESSAGE[^)]*\)/ ``, the second deliberately loose
about the binding name so a rename that changes nothing does not turn the guard red.
A matching `PLAN-CHECK CONSTRAINT` paragraph was added to slice 02 telling its executor that `select.ts` must
KEEP both the literal `'production'` and a `throw new Error(...)` naming the constant in its own source,
because hoisting the message into a local alias disarms slice 05's test rather than restyling it.

### 7. `DEV_IDENTITY_ENABLED` did not exist - `03-web-dev-identity.md`

Slice 05 asserts the web seam declares `const DEV_IDENTITY_ENABLED = import.meta.env.DEV;` and opens with
`if (!DEV_IDENTITY_ENABLED) return`.
Slice 03 read `import.meta.env.DEV` inside `isDevIdentityEnabled()` and declared no such constant, so slice
05's test 8 was red on arrival and its ORDERING assertion, the one that actually carries weight, had nothing
to index against.
REPLACED slice 03's section 3.1 code block with:

```
const DEV_IDENTITY_ENABLED = import.meta.env.DEV;

export function isDevIdentityEnabled(): boolean {
  if (!DEV_IDENTITY_ENABLED) return false;
  const flag = import.meta.env.VITE_AUTH_FAKE;
  return typeof flag === 'string' && TRUTHY.has(flag.trim().toLowerCase());
}
```

plus the requirement that this is the FIRST `import.meta.env.DEV` occurrence in the file, strictly above the
dynamic import of the package, and that `installDevIdentityIfEnabled()` opens with
`if (!DEV_IDENTITY_ENABLED) return null;` before consulting the runtime flag.
Step 1 of that function's numbered list was updated to match.

### 8. THE ACTIVE ORGANIZATION WAS NEVER RESOLVED - `01`, `02`, `03`

This is the first of the two live defects and it is the more serious.

Slice 03 has the stand-in `setActive(organizationId)` mint a token for the same identity with a different
active Organization, which is how `MissingEntitlementPanel`'s switch escape and the account dropdown work.
Slice 02's middleware resolved the identity from the bearer's `sub` and then took `orgId` from
`identity.activeWorkspaceId`, ignoring the token's `workspaceId` entirely.
Slice 01's `mintDevToken(identity, nowSeconds)` could not express an override at all, and its
`entitlements.access` came from `identity.hasAccess`, a per-IDENTITY flag.

Three consequences, all bad:
the browser would show Organization SUL while the API served NORTE's rows, which is a tenancy divergence;
the `no-access` fixture's switch to an entitled Organization would still mint `access: false`, so the panel's
primary escape answers `402` forever, which is the exact dead end `MissingEntitlementPanel` exists to remove;
and acceptance 3's sixth identity would therefore be untestable end to end.

Fixed in three places.

`01-auth-fake-package.md`:
- `toHubClaims`, `toHubAuthContext` and `mintDevToken` now take one shared
  `FakeClaimOptions { nowSeconds?: number; organizationId?: string }`.
- `toHubClaims` resolves `active` ONCE at the top and builds the whole claim set off it, falling back to
  `identity.activeWorkspaceId` when the requested Organization is not a member.
- `entitlements.access` is read as `active.products.includes(SALES_APPLICATION)`, which is the honest wire
  shape slice 01 already wrote for its three Organizations, so there is still exactly one source of truth and
  it is still not derived from `modules`.
- `FakeIdentity.hasAccess` survives as a DECLARED expectation, pinned equal to what `toHubClaims` computes.
- Two new exports, `readTokenWorkspaceId` and `identityHasWorkspace`.
- A new `describe('the active Organization override')` with five named tests, including
  `mints an entitled token for an entitled Organization the identity switched to` and
  `ignores an Organization the identity does not belong to, rather than honouring it`.

`02-api-dev-adapter.md`:
- `FakeIdentityModule` gains `readTokenWorkspaceId`, `identityHasWorkspace`, and the options parameter on
  `toHubAuthContext`.
- A `PLAN-CHECK ADDITION` section resolving the active Organization from the presented token's `workspaceId`,
  with a membership check against the roster and
  `401 {"error":"unauthorized","code":"unknown_fake_workspace"}` for anything unlisted, never a silent
  fallback to the identity's own Organization.
- Two new oracle tests:
  `serves the Organization the token names, not the identity's default, so a switch really switches`, and
  `answers 401 unknown_fake_workspace for a token naming an Organization the identity does not belong to`.

`03-web-dev-identity.md`: the `mintDevToken` signature in its section 4 contract now matches slice 01's.

Note this also STRENGTHENS acceptance 10 rather than weakening it: the org is read off the presented token
and checked against the roster, never off a request body or a query string, and an unlisted value is refused.

### 9. Slice 03's oracle promised an unreachable assertion - `03-web-dev-identity.md`

This is the second live defect.
Oracle 10.1 test 1 parametrized over an `admin-only` identity and asserted `three team workspaces and no
meus-dados`.
I verified the `AUDIT.md` claim directly rather than trusting it.
`apps/web/src/auth/claims.ts` has exactly two returns; `fullAccessRoles` is the literal
`['admin', 'seller', 'finder']` and is returned by the `isSuperAdmin`, workspace-`owner`, workspace-`admin`
and `productRoles.has('admin')` branches alike, and the only other return is
`productRoleOrder.filter(...)` over `['seller', 'finder']`.
`apps/web/src/sales-ops/navigation.ts:116` then adds `meus-dados` whenever `seller` or `finder` is present.
So `['admin']` alone is unproducible and the painel set `['tatico','operacional','cadastros']` is unreachable.
The audit is correct.

REPLACED that test with a parametrization over the five REACHABLE role sets by slice 01's roster ids, plus one
new named assertion, `no roster identity reaches the team painéis without meus-dados`, which records the
unreachability THROUGH the real translation rather than merely on the roster object.

Consistency across the three slices that touch this, checked one by one:
- `01` F3 was already correct and already refuses to fake it. No edit needed.
- `03` promised the unreachable identity. FIXED here.
- `07` was already correct in substance. One phrase corrected, see edit 11.
No plan now promises the unreachable identity.

### 10. `make db-seed` pointed at a script nobody writes - `06-make-targets.md` and `04-dev-seed.md`

Slice 06's target ran `pnpm --filter @fxl-sales/api db:seed`; slice 04 names the script `db:seed:dev`
deliberately, so that a script sitting beside `db:migrate` is not one tab completion from being run somewhere
it should not be.
Slice 04's own Makefile sketch called the target `dev-fake-seed`.
Split by ownership: slice 06 owns the Makefile so the TARGET name `db-seed` wins; slice 04 owns
`apps/api/package.json` so the SCRIPT name `db:seed:dev` wins.
Both files were edited, including slice 06's `grep -n '"db:seed:dev"'` soft-dependency check and slice 04's
recorded sketch.

### 11. Shared-file ownership, stated in both files of each pair

Four pairs, none of which is a textual merge conflict and all of which are silent-revert risks.

**`CLAUDE.md`, claimed by `04` (wave 3) and `07` (wave 4).**
Split, now written into both files:
slice 04 owns exactly two lines inside `## Local database guard`, the bullet naming the guarded entrypoints
(two becomes three, naming `apps/api/scripts/seed-dev.ts`) and the sentence carrying the two MEASURED
`# pass` counts.
Slice 07 owns the new `## Development identity mode` section, the three lines appended to the ONE-gate bullet
in `## Auth Model`, and the two fenced `dotenv` blocks in `## Environments`.
Slice 07 runs later, so slice 07 is the one that must VERIFY both of slice 04's edits are still present before
it commits; that is now in its `must_not_break`.

**`apps/web/.env.dev.example`, claimed by `03` and `06`.**
Resolved by REMOVING it from slice 03 entirely, files_modified and body and executor checklist.
Slice 06 owns all four committed examples, documents both flags in full, and has the oracle that reads their
exact text; slice 03 would have written a shorter competing block into one of them.

**`apps/api/package.json`, claimed by `02` and `04`.**
Slice 02 owns the `devDependencies` line.
Slice 04 owns `db:seed:dev`, `type-check` and `lint`, and its instruction to add the devDependency "if slice
02 has not" was replaced with an instruction NOT to touch that block, plus a cheap `grep` verification.

**root `package.json`, claimed by `05` and `07`.**
Slice 05 owns the `build` script's `&& node scripts/assert-web-bundle-clean.mjs` tail and appends
`auth-fake-isolation.test.mjs` to the `test` list; slice 07 appends its own path AFTER slice 05's.
Slice 07's `must_not_break` now names slice 05's build tail explicitly, which it did not before.

### 12. Missing `files_modified` entries

- `02-api-dev-adapter.md` adds a devDependency and did not declare `pnpm-lock.yaml`. ADDED.
- `03-web-dev-identity.md` adds a devDependency and did not declare `pnpm-lock.yaml`. ADDED.
- `03-web-dev-identity.md` names `apps/web/vite.config.ts` in its section 4 as a conditional
  `optimizeDeps.include` edit but did not declare it. ADDED, since nothing else in wave 2 or 3 touches it.
- `01` already declared `pnpm-lock.yaml`. `04` correctly declares `apps/api/tsconfig.scripts.json` and
  `apps/api/vitest.config.ts`. `05`, `06` and `07` are complete.

### 13. Two smaller drifts swept

- `02-api-dev-adapter.md` said `mintFakeToken` twice; slices 01 and 03 say `mintDevToken`. Swept.
- `02-api-dev-adapter.md`'s `## Out of scope` said "The tracked-file isolation guard is slice 07's".
  It is slice 05's. Fixed.

### 14. The `CLAUDE.md` contradiction the audit required recording - `07-docs-reconciliation.md`

`AUDIT.md` states that slice 07 must record the `CLAUDE.md` contradiction in the same pass that revises the
file.
Slice 07 recorded the superseded ACCEPTANCE CRITERION but said nothing about the false sentence already in
`CLAUDE.md`: `## Sales Ops Routing` asserts that "team-only sees the three team workspaces and no
`meus-dados`", which no token this product accepts can produce.
ADDED a bullet to slice 07's `## Development identity mode` block recording it, naming `getVisibleWorkspaces`
as correct and the role set as unreachable, stating that the product question is whether an owner who is
neither vendedor nor finder should see `meus-dados`, and saying the sentence is left standing with a note
beside it rather than edited, because editing it would pick the answer by accident.
Slice 07's roadmap entry 1 now carries the same fact, so whichever way the human decides, one of the two files
changes.

---

## Verification I did myself rather than taking on trust

- `apps/web/src/auth/claims.ts` and `apps/web/src/sales-ops/navigation.ts:116-126`, read directly.
  The `['admin']`-alone unreachability is CONFIRMED. See edit 9.
- `apps/api/src/db/schema.ts`: there is NO `orgs` table among the 31 `pgTable` declarations, and
  `salesOpsSettings` (line 760) declares `orgId: text('org_id').primaryKey()`.
  Slice 04's claim that `sales_ops_settings` is the de-facto org registry STANDS, and its one-settings-row-per-org
  rule is the right shape.
  `sales_ops_people.hubAccountId` (line 462) and the partial unique index
  `sales_ops_people_org_hub_account_idx` (lines 492-494) exist exactly as slice 04 describes, so the
  identity-bound pessoa rule is implementable as written.
- `apps/api/tsconfig.json`: `rootDir: "./src"`, `include: ["src/**/*"]`.
  Slice 04's need for `tsconfig.scripts.json` is REAL: `apps/api/scripts/` is genuinely uncovered and would be
  untyped otherwise.
- `apps/api/vitest.config.ts`: the non-integration branch is
  `include: ['src/**/__tests__/**/*.test.ts']`.
  Slice 04's need to widen it is REAL: a test under `scripts/__tests__/` would never run.
- root `package.json`: slice 05 quotes the existing `test` and `build` scripts correctly, so its two
  append-only edits apply cleanly.
- `apps/web/.env.dev.example`, `apps/web/.env.example`, `apps/web/.env.staging.example`,
  `apps/api/.env.example`, `apps/api/.env.dev.example` and `apps/api/.env.staging.example` all exist, so slice
  06's six-file describe has six files to read.
- `nexo/plans/feature-20260827-hub-sdk-210-access-model/05-dev-identity-fixtures.md` exists, so slice 07's
  supersession has a target.

---

## Acceptance to slice to oracle

| # | Criterion, in short | Slice that discharges it | Named oracle |
| --- | --- | --- | --- |
| 1 | `make dev-fake` boots both halves with no Hub and reaches a sales-ops screen with data | 06 (targets), 02 (API), 03 (web), 04 (data) | NONE automated, by explicit decision. Slice 06 states it belongs to the integrated wave and cannot pass before 02, 03 and 04 are all in the tree. Nearest automated proxies: `dev-identity-no-hub.test.ts` (`does not contact any Hub`) and `dev-identity-roles.test.tsx` test 3. See OBSERVATION A. |
| 2 | Switcher visible, whole roster with human labels, choice persists in localStorage across reloads | 03 | `dev-identity-switcher.test.ts` tests 1-6; `dev-identity-roles.test.tsx` tests 4 and 5 |
| 3 | Six-plus identities, each making a real branch reachable, including the 402 one | 01 (roster), 02 (the 402) | `roster.test.ts` `describe('branch coverage')`, decisively `covers every role set the real claim translation can produce`; `dev-identity-no-hub.test.ts` `answers 402 payment_required no_org_access...`; the switch escape by `mints an entitled token for an entitled Organization the identity switched to`. The admin-only clause is SUPERSEDED, recorded by `records that the admin-only role set is unreachable through the real claim translation` |
| 4 | Roles travel the REAL translation in both halves; no ready-made profile | 03 (web), 02 (API) | `dev-identity-roles.test.tsx` tests 1 and 2, which drive the real `getRolesFromHubClaims` and `getVisibleWorkspaces` unmocked; on the API side `applyHubAuthContext` plus `dev-identity-no-hub.test.ts` test 1 |
| 5 | Adopted identity decides sidebar visibility by the documented rule | 03 | `dev-identity-roles.test.tsx` test 1, now parametrized over the five reachable role sets. The admin-only clause is SUPERSEDED; `no roster identity reaches the team painéis without meus-dados` is its replacement |
| 6 | Four-layer structural defence | 01 (L1), 02 (L2 API, L4), 03 (L2 web, L3) | L1: `auth-fake-isolation.test.mjs` tests 3, 4, 10, 11, 12. L2: tests 5, 6, 13, 14, 15. L3 source: test 8, 17, 18; L3 artefact: `assert-web-bundle-clean.mjs` via tests 20 and 21. L4: tests 7 and 16, plus `dev-identity-production-refusal.test.ts` |
| 7 | Tracked-file guard inside `pnpm run test`, self-proving against mutated fixtures | 05 | `scripts/__tests__/auth-fake-isolation.test.mjs`, whole; the thirteen-test negative block is the self-proof |
| 8 | Production path intact; flag absent means indistinguishable from today | 02, 03 | `app-auth-unconfigured.test.ts`, `app-auth-access-gate.test.ts`, `app-auth-bff-wiring.test.ts` and four siblings, all byte-unchanged and green; `apps/web/src/auth/__tests__/react.test.tsx` byte-unchanged; `dev-identity-flag.test.ts` for the OFF spellings |
| 9 | Deterministic, idempotent, local-only seed creating the roster's orgs with system funções and pessoas | 04 | `apps/api/scripts/__tests__/seed-plan.test.ts` (determinism, funções, identity binding, money, labels, payables, leads); `scripts/__tests__/local-database-guard.test.mjs` extended to three paths for the local-only half |
| 10 | Tenancy honoured; nothing reads org/account/workspace from a request | 02, 04 | `dev-identity-no-hub.test.ts` `never reads an org, an account or a workspace off the request body` and the new `answers 401 unknown_fake_workspace...`; `seed-plan.test.ts` Tenancy block |
| 11 | `CLAUDE.md` updated and the parked prohibition explicitly revised | 07 | `scripts/__tests__/dev-identity-docs-reconciliation.test.mjs` D1-D4, decisively D3 (`flags a supersession note that sits below the prohibition it supersedes`). The truth of the prose is named as a human or verify-agent oracle and is not disguised as an assertion |
| 12 | lint, type-check, test, build green; no existing test weakened | every slice's `must_not_break` | The suites named under 8, plus the `verifier_focus` byte-unchanged checks in 02, 03, 05 and 06. One declared exception, see OBSERVATION C |

**Criteria nothing fully discharges automatically: 1 only.**
Everything else has a named oracle.

---

## Four-layer defence: owner and oracle, one by one

| Layer | Owner | Oracle | Verdict |
| --- | --- | --- | --- |
| 1. devDependency, never dependency | 01 declares the package `private: true` with no build; 02 and 03 add it under `devDependencies` | `auth-fake-isolation.test.mjs` tests 3, 4 always-on and 10, 11, 12 negative. Checks `dependencies`, `peerDependencies` AND `optionalDependencies`, and forbids the ROOT manifest from declaring it at all | ENFORCED |
| 2. Dynamic import only, no type-only carve-out | 02 (`select.ts`), 03 (`install-dev-identity.ts`), 04 (`seed-dev.ts`) | Rule A and rule B, tests 5, 6 always-on and 13, 14, 15 negative. Test 14 exists specifically so the refusal of the type-only carve-out is visible in the output | ENFORCED |
| 3. `import.meta.env.DEV` on the web half | 03 | SPLIT honestly. Source half: test 8, with the ORDERING assertion that refuses a file reaching the package before the flag. Artefact half: `scripts/assert-web-bundle-clean.mjs`, wired into `pnpm run build`, which refuses an absent `dist` and refuses to run at all if `FXL_SALES_DEV_FAKE_ROSTER_SENTINEL` has vanished from `packages/auth-fake/src`. The sentinel was MISSING from slice 01 and has been added | ENFORCED after edit |
| 4. API refuses to boot under `NODE_ENV=production` | 02, in two places sharing one constant | `dev-identity-production-refusal.test.ts`, whose third test asserts the slot is still EMPTY by probing for `503 hub_auth_not_configured`, so it goes red on a status and not only on a string; plus `auth-fake-isolation.test.mjs` tests 7 and 16 | ENFORCED |

No layer is asserted but unenforced.

---

## OBSERVATIONS, not blocking

**A. Acceptance 1 has no automated oracle, and that is the right call.**
It is a two-process boot with a browser at the end.
Slice 06 says so plainly rather than inventing a test that restates the Makefile.
The integrated wave must actually run `make dev-fake` with nothing on `localhost:9016` and click through to a
sales-ops screen, and the run should record that it did.
This is the one criterion where a green suite proves nothing.

**B. `apps/api/scripts/` is outside slice 05's four scanned trees.**
`seed-dev.ts` therefore dynamic-imports the package without being a third sanctioned seam.
That is correct rather than convenient: `scripts/` sits outside `apps/api/tsconfig.json`'s `rootDir`, `tsc`
never emits it into `dist/`, and it is not part of the production artifact at all.
Coverage comes instead from slice 04's extension of `local-database-guard.test.mjs`, which reads the seed by
name and asserts it carries the package specifier.
I added a short `PLAN-CHECK NOTE` section to slice 05 recording this as a decision so a later reader does not
"fix" it by adding a third seam.

**C. Slice 04 widens ONE existing test title, and it is declared.**
`the inspected files exist and are readable` becomes `every inspected file exists and is readable` in
`scripts/__tests__/local-database-guard.test.mjs`.
That is a STRENGTHENING from two files to three, slice 04 records it in its own section 8.1 item 4 precisely
so the Verify agent does not read it as an accommodation, and no assertion is loosened anywhere in the set.
Acceptance 12 is satisfied.
Slice 04's rule "the only permitted edit to an existing test there is one that WIDENS its scope" is the right
fence.

**D. Two pass-count tripwires are seeded with PREDICTIONS.**
Slice 04 already requires the executor to MEASURE (`8` fixture-mode, `19` real) rather than trust.
Slice 05 wrote `# pass 21` and `# pass 8` into an ACCEPTANCE criterion.
Its arithmetic checks out (8 always-on plus 13 negative), but a tripwire seeded with a guessed number lies
from its first run, so I added a `PLAN-CHECK NOTE` requiring the same measure-and-record discipline.
Both numbers must be updated in `CLAUDE.md` and in the file headers in the SAME change.

**E. Slice 03's `## 6. What stays exercised, and what dev-fake disarms` is the best section in the set.**
It names the revalidation ladder, the live-loss overlay, `captureReturnTo`, `requestHubAccessToken` and the
whole real BFF path as DISARMED under dev-fake.
That honesty is worth preserving verbatim through execution, and slice 07's ADR consequence 8 should point at
it rather than restate it.

**F. Slice 02's BFF `404` causality is recorded precisely and should stay that way.**
Under `make dev-fake` on a credential-free machine `/auth/*` answers `404` because there are no Hub
credentials, NOT because of the flag.
Slice 02 says so explicitly and refuses to make the flag suppress the BFF, which would give one variable a
second responsibility.
Good.

**G. A residual risk slice 06 files rather than guards.**
An operator with `SALES_ENV_FILE` exported in their shell who runs `make back-fake` gets the fake adapter
pointed at whatever database that file names.
Slice 06 declines to add a second guard, citing `CLAUDE.md`'s "two exits for one rule is divergence".
I agree with the reasoning and with filing it in prose.
Note that slice 04's seed hard-codes `namedEnvFile: null`, so the one door that DELETES rows is closed to that
hatch regardless, which is the half that matters.

**H. Slice count.**
No slice is doing two things that should be two, and none is small enough to merge.
Slice 04 is the largest by some margin and carries two obligations, but they are inseparable: a seed that
calls `assertLocalDatabase` without extending the guard's test demotes a proven property to an unproven habit,
and splitting them across two slices would let the first land green with the guard quietly weakened.
Slice 04's own section 1 makes that argument better than I can.

**I. Wave order is sound.**
`01` alone in wave 1; `02` and `03` in wave 2 touch disjoint trees (`apps/api` versus `apps/web`) now that
slice 03 no longer claims a `.env` example; `04`, `05` and `06` in wave 3 touch disjoint files after edit 11's
ownership split; `07` alone in wave 4.
No cycle, and no two slices in one wave now write one file.
