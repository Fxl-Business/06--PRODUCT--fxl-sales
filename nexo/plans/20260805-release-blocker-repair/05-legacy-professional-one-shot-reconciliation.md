---
id: 05-legacy-professional-one-shot-reconciliation
milestone: v2.4.0
status: done
depends_on: [06-phased-professional-identity-migration]
files_modified:
  - apps/api/src/domains/sales-ops/service.ts
  - apps/api/src/domains/sales-ops/__tests__/sale-transitions.test.ts
  - apps/api/src/domains/sales-ops/__tests__/sale-transitions.integration.test.ts
acceptance: "given paid professional-cost payables created by the v2.3.1 one-shot runtime, when migration 0018 backfills an unambiguous row or leaves an ambiguous same-name row null and the sale moves won to open to won, then each surviving full-cost one-shot covers exactly one professional and the active professional total is correct without duplicate obligations"
---

# Legacy Professional One-Shot Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.
> Use `superpowers:test-driven-development` for Red, Green, and Refactor, and do not change the locked PostgreSQL oracles after recording their failures.

**Goal:** Reconcile paid professional costs created by the v2.3.1 one-shot model with the v2.4 per-installment model without materializing the same professional cost twice.

**Architecture:** Classify a surviving non-void `professional_cost` with `receivableId === null` and `amountBrl === professional.costBrl` as one full-cost one-shot.
An identified one-shot covers its exact `saleProfessionalId` before per-receivable matching begins.
An unidentified one-shot is consumed from a collision-safe multiset keyed by beneficiary snapshot and full cost so one ambiguous historical row covers at most one current professional.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL, postgres-js, Vitest, and the existing tenant-scoped `transitionSale` service.

## Global Constraints

- Preserve the current per-receivable split algorithm, rounding, due dates, statuses, and receivable filtering.
- Preserve current matching of identified split payables by `(saleProfessionalId, receivableId)`.
- Preserve current null-ID split fallback matching by `(beneficiaryName, receivableId, amountBrl)`.
- A full-cost one-shot is exactly a non-void `professional_cost` whose `receivableId` is null and whose `amountBrl` equals the current professional's complete `costBrl`.
- An identified full-cost one-shot may suppress only the professional carrying the same durable ID.
- An unidentified full-cost one-shot may suppress only one same-name, same-cost professional.
- Process identified full-cost one-shots before consuming unidentified counts.
- Do not infer identity from array order, role, person ID, due date, or name alone.
- Do not rewrite historical payable rows in the runtime.
- Do not change migration DDL, schema, generated snapshots, UI, `computeSaleFinancials`, or cancellation behavior in this slice.
- Do not treat a partial or mismatched one-shot amount as full coverage.
- The two PostgreSQL upgrade-path tests are locked after Red and may not be weakened, skipped, deleted, or rewritten during Green.
- Run every command once without watch mode and stop every process started for this slice.

---

## File map

- `apps/api/src/domains/sales-ops/__tests__/sale-transitions.integration.test.ts` owns the real v2.3.1-shaped upgrade-path oracles.
- `apps/api/src/domains/sales-ops/__tests__/sale-transitions.test.ts` pins exact one-shot consumption and mismatch controls in the pure materializer.
- `apps/api/src/domains/sales-ops/service.ts` owns full one-shot classification and consumption before split materialization.

## Exact behavior contract

The materializer must distinguish these two legacy pools.

```ts
type LegacyProfessionalCandidate = {
  beneficiaryName: string;
  receivableId: string | null;
  amountBrl: number;
};

const legacyProfessionalPartKey = (candidate: LegacyProfessionalCandidate): string =>
  JSON.stringify([candidate.beneficiaryName, candidate.receivableId, candidate.amountBrl]);

const legacyProfessionalOneShotKey = (candidate: {
  beneficiaryName: string;
  amountBrl: number;
}): string => JSON.stringify([candidate.beneficiaryName, candidate.amountBrl]);
```

The null-receivable rows belong only to the one-shot pool.
The non-null-receivable rows belong only to the per-part pool.
No historical row may be counted in both pools.

### Task 1: Lock the two real PostgreSQL upgrade-path failures

**Files:**

- Modify: `apps/api/src/domains/sales-ops/__tests__/sale-transitions.integration.test.ts`

**Interfaces:**

- Consumes: `seedSale`, `seedReceivable`, `seedProfessional`, `transitionSale`, `getDb`, `getAdminDb`, and the `backfill-repeat` statement extracted from phased migration `0018_professional_payable_identity.sql`.
- Produces: two immutable end-user-aligned upgrade tests over real PostgreSQL.

