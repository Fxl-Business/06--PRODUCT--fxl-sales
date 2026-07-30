# Verify report - slice 07 `produtos-servicos-api`

Branch: `feat/07-produtos-servicos-api`, one commit `5859b80` on top of `master` (`0b14521`).
Verdict: **PASS**.

Machine gate run adversarially, without access to the implementer's plan or reasoning.
Every claim below was established by running something, not by reading code alone.

---

## 1. Gates

All five run from the repo root on the branch as committed.

| Gate | Command | Exit |
| --- | --- | --- |
| lint | `pnpm run lint` | 0 |
| type-check | `pnpm run type-check` | 0 |
| unit | `CI=true pnpm test` | 0 |
| integration | `pnpm --filter @fxl-sales/api test:integration` | 0 |
| build | `pnpm run build` | 0 |

Totals, against the stated branch-point baseline:

| Suite | Baseline | Branch | Delta |
| --- | --- | --- | --- |
| apps/web unit | 30 files / 210 tests | 30 / 210 | unchanged |
| apps/api unit | 24 / 248 | 27 / 283 | +3 files, +35 tests |
| apps/api integration | 16 / 73 | 18 / 88 | +2 files, +15 tests |
| packages/shared-utils | 1 / 17 | 1 / 17 | unchanged |

Nothing was removed; every total either rose or stayed flat.
All five gates were re-run a second time after every probe and mutation had been reverted, and all
five were still 0 with the same totals.

`pnpm --filter @fxl-sales/api db:generate` reports **`No schema changes, nothing to migrate`** - no
drift between `apps/api/src/db/schema.ts` and migration `0013`. It emitted no new file and
`git status` was unchanged afterwards.

Safety: `db:migrate` was never run. `apps/api/test/rls/setup-env.ts` still hard-overrides
`process.env.DATABASE_URL = appUrl` (assignment, not `??=`), and `apps/api/.env` resolves
`TEST_DATABASE_URL` to `fxl_sales_test@localhost:5006` while `DATABASE_URL` points at staging. The
override is intact, so the suite cannot reach staging. Every migration in this review was applied
only through the integration `globalSetup`, which reads `TEST_MIGRATE_DATABASE_URL`.

## 2. Migration 0013 replays from scratch

I rolled the local Docker test DB (`06--product--fxl-sales-db-1`, port 5006) genuinely back to a
pre-0013 state inside one transaction: dropped the six new `sales_ops_products` CHECKs, dropped
`sales_ops_product_funcao_costs`, dropped the six new default-config columns, renamed `kind` back to
`type` with default `'SaaS'`, and deleted the `0013` journal row
(`drizzle.__drizzle_migrations WHERE created_at = 1785379099310`).

Before undoing anything I seeded two genuinely legacy-shaped rows, one of them the hard case: an
`open_price = true` row still carrying `setup_brl = 250000, monthly_brl = 9900`. That row is the
ordering oracle - it makes the `ADD CONSTRAINT ... CHECK` fail if the CHECKs are emitted above the
backfill.

Then I let the integration `globalSetup` replay. It applied cleanly and the six migration tests
passed. Post-replay catalog compared to the pre-rollback catalog: **byte-identical** except the
`drizzle.__drizzle_migrations` surrogate id (16 -> 17, an expected sequence bump) and my two probe
rows.

What the catalog showed after the replay:

- Composite FK present: `sales_ops_product_funcao_costs_org_funcao_fk`
  `FOREIGN KEY (org_id, funcao_id) REFERENCES sales_ops_funcoes(org_id, id) ON DELETE RESTRICT`.
- Cascade FK present on `product_id` (name truncated by Postgres to 63 chars,
  `..._product_id_sales_ops_products_id`; a `NOTICE 42622`, harmless).
- Indexes: `..._product_funcao_idx` UNIQUE on `(product_id, funcao_id)`,
  `..._org_product_idx` on `(org_id, product_id)`, plus the pkey.
- All seven CHECKs: `sales_ops_product_funcao_costs_mode_check` plus the six on
  `sales_ops_products` (`kind`, `kind_open_price`, `service_no_fixed_value`,
  `default_entrada_mode`, `default_installments`, `default_recurring_cycles`).
- RLS: `relrowsecurity = t` **and** `relforcerowsecurity = t` on the new table.
- Policies: `..._tenant_isolation` and `..._admin_context`, both `ALL` / `PERMISSIVE`, each with both
  `USING` and `WITH CHECK`, mirroring `0010_sales_ops_areas.sql`.
