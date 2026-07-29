# Verify: 01-areas-backend

Slice: 01-areas-backend (feature 20260729-propostas-areas).
Branch under test: feat/01-areas-backend, commit 9bda9a9 "feat(api): add configurable sales ops areas".
Verdict: PASS.

## Setup

Ran in an isolated worktree.
The target branch `feat/01-areas-backend` was already checked out in a sibling worktree (agent-a4cd0a6f078701c4f), so a plain `git switch` was refused by the harness.
Worked around this by checking out the same commit in detached-HEAD mode (`git switch --detach feat/01-areas-backend`, resolving to commit `9bda9a9`), which is equivalent for read/verify purposes and does not touch the other worktree.
Ran `pnpm install --prefer-offline` (node_modules was missing); install succeeded cleanly.

## 1. Change surface

`git log --oneline master..HEAD`: one commit, `9bda9a9 feat(api): add configurable sales ops areas`.

`git diff master...HEAD --stat`: 11 files changed, all under `apps/api` (schema, one new drizzle migration + its meta snapshot/journal entry, service, routes, and four test files, one of them new).
No web files, no unrelated files.
Matches the plan's `files_modified` list in `nexo/plans/20260729-propostas-areas/01-areas-backend.md` exactly.

## 2. Diff review

- Migration `apps/api/drizzle/0010_sales_ops_areas.sql`: creates `sales_ops_areas` (uuid PK, `org_id text not null`, `name`, `status default 'active'`, timestamps), adds nullable `sales_ops_products.area_id` with an FK to the new table, a unique `(org_id, name)` index, then enables and forces RLS with the same two-policy pattern (`..._tenant_isolation` keyed on `current_setting('app.current_org_id', true)`, `..._admin_context` keyed on `current_setting('app.fxl_admin', true)`) used by every other `sales_ops_*` table in `drizzle/0007_marvelous_valeria_richards.sql` and `drizzle/0000_fancy_klaw.sql`.
  The seed block sets `app.fxl_admin` local-to-transaction before the `INSERT ... SELECT ... CROSS JOIN (VALUES (six area names))` and uses `ON CONFLICT ("org_id","name") DO NOTHING`, matching the existing seed idiom from `drizzle/0009_product_commission_scenarios.sql`.
  All six FXL areas are present verbatim: FXL Tech, FXL Visual, FXL Advisor, FXL BPO Sales, FXL Influência Estratégica, FXL Treinamentos.
  No `CREATE ROLE`/`ALTER ROLE`/cluster-role statements (would violate the single-role migration constraint recorded in `nexo/runs/20260707-1243-single-role-migrations/run.md`).
- Schema (`apps/api/src/db/schema.ts`): `salesOpsAreas` table definition and `salesOpsProducts.areaId` column mirror the migration exactly.
- Service (`apps/api/src/domains/sales-ops/service.ts`): `listAreas`, `getArea`, `createArea`, `updateArea` all wrap `withTenant(db, orgId, ...)` and additionally filter every query by `eq(salesOpsAreas.orgId, orgId)` (belt-and-suspenders on top of RLS, consistent with every sibling function in the file). `createArea`/`updateArea` pre-check name collisions per-org before insert/update and return a `'duplicate'` sentinel; the unique index is the backstop for the residual race. `getSalesOpsSnapshot` now also returns `areas` scoped by `orgId`. No query in the diff is missing an org filter.
- Routes (`apps/api/src/domains/sales-ops/routes.ts`): `GET/POST/PATCH /areas` added; `POST /products` and `PATCH /products/:id` (when the patch carries `areaId`) now call `getArea(getDb(), c.get('orgId'), areaId)` and reject with 400 `unknown_area` if it does not resolve — this is the cross-tenant guard for the FK, since a raw FK reference can be satisfied by any org's row and does not go through RLS in a meaningful way for INSERT validation. Area routes deliberately have no `requireAdmin`, matching the pre-existing `/products` and `/clients` routes; this is an explicit "locked decision" in the plan (`01-areas-backend.md` line 235), not an oversight.
- `ProductSchema.areaId` is a bare `z.string().uuid()` (required, non-optional, non-nullable) on the base schema; `ProductSchema.partial()` (used for PATCH) makes it optional there only, per plan.
- Test additions read as designed: `areas-contract.test.ts` (zod contract + migration source assertions), `routes.test.ts` (area CRUD route unit tests + product areaId binding tests, all through mocked service), `product-commission-contract.test.ts` (updated to carry a required `areaId`), and `apps/api/test/rls/areas-rls.test.ts` + `apps/api/test/rls/product-commission-contract.test.ts` (real-Postgres RLS/tenancy proof).

No secrets in the diff.
No string-built raw SQL with unsanitized input — the one `.unsafe()` usage in the new `areas-rls.test.ts` interpolates only a locally generated `randomUUID()`-derived role name and password, not any external/user input.

## 3 & 4. Lint, type-check, unit tests

```
pnpm run lint        -> apps/api lint: Done, apps/web lint: Done (no errors)
pnpm run type-check  -> all 4 workspace projects: Done (no errors)
pnpm test            -> exit 0
  apps/api test: Test Files 21 passed (21), Tests 187 passed (187)
  apps/web test: Test Files 14 passed (14), Tests 84 passed (84)
  packages/shared-utils test: 1 passed (17 tests)
  no-legacy-auth.mjs guard: passed (script completed, exit 0)
```

