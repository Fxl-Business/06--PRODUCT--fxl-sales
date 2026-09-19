import { describe, expect, it } from 'vitest';
import { leadsInStage } from '../calculations';
import {
  flattenLeadPages,
  leadsHasMore,
  moveLeadInList,
  optimisticLeadMove,
  reconcileLeadRow,
} from '../optimistic';
import type { LeadsInfiniteData, SalesOpsLead } from '../types';

const ORIGINAL_STAMP = '2026-09-01T00:00:00.000Z';
const NOW = '2026-09-18T12:00:00.000Z';

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
    stageChangedAt: ORIGINAL_STAMP,
    saleId: null,
    saleStatus: null,
    products: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  };
}

/** S1 holds L1/L2/L3, S2 holds L9, S3 is an untouched third column. */
function board(): SalesOpsLead[] {
  return [
    lead({ id: 'L1', stageId: 'S1', position: 0 }),
    lead({ id: 'L2', stageId: 'S1', position: 1 }),
    lead({ id: 'L3', stageId: 'S1', position: 2 }),
    lead({ id: 'L9', stageId: 'S2', position: 0 }),
    lead({ id: 'L7', stageId: 'S3', position: 0 }),
    lead({ id: 'L8', stageId: 'S3', position: 1 }),
  ];
}

function ids(rows: readonly SalesOpsLead[], stageId: string): string[] {
  return leadsInStage(rows, stageId).map((row) => row.id);
}

function positions(rows: readonly SalesOpsLead[], stageId: string): number[] {
  return leadsInStage(rows, stageId).map((row) => row.position);
}

describe('moveLeadInList', () => {
  it('moves a lead to another column at the requested index and densifies both columns', () => {
    const next = moveLeadInList(
      board(),
      { leadId: 'L2', toStageId: 'S2', toIndex: 0 },
      NOW,
    );

    expect(ids(next, 'S2')).toEqual(['L2', 'L9']);
    expect(positions(next, 'S2')).toEqual([0, 1]);
    expect(ids(next, 'S1')).toEqual(['L1', 'L3']);
    expect(positions(next, 'S1')).toEqual([0, 1]);
    expect(next.find((row) => row.id === 'L2')?.stageId).toBe('S2');
  });

  it('stamps a new stageChangedAt only when the destination stage differs', () => {
    const next = moveLeadInList(
      board(),
      { leadId: 'L2', toStageId: 'S2', toIndex: 0, reason: 'sem orçamento' },
      NOW,
    );

    const moved = next.find((row) => row.id === 'L2');
    expect(moved?.stageChangedAt).toBe(NOW);
    expect(moved?.lostReason).toBe('sem orçamento');
    // Nobody else's stamp moves.
    expect(next.filter((row) => row.id !== 'L2').every((row) => row.stageChangedAt === ORIGINAL_STAMP)).toBe(true);
  });

  it('leaves stageChangedAt byte-identical when the move is a reorder inside the same column', () => {
    const next = moveLeadInList(
      board(),
      { leadId: 'L2', toStageId: 'S1', toIndex: 0, reason: 'nao deve gravar' },
      NOW,
    );

    const moved = next.find((row) => row.id === 'L2');
    expect(ids(next, 'S1')).toEqual(['L2', 'L1', 'L3']);
    expect(positions(next, 'S1')).toEqual([0, 1, 2]);
    expect(moved?.stageChangedAt).toBe(ORIGINAL_STAMP);
    // A reorder never touches lostReason either.
    expect(moved?.lostReason).toBeNull();
  });

  it('leaves untouched columns identical by reference', () => {
    const input = board();
    const next = moveLeadInList(input, { leadId: 'L2', toStageId: 'S2', toIndex: 0 }, NOW);

    for (const id of ['L7', 'L8']) {
      expect(next.find((row) => row.id === id)).toBe(input.find((row) => row.id === id));
    }
  });

  it('clamps an out-of-range toIndex to the ends of the destination column', () => {
    const high = moveLeadInList(board(), { leadId: 'L1', toStageId: 'S1', toIndex: 99 }, NOW);
    expect(ids(high, 'S1')).toEqual(['L2', 'L3', 'L1']);
    expect(positions(high, 'S1')).toEqual([0, 1, 2]);

    const low = moveLeadInList(board(), { leadId: 'L3', toStageId: 'S1', toIndex: -5 }, NOW);
    expect(ids(low, 'S1')).toEqual(['L3', 'L1', 'L2']);
    expect(positions(low, 'S1')).toEqual([0, 1, 2]);
  });

  it('returns the identical snapshot when the lead is not in the cache', () => {
    const input = board();
    expect(moveLeadInList(input, { leadId: 'nope', toStageId: 'S2', toIndex: 0 }, NOW)).toBe(input);
  });
});

