import postgres from 'postgres';
import { testDatabaseUrls } from './test-database-urls.js';

/**
 * Removes every settlement of the given orgs from the LOCAL test database.
 *
 * sales_ops_settlements refuses DELETE with SQLSTATE FXS01 by design, and its
 * RESTRICT foreign keys then block deleting the ledger rows and the sale. The
 * only way through is a superuser session with session_replication_role =
 * replica, which skips ordinary triggers for that transaction. This helper is
 * test-only on purpose: product code must never own such a path. Call it BEFORE
 * deleting any payable, receivable or sale of the same orgs.
 */
export async function deleteSettlementsForOrgs(orgIds: readonly string[]): Promise<number> {
  if (orgIds.length === 0) return 0;
  const client = postgres(testDatabaseUrls().migrateUrl, { max: 1 });
  try {
    return await client.begin(async (tx) => {
      const [me] = await tx<{ rolsuper: boolean }[]>`
        SELECT rolsuper FROM pg_roles WHERE rolname = current_user
      `;
      if (!me?.rolsuper) {
        throw new Error(
          'deleteSettlementsForOrgs needs the local superuser (TEST_MIGRATE_DATABASE_URL)',
        );
      }
      await tx`SET LOCAL session_replication_role = replica`;
      const deleted = await tx`
        DELETE FROM sales_ops_settlements WHERE org_id = ANY(${orgIds as string[]})
      `;
      return deleted.count;
    });
  } finally {
    await client.end();
  }
}
