import 'dotenv/config';
import { runDatabaseMigrations } from './migration-runner.js';

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
