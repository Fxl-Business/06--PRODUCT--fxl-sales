/**
 * Seed on read (vendas-crm-unificado slice 02, the ECV bug): an org with NO
 * etapa row gets the four default etapas the first time its stages are read,
 * in both editions, through GET /lead-stages and GET /bootstrap.
 *
 * Every request runs over the APP connection (the tenant role, RLS live). The
 * admin `postgres.Sql` is only for raw counts and cleanup.
 *
 * Run once: `VITEST_INTEGRATION=1 pnpm exec vitest run test/rls/lead-stages-seed-on-read.test.ts`
 */
import { randomUUID } from 'node:crypto';
import { DEFAULT_PIPELINE_STAGES } from '@fxl-sales/shared-utils/default-pipeline';
import { Hono } from 'hono';
import postgres from 'postgres';
import { afterAll, describe, expect, it, vi } from 'vitest';

// routes.ts imports middleware/app-auth.js, which resolves the Hub contract at
// module scope: blank the Hub names before anything is imported, or this file
// inherits whatever apps/api/.env holds.
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
import { closeDb, getDb } from '../../src/db/client.js';
import { testDatabaseUrls } from '../../src/db/__tests__/test-database-urls.js';
import { deleteCrmForOrgs } from '../../src/db/__tests__/settlement-test-cleanup.js';
import { LeadStageSchema } from '../../src/domains/sales-ops/leads/schemas.js';
import {
  createLeadStage,
  listLeadStages,
  updateLeadStage,
} from '../../src/domains/sales-ops/leads/stage-service.js';
import { ensureLeadStagesForOrg } from '../../src/domains/sales-ops/leads/stages-seed.js';

const { leadStagesRouter } = await import('../../src/domains/sales-ops/leads/stage-routes.js');
const { salesOpsRouter } = await import('../../src/domains/sales-ops/routes.js');

const { adminUrl: ADMIN_DB_URL } = testDatabaseUrls();
const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;

const orgIds: string[] = [];
const adminClient = postgres(ADMIN_DB_URL, { max: 2, ...ADMIN_CONNECTION_OPTIONS });

function newOrg(label: string): string {
  const orgId = `org_seedread_${label}_${Date.now()}_${randomUUID().slice(0, 8)}`;
  orgIds.push(orgId);
  return orgId;
}

type Edition = 'full' | 'leads';

/** A tenant-scoped app for one caller. Mounts the router under test. */
function appFor(
  orgId: string,
  options: { roles: string[]; edition: Edition; router: 'stages' | 'bootstrap' },
): Hono {
  const hono = new Hono();
  hono.use('*', async (c, next) => {
    c.set('userId', 'hub_seed_tester');
    c.set('orgId', orgId);
    c.set('userRole', options.roles[0]);
    c.set('userRoles', options.roles as never);
    c.set('salesEdition', options.edition as never);
    c.set(
      'hubAuth',
      hubAuthContext({ accountId: 'hub_seed_tester', workspaceId: orgId, name: 'Teste' }),
    );
    await next();
  });
  if (options.router === 'stages') hono.route('/', leadStagesRouter);
  else hono.route('/', salesOpsRouter);
  return hono;
}

async function countStages(orgId: string): Promise<number> {
  const [row] = await adminClient<{ n: number }[]>`
    SELECT count(*)::int AS n FROM sales_ops_pipeline_stages WHERE org_id = ${orgId}
  `;
  return row?.n ?? -1;
}

/** The seven stages of the default CRM pipeline, in the derived legacy vocabulary. */
function expectedDefaults(): [string, string, boolean, number][] {
  return DEFAULT_PIPELINE_STAGES.map((stage) => {
    const kind = stage.type === 'orcamento' ? 'conversion' : stage.exitKind === 'perdido' ? 'lost' : 'normal';
    return [stage.label, kind, kind !== 'normal', stage.order];
  });
}

type StageJson = {
  id: string;
  name: string;
  kind: string;
  isSystem: boolean;
  position: number;
};

async function getStages(app: Hono): Promise<{ status: number; stages: StageJson[] }> {
  const response = await app.request('/lead-stages');
  const body = (await response.json()) as { stages?: StageJson[] };
  return { status: response.status, stages: body.stages ?? [] };
}

afterAll(async () => {
  for (const orgId of orgIds) {
    await deleteCrmForOrgs([orgId]);
  }
  await adminClient.end();
  await closeDb();
});

