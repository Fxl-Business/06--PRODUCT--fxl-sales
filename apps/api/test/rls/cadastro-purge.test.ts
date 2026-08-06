/**
 * Slice 02 (purge-unreferenced-archived) oracle.
 *
 * This is the test for a job that HARD DELETES production data on a schedule, so
 * it is written to fail loudly rather than to pass conveniently. It proves six
 * things:
 *
 *  1. an unreferenced archived cadastro older than the retention window IS
 *     deleted, and the deletion appends a `cadastro.purged` ledger entry that
 *     carries the label snapshot (after the delete, nothing else can render it);
 *  2. a REFERENCED one is NOT deleted, stays archived, and leaves NO ledger entry -
 *     i.e. the 23503 skip takes its own audit write down with it. This assertion
 *     is also the `db`-instead-of-`tx` oracle for the purge, and unlike an
 *     ordinary rollback probe it discriminates for free: the entry is written
 *     BEFORE the DELETE, so the foreign-key violation aborts a transaction that
 *     already contains it;
 *  3. an item archived inside the window is untouched;
 *  4. a system função is never purged, even when old and unreferenced;
 *  5. `verifyChain` still reports the whole ledger valid after purge traffic;
 *  6. the purge never crosses an org boundary.
 *
 * Plus the `archived_at` stamp itself: set on archive, cleared on restore, and
 * left alone by an ordinary rename.
 *
 * DESTRUCTIVE. The purge is cross-tenant by design, so the whole file refuses to
 * run against anything but the local Docker test database - see assertLocalDb().
 *
 * Run: pnpm --filter @fxl-sales/api test:integration
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyChain, type AuditChainRow } from '../../src/domains/audit/service.js';
import * as schema from '../../src/db/schema.js';
import {
  ARCHIVED_CADASTRO_RETENTION_DAYS,
  purgeArchivedCadastros,
} from '../../src/domains/sales-ops/purge-service.js';
import {
  AreaSchema,
  FuncaoSchema,
  ProductSchema,
  createArea,
  createFuncao,
  createPerson,
  createProduct,
  updateArea,
  updateFuncao,
  updatePerson,
  updateProduct,
} from '../../src/domains/sales-ops/service.js';

const APP_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5006/fxl_sales';
const ADMIN_DB_URL = process.env.ADMIN_DATABASE_URL ?? APP_DB_URL;
const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;

/**
 * The purge deletes rows in EVERY org on the connection it is handed, so a
 * misconfigured URL here would not fail a test - it would quietly destroy data in
 * whatever database it reached. apps/api/.env's DATABASE_URL points at STAGING,
 * and test/rls/setup-env.ts is what pins these two to the local Docker DB; this
 * asserts that pinning actually held rather than trusting it.
 */
