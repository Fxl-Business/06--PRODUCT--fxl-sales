import type { MiddlewareHandler } from 'hono';

/**
 * Admin authorization guard (D-B). ONE admin mechanism for the whole codebase.
 *
 * Reads `userRole` off the Hono context, which `appAuthMiddleware` already extracted
 * from the verified token. There is
 * NO per-request `clerkClient.users.getUser()` call (D-B).
 *
 * MUST run AFTER `appAuthMiddleware` so `userRole` is populated. Returns 403
 * for any non-admin role, including `undefined`.
 *
 * Phase 01 OWNS this single file. Phase 02 DELETES its adminAuth.ts/isAdmin and
 * consumes `requireAdmin`; Phases 05/06 reference it.
 */
export const requireAdmin: MiddlewareHandler = async (c, next) => {
  if (c.get('userRole') !== 'admin') {
    return c.json({ error: 'forbidden', reason: 'admin_role_required' }, 403);
  }
  return next();
};
