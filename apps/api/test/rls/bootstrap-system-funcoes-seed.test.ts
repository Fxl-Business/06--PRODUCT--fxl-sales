/**
 * GET /bootstrap seeds the system funcoes (vendedor, finder) for an org with none.
 *
 * Run once: `VITEST_INTEGRATION=1 pnpm exec vitest run test/rls/bootstrap-system-funcoes-seed.test.ts`
 */
import { modulesForEdition } from '@fxl-sales/shared-utils/crm-model';
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import postgres from 'postgres';
import { afterAll, describe, expect, it, vi } from 'vitest';

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

import { hubAuthContext } from '../../src/auth/__tests__/hub-auth-context-fixture.js';
import { closeDb } from '../../src/db/client.js';
import { testDatabaseUrls } from '../../src/db/__tests__/test-database-urls.js';
import { deleteCrmForOrgs } from '../../src/db/__tests__/settlement-test-cleanup.js';

const { salesOpsRouter } = await import('../../src/domains/sales-ops/routes.js');

const { adminUrl: ADMIN_DB_URL } = testDatabaseUrls();
const adminClient = postgres(ADMIN_DB_URL, {
  max: 2,
  connection: { 'app.fxl_admin': 'true' },
});
const orgIds: string[] = [];

function newOrg(label: string): string {
  const orgId = `org_funcseed_${label}_${Date.now()}_${randomUUID().slice(0, 8)}`;
  orgIds.push(orgId);
  return orgId;
}

function appFor(orgId: string): Hono {
  const hono = new Hono();
  hono.use('*', async (c, next) => {
    c.set('userId', 'hub_funcseed_tester');
    c.set('orgId', orgId);
    c.set('userRole', 'admin');
    c.set('userRoles', ['admin'] as never);
    c.set('orgModules', modulesForEdition('full'));
    c.set(
      'hubAuth',
      hubAuthContext({ accountId: 'hub_funcseed_tester', workspaceId: orgId, name: 'Teste' }),
    );
    await next();
  });
  hono.route('/', salesOpsRouter);
  return hono;
}

type FuncaoRow = {
  id: string;
  slug: string;
  status: string;
  updated_at: Date;
};

async function systemRows(orgId: string): Promise<FuncaoRow[]> {
  return adminClient<FuncaoRow[]>`
    SELECT id, slug, status, updated_at FROM sales_ops_funcoes
    WHERE org_id = ${orgId} ORDER BY slug
  `;
}

afterAll(async () => {
  for (const orgId of orgIds) {
    await deleteCrmForOrgs([orgId]);
    await adminClient`DELETE FROM sales_ops_funcoes WHERE org_id = ${orgId}`;
  }
  await adminClient.end();
  await closeDb();
});

describe('GET /bootstrap seeds the system funcoes', () => {
  it('an org with no funcao gets vendedor and finder, and a second call adds none', async () => {
    const orgId = newOrg('fresh');
    expect(await systemRows(orgId)).toHaveLength(0);
    const app = appFor(orgId);

    const first = await app.request('/bootstrap');
    expect(first.status).toBe(200);
    const body = (await first.json()) as { funcoes?: { slug: string }[] };
    expect((body.funcoes ?? []).map((f) => f.slug).sort()).toEqual(['finder', 'vendedor']);
    const afterFirst = await systemRows(orgId);
    expect(afterFirst.map((r) => r.slug)).toEqual(['finder', 'vendedor']);

    expect((await app.request('/bootstrap')).status).toBe(200);
    const afterSecond = await systemRows(orgId);
    expect(afterSecond.map((r) => r.id)).toEqual(afterFirst.map((r) => r.id));
  });

  it('two concurrent bootstraps give no 500 and exactly one vendedor and one finder', async () => {
    const orgId = newOrg('race');
    const app = appFor(orgId);

    const responses = await Promise.all([app.request('/bootstrap'), app.request('/bootstrap')]);

    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect((await systemRows(orgId)).map((r) => r.slug)).toEqual(['finder', 'vendedor']);
  });

  it('writes nothing to existing system funcoes, archived included', async () => {
    const orgId = newOrg('existing');
    const app = appFor(orgId);
    await app.request('/bootstrap');
    await adminClient`
      UPDATE sales_ops_funcoes SET status = 'archived'
      WHERE org_id = ${orgId} AND slug = 'finder'
    `;
    const before = await systemRows(orgId);

    expect((await app.request('/bootstrap')).status).toBe(200);

    const after = await systemRows(orgId);
    expect(after).toEqual(before);
    expect(after.find((r) => r.slug === 'finder')?.status).toBe('archived');
  });

  it('a custom funcao named Vendedor with another slug does not break the bootstrap', async () => {
    const orgId = newOrg('squat');
    await adminClient`
      INSERT INTO sales_ops_funcoes (org_id, name, slug, is_system)
      VALUES (${orgId}, 'Vendedor', 'vendedor-custom', false)
    `;

    const response = await appFor(orgId).request('/bootstrap');

    expect(response.status).toBe(200);
  });
});
