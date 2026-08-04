# exec-06 — professional split persistence

Slice: `06-professional-split-persistence`.
Branch: `feat/06-professional-split-persistence`.
Status: PASS.

## What landed

`professional_cost` payables are no longer one-shot.
At win they are generated one per INSTALLMENT receivable, split by a stored `cost_split_bp` when one exists and pro rata over the receivable amounts otherwise.
The user's case now works: a R$ 10.000,00 professional on a 10k/20k/20k/50k plan is paid 1k/2k/2k/5k.

Implementation is exactly the plan's shape:

- `sales_ops_sale_professionals.cost_split_bp jsonb NULL`, nullable, no default, no backfill, no CHECK, no RLS statements.
- `SaleProfessionalSchema` gained `costSplitBp: z.array(...).min(1).max(120).nullish()` plus a `Σ === 10000` superRefine issuing `cost_split_sum_mismatch`.
- `buildSaleLedger` passes `costSplitBp` through as the operator's input (the body wins, unlike the server-authoritative snapshots beside it).
- `materializeWonPayables` filters void and `M`-prefixed rows, calls `resolveProfessionalSplit` from `@fxl-sales/shared-utils`, and pushes one draft per non-zero part.
- `other_cost` untouched, one-shot, with an explicit comment and an explicit test.
- Revert / lose / cancel: NO code change. Confirmed by reading; `cancelContract` now voids the parts bound to voided future parcelas because they are finally linked, which is the intended new semantics.

## Migration index actually used

**0017**, as the plan predicted. Verified against `apps/api/drizzle/meta/_journal.json` before writing: the last entry was `idx: 16`, `0016_hub_bff_session_store`.

`pnpm --filter @fxl-sales/api db:generate` produced `0017_outgoing_rocket_racer.sql`; renamed to `0017_professional_payment_split.sql` and the journal `tag` updated to match, per the hand-naming convention 0013 onward.
The migration was applied to the local Docker test DB by the integration suite's migrate-first `globalSetup`, and the round-trip test proves the column exists.

## Where the plan's numbers disagreed with the real computation

**One disagreement, in `service.test.ts`.** The plan hardcoded the three `professional_cost` drafts as **180000 / 29999 / 30001**. The real computation is **180000 / 29976 / 30024**.

Recomputed from the actual fixture (`r1` 2000000 open, `r2` 333333 VOID, `r3` 333333 open, `r4` 333333 open; cost 240000) using the built shared functions:

```
defaultSplitBp([2000000, 333333, 333333]) === [7500, 1249, 1251]
splitCentsByWeights(240000, [7500, 1249, 1251]) === [180000, 29976, 30024]
```

`240000 × 1249 / 10000 = 29976` exactly, so the middle part cannot be 29999.
The plan's arithmetic looks like it was carried over from the seller/tax figures on the same fixture (`33333 / 9999 / 19999`), which are `pctOfCents` results and unrelated to the split.
Per the executor note in the plan, the FUNCTION is the oracle: the test asserts 180000 / 29976 / 30024 and the sum is exactly 240000.

**Everything else matched.** In particular:

- `sale-transitions.integration.test.ts` win test: `payables` 8 → 9, `byReceivable(r1)` and `byReceivable(r2)` 3 → 4 each, `oneShots` → `['other_cost']`, `Σ professional_cost === 40000`. All as predicted.
- The `cancelContract` fixture (`M1/3`, `M2/3`, `M3/3`) really is all-recurring, the one-shot fallback fires, and `voidedPayables: 3` held unchanged. An inline comment now says so.
- `proposal-write.test.ts`: `professional_cost.receivable_id` became the sale's single receivable id, amount 100000 unchanged.
- `sale-professional-funcoes.test.ts`: the 30000 / 100000 amounts and both beneficiary names unchanged (single parcela), only `receivableId === null` became `=== <that parcela>`. The `:616` revert test needed no change.
- Pro-rata unit test: 1000000/2000000/2000000 with cost 500000 → 100000/200000/200000, as the plan predicted.

## Test-file drift from the plan

Two line/name references in the plan were stale, harmlessly:

- The integration win test is titled `'win materializes payables linked to each receivable row'` (line 141), not `'creates per-receivable payables at won'` (line 160).
- `sale-margin-parity.test.ts` (an API unit test the plan did not list) asserts `ledger.professionals` with `toEqual`, so the new `costSplitBp: null` key had to be added to its three expected rows. Not a behaviour change; the ledger now carries the field.

## The three non-negotiables

1. **Beneficiary guard.** `ExistingPayableRef.beneficiaryName` is REQUIRED, not optional, so a forgotten call site is a type error. `alreadyExists` takes it as an optional THIRD argument: commissions and tax pass two and behave identically, the professional call passes three. Regression test: `'does not let one professional paid parcela suppress another professional'` — two professionals over two parcelas with Ana's parcela-1 row already `paid`; Ana gets only her `r2` draft, Carla gets BOTH of hers. Deleting the third argument fails it.
2. **`net_margin_brl` does not move.** `'leaves net_margin_brl unchanged by the split'` creates two propostas differing only in `costSplitBp` (`null` vs `[1000, 9000]`) and asserts `professionalCostsBrl`, `netMarginBrl` and `netMarginPct` are equal, then wins both and asserts `Σ professional_cost payables === 100000` in each. `computeSaleFinancials` was not touched.
3. **`other_cost` stays one-shot.** `'keeps other_cost one-shot'` at unit level, plus the surviving `expect(byKind.other_cost?.receivable_id).toBeNull()` in `proposal-write.test.ts`, which is now the positive control for Decision 5 rather than incidental coverage.

## Method

Red → green. The unit tests were written first and confirmed red (4 failures across `sale-transitions.test.ts` and `service.test.ts`) before any of `service.ts` changed.
For the migration path, the integration suite applying 0017 IS the green step: `'persists cost_split_bp and pays it out at won'` cannot pass without the column.

## Gates (all run-once, all green)

```
pnpm run build:packages   ok
pnpm run lint             ok
pnpm run type-check       ok
pnpm test                 33 files / 328 tests (api) + 45 files / 519 tests (web)
pnpm run build            ok
pnpm --filter @fxl-sales/api test:integration   20 files / 113 tests
```

`test/rls/sale-professional-funcoes.test.ts` went 13 → 16 tests; `sale-transitions.integration.test.ts` 5 → 6.

## Scope held

No `apps/web` change. No `other_cost` split. No CHECK or trigger. No backfill. No `payables.sale_professional_id`. `computeSaleFinancials`, `buildFuncaoCostBasis` and `professionalCostBaseCents` untouched — the web-side comments that still describe the old one-shot premise belong to slice 07.

## Residual limit, recorded not fixed

Two professionals with an IDENTICAL `person_name_snapshot` on one sale still collide in the re-win guard. Unchanged in kind from before this slice. The real fix is keying the payable on the professional row id via a `payables.sale_professional_id` column, which is a separate slice.
