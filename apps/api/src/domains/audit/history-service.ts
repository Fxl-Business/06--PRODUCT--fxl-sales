import { and, desc, eq, inArray, lt, sql, type SQL } from 'drizzle-orm';
import type { getDb } from '../../db/client.js';
import { auditLog, finders } from '../../db/schema.js';
import { setTenantContext } from '../../middleware/auth.js';

/**
 * TENANT-SCOPED audit history read.
 *
 * This module is deliberately separate from `./service.ts` (the write path and
 * the chain algorithm) and from `./routes.ts` (the CROSS-TENANT admin reader
 * that goes through the admin connection and applies no org predicate at all).
 *
 * `audit_log` has NO row level security - verified: `relrowsecurity = f` - and
 * the ordinary application role holds SELECT on every row of it. So the
 * `eq(auditLog.actorOrgId, orgId)` predicate below is the ONE AND ONLY control
 * that keeps one tenant out of another tenant's ledger. Five things protect it:
 *
 *  1. `orgId` is a required positional parameter with no default and no overload;
 *     this module exports exactly one read and there is no unscoped variant.
 *  2. The function fails closed on a blank org id rather than degrading into an
 *     unfiltered read.
 *  3. The predicate is the conditions array's FIRST ELEMENT, created with the
 *     array, so no code path can build a `where` without it and a diff that
 *     removes it is a one-line, obvious deletion.
 *  4. THIS MODULE MUST NEVER IMPORT THE ADMIN CONNECTION FACTORY. A unit
 *     assertion in history-route.test.ts reads this file's own source and fails
 *     if that symbol's name appears anywhere in it, comments included.
 *  5. The route passes `c.get('orgId')` from the verified Hub token and its query
 *     schema declares no org key, so a smuggled `?orgId=` is never read.
 */

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type OrgAuditHistoryEntry = {
  /** audit_log.id as a decimal string. NEVER a BigInt: c.json() cannot serialize one. */
  id: string;
  /** ISO 8601 UTC. */
  ts: string;
  /** Free text from the ledger. NOT AuditAction - the column predates the enum. */
  action: string;
  entityType: string;
  entityId: string;
  /**
   * The entity's name as snapshotted into the ledger at write time
   * (`after_jsonb ->> 'label'`). Null for every writer that does not set it.
   * NEVER the blob.
   */
  entityLabel: string | null;
  /** Hub account id. DATA, never a label. */
  actorUserId: string;
  /** Resolved display name, or null when no reliable mapping exists. */
  actorDisplayName: string | null;
};

export type ListOrgAuditHistoryOptions = {
  limit?: number;
  /** Exclusive upper bound on audit_log.id, as a decimal string. */
  cursor?: string;
  entityType?: string;
  /** A SET, applied with inArray. Plural because the panel filters on 2+ actions. */
  actions?: string[];
  /** The caller's own identity, resolved at the route boundary from the verified token. */
  selfActor?: { userId: string; displayName: string | null };
};

export type OrgAuditHistoryPage = {
  entries: OrgAuditHistoryEntry[];
  nextCursor: string | null;
};

export const HISTORY_DEFAULT_LIMIT = 50;
export const HISTORY_MAX_LIMIT = 200;

/** A selected row, before the actor name is resolved onto it. */
type HistoryRow = {
  id: bigint;
  ts: Date;
  action: string;
  entityType: string;
  entityId: string;
  actorUserId: string;
  entityLabel: string | null;
  actorLabelSnapshot: string | null;
};

