// @vitest-environment happy-dom

/**
 * Slice 03 oracle - the archive/restore affordance on the cadastros.
 *
 * What this file exists to prove, in order:
 *   A. the transport is a status-only PATCH on the endpoint that already exists,
 *      and never a DELETE - `salesOpsRouter` has no DELETE verb and must not gain one;
 *   B. archiving passes a confirmation that names the record, and cancelling writes nothing;
 *   C. a system função (`vendedor` / `finder`) has NO archive affordance at all, not even
 *      a disabled one, because the API answers `409 funcao_is_system`;
 *   D. no cadastro dialog owns `status` any more, so an edit can never silently
 *      reactivate an archived row;
 *   E. an archived produto leaves the proposta wizard picker but keeps naming the item
 *      that already references it.
 *
 * Block B additionally carries the v2.6.0 slice-01 inversion: an archived row is not
 * listed AT ALL in any of the four cadastros, and the row-level `Restaurar` that used
 * to sit on it is gone, because restore now lives only in `Histórico de arquivamentos`.
 */

import * as React from 'react';
import type { HTMLAttributes, ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CreateSalePayload,
  SalesOpsArea,
  SalesOpsBootstrap,
  SalesOpsFuncao,
  SalesOpsPerson,
  SalesOpsProduct,
  SalesOpsSale,
} from '../types';

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
  The CloseCtx version, copied from sales-transition-actions.test.tsx: without it
  `AlertDialogCancel` renders as an inert button and "cancelling writes nothing"
  would pass even if the cancel never closed the confirmation.
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

import { salesOpsApi } from '../api';
import {
  AreaDialog,
  AreasView,
  FuncaoDialog,
  FuncoesView,
  PersonDialog,
  PessoasView,
  ProductDialog,
  ProductsView,
  SaleWizardDialog,
} from '../SalesOpsApp';

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

const orgId = 'org-test';
const AREA_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const AREA_ARCHIVED_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const PERSON_ID = '22222222-2222-4222-8222-222222222222';
const FUNCAO_DESIGNER_ID = 'fc000009-0000-4000-8000-000000000009';

const area = (patch: Partial<SalesOpsArea> = {}): SalesOpsArea => ({
  id: AREA_ID,
  orgId,
  name: 'FXL Tech',
  status: 'active',
  createdAt: '2026-07-29T12:00:00.000Z',
  updatedAt: null,
  ...patch,
});

const archivedArea = area({
  id: AREA_ARCHIVED_ID,
  name: 'FXL Visual',
  status: 'archived',
});

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
  id: FUNCAO_DESIGNER_ID,
  name: 'Designer',
  slug: 'designer',
  isSystem: false,
});

const pessoa = (patch: Partial<SalesOpsPerson> = {}): SalesOpsPerson => ({
  id: PERSON_ID,
  orgId,
  displayName: 'Alex Silva',
  contactEmail: 'alex.silva@fxl.example',
  status: 'active',
  funcaoIds: [designer.id],
  funcoes: [{ id: designer.id, name: designer.name, slug: designer.slug, isSystem: false }],
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: null,
  ...patch,
});

