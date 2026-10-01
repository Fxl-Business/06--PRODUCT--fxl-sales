import { randomUUID } from 'node:crypto';
import { HubInvitationError, type HubInvitation, type HubInvitationResult } from '@fxl-business/hub-sdk/server';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hubAuthContext } from '../../../auth/__tests__/hub-auth-context-fixture.js';
import {
  forceInvitationsClientAbsentForTests,
  resetInvitationsClientForTests,
  setInvitationsClientForTests,
  type SalesInvitationsClient,
} from '../invitations-client.js';
import { INVITATION_COPY } from '../invitation-error.js';

/**
 * Seller invitations through the admin sellers routes (slice 08).
 *
 * A UNIT test: no database. `getAdminDb()` answers an in-memory fake that keeps
 * the `sellers` rows and records every insert and update, so a test can assert
 * that a failed invite left the seller row in place. The Hub is the injected
 * fake invitations client from the slice 07 seam; the absent client is forced
 * through the explicit seam, never inferred from the unit setup's blank
 * credentials.
 *
 * What it pins is the boundary: the actor token is the raw `Authorization`
 * bearer, the invite grants exactly `['seller']` and never names an
 * Organization, the invited org is the verified context's, an invite failure
 * keeps the seller, and the accept URL reaches the response but never a log.
 */

type Row = {
  id: string;
  accountId: string | null;
  displayName: string;
  contactEmail: string;
  status: string;
  createdAt: Date;
  updatedAt: Date | null;
  invitationId: string | null;
  invitationStatus: string | null;
  invitedOrgId: string | null;
};

type Cond = { column: string; value: unknown };

const store = vi.hoisted(() => ({
  rows: [] as Row[],
  inserts: [] as Record<string, unknown>[],
  updates: [] as { id: unknown; patch: Record<string, unknown> }[],
}));

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    // The fake database only needs to know which column equals which value.
    eq: (column: { name: string }, value: unknown) => ({ column: column.name, value }),
  };
});

function matches(row: Row, cond: Cond): boolean {
  if (cond.column !== 'id') throw new Error(`unexpected where column ${cond.column}`);
  return row.id === cond.value;
}

const fakeDb = {
  insert: () => ({
    values: (values: Record<string, unknown>) => ({
      returning: async () => {
        store.inserts.push(values);
        const row: Row = {
          id: randomUUID(),
          accountId: null,
          createdAt: new Date('2026-10-01T12:00:00Z'),
          updatedAt: null,
          invitationId: null,
          invitationStatus: null,
          invitedOrgId: null,
          ...(values as Pick<Row, 'displayName' | 'contactEmail' | 'status'>),
        };
        store.rows.push(row);
        return [{ ...row }];
      },
    }),
  }),
  update: () => ({
    set: (patch: Record<string, unknown>) => ({
      where: (cond: Cond) => ({
        returning: async () => {
          store.updates.push({ id: cond.value, patch });
          const updated: Row[] = [];
          for (const row of store.rows) {
            if (matches(row, cond)) {
              Object.assign(row, patch);
              updated.push({ ...row });
            }
          }
          return updated;
        },
      }),
    }),
  }),
  select: () => ({
    from: () => ({
      orderBy: async () => [...store.rows].reverse().map((row) => ({ ...row })),
      where: (cond: Cond) => ({
        limit: async (n: number) =>
          store.rows
            .filter((row) => matches(row, cond))
            .slice(0, n)
            .map((row) => ({ ...row })),
      }),
    }),
  }),
};

vi.mock('../../../db/client.js', () => ({
  getAdminDb: () => fakeDb,
  getDb: () => fakeDb,
}));

const { sellersAdminRouter } = await import('../admin-routes.js');

const BEARER = 'eyJ.admin-actor-token.sig';
const ORG = 'verified-org';
const ACCEPT_URL = 'https://hub.example.test/invitations/accept?token=single-use-secret-token';

function createTestApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', 'verified-account');
    c.set('orgId', ORG);
    c.set('userRole', 'admin');
    c.set('userRoles', ['admin']);
    // A hubAuth carrying a DIFFERENT workspace proves the org comes from
    // c.get('orgId') and the token from the header, never from this context.
    c.set(
      'hubAuth',
      hubAuthContext({
        accountId: 'verified-account',
        workspaceId: 'hub-auth-workspace',
        roles: { workspace: 'admin' },
      }),
    );
    await next();
  });
  app.route('/', sellersAdminRouter);
  return app;
}

