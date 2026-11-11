/**
 * Acceptance: delete every live, unconverted lead of one etapa in one act, and
 * restore that act as a batch (slice api-lote). Written from the approved criteria
 * and the existing lixeira rules, before any implementation.
 *
 * THE CONTRACT THIS FILE PINS (the Builder follows it; see manifest.json):
 *
 *   POST /leads/stages/:stageId/delete-all      (requireAdmin, org from the token)
 *     200 { batchId: uuid, deletedCount: number, skippedConvertedCount: number }
 *     404 { error: 'not_found' } for an unknown, malformed or other-org stage
 *     403 { error: 'forbidden', reason: 'admin_role_required' } for a non-admin
 *   POST /leads/batches/:batchId/restore        (requireAdmin)
 *     200 { restoredCount: number }
 *     404 { error: 'not_found' } for an unknown, malformed or other-org batch
 *     403 admin body for a non-admin
 *   GET  /leads/deleted                         items gain `batchId: string | null`
 *   column sales_ops_crm_leads.deleted_batch_id (uuid, NULL when not in a batch)
 *
 * No DELETE verb exists anywhere. Every lead goes through the same rules as
 * deleteLead / restoreLead: soft delete (deleted_at, deleted_by_*), the column
 * renumbers dense over live cards, one `lead.deleted` / `lead.restored` ledger entry
 * per lead in the same transaction, the cliente (client_id and the clientes table)
 * is never touched.
 *
 * Every write goes over the APP connection (tenant role, RLS live) through the real
 * router. The admin `postgres.Sql` is only for fixtures, raw assertions and cleanup.
 *
 * Run once, from apps/api:
 *   pnpm exec vitest run --config tests/acceptance/api-lote/vitest.config.ts
 */
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { Hono } from 'hono';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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

import { hubAuthContext } from '../../../src/auth/__tests__/hub-auth-context-fixture.js';
import { closeDb } from '../../../src/db/client.js';
import * as schema from '../../../src/db/schema.js';
import { deleteCrmForOrgs } from '../../../src/db/__tests__/settlement-test-cleanup.js';
import { testDatabaseUrls } from '../../../src/db/__tests__/test-database-urls.js';
import { computeEntryHash } from '../../../src/domains/audit/service.js';
import { LeadWriteBaseSchema } from '../../../src/domains/sales-ops/leads/lead-schemas.js';
import {
  type LeadScope,
  type LeadView,
  type WriteLeadResult,
  createLead,
} from '../../../src/domains/sales-ops/leads/lead-service.js';
import { type LeadActor, deleteLead } from '../../../src/domains/sales-ops/leads/lead-trash-service.js';
import { ensureLeadStagesForOrg } from '../../../src/domains/sales-ops/leads/stages-seed.js';
import { PersonSchema, createPerson } from '../../../src/domains/sales-ops/service.js';

const { leadsRouter } = await import('../../../src/domains/sales-ops/leads/lead-routes.js');

const deleteStagePath = (stageId: string) => `/leads/stages/${stageId}/delete-all`;
const restoreBatchPath = (batchId: string) => `/leads/batches/${batchId}/restore`;

