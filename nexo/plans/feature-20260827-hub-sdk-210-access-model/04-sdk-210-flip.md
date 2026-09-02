---
id: 04-sdk-210-flip
milestone: v2.8.0
status: parked
depends_on: [01-session-store-read-contract, 02-explicit-hub-config, 03-access-entitlement-gate]
files_modified: [apps/api/package.json, apps/web/package.json, pnpm-lock.yaml, apps/api/src/env.ts, apps/api/src/config/auth-provider.ts, apps/api/src/config/hub-config.ts, apps/api/src/config/__tests__/hub-config.test.ts, apps/api/src/middleware/app-auth.ts, apps/api/src/auth/hub-session-store.ts, apps/api/src/auth/hub-rotated-cookie.ts, apps/api/src/auth/hub-bff-origin.ts, apps/api/src/auth/hub-login-scope.ts, apps/api/src/config/__tests__/auth-provider.test.ts, apps/api/src/middleware/__tests__/app-auth.test.ts, apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts, apps/api/src/middleware/__tests__/app-auth-bff-memory-path.test.ts, apps/api/src/middleware/__tests__/app-auth-bff-production-boot.test.ts, apps/api/src/middleware/__tests__/app-auth-access-gate.test.ts, apps/api/src/middleware/__tests__/app-auth-sdk-gate-wiring.test.ts, apps/api/src/auth/__tests__/hub-session-store.test.ts, apps/api/src/auth/__tests__/hub-bff-origin.test.ts, apps/api/src/auth/__tests__/hub-login-scope.test.ts, apps/api/src/auth/__tests__/hub-contract-types.test.ts, apps/api/src/auth/__tests__/hub-auth-context-fixture.ts, apps/api/src/domains/sales-ops/__tests__/routes.test.ts, apps/api/src/domains/sales-ops/__tests__/history-route.test.ts, apps/api/test/rls/hub-bff-session-store.test.ts, apps/api/test/rls/hub-bff-login-supersede.test.ts, apps/api/.env.example, apps/api/.env.dev.example, apps/web/src/auth/provider.ts, apps/web/src/auth/react.tsx, apps/web/src/auth/__tests__/provider.test.ts, apps/web/src/auth/__tests__/react.test.tsx, apps/web/src/__tests__/session-journey.test.tsx, apps/web/src/__tests__/route-error-and-auth-context.test.tsx, apps/web/src/sales-ops/__tests__/session-loss-keeps-route.test.tsx, apps/web/src/lib/api-client.ts, apps/web/src/lib/require-token.ts, apps/web/src/lib/__tests__/api-client-token-guard.test.ts, apps/web/src/sales-ops/MissingEntitlementPanel.tsx, apps/web/src/sales-ops/SalesOpsApp.tsx, apps/web/src/sales-ops/__tests__/entitlement-dead-end.test.tsx, apps/web/src/sales-ops/__tests__/missing-entitlement-panel.test.tsx, apps/web/.env.example, apps/web/.env.dev.example, packages/shared-types/src/env.ts, CLAUDE.md, README.md, nexo/ROADMAP.md]
acceptance: "given both apps resolve @fxl-business/hub-sdk 2.1.0, when the full suite, lint, type-check and a real build run, then all are green, the BFF boots with a required session store and an explicit redirect URI on this app's own origin, the rotated-cookie wrapper and the origin shim are both still exercised and green, and no test was weakened"
goal: "Bump both apps to hub-sdk 2.1.0 and honour every 2.x contract in one atomic slice"
must_not_break:
  - "createHubRotatedCookieFetch and its non-vacuity oracle, since 2.1.0 did not fix the regex"
  - "createHubBffOriginShim and its CSRF bypass tests, since the guard is still hardcoded"
  - "the app's own renewal timer, revalidation ladder, logout intent and queryClient flush rules"
  - "FXL_HUB_REDIRECT_URI resolving to this app's own origin, never the Hub's"
  - "the hono 4.12.28 workspace override that keeps a single Hono copy"
rules:
  - "no em dash and no en dash on any added line"
  - "no credential value may be invented, guessed or placeheld"
  - "no network call to the Hub"
  - "the SDK's proactive browser renewal is not adopted"
verifier_focus: "that nothing was weakened to make the bump compile, that the rotated-cookie and origin-shim protections are still genuinely exercised, and that no secret reaches a log or the health endpoint"
---

# 04 - sdk-210-flip

## What this slice is

One atomic commit that moves both apps from `@fxl-business/hub-sdk@^1.3.1` to
`@fxl-business/hub-sdk@2.1.0` and honours every 2.x contract. It is atomic because the
version bump breaks `apps/api` and `apps/web` compilation at the same instant: there is no
intermediate state where `master` is green.

Slices 01, 02 and 03 staged three of the four moving parts. This slice finishes them and
deletes the adapters they left behind:

- 01 gave the store transaction a `read()` beside its `get()` and put `kind` on the store
  object. This slice DELETES `get()`.
- 02 made the Audience and the environment explicit configuration and accepted
  `FXL_HUB_CONFIG`. This slice deletes 02's VENDORED PARSER and calls the SDK's
  `loadHubConfig` instead. Everything 02 built around that parser survives; see section 2.0.
- 03 replaced the `<slug>.core` module gate with `entitlements.access`. This slice moves the
  four contract types onto the SDK's own declarations so that gate is type-checked rather
  than typed `any`.

Nothing in this slice invents a credential. Nothing in this slice calls the Hub.

## Preconditions the executor must assert before touching anything

Run these first. If any fails, STOP and report; do not adapt around it.

```bash
cd /Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales

# 1. Slices 01, 02 and 03 are merged.
git log --oneline -20

# 2. Slice 01 left read() on the transaction handle.
grep -n 'read: async\|read()' apps/api/src/auth/hub-session-store.ts

# 3. Slice 01 put kind on the store object, not only on the factory envelope.
grep -n "readonly kind" apps/api/src/auth/hub-session-store.ts

# 4. Slice 03 removed every core-module read from PRODUCTION source.
git grep -n -i "sales\.core" -- apps packages scripts ':!*__tests__*'   # must print nothing
git grep -n "coreModule" -- apps packages scripts ':!*__tests__*'       # must print nothing

# 5. Slice 02 renamed the discrete env vars to the SDK's names.
grep -n 'FXL_HUB_CLIENT_ID\|FXL_HUB_CLIENT_SECRET\|FXL_HUB_ENVIRONMENT' apps/api/src/env.ts

# 6. The suite is green on master before the bump.
pnpm run lint && pnpm run type-check && pnpm test && pnpm run build
```

Precondition 4 excludes `__tests__` deliberately, and that exclusion is not laziness. Slice 03
keeps exactly two `sales.core` literals in TEST fixtures on purpose - they are the defect
INVERTED, proving that a token still carrying the retired module is not thereby granted access -
and slice 03's own gate carries the same exclusion. A gate that failed on those two would make
this slice stop on its predecessor's best oracle.

If step 5 comes back empty, slice 02 kept `FXL_HUB_PUBLISHABLE_KEY` / `FXL_HUB_SECRET_KEY`.
In that case this slice performs the rename as part of section 2 below, exactly as written;
do not leave the old names, because `loadHubConfig` reads only the five names in
`DISCRETE_ENV_VARS` and would see an empty config.

---

## 1. The version bump, and the hono peer range

### 1.1 What to change

`apps/api/package.json` dependencies:

```json
"@fxl-business/hub-sdk": "2.1.0",
```

`apps/web/package.json` dependencies:

```json
"@fxl-business/hub-sdk": "2.1.0",
```

EXACT, not `^2.1.0`. Two reasons, both concrete. The acceptance line for this feature says
"both apps resolve `@fxl-business/hub-sdk` 2.1.0", and an exact pin is the only spelling
that keeps that true after an unrelated `pnpm install`. And the sibling package taken in
slice 05, `@fxl-business/hub-sdk-testing@2.1.0`, peer-requires the SDK at an EXACT `2.1.0`,
so a caret range here would make slice 05 an unsatisfiable peer the moment 2.2.0 publishes.

Then:

```bash
pnpm install
```

`pnpm-lock.yaml` must update in the same commit.

### 1.2 The hono peer range: NO CHANGE, and here is the arithmetic

The 2.1.0 tarball declares:

```json
"peerDependencies": { "hono": ">=4.12.28" }
```

Open ended, no upper bound. `pnpm-workspace.yaml` carries `overrides: { hono: 4.12.28 }` and
`apps/api/package.json` declares `"hono": "4.12.28"`. `4.12.28` satisfies `>=4.12.28`.

Therefore: DO NOT touch the `hono: 4.12.28` override, and DO NOT touch
`apps/api/package.json`'s `hono` entry.

CLAUDE.md explains why the override exists and it is unchanged by 2.1.0: `.npmrc` sets
`strict-peer-dependencies=false`, so without the override pnpm is free to resolve a SECOND
Hono copy under the SDK, and the BFF's `Context` then stops being the one `apps/api/src/server.ts`
composes with. `c.set('userId', ...)` in one copy is invisible to `c.get('userId')` in the other.

Assert it after install:

```bash
pnpm why hono | grep -c '4\.12\.28'          # every hono line is 4.12.28
pnpm ls --depth=Infinity 2>/dev/null | grep -c 'hono 4\.' # no second major
node -e "console.log(require('@fxl-business/hub-sdk/package.json').version)" # 2.1.0
```

If a future SDK ever raises the floor above `4.12.28`, the correct change is to raise BOTH
the `overrides` entry in `pnpm-workspace.yaml` AND `apps/api/package.json`'s `hono` to the
same exact version in the same commit. Raising one and not the other reintroduces the two
copies. That is not needed for 2.1.0.

---

## 2. The config parser: delete this repo's VENDORED copy, keep every gate around it

### 2.0 What this section does and does NOT do

This slice delegates ONE thing to the SDK: the PARSER. Slice 02 hand-wrote a backport of
`parseHubConfig` / `loadHubConfig` / `HubConfigError` in `apps/api/src/config/hub-config.ts`
precisely so it could ship its architecture on `1.3.1`, and it said in its own words that
slice 04 swaps that module for the real one. That swap is one import line.

Everything slice 02 built AROUND the parser SURVIVES this slice untouched:
`hubEnvBag`, `hubConfigPresence`, `HUB_DISCRETE_ENV_VARS`, `HubEnvSource`, `HubAuthConfig`,
and above all the ABSENCE of any blanket `try/catch` in `auth-provider.ts`.

That is not a preference, it is an acceptance criterion. `00-OVERVIEW.md` accepts on
"the API refuses to boot and names the offenders" and "the API refuses to boot, offline".
A blanket catch that turns a `HubConfigError` into `null` turns both of those into a running
API answering `503` to everything, and it is exactly the plausible-looking fallback the SDK's
own `assertBootConfiguration` docstring says the 2.x release exists to remove.

So, explicitly, this slice:

- does NOT reinstate a blanket `try/catch` in `auth-provider.ts`;
- does NOT re-introduce an `EnvLike` parameter on the loaders;
- does NOT hand raw `process.env` to `loadHubConfig`, and does NOT spell
  `resolveHubRedirectUri(process.env)`. Raw `process.env` stays out of that file, exactly as
  slice 02 left it;
- does NOT delete `HubAuthConfig`.

Consequently slice 02's named tests 19, 20, 21, 22, 23, 24 and 25 all SURVIVE this slice
unchanged, and section 17 below lists none of them as an edit. Test 20,
`refuses to boot on a product. audience rather than answering 503`, is the oracle that fails
the moment anyone reinstates the catch, and it must still be ABLE to fail after this slice.

### 2.1 `apps/api/src/config/auth-provider.ts` - the ONE line that changes

Slice 02 left the file importing its own backport:

```ts
import { type HubConfig, HubConfigError, loadHubConfig } from './hub-config.js';
```

Change it to the real thing, and nothing else in the file:

```ts
import { HubConfigError, loadHubConfig, type HubConfig } from '@fxl-business/hub-sdk';
```

`HubConfigError`, `loadHubConfig` and `HubConfig` all exist on the 2.1.0 root subpath
(`dist/index.d.ts` re-exports them from `dist/config-CxunTdjI.d.ts`, where `loadHubConfig` is
declared at `:67`, `parseHubConfig` at `:52` and `HubConfigError` at `:35`). Slice 02 chose
the backport's names to be byte-identical to the SDK's for exactly this moment.

The file's exported surface after this slice is UNCHANGED from slice 02 plus slice 03's
`coreModule` deletion:

```ts
export const HUB_DISCRETE_ENV_VARS: readonly string[];
export type HubEnvSource = Pick<Env, ...>;
export type HubAuthConfig = HubConfig & { healthToken: string | undefined };
export function hubEnvBag(source: HubEnvSource): Record<string, string | undefined>;
export function hubConfigPresence(bag: Record<string, string | undefined>): HubConfigPresence;
export function loadHubAuthConfig(bag: Record<string, string | undefined>): HubAuthConfig;
export function tryLoadHubAuthConfig(bag: Record<string, string | undefined>): HubAuthConfig | null;
```

`loadHubAuthConfig`'s body keeps its `FXL_HUB_HEALTH_TOKEN` gate and its
`return { ...config, healthToken };`. `tryLoadHubAuthConfig` keeps its three lines and its
comment: `hubConfigPresence` may THROW on ambiguity and is not caught, `absent` and
`incomplete` return `null`, and `loadHubAuthConfig` may THROW and is not caught.

Two things the executor must check while making this one-line change, because both are
places the SDK could differ from the backport in a way that only shows up at runtime:

- `HubConfigError` must still expose the `field` property slice 02's tests assert on. The
  SDK declares it at `dist/config-CxunTdjI.d.ts:35`; if the shape differs, the tests are
  right and the adapter is wrong - do not loosen an assertion to fit.
- `loadHubConfig` reads ONLY the five discrete names plus `FXL_HUB_CONFIG`, so
  `hubEnvBag`'s twelve-key projection is a strict superset and passing it whole is correct.
  The extra seven keys are ignored by the SDK and are what `resolveHubRedirectUri` and the
  health-token gate read out of the same bag.

There is a real behavioural overlap here and it is deliberate: the SDK's own `loadHubConfig`
also refuses `FXL_HUB_CONFIG` beside a discrete variable. `hubConfigPresence` keeps its own
check anyway, ahead of the SDK's, because it is the check that runs on the `incomplete`
discrete bag too, where `loadHubConfig` is never reached. Slice 02's test 19 asserts the
error names every offender; if the SDK's message and the local one ever disagree, the LOCAL
one wins because it fires first, and that is what the test pins.

### 2.2 `apps/api/src/env.ts` - the declared surface

The Hub block of the zod schema is what slice 02 left, plus `FXL_HUB_HEALTH_TOKEN` if slice
02 did not already add it. Every entry stays `emptyToUndefined` / `emptyToUndefinedUrl` and
NOTHING here re-validates the Hub shape: the SDK's `parseHubConfig` is the single authority,
and a second validator would give two different error messages for one mistake.

```ts
  FXL_HUB_CONFIG: emptyToUndefined,
  FXL_HUB_API_URL: emptyToUndefinedUrl,
  FXL_HUB_ENVIRONMENT: emptyToUndefined,
  FXL_HUB_CLIENT_ID: emptyToUndefined,
  FXL_HUB_CLIENT_SECRET: emptyToUndefined,
  FXL_HUB_AUDIENCE: emptyToUndefined,
  FXL_HUB_HEALTH_TOKEN: emptyToUndefined,
  FXL_HUB_REDIRECT_URI: emptyToUndefinedUrl,
  FXL_HUB_POST_LOGIN_REDIRECT: emptyToUndefinedUrl,
  FXL_HUB_POST_LOGIN_ERROR_REDIRECT: emptyToUndefinedUrl,
  HUB_SESSION_ENCRYPTION_KEY: emptyToUndefined,
```

If `FXL_HUB_PUBLISHABLE_KEY` or `FXL_HUB_SECRET_KEY` somehow survived slice 02, DELETE them
here. If slice 02 already declared `FXL_HUB_HEALTH_TOKEN`, this block is a no-op and that is
the expected outcome; verify rather than re-add.

`env.ts`'s `emptyToUndefined` normalises `''` to `undefined` on the VALIDATED object, and
`hubEnvBag` projects off that validated object, so a blank `FXL_HUB_AUDIENCE=` never reaches
the SDK as `''` - it reaches `hubConfigPresence` as absent and yields `incomplete`, which is
the 503 an unconfigured machine already gets. A hand-built test bag that spells `''`
literally is handled by `hubConfigPresence`'s own `isSet` check.

The dotenv ordering invariant stays: `apps/api/src/middleware/app-auth.ts` must keep its
`import { env } from '../env.js';` line, because that import is what runs dotenv before the
module-top-level `tryLoadHubAuthConfig(hubEnvBag(env))` call, and because `env` is now the
SOURCE of that bag rather than merely a side effect.

---

## 3. `createHubBff` options - the exact final call

In `apps/api/src/middleware/app-auth.ts`, `createAppAuthBff()`.

### 3.1 The environment boolean, and why there are now two

There are two different predicates and they must not be collapsed:

- `hubConfig.environment` is the HUB's environment. It is what the SDK's
  `assertBootConfiguration` tests, so it and only it decides `insecureCookies`,
  `allowEphemeralSessionStore` and whether `healthToken` is required.
- `process.env.NODE_ENV` is THIS deployment's mode. It stays the predicate for
  `createHubSessionStore`'s own "DATABASE_URL is required in production" refusal, because
  that rule is about this repo's storage and not about the Hub.

Write it as:

```ts
  const hubConfig = hubAuthConfig;                      // HubAuthConfig, already non-null here
  const isHubDevelopment = hubConfig.environment === 'development';
  // ONE boolean still drives both the SDK's cookie name and our own cookie read, but it is
  // now derived from the Hub environment rather than from NODE_ENV, because 2.1.0's
  // assertBootConfiguration refuses `insecureCookies` outside `environment === 'development'`.
  const secureCookies = !isHubDevelopment;
```

`secureCookies` stays a named local because `createHubLoginSupersedeMiddleware` consumes it
and `hubSessionCookieName(secureCookies)` must keep agreeing with the SDK's own
`secure ? SESSION_COOKIE_SECURE : SESSION_COOKIE`. Do NOT invert `hub-login-scope.ts`; invert
once, here, at the single producer.

### 3.2 The call

