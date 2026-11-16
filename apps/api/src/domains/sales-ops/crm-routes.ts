import { effectiveStageBehavior, type OrgModules } from '@fxl-sales/shared-utils/crm-model';
import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../../db/client.js';
import { ADMIN_ROLE_REQUIRED_BODY, hasAdminRole, requireAdmin } from '../../middleware/require-admin.js';
import { listFieldDefinitions, listPipelines, type PipelineView } from '../crm/crm-read-service.js';
import { createPipeline, updatePipeline } from '../crm/pipeline-admin-service.js';
import { CreatePipelineSchema, UpdatePipelineSchema } from '../crm/pipeline-schemas.js';
import { getOrgModules } from '../org-modules/context.js';
import { listFollowups, markFollowupDone } from './leads/lead-history-service.js';
import { ListFollowupsQuerySchema } from './leads/lead-schemas.js';
import { failureResponse, leadScope, validationResponse } from './leads/lead-routes.js';
import { resolveCallerPipelineAccess } from './leads/lead-service.js';

/**
 * The CRM configuration and the follow-up list, mounted at '/' into salesOpsRouter.
 *
 * Field definitions are read-only (onboarding of fields is out of scope), so the Cliente system
 * field can never be removed or archived through any route. Pipelines are read by every board
 * caller, filtered to the pipelines the caller reaches (vários funis), and written only by an
 * admin: `POST /pipelines` creates one with the seven default etapas, `PATCH /pipelines/:id`
 * renames it, sets the funções that reach it and archives or restores it. There is no DELETE.
 * Every route takes the org from `c.get('orgId')` only.
 */
export const crmRouter = new Hono();

/** The stored behaviour as this organization's modules let it act (see 11c). */
function projectPipeline(pipeline: PipelineView, modules: OrgModules): PipelineView {
  return {
    ...pipeline,
    stages: pipeline.stages.map((stage) => ({ ...stage, behavior: effectiveStageBehavior(stage, modules) })),
  };
}

const pipelineIdSchema = z.string().uuid();

/**
 * Only the pipelines the caller reaches: every one for an admin, else the ones linked to the
 * caller's funções (the default one when none is). `?includeArchived=true` adds the archived
 * pipelines for an admin (the Funis e etapas restore list) and is ignored for anyone else.
 */
crmRouter.get('/pipelines', async (c) => {
  const modules = await getOrgModules(c);
  const scope = await leadScope(c);
  const pipelines = await listPipelines(getDb(), c.get('orgId'), {
    reachable: (tx) => resolveCallerPipelineAccess(tx, c.get('orgId'), scope),
    includeArchived: scope.isAdmin && c.req.query('includeArchived') === 'true',
  });
  return c.json({ pipelines: pipelines.map((pipeline) => projectPipeline(pipeline, modules)) });
});

crmRouter.post('/pipelines', requireAdmin, async (c) => {
  const parsed = CreatePipelineSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return validationResponse(c, parsed.error);
  const result = await createPipeline(getDb(), c.get('orgId'), parsed.data);
  if (result === 'duplicate') return c.json({ error: 'conflict', reason: 'pipeline_name_taken' }, 409);
  if (result === 'unknown_funcao') return c.json({ error: 'validation_error', reason: 'unknown_funcao' }, 400);
  if (result === 'is_default') return c.json({ error: 'conflict', reason: 'pipeline_is_default' }, 409);
  return c.json({ pipeline: projectPipeline(result, await getOrgModules(c)) }, 201);
});

crmRouter.patch('/pipelines/:id', requireAdmin, async (c) => {
  const id = pipelineIdSchema.safeParse(c.req.param('id'));
  if (!id.success) return c.json({ error: 'not_found' }, 404);
  const parsed = UpdatePipelineSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return validationResponse(c, parsed.error);
  const result = await updatePipeline(getDb(), c.get('orgId'), id.data, parsed.data);
  if (result === null) return c.json({ error: 'not_found' }, 404);
  if (result === 'duplicate') return c.json({ error: 'conflict', reason: 'pipeline_name_taken' }, 409);
  if (result === 'unknown_funcao') return c.json({ error: 'validation_error', reason: 'unknown_funcao' }, 400);
  if (result === 'is_default') return c.json({ error: 'conflict', reason: 'pipeline_is_default' }, 409);
  return c.json({ pipeline: projectPipeline(result, await getOrgModules(c)) });
});

crmRouter.get('/field-definitions', async (c) => {
  const fields = await listFieldDefinitions(getDb(), c.get('orgId'));
  return c.json({ fields });
});

/** `team` needs an admin and answers the shared 403 body; `mine` is the caller's own. */
crmRouter.get('/followups', async (c) => {
  const parsed = ListFollowupsQuerySchema.safeParse({
    scope: c.req.query('scope'),
    status: c.req.query('status'),
    from: c.req.query('from'),
    to: c.req.query('to'),
    limit: c.req.query('limit'),
  });
  if (!parsed.success) return validationResponse(c, parsed.error);
  if (parsed.data.scope === 'team' && !hasAdminRole(c)) return c.json(ADMIN_ROLE_REQUIRED_BODY, 403);
  const result = await listFollowups(getDb(), c.get('orgId'), parsed.data, await leadScope(c));
  if (!result.ok) return failureResponse(c, result.reason);
  return c.json({ followups: result.followups });
});

crmRouter.post('/followups/:id/done', async (c) => {
  const id = z.string().uuid().safeParse(c.req.param('id'));
  if (!id.success) return c.json({ error: 'not_found' }, 404);
  const result = await markFollowupDone(getDb(), c.get('orgId'), id.data, await leadScope(c));
  if (!result.ok) return failureResponse(c, result.reason);
  return c.json({ followup: result.followup });
});
