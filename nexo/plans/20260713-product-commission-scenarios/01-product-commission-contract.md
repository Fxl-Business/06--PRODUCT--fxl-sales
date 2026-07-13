---
id: 01-product-commission-contract
milestone: null
status: done
depends_on: []
files_modified: [apps/api/src/db/schema.ts, apps/api/src/domains/sales-ops/service.ts, apps/api/src/domains/sales-ops/__tests__/product-commission-contract.test.ts, apps/api/test/rls/product-commission-contract.test.ts, apps/api/drizzle/0009_product_commission_scenarios.sql, apps/api/drizzle/meta/0009_snapshot.json, apps/api/drizzle/meta/_journal.json]
acceptance:
  - "given a product payload contains seller-only 10 percent, seller-with-finder 7 percent, and finder 3 percent, when it is created and read back, then all three values remain independent"
  - "given an existing product is migrated, when the new fields are populated, then the seller-with-finder pair is copied from the existing seller pair without changing the existing seller or finder data"
  - "given a legacy create payload omits the new seller-with-finder pair, when it is persisted, then the new pair inherits the payload's seller-only type and value"
  - "given a product patch changes one commission scenario, when it is read back, then omitted commission fields retain their previous values"
  - "given a product payload contains a negative commission value or an unsupported commission type, when it is parsed, then validation rejects it"
---

# Slice 01 - Product commission contract

## Goal

Persist a dedicated seller commission pair for sales that include a finder while preserving the existing seller-only and finder pairs.
Keep old create clients working when they do not send the new fields.
Make partial updates independent so editing one scenario cannot overwrite the other scenario.

## Scope limits

This slice changes only the Sales Ops product database contract, request validation, persistence mapping, and returned product rows.
It does not change the product editor, product table presentation, sale defaults, sale ledger snapshots, organization settings, provider commissions, recurring commission behavior, or historical sales.
It does not reinterpret `hasFinderCommission` or couple that boolean to whether either stored pair exists.
It does not apply a migration to a production database.
It does not change the separate admin products domain or the legacy `commission_rules` table.
It does not add percentage-only upper-bound validation because fixed commissions share these value fields and the current product contract only promises nonnegative values.

## Data model and migration contract

Add the following required columns to `salesOpsProducts` immediately after the existing seller-only pair.

| TypeScript field | Database column | Drizzle definition | Meaning |
| --- | --- | --- | --- |
| `sellerWithFinderCommissionType` | `seller_with_finder_commission_type` | `text`, not null, default `pct` | Seller commission type when a finder participates. |
| `sellerWithFinderCommissionValue` | `seller_with_finder_commission_value` | `numeric(10, 2)`, not null | Seller commission value when a finder participates. |

Keep `sellerCommissionType` and `sellerCommissionValue` as the seller-only pair.
Keep `finderCommissionType` and `finderCommissionValue` as the finder side of the split.
Do not rename or remove any existing column.

Generate the migration from `apps/api` with `pnpm db:generate -- --name product_commission_scenarios` after changing the Drizzle schema.
The expected generated files are `drizzle/0009_product_commission_scenarios.sql`, `drizzle/meta/0009_snapshot.json`, and the updated `drizzle/meta/_journal.json`.
Inspect the generated snapshot and journal instead of hand-editing either metadata file.

Adjust only the generated SQL needed to make the additive migration safe for populated databases.
The SQL must perform these operations in this order:

1. Add `seller_with_finder_commission_type` as nullable `text` without a default.
2. Add `seller_with_finder_commission_value` as nullable `numeric(10, 2)` without a default.
3. Update every existing `sales_ops_products` row so the new type equals `seller_commission_type` and the new value equals `seller_commission_value`.
4. Set the new type column default to `'pct'`.
5. Set both new columns to `NOT NULL` only after the backfill completes.

Backfill every row, including rows where `has_finder_commission` is false.
This preserves latent configuration and guarantees that migration does not reduce an existing seller rate.
Do not change `has_finder_commission`, either existing seller field, either finder field, or any RLS policy.
The existing table-level RLS policies automatically cover the new columns.
The numeric column intentionally has no database default, matching the existing seller and finder value columns.

## API schema and type contract

Extend `ProductSchema` with these two input fields:

```ts
sellerWithFinderCommissionType: z.enum(['pct', 'fix']).optional(),
sellerWithFinderCommissionValue: z.number().nonnegative().optional(),
```

The fields are optional at the request boundary only for backward compatibility with clients using the old create payload.
Rows returned by Drizzle, `GET /products`, and `/bootstrap` always contain both fields because the database columns are required.
As with the existing numeric commission fields, returned numeric values remain Drizzle decimal strings.
Do not add a parallel shared type in `packages/shared-types` because this domain currently derives `ProductInput` directly from `ProductSchema`.

On create, resolve omitted new fields after the existing seller defaults have been applied by Zod.
Use `data.sellerWithFinderCommissionType ?? data.sellerCommissionType` for the persisted new type.
Use `String(data.sellerWithFinderCommissionValue ?? data.sellerCommissionValue)` for the persisted new value.
Continue converting `sellerCommissionValue` and `finderCommissionValue` to strings.
This means an old payload specifying a fixed seller commission inherits that exact fixed type and value instead of receiving an unrelated hard-coded default.

On patch, preserve normal partial-update semantics.
Convert `sellerWithFinderCommissionValue` to a string only when it is supplied.
Leave the stored new value unchanged when it is omitted.
Allow the supplied new type to flow through the existing `rest` patch in the same way as the current type fields.
Do not synchronize the seller-only pair and seller-with-finder pair during updates in either direction.

