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

/**
 * Removes the whole sale ledger of the given orgs, plus their leads and their
 * integration transport rows, from the LOCAL test database.
 *
 * Built for test files that must use a FIXED org shared with the dev seed (the
 * fake integration authority activates only `org_fake_integrado`). The dev seed
 * writes sales and leads for that org into the same local database, so such a
 * file must start from an empty ledger as well as leave one behind: call this in
 * `beforeAll` AND `afterEach`, never only after the tests.
 *
 * Settlements go first through deleteSettlementsForOrgs (the replica-role path).
 * Everything else is deleted in ONE ordinary superuser transaction, children
 * before parents, with foreign keys still enforced: a table that gains a new
 * reference to the sale tree fails here loudly instead of being skipped. Leads
 * are deleted (not detached) because `sales_ops_leads_org_sale_fk` points at the
 * sale and the seeded leads are fixture data of the same org.
 */
export async function purgeOrgLedgerForTests(orgIds: readonly string[]): Promise<void> {
  if (orgIds.length === 0) return;
  await deleteSettlementsForOrgs(orgIds);
  const ids = orgIds as string[];
  const client = postgres(testDatabaseUrls().migrateUrl, { max: 1 });
  try {
    await client.begin(async (tx) => {
      const [me] = await tx<{ rolsuper: boolean }[]>`
        SELECT rolsuper FROM pg_roles WHERE rolname = current_user
      `;
      if (!me?.rolsuper) {
        throw new Error(
          'purgeOrgLedgerForTests needs the local superuser (TEST_MIGRATE_DATABASE_URL)',
        );
      }
      await tx`DELETE FROM sales_ops_lead_products WHERE org_id = ANY(${ids})`;
      await tx`DELETE FROM sales_ops_leads WHERE org_id = ANY(${ids})`;
      await tx`DELETE FROM sales_ops_payables WHERE org_id = ANY(${ids})`;
      await tx`DELETE FROM sales_ops_receivables WHERE org_id = ANY(${ids})`;
      await tx`DELETE FROM sales_ops_sale_professionals WHERE org_id = ANY(${ids})`;
      await tx`DELETE FROM sales_ops_sale_items WHERE org_id = ANY(${ids})`;
      await tx`DELETE FROM sales_ops_sales WHERE org_id = ANY(${ids})`;
      await tx`DELETE FROM integration_outbox WHERE organization_id = ANY(${ids})`;
      await tx`DELETE FROM integration_inbox WHERE organization_id = ANY(${ids})`;
      await tx`DELETE FROM integration_cursor WHERE organization_id = ANY(${ids})`;
    });
  } finally {
    await client.end();
  }
}
