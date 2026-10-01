import { defineConfig } from 'vitest/config';

/**
 * Vitest config - unit vs integration split (D-G).
 *
 * Vitest 2.x has no `test.projects` key (that is a Vitest 3+ API). The
 * equivalent split here is driven by the VITEST_INTEGRATION env flag, wired via
 * package.json scripts:
 *   - `pnpm test`              → unit only. Includes src/**\/__tests__, EXCLUDES
 *                                test/rls/** and runs NO globalSetup.
 *   - `pnpm test:integration`  → DB-backed integration only. Includes test/rls/**
 *                                plus *.integration.test.ts files and runs the
 *                                migrate-first globalSetup.
 *
 * The integration tests never read the dev server's DATABASE_URL. They connect
 * through TEST_DATABASE_URL (the non-superuser fxl_sales_test role),
 * ADMIN_DATABASE_URL and TEST_MIGRATE_DATABASE_URL, named explicitly in
 * apps/api/.env and refused unless local by test/rls/assert-test-role.ts:
 * global-setup.ts checks the role and migrates once per run, and setup-env.ts
 * resolves the URLs per file, then points DATABASE_URL at TEST_DATABASE_URL so
 * the API code under test (getDb) hits the same test database. Test files read
 * the resolved URLs through src/db/__tests__/test-database-urls.ts.
 */
const isIntegration = process.env.VITEST_INTEGRATION === '1';

export default defineConfig({
  test: isIntegration
    ? {
        include: ['test/rls/**/*.test.ts', 'src/**/*.integration.test.ts'],
        globalSetup: ['./test/rls/global-setup.ts'], // D-G: migrate before RLS tests
        setupFiles: ['./test/rls/setup-env.ts'],
        testTimeout: 30000,
        hookTimeout: 30000,
        // The integration suite shares ONE Postgres test DB and exercises GLOBAL
        // tables (conversions/webhook_events and the hash-chained audit_log). Two
        // conversion-ingesting files (Phase 05 conversion-ingest + Phase 06
        // conversion-webhook-contract) corrupt each other's attribution/dedup/audit
        // assertions if run in parallel workers. Force serial file execution so the
        // shared-DB integration tests are deterministic.
        fileParallelism: false,
      }
    : {
      include: ['src/**/__tests__/**/*.test.ts', 'scripts/**/__tests__/**/*.test.ts'],
      exclude: ['node_modules/**', 'dist/**', 'test/rls/**', 'src/**/*.integration.test.ts'],
        // Blanks the six Hub credential names so no unit file inherits the
        // machine's own .env. See the file for why, and why it is not magic.
        setupFiles: ['./test/unit-setup.ts'],
        // Phase 01 ships only RLS integration tests (run via test:integration).
        // Unit suite is empty for now - don't fail the gate / future CI on it.
        passWithNoTests: true,
      },
});
