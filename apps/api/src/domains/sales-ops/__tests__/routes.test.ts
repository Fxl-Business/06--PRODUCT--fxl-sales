import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockedDb = { name: 'sales-ops-route-test-db' };
const serviceMocks = vi.hoisted(() => ({
  createPerson: vi.fn(),
  listPeople: vi.fn(),
  updatePerson: vi.fn(),
  listAreas: vi.fn(),
  createArea: vi.fn(),
  updateArea: vi.fn(),
  getArea: vi.fn(),
  listFuncoes: vi.fn(),
  createFuncao: vi.fn(),
  updateFuncao: vi.fn(),
  getFuncao: vi.fn(),
  createProduct: vi.fn(),
  createSale: vi.fn(),
  updateSale: vi.fn(),
}));

vi.mock('../../../db/client.js', () => ({
  getDb: () => mockedDb,
}));

vi.mock('../service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../service.js')>();
  return {
    ...actual,
    createPerson: serviceMocks.createPerson,
    listPeople: serviceMocks.listPeople,
    updatePerson: serviceMocks.updatePerson,
    listAreas: serviceMocks.listAreas,
    createArea: serviceMocks.createArea,
    updateArea: serviceMocks.updateArea,
    getArea: serviceMocks.getArea,
    listFuncoes: serviceMocks.listFuncoes,
    createFuncao: serviceMocks.createFuncao,
    updateFuncao: serviceMocks.updateFuncao,
    getFuncao: serviceMocks.getFuncao,
    createProduct: serviceMocks.createProduct,
    createSale: serviceMocks.createSale,
    updateSale: serviceMocks.updateSale,
  };
});

const { salesOpsRouter } = await import('../routes.js');

type TestRole = 'admin' | 'seller' | 'finder' | undefined;

const personPayload = {
  displayName: 'Alex Silva',
  contactEmail: 'alex.silva@fxl.example',
  status: 'active' as const,
  isSeller: true,
  isFinder: false,
  isCollaborator: false,
  orgId: 'body-org-must-not-be-used',
  workspaceId: 'body-workspace-must-not-be-used',
};

const personResult = {
  id: '11111111-1111-4111-8111-111111111111',
  orgId: 'verified-org',
  displayName: personPayload.displayName,
  contactEmail: personPayload.contactEmail,
  status: personPayload.status,
  isSeller: personPayload.isSeller,
  isFinder: personPayload.isFinder,
  isCollaborator: personPayload.isCollaborator,
};

let currentRole: TestRole;

function createTestApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', 'verified-account');
    c.set('orgId', 'verified-org');
    c.set('userRole', currentRole);
    c.set('userRoles', currentRole ? [currentRole] : []);
    await next();
  });
  app.route('/', salesOpsRouter);
  return app;
}

const app = createTestApp();

function jsonRequest(method: 'POST' | 'PATCH', path: string) {
  return app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(personPayload),
  });
}

