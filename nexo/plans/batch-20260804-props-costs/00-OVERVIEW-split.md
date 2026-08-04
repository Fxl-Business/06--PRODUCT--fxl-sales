# Professional payment split — cross-slice design

Slices: `05-professional-split-core`, `06-professional-split-persistence`,
`07-professional-split-ui`. Milestone `v2.4.0`.

## The gap

The user asked for per-professional control over how a professional's pay is
divided across the proposta's parcelas. Three of the five payable kinds already
do this: `seller_commission`, `finder_commission` and `tax` are generated PER
RECEIVABLE ROW and linked via `payables.receivable_id`
(`apps/api/src/domains/sales-ops/service.ts:900-940`). The actual gap is
`professional_cost`, which is emitted as ONE row per professional with
`receivableId: null`, due on the won date (`service.ts:942-953`).

So the work is: make `professional_cost` per-receivable like the other three,
give the default split an exact-sum rounding contract, and let the operator
override that default per professional and persist the override.

## Decision 1 — storage: one `jsonb` column of BASIS POINTS

`sales_ops_sale_professionals.cost_split_bp jsonb NULL`.

When present: a JSON array of 1..120 non-negative integers summing to EXACTLY
`10000`. `NULL` means "use the default pro-rata".

### Why a column and not a table

`apps/api/src/db/schema.ts:639-645` documents why `sales_ops_product_funcao_costs`
is a child table and not jsonb: it holds a `funcao_id`, and "a dangling funcao_id
inside jsonb would be an undetectable" integrity failure. That reasoning is
exactly why a column IS right here — a split part holds no id at all, only a
number. There is nothing to dangle, nothing to FK, nothing to archive, and no
query ever filters or joins on an individual part. A child table would buy a
second RLS policy, a second tenant filter, a second cascade rule and a second
round trip in `getSalesOpsSnapshot`, for zero referential benefit.

### Why basis points and not cents

This is the load-bearing choice. `cost_brl` is edited one control away from the
schedule, in the same table row of the same wizard step.

* Stored as CENTS, the array is a derived value that goes stale the instant
  `cost_brl` changes. It would need a cross-field zod refine (`Σ parts ===
  cost_brl`), a rewrite inside `Restaurar padrão`, a rewrite inside every
  `costBrl` keystroke handler, and a repair path for any row that got out of
  sync. Every one of those is a place to leak an inconsistent proposta.
* Stored as BASIS POINTS, `cost_brl` and `cost_split_bp` are ORTHOGONAL:
  `cost_brl` says how much, `cost_split_bp` says when. Editing one never
  invalidates the other. The zod refine is a single self-contained
  `Σ === 10000` with no reference to any other field.
* The user's own vocabulary is percentages: "2 times with 30% and 70%".
  Basis points ARE that sentence, stored losslessly. Two decimal places of
  percent is the same resolution the rest of the domain already uses
  (`numeric(5,2)` for every rate).
* It removes an overflow hazard. See Decision 3.

The cost of bp is that a part typed in reais is converted once, which can round.
The UI therefore never offers a reais input per part — see slice 07 scope limits.

### Why exactly 10000 and not free-form weights

A free-form weight vector (`[1,1,1]` for thirds) is smaller to store but is not
self-describing: the UI could not render "33,33%" without renormalizing, and two
different arrays would mean the same schedule. Pinning the sum at 10000 makes
the stored value read exactly as what the operator saw, and makes the API's
validation identical to the UI's ("must sum to 100%"), which is literally what
the user asked for.

## Decision 2 — parts are INDEPENDENT of parcelas, bound front-aligned

"this one will receive in 1 time" is the feature, on a proposta that has 3
parcelas. So the part count must NOT be tied to the receivable count.

Resolution rule, total for every stored value against every plan:

1. Eligible receivables `R` = the sale's non-void, NON-RECURRING receivables,
   stably sorted by `dueDate` ascending. `m = R.length`.
2. `m === 0` → return the single legacy one-shot part:
   `{ receivableId: null, dueDate: wonDate, amountBrl: costBrl }`.
