# Recon — API slice — hub-sdk 1.3.1 → 2.1.0 access model

Factual map only. No design proposed. All paths absolute-from-repo-root
(`/Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales`).

Installed today: `@fxl-business/hub-sdk@1.3.1` (both `apps/api/package.json:19` and
`apps/web/package.json:16` declare `^1.3.1`; `pnpm-lock.yaml:745` and `:3235` resolve
`1.3.1(hono@4.12.28)`).

---

## 1. `apps/api/src/config/auth-provider.ts`

53 lines, zero imports. Full walkthrough.

| Lines | Symbol | Exported | Notes |
|---|---|---|---|
| 1-7 | `type HubAuthConfig` | **yes** | `{ apiUrl, publishableKey, secretKey, audience, coreModule }` — all required `string`. Note `secretKey` is REQUIRED here while the SDK's `HubSdkConfig.secretKey` is optional. |
| 9 | `type EnvLike = Record<string,string\|undefined>` | no | local |
| 11-17 | `parseAudienceFromPublishableKey` | **NO — module-private** | |
| 19-22 | `coreModuleFromAudience` | **NO — module-private** | |
| 24-30 | `required` | no | throws `` `${key} is required for FXL Hub auth` `` |
| 32-45 | `loadHubAuthConfig` | **yes** | |
| 47-53 | `tryLoadHubAuthConfig` | **yes** | try/catch → `null` |

```ts
// apps/api/src/config/auth-provider.ts:11-17
function parseAudienceFromPublishableKey(publishableKey: string): string {
  const match = publishableKey.match(/^pk_([^_]+)_/);
  if (!match?.[1]) {
    throw new Error('FXL_HUB_PUBLISHABLE_KEY must be a Hub publishable key');
  }
  return `product.${match[1]}`;
}

// apps/api/src/config/auth-provider.ts:19-22
function coreModuleFromAudience(audience: string): string {
  const slug = audience.replace(/^product\./, '');
  return `${slug.replace(/^fxl-/, '')}.core`;
}
```

`pk_fxl-sales_VzQ9…` → audience `product.fxl-sales` → coreModule `sales.core`.

```ts
// apps/api/src/config/auth-provider.ts:32-45
export function loadHubAuthConfig(env: EnvLike): HubAuthConfig {
  const apiUrl = required(env, 'FXL_HUB_API_URL');
  const publishableKey = required(env, 'FXL_HUB_PUBLISHABLE_KEY');
  const secretKey = required(env, 'FXL_HUB_SECRET_KEY');
  const audience = env.FXL_HUB_AUDIENCE ?? parseAudienceFromPublishableKey(publishableKey);
  return { apiUrl, publishableKey, secretKey, audience, coreModule: coreModuleFromAudience(audience) };
}
```

### Who imports each exported symbol (whole repo, tests included)

- `HubAuthConfig` — **type is never imported anywhere.** Only referenced inside its
  own file (`auth-provider.ts:1,32,47`). Zero external references.
- `loadHubAuthConfig` — exactly one importer:
  - `apps/api/src/config/__tests__/auth-provider.test.ts:2` (used at `:6`, `:20`).
- `tryLoadHubAuthConfig` — exactly two importers:
  - `apps/api/src/middleware/app-auth.ts:13` → called at `app-auth.ts:84`
    `const hubAuthConfig = tryLoadHubAuthConfig(process.env);` (module top level).
  - `apps/api/src/config/__tests__/auth-provider.test.ts:2` (used at `:28`).
- `parseAudienceFromPublishableKey` / `coreModuleFromAudience` — **not exported, no
  importers, no direct test.** They are only tested transitively through
  `loadHubAuthConfig` in `apps/api/src/config/__tests__/auth-provider.test.ts:5-16`.

### SDK equivalents that exist today and are NOT used

`node_modules/.pnpm/@fxl-business+hub-sdk@1.3.1_hono@4.12.28/node_modules/@fxl-business/hub-sdk/dist/config-CvYwarJp.d.ts:44,53,66`
already exports `loadHubConfigFromEnv`, `deriveAudience`, `parsePublishableKeySlug`.
Grep confirms **zero** references to `loadHubConfigFromEnv` or `deriveAudience`
anywhere in `apps/**`, `packages/**`, `scripts/**` (only historical mentions inside
`nexo/plans/**`). This repo hand-rolls the parse in `auth-provider.ts` instead.

Behavioural difference worth noting: our regex `^pk_([^_]+)_` and the SDK's
`parsePublishableKeySlug` (split on the FIRST `_` after `pk_`) agree; the SDK's
doc-comment at `config-CvYwarJp.d.ts:54-65` documents the same first-underscore rule.

---

## 2. `apps/api/src/middleware/app-auth.ts`

277 lines. Imports at `:1-14`:

```ts
import type { HubSdkConfig } from '@fxl-business/hub-sdk';                 // :1
import { createHubBff, requireHubAuth } from '@fxl-business/hub-sdk/server'; // :2
import { Hono, type MiddlewareHandler } from 'hono';                        // :3
import { hubBffErrorHandler } from '../auth/hub-bff-errors.js';             // :4
import { createHubBffOriginShim } from '../auth/hub-bff-origin.js';         // :5
import { createHubLoginSupersedeMiddleware } from '../auth/hub-login-scope.js'; // :6
import { createHubRotatedCookieFetch } from '../auth/hub-rotated-cookie.js';    // :7
import { SESSION_ABSOLUTE_TTL_MS, SESSION_TTL_MS, createHubSessionStore }
  from '../auth/hub-session-store.js';                                      // :8-12
import { tryLoadHubAuthConfig } from '../config/auth-provider.js';          // :13
import { env } from '../env.js';                                            // :14
```

### 2.1 The claim shape it reads — `MinimalHubAuthContext` (`:18-34`)

```ts
export type MinimalHubAuthContext = {
  accountId: string;
  workspaceId: string;
  claims: {
    entitlements: { modules: string[] };
    roles: { productRoles?: unknown; workspace: string };
    isSuperAdmin?: boolean;
    name?: string;
    email?: string;
  };
};
```

Exact claim field names read anywhere in this file:
`auth.accountId`, `auth.workspaceId`, `auth.claims.entitlements.modules`,
`auth.claims.roles.workspace`, `auth.claims.roles.productRoles`,
`auth.claims.isSuperAdmin`, `auth.claims.name`, `auth.claims.email`.
**There is no `access`, no `products`, no `plan`, no `features` read anywhere.**

This is a locally-declared structural type, NOT the SDK's `HubAuthContext`
(which the SDK re-exports at `dist/index.d.ts:4` from `@fxl-hub/hub-auth`; that
transitive package is not installed as a resolvable `.d.ts` in this workspace —
`find node_modules/.pnpm -path '*@fxl-hub/hub-auth'` returns nothing).

### 2.2 Module-level singletons (`:84-92`, `:153-156`)

```ts
const hubAuthConfig = tryLoadHubAuthConfig(process.env);                     // :84
const hubSdkConfig: HubSdkConfig | null = hubAuthConfig                      // :85-92
  ? { apiUrl: …, publishableKey: …, secretKey: …, audience: hubAuthConfig.audience }
  : null;

const hubAuthMiddleware =                                                    // :153-156
  hubSdkConfig && hubAuthConfig
    ? requireHubAuth(hubSdkConfig, { audience: hubAuthConfig.audience })
    : null;
```

Note `hubSdkConfig` deliberately DROPS `coreModule`; `coreModule` lives only on
`hubAuthConfig` and is used solely at `:171`.

### 2.3 `hasHubCoreEntitlement` (`:111-113`)

```ts
export function hasHubCoreEntitlement(auth: MinimalHubAuthContext, coreModule: string): boolean {
  return auth.claims.entitlements.modules.includes(coreModule);
}
```

Single production call site: `app-auth.ts:171`. Test call sites:
`apps/api/src/middleware/__tests__/app-auth.test.ts:94` and `:99`.

### 2.4 Role derivation (`:52-76`, `:94-109`)