- New columns with the right types: `default_entrada_pct numeric(5,2)`, `default_entrada_brl integer`,
  `default_payment_method text NOT NULL DEFAULT 'pix'`, `default_entrada_mode text NOT NULL DEFAULT 'none'`,
  `default_remaining_installments integer NOT NULL DEFAULT 1`, `default_recurring_cycles integer DEFAULT 12`,
  `kind text NOT NULL DEFAULT 'product'`.

**Statement ordering: valid.** Two independent reasons.
First, the replay succeeded with the contradictory legacy row present, which is only possible because
the three post-backfill CHECKs sit below the two backfill `UPDATE`s. Second, the composite FK
references `sales_ops_funcoes(org_id, id)`, whose arbiter
`sales_ops_funcoes_org_id_id_idx` is created in `0012_sales_ops_funcoes.sql:23` - an earlier
migration - so the FK can never precede its unique index. The sibling-slice bug is not present here.

The backfill did the right thing on real rows: the `open_price` row became `kind = 'service'` with
`setup_brl` and `monthly_brl` zeroed, and the fixed-price row became `kind = 'product'` with
`250000 / 9900` intact.

`drizzle-orm@0.45.2`'s `pg-core/dialect.js:60` wraps the whole pending-migration run in one
`session.transaction(...)`, so the migration's transaction-local
`set_config('app.fxl_admin', 'true', true)` genuinely covers both backfill `UPDATE`s even if the
migrating role is a non-superuser subject to `FORCE ROW LEVEL SECURITY`. That is the correct choice
and it is what makes the backfill safe on staging, where the migrating role may not bypass RLS.

Both probe rows were deleted afterwards; the DB is back to 0 products / 0 cost rows.

## 3. The `kind` / `openPrice` reconciliation

**`type` is genuinely renamed, not duplicated.**
`information_schema.columns` for `sales_ops_products` returns exactly one of
`('type','kind','product_type')`, and it is `kind`. No second classification axis survives; the
`Tipo` concept is gone and classification is Área plus the pricing flags, per `CLAUDE.md`.

**`product_type_snapshot` lineage preserved.** The column still exists on
`sales_ops_sale_items` with its name and meaning; `resolveSaleItemContexts` now feeds it from
`product.kind`, so new rows snapshot `'product'` / `'service'` where they used to snapshot `'SaaS'`.
Verified live: a two-item sale wrote `['Consultoria','service']` and `['Licença','product']`.

**`openPrice` is a DB-enforced projection.** I attempted eight contradictory raw writes as the
`postgres` superuser, bypassing the service entirely. Every one was rejected:

| Attempt | Rejected by |
| --- | --- |
| `kind='service', open_price=false` | `sales_ops_products_kind_open_price_check` |
| `kind='product', open_price=true` | `sales_ops_products_kind_open_price_check` |
| service + `setup_brl=1000` | `sales_ops_products_service_no_fixed_value_check` |
| `kind='SaaS'` | `sales_ops_products_kind_check` |
| `kind='servico'` | `sales_ops_products_kind_check` |
| `default_entrada_pct=50` on mode `'none'` | `sales_ops_products_default_entrada_mode_check` |
| `default_remaining_installments` = 121 and = 0 | `sales_ops_products_default_installments_check` |
| `default_recurring_cycles=121` | `sales_ops_products_default_recurring_cycles_check` |

Drift between `kind` and `open_price` is structurally impossible. Rows were unchanged afterwards.

**The deprecated `openPrice` wire alias works - proven end-to-end over real HTTP.**
This is the one that would break `master`, so I did not settle for the service-layer test. I mounted
the real `salesOpsRouter` (unmocked service) against the local test DB and sent the byte-exact body
that `master`'s `ProductDialog.submit()` builds at `apps/web/src/sales-ops/SalesOpsApp.tsx:2801`:
`{ name, areaId, codeSuffix, openPrice, setupBrl, hasMonthly, monthlyBrl, recurringCommission,
sellerCommissionType, sellerCommissionValue, sellerWithFinderCommissionType,
sellerWithFinderCommissionValue, finderCommissionType, finderCommissionValue, modules, providers,
status }` - note it sends no `kind` and no `type`.

Results:

- `POST /products` with `openPrice: true` -> **201**, `kind: 'service'`, `openPrice: true`,
  `setupBrl: 0`, `monthlyBrl: 0`, `providers` round-tripped intact.
- `PATCH /products/:id` with the same body and `openPrice: false` -> **200**, `kind: 'product'`,
  `openPrice: false`, `setupBrl: 250000`.
