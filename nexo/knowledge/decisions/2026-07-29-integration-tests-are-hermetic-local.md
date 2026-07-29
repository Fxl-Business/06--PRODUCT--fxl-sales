# Integration Tests Always Run Against the Local Docker Database

## Context

`apps/api/.env` sets `DATABASE_URL` to the staging Postgres instance (`postgresql://fxl_sales_stg_user:...@fxl-db-server:5432/fxl_sales_stg_db`), because that is the variable the dev API server needs to talk to staging data during local development.
`apps/api/test/rls/setup-env.ts` only set `TEST_DATABASE_URL` and `DATABASE_URL` with `??=` (assign only if unset), and `apps/api/test/rls/global-setup.ts` migrated whatever `DATABASE_URL` resolved to.
With a checked-out `.env` present (the normal local state for any developer or agent working in this repo), the integration suite silently:
- Ran every RLS/integration test against the staging database over the network, taking roughly 146 seconds instead of a local, in-process run.
- Applied Drizzle migrations to staging as a side effect of running tests, with no explicit signal that this was happening.

This was discovered while preparing the 20260729-propostas-areas wave plan, and fixed alongside it on `fix/hermetic-integration-tests` (commit `6a6a3cb`, merged `3e3d8dc`) because every subsequent slice's Gate 2 verification depends on the integration suite being trustworthy and fast.

## Decision

Integration tests always run against the local Docker database, never against whatever `DATABASE_URL` happens to resolve to in the environment.

- `TEST_DATABASE_URL` connects as a dedicated, non-superuser Postgres role, `fxl_sales_test`, so Row Level Security is genuinely enforced in tests (a superuser or `BYPASSRLS` role silently bypasses `FORCE ROW LEVEL SECURITY`, which would let a tenant-isolation bug pass a test that looks like it proves isolation).
- `TEST_MIGRATE_DATABASE_URL` and `ADMIN_DATABASE_URL` point at the same local Docker Postgres instance, connecting as the `postgres` superuser, used only for schema migration and admin-context test setup/teardown (seeding rows across orgs, creating/dropping scoped probe roles).
- `apps/api/test/rls/setup-env.ts` hard-overrides `process.env.DATABASE_URL` (a plain assignment, not `??=`) to the resolved local test URL, so the API code under test can never fall back to whatever `.env` sets for the dev server.
- `apps/api/test/rls/global-setup.ts` resolves its migration target as `TEST_MIGRATE_DATABASE_URL ?? TEST_DATABASE_URL ?? DATABASE_URL ?? <local fallback>`, so migrations always land on the local test database before any RLS test connects.
- These four `TEST_*`/`ADMIN_*` variables are pinned directly in `apps/api/.env` (not `.env.dev.example`) at:
  ```
  TEST_DATABASE_URL=postgresql://fxl_sales_test:fxl_sales_test@localhost:5006/fxl_sales
  TEST_MIGRATE_DATABASE_URL=postgresql://postgres:postgres@localhost:5006/fxl_sales
  ADMIN_DATABASE_URL=postgresql://postgres:postgres@localhost:5006/fxl_sales
  ```

## Why

The staging leak was silent and easy to reintroduce: nothing failed, nothing warned, the suite just quietly took much longer and touched a shared environment.
A test suite that can mutate staging as a side effect of `pnpm test` is not safe to run casually or in parallel worktrees (multiple agents/developers running integration tests at once would race on the same staging schema and data).
Hermetic-by-construction (hard override, not a convention to remember) means the failure mode changes from "silently correct until it silently is not" to "loudly local, always".

## How to provision the `fxl_sales_test` role

Cluster roles are provisioned outside application migrations (see `nexo/plans/20260707-single-role-migrations.md` and `nexo/runs/20260707-1243-single-role-migrations/run.md`: journaled Drizzle migrations must never contain `CREATE ROLE`/`ALTER ROLE`/`GRANT ... TO <role>` statements, because those do not apply cleanly across environments with different existing roles).
Provision the role once per local Postgres instance by connecting as the `postgres` superuser and running:

```sql
CREATE ROLE fxl_sales_test LOGIN PASSWORD 'fxl_sales_test' NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO fxl_sales_test;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fxl_sales_test;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fxl_sales_test;
```

`NOSUPERUSER NOBYPASSRLS` is load-bearing: it is what makes `FORCE ROW LEVEL SECURITY` actually apply to this role's connections, which is the entire point of running the RLS suite as this role instead of as `postgres`.
`ALTER DEFAULT PRIVILEGES` covers tables created by later migrations without a manual re-grant every time a new `sales_ops_*` table is added.
This role and its grants live only in the local Docker Postgres volume; they are never part of a checked-in migration and never provisioned against staging or production.

## Consequences

- Any new local Postgres volume (fresh `docker-compose up`, a wiped volume, a new machine) needs this role created once before `pnpm --filter @fxl-sales/api test:integration` can pass; a missing role reproduces as every RLS-guarded test file failing with `RLS tests must run as a non-superuser, non-BYPASSRLS role; got postgres`.
- `apps/api/.env.dev.example` still does not set `TEST_*`/`ADMIN_DATABASE_URL`, so a fresh `.env` copied from the example needs these three lines added manually; a roadmap item tracks making the example env hermetic by default instead of requiring a manual pin (see `nexo/ROADMAP.md`).
- Any future slice that adds a new `sales_ops_*` table is covered automatically by the `ALTER DEFAULT PRIVILEGES` grant; no per-table re-grant step is needed.
