---
id: 07-servico-base-value
milestone: v2.3.0
status: todo
depends_on: []
files_modified:
  - apps/api/drizzle/0015_servico_base_value.sql
  - apps/api/drizzle/meta/0015_snapshot.json
  - apps/api/drizzle/meta/_journal.json
  - apps/api/src/db/schema.ts
  - apps/api/src/domains/sales-ops/service.ts
  - apps/api/src/domains/sales-ops/routes.ts
  - apps/api/src/domains/sales-ops/__tests__/produtos-servicos-contract.test.ts
  - apps/api/test/rls/product-funcao-costs-rls.test.ts
  - apps/api/test/rls/produtos-servicos-schema-migration.test.ts
  - apps/web/src/sales-ops/calculations.ts
  - apps/web/src/sales-ops/SalesOpsApp.tsx
  - apps/web/src/sales-ops/__tests__/product-service-dialog.test.tsx
  - apps/web/src/sales-ops/__tests__/produtos-servicos-view.test.tsx
  - CLAUDE.md
acceptance: "given a Serviço in cadastros/produtos, when the operator types a base value into `Valor base (R$)` (and optionally a mensalidade) and saves, then the value persists on `sales_ops_products.setup_brl`/`monthly_brl`, the list `Valor` column prints it instead of `Variável`, and the proposta wizard prefills it as the item's editable unit price - while a Serviço left at 0 keeps today's behavior exactly: `Variável` in the list, a 0 prefill in the wizard, and the negotiated-value requirement still blocking step 1."
---

# 07 - Serviço base value

Requested change (verbatim): **"A Service also can have a base value"** - the screenshot shows the `Novo serviço` dialog where `Setup (R$)` is a non-editable dashed amber box reading `Definido na venda`.

This slice **deliberately deletes a documented invariant**: "A Serviço has no own value".
Everything below is written so the executor makes zero further design decisions.

---

## 1. Established facts

### 1.1 The DB CHECK constraints on `sales_ops_products`

Shipped in `apps/api/drizzle/0013_produtos_servicos_defaults.sql`, block 3 ("CHECK constraints, moved below the backfill by hand"), verbatim:

```sql
ALTER TABLE "sales_ops_products" ADD CONSTRAINT "sales_ops_products_kind_check" CHECK ("sales_ops_products"."kind" in ('product', 'service'));--> statement-breakpoint
ALTER TABLE "sales_ops_products" ADD CONSTRAINT "sales_ops_products_kind_open_price_check" CHECK (("sales_ops_products"."kind" = 'service') = "sales_ops_products"."open_price");--> statement-breakpoint
ALTER TABLE "sales_ops_products" ADD CONSTRAINT "sales_ops_products_service_no_fixed_value_check" CHECK ("sales_ops_products"."kind" <> 'service' or ("sales_ops_products"."setup_brl" = 0 and "sales_ops_products"."monthly_brl" = 0));--> statement-breakpoint
```

Mirrored in `apps/api/src/db/schema.ts:612-620`:

```ts
check('sales_ops_products_kind_check', sql`${t.kind} in ('product', 'service')`),
check(
  'sales_ops_products_kind_open_price_check',
  sql`(${t.kind} = 'service') = ${t.openPrice}`,
),
check(
  'sales_ops_products_service_no_fixed_value_check',
  sql`${t.kind} <> 'service' or (${t.setupBrl} = 0 and ${t.monthlyBrl} = 0)`,
),
```

**Exactly one of these three encodes the invariant being deleted: `sales_ops_products_service_no_fixed_value_check`.**
The other two encode *classification*, which this slice does not touch.

Migrations touching these columns: `0013` is the only one (it RENAMED `type` -> `kind`, backfilled `kind` from `open_price`, zeroed `setup_brl`/`monthly_brl` on open-price rows, then added the three CHECKs). `open_price` itself predates it (`0007_marvelous_valeria_richards.sql`). Latest migration on disk is `0014_sale_professional_funcoes`; journal `idx` 14. **The next number is 0015.**

### 1.2 Where "a Serviço is forced to zero" actually lives

There is **no server-side coercion to 0**. The rule is enforced in three places, all of which reject rather than rewrite:

| Layer | Location | Behavior |
| --- | --- | --- |
| Web dialog | `SalesOpsApp.tsx:3401,3403` - `setupBrl: isService ? 0 : ...`, `monthlyBrl: isService \|\| !form.hasMonthly ? 0 : ...` | The dialog *sends* 0 |
| Zod refine | `service.ts:130-136` `validateProductFields` -> issue `service_cannot_have_fixed_value` on `path: ['setupBrl']` | 400 on POST/PATCH |
| Merged-row guard | `service.ts:1724-1729` `updateProduct` re-parses `{kind, setupBrl, monthlyBrl}` -> returns `INVALID_PRODUCT_KIND_VALUE` (`service.ts:1474`), mapped by `routes.ts:147-148` to `400 {error:'validation_error', reason:'service_cannot_have_fixed_value'}` | 400 on a partial PATCH |
| DB | `sales_ops_products_service_no_fixed_value_check` | 23514 on any raw write |

