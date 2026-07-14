---
id: 01-sdk-contract-baseline
milestone: null
status: parked
depends_on: []
files_modified: [CLAUDE.md, README.md, apps/api/.env.dev.example, apps/api/.env.example, apps/api/package.json, apps/api/src/config/__tests__/auth-provider.test.ts, apps/api/src/config/__tests__/hub-sdk-contract.test.ts, apps/api/src/config/auth-provider.ts, apps/api/src/middleware/__tests__/app-auth.test.ts, apps/api/src/middleware/app-auth.ts, apps/web/.env.dev.example, apps/web/.env.example, apps/web/package.json, apps/web/src/auth/__tests__/provider.test.ts, apps/web/src/auth/provider.ts, docs/deployment/hub-sdk-integration.md, pnpm-lock.yaml]
acceptance: "Given a clean install and the registered FXL Sales Hub client, when dependency, configuration, BFF, verifier, claims, environment, and deployment contracts are inspected, then both product packages resolve the published @fxl-business/hub-sdk 1.2.0 artifact, the SDK alone owns OAuth, discovery, JWKS verification, and Hub web integration for audience product.fxl-sales, API authorization reads only verified entitlements.modules and roles.workspace with sales.core as the core module, all five SDK BFF routes remain mounted, and operator-owned entitlement, invitation, domain-cookie, reconciliation, and auth-origin responsibilities are documented without product-owned Hub admin endpoints."
---

# Slice 01 - SDK contract baseline

## Goal

Turn the already-installed `@fxl-business/hub-sdk` 1.2.0 integration into an executable product contract.
Remove the product's duplicate audience parser, lock `product.fxl-sales` and `sales.core`, prove that the published SDK owns the complete auth surface, and record the operator deployment handoff without adding Hub administration behavior to FXL Sales.

## Installed SDK evidence

The executor must treat the installed published artifact as the source contract, not copy its implementation into the product.
The current lockfile resolves both product importers to `@fxl-business/hub-sdk@1.2.0(hono@4.12.25)` with registry integrity `sha512-/9o1+wOAXzFILE9AT8aGvObzRaeFYGpXd20gSxkpoHqeSnnqOws1a3RsO7sjw2Ow1NlcprTCjfdBMwcXAE50LQ==`.
The artifact exports `HUB_SDK_VERSION = "1.2.0"`, `loadHubConfigFromEnv`, `deriveAudience`, `createHubBff`, `requireHubAuth`, and `createHubClient`.
Its BFF owns `GET /auth/login`, `GET /auth/callback`, `POST /auth/refresh`, `POST /auth/switch`, and `POST /auth/logout`.
Its discovery code owns `/.well-known/oauth-authorization-server`, derives the JWKS location, and supplies the Hub web origin to browser deep-link builders.
Its verifier guarantees `sub`, `workspaceId`, `entitlements.modules`, and `roles.workspace` after signature, issuer, audience, type, expiry, algorithm, and JWKS verification.
Other token payload fields remain signed data but are not part of that verifier guarantee.

## Scope and ownership boundary

This slice may adapt FXL Sales to the public SDK API and add tests and documentation.
It must not edit `node_modules`, patch or vendor the SDK, import `jose`, import `@fxl-hub/hub-auth`, hard-code OAuth endpoints, fetch JWKS directly, or construct Hub web URLs.
It must not create product routes for Hub Admin trials, grants, organizations, membership invitations, entitlement reconciliation, or invitation delivery.
It must not implement browser resume, request replay, or large-workspace pagination because slice `02-browser-resume-and-workspaces` owns those behaviors.
It must not implement durable or transactional BFF session storage because slice `03-transactional-server-sessions` owns that behavior.
It must not alter database schema, migrate an environment, rotate a secret, start a release, or promote a branch.
The current in-memory BFF session default may remain for this slice, but the documentation must identify durable production storage as a mandatory deployment precondition owned by slice 03.
Preserve unrelated `.vscode/` content and `nexo/knowledge/doubts/20260707-missing-entitlement.md`.

## File map

