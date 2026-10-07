---
id: 01-api-lixeira
milestone: v4.6.0
status: done
depends_on: []
files_modified: [apps/api/drizzle/0028_lead_soft_delete.sql, apps/api/drizzle/meta/0028_snapshot.json, apps/api/drizzle/meta/_journal.json, apps/api/src/db/schema.ts, apps/api/src/domains/audit/service.ts, apps/api/src/domains/sales-ops/leads/lead-service.ts, apps/api/src/domains/sales-ops/leads/lead-trash-service.ts, apps/api/src/domains/sales-ops/leads/lead-schemas.ts, apps/api/src/domains/sales-ops/leads/lead-routes.ts, apps/api/src/domains/sales-ops/leads/__tests__/lead-routes.test.ts, apps/api/src/domains/sales-ops/leads/__tests__/lead-contract.test.ts, apps/api/src/middleware/__tests__/edition-gate-map.test.ts, apps/api/src/db/__tests__/lead-soft-delete-schema.test.ts, apps/api/test/rls/lead-soft-delete-migration.test.ts, apps/api/test/rls/leads-schema-migration.test.ts, apps/api/test/rls/leads-lixeira.test.ts]
oracle: [apps/api/test/rls/leads-lixeira.test.ts, apps/api/test/rls/lead-soft-delete-migration.test.ts, apps/api/src/db/__tests__/lead-soft-delete-schema.test.ts, apps/api/src/domains/sales-ops/leads/__tests__/lead-routes.test.ts, apps/api/src/domains/sales-ops/leads/__tests__/lead-contract.test.ts, apps/api/src/middleware/__tests__/edition-gate-map.test.ts, apps/api/test/rls/leads-schema-migration.test.ts]
acceptance: ["Migration 0028_lead_soft_delete adds nullable deleted_at timestamptz, deleted_by_user_id text, deleted_by_name text, the CHECK sales_ops_leads_deleted_pair_check and the partial index sales_ops_leads_org_deleted_idx, journaled right after 0027 with a chained snapshot", "liveLeadCondition() is exported from lead-service.ts, is the only isNull(salesOpsLeads.deletedAt) in that file, and filters listLeads rows and total, getLead, applyLeadUpdate, moveLead, readLeadView, renumberStage and the create MAX(position)", "POST /leads/:id/delete answers 204 for an admin on any live lead and for a non-admin on exactly the leads the existing scope gate lets him read; 404 otherwise or when already deleted; 409 lead_already_converted for a converted lead; 403 seller_person_unmapped as today", "A delete never writes seller_person_id or seller_name_snapshot (never claims), keeps stage_id, and leaves the column densely numbered 1..N over live leads", "A later create, move or renumber in that column ignores the deleted row (no gap, the deleted row's stale position untouched)", "Delete and restore each append exactly one hash-chained audit_log entry (lead.deleted / lead.restored, entityType lead, actor name snapshot, metadata contactName/clientName/stageName/sellerName) inside the same transaction; a refused or rolled-back act writes none", "POST /leads/:id/restore is requireAdmin (403 admin_role_required for a non-admin), puts the lead back in its own active etapa or else the first active normal etapa (stage_changed_at moves only then), appends it at the end of the column, clears the three columns and answers 200 {lead}; 400 no_open_stage when no target exists; 404 for a live, unknown or other-org id", "GET /leads/deleted is requireAdmin, registered above GET /leads/:id, answers {items: DeletedLeadView[], nextCursor} newest deleted_at first with a microsecond-exact (deleted_at, id) keyset, default 50 max 200, org-scoped, and never carries deleted_by_user_id", "The three new routes are classified OPEN in edition-gate-map.test.ts and work in both editions", "lead-service.ts still never mentions the audit writer; all audited lead acts live in lead-trash-service.ts"]
---

# 01-api-lixeira - soft delete, restore, deleted list, audit, live filter

## Goal

Server half of the lead lixeira (AC5, AC6, AC7, AC8, AC10 server side, and the read behind AC9).
After this slice a lead can be soft deleted by anyone who can read it, it disappears from every lead read and write, the column stays dense, every delete and restore is a hash-chained `audit_log` entry in the same transaction, and an admin can list deleted leads and restore one.
No web code changes here (slices 03 and 04).

Names are the ones fixed in `nexo/plans/lead-lixeira/SEAM-CONTRACT.md`.
Every name below that the seam does not fix is internal to this slice and listed under "Seam notes" at the end.

## Design decisions (already taken, do not revisit)

1. **Where the audited code lives.**
   `apps/api/src/domains/sales-ops/leads/__tests__/lead-contract.test.ts` asserts that `lead-service.ts` never mentions `writeAuditEntry|auditCadastroLifecycle|auditLog` or `getAdminDb` (moves must stay unaudited).
   So `deleteLead`, `restoreLead` and `listDeletedLeads` live in a NEW file `apps/api/src/domains/sales-ops/leads/lead-trash-service.ts`, which is the ONE lead file that imports `writeAuditEntry`.
   `lead-service.ts` never imports the new file (no cycle) and gains no audit mention, so the existing guarantee and its test stay untouched.
   The new file reuses lead-service internals that this slice exports: `leadIdentityConditions`, `lockLeadBoard`, `renumberStage`, `readLeadView`, plus two helpers extracted from `insertLead` (`firstOpenLeadStage`, `nextLeadPosition`) so the "first open etapa" and "append at the end" rules exist once.
2. **One live predicate.** `liveLeadCondition()` in `lead-service.ts` returns `isNull(salesOpsLeads.deletedAt)`.
   `leadIdentityConditions` always includes it, so `getLead`, `applyLeadUpdate`, `moveLead` and `deleteLead` filter through it without a second spelling.
   The trash file reads DELETED rows on purpose through a local `deletedLeadCondition()` (`isNotNull`).
3. **Lock order** (the existing one, CLAUDE.md "Kanban de leads"): scope gate, then `lockLeadBoard`, then the card row `FOR UPDATE`, then the column renumber, then `writeAuditEntry` LAST (its global tail lock is held until COMMIT).
   Both delete and restore write `position` (delete renumbers, restore appends), so both take the board lock.
4. **Timestamps** are app clock (`new Date()`), like every other column this file writes.
5. **Cursor** of the deleted list is `<deleted_at rendered by Postgres as UTC ISO with 6 fractional digits>_<id>`.
   timestamptz stores microseconds; a millisecond cursor built from a JS Date would land between two rows deleted in the same millisecond and silently skip one.
   Postgres renders it (`to_char`) and parses it back (`::timestamptz`), so it round-trips exactly.
6. **Audit payload.** `beforeJsonb`/`afterJsonb` carry `label` (the contact name) and `actorLabel` (the actor name snapshot) so the existing org history read (`after_jsonb ->> 'label'`, `->> 'actorLabel'`) names both, plus the seam's `metadata` object nested under the key `metadata`.
7. **Partial index** `sales_ops_leads_org_deleted_idx` on `(org_id, deleted_at, id) WHERE deleted_at IS NOT NULL` serves the keyset read; it costs nothing for live rows.

## Reader and writer inventory of `sales_ops_leads` (grep of the whole repo, decided)

| Site | What it does | Decision |
| --- | --- | --- |
| `lead-service.ts` `listLeads` | page rows and `total` | `liveLeadCondition()` as the SECOND element of the shared `conditions` array, so both share it |
| `lead-service.ts` `getLead` | identity read | via `leadIdentityConditions` (now includes live) |
| `lead-service.ts` `applyLeadUpdate` | identity read `FOR UPDATE` + UPDATE | read via `leadIdentityConditions`; add `liveLeadCondition()` to the UPDATE `where` |
| `lead-service.ts` `moveLead` | identity read `FOR UPDATE` + UPDATE | same as above |
| `lead-service.ts` `readLeadView` | view read after a write | add `liveLeadCondition()`; a deleted row here is a bug and throws (restore reads after clearing the columns) |
| `lead-service.ts` `renumberStage` | column read `FOR UPDATE` + raw UPDATE | add `liveLeadCondition()` to the select; the raw UPDATE touches only ids from that live read, so a deleted row's stale position is never rewritten |
| `lead-service.ts` `insertLead` `MAX(position)` | append position | moved into `nextLeadPosition`, filtered live |
| `lead-service.ts` `readLeadProducts` / `replaceLeadProducts` | child rows by lead id | no filter: keyed by ids already proven live; a deleted lead keeps its produtos so a restore brings them back |
| `stage-service.ts` | stages only | reads no lead, no change |
| `stages-seed.ts` | stages only | no change (and the trash service never seeds) |
| `import/executor.ts` | `createLead` + `moveLead` | inherits the filter through the services, no change |
| `import/catalog.ts`, `import/plan/*` | no lead read | no change |
| `scripts/seed-dev.ts`, `scripts/seed/plan.ts` | deletes every lead of a fixture org (deleted ones included, correct for a reseed), inserts live leads (new columns default NULL) | no change |
| `sales-ops/service.ts` (bootstrap, summary, dashboard) | never reads leads | no change |
| `lead-trash-service.ts` (new) | `deleteLead` reads live rows through `leadIdentityConditions`; `restoreLead` and `listDeletedLeads` read deleted rows through `deletedLeadCondition()` | by design |
| slice 02 `summarizeLeadStages` | per-stage totals | must use `liveLeadCondition()` (seam) |

