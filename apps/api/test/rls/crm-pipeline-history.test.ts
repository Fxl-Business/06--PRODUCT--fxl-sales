/**
 * ORACLE of slice 07b: pipelines, field definitions, the lead summary, Avançar, the transition graph
 * on move, notes, follow-ups, period filters in America/Sao_Paulo and dynamic field filters - all
 * through the REAL salesOpsRouter against the test database (RLS applies).
 *
 * Run: pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/crm-pipeline-history.test.ts
 */
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import postgres from 'postgres';
import { afterAll, describe, expect, it, vi } from 'vitest';

// routes.ts imports middleware/app-auth.js, which resolves the Hub contract at module scope.
vi.hoisted(() => {
  for (const name of ['FXL_HUB_CONFIG', 'FXL_HUB_API_URL', 'FXL_HUB_ENVIRONMENT', 'FXL_HUB_CLIENT_ID', 'FXL_HUB_CLIENT_SECRET', 'FXL_HUB_AUDIENCE', 'SALES_ENV_FILE', 'SALES_AUTH_FAKE']) {
    process.env[name] = '';
  }
});

import { hubAuthContext } from '../../src/auth/__tests__/hub-auth-context-fixture.js';
import { closeDb, getDb } from '../../src/db/client.js';
import { deleteCrmForOrgs } from '../../src/db/__tests__/settlement-test-cleanup.js';
import { testDatabaseUrls } from '../../src/db/__tests__/test-database-urls.js';
import { ClientSchema, PersonSchema, createClient, createPerson } from '../../src/domains/sales-ops/service.js';

const { salesOpsRouter } = await import('../../src/domains/sales-ops/routes.js');

const { adminUrl } = testDatabaseUrls();
const sql = postgres(adminUrl, { max: 2, connection: { 'app.fxl_admin': 'true' } });
const orgIds: string[] = [];

type Who = { userId: string; role: 'admin' | 'seller'; name?: string };
const ADMIN: Who = { userId: 'hub_admin', role: 'admin', name: 'Gestora Ana' };

function appFor(orgId: string, who: Who): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', who.userId);
    c.set('orgId', orgId);
    c.set('userRole', who.role);
    c.set('userRoles', (who.role === 'admin' ? ['admin', 'seller'] : ['seller']) as never);
    c.set('salesEdition', 'full' as never);
    c.set('hubAuth', hubAuthContext({ accountId: who.userId, workspaceId: orgId, ...(who.name ? { name: who.name } : {}), email: `${who.userId}@x.test` }));
    await next();
  });
  app.route('/', salesOpsRouter);
  return app;
}

async function call(app: Hono, method: string, path: string, body?: unknown) {
  const response = await app.request(path, {
    method,
    ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let json: Record<string, any> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, any>) : {};
  } catch {
    // Hono answers an unmatched route with the plain text '404 Not Found'.
  }
  return { status: response.status, json };
}

function newOrg(label: string): string {
  const orgId = `org_hist_${label}_${Date.now()}_${randomUUID().slice(0, 6)}`;
  orgIds.push(orgId);
  return orgId;
}

afterAll(async () => {
  for (const orgId of orgIds) {
    // Delete and restore write hash-chained audit entries; the chain-order oracles need it free of leftovers.
    await sql`DELETE FROM audit_log WHERE actor_org_id = ${orgId}`;
    await deleteCrmForOrgs([orgId]);
    await sql`DELETE FROM sales_ops_person_funcoes WHERE org_id = ${orgId}`;
    await sql`DELETE FROM sales_ops_people WHERE org_id = ${orgId}`;
    await sql`DELETE FROM sales_ops_funcoes WHERE org_id = ${orgId}`;
    await sql`DELETE FROM sales_ops_clients WHERE org_id = ${orgId}`;
  }
  await sql.end();
  await closeDb();
});

async function world(label: string) {
  const orgId = newOrg(label);
  const app = appFor(orgId, ADMIN);
  const { json } = await call(app, 'GET', '/pipelines');
  const pipeline = json.pipelines[0] as { id: string; stages: Array<{ id: string; name: string }>; transitions: unknown[] };
  const stage = (name: string) => pipeline.stages.find((s) => s.name === name)!.id;
  const create = async (extra: Record<string, unknown> = {}, who: Who = ADMIN) => {
    const res = await call(appFor(orgId, who), 'POST', '/leads', { contactName: 'Ana', contactEmail: 'ana@x.com', ...extra });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    return res.json.lead as { id: string; stageId: string; fields: Array<{ key: string; value: unknown }> };
  };
  const events = async (leadId: string) =>
    sql<Array<{ from_stage_id: string | null; to_stage_id: string; reason: string | null; actor_name_snapshot: string | null }>>`
      SELECT from_stage_id, to_stage_id, reason, actor_name_snapshot FROM sales_ops_crm_lead_events WHERE lead_id = ${leadId} ORDER BY occurred_at, id`;
  return { orgId, app, pipeline, stage, create, events };
}

