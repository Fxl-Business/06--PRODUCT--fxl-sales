import { createHash } from 'node:crypto';
import { desc } from 'drizzle-orm';
import { z } from 'zod';
import { auditLog } from '../../db/schema.js';

/**
 * Audit hash-chain writer (Phase 05 T04).
 *
 * audit_log is append-only (INSERT + SELECT only; no UPDATE/DELETE grant). Every
 * row carries prev_hash + entry_hash where:
 *   entry_hash = sha256(prev_hash || canonical_json(row_without_hashes))   (D8)
 *   canonical_json = JSON.stringify(obj, Object.keys(obj).sort())          (D7)
 * The genesis row's prev_hash is '0'*64. writeAuditEntry fetches the tail row with
 * FOR UPDATE inside the caller's transaction so concurrent inserts serialize.
 *
 * Pre-Phase-05 audit_log rows (written by Phases 02/03) carry '' placeholders and
 * are intentionally OUTSIDE this chain - new rows chain from a fresh genesis at the
 * first Phase-05 write (the verify endpoint validates the chain of hash-bearing rows).
 */

export type AuditLogRow = typeof auditLog.$inferSelect;

/** A row shape sufficient for chain verification (camelCase, from Drizzle select). */
export type AuditChainRow = {
  prevHash: string;
  entryHash: string;
  [key: string]: unknown;
};

export const AuditActionSchema = z.enum([
  'conversion.recorded',
  'commission.created',
  'commission.approve',
  'commission.reverse',
  'payout.mark_paid',
  'cadastro.archived',
  'cadastro.restored',
  'cadastro.purged',
]);
export type AuditAction = z.infer<typeof AuditActionSchema>;

/**
 * The four sales-ops cadastros whose archive/restore/purge lifecycle is audited.
 *
 * These four strings, together with the action names in
 * CADASTRO_LIFECYCLE_ACTIONS, are a WIRE CONTRACT and not an internal detail: the
 * org-scoped history read returns `entityType` and `action` verbatim as free
 * text, and the web panel matches on exactly these eight literals. Nothing
 * type-checks the pair across the API/web boundary, so renaming any of them
 * silently turns every history row read-only in the UI.
 *
 * The values are pt-BR without diacritics because that is what the routes, the
 * error sentinels (`funcao_is_system`, `area_name_taken`) and the UI already call
 * these four things, and because the value lands in a URL query string.
 */
export const CadastroEntityTypeSchema = z.enum(['produto', 'pessoa', 'funcao', 'area']);
export type CadastroEntityType = z.infer<typeof CadastroEntityTypeSchema>;

/**
 * The lifecycle actions the cadastro history reads back.
 *
 * `cadastro.purged` is the nightly purge's terminal event. It is a SYSTEM action:
 * `actor_user_id` is the reserved `'system'` sentinel (the same one the conversion
 * ingest already writes), `actor_org_id` is the purged row's OWN org - never null,
 * or the org-scoped history read would filter its own entry away - and the label
 * snapshot in `after_jsonb` is the only thing left that can name the deleted row.
 *
 * The web panel's own copy of this list (`CADASTRO_HISTORY_ACTIONS` in
 * apps/web/src/sales-ops/cadastro-history.ts) is what actually filters the
 * request, and nothing type-checks the pair, so an action added here stays
 * invisible in the UI until it is added there too.
 */
