# Exec notes - 11-api-test-typecheck

Branch `feat/20260925-11-api-test-typecheck`, based on master `c79abed`, head `1efea98`.

## Commits

- `a157088` test(api): drop unused imports and accept a transaction client in settlement tests
- `2ba71a2` test(api): narrow first rows through a typed firstRow helper
- `1efea98` build(api): type-check the test tree

Fixes land before the build change, so every commit on the branch keeps `pnpm run type-check` green.

## What changed

- `apps/api/tsconfig.test.json`: extends `./tsconfig.json`, `noEmit: true`, `rootDir: "."`, include `src/**/*` and `test/**/*`, with the same explanatory comment style as `tsconfig.scripts.json`.
- `apps/api/package.json` `type-check`: `tsc --noEmit && tsc --noEmit -p tsconfig.scripts.json && tsc --noEmit -p tsconfig.test.json`.
- `scripts/__tests__/api-test-typecheck.test.mjs` (3 node:test cases): config exists, extends, noEmit, rootDir and includes both globs; the api script keeps all three `tsc` steps; the root `type-check` still recurses into packages.
- Root `package.json` `test`: the guard is appended to the explicit `node --test` file list (outside files_modified; needed because the root script lists files explicitly and does not glob).
- `apps/api/test/rls/first-row.ts` (new, outside files_modified): `firstRow<T>(rows, what): T` throws `expected a row for <what>, but there was none` when empty. Chosen over repeated `expect(x).toBeDefined(); x!` so no non-null assertion was needed anywhere; it only turns an existing anonymous TypeError into a named failure.
- 115 errors fixed (the plan listed 10 files; `leads-no-financial-impact.test.ts` also had 1 `[{ count }]` error and is outside files_modified):
  - `TS18048` / `TS2532` / `TS2339` on `rows[0]` and `const [x] = await ...`: rewritten to `firstRow(...)`; one `created[1]` in `lead-stages-rls` uses the file's existing `if (!x) throw` idiom.
  - `audit-history-org-scope`: `SeedRow.after` was `Record<string, unknown> | null` (no seed row is null) and was bound bare into `::jsonb`; now `Record<string, string | number>` bound via `adminClient.json(row.after)`, the typed form of the same postgres-js JSON serialization (precedent: `tx.json` in `produtos-servicos-schema-migration`). This also cleared the `TS1320` awaited thenable, which was a knock-on of the failed generic inference. Comment updated to match.
  - `settlements-schema`: `insertSettlement(client: Sql | postgres.TransactionSql, ...)`, because it is called with a `begin()` transaction client.
  - `conversion-webhook-contract`: removed unused `drizzle` and `schema` imports.
- No assertion removed or changed: 10 `expect` lines were rewritten, only in how the row is reached, with the same matchers. The diff adds no `as any`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable` or non-null assertion.
- No real test bug found (no assertion that could never fail).

## Verification (run-once, in the worktree)

- Red: the guard failed 2/3 before `tsconfig.test.json` and the script change existed.
- `pnpm run type-check`: exit 0 (api runs all three projects).
- Mutation: appended `const n: number = 'x'` to `test/rls/leads-rls.test.ts`; `pnpm run type-check` exit 2 with `TS2322` at that line; reverted, exit 0 again.
- `pnpm run lint`: exit 0.
- `CI=true pnpm test`: exit 0; shared-utils 155, auth-fake 35, api 678, web 998, node:test 58/58 (guard's 3 included).
- `CI=true pnpm --filter @fxl-sales/api test:integration`: 35 files, 272/272 passed (same as master).
- `apps/api/.env` copied from the main checkout for the preflight (TEST_* on localhost:5006). It is gitignored and not committed. `db:migrate` was never run.
- No process left running.

## Finding outside this slice (not fixed, needs an owner)

The root `test` script lists `scripts/__tests__/dev-identity-docs-reconciliation.test.mjs`, but that file has never existed in git (no add or delete in history; it was named in commit `9fc5838` and the dev-fake feature's slice 07 result claims it was written).
`node --test` with a missing path among existing ones silently skips it and exits 0 (a missing path alone exits 1), so the guard `nexo/knowledge/reference/development-identity-mode.md:59` describes is vacuously green.
It was left alone because writing it means re-deriving that feature's D1-D4 oracle spec, which is outside this slice's scope. It should be filed as its own slice, preferably together with making the root `node --test` list fail on a missing file.
