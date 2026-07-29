---
id: 04-proposal-transition-backend
milestone: v2.3.0
status: done
depends_on: [03-proposal-write-backend]
files_modified: [apps/api/src/domains/sales-ops/service.ts, apps/api/src/domains/sales-ops/routes.ts, apps/api/src/domains/sales-ops/__tests__/sale-transitions.test.ts, apps/api/src/domains/sales-ops/__tests__/transition-routes.test.ts, apps/api/src/domains/sales-ops/__tests__/sale-transitions.integration.test.ts]
acceptance: "Given a proposta with open receivables, when it transitions draft->open->won->open via POST /sales/:id/transition, then win inserts per-receivable seller/finder/tax payables linked by receivable_id plus one-shot professional/other payables and sets won_at, revert voids only the still-open payables and clears won_at while paid rows survive, a cross-tenant sale id returns 404, and any pair outside the documented matrix returns 409."
---

# Slice 04: proposal transition backend

## Scope

API-only lifecycle transitions for propostas: `POST /api/v1/sales-ops/sales/:id/transition` and `POST /api/v1/sales-ops/sales/:id/cancel-contract`.
This slice assumes slice 02 already added `salesOpsSales.wonAt` / `salesOpsSales.lostAt` (nullable timestamptz), `salesOpsPayables.receivableId` (nullable uuid referencing `sales_ops_receivables.id`), and `salesOpsReceivables.method`, and that slice 03 already creates receivable rows as the payment plan.
Plan-check update (2026-07-29): slice 03 is now written and owns the single canonical materialization function, `materializeWonPayables`, exported from `apps/api/src/domains/sales-ops/service.ts` (see slice 03 section 6). This slice imports and calls it; it MUST NOT declare its own `PayableKind`, its own draft type, or a second materialization function - slice 03 already added the `existingPayables` re-win idempotency parameter (rule 5) specifically so this slice does not need a parallel implementation. A duplicate `export type PayableKind` in the same file would be a TypeScript compile error, not merely a duplication smell.
No web changes, no schema changes, no new tables.

## Transition matrix (single source of truth)

`draft` is never a transition target; it exists only at creation time.
Same-status requests are invalid (409).
Unknown or legacy statuses (anything outside the five canonical values) allow no transitions and always 409.

| from \ to | open | won | lost | cancelled |
|---|---|---|---|---|
| draft | ALLOW | ALLOW | 409 | ALLOW |
| open | 409 | ALLOW | ALLOW | ALLOW |
| won | ALLOW (revert) | 409 | 409 | 409 |
| lost | ALLOW (reopen) | 409 | 409 | ALLOW |
| cancelled | ALLOW (reopen) | 409 | 409 | 409 |

Consequence: a won proposta can only be reverted to open; marking it lost or cancelled requires reverting first.
This matches the overview rule "leaving won voids open payables" because the only exit from won is the revert branch, which performs the void.

### Side effects per transition

| transition | sale patch | ledger side effect |
|---|---|---|
| any -> open | `status='open', wonAt=null, lostAt=null, updatedAt=now` | if from was `won`: void all payables of the sale with `status='open'` (paid rows untouched) |
| draft/open -> won | `status='won', wonAt=now, lostAt=null, updatedAt=now` | insert payables built by `materializeWonPayables` (slice 03, imported - see below) |
| open -> lost | `status='lost', lostAt=now, updatedAt=now` | none |
| draft/open/lost -> cancelled | `status='cancelled', updatedAt=now` | none (timestamps untouched; a cancelled-from-lost sale keeps its `lostAt` as history) |

## Service layer (apps/api/src/domains/sales-ops/service.ts)

All new code lives in service.ts next to the existing sale functions and reuses the existing `withTenant`, `pctOf`, `dateFromIsoDay`, and `isoDate` helpers.
Add `gt` and `inArray` to the existing `drizzle-orm` import.

### Pure matrix

```ts
export type SaleStatus = 'draft' | 'open' | 'won' | 'lost' | 'cancelled';
export type TransitionTarget = 'open' | 'won' | 'lost' | 'cancelled';

export const SALE_TRANSITIONS: Record<SaleStatus, readonly TransitionTarget[]> = {
  draft: ['open', 'won', 'cancelled'],
  open: ['won', 'lost', 'cancelled'],
  won: ['open'],
  lost: ['open', 'cancelled'],
  cancelled: ['open'],
};

export function canTransition(from: string, to: TransitionTarget): boolean {
  const allowed = SALE_TRANSITIONS[from as SaleStatus];
  return allowed !== undefined && allowed.includes(to);
}
```