3. Weights `W` = `cost_split_bp` when set, else
   `defaultSplitBp(R.map(r => r.amountBrl))`.
4. Fold: if `W.length > m`, take `W[0..m-2]` and put `Σ W[m-1..]` in the last
   slot. Otherwise leave `W` alone.
5. `parts = splitCentsByWeights(costBrl, W)`.
6. Part `i` binds to `R[i]`: `receivableId = R[i].id`, `dueDate = R[i].dueDate`.

Front-aligned and positional. Fewer parts than parcelas means the later parcelas
carry no `professional_cost` at all — which IS "receives in 1 time", paid out of
the first parcela. Aligning from the front (rather than the back) keeps part 1
bound to parcela 1 as the operator adds parts, so the editor never renumbers
under the operator's hands.

The fold in step 4 exists because step 2 of the wizard can be revisited after
step 3: the operator can set a 4-part split and then shorten the plan to 2
parcelas. Folding is exact-sum preserving and never silently drops money.

### Why RECURRING rows are excluded from the split

`buildSaleLedger` (`service.ts:733-754`) labels installment rows `"N/M"` and
recurring rows `"MN/M"`, and CLAUDE.md already calls that prefix load-bearing.
The split skips every `M`-prefixed row, for four reasons:

* An indefinite recorrência (`cycles: null`) generates NO bounded rows at all,
  so a design that includes recurring rows has no definition for the commonest
  recurring case and needs this fallback anyway. Excluding them makes ONE rule.
* Spreading a pay-once cost over 24 monthly cycles delays a professional's pay
  years past delivery. That is the same arithmetic error `buildFuncaoCostBasis`
  already refuses to make, arrived at from the other end.
* It keeps basis and payout keyed to the same stream: the cost is PRICED off the
  itens subtotal with the mensalidade excluded, and now PAID out of the
  installment receivables, which are that same money.
* It is the only rule the wizard can honestly preview. The wizard holds
  `installmentRows` and the recorrência as separate state, so step 3 can render
  the exact parcela list the server will split against.

## Decision 3 — the exact-sum rounding contract

`splitCentsByWeights(totalCents, weights)` in
`packages/shared-utils/src/professional-split.ts`:

* `n = weights.length`. `n === 0` → `[]`.
* `W = Σ weights`. `W <= 0` → `[0, 0, ..., totalCents]` (last absorbs everything).
* else `out[i] = Math.floor(totalCents * weights[i] / W)` for `i < n-1`, and
  `out[n-1] = totalCents - Σ out[0..n-2]`.

Invariants, each one a named test in slice 05:

* `Σ out === totalCents` EXACTLY, for every input. This mirrors
  `splitInstallmentsEqually` (`apps/web/src/sales-ops/calculations.ts:383-396`),
  whose last row likewise absorbs the whole floor remainder.
* With EQUAL weights the output is byte-identical to
  `splitInstallmentsEqually`'s amounts, because
  `floor(total * w / (n*w)) === floor(total / n)`. This is asserted directly, so
  the two implementations can never drift apart on the case they overlap on.
* Every part is `>= 0` when `totalCents >= 0` and every weight is `>= 0`, because
  `floor` only ever undershoots, so the last part can only absorb a POSITIVE
  remainder of at most `n-1` cents.

Overflow: `totalCents * weights[i]` must stay inside `Number.MAX_SAFE_INTEGER`.
`cost_brl` is a Postgres `integer` (< 2^31) and a raw receivable amount is too,
so `2^31 × 2^31 ≈ 2^62` would be unsafe. Every caller therefore normalizes to
basis points FIRST via `defaultSplitBp`, after which `W === 10000` and the
product is at most `2^31 × 10^4 ≈ 2.1 × 10^13` — comfortably safe.
`defaultSplitBp` itself computes `10000 * amount / Σamount` with the same bound.
So there is exactly ONE weight space in the system and it is bounded by
construction.

## Decision 4 — payable generation at win

`materializeWonPayables` (`service.ts:888-967`) changes in three places.