```ts
const fullAccessRoles: AppRole[] = ['admin', 'seller', 'finder'];   // :54
const productRoleOrder: AppRole[] = ['seller', 'finder'];           // :55

export function getAppRolesFromHubClaims(auth): AppRole[] {          // :64-76
  const workspaceRole = auth.claims.roles.workspace;
  if (auth.claims.isSuperAdmin || workspaceRole === 'owner' || workspaceRole === 'admin')
    return fullAccessRoles;
  const productRoles = readProductRoles(auth.claims.roles.productRoles);
  if (productRoles.has('admin')) return fullAccessRoles;
  return productRoleOrder.filter((role) => productRoles.has(role));
}
```

`readProductRoles` (`:57-62`) returns an empty `Set` for any non-array.

`getHubLegacyAuthContext` (`:94-109`) is the ONLY place orgId/userId are derived:

```ts
return {
  userId: auth.accountId,     // :105
  orgId:  auth.workspaceId,   // :106
  userRole,                   // userRoles[0], possibly undefined
  userRoles,
};
```

### 2.5 `appAuthMiddleware` composition and every status code (`:158-184`)

```ts
export const appAuthMiddleware: MiddlewareHandler = async (c, next) => {
  if (!hubAuthMiddleware || !hubSdkConfig) {
    return c.json({ error: 'unavailable', code: 'hub_auth_not_configured' }, 503);   // :160
  }

  let blockedResponse: Response | undefined;
  const authResponse = await hubAuthMiddleware(c, async () => {          // :164 requireHubAuth
    const hubAuth = c.get('hubAuth');
    if (!hubAuth) {
      blockedResponse = c.json({ error: 'unauthorized', code: 'missing_hub_context' }, 401); // :167
      return;
    }
    if (!hubAuthConfig || !hasHubCoreEntitlement(hubAuth, hubAuthConfig.coreModule)) {
      blockedResponse = c.json({ error: 'payment_required', code: 'missing_entitlement' }, 402); // :172
      return;
    }
    const legacy = getHubLegacyAuthContext(hubAuth);
    c.set('userId', legacy.userId);      // :177
    c.set('orgId', legacy.orgId);        // :178
    c.set('userRole', legacy.userRole);  // :179
    c.set('userRoles', legacy.userRoles);// :180
    await next();
  });
  return blockedResponse ?? authResponse;   // :183
};
```

`requireHubAuth` is invoked as a *function*, not mounted: the SDK middleware is
called with a synthetic `next` closure. `appAuthMiddleware`'s own status codes:

| Status | Body (exact) | Line | Condition |
|---|---|---|---|
| 503 | `{"error":"unavailable","code":"hub_auth_not_configured"}` | :160 | Hub env incomplete at module load |
| 401 | `{"error":"unauthorized","code":"missing_hub_context"}` | :167 | SDK called `next()` but `c.get('hubAuth')` is falsy |
| 402 | `{"error":"payment_required","code":"missing_entitlement"}` | :172 | `entitlements.modules` lacks `sales.core` |
| (passthrough) | whatever `requireHubAuth` returned | :183 | SDK verification failure — per `dist/server.d.ts:65-66`, **401** fail-closed on verify failure, **503** on discovery failure |

### 2.6 How `c.get('hubAuth')` is populated

**Not by this file.** It is populated by the SDK's `requireHubAuth` middleware
(`@fxl-business/hub-sdk/server`, which wraps `@fxl-hub/hub-auth`'s `hubAuth`).
`app-auth.ts:78-82` only widens Hono's typing:

```ts
declare module 'hono' {
  interface ContextVariableMap { hubAuth?: MinimalHubAuthContext; }
}
```

Consumers of `c.get('hubAuth')` in product code: `app-auth.ts:165` and
`apps/api/src/domains/sales-ops/routes.ts:65`
(`getHubActorDisplayName(c.get('hubAuth'))`).
Tests set it by hand: `apps/api/src/domains/sales-ops/__tests__/history-route.test.ts:49-57`.

### 2.7 Other exports of this file

- `getHubActorDisplayName` (`:44-50`) — `claims.name` → `claims.email` → `null`.
  Imported by `apps/api/src/domains/sales-ops/routes.ts:4`.
- `getAppRolesFromHubClaims` (`:64`) — exported, no external importer (used at `:100`).
- `getHubLegacyAuthContext` (`:94`) — used at `:176`; test at `app-auth.test.ts:3`.
- `resolveHubRedirectUri` (`:115-127`), `resolveHubPostLoginRedirect` (`:129-131`),
  `resolveHubPostLoginErrorRedirect` (`:133-147`) — used at `:237-239` and in
  `app-auth.test.ts:110-150`.
- `getHubSdkConfig` (`:149-151`) — exported, **zero importers anywhere**.
- `appAuthMiddleware` — imported by `apps/api/src/server.ts:7` (mounted at
  `server.ts:50,61,63,67,69,74,78,86,93`) and `apps/api/src/domains/admin/index.ts:2`
  (`adminRouter.use('*', appAuthMiddleware)` at `index.ts:22`).
- `createAppAuthBff` — imported by `apps/api/src/server.ts:7`.

---

## 3. Env / config layer — `apps/api/src/env.ts`

56 lines. `dotenv` loads `apps/api/.env` then `.env.local` with `override: true`
(`:9-11`). Two preprocessors:

- `emptyToUndefined` (`:17-20`): `'' → undefined`, then `z.string().optional()`.
- `emptyToUndefinedUrl` (`:21-24`): `'' → undefined`, then `z.string().url().optional()`.

`safeParse(process.env)` at `:48`; **`process.exit(1)`** on failure (`:50-53`);
`export const env = parsed.data` (`:55`).

### Full declared schema (`:26-46`)

| Var | Line | Rule | Default |
|---|---|---|---|
| `NODE_ENV` | 27 | `z.enum(['development','test','production'])` | `'development'` |
| `PORT` | 28 | `z.coerce.number().int().positive()` | `3006` |
| `CORS_ORIGIN` | 29 | `z.string().url()` | `'http://localhost:8006'` |
| `DATABASE_URL` | 30 | `emptyToUndefined` | none (optional) |
| `ADMIN_DATABASE_URL` | 32 | `emptyToUndefined` | none |
| `FXL_HUB_API_URL` | 33 | `emptyToUndefinedUrl` | none |
| `FXL_HUB_PUBLISHABLE_KEY` | 34 | `emptyToUndefined` | none |
| `FXL_HUB_SECRET_KEY` | 35 | `emptyToUndefined` | none |
| `FXL_HUB_AUDIENCE` | 36 | `emptyToUndefined` | none |
| `FXL_HUB_REDIRECT_URI` | 37 | `emptyToUndefinedUrl` | none |
| `FXL_HUB_POST_LOGIN_REDIRECT` | 38 | `emptyToUndefinedUrl` | none |
| `FXL_HUB_POST_LOGIN_ERROR_REDIRECT` | 39 | `emptyToUndefinedUrl` | none |
| `HUB_SESSION_ENCRYPTION_KEY` | 42 | `emptyToUndefined` | none |
| `SENTRY_DSN` | 43 | `emptyToUndefinedUrl` | none |
| `PUBLIC_LINK_BASE_URL` | 45 | `emptyToUndefinedUrl` | none |

**There is no other FXL_HUB_* variable declared.** No `FXL_HUB_ISSUER`, no
`FXL_HUB_WEB_URL`, no `FXL_HUB_JWKS_*`.

### Where each is READ

Critical structural fact: **the six `FXL_HUB_*` vars are never read off the validated
`env` object.** `app-auth.ts` passes raw `process.env` into the loaders:

- `app-auth.ts:84` `tryLoadHubAuthConfig(process.env)`
- `app-auth.ts:237-239` `resolveHubRedirectUri(process.env)`, `resolveHubPostLoginRedirect(process.env)`, `resolveHubPostLoginErrorRedirect(process.env)`

So `env.ts`'s FXL_HUB rules are *validation only* (a bad `FXL_HUB_API_URL` kills
boot at `env.ts:52`), never a read path. The one exception is
`env.FXL_HUB_AUDIENCE`… no — `auth-provider.ts:36`'s `env.FXL_HUB_AUDIENCE` is the
*parameter* named `env`, i.e. the passed-in `EnvLike` (= `process.env`), not
`env.ts`'s export. Confirmed: `auth-provider.ts` has zero imports.

Read sites of the validated `env` object across `apps/api/src` (grep, non-test):