The existing Sales Ops routes continue to use `ProductSchema` for `POST /products` and `ProductSchema.partial()` for `PATCH /products/:id`, so no route edit is required.
The Zod enums reject unsupported types.
The nonnegative numeric schemas reject negative seller-only, seller-with-finder, and finder values before any database call.

## RED test contract

Write all tests before changing schema, migration, or service implementation.
Run the focused unit command and confirm it fails for missing fields and missing migration behavior:

```bash
pnpm --filter @fxl-sales/api test -- src/domains/sales-ops/__tests__/product-commission-contract.test.ts
```

Create `apps/api/src/domains/sales-ops/__tests__/product-commission-contract.test.ts` with these locked tests:

- `accepts independent seller-only and seller-with-finder commission pairs`
  Parse a complete product with seller-only `pct/10`, seller-with-finder `pct/7`, and finder `pct/3`, then assert all six type/value fields survive parsing unchanged.
- `accepts a legacy create payload without seller-with-finder fields`
  Parse a valid old-shape product payload and assert parsing succeeds while the new request fields remain omitted for the create service to resolve.
- `rejects negative commission values`
  Use `it.each` over `sellerCommissionValue`, `sellerWithFinderCommissionValue`, and `finderCommissionValue`, setting each to `-0.01` and asserting `safeParse` fails.
- `rejects unsupported commission types`
  Use `it.each` over `sellerCommissionType`, `sellerWithFinderCommissionType`, and `finderCommissionType`, setting each to `rate` and asserting `safeParse` fails.
- `backfills seller-with-finder fields from the existing seller pair before enforcing NOT NULL`
  Resolve `drizzle/0009_product_commission_scenarios.sql` from the API package working directory used by the focused command, or resolve it from `import.meta.url`, and assert that it adds both columns, copies both old seller columns in one `UPDATE`, and places that update before both `SET NOT NULL` statements.
  Also assert the migration contains no `DROP COLUMN`, no update to `has_finder_commission`, and no left-hand-side assignment to any existing seller or finder column.

Then add `apps/api/test/rls/product-commission-contract.test.ts` and run it against the migrated local test database:

```bash
pnpm --filter @fxl-sales/api test:integration -- test/rls/product-commission-contract.test.ts
```

Use unique organization identifiers and clean inserted rows through an admin-context connection in `afterEach` or `afterAll`.
Close every database client opened by the test.
Add these locked integration tests:

- `persists independent commission pairs through create, partial updates, and list`
  Create `pct/10`, `pct/7`, and `pct/3` through `ProductSchema.parse` plus `createProduct`.
  Patch only `sellerCommissionValue` to `11` and prove the seller-with-finder value remains `7.00`.
  Patch only `sellerWithFinderCommissionValue` to `8` and prove the seller-only value remains `11.00` and the finder value remains `3.00`.
  Read through `listProducts` and prove both required new fields are returned with the final independent values.
- `copies the seller-only pair when a legacy create payload omits the new pair`
  Parse an old-shape payload with seller type `fix` and a distinctive nonnegative value.
  Create it through the service and prove the persisted seller-with-finder type and value equal the seller-only type and value.

The first integration RED must fail because the current database schema and returned row do not contain the new columns.
Treat the test assertions as the locked oracle after observing RED.
Only correct a test later if the harness itself is demonstrably invalid.

## GREEN implementation steps

1. Add the two fields to the Drizzle `salesOpsProducts` table definition with the exact names, precision, nullability, and type default above.
2. Generate migration `0009_product_commission_scenarios` and inspect the generated snapshot and journal.
3. Modify the generated SQL into the nullable-add, copy-backfill, default, and not-null sequence above.
4. Add the optional Zod request fields to `ProductSchema` without weakening validation on any existing field.
5. Extend `createProduct` so old payloads derive the new pair from the fully parsed seller-only pair and new payloads persist their explicit pair.
6. Extend `updateProduct` to stringify the new numeric value only when provided and to leave every omitted scenario field untouched.
7. Run the focused unit test until green.
8. Run the focused integration test until green.
9. Run type-check and diff checks before refactoring.

## Refactor on green

Keep commission string conversion readable and local to the product create and update mappings.
If a small local helper removes repeated optional numeric conversion without obscuring create fallback behavior, add it only after both focused suites are green.
Do not introduce a generic commission policy abstraction or alter unrelated Sales Ops mappings in this slice.
Re-run both focused suites after any refactor.

## Regression and security notes

All service reads and writes must retain their current `withTenant` transaction and explicit `orgId` predicates.
Never accept `orgId` from the request body.
The migration must not disable, replace, or broaden RLS.
The API rejects unsupported commission types and negative values before persistence.
Fixed values remain supported and are not capped at 100.
Legacy creates remain valid because omission inherits the parsed seller-only pair.
Legacy patches remain valid because omission does not write either new field.
Product list and bootstrap responses gain additive fields because their existing Drizzle selects return the whole row.
No historical sale row or payable is recalculated.

## Verification commands

Run each command once and do not use watch mode:

```bash
pnpm --filter @fxl-sales/api test -- src/domains/sales-ops/__tests__/product-commission-contract.test.ts
pnpm --filter @fxl-sales/api test:integration -- test/rls/product-commission-contract.test.ts
pnpm --filter @fxl-sales/api type-check
pnpm --filter @fxl-sales/api lint
git diff --check
```

The focused unit and integration tests are this slice's named oracle.
Gate 2 must be run by a separate Verify agent under the Nexo execution flow.
