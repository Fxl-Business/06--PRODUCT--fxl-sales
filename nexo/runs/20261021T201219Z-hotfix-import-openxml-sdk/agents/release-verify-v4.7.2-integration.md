# Release verify v4.7.2 - integration

Verdict: PASS

- HEAD ba1505f on hotfix/v4.7.2, DB fxl_sales_v471 (fresh, local 5006); setup-env.ts and assert-test-role.ts read TEST_DATABASE_URL, ADMIN_DATABASE_URL, TEST_MIGRATE_DATABASE_URL (confirmed).
- pnpm test:integration (CI=true, run once): exit 0, 51 files passed, 403 tests passed, 38.6s.
- import-routes.integration.test.ts and executor.integration.test.ts: see log lines below.
 ✓ src/domains/import/__tests__/import-routes.integration.test.ts (13 tests) 1107ms
 ✓ src/domains/import/__tests__/executor.integration.test.ts (9 tests) 641ms
