// @vitest-environment happy-dom
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LeadsBoard } from '../LeadsBoard';
import { buildLabelLookups } from '../board-labels';
import type { SalesOpsLead, SalesOpsLeadStage } from '../types';

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;
const stages = ['Novo', 'Negociação'].map((name, index) => ({
  id: `stage-${index}`, name, kind: 'normal', position: index, status: 'active',
  isSystem: false, archivedAt: null, orgId: 'org', createdAt: '', updatedAt: null,
})) as SalesOpsLeadStage[];
const leads = [
  { id: 'ana', contactName: 'Ana', clientNameSnapshot: 'Café Azul', contactPhone: '11999990000', contactEmail: 'ana@example.com', stageId: stages[0]!.id, position: 0, products: [], stageChangedAt: '2026-10-19', estimatedValueBrl: 100 },
  { id: 'bia', contactName: 'Bia', clientNameSnapshot: 'Beta', contactPhone: null, contactEmail: null, stageId: stages[1]!.id, position: 0, products: [], stageChangedAt: '2026-10-19', estimatedValueBrl: 100 },
] as unknown as SalesOpsLead[];
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('filters loaded cards immediately and restores them without changing server totals', async () => {
  await act(async () => root.render(<LeadsBoard routedMode="board" leads={leads} stages={stages}
    lookups={buildLabelLookups({ clients: [], people: [], products: [] })}
    now={new Date('2026-10-20')} onMoveLead={vi.fn()} hasMore onLoadMore={vi.fn()}
    stageSummary={{ stages: [
      { stageId: 'stage-0', count: 10, estimatedValueBrl: 1000 },
      { stageId: 'stage-1', count: 20, estimatedValueBrl: 2000 },
    ] }} />));
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Buscar leads"]')!;
  expect(input).not.toBeNull();
  expect(host.querySelector('[data-leads-board]')?.className).toContain('min-h-0');
  expect(host.querySelector('[data-board-scroller]')?.className).toContain('overflow-y-hidden');
  const countsBefore = [...host.querySelectorAll('[data-stage-count]')].map((node) => node.textContent);
  expect(countsBefore).toEqual(['10', '20']);
  const search = async (value: string) => act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await search('cafe');
  expect(host.querySelectorAll('[data-lead-card="ana"]')).toHaveLength(1);
  expect(host.querySelectorAll('[data-lead-card="bia"]')).toHaveLength(0);
  expect(host.querySelector('[data-search-empty="stage-1"]')?.textContent).toContain('Nenhum');
  expect([...host.querySelectorAll('[data-stage-count]')].map((node) => node.textContent)).toEqual(countsBefore);
  expect(host.textContent).toContain('Carregar mais leads (2 de 30)');
  await search('ana@example.com');
  expect(host.querySelectorAll('[data-lead-card]')).toHaveLength(1);
  await search('');
  expect(host.querySelectorAll('[data-lead-card]')).toHaveLength(2);
});
