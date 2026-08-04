# Verify - slice 06 - professional split persistence

Branch: `feat/06-professional-split-persistence` (commit `08c2cde`)
Base: `master` (`f4f841d`)
Verified: 2026-08-04
Verdict: **PASS**

The verifier did not write this code and did not read `exec-06-notes.md`.

---

## 1. What the diff actually contains

`git diff master...HEAD --stat` (12 files, 4646 insertions / 26 deletions, of which 4026 insertions are the drizzle snapshot):

```
 CLAUDE.md                                          |   31 +-
 apps/api/drizzle/0017_professional_payment_split.sql |   29 +
 apps/api/drizzle/meta/0017_snapshot.json           | 4026 +++++++++++++++
 apps/api/drizzle/meta/_journal.json                |    7 +
 apps/api/src/db/schema.ts                          |   18 +
 .../sales-ops/__tests__/sale-margin-parity.test.ts |    3 +
 .../__tests__/sale-transitions.integration.test.ts |   80 +-
 .../sales-ops/__tests__/sale-transitions.test.ts   |  186 +-
 .../domains/sales-ops/__tests__/service.test.ts    |   26 +-
 apps/api/src/domains/sales-ops/service.ts          |  118 +-
 apps/api/test/rls/proposal-write.test.ts           |    4 +-
 .../api/test/rls/sale-professional-funcoes.test.ts |  144 +-
```

Note for the record: `resolveProfessionalSplit`, `splitCentsByWeights`, `defaultSplitBp` and
`isRecurringReceivableLabel` are NOT in this diff. They landed on `master` in commit `7ed051e`
(`feat(shared-utils): add professional-split pure arithmetic module`) as the pure-arithmetic slice.
Slice 06 is the wiring + persistence slice. Their 80 shared-utils tests are green on this branch.

There are no `apps/web` changes: the column is persisted and honoured end to end by the API, but no
UI writes a non-null `cost_split_bp` yet. That matches the slice title and is not a defect, but it
does mean the operator-facing half of the feature is still ahead.

---

## 2. Gates - all run once, real tails

### `pnpm run build:packages` - PASS
```
> @fxl-sales/shared-types@1.0.0 build ... tsc --build --force
> @fxl-sales/shared-utils@1.0.0 build ... tsc --build --force
```

### `pnpm run lint` - PASS
```
Scope: 4 of 5 workspace projects
apps/api lint$ eslint src/
apps/web lint$ eslint src/
apps/api lint: Done
apps/web lint: Done
```

### `pnpm run type-check` - PASS
```
packages/shared-types type-check: Done
packages/shared-utils type-check: Done
apps/api type-check: Done
apps/web type-check: Done
```

### `pnpm test` - PASS
```
packages/shared-utils test:  Test Files  3 passed (3)
packages/shared-utils test:       Tests  80 passed (80)
apps/api test:  Test Files  33 passed (33)
apps/api test:       Tests  328 passed (328)
apps/web test:  Test Files  45 passed (45)
apps/web test:       Tests  519 passed (519)
build-contract: ok
```

