---
id: 02-api-dev-adapter
milestone: v4.1.0
status: todo
depends_on: ["01-auth-fake-package"]
files_modified:
  - apps/api/package.json
  - pnpm-lock.yaml
  - apps/api/src/middleware/app-auth.ts
  - apps/api/src/auth/select.ts
  - apps/api/src/server.ts
  - apps/api/test/unit-setup.ts
  - apps/api/src/auth/__tests__/dev-identity-flag.test.ts
  - apps/api/src/auth/__tests__/dev-identity-production-refusal.test.ts
  - apps/api/src/auth/__tests__/dev-identity-no-hub.test.ts
acceptance:
  - given: a machine with NOT ONE `FXL_HUB_*` variable set and no Hub listening anywhere, and `SALES_AUTH_FAKE=1` under `NODE_ENV=development`
    when: the API boots and a request reaches a route mounted behind `appAuthMiddleware` carrying `x-fake-identity: <a roster id>`
    then: the request is served `200` with `userId`, `orgId`, `userRole` and `userRoles` set from that identity's Hub-shaped claims through the existing `getHubLegacyAuthContext`, and nothing contacted a Hub.
  - given: the same machine, and a request carrying no `x-fake-identity` header but an ordinary `Authorization: Bearer <fake token>` produced by the roster
    when: that request reaches the same route
    then: the identity is resolved from the token's `sub` claim, so `apps/web/src/lib/api-client.ts` needs no dev-only branch, and the adopted identity is the one the token names.
  - given: `SALES_AUTH_FAKE=1` and `NODE_ENV=production`
    when: anything calls `installFakeAuthIfRequested()` or `installAppAuthAdapter()`
    then: it THROWS with the single exported `DEV_IDENTITY_ADAPTER_IN_PRODUCTION_MESSAGE`, the adapter slot is left empty, and `appAuthMiddleware` still answers on the Hub path exactly as it does today.
  - given: `SALES_AUTH_FAKE` absent, blank, `0` or `false`
    when: the API boots
    then: `installFakeAuthIfRequested()` returns `false`, evaluates no further module, and the repository's behaviour is indistinguishable from today's, including the `503 hub_auth_not_configured` answer on a machine with no credentials.
  - given: dev-fake is active and a request names an identity that is not on the roster
    when: that request reaches the route
    then: it is answered `401 {"error":"unauthorized","code":"unknown_fake_identity", ...}` and NEVER silently resolved to the default identity.
  - given: dev-fake is active and the adopted identity's `entitlements.access` is `false`
    when: that request reaches the route
    then: it is answered `402 {"error":"payment_required","code":"no_org_access"}`, byte-identical to what `requireHubAuth` returns, so `isEntitlementFailure` routes it to `MissingEntitlementPanel`.
goal: >
  Give apps/api the boot-time identity adapter seam it does not have today, and put
  one development adapter behind it, so the whole product can be driven locally with
  no Hub in the air, while the production request path keeps exactly one access gate
  and one deny taxonomy.
must_not_break:
  - "`requireHubAuth` stays the ONE access gate on the Hub path, constructed exactly as today, with `allowWithoutAccess` at its default `false` and no `audience` override."
  - "The deny taxonomy 401 / 402 / 403 / 503 and its exact bodies. No existing body gains, loses or reorders a key."
  - "`apps/api/src/middleware/__tests__/app-auth-unconfigured.test.ts` stays BYTE-UNCHANGED and green. It is the must-not-break oracle for the flag-absent path: a machine with no credentials and no dev-fake flag still answers `503 hub_auth_not_configured`."
  - "`app-auth-access-gate.test.ts`, `app-auth-partial-config.test.ts`, `app-auth-bff-wiring.test.ts`, `app-auth-bff-memory-path.test.ts`, `app-auth-bff-production-boot.test.ts` and `app-auth.test.ts` all stay byte-unchanged and green. No title and no assertion is loosened to accommodate the fake mode."
  - "`scripts/__tests__/local-database-guard.test.mjs` stays byte-unchanged and green. `server.ts` still invokes `assertLocalDatabase` and `migrate.ts` still has no bare `dotenv/config`."
  - "The local-database guard's ORDERING property: a remote `DATABASE_URL` still produces the three `[local-database-guard]` lines and exit 1 with no `HubConfigError` and no auth output ahead of them."
  - "`server.ts` still statically imports ONLY `./env.js` and `./db/local-database-guard.js`."
  - "`createAppAuthBff()` and its mount block in `server.ts` are byte-unchanged."
  - "Tenancy: the dev path never reads `user_id`, `org_id`, `account_id` or `workspace_id` from a request body or a query string."
