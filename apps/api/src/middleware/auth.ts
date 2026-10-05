import { sql, type SQL } from 'drizzle-orm';
import type { SalesEdition } from '@fxl-sales/shared-utils/sales-edition';

declare module 'hono' {
  interface ContextVariableMap {
    userId: string;
    orgId: string;
    userRole: string | undefined;
    userRoles: Array<'admin' | 'seller' | 'finder'>;
    /**
     * The Sales edition of the ACTIVE organization, resolved once per request by
     * `applyHubAuthContext` from the verified token's add-on modules. Read it
     * through `requireCapability` or `leadFieldSet`, never by re-reading modules.
     */
    salesEdition: SalesEdition;
  }
}

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
 * Admin/cross-tenant routes use getAdminDb() and NEVER call this (D-C).
 */
export async function setTenantContext(
  // Structural type: any Drizzle transaction handle exposes `execute`. Using the
  // concrete PgTransaction<never, …> generic rejected real (non-`never`) tx
  // handles from getDb().transaction() (the execute() return widened to
  // RowList). The structural shape keeps D-D intact while accepting any tx.
  tx: { execute: (query: SQL) => Promise<unknown> },
  orgId: string,
): Promise<void> {
  await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
}
