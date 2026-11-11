// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '@/lib/query-keys';
import { MUTATION_ERROR_COPY } from '../../mutation-error-copy';
import { LeadsBoardContainer } from '../LeadsBoardContainer';
import { STAGE_DELETE_COPY, stageDeleteTypedMatches } from '../stage-delete-copy';
import type { SalesOpsLead, SalesOpsLeadStage } from '../types';
import { pipelineFixtureFor } from './pipeline-fixture';

/**
 * THE WHOLE-ETAPA DELETE ORACLE (web slice of the lote feature).
 *
 * It drives the REAL container, hooks, board, dialog and `apiFetch` against a
 * stubbed global `fetch` that behaves like the API: the column header action is
 * there for an administrator and for nobody else, the dialog names the etapa and
 * shows the SERVER's count, Confirmar stays off until that exact count is typed,
 * and a refusal stays inside the dialog.
 */

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

const mocks = vi.hoisted(() => ({
  roles: ['admin', 'seller'] as string[],
}));

vi.mock('@/auth/react', () => ({
  useAccessToken: () => ({ getToken: async () => 'hub-access-token' }),
  useSalesEdition: () => 'full',
  useAuthProfile: () => ({
    isLoaded: true,
    isSignedIn: true,
    roles: mocks.roles,
    name: 'Gestor',
    email: 'gestor@example.com',
  }),
}));

const NOVO_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const LISTA_ID = 'aaaaaaaa-0000-4000-8000-000000000002';
const BATCH_ID = 'dddddddd-0000-4000-8000-000000000004';

function stage(id: string, name: string, position: number): SalesOpsLeadStage {
  return {
    id,
    orgId: 'org-a',
    name,
    position,
    kind: 'normal',
    isSystem: false,
    status: 'active',
    archivedAt: null,
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: null,
  };
}

const STAGES = [stage(NOVO_ID, 'Novo', 1), stage(LISTA_ID, 'Lista de Clientes', 2)];

type FakeResponse = { ok: boolean; status: number; json: () => Promise<unknown> };
function json(status: number, body: unknown): FakeResponse {
  return { ok: status < 400, status, json: async () => body };
}

type Call = { method: string; path: string; auth: string | null };
let calls: Call[];
let previewAnswer: { status: number; body: unknown };
let deleteAnswer: { status: number; body: unknown };

function route(input: string, init?: RequestInit): Promise<FakeResponse> {
  const url = new URL(String(input));
  const method = (init?.method ?? 'GET').toUpperCase();
  const path = url.pathname.replace('/api/v1/sales-ops', '');
  if (path === '/pipelines') return Promise.resolve(json(200, pipelineFixtureFor(STAGES)));
  if (path === '/lead-stages') return Promise.resolve(json(200, { stages: STAGES }));
  if (method === 'GET' && path === '/leads') {
    return Promise.resolve(json(200, { leads: [] as SalesOpsLead[], nextCursor: null }));
  }
  const preview = /^\/leads\/stages\/([^/]+)\/delete-all-preview$/.exec(path);
  if (method === 'GET' && preview) {
    calls.push({ method, path, auth: new Headers(init?.headers).get('Authorization') });
    return Promise.resolve(json(previewAnswer.status, previewAnswer.body));
  }
  const del = /^\/leads\/stages\/([^/]+)\/delete-all$/.exec(path);
  if (method === 'POST' && del) {
    calls.push({ method, path, auth: new Headers(init?.headers).get('Authorization') });
    return Promise.resolve(json(deleteAnswer.status, deleteAnswer.body));
  }
  return Promise.resolve(json(404, { error: 'not_found' }));
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  mocks.roles = ['admin', 'seller'];
  calls = [];
  previewAnswer = {
    status: 200,
    body: { stageName: 'Lista de Clientes', deletableCount: 1700, skippedConvertedCount: 3 },
  };
  deleteAnswer = {
    status: 200,
    body: { batchId: BATCH_ID, deletedCount: 1700, skippedConvertedCount: 3 },
  };
  vi.stubGlobal('fetch', vi.fn(route));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function settle(times = 3) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

async function renderContainer() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
          initialEntries={['/operacional/leads']}
        >
          <Routes>
            <Route
              element={<LeadsBoardContainer clients={[]} people={[]} products={[]} sellers={[]} />}
              path="/operacional/leads"
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await settle();
}

const query = (selector: string) => document.querySelector(selector);
function required<T extends Element = HTMLElement>(selector: string): T {
  const node = query(selector);
  if (!node) throw new Error(`not found: ${selector}`);
  return node as unknown as T;
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await settle(1);
}

async function typeInto(target: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(target, value);
    target.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle(1);
}

async function openDialog() {
  await click(required(`[data-delete-stage-leads="${LISTA_ID}"]`));
  await settle();
}

const confirmButton = () => required<HTMLButtonElement>('[data-confirm-stage-delete]');
const dialog = () => query('[data-stage-delete-dialog]');