```ts
  // Slice 02's twelve-key projection, taken off the VALIDATED env object. It already exists
  // in this function after slice 02; it is repeated here so the call below reads whole. Raw
  // `process.env` does not appear in it. See section 2.0.
  const hubEnv = hubEnvBag(env);

  const session = createHubSessionStore({
    databaseUrlPresent: Boolean(env.DATABASE_URL),
    nodeEnv: process.env.NODE_ENV ?? 'development',
    encryptionIkm: env.HUB_SESSION_ENCRYPTION_KEY ?? hubConfig.clientSecret,
  });

  const bff = createHubBff(hubConfig, {
    // REQUIRED in every environment as of 2.0.0, not only in production.
    sessionStore: session.store,
    // The ONLY route to an in-memory store, and legal only when the Hub environment is
    // development. It is passed as a pair with the memory branch so a production deploy
    // that loses DATABASE_URL fails at boot instead of silently going per-process.
    ...(isHubDevelopment && session.kind === 'memory' ? { allowEphemeralSessionStore: true } : {}),
    // REPLACES secureCookies and is INVERTED. Passed only when true: 2.1.0 refuses
    // `insecureCookies: true` outside development, and passing `false` explicitly outside
    // development is legal but says nothing, so the key is simply absent there.
    // WRITTEN AS A SPREAD ON PURPOSE, and section 16.2's oracle
    // `expect('insecureCookies' in (bffOptions ?? {})).toBe(false)` depends on it. Simplifying
    // this to `insecureCookies: isHubDevelopment` makes the KEY present-and-false outside
    // development, reddens that test, and reads like a test bug when it is not one.
    ...(isHubDevelopment ? { insecureCookies: true } : {}),
    // REQUIRED outside development. Operator-generated, never Hub-issued. See section 9.
    ...(env.FXL_HUB_HEALTH_TOKEN !== undefined ? { healthToken: env.FXL_HUB_HEALTH_TOKEN } : {}),
    // The BACKCHANNEL fetch. Still needed: 2.1.0's parseRotatedRefresh regex is
    // byte-identical to 1.3.1's and still cannot match `__Host-fxl_hub_session`.
    fetchImpl: createHubRotatedCookieFetch(),
    timeoutMs: HUB_BFF_TIMEOUT_MS,
    sessionTtlSeconds: SESSION_TTL_MS / 1000,
    sessionAbsoluteTtlSeconds: SESSION_ABSOLUTE_TTL_MS / 1000,
    // EXPLICIT, never defaulted. 2.1.0 defaults redirectUri to `${config.apiUrl}/auth/callback`,
    // which is the HUB's origin, so the callback would point at the wrong host and the Hub
    // would refuse an unregistered redirect_uri.
    redirectUri: resolveHubRedirectUri(hubEnv),
    postLoginRedirect: resolveHubPostLoginRedirect(hubEnv),
    postLoginErrorRedirect: resolveHubPostLoginErrorRedirect(hubEnv),
  });
```

`now` is still not passed. `postLoginRedirect` and `postLoginErrorRedirect` are unchanged.

One scoping note, because the two rules look like they collide and do not. The
no-raw-`process.env` rule from section 2.0 is scoped to `auth-provider.ts`, which is where the
Hub CONFIG is parsed. `createHubSessionStore`'s `nodeEnv` argument is about THIS deployment's
mode rather than about the Hub, and `hubEnvBag` carries `NODE_ENV` too, so either spelling is
correct there: keep whichever one slice 02 left in place and do not churn it. What must not
happen is a Hub CONFIG field being read off raw `process.env`.

### 3.3 `resolveHubRedirectUri` tightening

Change its return type from `string | undefined` to `string`. It already never returns
`undefined` today: it returns the explicit value, or the development fallback, or throws. The
loose type is the only thing that would let a future edit hand `undefined` to `createHubBff`
and silently take the Hub-origin default.

```ts
export function resolveHubRedirectUri(envBag: Record<string, string | undefined>): string {
```

Keep whatever parameter TYPE slice 02 left on this function; only the RETURN type moves. The three resolvers live in `app-auth.ts` and slice 02 already
feeds them `hubEnvBag(env)`; do not change them back to reading `process.env`.

Leave the body exactly as it is. The development fallback
`${CORS_ORIGIN}/auth/callback` is this app's own origin, which is the invariant.

### 3.4 Do not call `assertBootConfiguration` separately

`createHubBff` calls it internally on entry, with the same five throws. A second explicit
call would only duplicate the failure message.

---

## 4. Delete the transaction handle's `get()`

### 4.1 `apps/api/src/auth/hub-session-store.ts`

Slice 01 added `read()`. Delete the `get:` member from the `handle` object literal inside
`withSession`, so the literal has exactly three members: `read`, `update`, `delete`. Under
`HubSessionTransaction` from 2.1.0 an object literal carrying an extra `get` is an excess
property error, so this is a compile failure the moment the bump lands, not an optional
tidy-up.

Delete any `get` that slice 01 left on `DurableHubSessionStore`'s type or on
`PostgresHubSessionStore`. The store class keeps only what `HubSessionStore` declares plus
`withLoginContext`.

**Delete slice 01's three local type declarations and import the SDK's.** Slice 01 declared
`HubSessionStoreKind`, `HubSessionReadResult` and a local `HubSessionTransaction` in this
file, spelled byte-for-byte like 2.1.0's, and its own plan says slice 04 deletes them and adds
the identifiers to the import. Doing that is not optional tidying: without it the tree carries
TWO definitions of `HubSessionReadResult`, it compiles, nothing goes red, and slice 01's stated
end state is never reached.

- DELETE `export type HubSessionStoreKind = 'ephemeral' | 'persistent';`
- DELETE `export type HubSessionReadResult = ...` (the three-member union).
- DELETE `export interface HubSessionTransaction extends SdkHubSessionTransaction { read(): ... }`
  and the `type HubSessionTransaction as SdkHubSessionTransaction` alias in the import block
  that existed only to write that `extends`.
- Import all three from the SDK root subpath instead. 2.1.0 exports
  `HubSessionReadResult` and `HubSessionStoreKind` from `dist/index.d.ts:3` and
  `HubSessionTransaction` from `dist/index.d.ts:305`; the declarations themselves are at
  `dist/session-store-DOWOoBx8.d.ts:17`, `:30` and `:38`.
- `DurableHubSessionStore` keeps `readonly kind: 'persistent'`, its narrowed `withSession`
  and `withLoginContext`. Those are this repo's own narrowing, not a duplicate of an SDK type.

If any repo module imported one of the three names from `../auth/hub-session-store.js`,
re-point it at `@fxl-business/hub-sdk`. Grep before assuming:

```bash
grep -rn 'HubSessionReadResult\|HubSessionStoreKind\|HubSessionTransaction' apps/api/src apps/api/test
```

Update the file's doc header: it is pinned to `@fxl-business/hub-sdk@1.3.0` today. Re-pin
every version reference to `2.1.0` and re-quote the two behaviour lines it names, which in
2.1.0's `dist/server.js` are:

```js
const read = await tx.read();
...
if (rotated) await tx.update({ ...record, hubRefreshToken: rotated });
```

`InMemoryHubSessionStore.get(id)` is a DIFFERENT thing and is untouched: it is a synchronous
test-only reader on the SDK's own class, not a transaction member.

### 4.2 The rotated-cookie test fixture

`apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts`, `recordingSession()`:

```ts
type RecordedCall = { op: 'read' | 'update' | 'delete'; token?: string };
```

and the `tx` literal:

```ts
  const tx: HubSessionTransaction = {
    read: async () => {
      calls.push({ op: 'read' });
      return record === null ? { status: 'absent' } : { status: 'found', record };
    },
    update: async (next) => {
      calls.push({ op: 'update', token: next.hubRefreshToken });
      record = next;
    },
    delete: async () => {
      calls.push({ op: 'delete' });
      record = null;
    },
  };
```

Every `expect(session.calls).toEqual([{ op: 'get' }, ...])` in the file becomes
`[{ op: 'read' }, ...]`. That is the same assertion with the renamed op; it is NOT a
weakening. There must be no place where an assertion is loosened to `expect.arrayContaining`
or where a `toEqual` becomes a `toMatchObject`.

Also update the `probe: HubSessionStore` literal in the non-vacuity test at the end of the
file: add `kind: 'ephemeral' as const` (2.1.0 requires `kind` and
`assertConformantSessionStore` throws without it), and the `session.tx` it hands out is the
new three-member handle above.

---

## 5. KEEP `createHubRotatedCookieFetch`

2.1.0's `dist/server.js` still reads:

```js
function parseRotatedRefresh(setCookieHeader) {
  if (!setCookieHeader) return void 0;
  const match = /(?:^|[,\s])fxl_hub_session=([^;]+)/.exec(setCookieHeader);
  return match?.[1];
}
```

Byte-identical to the 1.3.1 regex the wrapper was written for. It still cannot match a
`__Host-` prefixed name, because the character before `fxl_hub_session=` is `-`, which is
neither start of string nor a member of `[,\s]`.

### 5.1 Code changes: none

`apps/api/src/auth/hub-rotated-cookie.ts` keeps its behaviour byte for byte:
`assertSetCookieSupport` still runs unconditionally at module load, `readSetCookies` still
throws rather than degrading, the response is still rebuilt rather than mutated, and the
original `Response` is still returned by identity when nothing matched. There is still no
silent fallback.

### 5.2 Docstring changes

Rewrite the header's version-specific paragraphs so a reader learns that 2.1.0 was checked
and did not fix it. Required content, in the file's own voice:

- Re-pin the quoted regex to `@fxl-business/hub-sdk@2.1.0`, `dist/server.js:355-359`.
- State plainly: "2.1.0 did NOT fix this. The regex is byte-identical to 1.3.1's, verified
  against the shipped tarball, so this module stays."
- The delete-signal is UNCHANGED: the non-vacuity test named
  `proves the rotation is genuinely lost without the wrapper, through the same real SDK handler`
  going RED is still the one and only signal that this module has become redundant. Say so
  explicitly, so nobody re-derives it at the next bump.
- REMOVE the now-dead `/auth/switch` sentence at line 11. Replace it with the route that
  actually carries the same defect now: `POST /auth/switch` was deleted in 2.0.0, and
  `setActive` rides `POST /auth/refresh` with `{ organizationId }`. Both an ordinary renewal
  and an Organization switch therefore go through the SAME handler and the SAME
  `parseRotatedRefresh` call, so the rotation pin moves onto `/auth/refresh` with a body and
  must prove that rotation survives an Organization switch. Name the test that does it, whose
  new title is given in section 16.