function jsonRequestWithBody(method: 'POST' | 'PATCH', path: string, body: unknown) {
  return app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const areaPayload = {
  name: 'FXL Tech',
  status: 'active' as const,
  orgId: 'body-org-must-not-be-used',
};

const areaResult = {
  id: '22222222-2222-4222-8222-222222222222',
  orgId: 'verified-org',
  name: 'FXL Tech',
  status: 'active' as const,
};

const funcaoPayload = {
  name: 'Desenvolvedor',
  status: 'active' as const,
  slug: 'vendedor',
  isSystem: true,
  orgId: 'body-org-must-not-be-used',
  workspaceId: 'body-workspace-must-not-be-used',
};

const funcaoResult = {
  id: '77777777-7777-4777-8777-777777777777',
  orgId: 'verified-org',
  name: 'Desenvolvedor',
  slug: 'desenvolvedor',
  isSystem: false,
  status: 'active' as const,
};

const productPayload = {
  name: 'Commission scenarios',
  areaId: '33333333-3333-4333-8333-333333333333',
  sellerCommissionType: 'pct' as const,
  sellerCommissionValue: 10,
  finderCommissionType: 'pct' as const,
  finderCommissionValue: 3,
};

const productResult = {
  id: '44444444-4444-4444-8444-444444444444',
  orgId: 'verified-org',
  ...productPayload,
};

const salePayload = {
  clientId: '11111111-1111-4111-8111-111111111111',
  clientName: 'SegPro',
  sellerPersonId: '22222222-2222-4222-8222-222222222222',
  sellerName: 'Ana Martins',
  status: 'open' as const,
  baseDate: '2026-07-14',
  sellerCommissionPct: 10,
  finderCommissionPct: 3,
  taxPct: 6,
  otherCostsBrl: 0,
  items: [
    {
      productId: '44444444-4444-4444-8444-444444444444',
      productName: 'Módulo Vendas',
      quantity: 1,
      unitBrl: 400000,
    },
  ],
  professionals: [],
  installments: [{ dueDate: '2026-07-14', amountBrl: 400000, method: 'pix' as const }],
};

const saleResult = {
  sale: { id: '55555555-5555-4555-8555-555555555555', code: '0001-01' },
  ledger: { sale: { totalBrl: 400000 } },
  payables: [],
};

beforeEach(() => {
  currentRole = undefined;
  vi.clearAllMocks();
  serviceMocks.listPeople.mockResolvedValue([personResult]);
  serviceMocks.createPerson.mockResolvedValue(personResult);
  serviceMocks.updatePerson.mockResolvedValue(personResult);
  serviceMocks.listAreas.mockResolvedValue([areaResult]);
  serviceMocks.createArea.mockResolvedValue(areaResult);
  serviceMocks.updateArea.mockResolvedValue(areaResult);
  serviceMocks.getArea.mockResolvedValue(areaResult);
  serviceMocks.listFuncoes.mockResolvedValue([funcaoResult]);
  serviceMocks.createFuncao.mockResolvedValue(funcaoResult);
  serviceMocks.updateFuncao.mockResolvedValue(funcaoResult);
  serviceMocks.getFuncao.mockResolvedValue(funcaoResult);
  serviceMocks.createProduct.mockResolvedValue(productResult);
  serviceMocks.createSale.mockResolvedValue(saleResult);
  serviceMocks.updateSale.mockResolvedValue({ ok: true, sale: saleResult.sale, ledger: saleResult.ledger });
});

describe('Sales Ops people routes', () => {
  it.each(['seller', 'finder'] as const)('keeps GET /people available to %s', async (role) => {
    currentRole = role;

    const response = await app.request('/people');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ people: [personResult] });
    expect(serviceMocks.listPeople).toHaveBeenCalledWith(mockedDb, 'verified-org');
  });

  it.each(['seller', 'finder', undefined] as const)(
    'rejects POST /people for role %s before service execution',
    async (role) => {
      currentRole = role;

      const response = await jsonRequest('POST', '/people');

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: 'forbidden',
        reason: 'admin_role_required',
      });
      expect(serviceMocks.createPerson).not.toHaveBeenCalled();
    },
  );

  it.each(['seller', 'finder', undefined] as const)(
    'rejects PATCH /people/:id for role %s before service execution',
    async (role) => {
      currentRole = role;

      const response = await jsonRequest(
        'PATCH',
        '/people/11111111-1111-4111-8111-111111111111',
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: 'forbidden',
        reason: 'admin_role_required',
      });
      expect(serviceMocks.updatePerson).not.toHaveBeenCalled();
    },
  );

  it('allows an admin to create a person with the verified org context', async () => {
    currentRole = 'admin';

    const response = await jsonRequest('POST', '/people');

    expect(response.status).toBe(201);
    expect(serviceMocks.createPerson).toHaveBeenCalledWith(
      mockedDb,
      'verified-org',
      expect.not.objectContaining({ orgId: expect.anything(), workspaceId: expect.anything() }),
    );
  });

  it('allows an admin to update a person with the verified org context', async () => {
    currentRole = 'admin';

    const response = await jsonRequest(
      'PATCH',
      '/people/11111111-1111-4111-8111-111111111111',
    );

    expect(response.status).toBe(200);
    expect(serviceMocks.updatePerson).toHaveBeenCalledWith(
      mockedDb,
      'verified-org',
      '11111111-1111-4111-8111-111111111111',
      expect.not.objectContaining({ orgId: expect.anything(), workspaceId: expect.anything() }),
    );
  });
});

