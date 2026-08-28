# Recon: `@fxl-business/hub-sdk` 2.1.0 + `@fxl-business/hub-sdk-testing` 2.1.0 — exact shipped API surface

Source: unpacked npm tarballs.
- A = `@fxl-business/hub-sdk@2.1.0`
- B = `@fxl-business/hub-sdk-testing@2.1.0`

Everything below is quoted from the shipped `dist/*.d.ts` and `dist/*.js`. No inference unless flagged.

---

## 1. package.json

### A — `@fxl-business/hub-sdk@2.1.0`

- `"version": "2.1.0"`, `"type": "module"`
- `"main": "./dist/index.cjs"`, `"module": "./dist/index.js"`, `"types": "./dist/index.d.ts"`
- **exports map — exactly three subpaths**:

```json
"exports": {
  ".":       { "import": { "types": "./dist/index.d.ts",  "default": "./dist/index.js"  },
               "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" } },
  "./server":{ "import": { "types": "./dist/server.d.ts", "default": "./dist/server.js" },
               "require": { "types": "./dist/server.d.cts","default": "./dist/server.cjs"} },
  "./client":{ "import": { "types": "./dist/client.d.ts", "default": "./dist/client.js" },
               "require": { "types": "./dist/client.d.cts","default": "./dist/client.cjs"} }
}
```
There is **no `./testing`, no `./sql`, no `./schema` subpath**. The SQL DDL is shipped as a plain file at `schema/session-store.sql` (reachable only by filesystem path, not by an exports subpath).

- `"files": ["dist", "schema", "MIGRATION.md"]`
- `"dependencies": { "jose": "^5.9.6" }`  ← the only runtime dependency
- `"peerDependencies": { "hono": ">=4.12.28" }`  ← **open-ended `>=`, no upper bound**. devDependency pins `hono: 4.12.28` (exact) for its own build.
- Notable devDeps (bundled into dist via tsup `noExternal`, NOT shipped as deps): `@fxl-hub/hub-auth@1.0.0`, `@fxl-hub/shared-types@1.0.0`. Confirmed by dist: `server.js` inlines `../hub-auth/src/verify.ts`, `../hub-auth/src/middleware.ts`, `../hub-auth/src/errors.ts`.
- `zod@3.25.76` is **bundled inside `dist/chunk-XLQCNQ5D.js`** (a full copy of zod v3 external.js). It is NOT used by the Hub config validator — see §2.1.

### B — `@fxl-business/hub-sdk-testing@2.1.0`

- `"version": "2.1.0"`, `"type": "module"`, `"private": false`
- exports map: **one subpath only**, `"."` → `./dist/index.js` / `./dist/index.cjs`, types `./dist/index.d.ts` / `.d.cts`
- `"files": ["dist"]`
- `"peerDependencies": { "@fxl-business/hub-sdk": "2.1.0" }`  ← **exact pin, not a range**
- **No `dependencies` field at all.** Zero runtime dependencies.
- devDependencies include `@fxl-business/hub-sdk@2.1.0` and `@fxl-hub/shared-types@1.0.0`.

**Does B depend on A?** Only as a **peer**, and only **type-only**. Verified in dist:
- `dist/index.d.ts` line 1-2 imports types: `import { HubWorkspaceRole, HubTokenClaims } from '@fxl-business/hub-sdk';` and `import { HubClient } from '@fxl-business/hub-sdk/client';`
- `dist/index.js` has **zero `import` statements and zero `require(` calls** (grep for `^import|require(|fetch(|XMLHttp` returns nothing). The compiled JS is entirely self-contained.

**Is B safe as devDependency-only?** Yes, and that is the documented and enforced design. Its own package.json comment: *"DEVELOPMENT ONLY. A consumer MUST declare this in devDependencies, never dependencies… The SDK is a PEER imported TYPE-ONLY, so the published dist takes no runtime dependency on anything at all."* Because the SDK is a *peer* and is imported *type-only*, a devDependency install of B in an app that already has A satisfies the peer; and `pnpm deploy --prod` / `npm install --omit=dev` drop B entirely.

---

## 2. Type surface per subpath

### 2.1 `@fxl-business/hub-sdk` (root, `dist/index.d.ts`)

Re-exported from the shared `config-CxunTdjI.d.ts`:
`HubConfig`, `HubConfigError`, `HubDiscovery`, `HubEnvironment`, `HubPublicConfig`, `ParsedClientId`, `__clearDiscoveryCache`, `discover`, `loadHubConfig`, `loadHubPublicConfig`, `parseClientId`, `parseHubConfig`, `toPublicConfig`.

Re-exported from `session-store-DOWOoBx8.d.ts`:
`HubSessionReadResult`, `HubSessionStoreKind`, `InMemoryHubSessionStore`, plus (via the local export list) `HubLoginTransaction`, `HubSessionRecord`, `HubSessionStore`, `HubSessionTransaction`.

Declared locally and exported (verbatim final export line of `dist/index.d.ts`):

```ts
export { HUB_SDK_VERSION, HUB_TOKEN_CONTRACT_VERSION, type HubAuthContext, type HubEntitlements, HubLoginTransaction, type HubRoles, HubSessionRecord, HubSessionStore, HubSessionTransaction, type HubTokenClaims, type HubTokenWorkspacesEntry, type HubWorkspaceRole, ORGANIZATION_PATH_PREFIX, type OrganizationPath, SqlHubSessionStore, type SqlHubSessionStoreOptions, type SqlSessionAdapter, organizationPath, parseOrganizationPath, withOrganization };
```

#### Config types (verbatim, `dist/config-CxunTdjI.d.ts`)

```ts
type HubEnvironment = 'production' | 'staging' | 'development';

interface HubConfig {
    apiUrl: string;
    environment: HubEnvironment;
    clientId: string;
    clientSecret: string;
    audience: string;
}

interface HubPublicConfig {
    apiUrl: string;
    environment: HubEnvironment;
    audience: string;
}

interface ParsedClientId { slug: string; environment: HubEnvironment; }

declare class HubConfigError extends Error {
    readonly field: string;
    constructor(field: string, message: string);
}

declare function parseClientId(clientId: string): ParsedClientId | null;
declare function parseHubConfig(value: unknown): HubConfig;
declare function toPublicConfig(config: HubConfig): HubPublicConfig;
declare function loadHubConfig(env: Record<string, string | undefined>): HubConfig;
declare function loadHubPublicConfig(env: Record<string, string | undefined>): HubPublicConfig;

interface HubDiscovery {
    issuer: string;
    authorizationEndpoint: string;
    tokenEndpoint: string;
    fxlWebUrl: string;
    jwksUri: string;
}
declare function __clearDiscoveryCache(): void;
declare function discover(apiUrl: string, fetchImpl?: typeof fetch): Promise<HubDiscovery>;
```

**"The config zod schema shape" — there is NO zod schema.** Despite zod being bundled in `chunk-XLQCNQ5D.js`, `parseHubConfig` is hand-rolled imperative validation. `grep 'z\.object'` over the config section returns nothing; the code path is `function parseHubConfig(value) { if (!isRecord(value)) throw new HubConfigError('FXL_HUB_CONFIG', ...) ... }`. Plan against `parseHubConfig`, not against an exported schema object — none is exported.

