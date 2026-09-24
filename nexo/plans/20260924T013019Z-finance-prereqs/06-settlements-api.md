---
id: 06-settlements-api
milestone: v4.1.0
status: todo
depends_on: [04-update-sale-in-place]
files_modified: [apps/api/src/domains/sales-ops/settlements.ts, apps/api/src/domains/sales-ops/routes.ts, apps/api/src/domains/sales-ops/service.ts, apps/api/src/domains/sales-ops/__tests__/settlements.test.ts, apps/api/src/domains/sales-ops/__tests__/settlements.integration.test.ts, apps/api/src/domains/sales-ops/__tests__/sale-transitions.integration.test.ts, apps/api/src/domains/sales-ops/__tests__/transition-routes.test.ts, CLAUDE.md, nexo/knowledge/reference/propostas.md]
goal: "Settlement API (C6): admin-only baixa, estorno and history routes over the immutable ledger, reducer-backed paid cache with revision bumps, leave-won lock (C5) and cancel-contract lock (H5), bootstrap rows gain revision, updatedAt and paidOn."
acceptance: ["POST /api/v1/sales-ops/settlements on an open row of a won proposta answers 201, inserts one baixa whose amount is the whole open amount, sets the row status to paid, bumps revision by exactly 1 and returns paidOn", "A second baixa on the same row answers 409 already_paid and writes nothing", "paidOn after São Paulo today answers 422 paid_on_in_future; a non-day (2026-02-30, 26-09-2026) answers 422 invalid_paid_on", "An absent paidOn stores todayInSaoPaulo(now): with now = 2026-09-24T01:30:00Z the stored paid_on is 2026-09-23", "A baixa on a void row answers 409 row_void and on a row of a non-won proposta answers 409 sale_not_won", "POST /settlements/:id/reverse inserts one estorno pointing at the baixa, sets the row back to open and bumps revision; a second reverse answers 409 already_reversed; a UNIQUE violation on reverses_settlement_id also maps to 409 already_reversed", "After reverse then re-baixa the row is paid and bootstrap paidOn is the greatest active paid_on", "transitionSale from won with any active baixa answers 409 sale_has_active_settlements with rows [{kind,id,label}] and changes no row, no status and no revision; after the estorno it succeeds", "cancelContract answers the same 409 when any row it would void has an active baixa and voids nothing", "A baixa or reverse or history read across orgs answers 404 under RLS", "Every settlement route answers 403 {error:'forbidden',reason:'admin_role_required'} for seller, finder and a missing role, and writes nothing", "GET /sales/:id/settlements answers { settlements: SettlementEntry[] } (C6 as resolved: id, saleId, targetKind, receivableId, payableId, type, reversesSettlementId, reversedBySettlementId, paidOn, amountBrl, origin, actorName, recordedAt, reason) newest first, and never actorUserId", "The 409 rows of sale_has_active_settlements use the C5 labels of slice 04 (receivable = stored label, payable = beneficiary (parcela label)), and the settlement rules come only from slice 02 (validarNovaBaixa, validarEstorno, statusCacheDaLinha, eventoDeSettlement, reduzirLiquidacao)", "/bootstrap receivables and payables carry revision, updatedAt and paidOn computed by the shared reducer from one org-wide settlements query", "CLAUDE.md and nexo/knowledge/reference/propostas.md replace the 'leaving won voids only open' rule with the lock rule in the same change"]
---

# 06 - Settlements API

## Context

Verified in this worktree at the start of the feature (slices 01 to 04 land before this one; see Contract deviations for the names this plan assumes from them).

- `apps/api/src/domains/sales-ops/routes.ts:56` declares `salesOpsRouter`; the router is mounted under `/api/v1/sales-ops` behind `appAuthMiddleware`, which sets `userId`, `orgId`, `userRole`, `userRoles` and `hubAuth` (`apps/api/src/middleware/app-auth.ts:157-169`).
- `routes.ts:66-68` already has the actor snapshot helper the audit ledger uses: `cadastroActor(c)` returns `{ userId: c.get('userId'), displayName: getHubActorDisplayName(c.get('hubAuth')) }`, and `getHubActorDisplayName` (`app-auth.ts:39-45`) returns token `name`, then `email`, then `null`.
  The type is `CadastroActor` exported from `service.ts:42`.
  Settlements reuse exactly this helper and type; no second one.
- `apps/api/src/middleware/require-admin.ts` answers `403 { error: 'forbidden', reason: 'admin_role_required' }` for any `userRole !== 'admin'`.
- `service.ts:1316` `withTenant(db, orgId, fn)` opens one transaction and sets `app.current_org_id`; every tenant function uses it.
- `service.ts:2552` `transitionSale` locks the sale `FOR UPDATE`, then for `to === 'open'` from `won` voids `status = 'open'` payables only (`service.ts:2636-2647`); receivables are left untouched on revert.
  `SALE_TRANSITIONS.won` is `['open']` (`service.ts:2537`), so revert is the only way out of `won` today, but the guard is written for any target.
- `service.ts:2671` `cancelContract` locks the sale `FOR UPDATE`, selects `status = 'open'` receivables with `due_date > cutoff` and voids them plus their `status = 'open'` linked payables.
  Its cut-off default is `new Date().toISOString().slice(0, 10)` (slice 01 moves it to `todayInSaoPaulo()`; do not touch it here).
