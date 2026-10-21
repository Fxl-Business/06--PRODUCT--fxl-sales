/**
 * Unit oracle for the admin module routes on the REAL `salesOpsRouter`. The loader is
 * a stateful in-memory fake (one row set per organization, backfilled from the token on
 * first sight); the summary handler is stubbed so a gate that passes is observable.
 */
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hubAuthContext } from '../../../auth/__tests__/hub-auth-context-fixture.js';
import { env } from '../../../env.js';
import { ADMIN_ROLE_REQUIRED_BODY } from '../../../middleware/require-admin.js';
import { salesOpsRouter } from '../../sales-ops/routes.js';
import { updateOrgModules } from '../service.js';

vi.mock('../service.js', async () => {
  const { CRM_MODULE_KEYS, modulesForEdition } = await import('@fxl-sales/shared-utils/crm-model');
  const { resolveSalesEdition } = await import('@fxl-sales/shared-utils/sales-edition');
  const rows = new Map<string, { modules: Record<string, boolean>; sources: Record<string, string> }>();
  const clone = (state: { modules: Record<string, boolean>; sources: Record<string, string> }) => ({
    modules: { ...state.modules },
    sources: { ...state.sources },
  });
  const ensure = (orgId: string, tokenModules: readonly unknown[] | undefined) => {
    if (!rows.has(orgId)) {
      rows.set(orgId, {
        modules: modulesForEdition(resolveSalesEdition(tokenModules)),
        sources: Object.fromEntries(CRM_MODULE_KEYS.map((key) => [key, 'token_backfill'])),
      });
    }
    return rows.get(orgId)!;
  };
  return {
    loadOrgModules: vi.fn(async (orgId: string, tokenModules: readonly unknown[] | undefined) =>
      clone(ensure(orgId, tokenModules)),
    ),
    updateOrgModules: vi.fn(async (orgId: string, tokenModules: readonly unknown[] | undefined, patch: Record<string, boolean>) => {
      const state = ensure(orgId, tokenModules);
      for (const [key, enabled] of Object.entries(patch)) {
        state.modules[key] = enabled;
        state.sources[key] = 'admin';
      }
      return clone(state);
    }),
  };
});

vi.mock('../../sales-ops/service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../sales-ops/service.js')>();
  return { ...actual, getSalesOpsSummary: vi.fn(async () => ({ stub: true })) };
});

const OPERATOR = 'acc_operator';

let orgSeq = 0;
let currentOrg = '';
let currentRole: 'admin' | 'seller' = 'admin';
let currentAccount = OPERATOR;
let currentModules: string[] = [];

function appForCurrent(): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', currentAccount);
    c.set('orgId', currentOrg);
    c.set('userRole', currentRole);
    c.set('userRoles', currentRole === 'admin' ? ['admin', 'seller'] : ['seller']);
    c.set('hubAuth', hubAuthContext({ accountId: currentAccount, workspaceId: currentOrg, entitlements: { modules: currentModules } }));
    await next();
  });
  app.route('/', salesOpsRouter);
  return app;
}

async function call(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'content-type': 'application/json' };
  }
  return appForCurrent().request(`http://localhost${path}`, init);
}

beforeEach(() => {
  vi.clearAllMocks();
  env.SALES_MODULE_OPERATOR_ACCOUNT_IDS = OPERATOR;
  currentOrg = `org_routes_${++orgSeq}`;
  currentRole = 'admin';
  currentAccount = OPERATOR;
  currentModules = ['sales.edition.leads'];
});

describe('org modules admin routes', () => {
  it('answers GET and PUT to a non-admin with the admin body and touches nothing', async () => {
    currentRole = 'seller';
    for (const [method, body] of [
      ['GET', undefined],
      ['PUT', { modules: { orcamentos: true } }],
    ] as const) {
      const res = await call(method, '/org-modules', body);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual(ADMIN_ROLE_REQUIRED_BODY);
    }
    expect(updateOrgModules).not.toHaveBeenCalled();
  });

  it.each([
    ['empty body', {}],
    ['empty modules', { modules: {} }],
    ['non-boolean value', { modules: { orcamentos: 'yes' } }],
    ['unknown module key', { modules: { nope: true } }],
    ['extra top-level key', { modules: { orcamentos: true }, org: 'x' }],
  ])('PUT rejects %s with 400 validation_error', async (_label, body) => {
    const res = await call('PUT', '/org-modules', body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('validation_error');
    expect(updateOrgModules).not.toHaveBeenCalled();
  });

  it('an admin who is not a platform operator cannot toggle, but can still read', async () => {
    currentAccount = 'acc_tenant_admin';
    const put = await call('PUT', '/org-modules', { modules: { orcamentos: true } });
    expect(put.status).toBe(403);
    expect(await put.json()).toEqual({ error: 'forbidden', code: 'module_operator_required' });
    expect(updateOrgModules).not.toHaveBeenCalled();
    const get = await call('GET', '/org-modules');
    expect(get.status).toBe(200);
  });

  it('an empty allow-list refuses every admin', async () => {
    env.SALES_MODULE_OPERATOR_ACCOUNT_IDS = undefined;
    const res = await call('PUT', '/org-modules', { modules: { orcamentos: true } });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('module_operator_required');
  });

  it('a PUT flips a gated route on the very next request, and back', async () => {
    const gated = () => call('GET', '/summary');
    expect((await gated()).status).toBe(403);

    const on = await call('PUT', '/org-modules', { modules: { orcamentos: true } });
    expect(on.status).toBe(200);
    const body = await on.json();
    expect(body.modules.orcamentos).toBe(true);
    expect(body.sources.orcamentos).toBe('admin');
    expect((await gated()).status).toBe(200);

    await call('PUT', '/org-modules', { modules: { orcamentos: false } });
    expect((await gated()).status).toBe(403);
  });

  it('the PUT response carries exactly the modules and sources shape', async () => {
    const res = await call('PUT', '/org-modules', { modules: { comissoes: true } });
    expect(Object.keys(await res.json()).sort()).toEqual(['modules', 'sources']);
  });
});
