---
id: 03-api-leads
milestone: v4.1.0
status: done
depends_on: [02-api-stage-cadastro]
files_modified:
  - apps/api/src/db/schema.ts
  - apps/api/drizzle/0023_lead_seller_identity.sql
  - apps/api/drizzle/meta/_journal.json
  - apps/api/src/domains/sales-ops/service.ts
  - apps/api/src/domains/sales-ops/routes.ts
  - apps/api/src/domains/sales-ops/leads/with-tenant.ts
  - apps/api/src/domains/sales-ops/leads/stage-service.ts
  - apps/api/src/domains/sales-ops/leads/lead-schemas.ts
  - apps/api/src/domains/sales-ops/leads/lead-service.ts
  - apps/api/src/domains/sales-ops/leads/lead-routes.ts
  - apps/api/src/domains/sales-ops/leads/__tests__/lead-contract.test.ts
  - apps/api/src/domains/sales-ops/leads/__tests__/lead-routes.test.ts
  - apps/api/test/rls/leads-seller-scope.test.ts
  - apps/api/test/rls/leads-no-financial-impact.test.ts
acceptance: "Given an org with lead stages seeded by slice 01/02, when an operator creates, lists, edits and moves leads through GET/POST /api/v1/sales-ops/leads, PATCH /leads/:id and POST /leads/:id/move, then leads are persisted in sales_ops_leads + sales_ops_lead_products only — sales_ops_sales, the proposta sequence, sales_ops_clients, audit_log, getSalesOpsSummary and getSalesOpsSnapshot are all byte-unmoved — stage_changed_at advances only on a real stage change, a move into the terminal 'lost' stage without a reason is 400 {error:'validation_error',reason:'lost_reason_required'}, a move into the conversion stage without an in-org saleId is 400 {error:'validation_error',reason:'sale_required_for_conversion'}, and a caller holding only 'seller' is served only their own leads by a predicate applied on the server inside withTenant."
goal: The lead entity's server half — CRUD with a full-set-replacement product child table, a cursor-paginated per-column list of its own, a move endpoint that owns stage_changed_at and position, and server-side seller scoping.
must_not_break:
  - SALE_TRANSITIONS / EXPECTED_MATRIX byte-unaltered (apps/api/src/domains/sales-ops/service.ts + __tests__/sale-transitions.test.ts).
  - salesOpsRouter still exposes NO DELETE verb.
  - getSalesOpsSnapshot / getSalesOpsSummary payloads byte-identical before and after leads exist — leads never travel on /bootstrap.
  - computeSaleFinancials and every persisted sale number unchanged.
  - Existing routes.test.ts / transition-routes.test.ts / service.test.ts stay green; the only edit to service.ts is adding `export` to `withTenant` and one optional key to PersonFieldsSchema.
  - Slice 02's lead-stage oracles (test/rls/lead-stages-rls.test.ts, __tests__/lead-stages-routes.test.ts) stay green across the withTenant collapse.
  - audit_log row count unchanged across every lead write, movement included.
  - createPerson / updatePerson keep their existing behaviour with no hubAccountId in the body.
rules:
  - Every lead query filters by eq(table.orgId, c.get('orgId')) and that predicate is the conditions array's FIRST element.
  - org_id / user_id / person_id / workspace_id are NEVER read from a request body; the caller's identity comes only from c.get('userId') and c.get('userRoles').
  - No DELETE verb. No audit_log write anywhere in leads/.
  - Nothing in leads/ may import getAdminDb, getSalesOpsSnapshot, getSalesOpsSummary or computeSaleFinancials.
  - Money is integer CENTS (`money` = z.number().int().nonnegative()).
  - Sentinel 400s use the repo's exact existing shape { error: 'validation_error', reason: '<code>' } (+ itemIndex for array rows); zod failures use { error: 'validation_error', issues: parsed.error.flatten() }.
verifier_focus: "That stage_changed_at is written by KEY OMISSION rather than by a conditional value (a same-stage reorder must be unable to touch it at all); that the seller predicate lives inside withTenant and not at the route; that the list endpoint's org predicate is proven load-bearing over an app.fxl_admin connection; and that creating leads leaves getSalesOpsSnapshot/getSalesOpsSummary deep-equal."
---

# 03-api-leads — the lead entity's API

## 0. Dependency contract on slices 01 / 02 (RECONCILED)

This plan was drafted before `01-leads-schema` committed and has been **reconciled against
`nexo/plans/feature-20260918-kanban-pipeline-leads/01-leads-schema.md` as written**. The names
below are 01's names. Still read `apps/api/src/db/schema.ts` before you start — if 01's executor
diverged from 01's plan, follow the code.

`sales_ops_lead_stages` (`salesOpsLeadStages`): `id`, `org_id`, `name`, **`kind` text not null
default `'normal'` — the values are `'normal' | 'conversion' | 'lost'`**, `is_system` boolean,
`position` integer not null default 0, `status`, `archived_at`, `created_at`, `updated_at`.
Constraints this slice relies on: `sales_ops_lead_stages_org_kind_idx` (UNIQUE `(org_id, kind)
WHERE kind <> 'normal'`) — so "the conversion stage" and "the Perdido stage" are each AT MOST ONE
per org and may be looked up by `kind` alone — and
`sales_ops_lead_stages_system_kind_check` (`(kind <> 'normal') = is_system`). **There is no `slug`
column**; `kind` is the machine key.

`sales_ops_leads` (`salesOpsLeads`): `id`, `org_id`, `contact_name` (not null), **`client_id`
(nullable) + `client_name_snapshot` (text NOT NULL) — the snapshot IS the free-text empresa
fallback**, `estimated_value_brl` (integer not null default 0), `description` (nullable),
**`seller_person_id` (NULLABLE) + `seller_name_snapshot` (text NOT NULL default `''`)**,
`stage_id` (not null), `stage_changed_at` (timestamptz not null default now()), `position`
(integer not null default 0), `lost_reason` (nullable), `sale_id` (nullable), `created_at`,
`updated_at`.

01 already ships the two constraints this slice would otherwise have had to add: the partial
UNIQUE `sales_ops_leads_org_sale_idx` on `(org_id, sale_id) WHERE sale_id IS NOT NULL` (one lead
per proposta) and the composite FK `sales_ops_leads_org_sale_fk` to `sales_ops_sales(org_id, id)`
ON DELETE RESTRICT (a cross-org `saleId` is a database error, not merely a service check). **Do not
re-add either.** The service check in §3.8 exists only to turn that 23503 into the designed 400.

