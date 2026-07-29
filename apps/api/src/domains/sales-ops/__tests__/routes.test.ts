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
  createProduct: vi.fn(),
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
    createProduct: serviceMocks.createProduct,
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
  serviceMocks.createProduct.mockResolvedValue(productResult);
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
