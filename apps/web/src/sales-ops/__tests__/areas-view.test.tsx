// @vitest-environment happy-dom

import * as React from 'react';
import type { HTMLAttributes } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SalesOpsArea, SalesOpsBootstrap, SalesOpsProduct } from '../types';

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

import { AreaDialog, AreasView, ProductDialog, ProductsView } from '../SalesOpsApp';

const act = (
  React as typeof React & { act: typeof import('react-dom/test-utils').act }
).act;

const area = (patch: Partial<SalesOpsArea> = {}): SalesOpsArea => ({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  orgId: 'org-test',
  name: 'FXL Tech',
  status: 'active',
  createdAt: '2026-07-29T12:00:00.000Z',
  updatedAt: null,
  ...patch,
});

const product = (patch: Partial<SalesOpsProduct> = {}): SalesOpsProduct => ({
  id: '11111111-1111-4111-8111-111111111111',
  orgId: 'org-test',
  name: 'FXL Finance',
  type: 'SaaS',
  codeSuffix: '7',
  areaId: area().id,
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
    people: [],
    payables: [],
    saleItems: [],
    receivables: [],
    saleProfessionals: [],
    settings: null,
    ...patch,
  };
}

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

async function change(input: HTMLInputElement, value: string) {
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

async function submit() {
  const form = container.querySelector('form');
  if (!(form instanceof HTMLFormElement)) throw new Error('form not found');
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
}

describe('areas view', () => {
  it('lists áreas with status badges and linked product counts', async () => {
    const areaOne = area();
    const areaTwo = area({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      name: 'FXL Visual',
      status: 'archived',
    });

    await act(async () => {
      root.render(
        <AreasView
          bootstrap={bootstrap({
            areas: [areaOne, areaTwo],
            products: [product({ areaId: areaOne.id })],
          })}
          onEdit={vi.fn()}
        />,
      );
    });

    const text = container.textContent ?? '';
    expect(text).toContain('FXL Tech');
    expect(text).toContain('Ativa');
    expect(text).toContain('FXL Visual');
    expect(text).toContain('Arquivada');

    const countCell = [...container.querySelectorAll('td')].find(
      (cell) => cell.textContent?.trim() === '1',
    );
    expect(countCell).toBeTruthy();
  });

  it('shows the empty panel when no área exists', async () => {
    await act(async () => {
      root.render(<AreasView bootstrap={bootstrap({ areas: [] })} onEdit={vi.fn()} />);
    });

    expect(container.textContent ?? '').toContain('Nenhuma área cadastrada');
  });

  it('creates an área submitting trimmed name and status', async () => {
    const onSave = vi.fn();

    await act(async () => {
      root.render(<AreaDialog modal={{ kind: 'area' }} onClose={vi.fn()} onSave={onSave} saving={false} />);
    });

    const nameInput = container.querySelector('input');
    if (!(nameInput instanceof HTMLInputElement)) throw new Error('name input not found');
    await change(nameInput, '  FXL BPO Sales  ');

    const statusSelect = container.querySelector('select[aria-label="Status da área"]');
    if (!(statusSelect instanceof HTMLSelectElement)) throw new Error('status select not found');
    await changeSelect(statusSelect, 'archived');

    await submit();

    expect(onSave).toHaveBeenCalledWith({ id: undefined, name: 'FXL BPO Sales', status: 'archived' });
  });

  it('does not save an área without a name', async () => {
    const onSave = vi.fn();

    await act(async () => {
      root.render(<AreaDialog modal={{ kind: 'area' }} onClose={vi.fn()} onSave={onSave} saving={false} />);
    });

    await submit();

    expect(onSave).not.toHaveBeenCalled();
    const saveButton = [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === 'Salvar',
    );
    if (!(saveButton instanceof HTMLButtonElement)) throw new Error('Salvar button not found');
    expect(saveButton.disabled).toBe(true);
  });

  it('edits an existing área keeping its id', async () => {
    const onSave = vi.fn();
    const existing = area();

    await act(async () => {
      root.render(
        <AreaDialog
          modal={{ kind: 'area', area: existing }}
          onClose={vi.fn()}
          onSave={onSave}
          saving={false}
        />,
      );
    });

    const nameInput = container.querySelector('input');
    if (!(nameInput instanceof HTMLInputElement)) throw new Error('name input not found');
    await change(nameInput, 'FXL Advisor');

    await submit();

    expect(onSave).toHaveBeenCalledWith({ id: existing.id, name: 'FXL Advisor', status: 'active' });
  });

  it('requires an área before saving a product', async () => {
    const onSave = vi.fn();
    const areaFixture = area();

    await act(async () => {
      root.render(
        <ProductDialog
          areas={[areaFixture]}
          collaborators={[]}
          modal={{ kind: 'product' }}
          onClose={vi.fn()}
          onSave={onSave}
          saving={false}
        />,
      );
    });

    const nameInput = container.querySelector('input[placeholder="Nome"]');
    if (!(nameInput instanceof HTMLInputElement)) throw new Error('name input not found');
    await change(nameInput, 'FXL New Product');

    await submit();
    expect(onSave).not.toHaveBeenCalled();

    const areaSelect = container.querySelector('select[aria-label="Área do produto"]');
    if (!(areaSelect instanceof HTMLSelectElement)) throw new Error('area select not found');
    await changeSelect(areaSelect, areaFixture.id);

    await submit();

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ areaId: areaFixture.id }));
    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty('type');
  });

  it('shows the área name instead of the legacy type in the products table', async () => {
    const areaFixture = area();

    await act(async () => {
      root.render(
        <ProductsView
          areas={[areaFixture]}
          onEdit={vi.fn()}
          products={[
            product({ areaId: areaFixture.id }),
            product({ id: '22222222-2222-4222-8222-222222222222', areaId: null }),
          ]}
        />,
      );
    });

    const text = container.textContent ?? '';
    expect(text).toContain('Área');
    expect(text).toContain('FXL Tech');
    expect(text).not.toContain('Tipo');

    const dashCell = [...container.querySelectorAll('td')].find(
      (cell) => cell.textContent?.trim() === '-',
    );
    expect(dashCell).toBeTruthy();
  });
});
