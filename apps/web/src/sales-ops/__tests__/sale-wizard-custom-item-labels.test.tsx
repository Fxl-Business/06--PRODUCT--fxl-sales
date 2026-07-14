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

const customProductId = '11111111-1111-4111-8111-111111111111';
const fixedProductId = '22222222-2222-4222-8222-222222222222';

function product(
  id: string,
  name: string,
  openPrice: boolean,
  setupBrl: number,
): SalesOpsProduct {
  return {
    id,
    orgId: 'org-test',
    name,
    type: openPrice ? 'Custom' : 'SaaS',
    codeSuffix: openPrice ? 'CST' : 'FIN',
    openPrice,
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
    createdAt: '2026-07-14T12:00:00.000Z',
    updatedAt: null,
  };
}

const bootstrap: SalesOpsBootstrap = {
  sales: [],
  products: [
    product(customProductId, 'FXL Custom', true, 0),
    product(fixedProductId, 'FXL Finance', false, 250000),
  ],
  clients: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      orgId: 'org-test',
      name: 'SegPro',
      contact: null,
      createdAt: '2026-07-14T12:00:00.000Z',
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
      createdAt: '2026-07-14T12:00:00.000Z',
      updatedAt: null,
    },
  ],
  payables: [],
  saleItems: [],
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
    createdAt: '2026-07-14T12:00:00.000Z',
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

function labeledSelect(label: string): HTMLSelectElement {
  const match = container.querySelector(`select[aria-label="${label}"]`);
  if (!(match instanceof HTMLSelectElement)) throw new Error(`select not found: ${label}`);
  return match;
}

function labeledButton(label: string): HTMLButtonElement {
  const match = container.querySelector(`button[aria-label="${label}"]`);
  if (!(match instanceof HTMLButtonElement)) throw new Error(`button not found: ${label}`);
  return match;
}

function textOccurrences(text: string): number {
  return container.textContent?.split(text).length - 1 || 0;
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

describe('sale wizard custom item labels', () => {
  it('keeps repeated custom labels independent and submits them in review order', async () => {
    await changeInput(labeledInput('Nome / descrição do item 1'), 'Módulo Vendas');
    await changeInput(labeledInput('Valor unitário do item 1'), '4000');
    await click(buttonByText('+ item'));
    await changeInput(labeledInput('Nome / descrição do item 2'), 'Módulo RH');
    await changeInput(labeledInput('Valor unitário do item 2'), '9000');

    expect(labeledInput('Quantidade do item 1').value).toBe('1');
    expect(labeledInput('Quantidade do item 2').value).toBe('1');
    expect(labeledInput('Nome / descrição do item 1').value).toBe('Módulo Vendas');
    expect(labeledInput('Nome / descrição do item 2').value).toBe('Módulo RH');

    await click(buttonByText('Avançar'));
    expect(container.textContent).toContain('Custos e margem');
    await click(buttonByText('Avançar'));
    expect(container.textContent).toContain('Módulo Vendas, Módulo RH');
    await click(buttonByText('Confirmar venda'));

    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'closed',
        items: [
          expect.objectContaining({
            productId: customProductId,
            productName: 'Módulo Vendas',
            unitBrl: 400000,
          }),
          expect.objectContaining({
            productId: customProductId,
            productName: 'Módulo RH',
            unitBrl: 900000,
          }),
        ],
      }),
    );
  });

  it('blocks advancement until every custom row has a label and positive negotiated value', async () => {
    await click(buttonByText('Avançar'));

    expect(container.textContent).toContain('Registro da venda');
    expect(textOccurrences('Informe o nome ou a descrição deste item personalizado.')).toBe(1);
    expect(textOccurrences('Informe um valor negociado maior que zero.')).toBe(1);

    await changeInput(labeledInput('Nome / descrição do item 1'), 'Módulo Vendas');
    expect(textOccurrences('Informe o nome ou a descrição deste item personalizado.')).toBe(0);
    expect(textOccurrences('Informe um valor negociado maior que zero.')).toBe(1);

    await changeInput(labeledInput('Valor unitário do item 1'), '4000');
    await click(buttonByText('+ item'));
    await click(buttonByText('Avançar'));

    expect(labeledInput('Nome / descrição do item 1').getAttribute('aria-invalid')).not.toBe('true');
    expect(labeledInput('Valor unitário do item 1').getAttribute('aria-invalid')).not.toBe('true');
    expect(labeledInput('Nome / descrição do item 2').getAttribute('aria-invalid')).toBe('true');
    expect(labeledInput('Valor unitário do item 2').getAttribute('aria-invalid')).toBe('true');

    await changeInput(labeledInput('Nome / descrição do item 2'), 'Módulo RH');
    await changeInput(labeledInput('Valor unitário do item 2'), '9000');
    await click(buttonByText('Avançar'));

    expect(container.textContent).toContain('Custos e margem');
  });

  it('saves an unlabeled custom draft with the catalog name fallback', async () => {
    await changeInput(labeledInput('Valor unitário do item 1'), '4000');
    await click(buttonByText('Salvar incompleto'));

    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'draft',
        items: [
          expect.objectContaining({
            productId: customProductId,
            productName: 'FXL Custom',
            unitBrl: 400000,
          }),
        ],
      }),
    );
  });

  it('uses the catalog name for a fixed-price item without rendering a custom label field', async () => {
    await changeInput(labeledInput('Nome / descrição do item 1'), 'Rótulo que não pode vazar');
    await changeSelect(labeledSelect('Produto / serviço do item 1'), fixedProductId);

    expect(container.querySelector('input[aria-label="Nome / descrição do item 1"]')).toBeNull();
    await click(buttonByText('Avançar'));
    await click(buttonByText('Avançar'));
    expect(container.textContent).toContain('FXL Finance');
    expect(container.textContent).not.toContain('Rótulo que não pode vazar');
    await click(buttonByText('Confirmar venda'));

    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            productId: fixedProductId,
            productName: 'FXL Finance',
          }),
        ],
      }),
    );
  });

  it('keeps the surviving custom row values when another repeated row is deleted', async () => {
    await changeInput(labeledInput('Nome / descrição do item 1'), 'Módulo Vendas');
    await changeInput(labeledInput('Valor unitário do item 1'), '4000');
    await click(buttonByText('+ item'));
    await changeInput(labeledInput('Nome / descrição do item 2'), 'Módulo RH');
    await changeInput(labeledInput('Valor unitário do item 2'), '9000');

    await click(labeledButton('Remover item 1'));

    expect(labeledInput('Nome / descrição do item 1').value).toBe('Módulo RH');
    expect(labeledInput('Valor unitário do item 1').value).toBe('9000');
    expect(container.querySelector('input[aria-label="Nome / descrição do item 2"]')).toBeNull();
  });
});
