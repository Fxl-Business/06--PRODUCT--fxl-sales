---
id: 01-auth-fake-package
milestone: v4.1.0
status: todo
depends_on: []
files_modified:
  - packages/auth-fake/package.json
  - packages/auth-fake/tsconfig.json
  - packages/auth-fake/src/index.ts
  - packages/auth-fake/src/__tests__/roster.test.ts
  - pnpm-lock.yaml
acceptance: "given a workspace package `@fxl-sales/auth-fake` that no shipped source imports, when `pnpm test`, `pnpm run type-check` and `pnpm run lint` run at the repository root, then the package's own suite runs and proves that its roster emits Hub-SHAPED contract-v1 claims covering every role set `getRolesFromHubClaims` can produce plus the no-access 402 case, that `mintDevToken` yields a structurally valid three-part JWT whose payload decodes back to those exact claims, that `readTokenSubject` recovers the account id, and that `allFakeOrgIds()` lists every distinct org id the roster references, while nothing in `apps/api` or `apps/web` references the package at all"
goal: "Create the development-only identity roster package for FXL Sales, emitting Hub-shaped claims that both later consumers run their real translation over, with no consumer wired in this slice"
must_not_break:
  - "the production auth path, which this slice does not touch: no file under apps/api or apps/web is edited"
  - "`pnpm run build`, which must NOT gain this package: it has no build step and never joins `build:packages`"
  - "`pnpm -r type-check`, `pnpm -r lint` and `pnpm -r --if-present test`, all of which pick the new package up automatically through the `packages/*` glob"
  - "browser safety: the package must import nothing and must use no Node-only API, because slice 03 loads it inside Vite"
rules:
  - "no em dash and no en dash on any added line"
  - "the package imports NOTHING - no workspace package, no SDK, no Node builtin"
  - "no ready-made profile, no `AppRole[]`, no `SalesOpsWorkspace[]` is ever emitted as auth output: the package emits CLAIMS and the consumers translate"
  - "nothing in this slice may import the package: `git grep -l '@fxl-sales/auth-fake' -- apps` must print nothing at the end of it"
  - "`private: true`, ESM, consumed from SOURCE - no `dist`, no build script"
  - "the package is never added to any `dependencies` block anywhere, in this slice or a later one"
verifier_focus: "that the roster is derived from the REAL readers (`getRolesFromHubClaims`, `getVisibleWorkspaces`, the SDK's contract gate) rather than copied from the finance reference, that `contractVersion` is 1, that Effective Access is carried explicitly and never derived from `modules`, and that no shipped source imports the package"
---

# 01 - auth-fake-package

## What this slice is, in one paragraph

It creates ONE new workspace package, `packages/auth-fake`, holding the switchable development
identity roster for FXL Sales plus the claim emitter, the token minter, the subject reader and the
org-id lister that slices 02, 03 and 04 consume.
It wires NOTHING.
At the end of this slice `git grep -l '@fxl-sales/auth-fake' -- apps` prints nothing, and the only
proof the slice landed is the package's own suite, which the root `pnpm test` picks up through
`pnpm -r --if-present test`.

## Findings that the executor must NOT re-derive

These were verified against this tree, not carried over from the finance reference.
They are the reason the roster below looks the way it does.

### F1 - `contractVersion` must be exactly `1`

`@fxl-business/hub-sdk@2.3.0` is present at
`node_modules/.pnpm/@fxl-business+hub-sdk@2.3.0_hono@4.12.28/node_modules/@fxl-business/hub-sdk`.
`dist/chunk-7HANYUH6.js:2` declares `var HUB_TOKEN_CONTRACT_VERSION = 1;` and `dist/server.js:820`
reads `if (auth.claims.contractVersion !== HUB_TOKEN_CONTRACT_VERSION)` and answers
`c.json({ error: "unauthorized", code: "contract_version_mismatch" }, 401)`.
`dist/server.d.ts:170` states `contractVersion not 1, including absent | 401 unauthorized /
contract_version_mismatch`.
So the claim is emitted as the number `1` for EVERY identity, with no fixture omitting it and no
fixture carrying `2`.
A fixture that omitted it would model a token the real path REFUSES, which is the one divergence
this whole package exists to avoid.

### F2 - the exact claim set this product reads

Verified reader by reader in THIS tree.
Emit all of these and nothing speculative.

| Claim | Read by | Note |
| --- | --- | --- |
| `sub` | the SDK verifier; `readTokenSubject` in this package | the Hub account id, and slice 02's bearer-to-identity resolution key |
| `aud` | the SDK verifier | must be `app.fxl-sales`, the audience CLAUDE.md pins |
| `workspaceId` | SDK verifier, and `profileFromToken` in `apps/web/src/auth/react.tsx:191` | maps to `orgId`; TOP LEVEL, not inside `workspaces` |
| `contractVersion` | `dist/server.js:820` | see F1 |
| `entitlements.access` | `requireHubAuth`, the ONLY access gate | REQUIRED boolean; false is the 402 |
| `entitlements.modules` | nothing in this repo today | no route mounts `requiredModule`; see F5 |
| `roles.workspace` | `getRolesFromHubClaims` in `apps/web/src/auth/claims.ts` | `'owner' \| 'admin' \| 'member'`, per the SDK's `HubWorkspaceRole` |
| `roles.productRoles` | `getRolesFromHubClaims` | `string[]`; the Hub product config defines `seller` and `finder` |
| `isSuperAdmin` | `getRolesFromHubClaims` | emitted ONLY when true, never as `false` |
| `workspaceName` | `profileFromToken`, and `useOrganizations`' `active.name` | display-only name of the ACTIVE Organization |
| `workspaces` | `readWorkspaces` in `apps/web/src/auth/react.tsx:143` | entries keyed `workspaceId` (with `id` only as a legacy fallback), plus `name`, `role`, `products` |
| `name`, `email` | `profileFromToken`; and the API's audit actor snapshot, `name` then `email` | display-only |
| `typ`, `iss`, `iat`, `exp`, `jti` | the SDK's contract-v1 claim set | `typ` is the literal `'at+jwt'` |

