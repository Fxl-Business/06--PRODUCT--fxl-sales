import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { expect } from 'vitest';
import { testDatabaseUrls } from '../../src/db/__tests__/test-database-urls.js';

/**
 * A throwaway Postgres database + owning NOSUPERUSER role, for migration
 * oracles that need to run a migration as the real non-superuser owner
 * (FORCE RLS genuinely applies) against data seeded BEFORE the migration
 * ships. Copied, minus the `testControls` seams, from
 * `professional-payable-migration.integration.test.ts`; keep both in sync by
 * hand rather than importing between them (see that file's own comment on why
 * it is not refactored onto this helper in this slice).
 */

export type SqlClient = ReturnType<typeof postgres>;

export type ScratchDatabase = {
  admin: SqlClient;
  adminScratch: SqlClient;
  clients: Set<SqlClient>;
  databaseCreated: boolean;
  databaseName: string;
  ownerUrl: string;
  roleCreated: boolean;
  roleName: string;
};

export const MIGRATIONS_FOLDER = resolve(process.cwd(), 'drizzle');

const identifierPattern = /^[a-z0-9_]+$/;

function exactIdentifier(value: string): string {
  if (!identifierPattern.test(value)) {
    throw new Error(`unsafe PostgreSQL identifier: ${value}`);
  }
  return `"${value}"`;
}

function databaseUrl(
  source: string,
  databaseName: string,
  credentials?: { password: string; username: string },
): string {
  const url = new URL(source);
  url.pathname = `/${databaseName}`;
  if (credentials) {
    url.username = credentials.username;
    url.password = credentials.password;
  }
  return url.toString();
}

export function migrationAdminUrl(): string {
  return testDatabaseUrls().migrateUrl;
}

async function attemptCleanup(
  errors: unknown[],
  cleanup: () => Promise<unknown>,
): Promise<void> {
  try {
    await cleanup();
  } catch (error) {
    errors.push(error);
  }
}

export async function createScratchDatabase(): Promise<ScratchDatabase> {
  const suffix = randomUUID().replaceAll('-', '');
  const databaseName = `fxl_sales_migration_${suffix}`;
  const roleName = `fxl_sales_migrator_${suffix}`;
  const password = randomUUID().replaceAll('-', '');
  const sourceUrl = migrationAdminUrl();
  const admin = postgres(databaseUrl(sourceUrl, 'postgres'), { max: 1 });
  const ownerUrl = databaseUrl(sourceUrl, databaseName, {
    password,
    username: roleName,
  });
  const scratch: ScratchDatabase = {
    admin,
    adminScratch: postgres(databaseUrl(sourceUrl, databaseName), { max: 2 }),
    clients: new Set<SqlClient>(),
    databaseCreated: false,
    databaseName,
    ownerUrl,
    roleCreated: false,
    roleName,
  };

  try {
    await admin.unsafe(
      `CREATE ROLE ${exactIdentifier(roleName)} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    scratch.roleCreated = true;
    await admin.unsafe(
      `CREATE DATABASE ${exactIdentifier(databaseName)} OWNER ${exactIdentifier(roleName)}`,
    );
    scratch.databaseCreated = true;

    const [role] = await admin<
      Array<{ rolbypassrls: boolean; rolsuper: boolean }>
    >`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = ${roleName}`;
    expect(role).toEqual({ rolbypassrls: false, rolsuper: false });

    return scratch;
  } catch (error) {
    await cleanupScratch(scratch);
    throw error;
  }
}

export function scratchClient(scratch: ScratchDatabase, max = 1): SqlClient {
  const client = postgres(scratch.ownerUrl, { max });
  scratch.clients.add(client);
  return client;
}

export async function cleanupScratch(scratch: ScratchDatabase): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const client of scratch.clients) {
    await attemptCleanup(errors, () => client.end({ timeout: 1 }));
  }
  await attemptCleanup(errors, () => scratch.adminScratch.end({ timeout: 1 }));
  if (scratch.databaseCreated) {
    await attemptCleanup(errors, () => scratch.admin`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = ${scratch.databaseName}
        AND pid <> pg_backend_pid()
    `);
    await attemptCleanup(errors, () =>
      scratch.admin.unsafe(
        `DROP DATABASE IF EXISTS ${exactIdentifier(scratch.databaseName)}`,
      ),
    );
  }
  if (scratch.roleCreated) {
    await attemptCleanup(errors, () =>
      scratch.admin.unsafe(`DROP ROLE IF EXISTS ${exactIdentifier(scratch.roleName)}`),
    );
  }
  await attemptCleanup(errors, () => scratch.admin.end({ timeout: 1 }));
  return errors;
}
