---
id: 01-api-claim
milestone: v4.4.0
status: done
depends_on: []
files_modified: [apps/api/src/domains/sales-ops/leads/lead-service.ts, apps/api/src/domains/sales-ops/leads/lead-schemas.ts, apps/api/src/db/schema.ts, apps/api/test/rls/leads-seller-scope.test.ts, apps/api/test/rls/leads-unassigned-claim.test.ts]
oracle: [apps/api/test/rls/leads-unassigned-claim.test.ts, apps/api/test/rls/leads-seller-scope.test.ts]
acceptance: ["AC1: a non-admin whose pessoa is an ACTIVE vendedor lists, per stage, own leads plus every seller_person_id IS NULL lead and never a colleague lead; total counts exactly that set (count and page share one predicate); ?sellerPersonId= is ignored for a non-admin", "AC2: getLead answers ok for an own or unassigned lead and not_found for a colleague lead or another org's unassigned lead (asserted over the admin connection)", "AC3: that caller's moveLead on an unassigned lead succeeds and the SAME UPDATE sets seller_person_id = caller pessoa and seller_name_snapshot = that pessoa's display_name read server-side", "AC4: every PATCH (updateLead full, updateContactLead leads edition) on an unassigned lead claims it when sellerPersonId is absent, null ('' in the contact schema) or the caller's own id; any other id answers seller_scope and the row is untouched; on an already-owned lead today's rule holds", "AC5: of two vendedores on one unassigned lead, the one blocked on SELECT ... FOR UPDATE re-evaluates after the first commits and answers not_found, writing nothing (proved deterministically with a held row lock plus pg_blocking_pids)", "AC6: an admin move or edit of an unassigned lead leaves seller_person_id NULL and seller_name_snapshot ''; an admin PATCH naming a vendedor still assigns, as today", "AC7: a colleague's lead stays 404 for read, move and edit; a converted unassigned lead answers already_converted to a vendedor and stays unassigned; every refused or thrown write (seller_scope, product_not_found after the UPDATE, client_not_found, stage_not_found, lost_reason_required) leaves the lead unclaimed", "AC8: a non-admin whose pessoa is not an active vendedor (finder-only, or a deactivated vendedor) keeps exactly today's scope: own leads only, no pool visibility, no claim"]
---

# 01 API: unassigned pool and claim-on-write

Scope: AC1-AC8 of `00-OVERVIEW.md`.
Server only. No migration, no `audit_log` write, no change to the create rules, no web change, no route change.

## Design (decided by the orchestrator, made concrete here)

1. `resolveLeadScopePredicate` keeps its fail-closed discriminated union and additionally reports `canClaimUnassigned: boolean` for a non-admin: whether the caller's resolved pessoa is an ACTIVE vendedor (the `vendedor` SYSTEM função through `sales_ops_person_funcoes`, `status = 'active'`).
   Admin always carries `canClaimUnassigned: false` (irrelevant, the admin has no seller predicate at all).
   One extra query per non-admin request, through a helper that `resolveSellerPersonId` also uses, so "is an active vendedor" is spelled once.
2. Non-admin read predicate: `seller_person_id = me OR (canClaimUnassigned AND seller_person_id IS NULL)`, built in ONE function and used by `listLeads` (count and page), `getLead`, `applyLeadUpdate` and `moveLead`.
   A caller with `canClaimUnassigned = false` gets exactly today's `seller_person_id = me`.
3. Claim: in `applyLeadUpdate` and `moveLead`, after the `SELECT ... FOR UPDATE` and after the `already_converted` refusal, a non-admin claimant on a row whose `seller_person_id` is NULL writes `seller_person_id = caller` and `seller_name_snapshot = resolveSellerPersonId(...).displayName` in the same UPDATE as the rest of the write.
4. Race: Postgres READ COMMITTED re-evaluates the WHERE clause of a `SELECT ... FOR UPDATE` against the newest committed row version after a lock wait (EvalPlanQual).
   The loser's re-check sees `seller = A`, which matches neither `seller = B` nor `IS NULL`, so it gets no row and answers `not_found`.
5. Admin path unchanged.

## Why every refused write writes nothing (verified)

`withTenant` (`apps/api/src/domains/sales-ops/service.ts` L1452) is `db.transaction(async (tx) => { setTenantContext; return fn(tx) })`.
A throw inside `fn` (every `LeadInputError`) rolls the whole transaction back and rethrows (postgres.js `begin` semantics through drizzle).
A returned `{ ok: false }` commits, but every such return in `applyLeadUpdate` / `moveLead` happens BEFORE the lead UPDATE, so the lead row is untouched.
The one validation that throws AFTER the lead UPDATE is `replaceLeadProducts` -> `resolveLeadProducts` -> `product_not_found` in `applyLeadUpdate`; the rollback undoes the claim with it.
The oracle proves that case explicitly (test 5 below).
The gate's own side effects (the e-mail self-claim of `hub_account_id`, the leads-edition auto-provision) may still commit on a refused lead write; that is pre-existing behaviour and out of scope.

## Step-by-step implementation

All code changes are in `apps/api/src/domains/sales-ops/leads/lead-service.ts` unless stated.
Keep the file's comment style: comments explain WHY.
Never use the em dash character; use a plain dash.

### Step 1. Imports

Change the drizzle import to:

```ts
import { and, asc, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
```

### Step 2. The gate type

Replace the `LeadScopeGate` type (currently L190-192) with:

```ts
export type LeadScopeGate =
  | {
      ok: true;
      /** The caller's own pessoa, or null for an admin (no seller predicate at all). */
      sellerPersonId: string | null;
      /**
       * Whether a non-admin caller sees, and claims on their first write, the
       * unassigned pool (leads-sem-vendedor). True only when the caller's pessoa
       * is an ACTIVE vendedor; always false for an admin, who never claims.
       */
      canClaimUnassigned: boolean;
    }
  | { ok: false; reason: 'seller_person_unmapped' };

/** The gate after its `ok` check: what the predicate and the claim are built from. */
type LeadScopeAllowed = Extract<LeadScopeGate, { ok: true }>;
```

### Step 3. One spelling of "is an active vendedor"

Extract the first query of `resolveSellerPersonId` (current L354-380) into a new private function placed directly ABOVE `resolveSellerPersonId`, keeping the `type ResolvedSeller` declaration above both:

