import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  createSellerAndInvite,
  listSellers,
  resendInvitation,
  revokeInvitation,
  setSellerStatus,
  type InviteFailure,
} from './admin-service.js';

/**
 * Admin sellers routes (Phase 03 T04, invitations in v4.1.0). Mounted under the
 * appAuthMiddleware + requireAdmin admin group in admin/index.ts - do NOT
 * re-apply auth here.
 *
 * Uses getAdminDb() via the service layer; setTenantContext is NEVER called.
 *
 * The Hub actor token for every invitation call is the raw `Authorization`
 * bearer of THIS request (already verified by appAuthMiddleware), read here and
 * threaded down. It is never taken from a body or from `hubAuth`. The invite's
 * Organization is the token's; `invited_org_id` is `c.get('orgId')`.
 */
export const sellersAdminRouter = new Hono();

const LocaleSchema = z.enum(['pt-BR', 'en']).default('pt-BR');

const CreateSellerSchema = z.object({
  displayName: z.string().min(2).max(100),
  contactEmail: z.string().email(),
  locale: LocaleSchema,
});

const ResendSchema = z.object({ locale: LocaleSchema });

const StatusSchema = z.object({ status: z.enum(['active', 'inactive']) });

const SellerIdSchema = z.string().uuid();

function bearerOf(c: Context): string {
  return (c.req.header('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
}

function setRetryAfter(c: Context, failure: InviteFailure): void {
  if (failure.retryAfterSeconds !== undefined) {
    c.header('Retry-After', String(failure.retryAfterSeconds));
  }
}

function failureResponse(c: Context, failure: InviteFailure) {
  setRetryAfter(c, failure);
  // The status comes from mapInvitationError / INVITATIONS_UNAVAILABLE.
  return c.json(failure.body, failure.httpStatus as 400);
}

sellersAdminRouter.get('/', async (c) => {
  const sellers = await listSellers({ accessToken: bearerOf(c) });
  return c.json({ sellers });
});

sellersAdminRouter.post('/', async (c) => {
  const parsed = CreateSellerSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  const { seller, invite } = await createSellerAndInvite(parsed.data, {
    accessToken: bearerOf(c),
    orgId: c.get('orgId'),
  });

  // The seller exists either way, so this is always 201; a failed invite rides
  // along as `inviteError` with the status it would have answered on its own.
  if (invite.ok) {
    return c.json({ seller, ...invite.delivery }, 201);
  }
  const { failure } = invite;
  setRetryAfter(c, failure);
  return c.json(
    {
      seller,
      inviteError: {
        status: failure.httpStatus,
        ...failure.body,
        ...(failure.retryAfterSeconds !== undefined ? { retryAfterSeconds: failure.retryAfterSeconds } : {}),
      },
    },
    201,
  );
});

sellersAdminRouter.post('/:id/resend', async (c) => {
  const id = SellerIdSchema.safeParse(c.req.param('id'));
  if (!id.success) return c.json({ error: 'not_found' }, 404);
  const parsed = ResendSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }

  const outcome = await resendInvitation(id.data, { accessToken: bearerOf(c) }, parsed.data.locale);
  if (outcome.kind === 'not_found') return c.json({ error: 'not_found' }, 404);
  if (outcome.kind === 'failed') return failureResponse(c, outcome.failure);
  return c.json({ seller: outcome.seller, ...outcome.value });
});

sellersAdminRouter.post('/:id/revoke', async (c) => {
  const id = SellerIdSchema.safeParse(c.req.param('id'));
  if (!id.success) return c.json({ error: 'not_found' }, 404);

  const outcome = await revokeInvitation(id.data, { accessToken: bearerOf(c) });
  if (outcome.kind === 'not_found') return c.json({ error: 'not_found' }, 404);
  if (outcome.kind === 'failed') return failureResponse(c, outcome.failure);
  return c.json({ seller: outcome.seller });
});

sellersAdminRouter.patch('/:id/status', async (c) => {
  const parsed = StatusSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  const seller = await setSellerStatus(c.req.param('id'), parsed.data.status);
  if (!seller) return c.json({ error: 'not_found' }, 404);
  return c.json({ seller });
});