function nonEmpty(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

export async function listOrgAuditHistory(
  db: Db,
  orgId: string,
  opts: ListOrgAuditHistoryOptions = {},
): Promise<OrgAuditHistoryPage> {
  // Fail CLOSED. A blank org must never degrade into an unfiltered read of a
  // table that has no RLS backstop.
  if (typeof orgId !== 'string' || orgId.trim() === '') {
    throw new Error('org_id_required');
  }

  const limit = Math.min(
    HISTORY_MAX_LIMIT,
    Math.max(1, Math.trunc(opts.limit ?? HISTORY_DEFAULT_LIMIT)),
  );

  return db.transaction(async (tx) => {
    // The tenant context is here for the `finders` lookup below, which IS under
    // FORCE ROW LEVEL SECURITY: without it `current_setting('app.current_org_id')`
    // is unset, the policy matches nothing, and the name resolution would
    // silently return zero names. For `audit_log` the transaction buys NOTHING -
    // that table has no policy, so the WHERE clause is load-bearing on its own.
    await setTenantContext(tx, orgId);

    const conditions: SQL[] = [eq(auditLog.actorOrgId, orgId)];
    if (opts.cursor) conditions.push(lt(auditLog.id, BigInt(opts.cursor)));
    if (opts.entityType) conditions.push(eq(auditLog.entityType, opts.entityType));
    // `?.length` guard: an EMPTY set means "no action filter" and must never
    // degrade into `inArray(..., [])`, which drivers render inconsistently.
    if (opts.actions?.length) conditions.push(inArray(auditLog.action, opts.actions));

    const rows: HistoryRow[] = await tx
      .select({
        id: auditLog.id,
        ts: auditLog.ts,
        action: auditLog.action,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        actorUserId: auditLog.actorUserId,
        // Named scalar extractions, NEVER the blob: the jsonb snapshots are
        // unbounded and can carry PII, and this screen reads neither of them.
        entityLabel: sql<string | null>`${auditLog.afterJsonb} ->> 'label'`,
        actorLabelSnapshot: sql<string | null>`${auditLog.afterJsonb} ->> 'actorLabel'`,
      })
      .from(auditLog)
      .where(and(...conditions))
      .orderBy(desc(auditLog.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore && page.length > 0 ? String(page[page.length - 1]!.id) : null;

    const names = await resolveActorNames(tx, orgId, page, opts.selfActor);

    return {
      entries: page.map((row) => ({
        id: String(row.id),
        ts: row.ts.toISOString(),
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        entityLabel: row.entityLabel,
        actorUserId: row.actorUserId,
        actorDisplayName: names.get(row.id) ?? null,
      })),
      nextCursor,
    };
  });
}

/**
 * Resolves a display name per ROW, keyed by the ledger's own `audit_log.id`
 * (NEVER by entity id: one cadastro is archived and restored repeatedly, so an
 * entity id names many rows with potentially different actors), through three ordered
 * steps and `null` otherwise. It never falls back to the account id: a raw Hub
 * account id is data, never a label.
 *
 *  0. The write-time snapshot (`after_jsonb ->> 'actorLabel'`). The only step
 *     that is exact for a THIRD PARTY - there is no Hub account directory and no
 *     join from an account id to a pessoa, so the write is the one moment the
 *     name is knowable.
 *  1. Self, from the verified token. Covers rows written before the snapshot
 *     existed.
 *  2. `finders`, ORG-SCOPED. `finders.account_id` is globally UNIQUE, so the
 *     explicit `eq(finders.orgId, orgId)` is what stops another org's finder
 *     from naming this org's actor.
 *
 * Rejected: `sellers.account_id` (global, no org_id, resolves from outside the
 * tenancy boundary) and matching `sales_ops_people` by name or e-mail (no
 * account id column, so any match is a guess - and in an audit trail naming the
 * wrong person is strictly worse than naming nobody).
 */
async function resolveActorNames(
  tx: Tx,
  orgId: string,
  rows: HistoryRow[],
  selfActor: ListOrgAuditHistoryOptions['selfActor'],
): Promise<Map<bigint, string>> {
  const byRowId = new Map<bigint, string>();
  const unresolved: HistoryRow[] = [];

  for (const row of rows) {
    const snapshot = nonEmpty(row.actorLabelSnapshot);
    if (snapshot) {
      byRowId.set(row.id, snapshot);
      continue;
    }
    const self =
      selfActor && row.actorUserId === selfActor.userId ? nonEmpty(selfActor.displayName) : null;
    if (self) {
      byRowId.set(row.id, self);
      continue;
    }
    unresolved.push(row);
  }

  const actorIds = [...new Set(unresolved.map((row) => row.actorUserId))];
  if (actorIds.length === 0) return byRowId;

  const finderRows = await tx
    .select({ accountId: finders.accountId, displayName: finders.displayName })
    .from(finders)
    .where(and(eq(finders.orgId, orgId), inArray(finders.accountId, actorIds)));

  const finderNames = new Map<string, string>();
  for (const finder of finderRows) {
    const name = nonEmpty(finder.displayName);
    if (finder.accountId && name) finderNames.set(finder.accountId, name);
  }

  for (const row of unresolved) {
    const name = finderNames.get(row.actorUserId);
    if (name) byRowId.set(row.id, name);
  }

  return byRowId;
}
