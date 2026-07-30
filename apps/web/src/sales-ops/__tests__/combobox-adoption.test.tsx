// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import type { HTMLAttributes } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductDialog, SaleWizardDialog } from '../SalesOpsApp';
import type { SaveProductPayload } from '../api';
import type {
  CreateSalePayload,
  SalesOpsArea,
  SalesOpsBootstrap,
  SalesOpsClient,
  SalesOpsFuncao,
  SalesOpsPersonFuncao,
  SalesOpsProduct,
} from '../types';

/**
 * Funções replace the three removed `is_seller` / `is_finder` / `is_collaborator`
 * mirrors on a pessoa. `vendedor` and `finder` are the two predefined system funções;
 * `prestador` is an ordinary custom one, which is what makes a pessoa a prestador.
 */
const funcaoVendedor: SalesOpsPersonFuncao = {
  id: 'fc000001-0000-4000-8000-000000000001',
  name: 'Vendedor',
  slug: 'vendedor',
  isSystem: true,
};
const funcaoFinder: SalesOpsPersonFuncao = {
  id: 'fc000002-0000-4000-8000-000000000002',
  name: 'Finder',
  slug: 'finder',
  isSystem: true,
};
const funcaoPrestador: SalesOpsPersonFuncao = {
  id: 'fc000003-0000-4000-8000-000000000003',
  name: 'Prestador',
  slug: 'prestador',
  isSystem: false,
};

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

const act = (
  React as typeof React & { act: typeof import('react-dom/test-utils').act }
).act;

const areaTechId = '66666666-6666-4666-8666-666666666666';
const areaConsultoriaId = '77777777-7777-4777-8777-777777777777';
const financeProductId = '11111111-1111-4111-8111-111111111111';
const advisorProductId = '22222222-2222-4222-8222-222222222222';
const segproClientId = '33333333-3333-4333-8333-333333333333';
const sellerId = '44444444-4444-4444-8444-444444444444';
const collaboratorId = '99999999-9999-4999-8999-999999999999';

function product(patch: Partial<SalesOpsProduct> = {}): SalesOpsProduct {
  return {
    id: financeProductId,
    orgId: 'org-test',
    name: 'FXL Finance',
    codeSuffix: 'FIN',
    areaId: areaTechId,
    openPrice: false,
    setupBrl: 250000,
    hasMonthly: false,
    monthlyBrl: 0,
    recurringCommission: false,
    hasFinderCommission: false,
    sellerCommissionType: 'pct',
    sellerCommissionValue: '10',
    sellerWithFinderCommissionType: 'pct',
    sellerWithFinderCommissionValue: '7',
    finderCommissionType: 'pct',
    finderCommissionValue: '3',
    modules: [],
    providers: [],
    status: 'active',
    createdAt: '2026-07-29T12:00:00.000Z',
    updatedAt: null,
    ...patch,
  };
}

const area = (patch: Partial<SalesOpsArea> = {}): SalesOpsArea => ({
  id: areaTechId,
  orgId: 'org-test',
  name: 'FXL Tech',
  status: 'active',
  createdAt: '2026-07-29T12:00:00.000Z',
  updatedAt: null,
  ...patch,
});

