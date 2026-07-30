import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const APP_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5006/fxl_sales';
const ADMIN_DB_URL = process.env.ADMIN_DATABASE_URL ?? APP_DB_URL;
const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;
const DRIZZLE_DIR = path.resolve(process.cwd(), 'drizzle');

type FuncaoRow = { id: string; name: string; slug: string; is_system: boolean; status: string };
type AssignmentRow = { person_id: string; slug: string };

describe('funções schema migration 0012', () => {
  let adminClient: postgres.Sql;
  const orgIds: string[] = [];

  /**
   * Replays the shipped 0012 backfill (everything from the admin-context
   * set_config onward) so the fixtures below are migrated by exactly the SQL that
   * ships, not by a paraphrase of it.
   */
  async function replayBackfill(): Promise<void> {
    const migrationFile = fs.readdirSync(DRIZZLE_DIR).find((file) => /^0012_.*\.sql$/.test(file));
    if (!migrationFile) throw new Error('migration 0012 file not found in the drizzle directory');
    const statements = fs
      .readFileSync(path.join(DRIZZLE_DIR, migrationFile), 'utf8')
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter(Boolean);
    const backfillStartIndex = statements.findIndex((statement) =>
      statement.includes("set_config('app.fxl_admin'"),
    );
    if (backfillStartIndex === -1) {
      throw new Error('backfill statements not found in the shipped 0012 migration');
    }
    await adminClient.begin(async (tx) => {
      for (const statement of statements.slice(backfillStartIndex)) {
        await tx.unsafe(statement);
      }
    });
  }

  function newOrg(label: string): string {
    const orgId = `org_mig_${label}_${Date.now()}_${randomUUID().slice(0, 8)}`;
    orgIds.push(orgId);
    return orgId;
  }

  async function insertLegacyPerson(
    orgId: string,
    displayName: string,
    flags: { isSeller?: boolean; isFinder?: boolean; isCollaborator?: boolean },
  ): Promise<string> {
    const [row] = await adminClient<{ id: string }[]>`
      INSERT INTO sales_ops_people (org_id, display_name, is_seller, is_finder, is_collaborator)
      VALUES (
        ${orgId},
        ${displayName},
        ${flags.isSeller ?? false},
        ${flags.isFinder ?? false},
        ${flags.isCollaborator ?? false}
      )
      RETURNING id
    `;
    return row.id;
  }

  function funcoesOf(orgId: string) {
    return adminClient<FuncaoRow[]>`
      SELECT id, name, slug, is_system, status
      FROM sales_ops_funcoes WHERE org_id = ${orgId} ORDER BY slug
    `;
  }

  function assignmentsOf(orgId: string, personId: string) {
    return adminClient<AssignmentRow[]>`
      SELECT pf.person_id, f.slug
      FROM sales_ops_person_funcoes pf
      JOIN sales_ops_funcoes f ON f.id = pf.funcao_id
      WHERE pf.org_id = ${orgId} AND pf.person_id = ${personId}
      ORDER BY f.slug
    `;
  }

  beforeAll(() => {
    // Raw fixture writes across orgs exercise migration correctness, not
    // per-request RLS policy behaviour (funcoes-rls.test.ts covers that), so the
    // admin connection is used throughout.
    adminClient = postgres(ADMIN_DB_URL, { max: 1, ...ADMIN_CONNECTION_OPTIONS });
  });

  afterAll(async () => {
    for (const orgId of orgIds) {
      await adminClient`DELETE FROM sales_ops_person_funcoes WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_funcoes WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_sale_professionals WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_sales WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_people WHERE org_id = ${orgId}`;
    }
    await adminClient.end();
  });

  it('seeds vendedor and finder exactly once per org, both flagged is_system', async () => {
    const orgId = newOrg('seed');
    await insertLegacyPerson(orgId, 'Cauet', { isSeller: true });

    await replayBackfill();

    const funcoes = await funcoesOf(orgId);
    const system = funcoes.filter((funcao) => funcao.is_system);
    expect(system.map((funcao) => funcao.slug)).toEqual(['finder', 'vendedor']);
    expect(system.map((funcao) => funcao.name)).toEqual(['Finder', 'Vendedor']);
    expect(system.every((funcao) => funcao.status === 'active')).toBe(true);
    // No collaborator in this org, so no prestador bucket is created.
    expect(funcoes.map((funcao) => funcao.slug)).toEqual(['finder', 'vendedor']);
  });

  it('seeds the two system funções for an org that only has a proposta or a settings row', async () => {
    // sales_ops_settings can legitimately have no row for an org, so the org
    // registry has to be the union of every sales-ops footprint.
    const salesOnlyOrg = newOrg('salesonly');
    await adminClient`
      INSERT INTO sales_ops_sales (
        org_id, sequence, code, client_name_snapshot, seller_name_snapshot,
        payment_method, condition, base_date, total_brl,
        seller_commission_pct, finder_commission_pct, tax_pct, net_margin_pct
      ) VALUES (
        ${salesOnlyOrg}, 1, 'MIG-0012-A', 'Cliente', 'Vendedor',
        'pix', 'cash', '2026-01-01', 100000, '10.00', '0.00', '6.00', '84.00'
      )
    `;

    await replayBackfill();

    expect((await funcoesOf(salesOnlyOrg)).map((funcao) => funcao.slug)).toEqual([
      'finder',
      'vendedor',
    ]);
  });

  it('backfills an is_seller person as one pessoa carrying the vendedor função', async () => {
    const orgId = newOrg('seller');
    const personId = await insertLegacyPerson(orgId, 'Sig', { isSeller: true });

    await replayBackfill();

    const people = await adminClient<
      { count: string }[]
    >`SELECT count(*)::text AS count FROM sales_ops_people WHERE id = ${personId}`;
    expect(people[0].count).toBe('1');
    expect(await assignmentsOf(orgId, personId)).toEqual([
      { person_id: personId, slug: 'vendedor' },
    ]);
  });

  it('backfills an is_finder person as one pessoa carrying the finder função', async () => {
    const orgId = newOrg('finder');
    const personId = await insertLegacyPerson(orgId, 'Halland', { isFinder: true });

    await replayBackfill();

    expect(await assignmentsOf(orgId, personId)).toEqual([{ person_id: personId, slug: 'finder' }]);
  });

  it('backfills a person who is both seller and finder as ONE pessoa with BOTH funções', async () => {
    const orgId = newOrg('both');
    const personId = await insertLegacyPerson(orgId, 'Kayke', {
      isSeller: true,
      isFinder: true,
    });

    await replayBackfill();

    const peopleRows = await adminClient<{ id: string }[]>`
      SELECT id FROM sales_ops_people WHERE org_id = ${orgId}
    `;
    expect(peopleRows.map((row) => row.id)).toEqual([personId]);

    const assignments = await assignmentsOf(orgId, personId);
    expect(assignments).toHaveLength(2);
    expect(assignments.map((row) => row.slug)).toEqual(['finder', 'vendedor']);
  });

  it('maps is_collaborator to a non-system prestador função and skips orgs with no collaborator', async () => {
    const orgWith = newOrg('collabyes');
    const orgWithout = newOrg('collabno');
    const collaboratorId = await insertLegacyPerson(orgWith, 'Joao Boldo', {
      isCollaborator: true,
    });
    await insertLegacyPerson(orgWithout, 'Halland', { isFinder: true });

    await replayBackfill();

    const prestador = (await funcoesOf(orgWith)).find((funcao) => funcao.slug === 'prestador');
    expect(prestador).toBeDefined();
    expect(prestador?.name).toBe('Prestador');
    // Prestador is a compatibility bucket, not a predefined app role, so an org
    // may later rename or archive it.
    expect(prestador?.is_system).toBe(false);
    expect(await assignmentsOf(orgWith, collaboratorId)).toEqual([
      { person_id: collaboratorId, slug: 'prestador' },
    ]);

    expect((await funcoesOf(orgWithout)).map((funcao) => funcao.slug)).toEqual([
      'finder',
      'vendedor',
    ]);
  });

  it('is idempotent when the backfill statements are replayed', async () => {
    const orgId = newOrg('idempotent');
    const personId = await insertLegacyPerson(orgId, 'Cauet', {
      isSeller: true,
      isFinder: true,
      isCollaborator: true,
    });

    await replayBackfill();
    const funcoesFirst = await funcoesOf(orgId);
    const assignmentsFirst = await assignmentsOf(orgId, personId);

    await replayBackfill();
    await replayBackfill();

    expect(await funcoesOf(orgId)).toEqual(funcoesFirst);
    expect(await assignmentsOf(orgId, personId)).toEqual(assignmentsFirst);
    expect(funcoesFirst.map((funcao) => funcao.slug)).toEqual([
      'finder',
      'prestador',
      'vendedor',
    ]);
    expect(assignmentsFirst).toHaveLength(3);
  });

  it('leaves the legacy boolean columns and every sales person FK intact', async () => {
    const orgId = newOrg('fks');
    const sellerId = await insertLegacyPerson(orgId, 'Sig', { isSeller: true });
    const finderId = await insertLegacyPerson(orgId, 'Halland', { isFinder: true });
    const collaboratorId = await insertLegacyPerson(orgId, 'Joao Boldo', {
      isCollaborator: true,
    });

    const [sale] = await adminClient<{ id: string }[]>`
      INSERT INTO sales_ops_sales (
        org_id, sequence, code, client_name_snapshot, seller_name_snapshot,
        seller_person_id, finder_person_id,
        payment_method, condition, base_date, total_brl,
        seller_commission_pct, finder_commission_pct, tax_pct, net_margin_pct
      ) VALUES (
        ${orgId}, 1, 'MIG-0012-B', 'Cliente', 'Sig',
        ${sellerId}, ${finderId},
        'pix', 'cash', '2026-01-01', 100000, '10.00', '3.00', '6.00', '81.00'
      ) RETURNING id
    `;
    const [professional] = await adminClient<{ id: string }[]>`
      INSERT INTO sales_ops_sale_professionals (
        org_id, sale_id, person_id, person_name_snapshot, role, cost_brl
      ) VALUES (
        ${orgId}, ${sale.id}, ${collaboratorId}, 'Joao Boldo', 'Operacional', 5000
      ) RETURNING id
    `;

    await replayBackfill();

    const [readSale] = await adminClient<
      { seller_person_id: string; finder_person_id: string }[]
    >`SELECT seller_person_id, finder_person_id FROM sales_ops_sales WHERE id = ${sale.id}`;
    expect(readSale.seller_person_id).toBe(sellerId);
    expect(readSale.finder_person_id).toBe(finderId);

    const [readProfessional] = await adminClient<
      { person_id: string; role: string }[]
    >`SELECT person_id, role FROM sales_ops_sale_professionals WHERE id = ${professional.id}`;
    expect(readProfessional.person_id).toBe(collaboratorId);
    expect(readProfessional.role).toBe('Operacional');

    const people = await adminClient<
      { id: string; is_seller: boolean; is_finder: boolean; is_collaborator: boolean }[]
    >`
      SELECT id, is_seller, is_finder, is_collaborator
      FROM sales_ops_people WHERE org_id = ${orgId} ORDER BY display_name
    `;
    expect(people).toEqual([
      { id: finderId, is_seller: false, is_finder: true, is_collaborator: false },
      { id: collaboratorId, is_seller: false, is_finder: false, is_collaborator: true },
      { id: sellerId, is_seller: true, is_finder: false, is_collaborator: false },
    ]);
  });
});
