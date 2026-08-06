import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { getDb } from '../../db/client.js';
import {
  salesOpsAreas,
  salesOpsFuncoes,
  salesOpsPeople,
  salesOpsProducts,
} from '../../db/schema.js';
import { writeAuditEntry, type CadastroEntityType } from '../audit/service.js';

/**
 * The nightly purge of archived cadastros.
 *
 * This module HARD DELETES tenant data on a schedule, so it lives on its own -
 * the same reason `audit/history-service.ts` is not inside `audit/service.ts` -
 * and it is deliberately the smallest thing that can do the job.
 *
 * THE ONE IDEA: the DATABASE is the arbiter of whether a delete is allowed.
 *
 * There is no "is anything referencing this?" query here and there must never be
 * one. Every child reference that matters is already a NO ACTION or RESTRICT
 * foreign key (verified live against the schema; the table is in
 * nexo/plans/20260806-archive-hiding-and-purge/00-OVERVIEW.md), so the job simply
 * attempts the DELETE and reads Postgres's answer: `23503` means "still
 * referenced" and the item is counted as SKIPPED and left exactly as it was.
 * A hand-written reference check would be a second copy of the FK topology that
 * drifts the first time a table gains a column, and drifting in the permissive
 * direction here means deleting a produto that a historical proposta still names.
 *
 * The two ON DELETE CASCADE edges that do fire - a produto's default função costs,
 * a pessoa's função assignments - are the item's OWN configuration, not shared
 * history, so losing them with the item is correct. No new cascade may be added.
 *
 * Cross-tenant by nature: it runs on getAdminDb() with no JWT, exactly like the
 * hold promotion. Org scoping is therefore NOT provided by RLS (the admin context
 * policy admits every row); it is the explicit `org_id` predicate on each DELETE,
 * and each ledger entry carries the purged row's own `actor_org_id`.
 */

type Db = ReturnType<typeof getDb>;

/**
 * How long an archived cadastro is kept before it becomes purgeable.
 *
 * A constant and not a setting: the product decision was one fixed window with no
 * UI to change it, and a per-org override on a destructive job is a footgun that
 * has to be justified by a real request, not anticipated.
 */
export const ARCHIVED_CADASTRO_RETENTION_DAYS = 30;

const FOREIGN_KEY_VIOLATION = '23503';

/** The purge outcome for ONE candidate row. */
type PurgeOutcome = 'purged' | 'skipped' | 'failed';

export type CadastroPurgeCounts = { purged: number; skipped: number; failed: number };
export type CadastroPurgeReport = Record<CadastroEntityType, CadastroPurgeCounts>;

/** The columns the job needs from any of the four tables. `label` feeds the ledger. */
type PurgeCandidate = { id: string; orgId: string; label: string; status: string };

type PurgeSpec = {
  entityType: CadastroEntityType;
  /**
   * The rows that qualify for deletion right now. `only` narrows to a single row
   * AND takes FOR UPDATE: that is how the per-item transaction re-checks, under a
   * lock, that an operator did not restore the row between the scan and the
   * delete. Nothing else re-states the eligibility rule, so the scan and the
   * re-check cannot disagree.
   */
  due: (handle: Db, only?: { orgId: string; id: string }) => Promise<PurgeCandidate[]>;
  /** Deletes exactly one row, scoped by (org_id, id). Returns the rows removed. */
  remove: (tx: Db, target: { orgId: string; id: string }) => Promise<number>;
};

/** `archived_at` older than the window, measured by the DATABASE clock. */
function pastRetention(column: PgColumn): SQL {
  return sql`${column} < now() - make_interval(days => ${ARCHIVED_CADASTRO_RETENTION_DAYS})`;
}

/**
 * The four specs, in the order they run.
 *
 * Produtos and pessoas go FIRST because their own cascades free the rows below
 * them: deleting a produto removes its `sales_ops_product_funcao_costs`, deleting
 * a pessoa removes its `sales_ops_person_funcoes`, and both of those are RESTRICT
 * references onto a função. Áreas go LAST because `sales_ops_products.area_id`
 * blocks them. One run therefore collects a produto and the área under it, instead
 * of needing a second night per level.
 */
