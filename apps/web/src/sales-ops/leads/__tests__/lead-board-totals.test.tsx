// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { formatMoneyBrl } from '../../calculations';
import { deleteLead } from '../api';
import { LOAD_MORE_LABEL, buildLabelLookups, loadMoreLabel } from '../board-labels';
import {
  aggregatesFromLeads,
  aggregatesFromSummary,
  buildCumulativeFunnel,
  buildLeadFunnel,
  resolveStageAggregates,
  stageAggregate,
  sumStageAggregates,
} from '../calculations';
import { useRestoreLead } from '../deleted-leads';
import {
  leadStageSummaryKey,
  useDeleteLead,
  useLeadStageSummary,
  useMoveLead,
  useSaveLead,
} from '../hooks';
import { LeadsBoard } from '../LeadsBoard';
import { LeadsBoardContainer } from '../LeadsBoardContainer';
import {
  summaryWithLeadMoved,
  summaryWithLeadRemoved,
  summaryWithPendingMove,
} from '../optimistic';
import type {
  LeadBoardFilters,
  LeadStageSummary,
  LeadsInfiniteData,
  SalesOpsLead,
  SalesOpsLeadStage,
} from '../types';

/**
 * AC11 of lead-lixeira: the board's counts, R$ totals, shares, Lista chips,
 * Funil and load-more label read the server's per-stage summary
 * (`GET /leads/summary`), not the cards that happen to be loaded.
 *
 * Three layers: the pure aggregates and summary patches; the presentational
 * `LeadsBoard` over a summary larger than the loaded cards; and the real
 * `LeadsBoardContainer` plus hooks over a mocked `apiFetch` (the only seam, with
 * the auth context).
 */

vi.mock('@/auth/react', () => ({
  useAccessToken: () => ({ getToken: async () => 'test-token' }),
  useSalesEdition: () => 'full',
  useAuthProfile: () => ({
    isLoaded: true,
    isSignedIn: true,
    roles: ['admin', 'seller'],
    name: 'Gestor',
    email: 'gestor@example.com',
  }),
}));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiFetch: vi.fn(),
}));

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;
const mockedApiFetch = vi.mocked(apiFetch);

const NOVO = 'cccccccc-0000-4000-8000-000000000001';
const QUAL = 'cccccccc-0000-4000-8000-000000000002';
const PROPOSTA = 'cccccccc-0000-4000-8000-000000000003';
const PERDIDO = 'cccccccc-0000-4000-8000-000000000004';
const ARCHIVED = 'cccccccc-0000-4000-8000-0000000000aa';
const NOW = new Date('2026-09-21T12:00:00.000Z');

function stage(
  id: string,
  name: string,
  kind: SalesOpsLeadStage['kind'],
  position: number,
): SalesOpsLeadStage {
  return {
    id,
    name,
    kind,
    position,
    status: 'active',
    isSystem: kind !== 'normal',
    archivedAt: null,
    orgId: 'org-1',
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: null,
  };
}

function lead(
  id: string,
  stageId: string,
  value: number,
  patch: Partial<SalesOpsLead> = {},
): SalesOpsLead {
  return {
    id,
    stageId,
    position: 1,
    contactName: `Contato ${id}`,
    clientId: null,
    clientNameSnapshot: 'Acme',
    estimatedValueBrl: value,
    description: null,
    contactPhone: null,
    contactEmail: null,
    contactBirthDate: null,
    sellerPersonId: null,
    sellerNameSnapshot: 'Marina Souza',
    lostReason: null,
    stageChangedAt: '2026-09-15T12:00:00.000Z',
    saleId: null,
    saleStatus: null,
    saleCode: null,
    products: [],
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: null,
    ...patch,
  } as SalesOpsLead;
}

const brl0 = (cents: number) =>
  formatMoneyBrl(cents, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const STAGES: SalesOpsLeadStage[] = [
  stage(NOVO, 'Novo', 'normal', 1),
  stage(QUAL, 'Qualificado', 'normal', 2),
  stage(PROPOSTA, 'Proposta', 'conversion', 3),
  stage(PERDIDO, 'Perdido', 'lost', 4),
];

const L1 = lead('l1', NOVO, 100_000, { position: 1 });
const L2 = lead('l2', NOVO, 200_000, { position: 2 });
const L3 = lead('l3', QUAL, 300_000);
const LOADED = [L1, L2, L3];

const SUMMARY: LeadStageSummary = {
  stages: [
    { stageId: NOVO, count: 115, estimatedValueBrl: 11_500_000 },
    { stageId: QUAL, count: 7, estimatedValueBrl: 2_100_000 },
    { stageId: PERDIDO, count: 3, estimatedValueBrl: 600_000 },
    { stageId: ARCHIVED, count: 9, estimatedValueBrl: 900_000 },
  ],
};

const LOOKUPS = buildLabelLookups({ clients: [], people: [], products: [] });

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function waitFor(check: () => boolean, label: string) {
  for (let round = 0; round < 50; round += 1) {
    if (check()) return;
    await flush();
  }
  throw new Error(`timed out waiting for ${label}`);
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
}

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  queryClient = createQueryClient();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = '';
  queryClient.clear();
  vi.clearAllMocks();
  mockedApiFetch.mockReset();
});