## Step 1 - Drizzle schema

File `apps/api/src/db/schema.ts`, table `salesOpsLeads`.

1a. After `updatedAt: timestamp('updated_at', { withTimezone: true }),` add (exactly this order, it fixes the generated SQL order):

```ts
    /**
     * The lixeira (migration 0028). A lead is deleted SOFTLY: the row stays so the
     * gestor can restore it from Cadastros > Leads excluídos, and every lead read
     * and write steps around it through `liveLeadCondition()` in
     * leads/lead-service.ts. All three are NULL on a live lead.
     * `deletedByUserId` is the Hub account id of the actor and is never projected
     * to a client; `deletedByName` is the token display name snapshotted at the
     * act (name, then e-mail, then NULL) because there is no Hub account
     * directory to resolve it later.
     */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedByUserId: text('deleted_by_user_id'),
    deletedByName: text('deleted_by_name'),
```

1b. In the `(t) => [...]` array, directly after the `uniqueIndex('sales_ops_leads_org_sale_idx')...where(...)` entry, add:

```ts
    // The deleted list's keyset read (newest deleted_at first, id as tiebreaker).
    // PARTIAL, so live leads, which are almost every row, never pay for it.
    index('sales_ops_leads_org_deleted_idx')
      .on(t.orgId, t.deletedAt, t.id)
      .where(sql`${t.deletedAt} is not null`),
```

1c. Directly after `check('sales_ops_leads_estimated_value_check', ...)`, add:

```ts
    // A half-deleted row is unrepresentable: a deletion time without an actor, or
    // an actor without a time. deleted_by_name stays outside it because a token
    // may legitimately carry neither a name nor an e-mail.
    check(
      'sales_ops_leads_deleted_pair_check',
      sql`(${t.deletedAt} is null) = (${t.deletedByUserId} is null)`,
    ),
```

## Step 2 - Migration 0028 (generated, then a header comment)

2a. From `apps/api`: `pnpm exec drizzle-kit generate --name lead_soft_delete`.
It is offline (reads the schema and the snapshots, opens no connection).
It must create `drizzle/0028_lead_soft_delete.sql`, `drizzle/meta/0028_snapshot.json` and append `idx: 28, tag: "0028_lead_soft_delete"` to `drizzle/meta/_journal.json`.
The planner ran this exact schema change as a throwaway and drizzle-kit produced exactly these five statements (if the output differs, stop and report rather than hand-edit):

```sql
ALTER TABLE "sales_ops_leads" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales_ops_leads" ADD COLUMN "deleted_by_user_id" text;--> statement-breakpoint
ALTER TABLE "sales_ops_leads" ADD COLUMN "deleted_by_name" text;--> statement-breakpoint
CREATE INDEX "sales_ops_leads_org_deleted_idx" ON "sales_ops_leads" USING btree ("org_id","deleted_at","id") WHERE "sales_ops_leads"."deleted_at" is not null;--> statement-breakpoint
ALTER TABLE "sales_ops_leads" ADD CONSTRAINT "sales_ops_leads_deleted_pair_check" CHECK (("sales_ops_leads"."deleted_at" is null) = ("sales_ops_leads"."deleted_by_user_id" is null));
```

Never hand-write the snapshot JSON.
Run `pnpm exec drizzle-kit generate --name noop` again afterwards: it must print `No schema changes, nothing to migrate`.

2b. Prepend this header (comment lines only, every line starting with `--`) to `0028_lead_soft_delete.sql`, keeping the generated statements byte-identical below it:

```sql
-- 0028_lead_soft_delete - the lead lixeira (lead-lixeira slice 01).
--
-- Deleting a lead is a SOFT delete the gestor can undo from Cadastros > Leads
-- excluídos, never a hard DELETE: the product's archive-never-delete rule, and a
-- deleted lead still names a cliente, a pessoa and an etapa that carry history.
-- Three NULLABLE columns with no default, so every existing lead reads as live
-- and no backfill is needed:
--   deleted_at          when it was deleted; NULL is live, the one predicate
--                       liveLeadCondition() in leads/lead-service.ts spells;
--   deleted_by_user_id  the Hub account id of the actor, never sent to a client;
--   deleted_by_name     the actor display name snapshotted from the token (name,
--                       then e-mail, then NULL): there is no Hub account
--                       directory to resolve an account id later.
--
-- The CHECK makes a half-deleted row unrepresentable (a time without an actor,
-- or an actor without a time). deleted_by_name stays outside it because a token
-- may carry neither a name nor an e-mail.
--
-- The PARTIAL index serves only the deleted list's keyset read (newest first,
-- id as the tiebreaker) and costs nothing for live rows.
--
-- sales_ops_leads already carries FORCE RLS and both org policies from 0022; new
-- columns inherit them, so no policy statement belongs here. Ordinary
-- (non-phased) migration: nullable columns with no default are catalog-only, and
-- the CHECK validates in one scan that every existing row (NULL, NULL) passes.
```

## Step 3 - Audit actions

File `apps/api/src/domains/audit/service.ts`, `AuditActionSchema`: after `'import.completed',` add

```ts
  // The lead lixeira (lead-lixeira): one entry per soft delete and one per
  // restore, written by sales-ops/leads/lead-trash-service.ts inside the same
  // transaction as the row write. Deliberately NOT cadastro lifecycle actions,
  // exactly like import.completed: CADASTRO_LIFECYCLE_ACTIONS and
  // CadastroEntityTypeSchema stay unchanged, so the cadastro history panel never
  // lists them. entityType is 'lead'.
  'lead.deleted',
  'lead.restored',
```

`CADASTRO_LIFECYCLE_ACTIONS` and `CadastroEntityTypeSchema` stay byte-identical.

## Step 4 - `lead-service.ts` (no audit mention may be added to this file)

Do NOT write the strings `writeAuditEntry`, `auditCadastroLifecycle`, `auditLog` or `getAdminDb` anywhere in this file, comments included (the contract test reads the bytes).
Do NOT import `./lead-trash-service.js`.

4a. Header comment (the first bullet "It writes NO ledger entry, for any operation, movement included..."): append one sentence to that bullet: "Deleting and restoring a lead DO write one, which is exactly why they live in `lead-trash-service.ts` and not here; this file only exports the board plumbing they share (the lock, the renumber, the identity predicate, the view)."

4b. Add, at the top of the "Reads" section (right after the `// Reads` banner, before `type LeadRow`):

```ts
/**
 * The ONE spelling of "this lead is live" (lead-lixeira): deleted_at IS NULL.
 *
 * A deleted lead is a soft delete the gestor can restore, so its row stays and
 * every board read, count and write in this file steps around it through this
 * helper, directly or through `leadIdentityConditions`; so does the stage
 * summary. Only lead-trash-service.ts reads deleted rows, on purpose. A
 * hand-written deleted_at predicate anywhere else is a second rule that drifts.
 */
export function liveLeadCondition(): SQL {
  return isNull(salesOpsLeads.deletedAt);
}
```

The literal `isNull(salesOpsLeads.deletedAt)` must appear exactly once in the file (the contract test counts it).

4c. `readLeadView`: change `async function readLeadView` to `export async function readLeadView` and its `.where(...)` to `.where(and(eq(salesOpsLeads.orgId, orgId), eq(salesOpsLeads.id, leadId), liveLeadCondition()))`.
Add to its doc comment: "Live only. Every caller has just proven the lead live inside this transaction, or (a restore) just made it live, so a deleted row here is a bug and throws."

4d. `listLeads`: `const conditions: SQL[] = [eq(salesOpsLeads.orgId, orgId), liveLeadCondition()];`.
Extend the existing comment sentence "The count below and the page share this one `conditions` array" with: "and the live predicate is in it from the start, so a deleted card is neither a row nor part of `total`."

4e. `type LeadScopeAllowed` becomes `export type LeadScopeAllowed` (it is the parameter type of the now-exported `leadIdentityConditions`).

4f. `leadIdentityConditions`: export it, and build `const conditions: SQL[] = [eq(salesOpsLeads.orgId, orgId), eq(salesOpsLeads.id, id), liveLeadCondition()];`.
Doc: add "It always carries `liveLeadCondition()`, so a deleted lead is `not_found` to every identity read (get, PATCH, move, delete) for every caller, admin included. Exported for lead-trash-service.ts."

4g. `lockLeadBoard`: export it.
In its doc, change "Every transaction that writes a lead's `stage_id` or `position` (`moveLead`, `insertLead`)" to "(`moveLead`, `insertLead`, and `deleteLead` / `restoreLead` in lead-trash-service.ts)".

4h. Extract two exported helpers, placed right after `lockLeadBoard`:

```ts
/**
 * The first ACTIVE normal stage by board order: where a new lead lands, and
 * where a restored lead lands when its own etapa was archived. One spelling of
 * the rule for both. `name` is the tiebreaker, matching the stage list's own
 * (position, name) read order. Null when the org has no open etapa (the leads
 * edition starts with none).
 */
export async function firstOpenLeadStage(
  tx: Db,
  orgId: string,
): Promise<{ id: string; name: string } | null> {
  const [stage] = await tx
    .select({ id: salesOpsLeadStages.id, name: salesOpsLeadStages.name })
    .from(salesOpsLeadStages)
    .where(
      and(
        eq(salesOpsLeadStages.orgId, orgId),
        eq(salesOpsLeadStages.status, 'active'),
        eq(salesOpsLeadStages.kind, 'normal'),
      ),
    )
    .orderBy(asc(salesOpsLeadStages.position), asc(salesOpsLeadStages.name))
    .limit(1);
  return stage ?? null;
}

/**
 * The position that appends a card at the END of a column: one past the highest
 * LIVE position. A deleted lead keeps its stale position, and counting it would
 * leave a gap the moment the card above it is appended. The caller holds
 * `lockLeadBoard`, which is what makes two appends unable to share a number.
 */
export async function nextLeadPosition(tx: Db, orgId: string, stageId: string): Promise<number> {
  const [{ next }] = (await tx
    .select({ next: sql<number>`COALESCE(MAX(${salesOpsLeads.position}), 0) + 1` })
    .from(salesOpsLeads)
    .where(
      and(eq(salesOpsLeads.orgId, orgId), eq(salesOpsLeads.stageId, stageId), liveLeadCondition()),
    )) as [{ next: number }];
  return next;
}
```

In `insertLead`, replace the inline stage query with `const stage = await firstOpenLeadStage(tx, orgId);` (keep the `if (!stage) throw new LeadInputError('no_open_stage');` line and its comment; keep a one-line comment "A new lead always lands in the first ACTIVE normal stage by board order."), and replace the inline `MAX(position)` query with `const next = await nextLeadPosition(tx, orgId, stage.id);`.
The `"position" is double-quoted...` comment moves into nothing (drop it; the helper uses the Drizzle column, not hand-written SQL).

4i. `applyLeadUpdate` UPDATE: `.where(and(eq(salesOpsLeads.orgId, orgId), eq(salesOpsLeads.id, id), liveLeadCondition()))`.
`moveLead` UPDATE: same change.
Comment on one of them (once): "// Live again here, not only in the identity read: belt and braces under READ COMMITTED, the row lock above already re-checked it."

4j. `renumberStage`: export it; its select becomes `.where(and(eq(salesOpsLeads.orgId, orgId), eq(salesOpsLeads.stageId, stageId), liveLeadCondition()))`.
Add to its doc: "Over LIVE cards only. A deleted card keeps its stale position untouched (it is irrelevant while deleted, and a restore appends at the end), and the raw UPDATE below can only reach ids this live read returned."

## Step 5 - `lead-schemas.ts`

After `ListLeadsQuerySchema` and its type export, add:

```ts
/**
 * The deleted-list keyset cursor: `<deleted_at as UTC ISO with MICROseconds>_<id>`.
 *
 * Microseconds and not the milliseconds a JS Date carries, because timestamptz
 * stores microseconds: a millisecond cursor would sit between two rows deleted
 * in the same millisecond and silently skip the later one. The server renders
 * it with to_char and parses it back with ::timestamptz, so it round-trips
 * exactly. The day goes through isIsoDay so an impossible date (2026-02-30) is
 * a 400 here and never a Postgres cast error (a 500).
 */
const DELETED_CURSOR_RE =
  /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{6}Z_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const ListDeletedLeadsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(LEADS_MAX_LIMIT).optional(),
  cursor: z
    .string()
    .regex(DELETED_CURSOR_RE)
    .refine((value) => isIsoDay(value.slice(0, 10)), {
      message: 'cursor day must be a real calendar day',
    })
    .optional(),
});

export type ListDeletedLeadsQuery = z.infer<typeof ListDeletedLeadsQuerySchema>;
```

`isIsoDay` is already imported in this file.

## Step 6 - NEW `apps/api/src/domains/sales-ops/leads/lead-trash-service.ts`

Exact content shape (comments explain why; keep them):

```ts
import { and, desc, eq, isNotNull, sql, type SQL } from 'drizzle-orm';
import type { getDb } from '../../../db/client.js';
import { salesOpsLeadStages, salesOpsLeads } from '../../../db/schema.js';
import { writeAuditEntry } from '../../audit/service.js';
import { LEADS_DEFAULT_LIMIT, type ListDeletedLeadsQuery } from './lead-schemas.js';
import {
  LeadInputError,
  type LeadScope,
  type LeadView,
  firstOpenLeadStage,
  leadIdentityConditions,
  liveLeadCondition,
  lockLeadBoard,
  nextLeadPosition,
  readLeadView,
  renumberStage,
  resolveLeadScopePredicate,
} from './lead-service.js';
import { withTenant } from './with-tenant.js';
```

File doc comment (top, after imports) must say:
- This is the lead lixeira: soft delete, restore and the deleted list.
- It is the ONE lead file that writes the ledger. Moves stay unaudited in `lead-service.ts` (high-frequency noise behind a global tail lock); a delete or restore is a rare, deliberate act the gestor must be able to trace, so it is audited like an archive.
- It never claims a lead (no seller column is written) and never seeds an etapa.
- Lock order: scope gate, `lockLeadBoard`, card row `FOR UPDATE`, renumber, ledger entry LAST.

Types and helpers:

```ts
type Db = ReturnType<typeof getDb>;

/** Who deletes or restores, from the VERIFIED context only (route boundary). */
export type LeadActor = { userId: string; name: string | null };

export type DeleteLeadResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'seller_person_unmapped' | 'already_converted' };

export type RestoreLeadResult = { ok: true; lead: LeadView } | { ok: false; reason: 'not_found' };

/** One row of Cadastros > Leads excluídos. `id` is the restore key and is never rendered. */
export type DeletedLeadView = {
  id: string;
  contactName: string;
  clientName: string;
  stageName: string;
  sellerName: string;
  estimatedValueBrl: number;
  deletedAt: string;
  deletedByName: string | null;
};

export type ListDeletedLeadsResult = { items: DeletedLeadView[]; nextCursor: string | null };

/** The inverse of liveLeadCondition(), for the two reads that want deleted rows on purpose. */
function deletedLeadCondition(): SQL {
  return isNotNull(salesOpsLeads.deletedAt);
}

/** The etapa's CURRENT name, for the ledger snapshot. The composite FK guarantees the row. */
async function stageName(tx: Db, orgId: string, stageId: string): Promise<string> {
  const [stage] = await tx
    .select({ name: salesOpsLeadStages.name })
    .from(salesOpsLeadStages)
    .where(and(eq(salesOpsLeadStages.orgId, orgId), eq(salesOpsLeadStages.id, stageId)))
    .limit(1);
  return stage?.name ?? '';
}
```

`deleteLead(db, orgId, id, scope, actor)`:

```ts
export function deleteLead(
  db: Db,
  orgId: string,
  id: string,
  scope: LeadScope,
  actor: LeadActor,
): Promise<DeleteLeadResult> {
  return withTenant(db, orgId, async (tx) => {
    // The same gate every lead read uses: an admin reaches any live lead, an
    // active vendedor his own and the unassigned pool, anyone else his own. A
    // lead outside it is not_found, never forbidden (a 403 confirms the row).
    const gate = await resolveLeadScopePredicate(tx, orgId, scope);
    if (!gate.ok) return { ok: false, reason: gate.reason } as const;
    // Before the card's row lock: a delete renumbers the column, so it is a board
    // writer and takes the one lock order (see lockLeadBoard).
    await lockLeadBoard(tx, orgId);

    const [current] = await tx
      .select()
      .from(salesOpsLeads)
      .where(and(...leadIdentityConditions(orgId, id, gate)))
      .limit(1)
      .for('update');
    // Already deleted is not_found too: leadIdentityConditions carries the live predicate.
    if (!current) return { ok: false, reason: 'not_found' } as const;
    // A converted card belongs to its proposta; deleting it would orphan the link.
    if (current.saleId !== null) return { ok: false, reason: 'already_converted' } as const;

    const fromStage = await stageName(tx, orgId, current.stageId);
    const deletedAt = new Date();
    // No seller column, no stage_id, no position: a delete never claims a pool
    // lead and keeps the etapa a restore returns it to.
    await tx
      .update(salesOpsLeads)
      .set({
        deletedAt,
        deletedByUserId: actor.userId,
        deletedByName: actor.name,
        updatedAt: deletedAt,
      })
      .where(and(eq(salesOpsLeads.orgId, orgId), eq(salesOpsLeads.id, id), liveLeadCondition()));

    // The column closes the gap at once, so it stays 1..N over live cards.
    await renumberStage(tx, orgId, current.stageId, null);

    // LAST: the ledger tail lock is global and held until COMMIT.
    await writeAuditEntry(tx, {
      actorUserId: actor.userId,
      // Never null: the org-scoped history read filters on actor_org_id.
      actorOrgId: orgId,
      action: 'lead.deleted',
      entityType: 'lead',
      entityId: id,
      beforeJsonb: { deleted: false },
      afterJsonb: {
        deleted: true,
        label: current.contactName,
        actorLabel: actor.name,
        metadata: {
          contactName: current.contactName,
          clientName: current.clientNameSnapshot,
          stageName: fromStage,
          sellerName: current.sellerNameSnapshot,
        },
      },
    });
    return { ok: true } as const;
  });
}
```

