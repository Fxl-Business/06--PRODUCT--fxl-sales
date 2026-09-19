import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { ensureLeadStagesForOrg } from '../../src/domains/sales-ops/leads/stages-seed.js';

/**
 * Slice 01 ships exactly ONE service function for the leads domain,
 * `ensureLeadStagesForOrg`. Everything else about `sales_ops_leads` and
 * `sales_ops_lead_products` is exercised here through raw SQL, because those two
 * tables have no service layer yet (slices 02 and 03 add it). The raw SQL is
 * deliberate, not laziness: the constraints and the policies are the deliverable
 * of this slice, and they are what these probes drive.
 *
 * Nothing in this file writes to `audit_log`, so it deliberately carries NONE of
 * the ledger-tail cleanup that `funcoes-rls.test.ts` needs. Do not copy that
 * block in here by reflex.
 */

const APP_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5006/fxl_sales';
const ADMIN_DB_URL = process.env.ADMIN_DATABASE_URL ?? APP_DB_URL;
const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;

/**
 * Builds a connection string for a different role against the same host/port/db as
 * APP_DB_URL, so the raw-RLS test below can exercise policies through a real
 * non-superuser role instead of a role that bypasses row security.
 */
function withRole(url: string, username: string, password: string): string {
  const parsed = new URL(url);
  parsed.username = username;
  parsed.password = password;
  return parsed.toString();
}

