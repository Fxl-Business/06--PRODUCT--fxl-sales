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

const areaId = '66666666-6666-4666-8666-666666666666';

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
    type: 'SaaS',
    codeSuffix: id.endsWith('1') ? '1' : '2',
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

const productA = product('11111111-1111-4111-8111-111111111111', 'Product A', '10', '7', '3');
const productB = product('22222222-2222-4222-8222-222222222222', 'Product B', '12', '8', '4');

const bootstrap: SalesOpsBootstrap = {
  sales: [],
  products: [productA, productB],
  clients: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      orgId: 'org-test',
      name: 'Client A',
      contact: null,
      createdAt: '2026-07-13T12:00:00.000Z',
      updatedAt: null,
    },
  ],
  people: [
    {
      id: '44444444-4444-4444-8444-444444444444',
      orgId: 'org-test',
      displayName: 'Seller A',
      contactEmail: null,
      status: 'active',
      isSeller: true,
      isFinder: false,
      isCollaborator: false,
      createdAt: '2026-07-13T12:00:00.000Z',
      updatedAt: null,
    },
    {
      id: '55555555-5555-4555-8555-555555555555',
      orgId: 'org-test',
      displayName: 'Finder A',
      contactEmail: null,
      status: 'active',
      isSeller: false,
      isFinder: true,
      isCollaborator: false,
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

function fieldInput(label: string): HTMLInputElement {
  const match = [...container.querySelectorAll('label')].find((candidate) =>
    candidate.textContent?.trim().startsWith(label),
  );
  const input = match?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error(`field not found: ${label}`);
  return input;
}

function productTriggers(): HTMLButtonElement[] {
  return [
    ...container.querySelectorAll<HTMLButtonElement>(
      'button[role="combobox"][aria-label^="Produto / serviço do item "]',
    ),
  ];
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

async function flushReact() {
  await act(async () => Promise.resolve());
}

describe('sale wizard product commission defaults', () => {
  it('starts with seller-only defaults and switches snapshots when finder participation changes', async () => {
    await click(buttonByText('Avançar'));
    await click(buttonByText('Avançar'));
    expect(fieldInput('Comissão vendedor %').value).toBe('10');
    expect(fieldInput('Comissão finder %').value).toBe('2');

    await click(buttonByText('Voltar'));
    await click(buttonByText('Voltar'));
    await click(buttonByText('Essa proposta teve um finder'));
    await flushReact();
    await click(buttonByText('Avançar'));
    await click(buttonByText('Avançar'));
    expect(fieldInput('Comissão vendedor %').value).toBe('7');
    expect(fieldInput('Comissão finder %').value).toBe('3');

    await click(buttonByText('Salvar rascunho'));
    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sellerCommissionPct: 7,
        finderCommissionPct: 3,
        finderPersonId: '55555555-5555-4555-8555-555555555555',
      }),
    );
    expect(onSave.mock.lastCall?.[0].installments).toHaveLength(1);

    await click(buttonByText('Voltar'));
    await click(buttonByText('Voltar'));
    await click(buttonByText('remover'));
    await flushReact();
    await click(buttonByText('Avançar'));
    await click(buttonByText('Avançar'));
    expect(fieldInput('Comissão vendedor %').value).toBe('10');
    expect(fieldInput('Comissão finder %').value).toBe('2');

    await click(buttonByText('Salvar rascunho'));
    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({ sellerCommissionPct: 10, finderCommissionPct: 2 }),
    );
    expect(onSave.mock.lastCall?.[0].finderPersonId).toBeUndefined();
  });

  it('uses only the primary item when product selection changes', async () => {
    await click(buttonByText('Essa proposta teve um finder'));
    await click(buttonByText('+ item'));
    await flushReact();

    expect(productTriggers()).toHaveLength(2);
    await pickOption('Produto / serviço do item 2', 'Product B');
    expect(comboboxText('Produto / serviço do item 2')).toBe('Product B');
    // The primary item is untouched, which is exactly what this test is about.
    expect(comboboxText('Produto / serviço do item 1')).toBe('Product A');
    await flushReact();
    await click(buttonByText('Avançar'));
    await click(buttonByText('Avançar'));
    expect(fieldInput('Comissão vendedor %').value).toBe('7');
    expect(fieldInput('Comissão finder %').value).toBe('3');

    await click(buttonByText('Voltar'));
    await click(buttonByText('Voltar'));
    await pickOption('Produto / serviço do item 1', 'Product B');
    expect(comboboxText('Produto / serviço do item 1')).toBe('Product B');
    await flushReact();
    await click(buttonByText('Avançar'));
    await click(buttonByText('Avançar'));
    expect(fieldInput('Comissão vendedor %').value).toBe('8');
    expect(fieldInput('Comissão finder %').value).toBe('4');
  });
});