`restoreLead(db, orgId, id, actor)` (admin-only at the route; the service takes no scope):

```ts
export function restoreLead(
  db: Db,
  orgId: string,
  id: string,
  actor: LeadActor,
): Promise<RestoreLeadResult> {
  return withTenant(db, orgId, async (tx) => {
    // A restore writes stage_id and position: same lock order as every board writer.
    await lockLeadBoard(tx, orgId);

    const [current] = await tx
      .select()
      .from(salesOpsLeads)
      .where(and(eq(salesOpsLeads.orgId, orgId), eq(salesOpsLeads.id, id), deletedLeadCondition()))
      .limit(1)
      .for('update');
    // A live, unknown or other-org id: there is nothing to restore.
    if (!current) return { ok: false, reason: 'not_found' } as const;

    const [own] = await tx
      .select({ id: salesOpsLeadStages.id, name: salesOpsLeadStages.name, status: salesOpsLeadStages.status })
      .from(salesOpsLeadStages)
      .where(and(eq(salesOpsLeadStages.orgId, orgId), eq(salesOpsLeadStages.id, current.stageId)))
      .limit(1);
    // Its own etapa when it is still on the board; an archived etapa is not a
    // move target, so the lead goes where a new lead would. Never seeds one: the
    // leads edition may have none, and that is the existing 400.
    const target =
      own && own.status === 'active' ? { id: own.id, name: own.name } : await firstOpenLeadStage(tx, orgId);
    if (!target) throw new LeadInputError('no_open_stage');

    const stageChanged = target.id !== current.stageId;
    const position = await nextLeadPosition(tx, orgId, target.id);
    await tx
      .update(salesOpsLeads)
      .set({
        deletedAt: null,
        deletedByUserId: null,
        deletedByName: null,
        stageId: target.id,
        position,
        // KEY OMISSION, the moveLead rule: stage_changed_at moves only when the
        // etapa changes. The fallback target is a normal etapa, which carries no
        // lost reason, so the reason is cleared with it.
        ...(stageChanged ? { stageChangedAt: new Date(), lostReason: null } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(salesOpsLeads.orgId, orgId), eq(salesOpsLeads.id, id), deletedLeadCondition()));
    // Appended at the end; the renumber keeps the column dense even if it was not.
    await renumberStage(tx, orgId, target.id, null);

    const lead = await readLeadView(tx, orgId, id);
    // LAST: the ledger tail lock is global and held until COMMIT. A restore is a
    // NEW entry, never an undo of the delete entry.
    await writeAuditEntry(tx, {
      actorUserId: actor.userId,
      actorOrgId: orgId,
      action: 'lead.restored',
      entityType: 'lead',
      entityId: id,
      beforeJsonb: { deleted: true, stageName: own?.name ?? '' },
      afterJsonb: {
        deleted: false,
        label: current.contactName,
        actorLabel: actor.name,
        metadata: {
          contactName: current.contactName,
          clientName: current.clientNameSnapshot,
          stageName: target.name,
          sellerName: current.sellerNameSnapshot,
        },
      },
    });
    return { ok: true, lead } as const;
  });
}
```

`listDeletedLeads(db, orgId, query)` (admin-only at the route):

```ts
export function listDeletedLeads(
  db: Db,
  orgId: string,
  query: ListDeletedLeadsQuery,
): Promise<ListDeletedLeadsResult> {
  return withTenant(db, orgId, async (tx) => {
    const conditions: SQL[] = [eq(salesOpsLeads.orgId, orgId), deletedLeadCondition()];
    if (query.cursor) {
      const [deletedAt, cursorId] = query.cursor.split('_');
      conditions.push(
        sql`(${salesOpsLeads.deletedAt}, ${salesOpsLeads.id}) < (${deletedAt}::timestamptz, ${cursorId}::uuid)`,
      );
    }
    const limit = query.limit ?? LEADS_DEFAULT_LIMIT;
    const rows = await tx
      .select({
        id: salesOpsLeads.id,
        contactName: salesOpsLeads.contactName,
        clientName: salesOpsLeads.clientNameSnapshot,
        // The etapa's CURRENT name, joined live, so a renamed etapa reads renamed.
        stageName: salesOpsLeadStages.name,
        sellerName: salesOpsLeads.sellerNameSnapshot,
        estimatedValueBrl: salesOpsLeads.estimatedValueBrl,
        deletedAt: salesOpsLeads.deletedAt,
        deletedByName: salesOpsLeads.deletedByName,
        // Rendered by Postgres with all six fractional digits: see the cursor
        // comment in lead-schemas.ts for why a JS Date cannot build it.
        cursorAt: sql<string>`to_char(${salesOpsLeads.deletedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(salesOpsLeads)
      .innerJoin(
        salesOpsLeadStages,
        and(eq(salesOpsLeadStages.orgId, salesOpsLeads.orgId), eq(salesOpsLeadStages.id, salesOpsLeads.stageId)),
      )
      .where(and(...conditions))
      .orderBy(desc(salesOpsLeads.deletedAt), desc(salesOpsLeads.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);
    return {
      // Projected field by field: deleted_by_user_id is never selected, so it can
      // never reach a client.
      items: page.map((row) => ({
        id: row.id,
        contactName: row.contactName,
        clientName: row.clientName,
        stageName: row.stageName,
        sellerName: row.sellerName,
        estimatedValueBrl: row.estimatedValueBrl,
        deletedAt: row.deletedAt!.toISOString(),
        deletedByName: row.deletedByName,
      })),
      nextCursor: hasMore && last ? `${last.cursorAt}_${last.id}` : null,
    };
  });
}
```

Do not mention the word `claimantFor` in this file (the contract test asserts it is absent).

## Step 7 - Routes (`lead-routes.ts`)

7a. Imports: add `import { getHubActorDisplayName } from '../../../middleware/app-auth.js';`, `import { requireAdmin } from '../../../middleware/require-admin.js';`, `ListDeletedLeadsQuerySchema` to the `./lead-schemas.js` import, and

```ts
import { type LeadActor, deleteLead, listDeletedLeads, restoreLead } from './lead-trash-service.js';
```

7b. Router doc comment: replace the paragraph "There is NO DELETE verb here and there must never be one. A lead that goes nowhere ends in the terminal `lost` stage, which is what that stage is for." with:
"There is still NO DELETE verb here and there must never be one. A lead that merely goes nowhere ends in the terminal `lost` stage, which is what that stage is for. Removing a lead by mistake or as junk is the lixeira: `POST /:id/delete` is a SOFT delete (a POST action like `/move`) that the gestor reverses with `POST /:id/restore`, both audited in lead-trash-service.ts."

7c. Below `leadScope`, add:

```ts
/**
 * Who deletes or restores, from the VERIFIED context only. The name is the one
 * snapshot rule the cadastro ledger already uses (`getHubActorDisplayName`:
 * name, then e-mail, then null, never the account id), taken here because the
 * act is the only moment it is knowable.
 */
function leadActor(c: Context): LeadActor {
  return { userId: c.get('userId'), name: getHubActorDisplayName(c.get('hubAuth')) };
}
```

7d. Register `GET /deleted` AFTER `leadsRouter.post('/', ...)` and BEFORE `leadsRouter.get('/:id', ...)`:

```ts
// Static paths sit ABOVE '/:id' (this one and slice 02's '/summary'): Hono runs
// matching handlers in registration order, and '/:id' would otherwise take
// 'deleted' as an id and answer 404.
// Admin only: the lixeira is the gestor's screen in both editions.
leadsRouter.get('/deleted', requireAdmin, async (c) => {
  const parsed = ListDeletedLeadsQuerySchema.safeParse({
    limit: c.req.query('limit'),
    cursor: c.req.query('cursor'),
  });
  if (!parsed.success) return validationResponse(c, parsed.error);
  const page = await listDeletedLeads(getDb(), c.get('orgId'), parsed.data);
  return c.json({ items: page.items, nextCursor: page.nextCursor });
});
```

7e. After `leadsRouter.post('/:id/move', ...)` add:

```ts
// Open to every board caller: the scope gate inside the service decides which
// leads he may delete (exactly the ones he can read). 204 with no body.
leadsRouter.post('/:id/delete', async (c) => {
  const id = leadIdSchema.safeParse(c.req.param('id'));
  if (!id.success) return c.json({ error: 'not_found' }, 404);
  const result = await deleteLead(getDb(), c.get('orgId'), id.data, leadScope(c), leadActor(c));
  if (!result.ok) return failureResponse(c, result.reason);
  return c.body(null, 204);
});