`avatarUrl` is read by `profileFromToken` and is DELIBERATELY not emitted by any fixture.
It is display-only, the reader already handles its absence through `readString`, and emitting a
dead URL would put a broken image in every development screenshot.

### F3 - THE ADMIN-ONLY ROLE SET IS UNREACHABLE, and that is a finding rather than a gap

Read `getRolesFromHubClaims` in `apps/web/src/auth/claims.ts` literally.

```
const fullAccessRoles: AppRole[] = ['admin', 'seller', 'finder'];
const productRoleOrder: AppRole[] = ['seller', 'finder'];
```

Every branch that can yield `admin` yields `fullAccessRoles`, which is all three roles at once.
The workspace `owner` branch, the workspace `admin` branch, the `isSuperAdmin` branch and the
`productRoles.has('admin')` branch ALL return that same array.
The only other return is `productRoleOrder.filter(...)`, which can only ever contain `seller` and
`finder`.
There is therefore NO claim shape at all that produces the role set `['admin']` alone.

`getVisibleWorkspaces(['admin', 'seller', 'finder'])` is
`['tatico', 'operacional', 'cadastros', 'meus-dados']`, all four painéis.

So acceptance 3's "admin-only, sees tatico plus operacional plus cadastros and NO meus-dados" is
not reachable through the real translation, and the only way to reach it would be to write
`profile.roles` directly, which acceptance 4 forbids in as many words.
Acceptance 4 wins: the roster does not fake it.

What the roster does instead, and what the executor must write into the module docblock verbatim in
substance:

- it carries THREE separate identities that reach the full-access set by three DIFFERENT claim
  shapes (workspace `owner`, workspace `admin`, `productRoles: ['admin']`), so each of the three
  literals in `getRolesFromHubClaims` has a fixture standing on it and a mutation that deletes one
  has somewhere to go red;
- it records, in a named test, that no fixture declares `['admin']` alone, together with the reason.

This finding belongs in the feature's own capture and in the CLAUDE.md revision that acceptance 11
asks for.
It is NOT this slice's job to change `claims.ts`, and this slice must not.

### F4 - `org_id` is `text`, so readable fake org ids are legal

`apps/api/src/db/schema.ts:47` declares `orgId: text('org_id').notNull()`, and every other tenant
table follows it.
So `org_fake_norte` is a valid org id and slice 04's seed can insert it directly.
No UUID is required and none should be used, because an operator reading a dev screen should be
able to tell which fixture org they are in.

### F5 - `entitlements.modules` is empty for every identity, on purpose

CLAUDE.md: `modules` carries ADD-ON modules only, must NEVER be read for baseline access, and
`requireHubAuth`'s own `requiredModule` is the only seam that may read it, which no route mounts
today.
So every fixture carries `modules: []` while eight of the nine carry `access: true`.
That combination is itself the guard against the obvious wrong implementation: anything deriving
access from `modules.length > 0` would deny every identity in the roster, and the test named below
pins it.

## The package

### `packages/auth-fake/package.json`

```json
{
  "name": "@fxl-sales/auth-fake",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "comment": "DEVELOPMENT ONLY. Consumers MUST declare this in devDependencies, never dependencies, and MUST reach it only through a dynamic import. It is consumed from SOURCE and has no build step, so it never enters build:packages and never ships. scripts/__tests__/auth-fake-isolation.test.mjs (slice 05) enforces both halves.",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "type-check": "tsc --noEmit",
    "lint": "echo 'no lint for auth-fake'",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "^5.7.3",
    "vitest": "^3.2.7"
  }
}
```

Every one of those five decisions is load-bearing.

`private: true` and no `dist`: it is consumed from source, mirroring the finance reference and
UNLIKE `packages/shared-utils` and `packages/shared-types`, which both build to `dist` and both sit
in the root `build:packages`.
That difference is deliberate: a `dist` would be an artefact that a production install could
plausibly carry, and a build step would put this package in the root `build` chain, which is the
one chain that must stay ignorant of it.
Do NOT add it to `build:packages`.

`lint` is an echo, exactly as `packages/shared-utils` does it, because the root `lint` is
`pnpm -r lint` and a package with no `lint` script would make that command fail.

`type-check` and `test` exist so that `pnpm -r type-check` and `pnpm -r --if-present test` pick the
package up with no root edit.
`pnpm-workspace.yaml` already globs `packages/*`, so it needs NO edit either.

No `@types/node`.
The package must be importable from the browser, and adding Node types is how a Node-only API
sneaks in without the compiler objecting.