- `service.ts:2748` `getSalesOpsSnapshot` selects receivables and payables with `tx.select().from(...)` and returns them raw; `routes.ts:70-73` returns it as JSON.
  After slice 03 the rows already carry `revision` and `updatedAt`, so only `paidOn` is new.
- `routes.ts:321-351` map `transitionSale` and `cancelContract` results; they have no `requireAdmin` yet (slice 07 adds it, H4).
- Existing integration fixtures in `apps/api/src/domains/sales-ops/__tests__/sale-transitions.integration.test.ts:236-274` and `:665-755` set `status = 'paid'` by a raw UPDATE with no settlement row, to prove the old rule "leaving won keeps paid rows".
  That rule is what this slice replaces.
- Integration tests under `src/**/*.integration.test.ts` use `getDb()` (tenant role, RLS live) and `getAdminDb()` (seeding, cleanup, raw asserts), serial files (`apps/api/vitest.config.ts`).
- Payable kind vocabulary in the UI (`apps/web/src/sales-ops/SalesOpsApp.tsx:511-517` `payableTypeMeta`): Vendedor, Finder, Prestador, Imposto, Custo.
- `@fxl-sales/shared-utils` resolves through `dist/` (`packages/shared-utils/package.json` exports), so the package must be built before the API tests import the new `/liquidacao` and `/sao-paulo-day` subpaths.

## Design

### New module `apps/api/src/domains/sales-ops/settlements.ts`

All settlement SQL and rules live here.
It imports `withTenant`, `CadastroActor` and the `Db` type from `./service.js` (slice 04 already exported `type Db`), the tables from `../../db/schema.js`, `reduzirLiquidacao`, `eventoDeSettlement`, `statusCacheDaLinha`, `validarNovaBaixa`, `validarEstorno` and the types `Liquidacao`, `LiquidacaoEvento`, `StatusLinhaLiquidavel`, `StatusVendaLiquidavel` from `@fxl-sales/shared-utils/liquidacao`, `todayInSaoPaulo` from `@fxl-sales/shared-utils/sao-paulo-day`, and `loadSaleSettlementRows`, `activeSettlementTargetIds` (from `./settlement-locks.js`) plus `receivableRowLabel`, `payableRowLabel` and `type BlockedLedgerRow` (from `./ledger-reconcile.js`), all shipped by slice 04.
There is NO local reducer adapter, no local "active" rule, no local status-cache rule and no local label function: slice 02 owns the rules and slice 04 owns the C5 labels (plan-check resolution; one implementation each).
`service.ts` imports from `settlements.ts` only `findActiveSettlementRows`, `selectOrgSettlements` and `attachSettlementState`; `settlements.ts` imports from `service.ts` only `withTenant` and types, so the cycle is type-plus-one-function and safe under ESM because neither module uses the other at top level.

Types and schemas:

```ts
export type SettlementTargetKind = 'receivable' | 'payable';
export type SettlementType = 'baixa' | 'estorno';
export const SETTLEMENT_REASON_MAX = 500;

export const RecordSettlementSchema = z
  .object({
    targetKind: z.enum(['receivable', 'payable']),
    targetId: z.string().uuid(),
    paidOn: z.string().optional(),
  })
  .strict();

export const ReverseSettlementSchema = z
  .object({ reason: z.string().trim().max(SETTLEMENT_REASON_MAX).optional() })
  .strict();

export type SettlementErrorCode =
  | 'not_found' | 'sale_not_won' | 'row_void' | 'already_paid' | 'already_reversed'
  | 'invalid_paid_on' | 'paid_on_in_future';

export const SETTLEMENT_ERROR_STATUS: Record<SettlementErrorCode, 404 | 409 | 422> = {
  not_found: 404, sale_not_won: 409, row_void: 409, already_paid: 409,
  already_reversed: 409, invalid_paid_on: 422, paid_on_in_future: 422,
};

/** C5 row shape: reuse slice 04's `BlockedLedgerRow` type (`{ kind, id, label }`), re-exported under this name. */
export type ActiveSettlementRow = BlockedLedgerRow;

/** C6 history entry, EXACTLY the shape slice 08 types as `SalesOpsSettlement`. */
export type SettlementEntry = {
  id: string;
  saleId: string;
  targetKind: SettlementTargetKind;
  receivableId: string | null;
  payableId: string | null;
  type: SettlementType;
  reversesSettlementId: string | null;
  reversedBySettlementId: string | null;
  paidOn: string;            // YYYY-MM-DD; for an estorno, the reversal day
  amountBrl: number;         // cents
  origin: 'manual' | 'finance';
  actorName: string | null;  // snapshot; actor_user_id is NEVER projected
  recordedAt: string;        // ISO instant
  reason: string | null;
};

export type SettledRowState = {
  kind: SettlementTargetKind;
  id: string;
  status: 'open' | 'paid' | 'void';
  revision: number;
  updatedAt: string;
  paidOn: string | null;
};

export type SettlementWriteResult =
  | { ok: true; settlement: SettlementEntry; row: SettledRowState }
  | { ok: false; reason: SettlementErrorCode };
```

