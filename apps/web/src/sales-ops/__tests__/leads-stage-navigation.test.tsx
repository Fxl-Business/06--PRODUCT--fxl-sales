// @vitest-environment happy-dom
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeadSidebarNavigation } from '../leads/LeadSidebarNavigation';
import { LeadsBoardContainer } from '../leads/LeadsBoardContainer';
import { buildLeadFunnelPath, buildLeadStagePath, getSalesOpsNavigation, resolveSalesOpsRoute } from '../navigation';
import type { SalesOpsLead, SalesOpsLeadStage } from '../leads/types';

const query = vi.hoisted(() => ({
  data: [] as SalesOpsLeadStage[],
  leads: [] as SalesOpsLead[],
  isPending: false,
  isError: false,
}));
const mutation = { isPending: false, mutate: vi.fn(), mutateAsync: vi.fn() };
vi.mock('../leads/hooks', () => ({
  useLeadStages: () => query,
  useLeadsBoard: () => ({ data: { leads: query.leads, hasMore: false }, isPending: false, isError: false, isFetchingNextPage: false, fetchNextPage: vi.fn() }),
  useLeadStageSummary: () => ({ data: undefined }),
  useMoveLead: () => mutation,
  useSaveLead: () => mutation,
  useDeleteLead: () => mutation,
}));
let roles: Array<'admin' | 'seller' | 'finder'> = ['admin'];
vi.mock('@/auth/react', () => ({
  useAuthProfile: () => ({ roles }),
  useSalesEdition: () => 'full',
}));

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;
let container: HTMLDivElement;
let root: Root | null;
function LocationProbe() {
  return <output data-path>{useLocation().pathname}</output>;
}
function RoutedLeads() {
  const params = useParams();
  const resolution = resolveSalesOpsRoute(params, roles);
  if (resolution.redirect) return <Navigate replace to={resolution.path} />;
  const { route } = resolution;
  if (route.view !== 'leads' && route.view !== 'funil') return <div data-other-view />;
  return <>
    <LeadSidebarNavigation activeStageId={route.stageId} collapsed={false} onExpand={vi.fn()} workspace={route.workspace} />
    <LeadsBoardContainer clients={[]} people={[]} products={[]} routedMode={route.view === 'funil' ? 'board' : 'stage'} selectedStageId={route.stageId} sellers={[]} showSellerFilter={route.workspace === 'operacional'} workspace={route.workspace} />
  </>;
}
async function renderRouted(path: string, nextRoles: typeof roles) {
  roles = nextRoles;
  root = createRoot(container);
  await act(async () => root?.render(
    <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }} initialEntries={[path]}>
      <Routes><Route element={<RoutedLeads />} path="/:workspace/:view/:saleId?" /></Routes>
      <LocationProbe />
    </MemoryRouter>,
  ));
}
async function renderSidebar(activeStageId?: string, collapsed = false) {
  root = createRoot(container);
  await act(async () => root?.render(
    <MemoryRouter initialEntries={['/operacional/funil']}>
      <LeadSidebarNavigation activeStageId={activeStageId} collapsed={collapsed} onExpand={vi.fn()} workspace="operacional" />
      <LocationProbe />
    </MemoryRouter>,
  ));
}
const group = () => container.querySelector<HTMLButtonElement>('button[aria-label="Prospecção"]')!;
const stageLinks = () => [...container.querySelectorAll<HTMLButtonElement>('[data-lead-stage-navigation] button')];
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = null;
  const stage = (id: string, name: string, status: SalesOpsLeadStage['status'], position: number): SalesOpsLeadStage => ({
    id, name, status, position, kind: 'normal', isSystem: false, archivedAt: status === 'archived' ? '2026-09-01T00:00:00.000Z' : null,
    orgId: 'org-1', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: null,
  });
  query.data = [stage('lost', 'Perdido', 'active', 3), stage('draft', 'Contato', 'active', 1), stage('archived', 'Antigo', 'archived', 0), stage('won', 'Convertido', 'active', 2)];
  const lead = (id: string, stageId: string): SalesOpsLead => ({
    id, stageId, position: 1, contactName: `Contato ${id}`, clientId: null, clientNameSnapshot: 'Acme', estimatedValueBrl: 100_000,
    description: null, contactPhone: null, contactEmail: null, contactBirthDate: null, sellerPersonId: null,
    sellerNameSnapshot: 'Marina', lostReason: null, stageChangedAt: '2026-09-15T00:00:00.000Z', saleId: null,
    saleStatus: null, saleCode: null, products: [], createdAt: '2026-09-01T00:00:00.000Z', updatedAt: null,
  });
  query.leads = [lead('a', 'draft'), lead('b', 'lost')];
  query.isPending = false;
  query.isError = false;
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container.remove();
});

