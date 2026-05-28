import { config } from 'dotenv';
import { resolve } from 'node:path';
import { z } from 'zod';

// Load apps/api/.env first (committed dev defaults from .env.dev.example),
// then apps/api/.env.local on top (gitignored per-dev override). Path
// resolves identically in dev (src/env.ts) and prod (dist/env.js) — both
// sit one dir below apps/api.
const baseDir = resolve(import.meta.dirname, '..');
config({ path: resolve(baseDir, '.env') });
config({ path: resolve(baseDir, '.env.local'), override: true });

// Treat empty strings as "unset" so `.optional()` works for keys that the
// user left blank in .env / .env.local. Without this, `SENTRY_DSN=` (no
// value after the =) reaches zod as '' and fails `.url()` even though the
// field is marked optional.
const emptyToUndefined = z.preprocess(
  (v) => (typeof v === 'string' && v === '' ? undefined : v),
  z.string().optional(),
);
const emptyToUndefinedUrl = z.preprocess(
  (v) => (typeof v === 'string' && v === '' ? undefined : v),
  z.string().url().optional(),
);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: emptyToUndefined,
  // Admin / cross-tenant DB connection (D-C). Authenticates as the BYPASSRLS
  // role (fxl_finders_admin). Backend-only — NEVER VITE_-prefixed.
  ADMIN_DATABASE_URL: emptyToUndefined,
  CLERK_SECRET_KEY: emptyToUndefined,
  CLERK_PUBLISHABLE_KEY: emptyToUndefined,
  SENTRY_DSN: emptyToUndefinedUrl,
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