const PURGE_SPECS: PurgeSpec[] = [
  {
    entityType: 'produto',
    due: (handle, only) => {
      const query = handle
        .select({
          id: salesOpsProducts.id,
          orgId: salesOpsProducts.orgId,
          label: salesOpsProducts.name,
          status: salesOpsProducts.status,
        })
        .from(salesOpsProducts)
        .where(
          and(
            eq(salesOpsProducts.status, 'archived'),
            pastRetention(salesOpsProducts.archivedAt),
            ...(only
              ? [eq(salesOpsProducts.orgId, only.orgId), eq(salesOpsProducts.id, only.id)]
              : []),
          ),
        );
      return only ? query.for('update') : query;
    },
    remove: async (tx, target) =>
      (
        await tx
          .delete(salesOpsProducts)
          .where(and(eq(salesOpsProducts.orgId, target.orgId), eq(salesOpsProducts.id, target.id)))
          .returning({ id: salesOpsProducts.id })
      ).length,
  },
  {
    entityType: 'pessoa',
    due: (handle, only) => {
      const query = handle
        .select({
          id: salesOpsPeople.id,
          orgId: salesOpsPeople.orgId,
          label: salesOpsPeople.displayName,
          status: salesOpsPeople.status,
        })
        .from(salesOpsPeople)
        // A pessoa spells archived 'inactive'. The literal is here and nowhere
        // else in this file, so the two spellings can never be swapped.
        .where(
          and(
            eq(salesOpsPeople.status, 'inactive'),
            pastRetention(salesOpsPeople.archivedAt),
            ...(only ? [eq(salesOpsPeople.orgId, only.orgId), eq(salesOpsPeople.id, only.id)] : []),
          ),
        );
      return only ? query.for('update') : query;
    },
    remove: async (tx, target) =>
      (
        await tx
          .delete(salesOpsPeople)
          .where(and(eq(salesOpsPeople.orgId, target.orgId), eq(salesOpsPeople.id, target.id)))
          .returning({ id: salesOpsPeople.id })
      ).length,
  },
  {
    entityType: 'funcao',
    due: (handle, only) => {
      const query = handle
        .select({
          id: salesOpsFuncoes.id,
          orgId: salesOpsFuncoes.orgId,
          label: salesOpsFuncoes.name,
          status: salesOpsFuncoes.status,
        })
        .from(salesOpsFuncoes)
        .where(
          and(
            eq(salesOpsFuncoes.status, 'archived'),
            // `vendedor` and `finder` are never purgeable. The API already refuses
            // to archive them, so this predicate is unreachable through the app -
            // which is exactly why it is here: the one way an app role could ever
            // reach this job is a raw write nobody reviewed.
            eq(salesOpsFuncoes.isSystem, false),
            pastRetention(salesOpsFuncoes.archivedAt),
            ...(only
              ? [eq(salesOpsFuncoes.orgId, only.orgId), eq(salesOpsFuncoes.id, only.id)]
              : []),
          ),
        );
      return only ? query.for('update') : query;
    },
    remove: async (tx, target) =>
      (
        await tx
          .delete(salesOpsFuncoes)
          .where(and(eq(salesOpsFuncoes.orgId, target.orgId), eq(salesOpsFuncoes.id, target.id)))
          .returning({ id: salesOpsFuncoes.id })
      ).length,
  },
  {
    entityType: 'area',
    due: (handle, only) => {
      const query = handle
        .select({
          id: salesOpsAreas.id,
          orgId: salesOpsAreas.orgId,
          label: salesOpsAreas.name,
          status: salesOpsAreas.status,
        })
        .from(salesOpsAreas)
        .where(
          and(
            eq(salesOpsAreas.status, 'archived'),
            pastRetention(salesOpsAreas.archivedAt),
            ...(only ? [eq(salesOpsAreas.orgId, only.orgId), eq(salesOpsAreas.id, only.id)] : []),
          ),
        );
      return only ? query.for('update') : query;
    },
    remove: async (tx, target) =>
      (
        await tx
          .delete(salesOpsAreas)
          .where(and(eq(salesOpsAreas.orgId, target.orgId), eq(salesOpsAreas.id, target.id)))
          .returning({ id: salesOpsAreas.id })
      ).length,
  },
];

/**
 * True when `error`, or anything on its `cause` chain, is a Postgres error with
 * this SQLSTATE. Drizzle wraps the driver's error in a DrizzleQueryError, so the
 * `code` is never on the object that is actually thrown.
 */
