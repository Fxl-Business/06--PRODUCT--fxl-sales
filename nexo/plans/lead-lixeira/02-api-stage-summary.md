---
id: 02-api-stage-summary
milestone: v4.6.0
status: done
depends_on: [01-api-lixeira]
files_modified: [apps/api/src/domains/sales-ops/leads/lead-schemas.ts, apps/api/src/domains/sales-ops/leads/lead-service.ts, apps/api/src/domains/sales-ops/leads/lead-routes.ts, apps/api/src/domains/sales-ops/leads/__tests__/lead-routes.test.ts, apps/api/src/middleware/__tests__/edition-gate-map.test.ts, apps/api/test/rls/leads-stage-summary.test.ts]
oracle: [apps/api/test/rls/leads-stage-summary.test.ts, apps/api/src/domains/sales-ops/leads/__tests__/lead-routes.test.ts, apps/api/src/middleware/__tests__/edition-gate-map.test.ts]
acceptance: ["GET /api/v1/sales-ops/leads/summary answers 200 {stages:[{stageId,count,estimatedValueBrl}]} with one entry per stage holding at least one visible live lead and no entry for a stage with none", "For an admin each entry's count equals listLeads total for that stage and estimatedValueBrl equals the sum of estimatedValueBrl over every page of that stage, including a stage holding more leads than one default page", "An admin ?sellerPersonId= narrows the summary to that vendedor's leads exactly as it narrows listLeads", "An active vendedor's summary counts his own leads plus the unassigned pool and never a colleague's lead, and ?sellerPersonId= is ignored entirely for every non-admin", "A non-admin who is not an active vendedor (deactivated vendedor, finder-only pessoa) is summarized over his own leads only and never the pool", "Soft-deleted leads are excluded from count and value, and a stage whose only live lead was deleted has no entry", "Converted and lost leads are included exactly as the board lists them", "The org predicate is proved over the RLS-bypassing admin connection, and an org with no leads answers stages []", "estimatedValueBrl is an exact JS integer number of cents even when a stage total exceeds the int4 range", "A caller with no mapped pessoa gets 403 {error:'forbidden',reason:'seller_person_unmapped'} exactly like the list, and a malformed sellerPersonId is 400 validation_error", "GET /leads/summary is registered before GET /leads/:id so getLead is never called for it, and edition-gate-map.test.ts classifies it OPEN", "listLeads and summarizeLeadStages build their scope WHERE from one shared helper, and every existing lead integration suite stays green"]
---

# 02 Per-stage lead summary (count and value, scoped like the list)

Serves AC11 of `00-OVERVIEW.md`.
The board computes the column badge, the R$ totals, the Lista chips and footer and the Funil from the LOADED leads only, so 115 leads read 100 while 15 sit behind "Carregar mais leads".
This slice gives the web (slice 05) one server read with the true per-stage count and value for exactly the set the board may show.

Names come from `SEAM-CONTRACT.md` section "API (slice 02)" and are not renegotiable: route `GET /leads/summary?sellerPersonId=`, body `{ stages: Array<{ stageId: string; count: number; estimatedValueBrl: number }> }`, service `summarizeLeadStages(db, orgId, query, scope)`.

## Preconditions (from slice 01, already merged on the branch you start from)

- `sales_ops_leads.deleted_at` exists, Drizzle column `salesOpsLeads.deletedAt`.
- `lead-service.ts` exports `liveLeadCondition()` (returns `isNull(salesOpsLeads.deletedAt)`), and `listLeads` already filters live leads through it.
- `lead-service.ts` (or the file slice 01 chose, check its plan `nexo/plans/lead-lixeira/01-api-lixeira.md`) exports `deleteLead(db, orgId, id, scope, actor)` with `actor = { userId: string; name: string | null }`.
- `lead-routes.ts` registers `GET /deleted` before `GET /:id`.

If any of these is missing, STOP and report; do not re-implement slice 01.

## Design (fixed, no decisions left)

### 1. Query schema - `apps/api/src/domains/sales-ops/leads/lead-schemas.ts`