/* ------------------------------------------------------------------ pure -- */

describe('per-stage aggregates (pure)', () => {
  it('reads a server summary into per-stage aggregates, a missing stage reading zero', () => {
    const map = aggregatesFromSummary(SUMMARY);
    expect(stageAggregate(map, NOVO)).toEqual({ count: 115, totalBrl: 11_500_000 });
    expect(stageAggregate(map, PROPOSTA)).toEqual({ count: 0, totalBrl: 0 });
  });

  it('resolves to the summary when present and to the loaded leads otherwise', () => {
    const withSummary = resolveStageAggregates(SUMMARY, LOADED);
    expect(withSummary.fromServer).toBe(true);
    expect(stageAggregate(withSummary.aggregates, NOVO).count).toBe(115);

    const without = resolveStageAggregates(undefined, LOADED);
    expect(without.fromServer).toBe(false);
    expect(stageAggregate(without.aggregates, NOVO)).toEqual({ count: 2, totalBrl: 300_000 });

    const stub = resolveStageAggregates({} as unknown as LeadStageSummary, LOADED);
    expect(stub.fromServer).toBe(false);
  });

  it('never shows a stage fewer leads than its loaded cards, whatever a stale summary says', () => {
    // A fresh create: the cards are in hand, the summary refetch has not landed.
    const stale: LeadStageSummary = {
      stages: [
        { stageId: NOVO, count: 1, estimatedValueBrl: 100_000 },
        { stageId: QUAL, count: 7, estimatedValueBrl: 2_100_000 },
      ],
    };
    const { aggregates, fromServer } = resolveStageAggregates(stale, LOADED);
    expect(fromServer).toBe(true);
    // Novo: 2 loaded > 1 summarised, so the loaded figure wins for that stage only.
    expect(stageAggregate(aggregates, NOVO)).toEqual({ count: 2, totalBrl: 300_000 });
    // Qualificado: the summary is larger than the loaded 1, so the summary wins.
    expect(stageAggregate(aggregates, QUAL)).toEqual({ count: 7, totalBrl: 2_100_000 });
    // A stage the summary lacks entirely but with loaded cards reads the cards, not 0.
    const missing = resolveStageAggregates({ stages: [] }, LOADED);
    expect(stageAggregate(missing.aggregates, NOVO).count).toBe(2);
  });

  it('sums only the stages it is given, so an archived stage never reaches a board total', () => {
    expect(sumStageAggregates(STAGES, aggregatesFromSummary(SUMMARY))).toEqual({
      count: 125,
      totalBrl: 14_200_000,
    });
  });

  it('builds both funnel shapes from aggregates, so 115 leads read 115 with none loaded', () => {
    const aggregates = aggregatesFromSummary(SUMMARY);
    const composition = buildLeadFunnel(aggregates, STAGES);
    expect(composition.rows.map((r) => [r.name, r.count, r.totalBrl, r.share])).toEqual([
      ['Novo', 115, 11_500_000, 81],
      ['Qualificado', 7, 2_100_000, 15],
      ['Proposta', 0, 0, 0],
      ['Perdido', 3, 600_000, 4],
    ]);
    expect(composition.totalCount).toBe(125);
    expect(composition.totalBrl).toBe(14_200_000);

    const cumulative = buildCumulativeFunnel(aggregates, STAGES);
    expect(cumulative.rows.map((r) => [r.name, r.count, r.totalBrl])).toEqual([
      ['Novo', 122, 13_600_000],
      ['Qualificado', 7, 2_100_000],
      ['Proposta', 0, 0],
    ]);
    expect(cumulative.lost).toEqual({
      stageId: PERDIDO,
      name: 'Perdido',
      count: 3,
      totalBrl: 600_000,
    });
    expect(cumulative.topCount).toBe(122);
    // The accumulation never wrote into the caller's map.
    expect(stageAggregate(aggregates, NOVO).count).toBe(115);
  });
});