function baseBootstrap(patch: Partial<SalesOpsBootstrap> = {}): SalesOpsBootstrap {
  return {
    sales: [],
    products: [
      product(),
      product({
        id: advisorProductId,
        name: 'FXL Advisor',
        areaId: areaConsultoriaId,
        setupBrl: 990000,
      }),
    ],
    clients: [
      {
        id: segproClientId,
        orgId: 'org-test',
        name: 'SegPro',
        contact: null,
        createdAt: '2026-07-29T12:00:00.000Z',
        updatedAt: null,
      },
    ],
    people: [
      {
        id: sellerId,
        orgId: 'org-test',
        displayName: 'Ana Martins',
        contactEmail: null,
        status: 'active',
        funcaoIds: [funcaoVendedor.id, funcaoFinder.id],
        funcoes: [funcaoVendedor, funcaoFinder],
        createdAt: '2026-07-29T12:00:00.000Z',
        updatedAt: null,
      },
      {
        id: collaboratorId,
        orgId: 'org-test',
        displayName: 'Carla Prestadora',
        contactEmail: null,
        status: 'active',
        funcaoIds: [funcaoFinder.id, funcaoPrestador.id],
        funcoes: [funcaoFinder, funcaoPrestador],
        createdAt: '2026-07-29T12:00:00.000Z',
        updatedAt: null,
      },
    ],
    areas: [area(), area({ id: areaConsultoriaId, name: 'FXL Consultoria' })],
    // `FUNÇÃO NO PROJETO` is a Combobox over this cadastro now, so the wizard needs
    // at least one active função for a profissional row to be completable.
    funcoes: [
      {
        ...funcaoPrestador,
        orgId: 'org-test',
        status: 'active' as const,
        createdAt: '2026-07-29T12:00:00.000Z',
        updatedAt: null,
      },
    ],
    payables: [],
    saleItems: [],
    receivables: [],
    productFuncaoCosts: [],
    saleProfessionals: [],
    settings: {
      orgId: 'org-test',
      legalName: '',
      document: '',
      phone: '',
      financeEmail: '',
      defaultSellerCommissionPct: '10',
      defaultFinderCommissionPct: '3',
      defaultTaxPct: '6',
      currency: 'BRL',
      taxRegime: 'Simples Nacional',
      periodClosingDay: 1,
      tableDensity: 'comfortable',
      dateFormat: 'dd/mm/aaaa',
      language: 'pt-BR',
      commissionOnRecurring: true,
      sellerCanBeFinder: true,
      createdAt: '2026-07-29T12:00:00.000Z',
      updatedAt: null,
    },
    ...patch,
  };
}

type WizardSpies = {
  onSave: ReturnType<typeof vi.fn<(payload: CreateSalePayload) => void>>;
  onCreateClient: ReturnType<typeof vi.fn<(name: string) => Promise<SalesOpsClient | null>>>;
  onCreateArea: ReturnType<typeof vi.fn<(name: string) => Promise<SalesOpsArea | null>>>;
  onCreateProduct: ReturnType<typeof vi.fn<(name: string) => void>>;
};

let container: HTMLDivElement;
let root: Root;
let spies: WizardSpies;

const createdClient: SalesOpsClient = {
  id: 'new-client-id',
  orgId: 'org-test',
  name: 'Dias Pet',
  contact: null,
  createdAt: '2026-07-29T12:00:00.000Z',
  updatedAt: null,
};

const createdArea: SalesOpsArea = area({ id: 'new-area-id', name: 'Jurídico' });

function mountContainer() {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
}

async function renderWizard(options: { withCreateHandlers?: boolean } = {}) {
  const withCreateHandlers = options.withCreateHandlers ?? true;
  spies = {
    onSave: vi.fn<(payload: CreateSalePayload) => void>(),
    onCreateClient: vi.fn<(name: string) => Promise<SalesOpsClient | null>>(async () => createdClient),
    onCreateArea: vi.fn<(name: string) => Promise<SalesOpsArea | null>>(async () => createdArea),
    onCreateProduct: vi.fn<(name: string) => void>(),
  };
  await act(async () => {
    root.render(
      <SaleWizardDialog
        bootstrap={baseBootstrap()}
        editSale={null}
        onClose={vi.fn()}
        onCreateArea={withCreateHandlers ? spies.onCreateArea : undefined}
        onCreateClient={withCreateHandlers ? spies.onCreateClient : undefined}
        onCreateProduct={withCreateHandlers ? spies.onCreateProduct : undefined}
        onSave={spies.onSave}
        open
        saving={false}
      />,
    );
  });
}

beforeEach(() => {
  mountContainer();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.querySelectorAll('[data-radix-portal]').forEach((portal) => portal.remove());
  vi.restoreAllMocks();
});

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
  });
}

