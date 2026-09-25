import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hubAuthContext as sharedHubAuthContext } from '../../../auth/__tests__/hub-auth-context-fixture.js';

/**
 * PC23: the routes that move ledger money or org-wide financial defaults are
 * admin-only, and `POST /sales` stays open except for a proposta created `won`.
 * Non-admin callers are built by setting `userRole` on the Hono context: the
 * fake identity roster has no seller-only identity.
 */

const mockedDb = { name: 'sales-ops-financial-admin-gate-test-db' };
const serviceMocks = vi.hoisted(() => ({
  createSale: vi.fn(),
  updateSale: vi.fn(),
  transitionSale: vi.fn(),
  cancelContract: vi.fn(),
  upsertSettings: vi.fn(),
}));

vi.mock('../../../db/client.js', () => ({
  getDb: () => mockedDb,
}));

vi.mock('../service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../service.js')>();
  return {
    ...actual,
    createSale: serviceMocks.createSale,
    updateSale: serviceMocks.updateSale,
    transitionSale: serviceMocks.transitionSale,
    cancelContract: serviceMocks.cancelContract,
    upsertSettings: serviceMocks.upsertSettings,
  };
});

const { salesOpsRouter } = await import('../routes.js');

type TestRole = 'admin' | 'seller' | 'finder' | undefined;
type ServiceMockName = keyof typeof serviceMocks;

let currentRole: TestRole;

function createTestApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', 'verified-account');
    c.set('orgId', 'verified-org');
    c.set('userRole', currentRole);
    c.set(
      'userRoles',
      currentRole === 'admin' ? ['admin', 'seller', 'finder'] : currentRole ? [currentRole] : [],
    );
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
  app.route('/', salesOpsRouter);
  return app;
}

const app = createTestApp();

function send(method: 'POST' | 'PUT', path: string, body: unknown) {
  return app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const SALE_ID = '55555555-5555-4555-8555-555555555555';
const ADMIN_BODY = { error: 'forbidden', reason: 'admin_role_required' };

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

const GATED = [
  {
    name: 'POST /sales/:id/transition',
    method: 'POST',
    path: `/sales/${SALE_ID}/transition`,
    body: { status: 'won' },
    mock: 'transitionSale',
    ok: 200,
  },
  {
    name: 'POST /sales/:id/cancel-contract',
    method: 'POST',
    path: `/sales/${SALE_ID}/cancel-contract`,
    body: {},
    mock: 'cancelContract',
    ok: 200,
  },
  {
    name: 'PUT /sales/:id',
    method: 'PUT',
    path: `/sales/${SALE_ID}`,
    body: salePayload,
    mock: 'updateSale',
    ok: 200,
  },
  {
    name: 'PUT /settings',
    method: 'PUT',
    path: '/settings',
    body: { currency: 'BRL' },
    mock: 'upsertSettings',
    ok: 200,
  },
] as const satisfies ReadonlyArray<{
  name: string;
  method: 'POST' | 'PUT';
  path: string;
  body: unknown;
  mock: ServiceMockName;
  ok: number;
}>;

const NON_ADMIN_ROLES = ['seller', 'finder', undefined] as const;

beforeEach(() => {
  currentRole = undefined;
  vi.clearAllMocks();
  serviceMocks.createSale.mockResolvedValue({
    sale: { id: SALE_ID, code: '0001-01' },
    ledger: { sale: { totalBrl: 400000 } },
    payables: [],
  });
  serviceMocks.updateSale.mockResolvedValue({ ok: true, sale: { id: SALE_ID }, ledger: {} });
  serviceMocks.transitionSale.mockResolvedValue({
    ok: true,
    sale: { id: SALE_ID, status: 'won' },
  });
  serviceMocks.cancelContract.mockResolvedValue({
    ok: true,
    sale: { id: SALE_ID },
    voidedReceivables: 0,
    voidedPayables: 0,
  });
  serviceMocks.upsertSettings.mockResolvedValue({ orgId: 'verified-org', currency: 'BRL' });
});

describe('PC23 financial admin gate', () => {
  it.each(
    GATED.flatMap((route) => NON_ADMIN_ROLES.map((role) => [route.name, role, route] as const)),
  )('rejects %s for role %s with the requireAdmin body before the service runs', async (
    _name,
    role,
    route,
  ) => {
    currentRole = role;

    const response = await send(route.method, route.path, route.body);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(ADMIN_BODY);
    expect(serviceMocks[route.mock]).not.toHaveBeenCalled();
  });

  it.each(GATED.map((route) => [route.name, route] as const))(
    'lets an admin through %s',
    async (_name, route) => {
      currentRole = 'admin';

      const response = await send(route.method, route.path, route.body);

      expect(response.status).toBe(route.ok);
      const mock = serviceMocks[route.mock];
      expect(mock).toHaveBeenCalledTimes(1);
      expect(mock.mock.calls[0]?.slice(0, 2)).toEqual([mockedDb, 'verified-org']);
    },
  );
});

describe('POST /sales stays open except for status won', () => {
  it.each(NON_ADMIN_ROLES)('rejects a won proposta from role %s before validation', async (role) => {
    currentRole = role;

    const response = await send('POST', '/sales', { ...salePayload, status: 'won' });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(ADMIN_BODY);
    expect(serviceMocks.createSale).not.toHaveBeenCalled();
  });

  it('answers 403 and not 400 for an invalid won body from a non-admin', async () => {
    currentRole = 'seller';

    const response = await send('POST', '/sales', { status: 'won' });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(ADMIN_BODY);
    expect(serviceMocks.createSale).not.toHaveBeenCalled();
  });

  it.each(['draft', 'open'] as const)('lets a seller create a %s proposta', async (status) => {
    currentRole = 'seller';

    const response = await send('POST', '/sales', { ...salePayload, status });

    expect(response.status).toBe(201);
    expect(serviceMocks.createSale).toHaveBeenCalledWith(
      mockedDb,
      'verified-org',
      expect.objectContaining({ status }),
    );
  });

  it('lets an admin create a won proposta', async () => {
    currentRole = 'admin';

    const response = await send('POST', '/sales', { ...salePayload, status: 'won' });

    expect(response.status).toBe(201);
    expect(serviceMocks.createSale).toHaveBeenCalledWith(
      mockedDb,
      'verified-org',
      expect.objectContaining({ status: 'won' }),
    );
  });
});

describe('settings currency is locked to BRL', () => {
  beforeEach(() => {
    currentRole = 'admin';
  });

  it('rejects currency USD with 400 validation_error', async () => {
    const response = await send('PUT', '/settings', { currency: 'USD' });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'validation_error' });
    expect(serviceMocks.upsertSettings).not.toHaveBeenCalled();
  });

  it('persists an omitted currency as BRL', async () => {
    const response = await send('PUT', '/settings', {});

    expect(response.status).toBe(200);
    expect(serviceMocks.upsertSettings).toHaveBeenCalledWith(
      mockedDb,
      'verified-org',
      expect.objectContaining({ currency: 'BRL' }),
    );
  });

  it('accepts currency BRL', async () => {
    const response = await send('PUT', '/settings', { currency: 'BRL' });

    expect(response.status).toBe(200);
    expect(serviceMocks.upsertSettings).toHaveBeenCalledTimes(1);
  });
});