### `pnpm --filter @fxl-sales/api test:integration` - PASS (full tail)
```
 ✓ src/domains/sales-ops/__tests__/sale-transitions.integration.test.ts (6 tests) 177ms
 ✓ test/rls/funcoes-concurrency.test.ts (4 tests) 636ms
 ✓ test/rls/sale-professional-funcoes.test.ts (16 tests) 663ms
 ✓ test/rls/funcoes-rls.test.ts (14 tests) 583ms
 ✓ test/rls/product-funcao-costs-rls.test.ts (9 tests) 808ms
 ✓ test/rls/proposal-write.test.ts (7 tests) 239ms
 ✓ test/rls/areas-rls.test.ts (5 tests) 112ms
 ✓ test/rls/funcoes-schema-migration.test.ts (8 tests) 108ms
 ✓ test/rls/conversion-webhook-contract.test.ts (3 tests) 87ms
 ✓ test/rls/hub-bff-session-store.test.ts (8 tests) 81ms
 ✓ test/rls/conversion-ingest.test.ts (4 tests) 79ms
 ✓ src/domains/finders/__tests__/finder-state-machine.integration.test.ts (6 tests) 73ms
 ✓ test/rls/proposal-schema-migration.test.ts (2 tests) 82ms
 ✓ test/rls/product-commission-contract.test.ts (2 tests) 70ms
 ✓ test/rls/conversions-commissions-rls.test.ts (3 tests) 74ms
 ✓ test/rls/cross-tenant.test.ts (4 tests) 56ms
 ✓ test/rls/client-legal-fields.test.ts (1 test) 50ms
 ✓ test/rls/list-finder-links-cross-tenant.test.ts (2 tests) 56ms
 ✓ test/rls/referral-links-public-lookup.test.ts (3 tests) 44ms
 ✓ test/rls/produtos-servicos-schema-migration.test.ts (6 tests) 40ms

 Test Files  20 passed (20)
      Tests  113 passed (113)
   Start at  17:25:18
   Duration  9.50s (transform 212ms, setup 51ms, collect 3.04s, tests 4.12s, environment 1ms, prepare 562ms)
```

### `pnpm run build` (extra, not requested but a documented gate) - PASS
```
✓ built in 4.14s
```

---

## 3. Money-critical checks

Every line below was proven by MUTATING the implementation and observing red tests, not by reading.
Each mutation was applied with an exact-single-occurrence patcher and reverted with
`git checkout --` immediately after.

### 3.1 `Σ professional_cost payables === Σ cost_brl` - **PASS**

Mutation **M1**: `for (const part of parts)` -> `for (const part of parts.slice(0, -1))`
(drops the last split part, i.e. exactly the "professional silently underpaid" bug).

```
--- unit ---   Test Files  2 failed | 31 passed (33)
               Tests  6 failed | 322 passed (328)
   × materializeWonPayables ... splits a professional cost across the installment receivables pro rata
   × materializeWonPayables ... honours a stored cost_split_bp instead of the pro-rata default
   × materializeWonPayables ... leaves professional_cost one-shot when every receivable is recurring
   × materializeWonPayables ... does not let one professional paid parcela suppress another professional
   × materializeWonPayables ... falls back to a one-shot professional cost when there is no receivable
   × sales operations sale ledger > materializeWonPayables links per-row payables and skips voided rows

--- integration ---  Test Files  3 failed | 17 passed (20)
                     Tests  8 failed | 105 passed (113)
   × persists cost_split_bp and pays it out at won
   × leaves net_margin_brl unchanged by the split          <- the Σ === 100000 assertion
   × professional_cost payables at won equal the overridden per-row costs
   × reverting a won proposta voids the overridden professional_cost payables but never a paid one
   × create with status won materializes per-receivable payables immediately
   × win materializes payables linked to each receivable row
   × cancelContract > voids future open receivables and their linked open payables only
   × cancelContract > voids the split parts bound to cancelled future parcelas only
```

14 distinct tests catch a dropped part. The exact-sum assertion exists in three independent forms:
`Σ === 40000` in `sale-transitions.integration.test.ts`, `Σ === 90000` in the new cancelContract
test, and `Σ === 100000` under both split and no-split in
`test/rls/sale-professional-funcoes.test.ts > leaves net_margin_brl unchanged by the split`.

The underlying exact-sum primitive (`splitCentsByWeights`, last part absorbs the whole floor
remainder) is on `master` with its own 80-test suite, so the invariant is total for every input,
not only for the fixtures here.

### 3.2 `net_margin_brl` did not move - **PASS**

Two independent claims, each proven separately.

**(a) Two propostas differing only in `costSplitBp` persist identical margins.**
`test/rls/sale-professional-funcoes.test.ts > leaves net_margin_brl unchanged by the split` creates
two sales with identical everything except `costSplitBp: [1000, 9000]` and asserts
`professionalCostsBrl`, `netMarginBrl` and `netMarginPct` are equal.