### Shared materialization function (owned by slice 03 - import only, do not redefine)

`materializeWonPayables(input: MaterializeWonPayablesInput): PayableDraft[]` and its `PayableKind`/`PayableDraft`/`ExistingPayableRef` types are defined and exported once, by slice 03, in this same `service.ts` file (slice 03 section 6). Its rules already cover everything this slice needs:

1. Considers only receivable rows whose `status !== 'void'` (both `open` and `paid` rows earn commission, which is what makes a re-win after a revert regenerate commission for an already-paid receivable).
2. Per considered row, in order: `seller_commission`, `finder_commission` (only when `sale.hasFinder`), `tax`, each linked via `receivableId`/`dueDate`, skipping zero-amount entries.
3. One one-shot `professional_cost` per professional with `costBrl > 0`.
4. One one-shot `other_cost` when `sale.otherCostsBrl > 0`.
5. Drops any of the above for which `existingPayables` already contains a same-`kind`, same-`receivableId` (`null` matches `null`) entry whose `status !== 'void'` - this is the re-win idempotency guard this slice relies on: after a won -> open revert, `open` payables were voided (so they do not block re-creation), but a payable the org already marked `paid` survives the revert and must not be duplicated when the sale is won again.

Per-row commission uses the existing floor-based `pctOf`, so the sum across rows may be up to `rows - 1` cents lower than a whole-total computation; this is accepted and documented behavior.

Call-site field mapping this slice must perform (the shared function takes `hasFinder: boolean` and ISO-day `string` dates, not the raw DB row shapes):

```ts
const receivableRows = await tx.select().from(salesOpsReceivables)
  .where(and(eq(salesOpsReceivables.orgId, orgId), eq(salesOpsReceivables.saleId, saleId)))
  .orderBy(salesOpsReceivables.dueDate);
const professionalRows = await tx.select().from(salesOpsSaleProfessionals)
  .where(and(eq(salesOpsSaleProfessionals.orgId, orgId), eq(salesOpsSaleProfessionals.saleId, saleId)));
const existingPayableRows = await tx.select().from(salesOpsPayables)
  .where(and(eq(salesOpsPayables.orgId, orgId), eq(salesOpsPayables.saleId, saleId)));

const drafts = materializeWonPayables({
  sale: {
    sellerName: sale.sellerNameSnapshot,
    finderName: sale.finderNameSnapshot,
    hasFinder: sale.finderPersonId !== null,
    sellerCommissionPct: Number(sale.sellerCommissionPct),
    finderCommissionPct: Number(sale.finderCommissionPct),
    taxPct: Number(sale.taxPct),
    otherCostsBrl: sale.otherCostsBrl,
  },
  professionals: professionalRows.map((p) => ({ personName: p.personNameSnapshot, costBrl: p.costBrl })),
  receivables: receivableRows.map((r) => ({ id: r.id, dueDate: asDateOnly(r.dueDate), amountBrl: r.amountBrl, status: r.status })),
  existingPayables: existingPayableRows.map((p) => ({ kind: p.kind as PayableKind, receivableId: p.receivableId, status: p.status })),
  wonDate: asDateOnly(now),
});
```

`asDateOnly` and `dateFromIsoDay` are the existing module-local helpers already used elsewhere in `service.ts` (not exported, but available because this code lives in the same file); use `dateFromIsoDay(d.dueDate)` when converting each `PayableDraft` back to a `Date` for the `salesOpsPayables` insert.

### transitionSale

```ts
export type TransitionResult =
  | { ok: true; sale: typeof salesOpsSales.$inferSelect }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'invalid_transition'; from: string; to: TransitionTarget };

export async function transitionSale(
  db: Db,
  orgId: string,
  saleId: string,
  to: TransitionTarget,
): Promise<TransitionResult>;
```

Implementation, entirely inside one `withTenant(db, orgId, ...)` transaction:

1. Lock the sale row: `tx.select().from(salesOpsSales).where(and(eq(salesOpsSales.orgId, orgId), eq(salesOpsSales.id, saleId))).for('update').limit(1)`; if no row, return `{ ok: false, reason: 'not_found' }` (RLS plus the explicit orgId filter make cross-tenant ids indistinguishable from missing ids).
2. If `!canTransition(sale.status, to)`, return `{ ok: false, reason: 'invalid_transition', from: sale.status, to }`.
3. Compute `const now = new Date()` and branch:

`to === 'won'`:

```ts
// receivableRows / professionalRows / existingPayableRows / drafts: see the call-site
// mapping in the "Shared materialization function" section above.
if (drafts.length > 0) {
  await tx.insert(salesOpsPayables).values(
    drafts.map((d) => ({ ...d, dueDate: dateFromIsoDay(d.dueDate), orgId, saleId })),
  );
}
const patch = { status: 'won', wonAt: now, lostAt: null, updatedAt: now };
```

`to === 'open'`:

```ts
if (sale.status === 'won') {
  await tx.update(salesOpsPayables)
    .set({ status: 'void' })
    .where(and(
      eq(salesOpsPayables.orgId, orgId),
      eq(salesOpsPayables.saleId, saleId),
      eq(salesOpsPayables.status, 'open'),
    ));
}
const patch = { status: 'open', wonAt: null, lostAt: null, updatedAt: now };
```

`to === 'lost'`: `patch = { status: 'lost', lostAt: now, updatedAt: now }`.

`to === 'cancelled'`: `patch = { status: 'cancelled', updatedAt: now }`.

4. Apply and return:

```ts
const [updated] = await tx.update(salesOpsSales).set(patch)
  .where(and(eq(salesOpsSales.orgId, orgId), eq(salesOpsSales.id, saleId)))
  .returning();
return { ok: true, sale: updated! };
```

### cancelContract

```ts
export type CancelContractResult =
  | { ok: true; sale: typeof salesOpsSales.$inferSelect; voidedReceivables: number; voidedPayables: number }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'not_cancellable' };

export async function cancelContract(
  db: Db,
  orgId: string,
  saleId: string,
  effectiveDate?: string,
): Promise<CancelContractResult>;
```

Implementation, entirely inside one `withTenant(db, orgId, ...)` transaction:

1. Lock the sale row exactly as in transitionSale; missing row returns `{ ok: false, reason: 'not_found' }`.
2. If `sale.status !== 'won'`, return `{ ok: false, reason: 'not_cancellable' }`.
3. Resolve the cutoff: `const effective = effectiveDate ?? new Date().toISOString().slice(0, 10)` and `const cutoff = dateFromIsoDay(effective)`.
4. Find the affected plan rows:

```ts
const future = await tx.select({ id: salesOpsReceivables.id }).from(salesOpsReceivables)
  .where(and(
    eq(salesOpsReceivables.orgId, orgId),
    eq(salesOpsReceivables.saleId, saleId),
    eq(salesOpsReceivables.status, 'open'),
    gt(salesOpsReceivables.dueDate, cutoff),
  ));
const futureIds = future.map((r) => r.id);
```

The comparison is strictly greater than the cutoff: a parcela due on the effective date is still owed.
5. Eligibility gate: if `sale.recurringBrl <= 0 && futureIds.length === 0`, return `{ ok: false, reason: 'not_cancellable' }` (nothing recurring and nothing future to cancel).
6. Void the rows and their linked payables (skip both statements when `futureIds` is empty, which can only happen for an indefinite-recurring sale with no future parcelas; that call succeeds with zero counts):

```ts
const voidedReceivables = await tx.update(salesOpsReceivables)
  .set({ status: 'void' })
  .where(and(eq(salesOpsReceivables.orgId, orgId), inArray(salesOpsReceivables.id, futureIds)))
  .returning({ id: salesOpsReceivables.id });
const voidedPayables = await tx.update(salesOpsPayables)
  .set({ status: 'void' })
  .where(and(
    eq(salesOpsPayables.orgId, orgId),
    eq(salesOpsPayables.saleId, saleId),
    eq(salesOpsPayables.status, 'open'),
    inArray(salesOpsPayables.receivableId, futureIds),
  ))
  .returning({ id: salesOpsPayables.id });
```

7. Return `{ ok: true, sale, voidedReceivables: voidedReceivables.length, voidedPayables: voidedPayables.length }`.

The sale row is not modified in any way: status stays `won`, `wonAt` stays set, `updatedAt` is not bumped, and no other table is written (contract per overview: cancel-contract records nothing beyond the voids).
Paid receivables and paid payables are never touched because both updates filter on `status = 'open'` (receivables via the futureIds selection, payables via the explicit predicate).
One-shot payables (`receivableId` null) are never touched by cancel-contract because `inArray(receivableId, futureIds)` cannot match null.

### Request schemas (exported from service.ts beside the other schemas)

