/**
 * Slice 01 (audit-the-cadastro-lifecycle) oracle.
 *
 * Proves that archiving or restoring one of the four status-bearing sales-ops
 * cadastros (produto, pessoa, funcao, area) appends exactly one hash-chained
 * audit_log row IN THE SAME TRANSACTION as the status write, and that neither
 * half survives when the other fails.
 *
 * The writes are driven over the APP connection (the non-superuser
 * `fxl_sales_test` role) on purpose: that also proves the tenant role can INSERT
 * into audit_log and take FOR UPDATE on its tail, which is a live failure mode.
 * The admin (`app.fxl_admin`) postgres.Sql is used only for seeding, raw
 * assertions, trigger management and cleanup.
 *
 * Run: pnpm --filter @fxl-sales/api test:integration
 */
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyChain, type AuditChainRow } from '../../src/domains/audit/service.js';
import * as schema from '../../src/db/schema.js';
import {
  AreaSchema,
  FuncaoSchema,
  ProductSchema,
  createArea,
  createClient,
  createFuncao,
  createPerson,
  createProduct,
  updateArea,
  updateClient,
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

const stamp = `${Date.now()}_${randomUUID().slice(0, 8)}`;
const ACTOR = { userId: `acct_audit_test_${stamp}`, displayName: 'Auditor de Teste' } as const;

describe('cadastro archive/restore audit ledger', () => {
  let appClient: postgres.Sql;
  let adminClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const orgIds: string[] = [];

  function newOrg(label: string): string {
    const orgId = `org_audit_${label}_${stamp}_${randomUUID().slice(0, 8)}`;
    orgIds.push(orgId);
    return orgId;
  }

  async function auditRowsFor(orgId: string): Promise<RawAuditRow[]> {
    return (await adminClient<RawAuditRow[]>`
      SELECT actor_user_id, actor_org_id, action, entity_type, entity_id,
             before_jsonb, after_jsonb, request_id, prev_hash, entry_hash
      FROM audit_log WHERE actor_org_id = ${orgId} ORDER BY id ASC
    `) as unknown as RawAuditRow[];
  }

  async function auditCountForEntity(entityId: string): Promise<number> {
    const [row] = await adminClient<{ count: string }[]>`
      SELECT count(*)::text AS count FROM audit_log WHERE entity_id = ${entityId}
    `;
    return Number(row.count);
  }

  /**
   * Asserts the promise rejected with the rollback probe's exception.
   *
   * Drizzle wraps a postgres.js error in a DrizzleQueryError whose own message is
   * `Failed query: ...`, so the probe's `RAISE EXCEPTION` text only ever appears
   * on the `cause` chain. Matching the whole chain keeps the assertion specific -
   * an unrelated failure still fails it - without depending on which layer of the
   * stack happens to surface the text.
   */
  async function expectRollbackProbeRejection(promise: Promise<unknown>): Promise<void> {
    const thrown = await promise.then(
      () => null,
      (error: unknown) => ({ error }),
    );
    expect(thrown, 'expected the write to reject, but it resolved').not.toBeNull();
    const chain: string[] = [];
    let current: unknown = thrown!.error;
    for (let depth = 0; current !== undefined && current !== null && depth < 5; depth += 1) {
      chain.push(String((current as { message?: unknown }).message ?? current));
      current = (current as { cause?: unknown }).cause;
    }
    expect(chain.join(' | ')).toMatch(/fxl_audit_rollback_probe/);
  }

  async function verifyWholeLedger() {
    const rows = (await adminClient<RawAuditRow[]>`
      SELECT actor_user_id, actor_org_id, action, entity_type, entity_id,
             before_jsonb, after_jsonb, request_id, prev_hash, entry_hash
      FROM audit_log WHERE length(entry_hash) = 64 ORDER BY id ASC
    `) as unknown as RawAuditRow[];
    return verifyChain(rows.map(toChainRow));
  }

  beforeAll(async () => {
    appClient = postgres(APP_DB_URL, { max: 5 });
    adminClient = postgres(ADMIN_DB_URL, { max: 2, ...ADMIN_CONNECTION_OPTIONS });
    db = drizzle(appClient, { schema });
    // Give the ledger a deterministic genesis so verifyChain over the whole table
    // is a meaningful assertion. Pre-Phase-05 placeholder rows (entry_hash = '')
    // are deliberately preserved - the product treats them as outside the chain.
    await adminClient`DELETE FROM audit_log WHERE length(entry_hash) = 64`;
  });

  afterAll(async () => {
    // Deleting ledger rows is only safe because apps/api/vitest.config.ts sets
    // `fileParallelism: false` for the integration project: this afterAll runs
    // before the next file's first statement, so every row written here is still
    // the ledger TAIL and a tail delete leaves the remaining chain contiguous.
    // With file parallelism on, these deletes would punch holes mid-chain and
    // verifyChain would fail everywhere.
    for (const orgId of orgIds) {
      await adminClient`DELETE FROM audit_log WHERE actor_org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_person_funcoes WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_people WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_product_funcao_costs WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_products WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_funcoes WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_clients WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_areas WHERE org_id = ${orgId}`;
    }
    // Defensive: the probes below drop their own trigger in a finally, but a hard
    // failure mid-test must not leave one armed for the next file.
    await adminClient.unsafe(`DROP TRIGGER IF EXISTS fxl_audit_rollback_probe_trg ON audit_log`);
    await adminClient.unsafe(
      `DROP TRIGGER IF EXISTS fxl_status_rollback_probe_trg ON sales_ops_areas`,
    );
    await adminClient.unsafe(
      `DROP TRIGGER IF EXISTS fxl_commit_rollback_probe_trg ON sales_ops_areas`,
    );
    await adminClient.unsafe(`DROP FUNCTION IF EXISTS fxl_audit_rollback_probe()`);
    await appClient.end();
    await adminClient.end();
  });

  it('appends exactly one entry when an área is archived, and a NEW one when it is restored', async () => {
    const orgA = newOrg('lifecycle');
    const area = await createArea(db, orgA, AreaSchema.parse({ name: 'Marketing' }));
    if (area === 'duplicate') throw new Error('unexpected duplicate area');

    // 1. Archive writes the entry, with the right everything.
    const archived = await updateArea(db, orgA, area.id, { status: 'archived' }, ACTOR);
    if (archived === 'duplicate') throw new Error('unexpected duplicate');
    expect(archived?.status).toBe('archived');

    const afterArchive = await auditRowsFor(orgA);
    expect(afterArchive).toHaveLength(1);
    const entry = afterArchive[0]!;
    expect(entry.actor_user_id).toBe(ACTOR.userId);
    expect(entry.actor_org_id).toBe(orgA);
    expect(entry.action).toBe('cadastro.archived');
    expect(entry.entity_type).toBe('area');
    expect(entry.entity_id).toBe(area.id);
    expect(entry.before_jsonb).toEqual({ status: 'active' });
    expect(entry.after_jsonb).toEqual({
      status: 'archived',
      label: 'Marketing',
      actorLabel: 'Auditor de Teste',
    });
    expect(entry.prev_hash).toBe('0'.repeat(64));
    expect(entry.entry_hash).toMatch(/^[a-f0-9]{64}$/);

    // 2. Restore is a NEW append, never a rewrite.
    const restored = await updateArea(db, orgA, area.id, { status: 'active' }, ACTOR);
    if (restored === 'duplicate') throw new Error('unexpected duplicate');
    expect(restored?.status).toBe('active');

    const afterRestore = await auditRowsFor(orgA);
    expect(afterRestore).toHaveLength(2);
    // The archive row is byte-identical to what was read a moment ago: the chain
    // is append-only and an archive is never "undone" in place.
    expect(afterRestore[0]).toEqual(entry);
    const second = afterRestore[1]!;
    expect(second.action).toBe('cadastro.restored');
    expect(second.before_jsonb).toEqual({ status: 'archived' });
    expect(second.after_jsonb).toEqual({
      status: 'active',
      label: 'Marketing',
      actorLabel: 'Auditor de Teste',
    });
    expect(second.prev_hash).toBe(entry.entry_hash);

    // 2b. A null actor display name is stored as null, NEVER as the account id.
    const area2 = await createArea(db, orgA, AreaSchema.parse({ name: 'Vendas' }));
    if (area2 === 'duplicate') throw new Error('unexpected duplicate area');
    await updateArea(
      db,
      orgA,
      area2.id,
      { status: 'archived' },
      {
        userId: ACTOR.userId,
        displayName: null,
      },
    );
    const nullActorRows = await auditRowsFor(orgA);
    expect(nullActorRows).toHaveLength(3);
    const nullActor = nullActorRows[2]!.after_jsonb as Record<string, unknown>;
    expect(nullActor.actorLabel).toBeNull();
    expect(nullActor.actorLabel).not.toBe(ACTOR.userId);

    // 3. The chain is valid - same query and same function the verify endpoint runs.
    expect(await verifyWholeLedger()).toEqual({ valid: true, brokenAt: null });
  });

  it('writes nothing when the status does not actually transition', async () => {
    // The produto and pessoa dialogs both submit their FULL row on every save,
    // status included, so an ordinary rename arrives as a PATCH carrying
    // status:'active' on an already-active row. Without the before === after
    // guard every save would append a spurious 'restored' entry.
    const orgId = newOrg('noop');
    const area = await createArea(db, orgId, AreaSchema.parse({ name: 'Produto' }));
    if (area === 'duplicate') throw new Error('unexpected duplicate area');

    const renamed = await updateArea(db, orgId, area.id, { name: 'Renomeada' }, ACTOR);
    if (renamed === 'duplicate') throw new Error('unexpected duplicate');
    expect(renamed?.name).toBe('Renomeada');

    const resaved = await updateArea(db, orgId, area.id, { status: 'active' }, ACTOR);
    if (resaved === 'duplicate') throw new Error('unexpected duplicate');
    expect(resaved?.status).toBe('active');

    expect(await auditRowsFor(orgId)).toHaveLength(0);
  });

  it('covers all four entity types with one entry each, and no cliente entry at all', async () => {
    const orgId = newOrg('kinds');

    const area = await createArea(db, orgId, AreaSchema.parse({ name: 'FXL Tech' }));
    if (area === 'duplicate') throw new Error('unexpected duplicate area');
    const created = await createProduct(
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

    const archivedProduct = await updateProduct(
      db,
      orgId,
      created.product.id,
      { status: 'archived' },
      ACTOR,
    );
    expect(archivedProduct && typeof archivedProduct !== 'string').toBe(true);
    const archivedPerson = await updatePerson(db, orgId, person.id, { status: 'inactive' }, ACTOR);
    if (typeof archivedPerson === 'string')
      throw new Error(`unexpected sentinel: ${archivedPerson}`);
    expect(archivedPerson?.status).toBe('inactive');
    const archivedFuncao = await updateFuncao(db, orgId, funcao.id, { status: 'archived' }, ACTOR);
    if (typeof archivedFuncao === 'string')
      throw new Error(`unexpected sentinel: ${archivedFuncao}`);
    const archivedArea = await updateArea(db, orgId, area.id, { status: 'archived' }, ACTOR);
    if (archivedArea === 'duplicate') throw new Error('unexpected duplicate');

    const rows = await auditRowsFor(orgId);
    expect(rows).toHaveLength(4);
    // These four literals are the wire contract slice 04 matches on - a typo here
    // is a silently read-only history.
    expect(new Set(rows.map((row) => row.entity_type))).toEqual(
      new Set(['produto', 'pessoa', 'funcao', 'area']),
    );
    expect(rows.every((row) => row.action === 'cadastro.archived')).toBe(true);

    const byType = Object.fromEntries(
      rows.map((row) => [row.entity_type, row.after_jsonb as Record<string, unknown>]),
    );
    // The pt-BR archived-spelling split: pessoas go 'inactive', everything else
    // goes 'archived'. One pair of actions covers both.
    expect(byType.pessoa!.status).toBe('inactive');
    expect(byType.produto!.status).toBe('archived');
    expect(byType.funcao!.status).toBe('archived');
    expect(byType.area!.status).toBe('archived');
    expect(byType.produto!.label).toBe('FXL Custom');
    expect(byType.pessoa!.label).toBe('Ana Martins');
    expect(byType.funcao!.label).toBe('Designer');
    expect(byType.area!.label).toBe('FXL Tech');

    // 5b. Cliente is deliberately out of this feature: a cliente write appends
    // nothing. This pins that updateClient was not quietly instrumented.
    const client = await createClient(db, orgId, { name: 'SegPro' });
    const renamedClient = await updateClient(db, orgId, client.id, { name: 'Renomeado' });
    expect(renamedClient?.name).toBe('Renomeado');
    expect(await auditCountForEntity(client.id)).toBe(0);

    expect(await verifyWholeLedger()).toEqual({ valid: true, brokenAt: null });
  });

  it('logs nothing when a system função is refused', async () => {
    const orgId = newOrg('system');
    const [seeded] = await adminClient<{ id: string }[]>`
      INSERT INTO sales_ops_funcoes (org_id, name, slug, is_system)
      VALUES (${orgId}, 'Vendedor', 'vendedor', true)
      RETURNING id
    `;

    expect(await updateFuncao(db, orgId, seeded.id, { status: 'archived' }, ACTOR)).toBe(
      'is_system',
    );
    expect(await auditCountForEntity(seeded.id)).toBe(0);

    // Positive control in the same org: an org-created função does log exactly one.
    const dynamic = await createFuncao(db, orgId, FuncaoSchema.parse({ name: 'Tester' }));
    if (typeof dynamic === 'string') throw new Error(`unexpected sentinel: ${dynamic}`);
    const archived = await updateFuncao(db, orgId, dynamic.id, { status: 'archived' }, ACTOR);
    if (typeof archived === 'string') throw new Error(`unexpected sentinel: ${archived}`);
    expect(await auditCountForEntity(dynamic.id)).toBe(1);
  });

  it('logs nothing for a cross-org write that never happened', async () => {
    const orgA = newOrg('crossorg_a');
    const orgB = newOrg('crossorg_b');
    const area = await createArea(db, orgA, AreaSchema.parse({ name: 'Isolada' }));
    if (area === 'duplicate') throw new Error('unexpected duplicate area');

    expect(await updateArea(db, orgB, area.id, { status: 'archived' }, ACTOR)).toBeNull();

    const [raw] = await adminClient<{ status: string }[]>`
      SELECT status FROM sales_ops_areas WHERE id = ${area.id}
    `;
    expect(raw.status).toBe('active');
    expect(await auditCountForEntity(area.id)).toBe(0);
    expect(await auditRowsFor(orgB)).toHaveLength(0);
  });

  it('rolls the status change back when the ledger write fails', async () => {
    // THE atomicity oracle. It cannot be satisfied by a fire-and-forget or
    // after-commit audit write, and it is the one that fails if the audit helper
    // is handed `db` instead of the `tx` from withTenant - both are typed `Db`,
    // so that mistake compiles and every other test stays green.
    const orgId = newOrg('rollback_ledger');
    const area = await createArea(db, orgId, AreaSchema.parse({ name: 'Sentinela Ledger' }));
    if (area === 'duplicate') throw new Error('unexpected duplicate area');

    await adminClient.unsafe(`
      CREATE OR REPLACE FUNCTION fxl_audit_rollback_probe() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'fxl_audit_rollback_probe'; END $$ LANGUAGE plpgsql
    `);
    // Pinned to a sentinel id so nothing else in the suite can trip it.
    await adminClient.unsafe(`
      CREATE TRIGGER fxl_audit_rollback_probe_trg BEFORE INSERT ON audit_log
        FOR EACH ROW WHEN (NEW.entity_id = '${area.id}')
        EXECUTE FUNCTION fxl_audit_rollback_probe()
    `);

    try {
      await expectRollbackProbeRejection(
        updateArea(db, orgId, area.id, { status: 'archived' }, ACTOR),
      );

      const [raw] = await adminClient<{ status: string }[]>`
        SELECT status FROM sales_ops_areas WHERE id = ${area.id}
      `;
      expect(raw.status).toBe('active');
      expect(await auditCountForEntity(area.id)).toBe(0);
    } finally {
      await adminClient.unsafe(`DROP TRIGGER IF EXISTS fxl_audit_rollback_probe_trg ON audit_log`);
      await adminClient.unsafe(`DROP FUNCTION IF EXISTS fxl_audit_rollback_probe()`);
    }
  });

  it('leaves no ledger entry when the status write itself fails', async () => {
    const orgId = newOrg('rollback_status');
    const area = await createArea(db, orgId, AreaSchema.parse({ name: 'Sentinela Status' }));
    if (area === 'duplicate') throw new Error('unexpected duplicate area');

    await adminClient.unsafe(`
      CREATE OR REPLACE FUNCTION fxl_audit_rollback_probe() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'fxl_audit_rollback_probe'; END $$ LANGUAGE plpgsql
    `);
    await adminClient.unsafe(`
      CREATE TRIGGER fxl_status_rollback_probe_trg BEFORE UPDATE ON sales_ops_areas
        FOR EACH ROW WHEN (NEW.status = 'archived' AND NEW.id = '${area.id}')
        EXECUTE FUNCTION fxl_audit_rollback_probe()
    `);

    try {
      await expectRollbackProbeRejection(
        updateArea(db, orgId, area.id, { status: 'archived' }, ACTOR),
      );

      const [raw] = await adminClient<{ status: string }[]>`
        SELECT status FROM sales_ops_areas WHERE id = ${area.id}
      `;
      expect(raw.status).toBe('active');
      expect(await auditCountForEntity(area.id)).toBe(0);
    } finally {
      await adminClient.unsafe(
        `DROP TRIGGER IF EXISTS fxl_status_rollback_probe_trg ON sales_ops_areas`,
      );
      await adminClient.unsafe(`DROP FUNCTION IF EXISTS fxl_audit_rollback_probe()`);
    }
  });

  it('takes the ledger entry down with a transaction that fails at COMMIT', async () => {
    // THE `db`-instead-of-`tx` oracle, and the only assertion in this file that
    // actually discriminates. The two probes above do NOT: the audit call is the
    // last statement in the transaction, so a BEFORE INSERT probe on audit_log
    // throws before anything commits and a BEFORE UPDATE probe on the área throws
    // before the audit call is even reached - both roll back either way. Passing
    // `db` opens a SECOND pooled connection in autocommit, so the ledger row is
    // durable the instant it is written; the only way to see that is to fail the
    // transaction AFTER the entry exists.
    //
    // A DEFERRABLE INITIALLY DEFERRED constraint trigger does exactly that: it
    // fires at COMMIT, after the status write and after the audit write.
    //   with `tx`: the entry is inside the transaction  -> rolled back, 0 rows
    //   with `db`: the entry committed on its own connection -> 1 orphan row
    const orgId = newOrg('rollback_commit');
    const area = await createArea(db, orgId, AreaSchema.parse({ name: 'Sentinela Commit' }));
    if (area === 'duplicate') throw new Error('unexpected duplicate area');

    await adminClient.unsafe(`
      CREATE OR REPLACE FUNCTION fxl_audit_rollback_probe() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'fxl_audit_rollback_probe'; END $$ LANGUAGE plpgsql
    `);
    await adminClient.unsafe(`
      CREATE CONSTRAINT TRIGGER fxl_commit_rollback_probe_trg AFTER UPDATE ON sales_ops_areas
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW WHEN (NEW.id = '${area.id}')
        EXECUTE FUNCTION fxl_audit_rollback_probe()
    `);

    try {
      await expectRollbackProbeRejection(
        updateArea(db, orgId, area.id, { status: 'archived' }, ACTOR),
      );

      const [raw] = await adminClient<{ status: string }[]>`
        SELECT status FROM sales_ops_areas WHERE id = ${area.id}
      `;
      expect(raw.status).toBe('active');
      expect(
        await auditCountForEntity(area.id),
        'the ledger entry outlived its own transaction - auditCadastroLifecycle was handed `db` instead of the `tx` from withTenant',
      ).toBe(0);
    } finally {
      await adminClient.unsafe(
        `DROP TRIGGER IF EXISTS fxl_commit_rollback_probe_trg ON sales_ops_areas`,
      );
      await adminClient.unsafe(`DROP FUNCTION IF EXISTS fxl_audit_rollback_probe()`);
    }
  });

  it('keeps the whole ledger verifiable after both rollbacks', async () => {
    // A partially-applied entry would have broken the chain.
    expect(await verifyWholeLedger()).toEqual({ valid: true, brokenAt: null });
  });
});
