# exec-07 - Serviço base value

Plan: `nexo/plans/batch-01K9NX4QPTUI0730CADPRODWIZ/07-servico-base-value.md`
Branch: `feat/07-servico-base-value` (trunk `master`, base `1431db2`)

> **Two cycles.** Cycle 1 is recorded below as originally written.
> Gate 2 then failed on one blocking regression plus four smaller findings; see "Cycle 2" at the end, which supersedes parts of cycle 1.
> Where the two disagree, cycle 2 is the truth.

## What changed

The documented invariant "a Serviço has no own value" is deleted, along with all four of its enforcement points.
A Serviço now carries a BASE VALUE in `setup_brl` / `monthly_brl` - a per-proposta default exactly like every other number in the product dialog.
`0` remains the whole expression of "no base value", so nothing about an existing Serviço changed.

### API

- `apps/api/src/db/schema.ts` - dropped the `sales_ops_products_service_no_fixed_value_check` entry; rewrote the `openPrice` column comment so it can never be re-read as "has no own value".
  The other two CHECKs (`kind_check`, `kind_open_price_check`) are untouched.
- `apps/api/src/domains/sales-ops/service.ts`
  - deleted the `service_cannot_have_fixed_value` refine from `validateProductFields`, plus the now-unused `resolvedKind` local and the `setupBrl?` / `monthlyBrl?` keys on `ProductFieldsForValidation`;
  - rewrote the `validateProductFields` docblock (the entrada block is now the only merged-row rule) and the `ProductKindSchema` docblock;
  - deleted the `INVALID_PRODUCT_KIND_VALUE` sentinel and made the `INVALID_PRODUCT_ENTRADA_VALUE` docblock self-contained;
  - deleted the `kindMerged` guard from `updateProduct` and narrowed its return type to `Promise<ProductWithCosts | typeof INVALID_PRODUCT_ENTRADA_VALUE | null>`.
    `const kind = resolveProductKind(...)` and the `entradaMerged` guard both stay.
- `apps/api/src/domains/sales-ops/routes.ts` - removed the sentinel import and its `400 service_cannot_have_fixed_value` branch.

### Web

- `apps/web/src/sales-ops/calculations.ts` - added `productBaseValueBrl(product)` immediately below `isServiceProduct`, returning `setupBrl || monthlyBrl` in integer cents.
  `isServiceProduct` is unchanged and stays the only discriminator branch; `productBaseValueBrl` is now the only place a catalog own value is read.
- `apps/web/src/sales-ops/SalesOpsApp.tsx`
  - deleted `DefinedOnSaleNotice` and both call sites, and the amber `Serviços têm valor variável, definido em cada proposta.` banner;
  - `Setup (R$)` is an ordinary `<Input>` for both kinds, labelled `Valor base (R$)` when the kind is Serviço;
  - the mensalidade input lost its `isService` swap;
  - the submit handler stops zeroing: `setupBrl: parseCurrencyToCents(...)`, `monthlyBrl: form.hasMonthly ? ... : 0`.
    The `!hasMonthly -> 0` rule survives - it is about the toggle, not the kind;
  - the list `Valor` cell prints `formatMoneyBrl(productBaseValueBrl(product))` when non-zero and the muted `Variável` when zero;
  - the edit-path `customLabel` prefill now asks `isServiceProduct(product)` instead of `product?.openPrice`;
  - the three unit-price prefills (`prefill`, `setItem`, `addItem`) go through `productBaseValueBrl`;
  - `productRowRequirements` dropped the redundant `openPrice` term: `hasVariableValue` and `needsNegotiatedValue` are now plain `isService`, `needsDescription` collapsed to the literal `false` it already evaluated to. It is still returned, because `:6410` destructures it.

`apps/web` now has ZERO readers of `openPrice` - only the `types.ts` declaration and two explanatory comments mention it.

### Docs

`CLAUDE.md` "Produtos & Serviços" bullets 2-5 replaced with the plan's drafted wording.

## The migration

`apps/api/drizzle/0015_servico_base_value.sql`, produced by `pnpm --filter @fxl-sales/api db:generate` after the schema edit.

Generated output was **exactly one statement, no drift**:

```sql
ALTER TABLE "sales_ops_products" DROP CONSTRAINT "sales_ops_products_service_no_fixed_value_check";
```