Pure helpers (exported, unit tested, no DB):

- `toIsoDay(value: string | Date): string` returns `value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10)` (normalizes whatever mode slice 03 gave the `date` column).
- `toIsoDay` normalizes `paidOn` before any fact reaches `eventoDeSettlement` (a stored civil day, C1).
- `toEvent(f: SettlementFactRow): LiquidacaoEvento` is `eventoDeSettlement({ ...f, paidOn: toIsoDay(f.paidOn) })`.
- `liquidacaoDaLinha(amountBrl: number, facts: SettlementFactRow[]): Liquidacao` is `reduzirLiquidacao({ valorOriginalCentavos: amountBrl, eventos: facts.map(toEvent) })`; a thin call, not an adapter (no renaming of the output).
- `toEntry(row, reversedBySettlementId: string | null): SettlementEntry` projects exactly the C6 fields.
- The row `status` cache is ALWAYS `statusCacheDaLinha(row.status as StatusLinhaLiquidavel, liquidacao)` (slice 02); `void` stays `void`.
- `attachSettlementState<T extends { id: string; amountBrl: number }>(rows: T[], facts: SettlementFactRow[], kind: SettlementTargetKind): Array<T & { paidOn: string | null }>` groups `facts` by `receivableId` (kind receivable) or `payableId` (kind payable) into a `Map` once, then `paidOn = group ? liquidacaoDaLinha(row.amountBrl, group).dataUltimoPagamento : null`.
  O(rows + facts); no query inside.
- `isReversesUniqueViolation(error: unknown): boolean` walks `error` and `error.cause` (the `mapFuncaoUniqueViolation` pattern at `service.ts:1772`) and returns true when `code === '23505'` and the constraint name (`constraint_name ?? constraint`) contains `reverses_settlement`.

Tenant functions (every one filters by `orgId` explicitly AND runs inside `withTenant`):

1. `selectOrgSettlements(tx: Db, orgId: string): Promise<SettlementFactRow[]>` = `tx.select().from(salesOpsSettlements).where(eq(salesOpsSettlements.orgId, orgId))`.
   `selectSaleSettlements(tx, orgId, saleId)` adds `eq(salesOpsSettlements.saleId, saleId)`.
