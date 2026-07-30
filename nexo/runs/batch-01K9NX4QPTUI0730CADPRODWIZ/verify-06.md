# Verify 06 - wizard custo mode

**Verdict: PASS**

Slice: `06-wizard-custo-mode`, branch `feat/06-wizard-custo-mode`, uncommitted working tree.

## Commands

| Command | Baseline | Actual | Result |
| --- | --- | --- | --- |
| `pnpm test` (web) | 371 tests / 39 files | **381 passed / 39 files** | PASS (+10) |
| `pnpm test` (api unit) | 300 tests / 29 files | **300 passed / 29 files** | PASS |
| `pnpm test` (shared-utils) | - | 23 passed / 2 files | PASS |
| `pnpm run lint` | clean | `LINT_EXIT=0`, all three packages Done | PASS |
| `pnpm run type-check` | clean | `TC_EXIT=0`, all three packages Done | PASS |
| `pnpm --filter @fxl-sales/api test:integration` | 101 tests / 19 files | **101 passed / 19 files** | PASS |

No test count dropped. Grep for added `.skip` / `.only` / `todo(` across the three touched test files returned nothing (exit 1).

Diffstat: 6 files, +560/-42. Source: `apps/web/src/sales-ops/calculations.ts`, `apps/web/src/sales-ops/SalesOpsApp.tsx`. Docs: `CLAUDE.md`. Tests: three web spec files.

## The seven decisive checks

### 1. No migration, no schema change - PASS

`git diff --name-only` matches nothing under `apps/api` at all, so nothing under `apps/api/drizzle/` and zero diff lines in `apps/api/src/db/schema.ts`. `sales_ops_sale_professionals` is untouched. The design was not re-litigated.

### 2. The `%` basis is the recorrência-free, função-scoped item subtotal - PASS

This is the check that mattered most, and the code gets it right.

`professionalCostBaseCents` (calculations.ts) returns `scopedBaseCents(entry)`, which is `Σ contribution.subtotalBrl` over the contributions `buildFuncaoCostBasis` already built. Those contributions are pushed one per `(item, cost)` pair only for items whose `productId` has a cost row for that `funcaoId`, so the scoped base is literally "the summed item subtotals of the items whose produto declares this função" - the same base the existing prefill uses. It is not the proposta total.

The recorrência cannot reach it. `buildFuncaoCostBasis` is fed `subtotalBrl: Math.max(1, Number(item.quantity) || 1) * parseCurrencyToCents(item.unitBrl)` - unit price times quantity, no monthly term anywhere. The fallback aggregate `productItemsSubtotalCents` in `SalesOpsApp.tsx` uses the character-for-character identical expression over `item.kind === 'product' && item.productId`, so both branches obey the same exclusion. Free-form items contribute nothing to either.