rules:
  - "House style: never an em dash or an en dash. One full sentence per line in markdown."
  - "Do not touch `apps/web` in this slice. The web half is slice 03."
  - "Do not touch `packages/auth-fake`. It is slice 01's and is consumed here only through a dynamic import and a structurally declared interface."
verifier_focus:
  - "Run `pnpm --filter @fxl-sales/api test` and confirm the three new oracle files are green AND that every pre-existing `app-auth-*.test.ts` is still green with an unchanged title list."
  - "Run `pnpm run lint`, `pnpm run type-check` and `pnpm run build`."
  - "Confirm by reading `apps/api/package.json` that `@fxl-sales/auth-fake` appears ONLY under `devDependencies`."
  - "Confirm by reading `apps/api/src/auth/select.ts` and `apps/api/src/middleware/app-auth.ts` that neither carries any `import` statement naming `@fxl-sales/auth-fake`, type-only included."
  - "Confirm by reading `apps/api/src/server.ts` that the two new lines sit AFTER the database-guard block and its boot line and BEFORE the first pre-existing `await import(...)`."
  - "Mutation probe the verifier must run: delete the `isProductionEnv` throw from `installFakeAuthIfRequested` and confirm `dev-identity-production-refusal.test.ts` goes RED; delete the `entitlements.access !== true` branch from the dev middleware and confirm the 402 case in `dev-identity-no-hub.test.ts` goes RED."
---

# 02 - API dev-fake identity adapter

## The problem this slice solves

This repository has NO adapter seam.
`apps/api/src/middleware/app-auth.ts` builds `const hubAuthMiddleware = hubSdkConfig ? requireHubAuth(hubSdkConfig) : null` at module top level, and `appAuthMiddleware` closes over that value directly.
Finance's `installAuthAdapter` does not exist here, and `apps/api/src/middleware/auth.ts` is about RLS tenant context rather than identity, so there is nothing to extend.
There is also no `index.ts` exporting an `app`: `apps/api/src/server.ts` is the whole composition root and calls `serve(...)` at module scope, so no oracle can import the boot module without opening a socket.
Every design decision below follows from those three facts.

## What gets built

### 1. The adapter slot, in `apps/api/src/middleware/app-auth.ts`

Today's `appAuthMiddleware` body moves VERBATIM into a module-local `const hubAppAuthMiddleware: MiddlewareHandler`.
Not one character of it changes: the `503 hub_auth_not_configured` branch, the `MISSING_HUB_CONTEXT` backstop, the `getHubLegacyAuthContext` projection and the `blockedResponse ?? authResponse` return are all carried across as they stand.

Beside it, three new module members and nothing else:

```
let installedAppAuthAdapter: MiddlewareHandler | null = null;

export const DEV_IDENTITY_ADAPTER_IN_PRODUCTION_MESSAGE =
  'SALES_AUTH_FAKE is set while NODE_ENV=production. ' +
  'The development identity adapter must never run in production. Refusing to boot.';

export function installAppAuthAdapter(adapter: MiddlewareHandler): void;
```

`appAuthMiddleware` becomes a one-line dispatcher that reads the slot per request and delegates:

```
export const appAuthMiddleware: MiddlewareHandler = (c, next) =>
  (installedAppAuthAdapter ?? hubAppAuthMiddleware)(c, next);
```

