---
id: 09-produto-codigo-default
milestone: v2.3.0
status: todo
depends_on: ["08-produto-wizard"]
files_modified: []
acceptance: "given an org whose produtos already occupy code suffixes 0, 3 and 7, when the operator opens `Novo produto` or `Novo serviço`, then `Final do código da venda` is pre-seeded with `8` (max + 1) instead of `0`, while opening `Editar produto` on the suffix-`3` row still shows `3`"
---

# 09 - produto: default `Final do código da venda` to max + 1

Requested change, verbatim: *"Make by default the 'Final do Código de venda' the higher current código + 1"*.

## 1. The field's exact identity

| Layer | Identifier | Evidence |
| --- | --- | --- |
| DB column | `sales_ops_products.code_suffix`, `text NOT NULL DEFAULT '0'` | `apps/api/src/db/schema.ts:566` |
| API field | `codeSuffix: z.string().regex(/^\d{1,2}$/).default('0')` | `apps/api/src/domains/sales-ops/service.ts:179` |
| API write allow-list | `'codeSuffix'` inside `PRODUCT_PLAIN_COLUMNS` | `apps/api/src/domains/sales-ops/service.ts:1503` |
| Web type | `SalesOpsProduct.codeSuffix: string` (required, not optional) | `apps/web/src/sales-ops/types.ts:97` |
| Form state | `ProductForm.codeSuffix: string` | `apps/web/src/sales-ops/SalesOpsApp.tsx:3009` |
| **Current default** | `codeSuffix: product?.codeSuffix ?? '0'` | `apps/web/src/sales-ops/SalesOpsApp.tsx:3046` (inside `productForm`) |
| Input | unlabelled `<input type="text" inputMode="numeric" maxLength={2}>` behind the literal prefix `0000-` | `apps/web/src/sales-ops/SalesOpsApp.tsx:3543-3566` |
| Submit coercion | `codeSuffix: form.codeSuffix.replace(/\D/g, '').slice(0, 2) \|\| '0'` | `apps/web/src/sales-ops/SalesOpsApp.tsx:3397` |

The `0000-` on screen is not decoration: `createSale` builds the sale code as
`${String(nextSequence).padStart(4, '0')}-${codeSuffix}`, taking the suffix from the FIRST item's
produto and falling back to `'0'` when the item has no produto
(`apps/api/src/domains/sales-ops/service.ts:1929-1943`).
So the four zeros are the org-wide sale sequence and the editable box is literally the tail of every
sale code this produto will ever generate.
The list renders the same value as `...{product.codeSuffix}` at `SalesOpsApp.tsx:2371`.

**Type and width:** `text` in Postgres, but the API regex `/^\d{1,2}$/` and the input's `maxLength={2}`
together bound the domain to the 100 values `0` through `99`, unpadded.

## 2. Uniqueness: YES, hard-constrained per org

```ts
uniqueIndex('sales_ops_products_org_code_suffix_idx').on(t.orgId, t.codeSuffix),
```

`apps/api/src/db/schema.ts:611`, materialized in
`apps/api/drizzle/0007_marvelous_valeria_richards.sql:157`:

```sql
CREATE UNIQUE INDEX "sales_ops_products_org_code_suffix_idx" ON "sales_ops_products" USING btree ("org_id","code_suffix");
```

Three consequences that drive the whole design:

1. It is a **full** unique index, not a partial one - there is no `WHERE status = 'active'` clause.
   An **archived** produto therefore still occupies its suffix forever.
2. `createProduct` (`service.ts:1665-1700`) is a plain `INSERT ... RETURNING` with **no** 23505 handling,
   and `POST /products` (`routes.ts:112-128`) maps only Zod failures and `resolveProductRefs` failures to
   400.
   Compare `createFuncao`, which does have a `FUNCAO_UNIQUE_VIOLATIONS` map (`service.ts:1417-1431`).
   So a duplicate `code_suffix` today escapes as an **HTTP 500**, with no operator-readable message.
3. `listProducts` (`service.ts:1655-1662`) applies **no status filter**, so `bootstrap.products` is the
   complete per-org set - exactly the set the unique index covers.

Because the suffix is genuinely unique, "max + 1" is not merely a convenience: it is the next
guaranteed-free value in a dense catalogue, and it removes the only realistic way an operator
currently trips that unhandled 500 (leaving the field at its `0` default while some other produto
already holds `0`).

