---
id: 02-professional-payable-identity
milestone: v2.4.0
status: done
depends_on: []
files_modified:
  - apps/api/drizzle/0018_professional_payable_identity.sql
  - apps/api/drizzle/meta/_journal.json
  - apps/api/drizzle/meta/0018_snapshot.json
  - apps/api/src/db/schema.ts
  - apps/api/src/domains/sales-ops/service.ts
  - apps/api/src/domains/sales-ops/__tests__/professional-payable-identity.test.ts
  - apps/api/src/domains/sales-ops/__tests__/service.test.ts
  - apps/api/src/domains/sales-ops/__tests__/sale-transitions.test.ts
  - apps/api/src/domains/sales-ops/__tests__/sale-transitions.integration.test.ts
  - apps/api/test/rls/proposal-write.test.ts
acceptance: "given two sale professionals with the same display name, when one paid payable survives a won to open to won cycle, then only its source professional is suppressed and the other payable is created exactly once with the correct total and tenant-safe professional identity."
---

# Professional Payable Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the originating sale-professional row on every newly materialized `professional_cost` payable so same-name professionals remain independently payable across a re-win.

**Architecture:** Migration `0018` adds a nullable identity column with an organization-and-sale-safe composite foreign key and conservatively backfills only unique snapshot matches.
The materializer uses durable IDs for current rows and a consumable legacy multiset only for historical null-ID rows.
Both `createSale` and `transitionSale` pass database-owned professional row IDs into the same materialization boundary.

**Tech Stack:** TypeScript, Hono service layer, Drizzle ORM, PostgreSQL, postgres-js, Vitest, and journaled Drizzle migrations.

## Global Constraints

- Preserve the current payable timing, split arithmetic, statuses, amounts, and `receivable_id` behavior.
- Newly generated `professional_cost` payables must always have `sale_professional_id` set.
- `seller_commission`, `finder_commission`, `tax`, and `other_cost` payables must keep `sale_professional_id` null.
- Identity matching for non-void current rows is exactly `(sale_professional_id, receivable_id)` within the already tenant-and-sale-scoped input.
- Legacy null-ID matching is exactly a consumable multiset of `(beneficiary_name, receivable_id, amount_brl)`.
- One legacy row may suppress at most one candidate draft.
- The backfill must never guess among two or more matching sale-professional rows.
- Every service query and mutation remains filtered by `org_id` and the relevant `sale_id` or primary key.
- Do not add UI work, change `computeSaleFinancials`, change split rounding, make the new column non-null, or rewrite ambiguous history.
- Do not manually edit generated snapshot contents.
- Generate the migration artifacts with Drizzle, then rename only the generated SQL tag according to the repository convention.
- The Red oracle is locked after it demonstrates the real `transitionSale` and PostgreSQL failure.
- This slice is captured as one atomic commit only after a separate Verify agent returns PASS.

---

## File map

- `apps/api/src/db/schema.ts` owns the nullable column, lookup index, composite-FK target index, and composite foreign key.
- `apps/api/drizzle/0018_professional_payable_identity.sql` owns the expand-only DDL and conservative cross-tenant backfill.
- `apps/api/drizzle/meta/_journal.json` and `apps/api/drizzle/meta/0018_snapshot.json` are generated migration metadata.
- `apps/api/src/domains/sales-ops/service.ts` owns payable draft types, current-ID idempotency, legacy multiset consumption, and both materializer call sites.
- `apps/api/src/domains/sales-ops/__tests__/professional-payable-identity.test.ts` pins the journal, nullable column, indexes, composite FK, admin context, and conservative backfill SQL contract.
- `apps/api/src/domains/sales-ops/__tests__/sale-transitions.integration.test.ts` owns the real PostgreSQL re-win oracle, FK controls, and executable backfill behavior.
- `apps/api/test/rls/proposal-write.test.ts` proves that a sale created directly as won retains the inserted professional ID.
- `apps/api/src/domains/sales-ops/__tests__/sale-transitions.test.ts` pins current-ID matching and the null-ID legacy multiset.
- `apps/api/src/domains/sales-ops/__tests__/service.test.ts` updates the complete `PayableDraft` equality contract.

## Exact interfaces

Replace the affected service types with these shapes.

