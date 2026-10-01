import postgres from 'postgres';
import { describeDatabaseTarget, isLocalDatabaseHost } from '../../src/db/local-database-guard.js';

/**
 * The integration suite's database preflight: WHERE it may connect and AS WHOM.
 *
 * Two refusals, both loud, both before any test runs:
 *
 * 1. Every database URL the suite uses must be named explicitly and must point at
 *    a local host, as decided by `src/db/local-database-guard.ts` (reused, never
 *    re-implemented). There is NO fallback to `DATABASE_URL`, because that is the
 *    dev server's variable and it has pointed at staging before (see
 *    nexo/knowledge/decisions/2026-07-29-integration-tests-are-hermetic-local.md
 *    and the local database guard reference), and NO default to the `postgres`
 *    superuser. `SALES_ENV_FILE` is not an escape hatch here: tests never target
 *    a remote database on purpose.
 *
 * 2. The APP url (`TEST_DATABASE_URL`) must connect as a role that is neither
 *    `SUPERUSER` nor `BYPASSRLS`. Either attribute silently bypasses
 *    `FORCE ROW LEVEL SECURITY`, so every tenant-isolation test would pass while
 *    proving nothing.
 *
 * Error messages name the variables and the documented LOCAL values, and print a
 * remote target by host only, never the whole URL.
 */

export type IntegrationDatabaseUrls = {
  /** `TEST_DATABASE_URL`: the non-superuser `fxl_sales_test` role the tests run as. */
  appUrl: string;
  /** `ADMIN_DATABASE_URL`: admin-context setup and teardown. */
  adminUrl: string;
  /** `TEST_MIGRATE_DATABASE_URL`, else `ADMIN_DATABASE_URL`: applies the migrations. */
  migrateUrl: string;
};

const DOCUMENTED_LOCAL_VALUES = [
  'TEST_DATABASE_URL=postgresql://fxl_sales_test:fxl_sales_test@localhost:5006/fxl_sales',
  'TEST_MIGRATE_DATABASE_URL=postgresql://postgres:postgres@localhost:5006/fxl_sales',
  'ADMIN_DATABASE_URL=postgresql://postgres:postgres@localhost:5006/fxl_sales',
];

const PREFIX = '[integration-database]';

export class IntegrationDatabaseRefusal extends Error {
  constructor(lines: string[]) {
    super(
      [
        ...lines,
        `${PREFIX} Set them in apps/api/.env (local Docker Postgres):`,
        ...DOCUMENTED_LOCAL_VALUES.map((line) => `  ${line}`),
      ].join('\n'),
    );
    this.name = 'IntegrationDatabaseRefusal';
  }
}

function present(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value;
}

/**
 * Resolves the suite's three URLs from `env` (pass `process.env`), or throws
 * `IntegrationDatabaseRefusal` listing EVERY problem at once.
 */
export function resolveIntegrationDatabaseUrls(
  env: Record<string, string | undefined>,
): IntegrationDatabaseUrls {
  const appUrl = present(env.TEST_DATABASE_URL);
  const adminUrl = present(env.ADMIN_DATABASE_URL);
  const migrateUrl = present(env.TEST_MIGRATE_DATABASE_URL) ?? adminUrl;

  const problems: string[] = [];
  for (const [name, value] of [
    ['TEST_DATABASE_URL', appUrl],
    ['ADMIN_DATABASE_URL', adminUrl],
  ] as const) {
    if (!value) problems.push(`${PREFIX} ${name} is not set. It never falls back to DATABASE_URL.`);
  }

  const named: Array<[string, string | undefined]> = [
    ['TEST_DATABASE_URL', appUrl],
    ['ADMIN_DATABASE_URL', adminUrl],
    [
      present(env.TEST_MIGRATE_DATABASE_URL)
        ? 'TEST_MIGRATE_DATABASE_URL'
        : 'ADMIN_DATABASE_URL (as the migrate target)',
      migrateUrl,
    ],
  ];
  for (const [name, url] of named) {
    if (!url || isLocalDatabaseHost(url)) continue;
    const target = describeDatabaseTarget(url);
    problems.push(
      target
        ? `${PREFIX} ${name} points at the non-local host "${target.host}". ` +
            'Integration tests run only against localhost, 127.0.0.1, ::1 or db.'
        : `${PREFIX} ${name} is not a parseable database URL, so it cannot be proven local.`,
    );
  }

  if (problems.length > 0 || !appUrl || !adminUrl || !migrateUrl) {
    throw new IntegrationDatabaseRefusal(problems);
  }
  return { appUrl, adminUrl, migrateUrl };
}

/**
 * Connects with the APP url and refuses a `SUPERUSER` or `BYPASSRLS` role. Run once
 * per integration run, from the global setup, before any migration or test.
 */
export async function assertTestRole(appUrl: string): Promise<void> {
  const sql = postgres(appUrl, { max: 1, onnotice: () => {} });
  try {
    const [role] = await sql<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user
    `;
    if (!role) {
      throw new IntegrationDatabaseRefusal([
        `${PREFIX} Could not read the TEST_DATABASE_URL role from pg_roles.`,
      ]);
    }
    const attributes = [
      role.rolsuper ? 'SUPERUSER' : null,
      role.rolbypassrls ? 'BYPASSRLS' : null,
    ].filter((attribute): attribute is string => attribute !== null);
    if (attributes.length > 0) {
      throw new IntegrationDatabaseRefusal([
        `${PREFIX} TEST_DATABASE_URL connects as "${role.rolname}", ` +
          `which is ${attributes.join(' and ')}.`,
        `${PREFIX} That role bypasses FORCE ROW LEVEL SECURITY, so the RLS tests would ` +
          'prove nothing. Use the non-superuser fxl_sales_test role.',
      ]);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}