describe('GET /pipelines and GET /field-definitions', () => {
  it('seed the default pipeline (7 stages, 22 transitions) and the Cliente field on first read, scoped to the org', async () => {
    const a = await world('seed-a');
    const b = await world('seed-b');
    expect(a.pipeline.stages.map((s) => s.name)).toEqual(['Novo', 'Qualificação', 'Em negociação', 'Proposta', 'Ganho', 'Perdido', 'Pausado']);
    expect(a.pipeline.transitions).toHaveLength(22);
    const res = await call(a.app, 'GET', '/pipelines');
    expect(res.json.pipelines).toHaveLength(1);
    expect(res.json.pipelines[0]).toMatchObject({ name: 'Funil CRM padrão', isDefault: true, status: 'active' });
    expect(res.json.pipelines[0].stages[3]).toMatchObject({ name: 'Proposta', type: 'orcamento', behavior: 'opens_orcamentos', exitKind: null, requiresReason: false, status: 'active' });
    expect(res.json.pipelines[0].stages[5]).toMatchObject({ name: 'Perdido', type: 'saida', exitKind: 'perdido', requiresReason: true });
    // RLS plus the explicit org filter: org B's pipeline shares no id with org A's.
    expect(b.pipeline.id).not.toBe(a.pipeline.id);
    const fields = await call(a.app, 'GET', '/field-definitions');
    expect(fields.status).toBe(200);
    expect(fields.json.fields).toEqual([
      expect.objectContaining({ key: 'cliente', label: 'Cliente', kind: 'reference', referenceTarget: 'cliente', multiple: false, filterable: true, isSystem: true, removable: false, position: 1 }),
    ]);
  });

  it('the Cliente definition cannot be removed or archived through any route, and is re-created if its row vanishes', async () => {
    const w = await world('cliente-def');
    const [def] = await sql<{ id: string }[]>`SELECT id FROM sales_ops_field_definitions WHERE org_id = ${w.orgId} AND key = 'cliente'`;
    for (const [method, path, body] of [
      ['POST', '/field-definitions', { key: 'x', label: 'X', kind: 'text' }],
      ['PUT', '/field-definitions', {}],
      ['PATCH', `/field-definitions/${def!.id}`, { status: 'archived' }],
      ['PUT', `/field-definitions/${def!.id}`, { removable: true }],
      ['DELETE', `/field-definitions/${def!.id}`, undefined],
      ['POST', `/field-definitions/${def!.id}/archive`, {}],
      ['DELETE', '/pipelines', undefined],
      ['PATCH', `/pipelines/${w.pipeline.id}`, { status: 'archived' }],
    ] as const) {
      const res = await call(w.app, method, path, body);
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    const [still] = await sql<{ status: string; removable: boolean }[]>`SELECT status, removable FROM sales_ops_field_definitions WHERE id = ${def!.id}`;
    expect(still).toEqual({ status: 'active', removable: false });
    // The database refuses a removable non-system row and the service re-seeds a missing Cliente.
    await expect(sql`INSERT INTO sales_ops_field_definitions (org_id, key, label, removable, is_system) VALUES (${w.orgId}, 'k', 'K', false, false)`).rejects.toThrow();
    await sql`DELETE FROM sales_ops_field_definitions WHERE id = ${def!.id}`;
    const again = await call(w.app, 'GET', '/field-definitions');
    expect(again.json.fields.map((f: { key: string }) => f.key)).toEqual(['cliente']);
  });
});

describe('the transition graph on move', () => {
  it('an absent pair is 409 transition_not_allowed and writes nothing; an allowed pair writes exactly one event', async () => {
    const w = await world('move');
    const lead = await w.create();
    const before = await w.events(lead.id);
    expect(before).toHaveLength(1);

    const refused = await call(w.app, 'POST', `/leads/${lead.id}/move`, { stageId: w.stage('Em negociação'), position: 0 });
    expect(refused.status).toBe(409);
    expect(refused.json).toEqual({ error: 'transition_not_allowed' });
    expect(await w.events(lead.id)).toHaveLength(1);
    const [stuck] = await sql<{ stage_id: string }[]>`SELECT stage_id FROM sales_ops_crm_leads WHERE id = ${lead.id}`;
    expect(stuck!.stage_id).toBe(lead.stageId);

    const ok = await call(w.app, 'POST', `/leads/${lead.id}/move`, { stageId: w.stage('Qualificação'), position: 0 });
    expect(ok.status).toBe(200);
    const events = await w.events(lead.id);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ from_stage_id: lead.stageId, to_stage_id: w.stage('Qualificação'), actor_name_snapshot: 'Gestora Ana' });
  });

  it('a reorder inside one column writes no event and never moves stage_changed_at', async () => {
    const w = await world('reorder');
    const first = await w.create({ contactName: 'Um' });
    await w.create({ contactName: 'Dois' });
    const [before] = await sql<{ stage_changed_at: Date }[]>`SELECT stage_changed_at FROM sales_ops_crm_leads WHERE id = ${first.id}`;
    const res = await call(w.app, 'POST', `/leads/${first.id}/move`, { stageId: first.stageId, position: 1 });
    expect(res.status).toBe(200);
    const [after] = await sql<{ stage_changed_at: Date }[]>`SELECT stage_changed_at FROM sales_ops_crm_leads WHERE id = ${first.id}`;
    expect(after!.stage_changed_at.toISOString()).toBe(before!.stage_changed_at.toISOString());
    expect(await w.events(first.id)).toHaveLength(1);
  });

  it('a stage of another pipeline is never reachable', async () => {
    const w = await world('crosspipe');
    const lead = await w.create();
    const [other] = await sql<{ id: string }[]>`INSERT INTO sales_ops_pipelines (org_id, name, position) VALUES (${w.orgId}, 'Carteira', 1) RETURNING id`;
    const [foreign] = await sql<{ id: string }[]>`INSERT INTO sales_ops_pipeline_stages (org_id, pipeline_id, name, position) VALUES (${w.orgId}, ${other!.id}, 'Novo', 1) RETURNING id`;
    const res = await call(w.app, 'POST', `/leads/${lead.id}/move`, { stageId: foreign!.id, position: 0 });
    expect(res).toMatchObject({ status: 409, json: { error: 'transition_not_allowed' } });
  });
});

