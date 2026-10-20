// @vitest-environment happy-dom
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeadSidebarNavigation } from '../leads/LeadSidebarNavigation';
import { buildLeadFunnelPath, buildLeadStagePath, resolveSalesOpsRoute } from '../navigation';

const query = vi.hoisted(() => ({
  data: [] as Array<{ id: string; name: string; status: string; position: number }>,
  isPending: false,
  isError: false,
}));
vi.mock('../leads/hooks', () => ({ useLeadStages: () => query }));

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;
let container: HTMLDivElement;
let root: Root | null;
function LocationProbe() {
  return <output data-path>{useLocation().pathname}</output>;
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
  query.data = [
    { id: 'lost', name: 'Perdido', status: 'active', position: 3 },
    { id: 'draft', name: 'Contato', status: 'active', position: 1 },
    { id: 'archived', name: 'Antigo', status: 'inactive', position: 0 },
    { id: 'won', name: 'Convertido', status: 'active', position: 2 },
  ];
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
});
