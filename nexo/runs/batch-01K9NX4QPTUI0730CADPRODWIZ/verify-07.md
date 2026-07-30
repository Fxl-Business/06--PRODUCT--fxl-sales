# Verify 07 - servico-base-value

**Verdict: FAIL** (one blocking finding; everything else is solid)

Branch `feat/07-servico-base-value`, uncommitted. Reviewed via `git diff` / `git status` only.
Executor notes were not read.

## Command results

| Command | Baseline | Actual | Result |
| --- | --- | --- | --- |
| `pnpm test` (web) | 382 tests / 39 files | **384 passed / 39 files** | PASS (+2) |
| `pnpm test` (api unit) | 300 tests / 29 files | **300 passed / 29 files** | PASS (exact) |
| `pnpm --filter @fxl-sales/api test:integration` | 101 tests / 19 files | **101 passed / 19 files** | PASS (exact) |
| `pnpm run lint` | clean | clean | PASS |
| `pnpm run type-check` | clean | clean | PASS |

No `.skip`, `.only` or `todo(` added anywhere in the diff.
No em dash introduced in the diff or in either untracked new file.

The integration count holding at exactly 101 is correct, not a masked deletion: the two touched
integration files rewrote assertions inside existing `it()` blocks rather than adding or removing
cases.

## The six decisive checks

### 1. Migration real and correctly registered - PASS

- `apps/api/drizzle/0015_servico_base_value.sql` exists and is a single
  `ALTER TABLE "sales_ops_products" DROP CONSTRAINT "sales_ops_products_service_no_fixed_value_check"`.
- `_journal.json` gains `{"idx": 15, "version": "7", "when": 1785444287052, "tag": "0015_servico_base_value"}`.
- `apps/api/drizzle/meta/0015_snapshot.json` exists, `version 7` / `postgresql`, and its `prevId`
  (`bb7a5276-610d-4a33-b996-aed5ea470090`) chains exactly to the `0014` snapshot's `id`.
  The dropped constraint appears zero times in it; the remaining five product CHECKs are intact.
- It genuinely applied. Queried the live test DB directly: `drizzle.__drizzle_migrations` holds 16
  rows, the newest with `created_at = 1785444287052`, matching the journal's `when` to the
  millisecond. `pg_constraint` for `sales_ops_products` now lists exactly
  `default_entrada_mode`, `default_installments`, `default_recurring_cycles`, `kind`, and
  `kind_open_price` - `service_no_fixed_value` is gone.

This is not a silent no-op; it will run in staging.

### 2. `openPrice` and its CHECK untouched - PASS

`sales_ops_products_kind_open_price_check` (`(kind = 'service') = open_price`) is untouched in
`schema.ts` (the diff removes only the adjacent `service_no_fixed_value` `check()` call) and is
present in the live DB and in the 0015 snapshot. The migration file carries an explicit comment
stating it was deliberately left alone. The integration test additionally asserts
`priced.product.openPrice === true` after a Serviço takes a 500000-cent base value, proving the
projection survives the new write path.

### 3. The zero case - **FAIL (blocking)**

Split verdict.

**List half: PASS.** `apps/web/src/sales-ops/__tests__/produtos-servicos-view.test.tsx:236` asserts
`expect(cellUnder('Valor').textContent?.trim()).toBe('Variável')` against the `servico()` fixture,
which is `setupBrl: 0` with no mensalidade. That is an explicit, real, direct assertion on the zero
case, and the new sibling test at :246 adds the negative control (`not.toBe('Variável')` when a base
value exists). The production cell branches on `productBaseValueBrl(product) > 0`, so 0 still prints
`Variável` and never `R$ 0,00`.

**Dialog half: FAIL.** `Definido na venda` was not preserved for the zero case - it was deleted
outright. `DefinedOnSaleNotice` is removed from `SalesOpsApp.tsx` and the field is now an
unconditional `<Input type="number">`. Because `productForm` seeds it with
`centsToInput(product?.setupBrl)` and `centsToInput(0)` returns the string `"0"`, **every existing
Serviço - all of which store 0 - now opens the dialog showing `Valor base (R$): 0`** where it
previously showed the dashed "Definido na venda" affordance.

