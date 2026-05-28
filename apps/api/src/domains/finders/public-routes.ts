import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { getAdminDb } from '../../db/client.js';
import { finders } from '../../db/schema.js';
import { finderSignupSchema } from './signup-schema.js';

/**
 * Public (no-auth) finder signup router (Phase 03 T02, D-R).
 *
 * Mounted UNAUTHENTICATED in server.ts — a finder has no Clerk account at signup,
 * so no JWT is available.
 *
 * DB access (D-H + brief KEY reminder): `finders` is FORCE ROW LEVEL SECURITY
 * with a single policy `org_id = current_setting('app.current_org_id', true)`.
 * A public INSERT with org_id='' and no setTenantContext would FAIL the WITH
 * CHECK under the app role (current_setting → NULL). The signup write therefore
 * goes via getAdminDb() (BYPASSRLS), exactly as the admin approve/suspend writes
 * do. (Plan A3 said getDb(); the brief's "signup/approval writes go via
 * getAdminDb()" reminder is authoritative and supersedes it.)
 *
 * Honeypot (D-R): the validator accepts any `website` string; the DECISION is
 * made HERE — a non-empty website returns a silent 201 with NO DB insert so a
 * bot never learns it tripped the trap.
 */
export const findersPublicRouter = new Hono();

findersPublicRouter.post('/signup', zValidator('json', finderSignupSchema), async (c) => {
  const body = c.req.valid('json');

  // Honeypot decision (D-R) — non-empty website => silent 201, NO insert.
  if (body.website && body.website.length > 0) {
    return c.json({ id: crypto.randomUUID(), status: 'pending' }, 201);
  }

  const db = getAdminDb(); // BYPASSRLS — org_id='' placeholder is invisible to tenant RLS
  const [finder] = await db
    .insert(finders)
    .values({
      orgId: '', // placeholder until admin approves + Clerk org created (A3)
      clerkUserId: null, // backfilled when Clerk invite accepted (Phase 05 webhook)
      clerkOrgId: null, // backfilled at admin approval (Clerk org created)
      status: 'pending',
      displayName: body.displayName,
      contactEmail: body.contactEmail,
      cpf: body.cpf,
      phone: body.phone,
      pixKey: body.pixKey,
      pixKeyType: body.pixKeyType,
      payoutAddress: body.payoutAddress ?? null,
      lgpdConsentEssential: body.lgpdConsentEssential,
      lgpdConsentMarketing: body.lgpdConsentMarketing,
      lgpdConsentVersion: body.lgpdConsentVersion,
      lgpdConsentedAt: new Date(),
    })
    .returning({ id: finders.id, status: finders.status });

  if (!finder) {
    return c.json({ error: 'insert_failed' }, 500);
  }
  return c.json({ id: finder.id, status: finder.status }, 201);
});