- The response still nests under the `product` key, which is exactly what
  `apps/web/src/sales-ops/api.ts:77` types as `{ product: SalesOpsProduct }`. The extra
  `productFuncaoCosts` key is additive and ignored by `master`.
- `GET /products` still returns the `products` key `master` reads; `productFuncaoCosts` is additive.
- A body that additionally smuggles `type: 'SaaS'`, `orgId: 'smuggled-org'`, a forged `id` and a
  forged `createdAt` -> **201** with `orgId` = the verified claim and a server-generated `id`. Zod's
  default object stripping discards all four. So `master` is not broken, and the alias also tolerates
  the `type` key older builds may still send.

`master` also relies on the dialog forcing `setupBrl`/`monthlyBrl` to zero whenever `openPrice` is on
(`SalesOpsApp.tsx:2807` and `:2809`). It does, so the alias can never collide with
`service_cannot_have_fixed_value` from the real dialog.

## 4. Tenancy

Every new or modified query, and whether the explicit `orgId` filter is present:

| # | Query | Filter |
| --- | --- | --- |
| 1 | `selectFuncoesByIds` select | `and(eq(salesOpsFuncoes.orgId, orgId), inArray(...))` - present |
| 2 | `resolveProductRefs` área select | `and(eq(salesOpsAreas.orgId, orgId), eq(salesOpsAreas.id, ...))` - present |
| 3 | `selectProductFuncaoCosts` select | `eq(...orgId, orgId)` (+ optional `productId`) - present |
| 4 | `replaceProductFuncaoCosts` delete | `and(eq(...orgId, orgId), eq(...productId, productId))` - present |
| 5 | `replaceProductFuncaoCosts` insert | `orgId` set server-side from the claim, never from the body |
| 6 | `createProduct` insert | `orgId` set server-side from the claim |
| 7 | `updateProduct` current select | `and(eq(...orgId, orgId), eq(...id, id))` - present |
| 8 | `updateProduct` update where | `and(eq(...orgId, orgId), eq(...id, id))` - present |
| 9 | `getSalesOpsSnapshot` cost rows | via #3 - present |
| 10 | `listProducts` | `eq(...orgId, orgId)` - present (unchanged) |
| 11 | `resolveSaleItemContexts` products select | filter unchanged; only the selected column changed |

No endpoint reads `orgId`, `userId`, `accountId` or `workspaceId` from a request body.
`PRODUCT_PLAIN_COLUMNS` is an explicit allow-list rather than a `...data` spread, which is what makes
that structural rather than incidental - and I proved it by smuggling `orgId`, `id` and `createdAt`
into a real POST body (section 3) and watching all three be discarded. `routes.test.ts` additionally
asserts `resolveProductRefs` and `createProduct` are always called with `'verified-org'`.

### Mutation testing

I used the technique the task prescribes - drive the service over an `app.fxl_admin` connection where
the admin policy exposes every org, so RLS cannot silently satisfy a tenancy assertion.