```ts
export type PayableDraft = {
  beneficiaryName: string;
  kind: PayableKind;
  dueDate: string;
  amountBrl: number;
  status: 'open';
  receivableId: string | null;
  saleProfessionalId: string | null;
};

export type ExistingPayableRef = {
  kind: PayableKind;
  receivableId: string | null;
  status: string;
  beneficiaryName: string;
  amountBrl: number;
  saleProfessionalId: string | null;
};

export type MaterializeWonPayablesInput = {
  sale: {
    sellerName: string;
    finderName: string | null;
    hasFinder: boolean;
    sellerCommissionPct: number;
    finderCommissionPct: number;
    taxPct: number;
    otherCostsBrl: number;
  };
  professionals: Array<{
    id: string;
    personName: string;
    costBrl: number;
    costSplitBp?: number[] | null;
  }>;
  receivables: Array<{
    id: string;
    dueDate: string;
    amountBrl: number;
    status: string;
    label?: string;
  }>;
  existingPayables?: ExistingPayableRef[];
  wonDate: string;
};
```

`PayableDraft.saleProfessionalId` is required so every branch must deliberately choose a durable professional ID or null.
`MaterializeWonPayablesInput.professionals[].id` is required because all production inputs originate from persisted `sales_ops_sale_professionals` rows.
`ExistingPayableRef.amountBrl` and `saleProfessionalId` are required because the legacy fallback cannot be correct if a call site forgets either field.

### Task 1: Lock the real PostgreSQL Red oracle

**Files:**

- Modify: `apps/api/src/domains/sales-ops/__tests__/sale-transitions.integration.test.ts`

**Interfaces:**

- Consumes: `seedSale(orgId, overrides)`, `seedReceivable(orgId, saleId, overrides)`, `seedProfessional(orgId, saleId, overrides)`, `transitionSale(db, orgId, saleId, to)`, and the existing admin Drizzle connection.
- Produces: the immutable regression test named `re-win creates exactly one missing payable for same-name professionals`.

- [ ] **Step 1: Add the end-user-aligned regression test without referring to the not-yet-created column**

Add this test inside `describe('transitionSale')`.

```ts
it('re-win creates exactly one missing payable for same-name professionals', async () => {
  const orgId = `org_st_same_name_${crypto.randomUUID()}`;
  seededOrgIds.push(orgId);

  const sale = await seedSale(orgId, {
    status: 'open',
    sellerCommissionPct: '0.00',
    finderCommissionPct: '0.00',
    taxPct: '0.00',
    otherCostsBrl: 0,
  });
  await seedReceivable(orgId, sale.id, { amountBrl: 200000 });
  await seedProfessional(orgId, sale.id, {
    personNameSnapshot: 'Profissional Homonimo',
    costBrl: 100000,
  });
  await seedProfessional(orgId, sale.id, {
    personNameSnapshot: 'Profissional Homonimo',
    costBrl: 100000,
  });

  const firstWin = await transitionSale(getDb(), orgId, sale.id, 'won');
  expect(firstWin.ok).toBe(true);

  const adminDb = getAdminDb();
  const firstRows = (
    await adminDb.select().from(salesOpsPayables).where(eq(salesOpsPayables.saleId, sale.id))
  ).filter((row) => row.kind === 'professional_cost');
  expect(firstRows).toHaveLength(2);
  const paid = must(firstRows[0]);
  await adminDb
    .update(salesOpsPayables)
    .set({ status: 'paid' })
    .where(eq(salesOpsPayables.id, paid.id));

  const reopened = await transitionSale(getDb(), orgId, sale.id, 'open');
  expect(reopened.ok).toBe(true);
  const secondWin = await transitionSale(getDb(), orgId, sale.id, 'won');
  expect(secondWin.ok).toBe(true);

  const allRows = (
    await adminDb.select().from(salesOpsPayables).where(eq(salesOpsPayables.saleId, sale.id))
  ).filter((row) => row.kind === 'professional_cost');
  const activeRows = allRows.filter((row) => row.status !== 'void');
  const newlyActiveRows = activeRows.filter((row) => row.id !== paid.id);

  expect(activeRows).toHaveLength(2);
  expect(activeRows.reduce((sum, row) => sum + row.amountBrl, 0)).toBe(200000);
  expect(newlyActiveRows).toHaveLength(1);
  expect(newlyActiveRows[0]?.status).toBe('open');
});
```

- [ ] **Step 2: Run only the locked oracle and observe Red through the real service and database path**

Run from the repository root.

```bash
VITEST_INTEGRATION=1 pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/__tests__/sale-transitions.integration.test.ts -t "re-win creates exactly one missing payable for same-name professionals"
```