function buttonByText(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`button not found: ${label}`);
  return match;
}

function labeledInput(label: string): HTMLInputElement {
  const match = container.querySelector(`input[aria-label="${label}"]`);
  if (!(match instanceof HTMLInputElement)) throw new Error(`input not found: ${label}`);
  return match;
}

function comboboxTrigger(ariaLabel: string): HTMLButtonElement {
  const match = container.querySelector(`button[role="combobox"][aria-label="${ariaLabel}"]`);
  if (!(match instanceof HTMLButtonElement)) throw new Error(`combobox not found: ${ariaLabel}`);
  return match;
}

function comboboxText(ariaLabel: string): string {
  return comboboxTrigger(ariaLabel).textContent?.trim() ?? '';
}

function listbox(): HTMLElement | null {
  const match = container.querySelector('[role="listbox"]');
  return match instanceof HTMLElement ? match : null;
}

function panelSearch(): HTMLInputElement {
  const panel = listbox()?.parentElement;
  const match = panel?.querySelector('input[type="text"]');
  if (!(match instanceof HTMLInputElement)) throw new Error('panel search field not found');
  return match;
}

function optionRows(): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[role="option"]')];
}

function createRow(): HTMLElement | null {
  const match = container.querySelector('[data-combobox-create="true"]');
  return match instanceof HTMLElement ? match : null;
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await flushReact();
}

/** A real pointer click fires mousedown before click; the Combobox dismisses on mousedown. */
async function realClick(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await flushReact();
}

async function changeInput(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await flushReact();
}

async function typeInPanel(value: string) {
  await changeInput(panelSearch(), value);
}

async function key(element: Element, name: string): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
  await act(async () => {
    element.dispatchEvent(event);
  });
  await flushReact();
  return event;
}

async function pickOption(ariaLabel: string, optionLabel: string) {
  await click(comboboxTrigger(ariaLabel));
  const row = optionRows().find((candidate) =>
    candidate.textContent?.trim().startsWith(optionLabel),
  );
  if (!(row instanceof HTMLElement)) throw new Error(`option not found: ${optionLabel}`);
  await click(row);
}

async function advanceToStep(step: 2 | 3 | 4) {
  for (let current = 1; current < step; current += 1) {
    await click(buttonByText('Avançar'));
  }
}

async function saveProposta(): Promise<CreateSalePayload> {
  await advanceToStep(4);
  await click(buttonByText('Salvar proposta'));
  const payload = spies.onSave.mock.calls[0]?.[0];
  if (!payload) throw new Error('onSave was not called');
  return payload;
}

