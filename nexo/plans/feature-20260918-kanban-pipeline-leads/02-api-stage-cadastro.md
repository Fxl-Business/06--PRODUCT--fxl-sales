---
id: 02-api-stage-cadastro
milestone: v4.1.0
status: done
depends_on: [01-leads-schema]
files_modified:
  - apps/api/src/domains/sales-ops/leads/schemas.ts
  - apps/api/src/domains/sales-ops/leads/stage-service.ts
  - apps/api/src/domains/sales-ops/leads/stage-routes.ts
  - apps/api/src/domains/sales-ops/routes.ts
  - apps/api/src/domains/sales-ops/__tests__/lead-stages-contract.test.ts
  - apps/api/src/domains/sales-ops/__tests__/lead-stages-routes.test.ts
  - apps/api/test/rls/lead-stages-rls.test.ts
acceptance: "Given an org whose lead stages were seeded by 01, when an admin lists, creates, renames, reorders and archives stages through /api/v1/sales-ops/lead-stages, then every write is org-scoped inside withTenant, a system stage answers 409 {error:'conflict',reason:'stage_is_system'} exactly as funcao_is_system does today, a name already taken in that org answers 409 {error:'conflict',reason:'stage_name_taken'} keyed on the real UNIQUE (org_id, name) index 01 ships and not on a racy service probe, a reorder writes a total order in ONE transaction without touching any lead's stage_changed_at, there is no DELETE verb anywhere on the surface, and no audit_log row is written."
goal: The org-admin API for lead stages - list, create, rename, reorder, archive/restore - in its own leads/ module mounted once into salesOpsRouter.
must_not_break:
  - salesOpsRouter still exposes NO DELETE verb (the existing oracle `has no DELETE route for people or funcoes` must stay green, and the new surface adds none).
  - The funções routes and their 409 taxonomy (`funcao_is_system`, `funcao_name_taken`, `funcao_slug_taken`, `reserved_funcao_slug`) are byte-unchanged; this slice only ADDS a mount line and an import line to routes.ts.
  - `apps/api/src/domains/sales-ops/service.ts` is NOT edited at all. Nothing about lead stages reaches `getSalesOpsSnapshot`, `/bootstrap`, `getSalesOpsSummary` or `computeSaleFinancials`.
  - `SALE_TRANSITIONS` / `EXPECTED_MATRIX` untouched.
  - No `audit_log` write from anywhere in `leads/`.
  - `apps/api/src/db/schema.ts` is NOT edited here - it is slice 01's file.
rules:
  - Every query filters by `eq(salesOpsLeadStages.orgId, orgId)` and runs inside the module's own `withTenant`.
  - `orgId` comes only from `c.get('orgId')`; never from a request body. `kind`, `position`, `isSystem` and `archivedAt` are server-derived and are stripped by the zod schema. There is no `slug` column and no `slug` key anywhere in this slice.
  - Admin gate is `requireAdmin` from `../../../middleware/require-admin.js`, mounted per-route exactly as `salesOpsRouter.post('/funcoes', requireAdmin, ...)` does. GET is deliberately NOT admin-gated.
  - Archive is `PATCH { status: 'archived' }`; restore is `PATCH { status: 'active' }`. No DELETE.
  - Reorder is one transaction, takes a row lock on the org's active stages, and writes only `sales_ops_lead_stages`.
  - No `ON DELETE CASCADE` and no hand-written "is it referenced?" query anywhere in this slice.
verifier_focus: "That the ONLY duplicate sentinel is `'duplicate'` → `409 stage_name_taken` and that no `slug`, `slugify*`, `duplicate_slug` or `stage_slug_taken` string survives anywhere in the slice; that the 409 body is byte-identical in SHAPE to the funções one; that reorder is genuinely transactional and provably never writes sales_ops_leads (the stage_changed_at oracle); that the org filter is present on EVERY statement independently of RLS (the admin-context test); that GET is reachable by a seller while all three writes are 403 for a seller; that deleting `requireAdmin` from any write route turns a named test red."
---

# 02 - API de cadastro de etapas de lead

## What this slice is

The org-admin cadastro surface for `sales_ops_lead_stages`, the table slice 01 creates and seeds.
It is a faithful mirror of the funções cadastro (`salesOpsRouter.post('/funcoes', requireAdmin, …)`
plus `createFuncao` / `updateFuncao` in `apps/api/src/domains/sales-ops/service.ts:1606-1740`),
with one addition the funções cadastro does not have: an explicit, transactional **reorder**.

