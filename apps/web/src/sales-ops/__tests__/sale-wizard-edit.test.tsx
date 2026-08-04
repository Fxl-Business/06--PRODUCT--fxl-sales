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
  SalesOpsSale,
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
const funcaoFinder: SalesOpsPersonFuncao = {
  id: 'fc000002-0000-4000-8000-000000000002',
  name: 'Finder',
  slug: 'finder',
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

const areaOneId = '66666666-6666-4666-8666-666666666666';
const areaTwoId = '77777777-7777-4777-8777-777777777777';
const productId = '22222222-2222-4222-8222-222222222222';
const clientId = '33333333-3333-4333-8333-333333333333';
const sellerId = '44444444-4444-4444-8444-444444444444';
const finderId = '55555555-5555-4555-8555-555555555555';
const saleId = '88888888-8888-4888-8888-888888888888';

const editSale: SalesOpsSale = {
  id: saleId,
  orgId: 'org-test',
  sequence: 1,
  code: 'V-0001',
  clientId,
  clientNameSnapshot: 'SegPro',
  sellerPersonId: sellerId,
  sellerNameSnapshot: 'Ana Martins',
  finderPersonId: null,
  finderNameSnapshot: null,
  status: 'open',
  paymentMethod: 'pix',
  condition: 'installments',
  installments: 2,
  baseDate: '2026-07-10',
  notes: 'nota interna',
  wonAt: null,
  lostAt: null,
  totalBrl: 300000,
  recurringBrl: 100000,
  sellerCommissionPct: '8',
  finderCommissionPct: '0',
  taxPct: '6',
  otherCostsBrl: 30000,
  professionalCostsBrl: 50000,
  sellerCommissionBrl: 24000,
  finderCommissionBrl: 0,
  taxBrl: 18000,
  netMarginBrl: 178000,
  netMarginPct: '59.3',
  createdAt: '2026-07-10T12:00:00.000Z',
  updatedAt: null,
};

function bootstrap(patch: Partial<SalesOpsBootstrap> = {}): SalesOpsBootstrap {
  return {
    sales: [editSale],
    products: [
      {
        id: productId,
        orgId: 'org-test',
        name: 'FXL Finance',
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
        createdAt: '2026-07-10T12:00:00.000Z',
        updatedAt: null,
      },
    ],
    clients: [
      {
        id: clientId,
        orgId: 'org-test',
        name: 'SegPro',
        contact: null,
        createdAt: '2026-07-10T12:00:00.000Z',
        updatedAt: null,
      },
    ],
    funcoes: [],
    people: [
      {
        id: sellerId,
        orgId: 'org-test',
        displayName: 'Ana Martins',
        contactEmail: null,
        status: 'active',
        funcaoIds: [funcaoVendedor.id],
        funcoes: [funcaoVendedor],
        createdAt: '2026-07-10T12:00:00.000Z',
        updatedAt: null,
      },
      {
        id: finderId,
        orgId: 'org-test',
        displayName: 'Bruno Finder',
        contactEmail: null,
        status: 'active',
        funcaoIds: [funcaoFinder.id],
        funcoes: [funcaoFinder],
        createdAt: '2026-07-10T12:00:00.000Z',
        updatedAt: null,
      },
    ],
    areas: [
      {
        id: areaOneId,
        orgId: 'org-test',
        name: 'FXL Tech',
        status: 'active',
        createdAt: '2026-07-10T12:00:00.000Z',
        updatedAt: null,
      },
      {
        id: areaTwoId,
        orgId: 'org-test',
        name: 'FXL Advisor',
        status: 'active',
        createdAt: '2026-07-10T12:00:00.000Z',
        updatedAt: null,
      },
    ],
    payables: [],
    saleItems: [
      {
        id: 'item-1',
        saleId,
        productId,
        productNameSnapshot: 'FXL Finance',
        productTypeSnapshot: 'SaaS',
        quantity: 1,
        unitBrl: 250000,
        subtotalBrl: 250000,
      },
      {
        id: 'item-2',
        saleId,
        productId: null,
        areaId: areaTwoId,
        productNameSnapshot: 'Consultoria de processos',
        productTypeSnapshot: '',
        quantity: 1,
        unitBrl: 50000,
        subtotalBrl: 50000,
      },
    ],
    receivables: [
      { id: 'rec-1', saleId, label: '1/2', dueDate: '2026-07-10', amountBrl: 150000, method: 'pix', status: 'open' },
      { id: 'rec-2', saleId, label: '2/2', dueDate: '2026-08-10', amountBrl: 150000, method: 'boleto', status: 'open' },
      { id: 'rec-3', saleId, label: 'M1/2', dueDate: '2026-08-10', amountBrl: 100000, method: 'boleto', status: 'open' },
      { id: 'rec-4', saleId, label: 'M2/2', dueDate: '2026-09-10', amountBrl: 100000, method: 'boleto', status: 'open' },
    ],
    productFuncaoCosts: [],
    saleProfessionals: [
      { saleId, personId: null, personNameSnapshot: 'Dev Externo', role: 'Operacional', costBrl: 50000 },
    ],
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
      createdAt: '2026-07-10T12:00:00.000Z',
      updatedAt: null,
    },
    ...patch,
  };
}

