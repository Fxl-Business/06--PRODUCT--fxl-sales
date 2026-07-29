---
id: 07-produtos-servicos-api
milestone: v2.3.0
status: todo
depends_on: [05-pessoas-funcoes-api]
files_modified:
  - apps/api/src/db/schema.ts
  - apps/api/drizzle/0013_produtos_servicos_defaults.sql
  - apps/api/drizzle/meta/_journal.json
  - apps/api/drizzle/meta/0013_snapshot.json
  - apps/api/src/domains/sales-ops/service.ts
  - apps/api/src/domains/sales-ops/routes.ts
  - apps/api/src/domains/sales-ops/__tests__/produtos-servicos-contract.test.ts
  - apps/api/src/domains/sales-ops/__tests__/default-payment-plan.test.ts
  - apps/api/src/domains/sales-ops/__tests__/produtos-servicos-migration.test.ts
  - apps/api/test/rls/product-funcao-costs-rls.test.ts
  - apps/api/test/rls/produtos-servicos-schema-migration.test.ts
  - apps/web/src/sales-ops/types.ts
  - apps/web/src/sales-ops/SalesOpsApp.tsx
  - apps/web/src/sales-ops/__tests__/areas-view.test.tsx
  - apps/web/src/sales-ops/__tests__/product-commission-editor.test.tsx
  - apps/web/src/sales-ops/__tests__/sale-wizard-commission-defaults.test.tsx
  - apps/web/src/sales-ops/__tests__/sale-wizard-custom-item-labels.test.tsx
  - apps/web/src/sales-ops/__tests__/sale-wizard-edit.test.tsx
  - apps/web/src/sales-ops/__tests__/sale-wizard-free-items.test.tsx
  - apps/web/src/sales-ops/__tests__/sale-wizard-payment-plan.test.tsx
acceptance: "given an org that owns the funções Developer and Tester, when an admin POSTs a Serviço named Custom with defaultEntradaMode 'pct' / defaultEntradaPct 50 / defaultRemainingInstallments 3 / defaultPaymentMethod 'pix' and productFuncaoCosts [{Developer, pct, 5}, {Tester, fix, 30000}], then the row persists with kind='service', open_price derived true, setup_brl and monthly_brl forced to zero, both cost rows are returned by POST, PATCH and GET /bootstrap, a funcaoId owned by another org is rejected with 400 unknown_funcao, and a Serviço carrying a non-zero own value is rejected with 400 service_cannot_have_fixed_value."
---

# Produtos & Serviços - backend schema, defaults and API

## Goal

Give `sales_ops_products` a single, unambiguous `Produto | Serviço` classification and a rich default-configuration block, so the Cadastros screen can stop being a thin price list and start prefilling a proposta.
A Serviço is structurally a variable-value item: it carries no own price, only defaults for how the money is split (payment plan template, forma de pagamento, commissions, and per-função costs).
A Produto keeps its own fixed `setupBrl` / `monthlyBrl`.
Everything stored here is a *template*: slice 12 makes every value overridable inside the proposta without touching the cadastro.
This slice is backend only: schema, migration, validation, service, routes, plus the minimum mechanical web type alignment forced by renaming a column that the web response type mirrors.

## Current state

- `apps/api/src/db/schema.ts:462` defines `salesOpsProducts` with `type text NOT NULL DEFAULT 'SaaS'` at `:468` and `openPrice boolean NOT NULL DEFAULT false` at `:471`.
- `apps/api/src/db/schema.ts:15` is binding: "Money: integer (cents) - never numeric/float", "Rates: numeric(5,2)".
- `apps/api/src/db/schema.ts:449` `salesOpsAreas`; every product already requires an `areaId` at the Zod level.
- `apps/api/src/domains/sales-ops/service.ts:64` `ProductSchema` accepts `type` with default `'SaaS'` and `openPrice` as an independent boolean.
- `apps/api/src/domains/sales-ops/service.ts:659` `listProducts`, `:669` `createProduct`, `:689` `updateProduct`, `:788` `getArea`, `:1300` `getSalesOpsSnapshot`.
- `apps/api/src/domains/sales-ops/service.ts:299` is the **only** remaining reader of `salesOpsProducts.type`: `resolveSaleItemContexts` copies it into `productTypeSnapshot` at `:330` (and writes `''` for free-form rows at `:334`), which `buildSaleLedger` persists at `:439` into `sales_ops_sale_items.product_type_snapshot`.
- `apps/api/src/domains/sales-ops/service.ts:26` `PersonFieldsSchema` / `:35` `PersonSchema` / `:41` `UpdatePersonSchema` is the established base-object + refine + partial idiom.
- `apps/api/src/domains/sales-ops/service.ts:161` `validatePaymentPlan` requires `sum(installments) === sum(items)` exactly, and `:368` `addMonths` already exists.
- `apps/api/src/domains/sales-ops/routes.ts:80/85/96` are the product endpoints; `:46` is `/bootstrap`; `:90` is the `getArea` -> `unknown_area` pre-check idiom; `:61/70` show `requireAdmin` applied only to `/people`.
- `apps/api/src/server.ts:74` mounts the whole router behind `appAuthMiddleware` at `/api/v1/sales-ops`.
- There is no DELETE endpoint anywhere in `routes.ts`; archival is done through a `status` field (`salesOpsAreas.status`, `salesOpsProducts.status`).
- `apps/api/drizzle/0011_proposal_lifecycle_schema.sql` is the newest migration (idx 11 in `apps/api/drizzle/meta/_journal.json`); `apps/api/drizzle/0010_sales_ops_areas.sql:13-28` is the canonical "new table + forced RLS + both policies + `set_config('app.fxl_admin','true',true)` guarded backfill" pattern.
- `apps/api/drizzle/0007_marvelous_valeria_richards.sql:194` and `0008_single_role_rls_context.sql:153` already put forced RLS plus `sales_ops_products_tenant_isolation` / `sales_ops_products_admin_context` on `sales_ops_products`.
- Web mirrors: `apps/web/src/sales-ops/types.ts:35` `type: string`, `:38` `openPrice: boolean`, `:184` `SalesOpsBootstrap`; `apps/web/src/sales-ops/api.ts:22` derives `SaveProductPayload` from `Partial<SalesOpsProduct>`; `apps/web/src/sales-ops/hooks.ts:28` is an **explicit allow-list** `select` that silently drops unknown bootstrap keys.
- `apps/web/src/sales-ops/SalesOpsApp.tsx:4104` is the only web reader of `product.type`, and it feeds `productType`, a field the API's `SaleItemSchema` strips.
- `apps/web/src/sales-ops/SalesOpsApp.tsx:1978` `formatProductCommission` and `apps/web/src/sales-ops/calculations.ts:45` `resolveSaleCommissionDefaults` consume only the six existing commission columns.
- `apps/api/src/db/schema.ts:495` `providers jsonb` holds `[{ personName, commissionType, commissionValue }]` (`ProductProviderSchema`, `service.ts:58`), edited by the product dialog through `form.providers` (`SalesOpsApp.tsx:2418`, `:2447-2452`, `:2660-2666`).

### Verified against slice 05's written plan

`nexo/plans/batch-01K9C0FXA7RQ8VZTN3KDM6WS4E/05-pessoas-funcoes-api.md` now exists, and the names in this plan are reconciled against it, not guessed.

- `sales_ops_funcoes` columns: `id`, `org_id`, `name`, `slug`, `is_system`, `status`, `created_at`, `updated_at` (05, `## Target schema`). `slug` is the load-bearing machine key; `'vendedor'` and `'finder'` are the two reserved system slugs.
- **`uniqueIndex('sales_ops_funcoes_org_id_id_idx').on(t.orgId, t.id)` is already declared by slice 05** as its own composite-FK target. This slice reuses it and must **not** re-declare or re-create it.
- Slice 05 already adds `foreignKey` to the `drizzle-orm/pg-core` import list in `schema.ts` and defines `salesOpsFuncoes` **before** `salesOpsProducts`, so the reference resolves without a forward declaration.
- Slice 05 establishes the composite `(org_id, fk)` foreign-key convention on `sales_ops_person_funcoes`, with `.onDelete('restrict')` on the função side, precisely because a single-column FK does not consult the RLS predicate. This slice mirrors that convention exactly.
- Slice 05 takes migration idx 12, tag `0012_sales_ops_funcoes`, so this slice is idx 13. Confirmed, not assumed.
- Slice 05 already adds `funcoes` and `personFuncoes` to the `/bootstrap` payload and enriches `people` with `funcaoIds` / `funcoes`. The `productFuncaoCosts` key added here does not collide.
- Slice 05 uses the reason code `unknown_funcao` in `resolvePersonFuncoes` for a foreign or absent `funcaoId`. This slice reuses the identical code for the same failure.
- Slice 05 keeps `is_seller` / `is_finder` / `is_collaborator` as **derived deprecated mirrors** rather than dropping them, because live web readers exist. This slice applies the same expand-then-contract discipline to `providers` (see Decision 4).
- Slice 05 also pairs a unit-suite migration-text assertion with an integration-suite shipped-SQL replay (`apps/api/test/rls/proposal-schema-migration.test.ts:96-115` is the replay idiom), because root `pnpm test` does not run integration tests. This slice does both too.

## Target schema

### Decision 1: `type` is renamed to `kind`, not duplicated

`type` is already dead as a classification.
The Tipo control was removed from the UI (`CLAUDE.md`, Sales Ops Routing), `SaveProductPayload` no longer carries it, and `ProductSchema` defaults it to `'SaaS'`, so every product created since that removal stores the same constant.
Its single consumer is `product_type_snapshot`, which nothing renders (only test fixtures reference it).

So the honest move is a **rename**, not a second column: `type` -> `kind`, with a closed domain `'product' | 'service'` and a DB CHECK.
This leaves exactly one classification axis on the product.
Alternatives rejected:

- Adding `kind` and keeping `type`: two overlapping concepts, one of them permanently constant. Rejected.
- Adding `kind` and dropping `type`: same web churn as the rename, but it also breaks the lineage of `sales_ops_sale_items.product_type_snapshot`, whose whole meaning is "the product's `type` at sale time". Rejected.
- Reusing `type` under its old name with the new closed domain: the name `type` collides with `ProductModuleSchema.type` and `SaleProfessionalSchema.role`-adjacent vocabulary and reads as free text. Rejected in favour of the more precise `kind`.

Storage values stay English (`'product'`, `'service'`) to match every other enum in the schema (`'active'`, `'archived'`, `'won'`, `'pix'`).
The pt-BR labels `Produto` / `Serviço` live in the web layer, exactly as `draft|open|won` maps to Rascunho/Aberta/Ganha.

Consequence for `resolveSaleItemContexts`: `productTypeSnapshot` is now fed from `product.kind`, so new sale items snapshot `'product'` or `'service'` instead of the constant `'SaaS'`.
Historical rows keep their stored `'SaaS'` / `''` values untouched.
This is strictly more information than before, the column is not renamed, and no parallel description field or migration is added, so the `items[].productName` -> `productNameSnapshot` open-price path in `CLAUDE.md` is untouched.

### Decision 2: `openPrice` survives as a DB-enforced projection of `kind`

`openPrice` already means precisely "this item has no own price, the operator types a label and a value per proposta", which is the definition of a Serviço.
Keeping the two as independent booleans permits contradictory rows (a `product` with `openPrice` true).
Dropping `openPrice` outright would rewrite eleven wizard call sites (`SalesOpsApp.tsx:3585, 3729, 3833-3835, 3940, 3953, 3972, 4430-4432, 4495`) and drag slices 10 and 12 into this commit.

Decision: `open_price` stays as a physical column and stays the flag the wizard reads, but it is no longer an independent concept.
It is written by the server as `kind === 'service'` and the equality is enforced by a DB CHECK, so it cannot drift.
`openPrice` remains **accepted on the wire as a deprecated alias** for `kind`, which is what keeps master green in the window between this slice and slice 10: the current product dialog keeps sending `openPrice` and keeps working unchanged.

Slice 10 replaces the "Preço aberto" switch with the `Produto | Serviço` toggle and starts sending `kind`.
Slice 12 may read either.

### Drizzle definitions

`apps/api/src/db/schema.ts` - add `foreignKey` to the `drizzle-orm/pg-core` import list at `:24`.

```ts
export const salesOpsProducts = pgTable(
  'sales_ops_products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    name: text('name').notNull(),
    // Produto | Serviço. The ONLY classification axis on a product (renamed from `type`,
    // which had degenerated into the constant 'SaaS' once Tipo left the UI).
    kind: text('kind').notNull().default('product'), // 'product' | 'service'
    codeSuffix: text('code_suffix').notNull().default('0'),
    areaId: uuid('area_id').references(() => salesOpsAreas.id),
    // Derived projection of `kind`, never authored independently. The
    // sales_ops_products_kind_open_price_check CHECK keeps it == (kind = 'service').
    openPrice: boolean('open_price').notNull().default(false),
    setupBrl: integer('setup_brl').notNull().default(0),
    hasMonthly: boolean('has_monthly').notNull().default(false),
    monthlyBrl: integer('monthly_brl').notNull().default(0),
    recurringCommission: boolean('recurring_commission').notNull().default(false),
    hasFinderCommission: boolean('has_finder_commission').notNull().default(false),
    sellerCommissionType: text('seller_commission_type').notNull().default('pct'),
    sellerCommissionValue: numeric('seller_commission_value', {
      precision: 10,
      scale: 2,
    }).notNull(),
    sellerWithFinderCommissionType: text('seller_with_finder_commission_type')
      .notNull()
      .default('pct'),
    sellerWithFinderCommissionValue: numeric('seller_with_finder_commission_value', {
      precision: 10,
      scale: 2,
    }).notNull(),
    finderCommissionType: text('finder_commission_type').notNull().default('pct'),
    finderCommissionValue: numeric('finder_commission_value', {
      precision: 10,
      scale: 2,
    }).notNull(),
    // ── Default payment plan TEMPLATE (no absolute dates; see ## Default config shape) ──
    defaultPaymentMethod: text('default_payment_method').notNull().default('pix'),
    defaultEntradaMode: text('default_entrada_mode').notNull().default('none'), // 'none'|'pct'|'fix'
    defaultEntradaPct: numeric('default_entrada_pct', { precision: 5, scale: 2 }),
    defaultEntradaBrl: integer('default_entrada_brl'), // cents
    defaultRemainingInstallments: integer('default_remaining_installments').notNull().default(1),
    // NULL = indefinite recurrence (CLAUDE.md `cycles: null`). Only meaningful when
    // has_monthly is true; the recurring AMOUNT stays monthly_brl, never duplicated here.
    defaultRecurringCycles: integer('default_recurring_cycles').default(12),
    modules: jsonb('modules').notNull().default(sql`'[]'::jsonb`),
    providers: jsonb('providers').notNull().default(sql`'[]'::jsonb`),
    status: text('status').notNull().default('active'), // 'active' | 'archived'
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [
    index('sales_ops_products_org_id_idx').on(t.orgId, t.name),
    uniqueIndex('sales_ops_products_org_code_suffix_idx').on(t.orgId, t.codeSuffix),
    check('sales_ops_products_kind_check', sql`${t.kind} in ('product', 'service')`),
    check(
      'sales_ops_products_kind_open_price_check',
      sql`(${t.kind} = 'service') = ${t.openPrice}`,
    ),
    check(
      'sales_ops_products_service_no_fixed_value_check',
      sql`${t.kind} <> 'service' or (${t.setupBrl} = 0 and ${t.monthlyBrl} = 0)`,
    ),
    check(
      'sales_ops_products_default_entrada_mode_check',
      sql`(${t.defaultEntradaMode} = 'none' and ${t.defaultEntradaPct} is null and ${t.defaultEntradaBrl} is null)
        or (${t.defaultEntradaMode} = 'pct' and ${t.defaultEntradaPct} is not null and ${t.defaultEntradaBrl} is null)
        or (${t.defaultEntradaMode} = 'fix' and ${t.defaultEntradaBrl} is not null and ${t.defaultEntradaPct} is null)`,
    ),
    check(
      'sales_ops_products_default_installments_check',
      sql`${t.defaultRemainingInstallments} between 1 and 120`,
    ),
    check(
      'sales_ops_products_default_recurring_cycles_check',
      sql`${t.defaultRecurringCycles} is null or ${t.defaultRecurringCycles} between 1 and 120`,
    ),
  ],
);
```

### Decision 3: função cost defaults get a real child table, not jsonb

```ts
// Default cost per função for one produto/serviço. Child table, NOT jsonb, on purpose
// (see the justification in the plan): funções are org-created and archivable, so a
// dangling funcao_id would be an undetectable silent failure, and the composite FK is
// what makes a cross-org funcao_id structurally impossible rather than merely checked.
export const salesOpsProductFuncaoCosts = pgTable(
  'sales_ops_product_funcao_costs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    productId: uuid('product_id')
      .notNull()
      .references(() => salesOpsProducts.id, { onDelete: 'cascade' }),
    // FK declared as the composite (org_id, funcao_id) constraint below, not here.
    funcaoId: uuid('funcao_id').notNull(),
    mode: text('mode').notNull(), // 'pct' | 'fix' - same vocabulary as *_commission_type
    valuePct: numeric('value_pct', { precision: 5, scale: 2 }), // rates are numeric(5,2)
    valueBrl: integer('value_brl'), // money is integer cents
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('sales_ops_product_funcao_costs_product_funcao_idx').on(t.productId, t.funcaoId),
    index('sales_ops_product_funcao_costs_org_product_idx').on(t.orgId, t.productId),
    // Composite FK, mirroring sales_ops_person_funcoes_org_funcao_fk from slice 05.
    // A single-column FK on funcao_id would NOT consult the RLS predicate, so org A
    // could pin org B's função as a cost default. `restrict` matches slice 05.
    foreignKey({
      columns: [t.orgId, t.funcaoId],
      foreignColumns: [salesOpsFuncoes.orgId, salesOpsFuncoes.id],
      name: 'sales_ops_product_funcao_costs_org_funcao_fk',
    }).onDelete('restrict'),
    check(
      'sales_ops_product_funcao_costs_mode_check',
      sql`(${t.mode} = 'pct' and ${t.valuePct} is not null and ${t.valueBrl} is null)
        or (${t.mode} = 'fix' and ${t.valueBrl} is not null and ${t.valuePct} is null)`,
    ),
  ],
);
```

The composite FK target `uniqueIndex('sales_ops_funcoes_org_id_id_idx').on(t.orgId, t.id)` is **already declared by slice 05** on `salesOpsFuncoes` for its own join table.
This slice reuses it and adds nothing to `sales_ops_funcoes`.
Verify it is present in `schema.ts` before running `db:generate`; if slice 05 landed without it, add it there rather than creating an untracked index in this migration.

**Why a child table and not jsonb, honestly weighed.**

For jsonb: `modules` and `providers` on this very table are jsonb, so jsonb is the local precedent, and it costs zero new tables, zero new RLS policies, and zero extra bootstrap queries.

For a child table, and why it wins:

1. A dangling `funcaoId` is a real, silent failure mode. Funções are org-created and archivable by design (slice 05), so the set of valid ids changes over time. In jsonb nothing can detect the dangle: the product just quietly stops prefilling one cost, and there is no query that finds the broken rows.
2. Cross-org tenancy. The composite FK `(org_id, funcao_id) -> sales_ops_funcoes (org_id, id)` makes a cross-org `funcaoId` *impossible to store*, not merely rejected by whichever code path remembered to check. With jsonb the service-layer check is the only line of defence, and it is exactly the kind of check that a later refactor drops.
3. Money and rate typing. `schema.ts:15` is explicit. A child table gives `value_brl integer` (cents) and `value_pct numeric(5,2)` with a CHECK that exactly one is set. jsonb can only store an untyped `number`, and the units bug (5.00 percent versus 30000 cents in the same field) is precisely the bug the convention exists to prevent.
4. The `providers` jsonb column is itself the anti-pattern being replaced here: it stores a bare `personName` string with no link to `sales_ops_people`. Repeating that shape for funções would bake the same weakness into the new feature.

Cost accepted: one table, two RLS policies, one extra query inside `getSalesOpsSnapshot`.
`CLAUDE.md` and the global guidelines both say to weight robustness and maintainability over development cost, so this is the call.

**Why not one jsonb `defaults` column for the payment template either.** The payment defaults are a small, closed set of scalars, two of which are money or rate typed. Flat typed columns get real types, real CHECKs and real defaults, and they match the `sales_ops_settings` precedent for org-level defaults (`schema.ts:524`). jsonb stays reserved for the genuinely open-ended lists it already holds.

**No new DELETE endpoint.** Cost rows are managed as a set inside the product write, exactly like the `modules` and `providers` arrays are today: sending `productFuncaoCosts` replaces the whole set for that product, and `[]` clears it. The router's no-DELETE convention is respected.

### Decision 4: `providers` is deprecated here, contracted later

Slice 05's compatibility matrix hands `providers` to this slice: "Slice 07 replaces it with per-função cost defaults."
That is correct in substance. `providers` is `[{ personName, commissionType, commissionValue }]`, which is the same idea as a default cost per collaborator, except keyed by a free-text person name instead of a função. The human's requirement is função-keyed ("the Developer função earns 5%, the Tester função a fixed R$ 300,00"), so `productFuncaoCosts` genuinely supersedes it.

But `providers` is **not dropped in this slice**, for the same reason slice 05 keeps `is_seller` / `is_finder` / `is_collaborator`: live readers exist. The product dialog has a providers editor (`SalesOpsApp.tsx:2418`, `:2447-2452`, `:2660-2666`) and `ProductProviderSchema` is part of the current write contract. Dropping the column here would red-line `pnpm run type-check` and force UI work into a backend slice.

Staging, mirroring slice 05's expand-then-contract discipline exactly:

1. **Slice 07 (this one):** add `productFuncaoCosts`, annotate `providers` in `schema.ts` as `@deprecated - superseded by sales_ops_product_funcao_costs; drop after slice 10 lands`, keep accepting and returning it unchanged.
2. **Slice 10:** replace the providers editor with the função cost editor and stop sending `providers`.
3. **A later contract slice:** drop the column and `ProductProviderSchema`.

