# Verify 07b - servico-base-value (RE-verification)

**Verdict: PASS**

Branch `feat/07-servico-base-value`, uncommitted working tree, judged against `master`.
I did not read `exec-07.md`, `verify-07.md`, or any agent note.
No source file was committed, merged, pushed, or left modified; `git status --porcelain` at the end is byte-identical to what I found.

## Commands

| Command | Result | Baseline | Verdict |
| --- | --- | --- | --- |
| `pnpm test` (web) | **386 passed / 39 files** | 382 / 39 | PASS (+4) |
| `pnpm test` (api unit) | **300 passed / 29 files** | 300 / 29 | PASS |
| `pnpm test` (shared-utils) | 23 passed / 2 files | - | PASS |
| `pnpm --filter @fxl-sales/api test:integration` | **101 passed / 19 files** | 101 / 19 | PASS |
| `pnpm run lint` | clean, exit 0 | - | PASS |
| `pnpm run type-check` | clean, exit 0 | - | PASS |

No failures, no unhandled errors, exit 0 on every command.

The `+4` web delta is fully accounted for: two new `it`s in `product-service-dialog.test.tsx` (zero state, valued positive control) and two in `produtos-servicos-view.test.tsx` (`Valor` column, mensalidade fallback).
Two further `it`s were renamed in place with inverted assertions, not deleted.
API unit and integration counts are flat because their changes are assertion flips and added `expect`s inside existing `it`s, not removals.

`git diff master | grep '^+'` for `.skip` / `.only` / `todo(` / `xit(` / `xdescribe`: **no matches**.
`git diff master | grep '^+.*—'` (em dash): **no matches**.

## THE check that failed last time - the zero case

**PASS, with a real oracle proven by mutation.**

Code, `apps/web/src/sales-ops/SalesOpsApp.tsx:431-433`:

```ts
function centsToOptionalInput(cents: number | undefined): string {
  return cents ? centsToInput(cents) : '';
}
```

Seeded at `:3127` (`setupBrl`) and `:3129` (`monthlyBrl`), so **both** money fields get the treatment - the mensalidade is not left behind.
The placeholder is kind-aware and read at render time (`:3662`, `:3695`): `placeholder={isService ? 'Definido na venda' : '0'}`.
That split is correct and deliberate - `productForm` runs in a `useState` initializer and the dialog remount key excludes `form.kind`, so a kind-branching *seed* would go stale on a `Produto | Serviço` toggle while a kind-branching *placeholder* cannot.

Blank still submits 0: `setupBrl: parseCurrencyToCents(form.setupBrl)` at `:3472`, and `parseCurrencyInputToCents('')` is 0.
Pinned by the pre-existing `sends kind service when the serviço segment is active` test, which now genuinely exercises that path (`setupBrl: 0, monthlyBrl: 0`) rather than passing trivially through the deleted `isService ? 0 :` coercion.
Typing still works: `renders editable base value inputs for a serviço and submits them` types `2500` and asserts `setupBrl: 250000`.

The new oracle, `product-service-dialog.test.tsx:378-402`, opens the dialog on a stored Serviço with `setupBrl: 0, hasMonthly: true, monthlyBrl: 0` and asserts on both fields:

```ts
expect(base.value).toBe('');
expect(base.placeholder).toBe('Definido na venda');
expect(monthly.value).toBe('');
expect(monthly.placeholder).toBe('Definido na venda');
```

Its positive control (`seeds the stored base value of a serviço that has one`) asserts `'5000'` / `'200'` on a valued Serviço, so the blank is proven to be about the value being 0 and not about the kind.

**Mutation test.** I reverted the seed to the old behaviour (`return centsToInput(cents);`) and ran the file:

```
× keeps definido na venda as the zero state for a serviço with no base value
  → expected '0' to be '' // Object.is equality
```

Exactly one test failed, and it is the new one. Restored byte-identically; `shasum -a 256 -c` OK and `git status --porcelain` diffed clean against the pre-mutation snapshot.
`pnpm run lint` and `pnpm run type-check` were both run *after* the restore; `pnpm test` was run *before* the mutation on a file with the identical hash.