| Var | Read at |
|---|---|
| `env.CORS_ORIGIN` | `apps/api/src/middleware/cors.ts:5` (`origin: env.CORS_ORIGIN`); `apps/api/src/middleware/app-auth.ts:275` (`trustedOrigins: [env.CORS_ORIGIN]`) |
| `env.DATABASE_URL` | `apps/api/src/db/client.ts:25,29`; `apps/api/src/middleware/app-auth.ts:206` (`databaseUrlPresent: Boolean(env.DATABASE_URL)`) |
| `env.HUB_SESSION_ENCRYPTION_KEY` | `apps/api/src/middleware/app-auth.ts:215` — **only read site**: `encryptionIkm: env.HUB_SESSION_ENCRYPTION_KEY ?? hubAuthConfig.secretKey` |
| `env.NODE_ENV` | `apps/api/src/routes/health.ts:10`; `apps/api/src/server.ts:109` |
| `env.PORT` | `apps/api/src/server.ts:108`; `apps/api/src/domains/links/routes.ts:41` |
| `env.PUBLIC_LINK_BASE_URL` | `apps/api/src/domains/links/routes.ts:41` |
| `env.ADMIN_DATABASE_URL` | declared but no read in `src/` (integration setup uses `process.env.ADMIN_DATABASE_URL`, `apps/api/test/rls/setup-env.ts:14,22`) |
| `env.SENTRY_DSN` | declared, no read in `src/` |

Raw `process.env` reads in `apps/api/src` (non-test):
`app-auth.ts:203` (`secureCookies`), `:207` (`nodeEnv`), plus `:84,237,238,239`;
`domains/referrals/click-handler.ts:77` (`HASH_SALT_SECRET`);
`db/migrate.ts:6`; `routes/health.ts:11`.

`CORS_ORIGIN` also appears as a *fallback source* inside
`resolveHubRedirectUri` (`app-auth.ts:122`) and `resolveHubPostLoginRedirect`
(`app-auth.ts:130`) — read off the passed `envBag`, i.e. `process.env`.

Operator-facing declarations:
`apps/api/.env.dev.example:10,18,21,24,25,27,28,30,32,33,38,41,44`;
`apps/api/.env.example:4,10-18`; `docker-compose.yml:12` (`CORS_ORIGIN`).
Web side (out of API scope but adjacent): `packages/shared-types/src/env.ts:14-16`
declares `VITE_FXL_HUB_API_URL`, `VITE_FXL_HUB_PUBLISHABLE_KEY`, `VITE_FXL_HUB_AUDIENCE`.

---

## 4. `apps/api/src/auth/hub-session-store.ts`

418 lines; `:1-29` is a doc header pinned to `@fxl-business/hub-sdk@1.3.0`.

Imports (`:30-42`): `AsyncLocalStorage` (node), `randomBytes` (node),
`InMemoryHubSessionStore` + types `HubLoginTransaction`, `HubSessionRecord`,
`HubSessionStore`, `HubSessionTransaction` from `@fxl-business/hub-sdk`;
drizzle `eq, lte, or`; `getAdminDb`; `hubBffLoginTxns, hubBffSessions`;
`createSessionSealer, SessionSealer`.

### 4.1 Constants

- `SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000` (`:48`) — sliding.
- `SESSION_ABSOLUTE_TTL_MS = 90 * 24 * 60 * 60 * 1000` (`:64`) — absolute ceiling.
- `LOGIN_TX_TTL_MS = 10 * 60 * 1000` (`:67`) — pinned to SDK `LOGIN_TX_MAX_AGE_SECONDS = 600`.

### 4.2 The transaction object handed to the caller's `op` — **`get()`, not `read()`**

`withSession` (`:221-296`) builds `handle: HubSessionTransaction` at `:260-285`:

```ts
const handle: HubSessionTransaction = {
  get: async () => (live && token !== null ? toSessionRecord(live, token) : null),   // :261
  update: async (record) => { … },                                                    // :262-281
  delete: async () => { … },                                                          // :282-284
};
return await operation(handle);                                                       // :287
```

- **`get()` returns `Promise<HubSessionRecord | null>`** — i.e.
  `{ hubRefreshToken, accountId?, expiresAt, absoluteExpiresAt }` or `null`.
- There is **no `read()` member**, and no `set()`. Exactly three members.
- Matches the installed SDK contract at
  `…/hub-sdk/dist/session-store-COrln4Ro.d.ts:12-16`:
  `interface HubSessionTransaction { get(); update(record); delete(); }`.

`null` is returned for: no row; row past `expiresAt` OR `absoluteExpiresAt`
(deleted in-transaction at `:247-250`); or a seal that will not open
(`token === null` at `:257-258`, row LEFT IN PLACE).

Lock: `SELECT … FOR UPDATE LIMIT 1` at `:230-235`, taken BEFORE `operation` runs.

`update` (`:262-281`) writes `hubRefreshTokenEnc`, `accountId`, a freshly-slid
`expiresAt = now + SESSION_TTL_MS` (`:271`), `updatedAt`. `absoluteExpiresAt` is
deliberately ABSENT from the `set()` object (`:272-277`).

### 4.3 Does the store declare a `kind` property?

**No — not on the store class.** `PostgresHubSessionStore` (`:128`) has no `kind`.
`kind` is a property of the **factory's return envelope** only
(`createHubSessionStore`, `:370-398`). `DurableHubSessionStore` (`:124-126`) adds
exactly one member over the SDK interface:

```ts
export interface DurableHubSessionStore extends HubSessionStore {
  withLoginContext<T>(context: HubLoginContext, fn: () => Promise<T>): Promise<T>;
}
```

### 4.4 `createHubSessionStore` and its discriminated union (`:370-398`)

```ts
export function createHubSessionStore(deps: {
  databaseUrlPresent: boolean;
  nodeEnv: string;
  encryptionIkm: string;
}):
  | { kind: 'durable'; store: DurableHubSessionStore }
  | { kind: 'memory';  store: HubSessionStore } {
  if (deps.databaseUrlPresent) {
    return { kind: 'durable', store: createDurableHubSessionStore({
      db: getAdminDb(), sealer: createSessionSealer(deps.encryptionIkm) }) };
  }
  if (deps.nodeEnv === 'production') {
    throw new Error('DATABASE_URL is required for the durable Hub BFF session store in production');
  }
  console.warn('[hub-session-store] DATABASE_URL is not set - falling back to the in-process session store; sessions will NOT survive a restart');
  return { kind: 'memory', store: new InMemoryHubSessionStore() };
}
```

The union is load-bearing: `app-auth.ts:250` narrows on `session.kind === 'durable'`
before mounting the supersede middleware, because
`InMemoryHubSessionStore` has no `withLoginContext`.

Also exported: `createDurableHubSessionStore(deps)` (`:344-358`) with a TEST-ONLY
`newId` seam (`:348-355`).

### 4.5 The AsyncLocalStorage login context

- `type HubLoginContext = { priorSessionId: string | undefined }` (`:112`).
- Field: `readonly #loginAls = new AsyncLocalStorage<HubLoginContext>()` (`:133`).
- `withLoginContext<T>(context, fn) { return this.#loginAls.run(context, fn); }` (`:153-155`).
- Consumed in `create()` at `:173`:
  `const priorSessionId = this.#loginAls.getStore()?.priorSessionId;`
  — read OUTSIDE the `db.transaction` callback on purpose.
- `create()` then, inside ONE transaction (`:175-214`): deletes the prior row when
  `priorSessionId !== undefined && priorSessionId !== id` (`:191-193`), then inserts
  with `expiresAt = now + SESSION_TTL_MS` and `absoluteExpiresAt = now + SESSION_ABSOLUTE_TTL_MS`
  (`:205,212`). `data.expiresAt` / `data.absoluteExpiresAt` from the SDK are IGNORED (`:200-204`).
- The filler is `apps/api/src/auth/hub-login-scope.ts:44-59`
  (`createHubLoginSupersedeMiddleware`), which reads the browser cookie name from
  `hubSessionCookieName(options.secureCookies)` (`hub-login-scope.ts:40-42`,
  constants `SESSION_COOKIE = 'fxl_hub_session'` / `SESSION_COOKIE_SECURE =
  '__Host-fxl_hub_session'` at `:33-34`) and calls `store.withLoginContext({ priorSessionId }, …)`.

### 4.6 `toSessionRecord` and expiry serialization (`:85-92`)