Mutation **M7**: made `professionalCostsBrl` in `buildSaleLedger` consume the split
(`costSplitBp ? floor(costBrl * bp[0] / 10000) : costBrl`), i.e. let the schedule leak into the
margin.
```
--- unit ---         Tests  328 passed (328)          (unit suite does not cover this)
--- integration ---  Tests  1 failed | 112 passed (113)
   × leaves net_margin_brl unchanged by the split
```
The test catches the regression.

**(b) A proposta with no override persists exactly what `master` persisted.**
`apps/api/src/domains/sales-ops/__tests__/sale-margin-parity.test.ts` pins the golden fixture to
absolute cents: `netMarginBrl = 2122658`, `netMarginPct = '70.76'`, `professionalCostsBrl = 130000`,
`sellerCommissionBrl = 449999`, `taxBrl = 179999`. `git diff master...HEAD` on that file shows
**only three added `costSplitBp: null` lines and zero changed numbers** - every pinned money value
is byte-identical to `master`. That is the master-parity proof.

Mutation **M7b**: `sum + professional.costBrl` -> `sum + professional.costBrl + 1` (one cent).
```
--- unit ---  Tests  2 failed | 326 passed (328)
   × sale margin parity - API ledger > buildSaleLedger reports the golden fixture financials
   × sale margin parity - API ledger > drops the finder commission when no finder is on the proposta,
     keeping every other number
```
A one-cent margin drift is caught.

### 3.3 The re-win guard keys on `(kind, receivableId, beneficiaryName)` - **PASS**

Implementation:
```ts
const alreadyExists = (kind, receivableId, beneficiaryName?) =>
  existingPayables.some((p) =>
    p.kind === kind && p.receivableId === receivableId && p.status !== 'void' &&
    (beneficiaryName === undefined || p.beneficiaryName === beneficiaryName));
```
`beneficiaryName` is opt-in per call and only the `professional_cost` call passes it.
`ExistingPayableRef.beneficiaryName` is a REQUIRED field, so a forgotten call site is a type error.

Mutation **M2**: `payable.beneficiaryName === beneficiaryName` -> `true` (i.e. back to the
two-key, beneficiary-blind guard).
```
--- unit ---         Tests  1 failed | 327 passed (328)
   × materializeWonPayables: professional cost split (slice 06)
     > does not let one professional paid parcela suppress another professional
--- integration ---  Tests  113 passed (113)
```
The dedicated unit test catches it: with the blind guard, Ana's paid parcela-1 row suppresses
Carla's parcela-1 row and Carla silently loses R$ 300,00. The test asserts
`carla.map(receivableId) === ['r1','r2']` and `carla.map(amountBrl) === [30000, 30000]`, so it
checks the amounts too, not only presence.

Observation (not a failure, already documented in CLAUDE.md by the author): two professional rows
on one sale carrying an identical `person_name_snapshot` still collide under this guard. CLAUDE.md
states the real fix is a `payables.sale_professional_id` column and defers it. Under `master` the
guard was strictly worse (any one professional payable suppressed ALL professionals), so this is a
strict improvement with a named, bounded residual.

### 3.4 `other_cost` is still one-shot with `receivableId: null` - **PASS**

Mutation **M5**: `receivableId: null` on the `other_cost` draft -> `splitReceivables[0]?.id ?? null`.
```
--- unit ---         Tests  2 failed | 326 passed (328)
   × materializeWonPayables ... keeps other_cost one-shot
   × sales operations sale ledger > materializeWonPayables links per-row payables and skips voided rows
--- integration ---  Tests  2 failed | 111 passed (113)
   × create with status won materializes per-receivable payables immediately
   × win materializes payables linked to each receivable row
```
The integration suite additionally pins `oneShots` to exactly `['other_cost']` (length 1), so
`other_cost` is now proven to be the ONLY null-receivable payable kind.

### 3.5 Recurring (`M`-prefixed) receivables are excluded, and an all-recurring sale keeps the legacy one-shot fallback - **PASS**

