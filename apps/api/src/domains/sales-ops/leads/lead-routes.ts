import { leadFieldSet } from '@fxl-sales/shared-utils/sales-edition';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../../../db/client.js';
import { requireAdmin } from '../../../middleware/require-admin.js';
import { cadastroActor } from '../cadastro-actor.js';
import {
  CreateContactLeadSchema,
  CreateLeadSchema,
  LeadStageSummaryQuerySchema,
  ListDeletedLeadsQuerySchema,
  ListLeadsQuerySchema,
  MoveLeadSchema,
  UpdateContactLeadSchema,
  UpdateLeadSchema,
} from './lead-schemas.js';
import {
  LeadInputError,
  type LeadScope,
  type WriteLeadResult,
  createContactLead,
  createLead,
  getLead,
  listLeads,
  moveLead,
  summarizeLeadStages,
  updateContactLead,
  updateLead,
} from './lead-service.js';
import { type LeadActor, deleteLead, listDeletedLeads, restoreLead } from './lead-trash-service.js';

/**
 * The lead entity's HTTP surface, mounted at '/leads' into salesOpsRouter.
 *
 * The export name is load-bearing and is NOT `leadStagesRouter`: the stage
 * cadastro ships its own `leads/stage-routes.ts`, mounted separately at '/'.
 * Two distinct names, and deliberately no import alias, because an alias hides
 * that these are two different routers and moves the disambiguation into the
 * consumer.
 *
 * There is still NO DELETE verb here and there must never be one. A lead that
 * merely goes nowhere ends in the terminal `lost` stage, which is what that stage
 * is for. Removing a lead by mistake or as junk is the lixeira: `POST /:id/delete`
 * is a SOFT delete (a POST action like `/move`) that the gestor reverses with
 * `POST /:id/restore`, both audited in lead-trash-service.ts.
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
/**
 * Who deletes or restores, from the VERIFIED context only. The name is the one
 * snapshot rule the cadastro ledger already uses (`cadastroActor`: name, then
 * e-mail, then null, never the account id), taken here because the act is the
 * only moment it is knowable.
 */
function leadActor(c: Context): LeadActor {
  const actor = cadastroActor(c);
  return { userId: actor.userId, name: actor.displayName };
}

function leadScope(c: Context): LeadScope {
  const claims = c.get('hubAuth')?.claims;
  const email = claims?.email;
  const name = claims?.name;
  const roles = c.get('userRoles') ?? [];
  return {
    userId: c.get('userId'),
    email: typeof email === 'string' && email.trim() !== '' ? email : null,
    isAdmin: roles.includes('admin'),
    // Read only by the leads-edition seller auto-provision; the full edition
    // never reaches it (see resolveLeadScopePredicate).
    name: typeof name === 'string' && name.trim() !== '' ? name : null,
    hasSellerRole: roles.includes('seller'),
    edition: c.get('salesEdition') ?? 'full',
  };
}

/**
 * Which lead wire contract this request speaks, from the edition the auth
 * middleware resolved from the VERIFIED token. Absent means 'full', the same
 * fail-to-full rule requireCapability applies, so it can never change FXL.
 */
function usesContactFields(c: Context): boolean {
  return leadFieldSet(c.get('salesEdition') ?? 'full') === 'contact';
}

function validationResponse(c: Context, error: z.ZodError) {
  return c.json({ error: 'validation_error', issues: error.flatten() }, 400);
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
  const body = await c.req.json().catch(() => ({}));
  let result: WriteLeadResult;
  try {
    if (usesContactFields(c)) {
      const parsed = CreateContactLeadSchema.safeParse(body);
      if (!parsed.success) return validationResponse(c, parsed.error);
      result = await createContactLead(getDb(), c.get('orgId'), parsed.data, leadScope(c));
    } else {
      const parsed = CreateLeadSchema.safeParse(body);
      if (!parsed.success) return validationResponse(c, parsed.error);
      result = await createLead(getDb(), c.get('orgId'), parsed.data, leadScope(c));
    }
  } catch (error) {
    if (error instanceof LeadInputError) return leadInputErrorResponse(c, error);
    throw error;
  }
  if (!result.ok) return failureResponse(c, result.reason);
  return c.json({ lead: result.lead }, 201);
});

