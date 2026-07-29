---
id: 03-proposal-write-backend
milestone: v2.3.0
status: done
depends_on: [02-proposal-schema-backend]
files_modified:
  - apps/api/src/domains/sales-ops/service.ts
  - apps/api/src/domains/sales-ops/routes.ts
  - apps/api/src/domains/sales-ops/__tests__/service.test.ts
  - apps/api/src/domains/sales-ops/__tests__/routes.test.ts
  - apps/api/test/rls/proposal-write.test.ts
acceptance: "Given a v2 proposta payload whose installments sum to the items total, when the client POSTs /sales with status draft, open, or won and later PUTs /sales/:id, then receivable rows mirror the explicit plan plus bounded recurring cycles, payables are inserted only for won-at-create and are linked per receivable row, the PUT fully replaces children of a non-won proposta and returns 409 for a won one, and a sum mismatch or a free-form item without areaId returns 400."
---

# Slice 03: proposal write backend (v2 create + update, ledger rework, bootstrap receivables)

## 1. Scope and dependencies

This slice reworks the API write path for propostas in `apps/api/src/domains/sales-ops/service.ts` and `apps/api/src/domains/sales-ops/routes.ts`.
It is API only; the web wizard still sends the v1 payload until slice 06, so the wizard is knowingly broken at runtime between the 03 and 06 waves (test suites stay green because web tests do not hit the real API).

This slice assumes the following Drizzle schema state, delivered by slices 01 and 02 in `apps/api/src/db/schema.ts`:

- `salesOpsAreas` table with at least `id` (uuid), `orgId` (text), `name` (text), `status` (text `active|archived`) (slice 01).
- `salesOpsProducts.areaId` uuid nullable column (slice 01).
- `salesOpsSales.wonAt` and `salesOpsSales.lostAt` nullable timestamptz columns, and sale statuses remapped to `draft|open|won|lost|cancelled` (slice 02).
- `salesOpsSaleItems.areaId` uuid nullable and `salesOpsSaleItems.areaNameSnapshot` text not null default `''` (slice 02).
- `salesOpsReceivables.method` text column accepting `pix|card|boleto|transfer` (slice 02).
- `salesOpsPayables.receivableId` uuid nullable column referencing `sales_ops_receivables.id` (slice 02).

If slice 02 chose different Drizzle property names, the executor must align to slice 02's actual names, but the SQL column names above are fixed by the overview.

DELETE statements used by the update endpoint are covered by the existing `FOR ALL` RLS policies from migration 0007 and by the single-role owner contract (`apps/api/src/db/__tests__/single-role-db-contract.test.ts`), so no new grants are needed.

## 2. Zod schemas (verbatim)

Replace the current `SaleItemSchema` and `CreateSaleSchema` (service.ts lines 107 to 141) with the following, keeping the existing `uuid`, `money`, `pct`, `isoDate` helpers and `SaleProfessionalSchema` unchanged.