Mutation **M3**: `.filter((row) => row.status !== 'void' && !isRecurringReceivableLabel(row.label))`
-> `.filter((row) => row.status !== 'void')`.
```
--- unit ---         Tests  1 failed | 327 passed (328)
   × materializeWonPayables ... leaves professional_cost one-shot when every receivable is recurring
--- integration ---  Tests  1 failed | 112 passed (113)
   × cancelContract > voids future open receivables and their linked open payables only
```
Both the pure fallback (`receivableId: null`, `dueDate === wonDate`) and its real-database
consequence in `cancelContract` are pinned. The existing all-`M` cancelContract fixture also carries
an explicit block comment explaining why its counts did NOT change, which is the right way to keep a
future reader from "fixing" them.

Coverage observation (recommend a follow-up test, does not block): there is no test for the MIXED
shape - one `1/1` setup parcela plus bounded `M1/3..M3/3` rows on the same sale, which is the real
shape of a Serviço with recorrência. By construction the whole cost lands on the single setup
parcela, which is the intended semantic, and M3 proves the filter is live; but the mixed case is not
pinned anywhere.

---

## 4. Transition paths

### 4.1 revert / lose / cancel void only `open` payables, never `paid` - **PASS**

Read: `transitionSale`'s `to === 'open'` branch voids with
`and(orgId, saleId, eq(status, 'open'))`. `lost` and `cancelled` are unreachable from `won`
(`SALE_TRANSITIONS.won === ['open']`), so revert is the only door out and the only voiding path.
`cancelContract` voids with `and(orgId, saleId, eq(status, 'open'), inArray(receivableId, futureIds))`.

Mutation **M8**: removed `eq(salesOpsPayables.status, 'open')` from the revert branch.
```
--- integration ---  Tests  2 failed | 111 passed (113)
   × reverting a won proposta voids the overridden professional_cost payables but never a paid one
   × transitionSale > reverting a won sale voids open payables, keeps paid ones, and clears won_at
```

Mutation **M9**: removed `eq(salesOpsPayables.status, 'open')` from `cancelContract`.
```
--- integration ---  Tests  1 failed | 112 passed (113)
   × cancelContract > voids future open receivables and their linked open payables only
```

### 4.2 `cancelContract` voids the split parts bound to cancelled future parcelas and leaves the already-due ones open - **PASS, and the test is for the NEW behaviour**

New test: `sale-transitions.integration.test.ts > voids the split parts bound to cancelled future
parcelas only`. 90000 cost over parcelas `1/3` (2026-08-01), `2/3` (2026-09-01), `3/3` (2026-10-01);
cancel effective `2026-08-15`; asserts `r1 -> open`, `r2 -> void`, `r3 -> void`, and asserts the
pre-cancel `Σ === 90000` over 3 rows.

Proof it pins the NEW behaviour rather than passing vacuously - Mutation **M4**:
`receivableId: part.receivableId` -> `receivableId: null` (i.e. restore the pre-slice unlinked
one-shot shape).
```
--- unit ---         Tests  4 failed | 324 passed (328)
--- integration ---  Tests  5 failed | 108 passed (113)
   × cancelContract > voids the split parts bound to cancelled future parcelas only   <- this one
   × win materializes payables linked to each receivable row
   × professional_cost payables at won equal the overridden per-row costs
   × persists cost_split_bp and pays it out at won
   × create with status won materializes per-receivable payables immediately
```
The new cancelContract test goes red under the old shape, so it genuinely encodes the behaviour
change rather than merely surviving it.

Edge worth logging as a follow-up doubt (does NOT block): after a `cancelContract` -> revert to
`open` -> re-win cycle, the split is recomputed over only the SURVIVING (non-void) parcelas while
the already-`paid` part is honoured by the guard, so `Σ paid + Σ regenerated` can differ from
`cost_brl`. Arguably correct (you do not owe the professional for parcelas the client will never
pay), but it is not pinned by any test and the invariant statement in CLAUDE.md does not carve it
out. `master` had the same class of imprecision in the opposite direction.

---

## 5. Validation of `cost_split_bp`

**PASS.**

