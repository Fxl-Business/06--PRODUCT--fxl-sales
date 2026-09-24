import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CancelContractSchema, CreateSaleSchema, SaleInstallmentSchema } from '../service.js';

const AREA_ID = '77777777-7777-4777-8777-777777777777';

function minimalSaleBody(baseDate: string) {
  return {
    clientName: 'Cliente',
    sellerName: 'Ana',
    status: 'draft' as const,
    baseDate,
    items: [{ productName: 'Item', quantity: 1, unitBrl: 1000, areaId: AREA_ID }],
    installments: [{ dueDate: '2026-02-28', amountBrl: 1000, method: 'pix' as const }],
  };
}

describe('day inputs reject a non-calendar day', () => {
  it('rejects a day input that is not a real calendar day', () => {
    expect(CancelContractSchema.safeParse({ effectiveDate: '2026-02-30' }).success).toBe(false);
    expect(CancelContractSchema.safeParse({ effectiveDate: '2026-02-28' }).success).toBe(true);

    expect(
      SaleInstallmentSchema.safeParse({ dueDate: '2026-02-30', amountBrl: 1000, method: 'pix' })
        .success,
    ).toBe(false);
    expect(
      SaleInstallmentSchema.safeParse({ dueDate: '2026-02-28', amountBrl: 1000, method: 'pix' })
        .success,
    ).toBe(true);

    expect(CreateSaleSchema.safeParse(minimalSaleBody('2026-02-30')).success).toBe(false);
    expect(CreateSaleSchema.safeParse(minimalSaleBody('2026-02-28')).success).toBe(true);
  });
});

describe('source guard', () => {
  it('no sales-ops API source derives a day from the UTC clock', () => {
    const serviceSource = readFileSync(new URL('../service.ts', import.meta.url), 'utf8');
    const routesSource = readFileSync(new URL('../routes.ts', import.meta.url), 'utf8');

    // Vacuity control: both files must be substantial, not accidentally empty.
    expect(serviceSource.length).toBeGreaterThan(1000);
    expect(routesSource.length).toBeGreaterThan(1000);

    const utcSlicePattern = /new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/;
    const asDateOnlyOfNowPattern = /asDateOnly\(\s*now\s*\)/;

    expect(serviceSource).not.toMatch(utcSlicePattern);
    expect(routesSource).not.toMatch(utcSlicePattern);
    expect(serviceSource).not.toMatch(asDateOnlyOfNowPattern);
    expect(routesSource).not.toMatch(asDateOnlyOfNowPattern);

    const saoPauloDayOfNowMatches = serviceSource.match(/saoPauloDayOf\(now\)/g) ?? [];
    expect(saoPauloDayOfNowMatches.length).toBe(2);
    const todayInSaoPauloNowMatches = serviceSource.match(/todayInSaoPaulo\(now\)/g) ?? [];
    expect(todayInSaoPauloNowMatches.length).toBe(1);
  });
});