const app = createTestApp();

function invitation(overrides: Partial<HubInvitation> = {}): HubInvitation {
  return {
    id: 'inv_1',
    organizationId: ORG,
    applicationId: 'app.fxl-sales',
    email: 'ana@example.com',
    status: 'pending',
    appRoles: ['seller'],
    invitedByAccountId: 'verified-account',
    expiresAt: '2026-10-08T12:00:00Z',
    createdAt: '2026-10-01T12:00:00Z',
    acceptedAt: null,
    ...overrides,
  };
}

function result(overrides: Partial<HubInvitation> = {}): HubInvitationResult {
  return {
    invitation: invitation(overrides),
    acceptUrl: ACCEPT_URL,
    emailDelivery: { status: 'not_configured' },
    warnings: [{ code: 'email_not_configured' }],
  };
}

function fakeClient(): { [K in keyof SalesInvitationsClient]: ReturnType<typeof vi.fn> } {
  return {
    create: vi.fn(async () => result()),
    list: vi.fn(async () => ({ invitations: [] })),
    revoke: vi.fn(async () => undefined),
    resend: vi.fn(async () => result()),
  };
}

let fake: ReturnType<typeof fakeClient>;

function post(path: string, body?: unknown, bearer: string | null = BEARER) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearer !== null) headers.Authorization = `Bearer ${bearer}`;
  return app.request(path, {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function get(path: string) {
  return app.request(path, { headers: { Authorization: `Bearer ${BEARER}` } });
}

function seedSeller(overrides: Partial<Row> = {}): Row {
  const row: Row = {
    id: randomUUID(),
    accountId: null,
    displayName: 'Bruno',
    contactEmail: 'bruno@example.com',
    status: 'active',
    createdAt: new Date('2026-09-01T12:00:00Z'),
    updatedAt: null,
    invitationId: null,
    invitationStatus: null,
    invitedOrgId: null,
    ...overrides,
  };
  store.rows.push(row);
  return row;
}

beforeEach(() => {
  store.rows.length = 0;
  store.inserts.length = 0;
  store.updates.length = 0;
  fake = fakeClient();
  setInvitationsClientForTests(fake as unknown as SalesInvitationsClient);
});

afterEach(() => {
  resetInvitationsClientForTests();
  vi.restoreAllMocks();
});

describe('POST / creates the seller and sends the Hub invitation', () => {
  it('invites with the raw bearer, email, exactly the seller role and no Organization', async () => {
    const res = await post('/', {
      displayName: 'Ana',
      contactEmail: 'ana@example.com',
      organizationId: 'smuggled-org',
      accessToken: 'smuggled-token',
    });
    expect(res.status).toBe(201);

    expect(fake.create).toHaveBeenCalledTimes(1);
    expect(fake.create.mock.calls[0]?.[0]).toEqual({
      accessToken: BEARER,
      email: 'ana@example.com',
      appRoles: ['seller'],
      locale: 'pt-BR',
    });
    expect(fake.create.mock.calls[0]?.[0]).not.toHaveProperty('organizationId');
  });

  it('persists the invitation id, pending status and the verified org', async () => {
    const res = await post('/', { displayName: 'Ana', contactEmail: 'ana@example.com' });
    const body = await res.json();

    expect(store.rows).toHaveLength(1);
    const row = store.rows[0]!;
    expect(row).toMatchObject({
      displayName: 'Ana',
      contactEmail: 'ana@example.com',
      status: 'active',
      accountId: null,
      invitationId: 'inv_1',
      invitationStatus: 'pending',
      invitedOrgId: ORG,
    });
    expect(JSON.stringify(store.inserts)).not.toContain('smuggled');

    expect(body.seller).toMatchObject({ id: row.id, invitationId: 'inv_1', invitationStatus: 'pending' });
    expect(body.invitation).toMatchObject({ id: 'inv_1', status: 'pending', appRoles: ['seller'] });
    expect(body.acceptUrl).toBe(ACCEPT_URL);
    expect(body.emailDelivery).toEqual({ status: 'not_configured' });
    expect(body.warnings).toEqual([{ code: 'email_not_configured' }]);
    expect(body).not.toHaveProperty('inviteError');
  });

  it('passes an explicit locale through', async () => {
    await post('/', { displayName: 'Ana', contactEmail: 'ana@example.com', locale: 'en' });
    expect(fake.create.mock.calls[0]?.[0]).toMatchObject({ locale: 'en' });
  });

  it('refuses an unsupported locale before inserting anything', async () => {
    const res = await post('/', { displayName: 'Ana', contactEmail: 'ana@example.com', locale: 'fr' });
    expect(res.status).toBe(400);
    expect(store.rows).toHaveLength(0);
    expect(fake.create).not.toHaveBeenCalled();
  });

  it('keeps the seller when the Hub refuses the invite and answers the mapped code', async () => {
    fake.create.mockRejectedValueOnce(
      new HubInvitationError('actor_not_member', 403, 'hub-sdk: invitation create failed: actor_not_member'),
    );

    const res = await post('/', { displayName: 'Ana', contactEmail: 'ana@example.com' });
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({
      contactEmail: 'ana@example.com',
      invitationId: null,
      invitationStatus: null,
    });
    expect(body.seller.id).toBe(store.rows[0]!.id);
    expect(body.inviteError).toEqual({
      status: 403,
      error: 'forbidden',
      code: 'actor_not_member',
      message: INVITATION_COPY.notAllowed,
    });
    expect(body).not.toHaveProperty('acceptUrl');
    expect(JSON.stringify(body)).not.toContain('hub-sdk:');
  });

  it('carries Retry-After when the Hub rate-limits the invite', async () => {
    fake.create.mockRejectedValueOnce(new HubInvitationError('rate_limited', 429, 'x', 42));

    const res = await post('/', { displayName: 'Ana', contactEmail: 'ana@example.com' });
    expect(res.status).toBe(201);
    expect(res.headers.get('Retry-After')).toBe('42');
    const body = await res.json();
    expect(body.inviteError).toMatchObject({ status: 429, code: 'rate_limited', retryAfterSeconds: 42 });
    expect(store.rows).toHaveLength(1);
  });

  it('keeps the seller when the client fails with something that is not a HubInvitationError', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.create.mockRejectedValueOnce(new TypeError('boom'));

    const res = await post('/', { displayName: 'Ana', contactEmail: 'ana@example.com' });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(store.rows).toHaveLength(1);
    expect(body.inviteError).toMatchObject({ status: 500, error: 'internal_error', code: 'unknown' });
  });

  it('with no invitations client, saves the seller and answers hub_auth_not_configured without calling the Hub', async () => {
    forceInvitationsClientAbsentForTests();

    const res = await post('/', { displayName: 'Ana', contactEmail: 'ana@example.com' });
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ invitationId: null, invitationStatus: null, invitedOrgId: null });
    expect(body.seller.id).toBe(store.rows[0]!.id);
    expect(body.inviteError).toEqual({ status: 503, error: 'unavailable', code: 'hub_auth_not_configured' });
    expect(body.inviteError.code).not.toBe('network_error');
    expect(fake.create).not.toHaveBeenCalled();
  });

  it('never hands the accept URL to any console call', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );

    await post('/', { displayName: 'Ana', contactEmail: 'ana@example.com' });
    const seller = store.rows[0]!;
    await post(`/${seller.id}/resend`, {});
    fake.create.mockRejectedValueOnce(new TypeError(`failed for ${ACCEPT_URL}`));
    await post('/', { displayName: 'Bia', contactEmail: 'bia@example.com' });

    for (const spy of spies) {
      const logged = JSON.stringify(spy.mock.calls, (_k, v) =>
        v instanceof Error ? `${v.name}:${v.message}:${v.stack}` : v,
      );
      expect(logged).not.toContain('single-use-secret-token');
      expect(logged).not.toContain(BEARER);
    }
  });
});

