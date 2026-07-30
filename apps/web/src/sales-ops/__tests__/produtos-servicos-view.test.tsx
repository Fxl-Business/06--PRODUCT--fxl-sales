// @vitest-environment happy-dom

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductsView } from '../SalesOpsApp';
import type {
  SalesOpsArea,
  SalesOpsFuncao,
  SalesOpsProduct,
  SalesOpsProductFuncaoCost,
} from '../types';

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
  kind: 'product',
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
  defaultPaymentMethod: 'pix',
  defaultEntradaMode: 'none',
  defaultEntradaPct: null,
  defaultEntradaBrl: null,
  defaultRemainingInstallments: 1,
  defaultRecurringCycles: null,
  modules: [],
  providers: [],
  status: 'active',
  createdAt: '2026-07-13T12:00:00.000Z',
  updatedAt: null,
  ...patch,
});

const funcao = (patch: Partial<SalesOpsFuncao> = {}): SalesOpsFuncao => ({
  id: 'ffffffff-ffff-4fff-8fff-ffffffffff01',
  orgId: 'org-test',
  name: 'Desenvolvedor',
  slug: 'desenvolvedor',
  isSystem: false,
  status: 'active',
  createdAt: '2026-07-29T12:00:00.000Z',
  updatedAt: null,
  ...patch,
});

