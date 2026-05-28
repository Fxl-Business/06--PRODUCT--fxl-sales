import { Hono } from 'hono';
import { z } from 'zod';
import { createSellerAndInvite, listSellers, setSellerStatus } from './admin-service.js';

/**
 * Admin sellers routes (Phase 03 T04). Mounted under the clerkAuthMiddleware +
 * requireAdmin admin group in server.ts — do NOT re-apply auth here.
 *
 * Uses getAdminDb() via the service layer; setTenantContext is NEVER called.
 */
export const sellersAdminRouter = new Hono();

const CreateSellerSchema = z.object({
  displayName: z.string().min(2).max(100),
  contactEmail: z.string().email(),
});

const StatusSchema = z.object({ status: z.enum(['active', 'inactive']) });

sellersAdminRouter.get('/', async (c) => {
  const sellers = await listSellers();
  return c.json({ sellers });
});

sellersAdminRouter.post('/', async (c) => {
  const parsed = CreateSellerSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  const seller = await createSellerAndInvite(parsed.data, c.get('userId'));
  return c.json({ seller }, 201);
});

sellersAdminRouter.patch('/:id/status', async (c) => {
  const parsed = StatusSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  const seller = await setSellerStatus(c.req.param('id'), parsed.data.status);
  if (!seller) return c.json({ error: 'not_found' }, 404);
  return c.json({ seller });
});