Registration, following the repo's hand-named convention (`0013_produtos_servicos_defaults`, `0014_sale_professional_funcoes`):

1. drizzle-kit emitted `drizzle/0015_motionless_grandmaster.sql`, `drizzle/meta/0015_snapshot.json`, and appended `{"idx": 15, "tag": "0015_motionless_grandmaster"}` to `drizzle/meta/_journal.json`;
2. renamed the `.sql` to `0015_servico_base_value.sql` and rewrote the journal `"tag"` to `"0015_servico_base_value"` (drizzle's `migrate()` resolves files by the journal tag);
3. kept the generated snapshot verbatim - it is the diff baseline for 0016;
4. prepended the plan's header comment, including the note that the down path is only replayable against a database whose serviços are all still at zero.

`sales_ops_products_kind_open_price_check` was NOT touched.

## Red-then-green evidence

### RED - before any implementation

API unit contract (ORACLE 2):

```
 FAIL  src/domains/sales-ops/__tests__/produtos-servicos-contract.test.ts > accepts a base value on a servico exactly as on a produto
AssertionError: expected false to be true // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 12 passed (13)
```

Web dialog + list (ORACLES 3 and 4):

```
 × renders editable base value inputs for a serviço and submits them
   → expected 'Novo serviçoValor variável, custos po…' to contain 'Valor base (R$)'
 × preserves the own value when a produto is reclassified as a serviço
   → {"monthlyBrl": 50000, "setupBrl": 100000} vs received {"monthlyBrl": 0, "setupBrl": 0}
 × prints the base value in the Valor column when a serviço carries one
   → expected 'Variável' to be 'R$ 5.000'
 × falls back to the mensalidade when a serviço has no setup but does recur
   → expected 'Variável' to be 'R$ 200'
 Test Files  2 failed (2)
      Tests  4 failed | 46 passed (50)
```

Integration (ORACLES 1 and 5) - the load-bearing pair:

```
 FAIL  test/rls/product-funcao-costs-rls.test.ts > a servico persists a base value, and one left alone stays at zero
Error: unexpected patch outcome
 ❯ test/rls/product-funcao-costs-rls.test.ts:317:54
    316|     const priced = await updateProduct(db, orgA, serviceA.product.id, …
    317|     if (typeof priced === 'string' || !priced) throw new Error('unexpe…

 FAIL  test/rls/produtos-servicos-schema-migration.test.ts > rolls the sandbox back so the live schema keeps its CHECK constraints
AssertionError: expected [ …(6) ] to not include 'sales_ops_products_service_no_fixed_v…'

 Test Files  2 failed | 17 passed (19)
      Tests  2 failed | 99 passed (101)
```

The inverted raw-admin `UPDATE sales_ops_products SET setup_brl = 5000` sits after those assertions in the same `it`, so it was unreachable while `updateProduct` still returned the sentinel.
Its own red proof is the second failure above: the constraint was physically present on the live schema, and only `0015` can remove it.

### GREEN - after implementation

```
packages/shared-utils test:  Test Files  2 passed (2)
packages/shared-utils test:       Tests  23 passed (23)
apps/api test:  Test Files  29 passed (29)
apps/api test:       Tests  300 passed (300)
apps/web test:  Test Files  39 passed (39)
apps/web test:       Tests  384 passed (384)
```

```
$ pnpm --filter @fxl-sales/api test:integration
 Test Files  19 passed (19)
      Tests  101 passed (101)
```

`pnpm run lint`, `pnpm run type-check` and `pnpm run build` all clean.

Counts against the stated baselines: api unit 300/29 unchanged; web 384/39 (baseline 382/39 plus the two new `Valor` column cases); integration 101/19 unchanged.

## Zero-case no-regression evidence

Four independent pins, all passing, none of them modified to accommodate the feature:

1. **API schema** - `it('accepts a servico with no own value')` (`produtos-servicos-contract.test.ts`) kept verbatim.
2. **API persistence** - inside the new ORACLE 1 `it`, Serviço B is created and never patched, then re-read through `listProducts`:
   `setupBrl === 0 && monthlyBrl === 0 && openPrice === true && kind === 'service'`.
   This is the negative control that proves the relaxation is opt-in per row.
3. **Web dialog** - `it('sends kind service when the serviço segment is active')` kept verbatim, still asserting `toMatchObject({kind: 'service', setupBrl: 0, monthlyBrl: 0})` on an untouched serviço.
4. **Web list** - `it('renders the serviço column set with variável value, ...')` kept verbatim, still asserting `cellUnder('Valor').textContent === 'Variável'` for the zero-valued `servico()` fixture.

The wizard's zero case is pinned by `it('still blocks a serviço item whose negotiated value is zero')`, which passes unchanged: `needsNegotiatedValue` stays `true` for every Serviço, base value or not.

## Divergences from the plan

Three, all forced by content the plan did not enumerate. None changes the plan's design.

### 1. `UpdateProductSchema partials every field while keeping the invariants`

`apps/api/src/domains/sales-ops/__tests__/produtos-servicos-contract.test.ts` carries a second assertion of the deleted refine that §6 ORACLE 2 does not name:

```ts
expect(UpdateProductSchema.safeParse({ kind: 'service', setupBrl: 100 }).success).toBe(false);
```

Flipped to `true` with a comment, matching the flip the plan does specify one test above it.
The adjacent `{ kind: 'service', openPrice: false }` line stays `false` - that is the `kind_open_price_conflict` rule, which survives.

### 2. The pre-migration sandbox in `produtos-servicos-schema-migration.test.ts`

§6 ORACLE 5 says `POST_BACKFILL_CHECKS` is used two ways and to change only the live-schema `it`.
It is actually used three ways: `inPreMigrationSandbox` also drops the whole list to build the sandbox, and `DROP CONSTRAINT` on a name 0015 already removed raises `constraint ... does not exist`, which failed five tests in that file.

Fix: the sandbox drop list is `LIVE_PRODUCT_CHECKS` (what the live schema actually has).
`POST_BACKFILL_CHECKS` still exists and is still used by `it('leaves the backfilled table able to take the three post-backfill CHECK constraints')`, which replays 0013 as shipped and re-adds all three inside the rolled-back transaction.
This is the same split the plan asked for, applied at the site the plan missed; `backfillStatements()` and the 0013 file are untouched.

### 3. Seven web tests pinning the "open price but not a Serviço" row

§4.5(i) states the `needsDescription` collapse is faithful because that row state is impossible under `kind_open_price_check`, and predicts the surrounding suites will "catch a wrong removal".
In fact three suites pin the impossible state directly through fixtures that set `openPrice: true` with `kind` absent or `kind: 'product'`, so they failed on a *correct* removal.

- `sale-wizard-custom-item-labels.test.tsx` (4 tests): the fixture never set `kind` at all, so every row read as a Produto and nothing rendered.
  Modernized the factory to `kind: openPrice ? 'service' : 'product'` - the only shape the DB CHECK admits.
  A Serviço's description is opt-in, so three tests gained a `revealDescription(row)` helper click, and `blocks advancement until every custom row has a label and positive negotiated value` became `... has a positive negotiated value`, now asserting the description error count is `0` while the value error still fires.
  The suite's real subjects - per-row label independence, the catalog-name fallback, and a fixed-price row rendering no description field - are all still pinned.
- `sale-wizard-service-description.test.tsx` (2 tests) and `sale-wizard-ui-contract.test.tsx` (1 test): rather than delete the dead-branch tests, converted them into pins that `openPrice` is no longer read at all.
  An open-price row whose `kind` is absent is now read as an ordinary Produto: no description field, no reveal affordance, no variable-value copy, and no row-level gate.
  Each kept a positive control on the real Serviço in the same bootstrap.
  Test counts are unchanged, and the new assertions are strictly stronger than the old ones.

One incidental finding recorded while adapting them: the open-price-produto row still cannot advance step 1 at `setupBrl: 0`, but now because of the proposta-wide `canSaveBasics = canSave && totalCents > 0` rule rather than any per-row requirement. That distinction is stated in the test comment.

## Deploy note (from §8, unchanged)

The API build does not apply migrations. Staging and production must run `db:migrate` BEFORE the new API image serves traffic: the zod refine that used to catch a valued Serviço is gone, so an old database would surface a raw `23514` as a 500. Deploy order is migrate, then release.

---

# Cycle 2 - Gate 2 remediation

Gate 2 failed with one blocking regression and four smaller findings. All five are addressed below.
Everything the verifier passed (the migration, the untouched `open_price` CHECK, the single-seam predicate, the schema-migration test, the five commands) was left alone.

## Finding 1 (BLOCKING) - the zero state lost its affordance

**Real.** `productForm` seeds `setupBrl: centsToInput(product?.setupBrl)` and `centsToInput(0)` returns the string `"0"`, so deleting `DefinedOnSaleNotice` outright meant every existing Serviço - all of which store 0 - opened the dialog showing `Valor base (R$): 0`.
That is a price nobody set, and it is exactly the lie the `ProductsView` comment I wrote in cycle 1 justifies avoiding in the list. The two surfaces contradicted each other for the same row.
Cycle 1 had no assertion for the zero-value dialog at all: the only nearby line, `expect(text()).not.toContain('Definido na venda')`, pins the removal, not the zero case.

### The fix

- New `centsToOptionalInput(cents)` in `SalesOpsApp.tsx`: `cents ? centsToInput(cents) : ''`. Used by `productForm` for `setupBrl` and `monthlyBrl` **only**.
- Both money inputs gained `placeholder={isService ? 'Definido na venda' : '0'}`.

So the field stays editable and a base value can be typed, but the zero state reads `Definido na venda` again, and a blank field still parses to 0 on submit - this changes what the operator sees and never what is written.

`centsToInput` itself is untouched. That is deliberate: it has 20+ other call sites including every wizard `unitBrl` and `costBrl` prefill, where blanking 0 would change step-1 gating and the professional-cost rows. The new helper is scoped to the two catalog money fields that mean "nobody set a value".

### Why the seed is kind-blind and only the placeholder is kind-aware

`productForm` runs once inside a `useState` initializer, and `ProductDialogBody`'s remount `key` is `product?.id ?? new-${productKind}-${prefillName}` - it does **not** include `form.kind`.
The `Produto | Serviço` segmented control mutates form state without remounting, so a seed that branched on the kind would go stale the instant an operator toggled it.
The placeholder is read at render time, where `isService` is already live, so it tracks the toggle correctly.

This mirrors `productBaseValueBrl`, which the plan also made deliberately kind-blind.

### The Produto-at-zero question the coordinator asked me to reason about

A Produto whose setup is genuinely 0 is now seeded blank too, showing a ghosted `0` placeholder where it previously showed a literal `0`.
I chose this over a Serviço-only blank for the staleness reason above, and it is not a surprising change:

- visually it reads the same, a `0` in the box, only greyed;
- it submits identically, because a blank parses to 0;
- it is arguably better, since an operator typing a setup no longer has to clear a `0` first.

`it('keeps the own-value inputs editable for a produto')` and `it('submits the app-default plan when nothing is touched')` both still pass unchanged, which pins that the Produto path did not move.

### Red then green

New oracle `it('keeps definido na venda as the zero state for a serviço with no base value')`, opening the dialog on an existing `kind: 'service'` row with `setupBrl: 0, hasMonthly: true, monthlyBrl: 0`, asserting both fields are `value === ''` with `placeholder === 'Definido na venda'`.

RED, against cycle 1's code:

```
 FAIL  src/sales-ops/__tests__/product-service-dialog.test.tsx > keeps definido na venda as the zero state for a serviço with no base value
AssertionError: expected '0' to be '' // Object.is equality
- Expected
+ Received
+ 0
 ❯ src/sales-ops/__tests__/product-service-dialog.test.tsx:393:24
```

GREEN, after the fix: `Test Files 1 passed (1) / Tests 39 passed (39)`.

A second test, `it('seeds the stored base value of a serviço that has one')`, is the positive control: `setupBrl: 500000` seeds `'5000'` and `monthlyBrl: 20000` seeds `'200'`, proving the blank is about the value being 0 and not about the kind. It passed on first run, which is what makes the RED above specific to the zero case.

## Finding 3 - scope creep: I chose (b), restore the `openPrice` fallback

The coordinator was right, and so was the preference for (b). Restored.

`productRowRequirements` is back to `hasVariableValue = Boolean(product?.openPrice) || isService` with `needsDescription = hasVariableValue && !isService`, and the wizard's edit-path `customLabel` prefill is back to `product?.openPrice`.
`git checkout` reverted all three wizard test files to master, so their original, stronger assertions are restored and my cycle-1 weakenings are gone.

Three reasons, beyond diff size:

1. **It is orthogonal.** The base value only required the three MONEY reads to change, because only those conflated `openPrice` with "has no own value". The two CLASSIFICATION reads were never part of this slice's subject.
2. **The fallback is strictly safer where it can fire.** If a row's `kind` never arrives (`kind?` is optional on the web type for exactly this reason), dropping the fallback made it read as a fixed-price Produto with **no negotiated-value gate at all**, so a Serviço could reach a proposta at R$ 0. Keeping it preserves the gate. `needsDescription` is cosmetic; `needsNegotiatedValue` is money.
3. **Weakening assertions to accommodate an unrelated refactor is the wrong trade.** Three files had to be loosened to make cycle 1's version pass; that was the signal.

Note this contradicts the plan, which explicitly specified the collapse (§4.5(i)) and drafted CLAUDE.md wording claiming "ZERO readers". The plan's own reasoning - that the state is impossible under `kind_open_price_check` - is correct **about the database** but not about a client-side row whose `kind` field is optional. I have corrected the CLAUDE.md bullet rather than let the repo carry a false claim.

Net: `apps/web` has exactly **two** `openPrice` reads left, both classification fallbacks, and **zero** money reads.

## Finding 2 - the stale `types.ts` comment

Restoring the fallback made the original sentence true again: an absent `kind` really does keep every per-item requirement in place.
Rather than leave it merely-true-by-luck, I extended the docblock to name the mechanism (`productRowRequirements` falling back to `openPrice`) and to state that the fallback governs REQUIREMENTS only, while the money question goes through `productBaseValueBrl` and consults neither flag.

## Finding 4 - dead `POST_BACKFILL_CHECKS`

**Confirmed genuinely unused before deleting**, as asked. `grep` showed only the declaration and one mention inside a comment I had written; the 0013 replay test spells all three constraint names out in its own `ADD CONSTRAINT` string rather than using the constant.
Removed it, folded the useful half of its docblock into `LIVE_PRODUCT_CHECKS`, and reworded the sandbox comment that referenced it. The replay test is unchanged and still pins 0013 as shipped.

## Finding 5 - CLAUDE.md imprecision

Corrected. The zero-state sentence now reads that the dialog seeds the field **blank with a `Definido na venda` placeholder** (naming `centsToOptionalInput`) and that the wizard prefills `"0"` into the item's `Valor negociado` - not "prefills nothing".
The `openPrice` bullet was rewritten in the same pass to describe the two surviving classification reads and why they are deliberately not folded into `isServiceProduct`.

## Definition of done, re-run

```
apps/api test:  Test Files  29 passed (29)
apps/api test:       Tests  300 passed (300)
apps/web test:  Test Files  39 passed (39)
apps/web test:       Tests  386 passed (386)
packages/shared-utils test:  Test Files 2 passed (2) / Tests 23 passed (23)

$ pnpm --filter @fxl-sales/api test:integration
 Test Files  19 passed (19)
      Tests  101 passed (101)
```

`pnpm run lint` and `pnpm run type-check` both clean.

Counts against the stated baselines: api unit 300/29 held; integration 101/19 held; web 386/39, which is the 384 baseline plus this cycle's two new dialog oracles. Nothing lost - the three reverted wizard files returned to their original assertions at their original counts.

## Cycle 2 diff summary

| File | Change |
| --- | --- |
| `apps/web/src/sales-ops/SalesOpsApp.tsx` | added `centsToOptionalInput`; `productForm` uses it for the two money fields; both inputs gained a kind-aware placeholder; `productRowRequirements` and the `customLabel` prefill reverted to the `openPrice` fallback |
| `apps/web/src/sales-ops/types.ts` | `kind?` docblock names the fallback mechanism and the requirements/money split |
| `apps/web/src/sales-ops/__tests__/product-service-dialog.test.tsx` | new `moneyInput` helper; two new oracles (zero state + valued positive control) |
| `apps/web/src/sales-ops/__tests__/sale-wizard-{custom-item-labels,service-description,ui-contract}.test.tsx` | reverted to master |
| `apps/api/test/rls/produtos-servicos-schema-migration.test.ts` | dead `POST_BACKFILL_CHECKS` removed, comments reworded |
| `CLAUDE.md` | zero-state sentence corrected; `openPrice` bullet rewritten |
