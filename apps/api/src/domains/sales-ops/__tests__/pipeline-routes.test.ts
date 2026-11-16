/**
 * The pipeline routes of `crmRouter` (vários funis por organização), with the services mocked:
 * the admin gate on every write, the body contract, the refusal bodies and the access set that
 * `GET /pipelines` hands the read. The database behaviour (seven etapas, the graph, the default
 * pipeline that cannot be archived, the access rule) is proven by test/rls/pipeline-access.test.ts.
 */
import { ALL_MODULES_ENABLED } from '@fxl-sales/shared-utils/crm-model';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hubAuthContext as sharedHubAuthContext } from '../../../auth/__tests__/hub-auth-context-fixture.js';

const mockedDb = { name: 'pipeline-route-test-db' };
const mocks = vi.hoisted(() => ({
  listPipelines: vi.fn(),
  createPipeline: vi.fn(),
  updatePipeline: vi.fn(),
  resolveCallerPipelineAccess: vi.fn(),
}));

vi.mock('../../../db/client.js', () => ({ getDb: () => mockedDb }));

vi.mock('../../crm/crm-read-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../crm/crm-read-service.js')>();
  return { ...actual, listPipelines: mocks.listPipelines };
});

vi.mock('../../crm/pipeline-admin-service.js', () => ({
  createPipeline: mocks.createPipeline,
  updatePipeline: mocks.updatePipeline,
}));

vi.mock('../leads/lead-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../leads/lead-service.js')>();
  return { ...actual, resolveCallerPipelineAccess: mocks.resolveCallerPipelineAccess };
});

const { crmRouter } = await import('../crm-routes.js');

const PIPELINE_ID = '33333333-3333-4333-8333-333333333333';
const FUNCAO_ID = '44444444-4444-4444-8444-444444444444';

const pipelineView = {
  id: PIPELINE_ID,
  name: 'Financeiro',
  isDefault: false,
  position: 1,
  status: 'active',
  funcaoIds: [FUNCAO_ID],
  stages: [
    {
      id: '55555555-5555-4555-8555-555555555555',
      name: 'Proposta',
      position: 3,
      type: 'orcamento',
      behavior: 'opens_orcamentos',
      exitKind: null,
      requiresReason: false,
      status: 'active',
    },
  ],
  transitions: [],
};

let currentRole: 'admin' | 'seller' | undefined;
let currentModules = ALL_MODULES_ENABLED;

const app = new Hono();
app.use('*', async (c, next) => {
  c.set('userId', 'verified-account');
  c.set('orgId', 'verified-org');
  c.set('orgModules', currentModules);
  c.set('userRole', currentRole);
  c.set('userRoles', currentRole ? [currentRole] : []);
  c.set(
    'hubAuth',
    sharedHubAuthContext({ accountId: 'verified-account', workspaceId: 'verified-org', roles: { workspace: 'admin' } }),
  );
  await next();
});
app.route('/', crmRouter);