- [ ] **Step 1: Add a reusable backfill executor inside the test file**

Split migration `0018` on `--> statement-breakpoint` and require exactly one chunk containing a line equal to `-- fxl-phase: backfill-repeat`.
Select that marked chunk rather than searching for a chunk that starts with the CTE.
If `sql.raw` execution requires removal of the runner directive, remove only the one leading marker line with `markedChunk.replace(/^\s*-- fxl-phase: backfill-repeat\r?\n/, '')`.
Assert that the remaining text begins with `WITH "unambiguous_professional_matches"` and execute that exact remaining shipped SQL with `adminDb.execute(sql.raw(backfill))`.
Do not trim, copy, reconstruct, or otherwise rewrite the SQL statement.

- [ ] **Step 2: Add the identified historical one-shot oracle**

Add the exact test name `v2.3.1 paid one-shot remains the complete identified professional cost after upgrade and re-win`.
Seed one sale directly in `won` status with `wonAt: new Date('2026-08-05T00:00:00.000Z')` and zero commission, tax, finder, and other cost.
Seed one installment receivable and one professional named `Profissional Legado` with `costBrl: 100000`.
Insert one paid `professional_cost` row with the v2.3.1 shape: `receivableId: null`, `saleProfessionalId: null`, beneficiary `Profissional Legado`, `dueDate: new Date('2026-08-05T00:00:00.000Z')`, and `amountBrl: 100000`.
Run the exact migration 0018 identity backfill and assert that the paid row receives the seeded professional ID.
Call the real tenant-scoped `transitionSale(getDb(), orgId, sale.id, 'open')` and then `transitionSale(getDb(), orgId, sale.id, 'won')`.
Select all professional-cost rows for the organization and sale.
Assert that the only active row is the original paid row, its receivable remains null, its durable identity remains the professional ID, and the active amount sum is `100000`.

- [ ] **Step 3: Add the ambiguous historical one-shot oracle**

Add the exact test name `v2.3.1 ambiguous paid one-shot covers one same-name professional after upgrade and re-win`.
Seed one sale directly in `won` status with `wonAt: new Date('2026-08-05T00:00:00.000Z')` and all non-professional payable percentages and costs zero.
Seed one installment receivable and two professionals with the same snapshot `Profissional Homonimo`, each with `costBrl: 100000`.
Insert one paid v2.3.1-shaped professional-cost row with `receivableId: null`, `saleProfessionalId: null`, beneficiary `Profissional Homonimo`, `dueDate: new Date('2026-08-05T00:00:00.000Z')`, and `amountBrl: 100000`.
Run the exact migration 0018 backfill and assert that the ambiguous row remains null.
Run the real won to open to won transition sequence.
Assert that the active rows contain the original null-ID paid one-shot plus exactly one newly split open row.
Assert that the new row has one of the two professional IDs and the installment receivable ID.
Assert that the two active rows total `200000`, neither professional cost is duplicated, and any void rows are excluded from the total.

- [ ] **Step 4: Run only the two new tests and record Red**

```bash
VITEST_INTEGRATION=1 pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/__tests__/sale-transitions.integration.test.ts -t "v2.3.1"
```

Expected Red for the identified case: the original paid `100000` remains active and the runtime emits another `100000` split row, producing `200000` instead of `100000`.
Expected Red for the ambiguous case: the one null-ID paid `100000` remains active and both current professionals are emitted, producing `300000` instead of `200000`.
Both failures must occur after the real backfill and both real transitions complete.

### Task 2: Pin unit-level one-shot allocation and negative controls

**Files:**

- Modify: `apps/api/src/domains/sales-ops/__tests__/sale-transitions.test.ts`

**Interfaces:**

- Consumes: `materializeWonPayables` and its existing explicit ID contract.
- Produces: focused tests for identified and unidentified one-shot allocation.

- [ ] **Step 1: Add the identified full one-shot unit test**

Add `it('treats an identified full-cost one-shot as complete coverage across new split receivables')`.
Use one professional with ID `professional-a`, name `Profissional Legado`, cost `100000`, and two equal installment receivables.
Pass one paid existing payable with `saleProfessionalId: 'professional-a'`, `receivableId: null`, and `amountBrl: 100000`.
Assert that `materializeWonPayables` returns no professional draft.

- [ ] **Step 2: Add the ambiguous multiset unit test**