describe('POST /:id/resend', () => {
  it('resends the stored invitation with the bearer and the default locale', async () => {
    const seller = seedSeller({ invitationId: 'inv_9', invitationStatus: 'pending', invitedOrgId: ORG });
    fake.resend.mockResolvedValueOnce(result({ id: 'inv_9' }));

    const res = await post(`/${seller.id}/resend`, {});
    expect(res.status).toBe(200);
    expect(fake.resend).toHaveBeenCalledTimes(1);
    expect(fake.resend.mock.calls[0]?.[0]).toEqual({
      accessToken: BEARER,
      invitationId: 'inv_9',
      locale: 'pt-BR',
    });
    const body = await res.json();
    expect(body.seller.id).toBe(seller.id);
    expect(body.acceptUrl).toBe(ACCEPT_URL);
    expect(body.warnings).toEqual([{ code: 'email_not_configured' }]);
    expect(body.emailDelivery).toEqual({ status: 'not_configured' });
  });

  it('accepts no body at all and passes an explicit locale through', async () => {
    const seller = seedSeller({ invitationId: 'inv_9', invitationStatus: 'pending' });
    expect((await post(`/${seller.id}/resend`)).status).toBe(200);
    expect(fake.resend.mock.calls[0]?.[0]).toMatchObject({ locale: 'pt-BR' });

    await post(`/${seller.id}/resend`, { locale: 'en' });
    expect(fake.resend.mock.calls[1]?.[0]).toMatchObject({ locale: 'en' });
  });

  it('stores the id the Hub answers with', async () => {
    const seller = seedSeller({ invitationId: 'inv_old', invitationStatus: 'expired' });
    fake.resend.mockResolvedValueOnce(result({ id: 'inv_new', status: 'pending' }));

    await post(`/${seller.id}/resend`, {});
    expect(store.rows[0]).toMatchObject({ invitationId: 'inv_new', invitationStatus: 'pending' });
  });

  it('maps a HubInvitationError by code', async () => {
    const seller = seedSeller({ invitationId: 'inv_9', invitationStatus: 'pending' });
    fake.resend.mockRejectedValueOnce(new HubInvitationError('invitation_not_pending', 409, 'x'));

    const res = await post(`/${seller.id}/resend`, {});
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'conflict',
      code: 'invitation_not_pending',
      message: INVITATION_COPY.invitationGone,
    });
  });

  it('sets Retry-After on a rate limit', async () => {
    const seller = seedSeller({ invitationId: 'inv_9', invitationStatus: 'pending' });
    fake.resend.mockRejectedValueOnce(new HubInvitationError('rate_limited', 429, 'x', 7));

    const res = await post(`/${seller.id}/resend`, {});
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('7');
  });

  it('answers 404 for an unknown or malformed seller id', async () => {
    expect((await post(`/${randomUUID()}/resend`, {})).status).toBe(404);
    expect((await post('/not-a-uuid/resend', {})).status).toBe(404);
    expect(fake.resend).not.toHaveBeenCalled();
  });

  it('answers 409 seller_not_invited for a seller without a stored invitation', async () => {
    const seller = seedSeller();
    const res = await post(`/${seller.id}/resend`, {});
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'conflict', code: 'seller_not_invited' });
    expect(fake.resend).not.toHaveBeenCalled();
  });

  it('answers the unavailable body when there is no invitations client', async () => {
    forceInvitationsClientAbsentForTests();
    const seller = seedSeller({ invitationId: 'inv_9', invitationStatus: 'pending' });

    const res = await post(`/${seller.id}/resend`, {});
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'unavailable', code: 'hub_auth_not_configured' });
  });
});

