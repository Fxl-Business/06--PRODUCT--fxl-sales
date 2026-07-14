# Execute repair report - 01-sdk-contract-baseline attempt 2

## Verdict

PASS.
The integrated Wave 1 production build failure was reproduced, repaired, verified, and committed on `feat/01-sdk-contract-baseline`.
The separate Nexo Verify agent still owns the objective integration verdict.

## Objective failure reproduced

The RED command was:

```text
pnpm run build
```

The command exited 1 on the current slice branch during the Vite production build.
Rollup reported that `randomUUID` was not exported by `__vite-browser-external` after the root `@fxl-business/hub-sdk` bundle reached its Node `crypto` session-store chunk.
The import graph originated in `apps/web/src/auth/provider.ts`, which imported `deriveAudience` and `HubSdkConfig` from the SDK root.

## Locked repair oracles

The SDK ownership contract was strengthened before implementation to reject root or server SDK imports from tracked web production source.
The existing browser audience test now proves SDK derivation through the browser-safe `@fxl-business/hub-sdk/client` entrypoint by building a checkout URL for `product.fxl-sales`.
A new browser config case requires rejection of a key registered for another product even when an explicit audience override is correctly set to `product.fxl-sales`.

The focused RED evidence was:

- The ownership contract failed because tracked web production source still imported `@fxl-business/hub-sdk` at the root.
- The wrong-product key test failed because the SDK root helper allowed the correct explicit audience override to mask the key's different product slug.

No existing locked test was removed or weakened.

## Repair

The browser provider no longer imports the SDK root or server entrypoint.
`BrowserHubConfig` is a local structural type containing only `apiUrl`, `publishableKey`, and optional `audience`.
The provider requires the fixed `pk_fxl-sales_` key prefix with a non-empty suffix.
The provider permits no explicit audience other than `product.fxl-sales`.
The browser client remains the only SDK runtime entrypoint used by web production code.
The SDK client continues to own browser BFF calls, audience derivation, discovery, and Hub web links.
No OAuth, JWKS, verifier, discovery, or Hub web origin implementation was copied into product code.
No dependency, manifest, lockfile, server auth code, or SDK file changed.
The API anti-any verified-claims repair remains intact.

## GREEN evidence

The fresh post-commit production build passed:

```text
pnpm run build
```

The root build completed the shared packages, API build, web type-check, and Vite production build.
Vite transformed 1,807 modules and emitted the production artifact without a Node crypto externalization warning or Rollup error.
A scan of `apps/web/dist` found no `randomUUID`, `__vite-browser-external`, or direct `crypto` import reference.

The fresh post-commit locked oracle passed:

```text
pnpm --filter @fxl-sales/api test -- src/config/__tests__/hub-sdk-contract.test.ts src/config/__tests__/auth-provider.test.ts src/middleware/__tests__/app-auth.test.ts && pnpm --filter @fxl-sales/web test -- src/auth/__tests__/provider.test.ts
API: 20 files passed, 168 tests passed.
Web: 12 files passed, 143 tests passed.
```

## Secondary verification

- `pnpm --filter @fxl-sales/api type-check` passed.
- `pnpm --filter @fxl-sales/web type-check` passed.
- `pnpm --filter @fxl-sales/api lint` passed.
- `pnpm --filter @fxl-sales/web lint` passed.
- `pnpm audit --prod --audit-level high` passed with no known vulnerabilities.
- `node scripts/no-legacy-auth.mjs` passed.
- `git diff --check` passed.
- Tracked web source contains no root or server SDK import.
- The generated browser bundle contains no Node crypto boundary.
- The final worktree status was clean.

The web test suite continues to emit existing React Router v7 future-flag warnings, but every test passes.
No dev server, watcher, test runner, or other long-running process was started or left running.

## Commit

- SHA: `65ef97132faa4e9013bcd1165043e766b9c47962`
- Subject: `fix(web): keep Hub SDK imports browser-safe`
- Previous repair commit: `bfa39007c69f46880a24c1bde88f7c38d636d772`

## Files changed

- `apps/api/src/config/__tests__/hub-sdk-contract.test.ts`
- `apps/web/src/auth/__tests__/provider.test.ts`
- `apps/web/src/auth/provider.ts`

## Concerns

The SDK root package remains unsuitable for browser bundling in published version 1.2.0 because it exports the Node-backed session store.
Future web code must continue importing only `@fxl-business/hub-sdk/client` and must keep server helpers confined to the API.
