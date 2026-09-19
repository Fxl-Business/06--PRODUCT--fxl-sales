/**
 * The lead HTTP boundary.
 *
 * Same harness as `__tests__/routes.test.ts`: the db client and the service are
 * mocked, and one middleware puts a VERIFIED caller on the Context. What is
 * under test here is the boundary itself - which org reaches the service, how
 * the scope object is built, and the exact body and status of every refusal.
 * The service's own behaviour is proved against a real database in
 * `test/rls/leads-seller-scope.test.ts`.
 */
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hubAuthContext as sharedHubAuthContext } from '../../../../auth/__tests__/hub-auth-context-fixture.js';
import { LeadInputError } from '../lead-service.js';

const mockedDb = { name: 'lead-route-test-db' };
const serviceMocks = vi.hoisted(() => ({
  listLeads: vi.fn(),
  createLead: vi.fn(),
  getLead: vi.fn(),
  updateLead: vi.fn(),
  moveLead: vi.fn(),
}));

vi.mock('../../../../db/client.js', () => ({
  getDb: () => mockedDb,
}));

vi.mock('../lead-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lead-service.js')>();
  return { ...actual, ...serviceMocks };
});

const { leadsRouter } = await import('../lead-routes.js');

const LEAD_ID = '55555555-5555-4555-8555-555555555555';
const STAGE_ID = '66666666-6666-4666-8666-666666666666';
const SALE_ID = '77777777-7777-4777-8777-777777777777';

const leadView = {
  id: LEAD_ID,
  stageId: STAGE_ID,
  stageChangedAt: '2026-09-18T00:00:00.000Z',
  position: 1,
  contactName: 'Ana Martins',
  clientId: null,
  clientNameSnapshot: 'Empresa Um',
  estimatedValueBrl: 250000,
  description: null,
  sellerPersonId: null,
  sellerNameSnapshot: '',
  saleId: null,
  saleStatus: null,
  lostReason: null,
  products: [],
  createdAt: '2026-09-18T00:00:00.000Z',
  updatedAt: null,
};

let currentRoles: string[];
let currentEmail: string | undefined;

function createTestApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', 'verified-account');
    c.set('orgId', 'verified-org');
    c.set('userRole', currentRoles[0]);
    c.set('userRoles', currentRoles as never);
    c.set(
      'hubAuth',
      sharedHubAuthContext({
        accountId: 'verified-account',
        workspaceId: 'verified-org',
        ...(currentEmail !== undefined ? { email: currentEmail } : {}),
      }),
    );
    await next();
  });
  app.route('/leads', leadsRouter);
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