**Validation rules actually enforced by `parseHubConfig` (in order):**
1. value must be a non-array object → `HubConfigError('FXL_HUB_CONFIG')`
2. `environment` ∈ `["production","staging","development"]` → field `environment`
3. `apiUrl` non-empty string → field `apiUrl`
4. `apiUrl` parses as `new URL()` → field `apiUrl`
5. protocol must be `http:` or `https:` → field `apiUrl`
6. protocol must be `https:` unless `environment === 'development'` → field `apiUrl`
7. `apiUrl` trailing slashes trimmed (`/\/+$/`)
8. `clientId` non-empty → field `clientId`
9. `clientId` matches `pk_<slug>_<environment>_<random>` where `slug` matches `/^[a-z0-9-]+$/`, `environment` is the full word, `random` matches `/^[A-Za-z0-9_-]+$/` → field `clientId`
10. `parsedClientId.environment === environment` → field `environment`
11. `clientSecret` non-empty and matches `sk_<slug>_<environment>_<random>` → field `clientSecret`
12. `clientSecret` slug+environment must equal clientId's → field `clientSecret`
13. `audience` must match `/^app\.[a-z0-9-]+$/` → field `audience`
14. `audience` must equal `` `app.${parsedClientId.slug}` `` → field `audience`

`parsePublicConfig` (internal, used by `loadHubPublicConfig`, not exported) enforces 1,2,3,4,6,13 only — it does **not** require `audience === app.<slug>` agreement and it silently ignores any `clientSecret` present.

#### Env var names read (exhaustive, from `dist/chunk-XLQCNQ5D.js`)

```js
var DISCRETE_ENV_VARS = [
  "FXL_HUB_API_URL",
  "FXL_HUB_ENVIRONMENT",
  "FXL_HUB_CLIENT_ID",
  "FXL_HUB_CLIENT_SECRET",
  "FXL_HUB_AUDIENCE"
];
```
plus the single JSON variable **`FXL_HUB_CONFIG`**.

`loadHubConfig(env)`:
```js
function loadHubConfig(env) {
  const fromJson = readConfigJson(env);
  if (fromJson !== void 0) { return parseHubConfig(fromJson); }
  return parseHubConfig({
    apiUrl: env["FXL_HUB_API_URL"],
    environment: env["FXL_HUB_ENVIRONMENT"],
    clientId: env["FXL_HUB_CLIENT_ID"],
    clientSecret: env["FXL_HUB_CLIENT_SECRET"],
    audience: env["FXL_HUB_AUDIENCE"]
  });
}
```
`loadHubPublicConfig(env)` reads only `FXL_HUB_API_URL`, `FXL_HUB_ENVIRONMENT`, `FXL_HUB_AUDIENCE` (or `FXL_HUB_CONFIG`).

`readConfigJson` throws `HubConfigError('FXL_HUB_CONFIG', ...)` if `FXL_HUB_CONFIG` is set **and** any discrete var is also set ("ambiguous configuration"). No other env vars are read anywhere in the SDK dist.

`toPublicConfig`:
```js
function toPublicConfig(config) {
  return { apiUrl: config.apiUrl, environment: config.environment, audience: config.audience };
}
```

Hub constants baked into the bundle:
```js
var HUB_ISSUER = "https://auth.fxlbusiness.com";
var HUB_TOKEN_TYP = "at+jwt";
var HUB_JWKS_PATH = "/.well-known/jwks.json";
var HUB_SIGNING_ALGS = ["RS256", "EdDSA"];
var HUB_CLOCK_SKEW_SECONDS = 30;
var HUB_SESSION_TTL_SECONDS = 60 * 60 * 24 * 90;          // 7776000
var HUB_SESSION_ABSOLUTE_TTL_SECONDS = 60 * 60 * 24 * 365; // 31536000
```
Discovery endpoint: `${apiUrl}/.well-known/oauth-authorization-server`, required doc fields `issuer`, `authorization_endpoint`, `token_endpoint`, `fxl_web_url`; `jwksUri` is **derived** as `${apiUrl}/.well-known/jwks.json`, never trusted from the doc. Cached per-process keyed by trimmed `apiUrl`.

#### Token contract types (verbatim, `dist/index.d.ts`)

```ts
declare const HUB_TOKEN_CONTRACT_VERSION = 1;

type HubWorkspaceRole = 'owner' | 'admin' | 'member';

interface HubEntitlements {
    access: boolean;
    modules: string[];
}

interface HubRoles {
    workspace: HubWorkspaceRole;
    productRoles?: string[];
}

interface HubTokenWorkspacesEntry {
    workspaceId: string;
    name: string;
    role: HubWorkspaceRole;
    products: string[];
}

interface HubTokenClaims {
    iss: string;
    aud: string;
    sub: string;
    workspaceId: string;
    contractVersion: number;
    entitlements: HubEntitlements;
    roles: HubRoles;
    typ: 'at+jwt';
    iat: number;
    exp: number;
    nbf?: number;
    jti: string;
    name?: string;
    email?: string;
    avatarUrl?: string;
    trialEndsAt?: string;
    workspaces?: HubTokenWorkspacesEntry[];
    isSuperAdmin?: boolean;
    workspaceName?: string;
}

interface HubAuthContext {
    accountId: string;
    workspaceId: string;
    entitlements: HubEntitlements;
    roles: HubRoles;
    aud: string;
    claims: HubTokenClaims;
}
```

**The claim is `workspaceId`, NOT `organizationId`.** The doc comment on `HubTokenClaims.workspaceId` is explicit: *"The claim keeps the name `workspaceId` while its VALUE is the Organization id: `workspace` is the storage name and `Organization` is the domain term. Renaming the claim would break every deployed verifier, so do not rename it."* Same for `HubAuthContext.workspaceId`. `organizationId` appears **only** in URL/path helpers (`OrganizationPath.organizationId`), in the `/auth/refresh` request body, and in `SetActiveResult.organizationId` — never as a token claim.

The 2.0.0 change is also called out in dist: these four types are now **declared locally**, not `export type … from '@fxl-hub/hub-auth'`, so they no longer degrade to `any` under `skipLibCheck: true`. `HubWorkspaceRole` was already fixed in 1.3.0.

#### Session store types (verbatim, `dist/session-store-DOWOoBx8.d.ts`)

```ts
interface HubSessionRecord {
    hubRefreshToken: string;
    accountId?: string;
    expiresAt?: string;
    absoluteExpiresAt?: string;
}

interface HubLoginTransaction {
    codeVerifier: string;
    state: string;
    expiresAt?: string;
}

type HubSessionStoreKind = 'ephemeral' | 'persistent';

type HubSessionReadResult =
  | { status: 'found'; record: HubSessionRecord }
  | { status: 'expired' }
  | { status: 'absent' };

interface HubSessionTransaction {
    read(): Promise<HubSessionReadResult>;
    update(record: HubSessionRecord): Promise<void>;
    delete(): Promise<void>;
}

interface HubSessionStore {
    readonly kind: HubSessionStoreKind;
    create(data: HubSessionRecord): Promise<string>;
    withSession<T>(id: string, operation: (tx: HubSessionTransaction) => Promise<T>): Promise<T>;
    createLoginTransaction(tx: HubLoginTransaction): Promise<string>;
    consumeLoginTransaction(id: string): Promise<HubLoginTransaction | null>;
}

declare class InMemoryHubSessionStore implements HubSessionStore {
    readonly kind: "ephemeral";
    constructor(now?: () => number);
    create(data: HubSessionRecord): Promise<string>;
    withSession<T>(id: string, operation: (tx: HubSessionTransaction) => Promise<T>): Promise<T>;
    createLoginTransaction(tx: HubLoginTransaction): Promise<string>;
    consumeLoginTransaction(id: string): Promise<HubLoginTransaction | null>;
    /** Synchronous read, for TESTS only. Not part of HubSessionStore. */
    get(id: string): HubSessionRecord | null;
}
```

