// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LeadsBoardContainer } from '../LeadsBoardContainer';
import type { SalesOpsLead, SalesOpsLeadStage } from '../types';

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;
const edition = vi.hoisted(() => ({ value: 'full' as 'full' | 'leads' }));
vi.mock('@/auth/react', () => ({
  useAccessToken: () => ({ getToken: async () => 'token' }),
  useSalesEdition: () => edition.value,
  useAuthProfile: () => ({ roles: ['admin'] }),
}));
const stage = (id: string, kind: SalesOpsLeadStage['kind'], position: number): SalesOpsLeadStage => ({
  id, orgId: 'org', name: id, kind, position, isSystem: kind !== 'normal', status: 'active',
  archivedAt: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: null,
});
const stages = [stage('new', 'normal', 0), stage('next', 'normal', 1), stage('lost', 'lost', 2), stage('converted', 'conversion', 3)];
const original: SalesOpsLead = {
  id: 'lead-1', stageId: 'new', position: 0, contactName: 'Ana', clientId: null,
  clientNameSnapshot: 'Acme', estimatedValueBrl: 100, description: 'Antes',
  contactPhone: '123', contactEmail: 'ana@example.com', contactBirthDate: null,
  sellerPersonId: null, sellerNameSnapshot: '', lostReason: null,
  stageChangedAt: '2026-01-01T00:00:00Z', saleId: null, saleStatus: null,
  saleCode: null, products: [{ productId: null, productNameSnapshot: 'Original item' }],
  createdAt: '2026-01-01T00:00:00Z', updatedAt: null,
};
let rows: SalesOpsLead[];
let calls: Array<{ path: string; method: string; body: Record<string, unknown> | null }>;
let failNext = false;
let gatedMove: Promise<ReturnType<typeof response>> | null;
let root: Root;
let host: HTMLDivElement;
const response = (status: number, data: unknown) => ({ ok: status < 400, status, json: async () => data });
const fetcher = async (input: string, init?: RequestInit) => {
  const url = new URL(String(input));
  const path = url.pathname;
  const method = init?.method ?? 'GET';
  const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
  if (method === 'GET' && path.endsWith('/lead-stages')) return response(200, { stages });
  if (method === 'GET' && path.endsWith('/leads/summary')) return response(200, {
    stages: stages.map((stage) => ({
      stageId: stage.id,
      count: rows.filter((row) => row.stageId === stage.id).length,
      estimatedValueBrl: rows.filter((row) => row.stageId === stage.id).reduce((sum, row) => sum + row.estimatedValueBrl, 0),
    })),
  });
  if (method === 'GET' && path.endsWith('/leads')) return response(200, { leads: rows.filter((row) => row.stageId === url.searchParams.get('stageId')), nextCursor: null });
  calls.push({ path, method, body });
  if (failNext) { failNext = false; return response(500, { error: 'internal' }); }
  if (path.endsWith('/move')) {
    if (gatedMove) return gatedMove;
    rows = rows.map((row) => row.id === original.id ? { ...row, stageId: String(body?.stageId), position: Number(body?.position), lostReason: body?.reason ? String(body.reason) : null, saleId: body?.saleId ? String(body.saleId) : null } : row);
    return response(200, { lead: rows.find((row) => row.id === original.id) });
  }
  if (method === 'PATCH') {
    rows = rows.map((row) => row.id === original.id ? {
      ...row, contactName: String(body?.contactName), description: body?.description as string | null,
      contactPhone: (body?.contactPhone ?? row.contactPhone) as string | null,
      products: Array.isArray(body?.products)
        ? body.products.map((product: { productId?: string; productName?: string }) => ({
            productId: product.productId ?? null,
            productNameSnapshot: product.productName ?? 'Original item',
          }))
        : row.products,
    } : row);
    return response(200, { lead: rows.find((row) => row.id === original.id) });
  }
  if (path.endsWith('/delete')) { rows = rows.filter((row) => row.id !== original.id); return response(204, null); }
  if (path.endsWith('/restore')) { rows = [...rows, { ...original }]; return response(200, { lead: original }); }
  return response(404, { error: 'not_found' });
};
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  edition.value = 'full'; rows = [{ ...original }]; calls = []; failNext = false;
  gatedMove = null;
  vi.stubGlobal('fetch', vi.fn(fetcher));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