describe('stageDeleteTypedMatches', () => {
  it('accepts the exact count, tolerates separators and refuses everything else', () => {
    expect(stageDeleteTypedMatches('1700', 1700)).toBe(true);
    expect(stageDeleteTypedMatches(' 1.700 ', 1700)).toBe(true);
    expect(stageDeleteTypedMatches('170', 1700)).toBe(false);
    expect(stageDeleteTypedMatches('17000', 1700)).toBe(false);
    expect(stageDeleteTypedMatches('abc1700', 1700)).toBe(false);
    expect(stageDeleteTypedMatches('', 1700)).toBe(false);
    expect(stageDeleteTypedMatches('0', 0)).toBe(false);
    expect(stageDeleteTypedMatches('', 0)).toBe(false);
  });

  it('pins the preview query key under the leads root', () => {
    expect(queryKeys.leads.stageDeletePreview(LISTA_ID)).toEqual([
      'leads',
      'stage-delete-preview',
      LISTA_ID,
    ]);
  });
});

describe('Excluir todos os leads desta etapa: who sees it', () => {
  it('shows the action in every column header for an administrator', async () => {
    await renderContainer();
    for (const id of [NOVO_ID, LISTA_ID]) {
      const button = required(`[data-delete-stage-leads="${id}"]`);
      expect(button.closest(`[data-stage-column="${id}"]`)).not.toBeNull();
      expect(button.getAttribute('aria-label')).toContain(STAGE_DELETE_COPY.action);
    }
  });

  it('never shows it to a vendedor', async () => {
    mocks.roles = ['seller'];
    await renderContainer();
    expect(query('[data-stage-column]')).not.toBeNull();
    expect(query('[data-delete-stage-leads]')).toBeNull();
  });
});

describe('Excluir todos os leads desta etapa: the dialog', () => {
  it('names the etapa and the server count, and writes nothing on open', async () => {
    await renderContainer();
    await openDialog();
    expect(dialog()).not.toBeNull();
    expect(required('[data-stage-delete-stage]').textContent).toBe(
      STAGE_DELETE_COPY.stageLine('Lista de Clientes'),
    );
    expect(required('[data-stage-delete-count]').textContent).toBe(STAGE_DELETE_COPY.countLine(1700));
    expect(required('[data-stage-delete-skipped]').textContent).toBe(STAGE_DELETE_COPY.skippedLine(3));
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      `GET /leads/stages/${LISTA_ID}/delete-all-preview`,
    ]);
    expect(calls[0]?.auth).toBe('Bearer hub-access-token');
    expect(dialog()?.innerHTML).not.toContain(LISTA_ID);
  });

  it('keeps Confirmar off until the exact count is typed', async () => {
    await renderContainer();
    await openDialog();
    expect(confirmButton().disabled).toBe(true);
    const input = required<HTMLInputElement>('[data-stage-delete-input]');
    await typeInto(input, '170');
    expect(confirmButton().disabled).toBe(true);
    await typeInto(input, '17000');
    expect(confirmButton().disabled).toBe(true);
    await click(confirmButton());
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
    await typeInto(input, '1700');
    expect(confirmButton().disabled).toBe(false);
  });

  it('posts once after the count is typed, closes, and tells how many went', async () => {
    await renderContainer();
    await openDialog();
    await typeInto(required<HTMLInputElement>('[data-stage-delete-input]'), '1700');
    await click(confirmButton());
    await settle();
    const posts = calls.filter((call) => call.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.path).toBe(`/leads/stages/${LISTA_ID}/delete-all`);
    expect(posts[0]?.auth).toBe('Bearer hub-access-token');
    expect(dialog()).toBeNull();
    expect(required('[data-stage-delete-done]').textContent).toContain(
      STAGE_DELETE_COPY.done('Lista de Clientes', 1700),
    );
    expect(document.body.innerHTML).not.toContain(BATCH_ID);
  });

  it('keeps a refusal inside the open dialog and never renders the ForbiddenPanel', async () => {
    deleteAnswer = { status: 403, body: { error: 'forbidden', reason: 'admin_role_required' } };
    await renderContainer();
    await openDialog();
    await typeInto(required<HTMLInputElement>('[data-stage-delete-input]'), '1700');
    await click(confirmButton());
    await settle();
    expect(dialog()).not.toBeNull();
    expect(required('[data-stage-delete-error]').textContent).toBe(MUTATION_ERROR_COPY.adminRequired);
    expect(query('[data-forbidden]')).toBeNull();
    expect(query('[data-stage-delete-done]')).toBeNull();
    expect(confirmButton().disabled).toBe(false);
  });

  it('offers nothing to confirm when the etapa has no deletable lead', async () => {
    previewAnswer = {
      status: 200,
      body: { stageName: 'Lista de Clientes', deletableCount: 0, skippedConvertedCount: 2 },
    };
    await renderContainer();
    await openDialog();
    expect(required('[data-stage-delete-count]').textContent).toBe(STAGE_DELETE_COPY.nothingToDelete);
    expect(query('[data-stage-delete-input]')).toBeNull();
    expect(confirmButton().disabled).toBe(true);
  });

  it('says so when the count cannot be read, and still cannot confirm', async () => {
    previewAnswer = { status: 500, body: { error: 'internal' } };
    await renderContainer();
    await openDialog();
    expect(query('[data-stage-delete-preview-error]')).not.toBeNull();
    expect(query('[data-stage-delete-input]')).toBeNull();
    expect(confirmButton().disabled).toBe(true);
  });
});