describe('combobox adoption in the proposta wizard', () => {
  it('filters the produto picker by the typed query and selects the match with the keyboard', async () => {
    await renderWizard();

    expect(labeledInput('Valor unitário do item 1').value).toBe('2500');

    await click(comboboxTrigger('Produto / serviço do item 1'));
    expect(optionRows()).toHaveLength(2);
    expect(optionRows().map((row) => row.textContent?.trim())).toEqual([
      expect.stringContaining('FXL Finance'),
      expect.stringContaining('FXL Advisor'),
    ]);
    expect(createRow()).toBeNull();

    await typeInPanel('Advis');

    // One surviving produto plus the create row, which is pinned in the footer.
    expect(optionRows()).toHaveLength(2);
    const matchId = optionRows()[0]!.id;
    expect(optionRows()[0]?.textContent?.trim().startsWith('FXL Advisor')).toBe(true);
    expect(optionRows()[1]).toBe(createRow());
    // Scoped to the panel on purpose: the wizard body is itself `overflow-y-auto`, so a
    // bare `closest('.overflow-y-auto')` would find the dialog and prove nothing.
    const scrollArea = listbox()!.querySelector('.overflow-y-auto');
    expect(scrollArea).not.toBeNull();
    expect(scrollArea!.contains(createRow()!)).toBe(false);
    // Positive control for the line above: a normal option row IS inside the scroll area.
    expect(scrollArea!.contains(optionRows()[0]!)).toBe(true);

    // The pinned create row is the last navigable row, so ArrowDown reaches it and
    // another ArrowDown wraps back onto the single match.
    await key(panelSearch(), 'ArrowDown');
    expect(panelSearch().getAttribute('aria-activedescendant')).toBe(createRow()!.id);
    await key(panelSearch(), 'ArrowDown');
    expect(panelSearch().getAttribute('aria-activedescendant')).toBe(matchId);

    await key(panelSearch(), 'Enter');

    expect(listbox()).toBeNull();
    expect(comboboxText('Produto / serviço do item 1')).toBe('FXL Advisor');
    expect(labeledInput('Valor unitário do item 1').value).toBe('9900');
    expect(spies.onCreateProduct).not.toHaveBeenCalled();
  });

  it('offers Criar novo cliente for an unmatched query and adopts the created cliente', async () => {
    await renderWizard();

    expect(comboboxText('Cliente')).toBe('SegPro');

    await click(comboboxTrigger('Cliente'));
    await typeInPanel('Dias Pet');

    const row = createRow();
    expect(row).not.toBeNull();
    expect(row?.textContent?.trim()).toBe('+ Criar novo cliente "Dias Pet"');

    await click(row!);

    expect(spies.onCreateClient).toHaveBeenCalledTimes(1);
    expect(spies.onCreateClient).toHaveBeenCalledWith('Dias Pet');
    expect(listbox()).toBeNull();
    expect(comboboxText('Cliente')).toBe('Dias Pet');

    const payload = await saveProposta();
    expect(payload.clientId).toBe('new-client-id');
    expect(payload.clientName).toBe('Dias Pet');
  });

  it('trims the surrounding whitespace out of the create query', async () => {
    await renderWizard();

    await click(comboboxTrigger('Cliente'));
    await typeInPanel('  Dias Pet  ');

    expect(createRow()?.textContent?.trim()).toBe('+ Criar novo cliente "Dias Pet"');

    await click(createRow()!);

    expect(spies.onCreateClient).toHaveBeenCalledWith('Dias Pet');
    expect(comboboxText('Cliente')).toBe('Dias Pet');
  });

  it('falls back to the typed name with no clientId when no create handler is wired', async () => {
    await renderWizard({ withCreateHandlers: false });

    await click(comboboxTrigger('Cliente'));
    await typeInPanel('Dias Pet');
    expect(createRow()).not.toBeNull();
    await click(createRow()!);

    expect(comboboxText('Cliente')).toBe('Dias Pet');

    const payload = await saveProposta();
    expect(payload.clientName).toBe('Dias Pet');
    expect(payload.clientId).toBeUndefined();
  });

  it('hides the create row when the typed cliente already exists', async () => {
    await renderWizard();

    await click(comboboxTrigger('Cliente'));
    await typeInPanel('SegPro');

    expect(createRow()).toBeNull();
    expect(optionRows()).toHaveLength(1);
    expect(optionRows()[0]?.textContent?.trim()).toBe('SegPro');
  });

  it('offers Criar nova área with feminine agreement on a free-form item row', async () => {
    await renderWizard();

    await click(buttonByText('+ item avulso'));
    expect(comboboxText('Área do item 2')).toBe('FXL Tech');

    await click(comboboxTrigger('Área do item 2'));
    await typeInPanel('Jurídico');
    expect(createRow()?.textContent?.trim()).toBe('+ Criar nova área "Jurídico"');

    await click(createRow()!);

    expect(spies.onCreateArea).toHaveBeenCalledTimes(1);
    expect(spies.onCreateArea).toHaveBeenCalledWith('Jurídico');
    expect(comboboxText('Área do item 2')).toBe('Jurídico');

    await changeInput(labeledInput('Descrição do item 2'), 'Parecer jurídico');
    await changeInput(labeledInput('Valor unitário do item 2'), '5000');

    const payload = await saveProposta();
    expect(payload.items[1]?.areaId).toBe('new-area-id');
  });

  it('routes the produto create row and the Cadastrar produto button to the same handler', async () => {
    await renderWizard();

    await click(comboboxTrigger('Produto / serviço do item 1'));
    await typeInPanel('FXL Novo');
    expect(createRow()?.textContent?.trim()).toBe('+ Criar novo produto "FXL Novo"');
    await click(createRow()!);

    expect(spies.onCreateProduct).toHaveBeenCalledTimes(1);
    expect(spies.onCreateProduct).toHaveBeenCalledWith('FXL Novo');
    // The primitive never mutates `value` on create, so the selection is untouched.
    expect(comboboxText('Produto / serviço do item 1')).toBe('FXL Finance');

    await click(buttonByText('Cadastrar produto'));
    expect(spies.onCreateProduct).toHaveBeenCalledTimes(2);
    expect(spies.onCreateProduct).toHaveBeenLastCalledWith('');
  });

  it('lets a name-only profissional survive through the picker', async () => {
    await renderWizard();

    await advanceToStep(3);
    await click(buttonByText('+ profissional'));
    // The picker now offers EVERY active pessoa, sorted by name, so a new row is
    // seeded with 'Ana Martins' rather than the first `isCollaborator` pessoa.
    expect(comboboxText('Profissional 1')).toBe('Ana Martins');

    await click(comboboxTrigger('Profissional 1'));
    await typeInPanel('Dev Externo');
    expect(createRow()?.textContent?.trim()).toBe('+ Criar novo profissional "Dev Externo"');
    await click(createRow()!);

    expect(comboboxText('Profissional 1')).toBe('Dev Externo');

    // A função is required now; the old hardcoded `role: 'Operacional'` seed is gone.
    await click(comboboxTrigger('Função do profissional 1'));
    await click(optionRows().find((row) => row.textContent?.trim() === 'Prestador')!);

    await click(buttonByText('Avançar'));
    await click(buttonByText('Salvar proposta'));

    const payload = spies.onSave.mock.calls[0]?.[0];
    expect(payload?.professionals).toEqual([
      {
        personId: undefined,
        personName: 'Dev Externo',
        funcaoId: funcaoPrestador.id,
        role: 'Prestador',
        costBrl: 0,
      },
    ]);
  });

  it('renders no native select, option or datalist anywhere in the wizard', async () => {
    await renderWizard();

    // Positive control: the Combobox triggers this assertion is about really are rendered.
    expect(container.querySelectorAll('button[role="combobox"]').length).toBeGreaterThan(0);

    for (const step of [1, 2, 3, 4]) {
      expect(container.textContent).toContain(`Passo ${step} de 4`);
      expect(container.querySelectorAll('select, option, datalist')).toHaveLength(0);
      if (step < 4) await click(buttonByText('Avançar'));
    }
  });

  it('closes the panel on Escape without closing the wizard', async () => {
    await renderWizard();

    await click(comboboxTrigger('Cliente'));
    await typeInPanel('Dias');
    expect(listbox()).not.toBeNull();

    const event = await key(panelSearch(), 'Escape');

    expect(event.defaultPrevented).toBe(true);
    expect(listbox()).toBeNull();
    expect(container.textContent).toContain('Nova proposta');
    expect(spies.onCreateClient).not.toHaveBeenCalled();
    expect(comboboxText('Cliente')).toBe('SegPro');
  });

  it('renders every picker at the same height, font size and radius as the Input beside it', async () => {
    await renderWizard();

    const trigger = comboboxTrigger('Produto / serviço do item 1');
    const neighbour = labeledInput('Quantidade do item 1');

    // The canonical 44px form geometry, shared by pickers and inputs on the same row.
    for (const token of ['h-11', 'rounded-[10px]', 'text-sm']) {
      expect(trigger.className.split(/\s+/)).toContain(token);
      expect(neighbour.className.split(/\s+/)).toContain(token);
    }
    // tailwind-merge really displaced the primitive's own base geometry. This is the
    // failure mode the deleted NativeSelect had: it composed classes with a template
    // string, so its h-10 never dropped and pickers rendered 40px beside 44px inputs.
    for (const stale of ['h-10', 'rounded-md', 'text-[13.5px]', 'rounded-[9px]']) {
      expect(trigger.className.split(/\s+/)).not.toContain(stale);
      expect(neighbour.className.split(/\s+/)).not.toContain(stale);
    }

    // Every wizard picker shares that one geometry, not just the produto one.
    for (const label of ['Cliente', 'Vendedor', 'Produto / serviço do item 1']) {
      expect(comboboxTrigger(label).className.split(/\s+/)).toContain('h-11');
    }
  });

  it('dismisses an open picker when the control that disables it is clicked', async () => {
    await renderWizard();

    await click(buttonByText('Essa proposta teve um finder'));
    const finder = comboboxTrigger('Finder');
    expect(finder.disabled).toBe(false);

    await click(finder);
    expect(listbox()).not.toBeNull();

    await realClick(buttonByText('Vendedor é o finder desta venda'));

    expect(listbox()).toBeNull();
    expect(comboboxTrigger('Finder').disabled).toBe(true);
  });
});