## The other checks

**1. Migration real, registered, and applied. PASS.**
`apps/api/drizzle/0015_servico_base_value.sql` exists and is a single `ALTER TABLE "sales_ops_products" DROP CONSTRAINT "sales_ops_products_service_no_fixed_value_check";`.
Registered in `meta/_journal.json` as `idx: 15`, tag `0015_servico_base_value`.
Snapshot chain is intact: `0015_snapshot.json.prevId` = `bb7a5276-610d-4a33-b996-aed5ea470090` = `0014_snapshot.json.id`.
The 0015 snapshot lists exactly `kind_check`, `kind_open_price_check`, and the three entrada/installment/cycles checks - `service_no_fixed_value_check` is gone, `kind_open_price_check` is retained.

It genuinely ran. I queried the live test DB directly:

```
SELECT count(*) FROM drizzle.__drizzle_migrations;  -> 16   (0000..0015)
SELECT conname FROM pg_constraint WHERE conrelid='sales_ops_products'::regclass AND contype='c';
  sales_ops_products_default_entrada_mode_check
  sales_ops_products_default_installments_check
  sales_ops_products_default_recurring_cycles_check
  sales_ops_products_kind_check
  sales_ops_products_kind_open_price_check
```

This is not a silent no-op: the integration assertion at `produtos-servicos-schema-migration.test.ts:385` (`expect(names).not.toContain('sales_ops_products_service_no_fixed_value_check')`) runs against the live schema outside any sandbox, so a `.sql` that never ran would have failed the suite.

The down path is undocumented as a file but is stated in the migration header (the original `ADD CONSTRAINT` from 0013), with the honest caveat that it only replays against a database whose serviços are all still at zero. Acceptable for a drop-only migration.

**2. `openPrice` and its CHECK untouched. PASS.**
`git diff master -- apps/api/src/db/schema.ts` removes only the `service_no_fixed_value` `check(...)` block; the `sales_ops_products_kind_open_price_check` block is not in the diff.
Live DB confirms the definition is unchanged: `CHECK (((kind = 'service'::text) = open_price))`.
The server-written projection at `service.ts:1664` / `:1717` (`openPrice: kind === 'service'`) is untouched, and the RLS test now positively asserts `priced.product.openPrice === true` after a Serviço takes a base value.

**3. `isServiceProduct` stays the single branch point. PASS.**
Repo-wide grep for `=== 'service'` outside tests returns 6 hits. All three web hits (`calculations.ts:48`, `SalesOpsApp.tsx:902`, `:2352`, `:3351`) are byte-identical to `master` - I confirmed via `git show master:...`. The two API hits are the `openPrice` projection writes. **The diff introduced zero new `kind === 'service'` comparisons.**
`productBaseValueBrl` is the one added predicate, in `calculations.ts:66-69`, kind-blind by construction (`Pick<SalesOpsProduct, 'setupBrl' | 'monthlyBrl'>` - it cannot see `kind`, which is a stronger guarantee than a comment).
All three former inline `product.openPrice ? 0 : product.setupBrl || product.monthlyBrl` sites in the wizard now route through it, and the arithmetic is provably identical on every pre-0015 row.

Remaining `openPrice` reads in `apps/web/src` (non-test) are exactly two, matching the CLAUDE.md claim character for character: `productRowRequirements` (`:5797`) and the edit-path `customLabel` prefill (`:4947`). No money read consults it.

