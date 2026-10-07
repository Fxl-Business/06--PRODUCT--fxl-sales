import type { SalesEdition } from '@fxl-sales/shared-utils/sales-edition';
import { and, asc, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
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
  CreateContactLeadInput,
  CreateLeadInput,
  LeadProductInput,
  LeadStageSummaryQuery,
  ListLeadsQuery,
  MoveLeadInput,
  UpdateContactLeadInput,
  UpdateLeadInput,
} from './lead-schemas.js';
import { LEADS_DEFAULT_LIMIT } from './lead-schemas.js';
import { PersonSchema, createPersonTx } from '../service.js';
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
 *    bytes and fails if the writer is ever imported. Deleting and restoring a
 *    lead DO write one, which is exactly why they live in `lead-trash-service.ts`
 *    and not here; this file only exports the board plumbing they share (the
 *    lock, the renumber, the identity predicate, the view).
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
export type LeadScope = {
  userId: string;
  email: string | null;
  isAdmin: boolean;
  /** The verified token display name, or null. Read only by the leads-edition auto-provision. */
  name?: string | null;
  /** Whether the verified `userRoles` carry `seller`. Read only by the leads-edition auto-provision. */
  hasSellerRole?: boolean;
  /**
   * The edition the auth middleware resolved from the verified token. Absent
   * means 'full', so every caller that does not pass it (the import executor,
   * the FXL routes before this field existed) keeps today's behaviour.
   */
  edition?: SalesEdition;
};

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
  /** Leads-edition contact data (edicao-leads). Always present; null for FXL leads. */
  contactPhone: string | null;
  contactEmail: string | null;
  /** ISO civil day `YYYY-MM-DD`; never formatted through Date. */
  contactBirthDate: string | null;
  sellerPersonId: string | null;
  sellerNameSnapshot: string;
  saleId: string | null;
  saleStatus: string | null;
  saleCode: string | null;
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
export type LeadScopeAllowed = Extract<LeadScopeGate, { ok: true }>;

/**
 * The seller predicate, resolved on the SERVER and never derived from anything
 * the request body carries.
 *
 * It FAILS CLOSED. An unresolvable caller must never degrade into "no
 * predicate": that single mutation turns this whole slice into a cross-seller
 * data leak. The discriminated union is what makes it impossible to spell,
 * because a bare `string | null` would make `null` mean both "no predicate,
 * admin" and "no predicate, could not tell".
 *
 * A non-admin also carries `canClaimUnassigned`, true only for an active
 * vendedor: it widens the predicate to the unassigned pool and makes the first
 * write a claim (see `leadSellerCondition` and `claimantFor`).
 */
export async function resolveLeadScopePredicate(
  tx: Db,
  orgId: string,
  scope: LeadScope,
): Promise<LeadScopeGate> {
  if (scope.isAdmin) return { ok: true, sellerPersonId: null, canClaimUnassigned: false };
  const personId = await resolveCallerPersonId(tx, orgId, scope);
  if (personId) return sellerGate(tx, orgId, personId);
  // The full edition never reaches the provisioning code: an FXL seller without
  // a pessoa is an operator cadastro gap and keeps answering unmapped.
  if (scope.edition === 'leads') {
    const provisioned = await provisionLeadsSellerPerson(tx, orgId, scope);
    if (provisioned) return sellerGate(tx, orgId, provisioned);
  }
  return { ok: false, reason: 'seller_person_unmapped' };
}

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

/** `sales_ops_people.display_name` is capped by `PersonSchema` at this length. */
const PROVISIONED_NAME_MAX = 120;

/** The verified name, trimmed and capped, else the e-mail local part. */
function provisionedDisplayName(scope: LeadScope, email: string): string {
  let name = (scope.name ?? '').trim().slice(0, PROVISIONED_NAME_MAX);
  // Never cut a surrogate pair in half.
  if (/[\uD800-\uDBFF]$/.test(name)) name = name.slice(0, -1);
  name = name.trimEnd();
  if (name !== '') return name;
  const localPart = email.split('@')[0] ?? '';
  return localPart !== '' ? localPart : email;
}

const HUB_ACCOUNT_UNIQUE_INDEX = 'sales_ops_people_org_hub_account_idx';

