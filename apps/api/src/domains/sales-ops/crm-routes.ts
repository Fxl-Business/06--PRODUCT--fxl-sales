import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../../db/client.js';
import { ADMIN_ROLE_REQUIRED_BODY, hasAdminRole } from '../../middleware/require-admin.js';
import { listFieldDefinitions, listPipelines } from '../crm/crm-read-service.js';
import { listFollowups, markFollowupDone } from './leads/lead-history-service.js';
import { ListFollowupsQuerySchema } from './leads/lead-schemas.js';
import { failureResponse, leadScope, validationResponse } from './leads/lead-routes.js';

/**
 * The CRM configuration reads and the follow-up list, mounted at '/' into salesOpsRouter.
 *
 * Read-only on purpose. There is no POST, PATCH or DELETE for pipelines or field definitions in
 * this run (onboarding is out of scope), so the Cliente system field can never be removed or
 * archived through any route. Every read takes the org from `c.get('orgId')` only.
 */
export const crmRouter = new Hono();

crmRouter.get('/pipelines', async (c) => {
  const pipelines = await listPipelines(getDb(), c.get('orgId'));
  return c.json({ pipelines });
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
  const result = await listFollowups(getDb(), c.get('orgId'), parsed.data, leadScope(c));
  if (!result.ok) return failureResponse(c, result.reason);
  return c.json({ followups: result.followups });
});

crmRouter.post('/followups/:id/done', async (c) => {
  const id = z.string().uuid().safeParse(c.req.param('id'));
  if (!id.success) return c.json({ error: 'not_found' }, 404);
  const result = await markFollowupDone(getDb(), c.get('orgId'), id.data, leadScope(c));
  if (!result.ok) return failureResponse(c, result.reason);
  return c.json({ followup: result.followup });
});