function send(method: 'POST' | 'PATCH' | 'GET', path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('pipeline routes', () => {
  beforeEach(() => {
    currentRole = 'admin';
    currentModules = ALL_MODULES_ENABLED;
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.listPipelines.mockResolvedValue([pipelineView]);
    mocks.createPipeline.mockResolvedValue(pipelineView);
    mocks.updatePipeline.mockResolvedValue(pipelineView);
    mocks.resolveCallerPipelineAccess.mockResolvedValue(null);
  });

  it.each([
    ['POST', '/pipelines', { name: 'Financeiro' }],
    ['PATCH', `/pipelines/${PIPELINE_ID}`, { name: 'Financeiro' }],
    ['PATCH', `/pipelines/${PIPELINE_ID}`, { status: 'archived' }],
    ['PATCH', `/pipelines/${PIPELINE_ID}`, { funcaoIds: [FUNCAO_ID] }],
  ] as const)('a non-admin gets the shared 403 on %s %s and nothing is written', async (method, path, body) => {
    for (const role of ['seller', undefined] as const) {
      currentRole = role;
      const res = await send(method, path, body);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'forbidden', reason: 'admin_role_required' });
    }
    expect(mocks.createPipeline).not.toHaveBeenCalled();
    expect(mocks.updatePipeline).not.toHaveBeenCalled();
  });

  it('POST creates with the trimmed name and the funções, org from the context only', async () => {
    const res = await send('POST', '/pipelines', { name: '  Financeiro  ', funcaoIds: [FUNCAO_ID] });
    expect(res.status).toBe(201);
    expect(mocks.createPipeline).toHaveBeenCalledWith(mockedDb, 'verified-org', { name: 'Financeiro', funcaoIds: [FUNCAO_ID] });
    expect((await res.json()).pipeline).toMatchObject({ id: PIPELINE_ID, funcaoIds: [FUNCAO_ID] });
  });

  it.each([
    [{}],
    [{ name: '' }],
    [{ name: 'Financeiro', isDefault: true }],
    [{ name: 'Financeiro', orgId: 'other-org' }],
    [{ name: 'Financeiro', funcaoIds: ['not-a-uuid'] }],
    [{ name: 'Financeiro', funcaoIds: [FUNCAO_ID, FUNCAO_ID] }],
  ])('POST refuses the body %j with 400 and writes nothing', async (body) => {
    const res = await send('POST', '/pipelines', body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('validation_error');
    expect(mocks.createPipeline).not.toHaveBeenCalled();
  });

  it.each([[{}], [{ position: 2 }], [{ status: 'deleted' }], [{ isDefault: false }]])(
    'PATCH refuses the body %j with 400',
    async (body) => {
      const res = await send('PATCH', `/pipelines/${PIPELINE_ID}`, body);
      expect(res.status).toBe(400);
      expect(mocks.updatePipeline).not.toHaveBeenCalled();
    },
  );

  it('maps every service refusal onto its body', async () => {
    mocks.createPipeline.mockResolvedValueOnce('duplicate');
    let res = await send('POST', '/pipelines', { name: 'Financeiro' });
    expect([res.status, await res.json()]).toEqual([409, { error: 'conflict', reason: 'pipeline_name_taken' }]);

    mocks.createPipeline.mockResolvedValueOnce('unknown_funcao');
    res = await send('POST', '/pipelines', { name: 'Financeiro', funcaoIds: [FUNCAO_ID] });
    expect([res.status, await res.json()]).toEqual([400, { error: 'validation_error', reason: 'unknown_funcao' }]);

    mocks.updatePipeline.mockResolvedValueOnce('is_default');
    res = await send('PATCH', `/pipelines/${PIPELINE_ID}`, { status: 'archived' });
    expect([res.status, await res.json()]).toEqual([409, { error: 'conflict', reason: 'pipeline_is_default' }]);

    mocks.updatePipeline.mockResolvedValueOnce('duplicate');
    res = await send('PATCH', `/pipelines/${PIPELINE_ID}`, { name: 'Comercial' });
    expect([res.status, await res.json()]).toEqual([409, { error: 'conflict', reason: 'pipeline_name_taken' }]);

    mocks.updatePipeline.mockResolvedValueOnce(null);
    res = await send('PATCH', `/pipelines/${PIPELINE_ID}`, { name: 'Comercial' });
    expect([res.status, await res.json()]).toEqual([404, { error: 'not_found' }]);

    res = await send('PATCH', '/pipelines/not-a-uuid', { name: 'Comercial' });
    expect(res.status).toBe(404);
  });

  it('projects the stage behaviour for the organization modules on every pipeline answer', async () => {
    currentModules = { ...ALL_MODULES_ENABLED, orcamentos: false };
    const created = await (await send('POST', '/pipelines', { name: 'Financeiro' })).json();
    expect(created.pipeline.stages[0].behavior).toBe('none');
    const listed = await (await send('GET', '/pipelines')).json();
    expect(listed.pipelines[0].stages[0].behavior).toBe('none');
  });

  it('GET /pipelines reads through the caller access gate, and only an admin may add the archived ones', async () => {
    await send('GET', '/pipelines?includeArchived=true');
    let options = mocks.listPipelines.mock.calls[0]![2];
    expect(options.includeArchived).toBe(true);
    const tx = { name: 'tx' };
    await options.reachable(tx);
    expect(mocks.resolveCallerPipelineAccess).toHaveBeenCalledWith(tx, 'verified-org', expect.objectContaining({ isAdmin: true }));

    currentRole = 'seller';
    await send('GET', '/pipelines?includeArchived=true');
    options = mocks.listPipelines.mock.calls[1]![2];
    expect(options.includeArchived).toBe(false);
    await options.reachable(tx);
    expect(mocks.resolveCallerPipelineAccess).toHaveBeenLastCalledWith(tx, 'verified-org', expect.objectContaining({ isAdmin: false }));
  });
});