let container: HTMLDivElement;
let root: Root;
let onSave: ReturnType<typeof vi.fn<(payload: CreateSalePayload) => void>>;

async function renderWizard(sale: SalesOpsSale, bootstrapOverride?: SalesOpsBootstrap) {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  onSave = vi.fn<(payload: CreateSalePayload) => void>();
  await act(async () => {
    root.render(
      <SaleWizardDialog
        bootstrap={bootstrapOverride ?? bootstrap()}
        editSale={sale}
        onClose={vi.fn()}
        onSave={onSave}
        open
        saving={false}
      />,
    );
  });
}

beforeEach(async () => {
  await renderWizard(editSale);
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

function buttonExists(label: string): boolean {
  return [...container.querySelectorAll('button')].some(
    (candidate) => candidate.textContent?.trim() === label,
  );
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

function fieldInput(label: string): HTMLInputElement {
  const match = [...container.querySelectorAll('label')].find((candidate) =>
    candidate.textContent?.trim().startsWith(label),
  );
  const input = match?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error(`field not found: ${label}`);
  return input;
}

/**
 * `FUNÇÃO NO PROJETO` is a Combobox over the funções cadastro now, not a text
 * input, so the old positional `row.querySelectorAll('input')[0]` no longer
 * addresses it. Both fields carry an explicit aria-label, which is a stronger
 * handle than a DOM position that any layout change silently invalidates.
 */
function professionalRow(index = 1): { funcao: string; cost: HTMLInputElement } {
  return {
    funcao: comboboxText(`Função do profissional ${index}`),
    cost: labeledInput(`Custo alocado do profissional ${index}`),
  };
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

/**
 * A schedule no entrada-plus-restante formula can produce: an uneven first parcela AND
 * a third one four months out. It is the fixture for the hand-edited branch, and the
 * itens total of 300000 still matches it exactly so `planValid` holds.
 */
const handEditedReceivables: SalesOpsBootstrap['receivables'] = [
  { id: 'rec-1', saleId, label: '1/3', dueDate: '2026-07-10', amountBrl: 200000, method: 'pix', status: 'open' },
  { id: 'rec-2', saleId, label: '2/3', dueDate: '2026-08-10', amountBrl: 50000, method: 'boleto', status: 'open' },
  { id: 'rec-3', saleId, label: '3/3', dueDate: '2026-11-30', amountBrl: 50000, method: 'boleto', status: 'open' },
  { id: 'rec-4', saleId, label: 'M1/2', dueDate: '2026-08-10', amountBrl: 100000, method: 'boleto', status: 'open' },
  { id: 'rec-5', saleId, label: 'M2/2', dueDate: '2026-09-10', amountBrl: 100000, method: 'boleto', status: 'open' },
];

function handEditedRowValues(): Array<[string, string]> {
  const count = container.querySelectorAll('input[aria-label^="Valor da parcela "]').length;
  return Array.from({ length: count }, (_, index) => [
    labeledInput(`Vencimento da parcela ${index + 1}`).value,
    labeledInput(`Valor da parcela ${index + 1}`).value,
  ]);
}

describe('sale wizard edit path', () => {
  it('prefills every step from the existing proposta', async () => {
    expect(container.textContent).toContain('Editar proposta');
    expect(comboboxText('Cliente')).toBe('SegPro');
    expect(labeledInput('Valor unitário do item 1').value).toBe('2500');
    expect(labeledInput('Descrição do item 2').value).toBe('Consultoria de processos');
    expect(comboboxText('Área do item 2')).toBe('FXL Advisor');

    await click(buttonByText('Avançar'));
    expect(container.textContent).toContain('Plano de pagamento');
    expect(labeledInput('Valor da parcela 1').value).toBe('1500');
    expect(labeledInput('Valor da parcela 2').value).toBe('1500');
    expect(comboboxText('Forma de pagamento da parcela 2')).toBe('Boleto');
    /*
      The two stored receivables are an even 2x split of the 3000,00 itens total, so
      the builder reads them back as `nenhuma + 2 x` and says so in the header. The
      absence of the adjusted-manually line is what proves the inference succeeded
      rather than falling through to the hand-edited branch.
    */
    expect(comboboxText('Tipo de entrada')).toBe('nenhuma');
    expect(labeledInput('Parcelas restantes').value).toBe('2');
    expect(container.textContent).not.toContain('Plano ajustado manualmente');
    expect(comboboxText('Recorrência')).toBe('mensal');
    expect(labeledInput('Valor da mensalidade').value).toBe('1000');
    expect(labeledInput('Número de ciclos').value).toBe('2');

    await click(buttonByText('Avançar'));
    expect(container.textContent).toContain('Profissionais alocados');
    expect(fieldInput('Comissão vendedor %').value).toBe('8');
    // A legacy stored row: no funcaoId, so the picker renders its free-text
    // snapshot as the trigger label rather than dropping it.
    const { funcao, cost } = professionalRow();
    expect(funcao).toBe('Operacional');
    expect(cost.value).toBe('500');
  });

  it('sends the legacy professional row back as a role with no funcaoId', async () => {
    await click(buttonByText('Avançar'));
    await click(buttonByText('Avançar'));
    await click(buttonByText('Avançar'));
    await click(buttonByText('Salvar proposta'));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        professionals: [
          {
            personId: undefined,
            personName: 'Dev Externo',
            funcaoId: undefined,
            role: 'Operacional',
            costBrl: 50000,
            // The stored row predates `cost_split_bp`, so it reopens on the default.
            costSplitBp: null,
          },
        ],
      }),
    );
  });

  it('submits the reconstructed update payload with status open', async () => {
    await click(buttonByText('Avançar'));
    await click(buttonByText('Avançar'));
    await click(buttonByText('Avançar'));
    await click(buttonByText('Salvar proposta'));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'open',
        notes: 'nota interna',
        otherCostsBrl: 30000,
        installments: [
          { dueDate: '2026-07-10', amountBrl: 150000, method: 'pix' },
          { dueDate: '2026-08-10', amountBrl: 150000, method: 'boleto' },
        ],
        recurring: { monthlyBrl: 100000, startDate: '2026-08-10', cycles: 2, method: 'boleto' },
      }),
    );
    const payload = onSave.mock.calls[0]![0];
    expect(payload.items[1]).toEqual(
      expect.objectContaining({ areaId: areaTwoId, productName: 'Consultoria de processos' }),
    );
    expect(payload.items[1]?.productId).toBeUndefined();
    expect(payload.professionals).toEqual([
      {
        personId: undefined,
        personName: 'Dev Externo',
        role: 'Operacional',
        costBrl: 50000,
        costSplitBp: null,
      },
    ]);
  });

  it('hides Salvar rascunho when editing an open proposta', async () => {
    expect(buttonExists('Salvar rascunho')).toBe(false);

    await act(async () => root.unmount());
    container.remove();
    await renderWizard({ ...editSale, status: 'draft' });

    expect(buttonExists('Salvar rascunho')).toBe(true);
    await click(buttonByText('Salvar rascunho'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ status: 'draft' }));
  });

  /*
    This test inverts the old `keeps the prefilled plan when the total changes mid-edit`
    deliberately. That plan is an even 2x split, so the builder proved it matches a
    formula; regenerating it live is exactly the "more automatic" behaviour that was
    asked for, and leaving the operator with a red mismatch warning they did not cause
    is not. The old intent - a plan that must NOT be rewritten - moves to
    `keeps a hand-edited plan when the total changes mid-edit` below, where the rows
    really are human-authored.
  */
  it('regenerates a formula plan when the total changes mid-edit', async () => {
    await changeInput(labeledInput('Quantidade do item 1'), '2');
    await click(buttonByText('Avançar'));

    expect(container.textContent).toContain('Plano de pagamento');
    expect(labeledInput('Valor da parcela 1').value).toBe('2750');
    expect(labeledInput('Valor da parcela 2').value).toBe('2750');
    expect(container.textContent).toContain('R$ 5.500,00 / R$ 5.500,00');
    expect(container.textContent).not.toContain(
      'A soma das parcelas precisa ser igual ao total da proposta.',
    );
    expect(container.textContent).not.toContain('Plano ajustado manualmente');

    await click(buttonByText('Avançar'));
    expect(container.textContent).toContain('Profissionais alocados');
  });

  it('keeps a hand-edited plan when the total changes mid-edit', async () => {
    await act(async () => root.unmount());
    container.remove();
    await renderWizard(editSale, bootstrap({ receivables: handEditedReceivables }));

    await click(buttonByText('Avançar'));
    // No formula produces 2000 / 500 / 500 with a 2026-11-30 third parcela, so the
    // plan opens frozen.
    expect(container.textContent).toContain('Plano ajustado manualmente');
    expect(container.textContent).not.toContain('vai substituir as parcelas editadas');
    expect(handEditedRowValues()).toEqual([
      ['2026-07-10', '2000'],
      ['2026-08-10', '500'],
      ['2026-11-30', '500'],
    ]);

    await click(buttonByText('Voltar'));
    await changeInput(labeledInput('Quantidade do item 1'), '2');
    await click(buttonByText('Avançar'));

    // Byte-identical to the stored rows, and it is the mismatch that blocks Avançar.
    expect(handEditedRowValues()).toEqual([
      ['2026-07-10', '2000'],
      ['2026-08-10', '500'],
      ['2026-11-30', '500'],
    ]);
    expect(container.textContent).toContain(
      'A soma das parcelas precisa ser igual ao total da proposta.',
    );
    await click(buttonByText('Avançar'));
    expect(container.textContent).not.toContain('Profissionais alocados');
  });

  it('round-trips a hand-edited plan through save without rewriting it', async () => {
    await act(async () => root.unmount());
    container.remove();
    await renderWizard(editSale, bootstrap({ receivables: handEditedReceivables }));

    // The itens are left alone, so the hand-edited rows already sum to the total.
    await click(buttonByText('Avançar'));
    expect(container.textContent).not.toContain(
      'A soma das parcelas precisa ser igual ao total da proposta.',
    );
    await click(buttonByText('Avançar'));
    await click(buttonByText('Avançar'));
    await click(buttonByText('Salvar proposta'));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        installments: [
          { dueDate: '2026-07-10', amountBrl: 200000, method: 'pix' },
          { dueDate: '2026-08-10', amountBrl: 50000, method: 'boleto' },
          // The date no formula would ever generate, persisted untouched.
          { dueDate: '2026-11-30', amountBrl: 50000, method: 'boleto' },
        ],
      }),
    );
  });

  it('prefills a blank ciclos field for an indefinite recorrencia', async () => {
    await act(async () => root.unmount());
    container.remove();
    // `recurringBrl > 0` with zero `M`-labelled receivables IS `cycles: null`.
    await renderWizard(
      editSale,
      bootstrap({
        receivables: [
          { id: 'rec-1', saleId, label: '1/2', dueDate: '2026-07-10', amountBrl: 150000, method: 'pix', status: 'open' },
          { id: 'rec-2', saleId, label: '2/2', dueDate: '2026-08-10', amountBrl: 150000, method: 'pix', status: 'open' },
        ],
      }),
    );

    await click(buttonByText('Avançar'));
    expect(comboboxText('Recorrência')).toBe('mensal');
    expect(labeledInput('Número de ciclos').value).toBe('');
    expect(labeledInput('Valor da mensalidade').value).toBe('1000');
    expect(container.textContent).toContain(
      'Sem parcelas futuras geradas agora - a mensalidade entra como receita recorrente (MRR).',
    );
    expect(container.textContent).toContain(', por prazo indeterminado');

    await click(buttonByText('Avançar'));
    await click(buttonByText('Avançar'));
    await click(buttonByText('Salvar proposta'));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        recurring: { monthlyBrl: 100000, startDate: '2026-08-10', cycles: null, method: 'pix' },
      }),
    );
  });
});