`createProduct` (`service.ts:1671-1692`) and `updateProduct` (`service.ts:1721,1744-1750`) both write `openPrice: kind === 'service'` and nothing else about it. `PRODUCT_PLAIN_COLUMNS` already carries `setupBrl`, `hasMonthly` and `monthlyBrl` verbatim - **no write-path plumbing is needed for the new value.**

### 1.3 Web surface

- `apps/web/src/sales-ops/calculations.ts:38-49` - `isServiceProduct(product)` = `product?.kind === 'service'`. The one discriminator branch point.
- `SalesOpsApp.tsx:3183-3189` - `DefinedOnSaleNotice()`, the dashed amber `Definido na venda` box. **Exactly two call sites**: `:3592` (Setup) and `:3626` (Valor da mensalidade).
- `SalesOpsApp.tsx:3568-3572` - amber banner `Serviços têm valor variável, definido em cada proposta.`
- `SalesOpsApp.tsx:3590-3601` - `<Field label="Setup (R$)">` with the `isService ? <DefinedOnSaleNotice/> : <Input/>` swap.
- `SalesOpsApp.tsx:3622-3635` - same swap for `Valor da mensalidade (R$)`, rendered only when `form.hasMonthly`. **The `Possui mensalidade` toggle itself is already rendered for a Serviço** (`:3610-3620`), so a Serviço can already declare that it recurs but never for how much - a half-state this slice closes.
- `SalesOpsApp.tsx:2374-2383` - `ProductsView` Serviço branch, the hardcoded `Variável` cell under the `Valor` header, with a comment claiming "the DB CHECK keeps setup/mensalidade at zero".
- `SalesOpsApp.tsx:2260-2269` - `defaultPlanSummary` already appends `+ mensal` for a Serviço with `hasMonthly`.

---

## 2. The `openPrice` decision

**Decision: `openPrice` stays exactly as it is. A Serviço with a base value still projects `openPrice: true`, and `sales_ops_products_kind_open_price_check` is NOT touched.**

### 2.1 Every reader traced

**API (7 sites):**

1. `apps/api/src/db/schema.ts:570` - column definition. Write-only projection.
2. `apps/api/src/db/schema.ts:613-616` - the CHECK `(kind = 'service') = open_price`.
3. `service.ts:87-94` `resolveProductKind` - reads `data.openPrice` as a **legacy wire-input alias for `kind`**. Never reads the stored column.
4. `service.ts:115-125` `validateProductFields` - same, input alias only (`kind_open_price_conflict`).
5. `service.ts:127-129` - derives `resolvedKind` from the alias.
6. `service.ts:178` - `ProductFieldsSchema.openPrice`, marked `@deprecated legacy alias for kind`.
7. `service.ts:1681` + `service.ts:1747` - the two WRITE sites, `openPrice: kind === 'service'`.

**No server code anywhere reads the stored `open_price` column to decide anything.** Zero money, zero validation, zero projection depends on it. Grep confirms `salesOpsProducts.openPrice` appears in no `select`, no `where`, no ledger, no sale write path.

**Web (6 sites):**

8. `types.ts:99` - `openPrice: boolean` on `SalesOpsProduct`.
9. `SalesOpsApp.tsx:4862` - `product?.openPrice && item.productNameSnapshot !== product.name` -> the edit-path `customLabel` prefill. Reads openPrice as **"is a Serviço"**.
10. `SalesOpsApp.tsx:5096` - `firstProduct.openPrice ? 0 : firstProduct.setupBrl || firstProduct.monthlyBrl`. Reads openPrice as **"has no own value"**.
11. `SalesOpsApp.tsx:5574` - `hasVariableValue = Boolean(product?.openPrice) || isService`. Reads openPrice as **"is a Serviço"** (and is already redundant with `|| isService`, since `open_price === (kind === 'service')` by CHECK).
12. `SalesOpsApp.tsx:5603` - same expression as 10, inside `setItem`.
13. `SalesOpsApp.tsx:5622` - same expression as 10, inside `addItem`.

### 2.2 Why the CHECK does not change

Sites 9 and 11 ask a **classification** question - "is this row a Serviço?" - and the answer is still *yes* for a Serviço carrying a base value. `(kind = 'service') = open_price` remains true by construction because the server writes `openPrice: kind === 'service'` unconditionally, and nothing in this slice changes `kind`.

