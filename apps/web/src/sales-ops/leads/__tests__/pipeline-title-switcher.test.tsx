// @vitest-environment happy-dom

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PIPELINE_SWITCHER_LABEL, PipelineTitleSwitcher } from '../PipelineTitleSwitcher';
import type { CrmPipeline } from '../crm-types';

/**
 * The Funil's title names the active pipeline and is the switch. It resolves the
 * active one through `pickPipeline`, like the board container, so the name on
 * screen is always the pipeline whose columns are shown.
 */

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

function pipeline(id: string, name: string, isDefault: boolean, position: number, status: 'active' | 'archived' = 'active'): CrmPipeline {
  return { id, name, isDefault, position, status, funcaoIds: [], stages: [], transitions: [] };
}

const pipelinesState = vi.hoisted(() => ({ current: [] as CrmPipeline[] }));

vi.mock('../crm-hooks', () => ({
  usePipelines: () => ({ isPending: false, isError: false, data: pipelinesState.current }),
}));

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

async function render(value: string | null, onChange = vi.fn()) {
  await act(async () => root.render(<PipelineTitleSwitcher onChange={onChange} value={value} />));
  return onChange;
}

const trigger = () =>
  container.querySelector<HTMLButtonElement>(`[role="combobox"][aria-label="${PIPELINE_SWITCHER_LABEL}"]`);

describe('PipelineTitleSwitcher', () => {
  it('names the default pipeline when nothing is chosen and switches on pick', async () => {
    pipelinesState.current = [
      pipeline('pipe-b', 'Funil CRM Comercial', false, 2),
      pipeline('pipe-a', 'Vendas', true, 1),
    ];
    const onChange = await render(null);
    expect(trigger()?.textContent).toContain('Vendas');

    await act(async () => trigger()!.click());
    const options = [...container.querySelectorAll<HTMLElement>('[role="listbox"] [role="option"]')];
    expect(options.map((node) => node.textContent?.trim())).toEqual(['Vendas', 'Funil CRM Comercial']);
    // The active pipeline is marked, so the current choice reads at a glance.
    expect(options[0]?.getAttribute('aria-selected')).toBe('true');
    expect(options[0]?.querySelector('svg')?.getAttribute('class')).toContain('opacity-100');
    expect(options[1]?.querySelector('svg')?.getAttribute('class')).toContain('opacity-0');

    await act(async () => options[1]!.click());
    expect(onChange).toHaveBeenCalledWith('pipe-b');
  });

  it('names an unreachable choice as the default, never as an empty title', async () => {
    pipelinesState.current = [pipeline('pipe-a', 'Vendas', true, 1), pipeline('pipe-b', 'Parceiros', false, 2)];
    await render('pipe-gone');
    expect(trigger()?.textContent).toContain('Vendas');
  });

  it('shows the single pipeline as a static name, with no switch to open', async () => {
    pipelinesState.current = [pipeline('pipe-a', 'Vendas', true, 1), pipeline('pipe-x', 'Antigo', false, 2, 'archived')];
    await render(null);
    expect(trigger()).toBeNull();
    expect(container.querySelector('[data-pipeline-title]')?.textContent).toBe('Vendas');
  });

  it('renders nothing before the pipelines arrive', async () => {
    pipelinesState.current = [];
    await render(null);
    expect(container.innerHTML).toBe('');
  });
});