describe('POST /leads/:id/advance and GET /leads/:id/summary', () => {
  it('lists only the graph-allowed next stages and the timeline of the lead', async () => {
    const w = await world('summary');
    const lead = await w.create();
    const res = await call(w.app, 'GET', `/leads/${lead.id}/summary`);
    expect(res.status).toBe(200);
    expect(res.json.pipeline).toEqual({ id: w.pipeline.id, name: 'Funil CRM padrão' });
    expect(res.json.stage).toMatchObject({ name: 'Novo', type: 'normal', exitKind: null });
    expect(res.json.nextStages.map((s: { name: string }) => s.name)).toEqual(['Qualificação', 'Ganho', 'Perdido', 'Pausado']);
    expect(res.json.nextStages.find((s: { name: string }) => s.name === 'Perdido')).toMatchObject({ type: 'saida', exitKind: 'perdido', requiresReason: true });
    expect(res.json.timeline).toEqual([expect.objectContaining({ kind: 'stage_changed', fromStageName: null, toStageName: 'Novo', actorName: 'Gestora Ana' })]);
    expect(res.json.followups).toEqual([]);
    expect(res.json.lead.id).toBe(lead.id);
  });

  it('advance writes exactly ONE server-side event, the note linked to it and the follow-up, in one act', async () => {
    const w = await world('advance');
    const lead = await w.create();
    const res = await call(w.app, 'POST', `/leads/${lead.id}/advance`, {
      toStageId: w.stage('Qualificação'),
      nextStep: 'Ligar na segunda',
      dueOn: '2026-10-26',
      note: 'Cliente pediu retorno',
    });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json.lead).toMatchObject({ id: lead.id, stageId: w.stage('Qualificação') });
    expect(res.json.lead.fields).toBeInstanceOf(Array);
    const events = await w.events(lead.id);
    expect(events).toHaveLength(2);
    const [event] = await sql<{ id: string }[]>`SELECT id FROM sales_ops_crm_lead_events WHERE lead_id = ${lead.id} AND from_stage_id IS NOT NULL`;
    const notes = await sql<{ event_id: string | null; body: string; author_name_snapshot: string }[]>`SELECT event_id, body, author_name_snapshot FROM sales_ops_crm_lead_notes WHERE lead_id = ${lead.id}`;
    expect(notes).toEqual([{ event_id: event!.id, body: 'Cliente pediu retorno', author_name_snapshot: 'Gestora Ana' }]);
    const followups = await sql<{ next_step: string; due_on: string; created_by_name: string }[]>`SELECT next_step, due_on::text AS due_on, created_by_name FROM sales_ops_crm_lead_followups WHERE lead_id = ${lead.id}`;
    expect(followups).toEqual([{ next_step: 'Ligar na segunda', due_on: '2026-10-26', created_by_name: 'Gestora Ana' }]);
    // The card is at the END of the destination column and stage_changed_at moved.
    const summary = await call(w.app, 'GET', `/leads/${lead.id}/summary`);
    expect(summary.json.timeline.map((t: { kind: string }) => t.kind).sort()).toEqual(['followup', 'note', 'stage_changed', 'stage_changed']);
    expect(summary.json.nextStages.map((s: { name: string }) => s.name)).toEqual(['Novo', 'Em negociação', 'Ganho', 'Perdido', 'Pausado']);
  });

  it('a follow-up with a date is mandatory unless the destination is an exit', async () => {
    const w = await world('followup-required');
    const lead = await w.create();
    const to = w.stage('Qualificação');
    for (const body of [{ toStageId: to }, { toStageId: to, nextStep: 'Ligar' }, { toStageId: to, dueOn: '2026-10-26' }, { toStageId: to, nextStep: '  ', dueOn: '2026-10-26' }]) {
      const res = await call(w.app, 'POST', `/leads/${lead.id}/advance`, body);
      expect(res.status).toBe(400);
      expect(res.json).toMatchObject({ error: 'validation_error', reason: 'followup_required' });
    }
    expect((await call(w.app, 'POST', `/leads/${lead.id}/advance`, { toStageId: to, nextStep: 'Ligar', dueOn: '2026-02-30' })).status).toBe(400);
    expect(await w.events(lead.id)).toHaveLength(1);
    // An exit needs none ...
    const pausa = await call(w.app, 'POST', `/leads/${lead.id}/advance`, { toStageId: w.stage('Pausado') });
    expect(pausa.status).toBe(200);
    // ... and a half follow-up on an exit is still refused.
    const lead2 = await w.create({ contactName: 'Dois' });
    const half = await call(w.app, 'POST', `/leads/${lead2.id}/advance`, { toStageId: w.stage('Ganho'), nextStep: 'x' });
    expect(half.json).toMatchObject({ reason: 'followup_required' });
  });

  it('perdido requires a reason and stores it; ganho does not', async () => {
    const w = await world('reason');
    const lead = await w.create();
    const missing = await call(w.app, 'POST', `/leads/${lead.id}/advance`, { toStageId: w.stage('Perdido') });
    expect(missing.status).toBe(400);
    expect(missing.json).toMatchObject({ error: 'validation_error', reason: 'reason_required' });
    expect(await w.events(lead.id)).toHaveLength(1);
    const lost = await call(w.app, 'POST', `/leads/${lead.id}/advance`, { toStageId: w.stage('Perdido'), reason: 'Sem orçamento' });
    expect(lost.status).toBe(200);
    expect(lost.json.lead).toMatchObject({ lostReason: 'Sem orçamento', stageExitKind: 'perdido', stageType: 'saida' });
    const events = await w.events(lead.id);
    expect(events[1]).toMatchObject({ reason: 'Sem orçamento' });
    const won = await w.create({ contactName: 'Ganha' });
    expect((await call(w.app, 'POST', `/leads/${won.id}/advance`, { toStageId: w.stage('Ganho') })).status).toBe(200);
  });

  it('an invalid transition is 409, and Proposta (opens a proposta) is 409 sale_required_for_conversion', async () => {
    const w = await world('invalid');
    const lead = await w.create();
    const bad = await call(w.app, 'POST', `/leads/${lead.id}/advance`, { toStageId: w.stage('Em negociação'), nextStep: 'x', dueOn: '2026-10-26' });
    expect(bad).toMatchObject({ status: 409, json: { error: 'transition_not_allowed' } });
    expect(await w.events(lead.id)).toHaveLength(1);
    for (const to of ['Qualificação', 'Em negociação']) {
      expect((await call(w.app, 'POST', `/leads/${lead.id}/advance`, { toStageId: w.stage(to), nextStep: 'x', dueOn: '2026-10-26' })).status).toBe(200);
    }
    const conversion = await call(w.app, 'POST', `/leads/${lead.id}/advance`, { toStageId: w.stage('Proposta'), nextStep: 'x', dueOn: '2026-10-26' });
    expect(conversion).toMatchObject({ status: 409, json: { error: 'sale_required_for_conversion' } });
    expect(await w.events(lead.id)).toHaveLength(3);
  });

  it('a restore into another etapa writes the event too', async () => {
    const w = await world('restore');
    const lead = await w.create();
    expect((await call(w.app, 'POST', `/leads/${lead.id}/delete`)).status).toBe(204);
    await call(w.app, 'PATCH', `/lead-stages/${w.stage('Novo')}`, { status: 'archived' });
    const restored = await call(w.app, 'POST', `/leads/${lead.id}/restore`);
    expect(restored.status).toBe(200);
    const events = await w.events(lead.id);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ from_stage_id: w.stage('Novo'), to_stage_id: w.stage('Qualificação') });
  });
});