Sites 10, 12 and 13 are the only three that **conflate** `openPrice` with "has no own value", and they are precisely the lines this slice rewrites. They are safe to rewrite to plain arithmetic *today*, before any data changes, because for a Serviço the current CHECK already guarantees `setupBrl = 0 and monthlyBrl = 0`, so `product.openPrice ? 0 : setupBrl || monthlyBrl` and `setupBrl || monthlyBrl` are **provably identical on every row that exists**. That is what makes this a zero-risk rewrite rather than a behavior change.

The column name still reads honestly after the change: `needsNegotiatedValue` stays `true` for **every** Serviço (see §4.4), so a Serviço's price genuinely is still "open" - negotiated per proposta. The base value is a starting point, not a price.

Net effect: after this slice `apps/web` has **zero** readers of `openPrice`. That is a good follow-up signal (the column could eventually be dropped) but **dropping it is explicitly out of scope here** - it is still written and still CHECKed, and removing it would touch the sale-item snapshot lineage that `0013`'s header comment protects.

---

## 3. The migration - REQUIRED

**Yes, a migration is required.** The zod refine can be deleted in TypeScript, but `sales_ops_products_service_no_fixed_value_check` is a physical constraint: any `UPDATE sales_ops_products SET setup_brl = 500000` on a `kind = 'service'` row raises `23514` regardless of what the API believes.

### 3.1 How to produce it

1. Delete the `check('sales_ops_products_service_no_fixed_value_check', ...)` entry from `apps/api/src/db/schema.ts` (see §4.1).
2. Run `pnpm --filter @fxl-sales/api db:generate`. drizzle-kit emits `apps/api/drizzle/0015_<random>.sql`, `apps/api/drizzle/meta/0015_snapshot.json`, and appends `idx: 15` to `meta/_journal.json`.
3. **Inspect the generated SQL.** It must contain exactly one statement. If drizzle-kit emits anything else (unrelated drift), delete the extra statements from the `.sql` but KEEP the generated snapshot - the snapshot is the diff baseline, the `.sql` is what runs.
4. Rename the file to `apps/api/drizzle/0015_servico_base_value.sql` and update the matching `"tag"` in `meta/_journal.json` to `"0015_servico_base_value"`. (This is the repo's convention: `0013_produtos_servicos_defaults`, `0014_sale_professional_funcoes` are hand-named; drizzle's `migrate()` resolves files by the journal `tag`.)
5. Prepend the header comment below.

### 3.2 The exact file: `apps/api/drizzle/0015_servico_base_value.sql`

```sql
-- Serviço base value: a Serviço may carry its own value, as a DEFAULT.
--
-- 0013 added sales_ops_products_service_no_fixed_value_check to encode "a Serviço
-- has no own value". That premise is gone: every number in the product dialog is
-- a default a proposta may override, and a Serviço's value is no different. A
-- Serviço that genuinely has no base value stores 0, which is exactly what every
-- existing row already stores, so this migration needs no backfill and no data
-- moves.
--
-- Deliberately NOT touched: sales_ops_products_kind_open_price_check. It asserts
-- (kind = 'service') = open_price - "this row is a Serviço" - and a Serviço with
-- a base value is still a Serviço. open_price never meant "has no own value";
-- that was only ever this constraint.
--
-- Drop-only, so the down path is the original ADD CONSTRAINT from 0013. It can
-- only be replayed against a database whose serviços are all still at zero.

ALTER TABLE "sales_ops_products" DROP CONSTRAINT "sales_ops_products_service_no_fixed_value_check";
```

No `set_config('app.fxl_admin', ...)` is needed: RLS does not gate DDL, and there is no DML here.

---

## 4. Exact edits, per file

### 4.1 `apps/api/src/db/schema.ts`

Delete the whole `check(...)` entry at lines 617-620:

```ts
    check(
      'sales_ops_products_service_no_fixed_value_check',
      sql`${t.kind} <> 'service' or (${t.setupBrl} = 0 and ${t.monthlyBrl} = 0)`,
    ),
```

Update the `openPrice` column comment (`:568-569`) to close the ambiguity for good:

```ts
    // Derived projection of `kind`, never authored independently. The
    // sales_ops_products_kind_open_price_check CHECK keeps it == (kind = 'service').
    // It means "this row is a Serviço" and nothing more: a Serviço MAY carry an own
    // value (setup_brl / monthly_brl) as a per-proposta default, and 0 is how "no
    // base value" is expressed.
    openPrice: boolean('open_price').notNull().default(false),
```

### 4.2 `apps/api/src/domains/sales-ops/service.ts`

**(a)** Delete the `service_cannot_have_fixed_value` rule from `validateProductFields` - lines 127-136 in full:

```ts
  const resolvedKind =
    data.kind ??
    (data.openPrice === undefined ? undefined : data.openPrice ? 'service' : 'product');
  if (resolvedKind === 'service' && ((data.setupBrl ?? 0) > 0 || (data.monthlyBrl ?? 0) > 0)) {
    ctx.addIssue({ ... });
  }
```

`ProductFieldsForValidation` may keep `setupBrl?`/`monthlyBrl?` or drop them; **drop them** since no rule reads them any more, and remove the now-unused `resolvedKind` local. The `kind_open_price_conflict` rule above it and the entrada/duplicate-função rules below it are untouched.

Update the docblock at `:107-113` - the sentence "The rules a partial payload cannot see (a `kind: 'service'` patch against a row that already stores a fixed value) are re-run on the merged row in `updateProduct`" now describes only the entrada block. Replace with:

```
 * Partial-tolerant product invariants: every rule is skipped when its inputs are
 * `undefined`, so the same refine serves ProductSchema and UpdateProductSchema.
 * The one rule a partial payload cannot see on its own - the entrada mode/value
 * pairing - is re-run on the merged row in `updateProduct`.
```

**(b)** Update the docblock at `:66-71`. `"A Serviço is structurally a variable-value item: it carries no own price"` is now false:

```ts
/**
 * Produto | Serviço - the single classification axis on a product.
 *
 * Both kinds may carry an own value in setupBrl/monthlyBrl. The difference is what
 * the value MEANS: a Produto's is a catalog price, a Serviço's is a base value the
 * proposta prefills and the operator negotiates. `0` is how a Serviço says it has
 * no base value at all, which is what every pre-0015 Serviço stores.
 */
```

**(c)** Delete `INVALID_PRODUCT_KIND_VALUE` (`:1469-1474`, the sentinel and its docblock). With the refine gone, `UpdateProductSchema.safeParse({kind, setupBrl, monthlyBrl})` can no longer fail for any input - every remaining rule short-circuits on `undefined` - so the sentinel is unreachable dead code and its 400 reason is a contract lie.

**(d)** In `updateProduct`, delete the merged-kind guard (`:1722-1729`):

```ts
    // Re-run the invariants on the MERGED row: a partial payload cannot see the
    // conflict between `{ kind: 'service' }` and a stored fixed setupBrl.
    const kindMerged = { ... };
    if (!UpdateProductSchema.safeParse(kindMerged).success) return INVALID_PRODUCT_KIND_VALUE;
```

`const kind = resolveProductKind(data, current.kind as ProductKind);` at `:1721` **stays** - it feeds the patch. The `entradaMerged` guard at `:1731-1742` stays untouched.

Narrow the return type at `:1707-1712` to `Promise<ProductWithCosts | typeof INVALID_PRODUCT_ENTRADA_VALUE | null>`.

**(e)** Update the `INVALID_PRODUCT_ENTRADA_VALUE` docblock (`:1476-1481`), which opens with "Same idea for the entrada block" and now has no antecedent. Make it self-contained:

```ts
/**
 * Sentinel for a PATCH whose MERGED entrada block contradicts itself, e.g.
 * `PATCH { defaultEntradaPct: 50 }` against a row whose stored mode is 'none' -
 * only visible once the patch is merged. Returning a sentinel keeps it a 400
 * instead of letting the DB CHECK surface as a 500. Mirrors the `'duplicate'`
 * sentinel idiom used by createArea.
 */
```

### 4.3 `apps/api/src/domains/sales-ops/routes.ts`

Remove `INVALID_PRODUCT_KIND_VALUE` from the import at `:12` and delete the branch at `:147-148`:

```ts
  if (updated === INVALID_PRODUCT_KIND_VALUE) {
    return c.json({ error: 'validation_error', reason: 'service_cannot_have_fixed_value' }, 400);
  }
```

The `INVALID_PRODUCT_ENTRADA_VALUE` branch beside it stays.

### 4.4 `apps/web/src/sales-ops/calculations.ts` - the ONE new predicate

Add immediately below `isServiceProduct` (after line 49). This is the single seam for "does this catalog row suggest a price", so no call site re-derives it and no second `kind ===` comparison appears:

```ts
/**
 * The catalog value one unit of this row suggests, in integer CENTS. `0` means the
 * row carries no own value and the operator types one inside the proposta.
 *
 * The one place a catalog own value is read, exactly as `isServiceProduct` is the
 * one place the discriminator is read. It is deliberately kind-blind: a Produto's
 * value is a catalog price and a Serviço's is a base value, but both are DEFAULTS
 * a proposta may overwrite, so the arithmetic that prefills an item is identical.
 * The `||` (not `+`) is the pre-existing wizard rule: a row that has no setup but
 * does recur suggests its mensalidade.
 *
 * Before slice 07 a Serviço was pinned at 0 by a DB CHECK, so this returns exactly
 * what the old `openPrice ? 0 : setupBrl || monthlyBrl` returned on every row that
 * predates it.
 */
export function productBaseValueBrl(
  product: Pick<SalesOpsProduct, 'setupBrl' | 'monthlyBrl'> | undefined,
): number {
  return product ? product.setupBrl || product.monthlyBrl : 0;
}
```