**There is no backfill from `providers` to `productFuncaoCosts`, and there cannot be one.** A provider row identifies a human by free-text `personName`; a cost row identifies a função by id. No deterministic mapping exists, and inventing one (fuzzy-matching a name to a `sales_ops_people` row, then to that person's funções) would silently attach wrong money to wrong roles. The existing `providers` values stay readable in the deprecated column so slice 10 can surface them read-only while the operator re-enters them as função costs.

## Default config shape

These types are load-bearing for slices 10, 11 and 12.

### Zod, in `apps/api/src/domains/sales-ops/service.ts`

Reuses the existing local aliases `uuid`, `money` (`z.number().int().nonnegative()`, cents), `pct` (`z.number().min(0).max(100)`) and `MethodSchema` (`service.ts:121`).

```ts
export const ProductKindSchema = z.enum(['product', 'service']);
export const ProductEntradaModeSchema = z.enum(['none', 'pct', 'fix']);

/** One default cost for one função. Discriminated so the units can never be ambiguous. */
export const ProductFuncaoCostSchema = z.discriminatedUnion('mode', [
  z.object({ funcaoId: uuid, mode: z.literal('pct'), valuePct: pct }),
  z.object({ funcaoId: uuid, mode: z.literal('fix'), valueBrl: money }),
]);

/**
 * Base product fields. Deliberately a plain z.object so `.partial()` stays available
 * for the PATCH schema - mirrors PersonFieldsSchema at service.ts:26.
 */
export const ProductFieldsSchema = z.object({
  name: z.string().trim().min(1).max(140),
  kind: ProductKindSchema.optional(),
  /** @deprecated legacy alias for `kind`. Kept so the pre-slice-10 dialog keeps working. */
  openPrice: z.boolean().optional(),
  codeSuffix: z.string().regex(/^\d{1,2}$/).default('0'),
  areaId: uuid,
  setupBrl: money.default(0),
  hasMonthly: z.boolean().default(false),
  monthlyBrl: money.default(0),
  recurringCommission: z.boolean().default(false),
  hasFinderCommission: z.boolean().default(false),
  sellerCommissionType: z.enum(['pct', 'fix']).default('pct'),
  sellerCommissionValue: z.number().nonnegative().default(10),
  sellerWithFinderCommissionType: z.enum(['pct', 'fix']).optional(),
  sellerWithFinderCommissionValue: z.number().nonnegative().optional(),
  finderCommissionType: z.enum(['pct', 'fix']).default('pct'),
  finderCommissionValue: z.number().nonnegative().default(3),
  defaultPaymentMethod: MethodSchema.default('pix'),
  defaultEntradaMode: ProductEntradaModeSchema.default('none'),
  defaultEntradaPct: pct.nullable().optional(),
  defaultEntradaBrl: money.nullable().optional(),
  defaultRemainingInstallments: z.number().int().min(1).max(120).default(1),
  /** null = indefinite recurrence; undefined on PATCH = leave unchanged. */
  defaultRecurringCycles: z.number().int().min(1).max(120).nullable().optional(),
  productFuncaoCosts: z.array(ProductFuncaoCostSchema).optional(),
  modules: z.array(ProductModuleSchema).default([]),
  providers: z.array(ProductProviderSchema).default([]),
  status: z.enum(['active', 'archived']).default('active'),
});

export const ProductSchema = ProductFieldsSchema.superRefine(validateProductFields);
export const UpdateProductSchema = ProductFieldsSchema.partial().superRefine(validateProductFields);
export type ProductInput = z.infer<typeof ProductSchema>;
export type ProductFuncaoCostInput = z.infer<typeof ProductFuncaoCostSchema>;
```

`validateProductFields` is partial-tolerant (every rule is skipped when its inputs are `undefined`) and raises these issues:

| code | condition |
| --- | --- |
| `kind_open_price_conflict` | both `kind` and `openPrice` present and `openPrice !== (kind === 'service')` |
| `service_cannot_have_fixed_value` | resolved kind is `'service'` and (`setupBrl > 0` or `monthlyBrl > 0`) |
| `entrada_mode_value_mismatch` | `'none'` with either value set, `'pct'` without `defaultEntradaPct`, `'fix'` without `defaultEntradaBrl`, or the wrong-unit field set for the mode |
| `duplicate_funcao_cost` | two `productFuncaoCosts` rows share a `funcaoId` |

Resolved kind inside the refine is `kind ?? (openPrice === undefined ? undefined : openPrice ? 'service' : 'product')`.
On a partial payload it can be `undefined`, in which case the `service_cannot_have_fixed_value` rule is deferred to the merged-row check in `updateProduct` (see `## API contract`).

### Server-side kind resolution

```ts
type KindSource = { kind?: 'product' | 'service'; openPrice?: boolean };

/** `kind` wins; `openPrice` is the legacy alias; `current` is the stored row on PATCH. */
export function resolveProductKind(
  data: KindSource,
  current?: 'product' | 'service',
): 'product' | 'service' {
  if (data.kind !== undefined) return data.kind;
  if (data.openPrice !== undefined) return data.openPrice ? 'service' : 'product';
  return current ?? 'product';
}
```

`createProduct` and `updateProduct` always write `kind` together with `openPrice: kind === 'service'`.

### Row shape returned to clients

```ts
type ProductRow = {
  id: string; orgId: string; name: string;
  kind: 'product' | 'service';
  codeSuffix: string; areaId: string | null;
  openPrice: boolean;                     // === (kind === 'service')
  setupBrl: number; hasMonthly: boolean; monthlyBrl: number;   // cents
  recurringCommission: boolean; hasFinderCommission: boolean;
  sellerCommissionType: 'pct' | 'fix';            sellerCommissionValue: string;
  sellerWithFinderCommissionType: 'pct' | 'fix';  sellerWithFinderCommissionValue: string;
  finderCommissionType: 'pct' | 'fix';            finderCommissionValue: string;
  defaultPaymentMethod: 'pix' | 'card' | 'boleto' | 'transfer';
  defaultEntradaMode: 'none' | 'pct' | 'fix';
  defaultEntradaPct: string | null;       // numeric(5,2) serialized by drizzle as a string
  defaultEntradaBrl: number | null;       // cents
  defaultRemainingInstallments: number;
  defaultRecurringCycles: number | null;  // null = indefinite
  modules: SalesOpsProductModule[]; providers: SalesOpsProductProvider[];
  status: 'active' | 'archived';
  createdAt: string; updatedAt: string | null;
};

type ProductFuncaoCostRow = {
  id: string; orgId: string; productId: string; funcaoId: string;
  mode: 'pct' | 'fix';
  valuePct: string | null;   // set when mode === 'pct'
  valueBrl: number | null;   // cents, set when mode === 'fix'
  createdAt: string; updatedAt: string | null;
};
```

Cost rows are returned **flat** under the key `productFuncaoCosts` on every endpoint, never nested inside a product.
One key, one row shape, everywhere, matching how `saleItems` and `saleProfessionals` already come back from `/bootstrap`.

### Template to concrete installments

The stored defaults carry no absolute dates, so they are a template.
Slice 11 turns a template into rows with this algorithm, which is shipped here as the normative reference implementation `materializeDefaultPaymentPlan` in `apps/api/src/domains/sales-ops/service.ts`.
It is pure and exported alongside `buildSaleLedger`, and it is covered by the unit tests in `## Red`, so the spec cannot silently drift while slice 11 mirrors it in `apps/web/src/sales-ops/calculations.ts`.

```ts
export function materializeDefaultPaymentPlan(input: {
  defaults: Pick<ProductRow,
    | 'defaultPaymentMethod' | 'defaultEntradaMode' | 'defaultEntradaPct'
    | 'defaultEntradaBrl' | 'defaultRemainingInstallments' | 'defaultRecurringCycles'>;
  totalBrl: number;   // cents, the proposta items total
  baseDate: string;   // 'YYYY-MM-DD'
  hasMonthly: boolean;
  monthlyBrl: number; // cents; product.monthlyBrl, or the operator's typed value for a serviço
}): {
  installments: Array<{ dueDate: string; amountBrl: number; method: PaymentMethod }>;
  recurring: { monthlyBrl: number; startDate: string; cycles: number | null } | null;
};
```

1. `entradaBrl`: `'none'` -> `0`; `'pct'` -> `Math.round(totalBrl * Number(defaultEntradaPct) / 100)`; `'fix'` -> `defaultEntradaBrl`. Clamp to `[0, totalBrl]`.
2. `remaining = totalBrl - entradaBrl`, `n = defaultRemainingInstallments`.
3. If `entradaBrl > 0`, emit the entrada row first, due on `baseDate`, and put restante parcela `i` (1..n) on `addMonths(baseDate, i)`. If `entradaBrl === 0`, restante parcela `i` goes on `addMonths(baseDate, i - 1)`, so parcela 1 lands on `baseDate` and a 1x plan reproduces today's cash behaviour byte for byte.
4. Split `remaining`: `base = Math.floor(remaining / n)`, `rest = remaining - base * n`; parcela 1 gets `base + rest`, parcelas 2..n get `base`. The sum is exact, which `validatePaymentPlan` (`service.ts:170`) demands.
5. If `remaining === 0`, emit no restante rows at all, so a 100 percent entrada never produces a 0-cent parcela. If `totalBrl === 0`, emit exactly one `{ dueDate: baseDate, amountBrl: 0, method }` row so the array satisfies `.min(1)`.
6. Every row uses `method = defaultPaymentMethod`.
7. `recurring` is `hasMonthly ? { monthlyBrl, startDate: addMonths(baseDate, 1), cycles: defaultRecurringCycles ?? null } : null`. `cycles: null` means indefinite and generates no bounded rows, per `CLAUDE.md`.

The recurring **amount** is deliberately not stored in the defaults block: it already lives in `monthlyBrl`, and `hasMonthly` already expresses "this thing recurs". Adding a `default_recurring_monthly_brl` column would be a second overlapping concept.

## Migration plan

Ordering is now confirmed, not assumed: slice 05's plan takes idx 12, tag `0012_sales_ops_funcoes`, so this slice is `0013_produtos_servicos_defaults`.
If 05 has not landed, this slice **cannot** land, because the composite FK target `sales_ops_funcoes` and its `sales_ops_funcoes_org_id_id_idx` unique index do not exist; `depends_on` encodes that and the wave assignment already serializes it.
Before renaming the generated file, re-read `apps/api/drizzle/meta/_journal.json` and confirm the newest idx is 12 with tag `0012_sales_ops_funcoes`.

1. Edit `apps/api/src/db/schema.ts`: rename `type` to `kind` with the new default and CHECKs, add the six default-config columns, annotate `providers` as deprecated, and add `salesOpsProductFuncaoCosts`. `foreignKey` is already in the `drizzle-orm/pg-core` import list because slice 05 added it; add it only if that turns out not to be the case.
2. Run `pnpm --filter @fxl-sales/api db:generate`. It will ask whether `kind` was created or renamed; answer **`~ type › kind rename column`** so it emits `ALTER TABLE "sales_ops_products" RENAME COLUMN "type" TO "kind";` rather than a destructive drop-and-add.
3. Rename the generated SQL file to `0013_produtos_servicos_defaults.sql` and set the matching `tag` for `idx: 13` in `apps/api/drizzle/meta/_journal.json`. Leave the generated `meta/0013_snapshot.json` alone.
4. Hand-edit the SQL so the order is: DDL, then the admin-context backfill, then the CHECK constraints, then the RLS block. `drizzle-kit` emits the CHECKs with the DDL, so **move every `ADD CONSTRAINT ... CHECK` below the backfill** or the migration fails on existing data.

   ```sql
   -- 1. DDL (generated)
   ALTER TABLE "sales_ops_products" RENAME COLUMN "type" TO "kind";--> statement-breakpoint
   ALTER TABLE "sales_ops_products" ALTER COLUMN "kind" SET DEFAULT 'product';--> statement-breakpoint
   ALTER TABLE "sales_ops_products" ADD COLUMN "default_payment_method" text DEFAULT 'pix' NOT NULL;--> statement-breakpoint
   ALTER TABLE "sales_ops_products" ADD COLUMN "default_entrada_mode" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
   ALTER TABLE "sales_ops_products" ADD COLUMN "default_entrada_pct" numeric(5, 2);--> statement-breakpoint
   ALTER TABLE "sales_ops_products" ADD COLUMN "default_entrada_brl" integer;--> statement-breakpoint
   ALTER TABLE "sales_ops_products" ADD COLUMN "default_remaining_installments" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
   ALTER TABLE "sales_ops_products" ADD COLUMN "default_recurring_cycles" integer DEFAULT 12;--> statement-breakpoint
   CREATE TABLE "sales_ops_product_funcao_costs" ( ... );--> statement-breakpoint
   -- NOTE: sales_ops_funcoes_org_id_id_idx is created by 0012, NOT here. Do not duplicate it.
   CREATE UNIQUE INDEX "sales_ops_product_funcao_costs_product_funcao_idx" ON "sales_ops_product_funcao_costs" USING btree ("product_id","funcao_id");--> statement-breakpoint
   CREATE INDEX "sales_ops_product_funcao_costs_org_product_idx" ON "sales_ops_product_funcao_costs" USING btree ("org_id","product_id");--> statement-breakpoint
   ALTER TABLE "sales_ops_product_funcao_costs" ADD CONSTRAINT "sales_ops_product_funcao_costs_product_id_sales_ops_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."sales_ops_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
   ALTER TABLE "sales_ops_product_funcao_costs" ADD CONSTRAINT "sales_ops_product_funcao_costs_org_funcao_fk" FOREIGN KEY ("org_id","funcao_id") REFERENCES "public"."sales_ops_funcoes"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

   -- 2. Backfill, behind the transaction-local admin context (sales_ops_products has FORCE RLS)
   SELECT set_config('app.fxl_admin', 'true', true);--> statement-breakpoint
   UPDATE "sales_ops_products"
   SET "kind" = CASE WHEN "open_price" THEN 'service' ELSE 'product' END;--> statement-breakpoint
   UPDATE "sales_ops_products"
   SET "setup_brl" = 0, "monthly_brl" = 0
   WHERE "open_price";--> statement-breakpoint

   -- 3. CHECK constraints, moved below the backfill by hand
   ALTER TABLE "sales_ops_products" ADD CONSTRAINT "sales_ops_products_kind_check" CHECK ("kind" in ('product', 'service'));--> statement-breakpoint
   ALTER TABLE "sales_ops_products" ADD CONSTRAINT "sales_ops_products_kind_open_price_check" CHECK (("kind" = 'service') = "open_price");--> statement-breakpoint
   ALTER TABLE "sales_ops_products" ADD CONSTRAINT "sales_ops_products_service_no_fixed_value_check" CHECK ("kind" <> 'service' or ("setup_brl" = 0 and "monthly_brl" = 0));--> statement-breakpoint
   -- ... the three default_* CHECKs, plus sales_ops_product_funcao_costs_mode_check ...

   -- 4. RLS for the new table, mirroring 0010_sales_ops_areas.sql:13-22
   ALTER TABLE sales_ops_product_funcao_costs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
   ALTER TABLE sales_ops_product_funcao_costs FORCE ROW LEVEL SECURITY;--> statement-breakpoint
   CREATE POLICY sales_ops_product_funcao_costs_tenant_isolation ON sales_ops_product_funcao_costs
     AS PERMISSIVE FOR ALL
     USING (org_id = current_setting('app.current_org_id', true))
     WITH CHECK (org_id = current_setting('app.current_org_id', true));--> statement-breakpoint
   CREATE POLICY sales_ops_product_funcao_costs_admin_context ON sales_ops_product_funcao_costs
     AS PERMISSIVE FOR ALL
     USING (current_setting('app.fxl_admin', true) = 'true')
     WITH CHECK (current_setting('app.fxl_admin', true) = 'true');
   ```

5. **Backfill rule for `kind`.** `kind = CASE WHEN open_price THEN 'service' ELSE 'product' END`. This is correct against the real read semantics, not a guess: `open_price` already means "no own price, the operator types the label and the value per proposta", which is exactly the human's definition of a Serviço ("the value is always variable"). Every read path confirms it. `SalesOpsApp.tsx:2038` and `:2042` render `'Aberto'` instead of a value when `openPrice`, and `:3729`, `:3953` and `:3972` all seed the wizard unit price with `product.openPrice ? 0 : product.setupBrl || product.monthlyBrl`. There is no other candidate signal: `type` is the constant `'SaaS'` and carries zero information.
6. **Backfill rule for the own value.** `setup_brl = 0, monthly_brl = 0 WHERE open_price`, needed before `sales_ops_products_service_no_fixed_value_check` can be added. This is not a data loss: the product dialog has always forced both to zero when the "Preço aberto" switch was on (`SalesOpsApp.tsx:2645` and `:2647`), and every read path above skips the values when `openPrice`. Any residual non-zero cents written directly through the API were already unreachable.
7. The six default-config columns need no backfill: their column defaults (`'pix'`, `'none'`, `1`, `12`) reproduce today's wizard behaviour, which starts every plan as a single cash parcela with `pix` and a 12-cycle recurrence when `hasMonthly`.
8. `providers` is neither migrated nor dropped, per Decision 4. There is no `INSERT INTO sales_ops_product_funcao_costs ... FROM providers` statement, because `personName` cannot be mapped to a `funcaoId` deterministically.
9. Keep the two backfill `UPDATE`s **contiguous and immediately after** the `set_config` line, with the first `ALTER TABLE ... ADD CONSTRAINT ... CHECK` as the next statement. The integration replay test slices the shipped SQL from the `set_config` statement up to the first `ADD CONSTRAINT`, following the idiom at `apps/api/test/rls/proposal-schema-migration.test.ts:99-115`; replaying the CHECK statements too would fail with "constraint already exists" once the real migration has run. This layout is load-bearing for the test, so do not interleave anything between them.
10. Apply with `pnpm --filter @fxl-sales/api db:migrate`. There are no down migrations, per the repo convention.

## API contract

Every endpoint below is mounted at `/api/v1/sales-ops` behind `appAuthMiddleware` (`server.ts:74`).
`orgId` always comes from `c.get('orgId')` and is never read from a request body.
Every query and every write filters `eq(salesOpsProducts.orgId, c.get('orgId'))` and `eq(salesOpsProductFuncaoCosts.orgId, c.get('orgId'))` inside `withTenant`, which also sets the RLS session context.

Auth gate note: the product endpoints carry **no `requireAdmin`** today, unlike `/people` (`routes.ts:61`). This slice does not change that. Tightening it would break the current app's product dialog for non-admins and is a separate decision, recorded in `## Risks`.

### `GET /products`

- Auth: `appAuthMiddleware`.
- Request: none.
- Response 200: `{ products: ProductRow[], productFuncaoCosts: ProductFuncaoCostRow[] }`.
- `products` ordered by `name` (unchanged). `productFuncaoCosts` is every cost row for the org, ordered by `(productId, funcaoId)`.
- Additive change: the existing `{ products }` key keeps its exact shape apart from `type` becoming `kind` and the six new default columns.

### `POST /products`

- Auth: `appAuthMiddleware`.
- Request body: `ProductSchema` (see `## Default config shape`). `areaId` is required. `kind` defaults to `'product'`; `openPrice` is accepted as the deprecated alias.
- Pre-checks, in order, each returning `400`:
  1. `ProductSchema.safeParse` failure -> `{ error: 'validation_error', issues }`.
  2. `getArea(db, orgId, areaId)` null -> `{ error: 'validation_error', reason: 'unknown_area' }` (existing behaviour, `routes.ts:90`).
  3. `getFuncoesByIds(db, orgId, funcaoIds)` does not return every requested id -> `{ error: 'validation_error', reason: 'unknown_funcao', funcaoId }`. **This is the tenancy gate.** Without it a caller could paste another org's `funcaoId` and read back its existence. The reason code is deliberately identical to the one slice 05 returns from `resolvePersonFuncoes`, so the two surfaces fail the same way. The composite FK is the in-transaction backstop for the residual race window, so a genuine race surfaces as a 500 rather than a leak.
- Write, in one `withTenant` transaction: insert the product with `kind` resolved by `resolveProductKind`, `openPrice: kind === 'service'`, and the numeric columns stringified exactly as `createProduct` already does at `service.ts:676-682`; then insert the cost rows with `orgId` and `productId` set server-side.
- Response 201: `{ product: ProductRow, productFuncaoCosts: ProductFuncaoCostRow[] }`.

### `PATCH /products/:id`

- Auth: `appAuthMiddleware`.
- Request body: `UpdateProductSchema` (`ProductFieldsSchema.partial().superRefine(...)`). `routes.ts:97` changes from `ProductSchema.partial()` to `UpdateProductSchema`, because a `.superRefine`-wrapped schema is a `ZodEffects` and has no `.partial()`.
- Semantics:
  - Any omitted field is left unchanged (`undefined` is skipped by drizzle `.set()`).
  - `defaultRecurringCycles: null` explicitly means indefinite; omitting it leaves the stored value.
  - `productFuncaoCosts` omitted -> the cost set is untouched. Present -> **full replace** for that product (`DELETE ... WHERE org_id = $org AND product_id = $id`, then insert). `[]` clears the set.
- Pre-checks: the `unknown_area` check (existing, `routes.ts:101-104`) and the `unknown_funcao` check, both as above.
- Merged-row invariant check, inside the transaction: read the current row, merge the patch, and re-run `validateProductFields` on the merged result. This catches the case a partial payload cannot see, for example `PATCH { kind: 'service' }` against a row that stores `setupBrl: 5000`. On failure the service returns the sentinel `'invalid_product_kind_value'`, mirroring the `createArea` -> `'duplicate'` sentinel idiom (`service.ts:806`), and the route maps it to `400 { error: 'validation_error', reason: 'service_cannot_have_fixed_value' }`. The write is rejected, never silently corrected.
- Responses: `200 { product, productFuncaoCosts }`; `404 { error: 'not_found' }` when the id is not in the caller's org; `400` as above.

### `GET /bootstrap`

- Auth: `appAuthMiddleware`.
- Response 200: the existing snapshot object plus one new key.
  ```
  { sales, products, clients, people, payables, saleItems, areas, receivables,
    saleProfessionals, productFuncaoCosts, settings }
  ```
- `getSalesOpsSnapshot` (`service.ts:1300`) gains one org-filtered `select()` on `salesOpsProductFuncaoCosts`, placed with the other flat arrays.
- Slice 05 separately adds `funcoes` and `personFuncoes` to the same payload; the two additions do not collide.

### Unchanged

`POST /sales` and `PUT /sales/:id` keep their exact request shapes. `SaleItemSchema` still ignores the web's `productType` field, and `resolveSaleItemContexts` still derives `productTypeSnapshot` server-side, now from `kind`. Slice 12 owns proposta-level overrides.

## Compatibility matrix

| Consumer | Anchor | Effect | Verdict |
| --- | --- | --- | --- |
| `getSalesOpsSnapshot` products select | `service.ts:1307` | `select()` picks up `kind` and the six default columns, loses `type` | OK, additive plus the rename |
| `listProducts` | `service.ts:659` | same | OK |
| `createProduct` / `updateProduct` | `service.ts:669` / `:689` | extended; numeric stringification and `withTenant` unchanged | OK |
| `resolveSaleItemContexts` | `service.ts:299`, `:330` | reads `.kind` instead of `.type`; new sale items snapshot `'product'` / `'service'` | OK, `product_type_snapshot` column and historical values untouched |
| free-form item context | `service.ts:334` | still writes `''` | OK, unchanged |
| `buildSaleLedger` items map | `service.ts:439` | still copies `itemContexts[i].productTypeSnapshot` | OK |
| open-price item label path | `items[].productName` -> `productNameSnapshot` | untouched; `productId` still preserved | OK, no parallel description field, per `CLAUDE.md` |
| `summarizeSalesOpsState` counts | `service.ts:613` | uses `snapshot.products.length` only | OK |
| `validatePaymentPlan` | `service.ts:161` | untouched; the template algorithm is specified to produce exact sums | OK |
| `formatProductCommission` | `SalesOpsApp.tsx:1978`, used `:2048-2055` | reads the six commission columns, all unchanged | OK, zero change |
| `resolveSaleCommissionDefaults` | `calculations.ts:45` | same six columns | OK, zero change |
| `commissionDefaultsSourceKey` | `SalesOpsApp.tsx:3513` | same six columns | OK, zero change |
| product list cells | `SalesOpsApp.tsx:2038-2065` | read `openPrice`, `setupBrl`, `hasMonthly`, `monthlyBrl`, `recurringCommission` | OK, `openPrice` still present with identical meaning |
| product dialog submit | `SalesOpsApp.tsx:2639-2668` | still sends `openPrice` and no `kind` | OK, accepted as the deprecated alias, so no regression window before slice 10 |
| wizard item price seeding and validation | `SalesOpsApp.tsx:3585, 3729, 3833-3835, 3940, 3953, 3972, 4430-4432, 4495` | all read `openPrice` | OK, zero change |
| `SalesOpsApp.tsx` item payload | `:4104` `product?.type ?? 'SaaS'` | must become `product?.kind ?? 'product'`; the value is stripped by `SaleItemSchema` and only feeds `calculations.ts:184` | forced one-line edit |
| `SalesOpsProduct` web type | `types.ts:35` | `type: string` becomes `kind: 'product' \| 'service'`, plus the six read-only default fields | forced edit |
| `SaveProductPayload` | `api.ts:22` | derived from `Partial<SalesOpsProduct>`, so it follows automatically. It gains no `productFuncaoCosts` write field in this slice | OK, slice 10 adds the write field |
| `apiFetch<{ product: SalesOpsProduct }>` | `api.ts:77` | the response gains a `productFuncaoCosts` key the web type does not declare, which TypeScript ignores | OK |
| `SalesOpsBootstrap` web type and `hooks.ts:28` select | `types.ts:184`, `hooks.ts:28` | the `select` is an explicit allow-list, so `productFuncaoCosts` is dropped before reaching components | **deliberate**: not added here. Declaring it would force edits in `emptyBootstrap` (`SalesOpsApp.tsx:122`) plus eleven test literals for zero behaviour. Slice 10 adds the type field, the `select` entry and the consumers together |
| web product fixtures carrying `type:` | `areas-view.test.tsx:45`, `product-commission-editor.test.tsx:44`, `sale-wizard-commission-defaults.test.tsx:43`, `sale-wizard-custom-item-labels.test.tsx:44`, `sale-wizard-edit.test.tsx:81`, `sale-wizard-free-items.test.tsx:39`, `sale-wizard-payment-plan.test.tsx:39` | object literals against `SalesOpsProduct`, so TypeScript rejects the stale key | forced mechanical edit, seven sites |
| web fixtures asserting `productTypeSnapshot: 'SaaS'` | `sale-wizard-edit.test.tsx:164`, `sales-view.test.tsx:169` | they construct input fixtures, they do not assert server output | OK, keep passing |
| `product-commission-contract.test.ts` migration assertions | `apps/api/.../product-commission-contract.test.ts:62-95` | scoped to reading `drizzle/0009_...sql`, including its `not.toMatch(/DROP COLUMN/i)` | OK, unaffected by a new migration file |
| RLS policies on `sales_ops_products` | `0007:194`, `0008:153` | untouched; the rename does not affect a policy that keys on `org_id` | OK |
| `providers` jsonb column | `schema.ts:495`, `service.ts:58` | kept and still accepted and returned, annotated `@deprecated`; superseded by `productFuncaoCosts` but not dropped | OK, see Decision 4 |
| providers editor in the product dialog | `SalesOpsApp.tsx:2418`, `:2447-2452`, `:2660-2666` | keeps working byte for byte | OK, removed in slice 10 |
| `sales_ops_funcoes` and `sales_ops_person_funcoes` | slice 05 | read-only dependency: this slice references `(org_id, id)` and never writes either table | OK |
| `sales_ops_funcoes_org_id_id_idx` | declared by slice 05 | reused as this slice's composite-FK target, not re-declared | OK |
| slice 05's `funcoes` / `personFuncoes` bootstrap keys | slice 05 `## API contract` | sibling keys to `productFuncaoCosts`, no name or shape collision | OK |
| slice 05's `unknown_funcao` reason code | slice 05 `resolvePersonFuncoes` | reused verbatim for the same failure on the product endpoints | OK, deliberate consistency |
| slice 05's derived `is_seller` / `is_finder` / `is_collaborator` mirrors | `schema.ts:440-442` | untouched by this slice | OK |

## Red

Write these first and watch them fail.

### `apps/api/src/domains/sales-ops/__tests__/produtos-servicos-contract.test.ts`

Idiom: `areas-contract.test.ts` and `product-commission-contract.test.ts`, importing the schemas from `../service.js` with a `completeProduct` fixture.

1. `'defaults a product payload to kind product with openPrice false'` - `ProductSchema.parse(completeProduct)` yields `kind` resolvable to `'product'` via `resolveProductKind`, `defaultPaymentMethod: 'pix'`, `defaultEntradaMode: 'none'`, `defaultRemainingInstallments: 1`.
2. `'accepts a servico with no own value'` - `{ ...completeProduct, kind: 'service', setupBrl: 0, monthlyBrl: 0 }` parses, and `resolveProductKind` returns `'service'`.
3. `'rejects a servico carrying a fixed own value'` - `{ kind: 'service', setupBrl: 5000 }` fails, and `{ kind: 'service', hasMonthly: true, monthlyBrl: 5000 }` fails. This is the design-mandated rejection: a serviço's value is always variable.
4. `'accepts the legacy openPrice alias and maps it to kind service'` - `{ ...completeProduct, openPrice: true }` parses and `resolveProductKind` returns `'service'`; `{ openPrice: false }` returns `'product'`.
5. `'rejects a kind and openPrice contradiction'` - `{ kind: 'product', openPrice: true }` and `{ kind: 'service', openPrice: false }` both fail.
6. `'accepts a pct funcao cost and a fix funcao cost in one payload'` - `productFuncaoCosts: [{ funcaoId, mode: 'pct', valuePct: 5 }, { funcaoId2, mode: 'fix', valueBrl: 30000 }]` parses, and `valueBrl` is asserted as cents (30000, not 300).
7. `'rejects a funcao cost that mixes units'` - `{ mode: 'pct', valueBrl: 30000 }` fails, `{ mode: 'fix', valuePct: 5 }` fails, `{ mode: 'pct' }` with no value fails.
8. `'rejects duplicate funcaoId rows'` - two rows with the same `funcaoId` fail with `duplicate_funcao_cost`.
9. `'validates the entrada mode and value pairing'` - `'none'` with `defaultEntradaPct: 50` fails; `'pct'` with no `defaultEntradaPct` fails; `'fix'` with `defaultEntradaPct` instead of `defaultEntradaBrl` fails; `'pct'` with `defaultEntradaPct: 50` succeeds.
10. `'bounds the default installment count and recurring cycles'` - `defaultRemainingInstallments: 0` and `121` fail; `defaultRecurringCycles: 0` and `121` fail; `defaultRecurringCycles: null` succeeds and means indefinite.
11. `'UpdateProductSchema partials every field while keeping the invariants'` - `UpdateProductSchema.safeParse({ name: 'x' }).success` is `true`; `UpdateProductSchema.safeParse({ kind: 'service', setupBrl: 100 }).success` is `false`.

### `apps/api/src/domains/sales-ops/__tests__/default-payment-plan.test.ts`

12. `'entrada 50 percent plus restante 3x yields four rows summing to the total'` - `totalBrl: 100000`, `defaultEntradaMode: 'pct'`, `defaultEntradaPct: '50.00'`, `defaultRemainingInstallments: 3` gives amounts `[50000, 16668, 16666, 16666]` summing to `100000`, with due dates `[base, +1m, +2m, +3m]`. This is the batch-level acceptance case.
13. `'no entrada with one parcela reproduces the cash plan on the base date'` - `totalBrl: 100000`, mode `'none'`, `1` gives one row `{ dueDate: baseDate, amountBrl: 100000, method: 'pix' }`, byte-identical to today's `planAuto` behaviour.
14. `'gives the rounding remainder to the first restante parcela'` - `totalBrl: 99999`, mode `'fix'`, `defaultEntradaBrl: 30000`, `2` gives `[30000, 35000, 34999]`.
15. `'clamps a fixed entrada to the proposta total and emits no zero parcela'` - `totalBrl: 50000`, mode `'fix'`, `defaultEntradaBrl: 80000`, `3` gives exactly `[50000]`.
16. `'emits an indefinite recurring block when defaultRecurringCycles is null'` - `hasMonthly: true`, `monthlyBrl: 9900`, `defaultRecurringCycles: null` gives `recurring.cycles === null` and `recurring.startDate === addMonths(baseDate, 1)`; `hasMonthly: false` gives `recurring === null`.
17. `'every generated plan satisfies the API installments sum rule'` - feed each vector's `installments` plus a matching single item into `CreateSaleSchema.safeParse` and assert `success` is `true`, so the template can never generate a plan the write endpoint rejects.

### `apps/api/src/domains/sales-ops/__tests__/produtos-servicos-migration.test.ts`

Migration-text oracle, following `areas-contract.test.ts:37-71`. Reads `drizzle/0013_produtos_servicos_defaults.sql`.

18. `'renames type to kind and backfills from open_price before adding the CHECK constraints'` - asserts `RENAME COLUMN "type" TO "kind"`, no `DROP COLUMN "type"`, `indexOf(set_config admin) < indexOf(UPDATE "sales_ops_products")`, and `indexOf(sales_ops_products_kind_open_price_check) > indexOf(UPDATE)`.
19. `'zeroes the own value of every open-price row before enforcing the servico invariant'` - asserts the `SET "setup_brl" = 0, "monthly_brl" = 0 WHERE "open_price"` statement exists and precedes `sales_ops_products_service_no_fixed_value_check`.
20. `'creates the funcao cost child table with forced RLS and both policies'` - asserts `CREATE TABLE "sales_ops_product_funcao_costs"`, `ENABLE ROW LEVEL SECURITY` then `FORCE ROW LEVEL SECURITY`, `sales_ops_product_funcao_costs_tenant_isolation`, `sales_ops_product_funcao_costs_admin_context`.
21. `'binds funcao costs to the caller org through a composite foreign key'` - asserts `FOREIGN KEY ("org_id","funcao_id") REFERENCES "public"."sales_ops_funcoes"("org_id","id")` with `ON DELETE restrict`, and asserts this migration does **not** contain `CREATE UNIQUE INDEX "sales_ops_funcoes_org_id_id_idx"`, because slice 05's `0012` owns it.
22. `'never uses a session-scoped admin config'` - `expect(migration).not.toMatch(/set_config\('app\.fxl_admin',\s*'true',\s*false\)/i)`.
23. `'does not migrate or drop the deprecated providers column'` - asserts the migration contains neither `DROP COLUMN "providers"` nor any `INSERT INTO "sales_ops_product_funcao_costs"`, pinning Decision 4's no-backfill rule.
24. `'keeps the backfill updates contiguous between set_config and the first CHECK constraint'` - splits on `--> statement-breakpoint` and asserts that every statement between the `set_config` index and the first `ADD CONSTRAINT` index is an `UPDATE "sales_ops_products"`. This is the layout the replay test in test 25 depends on.

### `apps/api/test/rls/produtos-servicos-schema-migration.test.ts`

Shipped-SQL replay oracle, following `apps/api/test/rls/proposal-schema-migration.test.ts:96-115`: read `drizzle/0013_*.sql`, split on `--> statement-breakpoint`, slice from the statement containing `set_config('app.fxl_admin'` up to (and excluding) the first statement containing `ADD CONSTRAINT`, and execute that slice inside one `adminClient.begin`.
This proves the backfill against real rows, which the text assertions in tests 18-24 cannot do.
Root `pnpm test` does not run this file, which is exactly why tests 18-24 exist as well.

25. `'backfills kind from open_price for real rows'` - insert, through the admin client, one product with `open_price = true` and one with `open_price = false`, both with `kind` reset to the pre-migration value; replay the backfill; assert `kind` is `'service'` and `'product'` respectively.
26. `'zeroes the own value of an open-price row without touching a fixed-price row'` - insert an `open_price = true` row carrying `setup_brl = 250000` and `monthly_brl = 9900` plus an `open_price = false` row carrying the same amounts; replay; assert the first is zeroed and the second is byte-identical.
27. `'is idempotent when the backfill is replayed'` - replay twice and assert identical rows, mirroring slice 05's idempotency test.
28. `'leaves every product commission column and the providers jsonb intact'` - the no-regression oracle: assert the six commission columns, `modules`, `providers`, `code_suffix`, `area_id` and `status` are unchanged across the replay.

### `apps/api/test/rls/product-funcao-costs-rls.test.ts`

Idiom: `areas-rls.test.ts`, including the `withRole` non-superuser probe-role helper and the `adminClient` cleanup in `afterAll`.
Cleanup order matters: delete `sales_ops_product_funcao_costs`, then `sales_ops_products`, then `sales_ops_funcoes`, then `sales_ops_areas`, or the composite `restrict` FK blocks the teardown.

29. `'funcao cost defaults round-trip through create, patch and bootstrap'` - create an área, two funções and a Serviço with two cost rows; assert `createProduct` returns both; `PATCH` with a one-row list replaces the set; `PATCH` without the key leaves it; `PATCH` with `[]` clears it; `getSalesOpsSnapshot(db, orgA).productFuncaoCosts` equals `listProducts`-side expectations and `getSalesOpsSnapshot(db, orgB).productFuncaoCosts` is `[]`.
30. `'rejects a funcao id owned by another org'` - a `funcaoId` created in `orgB` used on an `orgA` product returns the `unknown_funcao` outcome from the service, and a raw insert of the cross-org pair is rejected by `sales_ops_product_funcao_costs_org_funcao_fk`. This is the tenancy oracle.
31. `'a servico cannot be given a fixed own value through PATCH'` - `updateProduct(db, orgA, id, { setupBrl: 5000 })` on a `kind: 'service'` row returns the `'invalid_product_kind_value'` sentinel, and a raw `UPDATE` bypassing the service is rejected by `sales_ops_products_service_no_fixed_value_check`.
32. `'openPrice stays equal to kind service in the database'` - a raw `UPDATE ... SET open_price = false WHERE kind = 'service'` is rejected by `sales_ops_products_kind_open_price_check`.
33. `'a funcao still used as a product cost default cannot be deleted'` - a raw `DELETE FROM sales_ops_funcoes` for an assigned função is rejected by the `restrict` composite FK, which is the detection the jsonb design could not offer.
34. `'raw RLS blocks cross-org reads and smuggled inserts on sales_ops_product_funcao_costs'` - the `areas-rls.test.ts:120` probe-role pattern: `CREATE ROLE ... NOSUPERUSER NOBYPASSRLS`, grant on `sales_ops_product_funcao_costs`, insert under `app.current_org_id = ORG_A`, read back under `ORG_B` gives zero rows, an insert with a smuggled `org_id = ORG_B` rejects, then `DROP OWNED BY` / `DROP ROLE` in the `finally`.
35. `'a new sale item snapshots the product kind'` - `createSale` with a Serviço item persists `productTypeSnapshot === 'service'`, and with a Produto item `'product'`.

### Oracle commands

```bash
# 0. The local Docker test DB must be up. The integration suite is pinned to it through
#    TEST_DATABASE_URL / TEST_MIGRATE_DATABASE_URL / ADMIN_DATABASE_URL in apps/api/.env,
#    connecting as the non-superuser fxl_sales_test role so RLS is genuinely enforced.
docker compose up -d

# 1. Static gates.
pnpm run lint
pnpm run type-check

# 2. Unit suite (does NOT run test/rls/**), plus the tracked-file guard.
CI=true pnpm test

# 3. Apply the new migration to the local test DB.
pnpm --filter @fxl-sales/api db:migrate

# 4. DB-backed suite: RLS, tenancy, and the shipped-SQL backfill replay.
pnpm --filter @fxl-sales/api test:integration

# 5. Production build.
pnpm run build
```

Single-file forms while iterating. Note that `pnpm --filter <pkg> test -- --run <path>` does **not** filter - pnpm swallows the positional argument and the whole suite runs - so use `exec vitest run` directly:

```bash
# one API unit file (path relative to apps/api)
CI=true pnpm --filter @fxl-sales/api exec vitest run \
  src/domains/sales-ops/__tests__/produtos-servicos-contract.test.ts
CI=true pnpm --filter @fxl-sales/api exec vitest run \
  src/domains/sales-ops/__tests__/default-payment-plan.test.ts

# one API integration file (needs the local Docker test DB up)
VITEST_INTEGRATION=1 CI=true pnpm --filter @fxl-sales/api exec vitest run \
  test/rls/product-funcao-costs-rls.test.ts
VITEST_INTEGRATION=1 CI=true pnpm --filter @fxl-sales/api exec vitest run \
  test/rls/produtos-servicos-schema-migration.test.ts
```

All six numbered commands must exit 0.
`CI=true pnpm test` must stay green on its own: it does not run `test/rls/**`, so tests 1-24 are the gate that protects the root suite from a broken migration.

## Green

1. Confirm slice 05 has landed: `apps/api/drizzle/meta/_journal.json` newest entry is `idx: 12`, `tag: "0012_sales_ops_funcoes"`, `schema.ts` exports `salesOpsFuncoes` with `uniqueIndex('sales_ops_funcoes_org_id_id_idx')`, and `foreignKey` is already in the `drizzle-orm/pg-core` import list. Reconcile any name drift before touching anything else.
2. `apps/api/src/db/schema.ts` - rewrite `salesOpsProducts` (`:462`) per `## Target schema`: `type` becomes `kind` with default `'product'`, add the six `default*` columns, add the six `check()` entries, and annotate `providers` (`:495`) `@deprecated - superseded by sales_ops_product_funcao_costs; drop after slice 10 lands`.
3. `apps/api/src/db/schema.ts` - add `salesOpsProductFuncaoCosts` immediately after `salesOpsProducts`, with the composite `(org_id, funcao_id)` FK `.onDelete('restrict')`.
4. `pnpm --filter @fxl-sales/api db:generate`, answering the rename prompt with `~ type › kind rename column`.
5. Rename the emitted SQL to `0013_produtos_servicos_defaults.sql`, set the `tag` for `idx: 13` in `apps/api/drizzle/meta/_journal.json`, and confirm its `when` is greater than 0012's.
6. Hand-edit the SQL into the four-block order from `## Migration plan` step 4: DDL, admin-context backfill, CHECKs, RLS. Keep the two `UPDATE`s contiguous between `set_config` and the first `ADD CONSTRAINT` (test 24 and the replay in tests 25-28 depend on that layout). Delete any `CREATE UNIQUE INDEX "sales_ops_funcoes_org_id_id_idx"` drizzle may re-emit, since 0012 owns it.
7. `pnpm --filter @fxl-sales/api db:migrate` against the local test DB.
8. `apps/api/src/domains/sales-ops/service.ts` - add `ProductKindSchema`, `ProductEntradaModeSchema`, `ProductFuncaoCostSchema`, `validateProductFields`, `ProductFieldsSchema`, `ProductSchema`, `UpdateProductSchema`, `ProductFuncaoCostInput`; delete the old `ProductSchema` object (`:64-84`) and its `type` field.
9. `apps/api/src/domains/sales-ops/service.ts` - add `resolveProductKind` and `materializeDefaultPaymentPlan` (reusing the existing `addMonths`).
10. `apps/api/src/domains/sales-ops/service.ts` - add `getFuncoesByIds(db, orgId, ids)` returning the resolved rows, and `listProductFuncaoCosts(db, orgId, productId?)`. If slice 05's `resolvePersonFuncoes` already contains an equivalent id-verification block, extract it into `getFuncoesByIds` and call it from both rather than writing a second copy.
11. `apps/api/src/domains/sales-ops/service.ts` - extend `createProduct` (`:669`): resolve `kind`, set `openPrice`, write the new columns, insert cost rows in the same `withTenant` transaction, return `{ product, productFuncaoCosts }`.
12. `apps/api/src/domains/sales-ops/service.ts` - extend `updateProduct` (`:689`): read the current row, merge, re-run `validateProductFields`, return the `'invalid_product_kind_value'` sentinel on failure, otherwise write `kind` plus the derived `openPrice`, and full-replace the cost rows only when `productFuncaoCosts` is present. Return `{ product, productFuncaoCosts }` or `null`.
13. `apps/api/src/domains/sales-ops/service.ts` - change `resolveSaleItemContexts` (`:299`, `:330`) to select and snapshot `salesOpsProducts.kind`.
14. `apps/api/src/domains/sales-ops/service.ts` - add the `salesOpsProductFuncaoCosts` select to `getSalesOpsSnapshot` (`:1300`) and the `productFuncaoCosts` key to its return object.
15. `apps/api/src/domains/sales-ops/routes.ts` - `GET /products` (`:80`) returns `{ products, productFuncaoCosts }`.
16. `apps/api/src/domains/sales-ops/routes.ts` - `POST /products` (`:85`) adds the `unknown_funcao` pre-check after the existing `unknown_area` check and returns the two-key body with 201.
17. `apps/api/src/domains/sales-ops/routes.ts` - `PATCH /products/:id` (`:96`) swaps `ProductSchema.partial()` for `UpdateProductSchema`, adds the `unknown_funcao` pre-check, and maps the `'invalid_product_kind_value'` sentinel to `400 { error: 'validation_error', reason: 'service_cannot_have_fixed_value' }`.
18. `apps/api/src/domains/sales-ops/routes.ts` - update the import list from `./service.js` (`UpdateProductSchema`, `getFuncoesByIds`).
19. `apps/web/src/sales-ops/types.ts:35` - `type: string` becomes `kind: 'product' | 'service'`; add the six read-only default fields to `SalesOpsProduct`; add the `SalesOpsProductFuncaoCost` type. Do **not** touch `SalesOpsBootstrap`.
20. `apps/web/src/sales-ops/SalesOpsApp.tsx:4104` - `product?.type ?? 'SaaS'` becomes `product?.kind ?? 'product'`.
21. Update the seven web product fixtures listed in the compatibility matrix: `type: 'SaaS'` becomes `kind: 'product'`, and `sale-wizard-custom-item-labels.test.tsx:44`'s `type: openPrice ? 'Custom' : 'SaaS'` becomes `kind: openPrice ? 'service' : 'product'`.
22. Run every oracle command from `## Red`.

## Refactor

- Collapse the repeated `String(value)` numeric coercion in `createProduct` and `updateProduct` into one small `numericColumns(patch)` helper, so the six commission columns plus `defaultEntradaPct` share one code path instead of seven inline ternaries.
- Extract the `unknown_area` and `unknown_funcao` pre-checks from `POST` and `PATCH` into one `resolveProductRefs(db, orgId, data)` helper returning a discriminated result, so the two routes stop duplicating the guard.
- Move the `withTenant` + merged-row-invariant pattern in `updateProduct` next to `createArea`'s sentinel idiom and document the sentinel union in one place, since a third sentinel now exists.

## Out of scope

- Any UI. The `Produtos & Serviços` screen rename, the `Produto | Serviço` toggle, the default-config form sections and the função cost editor are slice 10.
- The payment-plan builder UI and the web mirror of `materializeDefaultPaymentPlan` in `apps/web/src/sales-ops/calculations.ts` are slice 11, which must match the vectors in `## Red` tests 12-17 exactly.
- Proposta-level overrides of any default, including the per-item função costs, are slice 12.
- Adding `productFuncaoCosts` to the web `SalesOpsBootstrap` type, the `hooks.ts:28` allow-list `select`, `emptyBootstrap` and the eleven bootstrap test literals is slice 10.
- Adding a `productFuncaoCosts` write field to `SaveProductPayload` is slice 10.
- The optional service description field is slice 08.
- Normalizing the six `*_commission_value numeric(10,2)` columns, which store `fix` amounts in reais rather than cents in violation of `schema.ts:15`, is a separate slice. This slice does not extend the smell: the new `value_brl` is integer cents.
- Putting `requireAdmin` on the product endpoints.
- **Dropping** the `providers` jsonb column, `ProductProviderSchema` or the providers editor. This slice supersedes `providers` with `productFuncaoCosts` and marks it deprecated (Decision 4); slice 10 removes the editor and stops sending it; a later contract slice drops the column. There is deliberately no `providers` to `productFuncaoCosts` backfill, because `personName` has no deterministic mapping to a `funcaoId`.
- Migrating `modules` off jsonb onto a real child table.
- Any write to `sales_ops_funcoes` or `sales_ops_person_funcoes`. This slice only reads funções by `(org_id, id)`; the funções cadastro and its endpoints belong to slice 05.
- Any change to the propostas status machine, the payables and receivables materialization rules, or the `"N/M"` and `"MN/M"` label conventions.

## Risks

1. **Slice 05 is planned but not yet landed.** Names here are reconciled against `nexo/plans/batch-01K9C0FXA7RQ8VZTN3KDM6WS4E/05-pessoas-funcoes-api.md` (table `sales_ops_funcoes` with `id` / `org_id` / `name` / `slug` / `is_system` / `status`, plus `uniqueIndex('sales_ops_funcoes_org_id_id_idx')`), so they are no longer guesses. The residual risk is that 05 drifts during execution. Mitigation: every dependency on 05 is concentrated in three places - the `salesOpsFuncoes` reference in the composite FK, `getFuncoesByIds`, and the migration's FK statement. Green step 1 is an explicit reconciliation check before any edit.
2. **Migration number depends on slice 05 landing first.** If 05 slips, this migration cannot be numbered or applied, because both the FK target table and its `(org_id, id)` unique index live in `0012`. Mitigation: `depends_on: [05-pessoas-funcoes-api]` plus serial-on-master execution, and Green step 1 re-reads `_journal.json`.
3. **`drizzle-kit` may re-emit `sales_ops_funcoes_org_id_id_idx`.** If it does, `db:migrate` fails with "relation already exists". Mitigation: Green step 6 deletes that statement, and test 21 asserts the shipped SQL does not contain it. Do not "fix" a duplicate by adding `IF NOT EXISTS`, because that hides real drift in slice 05's snapshot.
4. **Deleting a função that is a product cost default now fails.** The `restrict` composite FK is deliberate and matches slice 05's own função-side `restrict`, and in practice it never fires because `salesOpsRouter` has no DELETE verb and funções are archived through `status`. Mitigation: test 33 pins the behaviour so it is a documented refusal rather than a surprise, and the integration teardown order is spelled out in `## Red` so cleanup does not trip over it.
5. **`providers` and `productFuncaoCosts` coexist until slice 10.** Two mechanisms for "who gets paid for this product" are visible in the payload at the same time, which is a real if temporary overlap. Mitigation: `providers` is annotated `@deprecated` in `schema.ts`, the deprecation is staged explicitly in Decision 4, and test 23 asserts this migration neither drops nor backfills it, so the removal happens deliberately in a later slice rather than by accident here. Flag to the human: the operator will briefly see both editors in slice 10's dialog work unless slice 10 removes the providers section, which its plan must do.
6. **`drizzle-kit generate` prompts interactively on the rename.** Answering "create column" instead of "rename column" would emit `DROP COLUMN "type"` plus `ADD COLUMN "kind"`, silently discarding the source of the `kind` backfill and leaving every product as `'product'`, including the Serviços. Mitigation: test 18 asserts `RENAME COLUMN` is present and `DROP COLUMN "type"` is absent, so a wrong answer fails the unit suite before the migration is applied anywhere.
7. **The CHECK constraints are emitted before the backfill.** `drizzle-kit` puts them with the DDL, so an unedited file fails on any existing open-price row with a non-zero `setup_brl`. Mitigation: `## Migration plan` step 4 makes the reordering explicit, and tests 18 and 19 assert the ordering by string index, exactly as `areas-contract.test.ts:63-67` does.
8. **The backfill zeroes `setup_brl` and `monthly_brl` on open-price rows.** This is data modification. Mitigation: the values were already unreachable in every read path (`SalesOpsApp.tsx:2038`, `:2042`, `:3729`, `:3953`, `:3972`) and already forced to zero on write by the dialog (`:2645`, `:2647`). Before running the migration on staging or production, run `SELECT id, name, setup_brl, monthly_brl FROM sales_ops_products WHERE open_price AND (setup_brl <> 0 OR monthly_brl <> 0)` and record the result in the run notes. If any row is a surprise, stop and escalate rather than dropping the CHECK.
9. **Cross-org `funcaoId` is a genuine tenancy hole if the pre-check is skipped.** RLS `WITH CHECK` only validates the child row's own `org_id`, which the server sets, so it does not stop a foreign `funcao_id` on its own. Mitigation: three independent layers - the route-level `unknown_funcao` pre-check, the composite FK, and integration test 30 which exercises both. The pre-check must be added to `POST` and `PATCH`, not just one of them.
10. **The `unknown_funcao` pre-check sits outside the write transaction**, mirroring the existing `unknown_area` check, so there is a narrow TOCTOU window. Mitigation: the composite FK converts that window from a data leak into a 500, which is acceptable and rare. Do not "fix" it by dropping the FK.
11. **The test role may lack privileges on the new table.** `ALTER DEFAULT PRIVILEGES` covers new tables only when the grantor matches the creating role. If `test:integration` fails with `permission denied for table sales_ops_product_funcao_costs`, run the GRANT documented in `nexo/knowledge/decisions/2026-07-29-integration-tests-are-hermetic-local.md` for `fxl_sales_test`. This is local provisioning, not an application migration.
12. **`ProductSchema.partial()` no longer exists.** Wrapping the base object in `.superRefine` produces a `ZodEffects`, and `routes.ts:97` currently calls `.partial()` on it. Missing that turns into a type error rather than a runtime surprise, and `pnpm run type-check` catches it. The `PersonFieldsSchema` split at `service.ts:26-50` is the pattern to copy.
13. **`materializeDefaultPaymentPlan` has no runtime caller in this slice.** It is a normative reference implementation whose consumer is slice 11's web mirror. Justification: a markdown spec drifts, a tested pure function does not, and `buildSaleLedger` establishes the precedent of pure exported ledger logic living in the service module. The longer-term home is `packages/shared-utils`, so both apps can import one copy, but `apps/web` does not yet import that package at all and wiring its `dist` build into the web vitest run is out of scope here. Revisit when slice 11 lands.
14. **Two money conventions become visible side by side.** A `fix` product commission is stored as reais in `numeric(10,2)` and rendered by `formatProductCommission` (`SalesOpsApp.tsx:1978`), while a `fix` função cost is stored as integer cents. Mitigation: this slice follows the binding convention at `schema.ts:15` rather than extending the pre-existing wart, and slice 10's editor must convert cents for display. Normalizing the six commission columns is listed in `## Out of scope`.
15. **New sale items start snapshotting `'product'` / `'service'` in `product_type_snapshot` while historical rows hold `'SaaS'` or `''`.** Mitigation: nothing renders the column (verified: only test fixtures reference `productTypeSnapshot`), and the two web tests that mention `'SaaS'` construct input fixtures rather than asserting output. If a future report reads the column, it must treat it as a heterogeneous history, which is already true of the `''` free-form rows.
16. **Atomicity.** This lands as one commit. The backend change and the web `type` -> `kind` rename cannot be split, because removing the column breaks `apps/web` type-check in the same tree. If the commit must be split for review, the only safe boundary is: (a) schema, migration, service, routes, API tests, plus the web rename in the same commit, then (b) nothing. There is no valid two-commit split that leaves `pnpm run type-check` green in between, so keep it atomic.