### `packages/auth-fake/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": ["src/**/*"]
}
```

No `outDir`, no `rootDir`, no `composite`, no `types`.
The base config already supplies `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals`, and the
`DOM` lib that declares `btoa`, `atob`, `TextEncoder` and `TextDecoder`.
Tests are INSIDE `include` here, unlike `packages/shared-utils`, because nothing is emitted so
there is nothing to keep out of an output directory.

No `vitest.config.ts`.
Vitest's default `include` already matches `src/__tests__/*.test.ts` and the default `node`
environment is correct, because the module touches no DOM object.

### `packages/auth-fake/src/index.ts`

#### Module docblock

It must state, in prose, at minimum:

- DEVELOPMENT ONLY, devDependency only, dynamic import only, guarded by slice 05's isolation test;
- why it emits Hub-SHAPED CLAIMS and never a ready-made profile: both halves then run their REAL
  translation over it, the API through `requireHubAuth` and the web through `parseJwtPayload` plus
  `getRolesFromHubClaims` plus `getVisibleWorkspaces`, so the fake exercises the code most likely
  to break when the Hub contract moves instead of bypassing it;
- F1, in one sentence, naming `contract_version_mismatch`;
- F3 in full, including that the admin-only role set cannot be produced by any claim shape and that
  the roster refuses to fake it;
- F5, in one sentence.

#### Exported types

```ts
/** The Hub-authoritative Organization role, matching the SDK's HubWorkspaceRole. */
export type FakeWorkspaceRole = 'owner' | 'admin' | 'member';

/** An app role as `getRolesFromHubClaims` returns it. Declared locally on purpose: this
 *  package imports NOTHING, and apps/web owns the real type. */
export type FakeAppRole = 'admin' | 'seller' | 'finder';

/** A Sales painel id as `getVisibleWorkspaces` returns it. Declared locally, same reason. */
export type FakeSalesPainel = 'tatico' | 'operacional' | 'cadastros' | 'meus-dados';

/** One Organization membership, in the Hub's wire shape (keyed `workspaceId`, never `id`). */
export interface FakeWorkspace {
  workspaceId: string;
  name: string;
  role: FakeWorkspaceRole;
  /** Application ids this Organization has live access to. Display-only. */
  products: string[];
}

export interface FakeIdentity {
  /** Stable switch key. This is what the dev switcher stores and sends. */
  id: string;
  /** Short human label for the picker. */
  label: string;
  /** What branch this identity exists to make reachable. Shown as help in the picker. */
  exercises: string;
  accountId: string;
  /** The ACTIVE Organization. MUST appear in `workspaces`. */
  activeWorkspaceId: string;
  /** Effective Access of the ACTIVE Organization. Carried EXPLICITLY, never derived. */
  hasAccess: boolean;
  /** ADD-ON module ids only. Empty for every fixture today - see the docblock. */
  modules: string[];
  /** The Hub Organization role in the ACTIVE Organization. */
  workspaceRole: FakeWorkspaceRole;
  /** This Application's own Seat roles. Absent means an unseated person. */
  productRoles?: string[];
  isSuperAdmin?: boolean;
  profile: { name: string; email: string };
  workspaces: FakeWorkspace[];
  /** What `getRolesFromHubClaims` MUST return for this identity, in that exact order.
   *  A DECLARED expectation, cross-checked against the real function by slice 03. */
  expectedRoles: readonly FakeAppRole[];
  /** What `getVisibleWorkspaces(expectedRoles)` MUST return, in that exact order. */
  expectedPaineis: readonly FakeSalesPainel[];
}
```

`expectedRoles` and `expectedPaineis` are DECLARATIONS, not a second implementation.
This package cannot import `apps/web/src/auth/claims.ts` - a package must not reach into an app -
so the cross-check is slice 03's, and this slice's contract with it is written under "Handoff"
below.
Order matters in both arrays, because both real functions return an ORDERED array:
`getRolesFromHubClaims` returns the literal `['admin', 'seller', 'finder']` or
`productRoleOrder.filter(...)` which is `seller` before `finder`, and `getVisibleWorkspaces` pushes
`tatico`, `operacional`, `cadastros` before `meus-dados`.

#### Exported constants

```ts
/** The FXL Sales Application id, which is also the token Audience. */
export const SALES_APPLICATION = 'app.fxl-sales';

/** The display-only Organization preview cap the Hub applies to the `workspaces` claim. */
export const WORKSPACES_CLAIM_CAP = 40;

/** How long a minted development token claims to live. */
export const DEV_TOKEN_TTL_SECONDS = 15 * 60;

/** The issuer a minted development token names. Never a real Hub issuer. */
export const DEV_TOKEN_ISSUER = 'fxl-sales-auth-fake';

/** The placeholder occupying the signature segment. It is not a signature and never was. */
export const DEV_TOKEN_SIGNATURE = 'development-not-a-signature';

/** A unique literal that exists ONLY so slice 05's build-time bundle check has something
 *  unambiguous to look for in `apps/web/dist`. It is exported and referenced by the
 *  module docblock so a tree-shaker cannot drop it from the package source. */