## 5. Full integration suite

First pass, no `TEST_DATABASE_URL`/`.env` configured in this isolated worktree (none is checked in; `.env` is gitignored and this fresh worktree had none):

```
pnpm --filter @fxl-sales/api test:integration
Test Files  4 failed | 5 passed (9)
     Tests  20 passed | 12 skipped (32)
```

The 4 failing suites were `cross-tenant.test.ts`, `conversions-commissions-rls.test.ts`, `referral-links-public-lookup.test.ts`, `list-finder-links-cross-tenant.test.ts`, all failing identically with `Error: RLS tests must run as a non-superuser, non-BYPASSRLS role; got postgres`.
Per the brief, this is treated as a suspect regression until proven otherwise, so it was not accepted at face value.

Root-cause investigation:

- Queried the local Postgres cluster directly (`docker exec ... psql -c "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles"`): the only login role in the cluster is `postgres`, and it is a real superuser (`rolsuper=t`, `rolbypassrls=t`). No project-specific non-superuser role exists in this cluster/volume.
- These four test files, plus the new `areas-rls.test.ts`, all resolve their connection URL as `TEST_DATABASE_URL ?? DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5006/fxl_sales'`, and the four older ones guard with a `beforeAll` that throws if the resolved role is a superuser/bypasses RLS. With no `.env`/env vars set in this fresh worktree, they all connect as `postgres` and fail that guard.
- To rule out this slice as the cause, checked out `master` alone (detached at `c3d98df`) in the same worktree, same Postgres instance, and ran the exact same command with the exact same (absence of) env configuration: **master fails the identical 4 suites with the identical error** (`Test Files 4 failed | 4 passed (8)`, `Tests 15 passed | 12 skipped (27)`). This proves the failure is a pre-existing environment/role-provisioning gap in this isolated worktree (no non-superuser DB role provisioned, consistent with `test/rls/global-setup.ts`'s comment "Cluster roles are provisioned outside application migrations"), not something introduced by the slice's diff or by the new `areas-rls.test.ts` file (which had not even run yet in the master-only pass).
- To get a real, meaningful signal (the acceptance criterion explicitly requires "RLS isolation proven by integration tests"), provisioned a scoped non-superuser role in the local dev Postgres for the duration of this verification only (`fxl_sales_verify_role`, `NOSUPERUSER NOBYPASSRLS`, granted `SELECT/INSERT/UPDATE/DELETE` on `public` + `drizzle` schemas, `CREATE` on the database/schemas so the migration global-setup could run), set `TEST_DATABASE_URL` to that role and `ADMIN_DATABASE_URL` to the real `postgres` superuser (for the admin-context cleanup connections and, in the new test, `CREATE ROLE`/`DROP ROLE` privileges), and reran:

```
# master (detached c3d98df), same DB, real non-superuser role:
Test Files  8 passed (8)
     Tests  27 passed (27)

# feat/01-areas-backend (detached 9bda9a9), same DB, same role:
Test Files  9 passed (9)
     Tests  32 passed (32)
```

This exactly matches the stated baseline (8 files / 27 tests / 0 failures on master) and shows the branch adds exactly one new file (`test/rls/areas-rls.test.ts`, 5 tests) with zero regressions to any of the other 8 files, including `cross-tenant.test.ts`, `conversions-commissions-rls.test.ts`, and `referral-links-public-lookup.test.ts` named in the brief.
The new role-creation/drop logic inside `areas-rls.test.ts`'s last test (`CREATE ROLE rls_probe_<uuid> ... ; DROP OWNED BY ...; DROP ROLE ...`) does not leak or corrupt shared session/cluster state: it uses a `randomUUID()`-suffixed role name, is wrapped in try/finally so cleanup always runs, and does not touch the `postgres` role or any other test's connections.
The verification-only `fxl_sales_verify_role` role and its grants were fully reverted (`REVOKE`, `DROP OWNED BY`, `DROP ROLE`) after the runs above; the cluster was left in its original state (only `postgres` + built-in `pg_*` roles).

## 6. Security lens

- No secrets committed (migration and tests use only local placeholder/random values).
- No cross-tenant leaks: every new service function double-guards with `withTenant` (RLS session context) plus an explicit `eq(..., orgId)` filter; the new `getArea` used for the product FK cross-tenant guard correctly returns `null` for another org's area id (verified in both the mocked route test and the raw-Postgres RLS test).
- No SQL injection: the migration is static SQL with no interpolated values; the one raw `.unsafe()` call in the new RLS test only interpolates a `randomUUID()`-derived local test identifier, never external input.

## Conclusion

Every required command is green: lint, type-check, `pnpm test`, and (with the environment's missing non-superuser DB role provisioned for the duration of the check) the full `test:integration` suite, 9/9 files and 32/32 tests, with master reproducing the documented 8/27 baseline under the identical setup.
The diff is scoped to API + drizzle + tests as expected, RLS policy shape matches the established pattern, the six-area seed and admin-context ordering are correct, and tenancy is enforced end-to-end (service double-guard, raw-role RLS probe, and the new cross-tenant `unknown_area` guard on product create/patch).
The four suites that appeared to fail on first run are a pre-existing local-environment gap (no non-superuser Postgres role/`TEST_DATABASE_URL` provisioned in this fresh isolated worktree), reproduced identically on bare `master`, not a regression introduced by this slice.

Verdict: **PASS**.
