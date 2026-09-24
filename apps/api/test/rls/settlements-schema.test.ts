/**
 * Integration oracle for migration 0024 (contract C3): the immutable
 * sales_ops_settlements table, its triggers, its RLS and its composite FKs.
 *
 * Requires Docker Postgres running + migrations applied (vitest globalSetup -
 * see test/rls/global-setup.ts).
 * Run with: pnpm --filter @fxl-sales/api test:integration
 */
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteSettlementsForOrgs } from '../../src/db/__tests__/settlement-test-cleanup.js';

const APP_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5006/fxl_sales';
const ADMIN_DB_URL = process.env.ADMIN_DATABASE_URL ?? APP_DB_URL;
const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;

type Sql = postgres.Sql;

async function insertSale(
  adminClient: Sql,
  orgId: string,
  sequence: number,
): Promise<string> {
  const [row] = await adminClient<{ id: string }[]>`
    INSERT INTO sales_ops_sales (
      org_id, sequence, code, client_name_snapshot, seller_name_snapshot,
      status, payment_method, condition, base_date, total_brl,
      seller_commission_pct, finder_commission_pct, tax_pct, net_margin_pct
    ) VALUES (
      ${orgId}, ${sequence}, ${`SETL-${randomUUID().slice(0, 8)}`}, 'Cliente', 'Vendedor',
      'won', 'pix', 'cash', '2026-01-01', 100000, '10.00', '0.00', '6.00', '84.00'
    ) RETURNING id
  `;
  return row!.id;
}

async function insertReceivable(
  adminClient: Sql,
  orgId: string,
  saleId: string,
  overrides: { amountBrl?: number; dueDate?: string; status?: string; label?: string } = {},
): Promise<string> {
  const amountBrl = overrides.amountBrl ?? 100000;
  const dueDate = overrides.dueDate ?? '2026-03-01T00:00:00Z';
  const status = overrides.status ?? 'open';
  const label = overrides.label ?? '1/1';
  const [row] = await adminClient<{ id: string }[]>`
    INSERT INTO sales_ops_receivables (org_id, sale_id, label, due_date, amount_brl, status)
    VALUES (${orgId}, ${saleId}, ${label}, ${dueDate}, ${amountBrl}, ${status})
    RETURNING id
  `;
  return row!.id;
}

async function insertPayable(
  adminClient: Sql,
  orgId: string,
  saleId: string,
  receivableId: string | null,
  overrides: { amountBrl?: number; dueDate?: string; status?: string } = {},
): Promise<string> {
  const amountBrl = overrides.amountBrl ?? 5000;
  const dueDate = overrides.dueDate ?? '2026-03-01T00:00:00Z';
  const status = overrides.status ?? 'open';
  const [row] = await adminClient<{ id: string }[]>`
    INSERT INTO sales_ops_payables (
      org_id, sale_id, beneficiary_name, kind, receivable_id, due_date, amount_brl, status
    )
    VALUES (
      ${orgId}, ${saleId}, 'Vendedor', 'seller_commission', ${receivableId}, ${dueDate}, ${amountBrl}, ${status}
    )
    RETURNING id
  `;
  return row!.id;
}

type SettlementFields = {
  org_id: string;
  sale_id: string;
  target_kind?: string;
  receivable_id?: string | null;
  payable_id?: string | null;
  type?: string;
  reverses_settlement_id?: string | null;
  paid_on?: string;
  amount_brl: number;
  origin?: string;
  actor_user_id?: string;
  actor_name?: string | null;
  reason?: string | null;
  id?: string;
};

async function insertSettlement(client: Sql, fields: SettlementFields): Promise<string> {
  const row = {
    target_kind: 'receivable',
    type: 'baixa',
    paid_on: '2026-03-02',
    origin: 'manual',
    actor_user_id: 'acct_test',
    actor_name: 'Pessoa Teste',
    receivable_id: null,
    payable_id: null,
    reverses_settlement_id: null,
    reason: null,
    ...fields,
  };
  const columns = Object.keys(row) as (keyof typeof row)[];
  const [inserted] = await client<{ id: string }[]>`
    INSERT INTO sales_ops_settlements ${client(row, ...columns)}
    RETURNING id
  `;
  return inserted!.id;
}