describe('lead stages are seeded on read', () => {
  it('GET /lead-stages seeds the seven default etapas for an org with none', async () => {
    const orgId = newOrg('fresh');
    const { status, stages } = await getStages(appFor(orgId, { roles: ['admin'], edition: 'full', router: 'stages' }));

    expect(status).toBe(200);
    expect(stages.map((s) => [s.name, s.kind, s.isSystem, s.position])).toEqual(expectedDefaults());
    expect(await countStages(orgId)).toBe(7);
  });

  it('a second GET /lead-stages does not duplicate', async () => {
    const orgId = newOrg('twice');
    const app = appFor(orgId, { roles: ['admin'], edition: 'full', router: 'stages' });

    const first = await getStages(app);
    const second = await getStages(app);

    expect(first.stages.map((s) => s.id)).toEqual(second.stages.map((s) => s.id));
    expect(await countStages(orgId)).toBe(7);
  });

  it.each([
    ['full', 'seller'],
    ['leads', 'seller'],
    ['leads', 'admin'],
  ] as const)('GET /lead-stages seeds in the %s edition for a %s', async (edition, role) => {
    const orgId = newOrg(`${edition}_${role}`);
    const { status } = await getStages(appFor(orgId, { roles: [role], edition, router: 'stages' }));

    expect(status).toBe(200);
    expect(await countStages(orgId)).toBe(7);
  });

  it('GET /bootstrap seeds the seven etapas and a second bootstrap adds none', async () => {
    const orgId = newOrg('bootstrap');
    const app = appFor(orgId, { roles: ['admin'], edition: 'leads', router: 'bootstrap' });

    const first = await app.request('/bootstrap');
    expect(first.status).toBe(200);
    const body = (await first.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty('stages');
    expect(await countStages(orgId)).toBe(7);

    const second = await app.request('/bootstrap');
    expect(second.status).toBe(200);
    expect(await countStages(orgId)).toBe(7);
  });

  it('an org that renamed one etapa and archived another gets no reinsertion', async () => {
    const orgId = newOrg('renamed');
    const db = getDb();
    await ensureLeadStagesForOrg(db, orgId);
    const stages = await listLeadStages(db, orgId);
    const novo = stages.find((s) => s.name === 'Novo');
    const negociacao = stages.find((s) => s.name === 'Em negociação');
    if (!novo || !negociacao) throw new Error('seed did not write the default etapas');

    const renamed = await updateLeadStage(db, orgId, novo.id, { name: 'Prospecção' });
    expect(renamed).not.toBeNull();
    const archived = await updateLeadStage(db, orgId, negociacao.id, { status: 'archived' });
    expect(archived).not.toBeNull();

    const app = appFor(orgId, { roles: ['admin'], edition: 'full', router: 'stages' });
    const first = await getStages(app);
    const second = await getStages(app);

    const expectedNames = DEFAULT_PIPELINE_STAGES.map((stage) => (stage.label === 'Novo' ? 'Prospecção' : stage.label));
    expect(first.stages.map((s) => s.name)).toEqual(expectedNames);
    expect(second.stages.map((s) => s.name)).toEqual(expectedNames);
    expect(await countStages(orgId)).toBe(7);
    expect(first.stages.some((s) => s.name === 'Novo')).toBe(false);
  });

  it('an org that created its own first etapa is never seeded', async () => {
    const orgId = newOrg('own');
    const db = getDb();
    const created = await createLeadStage(db, orgId, LeadStageSchema.parse({ name: 'Somente minha' }));
    if (typeof created === 'string') throw new Error(`unexpected sentinel: ${created}`);

    const { stages } = await getStages(appFor(orgId, { roles: ['admin'], edition: 'full', router: 'stages' }));

    expect(stages.map((s) => s.name)).toEqual(['Somente minha']);
    expect(await countStages(orgId)).toBe(1);
  });

  it('seeding org A leaves org B untouched', async () => {
    const orgA = newOrg('isolation_a');
    const orgB = newOrg('isolation_b');

    await getStages(appFor(orgA, { roles: ['admin'], edition: 'full', router: 'stages' }));

    expect(await countStages(orgA)).toBe(7);
    expect(await countStages(orgB)).toBe(0);
  });

  it('eight concurrent first GETs all answer 200 and leave exactly seven rows', async () => {
    for (let round = 0; round < 3; round += 1) {
      const orgId = newOrg(`race_${round}`);
      const app = appFor(orgId, { roles: ['admin'], edition: 'full', router: 'stages' });

      const responses = await Promise.all(Array.from({ length: 8 }, () => app.request('/lead-stages')));
      const bodies = await Promise.all(responses.map((r) => r.json() as Promise<{ stages: StageJson[] }>));

      expect(responses.map((r) => r.status)).toEqual(Array(8).fill(200));
      const idSets = bodies.map((b) => b.stages.map((s) => s.id).sort().join(','));
      expect(new Set(idSets).size).toBe(1);
      expect(bodies[0]?.stages).toHaveLength(7);
      expect(await countStages(orgId)).toBe(7);
    }
  });
});