export const FXL_SALES_DEV_FAKE_ROSTER_SENTINEL = 'FXL_SALES_DEV_FAKE_ROSTER_SENTINEL';
```

PLAN-CHECK ADDITION, 2026-09-21: the sentinel is REQUIRED by slice 05, whose
`scripts/assert-web-bundle-clean.mjs` refuses to run at all when the literal is absent from
`packages/auth-fake/src`.
Without it that script is trivially green forever, which is the vacuity this feature has already
paid for twice elsewhere in this repository.

`SALES_APPLICATION` must be `app.fxl-sales` and never `product.fxl-sales`: CLAUDE.md pins the
Audience as `app.<slug>`.

#### The Organizations

Three, and exactly three.

```ts
const NORTE  = workspace('org_fake_norte', 'Agencia Norte');            // entitled, the everyday org
const SUL    = workspace('org_fake_sul', 'Consultoria Sul');            // entitled, the switch target
const SEM    = workspace('org_fake_sem_acesso', 'Marca Sem Acesso', 'member', []); // NOT entitled
```

`workspace(workspaceId, name, role = 'owner', products = [SALES_APPLICATION])` is a local helper.
`SEM` carries `products: []`, so it does NOT list `app.fxl-sales`, which is the honest wire shape
for an Organization that has not bought the product.

No accented characters in the org NAMES: `Agencia`, not `Agência`.
These strings travel through a hand-rolled base64url minter and a hand-rolled base64 decoder, and
keeping them ASCII removes an entire class of encoding question from a development fixture.
The `label` and `exercises` fields are pt-BR display strings and may carry accents freely, because
they never enter a token.

#### The roster

Nine identities, in this exact order.
`IDENTITIES[0]` is the everyday driver, so `DEFAULT_IDENTITY_ID` needs no separate concept.

| # | `id` | `label` | `workspaceRole` | `productRoles` | `hasAccess` | active | `workspaces` | `expectedRoles` | `expectedPaineis` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `team-owner` | `Ana (dona da organizacao)` | `owner` | absent | `true` | NORTE | `[NORTE]` | `['admin','seller','finder']` | all four |
| 2 | `team-admin` | `Bruno (admin da organizacao)` | `admin` | absent | `true` | NORTE | `[NORTE as admin]` | `['admin','seller','finder']` | all four |
| 3 | `product-admin` | `Carla (papel admin do produto)` | `member` | `['admin']` | `true` | NORTE | `[NORTE as member]` | `['admin','seller','finder']` | all four |
| 4 | `seller` | `Diego (somente vendedor)` | `member` | `['seller']` | `true` | NORTE | `[NORTE as member]` | `['seller']` | `['meus-dados']` |
| 5 | `finder` | `Elena (somente finder)` | `member` | `['finder']` | `true` | NORTE | `[NORTE as member]` | `['finder']` | `['meus-dados']` |
| 6 | `seller-finder` | `Fabio (vendedor e finder)` | `member` | `['seller','finder']` | `true` | NORTE | `[NORTE as member]` | `['seller','finder']` | `['meus-dados']` |
| 7 | `no-role` | `Gisele (sem papel reconhecido)` | `member` | `['viewer']` | `true` | NORTE | `[NORTE as member]` | `[]` | `[]` |
| 8 | `no-access` | `Heitor (organizacao sem acesso)` | `member` | `['seller']` | `false` | SEM | `[SEM, NORTE as member]` | `['seller']` | `['meus-dados']` |
| 9 | `multi-org` | `Iris (duas organizacoes)` | `owner` | absent | `true` | NORTE | `[NORTE, SUL]` | `['admin','seller','finder']` | all four |

`accountId` is `user_fake_<first name lowercased>`: `user_fake_ana`, `user_fake_bruno`,
`user_fake_carla`, `user_fake_diego`, `user_fake_elena`, `user_fake_fabio`, `user_fake_gisele`,
`user_fake_heitor`, `user_fake_iris`.
`profile.email` is `<first name>@fake.local`.
`profile.name` is the full display name, for example `Ana Diretora`, `Bruno Administrador`,
`Carla Produto`, `Diego Vendedor`, `Elena Finder`, `Fabio Duplo`, `Gisele Sem Papel`,
`Heitor Sem Acesso`, `Iris Multi`.
`modules` is `[]` for all nine.
`isSuperAdmin` is absent from all nine: the `owner` and `admin` fixtures already cover the same
branch outcome, and CLAUDE.md's identifier law gives super-admin no screen in this product.

Each `exercises` string states the branch in pt-BR, for example for `no-access`:
`a organizacao ativa nao carrega acesso: 402 e MissingEntitlementPanel, com outra organizacao para
onde trocar`.

Why each fixture exists, which the executor must write as a comment above it:

1. `team-owner` - the everyday path, and the `workspaceRole === 'owner'` literal in
   `getRolesFromHubClaims`.
2. `team-admin` - the `workspaceRole === 'admin'` literal, which is a SEPARATE disjunct: deleting
   it leaves fixture 1 green, so it needs its own fixture.
3. `product-admin` - the `productRoles.has('admin')` early return, the third and last way to reach
   the full-access set, and the only one that does it from a workspace `member`.
4. `seller` - seller-only: sees ONLY `meus-dados` and lands on `meus-dados/vendedores`, which is
   `meusDadosSeller[0]` in `apps/web/src/sales-ops/navigation.ts`.
5. `finder` - finder-only: sees ONLY `meus-dados` and lands on `meus-dados/finders`, which is
   `meusDadosFinder[0]`.
6. `seller-finder` - both product roles at once, which merges the two `meus-dados` nav lists and is
   a distinct navigation branch from either 4 or 5.
7. `no-role` - lands on `/no-role`. It carries `productRoles: ['viewer']` rather than `[]`
   DELIBERATELY: an UNRECOGNIZED role is strictly stronger than an empty list, because it proves
   `productRoleOrder.filter` DROPS what it does not know rather than merely that nothing filters to
   nothing, and it is exactly the case CLAUDE.md's `NoRoleGuard` oracle
   `keeps the unauthorized screen for a role the app does not recognize, and does not ping-pong`
   is about.
8. `no-access` - `entitlements.access: false`, so `requireHubAuth` answers `402` and the shell must
   render `MissingEntitlementPanel` rather than the generic `Verifique o servidor local` copy. Its
   `workspaces` carries NORTE as a second entry on purpose: `useOrganizations` derives `others` as
   `workspaces.filter((w) => w.id !== active?.id)`, and the panel offers switching BEFORE checkout,
   so a single-Organization fixture would leave the panel's primary escape unrendered and untested.
   It keeps `productRoles: ['seller']` so that the 402 is provably about the ORGANIZATION and not
   about the person having no role - the two dead ends look identical on screen otherwise.
9. `multi-org` - two ENTITLED Organizations, so the account dropdown's Organization section renders
   and `setActive` plus its `queryClient.clear()` critical section is reachable. Fixture 8 is also
   multi-Organization but is stuck at 402, so it can never exercise a SUCCESSFUL switch. A separate
   multi-org fixture is therefore warranted, and this sentence is the answer to the question the
   slice brief asked.

#### Exported functions

```ts
/** The identity a session adopts when none was named. */
export const DEFAULT_IDENTITY_ID: string;   // = IDENTITIES[0]!.id

