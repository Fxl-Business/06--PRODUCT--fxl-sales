import { Hono } from 'hono';
import { getDb } from '../../../db/client.js';
import { requireAdmin } from '../../../middleware/require-admin.js';
import { LeadStageSchema, ReorderLeadStagesSchema, UpdateLeadStageSchema } from './schemas.js';
import {
  createLeadStage,
  listLeadStages,
  reorderLeadStages,
  updateLeadStage,
} from './stage-service.js';

/**
 * The lead stage cadastro surface, mounted at '/' into salesOpsRouter because it
 * owns the whole `/lead-stages…` path.
 *
 * The export name is load-bearing and is NOT `leadsRouter`: the lead entity ships
 * its own `leads/lead-routes.ts` exporting `leadsRouter`, mounted separately at
 * '/leads'. Two distinct names is the resolution, and an import alias is
 * deliberately NOT, because an alias hides the fact that these are two different
 * routers and puts the disambiguation in the consumer.
 *
 * There is NO DELETE verb here and there must never be one: removal is
 * PATCH { status: 'archived' }, exactly as for áreas, produtos and funções.
 *
 * There is no cadastroActor either: a lead stage write appends NO audit_log
 * entry, so there is no actor to thread.
 */
export const leadStagesRouter = new Hono();

// Readable by any authenticated org member - the Kanban board and every stage
// picker need the list, and a seller has a board - but only an admin may create,
// rename, archive or reorder one. The same split as GET/POST /funcoes.
leadStagesRouter.get('/lead-stages', async (c) => {
  const stages = await listLeadStages(getDb(), c.get('orgId'));
  return c.json({ stages });
});

// Registered before POST /lead-stages for readability only; there is no
// POST /lead-stages/:id, so no route actually shadows another.
leadStagesRouter.post('/lead-stages/reorder', requireAdmin, async (c) => {
  const parsed = ReorderLeadStagesSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  const stages = await reorderLeadStages(getDb(), c.get('orgId'), parsed.data.stageIds);
  if (stages === 'set_mismatch') {
    return c.json({ error: 'validation_error', reason: 'stage_set_mismatch' }, 400);
  }
  return c.json({ stages });
});

leadStagesRouter.post('/lead-stages', requireAdmin, async (c) => {
  const parsed = LeadStageSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  const stage = await createLeadStage(getDb(), c.get('orgId'), parsed.data);
  if (stage === 'duplicate') return c.json({ error: 'conflict', reason: 'stage_name_taken' }, 409);
  return c.json({ stage }, 201);
});

leadStagesRouter.patch('/lead-stages/:id', requireAdmin, async (c) => {
  const parsed = UpdateLeadStageSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  const stage = await updateLeadStage(getDb(), c.get('orgId'), c.req.param('id'), parsed.data);
  if (stage === 'is_system') return c.json({ error: 'conflict', reason: 'stage_is_system' }, 409);
  if (stage === 'duplicate') return c.json({ error: 'conflict', reason: 'stage_name_taken' }, 409);
  if (!stage) return c.json({ error: 'not_found' }, 404);
  return c.json({ stage });
});