**Exported session error classes: there are NONE.** The only exported error class in the whole SDK is `HubConfigError` (root subpath). `HubAuthError` (with its `code` field) exists inside `dist/server.js` but is **not exported** from any subpath. `SqlHubSessionStore.open()` throws a plain error on a bad GCM tag — undecodable as a typed class from outside.

#### `SqlHubSessionStore` + adapter (verbatim, `dist/index.d.ts`)

```ts
interface SqlSessionAdapter {
    query<R>(sql: string, params: readonly unknown[]): Promise<R[]>;
    transaction<T>(operation: (tx: SqlSessionAdapter) => Promise<T>): Promise<T>;
}

interface SqlHubSessionStoreOptions {
    adapter: SqlSessionAdapter;
    encryptionKey: Buffer | Uint8Array;   // 32 bytes, AES-256-GCM, validated at construction
    now?: () => number;
    sessionTable?: string;                // default 'hub_bff_session'
    loginTable?: string;                  // default 'hub_bff_login_transaction'
}

declare class SqlHubSessionStore implements HubSessionStore {
    readonly kind: "persistent";
    constructor(options: SqlHubSessionStoreOptions);
    create(data: HubSessionRecord): Promise<string>;
    withSession<T>(id: string, operation: (tx: HubSessionTransaction) => Promise<T>): Promise<T>;
    createLoginTransaction(tx: HubLoginTransaction): Promise<string>;
    consumeLoginTransaction(id: string): Promise<HubLoginTransaction | null>;
}
```
Yes — **`SqlHubSessionStore` and `SqlSessionAdapter` are both exported** from the root subpath. It takes a `FOR UPDATE` row lock inside `withSession`, deletes expired rows inside the same transaction and reports `expired`. Sealing uses the row id as GCM AAD.

DDL is at `schema/session-store.sql` (tables `hub_bff_session` with columns `id text PK`, `payload text` (base64 `{iv,tag,ct}` envelope), `expires_at timestamptz`, `absolute_expires_at timestamptz`, `created_at timestamptz`; and `hub_bff_login_transaction`). Session ids are two concatenated v4 UUIDs with hyphens stripped (`randomUUID` from node `crypto`).

#### Organization path helpers (root subpath)

```ts
declare const ORGANIZATION_PATH_PREFIX = "/u";
interface OrganizationPath { organizationId: string; rest: string; }
declare function organizationPath(organizationId: string, subPath?: string): string;
declare function parseOrganizationPath(pathname: string): OrganizationPath | null;
declare function withOrganization(pathname: string, organizationId: string): string;
```

#### Version constant

```ts
declare const HUB_SDK_VERSION = "2.1.0";
```
Runtime value in `dist/chunk-Y7YHPKEC.js:326`: `var HUB_SDK_VERSION = "2.1.0";`

### 2.2 `@fxl-business/hub-sdk/server` (`dist/server.d.ts`)

Complete export list (verbatim):
```ts
export { type BootAssertionInput, type CreateHubBffOptions, type RequireHubAuthOptions, assertBootConfiguration, assertConformantSessionStore, createHubBff, organizationScope, requireHubAuth };
```
**Eight names, that is all.** `HubAuthContext` is NOT re-exported from `/server` — import it from the root subpath.

```ts
interface BootAssertionInput {
    config: HubConfig;
    sessionStore?: HubSessionStore;
    allowEphemeralSessionStore?: boolean;
    insecureCookies?: boolean;
    healthToken?: string;
}
declare function assertBootConfiguration(input: BootAssertionInput): void;
declare function assertConformantSessionStore(store: HubSessionStore): void;
declare function createHubBff(config: HubConfig, options?: CreateHubBffOptions): Hono;
declare function requireHubAuth(config: HubConfig, options?: RequireHubAuthOptions): MiddlewareHandler;
declare function organizationScope(): MiddlewareHandler;
```

**`CreateHubBffOptions` — FULL, verbatim. Every key is optional (`options?` itself defaults to `{}`):**
```ts
interface CreateHubBffOptions {
    sessionStore?: HubSessionStore;              // REQUIRED unless allowEphemeralSessionStore
    allowEphemeralSessionStore?: boolean;        // only legal when environment === 'development'
    insecureCookies?: boolean;                   // only legal when environment === 'development'
    healthToken?: string;                        // REQUIRED outside development
    fetchImpl?: typeof fetch;
    redirectUri?: string;                        // default `${config.apiUrl}/auth/callback`
    postLoginRedirect?: string;                  // default '/'
    postLoginErrorRedirect?: string;             // default '/?error=auth'
    now?: () => number;
    timeoutMs?: number;
    sessionTtlSeconds?: number;
    sessionAbsoluteTtlSeconds?: number;
}
```
There is **no `origin`, `allowedOrigins`, `trustedOrigins`, `csrf`, `cookieDomain`, `cookieName` or `sameSite` option.** See §3.2.

**`RequireHubAuthOptions` — FULL, verbatim. All four optional:**
```ts
interface RequireHubAuthOptions {
    fetchImpl?: typeof fetch;
    allowWithoutAccess?: boolean;      // default false
    requiredModule?: string;
    requiredRoles?: readonly string[];
}
```
There is **no `audience` override** — the doc comment says an override would be a second source of truth.

Hono module augmentation shipped by `/server`:
```ts
declare module 'hono' {
    interface ContextVariableMap {
        urlOrganizationId: string;
    }
}
```
NOTE: `hubAuth` is **NOT** in the shipped `ContextVariableMap` augmentation, even though `dist/server.js` does `c.set("hubAuth", context)` and `c.get("hubAuth")`. A consumer reading `c.get('hubAuth')` will need its own `declare module 'hono'` augmentation typing `hubAuth: HubAuthContext`, or it types as `any`/errors. This is a real gap in the shipped `.d.ts`.

### 2.3 `@fxl-business/hub-sdk/client` (`dist/client.d.ts`)

Complete export list (verbatim):
```ts
export { type CreateHubClientOptions, type HubClient, type HubClientScheduler, type HubPopupHost, type HubPopupLoginOptions, type HubPopupLoginResult, type HubPopupMessageEvent, type HubPopupWindow, type HubTokenResult, type SetActiveResult, createHubClient };
```