describe('Sales Ops lead routes', () => {
  beforeEach(() => {
    currentRoles = ['admin', 'seller', 'finder'];
    currentEmail = 'ana@example.test';
    for (const mock of Object.values(serviceMocks)) mock.mockReset();
    serviceMocks.listLeads.mockResolvedValue({
      ok: true,
      leads: [leadView],
      nextCursor: null,
      total: 1,
    });
    serviceMocks.createLead.mockResolvedValue({ ok: true, lead: leadView });
    serviceMocks.getLead.mockResolvedValue({ ok: true, lead: leadView });
    serviceMocks.updateLead.mockResolvedValue({ ok: true, lead: leadView });
    serviceMocks.moveLead.mockResolvedValue({ ok: true, lead: leadView });
  });

  it('passes the VERIFIED org and never an orgId from the body or the query', async () => {
    const response = await jsonRequest('POST', '/leads?orgId=query-org-must-not-be-used', {
      contactName: 'Ana Martins',
      clientName: 'Empresa Um',
    });
    expect(response.status).toBe(201);
    expect(serviceMocks.createLead).toHaveBeenCalledTimes(1);
    expect(serviceMocks.createLead.mock.calls[0]![1]).toBe('verified-org');

    // The body cannot even carry one: CreateLeadSchema is .strict().
    const smuggled = await jsonRequest('POST', '/leads', {
      contactName: 'Ana Martins',
      clientName: 'Empresa Um',
      orgId: 'body-org-must-not-be-used',
    });
    expect(smuggled.status).toBe(400);
    expect(serviceMocks.createLead).toHaveBeenCalledTimes(1);
  });

  it('builds the scope from userRoles and the token e-mail, never from the body', async () => {
    currentRoles = ['seller'];
    await jsonRequest('POST', '/leads', {
      contactName: 'Ana Martins',
      clientName: 'Empresa Um',
    });
    expect(serviceMocks.createLead.mock.calls[0]![3]).toEqual({
      userId: 'verified-account',
      email: 'ana@example.test',
      isAdmin: false,
    });

    currentRoles = ['admin', 'seller', 'finder'];
    currentEmail = undefined;
    await jsonRequest('POST', '/leads', {
      contactName: 'Ana Martins',
      clientName: 'Empresa Um',
    });
    expect(serviceMocks.createLead.mock.calls[1]![3]).toEqual({
      userId: 'verified-account',
      email: null,
      isAdmin: true,
    });
  });

  // Acceptance 6. Asserted with toEqual and not toMatchObject, because the whole
  // body is the contract the web half branches on.
  it('answers a missing lost reason with validation_error lost_reason_required and 400', async () => {
    serviceMocks.moveLead.mockRejectedValue(new LeadInputError('lost_reason_required'));
    const response = await jsonRequest('POST', `/leads/${LEAD_ID}/move`, {
      stageId: STAGE_ID,
      position: 0,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'validation_error',
      reason: 'lost_reason_required',
      itemIndex: -1,
    });
  });

  it('answers a conversion move with no saleId with reason sale_required_for_conversion', async () => {
    serviceMocks.moveLead.mockRejectedValue(new LeadInputError('sale_required_for_conversion'));
    const response = await jsonRequest('POST', `/leads/${LEAD_ID}/move`, {
      stageId: STAGE_ID,
      position: 0,
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'validation_error',
      reason: 'sale_required_for_conversion',
      itemIndex: -1,
    });
  });

  it('answers a move on an already-converted lead with 409 lead_already_converted', async () => {
    serviceMocks.moveLead.mockResolvedValue({ ok: false, reason: 'already_converted' });
    const response = await jsonRequest('POST', `/leads/${LEAD_ID}/move`, {
      stageId: STAGE_ID,
      position: 0,
      saleId: SALE_ID,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'conflict',
      reason: 'lead_already_converted',
    });
  });

  // A 403 on a specific uuid confirms the row exists, so an out-of-scope lead is
  // indistinguishable from one that was never there.
  it('answers an out-of-scope lead with 404 and never 403', async () => {
    serviceMocks.getLead.mockResolvedValue({ ok: false, reason: 'not_found' });
    const response = await app.request(`/leads/${LEAD_ID}`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });

    // A malformed id is the same answer, matching saleIdSchema's handling.
    expect((await app.request('/leads/not-a-uuid')).status).toBe(404);
    expect(serviceMocks.getLead).toHaveBeenCalledTimes(1);
  });

  it('answers a caller with no mapped pessoa with 403 seller_person_unmapped', async () => {
    serviceMocks.listLeads.mockResolvedValue({ ok: false, reason: 'seller_person_unmapped' });
    const response = await app.request(`/leads?stageId=${STAGE_ID}`);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'forbidden',
      reason: 'seller_person_unmapped',
    });
  });

  it('answers a seller filing someone else a lead with 403 seller_scope', async () => {
    serviceMocks.createLead.mockResolvedValue({ ok: false, reason: 'seller_scope' });
    const response = await jsonRequest('POST', '/leads', {
      contactName: 'Ana Martins',
      clientName: 'Empresa Um',
      sellerPersonId: SALE_ID,
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'forbidden', reason: 'seller_scope' });
  });

  it('requires stageId on the list and never reads an orgId query parameter', async () => {
    expect((await app.request('/leads')).status).toBe(400);
    expect(serviceMocks.listLeads).not.toHaveBeenCalled();

    const ok = await app.request(`/leads?stageId=${STAGE_ID}&limit=10&sellerPersonId=${SALE_ID}`);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ leads: [leadView], nextCursor: null, total: 1 });
    expect(serviceMocks.listLeads.mock.calls[0]![2]).toEqual({
      stageId: STAGE_ID,
      limit: 10,
      sellerPersonId: SALE_ID,
    });
  });

  // No DELETE verb, on any lead path. Removal is not an operation this domain
  // has: a lead that goes nowhere ends in the terminal lost stage.
  it('exposes no DELETE verb on any lead route', async () => {
    for (const path of ['/leads', `/leads/${LEAD_ID}`, `/leads/${LEAD_ID}/move`]) {
      expect((await app.request(path, { method: 'DELETE' })).status).toBe(404);
    }
  });
});
