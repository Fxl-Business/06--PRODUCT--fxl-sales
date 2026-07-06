import { Hono } from 'hono';
import { getAdminDb, getDb } from '../../db/client.js';
import { setTenantContext } from '../../middleware/auth.js';
import { resolveFinderId } from '../links/service.js';
import { commissions } from '../../db/schema.js';
import { desc, eq } from 'drizzle-orm';
import {
  getCommissionsAdmin,
  lockCommission,
  promoteHoldExpired,
  reverseCommission,
  type CommissionStatus,
} from './service.js';

/**
 * Commissions domain routes (Phase 05 T08).
 *
 * Finder routes: appAuthMiddleware (mounted in server.ts) -> getDb() + tx-scoped
 * setTenantContext (D-D). Admin routes: appAuthMiddleware + requireAdmin (mounted
 * in server.ts) -> getAdminDb() (BYPASSRLS, D-C); every mutation writes audit_log in
 * the service's tx. There is NO /approve endpoint - D-K replaces it with /lock
 * (pending -> locked fast-track). The `approved` state is never produced in v1.0.
 */
export const commissionsRouter = new Hono();
export const commissionsAdminRouter = new Hono();

function mapError(message: string): { status: 404 | 409; body: { error: string } } | null {
  switch (message) {
    case 'invalid_transition':
      return { status: 409, body: { error: 'invalid_transition' } };
    case 'commission_not_found':
      return { status: 404, body: { error: 'commission_not_found' } };
    default:
      return null;
  }
}

// ── Finder route (getDb() + setTenantContext, D-D) ───────────────────────────
commissionsRouter.get('/', async (c) => {
  const orgId = c.get('orgId');
  const authSubject = c.get('userId');
  try {
    const rows = await getDb().transaction(async (tx) => {
      await setTenantContext(tx as never, orgId);
      const finderId = await resolveFinderId(tx, authSubject, orgId);
      return tx
        .select()
        .from(commissions)
        .where(eq(commissions.finderId, finderId))
        .orderBy(desc(commissions.createdAt));
    });
    return c.json({ commissions: rows });
  } catch (err) {
    if (err instanceof Error && err.message === 'finder_not_found') {
      return c.json({ error: 'finder_not_found' }, 403);
    }
    throw err;
  }
});

// ── Admin routes (getAdminDb() BYPASSRLS, D-C; requireAdmin gate in server.ts) ─
commissionsAdminRouter.get('/', async (c) => {
  const status = c.req.query('status') as CommissionStatus | undefined;
  const finderId = c.req.query('finderId');
  const rows = await getCommissionsAdmin(getAdminDb(), { status, finderId });
  return c.json({ commissions: rows });
});

// Manual nightly-job trigger (D-K) - promotes pending -> locked WHERE hold_until < now().
// Registered before /:commissionId/lock; 'promote-locked' is a single segment so it
// never collides with the two-segment :commissionId/lock route.
commissionsAdminRouter.post('/promote-locked', async (c) => {
  const promoted = await promoteHoldExpired(getAdminDb());
  return c.json({ status: 'ok', promoted });
});

// Manual "approve / lock-now" fast-track (D-K: pending→locked). NOT /approve.
commissionsAdminRouter.post('/:commissionId/lock', async (c) => {
  try {
    const commission = await lockCommission(
      getAdminDb(),
      c.req.param('commissionId'),
      c.get('userId'),
    );
    return c.json({ commission });
  } catch (err) {
    const mapped = mapError(err instanceof Error ? err.message : '');
    if (mapped) return c.json(mapped.body, mapped.status);
    throw err;
  }
});

commissionsAdminRouter.post('/:commissionId/reverse', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { reason?: unknown };
  if (typeof body.reason !== 'string' || body.reason.length === 0) {
    return c.json({ error: 'validation_error', issues: { reason: 'required' } }, 400);
  }
  try {
    await reverseCommission(getAdminDb(), c.req.param('commissionId'), body.reason, c.get('userId'));
    return c.json({ reversed: true });
  } catch (err) {
    const mapped = mapError(err instanceof Error ? err.message : '');
    if (mapped) return c.json(mapped.body, mapped.status);
    throw err;
  }
});