`installAppAuthAdapter` enforces two rules of its own, and both THROW rather than returning a value anyone could ignore.
It refuses when `process.env.NODE_ENV` is `production`, throwing `DEV_IDENTITY_ADAPTER_IN_PRODUCTION_MESSAGE`.
It refuses a SECOND install, because the slot exists to REPLACE the one gate and not to stack a second one beside it, and a stack is exactly the "one live gate and one unreachable one with a green suite over the dead one" shape `CLAUDE.md` forbids.

Why the production refusal is duplicated between this function and `installFakeAuthIfRequested`, and why that is not a second gate.
Both throw, neither allows anything, and both throw the SAME exported constant, so the two cannot drift into saying different things about one rule.
The reason they are both there is the lesson Finance's `index-fake-auth-production-refusal.test.ts` records in prose: a function that switches off an authentication surface must not be safe only because somebody upstream happened to check first.
`installFakeAuthIfRequested` checks so that the message an operator sees names the real cause instead of an `ERR_MODULE_NOT_FOUND` from a package that is not in the production image; `installAppAuthAdapter` checks so that the slot itself is closed to any future caller that reaches it another way.

One more shared helper is extracted so the two adapters cannot disagree about tenancy:

```
export async function applyHubAuthContext(
  c: Context,
  auth: MinimalHubAuthContext,
  next: Next,
): Promise<void>;
```

Its body is lifted verbatim out of today's inner callback: `getHubLegacyAuthContext(auth)`, then `c.set('userId' | 'orgId' | 'userRole' | 'userRoles', ...)`, then `await next()`.
`hubAppAuthMiddleware` calls it, and so does the dev adapter.
This is what makes acceptance 4 and acceptance 10 true on the API side: the fake identity's roles reach `userRoles` through the REAL `getAppRolesFromHubClaims`, and `orgId` comes from the roster identity's `workspaceId` and from nowhere else.
Nothing on this path reads an org, an account or a workspace off a request body or a query string.

### 2. `apps/api/src/auth/select.ts`, new

Modelled on `/Users/cauetpinciara/Documents/fxl/projects/01--PRODUCT--fxl-finance/apps/api/src/auth/select.ts`, adapted to this repo's taxonomy and to the fact that the seam is being created here rather than extended.

Exports:

- `export const FAKE_IDENTITY_HEADER = 'x-fake-identity';`
- `export function isFakeAuthRequested(env = process.env): boolean`
- `export function isProductionEnv(env = process.env): boolean`
- `export async function installFakeAuthIfRequested(env = process.env): Promise<boolean>`

**The enable flag is `SALES_AUTH_FAKE`.**
The web half's flag is `VITE_AUTH_FAKE`.
PLAN-CHECK RULING, 2026-09-21: this paragraph originally named the web half `VITE_SALES_AUTH_FAKE` and declared itself normative, while slices 03 and 06 both landed `VITE_AUTH_FAKE`.
The tie is broken FOR `VITE_AUTH_FAKE` on this repository's own evidence rather than by averaging.
There is no `VITE_SALES_` variable anywhere in the tree: the web half's repo-owned names are `VITE_API_URL`, `VITE_AUTH_PROXY_TARGET` and `VITE_AUTH_BFF_BASE_PATH`, and the only namespaced ones are the `VITE_FXL_HUB_` mirrors of the SDK's own.
`VITE_AUTH_FAKE` therefore joins the existing `VITE_AUTH_*` family; `VITE_SALES_AUTH_FAKE` would be the single `VITE_SALES_` name in the repository and would invent a second naming scheme inside one file.
The `SALES_` argument below is a NODE-process argument and keeps full force on the API half, where a stray shell export really can leak in from another project; Vite reads its env from the app's own `.env` plus the command line, so the same leak is not available there.
Neither side widens to accept both spellings.
`SALES_` and not a bare `AUTH_FAKE` because this repository already draws that line: `FXL_HUB_` means "the SDK resolves and validates this", and every variable this repo resolves itself carries `SALES_` - `SALES_ENV_FILE`, `SALES_POST_LOGIN_REDIRECT`, `SALES_POST_LOGIN_ERROR_REDIRECT`, `SALES_SESSION_ENCRYPTION_IKM`.
A bare `AUTH_FAKE` would be the only unprefixed repo-owned name in the tree and would be the one an operator is most likely to have left exported in a shell from another project.

