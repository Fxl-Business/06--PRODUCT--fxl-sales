import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../../../db/client.js';
import { getSalesEdition } from '../../org-modules/context.js';
import { requireAdmin } from '../../../middleware/require-admin.js';
import { cadastroActor } from '../cadastro-actor.js';
import {
  AdvanceLeadSchema,
  LeadFollowupSchema,
  LeadNoteSchema,
  LeadPatchSchema,
  LeadStageSummaryQuerySchema,
  LeadWriteSchema,
  ListDeletedLeadsQuerySchema,
  ListLeadsQuerySchema,
  MoveLeadSchema,
} from './lead-schemas.js';
import {
  LeadInputError,
  type LeadScope,
  type WriteLeadResult,
  createLead,
  getLead,
  listLeads,
  moveLead,
  summarizeLeadStages,
  updateLead,
} from './lead-service.js';
import { LeadFilterError, parseDynamicFilters } from './lead-filters.js';
import { addLeadFollowup, addLeadNote, advanceLead, getLeadSummary } from './lead-history-service.js';
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
 * is a SOFT delete (a POST action like `/move`) that its actor or a gestor reverses with
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
export function leadActor(c: Context): LeadActor {
  const actor = cadastroActor(c);
  return { userId: actor.userId, name: actor.displayName };
}

export async function leadScope(c: Context): Promise<LeadScope> {
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
    edition: await getSalesEdition(c),
  };
}

/** A dynamic filter on an unknown or non-filterable field, or with a value its kind cannot take. */
function invalidFilterResponse(c: Context, error: LeadFilterError) {
  return c.json({ error: 'validation_error', reason: 'invalid_filter', filter: error.filter }, 400);
}

export function validationResponse(c: Context, error: z.ZodError) {
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
export function failureResponse(
  c: Context,
  reason:
    | 'not_found'
    | 'seller_scope'
    | 'seller_person_unmapped'
    | 'already_converted'
    | 'transition_not_allowed'
    | 'sale_required_for_conversion',
) {
  if (reason === 'not_found') return c.json({ error: 'not_found' }, 404);
  // The pair is absent from the pipeline graph (or the stage is another pipeline's), or the
  // destination opens a proposta that only the wizard may create.
  if (reason === 'transition_not_allowed' || reason === 'sale_required_for_conversion') {
    return c.json({ error: reason }, 409);
  }
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
export function leadInputErrorResponse(c: Context, error: LeadInputError) {
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
    pipelineId: c.req.query('pipelineId'),
    from: c.req.query('from'),
    to: c.req.query('to'),
  });
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  let filters;
  try {
    filters = parseDynamicFilters(c.req.query());
  } catch (error) {
    if (error instanceof LeadFilterError) return invalidFilterResponse(c, error);
    throw error;
  }
  try {
    const result = await listLeads(getDb(), c.get('orgId'), { ...parsed.data, ...(filters.length > 0 ? { filters } : {}) }, await leadScope(c));
    if (!result.ok) return failureResponse(c, result.reason);
    return c.json({ leads: result.leads, nextCursor: result.nextCursor, total: result.total });
  } catch (error) {
    if (error instanceof LeadFilterError) return invalidFilterResponse(c, error);
    throw error;
  }
});

leadsRouter.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = LeadWriteSchema.safeParse(body);
  if (!parsed.success) return validationResponse(c, parsed.error);
  let result: WriteLeadResult;
  try {
    result = await createLead(getDb(), c.get('orgId'), parsed.data, await leadScope(c));
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
    pipelineId: c.req.query('pipelineId'),
    from: c.req.query('from'),
    to: c.req.query('to'),
  });
  if (!parsed.success) return validationResponse(c, parsed.error);
  try {
    const filters = parseDynamicFilters(c.req.query());
    const result = await summarizeLeadStages(getDb(), c.get('orgId'), { ...parsed.data, ...(filters.length > 0 ? { filters } : {}) }, await leadScope(c));
    if (!result.ok) return failureResponse(c, result.reason);
    return c.json({ stages: result.stages });
  } catch (error) {
    if (error instanceof LeadFilterError) return invalidFilterResponse(c, error);
    throw error;
  }
});