That is exactly the silent display change the criterion warned about, and it contradicts the
slice's own stated principle. The diff's new comment in `ProductsView` justifies keeping `Variável`
in the list on the grounds that `R$ 0,00` "would be a lie about a price nobody set" - and then the
dialog prints precisely that lie for the same row.

The criterion is satisfiable without giving up the feature: keep the input editable, seed it blank
when `setupBrl === 0`, and render `Definido na venda` as its placeholder. The zero-state affordance
survives, and typing a base value still works.

There is also **no assertion at all** for the zero-value Serviço's dialog display. The only related
line is `expect(text()).not.toContain('Definido na venda')`
(`product-service-dialog.test.tsx:353`), which pins the *removal* rather than the zero case. Nothing
in the suite would catch this regression.

### 4. `isServiceProduct` stays the single branch point - PASS

Grepped every added line in the diff for `kind ===` / `kind !==` / `'service'` / `'product'`. Zero
scattered discriminator comparisons in production code; all hits are test fixtures, CLAUDE.md prose,
or the `productForm` seed that CLAUDE.md already documents as the one allowed direct read.

`productBaseValueBrl` is a clean single seam: all five consumers (the list `Valor` cell and the four
wizard unit-price prefills at 5185, 5793, 5812 and the item-patch path) go through it, and no
residual `setupBrl || monthlyBrl` derivation remains. The helper is deliberately kind-blind, which
is right - both kinds' values are defaults, so the prefill arithmetic is identical.

### 5. CLAUDE.md updated and accurate - PASS (one imprecision)

Read the four rewritten bullets against the code. Verified accurate:

- Both kinds may carry an own value; `0` is the whole expression of "no base value" - correct, no
  separate flag exists.
- All four enforcement points are genuinely gone: the DB CHECK (verified live), the
  `service_cannot_have_fixed_value` refine (removed from `validateProductFields`), the
  `INVALID_PRODUCT_KIND_VALUE` sentinel with its `updateProduct` merged-row guard and `routes.ts`
  400 branch (all three removed), and the dialog's `isService ? 0 :` coercion.
- `kind_open_price_check` deliberately not relaxed - correct.
- "`apps/web` now has ZERO readers of the column" - correct; grep finds only the `types.ts`
  declaration, two comments, and test fixtures.
- The `Valor` cell rule and the `Valor base (R$)` / `Setup (R$)` label split - both correct.
- "the step-1 negotiated-value gate still blocks" - correct; `needsNegotiatedValue: isService` and
  `"0"` is not `> 0`.

One imprecision (Finding 5): "the wizard prefills nothing" - it actually prefills the string `"0"`.
Inert for the gate, but the wording is wrong.

The doc is accurate about itself. What it does not cover is the adjacent comment invalidated by the
same diff - see Finding 2.

### 6. The schema-migration test edit - PASS

It was not hollowed out; it is arguably stronger than before. The edit is legitimate and correct:

- `inPreMigrationSandbox` now drops `LIVE_PRODUCT_CHECKS` (2) instead of `POST_BACKFILL_CHECKS` (3),
  which is forced - `DROP CONSTRAINT` on a name 0015 already removed would error.
- The 0013 ordering oracle at :242 is untouched and still inline-`ADD`s all three constraints
  including `service_no_fixed_value` inside the sandbox, so 0013's backfill-before-CHECK ordering
  remains genuinely proven.
- The final test still pins the live schema, and now pins the deletion positively:
  `expect(names).not.toContain('sales_ops_products_service_no_fixed_value_check')`, plus the three
  unrelated default-plan CHECKs it always asserted. It asserts strictly more than it did before.

## Adversarial checks

**The oracle is genuine - PASS.** `product-funcao-costs-rls.test.ts` inverts the raw-admin statement
correctly and it is a real DB round trip, not a zod-level test:

```ts
await expect(
  adminClient`UPDATE sales_ops_products SET setup_brl = 5000 WHERE id = ${serviceB.product.id}`,
).resolves.toBeDefined();
const [rawB] = await adminClient`SELECT setup_brl FROM sales_ops_products WHERE id = ${serviceB.product.id}`;
expect(rawB?.setup_brl).toBe(5000);
```

This bypasses the service layer entirely over the admin connection. Only a dropped DB constraint can
make it resolve, and the follow-up `SELECT` proves the value persisted. The migration is proven.

