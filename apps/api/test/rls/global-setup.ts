import 'dotenv/config';
import { runDatabaseMigrations } from '../../src/db/migration-runner.js';
import { assertTestRole, resolveIntegrationDatabaseUrls } from './assert-test-role.js';

/**
 * Vitest globalSetup for the integration project (D-G).
 *
 * Applies the journaled Drizzle migrations (CREATE TABLE + RLS
 * policies - all in one journaled file per D-F) to the test DB BEFORE any RLS
 * test connects. Without this, the RLS tests would run against an unmigrated DB
 * (no tables, no policies, no roles) and false-pass or crash.
 *
 * Before anything connects, `resolveIntegrationDatabaseUrls` refuses a missing or
 * non-local URL (never falling back to DATABASE_URL or a postgres default), and
 * `assertTestRole` refuses an app role that is SUPERUSER or BYPASSRLS. Both run
 * once per integration run and fail it loudly. Cluster roles are provisioned
 * outside application migrations.
 */
export async function setup() {
  const { appUrl, migrateUrl } = resolveIntegrationDatabaseUrls(process.env);
  await assertTestRole(appUrl);
  await runDatabaseMigrations({ databaseUrl: migrateUrl, migrationsFolder: './drizzle' });
}
