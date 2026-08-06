// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import type { HTMLAttributes } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SalesOpsBootstrap, SalesOpsFuncao, SalesOpsPerson } from '../types';

/*
  Resolved through `node:path` rather than `new URL('../SalesOpsApp.tsx', import.meta.url)`:
  this file is `@vitest-environment happy-dom`, so happy-dom's global `URL` resolves against
  the document origin instead of the module's `file:` base, which would turn the expression
  into `http://localhost:3000/...`.
*/
const sourcePath = join(dirname(fileURLToPath(import.meta.url)), '..', 'SalesOpsApp.tsx');
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

import { FuncaoDialog, FuncoesView, PersonDialog, PessoasView } from '../SalesOpsApp';

const act = (
  React as typeof React & { act: typeof import('react-dom/test-utils').act }
).act;

const orgId = '99999999-9999-4999-8999-999999999999';

const funcao = (patch: Partial<SalesOpsFuncao> = {}): SalesOpsFuncao => ({
  id: 'fc000001-0000-4000-8000-000000000001',
  orgId,
  name: 'Vendedor',
  slug: 'vendedor',
  isSystem: true,
  status: 'active',
  createdAt: '2026-07-29T12:00:00.000Z',
  updatedAt: null,
  ...patch,
});

const vendedor = funcao();
const finder = funcao({
  id: 'fc000002-0000-4000-8000-000000000002',
  name: 'Finder',
  slug: 'finder',
});
const designer = funcao({
  id: 'fc000009-0000-4000-8000-000000000009',
  name: 'Designer',
  slug: 'designer',
  isSystem: false,
});

const pessoa = (patch: Partial<SalesOpsPerson> = {}): SalesOpsPerson => ({
  id: '11111111-1111-4111-8111-111111111111',
  orgId,
  displayName: 'Alex Silva',
  contactEmail: 'alex.silva@fxl.example',
  status: 'active',
  funcaoIds: [],
  funcoes: [],
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: null,
  ...patch,
});

/** `funcaoIds` mirrors `funcoes`, exactly as the API returns them. */
const withFuncoes = (
  patch: Partial<SalesOpsPerson>,
  assigned: SalesOpsFuncao[],
): SalesOpsPerson =>
  pessoa({
    ...patch,
    funcaoIds: assigned.map((row) => row.id),
    funcoes: assigned.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      isSystem: row.isSystem,
    })),
  });

function bootstrap(patch: Partial<SalesOpsBootstrap> = {}): SalesOpsBootstrap {
  return {
    sales: [],
    products: [],
    clients: [],
    areas: [],
    funcoes: [],
    people: [],
    payables: [],
    saleItems: [],
    receivables: [],
    productFuncaoCosts: [],
    saleProfessionals: [],
    settings: null,
    ...patch,
  };
}

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

function combobox(label: string): HTMLButtonElement {
  const match = container.querySelector(`button[role="combobox"][aria-label="${label}"]`);
  if (!(match instanceof HTMLButtonElement)) throw new Error(`combobox not found: ${label}`);
  return match;
}

/** The single search input inside the open panel; slice 03 labels it with its placeholder. */
function panelSearch(placeholder: string): HTMLInputElement {
  const match = container.querySelector(`input[aria-label="${placeholder}"]`);
  if (!(match instanceof HTMLInputElement)) throw new Error(`panel search not found`);
  return match;
}

function optionRows(): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[role="option"]')];
}

function createRow(): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-combobox-create="true"]');
}

