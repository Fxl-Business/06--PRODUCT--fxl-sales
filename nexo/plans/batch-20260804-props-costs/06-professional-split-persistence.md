---
id: 06-professional-split-persistence
milestone: v2.4.0
status: todo
depends_on: ["05-professional-split-core"]
files_modified:
  - apps/api/drizzle/0017_professional_payment_split.sql
  - apps/api/drizzle/meta/_journal.json
  - apps/api/drizzle/meta/0017_snapshot.json
  - apps/api/src/db/schema.ts
  - apps/api/src/domains/sales-ops/service.ts
  - apps/api/src/domains/sales-ops/__tests__/service.test.ts
  - apps/api/src/domains/sales-ops/__tests__/sale-transitions.test.ts
  - apps/api/src/domains/sales-ops/__tests__/sale-transitions.integration.test.ts
  - apps/api/test/rls/proposal-write.test.ts
  - apps/api/test/rls/sale-professional-funcoes.test.ts
  - CLAUDE.md
acceptance: "given a won transition on a proposta with three installment receivables and one professional costing R$ 10.000,00, when the transition runs, then three professional_cost payables exist — one per receivable_id — summing to exactly 1000000 cents, and the same sale with cost_split_bp [10000] instead produces a single payable on the first installment."
---

## 1. Current behaviour

* `sales_ops_sale_professionals` (`apps/api/src/db/schema.ts:790-825`) has no
  schedule column. `costBrl` at line 807 is a single `integer('cost_brl')`.
* `SaleProfessionalSchema` (`apps/api/src/domains/sales-ops/service.ts:346-361`)
  accepts `personId`, `personName`, `funcaoId`, `role`, `costBrl` and nothing
  else. `money` is `z.number().int().nonnegative()` (`service.ts:26`).
* `materializeWonPayables` (`service.ts:888-967`):
  * `alreadyExists(kind, receivableId)` at 890-896 keys on two fields.
  * `ExistingPayableRef` at 866-870 has no beneficiary.
  * `receivables` at 883 carries no `label`.
  * `professionals` at 882 carries no schedule.
  * The professional loop at 942-953 pushes ONE draft per professional with
    `dueDate: input.wonDate` and `receivableId: null`.
  * `other_cost` at 955-964 is the same shape.
* Two production call sites. `createSale` at `service.ts:1979-1998` maps
  `insertedReceivables`, whose `.returning()` at `service.ts:1969-1974` selects
  `id`, `dueDate`, `amountBrl`, `status` — no `label`. `transitionSale` at
  `service.ts:2170-2197` maps whole `receivableRows` (label already present) and
  builds `existingPayables` at 2191-2195.
* Revert voids by status alone at `service.ts:2205-2216`. `cancelContract` voids
  by `inArray(receivableId, futureIds)` at `service.ts:2286-2295`.
* The professionals write path at `service.ts:1941-1949` spreads
  `ledger.professionals`, which is built at `service.ts:816-843`.
* `getSalesOpsSnapshot` returns whole `salesOpsSaleProfessionals` rows
  (`service.ts:2368-2371`), so a new column reaches the web automatically.

## 2. The fix

### 2a. Migration `0017_professional_payment_split`

Add `costSplitBp: jsonb('cost_split_bp')` to `salesOpsSaleProfessionals` in
`apps/api/src/db/schema.ts`, immediately after `costBrl` at line 807, with a doc
comment stating: basis points, `NULL` = default pro-rata over the installment
receivables, sums to exactly 10000, validated in zod not in the database.

Then `pnpm --filter @fxl-sales/api db:generate`, and RENAME the generated file
to `apps/api/drizzle/0017_professional_payment_split.sql`, updating the `tag` in
`apps/api/drizzle/meta/_journal.json` to match — the same hand-naming every
migration from 0013 onward already uses (`0014_sale_professional_funcoes`,
`0015_servico_base_value`, `0016_hub_bff_session_store`). New journal entry is
`idx: 17`, `version: "7"`.

