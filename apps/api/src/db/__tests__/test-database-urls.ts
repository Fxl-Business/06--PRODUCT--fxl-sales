/**
 * The integration suite's database URLs, exactly as `test/rls/setup-env.ts`
 * resolved them.
 *
 * `setup-env.ts` (the integration project's `setupFiles` entry) refuses a missing
 * or non-local URL through `resolveIntegrationDatabaseUrls` and then writes the
 * three resolved values back into `process.env`. Every integration file reads them
 * through this helper instead of its own `?? DATABASE_URL ?? 'postgresql://...'`
 * chain. There is no fallback here: one could only ever fire when setup-env did not
 * run, and then the right answer is to fail loudly, not to guess a database.
 *
 * It lives under `src/` (not `test/rls/`) because `src/` integration files import
 * it too, and `tsconfig.json` roots `src/` alone (`rootDir: ./src`, TS6059 for
 * anything outside). `test/rls/` files reach it the way they reach the rest of
 * `src/`. It imports nothing, so a unit file that loads it by accident pays
 * nothing until it calls it.
 */
export type TestDatabaseUrls = {
  /** `TEST_DATABASE_URL`: the non-superuser `fxl_sales_test` role the tests run as. */
  appUrl: string;
  /** `ADMIN_DATABASE_URL`: admin-context setup and teardown. */
  adminUrl: string;
  /** `TEST_MIGRATE_DATABASE_URL`: migrations, scratch databases, replica-mode cleanup. */
  migrateUrl: string;
};

export function testDatabaseUrls(): TestDatabaseUrls {
  const appUrl = process.env.TEST_DATABASE_URL;
  const adminUrl = process.env.ADMIN_DATABASE_URL;
  const migrateUrl = process.env.TEST_MIGRATE_DATABASE_URL;
  if (!appUrl || !adminUrl || !migrateUrl) {
    const missing = [
      ['TEST_DATABASE_URL', appUrl],
      ['ADMIN_DATABASE_URL', adminUrl],
      ['TEST_MIGRATE_DATABASE_URL', migrateUrl],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);
    throw new Error(
      `[integration-database] ${missing.join(', ')} not resolved: test/rls/setup-env.ts ` +
        'did not run. Run this file through `pnpm --filter @fxl-sales/api test:integration`.',
    );
  }
  return { appUrl, adminUrl, migrateUrl };
}
