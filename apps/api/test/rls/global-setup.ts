import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/**
 * Vitest globalSetup for the integration project (D-G).
 *
 * Applies the journaled Drizzle migrations (CREATE TABLE + role grants + RLS
 * policies — all in one journaled file per D-F) to the test DB BEFORE any RLS
 * test connects. Without this, the RLS tests would run against an unmigrated DB
 * (no tables, no policies, no roles) and false-pass or crash.
 *
 * Uses a migration/owner-capable URL (TEST_MIGRATE_DATABASE_URL → MIGRATE_DATABASE_URL),
 * falling back to a superuser default — because CREATE ROLE / CREATE POLICY need
 * elevated privileges. The RLS tests themselves then deliberately reconnect as
 * the unprivileged fxl_finders_app role (cross-tenant.test.ts).
 */
export async function setup() {
  const migrateUrl =
    process.env.TEST_MIGRATE_DATABASE_URL ??
    process.env.MIGRATE_DATABASE_URL ??
    process.env.TEST_DATABASE_URL ??
    'postgresql://postgres:postgres@localhost:5006/fxl_finders';
  const client = postgres(migrateUrl, { max: 1 });
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: './drizzle' });
  await client.end();
}