```ts
declare function createHubClient(config: HubPublicConfig, options?: CreateHubClientOptions): HubClient;

interface CreateHubClientOptions {
    bffBasePath?: string;                        // default '' (BFF at app origin root)
    fetchImpl?: typeof fetch;
    navigate?: (url: string) => void;            // default window.location.assign
    autoRenew?: boolean;                         // default true
    renewFractions?: readonly number[];          // default [0.6, 0.75, 0.85, 0.92]
    scheduler?: HubClientScheduler;
    now?: () => number;
    onSessionExpired?: () => void;
}

interface HubClientScheduler {
    setTimeout: (fn: () => void, ms: number) => unknown;
    clearTimeout: (handle: unknown) => void;
}

type HubTokenResult =
  | { status: 'ok'; accessToken: string; expiresIn: number }
  | { status: 'expired' }
  | { status: 'unavailable' };

interface SetActiveResult {
    accessToken: string;
    expiresIn: number;
    organizationId: string;
}

interface HubClient {
    login(options?: { organization?: string }): void;
    loginWithPopup(options?: HubPopupLoginOptions): Promise<HubPopupLoginResult>;
    getToken(): Promise<string | null>;
    getTokenResult(): Promise<HubTokenResult>;
    setActive(organizationId: string): Promise<SetActiveResult>;
    logout(): Promise<void>;
    start(): void;
    stop(): void;
    checkoutUrl(organizationId: string, sku?: string): Promise<string>;
    manageUrl(organizationId: string): Promise<string>;
}
```
**Ten members. That is the entire browser surface.** There is no `getContext`, no `getClaims`, no `onTokenChange`, no `subscribe`, no `isAuthenticated`.

Popup types (new in 2.1.0):
```ts
interface HubPopupWindow { readonly closed: boolean; close(): void; }
interface HubPopupMessageEvent { readonly origin: string; readonly source: unknown; readonly data: unknown; }
interface HubPopupHost {
    readonly origin: string;
    open(url: string, target: string, features: string): HubPopupWindow | null;
    addEventListener(type: 'message', listener: (event: HubPopupMessageEvent) => void): void;
    removeEventListener(type: 'message', listener: (event: HubPopupMessageEvent) => void): void;
}
interface HubPopupLoginOptions {
    organization?: string;
    width?: number;      // default 480, floored at 320
    height?: number;     // default 720, floored at 480
    windowImpl?: HubPopupHost;
}
type HubPopupLoginResult =
  | { status: 'authenticated'; accessToken: string; expiresIn: number }
  | { status: 'blocked' }
  | { status: 'cancelled'; reason: 'closed' | 'timeout' }
  | { status: 'unavailable' };
```

Runtime behaviour confirmed in `dist/client.js`:
- Construction **throws** `HubConfigError('clientSecret', …)` if `'clientSecret' in config`.
- `bffBasePath` has trailing slashes stripped: `(options.bffBasePath ?? "").replace(/\/+$/, "")`.
- All BFF calls use `credentials: "include"`: `fetchImpl(\`${bffBase}/auth/refresh\`, { method: "POST", credentials: "include", ... })` and `fetchImpl(\`${bffBase}/auth/logout\`, { method: "POST", credentials: "include" })`.
- `refresh()` is single-flight; only HTTP 401 calls `endSession()` → `{status:'expired'}` + `onSessionExpired()` once. Any non-200 non-401, or a thrown fetch, returns `{status:'unavailable'}` and **keeps** the cached token.
- `setActive(organizationId)` POSTs `/auth/refresh` with JSON body `{ organizationId }`, deliberately **not** single-flighted. Returns `json.organization?.id ?? organizationId`. Throws `Error` on failure (`organization switch failed (<status>: <code>)`).
- `start()` only schedules when there is already a cached token (`if (timer === null && cached !== null) schedule();`). `stop()` clears the timer AND drops the cache.
- `checkoutUrl(orgId, sku)` → `` `${fxlWebUrl}/u/${encodeURIComponent(orgId)}/marketplace?application=${audience}[&sku=...]` ``
- `manageUrl(orgId)` → `` `${fxlWebUrl}/u/${encodeURIComponent(orgId)}/billing?manage=${audience}` ``
  Both call `discover(config.apiUrl, fetchImpl)` first, so **both are network calls** and both need the browser to reach the Hub discovery endpoint (CORS).

---

## 3. `dist/server.js` — compiled behaviour

### 3.1 Rotated-refresh-cookie regex — **STILL BROKEN. The workaround is STILL NEEDED.**

`dist/server.js`, lines 355-359, verbatim:

```js
function parseRotatedRefresh(setCookieHeader) {
  if (!setCookieHeader) return void 0;
  const match = /(?:^|[,\s])fxl_hub_session=([^;]+)/.exec(setCookieHeader);
  return match?.[1];
}
```

This is **byte-identical to the 1.3.1 regex** the local `createHubRotatedCookieFetch` workaround was written for: `/(?:^|[,\s])fxl_hub_session=([^;]+)/`.

It **cannot** match a `__Host-` prefixed name. For a header beginning `__Host-fxl_hub_session=…`, the character immediately preceding `fxl_hub_session=` is `-`, which is neither start-of-string nor a member of `[,\s]`. The alternation therefore fails at that position and no later position matches either.

Related constants, lines 332-336:
```js
var SESSION_COOKIE = "fxl_hub_session";
var SESSION_COOKIE_SECURE = "__Host-fxl_hub_session";
var LOGIN_TX_COOKIE = "fxl_hub_login";
var LOGIN_DISPLAY_COOKIE = "fxl_hub_login_display";
var BACKCHANNEL_COOKIE_NAME = SESSION_COOKIE;
```

Note the split: the **BFF's own browser-facing** cookie is `__Host-fxl_hub_session` whenever `secure` is true (`const sessionCookieName = secure ? SESSION_COOKIE_SECURE : SESSION_COOKIE;`), but the **backchannel** cookie the BFF sends to the Hub is the unprefixed `fxl_hub_session` (`headers: { Cookie: \`${BACKCHANNEL_COOKIE_NAME}=${record.hubRefreshToken}\` }`). `parseRotatedRefresh` is applied to the Hub's `Set-Cookie` response header at line 597:
```js
const rotated = parseRotatedRefresh(res.headers.get("set-cookie"));
if (rotated) await tx.update({ ...record, hubRefreshToken: rotated });
```

**Definitive statement:** 2.1.0 did **not** fix this. If the Hub responds to the backchannel `POST /auth/refresh` with a `Set-Cookie` whose name is `__Host-fxl_hub_session`, `parseRotatedRefresh` returns `undefined`, the rotated refresh token is silently discarded, and the stored session keeps the old (now-rotated-away) refresh token → the next refresh gets `reuse_detected`/`invalid` → forced logout. **Keep `createHubRotatedCookieFetch`.** Retire it only after observing, against the live Hub, that the rotation `Set-Cookie` name is the unprefixed `fxl_hub_session`; whether the Hub actually prefixes it is not determinable from the tarball.

### 3.2 CSRF / Origin check — **YES, and it is NOT configurable**

`dist/server.js`, lines 421-432, verbatim — a router-wide `app.use('*')`:

```js
app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    const method = c.req.method;
    if (method === "POST") {
      const origin = c.req.header("origin");
      const site = c.req.header("sec-fetch-site");
      if (site && site === "cross-site" || origin && origin !== new URL(c.req.url).origin) {
        return c.json({ error: "forbidden" }, 403);
      }
    }
    return next();
});
```

**When it rejects (403 `{"error":"forbidden"}`):**
- method is POST (so: `/auth/refresh` and `/auth/logout`; `/auth/login`, `/auth/callback`, `/auth/_health` are GET and unaffected), **AND**
- `Sec-Fetch-Site: cross-site`, **OR**
- an `Origin` header is present and is not string-equal to `new URL(c.req.url).origin`.

