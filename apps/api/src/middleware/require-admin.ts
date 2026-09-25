import type { Context, MiddlewareHandler } from 'hono';

/** The one 403 body every admin-only decision answers. */
export const ADMIN_ROLE_REQUIRED_BODY = {
  error: 'forbidden',
  reason: 'admin_role_required',
} as const;

/** The one admin predicate. `requireAdmin` and any in-handler check read this. */
export function hasAdminRole(c: Context): boolean {
  return c.get('userRole') === 'admin';
}

/**
 * Admin authorization guard (D-B). ONE admin mechanism for the whole codebase.
 *
 * Reads `userRole` off the Hono context, which `appAuthMiddleware` already extracted
 * from the verified token. There is
 * NO per-request external user lookup (D-B).
 *
 * MUST run AFTER `appAuthMiddleware` so `userRole` is populated. Returns 403
 * for any non-admin role, including `undefined`.
 *
 * Phase 01 OWNS this single file. Phase 02 DELETES its adminAuth.ts/isAdmin and
 * consumes `requireAdmin`; Phases 05/06 reference it.
 *
 * `hasAdminRole` is exported so a route that is open to non-admins but has an
 * admin-only branch (`POST /sales` with `status: 'won'`) answers the same body
 * from the same predicate.
 */
export const requireAdmin: MiddlewareHandler = async (c, next) => {
  if (!hasAdminRole(c)) {
    return c.json(ADMIN_ROLE_REQUIRED_BODY, 403);
  }
  return next();
};