function snapshot(): LeadsInfiniteData {
  const rows = board();
  return {
    pages: [
      { leads: rows.slice(0, 3), nextCursor: 'cursor-1' },
      { leads: rows.slice(3), nextCursor: null },
    ],
    pageParams: [null, 'cursor-1'],
  };
}

describe('optimisticLeadMove', () => {
  it('preserves page membership and hands back the identical object for an unknown lead', () => {
    const previous = snapshot();
    const patch = optimisticLeadMove(previous, { leadId: 'L2', toStageId: 'S2', toIndex: 0 }, NOW);

    expect(patch.leadId).toBe('L2');
    expect(patch.previous).toBe(previous);
    expect(patch.next.pages.map((page) => page.leads.map((row) => row.id))).toEqual([
      ['L1', 'L2', 'L3'],
      ['L9', 'L7', 'L8'],
    ]);
    expect(patch.next.pages.map((page) => page.nextCursor)).toEqual(['cursor-1', null]);
    expect(patch.next.pageParams).toBe(previous.pageParams);
    expect(ids(flattenLeadPages(patch.next), 'S2')).toEqual(['L2', 'L9']);

    const missing = optimisticLeadMove(previous, { leadId: 'nope', toStageId: 'S2', toIndex: 0 }, NOW);
    expect(missing.next).toBe(previous);
  });

  it('never writes saleId optimistically', () => {
    const patch = optimisticLeadMove(
      snapshot(),
      { leadId: 'L2', toStageId: 'S2', toIndex: 0, saleId: 'sale-1' },
      NOW,
    );
    expect(flattenLeadPages(patch.next).find((row) => row.id === 'L2')?.saleId).toBeNull();
  });
});

describe('reconcileLeadRow', () => {
  it('reconcileLeadRow replaces the row in place and leaves every page boundary alone', () => {
    const previous = snapshot();
    const persisted = lead({ id: 'L2', stageId: 'S2', position: 1, stageChangedAt: NOW });
    const next = reconcileLeadRow(previous, persisted);

    expect(next.pages.map((page) => page.leads.map((row) => row.id))).toEqual([
      ['L1', 'L2', 'L3'],
      ['L9', 'L7', 'L8'],
    ]);
    expect(next.pages.at(0)?.leads.at(1)).toBe(persisted);
    expect(flattenLeadPages(next).filter((row) => row.id === 'L2')).toHaveLength(1);

    const created = reconcileLeadRow(previous, lead({ id: 'NEW', stageId: 'S1', position: 3 }));
    expect(created.pages.at(0)?.leads.map((row) => row.id)).toEqual(['NEW', 'L1', 'L2', 'L3']);
    expect(created.pages.at(1)?.leads.map((row) => row.id)).toEqual(['L9', 'L7', 'L8']);
  });
});

describe('flattenLeadPages and leadsHasMore', () => {
  it('flattens every page and reads hasMore off the last page', () => {
    expect(flattenLeadPages(undefined)).toEqual([]);
    expect(leadsHasMore(undefined)).toBe(false);
    expect(flattenLeadPages(snapshot())).toHaveLength(6);
    expect(leadsHasMore(snapshot())).toBe(false);

    const unfinished: LeadsInfiniteData = {
      pages: [{ leads: [], nextCursor: 'more' }],
      pageParams: [null],
    };
    expect(leadsHasMore(unfinished)).toBe(true);
  });
});
