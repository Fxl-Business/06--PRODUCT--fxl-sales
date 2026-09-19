import { describe, expect, it } from 'vitest';
import {
  boardStages,
  conversionStage,
  daysInCurrentStage,
  groupLeadsByStage,
  leadIsConverted,
  leadsInStage,
  lostStage,
  stageRequiresReason,
} from '../calculations';
import type { SalesOpsLead, SalesOpsLeadStage } from '../types';

function stage(overrides: Partial<SalesOpsLeadStage> & { id: string }): SalesOpsLeadStage {
  return {
    orgId: 'org-1',
    name: 'Coluna',
    position: 0,
    kind: 'normal',
    isSystem: false,
    status: 'active',
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  };
}

function lead(overrides: Partial<SalesOpsLead> & { id: string }): SalesOpsLead {
  return {
    stageId: 'S1',
    position: 0,
    contactName: 'Contato',
    clientId: null,
    clientNameSnapshot: 'Empresa',
    estimatedValueBrl: 0,
    description: null,
    sellerPersonId: null,
    sellerNameSnapshot: 'Vendedor',
    lostReason: null,
    stageChangedAt: '2026-09-01T00:00:00.000Z',
    saleId: null,
    saleStatus: null,
    products: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  };
}

describe('leads calculations', () => {
  it('orders a column by position and breaks a tie on createdAt', () => {
    const rows = [
      lead({ id: 'c', position: 1, createdAt: '2026-09-03T00:00:00.000Z' }),
      lead({ id: 'a', position: 0, createdAt: '2026-09-02T00:00:00.000Z' }),
      lead({ id: 'b', position: 0, createdAt: '2026-09-01T00:00:00.000Z' }),
      lead({ id: 'z', stageId: 'S2', position: 0 }),
    ];

    expect(leadsInStage(rows, 'S1').map((row) => row.id)).toEqual(['b', 'a', 'c']);
    expect(leadsInStage(rows, 'S2').map((row) => row.id)).toEqual(['z']);
    expect(leadsInStage(rows, 'nope')).toEqual([]);

    const grouped = groupLeadsByStage(rows);
    expect([...grouped.keys()].sort()).toEqual(['S1', 'S2']);
    expect(grouped.get('S1')?.map((row) => row.id)).toEqual(['b', 'a', 'c']);
  });

  it('boardStages drops archived stages and orders the rest by position', () => {
    const stages = [
      stage({ id: 'c', position: 2, name: 'Ganho' }),
      stage({ id: 'x', position: 1, name: 'Antigo', status: 'archived' }),
      stage({ id: 'a', position: 0, name: 'Novo' }),
      stage({ id: 'b', position: 1, name: 'Contato' }),
    ];

    expect(boardStages(stages).map((row) => row.id)).toEqual(['a', 'b', 'c']);
  });

  it('conversionStage and lostStage find the stage by kind, never by name', () => {
    const stages = [
      stage({ id: 'a', position: 0, name: 'Perdido', kind: 'normal' }),
      stage({ id: 'b', position: 1, name: 'Arquivo morto', kind: 'lost', isSystem: true }),
      stage({ id: 'c', position: 2, name: 'Fechado', kind: 'conversion', isSystem: true }),
    ];

    expect(conversionStage(stages)?.id).toBe('c');
    expect(lostStage(stages)?.id).toBe('b');
    expect(conversionStage([])).toBeNull();
    expect(lostStage([])).toBeNull();
  });

  it('stageRequiresReason is true only for the lost stage', () => {
    expect(stageRequiresReason(stage({ id: 'a', kind: 'lost' }))).toBe(true);
    expect(stageRequiresReason(stage({ id: 'b', kind: 'conversion' }))).toBe(false);
    expect(stageRequiresReason(stage({ id: 'c', kind: 'normal' }))).toBe(false);
    expect(stageRequiresReason(undefined)).toBe(false);
  });

  it('leadIsConverted is true exactly when the lead carries a saleId', () => {
    // Sitting in the conversion COLUMN is not the question: a card only becomes
    // read-only once a proposta exists behind it.
    const inConversionColumn = lead({ id: 'a', stageId: 'CONV', saleId: null });
    const converted = lead({ id: 'b', stageId: 'CONV', saleId: 'sale-1', saleStatus: 'open' });
    // And a converted card sitting anywhere else is still converted.
    const convertedElsewhere = lead({ id: 'c', stageId: 'S1', saleId: 'sale-2' });

    expect(leadIsConverted(inConversionColumn)).toBe(false);
    expect(leadIsConverted(converted)).toBe(true);
    expect(leadIsConverted(convertedElsewhere)).toBe(true);
  });

  it('daysInCurrentStage counts whole days from stageChangedAt and never returns NaN', () => {
    const now = new Date('2026-09-18T12:00:00.000Z');

    expect(daysInCurrentStage('2026-09-18T00:00:00.000Z', now)).toBe(0);
    expect(daysInCurrentStage('2026-09-17T11:00:00.000Z', now)).toBe(1);
    expect(daysInCurrentStage('2026-09-08T12:00:00.000Z', now)).toBe(10);
    // A future timestamp clamps at zero rather than reading as "-1 dias".
    expect(daysInCurrentStage('2026-09-20T00:00:00.000Z', now)).toBe(0);
    expect(daysInCurrentStage('nao-e-uma-data', now)).toBe(0);
    expect(Number.isNaN(daysInCurrentStage('nao-e-uma-data', now))).toBe(false);
  });
});