No double counting: a produto can hold at most one cost row per `funcaoId` (the API's `duplicate_funcao_cost` guard), so each item contributes its subtotal at most once per função.

The rendered derivation is fed the same `basis` object (`funcaoCostBasis.get(professional.funcaoId)`) that `professionalRowBaseCents` resolves, so the explanation and the cents cannot disagree.

### 3. `costManual` semantics preserved - PASS

A unit toggle cannot resurrect a stale produto default. `setProfessionalCostUnit` sets `costManual: true` on **both** directions of the toggle and never clears it, and the render-phase re-derive guard reads `row.costManual || row.costUnit === 'pct' || !row.funcaoId` - so a toggled row is excluded twice over. Typing still pins on the first keystroke (both the `costPct` and `costBrl` branches of the `onChange` set `costManual: true`), and `deriveWizardPrefill` still seeds prefilled rows `costManual: true` unconditionally.

Only `Restaurar padrão` un-pins, which is the pre-existing intended behaviour; it also forces `costUnit: 'fix'` and rewrites `costBrl` from the produto's cents, which is correct because a cadastro default states cents, not a percentage.

A `%` row is derived on every render via `professionalRowCents` rather than mirrored into `costBrl`, so there is no stale mirror to go out of date and no extra render-phase setState loop.

Covered by the test `does not let a produto default clobber a percent row, and re-bases it live`, which changes the item value mid-edit and asserts the typed `10` survives while the resolved cents follow the new base.

### 4. Empty basis does not silently write 0 - PASS

When `professionalRowBaseCents(professional) <= 0` the `%` branch renders an explicit amber warning, `Nenhum item de produto na proposta - o percentual resolve para R$ 0,00.`, instead of the derivation line. `describeProfessionalCostBase` also returns `''` rather than a misleading `0% de R$ 0,00`. The string is pinned in `sale-wizard-ui-contract.test.tsx` and exercised end-to-end in `warns instead of silently writing zero when no product item backs the percentage`, which removes the only catalog item and asserts both the warning text and the resulting `costBrl: 0` payload. The zero is still saved, but it is stated on screen first, which is what the criterion asks for.

### 5. The vetoable fallback - PASS, with a scope note

The decision branch is exactly the single `if` the plan allowed, in `professionalCostBaseCents`:

```ts
const scoped = scopedBaseCents(entry);
if (scoped > 0) return scoped;
return Math.max(0, Math.floor(productItemsSubtotalCents));
```

It is isolated and did not sprawl into the resolution path - `resolveProfessionalCostCents` knows nothing about it, and the scoped base always wins (pinned by `professionalCostBaseCents(singleItemBasis.get(devFuncaoId), 9999999) === 2000000`).

**Finding (minor, non-blocking):** removal is not literally a three-line deletion. Backing the fallback out also means dropping the `productItemsSubtotalCents` parameter from two exported signatures (`professionalCostBaseCents`, `describeProfessionalCostBase`), their call sites, the `'total dos itens de produto'` ternary inside `describeProfessionalCostBase`, and the 11-line derivation in `SaleWizardDialogBody` - roughly 30 lines across two files. All of it is mechanical and compiler-guided, and the judgement call itself is genuinely one branch, so I am recording this rather than failing on it. Worth knowing before anyone votes to veto it.

### 6. `formatProductCommission` not used for a função cost - PASS

Repo-wide grep over `apps/web/src` and `packages` finds `formatProductCommission` at only four sites in `SalesOpsApp.tsx`: its definition (2259), a comment inside `formatFuncaoCost` warning against it (2273), and three call sites (2458, 2464, 2469) that are the pre-existing produto commission block. None is in the diff and none formats a função cost. `formatFuncaoCost` remains the único formatter for a cost row (2436). The new wizard code formats its resolved cents with `formatMoneyBrl`, which is cents-correct.

### 7. Margin consistency - PASS

`professionalRowCents` is the single seam. The step-3/4 total (`professionalCents`), the payables ledger preview row `value`, and `buildPayload`'s `costBrl` per professional all call that same function - the diff converts all three from the old `parseCurrencyToCents(professional.costBrl)` in the same commit. `professionalCents` feeds `computeSaleFinancials({ professionalCostsBrl: professionalCents, ... })`, the one margin implementation. Since the payload sums the identical per-row function, the previewed `Margem líquida` and the persisted `net_margin_brl` cannot disagree.

Byte-level detail worth confirming: `parseCurrencyToCents` in `SalesOpsApp.tsx:405` is a one-line alias for `parseCurrencyInputToCents`, which is what `resolveProfessionalCostCents`'s `fix` branch calls. So the `R$` path is exactly the old behaviour, and an existing row round-trips unchanged - which is the "defaults to `R$`" guarantee the design promised.

## Adversarial checks

### Revert-the-source oracle - PASS

Backed up `SalesOpsApp.tsx`, reverted only it via `git checkout --` (leaving `calculations.ts` and all tests in place, so the oracle isolates the UI wiring), and re-ran `sale-wizard-funcao-costs.test.tsx`:

```
Test Files  1 failed (1)
     Tests  5 failed | 18 passed (23)
Error: button not found: Custo do profissional 1 em porcentagem
```

Exactly the 5 new tests failed, each for the right reason - the `% | R$` toggle is absent from the reverted UI - and all 18 pre-existing tests still passed, which also confirms the refactor did not disturb prior behaviour. Restored from backup: SHA-256 `f21a5543ce0d329b4cfc1ec32b7b660c99bf79d7537612621a1cdd1b4cdb3870` before and after, identical. `git status --porcelain` matches the starting state exactly (same 6 modified files, same 3 untracked entries).

### Tests real or tautological? - Mostly real

The unit tests build their bases through the **real** `buildFuncaoCostBasis` rather than hard-coding an expected basis, which is precisely the failure mode to watch for. The strongest assertion is that a `fix`-mode produto default (R$ 300,00) still yields a base of `2000000` - the item subtotal - not `30000`, the default's own cents; a test that hard-coded its base could not distinguish those. The two-item case sums `2000000 + 1000000 = 3000000` through the real function.

The DOM tests assert real payloads, not just rendered text: `payload.professionals[0].costBrl === 200000` after typing `10` against a R$ 20.000,00 item, and `=== 200000` again after toggling back to `R$` (proving the freeze is lossless). The live re-base test changes the item to R$ 40.000,00 and asserts the footer reads `10% de R$ 40.000,00 (FXL Custom)` and `R$ 4.000,00`.

**Finding (minor, non-blocking):** the test `never lets the recurring mensalidade into the percent base` is close to a tautology - neither function under test accepts a recurring value at all, so the assertion cannot fail. Its own comment concedes this. The real risk surface is the `productItemsSubtotalCents` reducer in `SalesOpsApp.tsx`, which could in principle be edited to add a monthly term; that reducer is only covered indirectly, via the DOM tests' expected cents. Not a defect in the shipped behaviour (the reducer reads `unitBrl` and `quantity` only, and I verified it by inspection), but the test does not guard what its name claims.

### Floor/rounding on a `%` that does not divide evenly - PASS

`resolveProfessionalCostCents`'s `pct` branch delegates to the existing `resolveFuncaoCostCents`, whose formula is `Math.max(0, Math.floor((subtotalBrl * pct) / 100))`. That is the house `Σ floor` per row convention from `CLAUDE.md`, and it is pinned: 5% of 1999 cents is 99.95, asserted `=== 99`. Negative, non-numeric and empty percentages all clamp to `0` rather than crediting money back - three explicit assertions.

One accepted lossy edge, documented in the code: toggling `R$ -> %` seeds the percentage to two decimals, so the resolved cents can move by up to half a basis point of the base. The derivation line always states the percentage and the resolved value, so the screen never lies about what will be saved. Reasonable, and disclosed.

### Em dashes - PASS

`git diff | grep "^+.*—"` returns nothing (exit 1). The new warning string uses a plain dash.

## Other observations

- `UnitToggle` and `UnitInput` are genuinely reused, not reimplemented: zero added definitions in the diff, both pre-exist at `SalesOpsApp.tsx:3175` and `:3200`. `costUnit` defaults to `'fix'` for fresh rows and for every prefilled row, so existing propostas behave exactly as before.
- The `CLAUDE.md` addition accurately describes the shipped code, including the not-persisted unit, the fallback, the empty-base warning and the both-directions pinning. It does not overstate: it correctly notes a saved proposta always reopens in `R$`.
- Grid geometry moved `150px -> 212px` for the cost column and the header cell went right-aligned to left-aligned to match the control group's left edge. Consistent with the toggle-plus-input pair; no other column shifted.
- The `%` branch is rendered before the `costManual` chip branch, with a comment explaining why (a `%` row is always `costManual`, so the chip would otherwise mask its own derivation). Correct ordering.
- `rowFooterText` in the test helper was updated from `parentElement` to `.closest('.items-end')` because `UnitInput` adds a wrapper. Legitimate helper repair, not a weakened assertion - the same footer text is still being read.

## Conclusion

All four gate commands pass at or above baseline, all seven decisive checks pass, the oracle fails correctly when the source is reverted and the tree restores byte-identically. The two findings are minor and non-blocking: the fallback's removal cost is larger than the plan's stated three lines, and one recorrência test is tautological. Neither affects shipped behaviour.

**PASS.**