describe('summary patches (pure)', () => {
  it('moves one lead count and value from the source stage to the destination, creating the destination row', () => {
    const next = summaryWithLeadMoved(SUMMARY, L1, PROPOSTA);
    expect(next.stages.find((r) => r.stageId === NOVO)).toEqual({
      stageId: NOVO,
      count: 114,
      estimatedValueBrl: 11_400_000,
    });
    expect(next.stages.find((r) => r.stageId === PROPOSTA)).toEqual({
      stageId: PROPOSTA,
      count: 1,
      estimatedValueBrl: 100_000,
    });
    for (const id of [QUAL, PERDIDO, ARCHIVED]) {
      expect(next.stages.find((r) => r.stageId === id)).toBe(
        SUMMARY.stages.find((r) => r.stageId === id),
      );
    }
  });

  it('returns the identical summary for a reorder inside one column and for a body that is not a summary', () => {
    expect(summaryWithLeadMoved(SUMMARY, L1, NOVO)).toBe(SUMMARY);
    const stub = {} as unknown as LeadStageSummary;
    expect(summaryWithLeadMoved(stub, L1, QUAL)).toBe(stub);
    expect(summaryWithLeadRemoved(stub, L1)).toBe(stub);
  });

  it('removes one lead from its stage and never goes below zero', () => {
    const removed = summaryWithLeadRemoved(SUMMARY, L1);
    expect(removed.stages.find((r) => r.stageId === NOVO)).toEqual({
      stageId: NOVO,
      count: 114,
      estimatedValueBrl: 11_400_000,
    });
    const empty: LeadStageSummary = {
      stages: [{ stageId: NOVO, count: 0, estimatedValueBrl: 0 }],
    };
    expect(summaryWithLeadRemoved(empty, L1).stages[0]).toEqual({
      stageId: NOVO,
      count: 0,
      estimatedValueBrl: 0,
    });
    const noRow: LeadStageSummary = { stages: [] };
    expect(summaryWithLeadRemoved(noRow, L1)).toBe(noRow);
  });

  it('applies a pending conversion through the same move primitive', () => {
    const pending = { leadId: 'l1', toStageId: PROPOSTA, toIndex: 0 };
    expect(summaryWithPendingMove(SUMMARY, LOADED, pending)).toEqual(
      summaryWithLeadMoved(SUMMARY, L1, PROPOSTA),
    );
    expect(summaryWithPendingMove(SUMMARY, LOADED, null)).toBe(SUMMARY);
    expect(summaryWithPendingMove(undefined, LOADED, pending)).toBeUndefined();
    expect(summaryWithPendingMove(SUMMARY, LOADED, { ...pending, leadId: 'nope' })).toBe(SUMMARY);
  });
});

describe('load more label', () => {
  it('shows loaded of total only when the server total is known and larger', () => {
    expect(loadMoreLabel(100, 115)).toBe('Carregar mais leads (100 de 115)');
    expect(loadMoreLabel(100, null)).toBe(LOAD_MORE_LABEL);
    expect(loadMoreLabel(115, 115)).toBe(LOAD_MORE_LABEL);
    expect(loadMoreLabel(120, 115)).toBe(LOAD_MORE_LABEL);
    for (const label of [loadMoreLabel(100, 115), LOAD_MORE_LABEL]) {
      expect(label).not.toContain(String.fromCharCode(0x2014));
    }
  });
});

/* ----------------------------------------------------------------- board -- */

async function renderBoard(props: Partial<React.ComponentProps<typeof LeadsBoard>> = {}) {
  await act(async () => {
    root.render(
      <LeadsBoard
        hasMore
        leads={LOADED}
        lookups={LOOKUPS}
        now={NOW}
        onMoveLead={vi.fn()}
        stageSummary={SUMMARY}
        stages={STAGES}
        {...props}
      />,
    );
  });
}

const column = (id: string) =>
  container.querySelector<HTMLElement>(`[data-stage-column="${id}"]`) as HTMLElement;
const countOf = (id: string) => column(id).querySelector('[data-stage-count]')?.textContent;

