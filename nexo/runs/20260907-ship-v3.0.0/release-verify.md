# Release verify - v3.0.0

**Verdict: PASS**

Verify agent, independent of the implementer. No tracked file was modified, nothing was committed, tagged, pushed, or branch-switched.

- Date: 2026-09-07
- Repo: `/Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales`
- Proposed version: `v3.0.0`

## 1. Identity of the thing under test

```
$ git rev-parse HEAD
7ddf5257aada948ddc62b33b522ccaa507686a3d

$ git rev-parse --abbrev-ref HEAD
master

$ git status --short
?? .vscode/

$ git rev-list --count v2.8.0..master
21
```

HEAD is exactly the claimed release commit, on `master`.
The only working-tree dirt is the untracked `.vscode/`, which is the one expected exception.
The range is 21 commits, as claimed.

### Version bump justification

```
$ git log v2.8.0..master --grep="BREAKING CHANGE" --pretty=format:"%h %s"
1cde69a feat(api)!: gate baseline access on entitlements.access, not sales.core
```

Exactly one commit in the range carries the `!` marker and a `BREAKING CHANGE` footer, and it is a `feat(api)!`.
A major bump to `v3.0.0` is the correct Conventional Commits answer.

## 2. Command results

Every command was run exactly once, non-watching, with `CI=true` where a runner could otherwise watch.
No background process was left running.

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm run lint` | **0** | api + web eslint clean; the two shared packages have no lint script |
| `pnpm run type-check` | **0** | `tsc --build` of both packages, then `tsc --noEmit` in all 4 projects, clean |
| `pnpm test` | **0** | **1288 tests / 101 files, all passed** |
| `pnpm run build` | **0** | packages built, web bundle emitted, `built in 1.76s` |
| `pnpm --filter @fxl-sales/api test:integration` | **0** | **169 tests / 25 files, all passed** |

Unit-test breakdown:

| Project | Files | Tests |
| --- | --- | --- |
| `packages/shared-utils` | 3 | 80 |
| `apps/api` | 42 | 424 |
| `apps/web` | 56 | 784 |
| **total** | **101** | **1288** |

### Integration-suite database provenance

The suite really did run against the local Docker database, not staging.

```
apps/api/.env (credentials masked)
DATABASE_URL=postgresql://***:***@fxl-db-server:5432/fxl_sales_stg_db   <- staging, as documented
TEST_DATABASE_URL=postgresql://***:***@localhost:5006/fxl_sales
TEST_MIGRATE_DATABASE_URL=postgresql://***:***@localhost:5006/fxl_sales
ADMIN_DATABASE_URL=postgresql://***:***@localhost:5006/fxl_sales
```

`apps/api/test/rls/setup-env.ts` hard-overrides rather than defaults:

```ts
// Hard override, not ??=: with an .env pointing DATABASE_URL at a remote
// environment, the API under test would silently run against that remote DB
process.env.DATABASE_URL = appUrl;
```

`appUrl` resolves from `TEST_DATABASE_URL`, i.e. `localhost:5006`.
The integration log contains no occurrence of `fxl-db-server` or `stg_db`.
No stop was required.

## 3. Security review of `v2.8.0..master`

The range is 79 files, ~7.7k insertions.
Notably it touches **no** `apps/api/src/db/schema.ts`, **no** migration, and **no** non-test tenant query file.

### Finding 1 - The access gate fails CLOSED, and there is exactly one - **PASS**

`apps/api/src/middleware/app-auth.ts:186`

```ts
const hubAuthMiddleware = hubSdkConfig ? requireHubAuth(hubSdkConfig) : null;
```

`allowWithoutAccess` is never passed anywhere in `apps/api/src`, so it sits at the SDK default of `false`, which is the gate.
`requiredModule` is likewise never passed, so no route reads `entitlements.modules`.
A grep across `apps` and `packages` for `classifyHubAccess|hasHubOrgAccess|hasHubModule|requireHubModule` returns **no implementation and no export** - only two prose comment lines recording that they were deleted (`apps/api/src/middleware/__tests__/app-auth.test.ts:26`, `apps/web/src/lib/require-token.ts:84`).
The one-gate invariant holds.

The backstop when the SDK admits a request but leaves no context is fail-closed rather than a crash (`app-auth.ts`):

```ts
const MISSING_HUB_CONTEXT = { error: 'unauthorized', code: 'missing_hub_context' } as const;
```

The deny taxonomy is proven against the real verifier (in-process RSA keypair, stubbed discovery + JWKS, self-signed tokens) in `apps/api/src/middleware/__tests__/app-auth-access-gate.test.ts`, which covers all four required deny shapes plus the allow:

- `access: true` -> allow
- `access: false` -> 402 `no_org_access`
- `entitlements` present with **no** `access` key -> denies (401, the documented behaviour change)
- `entitlements` carrying the deleted `sales.core` module but no access -> 402
- missing token / unverifiable token / `contract_version_mismatch` -> 401
- missing role -> 403; entitled workspace owner -> allow

No security finding.

### Finding 2 - No credential can reach the browser bundle - **PASS**

`VITE_FXL_HUB_PUBLISHABLE_KEY` is removed from the schema, from `apps/web/.env.example` and from `apps/web/.env.dev.example` (the previously committed `pk_fxl-sales_...` literal is gone from both). The browser config is now only:

```ts
// apps/web/src/auth/provider.ts
return { apiUrl, environment: parseHubEnvironment(env.VITE_FXL_HUB_ENVIRONMENT), audience };
```

`grep` over `apps/web/src` for `CLIENT_SECRET|clientSecret|SECRET_KEY|healthToken|HEALTH_TOKEN|pk_` finds only prose comments plus the unrelated legacy referral-`apps` admin screen field `app.publishableKey` (`apps/web/src/admin/types.ts:12`), which is a per-referral-app public key belonging to a different domain, not Hub config. Pre-existing, unchanged in this range.

I additionally scanned the **built** bundle (`apps/web/dist/assets/*.js`). The only match for any secret-shaped pattern is the SDK's own guard, which is a positive result:

```js
function p2(r,t={}){if("clientSecret" in r)throw new Tw("clientSecret","hub-sdk: createHubClient was handed a configu…
```

No credential value is present in the bundle.
`VITE_*` strings surviving into the bundle are `VITE_API_URL`, `VITE_AUTH_BFF_BASE_PATH`, `VITE_FXL_HUB_API_URL`, `VITE_FXL_HUB_AUDIENCE`, `VITE_FXL_HUB_ENVIRONMENT`, `VITE_SENTRY_DSN` - all non-secret - plus one dead `VITE_CLERK_PUBLISHABLE_KEY` **key name** inside an unassigned zod schema that ships in the vendored `@fxl-business/hub-sdk` dist, not in this repo (`grep` for it over `apps/web/src` and `packages/*/src` is empty). No value, no read. Cosmetic only.

No security finding.

### Finding 3 - BFF wiring intact - **PASS**

All in `apps/api/src/middleware/app-auth.ts`, `createAppAuthBff()`:

```ts
const bff = createHubBff(hubSdkConfig, {
  sessionStore: session.store,
  ...(isHubDevelopment && session.kind === 'memory' ? { allowEphemeralSessionStore: true } : {}),
  ...(isHubDevelopment ? { insecureCookies: true } : {}),
  ...(hubAuthConfig.healthToken !== undefined ? { healthToken: hubAuthConfig.healthToken } : {}),
  trustedOrigins: [env.CORS_ORIGIN],
  timeoutMs: HUB_BFF_TIMEOUT_MS,          // 5_000
  sessionTtlSeconds: SESSION_TTL_MS / 1000,
  sessionAbsoluteTtlSeconds: SESSION_ABSOLUTE_TTL_MS / 1000,
  ...
});
```

- **durable `sessionStore`**: always passed. The in-memory route is admitted only as the pair `isHubDevelopment && session.kind === 'memory'`, so a production deploy that loses `DATABASE_URL` fails at boot rather than silently going per-process.
- **`trustedOrigins: [env.CORS_ORIGIN]`**: present, unconditional. The cross-origin CSRF regression of 2026-08-10 stays closed.
- **`healthToken`**: passed whenever defined; required outside development by the boot assertion (see config section).
- **`timeoutMs`**: 5s, bounding the Hub round-trip made inside the row-lock transaction.
- **`insecureCookies`**: passed **only** when `hubAuthConfig.environment === 'development'`, derived from the **Hub** environment, not `NODE_ENV`. Outside development the key is simply absent, and the SDK's own boot assertion refuses it there. The single local `secureCookies = !isHubDevelopment` is the one inversion point feeding `createHubLoginSupersedeMiddleware`.
- The login-supersede middleware is mounted only on the `session.kind === 'durable'` branch, as required.
- `bff.onError` and `router.onError` both carry `hubBffErrorHandler`; the mount is the ordinary `router.route('', bff)` with no origin shim.

Browser side, `apps/web/src/auth/react.tsx:253`:

```ts
autoRenew: false,
```

with `useEffect(() => () => client.stop(), [client])` at `:263`. The SDK's own renewal scheduler cannot race this app's visibility-gated one.

Both deleted shims are genuinely gone from the tree: `apps/api/src/auth/hub-bff-origin.ts` (-116) and `apps/api/src/auth/hub-rotated-cookie.ts` (-191), with their tests.

No security finding.

### Finding 4 - Tenancy - **PASS**

No non-test query file changed in this range. The full diffstat contains no `apps/api/src/db/schema.ts`, no `apps/api/src/domains/**/service.ts` and no `**/routes.ts` outside tests, so no query could have lost its `eq(table.orgId, ...)`.

The history route's isolation control is intact:

```
apps/api/src/domains/audit/history-service.ts:115
    const conditions: SQL[] = [eq(auditLog.actorOrgId, orgId)];
