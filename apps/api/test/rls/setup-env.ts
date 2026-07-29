import 'dotenv/config';

const migrateUrl =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5006/fxl_sales';

const appUrl =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5006/fxl_sales';

const adminUrl =
  process.env.ADMIN_DATABASE_URL ??
  appUrl;

process.env.TEST_DATABASE_URL ??= appUrl;
// Hard override, not ??=: with an .env pointing DATABASE_URL at a remote
// environment, the API under test would silently run against that remote DB
// while the test fixtures live in the test DB. Tests must be hermetic.
process.env.DATABASE_URL = appUrl;
process.env.ADMIN_DATABASE_URL ??= adminUrl;
process.env.TEST_MIGRATE_DATABASE_URL ??= migrateUrl;
