import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../../../db/client.js';
import {
  CreateLeadSchema,
  ListLeadsQuerySchema,
  MoveLeadSchema,
  UpdateLeadSchema,
} from './lead-schemas.js';
import {
  LeadInputError,
  type LeadScope,
  createLead,
  getLead,
  listLeads,
  moveLead,
  updateLead,
} from './lead-service.js';

/**
 * The lead entity's HTTP surface, mounted at '/leads' into salesOpsRouter.
 *
 * The export name is load-bearing and is NOT `leadStagesRouter`: the stage
 * cadastro ships its own `leads/stage-routes.ts`, mounted separately at '/'.
 * Two distinct names, and deliberately no import alias, because an alias hides
 * that these are two different routers and moves the disambiguation into the
 * consumer.
 *
 * There is NO DELETE verb here and there must never be one. A lead that goes
 * nowhere ends in the terminal `lost` stage, which is what that stage is for.
 */
export const leadsRouter = new Hono();

const leadIdSchema = z.string().uuid();

/**
 * The caller, from the VERIFIED context and from nothing else.
 *
 * `appAuthMiddleware` sets `userRoles` from `getAppRolesFromHubClaims`, which
 * returns the full role set when the verified token says `isSuperAdmin`, or
 * `claims.roles.workspace` is owner/admin, or `claims.roles.productRoles`
 * carries `admin`. That is the same synthesis `requireAdmin` reads.
 *
 * `requireAdmin` is deliberately NOT mounted on these routes - a seller must
 * reach their own board - so the admin/seller distinction is a boolean on this
 * object instead, and the ENFORCEMENT is the predicate inside `withTenant`,
 * never the middleware and never the client.
 */
function leadScope(c: Context): LeadScope {
  const email = c.get('hubAuth')?.claims?.email;
  return {
    userId: c.get('userId'),
    email: typeof email === 'string' && email.trim() !== '' ? email : null,
    isAdmin: (c.get('userRoles') ?? []).includes('admin'),
  };
}

/**
 * Every non-ok service result, mapped onto the bodies `routes.ts` already
 * returns elsewhere: the 403 matches `requireAdmin`'s
 * `{error:'forbidden',reason:'admin_role_required'}` and the 409 matches
 * `{error:'conflict',reason:'funcao_is_system'}`.
 *
 * An out-of-scope lead is `not_found` and never `forbidden`, because a 403 on a
 * specific uuid confirms the row exists.
 */
function failureResponse(
  c: Context,
  reason: 'not_found' | 'seller_scope' | 'seller_person_unmapped' | 'already_converted',
) {
  if (reason === 'not_found') return c.json({ error: 'not_found' }, 404);
  if (reason === 'already_converted') {
    return c.json({ error: 'conflict', reason: 'lead_already_converted' }, 409);
  }
  return c.json({ error: 'forbidden', reason }, 403);
}

/**
 * The service sentinel 400, byte-identical to the one `routes.ts` returns for a
 * `SaleInputError`. These are the rules that need a database read to decide -
 * "does this destination stage require a reason?" - so they cannot be zod
 * refines.
 */
function leadInputErrorResponse(c: Context, error: LeadInputError) {
  return c.json(
    { error: 'validation_error', reason: error.code, itemIndex: error.itemIndex },
    400,
  );
}

leadsRouter.get('/', async (c) => {
  const parsed = ListLeadsQuerySchema.safeParse({
    stageId: c.req.query('stageId'),
    limit: c.req.query('limit'),
    cursor: c.req.query('cursor'),
    sellerPersonId: c.req.query('sellerPersonId'),
  });
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  const result = await listLeads(getDb(), c.get('orgId'), parsed.data, leadScope(c));
  if (!result.ok) return failureResponse(c, result.reason);
  return c.json({ leads: result.leads, nextCursor: result.nextCursor, total: result.total });
});

leadsRouter.post('/', async (c) => {
  const parsed = CreateLeadSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  try {
    const result = await createLead(getDb(), c.get('orgId'), parsed.data, leadScope(c));
    if (!result.ok) return failureResponse(c, result.reason);
    return c.json({ lead: result.lead }, 201);
  } catch (error) {
    if (error instanceof LeadInputError) return leadInputErrorResponse(c, error);
    throw error;
  }
});

leadsRouter.get('/:id', async (c) => {
  const id = leadIdSchema.safeParse(c.req.param('id'));
  if (!id.success) return c.json({ error: 'not_found' }, 404);
  const result = await getLead(getDb(), c.get('orgId'), id.data, leadScope(c));
  if (!result.ok) return failureResponse(c, result.reason);
  return c.json({ lead: result.lead });
});

leadsRouter.patch('/:id', async (c) => {
  const id = leadIdSchema.safeParse(c.req.param('id'));
  if (!id.success) return c.json({ error: 'not_found' }, 404);
  const parsed = UpdateLeadSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  try {
    const result = await updateLead(
      getDb(),
      c.get('orgId'),
      id.data,
      parsed.data,
      leadScope(c),
    );
    if (!result.ok) return failureResponse(c, result.reason);
    return c.json({ lead: result.lead });
  } catch (error) {
    if (error instanceof LeadInputError) return leadInputErrorResponse(c, error);
    throw error;
  }
});

leadsRouter.post('/:id/move', async (c) => {
  const id = leadIdSchema.safeParse(c.req.param('id'));
  if (!id.success) return c.json({ error: 'not_found' }, 404);
  const parsed = MoveLeadSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  try {
    const result = await moveLead(getDb(), c.get('orgId'), id.data, parsed.data, leadScope(c));
    if (!result.ok) return failureResponse(c, result.reason);
    return c.json({ lead: result.lead });
  } catch (error) {
    if (error instanceof LeadInputError) return leadInputErrorResponse(c, error);
    throw error;
  }
});