Add directly below `ListLeadsQuerySchema` (and its type exports below it, next to `ListLeadsQuery`):

```ts
/**
 * GET /leads/summary. The list's own `sellerPersonId` parsing, PICKED and not
 * re-spelled, so the two board reads can never disagree about what a valid
 * narrowing is. There is no stageId: the summary covers every column in one
 * GROUP BY.
 */
export const LeadStageSummaryQuerySchema = ListLeadsQuerySchema.pick({ sellerPersonId: true });
```

```ts
export type LeadStageSummaryQuery = z.infer<typeof LeadStageSummaryQuerySchema>;
```

Behaviour that follows and is intended: absent param is fine, a non-uuid (including the empty string) is a 400, exactly like the list.

### 2. Service - `apps/api/src/domains/sales-ops/leads/lead-service.ts`

2a. One shared scope helper, so the list `total` and the summary `count` are computed over the SAME set by construction.
Add it right after `leadIdentityConditions` (the section that spells the seller predicate), module-private (not exported):

```ts
/**
 * The board read's WHERE minus the column: the org, live leads only, and the
 * seller rule. `listLeads` and `summarizeLeadStages` both start from it, so a
 * column's `total` and the summary's `count` can never be computed over two
 * different sets.
 *
 * The `else if` is the whole seller-scoping rule: for a non-admin the predicate
 * is built from the caller's OWN person id (plus the unassigned pool for an
 * active vendedor) and the requested `sellerPersonId` is never read AT ALL. A
 * seller who passes a colleague's id gets their own board back - not a 403, and
 * not the colleague's. For an admin it is an optional narrowing.
 */
function leadBoardConditions(
  orgId: string,
  gate: LeadScopeAllowed,
  requestedSellerPersonId: string | undefined,
): SQL[] {
  const conditions: SQL[] = [eq(salesOpsLeads.orgId, orgId), liveLeadCondition()];
  if (gate.sellerPersonId) {
    conditions.push(leadSellerCondition(gate.sellerPersonId, gate.canClaimUnassigned));
  } else if (requestedSellerPersonId) {
    conditions.push(eq(salesOpsLeads.sellerPersonId, requestedSellerPersonId));
  }
  return conditions;
}
```

2b. Refactor `listLeads` to use it, behaviour unchanged.
Replace the block that starts at `const conditions: SQL[] = [eq(salesOpsLeads.orgId, orgId)];` and ends with the seller `else if` (including whatever `liveLeadCondition()` push slice 01 added there, so it appears exactly once, inside the helper) with:

```ts
const conditions = leadBoardConditions(orgId, gate, query.sellerPersonId);
conditions.push(eq(salesOpsLeads.stageId, query.stageId));
```

Keep the existing comment sentence "The count below and the page share this one `conditions` array, so `total` counts exactly the rows a page can return." beside these two lines; the rest of the old `else if` comment now lives on the helper.
Everything after (count, cursor, page, products) stays byte-identical.

2c. The summary, placed directly after `listLeads`:

```ts
export type LeadStageTotals = { stageId: string; count: number; estimatedValueBrl: number };

export type LeadStageSummaryResult =
  | { ok: true; stages: LeadStageTotals[] }
  | { ok: false; reason: 'seller_person_unmapped' };

/**
 * The true per-column count and value for exactly the set the board may show,
 * in ONE grouped read: the board loads a column 50 cards at a time, so any total
 * computed from loaded cards undercounts a long column.
 *
 * Same gate and same WHERE as `listLeads` (`leadBoardConditions`), minus the
 * column: live leads only, converted and lost leads included because the board
 * lists them. Only stages with at least one visible lead appear; a missing stage
 * means zero. No stage join: the web keys each column by `stageId`.
 *
 * Money. `estimated_value_brl` is int4, NOT NULL, CHECK >= 0, so one lead is at
 * most 2_147_483_647 cents and `sum()` over int4 is int8 in Postgres. postgres.js
 * returns int8 as a string, hence `mapWith(Number)`. A stage total stays exact in
 * a JS number up to 2^53 - 1, which needs more than 4_194_304 leads in one stage
 * all at the int4 maximum; the guard below turns that unreachable case into a
 * loud error instead of a silently rounded total.
 */
export async function summarizeLeadStages(
  db: Db,
  orgId: string,
  query: LeadStageSummaryQuery,
  scope: LeadScope,
): Promise<LeadStageSummaryResult> {
  return withTenant(db, orgId, async (tx) => {
    const gate = await resolveLeadScopePredicate(tx, orgId, scope);
    if (!gate.ok) return { ok: false, reason: gate.reason } as const;

    const rows = await tx
      .select({
        stageId: salesOpsLeads.stageId,
        count: sql<number>`count(*)::int`,
        estimatedValueBrl: sql<string>`sum(${salesOpsLeads.estimatedValueBrl})::bigint`.mapWith(Number),
      })
      .from(salesOpsLeads)
      .where(and(...leadBoardConditions(orgId, gate, query.sellerPersonId)))
      .groupBy(salesOpsLeads.stageId)
      .orderBy(asc(salesOpsLeads.stageId));

    return {
      ok: true,
      stages: rows.map((row) => {
        if (!Number.isSafeInteger(row.estimatedValueBrl)) {
          throw new Error(`lead stage ${row.stageId} value total exceeds the exact integer range`);
        }
        return { stageId: row.stageId, count: row.count, estimatedValueBrl: row.estimatedValueBrl };
      }),
    } as const;
  });
}
```

Add `LeadStageSummaryQuery` to the existing `import type { ... } from './lead-schemas.js'` list.
No new drizzle import is needed (`and`, `asc`, `eq`, `sql`, `type SQL` are already imported); if TypeScript disagrees about `mapWith` typing, keep `sql<string>` and `.mapWith(Number)` exactly, which yields `SQL<number>`.

Do NOT mention the names of the sales summary/snapshot/financials functions anywhere in `lead-service.ts` (comments included): `lead-contract.test.ts` greps the file for them.

### 3. Route - `apps/api/src/domains/sales-ops/leads/lead-routes.ts`

Import `LeadStageSummaryQuerySchema` and `summarizeLeadStages`.
Register the handler ABOVE `leadsRouter.get('/:id', ...)`: put it immediately after slice 01's `GET /deleted` handler if that sits above `/:id`, otherwise immediately after the `leadsRouter.get('/', ...)` list handler.

```ts
/**
 * The board's per-column totals. Registered BEFORE '/:id' so the param route
 * never swallows the literal 'summary'. Every board caller reaches it (no
 * requireAdmin); the seller scoping is the service predicate, the same one the
 * list uses.
 */
leadsRouter.get('/summary', async (c) => {
  const parsed = LeadStageSummaryQuerySchema.safeParse({
    sellerPersonId: c.req.query('sellerPersonId'),
  });
  if (!parsed.success) return validationResponse(c, parsed.error);
  const result = await summarizeLeadStages(getDb(), c.get('orgId'), parsed.data, leadScope(c));
  if (!result.ok) return failureResponse(c, result.reason);
  return c.json({ stages: result.stages });
});
```

The org comes only from `c.get('orgId')`; no other query key is read.

### 4. Edition gate map - `apps/api/src/middleware/__tests__/edition-gate-map.test.ts`

The "gate map is exhaustive" test fails for any unclassified salesOps route.
Add to `OPEN`, beside the other `/leads` entries:

```ts
r('salesOps', 'GET', '/leads/summary', `${SO}/leads/summary`),
```

It is not under any `requireCapability` prefix (`/summary/*` is a root prefix and does not match `/leads/summary`), so a leads-edition owner and seller reach it.

## Tests

### A. NEW integration oracle - `apps/api/test/rls/leads-stage-summary.test.ts`

