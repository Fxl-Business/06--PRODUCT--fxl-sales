// @vitest-environment happy-dom

import * as React from 'react';
import type { HTMLAttributes } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
      { id: 'prof-1', saleId, personId: null, personNameSnapshot: 'Dev Externo', role: 'Operacional', costBrl: 50000 },
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
let root: Root | null = null;
let onSave: ReturnType<typeof vi.fn<(payload: CreateSalePayload) => void>>;

async function renderWizard(sale: SalesOpsSale, bootstrapOverride?: SalesOpsBootstrap, saveError?: string[]) {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  onSave = vi.fn<(payload: CreateSalePayload) => void>();
  await act(async () => {
    root!.render(
      <SaleWizardDialog
        bootstrap={bootstrapOverride ?? bootstrap()}
        editSale={sale}
        onClose={vi.fn()}
        onSave={onSave}
        open
        saveError={saveError ?? null}
        saving={false}
      />,
    );
  });
}

afterEach(async () => {
  if (root) {
    const current = root;
    await act(async () => current.unmount());
    root = null;
  }
  container?.remove();
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

/** From step 2: advance to step 4 and save. */
async function saveFromStepTwo() {
  await click(buttonByText('Avançar'));
  await click(buttonByText('Avançar'));
  await click(buttonByText('Salvar proposta'));
}

async function saveToEnd() {
  await click(buttonByText('Avançar'));
  await saveFromStepTwo();
}

function lastPayload(): CreateSalePayload {
  return onSave.mock.calls.at(-1)![0];
}

/** A JSON round trip, which is what the wire sees: `undefined` keys vanish. */
function wire(payload: CreateSalePayload): CreateSalePayload {
  return JSON.parse(JSON.stringify(payload)) as CreateSalePayload;
}

async function handEditPlan() {
  await click(buttonByText('Avançar'));
  await changeInput(labeledInput('Valor da parcela 1'), '1600');
  await changeInput(labeledInput('Valor da parcela 2'), '1400');
}

describe('sale wizard row ids', () => {
  it('round-trips every loaded row id through an untouched edit', async () => {
    await renderWizard(editSale);
    await saveToEnd();

    const payload = lastPayload();
    expect(payload.installments.map((row) => row.id)).toEqual(['rec-1', 'rec-2']);
    expect(payload.recurring?.receivableIds).toEqual(['rec-3', 'rec-4']);
    expect(payload.items.map((row) => row.id)).toEqual(['item-1', 'item-2']);
    expect(payload.professionals.map((row) => row.id)).toEqual(['prof-1']);
  });

  it('keeps ids through a hand edit of a parcela amount and date', async () => {
    await renderWizard(editSale);
    await handEditPlan();
    await changeInput(labeledInput('Vencimento da parcela 2'), '2026-08-20');
    await saveFromStepTwo();

    expect(lastPayload().installments).toEqual([
      { id: 'rec-1', dueDate: '2026-07-10', amountBrl: 160000, method: 'pix' },
      { id: 'rec-2', dueDate: '2026-08-20', amountBrl: 140000, method: 'boleto' },
    ]);
  });

  it('keeps ids positionally through Aplicar after a header change', async () => {
    await renderWizard(editSale);
    await handEditPlan();
    await changeInput(labeledInput('Parcelas restantes'), '3');
    await click(buttonByText('Aplicar'));
    await saveFromStepTwo();

    const installments = lastPayload().installments;
    expect(installments.map((row) => row.id)).toEqual(['rec-1', 'rec-2', undefined]);
    expect(installments.map((row) => row.amountBrl)).toEqual([100000, 100000, 100000]);
  });

  it('keeps ids verbatim through Manter parcelas', async () => {
    await renderWizard(editSale);
    await handEditPlan();
    await changeInput(labeledInput('Parcelas restantes'), '3');
    await click(buttonByText('Manter parcelas'));
    await saveFromStepTwo();

    const installments = lastPayload().installments;
    expect(installments.map((row) => row.id)).toEqual(['rec-1', 'rec-2']);
    expect(installments.map((row) => row.amountBrl)).toEqual([160000, 140000]);
  });

  it('drops the surplus id when the plan shrinks', async () => {
    await renderWizard(
      editSale,
      bootstrap({
        receivables: [
          { id: 'rec-1', saleId, label: '1/3', dueDate: '2026-07-10', amountBrl: 100000, method: 'pix', status: 'open' },
          { id: 'rec-2', saleId, label: '2/3', dueDate: '2026-08-10', amountBrl: 100000, method: 'pix', status: 'open' },
          { id: 'rec-3', saleId, label: '3/3', dueDate: '2026-09-10', amountBrl: 100000, method: 'pix', status: 'open' },
          { id: 'rec-4', saleId, label: 'M1/2', dueDate: '2026-08-10', amountBrl: 100000, method: 'boleto', status: 'open' },
          { id: 'rec-5', saleId, label: 'M2/2', dueDate: '2026-09-10', amountBrl: 100000, method: 'boleto', status: 'open' },
        ],
      }),
    );
    await click(buttonByText('Avançar'));
    await changeInput(labeledInput('Parcelas restantes'), '2');
    await saveFromStepTwo();

    const payload = lastPayload();
    expect(payload.installments.map((row) => row.id)).toEqual(['rec-1', 'rec-2']);
    expect(JSON.stringify(payload)).not.toContain('rec-3');
  });

  it('keeps recurring receivable ids through a ciclos edit and sends none without recorrência', async () => {
    await renderWizard(editSale);
    await click(buttonByText('Avançar'));
    await changeInput(labeledInput('Número de ciclos'), '3');
    await saveFromStepTwo();
    expect(lastPayload().recurring).toEqual(
      expect.objectContaining({ cycles: 3, receivableIds: ['rec-3', 'rec-4'] }),
    );

    await click(buttonByText('Voltar'));
    await click(buttonByText('Voltar'));
    await changeInput(labeledInput('Número de ciclos'), '1');
    await saveFromStepTwo();
    expect(lastPayload().recurring).toEqual(expect.objectContaining({ cycles: 1, receivableIds: ['rec-3'] }));

    await click(buttonByText('Voltar'));
    await click(buttonByText('Voltar'));
    await pickOption('Recorrência', 'nenhuma');
    await saveFromStepTwo();
    expect(lastPayload().recurring).toBeNull();
    expect(onSave).toHaveBeenCalledTimes(3);
  });

  it('sends no id for a new item or a new parcela', async () => {
    await renderWizard(editSale);
    await click(buttonByText('+ item avulso'));
    await changeInput(labeledInput('Descrição do item 3'), 'Treinamento');
    await changeInput(labeledInput('Valor unitário do item 3'), '100');
    await click(buttonByText('Avançar'));
    await changeInput(labeledInput('Parcelas restantes'), '3');
    await saveFromStepTwo();

    const payload = wire(lastPayload());
    expect(payload.items).toHaveLength(3);
    expect(payload.installments).toHaveLength(3);
    expect(payload.items.slice(0, 2).map((row) => row.id)).toEqual(['item-1', 'item-2']);
    expect(payload.installments.slice(0, 2).map((row) => row.id)).toEqual(['rec-1', 'rec-2']);
    expect('id' in payload.items[2]!).toBe(false);
    expect('id' in payload.installments[2]!).toBe(false);
  });

  it('never reads the label to match rows', async () => {
    await renderWizard(
      editSale,
      bootstrap({
        receivables: [
          { id: 'rec-1', saleId, label: '2/2', dueDate: '2026-07-10', amountBrl: 150000, method: 'pix', status: 'open' },
          { id: 'rec-2', saleId, label: '1/2', dueDate: '2026-08-10', amountBrl: 150000, method: 'boleto', status: 'open' },
          { id: 'rec-3', saleId, label: 'M1/2', dueDate: '2026-08-10', amountBrl: 100000, method: 'boleto', status: 'open' },
          { id: 'rec-4', saleId, label: 'M2/2', dueDate: '2026-09-10', amountBrl: 100000, method: 'boleto', status: 'open' },
        ],
      }),
    );
    await saveToEnd();

    expect(lastPayload().installments).toEqual([
      { id: 'rec-1', dueDate: '2026-07-10', amountBrl: 150000, method: 'pix' },
      { id: 'rec-2', dueDate: '2026-08-10', amountBrl: 150000, method: 'boleto' },
    ]);
  });

  it('opens a won proposta for edit and saves it with status won', async () => {
    await renderWizard({ ...editSale, status: 'won', wonAt: '2026-07-11T12:00:00.000Z' });
    expect(container.textContent).toContain('Editar proposta');
    expect(buttonExists('Salvar rascunho')).toBe(false);

    await saveToEnd();
    const payload = lastPayload();
    expect(payload.status).toBe('won');
    expect(payload.installments.map((row) => row.id)).toEqual(['rec-1', 'rec-2']);
    expect(payload.recurring?.receivableIds).toEqual(['rec-3', 'rec-4']);
    expect(payload.items.map((row) => row.id)).toEqual(['item-1', 'item-2']);
    expect(payload.professionals.map((row) => row.id)).toEqual(['prof-1']);
  });

  it('still refuses to open a lost or cancelled proposta', async () => {
    for (const status of ['lost', 'cancelled'] as const) {
      await renderWizard({ ...editSale, status });
      expect(container.textContent).toBe('');
      const current = root!;
      await act(async () => current.unmount());
      root = null;
      container.remove();
    }
  });

  it('renders the save error inside the open wizard', async () => {
    await renderWizard(editSale, undefined, [
      'A parcela 2/2 tem baixa ativa.',
      'Estorne a baixa antes de mudar valor ou vencimento.',
    ]);

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('A parcela 2/2 tem baixa ativa.');
    expect(alert?.textContent).toContain('Estorne a baixa antes de mudar valor ou vencimento.');
    expect(container.textContent).toContain('Editar proposta');
  });
});