leadsRouter.get('/:id', async (c) => {
  const id = leadIdSchema.safeParse(c.req.param('id'));
  if (!id.success) return c.json({ error: 'not_found' }, 404);
  const result = await getLead(getDb(), c.get('orgId'), id.data, await leadScope(c));
  if (!result.ok) return failureResponse(c, result.reason);
  return c.json({ lead: result.lead });
});

leadsRouter.patch('/:id', async (c) => {
  const id = leadIdSchema.safeParse(c.req.param('id'));
  if (!id.success) return c.json({ error: 'not_found' }, 404);
  const parsed = LeadPatchSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return validationResponse(c, parsed.error);
  let result: WriteLeadResult;
  try {
    result = await updateLead(getDb(), c.get('orgId'), id.data, parsed.data, await leadScope(c));
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
    const result = await moveLead(getDb(), c.get('orgId'), id.data, parsed.data, await leadScope(c));
    if (!result.ok) return failureResponse(c, result.reason);
    return c.json({ lead: result.lead });
  } catch (error) {
    if (error instanceof LeadInputError) return leadInputErrorResponse(c, error);
    throw error;
  }
});

/** GET /leads/:id/summary: stage, pipeline, the allowed next stages, the timeline and the follow-ups. */
leadsRouter.get('/:id/summary', async (c) => {
  const id = leadIdSchema.safeParse(c.req.param('id'));
  if (!id.success) return c.json({ error: 'not_found' }, 404);
  const result = await getLeadSummary(getDb(), c.get('orgId'), id.data, await leadScope(c));
  if (!result.ok) return failureResponse(c, result.reason);
  return c.json(result.summary);
});

/** POST /leads/:id/advance: the Avançar act. Same envelope as /move. */
leadsRouter.post('/:id/advance', async (c) => {
  const id = leadIdSchema.safeParse(c.req.param('id'));
  if (!id.success) return c.json({ error: 'not_found' }, 404);
  const parsed = AdvanceLeadSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return validationResponse(c, parsed.error);
  try {
    const result = await advanceLead(getDb(), c.get('orgId'), id.data, parsed.data, await leadScope(c));
    if (!result.ok) return failureResponse(c, result.reason);
    return c.json({ lead: result.lead });
  } catch (error) {
    if (error instanceof LeadInputError) return leadInputErrorResponse(c, error);
    throw error;
  }
});

leadsRouter.post('/:id/notes', async (c) => {
  const id = leadIdSchema.safeParse(c.req.param('id'));
  if (!id.success) return c.json({ error: 'not_found' }, 404);
  const parsed = LeadNoteSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return validationResponse(c, parsed.error);
  const result = await addLeadNote(getDb(), c.get('orgId'), id.data, parsed.data, await leadScope(c));
  if (!result.ok) return failureResponse(c, result.reason);
  return c.json({ note: result.note }, 201);
});

leadsRouter.post('/:id/followups', async (c) => {
  const id = leadIdSchema.safeParse(c.req.param('id'));
  if (!id.success) return c.json({ error: 'not_found' }, 404);
  const parsed = LeadFollowupSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return validationResponse(c, parsed.error);
  try {
    const result = await addLeadFollowup(getDb(), c.get('orgId'), id.data, parsed.data, await leadScope(c));
    if (!result.ok) return failureResponse(c, result.reason);
    return c.json({ followup: result.followup }, 201);
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
  const result = await deleteLead(getDb(), c.get('orgId'), id.data, await leadScope(c), leadActor(c));
  if (!result.ok) return failureResponse(c, result.reason);
  return c.body(null, 204);
});

// The actor may undo their own deletion; an admin may restore any org lead.
// The lixeira list above remains admin-only.
leadsRouter.post('/:id/restore', async (c) => {
  const id = leadIdSchema.safeParse(c.req.param('id'));
  if (!id.success) return c.json({ error: 'not_found' }, 404);
  try {
    const result = await restoreLead(getDb(), c.get('orgId'), id.data, (await leadScope(c)).isAdmin, leadActor(c));
    if (!result.ok) return failureResponse(c, result.reason);
    return c.json({ lead: result.lead });
  } catch (error) {
    if (error instanceof LeadInputError) return leadInputErrorResponse(c, error);
    throw error;
  }
});