// Admin only (requireAdmin, the one admin mechanism): a vendedor never sees the
// lixeira, so he can never bring a lead back either.
leadsRouter.post('/:id/restore', requireAdmin, async (c) => {
  const id = leadIdSchema.safeParse(c.req.param('id'));
  if (!id.success) return c.json({ error: 'not_found' }, 404);
  try {
    const result = await restoreLead(getDb(), c.get('orgId'), id.data, leadActor(c));
    if (!result.ok) return failureResponse(c, result.reason);
    return c.json({ lead: result.lead });
  } catch (error) {
    if (error instanceof LeadInputError) return leadInputErrorResponse(c, error);
    throw error;
  }
});
```

`failureResponse`'s reason union already covers every delete and restore reason; leave its signature as is.
No `requireCapability` is added: `/leads` is open in every edition (`routes.ts` banner), and both editions need the lixeira.

## Step 8 - Edition gate map

`apps/api/src/middleware/__tests__/edition-gate-map.test.ts`, append to `OPEN` after the `/leads/:id/move` entry:

```ts
  r('salesOps', 'GET', '/leads/deleted', `${SO}/leads/deleted`),
  r('salesOps', 'POST', '/leads/:id/delete', `${SO}/leads/${ID}/delete`),
  r('salesOps', 'POST', '/leads/:id/restore', `${SO}/leads/${ID}/restore`),
```

`requireAdmin` is not an edition gate, so they are OPEN; the owner tokens are admins, reach the handler and hit the throwing fake DB (500, not the edition 403).
Slice 02 adds its own `/leads/summary` entry later.

## Step 9 - Tests

### 9a. Pure migration oracle (NEW) `apps/api/src/db/__tests__/lead-soft-delete-schema.test.ts`

Copy the structure of `lead-contact-fields-schema.test.ts` (same helpers `journal`, `migrationSql`, `migrationStatements`, `snapshot`), `TAG = '0028_lead_soft_delete'`.
Cases:
1. `journals 0028_lead_soft_delete immediately after 0027_lead_contact_fields`: `idx: 28`, previous `{ idx: 27, tag: '0027_lead_contact_fields' }`, `when` greater.
2. `ships exactly the three columns, the partial index and the pair CHECK`: `migrationStatements()` `toEqual` the five statements of Step 2a (each ending in `;`).
3. `is an ordinary migration with no phase header or marker` (no `fxl-migration-mode`, no `fxl-phase`).
4. `chains the 0028 snapshot to 0027 and records columns, index and check`: `current.prevId === previous.id`; for each of `deleted_at` (`timestamp with time zone`), `deleted_by_user_id` (`text`), `deleted_by_name` (`text`): `toEqual({ name, type, primaryKey: false, notNull: false })`; `checkConstraints.sales_ops_leads_deleted_pair_check.value` equals `("sales_ops_leads"."deleted_at" is null) = ("sales_ops_leads"."deleted_by_user_id" is null)`; `indexes.sales_ops_leads_org_deleted_idx.where` equals `"sales_ops_leads"."deleted_at" is not null` and its column expressions are `['org_id', 'deleted_at', 'id']`; 0027 snapshot has no `deleted_at`.
   Extend the local `Snapshot` type with optional `checkConstraints` and `indexes` records.
5. `exposes the lixeira columns on the Drizzle table`: `salesOpsLeads.deletedAt.name === 'deleted_at'`, `columnType === 'PgTimestamp'`; the other two names; via `getTableConfig(salesOpsLeads)` the three columns are `notNull === false`, `hasDefault === false`; `config.checks.map((c) => c.name)` contains `sales_ops_leads_deleted_pair_check`; `config.indexes.find((i) => i.config.name === 'sales_ops_leads_org_deleted_idx')?.config.where` is defined.

### 9b. Integration migration oracle (NEW) `apps/api/test/rls/lead-soft-delete-migration.test.ts`

Copy the harness of `lead-contact-fields-migration.test.ts` (admin client with `app.fxl_admin`, `newOrg`, `insertStage`, afterAll deleting leads then stages per org).
Cases:
1. `adds three nullable columns with no default`: information_schema rows for the three names ordered by column_name equal `[{deleted_at, 'timestamp with time zone', 'YES', null}, {deleted_by_name, 'text', 'YES', null}, {deleted_by_user_id, 'text', 'YES', null}]`.
2. `refuses a half-deleted row`: raw INSERT with `deleted_at = now()` and no `deleted_by_user_id` rejects matching `/sales_ops_leads_deleted_pair_check/`; raw INSERT with `deleted_by_user_id = 'hub_x'` and no `deleted_at` rejects the same; positive controls: both NULL resolves; both set with `deleted_by_name` NULL resolves.
   `pg_get_constraintdef` of `conname = 'sales_ops_leads_deleted_pair_check'` matches `/\(deleted_at IS NULL\) = \(deleted_by_user_id IS NULL\)/`.
3. `indexes deleted rows only`: `SELECT indexdef FROM pg_indexes WHERE indexname = 'sales_ops_leads_org_deleted_idx'` matches `/\(org_id, deleted_at, id\) WHERE \(deleted_at IS NOT NULL\)/`.
4. `reads every pre-0028 lead as live`: raw INSERT with the 0027 test's column list, then `deleted_at`, `deleted_by_user_id`, `deleted_by_name` all NULL; positive control `count(*) = 1` in the org.

### 9c. Existing `apps/api/test/rls/leads-schema-migration.test.ts`

In `declares sales_ops_leads with an integer-cents estimate...`, insert between the `created_at` row and the `description` row:

```ts
      { column_name: 'deleted_at', data_type: 'timestamp with time zone', is_nullable: 'YES' },
      { column_name: 'deleted_by_name', data_type: 'text', is_nullable: 'YES' },
      { column_name: 'deleted_by_user_id', data_type: 'text', is_nullable: 'YES' },
```

### 9d. THE oracle (NEW) `apps/api/test/rls/leads-lixeira.test.ts`

Header doc: what it proves, that writes go over the APP connection (tenant role, RLS live) and the admin `postgres.Sql` is only for fixtures, raw assertions, probe triggers and cleanup, and the run command.

Harness (copy from `leads-unassigned-claim.test.ts` plus the real-router bits of `src/domains/import/__tests__/import-routes.integration.test.ts`):
- At the very top, the `vi.hoisted(() => { for (const name of ['FXL_HUB_CONFIG','FXL_HUB_API_URL','FXL_HUB_ENVIRONMENT','FXL_HUB_CLIENT_ID','FXL_HUB_CLIENT_SECRET','FXL_HUB_AUDIENCE','SALES_ENV_FILE','SALES_AUTH_FAKE']) process.env[name] = ''; })` block, verbatim from the import routes test, because `lead-routes.ts` now imports `middleware/app-auth.js`, which resolves the Hub contract at module scope.
- Static imports: `randomUUID`, `drizzle`, `Hono`, `postgres`, vitest (`afterAll, beforeAll, describe, expect, it, vi`), `schema`, `testDatabaseUrls`, `firstRow`, `hubAuthContext` (`../../src/auth/__tests__/hub-auth-context-fixture.js`), `computeEntryHash` (`../../src/domains/audit/service.js`), `closeDb` (`../../src/db/client.js`), the lead schemas (`CreateContactLeadSchema`, `CreateLeadSchema`, `ListLeadsQuerySchema`, `MoveLeadSchema`, `UpdateLeadSchema`), lead-service (`LeadInputError`, `type LeadScope`, `type LeadView`, `type WriteLeadResult`, `createContactLead`, `createLead`, `getLead`, `listLeads`, `moveLead`, `updateLead`), lead-trash-service (`type LeadActor`, `deleteLead`, `listDeletedLeads`, `restoreLead`), `LeadStageSchema`, `createLeadStage`, `updateLeadStage`, `ensureLeadStagesForOrg`, `PersonSchema`, `createPerson`.
- Then `const { leadsRouter } = await import('../../src/domains/sales-ops/leads/lead-routes.js');`.
- Constants: `ADMIN_SCOPE: LeadScope = { userId: 'hub_admin', email: null, isAdmin: true }`; `ADMIN_ACTOR: LeadActor = { userId: 'hub_admin', name: 'Gestora Teste' }`; `sellerScope(userId)`, `leadsSellerScope(userId)` and `okLead` exactly as in `leads-unassigned-claim.test.ts`; `NOT_FOUND = { ok: false, reason: 'not_found' } as const`.
- Connections: `appClient` (max 5), `adminClient` (max 2, `app.fxl_admin`), `db = drizzle(appClient, { schema })`. Every service call uses `db`.
- Fixtures copied from `leads-unassigned-claim.test.ts`: `newOrg` (prefix `org_lix_`), `vendedor(orgId, name, account, leads?)`, `fullWorld(label)` (seeded etapas `Novo`/`Em negociação`/`Proposta`/`Perdido`, vendedores Ana `hub_ana` and Bruno `hub_bruno`), `fullLead(orgId, contactName, sellerPersonId?)` (clientName `Empresa Pool`, estimatedValueBrl 100000, filed by ADMIN_SCOPE).
- Raw helpers over `adminClient`: `rowOf(id)` selecting `seller_person_id, seller_name_snapshot, stage_id, "position", contact_name, lost_reason, stage_changed_at, deleted_at, deleted_by_user_id, deleted_by_name, updated_at`; `auditFor(entityId)` selecting `actor_user_id, actor_org_id, action, entity_type, entity_id, before_jsonb, after_jsonb, request_id, prev_hash, entry_hash ORDER BY id`; `livePositions(orgId, stageId)` returning `contact_name, "position"` of live rows ordered by position; `board(orgId, stageId, scope)` = `listLeads(db, ...)` that throws on refusal.
- `expectEntryHashValid(row)`: recompute `computeEntryHash(row.prev_hash, { actorUserId, actorOrgId, action, entityType, entityId, beforeJsonb, afterJsonb, requestId })` from the raw row and expect it to equal `row.entry_hash`.
- `expectProbeRejection(promise)`: copy `expectRollbackProbeRejection` from `cadastro-archive-audit.test.ts`, matching `/fxl_lixeira_commit_probe/`.
- afterAll: for every org, delete `audit_log WHERE actor_org_id = org` FIRST (our entries are the ledger tail because `fileParallelism: false`), then the table list of `leads-unassigned-claim.test.ts`; then `DROP TRIGGER IF EXISTS fxl_lixeira_commit_probe_trg ON sales_ops_leads` and `DROP FUNCTION IF EXISTS fxl_lixeira_commit_probe()`; then `await closeDb()`, `appClient.end()`, `adminClient.end()`.

Probe trigger (used by cases 5 and 7), created and dropped inside `try/finally` over `adminClient.unsafe`:

```sql
CREATE OR REPLACE FUNCTION fxl_lixeira_commit_probe() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'fxl_lixeira_commit_probe'; END $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER fxl_lixeira_commit_probe_trg AFTER UPDATE ON sales_ops_leads
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.id = '<lead id>')
  EXECUTE FUNCTION fxl_lixeira_commit_probe();
