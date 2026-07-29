// @vitest-environment happy-dom

import * as React from 'react';
import type { HTMLAttributes } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SaleWizardDialog } from '../SalesOpsApp';
import type { CreateSalePayload, SalesOpsBootstrap, SalesOpsProduct } from '../types';

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

const areaOneId = '66666666-6666-4666-8666-666666666666';
const areaTwoId = '77777777-7777-4777-8777-777777777777';
const fixedProductId = '11111111-1111-4111-8111-111111111111';

function product(patch: Partial<SalesOpsProduct> = {}): SalesOpsProduct {
  return {
    id: fixedProductId,
    orgId: 'org-test',
    name: 'FXL Finance',
    type: 'SaaS',
    codeSuffix: 'FIN',
    areaId: areaOneId,
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

function baseBootstrap(patch: Partial<SalesOpsBootstrap> = {}): SalesOpsBootstrap {
  return {
    sales: [],
    products: [product()],
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
    people: [
      {
        id: '44444444-4444-4444-8444-444444444444',
        orgId: 'org-test',
        displayName: 'Ana Martins',
        contactEmail: null,
        status: 'active',
        isSeller: true,
        isFinder: false,
        isCollaborator: false,
        createdAt: '2026-07-29T12:00:00.000Z',
        updatedAt: null,
      },
    ],
    areas: [
      {
        id: areaOneId,
        orgId: 'org-test',
        name: 'FXL Tech',
        status: 'active',
        createdAt: '2026-07-29T12:00:00.000Z',
        updatedAt: null,
      },
      {
        id: areaTwoId,
        orgId: 'org-test',
        name: 'FXL Advisor',
        status: 'active',
        createdAt: '2026-07-29T12:00:00.000Z',
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

let container: HTMLDivElement;
let root: Root;
let onSave: ReturnType<typeof vi.fn<(payload: CreateSalePayload) => void>>;

async function renderWizard(bootstrap: SalesOpsBootstrap) {
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
}

beforeEach(async () => {
  await renderWizard(baseBootstrap());
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

function labeledSelect(label: string): HTMLSelectElement {
  const match = container.querySelector(`select[aria-label="${label}"]`);
  if (!(match instanceof HTMLSelectElement)) throw new Error(`select not found: ${label}`);
  return match;
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

async function changeSelect(select: HTMLSelectElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    setter?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('sale wizard free-form items', () => {
  it('adds a free-form item and submits it without productId', async () => {
    await click(buttonByText('+ item avulso'));
    await changeSelect(labeledSelect('Área do item 2'), areaTwoId);
    await changeInput(labeledInput('Descrição do item 2'), 'Consultoria de processos');
    await changeInput(labeledInput('Valor unitário do item 2'), '5000');

    await click(buttonByText('Avançar'));
    await click(buttonByText('Avançar'));
    await click(buttonByText('Avançar'));
    await click(buttonByText('Salvar proposta'));

    const payload = onSave.mock.calls[0]![0];
    expect(payload.items[1]).toEqual(
      expect.objectContaining({
        areaId: areaTwoId,
        productName: 'Consultoria de processos',
        productType: 'Avulso',
        quantity: 1,
        unitBrl: 500000,
      }),
    );
    expect(payload.items[1]?.productId).toBeUndefined();
  });

  it('blocks advance until the free row has description and value', async () => {
    await click(buttonByText('+ item avulso'));
    await click(buttonByText('Avançar'));

    expect(container.textContent).toContain('Informe a descrição deste item avulso.');
    expect(container.textContent).toContain('Informe um valor negociado maior que zero.');
    expect(container.textContent).toContain('Cliente e responsáveis');

    await changeInput(labeledInput('Descrição do item 2'), 'Consultoria de processos');
    await changeInput(labeledInput('Valor unitário do item 2'), '5000');
    await click(buttonByText('Avançar'));

    expect(container.textContent).toContain('Plano de pagamento');
  });

  it('blocks advance when a product has no área', async () => {
    await act(async () => root.unmount());
    container.remove();
    await renderWizard(
      baseBootstrap({ products: [product({ areaId: null })] }),
    );

    await click(buttonByText('Avançar'));

    expect(container.textContent).toContain('Defina a área deste produto em Cadastros > Produtos.');
    expect(container.textContent).toContain('Cliente e responsáveis');
  });
});