```ts
export const SaleTransitionSchema = z.object({
  status: z.enum(['open', 'won', 'lost', 'cancelled']),
});

export const CancelContractSchema = z.object({
  effectiveDate: isoDate.optional(),
});
```

`draft` is deliberately absent from `SaleTransitionSchema`, so "transition to draft" fails as a 400 validation error rather than a 409.

## Routes (apps/api/src/domains/sales-ops/routes.ts)

Add both handlers after the existing `POST /sales` block and extend the service import list with `SaleTransitionSchema`, `CancelContractSchema`, `transitionSale`, `cancelContract`.
Neither route uses `requireAdmin`, matching the posture of the existing `POST /sales` mutation; tightening sale mutations to admin is out of scope for this slice and web hides the actions outside admin workspaces.
Both routes validate the `:id` param with the service's uuid shape and answer 404 for a malformed id, so garbage ids never reach Postgres as an invalid uuid cast.

```ts
const saleIdParam = z.string().uuid();

salesOpsRouter.post('/sales/:id/transition', async (c) => {
  const id = saleIdParam.safeParse(c.req.param('id'));
  if (!id.success) return c.json({ error: 'not_found' }, 404);
  const parsed = SaleTransitionSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  const result = await transitionSale(getDb(), c.get('orgId'), id.data, parsed.data.status);
  if (!result.ok && result.reason === 'not_found') return c.json({ error: 'not_found' }, 404);
  if (!result.ok) {
    return c.json({ error: 'invalid_transition', from: result.from, to: result.to }, 409);
  }
  return c.json({ sale: result.sale });
});

salesOpsRouter.post('/sales/:id/cancel-contract', async (c) => {
  const id = saleIdParam.safeParse(c.req.param('id'));
  if (!id.success) return c.json({ error: 'not_found' }, 404);
  const parsed = CancelContractSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  const result = await cancelContract(getDb(), c.get('orgId'), id.data, parsed.data.effectiveDate);
  if (!result.ok && result.reason === 'not_found') return c.json({ error: 'not_found' }, 404);
  if (!result.ok) return c.json({ error: 'contract_not_cancellable' }, 409);
  return c.json({
    sale: result.sale,
    voidedReceivables: result.voidedReceivables,
    voidedPayables: result.voidedPayables,
  });
});
```

Status codes: 200 success envelope, 400 invalid body, 404 unknown or cross-tenant or malformed id, 409 invalid transition or non-cancellable contract.
`orgId` always comes from `c.get('orgId')`; nothing tenant-related is ever read from the body.

## Oracle tests

### Unit: apps/api/src/domains/sales-ops/__tests__/sale-transitions.test.ts

Pure functions only, no mocks, runs under `pnpm test`.

- `transition matrix: allows exactly the documented pairs`: iterate all 5 statuses x 4 targets, assert `canTransition` equals the matrix table above (7 allowed pairs, 13 rejected), and assert `canTransition('forecast', 'won')` and `canTransition('closed', 'open')` are false for legacy statuses.
- `materializeWonPayables: links per-receivable commission and tax payables via receivableId`: sale with seller 10 pct, finder 3 pct, tax 6 pct and two receivables of 500000 due on different ISO days yields six per-row drafts with `receivableId` set, amounts 50000/15000/30000 per row, and `dueDate` equal to each row's due date. This is the same function slice 03 unit-tests for its own create-time call site; this test exercises it standalone to pin the contract slice 04 depends on.
- `materializeWonPayables: emits one-shot professional and other cost drafts at the won date`: one professional at 40000 and `otherCostsBrl: 25000` add exactly two drafts with `receivableId: null` and `dueDate` equal to `wonDate`.
- `materializeWonPayables: skips finder commission when hasFinder is false and drops zero-amount drafts`: `hasFinder: false` plus `taxPct: 0` yields only seller drafts.
- `materializeWonPayables: never duplicates a surviving paid payable on re-win`: an `existingPayables` entry `{ kind: 'seller_commission', receivableId: r1, status: 'paid' }` suppresses that one draft while a `status: 'void'` entry for r2 suppresses nothing; a paid one-shot `{ kind: 'other_cost', receivableId: null, status: 'paid' }` suppresses the other-cost draft.
- `materializeWonPayables: ignores void receivable rows`: a receivable with `status: 'void'` produces no drafts.

### Route unit: apps/api/src/domains/sales-ops/__tests__/transition-routes.test.ts

