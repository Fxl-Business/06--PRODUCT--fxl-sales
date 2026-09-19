import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { LeadStageSchema } from '../../src/domains/sales-ops/leads/schemas.js';
import {
  createLeadStage,
  listLeadStages,
  reorderLeadStages,
  updateLeadStage,
} from '../../src/domains/sales-ops/leads/stage-service.js';
import { ensureLeadStagesForOrg } from '../../src/domains/sales-ops/leads/stages-seed.js';

const APP_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5006/fxl_sales';
const ADMIN_DB_URL = process.env.ADMIN_DATABASE_URL ?? APP_DB_URL;
const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;

function withRole(url: string, username: string, password: string): string {
  const parsed = new URL(url);
  parsed.username = username;
  parsed.password = password;
  return parsed.toString();
}

describe('sales operations lead stages persistence and RLS', () => {
  let appClient: postgres.Sql;
  let adminClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  /**
   * The same service functions driven over a connection carrying `app.fxl_admin`,
   * which satisfies the `*_admin_context` policy and therefore makes every org's
   * rows visible at the database level. On this connection the ONLY thing scoping
   * a read is the service layer's explicit `eq(table.orgId, orgId)` filter.
   */
  let adminDb: ReturnType<typeof drizzle<typeof schema>>;
  let adminDbClient: postgres.Sql;
  const orgIds: string[] = [];

  function newOrgPair(label: string): [string, string] {
    const suffix = `${Date.now()}_${randomUUID().slice(0, 8)}`;
    const orgA = `org_stage_${label}_a_${suffix}`;
    const orgB = `org_stage_${label}_b_${suffix}`;
    orgIds.push(orgA, orgB);
    return [orgA, orgB];
  }

  beforeAll(() => {
    appClient = postgres(APP_DB_URL, { max: 2 });
    adminClient = postgres(ADMIN_DB_URL, { max: 1, ...ADMIN_CONNECTION_OPTIONS });
    db = drizzle(appClient, { schema });
    adminDbClient = postgres(ADMIN_DB_URL, { max: 2, ...ADMIN_CONNECTION_OPTIONS });
    adminDb = drizzle(adminDbClient, { schema });
  });

  afterAll(async () => {
    for (const orgId of orgIds) {
      await adminClient`DELETE FROM sales_ops_lead_products WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_leads WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_lead_stages WHERE org_id = ${orgId}`;
    }
    await appClient.end();
    await adminDbClient.end();
    await adminClient.end();
  });

  it('lead stage CRUD stays tenant-scoped through the service layer', async () => {
    const [orgA, orgB] = newOrgPair('crud');
    await ensureLeadStagesForOrg(db, orgA);
    await ensureLeadStagesForOrg(db, orgB);

    const stageA = await createLeadStage(db, orgA, LeadStageSchema.parse({ name: 'Qualificação' }));
    if (typeof stageA === 'string') throw new Error(`unexpected sentinel: ${stageA}`);
    expect(stageA.status).toBe('active');
    expect(stageA.kind).toBe('normal');
    expect(stageA.isSystem).toBe(false);
    expect(stageA.archivedAt).toBeNull();

    expect((await listLeadStages(db, orgA)).map((row) => row.id)).toContain(stageA.id);
    expect((await listLeadStages(db, orgB)).map((row) => row.id)).not.toContain(stageA.id);

    const renamed = await updateLeadStage(db, orgA, stageA.id, { name: 'Qualificado' });
    if (renamed === null || typeof renamed === 'string') {
      throw new Error(`unexpected sentinel: ${renamed}`);
    }
    expect(renamed.name).toBe('Qualificado');

    const archived = await updateLeadStage(db, orgA, stageA.id, { status: 'archived' });
    if (archived === null || typeof archived === 'string') {
      throw new Error(`unexpected sentinel: ${archived}`);
    }
    expect(archived.status).toBe('archived');
    expect(archived.archivedAt).toBeInstanceOf(Date);

    // An archived stage is STILL returned by the list: the cadastro screen is the
    // only restore surface, because a lead stage writes no audit_log entry.
    expect((await listLeadStages(db, orgA)).map((row) => row.id)).toContain(stageA.id);

    const restored = await updateLeadStage(db, orgA, stageA.id, { status: 'active' });
    if (restored === null || typeof restored === 'string') {
      throw new Error(`unexpected sentinel: ${restored}`);
    }
    expect(restored.status).toBe('active');
    expect(restored.archivedAt).toBeNull();

    // Another org cannot reach it at all.
    expect(await updateLeadStage(db, orgB, stageA.id, { name: 'hijack' })).toBeNull();
  });

  it('createLeadStage reports duplicates per org but allows the same name in another org', async () => {
    const [orgA, orgB] = newOrgPair('dup');
    const first = await createLeadStage(db, orgA, LeadStageSchema.parse({ name: 'Qualificação' }));
    if (typeof first === 'string') throw new Error(`unexpected sentinel: ${first}`);

    expect(await createLeadStage(db, orgA, LeadStageSchema.parse({ name: 'Qualificação' }))).toBe(
      'duplicate',
    );

    const other = await createLeadStage(db, orgB, LeadStageSchema.parse({ name: 'Qualificação' }));
    if (typeof other === 'string') throw new Error(`unexpected sentinel: ${other}`);
    expect(other.orgId).toBe(orgB);
  });

  it('reports a duplicate name even when the probe loses the race', async () => {
    // Decisive against dropping `.onConflictDoNothing()`, which turns a
    // concurrent duplicate into a raw 23505 and an HTTP 500.
    //
    // The race is DETERMINISTIC rather than hoped for. A competing transaction
    // inserts the colliding row and is then held open: under READ COMMITTED its
    // uncommitted row is invisible to createLeadStage's probe, so the probe
    // MISSES, and the INSERT then blocks on the unique index until the competitor
    // commits. Planting a committed row instead would be caught by the probe and
    // would prove nothing about the conflict clause.
    const [orgA] = newOrgPair('race');

    let release: () => void = () => {};
    let markInserted: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inserted = new Promise<void>((resolve) => {
      markInserted = resolve;
    });
    const competitor = adminClient.begin(async (tx) => {
      await tx`
        INSERT INTO sales_ops_lead_stages (org_id, name, kind, is_system, "position")
        VALUES (${orgA}, 'Concorrente', 'normal', false, 7)
      `;
      markInserted();
      await gate;
    });

    // The competitor's row must be IN PLACE but uncommitted before the racing
    // call starts, or the racing call simply commits first and there is no race.
    await inserted;
    const racing = createLeadStage(db, orgA, LeadStageSchema.parse({ name: 'Concorrente' }));
    // Long enough for the probe to miss and for the INSERT to be blocked on the
    // competitor's index entry.
    await new Promise((resolve) => setTimeout(resolve, 400));
    release();
    await competitor;

    expect(await racing).toBe('duplicate');

    const [{ count }] = await adminClient<{ count: string }[]>`
      SELECT count(*)::text AS count FROM sales_ops_lead_stages
      WHERE org_id = ${orgA} AND name = 'Concorrente'
    `;
    expect(count).toBe('1');
  });

  it('createLeadStage appends after the highest position, archived rows included', async () => {
    const [orgA] = newOrgPair('position');
    const names = ['Alpha', 'Beta', 'Gama'];
    const created = [];
    for (const name of names) {
      const stage = await createLeadStage(db, orgA, LeadStageSchema.parse({ name }));
      if (typeof stage === 'string') throw new Error(`unexpected sentinel: ${stage}`);
      created.push(stage);
    }
    expect(created.map((stage) => stage.position)).toEqual([0, 1, 2]);

    const archived = await updateLeadStage(db, orgA, created[1].id, { status: 'archived' });
    if (archived === null || typeof archived === 'string') {
      throw new Error(`unexpected sentinel: ${archived}`);
    }

    const fourth = await createLeadStage(db, orgA, LeadStageSchema.parse({ name: 'Delta' }));
    if (typeof fourth === 'string') throw new Error(`unexpected sentinel: ${fourth}`);
    // Decisive against count(*)-based positioning, which would collide with the
    // archived row's stored position.
    for (const stage of created) {
      expect(fourth.position).toBeGreaterThan(stage.position);
    }
  });

  it('updateLeadStage refuses to rename or archive a system stage', async () => {
    const [orgA] = newOrgPair('system');
    const seeded = await ensureLeadStagesForOrg(db, orgA);
    const system = seeded.find((stage) => stage.isSystem);
    if (!system) throw new Error('expected the seed to ship at least one system stage');

    expect(await updateLeadStage(db, orgA, system.id, { name: 'Renomeada' })).toBe('is_system');
    expect(await updateLeadStage(db, orgA, system.id, { status: 'archived' })).toBe('is_system');

    const [reread] = (await listLeadStages(db, orgA)).filter((stage) => stage.id === system.id);
    expect(reread.name).toBe(system.name);
    expect(reread.status).toBe('active');
    expect(reread.archivedAt).toBeNull();
  });

  it('reorderLeadStages writes a total order in one transaction and refuses a partial set', async () => {
    const [orgA] = newOrgPair('reorder');
    const seeded = await ensureLeadStagesForOrg(db, orgA);
    expect(seeded).toHaveLength(4);

    const reversed = [...seeded].reverse().map((stage) => stage.id);
    const reordered = await reorderLeadStages(db, orgA, reversed);
    if (reordered === 'set_mismatch') throw new Error('unexpected set_mismatch');
    expect(reordered.map((stage) => stage.id)).toEqual(reversed);
    expect(reordered.map((stage) => stage.position)).toEqual([0, 1, 2, 3]);

    // A partial set is refused and, because the whole thing is one transaction,
    // not one position moves.
    expect(await reorderLeadStages(db, orgA, reversed.slice(0, 3))).toBe('set_mismatch');
    const afterRejection = await listLeadStages(db, orgA);
    expect(afterRejection.map((stage) => stage.id)).toEqual(reversed);
    expect(afterRejection.map((stage) => stage.position)).toEqual([0, 1, 2, 3]);

    // An unknown id of the right cardinality is refused too.
    expect(
      await reorderLeadStages(db, orgA, [...reversed.slice(0, 3), randomUUID()]),
    ).toBe('set_mismatch');
  });

  it('reorderLeadStages leaves every lead stage_changed_at untouched', async () => {
    const [orgA] = newOrgPair('stagechanged');
    const seeded = await ensureLeadStagesForOrg(db, orgA);
    const home = seeded[0];

    const [lead] = await adminClient<{ id: string; stage_changed_at: Date }[]>`
      INSERT INTO sales_ops_leads (org_id, contact_name, client_name_snapshot, stage_id)
      VALUES (${orgA}, 'Contato Um', 'Empresa Um', ${home.id})
      RETURNING id, stage_changed_at
    `;

    const reordered = await reorderLeadStages(
      db,
      orgA,
      [...seeded].reverse().map((stage) => stage.id),
    );
    if (reordered === 'set_mismatch') throw new Error('unexpected set_mismatch');

    const [after] = await adminClient<{ stage_changed_at: Date; updated_at: Date | null }[]>`
      SELECT stage_changed_at, updated_at FROM sales_ops_leads WHERE id = ${lead.id}
    `;
    // Byte-identical, not merely "the lead still exists": this is the sole oracle
    // for "a reorder never touches a lead".
    expect(after.stage_changed_at.toISOString()).toBe(lead.stage_changed_at.toISOString());
    expect(after.updated_at).toBeNull();
  });

  it('archiving a lead stage writes no audit_log row', async () => {
    const [orgA] = newOrgPair('noledger');
    const stage = await createLeadStage(db, orgA, LeadStageSchema.parse({ name: 'Sem histórico' }));
    if (typeof stage === 'string') throw new Error(`unexpected sentinel: ${stage}`);

    const countEntries = async () => {
      const [row] = await adminClient<{ count: string }[]>`
        SELECT count(*)::text AS count FROM audit_log
      `;
      return row.count;
    };

    const before = await countEntries();
    await updateLeadStage(db, orgA, stage.id, { status: 'archived' });
    await updateLeadStage(db, orgA, stage.id, { status: 'active' });
    expect(await countEntries()).toBe(before);
  });

  it('org A cannot read org B lead stages', async () => {
    const [orgA, orgB] = newOrgPair('crossorg');
    const stageA = await createLeadStage(db, orgA, LeadStageSchema.parse({ name: 'Somente A' }));
    const stageB = await createLeadStage(db, orgB, LeadStageSchema.parse({ name: 'Somente B' }));
    if (typeof stageA === 'string') throw new Error(`unexpected sentinel: ${stageA}`);
    if (typeof stageB === 'string') throw new Error(`unexpected sentinel: ${stageB}`);

    const listA = await listLeadStages(db, orgA);
    const listB = await listLeadStages(db, orgB);
    expect(listA.every((stage) => stage.orgId === orgA)).toBe(true);
    expect(listB.every((stage) => stage.orgId === orgB)).toBe(true);
    expect(listA.map((stage) => stage.id)).not.toContain(stageB.id);
    expect(listB.map((stage) => stage.id)).not.toContain(stageA.id);
  });

  it('scopes every lead stage read by orgId even when RLS is not doing the scoping', async () => {
    // Defence in depth, verified independently: on a connection carrying
    // app.fxl_admin the *_admin_context policy makes every org's rows visible, so
    // if the service ever dropped eq(salesOpsLeadStages.orgId, orgId) these reads
    // would leak the other org. RLS cannot cover for it here.
    const [orgA, orgB] = newOrgPair('servicefilter');
    const stageA = await createLeadStage(adminDb, orgA, LeadStageSchema.parse({ name: 'Filtro A' }));
    const stageB = await createLeadStage(adminDb, orgB, LeadStageSchema.parse({ name: 'Filtro B' }));
    if (typeof stageA === 'string') throw new Error(`unexpected sentinel: ${stageA}`);
    if (typeof stageB === 'string') throw new Error(`unexpected sentinel: ${stageB}`);

    const listA = await listLeadStages(adminDb, orgA);
    expect(listA.every((stage) => stage.orgId === orgA)).toBe(true);
    expect(listA.map((stage) => stage.id)).toContain(stageA.id);
    expect(listA.map((stage) => stage.id)).not.toContain(stageB.id);

    expect(await updateLeadStage(adminDb, orgA, stageB.id, { name: 'hijack' })).toBeNull();
    expect(await reorderLeadStages(adminDb, orgA, [stageA.id, stageB.id])).toBe('set_mismatch');
  });

  it('raw RLS blocks a cross-org lead stage read and WITH CHECK blocks a smuggled insert', async () => {
    // The migrate/admin connection is a cluster superuser and therefore always
    // bypasses row security, FORCE ROW LEVEL SECURITY included. To prove the
    // policies themselves are correct, provision a scoped non-superuser role.
    const roleName = `rls_stage_probe_${randomUUID().replace(/-/g, '_')}`;
    const rolePassword = randomUUID();

    await adminClient.unsafe(
      `CREATE ROLE ${roleName} LOGIN PASSWORD '${rolePassword}' NOSUPERUSER NOBYPASSRLS`,
    );
    await adminClient.unsafe(`GRANT USAGE ON SCHEMA public TO ${roleName}`);
    await adminClient.unsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON sales_ops_lead_stages TO ${roleName}`,
    );

    const roleClient = postgres(withRole(APP_DB_URL, roleName, rolePassword), { max: 1 });

    try {
      const [ORG_A, ORG_B] = newOrgPair('rawrls');

      const stageId = await roleClient.begin(async (tx) => {
        await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
        const [stage] = await tx`
          INSERT INTO sales_ops_lead_stages (org_id, name, kind, is_system, "position")
          VALUES (${ORG_A}, 'RLS Probe Etapa', 'normal', false, 0) RETURNING id
        `;
        return (stage as { id: string }).id;
      });

      const own = await roleClient.begin(async (tx) => {
        await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
        return tx`SELECT id FROM sales_ops_lead_stages WHERE id = ${stageId}`;
      });
      expect(own).toHaveLength(1);

      const other = await roleClient.begin(async (tx) => {
        await tx`SELECT set_config('app.current_org_id', ${ORG_B}, true)`;
        return tx`SELECT id FROM sales_ops_lead_stages WHERE id = ${stageId}`;
      });
      expect(other).toHaveLength(0);

      await expect(
        roleClient.begin(async (tx) => {
          await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
          return tx`
            INSERT INTO sales_ops_lead_stages (org_id, name, kind, is_system, "position")
            VALUES (${ORG_B}, 'Etapa Contrabandeada', 'normal', false, 0) RETURNING id
          `;
        }),
      ).rejects.toThrow();

      const noContext = await roleClient.begin(async (tx) => {
        await tx`SELECT set_config('app.current_org_id', '', true)`;
        return tx`SELECT id FROM sales_ops_lead_stages WHERE id = ${stageId}`;
      });
      expect(noContext).toHaveLength(0);
    } finally {
      await roleClient.end();
      await adminClient.unsafe(`DROP OWNED BY ${roleName}`);
      await adminClient.unsafe(`DROP ROLE ${roleName}`);
    }
  });
});
