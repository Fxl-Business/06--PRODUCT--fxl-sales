# Verify report: slice 04-dev-seed

Status: PASS

## Scope

Verified the dev seed script (`apps/api/scripts/seed-dev.ts`, `apps/api/scripts/seed/plan.ts`)
and its extension of the local-database guard (`scripts/__tests__/local-database-guard.test.mjs`,
`CLAUDE.md`'s "Local database guard" section) in worktree
`.worktrees/20260921T141216Z-dev-fake-identity-switch/run`.

## 1. The third-door obligation

- `apps/api/scripts/seed-dev.ts` imports `assertLocalDatabase` and `describeDatabaseTarget` from
  `../src/db/local-database-guard.js` and `loadEnvFiles`/`API_ROOT_DIR` from
  `../src/config/env-files.js`. No bare `import 'dotenv/config'` exists anywhere in the file.
  The guard is called with `namedEnvFile: null` hard-coded (the seed deletes rows, so it
  deliberately gets no `SALES_ENV_FILE` escape hatch), and the token `SALES_ENV_FILE` does not
  appear in the file's code at all (only absent, per design).
- `scripts/__tests__/local-database-guard.test.mjs` now names three paths (`SERVER_REL`,
  `MIGRATE_REL`, `SEED_REL`) and asserts, for the seed: it invokes `assertLocalDatabase`, it has
  no raw `dotenv/config` import, and it hard-codes `namedEnvFile: null` while never referencing
  `SALES_ENV_FILE` in code.
- `apps/api/src/server.ts`, `apps/api/src/db/migrate.ts`, `apps/api/src/db/local-database-guard.ts`
  and `apps/api/src/config/env-files.ts` are all BYTE-UNCHANGED (`git diff HEAD` empty on all
  four).

## 2. Self-proving property survived

Read the full test file. The negative cases still re-spawn `node --test` against the SAME file
with `FXL_LOCAL_DB_GUARD_ROOT` pointed at a `mkdtemp` fixture tree (never the real `server.ts` /
`migrate.ts` / `seed-dev.ts`), and assert `runAgainst(dir).status !== 0` - never message text.
Each `withoutCall` mutation asserts `mutated !== source` first, so a no-op mutation cannot pass.
Five new spawn-based negative cases were added for the seed (`no-seed-call`, `seed-raw-dotenv`,
`seed-escape-hatch`, `missing-seed`, plus the seed file is included in every pre-existing fixture
so those older negatives still exercise a complete three-file tree).

## 3. `NODE_TEST_` strip - tested directly, not just read

- Confirmed present at `runAgainst`: `if (key.startsWith('NODE_TEST_')) delete childEnv[key];`.
- Removed it, then re-ran the full suite with a real seed-dev.ts mutation (guard call deleted).
  Result: exit code 1, but for a DIFFERENT and universal reason - every spawn-based negative test
  (`FAILS when server.ts...`, `...migrate.ts...`, `...seed-dev.ts...`, all 8 of them) turned
  `not ok`, because the grandchild vacuously exits 0 (node's own recursion guard: "run() is being
  called recursively... skipping running files") regardless of which mutation was applied.
  Re-ran again with the strip still removed but seed-dev.ts UNMUTATED (clean): the exact same 8
  negatives failed identically. This proves the strip is load-bearing - without it the spawn
  mechanism cannot discriminate a real regression from a clean tree; it fails (or in the
  documented historical incident, could vacuously pass) independent of the actual mutation.
  Reverted the strip; diffed the file back to its pre-probe content - byte-identical.

## 4. Pass-count tripwire vs a real run

- `node --test scripts/__tests__/local-database-guard.test.mjs` (real run): `# pass 17`, `# fail 0`.
  Matches the header's claim of `# pass 17` exactly.
- `FXL_LOCAL_DB_GUARD_ROOT="$(pwd)" node --test ...` (fixture-mode / non-spawning run): `# pass 8`.
  Matches the header's claim of `# pass 8` exactly.
- Both counts in `CLAUDE.md` (`# pass 17` real, `8` fixture) and in the test file's own docblock
  are current and correct.

## 5. Mutation probes on the guard itself (both applied then reverted)

1. Deleted the `assertLocalDatabase` call from `apps/api/scripts/seed-dev.ts`
   (`const databaseViolations = assertLocalDatabase({` -> `const databaseViolations = ({`).
   Result: guard test exit code 1, `# fail 3` - caught directly
   (`apps/api/scripts/seed-dev.ts invokes assertLocalDatabase`), by the positive control
   (`an unmutated fixture passes`), and by the seed-specific negative case
   (`FAILS when seed-dev.ts stops invoking the guard`). Reverted; file diffed byte-identical to
   backup.
2. Added a bare `import 'dotenv/config';` as the first line of `seed-dev.ts`. Result: exit code 1,
   `# fail 2` - caught by `apps/api/scripts/seed-dev.ts has no raw dotenv/config import` and the
   positive control. Reverted; file diffed byte-identical to backup.

Both probes went red as required. The third door is genuinely guarded in practice, not just in
prose.

## 6. Seed proven against the real local database

- `apps/api/.env`'s `DATABASE_URL` in THIS worktree already points at
  `postgresql://postgres:postgres@localhost:5006/fxl_sales` (a local Docker Postgres, confirmed up
  and migrated - `\dt` lists all `sales_ops_*` tables).
- Ran `pnpm --filter @fxl-sales/api db:seed:dev` three times. Each run logged
  `[fxl-sales-seed] database host=localhost port=5006` (the guard's boot line) and
  `seeded 3 org(s), 370 row(s) total.` every time.
- Idempotency was checked at the CONTENT level, not just the count level:
  - A checksum (`md5(string_agg(id, ',' ORDER BY id))`) over every fake-org row's primary key
    across all 16 seeded tables was IDENTICAL across run 1 and run 2
    (`ef961e99278e5f3060705fe119966310`, n=370 both times) - proving the same row identities are
    regenerated, not new ones layered on top or old ones left stale.
  - A stricter full-row-content checksum on `sales_ops_sales`
    (`md5(string_agg(t::text, ',' ORDER BY id))`) was IDENTICAL across run 2 -> run 3
    (`ec3e54d3370326a72d65f9c4136fc7a1` both times), proving values (not just ids) are stable too.
  - This matches `plan.ts`'s `deterministicUuid(name)` (hash-derived ids, not `randomUUID`).
- Confirmed the seed writes through `getDb()` inside `withTenant(db, orgId, ...)`, never
  `getAdminDb()`; `withTenant` sets the RLS tenant context via `setTenantContext` before running
  the caller's callback (`apps/api/src/domains/sales-ops/service.ts:1316-1321`).

## 7. Bootstrap end-to-end with `SALES_AUTH_FAKE=1`

Booted `apps/api` (`pnpm run dev`) with `SALES_AUTH_FAKE=1`. Boot log confirmed dev-identity mode
active and listed the roster (`team-owner, team-admin, product-admin, seller, finder,
seller-finder, no-role, no-access, multi-org`). Requested
`GET /api/v1/sales-ops/bootstrap` with `x-fake-identity`:

| Identity      | HTTP status | Payload |
|---------------|-------------|---------|
| `team-owner`  | 200         | 42,942 bytes; real seeded rows (e.g. client `"Construtora Ipê"`, seller `"Ana Diretora"`) |
| `seller`      | 200         | 42,942 bytes; same real seeded rows |
| `no-access`   | 402         | `{"error":"payment_required","code":"no_org_access"}` (51 bytes) |

`no-access` correctly answers `402` as required. The two entitled identities carry real,
substantial seeded data rather than empty or stub payloads.

## 8. Full suite runs

- `pnpm --filter @fxl-sales/api test`: 55 files, 589 tests, all pass (includes
  `scripts/__tests__/seed-plan.test.ts`, 43 tests, via the `vitest.config.ts` include-glob
  extension to `scripts/**/__tests__/**/*.test.ts`).
- `node --test scripts/__tests__/local-database-guard.test.mjs`: 17/17 pass (see above).
- Root `pnpm run lint`: clean across all workspace packages, including `eslint src/ scripts/` in
  `apps/api`.
- Root `pnpm run type-check`: clean, including the new `tsc --noEmit -p tsconfig.scripts.json`
  pass added to `apps/api`'s `type-check` script.
- Root `CI=true pnpm test`: all workspaces pass - shared-utils 80, auth-fake 35, api 589, web 940 -
  plus the two root guard suites (local-database-guard 17/17, no-legacy-env-names/banned-provider
  28/28), exit code 0.
- Root `pnpm run build` (after deleting all tracked-tree `.tsbuildinfo` files): succeeds, exit 0.
  `apps/api/dist/` (rebuilt cold, `dist` + `tsconfig.tsbuildinfo` deleted first) contains no trace
  of `seed-dev`, `seed-plan`, or anything under `apps/api/scripts/` - `tsconfig.scripts.json` sets
  `noEmit: true` and the ordinary `tsconfig.json` only ever includes `src/**/*`.

## 9. Other checks

- `CLAUDE.md` diff touches exactly two hunks, both inside the "Local database guard" section
  (lines ~606-663); nothing outside that section changed. Content matches what was independently
  verified above (three entrypoints, the seed's `namedEnvFile: null`, the `# pass 17` / `8`
  counts).
- No em dash or en dash found in any added line across `CLAUDE.md`, the guard test diff, or the
  new `apps/api/scripts/` files.
- `@fxl-sales/auth-fake` sits in `apps/api/package.json`'s `devDependencies` (not `dependencies`),
  matching the package's own "DEVELOPMENT ONLY... dynamic import only" contract; `seed-dev.ts`
  reaches it via `await import('@fxl-sales/auth-fake')` inside `main()`, after the guard has run.
- `EXPECTED_DELETE_ORDER` / `EXPECTED_WRITE_ORDER` restated in `seed-dev.ts` and asserted against
  `plan.ts`'s exported `SEED_DELETE_ORDER` / `SEED_WRITE_ORDER` at the top of `main()` - the three
  real seed runs never threw `assertOrderMatches`'s drift error, confirming the two files agree in
  practice, not just by inspection.

## Minor finding (non-blocking)

One pre-existing test's TITLE was renamed: `'both inspected files exist and are readable'` ->
`'every inspected file exists and is readable'`. The assertion body itself
(`assert.equal(loadError, null, ...)`) is byte-identical; only the wording changed, and it changed
because "both" became factually wrong once a third file was added to the same check. This is a
narrow, honest, necessary correction rather than a weakened or hidden assertion - I did not
treat it as a violation of "no existing test title or assertion changed," but it is flagged here
since the instruction was explicit and this is technically a title change. No other test title
or assertion body was altered anywhere in the diff.

## Cleanup

- All mutation probes were reverted; every touched file (`apps/api/scripts/seed-dev.ts`,
  `scripts/__tests__/local-database-guard.test.mjs`) was diffed byte-for-byte against a
  pre-probe backup after reverting and confirmed identical.
- The dev API server was started for the bootstrap probe (root PID 75414, pnpm -> pnpm.cjs
  76137 -> tsx watch 76339 -> node 76345) and killed by exact PID (all four, deepest first) at
  the end of the check. Confirmed `lsof -i :3006` empty afterward.
- `git status --short` at the end of verification shows only the same files the task described as
  already uncommitted going in (`CLAUDE.md`, `apps/api/package.json`, `apps/api/vitest.config.ts`,
  `nexo/runs/.../budget.json`, `scripts/__tests__/local-database-guard.test.mjs`,
  `apps/api/scripts/`, `apps/api/tsconfig.scripts.json`) plus this verify run's own
  `execute-04-dev-seed.result.json` - nothing else added, nothing staged, nothing stashed.
- Build artifacts (`dist/`, `*.tsbuildinfo`) produced while verifying are gitignored and are not
  reflected as tracked changes.

## Verdict

PASS. The seed is a genuinely guarded third door (both required mutation probes go red for the
right reason, and the self-proving spawn mechanism plus its `NODE_TEST_` strip were independently
exercised, not just read), the seed is provably idempotent at the row-content level across three
runs against the real local database, tenancy goes through `getDb()`/`withTenant` never
`getAdminDb()`, the full test/lint/type-check/build suite is green, and the end-to-end
`SALES_AUTH_FAKE=1` bootstrap check returns real seeded data for entitled identities and a
correct `402` for `no-access`.