It does **not** touch the lead entity. That is slice 03, which adds its own
`leads/lead-service.ts` and `leads/lead-routes.ts` in a later wave and mounts its own router.

## Inherited contract from slice 01 (read `apps/api/src/db/schema.ts` before you start)

Slice 01 is merged before this slice runs. Open `schema.ts` and use the real identifiers.
The shape this plan is written against:

```
export const salesOpsLeadStages = pgTable('sales_ops_lead_stages', {
  id, orgId, name,
  kind,        // 'normal' | 'conversion' | 'lost'  - server-owned, never from a body
  isSystem,    // true iff kind <> 'normal'; held there by a biconditional CHECK
  position,    // integer, ascending, org-scoped, NOT uniqueness-enforced (see "Reorder" below)
  status,      // 'active' | 'archived'
  archivedAt, createdAt, updatedAt,
});
// uniqueIndex sales_ops_lead_stages_org_name_idx  (org_id, name)
// uniqueIndex sales_ops_lead_stages_org_id_id_idx (org_id, id)
// index        sales_ops_lead_stages_org_position_idx (org_id, position)
// uniqueIndex sales_ops_lead_stages_org_kind_idx  (org_id, kind) WHERE kind <> 'normal'
// check        sales_ops_lead_stages_kind_check        kind in ('normal','conversion','lost')
// check        sales_ops_lead_stages_system_kind_check (kind <> 'normal') = is_system
```

**THERE IS NO `slug` COLUMN, AND THERE ARE EXACTLY THREE KINDS.** An earlier revision of this plan
described a `slug` column and a fourth kind `'converted'`; both were a drafting error, 01 is the
schema owner, and 01 ships neither. Every consequence is already written into the sections below:
one duplicate sentinel (`'duplicate'`), one conflict reason (`stage_name_taken`), no slugifier, no
`reserved_slug`. If you find a `slug` anywhere in this slice's output, it is a defect.

There is also no separate "converted" column. The single `kind: 'conversion'` stage is BOTH the
door that opens the proposta wizard and the column a converted card lands in; read-only-ness is a
property of the CARD (`lead.sale_id !== null`), never of the stage. Nothing in this slice reads
that, but it is stated here so this plan cannot re-seed the four-kind error downstream.

**If 01 shipped different identifiers, 01 wins.** Adapt the names, never the behaviour: every
assertion named below is about behaviour and stays exactly as specified.

## Files

### 1. `apps/api/src/domains/sales-ops/leads/schemas.ts` (new)

Imports **only** `zod`. No DB, no service. This is what makes the contract test a pure unit test.

```ts
export const LeadStageSchema = z.object({
  name: z.string().trim().min(1).max(120),
  status: z.enum(['active', 'archived']).default('active'),
});
export const UpdateLeadStageSchema = LeadStageSchema.partial();
export const ReorderLeadStagesSchema = z.object({
  stageIds: z.array(z.string().uuid()).min(1),
}).superRefine((value, ctx) => { /* duplicate id -> message 'duplicate_stage_id', path ['stageIds'] */ });

export type LeadStageInput = z.infer<typeof LeadStageSchema>;
export type ReorderLeadStagesInput = z.infer<typeof ReorderLeadStagesSchema>;
```

`.partial()` on a schema carrying a `.default()` keeps `UpdateLeadStageSchema.parse({})` equal to
`{}` - same as `UpdateFuncaoSchema`. Copy the funções spelling; do not invent a new one.

`kind`, `position`, `isSystem`, `orgId` and `archivedAt` have **no key at all** in these schemas,
so zod strips them. That is the whole guard: a body carrying `kind: 'conversion'` must not be able
to mint a second conversion column, and 01's partial unique index on `(org_id, kind)` is the
database-level backstop if one ever did. This mirrors `FuncaoSchema` never accepting
`slug`/`isSystem`, and it is pinned by a named test below.

### 2. `apps/api/src/domains/sales-ops/leads/stage-service.ts` (new)

Imports: `and`, `asc`, `eq`, `max` (or `sql`), `ne` from `drizzle-orm`; `salesOpsLeadStages`
from `../../../db/schema.js`; `setTenantContext` from `../../../middleware/auth.js`; and the
schemas above.

**It imports no slugifier, because there is no slug.** 01 ships no `slug` column: `kind` is the
machine key and it is unreachable from the API, so there is nothing to derive and nothing to
reserve. Do NOT import `slugifyFuncao`. The import direction is `leads/ → service.ts` only;
`service.ts` must never import from `leads/`, so there is no cycle either way.