describe('POST /:id/revoke', () => {
  it('revokes the stored invitation and records it as revoked', async () => {
    const seller = seedSeller({ invitationId: 'inv_9', invitationStatus: 'pending', invitedOrgId: ORG });

    const res = await post(`/${seller.id}/revoke`);
    expect(res.status).toBe(200);
    expect(fake.revoke).toHaveBeenCalledTimes(1);
    expect(fake.revoke.mock.calls[0]?.[0]).toEqual({ accessToken: BEARER, invitationId: 'inv_9' });
    expect(store.rows[0]).toMatchObject({ invitationId: 'inv_9', invitationStatus: 'revoked' });
    expect((await res.json()).seller).toMatchObject({ id: seller.id, invitationStatus: 'revoked' });
  });

  it('has no DELETE verb', async () => {
    const seller = seedSeller({ invitationId: 'inv_9', invitationStatus: 'pending' });
    const res = await app.request(`/${seller.id}/revoke`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${BEARER}` },
    });
    expect(res.status).toBe(404);
    const res2 = await app.request(`/${seller.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${BEARER}` },
    });
    expect(res2.status).toBe(404);
    expect(fake.revoke).not.toHaveBeenCalled();
  });

  it('maps a HubInvitationError by code and keeps the persisted status', async () => {
    const seller = seedSeller({ invitationId: 'inv_9', invitationStatus: 'pending' });
    fake.revoke.mockRejectedValueOnce(new HubInvitationError('invitation_not_found', 404, 'x'));

    const res = await post(`/${seller.id}/revoke`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'not_found',
      code: 'invitation_not_found',
      message: INVITATION_COPY.invitationGone,
    });
    expect(store.rows[0]).toMatchObject({ invitationStatus: 'pending' });
  });

  it('answers 409 seller_not_invited without a stored invitation', async () => {
    const seller = seedSeller();
    const res = await post(`/${seller.id}/revoke`);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'conflict', code: 'seller_not_invited' });
  });

  it('answers the unavailable body when there is no invitations client', async () => {
    forceInvitationsClientAbsentForTests();
    const seller = seedSeller({ invitationId: 'inv_9', invitationStatus: 'pending' });

    const res = await post(`/${seller.id}/revoke`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'unavailable', code: 'hub_auth_not_configured' });
    expect(store.rows[0]).toMatchObject({ invitationStatus: 'pending' });
  });
});

describe('GET / reconciles invitation state from the Hub', () => {
  it('asks the Hub with the bearer for every status and surfaces accepted and expired', async () => {
    const accepted = seedSeller({ invitationId: 'inv_a', invitationStatus: 'pending' });
    const expired = seedSeller({ invitationId: 'inv_e', invitationStatus: 'pending' });
    const untouched = seedSeller({ invitationId: 'inv_p', invitationStatus: 'pending' });
    const notInvited = seedSeller();

    fake.list.mockImplementation(async (input: { status?: string }) => {
      if (input.status === 'accepted') return { invitations: [invitation({ id: 'inv_a', status: 'accepted' })] };
      if (input.status === 'expired') return { invitations: [invitation({ id: 'inv_e', status: 'expired' })] };
      if (input.status === 'pending') return { invitations: [invitation({ id: 'inv_p', status: 'pending' })] };
      return { invitations: [] };
    });

    const res = await get('/');
    expect(res.status).toBe(200);

    expect(fake.list).toHaveBeenCalled();
    for (const call of fake.list.mock.calls) {
      expect(call[0].accessToken).toBe(BEARER);
      expect(call[0]).not.toHaveProperty('organizationId');
    }
    expect(fake.list.mock.calls.map((call) => call[0].status).sort()).toEqual([
      'accepted',
      'expired',
      'pending',
      'revoked',
    ]);

    const byId = new Map((await res.json()).sellers.map((s: Row) => [s.id, s]));
    expect(byId.get(accepted.id)).toMatchObject({ invitationStatus: 'accepted' });
    expect(byId.get(expired.id)).toMatchObject({ invitationStatus: 'expired' });
    expect(byId.get(untouched.id)).toMatchObject({ invitationStatus: 'pending' });
    expect(byId.get(notInvited.id)).toMatchObject({ invitationStatus: null });

    // Persisted, and only the rows that changed are written.
    expect(store.rows.find((r) => r.id === accepted.id)?.invitationStatus).toBe('accepted');
    expect(store.rows.find((r) => r.id === expired.id)?.invitationStatus).toBe('expired');
    expect(store.updates.map((u) => u.id).sort()).toEqual([accepted.id, expired.id].sort());
  });

  it('falls back to the persisted state when list fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seller = seedSeller({ invitationId: 'inv_a', invitationStatus: 'pending' });
    fake.list.mockRejectedValue(new HubInvitationError('network_error', null, 'x'));

    const res = await get('/');
    expect(res.status).toBe(200);
    expect((await res.json()).sellers).toEqual([expect.objectContaining({ id: seller.id, invitationStatus: 'pending' })]);
    expect(store.updates).toHaveLength(0);
  });

  it('returns the persisted state without calling list when there is no client', async () => {
    forceInvitationsClientAbsentForTests();
    const seller = seedSeller({ invitationId: 'inv_a', invitationStatus: 'revoked' });

    const res = await get('/');
    expect(res.status).toBe(200);
    expect((await res.json()).sellers).toEqual([expect.objectContaining({ id: seller.id, invitationStatus: 'revoked' })]);
    expect(fake.list).not.toHaveBeenCalled();
  });

  it('does not call list when no seller carries an invitation', async () => {
    seedSeller();
    expect((await get('/')).status).toBe(200);
    expect(fake.list).not.toHaveBeenCalled();
  });
});
