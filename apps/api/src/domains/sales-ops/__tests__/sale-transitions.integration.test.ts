/**
 * Slice 04 (proposal-transition-backend) integration coverage.
 *
 * Exercises the real transitionSale/cancelContract service functions through
 * getDb() (RLS live via app.current_org_id) following the
 * finder-state-machine.integration.test.ts pattern: seed and clean up fixtures
 * through getAdminDb() (bypasses RLS via app.fxl_admin), exercise the service
 * under test through the tenant-scoped connection.
 *
 * Run: pnpm --filter @fxl-sales/api test:integration
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { TransactionRollbackError } from 'drizzle-orm/errors';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { closeDb, getAdminDb, getDb } from '../../../db/client.js';
import {
  salesOpsPayables,
  salesOpsPeople,
  salesOpsReceivables,
  salesOpsSaleProfessionals,
  salesOpsSales,
} from '../../../db/schema.js';
import { cancelContract, transitionSale } from '../service.js';

const seededOrgIds: string[] = [];
const sequenceCounters = new Map<string, number>();
const professionalPayableMigrationPath = resolve(
  process.cwd(),
  'drizzle/0018_professional_payable_identity.sql',
);

function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('expected a row, got undefined');
  return v;
}

function nextSequence(orgId: string): number {
  const next = (sequenceCounters.get(orgId) ?? 0) + 1;
  sequenceCounters.set(orgId, next);
  return next;
}

async function seedFinderPerson(orgId: string, displayName: string) {
  const adminDb = getAdminDb();
  const [person] = await adminDb
    .insert(salesOpsPeople)
    .values({ orgId, displayName, isFinder: true })
    .returning();
  return must(person);
}

async function seedSale(
  orgId: string,
  overrides: Partial<typeof salesOpsSales.$inferInsert> = {},
) {
  const adminDb = getAdminDb();
  const sequence = overrides.sequence ?? nextSequence(orgId);
  const values: typeof salesOpsSales.$inferInsert = {
    orgId,
    sequence,
    code: `${String(sequence).padStart(4, '0')}-0`,
    clientNameSnapshot: 'Cliente Teste',
    sellerNameSnapshot: 'Ana Martins',
    finderNameSnapshot: null,
    finderPersonId: null,
    status: 'open',
    paymentMethod: 'pix',
    condition: 'installments',
    installments: 1,
    baseDate: new Date('2026-07-29T00:00:00.000Z'),
    totalBrl: 1000000,
    recurringBrl: 0,
    sellerCommissionPct: '10.00',
    finderCommissionPct: '3.00',
    taxPct: '6.00',
    otherCostsBrl: 0,
    netMarginPct: '0.00',
    ...overrides,
  };
  const [sale] = await adminDb.insert(salesOpsSales).values(values).returning();
  return must(sale);
}

async function seedReceivable(
  orgId: string,
  saleId: string,
  overrides: Partial<typeof salesOpsReceivables.$inferInsert> = {},
) {
  const adminDb = getAdminDb();
  const [row] = await adminDb
    .insert(salesOpsReceivables)
    .values({
      orgId,
      saleId,
      label: '1/1',
      dueDate: new Date('2026-07-29T00:00:00.000Z'),
      amountBrl: 500000,
      method: 'pix',
      status: 'open',
      ...overrides,
    })
    .returning();
  return must(row);
}

async function seedProfessional(
  orgId: string,
  saleId: string,
  overrides: Partial<typeof salesOpsSaleProfessionals.$inferInsert> = {},
) {
  const adminDb = getAdminDb();
  const [row] = await adminDb
    .insert(salesOpsSaleProfessionals)
    .values({
      orgId,
      saleId,
      personNameSnapshot: 'Rafael Nunes',
      role: 'Desenvolvimento',
      costBrl: 40000,
      ...overrides,
    })
    .returning();
  return must(row);
}

afterEach(async () => {
  const adminDb = getAdminDb();
  for (const orgId of seededOrgIds) {
    await adminDb.delete(salesOpsPayables).where(eq(salesOpsPayables.orgId, orgId));
    await adminDb.delete(salesOpsReceivables).where(eq(salesOpsReceivables.orgId, orgId));
    await adminDb
      .delete(salesOpsSaleProfessionals)
      .where(eq(salesOpsSaleProfessionals.orgId, orgId));
    await adminDb.delete(salesOpsSales).where(eq(salesOpsSales.orgId, orgId));
    await adminDb.delete(salesOpsPeople).where(eq(salesOpsPeople.orgId, orgId));
  }
  seededOrgIds.length = 0;
  sequenceCounters.clear();
});

afterAll(async () => {
  await closeDb();
});

describe('transitionSale', () => {
  it('win materializes payables linked to each receivable row', async () => {
    const orgId = `org_st_win_${crypto.randomUUID()}`;
    seededOrgIds.push(orgId);

    const finder = await seedFinderPerson(orgId, 'Carlos Finder');
    const sale = await seedSale(orgId, {
      status: 'open',
      finderPersonId: finder.id,
      finderNameSnapshot: 'Carlos Finder',
      sellerCommissionPct: '10.00',
      finderCommissionPct: '3.00',
      taxPct: '6.00',
      otherCostsBrl: 25000,
    });
    const r1 = await seedReceivable(orgId, sale.id, {
      dueDate: new Date('2026-08-01T00:00:00.000Z'),
      amountBrl: 500000,
    });
    const r2 = await seedReceivable(orgId, sale.id, {
      dueDate: new Date('2026-09-01T00:00:00.000Z'),
      amountBrl: 500000,
    });
    const professional = await seedProfessional(orgId, sale.id, { costBrl: 40000 });

    const result = await transitionSale(getDb(), orgId, sale.id, 'won');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.sale.status).toBe('won');
    expect(result.sale.wonAt).not.toBeNull();

    const adminDb = getAdminDb();
    const payables = await adminDb
      .select()
      .from(salesOpsPayables)
      .where(eq(salesOpsPayables.saleId, sale.id));
    // 4 per receivable (seller, finder, tax, professional) + the one-shot other_cost.
    expect(payables).toHaveLength(9);

    const byReceivable = (id: string) => payables.filter((p) => p.receivableId === id);
    expect(byReceivable(r1.id)).toHaveLength(4);
    expect(
      byReceivable(r1.id).every((p) => p.dueDate.toISOString().slice(0, 10) === '2026-08-01'),
    ).toBe(true);
    expect(byReceivable(r2.id)).toHaveLength(4);
    expect(
      byReceivable(r2.id).every((p) => p.dueDate.toISOString().slice(0, 10) === '2026-09-01'),
    ).toBe(true);

    // The professional's cost is split across the two equal parcelas and the
    // parts still sum to exactly the stored cost_brl.
    const professionalPayables = payables.filter((p) => p.kind === 'professional_cost');
    expect(professionalPayables).toHaveLength(2);
    expect(professionalPayables.every((p) => p.receivableId !== null)).toBe(true);
    expect(professionalPayables.every((p) => p.saleProfessionalId === professional.id)).toBe(true);
    expect(professionalPayables.reduce((sum, p) => sum + p.amountBrl, 0)).toBe(40000);
    expect(
      payables
        .filter((p) => p.kind !== 'professional_cost')
        .every((p) => p.saleProfessionalId === null),
    ).toBe(true);

    // `other_cost` is the only kind left with a null receivable_id.
    const oneShots = payables.filter((p) => p.receivableId === null);
    expect(oneShots).toHaveLength(1);
    expect(oneShots.map((p) => p.kind)).toEqual(['other_cost']);
  });

  it('reverting a won sale voids open payables, keeps paid ones, and clears won_at', async () => {
    const orgId = `org_st_revert_${crypto.randomUUID()}`;
    seededOrgIds.push(orgId);

    const sale = await seedSale(orgId, { status: 'open' });
    await seedReceivable(orgId, sale.id, { amountBrl: 500000 });

    const winResult = await transitionSale(getDb(), orgId, sale.id, 'won');
    if (!winResult.ok) throw new Error('expected win to succeed');

    const adminDb = getAdminDb();
    const payablesBefore = await adminDb
      .select()
      .from(salesOpsPayables)
      .where(eq(salesOpsPayables.saleId, sale.id));
    expect(payablesBefore.length).toBeGreaterThan(0);
    const [firstPayable] = payablesBefore;
    await adminDb
      .update(salesOpsPayables)
      .set({ status: 'paid' })
      .where(eq(salesOpsPayables.id, must(firstPayable).id));

    const revertResult = await transitionSale(getDb(), orgId, sale.id, 'open');

    expect(revertResult.ok).toBe(true);
    if (!revertResult.ok) throw new Error('expected ok');
    expect(revertResult.sale.status).toBe('open');
    expect(revertResult.sale.wonAt).toBeNull();

    const payablesAfter = await adminDb
      .select()
      .from(salesOpsPayables)
      .where(eq(salesOpsPayables.saleId, sale.id));
    const paidPayable = payablesAfter.find((p) => p.id === must(firstPayable).id);
    expect(paidPayable?.status).toBe('paid');
    const others = payablesAfter.filter((p) => p.id !== must(firstPayable).id);
    expect(others.length).toBeGreaterThan(0);
    expect(others.every((p) => p.status === 'void')).toBe(true);
  });

  it('re-win creates exactly one missing payable for same-name professionals', async () => {
    const orgId = `org_st_same_name_${crypto.randomUUID()}`;
    seededOrgIds.push(orgId);

    const sale = await seedSale(orgId, {
      status: 'open',
      sellerCommissionPct: '0.00',
      finderCommissionPct: '0.00',
      taxPct: '0.00',
      otherCostsBrl: 0,
    });
    await seedReceivable(orgId, sale.id, { amountBrl: 200000 });
    await seedProfessional(orgId, sale.id, {
      personNameSnapshot: 'Profissional Homonimo',
      costBrl: 100000,
    });
    await seedProfessional(orgId, sale.id, {
      personNameSnapshot: 'Profissional Homonimo',
      costBrl: 100000,
    });

    const firstWin = await transitionSale(getDb(), orgId, sale.id, 'won');
    expect(firstWin.ok).toBe(true);

    const adminDb = getAdminDb();
    const firstRows = (
      await adminDb
        .select()
        .from(salesOpsPayables)
        .where(
          and(eq(salesOpsPayables.orgId, orgId), eq(salesOpsPayables.saleId, sale.id)),
        )
    ).filter((row) => row.kind === 'professional_cost');
    expect(firstRows).toHaveLength(2);
    const paid = must(firstRows[0]);
    await adminDb
      .update(salesOpsPayables)
      .set({ status: 'paid' })
      .where(and(eq(salesOpsPayables.orgId, orgId), eq(salesOpsPayables.id, paid.id)));

    const reopened = await transitionSale(getDb(), orgId, sale.id, 'open');
    expect(reopened.ok).toBe(true);
    const secondWin = await transitionSale(getDb(), orgId, sale.id, 'won');
    expect(secondWin.ok).toBe(true);

    const allRows = (
      await adminDb
        .select()
        .from(salesOpsPayables)
        .where(
          and(eq(salesOpsPayables.orgId, orgId), eq(salesOpsPayables.saleId, sale.id)),
        )
    ).filter((row) => row.kind === 'professional_cost');
    const activeRows = allRows.filter((row) => row.status !== 'void');
    const newlyActiveRows = activeRows.filter((row) => row.id !== paid.id);

    expect(activeRows).toHaveLength(2);
    expect(activeRows.reduce((sum, row) => sum + row.amountBrl, 0)).toBe(200000);
    expect(newlyActiveRows).toHaveLength(1);
    expect(newlyActiveRows[0]?.status).toBe('open');
  });

  it('migration backfill links only one org-sale-snapshot match and leaves ambiguous rows null', async () => {
    const uniqueOrgId = `org_st_backfill_unique_${crypto.randomUUID()}`;
    const ambiguousOrgId = `org_st_backfill_ambiguous_${crypto.randomUUID()}`;
    const otherOrgId = `org_st_backfill_other_${crypto.randomUUID()}`;
    const adminDb = getAdminDb();
    const markedBackfills = readFileSync(professionalPayableMigrationPath, 'utf8')
      .split('--> statement-breakpoint')
      .filter((statement) =>
        statement.split(/\r?\n/).some((line) => line === '-- fxl-phase: backfill-repeat'),
      );
    expect(markedBackfills).toHaveLength(1);
    const backfill = markedBackfills[0]?.replace(
      /^\s*-- fxl-phase: backfill-repeat\r?\n/,
      '',
    );
    if (!backfill) throw new Error('professional payable identity backfill not found');
    expect(backfill).toMatch(/^WITH "unambiguous_professional_matches"/);

    await expect(
      adminDb.transaction(async (tx) => {
        const insertSale = async (orgId: string) => {
          const [sale] = await tx
            .insert(salesOpsSales)
            .values({
              orgId,
              sequence: 1,
              code: '0001-0',
              clientNameSnapshot: 'Cliente Teste',
              sellerNameSnapshot: 'Ana Martins',
              status: 'open',
              paymentMethod: 'pix',
              condition: 'installments',
              installments: 1,
              baseDate: new Date('2026-07-29T00:00:00.000Z'),
              totalBrl: 1000000,
              recurringBrl: 0,
              sellerCommissionPct: '10.00',
              finderCommissionPct: '3.00',
              taxPct: '6.00',
              otherCostsBrl: 0,
              netMarginPct: '0.00',
            })
            .returning();
          return must(sale);
        };
        const insertProfessional = async (
          orgId: string,
          saleId: string,
          personNameSnapshot: string,
        ) => {
          const [professional] = await tx
            .insert(salesOpsSaleProfessionals)
            .values({
              orgId,
              saleId,
              personNameSnapshot,
              role: 'Desenvolvimento',
              costBrl: 40000,
            })
            .returning();
          return must(professional);
        };

        const uniqueSale = await insertSale(uniqueOrgId);
        const uniqueProfessional = await insertProfessional(
          uniqueOrgId,
          uniqueSale.id,
          'Snapshot Unico',
        );
        const ambiguousSale = await insertSale(ambiguousOrgId);
        await insertProfessional(ambiguousOrgId, ambiguousSale.id, 'Snapshot Ambiguo');
        await insertProfessional(ambiguousOrgId, ambiguousSale.id, 'Snapshot Ambiguo');
        const otherSale = await insertSale(otherOrgId);
        await insertProfessional(otherOrgId, otherSale.id, 'Snapshot Unico');

        const [uniquePayable] = await tx
          .insert(salesOpsPayables)
          .values({
            orgId: uniqueOrgId,
            saleId: uniqueSale.id,
            beneficiaryName: 'Snapshot Unico',
            kind: 'professional_cost',
            dueDate: new Date('2026-08-01T00:00:00.000Z'),
            amountBrl: 40000,
            status: 'paid',
          })
          .returning();
        const [ambiguousPayable] = await tx
          .insert(salesOpsPayables)
          .values({
            orgId: ambiguousOrgId,
            saleId: ambiguousSale.id,
            beneficiaryName: 'Snapshot Ambiguo',
            kind: 'professional_cost',
            dueDate: new Date('2026-08-01T00:00:00.000Z'),
            amountBrl: 40000,
            status: 'paid',
          })
          .returning();

        const readIdentity = async (orgId: string, id: string) => {
          const [row] = await tx
            .select({ saleProfessionalId: salesOpsPayables.saleProfessionalId })
            .from(salesOpsPayables)
            .where(and(eq(salesOpsPayables.orgId, orgId), eq(salesOpsPayables.id, id)));
          return must(row).saleProfessionalId;
        };

        await tx.execute(sql.raw(backfill));
        expect(await readIdentity(uniqueOrgId, must(uniquePayable).id)).toBe(
          uniqueProfessional.id,
        );
        expect(await readIdentity(ambiguousOrgId, must(ambiguousPayable).id)).toBeNull();

        await tx.execute(sql.raw(backfill));
        expect(await readIdentity(uniqueOrgId, must(uniquePayable).id)).toBe(
          uniqueProfessional.id,
        );
        expect(await readIdentity(ambiguousOrgId, must(ambiguousPayable).id)).toBeNull();

        tx.rollback();
      }),
    ).rejects.toBeInstanceOf(TransactionRollbackError);

    for (const orgId of [uniqueOrgId, ambiguousOrgId, otherOrgId]) {
      const rows = await adminDb
        .select({ id: salesOpsSales.id })
        .from(salesOpsSales)
        .where(eq(salesOpsSales.orgId, orgId));
      expect(rows).toHaveLength(0);
    }
  });

  it('payable professional identity rejects another organization and another sale', async () => {
    const orgA = `org_st_fk_a_${crypto.randomUUID()}`;
    const orgB = `org_st_fk_b_${crypto.randomUUID()}`;
    seededOrgIds.push(orgA, orgB);

    const saleA = await seedSale(orgA);
    const otherSaleA = await seedSale(orgA);
    const saleB = await seedSale(orgB);
    const matchingProfessional = await seedProfessional(orgA, saleA.id);
    const otherSaleProfessional = await seedProfessional(orgA, otherSaleA.id);
    const otherOrgProfessional = await seedProfessional(orgB, saleB.id);
    const adminDb = getAdminDb();
    const payableValues = {
      orgId: orgA,
      saleId: saleA.id,
      beneficiaryName: 'Rafael Nunes',
      kind: 'professional_cost',
      dueDate: new Date('2026-08-01T00:00:00.000Z'),
      amountBrl: 40000,
      status: 'open',
    } as const;
    const expectForeignKeyViolation = async (query: Promise<unknown>) => {
      try {
        await query;
        throw new Error('expected composite foreign key violation');
      } catch (error) {
        expect((error as { cause?: { code?: string } }).cause?.code).toBe('23503');
      }
    };

    await expectForeignKeyViolation(
      adminDb.insert(salesOpsPayables).values({
        ...payableValues,
        saleProfessionalId: otherOrgProfessional.id,
      }),
    );
    await expectForeignKeyViolation(
      adminDb.insert(salesOpsPayables).values({
        ...payableValues,
        saleProfessionalId: otherSaleProfessional.id,
      }),
    );

    const [inserted] = await adminDb
      .insert(salesOpsPayables)
      .values({ ...payableValues, saleProfessionalId: matchingProfessional.id })
      .returning();
    expect(must(inserted).saleProfessionalId).toBe(matchingProfessional.id);
  });
});

describe('cancelContract', () => {
  it('voids future open receivables and their linked open payables only', async () => {
    const orgId = `org_st_cancel_${crypto.randomUUID()}`;
    seededOrgIds.push(orgId);

    /*
      Every receivable below is `M`-labelled, i.e. recurring, so the
      professional-cost split has ZERO eligible rows and falls back to the legacy
      one-shot payable with receivable_id NULL. That is why `voidedPayables` is
      still 3 here and why the one-shot assertions at the bottom still hold — do
      not "fix" those numbers when reading this after slice 06.
    */
    const sale = await seedSale(orgId, { status: 'open', recurringBrl: 100000 });
    await seedProfessional(orgId, sale.id, { costBrl: 40000 });
    const r1 = await seedReceivable(orgId, sale.id, {
      label: 'M1/3',
      dueDate: new Date('2026-08-01T00:00:00.000Z'),
      amountBrl: 100000,
    });
    const r2 = await seedReceivable(orgId, sale.id, {
      label: 'M2/3',
      dueDate: new Date('2026-09-01T00:00:00.000Z'),
      amountBrl: 100000,
    });
    const r3 = await seedReceivable(orgId, sale.id, {
      label: 'M3/3',
      dueDate: new Date('2026-10-01T00:00:00.000Z'),
      amountBrl: 100000,
    });

    const winResult = await transitionSale(getDb(), orgId, sale.id, 'won');
    if (!winResult.ok) throw new Error('expected win to succeed');
    const updatedAtAfterWin = winResult.sale.updatedAt;

    const adminDb = getAdminDb();
    const [r2SellerPayable] = await adminDb
      .select()
      .from(salesOpsPayables)
      .where(
        and(
          eq(salesOpsPayables.saleId, sale.id),
          eq(salesOpsPayables.receivableId, r2.id),
          eq(salesOpsPayables.kind, 'seller_commission'),
        ),
      );
    await adminDb
      .update(salesOpsPayables)
      .set({ status: 'paid' })
      .where(eq(salesOpsPayables.id, must(r2SellerPayable).id));

    const result = await cancelContract(getDb(), orgId, sale.id, '2026-08-15');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.voidedReceivables).toBe(2);
    expect(result.voidedPayables).toBe(3);
    expect(result.sale.status).toBe('won');
    expect(result.sale.updatedAt?.getTime()).toBe(updatedAtAfterWin?.getTime());

    const receivablesAfter = await adminDb
      .select()
      .from(salesOpsReceivables)
      .where(eq(salesOpsReceivables.saleId, sale.id));
    const statusById = new Map(receivablesAfter.map((r) => [r.id, r.status]));
    expect(statusById.get(r1.id)).toBe('open');
    expect(statusById.get(r2.id)).toBe('void');
    expect(statusById.get(r3.id)).toBe('void');

    const payablesAfter = await adminDb
      .select()
      .from(salesOpsPayables)
      .where(eq(salesOpsPayables.saleId, sale.id));

    const r1Payables = payablesAfter.filter((p) => p.receivableId === r1.id);
    expect(r1Payables.length).toBeGreaterThan(0);
    expect(r1Payables.every((p) => p.status === 'open')).toBe(true);

    const r2Payables = payablesAfter.filter((p) => p.receivableId === r2.id);
    expect(r2Payables.find((p) => p.id === must(r2SellerPayable).id)?.status).toBe('paid');
    expect(
      r2Payables.filter((p) => p.id !== must(r2SellerPayable).id).every((p) => p.status === 'void'),
    ).toBe(true);

    const r3Payables = payablesAfter.filter((p) => p.receivableId === r3.id);
    expect(r3Payables.length).toBeGreaterThan(0);
    expect(r3Payables.every((p) => p.status === 'void')).toBe(true);

    const oneShotPayables = payablesAfter.filter((p) => p.receivableId === null);
    expect(oneShotPayables.length).toBeGreaterThan(0);
    expect(oneShotPayables.every((p) => p.status === 'open')).toBe(true);
  });

  it('voids the split parts bound to cancelled future parcelas only', async () => {
    const orgId = `org_st_cancel_split_${crypto.randomUUID()}`;
    seededOrgIds.push(orgId);

    /*
      The behavioural change slice 06 buys: before the split, a professional_cost
      carried receivable_id NULL, matched nothing in cancelContract's
      inArray(receivableId, futureIds) and SURVIVED a mid-contract cancellation —
      so the professional stayed owed for work funded by parcelas the client will
      never pay. Linked, the parts follow their parcela.
    */
    const sale = await seedSale(orgId, { status: 'open', recurringBrl: 0 });
    await seedProfessional(orgId, sale.id, { costBrl: 90000 });
    const r1 = await seedReceivable(orgId, sale.id, {
      label: '1/3',
      dueDate: new Date('2026-08-01T00:00:00.000Z'),
      amountBrl: 100000,
    });
    const r2 = await seedReceivable(orgId, sale.id, {
      label: '2/3',
      dueDate: new Date('2026-09-01T00:00:00.000Z'),
      amountBrl: 100000,
    });
    const r3 = await seedReceivable(orgId, sale.id, {
      label: '3/3',
      dueDate: new Date('2026-10-01T00:00:00.000Z'),
      amountBrl: 100000,
    });

    const winResult = await transitionSale(getDb(), orgId, sale.id, 'won');
    if (!winResult.ok) throw new Error('expected win to succeed');

    const adminDb = getAdminDb();
    const professionalBefore = (
      await adminDb.select().from(salesOpsPayables).where(eq(salesOpsPayables.saleId, sale.id))
    ).filter((p) => p.kind === 'professional_cost');
    expect(professionalBefore).toHaveLength(3);
    expect(professionalBefore.reduce((sum, p) => sum + p.amountBrl, 0)).toBe(90000);

    const result = await cancelContract(getDb(), orgId, sale.id, '2026-08-15');
    expect(result.ok).toBe(true);

    const professionalAfter = (
      await adminDb.select().from(salesOpsPayables).where(eq(salesOpsPayables.saleId, sale.id))
    ).filter((p) => p.kind === 'professional_cost');
    const statusByReceivable = new Map(
      professionalAfter.map((p) => [p.receivableId, p.status] as const),
    );

    expect(statusByReceivable.get(r1.id)).toBe('open');
    expect(statusByReceivable.get(r2.id)).toBe('void');
    expect(statusByReceivable.get(r3.id)).toBe('void');
  });
});