describe('routed lead stages', () => {
  it('uses stable stage ids and redirects legacy lead URLs to the full Kanban', () => {
    expect(buildLeadStagePath('operacional', 'stage/a')).toBe('/operacional/leads/stage%2Fa');
    expect(buildLeadFunnelPath('meus-dados')).toBe('/meus-dados/funil');
    expect(resolveSalesOpsRoute({ workspace: 'operacional', view: 'leads' }, ['admin']).path).toBe('/operacional/funil');
    expect(resolveSalesOpsRoute({ workspace: 'meus-dados', view: 'leads', saleId: 'stage-2' }, ['seller']).route).toEqual({ workspace: 'meus-dados', view: 'leads', stageId: 'stage-2' });
    expect(resolveSalesOpsRoute({ workspace: 'meus-dados', view: 'funil' }, ['finder']).route.view).not.toBe('funil');
    expect(resolveSalesOpsRoute({ workspace: 'operacional', view: 'vendas', saleId: 'sale-1' }, ['admin']).route.saleId).toBe('sale-1');
    expect(getSalesOpsNavigation('operacional', ['admin']).map((item) => item.id)).toEqual(['vendas', 'comissoes', 'leads', 'funil']);
    expect(getSalesOpsNavigation('operacional', ['admin'], 'leads').map((item) => item.id)).toEqual(['leads', 'funil']);
  });

  it('keeps the active group open, orders active stages, and follows a stage click', async () => {
    await renderSidebar('draft');
    expect(group().getAttribute('aria-expanded')).toBe('true');
    expect(stageLinks().map((link) => link.textContent)).toEqual(['Contato', 'Convertido', 'Perdido']);
    expect(stageLinks()[0]?.getAttribute('aria-current')).toBe('page');
    await act(async () => stageLinks()[1]?.click());
    expect(container.querySelector('[data-path]')?.textContent).toBe('/operacional/leads/won');
  });

  it('keeps bookmarks stable after renaming a stage', async () => {
    query.data[1] = { ...query.data[1]!, name: 'Primeiro contato' };
    await renderSidebar('draft');
    expect(stageLinks()[0]?.textContent).toBe('Primeiro contato');
    await act(async () => stageLinks()[0]?.click());
    expect(container.querySelector('[data-path]')?.textContent).toBe('/operacional/leads/draft');
  });

  it.each(['loading', 'empty', 'error'] as const)('shows the %s state inside the expanded group', async (state) => {
    query.isPending = state === 'loading';
    query.isError = state === 'error';
    if (state === 'empty') query.data = [];
    await renderSidebar('draft');
    expect(group()).not.toBeNull();
    expect(stageLinks()).toHaveLength(0);
    expect(container.querySelector('[data-lead-stage-navigation]')?.textContent).toMatch(
      state === 'loading' ? /Carregando/ : state === 'error' ? /Não foi possível/ : /Nenhuma etapa/,
    );
  });

  it.each([['operacional', ['admin']], ['meus-dados', ['seller']]] as const)('filters real list rows for %s and keeps Funil as the board', async (workspace, nextRoles) => {
    if (workspace === 'meus-dados') query.leads = query.leads.filter((lead) => lead.id === 'a');
    await renderRouted(`/${workspace}/leads/draft`, [...nextRoles]);
    expect(container.querySelector('[data-leads-list]')).not.toBeNull();
    expect([...container.querySelectorAll('[data-list-row]')].map((row) => row.getAttribute('data-list-row'))).toEqual(['a']);
    expect(container.querySelector('[data-view-toggle]')).toBeNull();
    expect(container.querySelector('[data-phase-chip]')).toBeNull();
    expect(group().getAttribute('aria-expanded')).toBe('true');
    if (workspace === 'meus-dados') expect(container.querySelector('[aria-label="Vendedor"]')).toBeNull();
  });

  it('opens all active stage columns in Funil', async () => {
    await renderRouted('/operacional/funil', ['admin']);
    expect([...container.querySelectorAll('[data-stage-column]')].map((column) => column.getAttribute('data-stage-column'))).toEqual(['draft', 'won', 'lost']);
    expect(container.querySelector('[data-lead-card="a"]')).not.toBeNull();
    expect(container.querySelector('[data-lead-card="b"]')).not.toBeNull();
    expect(container.querySelector('[data-view-toggle]')).toBeNull();
  });

  it('opens a stage list from the Funil sidebar through a focusable button', async () => {
    await renderRouted('/operacional/funil', ['admin']);
    await act(async () => group().click());
    const lost = stageLinks().find((link) => link.textContent === 'Perdido');
    expect(lost).toBeDefined();
    lost?.focus();
    expect(document.activeElement).toBe(lost);
    await act(async () => lost?.click());
    expect(container.querySelector('[data-path]')?.textContent).toBe('/operacional/leads/lost');
    expect([...container.querySelectorAll('[data-list-row]')].map((row) => row.getAttribute('data-list-row'))).toEqual(['b']);
  });

  it('does not show all leads when the stage is archived', async () => {
    await renderRouted('/operacional/leads/archived', ['admin']);
    expect(container.textContent).toContain('Esta etapa não está disponível.');
    expect(container.querySelector('[data-list-row]')).toBeNull();
  });

  it.each(['/meus-dados/leads/draft', '/meus-dados/funil'])('denies finder access to %s', async (path) => {
    await renderRouted(path, ['finder']);
    expect(container.querySelector('[data-path]')?.textContent).toBe('/meus-dados/finders');
    expect(container.querySelector('[data-leads-board]')).toBeNull();
  });
});