The SQL body is one statement:

```sql
ALTER TABLE "sales_ops_sale_professionals" ADD COLUMN "cost_split_bp" jsonb;
```

Head it with a comment block in the voice of
`apps/api/drizzle/0014_sale_professional_funcoes.sql`, covering:

* Expand only. Nullable, no default, no backfill. `NULL` IS the default
  behaviour, so every existing row is already correct and a revert is a clean
  `DROP COLUMN`.
* No CHECK constraint. The `Σ === 10000` rule is enforced in zod
  (`SaleProfessionalSchema`) rather than in SQL, because a `jsonb` array sum
  needs a `jsonb_array_elements` subquery inside the CHECK, which Postgres does
  not allow, and the alternative — a trigger — would be the only trigger in this
  schema and would not be reachable from a unit test.
* No RLS statements. `sales_ops_sale_professionals` already carries
  `sales_ops_sale_professionals_tenant_isolation` and `_admin_context` from
  `0007_marvelous_valeria_richards.sql`, and a new column inherits them. Say so,
  exactly as 0014 does.
* Why basis points, in one sentence, pointing at CLAUDE.md.

### 2b. Zod

In `SaleProfessionalSchema` (`service.ts:346-361`) add:

```ts
costSplitBp: z.array(z.number().int().min(0).max(10_000)).min(1).max(120).nullish(),
```

and extend the existing `.superRefine` with a second check: when `costSplitBp` is
a non-null array and `Σ !== 10_000`, add a custom issue with
`path: ['costSplitBp']` and `message: 'cost_split_sum_mismatch'`. `routes.ts`
already maps a zod failure to `400 validation_error`, so no route change.

`.max(120)` matches the existing `installments: z.array(...).max(120)` cap at
`service.ts:399`. `.min(1)` forbids `[]` — the empty schedule is spelled `null`.

### 2c. Ledger

In `buildSaleLedger`'s professionals map (`service.ts:816-843`), pass
`costSplitBp: professional.costSplitBp ?? null` through onto the row alongside
`costBrl`. It is NOT a snapshot and NOT server-derived; it is the operator's
input, so unlike `personNameSnapshot` the body wins.

`computeSaleFinancials` at `service.ts:766-779` is UNTOUCHED: it takes
`professionalCostsBrl` as `Σ costBrl` and knows nothing about schedules. No
persisted margin number moves. Assert this.

### 2d. `materializeWonPayables`

* `ExistingPayableRef` (866-870) gains a REQUIRED `beneficiaryName: string`.
* `alreadyExists` (890-896) becomes
  `(kind, receivableId, beneficiaryName?: string)` and adds
  `(beneficiaryName === undefined || payable.beneficiaryName === beneficiaryName)`
  to the predicate. Commission and tax calls pass two arguments and behave
  identically; the professional call passes three. Comment WHY, from
  `00-OVERVIEW-split.md` Decision 4.
* `MaterializeWonPayablesInput.receivables` (883) gains `label?: string`.
  Optional, and absent reads as an installment — the DB column is `NOT NULL`, so
  only synthetic fixtures can omit it.
* `MaterializeWonPayablesInput.professionals` (882) gains
  `costSplitBp?: number[] | null`.
* Replace the loop at 942-953 with:

  ```ts
  const splitReceivables = input.receivables
    .filter((row) => row.status !== 'void' && !isRecurringReceivableLabel(row.label))
    .map((row) => ({ id: row.id, dueDate: row.dueDate, amountBrl: row.amountBrl }));

  for (const professional of input.professionals) {
    if (professional.costBrl <= 0) continue;
    const parts = resolveProfessionalSplit({
      costBrl: professional.costBrl,
      costSplitBp: professional.costSplitBp,
      receivables: splitReceivables,
      fallbackDueDate: input.wonDate,
    });
    for (const part of parts) {
      if (part.amountBrl <= 0) continue;
      if (alreadyExists('professional_cost', part.receivableId, professional.personName)) continue;
      drafts.push({
        beneficiaryName: professional.personName,
        kind: 'professional_cost',
        dueDate: part.dueDate,
        amountBrl: part.amountBrl,
        status: 'open',
        receivableId: part.receivableId,
      });
    }
  }
  ```

  Import `isRecurringReceivableLabel` and `resolveProfessionalSplit` from
  `@fxl-sales/shared-utils`, extending the existing line 1 import.