```

Cases (each `it` builds its own world):

1. `an admin deletes any live lead: it leaves every read, the column renumbers dense, and nothing claims it`
   - `w = fullWorld('admin')`; `a = fullLead('A', w.bruno.id)`, `b = fullLead('B')`, `c = fullLead('C', w.ana.id)` (open column, positions 1,2,3).
   - `deleteLead(db, w.orgId, a.id, ADMIN_SCOPE, ADMIN_ACTOR)` equals `{ ok: true }`.
   - `rowOf(a.id)`: `deleted_at` not null, `deleted_by_user_id === 'hub_admin'`, `deleted_by_name === 'Gestora Teste'`, `stage_id === w.open.id`, `seller_person_id === w.bruno.id`, `seller_name_snapshot === 'Bruno Lima'`, `position === 1` (stale, untouched).
   - `board(w.orgId, w.open.id, ADMIN_SCOPE)`: names `['B','C']`, `total === 2`, positions `[1,2]`.
   - `getLead`, `updateLead(UpdateLeadSchema.parse({ contactName: 'X' }))` and `moveLead(MoveLeadSchema.parse({ stageId: w.second.id, position: 0 }))` on `a.id` with ADMIN_SCOPE all equal `NOT_FOUND`; `rowOf(a.id).contact_name === 'A'`, `stage_id === w.open.id`.
   - A second `deleteLead` on `a.id` equals `NOT_FOUND`.
   - `auditFor(a.id)` has length 1: `actor_user_id 'hub_admin'`, `actor_org_id w.orgId`, `action 'lead.deleted'`, `entity_type 'lead'`, `before_jsonb { deleted: false }`, `after_jsonb { deleted: true, label: 'A', actorLabel: 'Gestora Teste', metadata: { contactName: 'A', clientName: 'Empresa Pool', stageName: 'Novo', sellerName: 'Bruno Lima' } }`, `expectEntryHashValid`.
2. `create, move and renumber ignore a deleted card`
   - `w`; `a`,`b`,`c` in open (1,2,3); delete `c` (the LAST, so an unfiltered MAX would answer 4).
   - `d = fullLead('D')`: `d.position === 3`.
   - `moveLead(b.id, { stageId: w.open.id, position: 0 }, ADMIN_SCOPE)` ok; `livePositions` equals `[['B',1],['A',2],['D',3]]`; `rowOf(c.id).position === 3` (the deleted row was never renumbered); `board(...).total === 3`.
   - Then delete `b` (now FIRST): `livePositions` equals `[['A',1],['D',2]]` (an unfiltered renumber would keep B in the sequence).
3. `an active vendedor deletes exactly what he can read and never claims`
   - `w`; `own = fullLead('Ana propria', w.ana.id)`, `pool = fullLead('Pool')`, `brunos = fullLead('Bruno proprio', w.bruno.id)`; `ana = sellerScope('hub_ana')`, `ANA_ACTOR = { userId: 'hub_ana', name: 'Ana Martins' }`.
   - `deleteLead(brunos.id, ana, ANA_ACTOR)` equals `NOT_FOUND`; `rowOf(brunos.id).deleted_at` null; `auditFor(brunos.id)` empty.
   - `deleteLead(pool.id, ana, ANA_ACTOR)` ok; `rowOf(pool.id)`: `seller_person_id` null, `seller_name_snapshot ''`, `deleted_by_user_id 'hub_ana'`, `deleted_by_name 'Ana Martins'`; audit metadata `sellerName ''`.
   - `deleteLead(own.id, ana, ANA_ACTOR)` ok.
   - `board(open, ana).total === 0`; `board(open, ADMIN_SCOPE)` names `['Bruno proprio']`.
   - Not an active vendedor: `pool2 = fullLead('Pool 2')`; raw `UPDATE sales_ops_people SET status = 'inactive'` for Ana (raw on purpose: `updatePerson` with a status change writes ledger rows); `deleteLead(pool2.id, ana, ANA_ACTOR)` equals `NOT_FOUND`; `rowOf(pool2.id).deleted_at` null.
   - Unmapped caller: `deleteLead(pool2.id, sellerScope('hub_nobody'), { userId: 'hub_nobody', name: null })` equals `{ ok: false, reason: 'seller_person_unmapped' }`; no audit for `pool2.id`.
4. `a converted lead cannot be deleted and nothing is written`
   - `w`; `lead = fullLead('Convertido')`; insert a sale with the exact raw INSERT of `leads-unassigned-claim.test.ts` (code `PROP-LIX-1`); `moveLead(lead.id, { stageId: w.conversion.id, position: 0, saleId }, ADMIN_SCOPE)` ok.
   - `deleteLead(lead.id, ADMIN_SCOPE, ADMIN_ACTOR)` equals `{ ok: false, reason: 'already_converted' }`; `rowOf(lead.id).deleted_at` null; `auditFor(lead.id)` empty; `getLead` still ok.
5. `the delete and its ledger entry commit together`
   - `w`; `lead = fullLead('Sentinela')`; arm the probe on `lead.id`; `expectProbeRejection(deleteLead(...ADMIN...))`; in `finally` drop trigger and function.
   - `rowOf(lead.id).deleted_at` null; `deleted_by_user_id` null; `auditFor(lead.id)` empty (with `db` instead of `tx` the entry would survive on its own connection).
6. `an admin restores a lead into its own etapa, at the end of the column, as a new ledger entry`
   - `w`; `a = fullLead('A')`, `b = fullLead('B', w.bruno.id)`; `before = rowOf(a.id).stage_changed_at`.
   - Delete `a` (ADMIN_ACTOR); `c = fullLead('C')` (`c.position === 2`).
   - `RESTORER: LeadActor = { userId: 'hub_admin_2', name: 'Outra Gestora' }`; `restored = okLead(await restoreLead(db, w.orgId, a.id, RESTORER))` (the result shape matches `WriteLeadResult` ok; if the type differs write a local `okRestore`).
   - `restored.stageId === w.open.id`, `restored.position === 3`, `restored.stageChangedAt === before.toISOString()`; `rowOf(a.id)` has the three deleted columns null; `livePositions` equals `[['B',1],['C',2],['A',3]]`; `getLead(a.id, ADMIN_SCOPE).ok === true`.
   - `auditFor(a.id)` length 2: `[0].action 'lead.deleted'`, `[1]`: `action 'lead.restored'`, `actor_user_id 'hub_admin_2'`, `before_jsonb { deleted: true, stageName: 'Novo' }`, `after_jsonb { deleted: false, label: 'A', actorLabel: 'Outra Gestora', metadata: { contactName: 'A', clientName: 'Empresa Pool', stageName: 'Novo', sellerName: '' } }`, `[1].prev_hash === [0].entry_hash` (createLead writes no ledger row in between), `expectEntryHashValid` on both.
   - `restoreLead(a.id)` again equals `NOT_FOUND` (live); `restoreLead(randomUUID())` equals `NOT_FOUND`.
   - Lost keeps its reason: `moveLead(b.id, { stageId: w.lost.id, position: 0, reason: 'sem verba' })`; delete `b`; restore `b` -> `stageId === w.lost.id`, `lostReason === 'sem verba'`.
7. `the restore and its ledger entry commit together`
   - `w`; `lead = fullLead('Sentinela restore')`; delete it normally; arm the probe on `lead.id`; `expectProbeRejection(restoreLead(...))`; drop in `finally`.
   - `rowOf(lead.id).deleted_at` NOT null (still deleted); `auditFor(lead.id)` length 1 (only `lead.deleted`).
8. `a lead whose etapa was archived restores into the first open etapa; with none the answer is no_open_stage`
   - `w`; `lead = fullLead('Arquivada')`; `moveLead(lead.id, { stageId: w.second.id, position: 0 })`; `s1 = rowOf(lead.id).stage_changed_at`; `fullLead('Ja no Novo')` (open has 1 live card now).
   - Delete `lead`; `updateLeadStage(db, w.orgId, w.second.id, { status: 'archived' })` returns a row with `status 'archived'`.
   - `restoreLead` -> `stageId === w.open.id`, `position === 2`, `lostReason === null`, `new Date(stageChangedAt) > s1`; audit restored `before_jsonb.stageName === 'Em negociação'`, `after_jsonb.metadata.stageName === 'Novo'`.
   - Leads edition, no open etapa: `org2 = newOrg('noopen')`; `unico = createLeadStage(db, org2, LeadStageSchema.parse({ name: 'Único' }))`; `carla = vendedor(org2, 'Carla', 'hub_carla', true)`; `contact = okLead(await createContactLead(db, org2, CreateContactLeadSchema.parse({ contactName: 'Contato' }), leadsSellerScope('hub_carla')))` (`sellerPersonId === carla.id`); `deleteLead(db, org2, contact.id, leadsSellerScope('hub_carla'), { userId: 'hub_carla', name: 'Carla' })` ok (the leads edition deletes through the same gate); archive `unico`; `await expect(restoreLead(db, org2, contact.id, ADMIN_ACTOR)).rejects.toBeInstanceOf(LeadInputError)` and a second call `rejects.toMatchObject({ code: 'no_open_stage' })`; `rowOf(contact.id).deleted_at` not null; `auditFor(contact.id)` length 1; `SELECT count(*) FROM sales_ops_lead_stages WHERE org_id = org2` is still 1 (never seeds).
9. `the deleted list is newest first, keyset-paginated to the microsecond, scoped to its org and never carries the actor id`
   - `w` (org A); leads `l1..l4` via `fullLead` (l2 with `w.ana.id`); delete l1 and l2 with ADMIN_ACTOR, l3 with `{ userId: 'hub_admin', name: null }`, l4 with ADMIN_ACTOR; `live = fullLead('Viva')` stays live.
   - Raw admin SQL fixes the instants: l1 `'2026-10-01T12:00:00.123456Z'`, l2 and l3 `'2026-10-01T12:00:00.123400Z'` (a tie), l4 `'2026-10-01T11:00:00Z'`.
   - Expected order: `[l1, ...[l2, l3] sorted by id DESC (string compare of the uuid text, which matches Postgres uuid order for lowercase hex), l4]`.
   - Page with `limit: 1` in a loop until `nextCursor === null` (guard at 10 iterations): the concatenated ids equal the expected order, 4 pages, every non-null `nextCursor` matches `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z_[0-9a-f-]{36}$/`, and the first page's cursor starts with `2026-10-01T12:00:00.123456Z_`. (A millisecond cursor would skip l2 or l3: this is the discriminating assertion.)
   - `listDeletedLeads(db, w.orgId, {})` returns the same 4 ids and `nextCursor === null`; `live.id` is absent.
   - Every item's `Object.keys(item).sort()` equals `['clientName','contactName','deletedAt','deletedByName','estimatedValueBrl','id','sellerName','stageName']`; `JSON.stringify(page)` contains neither `hub_admin` nor `hub_ana`; l3's `deletedByName === null`; l1's `deletedByName === 'Gestora Teste'`, `clientName 'Empresa Pool'`, `estimatedValueBrl 100000`, `deletedAt === '2026-10-01T12:00:00.123Z'`; l2's `sellerName === 'Ana Martins'`.
   - Rename: `updateLeadStage(db, w.orgId, w.open.id, { name: 'Prospecção' })`; every item's `stageName === 'Prospecção'`.
   - Org B: `wb = fullWorld('other')`; `lb = fullLead(wb.orgId, 'De B')`; delete it; `listDeletedLeads(db, wb.orgId, {})` ids equal `[lb.id]`; A's list does not contain `lb.id`.
   - Cross-org writes: `deleteLead(db, wb.orgId, live.id, ADMIN_SCOPE, ADMIN_ACTOR)` and `restoreLead(db, wb.orgId, l1.id, ADMIN_ACTOR)` both equal `NOT_FOUND`; `rowOf(live.id).deleted_at` null; `rowOf(l1.id).deleted_at` not null.
10. `the real router: a vendedor deletes with 204, the lixeira answers him 403, the admin lists and restores`
   - `w`; `lead = fullLead('Rota', w.ana.id)`.
   - `app(identity)` builds `new Hono()` with a middleware setting `userId`, `orgId = w.orgId`, `userRole = roles[0]`, `userRoles = roles` (cast `as never` like `lead-routes.test.ts`), `hubAuth = hubAuthContext({ accountId: userId, workspaceId: w.orgId, name })`, then `app.route('/leads', leadsRouter)`.
   - `ana = app({ userId: 'hub_ana', roles: ['seller'], name: 'Ana Martins' })`; `admin = app({ userId: 'hub_admin', roles: ['admin','seller','finder'], name: 'Gestora Teste' })`.
   - `POST /leads/<id>/delete` as ana: status 204, `await res.text() === ''`.
   - `GET /leads/<id>` as ana: 404.
   - `POST /leads/<id>/restore` as ana: 403 and body `{ error: 'forbidden', reason: 'admin_role_required' }`; `GET /leads/deleted` as ana: 403 same body; `rowOf(lead.id).deleted_at` still not null.
   - `GET /leads/deleted` as admin: 200, `body.items.map((i) => i.id)` equals `[lead.id]`, `body.items[0].deletedByName === 'Ana Martins'`, `body.nextCursor === null`, raw response text does not contain `hub_ana`.
   - `POST /leads/<id>/restore` as admin: 200, `body.lead.id === lead.id`, `body.lead.sellerPersonId === w.ana.id`; then `GET /leads/<id>` as ana: 200.

### 9e. Route unit tests `apps/api/src/domains/sales-ops/leads/__tests__/lead-routes.test.ts`

Add a second hoisted mock set and module mock (no `importOriginal` needed; only types are imported from that module):

```ts
const trashMocks = vi.hoisted(() => ({
  deleteLead: vi.fn(),
  restoreLead: vi.fn(),
  listDeletedLeads: vi.fn(),
}));
vi.mock('../lead-trash-service.js', () => trashMocks);
```

In `beforeEach`, reset them and default: `deleteLead -> { ok: true }`, `restoreLead -> { ok: true, lead: leadView }`, `listDeletedLeads -> { items: [deletedView], nextCursor: null }` where `deletedView = { id: LEAD_ID, contactName: 'Ana Martins', clientName: 'Empresa Um', stageName: 'Novo', sellerName: '', estimatedValueBrl: 250000, deletedAt: '2026-10-07T12:00:00.000Z', deletedByName: 'Gestora' }`.
New cases:
1. `deletes through the verified scope and actor and answers 204 with no body`: `currentRoles = ['seller']`; `POST /leads/<LEAD_ID>/delete` (no body) -> 204, `text() === ''`; call args `[mockedDb, 'verified-org', LEAD_ID, { userId: 'verified-account', email: 'ana@example.test', isAdmin: false, name: null, hasSellerRole: true, edition: 'full' }, { userId: 'verified-account', name: 'ana@example.test' }]` (the fixture carries no `name`, so the snapshot falls back to the e-mail).
2. `maps every delete refusal onto the existing bodies`: `not_found` -> 404 `{ error: 'not_found' }`; `already_converted` -> 409 `{ error: 'conflict', reason: 'lead_already_converted' }`; `seller_person_unmapped` -> 403 `{ error: 'forbidden', reason: 'seller_person_unmapped' }`; `POST /leads/not-a-uuid/delete` -> 404 and `deleteLead` called exactly 3 times in total.
3. `restore is admin-only and maps its outcomes`: `currentRoles = ['seller']` -> 403 `{ error: 'forbidden', reason: 'admin_role_required' }`, `restoreLead` not called; admin -> 200 `{ lead: leadView }`, args `[mockedDb, 'verified-org', LEAD_ID, { userId: 'verified-account', name: 'ana@example.test' }]`; `{ ok: false, reason: 'not_found' }` -> 404; `mockRejectedValue(new LeadInputError('no_open_stage'))` -> 400 `{ error: 'validation_error', reason: 'no_open_stage', itemIndex: -1 }`.
4. `GET /leads/deleted is admin-only and never falls through to GET /leads/:id`: seller -> 403 admin body, `listDeletedLeads` and `getLead` not called; admin -> 200 `{ items: [deletedView], nextCursor: null }`, third arg `toEqual({})`; with `?limit=10&cursor=2026-10-01T12:00:00.123456Z_<LEAD_ID>` the third arg `toEqual({ limit: 10, cursor: '2026-10-01T12:00:00.123456Z_<LEAD_ID>' })`; `?limit=201` -> 400; `?cursor=7:<LEAD_ID>` -> 400; in the whole case `serviceMocks.getLead` is never called.
5. Extend `exposes no DELETE verb on any lead route` paths with `/leads/${LEAD_ID}/delete`, `/leads/${LEAD_ID}/restore` and `/leads/deleted`.

### 9f. Contract test `apps/api/src/domains/sales-ops/leads/__tests__/lead-contract.test.ts`

Update the header ("Pure: zod plus `readFileSync` source reads...") to say it now reads two source files and imports the audit action schema (no database).
Add `const leadTrashServiceSource = readFileSync(fileURLToPath(new URL('../lead-trash-service.ts', import.meta.url)), 'utf8');` and imports of `ListDeletedLeadsQuerySchema` and `AuditActionSchema`, `CADASTRO_LIFECYCLE_ACTIONS`, `CadastroEntityTypeSchema` from `../../../audit/service.js`.
New cases:
1. `accepts only a microsecond deleted-list cursor on a real day`: accepts `{}`, `{ limit: '10' }`, `{ cursor: '2026-10-01T12:00:00.123456Z_' + SALE_ID }`; rejects cursors `'7:' + SALE_ID`, `'2026-10-01T12:00:00.123Z_' + SALE_ID`, `'2026-13-01T12:00:00.123456Z_' + SALE_ID`, `'2026-02-30T12:00:00.123456Z_' + SALE_ID`, `'2026-10-01T24:00:00.123456Z_' + SALE_ID`, the valid cursor plus a trailing space; rejects `limit: '0'` and `limit: String(LEADS_MAX_LIMIT + 1)`.
2. `spells the live predicate once, in lead-service.ts`: `leadServiceSource.match(/isNull\(salesOpsLeads\.deletedAt\)/g)` has length 1; `leadServiceSource` matches `/export function liveLeadCondition\(\): SQL/`; `leadServiceSource` does not match `/from '\.\/lead-trash-service\.js'/`.
3. `keeps every audited lead act in lead-trash-service.ts`: trash source matches `writeAuditEntry\(tx,` exactly twice, matches `lockLeadBoard\(tx, orgId\)` exactly twice, does not match `/getAdminDb/`, does not match `/claimantFor/`, does not match `/ensureLeadStages/`. (The existing `lead-service.ts never reaches for the audit writer` case stays unchanged and must stay green.)
4. `adds the two lead actions without touching the cadastro lifecycle`: `AuditActionSchema.safeParse('lead.deleted').success` and `'lead.restored'` true; `CADASTRO_LIFECYCLE_ACTIONS` contains neither; `CadastroEntityTypeSchema.safeParse('lead').success === false`.

## Step 10 - Run commands (all run-once, from `apps/api`)

Unit oracles and the neighbours they could break:

```bash
pnpm exec vitest run src/db/__tests__/lead-soft-delete-schema.test.ts src/db/__tests__/lead-contact-fields-schema.test.ts src/domains/sales-ops/leads/__tests__/lead-contract.test.ts src/domains/sales-ops/leads/__tests__/lead-routes.test.ts src/domains/sales-ops/leads/__tests__/lead-routes-edition.test.ts src/domains/sales-ops/leads/__tests__/leads-edition-no-seed.test.ts src/middleware/__tests__/edition-gate-map.test.ts src/domains/import/__tests__/executor.test.ts src/db/__tests__/single-role-db-contract.test.ts
```

Integration oracles plus every existing lead, audit and import integration file (they share the board lock, the renumber and the ledger):

```bash
VITEST_INTEGRATION=1 pnpm exec vitest run test/rls/leads-lixeira.test.ts test/rls/lead-soft-delete-migration.test.ts test/rls/leads-schema-migration.test.ts test/rls/lead-contact-fields-migration.test.ts test/rls/leads-rls.test.ts test/rls/leads-seller-scope.test.ts test/rls/leads-unassigned-claim.test.ts test/rls/leads-move-concurrency.test.ts test/rls/leads-edition.test.ts test/rls/leads-no-financial-impact.test.ts test/rls/cadastro-archive-audit.test.ts test/rls/audit-history-org-scope.test.ts src/domains/import/__tests__/executor.integration.test.ts src/domains/import/__tests__/import-routes.integration.test.ts
```

Static checks:

```bash
pnpm --filter @fxl-sales/api run type-check
pnpm exec eslint src/db/schema.ts src/domains/audit/service.ts src/domains/sales-ops/leads/lead-service.ts src/domains/sales-ops/leads/lead-trash-service.ts src/domains/sales-ops/leads/lead-schemas.ts src/domains/sales-ops/leads/lead-routes.ts src/domains/sales-ops/leads/__tests__/lead-routes.test.ts src/domains/sales-ops/leads/__tests__/lead-contract.test.ts src/middleware/__tests__/edition-gate-map.test.ts src/db/__tests__/lead-soft-delete-schema.test.ts
pnpm exec drizzle-kit generate --name noop   # must print "No schema changes"
```

Then `git status` must show only the files in `files_modified` (no stray `0029_noop.sql`).

## Risks

- The local test Postgres on 5006 is shared by every worktree; global-setup applies 0028 there.
  The three columns are nullable with no default, so code without 0028 keeps working against it.
  Run the integration command once and do not hand-apply DDL anywhere else (staging/production DDL is a deploy step).
- `ADD CONSTRAINT ... CHECK` takes an ACCESS EXCLUSIVE lock for one scan of `sales_ops_leads`; the table is small and every row passes (NULL, NULL), so it is instant in practice.
- `lead-routes.ts` now imports `middleware/app-auth.js`, which resolves the Hub contract at module scope.
  Unit route tests are safe (unit-setup blanks the Hub names and `sales-ops/__tests__/routes.test.ts` already loads it under the same `db/client` mock); the integration oracle MUST keep the `vi.hoisted` Hub blanking block at the very top or it inherits whatever `apps/api/.env` holds.
- The audit tail lock is global: a delete or restore queues behind other audited writes.
  Acceptable because these are rare deliberate acts; moves stay unaudited and never wait on it.
- `audit_log` cleanup deletes only this file's rows, which are the ledger tail only because the integration project runs files serially (`fileParallelism: false`); never write ledger rows from a `beforeAll` of another org.
- A lead deleted between a conversion's `POST /sales` (201) and its move answers the move 404 and leaves one rascunho proposta: the same accepted orphan case the kanban reference already documents for a reload. Slice 03 should not offer delete while a conversion is in flight; nothing to do server side.
- If drizzle-kit emits anything other than the five statements of Step 2a, stop and report: it means the schema edit differs from this plan.

## Seam notes (for the coordinator)

- Every seam name is used verbatim: migration `0028_lead_soft_delete`; columns `deleted_at`, `deleted_by_user_id`, `deleted_by_name` and the CHECK; Drizzle `deletedAt`, `deletedByUserId`, `deletedByName`; `liveLeadCondition()`; `deleteLead(db, orgId, id, scope, actor)` with `actor = { userId, name }`; `restoreLead(db, orgId, id, actor)`; `listDeletedLeads(db, orgId, query)`; routes `POST /leads/:id/delete` (204), `POST /leads/:id/restore` (requireAdmin, 200 `{lead}`), `GET /leads/deleted` (requireAdmin, `{ items, nextCursor }`); `DeletedLeadView` with exactly the eight seam fields; audit actions `lead.deleted` / `lead.restored`, entityType `lead`.
- Not impossible, but two choices the seam left open and this plan fixes:
  (1) the three service functions live in the NEW file `leads/lead-trash-service.ts` (not `lead-service.ts`), because `lead-contract.test.ts` forbids the audit writer in `lead-service.ts`; slice 02 imports `liveLeadCondition` from `lead-service.ts` as the seam says, and nothing in slices 03 to 05 imports API files.
  (2) the seam's audit `metadata` is stored as `after_jsonb.metadata`, beside `label` and `actorLabel` (the keys the existing org history read already projects); the restore's `before_jsonb` also records the origin `stageName`.
- Internal names added by this slice (no other slice depends on them): `LeadActor`, `DeleteLeadResult`, `RestoreLeadResult`, `ListDeletedLeadsResult`, `ListDeletedLeadsQuerySchema` / `ListDeletedLeadsQuery`, exported helpers `firstOpenLeadStage`, `nextLeadPosition`, `leadIdentityConditions`, `LeadScopeAllowed`, `lockLeadBoard`, `renumberStage`, `readLeadView`, and the partial index `sales_ops_leads_org_deleted_idx`.
- Slice 02: register `GET /summary` next to `GET /deleted` (both above `/:id`, the comment in Step 7d already names it) and add its OPEN entry beside the three added here.
