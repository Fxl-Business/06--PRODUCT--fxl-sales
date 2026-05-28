import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

// Phase 01 (D-C/D-F/D-G): the journaled migration runs CREATE ROLE / CREATE
// POLICY, which need owner/superuser privileges. Prefer MIGRATE_DATABASE_URL
// (owner/superuser) and fall back to DATABASE_URL. At runtime DATABASE_URL
// targets the unprivileged fxl_finders_app role, so it must NOT be used to apply
// role-creating migrations the first time.
const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('MIGRATE_DATABASE_URL or DATABASE_URL is required');
  process.exit(1);
}

const client = postgres(url, { max: 1 });
const db = drizzle(client);

console.log('Running migrations from ./drizzle …');
await migrate(db, { migrationsFolder: './drizzle' });
console.log('Done.');

await client.end();
