import type { MiddlewareHandler } from 'hono';

/**
 * Admin authorization guard (D-B). ONE admin mechanism for the whole codebase.
 *
 * Reads `userRole` off the Hono context — which `clerkAuthMiddleware` (auth.ts)
 * already extracted from the verified JWT `publicMetadata.role` claim. There is
 * NO per-request `clerkClient.users.getUser()` call (D-B).
 *
 * MUST run AFTER `clerkAuthMiddleware` so `userRole` is populated. Returns 403
 * for any non-admin role (including `undefined`, which happens when the Clerk
 * session-token custom claim is missing — see docs/nexo/decisions/phase01-clerk-config.md).
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
