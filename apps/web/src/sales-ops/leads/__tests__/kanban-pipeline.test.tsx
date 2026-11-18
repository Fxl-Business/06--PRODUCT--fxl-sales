// @vitest-environment happy-dom

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PERIOD_ALL_SELECTION } from '../../period';
import { LeadsBoard } from '../LeadsBoard';
import { buildLabelLookups } from '../board-labels';
import type { SalesOpsLeadStage } from '../types';

/**
 * The board as a view of a pipeline, driven by props only: the column header's
 * list icon opens the Lista in place, and the period control is offered on
 * every view. The container's wiring of the same props is in
 * `leads-pipeline-container.test.tsx`.
 */

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;
const NOW = new Date('2026-10-20T12:00:00.000Z');
const NOVO = 'dddddddd-0000-4000-8000-000000000001';
const PROPOSTA = 'dddddddd-0000-4000-8000-000000000002';
const LOOKUPS = buildLabelLookups({ clients: [], people: [], products: [] });

function stage(id: string, name: string, kind: SalesOpsLeadStage['kind'], position: number): SalesOpsLeadStage {
  return {
    id,
    name,
    kind,
    position,
    status: 'active',
    isSystem: kind !== 'normal',
    archivedAt: null,
    orgId: 'org-1',
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: null,
  };
}

const STAGES = [stage(NOVO, 'Novo', 'normal', 1), stage(PROPOSTA, 'Proposta', 'conversion', 2)];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function renderBoard(extra: Partial<React.ComponentProps<typeof LeadsBoard>> = {}) {
  return act(async () => {
    root.render(
      <LeadsBoard
        lookups={LOOKUPS}
        leads={[]}
        now={NOW}
        onMoveLead={vi.fn()}
        stages={STAGES}
        {...extra}
      />,
    );
  });
}

function trigger(label: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`[role="combobox"][aria-label="${label}"]`);
}

describe('stage list from the column header', () => {
  it('opens the Lista on the same screen, filtered to that etapa, with the view toggle to go back', async () => {
    await renderBoard();
    expect(container.querySelector('[data-leads-list]')).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>(`[data-view-in-list="${PROPOSTA}"]`)!.click());
    expect(container.querySelector('[data-leads-list]')).not.toBeNull();
    expect(container.querySelector(`[data-phase-chip="${PROPOSTA}"]`)?.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[data-view-option="list"]')?.getAttribute('aria-pressed')).toBe('true');

    await act(async () => container.querySelector<HTMLButtonElement>('[data-view-option="board"]')!.click());
    expect(container.querySelector('[data-leads-list]')).toBeNull();
  });

  it('renders no pipeline control: the switch lives in the page title', async () => {
    await renderBoard();
    expect(trigger('Funil')).toBeNull();
    expect(trigger('Funil ativo')).toBeNull();
  });
});

describe('period control', () => {
  it('is offered on the Quadro, the Lista and the Funil', async () => {
    const periodFilter = { value: PERIOD_ALL_SELECTION, onChange: vi.fn() };
    await renderBoard({ periodFilter });
    const views = ['board', 'list', 'funnel'] as const;
    for (const view of views) {
      await act(async () => container.querySelector<HTMLButtonElement>(`[data-view-option="${view}"]`)!.click());
      expect(trigger('Período dos leads'), view).not.toBeNull();
    }
  });
});