export const IDENTITIES: readonly FakeIdentity[];

/** Look up by switch key. Returns undefined for an unknown key, never a guess. */
export function findIdentity(id: string | undefined | null): FakeIdentity | undefined;

/** Look up by the account id a token carries. This is what lets the browser send an
 *  ordinary bearer and the API recover which fixture it was, with no dev-only header. */
export function findIdentityByAccountId(accountId: string | undefined | null): FakeIdentity | undefined;

/** Options every claim producer takes. One object, so the three cannot drift apart. */
export interface FakeClaimOptions {
  nowSeconds?: number;
  /** Adopt a DIFFERENT active Organization than `identity.activeWorkspaceId`.
   *  IGNORED, never honoured, when it is not a member of `identity.workspaces`. */
  organizationId?: string;
}

/** The FULL contract-v1 claim set a Hub access token would carry for this identity. */
export function toHubClaims(
  identity: FakeIdentity,
  options?: FakeClaimOptions,
): Record<string, unknown>;

/** The verified-context shape `requireHubAuth` would expose as `c.get('hubAuth')`. */
export function toHubAuthContext(
  identity: FakeIdentity,
  options?: FakeClaimOptions,
): FakeHubAuthContext;

/** A structurally valid JWT with a PLACEHOLDER signature. */
export function mintDevToken(identity: FakeIdentity, options?: FakeClaimOptions): string;

/** Read `sub` out of a token payload without verifying anything. Null for anything else. */
export function readTokenSubject(token: string | null | undefined): string | null;

/** Read `workspaceId` out of a token payload without verifying anything. Null for anything else.
 *  It is the twin of `readTokenSubject` and shares its whole decode path. */
export function readTokenWorkspaceId(token: string | null | undefined): string | null;

/** Is this Organization one the identity actually belongs to. The membership RAIL. */
export function identityHasWorkspace(identity: FakeIdentity, workspaceId: string): boolean;

/** Every distinct org id the roster references - what slice 04's seed must create. */
export function allFakeOrgIds(): string[];
```

`toHubClaims` returns, for an identity, with `options.nowSeconds` defaulting to
`Math.floor(Date.now() / 1000)`:

```
{
  iss: DEV_TOKEN_ISSUER,
  aud: SALES_APPLICATION,
  sub: identity.accountId,
  workspaceId: active.workspaceId,
  contractVersion: 1,
  entitlements: { access: active.products.includes(SALES_APPLICATION), modules: [...identity.modules] },
  roles: {
    workspace: identity.workspaceRole,
    ...(identity.productRoles ? { productRoles: [...identity.productRoles] } : {}),
  },
  typ: 'at+jwt',
  iat: nowSeconds,
  exp: nowSeconds + DEV_TOKEN_TTL_SECONDS,
  jti: `dev-${identity.id}-${nowSeconds}`,
  name: identity.profile.name,
  email: identity.profile.email,
  ...(identity.isSuperAdmin ? { isSuperAdmin: true } : {}),
  ...(active ? { workspaceName: active.name } : {}),
  workspaces: identity.workspaces.slice(0, WORKSPACES_CLAIM_CAP),
}
```

PLAN-CHECK REVISION, 2026-09-21. `active` is resolved ONCE, at the top of `toHubClaims`, and the
whole claim set is built off it:

```
const requested = options?.organizationId;
const active =
  (requested ? identity.workspaces.find((w) => w.workspaceId === requested) : undefined)
  ?? identity.workspaces.find((w) => w.workspaceId === identity.activeWorkspaceId);