describe('Sales Ops area routes', () => {
  it('lists areas for the verified org', async () => {
    const response = await app.request('/areas');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ areas: [areaResult] });
    expect(serviceMocks.listAreas).toHaveBeenCalledWith(mockedDb, 'verified-org');
  });

  it('creates an area with the verified org context and strips body org ids', async () => {
    const response = await jsonRequestWithBody('POST', '/areas', areaPayload);

    expect(response.status).toBe(201);
    expect(serviceMocks.createArea).toHaveBeenCalledWith(
      mockedDb,
      'verified-org',
      expect.not.objectContaining({ orgId: expect.anything() }),
    );
  });

  it('returns 409 when the area name already exists', async () => {
    serviceMocks.createArea.mockResolvedValueOnce('duplicate');

    const response = await jsonRequestWithBody('POST', '/areas', areaPayload);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'conflict', reason: 'area_name_taken' });
  });

  it('returns 404 when patching an unknown area', async () => {
    serviceMocks.updateArea.mockResolvedValueOnce(null);

    const response = await jsonRequestWithBody(
      'PATCH',
      '/areas/22222222-2222-4222-8222-222222222222',
      { name: 'FXL Tech' },
    );

    expect(response.status).toBe(404);
  });

  it('rejects a blank area name before service execution', async () => {
    const response = await jsonRequestWithBody('POST', '/areas', { name: '' });

    expect(response.status).toBe(400);
    expect(serviceMocks.createArea).not.toHaveBeenCalled();
  });
});