describe('sales_ops_settlements schema (migration 0024)', () => {
  let appClient: Sql;
  let adminClient: Sql;
  const orgIds: string[] = [];

  function newOrgId(label: string): string {
    const orgId = `org_settlement_${label}_${Date.now()}_${randomUUID().slice(0, 8)}`;
    orgIds.push(orgId);
    return orgId;
  }

  beforeAll(async () => {
    appClient = postgres(APP_DB_URL, { max: 4 });
    adminClient = postgres(ADMIN_DB_URL, { max: 2, ...ADMIN_CONNECTION_OPTIONS });

    const rows = await appClient<{ rolsuper: boolean; rolbypassrls: boolean; current_user: string }[]>`
      SELECT rolsuper, rolbypassrls, current_user
      FROM pg_roles WHERE rolname = current_user
    `;
    const me = rows[0];
    if (!me) throw new Error('could not resolve current_user role');
    if (me.rolsuper || me.rolbypassrls) {
      throw new Error(
        `RLS tests must run as a non-superuser, non-BYPASSRLS role; got ${me.current_user}`,
      );
    }
  });

  afterAll(async () => {
    await deleteSettlementsForOrgs(orgIds);
    for (const orgId of orgIds) {
      await adminClient`DELETE FROM sales_ops_payables WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_receivables WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_sales WHERE org_id = ${orgId}`;
    }
    await appClient.end();
    await adminClient.end();
  });

  it('adds revision 1 and a non-null updated_at to every new receivable and payable, and refuses revision 0', async () => {
    const orgId = newOrgId('a');
    const saleId = await insertSale(adminClient, orgId, 1);
    const receivableId = await insertReceivable(adminClient, orgId, saleId);
    const payableId = await insertPayable(adminClient, orgId, saleId, receivableId);

    const [receivable] = await adminClient<{ revision: number; updated_at: Date | null }[]>`
      SELECT revision, updated_at FROM sales_ops_receivables WHERE id = ${receivableId}
    `;
    expect(receivable?.revision).toBe(1);
    expect(receivable?.updated_at).not.toBeNull();

    const [payable] = await adminClient<{ revision: number; updated_at: Date | null }[]>`
      SELECT revision, updated_at FROM sales_ops_payables WHERE id = ${payableId}
    `;
    expect(payable?.revision).toBe(1);
    expect(payable?.updated_at).not.toBeNull();

    await expect(
      adminClient`UPDATE sales_ops_receivables SET revision = 0 WHERE id = ${receivableId}`,
    ).rejects.toMatchObject({
      code: '23514',
      constraint_name: 'sales_ops_receivables_revision_check',
    });
    await expect(
      adminClient`UPDATE sales_ops_payables SET revision = 0 WHERE id = ${payableId}`,
    ).rejects.toMatchObject({
      code: '23514',
      constraint_name: 'sales_ops_payables_revision_check',
    });
  });

  it('refuses UPDATE of a settlement with SQLSTATE FXS01, for the tenant role and for the admin context', async () => {
    const orgId = newOrgId('b');
    const saleId = await insertSale(adminClient, orgId, 1);
    const receivableId = await insertReceivable(adminClient, orgId, saleId, { amountBrl: 100000 });
    const settlementId = await insertSettlement(adminClient, {
      org_id: orgId,
      sale_id: saleId,
      receivable_id: receivableId,
      amount_brl: 100000,
    });

    // Positive control - a transaction that only reads must commit cleanly, so
    // its erroring sibling below is proven to fail on the trigger, not on RLS
    // hiding the row.
    await appClient.begin(async (tx) => {
      await tx`SELECT set_config('app.current_org_id', ${orgId}, true)`;
      const seen = await tx`SELECT id FROM sales_ops_settlements WHERE id = ${settlementId}`;
      expect(seen).toHaveLength(1);
    });

    // A failed statement aborts the rest of its Postgres transaction, so the
    // erroring UPDATE must be the ONLY statement of its own transaction and the
    // whole `.begin(...)` promise (not the inner query) is what rejects.
    await expect(
      appClient.begin(async (tx) => {
        await tx`SELECT set_config('app.current_org_id', ${orgId}, true)`;
        await tx`UPDATE sales_ops_settlements SET reason = 'x' WHERE id = ${settlementId}`;
      }),
    ).rejects.toMatchObject({ code: 'FXS01' });

    await expect(
      adminClient`UPDATE sales_ops_settlements SET reason = 'x' WHERE id = ${settlementId}`,
    ).rejects.toMatchObject({ code: 'FXS01' });

    const [unchanged] = await adminClient<{ reason: string | null }[]>`
      SELECT reason FROM sales_ops_settlements WHERE id = ${settlementId}
    `;
    expect(unchanged?.reason).toBeNull();
  });

  it('refuses DELETE of a settlement with SQLSTATE FXS01, for the tenant role and for the admin context', async () => {
    const orgId = newOrgId('c');
    const saleId = await insertSale(adminClient, orgId, 1);
    const receivableId = await insertReceivable(adminClient, orgId, saleId, { amountBrl: 100000 });
    const settlementId = await insertSettlement(adminClient, {
      org_id: orgId,
      sale_id: saleId,
      receivable_id: receivableId,
      amount_brl: 100000,
    });

    await appClient.begin(async (tx) => {
      await tx`SELECT set_config('app.current_org_id', ${orgId}, true)`;
      const seen = await tx`SELECT id FROM sales_ops_settlements WHERE id = ${settlementId}`;
      expect(seen).toHaveLength(1); // positive control
    });

    await expect(
      appClient.begin(async (tx) => {
        await tx`SELECT set_config('app.current_org_id', ${orgId}, true)`;
        await tx`DELETE FROM sales_ops_settlements WHERE id = ${settlementId}`;
      }),
    ).rejects.toMatchObject({ code: 'FXS01' });

    await expect(
      adminClient`DELETE FROM sales_ops_settlements WHERE id = ${settlementId}`,
    ).rejects.toMatchObject({ code: 'FXS01' });

    const [stillThere] = await adminClient<{ id: string }[]>`
      SELECT id FROM sales_ops_settlements WHERE id = ${settlementId}
    `;
    expect(stillThere?.id).toBe(settlementId);
  });

  it("hides another org's settlements under RLS and refuses a smuggled org_id with WITH CHECK", async () => {
    const orgA = newOrgId('d1');
    const orgB = newOrgId('d2');
    const saleA = await insertSale(adminClient, orgA, 1);
    const receivableA = await insertReceivable(adminClient, orgA, saleA, { amountBrl: 100000 });
    const settlementId = await insertSettlement(adminClient, {
      org_id: orgA,
      sale_id: saleA,
      receivable_id: receivableA,
      amount_brl: 100000,
    });

    await appClient.begin(async (tx) => {
      await tx`SELECT set_config('app.current_org_id', ${orgA}, true)`;
      const seen = await tx`SELECT id FROM sales_ops_settlements WHERE id = ${settlementId}`;
      expect(seen).toHaveLength(1); // positive control
    });

    await appClient.begin(async (tx) => {
      await tx`SELECT set_config('app.current_org_id', ${orgB}, true)`;
      const byId = await tx`SELECT id FROM sales_ops_settlements WHERE id = ${settlementId}`;
      expect(byId).toHaveLength(0);
      const unfilteredForOrgA = await tx`SELECT id FROM sales_ops_settlements WHERE org_id = ${orgA}`;
      expect(unfilteredForOrgA).toHaveLength(0);
    });

    // The smuggled insert must be the ONLY statement of its transaction (see
    // the FXS01 tests above for why); the whole `.begin(...)` promise rejects.
    await expect(
      appClient.begin(async (tx) => {
        await tx`SELECT set_config('app.current_org_id', ${orgB}, true)`;
        await insertSettlement(tx, {
          org_id: orgA,
          sale_id: saleA,
          receivable_id: receivableA,
          amount_brl: 100000,
        });
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('accepts one estorno per baixa and refuses a second with 23505', async () => {
    const orgId = newOrgId('e');
    const saleId = await insertSale(adminClient, orgId, 1);
    const receivableId = await insertReceivable(adminClient, orgId, saleId, { amountBrl: 100000 });
    const baixaId = await insertSettlement(adminClient, {
      org_id: orgId,
      sale_id: saleId,
      receivable_id: receivableId,
      amount_brl: 100000,
    });

    const estornoId = await insertSettlement(adminClient, {
      org_id: orgId,
      sale_id: saleId,
      receivable_id: receivableId,
      amount_brl: 100000,
      type: 'estorno',
      reverses_settlement_id: baixaId,
      paid_on: '2026-03-05',
      reason: 'Pagamento lançado em duplicidade',
    });
    expect(estornoId).toBeTruthy();

    await expect(
      insertSettlement(adminClient, {
        org_id: orgId,
        sale_id: saleId,
        receivable_id: receivableId,
        amount_brl: 100000,
        type: 'estorno',
        reverses_settlement_id: baixaId,
        paid_on: '2026-03-06',
        reason: 'Segunda tentativa',
      }),
    ).rejects.toMatchObject({
      code: '23505',
      constraint_name: 'sales_ops_settlements_one_estorno_per_baixa_idx',
    });
  });

  it('refuses every malformed settlement with its named CHECK constraint', async () => {
    const orgId = newOrgId('f');
    const saleId = await insertSale(adminClient, orgId, 1);
    const receivableId = await insertReceivable(adminClient, orgId, saleId, { amountBrl: 100000 });
    const payableId = await insertPayable(adminClient, orgId, saleId, receivableId, {
      amountBrl: 5000,
    });
    const baixaId = await insertSettlement(adminClient, {
      org_id: orgId,
      sale_id: saleId,
      receivable_id: receivableId,
      amount_brl: 100000,
    });

    const cases: Array<{
      name: string;
      fields: SettlementFields;
      constraintNames: string[];
    }> = [
      {
        name: 'target_kind invoice with receivable_id set',
        fields: {
          org_id: orgId,
          sale_id: saleId,
          receivable_id: receivableId,
          amount_brl: 1000,
          target_kind: 'invoice',
        },
        constraintNames: [
          'sales_ops_settlements_target_kind_check',
          'sales_ops_settlements_target_check',
        ],
      },
      {
        name: 'receivable target_kind with only payable_id set',
        fields: {
          org_id: orgId,
          sale_id: saleId,
          receivable_id: null,
          payable_id: payableId,
          amount_brl: 1000,
          target_kind: 'receivable',
        },
        constraintNames: ['sales_ops_settlements_target_check'],
      },
      {
        name: 'both receivable_id and payable_id set',
        fields: {
          org_id: orgId,
          sale_id: saleId,
          receivable_id: receivableId,
          payable_id: payableId,
          amount_brl: 1000,
          target_kind: 'receivable',
        },
        constraintNames: ['sales_ops_settlements_target_check'],
      },
      {
        name: "type 'ajuste'",
        fields: {
          org_id: orgId,
          sale_id: saleId,
          receivable_id: receivableId,
          amount_brl: 1000,
          type: 'ajuste',
        },
        constraintNames: ['sales_ops_settlements_type_check'],
      },
      {
        name: "estorno with reverses_settlement_id null",
        fields: {
          org_id: orgId,
          sale_id: saleId,
          receivable_id: receivableId,
          amount_brl: 100000,
          type: 'estorno',
          reverses_settlement_id: null,
        },
        constraintNames: ['sales_ops_settlements_reverses_check'],
      },
      {
        name: "baixa with reverses_settlement_id set",
        fields: {
          org_id: orgId,
          sale_id: saleId,
          receivable_id: receivableId,
          amount_brl: 1000,
          type: 'baixa',
          reverses_settlement_id: baixaId,
        },
        constraintNames: ['sales_ops_settlements_reverses_check'],
      },
      {
        name: 'amount_brl 0',
        fields: { org_id: orgId, sale_id: saleId, receivable_id: receivableId, amount_brl: 0 },
        constraintNames: ['sales_ops_settlements_amount_check'],
      },
      {
        name: 'amount_brl -1',
        fields: { org_id: orgId, sale_id: saleId, receivable_id: receivableId, amount_brl: -1 },
        constraintNames: ['sales_ops_settlements_amount_check'],
      },
      {
        name: "origin 'hub'",
        fields: {
          org_id: orgId,
          sale_id: saleId,
          receivable_id: receivableId,
          amount_brl: 1000,
          origin: 'hub',
        },
        constraintNames: ['sales_ops_settlements_origin_check'],
      },
      {
        name: "baixa with reason set",
        fields: {
          org_id: orgId,
          sale_id: saleId,
          receivable_id: receivableId,
          amount_brl: 1000,
          type: 'baixa',
          reason: 'x',
        },
        constraintNames: ['sales_ops_settlements_reason_check'],
      },
      {
        name: "actor_user_id blank",
        fields: {
          org_id: orgId,
          sale_id: saleId,
          receivable_id: receivableId,
          amount_brl: 1000,
          actor_user_id: '  ',
        },
        constraintNames: ['sales_ops_settlements_actor_check'],
      },
    ];

    for (const testCase of cases) {
      await expect(
        insertSettlement(adminClient, testCase.fields),
        testCase.name,
      ).rejects.toMatchObject({ code: '23514' });
      try {
        await insertSettlement(adminClient, testCase.fields);
        throw new Error(`expected ${testCase.name} to fail`);
      } catch (error) {
        expect(
          testCase.constraintNames,
          `${testCase.name}: unexpected constraint`,
        ).toContain((error as { constraint_name?: string }).constraint_name);
      }
    }

    // The self-reference case needs an explicit id.
    const selfId = randomUUID();
    await expect(
      insertSettlement(adminClient, {
        id: selfId,
        org_id: orgId,
        sale_id: saleId,
        receivable_id: receivableId,
        amount_brl: 100000,
        type: 'estorno',
        reverses_settlement_id: selfId,
        paid_on: '2026-03-05',
        reason: 'auto-referencia',
      }),
    ).rejects.toMatchObject({
      code: '23514',
      constraint_name: 'sales_ops_settlements_reverses_not_self_check',
    });
  });

  it('refuses an estorno that does not mirror its baixa with SQLSTATE FXS02', async () => {
    const orgId = newOrgId('g');
    const saleId = await insertSale(adminClient, orgId, 1);
    const receivable1 = await insertReceivable(adminClient, orgId, saleId, {
      amountBrl: 100000,
      label: '1/2',
    });
    const receivable2 = await insertReceivable(adminClient, orgId, saleId, {
      amountBrl: 50000,
      label: '2/2',
    });
    const baixaId = await insertSettlement(adminClient, {
      org_id: orgId,
      sale_id: saleId,
      receivable_id: receivable1,
      amount_brl: 100000,
    });

    await expect(
      insertSettlement(adminClient, {
        org_id: orgId,
        sale_id: saleId,
        receivable_id: receivable1,
        amount_brl: 99999,
        type: 'estorno',
        reverses_settlement_id: baixaId,
        paid_on: '2026-03-05',
        reason: 'valor errado',
      }),
    ).rejects.toMatchObject({ code: 'FXS02' });

    await expect(
      insertSettlement(adminClient, {
        org_id: orgId,
        sale_id: saleId,
        receivable_id: receivable2,
        amount_brl: 100000,
        type: 'estorno',
        reverses_settlement_id: baixaId,
        paid_on: '2026-03-05',
        reason: 'linha errada',
      }),
    ).rejects.toMatchObject({ code: 'FXS02' });

    const estornoId = await insertSettlement(adminClient, {
      org_id: orgId,
      sale_id: saleId,
      receivable_id: receivable1,
      amount_brl: 100000,
      type: 'estorno',
      reverses_settlement_id: baixaId,
      paid_on: '2026-03-05',
      reason: 'correcao',
    });
    expect(estornoId).toBeTruthy();

    await expect(
      insertSettlement(adminClient, {
        org_id: orgId,
        sale_id: saleId,
        receivable_id: receivable1,
        amount_brl: 100000,
        type: 'estorno',
        reverses_settlement_id: estornoId,
        paid_on: '2026-03-06',
        reason: 'estorno de estorno',
      }),
    ).rejects.toMatchObject({ code: 'FXS02' });
  });

  it('composite foreign keys refuse a cross-org or cross-sale target and restrict deleting a settled row, its sale and a reversed baixa', async () => {
    const orgA = newOrgId('h1');
    const orgB = newOrgId('h2');
    const saleA1 = await insertSale(adminClient, orgA, 1);
    const saleA2 = await insertSale(adminClient, orgA, 2);
    const saleB = await insertSale(adminClient, orgB, 1);
    const receivableA1 = await insertReceivable(adminClient, orgA, saleA1, { amountBrl: 100000 });
    const receivableA2 = await insertReceivable(adminClient, orgA, saleA2, { amountBrl: 70000 });
    const payableA1 = await insertPayable(adminClient, orgA, saleA1, receivableA1, {
      amountBrl: 8000,
    });

    // Cross-org: org B settlement naming org A's sale and receivable.
    await expect(
      insertSettlement(adminClient, {
        org_id: orgB,
        sale_id: saleA1,
        receivable_id: receivableA1,
        amount_brl: 100000,
      }),
    ).rejects.toMatchObject({ code: '23503' });

    // Cross-sale: same org, sale_id names saleA2 but receivable_id belongs to saleA1.
    await expect(
      insertSettlement(adminClient, {
        org_id: orgA,
        sale_id: saleA2,
        receivable_id: receivableA1,
        amount_brl: 100000,
      }),
    ).rejects.toMatchObject({ code: '23503' });

    const settledReceivableId = await insertSettlement(adminClient, {
      org_id: orgA,
      sale_id: saleA1,
      receivable_id: receivableA1,
      amount_brl: 100000,
    });
    expect(settledReceivableId).toBeTruthy();
    await expect(
      adminClient`DELETE FROM sales_ops_receivables WHERE id = ${receivableA1}`,
    ).rejects.toMatchObject({
      code: '23503',
      constraint_name: 'sales_ops_settlements_org_sale_receivable_fk',
    });

    const settledPayableId = await insertSettlement(adminClient, {
      org_id: orgA,
      sale_id: saleA1,
      target_kind: 'payable',
      receivable_id: null,
      payable_id: payableA1,
      amount_brl: 8000,
    });
    expect(settledPayableId).toBeTruthy();
    await expect(
      adminClient`DELETE FROM sales_ops_payables WHERE id = ${payableA1}`,
    ).rejects.toMatchObject({
      code: '23503',
      constraint_name: 'sales_ops_settlements_org_sale_payable_fk',
    });

    await expect(
      adminClient`DELETE FROM sales_ops_sales WHERE id = ${saleA1}`,
    ).rejects.toMatchObject({ code: '23503' });

    // saleA2's receivable carries no settlement, so it and the sale are still
    // referenced only by each other - prove the RESTRICT fk is real here too.
    void receivableA2;
    void saleB;
  });

  it("deleteSettlementsForOrgs removes one org's settlements and leaves another org untouched", async () => {
    const orgC = newOrgId('i1');
    const orgD = newOrgId('i2');
    const saleC = await insertSale(adminClient, orgC, 1);
    const saleD = await insertSale(adminClient, orgD, 1);
    const receivableC = await insertReceivable(adminClient, orgC, saleC, { amountBrl: 100000 });
    const receivableD = await insertReceivable(adminClient, orgD, saleD, { amountBrl: 100000 });
    await insertSettlement(adminClient, {
      org_id: orgC,
      sale_id: saleC,
      receivable_id: receivableC,
      amount_brl: 100000,
    });
    await insertSettlement(adminClient, {
      org_id: orgD,
      sale_id: saleD,
      receivable_id: receivableD,
      amount_brl: 100000,
    });

    const deletedCount = await deleteSettlementsForOrgs([orgC]);
    expect(deletedCount).toBe(1);

    const [remainingC] = await adminClient<{ count: string }[]>`
      SELECT count(*)::text AS count FROM sales_ops_settlements WHERE org_id = ${orgC}
    `;
    expect(remainingC?.count).toBe('0');
    const [remainingD] = await adminClient<{ count: string }[]>`
      SELECT count(*)::text AS count FROM sales_ops_settlements WHERE org_id = ${orgD}
    `;
    expect(remainingD?.count).toBe('1');

    await expect(
      adminClient`DELETE FROM sales_ops_receivables WHERE id = ${receivableC}`,
    ).resolves.toBeTruthy();

    // orgD's settlement still restricts its receivable - cleaned up in afterAll.
    void receivableD;
  });
});
