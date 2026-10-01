import 'dotenv/config';
import { resolveIntegrationDatabaseUrls } from './assert-test-role.js';

/*
  Per test file: resolve the suite's URLs strictly (named, local, no fallback to
  DATABASE_URL and no postgres default) or throw before the file runs. The role
  check itself runs once per run, in global-setup.ts.
*/
const { appUrl, adminUrl, migrateUrl } = resolveIntegrationDatabaseUrls(process.env);

process.env.TEST_DATABASE_URL = appUrl;
// Hard override, not ??=: with an .env pointing DATABASE_URL at a remote
// environment, the API under test would silently run against that remote DB
// while the test fixtures live in the test DB. Tests must be hermetic.
process.env.DATABASE_URL = appUrl;
process.env.ADMIN_DATABASE_URL = adminUrl;
process.env.TEST_MIGRATE_DATABASE_URL = migrateUrl;