01 also records, in the migration header, that **"Perdido requires a reason" is deliberately NOT a
CHECK** — it needs a join to `sales_ops_lead_stages`, which a CHECK may not contain — and that
enforcing it is THIS slice's job. Same for `stage_changed_at`: 01 writes no trigger and states the
rule is a service-layer rule owned here.

`sales_ops_lead_products` (`salesOpsLeadProducts`): `id`, `org_id`, `lead_id` (not null),
`product_id` (**nullable**), `product_name_snapshot` (text not null), `created_at`. The
`(org_id, lead_id)` FK is the one ON DELETE CASCADE edge in the feature (an item's own
configuration, not shared history); the `(org_id, product_id)` FK is RESTRICT.

Slice 02 owns the stage cadastro endpoints inside `apps/api/src/domains/sales-ops/leads/`. Every
file this slice creates is `lead-`-prefixed (`lead-schemas.ts`, `lead-service.ts`,
`lead-routes.ts`) precisely so it cannot collide with whatever 02 named its stage files.

## 1. Two small edits outside `leads/`

### 1.1 `withTenant` — collapse the copy slice 02 introduced

Slice 02's plan declares a THIRD `withTenant` local to `leads/stage-service.ts` (its §, around
line 116 of its plan), because 02 is forbidden from editing `service.ts`. This slice is not, and
by the time it runs 02 is merged, so collapse them rather than adding a fourth:

1. `apps/api/src/domains/sales-ops/service.ts:1303` — change `async function withTenant<T>(...)`
   to `export async function withTenant<T>(...)`. **Nothing else inside that function changes**,
   so no existing test can see the difference.
2. Create `apps/api/src/domains/sales-ops/leads/with-tenant.ts` containing only
   `export { withTenant } from '../service.js';` — one module for the whole `leads/` directory to
   import, so nothing under `leads/` reaches into the 2800-line service file directly.
3. In `apps/api/src/domains/sales-ops/leads/stage-service.ts`, DELETE the local declaration and
   import from `./with-tenant.js`. Verify slice 02's own oracles
   (`apps/api/test/rls/lead-stages-rls.test.ts`,
   `apps/api/src/domains/sales-ops/__tests__/lead-stages-routes.test.ts`) stay green — they are in
   §7's command list for exactly this.

`setTenantContext` must be the transaction body's FIRST statement (`apps/api/src/middleware/auth.ts:15`),
and a transaction-local `set_config` is invisible outside its transaction. Three hand-maintained
copies of that rule is three places for it to rot, and the failure mode is silent: RLS matches
nothing and the query returns zero rows rather than raising.

If slice 02's executor already exported it or already imported from `service.ts`, steps 2 and 3
reduce to whatever is left.

### 1.2 `apps/api/src/domains/sales-ops/service.ts` — `hubAccountId` on a pessoa

Add to `PersonFieldsSchema` (the plain `z.object` the PATCH schema `.partial()`s):

```ts
  /**
   * The Hub account id this pessoa IS, or null. This is the ONLY join from a
   * verified token to a cadastro row, and the leads board's seller scoping is
   * built on it. Admin-writable through PATCH /people/:id, and self-claimed
   * once by leads/lead-service.ts#resolveCallerPersonId - see there for why a
   * token claiming its OWN verified e-mail is not the third-party name guess
   * CLAUDE.md rejects for the audit ledger.
   */
  hubAccountId: z.string().trim().min(1).max(255).nullish(),
```

`createPerson` / `updatePerson` already spread `data` into the insert/update `set`, so no further
change is needed there.

### 1.3 `apps/api/src/db/schema.ts`

Add to `salesOpsPeople` (after `contactEmail`):

```ts
    hubAccountId: text('hub_account_id'),
```

and to its index array:

```ts
    uniqueIndex('sales_ops_people_org_hub_account_idx')
      .on(t.orgId, t.hubAccountId)
      .where(sql`hub_account_id IS NOT NULL`),
```

(`sql` is already imported in schema.ts; if it is not, add it from `drizzle-orm`.)

### 1.4 Migration `apps/api/drizzle/0023_lead_seller_identity.sql`

Take the next free integer after the highest file present when you execute (01 and 02 land first;
if they took `0022`, you are `0023` — if they took more, shift). Regenerate `meta/_journal.json`
with `pnpm --filter @fxl-sales/api db:generate` rather than hand-editing it, then verify the
generated SQL matches the body below and replace it if drizzle-kit produced something else.

```sql
ALTER TABLE "sales_ops_people" ADD COLUMN "hub_account_id" text;--> statement-breakpoint
-- PARTIAL unique: one Hub account is at most one pessoa per org, and the many
-- pessoas who are not Hub accounts at all stay NULL. Same reason and same shape
-- as finders.account_id, which is unique-with-NULLs for exactly this.
CREATE UNIQUE INDEX "sales_ops_people_org_hub_account_idx"
  ON "sales_ops_people" USING btree ("org_id","hub_account_id")
  WHERE "hub_account_id" IS NOT NULL;
```

No backfill. A NULL here means "not yet claimed", which the scope resolver handles explicitly.

## 2. `apps/api/src/domains/sales-ops/leads/lead-schemas.ts`

```ts
import { z } from 'zod';

const uuid = z.string().uuid();
const money = z.number().int().nonnegative();

export const LEADS_DEFAULT_LIMIT = 50;
export const LEADS_MAX_LIMIT = 200;

export const LeadProductSchema = z.object({
  productId: uuid.optional(),
  /** The description for a productId-less row. Ignored when productId resolves. */
  productName: z.string().trim().min(1).max(140).optional(),
}).superRefine((row, ctx) => {
  if (!row.productId && !row.productName) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['productName'],
      message: 'productName is required when productId is absent' });
  }
});

const LeadFieldsSchema = z.object({
  contactName: z.string().trim().min(1).max(140),
  clientId: uuid.nullish(),
  /**
   * The empresa as free text. Maps to the NOT NULL `client_name_snapshot`, and
   * is the fallback when `clientId` is absent. When `clientId` DOES resolve,
   * the snapshot is overwritten from the cadastro row and this is discarded.
   */
  clientName: z.string().trim().min(1).max(200),
  estimatedValueBrl: money.default(0),
  description: z.string().max(4000).nullish(),
  /** NULLABLE in the schema: a lead may sit unassigned, and an unassigned lead
   *  is then visible to admins only, which is the correct answer. */
  sellerPersonId: uuid.nullish(),
  products: z.array(LeadProductSchema).max(50).default([]),
});

export const CreateLeadSchema = LeadFieldsSchema.strict();
export const UpdateLeadSchema = LeadFieldsSchema.partial().strict();

export const MoveLeadSchema = z.object({
  stageId: uuid,
  /** 0-based target INDEX in the destination column, clamped to its length. */
  position: z.number().int().min(0).max(100_000),
  reason: z.string().trim().min(1).max(500).optional(),
  saleId: uuid.optional(),
}).strict();

const CURSOR_RE =
  /^\d{1,9}:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const ListLeadsQuerySchema = z.object({
  stageId: uuid,
  limit: z.coerce.number().int().min(1).max(LEADS_MAX_LIMIT).optional(),
  cursor: z.string().regex(CURSOR_RE).optional(),
  sellerPersonId: uuid.optional(),
});
```

