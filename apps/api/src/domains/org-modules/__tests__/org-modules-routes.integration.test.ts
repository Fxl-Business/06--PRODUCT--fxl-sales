/**
 * THE ORACLE for per-organization modules (phase 3, slice 11c): the real `salesOpsRouter`
 * against the real database, RLS live. A Construbom-like org (token module
 * `sales.edition.leads`, no module rows) gets exactly the leads capabilities; a full org is
 * unchanged; an admin PUT flips a capability on the very next request; an orcamento stage
 * acts only while `orcamentos` is on.
 */
import { randomUUID } from 'node:crypto';
import { CRM_MODULE_KEYS, modulesForEdition } from '@fxl-sales/shared-utils/crm-model';
import { todayInSaoPaulo } from '@fxl-sales/shared-utils/sao-paulo-day';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { hubAuthContext } from '../../../auth/__tests__/hub-auth-context-fixture.js';
import { deleteCrmForOrgs } from '../../../db/__tests__/settlement-test-cleanup.js';
import { closeDb, getAdminDb } from '../../../db/client.js';
import { env } from '../../../env.js';
import { salesOpsRouter } from '../../sales-ops/routes.js';

// The router transitively resolves the Hub contract at module scope; this file drives an
// already-verified context, so the ambient Hub configuration is made unambiguously absent.
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

const ACCOUNT_ID = 'hub-account-modules-int';
const LEADS_TOKEN = ['sales.edition.leads'];
const ORIGINAL_OPERATORS = env.SALES_MODULE_OPERATOR_ACCOUNT_IDS;
const FORBIDDEN_EDITION_TEXT = '{"error":"forbidden","code":"edition_capability"}';

const seededOrgIds: string[] = [];
let currentOrgId = '';
let tokenModules: string[] = [];

function newOrg(label: string): string {
  const orgId = `org_mod_int_${label}_${Date.now()}_${randomUUID().slice(0, 8)}`;
  seededOrgIds.push(orgId);
  return orgId;
}

/** A tenant admin account on the active org, carrying the token's module claim. */
function createTestApp(orgId: string, modules: string[]): Hono {
  currentOrgId = orgId;
  tokenModules = modules;
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', ACCOUNT_ID);
    c.set('orgId', currentOrgId);
    c.set('userRole', 'admin');
    c.set('userRoles', ['admin', 'seller', 'finder']);
    c.set(
      'hubAuth',
      hubAuthContext({ accountId: ACCOUNT_ID, workspaceId: currentOrgId, entitlements: { modules: tokenModules } }),
    );
    await next();
  });
  app.route('/', salesOpsRouter);
  return app;
}

async function send(app: Hono, method: string, path: string, body?: unknown): Promise<Response> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'content-type': 'application/json' };
  }
  return app.request(`http://localhost${path}`, init);
}

async function moduleRows(orgId: string) {
  return getAdminDb().execute<{ module_key: string; enabled: boolean; source: string }>(
    sql`SELECT module_key, enabled, source FROM sales_ops_org_modules WHERE org_id = ${orgId} ORDER BY module_key`,
  );
}

function enabledKeys(modules: Record<string, boolean>): string[] {
  return CRM_MODULE_KEYS.filter((key) => modules[key] === true).sort();
}

beforeAll(() => {
  env.SALES_MODULE_OPERATOR_ACCOUNT_IDS = ACCOUNT_ID;
});

afterEach(async () => {
  const admin = getAdminDb();
  for (const orgId of seededOrgIds) {
    await admin.execute(sql`DELETE FROM audit_log WHERE actor_org_id = ${orgId}`);
    await deleteCrmForOrgs([orgId]);
    await admin.execute(sql`DELETE FROM sales_ops_org_modules WHERE org_id = ${orgId}`);
  }
  seededOrgIds.length = 0;
});

afterAll(async () => {
  env.SALES_MODULE_OPERATOR_ACCOUNT_IDS = ORIGINAL_OPERATORS;
  await closeDb();
});

