import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hubAuthContext as sharedHubAuthContext } from '../../../auth/__tests__/hub-auth-context-fixture.js';

const mockedDb = { name: 'lead-stage-route-test-db' };
const serviceMocks = vi.hoisted(() => ({
  listLeadStages: vi.fn(),
  createLeadStage: vi.fn(),
  updateLeadStage: vi.fn(),
  reorderLeadStages: vi.fn(),
}));

vi.mock('../../../db/client.js', () => ({
  getDb: () => mockedDb,
}));

vi.mock('../leads/stage-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../leads/stage-service.js')>();
  return {
    ...actual,
    listLeadStages: serviceMocks.listLeadStages,
    createLeadStage: serviceMocks.createLeadStage,
    updateLeadStage: serviceMocks.updateLeadStage,
    reorderLeadStages: serviceMocks.reorderLeadStages,
  };
});

const { leadStagesRouter } = await import('../leads/stage-routes.js');

type TestRole = 'admin' | 'seller' | 'finder' | undefined;

const STAGE_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_STAGE_ID = '44444444-4444-4444-8444-444444444444';

const stageResult = {
  id: STAGE_ID,
  orgId: 'verified-org',
  name: 'Qualificação',
  kind: 'normal',
  isSystem: false,
  position: 4,
  status: 'active',
  archivedAt: null,
};

let currentRole: TestRole;

function createTestApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', 'verified-account');
    c.set('orgId', 'verified-org');
    c.set('userRole', currentRole);
    c.set('userRoles', currentRole ? [currentRole] : []);
    c.set(
      'hubAuth',
      sharedHubAuthContext({
        accountId: 'verified-account',
        workspaceId: 'verified-org',
        roles: { workspace: 'admin' },
      }),
    );
    await next();
  });
  app.route('/', leadStagesRouter);
  return app;
}

const app = createTestApp();