**There is no configuration that relaxes this.** `CreateHubBffOptions` has no allowed-origins key; the guard reads nothing from `config` or `options`. This is the same hazard that produced the 1.3.x production 403s, and it is unchanged in 2.1.0.

Two second-order facts that matter for a `web` ≠ `api` host topology:
- `Sec-Fetch-Site: same-site` (e.g. `app.example.com` → `api.example.com` on the same registrable domain) is **allowed by the first clause**, but the second clause still fires because `Origin: https://app.example.com !== https://api.example.com`. So even same-site-different-subdomain is rejected.
- `new URL(c.req.url).origin` is computed from what the server sees. Behind a reverse proxy this depends entirely on the `Host`/`X-Forwarded-*` handling of the Hono adapter in use.

**How to make a cross-origin web→api topology work — the only workable configurations:**
1. **(Recommended) Same-origin proxy.** Serve the BFF at the *web* origin: have the web host proxy `/auth/*` (or `<bffBasePath>/auth/*`) through to the api service, preserving the `Host` header so `new URL(c.req.url).origin` equals the browser's `Origin`. The browser then sends `Sec-Fetch-Site: same-origin` and a matching `Origin`, and both clauses pass. Set the client's `bffBasePath` to that same-origin path. This also fixes the `__Host-` cookie (which requires `Path=/`, `Secure`, and no `Domain` — and is only sendable to the origin that set it) and removes the need for `credentials: 'include'` CORS on the api.
2. **Mount `createHubBff` inside the web app's own server** rather than in the api service. Set `redirectUri` explicitly to the web origin's `/auth/callback` (it defaults to `${config.apiUrl}/auth/callback`, which would be wrong) and register that exact URI in the Hub Client registry.
3. **Do not** attempt to satisfy it by CORS headers alone — CORS controls whether the browser exposes the *response*; the guard runs server-side on the *request* and returns 403 before any handler.
4. If neither is possible, the only remaining option is to wrap/strip: mount the router behind your own middleware that rewrites the request so `c.req.url`'s origin matches the incoming `Origin` — fragile, and it removes a real CSRF defence. Not recommended.

### 3.3 Routes declared by the BFF router

Exactly five, all under `/auth`. Mount at the root: `app.route('/', createHubBff(config, opts))`.

| Method | Path | Notes |
|---|---|---|
| GET | `/auth/login` | query: `organization?`, `display=popup`?, `nonce?`. Redirects 302 to `disco.authorizationEndpoint` with `response_type=code`, `client_id`, `redirect_uri`, `state`, `code_challenge`, `code_challenge_method=S256`, `organization?`. Sets `fxl_hub_login` (maxAge 600) and, for popup, `fxl_hub_login_display`. |
| GET | `/auth/callback` | consumes login tx, exchanges code at `disco.tokenEndpoint` (JSON body incl. `client_secret`), creates session, sets session cookie, then 302 to `postLoginRedirect`/`postLoginErrorRedirect` — or, in popup mode, returns a 200 HTML popup-closer document. |
| POST | `/auth/refresh` | optional JSON body `{ organizationId: string }`. This is the org-switch route. |
| POST | `/auth/logout` | 204 no content. |
| GET | `/auth/_health` | authenticated by `healthToken` via `Authorization: Bearer <t>` or `x-fxl-health-token`, compared with `timingSafeEqual`. |

**`/auth/switch` is CONFIRMED GONE.** `grep` over `dist/server.js` finds no `switch` route. Organization switching is now `POST /auth/refresh` with `{ organizationId }`, which the client exposes as `setActive()`.

`/auth/_health` 200 body shape (verbatim from source):
```js
{
  status: "ok",
  sdkVersion: HUB_SDK_VERSION,               // "2.1.0"
  contractVersion: HUB_TOKEN_CONTRACT_VERSION, // 1
  environment, audience, clientId, apiUrl,
  sessionStore: { kind: store.kind, name: store.constructor.name },
  ttls: { sessionSeconds, sessionAbsoluteSeconds, upstreamTimeoutMs, accessTokenObservedSeconds },
  cookies: { name: sessionCookieName, secure, httpOnly: true, sameSite: "Lax" }
}
```

`POST /auth/refresh` response taxonomy (verbatim from the code):
- `401 {error:"no_session"}` — no session cookie
- `400 {error:"invalid_request"}` — `organizationId` present but not a non-empty string
- `503 {error:"session_store_unavailable"}` + `Retry-After: 1` — read status `absent`, or `withSession` threw
- `401 {error:"session_expired"}` + cookie cleared — read status `expired`, or Hub 401 with a code in `PERMANENT_REFRESH_CODES = new Set(["invalid","expired","revoked","reuse_detected","no_session"])`
- `502 {error:"invalid_refresh_response"}` — Hub 401 with a non-permanent code, or non-200 / malformed success body
- `503 {error:"refresh_unavailable"}` + `Retry-After: 1` — fetch threw/aborted, or Hub returned 408/425/429/5xx
- `403 {error:"forbidden", code}` — Hub 403; `code` defaults to `"not_a_member"`
- `409 {error:"organization_required", code:"pick_organization", candidates: []}` — Hub 409
- `502 {error:"audience_mismatch", expected, received}` — the unverified `aud` of the returned access token ≠ `config.audience`
- `200 {accessToken, expiresIn, organization?: {id, name}, contextSource?: string}`

The upstream call is always `POST ${config.apiUrl}/auth/refresh?clientId=<clientId>&audience=<audience>[&organizationId=...]` with header `Cookie: fxl_hub_session=<refreshToken>`, aborted after `timeoutMs`. The source comment warns: a caller that sends neither `clientId` nor `audience` is silently given the PLATFORM audience.

### 3.4 TTL / session option names actually accepted

All twelve `CreateHubBffOptions` keys listed in §2.2 are real. The resolved defaults in `createHubBff` (verbatim, lines 404-415):
```js
const fetchImpl = options.fetchImpl ?? fetch;
const base = config.apiUrl;
const redirectUri = options.redirectUri ?? `${base}/auth/callback`;
const postLoginRedirect = options.postLoginRedirect ?? "/";
const postLoginErrorRedirect = options.postLoginErrorRedirect ?? "/?error=auth";
const secure = options.insecureCookies !== true;
const sessionCookieName = secure ? SESSION_COOKIE_SECURE : SESSION_COOKIE;
const now = options.now ?? Date.now;
const sessionTtlSeconds = options.sessionTtlSeconds ?? 7776e3;            // 90 days
const sessionAbsoluteTtlSeconds = options.sessionAbsoluteTtlSeconds ?? 31536e3; // 365 days
const timeoutMs = options.timeoutMs ?? 1e4;                               // 10s
const healthToken = options.healthToken;
```
So: **`sessionTtlSeconds` ✓, `sessionAbsoluteTtlSeconds` ✓, `timeoutMs` ✓, `fetchImpl` ✓, `healthToken` ✓, `insecureCookies` ✓, `allowEphemeralSessionStore` ✓** — all seven you named are real, plus `sessionStore`, `redirectUri`, `postLoginRedirect`, `postLoginErrorRedirect`, `now`.

Cookie attributes are fixed and not configurable: `{ httpOnly: true, sameSite: "Lax", path: "/", secure }`.