```ts
function toSessionRecord(row: HubBffSessionRow, hubRefreshToken: string): HubSessionRecord {
  return {
    hubRefreshToken,
    ...(row.accountId ? { accountId: row.accountId } : {}),
    expiresAt: row.expiresAt.toISOString(),
    absoluteExpiresAt: row.absoluteExpiresAt.toISOString(),
  };
}
```

One direction only (`:74-77`): nothing parses SDK strings back into `Date`.
The header at `:79-84` pins WHY: the SDK does
`now() >= Date.parse(record.absoluteExpiresAt)` (`dist/server.js:424`), and
`Date.parse(<Date object>)` is `NaN`, silently disabling the SDK's expiry gate.
`accountId` is omitted (not `null`) when the column is null.

### 4.7 Error class(es)

Exactly one, `:95-100`:

```ts
export class HubSessionStoreUnavailableError extends Error {
  constructor(message = 'hub session store is unavailable', options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'HubSessionStoreUnavailableError';
  }
}
```

Thrown via the private `#unavailable(message, cause)` (`:157-163`, re-throws an
already-typed cause unchanged, otherwise `console.error` + wrap) from four sites:
`create` → `'hub session create failed'` (`:216`);
`withSession` → `'hub session transaction failed'` (`:294`);
`createLoginTransaction` → `'hub login transaction create failed'` (`:312`);
`consumeLoginTransaction` → `'hub login transaction consume failed'` (`:330`).
Mapped to `503 {"error":"unavailable","code":"session_store_unavailable"}` by
`apps/api/src/auth/hub-bff-errors.ts:23-27`.

Other export: `deleteExpiredHubBffSessions(db)` (`:401-418`), called by the nightly
job; deletes on `expiresAt <= now OR absoluteExpiresAt <= now`.

---

## 5. `apps/api/src/auth/hub-rotated-cookie.ts`

191 lines; `:1-115` is doc. Behaviour lives in `:117-191`.

Constants:
```ts
const ROTATED_COOKIE = 'fxl_hub_session';                                    // :118
const PREFIXED_ROTATED_COOKIE = new RegExp(`^__Host-${ROTATED_COOKIE}=`);    // :125
const UNPREFIXED_ASSIGNMENT = `${ROTATED_COOKIE}=`;                          // :127
const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);                 // :130
```

Exports:
- `assertSetCookieSupport(probe = Headers.prototype)` (`:137-143`) — throws when
  `typeof probe.getSetCookie !== 'function'`. **Invoked unconditionally at module
  load, `:145`.**
- `createHubRotatedCookieFetch(inner?: typeof fetch): typeof fetch` (`:162-191`).

Private `readSetCookies(res)` (`:147-155`) throws rather than degrading.

The wrapper (`:163-190`): resolves `inner ?? globalThis.fetch` **per call** (`:167`);
maps every Set-Cookie through `cookie.replace(PREFIXED_ROTATED_COOKIE, UNPREFIXED_ASSIGNMENT)`
(`:171-175`); returns the ORIGINAL `Response` object when nothing changed (`:179`);
otherwise rebuilds `Headers`, deletes and re-appends `set-cookie` (`:181-183`) and
constructs a new `Response`, moving (not buffering) the body, null for
`NULL_BODY_STATUS` (`:185-189`).

### Every place it is wired in

- `apps/api/src/middleware/app-auth.ts:7` (import) → `app-auth.ts:226`
  `fetchImpl: createHubRotatedCookieFetch(),` inside `createHubBff` options.
  **That is the only production wiring.**
- `apps/api/src/auth/__tests__/hub-rotated-cookie.test.ts` — unit suite (15 tests).
- `apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts:579-767` — end-to-end
  oracles through the real SDK handlers (`:730` asserts `bffOptions?.fetchImpl` is not
  the bare global fetch).
- Not used in `apps/api/test/rls/hub-bff-login-supersede.test.ts` (that file passes its
  own `fetchImpl: stubHub`, `:169`).

---

## 6. Where `createHubBff` is called

Three call sites in the repo.

### 6.1 Production — `apps/api/src/middleware/app-auth.ts:197-277` (`createAppAuthBff`)

```ts
export function createAppAuthBff() {
  if (!hubSdkConfig || !hubAuthConfig) return null;                          // :198-200

  const secureCookies = (process.env.NODE_ENV ?? 'development') === 'production'; // :203

  const session = createHubSessionStore({                                     // :205-216
    databaseUrlPresent: Boolean(env.DATABASE_URL),
    nodeEnv: process.env.NODE_ENV ?? 'development',
    encryptionIkm: env.HUB_SESSION_ENCRYPTION_KEY ?? hubAuthConfig.secretKey,
  });

  const bff = createHubBff(hubSdkConfig, {                                    // :218-240
    sessionStore: session.store,
    fetchImpl: createHubRotatedCookieFetch(),
    secureCookies,
    timeoutMs: HUB_BFF_TIMEOUT_MS,                     // 5_000, const at :195
    sessionTtlSeconds: SESSION_TTL_MS / 1000,          // 2_592_000
    sessionAbsoluteTtlSeconds: SESSION_ABSOLUTE_TTL_MS / 1000,  // 7_776_000
    redirectUri: resolveHubRedirectUri(process.env),
    postLoginRedirect: resolveHubPostLoginRedirect(process.env),
    postLoginErrorRedirect: resolveHubPostLoginErrorRedirect(process.env),
  });
```

That is the ENTIRE options object — nine keys. `now` is not passed.
The first argument `hubSdkConfig` is `{ apiUrl, publishableKey, secretKey, audience }`.

Mounting (`:244-276`):

```ts
  const router = new Hono();                                                  // :244
  if (session.kind === 'durable') {                                           // :250
    router.use('/auth/callback',
      createHubLoginSupersedeMiddleware(session.store, { secureCookies }));    // :251-254
  }
  bff.onError(hubBffErrorHandler);                                            // :267
  router.onError(hubBffErrorHandler);                                         // :268
  router.all('/auth/*', createHubBffOriginShim(bff, { trustedOrigins: [env.CORS_ORIGIN] })); // :275
  return router;                                                              // :276
}
```

**It is NOT `router.route('/', bff)` and NOT `router.route('/auth', bff)`.**
`bff` is invoked through its own `fetch` behind `createHubBffOriginShim`, mounted at
`router.all('/auth/*', …)` (`:275`). The comment at `:269-274` explains: `route()`
re-broke production because of the SDK 1.3.x CSRF origin guard.

In `apps/api/src/server.ts:31-34` the returned router is mounted with an EMPTY path:

```ts
const authBff = createAppAuthBff();
if (authBff) {
  app.route('', authBff);     // server.ts:33
}
```

So effective public paths are `/auth/login`, `/auth/callback`, `/auth/refresh`,
`/auth/switch`, `/auth/logout` on the API origin.

### 6.2 Integration test — `apps/api/test/rls/hub-bff-login-supersede.test.ts:166-182`

```ts
const bff = createHubBff(HUB_CONFIG, {
  sessionStore: store,
  secureCookies: false,
  fetchImpl: stubHub,
  redirectUri: 'http://localhost:8006/auth/callback',
  postLoginRedirect: 'http://localhost:8006',
  postLoginErrorRedirect: 'http://localhost:8006/?error=auth',
});
router = new Hono();
router.use('/auth/callback', createHubLoginSupersedeMiddleware(store, { secureCookies: false }));
router.onError(hubBffErrorHandler);
router.route('', bff);        // NOTE: route(), not the origin shim
```

`HUB_CONFIG` at `:52-58` uses `publishableKey: 'pk_fxl-sales_integration-test-publishable-key'` (`:56`).

### 6.3 Unit tests that build a real BFF directly

- `apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts:346-360` (secureCookies:true probe),
  `:391-398` (route-contract BFF), `:756-761` (non-vacuity control).
- `apps/api/src/auth/__tests__/hub-bff-origin.test.ts:15,32-40`.
- `apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts:101-110` wraps
  `createHubBff` with `vi.doMock` to capture the options object.

---

## 7. Test files touching any of the above, and what breaks

Legend for the four migration axes:
**[C]** SDK config shape change · **[T]** `tx.get()` → `tx.read()` ·
**[S]** `secureCookies` → `insecureCookies` · **[E]** entitlement/access model change.