Mock `transitionSale` and `cancelContract` following the exact `vi.hoisted` + `vi.mock('../service.js')` pattern of routes.test.ts.

- `POST /sales/:id/transition returns 200 {sale} and passes the verified org`: mock resolves `{ ok: true, sale }`; assert call args `(mockedDb, 'verified-org', saleId, 'won')` and the `{ sale }` envelope.
- `POST /sales/:id/transition returns 400 on a bad status`: body `{ status: 'draft' }` yields 400 `validation_error` and the service mock is never called.
- `POST /sales/:id/transition maps not_found to 404`: mock resolves `{ ok: false, reason: 'not_found' }`; assert 404 `{ error: 'not_found' }`.
- `POST /sales/:id/transition maps invalid_transition to 409`: mock resolves `{ ok: false, reason: 'invalid_transition', from: 'won', to: 'lost' }`; assert 409 body `{ error: 'invalid_transition', from: 'won', to: 'lost' }`.
- `POST /sales/:id/transition returns 404 for a malformed id without touching the service`.
- `POST /sales/:id/cancel-contract returns 200 with void counts`: mock resolves `{ ok: true, sale, voidedReceivables: 2, voidedPayables: 4 }`; assert envelope and that `effectiveDate` from the body is forwarded.
- `POST /sales/:id/cancel-contract maps not_found to 404 and not_cancellable to 409` with body `{ error: 'contract_not_cancellable' }`.

### Integration: apps/api/src/domains/sales-ops/__tests__/sale-transitions.integration.test.ts

Runs only under `pnpm --filter @fxl-sales/api test:integration` via the existing `src/**/*.integration.test.ts` include; DB seeded and cleaned with `getAdminDb()` exactly like finder-state-machine.integration.test.ts, service calls exercised with `getDb()` so RLS is live.
Each test uses a fresh random org id, a seed helper that inserts one sale plus its receivables/professionals rows directly via drizzle, and an afterEach that deletes payables, receivables, professionals, and sales for the seeded sale ids through the admin connection.

- `win materializes payables linked to each receivable row`: seed an open sale (seller 10, finder 3, tax 6, otherCosts 25000, one professional 40000) with two open receivables of 500000; call `transitionSale(getDb(), org, id, 'won')`; assert the sale row has `status='won'` and `wonAt` set, exactly 8 payables exist (3 kinds x 2 rows + 2 one-shots), each per-row payable carries the matching `receivableId` and the row's due date, and both one-shots have `receivableId` null.
- `reverting a won sale voids open payables, keeps paid ones, and clears won_at`: after winning, mark one payable `paid` via admin db; call `transitionSale(..., 'open')`; assert the paid payable still has `status='paid'`, every other payable is `void`, and the sale has `status='open'` with `wonAt` null.
- `cancel-contract voids future open receivables and their linked open payables only`: seed a won sale with `recurringBrl > 0` and three open receivables due 2026-08-01, 2026-09-01, 2026-10-01, win it, mark the 2026-09-01 seller payable `paid`; call `cancelContract(getDb(), org, id, '2026-08-15')`; assert the 2026-08-01 receivable and its payables stay untouched, the 2026-09-01 and 2026-10-01 receivables are `void`, their linked open payables are `void`, the paid payable stays `paid`, one-shot payables stay `open`, and the sale row still has `status='won'` and its original `updatedAt`.
- `cross-tenant sale id behaves as not_found`: seed a sale in org A; `transitionSale(getDb(), 'org_B...', saleId, 'open')` and `cancelContract(getDb(), 'org_B...', saleId)` both return `{ ok: false, reason: 'not_found' }` and org A's rows are unchanged.
- `invalid transitions are rejected`: a draft sale transitioned to `lost` and a lost sale transitioned to `won` both return `{ ok: false, reason: 'invalid_transition' }` with the correct from/to, and an open (non-won) sale gets `{ ok: false, reason: 'not_cancellable' }` from cancelContract.

## Verification commands

```bash
pnpm run lint
pnpm run type-check
pnpm test
pnpm --filter @fxl-sales/api test:integration
pnpm run build
```

## Out of scope

Web row actions, statusMeta, and dashboard sweeps (slice 07).
`summarizeSalesOpsState` closed-statuses rework and bootstrap payload changes (slices 03 and 07 per the overview).
Any change to `recurring_brl` on cancel-contract; the MRR metric intentionally keeps counting an actively cancelled contract until the dashboard slice revisits KPI semantics.
Admin-gating sale mutations; both new routes keep the existing POST /sales auth posture.