**4. `CLAUDE.md` updated and accurate. PASS, with one loose clause (see Findings).**
I verified each load-bearing claim against the code:
- "the product dialog seeds the field BLANK with a `Definido na venda` placeholder (`centsToOptionalInput`)" - correct, `:431`, `:3127/:3129`, `:3662/:3695`.
- "the list prints `Variável` instead of `R$ 0,00`" - correct, `:2445-2456`.
- "the wizard prefills `\"0\"` into an item's `Valor negociado`" - correct; `centsToInput(0)` returns `'0'`.
- "the step-1 negotiated-value gate still blocks" - correct; `:5561` is `parseCurrencyToCents(item.unitBrl) > 0`, and `'0'` fails it.
- "all four of its enforcement points" removed (DB CHECK, zod refine, `INVALID_PRODUCT_KIND_VALUE` + merged-row guard + routes 400 branch, dialog `isService ? 0 :` coercion) - all four confirmed removed in the diff.
- "`DefinedOnSaleNotice` and the `Serviços têm valor variável...` banner are deleted" - confirmed.
- "exactly two CLASSIFICATION reads" of `openPrice` in `apps/web` - confirmed by grep.
- "the `Valor` cell prints `productBaseValueBrl` when non-zero, `Variável` when `0`" - confirmed.
- "The dialog names that same number `Valor base (R$)` for a Serviço and `Setup (R$)` for a Produto" - confirmed, `:3655`.

**5. No test hollowed out. PASS.**

*Restored-assertions audit,* diffed against `master`:

- `productRowRequirements` (`SalesOpsApp.tsx:5796-5804`) - the function **body is byte-identical to `master`**. I compared `git show master:...` output against the branch line for line. Only the docblock above it grew. The reported scope-creep revert is genuine.
- `product-service-dialog.test.tsx` - the two rewritten tests are *stronger*, not weaker. `replaces every own-value input with the definido na venda notice` became `renders editable base value inputs for a serviço and submits them`, which keeps the negative controls (`not.toContain('Definido na venda')`, `not.toContain('Serviços têm valor variável')`) *and* adds a submit-path assertion. `zeroes the own value when a produto is reclassified as a serviço` became `preserves the own value`, with the same two assertions inverted rather than dropped. Nothing was deleted; the file gained net assertions.
- `produtos-servicos-view.test.tsx` - purely additive, two new `it`s. No existing assertion touched.
- `produtos-servicos-contract.test.ts` - three `.success` expectations flipped `false` -> `true`. Each flip is the intended semantic change, and each retains its adjacent Produto positive control. The `kind: 'service', openPrice: false` conflict assertion at `:284` is untouched, so the `kind_open_price` refine is still pinned.
- `apps/api/test/rls/produtos-servicos-schema-migration.test.ts` - **genuinely still pins the schema, not relaxed to pass.** The constant was renamed `POST_BACKFILL_CHECKS` -> `LIVE_PRODUCT_CHECKS` with one entry dropped, which is *required*: `inPreMigrationSandbox` issues `DROP CONSTRAINT` on each name, and dropping a constraint that no longer exists is a hard error. The 0013-replay test (`:281-285`) still spells out all **three** original constraints in its own literal `ADD CONSTRAINT`, byte-identical to `master`, so the migration is still pinned *as shipped* rather than as the live schema now looks. The final test *gained* an assertion (`not.toContain(...service_no_fixed_value_check)`) rather than losing one - the change states the drop rather than silently un-asserting it.

**6. Comments and dead code. PASS.**

- `apps/web/src/sales-ops/types.ts:91-100` - the `kind` docblock now correctly separates the two questions: the absent-`kind` fallback is scoped to *requirements* (`productRowRequirements` reading `openPrice`), and the money question is explicitly routed to `productBaseValueBrl`, "which reads setupBrl/monthlyBrl directly and never consults either flag". That matches the code exactly.
- `POST_BACKFILL_CHECKS` - **not deleted, renamed**, and no live reference was lost. `git grep POST_BACKFILL_CHECKS master` shows three references, all inside its own file (declaration + two use sites), plus the plan doc. Both use sites were carried over to `LIVE_PRODUCT_CHECKS`. The 0013 replay test never referenced the constant on `master` either - it uses a literal `ADD CONSTRAINT` block, which is unchanged. No live reference deleted.
- `INVALID_PRODUCT_KIND_VALUE` removal is complete: the export, its `updateProduct` return-type union, the merged-row guard, the `routes.ts` import, and the `service_cannot_have_fixed_value` 400 branch all went together. Repo-wide grep finds no dangling reference outside test comments. No dead error string left behind.
- The `schema.ts` and `service.ts` docblocks that asserted "a Serviço carries no own price" were both inverted correctly rather than left stale.