```

An `organizationId` the identity does not belong to is IGNORED and the identity's own active
Organization is used, never the requested one.
That is a membership RAIL and not a convenience: `identityHasWorkspace` is the same predicate
exported for slice 02's API middleware, so the browser and the API refuse the same values.

Effective Access is read off the RESOLVED Organization as
`active.products.includes(SALES_APPLICATION)` rather than off `identity.hasAccess`.
This is what makes the `no-access` fixture's escape REAL: `MissingEntitlementPanel` offers a switch
before a checkout, `setActive` mints with `organizationId`, and the new token must carry
`access: true` for the entitled Organization the operator just moved to.
Reading `identity.hasAccess` unconditionally would mint `access: false` for every Organization that
identity can reach, so the panel's primary escape would answer `402` forever - the exact dead end
the panel exists to remove.
It is still not derived from `modules`, which is the rule `CLAUDE.md` states and which the named
test below still pins.
`FakeIdentity.hasAccess` survives as a DECLARED expectation, exactly like `expectedRoles`, and the
coherence test below pins it equal to what `toHubClaims` computes for the identity's own active
Organization.

`mintDevToken`, `toHubAuthContext` and `readTokenWorkspaceId` all ride that one resolution, so the
token the browser sends, the context the API builds and the org the API reads back cannot disagree.

`toHubClaims` is the SINGLE producer.
`mintDevToken` and `toHubAuthContext` both call it, and neither rebuilds any part of the claim set
independently, so the token the browser sends and the context the API builds cannot drift apart.
That is the whole reason `iss`, `aud`, `typ`, `iat`, `exp` and `jti` live here rather than inside
the minter.

`isSuperAdmin` is spread conditionally because the SDK's own type says it is
`Emitted ONLY when true, never false`.
`workspaceName` is spread conditionally for the same reason, though no fixture can actually miss it
given the roster coherence test below - the conditional exists so a future fixture with a
non-member active Organization degrades honestly instead of emitting `undefined`.

`FakeHubAuthContext` mirrors the SDK's `HubAuthContext` field for field:

```ts
export interface FakeHubAuthContext {
  accountId: string;
  workspaceId: string;
  entitlements: { access: boolean; modules: string[] };
  roles: { workspace: FakeWorkspaceRole; productRoles?: string[] };
  aud: string;
  claims: Record<string, unknown>;
}
```

`aud` is present because the SDK's `HubAuthContext` has it and slice 02 will hand this object to
code typed against the real interface.
`claims` is `toHubClaims(identity, options)`, the same object, never a rebuild.

`mintDevToken` is:

```
base64Url(JSON.stringify({ alg: 'none', typ: 'at+jwt' }))
  + '.' + base64Url(JSON.stringify(toHubClaims(identity, options)))
  + '.' + DEV_TOKEN_SIGNATURE
```

`base64Url` must work in BOTH Node and the browser and must use no Node builtin:
`new TextEncoder().encode(value)`, then accumulate `String.fromCharCode(byte)`, then `btoa`, then
`.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')`.
`Buffer` is forbidden: it would make the package unimportable from Vite.

`readTokenSubject` splits on `.`, refuses anything that is not three parts with a non-empty middle
part, restores `-`/`_` to `+`/`/`, re-pads to a multiple of four, `atob`s, percent-decodes to
recover UTF-8, `JSON.parse`s inside a `try`, and returns `payload.sub` only when it is a string.
Any throw returns `null`.
It verifies NOTHING and its docblock must say so out loud.

`allFakeOrgIds` walks every identity's `workspaces`, collects `workspaceId` into a `Set`, and
returns the spread array.
It collects from `workspaces` and NOT from `activeWorkspaceId`, because the coherence test below
guarantees the active one is always a member, and a second source would be a second thing to keep
in sync.
For this roster it returns exactly three ids.
The ORDER is first-seen across `IDENTITIES`, which today is `org_fake_norte`, then
`org_fake_sem_acesso` (fixture 8), then `org_fake_sul` (fixture 9), but the order is NOT part of
the contract and the test must assert membership and length rather than sequence.
A later roster reorder is not a regression and must not turn a test red for a reason nobody cares
about.

## The oracle

`packages/auth-fake/src/__tests__/roster.test.ts`, run by `pnpm test` at the root through
`pnpm -r --if-present test`.
These are the named tests whose failure proves this slice undone.

### `describe('roster coherence')`

- `has unique switch keys` - `new Set(ids).size === ids.length`.
- `has unique account ids, so bearer-subject resolution is unambiguous` - same over `accountId`.
  This is what makes `findIdentityByAccountId` a function rather than a guess.
- `gives every identity an active Organization it is actually a member of` - for each identity,
  `identity.workspaces.map((w) => w.workspaceId)` contains `identity.activeWorkspaceId`.
- `resolves the default identity, and refuses an unknown one` - `findIdentity(DEFAULT_IDENTITY_ID)`
  is defined; `findIdentity('nobody')`, `findIdentity(undefined)`, `findIdentity(null)`,
  `findIdentityByAccountId('user_nobody')` and `findIdentityByAccountId(null)` are all `undefined`.

### `describe('branch coverage')` - THE decisive oracle for this slice

- **`covers every role set the real claim translation can produce`**.
  Collect `IDENTITIES.map((i) => i.expectedRoles.join('|'))` into a `Set` and assert it equals
  exactly `{'admin|seller|finder', 'seller', 'finder', 'seller|finder', ''}`, five members and no
  more.
  Deleting any fixture that carries the only copy of one of those sets turns this red.
  This is the test whose failure means the slice is undone.