Local tenant boundary (NOT exported from `service.ts` - it is private there, and
`apps/api/src/domains/commissions/service.ts:182` is the existing precedent for a domain owning its
own wrapper):

```ts
async function withTenant<T>(db: Db, orgId: string, fn: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await setTenantContext(tx as unknown as Tx, orgId);
    return fn(tx as unknown as Db);
  });
}
```

Exported functions and their **exact** sentinel returns:

```ts
export type LeadStageRow = typeof salesOpsLeadStages.$inferSelect;

export async function listLeadStages(db: Db, orgId: string): Promise<LeadStageRow[]>
export async function createLeadStage(
  db: Db, orgId: string, data: LeadStageInput,
): Promise<LeadStageRow | 'duplicate'>
export async function updateLeadStage(
  db: Db, orgId: string, id: string, data: Partial<LeadStageInput>,
): Promise<LeadStageRow | null | 'is_system' | 'duplicate'>
export async function reorderLeadStages(
  db: Db, orgId: string, stageIds: string[],
): Promise<LeadStageRow[] | 'set_mismatch'>
```

**There is exactly ONE duplicate sentinel, `'duplicate'`.** Unlike `createFuncao`, there is no
`'duplicate_slug'` and no `'reserved_slug'`: 01 ships one uniqueness rule for this table,
`sales_ops_lead_stages_org_name_idx` on `(org_id, name)`, and `kind` carries the stage semantics
while being unreachable from the API. Record that as a comment on the type, so nobody re-adds the
funções' second member by symmetry.

None of the four takes a `CadastroActor`. See "No ledger" below.

#### `listLeadStages`

```ts
return withTenant(db, orgId, (tx) =>
  tx.select().from(salesOpsLeadStages)
    .where(eq(salesOpsLeadStages.orgId, orgId))
    .orderBy(asc(salesOpsLeadStages.position), asc(salesOpsLeadStages.name)));
```

It returns **archived stages too**, which is a deliberate divergence from the four audited
cadastros, and it needs the comment saying why: a lead can still be sitting on a stage an admin
just archived, and - unlike produto/pessoa/área/função - a lead stage writes **no** `audit_log`
entry, so `Histórico de arquivamentos` is not a restore surface for it. The
`cadastros/etapas` screen (slice 05) is the only place a stage can be restored from, and it can
only offer that if the read returns the archived row. The board (slice 06) filters to
`status === 'active'` itself.

`name` is the tiebreaker so the order is total even before the first reorder, when 01's seed may
have written equal positions.

#### `createLeadStage`

Inside `withTenant`, mirroring `createFuncao` (`service.ts:1626-1653`) statement for statement,
minus every slug step:
1. `const clash = await findLeadStageClash(tx, orgId, data.name);` - a local helper in the shape of
   `findFuncaoClash` but with only the NAME probe (there is no second rule to report). It returns
   `'duplicate' | null`. It is the **fast path for the message only**, exactly as `findFuncaoClash`
   is documented: it names which rule was hit without waiting on a lock, and it is NOT the guard.
2. `const [{ value: highest } = { value: null }] = await tx.select({ value: max(salesOpsLeadStages.position) }).from(salesOpsLeadStages).where(eq(salesOpsLeadStages.orgId, orgId));`
   → `const position = (highest ?? -1) + 1;`
   The max is taken over **every** stage in the org, archived included, so a new stage can never
   land on an archived stage's position and a later restore cannot collide.
3. `.insert(salesOpsLeadStages).values({ ...data, orgId, position, isSystem: false, kind: 'normal' }).onConflictDoNothing().returning()`
   `isSystem: false` and `kind: 'normal'` are written **literally here**, never spread from
   `data` - same reason `createFuncao` writes `isSystem: false` literally. No `slug` key exists.
   `.onConflictDoNothing()` is what makes `sales_ops_lead_stages_org_name_idx` the ACTUAL guard:
   without it a concurrent writer's `23505` escapes as an HTTP 500 instead of the designed 409.
4. If the insert returned nothing, the probe lost the race: re-probe under the fresh statement
   snapshot and fall back to `'duplicate'` -
   `return (await findLeadStageClash(tx, orgId, data.name)) ?? ('duplicate' as const);`
   Copy `createFuncao`'s comment block verbatim in spirit.

#### `updateLeadStage`