```ts
/**
 * The pessoa when it is an ACTIVE vendedor, else null. The one spelling of that
 * rule in this file: the gate reads it to decide who sees the unassigned pool,
 * and `resolveSellerPersonId` reads it to decide who may be written as a lead's
 * vendedor, so the two can never disagree about who is a vendedor.
 */
async function findActiveVendedor(
  tx: Db,
  orgId: string,
  personId: string,
): Promise<ResolvedSeller | null> {
  const [seller] = await tx
    .select({ id: salesOpsPeople.id, displayName: salesOpsPeople.displayName })
    .from(salesOpsPeople)
    .innerJoin(/* salesOpsPersonFuncoes join, byte-identical to today */)
    .innerJoin(/* salesOpsFuncoes join, byte-identical to today */)
    .where(
      and(
        eq(salesOpsPeople.orgId, orgId),
        eq(salesOpsPeople.id, personId),
        eq(salesOpsPeople.status, 'active'),
        eq(salesOpsFuncoes.slug, 'vendedor'),
        eq(salesOpsFuncoes.isSystem, true),
      ),
    )
    .limit(1);
  return seller ?? null;
}
```

Move the two `innerJoin(...)` blocks verbatim from today's `resolveSellerPersonId` (do not paraphrase them).
Keep the literal `'vendedor'` and the `salesOpsPersonFuncoes` identifier: `lead-contract.test.ts` greps the source for `/'vendedor'/` and `/salesOpsPersonFuncoes/`.

Then `resolveSellerPersonId` becomes:

```ts
async function resolveSellerPersonId(tx: Db, orgId: string, sellerPersonId: string): Promise<ResolvedSeller> {
  const seller = await findActiveVendedor(tx, orgId, sellerPersonId);
  if (seller) return seller;
  // ...the existing "tell the two apart" probe and throw, unchanged...
}
```

Keep its existing docblock.

### Step 4. `resolveLeadScopePredicate`

Keep the order of resolution exactly (admin, bound/self-claim, leads-edition provision, unmapped).
Change only the three `ok: true` returns:

```ts
if (scope.isAdmin) return { ok: true, sellerPersonId: null, canClaimUnassigned: false };
const personId = await resolveCallerPersonId(tx, orgId, scope);
if (personId) return sellerGate(tx, orgId, personId);
if (scope.edition === 'leads') {
  const provisioned = await provisionLeadsSellerPerson(tx, orgId, scope);
  if (provisioned) return sellerGate(tx, orgId, provisioned);
}
return { ok: false, reason: 'seller_person_unmapped' };
```

Add, directly below `resolveLeadScopePredicate`:

```ts
/**
 * A resolved non-admin caller. Resolving the pessoa says WHO the caller is;
 * whether they may see the unassigned pool is a separate question with a
 * separate answer, because a finder-only pessoa or a deactivated vendedor still
 * reaches their own leads (exactly as before this rule) but must never pick up a
 * lead from the pool.
 */
async function sellerGate(tx: Db, orgId: string, personId: string): Promise<LeadScopeGate> {
  return {
    ok: true,
    sellerPersonId: personId,
    canClaimUnassigned: (await findActiveVendedor(tx, orgId, personId)) !== null,
  };
}
```

Extend the `resolveLeadScopePredicate` docblock with one paragraph: a non-admin also carries `canClaimUnassigned`, true only for an active vendedor; it widens the predicate to the unassigned pool and makes the first write a claim (see `leadSellerCondition` and `claimantFor`).

### Step 5. The one seller predicate

Replace `leadIdentityConditions` (current L676-689) with these two functions (same location):

```ts
/**
 * The seller predicate for a non-admin caller, and the ONE place it is spelled.
 *
 * An active vendedor sees their own leads plus the unassigned pool
 * (leads-sem-vendedor), written as the explicit disjunction
 * `seller = me OR seller IS NULL` and never as IS NOT DISTINCT FROM. `or()`
 * parenthesizes it, which is load-bearing: unparenthesized, the IS NULL arm
 * would escape the org conjunct beside it and reach every org's pool. Anyone
 * else keeps exactly their own leads.
 */
function leadSellerCondition(sellerPersonId: string, canClaimUnassigned: boolean): SQL {
  const own = eq(salesOpsLeads.sellerPersonId, sellerPersonId);
  if (!canClaimUnassigned) return own;
  return or(own, isNull(salesOpsLeads.sellerPersonId))!;
}

/**
 * `eq(salesOpsLeads.orgId, orgId)` is ALWAYS the first element, and the seller
 * predicate is appended only for a non-admin. The admin case is the same
 * expression minus one conjunct.
 */
function leadIdentityConditions(orgId: string, id: string, gate: LeadScopeAllowed): SQL[] {
  const conditions: SQL[] = [eq(salesOpsLeads.orgId, orgId), eq(salesOpsLeads.id, id)];
  if (gate.sellerPersonId) {
    conditions.push(leadSellerCondition(gate.sellerPersonId, gate.canClaimUnassigned));
  }
  return conditions;
}
```

Call sites: `getLead`, `applyLeadUpdate`, `moveLead` change `leadIdentityConditions(orgId, id, gate.sellerPersonId)` to `leadIdentityConditions(orgId, id, gate)`.
`gate` is already narrowed to the ok variant by the preceding `if (!gate.ok) return ...`.

### Step 6. `listLeads`

Replace the seller block (current L594-602) with:

```ts
    // The `else if` is the whole seller-scoping rule: for a non-admin the
    // predicate is built from the caller's OWN person id (plus the unassigned
    // pool for an active vendedor) and `?sellerPersonId=` is never read AT ALL.
    // A seller who passes a colleague's id gets their own board back - not a
    // 403, and not the colleague's. The count below and the page share this one
    // `conditions` array, so `total` counts exactly the rows a page can return.
    if (gate.sellerPersonId) {
      conditions.push(leadSellerCondition(gate.sellerPersonId, gate.canClaimUnassigned));
    } else if (query.sellerPersonId) {
      conditions.push(eq(salesOpsLeads.sellerPersonId, query.sellerPersonId));
    }
```

Nothing else in `listLeads` changes (the cursor conjunct is still appended after the count).

### Step 7. `claimantFor`

Add directly below `leadIdentityConditions`:

```ts
/**
 * The pessoa a write on `current` claims the lead for, or null for no claim.
 *
 * Only a non-admin caller who may see the pool claims (an admin never does: the
 * lead stays in the pool, gestor decision), and only a lead that was still
 * unassigned when its row lock was taken. Callers decide this AFTER the
 * `already_converted` refusal and the lead UPDATE carries it, so a refused write
 * never claims and a thrown one is rolled back with the transaction.
 *
 * The race guard is the `SELECT ... FOR UPDATE` that produced `current`: a
 * second vendedor reaching the same unassigned lead blocks on the row lock, and
 * READ COMMITTED re-checks its WHERE against the committed row once the first
 * commits. `seller = A` matches neither `seller = B` nor `IS NULL`, so the second
 * reads no row and answers not_found. Never raise these transactions to
 * REPEATABLE READ: the loser would then fail with 40001 (a 500) instead.
 *
 * The `canClaimUnassigned` conjunct is redundant with the read predicate today
 * and kept so a future predicate change can never turn a finder into a claimant.
 */
function claimantFor(gate: LeadScopeAllowed, current: LeadRow): string | null {
  if (gate.sellerPersonId === null || !gate.canClaimUnassigned) return null;
  return current.sellerPersonId === null ? gate.sellerPersonId : null;
}
```

`LeadRow` is already declared (`type LeadRow = typeof salesOpsLeads.$inferSelect;`, current L462).

### Step 8. `applyLeadUpdate`