describe('combobox adoption in the produto dialog', () => {
  let onSaveProduct: ReturnType<typeof vi.fn<(payload: SaveProductPayload) => void>>;

  /** The prestador função as the produto dialog receives it: a full org-scoped row. */
  const prestadorFuncao: SalesOpsFuncao = {
    id: funcaoPrestador.id,
    orgId: 'org-test',
    name: funcaoPrestador.name,
    slug: funcaoPrestador.slug,
    isSystem: false,
    status: 'active',
    createdAt: '2026-07-29T12:00:00.000Z',
    updatedAt: null,
  };

  async function renderProductDialog(
    props: { funcoes?: SalesOpsFuncao[]; onCreateArea?: (name: string) => Promise<null> } = {},
  ) {
    onSaveProduct = vi.fn<(payload: SaveProductPayload) => void>();
    await act(async () => {
      root.render(
        <ProductDialog
          areas={[area()]}
          funcaoCosts={[]}
          funcoes={props.funcoes ?? []}
          modal={{ kind: 'product' }}
          onClose={vi.fn()}
          onCreateArea={props.onCreateArea}
          onSave={onSaveProduct}
          saving={false}
        />,
      );
    });
  }

  async function submitForm() {
    const form = container.querySelector('form');
    if (!(form instanceof HTMLFormElement)) throw new Error('form not found');
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flushReact();
  }

  it('never submits the product form when Enter is pressed in a picker panel', async () => {
    await renderProductDialog();

    const nameInput = container.querySelector('input[placeholder="Nome"]');
    if (!(nameInput instanceof HTMLInputElement)) throw new Error('name input not found');
    await changeInput(nameInput, 'FXL New Product');

    await click(comboboxTrigger('Área do produto'));
    await typeInPanel('zzz');
    const event = await key(panelSearch(), 'Enter');

    expect(event.defaultPrevented).toBe(true);
    expect(onSaveProduct).not.toHaveBeenCalled();

    // Positive control: the very same form does submit once the área is picked.
    await key(panelSearch(), 'Escape');
    await pickOption('Área do produto', 'FXL Tech');
    await submitForm();

    expect(onSaveProduct).toHaveBeenCalledTimes(1);
    expect(onSaveProduct).toHaveBeenCalledWith(
      expect.objectContaining({ areaId: areaTechId, name: 'FXL New Product' }),
    );
  });

  /** Nome and Área are both on step 1 and both gate every later step of the wizard. */
  async function fillProductIdentity() {
    const nameInput = container.querySelector('input[placeholder="Nome"]');
    if (!(nameInput instanceof HTMLInputElement)) throw new Error('name input not found');
    await changeInput(nameInput, 'FXL New Product');
    await pickOption('Área do produto', 'FXL Tech');
  }

  /** The função cost editor lives on step 4, `Comissões e custos`. */
  async function goToCostStep() {
    const match = [...container.querySelectorAll('button')].find((candidate) =>
      candidate.textContent?.trim().endsWith('Comissões e custos'),
    );
    if (!(match instanceof HTMLButtonElement)) throw new Error('step button not found');
    await click(match);
  }

  /** Both ListEditors label their add button "Adicionar", so scope by section title. */
  async function addListRow(sectionTitle: string) {
    const section = [...container.querySelectorAll('div.border-t')].find((candidate) =>
      candidate.textContent?.trim().startsWith(sectionTitle),
    );
    if (!(section instanceof HTMLElement)) throw new Error(`section not found: ${sectionTitle}`);
    const button = [...section.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === 'Adicionar',
    );
    if (!(button instanceof HTMLButtonElement)) throw new Error('Adicionar button not found');
    await click(button);
  }

  /**
   * Replaces the old `keeps a free-text prestador name` test, whose subject (the
   * free-text Prestadores de serviço editor) this slice deleted. The create-row
   * mechanism it guarded is still asserted, on the picker in the same dialog that
   * legitimately has one, and the assertion is now two-sided: the função cost picker
   * deliberately offers NO create row, because creating a função is admin-gated and
   * belongs to Cadastros > Funções.
   */
  it('offers a create row on the área picker and never on the função cost picker', async () => {
    await renderProductDialog({
      funcoes: [prestadorFuncao],
      onCreateArea: async () => null,
    });

    // Positive control: a name in no list still produces a create row here.
    await click(comboboxTrigger('Área do produto'));
    await typeInPanel('FXL Serviços');
    expect(createRow()?.textContent?.trim()).toBe('+ Criar nova área "FXL Serviços"');
    await key(panelSearch(), 'Escape');

    await fillProductIdentity();
    await goToCostStep();
    await addListRow('Custos padrão por função');

    await click(comboboxTrigger('Função do custo padrão 1'));
    // The registered função is offered by name.
    expect(optionRows().map((row) => row.textContent?.trim())).toEqual(['Prestador']);

    await typeInPanel('Estúdio Externo');
    expect(createRow()).toBeNull();
    expect(listbox()?.textContent).toContain('Nenhuma função disponível');
  });
});

