/**
 * The lead HTTP boundary per edition (phase 2 cutover).
 *
 * Same harness as `lead-routes.test.ts`, plus one Context variable: the organization modules
 * the loader resolves for the VERIFIED token's organization (`orgModules`). The edition no longer picks a wire schema: BOTH
 * editions (and an absent edition) reach `createLead` / `updateLead` through the one
 * `LeadWriteSchema`. The edition only travels inside the scope object.
 */
import { modulesForEdition } from '@fxl-sales/shared-utils/crm-model';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hubAuthContext as sharedHubAuthContext } from '../../../../auth/__tests__/hub-auth-context-fixture.js';
import { LeadInputError } from '../lead-service.js';

const mockedDb = { name: 'lead-route-edition-test-db' };
const serviceMocks = vi.hoisted(() => ({
  createLead: vi.fn(),
  updateLead: vi.fn(),
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
    c.set('orgModules', modulesForEdition(currentEdition ?? 'full'));
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

  it('leads: creates a lead through createLead with the edition in the scope', async () => {
    const response = await jsonRequest('POST', '/leads', { contactName: 'Ana', contactPhone: '1199' });
    expect(response.status).toBe(201);
    expect(serviceMocks.createLead).toHaveBeenCalledTimes(1);
    expect(serviceMocks.createLead.mock.calls[0]).toEqual([
      mockedDb,
      'verified-org',
      { contactName: 'Ana', contactPhone: '1199', estimatedValueBrl: 0 },
      {
        userId: 'verified-account',
        email: TOKEN_EMAIL,
        isAdmin: true,
        name: null,
        hasSellerRole: false,
        edition: 'leads',
      },
    ]);
  });

  it('both editions accept an empresa, a valor and produtos on create', async () => {
    for (const edition of ['leads', 'full'] as const) {
      currentEdition = edition;
      serviceMocks.createLead.mockClear();
      const ok = await jsonRequest('POST', '/leads', {
        contactName: 'Ana',
        contactEmail: 'a@b.co',
        clientName: 'Empresa',
        estimatedValueBrl: 250000,
        products: [{ productName: 'Avulso' }],
      });
      expect(ok.status).toBe(201);
      expect(serviceMocks.createLead.mock.calls[0]![2]).toMatchObject({
        contactName: 'Ana',
        clientName: 'Empresa',
        estimatedValueBrl: 250000,
      });
    }
  });

  it('a create without any contact is a 400 in both editions and reaches no service', async () => {
    for (const edition of ['leads', 'full', undefined] as const) {
      currentEdition = edition;
      const response = await jsonRequest('POST', '/leads', { contactName: 'Ana', clientName: 'Empresa Um' });
      expect(response.status).toBe(400);
    }
    expectNoCreate();
  });

  it('refuses a future birth day and a bad e-mail', async () => {
    const future = await jsonRequest('POST', '/leads', {
      contactName: 'Ana',
      contactPhone: '1',
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

  it('answers the existing no_open_stage refusal when there is no etapa', async () => {
    serviceMocks.createLead.mockRejectedValueOnce(new LeadInputError('no_open_stage'));
    const response = await jsonRequest('POST', '/leads', { contactName: 'Ana', contactPhone: '1' });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'validation_error',
      reason: 'no_open_stage',
      itemIndex: -1,
    });
  });

  it('maps the new field errors onto the same 400 body with the entry index', async () => {
    serviceMocks.createLead.mockRejectedValueOnce(new LeadInputError('field_invalid', 2));
    const response = await jsonRequest('POST', '/leads', { contactName: 'Ana', contactPhone: '1' });
    expect(await response.json()).toEqual({ error: 'validation_error', reason: 'field_invalid', itemIndex: 2 });
  });

  it('a PATCH clears a contact field through updateLead, in both editions', async () => {
    for (const edition of ['leads', 'full'] as const) {
      currentEdition = edition;
      serviceMocks.updateLead.mockClear();
      const response = await jsonRequest('PATCH', `/leads/${LEAD_ID}`, { contactPhone: '' });
      expect(response.status).toBe(200);
      expect(serviceMocks.updateLead).toHaveBeenCalledTimes(1);
      expect(serviceMocks.updateLead.mock.calls[0]![2]).toBe(LEAD_ID);
      expect(serviceMocks.updateLead.mock.calls[0]![3]).toEqual({ contactPhone: null });
    }
  });

  it('a PATCH updates the value through updateLead and refuses stage keys', async () => {
    const response = await jsonRequest('PATCH', `/leads/${LEAD_ID}`, { estimatedValueBrl: 100 });
    expect(response.status).toBe(200);
    expect(serviceMocks.updateLead.mock.calls[0]![3]).toEqual({ estimatedValueBrl: 100 });
    const stage = await jsonRequest('PATCH', `/leads/${LEAD_ID}`, { stageId: STAGE_ID });
    expect(stage.status).toBe(400);
    expect(serviceMocks.updateLead).toHaveBeenCalledTimes(1);
  });

  it('absent edition means full in the scope', async () => {
    currentEdition = undefined;
    const response = await jsonRequest('POST', '/leads', {
      contactName: 'Ana',
      contactPhone: '1',
      clientName: 'Empresa Um',
    });
    expect(response.status).toBe(201);
    expect(serviceMocks.createLead.mock.calls[0]![3]).toMatchObject({ edition: 'full' });
  });

  it('passes the seller scope refusal through unchanged', async () => {
    currentRoles = ['seller'];
    serviceMocks.createLead.mockResolvedValueOnce({ ok: false, reason: 'seller_scope' });
    const response = await jsonRequest('POST', '/leads', { contactName: 'Ana', contactPhone: '1' });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'forbidden', reason: 'seller_scope' });
    expect(serviceMocks.createLead.mock.calls[0]![3]).toEqual({
      userId: 'verified-account',
      email: TOKEN_EMAIL,
      isAdmin: false,
      name: null,
      hasSellerRole: true,
      edition: 'leads',
    });
  });

  // seller-auto-provision: the provisioning inputs come from the verified
  // context only; the strict schema refuses any body attempt.
  it('builds the auto-provision inputs from the verified token, never from the body', async () => {
    currentRoles = ['seller'];
    currentName = 'Ana Martins';
    const response = await jsonRequest('POST', '/leads', { contactName: 'Ana', contactPhone: '1' });
    expect(response.status).toBe(201);
    expect(serviceMocks.createLead.mock.calls[0]![3]).toEqual({
      userId: 'verified-account',
      email: TOKEN_EMAIL,
      isAdmin: false,
      name: 'Ana Martins',
      hasSellerRole: true,
      edition: 'leads',
    });

    const smuggled = await jsonRequest('POST', '/leads', {
      contactName: 'Ana',
      contactPhone: '1',
      name: 'Outro',
      edition: 'leads',
      hasSellerRole: true,
    });
    expect(smuggled.status).toBe(400);
    expect(serviceMocks.createLead).toHaveBeenCalledTimes(1);

    currentRoles = ['finder'];
    currentEdition = undefined;
    await jsonRequest('POST', '/leads', { contactName: 'Ana', contactPhone: '1', clientName: 'Empresa Um' });
    expect(serviceMocks.createLead.mock.calls[1]![3]).toMatchObject({
      hasSellerRole: false,
      edition: 'full',
    });
  });
});