describe('Sales Ops funções routes', () => {
  const funcaoId = '77777777-7777-4777-8777-777777777777';

  it.each(['seller', 'finder'] as const)('keeps GET /funcoes available to %s', async (role) => {
    currentRole = role;

    const response = await app.request('/funcoes');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ funcoes: [funcaoResult] });
    expect(serviceMocks.listFuncoes).toHaveBeenCalledWith(mockedDb, 'verified-org');
  });

  it.each(['seller', 'finder', undefined] as const)(
    'rejects POST /funcoes for role %s before service execution',
    async (role) => {
      currentRole = role;

      const response = await jsonRequestWithBody('POST', '/funcoes', funcaoPayload);

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: 'forbidden',
        reason: 'admin_role_required',
      });
      expect(serviceMocks.createFuncao).not.toHaveBeenCalled();
    },
  );

  it.each(['seller', 'finder', undefined] as const)(
    'rejects PATCH /funcoes/:id for role %s before service execution',
    async (role) => {
      currentRole = role;

      const response = await jsonRequestWithBody('PATCH', `/funcoes/${funcaoId}`, {
        name: 'Designer',
      });

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: 'forbidden',
        reason: 'admin_role_required',
      });
      expect(serviceMocks.updateFuncao).not.toHaveBeenCalled();
    },
  );

  it('never trusts orgId, slug, or isSystem from a função request body', async () => {
    currentRole = 'admin';

    const response = await jsonRequestWithBody('POST', '/funcoes', funcaoPayload);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ funcao: funcaoResult });
    expect(serviceMocks.createFuncao).toHaveBeenCalledWith(mockedDb, 'verified-org', {
      name: 'Desenvolvedor',
      status: 'active',
    });
  });

  it('rejects a blank função name before service execution', async () => {
    currentRole = 'admin';

    const response = await jsonRequestWithBody('POST', '/funcoes', { name: '   ' });

    expect(response.status).toBe(400);
    expect(serviceMocks.createFuncao).not.toHaveBeenCalled();
  });

  it('maps a duplicate função name to 409 funcao_name_taken', async () => {
    currentRole = 'admin';
    serviceMocks.createFuncao.mockResolvedValueOnce('duplicate');

    const response = await jsonRequestWithBody('POST', '/funcoes', funcaoPayload);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'conflict', reason: 'funcao_name_taken' });
  });

  it('maps a colliding derived slug to 409 funcao_slug_taken', async () => {
    currentRole = 'admin';
    serviceMocks.createFuncao.mockResolvedValueOnce('duplicate_slug');

    const response = await jsonRequestWithBody('POST', '/funcoes', funcaoPayload);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'conflict', reason: 'funcao_slug_taken' });
  });

  it('maps a reserved derived slug to 400 reserved_funcao_slug', async () => {
    currentRole = 'admin';
    serviceMocks.createFuncao.mockResolvedValueOnce('reserved_slug');

    const response = await jsonRequestWithBody('POST', '/funcoes', { name: 'Vendedor' });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'validation_error',
      reason: 'reserved_funcao_slug',
    });
  });

  it('maps a system função patch to 409 funcao_is_system', async () => {
    currentRole = 'admin';
    serviceMocks.updateFuncao.mockResolvedValueOnce('is_system');

    const response = await jsonRequestWithBody('PATCH', `/funcoes/${funcaoId}`, {
      status: 'archived',
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'conflict', reason: 'funcao_is_system' });
  });

  it('returns 404 when PATCH /funcoes/:id targets another org', async () => {
    currentRole = 'admin';
    serviceMocks.updateFuncao.mockResolvedValueOnce(null);

    const response = await jsonRequestWithBody('PATCH', `/funcoes/${funcaoId}`, {
      name: 'Designer',
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
    expect(serviceMocks.updateFuncao).toHaveBeenCalledWith(
      mockedDb,
      'verified-org',
      funcaoId,
      { name: 'Designer' },
    );
  });

  it('archives a função through PATCH rather than a DELETE verb', async () => {
    currentRole = 'admin';
    serviceMocks.updateFuncao.mockResolvedValueOnce({ ...funcaoResult, status: 'archived' });

    const response = await jsonRequestWithBody('PATCH', `/funcoes/${funcaoId}`, {
      status: 'archived',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      funcao: { ...funcaoResult, status: 'archived' },
    });
  });
});

describe('Sales Ops pessoa função assignment', () => {
  const personId = '11111111-1111-4111-8111-111111111111';

  it('rejects an unknown funcaoId on POST /people with 400 unknown_funcao', async () => {
    currentRole = 'admin';
    serviceMocks.createPerson.mockResolvedValueOnce('unknown_funcao');

    const response = await jsonRequestWithBody('POST', '/people', {
      displayName: 'Sig',
      funcaoIds: ['88888888-8888-4888-8888-888888888888'],
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'validation_error',
      reason: 'unknown_funcao',
    });
  });

  it('rejects a person with no função at all with 400 funcao_required', async () => {
    currentRole = 'admin';
    serviceMocks.createPerson.mockResolvedValueOnce('funcao_required');

    const response = await jsonRequestWithBody('POST', '/people', { displayName: 'Sig' });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'validation_error',
      reason: 'funcao_required',
    });
  });

  it('forwards funcaoIds on PATCH /people/:id and maps its sentinels', async () => {
    currentRole = 'admin';
    const funcaoIds = ['77777777-7777-4777-8777-777777777777'];

    const okResponse = await jsonRequestWithBody('PATCH', `/people/${personId}`, { funcaoIds });
    expect(okResponse.status).toBe(200);
    expect(serviceMocks.updatePerson).toHaveBeenCalledWith(
      mockedDb,
      'verified-org',
      personId,
      { funcaoIds },
    );

    serviceMocks.updatePerson.mockResolvedValueOnce('funcao_required');
    const emptyResponse = await jsonRequestWithBody('PATCH', `/people/${personId}`, {
      funcaoIds: [],
    });
    expect(emptyResponse.status).toBe(400);
    expect(await emptyResponse.json()).toEqual({
      error: 'validation_error',
      reason: 'funcao_required',
    });
  });

  it('has no DELETE route for people or funcoes', async () => {
    currentRole = 'admin';

    for (const path of [`/people/${personId}`, `/funcoes/${personId}`]) {
      const response = await app.request(path, { method: 'DELETE' });
      expect(response.status, `DELETE ${path} should not be routed`).toBe(404);
    }
    expect(serviceMocks.updatePerson).not.toHaveBeenCalled();
    expect(serviceMocks.updateFuncao).not.toHaveBeenCalled();
  });
});