Boot assertion (`assertBootConfiguration`), five throws, all `HubConfigError`:
1. field `sessionStore` — no store and `allowEphemeralSessionStore !== true`
2. field `allowEphemeralSessionStore` — set true when `environment !== 'development'`
3. field `sessionStore` — store `kind === 'ephemeral'` when `environment !== 'development'`
4. field `insecureCookies` — set true when `environment !== 'development'`
5. field `healthToken` — undefined or empty when `environment !== 'development'`

`assertConformantSessionStore` throws field `sessionStore` if `typeof store.withSession !== 'function'` (pre-1.3.0 shape) or if `store.kind` is neither `'ephemeral'` nor `'persistent'` (1.3.x shape).

### 3.5 How it calls the store

Yes — **`store.withSession(id, op)`**, and `op` receives a `HubSessionTransaction` with `read()` / `update(record)` / `delete()`. The refresh route, verbatim (lines 552-560, 589, 598):

```js
result = await store.withSession(sessionId, async (tx) => {
  const read = await tx.read();
  if (read.status === "absent") {
    return { status: 503, body: { error: "session_store_unavailable" }, clear: false };
  }
  if (read.status === "expired") {
    return { status: 401, body: { error: "session_expired" }, clear: true };
  }
  const record = read.record;
  ...
          await tx.delete();
  ...
  if (rotated) await tx.update({ ...record, hubRefreshToken: rotated });
```

The logout route, verbatim (lines 658-661, 679):
```js
refreshToken = await store.withSession(sessionId, async (tx) => {
  const read = await tx.read();
  return read.status === "found" ? read.record.hubRefreshToken : null;
});
...
await store.withSession(sessionId, async (tx) => tx.delete());
```

Session creation, verbatim (line 528):
```js
const sessionId = await store.create({
  hubRefreshToken: tokenJson.refresh_token,
  expiresAt: new Date(current + sessionTtlSeconds * 1e3).toISOString(),
  absoluteExpiresAt: new Date(current + sessionAbsoluteTtlSeconds * 1e3).toISOString()
});
```

Login transaction, verbatim (line 438):
```js
const txId = await store.createLoginTransaction({
  codeVerifier: verifier, state,
  expiresAt: new Date(now() + 6e5).toISOString()   // 10 minutes
});
```
and `await store.consumeLoginTransaction(txId)` in the callback.

The operation's return value is passed through and used by the caller as `{ status: number, body: object, clear: boolean }` — that shape is internal to the BFF, not a store contract. A store must simply return whatever the operation returns and must not swallow throws: a throw out of `withSession` is caught by the BFF and becomes a 503 `session_store_unavailable`.

### 3.6 `HubSessionRecord.accountId`

**Never populated.** `store.create` at line 528 passes only `hubRefreshToken`, `expiresAt`, `absoluteExpiresAt`. The only `tx.update` call is `{ ...record, hubRefreshToken: rotated }`, which cannot add it. `grep accountId` in `dist/server.js` hits only `accountId: claims.sub` inside `verifyHubToken`'s `HubAuthContext` construction. The field is optional in the type and dead in the BFF — do not build on it.

---

## 4. `requireHubAuth` — exact deny branches

`dist/server.js` lines 715-760, verbatim:

```js
function requireHubAuth(config, options = {}) {
  const audience = config.audience;
  const fetchImpl = options.fetchImpl ?? fetch;
  let inner;
  return async (c, next) => {
    if (!inner) {
      let disco;
      try {
        disco = await discover(config.apiUrl, fetchImpl);
      } catch {
        return c.json({ error: "unavailable", code: "discovery_failed" }, 503);
      }
      inner = hubAuth({ audience, issuer: disco.issuer, jwksUri: disco.jwksUri, fetchImpl });
    }
    let denial;
    const gate = async () => {
      const auth = c.get("hubAuth");
      if (auth.claims.contractVersion !== HUB_TOKEN_CONTRACT_VERSION) {
        denial = c.json({ error: "unauthorized", code: "contract_version_mismatch" }, 401);
        return;
      }
      if (auth.entitlements.access !== true && options.allowWithoutAccess !== true) {
        denial = c.json({ error: "payment_required", code: "no_org_access" }, 402);
        return;
      }
      if (options.requiredModule !== void 0 && !auth.entitlements.modules.includes(options.requiredModule)) {
        denial = c.json(
          { error: "forbidden", code: "missing_module", module: options.requiredModule },
          403
        );
        return;
      }
      if (options.requiredRoles !== void 0 && options.requiredRoles.length > 0) {
        const held = auth.roles.productRoles ?? [];
        if (!options.requiredRoles.some((role) => held.includes(role))) {
          denial = c.json({ error: "forbidden", code: "missing_role" }, 403);
          return;
        }
      }
      await next();
    };
    const verified = await inner(c, gate);
    if (denial) return denial;
    return verified;
  };
}
```

**Deny table (status / exact JSON body):**

| # | Condition | Status | Body |
|---|---|---|---|
| 0 | `discover()` threw | 503 | `{"error":"unavailable","code":"discovery_failed"}` |
| 1 | no/badly formed `Authorization: Bearer` | 401 | `{"error":"unauthorized","code":"missing_token"}` |
| 2 | `verifyHubToken` threw `HubAuthError` | 401 | `{"error":"unauthorized","code":"<err.code>"}` |
| 2b| any other throw | 401 | `{"error":"unauthorized","code":"malformed"}` |
| 3 | `claims.contractVersion !== 1` (incl. absent → `undefined !== 1`) | 401 | `{"error":"unauthorized","code":"contract_version_mismatch"}` |
| 4 | `entitlements.access !== true` and not `allowWithoutAccess` | **402** | `{"error":"payment_required","code":"no_org_access"}` |
| 5 | `requiredModule` not in `entitlements.modules` | 403 | `{"error":"forbidden","code":"missing_module","module":"<requiredModule>"}` |
| 6 | none of `requiredRoles` in `roles.productRoles ?? []` | 403 | `{"error":"forbidden","code":"missing_role"}` |

Possible `<err.code>` values from the bundled verifier's `mapError`: `bad_audience`, `malformed`, `expired`, `alg_not_allowed`, `bad_issuer`, `not_yet_valid`, `bad_typ`, `signature`, `no_key`.

Header parsing (verbatim): `const match = /^Bearer (.+)$/i.exec(header.trim());` — case-insensitive scheme, **exactly one space**, then `.trim()` of the captured group.

**Exact claim paths read:**
- `auth.claims.contractVersion` (number, must `=== 1`)
- `auth.entitlements.access` (boolean, must `=== true`) — from claim `entitlements.access`
- `auth.entitlements.modules` (`string[]`, `.includes(requiredModule)`) — from claim `entitlements.modules`
- `auth.roles.productRoles` (`string[] | undefined`, defaulted to `[]`) — from claim `roles.productRoles`
- `auth.aud` / claim `aud` — validated by `jwtVerify({ audience: config.audience })` AND re-checked in `toHubTokenClaims`: an array `aud` is accepted only when it has exactly one element, and it must strictly equal `config.audience`, else `HubAuthError('bad_audience')`.
- **Organization id claim name: `workspaceId`.** Verbatim from `toHubTokenClaims`:
  ```js
  const workspaceId = payload.workspaceId;
  if (!isNonEmptyString(workspaceId)) {
    throw new HubAuthError("malformed", "workspaceId claim missing");
  }
  ```
  There is **no `organizationId` claim, and no `org`, `org_id`, `tenant` or `tid` claim.** `requireHubAuth` itself never reads it; `organizationScope()` does: `if (!auth || parsed.organizationId !== auth.workspaceId) return c.json({ error: "forbidden", code: "organization_mismatch" }, 403);`