2. `findActiveSettlementRows(tx: Db, orgId: string, saleId: string, scope?: { receivableIds?: string[]; payableIds?: string[] }): Promise<ActiveSettlementRow[]>`:
   - `rows = await loadSaleSettlementRows(tx, orgId, saleId)` (slice 04); if empty return `[]` (no row queries, the common path);
   - `active = activeSettlementTargetIds(rows)` (slice 04, built on slice 02's `temBaixaAtiva`);
   - when `scope` is given keep only ids inside it;
   - load the sale's receivables (`id`, `label`) and the kept payables (`id`, `beneficiaryName`, `receivableId`) with org + sale filters, and label them with slice 04's `receivableRowLabel` / `payableRowLabel` (C5: `1/2`, `Ana Martins (1/2)`);
   - return receivables first, then payables, each ordered by `(dueDate, id)` like slice 04's `findBlockedRows`, so the 409 body is deterministic.
3. `recordSettlement(db: Db, orgId: string, actor: CadastroActor, input: z.infer<typeof RecordSettlementSchema>, opts: { now?: Date } = {}): Promise<SettlementWriteResult>`:
   1. `now = opts.now ?? new Date()`; `today = todayInSaoPaulo(now)`; `paidOn = input.paidOn ?? today`.
   2. `withTenant`: pick `table = targetKind === 'receivable' ? salesOpsReceivables : salesOpsPayables`.
      `SELECT sale_id FROM table WHERE org_id = $org AND id = $targetId` with no lock (sale_id never changes); none returns `not_found`.
   3. Lock the sale: `SELECT status FROM sales_ops_sales WHERE org_id = $org AND id = $saleId FOR SHARE` (`.for('share')`).
      Lock order sale then row is the order `transitionSale`, `cancelContract` and `updateSale` use (C6 as resolved), so no deadlock; `FOR SHARE` conflicts with their `FOR UPDATE`, which is what closes the race "sale leaves won while a baixa is being inserted".
   4. Lock the row: `SELECT * FROM table WHERE org_id = $org AND id = $targetId FOR UPDATE`.
   5. `facts = SELECT * FROM sales_ops_settlements WHERE org_id = $org AND <receivable_id|payable_id> = $targetId` (read INSIDE the lock, slice 02's security note).
   6. `verdict = validarNovaBaixa({ valorOriginalCentavos: row.amountBrl, eventos: facts.map(toEvent), statusLinha: row.status, statusVenda: sale.status, dataPagamento: paidOn, hojeSaoPaulo: today })` (slice 02).
      `!verdict.ok` returns `verdict.codigo` (`sale_not_won`, `row_void`, `invalid_paid_on`, `paid_on_in_future`, `already_paid`, in slice 02's fixed order; a zero-amount row is `already_paid`).
      There is no separate local date or status check: the validator IS the rule, so the API and the UI can never disagree.
   7. Insert `{ orgId, saleId: row.saleId, targetKind, receivableId | payableId, type: 'baixa', reversesSettlementId: null, paidOn: verdict.data, amountBrl: verdict.valorCentavos, origin: 'manual', actorUserId: actor.userId, actorName: actor.displayName, reason: null }` returning the row (the `sale_id` is copied from the target row, as the composite FK requires).
      The amount is ALWAYS `verdict.valorCentavos`; the schema is `.strict()` so a body `amountBrl` is a 400 before the service runs.
   8. `after = liquidacaoDaLinha(row.amountBrl, [...facts, inserted])`; `next = statusCacheDaLinha(row.status, after)`.
      If `next !== row.status`: `UPDATE table SET status = next, revision = revision + 1, updated_at = now WHERE org_id = $org AND id = $targetId RETURNING *` (drizzle: `.set({ status: next, ...receivableRevisionBump() })` or `payableRevisionBump()` from slice 04's `ledger-revision.ts`); otherwise no UPDATE (C7: no-op does not bump).
   9. Return `{ ok: true, settlement: toEntry(inserted, null), row: { kind, id, status, revision, updatedAt: iso, paidOn: after.dataUltimoPagamento } }`.
4. `reverseSettlement(db, orgId, actor, settlementId: string, input: z.infer<typeof ReverseSettlementSchema>, opts: { now?: Date } = {}): Promise<SettlementWriteResult>`:
   1. `now`, `today = todayInSaoPaulo(now)`; `reason = input.reason && input.reason !== '' ? input.reason : null` (already trimmed by zod).
   2. Whole body inside `try { return await withTenant(...) } catch (e) { if (isReversesUniqueViolation(e)) return { ok: false, reason: 'already_reversed' }; throw e; }` (the violation aborts the transaction, so it is caught OUTSIDE `withTenant`).
   3. `SELECT * FROM sales_ops_settlements WHERE org_id = $org AND id = $settlementId`; none returns `not_found`.
   4. Lock the sale `FOR SHARE` (no status check: an active baixa implies `won`, because leaving `won` is locked), then lock the target row `FOR UPDATE`.
   5. Read all the row's facts inside the lock and run `validarEstorno({ baixaId: settlementId, eventos, hojeSaoPaulo: today })` (slice 02): `not_found` (the id names an estorno) or `already_reversed`.
   6. Insert `{ orgId, saleId: baixa.saleId, targetKind, receivableId | payableId, type: 'estorno', reversesSettlementId: verdict.estornaBaixaId, paidOn: verdict.data, amountBrl: verdict.valorCentavos, origin: 'manual', actorUserId, actorName, reason }` (estorno amount equals the baixa's, Finance rule `EstornoValorDivergente`).
   7. Recompute with all the row's facts, `statusCacheDaLinha`, same conditional UPDATE with the revision bump as step 8 above.
   8. Return `{ ok: true, settlement, row }`.
5. `listSaleSettlements(db, orgId, saleId): Promise<{ ok: true; settlements: SettlementEntry[] } | { ok: false; reason: 'not_found' }>`:
   - sale existence by `org_id` + `id` (none returns `not_found`);
   - `selectSaleSettlements` ordered `desc(recordedAt), desc(id)`;
   - `reversedBySettlementId` from a `Map<reversesSettlementId, estornoId>` built from the same list;
   - `toEntry` projects exactly the `SettlementEntry` fields (C6 as resolved, identical to slice 08's `SalesOpsSettlement`); `actorUserId` is never copied and no label is computed (the UI describes rows from the bootstrap).

### Service edits in `service.ts` (small and localized)

- `TransitionResult` gains `| { ok: false; reason: 'sale_has_active_settlements'; rows: ActiveSettlementRow[] }`.
  In `transitionSale` (which keeps slice 01's trailing `now` parameter), right after the `canTransition` check and before any write:
  ```ts
  if (sale.status === 'won' && to !== 'won') {
    const rows = await findActiveSettlementRows(tx, orgId, saleId);
    if (rows.length > 0) return { ok: false, reason: 'sale_has_active_settlements', rows };
  }
  ```
  The early return happens before any write, so nothing changes.
- The revert void in `transitionSale` already carries `payableRevisionBump()` (slice 04, D7); do not add a second bump.
- `CancelContractResult` gains the same `sale_has_active_settlements` variant.
  In `cancelContract`, after computing `cutoff` and before the existing `future` query:
  - `candidateReceivables` = sale receivables with `status <> 'void'` and `due_date > cutoff` (ids);
  - `candidatePayables` = sale payables with `status <> 'void'` and `receivable_id IN candidateReceivables` (ids; skip the query when the list is empty);
  - `rows = await findActiveSettlementRows(tx, orgId, saleId, { receivableIds, payableIds })`; non-empty returns the 409 variant before any write.
  The existing `status = 'open'` void filters stay as they are; both void UPDATEs already carry the revision bump (slice 04, D7).
  Using the broader non-void candidate set for the CHECK is the point of H5: a prepaid future parcela or a paid commission on a future parcela is exactly a row the cancellation would otherwise orphan.
- `getSalesOpsSnapshot`: add `const settlements = await selectOrgSettlements(tx, orgId);` and return `payables: attachSettlementState(payables, settlements, 'payable')` and `receivables: attachSettlementState(receivables, settlements, 'receivable')`.
  One extra query per bootstrap; no N+1.

### Routes in `routes.ts`

Import `RecordSettlementSchema`, `ReverseSettlementSchema`, `SETTLEMENT_ERROR_STATUS`, `recordSettlement`, `reverseSettlement`, `listSaleSettlements` from `./settlements.js`.
Place the block after `PUT /sales/:id`.

```ts
salesOpsRouter.post('/settlements', requireAdmin, async (c) => {
  const parsed = RecordSettlementSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  const result = await recordSettlement(getDb(), c.get('orgId'), cadastroActor(c), parsed.data);
  if (!result.ok) return c.json({ error: result.reason }, SETTLEMENT_ERROR_STATUS[result.reason]);
  return c.json({ settlement: result.settlement, row: result.row }, 201);
});

salesOpsRouter.post('/settlements/:id/reverse', requireAdmin, async (c) => {
  const id = saleIdSchema.safeParse(c.req.param('id'));        // any uuid
  if (!id.success) return c.json({ error: 'not_found' }, 404);
  const parsed = ReverseSettlementSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  const result = await reverseSettlement(getDb(), c.get('orgId'), cadastroActor(c), id.data, parsed.data);
  if (!result.ok) return c.json({ error: result.reason }, SETTLEMENT_ERROR_STATUS[result.reason]);
  return c.json({ settlement: result.settlement, row: result.row }, 201);
});

salesOpsRouter.get('/sales/:id/settlements', requireAdmin, async (c) => {
  const id = saleIdSchema.safeParse(c.req.param('id'));
  if (!id.success) return c.json({ error: 'not_found' }, 404);
  const result = await listSaleSettlements(getDb(), c.get('orgId'), id.data);
  if (!result.ok) return c.json({ error: 'not_found' }, 404);
  return c.json({ settlements: result.settlements });
});
```

Rename `saleIdSchema` is NOT done; reuse it as-is (it is `z.string().uuid()`).
The `/transition` handler adds, before the `invalid_transition` branch: `if (!result.ok && result.reason === 'sale_has_active_settlements') return c.json({ error: 'sale_has_active_settlements', rows: result.rows }, 409);`.
The `/cancel-contract` handler adds the same line before its `contract_not_cancellable` branch.
`/bootstrap` needs no route change.

Error bodies (C5): `{ error: '<code>' }` for settlement errors; `{ error: 'sale_has_active_settlements', rows: [{ kind, id, label }] }` for the locks.

## Steps

Before any test: `pnpm --filter @fxl-sales/shared-utils build` (the API resolves the package through `dist/`).
Integration runs use the local Docker test DB through the existing setup; never run `db:migrate` by hand.

1. Red: `apps/api/src/domains/sales-ops/__tests__/settlements.test.ts` (unit, pure helpers):
   - `attachSettlementState gives paidOn null without facts and the greatest active day with facts` (two baixas `2026-09-10` and `2026-09-12`, the second reversed, expects `2026-09-10`; add a third active `2026-09-20`, expects `2026-09-20`);
   - `attachSettlementState groups by the column that matches the kind` (a payable fact never lands on a receivable with the same id string);
   - `RecordSettlementSchema refuses an amount in the body` (`{ targetKind, targetId, amountBrl: 1 }` fails);
   - `ReverseSettlementSchema trims the reason and refuses more than 500 characters`;
   - `isReversesUniqueViolation reads the wrapped cause`;
   - `settlements.ts writes only manual facts and holds no integration code` (source guard: `readFileSync` of `../settlements.ts`, assert length > 1000 and it contains `origin: 'manual'` as vacuity controls, then assert it does not match `/origin:\s*'finance'/`, `/\bfetch\(/`, `/outbox/i`, `/FXL_FINANCE|FXL_HUB/`; request acceptance 13).
   Green: write the pure part of `settlements.ts`.
2. Red: `apps/api/src/domains/sales-ops/__tests__/settlements.integration.test.ts`.
   Harness: copy the `must`, `nextSequence`, `seedSale`, `seedReceivable` helpers from `sale-transitions.integration.test.ts` (seed with `getAdminDb()`), and build a Hono app that mounts the REAL `salesOpsRouter` behind a middleware setting `userId`, `orgId`, `userRole`, `userRoles`, `hubAuth` from mutable test variables (the `history-route.test.ts:40-60` shape, using `hubAuthContext({ accountId, workspaceId: orgId, name: 'Ana Financeiro' })`), with NO `vi.mock` of the DB.
   A won sale fixture: `seedSale(orgId, { status: 'open' })`, two `seedReceivable` rows (`1/2` due `2026-08-01` 300000, `2/2` due `2026-09-01` 200000), then `transitionSale(getDb(), orgId, sale.id, 'won')` so payables are real.
   Cleanup in `afterEach`: `await deleteSettlementsForOrgs(seededOrgIds)` FIRST (slice 03's helper in `apps/api/src/db/__tests__/settlement-test-cleanup.ts`, the only sanctioned path past the immutability trigger), then delete payables, receivables, professionals, items and sales for each org through `getAdminDb()`.
   Tests, in this order:
   - `records a baixa for the whole open amount and caches paid with the day` (POST with `paidOn: '2026-09-01'`; expects 201, `settlement.amountBrl === 300000`, `settlement.actorName === 'Ana Financeiro'`, `Object.keys(settlement).sort()` equals the C6 `SettlementEntry` key list exactly, no `actorUserId` key anywhere in the JSON, row `status 'paid'`, `revision === before + 1`, `paidOn '2026-09-01'`; raw DB row agrees, its `sale_id` equals the receivable's `sale_id`, and `actor_user_id` equals the verified account);
   - `refuses a second baixa on a paid row with 409 already_paid and writes nothing` (settlement count unchanged, revision unchanged);
   - `refuses a paidOn after São Paulo today with 422 paid_on_in_future` (use `todayInSaoPaulo()` plus one day via `Date.UTC` arithmetic);
   - `refuses a non-day paidOn with 422 invalid_paid_on` (`2026-02-30`, `26-09-2026`);
   - `defaults paidOn to the São Paulo day near UTC midnight` (service call `recordSettlement(getDb(), orgId, actor, { targetKind: 'receivable', targetId }, { now: new Date('2026-09-24T01:30:00Z') })`, expects stored `paid_on` `2026-09-23`, not `2026-09-24`);
   - `refuses a baixa on a void row with 409 row_void` (admin UPDATE a receivable to void first);
   - `refuses a baixa on a non-won proposta with 409 sale_not_won` (open sale fixture);
   - `reverses a baixa, reopens the row, and a new baixa pays it again with the greatest active day` (baixa `2026-09-01`, reverse with `reason: '  pago em duplicidade  '` stores `pago em duplicidade`, row `open`, revision +1, bootstrap `paidOn null`; new baixa `2026-08-20`, row `paid`, bootstrap `paidOn '2026-08-20'`, proving the reversed `2026-09-01` no longer counts even though it is greater; "greatest among several active" is proven by the unit test, because v1 cannot hold two active baixas on one row);
   - `refuses a second reverse with 409 already_reversed`;
   - `maps a reverses_settlement_id UNIQUE race to 409 already_reversed` (call `reverseSettlement` twice concurrently with `Promise.all` on the same baixa and assert exactly one `ok: true`, exactly one `already_reversed`, and exactly one estorno row; the row lock usually serializes them, and the test stays valid whichever guard answers);
   - `revision increments by exactly one on each state change` (baixa, reverse, baixa: 1, 2, 3, 4 on the receivable; a refused 409 leaves it);
   - `leaving won with an active baixa answers 409 and changes nothing` (POST `/sales/:id/transition` `{status:'open'}`: 409 body `{ error: 'sale_has_active_settlements', rows: [{ kind: 'receivable', id, label: '1/2' }] }`; sale still `won`, every payable status and revision identical to before);
   - `leaving won with a baixa on a payable names the payable` (label `Ana Martins (1/2)`, the C5 payable label of slice 04's `payableRowLabel`);
   - `after the estorno the proposta leaves won and open payables are voided with a revision bump`;
   - `cancel-contract refuses while a row it would void has an active baixa` (recurring fixture as in `sale-transitions.integration.test.ts:666`, baixa on the seller payable of `M2/3`, `cancelContract(getDb(), orgId, sale.id, '2026-08-15')` returns the 409 variant; every row status unchanged);
   - `cancel-contract ignores an active baixa on a row it would not void` (baixa on `M1/3`, cut-off `2026-08-15`, succeeds);
   - `a baixa, a reverse and a history read across orgs answer 404` (org B context, org A ids; org A rows unchanged);
   - `history lists the sale's baixas and estornos newest first without account ids` (after baixa, reverse, baixa: three entries, types `baixa`, `estorno`, `baixa`, first baixa has `reversedBySettlementId`, reason present only on the estorno, JSON text does not contain the account id);
   - `every settlement route answers 403 for a non-admin and writes nothing` (roles `seller`, `finder`, `undefined` x the three routes; 403 body `{ error: 'forbidden', reason: 'admin_role_required' }`; settlement count unchanged);
   - `bootstrap rows carry revision, updatedAt and paidOn` (every receivable and payable has numeric `revision`, ISO `updatedAt`, `paidOn` string or null).
   Green: implement the tenant functions, the routes, and the service edits in the order Design lists them.
3. Red: add to `apps/api/src/domains/sales-ops/__tests__/transition-routes.test.ts`:
   - `maps sale_has_active_settlements on transition to 409 with the rows`;
   - `maps sale_has_active_settlements on cancel-contract to 409 with the rows`.
   Green: the two route lines.
4. Rewrite the obsolete fixtures in `apps/api/src/domains/sales-ops/__tests__/sale-transitions.integration.test.ts`:
   - `reverting a won sale voids open payables, keeps paid ones, and clears won_at` becomes `reverting a won sale with no active baixa voids its open payables and clears won_at`: delete the raw `status: 'paid'` UPDATE and the `paidPayable` assertions; assert every payable is `void` and each `revision` is its before value + 1.
   - `voids future open receivables and their linked open payables only`: delete the raw `status: 'paid'` UPDATE of `r2SellerPayable` and the assertion that it stays `paid`; `voidedPayables` becomes `4` (seller + tax on `M2/3` and `M3/3`); assert every `r2` payable is `void`.
   - Leave `re-win creates exactly one missing payable ...` and the two `v2.3.1 ...` tests untouched: they exercise the idempotency of materialization against legacy status-only rows and cross no lock (no settlement rows exist).
5. Refactor: confirm `settlements.ts` contains no second implementation of "active", of the `paid` cache or of the C5 label (`grep -n "baixasAtivas\|'paid' :\|Parcela " apps/api/src/domains/sales-ops/settlements.ts` finds nothing outside imports and comments).
   Run lint and type-check on the changed files.
6. Docs (below), same commit.

## Oracle tests

Run after `pnpm --filter @fxl-sales/shared-utils build`:

- `pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/__tests__/settlements.test.ts src/domains/sales-ops/__tests__/transition-routes.test.ts`
- `pnpm --filter @fxl-sales/api test:integration settlements.integration sale-transitions.integration`
- `pnpm --filter @fxl-sales/api exec eslint src/domains/sales-ops/settlements.ts src/domains/sales-ops/routes.ts src/domains/sales-ops/service.ts` and `pnpm --filter @fxl-sales/api type-check`.

Non-vacuity, one mutation each (Verify applies it, sees the named test go red, reverts):

- Skip `validarNovaBaixa` and insert unconditionally: `refuses a second baixa ... already_paid`, `paid_on_in_future`, `sale_not_won` and `row_void` go red.
- Pass `statusVenda: 'won'` as a constant: `sale_not_won` goes red; pass `statusLinha: 'open'` as a constant: `row_void` goes red.
- Pass `hojeSaoPaulo: now.toISOString().slice(0, 10)`: `defaults paidOn to the São Paulo day near UTC midnight` goes red.
- Skip `validarEstorno`: the double-reverse test still passes only through the UNIQUE backstop; then also delete the `isReversesUniqueViolation` catch: `refuses a second reverse` goes red (500).
- Remove `revision + 1` from the cache UPDATE: `revision increments by exactly one` goes red.
- Delete the leave-won guard in `transitionSale`: `leaving won with an active baixa answers 409` goes red.
- Replace the non-void candidate set in `cancelContract` by the `status = 'open'` one: `cancel-contract refuses while a row it would void has an active baixa` goes red (the paid payable is no longer a candidate).
- Remove `requireAdmin` from any one settlement route: `every settlement route answers 403` goes red.
- Change the history projection to spread the raw row: `history ... without account ids` goes red.
- Drop `attachSettlementState` from the snapshot: `bootstrap rows carry ... paidOn` goes red.
- Cross-org: delete the `SELECT sale_id` existence check: the insert fails under RLS or FK and the cross-org test gets 500, not 404.
  RLS alone keeps the 404 if only the explicit `orgId` predicate is removed; that is the RLS backstop working, not vacuity, and it is the pattern `propostas.md` already records.

## Docs

`CLAUDE.md`, section `## Propostas domain`, subsection `Statuses and payables:`, replace the line `- Leaving \`won\` voids only \`open\` payables and receivables, never \`paid\` ones.` with:

```
- Leaving `won` is refused with `409 sale_has_active_settlements` (naming the rows) while any row of the proposta has an active baixa; the operator reverses first, manually.
  Without one, the revert voids the `open` payables and leaves the receivables.
- `cancel-contract` refuses with the same 409 when any non-void row it would void has an active baixa.
```

and add a new subsection right after `Statuses and payables:`:

```
Baixas (settlements):
- A baixa or estorno is an immutable fact in `sales_ops_settlements`, written only by `apps/api/src/domains/sales-ops/settlements.ts` behind `requireAdmin` (`POST /settlements`, `POST /settlements/:id/reverse`, `GET /sales/:id/settlements`).
- A baixa is allowed only on a non-void row of a `won` proposta, its amount is always the whole open amount (never from the body), and `paidOn` defaults to `todayInSaoPaulo()` and is never in the future.
- Row `status` `paid` is a cache of `reduzirLiquidacao` written with `revision + 1` only when it changes; `void` stays a Sales decision the cache never overwrites.
- Settlement writes lock the sale `FOR SHARE` and then the row `FOR UPDATE`, the same order (sale first) as every sale write; the rules come only from `validarNovaBaixa` / `validarEstorno` / `statusCacheDaLinha`.
- The history projects `actorName` only, never `actor_user_id`.
```

`nexo/knowledge/reference/propostas.md`, replace the bullet `- Leaving \`won\` (revert, lose, cancel) voids only \`open\` payables and receivables; \`paid\` rows are never touched.` with:

```
- Leaving `won` is locked while any row of the proposta has an ACTIVE baixa (owner decision Q5 in the Sales-Finance audit, section 10): `transitionSale` answers `409 sale_has_active_settlements` with `rows: [{ kind, id, label }]` before any write, and the operator reverses each baixa manually.
  The old rule "voids only open rows, paid rows are never touched" is gone because it let a proposta leave `won` with money recorded against rows that no longer describe an obligation, and because the `paid` it protected was only ever produced by test fixtures.
  Without an active baixa the revert still voids the `open` payables and leaves the receivables, which go back to being projections of an open proposta.
- `cancelContract` checks the NON-VOID rows beyond the cut-off (and the payables linked to them), not only the `open` ones, and refuses with the same 409 when any of them has an active baixa (H5): a prepaid future parcela or a paid commission on a future parcela is exactly what a silent cancellation would orphan.
- A baixa is a fact in `sales_ops_settlements`; `status = 'paid'` on the row is a cache of `reduzirLiquidacao` (`@fxl-sales/shared-utils/liquidacao`) and `paidOn` in `/bootstrap` is the reducer's greatest active day, computed from one org-wide settlements query.
  Only `settlements.ts` writes the cache, it bumps `revision` only when the cached status changes, and it never overwrites `void`.
  A baixa needs a `won` proposta (H3) because a draft or open proposta's receivables are projections, not obligations.
  Every settlement write locks the sale `FOR SHARE` before the row `FOR UPDATE`, so it serializes against `transitionSale`, `cancelContract` and `updateSale` (all `FOR UPDATE` on the sale) without a deadlock.
  The double estorno is refused twice: by the check under the row lock, and by the UNIQUE `reverses_settlement_id` constraint mapped to the same `409 already_reversed` when two requests race.
  Oracles: `apps/api/src/domains/sales-ops/__tests__/settlements.integration.test.ts` and `settlements.test.ts`.
```

## Security notes

- Every settlement route is `requireAdmin`; the actor id and name come from the verified context through `cadastroActor(c)`, never from the body.
- No `user_id`, `org_id` or amount is read from the body; `RecordSettlementSchema` and `ReverseSettlementSchema` are `.strict()`, so a smuggled `amountBrl`, `orgId` or `actorName` is a 400.
- Every query filters `eq(table.orgId, orgId)` inside `withTenant`, and RLS on `sales_ops_settlements` (slice 03) is the backstop; `getAdminDb` is never used by the module.
- The history response carries `actorName` only; `actor_user_id` stays in the database (CLAUDE.md UI Identifiers).
- The reason is trimmed and capped at 500 characters; it is rendered as text by the UI slice, never as HTML.

## Contract deviations

- C2 (RESOLVED by plan-check): slice 02's Finance names are used directly (`reduzirLiquidacao({ valorOriginalCentavos, eventos })`, `dataUltimoPagamento`, `baixasAtivas: BaixaEvento[]`, no `quitado`) through slice 02's own `eventoDeSettlement`, `statusCacheDaLinha`, `validarNovaBaixa`, `validarEstorno`; the adapters this plan first proposed (`toLiquidacaoFacts`, `reduceRow`, `nextCachedStatus`) are dropped.
- C3 Drizzle names are slice 03's: `salesOpsSettlements` with `id, orgId, saleId, targetKind, receivableId, payableId, type, reversesSettlementId, paidOn, amountBrl, origin, actorUserId, actorName, recordedAt, reason`, and `revision` / `updatedAt` on `salesOpsReceivables` and `salesOpsPayables`.
- C3 immutability refuses DELETE too; integration cleanup goes through slice 03's `deleteSettlementsForOrgs`.
- C5 already lists every code used here; the `rows[].label` is slice 04's (RESOLVED by plan-check), replacing this plan's first `Parcela ...` / `Vendedor: ...` labels.
- C6 (RESOLVED by plan-check): the POST routes answer `201` with `{ settlement, row }` and the GET answers `{ settlements: SettlementEntry[] }` with the field list in `00-OVERVIEW.md`.

## Decisions for AUDIT

- Reversing an estorno, or any id that is not a baixa, answers `404 not_found`: only a baixa is a reversible resource, and C5 has no dedicated code.
- A baixa's `paidOn` has no lower bound (not even the won date): a real entrada is often paid at signature, before the proposta is marked won.
- The estorno's `paid_on` is the São Paulo day of the reversal and is not accepted from the body (C6).
- The estorno reason is optional, trimmed, empty means `null`, capped at 500 characters.
- The settlement bodies are `.strict()`: an unknown key is a 400, so an `amountBrl` in the body can never be silently ignored.
- `cancel-contract`'s lock checks non-void rows beyond the cut-off and their linked non-void payables; its void filters stay `status = 'open'`.
- Row labels in the 409 bodies are the C5 labels of slice 04 (`<N/M>` and `<beneficiário> (<N/M>)`); the history carries no label, the UI describes rows from the bootstrap.
- The refusal order of a baixa is slice 02's `validarNovaBaixa` order, so a future `paidOn` on a void row answers `row_void`, not `paid_on_in_future`.

## Out of scope

- `requireAdmin` on transition, cancel-contract, PUT sale, PUT settings and the `POST /sales` won gate (slice 07, H4).
- The row lock on value and due-date edits (`row_has_active_settlement`) and revision bumps inside `updateSale` (slice 04).
- Any web code: the `hooks.ts` comment "leaves paid rows untouched", the mark-paid and reverse dialogs, the history list, and web types for `paidOn` / `revision` (slice 08).
- Partial payments, interest, fines, discounts, the `finance` origin, and any outbox, feed or event (integration work).
- Migrating `sales_ops_settings` currency (slice 07) and the `due_date` São Paulo display (slice 01).