1. `MaterializeWonPayablesInput.receivables` rows gain an optional
   `label?: string`. Optional, not required, because absent must read as
   "installment": the DB column is `NOT NULL` and `buildSaleLedger` always writes
   one, so only synthetic test fixtures can omit it, and treating those as
   installments is the conservative reading. Both production call sites pass the
   real label (`service.ts:1969-1974` must add `label:` to its `.returning()`;
   `service.ts:2185-2190` already selects whole rows).
2. `MaterializeWonPayablesInput.professionals` rows gain
   `costSplitBp?: number[] | null`.
3. The loop at `service.ts:942-953` calls `resolveProfessionalSplit` and pushes
   one draft per part with `amountBrl > 0`, carrying the part's `receivableId`
   and `dueDate`.

### The guard change is mandatory, not cosmetic

`alreadyExists` (`service.ts:890-896`) keys on `(kind, receivableId)` only. That
is safe today because `professional_cost` always used the single key
`('professional_cost', null)` and the loop reads only PRE-EXISTING rows, never
the drafts it is building. With one row per professional PER PARCELA it stops
being safe: on a re-win, professional A's `paid` parcela-1 payable would match
professional B's `('professional_cost', parcela1)` lookup and silently suppress
B's payable. B loses money with no error anywhere.

So `ExistingPayableRef` gains a REQUIRED `beneficiaryName: string`, and the
`professional_cost` branch matches on `(kind, receivableId, beneficiaryName)`.
Commissions and tax keep the two-key match — they are singletons per kind per
receivable and a name match would be noise.

Known residual limit, unchanged in kind from today: two professionals with the
IDENTICAL `personNameSnapshot` on one sale still collide. Recording it here
rather than fixing it, because the real fix is keying the payable on the
professional row id, which needs a `payables.sale_professional_id` column and is
a separate slice.

### The revert / lose / cancel path

`transitionSale`'s revert branch (`service.ts:2205-2216`) voids payables by
`(orgId, saleId, status = 'open')`. It never mentions `kind` or `receivableId`,
so it is CORRECT UNCHANGED: linked `professional_cost` rows are voided on revert
exactly as unlinked ones were, and `paid` rows are still never touched. No code
change, and `apps/api/test/rls/sale-professional-funcoes.test.ts:616` continues
to pass as written (its amounts, 100000 and 30000, are unchanged because that
fixture has a single parcela).

`cancelContract` (`service.ts:2286-2295`) is the one behavioural change, and it
is a change for the better. It voids open payables `inArray(receivableId,
futureIds)`. Today a `professional_cost` with `receivableId: null` matches
nothing and SURVIVES a mid-contract cancellation, so the professional stays owed
for work funded by parcelas the client will never pay. Once linked, the parts
bound to voided future parcelas are voided with them, and the parts bound to
already-due parcelas survive. That is the correct semantics and it needs no code
change either.

The existing `cancelContract` integration test
(`apps/api/src/domains/sales-ops/__tests__/sale-transitions.integration.test.ts:235`)
seeds receivables labelled `M1/3`, `M2/3`, `M3/3` — all recurring. Under the
exclusion rule that sale has ZERO eligible receivables, the one-shot fallback
fires, and `voidedPayables: 3` is unchanged. Verified by reading the fixture.

### Tests that assert the current one-shot shape

Found by grepping `professional_cost` across `apps/api`. Updating these is part
of slice 06.

* `__tests__/sale-transitions.test.ts:63` — `receivables: []`, so the fallback
  fires and this test passes UNCHANGED. Rename it to name the fallback.
* `__tests__/sale-transitions.test.ts:143` — constructs `existingPayables`
  without `beneficiaryName`; three lines to update.
* `__tests__/service.test.ts:374` — 4 receivables, one void. MUST change: the
  single 240000 draft becomes three drafts of 180000 / 29999 / 30001 on r1 / r3 /
  r4 (r2 is void). Hand-verified against the contract.
* `__tests__/sale-transitions.integration.test.ts:191` — MUST change:
  `payables` goes 8 → 9, `byReceivable(r1)` 3 → 4, `byReceivable(r2)` 3 → 4, and
  `oneShots` becomes `['other_cost']` alone.
