---
id: 11-api-test-typecheck
milestone: v4.1.0
status: done
depends_on: []
files_modified: [apps/api/tsconfig.test.json, apps/api/package.json, apps/api/test/rls/proposal-schema-migration.test.ts, apps/api/test/rls/funcoes-rls.test.ts, apps/api/test/rls/leads-rls.test.ts, apps/api/test/rls/lead-stages-rls.test.ts, apps/api/test/rls/funcoes-schema-migration.test.ts, apps/api/test/rls/leads-schema-migration.test.ts, apps/api/test/rls/cadastro-archive-audit.test.ts, apps/api/test/rls/conversion-webhook-contract.test.ts, apps/api/test/rls/audit-history-org-scope.test.ts, apps/api/test/rls/settlements-schema.test.ts, scripts/__tests__/api-test-typecheck.test.mjs]
goal: "pnpm run type-check also type-checks apps/api/test/**, and the 115 existing type errors there are fixed without weakening any test"
acceptance: ["apps/api/tsconfig.test.json (noEmit, rootDir '.', include src/**/* and test/**/*) exists and the api `type-check` script runs it in addition to the two existing projects", "`pnpm run type-check` exits 0 on the slice head", "Reintroducing any type error in a file under apps/api/test (e.g. `const n: number = 'x'`) makes `pnpm run type-check` exit non-zero (a node:test guard in scripts/__tests__/api-test-typecheck.test.mjs asserts the api type-check script names tsconfig.test.json and that tsconfig.test.json includes test/**/*)", "No test assertion is removed or loosened: no new `as any`, `@ts-ignore`, `@ts-expect-error` or `// eslint-disable` in apps/api/test; narrowing uses an explicit `expect(x).toBeDefined()` / guard or a typed helper, and non-null assertions are allowed only right after such a check", "The full integration suite still passes with the same count as master (272), and `CI=true pnpm test`, `pnpm run lint` pass"]
---

# 11 - Type-check the API test tree

## Context

Found by slice 10's executor and confirmed by the orchestrator on master `c79abed`.
`apps/api/tsconfig.json` includes only `src/**/*` and `apps/api/tsconfig.scripts.json` includes `src/**/*` and `scripts/**/*`, so nothing type-checks `apps/api/test/**`.
The api `type-check` script is `tsc --noEmit && tsc --noEmit -p tsconfig.scripts.json` (`apps/api/package.json:10`); the root runs `pnpm run build:packages && pnpm -r type-check`.
A probe config `{ "extends": "./tsconfig.json", "compilerOptions": { "noEmit": true, "rootDir": "." }, "include": ["src/**/*", "test/**/*"] }` reports 115 errors, listed in `nexo/runs/20260925T191541Z-finance-prereqs-07-10/api-test-typecheck-probe.txt` (in the run worktree):
38 `proposal-schema-migration.test.ts`, 25 `funcoes-rls.test.ts`, 12 `leads-rls.test.ts`, 11 `lead-stages-rls.test.ts`, 9 `funcoes-schema-migration.test.ts`, 7 `leads-schema-migration.test.ts`, 7 `cadastro-archive-audit.test.ts`, 2 `conversion-webhook-contract.test.ts`, 2 `audit-history-org-scope.test.ts`, 1 `settlements-schema.test.ts`.
Typical kinds: `TS18048 possibly 'undefined'` on `rows[0]`, `TS2345` postgres-js `ParameterOrFragment` from an untyped `Record<string, unknown>`, `TS1320` awaiting a non-promise thenable.

## Steps

1. Preflight: `pnpm install --frozen-lockfile --offline`, `pnpm run build:packages`, copy `apps/api/.env` from the main checkout (never commit it) and confirm `TEST_DATABASE_URL` and `TEST_MIGRATE_DATABASE_URL` point at `localhost:5006`. NEVER run `db:migrate`.
2. Red: write `scripts/__tests__/api-test-typecheck.test.mjs` (node:test, same style as the other `scripts/__tests__/*.test.mjs`, and make sure the root `pnpm test` actually runs it; check how the existing guard tests are wired) asserting the api `type-check` script references `tsconfig.test.json` and that `tsconfig.test.json` includes `test/**/*`. It fails first.
3. Add `apps/api/tsconfig.test.json` mirroring `tsconfig.scripts.json` (extends `./tsconfig.json`, `noEmit: true`, `rootDir: "."`, include `src/**/*` and `test/**/*`, keep the explanatory comment style) and append `&& tsc --noEmit -p tsconfig.test.json` to the api `type-check` script.
4. Fix every error file by file with the narrowest correct typing: type the query result rows (postgres-js generic `sql<Row[]>`), guard `rows[0]` with `expect(row).toBeDefined()` then narrow, give helper parameters real types, and fix the awaited thenable at its source. Never delete or weaken an assertion, never add `as any` / `@ts-ignore` / `@ts-expect-error`.
5. Commit per logical group (`build(api): type-check the test tree`, `test(api): fix type errors in <area> tests`).

## Oracles

- `pnpm run type-check` exit 0.
- `node --test scripts/__tests__/api-test-typecheck.test.mjs` (and via `CI=true pnpm test`).
- Mutation: add `const n: number = 'x'` to one test file, `pnpm run type-check` must fail; revert.
- `CI=true pnpm --filter @fxl-sales/api test:integration` 272/272, `CI=true pnpm test`, `pnpm run lint`.

## Scope limits

No product code changes.
No change to what any test asserts.
If an error reveals a real test bug (an assertion that could never fail), fix the test so it asserts what its name says and record it in the exec notes.