- `apps/api/package.json`, `apps/web/package.json`, and `pnpm-lock.yaml` are the dependency contract and must retain `^1.2.0` in both importers plus the exact published 1.2.0 lock entry.
- `apps/api/src/config/auth-provider.ts` is the server-only adapter from product environment values to the SDK config and fixed Sales product constants.
- `apps/api/src/config/__tests__/auth-provider.test.ts` locks SDK-owned config loading, exact audience validation, secret requirements, and `sales.core`.
- `apps/api/src/config/__tests__/hub-sdk-contract.test.ts` locks manifest, lockfile, installed artifact, SDK-only dependency ownership, server composition markers, and operator documentation.
- `apps/api/src/middleware/app-auth.ts` composes the SDK BFF and verifier and maps only verifier-guaranteed authorization fields into the legacy Hono context.
- `apps/api/src/middleware/__tests__/app-auth.test.ts` locks the real SDK route surface and claims boundary through the product adapter.
- `apps/web/src/auth/provider.ts` maps Vite public values into `HubSdkConfig` and validates the fixed product audience through the SDK.
- `apps/web/src/auth/__tests__/provider.test.ts` locks the browser-side registered key and audience contract without reimplementing the SDK parser.
- `apps/api/.env.example`, `apps/api/.env.dev.example`, `apps/web/.env.example`, and `apps/web/.env.dev.example` provide matching public client, callback, same-origin BFF, and fixed-audience guidance.
- `docs/deployment/hub-sdk-integration.md` is the canonical operator handoff and ownership document.
- `README.md` links the canonical handoff and keeps only the short developer setup summary.
- `CLAUDE.md` records the durable auth and authorization invariants for later work.

## Exact product interfaces

### API config adapter

Replace the manual publishable-key parser and audience-derived module calculation in `apps/api/src/config/auth-provider.ts` with the SDK's public helpers.
Keep one server-only wrapper because FXL Sales requires a confidential client secret while `loadHubConfigFromEnv` also supports public clients.

The module must expose this shape:

```ts
import type { HubSdkConfig } from '@fxl-business/hub-sdk';

export const HUB_PRODUCT_AUDIENCE = 'product.fxl-sales' as const;
export const HUB_CORE_MODULE = 'sales.core' as const;

export type HubAuthConfig = {
  sdk: HubSdkConfig & { secretKey: string };
  audience: typeof HUB_PRODUCT_AUDIENCE;
  coreModule: typeof HUB_CORE_MODULE;
};

export function loadHubAuthConfig(env: Record<string, string | undefined>): HubAuthConfig;
export function tryLoadHubAuthConfig(
  env: Record<string, string | undefined>,
): HubAuthConfig | null;
```

`loadHubAuthConfig` must call `loadHubConfigFromEnv(env)` from the SDK.
It must require the resulting `secretKey` to be a non-empty string.
It must call the SDK's `deriveAudience(sdk)` and require the result to equal `HUB_PRODUCT_AUDIENCE`.
It must return `HUB_CORE_MODULE` as a fixed product constant and must not derive it by rewriting the audience string.
The optional `FXL_HUB_AUDIENCE` escape hatch may remain accepted by the SDK only when its value is exactly `product.fxl-sales`.
Any different override must fail closed during config loading.
`tryLoadHubAuthConfig` may continue returning `null` for incomplete or invalid configuration so the API can expose its existing `hub_auth_not_configured` response.

### Browser config adapter

Make `BrowserHubConfig` an alias or structural equivalent of `Pick<HubSdkConfig, 'apiUrl' | 'publishableKey' | 'audience'>`.
After reading Vite values, call `deriveAudience(config)` from `@fxl-business/hub-sdk` and reject a value other than `product.fxl-sales`.
Do not parse the publishable key in product code.
Keep `getHubBffBasePath` unchanged: an explicitly empty `VITE_AUTH_BFF_BASE_PATH` means the browser uses same-origin `/auth/*`, while an explicit non-empty value selects the API origin.

### Claims boundary

Import `HubAuthContext` as a type from `@fxl-business/hub-sdk` and define the narrow product input from its verified top-level fields:

```ts
export type AppHubAuthContext = Pick<
  HubAuthContext,
  'accountId' | 'workspaceId' | 'entitlements' | 'roles'
>;
```

Use `auth.entitlements.modules` for the `sales.core` feature gate.
Use `auth.roles.workspace` for API role mapping.
Workspace `owner` and `admin` may map to the existing full-access legacy role set.
Every other workspace role maps to no legacy admin, seller, or finder role in the API authorization context.
Do not inspect `claims.isSuperAdmin`, `claims.roles.productRoles`, names, email, avatar, workspace labels, or workspace previews for API authorization.
Slice 02 may parse optional browser display claims defensively, but those fields must not become verifier guarantees or server authorization inputs.

### SDK composition seams