- `auth.roles.workspace` is required to be a non-empty string by the verifier, but `requireHubAuth` never gates on it. There is **no `requiredWorkspaceRole` option** — owner/admin/member gating must be done by the consumer from `c.get('hubAuth').roles.workspace`.

**Structural claims the verifier hard-requires** (`toHubTokenClaims`, throws `HubAuthError('malformed')`): `sub` non-empty string; `workspaceId` non-empty string; `entitlements` an object with `modules` a `string[]`; `entitlements.access` a boolean; `roles` an object with `roles.workspace` a non-empty string; `roles.productRoles` if present must be `string[]`.
jose-level required claims: `requiredClaims: ["iss","aud","sub","exp"]`, `typ: 'at+jwt'`, `algorithms: ["RS256","EdDSA"]`, `clockTolerance: 30` (capped at 30 even if a larger value is requested), `issuer: disco.issuer`.

**Discovery is lazily memoised into `inner` on the first request and never retried once it succeeds.** A discovery failure on the very first request 503s but does not poison the closure — the next request retries. Note `discover()` also has a *module-level* per-`apiUrl` cache that is never invalidated (only `__clearDiscoveryCache()` clears it).

`organizationScope()`, verbatim:
```js
function organizationScope() {
  return async (c, next) => {
    const parsed = parseOrganizationPath(new URL(c.req.url).pathname);
    if (!parsed) { return next(); }
    const auth = c.get("hubAuth");
    if (!auth || parsed.organizationId !== auth.workspaceId) {
      return c.json({ error: "forbidden", code: "organization_mismatch" }, 403);
    }
    c.set("urlOrganizationId", parsed.organizationId);
    return next();
  };
}
```
It is a **no-op for any path not matching `/u/<org>/…`** — it does not require org scoping, it only enforces agreement when the URL happens to be scoped.

---

## 5. What is NEW in 2.1.0 vs 2.0.0

**There is no CHANGELOG in either tarball.** `files` for A is `["dist","schema","MIGRATION.md"]`; the only markdown shipped is `MIGRATION.md` (which documents 2.0.0) — no `CHANGELOG.md`, no `README.md` in A. B ships only `dist` + a `README.md`.

However the answer is stated **verbatim in the shipped `dist/index.d.ts`** as the doc comment on `HUB_SDK_VERSION`, so this is not inference:

> *"2.1.0 is an ADDITIVE MINOR. The browser client gains `loginWithPopup`, which signs a person in through a popup window and resolves a discriminated outcome without ever navigating the host tab, plus the types that outcome is expressed in (`HubPopupLoginResult`, `HubPopupLoginOptions`, `HubPopupHost`, `HubPopupWindow` and `HubPopupMessageEvent`). Nothing existing changed shape, so a 2.0.0 consumer compiles unchanged; the number moves because the SURFACE moved… The TOKEN CONTRACT did NOT move: `HUB_TOKEN_CONTRACT_VERSION` is still 1, because a popup changes where a login renders and reaches no token claim."*

Corroborating evidence in dist:
- `HUB_SDK_VERSION = "2.1.0"` (`dist/chunk-Y7YHPKEC.js:326`); it is the **only** literal `2.1.0` anywhere in A's non-map dist output.
- `HUB_TOKEN_CONTRACT_VERSION = 1` (`dist/chunk-Y7YHPKEC.js:2`) — unchanged.
- New chunk `dist/chunk-U4RMERPG.js` exporting `parsePopupDisplay`, `popupDisplayCookieValue`, `renderPopupCloser`, `sanitisePopupNonce` — the server side of the popup flow, consumed by `/auth/login?display=popup` and the `/auth/callback` popup-closer HTML.
- New cookie `fxl_hub_login_display`; new PKCE helper `generateScriptNonce()` for the CSP script nonce on the popup-closer document.
- `HUB_SDK_TESTING_VERSION = "2.1.0"` in B, pinned equal to the SDK's.

**Nothing about the access model, the claim set, the deny taxonomy, the store contract or the origin guard changed in 2.1.0.** Anything you plan for the access model is really planning against the 2.0.0 contract.

---

## 6. Package B — `@fxl-business/hub-sdk-testing@2.1.0`

### Complete exported surface (verbatim export line of `dist/index.d.ts`)

```ts
export { type CreateDevHubClientOptions, DEV_HUB_WEB_ORIGIN, DEV_ORGANIZATIONS_CLAIM_CAP, DEV_TOKEN_ISSUER, DEV_TOKEN_SIGNATURE, DEV_TOKEN_TTL_SECONDS, type DevDenyBranch, type DevHubClaimsOptions, type DevHubClient, type DevIdentity, type DevIdentityRoster, type DevMintRefusal, type DevOrganization, type DevRosterCoverage, DevRosterError, type DevWorkspaceRole, HUB_SDK_TESTING_VERSION, REQUIRED_DEV_DENY_BRANCHES, assertDevRoster, createDevHubClient, defaultDevIdentity, devHubClaims, devRosterCoverage, findDevIdentity, findDevOrganization, isDevToken, mintDevToken, missingDevDenyBranches, readDevTokenSubject };
```

### Constants
```ts
declare const DEV_TOKEN_TTL_SECONDS = 900;                          // 15 minutes
declare const DEV_TOKEN_ISSUER = "https://hub.invalid";             // reserved TLD, RFC 2606
declare const DEV_ORGANIZATIONS_CLAIM_CAP = 40;
declare const DEV_TOKEN_SIGNATURE = "development-not-a-signature";
declare const DEV_HUB_WEB_ORIGIN = "https://hub.invalid";
declare const HUB_SDK_TESTING_VERSION = "2.1.0";
declare const REQUIRED_DEV_DENY_BRANCHES: readonly DevDenyBranch[];
// runtime value: ["access", "no_org_access", "missing_role", "super_admin"]
```

### Roster types (verbatim)
```ts
type DevMintRefusal = 'no_seat' | 'not_a_member';
type DevWorkspaceRole = HubWorkspaceRole;   // ALIAS of the SDK union, not a copy
type DevDenyBranch = 'access' | 'no_org_access' | 'missing_role' | 'missing_module'
                   | 'no_seat' | 'not_a_member' | 'super_admin';
type DevRosterCoverage = Record<DevDenyBranch, boolean>;

interface DevOrganization {
    workspaceId: string;
    name: string;
    role: DevWorkspaceRole;
    products: string[];
    mintRefusal?: DevMintRefusal;
}

interface DevIdentity {
    id: string;
    label: string;
    exercises: string;
    accountId: string;
    activeOrganizationId: string;
    access: boolean;
    modules: string[];
    productRoles?: string[];
    isSuperAdmin?: boolean;
    profile?: { name?: string; email?: string; avatarUrl?: string };
    trialEndsAt?: string;
    organizations: DevOrganization[];
    previewOrganizations?: DevOrganization[];
}

interface DevIdentityRoster {
    audience: string;          // must match /^app\.[a-z0-9][a-z0-9-]*$/
    identities: DevIdentity[]; // first is the default
}

declare class DevRosterError extends Error {
    readonly field: string;
    constructor(field: string, message: string);
}
```

