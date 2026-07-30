// @vitest-environment happy-dom

import * as React from 'react';
import type { HTMLAttributes } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SalesOpsArea, SalesOpsProduct } from '../types';

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

import { ProductDialog, ProductsView } from '../SalesOpsApp';

const act = (
  React as typeof React & { act: typeof import('react-dom/test-utils').act }
).act;

const areaFixture: SalesOpsArea = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  orgId: 'org-test',
  name: 'FXL Tech',
  status: 'active',
  createdAt: '2026-07-29T12:00:00.000Z',
  updatedAt: null,
};

const product = (patch: Partial<SalesOpsProduct> = {}): SalesOpsProduct => ({
  id: '11111111-1111-4111-8111-111111111111',
  orgId: 'org-test',
  name: 'FXL Finance',
  type: 'SaaS',
  codeSuffix: '7',
  areaId: areaFixture.id,
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
  modules: [],
  providers: [],
  status: 'active',
  createdAt: '2026-07-13T12:00:00.000Z',
  updatedAt: null,
  ...patch,
});

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

async function renderDialog(existing?: SalesOpsProduct, onSave = vi.fn()) {
  await act(async () => {
    root.render(
      <ProductDialog
        areas={[areaFixture]}
        collaborators={[]}
        modal={{ kind: 'product', product: existing }}
        onClose={vi.fn()}
        onSave={onSave}
        saving={false}
      />,
    );
  });
  return onSave;
}

function button(label: string): HTMLButtonElement {
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

function labeledButton(label: string): HTMLButtonElement {
  const match = container.querySelector(`button[aria-label="${label}"]`);
  if (!(match instanceof HTMLButtonElement)) throw new Error(`button not found: ${label}`);
  return match;
}

async function click(element: HTMLElement) {
  await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
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
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
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

async function chooseArea() {
  await pickOption('Área do produto', areaFixture.name);
  expect(comboboxText('Área do produto')).toBe(areaFixture.name);
}

describe('product commission editor', () => {
  it('keeps seller-only 10 percent independent from seller-with-finder 7 percent plus finder 3 percent', async () => {
    await renderDialog();

    expect(labeledInput('Comissão do vendedor - somente vendedor').value).toBe('10');
    await click(button('Vendedor + Finder'));
    expect(labeledInput('Comissão do vendedor - com finder').value).toBe('7');
    expect(labeledInput('Comissão do finder').value).toBe('3');

    await change(labeledInput('Comissão do vendedor - com finder'), '6.5');
    await click(button('Somente vendedor'));
    expect(labeledInput('Comissão do vendedor - somente vendedor').value).toBe('10');
    await click(button('Vendedor + Finder'));
    expect(labeledInput('Comissão do vendedor - com finder').value).toBe('6.5');
    expect(labeledInput('Comissão do finder').value).toBe('3');
  });

  it('submits every commission pair regardless of the active tab', async () => {
    const onSave = await renderDialog();

    await chooseArea();
    await submit();

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        sellerCommissionType: 'pct',
        sellerCommissionValue: 10,
        sellerWithFinderCommissionType: 'pct',
        sellerWithFinderCommissionValue: 7,
        finderCommissionType: 'pct',
        finderCommissionValue: 3,
      }),
    );
  });

  it('rehydrates saved independent scenarios when the product dialog is reopened', async () => {
    await renderDialog(product());

    expect(labeledInput('Comissão do vendedor - somente vendedor').value).toBe('10');
    await click(button('Vendedor + Finder'));
    expect(labeledInput('Comissão do vendedor - com finder').value).toBe('7');
    expect(labeledInput('Comissão do finder').value).toBe('3');
  });

  it('preserves fixed type and value controls across switching, save, and reopen', async () => {
    const onSave = await renderDialog();

    await click(labeledButton('Comissão do vendedor - somente vendedor em reais'));
    await change(labeledInput('Comissão do vendedor - somente vendedor'), '1000');
    await click(button('Vendedor + Finder'));
    await click(labeledButton('Comissão do vendedor - com finder em reais'));
    await change(labeledInput('Comissão do vendedor - com finder'), '700');
    await click(labeledButton('Comissão do finder em reais'));
    await change(labeledInput('Comissão do finder'), '300');
    await click(button('Somente vendedor'));
    await click(button('Vendedor + Finder'));
    await chooseArea();
    await submit();

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        sellerCommissionType: 'fix',
        sellerCommissionValue: 1000,
        sellerWithFinderCommissionType: 'fix',
        sellerWithFinderCommissionValue: 700,
        finderCommissionType: 'fix',
        finderCommissionValue: 300,
      }),
    );

    await act(async () => {
      root.render(
        <ProductDialog
          areas={[areaFixture]}
          collaborators={[]}
          modal={{
            kind: 'product',
            product: product({
              sellerCommissionType: 'fix',
              sellerCommissionValue: '1000.00',
              sellerWithFinderCommissionType: 'fix',
              sellerWithFinderCommissionValue: '700.00',
              finderCommissionType: 'fix',
              finderCommissionValue: '300.00',
            }),
          }}
          onClose={vi.fn()}
          onSave={vi.fn()}
          saving={false}
        />,
      );
    });

    expect(labeledInput('Comissão do vendedor - somente vendedor').value).toBe('1000');
    expect(labeledButton('Comissão do vendedor - somente vendedor em reais').className).toContain(
      'bg-[#201f24]',
    );
    await click(button('Vendedor + Finder'));
    expect(labeledInput('Comissão do vendedor - com finder').value).toBe('700');
    expect(labeledInput('Comissão do finder').value).toBe('300');
    expect(labeledButton('Comissão do vendedor - com finder em reais').className).toContain(
      'bg-[#201f24]',
    );
    expect(labeledButton('Comissão do finder em reais').className).toContain('bg-[#201f24]');
  });

  it('shows seller-only and seller-with-finder scenarios separately in the product table', async () => {
    await act(async () => {
      root.render(
        <ProductsView
          areas={[areaFixture]}
          onEdit={vi.fn()}
          products={[
            product(),
            product({
              id: '22222222-2222-4222-8222-222222222222',
              name: 'FXL Custom',
              sellerCommissionType: 'fix',
              sellerCommissionValue: '1000.00',
              sellerWithFinderCommissionType: 'fix',
              sellerWithFinderCommissionValue: '700.00',
              finderCommissionType: 'fix',
              finderCommissionValue: '300.00',
            }),
          ]}
        />,
      );
    });

    const text = container.textContent ?? '';
    expect(text).toContain('Somente vendedor');
    expect(text).toContain('Vendedor + Finder');
    expect(text).toContain('10%');
    expect(text).toContain('7% + 3%');
    expect(text).toContain('R$ 1.000,00');
    expect(text).toContain('R$ 700,00 + R$ 300,00');
  });
});