Expected Red: both first-win rows share the same beneficiary snapshot and receivable, the paid survivor suppresses both second-win candidates, `activeRows` has length `1`, the active total is `100000`, and `newlyActiveRows` is empty.
The test must reach both real `transitionSale` calls against PostgreSQL before failing.
Do not weaken or edit this oracle after recording Red.

### Task 2: Pin the migration and materializer contracts while still Red

**Files:**

- Create: `apps/api/src/domains/sales-ops/__tests__/professional-payable-identity.test.ts`
- Modify: `apps/api/src/domains/sales-ops/__tests__/sale-transitions.test.ts`
- Modify: `apps/api/src/domains/sales-ops/__tests__/service.test.ts`

**Interfaces:**

- Consumes: the exact types in `Exact interfaces` and migration tag `0018_professional_payable_identity`.
- Produces: static migration contracts and pure materializer behavior for current IDs and legacy null IDs.

- [ ] **Step 1: Add the static migration contract file**

Read `drizzle/meta/_journal.json` with `readFileSync`, locate `tag === '0018_professional_payable_identity'`, and read the matching SQL file.
Create the suite `describe('professional payable identity migration 0018', ...)` with these three exact test names and executable assertions.

The test `registers migration 0018 after professional payment split` reads and parses `_journal.json`, finds both tags, and runs these assertions.

```ts
expect(previous).toBeDefined();
expect(current).toBeDefined();
expect(current!.idx).toBeGreaterThan(previous!.idx);
expect(current!.when).toBeGreaterThan(previous!.when);
expect(existsSync(sqlPath)).toBe(true);
expect(existsSync(snapshotPath)).toBe(true);
```

The test `adds a nullable indexed sale professional id with an org and sale scoped foreign key` reads the SQL text and runs these assertions.

```ts
expect(sql).toMatch(/ADD COLUMN "sale_professional_id" uuid/);
expect(sql).not.toMatch(/"sale_professional_id" uuid NOT NULL/);
expect(sql).toContain('sales_ops_payables_sale_professional_id_idx');
expect(sql).toContain('sales_ops_sale_professionals_org_sale_id_id_idx');
expect(sql).toContain(
  'FOREIGN KEY ("org_id","sale_id","sale_professional_id") REFERENCES "public"."sales_ops_sale_professionals"("org_id","sale_id","id")',
);
expect(sql).toMatch(/sales_ops_payables_org_sale_professional_fk[\s\S]*ON DELETE restrict/i);
expect(sql).not.toMatch(/FOREIGN KEY \("sale_professional_id"\)/);
```

The test `backfills only unambiguous professional cost snapshots behind admin context` reads the same SQL text and runs these assertions.

```ts
expect(sql).toContain("set_config('app.fxl_admin', 'true', true)");
expect(sql).toContain(`p."kind" = 'professional_cost'`);
expect(sql).toContain('sp."org_id" = p."org_id"');
expect(sql).toContain('sp."sale_id" = p."sale_id"');
expect(sql).toContain('sp."person_name_snapshot" = p."beneficiary_name"');
expect(sql).toContain('NOT EXISTS');
expect(sql).toContain('other."id" <> sp."id"');
expect(sql.match(/p\."sale_professional_id" IS NULL/g)?.length).toBeGreaterThanOrEqual(2);
```

The second test therefore pins a nullable `sale_professional_id uuid`, `sales_ops_payables_sale_professional_id_idx`, `sales_ops_sale_professionals_org_sale_id_id_idx`, and this exact three-column FK direction.

```sql
FOREIGN KEY ("org_id","sale_id","sale_professional_id")
REFERENCES "public"."sales_ops_sale_professionals"("org_id","sale_id","id")
```

It also asserts `ON DELETE restrict`, absence of a single-column FK, and absence of `sale_professional_id uuid NOT NULL`.
The third test asserts transaction-local admin context before the backfill, `kind = 'professional_cost'`, equality on organization, sale, and beneficiary snapshot, a uniqueness guard, and `sale_professional_id IS NULL` replay safety.

- [ ] **Step 2: Add current-ID and legacy multiset unit tests**

In `sale-transitions.test.ts`, replace the existing different-name beneficiary guard with the stronger test named `matches current professional payables by durable id instead of display name`.
Use two professionals with IDs `professional-a` and `professional-b`, the same `personName`, the same cost, and one receivable.
Pass one non-void existing payable for `professional-a` and assert that the only draft belongs to `professional-b`.

