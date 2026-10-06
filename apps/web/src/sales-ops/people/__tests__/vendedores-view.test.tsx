// @vitest-environment happy-dom

import * as React from 'react';
import type { HTMLAttributes, ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavePersonPayload } from '../../api';
import { optimisticId } from '../../optimistic';
import type { SalesOpsFuncao, SalesOpsPerson } from '../../types';

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
  The CloseCtx version, copied from cadastro-history.test.tsx: without it
  `AlertDialogCancel` renders as an inert button and "Voltar closes it" would pass
  even if the cancel never closed the confirmation.
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
        <CloseCtx.Provider value={() => onOpenChange?.(false)}>
          <div data-alert-dialog>{children}</div>
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

import { VendedorDialog, VendedoresView } from '../VendedoresView';
import { VENDEDORES_COPY } from '../vendedores';

const act = (
  React as typeof React & { act: typeof import('react-dom/test-utils').act }
).act;

const orgId = '99999999-9999-4999-8999-999999999999';

const vendedor: SalesOpsFuncao = {
  id: 'fc000001-0000-4000-8000-000000000001',
  orgId,
  name: 'Vendedor',
  slug: 'vendedor',
  isSystem: true,
  status: 'active',
  createdAt: '2026-07-29T12:00:00.000Z',
  updatedAt: null,
};
const finder: SalesOpsFuncao = {
  ...vendedor,
  id: 'fc000002-0000-4000-8000-000000000002',
  name: 'Finder',
  slug: 'finder',
};

const asPersonFuncao = (row: SalesOpsFuncao) => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  isSystem: row.isSystem,
});