Accepted truthy spellings, and no others: `1`, `true`, `yes`, `on`, compared after `.trim().toLowerCase()`.
Absent, empty, `0`, `false` and anything else are OFF.
A missing flag is NOT an error, because the overwhelmingly common case is the Hub adapter and it stays the default.

`isProductionEnv` compares `(env.NODE_ENV ?? '').trim().toLowerCase() === 'production'`.

PLAN-CHECK CONSTRAINT, 2026-09-21, because slice 05's guard SCANS this file: `select.ts` must keep
BOTH the literal `'production'` and a statement matching
`throw new Error(<something>DEV_IDENTITY_ADAPTER_IN_PRODUCTION_MESSAGE<something>)` in its own
source, in the comment-stripped text.
Step 3 of `installFakeAuthIfRequested` already writes exactly that as
`throw new Error(appAuth.DEV_IDENTITY_ADAPTER_IN_PRODUCTION_MESSAGE);`.
Hoisting the message into a local alias, or moving the throw out of this file, disarms slice 05's
test 7 rather than merely restyling it.

The package is declared STRUCTURALLY and never imported by name at module scope:

```
interface FakeIdentityRef { id: string; label: string }

interface FakeIdentityModule {
  IDENTITIES: readonly FakeIdentityRef[];
  DEFAULT_IDENTITY_ID: string;
  findIdentity(id: string | undefined | null): FakeIdentityRef | undefined;
  findIdentityByAccountId(accountId: string | undefined | null): FakeIdentityRef | undefined;
  readTokenSubject(token: string | null | undefined): string | null;
  readTokenWorkspaceId(token: string | null | undefined): string | null;
  identityHasWorkspace(identity: FakeIdentityRef, workspaceId: string): boolean;
  toHubAuthContext(
    identity: FakeIdentityRef,
    options?: { organizationId?: string },
  ): MinimalHubAuthContext;
}
```

Deliberate, and copied from Finance with its reasoning intact: any `import` naming the package, a type-only one included, would make slice 07's "no static import" rule a judgement call about which import forms the compiler erases instead of an absolute.
A boundary that protects production authentication must not need a reviewer to know that.
The few duplicated lines drift visibly and immediately, in the only place this code ever runs.

If slice 01 shipped those members under different names, the executor changes ONLY this interface and the destructuring that reads it, records the real names in this file, and does not touch `packages/auth-fake`.

`installFakeAuthIfRequested` runs in this exact order, and the order is load-bearing:

1. `if (!isFakeAuthRequested(env)) return false;` - and it evaluates nothing further, which is what makes the flag-absent path byte-equivalent to today's module evaluation order.
2. `const appAuth = await import('../middleware/app-auth.js');` - DYNAMIC, so that step 1's early return really does import nothing new. A static import here would pull `app-auth.ts`'s module-scope Hub-config resolution forward in `server.ts`'s evaluation order for every boot, flag or no flag.
3. `if (isProductionEnv(env)) throw new Error(appAuth.DEV_IDENTITY_ADAPTER_IN_PRODUCTION_MESSAGE);` - BEFORE the package import, so production's error names the real cause.
4. `const fake = (await import('@fxl-sales/auth-fake')) as unknown as FakeIdentityModule;` - DYNAMIC, so the package never enters the production build graph. In an image built without devDependencies this rejects, which is the intended last line of defence.
5. `appAuth.installAppAuthAdapter(buildFakeAuthMiddleware(appAuth, fake));`
6. One `console.warn` naming the active roster, the default id and the header, then `return true`.

### 3. The dev middleware itself

Built by a module-local `buildFakeAuthMiddleware`, a `createMiddleware` handler resolving the identity in this order, most explicit first:

1. the `x-fake-identity` header, trimmed - how curl and the API's own tooling pick one;
2. the bearer token's `sub`, through `fake.readTokenSubject` - how the SPA picks one;
3. `fake.DEFAULT_IDENTITY_ID`.