Add `it('consumes each null-id legacy payable at most once')` with two same-name, same-cost professional IDs and one non-void legacy row whose `saleProfessionalId` is null.
Assert exactly one draft remains, its amount is unchanged, and its `saleProfessionalId` belongs to one of the two current rows.
Add a positive control in the same test with a legacy row whose amount differs by one cent and assert it suppresses neither candidate.

- [ ] **Step 3: Update every direct materializer fixture to the new explicit contract**

Give every synthetic professional a stable string `id`.
Give every `ExistingPayableRef` both `amountBrl` and `saleProfessionalId`.
Add `saleProfessionalId: null` to every non-professional expected draft.
Add the matching professional ID to every `professional_cost` expected draft.
Apply these mechanical updates in both `sale-transitions.test.ts` and the full equality assertion in `service.test.ts`.

- [ ] **Step 4: Run the unit contracts and keep the failures**

```bash
pnpm run build:packages
pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/__tests__/professional-payable-identity.test.ts src/domains/sales-ops/__tests__/sale-transitions.test.ts src/domains/sales-ops/__tests__/service.test.ts
```

Expected Red: the migration file and journal entry are absent, and the new service fields and ID-aware behavior are absent.

### Task 3: Add migration `0018` and the tenant-safe schema relationship

**Files:**

- Modify: `apps/api/src/db/schema.ts`
- Create: `apps/api/drizzle/0018_professional_payable_identity.sql`
- Modify: `apps/api/drizzle/meta/_journal.json`
- Create: `apps/api/drizzle/meta/0018_snapshot.json`

**Interfaces:**

- Consumes: `salesOpsSaleProfessionals(orgId, saleId, id)` and `salesOpsPayables(orgId, saleId)`.
- Produces: nullable `salesOpsPayables.saleProfessionalId: string | null` with a same-org and same-sale FK.

- [ ] **Step 1: Add the schema fields and constraints**

Add this target index to `salesOpsSaleProfessionals`.

```ts
uniqueIndex('sales_ops_sale_professionals_org_sale_id_id_idx').on(t.orgId, t.saleId, t.id),
```

Add this nullable field after `receivableId` in `salesOpsPayables`.

```ts
saleProfessionalId: uuid('sale_professional_id'),
```

Add this source index and FK in the payable table callback.

```ts
index('sales_ops_payables_sale_professional_id_idx').on(t.saleProfessionalId),
foreignKey({
  columns: [t.orgId, t.saleId, t.saleProfessionalId],
  foreignColumns: [
    salesOpsSaleProfessionals.orgId,
    salesOpsSaleProfessionals.saleId,
    salesOpsSaleProfessionals.id,
  ],
  name: 'sales_ops_payables_org_sale_professional_fk',
}).onDelete('restrict'),
```

The three-column relationship prevents both a cross-organization link and a same-organization link to a professional from another sale.
The nullable final column uses PostgreSQL `MATCH SIMPLE`, so commission, tax, and other-cost rows skip the lookup.

- [ ] **Step 2: Generate the migration artifacts**

```bash
pnpm --filter @fxl-sales/api db:generate -- --name professional_payable_identity
```

Confirm the generator produced index `0018`, journal `idx: 18`, and `meta/0018_snapshot.json`.
If Drizzle chooses a different SQL basename, rename only the generated SQL file to `0018_professional_payable_identity.sql` and change the new journal tag to match the filename.
Do not hand-edit `0018_snapshot.json`.

- [ ] **Step 3: Append the conservative backfill to the generated SQL**

Keep the generated DDL first.
Append statement breakpoints and this backfill after a transaction-local admin context statement.

```sql
SELECT set_config('app.fxl_admin', 'true', true);--> statement-breakpoint
WITH "unambiguous_professional_matches" AS (
  SELECT
    p."id" AS "payable_id",
    sp."id" AS "sale_professional_id"
  FROM "sales_ops_payables" p
  INNER JOIN "sales_ops_sale_professionals" sp
    ON sp."org_id" = p."org_id"
   AND sp."sale_id" = p."sale_id"
   AND sp."person_name_snapshot" = p."beneficiary_name"
  WHERE p."kind" = 'professional_cost'
    AND p."sale_professional_id" IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "sales_ops_sale_professionals" other
      WHERE other."org_id" = sp."org_id"
        AND other."sale_id" = sp."sale_id"
        AND other."person_name_snapshot" = sp."person_name_snapshot"
        AND other."id" <> sp."id"
    )
)
UPDATE "sales_ops_payables" p
SET "sale_professional_id" = match."sale_professional_id"
FROM "unambiguous_professional_matches" match
WHERE p."id" = match."payable_id"
  AND p."sale_professional_id" IS NULL;
```