Add `it('consumes each null-id full-cost one-shot for only one same-name professional')`.
Use two same-name professionals with distinct IDs and equal `100000` costs plus one installment receivable.
With one paid null-ID one-shot, assert that exactly one `100000` draft remains.
With two paid null-ID one-shots, assert that no draft remains.
With one null-ID one-shot whose amount is `99999`, assert that both `100000` drafts remain.

- [ ] **Step 3: Keep split legacy behavior as a positive control**

Retain the existing `consumes each null-id legacy payable at most once` test for non-null receivable rows.
Add an assertion that its legacy fixture has `receivableId: 'r1'` so the split pool and one-shot pool cannot silently collapse into one rule.

- [ ] **Step 4: Run the unit file and retain Red**

```bash
pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/__tests__/sale-transitions.test.ts
```

Expected Red: identified and null-ID full one-shots do not match per-receivable candidates, so unexpected drafts remain.

### Task 3: Reconcile full one-shots before per-part materialization

**Files:**

- Modify: `apps/api/src/domains/sales-ops/service.ts`

**Interfaces:**

- Consumes: `ExistingPayableRef[]`, each professional's durable ID, name, and complete cost.
- Produces: one-use full one-shot coverage without changing generated draft shapes.

- [ ] **Step 1: Separate unidentified full one-shots from unidentified split parts**

Build `legacyProfessionalOneShotCounts` only from non-void null-ID professional-cost rows whose `receivableId === null`.
Key the counts with `legacyProfessionalOneShotKey({ beneficiaryName, amountBrl })`.
Build the existing per-part multiset only from non-void null-ID professional-cost rows whose `receivableId !== null`.

- [ ] **Step 2: Add one-use full one-shot consumption**

Add a local `consumeLegacyProfessionalOneShot` helper with the same decrement-or-delete behavior as the current multiset consumer.
Its candidate must be exactly `{ beneficiaryName: professional.personName, amountBrl: professional.costBrl }`.

- [ ] **Step 3: Short-circuit each professional before resolving or emitting parts**

Before per-part matching, find an existing non-void `professional_cost` with the same `saleProfessionalId`, `receivableId === null`, and `amountBrl === professional.costBrl`.
If found, continue to the next professional without consuming a null-ID count.
Otherwise consume one matching null-ID full one-shot and continue to the next professional if consumption succeeds.
Only then resolve and reconcile the current professional's per-receivable parts using the existing identified and null-ID split rules.

- [ ] **Step 4: Run focused unit Green**

```bash
pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/__tests__/sale-transitions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run the locked PostgreSQL upgrade oracles**

```bash
VITEST_INTEGRATION=1 pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/__tests__/sale-transitions.integration.test.ts -t "v2.3.1"
```

Expected: both tests PASS with active totals `100000` and `200000` respectively.

### Task 4: Refactor only while Green

**Files:**

- Modify only files already listed in this plan.

- [ ] **Step 1: Remove duplicated count consumption without merging the two key spaces**

A local decrement helper may be shared by both maps.
The one-shot and split maps, keys, and classification predicates must remain visibly distinct.

- [ ] **Step 2: Re-run all focused behavior**

```bash
pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/__tests__/sale-transitions.test.ts
VITEST_INTEGRATION=1 pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/__tests__/sale-transitions.integration.test.ts
```

Expected: PASS.

## Verification contract

A different Verify agent must run these commands from the repository root.

```bash
pnpm run build:packages
pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/__tests__/sale-transitions.test.ts
VITEST_INTEGRATION=1 pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/__tests__/sale-transitions.integration.test.ts
pnpm --filter @fxl-sales/api exec eslint src/domains/sales-ops/service.ts src/domains/sales-ops/__tests__/sale-transitions.test.ts src/domains/sales-ops/__tests__/sale-transitions.integration.test.ts
pnpm --filter @fxl-sales/api type-check
git diff --check
```

The verifier must inspect both database fixtures and confirm they reproduce the v2.3.1 shape with null receivable and null identity before backfill.
The verifier must confirm the identified row is backfilled, the ambiguous row is not, both real transitions run, and totals exclude void rows.
No test, build, or server process may remain running after verification.

## Atomic capture guidance

After separate-agent Verify returns PASS, stage exactly the three files in `files_modified` and inspect `git diff --cached --check` and `git diff --cached --stat`.
Capture the slice with this Conventional Commit.

```bash
git commit -m "fix(sales-ops): reconcile legacy professional one-shots"
```

Do not tag, promote staging, or close milestone `v2.4.0` in this slice.