Inside `withTenant`, mirroring `updateFuncao` statement for statement:
1. `SELECT … .for('update')` the row by `(orgId, id)`. Not found → `return null`.
2. `if (current.isSystem && (data.name !== undefined || data.status !== undefined)) return 'is_system' as const;`
   **Byte-for-byte the funções rule**: a system stage is immutable through this endpoint - no
   rename, no archive, no restore. Its position is still reorderable (see below).
3. If `data.name !== undefined`, probe for a name clash excluding `id`
   (`findLeadStageClash(tx, orgId, data.name, id)`), and return `'duplicate'` if it fires.
4. The UPDATE runs inside a nested drizzle transaction (SAVEPOINT) so a unique violation maps to
   `'duplicate'` and leaves the outer transaction usable - copy `mapFuncaoUniqueViolation`'s shape
   (`service.ts:1745-1764`, including the `error` / `error.cause` candidate walk and the
   `code !== '23505'` skip) as a local `mapLeadStageUniqueViolation` keyed on the ONE index name:

   ```ts
   const LEAD_STAGE_UNIQUE_VIOLATIONS: Record<string, 'duplicate'> = {
     sales_ops_lead_stages_org_name_idx: 'duplicate',
   };
   ```

   One entry and not two, because 01 ships one uniqueness rule a rename can trip. The
   `(org_id, kind)` index is also unique, but nothing in this slice can write `kind`, so it can
   never be the constraint a PATCH violates.
5. `archivedAt`: set to `new Date()` on active→archived, `null` on archived→active, untouched
   otherwise. `archivedAtPatch` in `service.ts` is **not exported** - write the three-line
   equivalent locally and comment that it is the same rule as `sales_ops_areas.archived_at`, so a
   future purge could read it. (This slice adds nothing to `runArchivedCadastroPurge`; see
   "Deliberately out of scope".)
6. `updatedAt: new Date()`.
7. **No `auditCadastroLifecycle` call.**

#### `reorderLeadStages`

```ts
return withTenant(db, orgId, async (tx) => {
  const active = await tx.select({ id: salesOpsLeadStages.id })
    .from(salesOpsLeadStages)
    .where(and(eq(salesOpsLeadStages.orgId, orgId), eq(salesOpsLeadStages.status, 'active')))
    .orderBy(asc(salesOpsLeadStages.position))
    .for('update');
  // full-set equality, both directions
  if (active.length !== stageIds.length) return 'set_mismatch' as const;
  const known = new Set(active.map((row) => row.id));
  if (stageIds.some((id) => !known.has(id))) return 'set_mismatch' as const;

  for (const [index, id] of stageIds.entries()) {
    await tx.update(salesOpsLeadStages)
      .set({ position: index, updatedAt: new Date() })
      .where(and(eq(salesOpsLeadStages.orgId, orgId), eq(salesOpsLeadStages.id, id)));
  }
  return tx.select().from(salesOpsLeadStages)
    .where(eq(salesOpsLeadStages.orgId, orgId))
    .orderBy(asc(salesOpsLeadStages.position), asc(salesOpsLeadStages.name));
});
```

Four properties, each of which needs its comment because each is a decision:

- **The payload is the COMPLETE ordered set of the org's ACTIVE stage ids, or it is rejected.**
  A partial "move stage X to index 3" payload cannot express the result without the server
  re-deriving every other position, and two admins doing that concurrently interleave into an
  order neither asked for. A total payload makes the write idempotent and makes replay safe.
- **Archived stages are excluded** from the payload and keep their stored positions. They are not
  on the board, so they have no order to express; including them would make the payload depend on
  a row the admin cannot see on the Kanban.
- **`.for('update')` before any write**, so two concurrent reorders serialize at Postgres rather
  than half-applying each other.
- **`position` is deliberately NOT unique-indexed.** The loop necessarily passes through states
  where two rows share an index, and a non-deferrable unique index would abort the transaction.
  This endpoint is the only writer of `position` after create, and it writes a total order, so
  uniqueness is an invariant of the writer rather than of the schema. Say so in the comment.
- **It writes `sales_ops_lead_stages` and nothing else.** No lead row is read or written, so no
  lead's `stage_changed_at` can move. This is acceptance criterion 8 and it has a named oracle.

### 3. `apps/api/src/domains/sales-ops/leads/stage-routes.ts` (new)

```ts
export const leadStagesRouter = new Hono();
```