`isServiceProduct` itself is **unchanged**. Its docblock stays accurate.

### 4.5 `apps/web/src/sales-ops/SalesOpsApp.tsx`

Add `productBaseValueBrl` to the `calculations` import block (beside `isServiceProduct`, `:124`).

**(a) `:3183-3189` - delete `DefinedOnSaleNotice` entirely.** Both call sites go; leaving it would be an unused-symbol lint failure.

**(b) `:3568-3572` - delete the amber banner** `Serviços têm valor variável, definido em cada proposta.` and its wrapper `{isService ? (...) : null}`.
Reason, so nobody re-adds it: the sentence is now false as an absolute, and the truth that survives ("this is a default, the proposta may change it") is **already stated once at the top of the dialog** by `Tudo aqui é padrão: dentro da proposta você pode alterar qualquer valor sem mexer no cadastro.` A second banner restating it for one kind is noise.

**(c) `:3590-3601` - make Setup an ordinary input and rename it for a Serviço:**

```tsx
              <Field label={isService ? 'Valor base (R$)' : 'Setup (R$)'}>
                <Input
                  className={`sales-ops-num ${formInputClass}`}
                  onChange={(event) => set('setupBrl', event.target.value)}
                  type="number"
                  value={form.setupBrl}
                />
              </Field>
```

`Valor base` is the request's own word and matches the list's `Valor` column header for a Serviço, so the dialog field and the list cell name the same number.

**(d) `:3622-3635` - drop the `isService` swap on the mensalidade input**, leaving the plain `<Input>` branch:

```tsx
                  <Field label="Valor da mensalidade (R$)">
                    <Input
                      className={`sales-ops-num bg-white ${formInputClass}`}
                      onChange={(event) => set('monthlyBrl', event.target.value)}
                      type="number"
                      value={form.monthlyBrl}
                    />
                  </Field>
```

**(e) `:3401,3403` - stop zeroing on submit:**

```ts
      setupBrl: parseCurrencyToCents(form.setupBrl),
      hasMonthly: form.hasMonthly,
      monthlyBrl: form.hasMonthly ? parseCurrencyToCents(form.monthlyBrl) : 0,
```

The `!form.hasMonthly -> 0` rule stays: it is about the toggle, not about the kind. `isService` remains in scope for (c) and for the módulos section - do not delete the local.

**(f) `:2374-2383` - the list `Valor` cell.** Replace the hardcoded `Variável` and its now-false comment:

```tsx
                  {isService ? (
                    <>
                      {/*
                          A serviço's own value is a BASE value, a per-proposta
                          default. `0` is how "no base value" is stored - there is
                          no separate flag - so it prints `Variável` rather than
                          `R$ 0,00`, which would be a lie about a price nobody set.
                        */}
                      <TableCell
                        className={
                          productBaseValueBrl(product) > 0
                            ? 'sales-ops-num px-4 py-3 text-right text-[13.5px]'
                            : 'px-4 py-3 text-right text-[13.5px] text-[#9b9ba3]'
                        }
                      >
                        {productBaseValueBrl(product) > 0
                          ? formatMoneyBrl(productBaseValueBrl(product), {
                              maximumFractionDigits: 0,
                            })
                          : 'Variável'}
                      </TableCell>
```

(The muted `text-[#9b9ba3]` is kept for `Variável` only; a real money figure gets the same `sales-ops-num` treatment as the Produto branch, so the two branches align.)

**(g) `:4862` - swap the classification read off `openPrice`:**

```tsx
          product && isServiceProduct(product) && item.productNameSnapshot !== product.name
            ? item.productNameSnapshot
            : '',
```

**(h) `:5096`, `:5603`, `:5622` - swap the three value reads to the new seam:**

```ts
// :5096
            unitBrl: centsToInput(productBaseValueBrl(firstProduct)),
// :5603
            next.unitBrl = centsToInput(productBaseValueBrl(product));
// :5622
        unitBrl: centsToInput(productBaseValueBrl(product)),
```

**(i) `:5572-5581` - drop the redundant `openPrice` term.** `hasVariableValue` keeps meaning "is a Serviço", which is what it always resolved to:

```ts
  /**
   * What a catalog-product row must carry before step 1 accepts it. Shared by the
   * `itemsValid` gate and the row's error rendering so the two cannot drift: if
   * they disagree, the wizard either blocks with no visible reason or shows an
   * error it does not enforce.
   *
   * A Serviço always needs a negotiated value, base value or not: the base value
   * merely PREFILLS the field (see `productBaseValueBrl`), so a serviço that has
   * one satisfies the gate without a keystroke while one that does not still
   * blocks - and blanking the field blocks either way. A Serviço needs no
   * description, because `saleItemDisplayName` falls back to the catalog name. A
   * Produto needs neither: it has a catalog price and a catalog name, and the
   * description field is not even rendered.
   */
  function productRowRequirements(product: SalesOpsProduct | undefined) {
    const isService = isServiceProduct(product);
    return {
      isService,
      hasVariableValue: isService,
      needsNegotiatedValue: isService,
      needsDescription: false,
    };
  }
```

> Note for the executor: `needsDescription` was `hasVariableValue && !isService`, which was **already** unconditionally `false` once `hasVariableValue === isService` - it only ever fired for the pre-`kind` "open price but not a serviço" row, a state the `kind_open_price_check` makes impossible. Collapsing it to `false` is a faithful simplification, not a behavior change. Its two consumers (`:5423` `descriptionOk`, `:6148` the error flag) keep compiling unchanged. **Do not delete `needsDescription` from the return object** - `:6143` destructures it.

Leave `:6159-6160` (`Serviço com valor variável - descrição opcional`) alone: that hint is about the per-item description and is still true.

---

## 5. `CLAUDE.md` replacement wording

Under `## Produtos & Serviços`, replace bullets 2, 3, 4 and 5 (current lines 90-93) with:

```markdown
- Every catalog row carries `kind: 'product' | 'service'` (pt-BR labels Produto/Serviço). BOTH kinds may carry an own value in `setupBrl`/`monthlyBrl`. For a Produto it is a catalog price; for a Serviço it is a BASE VALUE - a suggestion the proposta prefills and the operator negotiates, exactly like every other number in that dialog. `0` is the whole expression of "no base value": there is no separate flag, the list prints `Variável` instead of `R$ 0,00`, the wizard prefills nothing, and the step-1 negotiated-value gate still blocks. That is what every pre-0015 Serviço stores, so nothing about an existing Serviço changed.
- The old "a Serviço has no own value" invariant is gone, and with it all four of its enforcement points: `sales_ops_products_service_no_fixed_value_check` (dropped by `0015_servico_base_value`), the `service_cannot_have_fixed_value` zod refine, the `INVALID_PRODUCT_KIND_VALUE` sentinel with its `updateProduct` merged-row guard and its `routes.ts` 400 branch, and the dialog's `isService ? 0 :` submit coercion. `DefinedOnSaleNotice` (`Definido na venda`) and the `Serviços têm valor variável, definido em cada proposta.` banner are deleted too - the dialog already says once, at the top, that everything in it is a default.
- `openPrice` survives only as a server-written projection of `kind`, enforced by `sales_ops_products_kind_open_price_check` (`(kind = 'service') = open_price`), which slice 07 deliberately did NOT relax: that CHECK asserts "this row is a Serviço", and a Serviço carrying a base value is still a Serviço. `openPrice` never meant "has no own value" - that was only ever the constraint above. `apps/web` now has ZERO readers of the column: the classification question goes through `isServiceProduct` and the money question through `productBaseValueBrl`. The product dialog has no `Preço em aberto` switch and never sends `openPrice`; the `Produto | Serviço` segmented control is the single way to express the same fact.
- `isServiceProduct` in `apps/web/src/sales-ops/calculations.ts` is the one place any branch on the discriminator happens, and `productBaseValueBrl` beside it is the one place a catalog own value is read (`setupBrl || monthlyBrl`, integer CENTS, `0` = none; the `||` is why a row with no setup that recurs suggests its mensalidade). Every unit-price prefill and the Serviço `Valor` column go through it, so "does this row suggest a price" is never re-derived per call site. `productForm` reads `product.kind` directly only to seed the dialog's own state. A row without `kind` reads as a Produto.
- The list is one table filtered by a `Produto | Serviço` segmented bar that renders inside the card and above the empty state, so an empty bucket is never a dead end. Serviço trades the `Setup | Mensalidade | Recorrente` columns for `Valor | Plano padrão | Custos padrão`, and the `Valor` cell prints `productBaseValueBrl` when it is non-zero, `Variável` when it is `0`. The dialog names that same number `Valor base (R$)` for a Serviço and `Setup (R$)` for a Produto.
```

---

## 6. Oracle tests

### ORACLE 1 (primary, API integration) - `apps/api/test/rls/product-funcao-costs-rls.test.ts`

Replace the existing `it('a servico cannot be given a fixed own value through PATCH', ...)` (`:298-345`) with:

```
it('a servico persists a base value, and one left alone stays at zero', ...)
```

Assertions, in order:

1. Seed area, create Serviço A and Serviço B via `ProductSchema.parse({... kind: 'service'})`, and a Produto.
2. `updateProduct(db, orgA, A.id, { setupBrl: 500000 })` returns a `ProductWithCosts` (not a string) and `product.setupBrl === 500000`, `product.kind === 'service'`, **`product.openPrice === true`** - the projection is untouched by the base value.
3. `updateProduct(db, orgA, A.id, { hasMonthly: true, monthlyBrl: 20000 })` persists `monthlyBrl === 20000`.
4. Re-read via `listProducts` and confirm A's `setup_brl`/`monthly_brl` really landed (proves it is not just the RETURNING row).
5. **Negative-control / no-regression:** Serviço B, never patched, still reads `setupBrl === 0 && monthlyBrl === 0 && openPrice === true && kind === 'service'`.
6. **Behavior flip:** reclassifying a priced Produto (`setupBrl: 5000`) with `{ kind: 'service' }` and no value keys now SUCCEEDS and **keeps** `setupBrl === 5000` - this used to return `INVALID_PRODUCT_KIND_VALUE`.
7. **The load-bearing assertion - this is the one that fails if the migration is missing.** The raw admin `UPDATE` at `:340-344` currently asserts `.rejects.toThrow(/sales_ops_products_service_no_fixed_value_check/)`. Invert it: `await expect(adminClient\`UPDATE sales_ops_products SET setup_brl = 5000 WHERE id = ${B.id}\`).resolves.toBeDefined()`, then read the row back and assert `setup_brl === 5000`. Zod alone cannot make this pass; only the dropped constraint can.

Remove `INVALID_PRODUCT_KIND_VALUE` from this file's import (`:23`).

Run: `pnpm --filter @fxl-sales/api test:integration` (pinned to the local Docker test DB via `TEST_DATABASE_URL` / the non-superuser `fxl_sales_test` role; `global-setup.ts` applies the journaled migrations, so it picks up `0015` automatically).

### ORACLE 2 (API unit contract) - `apps/api/src/domains/sales-ops/__tests__/produtos-servicos-contract.test.ts`

Flip `it('rejects a servico carrying a fixed own value, and accepts the same value on a produto')` (`:49-74`) to:

```
it('accepts a base value on a servico exactly as on a produto')
```

- `ProductSchema.safeParse({...completeProduct, kind: 'service', setupBrl: 5000}).success === true`
- `...{kind:'service', hasMonthly:true, monthlyBrl:5000}.success === true`
- the two Produto positive controls stay `true`
- `it('accepts a servico with no own value')` (`:37-47`) stays **unchanged** - it is the no-regression pin for the `0` case.
- `it('rejects a kind and openPrice contradiction')` (`:115`) stays unchanged - it pins that the `openPrice` alias rule survived.

### ORACLE 3 (web, dialog) - `apps/web/src/sales-ops/__tests__/product-service-dialog.test.tsx`

- Replace `it('replaces every own-value input with the definido na venda notice for a serviço')` (`:345-358`) with `it('renders editable base value inputs for a serviço and submits them')`: render `{productKind:'service'}`, toggle `Possui mensalidade`, assert `text()` contains `Valor base (R$)` and `Valor da mensalidade (R$)`, assert `text()` does **not** contain `Definido na venda` nor `Serviços têm valor variável`, type into the `Valor base (R$)` input (find it the way `:378-381` finds the setup input, matching the new label), choose an área, submit, and assert `onSave` got `{ kind: 'service', setupBrl: <cents> }`.
- Replace `it('zeroes the own value when a produto is reclassified as a serviço')` (`:360-373`) with `it('preserves the own value when a produto is reclassified as a serviço')`: same fixture (`setupBrl: 100000, hasMonthly: true, monthlyBrl: 50000`), click `Classificar como serviço`, submit, assert `{ kind: 'service', setupBrl: 100000, monthlyBrl: 50000 }`.
- `it('keeps the own-value inputs editable for a produto')` (`:375-387`) stays, but its label lookup `includes('Setup (R$)')` must still resolve - it renders a Produto, so `Setup (R$)` is still the label. No change needed.
- `it('sends kind and never sends openPrice')` (`:323-343`) asserts `toMatchObject({kind:'service', setupBrl:0, monthlyBrl:0})` on an untouched serviço - **keep it verbatim**, it is the web no-regression pin for the `0` case.

### ORACLE 4 (web, list) - `apps/web/src/sales-ops/__tests__/produtos-servicos-view.test.tsx`