async function click(selector: string) {
  const node = container.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`not rendered: ${selector}`);
  await act(async () => {
    node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

describe('LeadsBoard reads the summary, not the loaded cards', () => {
  it('takes the column badge, R$ total, % do total and bar from the summary while only the loaded cards render', async () => {
    await renderBoard();
    expect([NOVO, QUAL, PROPOSTA, PERDIDO].map(countOf)).toEqual(['115', '7', '0', '3']);
    expect(column(NOVO).querySelector('[data-stage-total]')?.textContent).toBe(brl0(11_500_000));
    const width = (id: string) =>
      column(id).querySelector<HTMLElement>('[data-stage-bar]')?.style.width;
    expect([NOVO, QUAL, PROPOSTA, PERDIDO].map(width)).toEqual(['81%', '15%', '0%', '4%']);
    expect(column(NOVO).textContent).toContain('81% do total');
    expect(column(NOVO).querySelectorAll('[data-lead-card]')).toHaveLength(2);
  });

  it('takes the Lista chips and footer from the summary while the table lists the loaded rows', async () => {
    await renderBoard();
    await click('[data-view-option="list"]');
    const all = container.querySelector('[data-phase-chip=""]') as HTMLElement;
    expect(all.textContent).toContain(brl0(14_200_000));
    expect(all.querySelector('[data-phase-count]')?.textContent).toBe('125');
    const novo = container.querySelector(`[data-phase-chip="${NOVO}"]`) as HTMLElement;
    expect(novo.textContent).toContain(brl0(11_500_000));
    expect(novo.querySelector('[data-phase-count]')?.textContent).toBe('115');
    const proposta = container.querySelector(`[data-phase-chip="${PROPOSTA}"]`) as HTMLElement;
    expect(proposta.querySelector('[data-phase-count]')?.textContent).toBe('0');
    expect(container.querySelector('[data-list-total]')?.textContent).toBe(brl0(14_200_000));
    expect(container.querySelector('[data-leads-list]')?.textContent).toContain(
      'Todas as fases · 125 leads',
    );
    expect(container.querySelectorAll('[data-list-row]')).toHaveLength(3);

    await click(`[data-phase-chip="${NOVO}"]`);
    expect(container.querySelector('[data-leads-list]')?.textContent).toContain('Novo · 115 leads');
    expect(container.querySelector('[data-list-total]')?.textContent).toBe(brl0(11_500_000));
    expect(container.querySelectorAll('[data-list-row]')).toHaveLength(2);
  });

  it('takes both Funil shapes and their footer grand totals from the summary in both metrics', async () => {
    await renderBoard();
    await click('[data-view-option="funnel"]');
    const row = (id: string) => container.querySelector(`[data-funnel-row="${id}"]`) as HTMLElement;
    const text = (id: string, part: string) => row(id).querySelector(part)?.textContent ?? '';

    expect(text(NOVO, '[data-funnel-primary]')).toContain(brl0(13_600_000));
    expect(text(NOVO, '[data-funnel-secondary]')).toContain('122 leads');
    expect(text(NOVO, '[data-funnel-share]')).toBe('100% do topo');
    expect(text(QUAL, '[data-funnel-share]')).toBe('15% do topo');
    expect((row(QUAL).querySelector('[data-funnel-bar]') as HTMLElement).style.width).toBe('15%');
    const aside = container.querySelector('[data-funnel-lost]')?.textContent ?? '';
    expect(aside).toContain('Perdido');
    expect(aside).toContain('3 leads');
    expect(aside).toContain(brl0(600_000));
    expect(container.querySelector('[data-funnel-grand-count]')?.textContent).toBe('125 leads');
    expect(container.querySelector('[data-funnel-grand-total]')?.textContent).toContain(
      brl0(14_200_000),
    );

    await click('[data-funnel-shape-option="composition"]');
    expect(text(NOVO, '[data-funnel-primary]')).toContain(brl0(11_500_000));
    expect(text(NOVO, '[data-funnel-share]')).toBe('81% do total');
    expect(text(PERDIDO, '[data-funnel-share]')).toBe('4% do total');
    expect(container.querySelector('[data-funnel-grand-count]')?.textContent).toBe('125 leads');

    await click('[data-funnel-metric-option="volume"]');
    expect(text(NOVO, '[data-funnel-primary]')).toBe('115 leads');
    await click('[data-funnel-shape-option="cumulative"]');
    expect(text(NOVO, '[data-funnel-primary]')).toBe('122 leads');
  });

  it('falls back to the loaded cards when there is no summary, never to 0', async () => {
    await renderBoard({ stageSummary: undefined });
    expect(countOf(NOVO)).toBe('2');
    expect(countOf(QUAL)).toBe('1');
    expect(column(NOVO).querySelector('[data-stage-total]')?.textContent).toBe(brl0(300_000));
    expect(container.querySelector('[data-load-more]')?.textContent).toBe(LOAD_MORE_LABEL);
  });

  it('treats a body without a stages array as no summary', async () => {
    await renderBoard({ stageSummary: {} as unknown as LeadStageSummary });
    expect(countOf(NOVO)).toBe('2');
    expect(countOf(QUAL)).toBe('1');
  });

  it('never shows a column fewer leads than it has loaded cards when the summary is stale', async () => {
    const stale: LeadStageSummary = {
      stages: [{ stageId: QUAL, count: 7, estimatedValueBrl: 2_100_000 }],
    };
    await renderBoard({ stageSummary: stale });
    // Novo has two loaded cards the summary has not heard of yet.
    expect(countOf(NOVO)).toBe('2');
    expect(column(NOVO).querySelector('[data-stage-total]')?.textContent).toBe(brl0(300_000));
    expect(countOf(QUAL)).toBe('7');
  });

  it('labels Carregar mais leads with loaded of total', async () => {
    await renderBoard();
    expect(container.querySelector('[data-load-more]')?.textContent).toBe(
      'Carregar mais leads (3 de 125)',
    );
    await renderBoard({ hasMore: false });
    expect(container.querySelector('[data-load-more]')).toBeNull();
  });

  it('keeps a 3-digit count from shrinking and the share label from wrapping', async () => {
    await renderBoard();
    const badge = column(NOVO).querySelector('[data-stage-count]') as HTMLElement;
    for (const name of ['shrink-0', 'whitespace-nowrap', 'tabular-nums', 'min-w-[24px]']) {
      expect(badge.classList.contains(name)).toBe(true);
    }
    const share = [...column(NOVO).querySelectorAll('span')].find(
      (node) => node.textContent === '81% do total',
    ) as HTMLElement;
    expect(share.classList.contains('shrink-0')).toBe(true);
    expect(share.classList.contains('whitespace-nowrap')).toBe(true);

    await click('[data-view-option="list"]');
    const chipCount = container.querySelector(
      `[data-phase-chip="${NOVO}"] [data-phase-count]`,
    ) as HTMLElement;
    expect(chipCount.classList.contains('tabular-nums')).toBe(true);
    expect(chipCount.classList.contains('min-w-[20px]')).toBe(true);
  });
});

/* ------------------------------------------------------------- container -- */

const C_STAGES = [
  stage(NOVO, 'Novo', 'normal', 1),
  stage(QUAL, 'Qualificado', 'normal', 2),
  stage(PROPOSTA, 'Proposta', 'conversion', 3),
];

let summaryHandler: () => Promise<unknown> | unknown;

function novoLead(index: number): SalesOpsLead {
  return lead(`n${index}`, NOVO, 10_000, { position: index });
}

function routeApi(path: string, init?: { method?: string }): unknown {
  const method = init?.method ?? 'GET';
  if (method === 'GET' && path === '/api/v1/sales-ops/lead-stages') return { stages: C_STAGES };
  if (method === 'GET' && path.startsWith('/api/v1/sales-ops/leads/summary')) {
    return summaryHandler();
  }
  if (method === 'GET' && path.startsWith('/api/v1/sales-ops/leads?')) {
    const query = new URLSearchParams(path.split('?')[1]);
    if (query.get('stageId') !== NOVO) return { leads: [], nextCursor: null };
    if (query.get('cursor') === 'c1') {
      return {
        leads: Array.from({ length: 15 }, (_, i) => novoLead(100 + i)),
        nextCursor: null,
      };
    }
    return { leads: Array.from({ length: 100 }, (_, i) => novoLead(i)), nextCursor: 'c1' };
  }
  throw new Error(`unexpected ${method} ${path}`);
}

async function renderContainer() {
  mockedApiFetch.mockImplementation(((path: string, init?: { method?: string }) =>
    Promise.resolve().then(() => routeApi(path, init))) as unknown as typeof apiFetch);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/operacional/leads']}>
          <LeadsBoardContainer clients={[]} people={[]} products={[]} sellers={[]} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
}

const novoCards = () => column(NOVO)?.querySelectorAll('[data-lead-card]').length ?? 0;
const loadMore = () => container.querySelector('[data-load-more]');

describe('LeadsBoardContainer over the real hooks', () => {
  beforeEach(() => {
    summaryHandler = () => ({
      stages: [{ stageId: NOVO, count: 115, estimatedValueBrl: 1_150_000 }],
    });
  });

  it('reads 115 with 100 loaded and says Carregar mais leads (100 de 115)', async () => {
    await renderContainer();
    await waitFor(() => novoCards() === 100, '100 cards');
    await waitFor(() => countOf(NOVO) === '115', 'summary badge');
    expect(column(NOVO).querySelector('[data-stage-total]')?.textContent).toBe(brl0(1_150_000));
    expect(loadMore()?.textContent).toBe('Carregar mais leads (100 de 115)');
  });

  it('loading the last page keeps the badge at 115 and removes the button', async () => {
    await renderContainer();
    await waitFor(() => novoCards() === 100 && loadMore() !== null, 'first page');
    await click('[data-load-more]');
    await waitFor(() => novoCards() === 115, '115 cards');
    expect(countOf(NOVO)).toBe('115');
    expect(loadMore()).toBeNull();
  });

  it('shows the loaded numbers while the summary is in flight, then the server numbers', async () => {
    const deferred = createDeferred<LeadStageSummary>();
    summaryHandler = () => deferred.promise;
    await renderContainer();
    await waitFor(() => novoCards() === 100, '100 cards');
    expect(countOf(NOVO)).toBe('100');
    expect(loadMore()?.textContent).toBe(LOAD_MORE_LABEL);
    deferred.resolve({ stages: [{ stageId: NOVO, count: 115, estimatedValueBrl: 1_150_000 }] });
    await waitFor(() => countOf(NOVO) === '115', 'server badge');
    expect(loadMore()?.textContent).toBe('Carregar mais leads (100 de 115)');
  });

  it('keeps the loaded numbers and shows no error when the summary fails', async () => {
    summaryHandler = () => Promise.reject({ status: 500, error: 'request_failed' });
    await renderContainer();
    await waitFor(() => novoCards() === 100, '100 cards');
    await flush();
    expect(countOf(NOVO)).toBe('100');
    expect(loadMore()?.textContent).toBe(LOAD_MORE_LABEL);
    expect(container.textContent).not.toContain('Não foi possível carregar o funil de leads.');
  });

  it('asks for the summary once, with no query string when the board has no filter', async () => {
    await renderContainer();
    await waitFor(() => novoCards() === 100, '100 cards');
    const summaryCalls = mockedApiFetch.mock.calls.filter(([path]) =>
      String(path).startsWith('/api/v1/sales-ops/leads/summary'),
    );
    expect(summaryCalls).toHaveLength(1);
    expect(summaryCalls[0]).toEqual([
      '/api/v1/sales-ops/leads/summary',
      { method: 'GET', token: 'test-token' },
    ]);
  });
});

/* ----------------------------------------------------------------- hooks -- */

type Handle<T> = { current: T | null };

async function mountHook<T>(useHook: () => T): Promise<Handle<T>> {
  const handle: Handle<T> = { current: null };
  function Probe() {
    handle.current = useHook();
    return null;
  }
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>,
    );
  });
  return handle;
}