### Why `.strict()` (a deliberate deviation from the rest of the domain)

Everything else in this domain lets zod strip unknown keys. `CLAUDE.md` records what that costs:
`PATCH /clients/:id {"status":"archived"}` answers `200` with an unchanged row — "a silent no-op
that reads as success". The identical trap here would be a `PATCH /leads/:id` carrying `stageId`,
`position`, `saleId` or `lostReason`: it would answer `200`, the card would snap back, and nothing
would say why. `.strict()` makes those four a loud `400` with the offending key named in
`issues.fieldErrors`. That is also the STRUCTURAL guarantee that `stage_id` has exactly one writer
— there is no code path from `PATCH /leads/:id` to the stage column, so "stage_changed_at only
changes when the stage changes" is not a runtime branch anyone can forget.

`CreateLeadSchema` is strict for the same reason and takes **no `stageId` and no `saleId`**: a new
lead always lands in the first active `kind = 'normal'` stage by `position`. A card that is converted
or lost the instant it is born is therefore not expressible, rather than merely rejected.

## 3. `apps/api/src/domains/sales-ops/leads/lead-service.ts`

Imports: `and, asc, eq, sql` from `drizzle-orm`; `salesOpsLeads, salesOpsLeadProducts,
salesOpsLeadStages, salesOpsPeople, salesOpsPersonFuncoes, salesOpsFuncoes, salesOpsProducts,
salesOpsSales` from `../../../db/schema.js`; `withTenant` from `./with-tenant.js`; the schemas above.

**It must NOT import** `writeAuditEntry`, `auditLog`, `getAdminDb`, `salesOpsClients`,
`getSalesOpsSnapshot`, `getSalesOpsSummary` or `computeSaleFinancials`. Four of those are pinned
by a source-read test (§6.1).

```ts
type Db = ReturnType<typeof import('../../../db/client.js').getDb>;

/** The caller, built at the route boundary from the VERIFIED context only. */
export type LeadScope = { userId: string; email: string | null; isAdmin: boolean };

export class LeadInputError extends Error {
  constructor(
    readonly code:
      | 'seller_not_found'
      | 'seller_not_a_vendedor'
      | 'client_not_found'
      | 'product_not_found'
      | 'stage_not_found'
      | 'lost_reason_required'
      | 'sale_required_for_conversion'
      | 'sale_not_found'
      | 'sale_not_allowed'
      | 'no_open_stage',
    /** The offending `products[]` index, or -1 when the error names no array row. */
    readonly itemIndex: number = -1,
  ) { super(code); this.name = 'LeadInputError'; }
}
```

Shape and `itemIndex: -1` convention are copied verbatim from `SaleInputError`
(`service.ts:690`), so `lead-routes.ts` can map it onto the byte-identical 400 body
`routes.ts` already returns for `SaleInputError`.

### 3.1 `resolveCallerPersonId(tx, orgId, scope): Promise<string | null>`

Runs INSIDE the caller's `withTenant` transaction.

1. `SELECT id FROM sales_ops_people WHERE org_id = $orgId AND hub_account_id = $scope.userId LIMIT 1`.
   Found ⇒ return it.
2. Self-claim, and only self-claim. If `scope.email` is a non-empty string, select the ACTIVE
   pessoas in-org whose `lower(btrim(contact_email))` equals `lower(scope.email.trim())` **and**
   whose `hub_account_id IS NULL`. If and only if EXACTLY ONE row comes back, run
   `UPDATE sales_ops_people SET hub_account_id = $userId, updated_at = now() WHERE org_id = $orgId
   AND id = $row.id AND hub_account_id IS NULL RETURNING id`. If it returns a row, return that id;
   if it returns none (a concurrent claim won), re-run step 1 and return whatever it finds.
3. Otherwise `null`.

Why this is not the person-matching `CLAUDE.md` rejects: the ledger's rejected heuristic guesses a
THIRD PARTY's identity from unverified text, and getting it wrong misattributes an audit entry
forever. Here the e-mail comes from the caller's own VERIFIED Hub token, the claim is of the
caller's OWN row, "exactly one candidate" is required, and the `hub_account_id IS NULL` predicate
plus the partial unique index make a second claim impossible. The explicit admin repair path is
`PATCH /people/:id {hubAccountId}` (§1.2). Both exist; neither is a fallback for the other.

**Known gap, record it in `nexo/ROADMAP.md`:** no web control writes `hubAccountId` yet, so an org
whose sellers' `contact_email` does not match their Hub login must wait for an admin to PATCH it.
Until then those callers get the 403 below — which is a refusal, never an unscoped read.

### 3.2 `resolveLeadScopePredicate(tx, orgId, scope)`

Returns `{ ok: true, sellerPersonId: string | null }` or `{ ok: false, reason: 'seller_person_unmapped' }`.

- `scope.isAdmin` ⇒ `{ ok: true, sellerPersonId: null }` (no seller predicate).
- otherwise ⇒ `resolveCallerPersonId`; a string ⇒ `{ ok: true, sellerPersonId: it }`; `null` ⇒
  `{ ok: false, reason: 'seller_person_unmapped' }`.

**Fails CLOSED.** An unresolvable caller must never degrade into "no predicate". That is the one
mutation that turns this whole slice into a data leak, and it is the reason this returns a
discriminated union rather than `string | null` — `null` would mean two opposite things.

### 3.3 `resolveSellerPersonId(tx, orgId, sellerPersonId)`

`SELECT p.id FROM sales_ops_people p JOIN sales_ops_person_funcoes pf ON pf.org_id = p.org_id AND
pf.person_id = p.id JOIN sales_ops_funcoes f ON f.org_id = pf.org_id AND f.id = pf.funcao_id WHERE
p.org_id = $orgId AND p.id = $sellerPersonId AND p.status = 'active' AND f.slug = 'vendedor' AND
f.is_system = true LIMIT 1`.