HOUSE RULE, and this is the section where it is most likely to be broken: the SDK's own
shipped `.d.ts` files contain an em dash (the `session-store` docblock's "a `pg` Pool, a
Drizzle instance ... - anything"). Re-quoting a line number is fine; copying vendor prose is
not. NO line added to a repo file by this slice may carry an em dash or an en dash, and no
vendor comment may be pasted verbatim. Re-word it in this repo's own voice with a plain
hyphen. The same warning applies to section 6.2.

Do not add a claim about what the live Hub sends. The tarball cannot answer whether the Hub
prefixes the rotation cookie; the regex's inability to match it is what is provable and what
the file already says.

### 5.3 Tests

`apps/api/src/auth/__tests__/hub-rotated-cookie.test.ts` (15 tests) is pure fetch-wrapper
behaviour with no SDK config and no transaction. It needs NO change and must stay green,
including `stays correct if the SDK parser is fixed to accept both names`.

The non-vacuity oracle in `app-auth-bff-wiring.test.ts` must stay GREEN, which is the whole
point: green means the defect is still there and the wrapper is still load-bearing. Its only
edits are the `probe` literal (`kind`, `read`) and the inline config literal (section 12).

---

## 6. KEEP `createHubBffOriginShim`

2.1.0's `dist/server.js` still installs a router-wide `app.use('*')` CSRF origin guard:

```js
if (site && site === "cross-site" || origin && origin !== new URL(c.req.url).origin) {
  return c.json({ error: "forbidden" }, 403);
}
```

`CreateHubBffOptions` in 2.1.0 has NO `origin`, `allowedOrigins`, `trustedOrigins`, `csrf`,
`cookieDomain`, `cookieName` or `sameSite` key. There is no configuration escape. The guard
reads nothing from `config` and nothing from `options`.

Production still serves the web app on `sales.fxlbusiness.com` and the API on
`sales-api.fxlbusiness.com`. Even `Sec-Fetch-Site: same-site` does not save that topology,
because the second clause still fires on the Origin string inequality. The shim is therefore
still what keeps the deployment alive.

### 6.1 Code changes: none

`apps/api/src/auth/hub-bff-origin.ts` is unchanged. The mount stays
`router.all('/auth/*', createHubBffOriginShim(bff, { trustedOrigins: [env.CORS_ORIGIN] }))`.

### 6.2 Docstring changes

Update the header so it names 2.1.0:

- The opening sentence becomes: the guard was added in `1.3.x`, is STILL present and STILL
  hardcoded in `@fxl-business/hub-sdk@2.1.0` at `dist/server.js:421-432`, and 2.1.0 adds no
  configuration escape. Quote the current line numbers.
- Same house rule as section 5.2: re-quote the line numbers, never the vendor's prose. No
  added line may carry an em dash or an en dash.
- Keep the whole "why a shim and not a deployment change" paragraph. It is still the correct
  reasoning.
- Update the delete-signal sentence and `nexo/ROADMAP.md:12` alongside it: this module can be
  deleted when `CreateHubBffOptions` gains an allowed-origins key, and the signal is the
  non-vacuity test `proves the guard is real by 403ing that same request without the shim`
  going RED.

### 6.3 Tests

All 10 tests in `apps/api/src/auth/__tests__/hub-bff-origin.test.ts` stay, with the same
titles and the same assertions. The only edit is `buildBff()`'s config literal (section 12).
The `as Parameters<typeof createHubBff>[0]` cast is DELETED: 2.1.0's `HubConfig` is fully
required, and a real literal that type-checks is strictly better than a cast that hides a
shape mismatch.

The two trusted-origin mount tests in `app-auth-bff-wiring.test.ts` also stay unchanged in
title and assertion:
`does not 403 a cross-origin refresh from CORS_ORIGIN, through the real mount` and
`still 403s a cross-origin refresh from an origin that is not CORS_ORIGIN`.

---

## 7. The four contract types, `skipLibCheck`, and the hono augmentation

### 7.1 Move the imports

`apps/api/src/middleware/app-auth.ts`:

```ts
import type {
  HubAuthContext,
  HubEntitlements,
  HubRoles,
  HubTokenClaims,
} from '@fxl-business/hub-sdk';
```

Import only what the file actually uses; `noUnusedLocals` is on. `HubAuthContext` is the one
the middleware needs. `HubEntitlements`, `HubRoles` and `HubTokenClaims` belong wherever the
gate and the fixtures spell a claim shape, which after slice 03 is the access gate and the
test fixture module in section 7.4.

`HubAuthContext` is NOT re-exported from `@fxl-business/hub-sdk/server`. The `/server`
subpath exports exactly eight names: `BootAssertionInput`, `CreateHubBffOptions`,
`RequireHubAuthOptions`, `assertBootConfiguration`, `assertConformantSessionStore`,
`createHubBff`, `organizationScope`, `requireHubAuth`. Import the contract types from the
ROOT subpath.

DELETE `MinimalHubAuthContext`. It was a locally declared structural stand-in for types that
the SDK did not usably ship in 1.3.1, and 2.0.0 declares them locally so they are usable now.
Every reference to `MinimalHubAuthContext` becomes `HubAuthContext`:

- `apps/api/src/middleware/app-auth.ts` - the type alias, `getHubActorDisplayName`,
  `getAppRolesFromHubClaims`, `getHubLegacyAuthContext`, the access gate slice 03 left, and
  the `declare module 'hono'` block.
- `apps/api/src/domains/sales-ops/routes.ts` if it names the type; recon says it only calls
  `getHubActorDisplayName(c.get('hubAuth'))`, so it likely needs no edit.

`getHubActorDisplayName` keeps its `HubAuthContext | undefined` parameter and its optional
chaining, because `c.get('hubAuth')` is declared optional.

### 7.2 `skipLibCheck` in this repo, and what it means for the deny branch

`tsconfig.base.json` sets `"skipLibCheck": true`, and both `apps/api/tsconfig.json` and
`apps/web/tsconfig.json` extend it without overriding. So this repo is exactly the case
MIGRATION.md section 10 warns about.

Under 1.3.1, `dist/index.d.ts` re-exported those four types from `@fxl-hub/hub-auth`, a
`private: true` workspace package that is not installed here. With `skipLibCheck: true` that
unresolved specifier does not error; the types silently become `any`. That is precisely why
this repo hand-declared `MinimalHubAuthContext` instead, and it is what would happen to
slice 03's gate if anyone imported the types from the old place.

Under 2.1.0 the four types are DECLARED LOCALLY inside `dist/index.d.ts`, so they resolve and
do not degrade. Concretely for the access gate's deny branch:

- `auth.entitlements.access` is genuinely `boolean`, so `auth.entitlements.access !== true`
  is a type-checked comparison and the 402 branch is real code.
- If the import ever drifted back to `@fxl-hub/hub-auth`, `access` would be `any`, the gate
  would still COMPILE, the deny branch would be unreachable in practice, and nothing would
  fail. That is the silent hole.

Because "it compiles" is not evidence here, this slice adds a compile-time oracle that fails
`tsc --noEmit` if the degradation ever comes back. See section 16, file
`apps/api/src/auth/__tests__/hub-contract-types.test.ts`.

### 7.3 The hono augmentation stays in this repo

The SDK's `/server` subpath ships:

```ts
declare module 'hono' {
  interface ContextVariableMap {
    urlOrganizationId: string;
  }
}
```

`hubAuth` is NOT in it, even though `dist/server.js` does `c.set("hubAuth", context)` and
`c.get("hubAuth")`. So this repo must keep its own augmentation.

Keep it exactly where it is today, in `apps/api/src/middleware/app-auth.ts`, immediately
above the module-level singletons, changed only in its type:

```ts
declare module 'hono' {
  interface ContextVariableMap {
    /**
     * Set by the SDK's `requireHubAuth`. The SDK's own /server augmentation declares only
     * `urlOrganizationId`, not this, so `c.get('hubAuth')` types as an error without this
     * block. Keep it HERE: `app-auth.ts` is the module `server.ts` imports and every route
     * module reaches transitively through `appAuthMiddleware`, so the augmentation is in
     * scope for every `c.get('hubAuth')` in the app with no extra import.
     */
    hubAuth?: HubAuthContext;
  }
}
```

Do not move it to a `types/` file and do not add a second `declare module 'hono'` anywhere
else. Two augmentations declaring the same key with different types is a merge conflict at
the type level, and one declaring `hubAuth` in a file nothing imports is dead.

The two augmentations coexist because the keys differ. Nothing in this repo declares
`urlOrganizationId`.

### 7.4 The test fixture for a full `HubAuthContext`

`HubAuthContext` requires `accountId`, `workspaceId`, `entitlements`, `roles`, `aud` and a
full `claims: HubTokenClaims`. The four fixtures that currently build a `MinimalHubAuthContext`
by hand would each grow the same twelve required claim fields. Build it once.

Deterministic rule: if `apps/api/src/auth/__tests__/hub-auth-context-fixture.ts` already
exists (slice 03 may have created it), edit it to the shape below. If it does not, create it
with exactly this content. It is NOT collected by vitest: `apps/api/vitest.config.ts` includes
`src/**/__tests__/**/*.test.ts`, and this file does not end in `.test.ts`.

```ts
import type { HubAuthContext, HubTokenClaims, HubWorkspaceRole } from '@fxl-business/hub-sdk';

/**
 * ONE Hub-shaped auth context for every API test that needs one.
 *
 * It is built from the SDK's own `HubAuthContext` and `HubTokenClaims`, so a contract move
 * reddens this file rather than eight test files, and so a claim that quietly degrades to
 * `any` cannot pass unnoticed through a fixture.
 *
 * Slice 05 re-points the claims half of this at `devHubClaims` from
 * `@fxl-business/hub-sdk-testing`, EDITING this file rather than replacing it, and declares
 * it in its own files_modified. That handoff is agreed on both sides: this module is not
 * created here and orphaned one wave later.
 */
export type HubAuthOverrides = {
  accountId?: string;
  workspaceId?: string;
  access?: boolean;
  modules?: string[];
  workspaceRole?: HubWorkspaceRole;
  productRoles?: string[];
  isSuperAdmin?: boolean;
  name?: string;
  email?: string;
};

export const FIXTURE_AUDIENCE = 'app.fxl-sales';

export function hubAuthContext(overrides: HubAuthOverrides = {}): HubAuthContext {
  const accountId = overrides.accountId ?? 'user_existing_1';
  const workspaceId = overrides.workspaceId ?? 'org_existing_1';
  const entitlements = {
    access: overrides.access ?? true,
    modules: overrides.modules ?? [],
  };
  const roles = {
    workspace: overrides.workspaceRole ?? ('member' as HubWorkspaceRole),
    ...(overrides.productRoles !== undefined ? { productRoles: overrides.productRoles } : {}),
  };
  const claims: HubTokenClaims = {
    iss: 'https://auth.fxlbusiness.com',
    aud: FIXTURE_AUDIENCE,
    sub: accountId,
    workspaceId,
    contractVersion: 1,
    entitlements,
    roles,
    typ: 'at+jwt',
    iat: 1_700_000_000,
    exp: 1_700_000_900,
    jti: `fixture.${accountId}.${workspaceId}`,
    ...(overrides.isSuperAdmin !== undefined ? { isSuperAdmin: overrides.isSuperAdmin } : {}),
    ...(overrides.name !== undefined ? { name: overrides.name } : {}),
    ...(overrides.email !== undefined ? { email: overrides.email } : {}),
  };
  return { accountId, workspaceId, entitlements, roles, aud: FIXTURE_AUDIENCE, claims };
}
```

`modules` defaults to `[]` deliberately: access-model-v1 carries ADD-ON modules only, so an
empty list is the normal case and a fixture that defaults to a populated one would let a
module gate pass by accident.

`entitlements.modules` on `HubTokenClaims` and on `HubAuthContext` are the same object here,
matching the SDK's own `toHubTokenClaims` behaviour.

**Handoff to slice 05, stated on both sides.** Slice 05 (wave 4) EDITS this file: it replaces
the hand-written `claims` literal with `devHubClaims` from `@fxl-business/hub-sdk-testing` and
keeps the `hubAuthContext(overrides)` signature, so the four consumers named in section 17 do
not move again. Slice 05's plan declares
`apps/api/src/auth/__tests__/hub-auth-context-fixture.ts` in its own `files_modified`. Wave 3
and wave 4 are serial, so that overlap is legal and intentional, not a conflict. If slice 05
ever chooses to own the whole thing instead, it must DELETE this module in the same commit;
what is forbidden is leaving it here with no importer.

---

### 7.5 `hubSdkConfig`, `getHubSdkConfig` and `requireHubAuth`'s deleted `audience` option

Three more compile breaks live in `apps/api/src/middleware/app-auth.ts`, all caused by the
1.3.1 type `HubSdkConfig`, which DOES NOT EXIST in 2.1.0. The file cannot type-check until all
three are gone, and section 19 step 8 declares it type-checks clean, so they are owned here.

1. **`:1`** - `import type { HubSdkConfig } from '@fxl-business/hub-sdk';` is DELETED. It is
   replaced by the contract-type import in section 7.1 plus `import type { HubConfig }` if the
   file needs to spell the type; after slice 02 `hubAuthConfig` is already a
   `HubAuthConfig | null`, which IS a `HubConfig`, so an explicit annotation is usually
   unnecessary.
2. **`:85-92`** - the `const hubSdkConfig: HubSdkConfig | null = hubAuthConfig ? { apiUrl,
   publishableKey, secretKey, audience } : null;` adapter is DELETED WHOLE. It existed only to
   translate this repo's field names into 1.3.1's `publishableKey` / `secretKey`. 2.1.0's
   `HubConfig` is `{apiUrl, environment, clientId, clientSecret, audience}`
   (`dist/config-CxunTdjI.d.ts:4-20`), which is exactly what `loadHubConfig` returns, so there
   is nothing left to translate.
3. **`:149-151`** - `export function getHubSdkConfig() { return hubSdkConfig; }` is DELETED.

Then re-point every reader at the loaded config. The readers, all in this same file, are:

- `:154-156`, the `hubAuthMiddleware` construction. It becomes:
  ```ts
  const hubAuthMiddleware = hubAuthConfig ? requireHubAuth(hubAuthConfig) : null;
  ```
  The `{ audience: ... }` option is GONE. 2.1.0's `RequireHubAuthOptions`
  (`dist/server.d.ts:85-93`) has exactly four members - `fetchImpl`, `allowWithoutAccess`,
  `requiredModule`, `requiredRoles` - and no `audience`. The SDK's own docblock on
  `requireHubAuth` gives the reason, and it is the same reason section 2.1 gives for not
  re-deriving the audience: "The audience comes from `config.audience`, which is required and
  validated, so there is no override: an override would be a second source of truth for the
  one value that must match what the Hub minted."
  Do NOT pass `allowWithoutAccess` here. Its default is `false`, and that default is what
  makes the SDK answer the 402 this repo used to answer itself. See section 23.
- `:159`, `appAuthMiddleware`'s unconfigured guard. It becomes
  `if (!hubAuthMiddleware || !hubAuthConfig) { ... 503 ... }`. The 503 body and status are
  unchanged; only the second operand moves.
- `:198`, `createAppAuthBff`'s early return. It becomes `if (!hubAuthConfig) return null;`.
- `:218`, the `createHubBff` call. Section 3.2 already spells it `createHubBff(hubConfig, ...)`
  where `hubConfig` is the non-null `hubAuthConfig`.

**Every other reader of `getHubSdkConfig` across the repo.** Grep, do not assume:

```bash
git grep -n "getHubSdkConfig\|hubSdkConfig\|HubSdkConfig" -- apps packages scripts
```

Recon at the time of writing finds exactly two OTHER files, both tests, both already owned by
section 17 - so this deletion adds no file to `files_modified`:

- `apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts:23,346,391,756` - the
  `HubSdkConfig` type import and three inline config literals, all replaced by the 2.x
  `HubConfig` literal section 17 gives.
- `apps/api/test/rls/hub-bff-login-supersede.test.ts:28,54` - `import type { HubSdkConfig }`
  and `const HUB_CONFIG: HubSdkConfig`, both replaced by `HubConfig` per section 17.

`apps/api/dist/middleware/app-auth.d.ts` also names it. That is BUILD OUTPUT, it is not
tracked source, and it is regenerated by `pnpm run build`. Do not hand-edit it.

Nothing outside `apps/api` imports `getHubSdkConfig`, so no route module and nothing in
`apps/web` is affected by its removal.

---

## 8. Verify the BFF mount

MIGRATION.md section 13 warns against `app.route('/auth', createHubBff(...))`, which yields
`/auth/auth/login`. This repo does NOT do that.

What this repo does, verified in recon:

- `apps/api/src/middleware/app-auth.ts`:
  `router.all('/auth/*', createHubBffOriginShim(bff, { trustedOrigins: [env.CORS_ORIGIN] }))`.
  The BFF is invoked through its own `fetch`, not mounted with `route()`, and the shim passes
  the request path through untouched.
- `apps/api/src/server.ts:33`: `app.route('', authBff)`.

Composing those gives `/auth/login`, `/auth/callback`, `/auth/refresh`, `/auth/logout` and now
`/auth/_health` on the API origin. That is a single `/auth` prefix. No change is needed.

Recon found no test that pins the composition itself, only tests that exercise individual
routes. Add one. See section 16, the two new tests
`mounts every BFF route under a single /auth prefix, never /auth/auth`
and `does not route POST /auth/switch, since 2.1.0 deleted it`.

---

## 9. `GET /auth/_health`

### 9.1 The decision

EXPOSE it on the API origin, authenticated by the SDK's `healthToken` and by nothing else,
and make it impossible for it to answer anonymously in ANY environment.

Why expose it at all: it reports the resolved Audience, the session store kind and class name,
the cookie name and flags, and the resolved TTLs. Those are exactly the five things this repo
has been burned by getting silently wrong, and it answers them from inside the running BFF,
which no test can do for a deployed instance. MIGRATION.md's upgrade checklist ends with a
`curl` against it for that reason.

### 9.2 How it is authenticated

`FXL_HUB_HEALTH_TOKEN` is a NEW operator-generated variable. The Hub does not issue it. It is
declared in `apps/api/src/env.ts` (section 2.2), it ships EMPTY in both `.env` examples with a
comment telling the operator to generate one, and it is passed to `createHubBff` as
`healthToken` whenever it is set.

The SDK compares it with `timingSafeEqual` against `Authorization: Bearer <t>` or
`x-fxl-health-token`, and answers `401 {"error":"unauthorized"}` on a miss.

`assertBootConfiguration` already refuses to boot when `environment !== 'development'` and
`healthToken` is missing or empty, so outside development the endpoint can never be anonymous.

Inside development the SDK's guard is `if (healthToken !== undefined && healthToken.length > 0)`,
so an unset token makes the endpoint ANONYMOUS. Close that here rather than relying on an
operator setting an optional variable. Mount a guard on the outer router BEFORE the catch-all,
inside `createAppAuthBff()`:

```ts
  const router = new Hono();
  // 2.1.0's /auth/_health is anonymous when no healthToken is configured, which is legal only
  // in development and is still an information disclosure there (it reports the Audience, the
  // clientId and the store class). Registered BEFORE the catch-all below, so it short-circuits:
  // if no token is configured the endpoint does not exist at all.
  if (env.FXL_HUB_HEALTH_TOKEN === undefined) {
    router.get('/auth/_health', (c) => c.json({ error: 'not_found' }, 404));
  }
```

This block goes above the `session.kind === 'durable'` supersede mount and above
`router.all('/auth/*', ...)`. Hono runs handlers in registration order and a returned Response
short-circuits, so the catch-all never sees the request.

### 9.3 What must never appear

- The 200 body is the SDK's own shape and this repo does not build it. It contains
  `status`, `sdkVersion`, `contractVersion`, `environment`, `audience`, `clientId`, `apiUrl`,
  `sessionStore.{kind,name}`, `ttls.*` and `cookies.*`. It contains NO `clientSecret` and NO
  `healthToken`. Pin that with a test rather than trusting the read.
- `clientId` is a publishable identifier, not a secret, and it is the SDK's shape; leave it.
- Do NOT log the response. Do NOT log `env.FXL_HUB_HEALTH_TOKEN`. Do NOT wire `/auth/_health`
  into `apps/api/src/routes/health.ts`, into any uptime probe committed in this repo, or into
  the web app. `apps/api/src/routes/health.ts` is unchanged by this slice.
- Do NOT add `FXL_HUB_HEALTH_TOKEN` to `docker-compose.yml`; the API container already reads
  `env_file: [apps/api/.env]`.

---

## 10. `loadHubBrowserConfig` must produce `HubPublicConfig`

### 10.1 `apps/web/src/auth/provider.ts` - final shape

```ts
import type { HubEnvironment, HubPublicConfig } from '@fxl-business/hub-sdk';

type EnvLike = Record<string, string | undefined>;

const HUB_ENVIRONMENTS = ['production', 'staging', 'development'] as const;

/** The Hub's Audience shape under contract v1. `product.<slug>` is the retired form. */
const AUDIENCE_PATTERN = /^app\.[a-z0-9-]+$/;

function isHubEnvironment(value: string): value is HubEnvironment {
  return (HUB_ENVIRONMENTS as readonly string[]).includes(value);
}

/**
 * The PUBLIC projection, and nothing else.
 *
 * `HubPublicConfig` is exactly `{ apiUrl, environment, audience }`. There is NO client id in
 * the browser config: 2.0.0 removed the publishable key from the browser half entirely, and
 * `createHubClient` THROWS if it is handed any object carrying `clientSecret`. This function
 * builds its result from three named locals rather than by spreading `env`, so a secret in
 * the environment can never reach the returned object by accident.
 */
export function loadHubBrowserConfig(env: EnvLike): HubPublicConfig {
  const apiUrl = env.VITE_FXL_HUB_API_URL;
  const environment = env.VITE_FXL_HUB_ENVIRONMENT;
  const audience = env.VITE_FXL_HUB_AUDIENCE;

  const missing = [
    apiUrl ? null : 'VITE_FXL_HUB_API_URL',
    environment ? null : 'VITE_FXL_HUB_ENVIRONMENT',
    audience ? null : 'VITE_FXL_HUB_AUDIENCE',
  ].filter((name): name is string => name !== null);

  if (missing.length > 0 || !apiUrl || !environment || !audience) {
    throw new Error(
      `FXL Hub browser config is incomplete. Set ${missing.join(', ')} in the web environment. ` +
        'VITE_FXL_HUB_AUDIENCE is the Audience the Hub mints for this application and has the ' +
        'form app.<slug>; ask the Hub admin for the exact value. ' +
        'VITE_FXL_HUB_PUBLISHABLE_KEY was retired in hub-sdk 2.0.0 and is no longer read.',
    );
  }

  if (!isHubEnvironment(environment)) {
    throw new Error(
      `VITE_FXL_HUB_ENVIRONMENT must be one of ${HUB_ENVIRONMENTS.join(', ')}.`,
    );
  }

  if (!AUDIENCE_PATTERN.test(audience)) {
    throw new Error(
      'VITE_FXL_HUB_AUDIENCE must have the form app.<slug>. The product.<slug> form was ' +
        'retired with the access model and names nothing the Hub mints.',
    );
  }

  return { apiUrl, environment, audience };
}

export function getHubBffBasePath(env: EnvLike): string {
  return (env.VITE_AUTH_BFF_BASE_PATH ?? env.VITE_API_URL ?? '').replace(/\/+$/, '');
}
```

**Why this is hand-written when the SDK ships `loadHubPublicConfig` and `toPublicConfig`**
(`dist/config-CxunTdjI.d.ts:77` and `:58`): both read the SERVER variable names, `FXL_HUB_*`,
and the browser bag has only `VITE_FXL_HUB_*`, so neither can be handed `import.meta.env`
without first renaming every key - which is the whole function. `toPublicConfig` additionally
takes a full `HubConfig`, which the browser must never hold because it carries `clientSecret`.
The RESULT type is still the SDK's `HubPublicConfig`, so the contract is shared even though
the reader is not. This paragraph exists so a later reader does not "simplify" this back to
the SDK loader and silently read three variables that do not exist in a Vite bundle.

`BrowserHubConfig` is DELETED; `HubPublicConfig` replaces it. `getHubBffBasePath` is
UNCHANGED, including its `??` rather than `||`, which is load-bearing for the shipped
`VITE_AUTH_BFF_BASE_PATH=` empty declaration and is pinned by
`falls back to same-origin auth routes when no override is configured`.

The message is written so an operator reading the browser console learns exactly which
variable is missing and that the audience is Hub-issued. It names no value.

### 10.2 `packages/shared-types/src/env.ts`

```ts
export const sharedClientEnv = z.object({
  VITE_FXL_HUB_API_URL: z.string().url().optional(),
  VITE_FXL_HUB_ENVIRONMENT: z.enum(['production', 'staging', 'development']).optional(),
  VITE_FXL_HUB_AUDIENCE: z.string().optional(),
  VITE_SENTRY_DSN: z.string().url().optional(),
});
```

`VITE_FXL_HUB_PUBLISHABLE_KEY` is REMOVED. `packages/shared-types/dist/` is regenerated by
`pnpm run build:packages`; do not hand-edit it.

### 10.3 The clientSecret pin

`createHubClient` throws on any config carrying `clientSecret`, and every DOM test mocks
`createHubClient`, so the throw is never exercised by this app. The pin therefore goes on the
config OBJECT rather than on the client: a unit test asserting that the returned object cannot
carry a secret even when the environment bag does. Named in section 16 as
`never carries a client secret into the browser config, whatever the environment bag holds`.

---

## 11. The three `satisfies HubClient` mock objects

2.1.0's `HubClient` has TEN members:

```ts
login, loginWithPopup, getToken, getTokenResult, setActive, logout, start, stop,
checkoutUrl, manageUrl
```

`satisfies HubClient` requires all ten. The three mocks declare six today, so all three are
`tsc --noEmit` failures the moment the bump lands, before a single test runs.

Apply the SAME block to all three, keeping each file's existing style:

- `apps/web/src/auth/__tests__/react.test.tsx`
- `apps/web/src/__tests__/session-journey.test.tsx`
- `apps/web/src/sales-ops/__tests__/session-loss-keeps-route.test.tsx`

```ts
  const client = {
    login: vi.fn<HubClient['login']>(),
    loginWithPopup: vi.fn<HubClient['loginWithPopup']>(),
    getToken: vi.fn<HubClient['getToken']>(),
    getTokenResult: vi.fn<HubClient['getTokenResult']>(),
    setActive: vi.fn<HubClient['setActive']>(),
    logout: vi.fn<HubClient['logout']>(),
    start: vi.fn<HubClient['start']>(),
    stop: vi.fn<HubClient['stop']>(),
    checkoutUrl: vi.fn<HubClient['checkoutUrl']>(),
    manageUrl: vi.fn<HubClient['manageUrl']>(),
  } satisfies HubClient;
```

`satisfies` stays. Do NOT relax it to `as unknown as HubClient` or to a partial type: it is
the only thing that turns a future member change into a compile error rather than a runtime
surprise.

**MIGRATION checklist item 12 is NOT a no-op. It has a production caller, and this slice owns
it.** A previous revision of this plan asserted the opposite. That assertion was true when this
plan was parked at `e59f870` and the `feature-20260828-organization-context-escape` run made it
false the next day; section 24 records the miss. Read off the two tarballs:

```
1.3.1  dist/client.d.ts:51   checkoutUrl(sku?: string): Promise<string>;
1.3.1  dist/client.d.ts:53   manageUrl(): Promise<string>;
2.1.0  dist/client.d.ts:170  checkoutUrl(organizationId: string, sku?: string): Promise<string>;
2.1.0  dist/client.d.ts:172  manageUrl(organizationId: string): Promise<string>;
```

`organizationId` is REQUIRED and it is FIRST, so a call that passes only a sku is not merely
mis-scoped, it does not compile. At HEAD `84ac2a3`,
`apps/web/src/sales-ops/MissingEntitlementPanel.tsx:105` calls `.checkoutUrl()` with NO
arguments, inside a `useEffect`, in a shipped component. Under 2.1.0 that is
`TS2554: Expected 1-2 arguments, but got 0`, which fails
`pnpm --filter @fxl-sales/web type-check`, `pnpm run type-check` and `pnpm run build`, all
three of which section 21 requires green.

**This is a correctness fix and not only an arity fix**, which is why it belongs to this panel
rather than to a mechanical sweep. MIGRATION.md section 14 says, verbatim: "Both take the
Organization now. A link that did not name one would land the user on their Primary
Organization, which is not necessarily the one they were looking at when they clicked."
`MissingEntitlementPanel` NAMES the active Organization on screen, in
`MISSING_ENTITLEMENT_COPY.activePrefix` and the `[data-active-organization]` span, and its
`checkoutBody` says the purchase "vale para a Organização ativa". Today that link would send
the operator to checkout for their PRIMARY Organization instead. Scoping the call makes the
link match the sentence above it.

**The edit, at `apps/web/src/sales-ops/MissingEntitlementPanel.tsx`.** Re-read the file before
writing; the line numbers below are HEAD `84ac2a3`.

1. The panel already destructures `active` from `useOrganizations()` at `:68`, so nothing new
   is read. Hoist one primitive above the effect, beside the existing derived values:

   ```ts
   const activeId = active?.id ?? null;
   ```

2. The effect at `:101-115` becomes, keeping its whole existing comment block and its
   `cancelled` flag:

   ```ts
   useEffect(() => {
     if (activeId === null) return;
     let cancelled = false;
     client
       .checkoutUrl(activeId)
       .then((href) => {
         if (!cancelled) setResolved({ attempt, state: { status: 'ready', href } });
       })
       .catch(() => {
         if (!cancelled) setResolved({ attempt, state: { status: 'failed' } });
       });
     return () => {
       cancelled = true;
     };
   }, [activeId, attempt, client]);
   ```

3. **The null-`active` branch is the EXISTING `CheckoutState` `failed` member.** No new state is
   invented. `useOrganizations()` documents `active` as nullable for the degenerate token that
   carries no `workspaceId` claim, and this panel's own docstring forbids any branch rendering
   "an anchor whose href is unresolved". `CheckoutState` is a discriminated union whose `href`
   exists only on `ready`, so TypeScript already forbids the alternative, and `checkoutUrl('')`
   is exactly the empty destination the docstring bans. Express it as pure derivation, at the
   `checkout` computation on `:79-80`, NOT as a `setResolved` in the effect body, which
   `react-hooks/set-state-in-effect` rejects for the reason the comment above `resolved`
   already gives:

   ```ts
   const checkout: CheckoutState =
     activeId === null
       ? { status: 'failed' }
       : resolved && resolved.attempt === attempt
         ? resolved.state
         : { status: 'loading' };
   ```

   The `failed` branch already renders `MISSING_ENTITLEMENT_COPY.checkoutFailed` and a
   `Tentar novamente` button and no anchor, which is the honest screen: the panel cannot name
   an Organization to buy for. `Tentar novamente` stays reachable and simply re-derives to
   `failed`, which costs nothing and needs no extra state.

4. **The dependency array becomes `[activeId, attempt, client]`.** It is the primitive id and
   not the `active` OBJECT, deliberately: `useOrganizations()` memoizes its value but the
   object identity still moves whenever the token is re-applied, and a re-run per token
   re-application would fire a fresh Hub discovery fetch on a screen that is already the
   operator's error state. The file's own comment forbids the usual escape ("Do NOT add a ref
   based 'already fetched' guard: it would break the retry"), so the dep array is the only
   place this can be solved. `attempt` stays for the same reason it is there now, so
   `Tentar novamente` really re-runs. `react-hooks/exhaustive-deps` is satisfied because the
   effect body reads `activeId` and nothing else off the seam.

5. Any comment line added here must contain no em dash and no en dash: the file's own oracle
   `contains no page reload, no native picker and no dash characters in its source` reads the
   source and matches `new RegExp('[\\u2014\\u2013]')`.

**`apps/web/src/sales-ops/__tests__/missing-entitlement-panel.test.tsx` is DECLARED in
`files_modified` for this, and is no longer on section 24's "does NOT touch" list.** Concretely,
after re-reading it:

- `:26` and `:66` type the seam's client as `{ checkoutUrl: ReturnType<typeof vi.fn> }` and stub
  it untyped, so the added argument is not a compile break in this file. Leave both alone.
- `resolves the Hub checkout href through client.checkoutUrl` (`:323`) keeps its title, keeps
  `toHaveBeenCalledTimes(1)`, and GAINS
  `expect(seam.client.checkoutUrl).toHaveBeenCalledWith('org-active')`. That is a
  strengthening: `orgAtiva.id` is `org-active`, and without it the file cannot tell a correctly
  scoped link from one scoped to the wrong Organization.
- ADD one test to `describe('MissingEntitlementPanel - the Hub checkout')`, titled
  `refuses to build a checkout link when no Organization is active, and asks the Hub for none`.
  It sets `seam = makeSeam({ active: null, activeName: 'Acme Holding' })`, renders, and asserts
  `sectionText()` contains `MISSING_ENTITLEMENT_COPY.checkoutFailed`, that `checkoutAnchor()` is
  `null`, and that `seam.client.checkoutUrl` was never called. The last assertion is the one
  that matters: it is what forbids a future `checkoutUrl('')`.
- The two EXISTING `active: null` tests at `:167` and `:175` still pass unchanged, because both
  assert only on the Organization-naming copy and neither reads the checkout block. Confirm
  that rather than assume it; do not edit either one.

**`apps/web/src/auth/__tests__/react.test.tsx` is already declared, and two lines move.** `:212`
calls `void client.checkoutUrl('sales.core')` inside the `renderOrganizations` harness button
and `:2062` asserts `toHaveBeenCalledWith('sales.core')`. Under 2.1.0 both still COMPILE and
still PASS, because one string is now a positionally valid `organizationId`, so this is a
silent-wrong-argument hazard rather than a red: the file would be documenting a MODULE id being
handed to a parameter that means an Organization. Change the literal in BOTH places to
`'workspace-alpha'`, which is the id the surrounding test already mints through
`profileToken('Alpha', undefined, 'workspace-alpha')`. The `it` title
`hands back the Hub client so a later slice can build the checkout link` and the assertion
shape are both unchanged; only the literal moves, and it moves from meaningless to correct.

**`manageUrl` really is a no-op, and this sentence is the audit trail for that half.**
`git grep manageUrl -- apps` at HEAD returns four lines and no production caller: the three
`satisfies HubClient` mocks above (`react.test.tsx:21`, `session-journey.test.tsx:45`,
`session-loss-keeps-route.test.tsx:21`), all of which take their signature from
`HubClient['manageUrl']` and so absorb the change for free, plus one
`mockResolvedValue` at `react.test.tsx:445`. No component builds a billing link. Nothing is owed
for that half of checklist item 12. Re-run the grep before relying on this.

### 11.1 Keeping the `getToken` non-call assertions meaningful

`getToken` still exists on `HubClient` in 2.1.0, so
`expect(mocks.client.getToken).not.toHaveBeenCalled()` still compiles and still means
something. But 2.x also adds `getTokenResult`, which is the reader a well-meaning future edit
would reach for instead, and the assertion as written would not see it.

Strengthen, do not replace. There are exactly TWO such assertions in the file, verified at
HEAD `84ac2a3` (`react.test.tsx:478` and `:539`, both inside
`describe('AppAuthProvider token cache wiring')`). Find them by grep, not by line number. In
the test
`hydrates the provider through the token cache instead of the SDK client`, and again in
`clears browser token state before SDK logout`, keep the existing line and add one beside it:

```ts
    // Permanent rather than incidental. `HubClient.getToken()` discards the BFF's status,
    // and `getTokenResult()` is 2.x's replacement for it, so the app must call NEITHER: the
    // whole `session_expired` versus `transient` classification lives in `refresh.ts`.
    expect(mocks.client.getToken).not.toHaveBeenCalled();
    expect(mocks.client.getTokenResult).not.toHaveBeenCalled();
```

This is a strengthening. It must not be dropped if it is inconvenient.

---

## 12. The SDK's proactive browser renewal is NOT adopted

### 12.1 The rule

This app keeps its own renewal timer (`SESSION_RENEWAL_LEAD_MS = 60_000`,
`scheduleRenewal`, `handleVisibilityChange`), its own revalidation ladder
(`SESSION_REVALIDATE_DELAYS_MS = [500, 1_500, 4_000]`), its own logout intent and its own
`queryClient` flush rules. All four are specified in CLAUDE.md and pinned by tests that took
several runs to get right. This slice changes NONE of them.

`apps/web/src/auth/refresh.ts` and `apps/web/src/auth/token.ts` are UNCHANGED by this slice.
`requestHubAccessToken` keeps its hand-rolled `POST ${bffBasePath}/auth/refresh` with
`{ method: 'POST', credentials: 'include' }` and no body. `HubTokenResult`'s
`session_expired` / `transient` vocabulary is untouched. The SDK's
`ok` / `expired` / `unavailable` union is NOT adopted anywhere.

### 12.2 Does the 2.x client self-start? The answer, from the tarball

NO at construction, YES afterwards. Both halves matter.

`dist/client.js` never calls `schedule()` from `createHubClient`'s body. `start()` is
`if (timer === null && cached !== null) schedule();`, and `cached` is `null` at construction,
so `start()` is also a no-op until a token has been adopted. So merely constructing the client
arms nothing.

BUT `adopt(accessToken, expiresIn)` ends with `schedule()`, and `adopt()` is called from
`refresh()` and from `setActive()`. This app calls `setActive()` on every Organization switch.
`autoRenew` defaults to `true` (`options.autoRenew !== false`), so `schedule()` would arm the
SDK's own ladder `[0.6, 0.75, 0.85, 0.92]` on the first switch, and from that moment TWO
independent renewal loops would be driving the same BFF endpoint with two different caches.

### 12.3 What to do about it

Two defences, both required.

FIRST, turn the SDK loop off at the source. In `apps/web/src/auth/react.tsx`, at the
`createHubClient` call inside the provider (`:234` at HEAD `84ac2a3`, currently
`() => createHubClient(loadHubBrowserConfig(import.meta.env), { bffBasePath })`):

```tsx
  const client = useMemo(
    () =>
      createHubClient(loadHubBrowserConfig(import.meta.env), {
        bffBasePath,
        // 2.x renews proactively by default at [0.6, 0.75, 0.85, 0.92] of the token's life.
        // This app has its own renewal timer, its own revalidation ladder and its own token
        // cache, all specified in CLAUDE.md, and `setActive()` calls the SDK's `adopt()`,
        // which would arm the SDK ladder from the first Organization switch. Two loops on
        // one BFF endpoint with two caches is not a redundancy, it is a race.
        autoRenew: false,
      }),
    [bffBasePath],
  );
```

With `autoRenew: false` the SDK's `schedule()` returns immediately, so no timer is ever
created regardless of `adopt()`.

Do NOT pass `onSessionExpired`: session death is classified by `observeToken` from the BFF
status, and a second notifier would fire out of band.

Never call `client.start()`.

SECOND, `stop()` must be called, as belt and braces and to drop the SDK's cached token. Add it
to the existing mount/unmount effect in `react.tsx` (the one that re-arms `mountedRef` and
calls `clearTimers()` on unmount), so the two can never fight even if a future edit removes
`autoRenew: false`:

```tsx
    return () => {
      mountedRef.current = false;
      clearTimers();
      // Halts any SDK-side renewal and drops the SDK's own token cache. `autoRenew: false`
      // above already prevents one from arming; this is what keeps that true if the option
      // is ever lost.
      client.stop();
    };
```

Add `client` to that effect's dependency array. `client` is a `useMemo` keyed on
`bffBasePath`, which is itself a `useMemo` keyed on `[]`, so this does not add a re-run.

Both are pinned by named tests in section 16.

### 12.4 What must stay untouched

`describe('proactive token renewal')` in `react.test.tsx` is about THIS app's timer and must
stay green, unmodified. Same for the whole `describe('session preservation and route restore')`
block, the whole `describe('live session loss')` block, the whole
`describe('explicit logout intent')` block, the whole `describe('identity-scoped query cache')`
block, and the whole `describe('active organization and the useOrganizations seam')` block -
that last one did not exist when this plan was written and arrived with
`feature-20260828-organization-context-escape`; it is untouched by this slice except for the
`SetActiveResult` literals inside it. At HEAD `84ac2a3` the file's seven top-level describes
start at `:465`, `:658`, `:1071`, `:1259`, `:1513`, `:1709` and `:1972`; do not trust an older
line range. Same for all seven tests in
`apps/web/src/auth/__tests__/refresh.test.ts` and all fourteen in
`apps/web/src/auth/__tests__/token.test.ts`. None of those files is edited by this slice.

---

## 13. `setActive`

### 13.1 No web rename

`setActive(workspaceId)` still exists on the browser surface. It now POSTs `/auth/refresh`
with a JSON body `{ organizationId }` internally, but that is entirely inside the SDK.

The CLAIM is still `workspaceId`. The SDK's own doc comment on `HubTokenClaims.workspaceId`
says it in as many words: the claim keeps the name `workspaceId` while its VALUE is the
Organization id, and renaming it would break every deployed verifier.

So NO web rename. `readWorkspaces`, `profileFromToken`, `HubWorkspacePreview`,
`AuthProfile.workspaceName`, `claims.ts`'s `roles.workspace`, the `setActive` parameter name,
`aria-label="Workspace"` and every test title keep the word workspace. This slice changes none
of them.

### 13.2 `SetActiveResult`

2.1.0 ships:

```ts
interface SetActiveResult {
    accessToken: string;
    expiresIn: number;
    organizationId: string;
}
```

`accessToken` and `expiresIn` are both still there, which is what `react.tsx:564-565` consumes:

```tsx
    tokenCache.seed(result.accessToken, result.expiresIn);
    observeToken({ token: result.accessToken });
```

The THIRD field was renamed from `workspaceId` (1.3.1) to `organizationId` (2.x). What changes
because of that: only the mock literals in the three test files. `react.tsx` never reads the
third field. Update the literals:

In `apps/web/src/auth/__tests__/react.test.tsx`, `workspaceId: 'workspace-beta'` becomes
`organizationId: 'workspace-beta'` and `workspaceId: 'workspace-gamma'` becomes
`organizationId: 'workspace-gamma'` in every `SetActiveResult` literal. Keep the VALUES exactly
as they are: they are the ids the surrounding assertions and the `profileToken` fixture use,
and changing them would decouple the mock from the fixture.

FIND THEM BY SHAPE, NOT BY LINE NUMBER. At HEAD `84ac2a3` there are TEN, not the nine this plan
was written against, because the organization-context feature added an eleventh describe block.
The reliable discriminator is the two sibling keys: a `SetActiveResult` literal is the one that
sits beside `accessToken` and `expiresIn`.

```bash
grep -n -B3 "workspaceId: 'workspace-" apps/web/src/auth/__tests__/react.test.tsx
```

Every hit whose preceding lines are `accessToken:` and `expiresIn:` is a `SetActiveResult` and
is renamed. Every other hit is a JWT `workspaces` CLAIM entry - the `profileToken` fixtures and
the `useOrganizations` seam's fixtures - and STAYS `workspaceId`, because that is the claim
name and `readWorkspaces` reads `workspace.workspaceId ?? workspace.id`. Getting this backwards
silently breaks the workspace preview rather than failing to compile, so do the grep.

Record the invariant in a comment above `setActive` in `react.tsx`, so the next rename costs
three literals and not a search:

```tsx
  // Only `accessToken` and `expiresIn` are read here. `SetActiveResult`'s third field is the
  // Organization id, and it has already been renamed once (`workspaceId` in 1.3.1,
  // `organizationId` in 2.x). Keeping this callback blind to it means a further rename touches
  // only the three test mocks and nothing in production.
```

If the third field is renamed again, the change is exactly: the three test files' mock
literals, and nothing else. There is no production reader.

---

## 14. The `.env` examples

### 14.1 `apps/web/.env.example`

```
# --- API ---
VITE_API_URL=http://localhost:3006
VITE_AUTH_PROXY_TARGET=http://localhost:3006
VITE_AUTH_BFF_BASE_PATH=

# --- Auth (FXL Hub public config) ---
# The browser half takes the PUBLIC projection only: apiUrl, environment, audience.
# There is no client id and no secret here. hub-sdk 2.0.0 retired
# VITE_FXL_HUB_PUBLISHABLE_KEY and createHubClient throws on any config carrying a secret.
VITE_FXL_HUB_API_URL=http://localhost:9016
VITE_FXL_HUB_ENVIRONMENT=development
# REQUIRED. The Audience the Hub mints for this application, of the form app.<slug>.
# A PUBLIC identifier, not a credential: it is derivable from the committed clientId slug, so
# committing it discloses nothing. Shipping it blank would make the example non-working and
# push every operator into guessing the one value the boot check exists to validate.
VITE_FXL_HUB_AUDIENCE=app.fxl-sales

# --- Observability (optional) ---
VITE_SENTRY_DSN=
```

### 14.2 `apps/web/.env.dev.example`

Same three-line Auth block, same comments, keeping the file's existing header
(`# apps/web/.env.dev.example` and `# Local dev defaults for the Vite app.`) and its existing
spacing.

### 14.3 Rules that bind both

- The `VITE_FXL_HUB_PUBLISHABLE_KEY=pk_fxl-sales_VzQ9...` line is DELETED from both files.
  That also removes a committed Hub key from the tree, which is a straight improvement.
- `VITE_FXL_HUB_AUDIENCE=app.fxl-sales` is WRITTEN OUT in both files. The Audience is a public
  identifier, not a credential, and it is derivable from the committed clientId slug, so
  committing it discloses nothing that the clientId would not. This matches
  `apps/api/.env*.example`, which slice 02 ships the same way, so the two halves of one
  deployment do not disagree about the one value that must match on both sides. This licenses
  no CREDENTIAL anywhere: `FXL_HUB_CLIENT_ID`, `FXL_HUB_CLIENT_SECRET` and
  `FXL_HUB_HEALTH_TOKEN` all still ship EMPTY.
- `VITE_FXL_HUB_ENVIRONMENT=development` is NOT a Hub-issued value. It is a deployment fact,
  both files are local-development templates, and `development` is the only correct value for
  a template pointing at `http://localhost:9016`. Setting it is allowed and required.
- `apps/web/.env` is gitignored. DO NOT TOUCH IT. The operator updates it by hand after
  reading the example, and the boot error in section 10.1 tells them exactly what is missing.

### 14.4 `apps/api/.env.example` and `apps/api/.env.dev.example`

Reconcile to the SDK's five names plus this repo's own. Required end state for the Hub block,
comments preserved and extended:

```
FXL_HUB_API_URL=http://localhost:9016
FXL_HUB_ENVIRONMENT=development
# Hub-issued. Shown once by the Hub admin panel. Never commit a real value.
FXL_HUB_CLIENT_ID=
FXL_HUB_CLIENT_SECRET=
# The Audience the Hub mints for this application, of the form app.<slug>. PUBLIC, not a
# credential, and derivable from the clientId slug - so it is written out here rather than
# left blank. Slice 02 already ships it this way; verify rather than re-add.
FXL_HUB_AUDIENCE=app.fxl-sales
# Operator-generated, NOT Hub-issued. Authenticates GET /auth/_health, which reports the
# resolved Audience, the session store kind and the cookie flags. Required outside
# development; the API refuses to boot without it there. Generate one with
# `openssl rand -hex 32` and keep it in the secret manager.
FXL_HUB_HEALTH_TOKEN=
# This app's OWN origin plus /auth/callback, never the Hub's. hub-sdk 2.x defaults
# redirectUri to the Hub's apiUrl, so leaving this unset points the callback at the wrong host.
FXL_HUB_REDIRECT_URI=
FXL_HUB_POST_LOGIN_REDIRECT=
FXL_HUB_POST_LOGIN_ERROR_REDIRECT=
# Single-JSON alternative to the five discrete FXL_HUB_ variables above. Setting this AND any
# of them is a boot failure that names the offenders. Leave empty to use the discrete form.
FXL_HUB_CONFIG=
HUB_SESSION_ENCRYPTION_KEY=
```

If the JSON-form comment shows an `FXL_HUB_CONFIG` example object, its `"audience"` member is
`"app.fxl-sales"` for the same reason.

If either file still carries a real `FXL_HUB_PUBLISHABLE_KEY=pk_fxl-sales_...` value, DELETE
the line; it does not carry over to `FXL_HUB_CLIENT_ID`, which stays empty.

`apps/api/.env` is gitignored and holds a real secret. DO NOT TOUCH IT. Report to the operator
that they must rename `FXL_HUB_PUBLISHABLE_KEY` to `FXL_HUB_CLIENT_ID`, rename
`FXL_HUB_SECRET_KEY` to `FXL_HUB_CLIENT_SECRET`, and add `FXL_HUB_ENVIRONMENT=development`
plus the Hub-issued `FXL_HUB_AUDIENCE`, before the API will boot again locally.

---

## 15. The eslint `getToken` rule

`apps/web/eslint.config.js:52-57` matches the literal callee name:

```js
"LogicalExpression[operator='??'] > AwaitExpression.left > CallExpression[callee.name='getToken']"
```

The app-level reader at `apps/web/src/auth/react.tsx:501` (verified at HEAD `84ac2a3`) MUST stay named `getToken` and MUST
keep its `Promise<string | null>` signature. Renaming it to `getTokenResult`, or reshaping
`useAccessToken()` to hand back a result object, silently disarms the rule and breaks the
~119 call sites that reach it through `useAccessToken()` / `requireToken(getToken)`.

This slice does not touch that `useCallback`, `apps/web/src/lib/require-token.ts`'s predicates or
`apps/web/eslint.config.js`. It adds a source-pin test so a future rename fails loudly rather
than quietly. See section 16.

---

## 16. The oracle tests

Red first. Write every test in this section BEFORE the implementation it describes, watch it
fail for the right reason, then implement. These tests are IMMUTABLE to the executor: if one
does not pass, the implementation is wrong, not the test.

### 16.1 NEW file: `apps/api/src/auth/__tests__/hub-contract-types.test.ts`

The compile-time guard for MIGRATION.md section 10. Both assertions fail `tsc --noEmit` if the
types degrade, and both are also asserted at runtime so `noUnusedLocals` is satisfied.

- `pins entitlements.access as a real boolean rather than any under skipLibCheck`
  Declares `type IsAny<T> = 0 extends 1 & T ? true : false;` and
  `const accessIsNotAny: IsAny<HubEntitlements['access']> extends false ? true : false = true;`
  plus `const accessIsBoolean: HubEntitlements['access'] = true;`, then asserts both are
  `true`. A comment records that under 1.3.1 these four types were re-exported from an
  uninstalled `@fxl-hub/hub-auth` and became `any` with `skipLibCheck: true`, which would make
  the 402 deny branch unreachable while still compiling.
- `pins workspaceId as the Organization id claim, since 2.x never renamed it`
  Builds a `HubAuthContext` through the fixture and asserts `ctx.workspaceId` and
  `ctx.claims.workspaceId` are the same non-empty string, and that
  `'organizationId' in ctx.claims === false`.
- `pins the SDK version this repo is written against`
  `expect(HUB_SDK_VERSION).toBe('2.1.0')` and `expect(HUB_TOKEN_CONTRACT_VERSION).toBe(1)`.
  This is the tripwire for the next bump: it goes red on install, before any behaviour does.

### 16.2 NEW file: `apps/api/src/middleware/__tests__/app-auth-bff-production-boot.test.ts`

Its own module graph, mirroring `app-auth-bff-memory-path.test.ts`'s structure
(`vi.resetModules()` in `beforeAll`, `vi.doMock` around `@fxl-business/hub-sdk/server` to
capture the options object, dynamic `import('../app-auth.js')`). Stubs:

```
NODE_ENV=test
CORS_ORIGIN=https://sales.example.test
DATABASE_URL=postgresql://postgres:postgres@localhost:5006/fxl_sales_boot_test
FXL_HUB_API_URL=https://auth.example.test
FXL_HUB_ENVIRONMENT=production
FXL_HUB_CLIENT_ID=pk_fxl-sales_production_boottestclientid
FXL_HUB_CLIENT_SECRET=sk_fxl-sales_production_boottestclientsecret
FXL_HUB_AUDIENCE=app.fxl-sales
FXL_HUB_HEALTH_TOKEN=boot-test-health-token-not-a-real-secret
FXL_HUB_REDIRECT_URI=https://sales.example.test/auth/callback
HUB_SESSION_ENCRYPTION_KEY=''
```

Those clientId and clientSecret strings are structurally valid, obviously fake, and match the
existing house convention of `pk_fxl-sales_unit-test-...`. `NODE_ENV` stays `test` so no socket
is opened; the store still takes the durable branch because `DATABASE_URL` is set, and
`postgres-js` builds its pool lazily.

Tests:

- `passes a health token to createHubBff when the Hub environment is not development`
- `never passes insecureCookies outside development`
  (`expect('insecureCookies' in (bffOptions ?? {})).toBe(false)`)
  This asserts the KEY IS ABSENT, not that it is false, and it is only non-vacuous because
  section 3.2 writes the option as a spread. If an executor "simplifies" that to
  `insecureCookies: isHubDevelopment`, the key becomes present-and-false and this test goes
  red - and it will look like a test bug when the bug is in the source. The test is right;
  restore the spread.
- `never passes allowEphemeralSessionStore outside development`
- `passes an explicit redirectUri on this app's own origin, never the Hub's`
  Asserts `new URL(bffOptions.redirectUri).origin === 'https://sales.example.test'` and
  `!== 'https://auth.example.test'`, and that the path is `/auth/callback`.
- `answers 401 to GET /auth/_health with no health token`
- `answers 401 to GET /auth/_health with the wrong health token`
- `never puts the client secret or the health token in the /auth/_health body`
  Fetches with the correct token, asserts 200, and asserts the raw response TEXT contains
  neither the clientSecret string nor the health token string, and that the parsed body has
  no `clientSecret` key.

### 16.3 `apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts` - new tests

Added beside the existing ones, in the existing development-shaped module graph.

- `mounts every BFF route under a single /auth prefix, never /auth/auth`
  Drives the real mount: `GET /auth/login` does not answer 404, and `GET /auth/auth/login`
  answers 404. This is the MIGRATION.md section 13 pin the repo did not have.
- `does not route POST /auth/switch, since 2.1.0 deleted it`
  `POST /auth/switch` answers 404 through `app.route('', authBff)`.
- `refuses to hand createHubBff the SDK ephemeral default, in any environment`
  Asserts `bffOptions.sessionStore` is defined and is the durable store instance, which is the
  existing identity check restated as a 2.x invariant. Keep the existing test
  `hands the durable session store to createHubBff` as well; do not merge them.
- `answers 404 for GET /auth/_health when no health token is configured`
  In this graph `FXL_HUB_HEALTH_TOKEN` is unset, so the section 9.2 guard is mounted.

### 16.4 `apps/api/src/auth/__tests__/hub-session-store.test.ts` - new test

- `exposes only read on the transaction handle, so a caller cannot fall back to the deleted get`
  Captures the handle inside `withSession` and asserts `Object.keys(handle).sort()` equals
  `['delete', 'read', 'update']`.

### 16.5 `apps/web/src/auth/__tests__/provider.test.ts` - new and replaced tests

- REPLACES `loads Hub browser config from Vite env vars` with
  `loads the Hub public browser config from Vite env vars`, asserting with `toEqual` on
  `{ apiUrl: 'http://localhost:9016', environment: 'development', audience: 'app.fxl-sales' }`.
  `toEqual` on an exact object is what makes an added or removed key a failure.
- `never carries a client secret into the browser config, whatever the environment bag holds`
  Hands a bag that also contains `VITE_FXL_HUB_CLIENT_SECRET` and a `clientSecret` key, and
  asserts `'clientSecret' in result === false` and `'secretKey' in result === false`. A
  comment records that `createHubClient` throws on any config carrying `clientSecret`, so this
  is the pin that keeps this app on the far side of that throw.
- `names every missing Hub browser variable` as an `it.each` over
  `VITE_FXL_HUB_API_URL`, `VITE_FXL_HUB_ENVIRONMENT`, `VITE_FXL_HUB_AUDIENCE`: drop one from a
  complete bag and assert the message names it.
- `refuses an environment that is not one of the three Hub environments`
- `refuses the retired product.<slug> audience form`
  Passes `audience: 'product.fxl-sales'` and asserts the throw mentions `app.<slug>`.
- REPLACES `requires the Hub browser vars` with the `it.each` above; do not keep a test that
  only checks `VITE_FXL_HUB_API_URL`, since audience is now the variable most likely to be
  missing.
- The three `getHubBffBasePath` tests are UNCHANGED.

### 16.6 `apps/web/src/auth/__tests__/react.test.tsx` - new tests

Added to `describe('AppAuthProvider token cache wiring')`.

- `does not adopt the SDK's own renewal loop`
  Asserts `mocks.createHubClient` was called with
  `expect.objectContaining({ bffBasePath: expect.any(String), autoRenew: false })`, and that
  `mocks.client.start` was never called. A comment records that `adopt()` inside `setActive()`
  calls `schedule()`, so `autoRenew: false` is what keeps the SDK ladder from arming on the
  first Organization switch.
- `stops the SDK client at unmount so its renewal can never race the app's own`
  Renders, unmounts, asserts `mocks.client.stop` was called.
- `does not pass the SDK an onSessionExpired callback, since classification lives in refresh.ts`
  Asserts the options object handed to `createHubClient` has no `onSessionExpired` key.

### 16.7 `apps/web/src/__tests__/route-error-and-auth-context.test.tsx` - new test

The first draft of this section asserted that `src/auth/react.tsx` contains the literal
`const getToken = useCallback(` and that `eslint.config.js` contains `callee.name='getToken'`.
That is a string match on FORMATTING, not on behaviour: splitting the declaration across two
lines reddens it while the rule is perfectly intact, and any other spelling the selector also
matches would pass it while telling us nothing. It is dropped and REPLACED by a test that
exercises the rule itself. A test that can go red for a reason unrelated to its claim is worse
than no test, because it trains the next reader to edit the test.

- `the no-defaulted-token lint rule still fires on (await getToken()) ?? ""`
  Loads the REAL web flat config (`eslint.config.js`, already in this package) through
  ESLint's Node API and lints two in-memory source strings, so nothing depends on how the
  reader is formatted:
  - a violating one, `const t = (await getToken()) ?? '';` inside an async function, which
    must report exactly one `no-restricted-syntax` message whose text names
    `requireToken(getToken)`;
  - a control, the same expression with the callee renamed, which must report none.
  The control is what makes the first assertion mean "the SELECTOR matched" rather than "some
  rule fired". A comment records the stakes: the selector keys on the literal callee name, so
  renaming the app-level reader to `getTokenResult`, or reshaping `useAccessToken()` to hand
  back a result object, disarms the rule silently and reopens the
  `(await getToken()) ?? ''` anonymous-request bug across the ~119 call sites that reach it.

`eslint` is already a devDependency of `@fxl-sales/web` (`apps/web/package.json`), so this
adds no dependency. If loading the flat config inside vitest proves impractical in this
environment, DROP the test entirely and say so in the run notes; do NOT fall back to the
source-string match, which is the thing this section replaced.

Section 15's rule stands either way, and `apps/web/eslint.config.js` is still not edited by
this slice.

---

## 17. Every existing test that must be updated, and exactly how

Nothing in this list may be deleted, skipped, retitled to a weaker claim, or have an assertion
loosened. Where a title names a renamed symbol, the title changes and the assertion does not.

### API

**`apps/api/src/config/__tests__/auth-provider.test.ts`**

Slice 02 rewrote this file and slice 03 removed its `coreModule` assertions. Slice 04 changes
NOTHING in it, and that is the point: the parser underneath is swapped for the SDK's and every
one of slice 02's claims must still hold, unedited, on the real implementation. In particular
slice 02's named tests 19, 20, 21, 22, 23, 24 and 25 are NOT touched here:

- 19 `refuses to boot when FXL_HUB_CONFIG is set beside a discrete variable and names every offender`
- 20 `refuses to boot on a product. audience rather than answering 503`
- 21 `requires FXL_HUB_HEALTH_TOKEN outside development`
- 22 `does not require FXL_HUB_HEALTH_TOKEN in development`
- 23 `projects exactly the Hub variables off the validated env object`
- 24 `no API module derives the Hub audience from a key`
- 25 `never leaks the client secret out of the optional loader`

Test 20 is the one to watch: it asserts `tryLoadHubAuthConfig` THROWS. If the executor finds
themselves wanting to change it, the source is wrong, not the test - see section 2.0.

Test 24 is a SOURCE-GUARD test and it needs a re-point, because it reads
`apps/api/src/config/hub-config.ts`, which section 22.1 deletes. Its CLAIM - no API module
derives the Hub audience from a key - does not die with that file. Re-point it at
`apps/api/src/config/auth-provider.ts` and `apps/api/src/middleware/app-auth.ts`, the two
modules that could plausibly reintroduce a derivation, asserting neither contains
`publishableKey`, `PUBLISHABLE_KEY` or a `pk_` slug regex. The title is unchanged and the
claim is unchanged; only the file list it reads moves, because the file it named is gone.

The two tests section 22.2 MOVES here out of `hub-config.test.ts` arrive with their titles and
assertions unchanged. If slice 02 already spelled the same claim in this file, keep ONE copy
and say in the run notes which duplicate was dropped and why the surviving one is identical.

**`apps/api/src/middleware/__tests__/app-auth.test.ts`**
- The `baseHubAuth` fixture at `:11-18` is REPLACED by `hubAuthContext()` from
  `../../auth/__tests__/hub-auth-context-fixture.js`. Every one of the six
  `getHubLegacyAuthContext` tests keeps its title and its assertion and only changes how the
  input is built, using the overrides:
  `maps Hub account and workspace ids into the Hono auth context`
  (`hubAuthContext({ accountId: 'hub-account-1' })`; that test asserts `userId: 'hub-account-1'`
  while section 7.4's fixture defaults `accountId` to `user_existing_1`, and the fixture default
  does NOT move, so the override is spelled at the call site. The assertion is not edited. Its
  `orgId: 'org_existing_1'` already matches the fixture's `workspaceId` default, so nothing else
  is overridden. Slice 05 states that its roster follows whatever this slice leaves, so it
  accommodates this either way),
  `maps Hub super-admins to the existing admin guard role` (`{ isSuperAdmin: true }`),
  `maps workspace owners and admins to the existing admin guard role` (`{ workspaceRole: 'owner' }` / `'admin'`),
  `maps product admin roles to the existing admin guard role` (`{ productRoles: ['admin'] }`),
  `preserves multiple product roles for downstream app authorization`,
  `does not invent a role for ordinary members without product roles`.
- Whatever slice 03 left in place of the two `hasHubCoreEntitlement` tests keeps its titles
  and only moves onto the fixture. That rule covers the SURVIVING blocks. It does NOT cover the
  two blocks section 23.3 deletes, and the next bullet is the other end of 23.3's
  cross-reference, so the two now agree.
- DELETED here, by section 23.3, in the same commit that deletes the code they test:
  `describe('classifyHubAccess')` and `describe('requireHubModule')`, both added to this file by
  slice 03 step 5a. 23.3 walks their claims one at a time and states which die with
  `classifyHubAccess` and which are MOVED unchanged into
  `app-auth-sdk-gate-wiring.test.ts` (section 23.4). Do not delete anything here that 23.3 does
  not name.
- The IMPORTS those two blocks left behind go with them, because `tsconfig.base.json` sets
  `"noUnusedLocals": true` (verified at HEAD, `:11`), so a leftover import is a `type-check`
  failure and not a lint nit. Concretely: slice 03 adds `import { Hono } from 'hono'` to this
  file solely for the `requireHubModule` probe, and it has no other reader, so it goes.
  `classifyHubAccess`, `hasHubOrgAccess`, `hasHubModule` and `requireHubModule` are removed from
  the `../app-auth.js` import list, since section 23.2 deletes all four exports. The
  `MinimalHubAuthContext` type import goes too once the fixture replaces `baseHubAuth`, unless
  a surviving block still annotates with it: grep the file after the deletions and remove every
  import with no remaining reader, rather than deciding from this list.
- The four `resolveHubRedirectUri` tests and the two `resolveHubPostLogin*` tests are
  UNCHANGED in title and assertion. Their signature change (`string` instead of
  `string | undefined`) does not affect them.

**`apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts`**
- `beforeAll` env stubs: `FXL_HUB_PUBLISHABLE_KEY` becomes `FXL_HUB_CLIENT_ID` with value
  `pk_fxl-sales_development_unittestclientid`; `FXL_HUB_SECRET_KEY` becomes
  `FXL_HUB_CLIENT_SECRET` with value `sk_fxl-sales_development_unittestclientsecret`; add
  `FXL_HUB_ENVIRONMENT=development`; `FXL_HUB_AUDIENCE` becomes `app.fxl-sales`.
  `HUB_SECRET_KEY` stays as the sealer-floor constant used for `HUB_SESSION_ENCRYPTION_KEY`
  reasoning; note it is now the value of `FXL_HUB_CLIENT_SECRET`, so keep it 32 characters or
  longer AND structurally valid: use the `sk_fxl-sales_development_...` form above and pad the
  random segment so the sealer floor is still cleared without a second constant.
- `CapturedBffOptions` gains `insecureCookies?: boolean`, `allowEphemeralSessionStore?: boolean`,
  `healthToken?: string` and `redirectUri?: string`.
- `recordingSession()`: `RecordedCall` op union becomes `'read' | 'update' | 'delete'`; the
  `tx` literal's `get` becomes `read` returning the three-state result (section 4.2).
- Every `{ op: 'get' }` in an assertion becomes `{ op: 'read' }`. Affected titles, all six of
  which keep their assertions:
  `persists the rotated refresh token when the Hub rotates __Host-fxl_hub_session on /auth/refresh`,
  the switch one below,
  `still persists the rotated refresh token when the Hub sends the unprefixed fxl_hub_session`,
  `does not write to the session when the Hub sends no Set-Cookie at all`,
  `answers the accessToken and status the SDK produced, unchanged by the wrapper`,
  `does not leak the Hub Set-Cookie headers to the browser`.
- `persists the rotated refresh token when the Hub rotates __Host-fxl_hub_session on /auth/switch`
  - RETITLE to
  `persists the rotated refresh token when the Hub rotates __Host-fxl_hub_session on an organization switch`.
  The request becomes `POST /auth/refresh` with `content-type: application/json` and body
  `JSON.stringify({ organizationId: 'org-2' })`. `HUB_SWITCH_BODY` becomes
  `{ accessToken: 'AT3', expiresIn: 120, organization: { id: 'org-2', name: 'Segunda' } }`,
  matching the SDK's `readOrganization`. The assertions become: status 200,
  `session.calls` equals `[{ op: 'read' }, { op: 'update', token: 'RT2' }]`,
  `session.stored()` is `'RT2'`, `seen` has length 1, `seen[0]` contains `/auth/refresh` AND
  contains `organizationId=org-2`. That last clause is what proves the switch really rode the
  refresh route rather than an ordinary renewal accidentally passing.
- `reads the __Host- session cookie when secureCookies is on` - RETITLE to
  `reads the __Host- session cookie when insecureCookies is off`. The inline BFF is built with
  a 2.x `HubConfig` (see below) and the option becomes the ABSENCE of `insecureCookies`; the
  `probe` store literal gains `kind: 'persistent' as const` and its handle becomes
  `read`/`update`/`delete`. The assertion is unchanged.
- `hands createHubBff a wrapped fetchImpl rather than the bare global fetch` - UNCHANGED.
- `proves the rotation is genuinely lost without the wrapper, through the same real SDK handler`
  - title UNCHANGED, and it must stay GREEN. Edits: the `probe: HubSessionStore` literal gains
  `kind: 'ephemeral' as const` and the new handle; the inline `HubSdkConfig` becomes a 2.x
  `HubConfig`.
- Every inline config literal in this file (the `secureCookies: true` probe, `realBff()`, and
  the non-vacuity control) becomes:
  ```ts
  const config: HubConfig = {
    apiUrl: 'http://localhost:9016',
    environment: 'development',
    clientId: 'pk_fxl-sales_development_unittestclientid',
    clientSecret: 'sk_fxl-sales_development_unittestclientsecret',
    audience: 'app.fxl-sales',
  };
  ```
  and the `import type { HubSdkConfig }` becomes `import type { HubConfig }`.
- `boots with the blank HUB_SESSION_ENCRYPTION_KEY that .env.dev.example ships` - UNCHANGED.
- `builds a durable session store rather than the SDK in-memory default` - UNCHANGED.
- `hands the durable session store to createHubBff` - UNCHANGED.
- `bounds the upstream Hub call with timeoutMs` - UNCHANGED.
- `wires the SDK session TTLs to the store constants so the two views cannot disagree`
  - UNCHANGED, both literals stay.
- `routes the fxl_hub_session cookie into withSession on /auth/refresh` and
  `routes the fxl_hub_login cookie into consumeLoginTransaction on /auth/callback` - UNCHANGED
  except for any stubbed handle shape.
- `answers 401 to a cookieless POST /auth/refresh, which is the verdict the web classifier keys on`
  and `does not route a neighbouring path, so a moved endpoint cannot pass as a live one`
  - UNCHANGED assertions, config literal updated.
- `mounts the login-supersede middleware on /auth/callback` - UNCHANGED.
- `does not 403 a cross-origin refresh from CORS_ORIGIN, through the real mount` and
  `still 403s a cross-origin refresh from an origin that is not CORS_ORIGIN` - UNCHANGED.
- `answers 503 rather than a cookie-clearing 401 when withSession rejects, through app.route('', authBff)`
  - UNCHANGED.

**`apps/api/src/middleware/__tests__/app-auth-bff-memory-path.test.ts`**
- Same env-stub rename as above, with `FXL_HUB_ENVIRONMENT=development` and
  `FXL_HUB_AUDIENCE=app.fxl-sales`.
- `falls back to the SDK in-memory store` - UNCHANGED assertion (`kind === 'memory'`).
- `still serves /auth/callback without throwing` - UNCHANGED.
- ADD `passes allowEphemeralSessionStore on the memory path, which is the only route to it`
  if the file already captures `bffOptions`; if it does not, add the capture `vi.doMock` in the
  same shape as the wiring test rather than skipping the assertion.

**`apps/api/src/auth/__tests__/hub-session-store.test.ts`**
- Every test slice 01 moved onto `read()` is UNCHANGED here. If slice 01 left any test still
  calling `handle.get()`, move it to `handle.read()` with the three-state result now:
  `does not extend the absolute expiry when the SDK spreads the record back into update`,
  `deletes the row inside the transaction and reports absent when only the absolute expiry has passed`,
  `deletes the row and reports absent when only the sliding expiry has passed`,
  `reports a live record when neither expiry has passed`,
  `hands the SDK both expiries as ISO strings the SDK can Date.parse`.
- The `createHubSessionStore` union tests, the three `withSession failure semantics` tests and
  the two TTL tests are UNCHANGED.

**`apps/api/src/auth/__tests__/hub-bff-origin.test.ts`**
- `buildBff()`: replace the cast literal with a real 2.x `HubConfig`:
  ```ts
  {
    apiUrl: 'https://hub.example.test',
    environment: 'development',
    clientId: 'pk_fxl-sales_development_originshimtest',
    clientSecret: 'sk_fxl-sales_development_originshimtest',
    audience: 'app.fxl-sales',
  }
  ```
  Delete the `as Parameters<typeof createHubBff>[0]` cast. The options object is unchanged:
  `{ sessionStore: new InMemoryHubSessionStore(), fetchImpl: ... }`. `InMemoryHubSessionStore`
  declares `kind: 'ephemeral'` itself, and `environment === 'development'` makes that legal,
  so no `allowEphemeralSessionStore` is needed.
- All ten titles and all ten assertions are UNCHANGED, including
  `does not 403 a refresh from the trusted web origin on a different host` and
  `proves the guard is real by 403ing that same request without the shim`.

**`apps/api/src/auth/__tests__/hub-login-scope.test.ts`**
- All four titles are UNCHANGED, including
  `reads __Host-fxl_hub_session when secureCookies is true`. `hub-login-scope.ts` keeps its
  `secureCookies: boolean` option and its polarity, because the inversion happens once at the
  producer in `app-auth.ts`. Only the comment at `:78` is re-pinned from
  `@fxl-business/hub-sdk@1.3.0 dist/server.js:275-277` to
  `@fxl-business/hub-sdk@2.1.0 dist/server.js:412-413`.

**`apps/api/src/auth/__tests__/hub-rotated-cookie.test.ts`** - all 15 tests UNCHANGED.

**`apps/api/src/auth/__tests__/hub-bff-errors.test.ts`** - all 5 tests UNCHANGED.

**`apps/api/src/auth/__tests__/session-crypto.test.ts`** - UNCHANGED.

**`apps/api/src/domains/sales-ops/__tests__/routes.test.ts`** - the local `hubAuthContext()`
helper is REPLACED by the shared fixture import. Titles and assertions UNCHANGED.

**`apps/api/src/domains/sales-ops/__tests__/history-route.test.ts`** - the inline
`c.set('hubAuth', {...})` literal is REPLACED by `c.set('hubAuth', hubAuthContext({ ... }))`.
Titles and assertions UNCHANGED.

**`apps/api/test/rls/hub-bff-session-store.test.ts`** (integration, needs Postgres)
- Every `tx.get()` becomes `tx.read()` with the three-state result, at the eight call sites
  recon lists. Titles UNCHANGED, including
  `carries a rotated refresh token across store instances`,
  `serializes two concurrent refreshes on one session id so no rotation is lost`,
  `slides expires_at on update instead of persisting the expiresAt the SDK hands back`,
  `does not move absolute_expires_at when a rotation slides expires_at`,
  `makes the superseded session unresolvable through withSession`.
  If slice 01 already did this, this file needs no edit; verify rather than assume.

**`apps/api/test/rls/hub-bff-login-supersede.test.ts`** (integration, needs Postgres)
- `HUB_CONFIG` becomes a 2.x `HubConfig` with `environment: 'development'`,
  `clientId: 'pk_fxl-sales_development_integrationtest'`,
  `clientSecret: 'sk_fxl-sales_development_integrationtest'`, `audience: 'app.fxl-sales'`.
- `secureCookies: false` in the `createHubBff` options becomes `insecureCookies: true`.
  `createHubLoginSupersedeMiddleware(store, { secureCookies: false })` is UNCHANGED, because
  that option belongs to this repo and keeps its polarity.
- Both `tx.get()` call sites become `tx.read()`.
- All three titles UNCHANGED.

### Web

**`apps/web/src/auth/__tests__/react.test.tsx`**
- The `client` mock gains the four new members (section 11).
- The `beforeEach` env stubs: DROP `VITE_FXL_HUB_PUBLISHABLE_KEY`; ADD
  `vi.stubEnv('VITE_FXL_HUB_ENVIRONMENT', 'development')` and
  `vi.stubEnv('VITE_FXL_HUB_AUDIENCE', 'app.fxl-sales')`; keep
  `VITE_FXL_HUB_API_URL='http://hub.test'`.
- The `beforeEach` also stubs `client.login`, `client.logout`, `client.checkoutUrl` and
  `client.manageUrl`; ADD `mocks.client.stop.mockReturnValue(undefined)` and
  `mocks.client.start.mockReturnValue(undefined)` so `stop()` at unmount cannot throw.
- The nine `setActive` mock result literals: `workspaceId:` becomes `organizationId:`
  (section 13.2). Values unchanged.
- `hydrates the provider through the token cache instead of the SDK client` and
  `clears browser token state before SDK logout` gain the `getTokenResult` assertion
  (section 11.1). Titles UNCHANGED.
- `wires the token cache to the BFF refresh endpoint at the same base path as the SDK client`
  - UNCHANGED. Its `expect.objectContaining({ bffBasePath: ... })` still passes with the added
  `autoRenew: false` key, which is exactly what `objectContaining` is for.
- Every other test in the file, all six remaining top-level describes, is UNCHANGED. In
  particular `proactive token renewal`, `session preservation and route restore`,
  `live session loss`, `explicit logout intent`, `identity-scoped query cache` and
  `active organization and the useOrganizations seam` keep every title and every assertion.
  The last of those arrived after this plan was written; see section 24.

**`apps/web/src/__tests__/session-journey.test.tsx`**
- The `client` mock gains the four new members.
- Env stubs: same swap as above.
- The six titles are UNCHANGED, including
  `sends an operator who lost entitlement to /no-role and leaves them there without looping`.

**`apps/web/src/sales-ops/__tests__/session-loss-keeps-route.test.tsx`**
- The `client` mock gains the four new members.
- Env stubs: same swap as above.
- The six titles are UNCHANGED, including
  `keeps the Sales Ops shell and its own component state mounted underneath the overlay`,
  which CLAUDE.md records as the one test out of the suite that catches an unmount fix.

**`apps/web/src/auth/__tests__/refresh.test.ts`** - all 7 tests UNCHANGED. Their staying green
is the proof that section 12's "not adopted" rule was honoured.

**`apps/web/src/auth/__tests__/token.test.ts`** - all 14 tests UNCHANGED, same reason.

**`apps/web/src/auth/__tests__/claims.test.ts`** - all 9 tests UNCHANGED. `roles.workspace` is
still the claim in 2.1.0.

**`apps/web/src/auth/__tests__/session-recovery.test.ts`** - UNCHANGED.

**`apps/web/src/lib/__tests__/api-client-token-guard.test.ts`**,
**`apps/web/src/sales-ops/__tests__/blank-bearer-token.test.tsx`**,
**`apps/web/src/__tests__/no-role-redirect.test.tsx`** - UNCHANGED. Section 15 is what keeps
them that way.

**`apps/web/src/__tests__/route-error-and-auth-context.test.tsx`** - the four existing tests are
UNCHANGED; one is ADDED (section 16.7).

---

## 18. Documentation to update in the same commit

**`CLAUDE.md`**, the Auth Model section, is authoritative house doctrine and must not be left
describing 1.3.1:

- The `sessionStore` paragraph: it is required in EVERY environment as of 2.0.0, not only
  production; `assertConformantSessionStore` now also refuses a store without `kind`; the
  in-memory fallback is reachable ONLY through `allowEphemeralSessionStore`, which is legal
  only when `environment === 'development'`.
- The `HubSessionStore` paragraph: `get()` is `read()` and returns
  `{status:'found'|'expired'|'absent'}`. Say why the distinction is load-bearing: `expired`
  clears the cookie, `absent` never does, so a database blip costs a retry instead of a logout.
  Re-pin the `dist/server.js` line references to 2.1.0.
- The `createHubRotatedCookieFetch` paragraph: 2.1.0 did NOT fix the regex, it is
  byte-identical; `/auth/switch` is DELETED and the second pinned route is now the
  Organization switch riding `POST /auth/refresh` with `{organizationId}`. Delete the
  `dist/server.js:518` reference.
- The version-floor paragraph: the floor is now `@fxl-business/hub-sdk@2.1.0`, pinned EXACTLY
  in both apps. Keep the whole `hono 4.12.28` override paragraph; add one line recording that
  2.1.0's peer is `>=4.12.28` and that `4.12.28` satisfies it, so the override did not move.
- The browser-refresh paragraph: keep the whole "reads /auth/refresh itself" rule. Update the
  reason: 2.x's `getTokenResult()` DOES carry status, so the reason is no longer that the SDK
  discards it; the reason is now that this app's classification, ladder, logout intent and
  cache flushes are specified here and pinned by tests, and adopting the SDK's proactive
  renewal is a separate decision. Record `autoRenew: false` and the `client.stop()` at unmount
  as the two things that keep the SDK's loop from racing this app's.
- The `secureCookies` mentions: the SDK option is `insecureCookies`, inverted and
  development-only; this repo still derives ONE boolean, now from `hubConfig.environment`
  rather than from `NODE_ENV`, and `hub-login-scope.ts` keeps the positive polarity.
- The feature-gate lines: `Feature gates check auth.claims.entitlements.modules` and
  `The core module for this product is sales.core` were replaced by slice 03. Verify they are
  gone; if slice 03 left them, delete them here.
- The ACCESS-GATE block slice 03 wrote in that same replacement. Slice 03 step 10a lands two
  bullets naming code this slice deletes under D2, so after wave 3 the doctrine file would
  describe functions that do not exist. Both must be rewritten here, in the same commit that
  deletes them (section 23.2), and the surrounding access-model bullets stay:
  - `` `classifyHubAccess` in `apps/api/src/middleware/app-auth.ts` is the single authority,
    allows only on `access === true`, and fails CLOSED `` becomes: the SDK's `requireHubAuth`
    is the single authority. It is called with the loaded config and NO options, so
    `allowWithoutAccess` takes its default of `false` and baseline access is enforced inside a
    verified-token path this repo does not own. There is exactly one gate; a local second one
    would mean one live gate and one unreachable one with a green suite over it.
  - The bullet beginning `` `classifyHubAccess`, `hasHubOrgAccess`, `hasHubModule`,
    `requireHubModule` and the 402 branch inside `appAuthMiddleware` are a DELIBERATE ONE-WAVE
    BRIDGE `` is DELETED outright: the bridge is over, the functions are gone, and a doctrine
    file is not a changelog. What survives from it, as one sentence in the replacement above,
    is that a paid add-on module is `requireHubAuth`'s own `requiredModule` option and that no
    route passes one today.
  - The `MinimalHubAuthContext` bullet about `HubEntitlements` degrading to `any` under
    `skipLibCheck` is NOT deleted, but re-point it to what section 7.2 establishes: this repo
    still sets `skipLibCheck: true`, and what changed is that 2.1.0 DECLARES the four contract
    types locally inside `dist/index.d.ts` instead of re-exporting them from an unshipped
    package, so they resolve and `entitlements.access` is genuinely `boolean`. The local
    `MinimalHubAuthContext` is therefore deleted, the types are imported from
    `@fxl-business/hub-sdk` (section 7.1), and the compile-time oracle
    `apps/api/src/auth/__tests__/hub-contract-types.test.ts` is what fails if the degradation
    ever returns.
  - The `no_org_access` deny taxonomy bullets are already correct at 2.1.0 and are left alone
    apart from the `missing_entitlement` literals section 23.6 lists.
- The Environments section: the "Required API vars" and "Required web vars" dotenv blocks must
  match section 14 exactly, with every Hub-issued value shown EMPTY. Remove the committed
  publishable key value from both blocks.
- ADD a short paragraph for `GET /auth/_health`: what it reports, that it is authenticated by
  the operator-generated `FXL_HUB_HEALTH_TOKEN`, that the API refuses to boot without one
  outside development, that this repo 404s it when no token is configured so it can never be
  anonymous, and that its body must never be logged.

**`README.md`** (line numbers verified at HEAD `84ac2a3`; slice 02 edits this file first, so
re-read it before trusting any of them)
- `:5` keep the sentence, it is still true.
- `:7` `The product audience is \`product.fxl-sales\`.` becomes `app.fxl-sales`. Slice 02
  leaves this one for this slice.
- `:24` `A registered FXL Hub OAuth client for \`product.fxl-sales\`.` becomes `app.fxl-sales`.
  Same handoff.
- The API dotenv block (`:43-49`) and the web dotenv block (`:53-59`): match section 14.
  `FXL_HUB_PUBLISHABLE_KEY` becomes `FXL_HUB_CLIENT_ID`, `FXL_HUB_SECRET_KEY` becomes
  `FXL_HUB_CLIENT_SECRET`, and `FXL_HUB_ENVIRONMENT` plus `FXL_HUB_AUDIENCE` are added.
  `VITE_FXL_HUB_PUBLISHABLE_KEY` is REMOVED and replaced by `VITE_FXL_HUB_ENVIRONMENT` and
  `VITE_FXL_HUB_AUDIENCE`. Slice 02 has already emptied the committed
  `pk_fxl-sales_VzQ9-...` value on the API side and left the web line's variable NAME for this
  slice to rename, so expect the literal to be gone before you arrive; if it is still there,
  delete it here and say so in the run notes.
- `:61` "The Hub SDK derives `product.fxl-sales` from the publishable key" is now FALSE twice
  over: nothing derives an audience and there is no publishable key. Delete the sentence.
- `:62` "Only set FXL_HUB_AUDIENCE when an operator explicitly asks for an override" is now
  WRONG: the Audience is required, explicit and validated. Replace both lines with one saying
  the Audience is required on both sides, has the form `app.<slug>`, and is issued by the Hub.
- `:66` remove `/auth/switch` from the route list; the routes are `/auth/login`,
  `/auth/callback`, `/auth/refresh`, `/auth/logout` and `/auth/_health`.
- The Development section below is unchanged.

**`nexo/ROADMAP.md`**
- The `trustedOrigins` item (`:12`): update to record that 2.1.0 still has no allowed-origins
  key, so `hub-bff-origin.ts` stays.
- The rotated-cookie item (`:42`): update to record that 2.1.0 did not fix the regex, so
  `hub-rotated-cookie.ts` stays, and that the delete-signal is unchanged.
- Add an item: adopt the SDK's proactive browser renewal, deliberately deferred, with a
  pointer to the CLAUDE.md paragraph that says why.

---

## 19. Ordered execution sequence

This slice cannot compile halfway, so the order below is the order that keeps the number of
simultaneously broken things smallest and makes every failure legible. Do not reorder.

1. **Preconditions.** Run the six checks at the top of this document. Full green suite on
   `master` before anything else.
2. **Branch.** `git checkout -b feat/sdk-210-flip` off `master`.
3. **RED, tests only, before any source change.** Write every NEW test from section 16 and
   apply every test edit from section 17. Run `pnpm test`. Expect a large red wall, most of it
   `tsc`-level once step 4 lands. Commit nothing yet.
4. **The bump.** Edit both `package.json` files to `"2.1.0"`, run `pnpm install`, run the three
   hono assertions from section 1.2. From here nothing compiles until step 10.
5. **Config.** `apps/api/src/env.ts` then `apps/api/src/config/auth-provider.ts` (sections 2.1,
   2.2). These have no dependants that are not already broken.
6. **Store.** Delete `get()` from `apps/api/src/auth/hub-session-store.ts` and re-pin its header
   (section 4.1).
7. **Types.** Move the four contract imports, delete `MinimalHubAuthContext`, retype the hono
   augmentation, create or edit the fixture module (section 7).
8. **BFF wiring.** `createAppAuthBff()` options, the `secureCookies` derivation, the
   `resolveHubRedirectUri` return type, the `/auth/_health` 404 guard (sections 3, 9).
   `pnpm --filter @fxl-sales/api type-check` should now be clean.
9. **API green.** `pnpm --filter @fxl-sales/api test`. Fix only implementation, never a test.
10. **Web config.** `apps/web/src/auth/provider.ts` and `packages/shared-types/src/env.ts`
    (section 10). Run `pnpm run build:packages` so the web app sees the rebuilt shared types.
11. **Web client.** `apps/web/src/auth/react.tsx`: `autoRenew: false`, `client.stop()` at
    unmount, the `setActive` comment (sections 12, 13).
12. **Web green.** `pnpm --filter @fxl-sales/web type-check` then
    `pnpm --filter @fxl-sales/web test`.
13. **Docstrings.** `hub-rotated-cookie.ts` and `hub-bff-origin.ts` headers (sections 5.2, 6.2),
    and `hub-login-scope.ts`'s re-pinned comment.
14. **Env examples.** The four committed `.env*.example` files (section 14). The two gitignored
    `.env` files are NOT touched.
15. **Docs.** `CLAUDE.md`, `README.md`, `nexo/ROADMAP.md` (section 18).
16. **Full verification.** Section 20.
17. **Commit.** One atomic Conventional Commit:
    `feat(auth)!: migrate both apps to @fxl-business/hub-sdk 2.1.0`
    with a body naming the five contract moves (`read()`, required `sessionStore`,
    `insecureCookies`, `healthToken`, explicit `redirectUri`), the two shims that stay and why,
    and the two retired environment variables. No `--no-verify`.
18. **Report the operator actions** the run cannot perform: the two gitignored `.env` files need
    `FXL_HUB_CLIENT_ID` / `FXL_HUB_CLIENT_SECRET` renamed from the publishable and secret key,
    `FXL_HUB_ENVIRONMENT` set, the Hub-issued `FXL_HUB_AUDIENCE` supplied,
    `FXL_HUB_HEALTH_TOKEN` generated for every non-development deployment, and
    `VITE_FXL_HUB_ENVIRONMENT` plus `VITE_FXL_HUB_AUDIENCE` set on the web side, with
    `VITE_FXL_HUB_PUBLISHABLE_KEY` removed from Vercel's project settings.

---

## 20. The commands that prove it

```bash
cd /Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales

pnpm run lint
pnpm run type-check
pnpm test
pnpm run build
```

All four must be green. `pnpm test` also runs `scripts/no-legacy-auth.mjs` (a `git grep` over
TRACKED files for the removed auth vendor's name, which this plan is careful never to spell)
and `scripts/build-contract.mjs`. Neither may be bypassed and neither may be edited.

The integration suite needs a live Postgres from `docker-compose.yml` (host port 5006) and is
run separately, because it is where the `read()` migration of the two RLS files is proved:

```bash
docker compose up -d db
pnpm --filter @fxl-sales/api test:integration
```

Supplementary assertions, all offline:

```bash
# The SDK really is 2.1.0 in both apps, and there is exactly one copy.
pnpm why @fxl-business/hub-sdk

# Exactly one Hono.
pnpm why hono

# No production source spells a retired name.
grep -rn 'publishableKey\|PUBLISHABLE_KEY\|secretKey\|/auth/switch\|secureCookies:' \
  apps/api/src apps/web/src packages/*/src \
  | grep -v '__tests__' | grep -v 'admin/'      # admin app-registry hits are unrelated

# No secret can reach a log.
grep -rn 'console\.\(log\|info\|warn\|error\)' apps/api/src/auth apps/api/src/middleware
```

The last two are read-and-judge, not pass or fail: `secureCookies:` legitimately survives as
`createHubLoginSupersedeMiddleware`'s own option, and the admin app-registry `publishableKey`
is a different entity. Nothing else may match.

---

## 21. Definition of done

- Both apps resolve `@fxl-business/hub-sdk` at exactly `2.1.0`; `pnpm-lock.yaml` is in the
  commit; the `hono: 4.12.28` override is untouched and there is one Hono copy.
- The BFF boots with `sessionStore` in every environment, `healthToken` outside development,
  `insecureCookies` only in development, and an explicit `redirectUri` on this app's own
  origin.
- `HubSessionTransaction` on this repo's store has exactly `read`, `update`, `delete`.
- `createHubRotatedCookieFetch` still exists, is still wired as `fetchImpl`, and its
  non-vacuity oracle is still GREEN. Its docstring names 2.1.0 and the Organization switch on
  `POST /auth/refresh`.
- `createHubBffOriginShim` still exists, is still the mount, and both its bypass tests and its
  non-vacuity test are GREEN. Its docstring names 2.1.0.
- The four contract types come from `@fxl-business/hub-sdk`, this repo keeps its own
  `hubAuth` augmentation in `apps/api/src/middleware/app-auth.ts`, and a compile-time oracle
  fails if `entitlements.access` ever degrades to `any`.
- The browser config is exactly `{apiUrl, environment, audience}` and can never carry a secret.
  `VITE_FXL_HUB_PUBLISHABLE_KEY` is gone; `VITE_FXL_HUB_ENVIRONMENT` exists;
  `VITE_FXL_HUB_AUDIENCE` is required and the boot error names it.
- The SDK's proactive renewal is not adopted: `autoRenew: false`, `client.stop()` at unmount,
  `start()` never called, and `refresh.ts` / `token.ts` untouched.
- Every Hub-issued value in every committed file is EMPTY, with a comment saying who issues it.
- The API has exactly ONE access gate and it is `requireHubAuth`'s. `hasHubOrgAccess`,
  `hasHubModule`, `requireHubModule`, `classifyHubAccess` and the local 402 branch are gone;
  `requireHubAuth` is called with the loaded config and no options; the wiring pin in section
  23.4 is green; and no tracked file still documents `missing_entitlement` as a code this API
  sends.
- `HubSdkConfig`, `hubSdkConfig` and `getHubSdkConfig` no longer appear in any tracked source,
  and `git grep -n "HubSdkConfig\|getHubSdkConfig" -- apps packages scripts` prints nothing.
- No test was deleted, skipped, retitled to a weaker claim, or had an assertion loosened, with
  ONE named exception that is argued in full: `app-auth-access-gate.test.ts` is deleted, its
  three dead 402-classification claims die with `classifyHubAccess`, and its five surviving
  claims move verbatim into `app-auth-sdk-gate-wiring.test.ts` (section 23.3). Section 16.7's
  formatting-string test was replaced by a stronger one before it was ever written, so nothing
  in the tree was weakened by that either. Slice 02's tests 19 through 25 are untouched.
  The suite count is the pre-slice count plus the new oracles in section 16 and section 23.4,
  minus the three retired claims, and every one is green.
- `pnpm run lint`, `pnpm run type-check`, `pnpm test` and `pnpm run build` are all green, with
  no guard bypassed and no `--no-verify`.

---

## 22. Reconciliation with slices 01 and 02 as they were actually planned

Slices 01 and 02 were written after the body of this plan and each left a NAMED backport that
exists only to keep `master` green on `1.3.1`. This slice deletes both. Their own plans say so
in as many words, so this section is a checklist rather than a decision.

### 22.1 Delete slice 02's backported config module

Slice 02 created `apps/api/src/config/hub-config.ts`, a hand-written backport of the 2.x
`parseHubConfig` / `loadHubConfig` / `HubConfigError` surface, and
`apps/api/src/config/__tests__/hub-config.test.ts` beside it. `apps/api/src/config/auth-provider.ts`
imports from `./hub-config.js`.

Do this:

1. DELETE `apps/api/src/config/hub-config.ts`. `git rm`, not a rename.
2. In `apps/api/src/config/auth-provider.ts` change the single import line
   `import { type HubConfig, HubConfigError, loadHubConfig } from './hub-config.js';`
   to
   `import { HubConfigError, loadHubConfig, type HubConfig } from '@fxl-business/hub-sdk';`
   That is the ONE line slice 02 designed for, and the rest of section 2.1 of this plan
   describes the file it leaves behind.
3. Grep for any other importer of `./hub-config.js` and re-point it the same way:
   ```bash
   grep -rn "hub-config" apps/api/src
   ```

### 22.2 What happens to `apps/api/src/config/__tests__/hub-config.test.ts`

Deleting a whole test file is a weakening unless the code under test is gone AND every claim
those tests made is still made somewhere. Both conditions must be satisfied explicitly. Split
its contents in three:

- **Tests that only re-assert the SDK's own `parseHubConfig` rules** (the ordering of rules 1
  through 14, the individual field messages, the URL protocol rules, the `pk_`/`sk_` shape
  regexes): DELETE with the module. They tested a backport of a dependency; after the bump they
  would be testing the dependency itself, which this repo does not do.
- **Tests that pin THIS repo's boundary behaviour**: MOVE, unchanged in title and assertion,
  into `apps/api/src/config/__tests__/auth-provider.test.ts`. That is at minimum: the
  `tryLoad` form returning `null` for an ABSENT or INCOMPLETE bag (which is the only thing it
  returns `null` for - it does not swallow a `HubConfigError`, see section 2.0), and the
  `HubConfigError.field` shape those tests assert on.
  Slice 02's test 24, `no API module derives the Hub audience from a key`, is the one source
  guard that reads `../hub-config.ts`. It is NOT deleted: its claim is about the API's
  modules, not about that file's contents. Section 17 says exactly where it is re-pointed.
- **Tests that encode this FEATURE's acceptance criteria**: KEEP them, moved into
  `auth-provider.test.ts`, because they are the regression net for the next SDK bump and they
  are named in `00-OVERVIEW.md`'s acceptance list. That is at minimum:
  `refuses FXL_HUB_CONFIG alongside a discrete FXL_HUB_ variable and names the offenders`
  (with the assertion that the message names both offenders and does NOT name the values), and
  `refuses a configured environment that disagrees with the client credential's environment segment`
  (offline, with no network call). Section 16 and section 17 already list both under
  `auth-provider.test.ts`; this is where they come from.

Net effect on the count: no claim is lost, and the tests that survive are the ones about this
repo rather than about the SDK.

### 22.3 Delete slice 01's `EphemeralHubSessionStore`

Slice 01 added, in `apps/api/src/auth/hub-session-store.ts`:

```ts
class EphemeralHubSessionStore extends InMemoryHubSessionStore {
  readonly kind = 'ephemeral' as const;
}
```

It exists only because the INSTALLED `1.3.1` `InMemoryHubSessionStore` has no `kind` and the
2.x contract requires one. `2.1.0`'s `InMemoryHubSessionStore` declares
`readonly kind: "ephemeral"` itself, so the subclass is now pure duplication and its own plan
says slice 04 deletes it.

Do this:

1. DELETE the `EphemeralHubSessionStore` class declaration.
2. The factory's memory branch returns the SDK class directly:
   ```ts
   return { kind: 'memory', store: new InMemoryHubSessionStore() };
   ```
3. The discriminated union's memory arm goes back to the SDK type:
   ```ts
   | { kind: 'memory'; store: HubSessionStore }
   ```
   The `kind: 'durable'` arm keeps `DurableHubSessionStore`, because `withLoginContext` is this
   repo's own member and `app-auth.ts` still narrows on it before mounting the supersede
   middleware. That narrowing must keep working; it is what stops a local machine without
   `DATABASE_URL` from 500ing every `/auth/callback`.
4. In `apps/api/src/auth/__tests__/hub-session-store.test.ts`, slice 01's oracle 7,
   `declares kind persistent on the durable store and ephemeral on the in-process fallback,
   without moving the factory envelope tags`, writes exactly three assertions and NO
   `toBeInstanceOf` of any kind. Slice 01's plan states that exhaustively so this quotation
   cannot drift. They are:
   ```ts
   expect(frozenStore(db).kind).toBe('persistent');   // the durable store
   expect(session.kind).toBe('memory');               // the factory ENVELOPE tag
   expect(session.store.kind).toBe('ephemeral');      // the STORE's own tag
   ```
   All three stay, byte for byte, after `EphemeralHubSessionStore` is deleted, because 2.1.0's
   `InMemoryHubSessionStore` declares `readonly kind: "ephemeral"` itself and the envelope tag
   is this repo's own. Do NOT add an `instanceof` assertion here to "prove" the subclass is
   gone: the class being deleted is proven by it not existing, and slice 01 deliberately kept
   this test property-based so that swapping the implementation class is not a test edit.
5. Slice 01 also flagged one comment in that file whose wording says `absent` where the 2.x
   contract says `expired`. Fix that wording now, as slice 01's plan hands it to this slice. The
   rule to write down is the one the SDK acts on: a row past EITHER expiry is deleted in the same
   transaction and reported `expired`, which clears the browser cookie; a seal that will not open
   is reported `absent` and LEAVES the row, which does NOT clear the cookie, so a wrong key or a
   database blip costs one retry instead of logging every operator out.

### 22.4 `get()` deletion, restated against slice 01's actual shape

Slice 01 implemented `get()` IN TERMS OF `read()`, sharing one resolved value so the two cannot
drift and `get()` cannot trigger a second delete. That makes section 4.1 of this plan a pure
deletion with no behaviour to re-derive: remove the `get` member from the handle literal and
remove `get()` from the handle's declared type. `read()` and the shared resolution stay exactly
as slice 01 wrote them.

After the deletion, run the section 16.4 oracle
(`exposes only read on the transaction handle, so a caller cannot fall back to the deleted get`)
and confirm it is the test that catches a stray `get` rather than a type error alone, because a
handle built through a helper rather than an object literal would not trip excess-property
checking.

---

## 23. Reconciliation with slice 03: the API keeps ONE access gate, and it is the SDK's

Sections 22.1 to 22.4 delete the backports slices 01 and 02 left. Slice 03 left one too, and
its own comments say so: `requireHubModule`'s docblock reads "slice 04 replaces it with
`requireHubAuth`'s own option and deletes this". This section is that deletion.

### 23.1 Why the local gate must GO rather than stay as belt and braces

Verified against the 2.1.0 tarball, `dist/server.d.ts:95-113`. `requireHubAuth`'s taxonomy
table includes:

```
| no Effective Access, without allowWithoutAccess | 402 payment_required / no_org_access |
| requiredModule absent                           | 403 forbidden / missing_module        |
| requiredRoles unmatched                         | 403 forbidden / missing_role          |
```

and `RequireHubAuthOptions.allowWithoutAccess` (`:89`) is documented as "Reach this route even
without Effective Access, for the buy screen. Default false."

Now read the control flow in `apps/api/src/middleware/app-auth.ts`. `appAuthMiddleware` does
not run BESIDE `requireHubAuth`; it runs INSIDE it:

```ts
const authResponse = await hubAuthMiddleware(c, async () => {
  /* the repo's own body - reached ONLY through the next callback */
});
return blockedResponse ?? authResponse;
```

So once `requireHubAuth` denies, the callback is never invoked and the repo's own gate never
executes. After the bump the local 402 is not a second line of defence; it is DEAD CODE with a
green test suite over it, because the file that tests it STUBS `requireHubAuth` and therefore
never sees the SDK gate fire at all. That is the worst of both worlds: a gate nobody runs and
an oracle that cannot tell.

### 23.2 What is deleted from `apps/api/src/middleware/app-auth.ts`

DELETE, in full:

- `hasHubOrgAccess`
- `hasHubModule`
- `requireHubModule`
- `classifyHubAccess`, and the `HubAccessVerdict` type
- the `NO_ORG_ACCESS` constant
- the 402 branch inside `appAuthMiddleware`

KEEP:

- the `!hubAuth` 401 guard, with its `MISSING_HUB_CONTEXT` body. It is not redundant: it fires
  when the SDK calls `next()` without setting a context, which the SDK's own contract does not
  forbid, and answering 401 there is the fail-closed answer.
- the legacy-context assignment: `getHubLegacyAuthContext`, the four `c.set` calls, and
  `await next()`.
- the `503 hub_auth_not_configured` early return, unchanged.

The middleware body becomes, in full:

```ts
  const authResponse = await hubAuthMiddleware(c, async () => {
    const hubAuth = c.get('hubAuth');
    if (!hubAuth) {
      blockedResponse = c.json({ error: 'unauthorized', code: 'missing_hub_context' }, 401);
      return;
    }
    const legacy = getHubLegacyAuthContext(hubAuth);
    c.set('userId', legacy.userId);
    c.set('orgId', legacy.orgId);
    c.set('userRole', legacy.userRole);
    c.set('userRoles', legacy.userRoles);
    await next();
  });
```

`requireHubAuth(hubAuthConfig)` is called with NO options (section 7.5). Passing
`allowWithoutAccess` at all - even `false` - is forbidden here: the default is what carries the
402, and spelling it explicitly invites a future edit to flip it while reading as harmless.

`hasHubOrgAccess`'s fail-closed `=== true` comparison is not lost. It moves INTO the SDK, whose
own gate is documented "All fail closed" on the same table above, and this repo stops owning a
copy of a decision it does not make.

### 23.3 Deleting `apps/api/src/middleware/__tests__/app-auth-access-gate.test.ts`

Deleting a whole test file is a weakening unless the code under test is gone AND every claim
those tests made is still made somewhere. Section 22.2 states that rule; here it is applied
claim by claim. Slice 03 wrote eight `it` blocks in this file.

**Claims that DIE with the code they test.** All three are about the LOCAL 402, which no
longer exists and can no longer be reached even if it did:

- `answers 402 payment_required with no_org_access when entitlements.access is false`
- `answers 402 rather than allowing when the claim set has no access key`
- `answers 402 for a workspace that still carries the deleted core module but no access`

Their subject was `classifyHubAccess`'s treatment of a claim shape. That function is deleted,
and the equivalent decision now happens inside a verified-token path this repo does not own.
The `describe('classifyHubAccess')` and `describe('requireHubModule')` blocks slice 03 added to
`apps/api/src/middleware/__tests__/app-auth.test.ts` are deleted for the same reason and in the
same commit; see section 17's entry for that file.

**Claims that DO NOT die.** Five of the eight are about middleware glue that survives intact,
and they are MOVED, unchanged in title and in assertion, into the new file named in 23.4:

- `allows a protected route when entitlements.access is true` - it also pins that `orgId` is
  the `workspaceId` claim and `userId` the `accountId`, which is this repo's tenancy contract
  and has nothing to do with the gate.
- `answers 401 when the token is missing or invalid`
- `answers 401 missing_hub_context when the SDK calls next without a context`
- `answers 403 for a role the route requires but the entitled token does not carry`
- `lets an entitled workspace owner through the same admin route`

The last two are `requireAdmin` claims riding on `appAuthMiddleware`; the app-level role
mapping is untouched by this slice.

**The claim "a workspace without access gets 402" does NOT die either.** It becomes a WIRING
pin, written next.

### 23.4 NEW file: `apps/api/src/middleware/__tests__/app-auth-sdk-gate-wiring.test.ts`

Same module graph as the file it replaces: `vi.resetModules()`, the Hub env stubbed whole,
`vi.doMock('@fxl-business/hub-sdk/server', ...)` capturing the arguments, then
`await import('../app-auth.js')` in `beforeAll`. Carry the five surviving `it` blocks above
into it verbatim.

Then add the wiring pin, whose two `it` names are:

- `hands requireHubAuth the loaded Hub config, so the SDK verifies against the configured audience`
  Asserts the captured first argument to `requireHubAuth` `toEqual`s the five-member
  `HubConfig` the stubbed environment produces, `audience` included. `toEqual` and not
  `toMatchObject`, so an extra smuggled member fails.
- `never lets the API reach a route without Effective Access, by leaving allowWithoutAccess unset`
  Asserts the captured SECOND argument is `undefined`, or, if a future edit passes options for
  another reason, that `'allowWithoutAccess' in options === false`. A comment quotes
  `dist/server.d.ts:89` - the option defaults to false and the default is what produces the
  `402 payment_required / no_org_access` this product relies on.

**Say plainly what this pin does and does not prove, in the file, in a comment.** It proves the
WIRING: that the SDK gate is constructed with the right config and is not opted out of. It does
NOT prove that a 402 comes back, because the real `requireHubAuth` calls `discover()` over HTTP
on its first request and this run makes no network call to the Hub - which is exactly why slice
03's suite stubbed it in the first place. A wiring pin is the honest CEILING for an offline
test here. The end-to-end proof is the deployed `curl` in section 19 step 18's operator
handoff, and it is not claimed by any test in this repo. Do not write a comment or a title that
implies otherwise.

### 23.5 The response body changes, and why the web is safe

The 402 body goes from `{error: 'payment_required', code: 'missing_entitlement'}` (pre-slice-03)
through `{error: 'payment_required', code: 'no_org_access'}` (slice 03's local gate) to the
SDK's own `{error: 'payment_required', code: 'no_org_access'}`. Slice 03 already moved the
literal deliberately so that this slice changes no contract when it deletes the local gate.

NO WEB PREDICATE CHANGES, and the reason is a rule this repo already wrote down:
`isEntitlementFailure` in `apps/web/src/lib/require-token.ts` keys on `status === 402` ALONE and
deliberately never reads the code. `CLAUDE.md` pins it, and so does the test
`isEntitlementFailure is true for a 402 that carries no code at all` in
`apps/web/src/lib/__tests__/api-client-token-guard.test.ts`. That test MUST SURVIVE VERBATIM.
It is not incidental coverage: it is the single assertion that makes this body change safe, and
if it is ever weakened to require a code, this migration silently routes every entitlement 402
back onto the `Verifique o servidor local` copy the previous release existed to remove.

### 23.6 The stale `missing_entitlement` literals this slice must correct

The code is no longer sent, so the tree must stop documenting it. These are COMMENT, DOC and
FIXTURE edits only. No `it(...)` title may lose a claim, no assertion may loosen, and no
predicate may gain a `code` read.

| file:line | what it is | what to do |
|---|---|---|
| `apps/web/src/lib/api-client.ts:22` | `ApiError.code` docblock: "the only one that matters is `missing_entitlement` on a 402" | say `no_org_access`. Keep the whole rest of the comment, including "classification therefore keys on `status`, never on this field", which is now more load-bearing than before, not less. |
| `apps/web/src/lib/require-token.ts:54` | `isEntitlementFailure`'s docblock quoting the API's exact body | quote `402 {error: 'payment_required', code: 'no_org_access'}` and name the SDK's `requireHubAuth` as the producer rather than `app-auth.ts`, since after this slice the repo no longer writes that body. The FUNCTION BODY is byte-unchanged. |
| `apps/web/src/sales-ops/MissingEntitlementPanel.tsx:14,41` | two prose mentions of `402 missing_entitlement` | say `402 no_org_access`. No rendered copy changes: the panel's visible pt-BR strings never named the code. |
| `apps/web/src/sales-ops/SalesOpsApp.tsx:1819` | the classification-order comment in the `isError` branch | say `402 no_org_access`. The rest of that comment, including why the entitlement branch stays FIRST, is unchanged and is still correct. |
| `apps/web/src/lib/__tests__/api-client-token-guard.test.ts:66,67,71,91,94,102,106,115,119` | one `describe` title, two `it` titles and four fixture bodies carrying the code | rename the code in the FIXTURES and in the titles that quote it. Each test keeps its assertion exactly. The `describe('402 missing_entitlement classification')` becomes `describe('402 no_org_access classification')`; `isEntitlementFailure recognises the 402 missing_entitlement ApiError` and `isAuthFailure is false for the 402 missing_entitlement ApiError` follow it. The test asserting a 402 with NO code at all is untouched - see 23.5. |
| `apps/web/src/sales-ops/__tests__/entitlement-dead-end.test.tsx:86,156,157` | the mocked 402 body and two titles quoting the code | same rename, same rule. |
| `CLAUDE.md`, Organization context section, the `402 {error: 'payment_required', code: 'missing_entitlement'}` line | doctrine | rewrite the body to `no_org_access` and change the producer from `apps/api/src/middleware/app-auth.ts` to `requireHubAuth` in `@fxl-business/hub-sdk`. The paragraph immediately below it, about `isEntitlementFailure` keying on the status alone, is unchanged and stays exactly as it is; add one clause recording that the code moved once and the predicate did not notice, which is the point of keying on the status. |

**These two files are shared with slice 03 and the edits here are ADDITIVE, not a rewrite.**
Slice 03 (wave 2) adds an `isForbiddenFailure` predicate to
`apps/web/src/lib/require-token.ts` and a fifth 403 case to
`apps/web/src/sales-ops/__tests__/entitlement-dead-end.test.tsx`. Slice 04 is wave 3 and lands
on top of that. Read the post-03 file before editing, keep the 403 branch and its test, and
change only the `missing_entitlement` literals listed above. If a 403 docblock also names a
code, leave it alone: 2.1.0's 403 codes are `missing_module` and `missing_role`, which slice 03
already wrote against.

Nothing in `apps/web/src/sales-ops/MissingEntitlementPanel.tsx` changes behaviourally, and the
`[data-missing-entitlement]` marker that `entitlement-dead-end.test.tsx`'s decisive mutation
keys on KEEPS ITS NAME. It is a test hook, not a wire code; renaming it would redden a test for
no gain and lose the mutation oracle's target.

---

## 24. Re-verification against HEAD, and what was stale

This plan was written and parked at `e59f870` on 2026-08-27. The
`feature-20260828-organization-context-escape` run then landed on `master` between that commit
and today's head `84ac2a3`, touching the exact web surface this slice declares. Every section
above has been re-read against the tree at `84ac2a3`. Anything this plan quotes about the web
auth or web error-classification files was re-derived from the tree, not carried over.

**Already shipped, so this slice must NOT create them.** All of these exist at HEAD and any
step that reads as "add" is a cross-reference, not work:

- `ApiError.code` on `apps/web/src/lib/api-client.ts` - shipped, with its own docblock.
- `isEntitlementFailure` in `apps/web/src/lib/require-token.ts` - shipped, keyed on
  `status === 402` alone.
- `apps/web/src/sales-ops/MissingEntitlementPanel.tsx` and
  `apps/web/src/sales-ops/missing-entitlement-copy.ts` - shipped.
- `apps/web/src/sales-ops/__tests__/entitlement-dead-end.test.tsx` and
  `apps/web/src/sales-ops/__tests__/missing-entitlement-panel.test.tsx` - shipped.
- The `useOrganizations` seam in `apps/web/src/auth/react.tsx` (`:1078`) and its
  `describe('active organization and the useOrganizations seam')` block in `react.test.tsx`
  (`:1972`) - shipped, and untouched by this slice apart from the `SetActiveResult` literals.

**Corrections made to this plan as a result:**

| where | was | now |
|---|---|---|
| 11 | "MIGRATION checklist item 12 is a NO-OP here", true at `e59f870`, false at `84ac2a3` | a step owning `MissingEntitlementPanel.tsx:105`, its null-`active` branch, the dep array, the two `react.test.tsx` literals and a declared `missing-entitlement-panel.test.tsx`; `manageUrl` stays a no-op and says why |
| 11.1 | headed `Keeping react.test.tsx:368 meaningful`; there is no such assertion at `:368` | headed by what it does; the two assertions are at `:478` and `:539` and are found by grep |
| 12.3 | did not say where the `createHubClient` call is | names `react.tsx:234` and quotes the current call |
| 12.4 | `nine tests in describe('proactive token renewal') at react.test.tsx:1151-1403`, and "four describes" | the seven current top-level describes with their current start lines, including the new organization one |
| 13.2 | nine `SetActiveResult` literals at nine named line numbers | TEN literals at HEAD, found by shape with a grep recipe that separates them from the claim fixtures |
| 15 | the reader is at `react.tsx:470` | `react.tsx:501` |
| 17, `react.test.tsx` | "all five remaining describes" | six, naming the new one |
| 18, `README.md` | `:6`, `:44-48`, `:54-58`, `:62`, `:66`, `:79` | `:5`, `:7`, `:24`, `:43-49`, `:53-59`, `:61`, `:62`, `:66`, and the handoff from slice 02 on the committed key literal |
| 23.6 | (new section) | its whole table was derived from a grep at HEAD, not from the parked plan |

**One file the D2 cleanup does NOT touch, checked rather than assumed.**
`apps/web/src/sales-ops/missing-entitlement-copy.ts` was named as a candidate. It does not
carry the wire code `missing_entitlement` anywhere: the only matches are the MODULE NAME
`missing-entitlement-copy` and the DOM marker `[data-missing-entitlement]`, and both of those
are deliberately left alone (section 23.6's last paragraph explains why the marker keeps its
name). That file is not in `files_modified`.

`apps/web/src/sales-ops/__tests__/missing-entitlement-panel.test.tsx` was on this list too, and
that was WRONG. It is untouched by the D2 literal cleanup, which is all this paragraph ever
checked, but it IS touched by the `checkoutUrl` signature change in section 11, so it is now
declared in `files_modified` and section 11 says exactly what changes in it.

**A correction this section itself owed, recorded rather than hidden.** The round-1 edit that
landed the "MIGRATION checklist item 12 is a NO-OP" paragraph in section 11 was checked against
this section's own HEAD sweep and passed it, because the sweep looked for SYMBOLS that had
moved and not for ARITIES that had changed. `checkoutUrl` existed at `e59f870` and still exists
at `84ac2a3`, so nothing here flagged it; what changed is that
`feature-20260828-organization-context-escape` gave it a production caller at
`apps/web/src/sales-ops/MissingEntitlementPanel.tsx:105`, and 2.1.0 gave it a required first
parameter. The claim was false at HEAD and would have landed slice 04 red on three commands
section 21 requires green. Section 11 now owns the change. When re-running this section's HEAD
check, compare SIGNATURES against the tarball and not only symbol existence.

**Unchanged and re-confirmed at HEAD, so the plan's steps still apply verbatim:**

- All three `satisfies HubClient` mocks still declare exactly the same six members
  (`login`, `getToken`, `setActive`, `logout`, `checkoutUrl`, `manageUrl`), so section 11's
  four-member addition is still exactly right, and there is no fourth mock site: the new
  `shell-organization-switcher.test.tsx` declares none.
- `apps/web/src/auth/provider.ts` still exports `BrowserHubConfig` and reads
  `VITE_FXL_HUB_PUBLISHABLE_KEY`, so section 10.1 rewrites the file it expects.
- `apps/web/eslint.config.js`'s `callee.name='getToken'` selector is unchanged.
- `apps/api/src/middleware/app-auth.ts` is byte-unchanged since `e59f870`, so sections 3, 7.5
  and 23 quote a live file.

The executor re-runs this check before starting. If anything above has moved again, the tree
is right and this plan is stale; report it rather than adapting silently.
