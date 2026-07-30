// @vitest-environment happy-dom

import * as React from 'react';
import type { HTMLAttributes } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addMonthsToIsoDate } from '../calculations';
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
const templatedProductId = '55555555-5555-4555-8555-555555555555';

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
/**
 * Carries a stored default payment plan, unlike the two above. The six flat default
 * columns are what the produto cadastro writes, and three of them describe the plan
 * shape the wizard opens on.
 */
const templatedProduct = product({
  id: templatedProductId,
  name: 'FXL Template',
  setupBrl: 250000,
  defaultEntradaMode: 'pct',
  defaultEntradaPct: '50',
  defaultEntradaBrl: null,
  defaultRemainingInstallments: 3,
});

const bootstrap: SalesOpsBootstrap = {
  sales: [],
  products: [fixedProduct, recurringProduct, templatedProduct],
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

/** The single grid the three declarative header controls share. */
function planHeaderGrid(): HTMLElement {
  const grid = comboboxTrigger('Tipo de entrada').closest('div.grid');
  if (!(grid instanceof HTMLElement)) throw new Error('plan header grid not found');
  return grid;
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


function buttonExists(label: string): boolean {
  return [...container.querySelectorAll('button')].some(
    (candidate) => candidate.textContent?.trim() === label,
  );
}

function inputExists(label: string): boolean {
  return container.querySelector(`input[aria-label="${label}"]`) !== null;
}

function parcelaCount(): number {
  return container.querySelectorAll('input[aria-label^="Valor da parcela "]').length;
}

/** The whole `Nº | VENCIMENTO | VALOR | FORMA` table as `[date, amount, method]` triples. */
function parcelaRows(): Array<[string, string, string]> {
  return Array.from({ length: parcelaCount() }, (_, index) => [
    labeledInput(`Vencimento da parcela ${index + 1}`).value,
    labeledInput(`Valor da parcela ${index + 1}`).value,
    comboboxText(`Forma de pagamento da parcela ${index + 1}`),
  ]);
}

/**
 * The proposta base date is "today", so these fixtures cannot hardcode due dates.
 * The month-offset arithmetic itself, including the month-end clamp, is pinned
 * against literal dates in `payment-plan-generation.test.ts` and
 * `calculations.test.ts`; here it only expresses "one month after the anchor".
 */
function monthsAfter(iso: string, months: number): string {
  return addMonthsToIsoDate(iso, months);
}

const mismatchWarning = 'A soma das parcelas precisa ser igual ao total da proposta.';
const dirtyLine = 'Plano ajustado manualmente';

describe('sale wizard payment plan', () => {
  it('generates a single row for tudo pago em 1x', async () => {
    await click(buttonByText('Avançar'));

    // No interaction at all: the fixture's 2500,00 total opens as one cash parcela.
    expect(comboboxText('Tipo de entrada')).toBe('nenhuma');
    expect(labeledInput('Parcelas restantes').value).toBe('1');
    expect(parcelaCount()).toBe(1);
    expect(labeledInput('Valor da parcela 1').value).toBe('2500');
    expect(container.textContent).toContain('sem entrada');
    expect(container.textContent).not.toContain(mismatchWarning);

    await click(buttonByText('Avançar'));
    expect(container.textContent).toContain('Profissionais alocados');
  });

  it('aligns the three declarative header controls on one grid with each derived line under its own control', async () => {
    await click(buttonByText('Avançar'));

    const grid = planHeaderGrid();
    // One grid, three columns: `Recorrência` used to live in a sibling block below.
    expect(grid.className).toContain('md:grid-cols-3');
    expect(grid.querySelector('input[aria-label="Parcelas restantes"]')).not.toBeNull();
    expect(grid.querySelector('button[role="combobox"][aria-label="Recorrência"]')).not.toBeNull();

    // Each derived line is a child of its own FieldBlock and is NOT pushed to that
    // grid column's right edge, which is what made it float across the card.
    const hints = [...grid.querySelectorAll('div')].filter((node) =>
      ['sem entrada', '1 x R$ 2.500,00'].includes(node.textContent?.trim() ?? ''),
    );
    expect(hints).toHaveLength(2);
    for (const hint of hints) expect(hint.className).not.toContain('text-right');

    // Form geometry, not the 40px `Filtros` bar: every header control is 44px.
    expect(comboboxTrigger('Tipo de entrada').className).toContain('h-11');
    expect(comboboxTrigger('Recorrência').className).toContain('h-11');
    expect(labeledInput('Parcelas restantes').className).toContain('h-11');
  });

  it('keeps the recorrência sub-fields below the header grid, not inside it', async () => {
    await pickOption('Produto / serviço do item 1', 'FXL Advisor');
    await click(buttonByText('Avançar'));
    expect(comboboxText('Recorrência')).toBe('mensal');

    const grid = planHeaderGrid();
    expect(grid.querySelector('input[aria-label="Valor da mensalidade"]')).toBeNull();
    expect(grid.querySelector('input[aria-label="Número de ciclos"]')).toBeNull();

    // The hint belongs to the control it describes.
    const ciclos = labeledInput('Número de ciclos').closest('label');
    expect(ciclos?.textContent).toContain('Deixe em branco para prazo indeterminado');
  });

  it('seeds the header from the produto default payment plan', async () => {
    // Positive control first: the fixture's default product carries no template, so
    // step 2 opens on the app default of one cash parcela.
    await click(buttonByText('Avançar'));
    expect(comboboxText('Tipo de entrada')).toBe('nenhuma');
    expect(labeledInput('Parcelas restantes').value).toBe('1');

    await click(buttonByText('Voltar'));
    await pickOption('Produto / serviço do item 1', 'FXL Template');
    await click(buttonByText('Avançar'));

    expect(comboboxText('Tipo de entrada')).toBe('%');
    expect(labeledInput('Valor da entrada').value).toBe('50');
    expect(labeledInput('Parcelas restantes').value).toBe('3');
    const base = labeledInput('Vencimento da parcela 1').value;
    expect(parcelaRows()).toEqual([
      [base, '1250', 'Pix'],
      [monthsAfter(base, 1), '416.66', 'Pix'],
      [monthsAfter(base, 2), '416.66', 'Pix'],
      [monthsAfter(base, 3), '416.68', 'Pix'],
    ]);
    expect(container.textContent).not.toContain(mismatchWarning);
  });

  it('generates restante rows live from Parcelas restantes with the remainder on the last row', async () => {
    await click(buttonByText('Avançar'));
    // One control, no Dividir click and no + parcela click.
    await changeInput(labeledInput('Parcelas restantes'), '3');

    expect(labeledInput('Valor da parcela 1').value).toBe('833.33');
    expect(labeledInput('Valor da parcela 2').value).toBe('833.33');
    expect(labeledInput('Valor da parcela 3').value).toBe('833.34');
    const first = labeledInput('Vencimento da parcela 1').value;
    const second = labeledInput('Vencimento da parcela 2').value;
    const [year, month, day] = first.split('-').map(Number);
    expect(second).toBe(
      new Date(Date.UTC(year!, month! - 1 + 1, day!)).toISOString().slice(0, 10),
    );
    // The hint quotes the row values, never a rounded figure the table lacks.
    expect(container.textContent).toContain('3 x R$ 833,33 (última R$ 833,34)');

    // The manual controls the declarative header replaced.
    expect(buttonExists('Dividir')).toBe(false);
    expect(buttonExists('+ parcela')).toBe(false);
    expect(buttonExists('Adicionar recorrência')).toBe(false);
    expect(buttonExists('Prazo indeterminado')).toBe(false);
    expect(buttonExists('Remover parcela 1')).toBe(false);
    expect(inputExists('Número de parcelas')).toBe(false);
    // Positive control for the five negatives above: the declarative header really is
    // there, so this is about controls that were removed and not about a broken query.
    expect(inputExists('Parcelas restantes')).toBe(true);

    await click(buttonByText('Avançar'));
    expect(container.textContent).toContain('Profissionais alocados');
  });

  it('generates an entrada row from a percentage plus the remaining parcelas', async () => {
    await click(buttonByText('Avançar'));
    await pickOption('Tipo de entrada', '%');
    await changeInput(labeledInput('Valor da entrada'), '50');
    await changeInput(labeledInput('Parcelas restantes'), '3');

    const base = labeledInput('Vencimento da parcela 1').value;
    expect(parcelaRows()).toEqual([
      [base, '1250', 'Pix'],
      [monthsAfter(base, 1), '416.66', 'Pix'],
      [monthsAfter(base, 2), '416.66', 'Pix'],
      [monthsAfter(base, 3), '416.68', 'Pix'],
    ]);
    expect(container.textContent).toContain('R$ 1.250,00');
    expect(container.textContent).toContain('R$ 2.500,00 / R$ 2.500,00');
    expect(container.textContent).not.toContain(mismatchWarning);
  });

  it('generates an entrada row from a fixed value plus one parcela one month later', async () => {
    await click(buttonByText('Avançar'));
    await pickOption('Tipo de entrada', 'R$ fixo');
    await changeInput(labeledInput('Valor da entrada'), '500');
    await changeInput(labeledInput('Parcelas restantes'), '1');

    const base = labeledInput('Vencimento da parcela 1').value;
    expect(parcelaRows()).toEqual([
      [base, '500', 'Pix'],
      [monthsAfter(base, 1), '2000', 'Pix'],
    ]);
    expect(container.textContent).not.toContain(mismatchWarning);
  });

  it('blocks advancing while the parcelas do not sum to the total', async () => {
    await click(buttonByText('Avançar'));
    expect(container.textContent).not.toContain(dirtyLine);
    await changeInput(labeledInput('Valor da parcela 1'), '100');

    expect(container.textContent).toContain(mismatchWarning);
    // A hand-typed amount freezes the plan instead of being overwritten.
    expect(container.textContent).toContain(dirtyLine);
    await click(buttonByText('Avançar'));
    expect(container.textContent).toContain('Plano de pagamento');
    expect(container.textContent).not.toContain('Profissionais alocados');

    await changeInput(labeledInput('Valor da parcela 1'), '2500');
    expect(container.textContent).not.toContain(mismatchWarning);
    await click(buttonByText('Avançar'));
    expect(container.textContent).toContain('Profissionais alocados');
  });

  it('does not silently discard a hand-edited row when a header control changes', async () => {
    await click(buttonByText('Avançar'));
    await changeInput(labeledInput('Parcelas restantes'), '2');
    await changeInput(labeledInput('Valor da parcela 1'), '900');
    expect(container.textContent).toContain(dirtyLine);
    expect(container.textContent).not.toContain('vai substituir as parcelas editadas');

    await changeInput(labeledInput('Parcelas restantes'), '4');
    expect(container.textContent).toContain(
      'Você ajustou as parcelas manualmente. Aplicar 4 x vai substituir as parcelas editadas.',
    );
    // Nothing regenerated: the typed value and the old row count both survive.
    expect(labeledInput('Valor da parcela 1').value).toBe('900');
    expect(parcelaCount()).toBe(2);

    await click(buttonByText('Manter parcelas'));
    expect(labeledInput('Parcelas restantes').value).toBe('2');
    expect(labeledInput('Valor da parcela 1').value).toBe('900');
    expect(parcelaCount()).toBe(2);
    expect(container.textContent).not.toContain('vai substituir as parcelas editadas');
    expect(container.textContent).toContain(dirtyLine);

    await changeInput(labeledInput('Parcelas restantes'), '4');
    await click(buttonByText('Aplicar'));
    expect(parcelaCount()).toBe(4);
    expect(labeledInput('Valor da parcela 1').value).toBe('625');
    expect(container.textContent).not.toContain(dirtyLine);
    expect(container.textContent).not.toContain(mismatchWarning);
  });

  it('recovers the formula from a hand-edited plan through Regerar plano', async () => {
    await click(buttonByText('Avançar'));
    await changeInput(labeledInput('Valor da parcela 1'), '100');
    expect(container.textContent).toContain(dirtyLine);
    expect(container.textContent).toContain(mismatchWarning);

    // Same shape, same total: only clearing the flag can bring the rows back.
    await click(buttonByText('Regerar plano'));
    expect(labeledInput('Valor da parcela 1').value).toBe('2500');
    expect(container.textContent).not.toContain(dirtyLine);
    expect(container.textContent).not.toContain(mismatchWarning);
  });

  it('keeps a per-row forma through a regeneration', async () => {
    await click(buttonByText('Avançar'));
    await changeInput(labeledInput('Parcelas restantes'), '2');
    await pickOption('Forma de pagamento da parcela 2', 'Boleto');
    expect(container.textContent).not.toContain(dirtyLine);

    await changeInput(labeledInput('Parcelas restantes'), '3');
    // No confirm bar: forma carries no arithmetic, so it never blocks a regeneration.
    expect(container.textContent).not.toContain('vai substituir as parcelas editadas');
    expect(parcelaCount()).toBe(3);
    expect(comboboxText('Forma de pagamento da parcela 1')).toBe('Pix');
    expect(comboboxText('Forma de pagamento da parcela 2')).toBe('Boleto');
    expect(comboboxText('Forma de pagamento da parcela 3')).toBe('Boleto');
  });

  it('prefills and submits the recurring block for a mensalidade product', async () => {
    await pickOption('Produto / serviço do item 1', 'FXL Advisor');
    expect(comboboxText('Produto / serviço do item 1')).toBe('FXL Advisor');
    await click(buttonByText('Avançar'));

    expect(comboboxText('Recorrência')).toBe('mensal');
    expect(labeledInput('Valor da mensalidade').value).toBe('1000');
    await changeInput(labeledInput('Número de ciclos'), '');

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

  it('generates no bounded rows for an indefinite recorrencia', async () => {
    await pickOption('Produto / serviço do item 1', 'FXL Advisor');
    await click(buttonByText('Avançar'));

    // Bounded first, as the positive control: 2 ciclos really do reach step 4.
    await changeInput(labeledInput('Número de ciclos'), '2');
    expect(container.textContent).toContain('2 ciclos de R$ 1.000,00');
    await click(buttonByText('Avançar'));
    await click(buttonByText('Avançar'));
    expect(container.textContent).toContain('Previsão de contas a pagar');
    expect(container.textContent).toContain('parcela 2');
    expect(container.textContent).toContain('parcela 3');

    await click(buttonByText('Voltar'));
    await click(buttonByText('Voltar'));
    await changeInput(labeledInput('Número de ciclos'), '');
    expect(container.textContent).toContain(
      'Sem parcelas futuras geradas agora - a mensalidade entra como receita recorrente (MRR).',
    );
    expect(container.textContent).toContain(', por prazo indeterminado');
    // The recurrence never contributes rows to the editable table.
    expect(parcelaCount()).toBe(1);

    await click(buttonByText('Avançar'));
    await click(buttonByText('Avançar'));
    expect(container.textContent).toContain('Previsão de contas a pagar');
    expect(container.textContent).toContain('parcela 1');
    expect(container.textContent).not.toContain('parcela 2');

    await click(buttonByText('Salvar proposta'));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        recurring: expect.objectContaining({ cycles: null }),
      }),
    );
  });

  it('submits the edited plan rows with per-parcela method and date', async () => {
    await click(buttonByText('Avançar'));
    await changeInput(labeledInput('Parcelas restantes'), '2');
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