PLAN-CHECK ADDITION, 2026-09-21 - THE ACTIVE ORGANIZATION, which the original draft did not resolve.

Once the identity is known, the ACTIVE Organization is resolved separately, because the browser can
change it without changing the identity: `MissingEntitlementPanel` and the account dropdown both
call the app's one `setActive`, which re-mints a token carrying a DIFFERENT `workspaceId` for the
SAME `sub`.
Resolving `orgId` from `identity.activeWorkspaceId` alone would serve the operator the ORIGINAL
Organization's rows while the browser shows the one they just switched to, which is a tenancy
divergence and would make the 402 escape look like it worked while changing nothing.

So, in this order:

1. when a bearer token is present, `fake.readTokenWorkspaceId(token)`;
2. otherwise `identity.activeWorkspaceId`.

A `workspaceId` that `fake.identityHasWorkspace(identity, workspaceId)` refuses is answered
`401 {"error":"unauthorized","code":"unknown_fake_workspace"}` and NEVER falls back to the
identity's own Organization.
That refusal is the membership RAIL and it is the same predicate the package applies when minting,
so the browser and the API cannot disagree about which Organizations an identity may adopt.
It is also what keeps acceptance 10 true: the org is read off the presented TOKEN and checked
against the roster, never off a request body or a query string, and an unlisted value is refused
rather than trusted.
`toHubAuthContext(identity, { organizationId })` is what builds the context, so `orgId` still comes
from one producer.

**Why the bearer fallback is required here and is not merely inherited from Finance.**
`apps/web/src/lib/api-client.ts` was read for this slice and it has the same property Finance's has: `apiFetch` and `apiFetchBlob` always send `Authorization: Bearer ${token}` and nothing else identity-bearing, and `token` is a REQUIRED non-empty string that `assertBearerToken` checks before `fetch`.
A header-driven design would force every call site, or the shared client, to grow a dev-only branch, which `CLAUDE.md` forbids in spirit and slice 03 cannot pay for.
So the SPA keeps sending an ordinary bearer and the API reads the `sub`.

**Contract with slice 03, written down here because the two slices are planned in parallel.**
The browser under dev-fake NEVER calls `/auth/refresh` and never reaches a BFF.
It mints a token locally from the roster and hands it to the untouched `apiFetch`.
The token is an unsigned JWT-shaped string whose payload is that identity's full `HubTokenClaims`, so `apps/web/src/auth/claims.ts`'s `getRolesFromHubClaims` reads it on the real path and this middleware reads its `sub`.
`mintDevToken(identity, options?)` and `readTokenSubject(token)` are the two halves and both belong to slice 01's package, so there is exactly one implementation of the format.
Nothing verifies a signature under dev-fake, which is precisely why the flag refuses production.

Once an identity is resolved, the middleware reproduces the SDK's own entitlement decision over the fake claims and then delegates to `applyHubAuthContext`.
It does NOT call `requireHubAuth`, because there is no Hub, no discovery document and no JWKS to verify against; and it does not weaken the real gate, because the real gate is untouched on its own path and this branch is unreachable without `SALES_AUTH_FAKE`.

**The deny answers, chosen deliberately against the documented taxonomy.**