async function settle() {
  await act(async () => {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(10);
    else await new Promise((resolve) => setTimeout(resolve, 10));
  });
}
async function render(onRequestConversion?: () => Promise<string | null>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><LeadsBoardContainer clients={[]} people={[]} products={[]} sellers={[]} onRequestConversion={onRequestConversion} /></MemoryRouter></QueryClientProvider>));
  await settle(); await settle();
}
async function click(selector: string | Element) {
  const node = typeof selector === 'string' ? document.querySelector(selector) : selector;
  if (!node) throw new Error(`Missing ${selector}`);
  await act(async () => node.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await settle();
}
async function pickStage(id: string) {
  const trigger = document.querySelector('[role="dialog"] [role="combobox"]');
  if (!trigger) throw new Error('Missing destination picker');
  await click(trigger);
  const option = [...document.querySelectorAll('[role="option"]')].find((node) => node.textContent?.trim() === id);
  if (!option) throw new Error(`Missing option ${id}`);
  await click(option);
}
async function moveTo(id: string) {
  await click('[data-view-option="list"]');
  await click('[data-move-trigger="lead-1"]');
  await pickStage(id);
  await click('[data-move-confirm]');
}

it('offers a persisted undo after delete and restores the card through HTTP', async () => {
  await render();
  expect(document.querySelector('[data-stage-column="new"] [data-stage-count]')?.textContent).toBe('1');
  const totalBefore = document.querySelector('[data-stage-column="new"] [data-stage-total]')?.textContent;
  const menu = document.querySelector('[data-lead-menu="lead-1"]');
  if (!menu) throw new Error('Missing menu');
  await act(async () => menu.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })));
  await click('[data-delete-lead="lead-1"]');
  await click('[data-confirm-delete]');
  expect(calls.some((call) => call.path.endsWith('/delete'))).toBe(true);
  expect(document.querySelector('[data-stage-column="new"] [data-stage-count]')?.textContent).toBe('0');
  expect(document.querySelector('[data-stage-column="new"] [data-stage-total]')?.textContent).not.toBe(totalBefore);
  expect(document.querySelector('[data-undo-notice]')?.textContent).toContain('Lead excluído');
  await click('[data-undo-action]');
  expect(calls.some((call) => call.path.endsWith('/restore'))).toBe(true);
  expect(document.querySelector('[data-lead-card="lead-1"]')).not.toBeNull();
  expect(document.querySelector('[data-stage-column="new"] [data-stage-count]')?.textContent).toBe('1');
  expect(document.querySelector('[data-stage-column="new"] [data-stage-total]')?.textContent).toBe(totalBefore);
});

it('undoes a Mover write with the original stage and index', async () => {
  await render();
  await moveTo('next');
  expect(calls[0]?.body).toMatchObject({ stageId: 'next', position: 0 });
  expect(document.querySelector('[data-undo-notice]')?.textContent).toContain('Lead movido');
  await click('[data-undo-action]');
  expect(calls[1]?.body).toMatchObject({ stageId: 'new', position: 0 });
  expect(rows[0]?.stageId).toBe('new');
});

it('uses the visible source index when returning a lead to a populated column', async () => {
  rows = [{ ...original, id: 'lead-0', position: 0, contactName: 'Bia' }, { ...original, position: 1 }];
  await render();
  await moveTo('next');
  await click('[data-undo-action]');
  expect(calls[1]?.body).toMatchObject({ stageId: 'new', position: 1 });
});

it('does not offer undo when the forward move fails', async () => {
  await render();
  failNext = true;
  await moveTo('next');
  expect(calls).toHaveLength(1);
  expect(document.querySelector('[data-undo-notice]')).toBeNull();
  expect(rows[0]?.stageId).toBe('new');
});

it('never offers undo for a sale creating conversion', async () => {
  await render(async () => 'sale-1');
  await moveTo('converted');
  expect(calls[0]?.body).toMatchObject({ stageId: 'converted', saleId: 'sale-1' });
  expect(document.querySelector('[data-undo-notice]')).toBeNull();
  expect(calls).toHaveLength(1);
});

it('restores the original lost reason through the inverse move', async () => {
  rows = [{ ...original, stageId: 'lost', lostReason: 'Sem orçamento' }];
  await render();
  await moveTo('next');
  await click('[data-undo-action]');
  expect(calls[1]?.body).toMatchObject({ stageId: 'lost', reason: 'Sem orçamento' });
});

