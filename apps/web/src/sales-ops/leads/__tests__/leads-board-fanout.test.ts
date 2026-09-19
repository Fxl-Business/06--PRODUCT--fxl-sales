// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '@/lib/query-keys';
import { leadsApi, type ListLeadsParams } from '../api';
import { leadsInStage } from '../calculations';
import { flattenLeadPages } from '../optimistic';
import type {
  LeadBoardFilters,
  LeadBoardModel,
  LeadsInfiniteData,
  LeadsPage,
  SalesOpsLead,
  SalesOpsLeadStage,
} from '../types';
import { useLeadsBoard, useMoveLead } from '../hooks';

/**
 * The R7 FAN-OUT oracle.
 *
 * The shipped `ListLeadsQuerySchema` REQUIRES `stageId`, so there is no
 * board-wide list endpoint: `useLeadsBoard` issues ONE request per active column
 * inside a single infinite-query `queryFn` and merges the answers into ONE FLAT
 * cache entry, which is the entry `useMoveLead` patches. Nothing but type-check
 * and careful reading held that mechanism before this file.
 *
 * It drives the REAL hook through a real React mount (happy-dom + `createRoot`),
 * mocking only the `leadsApi` seam, exactly as `leads-move-rollback.test.ts`
 * mocks `leadsApi.moveLead`. An SSR `renderToString` capture cannot be used here:
 * it never runs the effects that make an infinite query fetch at all.
 */

vi.mock('@/auth/react', () => ({
  useAccessToken: () => ({ getToken: async () => 'test-token' }),
}));

vi.mock('../api', () => ({
  leadsApi: {
    listLeads: vi.fn(),
    moveLead: vi.fn(),
  },
}));

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

const STAMP = '2026-09-01T00:00:00.000Z';

function lead(id: string, stageId: string, position: number): SalesOpsLead {
  return {
    id,
    stageId,
    position,
    contactName: `Contato ${id}`,
    clientId: null,
    clientNameSnapshot: 'Empresa',
    estimatedValueBrl: 0,
    description: null,
    sellerPersonId: null,
    sellerNameSnapshot: 'Vendedor',
    lostReason: null,
    stageChangedAt: STAMP,
    saleId: null,
    saleStatus: null,
    products: [],
    createdAt: `2026-08-01T00:00:0${position}.000Z`,
    updatedAt: null,
  };
}

function stage(
  id: string,
  position: number,
  overrides: Partial<SalesOpsLeadStage> = {},
): SalesOpsLeadStage {
  return {
    id,
    orgId: 'org-1',
    name: `Coluna ${id}`,
    position,
    kind: 'normal',
    isSystem: false,
    status: 'active',
    archivedAt: null,
    createdAt: STAMP,
    updatedAt: null,
    ...overrides,
  };
}

/**
 * Two active columns plus one ARCHIVED one. The archived column has no fixture
 * page at all, so a fan-out that forgot `boardStages` would throw rather than
 * quietly succeed.
 */
const STAGES: SalesOpsLeadStage[] = [
  stage('S1', 0),
  stage('S2', 1),
  stage('SARQ', 2, { status: 'archived', archivedAt: STAMP }),
];

/** S1 has two pages; S2 is exhausted on its first. Keyed by the cursor asked for. */
const FIXTURES: Record<string, Record<string, LeadsPage>> = {
  S1: {
    first: { leads: [lead('L1', 'S1', 0), lead('L2', 'S1', 1)], nextCursor: 'S1:c1' },
    'S1:c1': { leads: [lead('L3', 'S1', 2)], nextCursor: null },
  },
  S2: {
    first: { leads: [lead('L9', 'S2', 0)], nextCursor: null },
  },
};

type BoardHandle = {
  model: LeadBoardModel | undefined;
  hasNextPage: boolean;
  fetchNextPage: () => Promise<unknown>;
  move: ReturnType<typeof useMoveLead> | undefined;
};

let container: HTMLDivElement;
let root: Root | null;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = null;
  vi.mocked(leadsApi.listLeads).mockImplementation(async (params: ListLeadsParams) => {
    const column = FIXTURES[params.stageId];
    if (!column) throw new Error(`no fixture for stage ${params.stageId}`);
    const page = column[params.cursor ?? 'first'];
    if (!page) throw new Error(`no fixture for stage ${params.stageId} at cursor ${params.cursor}`);
    return page;
  });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container.remove();
  vi.clearAllMocks();
});

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
}

async function flushReact() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mountBoard(
  queryClient: QueryClient,
  stages: readonly SalesOpsLeadStage[],
  filters?: LeadBoardFilters,
): Promise<BoardHandle> {
  const handle: BoardHandle = {
    model: undefined,
    hasNextPage: false,
    fetchNextPage: async () => undefined,
    move: undefined,
  };

  function BoardProbe() {
    const board = useLeadsBoard(stages, filters);
    const move = useMoveLead(filters);
    handle.model = board.data;
    handle.hasNextPage = board.hasNextPage;
    handle.fetchNextPage = board.fetchNextPage;
    handle.move = move;
    return null;
  }

  root = createRoot(container);
  await act(async () => {
    root?.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(BoardProbe, null),
      ),
    );
  });
  await flushReact();
  return handle;
}

