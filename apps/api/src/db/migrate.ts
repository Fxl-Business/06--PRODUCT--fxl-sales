import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

// Migrations run with the standard FXL project DATABASE_URL created by
// create-db.sh. Cluster roles are provisioned outside application migrations.
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const client = postgres(url, { max: 1 });
const db = drizzle(client);

console.log('Running migrations from ./drizzle');
await migrate(db, { migrationsFolder: './drizzle' });
console.log('Done.');

await client.end();