Add a migration header explaining that ambiguous snapshot matches remain null, null-ID rows are supported by the runtime multiset, and both existing tables retain their current RLS policies.
Do not add new RLS policies, a default, a `NOT NULL`, a guessed match, or a destructive statement.

- [ ] **Step 4: Run the static migration contract**

```bash
pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/__tests__/professional-payable-identity.test.ts
```

Expected: PASS.

### Task 4: Implement durable identity and the legacy multiset

**Files:**

- Modify: `apps/api/src/domains/sales-ops/service.ts`

**Interfaces:**

- Consumes: the exact materializer input types above and persisted Drizzle rows.
- Produces: explicit payable identity on every draft and idempotent re-win behavior.

- [ ] **Step 1: Add explicit null identity to non-professional drafts**

Add `saleProfessionalId: null` to the seller, finder, tax, and other-cost draft literals.
Do not change their existing `alreadyExists(kind, receivableId)` behavior.

- [ ] **Step 2: Build the current-ID guard and legacy multiset once per materialization**

Keep generic idempotency for non-professional kinds.
Add an identified-professional predicate that matches a non-void `professional_cost` only when both `saleProfessionalId === professional.id` and `receivableId === part.receivableId`.
Build the legacy multiset from non-void `professional_cost` rows whose `saleProfessionalId === null`.

Use this collision-safe key helper.

```ts
const legacyProfessionalKey = (input: {
  beneficiaryName: string;
  receivableId: string | null;
  amountBrl: number;
}): string => JSON.stringify([input.beneficiaryName, input.receivableId, input.amountBrl]);
```

Use this consumption behavior.

```ts
const legacyProfessionalCounts = new Map<string, number>();
for (const payable of existingPayables) {
  if (
    payable.kind !== 'professional_cost' ||
    payable.status === 'void' ||
    payable.saleProfessionalId !== null
  ) {
    continue;
  }
  const key = legacyProfessionalKey(payable);
  legacyProfessionalCounts.set(key, (legacyProfessionalCounts.get(key) ?? 0) + 1);
}

const consumeLegacyProfessional = (candidate: {
  beneficiaryName: string;
  receivableId: string | null;
  amountBrl: number;
}): boolean => {
  const key = legacyProfessionalKey(candidate);
  const remaining = legacyProfessionalCounts.get(key) ?? 0;
  if (remaining === 0) return false;
  if (remaining === 1) legacyProfessionalCounts.delete(key);
  else legacyProfessionalCounts.set(key, remaining - 1);
  return true;
};
```

For each professional split part, first skip an identified current match, then consume one matching legacy row, then emit a draft with `saleProfessionalId: professional.id`.
This order is load-bearing because an identified match must not consume a legacy count needed by another current professional.

- [ ] **Step 3: Retain inserted professional rows in `createSale`**

Replace the fire-and-forget professional insert with a typed `insertedProfessionalRows` array and `.returning()`.
Map those returned rows into the materializer with `id`, authoritative `personNameSnapshot`, `costBrl`, and the existing single-boundary `costSplitBp as number[] | null` cast.
Do not map `input.professionals` into the materializer after this change.
The returned database row is the authoritative source for both identity and snapshots.

- [ ] **Step 4: Pass persisted IDs and complete existing references in `transitionSale`**

Map `professionalRows` with `id: p.id`.
Map `existingPayableRows` with `amountBrl: p.amountBrl` and `saleProfessionalId: p.saleProfessionalId` in addition to the existing fields.
The existing `orgId` plus `saleId` predicates on all three transition queries remain mandatory and unchanged.

- [ ] **Step 5: Insert drafts without a second mapping rule**

Keep spreading each draft into both payable insert sites so `saleProfessionalId` is persisted automatically.
Do not derive the ID from array position, `personId`, `personName`, role, amount, or receivable order.

- [ ] **Step 6: Run unit Green**

```bash
pnpm run build:packages
pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/__tests__/professional-payable-identity.test.ts src/domains/sales-ops/__tests__/sale-transitions.test.ts src/domains/sales-ops/__tests__/service.test.ts
```

Expected: PASS.

### Task 5: Prove create flow, backfill, and foreign-key behavior in PostgreSQL

**Files:**

- Modify: `apps/api/src/domains/sales-ops/__tests__/sale-transitions.integration.test.ts`
- Modify: `apps/api/test/rls/proposal-write.test.ts`

