import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import type { getDb } from '../../../db/client.js';
import {
  salesOpsFuncoes,
  salesOpsLeadProducts,
  salesOpsLeadStages,
  salesOpsLeads,
  salesOpsPeople,
  salesOpsPersonFuncoes,
  salesOpsProducts,
  salesOpsSales,
} from '../../../db/schema.js';
import type {
  CreateLeadInput,
  LeadProductInput,
  ListLeadsQuery,
  MoveLeadInput,
  UpdateLeadInput,
} from './lead-schemas.js';
import { LEADS_DEFAULT_LIMIT } from './lead-schemas.js';
import { withTenant } from './with-tenant.js';

/**
 * The lead entity's server half.
 *
 * Three things this file deliberately does NOT do, each of them a rule rather
 * than an omission:
 *
 *  - It writes NO ledger entry, for any operation, movement included. The ledger
 *    is hash-chained, queues behind a global tail lock and is never purged; a
 *    card move is high-frequency noise. `lead-contract.test.ts` reads these
 *    bytes and fails if the writer is ever imported.
 *  - It never inserts a cliente and never inserts a venda. Creating a lead is
 *    not a commercial event: it consumes no proposta sequence, writes no
 *    `code_suffix` and moves no financial number. The cliente is resolved or
 *    created at CONVERSION time, by the proposta wizard, and not before.
 *  - It never resolves a vendedor through the deprecated boolean mirror column
 *    on a pessoa. `sales_ops_person_funcoes` against the `vendedor` system
 *    função is the one authority, and the source read in the contract test is
 *    what keeps the mirror out of this file entirely.
 */

type Db = ReturnType<typeof getDb>;

/** The caller, built at the route boundary from the VERIFIED context only. */
export type LeadScope = { userId: string; email: string | null; isAdmin: boolean };

/**
 * Shape and the `itemIndex: -1` convention are copied verbatim from
 * `SaleInputError`, so `lead-routes.ts` maps it onto the byte-identical 400 body
 * `routes.ts` already returns for a sale input error.
 */
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
  ) {
    super(code);
    this.name = 'LeadInputError';
  }
}