const product = (patch: Partial<SalesOpsProduct> = {}): SalesOpsProduct => ({
  id: PRODUCT_ID,
  orgId,
  name: 'FXL Finance',
  kind: 'product',
  codeSuffix: '7',
  areaId: AREA_ID,
  openPrice: false,
  setupBrl: 100000,
  hasMonthly: false,
  monthlyBrl: 0,
  recurringCommission: false,
  hasFinderCommission: false,
  sellerCommissionType: 'pct',
  sellerCommissionValue: '10.00',
  sellerWithFinderCommissionType: 'pct',
  sellerWithFinderCommissionValue: '7.00',
  finderCommissionType: 'pct',
  finderCommissionValue: '3.00',
  defaultPaymentMethod: 'pix',
  defaultEntradaMode: 'none',
  defaultEntradaPct: null,
  defaultEntradaBrl: null,
  defaultRemainingInstallments: 1,
  defaultRecurringCycles: null,
  modules: [],
  providers: [],
  status: 'active',
  createdAt: '2026-07-29T12:00:00.000Z',
  updatedAt: null,
  ...patch,
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
let onArchive: ReturnType<typeof vi.fn>;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  onArchive = vi.fn();
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

function text(): string {
  return container.textContent ?? '';
}

function buttonByAriaLabel(label: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
}

function requireButtonByAriaLabel(label: string): HTMLButtonElement {
  const match = buttonByAriaLabel(label);
  if (!match) throw new Error(`button not found: ${label}`);
  return match;
}

function buttonByText(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`button not found: ${label}`);
  return match;
}

/**
 * The confirmation renders after the table in DOM order and may share its label
 * with a row control, so the confirm action is always the LAST matching button.
 */
function confirmActionButton(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')]
    .filter((candidate) => candidate.textContent?.trim() === label)
    .at(-1);
  if (!(match instanceof HTMLButtonElement)) throw new Error(`confirm button not found: ${label}`);
  return match;
}

function comboboxTrigger(ariaLabel: string): HTMLButtonElement {
  const match = container.querySelector(`button[role="combobox"][aria-label="${ariaLabel}"]`);
  if (!(match instanceof HTMLButtonElement)) throw new Error(`combobox not found: ${ariaLabel}`);
  return match;
}

function optionLabels(): string[] {
  return [...container.querySelectorAll<HTMLElement>('[role="option"]')].map(
    (row) => row.textContent?.trim() ?? '',
  );
}

// ───────────────────────────── Block A - transport ──────────────────────────────

describe('cadastro archive transport', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function lastCall(): { url: string; init: RequestInit } {
    const call = fetchMock.mock.calls.at(-1);
    if (!call) throw new Error('fetch was never called');
    return { url: String(call[0]), init: call[1] as RequestInit };
  }

  function lastBody(): Record<string, unknown> {
    return JSON.parse(String(lastCall().init.body)) as Record<string, unknown>;
  }

  it('archives a produto with a status-only PATCH', async () => {
    await salesOpsApi.setCadastroStatus(
      { resource: 'products', id: PRODUCT_ID, status: 'archived' },
      'test-token',
    );

    const { url, init } = lastCall();
    expect(url.endsWith(`/api/v1/sales-ops/products/${PRODUCT_ID}`)).toBe(true);
    expect(init.method).toBe('PATCH');
    expect(lastBody()).toEqual({ status: 'archived' });
  });

  it('uses the same PATCH shape for área, função and pessoa', async () => {
    await salesOpsApi.setCadastroStatus(
      { resource: 'areas', id: AREA_ID, status: 'archived' },
      'test-token',
    );
    expect(lastCall().url.endsWith(`/api/v1/sales-ops/areas/${AREA_ID}`)).toBe(true);
    expect(lastBody()).toEqual({ status: 'archived' });

    await salesOpsApi.setCadastroStatus(
      { resource: 'funcoes', id: FUNCAO_DESIGNER_ID, status: 'archived' },
      'test-token',
    );
    expect(lastCall().url.endsWith(`/api/v1/sales-ops/funcoes/${FUNCAO_DESIGNER_ID}`)).toBe(true);
    expect(lastBody()).toEqual({ status: 'archived' });

    // A pessoa stores `inactive`, not `archived`; sending `archived` would be stripped by zod.
    await salesOpsApi.setCadastroStatus(
      { resource: 'people', id: PERSON_ID, status: 'inactive' },
      'test-token',
    );
    expect(lastCall().url.endsWith(`/api/v1/sales-ops/people/${PERSON_ID}`)).toBe(true);
    expect(lastBody()).toEqual({ status: 'inactive' });
  });

  it('never issues a DELETE and never sends a body key other than status', async () => {
    await salesOpsApi.setCadastroStatus(
      { resource: 'products', id: PRODUCT_ID, status: 'archived' },
      'test-token',
    );
    await salesOpsApi.setCadastroStatus(
      { resource: 'people', id: PERSON_ID, status: 'inactive' },
      'test-token',
    );

    for (const call of fetchMock.mock.calls) {
      const init = call[1] as RequestInit;
      expect(init.method).not.toBe('DELETE');
      // The real guard: a smuggled name or funcaoIds key would let an archive
      // write back a stale cached value as a side effect.
      expect(Object.keys(JSON.parse(String(init.body)))).toEqual(['status']);
    }
  });

  it('restores with the same endpoint and status active', async () => {
    await salesOpsApi.setCadastroStatus(
      { resource: 'funcoes', id: FUNCAO_DESIGNER_ID, status: 'active' },
      'test-token',
    );

    const { url, init } = lastCall();
    expect(url.endsWith(`/api/v1/sales-ops/funcoes/${FUNCAO_DESIGNER_ID}`)).toBe(true);
    expect(init.method).toBe('PATCH');
    expect(lastBody()).toEqual({ status: 'active' });
  });
});