describe('notes and follow-ups', () => {
  it('POST notes and followups answer 201 with the created row; blank input is 400', async () => {
    const w = await world('notes');
    const lead = await w.create();
    const note = await call(w.app, 'POST', `/leads/${lead.id}/notes`, { body: '  Ligou  ' });
    expect(note.status).toBe(201);
    expect(note.json.note).toMatchObject({ body: 'Ligou', authorName: 'Gestora Ana' });
    expect((await call(w.app, 'POST', `/leads/${lead.id}/notes`, { body: '  ' })).status).toBe(400);
    expect((await call(w.app, 'POST', `/leads/${randomUUID()}/notes`, { body: 'x' })).status).toBe(404);
    const followup = await call(w.app, 'POST', `/leads/${lead.id}/followups`, { nextStep: 'Enviar proposta', dueOn: '2026-10-22' });
    expect(followup.status).toBe(201);
    expect(followup.json.followup).toMatchObject({ nextStep: 'Enviar proposta', dueOn: '2026-10-22', doneAt: null });
    expect((await call(w.app, 'POST', `/leads/${lead.id}/followups`, { nextStep: 'x' })).status).toBe(400);
    expect((await call(w.app, 'POST', `/leads/${lead.id}/followups`, { nextStep: 'x', dueOn: '2026-10-22', ownerPersonId: randomUUID() })).json).toMatchObject({ reason: 'owner_not_found' });
  });

  it('GET /followups: mine vs team, status and a due-day period; team needs an admin; done is idempotent', async () => {
    const w = await world('list');
    const db = getDb();
    const ana = await createPerson(db, w.orgId, PersonSchema.parse({ displayName: 'Ana Vendedora', isSeller: true, contactEmail: 'ana@x.test' }));
    if (typeof ana === 'string') throw new Error(ana);
    await sql`UPDATE sales_ops_people SET hub_account_id = 'hub_ana' WHERE id = ${ana.id}`;
    const seller: Who = { userId: 'hub_ana', role: 'seller', name: 'Ana Vendedora' };
    const bruno = await createPerson(db, w.orgId, PersonSchema.parse({ displayName: 'Bruno', isSeller: true }));
    if (typeof bruno === 'string') throw new Error(bruno);
    await sql`UPDATE sales_ops_people SET hub_account_id = 'hub_bruno' WHERE id = ${bruno.id}`;
    const brunoWho: Who = { userId: 'hub_bruno', role: 'seller', name: 'Bruno' };

    const anaLead = await w.create({ contactName: 'Lead da Ana', sellerPersonId: ana.id });
    const brunoLead = await w.create({ contactName: 'Lead do Bruno', sellerPersonId: bruno.id });
    const a1 = await call(appFor(w.orgId, seller), 'POST', `/leads/${anaLead.id}/followups`, { nextStep: 'A1', dueOn: '2026-10-20' });
    await call(appFor(w.orgId, seller), 'POST', `/leads/${anaLead.id}/followups`, { nextStep: 'A2', dueOn: '2026-11-05' });
    await call(appFor(w.orgId, brunoWho), 'POST', `/leads/${brunoLead.id}/followups`, { nextStep: 'B1', dueOn: '2026-10-21' });

    const mine = await call(appFor(w.orgId, seller), 'GET', '/followups?scope=mine');
    expect(mine.json.followups.map((f: { nextStep: string }) => f.nextStep)).toEqual(['A1', 'A2']);
    expect(mine.json.followups[0]).toEqual({ id: expect.any(String), leadId: anaLead.id, leadContactName: 'Lead da Ana', nextStep: 'A1', dueOn: '2026-10-20', ownerName: 'Ana Vendedora', doneAt: null });
    expect((await call(appFor(w.orgId, seller), 'GET', '/followups?scope=team')).status).toBe(403);
    const team = await call(w.app, 'GET', '/followups?scope=team');
    expect(team.json.followups.map((f: { nextStep: string }) => f.nextStep)).toEqual(['A1', 'B1', 'A2']);
    const period = await call(w.app, 'GET', '/followups?scope=team&from=2026-10-21&to=2026-10-31');
    expect(period.json.followups.map((f: { nextStep: string }) => f.nextStep)).toEqual(['B1']);
    expect((await call(w.app, 'GET', '/followups?from=2026-10-31&to=2026-10-01')).status).toBe(400);

    // A colleague cannot see or complete it; the owner can, twice, keeping the first done_at.
    expect((await call(appFor(w.orgId, brunoWho), 'POST', `/followups/${a1.json.followup.id}/done`)).status).toBe(404);
    const done = await call(appFor(w.orgId, seller), 'POST', `/followups/${a1.json.followup.id}/done`);
    expect(done.status).toBe(200);
    const again = await call(appFor(w.orgId, seller), 'POST', `/followups/${a1.json.followup.id}/done`);
    expect(again.json.followup.doneAt).toBe(done.json.followup.doneAt);
    const open = await call(appFor(w.orgId, seller), 'GET', '/followups?scope=mine&status=open');
    expect(open.json.followups.map((f: { nextStep: string }) => f.nextStep)).toEqual(['A2']);
    const doneList = await call(appFor(w.orgId, seller), 'GET', '/followups?scope=mine&status=done');
    expect(doneList.json.followups.map((f: { nextStep: string }) => f.nextStep)).toEqual(['A1']);
  });
});

