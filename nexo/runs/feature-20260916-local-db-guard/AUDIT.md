# Autopilot audit - run feature-20260916-local-db-guard

Flow: feature, autopilot. Trunk `master`. Gate 1 skipped by autopilot; Gate 2 enforced per slice
and per wave; Gate 3 not reached - this run stops at `master`.

## Recorded at Plan-check, before any code was written

### `apps/api/drizzle.config.ts` is a fifth, UNCOVERED door

- [ ] DECIDE: whether `db:studio` should be guarded too.

`apps/api/drizzle.config.ts` carries its own `import 'dotenv/config'` and reads
`process.env.DATABASE_URL` raw, with a `localhost:5006` fallback. `pnpm --filter @fxl-sales/api
db:studio` therefore reaches a database WITHOUT passing through `env.ts` or `migrate.ts`, which are
the only two entrypoints this feature guards.

It is deliberately out of scope for this run rather than forgotten: `db:studio` is read-mostly,
there is no `make` target for it, and the human's brief names exactly two entrypoints. It is
recorded here because slice 04's structural guard does not pin it either, so a future `db:push`
script would inherit an unguarded path with a green suite over it.

The remedy, if you want it, is one more call site plus one more assertion in
`scripts/__tests__/local-database-guard.test.mjs`. It is not a code change this run may make,
because the guard's "invoked ONLY from entrypoints, and exactly two of them" rule is a human
decision recorded in `00-OVERVIEW.md`.

### `SALES_ENV_FILE` exported in a developer's shell would reach the unit suite

Closed inside slice 01 rather than parked: `apps/api/test/unit-setup.ts` now blanks
`SALES_ENV_FILE` alongside the six Hub credential names it already blanks, so the unit suite is
decided by its own fixtures and never by the operator's shell. Recorded here because it is a file
the human's brief did not name.

## Blockers and parks during execution

(none yet)