function requestedParams(): ListLeadsParams[] {
  return vi.mocked(leadsApi.listLeads).mock.calls.map(([params]) => params);
}

function rawEntry(queryClient: QueryClient, filters?: LeadBoardFilters) {
  return queryClient.getQueryData<LeadsInfiniteData>(queryKeys.leads.board(filters));
}

describe('useLeadsBoard fan-out', () => {
  it('issues exactly one request per ACTIVE stage, each carrying that stage own stageId', async () => {
    const queryClient = createQueryClient();
    await mountBoard(queryClient, STAGES);

    // The exact SET, not merely the count: a fan-out that asked one column twice
    // and another never would still make two calls.
    expect(requestedParams().map((params) => params.stageId).sort()).toEqual(['S1', 'S2']);
    // The archived column is never asked for, and neither is a board-wide list:
    // every request names a stage.
    expect(requestedParams().every((params) => typeof params.stageId === 'string')).toBe(true);
    expect(requestedParams().some((params) => params.stageId === 'SARQ')).toBe(false);
  });

  it('merges every column into ONE FLAT cache entry that useMoveLead then patches', async () => {
    const queryClient = createQueryClient();
    // Never resolved: the assertion is about the OPTIMISTIC write, and a settled
    // move would invalidate and refetch on top of it.
    vi.mocked(leadsApi.moveLead).mockReturnValueOnce(new Promise(() => undefined));
    const handle = await mountBoard(queryClient, STAGES);

    const entry = rawEntry(queryClient);
    // ONE page holding ONE flat list of cards from BOTH columns - not a per-column
    // shape, and not one cache entry per column.
    expect(entry?.pages).toHaveLength(1);
    expect(entry?.pages[0]?.leads.map((row) => row.id)).toEqual(['L1', 'L2', 'L9']);
    expect(handle.model?.leads.map((row) => row.id)).toEqual(['L1', 'L2', 'L9']);

    // And it really is the entry the move patches: a cross-column drop lands on it.
    await act(async () => {
      handle.move?.mutate({ leadId: 'L9', toStageId: 'S1', toIndex: 0 });
    });
    await flushReact();

    const patched = flattenLeadPages(rawEntry(queryClient));
    expect(leadsInStage(patched, 'S1').map((row) => row.id)).toEqual(['L9', 'L1', 'L2']);
    expect(leadsInStage(patched, 'S2')).toEqual([]);
  });

  it('does not share that entry with a differently filtered board', async () => {
    const queryClient = createQueryClient();
    await mountBoard(queryClient, STAGES, { sellerPersonId: 'p-7' });

    expect(rawEntry(queryClient, { sellerPersonId: 'p-7' })?.pages[0]?.leads).toHaveLength(3);
    expect(rawEntry(queryClient)).toBeUndefined();
    expect(rawEntry(queryClient, { sellerPersonId: 'p-OTHER' })).toBeUndefined();
  });

  it('continues per column on the next page, appending, and never re-asks an exhausted column', async () => {
    const queryClient = createQueryClient();
    const handle = await mountBoard(queryClient, STAGES);

    expect(handle.hasNextPage).toBe(true);
    expect(handle.model?.hasMore).toBe(true);

    await act(async () => {
      await handle.fetchNextPage();
    });
    await flushReact();

    const calls = requestedParams();
    // Three calls in total: S1 twice (page 1, then its own cursor) and S2 ONCE.
    expect(calls).toHaveLength(3);
    expect(calls.filter((params) => params.stageId === 'S2')).toHaveLength(1);
    expect(calls[2]).toMatchObject({ cursor: 'S1:c1', stageId: 'S1' });

    // APPENDED, not replaced: page one's cards are all still there.
    expect(rawEntry(queryClient)?.pages).toHaveLength(2);
    expect(handle.model?.leads.map((row) => row.id)).toEqual(['L1', 'L2', 'L9', 'L3']);
    // Every column exhausted, so the board stops offering more.
    expect(handle.model?.hasMore).toBe(false);
    expect(handle.hasNextPage).toBe(false);
  });

  it('carries the board filters into EVERY per-column request, on every page', async () => {
    const queryClient = createQueryClient();
    const handle = await mountBoard(queryClient, STAGES, { sellerPersonId: 'p-7' });

    await act(async () => {
      await handle.fetchNextPage();
    });
    await flushReact();

    const calls = requestedParams();
    expect(calls).toHaveLength(3);
    // Not `some`: a fan-out that dropped the filter for all but the first column
    // would serve one operator another operator's cards.
    for (const params of calls) {
      expect(params.sellerPersonId).toBe('p-7');
    }
    expect(calls.map((params) => params.stageId).sort()).toEqual(['S1', 'S1', 'S2']);
  });
});