It selects `p.id, p.display_name`. No row and no such pessoa at all ⇒ throw
`LeadInputError('seller_not_found')`. The pessoa exists
in-org but carries no `vendedor` assignment ⇒ throw `LeadInputError('seller_not_a_vendedor')`
(run the plain pessoa lookup to tell the two apart). The returned `display_name` is what gets
written to `seller_name_snapshot` — server-authoritative, never a body label, exactly as
`resolvePartyContexts` makes `personNameSnapshot` server-authoritative. A NULL `sellerPersonId`
writes `seller_name_snapshot: ''`, which is the column's default and its documented
"unassigned" spelling. **`sales_ops_people.is_seller` is never
read** — it is a deprecated derived mirror, and `person_funcoes` against the system função is the
one authority (`CLAUDE.md`, "Pessoas e Funções"). Pinned by a source-read assertion (§6.1).

### 3.4 `replaceLeadProducts(tx, orgId, leadId, rows)`

Full-set replacement, exactly the `replacePersonFuncoes` / `updateSale` shape:

```ts
await tx.delete(salesOpsLeadProducts)
  .where(and(eq(salesOpsLeadProducts.orgId, orgId), eq(salesOpsLeadProducts.leadId, leadId)));
if (resolved.length === 0) return;
await tx.insert(salesOpsLeadProducts).values(resolved.map((r) => ({ orgId, leadId, ...r })));
```

`resolved` comes from `resolveLeadProducts(tx, orgId, rows)`: for each row with a `productId`,
`SELECT id, name FROM sales_ops_products WHERE org_id = $orgId AND id = $productId` — absent ⇒
`throw new LeadInputError('product_not_found', index)` — and the snapshot is the resolved row's
`name`. A body-supplied `productName` on a row that resolves is DISCARDED: the snapshot is
server-authoritative, exactly as `resolvePartyContexts` makes `personNameSnapshot` server-
authoritative ("a disagreeing body label loses"). A row with no `productId` stores
`productId: null` and the body's `productName` as the snapshot, mirroring a free-form sale item.

Archived produtos resolve fine here: a lead may legitimately reference one, and hiding it belongs
to the picker, not the writer (`CLAUDE.md`, "Arquivamento e histórico").

### 3.5 `createLead(db, orgId, input, scope)`

```ts
return withTenant(db, orgId, async (tx) => {
```
1. `const gate = await resolveLeadScopePredicate(tx, orgId, scope);` — not ok ⇒ return
   `{ ok: false, reason: 'seller_person_unmapped' } as const`.
2. Non-admin whose `gate.sellerPersonId !== input.sellerPersonId` ⇒ return
   `{ ok: false, reason: 'seller_scope' } as const`. (A seller may only file their own leads, and
   may not file an UNASSIGNED one either — `null !== gate.sellerPersonId` catches that. Not a
   leak, since they named the id themselves, so this is a loud 403 and not a 404.)
3. `input.sellerPersonId` non-null ⇒ `const seller = await resolveSellerPersonId(tx, orgId,
   input.sellerPersonId)`; null ⇒ `const seller = null` and the snapshot is `''`.
4. `input.clientId` present ⇒ `SELECT id FROM sales_ops_clients ...` — **NO.** Do not import
   `salesOpsClients`. Validate it with a raw `sql` existence probe instead:
   `sql\`SELECT name FROM sales_ops_clients WHERE org_id = ${orgId} AND id = ${input.clientId}::uuid LIMIT 1\``
   through `tx.execute`; empty ⇒ `throw new LeadInputError('client_not_found')`. The returned name
   becomes `client_name_snapshot` (server-authoritative; a disagreeing body `clientName` loses). The import ban is
   what a reader (and the source-read test) uses to see at a glance that this file cannot CREATE a
   cliente. Creating one is slice 08's job, at conversion time and not before (acceptance 12).
