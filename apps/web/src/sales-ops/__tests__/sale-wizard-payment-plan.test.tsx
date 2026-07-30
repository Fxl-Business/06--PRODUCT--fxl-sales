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

const areaId = '66666666-6666-4666-8666-666666666666';
const fixedProductId = '11111111-1111-4111-8111-111111111111';
const recurringProductId = '22222222-2222-4222-8222-222222222222';

function product(patch: Partial<SalesOpsProduct> = {}): SalesOpsProduct {
  return {
    id: fixedProductId,
    orgId: 'org-test',
    name: 'FXL Finance',
    codeSuffix: 'FIN',
    areaId,
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

const fixedProduct = product();
const recurringProduct = product({
  id: recurringProductId,
  name: 'FXL Advisor',
  hasMonthly: true,
  monthlyBrl: 100000,
  setupBrl: 100000,
});

const bootstrap: SalesOpsBootstrap = {
  sales: [],
  products: [fixedProduct, recurringProduct],
  clients: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      orgId: 'org-test',
      name: 'SegPro',
      contact: null,
      createdAt: '2026-07-29T12:00:00.000Z',
      updatedAt: null,
    },
  ],
  funcoes: [],
  people: [
    {
      id: '44444444-4444-4444-8444-444444444444',
      orgId: 'org-test',
      displayName: 'Ana Martins',
      contactEmail: null,
      status: 'active',
      funcaoIds: [funcaoVendedor.id],
      funcoes: [funcaoVendedor],
      createdAt: '2026-07-29T12:00:00.000Z',
      updatedAt: null,
    },
  ],
  areas: [
    {
      id: areaId,
      orgId: 'org-test',
      name: 'FXL Tech',
      status: 'active',
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
};

let container: HTMLDivElement;
let root: Root;
let onSave: ReturnType<typeof vi.fn<(payload: CreateSalePayload) => void>>;

beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  onSave = vi.fn<(payload: CreateSalePayload) => void>();
  await act(async () => {
    root.render(
      <SaleWizardDialog
        bootstrap={bootstrap}
        editSale={null}
        onClose={vi.fn()}
        onSave={onSave}
        open
        saving={false}
      />,
    );
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.querySelectorAll('[data-radix-portal]').forEach((portal) => portal.remove());
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

/** Open the picker and commit the row whose visible label starts with `optionLabel`. */
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

async function changeInput(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}


describe('sale wizard payment plan', () => {
  it('splits the plan into N equal monthly parcelas with the remainder on the last', async () => {
    await click(buttonByText('Avançar'));
    await changeInput(labeledInput('Número de parcelas'), '3');
    await click(buttonByText('Dividir'));

    expect(labeledInput('Valor da parcela 1').value).toBe('833.33');
    expect(labeledInput('Valor da parcela 2').value).toBe('833.33');
    expect(labeledInput('Valor da parcela 3').value).toBe('833.34');
    const first = labeledInput('Vencimento da parcela 1').value;
    const second = labeledInput('Vencimento da parcela 2').value;
    const [year, month, day] = first.split('-').map(Number);
    expect(second).toBe(
      new Date(Date.UTC(year!, month! - 1 + 1, day!)).toISOString().slice(0, 10),
    );

    await click(buttonByText('Avançar'));
    expect(container.textContent).toContain('Profissionais alocados');
  });

  it('blocks advancing while the parcelas do not sum to the total', async () => {
    await click(buttonByText('Avançar'));
    await changeInput(labeledInput('Valor da parcela 1'), '100');

    expect(container.textContent).toContain(
      'A soma das parcelas precisa ser igual ao total da proposta.',
    );
    await click(buttonByText('Avançar'));
    expect(container.textContent).toContain('Plano de pagamento');
    expect(container.textContent).not.toContain('Profissionais alocados');

    await changeInput(labeledInput('Valor da parcela 1'), '2500');
    expect(container.textContent).not.toContain(
      'A soma das parcelas precisa ser igual ao total da proposta.',
    );
    await click(buttonByText('Avançar'));
    expect(container.textContent).toContain('Profissionais alocados');
  });

  it('prefills and submits the recurring block for a mensalidade product', async () => {
    await pickOption('Produto / serviço do item 1', 'FXL Advisor');
    expect(comboboxText('Produto / serviço do item 1')).toBe('FXL Advisor');
    await click(buttonByText('Avançar'));

    expect(labeledInput('Valor da mensalidade').value).toBe('1000');
    await click(buttonByText('Prazo indeterminado'));

    await click(buttonByText('Avançar'));
    await click(buttonByText('Avançar'));
    await click(buttonByText('Salvar proposta'));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'open',
        recurring: {
          monthlyBrl: 100000,
          startDate: expect.any(String),
          cycles: null,
          method: 'pix',
        },
      }),
    );
    const payload = onSave.mock.calls[0]![0];
    expect(payload.installments).toHaveLength(1);
    expect(payload.installments.reduce((sum, row) => sum + row.amountBrl, 0)).toBe(100000);
  });

  it('submits the edited plan rows with per-parcela method and date', async () => {
    await click(buttonByText('Avançar'));
    await changeInput(labeledInput('Número de parcelas'), '2');
    await click(buttonByText('Dividir'));
    expect(comboboxText('Forma de pagamento da parcela 2')).toBe('Pix');
    await pickOption('Forma de pagamento da parcela 2', 'Boleto');
    expect(comboboxText('Forma de pagamento da parcela 2')).toBe('Boleto');

    await click(buttonByText('Avançar'));
    await click(buttonByText('Avançar'));
    await click(buttonByText('Salvar proposta'));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        installments: [
          expect.objectContaining({ method: 'pix', amountBrl: 125000 }),
          expect.objectContaining({ method: 'boleto', amountBrl: 125000 }),
        ],
      }),
    );
  });
});