```ts
const MethodSchema = z.enum(['pix', 'card', 'boleto', 'transfer']);

export const SaleInstallmentSchema = z.object({
  dueDate: isoDate,
  amountBrl: money,
  method: MethodSchema,
});

export const SaleRecurringSchema = z.object({
  monthlyBrl: z.number().int().positive(),
  startDate: isoDate,
  cycles: z.number().int().min(1).max(120).nullable(),
  method: MethodSchema.default('pix'),
});

export const SaleItemSchema = z
  .object({
    productId: uuid.optional(),
    productName: z.string().trim().min(1).max(140),
    areaId: uuid.optional(),
    quantity: z.number().int().positive(),
    unitBrl: money,
  })
  .superRefine((item, ctx) => {
    if (!item.productId && !item.areaId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['areaId'],
        message: 'areaId is required when productId is absent',
      });
    }
  });

function validatePaymentPlan(
  data: {
    items: Array<{ quantity: number; unitBrl: number }>;
    installments: Array<{ amountBrl: number }>;
  },
  ctx: z.RefinementCtx,
) {
  const itemsTotalBrl = data.items.reduce((sum, item) => sum + item.quantity * item.unitBrl, 0);
  const planTotalBrl = data.installments.reduce((sum, row) => sum + row.amountBrl, 0);
  if (planTotalBrl !== itemsTotalBrl) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['installments'],
      message: `installments_sum_mismatch: expected ${itemsTotalBrl}, got ${planTotalBrl}`,
    });
  }
}

const SaleWriteBaseSchema = z.object({
  clientId: uuid.optional(),
  clientName: z.string().min(1),
  sellerPersonId: uuid.optional(),
  sellerName: z.string().min(1),
  finderPersonId: uuid.optional(),
  finderName: z.string().optional().nullable(),
  status: z.enum(['draft', 'open', 'won']),
  baseDate: isoDate,
  notes: z.string().optional().nullable(),
  sellerCommissionPct: pct.default(10),
  finderCommissionPct: pct.default(3),
  taxPct: pct.default(6),
  otherCostsBrl: money.default(0),
  items: z.array(SaleItemSchema).min(1),
  professionals: z.array(SaleProfessionalSchema).default([]),
  installments: z.array(SaleInstallmentSchema).min(1).max(120),
  recurring: SaleRecurringSchema.nullish(),
});

export const CreateSaleSchema = SaleWriteBaseSchema.superRefine(validatePaymentPlan);

export const UpdateSaleSchema = SaleWriteBaseSchema.extend({
  status: z.enum(['draft', 'open']),
}).superRefine(validatePaymentPlan);

export type CreateSaleInput = z.infer<typeof CreateSaleSchema>;
export type UpdateSaleInput = z.infer<typeof UpdateSaleSchema>;
```

Locked schema decisions:

- Statuses accepted at create are exactly `draft|open|won`; update accepts only `draft|open` because all other movements belong to slice 04's transition endpoint.
- The payload key `installments` is reused for the new array shape; the legacy scalar meaning moves to a derived DB column (section 5).
- `productType` disappears from the item payload; unknown keys are stripped by Zod, so a stale client field does not error.
- `SaleRecurringSchema.method` is a deliberate defaulted extension of the overview shape so recurring receivable rows have a deterministic method (`pix`) without hardcoding it in the ledger; slice 06 may expose it in the UI.
- `SaleInstallmentSchema.amountBrl` uses `money` (int >= 0) instead of positive on purpose: a zero-setup pure-recurring proposta (FXL Advisor with no entrada) satisfies the contractual `min(1)` with a single `{amountBrl: 0}` row, and zero-amount rows emit no receivable (section 4).
- `recurring.cycles = null` means indefinite; bounded contracts allow 1 to 120 cycles.
- The sum rule compares the installments sum against the items total only; bounded recurring value is additive on top and never part of the installments sum.

## 3. Area resolution (service-layer validation)

Add to service.ts:

```ts
export class SaleInputError extends Error {
  constructor(
    readonly code: 'product_not_found' | 'product_area_missing' | 'area_not_found',
    readonly itemIndex: number,
  ) {
    super(code);
    this.name = 'SaleInputError';
  }
}

export type ResolvedItemContext = {
  areaId: string;
  areaNameSnapshot: string;
  productTypeSnapshot: string;
};

async function resolveSaleItemContexts(
  tx: Db,
  orgId: string,
  items: CreateSaleInput['items'],
): Promise<ResolvedItemContext[]>
```

Behavior of `resolveSaleItemContexts` (runs inside the `withTenant` transaction, before `buildSaleLedger`):

1. Collect the distinct non-null `productId`s and load `{id, type, areaId}` from `salesOpsProducts` filtered by `eq(orgId)` and `inArray(id, ...)` (import `inArray` from drizzle-orm).
2. Collect the distinct area ids needed: each product's `areaId` plus each free-form item's payload `areaId`.
3. Load `{id, name}` from `salesOpsAreas` filtered by `eq(orgId)` and `inArray(id, ...)`; archived areas are accepted so that editing an old proposta keeps working after its area is archived.
4. Per item, in order:
   - Product item whose product row is missing: throw `SaleInputError('product_not_found', index)`.
   - Product item whose product has `areaId` null: throw `SaleInputError('product_area_missing', index)`.
   - Resolved area id (product's for product items, payload's for free-form items) with no matching area row in the org: throw `SaleInputError('area_not_found', index)`.
   - Otherwise emit `{areaId, areaNameSnapshot: area.name, productTypeSnapshot: product?.type ?? ''}`.

