import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSaleLedger, CreateSaleSchema, UpdateSaleSchema } from '../service.js';

const ITEM_ID = '11111111-1111-4111-8111-111111111111';
const PROFESSIONAL_ID = '22222222-2222-4222-8222-222222222222';
const INSTALLMENT_A = '33333333-3333-4333-8333-333333333333';
const INSTALLMENT_B = '44444444-4444-4444-8444-444444444444';
const INSTALLMENT_C = '55555555-5555-4555-8555-555555555555';
const RECURRING_1 = '66666666-6666-4666-8666-666666666666';
const RECURRING_2 = '77777777-7777-4777-8777-777777777777';
const AREA_ID = '88888888-8888-4888-8888-888888888888';

const payload = {
  clientName: 'SegPro',
  sellerName: 'Ana Martins',
  status: 'open' as const,
  baseDate: '2026-08-01',
  items: [{ id: ITEM_ID, productName: 'Serviço', areaId: AREA_ID, quantity: 1, unitBrl: 300000 }],
  professionals: [
    { id: PROFESSIONAL_ID, personName: 'Julia Prado', role: 'Design', costBrl: 50000 },
  ],
  installments: [
    { id: INSTALLMENT_A, dueDate: '2026-08-01', amountBrl: 150000, method: 'pix' as const },
    { id: INSTALLMENT_B, dueDate: '2026-09-01', amountBrl: 0, method: 'pix' as const },
    { id: INSTALLMENT_C, dueDate: '2026-10-01', amountBrl: 150000, method: 'boleto' as const },
  ],
  recurring: {
    monthlyBrl: 10000,
    startDate: '2026-11-01',
    cycles: 3,
    method: 'pix' as const,
    receivableIds: [RECURRING_1, RECURRING_2],
  },
};

const itemContext = [{ areaId: AREA_ID, areaNameSnapshot: 'FXL Tech', productTypeSnapshot: '' }];

describe('UpdateSaleSchema row ids', () => {
  it('UpdateSaleSchema accepts row ids on items, professionals, installments and recurring', () => {
    const parsed = UpdateSaleSchema.parse(payload);
    expect(parsed.items[0]?.id).toBe(ITEM_ID);
    expect(parsed.professionals[0]?.id).toBe(PROFESSIONAL_ID);
    expect(parsed.installments.map((row) => row.id)).toEqual([
      INSTALLMENT_A,
      INSTALLMENT_B,
      INSTALLMENT_C,
    ]);
    expect(parsed.recurring?.receivableIds).toEqual([RECURRING_1, RECURRING_2]);
  });

  it('UpdateSaleSchema refuses a duplicate row id', () => {
    const duplicateItem = UpdateSaleSchema.safeParse({
      ...payload,
      items: [payload.items[0], { ...payload.items[0], unitBrl: 0 }],
    });
    expect(duplicateItem.success).toBe(false);
    expect(duplicateItem.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: 'duplicate_row_id', path: ['items', 1, 'id'] }),
      ]),
    );

    const duplicateProfessional = UpdateSaleSchema.safeParse({
      ...payload,
      professionals: [payload.professionals[0], payload.professionals[0]],
    });
    expect(duplicateProfessional.success).toBe(false);
    expect(duplicateProfessional.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: 'duplicate_row_id', path: ['professionals', 1, 'id'] }),
      ]),
    );

    // Installments and recurring rows share ONE id space.
    const crossDuplicate = UpdateSaleSchema.safeParse({
      ...payload,
      recurring: { ...payload.recurring, receivableIds: [INSTALLMENT_A] },
    });
    expect(crossDuplicate.success).toBe(false);
    expect(crossDuplicate.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: 'duplicate_row_id',
          path: ['recurring', 'receivableIds', 0],
        }),
      ]),
    );
  });

  it('UpdateSaleSchema refuses more recurring ids than cycles', () => {
    const tooMany = UpdateSaleSchema.safeParse({
      ...payload,
      recurring: { ...payload.recurring, cycles: 1 },
    });
    expect(tooMany.success).toBe(false);
    expect(tooMany.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: 'recurring_ids_exceed_cycles',
          path: ['recurring', 'receivableIds'],
        }),
      ]),
    );

    const indefinite = UpdateSaleSchema.safeParse({
      ...payload,
      recurring: { ...payload.recurring, cycles: null },
    });
    expect(indefinite.success).toBe(false);
  });

  it('UpdateSaleSchema accepts status won', () => {
    expect(UpdateSaleSchema.parse({ ...payload, status: 'won' }).status).toBe('won');
    expect(UpdateSaleSchema.safeParse({ ...payload, status: 'lost' }).success).toBe(false);
  });

  it('CreateSaleSchema strips row ids', () => {
    const parsed = CreateSaleSchema.parse(payload);
    expect(parsed.items[0]).not.toHaveProperty('id');
    expect(parsed.professionals[0]).not.toHaveProperty('id');
    expect(parsed.installments[0]).not.toHaveProperty('id');
    expect(parsed.recurring).not.toHaveProperty('receivableIds');
  });

  it('buildSaleLedger carries installment and recurring ids through the zero-amount filter as sourceId', () => {
    const ledger = buildSaleLedger(UpdateSaleSchema.parse(payload), itemContext);
    expect(ledger.receivables.map((row) => [row.label, row.sourceId])).toEqual([
      ['1/2', INSTALLMENT_A],
      ['2/2', INSTALLMENT_C],
      ['M1/3', RECURRING_1],
      ['M2/3', RECURRING_2],
      ['M3/3', null],
    ]);

    const created = buildSaleLedger(CreateSaleSchema.parse(payload), itemContext);
    expect(created.receivables.every((row) => row.sourceId === null)).toBe(true);
  });
});

describe('source guard', () => {
  it('updateSale and sale-edit-writes never delete a ledger row', () => {
    const service = readFileSync(new URL('../service.ts', import.meta.url), 'utf8');
    const start = service.indexOf('export async function updateSale(');
    const end = service.indexOf('export type SaleStatus');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const body = service.slice(start, end);
    expect(body.length).toBeGreaterThan(500);
    expect(body).toContain('applySaleEditPlan');
    expect(body).not.toMatch(/\.delete\(/);

    const writes = readFileSync(new URL('../sale-edit-writes.ts', import.meta.url), 'utf8');
    expect(writes.length).toBeGreaterThan(500);
    expect(writes).toContain('receivableRevisionBump');
    expect(writes).not.toMatch(/\.delete\(/);
  });
});
