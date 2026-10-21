/**
 * Unit oracle for the CAPABILITY gate. No env, no Hub: the organization's modules
 * are put on the context by hand, exactly as `getOrgModules` would leave them.
 */
import { ALL_MODULES_ENABLED, modulesForEdition, type OrgModules } from '@fxl-sales/shared-utils/crm-model';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { SalesCapability, SalesEdition } from '@fxl-sales/shared-utils/sales-edition';
import { ADMIN_ROLE_REQUIRED_BODY } from '../require-admin.js';
import { EDITION_CAPABILITY_BODY, requireCapability } from '../require-capability.js';

const loadOrgModules = vi.hoisted(() => vi.fn());
vi.mock('../../domains/org-modules/service.js', () => ({ loadOrgModules }));

const ALL_CAPABILITIES: readonly SalesCapability[] = [
  'proposals',
  'commissions',
  'catalog',
  'clients',
  'import',
  'finders',
  'history',
  'leadFullFields',
];

/** The leads edition (Construbom) grants these two; everything else is refused. */
const LEADS_GRANTED: readonly SalesCapability[] = ['clients', 'import'];
const LEADS_REFUSED: readonly SalesCapability[] = ALL_CAPABILITIES.filter(
  (capability) => !LEADS_GRANTED.includes(capability),
);

function appFor(edition: SalesEdition | undefined, capability: SalesCapability) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (edition !== undefined) c.set('orgModules', modulesForEdition(edition));
    await next();
  });
  app.get('/probe', requireCapability(capability), (c) => c.json({ reached: true }));
  return app;
}

describe('requireCapability', () => {
  it('EDITION_CAPABILITY_BODY serializes byte-exactly', () => {
    expect(JSON.stringify(EDITION_CAPABILITY_BODY)).toBe(
      '{"error":"forbidden","code":"edition_capability"}',
    );
  });

  it.each(LEADS_REFUSED)('the leads edition is refused %s with the byte-exact 403', async (capability) => {
    const res = await appFor('leads', capability).request('http://localhost/probe');
    expect(res.status).toBe(403);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.text()).toBe('{"error":"forbidden","code":"edition_capability"}');
  });

  it.each(LEADS_GRANTED)('the leads edition passes %s (clients + import)', async (capability) => {
    const res = await appFor('leads', capability).request('http://localhost/probe');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reached: true });
  });

  it.each(ALL_CAPABILITIES)('the full edition passes %s', async (capability) => {
    const res = await appFor('full', capability).request('http://localhost/probe');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reached: true });
  });

  it.each(ALL_CAPABILITIES)('a missing salesEdition is treated as full for %s', async (capability) => {
    const res = await appFor(undefined, capability).request('http://localhost/probe');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reached: true });
  });

  it('the denial never reaches the handler', async () => {
    const handler = vi.fn((c: { json: (body: unknown) => Response }) => c.json({ reached: true }));
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('orgModules', modulesForEdition('leads'));
      await next();
    });
    app.get('/probe', requireCapability('proposals'), (c) => handler(c));
    const res = await app.request('http://localhost/probe');
    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it('a toggled flag changes the answer: leads modules plus comissoes passes commissions', async () => {
    const modules: OrgModules = { ...modulesForEdition('leads'), comissoes: true };
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('orgModules', modules);
      await next();
    });
    app.get('/commissions', requireCapability('commissions'), (c) => c.json({ reached: true }));
    app.get('/proposals', requireCapability('proposals'), (c) => c.json({ reached: true }));
    expect((await app.request('http://localhost/commissions')).status).toBe(200);
    expect((await app.request('http://localhost/proposals')).status).toBe(403);
  });

  it('a capability needing one module is refused when that module is off', async () => {
    const modules: OrgModules = { ...ALL_MODULES_ENABLED, catalogo: false };
    for (const capability of ['catalog', 'leadFullFields'] as const) {
      const app = new Hono();
      app.use('*', async (c, next) => {
        c.set('orgModules', modules);
        await next();
      });
      app.get('/probe', requireCapability(capability), (c) => c.json({ reached: true }));
      expect((await app.request('http://localhost/probe')).status, capability).toBe(403);
    }
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('orgModules', modules);
      await next();
    });
    app.get('/probe', requireCapability('proposals'), (c) => c.json({ reached: true }));
    expect((await app.request('http://localhost/probe')).status).toBe(200);
  });

  it('the body is not the admin body and carries no reason', () => {
    expect(EDITION_CAPABILITY_BODY).not.toEqual(ADMIN_ROLE_REQUIRED_BODY);
    expect('reason' in EDITION_CAPABILITY_BODY).toBe(false);
  });

  it('loads the modules once per request even behind two gates', async () => {
    loadOrgModules.mockReset();
    loadOrgModules.mockResolvedValue({ modules: ALL_MODULES_ENABLED, sources: {} });
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('hubAuth', { entitlements: { modules: [] } } as never);
      c.set('orgId', 'org_x' as never);
      await next();
    });
    app.get('/p', requireCapability('proposals'), requireCapability('clients'), (c) => c.json({ reached: true }));
    const res = await app.request('http://localhost/p');
    expect(res.status).toBe(200);
    expect(loadOrgModules).toHaveBeenCalledTimes(1);
  });

  it('a store failure is not a denial and not a pass', async () => {
    loadOrgModules.mockReset();
    loadOrgModules.mockRejectedValue(new Error('db down'));
    const handler = vi.fn((c: { json: (body: unknown) => Response }) => c.json({ reached: true }));
    const app = new Hono();
    app.onError((_error, c) => c.json({ error: 'internal' }, 500));
    app.use('*', async (c, next) => {
      c.set('hubAuth', { entitlements: { modules: [] } } as never);
      c.set('orgId', 'org_x' as never);
      await next();
    });
    app.get('/p', requireCapability('proposals'), (c) => handler(c));
    const res = await app.request('http://localhost/p');
    expect(res.status).toBe(500);
    expect(handler).not.toHaveBeenCalled();
  });
});
