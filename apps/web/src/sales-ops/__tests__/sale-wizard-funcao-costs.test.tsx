// @vitest-environment happy-dom

import * as React from 'react';
import type { HTMLAttributes } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SaleWizardDialog } from '../SalesOpsApp';
import type { SavePersonPayload } from '../api';
import type {
  CreateSalePayload,
  SalesOpsBootstrap,
  SalesOpsFuncao,
  SalesOpsPerson,
  SalesOpsPersonFuncao,
  SalesOpsProduct,
  SalesOpsProductFuncaoCost,
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

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

const areaId = '66666666-6666-4666-8666-666666666666';
const customProductId = '11111111-1111-4111-8111-111111111111';
const landingProductId = '22222222-2222-4222-8222-222222222222';
const clientId = '33333333-3333-4333-8333-333333333333';
const sellerId = '44444444-4444-4444-8444-444444444444';
const deliveryPersonId = '88888888-8888-4888-8888-888888888888';
const inactivePersonId = '99999999-9999-4999-8999-999999999999';
const devFuncaoId = 'fc000010-0000-4000-8000-000000000010';
const testerFuncaoId = 'fc000011-0000-4000-8000-000000000011';
const vendedorFuncaoId = 'fc000001-0000-4000-8000-000000000001';
const archivedFuncaoId = 'fc000012-0000-4000-8000-000000000012';
/** The server uuid an inline `+ Criar nova função` create resolves with. */
const newFuncaoId = 'fc000013-0000-4000-8000-000000000013';
const saleId = '77777777-7777-4777-8777-777777777777';

const funcaoVendedor: SalesOpsPersonFuncao = {
  id: vendedorFuncaoId,
  name: 'Vendedor',
  slug: 'vendedor',
  isSystem: true,
};

function funcao(id: string, name: string, patch: Partial<SalesOpsFuncao> = {}): SalesOpsFuncao {
  return {
    id,
    orgId: 'org-test',
    name,
    slug: name.toLowerCase(),
    isSystem: false,
    status: 'active',
    createdAt: '2026-07-13T12:00:00.000Z',
    updatedAt: null,
    ...patch,
  };
}

function product(id: string, name: string, setupBrl: number): SalesOpsProduct {
  return {
    id,
    orgId: 'org-test',
    name,
    codeSuffix: id.startsWith('1') ? '1' : '2',
    areaId,
    openPrice: false,
    setupBrl,
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
    createdAt: '2026-07-13T12:00:00.000Z',
    updatedAt: null,
  };
}

/** FXL Custom is the primary item at 1 x R$ 20.000,00. */
const productCustom = product(customProductId, 'FXL Custom', 2000000);
const productLanding = product(landingProductId, 'Landing Page', 1000000);

function costRow(patch: Partial<SalesOpsProductFuncaoCost>): SalesOpsProductFuncaoCost {
  return {
    id: `cost-${patch.productId}-${patch.funcaoId}`,
    orgId: 'org-test',
    productId: customProductId,
    funcaoId: devFuncaoId,
    mode: 'pct',
    valuePct: '5.00',
    valueBrl: null,
    createdAt: '2026-07-13T12:00:00.000Z',
    updatedAt: null,
    ...patch,
  };
}

const bootstrap: SalesOpsBootstrap = {
  sales: [],
  products: [productCustom, productLanding],
  clients: [
    {
      id: clientId,
      orgId: 'org-test',
      name: 'Client A',
      contact: null,
      createdAt: '2026-07-13T12:00:00.000Z',
      updatedAt: null,
    },
  ],
  funcoes: [
    funcao(devFuncaoId, 'Desenvolvedor'),
    funcao(testerFuncaoId, 'Testador'),
    funcao(vendedorFuncaoId, 'Vendedor', { slug: 'vendedor', isSystem: true }),
    funcao(archivedFuncaoId, 'Arquivada', { status: 'archived' }),
  ],
  people: [
    {
      id: sellerId,
      orgId: 'org-test',
      displayName: 'Ana Martins',
      contactEmail: 'ana@exemplo.com',
      status: 'active',
      // Vendedor only: a pessoa the OLD isCollaborator picker would have hidden.
      funcaoIds: [vendedorFuncaoId],
      funcoes: [funcaoVendedor],
      createdAt: '2026-07-13T12:00:00.000Z',
      updatedAt: null,
    },
    {
      id: deliveryPersonId,
      orgId: 'org-test',
      displayName: 'Bruno Entrega',
      contactEmail: null,
      status: 'active',
      funcaoIds: [devFuncaoId],
      funcoes: [{ id: devFuncaoId, name: 'Desenvolvedor', slug: 'desenvolvedor', isSystem: false }],
      createdAt: '2026-07-13T12:00:00.000Z',
      updatedAt: null,
    },
    {
      id: inactivePersonId,
      orgId: 'org-test',
      displayName: 'Zulmira Inativa',
      contactEmail: null,
      status: 'inactive',
      funcaoIds: [devFuncaoId],
      funcoes: [{ id: devFuncaoId, name: 'Desenvolvedor', slug: 'desenvolvedor', isSystem: false }],
      createdAt: '2026-07-13T12:00:00.000Z',
      updatedAt: null,
    },
  ],
  areas: [
    {
      id: areaId,
      orgId: 'org-test',
      name: 'FXL Tech',
      status: 'active',
      createdAt: '2026-07-13T12:00:00.000Z',
      updatedAt: null,
    },
  ],
  payables: [],
  saleItems: [],
  receivables: [],
  productFuncaoCosts: [
    costRow({ productId: customProductId, funcaoId: devFuncaoId, mode: 'pct', valuePct: '5.00' }),
    costRow({
      productId: customProductId,
      funcaoId: testerFuncaoId,
      mode: 'fix',
      valuePct: null,
      valueBrl: 30000,
    }),
    costRow({
      productId: landingProductId,
      funcaoId: testerFuncaoId,
      mode: 'fix',
      valuePct: null,
      valueBrl: 30000,
    }),
  ],
  saleProfessionals: [],
  settings: {
    orgId: 'org-test',
    legalName: '',
    document: '',
    phone: '',
    financeEmail: '',
    defaultSellerCommissionPct: '9',
    defaultFinderCommissionPct: '2',
    defaultTaxPct: '6',
    currency: 'BRL',
    taxRegime: 'Simples Nacional',
    periodClosingDay: 1,
    tableDensity: 'comfortable',
    dateFormat: 'dd/mm/aaaa',
    language: 'pt-BR',
    commissionOnRecurring: true,
    sellerCanBeFinder: true,
    createdAt: '2026-07-13T12:00:00.000Z',
    updatedAt: null,
  },
};

/** A stored proposta whose professional row is a LEGACY free-text one. */
const editSale: SalesOpsSale = {
  id: saleId,
  orgId: 'org-test',
  sequence: 1,
  code: '0001-1',
  clientId,
  clientNameSnapshot: 'Client A',
  sellerPersonId: sellerId,
  sellerNameSnapshot: 'Ana Martins',
  finderPersonId: null,
  finderNameSnapshot: null,
  status: 'open',
  paymentMethod: 'pix',
  condition: 'cash',
  installments: 1,
  baseDate: '2026-07-13T00:00:00.000Z',
  notes: null,
  wonAt: null,
  lostAt: null,
  totalBrl: 2000000,
  recurringBrl: 0,
  sellerCommissionPct: '10.00',
  finderCommissionPct: '2.00',
  taxPct: '6.00',
  otherCostsBrl: 0,
  professionalCostsBrl: 777777,
  sellerCommissionBrl: 200000,
  finderCommissionBrl: 0,
  taxBrl: 120000,
  netMarginBrl: 902223,
  netMarginPct: '45.11',
  createdAt: '2026-07-13T12:00:00.000Z',
  updatedAt: null,
};

const editBootstrap: SalesOpsBootstrap = {
  ...bootstrap,
  sales: [editSale],
  saleItems: [
    {
      saleId,
      productId: customProductId,
      productNameSnapshot: 'FXL Custom',
      productTypeSnapshot: 'product',
      quantity: 1,
      unitBrl: 2000000,
      subtotalBrl: 2000000,
      areaId,
      areaNameSnapshot: 'FXL Tech',
    },
  ],
  receivables: [
    {
      id: 'rec-1',
      saleId,
      label: '1/1',
      dueDate: '2026-07-13',
      amountBrl: 2000000,
      method: 'pix',
      status: 'open',
    },
  ],
  saleProfessionals: [
    {
      saleId,
      personId: null,
      personNameSnapshot: 'Dev Externo',
      funcaoId: null,
      funcaoNameSnapshot: '',
      role: 'Operacional',
      costBrl: 777777,
    },
  ],
};

let container: HTMLDivElement;
let root: Root;
let onSave: ReturnType<typeof vi.fn<(payload: CreateSalePayload) => void>>;

async function renderWizard(
  sale: SalesOpsSale | null = null,
  onCreateFuncao?: (name: string) => Promise<SalesOpsFuncao | null>,
  bootstrapOverride?: SalesOpsBootstrap,
  onAssignFuncao?: (payload: SavePersonPayload) => Promise<SalesOpsPerson | null>,
) {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  onSave = vi.fn<(payload: CreateSalePayload) => void>();
  await act(async () => {
    root.render(
      <SaleWizardDialog
        bootstrap={bootstrapOverride ?? (sale ? editBootstrap : bootstrap)}
        editSale={sale}
        onAssignFuncao={onAssignFuncao}
        onClose={vi.fn()}
        onCreateFuncao={onCreateFuncao}
        onSave={onSave}
        open
        saving={false}
      />,
    );
  });
}

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

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

/** The open panel's search box; the primitive labels it with its own placeholder. */
function panelSearch(placeholder: string): HTMLInputElement {
  const match = container.querySelector(`input[aria-label="${placeholder}"]`);
  if (!(match instanceof HTMLInputElement)) throw new Error(`search not found: ${placeholder}`);
  return match;
}

/** `data-combobox-create` is set by the primitive, so it is a stable hook. */
function createRow(): HTMLElement | null {
  const match = container.querySelector('[data-combobox-create="true"]');
  return match instanceof HTMLElement ? match : null;
}

function optionLabels(): string[] {
  return [...container.querySelectorAll('[role="option"]')].map(
    (row) => row.textContent?.trim() ?? '',
  );
}

/**
 * Every open panel's group wrappers, heading text included. `buildComboboxFilter`
 * renders the headingless bucket as a bare Fragment, so a `[role="group"]` node
 * exists only when at least one option really carries a `group`.
 */
function groupHeadingTexts(): string[] {
  return [...container.querySelectorAll('[role="group"]')].map(
    (group) => group.textContent?.trim() ?? '',
  );
}

function optionRow(label: string): HTMLElement {
  const row = [...container.querySelectorAll('[role="option"]')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!(row instanceof HTMLElement)) throw new Error(`option not found: ${label}`);
  return row;
}

/** For a picker whose rows carry a description, e.g. a pessoa's contactEmail. */
function optionRowStartingWith(label: string): HTMLElement {
  const row = [...container.querySelectorAll('[role="option"]')].find((candidate) =>
    candidate.textContent?.trim().startsWith(label),
  );
  if (!(row instanceof HTMLElement)) throw new Error(`option not found: ${label}`);
  return row;
}

async function openPicker(ariaLabel: string): Promise<string[]> {
  await click(comboboxTrigger(ariaLabel));
  return optionLabels();
}

/** For a picker whose rows carry a description, e.g. the produto's área. */
async function pickOptionStartingWith(ariaLabel: string, optionLabel: string) {
  await click(comboboxTrigger(ariaLabel));
  const row = [...container.querySelectorAll('[role="option"]')].find((candidate) =>
    candidate.textContent?.trim().startsWith(optionLabel),
  );
  if (!(row instanceof HTMLElement)) throw new Error(`option not found: ${optionLabel}`);
  await click(row);
}

async function pickOption(ariaLabel: string, optionLabel: string) {
  await click(comboboxTrigger(ariaLabel));
  const row = [...container.querySelectorAll('[role="option"]')].find(
    (candidate) => candidate.textContent?.trim() === optionLabel,
  );
  if (!(row instanceof HTMLElement)) throw new Error(`option not found: ${optionLabel}`);
  await click(row);
}

async function click(element: HTMLElement) {
  await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function flushReact() {
  await act(async () => Promise.resolve());
}

async function goToCosts() {
  await click(buttonByText('Avançar'));
  await click(buttonByText('Avançar'));
}

async function backToProposta() {
  await click(buttonByText('Voltar'));
  await click(buttonByText('Voltar'));
}

async function addProfessional() {
  await click(buttonByText('+ profissional'));
  await flushReact();
}

/**
 * The panel text under a row's `CUSTO ALOCADO`, chip or derivation alike.
 *
 * The input is nested inside `UnitInput`'s `relative flex-1` wrapper, so
 * `parentElement` no longer reaches the cell and the `.items-end` cell is the hook.
 */
function rowFooterText(index = 1): string {
  const cost = labeledInput(`Custo alocado do profissional ${index}`);
  return cost.closest('.items-end')?.textContent?.trim() ?? '';
}

/** For the icon-only buttons, which carry an aria-label and no text. */
function buttonByLabel(label: string): HTMLButtonElement {
  const match = container.querySelector(`button[aria-label="${label}"]`);
  if (!(match instanceof HTMLButtonElement)) throw new Error(`button not found: ${label}`);
  return match;
}

async function setCostUnit(unit: '%' | 'R$', index = 1) {
  const label =
    unit === '%'
      ? `Custo do profissional ${index} em porcentagem`
      : `Custo do profissional ${index} em reais`;
  await click(buttonByLabel(label));
  await flushReact();
}

describe('sale wizard profissionais alocados', () => {
  it('partitions the profissional picker by the row s funcao and flags the rest', async () => {
    await renderWizard();
    await goToCosts();
    await addProfessional();
    await pickOption('Função do profissional 1', 'Desenvolvedor');
    await flushReact();

    const options = await openPicker('Profissional 1');
    /*
      Carrier first, in the headingless bucket; the non-carrier lands after the
      group heading. `buildComboboxFilter` renders the ungrouped bucket first, so
      this exact order is the partition itself rather than an alphabetical accident
      (alphabetically Ana Martins sorts BEFORE Bruno Entrega). Ana carries a
      contactEmail, which the picker renders as a description under her name, so
      her row's text is asserted with `startsWith` rather than an exact match.
    */
    expect(options).toHaveLength(2);
    expect(options[0]).toBe('Bruno Entrega');
    expect(options[1]?.startsWith('Ana Martins')).toBe(true);
    expect(groupHeadingTexts().some((text) => text.startsWith('Adicionar a esta função'))).toBe(
      true,
    );
    expect(optionRowStartingWith('Ana Martins').closest('[role="group"]')).not.toBeNull();
    expect(optionRow('Bruno Entrega').closest('[role="group"]')).toBeNull();
    // Inactive stays out, and the old free-text escape hatch is still gone.
    expect(options).not.toContain('Zulmira Inativa');
    expect(options).not.toContain('Digite manualmente');
  });

  it('locks the profissional picker until the row names a funcao', async () => {
    await renderWizard();
    await goToCosts();
    await addProfessional();

    expect(comboboxText('Profissional 1')).toBe('Selecione a função primeiro');
    expect(comboboxTrigger('Profissional 1').disabled).toBe(true);

    // The lock is real, not decorative: the panel refuses to open.
    await click(comboboxTrigger('Profissional 1'));
    expect(container.querySelectorAll('[role="option"]')).toHaveLength(0);

    // Positive control: naming a função unlocks the same trigger.
    await pickOption('Função do profissional 1', 'Desenvolvedor');
    await flushReact();
    expect(comboboxTrigger('Profissional 1').disabled).toBe(false);
  });

  it('grants the funcao to a flagged pessoa with her FULL existing funcaoIds', async () => {
    const onAssignFuncao = vi.fn<(payload: SavePersonPayload) => Promise<SalesOpsPerson | null>>(
      async () => null,
    );
    await renderWizard(null, undefined, undefined, onAssignFuncao);
    await goToCosts();
    await addProfessional();
    await pickOption('Função do profissional 1', 'Desenvolvedor');
    await flushReact();
    await pickOptionStartingWith('Profissional 1', 'Ana Martins');
    await flushReact();

    // The row takes her regardless of what the write does.
    expect(comboboxText('Profissional 1')).toBe('Ana Martins');
    expect(onAssignFuncao).toHaveBeenCalledTimes(1);
    /*
      The WHOLE payload, never `objectContaining`: the API sets
      `contactEmail: data.contactEmail || null` unconditionally, so a PATCH that
      drops the key clears her e-mail. Ana's fixture carries a REAL address on
      purpose: `toHaveBeenCalledWith` uses `toEqual` semantics, under which an
      expected `contactEmail: undefined` also matches an argument object that
      OMITS the key entirely, so a null-fixture pessoa could never have caught
      the key being dropped. Only a non-undefined expected value does.
    */
    expect(onAssignFuncao).toHaveBeenCalledWith({
      id: sellerId,
      displayName: 'Ana Martins',
      contactEmail: 'ana@exemplo.com',
      status: 'active',
      funcaoIds: [vendedorFuncaoId, devFuncaoId],
    });
    /*
      The anti-regression this test exists for: person writes are a FULL SET
      replacement, so sending `[devFuncaoId]` alone would silently strip her
      Vendedor - a system função she is paid through.
    */
    expect(onAssignFuncao.mock.calls[0]![0].funcaoIds).toContain(vendedorFuncaoId);
  });

  it('omits contactEmail from the grant payload for a pessoa with none, rather than sending null', async () => {
    const onAssignFuncao = vi.fn<(payload: SavePersonPayload) => Promise<SalesOpsPerson | null>>(
      async () => null,
    );
    await renderWizard(null, undefined, undefined, onAssignFuncao);
    await goToCosts();
    await addProfessional();
    // Bruno holds devFuncaoId, not testerFuncaoId, and his contactEmail is genuinely null.
    await pickOption('Função do profissional 1', 'Testador');
    await flushReact();
    await pickOption('Profissional 1', 'Bruno Entrega');
    await flushReact();

    expect(onAssignFuncao).toHaveBeenCalledTimes(1);
    const payload = onAssignFuncao.mock.calls[0]![0];
    /*
      `payload.contactEmail` really is the JS value `undefined` here, not a
      missing key - `person.contactEmail ?? undefined` still assigns the key in
      the object literal. What actually drops it on the wire is
      `JSON.stringify`, which omits any key whose value is `undefined`, so that
      is the honest thing to assert: a pessoa with no e-mail must serialize
      WITHOUT `contactEmail`, never with a `null` that the API would then write
      over a value that was never there to begin with.
    */
    expect(payload.contactEmail).toBeUndefined();
    expect(JSON.parse(JSON.stringify(payload))).not.toHaveProperty('contactEmail');
  });

  it('does not write when the pessoa already carries the row s funcao', async () => {
    const onAssignFuncao = vi.fn<(payload: SavePersonPayload) => Promise<SalesOpsPerson | null>>(
      async () => null,
    );
    await renderWizard(null, undefined, undefined, onAssignFuncao);
    await goToCosts();
    await addProfessional();
    await pickOption('Função do profissional 1', 'Desenvolvedor');
    await flushReact();
    await pickOption('Profissional 1', 'Bruno Entrega');
    await flushReact();

    expect(comboboxText('Profissional 1')).toBe('Bruno Entrega');
    expect(onAssignFuncao).not.toHaveBeenCalled();
  });

  it('keeps a legacy free-text funcao row s pessoa picker open and ungrouped', async () => {
    await renderWizard(editSale);
    await goToCosts();

    /*
      The one deliberate hole in the rule: a stored row carrying a free-text
      `funcaoName` with a null `funcaoId` has no id to partition on, and locking it
      would make a stored proposta uneditable.
    */
    expect(comboboxTrigger('Profissional 1').disabled).toBe(false);
    await openPicker('Profissional 1');
    expect(groupHeadingTexts()).toEqual([]);
  });

  it('picks a funcao from the registry and lists only active funcoes', async () => {
    await renderWizard();
    await goToCosts();
    await addProfessional();

    const options = await openPicker('Função do profissional 1');
    expect(options).toEqual(['Desenvolvedor', 'Testador', 'Vendedor']);
    expect(options).not.toContain('Arquivada');
  });

  it('starts a new row with no funcao instead of the old hardcoded Operacional', async () => {
    await renderWizard();
    await goToCosts();
    await addProfessional();

    expect(comboboxText('Função do profissional 1')).toBe('Selecionar função...');
    expect(container.textContent).not.toContain('Operacional');
  });

  it('prefills a percent funcao cost from the declaring item subtotal and shows the derivation', async () => {
    await renderWizard();
    await goToCosts();
    await addProfessional();
    await pickOption('Função do profissional 1', 'Desenvolvedor');
    await flushReact();

    // 5% of the FXL Custom subtotal of R$ 20.000,00.
    expect(labeledInput('Custo alocado do profissional 1').value).toBe('1000');
    expect(rowFooterText()).toContain('5% de FXL Custom (R$ 20.000,00)');
  });

  it('prefills a fixed funcao cost and leaves it editable', async () => {
    await renderWizard();
    await goToCosts();
    await addProfessional();
    await pickOption('Função do profissional 1', 'Testador');
    await flushReact();
    expect(labeledInput('Custo alocado do profissional 1').value).toBe('300');

    await typeInto(labeledInput('Custo alocado do profissional 1'), '450');
    expect(rowFooterText()).toContain('Alterado manualmente');

    // Moving the item price recomputes every non-manual row; this one is manual.
    await backToProposta();
    await typeInto(labeledInput('Valor unitário do item 1'), '30000');
    await flushReact();
    await goToCosts();
    expect(labeledInput('Custo alocado do profissional 1').value).toBe('450');
    expect(rowFooterText()).toContain('Alterado manualmente');
  });

  it('sums a fixed default across every item whose product declares the funcao', async () => {
    await renderWizard();
    await click(buttonByText('+ item'));
    await flushReact();
    await pickOptionStartingWith('Produto / serviço do item 2', 'Landing Page');
    await flushReact();
    await goToCosts();
    await addProfessional();
    await pickOption('Função do profissional 1', 'Testador');
    await flushReact();

    // R$ 300,00 from FXL Custom plus R$ 300,00 from Landing Page.
    expect(labeledInput('Custo alocado do profissional 1').value).toBe('600');
    expect(rowFooterText()).toContain('R$ 300,00 de FXL Custom + R$ 300,00 de Landing Page');
  });

  it('excludes the recurring mensalidade from the percent base', async () => {
    await renderWizard();
    await goToCosts();
    await addProfessional();
    await pickOption('Função do profissional 1', 'Desenvolvedor');
    await flushReact();
    expect(labeledInput('Custo alocado do profissional 1').value).toBe('1000');

    await click(buttonByText('Voltar'));
    await pickOption('Recorrência', 'mensal');
    await flushReact();
    await typeInto(labeledInput('Valor da mensalidade'), '5000');
    await flushReact();
    expect(labeledInput('Valor da mensalidade').value).toBe('5000');
    await click(buttonByText('Avançar'));

    // A professional_cost payable is one-shot at win, so a monthly stream must not
    // enter its base.
    expect(labeledInput('Custo alocado do profissional 1').value).toBe('1000');
    expect(rowFooterText()).toContain('5% de FXL Custom (R$ 20.000,00)');
  });

  it('re-prefills the cost when the funcao changes on a row the operator never typed into', async () => {
    await renderWizard();
    await goToCosts();
    await addProfessional();
    await pickOption('Função do profissional 1', 'Desenvolvedor');
    await flushReact();
    expect(labeledInput('Custo alocado do profissional 1').value).toBe('1000');

    await pickOption('Função do profissional 1', 'Testador');
    await flushReact();
    expect(labeledInput('Custo alocado do profissional 1').value).toBe('300');
  });

  it('keeps a hand-typed cost when the funcao on that row changes', async () => {
    await renderWizard();
    await goToCosts();
    await addProfessional();
    await pickOption('Função do profissional 1', 'Desenvolvedor');
    await flushReact();
    await typeInto(labeledInput('Custo alocado do profissional 1'), '450');

    await pickOption('Função do profissional 1', 'Testador');
    await flushReact();

    // Pinned: Testador's R$ 300,00 default does not overwrite the typed 450.
    expect(comboboxText('Função do profissional 1')).toBe('Testador');
    expect(labeledInput('Custo alocado do profissional 1').value).toBe('450');
    expect(rowFooterText()).toContain('Alterado manualmente');

    // Positive control on the same row: Restaurar padrão clears the pin and the
    // cost snaps to the new função's default, so the pin above is a real guard.
    const restore = [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === 'Restaurar padrão',
    );
    if (!(restore instanceof HTMLButtonElement)) throw new Error('Restaurar padrão not found');
    await click(restore);
    await flushReact();
    expect(labeledInput('Custo alocado do profissional 1').value).toBe('300');
    expect(rowFooterText()).toContain('R$ 300,00 de FXL Custom');
  });

  it('does not touch the cost when only the pessoa changes', async () => {
    await renderWizard();
    await goToCosts();
    await addProfessional();
    await pickOption('Função do profissional 1', 'Desenvolvedor');
    await flushReact();
    expect(labeledInput('Custo alocado do profissional 1').value).toBe('1000');

    await pickOption('Profissional 1', 'Bruno Entrega');
    await flushReact();
    expect(comboboxText('Profissional 1')).toBe('Bruno Entrega');
    expect(labeledInput('Custo alocado do profissional 1').value).toBe('1000');
  });

  it('keeps a stored professional cost when editing an existing proposta', async () => {
    await renderWizard(editSale);
    await goToCosts();
    expect(labeledInput('Custo alocado do profissional 1').value).toBe('7777.77');

    await backToProposta();
    await typeInto(labeledInput('Valor unitário do item 1'), '30000');
    await flushReact();
    await goToCosts();
    expect(labeledInput('Custo alocado do profissional 1').value).toBe('7777.77');
  });

  it('renders a legacy free-text funcao snapshot when the row has no funcaoId', async () => {
    await renderWizard(editSale);
    await goToCosts();

    expect(comboboxText('Função do profissional 1')).toBe('Operacional');
    expect(comboboxText('Profissional 1')).toBe('Dev Externo');
  });

  it('blocks advancing past Custos e margem when a profissional row has no funcao', async () => {
    await renderWizard();
    await goToCosts();
    await addProfessional();
    expect(container.textContent).toContain('Passo 3 de 4');

    await click(buttonByText('Avançar'));
    await flushReact();
    expect(container.textContent).toContain('Passo 3 de 4');
    expect(container.textContent).toContain('Selecione a função de cada profissional alocado.');

    // Positive control: picking a função clears its own bar, and the row is then
    // blocked only by the pessoa, because a fresh row seeds nobody at all.
    await pickOption('Função do profissional 1', 'Desenvolvedor');
    await flushReact();
    expect(container.textContent).not.toContain('Selecione a função de cada profissional alocado.');
    expect(container.textContent).toContain('Selecione a pessoa de cada profissional alocado.');

    await pickOption('Profissional 1', 'Bruno Entrega');
    await flushReact();
    await click(buttonByText('Avançar'));
    await flushReact();
    expect(container.textContent).toContain('Passo 4 de 4');
    expect(container.textContent).not.toContain('Selecione a função de cada profissional alocado.');
    expect(container.textContent).not.toContain('Selecione a pessoa de cada profissional alocado.');
  });

  it('sends funcaoId and the funcao name as role in the save payload', async () => {
    await renderWizard();
    await goToCosts();
    await addProfessional();
    await pickOption('Função do profissional 1', 'Desenvolvedor');
    await pickOption('Profissional 1', 'Bruno Entrega');
    await flushReact();
    await click(buttonByText('Salvar rascunho'));

    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({
        professionals: [
          {
            personId: deliveryPersonId,
            personName: 'Bruno Entrega',
            funcaoId: devFuncaoId,
            role: 'Desenvolvedor',
            costBrl: 100000,
          },
        ],
      }),
    );
  });

  it('offers an inline create row in the funcao picker and selects the created funcao immediately', async () => {
    const onCreateFuncao = vi.fn(async (name: string) => funcao(newFuncaoId, name));
    await renderWizard(null, onCreateFuncao);
    await goToCosts();
    await addProfessional();
    await click(comboboxTrigger('Função do profissional 1'));

    // Negative control first: with an empty query there is no create row, which is
    // exactly the state the defect left behind for every query.
    expect(createRow()).toBeNull();

    await typeInto(panelSearch('Buscar função...'), 'Arquiteto');
    expect(createRow()?.textContent?.trim()).toBe('+ Criar nova função "Arquiteto"');
    // The empty message must not be what renders instead of the create row.
    expect(container.textContent).not.toContain('Nenhuma função cadastrada');

    await click(createRow()!);
    await flushReact();
    expect(onCreateFuncao).toHaveBeenCalledWith('Arquiteto');
    // Selectable immediately: the `bootstrap` prop is deliberately never refreshed
    // here, so only the wizard's own buffer can be showing this label.
    expect(comboboxText('Função do profissional 1')).toBe('Arquiteto');
  });

  it('sends the real server funcaoId for an inline-created funcao, never an optimistic placeholder', async () => {
    const onCreateFuncao = vi.fn(async (name: string) => funcao(newFuncaoId, name));
    await renderWizard(null, onCreateFuncao);
    await goToCosts();
    await addProfessional();
    await click(comboboxTrigger('Função do profissional 1'));
    await typeInto(panelSearch('Buscar função...'), 'Arquiteto');
    await click(createRow()!);
    await flushReact();
    await pickOption('Profissional 1', 'Bruno Entrega');
    await flushReact();
    await click(buttonByText('Salvar rascunho'));

    const payload = onSave.mock.calls.at(-1)![0];
    expect(payload.professionals[0]!.funcaoId).toBe(newFuncaoId);
    expect(String(payload.professionals[0]!.funcaoId)).not.toMatch(/^optimistic:/);
    expect(payload.professionals[0]!.role).toBe('Arquiteto');
  });

  it('never offers an optimistic funcao row in the profissional picker', async () => {
    await renderWizard(null, undefined, {
      ...bootstrap,
      funcoes: [
        ...bootstrap.funcoes,
        funcao('optimistic:funcoes:Arquiteto', 'Arquiteto Otimista'),
      ],
    });
    await goToCosts();
    await addProfessional();

    const options = await openPicker('Função do profissional 1');
    // `SaleWizardDialog` is exported and takes `bootstrap` as a prop, so it holds
    // its own end of the placeholder-id contract rather than trusting its caller.
    expect(options).not.toContain('Arquiteto Otimista');
    // Positive control: the rest of the list is still there.
    expect(options).toContain('Desenvolvedor');
  });

  it('refuses an optimistic funcao handed back by the create handler', async () => {
    // The picker's own filter only stops a placeholder being SELECTED. The create
    // path writes the returned id straight through, so an outside caller of the
    // exported SaleWizardDialog whose handler resolves a cached row would otherwise
    // set a placeholder funcaoId while valueLabel still printed the name - invisible
    // until the uuid cast failed and took the whole wizard with it.
    const onCreateFuncao = vi.fn(async (name: string) =>
      funcao(`optimistic:funcoes:${name}`, name),
    );
    await renderWizard(null, onCreateFuncao);
    await goToCosts();
    await addProfessional();
    /*
      The row is filled FIRST, because the refused create leaves it with no funcaoId
      and its pessoa picker would then be locked. That also buys a stronger positive
      control than the old shape had: the row must still read `Desenvolvedor`
      afterwards, so the refusal is proven to leave the previous selection alone
      rather than merely proven not to adopt the placeholder.
    */
    await pickOption('Função do profissional 1', 'Desenvolvedor');
    await flushReact();
    await pickOption('Profissional 1', 'Bruno Entrega');
    await flushReact();

    await click(comboboxTrigger('Função do profissional 1'));
    await typeInto(panelSearch('Buscar função...'), 'Arquiteto');
    await click(createRow()!);
    await flushReact();

    expect(onCreateFuncao).toHaveBeenCalledWith('Arquiteto');
    // The row keeps its previous selection rather than adopting the placeholder.
    expect(comboboxText('Função do profissional 1')).not.toBe('Arquiteto');
    expect(comboboxText('Função do profissional 1')).toBe('Desenvolvedor');

    await click(buttonByText('Salvar rascunho'));

    const payload = onSave.mock.calls.at(-1)![0];
    expect(payload.professionals[0]!.funcaoId).toBe(devFuncaoId);
    expect(String(payload.professionals[0]?.funcaoId ?? '')).not.toMatch(/^optimistic:/);
  });

  it('toggles CUSTO ALOCADO to % and resolves against the funcao-scoped item subtotal', async () => {
    await renderWizard();
    await goToCosts();
    await addProfessional();
    await pickOption('Função do profissional 1', 'Desenvolvedor');
    await pickOption('Profissional 1', 'Bruno Entrega');
    await flushReact();

    await setCostUnit('%');
    await typeInto(labeledInput('Custo alocado do profissional 1'), '10');
    await flushReact();

    expect(labeledInput('Custo alocado do profissional 1').value).toBe('10');
    // The base is the item SUBTOTAL of the declaring produto, never the proposta total.
    expect(rowFooterText()).toContain('10% de R$ 20.000,00 (FXL Custom)');
    expect(rowFooterText()).toContain('R$ 2.000,00');

    await click(buttonByText('Salvar rascunho'));
    const payload = onSave.mock.calls.at(-1)![0];
    // Resolved before the wire: the column is a single integer-cents `cost_brl`.
    expect(payload.professionals[0]!.costBrl).toBe(200000);
  });

  it('warns instead of silently writing zero when no product item backs the percentage', async () => {
    await renderWizard();
    await click(buttonByText('+ item avulso'));
    await flushReact();
    await pickOption('Área do item 2', 'FXL Tech');
    await typeInto(labeledInput('Descrição do item 2'), 'Consultoria avulsa');
    await typeInto(labeledInput('Valor unitário do item 2'), '5000');
    await flushReact();
    // The only remaining item is free-form, so nothing declares a função and nothing
    // feeds the fallback base either.
    await click(buttonByLabel('Remover item 1'));
    await flushReact();

    await goToCosts();
    await addProfessional();
    await pickOption('Função do profissional 1', 'Desenvolvedor');
    await pickOption('Profissional 1', 'Bruno Entrega');
    await flushReact();
    await setCostUnit('%');
    await typeInto(labeledInput('Custo alocado do profissional 1'), '10');
    await flushReact();

    expect(rowFooterText()).toContain('Nenhum item de produto na proposta');
    await click(buttonByText('Salvar rascunho'));
    expect(onSave.mock.calls.at(-1)![0].professionals[0]!.costBrl).toBe(0);
  });

  it('toggling back to R$ freezes the resolved cents', async () => {
    await renderWizard();
    await goToCosts();
    await addProfessional();
    await pickOption('Função do profissional 1', 'Desenvolvedor');
    await pickOption('Profissional 1', 'Bruno Entrega');
    await flushReact();

    await setCostUnit('%');
    await typeInto(labeledInput('Custo alocado do profissional 1'), '10');
    await flushReact();
    await setCostUnit('R$');

    expect(labeledInput('Custo alocado do profissional 1').value).toBe('2000');
    await click(buttonByText('Salvar rascunho'));
    expect(onSave.mock.calls.at(-1)![0].professionals[0]!.costBrl).toBe(200000);
  });

  it('does not let a produto default clobber a percent row, and re-bases it live', async () => {
    await renderWizard();
    await goToCosts();
    await addProfessional();
    await pickOption('Função do profissional 1', 'Desenvolvedor');
    await flushReact();
    await setCostUnit('%');
    await typeInto(labeledInput('Custo alocado do profissional 1'), '10');
    await flushReact();

    await backToProposta();
    await typeInto(labeledInput('Valor unitário do item 1'), '40000');
    await flushReact();
    await goToCosts();

    // The percentage is the operator's decision and survives; the cents follow the base.
    expect(labeledInput('Custo alocado do profissional 1').value).toBe('10');
    expect(rowFooterText()).toContain('10% de R$ 40.000,00 (FXL Custom)');
    expect(rowFooterText()).toContain('R$ 4.000,00');
  });

  it('returns a percent row to R$ and to the produto default on Restaurar padrão', async () => {
    await renderWizard();
    await goToCosts();
    await addProfessional();
    await pickOption('Função do profissional 1', 'Desenvolvedor');
    await flushReact();
    await setCostUnit('%');
    await typeInto(labeledInput('Custo alocado do profissional 1'), '10');
    await flushReact();

    const restore = [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === 'Restaurar padrão',
    );
    if (!(restore instanceof HTMLButtonElement)) throw new Error('Restaurar padrão not found');
    await click(restore);
    await flushReact();

    // Back to the produto's own cents, in R$, un-pinned.
    expect(labeledInput('Custo alocado do profissional 1').value).toBe('1000');
    expect(rowFooterText()).toContain('5% de FXL Custom (R$ 20.000,00)');
    expect(rowFooterText()).not.toContain('Alterado manualmente');
  });

  it('shows the funcao on the Custo profissional row of the payables preview', async () => {
    await renderWizard();
    await goToCosts();
    await addProfessional();
    await pickOption('Função do profissional 1', 'Desenvolvedor');
    await pickOption('Profissional 1', 'Bruno Entrega');
    await flushReact();
    await click(buttonByText('Avançar'));

    expect(container.textContent).toContain('Alocação - Bruno Entrega · Desenvolvedor');
  });
});
