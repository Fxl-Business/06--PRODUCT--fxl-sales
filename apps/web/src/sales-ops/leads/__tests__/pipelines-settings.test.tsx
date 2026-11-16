// @vitest-environment happy-dom

import * as React from 'react';
import type { HTMLAttributes, ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SalesOpsFuncao } from '../../types';
import type { CrmPipeline } from '../crm-types';
import type { SalesOpsLeadStage } from '../types';

/**
 * `Cadastros > Funis e etapas` (vários funis): the REAL container, `PipelinesPanel`,
 * `FuncaoMultiPicker` and `LeadStagesView`, with only the query and mutation hooks mocked. It
 * creates a funil, links funções to it, edits its name and funções, archives and restores one,
 * and every etapa write lands in the SELECTED funil.
 */

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: HTMLAttributes<HTMLDivElement>) => <div data-dialog="">{children}</div>,
  DialogContent: ({ children, className }: HTMLAttributes<HTMLDivElement>) => <div className={className}>{children}</div>,
  DialogDescription: ({ children, ...props }: HTMLAttributes<HTMLParagraphElement>) => <p {...props}>{children}</p>,
  DialogHeader: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  DialogTitle: ({ children, ...props }: HTMLAttributes<HTMLHeadingElement>) => <h2 {...props}>{children}</h2>,
}));

vi.mock('@/components/ui/alert-dialog', () => {
  const CloseCtx = React.createContext<() => void>(() => undefined);
  return {
    AlertDialog: ({ children, open, onOpenChange }: { children: ReactNode; open: boolean; onOpenChange?: (open: boolean) => void }) =>
      open ? (
        <CloseCtx.Provider value={() => onOpenChange?.(false)}>
          <div data-alert-dialog="">{children}</div>
        </CloseCtx.Provider>
      ) : null,
    AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    AlertDialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
    AlertDialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
    AlertDialogAction: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
      <button onClick={onClick} type="button">
        {children}
      </button>
    ),
    AlertDialogCancel: ({ children }: { children: ReactNode }) => {
      const close = React.useContext(CloseCtx);
      return (
        <button onClick={close} type="button">
          {children}
        </button>
      );
    },
  };
});

const COMERCIAL = 'p0000001-0000-4000-8000-000000000001';
const FINANCEIRO = 'p0000002-0000-4000-8000-000000000002';
const ANTIGO = 'p0000003-0000-4000-8000-000000000003';
const F_FIN = 'f0000001-0000-4000-8000-000000000001';

const mocks = vi.hoisted(() => ({
  pipelines: [] as CrmPipeline[],
  stagesFor: [] as Array<string | undefined>,
  savePipeline: vi.fn(),
  saveStage: vi.fn(),
  setStageStatus: vi.fn(),
  reorderStages: vi.fn(),
}));

vi.mock('../crm-hooks', () => ({
  usePipelines: (options: { includeArchived?: boolean }) => {
    if (options?.includeArchived !== true) throw new Error('Funis e etapas reads the archived pipelines too');
    return { isPending: false, isError: false, data: mocks.pipelines };
  },
  useSavePipeline: () => ({ mutateAsync: mocks.savePipeline, isPending: false }),
}));

function stageRow(id: string, name: string, position: number, pipelineId: string): SalesOpsLeadStage {
  return {
    id,
    orgId: 'org',
    name,
    position,
    kind: 'normal',
    isSystem: false,
    status: 'active',
    archivedAt: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: null,
    pipelineId,
  } as SalesOpsLeadStage;
}

const STAGES: Record<string, SalesOpsLeadStage[]> = {
  [COMERCIAL]: [stageRow('s0000001-0000-4000-8000-000000000001', 'Novo', 1, COMERCIAL)],
  [FINANCEIRO]: [
    stageRow('s0000002-0000-4000-8000-000000000002', 'Cobrança', 1, FINANCEIRO),
    stageRow('s0000003-0000-4000-8000-000000000003', 'Acordo', 2, FINANCEIRO),
  ],
};

vi.mock('../hooks', () => ({
  useLeadStages: (pipelineId?: string) => {
    mocks.stagesFor.push(pipelineId);
    return { isPending: false, data: pipelineId ? (STAGES[pipelineId] ?? []) : [] };
  },
  useSaveLeadStage: () => ({ mutateAsync: mocks.saveStage }),
  useSetLeadStageStatus: () => ({ mutateAsync: mocks.setStageStatus }),
  useReorderLeadStages: () => ({ mutateAsync: mocks.reorderStages }),
}));

