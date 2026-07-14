# Verify report - 01-sdk-contract-baseline

## Verdict

FAIL.

Commit `3893f63f3778e2b9daba6a4553bb97a0da7e2ac0` on `feat/01-sdk-contract-baseline` does not provide the claimed type-safe verified-claims boundary against the exact published `@fxl-business/hub-sdk` 1.2.0 artifact.

## Blocking finding

The published SDK declaration surface re-exports `HubAuthContext` from `@fxl-hub/hub-auth`, but the published package does not install that package as a dependency.

Evidence:

- The resolved registry artifact is `@fxl-business/hub-sdk` 1.2.0 with integrity `sha512-/9o1+wOAXzFILE9AT8aGvObzRaeFYGpXd20gSxkpoHqeSnnqOws1a3RsO7sjw2Ow1NlcprTCjfdBMwcXAE50LQ==`.
- Its installed `dist/index.d.ts` contains `export { HubAuthContext, HubEntitlements, HubRoles, HubTokenClaims } from '@fxl-hub/hub-auth';`.
- Its published package metadata lists `@fxl-hub/hub-auth` only under `devDependencies`, not under installed dependencies or peer dependencies.
- TypeScript resolution reports `Module name '@fxl-hub/hub-auth' was not resolved` from the SDK declaration file.
- The normal API type check still exits 0 because the repository enables `skipLibCheck`.
- Compiler inspection under the normal project configuration reports TypeScript `Any` flag `1` for `AppHubAuthContext.accountId`, `workspaceId`, `entitlements`, and `roles`.
- An in-memory compiler probe assigned `{ accountId: 123, workspaceId: null, entitlements: 'not-entitlements', roles: false }` to `AppHubAuthContext` and produced zero diagnostics.

Impact:

`AppHubAuthContext = Pick<HubAuthContext, 'accountId' | 'workspaceId' | 'entitlements' | 'roles'>` is structurally present but does not enforce the SDK's verified top-level claim types.
The product's runtime reads are correct and the focused behavior tests pass, but the slice's required type-safety contract is not real against the exact installed artifact.
This blocks Gate 2 until the SDK publishes resolvable declarations or the approved contract changes to a genuinely typed public SDK surface.

## Named Gate 2 commands

The locked oracle was run exactly as written:

```text
pnpm --filter @fxl-sales/api test -- src/config/__tests__/hub-sdk-contract.test.ts src/config/__tests__/auth-provider.test.ts src/middleware/__tests__/app-auth.test.ts && pnpm --filter @fxl-sales/web test -- src/auth/__tests__/provider.test.ts
```

Result: command exited 0.
The API run reported 20 test files and 168 tests passed.
The web run reported 12 test files and 142 tests passed.
No skipped tests were reported.

The secondary run-once checks were run exactly as named:

- `pnpm --filter @fxl-sales/api type-check` exited 0.
- `pnpm --filter @fxl-sales/web type-check` exited 0.
- `pnpm --filter @fxl-sales/api lint` exited 0.
- `pnpm --filter @fxl-sales/web lint` exited 0.
- `git diff --check` exited 0.

The green normal type check does not clear the blocking finding because it suppresses declaration-file resolution failures through `skipLibCheck` and consequently treats the imported authorization fields as `any`.

## Independent acceptance audit

- Dependency and lock integrity: PASS.
  Both importers specify `^1.2.0`, both resolve `1.2.0(hono@4.12.25)`, both `pnpm list` results identify the npm registry tarball, and the registry reports the exact locked integrity.
- Audience and entitlement constants: PASS.
  API and browser adapters fail closed outside `product.fxl-sales`, and the API fixes the module to `sales.core`.
- SDK-only OAuth, discovery, JWKS, verifier, and Hub web ownership: PASS.
  Product source has no direct forbidden dependency or implementation, and production construction uses `createHubBff` and `requireHubAuth` from the installed SDK.
- SDK BFF route surface and secure-cookie boundary: PASS.
  The real SDK test exercises login, callback, refresh, switch, and logout at root-mounted `/auth/*` paths, and the product option type does not expose `secureCookies`.
- Protected route ordering: PASS.
  The BFF is mounted before API routes, protected route families apply `appAuthMiddleware` before handlers and before `requireAdmin`, and the existing finder-signup and HMAC conversion routes remain intentionally public or separately authenticated.
- Runtime optional-claim handling: PASS.
  Server authorization reads only top-level `entitlements.modules` and `roles.workspace`, and injected raw super-admin, product-role, and nested-entitlement claims do not elevate access in tests.
- Compile-time verified-claim handling: FAIL.
  The four imported SDK claim fields are `any` because the published declaration dependency is unresolved.
- Environment and registry guidance: PASS.
  Examples use the registered publishable key, exact local callback, same-origin empty browser BFF base path, and fixed-audience guidance.
- Operator documentation boundary: PASS.
  The canonical handoff covers provisioning, invitations, registrable-domain and auth-origin invariants, reconciliation, incident checks, durable production session storage, and explicit product non-ownership of Hub Admin endpoints and workers.
- Secret leakage: PASS.
  No production secret value was added, and test secret values are explicitly fake.
- Diff hygiene and scope: PASS.
  The committed diff is whitespace-clean, the worktree is clean, no prohibited em dash was added, and all 14 changed files are within the plan's declared file set.

## Required disposition

Do not merge this slice.
Repair the published SDK type surface and repeat this verification against the exact artifact selected by the plan, or revise and reapprove the slice contract before implementation.