* Leave 955-964 (`other_cost`) EXACTLY as it is. Add a one-line comment saying
  it stays one-shot on purpose and pointing at CLAUDE.md.

### 2e. Call sites

* `service.ts:1969-1974` — add `label: salesOpsReceivables.label` to the
  `.returning({...})`.
* `service.ts:1979-1998` (`createSale`) — pass `label: r.label` in the
  receivables map, `costSplitBp: p.costSplitBp ?? null` in the professionals map,
  and note that `existingPayables` is correctly absent here (a fresh sale has
  none).
* `service.ts:2185-2190` (`transitionSale`) — pass `label: r.label`.
* `service.ts:2181-2184` — pass `costSplitBp: p.costSplitBp as number[] | null`.
  The Drizzle `jsonb` column types as `unknown`; cast at this ONE boundary and
  comment that zod already validated the shape on the way in.
* `service.ts:2191-2195` — add `beneficiaryName: p.beneficiaryName`.

### 2f. Revert / lose / cancel — NO CODE CHANGE

`service.ts:2205-2216` keys on `(orgId, saleId, status = 'open')` and mentions
neither `kind` nor `receivableId`. Linked `professional_cost` rows void on revert
exactly as unlinked ones did, and `paid` rows are still untouched. Verify by
reading, change nothing, and add a test.

`service.ts:2286-2295` now also voids the split parts bound to voided future
parcelas, which is the correct new semantics — see `00-OVERVIEW-split.md`. Its
existing test is unaffected because that fixture is all-recurring.

## 3. The named oracle test

Build first: `pnpm run build:packages`.

### Unit

File: `apps/api/src/domains/sales-ops/__tests__/sale-transitions.test.ts`

```
pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/__tests__/sale-transitions.test.ts src/domains/sales-ops/__tests__/service.test.ts
```

New:

* `it('splits a professional cost across the installment receivables pro rata')` —
  three rows at 1000000/2000000/2000000, cost 500000 → 100000/200000/200000, each
  with its own `receivableId` and its own `dueDate`.
* `it('honours a stored cost_split_bp instead of the pro-rata default')` —
  `costSplitBp: [3000, 7000]` over three rows → two drafts on rows 1 and 2.
* `it('leaves professional_cost one-shot when every receivable is recurring')` —
  rows labelled `M1/3`, `M2/3` → a single draft, `receivableId: null`, dated
  `wonDate`. This is the assertion that protects the `cancelContract` fixture.
* `it('does not let one professional paid parcela suppress another professional')` —
  two professionals, existing `{kind: 'professional_cost', receivableId: 'r1', beneficiaryName: 'Ana Martins', status: 'paid'}`;
  assert Ana gets no r1 draft and Carla DOES. This is the beneficiary-guard
  regression test.
* `it('keeps other_cost one-shot')` — explicit, so a later "consistency" refactor
  trips a test instead of changing the ledger.

Updated:

* `:63` `'emits one-shot professional and other cost drafts at the won date'` →
  rename to `'falls back to a one-shot professional cost when there is no receivable'`.
  Body unchanged (`receivables: []` already exercises the fallback).
* `:143` — add `beneficiaryName` to each of the three `existingPayables` entries.

File: `apps/api/src/domains/sales-ops/__tests__/service.test.ts`

