/**
 * The lead HTTP boundary per edition (edicao-leads).
 *
 * Same harness as `lead-routes.test.ts`, plus one Context variable: the
 * `salesEdition` the auth middleware resolves from the VERIFIED token. The
 * leads edition must reach the contact-only service functions through the
 * contact schemas; the full edition, and an absent edition, must reach today's
 * functions through today's schemas and refuse the contact keys.
 */
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hubAuthContext as sharedHubAuthContext } from '../../../../auth/__tests__/hub-auth-context-fixture.js';
import { LeadInputError } from '../lead-service.js';

const mockedDb = { name: 'lead-route-edition-test-db' };
const serviceMocks = vi.hoisted(() => ({
  createLead: vi.fn(),
  createContactLead: vi.fn(),
  updateLead: vi.fn(),
  updateContactLead: vi.fn(),
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
  contactPhone: null,
  contactEmail: null,
  contactBirthDate: null,
  sellerPersonId: null,
  sellerNameSnapshot: '',
  saleId: null,
  saleStatus: null,
  lostReason: null,
  products: [],
  createdAt: '2026-09-18T00:00:00.000Z',
  updatedAt: null,
};

const TOKEN_EMAIL = 'ana@example.test';

let currentRoles: string[];
let currentEdition: 'full' | 'leads' | undefined;
let currentName: string | undefined;

function createTestApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', 'verified-account');
    c.set('orgId', 'verified-org');
    c.set('userRole', currentRoles[0] as never);
    c.set('userRoles', currentRoles as never);
    c.set(
      'hubAuth',
      sharedHubAuthContext({
        accountId: 'verified-account',
        workspaceId: 'verified-org',
        email: TOKEN_EMAIL,
        ...(currentName !== undefined ? { name: currentName } : {}),
      }),
    );
    if (currentEdition !== undefined) c.set('salesEdition', currentEdition);
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

function expectNoCreate() {
  expect(serviceMocks.createLead).not.toHaveBeenCalled();
  expect(serviceMocks.createContactLead).not.toHaveBeenCalled();
}

describe('Sales Ops lead routes per sales edition', () => {
  beforeEach(() => {
    currentRoles = ['admin'];
    currentEdition = 'leads';
    currentName = undefined;
    for (const mock of Object.values(serviceMocks)) {
      mock.mockReset();
      mock.mockResolvedValue({ ok: true, lead: leadView });
    }
  });

  it('leads: creates a contact lead through createContactLead', async () => {
    const response = await jsonRequest('POST', '/leads', { contactName: 'Ana' });
    expect(response.status).toBe(201);
    expect(serviceMocks.createContactLead).toHaveBeenCalledTimes(1);
    expect(serviceMocks.createContactLead.mock.calls[0]).toEqual([
      mockedDb,
      'verified-org',
      { contactName: 'Ana' },
      {
        userId: 'verified-account',
        email: TOKEN_EMAIL,
        isAdmin: true,
        name: null,
        hasSellerRole: false,
        edition: 'leads',
      },
    ]);
    expect(serviceMocks.createLead).not.toHaveBeenCalled();
  });

  it('leads: refuses an empresa on create', async () => {
    const response = await jsonRequest('POST', '/leads', {
      contactName: 'Ana',
      clientName: 'Empresa',
    });
    expect(response.status).toBe(400);
    expect((await response.json()) as { error: string }).toMatchObject({
      error: 'validation_error',
    });
    expectNoCreate();
  });

  it('leads: refuses a future birth day and a bad e-mail', async () => {
    const future = await jsonRequest('POST', '/leads', {
      contactName: 'Ana',
      contactBirthDate: '2999-01-01',
    });
    expect(future.status).toBe(400);
    const badEmail = await jsonRequest('POST', '/leads', {
      contactName: 'Ana',
      contactEmail: 'nope',
    });
    expect(badEmail.status).toBe(400);
    expectNoCreate();
  });

  it('leads: answers the existing no_open_stage refusal when there is no etapa', async () => {
    serviceMocks.createContactLead.mockRejectedValueOnce(new LeadInputError('no_open_stage'));
    const response = await jsonRequest('POST', '/leads', { contactName: 'Ana' });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'validation_error',
      reason: 'no_open_stage',
      itemIndex: -1,
    });
  });

  it('leads: a PATCH clears a contact field through updateContactLead', async () => {
    const response = await jsonRequest('PATCH', `/leads/${LEAD_ID}`, { contactPhone: '' });
    expect(response.status).toBe(200);
    expect(serviceMocks.updateContactLead).toHaveBeenCalledTimes(1);
    expect(serviceMocks.updateContactLead.mock.calls[0]![2]).toBe(LEAD_ID);
    expect(serviceMocks.updateContactLead.mock.calls[0]![3]).toEqual({ contactPhone: null });
    expect(serviceMocks.updateLead).not.toHaveBeenCalled();
  });

  it('leads: a PATCH refuses a value', async () => {
    const response = await jsonRequest('PATCH', `/leads/${LEAD_ID}`, { estimatedValueBrl: 100 });
    expect(response.status).toBe(400);
    expect(serviceMocks.updateLead).not.toHaveBeenCalled();
    expect(serviceMocks.updateContactLead).not.toHaveBeenCalled();
  });

  it('full: refuses the contact keys and creates through createLead', async () => {
    currentEdition = 'full';
    const smuggled = await jsonRequest('POST', '/leads', {
      contactName: 'Ana',
      clientName: 'Empresa Um',
      contactPhone: '11',
    });
    expect(smuggled.status).toBe(400);
    expectNoCreate();

    const response = await jsonRequest('POST', '/leads', {
      contactName: 'Ana',
      clientName: 'Empresa Um',
    });
    expect(response.status).toBe(201);
    expect(serviceMocks.createLead).toHaveBeenCalledTimes(1);
    expect(serviceMocks.createContactLead).not.toHaveBeenCalled();
  });

  it('full: a PATCH refuses a contact key', async () => {
    currentEdition = 'full';
    const response = await jsonRequest('PATCH', `/leads/${LEAD_ID}`, { contactEmail: 'a@b.co' });
    expect(response.status).toBe(400);
    expect(serviceMocks.updateLead).not.toHaveBeenCalled();
    expect(serviceMocks.updateContactLead).not.toHaveBeenCalled();
  });

  it('absent edition means full', async () => {
    currentEdition = undefined;
    const response = await jsonRequest('POST', '/leads', {
      contactName: 'Ana',
      clientName: 'Empresa Um',
    });
    expect(response.status).toBe(201);
    expect(serviceMocks.createLead).toHaveBeenCalledTimes(1);
    expect(serviceMocks.createContactLead).not.toHaveBeenCalled();
  });

  it('leads: passes the seller scope refusal through unchanged', async () => {
    currentRoles = ['seller'];
    serviceMocks.createContactLead.mockResolvedValueOnce({ ok: false, reason: 'seller_scope' });
    const response = await jsonRequest('POST', '/leads', { contactName: 'Ana' });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'forbidden', reason: 'seller_scope' });
    expect(serviceMocks.createContactLead.mock.calls[0]![3]).toEqual({
      userId: 'verified-account',
      email: TOKEN_EMAIL,
      isAdmin: false,
      name: null,
      hasSellerRole: true,
      edition: 'leads',
    });
  });

  // seller-auto-provision: the provisioning inputs come from the verified
  // context only; the strict contact schema refuses any body attempt.
  it('builds the auto-provision inputs from the verified token, never from the body', async () => {
    currentRoles = ['seller'];
    currentName = 'Ana Martins';
    const response = await jsonRequest('POST', '/leads', { contactName: 'Ana' });
    expect(response.status).toBe(201);
    expect(serviceMocks.createContactLead.mock.calls[0]![3]).toEqual({
      userId: 'verified-account',
      email: TOKEN_EMAIL,
      isAdmin: false,
      name: 'Ana Martins',
      hasSellerRole: true,
      edition: 'leads',
    });

    const smuggled = await jsonRequest('POST', '/leads', {
      contactName: 'Ana',
      name: 'Outro',
      edition: 'leads',
      hasSellerRole: true,
    });
    expect(smuggled.status).toBe(400);
    expect(serviceMocks.createContactLead).toHaveBeenCalledTimes(1);

    currentRoles = ['finder'];
    currentEdition = undefined;
    await jsonRequest('POST', '/leads', { contactName: 'Ana', clientName: 'Empresa Um' });
    expect(serviceMocks.createLead.mock.calls[0]![3]).toMatchObject({
      hasSellerRole: false,
      edition: 'full',
    });
  });
});
