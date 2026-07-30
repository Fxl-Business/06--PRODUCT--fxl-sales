# exec-09 - produto: default `Final do código da venda` to max + 1

Slice: `09-produto-codigo-default`.
Branch: `feat/09-produto-codigo-default`.
Plan: `nexo/plans/batch-01K9NX4QPTUI0730CADPRODWIZ/09-produto-codigo-default.md`.

## What changed

### `apps/web/src/sales-ops/calculations.ts`

Added `MAX_PRODUCT_CODE_SUFFIX = 99` and the pure exported `nextProductCodeSuffix(products)`, placed
immediately after `isServiceProduct` so the product-shaped pure helpers stay together at the top of the file.
Implemented verbatim from the plan: strict `/^\d{1,2}$/` gate, `Math.max(...used) + 1`, empty catalogue is
`'0'`, overflow past 99 falls back to the lowest free slot and then to `'0'` on full exhaustion.
Never zero-pads.

### `apps/web/src/sales-ops/SalesOpsApp.tsx`

- `productForm` gained an optional fifth positional parameter `nextCodeSuffix`, and the seed line is now
  `codeSuffix: product?.codeSuffix ?? nextCodeSuffix ?? '0'`.
  That `??` chain IS the edit-path guard, mirroring the `name: product?.name ?? prefillName ?? ''` one line
  above; a comment on the line says so and says why it is `??` and not `||`.
- `ProductDialog` gained a **required** `products: SalesOpsProduct[]` prop and forwards it to
  `ProductDialogBody`.
- `ProductDialogBody` destructures `products` and passes `nextProductCodeSuffix(products)` into the lazy
  `useState<ProductForm>` initializer.
  Slice 08 kept `ProductDialogBody` as the single owner of that initializer, so 4.2 of the plan applied
  unchanged despite the four-step wizard restructure.
- The production call site now passes `products={persistedBootstrap.products}`, matching its sibling
  `areas` / `funcoes` / `funcaoCosts` props.
- The suffix `<input>` gained `aria-label="Final do código da venda"`.
  Nothing else about the control changed: `inputMode="numeric"`, `maxLength={2}`, the digit-stripping
  `onChange` and the geometry are untouched.
  The control still lives on wizard step 1 (`Identificação`), where slice 08 put it.

### Tests

- `apps/web/src/sales-ops/__tests__/calculations.test.ts` - a `describe('nextProductCodeSuffix')` block
  covering all 11 plan cases (11 `it`s; two of the plan's rows are paired inside the overflow test, and the
  `MAX_PRODUCT_CODE_SUFFIX` bound got its own).
- `apps/web/src/sales-ops/__tests__/product-service-dialog.test.tsx` - `RenderOptions` gained
  `products?: SalesOpsProduct[]`, `renderDialog` passes `products={options.products ?? []}`, and 5 render
  cases were added (create / edit / serviço create / empty catalogue / submit payload).
- Compile-level fallout from making the prop required, all `products={[]}`:
  `product-commission-editor.test.tsx` (2 sites), `areas-view.test.tsx` (1), `combobox-adoption.test.tsx` (1).

## Red then green

### Red

Tests written first, run against unmodified source:

```
❯ src/sales-ops/__tests__/calculations.test.ts (31 tests | 11 failed) 15ms
   × nextProductCodeSuffix > starts an empty catalogue at the column default 0
   × nextProductCodeSuffix > increments the ordinary single-row case
   × nextProductCodeSuffix > takes the max and never fills a gap
   × nextProductCodeSuffix > is order-independent
   × nextProductCodeSuffix > ignores non-numeric suffixes, and a catalogue of only those is the empty case
   × nextProductCodeSuffix > counts only strictly-shaped values, exactly as the API regex does
   × nextProductCodeSuffix > orders numerically, not lexicographically
   × nextProductCodeSuffix > falls back to the lowest free slot once 99 is taken
   × nextProductCodeSuffix > returns 0 rather than 100 when the whole space is exhausted
   × nextProductCodeSuffix > counts archived rows and serviço rows too
   × nextProductCodeSuffix > bounds the domain at 99, matching the API regex and the input maxLength
❯ src/sales-ops/__tests__/product-service-dialog.test.tsx (51 tests | 5 failed) 258ms

 Test Files  2 failed (2)
      Tests  16 failed | 66 passed (82)
```

The distinct failure reasons, i.e. the real ones and not a harness accident:

```
TypeError: (0 , nextProductCodeSuffix) is not a function
AssertionError: expected undefined to be 99 // Object.is equality
Error: input not found: Final do código da venda
AssertionError: expected "spy" to be called with arguments: [ Array(1) ]
```

That is exactly the three gaps the slice closes: the function does not exist, the constant does not exist,
and the suffix input has no accessible name.
The fourth is the submit-payload case, whose `onSave` diff showed `"codeSuffix": "0"` where `'8'` was
expected - the old hardcoded default.

### Green

```
✓ src/sales-ops/__tests__/calculations.test.ts (31 tests) 19ms
✓ src/sales-ops/__tests__/product-service-dialog.test.tsx (51 tests) 246ms

 Test Files  2 passed (2)
      Tests  82 passed (82)
```

## Gates