- **`covers every painel set the real visibility rule can produce`**.
  Same over `expectedPaineis`, asserting exactly
  `{'tatico|operacional|cadastros|meus-dados', 'meus-dados', ''}`.
- **`records that the admin-only role set is unreachable through the real claim translation`**.
  Assert no identity has `expectedRoles` equal to `['admin']`, with the comment carrying F3.
  This test exists so the finding cannot be silently "fixed" by someone adding a fixture that
  claims a role set no claim shape produces.
- `reaches the full-access role set by three DIFFERENT claim shapes`.
  Assert that among the identities whose `expectedRoles` is the full set, one has
  `workspaceRole: 'owner'`, one has `workspaceRole: 'admin'`, and one has `workspaceRole: 'member'`
  with `productRoles` containing `'admin'`.
- `names exactly one identity whose Organization carries no access, and gives it somewhere to
  switch to`.
  Assert `IDENTITIES.filter((i) => !i.hasAccess).map((i) => i.id)` equals `['no-access']`, and that
  that identity's `workspaces` has more than one entry and contains at least one entry OTHER than
  its active one whose `products` includes `SALES_APPLICATION`.
- `gives the no-role identity a role the app does not recognize, not an empty list`.
  Assert `findIdentity('no-role')!.productRoles` is `['viewer']` and that `expectedRoles` is `[]`.
- `gives the multi-org identity two ENTITLED Organizations` - length 2, `hasAccess` true, both
  entries' `products` include `SALES_APPLICATION`.

### `describe('toHubClaims')`

- **`announces contract version 1, which is the only version requireHubAuth accepts`**.
  For every identity, `toHubClaims(i).contractVersion` is the number `1`.
  Mutating it to `2` or deleting the key turns this red, and it is the pin for F1.
- **`carries Effective Access explicitly and never derives it from modules`**.
  Every identity has `modules: []`; assert `toHubClaims(i).entitlements` equals
  `{ access: i.hasAccess, modules: [] }` for every identity, and separately that at least one
  identity has `access: true` with an empty `modules`.
  That second half is what fails on the derive-from-modules implementation.
- `names the Audience as app.fxl-sales` - `toHubClaims(i).aud === SALES_APPLICATION` and
  `SALES_APPLICATION === 'app.fxl-sales'`.
- `emits the Organization preview keyed workspaceId, which is what the web reader reads` - for the
  `multi-org` identity, every entry of `claims.workspaces` has a string `workspaceId`, a string
  `name`, a `role` and an array `products`, and NO entry carries an `id` key.
- `caps the Organization preview at WORKSPACES_CLAIM_CAP` - assert
  `claims.workspaces.length <= WORKSPACES_CLAIM_CAP` for every identity.
- `emits isSuperAdmin only when true` - no identity in this roster sets it, so assert `'isSuperAdmin'
  in toHubClaims(i)` is false for every identity.
- `names the ACTIVE Organization so no surface renders a raw id` - for every identity,
  `claims.workspaceName` is the `name` of the entry whose `workspaceId` equals
  `claims.workspaceId`.
- `omits avatarUrl, which the reader already handles` - `'avatarUrl' in toHubClaims(i)` is false.
- `emits productRoles only when the identity has a Seat` - the four `owner`/`admin` fixtures with no
  `productRoles` produce claims whose `roles` has no `productRoles` key; the others produce it.
- `is deterministic for a given nowSeconds` - `toHubClaims(i, {nowSeconds: 1_700_000_000})` deep-equals a second
  call with the same argument, and `exp - iat === DEV_TOKEN_TTL_SECONDS`.

### `describe('toHubAuthContext')`

- `projects the same claims object it exposes, never a rebuild` - for every identity, with a fixed
  `nowSeconds`, `ctx.claims` deep-equals `toHubClaims(i, {nowSeconds})`, and `ctx.accountId`,
  `ctx.workspaceId`, `ctx.entitlements`, `ctx.roles` and `ctx.aud` each equal the corresponding
  claim.
  This is the anti-drift pin between the API half and the browser half.

### `describe('mintDevToken')`

- **`mints a structurally valid three-part JWT whose payload decodes to the same claims`**.
  Split on `.`, assert three parts, assert the third is `DEV_TOKEN_SIGNATURE`, decode the second
  part with the same base64url-to-JSON path `readTokenSubject` uses, and deep-equal it to
  `toHubClaims(identity, {nowSeconds})` for a fixed `nowSeconds`.
  This is what makes `apps/web/src/auth/claims.ts`'s `parseJwtPayload` work unmodified.
- `announces alg none and typ at+jwt in the header` - decode the first part and assert
  `{ alg: 'none', typ: 'at+jwt' }`.
- `never claims to be signed` - the third segment is the literal `development-not-a-signature`.
- `survives a non-ASCII display name` - mint a token for an identity whose `profile.name` is
  temporarily replaced with one carrying accents, decode it, and assert the name round-trips.
  Build that identity as `{ ...findIdentity('seller')!, profile: { ...p, name: 'Joao Coracao' } }`
  with real accented characters in the TEST, so the `TextEncoder` plus `btoa` path is proven rather
  than assumed.

### `describe('readTokenSubject')`