describe('useLeadStageSummary', () => {
  it('keys on leadStageSummaryKey(filters) and sends sellerPersonId only when the filter has one', async () => {
    expect(leadStageSummaryKey(undefined)).toEqual(['leads', 'summary', null]);
    expect(leadStageSummaryKey(undefined)).toEqual(queryKeys.leads.summary(undefined));
    expect(leadStageSummaryKey({ sellerPersonId: 'p-7' })).toEqual([
      'leads',
      'summary',
      { sellerPersonId: 'p-7' },
    ]);

    const body = { stages: [{ stageId: NOVO, count: 1, estimatedValueBrl: 5 }] };
    mockedApiFetch.mockResolvedValue(body);
    for (const filters of [undefined, { sellerPersonId: 'p-7' }] as LeadBoardFilters[]) {
      await mountHook(() => useLeadStageSummary(filters));
      await flush();
      expect(queryClient.getQueryData(leadStageSummaryKey(filters))).toEqual(body);
    }
    expect(mockedApiFetch.mock.calls.map(([path]) => path)).toEqual([
      '/api/v1/sales-ops/leads/summary',
      '/api/v1/sales-ops/leads/summary?sellerPersonId=p-7',
    ]);
  });
});

function seededBoard(): LeadsInfiniteData {
  return {
    pages: [
      {
        leads: [
          lead('L1', 'S1', 100_000, { position: 0 }),
          lead('L2', 'S1', 200_000, { position: 1 }),
          lead('L9', 'S2', 300_000, { position: 0 }),
        ],
        nextCursor: null,
      },
    ],
    pageParams: [null],
  };
}