**Out of scope for this slice:** mapping 23505 to a 400 on the products route.
That is a real gap, but it is API work in a batch whose every other slice is web-only, and the default
designed here makes the collision path effectively unreachable through the UI.
Record it as a follow-up doubt rather than widening this slice.

## 3. The computation

Add ONE pure exported function to `apps/web/src/sales-ops/calculations.ts`, immediately after
`isServiceProduct` (line ~57), keeping the product-shaped pure helpers together at the top of the file.
`calculations.ts` is confirmed as the right home: it already exports every pure sales-ops rule
(`defaultPlanShapeForProduct`, `resolveSaleCommissionDefaults`, `buildFuncaoCostBasis`, `isServiceProduct`),
and `SalesOpsApp.tsx` holds only state and calls them.

```ts
/** Upper bound of a produto code suffix: the API accepts `/^\d{1,2}$/`, so 0..99. */
export const MAX_PRODUCT_CODE_SUFFIX = 99;

/**
 * The suffix a NEW produto/serviço should start on: the highest suffix already in the
 * catalogue, plus one.
 *
 * `(org_id, code_suffix)` is UNIQUE and the index is not partial, so every existing row -
 * archived included, Produto and Serviço alike - permanently owns its number, and a
 * duplicate INSERT escapes as a 500 (createProduct does not map 23505). max + 1 is
 * therefore the next guaranteed-free value in a dense catalogue.
 *
 * Only strictly-shaped values (`/^\d{1,2}$/`, the same regex the API enforces) count
 * toward the max; anything else - a legacy free-text label, an over-wide value - is
 * ignored rather than coerced, because a coerced number could name a slot someone else
 * really holds.
 *
 * Never zero-padded: the stored value is text, `'07'` and `'7'` are two distinct rows
 * under the unique index, and the suffix is concatenated verbatim into every sale code.
 */
export function nextProductCodeSuffix(
  products: readonly Pick<SalesOpsProduct, 'codeSuffix'>[],
): string {
  const used = new Set<number>();
  for (const product of products) {
    const raw = product.codeSuffix;
    if (typeof raw !== 'string' || !/^\d{1,2}$/.test(raw)) continue;
    used.add(Number.parseInt(raw, 10));
  }
  if (used.size === 0) return '0';
  const next = Math.max(...used) + 1;
  if (next <= MAX_PRODUCT_CODE_SUFFIX) return String(next);
  // 99 is taken. Fall back to the lowest free slot so the suggestion stays saveable;
  // if the whole 0..99 space is exhausted no suffix can be saved at all, and '0'
  // reproduces exactly today's behaviour rather than inventing a new failure mode.
  for (let candidate = 0; candidate <= MAX_PRODUCT_CODE_SUFFIX; candidate += 1) {
    if (!used.has(candidate)) return String(candidate);
  }
  return '0';
}
```

### Every rule, stated

- **Collection scanned:** `bootstrap.products` - **all** produtos of the org, **both** `kind`s
  (`'product'` and `'service'`) and **both** `status`es (`'active'` and `'archived'`).
  Verified correct: the unique index has no `WHERE` clause and covers `(org_id, code_suffix)` for every
  row, and `listProducts` returns every row of the org unfiltered.
  Filtering by `kind` or by `status` would suggest a number that is already taken, i.e. would
  manufacture the 500.
- **Non-numeric / malformed value:** ignored.
  The gate is `/^\d{1,2}$/`, character for character the API's own regex.
  Web test fixtures already carry values like `'FIN'` and `'CST'`
  (`sale-wizard-state-preservation.test.tsx:54`, `sale-wizard-custom-item-labels.test.tsx:61`), and a
  legacy row could too.
  `'007'`, `'100'`, `' 7'` and `''` are likewise ignored - not trimmed, not truncated.
  A value that cannot round-trip through the API is not evidence that a slot is occupied, and coercing
  it would let a bogus label claim a real number.
- **`null` / `undefined` / absent:** the web type declares `codeSuffix: string` as required, so this is
  defensive only; the `typeof raw !== 'string'` guard drops it and it contributes nothing.
- **Empty catalogue (no products at all, or none with a parseable suffix): `'0'`.**
  Justification, and this is deliberate rather than arbitrary: `'0'` is the column default
  (`schema.ts:566`), the Zod default (`service.ts:179`), and the fallback `createSale` uses when an item
  has no produto (`service.ts:1942`).
  Starting at `'1'` would leave `0` orphaned forever, because `max + 1` never walks backwards into it, and
  it would put the web layer's notion of "the first suffix" out of step with the three server-side ones.