// ─────────────────────── Block B - the confirmation gate ────────────────────────

describe('cadastro archive confirmation', () => {
  async function renderProducts(products: SalesOpsProduct[], kind: 'product' | 'service') {
    await act(async () => {
      root.render(
        <ProductsView
          areas={[area()]}
          funcaoCosts={[]}
          funcoes={[designer]}
          kind={kind}
          onArchive={onArchive}
          onEdit={vi.fn()}
          onKindChange={vi.fn()}
          products={products}
        />,
      );
    });
  }

  async function renderAreas(areas: SalesOpsArea[]) {
    await act(async () => {
      root.render(
        <AreasView bootstrap={bootstrap({ areas })} onArchive={onArchive} onEdit={vi.fn()} />,
      );
    });
  }

  async function renderFuncoes(funcoes: SalesOpsFuncao[]) {
    await act(async () => {
      root.render(
        <FuncoesView bootstrap={bootstrap({ funcoes })} onArchive={onArchive} onEdit={vi.fn()} />,
      );
    });
  }

  async function renderPessoas(people: SalesOpsPerson[]) {
    await act(async () => {
      root.render(
        <PessoasView bootstrap={bootstrap({ people })} onArchive={onArchive} onEdit={vi.fn()} />,
      );
    });
  }

  it('requires a confirmation before archiving a produto', async () => {
    await renderProducts([product()], 'product');

    await click(requireButtonByAriaLabel('Arquivar produto FXL Finance'));
    expect(onArchive).not.toHaveBeenCalled();
    expect(text()).toContain('Arquivar o produto "FXL Finance"?');
    expect(text()).toContain('continua nas propostas que já o utilizam');

    await click(confirmActionButton('Arquivar produto'));
    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(onArchive).toHaveBeenCalledWith({
      cadastro: 'produto',
      id: PRODUCT_ID,
      name: 'FXL Finance',
      status: 'archived',
    });
  });

  it('requires a confirmation before archiving an área', async () => {
    await renderAreas([area()]);

    await click(requireButtonByAriaLabel('Arquivar área FXL Tech'));
    expect(onArchive).not.toHaveBeenCalled();
    expect(text()).toContain('Arquivar a área "FXL Tech"?');

    await click(confirmActionButton('Arquivar área'));
    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(onArchive).toHaveBeenCalledWith({
      cadastro: 'area',
      id: AREA_ID,
      name: 'FXL Tech',
      status: 'archived',
    });
  });

  it('requires a confirmation before archiving a função', async () => {
    await renderFuncoes([designer]);

    await click(requireButtonByAriaLabel('Arquivar função Designer'));
    expect(onArchive).not.toHaveBeenCalled();
    expect(text()).toContain('Arquivar a função "Designer"?');

    await click(confirmActionButton('Arquivar função'));
    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(onArchive).toHaveBeenCalledWith({
      cadastro: 'funcao',
      id: FUNCAO_DESIGNER_ID,
      name: 'Designer',
      status: 'archived',
    });
  });

  it('uses the pessoa vocabulary for a pessoa', async () => {
    await renderPessoas([pessoa()]);

    expect(buttonByAriaLabel('Arquivar pessoa Alex Silva')).toBeNull();
    await click(requireButtonByAriaLabel('Inativar pessoa Alex Silva'));
    expect(text()).toContain('Inativar a pessoa "Alex Silva"?');

    await click(confirmActionButton('Inativar pessoa'));
    expect(onArchive).toHaveBeenCalledWith({
      cadastro: 'pessoa',
      id: PERSON_ID,
      name: 'Alex Silva',
      status: 'inactive',
    });
  });

  it('names the serviço bucket when the row is a serviço', async () => {
    const servico = product({
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Consultoria',
      kind: 'service',
      openPrice: true,
      setupBrl: 0,
    });
    await renderProducts([servico], 'service');

    expect(buttonByAriaLabel('Arquivar serviço Consultoria')).not.toBeNull();
    expect(buttonByAriaLabel('Arquivar produto Consultoria')).toBeNull();

    await click(requireButtonByAriaLabel('Arquivar serviço Consultoria'));
    expect(text()).toContain('Arquivar o serviço "Consultoria"?');
    await click(confirmActionButton('Arquivar serviço'));
    expect(onArchive).toHaveBeenCalledWith({
      cadastro: 'servico',
      id: servico.id,
      name: 'Consultoria',
      status: 'archived',
    });
  });

  it('cancelling the confirmation archives nothing', async () => {
    await renderProducts([product()], 'product');

    await click(requireButtonByAriaLabel('Arquivar produto FXL Finance'));
    expect(text()).toContain('Arquivar o produto "FXL Finance"?');

    await click(buttonByText('Voltar'));

    expect(onArchive).not.toHaveBeenCalled();
    expect(text()).not.toContain('Arquivar o produto "FXL Finance"?');
  });

  it('the archive control is type="button"', async () => {
    // happy-dom's dispatchEvent never runs a click's activation behaviour, so a
    // click test cannot see a button whose type makes it submit. Assert the attribute.
    await renderAreas([area()]);

    expect(requireButtonByAriaLabel('Arquivar área FXL Tech').type).toBe('button');
  });

  /*
    Slice 01 - archived rows leave the four cadastro lists entirely. The inverse of
    what this file used to assert: an archived row no longer renders a badge, it does
    not render at all, and the row-level `Restaurar` that slice 03 put on it is gone
    with it. Restore now exists in exactly one place, `Histórico de arquivamentos`.
  */
  it('does not list an archived área, and offers no row-level restore', async () => {
    await renderAreas([area(), archivedArea]);

    expect(text()).toContain('FXL Tech');
    expect(text()).not.toContain('FXL Visual');
    expect(text()).not.toContain('Arquivada');
    expect(buttonByAriaLabel('Restaurar área FXL Visual')).toBeNull();
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('does not list an archived produto, and offers no row-level restore', async () => {
    const archivedProduct = product({
      id: '77777777-7777-4777-8777-777777777777',
      name: 'FXL Legado',
      codeSuffix: '3',
      status: 'archived',
    });
    await renderProducts([product(), archivedProduct], 'product');

    expect(text()).toContain('FXL Finance');
    expect(text()).not.toContain('FXL Legado');
    expect(text()).not.toContain('Arquivado');
    expect(buttonByAriaLabel('Restaurar produto FXL Legado')).toBeNull();
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('does not list an archived função, and offers no row-level restore', async () => {
    const archivedFuncao = funcao({
      id: 'fc000007-0000-4000-8000-000000000007',
      name: 'Tester',
      slug: 'tester',
      isSystem: false,
      status: 'archived',
    });
    await renderFuncoes([designer, archivedFuncao]);

    expect(text()).toContain('Designer');
    expect(text()).not.toContain('Tester');
    expect(text()).not.toContain('Arquivada');
    expect(buttonByAriaLabel('Restaurar função Tester')).toBeNull();
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('does not list an inactive pessoa, and offers no row-level reactivation', async () => {
    const inactive = pessoa({
      id: '88888888-8888-4888-8888-888888888888',
      displayName: 'Joao Boldo',
      status: 'inactive',
    });
    await renderPessoas([pessoa(), inactive]);

    expect(text()).toContain('Alex Silva');
    expect(text()).not.toContain('Joao Boldo');
    expect(text()).not.toContain('Inativo');
    expect(buttonByAriaLabel('Reativar pessoa Joao Boldo')).toBeNull();
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('renders no restore affordance at all in any of the four lists', async () => {
    const restoreControls = () =>
      [...container.querySelectorAll('button')].filter((candidate) =>
        /^(Restaurar|Reativar) /.test(candidate.getAttribute('aria-label') ?? ''),
      );

    await renderProducts([product(), product({ id: '99999999-9999-4999-8999-999999999999', name: 'FXL Legado', status: 'archived' })], 'product');
    expect(restoreControls()).toHaveLength(0);

    await renderAreas([area(), archivedArea]);
    expect(restoreControls()).toHaveLength(0);

    await renderFuncoes([designer, funcao({ id: 'fc000006-0000-4000-8000-000000000006', name: 'Tester', slug: 'tester', isSystem: false, status: 'archived' })]);
    expect(restoreControls()).toHaveLength(0);

    await renderPessoas([pessoa(), pessoa({ id: 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1', displayName: 'Joao Boldo', status: 'inactive' })]);
    expect(restoreControls()).toHaveLength(0);
  });
});

// ───────────────── Block C - no affordance for a system função ──────────────────

describe('cadastro archive guards', () => {
  it('offers no archive affordance for vendedor or finder', async () => {
    await act(async () => {
      root.render(
        <FuncoesView
          bootstrap={bootstrap({ funcoes: [vendedor, finder, designer] })}
          onArchive={onArchive}
          onEdit={vi.fn()}
        />,
      );
    });

    expect(buttonByAriaLabel('Arquivar função Vendedor')).toBeNull();
    expect(buttonByAriaLabel('Arquivar função Finder')).toBeNull();
    expect(buttonByAriaLabel('Restaurar função Vendedor')).toBeNull();
    expect(buttonByAriaLabel('Restaurar função Finder')).toBeNull();

    // Positive control: the affordance exists at all, so the negatives above are
    // about the system flag and not about a control that was never rendered.
    expect(buttonByAriaLabel('Arquivar função Designer')).not.toBeNull();

    // The existing lock stays, and it is still the only thing in that cell.
    const locked = requireButtonByAriaLabel('Função predefinida do app');
    expect(locked.disabled).toBe(true);
    await click(locked);
    expect(onArchive).not.toHaveBeenCalled();
  });

  it('offers no archive affordance for an optimistic row', async () => {
    const optimistic = area({ id: 'optimistic:areas:Nova', name: 'Nova' });
    await act(async () => {
      root.render(
        <AreasView
          bootstrap={bootstrap({ areas: [optimistic] })}
          onArchive={onArchive}
          onEdit={vi.fn()}
        />,
      );
    });

    const control = requireButtonByAriaLabel('Arquivar área Nova');
    expect(control.disabled).toBe(true);
    await click(control);
    expect(onArchive).not.toHaveBeenCalled();
    expect(text()).not.toContain('Arquivar a área "Nova"?');
  });
});

// ─────────────── Block D - the dialogs no longer own the status ─────────────────

describe('cadastro dialogs no longer own status', () => {
  function statusCombobox(): Element | null {
    return container.querySelector('button[role="combobox"][aria-label^="Status d"]');
  }

  it('a produto edit never rewrites the stored status', async () => {
    const onSave = vi.fn();
    const archived = product({ status: 'archived' });

    await act(async () => {
      root.render(
        <ProductDialog
          areas={[area()]}
          funcaoCosts={[]}
          funcoes={[designer]}
          modal={{ kind: 'product', product: archived }}
          onClose={vi.fn()}
          onSave={onSave}
          products={[archived]}
          saving={false}
        />,
      );
    });

    await submit();

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ status: 'archived' }));
  });

  it('a produto create still submits active', async () => {
    const onSave = vi.fn();

    await act(async () => {
      root.render(
        <ProductDialog
          areas={[area()]}
          funcaoCosts={[]}
          funcoes={[designer]}
          modal={{ kind: 'product' }}
          onClose={vi.fn()}
          onSave={onSave}
          products={[]}
          saving={false}
        />,
      );
    });

    const nameInput = container.querySelector('input[placeholder="Nome"]');
    if (!(nameInput instanceof HTMLInputElement)) throw new Error('name input not found');
    await change(nameInput, 'FXL Novo');

    await click(comboboxTrigger('Área do produto'));
    const areaRow = [...container.querySelectorAll('[role="option"]')].find((row) =>
      row.textContent?.trim().startsWith('FXL Tech'),
    );
    await click(areaRow!);

    await submit();

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }));
  });

  it('the área dialog offers no status picker and keeps the stored status', async () => {
    const onSave = vi.fn();
    await act(async () => {
      root.render(
        <AreaDialog
          modal={{ kind: 'area', area: archivedArea }}
          onClose={vi.fn()}
          onSave={onSave}
          saving={false}
        />,
      );
    });

    expect(statusCombobox()).toBeNull();
    await submit();
    expect(onSave).toHaveBeenCalledWith({
      id: AREA_ARCHIVED_ID,
      name: 'FXL Visual',
      status: 'archived',
    });
  });

  it('the função dialog offers no status picker and keeps the stored status', async () => {
    const onSave = vi.fn();
    const archivedFuncao = funcao({
      id: 'fc000008-0000-4000-8000-000000000008',
      name: 'Tester',
      slug: 'tester',
      isSystem: false,
      status: 'archived',
    });

    await act(async () => {
      root.render(
        <FuncaoDialog
          modal={{ kind: 'funcao', funcao: archivedFuncao }}
          onClose={vi.fn()}
          onSave={onSave}
          saving={false}
        />,
      );
    });

    expect(statusCombobox()).toBeNull();
    await submit();
    expect(onSave).toHaveBeenCalledWith({
      id: archivedFuncao.id,
      name: 'Tester',
      status: 'archived',
    });
  });

  it('the pessoa dialog offers no status picker and keeps the stored status', async () => {
    const onSave = vi.fn();
    const inactive = pessoa({ status: 'inactive' });

    await act(async () => {
      root.render(
        <PersonDialog
          funcoes={[designer]}
          modal={{ kind: 'person', person: inactive }}
          onClose={vi.fn()}
          onSave={onSave}
          saving={false}
        />,
      );
    });

    expect(statusCombobox()).toBeNull();
    await submit();
    expect(onSave).toHaveBeenCalledWith({
      id: PERSON_ID,
      displayName: 'Alex Silva',
      contactEmail: 'alex.silva@fxl.example',
      status: 'inactive',
      funcaoIds: [designer.id],
    });
  });
});

// ──────────── Block E - an archived produto leaves the wizard picker ────────────

describe('archived produto and the proposta wizard picker', () => {
  const LEGACY_ID = '44444444-4444-4444-8444-444444444444';
  const SALE_ID = '55555555-5555-4555-8555-555555555555';

  const activeProduct = product();
  const archivedProduct = product({
    id: LEGACY_ID,
    name: 'FXL Legado',
    codeSuffix: '3',
    status: 'archived',
  });

  const editSale: SalesOpsSale = {
    id: SALE_ID,
    orgId,
    sequence: 1,
    code: 'V-0001',
    clientId: null,
    clientNameSnapshot: 'SegPro',
    sellerPersonId: null,
    sellerNameSnapshot: '',
    finderPersonId: null,
    finderNameSnapshot: null,
    status: 'open',
    paymentMethod: 'pix',
    condition: 'installments',
    installments: 1,
    baseDate: '2026-07-10',
    notes: null,
    wonAt: null,
    lostAt: null,
    totalBrl: 100000,
    recurringBrl: 0,
    sellerCommissionPct: '10',
    finderCommissionPct: '0',
    taxPct: '6',
    otherCostsBrl: 0,
    professionalCostsBrl: 0,
    sellerCommissionBrl: 10000,
    finderCommissionBrl: 0,
    taxBrl: 6000,
    netMarginBrl: 84000,
    netMarginPct: '84',
    createdAt: '2026-07-10T12:00:00.000Z',
    updatedAt: null,
  };

  /** The wizard refuses to render step 1 without at least one produto AND one vendedor. */
  const vendedorPerson = pessoa({
    id: '66666666-6666-4666-8666-666666666666',
    displayName: 'Ana Martins',
    contactEmail: null,
    funcaoIds: [vendedor.id],
    funcoes: [{ id: vendedor.id, name: vendedor.name, slug: vendedor.slug, isSystem: true }],
  });

  function wizardBootstrap(patch: Partial<SalesOpsBootstrap> = {}): SalesOpsBootstrap {
    return bootstrap({
      products: [activeProduct, archivedProduct],
      areas: [area()],
      funcoes: [vendedor, designer],
      people: [pessoa(), vendedorPerson],
      ...patch,
    });
  }

  async function renderWizard(sale: SalesOpsSale | null, data: SalesOpsBootstrap) {
    await act(async () => {
      root.render(
        <SaleWizardDialog
          bootstrap={data}
          editSale={sale}
          onClose={vi.fn()}
          onSave={vi.fn<(payload: CreateSalePayload) => void>()}
          open
          saving={false}
        />,
      );
    });
  }

  it('keeps an archived produto out of the picker on a new proposta', async () => {
    await renderWizard(null, wizardBootstrap());

    await click(comboboxTrigger('Produto / serviço do item 1'));
    const offered = optionLabels();
    expect(offered.some((label) => label.startsWith('FXL Finance'))).toBe(true);
    expect(offered.some((label) => label.startsWith('FXL Legado'))).toBe(false);
  });

  it('still names the archived produto on the item that already references it', async () => {
    await renderWizard(
      editSale,
      wizardBootstrap({
        sales: [editSale],
        saleItems: [
          {
            id: 'item-1',
            saleId: SALE_ID,
            productId: LEGACY_ID,
            productNameSnapshot: 'FXL Legado',
            productTypeSnapshot: '',
            quantity: 1,
            unitBrl: 100000,
            subtotalBrl: 100000,
          },
        ],
        receivables: [
          {
            id: 'rec-1',
            saleId: SALE_ID,
            label: '1/1',
            dueDate: '2026-07-10',
            amountBrl: 100000,
            method: 'pix',
            status: 'open',
          },
        ],
      }),
    );

    expect(comboboxTrigger('Produto / serviço do item 1').textContent?.trim()).toBe(
      'FXL Legado (arquivado)',
    );

    await click(comboboxTrigger('Produto / serviço do item 1'));
    const offered = optionLabels();
    expect(offered.some((label) => label.startsWith('FXL Legado (arquivado)'))).toBe(true);
    expect(offered.some((label) => label.startsWith('FXL Finance'))).toBe(true);
  });
});