**Mutation A - the cost-row select (#3).** Replaced the scope with
`productId ? eq(productId) : sql\`true\`` (org filter gone entirely).
Result: **1 failed | 8 passed**. The only failure was
`keeps cost rows out of another org even over an admin connection`
(`expected [ {…}, {…}, {…} ] to deeply equal []`). All eight app-role tests stayed green.
**The implementer's claim is verified exactly as reported.** Without that admin-connection test this
deletion would have shipped invisible.

**Mutation B - `selectFuncoesByIds` (#1).** Removed `eq(salesOpsFuncoes.orgId, orgId)`.
Result: Red - but in `funcoes-rls.test.ts`
(`scopes every funções and pessoas read by orgId even when RLS is not doing the scoping`), the
sibling slice's admin-connection test, because slice 07 refactored `resolvePersonFuncoes` onto this
shared helper. The filter is covered by a test; the test just lives in another file.
Worth noting for the record: slice 07's own `rejects a funcao id owned by another org` stayed green
under this mutation, because it runs over the app-role connection where RLS hides org B's função.
That is a coverage observation, not a defect - the filter is genuinely guarded.

**Mutation C - `updateProduct`'s UPDATE `where` (#8) alone.** All 9 green.
**Mutation D - `updateProduct`'s current select (#7) alone.** All 9 green.
**Mutation E - both #7 and #8.** Red:
`keeps cost rows out of another org even over an admin connection`,
`expected { product: {…}, …(1) } to be null`.

C and D are **equivalent mutants**, and I am saying so explicitly. The two filters are deliberately
redundant: the `current` select's filter short-circuits to `null` before the UPDATE runs, and the
UPDATE's filter matches zero rows if the select's filter is the one removed. Either alone still
blocks the cross-tenant write and still returns `null`. Removing both is caught. The only residual
difference under mutation D is a 400-vs-404 discrimination oracle, and it is unreachable in
production: the product routes use `getDb()` (app role, `FORCE RLS`, no `app.fxl_admin`), where the
foreign row is invisible and `current` is `undefined` regardless. No endpoint passes `getAdminDb()`
to these functions.

### Composite FK is load-bearing

I downgraded it in the database to a single-column FK
(`FOREIGN KEY (funcao_id) REFERENCES sales_ops_funcoes(id) ON DELETE RESTRICT`) and re-ran.
Result: **1 failed | 8 passed** - `rejects a funcao id owned by another org` went Red with
`promise resolved "[]" instead of rejecting`. The cross-org cost row became storable exactly as
predicted, and a test caught it. The composite FK was restored and re-verified from `pg_constraint`.

### Cross-org `funcaoId`

Over real HTTP: `POST /products` with a `funcaoId` owned by another org returns
**`400 {"error":"validation_error","reason":"unknown_funcao","funcaoId":"..."}"`**, and
`listProductFuncaoCosts` for the calling org is `[]` afterwards - nothing partially written. The
composite FK is the in-transaction backstop for the residual window, and I confirmed that window is
not reachable through the API anyway: `routes.ts:209` documents that there is deliberately no DELETE
verb for funções (removal is `PATCH { status: 'archived' }`), so a função cannot vanish between the
pre-check and the write.

## 5. The full-replace cost set

All exercised against the real DB.

- **Shorter list removes rows.** A two-row set replaced by a one-row set leaves exactly one row.
- **Empty list clears.** `{ productFuncaoCosts: [] }` -> `[]`, confirmed both in the returned payload
  and by a fresh `listProductFuncaoCosts`.
- **Omitted key leaves the set untouched.** A rename-only PATCH kept both rows.
- **Partial failure cannot half-replace.** `withTenant` is `db.transaction(...)`
  (`service.ts:903-908`), so the `DELETE` and the `INSERT` share one transaction. I forced the
  failure inside the replace by calling `updateProduct` directly with a cross-org `funcaoId`,
  bypassing `resolveProductRefs` the way a buggy future caller would. The composite FK fired on the
  `INSERT`, after the `DELETE` had already run. The whole transaction rolled back and the
  **original two-row set was intact**, values included (`pct 5.00` and `fix 30000`). No half-replaced
  state.
- **Concurrent writes cannot interleave.** 40 parallel `updateProduct` calls on the same product,
  alternating between two disjoint two-função sets. Result: **0 errors**, every returned payload was a
  whole set (never a mix of the two), and the final stored set was one whole set. The mechanism is
  that `updateProduct` always writes the product row (`kind`, `openPrice`, `updatedAt` are
  unconditional), so the product row's write lock serializes the cost replace; each waiting
  transaction's subsequent `DELETE` statement then gets a fresh READ COMMITTED snapshot that sees the
  predecessor's inserted rows. No `23505` on `..._product_funcao_idx` was observed in 40 attempts.

## 6. Error paths and 500s

Every new constraint, and how the write path keeps it from escaping:

| Constraint | Guard | Escapes as 500? |
| --- | --- | --- |
| `..._kind_check` | Zod `z.enum(['product','service'])` | no - unreachable |
| `..._kind_open_price_check` | server derives `openPrice = kind === 'service'` | no - unreachable |
| `..._service_no_fixed_value_check` | Zod refine on create; merged-row sentinel on PATCH | no |
| `..._default_entrada_mode_check` | Zod refine on create; merged-row sentinel on PATCH | no |
| `..._default_installments_check` | Zod `int().min(1).max(120)` | no - unreachable |
| `..._default_recurring_cycles_check` | Zod `int().min(1).max(120).nullable()` | no - unreachable |
| `..._mode_check` (cost rows) | `z.discriminatedUnion('mode', ...)` | no - unreachable |
| `..._product_funcao_idx` UNIQUE | `duplicate_funcao_cost` refine + product-row lock serialization | no - 0/40 under load |
| `..._org_funcao_fk` (23503) | `resolveProductRefs` pre-check + no DELETE verb for funções | no |

Observed over real HTTP:

- `PATCH { setupBrl: 250000 }` on a Serviço -> `400 {"error":"validation_error","reason":"service_cannot_have_fixed_value"}`.
- `POST` a Serviço with a non-zero own value -> `400` with
  `service_cannot_have_fixed_value` in `issues.fieldErrors.setupBrl`.
- `PATCH { defaultEntradaPct: 50 }` against a stored mode of `'none'` ->
  `400 {"error":"validation_error","reason":"entrada_mode_value_mismatch"}`.

No `ON CONFLICT` clause is added anywhere in the diff (`git diff | grep -i onConflict` is empty), so
the "one arbiter where the table has several unique indexes" sibling defect cannot be present.

### The additive extension `INVALID_PRODUCT_ENTRADA_VALUE`

**The reasoning is correct and the fix is real.** I confirmed independently that the DB CHECK does
fire on exactly that write: a raw `UPDATE sales_ops_products SET default_entrada_pct = 50` against a
row whose `default_entrada_mode` is `'none'` is rejected by
`sales_ops_products_default_entrada_mode_check` (23514). `productNumericPatch` writes
`defaultEntradaPct` while leaving `defaultEntradaMode` alone, and neither the route nor the service
has a try/catch or an `onError` handler (there is no app-level `onError` anywhere in
`apps/api/src`), so without the sentinel it would have surfaced as an unhandled 500. With it, the
route returns a clean `400 entrada_mode_value_mismatch`.

**It is genuinely additive.** It introduces a new exported sentinel and a new `reason` string for a
field that did not exist before this slice. No pre-existing `reason` code changed value or meaning:
`unknown_area`, `unknown_funcao` and `service_cannot_have_fixed_value` are untouched, and the
`{ error, issues }` validation shape is unchanged. Slices 08/10/12 cannot be affected by a response
case that could not previously occur. Judged **acceptable**.

### One 500 found, and it pre-dates this branch

30 parallel `POST /products` with the same `codeSuffix` returned **`{"500":29,"201":1}`** - the
`23505` on the pre-existing unique index `sales_ops_products_org_code_suffix_idx` escapes unhandled
as `500 Internal Server Error`.

Because this would flip the verdict, I proved whether it is pre-existing rather than reasoning about
it. I created a throwaway database `fxl_verify07_master`, added a `git worktree` at `master`, pointed
that worktree's `.env` exclusively at the throwaway DB, migrated it through `master`'s own
`globalSetup`, and ran the same probe against `master`'s unmodified code:

```
MASTER sequential: 201 500   parallel: {"500":20}
```

`master` behaves identically - a duplicate `codeSuffix` is a 500 sequentially, and 20/20 under
parallel load. The code paths are the same: `master`'s `createProduct` is a bare
`tx.insert(salesOpsProducts).values({...data, orgId, ...}).returning()` with no `onConflict`, no
try/catch, and `master`'s `POST /products` route has no error handling either. The unique index
predates `0013`. This is therefore a **pre-existing defect not introduced or aggravated by slice 07**,
and not a reason to fail this slice. It should be tracked separately (the codebase's own convention
for this is the `'duplicate'` sentinel that `createArea` and `createFuncao` already use).

The worktree was removed, the throwaway database dropped, and `git worktree list` shows only the
main checkout.

## 7. Anti-gaming

`git diff master..feat/07-produtos-servicos-api -- '*test*'` reviewed in full.

- Zero `it.only`, `describe.only`, `.skip`, `it.todo`, `xit(`, `xdescribe` added.
- Zero `it(`/`describe(` blocks removed (`grep -cE "^-\s*(it|describe)\("` returns 0).
- `apps/api/vitest.config.ts`, `apps/web/vitest.config.ts`, root `package.json` and
  `apps/api/package.json` are all untouched, so no include/exclude or threshold was loosened.

The four touched pre-existing test files change only mechanically, and each change is a tightening or
a neutral adaptation:

- `areas-contract.test.ts`: `ProductSchema.partial()` -> `UpdateProductSchema`. Forced, because
  `ProductSchema` is now `.superRefine`-wrapped (a `ZodEffects`, which has no `.partial()`). The
  assertion is identical and `UpdateProductSchema` carries strictly more validation than a bare
  `.partial()` did.
- `routes.test.ts`: adapts to the new `{ product, productFuncaoCosts }` return shape and swaps the
  `getArea` mock for `resolveProductRefs`. Net **+3 new tests** (cross-org função, the `openPrice`
  alias, and the kind/alias contradiction) and a **new** assertion that the full response body equals
  the expected payload.
- `product-commission-contract.test.ts` and `proposal-write.test.ts`: destructure `{ product }` out
  of the new return type and narrow the sentinel union with an explicit `throw` on the unexpected
  branch. All original `expect` assertions survive verbatim.

Nothing weakened.

## 8. Scope discipline

Against the `### Scope limits (YAGNI)` section of
`nexo/plans/batch-01K9C0FXA7RQ8VZTN3KDM6WS4E/00-OVERVIEW.md`:

- **`apps/web/**` byte-untouched.** `git diff --stat master..HEAD -- apps/web/` is empty.
- **Affiliate `sellers` / `finders` tables and routes untouched.** No added line in
  `apps/api/src/domains/` references them.
- **No change to the propostas status machine, payables/receivables materialization, or the
  `"N/M"` / `"MN/M"` conventions.** The only edit inside the sale path is
  `resolveSaleItemContexts` swapping `salesOpsProducts.type` for `salesOpsProducts.kind` in one
  `select` and one return field. `transitionSale`, `cancelContract`, the payable/receivable
  generators and the label builders are all unchanged in the diff.
- **No new DELETE verb.** No `.delete(` route was added; `routes.ts:209` still documents the
  archive-instead-of-delete convention.
- **`providers` deprecated but neither dropped nor backfilled.** The column keeps its
  `notNull().default('[]'::jsonb)` definition and only gains a `@deprecated` JSDoc tag; migration
  `0013` contains no statement touching it, and a migration test plus a live round-trip both confirm
  the jsonb survives the backfill byte for byte. The commit body explains why backfilling would be
  wrong (free-text `personName` with no deterministic mapping to a `funcaoId`).
- Hub auth model, tenancy mechanism, `AppRole` visibility and the legacy route trees are all outside
  the diff.

## 9. The three self-reported items

### 9a. The data audit

**Recorded, and yes, real data would be altered.**

The audit `SELECT` is written out verbatim in
`nexo/runs/batch-01K9C0FXA7RQ8VZTN3KDM6WS4E/run.md` under a `SAFETY` heading, alongside an explicit
warning that the 0-rows result came from the empty local DB and says nothing about staging or
production:

```sql
SELECT id, name, open_price, setup_brl, monthly_brl
FROM sales_ops_products
WHERE open_price = true AND (setup_brl <> 0 OR monthly_brl <> 0);
```

That file is currently an uncommitted working-tree modification (the batch run log, which the Capture
step commits). The warning itself is however already **committed** in two places a human cannot miss:
the commit message body of `5859b80` ("audited on the local test DB (0 of 0 product rows affected),
and the audit must be re-run before staging or production") and the header comment of
`apps/api/drizzle/0013_produtos_servicos_defaults.sql`, which explains the zeroing and why it is not
data loss. I would still prefer the exact `SELECT` to land in a committed file rather than only the
run log, but the human-facing warning is committed, so the requirement is met.

**Would the migration alter data?** Yes, definitively - I measured it. My seeded legacy row
(`open_price = true, setup_brl = 250000, monthly_brl = 9900`) came out of the replay as
`setup_brl = 0, monthly_brl = 0`. The control row (`open_price = false`) was untouched. So the
`UPDATE ... SET setup_brl = 0, monthly_brl = 0 WHERE open_price` is a genuine, irreversible data
change for any such row, and the audit must be re-run against the real target first. On the local
test DB the count is 0, so nothing was altered here.

### 9b. Risk 16 correction - **upheld**

`apps/web/src/sales-ops/types.ts` is indeed a hand-written mirror, not generated from the API
(`SalesOpsProduct` is a plain `type` literal with `type: string` still declared at line 28). Nothing
in `apps/web` imports from `apps/api`, so the API rename cannot break web typing - confirmed by the
web suite being **30 files / 210 tests, green and byte-identical to the baseline**, with
`git diff --stat -- apps/web/` empty.

The single runtime effect is real and harmless. `SalesOpsApp.tsx:4343` reads
`productType: product?.type ?? 'SaaS'`; the API now returns `kind`, so `product.type` is `undefined`
and the fallback always fires. That value goes into the sale-item payload, and
`SaleItemSchema` (`service.ts:332`) declares only
`{ productId, productName, areaId, quantity, unitBrl }` - `productType` is not a field, so Zod's
default object stripping discards it, and `productTypeSnapshot` is derived server-side from
`product.kind` regardless. **The field the fallback feeds is stripped by the API.** I additionally
proved the API strips a top-level `type` key on the product write itself (section 3). Also relevant:
`useSaveSalesOpsProduct` deliberately performs no optimistic write, so the client never builds a
`SalesOpsProduct` from the payload and the stale `type` declaration cannot leak into cache state.

### 9c. The 121-installment ceiling - **acceptable to defer**

The edge is real and I reproduced it: `defaultEntradaMode: 'pct'` plus
`defaultRemainingInstallments: 120` yields **121** installment rows, one over
`CreateSaleSchema`'s `installments: z.array(...).min(1).max(120)`.

I judge deferring the cap to slice 10's editor acceptable, for four reasons:

1. It is documented, not hidden - `default-payment-plan.test.ts:243`
   (`documents the one template that overflows the 120-row API ceiling`) pins it with an explicit
   `expect(plan.installments).toHaveLength(121)`, so slice 10 or 11 cannot regress past it unnoticed.
2. `materializeDefaultPaymentPlan` is not yet wired into any endpoint - it ships as the normative
   reference for slice 11. Today nothing can produce 121 rows into a write.
3. The failure mode is a clean `400` validation error from `CreateSaleSchema`, not a 500 and not
   corrupt data. The ceiling still holds.
4. Clamping server-side now would be the worse fix: it would silently drop a parcela the operator
   configured. Rejecting, or capping the editor's input at 119 when an entrada is present, is the
   honest behaviour, and that is a UI decision that belongs with the editor.

## 10. Correctness review

**Money conventions - correct.** `value_brl integer` (cents) and `value_pct numeric(5,2)` (rate) on
the cost table, matching the stated convention and keeping the two units from collapsing into one
ambiguous jsonb number. `default_entrada_brl integer` cents, `default_entrada_pct numeric(5,2)`.
Confirmed from `information_schema.columns` and by a live round-trip returning
`valueBrl: 30000` and `valuePct: '5.00'`.

**`materializeDefaultPaymentPlan` - correct; rounding sound and the parts sum exactly.**
I ran seven adversarial vectors directly against the exported function:

| entrada % | parcelas | total | rows | sum | first parcela |
| --- | --- | --- | --- | --- | --- |
| 50 | 3 | 100000 | 4 | 100000 | 50000 |
| 33.33 | 7 | 99999 | 8 | 99999 | 33330 |
| 0 | 1 | 1 | 1 | 1 | 1 |
| 100 | 3 | 50000 | 1 | 50000 | 50000 |
| 13 | 120 | 123457 | 121 | 123457 | 16049 |
| 50 | 3 | 0 | 1 | 0 | 0 |
| 99.99 | 2 | 3 | 1 | 3 | 3 |

Every case sums **exactly** to the total, every amount is a non-negative integer, and the array is
never empty. The split is exact by construction: `base = floor(remaining / n)`,
`rest = remaining - base * n`, and the first restante parcela absorbs `rest`, so
`entrada + base*n + rest == total` identically. That is precisely what `validatePaymentPlan`'s
`installments_sum_mismatch` rule demands, so any plan this produces is accepted by the write
endpoints. The 100 percent entrada and zero-total cases correctly avoid emitting a trailing 0-cent
parcela while still honouring `installments: min(1)`.

Date arithmetic is right too: `addMonths` clamps to the shorter month
(`2026-01-31 -> 2026-02-28 -> 2026-03-31 -> 2026-04-30`), and with no entrada parcela 1 lands on the
base date, reproducing today's cash behaviour.

**Indexes on hot paths - adequate.** `..._org_product_idx` on `(org_id, product_id)` serves the
per-product read, the per-product `DELETE` in the replace, and the org-wide bootstrap read via the
leading-column prefix. `..._product_funcao_idx` UNIQUE enforces one row per função per product. The
composite FK's arbiter on the parent side is `sales_ops_funcoes_org_id_id_idx` from `0012`.

**Zod - no gaps found.** I cross-checked `ProductFieldsSchema`'s 26 fields against
`PRODUCT_PLAIN_COLUMNS` (19) plus the 4 numeric-coerced columns plus the 3 derived/child fields:
**every schema field is written somewhere, and no allow-list entry is absent from the schema**. So no
field is silently dropped on write and no phantom column is written. The cost payload is a
`z.discriminatedUnion('mode', ...)`, which makes a unit mix (`mode: 'pct'` with `valueBrl`)
structurally unrepresentable, and `duplicate_funcao_cost` catches a repeated `funcaoId` before it can
reach the unique index. `resolveProductKind` precedence (`kind` > `openPrice` alias > stored row) is
unit-tested directly.

**No `any` casts, no swallowed errors, no suppressions.** `git diff | grep -E "^\+.*(\bas any\b|:
any\b|@ts-ignore|@ts-expect-error|eslint-disable)"` over `apps/api/src/**` is empty. The only
`.catch()` in the added routes code is the pre-existing `c.req.json().catch(() => ({}))` idiom, which
funnels into the Zod validation error, not silence.

**Behavioural parity where it matters.** `resolveProductRefs`'s área lookup is semantically identical
to the `getArea` it replaces - I compared them and neither filters on `status`, so archived áreas
behave exactly as before.

**Commit hygiene - clean.** One commit. Conventional Commit subject
(`feat(sales-ops): classify products as Produto or Serviço with default config`).
`git log --format='%(trailers)'` is empty - no co-author trailer, no AI attribution anywhere in the
message. `git diff | grep "^+.*—"` finds no em dash in any added line.

### Style notes (not defects, not grounds for failure)

1. `getArea` is still exported from `service.ts` but no longer called by `routes.ts` - only by
   `routes.test.ts`'s mock scaffolding. A dead export worth removing when slice 10 touches this file.
2. Switching `defaultEntradaMode` requires explicitly sending the companion value (including
   `defaultEntradaPct: null` when clearing to `'none'`), otherwise the merged-row check returns
   `400 entrada_mode_value_mismatch`. That is strict-but-safe and it is unit-tested both ways; slice
   10's editor just has to send both keys together. Worth flagging to slice 10 rather than changing.
3. On PATCH, `resolveProductRefs` runs before existence is known, so a bad `funcaoId` on a
   non-existent product id yields `400` rather than `404`. Same ordering `master` already had for
   `unknown_area`.

---

## Restoration and cleanliness

Everything I mutated was reverted and verified byte-identical, not just visually.

- `apps/api/src/domains/sales-ops/service.ts` - five separate mutations applied and reverted.
  `git hash-object` = `bf0f6cfb4b901d135cc918307609ecbe7785a92f`, identical to the pre-probe baseline.
- `apps/api/src/domains/sales-ops/routes.ts` - never modified.
  `git hash-object` = `9ee76c17a61a9091a55f76987b6a2f39a1142952`, identical to baseline.
- Throwaway probe file `apps/api/test/rls/zz-verify07-probe.test.ts` - deleted.
- `git worktree list` shows only the main checkout at `5859b80`; the `master` worktree was removed and
  `git worktree prune` run.
- Throwaway database `fxl_verify07_master` - dropped (`pg_database` has no matching row).
- Test database `fxl_sales`: composite FK restored and re-verified from `pg_constraint`; all 8
  `sales_ops_products` constraints present; RLS still `ENABLED` + `FORCED` with both policies; row
  counts `products=0, costs=0, funcoes=0, areas=0, sales=0, people=0` - no leftover fixtures. No
  leftover probe roles (`pg_roles WHERE rolname LIKE 'rls_probe%' OR LIKE '%verify07%'` is empty).
  All five gates re-run green afterwards, so the DB is not merely clean but working.
- `git status --porcelain` is exactly what I found at the start, plus one file:

```
 M nexo/runs/batch-01K9C0FXA7RQ8VZTN3KDM6WS4E/run.md
?? .vscode/
?? nexo/runs/batch-01K9C0FXA7RQ8VZTN3KDM6WS4E/agents/exec-07-produtos-servicos-api.result.json
```

The `run.md` modification appeared while I was running the gates and is not mine - it is the batch run
log gaining the `SAFETY: db:migrate reads the staging DATABASE_URL` section (section 9a). I did not
write to it, did not commit, did not push, did not amend, and did not merge. The branch is still
`feat/07-produtos-servicos-api` at `5859b80`.

## Verdict

**PASS.** No real correctness defect found. All five gates are 0, drizzle reports no drift, migration
`0013` replays clean from scratch with correct statement ordering, the `kind`/`openPrice` CHECK makes
drift structurally impossible, the deprecated `openPrice` wire alias works end-to-end against
`master`'s exact request shape so `master` is not broken, no tenancy filter can be removed without a
test going Red (the two `updateProduct` filters are mutually redundant equivalent mutants and their
joint removal is caught), the composite FK is load-bearing, the cost-set replace is atomic including
the empty list and 40-way concurrency, no new constraint violation escapes as a 500, no pre-existing
test was weakened, and scope was respected.

The single 500 observed - `23505` on duplicate `codeSuffix` at `POST /products` - was proven
pre-existing by running `master`'s own code against a throwaway database, where it behaves
identically. It should be filed separately.
