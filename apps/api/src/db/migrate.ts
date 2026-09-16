import { API_ROOT_DIR, loadEnvFiles } from '../config/env-files.js';
import { assertLocalDatabase, describeDatabaseTarget } from './local-database-guard.js';
import { runDatabaseMigrations } from './migration-runner.js';

// NOT `import 'dotenv/config'`. That read `.env` from the CWD, never saw
// `.env.local`, and never saw a named SALES_ENV_FILE - so the one entrypoint
// that applies DDL reached a DIFFERENT environment from the API it migrates
// for. This is the same loader `src/env.ts` uses, and that is the point.
//
// Its `namedEnvFile` is the guard's third input: a remote host is admissible
// only when a named file is what put it there.
const { namedEnvFile } = loadEnvFiles({ baseDir: API_ROOT_DIR, bag: process.env });

// Migrations run with the standard FXL project DATABASE_URL created by
// create-db.sh. Cluster roles are provisioned outside application migrations.
//
// This module deliberately does NOT import ../env.js. That module's zod schema
// process.exit(1)s on any invalid variable in the whole API surface - Hub
// credentials included - and a migration has no business failing on Hub
// configuration. NODE_ENV therefore comes from process.env here, read once.
//
// Both reads sit AFTER the loadEnvFiles call above: dotenv populates
// process.env inside that call, so reading either before it yields the
// pre-dotenv values.
const nodeEnv = process.env.NODE_ENV ?? 'development';
const url = process.env.DATABASE_URL;

// The guard runs BEFORE any connection is opened and BEFORE runDatabaseMigrations.
// This is the path that applies DDL. On 2026-09-16 it applied DDL to staging.
const databaseViolations = assertLocalDatabase({
  nodeEnv,
  databaseUrl: url,
  namedEnvFile,
});
if (databaseViolations.length > 0) {
  for (const line of databaseViolations) console.error(line);
  process.exit(1);
}

if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const target = describeDatabaseTarget(url);
if (nodeEnv !== 'production') {
  console.log(
    target
      ? `[fxl-sales-migrate] database host=${target.host} port=${target.port}`
      : '[fxl-sales-migrate] database target unknown - DATABASE_URL does not parse',
  );
}

console.log('Running migrations from ./drizzle');
await runDatabaseMigrations({ databaseUrl: url, migrationsFolder: './drizzle' });
console.log('Done.');
