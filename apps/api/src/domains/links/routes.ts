import { Hono } from 'hono';
import { getDb } from '../../db/client.js';
import { env } from '../../env.js';
import { CreateLinkSchema, RevokeLinkSchema, createLink, listFinderLinks, revokeLink } from './service.js';

/**
 * Links domain routes (Phase 04, T05). Finder-authed. appAuthMiddleware is
 * applied at the mount in server.ts (NOT re-applied here). All service fns take
 * the provider account id and resolve to finders.id internally (resolveFinderId).
 */
export const linksRouter = new Hono();

/**
 * Maps a thrown service Error message to an HTTP status + JSON body. A missing
 * finders row for an authenticated user -> 403 finder_not_found (clean, never a
 * 500/FK crash). Returns null when the error is not a known domain error.
 */
export function mapLinkError(err: unknown): { status: 403 | 404 | 422; body: { error: string } } | null {
  const message = err instanceof Error ? err.message : '';
  switch (message) {
    case 'finder_not_found':
      return { status: 403, body: { error: 'finder_not_found' } };
    case 'app_not_found':
      return { status: 404, body: { error: 'app_not_found' } };
    case 'product_not_found':
      return { status: 404, body: { error: 'product_not_found' } };
    case 'link_not_found':
      return { status: 404, body: { error: 'link_not_found' } };
    case 'app_redirect_hosts_unconfigured':
      return { status: 422, body: { error: 'app_redirect_hosts_unconfigured' } };
    case 'quoted_setup_out_of_band':
      return { status: 422, body: { error: 'quoted_setup_out_of_band' } };
    case 'quoted_monthly_out_of_band':
      return { status: 422, body: { error: 'quoted_monthly_out_of_band' } };
    default:
      return null;
  }
}

function buildFullUrl(code: string): string {
  const base = env.SITE_URL ?? 'http://localhost:4006';
  return base + '/r/' + code;
}

linksRouter.post('/', async (c) => {
  const parsed = CreateLinkSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  try {
    const link = await createLink(getDb(), c.get('userId'), c.get('orgId'), parsed.data);
    return c.json({ link, fullUrl: buildFullUrl(link.code) }, 201);
  } catch (err) {
    const mapped = mapLinkError(err);
    if (mapped) return c.json(mapped.body, mapped.status);
    throw err;
  }
});

linksRouter.get('/', async (c) => {
  try {
    const links = await listFinderLinks(getDb(), c.get('orgId'), c.get('userId'));
    return c.json({ links });
  } catch (err) {
    const mapped = mapLinkError(err);
    if (mapped) return c.json(mapped.body, mapped.status);
    throw err;
  }
});

linksRouter.delete('/:linkId', async (c) => {
  const parsed = RevokeLinkSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  try {
    await revokeLink(
      getDb(),
      c.req.param('linkId'),
      c.get('orgId'),
      c.get('userId'),
      parsed.data.reason,
    );
    return c.body(null, 204);
  } catch (err) {
    const mapped = mapLinkError(err);
    if (mapped) return c.json(mapped.body, mapped.status);
    throw err;
  }
});