async function pickOption(label: string, optionLabel: string) {
  await click(combobox(label));
  const row = optionRows().find((candidate) =>
    candidate.textContent?.trim().startsWith(optionLabel),
  );
  if (!row) throw new Error(`option not found: ${optionLabel}`);
  await click(row);
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

function requireNameInput(): HTMLInputElement {
  const match = container.querySelector('form input');
  if (!(match instanceof HTMLInputElement)) throw new Error('name input not found');
  return match;
}

function text(): string {
  return container.textContent ?? '';
}

async function renderPersonDialog(options: {
  person?: SalesOpsPerson;
  funcoes: SalesOpsFuncao[];
  onSave: (payload: unknown) => void;
  onCreateFuncao?: (name: string) => Promise<SalesOpsFuncao | null>;
}) {
  await act(async () => {
    root.render(
      <PersonDialog
        funcoes={options.funcoes}
        modal={{ kind: 'person', person: options.person }}
        onClose={vi.fn()}
        onCreateFuncao={options.onCreateFuncao}
        onSave={options.onSave}
        saving={false}
      />,
    );
  });
}

describe('pessoas cadastro', () => {
  it('lists pessoas with their funções as badges', async () => {
    const sig = withFuncoes(
      { id: '22222222-2222-4222-8222-222222222222', displayName: 'Sig' },
      [vendedor, designer],
    );
    const unassigned = pessoa({
      id: '33333333-3333-4333-8333-333333333333',
      displayName: 'Kayke',
      contactEmail: null,
    });
    const inactive = withFuncoes(
      {
        id: '44444444-4444-4444-8444-444444444444',
        displayName: 'Joao Boldo',
        status: 'inactive',
      },
      [finder],
    );

    await act(async () => {
      root.render(
        <PessoasView
          bootstrap={bootstrap({ funcoes: [vendedor, finder, designer], people: [sig, unassigned, inactive] })}
          onArchive={vi.fn()}
          onEdit={vi.fn()}
        />,
      );
    });

    expect(text()).toContain('Sig');
    expect(text()).toContain('Vendedor');
    expect(text()).toContain('Designer');
    expect(text()).toContain('Ativo');
    expect(text()).toContain('Inativo');

    const dashCell = [...container.querySelectorAll('td')].find(
      (cell) => cell.textContent?.trim() === '-',
    );
    expect(dashCell).toBeTruthy();

    // CLAUDE.md, UI Identifiers: no raw account, workspace or função id is rendered.
    expect(text()).not.toContain(orgId);
    expect(text()).not.toContain(sig.id);
    expect(text()).not.toContain(designer.id);
  });

  it('shows the empty panel when no pessoa exists', async () => {
    await act(async () => {
      root.render(
        <PessoasView bootstrap={bootstrap({ people: [] })} onArchive={vi.fn()} onEdit={vi.fn()} />,
      );
    });

    expect(text()).toContain('Nenhuma pessoa cadastrada');
  });

  it('assigns and removes funções before saving a pessoa', async () => {
    const onSave = vi.fn();
    await renderPersonDialog({ funcoes: [vendedor, finder, designer], onSave });

    await change(requireNameInput(), '  Sig  ');

    await pickOption('Função da pessoa', 'Vendedor');
    expect(buttonByAriaLabel('Remover função Vendedor')).not.toBeNull();

    await pickOption('Função da pessoa', 'Designer');
    expect(buttonByAriaLabel('Remover função Designer')).not.toBeNull();

    await click(buttonByAriaLabel('Remover função Vendedor')!);
    expect(buttonByAriaLabel('Remover função Vendedor')).toBeNull();
    // Positive control: removing one assignment leaves the other alone.
    expect(buttonByAriaLabel('Remover função Designer')).not.toBeNull();

    // Two funções were picked above; committing a Combobox option must never submit the form.
    expect(onSave).not.toHaveBeenCalled();

    await submit();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      id: undefined,
      displayName: 'Sig',
      contactEmail: undefined,
      status: 'active',
      funcaoIds: [designer.id],
    });
  });

  it('assigns a função the moment it is picked, with no confirm button', async () => {
    const onSave = vi.fn();
    await renderPersonDialog({ funcoes: [vendedor, finder, designer], onSave });

    // Button is gone.
    expect(() => buttonByText('Adicionar função')).toThrow();

    await pickOption('Função da pessoa', 'Designer');
    expect(buttonByAriaLabel('Remover função Designer')).not.toBeNull();

    // Picker reset to its placeholder, structurally.
    expect(combobox('Função da pessoa').textContent?.trim()).toBe('Selecione uma função');
    expect(combobox('Função da pessoa').hasAttribute('data-placeholder')).toBe(true);

    // A pick never submits.
    expect(onSave).not.toHaveBeenCalled();

    // A second pick appends rather than replaces.
    await pickOption('Função da pessoa', 'Vendedor');
    expect(buttonByAriaLabel('Remover função Designer')).not.toBeNull();
    expect(buttonByAriaLabel('Remover função Vendedor')).not.toBeNull();

    await click(combobox('Função da pessoa'));
    const offered = optionRows().map((row) => row.textContent?.trim());
    expect(offered).not.toContain('Designer');
    expect(offered).not.toContain('Vendedor');
    // Positive control that the picker still has options at all.
    expect(offered).toContain('Finder');

    await change(requireNameInput(), 'Sig');
    await submit();
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ funcaoIds: [designer.id, vendedor.id] }),
    );
  });

  it('refuses to save a pessoa without a name or without any função', async () => {
    const onSave = vi.fn();
    await renderPersonDialog({ funcoes: [vendedor, designer], onSave });

    await submit();
    expect(onSave).not.toHaveBeenCalled();
    expect(buttonByText('Salvar').disabled).toBe(true);

    await change(requireNameInput(), 'Halland');
    await submit();
    expect(onSave).not.toHaveBeenCalled();
    expect(buttonByText('Salvar').disabled).toBe(true);
    expect(text()).toContain('Atribua ao menos uma função.');

    await pickOption('Função da pessoa', 'Designer');

    expect(buttonByText('Salvar').disabled).toBe(false);
    expect(text()).not.toContain('Atribua ao menos uma função.');
    await submit();
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'Halland', funcaoIds: [designer.id] }),
    );
  });

  it('prefills the funções of the pessoa being edited and keeps its id', async () => {
    const onSave = vi.fn();
    const existing = withFuncoes({}, [vendedor]);
    await renderPersonDialog({ funcoes: [vendedor, finder, designer], onSave, person: existing });

    expect(buttonByAriaLabel('Remover função Vendedor')).not.toBeNull();

    await click(combobox('Função da pessoa'));
    const offered = optionRows().map((row) => row.textContent?.trim());
    expect(offered).not.toContain('Vendedor');
    expect(offered).toContain('Designer');
    const designerRow = optionRows().find((row) => row.textContent?.trim() === 'Designer');
    await click(designerRow!);

    await submit();

    expect(onSave).toHaveBeenCalledWith({
      id: existing.id,
      displayName: 'Alex Silva',
      contactEmail: 'alex.silva@fxl.example',
      status: 'active',
      funcaoIds: [vendedor.id, designer.id],
    });
  });

  it('keeps an archived função a pessoa already carries listed but out of the picker', async () => {
    const onSave = vi.fn();
    const archived = funcao({
      id: 'fc000008-0000-4000-8000-000000000008',
      name: 'Tester',
      slug: 'tester',
      isSystem: false,
      status: 'archived',
    });
    // Archived but NOT assigned, so only the status filter can keep it out of the picker.
    const archivedUnassigned = funcao({
      id: 'fc000007-0000-4000-8000-000000000007',
      name: 'Revisor',
      slug: 'revisor',
      isSystem: false,
      status: 'archived',
    });
    const existing = withFuncoes({}, [archived]);
    await renderPersonDialog({
      funcoes: [vendedor, archived, archivedUnassigned],
      onSave,
      person: existing,
    });

    expect(buttonByAriaLabel('Remover função Tester')).not.toBeNull();

    await click(combobox('Função da pessoa'));
    const offered = optionRows().map((row) => row.textContent?.trim());
    expect(offered).not.toContain('Tester');
    expect(offered).not.toContain('Revisor');
    expect(offered).toContain('Vendedor');
  });

  it('offers a create row for a função that does not exist yet and assigns it', async () => {
    const onSave = vi.fn();
    const created = funcao({
      id: 'fc000010-0000-4000-8000-000000000010',
      name: 'P.O.',
      slug: 'p-o',
      isSystem: false,
    });
    const onCreateFuncao = vi.fn(async () => created);
    await renderPersonDialog({
      funcoes: [vendedor, designer],
      onCreateFuncao,
      onSave,
    });

    await change(requireNameInput(), 'Cauet');

    await click(combobox('Função da pessoa'));
    expect(createRow()).toBeNull();
    await change(panelSearch('Buscar função...'), 'P.O.');
    expect(createRow()!.textContent!.trim()).toBe('+ Criar nova função "P.O."');

    await click(createRow()!);

    expect(onCreateFuncao).toHaveBeenCalledTimes(1);
    expect(onCreateFuncao).toHaveBeenCalledWith('P.O.');
    expect(buttonByAriaLabel('Remover função P.O.')).not.toBeNull();

    await submit();

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'Cauet', funcaoIds: [created.id] }),
    );
  });
});

