/**
 * Unit oracle for the platform-operator gate on module writes. The allow-list is the
 * validated env, mutated per case and restored after each.
 */
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../env.js';
import { ADMIN_ROLE_REQUIRED_BODY } from '../require-admin.js';
import { MODULE_OPERATOR_REQUIRED_BODY, moduleOperatorAccountIds, requireModuleOperator } from '../require-module-operator.js';

const ORIGINAL = env.SALES_MODULE_OPERATOR_ACCOUNT_IDS;

afterEach(() => {
  env.SALES_MODULE_OPERATOR_ACCOUNT_IDS = ORIGINAL;
});

function appFor(userId: string, handler = vi.fn((c: { json: (body: unknown) => Response }) => c.json({ reached: true }))) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', userId);
    await next();
  });
  app.put('/org-modules', requireModuleOperator, (c) => handler(c));
  return { app, handler };
}

describe('moduleOperatorAccountIds', () => {
  it('is empty when the variable is absent or blank', () => {
    expect(moduleOperatorAccountIds(undefined).size).toBe(0);
    expect(moduleOperatorAccountIds('').size).toBe(0);
    expect(moduleOperatorAccountIds(' , ,').size).toBe(0);
  });

  it('splits, trims and drops empty entries', () => {
    expect([...moduleOperatorAccountIds(' acc_a , acc_b ,,')]).toEqual(['acc_a', 'acc_b']);
  });
});

describe('requireModuleOperator', () => {
  it('denies everyone when the allow-list is empty, with the byte-exact operator body', async () => {
    env.SALES_MODULE_OPERATOR_ACCOUNT_IDS = undefined;
    const { app, handler } = appFor('acc_admin');
    const res = await app.request('http://localhost/org-modules', { method: 'PUT' });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('{"error":"forbidden","code":"module_operator_required"}');
    expect(MODULE_OPERATOR_REQUIRED_BODY.code).toBe('module_operator_required');
    expect(handler).not.toHaveBeenCalled();
  });

  it('passes a listed account id', async () => {
    env.SALES_MODULE_OPERATOR_ACCOUNT_IDS = 'acc_other, acc_operator';
    const { app, handler } = appFor('acc_operator');
    const res = await app.request('http://localhost/org-modules', { method: 'PUT' });
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('refuses an unlisted account id', async () => {
    env.SALES_MODULE_OPERATOR_ACCOUNT_IDS = 'acc_operator';
    const { app, handler } = appFor('acc_tenant_admin');
    expect((await app.request('http://localhost/org-modules', { method: 'PUT' })).status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it('is never the admin body (a tenant admin and an operator are different refusals)', () => {
    expect(MODULE_OPERATOR_REQUIRED_BODY).not.toEqual(ADMIN_ROLE_REQUIRED_BODY);
  });
});
