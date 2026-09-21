import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '@/lib/query-keys';
import { leadsApi } from '../api';
import { leadsInStage } from '../calculations';
import { flattenLeadPages } from '../optimistic';
import type { LeadResponse, LeadsInfiniteData, SalesOpsLead } from '../types';
import { useMoveLead } from '../hooks';

vi.mock('@/auth/react', () => ({
  useAccessToken: () => ({ getToken: async () => 'test-token' }),
}));

vi.mock('../api', () => ({
  leadsApi: {
    moveLead: vi.fn(),
  },
}));

const ORIGINAL_STAMP = '2026-09-01T00:00:00.000Z';

type MoveLeadMutation = ReturnType<typeof useMoveLead>;

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
    saleCode: null,
    products: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  };
}

function seededBoard(): LeadsInfiniteData {
  return {
    pages: [
      {
        leads: [
          lead({ id: 'L1', stageId: 'S1', position: 0 }),
          lead({ id: 'L2', stageId: 'S1', position: 1 }),
          lead({ id: 'L3', stageId: 'S1', position: 2 }),
          lead({ id: 'L9', stageId: 'S2', position: 0 }),
        ],
        nextCursor: null,
      },
    ],
    pageParams: [null],
  };
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
}

function captureMoveLeadMutation(
  queryClient: QueryClient,
  filters?: { sellerPersonId?: string },
): MoveLeadMutation {
  let mutation: MoveLeadMutation | undefined;

  function CaptureMutation() {
    mutation = useMoveLead(filters);
    return null;
  }

  renderToString(
    createElement(QueryClientProvider, { client: queryClient }, createElement(CaptureMutation)),
  );

  if (!mutation) throw new Error('useMoveLead did not render');
  return mutation;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function column(queryClient: QueryClient, stageId: string, filters?: { sellerPersonId?: string }) {
  const cache = queryClient.getQueryData<LeadsInfiniteData>(queryKeys.leads.board(filters));
  return leadsInStage(flattenLeadPages(cache), stageId);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('useMoveLead', () => {
  it("restores the lead's exact previous index inside its own column when a reorder fails", async () => {
    const queryClient = createQueryClient();
    const deferred = createDeferred<LeadResponse>();
    vi.mocked(leadsApi.moveLead).mockReturnValueOnce(deferred.promise);
    queryClient.setQueryData(queryKeys.leads.board(undefined), seededBoard());

    const mutation = captureMoveLeadMutation(queryClient);
    const pending = mutation.mutateAsync({ leadId: 'L2', toStageId: 'S1', toIndex: 0 });

    await flushPromises();

    // The optimistic write really happened: a test that cannot see the write
    // cannot prove the rollback.
    expect(column(queryClient, 'S1').map((row) => row.id)).toEqual(['L2', 'L1', 'L3']);
    expect(column(queryClient, 'S1').map((row) => row.position)).toEqual([0, 1, 2]);

    deferred.reject(new Error('rejected by the api'));
    await expect(pending).rejects.toThrow('rejected by the api');
    await flushPromises();

    expect(column(queryClient, 'S1').map((row) => row.id)).toEqual(['L1', 'L2', 'L3']);
    expect(column(queryClient, 'S1').map((row) => row.position)).toEqual([0, 1, 2]);
    const moved = column(queryClient, 'S1').find((row) => row.id === 'L2');
    expect(moved?.stageId).toBe('S1');
    expect(moved?.stageChangedAt).toBe(ORIGINAL_STAMP);
  });

  it('restores the previous stage and the previous index when a cross-column move fails', async () => {
    const queryClient = createQueryClient();
    const deferred = createDeferred<LeadResponse>();
    vi.mocked(leadsApi.moveLead).mockReturnValueOnce(deferred.promise);
    queryClient.setQueryData(queryKeys.leads.board(undefined), seededBoard());

    const mutation = captureMoveLeadMutation(queryClient);
    const pending = mutation.mutateAsync({ leadId: 'L2', toStageId: 'S2', toIndex: 0 });

    await flushPromises();

    expect(column(queryClient, 'S1').map((row) => row.id)).toEqual(['L1', 'L3']);
    expect(column(queryClient, 'S2').map((row) => row.id)).toEqual(['L2', 'L9']);

    deferred.reject(new Error('rejected by the api'));
    await expect(pending).rejects.toThrow('rejected by the api');
    await flushPromises();

    expect(column(queryClient, 'S1').map((row) => row.id)).toEqual(['L1', 'L2', 'L3']);
    expect(column(queryClient, 'S1').map((row) => row.position)).toEqual([0, 1, 2]);
    // The DESTINATION column is restored too, not only the source.
    expect(column(queryClient, 'S2').map((row) => row.id)).toEqual(['L9']);
    expect(column(queryClient, 'S2').map((row) => row.position)).toEqual([0]);
    expect(column(queryClient, 'S1').find((row) => row.id === 'L2')?.stageChangedAt).toBe(
      ORIGINAL_STAMP,
    );
  });

  it('keeps the server row and drops nothing else when the move succeeds', async () => {
    const queryClient = createQueryClient();
    const deferred = createDeferred<LeadResponse>();
    vi.mocked(leadsApi.moveLead).mockReturnValueOnce(deferred.promise);
    queryClient.setQueryData(queryKeys.leads.board(undefined), seededBoard());

    const mutation = captureMoveLeadMutation(queryClient);
    const pending = mutation.mutateAsync({ leadId: 'L2', toStageId: 'S2', toIndex: 0 });

    await flushPromises();

    // The server disagreed with the client's optimistic index of 0.
    deferred.resolve({
      lead: lead({ id: 'L2', stageId: 'S2', position: 1, stageChangedAt: '2026-09-18T12:00:00.000Z' }),
    });
    await pending;
    await flushPromises();

    const all = flattenLeadPages(
      queryClient.getQueryData<LeadsInfiniteData>(queryKeys.leads.board(undefined)),
    );
    expect(all.find((row) => row.id === 'L2')?.position).toBe(1);
    expect(all.find((row) => row.id === 'L2')?.stageId).toBe('S2');
    for (const id of ['L1', 'L2', 'L3', 'L9']) {
      expect(all.filter((row) => row.id === id)).toHaveLength(1);
    }
  });

  it('invalidates the leads root on failure as well as on success', async () => {
    const queryClient = createQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const deferred = createDeferred<LeadResponse>();
    vi.mocked(leadsApi.moveLead).mockReturnValueOnce(deferred.promise);
    queryClient.setQueryData(queryKeys.leads.board(undefined), seededBoard());

    const mutation = captureMoveLeadMutation(queryClient);
    const pending = mutation.mutateAsync({ leadId: 'L2', toStageId: 'S1', toIndex: 0 });

    await flushPromises();
    deferred.reject(new Error('rejected by the api'));
    await expect(pending).rejects.toThrow('rejected by the api');
    await flushPromises();

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['leads'] });
  });

  it('never writes into the sales-ops cache entry', async () => {
    const queryClient = createQueryClient();
    const sentinel = { sales: [], marker: 'untouched' };
    queryClient.setQueryData(queryKeys.salesOps.bootstrap(), sentinel);
    queryClient.setQueryData(queryKeys.leads.board(undefined), seededBoard());

    const failing = createDeferred<LeadResponse>();
    vi.mocked(leadsApi.moveLead).mockReturnValueOnce(failing.promise);
    const mutation = captureMoveLeadMutation(queryClient);
    const rejected = mutation.mutateAsync({ leadId: 'L2', toStageId: 'S1', toIndex: 0 });
    await flushPromises();
    failing.reject(new Error('rejected by the api'));
    await expect(rejected).rejects.toThrow('rejected by the api');
    await flushPromises();

    const succeeding = createDeferred<LeadResponse>();
    vi.mocked(leadsApi.moveLead).mockReturnValueOnce(succeeding.promise);
    const accepted = mutation.mutateAsync({ leadId: 'L2', toStageId: 'S2', toIndex: 0 });
    await flushPromises();
    succeeding.resolve({ lead: lead({ id: 'L2', stageId: 'S2', position: 0 }) });
    await accepted;
    await flushPromises();

    expect(queryClient.getQueryData(queryKeys.salesOps.bootstrap())).toBe(sentinel);
  });

  it('patches the cache entry the board with the SAME filters is reading', async () => {
    const queryClient = createQueryClient();
    const filters = { sellerPersonId: 'p-1' };
    const deferred = createDeferred<LeadResponse>();
    vi.mocked(leadsApi.moveLead).mockReturnValueOnce(deferred.promise);
    queryClient.setQueryData(queryKeys.leads.board(filters), seededBoard());

    const mutation = captureMoveLeadMutation(queryClient, filters);
    const pending = mutation.mutateAsync({ leadId: 'L2', toStageId: 'S1', toIndex: 0 });
    await flushPromises();

    // Decisive against a hardcoded queryKeys.leads.board(undefined): the filtered
    // entry is the one the board renders, and it must be the one that is patched.
    expect(column(queryClient, 'S1', filters).map((row) => row.id)).toEqual(['L2', 'L1', 'L3']);
    expect(queryClient.getQueryData(queryKeys.leads.board(undefined))).toBeUndefined();

    deferred.reject(new Error('rejected by the api'));
    await expect(pending).rejects.toThrow('rejected by the api');
    await flushPromises();

    expect(column(queryClient, 'S1', filters).map((row) => row.id)).toEqual(['L1', 'L2', 'L3']);
  });
});
