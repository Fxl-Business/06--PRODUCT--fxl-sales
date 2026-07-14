# Verify repair 2 report - Slice 01 SDK contract baseline

## Verdict

FAIL.

Commit `65ef97132faa4e9013bcd1165043e766b9c47962` is mechanically green, but it does not satisfy two explicit SDK ownership and type-provenance requirements in the approved slice plan.
The feature branch must not pass Gate 2 until both blocking findings below are repaired and independently reverified.

## Verification target

- Worktree: `/Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales/.worktrees/01-sdk-contract-baseline`
- Branch: `feat/01-sdk-contract-baseline`
- Commit: `65ef97132faa4e9013bcd1165043e766b9c47962`
- Baseline diff: `bb7e7ed...65ef971`
- Worktree state before and after verification: clean
- Changed scope: the 14 planned source, test, environment, and documentation files only

## Blocking findings

### 1. The browser adapter owns publishable-key parsing instead of delegating it to the SDK

The approved plan requires browser configuration validation to use the SDK and explicitly says not to parse the publishable key in product code.
`apps/web/src/auth/provider.ts:1-24` defines `HUB_PUBLISHABLE_KEY_PREFIX`, checks `startsWith('pk_fxl-sales_')`, and checks suffix length locally.
That is product-owned publishable-key format and product-slug parsing.
`loadHubBrowserConfig` does not import or invoke any `@fxl-business/hub-sdk/client` surface.
The wrong-product-key runtime probe passes only because this local parser rejects it.

The test named `derives product.fxl-sales through the SDK from the registered browser key` does not prove that the browser adapter delegates validation.
At `apps/web/src/auth/__tests__/provider.test.ts:12-28`, the test first calls `loadHubBrowserConfig`, then separately creates an SDK client and calls `checkoutUrl`.
The SDK invocation occurs after the product loader has already accepted the configuration, so the oracle permits the production adapter to retain its own parser.

The published browser-safe client calls SDK audience derivation synchronously during `createHubClient` construction.
A repair can therefore validate through the browser-safe client surface without importing the browser-unsafe package root and without implementing discovery, JWKS, OAuth, or Hub web URL logic locally.
The locked browser oracle must prove that production adapter delegation rather than testing the SDK separately.

### 2. The authorization input type is manually duplicated instead of narrowed from the SDK verifier type

The approved exact interface requires `AppHubAuthContext` to be a `Pick<HubAuthContext, 'accountId' | 'workspaceId' | 'entitlements' | 'roles'>` imported as a type from the SDK.
`apps/api/src/middleware/app-auth.ts:17-26` instead declares a standalone object type with manually copied strings, modules, and workspace role fields.
This manual type is currently non-`any`, and the compile-time anti-`any` assertions pass.
However, it is not tied to the SDK verifier contract, so an SDK type change cannot fail the product type check at this boundary.
That misses the plan's required type provenance even though current runtime authorization reads only the intended top-level fields.

## Passed executable checks

- `pnpm install --frozen-lockfile` passed and reported the lockfile up to date.
- The installed artifact resolves to `@fxl-business/hub-sdk` version `1.2.0` for both importers with the expected registry integrity.
- The truly focused API run passed 3 files and 23 tests with no skipped cases.
- The truly focused web run passed 1 file and 7 tests with no skipped cases.
- The plan's package-script command also passed the surrounding API and web suites, totaling 168 API tests and 143 web tests.
- `pnpm --filter @fxl-sales/api type-check` passed.
- `pnpm --filter @fxl-sales/web type-check` passed.
- `pnpm --filter @fxl-sales/api lint` passed.
- `pnpm --filter @fxl-sales/web lint` passed.
- `pnpm run build` passed for shared packages, API, and the Vite production web bundle.
- `pnpm audit --prod` passed with no known vulnerabilities.
- `node scripts/no-legacy-auth.mjs` passed.
- `git diff --check` passed.
- `git diff --check bb7e7ed...65ef971` passed.

## Independent browser and SDK boundary checks

- Production web source imports the SDK only through `@fxl-business/hub-sdk/client` in `apps/web/src/auth/token.ts` and `apps/web/src/auth/react.tsx`.
- No production web source imports the SDK package root or server entrypoint.
- The built `apps/web/dist` tree contains no `node:crypto`, `randomUUID`, or `__vite-browser-external` marker.
- An independent synchronous runtime probe confirmed rejection of API wrong audience, API wrong product key, browser wrong audience, and browser wrong product key inputs.
- Product production source contains no direct `jose` or `@fxl-hub/hub-auth` import.
- Product production source contains no local OAuth discovery path, JWKS path, authorization endpoint, token endpoint, or Hub web URL constant.
- The five real SDK BFF routes passed through the product factory at same-origin `/auth/*` paths.
- The real SDK verifier returned `401 missing_token` before the protected probe handler.
- SDK refresh sent `product.fxl-sales` as `productId` and did not send the publishable key.

## Authorization, routing, environment, and documentation review

- Runtime authorization reads `auth.entitlements.modules` for `sales.core` and `auth.roles.workspace` for privilege.
- Owner and admin map to the existing full-access legacy roles, while an ordinary member receives no legacy role elevation.
- Optional raw super-admin, product-role, and nested entitlement claims do not affect authorization.
- The authorization type members are not `any`, as proven by the compile-time type assertions and API type check.
- The BFF remains mounted with `app.route('', authBff)` before protected product routes.
- Existing protected route families retain `appAuthMiddleware`, with `requireAdmin` following it where required.
- No Hub Admin trial, grant, organization, membership invitation, entitlement reconciliation, or invitation delivery route or worker was added.
- API and web examples retain `product.fxl-sales`, `sales.core`, the exact local callback, and same-origin empty `VITE_AUTH_BFF_BASE_PATH` guidance.
- The canonical operator document covers environment registration, entitlement seeding, invitations, registrable-domain and cookie invariants, auth-origin alignment, durable session storage, reconciliation, incident checks, and explicit Sales non-ownership.
- The diff adds only fake `sk_test_*` values in tests and no production secret.

## Required repair contract

1. Remove product-owned publishable-key prefix and suffix parsing from `apps/web/src/auth/provider.ts`.
2. Make the production browser loader validate the registered key and fixed audience through a browser-safe SDK client surface.
3. Strengthen the browser oracle so it fails when the production loader stops delegating SDK audience derivation.
4. Derive `AppHubAuthContext` from the SDK's verified `HubAuthContext` fields, while preserving the explicit anti-`any` assertions.
5. Re-run the complete command matrix and independent browser artifact scan with a fresh Verify agent.
