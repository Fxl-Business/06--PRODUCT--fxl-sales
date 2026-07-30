// @vitest-environment happy-dom

import * as React from 'react';
import type { HTMLAttributes } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SaleWizardDialog } from '../SalesOpsApp';
import type {
  CreateSalePayload,
  SalesOpsBootstrap,
  SalesOpsPersonFuncao,
  SalesOpsProduct,
  SalesOpsSale,
} from '../types';

const funcaoVendedor: SalesOpsPersonFuncao = {
  id: 'fc000001-0000-4000-8000-000000000001',
  name: 'Vendedor',
  slug: 'vendedor',
  isSystem: true,
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

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

const areaId = '66666666-6666-4666-8666-666666666666';
const productAId = '11111111-1111-4111-8111-111111111111';
const productBId = '22222222-2222-4222-8222-222222222222';
const clientId = '33333333-3333-4333-8333-333333333333';
const sellerId = '44444444-4444-4444-8444-444444444444';
const finderId = '55555555-5555-4555-8555-555555555555';
const saleId = '77777777-7777-4777-8777-777777777777';

function product(
  id: string,
  name: string,
  sellerOnly: string,
  sellerWithFinder: string,
  finder: string,
): SalesOpsProduct {
  return {
    id,
    orgId: 'org-test',
    name,
    codeSuffix: id.startsWith('1') ? '1' : '2',
    areaId,
    openPrice: false,
    setupBrl: 100000,
    hasMonthly: false,
    monthlyBrl: 0,
    recurringCommission: false,
    hasFinderCommission: true,
    sellerCommissionType: 'pct',
    sellerCommissionValue: sellerOnly,
    sellerWithFinderCommissionType: 'pct',
    sellerWithFinderCommissionValue: sellerWithFinder,
    finderCommissionType: 'pct',
    finderCommissionValue: finder,
    modules: [],
    providers: [],
    status: 'active',
    createdAt: '2026-07-13T12:00:00.000Z',
    updatedAt: null,
  };
}

const productA = product(productAId, 'Product A', '10', '7', '3');
const productB = product(productBId, 'Product B', '12', '8', '4');

const bootstrap: SalesOpsBootstrap = {
  sales: [],
  products: [productA, productB],
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
  funcoes: [],
  people: [
    {
      id: sellerId,
      orgId: 'org-test',
      displayName: 'Seller A',
      contactEmail: null,
      status: 'active',
      funcaoIds: [funcaoVendedor.id],
      funcoes: [funcaoVendedor],
      createdAt: '2026-07-13T12:00:00.000Z',
      updatedAt: null,
    },
    {
      id: finderId,
      orgId: 'org-test',
      displayName: 'Finder A',
      contactEmail: null,
      status: 'active',
      funcaoIds: ['fc000002-0000-4000-8000-000000000002'],
      funcoes: [
        {
          id: 'fc000002-0000-4000-8000-000000000002',
          name: 'Finder',
          slug: 'finder',
          isSystem: true,
        },
      ],
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
  productFuncaoCosts: [],
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

/**
 * A stored proposta whose three step-3 numbers all DIFFER from the defaults
 * Product A would propose (seller 10, finder 2, imposto 6, outros 0.00), which is
 * what makes the prefill round trip a real test rather than a coincidence.
 */
const editSale: SalesOpsSale = {
  id: saleId,
  orgId: 'org-test',
  sequence: 1,
  code: '0001-1',
  clientId,
  clientNameSnapshot: 'Client A',
  sellerPersonId: sellerId,
  sellerNameSnapshot: 'Seller A',
  finderPersonId: finderId,
  finderNameSnapshot: 'Finder A',
  status: 'open',
  paymentMethod: 'pix',
  condition: 'cash',
  installments: 1,
  baseDate: '2026-07-13T00:00:00.000Z',
  notes: null,
  wonAt: null,
  lostAt: null,
  totalBrl: 100000,
  recurringBrl: 0,
  sellerCommissionPct: '15.00',
  finderCommissionPct: '3.00',
  taxPct: '9.00',
  otherCostsBrl: 50000,
  professionalCostsBrl: 0,
  sellerCommissionBrl: 15000,
  finderCommissionBrl: 0,
  taxBrl: 9000,
  netMarginBrl: 26000,
  netMarginPct: '26.00',
  createdAt: '2026-07-13T12:00:00.000Z',
  updatedAt: null,
};

const editBootstrap: SalesOpsBootstrap = {
  ...bootstrap,
  sales: [editSale],
  saleItems: [
    {
      saleId,
      productId: productAId,
      productNameSnapshot: 'Product A',
      productTypeSnapshot: 'product',
      quantity: 1,
      unitBrl: 100000,
      subtotalBrl: 100000,
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
      amountBrl: 100000,
      method: 'pix',
      status: 'open',
    },
  ],
};

let container: HTMLDivElement;
let root: Root;
let onSave: ReturnType<typeof vi.fn<(payload: CreateSalePayload) => void>>;

async function renderWizard(sale: SalesOpsSale | null = null) {
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
        bootstrap={sale ? editBootstrap : bootstrap}
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

beforeEach(() => {
  // Each test renders explicitly, because half of them need the edit path.
});

function buttonByText(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`button not found: ${label}`);
  return match;
}

function buttonsByText(label: string): HTMLButtonElement[] {
  return [...container.querySelectorAll('button')].filter(
    (candidate) => candidate.textContent?.trim() === label,
  );
}

function fieldLabel(label: string): HTMLLabelElement {
  const match = [...container.querySelectorAll('label')].find((candidate) =>
    candidate.textContent?.trim().startsWith(label),
  );
  if (!(match instanceof HTMLLabelElement)) throw new Error(`field not found: ${label}`);
  return match;
}

function fieldInput(label: string): HTMLInputElement {
  const input = fieldLabel(label).querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error(`field input not found: ${label}`);
  return input;
}

function fieldHasChip(label: string): boolean {
  return (fieldLabel(label).textContent ?? '').includes('Alterado manualmente');
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

async function pickOption(ariaLabel: string, optionLabel: string) {
  await click(comboboxTrigger(ariaLabel));
  const row = [...container.querySelectorAll('[role="option"]')].find((candidate) =>
    candidate.textContent?.trim().startsWith(optionLabel),
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

describe('sale wizard per-proposta overrides', () => {
  it('keeps a hand-typed seller commission when the primary product changes', async () => {
    await renderWizard();
    await goToCosts();
    expect(fieldInput('Comissão vendedor %').value).toBe('10');

    await typeInto(fieldInput('Comissão vendedor %'), '15');
    expect(fieldInput('Comissão vendedor %').value).toBe('15');

    await backToProposta();
    await pickOption('Produto / serviço do item 1', 'Product B');
    await flushReact();
    await goToCosts();

    // Pinned: the produto default of 12 does not overwrite the operator's 15.
    expect(fieldInput('Comissão vendedor %').value).toBe('15');
    // Positive control on the same render: the field nobody touched DID move to
    // Product B's default, so the pin above is per field and not a global freeze.
    expect(fieldInput('Comissão finder %').value).toBe('2');
  });

  it('re-applies the product default to a field the operator never touched', async () => {
    await renderWizard();
    await click(buttonByText('Essa proposta teve um finder'));
    await flushReact();
    await goToCosts();
    expect(fieldInput('Comissão vendedor %').value).toBe('7');
    expect(fieldInput('Comissão finder %').value).toBe('3');

    await backToProposta();
    await pickOption('Produto / serviço do item 1', 'Product B');
    await flushReact();
    await goToCosts();

    expect(fieldInput('Comissão vendedor %').value).toBe('8');
    expect(fieldInput('Comissão finder %').value).toBe('4');
  });

  it('keeps a hand-typed percentage when finder participation is toggled off and back on', async () => {
    await renderWizard();
    await goToCosts();
    await typeInto(fieldInput('Comissão vendedor %'), '15');

    await backToProposta();
    await click(buttonByText('Essa proposta teve um finder'));
    await flushReact();
    await goToCosts();
    expect(fieldInput('Comissão vendedor %').value).toBe('15');
    // Untouched, so it followed the with-finder snapshot.
    expect(fieldInput('Comissão finder %').value).toBe('3');

    await backToProposta();
    await click(buttonByText('remover'));
    await flushReact();
    await goToCosts();
    expect(fieldInput('Comissão vendedor %').value).toBe('15');
    expect(fieldInput('Comissão finder %').value).toBe('2');
  });

  it('marks an overridden field with Alterado manualmente and restores the product default', async () => {
    await renderWizard();
    await goToCosts();
    expect(fieldHasChip('Comissão vendedor %')).toBe(false);

    await typeInto(fieldInput('Comissão vendedor %'), '15');
    expect(fieldHasChip('Comissão vendedor %')).toBe(true);
    // The untouched neighbour is not flagged.
    expect(fieldHasChip('Comissão finder %')).toBe(false);

    const restore = fieldLabel('Comissão vendedor %').querySelector('button');
    if (!(restore instanceof HTMLButtonElement)) throw new Error('Restaurar padrão not found');
    expect(restore.textContent?.trim()).toBe('Restaurar padrão');
    await click(restore);

    expect(fieldInput('Comissão vendedor %').value).toBe('10');
    expect(fieldHasChip('Comissão vendedor %')).toBe(false);

    /*
      Restoring must clear the PIN, not merely rewrite the value. The chip alone
      cannot prove that - a restored value equals the default, so the chip would be
      hidden either way. A produto change is the only observable difference: a
      still-pinned field would stay on 10.
    */
    await backToProposta();
    await pickOption('Produto / serviço do item 1', 'Product B');
    await flushReact();
    await goToCosts();
    expect(fieldInput('Comissão vendedor %').value).toBe('12');
  });

  it('does not mark a field whose typed value equals the default', async () => {
    await renderWizard();
    await goToCosts();

    // Typed by hand, so the field IS pinned - but it does not diverge, so nothing
    // is advertised as changed.
    await typeInto(fieldInput('Comissão vendedor %'), '7');
    await typeInto(fieldInput('Comissão vendedor %'), '10');
    expect(fieldHasChip('Comissão vendedor %')).toBe(false);
    // Positive control: one more keystroke away from the default does flag it.
    await typeInto(fieldInput('Comissão vendedor %'), '11');
    expect(fieldHasChip('Comissão vendedor %')).toBe(true);
  });

  it('pins the imposto and outros custos fields independently', async () => {
    await renderWizard();
    await goToCosts();

    await typeInto(fieldInput('Imposto %'), '9');
    await typeInto(fieldInput('Outros custos (R$)'), '500');
    expect(fieldHasChip('Imposto %')).toBe(true);
    expect(fieldHasChip('Outros custos (R$)')).toBe(true);
    expect(fieldHasChip('Comissão vendedor %')).toBe(false);

    await backToProposta();
    await pickOption('Produto / serviço do item 1', 'Product B');
    await flushReact();
    await goToCosts();

    expect(fieldInput('Imposto %').value).toBe('9');
    expect(fieldInput('Outros custos (R$)').value).toBe('500');
  });

  it('keeps every stored override when editing an existing proposta and then changing the product', async () => {
    await renderWizard(editSale);
    await goToCosts();

    expect(fieldInput('Comissão vendedor %').value).toBe('15');
    expect(fieldInput('Imposto %').value).toBe('9');
    expect(fieldInput('Outros custos (R$)').value).toBe('500');
    // Seeded from the prefill, not from an onChange, so the marker is already on.
    expect(fieldHasChip('Comissão vendedor %')).toBe(true);
    // 3.00 IS Product A's with-finder finder default, so it is NOT treated as an
    // override and correctly carries no marker.
    expect(fieldHasChip('Comissão finder %')).toBe(false);

    await backToProposta();
    expect(comboboxText('Produto / serviço do item 1')).toBe('Product A');
    await pickOption('Produto / serviço do item 1', 'Product B');
    await flushReact();
    await goToCosts();

    expect(fieldInput('Comissão vendedor %').value).toBe('15');
    expect(fieldInput('Imposto %').value).toBe('9');
    expect(fieldInput('Outros custos (R$)').value).toBe('500');
    // Positive control: the ONE stored value that matched its default did re-apply,
    // so the three above survived a produto change that really did fire.
    expect(fieldInput('Comissão finder %').value).toBe('4');
  });

  it('sends the overridden percentages and costs in the save payload', async () => {
    await renderWizard(editSale);
    await goToCosts();
    await click(buttonByText('Avançar'));
    await click(buttonByText('Salvar proposta'));

    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sellerCommissionPct: 15,
        taxPct: 9,
        otherCostsBrl: 50000,
      }),
    );
  });

  it('shows one Margem líquida in Custos e margem and the same one in Revisão', async () => {
    await renderWizard();
    await goToCosts();
    await typeInto(fieldInput('Comissão vendedor %'), '15');
    await typeInto(fieldInput('Imposto %'), '6');
    await flushReact();

    // 100000 cents total, one parcela: floor(100000 * 15 / 100) = 15000 and
    // floor(100000 * 6 / 100) = 6000, so the margin is 79000 cents = R$ 790,00.
    expect(container.textContent).toContain('R$ 790');
    expect(container.textContent).toContain('(79%)');
    await click(buttonByText('Avançar'));
    // Same number in Revisão, which is the whole point of one shared model.
    expect(container.textContent).toContain('R$ 790 (79%)');
    // The two commission lines and the imposto line carry the overridden rates.
    expect(container.textContent).toContain('Comissão vendedor (15%)R$ 150,00');
    expect(container.textContent).toContain('Imposto (6%)R$ 60,00');
    // The Revisão card breaks the costs out instead of one `Custos + imposto` line.
    expect(container.textContent).toContain('Custos profissionais');
    expect(container.textContent).toContain('Outros custos');
    expect(container.textContent).toContain('Comissão vendedor (15%)');
    expect(container.textContent).not.toContain('Custos + imposto');
    expect(buttonsByText('editar').length).toBeGreaterThan(0);
  });

  it('states the Revisão total on the same basis as the margin, so a bounded recorrência cannot make the margin exceed the total', async () => {
    await renderWizard();
    // 1 x R$ 1.000,00 de itens.
    await click(buttonByText('Avançar'));
    await pickOption('Recorrência', 'mensal');
    await flushReact();
    // R$ 500,00/mês por 4 ciclos = R$ 2.000,00 dentro do total.
    await typeInto(labeledInput('Valor da mensalidade'), '500');
    await typeInto(labeledInput('Número de ciclos'), '4');
    await flushReact();
    await click(buttonByText('Avançar'));
    await typeInto(fieldInput('Comissão vendedor %'), '0');
    await typeInto(fieldInput('Imposto %'), '0');
    await flushReact();
    await click(buttonByText('Avançar'));

    /*
      The `Total` line used to render the ITEM total only, while the margin has
      always been computed against items plus the bounded recorrência - the basis
      `sales_ops_sales.total_brl` actually persists. With no costs at all the
      margin IS the total, which is the sharpest possible statement of the rule
      and would have read as `Total R$ 1.000,00` beside `Margem R$ 3.000` before.
    */
    expect(container.textContent).toContain('TotalR$ 3.000,00');
    expect(container.textContent).toContain('R$ 3.000 (100%)');
    // The mensalidade is still stated separately, so the composition is visible.
    expect(container.textContent).toContain('R$ 500/mês por 4 ciclos');
  });

  it('leaves the Revisão total at the itens total when the recorrência is indeterminada', async () => {
    await renderWizard();
    await click(buttonByText('Avançar'));
    await pickOption('Recorrência', 'mensal');
    await flushReact();
    await typeInto(labeledInput('Valor da mensalidade'), '500');
    // Blank ciclos is the only expression of prazo indeterminado.
    await typeInto(labeledInput('Número de ciclos'), '');
    await flushReact();
    await click(buttonByText('Avançar'));
    await typeInto(fieldInput('Comissão vendedor %'), '0');
    await typeInto(fieldInput('Imposto %'), '0');
    await flushReact();
    await click(buttonByText('Avançar'));

    // `cycles: null` generates no bounded rows anywhere, so the API's own
    // total_brl is the itens total and this line must say the same.
    expect(container.textContent).toContain('TotalR$ 1.000,00');
    expect(container.textContent).toContain('R$ 1.000 (100%)');
    expect(container.textContent).toContain('(indeterminado)');
  });
});