function seededSummary(): LeadStageSummary {
  return {
    stages: [
      { stageId: 'S1', count: 40, estimatedValueBrl: 4_000_000 },
      { stageId: 'S2', count: 9, estimatedValueBrl: 900_000 },
    ],
  };
}

const summaryRow = (filters: LeadBoardFilters, stageId: string) =>
  queryClient
    .getQueryData<LeadStageSummary>(leadStageSummaryKey(filters))
    ?.stages.find((row) => row.stageId === stageId);

function seed(filters: LeadBoardFilters, withBoard = true): LeadStageSummary {
  const summary = seededSummary();
  queryClient.setQueryData(leadStageSummaryKey(filters), summary);
  if (withBoard) queryClient.setQueryData(queryKeys.leads.board(filters), seededBoard());
  return summary;
}

describe('optimistic summary on move', () => {
  it('shifts the paired summary entry in the same tick as the card and restores it exactly on failure', async () => {
    const seeded = seed(undefined);
    const deferred = createDeferred<unknown>();
    mockedApiFetch.mockReturnValueOnce(deferred.promise as never);
    const handle = await mountHook(() => useMoveLead(undefined));
    const pending = handle.current!.mutateAsync({ leadId: 'L1', toStageId: 'S2', toIndex: 0 });
    await flush();
    expect(summaryRow(undefined, 'S1')).toEqual({
      stageId: 'S1',
      count: 39,
      estimatedValueBrl: 3_900_000,
    });
    expect(summaryRow(undefined, 'S2')).toEqual({
      stageId: 'S2',
      count: 10,
      estimatedValueBrl: 1_000_000,
    });
    deferred.reject(new Error('rejected'));
    await expect(pending).rejects.toThrow('rejected');
    await flush();
    // Deep-equal, not `toBe`: setQueryData's structural sharing rebuilds the root object.
    expect(queryClient.getQueryData(leadStageSummaryKey(undefined))).toEqual(seeded);
  });

  it('keeps the shifted summary on success and leaves it invalidated for the refetch', async () => {
    seed(undefined);
    mockedApiFetch.mockResolvedValueOnce({
      lead: lead('L1', 'S2', 100_000, { position: 0 }),
    } as never);
    const handle = await mountHook(() => useMoveLead(undefined));
    await handle.current!.mutateAsync({ leadId: 'L1', toStageId: 'S2', toIndex: 0 });
    await flush();
    expect(summaryRow(undefined, 'S1')?.count).toBe(39);
    expect(summaryRow(undefined, 'S2')?.count).toBe(10);
    expect(queryClient.getQueryState(leadStageSummaryKey(undefined))?.isInvalidated).toBe(true);
  });

  it('patches only the summary entry paired with the board filters', async () => {
    const filters = { sellerPersonId: 'p-1' };
    seed(filters);
    const other = seed(undefined, false);
    const deferred = createDeferred<unknown>();
    mockedApiFetch.mockReturnValueOnce(deferred.promise as never);
    const handle = await mountHook(() => useMoveLead(filters));
    void handle.current!.mutateAsync({ leadId: 'L1', toStageId: 'S2', toIndex: 0 }).catch(() => {});
    await flush();
    expect(summaryRow(filters, 'S1')?.count).toBe(39);
    expect(queryClient.getQueryData(leadStageSummaryKey(undefined))).toBe(other);
    deferred.reject(new Error('end'));
    await flush();
  });

  it('leaves the summary untouched for a reorder inside one column', async () => {
    const seeded = seed(undefined);
    const deferred = createDeferred<unknown>();
    mockedApiFetch.mockReturnValueOnce(deferred.promise as never);
    const handle = await mountHook(() => useMoveLead(undefined));
    void handle.current!.mutateAsync({ leadId: 'L2', toStageId: 'S1', toIndex: 0 }).catch(() => {});
    await flush();
    expect(queryClient.getQueryData(leadStageSummaryKey(undefined))).toBe(seeded);
    deferred.reject(new Error('end'));
    await flush();
  });

  it('still moves the card when no summary is cached', async () => {
    queryClient.setQueryData(queryKeys.leads.board(undefined), seededBoard());
    const deferred = createDeferred<unknown>();
    mockedApiFetch.mockReturnValueOnce(deferred.promise as never);
    const handle = await mountHook(() => useMoveLead(undefined));
    void handle.current!.mutateAsync({ leadId: 'L1', toStageId: 'S2', toIndex: 0 }).catch(() => {});
    await flush();
    const board = queryClient.getQueryData<LeadsInfiniteData>(queryKeys.leads.board(undefined));
    expect(board?.pages[0]?.leads.find((row) => row.id === 'L1')?.stageId).toBe('S2');
    expect(queryClient.getQueryData(leadStageSummaryKey(undefined))).toBeUndefined();
    deferred.reject(new Error('end'));
    await flush();
  });
});