import { LeadStagesContainer } from '../LeadStagesContainer';
import { PIPELINE_SETTINGS_COPY } from '../pipeline-settings';

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

function pipeline(id: string, name: string, patch: Partial<CrmPipeline> = {}): CrmPipeline {
  return { id, name, isDefault: false, position: 1, status: 'active', funcaoIds: [], stages: [], transitions: [], ...patch };
}

function funcao(id: string, name: string, patch: Partial<SalesOpsFuncao> = {}): SalesOpsFuncao {
  return { id, orgId: 'org', name, slug: name.toLowerCase(), isSystem: false, status: 'active', createdAt: '', updatedAt: null, ...patch };
}

const FUNCOES = [
  funcao('f0000000-0000-4000-8000-000000000000', 'Vendedor', { slug: 'vendedor', isSystem: true }),
  funcao(F_FIN, 'Financeiro'),
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.pipelines = [
    pipeline(COMERCIAL, 'Comercial', { isDefault: true, position: 0 }),
    pipeline(FINANCEIRO, 'Funil Financeiro', { position: 1, funcaoIds: [F_FIN] }),
    pipeline(ANTIGO, 'Antigo', { position: 2, status: 'archived' }),
  ];
  mocks.stagesFor.length = 0;
  for (const mock of [mocks.savePipeline, mocks.saveStage, mocks.setStageStatus, mocks.reorderStages]) {
    mock.mockReset();
    mock.mockResolvedValue({});
  }
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => root.render(<LeadStagesContainer funcoes={FUNCOES} />));
}

