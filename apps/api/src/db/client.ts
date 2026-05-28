import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../env.js';
import * as schema from './schema.js';

/**
 * Postgres clients. Lazy-initialized so the server can boot in environments
 * without DATABASE_URL (e.g., template before configuration).
 *
 * Access pattern (D-H): use getDb() / getAdminDb(). There is intentionally NO
 * `db` singleton and NO `db/index.ts` barrel.
 *   - getDb()      → runtime connection (role fxl_finders_app, RLS ENFORCED).
 *                    Tenant-scoped service fns wrap work in a transaction and
 *                    call setTenantContext(tx, orgId) before any query (D-D).
 *   - getAdminDb() → admin/cross-tenant connection (role fxl_finders_admin,
 *                    BYPASSRLS). Used ONLY by admin domain routes that span orgs.
 *                    NEVER call setTenantContext on this connection (D-C).
 */

let _client: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL not configured. Set it in apps/api/.env');
  }
  if (!_db) {
    _client = postgres(env.DATABASE_URL, { max: 10 });
    _db = drizzle(_client, { schema });
  }
  return _db;
}

let _adminClient: ReturnType<typeof postgres> | null = null;
let _adminDb: ReturnType<typeof drizzle<typeof schema>> | null = null;

/**
 * Admin / cross-tenant DB connection (D-C). Authenticates as the BYPASSRLS role
 * (fxl_finders_admin). Used ONLY by admin domain routes that legitimately span
 * orgs (Phase 03 finders approve/suspend; Phase 05 commissions/conversions admin
 * reads + state transitions; Phase 06 payouts). NEVER call setTenantContext on
 * this connection. Every admin money mutation must still write audit_log.
 */
export function getAdminDb() {
  if (!env.ADMIN_DATABASE_URL) {
    throw new Error('ADMIN_DATABASE_URL not configured. Set it in apps/api/.env');
  }
  if (!_adminDb) {
    _adminClient = postgres(env.ADMIN_DATABASE_URL, { max: 5 });
    _adminDb = drizzle(_adminClient, { schema });
  }
  return _adminDb;
}

export async function closeDb() {
  if (_client) {
    await _client.end();
    _client = null;
    _db = null;
  }
  if (_adminClient) {
    await _adminClient.end();
    _adminClient = null;
    _adminDb = null;
  }
}