Locked decision: for product items the server-derived area is authoritative and any payload `areaId` on such items is ignored.
Locked decision: `productTypeSnapshot` (a NOT NULL legacy column) is written as the product's current `type` for product items and as the empty string for free-form items.

## 4. buildSaleLedger rework (pure)

New signature and output shape:

```ts
export type ReceivableDraft = {
  label: string;
  dueDate: string; // ISO day
  amountBrl: number;
  method: 'pix' | 'card' | 'boleto' | 'transfer';
  status: 'open';
};

export function buildSaleLedger(
  input: CreateSaleInput,
  itemContexts: ResolvedItemContext[],
): {
  sale: { /* all current sale fields, see rules below */ };
  items: Array<{
    productId: string | undefined;
    productNameSnapshot: string;
    productTypeSnapshot: string;
    areaId: string;
    areaNameSnapshot: string;
    quantity: number;
    unitBrl: number;
    subtotalBrl: number;
  }>;
  professionals: Array<{ personId: string | undefined; personNameSnapshot: string; role: string; costBrl: number }>;
  receivables: ReceivableDraft[];
};

export type SaleLedger = ReturnType<typeof buildSaleLedger>;
```

The function stays pure and throws a plain `Error('item_context_mismatch')` if `itemContexts.length !== input.items.length` (programmer error guard).
It no longer returns `payables`; payable math moves to `materializeWonPayables` (section 6).
Delete the now-unused `splitAmount` helper; keep `addMonths` and `pctOf` exactly as they are.

Exact computation rules:

1. `itemsTotalBrl = sum(item.quantity * item.unitBrl)`.
2. Installment receivable rows: filter `input.installments` to rows with `amountBrl > 0`, keep payload order (no date sorting), and label them `"${i + 1}/${keptCount}"` with each row's own `dueDate` and `method`.
3. Bounded recurring rows: when `input.recurring` is present and `cycles !== null`, append `cycles` rows with `label = "M${i + 1}/${cycles}"`, `dueDate = addMonths(recurring.startDate, i)` for `i` in `0..cycles-1`, `amountBrl = recurring.monthlyBrl`, `method = recurring.method`.
4. Indefinite recurring (`cycles === null`) appends no rows.
5. `boundedRecurringBrl = recurring && cycles !== null ? monthlyBrl * cycles : 0`.
6. `sale.totalBrl = itemsTotalBrl + boundedRecurringBrl` (so the receivable rows always sum to `totalBrl`).
7. `sale.recurringBrl = recurring ? recurring.monthlyBrl : 0` (MRR metric for both bounded and indefinite).
8. Per-row commission and tax aggregates over ALL receivable rows (installment plus bounded recurring), using floor per row so the sale columns equal what win-time materialization will actually pay:
   - `sellerCommissionBrl = sum(pctOf(row.amountBrl, input.sellerCommissionPct))`.
   - `finderCommissionBrl = input.finderPersonId ? sum(pctOf(row.amountBrl, input.finderCommissionPct)) : 0`.
   - `taxBrl = sum(pctOf(row.amountBrl, input.taxPct))`.
9. `professionalCostsBrl = sum(professional.costBrl)`.
10. `netMarginBrl = totalBrl - sellerCommissionBrl - finderCommissionBrl - professionalCostsBrl - input.otherCostsBrl - taxBrl`.
11. `netMarginPct = totalBrl > 0 ? ((netMarginBrl / totalBrl) * 100).toFixed(2) : '0.00'`.
12. `sale` carries the same snapshot fields as today (client, seller, finder, status, baseDate, notes, pcts as `.toFixed(2)` strings, brl aggregates) plus the derived legacy columns from section 5.
13. `items[i]` merges the payload item with `itemContexts[i]` (`areaId`, `areaNameSnapshot`, `productTypeSnapshot`) and `subtotalBrl = quantity * unitBrl`.

Note on indefinite recurring margins: months without materialized rows contribute nothing to commissions, tax, or margin; `recurringBrl` is the only signal, which matches the overview's MRR-metric decision.

## 5. Legacy column derivation (exact values written)

`buildSaleLedger` computes and includes in `sale`:

- `paymentMethod = input.installments[0].method` (the array has min length 1, so this always exists).
- `condition = input.recurring ? 'recurring' : input.installments.length === 1 ? 'cash' : 'installments'`.
- `installments = input.installments.length` (the raw payload array length, including any zero-amount row, so the column is stable and never 0).