* `:277` `'materializeWonPayables links per-row payables and skips voided rows'` —
  the single `professional_cost` draft of 240000 at `:372-379` becomes three
  drafts on `r1`/`r3`/`r4` (r2 is void) of **180000 / 29999 / 30001**, each dated
  from its own receivable. Hand-verified: weights are
  `defaultSplitBp([2000000, 333333, 333333])`, then
  `splitCentsByWeights(240000, bp)`, last part absorbs. The `other_cost` draft at
  `:381-388` is UNCHANGED.

  > Executor note: recompute these three numbers from the real fixture amounts
  > before hardcoding them. If they disagree with the plan, the FUNCTION is the
  > oracle — trust `splitCentsByWeights` and fix the plan's arithmetic, but say
  > so in the run record.

### Integration

```
pnpm --filter @fxl-sales/api test:integration
```

(Pinned to the local Docker test DB per CLAUDE.md; `apps/api/vitest.config.ts`
selects `test/rls/**` plus `src/**/*.integration.test.ts` on
`VITEST_INTEGRATION=1` and runs the migrate-first `globalSetup`, which applies
0017.)

File: `apps/api/src/domains/sales-ops/__tests__/sale-transitions.integration.test.ts`

* `:160` `'creates per-receivable payables at won'` — UPDATE.
  `payables` 8 → 9; `byReceivable(r1)` 3 → 4; `byReceivable(r2)` 3 → 4;
  `oneShots` length 2 → 1 and `oneShots.map(kind)` → `['other_cost']`. Add
  `expect(professionalPayables.reduce(sum)).toBe(40000)`.
* `:235` `'voids future open receivables and their linked open payables only'` —
  UNCHANGED. Verified: its three receivables are `M1/3`, `M2/3`, `M3/3`, so the
  fallback fires and `voidedPayables: 3` still holds. Add an inline comment
  saying so, so a future reader does not "fix" it.
* NEW `it('voids the split parts bound to cancelled future parcelas only')` —
  a sale with three INSTALLMENT receivables and one professional; win; cancel
  with a cutoff after the first; assert the parcela-1 `professional_cost` stays
  `open` and the other two are `void`.

File: `apps/api/test/rls/proposal-write.test.ts`

* `:198` — `expect(byKind.professional_cost?.receivable_id).toBeNull()` becomes
  `.toBe(receivableId)`. `:197` (amount 100000) is unchanged. `:200`
  (`other_cost` → null) is unchanged and is now the positive control for the
  one-shot decision.

File: `apps/api/test/rls/sale-professional-funcoes.test.ts`

* `:515` `'professional_cost payables at won equal the overridden per-row costs'` —
  `:548` `expect(professionalPayables.every((row) => row.receivableId === null)).toBe(true)`
  becomes an assertion that every row's `receivableId` is that sale's single
  receivable id. The `:544-546` amounts and `:549-552` names are unchanged. Fix
  the `:547` comment.
* `:616` revert test — UNCHANGED. Verified: one parcela, so the amounts 100000
  and 30000 are unaffected and the paid/void assertions still hold.
* NEW `it('persists cost_split_bp and pays it out at won')` — create with
  `costSplitBp: [3000, 7000]` on a two-parcela sale, read the row back through
  `adminDb` and assert the column round-trips, transition to `won`, assert two
  payables of 30% and 70% on the two receivables.
* NEW `it('rejects a cost_split_bp that does not sum to 100%')` — `CreateSaleSchema.parse`
  with `[3000, 6000]` throws with `cost_split_sum_mismatch`.
* NEW `it('leaves net_margin_brl unchanged by the split')` — two identical
  proposals differing only in `costSplitBp`; assert `netMarginBrl`,
  `netMarginPct` and `professionalCostsBrl` are equal, and that
  `Σ professional_cost payables === Σ cost_brl` in both. This is the invariant
  from `00-OVERVIEW-split.md` Decision 6 made executable.

## 4. Scope limits (YAGNI)

* NO UI. `apps/web` is untouched by this slice. The column is writable through
  the API and defaults to `NULL`, so the wizard keeps working with no change and
  every existing proposta keeps its exact current behaviour.
