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
  return { id, name, isDefault, position: isDefault ? 1 : 2, status: 'active', funcaoIds: [], stages, transitions: [] };
}

const FUNCAO_PARCEIROS = 'funcao-parceiros';

const PIPELINES = [
  pipeline(PIPE_A, 'Vendas padrão', true, [stage(A_NOVO, 'Novo', 1), stage(A_PROPOSTA, 'Proposta', 2)]),
  {
    ...pipeline(PIPE_B, 'Parceiros', false, [stage(B_PRIMEIRO, 'Primeiro contato', 1), stage(B_FECHAMENTO, 'Fechamento', 2)]),
    funcaoIds: [FUNCAO_PARCEIROS],
  },
];

const mocks = vi.hoisted(() => ({
  boardFilters: [] as unknown[],
  summaryFilters: [] as unknown[],
  moveFilters: [] as unknown[],
  boardProps: [] as Record<string, unknown>[],
  formProps: [] as Record<string, unknown>[],
  moveMutateAsync: vi.fn(),
}));

vi.mock('../LeadForm', () => ({
  LeadForm: (props: Record<string, unknown>) => {
    mocks.formProps.push(props);
    return null;
  },
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
  useDeleteStageLeads: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useStageDeletePreview: () => ({ data: undefined, isError: false }),
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
      const stages = props.stages as { name: string }[];
      const onMove = props.onMoveLead as (payload: unknown) => void;
      return ReactModule.createElement(
        'div',
        { 'data-board-stub': 'true' },
        ReactModule.createElement('p', { 'data-stub-columns': 'true' }, stages.map((s) => s.name).join('|')),
        ReactModule.createElement(
          'button',
          { 'data-stub-create': 'true', onClick: () => (props.onCreateLead as () => void)(), type: 'button' },
          'stub-create',
        ),
        ReactModule.createElement(
          'button',
          {
            'data-stub-move': 'true',
            onClick: () => onMove({ leadId: 'l1', toStageId: A_PROPOSTA, toIndex: 0 }),
            type: 'button',
          },
          'stub-move',
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
  mocks.formProps.length = 0;
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

/**
 * Stands in for the shell, which owns the pipeline choice because the Funil's
 * title is the switch: one button per pipeline drives `pipelineChoice`.
 */
function WithShellChoice(props: Omit<React.ComponentProps<typeof LeadsBoardContainer>, 'pipelineChoice'>) {
  const [choice, setChoice] = React.useState<string | null>(null);
  return (
    <>
      {PIPELINES.map((candidate) => (
        <button data-pick-pipeline={candidate.id} key={candidate.id} onClick={() => setChoice(candidate.id)} type="button">
          {candidate.name}
        </button>
      ))}
      <LeadsBoardContainer {...props} pipelineChoice={choice} />
    </>
  );
}

describe('LeadsBoardContainer pipeline selection', () => {
  it('shows the default pipeline columns without a choice, and the board renders no pipeline control', async () => {
    await render(<LeadsBoardContainer {...BASE_PROPS} />);
    expect(columnNames()).toBe('Novo|Proposta');
    expect(mocks.boardProps.at(-1)).not.toHaveProperty('pipelineSelector');
  });

  it('switches the columns and sends the selected pipeline id on the SAME filters object', async () => {
    await render(<WithShellChoice {...BASE_PROPS} />);
    await act(async () => {
      container.querySelector<HTMLButtonElement>(`[data-pick-pipeline="${PIPE_B}"]`)!.click();
    });
    expect(columnNames()).toBe('Primeiro contato|Fechamento');

    const board = mocks.boardFilters.at(-1) as { pipelineId: string };
    expect(board).toMatchObject({ pipelineId: PIPE_B });
    expect(mocks.summaryFilters.at(-1)).toBe(board);
    expect(mocks.moveFilters.at(-1)).toBe(board);
  });

  it('honours the shell choice and falls back to the default for an unreachable one', async () => {
    await render(<LeadsBoardContainer {...BASE_PROPS} pipelineChoice={PIPE_B} />);
    expect(columnNames()).toBe('Primeiro contato|Fechamento');
    expect(mocks.boardFilters.at(-1)).toMatchObject({ pipelineId: PIPE_B });

    await render(<LeadsBoardContainer {...BASE_PROPS} pipelineChoice="pipe-gone" />);
    expect(columnNames()).toBe('Novo|Proposta');
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

describe('LeadsBoardContainer new lead (vários funis)', () => {
  const ana = { id: 'person-ana', funcaoIds: ['funcao-vendedor'] };
  const bia = { id: 'person-bia', funcaoIds: ['funcao-vendedor', FUNCAO_PARCEIROS] };
  const props = {
    ...BASE_PROPS,
    people: [ana, bia] as never[],
    sellers: [
      { value: ana.id, label: 'Ana' },
      { value: bia.id, label: 'Bia' },
    ],
  };

  async function openNewLead() {
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-stub-create]')!.click();
    });
    return mocks.formProps.at(-1)!;
  }

  it('is born in the selected pipeline and offers only the vendedores who reach it', async () => {
    await render(<WithShellChoice {...props} />);
    let form = await openNewLead();
    expect(form.pipelineId).toBe(PIPE_A);
    // Bia's função is linked to Parceiros only, so the default pipeline is out of her reach.
    expect((form.sellers as { value: string }[]).map((option) => option.value)).toEqual([ana.id]);

    await act(async () => {
      container.querySelector<HTMLButtonElement>(`[data-pick-pipeline="${PIPE_B}"]`)!.click();
    });
    form = mocks.formProps.at(-1)!;
    expect(form.pipelineId).toBe(PIPE_B);
    expect((form.sellers as { value: string }[]).map((option) => option.value)).toEqual([bia.id]);
  });
});
