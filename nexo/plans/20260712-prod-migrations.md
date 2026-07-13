# fix(deploy): apply database migrations before API startup

## Symptom

Production deploys the API successfully, but `GET /api/v1/sales-ops/bootstrap` returns PostgreSQL `42P01` because `sales_ops_sales` does not exist.
The browser shows repeated failed bootstrap activity while the API remains unavailable.

## Why

The API runtime image contains compiled application files but not the Drizzle migration directory.
Its startup command launches the server without running the checked-in migrations.

## Acceptance

Given the production API image is built, when its runtime contents and command are inspected, then the Drizzle migration files are present and migrations run successfully before the server starts.
Given migration execution fails, when the container starts, then the API server does not start against an outdated schema.
Given the Sales Ops migration is checked in, when a fresh production-equivalent database starts the image, then `sales_ops_sales` exists before the bootstrap endpoint is served.

## Scope

Change only the API container migration-before-start contract and its regression test.
Do not change the Sales Ops schema, existing generated migration metadata, query retry defaults, or error UI.

## Test Contract

RED: a deployment contract test fails because the runtime image neither copies `apps/api/drizzle` nor runs the compiled migration runner before `dist/server.js`.
GREEN: the same test passes after the runtime image includes migrations and uses fail-fast migration-before-server startup.
E2E: build and start the production image against a fresh Postgres database, then assert the Sales Ops table exists and the API health endpoint responds.
