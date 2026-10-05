import { Hono } from 'hono';
import { requireCapability } from '../../middleware/require-capability.js';
import { getDb } from '../../db/client.js';
import {
  getFinderClickStats,
  listActiveAppsForFinder,
  listActiveProductsForFinder,
  listFinderClicks,
} from '../links/service.js';
import { mapLinkError } from '../links/routes.js';

/**
 * Finder domain routes (Phase 04, T05). FIRST-CLASS finder-authed read
 * endpoints - NOT admin-route reuse (admin routes are requireAdmin-gated; a
 * finder JWT would 403). appAuthMiddleware is applied at the server.ts mount.
 *
 *   GET /apps                     → active apps for the link-generator dropdown
 *   GET /apps/:appId/products     → active products + price bands for the form
 *   GET /clicks                   → paginated finder clicks (org-isolated via RLS)
 *   GET /clicks/stats             → { total, unique }
 *
 * apps/products/price_bands have NO RLS - read directly on the app role, NEVER
 * setTenantContext. clicks reads ARE tenant-scoped (handled inside the service
 * via setTenantContext + the clicks_select_tenant RLS policy).
 */
export const finderRouter = new Hono();

// Edition capability gate (edicao-leads). Registered before every route so it runs first.
finderRouter.use('*', requireCapability('finders'));

finderRouter.get('/apps', async (c) => {
  const apps = await listActiveAppsForFinder(getDb());
  return c.json({ apps });
});

finderRouter.get('/apps/:appId/products', async (c) => {
  const appId = c.req.param('appId');
  const products = await listActiveProductsForFinder(getDb(), appId);
  return c.json({ products });
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

finderRouter.get('/clicks', async (c) => {
  const linkId = c.req.query('linkId');
  // Guard: a non-UUID linkId would hit the uuid column and raise a Postgres
  // 22P02 → unhandled 500. Reject early with a clean 400.
  if (linkId && !UUID_RE.test(linkId)) {
    return c.json({ error: 'validation_error', issues: { linkId: 'must be a uuid' } }, 400);
  }
  const limitRaw = c.req.query('limit');
  const cursor = c.req.query('cursor');
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
  try {
    const result = await listFinderClicks(getDb(), c.get('orgId'), c.get('userId'), {
      linkId: linkId || undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
      cursor: cursor || undefined,
    });
    return c.json(result);
  } catch (err) {
    const mapped = mapLinkError(err);
    if (mapped) return c.json(mapped.body, mapped.status);
    throw err;
  }
});

finderRouter.get('/clicks/stats', async (c) => {
  try {
    const stats = await getFinderClickStats(getDb(), c.get('orgId'), c.get('userId'));
    return c.json(stats);
  } catch (err) {
    const mapped = mapLinkError(err);
    if (mapped) return c.json(mapped.body, mapped.status);
    throw err;
  }
});
