# Execute repair report - 01-sdk-contract-baseline attempt 1

## Verdict

PASS.
The Gate 2 type-safety failure was repaired and committed on `feat/01-sdk-contract-baseline`.
The separate Nexo Verify agent still owns the objective Gate 2 verdict before integration.

## Objective failure reproduced

The published `@fxl-business/hub-sdk` 1.2.0 declaration re-exports `HubAuthContext` from `@fxl-hub/hub-auth`.
The published package does not install that declaration dependency, and local resolution confirmed `@fxl-hub/hub-auth` is unresolved.
The repository enables `skipLibCheck`, so the normal API type-check hid the declaration failure and the imported `Pick` fields accepted invalid values.

## RED evidence

The compile-time oracle was added to the existing locked middleware test before production code changed.
The oracle checks `accountId`, `workspaceId`, `entitlements`, `entitlements.modules`, `roles`, and `roles.workspace` with an `IsAny` constraint.
The oracle also uses `@ts-expect-error` assignments to require rejection of a numeric account id, null workspace id, invalid entitlement value, and boolean roles value.

The RED command was:

```text
pnpm --filter @fxl-sales/api type-check
```

The command exited 2 against the old imported `Pick` boundary.
TypeScript reported four `TS2578` unused `@ts-expect-error` directives because all four invalid assignments were accepted.
This reproduced the Verify agent's finding under the repository tsconfig without weakening any existing test.

## Repair

The unresolved `HubAuthContext` type import was removed from product code.
`AppHubAuthContext` is now a local minimal structural boundary containing only `accountId: string`, `workspaceId: string`, `entitlements.modules: string[]`, and `roles.workspace: string`.
The type describes only the top-level verified fields that `requireHubAuth` sets and FXL Sales reads for authorization.
Optional decoded display claims remain outside the type and cannot become authorization guarantees.
Runtime signature, issuer, audience, algorithm, expiry, discovery, and JWKS verification remain entirely owned by the published SDK.
No SDK file, dependency manifest, lockfile, verifier implementation, or OAuth behavior changed.
`@fxl-hub/hub-auth` was not added as a dependency or imported by product production code.

## GREEN evidence

The same API type-check exited 0 after the local structural boundary was introduced.
The `@ts-expect-error` directives are now consumed because the four invalid assignments produce the expected compiler errors.
The explicit anti-any constraints also compile only while every authorization field remains concrete.

The fresh post-commit locked oracle passed:

```text
pnpm --filter @fxl-sales/api test -- src/config/__tests__/hub-sdk-contract.test.ts src/config/__tests__/auth-provider.test.ts src/middleware/__tests__/app-auth.test.ts && pnpm --filter @fxl-sales/web test -- src/auth/__tests__/provider.test.ts
API: 20 files passed, 168 tests passed.
Web: 12 files passed, 142 tests passed.
```

No existing locked test was weakened, removed, or edited to accept broader behavior.

## Secondary verification

- `pnpm --filter @fxl-sales/api type-check` passed.
- `pnpm --filter @fxl-sales/web type-check` passed.
- `pnpm --filter @fxl-sales/api lint` passed.
- `pnpm --filter @fxl-sales/web lint` passed.
- `pnpm audit --prod --audit-level high` passed with no known vulnerabilities.
- `node scripts/no-legacy-auth.mjs` passed.
- `git diff --check` passed.
- Product production source still contains no direct `jose` or `@fxl-hub/hub-auth` import.
- The repair changed only the declared middleware adapter and its existing locked test file.
- The final worktree status was clean.

The web test suite continues to emit existing React Router v7 future-flag warnings, but every test passes.
No dev server, watcher, test runner, or other long-running process was started or left running.

## Commit

- SHA: `bfa39007c69f46880a24c1bde88f7c38d636d772`
- Subject: `fix(auth): enforce verified claim types`
- Parent slice commit: `3893f63f3778e2b9daba6a4553bb97a0da7e2ac0`

## Files changed

- `apps/api/src/middleware/app-auth.ts`
- `apps/api/src/middleware/__tests__/app-auth.test.ts`

## Concerns

The published SDK declaration defect remains upstream, but FXL Sales no longer depends on that unresolved declaration for its authorization boundary.
The local structural type must stay limited to fields guaranteed at runtime by SDK 1.2.0 and must not grow optional raw claims into server authorization inputs.