5. Destination stage:
   `SELECT id FROM sales_ops_lead_stages WHERE org_id = $orgId AND status = 'active'
   AND kind = 'normal' ORDER BY "position" ASC, name ASC LIMIT 1`; none ⇒
   `throw new LeadInputError('no_open_stage')`. (`"position"` is double-quoted in every
   hand-written SQL string — 01's house rule, because `position` is a reserved word in some
   dialects; the tiebreaker is `name`, matching 01's stated `(position, name)` read order.)
6. `const [{ next }] = await tx.select({ next: sql<number>\`COALESCE(MAX(${salesOpsLeads.position}), 0) + 1\` })
   .from(salesOpsLeads).where(and(eq(salesOpsLeads.orgId, orgId), eq(salesOpsLeads.stageId, stage.id)));`
   — a new lead lands at the END of column 1.
7. INSERT with `orgId`, `stageId: stage.id`, `position: next`, `contactName`,
   `clientId: input.clientId ?? null`, `clientNameSnapshot: resolvedClient?.name ?? input.clientName`,
   `estimatedValueBrl`, `description`, `sellerPersonId: seller?.id ?? null`,
   `sellerNameSnapshot: seller?.displayName ?? ''`, `saleId: null`, `lostReason: null`. `stage_changed_at` takes its column default (`now()`), so
   "days parked" starts at 0 with no app-clock write.
8. `await replaceLeadProducts(tx, orgId, lead.id, input.products)`.
9. `return { ok: true, lead: await readLeadView(tx, orgId, lead.id) } as const;`

**It touches `sales_ops_sales` not at all** — no `MAX(sequence)` read, no `code_suffix` read, no
`code` construction. Nothing in this function imports `salesOpsSales`. Acceptance 1, structurally.

### 3.6 `getLead` / `updateLead`

`getLead(db, orgId, id, scope)`: `withTenant` ⇒ gate ⇒ select with
`and(eq(orgId), eq(id), gate.sellerPersonId ? eq(sellerPersonId, gate.sellerPersonId) : undefined)`
(pass through `and(...)`; drizzle drops `undefined`). No row ⇒ `not_found`. An out-of-scope lead
reads as `not_found` and never as `forbidden`: a 403 on a specific uuid confirms the row exists.

`updateLead(db, orgId, id, input, scope)`: `withTenant` ⇒ gate ⇒
`SELECT ... FOR UPDATE` with the same predicate ⇒ absent ⇒ `not_found`.
- `current.saleId !== null` ⇒ `{ ok: false, reason: 'already_converted' }` (409). A converted
  card's column is read-only (acceptance 13); its data now lives on the proposta.
- `input.sellerPersonId` present ⇒ `resolveSellerPersonId`, and a non-admin re-assigning it to
  anyone but themselves ⇒ `{ ok: false, reason: 'seller_scope' }`.
- `input.clientId` present and non-null ⇒ the same probe as §3.5 step 4, and the resolved name is
  written to `clientNameSnapshot`. `input.clientId === null` clears the link and writes
  `clientNameSnapshot: input.clientName ?? current.clientNameSnapshot` — the column is NOT NULL, so
  it can never be blanked. `input.clientName` alone (no `clientId` key) rewrites only the snapshot.
- `input.sellerPersonId` present ⇒ `sellerNameSnapshot` is rewritten from the resolved pessoa, or
  `''` when it is set to null.
- `UPDATE ... SET {...only the provided fields...}, updated_at = now()`. **The `set` object is
  built from `input` and can contain no `stageId`, `position`, `stageChangedAt`, `saleId` or
  `lostReason` key, because `UpdateLeadSchema` is `.strict()` and declares none of them.**
- `input.products !== undefined` ⇒ `replaceLeadProducts`. `undefined` leaves the child rows
  alone; `[]` clears them. (Same distinction `updateProduct` draws for `productFuncaoCosts`.)

### 3.7 `listLeads(db, orgId, query, scope)`

Returns `{ ok: true, leads: LeadView[], nextCursor: string | null, total: number }`.

```ts
const conditions: SQL[] = [eq(salesOpsLeads.orgId, orgId)];        // FIRST element, always
if (gate.sellerPersonId) conditions.push(eq(salesOpsLeads.sellerPersonId, gate.sellerPersonId));
else if (query.sellerPersonId) conditions.push(eq(salesOpsLeads.sellerPersonId, query.sellerPersonId));
conditions.push(eq(salesOpsLeads.stageId, query.stageId));
if (query.cursor) {
  const [pos, id] = query.cursor.split(':');
  conditions.push(sql`(${salesOpsLeads.position}, ${salesOpsLeads.id}) > (${Number(pos)}, ${id}::uuid)`);
}
```

The `else if` is load-bearing and is the whole seller-scoping rule in one line: for a non-admin
the predicate is the caller's OWN person id and `?sellerPersonId=` is **never read at all**. A
seller who passes a colleague's id gets their own leads back, not a 403 and not the colleague's —
which is also the decisive oracle (§6.3), because an implementation that merely "validates" the
query parameter passes a 403 test and fails this one.

Order: `.orderBy(asc(salesOpsLeads.position), asc(salesOpsLeads.id))`, `.limit(limit + 1)` with
`limit = query.limit ?? LEADS_DEFAULT_LIMIT`. `hasMore = rows.length > limit`; page is
`rows.slice(0, limit)`; `nextCursor = hasMore ? \`${last.position}:${last.id}\` : null`.
`total` is a `COUNT(*)` over the same conditions minus the cursor clause.

#### Pagination contract: CURSOR (keyset), per column, default 50, max 200

- **Cursor, not offset.** The one paginated read this repo already has —
  `listOrgAuditHistory` in `apps/api/src/domains/audit/history-service.ts` — is keyset: an
  exclusive bound (`lt(auditLog.id, cursor)`), a `limit + 1` probe, and a
  `{ entries, nextCursor }` envelope. This slice copies that shape so the repo keeps one
  pagination idiom. It is also the only correct choice here: a kanban column is reordered
  constantly, and OFFSET over a set whose sort key is being rewritten silently skips and
  duplicates cards between pages.
- **The sort key is `(position, id)`, not `id`,** because `position` IS the ordering the operator
  set, and `id` is the tiebreaker that makes the key total (two rows can briefly share a position
  mid-renumber). The cursor is the literal pair, `"<position>:<uuid>"`, validated by regex at the
  route so a malformed one is a `400` and never a silently dropped filter.
- **`stageId` is REQUIRED.** A board loads one request per column, which is how a kanban board
  actually scrolls: each column paginates independently, "carregar mais" is per-column, and the
  cursor stays the simple pair above instead of a three-part `(stagePosition, position, id)`
  composite. It also caps the worst-case response at one column rather than the whole board.
- **`LEADS_DEFAULT_LIMIT = 50`, `LEADS_MAX_LIMIT = 200`** — the same two numbers as
  `HISTORY_DEFAULT_LIMIT` / `HISTORY_MAX_LIMIT`, for the same reason: one screenful with room to
  spare, and a ceiling that bounds the payload.

### 3.8 `moveLead(db, orgId, id, input, scope)` — the whole of stage_changed_at and position

`withTenant`, in this exact order:

1. gate (§3.2); not ok ⇒ `{ ok: false, reason: 'seller_person_unmapped' }`.
2. `SELECT * FROM sales_ops_leads WHERE org_id = $ AND id = $ [AND seller_person_id = $gate] LIMIT 1 FOR UPDATE`.
   Absent ⇒ `{ ok: false, reason: 'not_found' }`.
3. `current.saleId !== null` ⇒ `{ ok: false, reason: 'already_converted' }` → **409**. This is the
   read-only final column (acceptance 13): once a lead carries a proposta it can never be dragged
   anywhere, in or out. It is also what makes "no board action reaches
   `POST /sales/:id/transition`" true by construction — there is no lead operation left that could.
4. Destination: `SELECT id, kind FROM sales_ops_lead_stages WHERE org_id = $ AND id = $input.stageId
   AND status = 'active' LIMIT 1`. Absent ⇒ `throw new LeadInputError('stage_not_found')`. An
   ARCHIVED stage is not a move target.
5. `destination.kind === 'lost'` and `input.reason` absent ⇒
   `throw new LeadInputError('lost_reason_required')`. **Acceptance 6.** This cannot be a zod
   refine — the requirement depends on the destination row's `kind`, which is a database read — so
   it is the service-sentinel 400, which is the shape `routes.ts` already returns for
   `entrada_mode_value_mismatch` and for `unknown_funcao`.
6. `destination.kind === 'conversion'`:
   - `input.saleId` absent ⇒ `throw new LeadInputError('sale_required_for_conversion')`.
   - `SELECT id FROM sales_ops_sales WHERE org_id = $orgId AND id = $input.saleId LIMIT 1`; absent
     ⇒ `throw new LeadInputError('sale_not_found')`.
7. `destination.kind !== 'conversion'` and `input.saleId` present ⇒
   `throw new LeadInputError('sale_not_allowed')`.
   (Step 6's in-org SELECT is what produces the designed 400. The composite FK
   `sales_ops_leads_org_sale_fk` that 01 ships is the backstop underneath it: without the SELECT a
   cross-org id would surface as a raw 23503 and an HTTP 500. Both exist; neither replaces the
   other.)
8. `const stageChanged = destination.id !== current.stageId;`
9. The field write:

```ts
await tx.update(salesOpsLeads).set({
  stageId: destination.id,
  // KEY OMISSION, never `stageChanged ? now : current.stageChangedAt`. A
  // reorder inside one stage produces an UPDATE whose `set` object has no
  // stage_changed_at key at all, so the column is physically untouchable by a
  // reorder - the rule is not a branch someone can later "simplify".
  ...(stageChanged ? { stageChangedAt: new Date() } : {}),
  lostReason: destination.kind === 'lost' ? (input.reason ?? null) : null,
  ...(destination.kind === 'conversion' ? { saleId: input.saleId! } : {}),
  updatedAt: new Date(),
}).where(and(eq(salesOpsLeads.orgId, orgId), eq(salesOpsLeads.id, id)));
```

10. Renumber. For the destination stage — and, when `stageChanged`, the source stage too:
    - `SELECT id FROM sales_ops_leads WHERE org_id = $ AND stage_id = $ ORDER BY "position" ASC, id ASC FOR UPDATE`
      (the moved row is already in the destination by step 9, so one pass per stage covers it).
    - For the destination, remove the moved id from that array and splice it back in at
      `Math.min(input.position, array.length)` — front-clamped, so an out-of-range index parks the
      card at the end rather than failing.
    - Write dense `1..N` in ONE statement:
      ```ts
      await tx.execute(sql`
        UPDATE sales_ops_leads AS l SET "position" = v."position"
        FROM (SELECT * FROM unnest(${sql.raw('$ids')}::uuid[], ${sql.raw('$positions')}::int[])
              AS t(id, position)) AS v
        WHERE l.org_id = ${orgId} AND l.id = v.id AND l."position" IS DISTINCT FROM v."position"`);
      ```
      (bind the two arrays as parameters; `IS DISTINCT FROM` keeps the statement a no-op for rows
      that already sit right.)
11. `return { ok: true, lead: await readLeadView(tx, orgId, id) } as const;`

`FOR UPDATE` on the lead in step 2 and on the whole column in step 10, always in
`(position, id)` order, is what makes two concurrent drags of the same column serialize rather
than interleave into duplicate positions.

### 3.9 `readLeadView(tx, orgId, leadId)` / the `LeadView` shape

```ts
export type LeadView = {
  id: string; stageId: string; stageChangedAt: string; position: number;
  contactName: string; clientId: string | null; clientNameSnapshot: string;
  estimatedValueBrl: number; description: string | null;
  sellerPersonId: string | null; sellerNameSnapshot: string;
  saleId: string | null; saleStatus: string | null; lostReason: string | null;
  products: Array<{ productId: string | null; productNameSnapshot: string }>;
  createdAt: string; updatedAt: string | null;
};
```

`sellerNameSnapshot` and `clientNameSnapshot` are PROJECTED from the row, not re-joined: 01 made
both columns NOT NULL and this slice is their only writer, so a second live join would be a second
source of truth for the same label. Both are rewritten on every write that could change them
(§3.5, §3.6), which is what keeps them from going stale, and `sellerPersonId` travels beside the
snapshot so the web can still key on the id. Neither raw id is ever the user-facing label
(`CLAUDE.md`, "UI Identifiers"). `saleStatus` is read live from
`sales_ops_sales.status` for the read-only converted column (acceptance 13) and is `null` while
`saleId` is null. Timestamps are `.toISOString()` — never a `Date`, never a BigInt.

## 4. `apps/api/src/domains/sales-ops/leads/lead-routes.ts`

```ts
export const leadsRouter = new Hono();
```

One helper, used by every handler and by nothing else:

```ts
function leadScope(c: Context): LeadScope {
  return {
    userId: c.get('userId'),
    email: c.get('hubAuth')?.claims?.email ?? null,
    isAdmin: (c.get('userRoles') ?? []).includes('admin'),
  };
}
```

**How the admin/seller distinction is derived server-side.** `appAuthMiddleware`
(`apps/api/src/middleware/app-auth.ts:189`) sets `userRoles` from
`getAppRolesFromHubClaims(auth)`, which returns `['admin','seller','finder']` when the verified
token says `isSuperAdmin`, or `claims.roles.workspace` is `owner`/`admin`, or
`claims.roles.productRoles` contains `admin`; otherwise it returns only the product roles the
token actually carries. That is the same synthesis `requireAdmin` reads through `userRole`.
`requireAdmin` is deliberately **not** mounted on the leads routes — a seller must reach the board
— so the distinction is a boolean on the scope object instead, and the enforcement is the
predicate inside `withTenant`, never the middleware.

**There is no server-side way to know the caller's pessoa today**, and that is stated plainly:
`sales_ops_people` has no account-id column, `CLAUDE.md` records that "there is no join path from a
Hub account id to a pessoa", and the two tables that do carry `account_id` (`finders`, `sellers`)
are the legacy affiliate half, not the sales-ops cadastro. The mechanism this slice ADDS is
`sales_ops_people.hub_account_id` (§1.3/§1.4) plus `resolveCallerPersonId` (§3.1).

Routes (mounted under `/api/v1/sales-ops`):

| verb + path | guard | body/query | success |
|---|---|---|---|
| `GET /leads` | none beyond appAuth | `ListLeadsQuerySchema` | `200 {leads, nextCursor, total}` |
| `POST /leads` | none | `CreateLeadSchema` | `201 {lead}` |
| `GET /leads/:id` | none | — | `200 {lead}` |
| `PATCH /leads/:id` | none | `UpdateLeadSchema` | `200 {lead}` |
| `POST /leads/:id/move` | none | `MoveLeadSchema` | `200 {lead}` |

No DELETE. Every `:id` is `z.string().uuid()`-checked and a malformed one is `404 {error:'not_found'}`,
matching `saleIdSchema`'s existing handling.

Error mapping, byte-identical to what `routes.ts` already returns:

```ts
if (!parsed.success) return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
// ...
catch (error) {
  if (error instanceof LeadInputError) {
    return c.json({ error: 'validation_error', reason: error.code, itemIndex: error.itemIndex }, 400);
  }
  throw error;
}
if (!result.ok && result.reason === 'not_found')  return c.json({ error: 'not_found' }, 404);
if (!result.ok && result.reason === 'seller_scope')
  return c.json({ error: 'forbidden', reason: 'seller_scope' }, 403);
if (!result.ok && result.reason === 'seller_person_unmapped')
  return c.json({ error: 'forbidden', reason: 'seller_person_unmapped' }, 403);
if (!result.ok && result.reason === 'already_converted')
  return c.json({ error: 'conflict', reason: 'lead_already_converted' }, 409);
```

The 403 body matches `requireAdmin`'s `{ error: 'forbidden', reason: 'admin_role_required' }`; the
409 matches `{ error: 'conflict', reason: 'funcao_is_system' }`.

Mount, one line in `apps/api/src/domains/sales-ops/routes.ts`, beside the other sub-mounts:

```ts
import { leadsRouter } from './leads/lead-routes.js';
salesOpsRouter.route('/leads', leadsRouter);
```

(If slice 02 already added a `leads/` mount for stages at a different prefix, leave it alone and
add this one; the two prefixes are `/lead-stages` and `/leads` and do not overlap.)

## 5. The conversion rule, stated in full

**Rule: `sales_ops_leads.sale_id` has exactly ONE writer — step 6 of `moveLead` — and a move into
a `kind='conversion'` stage is refused unless the body carries a `saleId` that resolves in-org.**

That is what makes a stage-less, proposta-less converted card impossible, and it is enforced in
four independent places:

1. `CreateLeadSchema` is `.strict()` and declares neither `stageId` nor `saleId`, so a lead cannot
   be BORN in the conversion column.
2. `UpdateLeadSchema` is `.strict()` and declares neither, so `PATCH` cannot put one there.
3. `moveLead` step 6 refuses the conversion stage without a resolving `saleId`
   (`sale_required_for_conversion` / `sale_not_found`), and step 7 refuses a `saleId` aimed at any
   other stage (`sale_not_allowed`), so `sale_id` and "is in the conversion column" cannot diverge.
4. `moveLead` step 3 refuses EVERY move of a lead that already carries a `sale_id`
   (`409 lead_already_converted`), so the terminal column is read-only from the server's side too
   and not merely un-draggable in the UI.

Slice 08 therefore drives conversion as: `POST /sales` → `201` → `POST /leads/:id/move
{stageId: <conversion>, position, saleId: <the 201's sale.id>}`. Cancelling the wizard issues no
move, and there is no intermediate state to clean up, because the server was never told anything.

Rejected alternative: having `moveLead` CREATE the proposta itself. It would put a
`createSale` call — sequence read, `code_suffix`, receivables, payables — behind a drag gesture,
which is precisely the "arrastar um card nunca pode materializar payables" invariant, and it would
give the proposta wizard a second, headless writer.

## 6. Tests — named oracles, and the mutation each is decisive against

### 6.1 `apps/api/src/domains/sales-ops/leads/__tests__/lead-contract.test.ts` (unit)

Pure zod + source-read. No database, no mocks beyond `../../../../db/client.js`.

| test title | decisive against |
|---|---|
| `rejects a PATCH body carrying stageId, position, saleId or lostReason` | dropping `.strict()`, which would make every one of those a silent 200 no-op |
| `rejects a create body carrying stageId or saleId` | a lead born in the conversion or lost column |
| `rejects a cursor that is not <position>:<uuid>` | a cursor regex loosened into a silently-dropped filter |
| `caps limit at LEADS_MAX_LIMIT and defaults to 50` | an unbounded page |
| `lead-service.ts never reaches for the audit writer or the admin connection` | any `writeAuditEntry` / `auditLog` / `getAdminDb` creeping in — **acceptance 19**. `readFileSync(fileURLToPath(new URL('../lead-service.ts', import.meta.url)),'utf8')` then `expect(source).not.toMatch(/writeAuditEntry\|auditLog\|getAdminDb/)`. Exactly the pattern `history-route.test.ts:175` already uses. |
| `lead-service.ts resolves the vendedor through person_funcoes and never through is_seller` | the same source read asserting `/is_seller\|isSeller/` is absent and `/'vendedor'/` is present — **acceptance 4** |
| `lead-service.ts imports neither sales_ops_clients nor sales_ops_sales as a writer` | source read: `expect(source).not.toMatch(/salesOpsClients\|insert\(salesOpsSales/)` — **acceptance 1 and 12** |

### 6.2 `apps/api/src/domains/sales-ops/leads/__tests__/lead-routes.test.ts` (unit)

Same harness as `apps/api/src/domains/sales-ops/__tests__/routes.test.ts`: `vi.mock` the db client
and `../lead-service.js`, build a `Hono` app whose first middleware sets `userId`, `orgId`,
`userRole`, `userRoles` and `hubAuth` from the shared `hub-auth-context-fixture`.

| test title | decisive against |
|---|---|
| `passes the VERIFIED org and never an orgId from the body or the query` | reading `?orgId=` or `body.orgId` — assert the service mock's first arg is `'verified-org'` while the body carries `orgId:'body-org-must-not-be-used'` |
| `builds the scope from userRoles and the token e-mail, never from the body` | an `isAdmin` flag taken from the request |
| `answers a missing lost reason with {"error":"validation_error","reason":"lost_reason_required"} and 400` | any other body/status for acceptance 6 — assert the parsed JSON with `toEqual`, not `toMatchObject` |
| `answers a conversion move with no saleId with reason sale_required_for_conversion` | acceptance 11's server half |
| `answers a move on an already-converted lead with 409 lead_already_converted` | the read-only final column |
| `answers an out-of-scope lead with 404 and never 403` | an existence leak |
| `exposes no DELETE verb on any lead route` | a DELETE creeping in — `app.request('/leads/<uuid>',{method:'DELETE'})` must be 404 |

### 6.3 `apps/api/test/rls/leads-seller-scope.test.ts` (integration)

Written in the exact style of `apps/api/test/rls/sale-professional-funcoes.test.ts`: two
`postgres` clients, the ordinary app role plus one carrying
`{ connection: { 'app.fxl_admin': 'true' } }`, an `afterAll` that deletes in FK order
(`sales_ops_lead_products` → `sales_ops_leads` → `sales_ops_lead_stages` → the existing chain),
and org ids of the form `org_lsc_<label>_<ts>_<rand>`.

**That file's lesson, applied honestly.** Its warning is that a cross-tenant assertion made only
over the ordinary app connection passes even with `eq(table.orgId, orgId)` deleted, because RLS
satisfies it. That applies to the ORG predicate, and so every org assertion here is made over
`adminDb`, where the admin policy exposes every org and RLS can hide nothing. The SELLER predicate
is a different animal: no RLS policy has ever filtered by `seller_person_id`, so a seller assertion
is already load-bearing over the ordinary connection. Both are asserted, each over the connection
that can actually falsify it, and the comment in the file says so.

| test title | connection | decisive against |
|---|---|---|
| `serves a seller only their own leads, over the admin connection where RLS hides nothing` | `adminDb` | deleting either `eq(leads.orgId, orgId)` or the seller predicate in `listLeads` |
| `ignores a sellerPersonId query parameter for a non-admin caller` | `db` | an implementation that validates `?sellerPersonId=` instead of overriding it — this is the one that fails a "403 on mismatch" design and a "trust the query param" design alike |
| `serves an admin every lead in the org and honours the optional seller filter` | `db` | an over-broad scope that narrows admins too |
| `refuses a caller with no mapped pessoa with 403 seller_person_unmapped and returns no rows` | `db` | the fail-OPEN mutation: `resolveLeadScopePredicate` degrading into "no predicate" |
| `binds hub_account_id once from the verified token e-mail and never to a second pessoa` | `db` | a self-claim that matches 2+ candidates, or re-binds an already-claimed row |
| `never returns another org's lead, over the admin connection` | `adminDb` | a deleted org predicate on `getLead` / `moveLead` |
| `stage_changed_at is byte-identical after a reorder inside the same stage` | `db` | **the headline mutation**: `stageChangedAt: new Date()` written unconditionally, or `stageChanged ? now : current.stageChangedAt` (which round-trips through the app and loses microseconds) — assert `toEqual` on the raw `Date` before and after |
| `stage_changed_at advances when and only when stage_id actually changes` | `db` | the inverse mutation: omitting the write entirely |
| `a move into the lost stage without a reason throws lost_reason_required and writes nothing` | `db` | a reason requirement enforced only in the UI; assert the row's `stage_id` and `position` are unchanged after the throw |
| `a move into the conversion stage requires a saleId that resolves in-org` | `adminDb` | a `saleId` accepted without an org predicate — seed a sale in org B and aim it at a lead in org A |
| `creating a lead writes no sales_ops_sales row and consumes no sequence` | `db` | **acceptance 1** — snapshot `MAX(sequence)` and the sales row count before and after |
| `creating a lead writes no sales_ops_clients row` | `db` | **acceptance 12** |
| `moving a lead writes no audit_log row` | `db` | **acceptance 19** — `SELECT count(*) FROM audit_log` before and after a move |
| `replaces the lead product set wholesale and keeps the snapshot server-authoritative` | `db` | a merge instead of a replace, and a body-supplied `productName` overwriting a resolved produto's name |
| `writes client_name_snapshot and seller_name_snapshot from the cadastro rows, never from the body` | `db` | a body label winning over the resolved name — send `clientName: 'NAO USAR'` alongside a resolving `clientId` |
| `keeps an unassigned lead (seller_person_id NULL) out of every seller's board and on the admin's` | `db` | a seller predicate written as `IS NOT DISTINCT FROM`, which would show every seller every unassigned lead |

### 6.4 `apps/api/test/rls/leads-no-financial-impact.test.ts` (integration)

**Acceptance 17, its own file because it is its own claim.**

Seed one org with an área, a produto, a vendedor pessoa and one `won` sale through the real
`createSale`. Capture `before = { summary: await getSalesOpsSummary(db, orgId), snapshot: await
getSalesOpsSnapshot(db, orgId) }`. Create three leads through `createLead`, each with products and
a non-zero `estimatedValueBrl`, one of them moved into the lost stage with a reason. Re-read and:

| test title | decisive against |
|---|---|
| `creating leads moves no number in getSalesOpsSummary` | a summary that starts counting leads or their estimated value |
| `creating leads leaves getSalesOpsSnapshot deep-equal` | leads leaking onto `/bootstrap` — `expect(after.snapshot).toEqual(before.snapshot)` |
| `creating leads changes no persisted sale financial column` | any write to `total_brl` / `net_margin_brl` / `net_margin_pct` — re-select the sale row and `toEqual` the pre-image |

`toEqual` on the whole object and not a hand-picked field list: a field list is exactly what a
future `leads:` key on the snapshot would slip past.

## 7. Commands Verify runs

```bash
pnpm --filter @fxl-sales/api test src/domains/sales-ops/leads/__tests__/lead-contract.test.ts
pnpm --filter @fxl-sales/api test src/domains/sales-ops/leads/__tests__/lead-routes.test.ts
pnpm --filter @fxl-sales/api test src/domains/sales-ops/__tests__/sale-transitions.test.ts
pnpm --filter @fxl-sales/api test src/domains/sales-ops/__tests__/routes.test.ts
pnpm --filter @fxl-sales/api test src/domains/sales-ops/__tests__/lead-stages-routes.test.ts
pnpm --filter @fxl-sales/api test:integration test/rls/lead-stages-rls.test.ts
pnpm --filter @fxl-sales/api test:integration test/rls/leads-seller-scope.test.ts
pnpm --filter @fxl-sales/api test:integration test/rls/leads-no-financial-impact.test.ts
pnpm --filter @fxl-sales/api test:integration test/rls/sale-professional-funcoes.test.ts
pnpm --filter @fxl-sales/api exec eslint src/domains/sales-ops/leads src/domains/sales-ops/routes.ts src/domains/sales-ops/service.ts src/db/schema.ts
pnpm --filter @fxl-sales/api type-check
```

Every one is a run-once invocation. Never a bare `vitest`. `test:integration` requires the local
docker database (`make db-up`); `apps/api/test/rls/setup-env.ts` hard-overrides `DATABASE_URL` so
the suite cannot reach staging.

## 8. Deliberately left out, and why

- **Archiving or deleting a lead.** No acceptance criterion asks for it, and inventing a
  `status` column here would be a fifth cadastro lifecycle plus a fifth purge path. A lead that
  goes nowhere ends in the terminal `lost` stage, which is what that stage is for.
- **A board-wide list endpoint.** `stageId` is required (§3.7). A cross-column read would need a
  three-part cursor for no gain the board can use.
- **A `GET /leads/:id/history`.** Stage movement writes no ledger (acceptance 19), so there would
  be nothing to read.
- **`sales_ops_leads.seller_name_snapshot`.** A lead is not history; the name is joined live
  (§3.9). Add a snapshot only if a lead ever becomes immutable.
- **Anything in `apps/web`.** Slices 04–08.
- **The stage cadastro endpoints.** Slice 02. This slice only READS
  `sales_ops_lead_stages`, never writes it.
- **The `CLAUDE.md` leads-domain section (acceptance 24).** It has to describe the finished
  feature including the web half; writing half of it here would guarantee two slices editing the
  same prose. Whichever slice lands last owns it.
- **A web control for `hubAccountId`.** Recorded as a gap in §3.1; the self-claim covers the
  common case and `PATCH /people/:id` covers the rest.