describe('optimistic summary on delete', () => {
  it('decrements every summary paired with a board that held the lead and restores them exactly on failure', async () => {
    const filters = { sellerPersonId: 'p-1' };
    const a = seed(undefined);
    const b = seed(filters);
    const deferred = createDeferred<unknown>();
    mockedApiFetch.mockReturnValueOnce(deferred.promise as never);
    const handle = await mountHook(() => useDeleteLead());
    const pending = handle.current!.mutateAsync('L1');
    await flush();
    for (const f of [undefined, filters]) {
      expect(summaryRow(f, 'S1')).toEqual({ stageId: 'S1', count: 39, estimatedValueBrl: 3_900_000 });
      expect(summaryRow(f, 'S2')?.count).toBe(9);
    }
    deferred.reject(new Error('rejected'));
    await expect(pending).rejects.toThrow('rejected');
    await flush();
    // Deep-equal, not `toBe`: setQueryData's structural sharing rebuilds the root object.
    expect(queryClient.getQueryData(leadStageSummaryKey(undefined))).toEqual(a);
    expect(queryClient.getQueryData(leadStageSummaryKey(filters))).toEqual(b);
  });

  it('leaves a summary whose board never held the lead untouched', async () => {
    seed(undefined);
    const otherFilters = { sellerPersonId: 'p-2' };
    queryClient.setQueryData(queryKeys.leads.board(otherFilters), {
      pages: [{ leads: [lead('L9', 'S2', 300_000, { position: 0 })], nextCursor: null }],
      pageParams: [null],
    });
    const other = seededSummary();
    queryClient.setQueryData(leadStageSummaryKey(otherFilters), other);
    const deferred = createDeferred<unknown>();
    mockedApiFetch.mockReturnValueOnce(deferred.promise as never);
    const handle = await mountHook(() => useDeleteLead());
    void handle.current!.mutateAsync('L1').catch(() => {});
    await flush();
    expect(summaryRow(undefined, 'S1')?.count).toBe(39);
    expect(queryClient.getQueryData(leadStageSummaryKey(otherFilters))).toBe(other);
    deferred.reject(new Error('end'));
    await flush();
  });
});

