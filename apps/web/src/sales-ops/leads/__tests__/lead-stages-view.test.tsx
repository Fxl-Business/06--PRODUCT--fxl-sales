// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import type { HTMLAttributes, ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SalesOpsLeadStage } from '../types';

/*
  `node:path` + `fileURLToPath`, never `new URL('../LeadStagesView.tsx', import.meta.url)`:
  this file is `@vitest-environment happy-dom`, so happy-dom's global `URL` resolves against
  the document origin instead of the module's `file:` base, which would turn the expression
  into `http://localhost:3000/...`.
*/
const sourcePath = join(dirname(fileURLToPath(import.meta.url)), '..', 'LeadStagesView.tsx');
const source = readFileSync(sourcePath, 'utf8');

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: HTMLAttributes<HTMLDivElement>) => <div>{children}</div>,
  DialogContent: ({ children, className }: HTMLAttributes<HTMLDivElement>) => (
    <div className={className}>{children}</div>
  ),
  DialogDescription: ({ children, ...props }: HTMLAttributes<HTMLParagraphElement>) => (
    <p {...props}>{children}</p>
  ),
  DialogHeader: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
  DialogTitle: ({ children, ...props }: HTMLAttributes<HTMLHeadingElement>) => (
    <h2 {...props}>{children}</h2>
  ),
}));

