import { config } from 'dotenv';
import { resolve } from 'node:path';
import { z } from 'zod';

// Load apps/api/.env first (committed dev defaults from .env.dev.example),
// then apps/api/.env.local on top (gitignored per-dev override). Path
// resolves identically in dev (src/env.ts) and prod (dist/env.js) - both
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
  PORT: z.coerce.number().int().positive().default(3006),
  CORS_ORIGIN: z.string().url().default('http://localhost:8006'),
  DATABASE_URL: emptyToUndefined,
  // Optional admin DB override. Standard FXL deployments use DATABASE_URL only.
  ADMIN_DATABASE_URL: emptyToUndefined,
  FXL_HUB_API_URL: emptyToUndefinedUrl,
  FXL_HUB_PUBLISHABLE_KEY: emptyToUndefined,
  FXL_HUB_SECRET_KEY: emptyToUndefined,
  FXL_HUB_AUDIENCE: emptyToUndefined,
  FXL_HUB_REDIRECT_URI: emptyToUndefinedUrl,
  FXL_HUB_POST_LOGIN_REDIRECT: emptyToUndefinedUrl,
  FXL_HUB_POST_LOGIN_ERROR_REDIRECT: emptyToUndefinedUrl,
  SENTRY_DSN: emptyToUndefinedUrl,
  // Public origin used to build referral full URLs.
  PUBLIC_LINK_BASE_URL: emptyToUndefinedUrl,
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