function assertLocalDb(url: string, label: string): void {
  const host = new URL(url).host;
  if (host !== 'localhost:5006' && host !== '127.0.0.1:5006') {
    throw new Error(
      `refusing to run the destructive purge suite: ${label} points at ${host}, not the local Docker test database`,
    );
  }
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

function toChainRow(row: RawAuditRow): AuditChainRow {
  return {
    actorUserId: row.actor_user_id,
    actorOrgId: row.actor_org_id ?? null,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    beforeJsonb: row.before_jsonb ?? null,
    afterJsonb: row.after_jsonb ?? null,
    requestId: row.request_id ?? null,
    prevHash: row.prev_hash,
    entryHash: row.entry_hash,
  };
}

/** The four cadastro tables, as a closed set - never interpolated from input. */
type CadastroTable =
  | 'sales_ops_products'
  | 'sales_ops_areas'
  | 'sales_ops_funcoes'
  | 'sales_ops_people';

const stamp = `${Date.now()}_${randomUUID().slice(0, 8)}`;
const ACTOR = { userId: `acct_purge_test_${stamp}`, displayName: 'Operador de Teste' } as const;

describe('nightly purge of archived cadastros', () => {
  let appClient: postgres.Sql;
  let adminClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let adminDb: ReturnType<typeof drizzle<typeof schema>>;
  const orgIds: string[] = [];

  function newOrg(label: string): string {
    const orgId = `org_purge_${label}_${stamp}_${randomUUID().slice(0, 8)}`;
    orgIds.push(orgId);
    return orgId;
  }

  async function statusOf(table: CadastroTable, id: string): Promise<string | null> {
    const rows = await adminClient.unsafe<Array<{ status: string }>>(
      `SELECT status FROM ${table} WHERE id = $1`,
      [id],
    );
    return rows[0]?.status ?? null;
  }

  /**
   * The stamp as Postgres renders it. A raw postgres.Sql with no type parser hands
   * a timestamptz back as a string, and comparing strings is exactly what this
   * needs: the assertions here are "is there a stamp" and "is it the SAME stamp".
   */
  async function archivedAtOf(table: CadastroTable, id: string): Promise<string | null> {
    const rows = await adminClient.unsafe<Array<{ archived_at: string | Date | null }>>(
      `SELECT archived_at FROM ${table} WHERE id = $1`,
      [id],
    );
    const value = rows[0]?.archived_at ?? null;
    return value === null ? null : String(value);
  }

  /** Pushes a row's archive stamp outside the retention window. */
  async function backdate(table: CadastroTable, id: string, days = 40): Promise<void> {
    const updated = await adminClient.unsafe(
      `UPDATE ${table} SET archived_at = now() - make_interval(days => $2) WHERE id = $1 RETURNING id`,
      [id, days],
    );
    expect(updated.length, `backdate matched no ${table} row`).toBe(1);
  }

  async function auditRowsForEntity(entityId: string): Promise<RawAuditRow[]> {
    return (await adminClient<RawAuditRow[]>`
      SELECT actor_user_id, actor_org_id, action, entity_type, entity_id,
             before_jsonb, after_jsonb, request_id, prev_hash, entry_hash
      FROM audit_log WHERE entity_id = ${entityId} ORDER BY id ASC
    `) as unknown as RawAuditRow[];
  }

  async function purgeEntriesFor(entityId: string): Promise<RawAuditRow[]> {
    return (await auditRowsForEntity(entityId)).filter((row) => row.action === 'cadastro.purged');
  }

  async function auditRowsForOrg(orgId: string): Promise<RawAuditRow[]> {
    return (await adminClient<RawAuditRow[]>`
      SELECT actor_user_id, actor_org_id, action, entity_type, entity_id,
             before_jsonb, after_jsonb, request_id, prev_hash, entry_hash
      FROM audit_log WHERE actor_org_id = ${orgId} ORDER BY id ASC
    `) as unknown as RawAuditRow[];
  }

  async function verifyWholeLedger() {
    const rows = (await adminClient<RawAuditRow[]>`
      SELECT actor_user_id, actor_org_id, action, entity_type, entity_id,
             before_jsonb, after_jsonb, request_id, prev_hash, entry_hash
      FROM audit_log WHERE length(entry_hash) = 64 ORDER BY id ASC
    `) as unknown as RawAuditRow[];
    return verifyChain(rows.map(toChainRow));
  }

  /** A minimal `open` proposta, enough to hold the FK that must block a delete. */
  async function seedSale(
    orgId: string,
    sequence: number,
    sellerPersonId: string | null,
  ): Promise<string> {
    const [sale] = await adminClient<Array<{ id: string }>>`
      INSERT INTO sales_ops_sales (
        org_id, sequence, code, client_name_snapshot, seller_person_id, seller_name_snapshot,
        status, payment_method, condition, base_date, total_brl,
        seller_commission_pct, finder_commission_pct, tax_pct, net_margin_pct
      ) VALUES (
        ${orgId}, ${sequence}, ${`PRO-${sequence}`}, 'Cliente Teste', ${sellerPersonId}, 'Vendedor Teste',
        'open', 'pix', 'a_vista', now(), 100000,
        0, 0, 0, 0
      ) RETURNING id
    `;
    return sale!.id;
  }

  async function seedSaleItem(
    orgId: string,
    saleId: string,
    productId: string,
    areaId: string,
  ): Promise<void> {
    await adminClient`
      INSERT INTO sales_ops_sale_items (
        org_id, sale_id, product_id, product_name_snapshot, product_type_snapshot,
        area_id, area_name_snapshot, quantity, unit_brl, subtotal_brl
      ) VALUES (
        ${orgId}, ${saleId}, ${productId}, 'Produto Vendido', 'produto',
        ${areaId}, 'Área Vendida', 1, 100000, 100000
      )
    `;
  }

  async function seedSaleProfessional(
    orgId: string,
    saleId: string,
    personId: string,
    funcaoId: string,
  ): Promise<void> {
    await adminClient`
      INSERT INTO sales_ops_sale_professionals (
        org_id, sale_id, person_id, person_name_snapshot,
        funcao_id, funcao_name_snapshot, role, cost_brl
      ) VALUES (
        ${orgId}, ${saleId}, ${personId}, 'Profissional Teste',
        ${funcaoId}, 'Função Teste', 'Função Teste', 1000
      )
    `;
  }

  beforeAll(async () => {
    assertLocalDb(APP_DB_URL, 'TEST_DATABASE_URL');
    assertLocalDb(ADMIN_DB_URL, 'ADMIN_DATABASE_URL');
    appClient = postgres(APP_DB_URL, { max: 5 });
    adminClient = postgres(ADMIN_DB_URL, { max: 2, ...ADMIN_CONNECTION_OPTIONS });
    db = drizzle(appClient, { schema });
    adminDb = drizzle(adminClient, { schema });
    // Deterministic genesis, exactly as cadastro-archive-audit.test.ts does, so
    // verifyChain over the whole table is a meaningful assertion here.
    await adminClient`DELETE FROM audit_log WHERE length(entry_hash) = 64`;
  });

  afterAll(async () => {
    // Every hash-bearing row, not just this file's orgs. The purge is cross-tenant:
    // if a stray archived row from an earlier crashed run qualified, it appended an
    // entry under ITS org, and an org-scoped delete would leave that row behind
    // while removing mine - punching a hole mid-chain that fails verifyChain in
    // every later file. Safe only because vitest.config.ts pins fileParallelism:false.
    await adminClient`DELETE FROM audit_log WHERE length(entry_hash) = 64`;
    for (const orgId of orgIds) {
      await adminClient`DELETE FROM sales_ops_sale_professionals WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_sale_items WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_sales WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_person_funcoes WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_people WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_product_funcao_costs WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_products WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_funcoes WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_clients WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_areas WHERE org_id = ${orgId}`;
    }
    await appClient.end();
    await adminClient.end();
  });

  it('stamps archived_at on archive, clears it on restore, and ignores a rename', async () => {
    const orgId = newOrg('stamp');
    const area = await createArea(db, orgId, AreaSchema.parse({ name: 'Marketing' }));
    if (area === 'duplicate') throw new Error('unexpected duplicate area');
    expect(await archivedAtOf('sales_ops_areas', area.id)).toBeNull();

    await updateArea(db, orgId, area.id, { status: 'archived' }, ACTOR);
    const stampedAt = await archivedAtOf('sales_ops_areas', area.id);
    expect(stampedAt).not.toBeNull();

    // A rename is not a transition, so it must not restart the window.
    await updateArea(db, orgId, area.id, { name: 'Marketing Digital' }, ACTOR);
    expect(await archivedAtOf('sales_ops_areas', area.id)).toEqual(stampedAt);

    await updateArea(db, orgId, area.id, { status: 'active' }, ACTOR);
    expect(await archivedAtOf('sales_ops_areas', area.id)).toBeNull();

    // The other three cadastros carry the same stamp, pessoa on its own spelling.
    const product = await createProduct(
      db,
      orgId,
      ProductSchema.parse({ name: 'FXL Custom', codeSuffix: '11', areaId: area.id }),
    );
    const person = await createPerson(db, orgId, {
      displayName: 'Ana Martins',
      status: 'active',
      isSeller: true,
    });
    if (typeof person === 'string') throw new Error(`unexpected sentinel: ${person}`);
    const funcao = await createFuncao(db, orgId, FuncaoSchema.parse({ name: 'Designer' }));
    if (typeof funcao === 'string') throw new Error(`unexpected sentinel: ${funcao}`);

    await updateProduct(db, orgId, product.product.id, { status: 'archived' }, ACTOR);
    await updatePerson(db, orgId, person.id, { status: 'inactive' }, ACTOR);
    await updateFuncao(db, orgId, funcao.id, { status: 'archived' }, ACTOR);

    expect(await archivedAtOf('sales_ops_products', product.product.id)).not.toBeNull();
    expect(await archivedAtOf('sales_ops_people', person.id)).not.toBeNull();
    expect(await archivedAtOf('sales_ops_funcoes', funcao.id)).not.toBeNull();

    await updatePerson(db, orgId, person.id, { status: 'active' }, ACTOR);
    expect(await archivedAtOf('sales_ops_people', person.id)).toBeNull();
  });

  it('deletes an unreferenced archived cadastro past the window and appends cadastro.purged', async () => {
    expect(ARCHIVED_CADASTRO_RETENTION_DAYS).toBe(30);
    const orgId = newOrg('unreferenced');

    // The área that gets purged carries no produto; the produto that gets purged
    // hangs off a SECOND, still-active área so its own delete is unblocked.
    const orphanArea = await createArea(db, orgId, AreaSchema.parse({ name: 'Área Órfã' }));
    if (orphanArea === 'duplicate') throw new Error('unexpected duplicate area');
    const liveArea = await createArea(db, orgId, AreaSchema.parse({ name: 'Área Viva' }));
    if (liveArea === 'duplicate') throw new Error('unexpected duplicate area');
    const product = await createProduct(
      db,
      orgId,
      ProductSchema.parse({ name: 'Produto Órfão', codeSuffix: '11', areaId: liveArea.id }),
    );
    const person = await createPerson(db, orgId, {
      displayName: 'Bruno Lima',
      status: 'active',
      isSeller: true,
    });
    if (typeof person === 'string') throw new Error(`unexpected sentinel: ${person}`);
    const funcao = await createFuncao(db, orgId, FuncaoSchema.parse({ name: 'Tester' }));
    if (typeof funcao === 'string') throw new Error(`unexpected sentinel: ${funcao}`);

    await updateArea(db, orgId, orphanArea.id, { status: 'archived' }, ACTOR);
    await updateProduct(db, orgId, product.product.id, { status: 'archived' }, ACTOR);
    await updatePerson(db, orgId, person.id, { status: 'inactive' }, ACTOR);
    await updateFuncao(db, orgId, funcao.id, { status: 'archived' }, ACTOR);

    await backdate('sales_ops_areas', orphanArea.id);
    await backdate('sales_ops_products', product.product.id);
    await backdate('sales_ops_people', person.id);
    await backdate('sales_ops_funcoes', funcao.id);

    const report = await purgeArchivedCadastros(adminDb);
    expect(report.area.failed).toBe(0);
    expect(report.produto.failed).toBe(0);
    expect(report.pessoa.failed).toBe(0);
    expect(report.funcao.failed).toBe(0);
    expect(report.area.purged).toBeGreaterThanOrEqual(1);
    expect(report.produto.purged).toBeGreaterThanOrEqual(1);
    expect(report.pessoa.purged).toBeGreaterThanOrEqual(1);
    expect(report.funcao.purged).toBeGreaterThanOrEqual(1);

    // All four rows are GONE, and the still-active área beside them is not.
    expect(await statusOf('sales_ops_areas', orphanArea.id)).toBeNull();
    expect(await statusOf('sales_ops_products', product.product.id)).toBeNull();
    expect(await statusOf('sales_ops_people', person.id)).toBeNull();
    expect(await statusOf('sales_ops_funcoes', funcao.id)).toBeNull();
    expect(await statusOf('sales_ops_areas', liveArea.id)).toBe('active');

    // The pessoa's own função assignment went with it (ON DELETE CASCADE), which
    // is the item's own configuration and not shared history.
    const [assignments] = await adminClient<Array<{ count: string }>>`
      SELECT count(*)::text AS count FROM sales_ops_person_funcoes WHERE person_id = ${person.id}
    `;
    expect(Number(assignments!.count)).toBe(0);

    const areaEntries = await purgeEntriesFor(orphanArea.id);
    expect(areaEntries).toHaveLength(1);
    const entry = areaEntries[0]!;
    // A SYSTEM action: no operator exists, so the actor is the reserved 'system'
    // id already used by the conversions ingest, never a real Hub account id.
    expect(entry.actor_user_id).toBe('system');
    // NEVER null: the org-scoped history read filters on actor_org_id, so a null
    // here would hide the entry from the only tenant entitled to read it.
    expect(entry.actor_org_id).toBe(orgId);
    expect(entry.entity_type).toBe('area');
    expect(entry.before_jsonb).toEqual({ status: 'archived' });
    // The label snapshot is the WHOLE point: the row is gone, so the ledger is the
    // only thing left that can name what was deleted.
    expect(entry.after_jsonb).toEqual({
      status: 'purged',
      label: 'Área Órfã',
      actorLabel: 'Sistema',
    });
    expect(entry.entry_hash).toMatch(/^[a-f0-9]{64}$/);

    const personEntries = await purgeEntriesFor(person.id);
    expect(personEntries).toHaveLength(1);
    expect(personEntries[0]!.entity_type).toBe('pessoa');
    // Pessoas spell archived 'inactive', and the entry records what was true.
    expect(personEntries[0]!.before_jsonb).toEqual({ status: 'inactive' });
    expect((personEntries[0]!.after_jsonb as Record<string, unknown>).label).toBe('Bruno Lima');

    expect((await purgeEntriesFor(product.product.id))[0]?.entity_type).toBe('produto');
    expect((await purgeEntriesFor(funcao.id))[0]?.entity_type).toBe('funcao');

    // Every archive entry that preceded the purge survives it: the ledger appends.
    expect((await auditRowsForEntity(orphanArea.id)).map((row) => row.action)).toEqual([
      'cadastro.archived',
      'cadastro.purged',
    ]);
    expect(await verifyWholeLedger()).toEqual({ valid: true, brokenAt: null });
  });

  it('never deletes a referenced cadastro, and leaves no ledger entry behind', async () => {
    const orgId = newOrg('referenced');
    const area = await createArea(db, orgId, AreaSchema.parse({ name: 'Área Usada' }));
    if (area === 'duplicate') throw new Error('unexpected duplicate area');
    const product = await createProduct(
      db,
      orgId,
      ProductSchema.parse({ name: 'Produto Usado', codeSuffix: '21', areaId: area.id }),
    );
    const person = await createPerson(db, orgId, {
      displayName: 'Carla Souza',
      status: 'active',
      isSeller: true,
    });
    if (typeof person === 'string') throw new Error(`unexpected sentinel: ${person}`);
    const funcao = await createFuncao(db, orgId, FuncaoSchema.parse({ name: 'P.O.' }));
    if (typeof funcao === 'string') throw new Error(`unexpected sentinel: ${funcao}`);

    // One proposta that references all four: the produto and the área on its item,
    // the pessoa as vendedor, and the pessoa + função on a profissional row.
    const saleId = await seedSale(orgId, 1, person.id);
    await seedSaleItem(orgId, saleId, product.product.id, area.id);
    await seedSaleProfessional(orgId, saleId, person.id, funcao.id);

    await updateArea(db, orgId, area.id, { status: 'archived' }, ACTOR);
    await updateProduct(db, orgId, product.product.id, { status: 'archived' }, ACTOR);
    await updatePerson(db, orgId, person.id, { status: 'inactive' }, ACTOR);
    await updateFuncao(db, orgId, funcao.id, { status: 'archived' }, ACTOR);

    await backdate('sales_ops_areas', area.id);
    await backdate('sales_ops_products', product.product.id);
    await backdate('sales_ops_people', person.id);
    await backdate('sales_ops_funcoes', funcao.id);

    const report = await purgeArchivedCadastros(adminDb);
    // A foreign-key violation is a SKIP, never a failure: it is the database
    // answering "still referenced", which is the rule this job is built on.
    expect(report.area.failed).toBe(0);
    expect(report.produto.failed).toBe(0);
    expect(report.pessoa.failed).toBe(0);
    expect(report.funcao.failed).toBe(0);
    expect(report.area.skipped).toBeGreaterThanOrEqual(1);
    expect(report.produto.skipped).toBeGreaterThanOrEqual(1);
    expect(report.pessoa.skipped).toBeGreaterThanOrEqual(1);
    expect(report.funcao.skipped).toBeGreaterThanOrEqual(1);
    expect(report.area.purged).toBe(0);
    expect(report.produto.purged).toBe(0);
    expect(report.pessoa.purged).toBe(0);
    expect(report.funcao.purged).toBe(0);

    // Still there, and still ARCHIVED - a skip changes nothing about the row.
    expect(await statusOf('sales_ops_areas', area.id)).toBe('archived');
    expect(await statusOf('sales_ops_products', product.product.id)).toBe('archived');
    expect(await statusOf('sales_ops_people', person.id)).toBe('inactive');
    expect(await statusOf('sales_ops_funcoes', funcao.id)).toBe('archived');

    // THE ATOMICITY ORACLE. The audit entry is written BEFORE the DELETE, so the
    // 23503 aborts a transaction that already contains it. With the transaction
    // handle it rolls back; handed the pooled `db` it would commit on a second
    // connection and leave a ledger entry claiming a deletion that never happened.
    for (const entityId of [area.id, product.product.id, person.id, funcao.id]) {
      expect(
        await purgeEntriesFor(entityId),
        'a skipped purge left a ledger entry - writeAuditEntry was handed `db` instead of the transaction handle',
      ).toHaveLength(0);
    }

    // The proposta that blocked the delete is itself untouched.
    const [saleRow] = await adminClient<Array<{ count: string }>>`
      SELECT count(*)::text AS count FROM sales_ops_sale_items WHERE sale_id = ${saleId}
    `;
    expect(Number(saleRow!.count)).toBe(1);
    expect(await verifyWholeLedger()).toEqual({ valid: true, brokenAt: null });
  });

  it('never touches a cadastro archived inside the retention window', async () => {
    const orgId = newOrg('recent');
    const area = await createArea(db, orgId, AreaSchema.parse({ name: 'Recém-arquivada' }));
    if (area === 'duplicate') throw new Error('unexpected duplicate area');
    await updateArea(db, orgId, area.id, { status: 'archived' }, ACTOR);

    // Exactly one day inside the window - the boundary, not a comfortable margin.
    await backdate('sales_ops_areas', area.id, ARCHIVED_CADASTRO_RETENTION_DAYS - 1);
    await purgeArchivedCadastros(adminDb);
    expect(await statusOf('sales_ops_areas', area.id)).toBe('archived');
    expect(await purgeEntriesFor(area.id)).toHaveLength(0);

    // An ACTIVE row has no stamp at all and can never be selected.
    const active = await createArea(db, orgId, AreaSchema.parse({ name: 'Ativa' }));
    if (active === 'duplicate') throw new Error('unexpected duplicate area');
    await purgeArchivedCadastros(adminDb);
    expect(await statusOf('sales_ops_areas', active.id)).toBe('active');
  });

  it('never purges a system função, even when old and unreferenced', async () => {
    const orgId = newOrg('system');
    // Seeded raw: the API refuses to archive a system função at all, so this state
    // is only reachable by a direct write - which is exactly the case the purge
    // must survive, because it is the one that would delete an app role.
    const [seeded] = await adminClient<Array<{ id: string }>>`
      INSERT INTO sales_ops_funcoes (org_id, name, slug, is_system, status, archived_at)
      VALUES (${orgId}, 'Vendedor', 'vendedor', true, 'archived', now() - make_interval(days => 400))
      RETURNING id
    `;

    const report = await purgeArchivedCadastros(adminDb);
    expect(report.funcao.failed).toBe(0);
    expect(await statusOf('sales_ops_funcoes', seeded!.id)).toBe('archived');
    expect(await purgeEntriesFor(seeded!.id)).toHaveLength(0);
  });

  it('purges one org without ever touching another', async () => {
    const orgA = newOrg('crossorg_a');
    const orgB = newOrg('crossorg_b');

    const areaA = await createArea(db, orgA, AreaSchema.parse({ name: 'Compartilhada' }));
    if (areaA === 'duplicate') throw new Error('unexpected duplicate area');
    const areaB = await createArea(db, orgB, AreaSchema.parse({ name: 'Compartilhada' }));
    if (areaB === 'duplicate') throw new Error('unexpected duplicate area');

    // Same name, same age, same archived state. The ONLY difference is that org B's
    // is referenced by a proposta item, so only org A's may disappear.
    const productB = await createProduct(
      db,
      orgB,
      ProductSchema.parse({ name: 'Produto B', codeSuffix: '31', areaId: areaB.id }),
    );
    const saleB = await seedSale(orgB, 1, null);
    await seedSaleItem(orgB, saleB, productB.product.id, areaB.id);

    await updateArea(db, orgA, areaA.id, { status: 'archived' }, ACTOR);
    await updateArea(db, orgB, areaB.id, { status: 'archived' }, ACTOR);
    await backdate('sales_ops_areas', areaA.id);
    await backdate('sales_ops_areas', areaB.id);

    await purgeArchivedCadastros(adminDb);

    expect(await statusOf('sales_ops_areas', areaA.id)).toBeNull();
    expect(await statusOf('sales_ops_areas', areaB.id)).toBe('archived');

    // Each entry lands under its OWN org, and org B's history shows no purge at all.
    const aEntries = (await auditRowsForOrg(orgA)).filter((row) => row.action === 'cadastro.purged');
    expect(aEntries).toHaveLength(1);
    expect(aEntries[0]!.entity_id).toBe(areaA.id);
    expect((await auditRowsForOrg(orgB)).some((row) => row.action === 'cadastro.purged')).toBe(
      false,
    );
  });

  it('backfills a pre-0020 archived row onto a fresh window, and leaves active rows alone', async () => {
    // The backfill decides whether the EXISTING archived backlog is ever purged at
    // all, and it runs exactly once, at deploy, where a mistake is unrecoverable.
    // So it is replayed here from the migration file itself rather than restated:
    // the statements are idempotent (`archived_at IS NULL` guards every one), which
    // is what makes replaying them against an already-migrated database safe.
    const orgId = newOrg('backfill');
    // Inserted raw, in the shape a pre-0020 row has: archived, and unstamped.
    const [legacyArea] = await adminClient<Array<{ id: string }>>`
      INSERT INTO sales_ops_areas (org_id, name, status) VALUES (${orgId}, 'Legada', 'archived')
      RETURNING id
    `;
    const [liveArea] = await adminClient<Array<{ id: string }>>`
      INSERT INTO sales_ops_areas (org_id, name, status) VALUES (${orgId}, 'Viva', 'active')
      RETURNING id
    `;
    const [legacyPerson] = await adminClient<Array<{ id: string }>>`
      INSERT INTO sales_ops_people (org_id, display_name, status)
      VALUES (${orgId}, 'Legado', 'inactive') RETURNING id
    `;
    const [legacyFuncao] = await adminClient<Array<{ id: string }>>`
      INSERT INTO sales_ops_funcoes (org_id, name, slug, status)
      VALUES (${orgId}, 'Legada', ${`legada-${randomUUID().slice(0, 8)}`}, 'archived') RETURNING id
    `;

    const source = await readFile(
      new URL('../../drizzle/0020_cadastro_archived_at.sql', import.meta.url),
      'utf8',
    );
    const backfill = source
      .split('--> statement-breakpoint')
      .filter((statement) => statement.trim() !== '' && !statement.includes('ADD COLUMN'));
    // Four UPDATEs plus the admin-context set_config that lets them see the rows
    // under FORCE ROW LEVEL SECURITY.
    expect(backfill).toHaveLength(5);
    for (const statement of backfill) await adminClient.unsafe(statement);

    expect(await archivedAtOf('sales_ops_areas', legacyArea!.id)).not.toBeNull();
    expect(await archivedAtOf('sales_ops_people', legacyPerson!.id)).not.toBeNull();
    expect(await archivedAtOf('sales_ops_funcoes', legacyFuncao!.id)).not.toBeNull();
    // An ACTIVE row must never be stamped - it would become purgeable the moment
    // someone archived it, with no window at all.
    expect(await archivedAtOf('sales_ops_areas', liveArea!.id)).toBeNull();

    // And the fresh window is a FULL one: nothing backfilled is purgeable today.
    await purgeArchivedCadastros(adminDb);
    expect(await statusOf('sales_ops_areas', legacyArea!.id)).toBe('archived');
    expect(await statusOf('sales_ops_people', legacyPerson!.id)).toBe('inactive');
    expect(await statusOf('sales_ops_funcoes', legacyFuncao!.id)).toBe('archived');
  });

  it('keeps the whole ledger verifiable after all the purge traffic', async () => {
    expect(await verifyWholeLedger()).toEqual({ valid: true, brokenAt: null });
  });
});