describe('sales operations leads persistence and RLS', () => {
  let appClient: postgres.Sql;
  let adminClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  /**
   * The same service function driven over a connection that carries
   * `app.fxl_admin`, which satisfies the `*_admin_context` policy and therefore
   * makes every org's rows visible at the database level. On this connection the
   * ONLY thing scoping a read is the service layer's explicit
   * `eq(table.orgId, orgId)` filter, so it isolates that filter from RLS instead
   * of letting one hide a missing other.
   */
  let adminDb: ReturnType<typeof drizzle<typeof schema>>;
  let adminDbClient: postgres.Sql;
  const orgIds: string[] = [];

  function newOrgPair(label: string): [string, string] {
    const suffix = `${Date.now()}_${randomUUID().slice(0, 8)}`;
    const orgA = `org_lead_${label}_a_${suffix}`;
    const orgB = `org_lead_${label}_b_${suffix}`;
    orgIds.push(orgA, orgB);
    return [orgA, orgB];
  }

  function stageCount(orgId: string) {
    return adminClient<{ count: string }[]>`
      SELECT count(*)::text AS count FROM sales_ops_lead_stages WHERE org_id = ${orgId}
    `;
  }

  async function insertPerson(orgId: string, displayName: string): Promise<string> {
    const [row] = await adminClient<{ id: string }[]>`
      INSERT INTO sales_ops_people (org_id, display_name)
      VALUES (${orgId}, ${displayName}) RETURNING id
    `;
    return row.id;
  }

  async function insertClient(orgId: string, name: string): Promise<string> {
    const [row] = await adminClient<{ id: string }[]>`
      INSERT INTO sales_ops_clients (org_id, name) VALUES (${orgId}, ${name}) RETURNING id
    `;
    return row.id;
  }

  async function insertProduct(orgId: string, name: string): Promise<string> {
    const [row] = await adminClient<{ id: string }[]>`
      INSERT INTO sales_ops_products (
        org_id, name, seller_commission_value, finder_commission_value,
        seller_with_finder_commission_value
      ) VALUES (${orgId}, ${name}, '10.00', '0.00', '0.00') RETURNING id
    `;
    return row.id;
  }

  async function insertSale(orgId: string, sequence: number): Promise<string> {
    const [row] = await adminClient<{ id: string }[]>`
      INSERT INTO sales_ops_sales (
        org_id, sequence, code, client_name_snapshot, seller_name_snapshot,
        payment_method, condition, base_date, total_brl,
        seller_commission_pct, finder_commission_pct, tax_pct, net_margin_pct
      ) VALUES (
        ${orgId}, ${sequence}, ${`LEAD-RLS-${randomUUID().slice(0, 8)}`}, 'Cliente', 'Vendedor',
        'pix', 'cash', '2026-01-01', 100000, '10.00', '0.00', '6.00', '84.00'
      ) RETURNING id
    `;
    return row.id;
  }

  async function insertStage(orgId: string, name: string): Promise<string> {
    const [row] = await adminClient<{ id: string }[]>`
      INSERT INTO sales_ops_lead_stages (org_id, name, kind, is_system, "position")
      VALUES (${orgId}, ${name}, 'normal', false, 1) RETURNING id
    `;
    return row.id;
  }

  beforeAll(() => {
    appClient = postgres(APP_DB_URL, { max: 4 });
    adminClient = postgres(ADMIN_DB_URL, { max: 1, ...ADMIN_CONNECTION_OPTIONS });
    db = drizzle(appClient, { schema });
    adminDbClient = postgres(ADMIN_DB_URL, { max: 2, ...ADMIN_CONNECTION_OPTIONS });
    adminDb = drizzle(adminDbClient, { schema });
  });

  afterAll(async () => {
    for (const orgId of orgIds) {
      // Children first, or the restrict FKs reject the delete.
      await adminClient`DELETE FROM sales_ops_lead_products WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_leads WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_lead_stages WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_sales WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_products WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_clients WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_people WHERE org_id = ${orgId}`;
    }
    await appClient.end();
    await adminDbClient.end();
    await adminClient.end();
  });

  it('ensureLeadStagesForOrg seeds a brand-new org exactly once and is safe to call again', async () => {
    const [orgA] = newOrgPair('seed');

    const first = await ensureLeadStagesForOrg(db, orgA);
    expect(first.map((stage) => stage.name)).toEqual([
      'Novo',
      'Em negociação',
      'Proposta',
      'Perdido',
    ]);
    expect(first.map((stage) => stage.kind)).toEqual(['normal', 'normal', 'conversion', 'lost']);
    expect(first.map((stage) => stage.isSystem)).toEqual([false, false, true, true]);

    const second = await ensureLeadStagesForOrg(db, orgA);
    expect(second.map((stage) => stage.id)).toEqual(first.map((stage) => stage.id));
    expect((await stageCount(orgA))[0].count).toBe('4');
  });

  it('ensureLeadStagesForOrg never re-inserts a stage the org has renamed or archived', async () => {
    const [orgA] = newOrgPair('rename');

    const seeded = await ensureLeadStagesForOrg(db, orgA);
    const novo = seeded.find((stage) => stage.name === 'Novo');
    expect(novo).toBeDefined();

    await adminClient`
      UPDATE sales_ops_lead_stages
      SET name = 'Prospecção', status = 'archived', archived_at = now()
      WHERE id = ${novo!.id}
    `;

    const again = await ensureLeadStagesForOrg(db, orgA);
    expect(again).toHaveLength(4);
    expect(again.some((stage) => stage.name === 'Novo')).toBe(false);
    expect(again.some((stage) => stage.name === 'Prospecção')).toBe(true);
    expect((await stageCount(orgA))[0].count).toBe('4');
  });

  it('two concurrent first calls for the same org still leave exactly four stages', async () => {
    const [orgA] = newOrgPair('race');

    const [left, right] = await Promise.all([
      ensureLeadStagesForOrg(db, orgA),
      ensureLeadStagesForOrg(db, orgA),
    ]);

    expect(left).toHaveLength(4);
    expect(right).toHaveLength(4);
    expect(new Set(left.map((stage) => stage.id))).toEqual(
      new Set(right.map((stage) => stage.id)),
    );
    expect((await stageCount(orgA))[0].count).toBe('4');
  });

  it('scopes the stage read by orgId even when RLS is not doing the scoping', async () => {
    const [orgA, orgB] = newOrgPair('adminscope');

    const stagesA = await ensureLeadStagesForOrg(adminDb, orgA);
    const stagesB = await ensureLeadStagesForOrg(adminDb, orgB);

    expect(stagesA).toHaveLength(4);
    expect(stagesB).toHaveLength(4);
    expect(stagesA.every((stage) => stage.orgId === orgA)).toBe(true);
    expect(stagesB.every((stage) => stage.orgId === orgB)).toBe(true);
  });

  it('raw RLS blocks cross-org reads of lead stages, leads and lead products and WITH CHECK blocks smuggled inserts', async () => {
    // The migrate/admin connection is a cluster superuser and therefore always
    // bypasses row security, FORCE ROW LEVEL SECURITY included. To prove the
    // policies themselves are correct (not just the service layer's explicit
    // orgId filters), provision a scoped, non-superuser role for this test.
    const roleName = `rls_probe_${randomUUID().replace(/-/g, '_')}`;
    const rolePassword = randomUUID();

    await adminClient.unsafe(
      `CREATE ROLE ${roleName} LOGIN PASSWORD '${rolePassword}' NOSUPERUSER NOBYPASSRLS`,
    );
    await adminClient.unsafe(`GRANT USAGE ON SCHEMA public TO ${roleName}`);
    await adminClient.unsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON sales_ops_lead_stages, sales_ops_leads, sales_ops_lead_products TO ${roleName}`,
    );

    const roleClient = postgres(withRole(APP_DB_URL, roleName, rolePassword), { max: 1 });

    try {
      const [ORG_A, ORG_B] = newOrgPair('rawrls');

      const { stageId, leadId, leadProductId } = await roleClient.begin(async (tx) => {
        await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
        const [stage] = await tx`
          INSERT INTO sales_ops_lead_stages (org_id, name, kind, is_system, "position")
          VALUES (${ORG_A}, 'RLS Probe Etapa', 'normal', false, 1) RETURNING id
        `;
        const [lead] = await tx`
          INSERT INTO sales_ops_leads (
            org_id, contact_name, client_name_snapshot, stage_id
          ) VALUES (${ORG_A}, 'RLS Probe Lead', 'Empresa', ${(stage as { id: string }).id})
          RETURNING id
        `;
        const [leadProduct] = await tx`
          INSERT INTO sales_ops_lead_products (org_id, lead_id, product_name_snapshot)
          VALUES (${ORG_A}, ${(lead as { id: string }).id}, 'Produto livre') RETURNING id
        `;
        return {
          stageId: (stage as { id: string }).id,
          leadId: (lead as { id: string }).id,
          leadProductId: (leadProduct as { id: string }).id,
        };
      });

      // Positive control: visible under its own org context.
      const own = await roleClient.begin(async (tx) => {
        await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
        return [
          await tx`SELECT id FROM sales_ops_lead_stages WHERE id = ${stageId}`,
          await tx`SELECT id FROM sales_ops_leads WHERE id = ${leadId}`,
          await tx`SELECT id FROM sales_ops_lead_products WHERE id = ${leadProductId}`,
        ];
      });
      expect(own[0]).toHaveLength(1);
      expect(own[1]).toHaveLength(1);
      expect(own[2]).toHaveLength(1);

      // Negative: invisible under another org context.
      const other = await roleClient.begin(async (tx) => {
        await tx`SELECT set_config('app.current_org_id', ${ORG_B}, true)`;
        return [
          await tx`SELECT id FROM sales_ops_lead_stages WHERE id = ${stageId}`,
          await tx`SELECT id FROM sales_ops_leads WHERE id = ${leadId}`,
          await tx`SELECT id FROM sales_ops_lead_products WHERE id = ${leadProductId}`,
        ];
      });
      expect(other[0]).toHaveLength(0);
      expect(other[1]).toHaveLength(0);
      expect(other[2]).toHaveLength(0);

      // WITH CHECK refuses writing a foreign org_id from inside org A's context.
      await expect(
        roleClient.begin(async (tx) => {
          await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
          return tx`
            INSERT INTO sales_ops_lead_stages (org_id, name, kind, is_system, "position")
            VALUES (${ORG_B}, 'Etapa contrabandeada', 'normal', false, 1) RETURNING id
          `;
        }),
      ).rejects.toThrow();

      await expect(
        roleClient.begin(async (tx) => {
          await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
          return tx`
            INSERT INTO sales_ops_leads (org_id, contact_name, client_name_snapshot, stage_id)
            VALUES (${ORG_B}, 'Lead contrabandeado', 'Empresa', ${stageId}) RETURNING id
          `;
        }),
      ).rejects.toThrow();

      // With no org context set at all, nothing is readable.
      const noContext = await roleClient.begin(async (tx) => {
        await tx`SELECT set_config('app.current_org_id', '', true)`;
        return tx`SELECT id FROM sales_ops_leads WHERE id = ${leadId}`;
      });
      expect(noContext).toHaveLength(0);
    } finally {
      await roleClient.end();
      await adminClient.unsafe(`DROP OWNED BY ${roleName}`);
      await adminClient.unsafe(`DROP ROLE ${roleName}`);
    }
  });

  it('the composite foreign keys refuse a cross-org stage, cliente, vendedor, produto and venda even in the admin context', async () => {
    const [orgA, orgB] = newOrgPair('crossfk');

    const stageA = await insertStage(orgA, 'Novo');
    const stageB = await insertStage(orgB, 'Novo');
    const clientB = await insertClient(orgB, 'Empresa B');
    const personB = await insertPerson(orgB, 'Vendedora B');
    const saleB = await insertSale(orgB, 1);
    const productB = await insertProduct(orgB, 'Produto B');

    const insertLeadIn = (
      orgId: string,
      stageId: string,
      extra: { clientId?: string; sellerPersonId?: string; saleId?: string } = {},
    ) => adminClient<{ id: string }[]>`
      INSERT INTO sales_ops_leads (
        org_id, contact_name, client_id, client_name_snapshot,
        seller_person_id, stage_id, sale_id
      ) VALUES (
        ${orgId}, 'Contato', ${extra.clientId ?? null}, 'Empresa',
        ${extra.sellerPersonId ?? null}, ${stageId}, ${extra.saleId ?? null}
      ) RETURNING id
    `;

    await expect(insertLeadIn(orgA, stageB)).rejects.toThrow(/sales_ops_leads_org_stage_fk/);
    await expect(insertLeadIn(orgA, stageA, { clientId: clientB })).rejects.toThrow(
      /sales_ops_leads_org_client_fk/,
    );
    await expect(insertLeadIn(orgA, stageA, { sellerPersonId: personB })).rejects.toThrow(
      /sales_ops_leads_org_seller_fk/,
    );
    await expect(insertLeadIn(orgA, stageA, { saleId: saleB })).rejects.toThrow(
      /sales_ops_leads_org_sale_fk/,
    );

    // Positive control: the same shape, all in org A, lands.
    const [leadA] = await insertLeadIn(orgA, stageA);
    expect(leadA.id).toEqual(expect.any(String));

    await expect(adminClient`
      INSERT INTO sales_ops_lead_products (org_id, lead_id, product_id, product_name_snapshot)
      VALUES (${orgA}, ${leadA.id}, ${productB}, 'Produto B')
    `).rejects.toThrow(/sales_ops_lead_products_org_product_fk/);

    const leadB = (await insertLeadIn(orgB, stageB))[0];
    await expect(adminClient`
      INSERT INTO sales_ops_lead_products (org_id, lead_id, product_name_snapshot)
      VALUES (${orgA}, ${leadB.id}, 'Produto livre')
    `).rejects.toThrow(/sales_ops_lead_products_org_lead_fk/);

    // Positive control: a same-org produto row lands.
    const productA = await insertProduct(orgA, 'Produto A');
    await expect(adminClient`
      INSERT INTO sales_ops_lead_products (org_id, lead_id, product_id, product_name_snapshot)
      VALUES (${orgA}, ${leadA.id}, ${productA}, 'Produto A')
    `).resolves.toBeDefined();
  });
});