describe('Sales Ops product area binding', () => {
  it('rejects product creation when areaId is missing', async () => {
    const productWithoutArea: Record<string, unknown> = { ...productPayload };
    delete productWithoutArea.areaId;

    const response = await jsonRequestWithBody('POST', '/products', productWithoutArea);

    expect(response.status).toBe(400);
    expect(serviceMocks.getArea).not.toHaveBeenCalled();
    expect(serviceMocks.createProduct).not.toHaveBeenCalled();
  });

  it('rejects product creation when the area is not in the verified org', async () => {
    serviceMocks.getArea.mockResolvedValueOnce(null);

    const response = await jsonRequestWithBody('POST', '/products', productPayload);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'validation_error',
      reason: 'unknown_area',
    });
    expect(serviceMocks.createProduct).not.toHaveBeenCalled();
  });

  it('creates a product when the area resolves in the verified org', async () => {
    const response = await jsonRequestWithBody('POST', '/products', productPayload);

    expect(response.status).toBe(201);
    expect(serviceMocks.createProduct).toHaveBeenCalledWith(
      mockedDb,
      'verified-org',
      expect.objectContaining({ areaId: productPayload.areaId }),
    );
  });
});

describe('Sales Ops sale write routes', () => {
  it('returns 400 and skips the service when installments do not sum to the items total', async () => {
    const response = await jsonRequestWithBody('POST', '/sales', {
      ...salePayload,
      installments: [{ dueDate: '2026-07-14', amountBrl: 399999, method: 'pix' as const }],
    });

    expect(response.status).toBe(400);
    expect(serviceMocks.createSale).not.toHaveBeenCalled();
  });

  it('returns 400 for a free-form item without areaId', async () => {
    const response = await jsonRequestWithBody('POST', '/sales', {
      ...salePayload,
      items: [{ productName: 'Serviço avulso', quantity: 1, unitBrl: 400000 }],
    });

    expect(response.status).toBe(400);
    expect(serviceMocks.createSale).not.toHaveBeenCalled();
  });

  it('creates a v2 proposta and forwards the verified org', async () => {
    const response = await jsonRequestWithBody('POST', '/sales', salePayload);

    expect(response.status).toBe(201);
    expect(serviceMocks.createSale).toHaveBeenCalledWith(
      mockedDb,
      'verified-org',
      expect.objectContaining({ clientName: 'SegPro', status: 'open' }),
    );
    expect(await response.json()).toEqual(saleResult);
  });

  it('returns 409 when updating a won proposta', async () => {
    serviceMocks.updateSale.mockResolvedValueOnce({
      ok: false,
      reason: 'not_editable',
      status: 'won',
    });

    const putResponse = await app.request('/sales/55555555-5555-4555-8555-555555555555', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(salePayload),
    });

    expect(putResponse.status).toBe(409);
    expect(await putResponse.json()).toEqual({ error: 'sale_not_editable', status: 'won' });
  });

  it('returns 404 for an unknown or non-uuid sale id', async () => {
    const nonUuidResponse = await app.request('/sales/not-a-uuid', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(salePayload),
    });
    expect(nonUuidResponse.status).toBe(404);
    expect(serviceMocks.updateSale).not.toHaveBeenCalled();

    serviceMocks.updateSale.mockResolvedValueOnce({ ok: false, reason: 'not_found' });
    const unknownResponse = await app.request(
      '/sales/66666666-6666-4666-8666-666666666666',
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(salePayload),
      },
    );
    expect(unknownResponse.status).toBe(404);
  });
});
