# Execute report - 01-sdk-contract-baseline retry 1

## Verdict

PASS.
The slice was implemented on `feat/01-sdk-contract-baseline` in the isolated worktree and committed atomically.
The separate Nexo Verify agent still owns Gate 2 and must independently verify the commit before integration.

## Commit

- SHA: `3893f63f3778e2b9daba6a4553bb97a0da7e2ac0`
- Subject: `feat(auth): lock Hub SDK 1.2 contract`
- Branch: `feat/01-sdk-contract-baseline`

## RED evidence

The dependency and ownership oracle was created before production implementation.
Its valid focused RED run used `pnpm --filter @fxl-sales/api exec vitest run src/config/__tests__/hub-sdk-contract.test.ts`.
The result was 3 passing tests and 1 expected failure because `docs/deployment/hub-sdk-integration.md` did not exist.

The fixed config and claims oracle was run before production implementation with the plan's literal API command.
It failed for the expected reasons: the API adapter had no `sdk` config shape, accepted `product.other`, read optional nested raw claims, lacked the injectable middleware factory, and could not build the registered BFF from the injected environment.

The browser oracle was also run directly before implementation.
It failed because `VITE_FXL_HUB_AUDIENCE=product.other` was accepted.

The real SDK route and verifier cases were locked before production implementation.
They failed because `createAppAuthMiddleware` did not exist and `createAppAuthBff` did not yet accept the environment and documented SDK seams.

The plan's literal `test -- <files>` form caused Vitest to run the entire package suites because the package scripts already contain `vitest run`.
On the clean worktree, the first RED run additionally exposed the existing requirement to build ignored `@fxl-sales/shared-utils` output before the API suite can resolve that workspace package.
The package's declared one-shot build was run, and no generated output was staged or committed.

## GREEN evidence

The post-commit locked command passed:

```text
pnpm --filter @fxl-sales/api test -- src/config/__tests__/hub-sdk-contract.test.ts src/config/__tests__/auth-provider.test.ts src/middleware/__tests__/app-auth.test.ts && pnpm --filter @fxl-sales/web test -- src/auth/__tests__/provider.test.ts
API: 20 files passed, 168 tests passed.
Web: 12 files passed, 142 tests passed.
```

The focused contract itself covers 29 assertions across three API files and one web file with no skipped cases.
It proves the published SDK version and integrity, SDK-only OAuth and verifier ownership, fixed audience and module constants, verified top-level authorization fields, all five BFF routes, the missing-token verifier path, and `product.fxl-sales` refresh requests.

## Secondary verification

- `pnpm --filter @fxl-sales/shared-utils build` passed as the clean-worktree prerequisite.
- `pnpm --filter @fxl-sales/api type-check` passed.
- `pnpm --filter @fxl-sales/web type-check` passed.
- `pnpm --filter @fxl-sales/api lint` passed.
- `pnpm --filter @fxl-sales/web lint` passed.
- `git diff --check` passed before and after the commit.
- `pnpm audit --prod --audit-level high` passed with no known vulnerabilities.
- `node scripts/no-legacy-auth.mjs` passed.
- Direct source scans found no product import of `jose` or `@fxl-hub/hub-auth`, no product-owned discovery or JWKS constants, no forbidden Hub Admin route, and no committed production secret.
- `pnpm why` resolved `@fxl-business/hub-sdk` to published version `1.2.0` in both product importers.
- The final worktree status was clean.

Prettier is not installed in this repository, so an optional `pnpm exec prettier --check` probe could not run.
This was not a plan-required check, and both declared project linters passed.

## Implementation summary

The API config wrapper now delegates environment loading and audience derivation to the SDK, requires a confidential secret, and fixes `product.fxl-sales` plus `sales.core` as product constants.
The browser config wrapper now delegates audience derivation to the SDK and fails closed on any different override.
The API authorization adapter now consumes only verified top-level `entitlements.modules` and `roles.workspace` fields.
Only verified workspace owners and admins map to the existing full-access legacy guard roles.
The BFF and verifier factories accept only the documented SDK fetch and session-store seams while production defaults remain source-compatible.
The canonical operator handoff documents environment registration, entitlement seeding, Hub-owned invitations, domain and auth-origin invariants, preserved workspace tenancy, reconciliation, durable production storage, and explicit non-ownership.

## Files committed

- `CLAUDE.md`
- `README.md`
- `apps/api/.env.dev.example`
- `apps/api/.env.example`
- `apps/api/src/config/__tests__/auth-provider.test.ts`
- `apps/api/src/config/__tests__/hub-sdk-contract.test.ts`
- `apps/api/src/config/auth-provider.ts`
- `apps/api/src/middleware/__tests__/app-auth.test.ts`
- `apps/api/src/middleware/app-auth.ts`
- `apps/web/.env.dev.example`
- `apps/web/.env.example`
- `apps/web/src/auth/__tests__/provider.test.ts`
- `apps/web/src/auth/provider.ts`
- `docs/deployment/hub-sdk-integration.md`

The existing package manifests and lockfile already matched the exact published SDK contract, so they required no changes.

## Concerns and handoff

The literal package test command currently runs all tests rather than only the listed files because of the extra `--` after `vitest run`.
Fresh worktrees must build `@fxl-sales/shared-utils` before the full API suite and API type-check can resolve its declared `dist` entry.
The web suite emits existing React Router v7 future-flag warnings, but all tests pass.
No dev server, watcher, test runner, or other long-running process was started or left running.