- `recovers the account id from a minted token` - for every identity,
  `readTokenSubject(mintDevToken(i))` equals `i.accountId`, and feeding that back into
  `findIdentityByAccountId` returns the same identity.
- `returns null for anything that is not a decodable three-part JWT` - `null`, `undefined`, `''`,
  `'a.b'`, `'a.b.c.d'`, `'a..c'`, `'a.%%%.c'`, and a three-part token whose payload decodes to a
  JSON array rather than an object, and one whose payload has a non-string `sub`.

### `describe('the active Organization override')` - PLAN-CHECK ADDITION

- **`pins hasAccess as a declared expectation against what toHubClaims computes`** - for every
  identity, `toHubClaims(i).entitlements.access === i.hasAccess`.
  This is what keeps the declared field honest once access is read off the resolved Organization's
  `products`.
- **`mints an entitled token for an entitled Organization the identity switched to`** - for
  `no-access`, `toHubClaims(i, {organizationId: 'org_fake_norte'}).entitlements.access` is `true`
  and `.workspaceId` is `org_fake_norte`.
  This is the oracle for `MissingEntitlementPanel`'s switch escape actually escaping; without it the
  panel's primary action answers `402` forever.
- **`ignores an Organization the identity does not belong to, rather than honouring it`** - for
  `seller`, `toHubClaims(i, {organizationId: 'org_fake_sul'})` carries `workspaceId` equal to
  `i.activeWorkspaceId`, and `identityHasWorkspace(i, 'org_fake_sul')` is `false`.
  This is the membership RAIL, and slice 02's API middleware reuses the same predicate.
- `readTokenWorkspaceId recovers the ACTIVE Organization from a minted token` - for every identity
  and for the override case above, `readTokenWorkspaceId(mintDevToken(i, opts))` equals the
  `workspaceId` claim, and it returns `null` for the same malformed inputs `readTokenSubject` does.
- `exports the bundle sentinel` - `FXL_SALES_DEV_FAKE_ROSTER_SENTINEL` is the exact literal
  `'FXL_SALES_DEV_FAKE_ROSTER_SENTINEL'`, which is what slice 05's build-time bundle check refuses
  to run without.

### `describe('allFakeOrgIds')`

- **`lists every org id the roster references, deduplicated`** - the returned array has no
  duplicates, has length 3, and its members are exactly `org_fake_norte`, `org_fake_sul` and
  `org_fake_sem_acesso`.
  This is slice 04's contract: the seed creates exactly what this returns.
- `covers every identity's active Organization` - for every identity, the returned array contains
  `identity.activeWorkspaceId`.

## Handoff, stated so the later slices and this plan agree in writing

- **Slice 02 (API)** consumes `findIdentityByAccountId`, `readTokenSubject`,
  `readTokenWorkspaceId`, `identityHasWorkspace` and `toHubAuthContext`.
  It must declare the shape it needs STRUCTURALLY, with a local interface and no `import` naming the
  package - not even a type-only import, which the compiler erases but a source-scanning guard
  cannot be asked to reason about.
  The package is reached ONLY through `await import('@fxl-sales/auth-fake')`.
  That is also what keeps `apps/api/tsconfig.json`'s `rootDir: "./src"` out of the picture: a static
  import of a package whose `types` point at `.ts` source would drag that file into a program that
  emits, and a structural declaration never does.
- **Slice 03 (web)** consumes `IDENTITIES`, `DEFAULT_IDENTITY_ID`, `findIdentity`, `mintDevToken`
  and `DEV_TOKEN_TTL_SECONDS`, all behind `import.meta.env.DEV` and all through a dynamic import.
  **Slice 03 OWNS the cross-check this package cannot perform**: a test that, for every identity in
  `IDENTITIES`, runs the REAL `getRolesFromHubClaims(parseJwtPayload(mintDevToken(i))!)` and asserts
  it deep-equals `i.expectedRoles`, and the REAL `getVisibleWorkspaces(...)` of that result and
  asserts it deep-equals `i.expectedPaineis`.
  Without that test `expectedRoles` is an unverified claim, so it is not optional.
- **Slice 04 (seed)** consumes `allFakeOrgIds()` and creates exactly those three org ids, each with
  its `vendedor` and `finder` system funções and pessoas carrying them.
- **Slice 05 (guard)** asserts this package appears only under `devDependencies`, that no shipped
  source imports it statically, and that `FXL_SALES_DEV_FAKE_ROSTER_SENTINEL` still exists under
  `packages/auth-fake/src` before it scans `apps/web/dist` for it.
- The F3 finding must reach the feature's CLAUDE.md revision under acceptance 11, and must be
  reported to the orchestrator by this slice.

## Definition of done for this slice

1. The five files above exist and `pnpm install` has updated `pnpm-lock.yaml`.
2. `pnpm --filter @fxl-sales/auth-fake test` is green and reports every test named above.
3. `pnpm --filter @fxl-sales/auth-fake type-check` is green.
4. `pnpm run lint`, `pnpm run type-check`, `pnpm test` and `pnpm run build` are green at the root,
   and `pnpm run build` produces no output for this package because it has no build script.
5. `git grep -l '@fxl-sales/auth-fake' -- apps` prints nothing.
6. `git grep -nE 'require\(|from .node:|\bBuffer\b|process\.env' -- packages/auth-fake` prints
   nothing.