Retain the public `appAuthMiddleware` and `createAppAuthBff()` exports used by `apps/api/src/server.ts`.
Add explicit factories so focused tests and slice 03 can inject only documented SDK seams without changing the production default:

```ts
export function createAppAuthMiddleware(
  envBag?: Record<string, string | undefined>,
  options?: Pick<RequireHubAuthOptions, 'fetchImpl'>,
): MiddlewareHandler;

export type AppAuthBffOptions = Pick<
  CreateHubBffOptions,
  'fetchImpl' | 'sessionStore'
>;

export function createAppAuthBff(
  envBag?: Record<string, string | undefined>,
  options?: AppAuthBffOptions,
): Hono | null;
```

Defaults use `process.env` and the SDK defaults.
The middleware factory must pass the validated `config.sdk` to `requireHubAuth` and must not pass a product-owned verifier, issuer, JWKS URI, or audience parser.
It may forward only the SDK's documented injectable `fetchImpl` test seam.
The BFF factory must pass the same `config.sdk` to `createHubBff`, merge the SDK options without weakening secure-cookie behavior, and set the existing product redirect values through `redirectUri`, `postLoginRedirect`, and `postLoginErrorRedirect`.
Production construction must continue using the actual SDK imports.
`apps/api/src/server.ts` must continue mounting the returned router at `app.route('', authBff)` so the SDK paths stay `/auth/*`, not `/auth/auth/*`.
Every protected `/api/v1/*` route must continue receiving `appAuthMiddleware` before its product handler and before `requireAdmin` when applicable.

## RED oracle 1 - dependency and SDK ownership contract

Create `apps/api/src/config/__tests__/hub-sdk-contract.test.ts` first.
Use `readFileSync`, `resolve`, and `fileURLToPath` following the existing API config contract tests.
Import `HUB_SDK_VERSION` from `@fxl-business/hub-sdk` so the test checks the artifact that Node actually resolves.

Lock these exact test names and assertions:

1. `pins both product packages and the lockfile to the published Hub SDK 1.2.0 artifact`
   Assert both manifest specifiers are exactly `^1.2.0`.
   Assert both lockfile importer entries resolve `1.2.0(hono@4.12.25)`.
   Assert the package snapshot contains the exact 1.2.0 registry integrity and no workspace, link, file, Git, or tarball override for this dependency.
   Assert `HUB_SDK_VERSION` and the resolved installed package version are both `1.2.0`.
2. `keeps OAuth discovery verification and Hub web integration behind the SDK dependency`
   Assert neither product manifest directly depends on `jose`, `@fxl-hub/hub-auth`, `openid-client`, or `oauth4webapi`.
   Scan tracked source files under `apps/api/src` and `apps/web/src` and reject imports from `jose` or `@fxl-hub/hub-auth`.
   Reject product-owned discovery, JWKS, authorization-endpoint, token-endpoint, or Hub-web URL constants while allowing imports and calls through `@fxl-business/hub-sdk`, `@fxl-business/hub-sdk/server`, and `@fxl-business/hub-sdk/client`.
   Keep the scan narrow to source code so documentation and the locked oracle itself do not create false positives.
3. `keeps the SDK BFF mounted at root before protected product route handlers`
   Read `apps/api/src/server.ts` and assert it still creates the BFF through `createAppAuthBff`, mounts it with `app.route('', authBff)`, and applies `appAuthMiddleware` on the protected API route families.
   Assert there is no product route declaration for Hub Admin trial, grant, organization, entitlement-reconciliation, or membership-invitation endpoints.
4. `documents every operator-owned Hub deployment responsibility without assigning Hub endpoints to Sales`
   Read `docs/deployment/hub-sdk-integration.md` and assert it names `product.fxl-sales`, `sales.core`, day-one `active` or `trialing` entitlement seeding, Hub-owned membership invitation, same registrable domain, exact callback registration, `AUTH_PUBLIC_URL`, `HUB_ISSUER`, the matching web auth origin, preserved workspace-to-`org_id` mapping, periodic reconciliation, and durable production session storage.
   Assert the ownership section explicitly says FXL Sales does not implement Hub Admin trials, grants, organizations, reconciliation workers, or invitation delivery.

Run the dependency oracle in RED:

```bash
pnpm --filter @fxl-sales/api test -- src/config/__tests__/hub-sdk-contract.test.ts
```

Expected RED result: the documentation test fails because the canonical operator handoff does not exist, and the ownership checks expose any product-side SDK bypass left in the adapter.
Once observed, these test names and expectations are locked and must not be weakened during Green.

