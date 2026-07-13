# Verify 01 - Product commission contract recheck

Verdict: **PASS**

Verified branch `feat/01-product-commission-contract` at repair commit `d6770cdfda0483c77763468cddaa8b5aa5d3425c` against base `a723f363f9d83feb4b27114e42bd544576eec21f`.
The worktree was clean before and after verification.

## Repair verification

The repair diff from `0766d1b` to `d6770cd` changes only the migration and its source-level oracle.
Migration `0009_product_commission_scenarios.sql:3` now calls `set_config('app.fxl_admin', 'true', true)` immediately before the populated-row backfill.
The third argument is `true`, so the RLS admin context is transaction-local and clears at transaction end instead of leaking into the pooled session.
The installed Drizzle Postgres migrator wraps all pending migration statements in `session.transaction`, and executes each statement through that transaction at `drizzle-orm/pg-core/dialect.js:60-71`.
The admin setting therefore remains active for the following `UPDATE` and is cleared when the migration transaction commits or rolls back.
The focused source-level oracle requires the exact transaction-local call, requires it before `UPDATE`, and rejects the session-scoped `false` form.
Neither the repair diff nor the full branch diff changes, disables, drops, creates, or broadens any RLS policy.

## Command evidence

- Unit oracle: PASS.
  `pnpm --filter @fxl-sales/api test -- src/domains/sales-ops/__tests__/product-commission-contract.test.ts` exited 0.
  Vitest ran 19 files and 162 tests, including all 9 focused product commission assertions.
- Database integration oracle: NOT RUN because local dependencies remained unavailable.
  Docker could not connect to the OrbStack socket, `127.0.0.1:5006` was closed, and the worktree contained no API database environment file.
  This is the conditional integration limitation requested by the verification contract, not a product failure.
- API typecheck: PASS.
  `pnpm --filter @fxl-sales/api type-check` exited 0.
- API lint: PASS.
  `pnpm --filter @fxl-sales/api lint` exited 0.
- Diff whitespace check: PASS.
  `git diff --check a723f36..HEAD` exited 0.
- Focused secret and security scan: PASS.
  Added non-snapshot lines contained no private keys, credential assignments, dynamic execution, or RLS policy weakening.
  The only URL credential match was the expected local test fallback `postgres:postgres@localhost:5006`.

## Acceptance review

- Additive populated migration: both columns are added nullable, the transaction-local admin context is enabled, every existing row copies both seller-only values, the type default is set, and both columns become required only after backfill.
- Existing values: the migration does not assign, rename, or drop `has_finder_commission`, seller-only fields, or finder fields.
- Independent values: create persists explicit seller-only, seller-with-finder, and finder pairs; partial update maps only supplied values; list returns the full required row.
- Legacy creates: omitted seller-with-finder fields inherit the parsed seller-only type and value.
- Legacy patches: omitted commission fields are not added to the update patch.
- Input validation: Zod enums reject unsupported types, nonnegative schemas reject negative values, and all focused validation assertions passed.
- Tenant isolation: product operations retain `withTenant`, explicit `orgId` predicates for list and update, and a server-owned `orgId` on create.
  Existing forced RLS policies remain unchanged, and the migration-only admin context is confined to the migration transaction.

Gate 2 passes for the available local verification tier.