const funcaoCost = (
  patch: Partial<SalesOpsProductFuncaoCost> = {},
): SalesOpsProductFuncaoCost => ({
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccc01',
  orgId: 'org-test',
  productId: product().id,
  funcaoId: funcao().id,
  mode: 'pct',
  valuePct: '5.00',
  valueBrl: null,
  createdAt: '2026-07-29T12:00:00.000Z',
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

type RenderOptions = {
  products: SalesOpsProduct[];
  kind?: 'product' | 'service';
  funcaoCosts?: SalesOpsProductFuncaoCost[];
  funcoes?: SalesOpsFuncao[];
  onKindChange?: (kind: 'product' | 'service') => void;
};

async function renderView(options: RenderOptions) {
  const onKindChange = options.onKindChange ?? vi.fn();
  await act(async () => {
    root.render(
      <ProductsView
        areas={[areaFixture]}
        funcaoCosts={options.funcaoCosts ?? []}
        funcoes={options.funcoes ?? [funcao()]}
        kind={options.kind ?? 'product'}
        onEdit={vi.fn()}
        onKindChange={onKindChange}
        products={options.products}
      />,
    );
  });
  return onKindChange;
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function text(): string {
  return container.textContent ?? '';
}

function headerText(): string {
  return [...container.querySelectorAll('th')].map((cell) => cell.textContent?.trim()).join('|');
}

function segment(ariaLabel: string): HTMLButtonElement {
  const match = container.querySelector(`button[aria-label="${ariaLabel}"]`);
  if (!(match instanceof HTMLButtonElement)) throw new Error(`segment not found: ${ariaLabel}`);
  return match;
}

/** The cell under a given serviço column header, for the single-row cases. */
function cellUnder(header: string): HTMLTableCellElement {
  const headers = [...container.querySelectorAll('th')];
  const index = headers.findIndex((cell) => cell.textContent?.trim() === header);
  if (index < 0) throw new Error(`header not found: ${header}`);
  const cell = container.querySelectorAll('tbody tr')[0]?.querySelectorAll('td')[index];
  if (!(cell instanceof HTMLTableCellElement)) throw new Error(`cell not found under: ${header}`);
  return cell;
}

const servico = (patch: Partial<SalesOpsProduct> = {}) =>
  product({
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Consultoria FXL',
    kind: 'service',
    openPrice: true,
    setupBrl: 0,
    ...patch,
  });

describe('produtos e serviços view', () => {
  it('defaults to the produtos segment and shows the produto column set', async () => {
    await renderView({ products: [product(), servico()], kind: 'product' });

    const headers = headerText();
    expect(headers).toContain('Setup');
    expect(headers).toContain('Mensalidade');
    expect(headers).toContain('Recorrente');
    expect(headers).not.toContain('Plano padrão');
    expect(headers).not.toContain('Custos padrão');

    const names = [...container.querySelectorAll('tbody tr')].map(
      (row) => row.querySelector('td')?.textContent?.trim(),
    );
    expect(names).toEqual(['FXL Finance']);
  });

  it('switching to the serviços segment reports the kind change to the parent', async () => {
    const onKindChange = await renderView({ products: [product(), servico()], kind: 'product' });

    await click(segment('Filtrar por serviços'));

    expect(onKindChange).toHaveBeenCalledWith('service');
    // Positive control on the other direction: the produtos segment reports 'product'.
    await click(segment('Filtrar por produtos'));
    expect(onKindChange).toHaveBeenLastCalledWith('product');
  });

  it('renders the serviço column set with variável value, plano padrão and custos padrão', async () => {
    const tester = funcao({
      id: 'ffffffff-ffff-4fff-8fff-ffffffffff02',
      name: 'Testador',
      slug: 'testador',
    });
    await renderView({
      products: [
        servico({
          defaultEntradaMode: 'pct',
          defaultEntradaPct: '50.00',
          defaultRemainingInstallments: 3,
        }),
      ],
      kind: 'service',
      funcoes: [funcao(), tester],
      funcaoCosts: [
        funcaoCost({ productId: servico().id }),
        funcaoCost({
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccc02',
          productId: servico().id,
          funcaoId: tester.id,
          mode: 'fix',
          valuePct: null,
          valueBrl: 30000,
        }),
      ],
    });

    const headers = headerText();
    expect(headers).toContain('Valor');
    expect(headers).toContain('Plano padrão');
    expect(headers).toContain('Custos padrão');
    expect(headers).not.toContain('Setup');
    expect(headers).not.toContain('Mensalidade');
    expect(headers).not.toContain('Recorrente');

    expect(cellUnder('Valor').textContent?.trim()).toBe('Variável');
    expect(cellUnder('Plano padrão').textContent?.trim()).toBe('50% + 3x');
    expect(cellUnder('Custos padrão').textContent?.trim()).toBe('2 funções');
  });

  it('counts custos padrão from the flat productFuncaoCosts prop, scoped per product', async () => {
    const tester = funcao({
      id: 'ffffffff-ffff-4fff-8fff-ffffffffff02',
      name: 'Testador',
      slug: 'testador',
    });
    const servicoA = servico();
    const servicoB = servico({ id: '33333333-3333-4333-8333-333333333333', name: 'Serviço B' });
    const servicoC = servico({ id: '44444444-4444-4444-8444-444444444444', name: 'Serviço C' });

    await renderView({
      products: [servicoA, servicoB, servicoC],
      kind: 'service',
      funcoes: [funcao(), tester],
      funcaoCosts: [
        funcaoCost({ productId: servicoA.id }),
        funcaoCost({
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccc02',
          productId: servicoA.id,
          funcaoId: tester.id,
        }),
        funcaoCost({
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccc03',
          productId: servicoB.id,
          funcaoId: tester.id,
        }),
      ],
    });

    const headers = [...container.querySelectorAll('th')];
    const index = headers.findIndex((cell) => cell.textContent?.trim() === 'Custos padrão');
    const cells = [...container.querySelectorAll('tbody tr')].map((row) =>
      row.querySelectorAll('td')[index]?.textContent?.trim(),
    );
    expect(cells).toEqual(['2 funções', '1 função', '-']);
  });

  it('renders a fixed função cost in reais from cents', async () => {
    await renderView({
      products: [servico()],
      kind: 'service',
      funcaoCosts: [
        funcaoCost({ productId: servico().id, mode: 'fix', valuePct: null, valueBrl: 30000 }),
      ],
    });

    const title = cellUnder('Custos padrão').getAttribute('title') ?? '';
    expect(title).toContain('Desenvolvedor');
    expect(title).toContain('R$ 300,00');
    expect(title).not.toContain('R$ 30.000,00');
  });

  it('shows counts for both kinds regardless of the active segment', async () => {
    await renderView({
      products: [
        product(),
        product({ id: '55555555-5555-4555-8555-555555555555', name: 'FXL Outro' }),
        servico(),
      ],
      kind: 'service',
    });

    expect(segment('Filtrar por produtos').textContent).toContain('2');
    expect(segment('Filtrar por serviços').textContent).toContain('1');
  });

  it('treats a product without an explicit kind as a produto', async () => {
    const unclassified = product({ kind: undefined, name: 'FXL Sem Classe' });

    await renderView({ products: [unclassified], kind: 'product' });
    expect(text()).toContain('FXL Sem Classe');

    await renderView({ products: [unclassified], kind: 'service' });
    expect(text()).not.toContain('FXL Sem Classe');
    // Positive control: the bucket really did render, it is just empty.
    expect(text()).toContain('Nenhum serviço cadastrado');
  });

  it('keeps the kind segments reachable from an empty bucket', async () => {
    await renderView({ products: [product()], kind: 'service' });

    expect(text()).toContain('Nenhum serviço cadastrado');
    expect(segment('Filtrar por produtos')).toBeInstanceOf(HTMLButtonElement);
    expect(segment('Filtrar por serviços')).toBeInstanceOf(HTMLButtonElement);
  });

  it('summarises the app-default plan as 1x rather than a dash', async () => {
    await renderView({
      products: [servico({ defaultEntradaMode: 'none', defaultRemainingInstallments: 1 })],
      kind: 'service',
    });

    expect(cellUnder('Plano padrão').textContent?.trim()).toBe('1x');
    const rendered = text();
    expect(rendered).not.toContain('NaN');
    expect(rendered).not.toContain('undefined');
  });

  it('suffixes the plano padrão summary with mensal for a recurring serviço', async () => {
    await renderView({
      products: [servico({ hasMonthly: true, defaultRecurringCycles: null })],
      kind: 'service',
    });

    const summary = cellUnder('Plano padrão').textContent?.trim() ?? '';
    expect(summary).toBe('1x + mensal');
    expect(summary).not.toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });

  it('renders a fixed entrada as reais in the plano padrão summary', async () => {
    await renderView({
      products: [
        servico({
          defaultEntradaMode: 'fix',
          defaultEntradaPct: null,
          defaultEntradaBrl: 500000,
          defaultRemainingInstallments: 2,
        }),
      ],
      kind: 'service',
    });

    expect(cellUnder('Plano padrão').textContent?.trim()).toBe('R$ 5.000,00 + 2x');
  });
});