describe('every lead write invalidates the summary', () => {
  const FILTERED = { sellerPersonId: 'p-7' };

  function seedBoth() {
    seed(undefined);
    queryClient.setQueryData(leadStageSummaryKey(FILTERED), seededSummary());
  }

  function expectInvalidated() {
    for (const f of [undefined, FILTERED]) {
      expect(queryClient.getQueryState(leadStageSummaryKey(f))?.isInvalidated).toBe(true);
    }
  }

  it('create invalidates the summary', async () => {
    seedBoth();
    mockedApiFetch.mockResolvedValueOnce({ lead: lead('L1', 'S1', 0) } as never);
    const handle = await mountHook(() => useSaveLead());
    await handle.current!.mutateAsync({ contactName: 'Nova', clientName: 'Acme' } as never);
    await flush();
    expectInvalidated();
  });

  it('update invalidates the summary', async () => {
    seedBoth();
    mockedApiFetch.mockResolvedValueOnce({ lead: lead('L1', 'S1', 0) } as never);
    const handle = await mountHook(() => useSaveLead());
    await handle.current!.mutateAsync({
      id: 'L1',
      contactName: 'Nova',
      clientName: 'Acme',
    } as never);
    await flush();
    expectInvalidated();
  });

  it('a successful move invalidates the summary', async () => {
    seedBoth();
    mockedApiFetch.mockResolvedValueOnce({ lead: lead('L1', 'S2', 100_000) } as never);
    const handle = await mountHook(() => useMoveLead(undefined));
    await handle.current!.mutateAsync({ leadId: 'L1', toStageId: 'S2', toIndex: 0 });
    await flush();
    expectInvalidated();
  });

  it('a failed move invalidates the summary', async () => {
    seedBoth();
    mockedApiFetch.mockRejectedValueOnce(new Error('nope'));
    const handle = await mountHook(() => useMoveLead(undefined));
    await expect(
      handle.current!.mutateAsync({ leadId: 'L1', toStageId: 'S2', toIndex: 0 }),
    ).rejects.toThrow('nope');
    await flush();
    expectInvalidated();
  });

  it('delete invalidates the summary', async () => {
    seedBoth();
    mockedApiFetch.mockResolvedValueOnce(undefined as never);
    const handle = await mountHook(() => useDeleteLead());
    await handle.current!.mutateAsync('L1');
    await flush();
    expectInvalidated();
    expect(deleteLead).toBeTypeOf('function');
  });

  it('restore invalidates the summary', async () => {
    seedBoth();
    mockedApiFetch.mockResolvedValueOnce({ lead: lead('L1', 'S1', 0) } as never);
    const handle = await mountHook(() => useRestoreLead());
    await handle.current!.mutateAsync('L1');
    await flush();
    expectInvalidated();
  });
});

describe('aggregatesFromLeads', () => {
  it('is the loaded-cards fallback: count and value per stage', () => {
    expect(aggregatesFromLeads(LOADED).get(NOVO)).toEqual({ count: 2, totalBrl: 300_000 });
  });
});
