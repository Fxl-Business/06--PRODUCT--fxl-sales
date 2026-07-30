# Verify - slice 08 service-description-optional

Verdict: **PASS**

Branch `feat/08-service-description-optional`, one commit `045bd72` on top of `master` (`aa1f3e4`).
Diff is 4 files: `apps/web/src/sales-ops/SalesOpsApp.tsx`, `calculations.ts`, `types.ts`, and one new test file `__tests__/sale-wizard-service-description.test.tsx`.

## 1. Gates

All four run from the repo root, all exit 0.

| Gate | Exit |
| --- | --- |
| `pnpm run lint` | 0 |
| `pnpm run type-check` | 0 |
| `CI=true pnpm test` | 0 |
| `pnpm run build` | 0 |

Test totals against the branch-point baseline:

| Project | Baseline | Now | Delta |
| --- | --- | --- | --- |
| apps/web | 30 files / 210 tests | 31 / 220 | +1 file, +10 tests |
| apps/api | 27 / 283 | 27 / 283 | unchanged |
| packages/shared-utils | 1 / 17 | 1 / 17 | unchanged |

The +10 is exactly the ten `it` blocks in the one new file, so nothing was removed and nothing else was added.

## 2. The fused-predicate trap

The shipped `itemsValid` reads two independent booleans out of one `productRowRequirements` helper:

```ts
const { needsDescription, needsNegotiatedValue } = productRowRequirements(product);
const valueOk = !needsNegotiatedValue || parseCurrencyToCents(item.unitBrl) > 0;
const descriptionOk = !needsDescription || Boolean(item.customLabel.trim());
return valueOk && descriptionOk && Boolean(product?.areaId);
```

The checks are genuinely separated. Proven by mutation, not by reading.

### M1 - the naive fused relaxation (the actual trap)

Replaced the split with the fused form that exempts a serviço from the whole boolean, so the description relaxation drags the value requirement with it:

```ts
const openPriceOk =
  !product?.openPrice ||
  isServiceProduct(product) ||
  (Boolean(item.customLabel.trim()) && parseCurrencyToCents(item.unitBrl) > 0);
```

Result: **1 failed / 9 passed**.
The failure is exactly `still blocks a serviço item whose negotiated value is zero`, with `expected '...' to contain 'Cliente e responsáveis'` - the wizard advanced past step 1 when it should have blocked.
The value requirement cannot be dropped without a test going Red.

### M2 - the literal original fused form, no relaxation

Result: **5 failed / 5 passed**, including the primary acceptance test `advances step 1 with a serviço item whose description is blank`.
So the relaxation itself is genuinely exercised, not just asserted.

## 3. The confound - is the anti-regression test vacuous?

The brief's concern is real and I tested it in both directions.

`canAdvanceStepOne = canSaveBasics && itemsValid`, and `canSaveBasics` already demands `totalCents > 0`. A lone zero-value row is therefore blocked by the total even when `itemsValid` wrongly passes, which would make the test prove nothing.

The shipped test parks a positively priced produto (`FXL Finance`, `setupBrl: 250000`) in row 2 to satisfy the total. To confirm that row is load-bearing rather than scenery, I kept M1 applied and removed the row-2 setup from the test:

- shipped test (row 2 present) under M1: **Red**
- same test with row 2 removed, under M1: **green**

That is conclusive. Without row 2 the test would be vacuous; with it, `itemsValid` is the only thing that can block, so the per-row value rule is the actual subject. The implementer's confound analysis is correct and the mitigation works.

## 4. Truth table

| Row | Status |
| --- | --- |
| Serviço, blank description -> advances; `productNameSnapshot` is the catalog name | **Proven.** Two tests; both Red under M2. Payload asserted to be `'Consultoria FXL'`, non-empty, and not a raw uuid. |
| Item avulso (`productId` null), blank name -> still blocks | **Proven.** M4 (drop the `customLabel` check from the free branch) turns `keeps the description required for a free-form item avulso` Red. |
| Open-price **Produto**, blank description -> still blocks | **Proven for the reachable variant.** See below. M3 (`needsDescription: false`) turns `keeps the description required for an open-price row that is not a serviço` Red. |
| Serviço, blank description AND zero value -> still blocks | **Proven.** Red under M1. |

