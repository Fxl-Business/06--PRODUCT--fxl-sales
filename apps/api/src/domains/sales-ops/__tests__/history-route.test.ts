import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Route contract for GET /api/v1/sales-ops/history.
 *
 * The isolation proof lives in the integration oracle
 * (apps/api/test/rls/audit-history-org-scope.test.ts) because only a real
 * database can prove that the tenant connection CAN see another org's rows and
 * still does not get them back. What this file pins is the BOUNDARY: the org id
 * comes from the verified context and never from the query string, the filters
 * fail loudly rather than silently, and the history service never reaches for
 * the cross-tenant admin connection.
 */

const mockedDb = { name: 'history-route-test-db' };
const historyMocks = vi.hoisted(() => ({
  listOrgAuditHistory: vi.fn(),
}));

vi.mock('../../../db/client.js', () => ({
  getDb: () => mockedDb,
}));

vi.mock('../../audit/history-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../audit/history-service.js')>();
  return {
    ...actual,
    listOrgAuditHistory: historyMocks.listOrgAuditHistory,
  };
});

const { salesOpsRouter } = await import('../routes.js');

type TestRole = 'admin' | 'seller' | 'finder' | undefined;

let currentRole: TestRole;
let currentHubClaims: { name?: string; email?: string } = {};

function createTestApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', 'verified-account');
    c.set('orgId', 'verified-org');
    c.set('userRole', currentRole);
    c.set('userRoles', currentRole ? [currentRole] : []);
    c.set('hubAuth', {
      accountId: 'verified-account',
      workspaceId: 'verified-org',
      claims: {
        entitlements: { access: true, modules: [] },
        roles: { workspace: 'admin' },
        ...currentHubClaims,
      },
    });
    await next();
  });
  app.route('/', salesOpsRouter);
  return app;
}

const app = createTestApp();

const emptyPage = { entries: [], nextCursor: null };

function lastCall() {
  const call = historyMocks.listOrgAuditHistory.mock.calls.at(-1);
  if (!call) throw new Error('listOrgAuditHistory was not called');
  return { db: call[0], orgId: call[1] as string, opts: call[2] as Record<string, unknown> };
}

describe('GET /history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentRole = 'admin';
    currentHubClaims = { name: 'Ana Verificada' };
    historyMocks.listOrgAuditHistory.mockResolvedValue(emptyPage);
  });

  it('refuses a seller and never calls the service', async () => {
    currentRole = 'seller';
    const res = await app.request('/history');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden', reason: 'admin_role_required' });
    expect(historyMocks.listOrgAuditHistory).not.toHaveBeenCalled();
  });

  it('serves an admin with the verified org context', async () => {
    const res = await app.request('/history');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(emptyPage);
    expect(lastCall().orgId).toBe('verified-org');
  });

  it('ignores a smuggled orgId or actorOrgId in the query string', async () => {
    const res = await app.request('/history?orgId=other-org&actorOrgId=other-org');
    expect(res.status).toBe(200);
    const call = lastCall();
    expect(call.orgId).toBe('verified-org');
    const serializedArgs = JSON.stringify(historyMocks.listOrgAuditHistory.mock.calls.at(-1));
    expect(serializedArgs).not.toContain('other-org');
    expect(serializedArgs).not.toContain('actorOrgId');
  });

  it.each(['limit=abc', 'limit=0', 'limit=201', 'cursor=abc', 'cursor=-1'])(
    'rejects ?%s with a 400 and never calls the service',
    async (query) => {
      const res = await app.request(`/history?${query}`);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('validation_error');
      expect(historyMocks.listOrgAuditHistory).not.toHaveBeenCalled();
    },
  );

  it('accepts the max limit and leaves the default to the service', async () => {
    expect((await app.request('/history?limit=200')).status).toBe(200);
    expect(lastCall().opts.limit).toBe(200);

    await app.request('/history');
    expect(lastCall().opts.limit).toBeUndefined();
  });

  it('validates entityType and forwards a valid one verbatim', async () => {
    expect((await app.request('/history?entityType=')).status).toBe(400);
    expect((await app.request(`/history?entityType=${'x'.repeat(121)}`)).status).toBe(400);
    expect(historyMocks.listOrgAuditHistory).not.toHaveBeenCalled();

    expect((await app.request('/history?entityType=produto')).status).toBe(200);
    expect(lastCall().opts.entityType).toBe('produto');
  });

  it('parses the action set slice 04 actually issues', async () => {
    const res = await app.request('/history?action=cadastro.archived,cadastro.restored');
    expect(res.status).toBe(200);
    expect(lastCall().opts.actions).toEqual(['cadastro.archived', 'cadastro.restored']);

    await app.request('/history?action=cadastro.archived');
    expect(lastCall().opts.actions).toEqual(['cadastro.archived']);

    await app.request('/history');
    expect(lastCall().opts.actions).toBeUndefined();
  });

  it.each(['action=a,,b', 'action=a,', 'action=', `action=${Array.from({ length: 11 }, (_, i) => `a${i}`).join(',')}`])(
    'rejects ?%s with a 400 and never calls the service',
    async (query) => {
      const res = await app.request(`/history?${query}`);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('validation_error');
      expect(historyMocks.listOrgAuditHistory).not.toHaveBeenCalled();
    },
  );

  it('passes the caller identity from the verified token', async () => {
    await app.request('/history');
    expect(lastCall().opts.selfActor).toEqual({
      userId: 'verified-account',
      displayName: 'Ana Verificada',
    });

    currentHubClaims = {};
    await app.request('/history');
    expect(lastCall().opts.selfActor).toEqual({
      userId: 'verified-account',
      displayName: null,
    });
  });

  it('never reaches for the cross-tenant admin connection', () => {
    // The org-scoped history read must never import getAdminDb: audit_log has no
    // RLS, so its WHERE clause is the only isolation control there is.
    const source = readFileSync(
      fileURLToPath(new URL('../../audit/history-service.ts', import.meta.url)),
      'utf8',
    );
    expect(source).not.toMatch(/getAdminDb/);
  });
});
