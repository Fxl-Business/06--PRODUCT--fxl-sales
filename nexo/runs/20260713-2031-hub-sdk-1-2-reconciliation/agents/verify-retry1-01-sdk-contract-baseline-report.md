# Verify retry 1 - slice 01 SDK contract baseline

## Verdict

PASS

Commit `bfa39007c69f46880a24c1bde88f7c38d636d772` on `feat/01-sdk-contract-baseline` satisfies the slice acceptance contract and all dispatched Gate 2 checks.

Verification started at `2026-07-14T00:33:00Z` and completed at `2026-07-14T00:41:05Z`.

The verification was performed in `/Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales/.worktrees/01-sdk-contract-baseline` against `master...bfa3900`.

I did not read Execute reports, prior Verify output, the planner context pack, or implementer reasoning.

## Fresh command evidence

| Check | Command | Result |
| --- | --- | --- |
| Frozen dependency install | `pnpm install --frozen-lockfile` | PASS, lockfile current and all five workspace projects already up to date |
| Locked slice oracle | `pnpm --filter @fxl-sales/api test -- src/config/__tests__/hub-sdk-contract.test.ts src/config/__tests__/auth-provider.test.ts src/middleware/__tests__/app-auth.test.ts && pnpm --filter @fxl-sales/web test -- src/auth/__tests__/provider.test.ts` | PASS, API 168 tests in 20 files and web 142 tests in 12 files, with no skipped cases |
| API type check | `pnpm --filter @fxl-sales/api type-check` | PASS |
| Web type check | `pnpm --filter @fxl-sales/web type-check` | PASS |
| API lint | `pnpm --filter @fxl-sales/api lint` | PASS |
| Web lint | `pnpm --filter @fxl-sales/web lint` | PASS |
| API changed-file lint | `pnpm exec eslint` over the five changed API TypeScript files | PASS |
| Web changed-file lint | `pnpm exec eslint` over the two changed web TypeScript files | PASS |
| Compile-time anti-any oracle | `tsc --project /tmp/fxl-sales-sdk-verify-anti-any-tsconfig.json --pretty false` with a temporary config extending the real API tsconfig | PASS |
| Legacy auth regression guard | `node scripts/no-legacy-auth.mjs` | PASS |
| Dependency audit | `pnpm audit --audit-level high` | PASS, no known vulnerabilities |
| Diff whitespace hygiene | `git diff --check master...bfa3900` | PASS |
| Candidate cleanliness | `git status --porcelain=v1` | PASS, no worktree changes |

The temporary compile-time oracle and its temporary tsconfig were deleted after execution.

No run-once verification command left a process running.

## Acceptance evidence

### Published SDK and dependency integrity

Both `@fxl-sales/api` and `@fxl-sales/web` resolve direct production dependency `@fxl-business/hub-sdk` at `1.2.0` and expose no direct `@fxl-hub/hub-auth`, `jose`, `openid-client`, or `oauth4webapi` dependency.

The focused contract test proves both manifest specifiers are `^1.2.0`, both lock importers resolve `1.2.0(hono@4.12.25)`, the exact registry integrity is present, the installed package and `HUB_SDK_VERSION` both equal `1.2.0`, and no local or tarball override replaces the published artifact.

`apps/api/package.json`, `apps/web/package.json`, and `pnpm-lock.yaml` have no candidate diff because `master` already contains the required dependency contract.

### Configuration and environment contract

The API delegates environment loading and audience derivation to SDK helpers, requires a non-empty server secret, fails closed unless the audience is exactly `product.fxl-sales`, and returns fixed core module `sales.core`.

The browser delegates audience derivation to the SDK, rejects any non-Sales override, and retains empty `VITE_AUTH_BFF_BASE_PATH` behavior for same-origin `/auth/*` calls.

The API and web example environments agree on Hub API `http://localhost:9016`, the registered Sales publishable key, callback `http://localhost:8006/auth/callback`, exact audience override guidance, and the empty local BFF base path.

No real secret is present in the diff.

The only secret-shaped added value is the explicit fake test value `sk_test_not-production`, while committed environment secret fields remain empty.

### SDK composition and route guards

The real installed SDK is composed through `createHubBff` and `requireHubAuth` without mocking either function.

The route oracle proves `GET /auth/login`, `GET /auth/callback`, `POST /auth/refresh`, `POST /auth/switch`, and `POST /auth/logout` remain available at same-origin `/auth/*` paths.

The route oracle also proves the registered callback, PKCE S256 parameters, callback error redirect, no-session behavior, logout response, and refresh `productId=product.fxl-sales` contract.

The verifier seam fails a bearer-less protected request closed with SDK code `missing_token` and never reaches the product handler.

The middleware forwards only the documented SDK `fetchImpl` seam, while the BFF accepts only `fetchImpl` and `sessionStore`, so product code cannot weaken secure-cookie behavior.

Server inspection confirms the BFF is mounted with `app.route('', authBff)` before protected product routes.

All authenticated API route families apply `appAuthMiddleware` before their handlers and before `requireAdmin` where applicable, including the nested admin router.

The intentionally public finder signup, conversion webhook, health, referral, and root routes remain outside that protected set.

### Verified claims boundary

API authorization reads `auth.entitlements.modules` for `sales.core` and `auth.roles.workspace` for privilege mapping.

Workspace `owner` and `admin` map to the existing full-access legacy roles, and every other workspace role maps to no legacy role.

Runtime fixtures prove optional raw `isSuperAdmin`, `productRoles`, and nested entitlement data cannot elevate a member or satisfy the core module gate.

The independent compile-time oracle extended the real API tsconfig with its strict options.

It proved `accountId`, `workspaceId`, `entitlements`, `entitlements.modules`, `roles`, and `roles.workspace` are not `any`.

It also proved invalid numeric `accountId`, numeric `workspaceId`, numeric entitlement module, and numeric workspace role assignments are rejected because each `@ts-expect-error` directive was consumed and no unused-directive diagnostic occurred.

`AppHubAuthContext` is implemented as an explicit structural selection of the four verifier-guaranteed fields rather than a literal `Pick` alias.

I grade that representation as conforming to the dispatched anti-any and verified-field boundary because it exposes exactly the required fields, rejects invalid assignments under the repository tsconfig, and does not duplicate token parsing or verification.

Optional display claims remain outside the server authorization boundary.

### SDK ownership and scope

Tracked product source contains no direct import from `jose` or `@fxl-hub/hub-auth` and no local discovery, JWKS, OAuth endpoint, verifier, or Hub web URL implementation.

No Hub Admin trial, grant, organization, membership invitation, entitlement reconciliation, or invitation delivery route or worker was added.

The 14 changed paths are within the approved slice file map, with no database schema, persistence, browser resume, request replay, pagination, release, promotion, generated changelog, unrelated `.vscode`, or preserved doubt-file change.

The diff has no whitespace errors and adds no em dash.

### Operator handoff

The canonical deployment document records `product.fxl-sales`, `sales.core`, the local Hub registry values, exact callback requirements, separate clients for local, staging, and production, same-origin BFF routing, and secret ownership.

It assigns day-one active or trialing entitlement seeding, workspace-to-`org_id` preservation, Hub-owned membership invitations, registrable-domain and auth-origin invariants, durable production session storage, periodic reconciliation, and incident checks to operators or Hub automation.

It explicitly states that FXL Sales does not own Hub Admin trials, grants, organizations, reconciliation workers, invitation delivery, or the corresponding endpoints.

`README.md` links the canonical operator handoff, and `CLAUDE.md` records the verified entitlement and workspace-role authorization invariants.

## Final Gate 2 result

PASS with no blocking findings.