* NO `other_cost` split. Decided in `00-OVERVIEW-split.md` Decision 5.
* NO CHECK constraint or trigger for the bp sum. Zod owns it.
* NO backfill. `NULL` is already the correct value for every existing row.
* NO `payables.sale_professional_id`. The beneficiary-name guard is the scoped
  fix; keying payables on the professional row id is a separate slice and is
  recorded as a residual limit in the overview.
* Do NOT change `computeSaleFinancials`, `buildFuncaoCostBasis` or
  `professionalCostBaseCents`. Their arithmetic is correct as written; only their
  COMMENTS change, and those live in slice 07's web files.
* Do NOT drop the deprecated `role` column. Unrelated.

## 5. CLAUDE.md edits

Under `## Propostas domain`.

**Replace the payables bullet.**

Old, verbatim:

> - Payables (`seller_commission`, `finder_commission`, `tax`) materialize only when a proposta transitions to `won`, generated per receivable row and linked via `payables.receivable_id`; `professional_cost` and `other_cost` stay one-shot at win.

New:

> - Payables materialize only when a proposta transitions to `won`. `seller_commission`, `finder_commission` and `tax` are generated per receivable row and linked via `payables.receivable_id`; `professional_cost` is now ALSO per receivable, split across the INSTALLMENT rows only by `resolveProfessionalSplit`; `other_cost` alone stays one-shot with `receivableId: null`, because it names no beneficiary — its `beneficiaryName` is the literal `'Outros custos'` — and has no wizard row to hang a schedule on.
> - The split deliberately skips every `M`-prefixed recurring receivable. An indefinite recorrência generates no bounded rows at all, so any design that included them would need this branch anyway; spreading a pay-once cost over 24 cycles delays a professional's pay years past delivery; and the installment rows are the only ones the wizard can preview, since step 2 holds `installmentRows` and the recorrência as separate state.
> - A proposta with NO eligible installment receivable at win — every row `M`-labelled or void — falls back to the legacy one-shot `professional_cost` at the won date with `receivableId: null`. That branch is what keeps `cancelContract` on a pure-recurring sale behaving exactly as before.

**Insert after that block, four new paragraphs.**

> - `sales_ops_sale_professionals.cost_split_bp` (`jsonb`, nullable, migration `0017_professional_payment_split`) is the per-professional payment schedule: 1..120 non-negative integers in BASIS POINTS summing to exactly `10000`. `NULL` means the default, which is `cost_brl` distributed pro rata over the installment receivable amounts. Basis points and not cents, deliberately: `cost_brl` is edited one control away in the same wizard row, so a cents array would go stale on every cost edit and would need a cross-field refine plus a rewrite inside `Restaurar padrão` and inside every cost keystroke, whereas bp keep `cost_brl` (how much) and the schedule (when) ORTHOGONAL. It is a column and not a child table for the mirror image of the reason `sales_ops_product_funcao_costs` is a table: that one holds a `funcao_id` which must not dangle inside jsonb, while a split part holds no id at all, only a number. The `Σ === 10000` rule is enforced in `SaleProfessionalSchema`, not in SQL, because a `jsonb` array sum needs a subquery a CHECK cannot contain.
> - The part count is INDEPENDENT of the parcela count, because "this one receives in 1 time" on a three-parcela plan is the whole feature. Parts bind POSITIONALLY and FRONT-ALIGNED to the installment receivables in due-date order: part `i` pays out of parcela `i`. Fewer parts than parcelas means the later parcelas carry no `professional_cost` at all; more parts than parcelas folds the tail weights into the last available parcela. Front-aligned rather than back-aligned so that adding a part never renumbers the ones already there. The rule is total for every stored value against every plan, which matters because step 2 can be revisited after step 3.
> - `splitCentsByWeights` in `packages/shared-utils/src/professional-split.ts` is the ONE distribution primitive, following the `computeSaleFinancials` precedent of a single shared implementation rather than two copies: every part but the last is `floor(total × w / Σw)` and the LAST absorbs the whole remainder, so `Σ parts === total` exactly for every input, and for equal weights the output is byte-identical to `splitInstallmentsEqually`'s amounts — pinned by a direct test so the two rounding rules cannot drift. Every caller normalizes to basis points through `defaultSplitBp` first, which is also what keeps `total × w` inside `Number.MAX_SAFE_INTEGER` given that both `cost_brl` and a receivable amount are Postgres `integer`s.
> - The `professional_cost` re-win guard keys on `(kind, receivable_id, beneficiary_name)` and not on `(kind, receivable_id)`. With one row per professional per parcela, a beneficiary-blind guard would let one professional's PAID parcela-1 payable suppress a different professional's parcela-1 payable, and that professional would lose money with no error anywhere. Two professionals sharing an identical `person_name_snapshot` on one sale still collide; the real fix is a `payables.sale_professional_id` column and is not in this milestone.

