/**
 * Unit oracle for the edition CAPABILITY gate. No env, no Hub: the edition is
 * put on the context by hand, exactly as `applyHubAuthContext` would.
 */
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { SalesCapability, SalesEdition } from '@fxl-sales/shared-utils/sales-edition';
import { ADMIN_ROLE_REQUIRED_BODY } from '../require-admin.js';
import { EDITION_CAPABILITY_BODY, requireCapability } from '../require-capability.js';

const ALL_CAPABILITIES: readonly SalesCapability[] = [
  'proposals',
  'commissions',
  'catalog',
  'import',
  'finders',
  'history',
  'leadFullFields',
];

function appFor(edition: SalesEdition | undefined, capability: SalesCapability) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (edition !== undefined) c.set('salesEdition', edition);
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

  it.each(ALL_CAPABILITIES)('the leads edition is refused %s with the byte-exact 403', async (capability) => {
    const res = await appFor('leads', capability).request('http://localhost/probe');
    expect(res.status).toBe(403);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.text()).toBe('{"error":"forbidden","code":"edition_capability"}');
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
      c.set('salesEdition', 'leads');
      await next();
    });
    app.get('/probe', requireCapability('proposals'), (c) => handler(c));
    const res = await app.request('http://localhost/probe');
    expect(res.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it('the body is not the admin body and carries no reason', () => {
    expect(EDITION_CAPABILITY_BODY).not.toEqual(ADMIN_ROLE_REQUIRED_BODY);
    expect('reason' in EDITION_CAPABILITY_BODY).toBe(false);
  });
});