- **Upper bound: 99.** From `/^\d{1,2}$/` plus `maxLength={2}`.
- **Zero padding: none, ever.** `nextProductCodeSuffix` returns `String(n)`, so `7` is `'7'`.
  Padding to `'07'` would be a *different* value under the unique index and would change every sale code
  this produto generates. The `0000-` prefix on screen belongs to the sale sequence, not to the suffix.
- **Return type stays `string`.** No `null`, no new "unknown" state, so the seed slots into `productForm`
  without touching `ProductForm`'s shape or `submit()`'s coercion.

## 4. Wiring, and the edit-path guard

### 4.1 `productForm` gains a fifth positional parameter

`apps/web/src/sales-ops/SalesOpsApp.tsx:3037-3046`:

```ts
function productForm(
  product?: SalesOpsProduct,
  prefillName?: string,
  kindHint?: SalesOpsProductKind,
  funcaoCosts?: SalesOpsProductFuncaoCost[],
  /** Suggested suffix for a NEW record only; an existing product's own value always wins. */
  nextCodeSuffix?: string,
): ProductForm {
  return {
    // ...
    codeSuffix: product?.codeSuffix ?? nextCodeSuffix ?? '0',
```

**That single `??` chain IS the edit-path guard.**
`productForm` already receives `modal?.product`, and when it is present `product?.codeSuffix`
short-circuits before `nextCodeSuffix` is ever consulted - so opening an existing produto renders ITS
stored suffix and can never render a recomputed one.
This is character for character the shape the same function already uses one line above for
`name: product?.name ?? prefillName ?? ''`, which is the established precedent in this file for
"seed only on create".

`codeSuffix` cannot be a falsy-but-stored `''`: the column is `NOT NULL DEFAULT '0'` and `submit()`
coerces `|| '0'`, so `??` (not `||`) is both safe and correct here.
The trailing `?? '0'` keeps the parameter optional and preserves today's behaviour for any call site
that does not pass it.

### 4.2 `ProductDialog` / `ProductDialogBody` gain a `products` prop

- `ProductDialog` (`SalesOpsApp.tsx:3191`) gains **required** `products: SalesOpsProduct[]` and forwards
  it to `ProductDialogBody`.
  Required, not optional: there is exactly one production call site, and a required prop makes
  `pnpm run type-check` name every render site rather than letting a missed one silently fall back to
  "empty catalogue".
- `ProductDialogBody` (`SalesOpsApp.tsx:3224-3245`) takes `products` and passes the computed suggestion
  into the `useState` initializer:

```ts
const [form, setForm] = useState<ProductForm>(() =>
  productForm(
    modal?.product,
    modal?.prefillName,
    modal?.productKind,
    funcaoCosts,
    nextProductCodeSuffix(products),
  ),
);
```

The lazy initializer runs once per mount, and `ProductDialog` already remounts the body on every open via
its `key` (`SalesOpsApp.tsx:3208-3211`), so the suggestion is recomputed each time the dialog opens and
never re-derived mid-edit while the operator is typing.

- Production call site, `SalesOpsApp.tsx:1333-1351`, gains:

```tsx
products={persistedBootstrap.products}
```

matching its sibling props `areas={persistedBootstrap.areas}` / `funcoes={persistedBootstrap.funcoes}` /
`funcaoCosts={persistedBootstrap.productFuncaoCosts...}`.

### 4.3 Add the missing `aria-label`

The suffix `<input>` at `SalesOpsApp.tsx:3554-3564` has no accessible name at all - only a
`placeholder="0"`.
Add `aria-label="Final do código da venda"` to it.
This is required for the oracle test (the dialog suite's `labeledInput()` helper selects on
`input[aria-label="..."]`) and it is a genuine a11y fix: the visible `0000-` prefix is a sibling `<div>`,
not a `<label>`, so today a screen reader announces this field as an unnamed text box.
Nothing else about the control changes - keep `inputMode="numeric"`, `maxLength={2}`, the digit-stripping
`onChange` and the existing geometry exactly as they are.

## 5. Optimistic-write interaction (slice 01)

Verified in `apps/web/src/sales-ops/optimistic.ts`:

- `export type OptimisticCollection = 'areas' | 'clients' | 'people';` (line 23).
  **Products are NOT an optimistic collection today**, and the module doc-comment says so explicitly:
  *"every other sales-ops write is server-derived and waits for the refetch."*
- `withoutOptimisticRows` (lines 228-240) filters exactly `areas`, `clients` and `people`, and returns the
  snapshot **by reference** when nothing was filtered.
  So for `products`, `bootstrap.products` and `persistedBootstrap.products` are the same array by
  construction.
- Slice 01 in this batch is `funcao-optimistic`, i.e. it would add **`funcoes`** to the optimistic set,
  not `products`. It does not change this analysis.

**Decision:** read the `withoutOptimisticRows` snapshot (`persistedBootstrap.products`).
It is identical to the raw one today, so this costs nothing; it matches every sibling prop at the same
call site; and it is the reading that stays correct if products ever do become optimistic - an
optimistically inserted produto has an `optimistic:`-prefixed **id**, but it carries a real
`codeSuffix`, so a raw read would let an in-flight row that the server may still reject inflate the max
and silently skip a number.

There is one benign residual either way: because a product write is not optimistic, the dialog closes on
`onSuccess` and the suggestion for the *next* produto only advances once the invalidated bootstrap
refetch lands.
Two dialogs opened back-to-back inside that window would both suggest the same number.
The second save then fails on the unique index exactly as it does today - no regression - and in practice
the refetch resolves long before an operator can fill a second produto form.
Do **not** add client-side reservation state for this.

## 6. Slice 08 dependency note

This slice depends on `08-produto-wizard`, which restructures the produto dialog into a stepped wizard.
The seam chosen here is deliberately structural rather than positional, so it survives that refactor:

- `nextProductCodeSuffix` is pure and lives in `calculations.ts`, untouched by any JSX reshuffle.
- The seed happens inside `productForm`, which slice 08 keeps as the single `ProductForm` factory.

If slice 08 renames or splits `ProductDialogBody`, apply 4.2 to **whichever component owns the
`useState<ProductForm>` initializer** and thread `products` down to it.
If slice 08 moves the suffix control onto a different wizard step, the field keeps its label text
`Final do código da venda`, its `form.codeSuffix` binding and the new `aria-label` - only its container
moves.

Leave any *explanatory* copy about the suggestion to slice `10-info-hints`; do not add hint text here.

## 7. Oracle tests

### 7.1 `nextProductCodeSuffix` - pure unit test (primary oracle)

**File:** `apps/web/src/sales-ops/__tests__/calculations.test.ts` (the existing home for pure sales-ops
rule tests; add a `describe('nextProductCodeSuffix', ...)` block, import from `../calculations`).

Cases, all required:

| # | Input `codeSuffix` values | Expected | Pins |
| --- | --- | --- | --- |
| 1 | `[]` | `'0'` | empty catalogue starts at the column/Zod default, not at 1 |
| 2 | `['0']` | `'1'` | the ordinary first increment |
| 3 | `['0', '3', '7']` | `'8'` | **max**, not count and not lowest-free: gaps at 1, 2, 4-6 are NOT filled |
| 4 | `['7', '0', '3']` (unordered) | `'8'` | order-independent |
| 5 | `['FIN', 'CST']` | `'0'` | non-numeric values are ignored entirely, and ignoring them all is the empty case |
| 6 | `['2', 'FIN', '007', '100', '', ' 5']` | `'3'` | only `'2'` is strictly-shaped; `'007'`, `'100'`, `''` and `' 5'` contribute nothing |
| 7 | `['9', '10']` | `'11'` | numeric max, not lexicographic (`'9' > '10'` as strings would give `'10'`) |
| 8 | `['99']` | `'0'` | 99 taken, `max + 1` overflows, lowest free slot wins |
| 9 | `['0', '99']` | `'1'` | same overflow path with 0 also taken |
| 10 | every value `'0'`..`'99'` | `'0'` | exhausted space returns the documented `'0'`, does not throw or return `'100'` |
| 11 | archived + `kind: 'service'` rows present | counted | pass rows carrying `status: 'archived'` and `kind: 'service'` and assert they still raise the max, pinning "scan everything" |

Case 3 is the one that decides the slice: it is the difference between "max + 1" (requested) and
"lowest free", and it must stay `'8'`.
Case 7 is the one that catches a `.sort()`-based implementation.

### 7.2 Edit path preserves the stored value - render test