- `it('renders the serviço column set with variável value, plano padrão and custos padrão')` (`:198-238`) stays; its `expect(cellUnder('Valor').textContent?.trim()).toBe('Variável')` is the no-regression pin (the `servico()` fixture is zero-valued).
- **Add** `it('prints the base value in the Valor column when a serviço carries one')`: render `servico({ setupBrl: 500000 })` with `kind: 'service'` and assert `cellUnder('Valor').textContent?.trim()` is the `formatMoneyBrl(500000, {maximumFractionDigits: 0})` output and is **not** `Variável`.
- **Add** a case pinning the `||` rule: `servico({ setupBrl: 0, hasMonthly: true, monthlyBrl: 20000 })` prints the mensalidade figure in `Valor`, not `Variável`.

### ORACLE 5 (migration-integrity fixup, not a new behavior) - `apps/api/test/rls/produtos-servicos-schema-migration.test.ts`

`POST_BACKFILL_CHECKS` (`:15-20`) is used two ways in this file:
- inside the **sandbox** replay of 0013 (`:228-277`), where all three must still be addable - **leave that alone**, 0013 is being tested as shipped and its `backfillStatements()` boundary parser depends on the file being unchanged.
- in `it('rolls the sandbox back so the live schema keeps its CHECK constraints')` (`:362-375`), which asserts the **live** schema still carries all three. This one now fails.

Fix: split the constant.

```ts
/** The three CHECKs migration 0013 adds AFTER the backfill, and only those. */
const POST_BACKFILL_CHECKS = [
  'sales_ops_products_kind_check',
  'sales_ops_products_kind_open_price_check',
  'sales_ops_products_service_no_fixed_value_check',
] as const;

/**
 * What the LIVE schema still carries. 0015 drops the no-fixed-value CHECK, so a
 * Serviço may hold a base value; the two classification CHECKs are untouched,
 * because a Serviço with a base value is still a Serviço.
 */
const LIVE_PRODUCT_CHECKS = [
  'sales_ops_products_kind_check',
  'sales_ops_products_kind_open_price_check',
] as const;
```

In the final `it`, iterate `LIVE_PRODUCT_CHECKS` for the `toContain` assertions and add one explicit
`expect(names).not.toContain('sales_ops_products_service_no_fixed_value_check')`, so the live-schema expectation is stated rather than merely un-asserted. The three `default_*` `toContain`s stay.

---

## 7. Verification

```bash
pnpm run lint
pnpm run type-check
pnpm test
pnpm --filter @fxl-sales/api test:integration
pnpm run build
```

Manual E2E (the requested change, end to end):
1. `cadastros/produtos` -> `Serviço` segment -> `Novo serviço`.
2. The dialog shows an editable `Valor base (R$)` input where the dashed amber `Definido na venda` box used to be, and no `Serviços têm valor variável` banner.
3. Save with a value -> the list `Valor` column prints it, right-aligned in `sales-ops-num`, not `Variável`.
4. Save a second Serviço with `Valor base` left at 0 -> its `Valor` cell still reads `Variável`, muted.
5. Open the proposta wizard, add the first Serviço as an item -> `Valor negociado` prefills with the base value and is editable; add the second -> prefills `0` and step 1 blocks until a value is typed.

---

## 8. Risk notes

- **The one-way migration.** `DROP CONSTRAINT` is trivially reversible in DDL, but once a Serviço stores a non-zero value the *data* is no longer re-constrainable. Re-adding the 0013 CHECK on a rolled-back deploy would fail on those rows. This is inherent to the feature, not to the approach - flagged so nobody attempts a naive schema revert without zeroing serviços first.
- **`pnpm run build` before the migration runs.** The API build does not apply migrations; staging/prod must run `db:migrate` before the new API image serves traffic, or a Serviço write with a value returns a raw `23514` as a 500 (the zod refine that used to catch it will be gone). Deploy order: migrate, then release.
- **`drizzle-kit generate` drift.** Step 3 of §3.1 exists because the repo has hand-written migrations (`0005`, `0006`, `0008` have no meta snapshot) and drizzle-kit may want to emit unrelated statements to reconcile. Verify the emitted `.sql` is a single `DROP CONSTRAINT` before shipping it.
- **`isService` must survive edit (e) in `SalesOpsApp.tsx`.** The submit handler stops branching on it for the money fields, but the local is still read by the `Valor base (R$)` label and the módulos section. Deleting it breaks the build; TypeScript will catch this, but it is the likeliest mechanical slip.
- **`needsDescription` collapse.** §4.5(i) folds it to a literal `false`. It must stay a key on the returned object (`:6143` destructures it) even though it is now constant - `it('renders módulos only for a produto...')` and the `sale-wizard-service-description` suite both exercise the surrounding branches and will catch a wrong removal.
- **Scope fence.** `open_price` is not renamed, not dropped, and its CHECK is not touched. `sales_ops_sale_items.product_type_snapshot` lineage (which `0013`'s header protects) is not touched. `providers` stays deprecated and untouched.