describe('org modules: the leads token backfills exactly the leads capabilities', () => {
  it('a Construbom-like org gets today\'s leads capabilities, byte-exact 403 for the rest', async () => {
    const orgId = newOrg('leads');
    const app = createTestApp(orgId, LEADS_TOKEN);

    const first = await send(app, 'GET', '/summary');
    expect(first.status).toBe(403);
    expect(await first.text()).toBe(FORBIDDEN_EDITION_TEXT);

    for (const path of ['/sales', '/products', '/areas', '/funcoes', '/history']) {
      const res = await send(app, 'GET', path);
      expect(res.status, path).toBe(403);
      expect(await res.text(), path).toBe(FORBIDDEN_EDITION_TEXT);
    }
    const settings = await send(app, 'PUT', '/settings', {});
    expect(settings.status).toBe(403);
    expect(await settings.text()).toBe(FORBIDDEN_EDITION_TEXT);

    for (const path of ['/clients', '/import/template', '/people', '/bootstrap']) {
      expect((await send(app, 'GET', path)).status, path).toBe(200);
    }

    const rows = await moduleRows(orgId);
    expect(rows).toHaveLength(7);
    expect(rows.every((row) => row.source === 'token_backfill')).toBe(true);
    expect(rows.filter((row) => row.enabled).map((row) => row.module_key).sort()).toEqual(['clientes', 'importacao']);
  });

  it('the token no longer decides after the first request', async () => {
    const orgId = newOrg('token_after');
    await send(createTestApp(orgId, LEADS_TOKEN), 'GET', '/summary');
    const fullToken = createTestApp(orgId, []);
    expect((await send(fullToken, 'GET', '/summary')).status).toBe(403);
  });

  it('a full org (token modules []) is unchanged', async () => {
    const orgId = newOrg('full');
    const app = createTestApp(orgId, []);
    for (const path of ['/summary', '/sales', '/products', '/areas', '/funcoes', '/history', '/clients']) {
      expect((await send(app, 'GET', path)).status, path).toBe(200);
    }
    const rows = await moduleRows(orgId);
    expect(rows).toHaveLength(7);
    expect(rows.every((row) => row.enabled)).toBe(true);
  });

  it('toggling a flag through the admin route changes the 403 without a redeploy', async () => {
    const orgId = newOrg('toggle');
    const app = createTestApp(orgId, LEADS_TOKEN);

    expect((await send(app, 'PUT', '/org-modules', { modules: { orcamentos: true } })).status).toBe(200);
    expect((await send(app, 'GET', '/summary')).status).toBe(200);
    expect((await send(app, 'GET', '/sales')).status).toBe(200);

    expect((await send(app, 'PUT', '/org-modules', { modules: { orcamentos: false } })).status).toBe(200);
    expect((await send(app, 'GET', '/summary')).status).toBe(403);

    expect((await send(app, 'PUT', '/org-modules', { modules: { catalogo: true } })).status).toBe(200);
    expect((await send(app, 'GET', '/products')).status).toBe(200);
    expect((await send(app, 'GET', '/history')).status).toBe(403);
  });

  it('ten concurrent first requests on a Construbom-like org: all 403, exactly 7 rows', async () => {
    const orgId = newOrg('race');
    const app = createTestApp(orgId, LEADS_TOKEN);
    const statuses = await Promise.all(Array.from({ length: 10 }, () => send(app, 'GET', '/summary').then((r) => r.status)));
    expect(statuses.every((status) => status === 403)).toBe(true);
    expect(await moduleRows(orgId)).toHaveLength(7);
  });

  it('GET /bootstrap exposes the org modules and keeps every existing key', async () => {
    const leadsOrg = newOrg('boot_leads');
    const leads = await (await send(createTestApp(leadsOrg, LEADS_TOKEN), 'GET', '/bootstrap')).json();
    expect(leads.orgModules).toEqual(modulesForEdition('leads'));
    for (const key of ['sales', 'products', 'clients', 'people', 'settings']) expect(leads).toHaveProperty(key);

    const fullOrg = newOrg('boot_full');
    const full = await (await send(createTestApp(fullOrg, []), 'GET', '/bootstrap')).json();
    expect(enabledKeys(full.orgModules)).toEqual(enabledKeys(modulesForEdition('full')));
  });

  it('GET /org-modules is admin only and not capability gated', async () => {
    const orgId = newOrg('admin_only');
    const app = createTestApp(orgId, LEADS_TOKEN);
    const res = await send(app, 'GET', '/org-modules');
    expect(res.status).toBe(200);
    expect(enabledKeys((await res.json()).modules)).toEqual(['clientes', 'importacao']);
  });
});

describe('an orcamento stage acts only while the orcamentos module is on', () => {
  it('advances to the orcamento stage as a normal stage when off, and refuses it with 409 when on', async () => {
    const orgId = newOrg('orcamento');
    const app = createTestApp(orgId, LEADS_TOKEN);

    const pipelines = (await (await send(app, 'GET', '/pipelines')).json()).pipelines as Array<{
      stages: Array<{ id: string; type: string; behavior: string }>;
      transitions: Array<{ fromStageId: string; toStageId: string }>;
    }>;
    const pipeline = pipelines[0]!;
    const stageById = new Map(pipeline.stages.map((stage) => [stage.id, stage]));
    const transition = pipeline.transitions.find((t) => stageById.get(t.toStageId)?.type === 'orcamento');
    expect(transition).toBeDefined();
    const orcamentoStageId = transition!.toStageId;
    const fromStageId = transition!.fromStageId;
    const advance = { toStageId: orcamentoStageId, nextStep: 'Enviar proposta', dueOn: todayInSaoPaulo() };

    const createLead = async (label: string): Promise<string> => {
      const res = await send(app, 'POST', '/leads', {
        contactName: `Lead ${label}`,
        contactPhone: '11999990000',
        stageId: fromStageId,
      });
      expect(res.status, label).toBe(201);
      return (await res.json()).lead.id as string;
    };

    // orcamentos OFF: the orcamento stage is an ordinary stage.
    const offLead = await createLead('off');
    const off = await send(app, 'POST', `/leads/${offLead}/advance`, advance);
    expect(off.status).toBe(200);
    const stagesOff = (await (await send(app, 'GET', '/lead-stages')).json()).stages as Array<{
      id: string;
      kind: string;
      behavior: string;
    }>;
    const offStage = stagesOff.find((stage) => stage.id === orcamentoStageId)!;
    expect(offStage.kind).toBe('normal');
    expect(offStage.behavior).toBe('none');

    // orcamentos ON: the same advance answers the proposta refusal.
    expect((await send(app, 'PUT', '/org-modules', { modules: { orcamentos: true } })).status).toBe(200);
    const onLead = await createLead('on');
    const on = await send(app, 'POST', `/leads/${onLead}/advance`, advance);
    expect(on.status).toBe(409);
    expect(await on.json()).toEqual({ error: 'sale_required_for_conversion' });
    const stagesOn = (await (await send(app, 'GET', '/lead-stages')).json()).stages as Array<{
      id: string;
      kind: string;
      behavior: string;
    }>;
    const onStage = stagesOn.find((stage) => stage.id === orcamentoStageId)!;
    expect(onStage.kind).toBe('conversion');
    expect(onStage.behavior).toBe('opens_orcamentos');
  });
});