**File:** `apps/web/src/sales-ops/__tests__/product-service-dialog.test.tsx` (already imports
`ProductDialog` from `../SalesOpsApp` and has the `renderDialog` / `labeledInput` / `text()` harness).

Extend `RenderOptions` with `products?: SalesOpsProduct[]` and pass `products={options.products ?? []}`
into the `<ProductDialog>` render, then add:

1. **Create path suggests max + 1.**
   Render with `products: [product({ codeSuffix: '3' }), product({ id: <other-uuid>, codeSuffix: '7' })]`
   and **no** `existing`; assert
   `labeledInput('Final do código da venda').value === '8'`.
2. **Edit path is untouched (the required assertion).**
   Render with the SAME `products` list AND `existing: product({ codeSuffix: '3' })`; assert
   `labeledInput('Final do código da venda').value === '3'` - the stored value, never the recomputed `8`.
3. **Serviço create path behaves identically.**
   Render with `productKind: 'service'`, no `existing`, and the same `products`; assert `'8'`.
   Pins that the suggestion is not accidentally gated on `kind`.
4. *(Optional, cheap)* submit case 1 and assert the `onSave` payload carries `codeSuffix: '8'`, proving
   the seed survives `submit()`'s `.replace(/\D/g, '').slice(0, 2) || '0'` coercion.

### 7.3 Compile-level fallout

Making `products` required means these render sites must be updated or `pnpm run type-check` fails.
Pass `products={[]}` unless the test is specifically about the suggestion:

- `apps/web/src/sales-ops/__tests__/product-commission-editor.test.tsx` - two sites (lines ~86, ~234)
- `apps/web/src/sales-ops/__tests__/areas-view.test.tsx` - one site (line ~251)
- `apps/web/src/sales-ops/__tests__/combobox-adoption.test.tsx` - one site (line ~652)
- `apps/web/src/sales-ops/__tests__/product-service-dialog.test.tsx` - the `renderDialog` helper

(`optimistic-row-guard.test.tsx` only *mentions* `ProductDialog` in a comment; it renders nothing.)

## 8. Files to modify

- `apps/web/src/sales-ops/calculations.ts` - add `MAX_PRODUCT_CODE_SUFFIX` + `nextProductCodeSuffix`.
- `apps/web/src/sales-ops/SalesOpsApp.tsx` - `productForm` fifth param and `??` chain;
  `ProductDialog` / `ProductDialogBody` `products` prop; call site at ~1333;
  `aria-label` on the suffix input.
- `apps/web/src/sales-ops/__tests__/calculations.test.ts` - the 11 pure cases.
- `apps/web/src/sales-ops/__tests__/product-service-dialog.test.tsx` - harness prop + 3-4 render cases.
- `apps/web/src/sales-ops/__tests__/product-commission-editor.test.tsx`,
  `areas-view.test.tsx`, `combobox-adoption.test.tsx` - `products={[]}` on each render site.

No API change, no migration, no schema change.

## 9. Risks

- **The unhandled 23505 stays unhandled.**
  This slice makes the collision far less likely but cannot make it impossible: an operator can still
  type a taken number by hand, and two operators in one org can race.
  The failure is a bare HTTP 500 with no message.
  Log a follow-up doubt to map `sales_ops_products_org_code_suffix_idx` to
  `400 { error: 'validation_error', reason: 'duplicate_code_suffix' }` in `createProduct` / `updateProduct`,
  following the `FUNCAO_UNIQUE_VIOLATIONS` precedent at `service.ts:1417-1431`.
- **Gaps are never reclaimed by design.**
  With suffixes `{0, 5}` the suggestion is `6`, not `1`.
  This is exactly what was requested ("higher current código + 1") and it is the more predictable rule
  for an operator, but it does mean an org that archives produtos will slowly walk toward the 99 ceiling.
  The overflow fallback in the function is what catches that, and case 8 pins it.
- **Silent behaviour change on the create path.**
  An operator used to seeing `0` will now see a number.
  This is the requested change and the value remains fully editable; no migration or backfill is implied,
  and no existing produto's stored suffix is touched.
- **Do not zero-pad, ever.**
  A well-meaning "make it look like the `0000-` prefix" edit that emits `'07'` would create a value
  distinct from `'7'` under the unique index and would change every sale code the produto generates.
  The doc-comment on `nextProductCodeSuffix` says this; keep it there.
