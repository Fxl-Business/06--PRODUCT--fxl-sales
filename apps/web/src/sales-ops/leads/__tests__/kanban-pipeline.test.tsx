// @vitest-environment happy-dom

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PERIOD_ALL_SELECTION } from '../../period';
import { LeadsBoard } from '../LeadsBoard';
import { buildLabelLookups } from '../board-labels';
import type { CrmPipeline } from '../crm-types';
import type { SalesOpsLeadStage } from '../types';

/**
 * The board as a view of a pipeline, driven by props only: the pipeline selector
 * is shown only when there is a choice, and the period control is offered on
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

const PIPELINE: CrmPipeline = {
  id: 'pipe-a',
  name: 'Vendas padrão',
  isDefault: true,
  position: 1,
  status: 'active',
  stages: [],
  transitions: [],
};

const OPTIONS = [
  { value: 'pipe-a', label: 'Vendas padrão' },
  { value: 'pipe-b', label: 'Parceiros' },
];

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

describe('pipeline selector', () => {
  it('shows the Funil selector when there is a choice, and reports the picked pipeline', async () => {
    const onChange = vi.fn();
    await renderBoard({ pipeline: PIPELINE, pipelineSelector: { value: 'pipe-a', options: OPTIONS, onChange } });
    expect(trigger('Funil')).not.toBeNull();
    await act(async () => trigger('Funil')!.click());
    const option = [...document.querySelectorAll<HTMLElement>('[role="listbox"] [role="option"]')].find(
      (node) => node.textContent?.trim() === 'Parceiros',
    );
    await act(async () => option!.click());
    expect(onChange).toHaveBeenCalledWith('pipe-b');
  });

  it('renders no selector when there is only one pipeline', async () => {
    await renderBoard({ pipeline: PIPELINE, pipelineSelector: { value: 'pipe-a', options: OPTIONS.slice(0, 1), onChange: vi.fn() } });
    expect(trigger('Funil')).toBeNull();
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
