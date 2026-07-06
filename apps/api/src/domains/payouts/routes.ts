import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getAdminDb, getDb } from '../../db/client.js';
import { setTenantContext } from '../../middleware/auth.js';
import { resolveFinderId } from '../links/service.js';
import { payouts } from '../../db/schema.js';
import {
  CreatePayoutSchema,
  MarkPaidSchema,
  createPayoutBatch,
  generateCsv,
  getPayoutsAdmin,
  listFindersWithLockedCommissions,
  markPayoutPaid,
  type PayoutRow,
} from './service.js';

/**
 * Payouts domain routes (Phase 05 T08 + Phase 06 T05, D-Q). Admin routes run on
 * getAdminDb() (BYPASSRLS, D-C) behind requireAdmin (mounted in server.ts). Finder
 * route runs on getDb() + tx-scoped setTenantContext (D-D).
 */
export const payoutsRouter = new Hono();
export const payoutsAdminRouter = new Hono();

const CreateBatchesSchema = z.object({
  finderIds: z.array(z.string().uuid()).min(1),
});

function mapError(message: string): { status: 404 | 422; body: { error: string } } | null {
  switch (message) {
    case 'finder_payout_details_missing':
    case 'commissions_not_locked':
      return { status: 422, body: { error: message } };
    case 'finder_not_found':
    case 'payout_not_found':
      return { status: 404, body: { error: message } };
    default:
      return null;
  }
}

// ── Finder route (getDb() + setTenantContext, D-D) ───────────────────────────
payoutsRouter.get('/', async (c) => {
  const orgId = c.get('orgId');
  const authSubject = c.get('userId');
  try {
    const rows = await getDb().transaction(async (tx) => {
      await setTenantContext(tx as never, orgId);
      const finderId = await resolveFinderId(tx, authSubject, orgId);
      return tx.select().from(payouts).where(eq(payouts.finderId, finderId));
    });
    return c.json({ payouts: rows });
  } catch (err) {
    if (err instanceof Error && err.message === 'finder_not_found') {
      return c.json({ error: 'finder_not_found' }, 403);
    }
    throw err;
  }
});

// ── Admin routes (getAdminDb() BYPASSRLS, D-C; requireAdmin gate in server.ts) ─
payoutsAdminRouter.get('/', async (c) => {
  const finderId = c.req.query('finderId');
  const rows = await getPayoutsAdmin(getAdminDb(), finderId);
  return c.json({ payouts: rows });
});

payoutsAdminRouter.post('/', async (c) => {
  const parsed = CreatePayoutSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  try {
    const payout = await createPayoutBatch(
      getAdminDb(),
      parsed.data.finderId,
      parsed.data.commissionIds,
      c.get('userId'),
    );
    return c.json({ payout }, 201);
  } catch (err) {
    const mapped = mapError(err instanceof Error ? err.message : '');
    if (mapped) return c.json(mapped.body, mapped.status);
    throw err;
  }
});

payoutsAdminRouter.post('/:payoutId/mark-paid', async (c) => {
  const payoutId = c.req.param('payoutId');
  const parsed = MarkPaidSchema.safeParse({
    payoutId,
    ...(await c.req.json().catch(() => ({}))),
  });
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  try {
    const payout = await markPayoutPaid(getAdminDb(), payoutId, c.get('userId'), parsed.data.note);
    return c.json({ payout });
  } catch (err) {
    const mapped = mapError(err instanceof Error ? err.message : '');
    if (mapped) return c.json(mapped.body, mapped.status);
    throw err;
  }
});

// ── Phase 06 T05 additions (D-Q) ─────────────────────────────────────────────

// GET /api/v1/admin/payouts/finders-ready — finders with locked, not-yet-reserved
// commissions. Includes payable=false rows (missing cpf/pix_key) with blockedReason.
payoutsAdminRouter.get('/finders-ready', async (c) => {
  const finders = await listFindersWithLockedCommissions(getAdminDb());
  return c.json({ finders });
});

// POST /api/v1/admin/payouts/batches — creates ONE payouts row per finder (per-finder
// createPayoutBatch reserves that finder's locked commissions). 422 finder_not_payable
// if any selected finder lacks cpf/pix_key (D-Q) — and that finder gets no payout row.
payoutsAdminRouter.post('/batches', async (c) => {
  const parsed = CreateBatchesSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  const adminDb = getAdminDb();
  const actorUserId = c.get('userId');

  // Resolve each finder's eligible locked commissions, then create per-finder payouts.
  const ready = await listFindersWithLockedCommissions(adminDb);
  const summaryByFinder = new Map(ready.map((f) => [f.finderId, f]));
  const created: PayoutRow[] = [];
  for (const finderId of parsed.data.finderIds) {
    const summary = summaryByFinder.get(finderId);
    if (!summary) {
      return c.json({ error: 'no_locked_commissions', finderId }, 422);
    }
    if (!summary.payable) {
      // D-Q: surface a clear error, never a NOT NULL crash. Existing service throws
      // 'finder_payout_details_missing'; expose it as finder_not_payable at the boundary.
      return c.json({ error: 'finder_not_payable', finderId, reason: summary.blockedReason }, 422);
    }
    try {
      const payout = await createPayoutBatch(
        adminDb,
        finderId,
        summary.commissionIds,
        actorUserId,
      );
      created.push(payout);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message === 'finder_payout_details_missing') {
        return c.json({ error: 'finder_not_payable', finderId }, 422);
      }
      const mapped = mapError(message);
      if (mapped) return c.json({ ...mapped.body, finderId }, mapped.status);
      throw err;
    }
  }
  return c.json({ payouts: created }, 201);
});

// GET /api/v1/admin/payouts/batches/:id/csv — :id is a single payout id or a
// comma-separated list. Streams a UTF-8 BOM CSV (D4) as an attachment.
payoutsAdminRouter.get('/batches/:id/csv', async (c) => {
  const idParam = c.req.param('id');
  const idList = idParam.split(',').map((s) => s.trim()).filter(Boolean);
  const parsed = z.array(z.string().uuid()).min(1).safeParse(idList);
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  const buffer = await generateCsv(getAdminDb(), parsed.data);
  const firstId = parsed.data[0];
  // Buffer → fresh Uint8Array (a valid BodyInit; Hono's c.body() type rejects Node Buffer).
  const bytes = new Uint8Array(buffer);
  return c.newResponse(bytes, 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="payout-${firstId}.csv"`,
  });
});
