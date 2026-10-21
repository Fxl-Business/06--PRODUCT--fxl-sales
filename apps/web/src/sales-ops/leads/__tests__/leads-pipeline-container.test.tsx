// @vitest-environment happy-dom

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeadsBoardContainer } from '../LeadsBoardContainer';
import type { CrmPipeline, CrmPipelineStage } from '../crm-types';

/**
 * The Quadro is a view of the SELECTED pipeline. The container reads the
 * pipelines (not the legacy stage list), hands the board the selected pipeline's
 * columns, and shares ONE filters object between the board read, the stage
 * summary and the move, so the pipeline choice reaches every query the same way.
 */

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

const A_NOVO = 'aaaaaaaa-0000-4000-8000-000000000001';
const A_PROPOSTA = 'aaaaaaaa-0000-4000-8000-000000000002';
const B_PRIMEIRO = 'bbbbbbbb-0000-4000-8000-000000000001';
const B_FECHAMENTO = 'bbbbbbbb-0000-4000-8000-000000000002';
const PIPE_A = 'pipe-a';
const PIPE_B = 'pipe-b';

function stage(id: string, name: string, position: number): CrmPipelineStage {
  return {
    id,
    name,
    position,
    type: 'normal',
    behavior: 'none',
    exitKind: null,
    requiresReason: false,
    status: 'active',
  };
}

function pipeline(id: string, name: string, isDefault: boolean, stages: CrmPipelineStage[]): CrmPipeline {
  return { id, name, isDefault, position: isDefault ? 1 : 2, status: 'active', stages, transitions: [] };
}

const PIPELINES = [
  pipeline(PIPE_A, 'Vendas padrão', true, [stage(A_NOVO, 'Novo', 1), stage(A_PROPOSTA, 'Proposta', 2)]),
  pipeline(PIPE_B, 'Parceiros', false, [stage(B_PRIMEIRO, 'Primeiro contato', 1), stage(B_FECHAMENTO, 'Fechamento', 2)]),
];

const mocks = vi.hoisted(() => ({
  boardFilters: [] as unknown[],
  summaryFilters: [] as unknown[],
  moveFilters: [] as unknown[],
  boardProps: [] as Record<string, unknown>[],
  moveMutateAsync: vi.fn(),
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
    return { mutateAsync: mocks.moveMutateAsync, isPending: false };
  },
  useSaveLead: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteLead: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('../crm-hooks', () => ({
  usePipelines: () => ({ isPending: false, isError: false, data: PIPELINES }),
  useFieldDefinitions: () => ({ isPending: false, data: [] }),
}));

vi.mock('../LeadsBoard', async () => {
  const ReactModule = await import('react');
  return {
    LeadsBoard: (props: Record<string, unknown>) => {
      mocks.boardProps.push(props);
      const selector = props.pipelineSelector as
        | { options: { value: string; label: string }[]; onChange: (id: string) => void }
        | undefined;
      const stages = props.stages as { name: string }[];
      const onMove = props.onMoveLead as (payload: unknown) => void;
      return ReactModule.createElement(
        'div',
        { 'data-board-stub': 'true' },
        ReactModule.createElement('p', { 'data-stub-columns': 'true' }, stages.map((s) => s.name).join('|')),
        ReactModule.createElement(
          'button',
          {
            'data-stub-move': 'true',
            onClick: () => onMove({ leadId: 'l1', toStageId: A_PROPOSTA, toIndex: 0 }),
            type: 'button',
          },
          'stub-move',
        ),
        ...(selector?.options ?? []).map((option) =>
          ReactModule.createElement(
            'button',
            { key: option.value, 'data-pick-pipeline': option.value, onClick: () => selector!.onChange(option.value), type: 'button' },
            option.label,
          ),
        ),
      );
    },
  };
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.boardFilters.length = 0;
  mocks.summaryFilters.length = 0;
  mocks.moveFilters.length = 0;
  mocks.boardProps.length = 0;
  mocks.moveMutateAsync.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(node: React.ReactElement) {
  await act(async () => {
    root.render(<MemoryRouter>{node}</MemoryRouter>);
  });
}

function columnNames(): string {
  return container.querySelector('[data-stub-columns]')?.textContent ?? '';
}

const BASE_PROPS = { clients: [], people: [], products: [], sellers: [] };

describe('LeadsBoardContainer pipeline selection', () => {
  it('shows the default pipeline columns and offers both pipelines to the board', async () => {
    await render(<LeadsBoardContainer {...BASE_PROPS} />);
    expect(columnNames()).toBe('Novo|Proposta');
    const selector = mocks.boardProps.at(-1)?.pipelineSelector as { options: { value: string }[] };
    expect(selector.options.map((option) => option.value)).toEqual([PIPE_A, PIPE_B]);
  });

  it('switches the columns and sends the selected pipeline id on the SAME filters object', async () => {
    await render(<LeadsBoardContainer {...BASE_PROPS} />);
    await act(async () => {
      container.querySelector<HTMLButtonElement>(`[data-pick-pipeline="${PIPE_B}"]`)!.click();
    });
    expect(columnNames()).toBe('Primeiro contato|Fechamento');

    const board = mocks.boardFilters.at(-1) as { pipelineId: string };
    expect(board).toMatchObject({ pipelineId: PIPE_B });
    expect(mocks.summaryFilters.at(-1)).toBe(board);
    expect(mocks.moveFilters.at(-1)).toBe(board);
  });

  it('opens the pipeline that owns a routed stage', async () => {
    await render(<LeadsBoardContainer {...BASE_PROPS} routedMode="stage" selectedStageId={B_FECHAMENTO} />);
    expect(columnNames()).toBe('Primeiro contato|Fechamento');
    expect(mocks.boardFilters.at(-1)).toMatchObject({ pipelineId: PIPE_B });
  });
});

describe('LeadsBoardContainer move refusal', () => {
  it('shows the visible copy when the API refuses a move outside the transition graph (409)', async () => {
    mocks.moveMutateAsync.mockRejectedValue({ status: 409, error: 'transition_not_allowed' });
    await render(<LeadsBoardContainer {...BASE_PROPS} />);
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-stub-move]')!.click();
    });
    await act(async () => undefined);
    expect(container.querySelector('[data-mutation-error]')?.textContent).toContain(
      'Esse movimento não é permitido neste funil.',
    );
  });
});