**Values read back from the DB - PASS.** The same test re-reads through `listProducts` after the
patches and asserts `storedA.setupBrl === 500000` / `storedA.monthlyBrl === 20000`, explicitly
commented as "not just on the RETURNING clause". It also carries a dedicated untouched control row
(`serviceB`) asserting `setupBrl 0`, `monthlyBrl 0`, `openPrice true`, `kind 'service'` - a genuine
API-level zero-case no-regression assertion, ordered before the raw UPDATE that later mutates it.

**Scope creep - one instance, see Finding 3.**

**No em dash introduced.**

## Findings

### Finding 1 - BLOCKING. Every existing Serviço now shows `0` in the dialog

`apps/web/src/sales-ops/SalesOpsApp.tsx` (`DefinedOnSaleNotice` deleted, `Valor base (R$)` field).
Detailed under decisive check 3. The operator asked for an *optional* base value; the implementation
removed the zero-state affordance that told the operator the value is set on the proposta, and
replaced it with a literal `0` for the overwhelmingly common case. Contradicts the slice's own
justification for keeping `Variável` in the list, and no test covers it.

Fix is narrow: seed the input blank when `setupBrl === 0`, add `placeholder="Definido na venda"`,
and add one dialog test asserting the zero-value Serviço state.

### Finding 2 - Now-false doc comment left behind in `types.ts`

`apps/web/src/sales-ops/types.ts:90-96`, on `kind?: SalesOpsProductKind`, still reads:

> Absent is read as a Produto, which is the conservative direction: it keeps every per-item
> requirement in place rather than relaxing one on a row we cannot classify.

After this diff the opposite is true. `productRowRequirements` no longer consults `openPrice`, so an
unclassified open-price row now requires neither a description nor a negotiated value - reading it
as a Produto *relaxes* every per-item requirement. The comment's entire stated rationale is
inverted. CLAUDE.md itself is accurate, but this comment is now actively misleading and sits on the
exact field the change turns on.

### Finding 3 - Scope creep: `openPrice` dropped as a fallback discriminator

`productRowRequirements` collapsed to `hasVariableValue: isService` and `needsDescription: false`.
For rows that satisfy the DB CHECK this is behavior-identical (`openPrice` is provably equal to
`kind === 'service'`), so real-world risk is low - `kind` is `NOT NULL DEFAULT 'product'` and the
API always returns it.

But it is a separate concern from "a Serviço may have a base value", and it changed behavior for the
unclassified-row case that `types.ts` explicitly documents as reachable. It required weakening
assertions in three wizard test files: `sale-wizard-ui-contract.test.tsx` (an open-price non-Serviço
now expects `toBeNull()` where it expected an `HTMLInputElement`),
`sale-wizard-service-description.test.tsx` (two tests inverted), and
`sale-wizard-custom-item-labels.test.tsx` (fixture gained `kind`, and the label-blocking assertions
were deleted from "blocks advancement until every custom row has a label").

The rewritten tests are honest about what they now assert and add positive controls, so this is not
a cover-up - but it is unrequested scope that should be called out and consciously accepted.

### Finding 4 - Minor. Dead constant

`POST_BACKFILL_CHECKS` in `apps/api/test/rls/produtos-servicos-schema-migration.test.ts:16` is now
defined but never referenced (only named in a comment). Not caught because `pnpm run lint` runs
`eslint src/` and this file lives under `test/`.

### Finding 5 - Minor. CLAUDE.md imprecision

"the wizard prefills nothing" - it prefills the string `"0"` via `centsToInput(0)`.

## Assessment

The engineering underneath this slice is good. The migration is real, registered, snapshot-chained
and verified applied against the live DB. The `openPrice` CHECK is correctly left alone with an
explicit rationale. The load-bearing oracle is a genuine inverted raw-admin write with a persisted
read-back. The single-seam discipline is respected. The schema-migration test came out stronger. All
five commands are green with no test-count drop.

It fails on one thing: decisive check 3's dialog half. The zero-state affordance was removed rather
than preserved, every existing Serviço's dialog display changed as a side effect, and nothing
asserts the zero case in the dialog. That is the specific regression the criteria named in advance,
so it blocks the merge. The fix is small and does not disturb any of the work above; Findings 2 and
4 are cheap enough to bundle into the same pass.