| case | answer | why it cannot be mistaken for a real one |
| --- | --- | --- |
| unknown identity | `401 {"error":"unauthorized","code":"unknown_fake_identity","requested":<string>,"available":[...]}` | `401` is exactly right by the taxonomy: a token this app cannot use, whose only answer is a fresh login. A roster id that does not exist IS an invalid token. The `code` is a string the Hub never mints, so the two are distinguishable in a log, and the web half is unaffected because `isAuthFailure` keys on the STATUS alone. A silent fallback to the default identity was rejected: a typo in the dev switcher must be visible, not quietly resolved to somebody else. |
| `entitlements.access === false` | `402 {"error":"payment_required","code":"no_org_access"}` | Byte-identical to what `requireHubAuth` returns natively, because it means the identical thing: a well-formed token whose Organization has no access. This is what makes acceptance 3's sixth identity render `MissingEntitlementPanel` and not the generic server-fault copy. `isEntitlementFailure` keys on `status === 402` alone, so it classifies correctly even if the body were mangled in transit. |
| `entitlements` absent, or `access` not a boolean | `401 {"error":"unauthorized"}` | The faithful mirror of the recorded behaviour change: the SDK validates the token against the contract BEFORE the entitlement gate runs, so such a token is not well-formed and gets a `401`, never a `402`. The roster's type forbids this state; the branch exists so the fake path cannot be laxer than the real one. |
| `403` | never emitted | No route mounts `requiredModule` and the dev adapter grants no module. `requireAdmin` keeps answering its own `403` from `userRole`, which `applyHubAuthContext` set through the real translation. |
| `503 hub_auth_not_configured` | never emitted on the dev path | The dev adapter REPLACES the middleware, so the 503 branch is bypassed while the flag is on. That branch stays alive, unchanged, for the case it exists for: a machine with no credentials and no dev-fake flag. `app-auth-unconfigured.test.ts` is its oracle and stays byte-unchanged. |

### 4. `apps/api/src/server.ts`, two lines

Inserted AFTER the `if (env.NODE_ENV !== 'production') { ... }` boot-line block and BEFORE the first pre-existing `await import('@hono/node-server')`:

```
const { installFakeAuthIfRequested } = await import('./auth/select.js');
await installFakeAuthIfRequested();
```

That placement is chosen against three constraints and the executor must not move it.

It sits strictly AFTER the database guard's `process.exit(1)`, so the ordering property `CLAUDE.md` spells out at length is untouched: a remote `DATABASE_URL` still prints the three `[local-database-guard]` lines and exits with no auth output and no `HubConfigError` ahead of them.
It is reached through `await import(...)` like everything else below the guard, so `server.ts` still statically imports ONLY `./env.js` and `./db/local-database-guard.js`, and `scripts/__tests__/local-database-guard.test.mjs` is unaffected.
With the flag absent, `installFakeAuthIfRequested` returns at its first statement and evaluates nothing, so the existing dynamic import list keeps its exact original order and its original binding names, which is the other half of that same rule.
With the flag present, `app-auth.js` evaluates one step earlier than it does today, which is harmless: the guard has already spoken, and `app-auth.js` is the module `server.ts` would have imported a few lines later anyway.

It sits BEFORE any router mounts, so no route can ever capture a stale adapter.
The dispatcher makes that moot today because it reads the slot per request, but the ordering is stated so that a future refactor which captures the value at mount time does not silently break.

### 5. What happens to the BFF mount

`createAppAuthBff()` and its `if (authBff) app.route('', authBff)` block are BYTE-UNCHANGED, and the dev-fake flag does not read them.

`createAppAuthBff()` already returns `null` when `hubSdkConfig` is null, and `tryLoadHubAuthConfig` returns `null` exactly when `hubConfigIsAbsent` is true.
A dev-fake machine is the archetypal such machine: both `.env` examples ship all five identity variables BLANK, so a fresh clone has no credentials at all.
The consequence is that under `make dev-fake` the BFF is simply not mounted and `/auth/*` answers `404`.
That is the honest shape of this boot rather than a special case: the BFF is pure OAuth machinery, nothing under dev-fake performs the round trip, and mounting it would mean resolving the very Hub contract that is unavailable.

Note the precise causality, because it is easy to record it wrong.
The `404` is a consequence of having NO Hub credentials, not of the flag.
A developer who happens to have the five identity variables set AND turns the flag on gets a mounted, working BFF that the web half never calls, and a dev adapter on `/api/*`.
That is deliberate: making the flag also suppress the BFF would give one variable a second responsibility and would put a new branch into `server.ts`'s mount block, and there is no case that needs it.

A PARTIAL identity configuration is still a boot failure, exactly as v3.1.0 made it, and dev-fake does not rescue it.
Three of five is a misconfiguration rather than an unconfigured machine, and the operator is told which field is missing.
If that bites a dev-fake user, the fix is to blank the stragglers, not to widen this slice.