**The file name and the export name are both load-bearing, and they are NOT `router.ts` /
`leadsRouter`.** Slice 03 does **not** extend this router: it creates its own
`apps/api/src/domains/sales-ops/leads/lead-routes.ts` exporting its own `leadsRouter`, and mounts
it separately. If both slices exported `leadsRouter`, `routes.ts` would end up with two
`import { leadsRouter } from …` lines binding the same local identifier from two modules, which is
a duplicate-identifier compile error. Two distinct names is the resolution, and an import alias is
deliberately NOT the resolution: an alias hides the fact that these are two different routers and
puts the disambiguation in the consumer rather than in the producer.

| slice | file | export | mount prefix | paths it owns |
|---|---|---|---|---|
| 02 (this one) | `leads/stage-routes.ts` | `leadStagesRouter` | `'/'` | `/lead-stages`, `/lead-stages/reorder`, `/lead-stages/:id` |
| 03 | `leads/lead-routes.ts` | `leadsRouter` | `'/leads'` | `/leads`, `/leads/:id`, `/leads/:id/move` |

The two prefixes do not overlap, so the order of the two mounts in `routes.ts` does not matter.

Actor: there is none. These routes do **not** call `cadastroActor(c)` - no ledger, no actor.

Routes, in this order:

```
GET    /lead-stages            -> listLeadStages(getDb(), c.get('orgId'))         -> 200 { stages }
POST   /lead-stages/reorder    requireAdmin                                        -> 200 { stages }
POST   /lead-stages            requireAdmin                                        -> 201 { stage }
PATCH  /lead-stages/:id        requireAdmin                                        -> 200 { stage }
```

`/lead-stages/reorder` is registered **before** `POST /lead-stages` for readability only; there is
no `POST /lead-stages/:id`, so no route actually shadows another. Keep the order anyway.

Error mapping - this is the part the slice exists to get right:

| service returns | response |
| --- | --- |
| zod failure | `400 { error: 'validation_error', issues: parsed.error.flatten() }` |
| `'duplicate'` | `409 { error: 'conflict', reason: 'stage_name_taken' }` |
| `'is_system'` | `409 { error: 'conflict', reason: 'stage_is_system' }` |
| `null` | `404 { error: 'not_found' }` |
| `'set_mismatch'` (reorder) | `400 { error: 'validation_error', reason: 'stage_set_mismatch' }` |

`409 { error: 'conflict', reason: 'stage_is_system' }` is the acceptance-5 requirement "responde
409 do mesmo jeito que `funcao_is_system` responde hoje": same status, same `error` literal, same
`reason` key, the entity word swapped. `apps/api/src/domains/sales-ops/routes.ts:276` is the line
being mirrored:

```ts
if (funcao === 'is_system') return c.json({ error: 'conflict', reason: 'funcao_is_system' }, 409);
```

and `stage_name_taken` mirrors the line immediately below it
(`routes.ts:277` and `routes.ts:254`, identical in both the POST and the PATCH handler):

```ts
if (funcao === 'duplicate') return c.json({ error: 'conflict', reason: 'funcao_name_taken' }, 409);
```

Do not invent `code`, do not nest, do not add a message. There is **no** `stage_slug_taken` line,
because there is no slug: the funções router's `duplicate_slug` branch has no counterpart here.

Every handler parses with `await c.req.json().catch(() => ({}))` - the existing spelling, so a
missing or malformed body is a 400 rather than a 500.

`GET /lead-stages` carries **no** `requireAdmin`, exactly as `GET /funcoes` does not: the Kanban
board and every stage picker need the list, and a seller has a board. The three writes all carry
it. Both halves are pinned.

**Never add a DELETE verb to this router.** Not now, not in 03.

### 4. `apps/api/src/domains/sales-ops/routes.ts` (2 lines added, nothing else)

Exactly these two lines, spelled exactly like this:

```ts
import { leadStagesRouter } from './leads/stage-routes.js';
```

```ts
salesOpsRouter.route('/', leadStagesRouter);
```

Mount it once, after the funções block and before the `/sales` block. The sub-router owns the full
`/lead-stages…` paths, so the mount prefix is `'/'`.

**Slice 03 adds its own two lines to this same file, later and in a different wave**, and this is
what they are, so an executor applying 02 then 03 gets a file that compiles:

```ts
import { leadsRouter } from './leads/lead-routes.js';
salesOpsRouter.route('/leads', leadsRouter);
```

Four lines total, two imports, two mounts, two distinct identifiers, no alias. Do not "tidy" 02's
mount into 03's or vice versa.

Do not reorder, reformat or re-sort the existing import list beyond inserting the one line.

## No ledger - a recorded decision, not an omission

