import { API_ROOT_DIR, loadEnvFiles } from '../config/env-files.js';
import { runDatabaseMigrations } from './migration-runner.js';

// NOT `import 'dotenv/config'`. That read `.env` from the CWD, never saw
// `.env.local`, and never saw a named SALES_ENV_FILE - so the one entrypoint
// that applies DDL reached a DIFFERENT environment from the API it migrates
// for. This is the same loader `src/env.ts` uses, and that is the point.
loadEnvFiles({ baseDir: API_ROOT_DIR, bag: process.env });

// Migrations run with the standard FXL project DATABASE_URL created by
// create-db.sh. Cluster roles are provisioned outside application migrations.
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

console.log('Running migrations from ./drizzle');
await runDatabaseMigrations({ databaseUrl: url, migrationsFolder: './drizzle' });
console.log('Done.');