/** A UNIQUE violation of the one-pessoa-per-Hub-account index (a concurrent provision or bind won). */
function isHubAccountUniqueViolation(error: unknown): boolean {
  // postgres.js puts code/constraint_name on the error; drizzle re-throws it
  // wrapped, exposing the original under `cause`.
  const candidates = [error, (error as { cause?: unknown } | null)?.cause];
  for (const candidate of candidates) {
    const pgError = candidate as
      | { code?: string; constraint_name?: string; constraint?: string }
      | null
      | undefined;
    if (!pgError || pgError.code !== '23505') continue;
    if ((pgError.constraint_name ?? pgError.constraint) === HUB_ACCOUNT_UNIQUE_INDEX) return true;
  }
  return false;
}

/**
 * Leads edition only: creates the caller's OWN pessoa on their first leads
 * request, after binding by account and the e-mail self-claim both found
 * nothing.
 *
 * Safe because the Hub already verified the account, the org and the app role
 * `seller`, and the row created is the caller's own, so scoping still shows
 * only their leads. It never guesses: any pessoa in the org already carrying
 * the token e-mail (two unbound ones, an inactive one, one bound elsewhere) is
 * a cadastro an admin made, and the caller stays `seller_person_unmapped`.
 *
 * Runs inside the request's tenant transaction through `createPersonTx` with
 * the leads edition, so the pessoa is exactly a vendedor and the system
 * funções are seeded in the same transaction.
 *
 * Concurrent first requests for one account. The transaction is READ
 * COMMITTED, so EVERY statement takes a fresh snapshot, and a winner may commit
 * between any two of the loser's statements. Two interleavings follow, and both
 * end on the winner's row through {@link boundPersonId}, re-read by account:
 *  - The winner commits after the loser's account lookup (a miss) but before
 *    its e-mail check, which then sees the winner's pessoa carrying the e-mail.
 *    Every e-mail hit re-reads by account BEFORE refusing, so a pessoa bound to
 *    this very account is returned as the caller's own.
 *  - The winner has not committed by the e-mail check. Both reach the INSERT;
 *    the partial unique index on (org_id, hub_account_id) makes the loser wait
 *    for the winner's commit and fail with 23505 inside a SAVEPOINT, so the
 *    request transaction survives, and the loser re-reads.
 * One account never gets two pessoas, and the loser is never refused.
 *
 * Exported for the oracle, which forces the first interleaving; the only
 * product caller is `resolveLeadScopePredicate`.
 */
export async function provisionLeadsSellerPerson(
  tx: Db,
  orgId: string,
  scope: LeadScope,
): Promise<string | null> {
  if (scope.hasSellerRole !== true) return null;
  const email = scope.email?.trim().toLowerCase() ?? '';
  if (email === '') return null;

  const [existing] = await tx
    .select({ id: salesOpsPeople.id })
    .from(salesOpsPeople)
    .where(
      and(
        eq(salesOpsPeople.orgId, orgId),
        sql`lower(btrim(${salesOpsPeople.contactEmail})) = ${email}`,
      ),
    )
    .limit(1);
  // A fresh statement, so it sees a pessoa a concurrent request bound to this
  // account after our account lookup missed. Only a pessoa bound elsewhere, or
  // unbound, is somebody else's cadastro and a refusal.
  if (existing) return boundPersonId(tx, orgId, scope.userId);

  const input = PersonSchema.safeParse({
    displayName: provisionedDisplayName(scope, email),
    contactEmail: email,
    status: 'active',
    hubAccountId: scope.userId,
  });
  if (!input.success) return null;

  try {
    const created = await tx.transaction((savepoint) =>
      createPersonTx(savepoint as unknown as Db, orgId, input.data, { edition: 'leads' }),
    );
    return typeof created === 'string' ? null : created.id;
  } catch (error) {
    if (!isHubAccountUniqueViolation(error)) throw error;
  }
  // The 23505 is raised only after the winner committed, so this statement's
  // snapshot always contains the winner's row.
  return boundPersonId(tx, orgId, scope.userId);
}

/** The pessoa bound to the account, read with a fresh statement snapshot. */
async function boundPersonId(tx: Db, orgId: string, userId: string): Promise<string | null> {
  const [bound] = await tx
    .select({ id: salesOpsPeople.id })
    .from(salesOpsPeople)
    .where(and(eq(salesOpsPeople.orgId, orgId), eq(salesOpsPeople.hubAccountId, userId)))
    .limit(1);
  return bound?.id ?? null;
}