describe('funções cadastro', () => {
  it('lists funções marking predefinidas and counting assigned pessoas', async () => {
    const one = withFuncoes({ id: '55555555-5555-4555-8555-555555555555', displayName: 'Sig' }, [
      vendedor,
    ]);
    const two = withFuncoes(
      { id: '66666666-6666-4666-8666-666666666666', displayName: 'Halland' },
      [vendedor, designer],
    );

    await act(async () => {
      root.render(
        <FuncoesView
          bootstrap={bootstrap({ funcoes: [vendedor, finder, designer], people: [one, two] })}
          onArchive={vi.fn()}
          onEdit={vi.fn()}
        />,
      );
    });

    expect(text()).toContain('Predefinida');
    expect(text()).toContain('Personalizada');
    expect(text()).toContain('Ativa');

    const rowFor = (name: string) =>
      [...container.querySelectorAll('tbody tr')].find((row) =>
        row.querySelector('td')?.textContent?.trim() === name,
      );
    const cells = (name: string) =>
      [...(rowFor(name)?.querySelectorAll('td') ?? [])].map((cell) => cell.textContent?.trim());

    expect(cells('Vendedor')?.[3]).toBe('2');
    expect(cells('Finder')?.[3]).toBe('0');
    expect(cells('Designer')?.[3]).toBe('1');

    // CLAUDE.md, UI Identifiers: no raw workspace or função id is rendered.
    expect(text()).not.toContain(orgId);
    expect(text()).not.toContain(designer.id);
    expect(text()).not.toContain(one.id);
  });

  it('shows the empty panel when no função exists', async () => {
    await act(async () => {
      root.render(
        <FuncoesView bootstrap={bootstrap({ funcoes: [] })} onArchive={vi.fn()} onEdit={vi.fn()} />,
      );
    });

    expect(text()).toContain('Nenhuma função cadastrada');
  });

  it('offers no edit affordance for a system função', async () => {
    const onEdit = vi.fn();

    await act(async () => {
      root.render(
        <FuncoesView
          bootstrap={bootstrap({ funcoes: [vendedor, finder, designer] })}
          onArchive={vi.fn()}
          onEdit={onEdit}
        />,
      );
    });

    const editDesigner = buttonByAriaLabel('Editar Designer');
    expect(editDesigner).not.toBeNull();
    expect(editDesigner!.disabled).toBe(false);
    await click(editDesigner!);
    expect(onEdit).toHaveBeenCalledWith(designer);

    onEdit.mockClear();
    expect(buttonByAriaLabel('Editar Vendedor')).toBeNull();
    expect(buttonByAriaLabel('Editar Finder')).toBeNull();
    const locked = buttonByAriaLabel('Função predefinida do app');
    expect(locked).not.toBeNull();
    expect(locked!.disabled).toBe(true);
    await click(locked!);
    expect(onEdit).not.toHaveBeenCalled();
  });

  /*
    The `Status` picker left this dialog in slice 03, same as the área dialog: a
    create always resolves to `'active'` through the `??` on `modal.funcao?.status`,
    and archiving is the row action behind its confirmation.
  */
  it('creates a custom função submitting the trimmed name', async () => {
    const onSave = vi.fn();

    await act(async () => {
      root.render(
        <FuncaoDialog modal={{ kind: 'funcao' }} onClose={vi.fn()} onSave={onSave} saving={false} />,
      );
    });

    await change(requireNameInput(), '  Designer  ');

    await submit();

    expect(onSave).toHaveBeenCalledWith({ id: undefined, name: 'Designer', status: 'active' });
  });

  it('edits a custom função keeping its id and locks a system one', async () => {
    const onSave = vi.fn();

    await act(async () => {
      root.render(
        <FuncaoDialog
          modal={{ kind: 'funcao', funcao: designer }}
          onClose={vi.fn()}
          onSave={onSave}
          saving={false}
        />,
      );
    });

    expect(requireNameInput().disabled).toBe(false);
    await change(requireNameInput(), 'Design Lead');
    await submit();
    expect(onSave).toHaveBeenCalledWith({
      id: designer.id,
      name: 'Design Lead',
      status: 'active',
    });

    onSave.mockClear();
    await act(async () => {
      root.render(
        <FuncaoDialog
          modal={{ kind: 'funcao', funcao: vendedor }}
          onClose={vi.fn()}
          onSave={onSave}
          saving={false}
        />,
      );
    });

    expect(requireNameInput().disabled).toBe(true);
    expect(buttonByText('Salvar').disabled).toBe(true);
    // The status Combobox is gone from this dialog entirely, so there is nothing
    // left to assert as disabled - only the name input and Salvar remain.
    expect(text()).toContain('Função predefinida do app');
    await submit();
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('pessoa dialog UI contract', () => {
  it('leaves no `Adicionar função` confirm button behind in the pessoa dialog', () => {
    // Positive controls, so the negatives below are about markup that was removed
    // rather than markup that never existed.
    expect(source).toContain('Função da pessoa');
    expect(source).toContain('Selecione uma função');
    expect(source).toContain('Buscar função...');

    expect(source).not.toContain('Adicionar função');
    // The dead parking state cannot come back.
    expect(source).not.toContain('pendingFuncaoId');

    // The create row and the active filter survive the button's removal.
    expect(source).toContain('handleCreateFuncao');
    expect(source).toContain("funcao.status === 'active' && !assignedIds.includes(funcao.id)");
  });

  /*
    Slice 03 left exactly ONE door to a cadastro's status: the row's `Arquivar`
    control behind its confirmation. A `Status` picker reinstated in any of these
    three dialogs would be a second door and would let an edit silently reactivate
    an archived row on `Salvar` - the produto bug, generalised.
  */
  it('leaves no `Status` picker behind in the área, função or pessoa dialogs', () => {
    // Positive control: the row-level affordance that replaced them really exists.
    expect(source).toContain('CadastroArchiveButton');
    expect(source).toContain('cadastroArchive');

    expect(source).not.toContain('Status da área');
    expect(source).not.toContain('Status da função');
    expect(source).not.toContain('Status da pessoa');
  });
});