**Replace the second sentence of the `buildFuncaoCostBasis` bullet.**

Old, verbatim:

> The recurring mensalidade is excluded on purpose: a `professional_cost` payable is one-shot at win with `receivableId: null`, so pricing it off a monthly stream would charge a pay-once cost against every cycle. Free-form items contribute nothing.

New:

> The recurring mensalidade is excluded on purpose, and the per-receivable split did NOT weaken that: a `professional_cost` is still a PAY-ONCE TOTAL, so pricing it off a monthly stream would charge it against every cycle. The split re-prices nothing — it takes an already-computed `cost_brl` and decides only WHEN it is paid, under a `Σ parts === cost_brl` contract — and it skips the `M`-labelled rows too, so the money the cost is measured against and the money it is paid out of are the same non-recurring stream. That is a tighter invariant than before, not a looser one. Free-form items contribute nothing.

**Replace the second sentence of the `CUSTO ALOCADO` unit bullet.**

Old, verbatim:

> The unit is an INPUT MODE and is NOT persisted, because `sales_ops_sale_professionals.cost_brl` is a single integer-cents column and a `professional_cost` payable is one-shot at win, so nothing would ever re-evaluate a stored rule; a saved proposta therefore always reopens in `R$` with the resolved cents, which is the decision that was saved.

New:

> The unit is an INPUT MODE and is NOT persisted, because `sales_ops_sale_professionals.cost_brl` is a single integer-cents column and nothing ever re-evaluates a stored percentage against a later item edit; a saved proposta therefore always reopens in `R$` with the resolved cents, which is the decision that was saved. `cost_split_bp` is the deliberate opposite — persisted as a RULE rather than as cents — precisely because it MUST survive a later `cost_brl` edit unchanged.

## 6. Risk / invariants touched

* **`net_margin_brl` must not move.** `computeSaleFinancials` takes
  `professionalCostsBrl` as a scalar `Σ costBrl` and never sees a schedule.
  Guarded by the new "leaves net_margin_brl unchanged by the split" test.
* **`Σ professional_cost payables === Σ cost_brl`.** Guaranteed by
  `splitCentsByWeights`'s exact-sum contract plus the fact that dropping a
  zero-amount part loses nothing. Asserted directly.
* **Re-win idempotency.** The guard gains a third key. If `beneficiaryName` were
  forgotten on the `existingPayables` map at `service.ts:2191`, every
  professional draft would be suppressed after any paid row. `ExistingPayableRef`
  makes the field REQUIRED so this is a type error, not a silent one.
* **`cancelContract` semantics change** for propostas that mix installments with
  a professional cost. Intended, argued in the overview, covered by a new test.
* **Migration numbering.** 0017 is the next free index; there is a historical
  0007 collision (`0007_hub_identity_columns` and
  `0007_marvelous_valeria_richards`) — do not imitate it.
* **`jsonb` types as `unknown` in Drizzle.** Cast at exactly one boundary
  (`service.ts:2181-2184`) with a comment that zod owns the shape. Do not scatter
  casts.
* **Revert path is unchanged code.** Confirmed by reading
  `service.ts:2205-2216`; the new integration assertions prove it rather than
  assuming it.
