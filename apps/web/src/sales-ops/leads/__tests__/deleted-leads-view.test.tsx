// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '@/lib/query-keys';
import { MUTATION_ERROR_COPY } from '../../mutation-error-copy';
import { DeletedLeadsContainer } from '../DeletedLeadsContainer';
import {
  DELETED_LEADS_COPY,
  restoreFailureKind,
  withoutDeletedLead,
  type DeletedLeadView,
  type DeletedLeadsPage,
} from '../deleted-leads';

/**
 * THE ORACLE of slice 04 (lead-lixeira): `Cadastros > Leads excluídos`.
 *
 * It drives the REAL container, hooks, HTTP client and view against a stubbed
 * `fetch` that behaves like the API (a restored lead leaves the server's trash),
 * so "restore calls the API and removes the row" is proven end to end.
 */

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

vi.mock('@/auth/react', () => ({
  useAccessToken: () => ({ getToken: async () => 'hub-access-token' }),
  useSalesEdition: () => 'full',
}));

const ID_A = 'a1a1a1a1-0000-4000-8000-000000000001';
const ID_B = 'b2b2b2b2-0000-4000-8000-000000000002';
const ID_C = 'c3c3c3c3-0000-4000-8000-000000000003';
const CURSOR = 'MjAyNi0xMC0wNlQwMjoxNTowMC4wMDBafGIyYjI';

const ROW_A: DeletedLeadView = {
  id: ID_A,
  contactName: 'Ana Souza',
  clientName: 'Construbom',
  stageName: 'Primeiro contato',
  sellerName: 'Alex Silva',
  estimatedValueBrl: 150000,
  deletedAt: '2026-10-07T18:30:00.000Z',
  deletedByName: 'Gestora Paula',
};
/** No empresa, no vendedor, unknown author, and a UTC day ahead of São Paulo. */
const ROW_B: DeletedLeadView = {
  id: ID_B,
  contactName: 'Bruno Lima',
  clientName: '',
  stageName: 'Negociação',
  sellerName: '',
  estimatedValueBrl: 0,
  deletedAt: '2026-10-06T02:15:00.000Z',
  deletedByName: null,
};
const ROW_C: DeletedLeadView = {
  id: ID_C,
  contactName: 'Carla Dias',
  clientName: 'Obra Leste',
  stageName: 'Proposta',
  sellerName: 'Alex Silva',
  estimatedValueBrl: 990000,
  deletedAt: '2026-10-01T12:00:00.000Z',
  deletedByName: 'Gestora Paula',
};

type Responder = { status: number; body: unknown };

const server = {
  /** The trash as the API holds it, newest first. */
  rows: [] as DeletedLeadView[],
  /** Page size the stub serves before handing back `CURSOR`. */
  firstPageSize: 2,
  restoreAnswer: { status: 200, body: { lead: {} } } as Responder,
  /** When set, the first page GET waits for it. */
  holdList: null as Promise<void> | null,
  /** When set, the restore POST waits for it. */
  holdRestore: null as Promise<void> | null,
  listAnswer: null as Responder | null,
};

function respond(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

let fetchMock: ReturnType<typeof vi.fn>;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  server.rows = [ROW_A, ROW_B, ROW_C];
  server.firstPageSize = 2;
  server.restoreAnswer = { status: 200, body: { lead: {} } };
  server.holdList = null;
  server.holdRestore = null;
  server.listAnswer = null;
  fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const method = init?.method ?? 'GET';
    if (method === 'GET' && url.pathname === '/api/v1/sales-ops/leads/deleted') {
      if (server.holdList) await server.holdList;
      if (server.listAnswer) return respond(server.listAnswer.status, server.listAnswer.body);
      const cursor = url.searchParams.get('cursor');
      const page: DeletedLeadsPage =
        cursor === null
          ? {
              items: server.rows.slice(0, server.firstPageSize),
              nextCursor: server.rows.length > server.firstPageSize ? CURSOR : null,
            }
          : { items: server.rows.slice(server.firstPageSize), nextCursor: null };
      return respond(200, page);
    }
    const restore = /^\/api\/v1\/sales-ops\/leads\/([^/]+)\/restore$/.exec(url.pathname);
    if (method === 'POST' && restore) {
      if (server.holdRestore) await server.holdRestore;
      if (server.restoreAnswer.status === 200) {
        server.rows = server.rows.filter((row) => row.id !== restore[1]);
      }
      return respond(server.restoreAnswer.status, server.restoreAnswer.body);
    }
    return respond(404, { error: 'not_found' });
  });
  vi.stubGlobal('fetch', fetchMock);
});

let container: HTMLDivElement;
let root: Root | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  container?.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function LocationProbe() {
  const { pathname } = useLocation();
  return <output data-testid="location-path">{pathname}</output>;
}