describe('seller scope and RLS isolation on the new routes', () => {
  it('a seller reads the summary and advances only leads in scope; another org answers 404', async () => {
    const w = await world('scope');
    const other = await world('scope-other');
    const db = getDb();
    const ana = await createPerson(db, w.orgId, PersonSchema.parse({ displayName: 'Ana', isSeller: true }));
    const bruno = await createPerson(db, w.orgId, PersonSchema.parse({ displayName: 'Bruno', isSeller: true }));
    if (typeof ana === 'string' || typeof bruno === 'string') throw new Error('person');
    await sql`UPDATE sales_ops_people SET hub_account_id = 'hub_ana' WHERE id = ${ana.id}`;
    await sql`UPDATE sales_ops_people SET hub_account_id = 'hub_bruno' WHERE id = ${bruno.id}`;
    const anaWho: Who = { userId: 'hub_ana', role: 'seller', name: 'Ana' };
    const brunosLead = await w.create({ sellerPersonId: bruno.id });
    const anasLead = await w.create({ sellerPersonId: ana.id });
    const foreign = await other.create();

    const mineRes = await call(appFor(w.orgId, anaWho), 'GET', `/leads/${anasLead.id}/summary`);
    expect(mineRes.status).toBe(200);
    expect((await call(appFor(w.orgId, anaWho), 'GET', `/leads/${brunosLead.id}/summary`)).status).toBe(404);
    expect((await call(appFor(w.orgId, anaWho), 'POST', `/leads/${brunosLead.id}/advance`, { toStageId: w.stage('Perdido'), reason: 'x' })).status).toBe(404);
    expect((await call(appFor(w.orgId, anaWho), 'POST', `/leads/${brunosLead.id}/notes`, { body: 'x' })).status).toBe(404);
    expect((await call(appFor(w.orgId, anaWho), 'POST', `/leads/${brunosLead.id}/followups`, { nextStep: 'x', dueOn: '2026-10-26' })).status).toBe(404);
    // Org isolation: the id of another org's lead is a plain 404, for an admin too.
    expect((await call(w.app, 'GET', `/leads/${foreign.id}/summary`)).status).toBe(404);
    expect((await call(w.app, 'POST', `/leads/${foreign.id}/advance`, { toStageId: w.stage('Perdido'), reason: 'x' })).status).toBe(404);
    const own = await call(appFor(w.orgId, anaWho), 'POST', `/leads/${anasLead.id}/advance`, { toStageId: w.stage('Qualificação'), nextStep: 'x', dueOn: '2026-10-26' });
    expect(own.status).toBe(200);
    const [events] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM sales_ops_crm_lead_events WHERE lead_id = ${brunosLead.id}`;
    expect(events!.n).toBe(1);
  });
});

describe('period and dynamic filters', () => {
  it('filters on created_at by Sao Paulo civil days: 02:30Z on D+1 is day D, 03:00Z is D+1', async () => {
    const w = await world('period');
    const inside = await w.create({ contactName: 'Dia 20 a noite' });
    const next = await w.create({ contactName: 'Dia 21' });
    const earlier = await w.create({ contactName: 'Dia 19' });
    await sql`UPDATE sales_ops_crm_leads SET created_at = '2026-10-21T02:30:00Z' WHERE id = ${inside.id}`;
    await sql`UPDATE sales_ops_crm_leads SET created_at = '2026-10-21T03:00:00Z' WHERE id = ${next.id}`;
    await sql`UPDATE sales_ops_crm_leads SET created_at = '2026-10-20T02:59:59Z' WHERE id = ${earlier.id}`;
    const names = async (qs: string) => ((await call(w.app, 'GET', `/leads?stageId=${inside.stageId}&${qs}`)).json.leads as Array<{ contactName: string }>).map((l) => l.contactName).sort();
    expect(await names('from=2026-10-20&to=2026-10-20')).toEqual(['Dia 20 a noite']);
    expect(await names('from=2026-10-21&to=2026-10-21')).toEqual(['Dia 21']);
    expect(await names('from=2026-10-19&to=2026-10-19')).toEqual(['Dia 19']);
    expect(await names('from=2026-10-20')).toEqual(['Dia 20 a noite', 'Dia 21']);
    expect(await names('to=2026-10-19')).toEqual(['Dia 19']);
    const summary = await call(w.app, 'GET', '/leads/summary?from=2026-10-20&to=2026-10-20');
    expect(summary.json.stages).toEqual([{ stageId: inside.stageId, count: 1, estimatedValueBrl: 0 }]);
    expect((await call(w.app, 'GET', `/leads?stageId=${inside.stageId}&from=2026-10-21&to=2026-10-20`)).status).toBe(400);
    expect((await call(w.app, 'GET', `/leads?stageId=${inside.stageId}&from=2026-02-30`)).status).toBe(400);
  });

  it('filters by cliente, options and money (min/max); an unknown or non-filterable key is 400', async () => {
    const w = await world('dynamic');
    const db = getDb();
    const alfa = await createClient(db, w.orgId, ClientSchema.parse({ name: 'Alfa' }));
    const beta = await createClient(db, w.orgId, ClientSchema.parse({ name: 'Beta' }));
    await sql`INSERT INTO sales_ops_field_definitions (org_id, key, label, kind, options, filterable, position) VALUES (${w.orgId}, 'origem', 'Origem', 'options', ${JSON.stringify([{ key: 'site', label: 'Site' }, { key: 'indicacao', label: 'Indicação' }])}::jsonb, true, 5)`;
    await sql`INSERT INTO sales_ops_field_definitions (org_id, key, label, kind, filterable, position) VALUES (${w.orgId}, 'verba', 'Verba', 'money', true, 6)`;
    await sql`INSERT INTO sales_ops_field_definitions (org_id, key, label, kind, filterable, position) VALUES (${w.orgId}, 'obs', 'Obs', 'text', false, 7)`;
    const l1 = await w.create({ contactName: 'L1', clientId: alfa.id, fields: [{ key: 'origem', value: 'site' }, { key: 'verba', value: 100000 }, { key: 'obs', value: 'x' }] });
    await w.create({ contactName: 'L2', clientId: beta.id, fields: [{ key: 'origem', value: 'indicacao' }, { key: 'verba', value: 500000 }] });
    const names = async (qs: string) => ((await call(w.app, 'GET', `/leads?stageId=${l1.stageId}&${qs}`)).json.leads as Array<{ contactName: string }>).map((l) => l.contactName).sort();
    expect(await names(`f.cliente=${alfa.id}`)).toEqual(['L1']);
    expect(await names(`f.cliente=${beta.id}`)).toEqual(['L2']);
    expect(await names('f.origem=indicacao')).toEqual(['L2']);
    expect(await names('f.verba.min=200000')).toEqual(['L2']);
    expect(await names('f.verba.max=200000')).toEqual(['L1']);
    expect(await names(`f.verba.min=50000&f.verba.max=600000&f.cliente=${alfa.id}`)).toEqual(['L1']);
    const summary = await call(w.app, 'GET', `/leads/summary?f.cliente=${beta.id}`);
    expect(summary.json.stages).toEqual([{ stageId: l1.stageId, count: 1, estimatedValueBrl: 0 }]);
    for (const qs of ['f.obs=x', 'f.nope=1', 'f.cliente=not-a-uuid', 'f.verba.min=abc', 'f.cliente.min=1', 'f.=1', 'f.origem.min=1']) {
      const res = await call(w.app, 'GET', `/leads?stageId=${l1.stageId}&${qs}`);
      expect(res.status, qs).toBe(400);
      expect(res.json).toMatchObject({ error: 'validation_error', reason: 'invalid_filter' });
    }
  });
});

describe('lead write responses carry the dynamic fields', () => {
  it('POST and PATCH answer the lead with a fields array, null clears and an omitted field stays', async () => {
    const w = await world('wire');
    await sql`INSERT INTO sales_ops_field_definitions (org_id, key, label, kind, position) VALUES (${w.orgId}, 'obs', 'Obs', 'text', 5)`;
    const [def] = await sql<{ id: string }[]>`SELECT id FROM sales_ops_field_definitions WHERE org_id = ${w.orgId} AND key = 'obs'`;
    const created = await call(w.app, 'POST', '/leads', { contactName: 'Ana', contactPhone: '119', fields: [{ fieldId: def!.id, value: 'texto' }] });
    expect(created.status).toBe(201);
    expect(created.json.lead.fields.find((f: { key: string }) => f.key === 'obs')).toEqual({ fieldId: def!.id, key: 'obs', value: 'texto' });
    const id = created.json.lead.id as string;
    const untouched = await call(w.app, 'PATCH', `/leads/${id}`, { contactName: 'Outra' });
    expect(untouched.json.lead.fields.find((f: { key: string }) => f.key === 'obs').value).toBe('texto');
    const cleared = await call(w.app, 'PATCH', `/leads/${id}`, { fields: [{ fieldId: def!.id, value: null }] });
    expect(cleared.json.lead.fields.find((f: { key: string }) => f.key === 'obs').value).toBeNull();
    expect((await call(w.app, 'POST', '/leads', { contactName: 'Sem contato' })).status).toBe(400);
  });
});

describe('the board lock order', () => {
  it('advance and cross-stage moves on the SAME lead run concurrently for 15 rounds without deadlock and keep positions dense', async () => {
    const w = await world('concurrent');
    const lead = await w.create({ contactName: 'Mesmo lead' });
    // Novo, Qualificação and Pausado are pairwise connected in both directions by the default graph,
    // so the lead can keep moving among them and every round has two valid cross-stage targets.
    const cycle = ['Novo', 'Qualificação', 'Pausado'].map((name) => w.stage(name));
    const answersAllowed = (res: { status: number; json: Record<string, any> }) =>
      (res.status === 200) || (res.status === 409 && res.json.error === 'transition_not_allowed');
    for (let round = 0; round < 15; round++) {
      const [current] = await sql<{ stage_id: string }[]>`SELECT stage_id FROM sales_ops_crm_leads WHERE org_id = ${w.orgId} AND id = ${lead.id}`;
      const [first, second] = cycle.filter((stageId) => stageId !== current!.stage_id);
      const [advanced, movedFirst, movedSecond, movedAgain, created] = await Promise.all([
        call(w.app, 'POST', `/leads/${lead.id}/advance`, { toStageId: first, nextStep: 'Retornar', dueOn: '2026-10-26' }),
        call(w.app, 'POST', `/leads/${lead.id}/move`, { stageId: first, position: 0 }),
        call(w.app, 'POST', `/leads/${lead.id}/move`, { stageId: second, position: 0 }),
        call(w.app, 'POST', `/leads/${lead.id}/move`, { stageId: first, position: 0 }),
        call(w.app, 'POST', '/leads', { contactName: `Lateral ${round}`, contactEmail: `lateral${round}@x.com` }),
      ]);
      for (const res of [advanced, movedFirst, movedSecond, movedAgain]) {
        expect(res.status, JSON.stringify(res.json)).not.toBe(500);
        expect(answersAllowed(res), JSON.stringify(res.json)).toBe(true);
      }
      expect(created.status, JSON.stringify(created.json)).toBe(201);
    }
    const columns = await sql<{ stage_id: string; positions: number[] }[]>`
      SELECT stage_id, array_agg(position ORDER BY position) AS positions
      FROM sales_ops_crm_leads WHERE org_id = ${w.orgId} AND deleted_at IS NULL
      GROUP BY stage_id`;
    for (const column of columns) {
      const p = column.positions;
      for (let i = 1; i < p.length; i++) expect(p[i]! - p[i - 1]!, `stage ${column.stage_id}`).toBe(1);
    }
  });
});
