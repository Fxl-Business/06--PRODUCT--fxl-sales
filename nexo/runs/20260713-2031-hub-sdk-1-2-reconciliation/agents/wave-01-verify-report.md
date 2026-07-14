# Wave 01 integration verification

- Agent: `verify`
- Slice: `wave-01`
- Branch: `master`
- Baseline: `bb7e7ed`
- Verified commit: `2d492b197a571dfd42dbf1dc98ce36ee4909211e`
- Started: `2026-07-14T00:41:00Z`
- Completed: `2026-07-14T00:49:47Z`
- Verdict: **FAIL**

## Blocking failure

`pnpm run build` exited 1 during the production web build.
Vite externalized Node's `crypto` module for browser compatibility, then Rollup failed because `randomUUID` is not exported by `__vite-browser-external`.
The failing import is in installed `@fxl-business/hub-sdk@1.2.0`, `dist/chunk-HAL5KACO.js`, where the browser bundle reaches `import { randomUUID } from "crypto"`.
This prevents a production web artifact from being built and fails Gate 2.

## Command results

| Check | Result | Evidence |
| --- | --- | --- |
| `CI=true pnpm test` | PASS | Exit 0; 33 files and 327 tests passed: shared-utils 17, API 168, web 142. Root `scripts/no-legacy-auth.mjs` also completed. |
| `pnpm run lint` | PASS | Exit 0 for all workspace packages. |
| `pnpm run type-check` | PASS | Exit 0 for all workspace packages. |
| `pnpm run build` | **FAIL** | Exit 1 in `@fxl-sales/web` Vite/Rollup build because the SDK chunk imports Node `crypto.randomUUID`. |
| `pnpm audit --prod --audit-level=high` | PASS | Exit 0; no known vulnerabilities found. |
| `git diff --check bb7e7ed..2d492b1` | PASS | Exit 0 with no whitespace errors. |
| `pnpm --filter @fxl-sales/api test:integration` | PASS | Exit 0; 8 files and 27 local Postgres integration tests passed. |
| `pnpm install --frozen-lockfile --offline --ignore-scripts` | PASS | Exit 0; lockfile up to date and dependencies already installed. |
| `pnpm store status` | PASS | Exit 0; packages in the store are untouched. |
| `pnpm run perf:audit` | PASS | Exit 0; repository script is a declared stub with no rules wired. |

## Contract and security review

- The anti-`any` verified-claims oracle is present in `apps/api/src/middleware/__tests__/app-auth.test.ts` with six `IsAny` compile-time assertions covering account id, workspace id, entitlements, modules, roles, and workspace role.
- The same oracle includes negative `@ts-expect-error` shape checks, and the full type-check passed.
- The SDK contract test passed all four tests, including installed version `1.2.0`, exact lockfile integrity, dependency ownership, BFF mounting order, and operator handoff assertions.
- API and web both resolve `@fxl-business/hub-sdk` to `1.2.0`.
- No dependency manifest or lockfile changed between `bb7e7ed` and `2d492b1`.
- A targeted production-source scan found zero direct imports of `jose`, `openid-client`, `oauth4webapi`, or `@fxl-hub/hub-auth`, zero product-owned OAuth discovery or JWKS paths, and zero direct endpoint or Hub-web URL assignments.
- The added `.env` example values contain a public publishable key, blank secrets, and explicit placeholders only.
- A targeted added-line secret scan found zero live/prod secret keys, cloud access keys, private keys, or non-placeholder secret assignments.
- Both baseline and current commit contain zero skipped, todo, or disabled tests.
- Tracked test files increased from 40 at baseline to 41 at the verified commit, with no deleted test file in the diff.

## Worktree hygiene

`master` remained at exact commit `2d492b197a571dfd42dbf1dc98ce36ee4909211e` throughout verification.
No product file was modified by this verifier.
The existing modified `nexo/state.json`, known unrelated `.vscode/settings.json`, known unrelated `nexo/knowledge/doubts/20260707-missing-entitlement.md`, and active Nexo plan/run artifacts were left untouched and excluded from the hygiene verdict.
All commands were run once, and all spawned test/build processes exited before report creation.

## Verdict

**FAIL** because the production web build cannot complete with the current SDK browser import graph.