These three legacy columns (`payment_method`, `condition`, `installments`) stop driving any ledger logic and exist only so old rows, existing queries, and the not-yet-migrated web read path keep working.

## 6. Win-time payable materialization helper (shared with slice 04 - single canonical function)

This is the coordination contract, locked by plan-check on 2026-07-29 after finding slice 04's independently-specified `buildWonPayables` used an incompatible signature: slice 03 defines and exports the ONE materialization function under the name `materializeWonPayables`; slice 04 imports and calls it verbatim for the transition endpoint and MUST NOT declare its own `PayableKind`, `PayableDraft`/`WonPayableSeed`, or a second materialization function in `service.ts` (a duplicate `export type PayableKind` in the same file is a TypeScript compile error, not just a style issue).

```ts
export type PayableKind =
  | 'seller_commission'
  | 'finder_commission'
  | 'professional_cost'
  | 'tax'
  | 'other_cost';

export type PayableDraft = {
  beneficiaryName: string;
  kind: PayableKind;
  dueDate: string; // ISO day
  amountBrl: number;
  status: 'open';
  receivableId: string | null;
};

export type ExistingPayableRef = {
  kind: PayableKind;
  receivableId: string | null;
  status: string;
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
  professionals: Array<{ personName: string; costBrl: number }>;
  receivables: Array<{ id: string; dueDate: string; amountBrl: number; status: string }>;
  existingPayables?: ExistingPayableRef[]; // omitted/[] at create; slice 04 passes the sale's current payables on (re-)win
  wonDate: string; // ISO day
};

export function materializeWonPayables(input: MaterializeWonPayablesInput): PayableDraft[];
```

Pure function, deterministic emission order, exact rules:

1. Iterate `receivables` in the given order and skip any row whose `status === 'void'` (both `open` and `paid` rows earn commission; this is what lets slice 04 re-materialize a payable for an already-paid receivable after a won -> open -> won round trip voided its prior commission payable). At create time every inserted row is `open`, so this rule behaves exactly like "only open rows" for this slice's own call site.
2. Per considered row, push in this order, each with `dueDate = row.dueDate` and `receivableId = row.id`, skipping any entry whose amount computes to 0:
   - `{kind: 'seller_commission', beneficiaryName: sale.sellerName, amountBrl: pctOf(row.amountBrl, sale.sellerCommissionPct)}`.
   - When `sale.hasFinder`: `{kind: 'finder_commission', beneficiaryName: sale.finderName ?? 'Finder', amountBrl: pctOf(row.amountBrl, sale.finderCommissionPct)}`.
   - `{kind: 'tax', beneficiaryName: 'Impostos', amountBrl: pctOf(row.amountBrl, sale.taxPct)}`.
3. After all rows, push one `{kind: 'professional_cost', beneficiaryName: professional.personName, amountBrl: professional.costBrl, dueDate: wonDate, receivableId: null}` per professional with `costBrl > 0`.
4. Finally, when `sale.otherCostsBrl > 0`, push `{kind: 'other_cost', beneficiaryName: 'Outros custos', amountBrl: sale.otherCostsBrl, dueDate: wonDate, receivableId: null}`.
5. Drop every draft from steps 2-4 for which `existingPayables` (defaulting to `[]`) already contains an entry with the same `kind`, the same `receivableId` (`null` matches `null`), and `status !== 'void'`. This slice's own call site never passes `existingPayables`, so rule 5 is inert here by construction (nothing to dedupe against a brand-new sale) and exists purely so slice 04 can reuse this same function for its re-win idempotency requirement without a second implementation.

Callers map `hasFinder` from `finderPersonId != null` and pct fields from the sale's numeric-string columns via `Number(...)` (slice 04) or from the parsed input (this slice, section 7).

## 7. Service functions

### createSale

```ts
export async function createSale(
  db: Db,
  orgId: string,
  input: CreateSaleInput,
  now: Date = new Date(),
): Promise<{ sale: typeof salesOpsSales.$inferSelect; ledger: SaleLedger; payables: PayableDraft[] }>
```

Steps, all inside the existing `withTenant` transaction:

1. `const itemContexts = await resolveSaleItemContexts(tx, orgId, input.items)` (throws `SaleInputError`).
2. `const ledger = buildSaleLedger(input, itemContexts)` (move this call inside the transaction since it now needs `itemContexts`).
3. Keep the current sequence and code logic verbatim (max sequence + 1, code suffix from the first item's product, `NNNN-S` format).
4. Insert the sale exactly as today, adding `wonAt: input.status === 'won' ? now : null` (and never touching `lostAt`).
5. Insert items including the new `areaId` and `areaNameSnapshot` fields; insert professionals unchanged.
6. Insert receivables only when `ledger.receivables.length > 0` (a zero-setup indefinite recurring proposta legitimately has none), converting `dueDate` with the existing `dateFromIsoDay`, and capture the inserted rows with `.returning({ id, dueDate, amountBrl, status })`.
7. When `input.status === 'won'`, compute `payables = materializeWonPayables({ sale: { sellerName: input.sellerName, finderName: input.finderName ?? null, hasFinder: input.finderPersonId != null, sellerCommissionPct: input.sellerCommissionPct, finderCommissionPct: input.finderCommissionPct, taxPct: input.taxPct, otherCostsBrl: input.otherCostsBrl }, professionals: input.professionals.map((p) => ({ personName: p.personName, costBrl: p.costBrl })), receivables: insertedReceivables.map(r => ({...r, dueDate: asDateOnly(r.dueDate)})), wonDate: asDateOnly(now) })` (`existingPayables` is omitted, defaulting to `[]`, which is correct because a freshly created sale owns no prior payables) and insert them (with `receivableId`) when non-empty; otherwise `payables = []`.
8. Return `{ sale, ledger, payables }`.

### updateSale (new)

```ts
export type UpdateSaleResult =
  | { ok: true; sale: typeof salesOpsSales.$inferSelect; ledger: SaleLedger }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'not_editable'; status: string };

export async function updateSale(
  db: Db,
  orgId: string,
  saleId: string,
  input: UpdateSaleInput,
): Promise<UpdateSaleResult>
```

Steps, in one `withTenant` transaction so the replacement is atomic:

1. Select the sale by `and(eq(orgId), eq(id, saleId))`; missing row returns `{ok: false, reason: 'not_found'}`.
2. When `sale.status` is `won`, `lost`, or `cancelled`, return `{ok: false, reason: 'not_editable', status: sale.status}` without writing anything.
3. Resolve item contexts and build the ledger exactly like create.
4. Delete children in FK-safe order, each with `and(eq(orgId), eq(saleId))` filters: `salesOpsPayables` first (defensive invariant enforcement: a non-won proposta must own no payables, including stale v1 rows from before the migration), then `salesOpsReceivables`, then `salesOpsSaleProfessionals`, then `salesOpsSaleItems`.
5. Update the sale row with all `ledger.sale` fields plus `updatedAt: new Date()`, keeping `sequence`, `code`, `createdAt`, `wonAt`, and `lostAt` untouched (locked decision: the code never changes on update, even if the first item's product changed).
6. Re-insert items, professionals, and receivables exactly like create; never insert payables here (update status is capped at `draft|open`).
7. Return `{ok: true, sale, ledger}`.

### Snapshot and summary

In `getSalesOpsSnapshot`, add a `receivables` query (`select().from(salesOpsReceivables).where(eq(orgId))`) and include `receivables` in the returned object so the bootstrap payload gains it.
Also add a `saleProfessionals` query (`select().from(salesOpsSaleProfessionals).where(eq(salesOpsSaleProfessionals.orgId, orgId))`) and include `saleProfessionals` in the returned object, same bare-select pattern.
This is a plan-check addition (2026-07-29): slice 06's wizard edit mode needs to reconstruct a proposta's professionals from the bootstrap to resubmit them on `PUT /sales/:id`, and putting the query here keeps every `getSalesOpsSnapshot` edit inside this slice's own wave instead of a later wave touching the same function and creating a same-wave file conflict with slice 04.
Extend the `SalesOpsSnapshot` type with `receivables?: unknown[]` and `saleProfessionals?: unknown[]`.
In `summarizeSalesOpsState`, change `closedStatuses` to `new Set(['won'])` (this file's copy only; the web copies belong to slice 07).

## 8. Routes

In `apps/api/src/domains/sales-ops/routes.ts`:

Rework `POST /sales` to catch the new service error:

```ts
salesOpsRouter.post('/sales', async (c) => {
  const parsed = CreateSaleSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  try {
    const result = await createSale(getDb(), c.get('orgId'), parsed.data);
    return c.json(result, 201);
  } catch (error) {
    if (error instanceof SaleInputError) {
      return c.json(
        { error: 'validation_error', reason: error.code, itemIndex: error.itemIndex },
        400,
      );
    }
    throw error;
  }
});
```

Add the update endpoint; the chosen verb is `PUT /sales/:id` because the semantics are a full document replacement, and this choice is the documented contract for slices 06 and 07:

```ts
salesOpsRouter.put('/sales/:id', async (c) => {
  const saleId = c.req.param('id');
  if (!uuid.safeParse(saleId).success) return c.json({ error: 'not_found' }, 404);
  const parsed = UpdateSaleSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  try {
    const result = await updateSale(getDb(), c.get('orgId'), saleId, parsed.data);
    if (!result.ok && result.reason === 'not_found') return c.json({ error: 'not_found' }, 404);
    if (!result.ok) return c.json({ error: 'sale_not_editable', status: result.status }, 409);
    return c.json({ sale: result.sale, ledger: result.ledger });
  } catch (error) {
    if (error instanceof SaleInputError) {
      return c.json(
        { error: 'validation_error', reason: error.code, itemIndex: error.itemIndex },
        400,
      );
    }
    throw error;
  }
});
```

Neither sales route gains `requireAdmin`; this matches the existing `POST /sales` gating and role hardening stays out of scope.
Error response contract summary: 400 `{error: 'validation_error', ...}` for Zod failures (including `installments_sum_mismatch` and missing free-form `areaId`) and for `SaleInputError` (with `reason` and `itemIndex`); 404 `{error: 'not_found'}`; 409 `{error: 'sale_not_editable', status}`.

## 9. Tests (named oracles)

### Unit: apps/api/src/domains/sales-ops/__tests__/service.test.ts (rewrite the ledger block for v2)

All existing tests are updated to v2 payloads, never deleted.
A reusable `basePayload` fixture carries the v2 shape (installments array, no `paymentMethod`/`condition` scalars, no `productType`), and ledger tests pass explicit `itemContexts`.

1. `'preserves ordered custom labels as snapshots while retaining the shared product id'`: same assertion as today plus `areaId`/`areaNameSnapshot`/`productTypeSnapshot` coming from the passed contexts.
2. `'rejects blank and overlong sale item names at the API boundary'`: unchanged intent, v2 payload.
3. Oracle `'builds the 20k PIX plus 3x boleto plan with per-row floored commissions'`: one item `unitBrl: 2999999`; installments `[{'2026-07-29', 2000000, 'pix'}, {'2026-08-29', 333333, 'boleto'}, {'2026-09-29', 333333, 'boleto'}, {'2026-10-29', 333333, 'boleto'}]`; finder present; pcts 10/3/6; asserts 4 receivable rows labelled `1/4..4/4` with methods preserved, `totalBrl 2999999`, `sellerCommissionBrl 299999`, `finderCommissionBrl 89997`, `taxBrl 179997`, `netMarginBrl 2430006`, `netMarginPct '81.00'`, legacy columns `paymentMethod 'pix'`, `condition 'installments'`, `installments 4`.
4. `'rejects a payment plan that does not sum to the items total'`: `CreateSaleSchema.safeParse` fails when the installments sum is off by one cent.
5. `'requires areaId on free-form items'`: item without `productId` and without `areaId` fails parse; with `areaId` it passes.
6. `'materializes bounded recurring cycles as monthly receivable rows'`: item 500000, one installment 500000, recurring `{monthlyBrl: 1000000, startDate: '2026-09-01', cycles: 3, method: 'boleto'}`; asserts rows `1/1, M1/3 (2026-09-01), M2/3 (2026-10-01), M3/3 (2026-11-01)`, `totalBrl 3500000`, `recurringBrl 1000000`, `condition 'recurring'`.
7. `'keeps indefinite recurring off the receivable rows'`: same but `cycles: null`; asserts only the `1/1` row, `totalBrl 500000`, `recurringBrl 1000000`.
8. `'drops zero-amount installments so a zero-setup recurring proposta has no setup rows'`: single item `unitBrl 0`, single installment `amountBrl 0`, indefinite recurring; asserts zero receivable rows and `installments` legacy column 1.
9. `'materializeWonPayables links per-row payables and skips voided rows'`: feeds the 20k-case receivables with fake ids (one row pre-voided), professionals `[240000]`, `otherCostsBrl 60000`, `wonDate '2026-07-29'`; asserts per-row `seller_commission/finder_commission/tax` drafts carry the matching `receivableId` and row due date with floored amounts, the voided row emits nothing, and `professional_cost`/`other_cost` land once at `wonDate` with `receivableId null`.
10. `'summarizes won sales as closed revenue'`: `summarizeSalesOpsState` counts a `won` sale in `closedRevenueBrl`/`closedSalesCount` and excludes an `open` one; keep the existing empty-state test.

### Unit: apps/api/src/domains/sales-ops/__tests__/routes.test.ts (extend)

Add `createSale` and `updateSale` to the hoisted service mocks.

1. `'returns 400 and skips the service when installments do not sum to the items total'` (POST /sales).
2. `'returns 400 for a free-form item without areaId'` (POST /sales).
3. `'creates a v2 proposta and forwards the verified org'` (POST /sales, 201).
4. `'returns 409 when updating a won proposta'` (PUT /sales/:id with mock `{ok: false, reason: 'not_editable', status: 'won'}`).
5. `'returns 404 for an unknown or non-uuid sale id'` (PUT /sales/:id).

### Integration: apps/api/test/rls/proposal-write.test.ts (new file)

Follows the `conversion-ingest.test.ts` pattern: real service functions on `drizzle(postgres(TEST_DATABASE_URL), { schema })`, seeding and cleanup through the `app.fxl_admin` connection, unique `org_` ids per run, cleanup deleting payables, receivables, sale items, sale professionals, sales, products, and areas.
Seed per org: one `sales_ops_areas` row and one `sales_ops_products` row pointing at it.

1. Oracle `'create v2 persists the explicit plan without payables until won'`: `createSale` with status `open`, a product item plus a free-form item, two installments, bounded recurring; asserts receivable rows (count, methods, amounts, labels), item `area_id`/`area_name_snapshot`, legacy sale columns, `won_at` null, and zero payables.
2. `'create with status won materializes per-receivable payables immediately'`: asserts each `seller_commission`/`tax` payable joins back to its receivable via `receivable_id` with `pctOf` floored amounts, one-shot rows have `receivable_id` null, and `won_at` is set.
3. `'update fully replaces items, professionals, and receivables in one transaction'`: create as `draft`, then `updateSale` with different items and plan; asserts old child rows are gone, new rows match, and `code`/`sequence` are unchanged.
4. `'update is rejected for a won proposta'`: asserts `{ok: false, reason: 'not_editable', status: 'won'}` and that children were not touched.
5. `'update returns not_found across tenants'`: org B calling `updateSale` on org A's sale id gets `not_found` and org A's rows survive.
6. `'create rejects a product without an area'`: seed a second product with `area_id` null and assert `createSale` rejects with `SaleInputError` code `product_area_missing`.
7. `'bootstrap snapshot includes receivables'`: `getSalesOpsSnapshot` returns the receivable rows for the org, and (plan-check addition) also seed one `sales_ops_sale_professionals` row for the sale and assert `snapshot.saleProfessionals` contains it.

## 10. Execution order

1. Schemas plus `SaleInputError` and `resolveSaleItemContexts` in service.ts.
2. `buildSaleLedger` rework plus `materializeWonPayables`, deleting `splitAmount`.
3. `createSale` and `updateSale`, snapshot `receivables`, `closedStatuses` change.
4. Routes.
5. Unit tests, then integration tests.
6. `pnpm run lint`, `pnpm run type-check`, `pnpm test`, `pnpm run build`, `pnpm --filter @fxl-sales/api test:integration` (Docker Postgres up).

## 11. Out of scope (owned elsewhere)

- Transition and cancel-contract endpoints, voiding logic, and `lost_at`/`won_at` transitions after create: slice 04 (it imports `materializeWonPayables` and `PayableDraft` from this service).
- Any web change, including the wizard payload v2 and the `calculations.ts`/`statusMeta` status sweeps: slices 06 and 07.
- Migrations and schema.ts columns: slices 01 and 02.
