import cron, { type ScheduledTask } from 'node-cron';
import { deleteExpiredHubBffSessions } from '../auth/hub-session-store.js';
import { getAdminDb } from '../db/client.js';
import { promoteHoldExpired } from '../domains/commissions/service.js';
import {
  formatCadastroPurgeReport,
  purgeArchivedCadastros,
  type CadastroPurgeReport,
} from '../domains/sales-ops/purge-service.js';

/**
 * Nightly hold promotion (Phase 05 T09, D-K/D-C/D1).
 *
 * Promotes commissions pending→locked WHERE hold_until < now() (D-K: no `approved`
 * step). A freshly-ingested commission (status='pending') reaches 'locked' here with
 * NO manual action - this is the auto path. Runs on getAdminDb() with the
 * admin session context because it is cross-tenant with no JWT (D-C).
 *
 * Schedule: 03:00 UTC daily via node-cron (single scheduler instance in apps/api -
 * Phase 06 must register any payout job on THIS scheduler, not a second one).
 * Two more tasks share it: the Hub BFF session sweeper at 03:15 and the archived
 * cadastro purge at 03:30. Each has its own try/catch, so one failing task can
 * never skip the others.
 * Manual trigger: POST /api/v1/admin/commissions/promote-locked (requireAdmin).
 * v1.1 upgrade path: extract to a BullMQ worker for distributed deploys.
 */

let task: ScheduledTask | null = null;
let sessionCleanupTask: ScheduledTask | null = null;
let cadastroPurgeTask: ScheduledTask | null = null;

export function setupNightlyJob(): void {
  if (task) return; // single instance guard
  task = cron.schedule('0 3 * * *', async () => {
    try {
      const promoted = await promoteHoldExpired(getAdminDb());
      console.log(`[nightly-job] hold promotion: ${promoted} commissions promoted pending→locked`);
    } catch (err) {
      // Never crash the process - log and let the next run retry.
      console.error('[nightly-job] hold promotion failed:', err);
    }
  });

  // Durable Hub BFF session sweeper. Its own try/catch so a failure in one task
  // can never skip the other. Expiry is ALSO enforced on read, so a missed run
  // never makes an expired row usable - this only bounds table growth.
  sessionCleanupTask = cron.schedule('15 3 * * *', async () => {
    try {
      const removed = await runHubSessionCleanup();
      console.log(
        `[nightly-job] hub session cleanup: ${removed.sessions} sessions, ${removed.loginTxns} login txns removed`,
      );
    } catch (err) {
      console.error('[nightly-job] hub session cleanup failed:', err);
    }
  });

  // Archived-cadastro purge. Its own try/catch for the same reason as the sweeper
  // above, and it runs LAST of the three: it is the only destructive task here, so
  // if anything about the night is going wrong the other two have already said so
  // in the log above it. Missing a run costs nothing - an item that qualified
  // tonight still qualifies tomorrow.
  cadastroPurgeTask = cron.schedule('30 3 * * *', async () => {
    try {
      const report = await runArchivedCadastroPurge();
      console.log(
        `[nightly-job] archived cadastro purge (purged/skipped/failed): ${formatCadastroPurgeReport(report)}`,
      );
    } catch (err) {
      console.error('[nightly-job] archived cadastro purge failed:', err);
    }
  });
}

/** Extracted for testability + the manual admin trigger endpoint. */
export async function runHoldPromotion(): Promise<{ promoted: number }> {
  const promoted = await promoteHoldExpired(getAdminDb());
  return { promoted };
}

/** Extracted for testability, mirroring runHoldPromotion(). */
export async function runHubSessionCleanup(): Promise<{ sessions: number; loginTxns: number }> {
  return deleteExpiredHubBffSessions(getAdminDb());
}

/**
 * Extracted for testability, mirroring runHoldPromotion().
 *
 * DESTRUCTIVE: this hard deletes rows in every org on getAdminDb(). The oracle in
 * test/rls/cadastro-purge.test.ts drives purgeArchivedCadastros with an EXPLICIT
 * local connection rather than calling this, precisely so a test can never inherit
 * whatever DATABASE_URL happens to be configured (apps/api/.env's points at
 * staging).
 */
export async function runArchivedCadastroPurge(): Promise<CadastroPurgeReport> {
  return purgeArchivedCadastros(getAdminDb());
}

/** Graceful shutdown - stop the scheduled task (plan-brief Wave 4 failure-list). */
export function stopNightlyJob(): void {
  if (task) {
    task.stop();
    task = null;
  }
  if (sessionCleanupTask) {
    sessionCleanupTask.stop();
    sessionCleanupTask = null;
  }
  if (cadastroPurgeTask) {
    cadastroPurgeTask.stop();
    cadastroPurgeTask = null;
  }
}