export const CADASTRO_LIFECYCLE_ACTIONS = [
  'cadastro.archived',
  'cadastro.restored',
  'cadastro.purged',
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers (unit-tested in __tests__/service.test.ts)
// ─────────────────────────────────────────────────────────────────────────────

/** Deterministic JSON: keys sorted alphabetically, no whitespace (D7). */
export function canonicalJson(obj: Record<string, unknown>): string {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

/** entry_hash = sha256(prevHash || canonical_json(rowWithoutHashes)) (D8). */
export function computeEntryHash(
  prevHash: string,
  rowWithoutHashes: Record<string, unknown>,
): string {
  return createHash('sha256')
    .update(prevHash + canonicalJson(rowWithoutHashes))
    .digest('hex');
}

/**
 * Verifies a chain of audit rows (id ASC). For each entry recomputes entry_hash
 * over the row minus {prevHash, entryHash}, and asserts entry[i].prevHash ===
 * entry[i-1].entryHash for i > 0. Returns the first broken index, or null.
 */
export function verifyChain(entries: AuditChainRow[]): {
  valid: boolean;
  brokenAt: number | null;
} {
  let prevHash = '0'.repeat(64);
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    if (entry.prevHash !== prevHash) {
      return { valid: false, brokenAt: i };
    }
    const rowWithoutHashes: Record<string, unknown> = {};
    for (const key of Object.keys(entry)) {
      if (key !== 'entryHash' && key !== 'prevHash') rowWithoutHashes[key] = entry[key];
    }
    const recomputed = computeEntryHash(prevHash, rowWithoutHashes);
    if (recomputed !== entry.entryHash) {
      return { valid: false, brokenAt: i };
    }
    prevHash = entry.entryHash;
  }
  return { valid: true, brokenAt: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// DB writer - append-only, hash-chained
// ─────────────────────────────────────────────────────────────────────────────

export type WriteAuditEntryInput = {
  actorUserId: string;
  actorOrgId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  beforeJsonb?: unknown;
  afterJsonb?: unknown;
  requestId?: string | null;
};

/**
 * Appends a hash-chained audit_log row. MUST be called inside the caller's
 * transaction (pass the tx handle) so the FOR UPDATE tail lock + the INSERT are
 * atomic with the money mutation that triggered the entry (D-C). Does NOT call
 * setTenantContext (audit_log is cross-tenant append-only).
 *
 * The chain input row is built from the audit fields ONLY (excludes id/ts so the
 * hash is reproducible without DB-generated columns), plus prev_hash.
 */
export async function writeAuditEntry(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts getDb()/getAdminDb() and tx handles structurally
  db: any,
  entry: WriteAuditEntryInput,
): Promise<AuditLogRow> {
  // Fetch the tail row's entry_hash with FOR UPDATE to serialize concurrent writers.
  const tail = (await db
    .select({ entryHash: auditLog.entryHash })
    .from(auditLog)
    .orderBy(desc(auditLog.id))
    .limit(1)
    .for('update')) as Array<{ entryHash: string }>;

  // Genesis: '0'*64. Pre-Phase-05 rows have entry_hash='' - treat '' as "no chain
  // yet" so the first hash-bearing row starts a fresh genesis chain.
  const prevHash = tail[0]?.entryHash && tail[0].entryHash.length === 64 ? tail[0].entryHash : '0'.repeat(64);

  // D8: entry_hash = sha256(prev_hash || canonical_json(row_without_hashes)). prev_hash
  // is the PREPENDED argument - it is NOT a field inside the canonical row.
  const rowForHash = {
    actorUserId: entry.actorUserId,
    actorOrgId: entry.actorOrgId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    beforeJsonb: entry.beforeJsonb ?? null,
    afterJsonb: entry.afterJsonb ?? null,
    requestId: entry.requestId ?? null,
  };
  const entryHash = computeEntryHash(prevHash, rowForHash as Record<string, unknown>);

  const [inserted] = (await db
    .insert(auditLog)
    .values({
      actorUserId: entry.actorUserId,
      actorOrgId: entry.actorOrgId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      beforeJsonb: entry.beforeJsonb ?? null,
      afterJsonb: entry.afterJsonb ?? null,
      requestId: entry.requestId ?? null,
      prevHash,
      entryHash,
    })
    .returning()) as AuditLogRow[];
  if (!inserted) throw new Error('audit_write_failed');
  return inserted;
}