Schema (`SaleProfessionalSchema`): `z.array(z.number().int().min(0).max(10_000)).min(1).max(120).nullish()`
plus a `superRefine` that raises `cost_split_sum_mismatch` at `path: ['costSplitBp']` when the sum
is not exactly `10_000`. `.min(1)` forbids `[]` (the empty schedule is spelled `null`), `.max(120)`
mirrors the installment cap.

400 not 500: `routes.ts:253` does `CreateSaleSchema.safeParse(...)` and answers
`c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400)` on failure - a
`safeParse`, so a bad split can never reach a `throw` and become a 500. The same `safeParse` shape
covers `UpdateSaleSchema` (both extend `SaleWriteBaseSchema`, which holds
`professionals: z.array(SaleProfessionalSchema)`).

The test asserts the actual identifier: `.toThrow(/cost_split_sum_mismatch/)` in
`test/rls/sale-professional-funcoes.test.ts > rejects a cost_split_bp that does not sum to 100%`.

Mutation **M6**: `if (total !== 10_000)` -> `if (total !== total)` (never fires).
```
--- unit ---         Tests  328 passed (328)
--- integration ---  Tests  1 failed | 112 passed (113)
   × rejects a cost_split_bp that does not sum to 100%
```

Minor note: the test asserts at the schema level, not through the HTTP route, so the "400 and not
500" property is established by construction (`safeParse` at the single write boundary) rather than
by an assertion on a response status. That is the same pattern every other write in this router
uses, so it is consistent; a route-level case would be a nice-to-have.

---

## 6. Migration - **PASS**

`apps/api/drizzle/0017_professional_payment_split.sql`, one statement:
```sql
ALTER TABLE "sales_ops_sale_professionals" ADD COLUMN "cost_split_bp" jsonb;
```

- **Next free index.** `_journal.json` entries are `[0..17]`, strictly increasing by 1 from 0, no
  gaps and no duplicates; the last three tags are `0015_servico_base_value`,
  `0016_hub_bff_session_store`, `0017_professional_payment_split`. Snapshot chain verified:
  `0016_snapshot.id === 0017_snapshot.prevId === a4b7f631-0dd1-4f1e-b8d6-09bc3060a585`.
- **Expand-only.** Verified against the live test DB:
  `cost_split_bp | jsonb | is_nullable=YES | column_default=(none)`. No backfill, no `UPDATE`, no
  `NOT NULL`, no index on the column (`pg_indexes` on the table lists only `_pkey`, `_sale_id_idx`
  and `_org_funcao_idx`). Safe to apply ahead of the deploy: drizzle builds explicit column lists
  from the TS schema, so pre-deploy code never selects a column it does not know about. Revert is a
  clean `DROP COLUMN` - nothing depends on it.
- **No RLS statement, and the table already carries its policies** - verified live, not assumed:
  ```
  pg_class:   relrowsecurity=t   relforcerowsecurity=t
  pg_policies: sales_ops_sale_professionals_tenant_isolation
                 USING (org_id = current_setting('app.current_org_id', true))
               sales_ops_sale_professionals_admin_context
                 USING (current_setting('app.fxl_admin', true) = 'true')
  ```
  Both originate in `0007_marvelous_valeria_richards.sql` (lines 224-230). A new column inherits
  them.
- **No CHECK constraint attempting the sum rule.**
  `select conname from pg_constraint where conrelid='sales_ops_sale_professionals'::regclass and contype='c'`
  returns ZERO rows, and `grep -rn "cost_split" apps/api/drizzle/*.sql` matches only the single
  `ADD COLUMN` line. `0017_snapshot.json` shows `checkConstraints: {}` for the table. The migration
  header explains why (a jsonb array sum needs a subquery a CHECK may not contain) and points at the
  zod rule, which section 5 proves is live.
- 18 rows in `drizzle.__drizzle_migrations` in the test DB, i.e. 0017 is applied.

---

## 7. Tenancy / RLS - **PASS**

The new column changes nothing about tenancy: it adds no id, no FK, and no query path. `withTenant`
still scopes every read and write, and the professional select in `transitionSale` still carries
`eq(salesOpsSaleProfessionals.orgId, orgId)`.

