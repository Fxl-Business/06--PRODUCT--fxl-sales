# Execute 01 - Product commission contract

## Status

PASS.

Commit: `0766d1b285c25c87c16317013964dd04d02bdaef` (`feat(products): persist seller-with-finder commission`).

## RED evidence

The contract tests were written before production changes.
The initial unit run failed 4 of 9 new assertions for the intended missing behavior.
Zod stripped the seller-with-finder pair, accepted its negative value and unsupported type, and the required migration did not exist.
All pre-existing unit tests remained green in that RED run.

The first database-backed attempt could not reach Postgres on port 5006 because the local container engine was stopped.
After the implementation, a temporary project-local Postgres container was started so the migrated-database oracle could run for real.

## GREEN implementation

- Added required `seller_with_finder_commission_type` and `seller_with_finder_commission_value` columns to the Sales Ops product schema.
- Generated Drizzle migration `0009_product_commission_scenarios` and retained the generated snapshot and journal metadata.
- Reworked only the generated SQL statements needed for a populated database: nullable add, copy from the existing seller pair, type default, then both `NOT NULL` constraints.
- Added optional request validation fields for backward-compatible clients while retaining enum and nonnegative validation.
- Made create persist explicit split values or inherit the parsed seller-only pair for legacy payloads.
- Made patch stringify only a supplied split value and preserve every omitted scenario field.
- Added real migrated-database coverage for independent create, patch, list, and legacy fixed-value inheritance behavior.

## Verification evidence

- Focused unit contract: 9 tests passed.
- Focused integration contract against migrated Postgres: 2 tests passed.
- API typecheck: passed.
- API source lint: passed.
- Integration test lint: passed.
- `git diff --check`: passed.
- Commit hook performance audit: passed.
- Worktree is clean after commit.

The temporary database container, Docker network, and OrbStack engine were stopped before completion.

## Notes

The plan's documented `pnpm db:generate -- --name ...` form is not accepted by this pnpm and Drizzle CLI combination.
Generation succeeded with `pnpm db:generate --name product_commission_scenarios`.
The plan's focused test commands also pass the path after a literal `--`, which caused Vitest to run all unit tests or report no filtered integration files.
Verification used the equivalent functional invocations without that extra separator.

## Gate 2 repair

Gate 2 found that forced RLS prevented the standard migration role from seeing populated `sales_ops_products` rows during the 0009 backfill.
A source-level migration assertion was added first to require `SELECT set_config('app.fxl_admin', 'true', true)` before the backfill and to reject a session-scoped `false` setting.
The focused test then failed 1 of 9 assertions with `adminContextIndex` equal to `-1`, confirming the intended RED.

The migration now enables the existing admin RLS policy immediately before the `UPDATE` using the transaction-local third argument `true`.
Drizzle executes journaled PostgreSQL migrations inside one transaction, so the setting covers the backfill and automatically clears at transaction end without weakening or replacing any policy.

Fresh GREEN evidence:

- Focused product commission contract: 9 tests passed.
- API lint: passed.
- API typecheck: passed.
- `git diff --check`: passed.
- Commit hook performance audit: passed.

Repair commit: `d6770cdfda0483c77763468cddaa8b5aa5d3425c` (`fix(products): backfill commission under rls`).
