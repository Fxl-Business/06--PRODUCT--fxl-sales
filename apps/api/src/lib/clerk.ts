import { createClerkClient } from '@clerk/backend';
import { env } from '../env.js';

/**
 * Shared Clerk Backend SDK client (D-I). Single source for Phases 03 (org
 * creation, invitations) and 05 (user.created webhook backfill). Never construct
 * ad-hoc clients.
 *
 * NOTE: `@clerk/backend` v1.x has NO bound default `clerkClient` export — it must
 * be constructed with `createClerkClient`. `env.CLERK_SECRET_KEY` is
 * `string | undefined`; the dev passthrough in middleware/auth.ts short-circuits
 * auth when the key is unset, so an empty key is only ever used in local/template
 * mode. Importing this module performs no network I/O.
 */
export const clerkClient = createClerkClient({ secretKey: env.CLERK_SECRET_KEY ?? '' });
