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

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

const servicoId = '11111111-1111-4111-8111-111111111111';
/**
 * An open-price row the client cannot classify, i.e. `kind` absent. Reachable
 * whenever the wizard holds a product row that did not come from a `kind`-aware
 * API response, and the conservative half of the truth table: not provably a
 * Serviço, so the description stays required.
 */
const unclassifiedOpenPriceId = '22222222-2222-4222-8222-222222222222';
const fixedProductId = '33333333-3333-4333-8333-333333333333';
const areaId = '66666666-6666-4666-8666-666666666666';

function product(overrides: Partial<SalesOpsProduct> & { id: string; name: string }): SalesOpsProduct {
  return {
    orgId: 'org-test',
    type: 'SaaS',
    codeSuffix: '0',
    areaId,
    openPrice: false,
    setupBrl: 0,
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
    ...overrides,
  };
}

const bootstrap: SalesOpsBootstrap = {
  sales: [],
  products: [
    // First in the list, so `firstProduct` seeds item 1 with the serviço.
    product({ id: servicoId, name: 'Consultoria FXL', kind: 'service', openPrice: true }),
    product({ id: unclassifiedOpenPriceId, name: 'FXL Custom', openPrice: true }),
    product({ id: fixedProductId, name: 'FXL Finance', kind: 'product', setupBrl: 250000 }),
  ],
  clients: [
    {
      id: '44444444-4444-4444-8444-444444444444',
      orgId: 'org-test',
      name: 'SegPro',
      contact: null,
      createdAt: '2026-07-14T12:00:00.000Z',
      updatedAt: null,
    },
  ],
  funcoes: [],
  people: [
    {
      id: '55555555-5555-4555-8555-555555555555',
      orgId: 'org-test',
      displayName: 'Ana Martins',
      contactEmail: null,
      status: 'active',
      funcaoIds: [funcaoVendedor.id],
      funcoes: [funcaoVendedor],
      createdAt: '2026-07-14T12:00:00.000Z',
      updatedAt: null,
    },
  ],
  areas: [
    {
      id: areaId,
      orgId: 'org-test',
      name: 'FXL Tech',
      status: 'active',
      createdAt: '2026-07-14T12:00:00.000Z',
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
    createdAt: '2026-07-14T12:00:00.000Z',
    updatedAt: null,
  },
};

let container: HTMLDivElement;
let root: Root;
let onSave: ReturnType<typeof vi.fn<(payload: CreateSalePayload) => void>>;

async function renderWizard(data: SalesOpsBootstrap) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <SaleWizardDialog
        bootstrap={data}
        editSale={null}
        onClose={vi.fn()}
        onSave={onSave}
        open
        saving={false}
      />,
    );
  });
}

/** Swap the mounted wizard for one built on a different catalog. */
async function remountWizardWith(data: SalesOpsBootstrap) {
  await act(async () => root.unmount());
  container.remove();
  await renderWizard(data);
}

beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  onSave = vi.fn<(payload: CreateSalePayload) => void>();
  await renderWizard(bootstrap);
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

