// @vitest-environment happy-dom

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeadsBoardContainer } from '../LeadsBoardContainer';
import type { CrmPipeline, CrmPipelineStage } from '../crm-types';

/**
 * ORACLE: the period filter of the leads board.
 *
 * The period is a Sao Paulo civil day range. The clock is pinned to 01:30 UTC on
 * the 20th, which is 22:30 on the 19th in Sao Paulo, so every "today" below must
 * read the 19th, never the UTC day. The period reaches the board read, the stage
 * summary and the move as the SAME filters object, and the control is offered on
 * the Quadro, the Lista and the Funil alike. The real LeadsBoard renders here, so
 * the control is the real Combobox and the real PeriodFilter.
 */

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

const NOVO = 'aaaaaaaa-0000-4000-8000-000000000001';
const PROPOSTA = 'aaaaaaaa-0000-4000-8000-000000000002';
const PIPE = 'pipe-a';

function stage(id: string, name: string, position: number): CrmPipelineStage {
  return { id, name, position, type: 'normal', behavior: 'none', exitKind: null, requiresReason: false, status: 'active' };
}

const PIPELINES: CrmPipeline[] = [
  {
    id: PIPE,
    name: 'Vendas padrão',
    isDefault: true,
    position: 1,
    status: 'active',
    stages: [stage(NOVO, 'Novo', 1), stage(PROPOSTA, 'Proposta', 2)],
    transitions: [],
  },
];

const mocks = vi.hoisted(() => ({
  boardFilters: [] as unknown[],
  summaryFilters: [] as unknown[],
  moveFilters: [] as unknown[],
}));

vi.mock('@/auth/react', () => ({
  useSalesEdition: () => 'full',
  useAuthProfile: () => ({
    isLoaded: true,
    isSignedIn: true,
    roles: ['admin'],
    name: 'Gestor',
    email: 'gestor@example.com',
  }),
  useAccessToken: () => ({ getToken: async () => 'token' }),
}));

vi.mock('../hooks', () => ({
  useLeadsBoard: (_stages: unknown, filters: unknown) => {
    mocks.boardFilters.push(filters);
    return { isPending: false, isError: false, data: { leads: [], hasMore: false }, isFetchingNextPage: false, fetchNextPage: vi.fn() };
  },
  useLeadStageSummary: (filters: unknown) => {
    mocks.summaryFilters.push(filters);
    return { data: undefined };
  },
  useMoveLead: (filters: unknown) => {
    mocks.moveFilters.push(filters);
    return { mutateAsync: vi.fn(), isPending: false };
  },
  useSaveLead: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteLead: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('../crm-hooks', () => ({
  usePipelines: () => ({ isPending: false, isError: false, data: PIPELINES }),
  useFieldDefinitions: () => ({ isPending: false, data: [] }),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // Only the clock is faked: React and the Combobox run on real timers.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-20T01:30:00.000Z'));
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.boardFilters.length = 0;
  mocks.summaryFilters.length = 0;
  mocks.moveFilters.length = 0;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

async function render() {
  await act(async () => {
    root.render(
      <MemoryRouter>
        <LeadsBoardContainer clients={[]} people={[]} products={[]} sellers={[]} />
      </MemoryRouter>,
    );
  });
}

function periodTrigger(): HTMLButtonElement {
  const node = container.querySelector('[role="combobox"][aria-label="Período dos leads"]');
  if (!(node instanceof HTMLButtonElement)) throw new Error('period control missing');
  return node;
}

async function pickPreset(label: string) {
  await act(async () => periodTrigger().click());
  const option = [...document.querySelectorAll<HTMLElement>('[role="listbox"] [role="option"]')].find(
    (node) => node.textContent?.trim() === label,
  );
  if (!option) throw new Error(`preset "${label}" not offered`);
  await act(async () => option.click());
}

async function typeDate(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(selector);
  if (!input) throw new Error(`${selector} missing`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function lastBoardFilters(): { from?: string; to?: string; pipelineId?: string } {
  return (mocks.boardFilters.at(-1) ?? {}) as { from?: string; to?: string; pipelineId?: string };
}

async function viewOption(name: 'board' | 'list' | 'funnel') {
  await act(async () =>
    container.querySelector<HTMLButtonElement>(`[data-view-option="${name}"]`)!.click(),
  );
}

describe('leads board period filter (oracle)', () => {
  it('"Hoje" is the Sao Paulo day (the 19th at 22:30 local), not the UTC day', async () => {
    await render();
    await pickPreset('Hoje');
    expect(lastBoardFilters()).toMatchObject({ from: '2026-10-19', to: '2026-10-19', pipelineId: PIPE });
  });

  it('"Todo o período" leaves from and to out of the filters', async () => {
    await render();
    await pickPreset('Hoje');
    await pickPreset('Todo o período');
    expect(lastBoardFilters().from).toBeUndefined();
    expect(lastBoardFilters().to).toBeUndefined();
  });

  it('a reversed custom range is reported and never applied', async () => {
    await render();
    await pickPreset('Personalizado');
    await typeDate('[data-period-from]', '2026-10-25');
    await typeDate('[data-period-to]', '2026-10-20');
    expect(container.querySelector('[data-period-error]')?.textContent).toBe(
      'A data inicial não pode ser depois da final.',
    );
    expect(lastBoardFilters().from).toBeUndefined();
    expect(lastBoardFilters().to).toBeUndefined();
  });

  it('the same filters object reaches the board read, the summary and the move', async () => {
    await render();
    await pickPreset('Hoje');
    const board = mocks.boardFilters.at(-1);
    expect(mocks.summaryFilters.at(-1)).toBe(board);
    expect(mocks.moveFilters.at(-1)).toBe(board);
  });

  it('offers the period control on the Quadro, the Lista and the Funil', async () => {
    await render();
    expect(periodTrigger()).toBeTruthy();
    await viewOption('list');
    expect(periodTrigger()).toBeTruthy();
    await viewOption('funnel');
    expect(periodTrigger()).toBeTruthy();
    await viewOption('board');
    expect(periodTrigger()).toBeTruthy();
  });
});