async function flush(times = 4) {
  for (let index = 0; index < times; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function renderScreen() {
  container = document.createElement('div');
  document.body.append(container);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
          initialEntries={['/cadastros/leads-excluidos']}
        >
          <Routes>
            <Route element={<DeletedLeadsContainer />} path="/cadastros/leads-excluidos" />
            <Route element={<div data-etapas-screen />} path="/cadastros/etapas" />
          </Routes>
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await flush();
}

const rows = () => [...container.querySelectorAll('[data-deleted-lead-row]')];
const rowText = (name: string) =>
  rows().find((row) => row.textContent?.includes(name))?.textContent ?? null;
function restoreButtonFor(name: string): HTMLButtonElement {
  const row = rows().find((candidate) => candidate.textContent?.includes(name));
  const button = row?.querySelector<HTMLButtonElement>('[data-restore-lead]');
  if (!button) throw new Error(`no Restaurar for ${name}`);
  return button;
}
const callsTo = (method: string, pathname: string) =>
  fetchMock.mock.calls.filter(
    ([url, init]) =>
      new URL(String(url)).pathname === pathname &&
      ((init as RequestInit | undefined)?.method ?? 'GET') === method,
  );

describe('Leads excluídos: data layer', () => {
  it('pins the trash query key under the leads root', () => {
    expect(queryKeys.leads.deleted()).toEqual(['leads', 'deleted']);
  });

  it('classifies a refused restore by status, plus the no_open_stage reason', () => {
    expect(restoreFailureKind({ status: 400, reason: 'no_open_stage' })).toBe('no_open_stage');
    expect(restoreFailureKind({ status: 400, reason: 'validation_error' })).toBe('banner');
    expect(restoreFailureKind({ status: 404 })).toBe('gone');
    expect(restoreFailureKind({ status: 403, reason: 'admin_role_required' })).toBe('banner');
    expect(restoreFailureKind(new Error('network'))).toBe('banner');
    expect(restoreFailureKind(null)).toBe('banner');
  });

  it('drops a restored lead from every cached page', () => {
    const data = {
      pages: [
        { items: [ROW_A, ROW_B], nextCursor: CURSOR },
        { items: [ROW_C], nextCursor: null },
      ],
      pageParams: [null, CURSOR],
    };
    expect(withoutDeletedLead(data, ID_C)?.pages.map((page) => page.items)).toEqual([
      [ROW_A, ROW_B],
      [],
    ]);
    expect(withoutDeletedLead(undefined, ID_A)).toBeUndefined();
  });
});

describe('Leads excluídos: the screen', () => {
  it('renders a loading skeleton while the first page is in flight', async () => {
    const gate = deferred();
    server.holdList = gate.promise;
    await renderScreen();
    expect(container.querySelector('[data-deleted-leads-loading]')).not.toBeNull();
    expect(container.querySelector('[data-deleted-leads-table]')).toBeNull();
    gate.resolve();
    await flush();
    expect(container.querySelector('[data-deleted-leads-loading]')).toBeNull();
    expect(rows()).toHaveLength(2);
  });

  it('asks for the first page with the bearer token and limit 50', async () => {
    await renderScreen();
    const [first] = callsTo('GET', '/api/v1/sales-ops/leads/deleted');
    if (!first) throw new Error('no list request');
    const url = new URL(String(first[0]));
    expect(url.searchParams.get('limit')).toBe('50');
    expect(url.searchParams.has('cursor')).toBe(false);
    expect(((first[1] as RequestInit).headers as Record<string, string>).Authorization).toBe(
      'Bearer hub-access-token',
    );
  });

  it('renders the six columns and one row per deleted lead', async () => {
    await renderScreen();
    const headers = [...container.querySelectorAll('th')].map((th) => th.textContent?.trim());
    expect(headers).toEqual([
      'Lead',
      'Empresa',
      'Etapa',
      'Vendedor',
      'Excluído por',
      'Excluído em',
      'Ações',
    ]);
    expect(rows()).toHaveLength(2);
    const a = rowText('Ana Souza') ?? '';
    for (const part of ['Construbom', 'Primeiro contato', 'Alex Silva', 'Gestora Paula']) {
      expect(a).toContain(part);
    }
  });

  it('formats Excluído em as the São Paulo wall clock, never the raw ISO', async () => {
    await renderScreen();
    expect(rowText('Ana Souza')).toContain('07/10/2026 às 15:30');
    // 02:15Z on the 6th is still the 5th in São Paulo.
    expect(rowText('Bruno Lima')).toContain('05/10/2026 às 23:15');
    expect(container.textContent).not.toContain('2026-10-06T02:15');
  });

  it('falls back to Autor não identificado, Sem vendedor and a dash', async () => {
    await renderScreen();
    const b = rowText('Bruno Lima') ?? '';
    expect(b).toContain(DELETED_LEADS_COPY.unknownAuthor);
    expect(b).toContain(DELETED_LEADS_COPY.noSeller);
    expect(b).toContain(DELETED_LEADS_COPY.noValue);
  });

  it('never renders an id or a cursor anywhere in the DOM', async () => {
    await renderScreen();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-deleted-leads-more]')?.click();
    });
    await flush();
    expect(rows()).toHaveLength(3);
    for (const secret of [ID_A, ID_B, ID_C, CURSOR]) {
      expect(container.innerHTML).not.toContain(secret);
    }
  });

  it('restore posts to the restore action and removes the row', async () => {
    await renderScreen();
    await act(async () => restoreButtonFor('Ana Souza').click());
    await flush();
    const posts = callsTo('POST', `/api/v1/sales-ops/leads/${ID_A}/restore`);
    expect(posts).toHaveLength(1);
    expect((posts[0]?.[1] as RequestInit).body).toBeUndefined();
    expect(rowText('Ana Souza')).toBeNull();
    expect(rowText('Bruno Lima')).not.toBeNull();
    expect(container.querySelector('[data-restore-success]')?.textContent).toBe(
      DELETED_LEADS_COPY.restored('Ana Souza'),
    );
  });

  it('shows the pending state on the row and blocks a second restore while one is in flight', async () => {
    const gate = deferred();
    server.holdRestore = gate.promise;
    await renderScreen();
    await act(async () => restoreButtonFor('Ana Souza').click());
    expect(restoreButtonFor('Ana Souza').textContent).toContain(DELETED_LEADS_COPY.restoring);
    expect(restoreButtonFor('Ana Souza').disabled).toBe(true);
    expect(restoreButtonFor('Bruno Lima').disabled).toBe(true);
    expect(restoreButtonFor('Bruno Lima').textContent).toContain(DELETED_LEADS_COPY.restore);
    gate.resolve();
    await flush();
    expect(rowText('Ana Souza')).toBeNull();
    expect(restoreButtonFor('Bruno Lima').disabled).toBe(false);
  });

  it('400 no_open_stage keeps the row and sends the gestor to Etapas do funil', async () => {
    server.restoreAnswer = {
      status: 400,
      body: { error: 'validation_error', reason: 'no_open_stage' },
    };
    await renderScreen();
    await act(async () => restoreButtonFor('Ana Souza').click());
    await flush();
    const notice = container.querySelector('[data-restore-no-stage]');
    expect(notice?.textContent).toContain(DELETED_LEADS_COPY.noOpenStage);
    expect(rowText('Ana Souza')).not.toBeNull();
    expect(container.querySelector('[data-mutation-error]')).toBeNull();
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-go-to-stages]')?.click(),
    );
    await flush();
    expect(container.querySelector('[data-testid="location-path"]')?.textContent).toBe(
      '/cadastros/etapas',
    );
  });

  it('403 renders the inline MutationErrorBanner, never the ForbiddenPanel', async () => {
    server.restoreAnswer = {
      status: 403,
      body: { error: 'forbidden', reason: 'admin_role_required' },
    };
    await renderScreen();
    await act(async () => restoreButtonFor('Ana Souza').click());
    await flush();
    expect(container.querySelector('[data-mutation-error]')?.textContent).toContain(
      MUTATION_ERROR_COPY.adminRequired,
    );
    expect(container.querySelector('[data-forbidden]')).toBeNull();
    expect(rowText('Ana Souza')).not.toBeNull();
  });

  it('404 says the lead already left the trash', async () => {
    server.restoreAnswer = { status: 404, body: { error: 'not_found' } };
    await renderScreen();
    await act(async () => restoreButtonFor('Ana Souza').click());
    await flush();
    expect(container.querySelector('[data-restore-gone]')?.textContent).toBe(
      DELETED_LEADS_COPY.gone,
    );
    expect(container.querySelector('[data-mutation-error]')).toBeNull();
  });

  it('renders the empty state when nothing was deleted', async () => {
    server.rows = [];
    await renderScreen();
    expect(container.querySelector('[data-deleted-leads-empty]')?.textContent).toContain(
      DELETED_LEADS_COPY.emptyTitle,
    );
    expect(container.querySelector('[data-deleted-leads-table]')).toBeNull();
    expect(container.querySelector('[data-deleted-leads-more]')).toBeNull();
  });

  it('Carregar mais fetches the next keyset page with the cursor and appends it', async () => {
    await renderScreen();
    expect(rows().map((row) => row.querySelector('td')?.textContent)).toEqual([
      'Ana Souza',
      'Bruno Lima',
    ]);
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-deleted-leads-more]')?.click(),
    );
    await flush();
    const lists = callsTo('GET', '/api/v1/sales-ops/leads/deleted');
    const last = new URL(String(lists.at(-1)?.[0]));
    expect(last.searchParams.get('cursor')).toBe(CURSOR);
    expect(last.searchParams.get('limit')).toBe('50');
    expect(rows().map((row) => row.querySelector('td')?.textContent)).toEqual([
      'Ana Souza',
      'Bruno Lima',
      'Carla Dias',
    ]);
    expect(container.querySelector('[data-deleted-leads-more]')).toBeNull();
  });

  it('a refused READ renders the ForbiddenPanel', async () => {
    server.listAnswer = { status: 403, body: { error: 'forbidden' } };
    await renderScreen();
    expect(container.querySelector('[data-forbidden]')).not.toBeNull();
    expect(container.querySelector('[data-deleted-leads-table]')).toBeNull();
  });
});