describe('the native picker ban is enforced', () => {
  function read(relativePath: string): string {
    return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
  }

  it('suppresses the OS number spinner in the base stylesheet', () => {
    const css = read('../../index.css');
    expect(css).toContain('::-webkit-inner-spin-button');
    expect(css).toContain('::-webkit-outer-spin-button');
    expect(css).toContain('appearance: textfield');
  });

  it('bans native picker markup through ESLint', () => {
    const config = read('../../../eslint.config.js');
    expect(config).toContain('no-restricted-syntax');
    expect(config).toContain('JSXOpeningElement[name.name="select"]');
    expect(config).toContain('JSXOpeningElement[name.name="datalist"]');
    expect(config).toContain('JSXOpeningElement[name.name="option"]');
    expect(config).toContain('JSXOpeningElement[name.name="input"]');
  });

  it('records the rule in CLAUDE.md', () => {
    const claudeMd = read('../../../../../CLAUDE.md');
    expect(claudeMd).toContain('## UI Controls');
    expect(claudeMd).toContain('@/components/ui/combobox');
  });

  it('leaves no native picker markup in any web source file', () => {
    const sources = [
      read('../SalesOpsApp.tsx'),
      read('../../auth/react.tsx'),
      read('../../admin/products/ProductDialog.tsx'),
      read('../../finder/links/LinkGeneratorForm.tsx'),
    ];
    // Positive control: the files really were read.
    expect(sources.every((source) => source.length > 0)).toBe(true);
    for (const source of sources) {
      expect(source).not.toContain('<select');
      expect(source).not.toContain('<option');
      expect(source).not.toContain('<datalist');
      expect(source).not.toContain('NativeSelect');
    }
  });
});