describe('cross-tenant and invalid-transition guards', () => {
  it('cross-tenant sale id behaves as not_found', async () => {
    const orgA = `org_st_tenant_a_${crypto.randomUUID()}`;
    const orgB = `org_st_tenant_b_${crypto.randomUUID()}`;
    seededOrgIds.push(orgA, orgB);

    const sale = await seedSale(orgA, { status: 'open' });

    const transitionResult = await transitionSale(getDb(), orgB, sale.id, 'open');
    expect(transitionResult).toEqual({ ok: false, reason: 'not_found' });

    const cancelResult = await cancelContract(getDb(), orgB, sale.id);
    expect(cancelResult).toEqual({ ok: false, reason: 'not_found' });

    const adminDb = getAdminDb();
    const [stillThere] = await adminDb
      .select()
      .from(salesOpsSales)
      .where(eq(salesOpsSales.id, sale.id));
    expect(must(stillThere).status).toBe('open');
    expect(must(stillThere).orgId).toBe(orgA);
  });

  it('invalid transitions are rejected', async () => {
    const orgId = `org_st_invalid_${crypto.randomUUID()}`;
    seededOrgIds.push(orgId);

    const draftSale = await seedSale(orgId, { status: 'draft' });
    const draftToLost = await transitionSale(getDb(), orgId, draftSale.id, 'lost');
    expect(draftToLost).toEqual({ ok: false, reason: 'invalid_transition', from: 'draft', to: 'lost' });

    const lostSale = await seedSale(orgId, { status: 'lost', lostAt: new Date() });
    const lostToWon = await transitionSale(getDb(), orgId, lostSale.id, 'won');
    expect(lostToWon).toEqual({ ok: false, reason: 'invalid_transition', from: 'lost', to: 'won' });

    const openSale = await seedSale(orgId, { status: 'open' });
    const cancelOpen = await cancelContract(getDb(), orgId, openSale.id);
    expect(cancelOpen).toEqual({ ok: false, reason: 'not_cancellable' });
  });
});