**Interfaces:**

- Consumes: the migrated test database, admin connection for verification, and tenant-scoped service calls for behavior.
- Produces: executable proof of transition behavior, create behavior, backfill ambiguity, and FK isolation.

- [ ] **Step 1: Strengthen the existing won-transition integration test**

In `win materializes payables linked to each receivable row`, retain the inserted professional returned by `seedProfessional`.
Assert every resulting `professional_cost` payable has `saleProfessionalId === professional.id`.
Assert every non-professional payable has `saleProfessionalId === null`.

- [ ] **Step 2: Strengthen direct-won creation coverage**

In `create with status won materializes per-receivable payables immediately`, select the inserted sale-professional row and include `sale_professional_id` in the payable query.
Assert the `professional_cost` row points to that inserted row.
Assert seller commission, tax, and other cost keep the field null.

- [ ] **Step 3: Add executable backfill coverage**

Add the exact test name `migration backfill links only one org-sale-snapshot match and leaves ambiguous rows null` to `sale-transitions.integration.test.ts`.
Seed one sale with one uniquely named professional and one legacy null-ID payable.
Seed a second sale with two same-name professionals and one legacy null-ID payable.
Seed the same unique name in another organization as a cross-tenant negative control.
Read `0018_professional_payable_identity.sql`, split on `--> statement-breakpoint`, and replay only the `WITH "unambiguous_professional_matches"` update through the admin connection.
Assert the unique row gets its same-org and same-sale ID, the ambiguous row remains null, and replaying the update produces the same result.

- [ ] **Step 4: Add raw FK controls**

Add the exact test name `payable professional identity rejects another organization and another sale`.
Use the admin connection so RLS cannot create a false positive.
Assert PostgreSQL error `23503` when an org-A payable on sale A points to a professional from org B.
Assert the same error when it points to a different sale's professional inside org A.
Insert a positive-control payable using the matching `(orgId, saleId, professionalId)` tuple and assert it succeeds.

- [ ] **Step 5: Run targeted PostgreSQL Green**

```bash
VITEST_INTEGRATION=1 pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/__tests__/sale-transitions.integration.test.ts test/rls/proposal-write.test.ts
```

Expected: PASS, including the locked oracle.

### Task 6: Refactor only while Green

**Files:**

- Modify only files already listed in this plan.

**Interfaces:**

- Consumes: all passing unit and integration contracts.
- Produces: the smallest readable implementation with no behavior beyond this slice.

- [ ] **Step 1: Remove duplication only if the tests stay green**

Small private helpers for current-ID lookup and legacy-count consumption are allowed.
Do not export the key helper or introduce a new module.
Do not redesign `materializeWonPayables`, split `service.ts`, add database uniqueness constraints for payable idempotency, or change transaction boundaries.

- [ ] **Step 2: Re-run the targeted suites after any refactor**

```bash
pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/__tests__/professional-payable-identity.test.ts src/domains/sales-ops/__tests__/sale-transitions.test.ts src/domains/sales-ops/__tests__/service.test.ts
VITEST_INTEGRATION=1 pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/__tests__/sale-transitions.integration.test.ts test/rls/proposal-write.test.ts
```

Expected: PASS.

## Verification contract

A different Verify agent must run these commands locally from the repository root.

```bash
pnpm run build:packages
pnpm --filter @fxl-sales/api test
pnpm --filter @fxl-sales/api test:integration
pnpm --filter @fxl-sales/api lint
pnpm --filter @fxl-sales/api type-check
pnpm test
pnpm lint
pnpm type-check
pnpm build
pnpm audit --prod --audit-level high
git diff --check
```

The verifier must inspect the generated `0018_snapshot.json`, the journal ordering, the migration SQL, the composite FK direction, and the absence of destructive DDL.
The known full development dependency audit blocker belongs to slice `03-dependency-audit-remediation`, but production audit findings or new findings introduced by this slice are failures here.
No test, build, or server command may remain running after verification.

## Atomic capture guidance

After separate-agent Verify returns PASS, stage exactly the files in `files_modified` and inspect `git diff --cached --check` plus `git diff --cached --stat`.
Capture the slice as one atomic Conventional Commit.

```bash
git commit -m "fix(sales-ops): persist professional payable identity"
```

Do not split schema, migration, runtime, and tests into independently shippable commits because none is safe without the others.
Do not tag, promote staging, or close milestone `v2.4.0` in this slice.