it.each(['full', 'leads'] as const)('restores prior %s edition fields by inverse PATCH', async (mode) => {
  edition.value = mode;
  await render();
  await click('[data-view-option="list"]');
  await click('[data-edit-lead="lead-1"]');
  const input = document.querySelector('#lead-contact-name');
  if (!(input instanceof HTMLInputElement)) throw new Error('Missing contact field');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, 'Ana Nova');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  if (mode === 'full') await click('[aria-label="Remover Original item"]');
  await click('[data-lead-save]');
  expect(calls[0]?.method).toBe('PATCH');
  expect(document.querySelector('[data-undo-notice]')?.textContent).toContain('Lead editado');
  await click('[data-undo-action]');
  expect(calls[1]?.body).toMatchObject({ contactName: 'Ana', description: 'Antes' });
  if (mode === 'leads') expect(calls[1]?.body).toMatchObject({ contactPhone: '123', contactEmail: 'ana@example.com' });
  else {
    expect(calls[0]?.body).toMatchObject({ products: [] });
    expect(calls[1]?.body).toMatchObject({ products: [{ productName: 'Original item' }] });
    expect(rows[0]?.products).toEqual(original.products);
  }
});

it('reports an inverse failure without claiming restoration or sending a duplicate', async () => {
  await render();
  await moveTo('next');
  failNext = true;
  const action = document.querySelector('[data-undo-action]');
  if (!action) throw new Error('Missing undo action');
  await act(async () => {
    action.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    action.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await settle();
  expect(calls).toHaveLength(2);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Não foi possível desfazer');
  expect(rows[0]?.stageId).toBe('next');
});

it('keeps the action through a slow rejected inverse, then permits retry', async () => {
  await render();
  vi.useFakeTimers();
  await moveTo('next');
  await act(async () => { await vi.advanceTimersByTimeAsync(4900); });
  let rejectMove!: (value: ReturnType<typeof response>) => void;
  gatedMove = new Promise((resolve) => { rejectMove = resolve; });
  await click('[data-undo-action]');
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(document.querySelector('[data-undo-notice]')).not.toBeNull();
  expect((document.querySelector('[data-undo-action]') as HTMLButtonElement).disabled).toBe(true);
  gatedMove = null;
  await act(async () => rejectMove(response(500, { error: 'internal' })));
  await settle();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Tente novamente');
  expect((document.querySelector('[data-undo-action]') as HTMLButtonElement).disabled).toBe(false);
  await click('[data-undo-action]');
  expect(rows[0]?.stageId).toBe('new');
});

it('refuses a stale inverse move after another actor edits the lead', async () => {
  await render();
  await moveTo('next');
  rows = rows.map((row) => ({ ...row, contactName: 'Outro ator' }));
  await click('[data-undo-action]');
  expect(calls).toHaveLength(1);
  expect(rows[0]?.stageId).toBe('next');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('alterado');
});

it('refuses a stale inverse edit after another actor changes a writable field', async () => {
  await render();
  await click('[data-view-option="list"]');
  await click('[data-edit-lead="lead-1"]');
  await click('[data-lead-save]');
  expect(calls).toHaveLength(1);
  rows = rows.map((row) => ({ ...row, estimatedValueBrl: 999 }));
  await click('[data-undo-action]');
  expect(calls).toHaveLength(1);
  expect(rows[0]?.estimatedValueBrl).toBe(999);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('alterado');
});

it('expires the undo action after about five seconds', async () => {
  await render();
  vi.useFakeTimers();
  await moveTo('next');
  await act(async () => { await vi.advanceTimersByTimeAsync(4900); });
  expect(document.querySelector('[data-undo-notice]')).not.toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(document.querySelector('[data-undo-notice]')).toBeNull();
  expect(calls).toHaveLength(1);
});

it('clears its five second timer on unmount', async () => {
  await render();
  vi.useFakeTimers();
  const started = vi.spyOn(window, 'setTimeout');
  const cleared = vi.spyOn(window, 'clearTimeout');
  await moveTo('next');
  const timerIndex = started.mock.calls.findIndex((call) => call[1] === 5000);
  expect(timerIndex).toBeGreaterThanOrEqual(0);
  const timer = started.mock.results[timerIndex]?.value;
  await act(async () => root.unmount());
  expect(cleared).toHaveBeenCalledWith(timer);
  root = createRoot(host);
});

it('replaces an older action and starts a fresh five second window', async () => {
  await render();
  vi.useFakeTimers();
  await moveTo('next');
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  await moveTo('new');
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(document.querySelector('[data-undo-notice]')).not.toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
  expect(document.querySelector('[data-undo-notice]')).toBeNull();
  expect(calls).toHaveLength(2);
});