type ResolvedSeller = { id: string; displayName: string };

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
        eq(salesOpsPeople.id, personId),
        eq(salesOpsPeople.status, 'active'),
        eq(salesOpsFuncoes.slug, 'vendedor'),
        eq(salesOpsFuncoes.isSystem, true),
      ),
    )
    .limit(1);
  return seller ?? null;
}

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
  const seller = await findActiveVendedor(tx, orgId, sellerPersonId);
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

/** Full-set replacement, exactly the `replacePersonFuncoes` shape. */
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
 *
 * Live only. Every caller has just proven the lead live inside this transaction,
 * or (a restore) just made it live, so a deleted row here is a bug and throws.
 */
export async function readLeadView(tx: Db, orgId: string, leadId: string): Promise<LeadView> {
  const [row] = await tx
    .select({ lead: salesOpsLeads, saleStatus: salesOpsSales.status, saleCode: salesOpsSales.code })
    .from(salesOpsLeads)
    .leftJoin(
      salesOpsSales,
      and(eq(salesOpsSales.orgId, salesOpsLeads.orgId), eq(salesOpsSales.id, salesOpsLeads.saleId)),
    )
    .where(and(eq(salesOpsLeads.orgId, orgId), eq(salesOpsLeads.id, leadId), liveLeadCondition()))
    .limit(1);
  if (!row) throw new Error(`lead ${leadId} disappeared inside its own transaction`);
  return toLeadView(
    row.lead,
    row.saleStatus,
    row.saleCode,
    await readLeadProducts(tx, orgId, [leadId]),
  );
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
  saleCode: string | null,
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
    contactPhone: lead.contactPhone,
    contactEmail: lead.contactEmail,
    contactBirthDate: lead.contactBirthDate,
    sellerPersonId: lead.sellerPersonId,
    sellerNameSnapshot: lead.sellerNameSnapshot,
    saleId: lead.saleId,
    saleStatus: lead.saleId ? saleStatus : null,
    // Guarded by `lead.saleId` for the same reason `saleStatus` is: the LEFT JOIN
    // yields a row either way, and a code without a link is a label pointing at
    // nothing. The board renders this as the card's only proposta identity.
    saleCode: lead.saleId ? saleCode : null,
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

    // The count below and the page share this one `conditions` array, so `total`
    // counts exactly the rows a page can return.
    const conditions = leadBoardConditions(orgId, gate, query.sellerPersonId);
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
      .select({ lead: salesOpsLeads, saleStatus: salesOpsSales.status, saleCode: salesOpsSales.code })
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
      leads: page.map((row) => toLeadView(row.lead, row.saleStatus, row.saleCode, products)),
      nextCursor: hasMore && last ? `${last.lead.position}:${last.lead.id}` : null,
      total,
    } as const;
  });
}

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
      .where(and(...leadIdentityConditions(orgId, id, gate)))
      .limit(1);
    if (!row) return { ok: false, reason: 'not_found' } as const;
    return { ok: true, lead: await readLeadView(tx, orgId, id) } as const;
  });
}

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
 * expression minus one conjunct. It always carries `liveLeadCondition()`, so a
 * deleted lead is `not_found` to every identity read (get, PATCH, move, delete)
 * for every caller, admin included. Exported for lead-trash-service.ts.
 */
export function leadIdentityConditions(orgId: string, id: string, gate: LeadScopeAllowed): SQL[] {
  const conditions: SQL[] = [
    eq(salesOpsLeads.orgId, orgId),
    eq(salesOpsLeads.id, id),
    liveLeadCondition(),
  ];
  if (gate.sellerPersonId) {
    conditions.push(leadSellerCondition(gate.sellerPersonId, gate.canClaimUnassigned));
  }
  return conditions;
}

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

/**
 * The pessoa a write on `current` claims the lead for, or null for no claim.
 *
 * Only a non-admin caller who may see the pool claims (an admin never does: the
 * lead stays in the pool, gestor decision), and only a lead that was still
 * unassigned when its row lock was taken. Callers decide this AFTER the
 * `already_converted` refusal and the lead UPDATE carries it, so a refused write
 * never claims and a thrown one is rolled back with the transaction.
 *
 * The race guard is the `SELECT ... FOR UPDATE` that produced `current`. A
 * second vendedor's PATCH on the same unassigned lead blocks on that row lock, and
 * READ COMMITTED re-checks its WHERE against the committed row once the first
 * commits. A second MOVE already waited on the board lock (`lockLeadBoard`)
 * before its identity read, so that read is a fresh statement that sees the
 * committed claim. Either way `seller = A` matches neither `seller = B` nor
 * `IS NULL`, so the second reads no row and answers not_found. Never raise these
 * transactions to REPEATABLE READ: the loser would then fail with 40001 (a 500)
 * instead.
 *
 * The `canClaimUnassigned` conjunct is redundant with the read predicate today
 * and kept so a future predicate change can never turn a finder into a claimant.
 */