**Live tenant-side probe** (run inside a rolled-back transaction, as the app role
`fxl_sales_test`, which `pg_roles` confirms is `rolsuper=f, rolbypassrls=f`):
```
INSERT a sale + professional for org_rlsprobe with cost_split_bp = '[3000,7000]'
SET ROLE fxl_sales_test;
  app.current_org_id='org_OTHER'      -> wrong-org tenant-side rows  | 0
  app.current_org_id='org_rlsprobe'   -> right-org tenant-side rows  | 1
                                      -> split visible tenant-side  | [3000, 7000]
ROLLBACK
```
So the new column is inside the tenant policy, and RLS is genuinely enforced on the connection the
suite uses. `apps/api/.env` confirms the split: `TEST_DATABASE_URL` connects as `fxl_sales_test`
(no bypass), `ADMIN_DATABASE_URL` connects as `postgres` (`rolbypassrls=t, rolsuper=t`).

**Which side each new assertion is on** - stated explicitly, since the admin side proves only
existence:

| New assertion | Connection | What it proves |
| --- | --- | --- |
| `createSale(db, orgA.orgId, ...)` in all three new tests | **tenant** (`fxl_sales_test`) | writes pass RLS |
| `transitionSale(db, orgA.orgId, ...)` in all three new tests | **tenant** | payable materialization passes RLS |
| `professionalRows[0].costSplitBp === [3000,7000]` | admin | round-trip content only |
| `[[r1,30000],[r2,70000]]` payable payout | admin | content only |
| margin equality + `Σ === 100000` | admin (reads) / tenant (writes) | content only |
| `receivables[0].id` linkage in the amended existing test | admin | content only |
| `voids the split parts ... only` (cancelContract) | tenant write, admin read | content only |

So none of the NEW assertions carry RLS weight - they are correctness assertions, which is what they
are for. The RLS weight is carried by the UNCHANGED cross-tenant tests in the same file
(`rejects a professional funcaoId from another org ... and writes nothing`,
`rejects a cross-org funcaoId even when row security cannot hide the miss (admin context)`,
`rejects a cross-org personId ...`, `the composite foreign key rejects a cross-org funcao_id even in
the admin context`), plus `test/rls/cross-tenant.test.ts`. All 16 + 4 still pass, none were touched,
and the live probe above shows the policy is not vacuous.

---

## 8. Coverage integrity

```
git diff master...HEAD -- '*test*' | grep -c "^-[^-]"   ->   14
```

All 14 removed lines, each classified:

| # | Removed | Replaced with | Verdict |
| --- | --- | --- | --- |
| 1 | `expect(payables).toHaveLength(8)` | `toHaveLength(9)` + comment naming the 4-per-receivable + 1 one-shot shape | **tightened** (still an exact count) |
| 2 | `expect(byReceivable(r1.id)).toHaveLength(3)` | `toHaveLength(4)` | **tightened** |
| 3 | `expect(byReceivable(r2.id)).toHaveLength(3)` | `toHaveLength(4)` | **tightened** |
| 4 | `expect(oneShots).toHaveLength(2)` | `toHaveLength(1)` | **tightened** |
| 5 | `expect(oneShots.map(kind).sort()).toEqual(['other_cost','professional_cost'])` | `expect(oneShots.map(kind)).toEqual(['other_cost'])` | **tightened**; the dropped `.sort()` is a no-op on a 1-element array. Three NEW assertions added alongside: `professionalPayables` length 2, all `receivableId !== null`, `Σ === 40000` |
| 6 | test title `emits one-shot professional and other cost drafts at the won date` | `falls back to a one-shot professional cost when there is no receivable` | **rename only** - body verified byte-identical (`receivables: []`, same `toEqual` of two drafts). The old title was simply now-wrong |
| 7-9 | three `existingPayables` literals without `beneficiaryName` | same literals + `beneficiaryName` | **neutral** - the field became required; assertions unchanged |
| 10-11 | `amountBrl: 240000` / `receivableId: null` (one draft) | three explicit drafts `r1:180000`, `r3:29976`, `r4:30024` with a comment deriving them, Σ = 240000 | **tightened** (1 assertion -> 3, with exact per-row cents) |
| 12 | `expect(byKind.professional_cost?.receivable_id).toBeNull()` | `.toBe(receivableId)` + a positive-control comment on the `other_cost` line below it | **tightened** (asserts a specific id, not a null) |
| 13-14 | `expect(professionalPayables.every(r => r.receivableId === null)).toBe(true)` + its comment | `.every(r => r.receivableId === receivables[0]!.id)`, preceded by a NEW `expect(receivables).toHaveLength(1)` | **tightened** |

