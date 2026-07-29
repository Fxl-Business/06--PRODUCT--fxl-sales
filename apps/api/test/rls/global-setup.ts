import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/**
 * Vitest globalSetup for the integration project (D-G).
 *
 * Applies the journaled Drizzle migrations (CREATE TABLE + RLS
 * policies - all in one journaled file per D-F) to the test DB BEFORE any RLS
 * test connects. Without this, the RLS tests would run against an unmigrated DB
 * (no tables, no policies, no roles) and false-pass or crash.
 *
 * Uses the standard project database URL. Cluster roles are provisioned outside
 * application migrations.
 */
export async function setup() {
  const migrateUrl =
    process.env.TEST_MIGRATE_DATABASE_URL ??
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgresql://postgres:postgres@localhost:5006/fxl_sales';
  const client = postgres(migrateUrl, { max: 1 });
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: './drizzle' });
  await client.end();
}