function hasPostgresCode(error: unknown, code: string): boolean {
  let current: unknown = error;
  for (let depth = 0; current !== null && current !== undefined && depth < 5; depth += 1) {
    if (typeof current === 'object' && (current as { code?: unknown }).code === code) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function emptyCounts(): CadastroPurgeCounts {
  return { purged: 0, skipped: 0, failed: 0 };
}

/** Purges ONE candidate in ITS OWN transaction, so one item can never affect another. */
async function purgeCandidate(
  db: Db,
  spec: PurgeSpec,
  candidate: PurgeCandidate,
): Promise<PurgeOutcome> {
  const target = { orgId: candidate.orgId, id: candidate.id };
  try {
    return await db.transaction(async (handle) => {
      // Same cast, same reason, as `withTenant` in ./service.ts: a Drizzle
      // transaction handle is structurally a database minus `$client`, and every
      // query builder used below is identical on both.
      const tx = handle as unknown as Db;
      // Re-read under FOR UPDATE. The scan is a separate snapshot, and an operator
      // restoring the row in between must win. Locking the cadastro row BEFORE the
      // ledger's global tail lock is also the lock order every cadastro write uses;
      // taking them in the other order is what would let two writers deadlock.
      const [locked] = await spec.due(tx, target);
      if (!locked) return 'skipped';

      // The audit entry is written FIRST, in THIS transaction, on THIS handle.
      // First, because the delete is what can fail: an entry written afterwards
      // would never be reached on the skip path, and this ordering makes the
      // rollback the proof that the two are atomic. On THIS handle, because
      // writeAuditEntry accepts any structurally-compatible object - handing it the
      // pooled `db` compiles cleanly and silently commits a ledger entry claiming a
      // deletion that the foreign key then refused.
      await writeAuditEntry(tx, {
        // A SYSTEM action: nobody triggered it. The reserved 'system' sentinel is
        // the same one the conversion ingest writes, and it can never collide with
        // a Hub account id.
        actorUserId: 'system',
        // NEVER null: the org-scoped history read filters on actor_org_id, so a
        // null would make the entry invisible to the only tenant entitled to it.
        actorOrgId: locked.orgId,
        action: 'cadastro.purged',
        entityType: spec.entityType,
        entityId: locked.id,
        beforeJsonb: { status: locked.status },
        // `label` is load-bearing here in a way it is not for an archive: after the
        // DELETE there is no row left to name, so this snapshot is the only thing
        // the history can render. `actorLabel` is the pt-BR system actor, which the
        // history projects with `after_jsonb ->> 'actorLabel'` like any other.
        afterJsonb: { status: 'purged', label: locked.label, actorLabel: 'Sistema' },
      });

      const removed = await spec.remove(tx, target);
      // Unreachable: the row is locked and still matched a moment ago. If it ever
      // fires, the ledger entry must not survive a delete that did not happen.
      if (removed !== 1) {
        throw new Error(`cadastro_purge_delete_missed:${spec.entityType}:${locked.id}`);
      }
      return 'purged';
    });
  } catch (error) {
    // The database's answer to "may I delete this?". The transaction - INCLUDING
    // the ledger entry above - is already rolled back by the time we get here.
    if (hasPostgresCode(error, FOREIGN_KEY_VIOLATION)) return 'skipped';
    // Anything else is a real fault. It is counted, logged with its item, and NEVER
    // swallowed into the skip bucket, where it would read as "still referenced".
    console.error(
      `[cadastro-purge] ${spec.entityType} ${candidate.id} (org ${candidate.orgId}) failed:`,
      error,
    );
    return 'failed';
  }
}

/**
 * Deletes every archived cadastro that is past the retention window and that
 * nothing references, across every org on the given connection.
 *
 * Returns per-entity counts. `skipped` is the expected steady state, not an error:
 * anything a proposta ever used stays archived forever.
 */
export async function purgeArchivedCadastros(db: Db): Promise<CadastroPurgeReport> {
  const report: CadastroPurgeReport = {
    produto: emptyCounts(),
    pessoa: emptyCounts(),
    funcao: emptyCounts(),
    area: emptyCounts(),
  };
  for (const spec of PURGE_SPECS) {
    const candidates = await spec.due(db);
    for (const candidate of candidates) {
      const outcome = await purgeCandidate(db, spec, candidate);
      report[spec.entityType][outcome] += 1;
    }
  }
  return report;
}

/** One-line summary for the nightly log. */
export function formatCadastroPurgeReport(report: CadastroPurgeReport): string {
  return (Object.keys(report) as CadastroEntityType[])
    .map((entityType) => {
      const counts = report[entityType];
      return `${entityType} ${counts.purged}/${counts.skipped}/${counts.failed}`;
    })
    .join(', ');
}
