import { ALL_MODULES_ENABLED } from '@fxl-sales/shared-utils/crm-model';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hubAuthContext } from '../../../apps/api/src/auth/__tests__/hub-auth-context-fixture.js';

/**
 * Acceptance: the leads export route is admin-only and reads nothing for a non-admin.
 * The route is GET /import/export/leads under the sales-ops router (sibling of GET /import/template).
 */

vi.hoisted(() => {
  for (const name of [
    'FXL_HUB_CONFIG',
    'FXL_HUB_API_URL',
    'FXL_HUB_ENVIRONMENT',
    'FXL_HUB_CLIENT_ID',
    'FXL_HUB_CLIENT_SECRET',
    'FXL_HUB_AUDIENCE',
    'SALES_ENV_FILE',
    'SALES_AUTH_FAKE',
  ]) {
    process.env[name] = '';
  }
});

const fakeDb = vi.hoisted(() => ({
  transaction: vi.fn(async (): Promise<unknown> => {
    throw new Error('fake db reached');
  }),
}));

vi.mock('../../../apps/api/src/db/client.js', () => ({
  getDb: () => fakeDb,
  getAdminDb: () => fakeDb,
  closeDb: async () => undefined,
}));

const { salesOpsRouter } = await import('../../../apps/api/src/domains/sales-ops/routes.js');

const EXPORT_PATH = '/import/export/leads';
type Role = 'admin' | 'seller' | 'finder' | undefined;
let currentRole: Role = 'admin';

function createTestApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', 'verified-account');
    c.set('orgId', 'verified-org');
    c.set('orgModules', ALL_MODULES_ENABLED);
    c.set('userRole', currentRole);
    c.set('userRoles', currentRole === 'admin' ? ['admin', 'seller', 'finder'] : currentRole ? [currentRole] : []);
    c.set('hubAuth', hubAuthContext({ accountId: 'verified-account', workspaceId: 'verified-org' }));
    await next();
  });
  app.route('/', salesOpsRouter);
  return app;
}

beforeEach(() => {
  fakeDb.transaction.mockClear();
  currentRole = 'admin';
});

describe('GET /import/export/leads admin gate', () => {
  it('answers the requireAdmin body to a non-admin and never opens a transaction', async () => {
    for (const role of ['seller', 'finder', undefined] as const) {
      currentRole = role;
      const response = await createTestApp().request(EXPORT_PATH);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'forbidden', reason: 'admin_role_required' });
    }
    expect(fakeDb.transaction).not.toHaveBeenCalled();
  });

  it('is registered: an admin reaches the database instead of a 404', async () => {
    const response = await createTestApp().request(EXPORT_PATH);
    expect(response.status).not.toBe(404);
    expect(fakeDb.transaction).toHaveBeenCalled();
  });
});