export type LeadView = {
  id: string;
  stageId: string;
  stageChangedAt: string;
  position: number;
  contactName: string;
  clientId: string | null;
  clientNameSnapshot: string;
  estimatedValueBrl: number;
  description: string | null;
  sellerPersonId: string | null;
  sellerNameSnapshot: string;
  saleId: string | null;
  saleStatus: string | null;
  lostReason: string | null;
  products: Array<{ productId: string | null; productNameSnapshot: string }>;
  createdAt: string;
  updatedAt: string | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Caller identity and the seller predicate
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Which pessoa the caller IS, inside the caller's own tenant transaction.
 *
 * Step 2 is a SELF-claim and only a self-claim, and it is not the third-party
 * person matching this repo rejects for the ledger. That rejected heuristic
 * guesses a THIRD PARTY's identity from unverified text, and getting it wrong
 * misattributes an entry forever. Here: the e-mail comes from the caller's own
 * VERIFIED Hub token, the row claimed is the caller's OWN, EXACTLY ONE candidate
 * is required, and the `hub_account_id IS NULL` predicate plus the partial
 * unique index make a second claim impossible. Four guards, all of them needed.
 *
 * The explicit admin repair path is `PATCH /people/:id {hubAccountId}`. Both
 * exist; neither is a fallback for the other.
 */
export async function resolveCallerPersonId(
  tx: Db,
  orgId: string,
  scope: LeadScope,
): Promise<string | null> {
  const [bound] = await tx
    .select({ id: salesOpsPeople.id })
    .from(salesOpsPeople)
    .where(and(eq(salesOpsPeople.orgId, orgId), eq(salesOpsPeople.hubAccountId, scope.userId)))
    .limit(1);
  if (bound) return bound.id;

  const email = scope.email?.trim().toLowerCase() ?? '';
  if (email === '') return null;

  // TWO rows is deliberately a refusal and not a pick: two pessoas sharing one
  // e-mail is a cadastro the server cannot disambiguate, and choosing one would
  // silently scope a seller to somebody else's board.
  const candidates = await tx
    .select({ id: salesOpsPeople.id })
    .from(salesOpsPeople)
    .where(
      and(
        eq(salesOpsPeople.orgId, orgId),
        eq(salesOpsPeople.status, 'active'),
        sql`${salesOpsPeople.hubAccountId} is null`,
        sql`lower(btrim(${salesOpsPeople.contactEmail})) = ${email}`,
      ),
    )
    .limit(2);
  if (candidates.length !== 1) return null;

  const [claimed] = await tx
    .update(salesOpsPeople)
    .set({ hubAccountId: scope.userId, updatedAt: new Date() })
    .where(
      and(
        eq(salesOpsPeople.orgId, orgId),
        eq(salesOpsPeople.id, candidates[0]!.id),
        sql`${salesOpsPeople.hubAccountId} is null`,
      ),
    )
    .returning({ id: salesOpsPeople.id });
  if (claimed) return claimed.id;

  // A concurrent claim won. Re-read rather than guess.
  const [reread] = await tx
    .select({ id: salesOpsPeople.id })
    .from(salesOpsPeople)
    .where(and(eq(salesOpsPeople.orgId, orgId), eq(salesOpsPeople.hubAccountId, scope.userId)))
    .limit(1);
  return reread?.id ?? null;
}

export type LeadScopeGate =
  | { ok: true; sellerPersonId: string | null }
  | { ok: false; reason: 'seller_person_unmapped' };

/**
 * The seller predicate, resolved on the SERVER and never derived from anything
 * the request body carries.
 *
 * It FAILS CLOSED. An unresolvable caller must never degrade into "no
 * predicate": that single mutation turns this whole slice into a cross-seller
 * data leak. The discriminated union is what makes it impossible to spell,
 * because a bare `string | null` would make `null` mean both "no predicate,
 * admin" and "no predicate, could not tell".
 */
export async function resolveLeadScopePredicate(
  tx: Db,
  orgId: string,
  scope: LeadScope,
): Promise<LeadScopeGate> {
  if (scope.isAdmin) return { ok: true, sellerPersonId: null };
  const personId = await resolveCallerPersonId(tx, orgId, scope);
  if (personId) return { ok: true, sellerPersonId: personId };
  return { ok: false, reason: 'seller_person_unmapped' };
}

type ResolvedSeller = { id: string; displayName: string };

/**
 * The vendedor, through `sales_ops_person_funcoes` against the `vendedor` SYSTEM
 * função. The returned display name is what gets written to
 * `seller_name_snapshot`: server-authoritative, exactly as `resolvePartyContexts`
 * makes `personNameSnapshot` server-authoritative, so a disagreeing body label
 * loses.
 */
async function resolveSellerPersonId(
  tx: Db,
  orgId: string,
  sellerPersonId: string,
): Promise<ResolvedSeller> {
  const [seller] = await tx
    .select({ id: salesOpsPeople.id, displayName: salesOpsPeople.displayName })
    .from(salesOpsPeople)
    .innerJoin(
      salesOpsPersonFuncoes,
      and(
        eq(salesOpsPersonFuncoes.orgId, salesOpsPeople.orgId),
        eq(salesOpsPersonFuncoes.personId, salesOpsPeople.id),
      ),
    )
    .innerJoin(
      salesOpsFuncoes,
      and(
        eq(salesOpsFuncoes.orgId, salesOpsPersonFuncoes.orgId),
        eq(salesOpsFuncoes.id, salesOpsPersonFuncoes.funcaoId),
      ),
    )
    .where(
      and(
        eq(salesOpsPeople.orgId, orgId),
        eq(salesOpsPeople.id, sellerPersonId),
        eq(salesOpsPeople.status, 'active'),
        eq(salesOpsFuncoes.slug, 'vendedor'),
        eq(salesOpsFuncoes.isSystem, true),
      ),
    )
    .limit(1);
  if (seller) return seller;

  // Tell the two apart, because they are two different operator mistakes: one is
  // a stale id, the other is a pessoa who simply does not sell.
  const [person] = await tx
    .select({ id: salesOpsPeople.id })
    .from(salesOpsPeople)
    .where(and(eq(salesOpsPeople.orgId, orgId), eq(salesOpsPeople.id, sellerPersonId)))
    .limit(1);
  throw new LeadInputError(person ? 'seller_not_a_vendedor' : 'seller_not_found');
}

/**
 * The empresa, probed with raw SQL rather than through the cadastro table object.
 *
 * The missing import is the point: a reader, and `lead-contract.test.ts`, can see
 * at a glance that this file has no way to CREATE a cliente. The returned name
 * becomes `client_name_snapshot` and a disagreeing body `clientName` loses.
 */
async function resolveClientName(tx: Db, orgId: string, clientId: string): Promise<string> {
  const rows = (await tx.execute(
    sql`SELECT name FROM sales_ops_clients WHERE org_id = ${orgId} AND id = ${clientId}::uuid LIMIT 1`,
  )) as unknown as Array<{ name: string }>;
  const name = rows[0]?.name;
  if (typeof name !== 'string') throw new LeadInputError('client_not_found');
  return name;
}

type ResolvedLeadProduct = { productId: string | null; productNameSnapshot: string };

/**
 * A body-supplied `productName` on a row that RESOLVES is discarded: the
 * snapshot is server-authoritative. A row with no `productId` stores NULL plus
 * the body's text, mirroring a free-form sale item.
 *
 * An archived produto resolves fine here. A lead may legitimately reference one,
 * and hiding an archived row belongs to the picker, never to the writer.
 */
async function resolveLeadProducts(
  tx: Db,
  orgId: string,
  rows: LeadProductInput[],
): Promise<ResolvedLeadProduct[]> {
  const resolved: ResolvedLeadProduct[] = [];
  for (const [index, row] of rows.entries()) {
    if (!row.productId) {
      resolved.push({ productId: null, productNameSnapshot: row.productName! });
      continue;
    }
    const [product] = await tx
      .select({ id: salesOpsProducts.id, name: salesOpsProducts.name })
      .from(salesOpsProducts)
      .where(and(eq(salesOpsProducts.orgId, orgId), eq(salesOpsProducts.id, row.productId)))
      .limit(1);
    if (!product) throw new LeadInputError('product_not_found', index);
    resolved.push({ productId: product.id, productNameSnapshot: product.name });
  }
  return resolved;
}

/** Full-set replacement, exactly the `replacePersonFuncoes` / `updateSale` shape. */
async function replaceLeadProducts(
  tx: Db,
  orgId: string,
  leadId: string,
  rows: LeadProductInput[],
): Promise<void> {
  const resolved = await resolveLeadProducts(tx, orgId, rows);
  await tx
    .delete(salesOpsLeadProducts)
    .where(and(eq(salesOpsLeadProducts.orgId, orgId), eq(salesOpsLeadProducts.leadId, leadId)));
  if (resolved.length === 0) return;
  await tx
    .insert(salesOpsLeadProducts)
    .values(resolved.map((row) => ({ orgId, leadId, ...row })));
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

type LeadRow = typeof salesOpsLeads.$inferSelect;

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * `sellerNameSnapshot` and `clientNameSnapshot` are PROJECTED from the row, not
 * re-joined: both columns are NOT NULL, this file is their only writer, and a
 * live join would be a second source of truth for the same label. Both are
 * rewritten on every write that could change them, which is what keeps them
 * fresh, and `sellerPersonId` travels beside the snapshot so the web can key on
 * the id without ever rendering it.
 *
 * `saleStatus` is read LIVE, because the converted column mirrors the proposta's
 * own status and nothing on the board may write it.
 */
async function readLeadView(tx: Db, orgId: string, leadId: string): Promise<LeadView> {
  const [row] = await tx
    .select({ lead: salesOpsLeads, saleStatus: salesOpsSales.status })
    .from(salesOpsLeads)
    .leftJoin(
      salesOpsSales,
      and(eq(salesOpsSales.orgId, salesOpsLeads.orgId), eq(salesOpsSales.id, salesOpsLeads.saleId)),
    )
    .where(and(eq(salesOpsLeads.orgId, orgId), eq(salesOpsLeads.id, leadId)))
    .limit(1);
  if (!row) throw new Error(`lead ${leadId} disappeared inside its own transaction`);
  return toLeadView(row.lead, row.saleStatus, await readLeadProducts(tx, orgId, [leadId]));
}

async function readLeadProducts(
  tx: Db,
  orgId: string,
  leadIds: string[],
): Promise<Map<string, ResolvedLeadProduct[]>> {
  const byLead = new Map<string, ResolvedLeadProduct[]>();
  if (leadIds.length === 0) return byLead;
  const rows = await tx
    .select({
      leadId: salesOpsLeadProducts.leadId,
      productId: salesOpsLeadProducts.productId,
      productNameSnapshot: salesOpsLeadProducts.productNameSnapshot,
    })
    .from(salesOpsLeadProducts)
    .where(
      and(
        eq(salesOpsLeadProducts.orgId, orgId),
        sql`${salesOpsLeadProducts.leadId} in ${leadIds}`,
      ),
    )
    // Ordered by the SNAPSHOT and not by created_at: a full-set replacement
    // writes every row in one INSERT, so all of them share one `now()` and the
    // tiebreaker would be a random uuid - a list whose order changed between two
    // reads of an unchanged lead. The child table carries no position column
    // (slice 01 owns the schema and gave it none, exactly as person_funcoes has
    // none), so this is a SET with a deterministic display order rather than a
    // list whose order the operator authored.
    .orderBy(asc(salesOpsLeadProducts.productNameSnapshot), asc(salesOpsLeadProducts.id));
  for (const row of rows) {
    const bucket = byLead.get(row.leadId) ?? [];
    bucket.push({ productId: row.productId, productNameSnapshot: row.productNameSnapshot });
    byLead.set(row.leadId, bucket);
  }
  return byLead;
}

function toLeadView(
  lead: LeadRow,
  saleStatus: string | null,
  products: Map<string, ResolvedLeadProduct[]>,
): LeadView {
  return {
    id: lead.id,
    stageId: lead.stageId,
    stageChangedAt: toIso(lead.stageChangedAt)!,
    position: lead.position,
    contactName: lead.contactName,
    clientId: lead.clientId,
    clientNameSnapshot: lead.clientNameSnapshot,
    estimatedValueBrl: lead.estimatedValueBrl,
    description: lead.description,
    sellerPersonId: lead.sellerPersonId,
    sellerNameSnapshot: lead.sellerNameSnapshot,
    saleId: lead.saleId,
    saleStatus: lead.saleId ? saleStatus : null,
    lostReason: lead.lostReason,
    products: products.get(lead.id) ?? [],
    createdAt: toIso(lead.createdAt)!,
    updatedAt: toIso(lead.updatedAt),
  };
}

export type ListLeadsResult =
  | { ok: true; leads: LeadView[]; nextCursor: string | null; total: number }
  | { ok: false; reason: 'seller_person_unmapped' };

/**
 * One column of the board, keyset-paginated.
 *
 * CURSOR and not OFFSET, copying `listOrgAuditHistory`'s shape so the repo keeps
 * one pagination idiom - and because it is the only correct choice here: a
 * kanban column is reordered constantly, and OFFSET over a set whose sort key is
 * being rewritten silently skips and duplicates cards between pages. The sort
 * key is the PAIR `(position, id)`: `position` is the order the operator set and
 * `id` is what makes the key total while a renumber is in flight.
 */
export async function listLeads(
  db: Db,
  orgId: string,
  query: ListLeadsQuery,
  scope: LeadScope,
): Promise<ListLeadsResult> {
  return withTenant(db, orgId, async (tx) => {
    const gate = await resolveLeadScopePredicate(tx, orgId, scope);
    if (!gate.ok) return { ok: false, reason: gate.reason } as const;

    const conditions: SQL[] = [eq(salesOpsLeads.orgId, orgId)];
    // The `else if` is the whole seller-scoping rule in one line: for a
    // non-admin the predicate is the caller's OWN person id and
    // `?sellerPersonId=` is never read AT ALL. A seller who passes a colleague's
    // id gets their own leads back - not a 403, and not the colleague's.
    if (gate.sellerPersonId) {
      conditions.push(eq(salesOpsLeads.sellerPersonId, gate.sellerPersonId));
    } else if (query.sellerPersonId) {
      conditions.push(eq(salesOpsLeads.sellerPersonId, query.sellerPersonId));
    }
    conditions.push(eq(salesOpsLeads.stageId, query.stageId));

    const [{ total }] = (await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(salesOpsLeads)
      .where(and(...conditions))) as [{ total: number }];

    if (query.cursor) {
      const [position, id] = query.cursor.split(':');
      conditions.push(
        sql`(${salesOpsLeads.position}, ${salesOpsLeads.id}) > (${Number(position)}, ${id}::uuid)`,
      );
    }

    const limit = query.limit ?? LEADS_DEFAULT_LIMIT;
    const rows = await tx
      .select({ lead: salesOpsLeads, saleStatus: salesOpsSales.status })
      .from(salesOpsLeads)
      .leftJoin(
        salesOpsSales,
        and(
          eq(salesOpsSales.orgId, salesOpsLeads.orgId),
          eq(salesOpsSales.id, salesOpsLeads.saleId),
        ),
      )
      .where(and(...conditions))
      .orderBy(asc(salesOpsLeads.position), asc(salesOpsLeads.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const products = await readLeadProducts(
      tx,
      orgId,
      page.map((row) => row.lead.id),
    );
    const last = page.at(-1);
    return {
      ok: true,
      leads: page.map((row) => toLeadView(row.lead, row.saleStatus, products)),
      nextCursor: hasMore && last ? `${last.lead.position}:${last.lead.id}` : null,
      total,
    } as const;
  });
}

export type ReadLeadResult =
  | { ok: true; lead: LeadView }
  | { ok: false; reason: 'not_found' | 'seller_person_unmapped' };

/**
 * An out-of-scope lead reads as `not_found` and never as `forbidden`: a 403 on a
 * specific uuid confirms the row exists.
 */
export async function getLead(
  db: Db,
  orgId: string,
  id: string,
  scope: LeadScope,
): Promise<ReadLeadResult> {
  return withTenant(db, orgId, async (tx) => {
    const gate = await resolveLeadScopePredicate(tx, orgId, scope);
    if (!gate.ok) return { ok: false, reason: gate.reason } as const;
    const [row] = await tx
      .select({ id: salesOpsLeads.id })
      .from(salesOpsLeads)
      .where(and(...leadIdentityConditions(orgId, id, gate.sellerPersonId)))
      .limit(1);
    if (!row) return { ok: false, reason: 'not_found' } as const;
    return { ok: true, lead: await readLeadView(tx, orgId, id) } as const;
  });
}

/**
 * `eq(salesOpsLeads.orgId, orgId)` is ALWAYS the first element, and the seller
 * predicate is appended only when there is one. Drizzle drops an `undefined`
 * member, so the admin case is the same expression minus one conjunct.
 */
function leadIdentityConditions(
  orgId: string,
  id: string,
  sellerPersonId: string | null,
): SQL[] {
  const conditions: SQL[] = [eq(salesOpsLeads.orgId, orgId), eq(salesOpsLeads.id, id)];
  if (sellerPersonId) conditions.push(eq(salesOpsLeads.sellerPersonId, sellerPersonId));
  return conditions;
}

// ─────────────────────────────────────────────────────────────────────────────
// Writes
// ─────────────────────────────────────────────────────────────────────────────

export type WriteLeadResult =
  | { ok: true; lead: LeadView }
  | {
      ok: false;
      reason: 'not_found' | 'seller_scope' | 'seller_person_unmapped' | 'already_converted';
    };

export async function createLead(
  db: Db,
  orgId: string,
  input: CreateLeadInput,
  scope: LeadScope,
): Promise<WriteLeadResult> {
  return withTenant(db, orgId, async (tx) => {
    const gate = await resolveLeadScopePredicate(tx, orgId, scope);
    if (!gate.ok) return { ok: false, reason: gate.reason } as const;

    // A seller may only file their OWN leads, and may not file an unassigned one
    // either - `null !== gate.sellerPersonId` catches that. A loud 403 rather
    // than a 404, because they named the id themselves, so it leaks nothing.
    const requestedSeller = input.sellerPersonId ?? null;
    if (gate.sellerPersonId && requestedSeller !== gate.sellerPersonId) {
      return { ok: false, reason: 'seller_scope' } as const;
    }

    const seller = requestedSeller ? await resolveSellerPersonId(tx, orgId, requestedSeller) : null;
    const clientName = input.clientId
      ? await resolveClientName(tx, orgId, input.clientId)
      : input.clientName;

    // A new lead always lands in the first ACTIVE normal stage by board order.
    // "position" is double-quoted in every hand-written SQL string because it is
    // a reserved word in some dialects; `name` is the tiebreaker, matching the
    // stage list's own (position, name) read order.
    const [stage] = await tx
      .select({ id: salesOpsLeadStages.id })
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
    if (!stage) throw new LeadInputError('no_open_stage');

    const [{ next }] = (await tx
      .select({ next: sql<number>`COALESCE(MAX(${salesOpsLeads.position}), 0) + 1` })
      .from(salesOpsLeads)
      .where(and(eq(salesOpsLeads.orgId, orgId), eq(salesOpsLeads.stageId, stage.id)))) as [
      { next: number },
    ];

    const [lead] = await tx
      .insert(salesOpsLeads)
      .values({
        orgId,
        stageId: stage.id,
        position: next,
        contactName: input.contactName,
        clientId: input.clientId ?? null,
        clientNameSnapshot: clientName,
        estimatedValueBrl: input.estimatedValueBrl,
        description: input.description ?? null,
        sellerPersonId: seller?.id ?? null,
        sellerNameSnapshot: seller?.displayName ?? '',
        // Both literal, and both unreachable from CreateLeadSchema: a lead
        // cannot be born converted or born lost.
        saleId: null,
        lostReason: null,
        // stage_changed_at takes its column default, so "days parked" starts at
        // zero with no app-clock write.
      })
      .returning();

    await replaceLeadProducts(tx, orgId, lead!.id, input.products);
    return { ok: true, lead: await readLeadView(tx, orgId, lead!.id) } as const;
  });
}

export async function updateLead(
  db: Db,
  orgId: string,
  id: string,
  input: UpdateLeadInput,
  scope: LeadScope,
): Promise<WriteLeadResult> {
  return withTenant(db, orgId, async (tx) => {
    const gate = await resolveLeadScopePredicate(tx, orgId, scope);
    if (!gate.ok) return { ok: false, reason: gate.reason } as const;

    const [current] = await tx
      .select()
      .from(salesOpsLeads)
      .where(and(...leadIdentityConditions(orgId, id, gate.sellerPersonId)))
      .limit(1)
      .for('update');
    if (!current) return { ok: false, reason: 'not_found' } as const;
    // A converted card is read-only: its data now lives on the proposta.
    if (current.saleId !== null) return { ok: false, reason: 'already_converted' } as const;

    let seller: ResolvedSeller | null = null;
    if (input.sellerPersonId !== undefined) {
      const requested = input.sellerPersonId ?? null;
      if (gate.sellerPersonId && requested !== gate.sellerPersonId) {
        return { ok: false, reason: 'seller_scope' } as const;
      }
      seller = requested ? await resolveSellerPersonId(tx, orgId, requested) : null;
    }

    let clientNameSnapshot: string | undefined;
    if (input.clientId !== undefined) {
      clientNameSnapshot = input.clientId
        ? await resolveClientName(tx, orgId, input.clientId)
        : // The column is NOT NULL, so clearing the LINK can never blank the
          // label: the body's text wins, and the stored snapshot is the floor.
          (input.clientName ?? current.clientNameSnapshot);
    } else if (input.clientName !== undefined) {
      clientNameSnapshot = input.clientName;
    }

    await tx
      .update(salesOpsLeads)
      // Built from `input` alone, and `UpdateLeadSchema` is `.strict()` and
      // declares no stageId, position, stageChangedAt, saleId or lostReason - so
      // none of those keys can appear here, ever.
      .set({
        ...(input.contactName !== undefined ? { contactName: input.contactName } : {}),
        ...(input.clientId !== undefined ? { clientId: input.clientId ?? null } : {}),
        ...(clientNameSnapshot !== undefined ? { clientNameSnapshot } : {}),
        ...(input.estimatedValueBrl !== undefined
          ? { estimatedValueBrl: input.estimatedValueBrl }
          : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.sellerPersonId !== undefined
          ? {
              sellerPersonId: seller?.id ?? null,
              sellerNameSnapshot: seller?.displayName ?? '',
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(salesOpsLeads.orgId, orgId), eq(salesOpsLeads.id, id)));

    // `undefined` leaves the child rows alone; `[]` clears them. The same
    // distinction `updateProduct` draws for the produto's função costs.
    if (input.products !== undefined) await replaceLeadProducts(tx, orgId, id, input.products);

    return { ok: true, lead: await readLeadView(tx, orgId, id) } as const;
  });
}

/**
 * The ONLY writer of `stage_id`, `position`, `stage_changed_at`, `lost_reason`
 * and `sale_id`.
 */
export async function moveLead(
  db: Db,
  orgId: string,
  id: string,
  input: MoveLeadInput,
  scope: LeadScope,
): Promise<WriteLeadResult> {
  return withTenant(db, orgId, async (tx) => {
    const gate = await resolveLeadScopePredicate(tx, orgId, scope);
    if (!gate.ok) return { ok: false, reason: gate.reason } as const;

    const [current] = await tx
      .select()
      .from(salesOpsLeads)
      .where(and(...leadIdentityConditions(orgId, id, gate.sellerPersonId)))
      .limit(1)
      .for('update');
    if (!current) return { ok: false, reason: 'not_found' } as const;

    // The read-only final column, enforced on the server and not merely
    // un-draggable in the UI. It is also what makes "no board action reaches
    // POST /sales/:id/transition" true by construction: once a lead carries a
    // proposta there is no lead operation left that could.
    if (current.saleId !== null) return { ok: false, reason: 'already_converted' } as const;

    // An ARCHIVED stage is not a move target.
    const [destination] = await tx
      .select({ id: salesOpsLeadStages.id, kind: salesOpsLeadStages.kind })
      .from(salesOpsLeadStages)
      .where(
        and(
          eq(salesOpsLeadStages.orgId, orgId),
          eq(salesOpsLeadStages.id, input.stageId),
          eq(salesOpsLeadStages.status, 'active'),
        ),
      )
      .limit(1);
    if (!destination) throw new LeadInputError('stage_not_found');

    // This cannot be a zod refine: the requirement depends on the DESTINATION
    // row's kind, which is a database read. So it is the service sentinel 400,
    // the same shape routes.ts already returns for entrada_mode_value_mismatch.
    if (destination.kind === 'lost' && input.reason === undefined) {
      throw new LeadInputError('lost_reason_required');
    }

    if (destination.kind === 'conversion') {
      if (input.saleId === undefined) throw new LeadInputError('sale_required_for_conversion');
      // The in-org SELECT is what produces the designed 400. The composite FK
      // sales_ops_leads_org_sale_fk is the backstop underneath it: without this
      // read a cross-org id would surface as a raw 23503 and an HTTP 500.
      const [sale] = await tx
        .select({ id: salesOpsSales.id })
        .from(salesOpsSales)
        .where(and(eq(salesOpsSales.orgId, orgId), eq(salesOpsSales.id, input.saleId)))
        .limit(1);
      if (!sale) throw new LeadInputError('sale_not_found');
    } else if (input.saleId !== undefined) {
      // sale_id and "is in the conversion column" can never diverge.
      throw new LeadInputError('sale_not_allowed');
    }

    const stageChanged = destination.id !== current.stageId;

    await tx
      .update(salesOpsLeads)
      .set({
        stageId: destination.id,
        // KEY OMISSION, never `stageChanged ? now : current.stageChangedAt`. A
        // reorder inside one stage produces an UPDATE whose `set` object has no
        // stage_changed_at key at all, so the column is physically untouchable
        // by a reorder - the rule is not a branch someone can later "simplify".
        ...(stageChanged ? { stageChangedAt: new Date() } : {}),
        lostReason: destination.kind === 'lost' ? (input.reason ?? null) : null,
        ...(destination.kind === 'conversion' ? { saleId: input.saleId! } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(salesOpsLeads.orgId, orgId), eq(salesOpsLeads.id, id)));

    await renumberStage(tx, orgId, destination.id, { moved: id, at: input.position });
    if (stageChanged) await renumberStage(tx, orgId, current.stageId, null);

    return { ok: true, lead: await readLeadView(tx, orgId, id) } as const;
  });
}

/**
 * Writes dense 1..N over one column, in ONE statement.
 *
 * `FOR UPDATE` over the whole column, always in (position, id) order, is what
 * makes two concurrent drags of the same column serialize at Postgres rather
 * than interleave into duplicate positions.
 */
async function renumberStage(
  tx: Db,
  orgId: string,
  stageId: string,
  placement: { moved: string; at: number } | null,
): Promise<void> {
  const rows = await tx
    .select({ id: salesOpsLeads.id })
    .from(salesOpsLeads)
    .where(and(eq(salesOpsLeads.orgId, orgId), eq(salesOpsLeads.stageId, stageId)))
    .orderBy(asc(salesOpsLeads.position), asc(salesOpsLeads.id))
    .for('update');

  let ids = rows.map((row) => row.id);
  if (placement) {
    ids = ids.filter((id) => id !== placement.moved);
    // Clamped rather than refused: an out-of-range index parks the card at the
    // end of the column, which is what a drag past the last card means.
    ids.splice(Math.min(placement.at, ids.length), 0, placement.moved);
  }
  if (ids.length === 0) return;

  // Both casts are load-bearing: a bare VALUES row has no column types, so
  // Postgres infers text for each parameter and the comparison against the
  // integer column fails to resolve an operator.
  const values = ids.map((id, index) => sql`(${id}::uuid, ${index + 1}::int)`);
  await tx.execute(sql`
    UPDATE sales_ops_leads AS l SET "position" = v.pos
    FROM (VALUES ${sql.join(values, sql`, `)}) AS v(id, pos)
    WHERE l.org_id = ${orgId} AND l.id = v.id AND l."position" IS DISTINCT FROM v.pos
  `);
}
