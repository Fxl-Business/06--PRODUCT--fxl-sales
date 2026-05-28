import { verifyToken } from '@clerk/backend';
import { sql } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { MiddlewareHandler } from 'hono';
import { env } from '../env.js';
import type * as schema from '../db/schema.js';

/**
 * Clerk JWT validation middleware (D-B).
 *
 * Reads Bearer token from Authorization header, verifies via @clerk/backend's
 * `verifyToken`, and exposes userId + orgId + userRole on Hono context:
 *
 *   const userId = c.get('userId');
 *   const orgId = c.get('orgId');
 *   const userRole = c.get('userRole'); // 'admin' | 'seller' | 'finder' | undefined
 *
 * This middleware OWNS role extraction. Role rides in the JWT via a Clerk
 * session-token custom claim ({ "publicMetadata": "{{user.public_metadata}}" });
 * NEVER call `clerkClient.users.getUser()` in a request path (D-B). Phase 02's
 * `requireAdmin` reads `c.get('userRole')`.
 *
 * In template state (CLERK_SECRET_KEY unset), middleware is a passthrough and
 * sets fake dev values. DO NOT ship to production without the key.
 */

declare module 'hono' {
  interface ContextVariableMap {
    userId: string;
    orgId: string;
    userRole: string | undefined; // from JWT publicMetadata.role — admin | seller | finder | undefined
  }
}

export const clerkAuthMiddleware: MiddlewareHandler = async (c, next) => {
  if (!env.CLERK_SECRET_KEY) {
    // Dev/template passthrough — never reaches production (env guard in src/env.ts).
    c.set('userId', 'dev_user');
    c.set('orgId', 'dev_org');
    c.set('userRole', 'admin'); // dev convenience; real role comes from JWT in staging/prod
    return next();
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'unauthorized', reason: 'missing_bearer_token' }, 401);
  }

  const token = authHeader.slice(7);

  try {
    const payload = await verifyToken(token, {
      secretKey: env.CLERK_SECRET_KEY,
    });

    // FXL contract: org_id takes precedence; fall back to sub (personal JWT).
    const orgId = (payload.org_id as string | undefined) ?? payload.sub;
    // D-B: role rides in the JWT via a Clerk session-token custom claim (see T14).
    // Without that dashboard claim, publicMetadata is absent → userRole undefined → admin gate 403s.
    const publicMetadata = payload.publicMetadata as { role?: string } | undefined;
    c.set('userId', payload.sub);
    c.set('orgId', orgId);
    c.set('userRole', publicMetadata?.role);
    return next();
  } catch {
    return c.json({ error: 'unauthorized', reason: 'invalid_token' }, 401);
  }
};

// Backward-compat alias (D-B). Prefer clerkAuthMiddleware in new code.
export const authMiddleware = clerkAuthMiddleware;

/**
 * Sets the per-TRANSACTION tenant context for RLS (D-D).
 *
 * MUST be called as the first statement inside the transaction body, before any
 * tenant-scoped query, because transaction-local set_config (3rd arg true) does
 * NOT survive connection pooling:
 *
 *   await db.transaction(async (tx) => {
 *     await setTenantContext(tx, c.get('orgId'));
 *     // ...queries via tx...
 *   });
 *
 * Admin/cross-tenant routes use getAdminDb() (BYPASSRLS) and NEVER call this (D-C).
 */
export async function setTenantContext(
  tx: Pick<PgTransaction<never, typeof schema, never>, 'execute'>,
  orgId: string,
): Promise<void> {
  await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
}
