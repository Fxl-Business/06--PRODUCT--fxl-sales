// @vitest-environment happy-dom

import * as React from 'react';
import type { HTMLAttributes } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfessionalSplitPanel, type SplitParcela } from '../ProfessionalSplitPanel';
import { SaleWizardDialog } from '../SalesOpsApp';
import type {
  CreateSalePayload,
  SalesOpsBootstrap,
  SalesOpsFuncao,
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

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

const areaId = '66666666-6666-4666-8666-666666666666';
const productId = '11111111-1111-4111-8111-111111111111';
const clientId = '33333333-3333-4333-8333-333333333333';
const sellerId = '44444444-4444-4444-8444-444444444444';
const deliveryPersonId = '88888888-8888-4888-8888-888888888888';
const devFuncaoId = 'fc000010-0000-4000-8000-000000000010';
const vendedorFuncaoId = 'fc000001-0000-4000-8000-000000000001';
const saleId = '77777777-7777-4777-8777-777777777777';

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

function product(setupBrl: number): SalesOpsProduct {
  return {
    id: productId,
    orgId: 'org-test',
    name: 'FXL Custom',
    codeSuffix: '1',
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

/**
 * No `productFuncaoCosts` anywhere in this file, deliberately: with none, the
 * produto seeds no `Profissionais alocados` row, so `profissional 1` always means
 * "the row this test added" without the seed-clearing dance
 * `sale-wizard-funcao-costs.test.tsx` needs.
 */
function makeBootstrap(itemCents: number): SalesOpsBootstrap {
  return {
    sales: [],
    products: [product(itemCents)],
    productFuncaoCosts: [],
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
    funcoes: [
      funcao(devFuncaoId, 'Desenvolvedor'),
      funcao(vendedorFuncaoId, 'Vendedor', { slug: 'vendedor', isSystem: true }),
    ],
    people: [
      {
        id: sellerId,
        orgId: 'org-test',
        displayName: 'Ana Martins',
        contactEmail: null,
        status: 'active',
        funcaoIds: [vendedorFuncaoId],
        funcoes: [{ id: vendedorFuncaoId, name: 'Vendedor', slug: 'vendedor', isSystem: true }],
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
        funcoes: [
          { id: devFuncaoId, name: 'Desenvolvedor', slug: 'desenvolvedor', isSystem: false },
        ],
        createdAt: '2026-07-13T12:00:00.000Z',
        updatedAt: null,
      },
    ],
    payables: [],
    saleItems: [],
    receivables: [],
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
}

/** A stored proposta carrying a persisted `[3000, 7000]` override. */
const storedSale: SalesOpsSale = {
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
  // `draft` and not `open` only so the footer keeps its `Salvar rascunho`; the edit
  // prefill this test exercises is identical for both statuses.
  status: 'draft',
  paymentMethod: 'pix',
  condition: 'installments',
  installments: 2,
  baseDate: '2026-07-13T00:00:00.000Z',
  notes: null,
  wonAt: null,
  lostAt: null,
  totalBrl: 3000000,
  recurringBrl: 0,
  sellerCommissionPct: '10.00',
  finderCommissionPct: '2.00',
  taxPct: '6.00',
  otherCostsBrl: 0,
  professionalCostsBrl: 1000000,
  sellerCommissionBrl: 300000,
  finderCommissionBrl: 0,
  taxBrl: 180000,
  netMarginBrl: 1520000,
  netMarginPct: '50.67',
  createdAt: '2026-07-13T12:00:00.000Z',
  updatedAt: null,
};

function storedBootstrap(): SalesOpsBootstrap {
  const base = makeBootstrap(3000000);
  return {
    ...base,
    sales: [storedSale],
    saleItems: [
      {
        saleId,
        productId,
        productNameSnapshot: 'FXL Custom',
        productTypeSnapshot: 'product',
        quantity: 1,
        unitBrl: 3000000,
        subtotalBrl: 3000000,
        areaId,
        areaNameSnapshot: 'FXL Tech',
      },
    ],
    receivables: [
      {
        id: 'rec-1',
        saleId,
        label: '1/2',
        dueDate: '2026-07-13',
        amountBrl: 1500000,
        method: 'pix',
        status: 'open',
      },
      {
        id: 'rec-2',
        saleId,
        label: '2/2',
        dueDate: '2026-08-13',
        amountBrl: 1500000,
        method: 'pix',
        status: 'open',
      },
    ],
    saleProfessionals: [
      {
        saleId,
        personId: deliveryPersonId,
        personNameSnapshot: 'Bruno Entrega',
        funcaoId: devFuncaoId,
        funcaoNameSnapshot: 'Desenvolvedor',
        role: 'Desenvolvedor',
        costBrl: 1000000,
        costSplitBp: [3000, 7000],
      },
    ],
  };
}

let container: HTMLDivElement;
let root: Root;
let onSave: ReturnType<typeof vi.fn<(payload: CreateSalePayload) => void>>;

async function renderWizard(bootstrap: SalesOpsBootstrap, sale: SalesOpsSale | null = null) {
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
        bootstrap={bootstrap}
        editSale={sale}
        onClose={vi.fn()}
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

function buttonByLabel(label: string): HTMLButtonElement {
  const match = container.querySelector(`button[aria-label="${label}"]`);
  if (!(match instanceof HTMLButtonElement)) throw new Error(`button not found: ${label}`);
  return match;
}

function maybeButtonByLabel(label: string): HTMLButtonElement | null {
  const match = container.querySelector(`button[aria-label="${label}"]`);
  return match instanceof HTMLButtonElement ? match : null;
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

async function pickOption(ariaLabel: string, optionLabel: string) {
  await click(comboboxTrigger(ariaLabel));
  const row = [...container.querySelectorAll('[role="option"]')].find(
    (candidate) => candidate.textContent?.trim() === optionLabel,
  );
  if (!(row instanceof HTMLElement)) throw new Error(`option not found: ${optionLabel}`);
  await click(row);
  await flushReact();
}

/** The `col-span-full` disclosure of one professional row, or null while it is closed. */
function splitPanel(index = 1): HTMLElement | null {
  const match = container.querySelector(`[data-split-panel="${index}"]`);
  return match instanceof HTMLElement ? match : null;
}

function splitPanelText(index = 1): string {
  const panel = splitPanel(index);
  if (!panel) throw new Error(`split panel ${index} is not open`);
  return panel.textContent ?? '';
}

/**
 * Drives step 2 into an explicit parcela list. The count goes first and the
 * amounts after, so the regeneration the count triggers cannot overwrite them.
 */
async function setPlan(amounts: string[]) {
  await typeInto(labeledInput('Parcelas restantes'), String(amounts.length));
  await flushReact();
  for (const [index, amount] of amounts.entries()) {
    await typeInto(labeledInput(`Valor da parcela ${index + 1}`), amount);
    await flushReact();
  }
}

/**
 * Step 1 -> step 3 with one profissional allocated, its cost typed in reais.
 * `amounts` and `costBrl` are as the operator types them, in reais.
 */
async function openCostsWith(options: {
  itemCents: number;
  amounts: string[];
  costBrl: string;
  bootstrap?: SalesOpsBootstrap;
}) {
  await renderWizard(options.bootstrap ?? makeBootstrap(options.itemCents));
  await click(buttonByText('Avançar'));
  await setPlan(options.amounts);
  await click(buttonByText('Avançar'));
  await click(buttonByText('+ profissional'));
  await flushReact();
  await pickOption('Função do profissional 1', 'Desenvolvedor');
  await pickOption('Profissional 1', 'Bruno Entrega');
  await typeInto(labeledInput('Custo alocado do profissional 1'), options.costBrl);
  await flushReact();
}

function triggerText(index = 1): string {
  return buttonByLabel(`Detalhe de pagamento do profissional ${index}`).textContent?.trim() ?? '';
}

async function openSplitPanel(index = 1) {
  await click(buttonByLabel(`Detalhe de pagamento do profissional ${index}`));
  await flushReact();
}

/** Mounts the panel on its own, for a state the wizard's step-2 gate cannot reach. */
async function renderSplitPanel(props: {
  costCents: number;
  parcelas: SplitParcela[];
  splitBp: number[] | null;
}) {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  onSave = vi.fn<(payload: CreateSalePayload) => void>();
  await act(async () => {
    root.render(
      <ProfessionalSplitPanel
        costCents={props.costCents}
        onChange={vi.fn()}
        parcelas={props.parcelas}
        personName="Bruno Entrega"
        rowNumber={1}
        splitBp={props.splitBp}
      />,
    );
  });
}

async function saveDraft(): Promise<CreateSalePayload> {
  await click(buttonByText('Salvar rascunho'));
  const payload = onSave.mock.calls.at(-1)?.[0];
  if (!payload) throw new Error('onSave was never called');
  return payload;
}

describe('sale wizard professional payment split', () => {
  it('shows the default pro-rata split for the parcelas', async () => {
    await openCostsWith({
      itemCents: 500000,
      amounts: ['1000', '2000', '2000'],
      costBrl: '500',
    });

    // The trigger states the schedule length before it is even opened.
    expect(triggerText()).toBe('Detalhe de pagamento (3x)');
    await openSplitPanel();

    const text = splitPanelText();
    expect(text).toContain('Parcela 1');
    expect(text).toContain('R$ 100,00');
    expect(text).toContain('R$ 200,00');
    expect(text).toContain('Total');
    expect(text).toContain('R$ 500,00');
    // The default is pro rata: 20% / 40% / 40% of the parcelas.
    expect(text).toContain('20,00%');
    expect(text).toContain('40,00%');
  });

  it('reproduces the user 10k/20k/20k/50k case', async () => {
    await openCostsWith({
      itemCents: 10000000,
      amounts: ['10000', '20000', '20000', '50000'],
      costBrl: '10000',
    });
    await openSplitPanel();

    const text = splitPanelText();
    expect(text).toContain('R$ 1.000,00');
    expect(text).toContain('R$ 2.000,00');
    expect(text).toContain('R$ 5.000,00');
    expect(text).toContain('R$ 10.000,00');
  });

  it('submits costSplitBp null while the split is untouched', async () => {
    await openCostsWith({
      itemCents: 500000,
      amounts: ['1000', '2000', '2000'],
      costBrl: '500',
    });

    const payload = await saveDraft();
    expect(payload.professionals).toHaveLength(1);
    expect(payload.professionals[0]!.costSplitBp).toBeNull();
  });

  it('submits a 30/70 override and shows its reais', async () => {
    await openCostsWith({
      itemCents: 3000000,
      amounts: ['10000', '10000', '10000'],
      costBrl: '10000',
    });
    await openSplitPanel();
    await click(buttonByLabel('Personalizar divisão do profissional 1'));
    await flushReact();
    await click(buttonByLabel('Remover parte 3 do profissional 1'));
    await flushReact();
    await typeInto(labeledInput('Parte 1 do profissional 1'), '30');
    await flushReact();
    await typeInto(labeledInput('Parte 2 do profissional 1'), '70');
    await flushReact();

    const text = splitPanelText();
    expect(text).toContain('R$ 3.000,00');
    expect(text).toContain('R$ 7.000,00');
    // Two parts on a three-parcela plan: the suffix IS the "this row diverges" signal.
    expect(triggerText()).toBe('Detalhe de pagamento (2x)');

    const payload = await saveDraft();
    expect(payload.professionals[0]!.costSplitBp).toEqual([3000, 7000]);
  });

  it('submits a one-part override for a professional paid in a single time', async () => {
    await openCostsWith({
      itemCents: 3000000,
      amounts: ['10000', '10000', '10000'],
      costBrl: '10000',
    });
    await openSplitPanel();
    await click(buttonByLabel('Personalizar divisão do profissional 1'));
    await flushReact();
    await click(buttonByLabel('Remover parte 3 do profissional 1'));
    await flushReact();
    await click(buttonByLabel('Remover parte 2 do profissional 1'));
    await flushReact();
    await typeInto(labeledInput('Parte 1 do profissional 1'), '100');
    await flushReact();

    expect(splitPanelText()).toContain('As parcelas 2 em diante não pagam este profissional.');
    // The lone part is the whole cost, paid out of parcela 1.
    expect(splitPanelText()).toContain('R$ 10.000,00');

    const payload = await saveDraft();
    expect(payload.professionals[0]!.costSplitBp).toEqual([10000]);
  });

  it('blocks advancing while the parts do not sum to 100%', async () => {
    await openCostsWith({
      itemCents: 3000000,
      amounts: ['10000', '10000', '10000'],
      costBrl: '10000',
    });
    await openSplitPanel();
    await click(buttonByLabel('Personalizar divisão do profissional 1'));
    await flushReact();
    await click(buttonByLabel('Remover parte 3 do profissional 1'));
    await flushReact();
    await typeInto(labeledInput('Parte 1 do profissional 1'), '30');
    await flushReact();
    await typeInto(labeledInput('Parte 2 do profissional 1'), '30');
    await flushReact();

    expect(splitPanelText()).toContain('60,00%');

    await click(buttonByText('Avançar'));
    await flushReact();

    expect(container.textContent).toContain(
      'A divisão de pagamento de cada profissional deve somar 100%.',
    );
    // Still on step 3: the Revisão card never mounted.
    expect(container.textContent).not.toContain('Dados da proposta');
  });

  it('keeps the override when the cost changes', async () => {
    await openCostsWith({
      itemCents: 3000000,
      amounts: ['15000', '15000'],
      costBrl: '10000',
    });
    await openSplitPanel();
    await click(buttonByLabel('Personalizar divisão do profissional 1'));
    await flushReact();
    await typeInto(labeledInput('Parte 1 do profissional 1'), '30');
    await flushReact();
    await typeInto(labeledInput('Parte 2 do profissional 1'), '70');
    await flushReact();

    expect(splitPanelText()).toContain('R$ 3.000,00');
    expect(splitPanelText()).toContain('R$ 7.000,00');

    /*
      THE test that justifies basis points. A cents-denominated schedule would
      still read R$ 3.000,00 / R$ 7.000,00 here, or would need a rewrite on this
      very keystroke; bp are a RULE, so the reais re-derive and the stored value
      does not move.
    */
    await typeInto(labeledInput('Custo alocado do profissional 1'), '20000');
    await flushReact();

    expect(splitPanelText()).toContain('R$ 6.000,00');
    expect(splitPanelText()).toContain('R$ 14.000,00');

    const payload = await saveDraft();
    expect(payload.professionals[0]!.costBrl).toBe(2000000);
    expect(payload.professionals[0]!.costSplitBp).toEqual([3000, 7000]);
  });

  it('distributes equally with the last part absorbing the remainder', async () => {
    await openCostsWith({
      itemCents: 3000000,
      amounts: ['10000', '10000', '10000'],
      costBrl: '10000',
    });
    await openSplitPanel();
    await click(buttonByLabel('Personalizar divisão do profissional 1'));
    await flushReact();
    await click(buttonByLabel('Distribuir igualmente entre as partes do profissional 1'));
    await flushReact();

    expect(labeledInput('Parte 1 do profissional 1').value).toBe('33.33');
    expect(labeledInput('Parte 2 do profissional 1').value).toBe('33.33');
    expect(labeledInput('Parte 3 do profissional 1').value).toBe('33.34');

    const payload = await saveDraft();
    expect(payload.professionals[0]!.costSplitBp).toEqual([3333, 3333, 3334]);
  });

  it('restores the default with Usar padrão', async () => {
    await openCostsWith({
      itemCents: 3000000,
      amounts: ['10000', '10000', '10000'],
      costBrl: '10000',
    });
    await openSplitPanel();
    await click(buttonByLabel('Personalizar divisão do profissional 1'));
    await flushReact();
    await typeInto(labeledInput('Parte 1 do profissional 1'), '50');
    await flushReact();
    await click(buttonByLabel('Usar divisão padrão do profissional 1'));
    await flushReact();

    // Back to the read-only default list: no part input survives.
    expect(container.querySelector('input[aria-label="Parte 1 do profissional 1"]')).toBeNull();

    const payload = await saveDraft();
    expect(payload.professionals[0]!.costSplitBp).toBeNull();
  });

  it('reopens a stored override on the edit path', async () => {
    await renderWizard(storedBootstrap(), storedSale);
    await click(buttonByText('Avançar'));
    await click(buttonByText('Avançar'));
    await openSplitPanel();

    expect(labeledInput('Parte 1 do profissional 1').value).toBe('30');
    expect(labeledInput('Parte 2 do profissional 1').value).toBe('70');

    const payload = await saveDraft();
    expect(payload.professionals[0]!.costSplitBp).toEqual([3000, 7000]);
  });

  it('caps the part count at the parcela count', async () => {
    await openCostsWith({
      itemCents: 3000000,
      amounts: ['15000', '15000'],
      costBrl: '10000',
    });
    await openSplitPanel();
    await click(buttonByLabel('Personalizar divisão do profissional 1'));
    await flushReact();

    expect(buttonByLabel('Adicionar parte ao profissional 1').disabled).toBe(true);

    await click(buttonByLabel('Remover parte 2 do profissional 1'));
    await flushReact();
    expect(buttonByLabel('Adicionar parte ao profissional 1').disabled).toBe(false);
  });

  /*
    Rendered DIRECTLY rather than driven through the wizard, and that is the finding
    rather than a shortcut: step 2's `planRowsValid` requires every parcela amount to
    be `> 0` and `canSaveBasics` requires `totalCents > 0`, and both the `Avançar`
    button and the `WizardStepper` gate on them, so an operator cannot reach step 3
    with an empty plan at all. The branch is the wizard's mirror of the server's
    `m === 0` one-shot fallback and stays as a guard; owning the panel as its own
    module is what makes the guard assertable instead of dead code.
  */
  it('tells the operator to set a plan when there is no parcela', async () => {
    await renderSplitPanel({ costCents: 1000000, parcelas: [], splitBp: null });

    expect(splitPanelText()).toContain(
      'Defina o plano de pagamento na etapa 2 para dividir este custo.',
    );
    expect(maybeButtonByLabel('Personalizar divisão do profissional 1')).toBeNull();
  });
});