### Functions (verbatim)
```ts
declare function assertDevRoster(roster: DevIdentityRoster): void;
declare function findDevIdentity(roster: DevIdentityRoster, id: string | undefined | null): DevIdentity | undefined;
declare function defaultDevIdentity(roster: DevIdentityRoster): DevIdentity | undefined;
declare function findDevOrganization(identity: DevIdentity, organizationId: string | undefined | null): DevOrganization | undefined;
declare function devRosterCoverage(roster: DevIdentityRoster): DevRosterCoverage;
declare function missingDevDenyBranches(roster: DevIdentityRoster): DevDenyBranch[];

interface DevHubClaimsOptions {
    organizationId?: string;
    nowSeconds?: number;
    ttlSeconds?: number;   // default DEV_TOKEN_TTL_SECONDS
}
declare function devHubClaims(roster: DevIdentityRoster, identity: DevIdentity, options?: DevHubClaimsOptions): HubTokenClaims;
declare function mintDevToken(roster: DevIdentityRoster, identity: DevIdentity, options?: DevHubClaimsOptions): string;
declare function isDevToken(token: string | null | undefined): boolean;
declare function readDevTokenSubject(token: string | null | undefined): string | null;

interface CreateDevHubClientOptions {
    roster: DevIdentityRoster;
    identityId?: string;
    ttlSeconds?: number;
    now?: () => number;
    hubWebOrigin?: string;      // default DEV_HUB_WEB_ORIGIN
    onSessionExpired?: () => void;
}
interface DevHubClient extends HubClient {
    readonly identity: DevIdentity;
    adopt(identityId: string): void;
    expire(): void;
}
declare function createDevHubClient(options: CreateDevHubClientOptions): DevHubClient;
```

### Claims only, or a finished auth context?

**Claims only — confirmed in the compiled JS, not just the docs.** `devHubClaims` returns a `HubTokenClaims` object literal and nothing else:

```js
const claims = {
    iss: DEV_TOKEN_ISSUER,
    aud: roster.audience,
    sub: identity.accountId,
    workspaceId: organization.workspaceId,
    contractVersion: DEV_CONTRACT_VERSION,
    entitlements: { access: identity.access, modules },
    roles: {
      workspace: organization.role,
      ...identity.productRoles && identity.productRoles.length > 0 ? { productRoles: identity.productRoles } : {}
    },
    typ: "at+jwt",
    iat,
    exp: iat + ttlSeconds,
    jti: `dev.${identity.accountId}.${organization.workspaceId}.${iat}`
};
```
plus conditional display-only claims: `name`, `email`, `avatarUrl` (from `profile`), `trialEndsAt`, `workspaceName` (from `organization.name`), `workspaces` (capped preview, omitted when empty), `isSuperAdmin` (only when `=== true`).

Two behaviours worth planning around:
- `const modules = identity.access ? identity.modules : [];` — modules are **forced empty** when `access` is false.
- If the target `DevOrganization` carries `mintRefusal`, `devHubClaims` **throws** `DevRosterError('mintRefusal', …)` rather than producing a token — reproducing the Hub's `getAuthzProjection` not-ok path, which reaches an Application as a BFF 403. `createDevHubClient` reproduces that 403 rather than throwing at the client boundary.
- `jti` is deterministic (not a CSPRNG uuid) so two mints at the same injected time are byte-identical.

It **never** emits a `HubAuthContext`, a Principal or a session. From the shipped doc comment: *"It stops at the claim set on purpose: the consumer runs its OWN REAL translation over this… A fixture that emitted a finished context would bypass exactly the code most likely to break when the contract moves."*

`mintDevToken` produces a structurally valid three-segment JWT whose payload is exactly `devHubClaims(...)` and whose third segment is the literal `"development-not-a-signature"`. It is worthless to `verifyHubToken` (which checks RS256/EdDSA against the Hub JWKS) — that is deliberate. `isDevToken` answers keylessly by checking the three segments and the placeholder signature. `readDevTokenSubject` base64url-decodes the payload and returns `sub` without verifying anything, so a dev SPA can send an ordinary bearer and the API can recover which fixture it was from `sub` alone — no dev-only header, no dev-only branch in the shared API client.

### Does it require a running Hub? Can it seed a development identity offline?

**No Hub, fully offline.** Proof from the tarball:
- `dist/index.js` contains **zero** `import` statements and **zero** `require(` calls.
- It contains **zero** `fetch(` calls and no `XMLHttpRequest`.
- The only browser globals it touches are `TextEncoder`/`btoa` on mint and `atob`/percent-decode on read (documented as deliberately browser-safe, no node builtin, asserted by its own `token.test.ts` reading the file as text).
- Deep-links point at `https://hub.invalid` (reserved TLD) with a URL shape byte-identical to `createHubClient`'s, so `checkoutUrl`/`manageUrl` resolve **without** the `discover()` network call the real client makes.
- Both `DEV_TOKEN_ISSUER` and `DEV_HUB_WEB_ORIGIN` are `https://hub.invalid`, chosen so JWKS discovery against it can never accidentally succeed.

### How it is meant to be used

One seam, at the outermost boundary: replace the object `createHubClient` would have returned. From B's README (verbatim):

```ts
import { createHubClient, type HubClient } from '@fxl-business/hub-sdk/client';

export async function buildHubClient(config: HubConfig): Promise<HubClient> {
  if (import.meta.env.DEV && import.meta.env.VITE_HUB_DEV_IDENTITY) {
    const [{ createDevHubClient }, { roster }] = await Promise.all([
      import('@fxl-business/hub-sdk-testing'),
      import('./dev-roster'),
    ]);
    return createDevHubClient({ roster, identityId: readAdoptedIdentityId() });
  }
  return createHubClient(config);
}
```
Install as `pnpm add -D @fxl-business/hub-sdk-testing@2.1.0`. The guard must combine a **statically replaced** dev flag with an opt-in env var, and the import must be **dynamic**, so the branch is eliminated from a production bundle. `createDevHubClient` validates the roster and the `identityId` at construction (mirroring `createHubBff`'s fail-closed-at-construction rule); `DevHubClient.start()` is a no-op (nothing to renew) and `stop()` just drops the cache. The renewal ladder is deliberately not reproduced.

The roster itself is the consumer's — B ships only the shape. `missingDevDenyBranches(roster)` reports which of the four required branches (`access`, `no_org_access`, `missing_role`, `super_admin`) a roster does not yet reach; `devRosterCoverage(roster)` additionally reports the optional `missing_module`, `no_seat`, `not_a_member`.

---

## Not determinable from the tarball

- Whether the live Hub's backchannel refresh `Set-Cookie` actually uses the `__Host-` prefix (which is what decides whether §3.1 bites in practice). The regex is definitively still incapable of matching it; the Hub's behaviour is not in these files.
- Any changelog narrative for 2.1.0 beyond the `HUB_SDK_VERSION` doc comment — no CHANGELOG.md is shipped.
- The `@fxl-hub/hub-auth` and `@fxl-hub/shared-types` sources beyond what tsup inlined into `dist/server.js` / the chunks.
- Whether `hono >= 4.12.28` above 4.x has been tested — the peer range is open-ended with no upper bound.