### 6. `apps/api/package.json`

Add to `devDependencies`, keeping the block alphabetical, immediately before `"@types/node"`:

```
"@fxl-sales/auth-fake": "workspace:*",
```

It is a devDependency and NEVER a dependency.
`pnpm-workspace.yaml` already globs `packages/*`, so no workspace change is needed.
The dynamic import in step 4 of `installFakeAuthIfRequested` is what keeps it out of the production graph: a production install resolves no devDependencies, the specifier is never reachable from a static import chain, and the `import()` rejects loudly rather than authenticating anyone.

### 7. `apps/api/test/unit-setup.ts`

Add `'SALES_AUTH_FAKE'` to the existing blanking list, beside `'SALES_ENV_FILE'`, and extend that file's comment with one sentence saying why.
It is the same class of leak the `SALES_ENV_FILE` paragraph already describes: a developer who exports the flag in their shell would otherwise decide the unit suite, and the suite must be decided by its own fixtures.
Blank reads as absent, because the truthy set does not contain the empty string.

## Oracles

Three new files, all under `apps/api/src/auth/__tests__/`, all inside the unit suite's `src/**/__tests__/**/*.test.ts` include glob.

None of them carries a STATIC import of `@fxl-sales/auth-fake`.
Where a test needs a roster id it reads it through `await import('@fxl-sales/auth-fake')`, so the files satisfy slice 07's isolation guard whatever pathspec that guard ends up with.

### `dev-identity-flag.test.ts`

Pure, environment-free, no module graph.
`accepts exactly 1, true, yes and on, case-insensitively and after trimming`.
`treats absent, blank, 0 and false as off`.
`recognizes production only as the exact NODE_ENV value, trimmed and lowercased`.

### `dev-identity-production-refusal.test.ts` - ORACLE for the production refusal

Stubs `NODE_ENV=production` and `SALES_AUTH_FAKE=1`, with every Hub variable blank, then `vi.resetModules()`.

- `refuses to install the development identity adapter under NODE_ENV=production`: `await expect(installFakeAuthIfRequested()).rejects.toThrow(...)`, asserting the message is `toBe(DEV_IDENTITY_ADAPTER_IN_PRODUCTION_MESSAGE)` imported from `../../middleware/app-auth.js`. The SAME constant the implementation throws, shared rather than restated, so the two refusals cannot drift into saying different things about one rule.
- `refuses a direct installAppAuthAdapter call too, so the slot is not safe only because the caller checked first`: calls `installAppAuthAdapter` with a trivial handler and asserts the same message.
- `leaves the adapter slot empty, so appAuthMiddleware still answers on the Hub path`: mounts `appAuthMiddleware` on a probe and asserts `503 {"error":"unavailable","code":"hub_auth_not_configured"}`. This is the assertion that makes the file a real oracle rather than a message check: it proves the fake adapter did not take the slot, so deleting the `isProductionEnv` throw turns it RED on a status rather than on a string.

### `dev-identity-no-hub.test.ts` - ORACLE for the Hub-free authenticated request

Built on the exact template of `app-auth-unconfigured.test.ts`, which is the file in this repo that already knows how to establish a credential-free module graph.

`beforeAll` does, in this ORDER, and the order is load-bearing:

1. `vi.resetModules()`.
2. `vi.stubEnv` for `NODE_ENV='test'`, `SALES_AUTH_FAKE='1'`, `CORS_ORIGIN`, `DATABASE_URL`, and every one of `FXL_HUB_CONFIG`, `FXL_HUB_API_URL`, `FXL_HUB_ENVIRONMENT`, `FXL_HUB_CLIENT_ID`, `FXL_HUB_CLIENT_SECRET`, `FXL_HUB_AUDIENCE`, `FXL_HUB_HEALTH_TOKEN`, `FXL_HUB_REDIRECT_URI`, `FXL_HUB_TRUSTED_ORIGINS` set to `''`.
3. `const { installFakeAuthIfRequested } = await import('../select.js'); expect(await installFakeAuthIfRequested()).toBe(true);`
4. `const appAuth = await import('../../middleware/app-auth.js');` - AFTER the install, never before.
5. Mount a probe route behind `appAuth.appAuthMiddleware` that echoes `userId`, `orgId`, `userRole` and `userRoles`.