/*
  The CloseCtx version, copied from cadastro-archive.test.tsx: without it
  `AlertDialogCancel` renders as an inert button and "Voltar writes nothing" would
  pass even if the cancel never closed the confirmation.
*/
vi.mock('@/components/ui/alert-dialog', () => {
  const CloseCtx = React.createContext<() => void>(() => undefined);
  return {
    AlertDialog: ({
      children,
      open,
      onOpenChange,
    }: {
      children: ReactNode;
      open: boolean;
      onOpenChange?: (open: boolean) => void;
    }) =>
      open ? (
        <CloseCtx.Provider value={() => onOpenChange?.(false)}>{children}</CloseCtx.Provider>
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

import { LeadStagesView, reorderStageIds } from '../LeadStagesView';

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

const stage = (patch: Partial<SalesOpsLeadStage> = {}): SalesOpsLeadStage => ({
  id: 'e0000001-0000-4000-8000-000000000001',
  orgId: '99999999-9999-4999-8999-999999999999',
  name: 'Novo',
  position: 1,
  kind: 'normal',
  isSystem: true,
  status: 'active',
  archivedAt: null,
  createdAt: '2026-09-18T12:00:00.000Z',
  updatedAt: null,
  ...patch,
});

const novo = stage();
const contato = stage({
  id: 'e0000002-0000-4000-8000-000000000002',
  name: 'Contato',
  position: 2,
  isSystem: false,
});
const proposta = stage({
  id: 'e0000003-0000-4000-8000-000000000003',
  name: 'Proposta',
  position: 3,
  isSystem: false,
});
const perdido = stage({
  id: 'e0000004-0000-4000-8000-000000000004',
  name: 'Perdido',
  position: 9,
  kind: 'lost',
  isSystem: true,
});

const fourStages = [novo, contato, proposta, perdido];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

async function change(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submit() {
  const form = container.querySelector('form');
  if (!(form instanceof HTMLFormElement)) throw new Error('form not found');
  await act(async () =>
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
}

function buttonByAriaLabel(label: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
}

function requireButton(label: string): HTMLButtonElement {
  const match = buttonByAriaLabel(label);
  if (!match) throw new Error(`button not found: ${label}`);
  return match;
}

function buttonByText(text: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`button not found: ${text}`);
  return match;
}

function requireNameInput(): HTMLInputElement {
  const match = container.querySelector('form input');
  if (!(match instanceof HTMLInputElement)) throw new Error('name input not found');
  return match;
}

function nameInput(): HTMLInputElement | null {
  const match = container.querySelector('form input');
  return match instanceof HTMLInputElement ? match : null;
}

/** The `Nome` cell of every rendered active row, top to bottom. */
function renderedNames(): string[] {
  return [...container.querySelectorAll('tbody tr')].map(
    (row) => row.querySelectorAll('td')[1]?.textContent?.trim() ?? '',
  );
}

type Handlers = {
  onReorderStages: ReturnType<typeof vi.fn>;
  onSaveStage: ReturnType<typeof vi.fn>;
  onSetStageStatus: ReturnType<typeof vi.fn>;
};

function handlers(patch: Partial<Handlers> = {}): Handlers {
  return {
    onReorderStages: vi.fn(async () => undefined),
    onSaveStage: vi.fn(async () => undefined),
    onSetStageStatus: vi.fn(async () => undefined),
    ...patch,
  };
}

async function render(stages: SalesOpsLeadStage[], on: Handlers) {
  await act(async () => {
    root.render(
      <LeadStagesView
        onReorderStages={on.onReorderStages}
        onSaveStage={on.onSaveStage}
        onSetStageStatus={on.onSetStageStatus}
        stages={stages}
      />,
    );
  });
}

describe('etapas cadastro', () => {
  it('offers no rename and no archive affordance for a system etapa', async () => {
    const on = handlers();
    await render(fourStages, on);

    const editCustom = requireButton('Editar Contato');
    expect(editCustom.disabled).toBe(false);

    // The system fork renders the lock and NOTHING else.
    expect(buttonByAriaLabel('Editar Novo')).toBeNull();
    expect(buttonByAriaLabel('Arquivar etapa Novo')).toBeNull();
    expect(buttonByAriaLabel('Editar Perdido')).toBeNull();
    expect(buttonByAriaLabel('Arquivar etapa Perdido')).toBeNull();

    const lock = requireButton('Etapa predefinida do app');
    expect(lock.disabled).toBe(true);

    await click(lock);
    expect(nameInput()).toBeNull();
  });

  it('persists the full ordered id list when an etapa moves down', async () => {
    let settle: () => void = () => undefined;
    const onReorderStages = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settle = () => resolve();
        }),
    );
    const on = handlers({ onReorderStages });
    await render(fourStages, on);

    await click(requireButton('Mover Contato para baixo'));

    expect(onReorderStages).toHaveBeenCalledTimes(1);
    expect(onReorderStages).toHaveBeenCalledWith([novo.id, proposta.id, contato.id, perdido.id]);
    // Optimistic: the rows already show the new order while the request is in flight.
    expect(renderedNames()).toEqual(['Novo', 'Proposta', 'Contato', 'Perdido']);

    await act(async () => {
      settle();
    });
  });

  it('reverts the row order when the reorder request fails', async () => {
    const onReorderStages = vi.fn(async () => {
      throw new Error('boom');
    });
    const on = handlers({ onReorderStages });
    await render(fourStages, on);

    await click(requireButton('Mover Contato para baixo'));

    expect(renderedNames()).toEqual(['Novo', 'Contato', 'Proposta', 'Perdido']);
    expect(container.textContent).toContain(
      'Não foi possível reordenar as etapas. A ordem anterior foi restaurada.',
    );
  });

  it('does not move the first etapa up or the last one down', async () => {
    const on = handlers();
    await render(fourStages, on);

    const firstUp = requireButton('Mover Novo para cima');
    const lastDown = requireButton('Mover Perdido para baixo');
    expect(firstUp.disabled).toBe(true);
    expect(lastDown.disabled).toBe(true);

    await click(firstUp);
    await click(lastDown);
    expect(on.onReorderStages).toHaveBeenCalledTimes(0);

    /*
      MEASURED LIMIT, recorded rather than left to be rediscovered: the two
      `toHaveBeenCalledTimes(0)` assertions above are carried by the `disabled`
      attribute alone, not by the `next === current` guard inside `move()`. React
      resolves a click listener from its OWN props, so a button it rendered with
      `disabled` never runs the handler, and stripping the DOM attribute does not
      change that. Dropping either `disabled` expression IS caught, by the two
      assertions right above. The range guard itself is pinned where it is reachable,
      in the `reorderStageIds` describe below, which is also what `move()` compares
      by reference.
    */
  });

  it('restores an archived etapa from the Etapas arquivadas section', async () => {
    const descartado = stage({
      id: 'e0000005-0000-4000-8000-000000000005',
      name: 'Descartado',
      position: 4,
      isSystem: false,
      status: 'archived',
      archivedAt: '2026-09-18T13:00:00.000Z',
    });
    const on = handlers();
    await render([...fourStages, descartado], on);

    expect(container.querySelector('tbody')?.textContent).not.toContain('Descartado');
    expect(container.textContent).toContain('Etapas arquivadas');

    await click(requireButton('Restaurar etapa Descartado'));
    expect(on.onSetStageStatus).toHaveBeenCalledTimes(1);
    expect(on.onSetStageStatus).toHaveBeenCalledWith({
      id: descartado.id,
      name: 'Descartado',
      status: 'active',
    });
  });

  it('archives only after the confirmation is accepted', async () => {
    const on = handlers();
    await render(fourStages, on);

    await click(requireButton('Arquivar etapa Contato'));
    expect(on.onSetStageStatus).toHaveBeenCalledTimes(0);
    expect(container.textContent).toContain('Arquivar a etapa Contato?');

    await click(buttonByText('Voltar'));
    expect(on.onSetStageStatus).toHaveBeenCalledTimes(0);

    await click(requireButton('Arquivar etapa Contato'));
    await click(buttonByText('Arquivar'));
    expect(on.onSetStageStatus).toHaveBeenCalledTimes(1);
    expect(on.onSetStageStatus).toHaveBeenCalledWith({
      id: contato.id,
      name: 'Contato',
      status: 'archived',
    });
  });

  it('creates an etapa with no id and a trimmed name', async () => {
    const on = handlers();
    await render(fourStages, on);

    await click(buttonByText('Nova etapa'));
    await change(requireNameInput(), '  Qualificação  ');
    await submit();

    expect(on.onSaveStage).toHaveBeenCalledTimes(1);
    const call = on.onSaveStage.mock.calls[0]![0] as Record<string, unknown>;
    expect(call).toEqual({ id: undefined, name: 'Qualificação' });
    expect(call).not.toHaveProperty('status');
    expect(call).not.toHaveProperty('position');
  });

  it('renames a custom etapa keeping its id', async () => {
    const on = handlers();
    await render(fourStages, on);

    await click(requireButton('Editar Contato'));
    await change(requireNameInput(), 'Primeiro contato');
    await submit();

    expect(on.onSaveStage).toHaveBeenCalledWith({ id: contato.id, name: 'Primeiro contato' });
  });

  it('keeps the dialog open when the save is rejected', async () => {
    const onSaveStage = vi.fn(async () => {
      throw new Error('stage_name_taken');
    });
    const on = handlers({ onSaveStage });
    await render(fourStages, on);

    await click(requireButton('Editar Contato'));
    await change(requireNameInput(), 'Proposta');
    await submit();

    expect(nameInput()).not.toBeNull();
    expect(container.textContent).toContain('Não foi possível salvar a etapa. Tente novamente.');
  });

  it('refuses to save an etapa without a name', async () => {
    const on = handlers();
    await render(fourStages, on);

    await click(buttonByText('Nova etapa'));
    await submit();

    expect(on.onSaveStage).toHaveBeenCalledTimes(0);
    expect(buttonByText('Salvar').disabled).toBe(true);
  });

  it('disables every control on an optimistic row', async () => {
    const pendingRow = stage({
      id: 'optimistic:leadStages:qualificacao',
      name: 'Qualificação',
      position: 5,
      isSystem: false,
    });
    const on = handlers();
    await render([...fourStages, pendingRow], on);

    expect(buttonByAriaLabel('Editar Qualificação')).toBeNull();
    expect(requireButton('Salvando Qualificação').disabled).toBe(true);
    expect(requireButton('Arquivar etapa Qualificação').disabled).toBe(true);
    expect(requireButton('Mover Qualificação para cima').disabled).toBe(true);
    expect(requireButton('Mover Qualificação para baixo').disabled).toBe(true);
  });

  it('lists no archived etapa in the active table', async () => {
    const descartado = stage({
      id: 'e0000005-0000-4000-8000-000000000005',
      name: 'Descartado',
      position: 4,
      isSystem: false,
      status: 'archived',
    });
    const on = handlers();
    await render([...fourStages, descartado], on);

    expect(container.querySelectorAll('tbody tr')).toHaveLength(fourStages.length);
    expect(container.querySelector('table')?.textContent).not.toContain('Descartado');
  });
});

describe('reorderStageIds', () => {
  const ids = ['a', 'b', 'c', 'd'];

  it('swaps neighbours and preserves the id set', () => {
    const down = reorderStageIds(ids, 'b', 1);
    expect(down).toEqual(['a', 'c', 'b', 'd']);
    const up = reorderStageIds(ids, 'c', -1);
    expect(up).toEqual(['a', 'c', 'b', 'd']);

    for (const next of [down, up]) {
      expect(next).toHaveLength(ids.length);
      expect([...next].sort()).toEqual([...ids].sort());
    }
  });

  it('returns the same array reference when the move is out of range', () => {
    expect(reorderStageIds(ids, 'a', -1)).toBe(ids);
    expect(reorderStageIds(ids, 'd', 1)).toBe(ids);
    expect(reorderStageIds(ids, 'zz', 1)).toBe(ids);
  });
});

describe('etapas cadastro UI contract', () => {
  it('uses no native picker and no drag dependency', () => {
    expect(source).not.toContain('<select');
    expect(source).not.toContain('<option');
    expect(source).not.toContain('<datalist');
    expect(source).not.toContain('@dnd-kit');
    expect(source).not.toContain('react-beautiful-dnd');
    expect(source).not.toContain('@hello-pangea/dnd');
  });
});
