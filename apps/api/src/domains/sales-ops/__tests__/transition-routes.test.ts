import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockedDb = { name: 'sales-ops-transition-route-test-db' };
const serviceMocks = vi.hoisted(() => ({
  transitionSale: vi.fn(),
  cancelContract: vi.fn(),
}));

vi.mock('../../../db/client.js', () => ({
  getDb: () => mockedDb,
}));

vi.mock('../service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../service.js')>();
  return {
    ...actual,
    transitionSale: serviceMocks.transitionSale,
    cancelContract: serviceMocks.cancelContract,
  };
});

const { salesOpsRouter } = await import('../routes.js');

function createTestApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', 'verified-account');
    c.set('orgId', 'verified-org');
    await next();
  });
  app.route('/', salesOpsRouter);
  return app;
}

const app = createTestApp();

const saleId = '55555555-5555-4555-8555-555555555555';

function postJson(path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /sales/:id/transition', () => {
  it('returns 200 {sale} and passes the verified org', async () => {
    const sale = { id: saleId, status: 'won' };
    serviceMocks.transitionSale.mockResolvedValueOnce({ ok: true, sale });

    const response = await postJson(`/sales/${saleId}/transition`, { status: 'won' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sale });
    expect(serviceMocks.transitionSale).toHaveBeenCalledWith(
      mockedDb,
      'verified-org',
      saleId,
      'won',
    );
  });

  it('returns 400 on a bad status', async () => {
    const response = await postJson(`/sales/${saleId}/transition`, { status: 'draft' });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('validation_error');
    expect(serviceMocks.transitionSale).not.toHaveBeenCalled();
  });

  it('maps not_found to 404', async () => {
    serviceMocks.transitionSale.mockResolvedValueOnce({ ok: false, reason: 'not_found' });

    const response = await postJson(`/sales/${saleId}/transition`, { status: 'open' });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
  });

  it('maps invalid_transition to 409', async () => {
    serviceMocks.transitionSale.mockResolvedValueOnce({
      ok: false,
      reason: 'invalid_transition',
      from: 'won',
      to: 'lost',
    });

    const response = await postJson(`/sales/${saleId}/transition`, { status: 'lost' });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'invalid_transition',
      from: 'won',
      to: 'lost',
    });
  });

  it('returns 404 for a malformed id without touching the service', async () => {
    const response = await postJson('/sales/not-a-uuid/transition', { status: 'open' });

    expect(response.status).toBe(404);
    expect(serviceMocks.transitionSale).not.toHaveBeenCalled();
  });
});

describe('POST /sales/:id/cancel-contract', () => {
  it('returns 200 with void counts', async () => {
    const sale = { id: saleId, status: 'won' };
    serviceMocks.cancelContract.mockResolvedValueOnce({
      ok: true,
      sale,
      voidedReceivables: 2,
      voidedPayables: 4,
    });

    const response = await postJson(`/sales/${saleId}/cancel-contract`, {
      effectiveDate: '2026-08-15',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sale, voidedReceivables: 2, voidedPayables: 4 });
    expect(serviceMocks.cancelContract).toHaveBeenCalledWith(
      mockedDb,
      'verified-org',
      saleId,
      '2026-08-15',
    );
  });

  it('maps not_found to 404 and not_cancellable to 409', async () => {
    serviceMocks.cancelContract.mockResolvedValueOnce({ ok: false, reason: 'not_found' });
    const notFoundResponse = await postJson(`/sales/${saleId}/cancel-contract`, {});
    expect(notFoundResponse.status).toBe(404);
    expect(await notFoundResponse.json()).toEqual({ error: 'not_found' });

    serviceMocks.cancelContract.mockResolvedValueOnce({ ok: false, reason: 'not_cancellable' });
    const notCancellableResponse = await postJson(`/sales/${saleId}/cancel-contract`, {});
    expect(notCancellableResponse.status).toBe(409);
    expect(await notCancellableResponse.json()).toEqual({ error: 'contract_not_cancellable' });
  });
});