```

still the array's first literal element, and `history-service.ts` still does not import `getAdminDb`. The only files touched in that domain in the range are tests (`__tests__/history-route.test.ts`, `__tests__/routes.test.ts`).

No security finding.

### Finding 5 - No new logging or rendering of secrets or raw ids - **PASS**

```
$ git diff v2.8.0..master -- apps/api/src apps/web/src ':(exclude)*__tests__*' ':(exclude)*test*' \
    | grep -E "^\+.*(console\.(log|error|warn|debug)|logger\.)"
(no output)
```

Zero new log statements in production code.

The one new user-facing surface is `ForbiddenPanel` / `forbidden-copy.ts`, and it deliberately names nothing:

```ts
export const FORBIDDEN_COPY = {
  title: 'Permissão insuficiente',
  body: 'Você está conectado, mas esta conta não tem a permissão necessária para esta ação nesta Organização. Peça a quem administra a Organização no FXL Hub para liberar o seu acesso.',
  note: 'Você continua conectado, não é preciso entrar novamente.',
} as const;
```

No module id, no role id, no account id, no workspace id. The panel takes no props and reads no hook, so it structurally cannot render one. Consistent with the identifier law.

Committed example files carry blank values for every secret slot (`FXL_HUB_CLIENT_SECRET=`, `FXL_HUB_HEALTH_TOKEN=`, `HUB_SESSION_ENCRYPTION_KEY=`, `FXL_HUB_CONFIG=`).

No security finding.

### Supply chain (checked, not requested)

```
apps/api/package.json:19   "@fxl-business/hub-sdk": "2.2.0",
apps/web/package.json:16   "@fxl-business/hub-sdk": "2.2.0",
apps/api/package.json:27   "hono": "4.12.28",
pnpm-workspace.yaml        overrides: hono: 4.12.28
```

Exact pins, no caret, in both apps, plus the workspace-level `hono` override that keeps a single Hono copy. `pnpm-lock.yaml` contains **no** reference to `hub-sdk@1.3.1`; both `apps/*/node_modules/@fxl-business/hub-sdk/package.json` report `"version": "2.2.0"`. A stale `1.3.1` directory survives in the local `node_modules/.pnpm` store but is unreferenced by the lockfile and cannot be resolved.

**Security verdict: no findings. Zero security regressions identified in the range.**

## 4. Deployment-config risk (reported, not a FAIL)

### Variables whose name or requiredness changed

| Variable | App | Change |
| --- | --- | --- |
| `FXL_HUB_PUBLISHABLE_KEY` | api | **REMOVED** |
| `FXL_HUB_SECRET_KEY` | api | **RENAMED** to `FXL_HUB_CLIENT_SECRET` |
| `FXL_HUB_CLIENT_ID` | api | **NEW**, required (discrete form) |
| `FXL_HUB_ENVIRONMENT` | api | **NEW**, required (discrete form) |
| `FXL_HUB_CONFIG` | api | **NEW**, the alternative single-JSON form |
| `FXL_HUB_HEALTH_TOKEN` | api | **NEW**, required outside `development` |
| `FXL_HUB_AUDIENCE` | api | name unchanged, **now mandatory** and cross-checked (shipped blank before) |
| `HUB_SESSION_ENCRYPTION_KEY` | api | name unchanged, but its **default IKM source renamed** with the secret |
| `VITE_FXL_HUB_PUBLISHABLE_KEY` | web | **REMOVED** |
| `VITE_FXL_HUB_ENVIRONMENT` | web | **NEW**, hard-required at runtime |
| `VITE_FXL_HUB_AUDIENCE` | web | name unchanged, **now hard-required** (was optional/derivable) |

Baseline: `git show v2.8.0:apps/api/src/env.ts` lines 34-36 were `FXL_HUB_PUBLISHABLE_KEY`, `FXL_HUB_SECRET_KEY`, `FXL_HUB_AUDIENCE`, with no client id, environment, config or health token.

### Point-by-point

**1. `FXL_HUB_SECRET_KEY` -> `FXL_HUB_CLIENT_SECRET`, and it is the sealer's default HKDF IKM - CONFIRMED.**

`apps/api/src/env.ts:44` `FXL_HUB_CLIENT_SECRET: emptyToUndefined,`
`apps/api/src/auth/session-crypto.ts:5-14` documents HKDF-SHA256 from `HUB_SESSION_ENCRYPTION_KEY` when set, otherwise `FXL_HUB_CLIENT_SECRET`, and states the consequence: rotating either invalidates every stored session.
`apps/api/src/auth/session-crypto.ts:38-39` `deriveSessionKey(ikm)` -> `hkdfSync('sha256', ikm, HKDF_SALT, HKDF_INFO, KEY_BYTES)`.
`apps/api/src/middleware/app-auth.ts:254` `encryptionIkm: env.HUB_SESSION_ENCRYPTION_KEY ?? hubAuthConfig.clientSecret,` - so the override does apply, read off the validated `env`.

> **Highest deploy risk in this release.** If the value placed in `FXL_HUB_CLIENT_SECRET` differs by one byte from the old `FXL_HUB_SECRET_KEY`, every `hub_bff_sessions` row becomes undecryptable and every user is logged out at deploy. The SDK now also validates the secret's `sk_<slug>_<env>_<random>` format and its slug/environment agreement with the client id, so the old value may not even be a legal secret. To avoid a mass logout, set `HUB_SESSION_ENCRYPTION_KEY` to the old secret's value before deploying.

**2. `FXL_HUB_HEALTH_TOKEN` required whenever the environment is not `development` - CONFIRMED.**

`apps/api/src/config/auth-provider.ts:166-173`:

```ts
const healthToken = isSet(bag.FXL_HUB_HEALTH_TOKEN) ? bag.FXL_HUB_HEALTH_TOKEN : undefined;
if (config.environment !== 'development' && healthToken === undefined) {
  throw new HubConfigError('FXL_HUB_HEALTH_TOKEN', 'FXL_HUB_HEALTH_TOKEN is required outside development; the operator generates it and the Hub does not issue it');
}
```

Keyed on the **Hub** environment, not `NODE_ENV`. Pinned at `apps/api/src/config/__tests__/auth-provider.test.ts:99` and `:116`. Because `app-auth.ts:79` calls `tryLoadHubAuthConfig` at module top level and that function returns `null` only for the `absent`/`incomplete` presences, a fully-configured staging or production deploy missing this var **fails to boot**, it does not 503.

> Staging and production must each be given a freshly generated `FXL_HUB_HEALTH_TOKEN` or they will not start.

**3. `FXL_HUB_ENVIRONMENT` must equal the environment segment inside the client id, checked offline - CONFIRMED.**

Enforced in the pinned SDK (`@fxl-business/hub-sdk@2.2.0`, `dist/chunk-HEQZWEPD.js:4225-4232`):

```js
if (parsedClientId.environment !== environment) {
  throw new HubConfigError("environment", message("environment", `is "${environment}" but clientId is registered for "${parsedClientId.environment}"`
```

Pure string parsing, so genuinely offline. The secret is checked the same way at `:4247`. Repo intent recorded at `apps/api/src/middleware/app-auth.ts:87-90` and `apps/api/src/env.ts:38-42` (declared as a plain optional string rather than a `z.enum`, so the operator sees the named `HubConfigError` rather than a zod `process.exit(1)`).

> Caveat: no test in **this** repo pins the environment/clientId mismatch; the guarantee rides on the SDK.

**4. `FXL_HUB_AUDIENCE` must equal `app.` + the client id's slug - CONFIRMED.**

SDK `dist/chunk-HEQZWEPD.js:4259-4274`: shape check `/^app\.[a-z0-9-]+$/`, then `if (audience !== \`app.${parsedClientId.slug}\`) throw new HubConfigError("audience", ...)`.
Pinned locally at `apps/api/src/config/__tests__/auth-provider.test.ts:146-149` (`refuses to boot on a product. audience rather than answering 503`) and `:211`/`:218` (`no API module derives the Hub audience from a key`, asserting the source does not contain `parseAudienceFromPublishableKey`).
Requiredness tightened: at v2.8.0 both example files shipped `FXL_HUB_AUDIENCE=` blank; it is now `app.fxl-sales` and mandatory.

**5. Five discrete vars vs. one `FXL_HUB_CONFIG`, and setting both is a boot failure - CONFIRMED.**

`apps/api/src/config/auth-provider.ts:26-32` names the five: `FXL_HUB_API_URL`, `FXL_HUB_ENVIRONMENT`, `FXL_HUB_CLIENT_ID`, `FXL_HUB_CLIENT_SECRET`, `FXL_HUB_AUDIENCE`.
`apps/api/src/config/auth-provider.ts:97-110`:

```ts
if (jsonSet && discreteSet.length > 0) {
  throw new HubConfigError('FXL_HUB_CONFIG',
    `FXL_HUB_CONFIG is set alongside ${discreteSet.join(', ')}; use FXL_HUB_CONFIG alone or the five discrete variables alone`);
}
if (jsonSet) return 'json';
if (discreteSet.length === HUB_DISCRETE_ENV_VARS.length) return 'discrete';
if (discreteSet.length === 0) return 'absent';
return 'incomplete';
```

The ambiguity check runs **first**, so mixing fails even when the discrete side is incomplete, and it names every offender without printing a value. Pinned at `apps/api/src/config/__tests__/auth-provider.test.ts:130-143`.
`FXL_HUB_HEALTH_TOKEN`, `FXL_HUB_REDIRECT_URI`, `FXL_HUB_POST_LOGIN_*` and `HUB_SESSION_ENCRYPTION_KEY` sit outside both forms and are always discrete.

> **Deploy risk.** Any target (Coolify / Infisical) that still carries a leftover `FXL_HUB_API_URL` or `FXL_HUB_AUDIENCE` **and** is given the new `FXL_HUB_CONFIG` JSON will refuse to boot. Migrating to the JSON form means deleting the discrete vars, not just leaving them set.

**6. `VITE_*` changes - CONFIRMED: one removed, one added, one tightened.**

`packages/shared-types/src/env.ts:14-18` drops `VITE_FXL_HUB_PUBLISHABLE_KEY`, adds `VITE_FXL_HUB_ENVIRONMENT: z.enum([...]).optional()`, and tightens `VITE_FXL_HUB_AUDIENCE` to `.min(1)`.
The real gate is at runtime in `apps/web/src/auth/provider.ts`, where both are hard-required despite the schema saying `.optional()`: `parseHubEnvironment` throws on anything not in `production|staging|development`, and `loadHubBrowserConfig` throws `'VITE_FXL_HUB_API_URL and VITE_FXL_HUB_AUDIENCE are required'`.
`VITE_API_URL`, `VITE_AUTH_PROXY_TARGET`, `VITE_AUTH_BFF_BASE_PATH`, `VITE_SENTRY_DSN` are unchanged.

> **Deploy risk.** `sharedClientEnv` is imported by nothing in `apps/web`, so there is no build-time validation, and `loadHubBrowserConfig` runs inside a render-phase `useMemo`. A Vercel build missing `VITE_FXL_HUB_ENVIRONMENT` or `VITE_FXL_HUB_AUDIENCE` **builds green and throws in the browser on first render** - a white screen, not a build failure. Both must be added to the Vercel environment before the deploy. The stale `VITE_FXL_HUB_PUBLISHABLE_KEY` there is now inert and can be removed.

**7. Database migrations in this range - NONE.**

```
$ git diff --stat v2.8.0..master -- apps/api/drizzle
(no output)
$ git log --oneline v2.8.0..master -- apps/api/drizzle
(no output)
```

`apps/api/drizzle` is the only migrations directory in the tree, and no path under it appears among the 79 changed files.

> **Rollback is a pure code revert.** No schema step is required going out and none blocks going back.

### Other config-relevant behaviour changes

- `secureCookies` no longer derives from `NODE_ENV` (`- const secureCookies = (process.env.NODE_ENV ?? 'development') === 'production';`). It is now derived from the Hub `environment`. A box running `NODE_ENV=production` with `FXL_HUB_ENVIRONMENT=staging` will now behave differently with respect to cookie `Secure` / `__Host-` naming than it did at v2.8.0.
- Hub config is read off the **validated `env` object** via `hubEnvBag` rather than raw `process.env` (`- const hubAuthConfig = tryLoadHubAuthConfig(process.env);`), so a blank `FOO=` now reads as unset rather than as a present empty string.
- The deploy should run a clean install so the resolved SDK is unambiguously 2.2.0.

## 5. Documentation drift observed (not a finding, not a blocker)

`CLAUDE.md` states it is "the ONE place in the tree that still spells" `sales.core`. Two other occurrences exist and both are benign:

- `apps/api/src/middleware/__tests__/app-auth-access-gate.test.ts:176` - a **negative** fixture proving a workspace carrying the deleted module but no `access` still gets 402.
- `apps/web/src/auth/__tests__/react.test.tsx:218,2113` - the argument to `client.checkoutUrl('sales.core')`, a checkout product identifier, not an access gate.

Neither reads `modules` for baseline access, so the documented invariant holds; only the "one place" prose is now slightly stale.

## 6. Verdict

**PASS.**

- All five commands exit 0.
- 1288 unit tests and 169 integration tests pass, the latter provably against the local Docker database.
- No security finding on any of the five reviewed axes.
- HEAD is exactly `7ddf525` on `master`, the range is 21 commits, and it contains exactly one `feat(api)!` with a `BREAKING CHANGE` footer, which justifies `v3.0.0`.

Deployment-config risk is **reported above and is not a FAIL**, but three items should be handled before or during the release cut: the `FXL_HUB_CLIENT_SECRET` rename versus the session sealer's HKDF IKM, the newly required `FXL_HUB_HEALTH_TOKEN` outside development, and the two newly required `VITE_*` variables that fail at render rather than at build.
