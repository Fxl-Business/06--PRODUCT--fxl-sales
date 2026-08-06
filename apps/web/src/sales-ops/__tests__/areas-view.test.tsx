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
    funcoes: [],
    people: [],
    payables: [],
    saleItems: [],
    receivables: [],
    productFuncaoCosts: [],
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

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
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

async function submit() {
  const form = container.querySelector('form');
  if (!(form instanceof HTMLFormElement)) throw new Error('form not found');
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
}

describe('areas view', () => {
  /*
    v2.6.0 slice 01: an archived área is not listed. The list therefore never shows a
    status badge either - the column would carry the single constant value `Ativa` and
    would only cost width. `Arquivada` survives exactly one place, and it is not here:
    `Histórico de arquivamentos`.
  */
  it('lists only active áreas, with their linked product counts and no status column', async () => {
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
            funcoes: [],
            products: [product({ areaId: areaOne.id })],
          })}
          onArchive={vi.fn()}
          onEdit={vi.fn()}
        />,
      );
    });

    const text = container.textContent ?? '';
    expect(text).toContain('FXL Tech');
    expect(text).not.toContain('FXL Visual');
    expect(text).not.toContain('Arquivada');
    expect(text).not.toContain('Ativa');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);

    const countCell = [...container.querySelectorAll('td')].find(
      (cell) => cell.textContent?.trim() === '1',
    );
    expect(countCell).toBeTruthy();
  });

  /*
    The count above cannot see this: its área holds a single active produto, so the
    number reads 1 whether or not the filter is there. Release-verify caught that gap -
    reverting the `status === 'active'` clause left the whole suite green. An archived
    produto is not listed and not offered in any picker, so counting one here would put
    a number on the row that the operator cannot reach by clicking anything.
  */
  it('counts only active produtos in Nº produtos', async () => {
    const areaOne = area();

    await act(async () => {
      root.render(
        <AreasView
          bootstrap={bootstrap({
            areas: [areaOne],
            funcoes: [],
            products: [
              product({ areaId: areaOne.id }),
              product({
                id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
                areaId: areaOne.id,
                status: 'archived',
              }),
            ],
          })}
          onArchive={vi.fn()}
          onEdit={vi.fn()}
        />,
      );
    });

    const cells = [...container.querySelectorAll('tbody td')].map((cell) =>
      cell.textContent?.trim(),
    );
    expect(cells).toContain('1');
    expect(cells).not.toContain('2');
  });

  it('shows the empty panel when every área is archived', async () => {
    await act(async () => {
      root.render(
        <AreasView
          bootstrap={bootstrap({
            areas: [area({ status: 'archived' })],
          })}
          onArchive={vi.fn()}
          onEdit={vi.fn()}
        />,
      );
    });

    expect(container.textContent ?? '').toContain('Nenhuma área cadastrada');
    expect(container.querySelector('table')).toBeNull();
  });

  it('shows the empty panel when no área exists', async () => {
    await act(async () => {
      root.render(
        <AreasView bootstrap={bootstrap({ areas: [] })} onArchive={vi.fn()} onEdit={vi.fn()} />,
      );
    });

    expect(container.textContent ?? '').toContain('Nenhuma área cadastrada');
  });

  /*
    The `Status` picker left this dialog in slice 03: archiving is a row action
    behind a confirmation now, and two doors to one fact meant an edit opened on an
    archived área could silently reactivate it on `Salvar`. A create therefore always
    resolves to `'active'` through the `??` on `modal.area?.status`.
  */
  it('creates an área submitting the trimmed name', async () => {
    const onSave = vi.fn();

    await act(async () => {
      root.render(<AreaDialog modal={{ kind: 'area' }} onClose={vi.fn()} onSave={onSave} saving={false} />);
    });

    const nameInput = container.querySelector('input');
    if (!(nameInput instanceof HTMLInputElement)) throw new Error('name input not found');
    await change(nameInput, '  FXL BPO Sales  ');

    await submit();

    expect(onSave).toHaveBeenCalledWith({ id: undefined, name: 'FXL BPO Sales', status: 'active' });
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
          funcaoCosts={[]}
          funcoes={[]}
          modal={{ kind: 'product' }}
          onClose={vi.fn()}
          onSave={onSave}
          products={[]}
          saving={false}
        />,
      );
    });

    const nameInput = container.querySelector('input[placeholder="Nome"]');
    if (!(nameInput instanceof HTMLInputElement)) throw new Error('name input not found');
    await change(nameInput, 'FXL New Product');

    await submit();
    expect(onSave).not.toHaveBeenCalled();

    expect(comboboxText('Área do produto')).toBe('Selecione a área');
    await pickOption('Área do produto', 'FXL Tech');
    expect(comboboxText('Área do produto')).toBe('FXL Tech');

    await submit();

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ areaId: areaFixture.id }));
    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty('type');
    // `openPrice` is a server-written projection of `kind` now, and `providers` is
    // deprecated and deliberately omitted so a PATCH leaves the column untouched.
    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty('openPrice');
    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty('providers');
  });

  it('shows the área name instead of the legacy type in the products table', async () => {
    const areaFixture = area();

    await act(async () => {
      root.render(
        <ProductsView
          areas={[areaFixture]}
          funcaoCosts={[]}
          funcoes={[]}
          kind="product"
          onArchive={vi.fn()}
          onEdit={vi.fn()}
          onKindChange={vi.fn()}
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