## RED oracle 2 - fixed config and claims contract

Extend `apps/api/src/config/__tests__/auth-provider.test.ts` with these exact tests:

- `delegates registered FXL Sales config and audience derivation to the SDK`
  Use API URL `http://localhost:9016`, publishable key `pk_fxl-sales_VzQ9-LUONCnlKllxCRLffN3nw6Z9PQl2`, and a fake non-production secret.
  Assert `config.sdk` contains those values, `config.audience` is `product.fxl-sales`, and `config.coreModule` is `sales.core`.
- `handles underscores in the publishable-key random segment through the SDK parser`
  Use a valid key whose random suffix contains `_` and assert the audience remains exactly `product.fxl-sales`.
- `rejects a configured audience outside product.fxl-sales`
  Pass `FXL_HUB_AUDIENCE=product.other` and assert config loading throws without returning a usable config.
- Keep `rejects missing secret keys` and `returns null from the optional loader when Hub env is incomplete` locked.

Extend `apps/web/src/auth/__tests__/provider.test.ts` with these exact tests:

- `derives product.fxl-sales through the SDK from the registered browser key`
  Load the registered Hub URL and publishable key, then assert the SDK's `deriveAudience` returns `product.fxl-sales`.
- `rejects a browser audience override outside product.fxl-sales`
  Pass `VITE_FXL_HUB_AUDIENCE=product.other` and assert the browser config loader throws.
- Keep all existing BFF base-path tests unchanged.

Replace the custom nested-claims fixtures in `apps/api/src/middleware/__tests__/app-auth.test.ts` with `AppHubAuthContext` fixtures using top-level `entitlements` and `roles`.
Lock these exact tests:

- `maps verified Hub account and workspace ids into the Hono auth context`
- `maps verified workspace owners and admins to the existing admin guard role`
- `does not elevate a member from optional raw product or super-admin claims`
- `accepts sales.core from verified entitlements.modules`
- `rejects a workspace without sales.core even when optional raw claims advertise it`

For the two raw-claims cases, add extra `claims` data structurally at runtime but call the product functions through their `AppHubAuthContext` input.
The assertions must prove that only the verified top-level `roles` and `entitlements` fields affect the result.

Run the config and claims oracle in RED:

```bash
pnpm --filter @fxl-sales/api test -- src/config/__tests__/auth-provider.test.ts src/middleware/__tests__/app-auth.test.ts && pnpm --filter @fxl-sales/web test -- src/auth/__tests__/provider.test.ts
```

Expected RED result: the API tests fail because the current adapter manually parses the audience, derives the core module from it, and authorizes from optional nested raw claims.
The browser wrong-audience case fails because the current loader accepts any override.
After the initial failure, the locked tests are immutable to the implementer.

## RED oracle 3 - real SDK BFF and verifier surface

In `apps/api/src/middleware/__tests__/app-auth.test.ts`, create a small Hono harness around the explicit product factories and the real installed SDK.
Call `__clearDiscoveryCache()` from the SDK before and after route tests.
Use an injected `fetchImpl` that returns one valid RFC 8414 discovery document with an issuer, authorization endpoint, token endpoint, and `fxl_web_url` under `http://hub.test`.
Do not mock `createHubBff`, `requireHubAuth`, OAuth route behavior, or token verification.

Lock these exact tests:

- `exposes the complete SDK BFF route surface at same-origin auth paths`
  Mount the non-null router at `''`.
  Assert `GET /auth/login` returns `302` to the discovered authorization endpoint with the registered publishable key, exact callback, state, and S256 PKCE parameters.
  Assert a callback without a valid SDK login transaction redirects to the configured error target instead of returning `404`.
  Assert unauthenticated `POST /auth/refresh` and `POST /auth/switch` return the SDK `401 no_session` response.
  Assert `POST /auth/logout` returns `204`.
- `fails a protected route closed through the SDK verifier when no bearer token is present`
  Mount `createAppAuthMiddleware(envBag, { fetchImpl })` before a probe handler.
  Assert a request without a bearer token returns `401` with SDK code `missing_token` and the probe handler is never reached.
- `uses product.fxl-sales in SDK refresh requests`
  Complete the minimum login and callback exchange using cookies captured from the SDK responses and a fake token endpoint response.
  Call `POST /auth/refresh` with the resulting opaque BFF session cookie and inspect only the injected upstream request.
  Assert the SDK sends `product.fxl-sales`, never the publishable key, as the refresh `productId` query value.
  Do not reproduce SDK request construction in the product adapter or assert private implementation details beyond the public route and audience contract.