function jsonRequest(method: 'POST' | 'PATCH', path: string, body: unknown) {
  return app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Sales Ops lead stage routes', () => {
  beforeEach(() => {
    currentRole = 'admin';
    for (const mock of Object.values(serviceMocks)) mock.mockReset();
    serviceMocks.listLeadStages.mockResolvedValue([stageResult]);
    serviceMocks.createLeadStage.mockResolvedValue(stageResult);
    serviceMocks.updateLeadStage.mockResolvedValue(stageResult);
    serviceMocks.reorderLeadStages.mockResolvedValue([stageResult]);
  });

  // The Kanban board and every stage picker need the list, and a seller has a
  // board. Putting requireAdmin on the read 403s the board for every seller.
  it.each(['seller', 'finder'] as const)('keeps GET /lead-stages available to %s', async (role) => {
    currentRole = role;
    const response = await app.request('/lead-stages');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ stages: [stageResult] });
    expect(serviceMocks.listLeadStages).toHaveBeenCalledWith(mockedDb, 'verified-org');
  });

  it.each(['seller', 'finder', undefined] as const)(
    'refuses POST /lead-stages to a non-admin with 403 admin_role_required',
    async (role) => {
      currentRole = role;
      const response = await jsonRequest('POST', '/lead-stages', { name: 'Qualificação' });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'forbidden', reason: 'admin_role_required' });
      // The "never called" half is what makes this decisive rather than
      // incidental - a 403 could otherwise come from anywhere.
      expect(serviceMocks.createLeadStage).not.toHaveBeenCalled();
    },
  );

  it.each(['seller', 'finder', undefined] as const)(
    'refuses PATCH /lead-stages/:id to a non-admin with 403 admin_role_required',
    async (role) => {
      currentRole = role;
      const response = await jsonRequest('PATCH', `/lead-stages/${STAGE_ID}`, { name: 'Novo' });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'forbidden', reason: 'admin_role_required' });
      expect(serviceMocks.updateLeadStage).not.toHaveBeenCalled();
    },
  );

  it.each(['seller', 'finder', undefined] as const)(
    'refuses POST /lead-stages/reorder to a non-admin with 403 admin_role_required',
    async (role) => {
      currentRole = role;
      const response = await jsonRequest('POST', '/lead-stages/reorder', {
        stageIds: [STAGE_ID, OTHER_STAGE_ID],
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'forbidden', reason: 'admin_role_required' });
      expect(serviceMocks.reorderLeadStages).not.toHaveBeenCalled();
    },
  );

  it('never trusts orgId, kind or isSystem from a lead stage request body', async () => {
    const response = await jsonRequest('POST', '/lead-stages', {
      name: '  Qualificação  ',
      orgId: 'body-org-must-not-be-used',
      kind: 'conversion',
      isSystem: true,
      position: 0,
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ stage: stageResult });
    // A LITERAL third argument, not expect.objectContaining: that is what makes
    // this decisive against `{ ...parsed.data, ...body }`.
    expect(serviceMocks.createLeadStage).toHaveBeenCalledWith(mockedDb, 'verified-org', {
      name: 'Qualificação',
      status: 'active',
    });
  });

  it('maps a system stage patch to 409 stage_is_system', async () => {
    serviceMocks.updateLeadStage.mockResolvedValue('is_system');
    const response = await jsonRequest('PATCH', `/lead-stages/${STAGE_ID}`, { name: 'Proposta 2' });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'conflict', reason: 'stage_is_system' });
  });

  it('maps a duplicate stage name to 409 stage_name_taken', async () => {
    serviceMocks.createLeadStage.mockResolvedValue('duplicate');
    const created = await jsonRequest('POST', '/lead-stages', { name: 'Novo' });
    expect(created.status).toBe(409);
    // toEqual on the WHOLE body is what says there is no second conflict reason
    // on this surface: no stage_slug_taken, no code, no message.
    expect(await created.json()).toEqual({ error: 'conflict', reason: 'stage_name_taken' });

    serviceMocks.updateLeadStage.mockResolvedValue('duplicate');
    const patched = await jsonRequest('PATCH', `/lead-stages/${STAGE_ID}`, { name: 'Novo' });
    expect(patched.status).toBe(409);
    expect(await patched.json()).toEqual({ error: 'conflict', reason: 'stage_name_taken' });
  });

  it('returns 404 when PATCH /lead-stages/:id targets another org', async () => {
    serviceMocks.updateLeadStage.mockResolvedValue(null);
    const response = await jsonRequest('PATCH', `/lead-stages/${OTHER_STAGE_ID}`, { name: 'Novo' });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
  });

  it('maps a reorder set mismatch to 400 validation_error stage_set_mismatch', async () => {
    serviceMocks.reorderLeadStages.mockResolvedValue('set_mismatch');
    const response = await jsonRequest('POST', '/lead-stages/reorder', { stageIds: [STAGE_ID] });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'validation_error',
      reason: 'stage_set_mismatch',
    });
  });

  it('reorders through the service with the verified org and the parsed id list', async () => {
    const response = await jsonRequest('POST', '/lead-stages/reorder', {
      stageIds: [OTHER_STAGE_ID, STAGE_ID],
      orgId: 'body-org-must-not-be-used',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ stages: [stageResult] });
    expect(serviceMocks.reorderLeadStages).toHaveBeenCalledWith(mockedDb, 'verified-org', [
      OTHER_STAGE_ID,
      STAGE_ID,
    ]);
  });

  it('archives a lead stage through PATCH rather than a DELETE verb', async () => {
    const response = await jsonRequest('PATCH', `/lead-stages/${STAGE_ID}`, {
      status: 'archived',
    });
    expect(response.status).toBe(200);
    expect(serviceMocks.updateLeadStage).toHaveBeenCalledWith(mockedDb, 'verified-org', STAGE_ID, {
      status: 'archived',
    });
  });

  it('has no DELETE route for lead stages', async () => {
    const response = await app.request(`/lead-stages/${STAGE_ID}`, { method: 'DELETE' });
    expect(response.status).toBe(404);
  });

  it('rejects a blank lead stage name before service execution', async () => {
    const response = await jsonRequest('POST', '/lead-stages', { name: '   ' });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('validation_error');
    expect(serviceMocks.createLeadStage).not.toHaveBeenCalled();
  });

  it('rejects a missing lead stage body with 400 rather than 500', async () => {
    const response = await app.request('/lead-stages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    expect(response.status).toBe(400);
    expect(serviceMocks.createLeadStage).not.toHaveBeenCalled();
  });
});