## 5. The unreachable-branch judgement

Slice 07's constraint is real. `apps/api/drizzle/0013_produtos_servicos_defaults.sql:61`:

```sql
ALTER TABLE "sales_ops_products" ADD CONSTRAINT "sales_ops_products_kind_open_price_check"
  CHECK (("sales_ops_products"."kind" = 'service') = "sales_ops_products"."open_price");
```

So `kind='product'` with `openPrice=true` is impossible for any API-sourced row. The implementer's reasoning checks out, and it follows that for any API row `hasVariableValue === isService`, i.e. every variable-value catalog row in production today is a Serviço and gets the optional description. That is precisely the requested behaviour, not a defect.

**Ruling: correct to skip, and the branch is nonetheless defensively pinned anyway.**

The implementer declined to fabricate a DB-impossible `kind='product' + openPrice=true` fixture, which is right - pinning a state that can never occur documents a fiction. But it did not leave the branch bare. Because the web mirror makes `kind` optional, the *reachable* analogue is `kind` absent with `openPrice: true` (a stale bootstrap, a locally constructed row, any response that predates the column), and the test pins exactly that via `unclassifiedOpenPriceId`. M3 confirms that pin is failure-capable. This is the better of the two options: the defensive coverage the brief wanted, parameterized on the state that can actually happen.

## 6. Persistence, not rendering

`productName` reaches the wire from one place, `SalesOpsApp.tsx:4372`, as `saleItemDisplayName(item)`; the item-avulso path at `:4362` terminates in `'Item avulso'`. `saleItemDisplayName` now terminates every chain in the literal `'Produto'`, so an empty string cannot be emitted.

M5 (reverting the terminator to `item.customLabel.trim() || product.name`) turns the whitespace test Red with `expected '' not to be ''`, confirming the hole is real and genuinely closed.

**One inaccuracy to report.** The code comment and the commit message both justify this with "ProductSchema.name is `.min(1)` without `.trim()`". That is false. `ProductSchema = ProductFieldsSchema.superRefine(...)` (`service.ts:205`) and `ProductFieldsSchema.name` is `z.string().trim().min(1).max(140)` (`service.ts:174`) - at `master` too, so it was wrong when written. A whitespace-only catalog name is already rejected at the API boundary. The defensive fallback is still correct and worth keeping (legacy rows predating the trim, any future loosening), and the behaviour is right; only the stated rationale is wrong. Documentation accuracy issue, not a defect.

## 7. The out-of-plan file

`git show 5859b80 --stat` confirms slice 07 touched **zero** web files - 15 files, all under `apps/api/`. The web mirror really was left declaring a `type` column the API had renamed away, with no `kind`.

The addition is minimal: a `SalesOpsProductKind = 'product' | 'service'` union plus one optional field, with a doc comment. `type: string` is left in place, so nothing else churns.

Optional is the right call, and "absent reads as Produto" is genuinely the safe default: absent means `isServiceProduct` returns false, which *withholds* a relaxation rather than granting one. The failure mode is asymmetric and benign - the worst case is an operator being asked for a description they could have skipped, never a wrong or empty snapshot. It cannot silently block a legitimate serviço in practice either, since the API selects and returns `kind` (`service.ts:578`), so real serviço rows always carry it.

## 8. Anti-gaming

`git diff master..feat/08-service-description-optional -- '*test*'` shows exactly one file, and it is new. Zero existing test files were edited, deleted, skipped, `.only`'d or loosened. No `.only(`, `.skip(`, `xit(` or `xdescribe(` in added lines.

`sale-wizard-ui-contract.test.ts` is unchanged, and correctly needed no change. `sale-wizard-custom-item-labels.test.tsx` is also unchanged and still passes - its fixtures are `kind`-less open-price products, so they land on the conservative branch where the description stays required, and its expectations are untouched by design.

The frozen `aria-label` `Nome / descrição do item ${index + 1}` is intact at `SalesOpsApp.tsx:4801`; only the visible `<span>` label gained the `(opcional)` variant. The eight existing queries in `sale-wizard-custom-item-labels.test.tsx` all still resolve.