Run the route oracle in RED with the other API files:

```bash
pnpm --filter @fxl-sales/api test -- src/config/__tests__/hub-sdk-contract.test.ts src/config/__tests__/auth-provider.test.ts src/middleware/__tests__/app-auth.test.ts
```

Expected RED result: the explicit injectable factory calls do not compile until the product adapter accepts an environment bag and documented SDK test seams.
The existing production exports and server call sites must remain source-compatible during Green.

## GREEN implementation sequence

- [ ] Run `pnpm install --frozen-lockfile` once and record that both importers resolve the registry artifact rather than a workspace or local path.
- [ ] If either manifest or lock entry differs from the exact contract, run `pnpm --filter @fxl-sales/api add @fxl-business/hub-sdk@^1.2.0` and `pnpm --filter @fxl-sales/web add @fxl-business/hub-sdk@^1.2.0`, then retain only the intended manifest and lockfile changes.
- [ ] Add the dependency, SDK ownership, server composition, and documentation contract test with the locked names above.
- [ ] Replace the API manual audience parser with `loadHubConfigFromEnv` plus `deriveAudience` from the SDK.
- [ ] Add fixed `HUB_PRODUCT_AUDIENCE` and `HUB_CORE_MODULE` constants and fail closed when the SDK-derived or explicitly overridden audience is not `product.fxl-sales`.
- [ ] Keep the confidential API secret requirement in the thin product wrapper and keep optional loading behavior unchanged.
- [ ] Validate browser config through the SDK's `deriveAudience` without adding a second parser.
- [ ] Replace API authorization reads from `auth.claims.*` with the verifier-guaranteed top-level `auth.entitlements` and `auth.roles` fields.
- [ ] Remove API authorization based on optional `isSuperAdmin` and `productRoles` payload fields.
- [ ] Preserve the account-to-`userId`, workspace-to-`orgId`, and workspace owner/admin-to-legacy-admin mappings.
- [ ] Add environment-bag and SDK-option seams to the product factories while keeping production defaults and exported names unchanged.
- [ ] Forward only documented SDK options and preserve the SDK's secure-cookie default.
- [ ] Run the real SDK BFF and verifier route oracle until all locked cases pass.
- [ ] Set the local API examples to the exact registered callback `http://localhost:8006/auth/callback` and explain that production values must match the Hub registry byte-for-byte.
- [ ] Keep the browser's local `VITE_AUTH_BFF_BASE_PATH=` value empty so SDK browser calls use same-origin `/auth/*` through the Vite proxy.
- [ ] Document that any explicit API or browser audience override must remain `product.fxl-sales` and normally stays unset because the registered key derives it.
- [ ] Create `docs/deployment/hub-sdk-integration.md` with the operator contract below and link it from `README.md`.
- [ ] Update `CLAUDE.md` so future implementation work preserves the verified-claims boundary and canonical operator document.
- [ ] Re-run every focused oracle without changing its locked expectations.
- [ ] Run API and web type checks and lint after the focused tests are green.

## Canonical operator document content

`docs/deployment/hub-sdk-integration.md` must use one complete sentence per physical line and contain these sections.

### Product constants

Record audience `product.fxl-sales`, core module `sales.core`, local Hub API `http://localhost:9016`, registered local callback `http://localhost:8006/auth/callback`, and registered publishable key `pk_fxl-sales_VzQ9-LUONCnlKllxCRLffN3nw6Z9PQl2`.
State that secret keys come from the Hub operator or Infisical and must never enter source control, browser variables, logs, or screenshots.

### SDK ownership

State that the SDK alone owns login, callback, refresh, active-workspace switch, logout, discovery, JWKS access-token verification, checkout links, and subscription-management links.
State that the product may compose these SDK functions but may not duplicate their OAuth, discovery, verifier, or Hub web URL logic.

### Environment registration

Provide a local, staging, and production checklist.
Each environment needs a distinct Hub client, exact callback URI, API secret, browser publishable key, API and web BFF routing values, and matching product audience.
The callback sent by the BFF must match the Hub registry byte-for-byte.
If web and API origins differ, the operator must either provide scoped `/auth/*` rewrites at the web origin or set `VITE_AUTH_BFF_BASE_PATH` to the API origin and register that same API-origin callback.
Do not describe the catch-all SPA rewrite as an auth proxy.

### Day-one provisioning and invitations