* `test/rls/proposal-write.test.ts:198` — MUST change:
  `professional_cost.receivable_id` is now that sale's single `receivableId`,
  not `null`. The amount, 100000, is unchanged.
* `test/rls/sale-professional-funcoes.test.ts:515` — MUST change: the two
  amounts (30000, 100000) and the two beneficiary names are unchanged because
  the fixture has one parcela, but `receivableId === null` becomes
  `receivableId === <that parcela>`, and its comment must be rewritten.

## Decision 5 — `other_cost` stays ONE-SHOT

Explicit call: it does not split.

* It names no beneficiary. Its `beneficiaryName` is the literal string
  `'Outros custos'` (`service.ts:957`). The user's sentence is about "the
  professionals who will work on a proposal"; "even the commissions and so on"
  points at money paid to PEOPLE, and commissions already split.
* There is no row in the wizard to hang a `Detalhe de pagamento` panel on.
  `otherCostsBrl` is a single field in the margin panel, not a table. Splitting
  it would need a schedule with no natural home and no override affordance, i.e.
  a default nobody can change — which is worse than the honest one-shot.
* It would change `cancelContract` semantics for a lump expense that was
  probably already incurred, unlike a professional's pay.

Consequence to keep in mind: after this work, `receivableId: null` on a payable
means EXACTLY ONE thing in the normal case — `other_cost` — plus the documented
degenerate `professional_cost` fallback when a sale has no installment
receivable. Both are stated in CLAUDE.md.

## Decision 6 — the recurring exclusion in `buildFuncaoCostBasis` STILL HOLDS

CLAUDE.md and `apps/web/src/sales-ops/calculations.ts:189-198` justify
excluding the mensalidade from the cost BASIS with "a `professional_cost` payable
is one-shot at win with `receivableId: null`, so pricing it off a monthly stream
would charge a pay-once cost against every cycle."

This work invalidates the PREMISE of that sentence but not its CONCLUSION, and
the conclusion is now true for a stronger reason.

* The premise "one-shot with `receivableId: null`" is gone. It must be rewritten
  wherever it appears — CLAUDE.md, `calculations.ts:189-198`
  and `calculations.ts:246-260`, `SalesOpsApp.tsx:5042-5046`,
  `__tests__/calculations.test.ts:538`, `__tests__/sale-margin-parity.test.ts:76`
  and `__tests__/sale-wizard-funcao-costs.test.tsx:563`.
* The conclusion is unchanged. `professional_cost` is still a PAY-ONCE TOTAL.
  The split does not RE-PRICE anything: it takes an already-computed
  `cost_brl` and decides only WHEN it is paid. `Σ parts === cost_brl` is the
  contract, so the total is invariant under any split, over any number of rows.
  Pricing 5% off a mensalidade would still multiply the cost by the cycle count,
  which is a pricing error the split cannot and does not undo.
* The exclusion is now doubly consistent: the basis excludes the mensalidade AND
  the split excludes the `M`-labelled receivables, so the money the cost is
  measured against and the money it is paid out of are the same non-recurring
  stream. That is a tighter invariant than before this work, not a looser one.

Verified against `buildFuncaoCostBasis` (`calculations.ts:199+`), which takes
`items` only and has no receivable input at all, and against
`computeSaleFinancials` (`packages/shared-utils/src/sale-financials.ts:52-79`),
which takes `professionalCostsBrl` as a scalar sum. Neither reads a split, so no
persisted margin number moves. That is asserted in slice 06.

## Slice order

```
05-professional-split-core          depends_on: []
06-professional-split-persistence   depends_on: [05]
07-professional-split-ui            depends_on: [06, 04-prefill-profissionais-do-produto]
```

Slice 07 also lands after `03-profissional-picker-funcao-first`, transitively
via 04, and is written so it does not touch the professionals-table grid
template at all — the new control lives inside the existing cost cell's
`flex flex-col items-end gap-1` container and the panel spans with
`col-span-full`. That is what keeps it conflict-free against 03's column
reorder.

Run `pnpm run build:packages` before slice 06 and 07 test runs: both the API and
the web resolve `@fxl-sales/shared-utils` to `dist`, not to source.