Harness: copy the shape of `apps/api/test/rls/leads-unassigned-claim.test.ts` exactly (imports, `testDatabaseUrls()`, `ADMIN_CONNECTION_OPTIONS`, `appClient`/`adminClient`/`adminDbClient`, `db` over the app role, `adminDb` over the admin connection where RLS hides nothing, `newOrg(label)` with prefix `org_lss_`, `vendedor(...)` binding a Hub account by raw UPDATE, `fullWorld(label)` with `ensureLeadStagesForOrg` returning `{ orgId, ana, bruno, open, second, conversion, lost }`, `ADMIN_SCOPE`, `sellerScope(userId)`, `okLead`).
`afterAll` uses the same delete list as that file, starting with `DELETE FROM audit_log WHERE actor_org_id = ${orgId}` (this file calls slice 01's `deleteLead`, which writes ledger rows), and keeps the comment that a tail delete of the ledger is safe only because the integration project runs with `fileParallelism: false`.

Header comment: org assertions are made over `adminDb` (where only the service's own org predicate scopes the read), seller assertions are load-bearing over either connection; this mirrors `leads-seller-scope.test.ts`.

Helpers (in the file):

- `fullLead(orgId, contactName, valueCents, sellerPersonId?)`: `createLead(db, orgId, CreateLeadSchema.parse({ contactName, clientName: 'Empresa Soma', estimatedValueBrl: valueCents, ...(sellerPersonId ? { sellerPersonId } : {}) }), ADMIN_SCOPE)` through `okLead`.
- `summary(orgId, scope, sellerPersonId?, conn = adminDb)`: calls `summarizeLeadStages(conn, orgId, LeadStageSummaryQuerySchema.parse(sellerPersonId ? { sellerPersonId } : {}), scope)`, throws on a refusal, returns `result.stages`.
- `byStage(stages)`: `Object.fromEntries(stages.map((s) => [s.stageId, { count: s.count, estimatedValueBrl: s.estimatedValueBrl }]))` (order-independent comparison).
- `listAll(orgId, stageId, scope, sellerPersonId?)`: walks `listLeads(adminDb, orgId, ListLeadsQuerySchema.parse({ stageId, limit: '200', cursor?, sellerPersonId? }), scope)` until `nextCursor` is null, returns `{ total, values: number[] }` (`total` from the first page).
- `expectedTotals(rows, keep)`: from a local bookkeeping array `Array<{ stageId: string; sellerPersonId: string | null; value: number }>` the test maintains as it creates and moves leads, returns the `byStage` shape for the rows where `keep(row)` is true, omitting stages with zero rows.
- `insertSale(orgId, code)`: the raw `INSERT INTO sales_ops_sales (...) RETURNING id` copied verbatim from `leads-unassigned-claim.test.ts` (the "converted unassigned lead" case), with the given code.

Cases (each a separate `it`, each its own `fullWorld`):

1. `admin: one entry per stage with a live lead, equal to the list total and the sum of every page, beyond the first page`.
   Create 55 leads in `open` with `value = 1000 + i` and seller rotating `i % 3`: 0 Ana, 1 Bruno, 2 unassigned.
   Move one unassigned lead to `conversion` with a sale from `insertSale` (ADMIN, `moveLead` with `saleId`), and one Bruno lead to `lost` with `reason: 'Sem orçamento'`; update the bookkeeping.
   `second` stays empty.
   Assert `byStage(await summary(orgId, ADMIN_SCOPE))` equals `expectedTotals(all, () => true)`; it has exactly 3 keys and no `second.id` key.
   For each of `open`, `second`, `conversion`, `lost`: `listAll(..., ADMIN_SCOPE)`; when `total` is 0 the stage has no entry, otherwise `count === total` and `estimatedValueBrl === sum(values)`.
   The default-page list of `open` (no `limit`) returns 50 leads while the summary `count` for `open` is 53.
   The same summary read over `db` (app role, RLS on) equals the one over `adminDb`.
   `stages.map((s) => s.stageId)` equals a copy sorted with plain `<` comparison (ordered by stage id).
   Every `count` and `estimatedValueBrl` is `typeof 'number'` and `Number.isInteger`.

2. `admin: ?sellerPersonId= narrows to that vendedor exactly as the list does`.
   Seed a handful of Ana, Bruno and unassigned leads across `open` and `second` (move some to `second`).
   `summary(orgId, ADMIN_SCOPE, ana.id)` equals `expectedTotals(rows, (r) => r.sellerPersonId === ana.id)`; unassigned and Bruno leads are absent.
   For each stage, it agrees with `listAll(orgId, stage, ADMIN_SCOPE, ana.id)`.
   Narrowing by a uuid with no leads (`randomUUID()`) returns `[]`.

3. `active vendedor: own plus the unassigned pool, never a colleague, and ?sellerPersonId= is ignored`.
   Same mix of leads.
   `summary(orgId, sellerScope('hub_ana'))` equals `expectedTotals(rows, (r) => r.sellerPersonId === ana.id || r.sellerPersonId === null)`, agrees per stage with `listAll(..., sellerScope('hub_ana'))`, and contains no Bruno value.
   `summary(orgId, sellerScope('hub_ana'), bruno.id)` toEqual `summary(orgId, sellerScope('hub_ana'))` (not a 403, not Bruno's totals).

4. `a non-admin who is not an active vendedor gets his own leads only, never the pool`.
   Leads: Ana own, Bruno own, unassigned.
   Deactivate Ana by raw SQL (`UPDATE sales_ops_people SET status = 'inactive' ...`, with the comment that `updatePerson` with a status change writes ledger rows).
   `summary(orgId, sellerScope('hub_ana'))` equals Ana's own rows only.
   A finder-only pessoa (`createPerson(db, orgId, PersonSchema.parse({ displayName: 'Fabio Finder', isFinder: true }))`, bound to `hub_fabio` by raw UPDATE) gets `[]`, also when passing `sellerPersonId: bruno.id`.

5. `soft-deleted leads leave the count and the value, and an emptied stage leaves the summary`.
   Leads: `open` Ana 1000, unassigned 2000, Bruno 4000; one Ana lead 8000 moved to `second`.
   Delete the unassigned `open` lead and the `second` lead with slice 01's `deleteLead(db, orgId, id, ADMIN_SCOPE, { userId: 'hub_admin', name: 'Admin' })`.
   Prove the deletes happened independently of the service's return shape: `SELECT deleted_at FROM sales_ops_leads WHERE id = ...` is not null for both.
   Admin summary: `open` is `{ count: 2, estimatedValueBrl: 5000 }` and there is no `second` entry.
   Ana's summary: `open` is `{ count: 1, estimatedValueBrl: 1000 }` and there is no `second` entry.
   `listAll(open, ADMIN_SCOPE).total` is 2 (the list agrees).

6. `the org predicate scopes the summary over the admin connection where RLS hides nothing`.
   Two worlds A and B with different leads and values.
   Over `adminDb`: A's summary keys are a subset of A's stage ids and equal A's expected totals; B's likewise; neither contains a key of the other.

7. `an org with no leads, and an org with no etapas, answer []`.
   `fullWorld` with no leads: admin `[]`, Ana `[]`.
   A bare `newOrg` with no `ensureLeadStagesForOrg`: admin `[]`.

8. `a caller with no mapped pessoa is refused exactly like the list`.
   `summarizeLeadStages(db, orgId, {}, sellerScope('hub_nobody'))` toEqual `{ ok: false, reason: 'seller_person_unmapped' }`, and `listLeads` for the same scope returns the same `{ ok: false, reason }`.

9. `a stage total above the int4 range is an exact JS number`.
   Three `open` leads at `2_000_000_000` cents each.
   Over `db`: the `open` entry is `{ count: 3, estimatedValueBrl: 6_000_000_000 }`, `typeof` is `'number'`, `Number.isSafeInteger` is true.

### B. Route unit tests - `apps/api/src/domains/sales-ops/leads/__tests__/lead-routes.test.ts`

- Add `summarizeLeadStages: vi.fn()` to the hoisted `serviceMocks` object.
- In `beforeEach`: `serviceMocks.summarizeLeadStages.mockResolvedValue({ ok: true, stages: [{ stageId: STAGE_ID, count: 2, estimatedValueBrl: 350000 }] })`.
- `it('serves GET /leads/summary with the verified org and the list scope, never through /:id')`: request `/leads/summary?orgId=query-org-must-not-be-used`; 200; body toEqual `{ stages: [{ stageId: STAGE_ID, count: 2, estimatedValueBrl: 350000 }] }`; `calls[0][1]` is `'verified-org'`; `calls[0][2]` toEqual `{}`; `calls[0][3]` toEqual `{ userId: 'verified-account', email: 'ana@example.test', isAdmin: true, name: null, hasSellerRole: true, edition: 'full' }`; `serviceMocks.getLead` not called.
- `it('parses sellerPersonId with the list rule and 400s a malformed one')`: `/leads/summary?sellerPersonId=${SALE_ID}` passes `{ sellerPersonId: SALE_ID }`; `/leads/summary?sellerPersonId=not-a-uuid` is 400 with `error: 'validation_error'`; the service was called exactly once overall.
- `it('answers seller_person_unmapped on the summary exactly like the list')`: mock `{ ok: false, reason: 'seller_person_unmapped' }`; 403 with body toEqual `{ error: 'forbidden', reason: 'seller_person_unmapped' }`.
- Add `'/leads/summary'` to the path list of the existing "exposes no DELETE verb" test as it stands after slice 01.

### C. Edition gate map

Section 4 above; the existing exhaustive and leads-edition cases then cover the new route.

## Commands (run-once only, from `apps/api`)

Fresh worktree first, from the worktree root: `pnpm install --frozen-lockfile && pnpm run build:packages`; `apps/api/.env` copied read-only from the main checkout.

Red first: write A and B, run them, see them fail on the missing export/route, then implement.

```bash
VITEST_INTEGRATION=1 pnpm exec vitest run test/rls/leads-stage-summary.test.ts
pnpm exec vitest run src/domains/sales-ops/leads/__tests__/lead-routes.test.ts src/domains/sales-ops/leads/__tests__/lead-contract.test.ts src/middleware/__tests__/edition-gate-map.test.ts
```

Regression for the `listLeads` refactor (must stay green, unchanged):

```bash
VITEST_INTEGRATION=1 pnpm exec vitest run test/rls/leads-seller-scope.test.ts test/rls/leads-unassigned-claim.test.ts test/rls/leads-edition.test.ts test/rls/leads-move-concurrency.test.ts test/rls/leads-rls.test.ts
```

Static checks:

```bash
pnpm exec eslint src/domains/sales-ops/leads/lead-schemas.ts src/domains/sales-ops/leads/lead-service.ts src/domains/sales-ops/leads/lead-routes.ts src/domains/sales-ops/leads/__tests__/lead-routes.test.ts src/middleware/__tests__/edition-gate-map.test.ts
pnpm run type-check
```

`type-check` covers `test/**` through `tsconfig.test.json`, which is what checks the new integration file (ESLint does not lint `test/`).

## Out of scope

- Any web code (slice 05 consumes this endpoint; it must send `sellerPersonId` only when present, as `api.ts` already does for the list, because an empty string is a 400 here exactly as on the list).
- CLAUDE.md and `nexo/knowledge` (feature capture, AC12).
- No migration, no index: the GROUP BY reads the existing `(org_id, stage_id, position)` index's leading columns, and a column set this size needs nothing more.

## Rules to respect

- No `DELETE` verb; no `requireAdmin` on this route; no `getAdminDb` and no audit write in `lead-service.ts`.
- The read touches `sales_ops_leads` only (no join to sales tables), so the CLAUDE.md rule "Leads never enter `/bootstrap`, summaries, the dashboard" (the SALES summary) still holds; this endpoint is a lead-only aggregate.
- Never trust an org, account or seller id from the request beyond the admin-only `sellerPersonId` narrowing.
- Never use the em dash character; Conventional Commit; no Co-Authored-By trailer.