async function click(element: Element | null) {
  if (!element) throw new Error('element not found');
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function button(label: string): HTMLButtonElement | null {
  return (
    container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ??
    [...container.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === label) ??
    null
  );
}

async function pickOption(trigger: Element | null, label: string) {
  await click(trigger);
  const option = [...container.querySelectorAll('[role="option"]')].find((row) => row.textContent?.includes(label));
  await click(option ?? null);
}

async function selectPipeline(name: string) {
  await pickOption(container.querySelector(`button[aria-label="${PIPELINE_SETTINGS_COPY.selectorLabel}"]`), name);
}

async function submitForm(selector: string) {
  const form = container.querySelector(selector);
  if (!(form instanceof HTMLFormElement)) throw new Error(`form not found: ${selector}`);
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
}

function stageNames(): string[] {
  return [...container.querySelectorAll('[data-pipeline-stages] tbody tr td:nth-child(2)')].map((cell) => cell.textContent ?? '');
}

describe('Funis e etapas', () => {
  it('opens on the default funil, its etapas and access, with no archive control for it', async () => {
    await render();
    expect(container.querySelector(`button[aria-label="${PIPELINE_SETTINGS_COPY.selectorLabel}"]`)?.textContent).toContain(
      'Comercial',
    );
    expect(mocks.stagesFor.at(-1)).toBe(COMERCIAL);
    expect(stageNames()).toEqual(['Novo']);
    expect(container.querySelector('[data-pipeline-access]')?.textContent).toContain('vendedores sem função ligada a outro funil');
    expect(button(PIPELINE_SETTINGS_COPY.archiveAction)).toBeNull();
    // The archived funil is offered only for restore, never in the selector.
    expect(container.querySelector('[data-archived-pipelines]')?.textContent).toContain('Antigo');
  });

  it('creates a funil with a name and a função, then selects it', async () => {
    mocks.savePipeline.mockResolvedValue({ pipeline: mocks.pipelines[1] });
    await render();
    await click(button(PIPELINE_SETTINGS_COPY.newAction));
    await type(container.querySelector<HTMLInputElement>('input[name="pipelineName"]')!, '  Funil Financeiro ');
    await pickOption(container.querySelector(`button[aria-label="${PIPELINE_SETTINGS_COPY.funcoesLabel}"]`), 'Financeiro');
    expect(container.querySelector('[data-funcao-chip]')?.textContent).toContain('Financeiro');
    await submitForm('[data-pipeline-form]');

    expect(mocks.savePipeline).toHaveBeenCalledWith({ name: 'Funil Financeiro', funcaoIds: [F_FIN] });
    expect(container.querySelector('[data-pipeline-form]')).toBeNull();
    expect(mocks.stagesFor.at(-1)).toBe(FINANCEIRO);
    expect(stageNames()).toEqual(['Cobrança', 'Acordo']);
  });

  it('keeps the dialog open with the typed values when the name is taken', async () => {
    mocks.savePipeline.mockRejectedValue({ status: 409, reason: 'pipeline_name_taken' });
    await render();
    await click(button(PIPELINE_SETTINGS_COPY.newAction));
    await type(container.querySelector<HTMLInputElement>('input[name="pipelineName"]')!, 'Comercial');
    await submitForm('[data-pipeline-form]');
    expect(container.querySelector('[data-pipeline-form]')?.textContent).toContain(PIPELINE_SETTINGS_COPY.nameTaken);
    expect(container.querySelector<HTMLInputElement>('input[name="pipelineName"]')?.value).toBe('Comercial');
  });

  it('edits the selected funil: renames it and replaces its funções', async () => {
    mocks.savePipeline.mockResolvedValue({ pipeline: mocks.pipelines[1] });
    await render();
    await selectPipeline('Funil Financeiro');
    expect(container.querySelector('[data-pipeline-access]')?.textContent).toContain('Financeiro');
    await click(button(PIPELINE_SETTINGS_COPY.editAction));
    expect(container.querySelector<HTMLInputElement>('input[name="pipelineName"]')?.value).toBe('Funil Financeiro');
    await click(button('Remover função Financeiro'));
    await type(container.querySelector<HTMLInputElement>('input[name="pipelineName"]')!, 'Cobrança');
    await submitForm('[data-pipeline-form]');
    expect(mocks.savePipeline).toHaveBeenCalledWith({ id: FINANCEIRO, name: 'Cobrança', funcaoIds: [] });
  });

  it('every etapa write lands in the selected funil', async () => {
    await render();
    await selectPipeline('Funil Financeiro');
    expect(stageNames()).toEqual(['Cobrança', 'Acordo']);

    await click(button('Nova etapa'));
    const nameInput = [...container.querySelectorAll<HTMLInputElement>('[data-dialog] input')].find((input) => input.name !== 'pipelineName');
    await type(nameInput!, 'Renegociação');
    const stageForm = [...container.querySelectorAll('form')].find((form) => !form.hasAttribute('data-pipeline-form'));
    await act(async () => stageForm!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(mocks.saveStage).toHaveBeenCalledWith({ name: 'Renegociação', pipelineId: FINANCEIRO });

    await click(button('Mover Acordo para cima'));
    expect(mocks.reorderStages).toHaveBeenCalledWith({
      stageIds: [STAGES[FINANCEIRO]![1]!.id, STAGES[FINANCEIRO]![0]!.id],
      pipelineId: FINANCEIRO,
    });

    await click(button('Editar Cobrança'));
    const renameInput = [...container.querySelectorAll<HTMLInputElement>('[data-dialog] input')].at(-1)!;
    await type(renameInput, 'Cobrança 1');
    const renameForm = [...container.querySelectorAll('form')].find((form) => !form.hasAttribute('data-pipeline-form'));
    await act(async () => renameForm!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    // A rename addresses the etapa by id and never carries a pipelineId.
    expect(mocks.saveStage).toHaveBeenLastCalledWith({ id: STAGES[FINANCEIRO]![0]!.id, name: 'Cobrança 1' });
  });

  it('archives a funil only after confirmation, and restores an archived one', async () => {
    await render();
    await selectPipeline('Funil Financeiro');
    await click(button(PIPELINE_SETTINGS_COPY.archiveAction));
    expect(container.querySelector('[data-alert-dialog]')?.textContent).toContain(
      PIPELINE_SETTINGS_COPY.archiveTitle('Funil Financeiro'),
    );
    expect(mocks.savePipeline).not.toHaveBeenCalled();
    await click(button(PIPELINE_SETTINGS_COPY.archiveConfirm));
    expect(mocks.savePipeline).toHaveBeenCalledWith({ id: FINANCEIRO, status: 'archived' });

    await click(button(PIPELINE_SETTINGS_COPY.restoreLabel('Antigo')));
    expect(mocks.savePipeline).toHaveBeenLastCalledWith({ id: ANTIGO, status: 'active' });
  });
});