`CLAUDE.md` says archive/restore of a cadastro appends a hash-chained `audit_log` entry. Lead
stages deliberately do **not**, and the reason is that the ledger is a closed wire contract:
`CadastroEntityTypeSchema` in `apps/api/src/domains/audit/service.ts:56` is
`z.enum(['produto','pessoa','funcao','area'])`, those four literals are matched by hand in
`apps/web/src/sales-ops/cadastro-history.ts`, nothing type-checks the pair across the boundary, and
`runArchivedCadastroPurge` purges exactly those four. Adding a fifth entity type is a change to
three files in two apps plus the purge, none of which is in this slice's scope, and acceptance
criterion 19 already places the lead domain outside the ledger.

The consequence is handled rather than ignored: because there is no history panel to restore from,
`listLeadStages` returns archived rows and the cadastro screen owns restore directly. That is the
trade, stated here so a later reader does not "fix" it by wiring `auditCadastroLifecycle` in -
which would write an entity type the history UI cannot render and the purge would then eventually
hard-delete a stage leads still point at. `archiving a lead stage writes no audit_log row` is the
test that goes red on that mutation.

## Tests

### `apps/api/src/domains/sales-ops/__tests__/lead-stages-contract.test.ts` (new)

Pure, no DB, no mocks. Imports only from `../leads/schemas.js`. Style: `funcoes-contract.test.ts`.

`describe('sales operations lead stage contract', …)`

1. `accepts a minimal lead stage payload and defaults status to active`
   `LeadStageSchema.parse({ name: '  Qualificação  ' })` → `{ name: 'Qualificação', status: 'active' }`.
   *Decisive against*: dropping the `.trim()` or the `.default('active')`, which would persist a
   padded column title and a `undefined` status.
2. `rejects an empty or blank lead stage name`
   *Decisive against*: relaxing `min(1)` to `optional()`, which would let a nameless column ship.
3. `rejects unsupported lead stage statuses`
   `{ status: 'deleted' }` false, `{ status: 'archived' }` true.
   *Decisive against*: widening `status` to `z.string()`, which is how a DELETE-by-status sneaks in.
4. `never accepts kind, position or isSystem from the request body`
   Parse `{ name: 'Proposta', kind: 'conversion', position: 0, isSystem: true }`
   and assert the result is exactly `{ name: 'Proposta', status: 'active' }` - i.e. it carries
   none of those three keys; same for `UpdateLeadStageSchema.parse(...)` returning `{}`.
   Also assert no parsed result ever carries a `slug` key, because there is no such column and a
   future "symmetry with funções" edit is exactly how one would come back.
   *Decisive against*: spreading the body into the insert - the single most damaging mutation in
   the slice, because a smuggled `kind: 'conversion'` mints a second conversion column and a
   smuggled `isSystem: true` makes a stage permanently un-archivable.
5. `allows a partial patch payload but still rejects a blank rename`
   `{}` ok, `{ status: 'archived' }` ok, `{ name: '   ' }` rejected.
6. `rejects a reorder payload with duplicate stage ids`
   *Decisive against*: dropping the `superRefine`, which would let two columns be written to the
   same position and silently drop a third from the board.
7. `rejects an empty reorder payload and a non-uuid stage id`
   *Decisive against*: `z.array(z.string())`, which would let an arbitrary string reach the `IN`
   clause.

### `apps/api/src/domains/sales-ops/__tests__/lead-stages-routes.test.ts` (new)

Hono + `vi.mock`. Copy the harness from `routes.test.ts:1-130` verbatim in shape: the hoisted
`serviceMocks` object, `vi.mock('../../../db/client.js')`, `vi.mock('../leads/stage-service.js')`
(with `importOriginal` spread), `await import('../leads/stage-routes.js')`, a `createTestApp()` that sets
`userId` / `orgId: 'verified-org'` / `userRole` / `userRoles` / `hubAuth` from
`../../../auth/__tests__/hub-auth-context-fixture.js`, and a mutable `currentRole`.

Mount with `app.route('/', leadStagesRouter)`.

`describe('Sales Ops lead stage routes', …)`

1. `keeps GET /lead-stages available to %s` - `it.each(['seller','finder'] as const)`. 200.
   *Decisive against*: putting `requireAdmin` on the read, which 403s the board for every seller.
2. `refuses POST /lead-stages to a non-admin with 403 admin_role_required` -
   `it.each(['seller','finder',undefined])`, asserts status 403, body
   `{ error: 'forbidden', reason: 'admin_role_required' }`, **and** that `serviceMocks.createLeadStage`
   was never called.
   *Decisive against*: dropping `requireAdmin`. The "never called" half is what makes it decisive
   rather than incidental - a 403 could otherwise come from anywhere.