## 9. Scope discipline

Against `### Scope limits (YAGNI)` in `00-OVERVIEW.md`: clean.

- `apps/api/**` untouched - the diff is four files, all under `apps/web/src/sales-ops/`.
- No change to the status machine, payables/receivables materialization, or the `"N/M"` / `"MN/M"` conventions.
- No parallel description field and no migration. The existing `items[].productName` -> `productNameSnapshot` path is reused exactly as `CLAUDE.md` requires.
- No touch to `navigation.ts`, the `AppRole` rules, the legacy route trees, i18n extraction, or any charting surface.
- Nothing belonging to slices 04, 09, 10, 11 or 12.

## 10. The deliberate deviation - lifting into `productRowRequirements`

The plan's Refactor note said not to lift the requirement pair into a helper. The implementer lifted it anyway. **I judge this acceptable, and better than the plan.**

The two call sites are the validity gate and that gate's error rendering. That is a correctness coupling, not incidental duplication: if they disagree in the direction gate-stricter-than-rendering, the wizard blocks with no visible reason, which is exactly the class of bug the plan's own acceptance criteria care about. Duplicating a predicate whose two copies must agree is the more expensive choice.

The two sites genuinely cannot disagree now. Both destructure the same `productRowRequirements(product)` call, and `needsNegotiatedValue === hasVariableValue` by construction, so `showCustomUnitError` tracks `valueOk` and `showCustomLabelError` tracks `descriptionOk` by definition rather than by coincidence.

I also checked the whole gate for silent blocks. Every conjunct of `itemsValid` implies a rendered error:
- `needsDescription` and `needsNegotiatedValue` both imply `hasVariableValue`, which is the render condition for the block containing both messages.
- `areaId` is covered by `showAreaError`.
- the free/avulso branch renders all three of its messages.

No path can block without a visible reason.

## 11. Correctness review

No defects found.

- `(opcional)` appears exactly when `isService`, and `needsDescription = hasVariableValue && !isService`, so the copy appears if and only if the field is optional. No mismatch possible.
- The produto hint does not leak onto a serviço row, and vice versa - pinned by two tests covering both directions.
- No `any` cast, no `@ts-ignore`, no `@ts-expect-error`, no `eslint-disable`, no swallowed error in added lines.
- Copy is pt-BR throughout.

Commit hygiene: one commit, Conventional Commit subject `feat(sales-ops): make the item description optional for serviços`, authored `CauetPinciara <cauetpinciara@gmail.com>`, no trailers, no co-author, no AI attribution. No em dash in any added line (checked mechanically).

### Non-blocking notes

1. The `.trim()` rationale in the `saleItemDisplayName` comment and in the commit message is factually wrong, as detailed in section 6. Worth correcting the comment when the file is next touched so a future reader does not act on it.
2. Given the slice 07 CHECK, `needsDescription` is dead for all API-sourced rows today; it lives on only as the guard for unclassified rows. That is intentional and documented, but it is worth knowing that the produto-side copy is effectively unreachable in production.

## Probe hygiene

Five source mutations (M1-M5) and one temporary test edit were applied and reverted. All restored via `git checkout --` and verified byte-identical by `git hash-object`:

| File | Hash (baseline == final) |
| --- | --- |
| `SalesOpsApp.tsx` | `1a33cd31bb7ab8f464af156d2f7bc97daba77f0d` |
| `calculations.ts` | `e664cfed6c9441b82144b38df702db0b4358c165` |
| `types.ts` | `3f9abeb25b05bbf7c38eed04d86a1db9f1eb630f` |
| `sale-wizard-service-description.test.tsx` | `1922e7211939209e2fa5000ac908573b68dc4035` |

`git diff` is empty. `git status --porcelain` shows only the two untracked paths that were present before I started (`.vscode/` and `nexo/runs/.../agents/exec-08-service-description-optional.result.json`). No throwaway files were left in the repo; scratch output went to the session scratchpad. Nothing was merged, pushed, committed or amended, and no background process was left running.
