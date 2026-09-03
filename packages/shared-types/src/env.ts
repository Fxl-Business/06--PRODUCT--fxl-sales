import { z } from 'zod';

/**
 * Shared env schema fragments.
 * Each app composes these with its own app-specific schema in `src/env.ts`.
 */

export const sharedServerEnv = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SENTRY_DSN: z.string().url().optional(),
});

export const sharedClientEnv = z.object({
  VITE_FXL_HUB_API_URL: z.string().url().optional(),
  // `VITE_FXL_HUB_PUBLISHABLE_KEY` is GONE with the 2.2.0 bump: the browser half
  // identifies the Client by audience plus environment and holds no key.
  VITE_FXL_HUB_ENVIRONMENT: z.enum(['production', 'staging', 'development']).optional(),
  VITE_FXL_HUB_AUDIENCE: z.string().min(1).optional(),
  VITE_SENTRY_DSN: z.string().url().optional(),
});

export type SharedServerEnv = z.infer<typeof sharedServerEnv>;
export type SharedClientEnv = z.infer<typeof sharedClientEnv>;