3. `refuses PATCH /lead-stages/:id to a non-admin with 403 admin_role_required` - same shape.
4. `refuses POST /lead-stages/reorder to a non-admin with 403 admin_role_required` - same shape.
5. `never trusts orgId, kind or isSystem from a lead stage request body`
   POST a body carrying `orgId: 'body-org-must-not-be-used'`,
   `kind: 'conversion'`, `isSystem: true`, `position: 0`; assert
   `createLeadStage` was called with `(mockedDb, 'verified-org', { name: …, status: 'active' })`
   as a **literal** third argument (`toHaveBeenCalledWith`, not `expect.objectContaining`).
   *Decisive against*: `{ ...parsed.data, ...body }` or reading `orgId` from the body.
6. `maps a system stage patch to 409 stage_is_system`
   Mock `updateLeadStage` → `'is_system'`; assert `409` and body exactly
   `{ error: 'conflict', reason: 'stage_is_system' }`.
   *Decisive against*: returning 200/403/404 for a system stage, i.e. the acceptance-5 mirror.
7. `maps a duplicate stage name to 409 stage_name_taken`
   Mock `createLeadStage` → `'duplicate'`; assert `409` and body exactly
   `{ error: 'conflict', reason: 'stage_name_taken' }`. Repeat for `updateLeadStage`.
   *Decisive against*: answering 400 or 500 for a name already taken in the org, and against the
   `duplicate_slug` / `stage_slug_taken` pair coming back by symmetry with funções - there is no
   second conflict reason on this surface and this test's `toEqual` on the whole body is what says so.
8. `returns 404 when PATCH /lead-stages/:id targets another org` - mock resolves `null`.
   *Decisive against*: leaking a cross-org row's existence as anything other than 404.
9. `maps a reorder set mismatch to 400 validation_error stage_set_mismatch`
   *Decisive against*: swallowing the sentinel and answering 200 on a partial reorder.
10. `archives a lead stage through PATCH rather than a DELETE verb`
    Admin PATCH `{ status: 'archived' }` → 200, and `updateLeadStage` received `{ status: 'archived' }`.
11. `has no DELETE route for lead stages`
    `app.request('/lead-stages/<uuid>', { method: 'DELETE' })` → 404, mirroring the existing
    `has no DELETE route for people or funcoes`.
    *Decisive against*: the one thing `CLAUDE.md` forbids outright.
12. `rejects a blank lead stage name before service execution`
    400 **and** `createLeadStage` never called.

### `apps/api/test/rls/lead-stages-rls.test.ts` (new)

Style: `apps/api/test/rls/funcoes-rls.test.ts` - same `APP_DB_URL` / `ADMIN_DB_URL` resolution,
same `ADMIN_CONNECTION_OPTIONS`, same `newOrgPair` suffixing, same `afterAll` cleanup of every org
id it created. It drives the **service** functions, not HTTP.

For any test needing stages to exist, seed them the way 01 does (call 01's seed helper if it
exported one; otherwise insert through the admin connection using the real column names from
`schema.ts`).

`describe('sales operations lead stages persistence and RLS', …)`

1. `lead stage CRUD stays tenant-scoped through the service layer`
   Create in org A, assert `listLeadStages(db, orgB)` never contains it; rename and archive in A
   and re-read.
2. `createLeadStage reports duplicates per org but allows the same name in another org`
   Create `Qualificação` in org A twice (second → `'duplicate'`), then once in org B (→ a row).
   *Decisive against*: a global rather than org-scoped unique probe.
2b. `reports a duplicate name even when the probe loses the race`
   Delete `findLeadStageClash`'s call from `createLeadStage` in a scratch run and this must still
   return `'duplicate'` rather than throwing, because `.onConflictDoNothing()` plus the re-probe is
   the real guard. Assert it by inserting the colliding row through the ADMIN connection between
   nothing and the call - the simplest faithful form is to create the row first and then call
   `createLeadStage` with the same name, asserting `'duplicate'` and that `count(*)` for that name
   in that org is still 1.
   *Decisive against*: dropping `.onConflictDoNothing()`, which turns a concurrent duplicate into a
   raw `23505` and an HTTP 500.
3. `createLeadStage appends after the highest position, archived rows included`
   Create three, archive the middle one, create a fourth, assert its `position` is strictly greater
   than every existing one.
   *Decisive against*: `count(*)`-based positioning, which collides after an archive.
