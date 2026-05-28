import { Hono } from 'hono';
import { z } from 'zod';
import {
  FinderStateError,
  approveFinder,
  getFinder,
  listFinders,
  suspendFinder,
} from './admin-service.js';

/**
 * Admin finders routes (Phase 03 T03). Mounted under the clerkAuthMiddleware +
 * requireAdmin admin group in server.ts — do NOT re-apply auth here.
 *
 * Uses getAdminDb() (BYPASSRLS) via the service layer — finders is FORCE RLS and
 * these are cross-tenant admin reads/writes (D-C). NEVER setTenantContext.
 */
export const findersAdminRouter = new Hono();

const ListQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'suspended']).optional(),
  cursor: z.string().optional(),
});

const SuspendBodySchema = z.object({ reason: z.string().min(1).max(500) });

findersAdminRouter.get('/', async (c) => {
  const parsed = ListQuerySchema.safeParse({
    status: c.req.query('status'),
    cursor: c.req.query('cursor'),
  });
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  const result = await listFinders({ status: parsed.data.status, cursor: parsed.data.cursor });
  return c.json(result);
});

findersAdminRouter.get('/:id', async (c) => {
  const finder = await getFinder(c.req.param('id'));
  if (!finder) return c.json({ error: 'not_found' }, 404);
  return c.json({ finder });
});

findersAdminRouter.post('/:id/approve', async (c) => {
  try {
    const result = await approveFinder(c.req.param('id'), c.get('userId'));
    return c.json(result);
  } catch (err) {
    if (err instanceof FinderStateError) {
      if (err.code === 'not_found') return c.json({ error: 'not_found' }, 404);
      if (err.code === 'invalid_state') return c.json({ error: 'invalid_state' }, 409);
      if (err.code === 'invite_send_failed') {
        return c.json(
          { error: 'invite_send_failed', message: 'Convite não enviado, tente reenviar.' },
          502,
        );
      }
    }
    throw err;
  }
});

findersAdminRouter.post('/:id/suspend', async (c) => {
  const parsed = SuspendBodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  try {
    const result = await suspendFinder(c.req.param('id'), c.get('userId'), parsed.data.reason);
    return c.json(result);
  } catch (err) {
    if (err instanceof FinderStateError) {
      if (err.code === 'not_found') return c.json({ error: 'not_found' }, 404);
      if (err.code === 'invalid_state') return c.json({ error: 'invalid_state' }, 409);
    }
    throw err;
  }
});