Step 4 must come after step 3 and both must come after step 2's `vi.resetModules()`.
`installAppAuthAdapter` writes module state on ONE instance of `app-auth.js`, and `select.ts` reaches it through `'../middleware/app-auth.js'` while the test reaches it through `'../../middleware/app-auth.js'`; those resolve to the same module id, but only if neither was evaluated before the reset.
An import hoisted above the reset gives the test a different instance with an empty slot, and every case below then fails on a `503` for a reason that has nothing to do with what is being tested.

Tests, by title:

- `serves an authenticated request with no Hub configuration at all, picked by the x-fake-identity header` - `200`, and the echoed `orgId` equals that roster identity's `workspaceId` while `userRoles` equals what `getAppRolesFromHubClaims` yields for its claims. This is the acceptance-1 oracle.
- `resolves the identity from the bearer sub when no dev header is sent, so the shared api client needs no dev-only branch` - sends only `Authorization: Bearer <mintDevToken(a non-default identity)>` and asserts that identity's `orgId`, not the default's. The `not the default's` half is what makes the test non-vacuous.
- `answers 402 payment_required no_org_access for an identity whose Organization carries no access` - `toEqual({error: 'payment_required', code: 'no_org_access'})`, byte-exact.
- `answers 401 unknown_fake_identity rather than silently adopting the default identity` - `401`, and the body carries no `orgId` and the probe handler never ran.
- `serves the Organization the token names, not the identity's default, so a switch really switches` - PLAN-CHECK ADDITION. Sends only `Authorization: Bearer <mintDevToken(multiOrg, {organizationId: 'org_fake_sul'})>` and asserts the echoed `orgId` is `org_fake_sul` and NOT the identity's `activeWorkspaceId`.
- `answers 401 unknown_fake_workspace for a token naming an Organization the identity does not belong to` - PLAN-CHECK ADDITION. Hand-mints a token whose `workspaceId` is an Organization outside that identity's `workspaces` and asserts `401` with that code, and that the probe handler never ran. The decisive mutation is deleting the `identityHasWorkspace` check, which would serve the unlisted org instead.
- `never reads an org, an account or a workspace off the request body` - sends `{"orgId":"other-org","workspaceId":"other-org","accountId":"someone-else"}` as a POST body under a valid identity and asserts the echoed `orgId` is still the identity's own. This is the acceptance-10 oracle and it is cheap.
- `does not contact any Hub` - installs a `vi.stubGlobal('fetch', ...)` that throws on any call, for the whole file, and the cases above still pass. Proves the claim in the slice title rather than assuming it.

## Non-vacuity

The two mutations the verifier must run, both named in `verifier_focus`:

Deleting the `isProductionEnv` throw from `installFakeAuthIfRequested` must turn `dev-identity-production-refusal.test.ts` RED, and it turns red on the `503` probe as well as on the message, so a fix that keeps the message and loses the refusal cannot pass.

Deleting the `entitlements.access !== true` branch from `buildFakeAuthMiddleware` must turn the `402` case RED.
That mutation is the one that would let the sixth roster identity through as fully entitled, which would make acceptance 3's `MissingEntitlementPanel` branch unreachable from the browser while every other test stayed green.

## Out of scope

The web half, the identity switcher, `import.meta.env.DEV` dead-code elimination and the `VITE_AUTH_FAKE` read are slice 03's.
The roster, the claims shape, `mintDevToken` and `readTokenSubject` are slice 01's.
The tracked-file isolation guard is slice 05's, and this slice is written so that guard needs no exemption for any file it touches.
The `make dev-fake` targets, the seed and the `CLAUDE.md` reconciliation of the parked slice 05 prohibition belong to their own slices.