4. `updateLeadStage refuses to rename or archive a system stage`
   Against a real seeded `isSystem` row: both `{ name }` and `{ status: 'archived' }` return
   `'is_system'`, and a re-read proves the row is unchanged.
   *Decisive against*: the 409 existing only in the route's `if` and not in the service.
5. `reorderLeadStages writes a total order in one transaction and refuses a partial set`
   Reorder a full 4-id set reversed → positions `0,1,2,3` in the new order; then call with 3 of
   the 4 ids → `'set_mismatch'` **and** a re-read proves not one position moved.
   *Decisive against*: a per-id loop outside a transaction, which would half-apply the rejected call.
6. `reorderLeadStages leaves every lead stage_changed_at untouched`
   Insert a lead row directly (admin connection, the real `sales_ops_leads` column names from
   01's `schema.ts`), capture its `stage_changed_at`, reorder the stages including the one the
   lead sits on, re-read and assert the timestamp is byte-identical.
   *Decisive against*: a reorder implementation that "refreshes" affected leads. This is the sole
   oracle for acceptance criterion 8 and it must not be weakened to "the lead still exists".
7. `archiving a lead stage writes no audit_log row`
   `SELECT count(*) FROM audit_log` (admin connection) before and after an archive **and** a
   restore; assert unchanged.
   *Decisive against*: wiring `auditCadastroLifecycle` into `updateLeadStage`.
8. `org A cannot read org B lead stages`
   Through the ordinary app connection.
9. `scopes every lead stage read by orgId even when RLS is not doing the scoping`
   Same pattern as the funções test's identically-named case: drive `listLeadStages` over the
   `app.fxl_admin` connection, where RLS shows every org, and assert only org A's stages come back.
   *Decisive against*: deleting `eq(salesOpsLeadStages.orgId, orgId)` - which RLS would otherwise
   hide, exactly as `funcoes-rls.test.ts:276` documents.
10. `raw RLS blocks a cross-org lead stage read and WITH CHECK blocks a smuggled insert`
    Over the non-superuser `fxl_sales_test` role. Include this **only if** 01 shipped
    `ENABLE`/`FORCE ROW LEVEL SECURITY` plus the tenant policy on `sales_ops_lead_stages`; if 01
    did not, do not write the test and say so in the exec notes rather than asserting a policy
    that does not exist.

### Commands (run-once, never a watcher)

```bash
pnpm --filter @fxl-sales/api test src/domains/sales-ops/__tests__/lead-stages-contract.test.ts
pnpm --filter @fxl-sales/api test src/domains/sales-ops/__tests__/lead-stages-routes.test.ts
pnpm --filter @fxl-sales/api test src/domains/sales-ops/__tests__/routes.test.ts
pnpm --filter @fxl-sales/api test:integration test/rls/lead-stages-rls.test.ts
pnpm --filter @fxl-sales/api lint
pnpm --filter @fxl-sales/api type-check
```

`routes.test.ts` is in the list as the regression guard for the two lines added to `routes.ts`:
its `has no DELETE route for people or funcoes` and the whole funções 409 block must stay green.

## Deliberately out of scope

- **The lead entity.** No `sales_ops_leads` read or write anywhere in `leads/stage-service.ts`.
  Slice 03 adds its own `leads/lead-schemas.ts`, `leads/lead-service.ts` and `leads/lead-routes.ts`,
  and mounts its own `leadsRouter` separately (§4). It does not extend this slice's router.
- **Everything in `apps/web`.** Including the `cadastros/etapas` screen (05) and routing (07).
- **The audit ledger.** Reasons above.
- **The nightly purge.** `runArchivedCadastroPurge` is not extended to lead stages. A stage that
  leads still point at must never be hard-deleted, and the FK that would enforce that is 01's; the
  purge's four entity types stay four. `archivedAt` is still written so a future slice has the
  timestamp it would need.
- **A cap on the number of stages.** Nothing in the acceptance asks for one and an arbitrary limit
  would be a second place to be wrong. Recorded, not forgotten.
- **`GET /lead-stages/:id`.** Nothing reads a single stage; the list is small and org-bounded.
- **A `slug` column, a slugifier, a `duplicate_slug` sentinel and a `stage_slug_taken` reason.**
  None of them exist. 01 ships no slug (its §2.1 records why), `kind` is the machine key and is
  unreachable from the API, and the single uniqueness rule is `(org_id, name)`. The API keys on
  `id` everywhere.
- **A unique index on `(org_id, position)`.** Reasons in the reorder section.