## Adversarial checks

**DB oracle exercises the DB, not zod. PASS.**
`apps/api/test/rls/product-funcao-costs-rls.test.ts:359-368` runs over `adminClient` (the `app.fxl_admin` superuser connection), bypassing the service layer entirely:

```ts
await expect(
  adminClient`UPDATE sales_ops_products SET setup_brl = 5000 WHERE id = ${serviceB.product.id}`,
).resolves.toBeDefined();
const [rawB] = await adminClient`SELECT setup_brl FROM sales_ops_products WHERE id = ${serviceB.product.id}`;
expect(rawB?.setup_brl).toBe(5000);
```

This is precisely the assertion that on `master` read `.rejects.toThrow(/sales_ops_products_service_no_fixed_value_check/)`, flipped to `resolves` with a read-back. Only the dropped CHECK can make it pass. It is raw SQL, so no zod refine and no service code participates.
The same test also carries a dedicated no-regression control (`serviceB`, never patched) asserting `setupBrl: 0, monthlyBrl: 0, openPrice: true, kind: 'service'` still hold for an untouched Serviço.

**Scope creep. None found.**
The 13 modified files plus 2 new migration artifacts are all within the slice. `productRowRequirements` - the one reported creep - is byte-identical to `master`. The only untracked non-slice entry is `.vscode/`, which was already untracked before this branch's work began and is not part of the diff.

**UI consistency.** The Serviço `Valor` cell uses `sales-ops-num px-4 py-3 text-right text-[13.5px]` and `formatMoneyBrl(..., { maximumFractionDigits: 0 })` - byte-identical styling and formatting to the Produto `Setup` cell one branch over, under an already-right-aligned `Valor` header. It only falls back to the muted grey `#9b9ba3` for the `Variável` zero state, which is the pre-existing treatment. Nothing lines up wrong.

## Findings (all minor, none blocking)

1. **`CLAUDE.md` leading clause is looser than the code.** "`productBaseValueBrl` beside it is the one place a catalog own value is read" overstates: the Produto `Setup` / `Mensalidade` list columns (`SalesOpsApp.tsx:2480`, `:2484`) and the wizard's recurring-block prefill (`:5447`) still read `setupBrl` / `monthlyBrl` directly. The *next* sentence scopes it correctly ("Every unit-price prefill and the Serviço `Valor` column go through it"), and that scoped claim is the one that governs future call sites and is exactly true, so the invariant a future reader would act on is sound. Worth tightening the first clause to "the one place a row's *suggested unit price* is derived" on the next touch.

2. **Undocumented, benign behavior expansion in the wizard's recurring block.** `SalesOpsApp.tsx:5444` (unchanged code) is `Boolean(primaryItemProduct?.hasMonthly && primaryItemProduct.monthlyBrl > 0)`. On `master` that could never be true for a Serviço, because the DB CHECK pinned its `monthlyBrl` at 0; it now can be. So a Serviço carrying a base mensalidade will auto-suggest `recurringMode: 'monthly'` prefilled with that amount. This is the correct and desirable consequence of the slice, and the zero case is provably unaffected (`monthlyBrl: 0` still yields `suggested === false`), but it is a real behavior expansion with no test and no line in `CLAUDE.md`.

3. **Cosmetic.** `productBaseValueBrl(product)` is evaluated three times inside the `Valor` cell expression (`:2447`, `:2452`, `:2453`). Trivially cheap, but a `const` would read better.

None of these affects correctness, the zero case, or the migration, so none of them blocks the merge.

## Verdict

**PASS.** The regression that failed the first pass is fixed at the right seam, is covered by an oracle I proved would catch a revert, and covers the mensalidade field as well as the base value. The migration is real, registered, chain-correct, and confirmed applied against the live test database. The `openPrice` CHECK is untouched. No test was hollowed out - the two rewritten wizard tests gained assertions, the schema-migration test gained one, and `productRowRequirements` is byte-for-byte back to `master`. All four command gates are green with no count regression.