Leave the gate, the `SELECT ... FOR UPDATE` and the `already_converted` line as they are (except Step 5's call-site change).
Replace the seller block (current L928-935) with:

```ts
    const claimant = claimantFor(gate, current);
    // Whether this UPDATE writes the seller pair at all: a claim always does,
    // otherwise only a body that names the key.
    const writesSeller = claimant !== null || input.sellerPersonId !== undefined;

    let seller: ResolvedSeller | null = null;
    if (claimant !== null) {
      // On an unassigned lead the caller may leave the vendedor out, clear it or
      // name themselves, and all three mean "mine": the web form of a pool lead
      // carries an empty vendedor. Any other id would hand the lead to a
      // colleague, which only a gestor may do, so it is refused before anything
      // is written. The snapshot is the pessoa's own display name, read here.
      const requested = input.sellerPersonId ?? null;
      if (requested !== null && requested !== claimant) {
        return { ok: false, reason: 'seller_scope' } as const;
      }
      seller = await resolveSellerPersonId(tx, orgId, claimant);
    } else if (input.sellerPersonId !== undefined) {
      const requested = input.sellerPersonId ?? null;
      if (gate.sellerPersonId && requested !== gate.sellerPersonId) {
        return { ok: false, reason: 'seller_scope' } as const;
      }
      seller = requested ? await resolveSellerPersonId(tx, orgId, requested) : null;
    }
```

The `else if` branch is byte-for-byte today's rule, so on a lead the caller already owns `null` or another id still answers `seller_scope`, and the admin path is unchanged.
In the `.set({...})` object replace the condition of the seller spread:

```ts
        ...(writesSeller
          ? {
              sellerPersonId: seller?.id ?? null,
              sellerNameSnapshot: seller?.displayName ?? '',
            }
          : {}),
```

Nothing else in `applyLeadUpdate` changes: client resolution, the UPDATE's WHERE, `replaceLeadProducts` and `readLeadView` stay as they are.

### Step 9. `moveLead`

Leave the gate, the `SELECT ... FOR UPDATE`, the `already_converted` refusal and every destination/sale validation as they are (except Step 5's call-site change).
Directly after the `saleId` validation block (the `if (destination.kind === 'conversion') {...} else if (input.saleId !== undefined) {...}`) and BEFORE `const stageChanged = ...`, add:

```ts
    // The claim (leads-sem-vendedor), resolved after every validation above so a
    // refused move never claims, and written by the same UPDATE as the move.
    const claimant = claimantFor(gate, current);
    const claimed = claimant !== null ? await resolveSellerPersonId(tx, orgId, claimant) : null;
```

In the move's `.set({...})`, after the existing `...(destination.kind === 'conversion' ? { saleId: input.saleId! } : {}),` line, add:

```ts
        ...(claimed ? { sellerPersonId: claimed.id, sellerNameSnapshot: claimed.displayName } : {}),
```

Do NOT touch the line `...(stageChanged ? { stageChangedAt: new Date() } : {}),`: `lead-contract.test.ts` matches it byte-for-byte.
`renumberStage` is unchanged; it writes `position` only, so a renumber never claims a neighbouring pool lead (the oracle asserts it).

### Step 10. Stale comments (comment-only, no behaviour)

- `apps/api/src/domains/sales-ops/leads/lead-schemas.ts` L65-68, the `sellerPersonId` docblock in `LeadFieldsSchema`: replace "an unassigned lead is then visible to admins only, which is the correct answer." with "an unassigned lead is visible to admins and to every active vendedor, and the first vendedor to write it claims it (leads-sem-vendedor, see `claimantFor` in lead-service.ts)."
- `apps/api/src/db/schema.ts` L1032-1034, the `sellerPersonId` docblock of `salesOpsLeads`: replace "Server-side seller scoping therefore shows an unassigned lead to admins only, which is correct." with "Server-side seller scoping shows an unassigned lead to admins and to every active vendedor, and the first vendedor write claims it (lead-service.ts `claimantFor`)."

These are comments inside TS docblocks; they change no Drizzle snapshot and need no migration.
Verify with `git diff --stat -- apps/api/drizzle` (must be empty).

### Step 11. Rewrite the old test in `apps/api/test/rls/leads-seller-scope.test.ts`

Replace the whole test at L854-887 (`it("keeps an unassigned lead out of every seller's board and on the admin's", ...)` plus its two-line comment) with:

```ts
  // The pool rule (leads-sem-vendedor): an unassigned lead is on EVERY active
  // vendedor's board until one of them writes it, and on the admin's. The
  // predicate is the explicit `seller = me OR seller IS NULL`, granted only to an
  // active vendedor. The claim, the race and the non-vendedor cases live in
  // leads-unassigned-claim.test.ts.
  it("shows an unassigned lead on every vendedor's board and on the admin's", async () => {
    const orgId = newOrg('unassigned');
    const { open } = await stagesFor(orgId);
    const ana = await seedSeller(orgId, 'Ana Martins');
    const bruno = await seedSeller(orgId, 'Bruno Lima');
    await bindHubAccount(orgId, ana.id, 'hub_ana');
    await bindHubAccount(orgId, bruno.id, 'hub_bruno');
    await expectOk(createLead(db, orgId, leadPayload({ contactName: 'Sem dono' }), ADMIN_SCOPE));

    for (const account of ['hub_ana', 'hub_bruno']) {
      const board = await listLeads(
        db,
        orgId,
        ListLeadsQuerySchema.parse({ stageId: open.id }),
        sellerScope(account),
      );
      if (!board.ok) throw new Error(`unexpected refusal: ${board.reason}`);
      expect(board.leads.map((lead) => [lead.contactName, lead.sellerPersonId])).toEqual([
        ['Sem dono', null],
      ]);
      expect(board.total).toBe(1);
    }

    const adminBoard = await listLeads(
      db,
      orgId,
      ListLeadsQuerySchema.parse({ stageId: open.id }),
      ADMIN_SCOPE,
    );
    if (!adminBoard.ok) throw new Error(`unexpected refusal: ${adminBoard.reason}`);
    expect(adminBoard.leads).toHaveLength(1);

    // Seeing the pool is not filing into it: the create rules did not change, and
    // a full-edition seller may still not file an UNASSIGNED lead.
    expect(await createLead(db, orgId, leadPayload(), sellerScope('hub_ana'))).toEqual({
      ok: false,
      reason: 'seller_scope',
    });
  });
```

Checked and left unchanged, they still hold: L159 `serves a seller only their own leads...` and L187 `ignores a sellerPersonId query parameter...` create only assigned leads, so the pool is empty there.
In `apps/api/test/rls/leads-edition.test.ts` every non-admin board read happens while the org has no unassigned lead (`owndefault` creates its admin unassigned lead at L515, after the board read at L502), so that file needs no change and must stay green.

## The oracle: `apps/api/test/rls/leads-unassigned-claim.test.ts` (new)

### Harness (copy the neighbours' style)

```ts
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { testDatabaseUrls } from '../../src/db/__tests__/test-database-urls.js';
import {
  CreateContactLeadSchema,
  CreateLeadSchema,
  ListLeadsQuerySchema,
  MoveLeadSchema,
  UpdateContactLeadSchema,
  UpdateLeadSchema,
} from '../../src/domains/sales-ops/leads/lead-schemas.js';
import {
  type LeadScope,
  type LeadView,
  type WriteLeadResult,
  createContactLead,
  createLead,
  getLead,
  listLeads,
  moveLead,
  updateContactLead,
  updateLead,
} from '../../src/domains/sales-ops/leads/lead-service.js';
import { LeadStageSchema } from '../../src/domains/sales-ops/leads/schemas.js';
import { createLeadStage } from '../../src/domains/sales-ops/leads/stage-service.js';
import { ensureLeadStagesForOrg } from '../../src/domains/sales-ops/leads/stages-seed.js';
import { PersonSchema, createPerson } from '../../src/domains/sales-ops/service.js';
```

Constants and scopes:

```ts
const { appUrl: APP_DB_URL, adminUrl: ADMIN_DB_URL } = testDatabaseUrls();
const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;
const ADMIN_SCOPE: LeadScope = { userId: 'hub_admin', email: null, isAdmin: true };
/** A full-edition non-admin, exactly as the FXL tests build one. */
function sellerScope(userId: string): LeadScope {
  return { userId, email: null, isAdmin: false };
}
/** A leads-edition non-admin, exactly as `leadScope` builds one. */
function leadsSellerScope(userId: string): LeadScope {
  return { userId, email: null, isAdmin: false, name: null, hasSellerRole: true, edition: 'leads' };
}
function okLead(result: WriteLeadResult): LeadView {
  if (!result.ok) throw new Error(`unexpected refusal: ${result.reason}`);
  return result.lead;
}
```

Inside `describe('sales operations leads: the unassigned pool and claim-on-write', ...)`:

- Clients exactly as `leads-seller-scope.test.ts` L62-82: `appClient = postgres(APP_DB_URL, { max: 5 })`, `adminClient = postgres(ADMIN_DB_URL, { max: 2, ...ADMIN_CONNECTION_OPTIONS })`, `adminDbClient = postgres(ADMIN_DB_URL, { max: 5, ...ADMIN_CONNECTION_OPTIONS })`, `db = drizzle(appClient, { schema })`, `adminDb = drizzle(adminDbClient, { schema })`.
- `newOrg(label)` returns `` `org_luc_${label}_${Date.now()}_${randomUUID().slice(0, 8)}` `` and pushes it on `orgIds`.
- `afterAll`: for each org, first `DELETE FROM audit_log WHERE actor_org_id = ${orgId}` (defensive; nothing here should write one), then the exact delete list of `leads-seller-scope.test.ts` L88-102, then `end()` the three clients.

Fixture helpers (write them exactly like this):

```ts
  async function vendedor(orgId: string, displayName: string, account: string, leads = false) {
    const person = await createPerson(
      db,
      orgId,
      PersonSchema.parse(leads ? { displayName } : { displayName, isSeller: true }),
      leads ? { edition: 'leads' } : {},
    );
    if (typeof person === 'string') throw new Error(`unexpected person outcome: ${person}`);
    await adminClient`
      UPDATE sales_ops_people SET hub_account_id = ${account}
      WHERE org_id = ${orgId} AND id = ${person.id}`;
    return person;
  }

  /** A full-edition org with the seeded etapas and two bound vendedores. */
  async function fullWorld(label: string) {
    const orgId = newOrg(label);
    const stages = await ensureLeadStagesForOrg(db, orgId);
    const pick = (kind: string, position?: number) =>
      stages.find((stage) => stage.kind === kind && (position === undefined || stage.position === position))!;
    const ana = await vendedor(orgId, 'Ana Martins', 'hub_ana');
    const bruno = await vendedor(orgId, 'Bruno Lima', 'hub_bruno');
    return {
      orgId, ana, bruno,
      open: pick('normal', 1), second: pick('normal', 2),
      conversion: pick('conversion'), lost: pick('lost'),
    };
  }

  /** A leads-edition org: two org-created etapas, two bound vendedores. */
  async function leadsWorld(label: string) {
    const orgId = newOrg(label);
    const stage = async (name: string) => {
      const created = await createLeadStage(db, orgId, LeadStageSchema.parse({ name }));
      if (created === 'duplicate') throw new Error(`duplicate stage ${name}`);
      return created;
    };
    const contato = await stage('Contato');
    const proposta = await stage('Proposta');
    const ana = await vendedor(orgId, 'Ana', 'hub_ana', true);
    const bruno = await vendedor(orgId, 'Bruno', 'hub_bruno', true);
    return { orgId, contato, proposta, ana, bruno };
  }

  /** A full-edition lead filed by an admin; `sellerPersonId` absent means unassigned. */
  async function fullLead(orgId: string, contactName: string, sellerPersonId?: string) {
    return okLead(
      await createLead(
        db,
        orgId,
        CreateLeadSchema.parse({
          contactName,
          clientName: 'Empresa Pool',
          estimatedValueBrl: 100000,
          ...(sellerPersonId ? { sellerPersonId } : {}),
        }),
        ADMIN_SCOPE,
      ),
    );
  }

  /** A leads-edition lead an admin filed naming no vendedor: unassigned. */
  async function poolContact(orgId: string, contactName: string) {
    return okLead(
      await createContactLead(db, orgId, CreateContactLeadSchema.parse({ contactName }), ADMIN_SCOPE),
    );
  }

  async function rowOf(leadId: string) {
    const [row] = await adminClient<
      Array<{
        seller_person_id: string | null;
        seller_name_snapshot: string;
        stage_id: string;
        position: number;
        contact_name: string;
        contact_phone: string | null;
        sale_id: string | null;
        updated_at: Date | null;
      }>
    >`SELECT seller_person_id, seller_name_snapshot, stage_id, "position", contact_name,
             contact_phone, sale_id, updated_at
      FROM sales_ops_leads WHERE id = ${leadId}`;
    return row!;
  }

  async function names(orgId: string, stageId: string, scope: LeadScope, limit?: string, cursor?: string) {
    const board = await listLeads(
      adminDb,
      orgId,
      ListLeadsQuerySchema.parse({ stageId, ...(limit ? { limit } : {}), ...(cursor ? { cursor } : {}) }),
      scope,
    );
    if (!board.ok) throw new Error(`unexpected refusal: ${board.reason}`);
    return board;
  }
```

`createLeadStage` returns the row or the `'duplicate'` sentinel (`LeadStageDuplicate = 'duplicate'`), exactly as `leads-edition.test.ts` L140-144 handles it.
A fresh unassigned lead has `updated_at = NULL` (`insertLead` never sets it), which is how "writes nothing" is asserted.

The race harness (used by tests 7 and 8):

```ts
  /**
   * Vendedor A's claim, in flight: a transaction on the admin connection that
   * locks the lead row and writes A as its seller exactly as the service's claim
   * UPDATE does, then holds the lock (uncommitted) until released.
   */
  async function holdClaim(orgId: string, leadId: string, winner: { id: string; displayName: string }) {
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked!: (pid: number) => void;
    const holderPid = new Promise<number>((resolve) => {
      locked = resolve;
    });
    const done = adminClient.begin(async (sql) => {
      const [self] = await sql<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      await sql`SELECT id FROM sales_ops_leads WHERE org_id = ${orgId} AND id = ${leadId} FOR UPDATE`;
      await sql`
        UPDATE sales_ops_leads
        SET seller_person_id = ${winner.id}, seller_name_snapshot = ${winner.displayName}, updated_at = now()
        WHERE org_id = ${orgId} AND id = ${leadId}`;
      locked(self!.pid);
      await released;
    });
    return { pid: await holderPid, release, done };
  }

  /**
   * Deterministic proof that the second claimant is parked on the held row lock
   * and not merely slow: some backend lists the holder among its blockers. Polled
   * on adminDbClient, because the holder occupies one of adminClient's two slots.
   */
  async function waitUntilBlockedBy(holderPid: number) {
    for (let i = 0; i < 500; i += 1) {
      const [row] = await adminDbClient<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE ${holderPid}::int = ANY(pg_blocking_pids(pid))`;
      if (row!.n > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('the second claimant never blocked on the held row lock');
  }
```

Every race test wraps its body in `try { ... } finally { hold.release(); await hold.done; }` so a failed assertion never leaves an open transaction that would hang `afterAll`'s DELETE.
`release()` twice is harmless (a resolved promise).

### The cases (one `it` each, names as given)

1. AC1 `lists an active vendedor their own leads plus every unassigned lead, never a colleague lead, with total counting exactly that set`
   - `w = fullWorld('list')`. In this order: `fullLead(w.orgId, 'Ana propria', w.ana.id)`, `fullLead(..., 'Bruno proprio', w.bruno.id)`, `fullLead(..., 'Pool um')`, `fullLead(..., 'Pool dois')`, `fullLead(..., 'Pool segunda')`, then `moveLead(db, w.orgId, poolSegunda.id, MoveLeadSchema.parse({ stageId: w.second.id, position: 0 }), ADMIN_SCOPE)` (admin, so it stays unassigned).
   - Over `adminDb` (RLS hides nothing): `names(w.orgId, w.open.id, sellerScope('hub_ana'))` gives `leads.map(contactName)` equal to `['Ana propria', 'Pool um', 'Pool dois']`, `total` 3, and no lead with `sellerPersonId === w.bruno.id`.
   - The same read with `ListLeadsQuerySchema.parse({ stageId: w.open.id, sellerPersonId: w.bruno.id })` (inline `listLeads` call) returns the same three names: the param is ignored.
   - Pagination: `names(..., 'hub_ana' scope, '2')` gives `['Ana propria', 'Pool um']`, `total` 3, `nextCursor` not null; the next page with that cursor gives `['Pool dois']`, `total` 3, `nextCursor` null.
   - `names(w.orgId, w.open.id, sellerScope('hub_bruno'))` gives `['Bruno proprio', 'Pool um', 'Pool dois']`, `total` 3.
   - `names(w.orgId, w.second.id, sellerScope('hub_ana'))` gives `['Pool segunda']`, `total` 1.
   - `names(w.orgId, w.open.id, ADMIN_SCOPE)` has `total` 4.
   - Nothing was claimed by reading: `rowOf(poolUm.id).seller_person_id` is null.

2. AC2 `reads an own or unassigned lead and answers not_found for a colleague lead or another org's pool lead, over the admin connection`
   - `w = fullWorld('get')`; `own = fullLead(..., 'Ana propria', ana)`, `other = fullLead(..., 'Bruno proprio', bruno)`, `pool = fullLead(..., 'Pool')`.
   - `getLead(adminDb, w.orgId, pool.id, sellerScope('hub_ana'))` is `ok` with `lead.sellerPersonId === null`; same for `own.id` with `sellerPersonId === w.ana.id`; `other.id` equals `{ ok: false, reason: 'not_found' }`.
   - Cross-org: `b = fullWorld('getb')` and `poolB = fullLead(b.orgId, 'Pool B')`. Over `adminDb`, with `sellerScope('hub_ana')` in `w.orgId`: `getLead(adminDb, w.orgId, poolB.id, ...)`, `moveLead(adminDb, w.orgId, poolB.id, MoveLeadSchema.parse({ stageId: w.second.id, position: 0 }), ...)` and `updateLead(adminDb, w.orgId, poolB.id, UpdateLeadSchema.parse({ contactName: 'hijack' }), ...)` each equal `{ ok: false, reason: 'not_found' }`, and `rowOf(poolB.id)` still has `seller_person_id` null, `contact_name` `'Pool B'`, `stage_id` `b.open.id`.
   - Comment in the test: an `OR` that escaped its parentheses would reach every org's pool over this connection, where RLS cannot cover for it.

3. AC3 `claims an unassigned lead for the vendedor who moves it, in the same write, with the server-side display name`
   - `w = fullWorld('move')`; `mover = fullLead(..., 'Pool mover')`, `anchor = fullLead(..., 'Pool ancora')`, `reorder = fullLead(..., 'Pool reorder')`.
   - `moved = okLead(await moveLead(db, w.orgId, mover.id, MoveLeadSchema.parse({ stageId: w.second.id, position: 0 }), sellerScope('hub_ana')))`: `moved` matches `{ stageId: w.second.id, sellerPersonId: w.ana.id, sellerNameSnapshot: 'Ana Martins' }`; `rowOf(mover.id)` has `seller_person_id` `w.ana.id` and `seller_name_snapshot` `'Ana Martins'`.
   - Bruno lost sight of it: `getLead(db, w.orgId, mover.id, sellerScope('hub_bruno'))` is `not_found`; `names(w.orgId, w.second.id, sellerScope('hub_bruno')).total` is 0.
   - A same-stage reorder claims too and leaves `stage_changed_at` byte-identical: read it as microseconds before and after with the query from `leads-seller-scope.test.ts` L487-489 (`(EXTRACT(EPOCH FROM stage_changed_at)::numeric * 1000000)::bigint`); `moveLead(db, w.orgId, reorder.id, MoveLeadSchema.parse({ stageId: w.open.id, position: 0 }), sellerScope('hub_ana'))` gives `sellerPersonId === w.ana.id`; the micros are equal.
   - A renumber never claims a neighbour: `rowOf(anchor.id).seller_person_id` is null (its `position` changed, its seller did not).
   - No ledger row: `SELECT count(*)::int AS n FROM audit_log WHERE actor_org_id = ${w.orgId}` is 0 (org-scoped on purpose, so a concurrent run elsewhere cannot perturb it).

4. AC4 full `claims an unassigned lead on a full-edition PATCH whether sellerPersonId is absent, null or the caller's own id, and refuses another id with seller_scope writing nothing`
   - `w = fullWorld('patch')`; `p1..p4 = fullLead(..., 'Pool 1'..'Pool 4')`; `ana = sellerScope('hub_ana')`.
   - Absent: `okLead(updateLead(db, w.orgId, p1.id, UpdateLeadSchema.parse({ contactName: 'Editado' }), ana))` matches `{ contactName: 'Editado', sellerPersonId: w.ana.id, sellerNameSnapshot: 'Ana Martins' }`.
   - Null: `UpdateLeadSchema.parse({ sellerPersonId: null, description: 'nota' })` on `p2` gives `sellerPersonId === w.ana.id`.
   - Own id: `UpdateLeadSchema.parse({ sellerPersonId: w.ana.id })` on `p3` gives `sellerPersonId === w.ana.id`.
   - Other id: `UpdateLeadSchema.parse({ sellerPersonId: w.bruno.id, contactName: 'X' })` on `p4` equals `{ ok: false, reason: 'seller_scope' }`; `rowOf(p4.id)` has `seller_person_id` null, `seller_name_snapshot` `''`, `contact_name` `'Pool 4'`, `updated_at` null.
   - Today's rule on an OWNED lead is unchanged: on `p1` (now Ana's), `{ sellerPersonId: null }` and `{ sellerPersonId: w.bruno.id }` each equal `{ ok: false, reason: 'seller_scope' }`, and `rowOf(p1.id).seller_person_id` is still `w.ana.id`.

5. AC7/AC4 `never claims through a refused write, including a throw after the UPDATE`
   - `w = fullWorld('refused')`; `pool = fullLead(..., 'Pool')`; `ana = sellerScope('hub_ana')`.
   - `updateLead(db, w.orgId, pool.id, UpdateLeadSchema.parse({ contactName: 'Nunca', products: [{ productId: randomUUID() }] }), ana)` rejects with `toMatchObject({ code: 'product_not_found' })`. Comment: this one is thrown by `replaceLeadProducts` AFTER the lead UPDATE, so only the transaction rollback keeps the lead unclaimed.
   - `updateLead(..., UpdateLeadSchema.parse({ clientId: randomUUID() }), ana)` rejects with `{ code: 'client_not_found' }`.
   - `moveLead(..., MoveLeadSchema.parse({ stageId: randomUUID(), position: 0 }), ana)` rejects with `{ code: 'stage_not_found' }`.
   - `moveLead(..., MoveLeadSchema.parse({ stageId: w.lost.id, position: 0 }), ana)` rejects with `{ code: 'lost_reason_required' }`.
   - `rowOf(pool.id)` equals, field by field: `seller_person_id` null, `seller_name_snapshot` `''`, `contact_name` `'Pool'`, `stage_id` `w.open.id`, `updated_at` null; and `SELECT count(*)::int AS n FROM sales_ops_lead_products WHERE lead_id = ${pool.id}` is 0.

6. AC4 contact (+AC3 in the leads edition) `claims an unassigned lead on a leads-edition PATCH for absent, null, empty and own vendedor, refuses another id, and claims on move`
   - `w = leadsWorld('contact')`; `c1..c6 = poolContact(w.orgId, 'Contato 1'..'Contato 6')`; `ana = leadsSellerScope('hub_ana')`.
   - Absent: `updateContactLead(db, w.orgId, c1.id, UpdateContactLeadSchema.parse({ contactPhone: '(27) 99999-0000' }), ana)` matches `{ contactPhone: '(27) 99999-0000', sellerPersonId: w.ana.id, sellerNameSnapshot: 'Ana' }`.
   - Null: `{ sellerPersonId: null, description: 'x' }` on `c2` claims for Ana.
   - Empty string: `{ sellerPersonId: '' }` on `c3` claims for Ana (the contact schema reads `''` as null).
   - Own id: `{ sellerPersonId: w.ana.id }` on `c4` claims for Ana.
   - Other id: `{ sellerPersonId: w.bruno.id, contactPhone: '1' }` on `c5` equals `{ ok: false, reason: 'seller_scope' }`; `rowOf(c5.id)` has `seller_person_id` null, `contact_phone` null, `updated_at` null.
   - Move: `moveLead(db, w.orgId, c6.id, MoveLeadSchema.parse({ stageId: w.proposta.id, position: 0 }), leadsSellerScope('hub_bruno'))` matches `{ stageId: w.proposta.id, sellerPersonId: w.bruno.id, sellerNameSnapshot: 'Bruno' }`.
   - Ana's `Contato` board (`names(w.orgId, w.contato.id, ana)`) holds exactly `['Contato 1', 'Contato 2', 'Contato 3', 'Contato 4', 'Contato 5']` (four now hers, `Contato 5` still in the pool), `total` 5.

7. AC5 move `lets only the first of two vendedores claim on move: the second, blocked on the row lock, answers not_found and writes nothing`
   - `w = fullWorld('racemove')`; `pool = fullLead(..., 'Pool corrida')` (position 1 in `open`).
   - `hold = await holdClaim(w.orgId, pool.id, w.ana)`; inside `try`:
     - `let settled = false; const second = moveLead(db, w.orgId, pool.id, MoveLeadSchema.parse({ stageId: w.second.id, position: 0 }), sellerScope('hub_bruno')).finally(() => { settled = true; });`
     - `await waitUntilBlockedBy(hold.pid); expect(settled).toBe(false);`
     - `hold.release(); await hold.done;`
     - `expect(await second).toEqual({ ok: false, reason: 'not_found' });`
   - After the `finally`: `rowOf(pool.id)` has `seller_person_id` `w.ana.id`, `seller_name_snapshot` `'Ana Martins'`, `stage_id` `w.open.id`, `position` 1.
   - The winner owns a working lead: `okLead(await moveLead(db, w.orgId, pool.id, MoveLeadSchema.parse({ stageId: w.second.id, position: 0 }), sellerScope('hub_ana')))` has `stageId === w.second.id` and `sellerPersonId === w.ana.id`.
   - Comment: ordering is deterministic, not timed. The holder's UPDATE has taken the row lock before Bruno's request starts, Bruno's snapshot still sees the old NULL seller so his `FOR UPDATE` must wait, `pg_blocking_pids` proves he is waiting on exactly that holder, and READ COMMITTED's re-check after the commit is what this test exists to pin.

8. AC5 PATCH `lets only the first of two vendedores claim on edit: the second, blocked on the row lock, answers not_found and writes nothing`
   - Same harness with `second = updateLead(db, w.orgId, pool.id, UpdateLeadSchema.parse({ contactName: 'Bruno editou' }), sellerScope('hub_bruno'))`.
   - Afterwards `rowOf(pool.id)` has `seller_person_id` `w.ana.id` and `contact_name` `'Pool corrida'`.
   - Then, with no lock in play (the plain sequential loser): `moveLead(db, w.orgId, pool.id, MoveLeadSchema.parse({ stageId: w.second.id, position: 0 }), sellerScope('hub_bruno'))` and `getLead(db, w.orgId, pool.id, sellerScope('hub_bruno'))` each equal `{ ok: false, reason: 'not_found' }`.

9. AC6 `never claims an unassigned lead for an admin who moves or edits it, and still assigns when the admin names a vendedor`
   - `w = fullWorld('admin')`; `pool = fullLead(..., 'Pool')`.
   - `okLead(moveLead(db, w.orgId, pool.id, MoveLeadSchema.parse({ stageId: w.second.id, position: 0 }), ADMIN_SCOPE))` has `sellerPersonId` null and `sellerNameSnapshot` `''`; `rowOf` agrees.
   - `okLead(updateLead(db, w.orgId, pool.id, UpdateLeadSchema.parse({ contactName: 'Admin editou' }), ADMIN_SCOPE))` has `sellerPersonId` null; `rowOf(pool.id)` has `seller_person_id` null, `seller_name_snapshot` `''`, `contact_name` `'Admin editou'`.
   - It is still in the pool: `getLead(db, w.orgId, pool.id, sellerScope('hub_ana'))` and the same for `'hub_bruno'` are both `ok`.
   - An admin naming a vendedor assigns, exactly as today: `updateLead(..., UpdateLeadSchema.parse({ sellerPersonId: w.ana.id }), ADMIN_SCOPE)` gives `sellerPersonId === w.ana.id`, `sellerNameSnapshot === 'Ana Martins'`; Bruno's `getLead` is now `not_found`.

10. AC7 `keeps a colleague's lead invisible and unwritable, and a converted unassigned lead read-only without claiming it`
    - `w = fullWorld('unchanged')`; `brunos = fullLead(..., 'Bruno proprio', w.bruno.id)`; `pool = fullLead(..., 'Pool convertido')`; `ana = sellerScope('hub_ana')`.
    - `getLead(db, w.orgId, brunos.id, ana)`, `moveLead(db, w.orgId, brunos.id, MoveLeadSchema.parse({ stageId: w.second.id, position: 0 }), ana)` and `updateLead(db, w.orgId, brunos.id, UpdateLeadSchema.parse({ contactName: 'hijack' }), ana)` each equal `{ ok: false, reason: 'not_found' }`; `rowOf(brunos.id)` keeps `seller_person_id` `w.bruno.id`, `contact_name` `'Bruno proprio'`, `stage_id` `w.open.id`.
    - Convert the pool lead as an admin: insert a sale with the raw SQL of `leads-seller-scope.test.ts` L635-642 (org `w.orgId`, `sequence` 1, code `'PROP-LUC-1'`), then `moveLead(db, w.orgId, pool.id, MoveLeadSchema.parse({ stageId: w.conversion.id, position: 0, saleId: sale.id }), ADMIN_SCOPE)` is ok with `sellerPersonId` null.
    - Ana still sees it (it is in the pool) but cannot write it: `getLead(db, w.orgId, pool.id, ana)` is ok; `moveLead(..., { stageId: w.open.id, position: 0 }, ana)`, `updateLead(..., { contactName: 'Depois' }, ana)` and `updateLead(..., { sellerPersonId: w.ana.id }, ana)` each equal `{ ok: false, reason: 'already_converted' }`; `rowOf(pool.id)` has `seller_person_id` null and `seller_name_snapshot` `''`.

11. AC8 `keeps a non-admin who is not an active vendedor on exactly their own leads: no pool, no claim`
    - `w = fullWorld('notvendedor')`; `pool = fullLead(..., 'Pool')`; `anas = fullLead(..., 'Ana propria', w.ana.id)`.
    - Finder-only: `createPerson(db, w.orgId, PersonSchema.parse({ displayName: 'Fabio Finder', isFinder: true }))` (throw on a string outcome), bind it to `'hub_fabio'` with the same `UPDATE sales_ops_people SET hub_account_id` as `vendedor()`. With `sellerScope('hub_fabio')`: `names(w.orgId, w.open.id, ...)` gives `leads` `[]` and `total` 0 (the call is ok, NOT `seller_person_unmapped`); `getLead`, `moveLead` (to `w.second`) and `updateLead` (`{ contactName: 'X' }`) on `pool.id` each equal `{ ok: false, reason: 'not_found' }`.
    - Deactivated vendedor: `UPDATE sales_ops_people SET status = 'inactive' WHERE org_id = ${w.orgId} AND id = ${w.ana.id}` on `adminClient` (raw SQL on purpose: `updatePerson` with a status change appends `audit_log` rows). With `sellerScope('hub_ana')`: `names(w.orgId, w.open.id, ...)` gives exactly `['Ana propria']` and `total` 1 (own leads exactly as before, pool hidden); `moveLead(... pool.id ..., { stageId: w.second.id, position: 0 })` equals `{ ok: false, reason: 'not_found' }`.
    - `rowOf(pool.id)` still has `seller_person_id` null, `stage_id` `w.open.id`, `updated_at` null.

## Regression set (must stay green, unchanged)

Integration:
- `apps/api/test/rls/leads-seller-scope.test.ts` (all cases, including the rewritten one).
- `apps/api/test/rls/leads-edition.test.ts` (no edits; scoping, `owndefault` and the provision race cases must still pass).
- `apps/api/test/rls/leads-no-financial-impact.test.ts`, `apps/api/test/rls/leads-rls.test.ts`, `apps/api/test/rls/lead-stages-rls.test.ts`.
- `apps/api/src/domains/import/__tests__/executor.integration.test.ts` (calls `createLead`/`moveLead` with an admin scope).

Unit (they touch the changed file or its exports):
- `apps/api/src/domains/sales-ops/leads/__tests__/lead-contract.test.ts` reads `lead-service.ts` source: keep the literal `'vendedor'`, keep `salesOpsPersonFuncoes`, add no `isSeller`/`is_seller`, no `getAdminDb`, no `auditLog`/`writeAuditEntry`, and keep the `...(stageChanged ? { stageChangedAt: new Date() } : {}),` line byte-identical.
- `apps/api/src/domains/sales-ops/leads/__tests__/lead-routes.test.ts` and `lead-routes-edition.test.ts` mock the service; exported signatures and `WriteLeadResult` are unchanged, so they must pass untouched.
- `apps/api/src/domains/sales-ops/leads/__tests__/contact-lead-contract.test.ts`, `leads-edition-no-seed.test.ts`, `apps/api/src/domains/import/__tests__/plan-leads.test.ts`.

## Run commands

From the worktree root (never the main checkout):

```bash
pnpm install --frozen-lockfile
cp /Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales/apps/api/.env apps/api/.env   # read-only copy; never write the source
pnpm run build:packages
# local Docker Postgres must be up on 5006 (TEST_DATABASE_URL / ADMIN_DATABASE_URL in that .env)

# the slice oracle first (red before Steps 1-9, green after)
pnpm --filter @fxl-sales/api test:integration test/rls/leads-unassigned-claim.test.ts test/rls/leads-seller-scope.test.ts

# integration regression set
pnpm --filter @fxl-sales/api test:integration test/rls/leads-edition.test.ts test/rls/leads-no-financial-impact.test.ts test/rls/leads-rls.test.ts test/rls/lead-stages-rls.test.ts src/domains/import/__tests__/executor.integration.test.ts

# unit set
pnpm --filter @fxl-sales/api test src/domains/sales-ops/leads/__tests__ src/domains/import/__tests__/plan-leads.test.ts

# lint on changed files (the package lint script covers src/ and scripts/ only, so name the test files explicitly)
pnpm --filter @fxl-sales/api exec eslint src/domains/sales-ops/leads/lead-service.ts src/domains/sales-ops/leads/lead-schemas.ts src/db/schema.ts test/rls/leads-unassigned-claim.test.ts test/rls/leads-seller-scope.test.ts

# type-check (tsconfig.test.json also roots test/**, so the new file is checked)
pnpm --filter @fxl-sales/api type-check

# no migration
git diff --stat -- apps/api/drizzle
```

Pass the files positionally, without `--` (the form the repo's earlier lead runs used); `test:integration` is `VITEST_INTEGRATION=1 vitest run`, which already runs once and never watches.
Integration files run serially (`fileParallelism: false`), so `audit_log` and lock assertions are not disturbed by sibling files in the same run.
Red-first order: write the new test file and the rewritten seller-scope test, run the oracle command and confirm they fail: every new case except 11 (AC8, today's behaviour) and the rewritten seller-scope case fail today, then implement Steps 1-10 and rerun.

## Risks

- Pre-existing, NOT introduced and NOT fixed here: `moveLead` locks the moved row first and then `renumberStage` locks whole columns, so two concurrent moves touching the same column (two reorders in one column, or two cross-column moves between the same pair) can deadlock, and Postgres aborts one with `40P01`, which surfaces as a 500.
  The claim race itself never reaches `renumberStage` (the loser exits at the identity read), so AC5 is unaffected, but a shared pool makes concurrent moves in the first column more likely.
  Report it to the orchestrator as a follow-up (for example a per-org `pg_advisory_xact_lock` at the top of `moveLead`); do not change the lock order in this slice.
- The AC5 guarantee depends on READ COMMITTED (the default, `withTenant` sets no isolation). Under REPEATABLE READ the loser would get `40001` instead of `not_found`; `claimantFor`'s docblock says so.
- One extra query (`findActiveVendedor`) per non-admin lead request, including once per board column. Indexed point lookup; acceptable.
- `resolveSellerPersonId` is called again at claim time. If an admin deactivates the caller between the gate and the claim inside the same transaction, the claim throws `seller_not_a_vendedor` (400) and rolls back. Accepted edge.
- Another agent may run the integration suite against the same local test DB at the same time. The new assertions are org-scoped (`audit_log` by `actor_org_id`, rows by id, `pg_blocking_pids` keyed on the holder pid), so a concurrent run cannot perturb them; `global-setup.ts` migrations racing another run is the only shared step, and it is idempotent.
- The race tests hold an open transaction on `adminClient`; the mandatory `try/finally` release prevents a hung `afterAll`.
- Gate side effects (the e-mail self-claim and the leads-edition auto-provision) still commit on a refused lead write, as today. Out of scope.