Require the Hub operator to create or preserve each workspace id so it equals the existing FXL Sales `org_id` before users enter the product.
Require an `active` or `trialing` entitlement containing `sales.core` before first gated access.
Assign account creation, workspace membership, Hub invitation creation, and invitation delivery to Hub operator workflows.
Clarify that existing FXL Sales seller or finder domain records do not replace Hub account and workspace membership.

### Domain, cookie, and auth-origin invariants

Require Hub auth and the product web origin to share one registrable production domain where the deployment depends on first-party cookie behavior.
Require Hub-side `AUTH_PUBLIC_URL`, `HUB_ISSUER`, and the configured web auth origin to describe the same externally reachable auth origin.
Require TLS, secure cookies, exact redirect registration, and matching forwarding headers at every proxy.
State that a production deployment must provide the durable SDK session store required by slice 03 and must not rely on the SDK's in-memory development default.

### Reconciliation and incident checks

Assign periodic comparison of Hub workspace membership, entitlement status, module grants, and preserved workspace ids against FXL Sales tenancy to the operator or Hub platform automation.
List missing membership, missing `sales.core`, mismatched `workspaceId` and `org_id`, redirect mismatch, origin mismatch, clock skew, cookie loss, and stale secret as handoff checks.
Describe clock synchronization as an operator responsibility because verifier time checks and OAuth flows require accurate hosts.

### Explicit non-ownership

State plainly that this repository does not implement Hub Admin trial, grant, organization, membership invitation, reconciliation-worker, or invitation-delivery endpoints.
State that operators perform those actions in Hub or Hub-owned automation and that FXL Sales consumes only the SDK and verified Hub claims.

## Refactor limits

Refactor only after all focused tests are green.
Keep the product config wrapper small and keep all OAuth and verifier behavior in the SDK.
Do not introduce a general auth abstraction, dependency-injection container, new router framework, new package, new environment loader, or generated config layer.
Do not split `apps/api/src/server.ts` in this slice.
Do not change public browser auth exports, route guards, token caching, workspace UI, API retry behavior, or persistence behavior.
Do not rename existing tenant context keys or change database authorization.

## Security and regression notes

The server secret remains server-only.
The browser receives only the publishable key and an opaque HttpOnly BFF session cookie.
Access tokens remain bearer tokens verified by `requireHubAuth` before any protected product handler.
`sales.core` is read only from verified `entitlements.modules`.
Workspace privilege is read only from verified `roles.workspace`.
Decoded optional JWT payload fields must never become an authorization source.
Issuer, JWKS URI, OAuth endpoints, algorithms, clock tolerance, and Hub web origin remain SDK-owned.
The SDK's discovered verifier must fail closed on discovery or verification errors.
The BFF stays mounted at root so existing `/auth/*` callbacks, cookies, local Vite proxying, and registered redirects do not change.
Public referral redirects at `/r/:code` and every tenant `org_id` filter remain unchanged.

## Verification

The locked per-slice Gate 2 oracle is:

```bash
pnpm --filter @fxl-sales/api test -- src/config/__tests__/hub-sdk-contract.test.ts src/config/__tests__/auth-provider.test.ts src/middleware/__tests__/app-auth.test.ts && pnpm --filter @fxl-sales/web test -- src/auth/__tests__/provider.test.ts
```

Expected result: all named dependency, ownership, config, BFF route, verifier, claims, environment, and operator-documentation tests pass with no skipped cases.

The executor must then run these run-once secondary checks:

```bash
pnpm --filter @fxl-sales/api type-check
pnpm --filter @fxl-sales/web type-check
pnpm --filter @fxl-sales/api lint
pnpm --filter @fxl-sales/web lint
git diff --check
```

The separate Verify agent owns the objective Gate 2 verdict.
The integrated wave must still run the repository full suite, root lint, root type-check, build, security checks, and later feature-boundary mutation verification under the parent Nexo flow.

## Done means

The installed and lockfile artifact is demonstrably the published SDK 1.2.0 in both product packages.
No product source directly owns OAuth, discovery, JWKS verification, or Hub web URL construction.
The audience and core module are fixed to `product.fxl-sales` and `sales.core` through the SDK-backed config adapter.
The five SDK BFF routes and protected verifier path are exercised through the product adapter.
API authorization consumes only verifier-guaranteed entitlement and workspace-role fields.
Local examples and production handoff invariants agree on callback and same-origin routing.
Every Hub operator responsibility is explicit, and no Hub operator endpoint or worker has been added to FXL Sales.