const ana: SalesOpsPerson = {
  id: '11111111-1111-4111-8111-111111111111',
  orgId,
  displayName: 'Ana Lima',
  contactEmail: 'ana@construbom.example',
  status: 'active',
  funcaoIds: [vendedor.id],
  funcoes: [asPersonFuncao(vendedor)],
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: null,
};
const bruno: SalesOpsPerson = {
  ...ana,
  id: '33333333-3333-4333-8333-333333333333',
  displayName: 'Bruno Reis',
  contactEmail: null,
  funcaoIds: [finder.id],
  funcoes: [asPersonFuncao(finder)],
};
const caio: SalesOpsPerson = {
  ...ana,
  id: '44444444-4444-4444-8444-444444444444',
  displayName: 'Caio Inativo',
  contactEmail: null,
  status: 'inactive',
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function render(node: ReactNode) {
  await act(async () => root.render(node));
}

async function change(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

async function submit() {
  const form = container.querySelector('form');
  if (!(form instanceof HTMLFormElement)) throw new Error('form not found');
  await act(async () =>
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
}

function buttonByText(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`button not found: ${label}`);
  return match;
}

function buttonByAriaLabel(label: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
}

function requireButton(label: string): HTMLButtonElement {
  const match = buttonByAriaLabel(label);
  if (!match) throw new Error(`button not found: ${label}`);
  return match;
}

function input(name: string): HTMLInputElement {
  const match = container.querySelector(`input[name="${name}"]`);
  if (!(match instanceof HTMLInputElement)) throw new Error(`input not found: ${name}`);
  return match;
}

function rowOf(name: string): HTMLTableRowElement {
  const match = [...container.querySelectorAll('tbody tr')].find((row) =>
    row.querySelector('td')?.textContent?.includes(name),
  );
  if (!(match instanceof HTMLTableRowElement)) throw new Error(`row not found: ${name}`);
  return match;
}

function viewProps(people: SalesOpsPerson[]) {
  return {
    people,
    onEdit: vi.fn(),
    onInactivate: vi.fn(),
    onReactivate: vi.fn(),
  };
}

function dialogProps(
  patch: Partial<Omit<React.ComponentProps<typeof VendedorDialog>, 'onClose' | 'onSave'>> = {},
) {
  return {
    open: true,
    person: null,
    funcoes: [vendedor],
    saving: false,
    ...patch,
    onClose: vi.fn(),
    onSave: vi.fn<(payload: SavePersonPayload) => void>(),
  };
}

describe('VendedoresView', () => {
  it('lists vendedores with only Nome, E-mail and Ações, inactive ones last and muted', async () => {
    await render(<VendedoresView {...viewProps([caio, ana, bruno])} />);

    const headers = [...container.querySelectorAll('th')].map((th) => th.textContent?.trim());
    expect(headers).toEqual(['Nome', 'E-mail', 'Ações']);

    const names = [...container.querySelectorAll('tbody tr')].map(
      (row) => row.querySelector('td')?.firstChild?.textContent,
    );
    expect(names).toEqual(['Ana Lima', 'Bruno Reis', 'Caio Inativo']);

    const caioRow = rowOf('Caio Inativo');
    expect(caioRow.hasAttribute('data-vendedor-inactive')).toBe(true);
    expect(caioRow.querySelector('[data-vendedor-status-badge]')?.textContent).toBe('Inativo');
    expect(buttonByAriaLabel('Reativar vendedor Caio Inativo')).not.toBeNull();
    expect(buttonByAriaLabel('Editar Caio Inativo')).toBeNull();
    expect(buttonByAriaLabel('Inativar vendedor Caio Inativo')).toBeNull();

    expect(rowOf('Ana Lima').querySelector('[data-vendedor-status-badge]')).toBeNull();
    expect(rowOf('Ana Lima').hasAttribute('data-vendedor-inactive')).toBe(false);
    expect(rowOf('Bruno Reis').querySelector('[data-vendedor-status-badge]')).toBeNull();
    expect(rowOf('Bruno Reis').querySelectorAll('td')[1]?.textContent).toBe('-');

    const text = container.textContent ?? '';
    expect(text).not.toContain('Funções');
    expect(text).not.toContain('Finder');
    expect(text).not.toContain('Vendedor');
    for (const person of [ana, bruno, caio]) expect(text).not.toContain(person.id);
  });

  it('shows the empty state only when no pessoa exists', async () => {
    await render(<VendedoresView {...viewProps([])} />);
    expect(container.querySelector('[data-vendedores-empty]')).not.toBeNull();
    expect(container.textContent).toContain('Nenhum vendedor cadastrado');
    expect(container.textContent).toContain(VENDEDORES_COPY.emptyText);
    expect(container.querySelector('table')).toBeNull();

    await render(<VendedoresView {...viewProps([caio])} />);
    expect(container.querySelector('[data-vendedores-empty]')).toBeNull();
    expect(container.querySelector('table')).not.toBeNull();
    expect(rowOf('Caio Inativo').hasAttribute('data-vendedor-inactive')).toBe(true);
  });

  it('reactivates an inactive vendedor without a confirmation', async () => {
    const props = viewProps([ana, caio]);
    await render(<VendedoresView {...props} />);
    await click(requireButton('Reativar vendedor Caio Inativo'));
    expect(props.onReactivate).toHaveBeenCalledTimes(1);
    expect(props.onReactivate).toHaveBeenCalledWith(caio);
    expect(props.onInactivate).not.toHaveBeenCalled();
    expect(container.querySelector('[data-alert-dialog]')).toBeNull();
  });

  it('opens edit for the clicked row', async () => {
    const props = viewProps([ana, bruno]);
    await render(<VendedoresView {...props} />);
    await click(requireButton('Editar Ana Lima'));
    expect(props.onEdit).toHaveBeenCalledWith(ana);
  });

  it('inactivates only after confirmation', async () => {
    const props = viewProps([ana]);
    await render(<VendedoresView {...props} />);

    await click(requireButton('Inativar vendedor Ana Lima'));
    const dialog = container.querySelector('[data-alert-dialog]');
    expect(dialog?.textContent).toContain('Inativar o vendedor "Ana Lima"?');
    expect(dialog?.textContent).toContain(VENDEDORES_COPY.inactivateBody);
    expect(dialog?.textContent).not.toContain('Geral');
    expect(dialog?.textContent).not.toContain('histórico');
    expect(dialog?.textContent).toContain('reativado nesta tela');

    await click(buttonByText('Voltar'));
    expect(container.querySelector('[data-alert-dialog]')).toBeNull();
    expect(props.onInactivate).not.toHaveBeenCalled();

    await click(requireButton('Inativar vendedor Ana Lima'));
    await click(buttonByText('Inativar vendedor'));
    expect(props.onInactivate).toHaveBeenCalledTimes(1);
    expect(props.onInactivate).toHaveBeenCalledWith(ana);
    expect(container.querySelector('[data-alert-dialog]')).toBeNull();
  });

  it('locks both actions on an optimistic row', async () => {
    const dora: SalesOpsPerson = {
      ...ana,
      id: optimisticId('people', 'Dora'),
      displayName: 'Dora',
    };
    await render(<VendedoresView {...viewProps([dora])} />);
    expect(requireButton('Salvando Dora').disabled).toBe(true);
    expect(requireButton('Inativar vendedor Dora').disabled).toBe(true);
  });
});

describe('VendedorDialog', () => {
  it('renders only Nome and E-mail with the e-mail helper', async () => {
    await render(<VendedorDialog {...dialogProps()} />);

    expect(container.querySelector('h2')?.textContent).toBe('Vendedor');
    expect(container.textContent).toContain(VENDEDORES_COPY.dialogDescription);

    const inputs = [...container.querySelectorAll('form input')] as HTMLInputElement[];
    expect(inputs.map((element) => element.name)).toEqual(['displayName', 'contactEmail']);
    expect(input('contactEmail').type).toBe('email');
    expect(input('contactEmail').getAttribute('aria-describedby')).toBe('vendedor-email-helper');
    expect(container.querySelector('#vendedor-email-helper')?.textContent).toBe(
      'Use o mesmo e-mail com que o vendedor entra no sistema.',
    );
    expect(container.querySelector('button[role="combobox"]')).toBeNull();
    expect(container.textContent).not.toContain('Funções');
    expect(container.textContent).not.toContain('Atribua ao menos uma função.');
  });

  it('saves with a name alone', async () => {
    const props = dialogProps();
    await render(<VendedorDialog {...props} />);

    expect(buttonByText('Salvar').disabled).toBe(true);
    await submit();
    expect(props.onSave).not.toHaveBeenCalled();

    await change(input('displayName'), 'Ana Lima');
    expect(buttonByText('Salvar').disabled).toBe(false);
    await submit();
    expect(props.onSave).toHaveBeenCalledTimes(1);
    expect(props.onSave.mock.calls[0]?.[0]).toEqual({
      id: undefined,
      displayName: 'Ana Lima',
      contactEmail: undefined,
      status: 'active',
      funcaoIds: [vendedor.id],
    });
  });

  it('sends an empty função set when the catalogue has none', async () => {
    const props = dialogProps({ funcoes: [] });
    await render(<VendedorDialog {...props} />);
    await change(input('displayName'), 'Ana Lima');
    await submit();
    expect(props.onSave.mock.calls[0]?.[0]).toMatchObject({ funcaoIds: [] });
  });

  it('prefills and keeps the id when editing', async () => {
    const props = dialogProps({ person: ana });
    await render(<VendedorDialog {...props} />);
    expect(input('displayName').value).toBe('Ana Lima');
    expect(input('contactEmail').value).toBe('ana@construbom.example');
    await submit();
    expect(props.onSave.mock.calls[0]?.[0]).toMatchObject({ id: ana.id, status: 'active' });
  });

  it('disables Salvar while saving', async () => {
    await render(<VendedorDialog {...dialogProps({ person: ana, saving: true })} />);
    expect(buttonByText('Salvar').disabled).toBe(true);
  });

  it('Cancelar closes', async () => {
    const props = dialogProps();
    await render(<VendedorDialog {...props} />);
    await click(buttonByText('Cancelar'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when closed', async () => {
    await render(<VendedorDialog {...dialogProps({ open: false })} />);
    expect(container.innerHTML).toBe('');
  });
});