// Static paths sit ABOVE '/:id' (this one and slice 02's '/summary'): Hono runs
// matching handlers in registration order, and '/:id' would otherwise take
// 'deleted' as an id and answer 404.
// Admin only: the lixeira is the gestor's screen in both editions.
leadsRouter.get('/deleted', requireAdmin, async (c) => {
  const parsed = ListDeletedLeadsQuerySchema.safeParse({
    limit: c.req.query('limit'),
    cursor: c.req.query('cursor'),
  });
  if (!parsed.success) return validationResponse(c, parsed.error);
  const page = await listDeletedLeads(getDb(), c.get('orgId'), parsed.data);
  return c.json({ items: page.items, nextCursor: page.nextCursor });
});

/**
 * The board's per-column totals. Registered BEFORE '/:id' so the param route
 * never swallows the literal 'summary'. Every board caller reaches it (no
 * requireAdmin); the seller scoping is the service predicate, the same one the
 * list uses.
 */
leadsRouter.get('/summary', async (c) => {
  const parsed = LeadStageSummaryQuerySchema.safeParse({
    sellerPersonId: c.req.query('sellerPersonId'),
  });
  if (!parsed.success) return validationResponse(c, parsed.error);
  const result = await summarizeLeadStages(getDb(), c.get('orgId'), parsed.data, leadScope(c));
  if (!result.ok) return failureResponse(c, result.reason);
  return c.json({ stages: result.stages });
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
  const body = await c.req.json().catch(() => ({}));
  let result: WriteLeadResult;
  try {
    if (usesContactFields(c)) {
      const parsed = UpdateContactLeadSchema.safeParse(body);
      if (!parsed.success) return validationResponse(c, parsed.error);
      result = await updateContactLead(
        getDb(),
        c.get('orgId'),
        id.data,
        parsed.data,
        leadScope(c),
      );
    } else {
      const parsed = UpdateLeadSchema.safeParse(body);
      if (!parsed.success) return validationResponse(c, parsed.error);
      result = await updateLead(getDb(), c.get('orgId'), id.data, parsed.data, leadScope(c));
    }
  } catch (error) {
    if (error instanceof LeadInputError) return leadInputErrorResponse(c, error);
    throw error;
  }
  if (!result.ok) return failureResponse(c, result.reason);
  return c.json({ lead: result.lead });
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

// Open to every board caller: the scope gate inside the service decides which
// leads he may delete (exactly the ones he can read). 204 with no body.
leadsRouter.post('/:id/delete', async (c) => {
  const id = leadIdSchema.safeParse(c.req.param('id'));
  if (!id.success) return c.json({ error: 'not_found' }, 404);
  const result = await deleteLead(getDb(), c.get('orgId'), id.data, leadScope(c), leadActor(c));
  if (!result.ok) return failureResponse(c, result.reason);
  return c.body(null, 204);
});

// Admin only (requireAdmin, the one admin mechanism): a vendedor never sees the
// lixeira, so he can never bring a lead back either.
leadsRouter.post('/:id/restore', requireAdmin, async (c) => {
  const id = leadIdSchema.safeParse(c.req.param('id'));
  if (!id.success) return c.json({ error: 'not_found' }, 404);
  try {
    const result = await restoreLead(getDb(), c.get('orgId'), id.data, leadActor(c));
    if (!result.ok) return failureResponse(c, result.reason);
    return c.json({ lead: result.lead });
  } catch (error) {
    if (error instanceof LeadInputError) return leadInputErrorResponse(c, error);
    throw error;
  }
});