| Gate | Result |
| --- | --- |
| `pnpm test` - web | `Test Files 39 passed (39)` / `Tests 409 passed (409)` (baseline 393, +16 new, none lost) |
| `pnpm test` - api | `Test Files 29 passed (29)` / `Tests 300 passed (300)` (unchanged) |
| `pnpm test` - shared-utils | `Test Files 2 passed (2)` / `Tests 23 passed (23)` (unchanged) |
| `pnpm run lint` | clean (`apps/api lint: Done`, `apps/web lint: Done`) |
| `pnpm run type-check` | clean (all four projects `Done`) |

## Edge cases covered

| # | Input `codeSuffix` values | Expected | Pins | Where |
| --- | --- | --- | --- | --- |
| 1 | `[]` | `'0'` | empty catalogue starts at the column/Zod default, not at 1 | unit |
| 2 | `['0']` | `'1'` | ordinary first increment | unit |
| 3 | `['0','3','7']` | `'8'` | **max**, not lowest-free: gaps at 1, 2, 4-6 stay unfilled. The assertion that decides the slice | unit |
| 4 | `['7','0','3']` | `'8'` | order-independent | unit |
| 5 | `['FIN','CST']` | `'0'` | non-numeric ignored entirely; ignoring all of them is the empty case | unit |
| 6 | `['2','FIN','007','100','',' 5']` | `'3'` | only `'2'` is strictly shaped; `'007'`, `'100'`, `''`, `' 5'` contribute nothing | unit |
| 7 | `['9','10']` | `'11'` | numeric max, not lexicographic - catches a `.sort()` implementation | unit |
| 8 | `['99']` | `'0'` | 99 taken, `max + 1` overflows, lowest free slot wins | unit |
| 9 | `['0','99']` | `'1'` | same overflow path with 0 also taken | unit |
| 10 | every value `'0'`..`'99'` | `'0'` | exhausted space returns `'0'`, does not throw and does not return `'100'` | unit |
| 11 | `status: 'archived'` + `kind: 'service'` rows | counted (`'7'`) | the unique index has no `WHERE` clause, so both still own their number | unit |
| 12 | catalogue `{3, 7}`, create path | input shows `'8'` | the wiring reaches the rendered field | render |
| 13 | catalogue `{3, 7}`, `existing.codeSuffix = '3'` | input shows `'3'` | **the edit path is untouched** - stored value, never the recomputed 8 | render |
| 14 | catalogue `{3, 7}`, `productKind: 'service'` | input shows `'8'` | the suggestion is not gated on `kind` | render |
| 15 | `products: []`, create path | input shows `'0'` | the empty-catalogue fallback survives the render path | render |
| 16 | catalogue `{3, 7}`, submit | `onSave` payload `codeSuffix: '8'` | the seed survives `submit()`'s `.replace(/\D/g,'').slice(0,2) || '0'` coercion | render |

## Decisions confirmed against the current tree

- **Optimistic collections.** `apps/web/src/sales-ops/optimistic.ts:31` now reads
  `export type OptimisticCollection = 'areas' | 'clients' | 'funcoes' | 'people';` - slice 01 added
  `funcoes`, and **products are still not optimistic**, exactly as the plan predicted.
  So `persistedBootstrap.products` and `bootstrap.products` are the same array by reference today.
  Took `persistedBootstrap.products` deliberately, per section 5: it matches every sibling prop at the same
  call site and it is the reading that stays correct if products ever do become optimistic.
- **Slice 08 restructure.** `ProductDialogBody` is a four-step wizard
  (`Identificação` / `Valores` / `Pagamento` / `Comissões e custos`) and still owns the single
  `useState<ProductForm>` initializer, so the seam the plan chose survived untouched.
  `ProductDialog`'s existing `key` already remounts the body per open, so the suggestion is recomputed on
  every open and never re-derived mid-edit.

## Divergence from the plan

- **Line numbers only.** Every cited line had moved (slices 01-08 merged first); matched by content.
- The plan's 11-row unit table became 11 `it` blocks rather than a 1:1 row mapping: its rows 8 and 9 are the
  same overflow behaviour and share one test, and a separate test pins `MAX_PRODUCT_CODE_SUFFIX === 99`.
  Every listed assertion is present.
- Added one render case beyond the plan's 3 + 1 optional: the empty-catalogue create path (`'0'`), which is
  cheap and pins that the render path does not accidentally seed `''` when the org has no produtos.
- `product-service-dialog.test.tsx` already had a `codeSuffixInput()` helper selecting on
  `input[inputmode="numeric"]`; left it in place and used the plan's `labeledInput(...)` for the new cases,
  which is what the new `aria-label` exists for.
- No `npx prettier` run, per `nexo/knowledge/decisions/2026-07-30-no-npx-prettier.md`.

## Out of scope, confirmed for filing

`createProduct` in `apps/api/src/domains/sales-ops/service.ts` is still a plain `INSERT ... RETURNING` with
**no** 23505 handling - re-read on the current tree to confirm.
`createFuncao` has the `FUNCAO_UNIQUE_VIOLATIONS` map (`service.ts:1405`) as precedent; `createProduct` has
no equivalent, so a duplicate `sales_ops_products_org_code_suffix_idx` violation still escapes as a bare
HTTP 500 with no operator-readable message.
Not fixed here, per the slice brief.
Follow-up: map that constraint to
`400 { error: 'validation_error', reason: 'duplicate_code_suffix' }` in `createProduct` / `updateProduct`.
This slice makes the collision far less likely (the seeded value is guaranteed free in a dense catalogue)
but cannot make it impossible: an operator can still type a taken number by hand, and two operators in one
org can race.
