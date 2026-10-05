/**
 * The pessoa HTTP boundary per edition (edicao-leads, SEAM A3 and A8).
 *
 * Same harness as `routes.test.ts`. The leads edition must hand the service an
 * explicit `{ edition: 'leads' }` trailing argument; the full edition, and an
 * absent edition, must keep today's exact call arity (3 args for create, 5 for
 * update), which is what keeps the existing toHaveBeenCalledWith oracles green.
 */
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hubAuthContext as sharedHubAuthContext } from '../../../auth/__tests__/hub-auth-context-fixture.js';

const mockedDb = { name: 'sales-ops-people-edition-test-db' };
const serviceMocks = vi.hoisted(() => ({
  createPerson: vi.fn(),
  updatePerson: vi.fn(),
}));

vi.mock('../../../db/client.js', () => ({
  getDb: () => mockedDb,
}));

vi.mock('../service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../service.js')>();
  return { ...actual, ...serviceMocks };
});

const { salesOpsRouter } = await import('../routes.js');

const PERSON_ID = '11111111-1111-4111-8111-111111111111';
const FUNCAO_ID = '77777777-7777-4777-8777-777777777777';
const VERIFIED_ACTOR = { userId: 'verified-account', displayName: 'Ana Verificada' };

const personResult = {
  id: PERSON_ID,
  orgId: 'verified-org',
  displayName: 'Ana',
  contactEmail: null,
  status: 'active',
  isSeller: true,
  isFinder: false,
  isCollaborator: false,
  funcoes: [],
  funcaoIds: [],
};

let currentRole: 'admin' | 'seller';
let currentEdition: 'full' | 'leads' | undefined;

function createTestApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', 'verified-account');
    c.set('orgId', 'verified-org');
    c.set('userRole', currentRole);
    c.set('userRoles', [currentRole]);
    c.set(
      'hubAuth',
      sharedHubAuthContext({
        accountId: 'verified-account',
        workspaceId: 'verified-org',
        roles: { workspace: 'admin' },
        name: 'Ana Verificada',
      }),
    );
    if (currentEdition !== undefined) c.set('salesEdition', currentEdition);
    await next();
  });
  app.route('/', salesOpsRouter);
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

const createBody = { displayName: 'Ana', funcaoIds: [FUNCAO_ID] };

describe('Sales Ops people routes per sales edition', () => {
  beforeEach(() => {
    currentRole = 'admin';
    currentEdition = 'leads';
    serviceMocks.createPerson.mockReset();
    serviceMocks.updatePerson.mockReset();
    serviceMocks.createPerson.mockResolvedValue(personResult);
    serviceMocks.updatePerson.mockResolvedValue(personResult);
  });

  it('leads: POST /people passes { edition: leads } as a fourth argument', async () => {
    const response = await jsonRequest('POST', '/people', createBody);
    expect(response.status).toBe(201);
    expect(serviceMocks.createPerson).toHaveBeenCalledWith(
      mockedDb,
      'verified-org',
      expect.objectContaining({ displayName: 'Ana', funcaoIds: [FUNCAO_ID] }),
      { edition: 'leads' },
    );
    expect(serviceMocks.createPerson.mock.calls[0]).toHaveLength(4);
  });

  it('full: POST /people keeps the three-argument call', async () => {
    currentEdition = 'full';
    const response = await jsonRequest('POST', '/people', createBody);
    expect(response.status).toBe(201);
    expect(serviceMocks.createPerson.mock.calls[0]).toHaveLength(3);
  });

  it('absent edition: POST /people keeps the three-argument call', async () => {
    currentEdition = undefined;
    const response = await jsonRequest('POST', '/people', createBody);
    expect(response.status).toBe(201);
    expect(serviceMocks.createPerson.mock.calls[0]).toHaveLength(3);
  });

  it('leads: PATCH /people/:id passes { edition: leads } as a sixth argument', async () => {
    const response = await jsonRequest('PATCH', `/people/${PERSON_ID}`, { displayName: 'Ana' });
    expect(response.status).toBe(200);
    expect(serviceMocks.updatePerson).toHaveBeenCalledWith(
      mockedDb,
      'verified-org',
      PERSON_ID,
      { displayName: 'Ana' },
      VERIFIED_ACTOR,
      { edition: 'leads' },
    );
    expect(serviceMocks.updatePerson.mock.calls[0]).toHaveLength(6);
  });

  it('full: PATCH /people/:id keeps the five-argument call', async () => {
    currentEdition = 'full';
    const response = await jsonRequest('PATCH', `/people/${PERSON_ID}`, { displayName: 'Ana' });
    expect(response.status).toBe(200);
    expect(serviceMocks.updatePerson.mock.calls[0]).toHaveLength(5);
  });

  it('leads: a seller still gets 403 admin_role_required and no service call', async () => {
    currentRole = 'seller';
    const created = await jsonRequest('POST', '/people', createBody);
    expect(created.status).toBe(403);
    expect(await created.json()).toEqual({ error: 'forbidden', reason: 'admin_role_required' });
    const updated = await jsonRequest('PATCH', `/people/${PERSON_ID}`, { displayName: 'Ana' });
    expect(updated.status).toBe(403);
    expect(serviceMocks.createPerson).not.toHaveBeenCalled();
    expect(serviceMocks.updatePerson).not.toHaveBeenCalled();
  });

  it('leads: a status-only PATCH reaches the service with no funcaoIds', async () => {
    const response = await jsonRequest('PATCH', `/people/${PERSON_ID}`, { status: 'inactive' });
    expect(response.status).toBe(200);
    expect(serviceMocks.updatePerson.mock.calls[0]![3]).toEqual({ status: 'inactive' });
    expect(serviceMocks.updatePerson.mock.calls[0]![5]).toEqual({ edition: 'leads' });
  });
});