### 7.1 `apps/api/src/config/__tests__/auth-provider.test.ts` (30 lines, 3 tests)

- `loads the Hub contract for product.fxl-sales` (`:5`) — asserts
  `toMatchObject({ audience: 'product.fxl-sales', coreModule: 'sales.core' })`.
  **BREAKS [C][E]** if `coreModule` leaves `HubAuthConfig`, or if audience derivation
  moves to the SDK's `deriveAudience`/`loadHubConfigFromEnv`.
- `rejects missing secret keys` (`:18`) — `.toThrow(/FXL_HUB_SECRET_KEY/)`.
  **BREAKS [C]** if `secretKey` becomes optional (SDK's `HubSdkConfig.secretKey` already is)
  or if the SDK loader supplies the message.
- `returns null from the optional loader when Hub env is incomplete` (`:27`).
  Survives unless `tryLoadHubAuthConfig` is deleted.

### 7.2 `apps/api/src/middleware/__tests__/app-auth.test.ts` (151 lines, 12 tests)

Fixture `baseHubAuth` at `:11-18` hard-codes
`claims: { entitlements: { modules: ['sales.core'] }, roles: { workspace: 'member' } }`.

- `getHubLegacyAuthContext` block (`:20-90`, 6 tests):
  `maps Hub account and workspace ids into the Hono auth context` (:21),
  `maps Hub super-admins to the existing admin guard role` (:30),
  `maps workspace owners and admins to the existing admin guard role` (:42),
  `maps product admin roles to the existing admin guard role` (:54),
  `preserves multiple product roles for downstream app authorization` (:69),
  `does not invent a role for ordinary members without product roles` (:84).
  **BREAK [E]** — every one constructs the 1.3.x nested claims literal. If 2.1.0
  renames `roles.productRoles` / `roles.workspace` / `isSuperAdmin`, all six fail to
  compile against a new `MinimalHubAuthContext` and/or assert wrong.
- `hasHubCoreEntitlement` block (`:92-108`, 2 tests):
  `accepts the configured core module` (:93) and
  `rejects workspaces without the configured core module` (:97).
  **BREAK [E]** — these are THE entitlement-gate tests. Any move from
  `entitlements.modules: string[]` to an access-object model breaks both, plus the
  `sales.core` literal at `:94` and `:104`.
- `resolveHubRedirectUri` (`:110-137`, 4 tests) and `resolveHubPostLogin*`
  (`:139-151`, 2 tests). Unaffected by [C][T][S][E] — pure env-string helpers.

### 7.3 `apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts` (~770 lines)

Setup stubs the full Hub env at `:87-99` and mocks `@fxl-business/hub-sdk/server`'s
`createHubBff` to capture options (`:101-110`). `CapturedBffOptions` type at `:48-56`
names `sessionStore, fetchImpl, timeoutMs, sessionTtlSeconds, sessionAbsoluteTtlSeconds`.

`describe('createAppAuthBff wiring')`:
- `boots with the blank HUB_SESSION_ENCRYPTION_KEY that .env.dev.example ships` (:234) — safe.
- `builds a durable session store rather than the SDK in-memory default` (:241) — asserts `kind === 'durable'`.
- `hands the durable session store to createHubBff` (:246) — identity check on `bffOptions.sessionStore`. **BREAKS [C]** if the option is renamed.
- `bounds the upstream Hub call with timeoutMs` (:256) — `toBe(5_000)`. **BREAKS [C]** on rename.
- `wires the SDK session TTLs to the store constants so the two views cannot disagree` (:263) — asserts `sessionTtlSeconds === 2_592_000` and `sessionAbsoluteTtlSeconds === 7_776_000` literally. **BREAKS [C]** on any BFF-option rename/restructure.

`describe('createAppAuthBff cookie routing, against the real SDK')`:
- `routes the fxl_hub_session cookie into withSession on /auth/refresh` (:291).
- `routes the fxl_hub_login cookie into consumeLoginTransaction on /auth/callback` (:311).
- **`reads the __Host- session cookie when secureCookies is on` (:332)** — builds a
  real BFF with `secureCookies: true` (`:355`) and a hand-written
  `probe: HubSessionStore` (`:339-345`). **BREAKS [S] and [C] and [T]** — three ways:
  the literal option name at `:355`, the inline `HubSdkConfig` literal at `:347-352`,
  and the four-member store literal.

`describe('the SDK BFF route contract apps/web/src/auth/refresh.ts is coupled to')`:
- `answers 401 to a cookieless POST /auth/refresh, which is the verdict the web classifier keys on` (:405).
- `does not route a neighbouring path, so a moved endpoint cannot pass as a live one` (:413).
  `realBff()` (`:387-403`) builds an inline `HubSdkConfig`. **BREAKS [C]** if the config
  shape changes; also breaks if 2.1.0 changes the cookieless verdict.

`describe('createAppAuthBff login supersede')`:
- `mounts the login-supersede middleware on /auth/callback` (:434) — asserts
  `seen` equals `[{ priorSessionId: 'session-prior' }]`. **BREAKS [S]** only if the
  cookie-name derivation flips (the test uses the unprefixed name).

`describe('createAppAuthBff trusted-origin mount')`:
- `does not 403 a cross-origin refresh from CORS_ORIGIN, through the real mount` (:471).
- `still 403s a cross-origin refresh from an origin that is not CORS_ORIGIN` (:501).
  If 2.1.0 adds a native `trustedOrigins` option (filed in `nexo/ROADMAP.md:12`), the
  first still passes; the SECOND is the one to re-derive.

`describe('createAppAuthBff store outage')`:
- `answers 503 rather than a cookie-clearing 401 when withSession rejects, through app.route('', authBff)` (:519).
  Asserts body `{"error":"unavailable","code":"session_store_unavailable"}` and no `set-cookie`.

`describe('createAppAuthBff rotated Hub session cookie, against the real SDK handlers')` (`:579-741`):
- `persists the rotated refresh token when the Hub rotates __Host-fxl_hub_session on /auth/refresh` (:580)
- `… on /auth/switch` (:605)
- `still persists the rotated refresh token when the Hub sends the unprefixed fxl_hub_session` (:632)
- `does not write to the session when the Hub sends no Set-Cookie at all` (:668)
- `answers the accessToken and status the SDK produced, unchanged by the wrapper` (:689)
- `does not leak the Hub Set-Cookie headers to the browser` (:709)
- `hands createHubBff a wrapped fetchImpl rather than the bare global fetch` (:730)
  **ALL SIX of the first group BREAK [T]**: they assert
  `expect(session.calls).toEqual([{ op: 'get' }, { op: 'update', token: 'RT2' }])`
  against `recordingSession()` (`:178-200`), whose `tx` literal is
  `{ get, update, delete }` (`:185-198`) and whose `RecordedCall` type is
  `{ op: 'get' | 'update' | 'delete' }` (`:170`). A `get()` → `read()` rename
  requires editing the fixture AND every `op: 'get'` assertion.

`describe('the SDK rotation defect this wrapper exists for')`:
- `proves the rotation is genuinely lost without the wrapper, through the same real SDK handler` (:744).
  **This is the designed canary: if 2.1.0 fixes `parseRotatedRefresh`, this test goes
  RED and `hub-rotated-cookie.ts` can be deleted** (stated in the file at `:305-306`
  and in `nexo/ROADMAP.md:42`). Also **BREAKS [T]** (`probe` literal at `:750-755`,
  `session.calls` assertion) and **[C]** (inline `HubSdkConfig` at `:757-762`).

### 7.4 `apps/api/src/middleware/__tests__/app-auth-bff-memory-path.test.ts` (96 lines, 2 tests)

Env stubs `:30-43` incl. `DATABASE_URL: ''`.
- `falls back to the SDK in-memory store` (:72) — asserts `sessionStoreKind === 'memory'`.
- `still serves /auth/callback without throwing` (:77) — expects 302 to
  `http://localhost:8006/?error=auth`.
**BREAKS [C]/[E]** only if `InMemoryHubSessionStore` is removed or the callback
error-redirect behaviour changes in 2.1.0.

### 7.5 `apps/api/src/auth/__tests__/hub-session-store.test.ts` (~365 lines)

Fake drizzle (`:24-72`), frozen clock. Tests:
- `createHubSessionStore` → `falls back to the in-process store outside production` (:126),
  `throws in production when DATABASE_URL is missing` (:141). Assert `result.kind`.
- `withSession failure semantics` → `rejects with HubSessionStoreUnavailableError when the commit fails, and never resolves the operation value` (:153);
  `… when the row lock cannot be taken, and never runs the operation` (:183);
  `… when the operation itself throws` (:201).
- `TTLs` → `pins the login transaction TTL to the SDK cookie max-age` (:227);
  `keeps the session TTL at 30 days and caps it with a 90-day absolute TTL` (:232).
- `absolute session lifetime` →
  `sets the absolute expiry once at create from the store constant, ignoring the value the SDK supplies` (:246);
  **`does not extend the absolute expiry when the SDK spreads the record back into update` (:264)** — body at `:274-278` calls `await handle.get()` then `handle.update({...spread!, …})`. **BREAKS [T]**;
  **`deletes the row inside the transaction and reports absent when only the absolute expiry has passed` (:295)** — `await handle.get()` at `:305`. **BREAKS [T]**;
  **`deletes the row and reports absent when only the sliding expiry has passed` (:315)** — `handle.get()` at `:326`. **BREAKS [T]**;
  **`reports a live record when neither expiry has passed` (:335)** — `handle.get()` at `:344`. **BREAKS [T]**;
  **`hands the SDK both expiries as ISO strings the SDK can Date.parse` (:350)** —
  `handle.get()` at `:360`, then asserts `typeof record?.expiresAt === 'string'` etc. **BREAKS [T]**.

### 7.6 `apps/api/src/auth/__tests__/hub-rotated-cookie.test.ts` (15 tests, `:45-206`)

Titles at `:46,56,69,81,91,100,111,125,138,159,175,187,199,203`. Pure fetch-wrapper
behaviour; no SDK config, no tx. **[C][T][S][E] safe.** Only
`stays correct if the SDK parser is fixed to accept both names` (:175) is a
deliberate forward-compat pin.

### 7.7 `apps/api/src/auth/__tests__/hub-login-scope.test.ts` (4 tests)

`captures the prior session id from the session cookie on /auth/callback` (:45);
`captures nothing on a request that carries no session cookie` (:60);
**`reads __Host-fxl_hub_session when secureCookies is true` (:75)** — helper
`appWith(store, secureCookies)` at `:32`; comment at `:78` pins
`@fxl-business/hub-sdk@1.3.0 dist/server.js:275-277`. **BREAKS [S]**: the boolean's
polarity flips, so the helper argument and the title both invert.
`is not established on any route but /auth/callback` (:94).

### 7.8 `apps/api/src/auth/__tests__/hub-bff-origin.test.ts` (10 tests)

`:55,66,78,85,91,99,108` plus `normalizeOrigin` at `:115,120`. Builds a real BFF at
`:32-40` with an inline config incl. `publishableKey: 'pk_test_origin_shim'` (`:33`).
**BREAKS [C]** on config-shape change; the `proves the guard is real by 403ing that
same request without the shim` test (:66) is the non-vacuity control that goes RED
if 2.1.0 removes or reworks the CSRF guard / adds native `trustedOrigins`.

### 7.9 `apps/api/src/auth/__tests__/hub-bff-errors.test.ts` (5 tests)

`:46,72,88,109,122`. Relies on `HubSessionStoreUnavailableError` identity and the
503 body. **[C][T][S][E] safe**, except `:46`'s title names the `route()` mount.

### 7.10 `apps/api/src/auth/__tests__/session-crypto.test.ts` (10 tests, `:39-108`)

Sealer only. Unaffected.

### 7.11 `apps/api/test/rls/hub-bff-session-store.test.ts` — INTEGRATION, needs Postgres

Titles: `:103,120,136,195,228,253,266,292,306,334,355,372,387,409` plus the
`prior-session supersede at login` block `:456` with `:462,477,499,517,551`.
**Every test that touches a session BREAKS [T]** — `tx.get()` at
`:81, 128, 153, 163, 207, 281, 321, 514`. Named examples:
`carries a rotated refresh token across store instances` (:120),
`serializes two concurrent refreshes on one session id so no rotation is lost` (:136),
`slides expires_at on update instead of persisting the expiresAt the SDK hands back` (:266),
`does not move absolute_expires_at when a rotation slides expires_at` (:306),
`makes the superseded session unresolvable through withSession` (:499).

### 7.12 `apps/api/test/rls/hub-bff-login-supersede.test.ts` — INTEGRATION, needs Postgres

3 tests: `leaves one live session after a re-login in the same browser, and none of the previous ones` (:191),
`does not touch a session held by a second browser` (:207),
`creates a session for a browser that presents no prior one` (:226).
**BREAKS [C]** (`HUB_CONFIG` literal `:52-58`), **[S]** (`secureCookies: false` at
`:167` and `:178`), **[T]** (`tx.get()` at `:204` and `:223`).

### 7.13 Domain tests that carry the claims fixture

- `apps/api/src/domains/sales-ops/__tests__/routes.test.ts:83-93` — `hubAuthContext()`
  with `entitlements: { modules: ['sales.core'] }, roles: { workspace: 'admin' }`.
  **BREAKS [E]** on a claim-shape change.
- `apps/api/src/domains/sales-ops/__tests__/history-route.test.ts:49-57` — same shape
  set via `c.set('hubAuth', …)`. **BREAKS [E]**.

### 7.14 Web-side (out of API scope, listed for coupling)

`apps/web/src/auth/__tests__/provider.test.ts:13` asserts `publishableKey: 'pk_fxl-sales_test'`;
`apps/web/src/auth/claims.ts` + `apps/web/src/auth/__tests__/claims.test.ts` read the
same `workspace`/roles claims; `apps/web/src/auth/react.tsx:2` imports `createHubClient`.

---

## 8. Grep results

### `publishableKey` (28 hits)

```
apps/api/src/config/auth-provider.ts:3,11,12,34,36,40
apps/api/src/middleware/app-auth.ts:88
apps/api/src/db/schema.ts:102                      (admin "apps" table column, unrelated to Hub auth)
apps/api/src/domains/admin/apps/service.ts:129,138 (generatePublishableKey for tenant apps)
apps/api/src/config/__tests__/auth-provider.test.ts  (via FXL_HUB_PUBLISHABLE_KEY, :8,:22)
apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts:348,393,758
apps/api/src/auth/__tests__/hub-bff-origin.test.ts:33
apps/api/test/rls/hub-bff-login-supersede.test.ts:56
apps/web/src/auth/provider.ts:3,11,12,17
apps/web/src/auth/__tests__/provider.test.ts:13
apps/web/src/admin/types.ts:12
apps/web/src/admin/apps/AppsPage.tsx:72,84
apps/web/src/admin/products/__tests__/useProducts.test.ts:75
apps/web/src/i18n/en.json:257 ; apps/web/src/i18n/pt-BR.json:257
```

### `PUBLISHABLE_KEY`

```
apps/api/src/env.ts:34
apps/api/src/config/auth-provider.ts:14,34
apps/api/src/config/__tests__/auth-provider.test.ts:8,22
apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts:92
apps/api/src/middleware/__tests__/app-auth-bff-memory-path.test.ts:37
apps/api/.env.dev.example:25 ; apps/api/.env.example:11
packages/shared-types/src/env.ts:15
apps/web/src/auth/provider.ts:11,13
apps/web/.env.dev.example:11 ; apps/web/.env.example:8
apps/web/src/auth/__tests__/provider.test.ts:9
apps/web/src/auth/__tests__/react.test.tsx:322
apps/web/src/sales-ops/__tests__/session-loss-keeps-route.test.tsx:313
apps/web/src/__tests__/session-journey.test.tsx:376
```

### `sales.core` (7 code hits)

```
apps/api/src/config/__tests__/auth-provider.test.ts:14
apps/api/src/middleware/__tests__/app-auth.test.ts:15,94,104
apps/api/src/domains/sales-ops/__tests__/routes.test.ts:88
apps/api/src/domains/sales-ops/__tests__/history-route.test.ts:53
```
Plus docs: `nexo/plans/feature-20260810-auth-boot-states/03-auth-terminal-states.md:67,343`,
`nexo/plans/20260713-hub-sdk-1-2-reconciliation/01-sdk-contract-baseline.md:42,7`.
**No production source file contains the literal `sales.core`** — it is always derived.

### `coreModule` (6 code hits)

```
apps/api/src/config/auth-provider.ts:6,19,43
apps/api/src/middleware/app-auth.ts:111,112,171
apps/api/src/config/__tests__/auth-provider.test.ts:14
```

### `entitlements` (6 code hits)

```
apps/api/src/middleware/app-auth.ts:22    (type MinimalHubAuthContext)
apps/api/src/middleware/app-auth.ts:112   (auth.claims.entitlements.modules.includes)
apps/api/src/middleware/__tests__/app-auth.test.ts:15,102
apps/api/src/domains/sales-ops/__tests__/routes.test.ts:88
apps/api/src/domains/sales-ops/__tests__/history-route.test.ts:53
```
No hits in `apps/web/src` at all. The whole entitlement surface is six lines.

### `secureCookies` (11 code hits)

```
apps/api/src/middleware/app-auth.ts:203, 225 (comment), 227, 253
apps/api/src/auth/hub-login-scope.ts:37 (comment), 40, 41, 46, 48
apps/api/src/auth/hub-rotated-cookie.ts:46, 52 (comments)
apps/api/src/auth/__tests__/hub-login-scope.test.ts:32
apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts:332, 355, 572, 577
apps/api/test/rls/hub-bff-login-supersede.test.ts:167, 178
```
Producer is a single expression, `app-auth.ts:203`; two consumers,
`createHubBff` (`:227`) and `createHubLoginSupersedeMiddleware` (`:253`).
A `secureCookies` → `insecureCookies` flip needs the polarity inverted at `:203`
and re-derived at `hub-login-scope.ts:40-42`.

### `auth/switch` (4 code hits)

```
apps/api/src/middleware/app-auth.ts:223 (comment)
apps/api/src/auth/hub-rotated-cookie.ts:11 (comment)
apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts:605, 615, 629
```
No API source *routes* `/auth/switch` itself — the SDK owns it
(`dist/server.d.ts:13`). Web side calls it through `HubClient`.

### `setActive` — **zero hits in `apps/**`, `packages/**`, `scripts/**`.**

Only `nexo/plans/feature-20260807-hub-sdk-130-session-hardening/00-OVERVIEW.md:34`
and `nexo/plans/batch-01K9C0FXA7RQ8VZTN3KDM6WS4E/06-combobox-adoption.md:170,524`
(which reference `apps/web/src/auth/react.tsx:235` as prospective work). The current
`apps/web/src/auth/react.tsx` exposes the switch under a different name.

### `loadHubConfigFromEnv` — **zero hits in repo source.**

Present only in the installed SDK d.ts
(`…/hub-sdk/dist/config-CvYwarJp.d.ts:44` and `dist/index.d.ts:1`).

### `deriveAudience` — **zero hits in repo source.**

Only `nexo/plans/20260713-hub-sdk-1-2-reconciliation/01-sdk-contract-baseline.md:91`
and `nexo/runs/20260713-2031-…/agents/execute-repair2-01-…md:19`. Present in the SDK
at `dist/config-CvYwarJp.d.ts:53`.

### `hub-sdk` (code hits, excluding `nexo/`, `pnpm-lock.yaml`)

```
apps/api/package.json:19                         "@fxl-business/hub-sdk": "^1.3.1"
apps/web/package.json:16                         "@fxl-business/hub-sdk": "^1.3.1"
apps/web/vite.config.ts:27                       '@fxl-business/hub-sdk/client' (optimizeDeps/rollup)
apps/api/src/middleware/app-auth.ts:1,2
apps/api/src/auth/hub-session-store.ts:10 (comment), 38
apps/api/src/auth/hub-rotated-cookie.ts:13 (comment)
apps/api/src/auth/hub-bff-origin.ts:4 (comment)
apps/api/src/auth/hub-login-scope.ts:6,29 (comments)
apps/api/src/db/schema.ts:953 (comment)
apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts:6,27,28,101,102,279,333,334,388,389,745,746
apps/api/src/auth/__tests__/hub-session-store.test.ts:1,228
apps/api/src/auth/__tests__/hub-bff-errors.test.ts:7
apps/api/src/auth/__tests__/hub-bff-origin.test.ts:4,14,15
apps/api/src/auth/__tests__/hub-rotated-cookie.test.ts:6
apps/api/src/auth/__tests__/hub-login-scope.test.ts:78
apps/api/test/rls/hub-bff-login-supersede.test.ts:27,28
apps/api/test/rls/hub-bff-session-store.test.ts:19,452
apps/web/src/auth/react.tsx:2 ; apps/web/src/auth/refresh.ts:5 (comment)
apps/web/src/auth/__tests__/react.test.tsx:3,34,47
apps/web/src/sales-ops/__tests__/session-loss-keeps-route.test.tsx:3,34,46
apps/web/src/__tests__/session-journey.test.tsx:27,58,67
CLAUDE.md:11,32,34,59 ; README.md:6 ; nexo/ROADMAP.md:11,12,20,26,38-42
```

**Only FOUR production API files import from the SDK at all:**
`middleware/app-auth.ts` (`@fxl-business/hub-sdk` type + `/server` values) and
`auth/hub-session-store.ts` (`@fxl-business/hub-sdk` values+types). The other three
`auth/*.ts` files reference it only in comments.

### `workspace` — counts per file (noisy; auth-relevant hits called out)

| Count | File |
|---|---|
| 76 | `apps/web/src/sales-ops/__tests__/navigation.test.ts` |
| 75 | `apps/web/src/auth/__tests__/react.test.tsx` |
| 41 | `apps/web/src/auth/react.tsx` |
| 26 | `apps/web/src/sales-ops/SalesOpsApp.tsx` |
| 25 | `apps/web/src/sales-ops/navigation.ts` |
| 16 | `apps/web/src/sales-ops/__tests__/routing.test.tsx` |
| 12 | `apps/web/src/sales-ops/__tests__/session-loss-keeps-route.test.tsx` |
| 12 | `apps/web/src/auth/__tests__/claims.test.ts` |
| 11 | `apps/web/src/auth/__tests__/token.test.ts` |
| 9 | `apps/web/src/__tests__/session-journey.test.tsx` |
| **8** | **`apps/api/src/middleware/__tests__/app-auth.test.ts`** |
| 8 | `apps/api/src/domains/finders/admin-service.ts` (SQL/tenant, not Hub) |
| 6 | `apps/api/src/domains/sales-ops/__tests__/routes.test.ts` |
| 6 | `apps/api/src/domains/finders/__tests__/finder-state-machine.integration.test.ts` |
| **5** | **`apps/api/src/middleware/app-auth.ts`** |
| 5 | `apps/api/src/db/schema.ts` |
| 3 | `apps/web/src/components/auth/RoleGuard.tsx`, `apps/web/src/auth/claims.ts` |
| 3 | `apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts` |
| 2 | `apps/web/src/sales-ops/__tests__/pessoas-funcoes-view.test.tsx`, `apps/web/src/__tests__/no-role-redirect.test.tsx`, `apps/api/test/rls/{referral-links-public-lookup,list-finder-links-cross-tenant,cross-tenant}.test.ts`, `apps/api/src/domains/sales-ops/__tests__/history-route.test.ts`, `apps/api/src/domains/links/service.ts` |
| 1 | `apps/web/src/sales-ops/__tests__/{optimistic-row-guard,cadastros-refresh}.test.tsx` |

Auth-relevant hits in API production code (the five in `app-auth.ts`):
`:19` `workspaceId: string`; `:24` `roles: { … workspace: string }`;
`:65` `const workspaceRole = auth.claims.roles.workspace`;
`:66` `workspaceRole === 'owner' || workspaceRole === 'admin'`;
`:106` `orgId: auth.workspaceId`.
In `app-auth.test.ts`: `:13` `workspaceId: 'org_existing_1'`, `:16`, `:42`, `:48`,
`:60`, `:75` (claim literals), `:21` (title). All of these are the [E] surface.

### `product.` — counts per file (noisy; auth-relevant called out)

| Count | File |
|---|---|
| 64 | `apps/api/test/rls/product-funcao-costs-rls.test.ts` |
| 50 | `apps/web/src/sales-ops/SalesOpsApp.tsx` |
| 12 | `apps/api/test/rls/cadastro-purge.test.ts` |
| 10 | `apps/api/test/rls/proposal-write.test.ts` |
| 8 | `apps/api/src/domains/sales-ops/service.ts` |
| 7 | `apps/web/src/admin/products/ProductsPage.tsx` |
| 5 | `apps/api/test/rls/product-commission-contract.test.ts` |
| **4** | **`apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts`** — `'product.fxl-sales'` at `:94, 351, 396, 761` |
| 2 | `apps/api/test/rls/{sale-professional-funcoes,produtos-servicos-schema-migration}.test.ts`, `apps/web/src/sales-ops/calculations.ts`, `apps/web/src/admin/products/useProducts.ts` |
| **2** | **`apps/api/src/config/__tests__/auth-provider.test.ts`** — `'product.fxl-sales'` at `:13` (+ describe title `:5`) |
| **2** | **`apps/api/src/auth/__tests__/hub-rotated-cookie.test.ts`** — incidental prose |
| **1** | **`apps/api/src/config/auth-provider.ts:16`** — `` return `product.${match[1]}` `` (and `:20` regex `/^product\./`) |
| **1** | **`apps/api/src/middleware/__tests__/app-auth-bff-memory-path.test.ts:39`** — `vi.stubEnv('FXL_HUB_AUDIENCE', 'product.fxl-sales')` |
| **1** | **`apps/api/src/auth/hub-bff-origin.ts`** — prose |
| **1** | **`apps/api/test/rls/hub-bff-login-supersede.test.ts`** — `audience: 'product.fxl-sales'` (in `HUB_CONFIG`, `:52-58`) |
| 1 | `apps/api/src/domains/admin/products/service.ts`, `apps/api/src/domains/links/service.ts`, `apps/api/test/rls/cadastro-archive-audit.test.ts`, `apps/web/src/admin/products/{ProductDetail,ProductDialog}.tsx`, `apps/web/src/admin/products/__tests__/useProducts.test.ts`, `apps/web/src/sales-ops/__tests__/sale-margin-parity.test.ts` |

The rest is the product-catalog domain (`product.id`, `product.nome`), unrelated.

---

## 9. Does `entitlements.access` appear anywhere?

**REFUTED.** `grep -rn 'entitlements\.access\|entitlements\["access"\]' .` over the
entire repository (node_modules and .git excluded) returns **zero hits** — no source,
no test, no plan, no doc, no fixture. The only entitlement expression in the repo is
`auth.claims.entitlements.modules` (`apps/api/src/middleware/app-auth.ts:112`) and its
five test fixtures.

---

## 10. Test suite layout and how it runs

### Split mechanism — `apps/api/vitest.config.ts` (41 lines)

`const isIntegration = process.env.VITEST_INTEGRATION === '1';` (`:17`).

**Unit branch** (`:35-41`):
```
include: ['src/**/__tests__/**/*.test.ts']
exclude: ['node_modules/**','dist/**','test/rls/**','src/**/*.integration.test.ts']
passWithNoTests: true
NO globalSetup, NO setupFiles  → needs NO database
```

**Integration branch** (`:20-34`):
```
include: ['test/rls/**/*.test.ts', 'src/**/*.integration.test.ts']
globalSetup: ['./test/rls/global-setup.ts']     // runs drizzle migrations first
setupFiles:  ['./test/rls/setup-env.ts']
testTimeout: 30000, hookTimeout: 30000
fileParallelism: false                          // serial: shared test DB
```

### Commands

- `apps/api/package.json:11` — `"test": "vitest run"`
- `apps/api/package.json:12` — `"test:integration": "VITEST_INTEGRATION=1 vitest run"`
- Root `package.json` — `"test": "pnpm run build:packages && pnpm -r --if-present test && node scripts/no-legacy-auth.mjs && node scripts/build-contract.mjs"`
- Documented in `CLAUDE.md:407-413`:
  ```
  pnpm run lint
  pnpm run type-check
  pnpm test
  pnpm run build
  pnpm --filter @fxl-sales/api test:integration
  ```
  and `CLAUDE.md:416` notes `pnpm test` also runs a tracked-file guard
  (`scripts/no-legacy-auth.mjs`, a `git grep` for the removed auth vendor name).
- Single-file form used in plans:
  `pnpm --filter @fxl-sales/api test -- src/middleware/__tests__/app-auth.test.ts`.

### Which tests need a live Postgres

**Integration only — the 24 files in `apps/api/test/rls/`** plus any
`src/**/*.integration.test.ts` (today: `apps/api/src/domains/finders/__tests__/finder-state-machine.integration.test.ts`
and `apps/api/src/domains/sales-ops/__tests__/sale-transitions.integration.test.ts`).

Auth-relevant DB-backed files:
`apps/api/test/rls/hub-bff-session-store.test.ts`,
`apps/api/test/rls/hub-bff-login-supersede.test.ts`.

DB URL resolution (`apps/api/test/rls/setup-env.ts:3-23`):
`TEST_DATABASE_URL ?? DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5006/fxl_sales'`,
with `process.env.DATABASE_URL` HARD-overridden (`:21`, not `??=`) so an `.env`
pointing at a remote environment cannot leak in. Admin URL falls back to the app URL
(`:13-15`). Migrations run in `global-setup.ts:15-22` via
`runDatabaseMigrations({ databaseUrl, migrationsFolder: './drizzle' })`.

Local Postgres comes from `docker-compose.yml` (`postgres:16-alpine`, host port
**5006** → container 5432, db `fxl_sales`, user/pass `postgres`).

**Every auth unit test listed in §7.1-§7.10 runs with NO database.** Notably
`app-auth-bff-wiring.test.ts:89` stubs `DATABASE_URL` to
`postgresql://postgres:postgres@localhost:5006/fxl_sales_wiring_test` purely so
`createHubSessionStore` takes the `kind: 'durable'` branch — no socket is opened,
because `postgres-js` builds the pool lazily (`hub-session-store.ts:378-380`) and every
test stubs `withSession`/`consumeLoginTransaction` before issuing a request.

---

## Appendix — installed SDK 1.3.1 contract (for the diff against 2.1.0)

`node_modules/.pnpm/@fxl-business+hub-sdk@1.3.1_hono@4.12.28/node_modules/@fxl-business/hub-sdk/dist/`

- `index.d.ts:1` re-exports `HubSdkConfig, HubDiscovery, deriveAudience, discover, loadHubConfigFromEnv, parsePublishableKeySlug, __clearDiscoveryCache`.
- `index.d.ts:4` re-exports `HubAuthContext, HubEntitlements, HubRoles, HubTokenClaims` from `@fxl-hub/hub-auth`.
- `index.d.ts:118` `HUB_SDK_VERSION = "1.3.1"`; `:139` `type HubWorkspaceRole = 'owner' | 'admin' | 'member'`.
- `config-CvYwarJp.d.ts:5-22` `HubSdkConfig { apiUrl; publishableKey; secretKey?; audience? }`.
- `session-store-COrln4Ro.d.ts:12-16` `HubSessionTransaction { get(); update(record); delete(); }`.
- `session-store-COrln4Ro.d.ts:17-22` `HubSessionStore { create; withSession; createLoginTransaction; consumeLoginTransaction }`.
- `server.d.ts:28-50` `CreateHubBffOptions { sessionStore?; fetchImpl?; redirectUri?; postLoginRedirect?; postLoginErrorRedirect?; secureCookies?; now?; timeoutMs?; sessionTtlSeconds?; sessionAbsoluteTtlSeconds? }`.
- `server.d.ts:53-58` `RequireHubAuthOptions { audience?; fetchImpl? }`.
- `server.d.ts:9-15` route table: `/auth/login`, `/auth/callback`, `/auth/refresh`, `/auth/switch`, `/auth/logout`.

Two local shims exist purely to correct 1.3.x behaviour and each carries its own
delete-signal test:
- `apps/api/src/auth/hub-bff-origin.ts` — CSRF origin guard; delete when a native
  `trustedOrigins` lands (`nexo/ROADMAP.md:12`).
- `apps/api/src/auth/hub-rotated-cookie.ts` — `parseRotatedRefresh` `__Host-` miss;
  delete when the SDK regex is fixed, signalled by
  `proves the rotation is genuinely lost without the wrapper` going RED
  (`hub-rotated-cookie.ts:105-114`, `nexo/ROADMAP.md:42`).