function claimantFor(gate: LeadScopeAllowed, current: LeadRow): string | null {
  if (gate.sellerPersonId === null || !gate.canClaimUnassigned) return null;
  return current.sellerPersonId === null ? gate.sellerPersonId : null;
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

/**
 * The one normalized record both create paths insert. Internal: the full and the
 * leads-edition wire shapes are mapped onto it by the two exported wrappers
 * below, so the scope, seller and stage rules exist exactly once.
 */
type LeadCreateRecord = {
  contactName: string;
  clientId: string | null;
  clientName: string;
  estimatedValueBrl: number;
  description: string | null;
  sellerPersonId: string | null;
  products: LeadProductInput[];
  contactPhone: string | null;
  contactEmail: string | null;
  contactBirthDate: string | null;
};

export function createLead(
  db: Db,
  orgId: string,
  input: CreateLeadInput,
  scope: LeadScope,
): Promise<WriteLeadResult> {
  return insertLead(
    db,
    orgId,
    {
      contactName: input.contactName,
      clientId: input.clientId ?? null,
      clientName: input.clientName,
      estimatedValueBrl: input.estimatedValueBrl,
      description: input.description ?? null,
      sellerPersonId: input.sellerPersonId ?? null,
      products: input.products,
      contactPhone: null,
      contactEmail: null,
      contactBirthDate: null,
    },
    scope,
  );
}

/**
 * The leads-edition create. It carries an optional empresa (`clientId` resolves
 * the snapshot, otherwise the free-text `clientName`) and a valor estimado, but
 * never produtos: that child table stays full-edition only, so `products` is
 * always empty here.
 */
export function createContactLead(
  db: Db,
  orgId: string,
  input: CreateContactLeadInput,
  scope: LeadScope,
): Promise<WriteLeadResult> {
  return insertLead(
    db,
    orgId,
    {
      contactName: input.contactName,
      clientId: input.clientId ?? null,
      clientName: input.clientName ?? '',
      estimatedValueBrl: input.estimatedValueBrl ?? 0,
      description: input.description ?? null,
      sellerPersonId: input.sellerPersonId ?? null,
      products: [],
      contactPhone: input.contactPhone ?? null,
      contactEmail: input.contactEmail ?? null,
      contactBirthDate: input.contactBirthDate ?? null,
    },
    scope,
    { defaultSellerToCaller: true },
  );
}

type InsertLeadOptions = {
  /**
   * Leads edition only (D-07.1a): a scoped seller who names no vendedor files
   * the lead as their own instead of being refused. The full edition never
   * passes it, so its `seller_scope` rule stays byte-for-byte.
   */
  defaultSellerToCaller?: boolean;
};

/**
 * The org's lead board lock: the ONE place the lock order of a board write is
 * decided.
 *
 * Every transaction that writes a lead's `stage_id` or `position` (`moveLead`,
 * `insertLead`, and `deleteLead` / `restoreLead` in lead-trash-service.ts) takes it right after its scope gate and BEFORE it reads or locks
 * any lead row. Without it two writers sharing a column lock rows in opposite
 * orders: a move locks its own card first and then the whole destination and
 * source columns, so two vendedores dragging two cards out of one column each
 * held their own card while waiting for the other's, and Postgres aborted one
 * with 40P01, an HTTP 500. A create read MAX(position) with no lock at all, so
 * two creates could share a position. One lock per org, held to the end of the
 * writer's transaction, serializes them all. A holder may still wait on a card a
 * concurrent PATCH has locked, but a PATCH never asks for the board, so no
 * cycle can close.
 *
 * Why an advisory lock, and why per ORG:
 *  - Locking the two stage rows instead would collide with `reorderLeadStages`,
 *    which locks every active stage FOR UPDATE in position order, and with the
 *    foreign-key check of every lead INSERT. A key nothing else ever takes
 *    cannot.
 *  - Per stage would need the source stage before the card is read, a re-check
 *    after locking, and an out-of-order second lock whenever a concurrent move
 *    won in between. A board is one team dragging cards by hand: per org costs
 *    nothing measurable and leaves no order to get wrong.
 *
 * Transaction scoped (`_xact_`): COMMIT or ROLLBACK releases it and nothing else
 * can, so no path leaks it. Taken inside a SAVEPOINT (the import executor runs
 * these services on its own transaction) it passes to the parent when the
 * savepoint is released, so an import holds the board until it commits. The two
 * int4 keys are a namespace and the org; an org hash collision only makes two
 * boards share one queue.
 */
export async function lockLeadBoard(tx: Db, orgId: string): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('fxl-sales:lead-board'), hashtext(${orgId}))`,
  );
}

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

async function insertLead(
  db: Db,
  orgId: string,
  record: LeadCreateRecord,
  scope: LeadScope,
  options: InsertLeadOptions = {},
): Promise<WriteLeadResult> {
  return withTenant(db, orgId, async (tx) => {
    const gate = await resolveLeadScopePredicate(tx, orgId, scope);
    if (!gate.ok) return { ok: false, reason: gate.reason } as const;

    // Before MAX(position) below: a second create must wait for this one's row.
    await lockLeadBoard(tx, orgId);

    // A seller may only file their OWN leads, and may not file an unassigned one
    // either - `null !== gate.sellerPersonId` catches that. A loud 403 rather
    // than a 404, because they named the id themselves, so it leaks nothing.
    // The leads edition defaults an unnamed vendedor to the caller first, so
    // only an explicit OTHER id is refused there.
    const requestedSeller =
      options.defaultSellerToCaller && gate.sellerPersonId && record.sellerPersonId === null
        ? gate.sellerPersonId
        : record.sellerPersonId;
    if (gate.sellerPersonId && requestedSeller !== gate.sellerPersonId) {
      return { ok: false, reason: 'seller_scope' } as const;
    }

    const seller = requestedSeller ? await resolveSellerPersonId(tx, orgId, requestedSeller) : null;
    const clientName = record.clientId
      ? await resolveClientName(tx, orgId, record.clientId)
      : record.clientName;

    // A new lead always lands in the first ACTIVE normal stage by board order.
    const stage = await firstOpenLeadStage(tx, orgId);
    // The edition-independent "no etapa yet" answer; the leads edition starts with zero etapas (edicao-leads AC4).
    if (!stage) throw new LeadInputError('no_open_stage');

    const next = await nextLeadPosition(tx, orgId, stage.id);

    const [lead] = await tx
      .insert(salesOpsLeads)
      .values({
        orgId,
        stageId: stage.id,
        position: next,
        contactName: record.contactName,
        clientId: record.clientId,
        clientNameSnapshot: clientName,
        estimatedValueBrl: record.estimatedValueBrl,
        description: record.description,
        contactPhone: record.contactPhone,
        contactEmail: record.contactEmail,
        contactBirthDate: record.contactBirthDate,
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

    await replaceLeadProducts(tx, orgId, lead!.id, record.products);
    return { ok: true, lead: await readLeadView(tx, orgId, lead!.id) } as const;
  });
}

/**
 * Everything a lead PATCH may carry, across both editions. The full wire schema
 * never produces the three contact keys and the contact schema never produces
 * products, so each edition can only touch its own columns. Empresa
 * (clientId/clientName) and estimatedValueBrl are shared by both editions.
 */
type LeadUpdatePatch = Omit<UpdateLeadInput, 'clientName'> & {
  // The contact schema clears the empresa with `null`; the full schema's
  // clientName is `string | undefined`, so the patch widens it to carry both.
  clientName?: string | null | undefined;
  contactPhone?: string | null | undefined;
  contactEmail?: string | null | undefined;
  contactBirthDate?: string | null | undefined;
};

export function updateLead(
  db: Db,
  orgId: string,
  id: string,
  input: UpdateLeadInput,
  scope: LeadScope,
): Promise<WriteLeadResult> {
  return applyLeadUpdate(db, orgId, id, input, scope);
}

/** The leads-edition PATCH. May set empresa and valor; never touches produtos. */
export function updateContactLead(
  db: Db,
  orgId: string,
  id: string,
  input: UpdateContactLeadInput,
  scope: LeadScope,
): Promise<WriteLeadResult> {
  return applyLeadUpdate(db, orgId, id, input, scope);
}

async function applyLeadUpdate(
  db: Db,
  orgId: string,
  id: string,
  input: LeadUpdatePatch,
  scope: LeadScope,
): Promise<WriteLeadResult> {
  return withTenant(db, orgId, async (tx) => {
    const gate = await resolveLeadScopePredicate(tx, orgId, scope);
    if (!gate.ok) return { ok: false, reason: gate.reason } as const;

    const [current] = await tx
      .select()
      .from(salesOpsLeads)
      .where(and(...leadIdentityConditions(orgId, id, gate)))
      .limit(1)
      .for('update');
    if (!current) return { ok: false, reason: 'not_found' } as const;
    // A converted card is read-only: its data now lives on the proposta.
    if (current.saleId !== null) return { ok: false, reason: 'already_converted' } as const;

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

    let clientNameSnapshot: string | undefined;
    if (input.clientId !== undefined) {
      clientNameSnapshot = input.clientId
        ? await resolveClientName(tx, orgId, input.clientId)
        : // The column is NOT NULL, so clearing the LINK can never blank the
          // label: the body's text wins, and the stored snapshot is the floor.
          (input.clientName ?? current.clientNameSnapshot);
    } else if (input.clientName !== undefined) {
      // NOT NULL floor: a null clear keeps the stored snapshot, matching the
      // clientId branch above.
      clientNameSnapshot = input.clientName ?? current.clientNameSnapshot;
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
        ...(input.contactPhone !== undefined ? { contactPhone: input.contactPhone } : {}),
        ...(input.contactEmail !== undefined ? { contactEmail: input.contactEmail } : {}),
        ...(input.contactBirthDate !== undefined
          ? { contactBirthDate: input.contactBirthDate }
          : {}),
        ...(writesSeller
          ? {
              sellerPersonId: seller?.id ?? null,
              sellerNameSnapshot: seller?.displayName ?? '',
            }
          : {}),
        updatedAt: new Date(),
      })
      // Live again here, not only in the identity read: belt and braces under READ COMMITTED, the row lock above already re-checked it.
      .where(and(eq(salesOpsLeads.orgId, orgId), eq(salesOpsLeads.id, id), liveLeadCondition()));

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
    // Before the card's row lock, never after it: see lockLeadBoard.
    await lockLeadBoard(tx, orgId);

    const [current] = await tx
      .select()
      .from(salesOpsLeads)
      .where(and(...leadIdentityConditions(orgId, id, gate)))
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

    // The claim (leads-sem-vendedor), resolved after every validation above so a
    // refused move never claims, and written by the same UPDATE as the move.
    const claimant = claimantFor(gate, current);
    const claimed = claimant !== null ? await resolveSellerPersonId(tx, orgId, claimant) : null;

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
        ...(claimed ? { sellerPersonId: claimed.id, sellerNameSnapshot: claimed.displayName } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(salesOpsLeads.orgId, orgId), eq(salesOpsLeads.id, id), liveLeadCondition()));

    await renumberStage(tx, orgId, destination.id, { moved: id, at: input.position });
    if (stageChanged) await renumberStage(tx, orgId, current.stageId, null);

    return { ok: true, lead: await readLeadView(tx, orgId, id) } as const;
  });
}

/**
 * Writes dense 1..N over one column, in ONE statement.
 *
 * Every caller holds the board lock (`lockLeadBoard`), and THAT is what
 * serializes two drags: no other writer of a position can touch this column until
 * the caller's transaction ends, so the read below already sees every committed
 * move. The `FOR UPDATE` is no longer the guard. It stays because it is harmless:
 * it can only wait on a card a concurrent PATCH holds, and a PATCH never asks for
 * the board, so the wait cannot close a cycle.
 *
 * Over LIVE cards only. A deleted card keeps its stale position untouched (it is
 * irrelevant while deleted, and a restore appends at the end), and the raw UPDATE
 * below can only reach ids this live read returned.
 */
export async function renumberStage(
  tx: Db,
  orgId: string,
  stageId: string,
  placement: { moved: string; at: number } | null,
): Promise<void> {
  const rows = await tx
    .select({ id: salesOpsLeads.id })
    .from(salesOpsLeads)
    .where(
      and(
        eq(salesOpsLeads.orgId, orgId),
        eq(salesOpsLeads.stageId, stageId),
        liveLeadCondition(),
      ),
    )
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