**Nothing was weakened.** No assertion was deleted without replacement, no `toEqual` became a
`toContain`, no exact count became a `toBeGreaterThan`, no test was skipped or removed. Every one of
the 14 was an expectation of the OLD one-shot shape being restated as the NEW per-parcela shape,
and every mutation in section 3 confirms the replacements bite.

Net test movement: `apps/api` unit `328` (all pass), integration `113` (all pass), with 5 new unit
cases in `sale-transitions.test.ts`, 1 new integration case in `sale-transitions.integration.test.ts`
and 3 new cases in `test/rls/sale-professional-funcoes.test.ts`.

---

## 9. Mutation summary

| ID | Mutation | Unit red | Integration red |
| --- | --- | --- | --- |
| M1 | drop the last split part | 6 | 8 |
| M2 | beneficiary-blind re-win guard | 1 | 0 |
| M3 | stop excluding `M`-prefixed receivables | 1 | 1 |
| M4 | `receivableId: null` on split parts (pre-slice shape) | 4 | 5 |
| M5 | link `other_cost` to a receivable | 2 | 2 |
| M6 | disable the `Σ === 10000` refine | 0 | 1 |
| M7 | let the split leak into `professionalCostsBrl` | 0 | 1 |
| M7b | +1 cent on the professional cost sum | 2 | - |
| M8 | revert path voids `paid` payables too | - | 2 |
| M9 | `cancelContract` voids `paid` payables too | - | 1 |

Every mutation was caught. All were reverted; `git status --short` shows only the pre-existing
untracked `.vscode/`, `nexo/plans/batch-20260804-props-costs/` and
`nexo/runs/batch-20260804-props-costs/`, and `git diff HEAD` is empty.

---

## 10. Verdict

**PASS.**

All six gates green including the integration suite (113/113). Every money-critical line is proven
by mutation: the exact-sum invariant, the margin invariance in both directions (split-vs-no-split
and master-parity via the untouched golden pins), the three-key re-win guard, the `other_cost`
one-shot, the recurring exclusion with its one-shot fallback, both paid-preserving transition
guards, and the sum validation. The `cancelContract` behaviour change has a test that goes red under
the old shape, so it pins the new behaviour rather than tolerating it. The migration is a single
nullable `ADD COLUMN` at the genuinely next free index with a verified snapshot chain, no default,
no backfill, no index, no CHECK, no RLS statement, on a table whose FORCE RLS and two policies were
confirmed live. The new column sits inside the tenant policy, confirmed by a live probe on the
non-bypassing app role. Fourteen test lines changed and every one was tightened or is a pure rename.

Non-blocking follow-ups for the capture, in priority order:

1. Two professional rows sharing an identical `person_name_snapshot` still collide in the re-win
   guard. Already named in CLAUDE.md with the intended fix (`payables.sale_professional_id`); worth
   a ROADMAP entry so it is not lost.
2. `cancelContract` -> revert -> re-win recomputes the split over surviving parcelas only, so
   `Σ paid + Σ regenerated` can differ from `cost_brl`. Probably intended; not pinned by any test
   and not carved out of the CLAUDE.md invariant.
3. No test covers the MIXED receivable shape (one setup parcela plus bounded `M` rows), which is the
   real shape of a Serviço with recorrência.
4. The `cost_split_bp` rejection is asserted at the schema level; a route-level case asserting the
   literal `400` would close the last inch of the "not a 500" claim.
5. No `apps/web` writer exists yet, so `cost_split_bp` is always `NULL` in production until the
   wizard slice lands. The default pro-rata behaviour is what ships today.