const { appUrl: APP_DB_URL, adminUrl: ADMIN_DB_URL } = testDatabaseUrls();
const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;
const ADMIN_SCOPE: LeadScope = { userId: 'hub_admin', email: null, isAdmin: true };
const ADMIN_ACTOR: LeadActor = { userId: 'hub_admin', name: 'Gestora Teste' };
const ADMIN_FORBIDDEN = { error: 'forbidden', reason: 'admin_role_required' };
const NOT_FOUND_BODY = { error: 'not_found' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function okLead(result: WriteLeadResult): LeadView {
  if (!result.ok) throw new Error(`unexpected refusal: ${result.reason}`);
  return result.lead;
}

type RawAuditRow = {
  actor_user_id: string;
  actor_org_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  before_jsonb: unknown;
  after_jsonb: unknown;
  request_id: string | null;
  prev_hash: string;
  entry_hash: string;
};

function expectEntryHashValid(row: RawAuditRow): void {
  const recomputed = computeEntryHash(row.prev_hash, {
    actorUserId: row.actor_user_id,
    actorOrgId: row.actor_org_id ?? null,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    beforeJsonb: row.before_jsonb ?? null,
    afterJsonb: row.after_jsonb ?? null,
    requestId: row.request_id ?? null,
  });
  expect(recomputed).toBe(row.entry_hash);
}

type DeleteAllBody = { batchId: string; deletedCount: number; skippedConvertedCount: number };
type RestoreBatchBody = { restoredCount: number };

describe('api-lote: delete and restore every lead of an etapa as one batch', () => {
  let appClient: postgres.Sql;
  let adminClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const orgIds: string[] = [];

  function newOrg(label: string): string {
    const orgId = `org_lote_${label}_${Date.now()}_${randomUUID().slice(0, 8)}`;
    orgIds.push(orgId);
    return orgId;
  }

  beforeAll(() => {
    appClient = postgres(APP_DB_URL, { max: 5 });
    adminClient = postgres(ADMIN_DB_URL, { max: 2, ...ADMIN_CONNECTION_OPTIONS });
    db = drizzle(appClient, { schema });
  });

  afterAll(async () => {
    for (const orgId of orgIds) {
      await adminClient`DELETE FROM audit_log WHERE actor_org_id = ${orgId}`;
      await deleteCrmForOrgs([orgId]);
      await adminClient`DELETE FROM sales_ops_sales WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_person_funcoes WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_people WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_funcoes WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_clients WHERE org_id = ${orgId}`;
    }
    await closeDb();
    await appClient.end();
    await adminClient.end();
  });

  function app(orgId: string, identity: { userId: string; roles: string[]; name: string }) {
    const hono = new Hono();
    hono.use('*', async (c, next) => {
      c.set('userId', identity.userId);
      c.set('orgId', orgId);
      c.set('userRole', identity.roles[0]);
      c.set('userRoles', identity.roles as never);
      c.set('hubAuth', hubAuthContext({ accountId: identity.userId, workspaceId: orgId, name: identity.name }));
      await next();
    });
    hono.route('/leads', leadsRouter);
    return hono;
  }
  const adminApp = (orgId: string) =>
    app(orgId, { userId: 'hub_admin', roles: ['admin', 'seller', 'finder'], name: 'Gestora Teste' });
  const sellerApp = (orgId: string) => app(orgId, { userId: 'hub_ana', roles: ['seller'], name: 'Ana Martins' });

  async function world(label: string) {
    const orgId = newOrg(label);
    const stages = await ensureLeadStagesForOrg(db, orgId);
    const pick = (kind: string, position?: number) =>
      stages.find((stage) => stage.kind === kind && (position === undefined || stage.position === position))!;
    const person = await createPerson(db, orgId, PersonSchema.parse({ displayName: 'Ana Martins', isSeller: true }), {});
    if (typeof person === 'string') throw new Error(`unexpected person outcome: ${person}`);
    await adminClient`UPDATE sales_ops_people SET hub_account_id = 'hub_ana' WHERE org_id = ${orgId} AND id = ${person.id}`;
    return { orgId, ana: person, open: pick('normal', 1), second: pick('normal', 2), conversion: pick('conversion') };
  }
  type World = Awaited<ReturnType<typeof world>>;

  async function clientOf(orgId: string, name: string): Promise<string> {
    const [row] = await adminClient<{ id: string }[]>`
      INSERT INTO sales_ops_clients (org_id, name) VALUES (${orgId}, ${name}) RETURNING id`;
    return row!.id;
  }

  async function lead(orgId: string, contactName: string, extra: { clientId?: string; sellerPersonId?: string } = {}) {
    return okLead(
      await createLead(
        db,
        orgId,
        LeadWriteBaseSchema.parse({ contactName, estimatedValueBrl: 100000, ...extra }),
        ADMIN_SCOPE,
      ),
    );
  }

  async function convert(orgId: string, leadId: string): Promise<void> {
    const [sale] = await adminClient<{ id: string }[]>`
      INSERT INTO sales_ops_sales
        (org_id, sequence, code, client_name_snapshot, seller_name_snapshot, payment_method,
         condition, base_date, total_brl, seller_commission_pct, finder_commission_pct, tax_pct,
         other_costs_brl, net_margin_brl, net_margin_pct)
      VALUES (${orgId}, ${Math.floor(Math.random() * 1_000_000) + 1}, ${`PROP-LOTE-${randomUUID().slice(0, 8)}`},
              'Empresa A', 'Vendedor A', 'pix', 'cash', now(), 100000, 10, 3, 6, 0, 0, 0)
      RETURNING id`;
    await adminClient`UPDATE sales_ops_crm_leads SET sale_id = ${sale!.id} WHERE org_id = ${orgId} AND id = ${leadId}`;
  }

  async function rowOf(leadId: string) {
    const [row] = await adminClient<
      Array<{
        stage_id: string;
        position: number;
        client_id: string | null;
        sale_id: string | null;
        deleted_at: Date | null;
        deleted_by_user_id: string | null;
        deleted_by_name: string | null;
        deleted_batch_id: string | null;
      }>
    >`SELECT stage_id, "position", client_id, sale_id, deleted_at, deleted_by_user_id, deleted_by_name, deleted_batch_id
      FROM sales_ops_crm_leads WHERE id = ${leadId}`;
    return row!;
  }

  async function auditFor(entityId: string, action?: string) {
    const rows = (await adminClient<RawAuditRow[]>`
      SELECT actor_user_id, actor_org_id, action, entity_type, entity_id,
             before_jsonb, after_jsonb, request_id, prev_hash, entry_hash
      FROM audit_log WHERE entity_id = ${entityId} ORDER BY id`) as unknown as RawAuditRow[];
    return action ? rows.filter((row) => row.action === action) : rows;
  }

  async function auditOfAction(orgId: string, action: string) {
    return (await adminClient<RawAuditRow[]>`
      SELECT actor_user_id, actor_org_id, action, entity_type, entity_id,
             before_jsonb, after_jsonb, request_id, prev_hash, entry_hash
      FROM audit_log WHERE actor_org_id = ${orgId} AND action = ${action} ORDER BY id`) as unknown as RawAuditRow[];
  }

  async function livePositions(orgId: string, stageId: string) {
    const rows = await adminClient<Array<{ contact_name: string; position: number }>>`
      SELECT contact_name, "position" FROM sales_ops_crm_leads
      WHERE org_id = ${orgId} AND stage_id = ${stageId} AND deleted_at IS NULL
      ORDER BY "position"`;
    return rows.map((row) => [row.contact_name, row.position]);
  }

  async function clientsSnapshot(orgId: string): Promise<string> {
    const rows = await adminClient`SELECT * FROM sales_ops_clients WHERE org_id = ${orgId} ORDER BY id`;
    return JSON.stringify(rows);
  }

  async function stageChangedEvents(leadId: string): Promise<number> {
    const [row] = await adminClient<{ n: string }[]>`
      SELECT count(*)::text AS n FROM sales_ops_crm_lead_events WHERE lead_id = ${leadId} AND kind = 'stage_changed'`;
    return Number(row!.n);
  }

  async function deleteAll(w: World, stageId: string): Promise<{ status: number; body: DeleteAllBody }> {
    const response = await adminApp(w.orgId).request(deleteStagePath(stageId), { method: 'POST' });
    return { status: response.status, body: (await response.json()) as DeleteAllBody };
  }

  /** The audit entries of one act form an unbroken stretch of the hash chain. */
  function expectContiguousChain(entries: RawAuditRow[]): void {
    for (const entry of entries) expectEntryHashValid(entry);
    for (let i = 1; i < entries.length; i += 1) {
      expect(entries[i]!.prev_hash).toBe(entries[i - 1]!.entry_hash);
    }
  }

  it('an admin deletes every live unconverted lead of the etapa: reversible, audited, cliente untouched, others skipped', async () => {
    const w = await world('delete');
    const acme = await clientOf(w.orgId, 'Acme Ltda');
    const beta = await clientOf(w.orgId, 'Beta SA');
    const a = await lead(w.orgId, 'A', { clientId: acme, sellerPersonId: w.ana.id });
    const b = await lead(w.orgId, 'B', { clientId: beta });
    const c = await lead(w.orgId, 'C');
    const converted = await lead(w.orgId, 'Convertido', { clientId: acme });
    const prior = await lead(w.orgId, 'Ja excluido');
    const d = await lead(w.orgId, 'D', { clientId: acme });
    const e = await lead(w.orgId, 'E');
    const f = await lead(w.orgId, 'F');
    const elsewhere = await lead(w.orgId, 'Outra etapa');
    await adminClient`
      UPDATE sales_ops_crm_leads SET stage_id = ${w.second.id}, "position" = 1 WHERE id = ${elsewhere.id}`;
    await convert(w.orgId, converted.id);
    expect(await deleteLead(db, w.orgId, prior.id, ADMIN_SCOPE, ADMIN_ACTOR)).toEqual({ ok: true });

    const clientsBefore = await clientsSnapshot(w.orgId);
    const clientIdsBefore = new Map<string, string | null>();
    for (const l of [a, b, c, d, e, f]) clientIdsBefore.set(l.id, (await rowOf(l.id)).client_id);
    const eventsBefore = await stageChangedEvents(a.id);
    const entriesBefore = (await auditOfAction(w.orgId, 'lead.deleted')).length;

    const { status, body } = await deleteAll(w, w.open.id);

    expect(status).toBe(200);
    expect(body.deletedCount).toBe(6);
    expect(body.skippedConvertedCount).toBe(1);
    expect(body.batchId).toMatch(UUID);

    // Reversible soft delete, same columns as deleteLead, plus the batch id.
    for (const l of [a, b, c, d, e, f]) {
      const row = await rowOf(l.id);
      expect(row.deleted_at).not.toBeNull();
      expect(row.deleted_by_user_id).toBe('hub_admin');
      expect(row.deleted_by_name).toBe('Gestora Teste');
      expect(row.deleted_batch_id).toBe(body.batchId);
      expect(row.stage_id).toBe(w.open.id);
      // The cliente link survives untouched.
      expect(row.client_id).toBe(clientIdsBefore.get(l.id));
    }
    // The converted card, the earlier single delete and the other etapa are out of the batch.
    const convertedRow = await rowOf(converted.id);
    expect(convertedRow.deleted_at).toBeNull();
    expect(convertedRow.deleted_batch_id).toBeNull();
    expect(convertedRow.sale_id).not.toBeNull();
    const priorRow = await rowOf(prior.id);
    expect(priorRow.deleted_at).not.toBeNull();
    expect(priorRow.deleted_batch_id).toBeNull();
    const elsewhereRow = await rowOf(elsewhere.id);
    expect(elsewhereRow.deleted_at).toBeNull();
    expect(elsewhereRow.stage_id).toBe(w.second.id);

    // The clientes table is byte-for-byte what it was.
    expect(await clientsSnapshot(w.orgId)).toBe(clientsBefore);

    // The column closes dense over live cards: only the converted one is left.
    expect(await livePositions(w.orgId, w.open.id)).toEqual([['Convertido', 1]]);
    expect(await livePositions(w.orgId, w.second.id)).toEqual([['Outra etapa', 1]]);

    // A delete is not a stage change.
    expect(await stageChangedEvents(a.id)).toBe(eventsBefore);

    // One `lead.deleted` per deleted lead, in the same shape deleteLead writes.
    const batchEntries = [];
    for (const l of [a, b, c, d, e, f]) {
      const entries = await auditFor(l.id);
      expect(entries).toHaveLength(1);
      const entry = entries[0]!;
      expect(entry.action).toBe('lead.deleted');
      expect(entry.entity_type).toBe('lead');
      expect(entry.actor_user_id).toBe('hub_admin');
      expect(entry.actor_org_id).toBe(w.orgId);
      expect(entry.before_jsonb).toEqual({ deleted: false });
      expect(entry.after_jsonb).toMatchObject({
        deleted: true,
        label: l.contactName,
        actorLabel: 'Gestora Teste',
        metadata: { contactName: l.contactName, stageName: w.open.name },
      });
      batchEntries.push(entry);
    }
    const aMeta = (batchEntries[0]!.after_jsonb as { metadata: { clientName: string; sellerName: string } }).metadata;
    expect(aMeta.clientName).toBe('Acme Ltda');
    expect(aMeta.sellerName).toBe('Ana Martins');
    // The converted card wrote nothing; the earlier single delete still has its one entry.
    expect(await auditFor(converted.id)).toHaveLength(0);
    expect(await auditFor(prior.id, 'lead.deleted')).toHaveLength(1);
    expect((await auditOfAction(w.orgId, 'lead.deleted')).length - entriesBefore).toBe(6);
    // One transaction, one unbroken stretch of the chain (the ledger tail lock is held until COMMIT).
    const inBatch = new Set(batchEntries.map((entry) => entry.entity_id));
    expectContiguousChain((await auditOfAction(w.orgId, 'lead.deleted')).filter((entry) => inBatch.has(entry.entity_id)));
  });

  it('the deleted list tells which leads came from a batch', async () => {
    const w = await world('list');
    const a = await lead(w.orgId, 'A');
    const b = await lead(w.orgId, 'B');
    const single = await lead(w.orgId, 'Sozinho');
    expect(await deleteLead(db, w.orgId, single.id, ADMIN_SCOPE, ADMIN_ACTOR)).toEqual({ ok: true });
    const { body } = await deleteAll(w, w.open.id);

    const response = await adminApp(w.orgId).request('/leads/deleted');
    expect(response.status).toBe(200);
    const list = (await response.json()) as { items: Array<{ id: string; batchId: string | null }> };
    const byId = new Map(list.items.map((item) => [item.id, item.batchId]));
    expect(byId.get(a.id)).toBe(body.batchId);
    expect(byId.get(b.id)).toBe(body.batchId);
    expect(byId.get(single.id)).toBeNull();
  });

  it('running it again is harmless: nothing more is deleted, nothing more is audited, the first batch keeps its rows', async () => {
    const w = await world('again');
    const a = await lead(w.orgId, 'A');
    await lead(w.orgId, 'B');
    const converted = await lead(w.orgId, 'Convertido');
    await convert(w.orgId, converted.id);

    const first = await deleteAll(w, w.open.id);
    expect(first.body.deletedCount).toBe(2);
    const entries = (await auditOfAction(w.orgId, 'lead.deleted')).length;
    const deletedAt = (await rowOf(a.id)).deleted_at;

    const second = await deleteAll(w, w.open.id);
    expect(second.status).toBe(200);
    expect(second.body.deletedCount).toBe(0);
    expect(second.body.skippedConvertedCount).toBe(1);
    expect((await auditOfAction(w.orgId, 'lead.deleted')).length).toBe(entries);
    const row = await rowOf(a.id);
    expect(row.deleted_batch_id).toBe(first.body.batchId);
    expect(row.deleted_at?.getTime()).toBe(deletedAt?.getTime());
  });

  it('only an admin: a vendedor gets 403 and nothing changes, not even his own leads', async () => {
    const w = await world('gate');
    const own = await lead(w.orgId, 'Da Ana', { sellerPersonId: w.ana.id });
    const pool = await lead(w.orgId, 'Pool');

    const response = await sellerApp(w.orgId).request(deleteStagePath(w.open.id), { method: 'POST' });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(ADMIN_FORBIDDEN);
    expect((await rowOf(own.id)).deleted_at).toBeNull();
    expect((await rowOf(pool.id)).deleted_at).toBeNull();
    expect(await auditOfAction(w.orgId, 'lead.deleted')).toHaveLength(0);
  });

  it('there is no DELETE verb: it answers 404 or 405 and deletes nothing', async () => {
    const w = await world('verb');
    const l = await lead(w.orgId, 'A');
    const response = await adminApp(w.orgId).request(deleteStagePath(w.open.id), { method: 'DELETE' });
    expect([404, 405]).toContain(response.status);
    expect((await rowOf(l.id)).deleted_at).toBeNull();
  });

  it('the org is the token\'s: another org\'s etapa, an unknown etapa and a malformed id are all 404 and write nothing', async () => {
    const a = await world('org-a');
    const b = await world('org-b');
    const theirs = await lead(b.orgId, 'Deles');
    await lead(a.orgId, 'Meu');

    for (const stageId of [b.open.id, randomUUID(), 'nao-e-uuid']) {
      const response = await adminApp(a.orgId).request(deleteStagePath(stageId), { method: 'POST' });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual(NOT_FOUND_BODY);
    }
    expect((await rowOf(theirs.id)).deleted_at).toBeNull();
    expect(await auditOfAction(b.orgId, 'lead.deleted')).toHaveLength(0);
    expect(await livePositions(a.orgId, a.open.id)).toEqual([['Meu', 1]]);
  });

  it('restoring a batch returns its leads like restoreLead would, skips leads that already left the batch, and is idempotent', async () => {
    const w = await world('restore');
    const acme = await clientOf(w.orgId, 'Acme Ltda');
    const a = await lead(w.orgId, 'A', { clientId: acme });
    const b = await lead(w.orgId, 'B');
    const c = await lead(w.orgId, 'C', { clientId: acme, sellerPersonId: w.ana.id });
    const d = await lead(w.orgId, 'D');
    const e = await lead(w.orgId, 'E');
    const z = await lead(w.orgId, 'Z');
    await adminClient`UPDATE sales_ops_crm_leads SET stage_id = ${w.second.id}, "position" = 1 WHERE id = ${z.id}`;
    const batch = await deleteAll(w, w.open.id);
    expect(batch.body.deletedCount).toBe(5);
    const admin = adminApp(w.orgId);
    const clientsBefore = await clientsSnapshot(w.orgId);

    // A came back on its own, B came back and was deleted again on its own: neither belongs to the batch any more.
    expect((await admin.request(`/leads/${a.id}/restore`, { method: 'POST' })).status).toBe(200);
    expect((await admin.request(`/leads/${b.id}/restore`, { method: 'POST' })).status).toBe(200);
    expect((await admin.request(`/leads/${b.id}/delete`, { method: 'POST' })).status).toBe(204);
    const restoredBefore = (await auditOfAction(w.orgId, 'lead.restored')).length;

    const response = await admin.request(restoreBatchPath(batch.body.batchId), { method: 'POST' });
    expect(response.status).toBe(200);
    expect(((await response.json()) as RestoreBatchBody).restoredCount).toBe(3);

    for (const l of [c, d, e]) {
      const row = await rowOf(l.id);
      expect(row.deleted_at).toBeNull();
      expect(row.deleted_by_user_id).toBeNull();
      expect(row.deleted_by_name).toBeNull();
      expect(row.deleted_batch_id).toBeNull();
      expect(row.stage_id).toBe(w.open.id);
    }
    // B stays deleted on its own account; A was not touched a second time.
    const bRow = await rowOf(b.id);
    expect(bRow.deleted_at).not.toBeNull();
    expect(bRow.deleted_batch_id).toBeNull();
    expect(await auditFor(a.id, 'lead.restored')).toHaveLength(1);

    // Appended after the live card, in their original order, the column dense.
    expect(await livePositions(w.orgId, w.open.id)).toEqual([
      ['A', 1],
      ['C', 2],
      ['D', 3],
      ['E', 4],
    ]);
    expect(await livePositions(w.orgId, w.second.id)).toEqual([['Z', 1]]);

    // One `lead.restored` per restored lead, a NEW entry beside the delete entry.
    const entries = [];
    for (const l of [c, d, e]) {
      expect(await auditFor(l.id, 'lead.deleted')).toHaveLength(1);
      const restored = await auditFor(l.id, 'lead.restored');
      expect(restored).toHaveLength(1);
      const entry = restored[0]!;
      expect(entry.actor_user_id).toBe('hub_admin');
      expect(entry.actor_org_id).toBe(w.orgId);
      expect(entry.after_jsonb).toMatchObject({
        deleted: false,
        label: l.contactName,
        metadata: { contactName: l.contactName, stageName: w.open.name },
      });
      entries.push(entry);
    }
    expect((await auditOfAction(w.orgId, 'lead.restored')).length - restoredBefore).toBe(3);
    for (const entry of entries) expectEntryHashValid(entry);
    expect(await clientsSnapshot(w.orgId)).toBe(clientsBefore);

    const again = await admin.request(restoreBatchPath(batch.body.batchId), { method: 'POST' });
    expect(again.status).toBe(200);
    expect(((await again.json()) as RestoreBatchBody).restoredCount).toBe(0);
    expect((await auditOfAction(w.orgId, 'lead.restored')).length - restoredBefore).toBe(3);
  });

  it('a batch whose etapa was archived restores into the first open etapa, with one stage change each', async () => {
    const w = await world('archived');
    const a = await lead(w.orgId, 'A');
    const b = await lead(w.orgId, 'B');
    const batch = await deleteAll(w, w.open.id);
    expect(batch.body.deletedCount).toBe(2);
    expect(await stageChangedEvents(a.id)).toBe(1);
    await adminClient`
      UPDATE sales_ops_pipeline_stages SET status = 'archived', archived_at = now() WHERE id = ${w.open.id}`;

    const response = await adminApp(w.orgId).request(restoreBatchPath(batch.body.batchId), { method: 'POST' });
    expect(response.status).toBe(200);
    expect(((await response.json()) as RestoreBatchBody).restoredCount).toBe(2);

    for (const l of [a, b]) {
      const row = await rowOf(l.id);
      expect(row.deleted_at).toBeNull();
      expect(row.stage_id).not.toBe(w.open.id);
      const [stage] = await adminClient<{ status: string; type: string }[]>`
        SELECT status, type FROM sales_ops_pipeline_stages WHERE id = ${row.stage_id}`;
      expect(stage).toEqual({ status: 'active', type: 'normal' });
      expect(await stageChangedEvents(l.id)).toBe(2);
    }
    const landed = (await rowOf(a.id)).stage_id;
    expect(await livePositions(w.orgId, landed)).toEqual([
      ['A', 1],
      ['B', 2],
    ]);
  });

  it('restoring a batch is admin-only and scoped to the token\'s org', async () => {
    const a = await world('rb-a');
    const b = await world('rb-b');
    const mine = await lead(a.orgId, 'Meu');
    const theirs = await lead(b.orgId, 'Deles');
    const batchA = await deleteAll(a, a.open.id);
    const batchB = await deleteAll(b, b.open.id);

    const seller = await sellerApp(a.orgId).request(restoreBatchPath(batchA.body.batchId), { method: 'POST' });
    expect(seller.status).toBe(403);
    expect(await seller.json()).toEqual(ADMIN_FORBIDDEN);
    expect((await rowOf(mine.id)).deleted_at).not.toBeNull();

    for (const batchId of [batchB.body.batchId, randomUUID(), 'nao-e-uuid']) {
      const response = await adminApp(a.orgId).request(restoreBatchPath(batchId), { method: 'POST' });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual(NOT_FOUND_BODY);
    }
    expect((await rowOf(theirs.id)).deleted_at).not.toBeNull();
    expect(await auditOfAction(b.orgId, 'lead.restored')).toHaveLength(0);

    const verb = await adminApp(a.orgId).request(restoreBatchPath(batchA.body.batchId), { method: 'DELETE' });
    expect([404, 405]).toContain(verb.status);
  });

  describe('about 1700 leads in one etapa', () => {
    const COUNT = 1700;
    let w: World;
    let batchId = '';

    beforeAll(async () => {
      w = await world('scale');
      const [stage] = await adminClient<{ pipeline_id: string }[]>`
        SELECT pipeline_id FROM sales_ops_pipeline_stages WHERE id = ${w.open.id}`;
      await adminClient`
        INSERT INTO sales_ops_crm_leads (org_id, contact_name, contact_email, pipeline_id, stage_id, "position")
        SELECT ${w.orgId}, 'Lead ' || n, 'lead' || n || '@example.com', ${stage!.pipeline_id}, ${w.open.id}, n
        FROM generate_series(1, ${COUNT}) AS n`;
    });

    it('deletes them all inside the default timeout, one ledger entry each, in one unbroken chain', async () => {
      const result = await deleteAll(w, w.open.id);
      expect(result.status).toBe(200);
      expect(result.body.deletedCount).toBe(COUNT);
      expect(result.body.skippedConvertedCount).toBe(0);
      batchId = result.body.batchId;

      const [counts] = await adminClient<{ deleted: string; batch: string; live: string }[]>`
        SELECT count(*) FILTER (WHERE deleted_at IS NOT NULL)::text AS deleted,
               count(*) FILTER (WHERE deleted_batch_id = ${batchId})::text AS batch,
               count(*) FILTER (WHERE deleted_at IS NULL)::text AS live
        FROM sales_ops_crm_leads WHERE org_id = ${w.orgId}`;
      expect(counts).toEqual({ deleted: String(COUNT), batch: String(COUNT), live: '0' });

      const [audit] = await adminClient<{ n: string; broken: string }[]>`
        SELECT count(*)::text AS n,
               count(*) FILTER (WHERE prev IS NOT NULL AND prev_hash <> prev)::text AS broken
        FROM (
          SELECT prev_hash, lag(entry_hash) OVER (ORDER BY id) AS prev
          FROM audit_log WHERE actor_org_id = ${w.orgId} AND action = 'lead.deleted'
        ) t`;
      expect(audit).toEqual({ n: String(COUNT), broken: '0' });
    });

    it('restores them all inside the default timeout, dense and in the original order', async () => {
      expect(batchId).toMatch(UUID);
      const response = await adminApp(w.orgId).request(restoreBatchPath(batchId), { method: 'POST' });
      expect(response.status).toBe(200);
      expect(((await response.json()) as RestoreBatchBody).restoredCount).toBe(COUNT);

      const [shape] = await adminClient<{ live: string; dense: boolean; ordered: boolean }[]>`
        SELECT count(*)::text AS live,
               min("position") = 1 AND max("position") = count(*) AND count(DISTINCT "position") = count(*) AS dense,
               bool_and(contact_name = 'Lead ' || "position") AS ordered
        FROM sales_ops_crm_leads WHERE org_id = ${w.orgId} AND stage_id = ${w.open.id} AND deleted_at IS NULL`;
      expect(shape).toEqual({ live: String(COUNT), dense: true, ordered: true });
      expect(await auditOfAction(w.orgId, 'lead.restored')).toHaveLength(COUNT);
    });
  });
});