/** Open the picker and commit the row whose visible label starts with `optionLabel`. */
async function pickOption(ariaLabel: string, optionLabel: string) {
  await click(comboboxTrigger(ariaLabel));
  const row = [...container.querySelectorAll('[role="option"]')].find((candidate) =>
    candidate.textContent?.trim().startsWith(optionLabel),
  );
  if (!(row instanceof HTMLElement)) throw new Error(`option not found: ${optionLabel}`);
  await click(row);
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

const descriptionError = 'Informe o nome ou a descrição deste item personalizado.';
const valueError = 'Informe um valor negociado maior que zero.';

describe('sale wizard serviço description', () => {
  it('advances step 1 with a serviço item whose description is blank', async () => {
    await changeInput(labeledInput('Valor unitário do item 1'), '4000');
    expect(labeledInput('Nome / descrição do item 1').value).toBe('');

    await click(buttonByText('Avançar'));

    expect(container.textContent).toContain('Plano de pagamento');
    expect(container.textContent).not.toContain(descriptionError);
  });

  it('submits a blank-description serviço with the catalog name as productName', async () => {
    await changeInput(labeledInput('Valor unitário do item 1'), '4000');
    await click(buttonByText('Avançar'));
    await click(buttonByText('Avançar'));
    await click(buttonByText('Avançar'));
    expect(container.textContent).toContain('Consultoria FXL');
    await click(buttonByText('Salvar proposta'));

    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'open',
        items: [
          expect.objectContaining({
            productId: servicoId,
            productName: 'Consultoria FXL',
            unitBrl: 400000,
            areaId,
          }),
        ],
      }),
    );

    // What is persisted, not merely what renders: `product_name_snapshot` is
    // notNull and `SaleItemSchema.productName` is `.trim().min(1)`, so a blank
    // description must never reach the wire as '' or as a raw id.
    const payload = onSave.mock.calls.at(-1)![0];
    expect(payload.items[0]!.productName).toBeTruthy();
    expect(payload.items[0]!.productName).not.toBe(servicoId);
    expect(payload.items[0]!.productName).not.toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('keeps the typed description when a serviço row has one', async () => {
    await changeInput(labeledInput('Nome / descrição do item 1'), 'Escopo mensal');
    await changeInput(labeledInput('Valor unitário do item 1'), '4000');
    await click(buttonByText('Avançar'));
    await click(buttonByText('Avançar'));
    await click(buttonByText('Avançar'));

    expect(container.textContent).toContain('Escopo mensal');
    await click(buttonByText('Salvar proposta'));

    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            productId: servicoId,
            productName: 'Escopo mensal',
          }),
        ],
      }),
    );
  });

  it('still blocks a serviço item whose negotiated value is zero', async () => {
    // Anti-regression for the fused predicate: the description and the value used
    // to be one boolean, so relaxing the description must not relax the value.
    //
    // The second row is load-bearing, not scenery. `canAdvanceStepOne` is
    // `canSaveBasics && itemsValid` and `canSaveBasics` already requires
    // `totalCents > 0`, so a lone zero-value row is blocked by the total even when
    // `itemsValid` wrongly passes. Parking a positively priced produto alongside it
    // satisfies the total, which leaves `itemsValid` as the only thing that can
    // block and makes the per-row value rule the actual subject of this test.
    await click(buttonByText('+ item'));
    await pickOption('Produto / serviço do item 2', 'FXL Finance');
    expect(labeledInput('Valor unitário do item 2').value).not.toBe('0');
    expect(labeledInput('Valor unitário do item 1').value).toBe('0');

    await click(buttonByText('Avançar'));

    expect(container.textContent).toContain('Cliente e responsáveis');
    expect(container.textContent).not.toContain('Plano de pagamento');
    expect(textOccurrences(valueError)).toBe(1);
    expect(textOccurrences(descriptionError)).toBe(0);
    expect(labeledInput('Valor unitário do item 1').getAttribute('aria-invalid')).toBe('true');
    expect(labeledInput('Nome / descrição do item 1').getAttribute('aria-invalid')).not.toBe('true');

    // Positive control: supplying only the value, never a description, unblocks it.
    await changeInput(labeledInput('Valor unitário do item 1'), '4000');
    await click(buttonByText('Avançar'));
    expect(container.textContent).toContain('Plano de pagamento');
  });

  it('keeps the description required for an open-price row that is not a serviço', async () => {
    await pickOption('Produto / serviço do item 1', 'FXL Custom');
    await changeInput(labeledInput('Valor unitário do item 1'), '4000');
    await click(buttonByText('Avançar'));

    expect(container.textContent).toContain('Cliente e responsáveis');
    expect(textOccurrences(descriptionError)).toBe(1);
    expect(textOccurrences(valueError)).toBe(0);

    await changeInput(labeledInput('Nome / descrição do item 1'), 'Módulo Vendas');
    await click(buttonByText('Avançar'));
    expect(container.textContent).toContain('Plano de pagamento');
  });

  it('keeps the description required for a free-form item avulso', async () => {
    await changeInput(labeledInput('Valor unitário do item 1'), '4000');
    await click(buttonByText('+ item avulso'));
    await changeInput(labeledInput('Valor unitário do item 2'), '5000');
    await click(buttonByText('Avançar'));

    expect(container.textContent).toContain('Cliente e responsáveis');
    expect(container.textContent).toContain('Informe a descrição deste item avulso.');
    // The serviço row above is fine with a blank description in the same submit,
    // so the avulso block is about the avulso rule and not about a global gate.
    expect(textOccurrences(descriptionError)).toBe(0);

    await changeInput(labeledInput('Descrição do item 2'), 'Consultoria de processos');
    await click(buttonByText('Avançar'));
    expect(container.textContent).toContain('Plano de pagamento');
  });

  it('labels the serviço description as optional and names the catalog fallback', async () => {
    // The aria-label is frozen (eight existing queries depend on it); only the
    // visible label and the hint move.
    expect(labeledInput('Nome / descrição do item 1')).toBeInstanceOf(HTMLInputElement);
    expect(container.textContent).toContain('Nome / descrição do item (opcional)');
    expect(container.textContent).toContain(
      'Serviço com valor variável - sem descrição, o item aparece como "Consultoria FXL"',
    );
    expect(container.textContent).not.toContain(
      'Sistema personalizado - informe um nome/descrição e o valor negociado',
    );

    await changeInput(labeledInput('Nome / descrição do item 1'), 'Escopo mensal');
    expect(container.textContent).toContain('Serviço com valor variável - descrição opcional');
    expect(container.textContent).not.toContain('o item aparece como');
  });

  it('keeps the produto copy verbatim for an open-price row that is not a serviço', async () => {
    await pickOption('Produto / serviço do item 1', 'FXL Custom');

    expect(container.textContent).toContain(
      'Sistema personalizado - informe um nome/descrição e o valor negociado',
    );
    expect(container.textContent).toContain('Nome / descrição do item');
    expect(container.textContent).not.toContain('Nome / descrição do item (opcional)');
    expect(container.textContent).not.toContain('Serviço com valor variável');
  });

  it('never emits an empty productName when a serviço catalog name is whitespace only', async () => {
    // `ProductSchema.name` on the API is `.min(1)` without `.trim()`, so ' ' is an
    // accepted catalog name. Combined with a blank description that is the one path
    // from this relaxation to a 400, because `SaleItemSchema.productName` is
    // `.trim().min(1)` and `product_name_snapshot` is notNull.
    await remountWizardWith({
      ...bootstrap,
      products: [product({ id: servicoId, name: '   ', kind: 'service', openPrice: true })],
    });

    await changeInput(labeledInput('Valor unitário do item 1'), '4000');
    await click(buttonByText('Avançar'));
    await click(buttonByText('Avançar'));
    await click(buttonByText('Avançar'));
    await click(buttonByText('Salvar proposta'));

    const payload = onSave.mock.calls.at(-1)![0];
    expect(payload.items[0]!.productName.trim()).not.toBe('');
    expect(payload.items[0]!.productName).toBe('Produto');
  });

  it('renders no description field at all for a fixed-price produto', async () => {
    await pickOption('Produto / serviço do item 1', 'FXL Finance');

    expect(container.querySelector('input[aria-label="Nome / descrição do item 1"]')).toBeNull();
    expect(container.textContent).not.toContain('Serviço com valor variável');
    await click(buttonByText('Avançar'));
    expect(container.textContent).toContain('Plano de pagamento');
  });
});
